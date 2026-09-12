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
    cameraStream: null, scannerActive: false, scanTimer: 0, scanBusy: false, barcodeDetector: null,
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
            <div><span>STARTAB · GOOGLE TV</span><h3 id="startab-tv-title">Control remoto del TV</h3><p>LAN directo en la misma red · Firebase cuando estás fuera de casa</p></div>
            <button id="startab-tv-close" type="button" aria-label="Cerrar">×</button>
          </header>

          <div class="startab-tv-body">
            <div class="startab-tv-device-row">
              <div class="startab-tv-status"><i id="startab-tv-led"></i><div><b id="startab-tv-status-title">Sin TV</b><small id="startab-tv-status-note">Escanea el QR del Google TV para comenzar.</small></div></div>
              <select id="startab-tv-device-select" aria-label="Google TV seleccionado"><option value="">Sin TVs vinculados</option></select>
            </div>

            <div class="startab-tv-pair" id="startab-tv-pair">
              <div class="startab-tv-pair-copy">
                <strong>Vincular un Google TV</strong>
                <span>En el TV abre StarTab TV. Luego escanea el código que aparece en pantalla.</span>
              </div>
              <button id="startab-tv-scan-btn" type="button">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h8v6H8z"></path></svg>
                <span>Escanear código QR</span>
              </button>
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
          </div>

          <footer class="startab-tv-footer">
            <div><b>StarTab TV</b><span>El QR usa un vínculo temporal y cifrado. No necesitas escribir IP ni PIN.</span></div>
            <button id="startab-tv-footer-close" type="button">Cerrar</button>
          </footer>
        </section>

        <div class="startab-tv-scanner" id="startab-tv-scanner" aria-hidden="true">
          <div class="startab-tv-scanner-backdrop"></div>
          <section class="startab-tv-scanner-card" role="dialog" aria-modal="true" aria-labelledby="startab-tv-scanner-title">
            <header class="startab-tv-scanner-head">
              <div><span>EMPAREJAMIENTO</span><h3 id="startab-tv-scanner-title">Escanear código QR</h3></div>
              <button id="startab-tv-scanner-close" type="button" aria-label="Cerrar escáner">×</button>
            </header>
            <div class="startab-tv-scanner-body">
              <div class="startab-tv-camera-stage">
                <video id="startab-tv-scanner-video" playsinline muted></video>
                <div class="startab-tv-camera-shade"></div>
                <div class="startab-tv-camera-frame"><i></i><i></i><i></i><i></i></div>
              </div>
              <p id="startab-tv-scanner-note">Apunta la cámara al QR que aparece en StarTab TV.</p>
            </div>
            <footer class="startab-tv-scanner-footer">
              <span>La cámara solo se usa mientras este escáner está abierto.</span>
              <button id="startab-tv-scanner-cancel" type="button">Cancelar</button>
            </footer>
          </section>
        </div>
      </div>`;
    document.body.append(...wrap.childNodes);
    cacheDom(); bindUi();
  }

  function cacheDom() {
    [
      'toggle','modal','backdrop','close','led','status-title','status-note','device-select','pair',
      'scan-btn','touch','scroll','left','back','volume','volume-value','vol-down','vol-up','footer-close',
      'scanner','scanner-video','scanner-note','scanner-close','scanner-cancel'
    ].forEach(k => {
      const id = `startab-tv-${k}`;
      dom[k.replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = $(id);
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

  function parsePairQr(rawValue) {
    try {
      const url = new URL(String(rawValue || '').trim());
      if (url.protocol !== 'startabtv:' || url.hostname !== 'pair') return null;
      const ip = String(url.searchParams.get('ip') || '').trim();
      const pin = String(url.searchParams.get('pin') || '').replace(/\D/g, '').slice(0, 6);
      const port = Number(url.searchParams.get('port') || 8765);
      const version = Number(url.searchParams.get('v') || 1);
      if (version !== 1 || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || pin.length !== 6 || !Number.isInteger(port) || port < 1 || port > 65535) return null;
      const octets = ip.split('.').map(Number);
      if (octets.some(n => n < 0 || n > 255)) return null;
      return { ip, pin, port, deviceId: String(url.searchParams.get('device') || '') };
    } catch (_) { return null; }
  }

  async function pairTv(pairData) {
    const userId = uid();
    const ip = String(pairData?.ip || '').trim();
    const pin = String(pairData?.pin || '').replace(/\D/g, '').slice(0,6);
    const port = Number(pairData?.port || 8765);
    if (!userId) { setStatus('error','Sin sesión','Inicia sesión en StarTab primero.'); return; }
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || pin.length !== 6 || !Number.isInteger(port)) {
      setStatus('error','QR no válido','Escanea únicamente el QR generado por StarTab TV.'); return;
    }
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
    try { ws = new WebSocket(`ws://${ip}:${port}`); } catch (_) { setStatus('error','No se pudo conectar','Verifica que el móvil y el TV estén en la misma red Wi‑Fi.'); return; }
    const timeout = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      setStatus('error','TV no encontrado','El QR puede haber vencido o el móvil y el TV no están en la misma red.');
    }, 5500);
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
        if (data.reason === 'pairing-rejected') setStatus('error','QR vencido','Genera un nuevo QR en el Google TV y vuelve a escanearlo.');
        return;
      }
      clearTimeout(timeout);
      savePairing(data.deviceId, { secret:data.secret, ip:data.ip || ip, port:data.port || port, name:data.deviceName || 'Google TV' });
      state.selectedId = data.deviceId; localStorage.setItem(SELECTED_KEY, data.deviceId);
      try { ws.close(); } catch (_) {}
      setStatus('direct','TV vinculado','Conexión segura completada.');
      setTimeout(() => { listenDevices(); connectSelectedLocal(); }, 700);
    };
    ws.onerror = () => {};
    ws.onclose = () => { clearTimeout(timeout); };
  }

  function setScannerNote(message, kind = '') {
    if (!dom.scannerNote) return;
    dom.scannerNote.textContent = message;
    dom.scannerNote.dataset.state = kind;
  }

  function stopQrScanner() {
    state.scannerActive = false;
    state.scanBusy = false;
    clearTimeout(state.scanTimer); state.scanTimer = 0;
    if (state.cameraStream) {
      try { state.cameraStream.getTracks().forEach(track => track.stop()); } catch (_) {}
      state.cameraStream = null;
    }
    if (dom.scannerVideo) {
      try { dom.scannerVideo.pause(); } catch (_) {}
      dom.scannerVideo.srcObject = null;
    }
    dom.scanner?.classList.remove('is-open');
    dom.scanner?.setAttribute('aria-hidden','true');
  }

  async function scanQrFrame() {
    if (!state.scannerActive || !state.barcodeDetector || !dom.scannerVideo) return;
    if (state.scanBusy || dom.scannerVideo.readyState < 2) {
      state.scanTimer = setTimeout(scanQrFrame, 120);
      return;
    }
    state.scanBusy = true;
    try {
      const results = await state.barcodeDetector.detect(dom.scannerVideo);
      const raw = results?.[0]?.rawValue || '';
      if (raw) {
        const pair = parsePairQr(raw);
        if (pair) {
          globalThis.StartabHaptics?.success?.();
          setScannerNote('QR detectado. Vinculando con el TV…', 'ok');
          stopQrScanner();
          await pairTv(pair);
          return;
        }
        setScannerNote('Ese QR no pertenece a StarTab TV. Busca el QR que aparece en el televisor.', 'error');
      }
    } catch (_) {}
    state.scanBusy = false;
    state.scanTimer = setTimeout(scanQrFrame, 120);
  }

  async function openQrScanner() {
    if (!uid()) { setStatus('error','Sin sesión','Inicia sesión en StarTab antes de escanear el TV.'); return; }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error','Cámara no disponible','Abre StarTab desde un navegador seguro compatible con cámara.');
      return;
    }
    if (!('BarcodeDetector' in globalThis)) {
      setStatus('error','Escáner no compatible','Actualiza Chrome/Edge en el móvil para usar el lector QR integrado.');
      return;
    }

    dom.scanner?.classList.add('is-open');
    dom.scanner?.setAttribute('aria-hidden','false');
    setScannerNote('Solicitando acceso a la cámara…');

    try {
      const supported = await BarcodeDetector.getSupportedFormats?.();
      if (Array.isArray(supported) && !supported.includes('qr_code')) throw new Error('qr-not-supported');
      state.barcodeDetector = new BarcodeDetector({ formats:['qr_code'] });
      state.cameraStream = await navigator.mediaDevices.getUserMedia({
        audio:false,
        video:{ facingMode:{ ideal:'environment' }, width:{ ideal:1280 }, height:{ ideal:720 } }
      });
      dom.scannerVideo.srcObject = state.cameraStream;
      await dom.scannerVideo.play();
      state.scannerActive = true;
      setScannerNote('Apunta la cámara al QR que aparece en StarTab TV.');
      scanQrFrame();
    } catch (error) {
      stopQrScanner();
      const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
      setStatus(
        'error',
        denied ? 'Permiso de cámara bloqueado' : 'No se pudo abrir la cámara',
        denied ? 'Permite la cámara para StarTab y vuelve a tocar “Escanear código QR”.' : 'Verifica que ninguna otra app esté usando la cámara.'
      );
    }
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
    dom.toggle?.addEventListener('click',()=>{
      dom.modal?.classList.add('is-open');
      dom.modal?.setAttribute('aria-hidden','false');
      document.documentElement.classList.add('startab-tv-modal-open');
      connectSelectedLocal(); render();
    });
    const close=()=>{
      stopQrScanner();
      dom.modal?.classList.remove('is-open');
      dom.modal?.setAttribute('aria-hidden','true');
      document.documentElement.classList.remove('startab-tv-modal-open');
    };
    dom.close?.addEventListener('click',close);
    dom.footerClose?.addEventListener('click',close);
    dom.backdrop?.addEventListener('click',close);
    dom.scanBtn?.addEventListener('click',openQrScanner);
    dom.scannerClose?.addEventListener('click',stopQrScanner);
    dom.scannerCancel?.addEventListener('click',stopQrScanner);
    dom.scanner?.querySelector('.startab-tv-scanner-backdrop')?.addEventListener('click',stopQrScanner);
    dom.deviceSelect?.addEventListener('change',()=>{state.selectedId=dom.deviceSelect.value||'';localStorage.setItem(SELECTED_KEY,state.selectedId);closeWs();connectSelectedLocal();render();});
    dom.left?.addEventListener('click',()=>sendClick('left')); dom.back?.addEventListener('click',sendBack);
    dom.volume?.addEventListener('input',()=>setVolume(dom.volume.value));
    dom.volDown?.addEventListener('click',()=>setVolume((state.optimisticVolume ?? Number(selectedDevice()?.volume||0))-1));
    dom.volUp?.addEventListener('click',()=>setVolume((state.optimisticVolume ?? Number(selectedDevice()?.volume||0))+1));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && dom.scanner?.classList.contains('is-open')) { stopQrScanner(); e.preventDefault(); return; }
      if (e.key === 'Escape' && dom.modal?.classList.contains('is-open')) { close(); e.preventDefault(); }
    });
    bindTouch();
  }

  function boot() { injectUi(); state.selectedId=localStorage.getItem(SELECTED_KEY)||''; initFirebase(); setInterval(()=>{if(state.selectedId&&!state.wsReady)connectSelectedLocal();render();},3500); setInterval(()=>{if(dom.modal?.classList.contains('is-open') && state.selectedId && !state.wsReady) firebaseMerge({});},1400); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true}); else boot();
})();
