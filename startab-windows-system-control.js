(() => {
  'use strict';

  const FIREBASE_RETRY_MS = 300;
  const FIREBASE_MAX_RETRIES = 40;
  const DEVICE_STALE_MS = 90_000;
  const SELECTED_DEVICE_KEY = 'startab_windows_volume_selected_device_v2';
  const CLIENT_ID_KEY = 'startab_windows_system_client_v1';
  const REFRESH_INTERVAL_MS = 15_000;
  const REQUIRED_AGENT = [2, 4, 0];
  const RGB_REQUIRED_AGENT = [2, 6, 1];

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
    rgbBusy: false,
    rgbOptimistic: null,
    rgbOptimisticTimer: 0,
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
    dom.toggles = Array.from(document.querySelectorAll('[data-windows-pc-control-toggle], #windows-pc-control-toggle'));
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
    dom.rgb = $('windows-pc-rgb');
    dom.rgbPower = $('windows-pc-rgb-power');
    dom.rgbState = $('windows-pc-rgb-state');
    dom.rgbNote = $('windows-pc-rgb-note');
    dom.rgbColor = $('windows-pc-rgb-color');
    dom.rgbPreview = $('windows-pc-rgb-color-preview');
    dom.rgbHex = $('windows-pc-rgb-hex');
    dom.rgbTransport = $('windows-pc-rgb-transport');
    dom.rgbSwatches = $('windows-pc-rgb-swatches');
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

  function normalizeRgbState(value) {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'on' || normalized === 'off' || normalized === 'unavailable' || normalized === 'error') return normalized;
    return 'unknown';
  }

  function normalizeRgbColor(value, fallback = '#FFFFFF') {
    const candidate = String(value || '').trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(candidate) ? candidate : fallback;
  }

  function setRgbVisualColor(color) {
    const normalized = normalizeRgbColor(color);
    if (dom.rgbColor && dom.rgbColor.value.toUpperCase() !== normalized) dom.rgbColor.value = normalized;
    if (dom.rgbPreview) dom.rgbPreview.style.setProperty('--rgb-color', normalized);
    if (dom.rgbHex) dom.rgbHex.textContent = normalized;
    dom.rgbSwatches?.querySelectorAll('[data-rgb-color]').forEach((button) => {
      button.classList.toggle('is-selected', normalizeRgbColor(button.dataset.rgbColor) === normalized);
    });
    return normalized;
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

    const rgbVersionOk = online && versionAtLeast(device?.agentVersion, RGB_REQUIRED_AGENT);
    const rgbAvailable = rgbVersionOk && device?.rgbAvailable !== false;
    const reportedRgbState = normalizeRgbState(device?.rgbState);
    const reportedRgbColor = normalizeRgbColor(device?.rgbColor || dom.rgbColor?.value || '#FFFFFF');
    let optimistic = state.rgbOptimistic && Date.now() < state.rgbOptimistic.until ? state.rgbOptimistic : null;
    if (optimistic) {
      const confirmed = reportedRgbState === (optimistic.enabled ? 'on' : 'off')
        && (!optimistic.enabled || reportedRgbColor === optimistic.color);
      if (confirmed || reportedRgbState === 'error' || reportedRgbState === 'unavailable') {
        state.rgbOptimistic = null;
        optimistic = null;
      }
    }
    const rgbState = optimistic ? (optimistic.enabled ? 'on' : 'off') : reportedRgbState;
    const rgbColor = setRgbVisualColor(optimistic?.color || reportedRgbColor);
    if (dom.rgb) {
      dom.rgb.dataset.state = rgbState;
      dom.rgb.classList.toggle('is-on', rgbState === 'on');
      dom.rgb.classList.toggle('is-off', rgbState === 'off');
      dom.rgb.classList.toggle('is-unavailable', !rgbAvailable);
      dom.rgb.style.setProperty('--active-rgb', rgbColor);
    }
    if (dom.rgbPower) {
      dom.rgbPower.disabled = !rgbAvailable || state.rgbBusy;
      dom.rgbPower.setAttribute('aria-pressed', rgbState === 'on' ? 'true' : 'false');
    }
    if (dom.rgbState) dom.rgbState.textContent = rgbState === 'on' ? 'ON' : rgbState === 'off' ? 'OFF' : '--';
    if (dom.rgbTransport) {
      const transport = String(device?.rgbTransport || '').toLowerCase();
      dom.rgbTransport.textContent = transport === 'sdk-task-admin' ? 'SDK · AUTO ADMIN · 6742' : transport === 'sdk-admin' ? 'SDK · ADMIN · 6742' : transport.startsWith('sdk') ? 'SDK · 6742' : transport === 'cli' ? 'OPENRGB · CLI' : 'OPENRGB';
      dom.rgbTransport.dataset.transport = transport || 'unknown';
    }
    if (dom.rgbNote) {
      dom.rgbNote.textContent = !rgbVersionOk
        ? `Requiere agente Windows v${RGB_REQUIRED_AGENT.join('.')} o superior`
        : device?.rgbAvailable === false || rgbState === 'unavailable'
          ? (device?.rgbMessage || 'OpenRGB no está disponible en este PC')
          : rgbState === 'error'
            ? (device?.rgbMessage || 'OpenRGB no pudo aplicar el último cambio')
            : rgbState === 'on'
              ? `Luces encendidas · ${rgbColor}`
              : rgbState === 'off'
                ? 'Todas las luces compatibles están apagadas'
                : (device?.rgbMessage || 'Preparando control OpenRGB…');
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

  async function tryLocalRgbFastPath(enabled, color, intent = 'power') {
    try {
      if (!globalThis.chrome?.runtime?.sendMessage || !state.lastDevice?.deviceId) return false;
      const status = await chrome.runtime.sendMessage({ type: 'STARTAB_WINDOWS_NATIVE_GET_STATE' });
      if (!status?.connected || status?.state?.deviceId !== state.lastDevice.deviceId) return false;
      if (!versionAtLeast(status?.state?.agentVersion, RGB_REQUIRED_AGENT)) return false;
      const response = await chrome.runtime.sendMessage({
        type: 'STARTAB_WINDOWS_NATIVE_COMMAND',
        command: { type: 'setRgb', enabled: !!enabled, color, intent },
      });
      return !!response?.ok;
    } catch (_) {
      return false;
    }
  }

  async function sendRgbCommand(enabled, color, intent = 'power') {
    if (!versionAtLeast(state.lastDevice?.agentVersion, RGB_REQUIRED_AGENT)) return false;
    const normalized = normalizeRgbColor(color);
    // Same-PC extension control bypasses Firestore for near-instant response.
    // Mobile/web clients automatically fall back to the existing realtime cloud bridge.
    if (await tryLocalRgbFastPath(enabled, normalized, intent)) return true;
    return sendCommand('setRgb', { enabled: !!enabled, color: normalized, intent });
  }

  function optimisticRgb(enabled, color) {
    const normalized = setRgbVisualColor(color);
    state.rgbOptimistic = { enabled: !!enabled, color: normalized, until: Date.now() + 6000 };
    clearTimeout(state.rgbOptimisticTimer);
    state.rgbOptimisticTimer = window.setTimeout(() => {
      state.rgbOptimistic = null;
      if (state.open) render(state.lastDevice);
    }, 6100);
    if (dom.rgb) {
      dom.rgb.dataset.state = enabled ? 'on' : 'off';
      dom.rgb.classList.toggle('is-on', enabled);
      dom.rgb.classList.toggle('is-off', !enabled);
      dom.rgb.style.setProperty('--active-rgb', normalized);
    }
    if (dom.rgbState) dom.rgbState.textContent = enabled ? 'ON' : 'OFF';
    if (dom.rgbPower) dom.rgbPower.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    if (dom.rgbNote) dom.rgbNote.textContent = enabled ? `Aplicando ${normalized}…` : 'Apagando todas las luces…';
  }

  async function applyRgb(enabled, color, intent = 'power') {
    if (!dom.rgbPower || state.rgbBusy || dom.rgbPower.disabled) return;
    const normalized = normalizeRgbColor(color || dom.rgbColor?.value || state.lastDevice?.rgbColor);
    state.rgbBusy = true;
    optimisticRgb(enabled, normalized);
    dom.rgb.classList.add('is-sending');
    dom.rgbPower.disabled = true;
    globalThis.StartabHaptics?.pulse?.(enabled ? 'pc-rgb-on' : 'pc-rgb-off', enabled ? 12 : 8, 60);
    const ok = await sendRgbCommand(enabled, normalized, intent);
    state.rgbBusy = false;
    dom.rgb.classList.remove('is-sending');
    if (!ok) {
      state.rgbOptimistic = null;
      clearTimeout(state.rgbOptimisticTimer);
      render(state.lastDevice);
      if (dom.note) dom.note.textContent = 'No se pudo enviar el comando de iluminación al PC.';
      return;
    }
    if (dom.note) dom.note.textContent = enabled ? 'Color enviado a OpenRGB.' : 'Orden de apagado enviada a OpenRGB.';
    // If this was the local fast path, rgbState is pushed by Native Messaging.
    // Remote devices receive the same state through Firestore without polling loops.
  }

  function toggleRgb() {
    const current = normalizeRgbState(dom.rgb?.dataset.state || state.lastDevice?.rgbState);
    void applyRgb(current !== 'on', dom.rgbColor?.value || state.lastDevice?.rgbColor || '#FFFFFF', 'power');
  }

  function bindUi() {
    dom.toggles?.forEach((toggle) => {
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void openModal();
      });
    });
    dom.close?.addEventListener('click', closeModal);
    dom.backdrop?.addEventListener('click', closeModal);
    dom.grid?.addEventListener('click', (event) => {
      const button = event.target.closest?.('.windows-pc-action');
      if (!button || button.disabled) return;
      void runSystemAction(button);
    });
    dom.hotspot?.addEventListener('click', () => void toggleHotspot());
    dom.rgbPower?.addEventListener('click', toggleRgb);
    dom.rgbColor?.addEventListener('input', () => {
      const color = setRgbVisualColor(dom.rgbColor.value);
      if (dom.rgb) dom.rgb.style.setProperty('--active-rgb', color);
    });
    dom.rgbColor?.addEventListener('change', () => void applyRgb(true, dom.rgbColor.value, 'color'));
    dom.rgbSwatches?.addEventListener('click', (event) => {
      const swatch = event.target.closest?.('[data-rgb-color]');
      if (!swatch || state.rgbBusy || dom.rgbPower?.disabled) return;
      void applyRgb(true, swatch.dataset.rgbColor, 'color');
    });
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
