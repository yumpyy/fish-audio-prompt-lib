/**
 * ui.js - Card click interactions with popup detail
 * - Click card body -> toggle .active on .sample-card-container + body.dimmed
 * - Popup is absolute inside container, positioned left/right/below to avoid edge clipping
 * - Landscape: left rail 168px + recipe remaining width
 * - Tags at bottom of prompt section (right column)
 */

(function() {
  'use strict';

  const body = document.body;

  function positionDetail(container) {
    const detail = container.querySelector('.detail-card');
    if (!detail) return;
    const vw = window.innerWidth;
    // Mobile: always below
    if (vw < 768) {
      detail.classList.remove('pos-left', 'pos-right');
      detail.classList.add('pos-below');
      return;
    }
    const rect = container.getBoundingClientRect();
    const popupW = 520;
    const gap = 16;
    const spaceRight = vw - rect.right;
    const spaceLeft = rect.left;
    // If not enough space on right and more space on left, show on left
    if (spaceRight < popupW + gap && spaceLeft > spaceRight) {
      detail.classList.remove('pos-right', 'pos-below');
      detail.classList.add('pos-left');
    } else if (spaceRight >= popupW + gap) {
      detail.classList.remove('pos-left', 'pos-below');
      detail.classList.add('pos-right');
    } else if (spaceLeft >= popupW + gap) {
      detail.classList.remove('pos-right', 'pos-below');
      detail.classList.add('pos-left');
    } else {
      // fallback below if neither side fits (very narrow viewport)
      detail.classList.remove('pos-left', 'pos-right');
      detail.classList.add('pos-below');
    }
  }

  function closeAllCards() {
    document.querySelectorAll('.sample-card-container.active').forEach(c => {
      c.classList.remove('active');
      const detail = c.querySelector('.detail-card');
      if (detail) {
        detail.classList.remove('pos-left', 'pos-right', 'pos-below');
      }
      const spans = c.querySelectorAll('.prompt-text span');
      spans.forEach(span => {
        span.style.animationName = 'none';
        setTimeout(() => span.style.animationName = '', 50);
      });
    });
    body.classList.remove('dimmed');
  }

  function init() {
    const containers = document.querySelectorAll('.sample-card-container');

    // ensure all prompt windows start at top (not last section)
    document.querySelectorAll('.prompt-scroll').forEach(el => { el.scrollTop = 0; });

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
            positionDetail(container);
            container.classList.add('active');
            body.classList.add('dimmed');
            // ensure prompt starts at top (not last section)
            if (detailCard) {
              const scroller = detailCard.querySelector('.prompt-scroll');
              if (scroller) scroller.scrollTop = 0;
              // also reset any inner prompt text scroll
              const promptText = detailCard.querySelector('.prompt-text');
              if (promptText) promptText.scrollTop = 0;
              void detailCard.offsetWidth;
            }
            // if detail would be offscreen vertically, scroll into view
            requestAnimationFrame(() => {
              if (detailCard) {
                const scroller = detailCard.querySelector('.prompt-scroll');
                if (scroller) scroller.scrollTop = 0;
                const rect = detailCard.getBoundingClientRect();
                if (rect.bottom > window.innerHeight - 16 || rect.top < 0) {
                  // for side popup, scroll container into view; for below, scroll detail
                  const target = rect.bottom > window.innerHeight ? detailCard : container;
                  target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
              }
            });
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

      // Click to copy prompt text (inside detail)
      const promptText = container.querySelector('.detail-card .prompt-text');
      if (promptText) {
        promptText.addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(promptText.textContent.trim());
          showCopiedToast(e.target.closest('span') || promptText);
        });
      }
      const copyBtns = container.querySelectorAll('.copy-detail-btn');
      copyBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const text = btn.dataset.copy || (container.querySelector('.detail-card .prompt-text') ? container.querySelector('.detail-card .prompt-text').textContent.trim() : '');
          if (!text) return;
          navigator.clipboard.writeText(text);
          showCopiedToast(btn);
        });
      });
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
      void helpBackdrop.offsetWidth;
      helpBackdrop.classList.add('is-open');
      body.classList.add('help-open');
      if (closeHelpBtn) closeHelpBtn.focus();
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
      if (e.key === 'Escape') {
        if (helpDrawer && helpDrawer.classList.contains('is-open')) {
          closeHelp();
        } else if (document.querySelector('.sample-card-container.active')) {
          closeAllCards();
        }
      }
    });
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

    // Click outside closes detail
    document.addEventListener('click', (e) => {
      if (body.classList.contains('dimmed')) {
        if (e.target.closest('.detail-card') || e.target.closest('.sample-card-container.active')) return;
        closeAllCards();
      }
    });

    // Re-position on resize (if open)
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const active = document.querySelector('.sample-card-container.active');
        if (active) positionDetail(active);
      }, 100);
    });

    // When search filters hide/show cards, close detail if source hidden
    const grid = document.getElementById('grid-container');
    if (grid) {
      const observer = new MutationObserver(() => {
        const active = document.querySelector('.sample-card-container.active');
        if (active && (active.style.display === 'none' || active.offsetParent === null)) {
          closeAllCards();
        }
      });
      observer.observe(grid, { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
    }
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
  window.closeAllCards = closeAllCards;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
