const { getOctokit } = require('@actions/github');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const yaml = require('js-yaml');
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.webm']);

const CONTENT_TYPES = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  opus: 'audio/ogg',
  webm: 'audio/webm',
};

// Rendered issue-form section headers -> field ids.
const LABEL_TO_FIELD = {
  'Prompt title': 'title',
  'Model': 'model',
  'Language': 'language',
  'Tags': 'tags',
  'Prompt text': 'prompt_text',
  'Speed (optional)': 'speed',
  'Volume (optional)': 'volume',
  'Temperature (optional)': 'temperature',
  'Top P (optional)': 'top_p',
  'Repetition penalty (optional)': 'repetition_penalty',
  'NSFW (optional)': 'nsfw',
  'Voice name (optional)': 'voice_name',
  'Voice link (optional)': 'voice_url',
  'Notes / description (optional)': 'description',
  'Your name or handle': 'contributor',
  'License / consent': 'consent',
};

const ALLOWED_MODELS = new Set(['s2.1-pro', 's2-pro', 's1', 'drama-3']);

// Normalize model input to allowed set (handles legacy "S2.1 Pro", case, spaces)
function normalizeModel(raw) {
  if (!raw) return raw;
  let m = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  // legacy mappings
  if (m === 's2.1-pro' || m === 's2.1' || m === 's2.1pro') return 's2.1-pro';
  if (m === 's2-pro' || m === 's2' || m === 's2.0' || m === 's2.0-pro') return 's2-pro';
  if (m === 's1' || m === 's1.0' || m === 's1.1') return 's1';
  if (m === 'drama-3' || m === 'drama3' || m === 'drama') return 'drama-3';
  return m;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const REQUIRED_FIELDS = ['title', 'model', 'language', 'tags', 'prompt_text', 'contributor'];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

const MARKDOWN_LINK_RE = /\[[^\]]*\]\(\s*([^)\s]+)\s*\)/g;

function isAttachmentHost(url) {
  return /\/user-attachments\//.test(url) || /\.githubusercontent\.com\//.test(url);
}

function stripAttachmentLinks(text) {
  return text.replace(MARKDOWN_LINK_RE, (whole, url) => (isAttachmentHost(url) ? '' : whole));
}

function parseFormSections(body) {
  const sections = new Map();
  let current = null;
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^###\s+(.+)$/);
    if (match) {
      current = LABEL_TO_FIELD[match[1].trim()];
      if (current) sections.set(current, []);
      continue;
    }
    if (current && sections.has(current)) {
      sections.get(current).push(line);
    }
  }

  const values = {};
  for (const [field, lines] of sections) {
    values[field] = lines
      .map(stripAttachmentLinks)
      .filter((l) => l.trim() && l.trim() !== '---')
      .join('\n')
      .trim();
  }
  return values;
}

function findAudioAttachments(body) {
  const attachments = [];
  let match;
  while ((match = MARKDOWN_LINK_RE.exec(body)) !== null) {
    const name = match[0].slice(match[0].indexOf('[') + 1, match[0].indexOf(']'));
    const url = match[1];
    const ext = path.extname(name).toLowerCase();
    if (isAttachmentHost(url) && name !== url && AUDIO_EXTENSIONS.has(ext)) {
      attachments.push({ name, url, ext: ext.slice(1) });
    }
  }
  if (attachments.length === 0) {
    const rawUrlRe = /(https?:\/\/[^\s)>]+)/g;
    while ((match = rawUrlRe.exec(body)) !== null) {
      let url = match[1];
      url = url.replace(/\)+$/, '');
      if (!isAttachmentHost(url)) continue;
      try {
        const ext = path.extname(new URL(url).pathname).toLowerCase();
        if (AUDIO_EXTENSIONS.has(ext)) {
          attachments.push({ name: path.basename(url), url, ext: ext.slice(1) });
        }
      } catch {
        // not a valid URL, ignore
      }
    }
  }
  return attachments;
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'prompt'
  );
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (currentUrl, redirects) => {
      if (redirects > 5) {
        reject(new Error('Too many redirects'));
        return;
      }
      const mod = currentUrl.startsWith('https:') ? https : http;
      const request = mod.get(
        currentUrl,
        { headers: { 'User-Agent': 'prompt-submission-pipeline' } },
        (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.resume();
            follow(new URL(response.headers.location, currentUrl).toString(), redirects + 1);
            return;
          }
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`Download failed with HTTP ${response.statusCode} for ${currentUrl}`));
            return;
          }
          const file = fs.createWriteStream(dest);
          response.pipe(file);
          file.on('finish', () => file.close(() => resolve(dest)));
          file.on('error', reject);
        }
      );
      request.on('error', reject);
    };
    follow(url, 0);
  });
}

