/* StarTab protocol 3: one immutable ID/expiry across direct, RTDB and Firestore. */
(() => {
  'use strict';
  const ROOT = 'startab/v2/users';
  const RTDB = 'https://startab-44e48-default-rtdb.firebaseio.com';
  const FS = 'https://firestore.googleapis.com/v1/projects/startab-44e48/databases/(default)/documents';
  const lanes = new Map();
  const clientId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  let sequence = 0;
  const deadline = (promise, ms, fallback = null) => new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), ms);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(fallback); });
  });
  function envelope(payload, ttl = 12000, id = '') {
    const at = Date.now();
    return { id: id || crypto.randomUUID?.() || `${at}-${Math.random()}`, clientAt: at,
      expiresAtClient: at + ttl, clientId, sequence: ++sequence, payload };
  }
  function field(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    if (typeof value === 'string') return { stringValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).map(([k,v]) => [k,field(v)])) } };
  }
  async function request(url, token, body, method = 'PUT', ms = 1600) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const response = await fetch(url, { method, signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return response.ok;
    } catch (_) { return false; } finally { clearTimeout(timer); }
  }
  async function patch(uid, type, deviceId, data, token) {
    const collection = type === 'windows' ? 'windowsDevices' : type === 'tv' ? 'tvDevices' : 'mediaRemote';
    const doc = type === 'media' ? `command_${deviceId}` : deviceId;
    const mask = Object.keys(data).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    return request(`${FS}/users/${encodeURIComponent(uid)}/${collection}/${encodeURIComponent(doc)}?${mask}`, token,
      { fields: Object.fromEntries(Object.entries(data).map(([k,v]) => [k,field(v)])) }, 'PATCH');
  }
  const ackHubs = new Map();
  function observeAck(uid, type, deviceId, id) {
    const key = `${uid}:${type}:${deviceId}`;
    let hub = ackHubs.get(key);
    if (!hub) {
      hub = {listeners:new Set(),recent:new Map(),cleanups:[],refs:0,timer:0}; ackHubs.set(key,hub);
      const accept = value => {
        if (!value?.id) return;
        hub.recent.set(value.id,{...value,acknowledged:true,ok:value.ok === true});
        while(hub.recent.size>64)hub.recent.delete(hub.recent.keys().next().value);
        for(const fn of hub.listeners)fn(value);
      };
      try {
        const ref = firebase.database().ref(`${ROOT}/${uid}/devices/${type}/${deviceId}/commandAck`);
        const fn = snap => accept(snap.val()); ref.on('value',fn,()=>{});
        hub.cleanups.push(()=>ref.off('value',fn));
      } catch (_) {}
      try {
        const col = type === 'windows' ? 'windowsDevices' : type === 'tv' ? 'tvDevices' : 'mediaRemote';
        hub.cleanups.push(firebase.firestore().collection('users').doc(uid).collection(col).doc(type==='media'?`state_${deviceId}`:deviceId)
          .onSnapshot(snap=>{if(!snap.metadata?.hasPendingWrites)accept(snap.data()?.commandResult);},()=>{}));
      } catch (_) {}
    }
    clearTimeout(hub.timer); hub.refs++;
    let latest = hub.recent.get(id) || null;
    const waiters = new Set();
    const accept = value => {
      if(value.id!==id)return;
      latest={...value,acknowledged:true,ok:value.ok===true};
      for(const resolve of waiters)resolve(latest);waiters.clear();
    };
    hub.listeners.add(accept);
    return {
      current:()=>latest,
      wait:ms=>latest?Promise.resolve(latest):new Promise(resolve=>{
        const done=value=>{clearTimeout(timer);waiters.delete(done);resolve(value);};
        const timer=setTimeout(()=>done(null),ms);waiters.add(done);
      }),
      close:()=>{
        hub.listeners.delete(accept);for(const resolve of waiters)resolve(null);waiters.clear();
        if(--hub.refs===0)hub.timer=setTimeout(()=>{hub.cleanups.forEach(fn=>fn());ackHubs.delete(key);},20000);
      }
    };
  }
  async function deliver(uid, type, deviceId, item) {
    const fail = reason => ({ ok:false, acknowledged:false, id:item.id, reason });
    if (!uid || !deviceId || Date.now() >= item.expiresAtClient) return fail('expired');
    const auth = firebase.auth().currentUser;
    if (!auth || auth.uid !== uid) return fail('authentication-required');
    if (type === 'windows') {
      const direct = await globalThis.StarTabDirectPC?.send?.(uid, deviceId, item);
      if (direct?.acknowledged) return direct;
    }
    const ack = observeAck(uid, type, deviceId, item.id);
    try {
      if (navigator.onLine === false) return fail('network-offline');
      const token = await deadline(auth.getIdToken(), 1600);
      if (!token) return fail('authentication-unavailable');
      if (Date.now() >= item.expiresAtClient) return fail('expired');
      const url = `${RTDB}/${ROOT}/${encodeURIComponent(uid)}/devices/${type}/${encodeURIComponent(deviceId)}/commands/${encodeURIComponent(item.id)}.json?auth=${encodeURIComponent(token)}`;
      // REST avoids the SDK's offline write queue replaying physical actions later.
      const written = await request(url, null, item);
      let result = ack.current() || (written ? await ack.wait(850) : null);
      if (result) return result;
      const data = type === 'windows'
        ? { command: { ...item.payload, ...item, payload: item.payload } }
        : { command: item };
      const fallbackWritten = await patch(uid, type, deviceId, data, token);
      result = ack.current() || (fallbackWritten ? await ack.wait(type === 'tv' ? 6500 : 2400) : null);
      return result || fail(written || fallbackWritten ? 'confirmation-timeout' : 'transport-unavailable');
    } finally { ack.close(); }
  }
  const queuedSetters = new Map();
  function setterKey(payload) {
    if (['setVolume','setMute'].includes(payload.action)) return payload.action;
    if (payload.volumeCommand) return 'volume';
    if (['brightness','mute'].includes(payload.actionCommand?.type)) return payload.actionCommand.type;
    return '';
  }
  function send(uid, type, deviceId, payload, ttl = 12000, id = '') {
    const item = id && typeof id === 'object' ? id : envelope(payload, ttl, id);
    const key = `${uid}:${type}:${deviceId}`;
    const setter = setterKey(payload), slot = setter ? `${key}:${setter}` : '';
    if(slot && queuedSetters.has(slot))queuedSetters.get(slot).cancelled=true;
    const entry={cancelled:false};if(slot)queuedSetters.set(slot,entry);
    const previous = lanes.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => {
      if(slot && queuedSetters.get(slot)===entry)queuedSetters.delete(slot);
      if(entry.cancelled)return {ok:false,acknowledged:false,id:item.id,reason:'superseded'};
      return deliver(uid, type, deviceId, item);
    })
      .catch(error => ({ ok:false, acknowledged:false, id:item.id, reason:String(error?.message || error) }));
    lanes.set(key, next);
    void next.finally(() => { if (lanes.get(key) === next) lanes.delete(key); });
    return next;
  }
  globalThis.StarTabTransport = Object.freeze({ send, envelope, deadline, field });
})();
