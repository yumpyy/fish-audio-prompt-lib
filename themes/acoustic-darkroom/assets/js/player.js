(function() {
  'use strict';

  var currentAudio = null;
  var currentCard = null;
  var progressAnimId = null;

  /* ── Progress animation for SoundCloud-style waveform ── */

  function startProgress(audioEl, container) {
    stopProgress();
    var canvas = container ? container.querySelector('.waveform-canvas') : null;

    (function loop() {
      if (audioEl.paused || audioEl.ended) { stopProgress(); return; }
      var pct = audioEl.duration ? audioEl.currentTime / audioEl.duration : 0;
      if (window.waveform && canvas) window.waveform.updateProgress(canvas, pct);
      progressAnimId = requestAnimationFrame(loop);
    })();
  }

  function stopProgress() {
    if (progressAnimId) {
      cancelAnimationFrame(progressAnimId);
      progressAnimId = null;
    }
  }

  /* ── Grid card play buttons ── */

  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.play-toggle');
    if (!btn) return;
    e.stopPropagation();
    e.stopImmediatePropagation();

    var src = btn.dataset.audio;
    if (!src) return;

    if (currentAudio && currentAudio.src.endsWith(src) && !currentAudio.paused) {
      pauseCurrent();
      return;
    }

    stopCurrent();

    currentAudio = new Audio(src);
    currentCard = btn.closest('.sample-card-container');
    if (currentCard) currentCard.classList.add('playing');

    var playSvg = btn.querySelector('.play-icon-svg');
    var pauseSvg = btn.querySelector('.pause-icon-svg');
    if (playSvg) playSvg.classList.add('hidden');
    if (pauseSvg) pauseSvg.classList.remove('hidden');

    currentAudio.addEventListener('loadedmetadata', function() {
      startProgress(currentAudio, currentCard);
    });

    currentAudio.play();

    currentAudio.addEventListener('ended', function() { stopCurrent(); });
    currentAudio.addEventListener('error', function() {
      console.warn('Audio error:', src);
      stopCurrent();
    });
  });

  /* ── Single-page player ── */

  var spBtn = document.getElementById('play-btn');
  var spAudio = document.getElementById('audio-element');
  var spPlayIcon = document.getElementById('play-icon');
  var spPauseIcon = document.getElementById('pause-icon');
  var spCanvas = document.getElementById('single-waveform');

  if (spBtn && spAudio) {
    spBtn.addEventListener('click', function() {
      if (spAudio.paused) {
        stopCurrent();
        spAudio.play();
        // Start progress for single page
        stopProgress();
        (function loop() {
          if (spAudio.paused || spAudio.ended) {
            stopProgress();
            return;
          }
          var pct = spAudio.duration ? spAudio.currentTime / spAudio.duration : 0;
          if (window.waveform && spCanvas) window.waveform.updateProgress(spCanvas, pct);
          progressAnimId = requestAnimationFrame(loop);
        })();
        if (spPlayIcon) spPlayIcon.classList.add('hidden');
        if (spPauseIcon) spPauseIcon.classList.remove('hidden');
      } else {
        spAudio.pause();
        stopProgress();
        if (spPlayIcon) spPlayIcon.classList.remove('hidden');
        if (spPauseIcon) spPauseIcon.classList.add('hidden');
      }
    });

    spAudio.addEventListener('timeupdate', function() {
      var bar = document.getElementById('progress-bar');
      if (bar && spAudio.duration) {
        bar.style.width = ((spAudio.currentTime / spAudio.duration) * 100) + '%';
      }
    });

    spAudio.addEventListener('ended', function() {
      if (spPlayIcon) spPlayIcon.classList.remove('hidden');
      if (spPauseIcon) spPauseIcon.classList.add('hidden');
      var bar = document.getElementById('progress-bar');
      if (bar) bar.style.width = '0%';
      stopProgress();
    });
  }

  /* ── Shortcode players ── */

  document.querySelectorAll('.play-shortcode').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var el = btn.nextElementSibling;
      if (!el) return;
      if (el.paused) {
        stopCurrent();
        el.play();
        currentAudio = el;
      } else {
        el.pause();
        currentAudio = null;
      }
    });
  });

  /* ── Helpers ── */

  function pauseCurrent() {
    if (currentAudio) currentAudio.pause();
    updatePlayIcons();
  }

  function stopCurrent() {
    stopProgress();
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    if (currentCard) {
      currentCard.classList.remove('playing');
      currentCard = null;
    }
    updatePlayIcons();
  }

  function updatePlayIcons() {
    document.querySelectorAll('.play-toggle').forEach(function(btn) {
      var playSvg = btn.querySelector('.play-icon-svg');
      var pauseSvg = btn.querySelector('.pause-icon-svg');
      if (playSvg) playSvg.classList.remove('hidden');
      if (pauseSvg) pauseSvg.classList.add('hidden');
    });
  }

  var backdrop = document.getElementById('overlay-backdrop');
  if (backdrop) backdrop.addEventListener('click', stopCurrent);

  /* ── Waveform click-to-seek ── */

  document.addEventListener('click', function(e) {
    var canvas = e.target.closest('.waveform-canvas');
    if (!canvas) return;
    e.stopPropagation();

    var rect = canvas.getBoundingClientRect();
    var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    /* Single page */
    var spAudio = document.getElementById('audio-element');
    if (canvas.id === 'single-waveform' && spAudio && spAudio.duration) {
      spAudio.currentTime = pct * spAudio.duration;
      if (spAudio.paused) {
        spAudio.play();
        var spPlayIcon = document.getElementById('play-icon');
        var spPauseIcon = document.getElementById('pause-icon');
        if (spPlayIcon) spPlayIcon.classList.add('hidden');
        if (spPauseIcon) spPauseIcon.classList.remove('hidden');
        stopProgress();
        (function loop() {
          if (spAudio.paused || spAudio.ended) { stopProgress(); return; }
          var pp = spAudio.duration ? spAudio.currentTime / spAudio.duration : 0;
          if (window.waveform && canvas) window.waveform.updateProgress(canvas, pp);
          progressAnimId = requestAnimationFrame(loop);
        })();
      }
      return;
    }

    /* Grid card */
    var card = canvas.closest('.sample-card-container');
    if (!card) return;
    var src = card.dataset.audio;
    if (!src) return;

    /* Already playing this card → just seek */
    if (currentAudio && !currentAudio.paused && currentAudio.src.endsWith(src)) {
      if (currentAudio.duration) currentAudio.currentTime = pct * currentAudio.duration;
      return;
    }

    /* Start new playback at clicked position */
    stopCurrent();

    currentAudio = new Audio(src);
    currentCard = card;
    card.classList.add('playing');

    var playBtn = card.querySelector('.play-toggle');
    if (playBtn) {
      var playSvg = playBtn.querySelector('.play-icon-svg');
      var pauseSvg = playBtn.querySelector('.pause-icon-svg');
      if (playSvg) playSvg.classList.add('hidden');
      if (pauseSvg) pauseSvg.classList.remove('hidden');
    }

    currentAudio.addEventListener('loadedmetadata', function() {
      if (currentAudio.duration) currentAudio.currentTime = pct * currentAudio.duration;
      startProgress(currentAudio, card);
    });

    currentAudio.play();

    currentAudio.addEventListener('ended', function() { stopCurrent(); });
    currentAudio.addEventListener('error', function() {
      console.warn('Audio error:', src);
      stopCurrent();
    });
  });
})();

