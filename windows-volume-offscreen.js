(() => {
  'use strict';

  const firebaseConfig = {
    apiKey: 'AIzaSyBU8DyN2kRcDq0fxB20qRUXWBHV0E-0d6A',
    authDomain: 'startab-44e48.firebaseapp.com',
    projectId: 'startab-44e48',
    storageBucket: 'startab-44e48.firebasestorage.app',
    messagingSenderId: '874084877753',
    appId: '1:874084877753:web:cf9cbe9a344356dc9be268',
  };

  const HEARTBEAT_MS = 25_000;
  const COMMAND_MAX_AGE_MS = 20_000;

  const state = {
    db: null,
    auth: null,
    authUser: null,
    user: null,
    nativeConnected: false,
    nativeState: null,
    deviceRef: null,
    unsubscribeDevice: null,
    heartbeat: 0,
    lastCommandId: null,
    bridgeKey: null,
    userTimer: 0,
  };

  function readSavedUser() {
    try {
      const raw = localStorage.getItem('starTab_lastUser');
      if (!raw) return null;
      const user = JSON.parse(raw);
      return user?.uid ? user : null;
    } catch (_) {
      return null;
    }
  }

  function effectiveUser() {
    if (state.authUser?.uid) {
      return {
        uid: state.authUser.uid,
        email: state.authUser.email || '',
        displayName: state.authUser.displayName || '',
      };
    }
    return readSavedUser();
  }

  async function markCurrentOffline() {
    if (!state.deviceRef) return;
    try {
      await state.deviceRef.set({
        online: false,
        clientAt: Date.now(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (_) {}
  }

  function stopDeviceListener() {
    state.unsubscribeDevice?.();
    state.unsubscribeDevice = null;
    state.deviceRef = null;
    state.lastCommandId = null;
    state.bridgeKey = null;
  }

  async function syncUser() {
    const next = effectiveUser();
    const nextUid = next?.uid || null;
    if ((state.user?.uid || null) === nextUid) return;

    if (state.user?.uid && state.deviceRef) await markCurrentOffline();
    stopDeviceListener();
    state.user = next;
    await startDeviceBridge();
  }

  async function startDeviceBridge() {
    if (!state.db || !state.user?.uid || !state.nativeState?.deviceId) return;
    const deviceId = state.nativeState.deviceId;
    const nextBridgeKey = `${state.user.uid}:${deviceId}`;

    if (state.bridgeKey === nextBridgeKey && state.unsubscribeDevice) {
      await publishNativeState(false);
      return;
    }

    stopDeviceListener();
    state.bridgeKey = nextBridgeKey;
    state.deviceRef = state.db
      .collection('users')
      .doc(state.user.uid)
      .collection('windowsDevices')
      .doc(deviceId);

    await publishNativeState(true);

    state.unsubscribeDevice = state.deviceRef.onSnapshot(
      (snapshot) => {
        if (!snapshot.exists) return;
        const data = snapshot.data() || {};
        const command = data.command;
        if (!command?.id || command.id === state.lastCommandId || command.id === data.lastCommandId) return;

        const issuedAt = Number(command.clientAt) || 0;
        const expiresAt = Number(command.expiresAtClient) || (issuedAt + COMMAND_MAX_AGE_MS);
        if (!issuedAt || Date.now() > expiresAt + 2_000 || Date.now() - issuedAt > COMMAND_MAX_AGE_MS + 5_000) {
          state.lastCommandId = command.id;
          void acknowledgeCommand(command.id, false, 'expired');
          return;
        }

        state.lastCommandId = command.id;
        void executeCommand(command);
      },
      (error) => console.error('StarTab Windows bridge: listener Firestore:', error),
    );
  }

  function commandForNative(command) {
    const action = String(command?.action || '');
    if (action === 'setVolume') {
      return { type: 'setVolume', value: Math.max(0, Math.min(100, Number(command.value) || 0)) };
    }
    if (action === 'toggleMute') return { type: 'toggleMute' };
    if (action === 'setMute') return { type: 'setMute', muted: !!command.muted };
    if (action === 'step') return { type: 'step', delta: Math.max(-100, Math.min(100, Number(command.value) || 0)) };
    return null;
  }

  async function executeCommand(command) {
    const nativeCommand = commandForNative(command);
    if (!nativeCommand) {
      await acknowledgeCommand(command.id, false, 'invalid-command');
      return;
    }

    try {
      // Backward-compatible UX: changing volume always restores sound first, even
      // when the installed native host predates the v2.1 auto-unmute behavior.
      if (nativeCommand.type === 'setVolume') {
        const unmuteResponse = await chrome.runtime.sendMessage({
          type: 'STARTAB_WINDOWS_NATIVE_COMMAND',
          command: { type: 'setMute', muted: false },
        });
        if (!unmuteResponse?.ok) {
          await acknowledgeCommand(command.id, false, unmuteResponse?.reason || 'native-disconnected');
          return;
        }
      }
      const response = await chrome.runtime.sendMessage({
        type: 'STARTAB_WINDOWS_NATIVE_COMMAND',
        command: nativeCommand,
      });
      await acknowledgeCommand(command.id, !!response?.ok, response?.ok ? null : response?.reason || 'native-disconnected');
    } catch (error) {
      await acknowledgeCommand(command.id, false, String(error?.message || error));
    }
  }

  async function acknowledgeCommand(commandId, ok, reason) {
    if (!state.deviceRef) return;
    try {
      await state.deviceRef.set({
        lastCommandId: commandId,
        commandResult: {
          id: commandId,
          ok: !!ok,
          reason: reason || null,
          clientAt: Date.now(),
        },
      }, { merge: true });
    } catch (error) {
      console.warn('StarTab Windows bridge: no se pudo confirmar comando:', error);
    }
  }

  async function publishNativeState(force = false) {
    if (!state.db || !state.user?.uid || !state.nativeState?.deviceId) return;
    const native = state.nativeState;
    const target = state.db
      .collection('users')
      .doc(state.user.uid)
      .collection('windowsDevices')
      .doc(native.deviceId);

    state.deviceRef = target;
    const payload = {
      deviceId: native.deviceId,
      deviceName: native.deviceName || 'PC Windows',
      platform: 'windows',
      bridge: 'nativeMessaging',
      agentVersion: native.agentVersion || '2.0.0',
      online: !!state.nativeConnected,
      clientAt: Date.now(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (Number.isFinite(Number(native.volume))) payload.volume = Math.max(0, Math.min(100, Number(native.volume)));
    if (typeof native.muted === 'boolean') payload.muted = native.muted;
    if (typeof native.audioActive === 'boolean') payload.audioActive = native.audioActive;
    if (force) payload.connectedAt = firebase.firestore.FieldValue.serverTimestamp();

    try {
      await target.set(payload, { merge: true });
    } catch (error) {
      console.error('StarTab Windows bridge: no se pudo publicar estado:', error);
    }
  }

  async function handleNativeEvent(payload) {
    if (!payload || typeof payload !== 'object') return;

    if (payload.kind === 'disconnected') {
      state.nativeConnected = false;
      await publishNativeState(false);
      return;
    }

    if (payload.kind === 'connected') {
      state.nativeConnected = true;
      if (payload.state) state.nativeState = { ...(state.nativeState || {}), ...payload.state };
      await startDeviceBridge();
      return;
    }

    const message = payload.message || payload.state || payload;
    if (message?.type === 'hello') {
      const oldDeviceId = state.nativeState?.deviceId;
      state.nativeConnected = true;
      state.nativeState = { ...(state.nativeState || {}), ...message };
      if (oldDeviceId && oldDeviceId !== message.deviceId) stopDeviceListener();
      await startDeviceBridge();
      return;
    }

    if (message?.type === 'state') {
      state.nativeConnected = true;
      state.nativeState = { ...(state.nativeState || {}), ...message };
      await publishNativeState(false);
      return;
    }

    if (message?.type === 'meter') {
      state.nativeConnected = true;
      const previousActive = state.nativeState?.audioActive;
      state.nativeState = { ...(state.nativeState || {}), ...message };
      if (previousActive !== message.audioActive) await publishNativeState(false);
    }
  }

  function initFirebase() {
    try {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      state.db = firebase.firestore();
      state.auth = firebase.auth();
      state.auth.onAuthStateChanged((user) => {
        state.authUser = user || null;
        void syncUser();
      });
      void syncUser();
    } catch (error) {
      console.error('StarTab Windows bridge: Firebase init:', error);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.target !== 'startab-windows-offscreen') return;
    if (message.type === 'STARTAB_WINDOWS_NATIVE_EVENT') {
      void handleNativeEvent(message.payload);
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key === 'starTab_lastUser') void syncUser();
  });

  state.heartbeat = window.setInterval(() => {
    if (state.nativeConnected) void publishNativeState(false);
  }, HEARTBEAT_MS);

  state.userTimer = window.setInterval(() => void syncUser(), 3_000);

  initFirebase();

  try {
    chrome.runtime.sendMessage({ type: 'STARTAB_WINDOWS_NATIVE_GET_STATE' }).then((response) => {
      if (response?.connected) {
        void handleNativeEvent({ kind: 'connected', state: response.state });
      }
    }).catch(() => {});
  } catch (_) {}
})();

/* StarTab NATIVE MEDIA · persistent Firestore bridge v2
 * Keeps the principal multimedia device reachable while no StarTab tab is open.
 * The service worker owns the browser media registry; this hidden document owns
 * the long-lived Firestore listeners/heartbeat. A Web Lock prevents duplicate
 * command execution when a visible StarTab page is open at the same time.
 */
(() => {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBU8DyN2kRcDq0fxB20qRUXWBHV0E-0d6A',
    authDomain: 'startab-44e48.firebaseapp.com',
    projectId: 'startab-44e48',
    storageBucket: 'startab-44e48.firebasestorage.app',
    messagingSenderId: '874084877753',
    appId: '1:874084877753:web:cf9cbe9a344356dc9be268',
  };

  const DEVICE_ID_KEY = 'startab_media_remote_device_id_v1';
  const LAST_COMMAND_KEY = 'startab_media_remote_last_command_v1';
  const LEADER_LOCK = 'startab-media-cloud-bridge-v1';
  const HEARTBEAT_MS = 12_000;
  const COMMAND_MAX_AGE_MS = 20_000;
  const STATE_FORCE_REFRESH_MS = 45_000;

  const media = {
    db: null,
    auth: null,
    authUser: null,
    user: null,
    uid: null,
    refs: null,
    unsubs: [],
    principal: null,
    isPrincipal: false,
    isLeader: false,
    sessions: [],
    publishTimer: 0,
    lastPublishedFingerprint: '',
    lastPublishedSessions: [],
    lastPublishedAt: 0,
    lastCommandId: (() => {
      try { return localStorage.getItem(LAST_COMMAND_KEY) || ''; } catch (_) { return ''; }
    })(),
  };

  function readSavedUser() {
    try {
      const raw = localStorage.getItem('starTab_lastUser');
      if (!raw) return null;
      const value = JSON.parse(raw);
      return value?.uid ? value : null;
    } catch (_) {
      return null;
    }
  }

  function effectiveUser() {
    const user = media.authUser;
    if (user?.uid) {
      return {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
      };
    }
    return readSavedUser();
  }

  function mediaDeviceId() {
    try {
      const saved = localStorage.getItem(DEVICE_ID_KEY);
      if (saved) return saved;
      const created = crypto.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(DEVICE_ID_KEY, created);
      return created;
    } catch (_) {
      return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }

  function mediaDeviceLabel() {
    const ua = String(navigator.userAgent || '');
    if (/Windows/i.test(ua)) return 'PC con Windows';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Dispositivo StarTab';
  }

  function serverTimestamp() {
    try { return firebase.firestore.FieldValue.serverTimestamp(); } catch (_) { return null; }
  }

  function sessionKey(session) {
    return session?.key || `${session?.tabId ?? 'x'}:${session?.frameId ?? 0}`;
  }

  function playbackScore(session) {
    let score = 0;
    if (session?.playbackState === 'playing') score += 1_000_000;
    if (session?.playbackState === 'paused') score += 300_000;
    if (Number(session?.currentTime) > 0.05) score += 100_000;
    if (Number(session?.frameId) === 0) score += 1_000;
    score += Number(session?.updatedAt) || 0;
    return score;
  }

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

  function text(value, max = 4096) {
    return String(value || '').slice(0, max);
  }

  function serializeSession(session) {
    return {
      key: sessionKey(session),
      tabId: Number(session.tabId),
      frameId: Number(session.frameId) || 0,
      windowId: Number(session.windowId) || 0,
      tabTitle: text(session.tabTitle, 500),
      pageUrl: text(session.pageUrl, 4096),
      host: text(session.host, 300),
      favicon: text(session.favicon, 4096),
      title: text(session.title, 1000),
      artist: text(session.artist, 1000),
      album: text(session.album, 1000),
      artwork: text(session.artwork, 8192),
      playbackState: ['playing', 'paused', 'ended'].includes(session.playbackState) ? session.playbackState : 'paused',
      currentTime: Math.max(0, Number(session.currentTime) || 0),
      duration: Math.max(0, Number(session.duration) || 0),
      playbackRate: Math.max(0.1, Math.min(16, Number(session.playbackRate) || 1)),
      volume: Math.max(0, Math.min(1, Number(session.volume) || 0)),
      muted: !!session.muted,
      canSeek: !!session.canSeek,
      canSeekBackward: !!session.canSeekBackward,
      canSeekForward: !!session.canSeekForward,
      canPrev: !!session.canPrev,
      canNext: !!session.canNext,
      canVolume: session.canVolume !== false,
      transportAdapter: text(session.transportAdapter, 100),
      mediaKind: session.mediaKind === 'video' ? 'video' : 'audio',
      nativeEligible: session.nativeEligible !== false,
      controllable: session.controllable !== false,
      readyState: Number(session.readyState) || 0,
      firstSeenAt: Number(session.firstSeenAt) || Number(session.updatedAt) || Date.now(),
      updatedAt: Number(session.updatedAt) || Date.now(),
    };
  }

  function stableFingerprint(sessions) {
    return JSON.stringify(sessions.map((s) => [
      s.key, s.tabId, s.frameId, s.title, s.artist, s.album, s.artwork, s.favicon,
      s.playbackState, Math.round(s.duration * 10) / 10, s.playbackRate,
      Math.round(s.volume * 1000) / 1000, s.muted, s.canSeek, s.canSeekBackward,
      s.canSeekForward, s.canPrev, s.canNext, s.canVolume, s.mediaKind, s.pageUrl,
    ]));
  }

  function stateNeedsPublish(nextSessions, force = false) {
    if (force) return true;
    const fingerprint = stableFingerprint(nextSessions);
    if (fingerprint !== media.lastPublishedFingerprint) return true;
    if (!media.lastPublishedAt || media.lastPublishedSessions.length !== nextSessions.length) return true;
    if (Date.now() - media.lastPublishedAt > STATE_FORCE_REFRESH_MS) return true;

    const elapsed = Math.max(0, (Date.now() - media.lastPublishedAt) / 1000);
    const previous = new Map(media.lastPublishedSessions.map((s) => [s.key, s]));
    for (const current of nextSessions) {
      const old = previous.get(current.key);
      if (!old) return true;
      const expected = old.playbackState === 'playing'
        ? Math.min(old.duration || Infinity, (Number(old.currentTime) || 0) + elapsed * (Number(old.playbackRate) || 1))
        : Number(old.currentTime) || 0;
      if (Math.abs((Number(current.currentTime) || 0) - expected) > 2.25) return true;
    }
    return false;
  }

  function disconnectRefs() {
    for (const unsubscribe of media.unsubs.splice(0)) {
      try { unsubscribe?.(); } catch (_) {}
    }
    media.refs = null;
    media.principal = null;
    media.isPrincipal = false;
  }

  async function syncUser() {
    const next = effectiveUser();
    const uid = next?.uid || null;
    if (uid === media.uid && media.refs) return;
    disconnectRefs();
    media.user = next;
    media.uid = uid;
    if (!uid || !media.db) return;
    connectRefs();
  }

  function connectRefs() {
    if (!media.db || !media.uid || media.refs) return;
    const root = media.db.collection('users').doc(media.uid).collection('mediaRemote');
    media.refs = {
      principal: root.doc('principal'),
      state: root.doc('state'),
      command: root.doc('command'),
    };

    media.unsubs.push(
      media.refs.principal.onSnapshot((snapshot) => {
        const wasPrincipal = media.isPrincipal;
        const principal = snapshot?.exists ? (snapshot.data() || {}) : null;
        media.principal = principal;
        media.isPrincipal = !!principal?.active && principal?.deviceId === mediaDeviceId();
        if (media.isPrincipal && media.isLeader && !wasPrincipal) {
          void refreshRegistry(true);
          void publishHeartbeat(false);
        }
      }, (error) => console.warn('StarTab Media background: principal listener:', error)),
      media.refs.command.onSnapshot((snapshot) => {
        void handleCommandSnapshot(snapshot);
      }, (error) => console.warn('StarTab Media background: command listener:', error)),
    );
  }

  async function refreshRegistry(forcePublish = false) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'STARTAB_MEDIA_GET_REGISTRY' });
      if (response?.ok) {
        media.sessions = Array.isArray(response.sessions) ? response.sessions : [];
        if (forcePublish) await publishState(true);
      }
    } catch (_) {}
  }

  async function publishState(force = false) {
    if (!media.isLeader || !media.isPrincipal || !media.refs?.state || !media.uid) return;
    const sessions = normalizeSessions(media.sessions).map(serializeSession);
    if (!stateNeedsPublish(sessions, force)) return;
    const fingerprint = stableFingerprint(sessions);
    try {
      await media.refs.state.set({
        deviceId: mediaDeviceId(),
        deviceLabel: mediaDeviceLabel(),
        sessions,
        clientAt: Date.now(),
        serverAt: serverTimestamp(),
      }, { merge: false });
      media.lastPublishedFingerprint = fingerprint;
      media.lastPublishedSessions = sessions.map((item) => ({ ...item }));
      media.lastPublishedAt = Date.now();
    } catch (error) {
      console.warn('StarTab Media background: no se pudo publicar estado:', error);
    }
  }

  function schedulePublish(force = false) {
    if (!media.isLeader || !media.isPrincipal) return;
    if (force) {
      clearTimeout(media.publishTimer);
      media.publishTimer = window.setTimeout(() => {
        media.publishTimer = 0;
        void publishState(true);
      }, 50);
      return;
    }
    if (media.publishTimer) return;
    media.publishTimer = window.setTimeout(() => {
      media.publishTimer = 0;
      void publishState(false);
    }, 90);
  }

  async function publishHeartbeat(forceState = false) {
    if (!media.isLeader || !media.isPrincipal || !media.refs?.principal) return;
    try {
      await media.refs.principal.set({
        active: true,
        deviceId: mediaDeviceId(),
        deviceLabel: mediaDeviceLabel(),
        online: true,
        clientAt: Date.now(),
        serverAt: serverTimestamp(),
      }, { merge: true });
      if (forceState) await refreshRegistry(true);
    } catch (error) {
      // No explicit offline write is possible after a hard power/network loss.
      // Remote clients use clientAt staleness to switch to offline quickly.
      console.warn('StarTab Media background: heartbeat pendiente:', error);
    }
  }

  async function handleCommandSnapshot(snapshot) {
    if (!media.isLeader || !media.isPrincipal || !snapshot?.exists) return;
    const data = snapshot.data() || {};
    const id = String(data.id || '');
    if (!id || id === media.lastCommandId) return;
    if (data.targetDeviceId !== mediaDeviceId()) return;

    const issuedAt = Number(data.clientAt) || 0;
    if (!issuedAt || Date.now() - issuedAt > COMMAND_MAX_AGE_MS + 5_000) {
      media.lastCommandId = id;
      try { localStorage.setItem(LAST_COMMAND_KEY, id); } catch (_) {}
      return;
    }

    const activatedAt = Number(media.principal?.activatedAtClient) || 0;
    if (activatedAt && issuedAt < activatedAt - 1_500) return;

    media.lastCommandId = id;
    try { localStorage.setItem(LAST_COMMAND_KEY, id); } catch (_) {}

    const target = data.target || {};
    const command = data.command || {};
    try {
      await chrome.runtime.sendMessage({
        type: 'STARTAB_MEDIA_CONTROL',
        target: {
          tabId: Number(target.tabId),
          frameId: Number(target.frameId) || 0,
        },
        command: {
          action: command.action,
          value: command.value,
        },
      });
    } catch (_) {}

    await refreshRegistry(false);
    schedulePublish(true);
  }

  function startLeaderLock() {
    if (!navigator.locks?.request) {
      media.isLeader = true;
      void refreshRegistry(true);
      return;
    }

    // Intentionally queue for the same lock used by visible StarTab pages.
    // Once the visible page closes, this hidden bridge takes ownership instantly.
    navigator.locks.request(LEADER_LOCK, { mode: 'exclusive' }, async () => {
      media.isLeader = true;
      await refreshRegistry(true);
      await publishHeartbeat(true);
      await new Promise(() => {});
    }).catch((error) => {
      console.warn('StarTab Media background: no se pudo adquirir liderazgo:', error);
    });
  }

  function initFirebase() {
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      media.db = firebase.firestore();
      media.auth = firebase.auth();
      media.auth.onAuthStateChanged((user) => {
        media.authUser = user || null;
        void syncUser();
      });
      void syncUser();
    } catch (error) {
      console.error('StarTab Media background: Firebase init:', error);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'STARTAB_MEDIA_REGISTRY_UPDATE') {
      media.sessions = Array.isArray(message.sessions) ? message.sessions : [];
      schedulePublish(false);
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key === 'starTab_lastUser') void syncUser();
  });

  window.addEventListener('online', () => {
    void syncUser().then(() => publishHeartbeat(true));
  });

  window.setInterval(() => {
    void syncUser();
    if (media.isLeader && media.isPrincipal) void publishHeartbeat(false);
  }, HEARTBEAT_MS);

  initFirebase();
  startLeaderLock();
  void refreshRegistry(false);
})();

