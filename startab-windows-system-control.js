(() => {
  'use strict';

  const FIREBASE_RETRY_MS = 300;
  const FIREBASE_MAX_RETRIES = 40;
  const DEVICE_STALE_MS = 90_000;
  const SELECTED_DEVICE_KEY = 'startab_windows_volume_selected_device_v2';
  const CLIENT_ID_KEY = 'startab_windows_system_client_v1';
  const REFRESH_INTERVAL_MS = 15_000;
  const REQUIRED_AGENT = [2, 4, 0];

  const state = {
    db: null,
    auth: null,
    user: null,
    firebaseRetry: 0,
    open: false,
    deviceId: '',
    unsubscribeDevice: null,
    refreshTimer: 0,
    confirmAction: '',
    confirmTimer: 0,
    commandChain: Promise.resolve(),
    lastDevice: null,
  };

  const dom = {};
  const $ = (id) => document.getElementById(id);

  const clientId = (() => {
    try {
      const existing = sessionStorage.getItem(CLIENT_ID_KEY);
      if (existing) return existing;
      const value = crypto.randomUUID?.() || `system-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(CLIENT_ID_KEY, value);
      return value;
    } catch (_) {
      return `system-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  })();

  function cacheDom() {
    dom.toggle = $('windows-pc-control-toggle');
    dom.modal = $('windows-pc-control-modal');
    dom.backdrop = $('windows-pc-control-backdrop');
    dom.close = $('windows-pc-control-close');
    dom.online = $('windows-pc-control-online');
    dom.onlineText = dom.online?.querySelector('span');
    dom.device = $('windows-pc-control-device');
    dom.grid = $('windows-pc-control-grid');
    dom.hotspot = $('windows-pc-hotspot');
    dom.hotspotState = $('windows-pc-hotspot-state');
    dom.hotspotNote = $('windows-pc-hotspot-note');
    dom.note = $('windows-pc-control-note');
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
      const user = state.auth?.currentUser;
      if (user?.uid) return { uid: user.uid, email: user.email || '' };
    } catch (_) {}
    return readSavedUser();
  }

  function versionAtLeast(version, wanted = REQUIRED_AGENT) {
    const parts = String(version || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
    for (let i = 0; i < 3; i += 1) {
      const a = parts[i] || 0;
      const b = wanted[i] || 0;
      if (a > b) return true;
      if (a < b) return false;
    }
    return true;
  }

  function isOnline(device) {
    if (!device?.online) return false;
    const clientAt = Number(device.clientAt) || 0;
    return clientAt > 0 && Date.now() - clientAt < DEVICE_STALE_MS;
  }

  function selectedDeviceId() {
    const selectValue = String(dom.deviceSelect?.value || '').trim();
    if (selectValue) return selectValue;
    try {
      const raw = localStorage.getItem(SELECTED_DEVICE_KEY) || '';
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      const user = currentUser();
      return parsed?.uid && user?.uid === parsed.uid ? String(parsed.deviceId || '') : '';
    } catch (_) {
      return '';
    }
  }

  function setOnlineState(kind, text) {
    if (dom.online) dom.online.dataset.state = kind;
    if (dom.onlineText) dom.onlineText.textContent = text;
  }

  function normalizeHotspotState(value) {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'on' || normalized === 'off' || normalized === 'unavailable' || normalized === 'error') return normalized;
    return 'unknown';
  }

  function clearConfirmation() {
    state.confirmAction = '';
    clearTimeout(state.confirmTimer);
    state.confirmTimer = 0;
    dom.grid?.querySelectorAll('[data-confirming="true"]').forEach((button) => {
      button.dataset.confirming = 'false';
      const strong = button.querySelector('strong');
      if (strong?.dataset.originalLabel) strong.textContent = strong.dataset.originalLabel;
      const small = button.querySelector('small');
      if (small?.dataset.originalLabel) small.textContent = small.dataset.originalLabel;
    });
  }

  function render(device = state.lastDevice) {
    state.lastDevice = device || null;
    const loggedIn = !!state.user?.uid;
    const online = isOnline(device);
    const supported = online && versionAtLeast(device?.agentVersion);

    if (dom.device) {
      dom.device.textContent = device
        ? `${device.deviceName || 'PC Windows'} · ${String(device.deviceId || '').slice(0, 8)}…`
        : loggedIn ? 'No hay un PC Windows seleccionado.' : 'Inicia sesión con la misma cuenta del PC.';
    }

    if (!loggedIn) setOnlineState('error', 'Sin sesión');
    else if (!device) setOnlineState('error', 'Sin PC');
    else if (!online) setOnlineState('error', 'Offline');
    else if (!supported) setOnlineState('warning', 'EXE antiguo');
    else setOnlineState('connected', 'En línea');

    dom.grid?.querySelectorAll('.windows-pc-action').forEach((button) => {
      button.disabled = !supported;
    });

    const hotspotState = normalizeHotspotState(device?.hotspotState);
    if (dom.hotspot) {
      dom.hotspot.disabled = !supported || hotspotState === 'unavailable' || hotspotState === 'error';
      dom.hotspot.classList.toggle('is-on', hotspotState === 'on');
      dom.hotspot.classList.toggle('is-off', hotspotState === 'off');
      dom.hotspot.classList.toggle('is-unknown', hotspotState === 'unknown');
      dom.hotspot.setAttribute('aria-pressed', hotspotState === 'on' ? 'true' : 'false');
    }
    if (dom.hotspotState) dom.hotspotState.textContent = hotspotState === 'on' ? 'ON' : hotspotState === 'off' ? 'OFF' : '--';
    if (dom.hotspotNote) {
      dom.hotspotNote.textContent = hotspotState === 'on'
        ? `${Math.max(0, Number(device?.hotspotClients) || 0)} dispositivo(s) conectado(s)`
        : hotspotState === 'off'
          ? 'Hotspot de Windows apagado'
          : hotspotState === 'unavailable'
            ? 'Mobile Hotspot no disponible en este PC'
            : hotspotState === 'error'
              ? 'Windows no pudo consultar el hotspot'
              : supported ? 'Consultando estado del PC…' : 'Requiere agente Windows v2.4.0';
    }

    if (dom.note) {
      if (!loggedIn) dom.note.textContent = 'Inicia sesión en StarTab para controlar tu PC principal.';
      else if (!device) dom.note.textContent = 'Selecciona primero un PC en “Volumen del sistema”.';
      else if (!online) dom.note.textContent = 'El PC seleccionado está desconectado.';
      else if (!supported) dom.note.textContent = `Estas acciones requieren StartabWindowsVolume.exe v2.4.0 o superior. Tu PC usa ${device.agentVersion || 'una versión anterior'}.`;
      else dom.note.textContent = 'Los comandos se envían únicamente al PC Windows seleccionado en StarTab.';
    }
  }

  function stopDeviceListener() {
    state.unsubscribeDevice?.();
    state.unsubscribeDevice = null;
    state.deviceId = '';
    state.lastDevice = null;
  }

  function connectSelectedDevice() {
    stopDeviceListener();
    state.user = currentUser();
    const deviceId = selectedDeviceId();
    if (!state.db || !state.user?.uid || !deviceId) {
      render(null);
      return;
    }
    state.deviceId = deviceId;
    state.unsubscribeDevice = state.db
      .collection('users').doc(state.user.uid)
      .collection('windowsDevices').doc(deviceId)
      .onSnapshot((snapshot) => {
        if (!snapshot.exists) {
          render(null);
          return;
        }
        const data = snapshot.data() || {};
        render({ ...data, deviceId: data.deviceId || snapshot.id });
      }, (error) => {
        console.warn('StarTab System Control: no se pudo leer el PC:', error);
        render(null);
      });
  }

  async function writeCommand(action, extra = {}) {
    state.user = currentUser();
    const device = state.lastDevice;
    if (!state.db || !state.user?.uid || !device?.deviceId || !isOnline(device) || !versionAtLeast(device.agentVersion)) return false;
    const command = {
      id: `${Date.now().toString(36)}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
      action,
      issuedBy: state.user.uid,
      issuedByClient: clientId,
      clientAt: Date.now(),
      expiresAtClient: Date.now() + 20_000,
      serverAt: firebase.firestore.FieldValue.serverTimestamp(),
      ...extra,
    };
    await state.db.collection('users').doc(state.user.uid)
      .collection('windowsDevices').doc(device.deviceId)
      .set({ command }, { merge: true });
    return true;
  }

  function sendCommand(action, extra = {}) {
    state.commandChain = state.commandChain
      .catch(() => {})
      .then(() => writeCommand(action, extra))
      .catch((error) => {
        console.error('StarTab System Control: no se pudo enviar el comando:', error);
        return false;
      });
    return state.commandChain;
  }

  function scheduleRefresh() {
    clearInterval(state.refreshTimer);
    state.refreshTimer = 0;
    if (!state.open) return;
    state.refreshTimer = window.setInterval(() => {
      if (!state.open || !versionAtLeast(state.lastDevice?.agentVersion) || !isOnline(state.lastDevice)) return;
      void sendCommand('getSystemState');
    }, REFRESH_INTERVAL_MS);
  }

  async function openModal() {
    if (!dom.modal || state.open) return;
    state.open = true;
    clearConfirmation();
    if (dom.modal.parentElement !== document.body) document.body.appendChild(dom.modal);
    dom.modal.style.zIndex = '2147483647';
    dom.modal.classList.add('is-open');
    dom.modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('windows-pc-control-open');
    connectSelectedDevice();
    globalThis.StartabHaptics?.pulse?.('pc-control-open', 7, 70);
    window.setTimeout(() => {
      if (state.open && versionAtLeast(state.lastDevice?.agentVersion) && isOnline(state.lastDevice)) void sendCommand('getSystemState');
    }, 120);
    scheduleRefresh();
  }

  function closeModal() {
    if (!state.open) return;
    state.open = false;
    clearConfirmation();
    clearInterval(state.refreshTimer);
    state.refreshTimer = 0;
    stopDeviceListener();
    dom.modal?.classList.remove('is-open');
    dom.modal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('windows-pc-control-open');
  }

  function prepareConfirmation(button, action) {
    clearConfirmation();
    state.confirmAction = action;
    button.dataset.confirming = 'true';
    const strong = button.querySelector('strong');
    const small = button.querySelector('small');
    if (strong) {
      strong.dataset.originalLabel ||= strong.textContent || '';
      strong.textContent = 'Confirmar acción';
    }
    if (small) {
      small.dataset.originalLabel ||= small.textContent || '';
      small.textContent = 'Toca otra vez para ejecutar';
    }
    globalThis.StartabHaptics?.pulse?.('pc-control-confirm', 12, 70);
    state.confirmTimer = window.setTimeout(clearConfirmation, 3200);
  }

  async function runSystemAction(button) {
    const action = String(button.dataset.systemAction || '');
    if (!action) return;
    if (button.dataset.confirm === 'true' && state.confirmAction !== action) {
      prepareConfirmation(button, action);
      return;
    }
    clearConfirmation();
    button.classList.add('is-sending');
    globalThis.StartabHaptics?.pulse?.(`pc-control-${action}`, action === 'shutdown' || action === 'restart' ? 20 : 10, 70);
    const ok = await sendCommand(action);
    button.classList.remove('is-sending');
    if (dom.note) dom.note.textContent = ok ? 'Comando enviado al PC principal.' : 'No se pudo enviar el comando al PC.';
    if (ok && ['shutdown', 'restart', 'logoff', 'sleep', 'lock', 'monitorOff'].includes(action)) {
      window.setTimeout(() => {
        if (state.open && dom.note) dom.note.textContent = 'Esperando la respuesta del PC…';
      }, 1100);
    }
  }

  async function toggleHotspot() {
    const device = state.lastDevice;
    const current = normalizeHotspotState(device?.hotspotState);
    const enabled = current !== 'on';
    if (!dom.hotspot || dom.hotspot.disabled) return;
    dom.hotspot.classList.add('is-sending');
    dom.hotspot.disabled = true;
    if (dom.hotspotState) dom.hotspotState.textContent = '…';
    if (dom.hotspotNote) dom.hotspotNote.textContent = enabled ? 'Encendiendo Mobile Hotspot…' : 'Apagando Mobile Hotspot…';
    globalThis.StartabHaptics?.pulse?.('pc-hotspot-toggle', enabled ? 14 : 9, 65);
    const ok = await sendCommand('setHotspot', { enabled });
    if (!ok) {
      dom.hotspot.classList.remove('is-sending');
      render(state.lastDevice);
      if (dom.note) dom.note.textContent = 'No se pudo cambiar el estado del hotspot.';
      return;
    }
    window.setTimeout(() => {
      if (state.open) void sendCommand('getSystemState');
    }, 900);
  }

  function bindUi() {
    dom.toggle?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void openModal();
    });
    dom.close?.addEventListener('click', closeModal);
    dom.backdrop?.addEventListener('click', closeModal);
    dom.grid?.addEventListener('click', (event) => {
      const button = event.target.closest?.('.windows-pc-action');
      if (!button || button.disabled) return;
      void runSystemAction(button);
    });
    dom.hotspot?.addEventListener('click', () => void toggleHotspot());
    dom.deviceSelect?.addEventListener('change', () => {
      if (state.open) {
        clearConfirmation();
        connectSelectedDevice();
        window.setTimeout(() => {
          if (state.open && versionAtLeast(state.lastDevice?.agentVersion) && isOnline(state.lastDevice)) void sendCommand('getSystemState');
        }, 120);
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !state.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeModal();
    }, true);
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
      state.auth.onAuthStateChanged(() => {
        state.user = currentUser();
        if (state.open) connectSelectedDevice();
      });
      state.user = currentUser();
    } catch (error) {
      console.error('StarTab System Control: Firebase no disponible:', error);
    }
  }

  cacheDom();
  bindUi();
  connectFirebase();
})();
