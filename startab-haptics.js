(() => {
  'use strict';

  if (globalThis.StartabHaptics) return;

  const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  const coarsePointer = (() => {
    try {
      return (navigator.maxTouchPoints || 0) > 0 || window.matchMedia?.('(pointer: coarse)')?.matches;
    } catch (_) {
      return (navigator.maxTouchPoints || 0) > 0;
    }
  })();

  const lastPulseAt = new Map();
  const textureDistance = new Map();
  const pendingVibrations = new Map();
  const scheduledKeys = new Set();

  function canVibrate() {
    return supported && coarsePointer && document.visibilityState !== 'hidden';
  }

  function vibrateNow(pattern) {
    if (!canVibrate()) return false;
    try {
      return !!navigator.vibrate(pattern);
    } catch (_) {
      return false;
    }
  }

  // Haptics must never live in the hot pointer path. We only enqueue here and
  // let the browser execute the hardware vibration after the current input
  // event has finished. Repeated requests for the same effect are coalesced.
  function scheduleVibration(key, pattern) {
    if (!canVibrate()) return false;
    pendingVibrations.set(key, pattern);
    if (scheduledKeys.has(key)) return true;
    scheduledKeys.add(key);

    const run = () => {
      scheduledKeys.delete(key);
      const queued = pendingVibrations.get(key);
      pendingVibrations.delete(key);
      if (queued !== undefined) vibrateNow(queued);
    };

    // Prefer a background-priority task when Chromium exposes the Scheduling API.
    // This gives pointer/drag input priority over haptic hardware commands.
    if (globalThis.scheduler?.postTask) {
      globalThis.scheduler.postTask(run, { priority: 'background' }).catch(() => {
        window.setTimeout(run, 0);
      });
    } else {
      window.setTimeout(run, 0);
    }
    return true;
  }

  function pulse(key, duration = 6, minInterval = 42) {
    if (!canVibrate()) return false;
    const now = performance.now();
    const previous = lastPulseAt.get(key) || 0;
    if (now - previous < minInterval) return false;
    lastPulseAt.set(key, now);
    return scheduleVibration(key, Math.max(1, Math.min(35, Math.round(duration))));
  }

  function texture(key, distance, options = {}) {
    const amount = Math.abs(Number(distance) || 0);
    if (!amount || !canVibrate()) return false;
    const threshold = Math.max(1, Number(options.threshold) || 16);
    const duration = Math.max(1, Number(options.duration) || 5);
    const minInterval = Math.max(20, Number(options.minInterval) || 48);
    let accumulated = (textureDistance.get(key) || 0) + amount;
    if (accumulated < threshold) {
      textureDistance.set(key, accumulated);
      return false;
    }
    accumulated %= threshold;
    textureDistance.set(key, accumulated);
    return pulse(key, duration, minInterval);
  }

  function click(button = 'left') {
    if (button === 'right') return pulse('pointer-click-right', 18, 70);
    return pulse('pointer-click-left', 13, 60);
  }

  function mute(muted) {
    if (!canVibrate()) return false;
    const key = muted ? 'mute-on' : 'mute-off';
    const now = performance.now();
    const previous = lastPulseAt.get(key) || 0;
    if (now - previous < 90) return false;
    lastPulseAt.set(key, now);
    return scheduleVibration(key, muted ? [14, 22, 9] : [9, 18, 14]);
  }

  function resetTexture(key) {
    if (key) textureDistance.delete(key);
    else textureDistance.clear();
  }

  globalThis.StartabHaptics = Object.freeze({
    supported: supported && coarsePointer,
    pulse,
    texture,
    click,
    mute,
    resetTexture,
  });
})();
