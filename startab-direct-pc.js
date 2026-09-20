/* Authenticated Firestore signaling; encrypted WebRTC commands, no LAN credentials. */
(() => {
  'use strict';
  let peer = null, channel = null, ref = null, unsubscribe = null, key = '', generation = 0;
  let connecting = false, answered = false, lastAlive = 0, lastAttempt = 0, leaseAt = 0;
  const pending = new Map();
  function target() {
    const user = globalThis.firebase?.apps?.length ? firebase.auth().currentUser : null;
    return { uid: user?.uid || '', deviceId: document.getElementById('windows-device-select')?.value || '' };
  }
  function connected(uid, deviceId) {
    return key === `${uid}:${deviceId}` && channel?.readyState === 'open' && Date.now() - lastAlive < 10000;
  }
  function notify() { window.dispatchEvent(new CustomEvent('startab-direct-pc-change')); }
  function close() {
    generation++; connecting = false; answered = false;
    unsubscribe?.(); unsubscribe = null;
    const oldRef = ref; ref = null;
    const oldPeer = peer; peer = null; channel = null; key = '';
    try { oldPeer?.close(); } catch (_) {}
    if (oldRef) void oldRef.delete().catch(() => {});
    for (const entry of pending.values()) entry.finish(null);
    pending.clear(); notify();
  }
  async function connect(uid, deviceId) {
    close();
    if (!uid || !deviceId || document.hidden || !globalThis.RTCPeerConnection) return;
    connecting = true; lastAttempt = Date.now();
    const current = generation;
    key = `${uid}:${deviceId}`;
    const pc = new RTCPeerConnection({ iceServers:[{urls:'stun:stun.l.google.com:19302'}] });
    peer = pc;
    const dc = pc.createDataChannel('control', {ordered:true}); channel = dc;
    const session = firebase.firestore().collection('users').doc(uid).collection('windowsDevices').doc(deviceId)
      .collection('pointerSessions').doc(`control-${crypto.randomUUID?.() || Date.now()}`);
    ref = session;
    dc.onopen = () => { if (peer !== pc) return; lastAlive = Date.now(); connecting = false; notify(); };
    dc.onmessage = event => {
      if (peer !== pc) return;
      try {
        const value = JSON.parse(event.data); lastAlive = Date.now();
        if (value.t === 'commandAck') pending.get(value.id)?.finish({...value, acknowledged:true});
      } catch (_) {}
    };
    pc.onconnectionstatechange = () => {
      if (peer === pc && ['failed','closed'].includes(pc.connectionState)) close();
    };
    try {
      unsubscribe = session.onSnapshot(snapshot => {
        const data = snapshot.data();
        if (current !== generation || answered || !data?.answer?.sdp) return;
        answered = true;
        void pc.setRemoteDescription(data.answer).catch(() => { if (peer === pc) close(); });
      }, () => { if (peer === pc) close(); });
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise(resolve => {
        const timer = setTimeout(done, 2500);
        function done() { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); resolve(); }
        function check() { if (pc.iceGatheringState === 'complete') done(); }
        pc.addEventListener('icegatheringstatechange', check); check();
      });
      if (current !== generation) return;
      leaseAt = Date.now();
      void session.set({ sessionId: session.id, createdBy: uid, createdAtClient: leaseAt,
        expiresAtClient: leaseAt + 120000, protocol:3, offerId:session.id,
        offer:{type:pc.localDescription.type,sdp:pc.localDescription.sdp} }).catch(() => { if (peer === pc) close(); });
      setTimeout(() => { if (peer === pc && dc.readyState !== 'open') close(); }, 9000);
    } catch (_) { if (peer === pc) close(); }
  }
  async function send(uid, deviceId, envelope) {
    if (globalThis.chrome?.runtime?.id && localStorage.getItem('startab_windows_native_device_id_v1') === deviceId) {
      const status = await globalThis.StarTabTransport.deadline(chrome.runtime.sendMessage({type:'STARTAB_WINDOWS_NATIVE_GET_STATE'}),350);
      if (status?.connected && String(status.state?.deviceId) === deviceId) {
        const result = await globalThis.StarTabTransport.deadline(chrome.runtime.sendMessage({type:'STARTAB_WINDOWS_NATIVE_COMMAND',command:{type:'remoteCommand',envelope}}),1800);
        if (result && !['native-timeout','native-disconnected'].includes(result.reason)) return {...result,id:envelope.id,acknowledged:true};
      }
      return null;
    }
    if (!connected(uid, deviceId) || channel.bufferedAmount > 65536) return Promise.resolve(null);
    return new Promise(resolve => {
      const entry = { finish(value) { clearTimeout(timer); pending.delete(envelope.id); resolve(value); } };
      const timer = setTimeout(() => { entry.finish(null); close(); }, 1800);
      pending.set(envelope.id, entry);
      try { channel.send(JSON.stringify({t:'command', envelope})); } catch (_) { entry.finish(null); close(); }
    });
  }
  function tick() {
    const t = target();
    if (document.hidden || !t.uid || !t.deviceId) { if (peer) close(); return; }
    // Native messaging already handles this machine locally.
    if (globalThis.chrome?.runtime?.id && localStorage.getItem('startab_windows_native_device_id_v1') === t.deviceId) return;
    if (key && key !== `${t.uid}:${t.deviceId}`) close();
    if (!peer && !connecting && Date.now() - lastAttempt > 7000) void connect(t.uid,t.deviceId);
    if (channel?.readyState === 'open') {
      if (Date.now()-lastAlive > 10000) { close(); return; }
      try { channel.send(JSON.stringify({t:'ping'})); } catch (_) { close(); }
      if (ref && Date.now()-leaseAt > 45000) {
        leaseAt = Date.now(); void ref.set({expiresAtClient:leaseAt+120000},{merge:true}).catch(() => {});
      }
    }
  }
  setInterval(tick,2500);
  window.addEventListener('online', () => { lastAttempt = 0; tick(); });
  window.addEventListener('startab-device-selection-change', tick);
  document.addEventListener('visibilitychange', () => { lastAttempt = 0; tick(); });
  window.addEventListener('pagehide',close);
  globalThis.StarTabDirectPC = Object.freeze({send,isConnected:connected});
})();
