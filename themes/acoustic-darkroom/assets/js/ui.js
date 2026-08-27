/**
 * ui.js - Card click interactions with inline detail card expansion
 * Exact replica of the reference interaction model:
 * - Click card body -> toggle .active on .sample-card-container + body.dimmed
 * - Click play button -> plays audio, does NOT toggle detail
 * - Click close button or outside -> close all active cards
 */

(function() {
  'use strict';

  const body = document.body;

  function init() {
    const containers = document.querySelectorAll('.sample-card-container');

    containers.forEach(container => {
      const originalCard = container.querySelector('.original-card');
      const detailCard = container.querySelector('.detail-card');
      const closeBtn = container.querySelector('.close-card-btn');

      if (originalCard) {
        originalCard.addEventListener('click', (e) => {
          if (e.target.closest('.play-toggle') || e.target.closest('.waveform-canvas') || e.target.closest('[data-filter]') || e.target.closest('a')) return;
          e.stopPropagation();
          const isActive = container.classList.contains('active');
          closeAllCards();
          if (!isActive) {
            container.classList.add('active');
            body.classList.add('dimmed');
          }
        });
      }

      // Prevent clicks inside detail card from closing
      if (detailCard) {
        detailCard.addEventListener('click', (e) => {
          e.stopPropagation();
        });
      }

      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeAllCards();
        });
      }

      // Click to copy prompt text (legacy word-span popup)
      const promptText = container.querySelector('.prompt-text');
      if (promptText) {
        promptText.addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(promptText.textContent.trim());
          showCopiedToast(e.target);
        });
      }
      // New popup: full prompt block + Copy button
      const fullPrompt = container.querySelector('.prompt-full-text');
      if (fullPrompt) {
        fullPrompt.addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(fullPrompt.textContent.trim());
          showCopiedToast(fullPrompt);
        });
      }
      const copyBtn = container.querySelector('.copy-detail-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const text = copyBtn.dataset.copy || (fullPrompt ? fullPrompt.textContent.trim() : '');
          if (!text) return;
          navigator.clipboard.writeText(text);
          showCopiedToast(copyBtn);
        });
      }
    });

    // Help drawer
    const helpDrawer = document.getElementById('help-drawer');
    const helpBackdrop = document.getElementById('help-backdrop');
    const openHelpBtn = document.getElementById('open-help');
    const closeHelpBtn = document.getElementById('help-close');
    const scrollMorePill = document.getElementById('scroll-more-pill');
    function showScrollPill() {
      if (scrollMorePill) scrollMorePill.classList.remove('is-hidden');
    }
    function hideScrollPill() {
      if (scrollMorePill && !scrollMorePill.classList.contains('is-hidden')) {
        scrollMorePill.classList.add('is-hidden');
      }
    }

    function openHelp() {
      if (!helpDrawer || !helpBackdrop) return;
      helpDrawer.classList.add('is-open');
      helpDrawer.setAttribute('aria-hidden', 'false');
      helpBackdrop.classList.remove('hidden');
      // force reflow before opacity transition
      void helpBackdrop.offsetWidth;
      helpBackdrop.classList.add('is-open');
      body.classList.add('help-open');
      if (closeHelpBtn) closeHelpBtn.focus();
      // show floating scroll hint (laptop only via CSS)
      if (scrollMorePill) scrollMorePill.classList.remove('is-hidden');
    }
    function closeHelp() {
      if (!helpDrawer || !helpBackdrop) return;
      helpDrawer.classList.remove('is-open');
      helpDrawer.setAttribute('aria-hidden', 'true');
      helpBackdrop.classList.remove('is-open');
      body.classList.remove('help-open');
      setTimeout(() => helpBackdrop.classList.add('hidden'), 300);
      if (openHelpBtn) openHelpBtn.focus();
    }
    if (openHelpBtn) openHelpBtn.addEventListener('click', (e) => { e.stopPropagation(); openHelp(); });
    if (closeHelpBtn) closeHelpBtn.addEventListener('click', (e) => { e.stopPropagation(); closeHelp(); });
    if (helpBackdrop) helpBackdrop.addEventListener('click', closeHelp);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && helpDrawer && helpDrawer.classList.contains('is-open')) {
        closeHelp();
      }
    });
    // Scroll hint: floating circle, disappears on any click or scroll
    document.addEventListener('click', (e) => {
      if (!helpDrawer || !helpDrawer.classList.contains('is-open')) return;
      if (!scrollMorePill || scrollMorePill.classList.contains('is-hidden')) return;
      if (e.target.closest('#open-help')) return;
      hideScrollPill();
    });
    const helpContent = helpDrawer ? helpDrawer.querySelector('.overflow-y-auto') : null;
    if (helpContent) {
      helpContent.addEventListener('scroll', hideScrollPill, { passive: true });
    }
    if (scrollMorePill) {
      scrollMorePill.addEventListener('click', (e) => {
        e.stopPropagation();
        hideScrollPill();
      });
    }

    // Click outside closes
    document.addEventListener('click', (e) => {
      if (body.classList.contains('dimmed')) {
        closeAllCards();
      }
    });
  }

  function closeAllCards() {
    document.querySelectorAll('.sample-card-container.active').forEach(c => {
      c.classList.remove('active');
      // Reset prompt animation spans
      const spans = c.querySelectorAll('.prompt-text span');
      spans.forEach(span => {
        span.style.animationName = 'none';
        setTimeout(() => span.style.animationName = '', 50);
      });
    });
    body.classList.remove('dimmed');
  }

  function showCopiedToast(anchor) {
    var existing = document.querySelector('.copied-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'copied-toast';
    toast.textContent = 'Copied!';
    document.body.appendChild(toast);

    var rect = anchor.getBoundingClientRect();
    var tw = toast.offsetWidth;
    toast.style.left = Math.round(rect.left + rect.width / 2 - tw / 2) + 'px';
    toast.style.top = Math.round(rect.top - 28) + 'px';

    setTimeout(function() {
      toast.classList.add('fade-out');
      setTimeout(function() { toast.remove(); }, 300);
    }, 800);
  }

  window.showCopiedToast = showCopiedToast;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
