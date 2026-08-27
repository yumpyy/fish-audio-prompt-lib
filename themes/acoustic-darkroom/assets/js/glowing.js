(function() {
  'use strict';

  const inactiveZone = 0.15;
  const proximity = 90;
  const spread = 28;
  const borderWidth = 1;
  const blur = 0;

  let lastPosition = { x: 0, y: 0 };
  let raf = 0;
  const cards = [];

  function init() {
    document.querySelectorAll('.glowing-card').forEach(el => {
      el.style.setProperty('--blur', `${blur}px`);
      el.style.setProperty('--spread', spread);
      el.style.setProperty('--start', '0');
      el.style.setProperty('--active', '0');
      el.style.setProperty('--glowingeffect-border-width', `${borderWidth}px`);
      el.style.setProperty('--repeating-conic-gradient-times', '5');
      cards.push(el);
    });

    if (!cards.length) return;

    document.body.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('scroll', handleScroll, { passive: true });
  }

  function handlePointerMove(e) {
    handleMove({ x: e.clientX, y: e.clientY });
  }

  function handleScroll() {
    handleMove();
  }

  function handleMove(e) {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const mouseX = e ? e.x : lastPosition.x;
      const mouseY = e ? e.y : lastPosition.y;
      if (e) lastPosition = { x: mouseX, y: mouseY };

      cards.forEach(el => {
        const rect = el.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const centerX = rect.left + width * 0.5;
        const centerY = rect.top + height * 0.5;
        const distanceFromCenter = Math.hypot(mouseX - centerX, mouseY - centerY);
        const inactiveRadius = 0.5 * Math.min(width, height) * inactiveZone;

        if (distanceFromCenter < inactiveRadius) {
          el.style.setProperty('--active', '0');
          return;
        }

        const isActive =
          mouseX > rect.left - proximity &&
          mouseX < rect.left + width + proximity &&
          mouseY > rect.top - proximity &&
          mouseY < rect.top + height + proximity;

        el.style.setProperty('--active', isActive ? '1' : '0');
        if (!isActive) return;

        const currentAngle = parseFloat(el.style.getPropertyValue('--start')) || 0;
        let targetAngle = (180 * Math.atan2(mouseY - centerY, mouseX - centerX)) / Math.PI + 90;
        const angleDiff = ((targetAngle - currentAngle + 180) % 360) - 180;
        const newAngle = currentAngle + angleDiff;

        // Simple ease without motion lib: lerp with ease
        // Use direct set for now; CSS will handle via variable
        el.style.setProperty('--start', String(newAngle));
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
