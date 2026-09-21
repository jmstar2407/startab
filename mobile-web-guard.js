(() => {
  'use strict';

  const viewport = document.querySelector('meta[name="viewport"]');
  if (!viewport) return;

  const mobileQuery = window.matchMedia('(max-width: 760px), (pointer: coarse)');
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  const isMobile = () => mobileQuery.matches || mobileUA;

  function applyViewportPolicy() {
    viewport.setAttribute(
      'content',
      isMobile()
        ? 'width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover'
        : 'width=device-width, initial-scale=1.0'
    );
    document.documentElement.classList.toggle('startab-mobile-no-zoom', isMobile());
  }

  applyViewportPolicy();
  mobileQuery.addEventListener?.('change', applyViewportPolicy);
  window.addEventListener('orientationchange', applyViewportPolicy, { passive: true });

  // iOS/Safari can ignore user-scalable=no for accessibility reasons. These
  // gesture handlers make the StarTab web surface deterministic on mobile
  // without disabling normal one-finger scrolling.
  for (const eventName of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(eventName, (event) => {
      if (isMobile()) event.preventDefault();
    }, { passive: false });
  }

  document.addEventListener('touchmove', (event) => {
    if (isMobile() && event.touches && event.touches.length > 1) event.preventDefault();
  }, { passive: false });
})();
