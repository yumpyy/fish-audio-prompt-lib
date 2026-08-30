#!/usr/bin/env node
/**
 * gen-waveforms.mjs — precompute waveform peaks for local prompt audio.
 *
 * Scans content/prompts/*.mp3 (or INPUT_DIR), decodes via ffmpeg to mono
 * 8kHz s16le PCM, computes N=120 max-amplitude peaks, and merges them into
 * data/waveforms.json keyed by file slug. Results are cached — existing
 * entries are not recomputed unless FORCE=1.
 *
 * Output format: { "<slug>": [0..999, ...], ... }  (ints, 0 = silence, 999 = max)
 *
 * The site falls back to in-browser fetch/decode for prompts that have no
 * entry here (e.g. audio hosted only on R2 — those get peaks computed in the
 * prompt-submission workflow and stored in frontmatter).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const N = 120;
const INPUT_DIR = process.env.INPUT_DIR || 'content/prompts';
const OUT_FILE = process.env.OUT_FILE || 'data/waveforms.json';

if (!existsSync(INPUT_DIR)) {
  console.log(`[waveforms] no input dir "${INPUT_DIR}", nothing to do`);
  process.exit(0);
}

let data = {};
if (existsSync(OUT_FILE)) {
  try { data = JSON.parse(readFileSync(OUT_FILE, 'utf8')); } catch { data = {}; }
}

let changed = false;
for (const f of readdirSync(INPUT_DIR)) {
  if (!/\.(mp3|wav|ogg|m4a|flac)$/i.test(f)) continue;
  const slug = f.replace(/\.[^.]+$/, '');
  if (data[slug] && process.env.FORCE !== '1') continue;

  try {
    // Decode to raw mono 16-bit PCM at 8kHz (~32KB/s — small pipe, fast)
    const pcm = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-i', path.join(INPUT_DIR, f), '-f', 's16le', '-ac', '1', '-ar', '8000', '-'],
      { maxBuffer: 256 * 1024 * 1024 }
    );
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
    const peaks = new Array(N).fill(0);
    const spb = Math.max(1, Math.floor(samples.length / N));
    for (let i = 0; i < N; i++) {
      let max = 0;
      const s = i * spb;
      const e = Math.min(s + spb, samples.length);
      for (let j = s; j < e; j++) {
        const a = Math.abs(samples[j]);
        if (a > max) max = a;
      }
      peaks[i] = Math.round((max / 32768) * 999);
    }
    // normalize so the loudest peak hits 999 (matches browser-side rendering)
    const mx = Math.max(...peaks);
    if (mx > 0) for (let i = 0; i < N; i++) peaks[i] = Math.round((peaks[i] / mx) * 999);

    data[slug] = peaks;
    changed = true;
    console.log(`[waveforms] peaks for ${slug}`);
  } catch (e) {
    console.warn(`[waveforms] skip ${slug}: ${e.message}`);
  }
}

if (changed) {
  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(data));
  console.log(`[waveforms] wrote ${OUT_FILE}`);
} else {
  console.log('[waveforms] no changes');
}
