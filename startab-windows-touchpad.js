(() => {
  'use strict';

  const FIREBASE_RETRY_MS = 300;
  const FIREBASE_MAX_RETRIES = 40;
  const DEVICE_STALE_MS = 90_000;
  const SESSION_TTL_MS = 5 * 60_000;
  const RELAY_INTERVAL_MS = 95;
  const ICE_TIMEOUT_MS = 3200;
  const SCROLL_RELAY_INTERVAL_MS = 80;
  const KEYBOARD_RELAY_INTERVAL_MS = 55;
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
    scrollPointerId: null,
    scrollLastY: 0,
    scrollDy: 0,
    scrollRelayTimer: 0,
    scrollSeq: 0,
    buttonSeq: 0,
    keyboardSeq: 0,
    keyboardOps: [],
    keyboardRelayTimer: 0,
    dragLocked: false,
    keyboardComposing: false,
    skipNextInput: false,
    skipInputTimer: 0,
    agentVersion: '',
    capabilities: { pointer: false, scroll: false, advanced: false },
  };

  const dom = {};
  const $ = (id) => document.getElementById(id);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  function versionAtLeast(version, major, minor = 0, patch = 0) {
    const parts = String(version || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
    const current = [parts[0] || 0, parts[1] || 0, parts[2] || 0];
    const wanted = [major, minor, patch];
    for (let index = 0; index < 3; index += 1) {
      if (current[index] > wanted[index]) return true;
      if (current[index] < wanted[index]) return false;
    }
    return true;
  }

  const supportsPointerAgent = (version) => versionAtLeast(version, 2, 2, 0);
  const supportsScrollAgent = (version) => versionAtLeast(version, 2, 2, 1);
  const supportsAdvancedAgent = (version) => versionAtLeast(version, 2, 3, 0);

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
    dom.scroll = $('windows-touchpad-scroll');
    dom.left = $('windows-touchpad-left');
    dom.right = $('windows-touchpad-right');
    dom.connection = $('windows-touchpad-connection');
    dom.connectionText = dom.connection?.querySelector('span');
    dom.device = $('windows-touchpad-device');
    dom.hint = $('windows-touchpad-hint');
    dom.note = $('windows-touchpad-note');
    dom.deviceSelect = $('windows-device-select');
    dom.keyboard = $('windows-touchpad-keyboard');
    dom.keyboardInput = $('windows-touchpad-keyboard-input');
    dom.keyboardState = $('windows-touchpad-keyboard-state');
    dom.dragLock = $('windows-touchpad-drag-lock');
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

  function renderCapabilityUi() {
    const { scroll, advanced } = state.capabilities;
    if (dom.scroll) {
      dom.scroll.setAttribute('aria-disabled', scroll ? 'false' : 'true');
      dom.scroll.tabIndex = scroll ? 0 : -1;
      dom.scroll.title = scroll ? 'Desliza para hacer scroll en Windows' : 'El scroll requiere el agente Windows v2.2.1 o superior';
    }
    if (dom.keyboardInput) {
      dom.keyboardInput.disabled = !advanced;
      dom.keyboardInput.placeholder = advanced ? 'Escribe en la PC…' : 'Actualiza el EXE para usar teclado remoto';
    }
    if (dom.keyboard) dom.keyboard.classList.toggle('is-ready', advanced);
    if (dom.keyboardState) dom.keyboardState.textContent = advanced ? 'TECLADO REMOTO' : 'REQUIERE EXE 2.3';
    if (dom.dragLock) {
      dom.dragLock.disabled = !advanced;
      dom.dragLock.title = advanced ? 'Mantener clic izquierdo para arrastrar' : 'El arrastre bloqueado requiere el agente Windows v2.3.0 o superior';
    }
  }

  function applyAgentCapabilities(version) {
    state.agentVersion = String(version || '');
    state.capabilities = {
      pointer: supportsPointerAgent(state.agentVersion),
      scroll: supportsScrollAgent(state.agentVersion),
      advanced: supportsAdvancedAgent(state.agentVersion),
    };
    renderCapabilityUi();
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
    clearTimeout(state.scrollRelayTimer);
    clearTimeout(state.keyboardRelayTimer);
    clearTimeout(state.skipInputTimer);
    state.relayTimer = 0;
    state.scrollRelayTimer = 0;
    state.keyboardRelayTimer = 0;
    state.skipInputTimer = 0;
    state.skipNextInput = false;
    state.relayDx = 0;
    state.relayDy = 0;
    state.scrollDy = 0;
    state.keyboardOps = [];
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
    applyAgentCapabilities(device.data.agentVersion);
    if (!state.capabilities.pointer) {
      setStatus('error', 'Actualiza EXE', 'Este PC usa un agente anterior. El cursor remoto requiere StartabWindowsVolume.exe v2.2.0 o superior.');
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

  function queueRelayScroll(delta) {
    state.scrollDy += delta;
    if (state.scrollRelayTimer) return;
    state.scrollRelayTimer = window.setTimeout(async () => {
      state.scrollRelayTimer = 0;
      const wheel = state.scrollDy;
      state.scrollDy = 0;
      if (!state.sessionRef || !wheel) return;
      state.scrollSeq += 1;
      try {
        await state.sessionRef.set({
          scrollRelay: { seq: state.scrollSeq, delta: Math.round(wheel), clientAt: Date.now() },
          expiresAtClient: Date.now() + SESSION_TTL_MS,
        }, { merge: true });
      } catch (_) {}
    }, SCROLL_RELAY_INTERVAL_MS);
  }

  function sendScroll(delta) {
    if (!state.capabilities.scroll) return;
    delta = clamp(delta, -720, 720);
    if (!delta) return;
    const payload = JSON.stringify({ t: 'scroll', delta: Math.round(delta) });
    if (channelOpen(state.motionChannel)) {
      try { state.motionChannel.send(payload); return; } catch (_) {}
    }
    queueRelayScroll(delta);
  }

  async function sendClick(button) {
    if (!['left', 'right'].includes(button)) return;
    if (button === 'left' && state.dragLocked) {
      await setDragLocked(false);
      return;
    }
    globalThis.StartabHaptics?.click?.(button);
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

  async function sendButtonState(button, down) {
    if (!state.capabilities.advanced || !['left', 'right'].includes(button)) return false;
    const payload = JSON.stringify({ t: 'button', button, down: !!down });
    if (channelOpen(state.controlChannel)) {
      try {
        state.controlChannel.send(payload);
        return true;
      } catch (_) {}
    }
    if (!state.sessionRef) return false;
    state.buttonSeq += 1;
    try {
      await state.sessionRef.set({
        buttonRelay: { seq: state.buttonSeq, button, down: !!down, clientAt: Date.now() },
        expiresAtClient: Date.now() + SESSION_TTL_MS,
      }, { merge: true });
      return true;
    } catch (_) {
      return false;
    }
  }

  function queueKeyboardRelay(operation) {
    if (!state.sessionRef || !state.capabilities.advanced || !operation) return;
    state.keyboardSeq += 1;
    state.keyboardOps.push({ seq: state.keyboardSeq, ...operation });
    if (state.keyboardOps.length > 40) state.keyboardOps.splice(0, state.keyboardOps.length - 40);
    if (state.keyboardRelayTimer) return;
    state.keyboardRelayTimer = window.setTimeout(async () => {
      state.keyboardRelayTimer = 0;
      if (!state.sessionRef || !state.keyboardOps.length) return;
      try {
        await state.sessionRef.set({
          keyboardRelay: { ops: state.keyboardOps.slice(-40), clientAt: Date.now() },
          expiresAtClient: Date.now() + SESSION_TTL_MS,
        }, { merge: true });
      } catch (_) {}
    }, KEYBOARD_RELAY_INTERVAL_MS);
  }

  function markKeyboardActivity() {
    if (!dom.keyboard || !dom.keyboardState) return;
    dom.keyboard.classList.add('is-sending');
    dom.keyboardState.textContent = 'ENVIANDO';
    clearTimeout(markKeyboardActivity.timer);
    markKeyboardActivity.timer = window.setTimeout(() => {
      dom.keyboard?.classList.remove('is-sending');
      if (dom.keyboardState) dom.keyboardState.textContent = state.capabilities.advanced ? 'TECLADO REMOTO' : 'REQUIERE EXE 2.3';
    }, 180);
  }

  function sendKeyboardText(text) {
    if (!state.capabilities.advanced) return;
    const normalized = String(text || '').slice(0, 2048);
    if (!normalized) return;
    markKeyboardActivity();
    globalThis.StartabHaptics?.pulse?.('remote-keyboard', 4, 34);
    const payload = JSON.stringify({ t: 'text', text: normalized });
    if (channelOpen(state.controlChannel)) {
      try { state.controlChannel.send(payload); return; } catch (_) {}
    }
    queueKeyboardRelay({ kind: 'text', text: normalized });
  }

  function sendKeyboardKey(key) {
    if (!state.capabilities.advanced) return;
    const normalized = String(key || '').toLowerCase();
    if (!['backspace', 'delete', 'enter', 'tab'].includes(normalized)) return;
    markKeyboardActivity();
    globalThis.StartabHaptics?.pulse?.(`remote-key-${normalized}`, normalized === 'enter' ? 8 : 5, 42);
    const payload = JSON.stringify({ t: 'key', key: normalized });
    if (channelOpen(state.controlChannel)) {
      try { state.controlChannel.send(payload); return; } catch (_) {}
    }
    queueKeyboardRelay({ kind: 'key', key: normalized });
  }

  function renderDragLock() {
    if (dom.dragLock) {
      dom.dragLock.classList.toggle('is-active', state.dragLocked);
      dom.dragLock.setAttribute('aria-pressed', state.dragLocked ? 'true' : 'false');
      dom.dragLock.setAttribute('aria-label', state.dragLocked ? 'Soltar clic izquierdo sostenido' : 'Mantener pulsado el clic izquierdo para arrastrar');
    }
    dom.surface?.classList.toggle('is-drag-locked', state.dragLocked);
    if (dom.hint) {
      dom.hint.textContent = state.dragLocked
        ? 'Clic izquierdo sostenido · mueve el cursor para arrastrar'
        : 'Desliza para mover · toca una vez para clic izquierdo';
    }
  }

  async function setDragLocked(enabled, { haptic = true } = {}) {
    const next = !!enabled;
    if (next === state.dragLocked) return true;
    if (next && !state.capabilities.advanced) return false;
    const ok = await sendButtonState('left', next);
    if (!ok) return false;
    state.dragLocked = next;
    if (haptic) globalThis.StartabHaptics?.pulse?.(next ? 'drag-lock-on' : 'drag-lock-off', next ? 16 : 10, 70);
    renderDragLock();
    return true;
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
    globalThis.StartabHaptics?.resetTexture?.('touchpad-move');
    globalThis.StartabHaptics?.pulse?.('touchpad-start', 6, 90);
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
      globalThis.StartabHaptics?.texture?.('touchpad-move', Math.hypot(rawX, rawY), {
        threshold: 16,
        duration: 5,
        minInterval: 48,
      });
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
    if (wasTap && !state.dragLocked) void sendClick('left');
    event.preventDefault();
  }

  function onScrollPointerDown(event) {
    if (!state.open || !dom.scroll || !state.capabilities.scroll || state.scrollPointerId !== null) return;
    state.scrollPointerId = event.pointerId;
    state.scrollLastY = event.clientY;
    globalThis.StartabHaptics?.resetTexture?.('touchpad-scroll');
    globalThis.StartabHaptics?.pulse?.('scroll-start', 7, 90);
    dom.scroll.classList.add('is-active');
    try { dom.scroll.setPointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
  }

  function onScrollPointerMove(event) {
    if (event.pointerId !== state.scrollPointerId) return;
    const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
    const points = samples?.length ? samples : [event];
    let delta = 0;
    for (const sample of points) {
      const rawY = sample.clientY - state.scrollLastY;
      state.scrollLastY = sample.clientY;
      delta += -rawY * 11.5;
      globalThis.StartabHaptics?.texture?.('touchpad-scroll', Math.abs(rawY), {
        threshold: 10,
        duration: 7,
        minInterval: 38,
      });
    }
    sendScroll(delta);
    event.preventDefault();
  }

  function finishScrollPointer(event) {
    if (event.pointerId !== state.scrollPointerId) return;
    state.scrollPointerId = null;
    dom.scroll?.classList.remove('is-active');
    try { dom.scroll?.releasePointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
  }

  async function openModal() {
    if (!dom.modal || state.open) return;
    state.open = true;
    state.dragLocked = false;
    applyAgentCapabilities('');
    renderDragLock();
    if (dom.modal.parentElement !== document.body) document.body.appendChild(dom.modal);
    dom.modal.style.zIndex = '2147483647';
    dom.modal.classList.add('is-open');
    dom.modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('windows-touchpad-open');
    if (dom.hint) dom.hint.textContent = 'Desliza el dedo para mover el cursor · toca una vez para clic izquierdo';
    dom.surface?.focus({ preventScroll: true });
    await beginSession();
  }

  async function closeModal() {
    if (!state.open) return;
    if (state.dragLocked) await setDragLocked(false, { haptic: false });
    state.open = false;
    dom.modal?.classList.remove('is-open');
    dom.modal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('windows-touchpad-open');
    state.pointerId = null;
    state.scrollPointerId = null;
    dom.surface?.classList.remove('is-active', 'is-drag-locked');
    dom.scroll?.classList.remove('is-active');
    if (dom.keyboardInput) dom.keyboardInput.value = '';
    await cleanupSession(true);
    setStatus('idle', 'Preparando');
  }

  function bindUi() {
    dom.toggle?.addEventListener('click', () => void openModal());
    dom.close?.addEventListener('click', () => void closeModal());
    dom.backdrop?.addEventListener('click', () => void closeModal());
    dom.left?.addEventListener('click', () => {
      if (state.dragLocked) void setDragLocked(false);
      else void sendClick('left');
    });
    dom.right?.addEventListener('click', () => void sendClick('right'));
    dom.dragLock?.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    }, { passive: true });
    dom.dragLock?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void setDragLocked(!state.dragLocked);
    });
    dom.keyboard?.addEventListener('submit', (event) => event.preventDefault());
    dom.keyboardInput?.addEventListener('compositionstart', () => {
      state.keyboardComposing = true;
    });
    dom.keyboardInput?.addEventListener('compositionend', (event) => {
      state.keyboardComposing = false;
      state.skipNextInput = true;
      clearTimeout(state.skipInputTimer);
      state.skipInputTimer = window.setTimeout(() => { state.skipNextInput = false; }, 80);
      const text = String(event.data || dom.keyboardInput?.value || '');
      if (text) sendKeyboardText(text);
      if (dom.keyboardInput) dom.keyboardInput.value = '';
    });
    dom.keyboardInput?.addEventListener('input', (event) => {
      if (state.keyboardComposing || event.isComposing) return;
      if (state.skipNextInput) {
        state.skipNextInput = false;
        clearTimeout(state.skipInputTimer);
        state.skipInputTimer = 0;
        if (dom.keyboardInput) dom.keyboardInput.value = '';
        return;
      }
      const inputType = String(event.inputType || '');
      if (inputType.startsWith('deleteContentBackward')) sendKeyboardKey('backspace');
      else if (inputType.startsWith('deleteContentForward')) sendKeyboardKey('delete');
      else if (inputType === 'insertLineBreak' || inputType === 'insertParagraph') sendKeyboardKey('enter');
      else {
        const text = event.data ?? dom.keyboardInput?.value ?? '';
        if (text) sendKeyboardText(text);
      }
      if (dom.keyboardInput) dom.keyboardInput.value = '';
    });
    dom.keyboardInput?.addEventListener('keydown', (event) => {
      if (event.isComposing || state.keyboardComposing) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        sendKeyboardKey('enter');
        if (dom.keyboardInput) dom.keyboardInput.value = '';
      } else if (event.key === 'Tab') {
        event.preventDefault();
        sendKeyboardKey('tab');
      } else if (event.key === 'Backspace' && !dom.keyboardInput?.value) {
        event.preventDefault();
        sendKeyboardKey('backspace');
      } else if (event.key === 'Delete' && !dom.keyboardInput?.value) {
        event.preventDefault();
        sendKeyboardKey('delete');
      }
    });
    dom.surface?.addEventListener('pointerdown', onPointerDown, { passive: false });
    dom.surface?.addEventListener('pointermove', onPointerMove, { passive: false });
    dom.surface?.addEventListener('pointerup', finishPointer, { passive: false });
    dom.surface?.addEventListener('pointercancel', finishPointer, { passive: false });
    dom.scroll?.addEventListener('pointerdown', onScrollPointerDown, { passive: false });
    dom.scroll?.addEventListener('pointermove', onScrollPointerMove, { passive: false });
    dom.scroll?.addEventListener('pointerup', finishScrollPointer, { passive: false });
    dom.scroll?.addEventListener('pointercancel', finishScrollPointer, { passive: false });
    dom.scroll?.addEventListener('wheel', (event) => {
      if (!state.capabilities.scroll) return;
      event.preventDefault();
      sendScroll(-event.deltaY * 1.3);
    }, { passive: false });
    dom.scroll?.addEventListener('keydown', (event) => {
      if (!state.capabilities.scroll) return;
      const amount = event.shiftKey ? 480 : 180;
      if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        sendScroll(amount);
      } else if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        sendScroll(-amount);
      }
    });
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
    window.addEventListener('pagehide', () => {
      if (state.dragLocked) {
        void setDragLocked(false, { haptic: false }).finally(() => cleanupSession(true));
      } else {
        void cleanupSession(true);
      }
    });
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