async function addNeedsInfoComment(octokit, owner, repo, issueNumber, missing) {
  const bullet = missing.map((item) => `- ${item}`).join('\n');
  const body =
    `Thanks for submitting! A few things are missing before we can process this:\n\n` +
    `${bullet}\n\n` +
    `Please edit this issue to add them and don't forget to drag the audio file into the body.`;
  await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });

  const { data: labels } = await octokit.rest.issues.listLabelsForIssue({ owner, repo, issue_number: issueNumber });
  if (!labels.some((label) => label.name === 'needs-info')) {
    await octokit.rest.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: ['needs-info'] });
  }
}

function humanLabel(field) {
  const names = {
    title: 'Prompt title',
    model: 'Model',
    language: 'Language',
    tags: 'Tags (at least one)',
    prompt_text: 'Prompt text',
    contributor: 'Your name or handle',
    consent: 'License / consent checkbox',
    audio: 'Audio attachment (drag your file into the form body)',
  };
  return names[field] || field;
}

async function fileExists(octokit, owner, repo, filePath, ref) {
  try {
    await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref });
    return true;
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
}

async function uniqueSlug(octokit, owner, repo, base, ref) {
  let candidate = base;
  let counter = 1;
  /* eslint-disable no-await-in-loop */
  while (await fileExists(octokit, owner, repo, `content/prompts/${candidate}.md`, ref)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

async function main() {
  const token = requireEnv('GITHUB_TOKEN');
  const [owner, repo] = requireEnv('REPO').split('/');
  const issueNumber = parseInt(requireEnv('ISSUE_NUMBER'), 10);
  const accountId = requireEnv('R2_ACCOUNT_ID');
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY');
  const bucket = requireEnv('R2_BUCKET');
  const publicUrl = requireEnv('R2_PUBLIC_URL').replace(/\/+$/, '');

  const octokit = getOctokit(token);

  const { data: issue } = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });

  const form = parseFormSections(issue.body || '');
  const attachments = findAudioAttachments(issue.body || '');

  const missing = [];
  for (const field of REQUIRED_FIELDS) {
    const value = form[field];
    if (field === 'tags') {
      const tags = String(value || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tags.length === 0) missing.push(field);
    } else if (!value) {
      missing.push(field);
    }
  }
  const consented = /- \[x\]/i.test(form.consent || '');
  if (!consented) missing.push('consent');
  if (attachments.length === 0) missing.push('audio');

  if (missing.length > 0) {
    console.log(`Missing fields: ${missing.join(', ')}`);
    await addNeedsInfoComment(octokit, owner, repo, issueNumber, missing.map(humanLabel));
    console.log('Commented with missing info; no PR opened.');
    return;
  }

  const title = form.title.trim();
  const rawModel = form.model.trim();
  const model = normalizeModel(rawModel);
  if (!ALLOWED_MODELS.has(model)) {
    throw new Error(`Invalid model "${rawModel}" (normalized to "${model}"). Allowed: ${Array.from(ALLOWED_MODELS).join(', ')}`);
  }
  const language = form.language.trim();
  const tags = String(form.tags)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const promptText = form.prompt_text.trim();
  const description = form.description ? form.description.trim() : '';
  const contributor = form.contributor.trim();
  const voiceName = form.voice_name ? form.voice_name.trim() : '';
  const voiceUrl = form.voice_url ? form.voice_url.trim() : '';

  const topP = parseFloat(form.top_p);
  const temperature = parseFloat(form.temperature);
  const speed = parseFloat(form.speed);
  const volume = parseFloat(form.volume);
  const repetitionPenalty = parseFloat(form.repetition_penalty);
  const nsfw = form.nsfw === 'Yes';

  const attachment = attachments[0];
  const slug = slugify(title);
  const baseKey = `${issueNumber}-${slug}.${attachment.ext}`;

  const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo });
  const defaultBranch = repoInfo.default_branch;
  const finalSlug = await uniqueSlug(octokit, owner, repo, slug, defaultBranch);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-audio-'));
  const tempFile = path.join(tempDir, `audio.${attachment.ext}`);
  console.log(`Downloading ${attachment.url} ...`);
  await download(attachment.url, tempFile);
  console.log('Download complete.');

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  const key = `audio/${baseKey}`;
  console.log(`Uploading to R2 as ${key} ...`);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.readFileSync(tempFile),
      ContentType: CONTENT_TYPES[attachment.ext] || 'application/octet-stream',
    })
  );
  console.log('Upload complete.');

  const audioUrl = `${publicUrl}/${key}`;

  // All metadata fields are optional — N/A in UI when not defined, clamp when provided
  const frontMatter = {
    title,
    date: new Date().toISOString(),
    audio_url: audioUrl,
    model,
    language,
    tags,
    contributor,
    source_issue: issueNumber,
    ...(voiceName ? { voice_name: voiceName } : {}),
    ...(voiceUrl ? { voice_url: voiceUrl } : {}),
    metadata: {
      prompt_text: promptText,
      ...(isNaN(speed) ? {} : { speed: clamp(speed, 0.7, 1.3) }),
      ...(isNaN(volume) ? {} : { volume: clamp(volume, -5, 5) }),
      ...(isNaN(temperature) ? {} : { temperature }),
      ...(isNaN(topP) ? {} : { top_p: topP }),
      ...(isNaN(repetitionPenalty) ? {} : { repetition_penalty: repetitionPenalty }),
      nsfw,
      ...(voiceName ? { voice_name: voiceName } : {}),
      ...(voiceUrl ? { voice_url: voiceUrl } : {}),
    },
  };
  const bodyText = description !== '' ? description : `Contributed via #${issueNumber}.`;
  const fileContent = `---\n${yaml.dump(frontMatter)}---\n\n${bodyText}\n`;

  const contentPath = `content/prompts/${finalSlug}.md`;
  const branchName = `prompt/issue-${issueNumber}`;
  const ref = `heads/${branchName}`;

  let branchExists = true;
  try {
    await octokit.rest.git.getRef({ owner, repo, ref });
  } catch (error) {
    if (error.status === 404) branchExists = false;
    else throw error;
  }
  if (!branchExists) {
    const { data: headRef } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${defaultBranch}` });
    await octokit.rest.git.createRef({ owner, repo, ref: `refs/${ref}`, sha: headRef.object.sha });
    console.log(`Created branch ${branchName}`);
  }

  const commitMessage = `Add prompt: ${title}\n\nCloses #${issueNumber}`;
  const base64Content = Buffer.from(fileContent, 'utf8').toString('base64');
  const existsOnBranch = await fileExists(octokit, owner, repo, contentPath, branchName);
  if (existsOnBranch) {
    const { data: existing } = await octokit.rest.repos.getContent({ owner, repo, path: contentPath, ref: branchName });
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: contentPath,
      message: commitMessage,
      content: base64Content,
      branch: branchName,
      sha: existing.sha,
    });
  } else {
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: contentPath,
      message: commitMessage,
      content: base64Content,
      branch: branchName,
    });
  }
  console.log(`Committed ${contentPath}`);

  const { data: openPRs } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: 'open',
    head: `${owner}:${branchName}`,
  });
  let pullRequest;
  if (openPRs.length > 0) {
    pullRequest = openPRs[0];
    console.log(`Reusing existing PR #${pullRequest.number}`);
  } else {
    pullRequest = (
      await octokit.rest.pulls.create({
        owner,
        repo,
        title: `Add prompt: ${title}`,
        head: branchName,
        base: defaultBranch,
        body: `Closes #${issueNumber}`,
      })
    ).data;
    console.log(`Opened PR #${pullRequest.number}`);
  }

  const comment =
    `Hi ${contributor}! Thanks for submitting **${title}**.\n\n` +
    `Your prompt has been staged for review in ${pullRequest.html_url}.`;
  await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body: comment });
  console.log('Commented on issue with PR link.');

  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { parseFormSections, findAudioAttachments, slugify, humanLabel };