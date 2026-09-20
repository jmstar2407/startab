(() => {
  'use strict';

  const ROOT = 'startab/v2';
  const ACTIVE_WATCH_REFRESH_MS = 12_000;
  const WATCH_TTL_MS = 34_000;
  const ONLINE_FRESH_MS = 75_000;
  const ACTIVE_ONLINE_FRESH_MS = 75_000;
  const UNRESPONSIVE_MS = 3 * 60_000;
  const ACTIVE_UNRESPONSIVE_MS = 3 * 60_000;
  const FIRESTORE_FALLBACK_STALE_MS = 90_000;
  const FIRESTORE_FALLBACK_WHEN_RTDB_DOWN_MS = 90_000;
  const SUBSCRIPTION_BOOTSTRAP_MS = 12_000;
  const BOOTSTRAP_FIRESTORE_MAX_AGE_MS = 24 * 60 * 60_000;
  const STANDBY_MEMORY_MS = 8 * 60 * 60_000;
  const COMMANDABLE_GRACE_MS = 15 * 60_000;
  const SIGNAL_SKEW_MS = 2_500;

  const cache = new Map();
  const typeSubscriptions = new Map();
  const watcherSessions = new Map();
  let rtdb = null;
  let connected = null;
  let connectionBound = false;

  const clientId = (() => {
    try {
      const key = 'startab_presence_client_v3';
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
          if (connected) for (const session of watcherSessions.values()) void session.tick?.();
          globalThis.dispatchEvent?.(new CustomEvent('startab-presence-connection', { detail: { connected } }));
        }, () => {
          connected = false;
          globalThis.dispatchEvent?.(new CustomEvent('startab-presence-connection', { detail: { connected } }));
        });
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
    const lastSeen = Number(value.lastSeen || value.clientAt || 0);
    return {
      ...value,
      lastSeen,
      clientAt: Number(value.clientAt || lastSeen || 0),
      standby: value.standby === true,
      state: String(value.state || 'online').toLowerCase(),
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
        for (const previousId of entry.lastMap.keys()) {
          if (!next.has(previousId)) cache.delete(deviceKey(uid, type, previousId));
        }
        entry.lastMap = next;
        entry.hasSnapshot = true;
        entry.failed = false;
        entry.lastSuccessAt = Date.now();
        listeners.forEach((fn) => { try { fn(next); } catch (_) {} });
      };
      const onError = () => {
        entry.failed = true;
        entry.lastErrorAt = Date.now();
        listeners.forEach((fn) => { try { fn(entry.lastMap || new Map()); } catch (_) {} });
      };
      entry = {
        ref, listeners, onValue, onError, lastMap: new Map(), failed: false,
        hasSnapshot: false, startedAt: Date.now(), lastSuccessAt: 0, lastErrorAt: 0,
      };
      typeSubscriptions.set(key, entry);
      ref.on('value', onValue, onError);
    }
    if (typeof callback === 'function') {
      entry.listeners.add(callback);
      if (entry.hasSnapshot) queueMicrotask(() => callback(entry.lastMap));
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

  function isStandalone(device) {
    const bridge = String(device?.bridge || '').toLowerCase();
    return device?.standalone === true || device?.cloudLinked === true || bridge === 'standalonenative';
  }

  function result(state, online, commandable, source, age, extra = {}) {
    return { state, online: !!online, commandable: !!commandable, source, age, connected, ...extra };
  }

  function status(uid, type, deviceId, firestoreDevice, options = {}) {
    const now = Date.now();
    const localState = String(options.localState || '').toLowerCase();
    const isTv = type === 'tv';

    if (options.localConnected || localState === 'online' || localState === 'direct') {
      return result('online', true, true, 'lan', Number(options.localAge || 0), { direct: true });
    }

    const subscription = typeSubscriptions.get(typeKey(uid, type)) || null;
    const live = presenceFor(uid, type, deviceId);
    const liveAt = Number(live?.lastSeen || live?.clientAt || 0);
    const fsAt = Number(firestoreDevice?.clientAt || 0);
    const liveAge = liveAt ? Math.max(0, now - liveAt) : Number.POSITIVE_INFINITY;
    const fsAge = fsAt ? Math.max(0, now - fsAt) : Number.POSITIVE_INFINITY;
    const freshMs = options.aggressive ? ACTIVE_ONLINE_FRESH_MS : ONLINE_FRESH_MS;
    const unresponsiveMs = options.aggressive ? ACTIVE_UNRESPONSIVE_MS : UNRESPONSIVE_MS;
    const standalone = isStandalone(firestoreDevice);

    const bootstrapWaiting = !!subscription && !subscription.hasSnapshot && !subscription.failed
      && now - Number(subscription.startedAt || now) <= SUBSCRIPTION_BOOTSTRAP_MS;

    const liveState = String(live?.state || '').toLowerCase();
    const livePositive = !!liveAt && liveState !== 'offline';
    const liveStandby = !!live?.standby || liveState === 'standby';
    const fsExplicitOnline = firestoreDevice?.online === true;
    const fsExplicitOffline = firestoreDevice?.online === false;
    const fsStandby = isTv && firestoreDevice?.powerOn === false;

    // Standby is a first-class reachable state. Android/Google TV can briefly
    // drop its process/network while the panel is off, but the device is still
    // a valid wake target. Preserve that state instead of flashing "offline".
    const standbyAt = Math.max(
      liveStandby ? liveAt : 0,
      fsStandby ? fsAt : 0,
    );
    const newestExplicitOnlineAt = Math.max(livePositive && !liveStandby ? liveAt : 0, fsExplicitOnline && !fsStandby ? fsAt : 0);
    if (isTv && standbyAt > 0 && now - standbyAt <= STANDBY_MEMORY_MS && newestExplicitOnlineAt <= standbyAt + SIGNAL_SKEW_MS && Math.max(liveState === 'offline' ? liveAt : 0, fsExplicitOffline ? fsAt : 0) <= standbyAt + SIGNAL_SKEW_MS) {
      return result('standby', now - standbyAt <= freshMs, true, liveStandby && liveAt >= fsAt ? 'rtdb' : 'firestore', now - standbyAt);
    }

    // Choose the newest positive signal. RTDB normally wins, but a newer
    // Firestore state update must be allowed to supersede a stale RTDB event.
    let positive = null;
    if (livePositive) positive = { at: liveAt, state: liveStandby ? 'standby' : 'online', source: 'rtdb' };
    if (fsExplicitOnline && (!positive || fsAt > positive.at + SIGNAL_SKEW_MS)) {
      positive = { at: fsAt, state: fsStandby ? 'standby' : 'online', source: 'firestore' };
    }

    let negative = null;
    if (liveAt && liveState === 'offline') negative = { at: liveAt, source: 'rtdb' };
    if (fsExplicitOffline && (!negative || fsAt > negative.at + SIGNAL_SKEW_MS)) negative = { at: fsAt, source: 'firestore' };

    // Newer positive evidence always wins over an older disconnect marker.
    if (positive && (!negative || positive.at + SIGNAL_SKEW_MS >= negative.at)) {
      const age = now - positive.at;
      if (age <= freshMs) return result(positive.state, true, true, positive.source, age);
      if (age <= unresponsiveMs) return result('unresponsive', false, true, positive.source, age);
      if (standalone && age <= COMMANDABLE_GRACE_MS) return result('reconnecting', false, true, positive.source, age);
    }

    // A fresh explicit offline event is authoritative, except for TV standby
    // handled above. Do not let an ancient `online:false` poison a reinstalled
    // standalone agent forever.
    if (negative) {
      const age = now - negative.at;
      if (age <= freshMs) return result('offline', false, false, negative.source, age, { explicitOffline: true });
      if (positive && positive.at > negative.at) {
        const positiveAge = now - positive.at;
        if (positiveAge <= unresponsiveMs) return result('unresponsive', false, true, positive.source, positiveAge);
      }
    }

    // Initial page load: keep a known standalone target usable while the first
    // RTDB snapshot arrives. This adds no writes and prevents false offline UI.
    if (!liveAt && bootstrapWaiting && standalone && fsAge <= BOOTSTRAP_FIRESTORE_MAX_AGE_MS) {
      return result('reconnecting', false, true, 'bootstrap', fsAge);
    }

    // If RTDB is unavailable, Firestore remains a compatibility/fallback signal.
    const firestoreGrace = connected === false || subscription?.failed
      ? FIRESTORE_FALLBACK_WHEN_RTDB_DOWN_MS
      : FIRESTORE_FALLBACK_STALE_MS;
    if (fsExplicitOnline && fsAge <= firestoreGrace) {
      return result(fsStandby ? 'standby' : 'online', true, true, 'firestore', fsAge);
    }

    // LAN failure is diagnostic only; it must not erase fresher cloud evidence.
    const newestAge = Math.min(liveAge, fsAge);
    if (localState === 'unresponsive' && newestAge > freshMs) {
      return result('unresponsive', false, standalone || isTv, 'lan', Number(options.localAge || newestAge));
    }
    if (newestAge <= unresponsiveMs) {
      return result('unresponsive', false, standalone || isTv, liveAt >= fsAt ? 'rtdb' : 'firestore', newestAge);
    }
    if (standalone && newestAge <= COMMANDABLE_GRACE_MS) {
      return result('reconnecting', false, true, liveAt >= fsAt ? 'rtdb' : 'firestore', newestAge);
    }
    return result('offline', false, false, localState === 'offline' ? 'lan' : (liveAt >= fsAt ? 'rtdb' : 'firestore'), newestAge);
  }

  function commandEnvelope(payload, ttlMs = 15_000) {
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = Date.now();
    return {
      id,
      clientAt: now,
      expiresAtClient: now + Math.max(4_000, Number(ttlMs) || 15_000),
      payload: payload || {},
    };
  }

  async function sendDeviceCommand(uid, type, deviceId, payload, ttlMs = 15_000) {
    const db = ensure();
    if (!db || !uid || !deviceId || !type) return false;
    try {
      await db.ref(`${base(uid)}/devices/${type}/${deviceId}/command`).set(commandEnvelope(payload, ttlMs));
      return true;
    } catch (_) {
      return false;
    }
  }

  function sendTvCommand(uid, deviceId, payload, ttlMs = 15_000) {
    return sendDeviceCommand(uid, 'tv', deviceId, payload, ttlMs);
  }

  async function sendWindowsCommand(uid, deviceId, payload, ttlMs = 20_000, ackTimeoutMs = 900) {
    const db = ensure();
    if (!db || !uid || !deviceId) return { ok: false, acknowledged: false, written: false, id: '' };

    const envelope = commandEnvelope(payload, ttlMs);
    const commandRef = db.ref(`${base(uid)}/devices/windows/${deviceId}/command`);
    const ackRef = db.ref(`${base(uid)}/devices/windows/${deviceId}/commandAck`);

    let ackHandler = null;
    let timer = 0;
    let settled = false;

    const ackPromise = new Promise((resolve) => {
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { ackRef.off('value', ackHandler); } catch (_) {}
        resolve(value);
      };
      ackHandler = (snap) => {
        const value = snap.val();
        if (!value || typeof value !== 'object' || String(value.id || '') !== envelope.id) return;
        finish({
          ok: value.ok === true,
          acknowledged: true,
          written: true,
          id: envelope.id,
          reason: String(value.reason || ''),
        });
      };
      ackRef.on('value', ackHandler, () => finish({
        ok: false, acknowledged: false, written: true, id: envelope.id, reason: 'ack-listener-error',
      }));
      timer = window.setTimeout(() => finish({
        ok: false, acknowledged: false, written: true, id: envelope.id, reason: 'ack-timeout',
      }), Math.max(350, Number(ackTimeoutMs) || 900));
    });

    try {
      await commandRef.set(envelope);
    } catch (_) {
      clearTimeout(timer);
      try { ackRef.off('value', ackHandler); } catch (_) {}
      settled = true;
      return { ok: false, acknowledged: false, written: false, id: envelope.id, reason: 'write-failed' };
    }

    return ackPromise;
  }

  async function removeWatcher(session) {
    clearInterval(session.timer);
    session.timer = 0;
    try { await session.ref.remove(); } catch (_) {}
  }

  async function setWatcher(uid, type, deviceId, active, owner = 'default') {
    const db = ensure();
    if (!uid || !type || !deviceId) return !!db;
    const key = deviceKey(uid, type, deviceId);
    const ownerId = String(owner || 'default');
    let session = watcherSessions.get(key);

    if (!active || !db) {
      if (!session) return !!db;
      session.owners.delete(ownerId);
      if (session.owners.size) return !!db;
      watcherSessions.delete(key);
      await removeWatcher(session);
      return !!db;
    }

    if (session) {
      session.owners.add(ownerId);
      return true;
    }

    const ref = db.ref(`${base(uid)}/devices/${type}/${deviceId}/watchers/${clientId}`);
    session = { ref, timer: 0, uid, type, deviceId, owners: new Set([ownerId]) };
    watcherSessions.set(key, session);
    const tick = async () => {
      if (document.hidden || !session.owners.size) return;
      try {
        void ref.onDisconnect().remove().catch(() => {});
        await ref.set({
          active: true,
          clientId,
          clientAt: Date.now(),
          lastSeen: firebase.database.ServerValue.TIMESTAMP,
          expiresAtClient: Date.now() + WATCH_TTL_MS,
        });

      } catch (_) {}
    };
    session.tick = tick;
    void tick();
    session.timer = window.setInterval(tick, ACTIVE_WATCH_REFRESH_MS);
    return true;
  }

  function stopAllWatchers() {
    [...watcherSessions.values()].forEach((session) => { void removeWatcher(session); });
    watcherSessions.clear();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    [...watcherSessions.values()].forEach((session) => { void session.tick?.(); });
  });
  window.addEventListener('beforeunload', stopAllWatchers, { capture: true });

  globalThis.StarTabPresence = Object.freeze({
    ensure,
    watchType,
    presenceFor,
    status,
    sendTvCommand,
    sendWindowsCommand,
    setWatcher,
    stopAllWatchers,
    isRealtimeConnected: () => connected === true,
    clientId,
  });
})();