/* ── Duration probe ── */

(function() {
  document.querySelectorAll('.sample-card-container[data-audio]').forEach(function(card) {
    var src = card.dataset.audio;
    if (!src) return;
    // Always probe to ensure duration is correct; if already set from frontmatter keep it as fallback until loaded
    var p = new Audio();
    p.preload = 'metadata';
    p.addEventListener('loadedmetadata', function() {
      if (!p.duration || !isFinite(p.duration)) return;
      var m = Math.floor(p.duration / 60);
      var s = Math.floor(p.duration % 60);
      var dur = m + ':' + (s < 10 ? '0' : '') + s;
      card.dataset.duration = dur;
      var el = card.querySelector('.duration-display');
      if (el) el.textContent = dur;
    });
    p.addEventListener('error', function() {
      // keep existing frontmatter duration if any, else show em dash
      if (!card.dataset.duration) {
        var el = card.querySelector('.duration-display');
        if (el) el.textContent = '\u2014';
      }
    });
    p.src = src;
  });

  // Single page duration
  var singleAudio = document.getElementById('audio-element');
  var singleDurEl = document.getElementById('single-duration');
  if (singleAudio && singleDurEl) {
    var srcForSingle = singleAudio.getAttribute('src') || singleAudio.currentSrc;
    function setSingleDur(d) {
      if (!d || !isFinite(d)) return;
      var m = Math.floor(d / 60);
      var s = Math.floor(d % 60);
      singleDurEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }
    if (singleAudio.duration && isFinite(singleAudio.duration) && singleAudio.duration > 0) {
      setSingleDur(singleAudio.duration);
    } else {
      singleAudio.addEventListener('loadedmetadata', function() {
        setSingleDur(singleAudio.duration);
      });
      // Fallback probe via separate Audio object (helps when preload=metadata not fired)
      if (singleAudio.src) {
        var probe = new Audio();
        probe.preload = 'metadata';
        probe.addEventListener('loadedmetadata', function() { setSingleDur(probe.duration); });
        probe.addEventListener('error', function() {
          if (singleDurEl.textContent === '0:00') singleDurEl.textContent = '\u2014';
        });
        probe.src = singleAudio.src;
      }
      singleAudio.addEventListener('error', function() {
        if (singleDurEl.textContent === '0:00') singleDurEl.textContent = '\u2014';
      });
    }
  }
})();

function copyPrompt() {
  var el = document.getElementById('prompt-text');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent);
  if (window.showCopiedToast) window.showCopiedToast(el);
}
