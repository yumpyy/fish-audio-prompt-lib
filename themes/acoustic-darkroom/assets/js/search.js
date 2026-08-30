/**
 * Search.js - FlexSearch integration for Fish Audio Prompt Library
 * Handles indexing, search, filtering, and result rendering
 * Supports prefix filters: #tag, @model, lang:name/code, voice:name (alias v:)
 */

(function() {
  'use strict';

  let index = null;
  let allPrompts = [];
  let activeFilters = new Map(); // key -> Set of values

  const LANG_NAMES = {
    en: 'English',
    zh: 'Chinese',
    ja: 'Japanese',
    ko: 'Korean',
    hi: 'Hindi',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    ru: 'Russian',
    pt: 'Portuguese',
    it: 'Italian',
    ar: 'Arabic',
    tr: 'Turkish',
    nl: 'Dutch',
    pl: 'Polish',
    id: 'Indonesian',
    th: 'Thai',
    vi: 'Vietnamese'
  };
  const LANG_REVERSE = {};
  Object.entries(LANG_NAMES).forEach(([code, name]) => {
    LANG_REVERSE[name.toLowerCase()] = code;
    LANG_REVERSE[code.toLowerCase()] = code;
  });

  // DOM refs
  const grid = document.getElementById('grid-container');
  const searchInput = document.getElementById('search-input');
  const emptyState = document.getElementById('empty-state');
  const resetSearchBtn = document.getElementById('reset-search');
  let activeFiltersEl = null;
  let suggestionsEl = null;

  let allTags = [];
  let allModels = [];
  let allLangs = [];
  let allVoices = [];

  // Initialize from server-rendered cards (no JSON needed!)
  function init() {
    activeFiltersEl = document.getElementById('active-filters');
    suggestionsEl = document.getElementById('search-suggestions');
    const cards = Array.from(document.querySelectorAll('.sample-card-container'));
    allPrompts = cards.map(card => ({
      id: card.dataset.id,
      title: card.dataset.title || '',
      model: card.dataset.model || '',
      language: card.dataset.language || '',
      voice: card.dataset.voice || '',
      tags: (card.dataset.tags || '').split(',').filter(Boolean),
      nsfw: card.dataset.nsfw === 'true',
      prompt: card.dataset.prompt || '',
      duration: card.dataset.duration || '',
      url: card.dataset.url || '',
      audio: card.dataset.audio || '',
      el: card
    }));

    // Collect unique values for suggestions
    const tagSet = new Set();
    const modelSet = new Set();
    const langSet = new Set();
    const voiceSet = new Set();
    allPrompts.forEach(p => {
      p.tags.forEach(t => tagSet.add(t.trim()).add(t.trim().toLowerCase()));
      // store original case for display but also lower for matching
      if (p.model) modelSet.add(p.model);
      if (p.language) langSet.add(p.language);
      if (p.voice) voiceSet.add(p.voice.trim());
    });
    // Normalize tags to unique lower-case display (keep original lower)
    allTags = Array.from(new Set(Array.from(tagSet).map(t => t.toLowerCase()).filter(Boolean))).sort();
    // Models keep original case
    allModels = Array.from(modelSet).sort();
    allLangs = Array.from(langSet).sort();
    allVoices = Array.from(voiceSet).filter(Boolean).sort();

    buildIndex();
    bindEvents();
    render();
  }

  function buildIndex() {
    if (typeof FlexSearch === 'undefined') {
      console.warn('FlexSearch not loaded, using fallback filtering');
      return;
    }
    index = new FlexSearch.Index({
      tokenize: 'forward',
      resolution: 9,
      minlength: 2
    });

    allPrompts.forEach((p, i) => {
      const text = [p.title, p.prompt, p.tags.join(' '), p.voice].join(' ');
      index.add(i, text);
    });
  }

  function bindEvents() {
    if (searchInput) {
      searchInput.addEventListener('input', debounce(() => {
        render();
        renderSuggestions();
      }, 150));

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const applied = tryApplyPrefixFilters();
          if (applied) {
            e.preventDefault();
            render();
            renderSuggestions();
            return;
          }
          // If suggestions visible, apply top suggestion - only remove the last token, keep preceding text
          const firstSuggestion = suggestionsEl ? suggestionsEl.querySelector('[data-suggestion-filter]') : null;
          if (firstSuggestion && searchInput.value.trim()) {
            e.preventDefault();
            toggleFilter(firstSuggestion.dataset.suggestionFilter);
            const raw = searchInput.value.trim();
            const tokens = raw.split(/\s+/).filter(Boolean);
            if (tokens.length > 0) {
              tokens.pop();
              searchInput.value = tokens.length ? tokens.join(' ') + ' ' : '';
            } else {
              searchInput.value = '';
            }
            render();
            renderSuggestions();
          }
        } else if (e.key === ' ') {
          if (tryAutoAddLastTokenOnSpace()) {
            e.preventDefault();
            render();
            renderSuggestions();
          }
        } else if (e.key === 'Escape') {
          if (suggestionsEl) {
            suggestionsEl.classList.add('hidden');
            suggestionsEl.innerHTML = '';
          }
        }
      });

      // Hide suggestions on blur after a short delay (allow click)
      searchInput.addEventListener('blur', () => {
        setTimeout(() => {
          if (suggestionsEl) {
            suggestionsEl.classList.add('hidden');
          }
        }, 200);
      });
      searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim()) renderSuggestions();
      });
    }

    document.querySelectorAll('.filter-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const filter = e.currentTarget.dataset.filter;
        toggleFilter(filter);
      });
    });

    // Card capsules (tags, model, language, nsfw) act as filters
    document.querySelectorAll('.card-filter').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const filter = e.currentTarget.dataset.filter;
        if (!filter) return;
        toggleFilter(filter);
        // Scroll to top so user sees filter applied
        const searchSection = document.getElementById('search-input');
        if (searchSection) searchSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    // Active filter pills removal (delegated)
    if (activeFiltersEl) {
      activeFiltersEl.addEventListener('click', (e) => {
        const pill = e.target.closest('[data-remove-filter]');
        if (!pill) return;
        e.stopPropagation();
        const filter = pill.dataset.removeFilter;
        if (!filter) return;
        const [key, value] = splitFilter(filter);
        if (activeFilters.has(key) && activeFilters.get(key).has(value)) {
          toggleFilter(filter);
        }
      });
    }

    // Suggestion chips click - only remove the tag/prefix token, keep preceding text like "hi there"
    if (suggestionsEl) {
      suggestionsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-suggestion-filter]');
        if (!btn) return;
        e.stopPropagation();
        const filter = btn.dataset.suggestionFilter;
        if (!filter) return;
        toggleFilter(filter);
        const raw = searchInput.value.trim();
        const tokens = raw.split(/\s+/).filter(Boolean);
        if (tokens.length > 0) {
          tokens.pop();
          searchInput.value = tokens.length ? tokens.join(' ') + ' ' : '';
        } else {
          searchInput.value = '';
        }
        searchInput.focus();
        render();
        renderSuggestions();
      });
    }

    if (resetSearchBtn) {
      resetSearchBtn.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        clearAllFilters();
      });
    }

    // Search border mouse-follow effect (keep existing border color/size 1px)
    const searchWrap = document.getElementById('search-wrap');
    if (searchWrap) {
      let mouse = { x: 0, y: 0 };
      let visible = false;
      const radius = 90;
      function updateWrapBg() {
        const radial = `radial-gradient(${visible ? radius + 'px' : '0px'} circle at ${mouse.x}px ${mouse.y}px, rgba(255,255,255,0.28), transparent 80%)`;
        searchWrap.style.backgroundImage = radial;
        searchWrap.style.backgroundColor = 'rgba(255,255,255,0.06)';
      }
      searchWrap.addEventListener('mouseenter', () => { visible = true; updateWrapBg(); });
      searchWrap.addEventListener('mouseleave', () => { visible = false; updateWrapBg(); });
      searchWrap.addEventListener('mousemove', (e) => {
        const rect = searchWrap.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
        updateWrapBg();
      });
      updateWrapBg();
    }
  }

  function splitFilter(str) {
    const sep = str.indexOf(':');
    if (sep === -1) return [str, ''];
    return [str.slice(0, sep), str.slice(sep + 1)];
  }

  function tryApplyPrefixFilters() {
    if (!searchInput) return false;
    const raw = searchInput.value.trim();
    if (!raw) return false;

    let applied = false;
    let remainingTokens = [];
    // Split on spaces but keep quoted? simple split
    const tokens = raw.split(/\s+/);
    const leftover = [];

    tokens.forEach(tok => {
      let m;
      if ((m = tok.match(/^#(.+)/))) {
        const val = m[1].toLowerCase();
        if (val) {
          // Find matching tag (exact or contains)
          const match = allTags.find(t => t === val) || allTags.find(t => t.includes(val));
          const tagVal = match || val;
          toggleFilter(`tag:${tagVal}`);
          applied = true;
        }
      } else if ((m = tok.match(/^@(.+)/))) {
        const val = m[1];
        // Model may contain spaces and dots, match loosely
        const match = allModels.find(mod => mod.toLowerCase() === val.toLowerCase()) || allModels.find(mod => mod.toLowerCase().includes(val.toLowerCase()));
        const modelVal = match || val;
        toggleFilter(`model:${modelVal}`);
        applied = true;
      } else if ((m = tok.match(/^tag:(.+)/i))) {
        const val = m[1].toLowerCase();
        const match = allTags.find(t => t === val) || val;
        toggleFilter(`tag:${match}`);
        applied = true;
      } else if ((m = tok.match(/^model:(.+)/i))) {
        const val = m[1];
        const match = allModels.find(mod => mod.toLowerCase() === val.toLowerCase()) || val;
        toggleFilter(`model:${match}`);
        applied = true;
      } else if ((m = tok.match(/^lang(?:uage)?:(.+)/i))) {
        const val = m[1].toLowerCase().trim();
        const code = LANG_REVERSE[val] || val;
        // Verify code exists in known langs or map
        toggleFilter(`language:${code}`);
        applied = true;
      } else if ((m = tok.match(/^(?:voice|v):(.+)/i))) {
        const val = m[1].trim();
        if (val) {
          const match = allVoices.find(v => v.toLowerCase() === val.toLowerCase()) || allVoices.find(v => v.toLowerCase().includes(val.toLowerCase()));
          const voiceVal = match || val;
          toggleFilter(`voice:${voiceVal}`);
          applied = true;
        }
      } else {
        leftover.push(tok);
      }
    });

    if (applied) {
      searchInput.value = leftover.join(' ');
    }
    return applied;
  }

  function findFilterForToken(token) {
    const lower = token.toLowerCase();
    if (lower.startsWith('#')) {
      const term = lower.slice(1);
      if (!term) return null;
      const match = allTags.find(t => t === term) || allTags.find(t => t.includes(term));
      if (match) return `tag:${match}`;
      return `tag:${term}`;
    } else if (lower.startsWith('@')) {
      const term = lower.slice(1);
      if (!term) return null;
      const match = allModels.find(m => m.toLowerCase() === term) || allModels.find(m => m.toLowerCase().includes(term));
      if (match) return `model:${match}`;
      return `model:${term}`;
    } else if (lower.startsWith('tag:')) {
      const term = lower.slice(4);
      if (!term) return null;
      const match = allTags.find(t => t === term) || allTags.find(t => t.includes(term));
      if (match) return `tag:${match}`;
      return `tag:${term}`;
    } else if (lower.startsWith('model:')) {
      const term = lower.slice(6);
      if (!term) return null;
      const match = allModels.find(m => m.toLowerCase() === term) || allModels.find(m => m.toLowerCase().includes(term));
      if (match) return `model:${match}`;
      return `model:${term}`;
    } else if (lower.startsWith('voice:') || lower.startsWith('v:')) {
      const term = lower.replace(/^(?:voice|v):/, '').trim();
      if (!term) return null;
      const match = allVoices.find(v => v.toLowerCase() === term) || allVoices.find(v => v.toLowerCase().includes(term));
      if (match) return `voice:${match}`;
      return `voice:${term}`;
    } else if (lower.startsWith('lang:') || lower.startsWith('language:')) {
      const term = lower.replace(/^lang(?:uage)?:/, '').trim();
      if (!term) return null;
      const code = LANG_REVERSE[term] || term;
      const exact = allLangs.find(c => c.toLowerCase() === code.toLowerCase());
      if (exact) return `language:${exact}`;
      const nameMatch = allLangs.find(c => (LANG_NAMES[c] || c).toLowerCase() === term);
      if (nameMatch) return `language:${nameMatch}`;
      const includes = allLangs.find(c => c.toLowerCase().includes(term) || (LANG_NAMES[c] || '').toLowerCase().includes(term));
      if (includes) return `language:${includes}`;
      if (LANG_REVERSE[term]) return `language:${LANG_REVERSE[term]}`;
      return `language:${code}`;
    }
    return null;
  }

  function tryAutoAddLastTokenOnSpace() {
    if (!searchInput) return false;
    const raw = searchInput.value;
    const trimmed = raw.trim();
    if (!trimmed) return false;
    const tokens = trimmed.split(/\s+/);
    if (tokens.length === 0) return false;
    const last = tokens[tokens.length - 1];
    if (!/^(#|@|tag:|model:|voice:|v:|lang(?:uage)?:)/i.test(last)) return false;
    const filter = findFilterForToken(last);
    if (!filter) return false;
    toggleFilter(filter);
    const remaining = tokens.slice(0, -1).join(' ');
    searchInput.value = remaining ? remaining + ' ' : '';
    return true;
  }

  function toggleFilter(filterStr) {
    const [key, value] = splitFilter(filterStr);
    if (!key || !value) return;
    // Normalize tag to lower for storage
    const normValue = key === 'tag' ? value.toLowerCase() : value;
    const storeValue = key === 'tag' ? normValue : value;
    if (!activeFilters.has(key)) {
      activeFilters.set(key, new Set());
    }
    const set = activeFilters.get(key);
    if (set.has(storeValue)) {
      set.delete(storeValue);
      if (set.size === 0) activeFilters.delete(key);
    } else {
      set.add(storeValue);
    }
    render();
  }

  function clearAllFilters() {
    activeFilters.clear();
    render();
  }

  function syncFilterChips() {
    document.querySelectorAll('.filter-chip').forEach(chip => {
      const f = chip.dataset.filter;
      const [k, v] = splitFilter(f);
      const checkVal = k === 'tag' ? v.toLowerCase() : v;
      const isActive = activeFilters.has(k) && activeFilters.get(k).has(checkVal);
      chip.classList.toggle('active', isActive);
    });
    document.querySelectorAll('.card-filter').forEach(btn => {
      const f = btn.dataset.filter;
      if (!f) return;
      const [k, v] = splitFilter(f);
      const checkVal = k === 'tag' ? v.toLowerCase() : v;
      const isActive = activeFilters.has(k) && activeFilters.get(k).has(checkVal);
      btn.classList.toggle('!border-primary/40', isActive);
      btn.classList.toggle('!bg-white/[12%]', isActive);
      btn.classList.toggle('!text-white', isActive);
    });
  }

  function renderActiveFilters() {
    if (!activeFiltersEl) return;
    syncFilterChips();

    const hasFilters = activeFilters.size > 0;
    activeFiltersEl.classList.toggle('hidden', !hasFilters);
    if (!hasFilters) {
      activeFiltersEl.innerHTML = '';
      return;
    }

    const pills = [];
    activeFilters.forEach((values, key) => {
      values.forEach(value => {
        const filterStr = `${key}:${value}`;
        let label = value;
        if (key === 'tag') label = `#${value}`;
        else if (key === 'nsfw') label = '18+';
        else if (key === 'voice') label = `Voice: ${value}`;
        else if (key === 'language') label = LANG_NAMES[value] ? `${LANG_NAMES[value]} (${value})` : value;
        pills.push(`
          <button type="button" data-remove-filter="${escapeHtml(filterStr)}" class="group flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-white/[12%] border border-white/[14%] text-white text-[11px] font-medium hover:bg-white/[16%] hover:border-white/[22%] transition-all">
            <span>${escapeHtml(label)}</span>
            <span class="flex items-center justify-center w-4 h-4 rounded-full bg-white/[10%] group-hover:bg-white/20 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6l12 12"/></svg>
            </span>
          </button>
        `);
      });
    });

    pills.push(`
      <button type="button" id="clear-active-filters" class="text-[11px] font-medium text-on-surface-variant hover:text-white underline underline-offset-4 decoration-white/20 hover:decoration-white/40 transition-colors px-1">Clear all</button>
    `);

    activeFiltersEl.innerHTML = pills.join('');

    const clearBtn = activeFiltersEl.querySelector('#clear-active-filters');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearAllFilters();
        if (searchInput) searchInput.value = '';
      });
    }
  }

  function renderSuggestions() {
    if (!suggestionsEl || !searchInput) return;
    const raw = searchInput.value.trim();
    if (!raw) {
      suggestionsEl.classList.add('hidden');
      suggestionsEl.innerHTML = '';
      return;
    }

    // If input contains prefix tokens that are not yet applied, suggest based on last token
    // Extract last token for suggestion
    const tokens = raw.split(/\s+/);
    const lastToken = tokens[tokens.length - 1] || '';
    const queryForSuggest = lastToken;

    let suggestions = [];

    // Helper to filter and map
    const qLower = queryForSuggest.toLowerCase();

    // Handle prefix-specific suggestions
    if (qLower.startsWith('#') || qLower.startsWith('tag:')) {
      const term = qLower.replace(/^#|^tag:/, '');
      if (term) {
        allTags.forEach(tag => {
          if (tag.includes(term) && !activeFilters.get('tag')?.has(tag)) {
            suggestions.push({ label: `#${tag}`, filter: `tag:${tag}`, type: 'tag' });
          }
        });
      }
    } else if (qLower.startsWith('@') || qLower.startsWith('model:')) {
      const term = qLower.replace(/^@|^model:/, '');
      if (term) {
        allModels.forEach(mod => {
          if (mod.toLowerCase().includes(term.toLowerCase()) && !activeFilters.get('model')?.has(mod)) {
            suggestions.push({ label: mod, filter: `model:${mod}`, type: 'model' });
          }
        });
      }
    } else if (qLower.startsWith('voice:') || qLower.startsWith('v:')) {
      const term = qLower.replace(/^(?:voice|v):/, '').trim();
      if (term) {
        allVoices.forEach(voice => {
          if (voice.toLowerCase().includes(term.toLowerCase()) && !activeFilters.get('voice')?.has(voice)) {
            suggestions.push({ label: voice, filter: `voice:${voice}`, type: 'voice' });
          }
        });
      } else {
        // show all voices when just "voice:" typed
        allVoices.forEach(voice => {
          if (!activeFilters.get('voice')?.has(voice)) {
            suggestions.push({ label: voice, filter: `voice:${voice}`, type: 'voice' });
          }
        });
      }
    } else if (qLower.startsWith('lang:') || qLower.startsWith('language:')) {
      const term = qLower.replace(/^lang:|^language:/, '').trim();
      if (term) {
        // Match against both code and name
        allLangs.forEach(code => {
          const name = LANG_NAMES[code] || code;
          if (code.toLowerCase().includes(term) || name.toLowerCase().includes(term)) {
            if (!activeFilters.get('language')?.has(code)) {
              suggestions.push({ label: `${name} (${code})`, filter: `language:${code}`, type: 'lang' });
            }
          }
        });
        // Also check reverse map for name -> code
        Object.entries(LANG_REVERSE).forEach(([nameKey, code]) => {
          if (nameKey.includes(term) && !activeFilters.get('language')?.has(code) && !suggestions.some(s => s.filter === `language:${code}`)) {
            const name = LANG_NAMES[code] || code;
            suggestions.push({ label: `${name} (${code})`, filter: `language:${code}`, type: 'lang' });
          }
        });
      }
    } else {
      // Generic: match tags, models and voices that contain the query substring
      // Language suggestions require explicit lang: prefix to avoid noisy short queries like "hi"
      const generic = qLower;
      if (generic.length >= 2) {
        // Tags
        allTags.forEach(tag => {
          if (tag.includes(generic) && !activeFilters.get('tag')?.has(tag)) {
            suggestions.push({ label: `#${tag}`, filter: `tag:${tag}`, type: 'tag' });
          }
        });
        // Models
        allModels.forEach(mod => {
          if (mod.toLowerCase().includes(generic) && !activeFilters.get('model')?.has(mod)) {
            suggestions.push({ label: mod, filter: `model:${mod}`, type: 'model' });
          }
        });
        // Voices
        allVoices.forEach(voice => {
          if (voice.toLowerCase().includes(generic) && !activeFilters.get('voice')?.has(voice)) {
            suggestions.push({ label: voice, filter: `voice:${voice}`, type: 'voice' });
          }
        });
      }
    }

    // Deduplicate and limit
    const seen = new Set();
    suggestions = suggestions.filter(s => {
      if (seen.has(s.filter)) return false;
      seen.add(s.filter);
      return true;
    }).slice(0, 4);

    if (suggestions.length === 0) {
      suggestionsEl.classList.add('hidden');
      suggestionsEl.innerHTML = '';
      return;
    }

    const chips = suggestions.map(s => {
      let prefix = '';
      if (s.type === 'tag') prefix = 'Tag';
      else if (s.type === 'model') prefix = 'Model';
      else if (s.type === 'voice') prefix = 'Voice';
      else if (s.type === 'lang') prefix = 'Language';
      return `
        <button type="button" data-suggestion-filter="${escapeHtml(s.filter)}" class="flex items-center gap-1.5 pl-2.5 pr-2.5 py-1 rounded-full bg-white/[6%] border border-white/[10%] text-on-surface-variant text-[11px] hover:bg-white/[10%] hover:border-white/[14%] hover:text-white transition-all">
          <span class="text-[9px] uppercase tracking-widest opacity-60">${prefix}</span>
          <span class="font-medium text-on-surface">${escapeHtml(s.label)}</span>
          <span class="text-[10px] opacity-40">↩</span>
        </button>
      `;
    }).join('');

    suggestionsEl.innerHTML = chips;
    suggestionsEl.classList.remove('hidden');
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function getVisibleIds() {
    const queryElVal = searchInput ? searchInput.value.trim().toLowerCase() : '';
    // For text search, strip prefix tokens so they don't affect text search
    // Remove #tag, @model, lang:xx, voice:xx patterns from query for text filtering
    let query = queryElVal
      .replace(/#[^\s]+/g, '')
      .replace(/@[^\s]+(?:\s+[^\s]+)?/g, '')
      .replace(/tag:[^\s]+/gi, '')
      .replace(/model:[^\s]+(?:\s+[^\s]+)?/gi, '')
      .replace(/(?:voice|v):[^\s]+(?:\s+[^\s]+){0,3}/gi, '')
      .replace(/lang(?:uage)?:[^\s]+/gi, '')
      .trim();

    let ids = new Set(allPrompts.map((_, i) => i));

    // Text search on remaining query (also match voice so typing voice name without prefix finds it)
    if (query && index) {
      const results = index.search(query);
      ids = new Set(results);
    } else if (query) {
      ids = new Set(allPrompts.filter(p =>
        p.title.toLowerCase().includes(query) ||
        p.prompt.toLowerCase().includes(query) ||
        p.voice.toLowerCase().includes(query) ||
        p.tags.some(t => t.toLowerCase().includes(query))
      ).map((_, i) => i).filter(i => ids.has(i)));
    }

    // Filter by taxonomies
    activeFilters.forEach((values, key) => {
      ids = new Set(Array.from(ids).filter(i => {
        const p = allPrompts[i];
        if (key === 'tag') return p.tags.some(t => values.has(t) || values.has(t.toLowerCase()));
        if (key === 'model') return values.has(p.model);
        if (key === 'language') return values.has(p.language);
        if (key === 'voice') {
          // voice filter: exact match or substring (case-insensitive)
          const pv = (p.voice || '').toLowerCase();
          for (const v of values) {
            if (pv === v.toLowerCase() || pv.includes(v.toLowerCase())) return true;
          }
          return false;
        }
        if (key === 'nsfw') return p.nsfw;
        return false;
      }));
    });

    return ids;
  }

  function render() {
    const visible = getVisibleIds();
    let count = 0;

    allPrompts.forEach((p, i) => {
      const show = visible.has(i);
      p.el.style.display = show ? '' : 'none';
      if (show) count++;
    });

    if (emptyState) emptyState.classList.toggle('hidden', count > 0);
    renderActiveFilters();
  }

  function debounce(fn, ms) {
    let t;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
