/* ============================================================================
   StarTab · Native Media Agent 4.0
   Sólo publica sesiones que ya participaron en reproducción real o que la
   página marcó como activas mediante Media Session API. Se aproxima al modelo
   que usa Chromium para sus controles globales sin inspeccionar la UI interna.
   ============================================================================ */
(() => {
  'use strict';

  if (window.__startabMediaAgentV4) return;
  window.__startabMediaAgentV4 = true;

  const BRIDGE_STATE_EVENT = '__startab_native_media_session_state_v4__';
  const BRIDGE_COMMAND_EVENT = '__startab_native_media_session_command_v4__';
  const BRIDGE_RESULT_EVENT = '__startab_native_media_session_result_v4__';
  const MEDIA_EVENTS = [
    'play', 'playing', 'pause', 'ended', 'loadedmetadata', 'durationchange',
    'timeupdate', 'volumechange', 'ratechange', 'emptied', 'abort', 'stalled'
  ];

  const attached = new WeakSet();
  const playedMedia = new WeakSet();
  let primary = null;
  let lastActiveMedia = null;
  let frameHasBeenActive = false;
  let bridgeHasBeenActive = false;
  let emitTimer = 0;
  let heartbeatTimer = 0;
  let mutationTimer = 0;
  let lastFingerprint = '';
  let bridgeSeq = 0;
  let bridgeState = {
    playbackState: 'none',
    metadata: null,
    actions: [],
    positionState: null,
    updatedAt: 0
  };

  const safeSend = message => {
    try {
      const p = chrome.runtime.sendMessage(message);
      if (p?.catch) p.catch(() => {});
    } catch (_) {}
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  function visibleArea(el) {
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return 0;
      const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      return w * h;
    } catch (_) { return 0; }
  }

  function hasRealSource(media) {
    try {
      if (media.currentSrc || media.src) return true;
      if (media.querySelector?.('source[src]')) return true;
      if (media.readyState > 0 || Number.isFinite(Number(media.duration))) return true;
    } catch (_) {}
    return false;
  }

  function mediaScore(media) {
    if (!media) return -1;
    let score = 0;
    try {
      if (media === lastActiveMedia) score += 3000000;
      if (!media.paused && !media.ended) score += 1800000;
      if (playedMedia.has(media)) score += 800000;
      if (media.currentTime > 0.05) score += 300000;
      if (media.readyState >= 2) score += 30000;
      if (media.tagName === 'AUDIO') score += 18000;
      if (!media.muted && media.volume > 0) score += 9000;
      score += Math.min(visibleArea(media), 120000);
    } catch (_) {}
    return score;
  }

  function getMediaElements() {
    return [...document.querySelectorAll('audio, video')]
      .filter(hasRealSource)
      .sort((a, b) => mediaScore(b) - mediaScore(a));
  }

  function selectPrimary() {
    if (lastActiveMedia?.isConnected && hasRealSource(lastActiveMedia)) {
      primary = lastActiveMedia;
      return primary;
    }
    const all = getMediaElements();
    primary = all[0] || null;
    return primary;
  }

  function actionsSet() {
    return new Set(Array.isArray(bridgeState.actions) ? bridgeState.actions : []);
  }

  function bestMetadata() {
    const md = bridgeState.metadata;
    if (!md || typeof md !== 'object') return null;
    return {
      title: String(md.title || ''),
      artist: String(md.artist || ''),
      album: String(md.album || ''),
      artwork: Array.isArray(md.artwork) ? md.artwork.filter(x => x?.src) : []
    };
  }

  function queryMeta(name, attr = 'property') {
    try { return document.querySelector(`meta[${attr}="${CSS.escape(name)}"]`)?.content?.trim() || ''; }
    catch (_) { return ''; }
  }

  function bestArtwork(media, md) {
    const artwork = Array.isArray(md?.artwork) ? [...md.artwork] : [];
    artwork.sort((a, b) => {
      const px = item => parseInt(String(item?.sizes || '').split('x')[0], 10) || 0;
      return px(b) - px(a);
    });
    if (artwork[0]?.src) return artwork[0].src;
    try { if (media?.poster) return media.poster; } catch (_) {}
    return queryMeta('og:image') || queryMeta('twitter:image', 'name') || '';
  }

  function markInitialPlayback(media) {
    try {
      if (!media.paused && !media.ended) {
        playedMedia.add(media);
        lastActiveMedia = media;
        frameHasBeenActive = true;
      } else if (Number(media.currentTime) > 0.05) {
        // Útil al recargar la extensión con una pestaña ya usada.
        playedMedia.add(media);
        lastActiveMedia = media;
        frameHasBeenActive = true;
      }
    } catch (_) {}
  }

  function sessionIsEligible(media) {
    const bridgeActiveNow = bridgeState.playbackState === 'playing' ||
      Number(bridgeState.positionState?.position) > 0;
    if (bridgeActiveNow) bridgeHasBeenActive = true;

    // La lista NO incluye todo <audio>/<video> precargado de una página. Sólo
    // una sesión que ya llegó a reproducirse o una MediaSession activada.
    if (frameHasBeenActive || bridgeHasBeenActive) return true;
    try {
      if (media && (!media.paused && !media.ended)) return true;
    } catch (_) {}
    return false;
  }

  function buildState(media = selectPrimary()) {
    if (!sessionIsEligible(media)) return null;

    const md = bestMetadata();
    const actions = actionsSet();
    const position = bridgeState.positionState || null;

    let playbackState = bridgeState.playbackState === 'playing' || bridgeState.playbackState === 'paused'
      ? bridgeState.playbackState
      : 'paused';
    let currentTime = Number(position?.position) || 0;
    let duration = Number(position?.duration) || 0;
    let playbackRate = Number(position?.playbackRate) || 1;
    let volume = 1;
    let muted = false;
    let mediaKind = 'audio';
    let readyState = 0;

    if (media) {
      try {
        playbackState = media.ended ? 'ended' : (!media.paused ? 'playing' : 'paused');
        const d = Number(media.duration);
        const c = Number(media.currentTime);
        duration = Number.isFinite(d) && d > 0 ? d : duration;
        currentTime = Number.isFinite(c) && c >= 0 ? c : currentTime;
        playbackRate = Number.isFinite(Number(media.playbackRate)) ? Number(media.playbackRate) : playbackRate;
        volume = Number.isFinite(Number(media.volume)) ? clamp(media.volume, 0, 1) : 1;
        muted = !!media.muted;
        mediaKind = media.tagName?.toLowerCase() === 'video' ? 'video' : 'audio';
        readyState = Number(media.readyState) || 0;
      } catch (_) {}
    }

    const title = md?.title || queryMeta('og:title') || document.title || 'Contenido multimedia';
    const artist = md?.artist || queryMeta('music:musician') || queryMeta('author', 'name') ||
      queryMeta('og:site_name') || location.hostname.replace(/^www\./, '');

    return {
      pageUrl: location.href,
      pageTitle: document.title || '',
      host: location.hostname.replace(/^www\./, ''),
      title,
      artist,
      album: md?.album || '',
      artwork: bestArtwork(media, md),
      playbackState,
      currentTime: Math.max(0, currentTime),
      duration: Math.max(0, duration),
      playbackRate: Math.max(.1, playbackRate || 1),
      volume,
      muted,
      canSeek: (!!media && duration > 0) || actions.has('seekto'),
      canSeekBackward: (!!media && duration > 0) || actions.has('seekbackward'),
      canSeekForward: (!!media && duration > 0) || actions.has('seekforward'),
      canPrev: actions.has('previoustrack'),
      canNext: actions.has('nexttrack'),
      canVolume: !!media,
      canNativePlay: actions.has('play'),
      canNativePause: actions.has('pause'),
      transportAdapter: 'media-session-api',
      mediaKind,
      readyState,
      nativeEligible: true,
      updatedAt: Date.now()
    };
  }

  function fingerprint(state) {
    if (!state) return 'none';
    return JSON.stringify([
      state.pageUrl, state.title, state.artist, state.album, state.artwork,
      state.playbackState, Math.floor(state.currentTime * 2) / 2, state.duration,
      state.playbackRate, state.volume, state.muted, state.canSeek,
      state.canSeekBackward, state.canSeekForward, state.canPrev, state.canNext,
      state.canVolume, state.transportAdapter
    ]);
  }

  function emitNow(force = false) {
    clearTimeout(emitTimer);
    emitTimer = 0;
    const state = buildState();
    const fp = fingerprint(state);
    if (!force && fp === lastFingerprint) return;
    lastFingerprint = fp;
    if (!state) {
      safeSend({ type: 'STARTAB_MEDIA_REMOVE_FRAME' });
      return;
    }
    safeSend({ type: 'STARTAB_MEDIA_STATE', payload: state });
  }

  function scheduleEmit(delay = 40, force = false) {
    clearTimeout(emitTimer);
    emitTimer = window.setTimeout(() => emitNow(force), delay);
  }

  function attachMedia(media) {
    if (!media || attached.has(media)) return;
    attached.add(media);
    markInitialPlayback(media);
    for (const eventName of MEDIA_EVENTS) {
      media.addEventListener(eventName, () => {
        if (eventName === 'play' || eventName === 'playing') {
          playedMedia.add(media);
          lastActiveMedia = media;
          frameHasBeenActive = true;
        }
        if (playedMedia.has(media)) lastActiveMedia = media;
        scheduleEmit(eventName === 'timeupdate' ? 70 : 10, eventName !== 'timeupdate');
      }, { passive: true });
    }
  }

  function scanMedia(force = false) {
    const media = [...document.querySelectorAll('audio, video')];
    media.forEach(attachMedia);
    selectPrimary();
    scheduleEmit(10, force);
  }

  function scheduleScan() {
    clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => scanMedia(false), 60);
  }

  function invokeBridge(action, details = {}) {
    return new Promise(resolve => {
      const id = `m${Date.now().toString(36)}_${(++bridgeSeq).toString(36)}`;
      let timer = 0;
      const onResult = event => {
        let result;
        try { result = JSON.parse(String(event?.detail || '{}')); } catch (_) { return; }
        if (result?.id !== id) return;
        document.removeEventListener(BRIDGE_RESULT_EVENT, onResult, true);
        clearTimeout(timer);
        resolve(result);
      };
      document.addEventListener(BRIDGE_RESULT_EVENT, onResult, true);
      timer = window.setTimeout(() => {
        document.removeEventListener(BRIDGE_RESULT_EVENT, onResult, true);
        resolve({ ok: false, reason: 'native-action-timeout' });
      }, 850);
      try {
        document.dispatchEvent(new CustomEvent(BRIDGE_COMMAND_EVENT, {
          detail: JSON.stringify({ id, action, details })
        }));
      } catch (_) {
        clearTimeout(timer);
        document.removeEventListener(BRIDGE_RESULT_EVENT, onResult, true);
        resolve({ ok: false, reason: 'native-bridge-unavailable' });
      }
    });
  }

  async function executeCommand(command) {
    const media = selectPrimary();
    const currentState = buildState(media);
    if (!currentState) return { ok: false, reason: 'native-media-session-not-found' };

    const actions = actionsSet();
    try {
      switch (command?.action) {
        case 'toggle': {
          if (media) {
            if (media.paused || media.ended) {
              const promise = media.play();
              if (promise?.then) await promise;
            } else {
              media.pause();
            }
          } else {
            const action = currentState.playbackState === 'playing' ? 'pause' : 'play';
            if (!actions.has(action)) return { ok: false, reason: 'native-playback-action-not-available' };
            const result = await invokeBridge(action);
            if (!result.ok) return result;
          }
          break;
        }
        case 'seek': {
          const value = Math.max(0, Number(command.value) || 0);
          if (media && Number.isFinite(Number(media.duration)) && Number(media.duration) > 0) {
            media.currentTime = clamp(value, 0, Number(media.duration));
          } else if (actions.has('seekto')) {
            const result = await invokeBridge('seekto', { seekTime: value, fastSeek: false });
            if (!result.ok) return result;
          } else return { ok: false, reason: 'seek-not-supported' };
          break;
        }
        case 'seekBy': {
          const delta = Number(command.value) || 0;
          if (media && Number.isFinite(Number(media.duration)) && Number(media.duration) > 0) {
            media.currentTime = clamp(Number(media.currentTime || 0) + delta, 0, Number(media.duration));
          } else {
            const action = delta < 0 ? 'seekbackward' : 'seekforward';
            if (!actions.has(action)) return { ok: false, reason: 'seek-not-supported' };
            const details = delta < 0 ? { seekOffset: Math.abs(delta) } : { seekOffset: delta };
            const result = await invokeBridge(action, details);
            if (!result.ok) return result;
          }
          break;
        }
        case 'volume': {
          if (!media) return { ok: false, reason: 'volume-not-supported' };
          const value = clamp(Number(command.value), 0, 1);
          media.volume = value;
          media.muted = value <= 0.0001;
          break;
        }
        case 'prev': {
          if (!actions.has('previoustrack')) return { ok: false, reason: 'track-navigation-not-supported' };
          const result = await invokeBridge('previoustrack');
          if (!result.ok) return result;
          break;
        }
        case 'next': {
          if (!actions.has('nexttrack')) return { ok: false, reason: 'track-navigation-not-supported' };
          const result = await invokeBridge('nexttrack');
          if (!result.ok) return result;
          break;
        }
        default:
          return { ok: false, reason: 'unknown-command' };
      }
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) };
    }

    // Permite que el elemento o el handler nativo actualice primero su estado.
    await new Promise(resolve => setTimeout(resolve, 0));
    const stateAfterCommand = buildState(selectPrimary());
    scheduleEmit(15, true);
    window.setTimeout(() => scheduleEmit(0, true), 160);
    window.setTimeout(() => scheduleEmit(0, true), 650);
    return { ok: true, state: stateAfterCommand };
  }

  document.addEventListener(BRIDGE_STATE_EVENT, event => {
    try {
      const next = JSON.parse(String(event?.detail || '{}'));
      if (next && typeof next === 'object') {
        bridgeState = {
          playbackState: ['playing', 'paused', 'none'].includes(next.playbackState) ? next.playbackState : 'none',
          metadata: next.metadata && typeof next.metadata === 'object' ? next.metadata : null,
          actions: Array.isArray(next.actions) ? next.actions.map(String) : [],
          positionState: next.positionState && typeof next.positionState === 'object' ? next.positionState : null,
          updatedAt: Number(next.updatedAt) || Date.now()
        };
        if (bridgeState.playbackState === 'playing' || Number(bridgeState.positionState?.position) > 0) {
          bridgeHasBeenActive = true;
        }
        scheduleEmit(10, true);
      }
    } catch (_) {}
  }, true);

  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'STARTAB_MEDIA_COMMAND') return;
      executeCommand(message.command).then(sendResponse).catch(error => {
        sendResponse({ ok: false, reason: String(error?.message || error) });
      });
      return true;
    });
  } catch (_) {}

  const observer = new MutationObserver(scheduleScan);
  try {
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
  } catch (_) {}

  document.addEventListener('visibilitychange', () => scheduleEmit(30, true), { passive: true });
  window.addEventListener('pageshow', () => scanMedia(true), { passive: true });
  window.addEventListener('pagehide', () => safeSend({ type: 'STARTAB_MEDIA_REMOVE_FRAME' }), { passive: true });

  heartbeatTimer = window.setInterval(() => {
    const media = selectPrimary();
    if (!sessionIsEligible(media)) {
      emitNow(false);
      return;
    }
    emitNow(media ? (!media.paused && !media.ended) : bridgeState.playbackState === 'playing');
  }, 900);

  scanMedia(true);
})();
