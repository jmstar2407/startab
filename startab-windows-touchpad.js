(() => {
  'use strict';

  const FIREBASE_RETRY_MS = 300;
  const FIREBASE_MAX_RETRIES = 40;
  const DEVICE_STALE_MS = 90_000;
  const SESSION_TTL_MS = 5 * 60_000;
  const RELAY_INTERVAL_MS = 95;
  const ICE_TIMEOUT_MS = 3200;
  const SELECTED_DEVICE_KEY = 'startab_windows_volume_selected_device_v2';
  const CLIENT_ID_KEY = 'startab_windows_pointer_client_v1';
  const RTC_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  const state = {
    db: null,
    auth: null,
    user: null,
    firebaseRetry: 0,
    open: false,
    sessionId: null,
    sessionRef: null,
    unsubscribeSession: null,
    pc: null,
    motionChannel: null,
    controlChannel: null,
    remoteDescriptionSet: false,
    deviceId: null,
    deviceName: '',
    pointerId: null,
    lastX: 0,
    lastY: 0,
    moved: false,
    downAt: 0,
    motionDx: 0,
    motionDy: 0,
    raf: 0,
    relayTimer: 0,
    relayDx: 0,
    relayDy: 0,
    relaySeq: 0,
    clickSeq: 0,
  };

  const dom = {};
  const $ = (id) => document.getElementById(id);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  function supportsPointerAgent(version) {
    const parts = String(version || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
    return (parts[0] || 0) > 2 || ((parts[0] || 0) === 2 && (parts[1] || 0) >= 2);
  }

  const clientId = (() => {
    try {
      const existing = sessionStorage.getItem(CLIENT_ID_KEY);
      if (existing) return existing;
      const value = crypto.randomUUID?.() || `pointer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(CLIENT_ID_KEY, value);
      return value;
    } catch (_) {
      return `pointer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  })();

  function cacheDom() {
    dom.toggle = $('multimedia-cursor-toggle');
    dom.modal = $('windows-touchpad-modal');
    dom.backdrop = $('windows-touchpad-backdrop');
    dom.close = $('windows-touchpad-close');
    dom.surface = $('windows-touchpad-surface');
    dom.left = $('windows-touchpad-left');
    dom.right = $('windows-touchpad-right');
    dom.connection = $('windows-touchpad-connection');
    dom.connectionText = dom.connection?.querySelector('span');
    dom.device = $('windows-touchpad-device');
    dom.hint = $('windows-touchpad-hint');
    dom.note = $('windows-touchpad-note');
    dom.deviceSelect = $('windows-device-select');
  }

  function readSavedUser() {
    try {
      const raw = localStorage.getItem('starTab_lastUser');
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.uid ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function currentUser() {
    try {
      const authUser = state.auth?.currentUser;
      if (authUser?.uid) return { uid: authUser.uid, email: authUser.email || '' };
    } catch (_) {}
    return readSavedUser();
  }

  function setStatus(kind, text, note = '') {
    if (dom.connection) dom.connection.dataset.state = kind;
    if (dom.connectionText) dom.connectionText.textContent = text;
    if (note && dom.note) dom.note.textContent = note;
  }

  function selectedDeviceId() {
    const selectValue = String(dom.deviceSelect?.value || '').trim();
    if (selectValue) return selectValue;
    try {
      const raw = localStorage.getItem(SELECTED_DEVICE_KEY) || '';
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      if (parsed?.uid && parsed.uid === state.user?.uid && parsed?.deviceId) return String(parsed.deviceId);
      return '';
    } catch (_) {
      return '';
    }
  }

  async function getSelectedDevice() {
    state.user = currentUser();
    const deviceId = selectedDeviceId();
    if (!state.db || !state.user?.uid || !deviceId) return null;
    const ref = state.db.collection('users').doc(state.user.uid).collection('windowsDevices').doc(deviceId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() || {};
    const online = !!data.online && Number(data.clientAt) > 0 && Date.now() - Number(data.clientAt) < DEVICE_STALE_MS;
    return { ref, data: { ...data, deviceId }, online };
  }

  function waitForIceGathering(pc, timeout = ICE_TIMEOUT_MS) {
    if (!pc || pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', onState);
        resolve();
      };
      const onState = () => { if (pc.iceGatheringState === 'complete') finish(); };
      const timer = setTimeout(finish, timeout);
      pc.addEventListener('icegatheringstatechange', onState);
    });
  }

  function channelOpen(channel) {
    return !!channel && channel.readyState === 'open';
  }

  function updateTransportStatus() {
    if (!state.open) return;
    if (channelOpen(state.motionChannel) && channelOpen(state.controlChannel)) {
      setStatus('connected', 'Directo', 'Conexión WebRTC directa: movimientos y clics con baja latencia.');
      return;
    }
    if (state.pc && ['new', 'connecting'].includes(state.pc.connectionState)) {
      setStatus('connecting', 'Conectando', 'Estableciendo canal directo; StarTab usa Firebase como respaldo mientras conecta.');
      return;
    }
    setStatus('relay', 'Firebase', 'Modo de respaldo activo. El cursor funciona, aunque con un poco más de latencia.');
  }

  function closePeer() {
    try { state.motionChannel?.close(); } catch (_) {}
    try { state.controlChannel?.close(); } catch (_) {}
    try { state.pc?.close(); } catch (_) {}
    state.motionChannel = null;
    state.controlChannel = null;
    state.pc = null;
    state.remoteDescriptionSet = false;
  }

  async function cleanupSession(removeRemote = true) {
    state.unsubscribeSession?.();
    state.unsubscribeSession = null;
    closePeer();
    clearTimeout(state.relayTimer);
    state.relayTimer = 0;
    state.relayDx = 0;
    state.relayDy = 0;
    const ref = state.sessionRef;
    state.sessionRef = null;
    state.sessionId = null;
    if (removeRemote && ref) {
      try { await ref.delete(); } catch (_) {}
    }
  }

  async function createRtcOffer() {
    if (!state.sessionRef || !globalThis.RTCPeerConnection) {
      updateTransportStatus();
      return;
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    state.pc = pc;
    state.motionChannel = pc.createDataChannel('motion', { ordered: false, maxRetransmits: 0 });
    state.controlChannel = pc.createDataChannel('control', { ordered: true });

    const handleChannel = (channel) => {
      if (!channel) return;
      channel.addEventListener('open', updateTransportStatus);
      channel.addEventListener('close', updateTransportStatus);
      channel.addEventListener('error', updateTransportStatus);
    };
    handleChannel(state.motionChannel);
    handleChannel(state.controlChannel);

    pc.addEventListener('connectionstatechange', updateTransportStatus);
    pc.addEventListener('iceconnectionstatechange', updateTransportStatus);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);
    if (!state.sessionRef || !pc.localDescription) return;

    await state.sessionRef.set({
      offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      offerId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      transport: 'webrtc-with-firestore-relay',
      updatedAtClient: Date.now(),
    }, { merge: true });
  }

  async function beginSession() {
    await cleanupSession(true);
    if (!state.db) {
      setStatus('error', 'Sin Firebase', 'Firebase todavía no está disponible en StarTab.');
      return;
    }

    let device;
    try { device = await getSelectedDevice(); } catch (error) {
      console.error('StarTab Touchpad: no se pudo leer el PC:', error);
      setStatus('error', 'Error', 'No se pudo consultar el PC seleccionado.');
      return;
    }

    if (!state.user?.uid) {
      setStatus('error', 'Sin sesión', 'Inicia sesión en StarTab para controlar tu PC.');
      if (dom.device) dom.device.textContent = 'Inicia sesión con la misma cuenta del PC.';
      return;
    }
    if (!device) {
      setStatus('error', 'Sin PC', 'Selecciona primero un PC en “Volumen del sistema”.');
      if (dom.device) dom.device.textContent = 'No hay un PC Windows seleccionado.';
      return;
    }

    state.deviceId = device.data.deviceId;
    state.deviceName = device.data.deviceName || 'PC Windows';
    if (dom.device) dom.device.textContent = `${state.deviceName} · ${String(state.deviceId).slice(0, 8)}…`;
    if (!device.online) {
      setStatus('error', 'Desconectado', 'El PC seleccionado no está en línea.');
      return;
    }
    if (!supportsPointerAgent(device.data.agentVersion)) {
      setStatus('error', 'Actualiza EXE', 'Este PC usa un agente anterior. Compila e instala StartabWindowsVolume.exe v2.2 para habilitar el cursor remoto.');
      return;
    }

    state.sessionId = `${clientId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 42)}-${Date.now().toString(36)}`;
    state.sessionRef = device.ref.collection('pointerSessions').doc(state.sessionId);
    setStatus('connecting', 'Conectando', 'Preparando el touchpad remoto…');

    try {
      await state.sessionRef.set({
        sessionId: state.sessionId,
        clientId,
        createdBy: state.user.uid,
        createdAtClient: Date.now(),
        expiresAtClient: Date.now() + SESSION_TTL_MS,
        status: 'offering',
        protocol: 1,
      }, { merge: true });

      state.unsubscribeSession = state.sessionRef.onSnapshot((snapshot) => {
        if (!snapshot.exists || !state.pc || state.remoteDescriptionSet) return;
        const data = snapshot.data() || {};
        if (!data.answer?.sdp || !data.answer?.type) return;
        state.remoteDescriptionSet = true;
        state.pc.setRemoteDescription(data.answer).then(updateTransportStatus).catch((error) => {
          console.warn('StarTab Touchpad: respuesta WebRTC inválida:', error);
          state.remoteDescriptionSet = false;
          updateTransportStatus();
        });
      }, (error) => console.warn('StarTab Touchpad: listener de sesión:', error));

      await createRtcOffer();
      updateTransportStatus();
    } catch (error) {
      console.error('StarTab Touchpad: no se pudo crear la sesión:', error);
      setStatus('relay', 'Firebase', 'No se pudo abrir WebRTC; se intentará el modo de respaldo por Firebase.');
    }
  }

  function queueRelayMotion(dx, dy) {
    state.relayDx += dx;
    state.relayDy += dy;
    if (state.relayTimer) return;
    state.relayTimer = window.setTimeout(async () => {
      state.relayTimer = 0;
      const x = state.relayDx;
      const y = state.relayDy;
      state.relayDx = 0;
      state.relayDy = 0;
      if (!state.sessionRef || (!x && !y)) return;
      state.relaySeq += 1;
      try {
        await state.sessionRef.set({
          motionRelay: { seq: state.relaySeq, dx: Math.round(x), dy: Math.round(y), clientAt: Date.now() },
          expiresAtClient: Date.now() + SESSION_TTL_MS,
        }, { merge: true });
      } catch (_) {}
    }, RELAY_INTERVAL_MS);
  }

  function sendMotion(dx, dy) {
    dx = clamp(dx, -500, 500);
    dy = clamp(dy, -500, 500);
    if (!dx && !dy) return;
    const payload = JSON.stringify({ t: 'move', dx: Math.round(dx), dy: Math.round(dy) });
    if (channelOpen(state.motionChannel)) {
      try { state.motionChannel.send(payload); return; } catch (_) {}
    }
    queueRelayMotion(dx, dy);
  }

  async function sendClick(button) {
    if (!['left', 'right'].includes(button)) return;
    const payload = JSON.stringify({ t: 'click', button });
    if (channelOpen(state.controlChannel)) {
      try { state.controlChannel.send(payload); return; } catch (_) {}
    }
    if (!state.sessionRef) return;
    state.clickSeq += 1;
    try {
      await state.sessionRef.set({
        clickRelay: { seq: state.clickSeq, button, clientAt: Date.now() },
        expiresAtClient: Date.now() + SESSION_TTL_MS,
      }, { merge: true });
    } catch (_) {}
  }

  function flushMotion() {
    state.raf = 0;
    const dx = state.motionDx;
    const dy = state.motionDy;
    state.motionDx = 0;
    state.motionDy = 0;
    sendMotion(dx, dy);
  }

  function acceleratedDelta(rawX, rawY) {
    const distance = Math.hypot(rawX, rawY);
    const boost = distance < 2 ? 1.05 : distance < 7 ? 1.35 : distance < 18 ? 1.75 : 2.15;
    return { dx: rawX * boost, dy: rawY * boost };
  }

  function onPointerDown(event) {
    if (!state.open || !dom.surface) return;
    if (state.pointerId !== null) return;
    state.pointerId = event.pointerId;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    state.moved = false;
    state.downAt = performance.now();
    dom.surface.classList.add('is-active');
    try { dom.surface.setPointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (event.pointerId !== state.pointerId) return;
    const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
    const points = samples?.length ? samples : [event];
    for (const sample of points) {
      const rawX = sample.clientX - state.lastX;
      const rawY = sample.clientY - state.lastY;
      state.lastX = sample.clientX;
      state.lastY = sample.clientY;
      if (Math.abs(rawX) + Math.abs(rawY) > 0.4) state.moved = true;
      const { dx, dy } = acceleratedDelta(rawX, rawY);
      state.motionDx += dx;
      state.motionDy += dy;
    }
    if (!state.raf) state.raf = requestAnimationFrame(flushMotion);
    event.preventDefault();
  }

  function finishPointer(event) {
    if (event.pointerId !== state.pointerId) return;
    const wasTap = !state.moved && performance.now() - state.downAt < 260;
    state.pointerId = null;
    dom.surface?.classList.remove('is-active');
    try { dom.surface?.releasePointerCapture(event.pointerId); } catch (_) {}
    if (wasTap) void sendClick('left');
    event.preventDefault();
  }

  async function openModal() {
    if (!dom.modal || state.open) return;
    state.open = true;
    dom.modal.classList.add('is-open');
    dom.modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('windows-touchpad-open');
    if (dom.hint) dom.hint.textContent = 'Desliza el dedo para mover el cursor · toca una vez para clic izquierdo';
    await beginSession();
    dom.surface?.focus({ preventScroll: true });
  }

  async function closeModal() {
    if (!state.open) return;
    state.open = false;
    dom.modal?.classList.remove('is-open');
    dom.modal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('windows-touchpad-open');
    state.pointerId = null;
    dom.surface?.classList.remove('is-active');
    await cleanupSession(true);
    setStatus('idle', 'Preparando');
  }

  function bindUi() {
    dom.toggle?.addEventListener('click', () => void openModal());
    dom.close?.addEventListener('click', () => void closeModal());
    dom.backdrop?.addEventListener('click', () => void closeModal());
    dom.left?.addEventListener('click', () => void sendClick('left'));
    dom.right?.addEventListener('click', () => void sendClick('right'));
    dom.surface?.addEventListener('pointerdown', onPointerDown, { passive: false });
    dom.surface?.addEventListener('pointermove', onPointerMove, { passive: false });
    dom.surface?.addEventListener('pointerup', finishPointer, { passive: false });
    dom.surface?.addEventListener('pointercancel', finishPointer, { passive: false });
    dom.surface?.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 36 : 14;
      const movement = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      if (movement) {
        event.preventDefault();
        sendMotion(movement[0], movement[1]);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void sendClick('left');
      } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        void sendClick('right');
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !state.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void closeModal();
    }, true);
    window.addEventListener('pagehide', () => { void cleanupSession(true); });
  }

  function connectFirebase() {
    try {
      if (typeof firebase === 'undefined' || !firebase.apps?.length) {
        if (state.firebaseRetry++ < FIREBASE_MAX_RETRIES) window.setTimeout(connectFirebase, FIREBASE_RETRY_MS);
        return;
      }
      if (state.db) return;
      state.db = firebase.firestore();
      state.auth = firebase.auth();
      state.auth.onAuthStateChanged((user) => { state.user = user?.uid ? { uid: user.uid, email: user.email || '' } : readSavedUser(); });
      state.user = currentUser();
    } catch (error) {
      console.error('StarTab Touchpad: Firebase no disponible:', error);
    }
  }

  cacheDom();
  bindUi();
  connectFirebase();
})();
