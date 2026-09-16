(() => {
  'use strict';

  const ROOT = 'startab/v2';
  const ACTIVE_WATCH_REFRESH_MS = 12_000;
  const WATCH_TTL_MS = 32_000;
  const ONLINE_FRESH_MS = 65_000;
  const UNRESPONSIVE_MS = 105_000;
  const ACTIVE_ONLINE_FRESH_MS = 25_000;
  const ACTIVE_UNRESPONSIVE_MS = 45_000;
  const FIRESTORE_FALLBACK_STALE_MS = 120_000;

  const cache = new Map();
  const typeSubscriptions = new Map();
  const watcherSessions = new Map();
  let rtdb = null;
  let connected = null;
  let connectionBound = false;

  const clientId = (() => {
    try {
      const key = 'startab_presence_client_v2';
      const existing = sessionStorage.getItem(key);
      if (existing) return existing;
      const created = globalThis.crypto?.randomUUID?.() || `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(key, created);
      return created;
    } catch (_) {
      return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  })();

  function ensure() {
    if (rtdb) return rtdb;
    try {
      if (!globalThis.firebase?.apps?.length || typeof firebase.database !== 'function') return null;
      rtdb = firebase.database();
      if (!connectionBound) {
        connectionBound = true;
        rtdb.ref('.info/connected').on('value', (snap) => {
          connected = snap.val() === true;
          globalThis.dispatchEvent?.(new CustomEvent('startab-presence-connection', { detail: { connected } }));
        }, () => { connected = false; });
      }
      return rtdb;
    } catch (_) {
      return null;
    }
  }

  function typeKey(uid, type) { return `${uid}:${type}`; }
  function deviceKey(uid, type, deviceId) { return `${uid}:${type}:${deviceId}`; }
  function base(uid) { return `${ROOT}/users/${uid}`; }

  function normalizePresence(value) {
    if (!value || typeof value !== 'object') return null;
    return {
      ...value,
      lastSeen: Number(value.lastSeen || value.clientAt || 0),
      clientAt: Number(value.clientAt || value.lastSeen || 0),
      standby: value.standby === true,
      state: String(value.state || 'online'),
    };
  }

  function watchType(uid, type, callback) {
    const db = ensure();
    if (!db || !uid || !type) return () => {};
    const key = typeKey(uid, type);
    let entry = typeSubscriptions.get(key);
    if (!entry) {
      const listeners = new Set();
      const ref = db.ref(`${base(uid)}/presence/${type}`);
      const onValue = (snap) => {
        const raw = snap.val() || {};
        const next = new Map();
        Object.entries(raw).forEach(([deviceId, value]) => {
          const presence = normalizePresence(value);
          if (presence) {
            next.set(deviceId, presence);
            cache.set(deviceKey(uid, type, deviceId), presence);
          }
        });
        entry.lastMap = next;
        listeners.forEach((fn) => { try { fn(next); } catch (_) {} });
      };
      const onError = () => {
        entry.failed = true;
        listeners.forEach((fn) => { try { fn(entry.lastMap || new Map()); } catch (_) {} });
      };
      entry = { ref, listeners, onValue, onError, lastMap: new Map(), failed: false };
      typeSubscriptions.set(key, entry);
      ref.on('value', onValue, onError);
    }
    if (typeof callback === 'function') {
      entry.listeners.add(callback);
      if (entry.lastMap.size) queueMicrotask(() => callback(entry.lastMap));
    }
    return () => {
      if (typeof callback === 'function') entry.listeners.delete(callback);
      if (entry.listeners.size) return;
      try { entry.ref.off('value', entry.onValue); } catch (_) {}
      typeSubscriptions.delete(key);
    };
  }

  function presenceFor(uid, type, deviceId) {
    return cache.get(deviceKey(uid, type, deviceId)) || null;
  }

  function status(uid, type, deviceId, firestoreDevice, options = {}) {
    const now = Date.now();
    if (options.localConnected) {
      return { state: 'online', online: true, source: 'lan', age: 0, connected };
    }

    const live = presenceFor(uid, type, deviceId);
    const liveAt = Number(live?.lastSeen || 0);
    const fsAt = Number(firestoreDevice?.clientAt || 0);
    const liveAge = liveAt ? now - liveAt : Number.POSITIVE_INFINITY;
    const fsAge = fsAt ? now - fsAt : Number.POSITIVE_INFINITY;
    const freshMs = options.aggressive ? ACTIVE_ONLINE_FRESH_MS : ONLINE_FRESH_MS;
    const unresponsiveMs = options.aggressive ? ACTIVE_UNRESPONSIVE_MS : UNRESPONSIVE_MS;

    if (liveAt) {
      if (live?.state === 'offline' && liveAge > 2_000) {
        return { state: 'offline', online: false, source: 'rtdb', age: liveAge, connected };
      }
      if (liveAge <= freshMs) {
        return {
          state: live?.standby ? 'standby' : 'online',
          online: true,
          source: 'rtdb',
          age: liveAge,
          connected,
        };
      }
      if (liveAge <= unresponsiveMs) {
        return { state: 'unresponsive', online: false, source: 'rtdb', age: liveAge, connected };
      }
    }

    // Compatibilidad: si RTDB aún no está configurado/reglas no desplegadas,
    // el estado Firestore anterior sigue funcionando sin romper el control.
    if (firestoreDevice?.online === true && fsAge <= FIRESTORE_FALLBACK_STALE_MS) {
      return {
        state: firestoreDevice?.powerOn === false && type === 'tv' ? 'standby' : 'online',
        online: true,
        source: 'firestore',
        age: fsAge,
        connected,
      };
    }
    if (Math.min(liveAge, fsAge) <= unresponsiveMs) {
      return { state: 'unresponsive', online: false, source: liveAt ? 'rtdb' : 'firestore', age: Math.min(liveAge, fsAge), connected };
    }
    return { state: 'offline', online: false, source: liveAt ? 'rtdb' : 'firestore', age: Math.min(liveAge, fsAge), connected };
  }

  async function sendTvCommand(uid, deviceId, payload, ttlMs = 15_000) {
    const db = ensure();
    if (!db || !uid || !deviceId) return false;
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const envelope = {
      id,
      clientAt: Date.now(),
      expiresAtClient: Date.now() + Math.max(4_000, Number(ttlMs) || 15_000),
      payload: payload || {},
    };
    try {
      await db.ref(`${base(uid)}/devices/tv/${deviceId}/command`).set(envelope);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function removeWatcher(session) {
    clearInterval(session.timer);
    session.timer = 0;
    try { await session.ref.remove(); } catch (_) {}
  }

  async function setWatcher(uid, type, deviceId, active) {
    const db = ensure();
    const key = deviceKey(uid, type, deviceId);
    const existing = watcherSessions.get(key);
    if (!active || !db || !uid || !type || !deviceId) {
      if (existing) {
        watcherSessions.delete(key);
        await removeWatcher(existing);
      }
      return !!db;
    }
    if (existing) return true;

    const ref = db.ref(`${base(uid)}/devices/${type}/${deviceId}/watchers/${clientId}`);
    const session = { ref, timer: 0, uid, type, deviceId };
    watcherSessions.set(key, session);
    const tick = async () => {
      if (document.hidden) return;
      try {
        await ref.set({
          active: true,
          clientId,
          clientAt: Date.now(),
          lastSeen: firebase.database.ServerValue.TIMESTAMP,
          expiresAtClient: Date.now() + WATCH_TTL_MS,
        });
        try { ref.onDisconnect().remove(); } catch (_) {}
      } catch (_) {}
    };
    await tick();
    session.timer = window.setInterval(tick, ACTIVE_WATCH_REFRESH_MS);
    return true;
  }

  function stopAllWatchers() {
    [...watcherSessions.values()].forEach((session) => { void removeWatcher(session); });
    watcherSessions.clear();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      [...watcherSessions.values()].forEach(async (session) => {
        try {
          await session.ref.update({
            active: true,
            clientAt: Date.now(),
            lastSeen: firebase.database.ServerValue.TIMESTAMP,
            expiresAtClient: Date.now() + WATCH_TTL_MS,
          });
        } catch (_) {}
      });
    }
  });
  window.addEventListener('beforeunload', stopAllWatchers, { capture: true });

  globalThis.StarTabPresence = Object.freeze({
    ensure,
    watchType,
    presenceFor,
    status,
    sendTvCommand,
    setWatcher,
    stopAllWatchers,
    isRealtimeConnected: () => connected === true,
    clientId,
  });
})();
