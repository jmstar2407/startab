(() => {
  'use strict';

  const FIREBASE_RETRY_MS = 300;
  const FIREBASE_MAX_RETRIES = 40;
  const DEVICE_STALE_MS = 90_000;
  const SELECTED_DEVICE_KEY = 'startab_windows_volume_selected_device_v2';
  const CLIENT_ID_KEY = 'startab_windows_system_client_v1';
  const REFRESH_INTERVAL_MS = 15_000;
  const REQUIRED_AGENT = [2, 4, 0];
  const RGB_REQUIRED_AGENT = [2, 7, 0];

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
    rgbApplyTimer: 0,
    rgbLocalColor: '#7C5CFF',
    rgbLocalBrightness: 100,
    rgbLastNonZeroBrightness: 100,
    rgbLocalPowered: true,
    rgbDesired: null,
    rgbSending: false,
    rgbPendingRevision: 0,
    rgbLastRevision: 0,
    rgbLastAcceptedRevision: 0,
    rgbLocalNativeDeviceId: '',
    rgbLocalNativeConnected: false,
    rgbLocalNativeCheckedAt: 0,
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
    dom.rgbOpen = $('windows-pc-rgb-open');
    dom.rgbNote = $('windows-pc-rgb-note');
    dom.rgbStudio = $('windows-rgb-studio');
    dom.rgbVisual = $('windows-rgb-visual');
    dom.rgbPercent = $('windows-rgb-percent');
    dom.rgbStatus = $('windows-rgb-status');
    dom.rgbProvider = $('windows-rgb-provider');
    dom.rgbPower = $('windows-rgb-power');
    dom.rgbColor = $('windows-rgb-color');
    dom.rgbHex = $('windows-rgb-hex');
    dom.rgbColorSwatch = $('windows-rgb-color-swatch');
    dom.rgbPresets = $('windows-rgb-presets');
    dom.rgbBrightness = $('windows-rgb-brightness');
    dom.rgbBrightnessValue = $('windows-rgb-brightness-value');
    dom.rgbHardwareNote = $('windows-rgb-hardware-note');
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

  function normalizeRgbState(value) {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'ready' || normalized === 'off' || normalized === 'unavailable' || normalized === 'error') return normalized;
    return 'unknown';
  }

  function normalizeRgbColor(value, fallback = '#7C5CFF') {
    const raw = String(value || '').trim().replace(/^#/, '');
    return /^[0-9a-f]{6}$/i.test(raw) ? `#${raw.toUpperCase()}` : fallback;
  }

  function setRgbPowerUi(powered) {
    state.rgbLocalPowered = !!powered;
    if (!dom.rgbPower) return;
    dom.rgbPower.setAttribute('aria-pressed', powered ? 'true' : 'false');
    const label = dom.rgbPower.querySelector('span');
    if (label) label.textContent = powered ? 'ON' : 'OFF';
  }

  function updateActiveRgbPreset(color) {
    const normalized = normalizeRgbColor(color, state.rgbLocalColor);
    dom.rgbPresets?.querySelectorAll('[data-rgb-color]').forEach((button) => {
      button.classList.toggle('is-active', normalizeRgbColor(button.dataset.rgbColor, '') === normalized);
    });
  }

  function setRgbPreview(color, brightness, powered) {
    const safeColor = normalizeRgbColor(color, state.rgbLocalColor);
    const safeBrightness = Math.max(0, Math.min(100, Number(brightness) || 0));
    state.rgbLocalColor = safeColor;
    state.rgbLocalBrightness = safeBrightness;
    state.rgbLocalPowered = !!powered && safeBrightness > 0;
    if (safeBrightness > 0) state.rgbLastNonZeroBrightness = safeBrightness;
    document.documentElement.style.setProperty('--startab-rgb-accent', safeColor);
    dom.rgbVisual?.style.setProperty('--rgb-color', safeColor);
    dom.rgbVisual?.style.setProperty('--rgb-power', state.rgbLocalPowered ? String(Math.max(.08, safeBrightness / 100)) : '0');
    if (dom.rgbColor) dom.rgbColor.value = safeColor.toLowerCase();
    if (dom.rgbHex && document.activeElement !== dom.rgbHex) dom.rgbHex.value = safeColor;
    if (dom.rgbPercent) dom.rgbPercent.textContent = `${safeBrightness}%`;
    if (dom.rgbBrightness && document.activeElement !== dom.rgbBrightness) dom.rgbBrightness.value = String(safeBrightness);
    if (dom.rgbBrightnessValue) dom.rgbBrightnessValue.textContent = `${safeBrightness}%`;
    if (dom.rgbStudio) dom.rgbStudio.classList.toggle('is-off', !state.rgbLocalPowered);
    setRgbPowerUi(state.rgbLocalPowered);
    updateActiveRgbPreset(safeColor);
  }

  function setRgbControlsEnabled(enabled) {
    if (dom.rgbPower) dom.rgbPower.disabled = !enabled;
    if (dom.rgbColor) dom.rgbColor.disabled = !enabled;
    if (dom.rgbHex) dom.rgbHex.disabled = !enabled;
    if (dom.rgbBrightness) dom.rgbBrightness.disabled = !enabled;
    dom.rgbPresets?.querySelectorAll('button').forEach((button) => { button.disabled = !enabled; });
  }

  function nextRgbRevision() {
    const now = Date.now();
    state.rgbLastRevision = Math.max(now, state.rgbLastRevision + 1);
    return state.rgbLastRevision;
  }

  async function refreshLocalNativeTarget(force = false) {
    if (!globalThis.chrome?.runtime?.sendMessage) return false;
    const now = Date.now();
    if (!force && now - state.rgbLocalNativeCheckedAt < 5000) return state.rgbLocalNativeConnected;
    state.rgbLocalNativeCheckedAt = now;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'STARTAB_WINDOWS_NATIVE_GET_STATE' });
      state.rgbLocalNativeConnected = !!response?.connected;
      state.rgbLocalNativeDeviceId = String(response?.state?.deviceId || response?.deviceId || '');
      return state.rgbLocalNativeConnected;
    } catch (_) {
      state.rgbLocalNativeConnected = false;
      state.rgbLocalNativeDeviceId = '';
      return false;
    }
  }

  function isSelectedLocalNative() {
    return !!state.rgbLocalNativeConnected
      && !!state.rgbLocalNativeDeviceId
      && state.rgbLocalNativeDeviceId === String(state.lastDevice?.deviceId || state.deviceId || '');
  }

  async function sendRgbTransport(action, payload, revision) {
    try {
      await refreshLocalNativeTarget(false);
      if (isSelectedLocalNative() && globalThis.chrome?.runtime?.sendMessage) {
        const command = action === 'rgbOff'
          ? { type: 'rgbOff', revision }
          : { type: action, color: payload.color, brightness: payload.brightness, revision };
        const response = await chrome.runtime.sendMessage({ type: 'STARTAB_WINDOWS_NATIVE_COMMAND', command });
        if (response?.ok) return true;
        // Si el bridge local falla, cae automáticamente a Firebase.
        state.rgbLocalNativeConnected = false;
      }
      return await writeCommand(action, { ...payload, revision });
    } catch (error) {
      console.error('StarTab RGB Engine: no se pudo enviar el comando:', error);
      return false;
    }
  }

  async function flushRgbDesired() {
    if (state.rgbSending || !state.rgbDesired) return;
    state.rgbSending = true;
    dom.rgbStudio?.classList.add('is-sending');

    try {
      while (state.rgbDesired) {
        const desired = state.rgbDesired;
        state.rgbDesired = null;
        const action = desired.powered && desired.brightness > 0 ? 'rgbSet' : 'rgbOff';
        const ok = await sendRgbTransport(action, action === 'rgbOff' ? {} : {
          color: desired.color.slice(1),
          brightness: desired.brightness,
        }, desired.revision);

        if (!ok) {
          if (state.rgbPendingRevision === desired.revision) state.rgbPendingRevision = 0;
          if (dom.note) dom.note.textContent = 'No se pudo aplicar el cambio RGB.';
          break;
        }

        if (dom.note && !state.rgbDesired) {
          dom.note.textContent = action === 'rgbOff'
            ? 'Iluminación RGB apagada.'
            : `RGB ${desired.color} · ${desired.brightness}% enviado.`;
        }
      }
    } finally {
      state.rgbSending = false;
      if (!state.rgbDesired) dom.rgbStudio?.classList.remove('is-sending');
      else void flushRgbDesired();
    }
  }

  function scheduleRgbApply({ immediate = false, powered = null } = {}) {
    clearTimeout(state.rgbApplyTimer);
    state.rgbApplyTimer = 0;
    if (!dom.rgbStudio || !dom.rgbPower || dom.rgbPower.disabled) return;

    const brightness = Math.max(0, Math.min(100, Number(state.rgbLocalBrightness) || 0));
    const revision = nextRgbRevision();
    state.rgbPendingRevision = revision;
    state.rgbDesired = {
      color: normalizeRgbColor(state.rgbLocalColor),
      brightness,
      powered: powered == null ? (state.rgbLocalPowered && brightness > 0) : (!!powered && brightness > 0),
      revision,
    };

    if (dom.rgbStatus) dom.rgbStatus.textContent = `Aplicando ${state.rgbDesired.color} · ${brightness}%`;
    if (immediate) void flushRgbDesired();
    else state.rgbApplyTimer = window.setTimeout(() => void flushRgbDesired(), 65);
  }

  async function toggleRgbPower() {
    if (!dom.rgbPower || dom.rgbPower.disabled) return;
    const next = !state.rgbLocalPowered;
    let brightness = state.rgbLocalBrightness;
    if (next && brightness <= 0) brightness = Math.max(1, state.rgbLastNonZeroBrightness || 100);
    setRgbPreview(state.rgbLocalColor, brightness, next);
    globalThis.StartabHaptics?.pulse?.('pc-rgb-power', next ? 13 : 8, 55);
    scheduleRgbApply({ immediate: true, powered: next });
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

    const rgbAgentSupported = online && versionAtLeast(device?.agentVersion, RGB_REQUIRED_AGENT);
    const rgbState = normalizeRgbState(device?.rgbState);
    const rgbAvailable = rgbAgentSupported && (rgbState === 'ready' || rgbState === 'off');
    const remoteRevision = Math.max(0, Number(device?.rgbRevision) || 0);
    const remoteIsNewest = remoteRevision >= state.rgbLastAcceptedRevision;
    const remoteSatisfiesPending = state.rgbPendingRevision === 0 || remoteRevision >= state.rgbPendingRevision;
    const remoteIsCurrent = remoteIsNewest && remoteSatisfiesPending;

    if (remoteIsCurrent) {
      state.rgbLastAcceptedRevision = Math.max(state.rgbLastAcceptedRevision, remoteRevision);
      if (remoteRevision >= state.rgbPendingRevision) state.rgbPendingRevision = 0;
      const rgbPowered = rgbState !== 'off' && device?.rgbPowered !== false;
      const rgbColor = normalizeRgbColor(device?.rgbColor, state.rgbLocalColor);
      const rgbBrightness = Math.max(0, Math.min(100, Number(device?.rgbBrightness ?? state.rgbLocalBrightness) || 0));
      setRgbPreview(rgbColor, rgbBrightness, rgbPowered);
    }

    setRgbControlsEnabled(rgbAvailable);
    if (dom.rgbOpen) {
      dom.rgbOpen.disabled = !rgbAvailable;
      dom.rgbOpen.classList.toggle('is-rgb-off', !state.rgbLocalPowered);
    }

    const shownColor = normalizeRgbColor(state.rgbLocalColor);
    const shownBrightness = Math.max(0, Math.min(100, Number(state.rgbLocalBrightness) || 0));
    if (dom.rgbStatus) {
      if (!rgbAgentSupported) dom.rgbStatus.textContent = supported ? 'Actualiza el agente a v2.7.0' : 'Agente de Windows no compatible';
      else if (!remoteIsCurrent || state.rgbSending || state.rgbDesired) dom.rgbStatus.textContent = `Aplicando ${shownColor} · ${shownBrightness}%`;
      else if (rgbState === 'off') dom.rgbStatus.textContent = 'Iluminación apagada';
      else if (rgbState === 'ready') dom.rgbStatus.textContent = `${Math.max(0, Number(device?.rgbDevices) || 0)} dispositivo(s) · listo`;
      else if (rgbState === 'unavailable') dom.rgbStatus.textContent = 'OpenRGB no disponible';
      else if (rgbState === 'error') dom.rgbStatus.textContent = 'Error de iluminación';
      else dom.rgbStatus.textContent = 'Consultando iluminación';
    }
    if (dom.rgbProvider) {
      const fusion = !!device?.rgbFusionDetected;
      const provider = String(device?.rgbProvider || 'OpenRGB');
      const direct = /sdk/i.test(provider) ? ' · motor directo' : '';
      dom.rgbProvider.textContent = `${provider}${direct}${fusion ? ' · RGB Fusion detectado' : ''}`;
    }
    if (dom.rgbHardwareNote) {
      const fusion = !!device?.rgbFusionDetected;
      dom.rgbHardwareNote.textContent = fusion
        ? 'Motor OpenRGB persistente · RGB Fusion detectado para hardware Gigabyte/RAM no expuesto por OpenRGB'
        : 'Motor OpenRGB persistente · board · RAM · GPU · tiras LED compatibles';
    }
    if (dom.rgbNote) {
      const devices = Math.max(0, Number(device?.rgbDevices) || 0);
      if (!rgbAgentSupported) dom.rgbNote.textContent = supported ? 'Requiere agente Windows v2.7.0 o superior' : 'Actualiza el agente de Windows';
      else if (!remoteIsCurrent || state.rgbSending || state.rgbDesired) dom.rgbNote.textContent = `${shownColor} · ${shownBrightness}% · sincronizando`;
      else if (rgbState === 'off') dom.rgbNote.textContent = devices ? `RGB apagado · ${devices} dispositivo(s)` : 'Iluminación RGB apagada';
      else if (rgbState === 'ready') dom.rgbNote.textContent = `${shownColor} · ${shownBrightness}% · ${devices} dispositivo(s)`;
      else if (rgbState === 'unavailable') dom.rgbNote.textContent = 'OpenRGB no está disponible';
      else if (rgbState === 'error') dom.rgbNote.textContent = String(device?.rgbMessage || 'No se pudo acceder al hardware RGB').slice(0, 120);
      else dom.rgbNote.textContent = 'Consultando iluminación RGB…';
    }

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
    clearTimeout(state.rgbApplyTimer);
    state.rgbApplyTimer = 0;
    state.rgbDesired = null;
    state.rgbPendingRevision = 0;
    state.rgbLastAcceptedRevision = 0;
    state.rgbLocalNativeDeviceId = '';
    state.rgbLocalNativeConnected = false;
    state.rgbLocalNativeCheckedAt = 0;
    dom.rgbStudio?.classList.remove('is-sending');
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
    void refreshLocalNativeTarget(true);
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
    if (ok && ['shutdown', 'restart', 'logoff', 'sleep', 'lock', 'monitorOff', 'rgbOff'].includes(action)) {
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
    dom.rgbPower?.addEventListener('click', () => void toggleRgbPower());
    dom.rgbColor?.addEventListener('input', (event) => {
      const color = normalizeRgbColor(event.target.value, state.rgbLocalColor);
      const brightness = state.rgbLocalBrightness > 0 ? state.rgbLocalBrightness : Math.max(1, state.rgbLastNonZeroBrightness || 100);
      setRgbPreview(color, brightness, true);
      scheduleRgbApply();
    });
    dom.rgbColor?.addEventListener('change', () => scheduleRgbApply({ immediate: true }));
    dom.rgbHex?.addEventListener('input', (event) => {
      const raw = String(event.target.value || '').trim();
      if (!/^#[0-9a-f]{6}$/i.test(raw)) return;
      const color = normalizeRgbColor(raw);
      const brightness = state.rgbLocalBrightness > 0 ? state.rgbLocalBrightness : Math.max(1, state.rgbLastNonZeroBrightness || 100);
      setRgbPreview(color, brightness, true);
      scheduleRgbApply();
    });
    dom.rgbHex?.addEventListener('change', () => {
      dom.rgbHex.value = normalizeRgbColor(dom.rgbHex.value, state.rgbLocalColor);
      scheduleRgbApply({ immediate: true });
    });
    dom.rgbBrightness?.addEventListener('input', (event) => {
      const brightness = Math.max(0, Math.min(100, Number(event.target.value) || 0));
      setRgbPreview(state.rgbLocalColor, brightness, brightness > 0);
      scheduleRgbApply();
    });
    dom.rgbBrightness?.addEventListener('change', () => scheduleRgbApply({ immediate: true }));
    dom.rgbPresets?.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-rgb-color]');
      if (!button || button.disabled) return;
      const color = normalizeRgbColor(button.dataset.rgbColor, state.rgbLocalColor);
      const brightness = state.rgbLocalBrightness > 0 ? state.rgbLocalBrightness : Math.max(1, state.rgbLastNonZeroBrightness || 100);
      setRgbPreview(color, brightness, true);
      globalThis.StartabHaptics?.pulse?.('pc-rgb-preset', 8, 45);
      scheduleRgbApply({ immediate: true, powered: true });
    });
    dom.deviceSelect?.addEventListener('change', () => {
      if (state.open) {
        clearConfirmation();
        connectSelectedDevice();
        void refreshLocalNativeTarget(true);
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
