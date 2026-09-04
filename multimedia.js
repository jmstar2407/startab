/* ============================================================================
   StarTab · Media Hub 6.0 · Extension + Web Remote
   UI de nueva pestaña conectada al registro multimedia global del service worker.
   Todas las instancias de StarTab comparten exactamente el mismo estado.
   ============================================================================ */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  // StarTab puede ejecutarse como extensión de Chrome o como web normal.
  // En modo extensión existe acceso al registro multimedia local y el dispositivo
  // puede convertirse en principal. En modo web NO tocamos APIs chrome.*: la
  // interfaz funciona exclusivamente como panel remoto conectado a Firestore.
  const extensionApi = (() => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.runtime?.id && typeof chrome.runtime.sendMessage === 'function') return chrome;
    } catch (_) {}
    try {
      if (typeof browser !== 'undefined' && browser?.runtime?.id && typeof browser.runtime.sendMessage === 'function') return browser;
    } catch (_) {}
    return null;
  })();
  const isExtensionRuntime = !!extensionApi;

  const mediaDeviceId = (() => {
    const key = 'startab_media_remote_device_id_v1';
    try {
      const saved = localStorage.getItem(key);
      if (saved) return saved;
      const created = globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, created);
      return created;
    } catch (_) {
      return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  })();

  const mediaInstanceId = globalThis.crypto?.randomUUID?.() || `instance-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function mediaDeviceLabel() {
    const ua = String(navigator.userAgent || '');
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Android/i.test(ua)) return 'Android';
    if (/Windows/i.test(ua)) return 'PC con Windows';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Dispositivo StarTab';
  }

  const state = {
    sessions: new Map(),
    selectedKey: null,
    // El orden visual se conserva por tabId. Reproducir/pausar NUNCA reordena
    // la lista; una sesión activa sólo cambia su resaltado.
    sourceOrder: [],
    modalOpen: false,
    userSeeking: false,
    progressRaf: 0,
    volumeTimer: 0,
    controlPending: false,
    layoutRaf: 0,
    registryOrigin: 'local',
    localRawSessions: [],
    runtimeOnline: true,
    remote: {
      uid: null,
      refs: null,
      unsubs: [],
      principal: null,
      principalOnline: false,
      isPrincipal: false,
      viewingRemote: false,
      remoteRawSessions: [],
      firebaseConnected: false,
      firebaseError: '',
      busy: false,
      isLeader: false,
      leaderRequesting: false,
      releaseLeader: null,
      publishTimer: 0,
      lastPublishedFingerprint: '',
      lastPublishedSessions: [],
      lastPublishedAt: 0,
      lastCommandId: (() => {
        try { return localStorage.getItem('startab_media_remote_last_command_v1') || ''; } catch (_) { return ''; }
      })()
    }
  };

  const dom = {
    button: $('multimedia-button'),
    tooltip: $('multimedia-tooltip'),
    badge: $('multimedia-badge'),
    modal: $('multimedia-modal'),
    backdrop: $('multimedia-backdrop'),
    close: $('multimedia-close'),
    sourceList: $('multimedia-source-list'),
    empty: $('multimedia-empty'),
    emptyTitle: document.querySelector('#multimedia-empty h4'),
    emptyCopy: document.querySelector('#multimedia-empty p'),
    player: $('multimedia-player'),
    artwork: $('multimedia-artwork'),
    artworkFallback: $('multimedia-artwork-fallback'),
    title: $('multimedia-title'),
    artist: $('multimedia-artist'),
    site: $('multimedia-site'),
    favicon: $('multimedia-favicon'),
    play: $('multimedia-play'),
    prev: $('multimedia-prev'),
    next: $('multimedia-next'),
    back10: $('multimedia-back10'),
    forward10: $('multimedia-forward10'),
    seek: $('multimedia-seek'),
    seekFill: $('multimedia-seek-fill'),
    current: $('multimedia-current'),
    duration: $('multimedia-duration'),
    volume: $('multimedia-volume'),
    volumeFill: $('multimedia-volume-fill'),
    volumeValue: $('multimedia-volume-value'),
    volumeIcon: $('multimedia-volume-icon'),
    unavailable: $('multimedia-unavailable'),
    openTab: $('multimedia-open-tab'),
    syncPill: $('multimedia-sync-pill'),
    syncText: $('multimedia-sync-text'),
    principalToggle: $('multimedia-principal-toggle'),
    principalText: $('multimedia-principal-text'),
    playbackBadge: $('multimedia-playback-badge'),
    main: document.querySelector('#multimedia-modal .multimedia-main'),
    topbar: document.querySelector('#multimedia-modal .multimedia-topbar'),
    topbarTitle: document.querySelector('#multimedia-modal .multimedia-topbar-copy strong'),
    topbarSubtitle: document.querySelector('#multimedia-modal .multimedia-topbar-copy span')
  };

  if (!dom.button || !dom.modal) return;
  document.documentElement.dataset.startabMediaMode = isExtensionRuntime ? 'extension' : 'web';
  dom.modal.dataset.mode = isExtensionRuntime ? 'extension' : 'web';

  const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
  const formatTime = seconds => {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n < 0) return '0:00';
    const total = Math.floor(n);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };

  function safeRuntimeMessage(message) {
    if (!isExtensionRuntime) return Promise.reject(new Error('extension-runtime-unavailable'));
    try {
      return extensionApi.runtime.sendMessage(message);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function sessionKey(session) {
    return session?.key || `${session?.tabId ?? 'x'}:${session?.frameId ?? 0}`;
  }

  function playbackScore(session) {
    let score = 0;
    if (session.playbackState === 'playing') score += 1000000;
    if (session.playbackState === 'paused') score += 300000;
    if (session.currentTime > 0.05) score += 100000;
    if (session.frameId === 0) score += 1000;
    score += Number(session.updatedAt) || 0;
    return score;
  }

  // Una página puede tener reproductores en iframes. Para no duplicarla en la
  // lista, mostramos la sesión más relevante de cada pestaña, pero conservamos
  // el frameId real para enviar los controles al reproductor correcto.
  function normalizeSessions(rawSessions) {
    const byTab = new Map();
    for (const raw of Array.isArray(rawSessions) ? rawSessions : []) {
      if (!raw || !Number.isInteger(raw.tabId) || raw.nativeEligible === false) continue;
      const session = { ...raw, key: sessionKey(raw) };
      const current = byTab.get(session.tabId);
      if (!current || playbackScore(session) > playbackScore(current)) byTab.set(session.tabId, session);
    }
    return [...byTab.values()];
  }

  function applyRegistry(rawSessions, origin = 'local') {
    if (state.registryOrigin !== origin) {
      state.registryOrigin = origin;
      state.sourceOrder = [];
      state.selectedKey = null;
    }
    const sessions = normalizeSessions(rawSessions);
    const previousSelected = getSelected();
    const previousSelectedTabId = previousSelected?.tabId ?? null;

    // Mantener una posición estable por pestaña. Las sesiones existentes
    // conservan exactamente su lugar aunque cambien entre PLAY/PAUSE.
    const liveTabIds = new Set(sessions.map(session => session.tabId));
    state.sourceOrder = state.sourceOrder.filter(tabId => liveTabIds.has(tabId));

    const newcomers = sessions
      .filter(session => !state.sourceOrder.includes(session.tabId))
      .sort((a, b) => {
        const af = Number(a.firstSeenAt) || Number(a.updatedAt) || 0;
        const bf = Number(b.firstSeenAt) || Number(b.updatedAt) || 0;
        return af - bf || a.tabId - b.tabId;
      });
    for (const session of newcomers) state.sourceOrder.push(session.tabId);

    const next = new Map(sessions.map(s => [s.key, s]));
    state.sessions = next;

    // Si el frame representativo de una pestaña cambió, mantener seleccionada
    // esa misma pestaña en vez de saltar automáticamente a la que esté sonando.
    if (previousSelectedTabId != null) {
      const replacement = sessions.find(session => session.tabId === previousSelectedTabId);
      if (replacement) state.selectedKey = replacement.key;
    }

    if (!state.selectedKey || !next.has(state.selectedKey)) {
      const firstTabId = state.sourceOrder.find(tabId => liveTabIds.has(tabId));
      const first = sessions.find(session => session.tabId === firstTabId) || sessions[0];
      state.selectedKey = first?.key || null;
    }

    renderAll();
  }

  async function loadRegistry() {
    // La web normal no posee un registro local de pestañas. Su fuente de verdad
    // es Firestore y por eso nunca debe fallar el modal por ausencia de chrome.*.
    if (!isExtensionRuntime) {
      setSyncState(true);
      if (state.remote.viewingRemote) applyRemoteSessionsIfNeeded();
      else if (state.registryOrigin !== 'web') applyRegistry([], 'web');
      return;
    }
    try {
      const response = await safeRuntimeMessage({ type: 'STARTAB_MEDIA_GET_REGISTRY' });
      if (response?.ok) {
        state.localRawSessions = response.sessions || [];
        if (!state.remote.viewingRemote) applyRegistry(state.localRawSessions, 'local');
        if (state.remote.isPrincipal) schedulePrincipalStatePublish(false);
      }
      setSyncState(true);
    } catch (_) {
      setSyncState(false);
    }
  }

  function setSyncState(online) {
    state.runtimeOnline = !!online;
    renderRemoteRole();
  }

  function firebaseRemoteReady() {
    try {
      return typeof db !== 'undefined' && !!db && typeof currentUser !== 'undefined' && !!currentUser?.uid;
    } catch (_) {
      return false;
    }
  }

  function principalIsFresh(principal = state.remote.principal) {
    if (!principal?.active || !principal?.deviceId) return false;
    const stamp = Number(principal.clientAt) || 0;
    // El heartbeat es deliberadamente relajado para tolerar throttling de pestañas
    // en segundo plano sin marcar falsos offline.
    return !stamp || (Date.now() - stamp) < 90000;
  }

  function renderRemoteRole() {
    const remote = state.remote;
    const loggedIn = firebaseRemoteReady();
    remote.principalOnline = principalIsFresh(remote.principal);
    const remoteView = remote.viewingRemote && !remote.isPrincipal;
    const canBecomePrincipal = loggedIn && isExtensionRuntime;

    if (dom.principalToggle) {
      dom.principalToggle.disabled = remote.busy || !canBecomePrincipal;
      dom.principalToggle.classList.toggle('is-principal', remote.isPrincipal);
      dom.principalToggle.classList.toggle('is-remote', remoteView);
      dom.principalToggle.classList.toggle('is-web-remote', !isExtensionRuntime);
      dom.principalToggle.setAttribute('aria-pressed', remote.isPrincipal ? 'true' : 'false');
      if (dom.principalText) {
        dom.principalText.textContent = isExtensionRuntime
          ? (remote.isPrincipal ? 'Dispositivo principal' : remoteView ? 'Controlando principal' : 'Hacer principal')
          : (!loggedIn ? 'Inicia sesión' : remoteView ? 'Controlando principal' : 'Panel remoto');
      }
      dom.principalToggle.title = !loggedIn
        ? 'Inicia sesión en StarTab para ver y controlar tu dispositivo principal'
        : !isExtensionRuntime
          ? (remoteView
              ? `Panel remoto conectado a ${remote.principal?.deviceLabel || 'tu dispositivo principal'}`
              : 'Este StarTab está abierto como web: funciona como panel remoto. El dispositivo principal debe ser StarTab ejecutándose como extensión.')
          : remote.isPrincipal
            ? 'Este navegador es el dispositivo principal. Pulsa para desactivarlo.'
            : remoteView
              ? `Control remoto de ${remote.principal?.deviceLabel || 'otro dispositivo'}. Pulsa para convertir este dispositivo en principal.`
              : 'Convertir este navegador en el dispositivo principal';
    }

    if (dom.topbarTitle) {
      dom.topbarTitle.textContent = isExtensionRuntime
        ? 'Control multimedia del navegador'
        : 'Control remoto del dispositivo principal';
    }
    if (dom.topbarSubtitle) {
      dom.topbarSubtitle.textContent = !isExtensionRuntime
        ? (!loggedIn
            ? 'Inicia sesión para enlazar este panel con tu StarTab principal'
            : remoteView
              ? `Conectado en tiempo real a ${remote.principal?.deviceLabel || 'tu dispositivo principal'}`
              : 'Esperando un StarTab principal conectado con esta misma cuenta')
        : 'Estado y controles sincronizados en tiempo real';
    }

    if (dom.syncPill) {
      let online = true;
      let label = 'SYNC GLOBAL';
      if (!loggedIn) {
        online = false;
        label = 'SIN SESIÓN';
      } else if (!isExtensionRuntime) {
        if (remoteView) {
          online = remote.principalOnline && remote.firebaseConnected;
          label = online ? 'REMOTE · CLOUD' : 'PRINCIPAL OFFLINE';
        } else {
          online = remote.firebaseConnected;
          label = online ? 'ESPERANDO PC' : 'CONECTANDO';
        }
      } else {
        online = state.runtimeOnline && (!remoteView || remote.principalOnline);
        label = !online
          ? (remoteView ? 'PRINCIPAL OFFLINE' : 'RECONECTANDO')
          : remote.isPrincipal
            ? 'PRINCIPAL · CLOUD'
            : remoteView
              ? 'CONTROL REMOTO'
              : remote.firebaseConnected
                ? 'SYNC CLOUD'
                : 'SYNC GLOBAL';
      }
      dom.syncPill.classList.toggle('is-offline', !online);
      if (dom.syncText) dom.syncText.textContent = label;
    }

    if (remote.firebaseError && dom.syncPill) {
      dom.syncPill.classList.add('is-offline');
      if (dom.syncText) dom.syncText.textContent = 'CLOUD ERROR';
      if (dom.principalToggle && loggedIn) {
        dom.principalToggle.title = `No se pudo sincronizar el control remoto: ${remote.firebaseError}`;
      }
    }

    if (dom.emptyTitle && dom.emptyCopy) {
      if (!loggedIn && !isExtensionRuntime) {
        dom.emptyTitle.textContent = 'Inicia sesión para usar el control remoto';
        dom.emptyCopy.textContent = 'Usa la misma cuenta de StarTab que tienes iniciada en la PC principal. Al entrar, este panel detectará automáticamente sus reproducciones.';
      } else if (remoteView) {
        dom.emptyTitle.textContent = remote.principalOnline ? 'Sin multimedia en el principal' : 'Dispositivo principal sin conexión';
        dom.emptyCopy.textContent = remote.principalOnline
          ? 'Cuando el dispositivo principal reproduzca música o video, sus sesiones aparecerán aquí automáticamente y podrás controlarlas a distancia.'
          : 'Se conserva la última conexión del dispositivo principal. Los controles volverán a habilitarse automáticamente cuando StarTab recupere comunicación.';
      } else if (!isExtensionRuntime) {
        dom.emptyTitle.textContent = 'Esperando dispositivo principal';
        dom.emptyCopy.textContent = 'En tu PC abre StarTab como extensión, entra con esta misma cuenta y pulsa “Hacer principal”. Este panel web se conectará automáticamente sin recargar la página.';
      } else {
        dom.emptyTitle.textContent = 'No se detectó multimedia abierta';
        dom.emptyCopy.textContent = 'Aparecerán aquí las sesiones que hayan entrado en reproducción o se integren con Media Session. El contenido precargado que nunca se ha reproducido no se mostrará.';
      }
    }

    if (dom.openTab) {
      const blocked = !isExtensionRuntime || remoteView;
      dom.openTab.disabled = blocked;
      dom.openTab.textContent = blocked ? 'Pestaña en principal' : 'Abrir pestaña ↗';
      dom.openTab.title = blocked
        ? 'La pestaña está abierta en el dispositivo principal'
        : 'Abrir esta pestaña';
    }
  }

  function firestoreServerTimestamp() {
    try { return firebase.firestore.FieldValue.serverTimestamp(); } catch (_) { return null; }
  }

  function cleanRemoteText(value, max = 4096) {
    return String(value || '').slice(0, max);
  }

  function serializeRemoteSession(session) {
    return {
      key: sessionKey(session),
      tabId: Number(session.tabId),
      frameId: Number(session.frameId) || 0,
      windowId: Number(session.windowId) || 0,
      tabTitle: cleanRemoteText(session.tabTitle, 500),
      pageUrl: cleanRemoteText(session.pageUrl, 4096),
      host: cleanRemoteText(session.host, 300),
      favicon: cleanRemoteText(session.favicon, 4096),
      title: cleanRemoteText(session.title, 1000),
      artist: cleanRemoteText(session.artist, 1000),
      album: cleanRemoteText(session.album, 1000),
      artwork: cleanRemoteText(session.artwork, 8192),
      playbackState: ['playing','paused','ended'].includes(session.playbackState) ? session.playbackState : 'paused',
      currentTime: Math.max(0, Number(session.currentTime) || 0),
      duration: Math.max(0, Number(session.duration) || 0),
      playbackRate: Math.max(.1, Number(session.playbackRate) || 1),
      volume: clamp(session.volume, 0, 1),
      muted: !!session.muted,
      canSeek: !!session.canSeek,
      canSeekBackward: !!session.canSeekBackward,
      canSeekForward: !!session.canSeekForward,
      canPrev: !!session.canPrev,
      canNext: !!session.canNext,
      canVolume: session.canVolume !== false,
      transportAdapter: cleanRemoteText(session.transportAdapter, 100),
      mediaKind: session.mediaKind === 'video' ? 'video' : 'audio',
      nativeEligible: session.nativeEligible !== false,
      controllable: session.controllable !== false,
      readyState: Number(session.readyState) || 0,
      firstSeenAt: Number(session.firstSeenAt) || Number(session.updatedAt) || Date.now(),
      updatedAt: Number(session.updatedAt) || Date.now()
    };
  }

  function remoteStableFingerprint(sessions) {
    return JSON.stringify(sessions.map(s => [
      s.key, s.tabId, s.frameId, s.title, s.artist, s.album, s.artwork, s.favicon,
      s.playbackState, Math.round(s.duration * 10) / 10, s.playbackRate,
      Math.round(s.volume * 1000) / 1000, s.muted, s.canSeek, s.canSeekBackward,
      s.canSeekForward, s.canPrev, s.canNext, s.canVolume, s.mediaKind, s.pageUrl
    ]));
  }

  function principalStateNeedsPublish(nextSessions, force = false) {
    if (force) return true;
    const fingerprint = remoteStableFingerprint(nextSessions);
    if (fingerprint !== state.remote.lastPublishedFingerprint) return true;
    const previous = state.remote.lastPublishedSessions || [];
    if (previous.length !== nextSessions.length || !state.remote.lastPublishedAt) return true;
    const elapsed = Math.max(0, (Date.now() - state.remote.lastPublishedAt) / 1000);
    const prevByKey = new Map(previous.map(s => [s.key, s]));
    for (const current of nextSessions) {
      const prev = prevByKey.get(current.key);
      if (!prev) return true;
      const expected = prev.playbackState === 'playing'
        ? Math.min(prev.duration || Infinity, (Number(prev.currentTime) || 0) + elapsed * (Number(prev.playbackRate) || 1))
        : Number(prev.currentTime) || 0;
      // Publica seeks manuales / saltos reales, pero NO cada timeupdate normal.
      if (Math.abs((Number(current.currentTime) || 0) - expected) > 2.25) return true;
    }
    return false;
  }

  async function publishPrincipalState(force = false) {
    const remote = state.remote;
    if (!isExtensionRuntime || !remote.isPrincipal || !remote.isLeader || !remote.refs?.state || !firebaseRemoteReady()) return;
    const sessions = normalizeSessions(state.localRawSessions).map(serializeRemoteSession);
    if (!principalStateNeedsPublish(sessions, force)) return;
    const fingerprint = remoteStableFingerprint(sessions);
    try {
      await remote.refs.state.set({
        deviceId: mediaDeviceId,
        deviceLabel: mediaDeviceLabel(),
        sessions,
        clientAt: Date.now(),
        serverAt: firestoreServerTimestamp()
      }, { merge: false });
      remote.lastPublishedFingerprint = fingerprint;
      remote.lastPublishedSessions = sessions.map(item => ({ ...item }));
      remote.lastPublishedAt = Date.now();
      remote.firebaseError = '';
      renderRemoteRole();
    } catch (error) {
      remote.firebaseError = String(error?.message || error);
      renderRemoteRole();
    }
  }

  function schedulePrincipalStatePublish(force = false) {
    if (!state.remote.isPrincipal || !state.remote.isLeader) return;
    if (force) {
      clearTimeout(state.remote.publishTimer);
      state.remote.publishTimer = window.setTimeout(() => {
        state.remote.publishTimer = 0;
        publishPrincipalState(true);
      }, 60);
      return;
    }
    if (state.remote.publishTimer) return;
    state.remote.publishTimer = window.setTimeout(() => {
      state.remote.publishTimer = 0;
      publishPrincipalState(false);
    }, 90);
  }

  function remoteSessionsForView(rawSessions) {
    const online = principalIsFresh();
    return (Array.isArray(rawSessions) ? rawSessions : []).map(raw => ({
      ...raw,
      // El reloj del dispositivo remoto puede diferir. Reiniciamos la base de
      // estimación al instante en que recibimos el snapshot.
      updatedAt: Date.now(),
      controllable: raw?.controllable !== false && online
    }));
  }

  function applyRemoteSessionsIfNeeded() {
    if (!state.remote.viewingRemote || state.remote.isPrincipal) return;
    applyRegistry(remoteSessionsForView(state.remote.remoteRawSessions), 'remote');
    renderRemoteRole();
  }

  async function sendRemoteCommand(session, action, value) {
    const remote = state.remote;
    if (!remote.viewingRemote || remote.isPrincipal || !remote.refs?.command || !remote.principal?.deviceId) {
      return { ok: false, reason: 'remote-principal-unavailable' };
    }
    if (!principalIsFresh()) return { ok: false, reason: 'remote-principal-offline' };
    const id = `${Date.now().toString(36)}-${mediaInstanceId.slice(0, 8)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await remote.refs.command.set({
        id,
        fromDeviceId: mediaDeviceId,
        targetDeviceId: remote.principal.deviceId,
        target: { tabId: Number(session.tabId), frameId: Number(session.frameId) || 0 },
        command: { action: String(action || ''), value: Number.isFinite(Number(value)) ? Number(value) : null },
        clientAt: Date.now(),
        serverAt: firestoreServerTimestamp()
      }, { merge: false });
      return { ok: true, remote: true };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) };
    }
  }

  async function handleRemoteCommandSnapshot(snapshot) {
    const remote = state.remote;
    if (!isExtensionRuntime || !remote.isPrincipal || !remote.isLeader || !snapshot?.exists) return;
    const data = snapshot.data() || {};
    if (!data.id || data.id === remote.lastCommandId) return;
    if (data.targetDeviceId !== mediaDeviceId) return;
    const activatedAt = Number(remote.principal?.activatedAtClient) || 0;
    if (activatedAt && Number(data.clientAt) && Number(data.clientAt) < activatedAt - 1500) return;

    remote.lastCommandId = String(data.id);
    try { localStorage.setItem('startab_media_remote_last_command_v1', remote.lastCommandId); } catch (_) {}

    const target = data.target || {};
    const command = data.command || {};
    try {
      const response = await safeRuntimeMessage({
        type: 'STARTAB_MEDIA_CONTROL',
        target: { tabId: Number(target.tabId), frameId: Number(target.frameId) || 0 },
        command: { action: command.action, value: command.value }
      });
      if (response?.ok && response.state && typeof response.state === 'object') {
        const index = state.localRawSessions.findIndex(item =>
          Number(item?.tabId) === Number(target.tabId) && Number(item?.frameId || 0) === Number(target.frameId || 0));
        if (index >= 0) {
          state.localRawSessions[index] = { ...state.localRawSessions[index], ...response.state };
        }
      }
      schedulePrincipalStatePublish(true);
    } catch (_) {}
  }

  function disconnectRemoteFirebase() {
    for (const unsub of state.remote.unsubs.splice(0)) {
      try { unsub?.(); } catch (_) {}
    }
    state.remote.refs = null;
    state.remote.firebaseConnected = false;
  }

  function handlePrincipalSnapshot(snapshot) {
    const remote = state.remote;
    const principal = snapshot?.exists ? (snapshot.data() || {}) : null;
    remote.principal = principal;
    remote.principalOnline = principalIsFresh(principal);
    remote.isPrincipal = isExtensionRuntime && !!principal?.active && principal?.deviceId === mediaDeviceId;
    // Una web normal siempre es panel remoto: nunca puede apropiarse del rol
    // principal porque no tiene acceso a las pestañas/reproductores de la PC.
    remote.viewingRemote = !!principal?.active && !!principal?.deviceId && !remote.isPrincipal;

    if (remote.isPrincipal) {
      if (state.registryOrigin !== 'local') applyRegistry(state.localRawSessions, 'local');
      schedulePrincipalStatePublish(true);
    } else if (remote.viewingRemote) {
      applyRemoteSessionsIfNeeded();
    } else {
      const fallbackOrigin = isExtensionRuntime ? 'local' : 'web';
      const fallbackSessions = isExtensionRuntime ? state.localRawSessions : [];
      if (state.registryOrigin !== fallbackOrigin || state.sessions.size) applyRegistry(fallbackSessions, fallbackOrigin);
    }
    renderRemoteRole();
  }

  function handleStateSnapshot(snapshot) {
    const data = snapshot?.exists ? (snapshot.data() || {}) : null;
    if (!data || !Array.isArray(data.sessions)) return;
    if (state.remote.principal?.deviceId && data.deviceId !== state.remote.principal.deviceId) return;
    state.remote.remoteRawSessions = data.sessions;
    applyRemoteSessionsIfNeeded();
  }

  function connectRemoteFirebase() {
    if (!firebaseRemoteReady()) {
      if (state.remote.firebaseConnected) {
        disconnectRemoteFirebase();
        state.remote.uid = null;
        state.remote.principal = null;
        state.remote.isPrincipal = false;
        state.remote.viewingRemote = false;
        state.remote.remoteRawSessions = [];
        const fallbackOrigin = isExtensionRuntime ? 'local' : 'web';
        const fallbackSessions = isExtensionRuntime ? state.localRawSessions : [];
        if (state.registryOrigin !== fallbackOrigin || state.sessions.size) applyRegistry(fallbackSessions, fallbackOrigin);
      }
      renderRemoteRole();
      return false;
    }
    const uid = currentUser.uid;
    if (state.remote.firebaseConnected && state.remote.uid === uid && state.remote.refs) return true;

    disconnectRemoteFirebase();
    state.remote.uid = uid;
    const root = db.collection('users').doc(uid).collection('mediaRemote');
    state.remote.refs = {
      principal: root.doc('principal'),
      state: root.doc('state'),
      command: root.doc('command')
    };

    state.remote.unsubs.push(
      state.remote.refs.principal.onSnapshot(handlePrincipalSnapshot, error => {
        state.remote.firebaseError = String(error?.message || error);
        renderRemoteRole();
      }),
      state.remote.refs.state.onSnapshot(handleStateSnapshot, error => {
        state.remote.firebaseError = String(error?.message || error);
        renderRemoteRole();
      }),
      state.remote.refs.command.onSnapshot(snapshot => {
        void handleRemoteCommandSnapshot(snapshot);
      }, error => {
        state.remote.firebaseError = String(error?.message || error);
        renderRemoteRole();
      })
    );
    state.remote.firebaseConnected = true;
    renderRemoteRole();
    return true;
  }

  async function togglePrincipalDevice() {
    if (!isExtensionRuntime) {
      renderRemoteRole();
      return;
    }
    if (state.remote.busy || !connectRemoteFirebase() || !state.remote.refs?.principal) return;
    state.remote.busy = true;
    renderRemoteRole();
    try {
      if (state.remote.isPrincipal) {
        const current = await state.remote.refs.principal.get();
        const data = current.exists ? (current.data() || {}) : {};
        if (data.deviceId === mediaDeviceId) {
          await state.remote.refs.principal.set({
            active: false,
            deviceId: mediaDeviceId,
            deviceLabel: mediaDeviceLabel(),
            clientAt: Date.now(),
            serverAt: firestoreServerTimestamp()
          }, { merge: true });
        }
      } else {
        const now = Date.now();
        await state.remote.refs.principal.set({
          active: true,
          deviceId: mediaDeviceId,
          deviceLabel: mediaDeviceLabel(),
          activatedAtClient: now,
          clientAt: now,
          serverAt: firestoreServerTimestamp()
        }, { merge: false });
        state.remote.lastPublishedFingerprint = '';
        state.remote.lastPublishedSessions = [];
        state.remote.lastPublishedAt = 0;
      }
    } catch (error) {
      state.remote.firebaseError = String(error?.message || error);
    } finally {
      state.remote.busy = false;
      renderRemoteRole();
    }
  }

  async function tryAcquireRemoteLeader() {
    if (!isExtensionRuntime) return;
    if (state.remote.isLeader || state.remote.leaderRequesting) return;
    state.remote.leaderRequesting = true;
    if (!navigator.locks?.request) {
      state.remote.isLeader = true;
      state.remote.leaderRequesting = false;
      if (state.remote.isPrincipal) schedulePrincipalStatePublish(true);
      return;
    }
    try {
      await navigator.locks.request('startab-media-cloud-bridge-v1', { ifAvailable: true, mode: 'exclusive' }, async lock => {
        state.remote.leaderRequesting = false;
        if (!lock) return;
        state.remote.isLeader = true;
        if (state.remote.isPrincipal) schedulePrincipalStatePublish(true);
        await new Promise(resolve => { state.remote.releaseLeader = resolve; });
        state.remote.releaseLeader = null;
        state.remote.isLeader = false;
      });
    } catch (_) {
      state.remote.leaderRequesting = false;
    }
  }

  // Conecta Firebase cuando Auth termina de restaurar la sesión. No interfiere
  // con el arranque rápido local del centro multimedia.
  window.setInterval(() => {
    connectRemoteFirebase();
    void tryAcquireRemoteLeader();
    if (state.remote.isPrincipal && state.remote.isLeader && state.remote.refs?.principal) {
      // Heartbeat económico: mantiene visible si el principal sigue accesible sin
      // escribir el estado multimedia en cada timeupdate.
      const last = Number(state.remote._heartbeatAt) || 0;
      if (Date.now() - last > 25000) {
        state.remote._heartbeatAt = Date.now();
        state.remote.refs.principal.set({
          active: true,
          deviceId: mediaDeviceId,
          deviceLabel: mediaDeviceLabel(),
          clientAt: Date.now(),
          serverAt: firestoreServerTimestamp()
        }, { merge: true }).catch(() => {});
      }
    }
    const wasOnline = state.remote.principalOnline;
    state.remote.principalOnline = principalIsFresh();
    if (wasOnline !== state.remote.principalOnline && state.remote.viewingRemote) applyRemoteSessionsIfNeeded();
    renderRemoteRole();
  }, 3000);

  window.addEventListener('beforeunload', () => {
    if (!isExtensionRuntime) return;
    try { state.remote.releaseLeader?.(); } catch (_) {}
  });

  function getSelected() {
    return state.selectedKey ? state.sessions.get(state.selectedKey) : null;
  }

  function renderIndicator() {
    const sessions = [...state.sessions.values()];
    const playingCount = sessions.filter(s => s.playbackState === 'playing').length;
    const total = sessions.length;
    const playing = playingCount > 0;

    dom.button.classList.toggle('is-playing', playing);
    dom.button.dataset.state = playing ? 'playing' : (total ? 'paused' : 'idle');
    const hubName = isExtensionRuntime ? 'Centro multimedia' : 'Control multimedia remoto';
    dom.button.setAttribute('aria-label', playing
      ? `${hubName}: ${playingCount} reproduciendo de ${total} fuente${total === 1 ? '' : 's'}`
      : total
        ? `${hubName}: ${total} fuente${total === 1 ? '' : 's'} en pausa`
        : isExtensionRuntime ? 'Centro multimedia del navegador' : 'Control multimedia remoto del dispositivo principal');

    dom.badge.textContent = String(total);
    dom.badge.hidden = total === 0;
    dom.tooltip.textContent = playing
      ? `${playingCount} reproduciendo · ${total} sincronizada${total === 1 ? '' : 's'}`
      : total
        ? `${total} fuente${total === 1 ? '' : 's'} sincronizada${total === 1 ? '' : 's'}`
        : isExtensionRuntime
          ? 'Controles multimedia del navegador · sincronización global'
          : 'Control remoto de tu dispositivo principal';
  }

  function mediaFallbackSvg(kind) {
    return kind === 'video'
      ? '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="4"></rect><path d="m10 9 5 3-5 3Z"></path></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M9 18V5l10-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="16" cy="16" r="3"></circle></svg>';
  }

  function createSourceButton(session) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'multimedia-source';
    button.dataset.tabId = String(session.tabId);

    const icon = document.createElement('span');
    icon.className = 'multimedia-source-icon';

    const copy = document.createElement('span');
    copy.className = 'multimedia-source-copy';
    const strong = document.createElement('strong');
    const small = document.createElement('small');
    copy.append(strong, small);

    const status = document.createElement('span');
    status.className = 'multimedia-source-status';
    const statusText = document.createElement('em');
    const activity = document.createElement('span');
    activity.className = 'multimedia-source-activity';
    activity.innerHTML = '<i></i><i></i><i></i>';
    status.append(statusText, activity);

    button.append(icon, copy, status);
    updateSourceButton(button, session);
    return button;
  }

  function updateSourceButton(button, session) {
    button.dataset.key = session.key;
    button.dataset.tabId = String(session.tabId);
    button.classList.toggle('is-active', session.key === state.selectedKey);
    button.classList.toggle('is-playing', session.playbackState === 'playing');

    const icon = button.querySelector('.multimedia-source-icon');
    const currentFavicon = icon?.querySelector('img')?.getAttribute('src') || '';
    const nextFavicon = session.favicon || '';
    if (icon && currentFavicon !== nextFavicon) {
      icon.textContent = '';
      if (nextFavicon) {
        const img = document.createElement('img');
        img.src = nextFavicon;
        img.alt = '';
        icon.appendChild(img);
      } else {
        icon.innerHTML = mediaFallbackSvg(session.mediaKind);
      }
    } else if (icon && !nextFavicon && !icon.firstElementChild) {
      icon.innerHTML = mediaFallbackSvg(session.mediaKind);
    }

    const strong = button.querySelector('.multimedia-source-copy strong');
    const small = button.querySelector('.multimedia-source-copy small');
    if (strong) strong.textContent = session.title || session.tabTitle || 'Contenido multimedia';
    if (small) small.textContent = session.artist || session.host || 'Pestaña del navegador';

    const status = button.querySelector('.multimedia-source-status');
    const statusText = status?.querySelector('em');
    if (status) status.dataset.state = session.playbackState || 'paused';
    if (statusText) {
      statusText.textContent = session.playbackState === 'playing'
        ? 'LIVE'
        : session.playbackState === 'ended'
          ? 'FIN'
          : 'PAUSA';
    }
  }

  function orderedSessions() {
    const byTab = new Map([...state.sessions.values()].map(session => [session.tabId, session]));
    return state.sourceOrder.map(tabId => byTab.get(tabId)).filter(Boolean);
  }

  function renderSources() {
    const sessions = orderedSessions();
    dom.modal.classList.toggle('has-sources', sessions.length > 0);
    const existing = new Map(
      [...dom.sourceList.querySelectorAll('.multimedia-source')]
        .map(node => [Number(node.dataset.tabId), node])
    );

    // Reconciliación keyed: actualiza cada tarjeta en su sitio. No borramos y
    // recreamos la lista en cada tick, evitando saltos, parpadeos y scroll reset.
    sessions.forEach((session, index) => {
      let button = existing.get(session.tabId);
      if (!button) button = createSourceButton(session);
      else updateSourceButton(button, session);

      const nodeAtIndex = dom.sourceList.children[index];
      if (nodeAtIndex !== button) dom.sourceList.insertBefore(button, nodeAtIndex || null);
      existing.delete(session.tabId);
    });

    for (const stale of existing.values()) stale.remove();
  }

  function estimateCurrentTime(session) {
    if (!session) return 0;
    let current = Number(session.currentTime) || 0;
    if (session.playbackState === 'playing' && session.updatedAt) {
      const elapsed = Math.max(0, (Date.now() - Number(session.updatedAt)) / 1000);
      current += elapsed * (Number(session.playbackRate) || 1);
    }
    if (session.duration > 0) current = Math.min(current, session.duration);
    return Math.max(0, current);
  }

  function updateProgressOnly() {
    const session = getSelected();
    if (!session || state.userSeeking) return;
    const duration = Number(session.duration) || 0;
    const current = estimateCurrentTime(session);
    dom.current.textContent = formatTime(current);
    dom.duration.textContent = duration > 0 ? formatTime(duration) : '–:––';
    if (duration > 0) {
      dom.seek.value = String(current);
      dom.seekFill.style.setProperty('--progress', `${clamp(current / duration * 100, 0, 100)}%`);
    }
  }

  function renderPlayer() {
    const session = getSelected();
    dom.empty.hidden = !!session;
    dom.player.hidden = !session;
    if (!session) return;

    dom.title.textContent = session.title || session.tabTitle || 'Contenido multimedia';
    dom.artist.textContent = session.artist || session.host || 'Reproducción del navegador';
    dom.site.textContent = session.host || 'Pestaña del navegador';

    if (dom.playbackBadge) {
      dom.playbackBadge.dataset.state = session.playbackState || 'paused';
      dom.playbackBadge.textContent = session.playbackState === 'playing'
        ? 'REPRODUCIENDO'
        : session.playbackState === 'ended'
          ? 'FINALIZADO'
          : 'EN PAUSA';
    }

    if (session.favicon) {
      dom.favicon.src = session.favicon;
      dom.favicon.hidden = false;
    } else {
      dom.favicon.hidden = true;
      dom.favicon.removeAttribute('src');
    }

    if (session.artwork) {
      dom.artwork.src = session.artwork;
      dom.artwork.hidden = false;
      dom.artworkFallback.hidden = true;
    } else {
      dom.artwork.hidden = true;
      dom.artwork.removeAttribute('src');
      dom.artworkFallback.hidden = false;
    }

    // Un único glyph CSS evita el fallo de SVG oculto/vacío: el estado del
    // botón se representa exclusivamente con data-playback-state.
    const isPlaying = session.playbackState === 'playing';
    dom.play.dataset.playbackState = isPlaying ? 'playing' : 'paused';
    dom.play.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
    dom.play.setAttribute('aria-label', isPlaying ? 'Pausar' : 'Reproducir');
    dom.play.setAttribute('title', isPlaying ? 'Pausar' : 'Reproducir');
    dom.play.classList.toggle('is-playing', isPlaying);

    const effectiveControllable = !!session.controllable && (!state.remote.viewingRemote || state.remote.principalOnline);
    dom.play.disabled = !effectiveControllable;
    dom.play.classList.toggle('is-pending', state.controlPending);
    dom.play.setAttribute('aria-busy', state.controlPending ? 'true' : 'false');
    dom.prev.disabled = !effectiveControllable || !session.canPrev || state.controlPending;
    dom.next.disabled = !effectiveControllable || !session.canNext || state.controlPending;
    dom.back10.disabled = !effectiveControllable || !session.canSeekBackward || state.controlPending;
    dom.forward10.disabled = !effectiveControllable || !session.canSeekForward || state.controlPending;
    dom.prev.title = session.canPrev ? 'Pista anterior' : 'Anterior no disponible para este contenido';
    dom.next.title = session.canNext ? 'Pista siguiente' : 'Siguiente no disponible para este contenido';
    dom.seek.disabled = !effectiveControllable || !session.canSeek;
    dom.volume.disabled = !effectiveControllable || session.canVolume === false;
    dom.volume.closest('.multimedia-volume-group')?.classList.toggle('is-disabled', session.canVolume === false);

    dom.unavailable.hidden = effectiveControllable;
    dom.unavailable.textContent = effectiveControllable
      ? ''
      : state.remote.viewingRemote && !state.remote.principalOnline
        ? 'El dispositivo principal no responde ahora mismo. Cuando vuelva a estar en línea, los controles se habilitarán automáticamente.'
        : (session.unavailableMessage || 'El navegador detectó esta fuente, pero esta página no admite control remoto desde StarTab.');

    const duration = Number(session.duration) || 0;
    const current = estimateCurrentTime(session);
    dom.seek.max = duration > 0 ? String(duration) : '100';
    if (!state.userSeeking) dom.seek.value = duration > 0 ? String(current) : '0';
    dom.current.textContent = state.userSeeking ? formatTime(Number(dom.seek.value) || 0) : formatTime(current);
    dom.duration.textContent = duration > 0 ? formatTime(duration) : '–:––';
    dom.seekFill.style.setProperty('--progress', `${duration > 0 ? clamp(current / duration * 100, 0, 100) : 0}%`);

    const volume = session.muted ? 0 : clamp(session.volume, 0, 1);
    dom.volume.value = String(Math.round(volume * 100));
    dom.volumeFill.style.setProperty('--volume', `${Math.round(volume * 100)}%`);
    dom.volumeValue.textContent = `${Math.round(volume * 100)}%`;
    dom.volumeIcon.dataset.level = volume === 0 ? 'mute' : volume < .5 ? 'low' : 'high';
    dom.openTab.dataset.key = session.key;
    renderRemoteRole();
  }

  function syncPlayerHeight() {
    if (!dom.main || !dom.topbar || !dom.player || dom.player.hidden) return;
    cancelAnimationFrame(state.layoutRaf);
    state.layoutRaf = requestAnimationFrame(() => {
      const mainStyle = getComputedStyle(dom.main);
      const gap = parseFloat(mainStyle.rowGap || mainStyle.gap) || 0;
      const paddingY = (parseFloat(mainStyle.paddingTop) || 0) + (parseFloat(mainStyle.paddingBottom) || 0);
      const available = Math.max(0, Math.floor(dom.main.clientHeight - paddingY - dom.topbar.offsetHeight - gap));
      dom.player.style.setProperty('--multimedia-player-height', `${available}px`);
      dom.player.dataset.heightMode = available < 360 ? 'tight' : available < 455 ? 'compact' : 'regular';
    });
  }

  function renderAll() {
    renderIndicator();
    renderSources();
    renderPlayer();
    if (state.modalOpen) syncPlayerHeight();
  }

  async function controlSelected(action, value) {
    const session = getSelected();
    if (!session?.controllable) return;
    if (state.controlPending) {
      if (action === 'volume' && state.remote.viewingRemote && !state.remote.isPrincipal) {
        clearTimeout(state.remote.volumeRetryTimer);
        state.remote.volumeRetryTimer = window.setTimeout(() => controlSelected('volume', value), 180);
      }
      return;
    }
    if ((action === 'prev' && !session.canPrev) || (action === 'next' && !session.canNext)) return;
    if ((action === 'seekBy' && Number(value) < 0 && !session.canSeekBackward) ||
        (action === 'seekBy' && Number(value) > 0 && !session.canSeekForward)) return;
    if (action === 'volume' && session.canVolume === false) return;

    const previous = {
      playbackState: session.playbackState,
      currentTime: session.currentTime,
      volume: session.volume,
      muted: session.muted,
      updatedAt: session.updatedAt
    };

    // Respuesta visual inmediata al gesto. El estado devuelto por la pestaña
    // se convierte después en la autoridad y corrige cualquier discrepancia.
    if (action === 'toggle') {
      session.playbackState = session.playbackState === 'playing' ? 'paused' : 'playing';
      session.updatedAt = Date.now();
    } else if (action === 'seekBy') {
      const duration = Number(session.duration) || Infinity;
      session.currentTime = clamp((Number(session.currentTime) || 0) + Number(value || 0), 0, duration);
      session.updatedAt = Date.now();
    } else if (action === 'seek') {
      session.currentTime = Math.max(0, Number(value) || 0);
      session.updatedAt = Date.now();
    } else if (action === 'volume') {
      session.volume = clamp(Number(value), 0, 1);
      session.muted = session.volume <= 0.0001;
      session.updatedAt = Date.now();
    }

    state.controlPending = true;
    renderPlayer();
    try {
      const response = state.remote.viewingRemote && !state.remote.isPrincipal
        ? await sendRemoteCommand(session, action, value)
        : await safeRuntimeMessage({
            type: 'STARTAB_MEDIA_CONTROL',
            target: { tabId: session.tabId, frameId: session.frameId },
            command: { action, value }
          });
      if (response?.ok) {
        if (response.state && typeof response.state === 'object') {
          Object.assign(session, response.state, { key: session.key, tabId: session.tabId, frameId: session.frameId });
        }
        renderAll();
      } else {
        Object.assign(session, previous);
        if (action === 'prev') session.canPrev = false;
        if (action === 'next') session.canNext = false;
        if (action === 'seekBy' && Number(value) < 0) session.canSeekBackward = false;
        if (action === 'seekBy' && Number(value) > 0) session.canSeekForward = false;
        if (response?.reason) {
          dom.unavailable.hidden = false;
          dom.unavailable.textContent = response.reason === 'track-navigation-not-supported' || response.reason === 'native-action-not-available'
            ? 'La página no registró esa acción en Media Session; el botón se deshabilitó para evitar saltos aleatorios.'
            : response.reason === 'volume-not-supported'
              ? 'Esta sesión no expone un elemento multimedia con volumen controlable desde la extensión.'
              : response.reason === 'remote-principal-offline' || response.reason === 'remote-principal-unavailable'
                ? 'El dispositivo principal no está disponible para recibir el control remoto.'
                : 'No se pudo ejecutar ese control en la sesión multimedia.';
        }
      }
    } catch (_) {
      Object.assign(session, previous);
      setSyncState(false);
    } finally {
      state.controlPending = false;
      renderPlayer();
    }
  }

  function openModal() {
    state.modalOpen = true;
    dom.modal.classList.remove('is-closing');
    dom.modal.classList.add('is-open');
    dom.modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('multimedia-modal-open');
    dom.button.classList.add('is-pressed');
    window.setTimeout(() => dom.button.classList.remove('is-pressed'), 260);
    loadRegistry();
    requestAnimationFrame(syncPlayerHeight);
  }

  function closeModal() {
    if (!state.modalOpen) return;
    state.modalOpen = false;
    dom.modal.classList.remove('is-open');
    dom.modal.classList.add('is-closing');
    dom.modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('multimedia-modal-open');
    window.setTimeout(() => dom.modal.classList.remove('is-closing'), 220);
  }

  dom.button.addEventListener('click', openModal);
  dom.principalToggle?.addEventListener('click', () => { void togglePrincipalDevice(); });
  dom.close.addEventListener('click', closeModal);
  dom.backdrop.addEventListener('click', closeModal);
  dom.play.addEventListener('click', () => controlSelected('toggle'));
  dom.prev.addEventListener('click', () => controlSelected('prev'));
  dom.back10.addEventListener('click', () => controlSelected('seekBy', -10));
  dom.forward10.addEventListener('click', () => controlSelected('seekBy', 10));
  dom.next.addEventListener('click', () => controlSelected('next'));

  dom.sourceList.addEventListener('click', event => {
    const button = event.target.closest('.multimedia-source');
    if (!button) return;
    const key = button.dataset.key;
    if (!key || !state.sessions.has(key)) return;
    state.selectedKey = key;
    renderAll();
  });

  dom.seek.addEventListener('pointerdown', () => { state.userSeeking = true; });
  dom.seek.addEventListener('keydown', () => { state.userSeeking = true; });
  dom.seek.addEventListener('input', () => {
    const max = Number(dom.seek.max) || 0;
    const value = Number(dom.seek.value) || 0;
    dom.current.textContent = formatTime(value);
    dom.seekFill.style.setProperty('--progress', `${max > 0 ? clamp(value / max * 100, 0, 100) : 0}%`);
  });
  dom.seek.addEventListener('change', () => {
    state.userSeeking = false;
    controlSelected('seek', Number(dom.seek.value) || 0);
  });
  dom.seek.addEventListener('pointerup', () => { state.userSeeking = false; });
  dom.seek.addEventListener('blur', () => { state.userSeeking = false; });

  dom.volume.addEventListener('input', () => {
    const volume = clamp((Number(dom.volume.value) || 0) / 100, 0, 1);
    dom.volumeFill.style.setProperty('--volume', `${Math.round(volume * 100)}%`);
    dom.volumeValue.textContent = `${Math.round(volume * 100)}%`;
    clearTimeout(state.volumeTimer);
    state.volumeTimer = window.setTimeout(() => controlSelected('volume', volume), state.remote.viewingRemote ? 140 : 50);
  });

  dom.artwork.addEventListener('error', () => {
    dom.artwork.hidden = true;
    dom.artworkFallback.hidden = false;
  });

  dom.openTab.addEventListener('click', async () => {
    if (!isExtensionRuntime || (state.remote.viewingRemote && !state.remote.isPrincipal)) return;
    const session = state.sessions.get(dom.openTab.dataset.key);
    if (!session) return;
    try {
      await extensionApi.tabs.update(session.tabId, { active: true });
      if (Number.isInteger(session.windowId)) await extensionApi.windows.update(session.windowId, { focused: true });
    } catch (_) {}
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.modalOpen) closeModal();
  });

  if (isExtensionRuntime && extensionApi.runtime?.onMessage) {
    extensionApi.runtime.onMessage.addListener(message => {
      if (message?.type === 'STARTAB_MEDIA_REGISTRY_UPDATE') {
        setSyncState(true);
        state.localRawSessions = message.sessions || [];
        if (!state.remote.viewingRemote || state.remote.isPrincipal) applyRegistry(state.localRawSessions, 'local');
        if (state.remote.isPrincipal) schedulePrincipalStatePublish(false);
      }
    });
  }

  // Una animación local de progreso a 4 FPS mantiene la barra suave sin hacer
  // consultas repetitivas al resto de pestañas ni despertar el service worker.
  const progressLoop = () => {
    if (state.modalOpen) updateProgressOnly();
    state.progressRaf = window.setTimeout(progressLoop, 250);
  };
  progressLoop();

  // El alto útil del reproductor se mide contra el área REAL disponible del
  // modal. ResizeObserver cubre viewport, responsive y cambios de topbar.
  if ('ResizeObserver' in window && dom.main) {
    const mediaLayoutObserver = new ResizeObserver(() => {
      if (state.modalOpen) syncPlayerHeight();
    });
    mediaLayoutObserver.observe(dom.main);
    if (dom.topbar) mediaLayoutObserver.observe(dom.topbar);
  }
  window.addEventListener('resize', () => {
    if (state.modalOpen) syncPlayerHeight();
  }, { passive: true });
  window.visualViewport?.addEventListener('resize', () => {
    if (state.modalOpen) syncPlayerHeight();
  }, { passive: true });

  renderRemoteRole();
  connectRemoteFirebase();
  if (isExtensionRuntime) void tryAcquireRemoteLeader();
  loadRegistry();
})();
