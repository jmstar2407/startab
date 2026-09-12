(() => {
  'use strict';

  const SELECTED_KEY = 'startab_google_tv_selected_v1';
  const PAIRINGS_KEY = 'startab_google_tv_pairings_v1';
  const DEVICE_STALE_MS = 75_000;
  const FIREBASE_MOTION_MS = 95;
  const state = {
    db: null, auth: null, user: null, devices: new Map(), unsubscribe: null,
    selectedId: '', ws: null, wsReady: false, wsConnecting: false,
    motionDx: 0, motionDy: 0, motionTimer: 0, scrollDy: 0, scrollTimer: 0,
    volumeTimer: 0, pendingVolume: null, optimisticVolume: null,
    pointerId: null, lastX: 0, lastY: 0, moved: false, downAt: 0,
  };
  const dom = {};
  const $ = id => document.getElementById(id);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, Number(n) || 0));
  const uid = () => state.auth?.currentUser?.uid || readUser()?.uid || '';
  const unique = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function readUser() { try { return JSON.parse(localStorage.getItem('starTab_lastUser') || 'null'); } catch (_) { return null; } }
  function readPairings() { try { return JSON.parse(localStorage.getItem(PAIRINGS_KEY) || '{}') || {}; } catch (_) { return {}; } }
  function savePairing(deviceId, data) { const p = readPairings(); p[deviceId] = { ...(p[deviceId] || {}), ...data }; localStorage.setItem(PAIRINGS_KEY, JSON.stringify(p)); }
  function pairingFor(id) { return readPairings()[id] || null; }

  function injectUi() {
    if ($('startab-tv-toggle')) return;
    const cursorButton = $('multimedia-cursor-toggle');
    if (cursorButton) {
      const b = document.createElement('button');
      b.id = 'startab-tv-toggle'; b.type = 'button'; b.className = 'startab-tv-toggle';
      b.title = 'Controlar Google TV'; b.setAttribute('aria-label', 'Controlar Google TV');
      b.innerHTML = '<svg aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.65" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="13" rx="2.5"></rect><path d="M8 21h8M12 18v3"></path><path d="m9 2 3 3 3-3"></path></svg>';
      cursorButton.insertAdjacentElement('afterend', b);
    }

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="startab-tv-modal" id="startab-tv-modal" aria-hidden="true">
        <div class="startab-tv-backdrop" id="startab-tv-backdrop"></div>
        <section class="startab-tv-card" role="dialog" aria-modal="true" aria-labelledby="startab-tv-title">
          <header class="startab-tv-head">
            <div><span>STARTAB · GOOGLE TV</span><h3 id="startab-tv-title">Control remoto del TV</h3><p>LAN directo cuando estás en casa · Firebase como respaldo remoto</p></div>
            <button id="startab-tv-close" type="button" aria-label="Cerrar">×</button>
          </header>
          <div class="startab-tv-device-row">
            <div class="startab-tv-status"><i id="startab-tv-led"></i><div><b id="startab-tv-status-title">Sin TV</b><small id="startab-tv-status-note">Vincula tu Google TV para comenzar.</small></div></div>
            <select id="startab-tv-device-select" aria-label="Google TV seleccionado"><option value="">Sin TVs vinculados</option></select>
          </div>
          <div class="startab-tv-pair" id="startab-tv-pair">
            <div><strong>Vincular un Google TV</strong><span>Abre StarTab TV en el televisor y copia la IP y el PIN que muestra.</span></div>
            <input id="startab-tv-ip" inputmode="decimal" placeholder="192.168.1.50" aria-label="IP del Google TV">
            <input id="startab-tv-pin" inputmode="numeric" maxlength="6" placeholder="PIN 6 dígitos" aria-label="PIN del Google TV">
            <button id="startab-tv-pair-btn" type="button">Vincular</button>
          </div>
          <div class="startab-tv-controls">
            <div class="startab-tv-touch-wrap">
              <div class="startab-tv-touch" id="startab-tv-touch" tabindex="0"><span>Desliza para mover el cursor</span></div>
              <div class="startab-tv-scroll" id="startab-tv-scroll"><span>⌃</span><b>SCROLL</b><span>⌄</span></div>
            </div>
            <div class="startab-tv-actions">
              <button id="startab-tv-left" type="button"><b>Clic</b><small>Seleccionar / abrir</small></button>
              <button id="startab-tv-back" type="button"><b>Atrás</b><small>Volver en Google TV</small></button>
            </div>
            <div class="startab-tv-volume">
              <button id="startab-tv-vol-down" type="button">−</button>
              <div><label for="startab-tv-volume">Volumen del TV <b id="startab-tv-volume-value">0%</b></label><input id="startab-tv-volume" type="range" min="0" max="100" step="1" value="0"></div>
              <button id="startab-tv-vol-up" type="button">+</button>
            </div>
          </div>
        </section>
      </div>`;
    document.body.append(...wrap.childNodes);
    cacheDom(); bindUi();
  }

  function cacheDom() {
    ['toggle','modal','backdrop','close','led','status-title','status-note','device-select','pair','ip','pin','pair-btn','touch','scroll','left','back','volume','volume-value','vol-down','vol-up'].forEach(k => {
      const id = `startab-tv-${k}`; dom[k.replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = $(id);
    });
  }

  function setStatus(kind, title, note) {
    if (dom.led) dom.led.dataset.state = kind;
    if (dom.statusTitle) dom.statusTitle.textContent = title;
    if (dom.statusNote) dom.statusNote.textContent = note;
  }

  function selectedDevice() { return state.devices.get(state.selectedId) || null; }
  function isOnline(d) { return !!d?.online && Date.now() - Number(d.clientAt || 0) < DEVICE_STALE_MS; }

  function render() {
    const d = selectedDevice();
    if (dom.deviceSelect) {
      const current = state.selectedId;
      dom.deviceSelect.innerHTML = '';
      if (!state.devices.size) dom.deviceSelect.add(new Option('Sin TVs vinculados', ''));
      else [...state.devices.values()].sort((a,b)=>String(a.deviceName).localeCompare(String(b.deviceName))).forEach(item => {
        const o = new Option(`${item.deviceName || 'Google TV'}${isOnline(item) ? '' : ' · sin conexión'}`, item.deviceId); dom.deviceSelect.add(o);
      });
      dom.deviceSelect.value = state.devices.has(current) ? current : '';
    }
    const volume = state.optimisticVolume ?? Number(d?.volume ?? 0);
    if (dom.volume) dom.volume.value = String(clamp(volume,0,100));
    if (dom.volumeValue) dom.volumeValue.textContent = `${Math.round(clamp(volume,0,100))}%`;

    if (!uid()) setStatus('error','Sin sesión','Inicia sesión en StarTab antes de vincular el TV.');
    else if (!d && state.selectedId) setStatus('warn','TV no sincronizado','Intentando leer el dispositivo desde Firebase…');
    else if (!d) setStatus('idle','Sin TV seleccionado','Vincula un Google TV o selecciona uno existente.');
    else if (state.wsReady) setStatus('direct','LAN directo',`${d.deviceName || 'Google TV'} · baja latencia`);
    else if (isOnline(d)) setStatus('firebase','Firebase',`${d.deviceName || 'Google TV'} · respaldo remoto activo`);
    else setStatus('error','Sin conexión',`${d.deviceName || 'Google TV'} no está disponible.`);
  }

  async function initFirebase(retry = 0) {
    try {
      if (!globalThis.firebase?.firestore) throw new Error('firebase-not-ready');
      state.db = firebase.firestore(); state.auth = firebase.auth?.() || null;
      state.user = state.auth?.currentUser || readUser();
      state.auth?.onAuthStateChanged?.(() => { state.user = state.auth.currentUser || readUser(); listenDevices(); });
      listenDevices();
    } catch (_) { if (retry < 40) setTimeout(()=>initFirebase(retry+1), 300); }
  }

  function listenDevices() {
    state.unsubscribe?.(); state.unsubscribe = null; state.devices.clear();
    const userId = uid(); if (!state.db || !userId) { render(); return; }
    state.unsubscribe = state.db.collection('users').doc(userId).collection('tvDevices').onSnapshot(snap => {
      state.devices.clear(); snap.forEach(doc => state.devices.set(doc.id, { deviceId: doc.id, ...doc.data() }));
      const saved = localStorage.getItem(SELECTED_KEY) || '';
      if (!state.selectedId) state.selectedId = state.devices.has(saved) ? saved : ([...state.devices.keys()][0] || '');
      if (state.selectedId && !state.devices.has(state.selectedId) && state.devices.size) state.selectedId = [...state.devices.keys()][0];
      if (state.selectedId) localStorage.setItem(SELECTED_KEY, state.selectedId);
      connectSelectedLocal(); render();
    }, () => render());
  }

  function closeWs() {
    state.wsReady = false; state.wsConnecting = false;
    try { state.ws?.close(); } catch (_) {} state.ws = null;
  }

  function localEndpoint(device) {
    const p = pairingFor(device?.deviceId || state.selectedId) || {};
    const ip = String(device?.localIp || p.ip || '').trim();
    const port = Number(device?.localPort || p.port || 8765);
    const secret = String(p.secret || '');
    return { ip, port, secret };
  }

  function connectSelectedLocal() {
    const d = selectedDevice(); if (!d || state.wsConnecting || state.wsReady) return;
    const { ip, port, secret } = localEndpoint(d); if (!ip || !secret) return;
    state.wsConnecting = true;
    let ws;
    try { ws = new WebSocket(`ws://${ip}:${port}`); } catch (_) { state.wsConnecting = false; return; }
    state.ws = ws;
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} }, 1600);
    ws.onopen = () => { clearTimeout(timer); ws.send(JSON.stringify({ type:'hello', secret })); };
    ws.onmessage = ev => {
      try {
        const data = JSON.parse(ev.data || '{}');
        if (data.type === 'state' && data.ok) { state.wsReady = true; state.wsConnecting = false; if (Number.isFinite(Number(data.volume))) state.optimisticVolume = Number(data.volume); render(); }
        if (data.type === 'ack' && Number.isFinite(Number(data.volume))) { state.optimisticVolume = Number(data.volume); render(); }
      } catch (_) {}
    };
    ws.onerror = () => {};
    ws.onclose = () => { clearTimeout(timer); if (state.ws === ws) { state.ws = null; state.wsReady = false; state.wsConnecting = false; render(); } };
  }

  function wsSend(obj) {
    if (!state.wsReady || state.ws?.readyState !== WebSocket.OPEN) return false;
    try { state.ws.send(JSON.stringify({ ...obj, secret: pairingFor(state.selectedId)?.secret || '' })); return true; } catch (_) { return false; }
  }

  function bytesToBase64(bytes) {
    let binary = ''; const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
    return btoa(binary);
  }
  function base64ToBytes(value) {
    const binary = atob(String(value || '')); const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  async function buildSecurePairPayload(serverPublicKeyB64, credentials, pin) {
    const serverKey = await crypto.subtle.importKey('spki', base64ToBytes(serverPublicKeyB64), { name:'ECDH', namedCurve:'P-256' }, false, []);
    const clientKeys = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveBits']);
    const sharedBits = await crypto.subtle.deriveBits({ name:'ECDH', public:serverKey }, clientKeys.privateKey, 256);
    const digest = await crypto.subtle.digest('SHA-256', sharedBits);
    const aesKey = await crypto.subtle.importKey('raw', digest, { name:'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const clear = new TextEncoder().encode(JSON.stringify({ pin, uid:credentials.uid, refreshToken:credentials.refreshToken }));
    const encrypted = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, aesKey, clear);
    const clientPublic = await crypto.subtle.exportKey('spki', clientKeys.publicKey);
    return { type:'pair-secure', clientPublicKey:bytesToBase64(clientPublic), iv:bytesToBase64(iv), payload:bytesToBase64(encrypted) };
  }

  async function pairTv() {
    const userId = uid(); const ip = String(dom.ip?.value || '').trim().replace(/^ws:\/\//,'').replace(/:\d+$/,'');
    const pin = String(dom.pin?.value || '').replace(/\D/g,'').slice(0,6);
    if (!userId) { setStatus('error','Sin sesión','Inicia sesión en StarTab primero.'); return; }
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || pin.length !== 6) { setStatus('error','Datos incompletos','Escribe la IP local y el PIN de 6 dígitos que muestra el TV.'); return; }
    setStatus('warn','Vinculando…','Conectando directamente con el Google TV.');
    let credentials = readUser();
    if (!credentials?.refreshToken && state.auth?.currentUser?.refreshToken) {
      credentials = { uid: state.auth.currentUser.uid, refreshToken: state.auth.currentUser.refreshToken };
    }
    if (!credentials?.refreshToken) {
      try { credentials = await globalThis.chrome?.runtime?.sendMessage?.({ type:'STARTAB_CAPTURE_FIREBASE_CREDENTIALS', uid:userId }); } catch (_) {}
    }
    if (!credentials?.refreshToken) { setStatus('error','Falta credencial','Abre nuevamente el inicio de sesión de StarTab y vuelve a intentar.'); return; }

    let ws;
    try { ws = new WebSocket(`ws://${ip}:8765`); } catch (_) { setStatus('error','No se pudo conectar','Verifica que ambos estén en la misma red Wi‑Fi.'); return; }
    const timeout = setTimeout(() => { try { ws.close(); } catch (_) {} setStatus('error','TV no encontrado','Verifica IP, red y que StarTab TV esté abierto.'); }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ type:'pair-init' }));
    ws.onmessage = async ev => {
      let data; try { data = JSON.parse(ev.data || '{}'); } catch (_) { return; }
      if (data.type === 'pair-init' && data.ok && data.publicKey) {
        try {
          const secure = await buildSecurePairPayload(data.publicKey, { uid:userId, refreshToken:credentials.refreshToken }, pin);
          ws.send(JSON.stringify(secure));
        } catch (_) {
          clearTimeout(timeout); try { ws.close(); } catch (_) {}
          setStatus('error','Error de seguridad','No se pudo cifrar el vínculo con el Google TV.');
        }
        return;
      }
      if (data.type !== 'paired' || !data.ok) {
        if (data.reason === 'pairing-rejected') setStatus('error','PIN incorrecto','Revisa el PIN mostrado en el Google TV.');
        return;
      }
      clearTimeout(timeout);
      savePairing(data.deviceId, { secret:data.secret, ip:data.ip || ip, port:data.port || 8765, name:data.deviceName || 'Google TV' });
      state.selectedId = data.deviceId; localStorage.setItem(SELECTED_KEY, data.deviceId);
      try { ws.close(); } catch (_) {}
      setStatus('direct','TV vinculado','Esperando la primera sincronización con Firebase…');
      setTimeout(() => { listenDevices(); connectSelectedLocal(); }, 700);
    };
    ws.onerror = () => {};
    ws.onclose = () => { clearTimeout(timeout); };
  }

  async function firebaseMerge(payload) {
    const d = selectedDevice(); if (!d || !state.db || !uid()) return false;
    const lease = { id: unique(), clientAt: Date.now(), expiresAtClient: Date.now() + 5000 };
    try { await state.db.collection('users').doc(uid()).collection('tvDevices').doc(d.deviceId).set({ ...payload, controlLease: lease }, { merge:true }); return true; } catch (_) { return false; }
  }

  function sendMove(dx,dy) {
    dx = clamp(dx,-500,500); dy = clamp(dy,-500,500); if (!dx && !dy) return;
    if (wsSend({ t:'move', dx:Math.round(dx), dy:Math.round(dy) })) return;
    state.motionDx += dx; state.motionDy += dy; if (state.motionTimer) return;
    state.motionTimer = setTimeout(() => {
      state.motionTimer = 0; const x=state.motionDx,y=state.motionDy; state.motionDx=state.motionDy=0;
      firebaseMerge({ motionRelay:{ id:unique(), dx:Math.round(x), dy:Math.round(y), clientAt:Date.now() } });
    }, FIREBASE_MOTION_MS);
  }

  function sendScroll(delta) {
    delta=clamp(delta,-720,720); if (!delta) return;
    if (wsSend({ t:'scroll', delta:Math.round(delta) })) return;
    state.scrollDy += delta; if (state.scrollTimer) return;
    state.scrollTimer=setTimeout(()=>{ state.scrollTimer=0; const value=state.scrollDy;state.scrollDy=0;firebaseMerge({scrollRelay:{id:unique(),delta:Math.round(value),clientAt:Date.now()}});},90);
  }

  function sendClick(button='left') {
    globalThis.StartabHaptics?.click?.(button);
    if (wsSend({ t:'click', button })) return;
    firebaseMerge({ clickRelay:{ id:unique(), button, clientAt:Date.now() } });
  }

  function sendBack() { if (wsSend({t:'back'})) return; firebaseMerge({backCommand:{id:unique(),clientAt:Date.now()}}); }

  function setVolume(value) {
    value=Math.round(clamp(value,0,100)); state.optimisticVolume=value; if(dom.volume)dom.volume.value=String(value);if(dom.volumeValue)dom.volumeValue.textContent=`${value}%`;
    if (wsSend({t:'volume',value})) return;
    state.pendingVolume=value; clearTimeout(state.volumeTimer); state.volumeTimer=setTimeout(()=>{const v=state.pendingVolume;state.pendingVolume=null;firebaseMerge({volumeCommand:{id:unique(),value:v,clientAt:Date.now()}});},85);
  }

  function bindTouch() {
    dom.touch?.addEventListener('pointerdown', e => { if(state.pointerId!==null)return; state.pointerId=e.pointerId;state.lastX=e.clientX;state.lastY=e.clientY;state.moved=false;state.downAt=performance.now();dom.touch.setPointerCapture?.(e.pointerId);e.preventDefault(); });
    dom.touch?.addEventListener('pointermove', e => { if(e.pointerId!==state.pointerId)return; const dx=e.clientX-state.lastX,dy=e.clientY-state.lastY;state.lastX=e.clientX;state.lastY=e.clientY;if(Math.abs(dx)+Math.abs(dy)>.5)state.moved=true;sendMove(dx*1.45,dy*1.45);e.preventDefault(); });
    const finish=e=>{if(e.pointerId!==state.pointerId)return;try{dom.touch.releasePointerCapture?.(e.pointerId)}catch(_){}const tap=!state.moved&&performance.now()-state.downAt<350;state.pointerId=null;if(tap)sendClick('left');e.preventDefault();};
    dom.touch?.addEventListener('pointerup',finish);dom.touch?.addEventListener('pointercancel',finish);
    let sp=null,sy=0;
    dom.scroll?.addEventListener('pointerdown',e=>{sp=e.pointerId;sy=e.clientY;dom.scroll.setPointerCapture?.(e.pointerId);e.preventDefault();});
    dom.scroll?.addEventListener('pointermove',e=>{if(e.pointerId!==sp)return;const dy=e.clientY-sy;sy=e.clientY;sendScroll(dy*2.2);e.preventDefault();});
    const sf=e=>{if(e.pointerId!==sp)return;sp=null;e.preventDefault();};dom.scroll?.addEventListener('pointerup',sf);dom.scroll?.addEventListener('pointercancel',sf);
  }

  function bindUi() {
    dom.toggle = $('startab-tv-toggle');
    dom.toggle?.addEventListener('click',()=>{dom.modal?.classList.add('is-open');dom.modal?.setAttribute('aria-hidden','false');connectSelectedLocal();render();});
    const close=()=>{dom.modal?.classList.remove('is-open');dom.modal?.setAttribute('aria-hidden','true');};
    dom.close?.addEventListener('click',close);dom.backdrop?.addEventListener('click',close);
    dom.pairBtn?.addEventListener('click',pairTv);
    dom.deviceSelect?.addEventListener('change',()=>{state.selectedId=dom.deviceSelect.value||'';localStorage.setItem(SELECTED_KEY,state.selectedId);closeWs();connectSelectedLocal();render();});
    dom.left?.addEventListener('click',()=>sendClick('left')); dom.back?.addEventListener('click',sendBack);
    dom.volume?.addEventListener('input',()=>setVolume(dom.volume.value));
    dom.volDown?.addEventListener('click',()=>setVolume((state.optimisticVolume ?? Number(selectedDevice()?.volume||0))-1));
    dom.volUp?.addEventListener('click',()=>setVolume((state.optimisticVolume ?? Number(selectedDevice()?.volume||0))+1));
    bindTouch();
  }

  function boot() { injectUi(); state.selectedId=localStorage.getItem(SELECTED_KEY)||''; initFirebase(); setInterval(()=>{if(state.selectedId&&!state.wsReady)connectSelectedLocal();render();},3500); setInterval(()=>{if(dom.modal?.classList.contains('is-open') && state.selectedId && !state.wsReady) firebaseMerge({});},1400); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true}); else boot();
})();