/* StarTab · Cloud navigation history writer v1 */
(() => {
  'use strict';

  const pending = [];
  const MAX_PENDING = 80;
  let db = null;
  let auth = null;
  let currentUser = null;
  let authResolved = false;
  let writeChain = Promise.resolve();

  function readSavedUser() {
    try {
      const raw = localStorage.getItem('starTab_lastUser');
      if (!raw) return null;
      const user = JSON.parse(raw);
      return user?.uid ? user : null;
    } catch (_) {
      return null;
    }
  }

  function refreshIdentity(authUser = null) {
    currentUser = authUser || readSavedUser() || null;
    return currentUser;
  }

  function sanitizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const url = String(raw.url || '').slice(0, 8192);
    if (!/^https?:\/\//i.test(url)) return null;
    const clientAt = Number(raw.clientAt) || Date.now();
    return {
      id: String(raw.id || `${clientAt}_${Math.random().toString(36).slice(2)}`).slice(0, 180),
      type: raw.type === 'search' ? 'search' : 'visit',
      url,
      domain: String(raw.domain || '').slice(0, 500),
      title: String(raw.title || '').slice(0, 1000),
      favicon: String(raw.favicon || '').slice(0, 8192),
      searchQuery: String(raw.searchQuery || '').slice(0, 500),
      searchEngine: String(raw.searchEngine || '').slice(0, 80),
      searchCategory: String(raw.searchCategory || '').slice(0, 80),
      clientAt,
      localIso: String(raw.localIso || new Date(clientAt).toISOString()).slice(0, 80),
      tabId: Number.isInteger(raw.tabId) ? raw.tabId : null,
      windowId: Number.isInteger(raw.windowId) ? raw.windowId : null,
      incognito: raw.incognito === true,
      transitionType: String(raw.transitionType || '').slice(0, 80),
      transitionQualifiers: Array.isArray(raw.transitionQualifiers)
        ? raw.transitionQualifiers.map((value) => String(value).slice(0, 80)).slice(0, 10)
        : [],
      source: String(raw.source || 'navigation').slice(0, 80),
    };
  }

  async function writeEntry(entry) {
    if (!db || !currentUser || !entry) return false;
    const ref = db.collection('users').doc(currentUser.uid).collection('history').doc(entry.id);
    await ref.set({
      ...entry,
      visitedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  }

  function enqueueWrite(entry) {
    writeChain = writeChain.catch(() => {}).then(async () => {
      try {
        await writeEntry(entry);
      } catch (error) {
        console.warn('StarTab History: no se pudo guardar una entrada en Firestore:', error);
      }
    });
  }

  function flushPending() {
    if (!currentUser) {
      pending.length = 0;
      return;
    }
    const batch = pending.splice(0, pending.length);
    batch.forEach(enqueueWrite);
  }

  function receiveEntry(raw) {
    const entry = sanitizeEntry(raw);
    if (!entry) return;
    if (!currentUser) refreshIdentity(auth?.currentUser || null);
    if (!authResolved && !currentUser) {
      pending.push(entry);
      if (pending.length > MAX_PENDING) pending.shift();
      return;
    }
    if (!currentUser) return;
    enqueueWrite(entry);
  }

  function init() {
    try {
      if (typeof firebase === 'undefined' || !firebase.apps?.length) return;
      db = firebase.firestore();
      auth = firebase.auth();
      refreshIdentity(auth.currentUser || null);
      auth.onAuthStateChanged((user) => {
        refreshIdentity(user || null);
        authResolved = true;
        flushPending();
      });
    } catch (error) {
      console.warn('StarTab History: Firebase no está disponible en offscreen:', error);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.target !== 'startab-history-offscreen') return;
    if (message.type === 'STARTAB_HISTORY_EVENT') receiveEntry(message.payload);
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== 'starTab_lastUser') return;
    refreshIdentity(auth?.currentUser || null);
    if (currentUser) flushPending();
  });

  window.setInterval(() => {
    refreshIdentity(auth?.currentUser || null);
  }, 3000);

  init();
})();
