(() => {
  'use strict';

  const FIREBASE_READY_RETRY_MS = 300;
  const FIREBASE_READY_MAX_RETRIES = 40;
  const DEVICE_STALE_MS = 90_000;
  const SELECTED_DEVICE_KEY = 'startab_windows_volume_selected_device_v2';
  const CLIENT_ID_KEY = 'startab_windows_volume_client_id_v2';

  const state = {
    db: null,
    auth: null,
    user: null,
    devices: new Map(),
    unsubscribeDevices: null,
    selectedDeviceId: null,
    firebaseRetry: 0,
    commandTimer: 0,
    pendingVolume: null,
    userTimer: 0,
    statusTimer: 0,
    native: {
      supported: false,
      connected: false,
      deviceId: null,
      deviceName: null,
      volume: null,
      muted: null,
      lastError: null,
    },
  };

  const dom = {};
  const $ = (id) => document.getElementById(id);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const isWindows = /Windows/i.test(navigator.userAgent || '');
  const isExtension = !!globalThis.chrome?.runtime?.id;

  const clientId = (() => {
    try {
      const existing = sessionStorage.getItem(CLIENT_ID_KEY);
      if (existing) return existing;
      const created = crypto.randomUUID?.() || `startab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(CLIENT_ID_KEY, created);
      return created;
    } catch (_) {
      return `startab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  })();

  function cacheDom() {
    dom.card = $('windows-system-volume');
    dom.device = $('windows-device-select');
    dom.status = $('windows-volume-status');
    dom.statusText = $('windows-volume-status-text');
    dom.range = $('windows-volume-range');
    dom.fill = $('windows-volume-fill');
    dom.value = $('windows-volume-value');
    dom.mute = $('windows-volume-mute');
    dom.down = $('windows-volume-down');
    dom.up = $('windows-volume-up');
    dom.pair = $('windows-volume-pair');
    dom.hint = $('windows-volume-hint');
    dom.icon = $('windows-volume-icon');
  }

  function readSavedUser() {
    try {
      const raw = localStorage.getItem('starTab_lastUser');
      if (!raw) return null;
      const user = JSON.parse(raw);
      return user?.uid ? user : null;
    } catch (_) {
      return null;
    }
  }

  function currentFirebaseUser() {
    try {
      const user = state.auth?.currentUser;
      if (!user?.uid) return null;
      return {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
      };
    } catch (_) {
      return null;
    }
  }

  function syncUser() {
    const next = currentFirebaseUser() || readSavedUser();
    const nextUid = next?.uid || null;
    if ((state.user?.uid || null) === nextUid) return;
    state.user = next;
    connectDeviceListener();
    render();
  }

  function selectedDevice() {
    return state.selectedDeviceId ? state.devices.get(state.selectedDeviceId) || null : null;
  }

  function isDeviceOnline(device) {
    if (!device?.online) return false;
    const clientAt = Number(device.clientAt) || 0;
    return clientAt > 0 && Date.now() - clientAt < DEVICE_STALE_MS;
  }

  function setFill(value) {
    const normalized = clamp(value, 0, 100);
    dom.fill?.style.setProperty('--windows-volume', `${normalized}%`);
  }

  function setControlDisabled(disabled) {
    for (const element of [dom.range, dom.mute, dom.down, dom.up]) {
      if (element) element.disabled = !!disabled;
    }
  }

  function persistSelectedDevice() {
    if (!state.user?.uid || !state.selectedDeviceId) return;
    try {
      localStorage.setItem(
        SELECTED_DEVICE_KEY,
        JSON.stringify({ uid: state.user.uid, deviceId: state.selectedDeviceId }),
      );
    } catch (_) {}
  }

  function renderDevices() {
    if (!dom.device) return;
    const previous = state.selectedDeviceId;
    const devices = [...state.devices.values()].sort((a, b) => {
      const onlineDelta = Number(isDeviceOnline(b)) - Number(isDeviceOnline(a));
      if (onlineDelta) return onlineDelta;
      return String(a.deviceName || '').localeCompare(String(b.deviceName || ''), 'es');
    });

    dom.device.replaceChildren();
    if (!devices.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = state.user ? 'Sin PCs vinculados' : 'Inicia sesión';
      dom.device.append(option);
      state.selectedDeviceId = null;
      return;
    }

    for (const device of devices) {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = `${device.deviceName || 'PC Windows'}${isDeviceOnline(device) ? ' · En línea' : ' · Offline'}`;
      dom.device.append(option);
    }

    let desired = previous;
    if (!desired || !state.devices.has(desired)) {
      try {
        const stored = JSON.parse(localStorage.getItem(SELECTED_DEVICE_KEY) || '{}');
        if (stored?.uid === state.user?.uid && state.devices.has(stored.deviceId)) desired = stored.deviceId;
      } catch (_) {}
    }
    if (!desired || !state.devices.has(desired)) {
      desired = devices.find((device) => device.deviceId === state.native.deviceId)?.deviceId
        || devices.find(isDeviceOnline)?.deviceId
        || devices[0].deviceId;
    }

    state.selectedDeviceId = desired;
    dom.device.value = desired;
    persistSelectedDevice();
  }

  function render() {
    if (!dom.card) return;
    const device = selectedDevice();
    const loggedIn = !!state.user?.uid;
    const online = isDeviceOnline(device);
    const volume = device ? clamp(device.volume, 0, 100) : 0;
    const muted = !!device?.muted;

    dom.card.dataset.state = !loggedIn ? 'signed-out' : !device ? 'empty' : online ? 'online' : 'offline';
    dom.status?.classList.toggle('is-online', online);
    dom.status?.classList.toggle('is-offline', !!device && !online);

    if (dom.statusText) {
      dom.statusText.textContent = !loggedIn
        ? state.native.connected
          ? 'Agente Windows detectado · inicia sesión para sincronizarlo'
          : 'Inicia sesión para sincronizar tus PCs'
        : !device
          ? state.native.connected
            ? 'Agente conectado · registrando este PC en StarTab'
            : 'No hay PCs Windows vinculados'
          : online
            ? 'Volumen maestro sincronizado en tiempo real'
            : 'PC sin conexión · esperando reconexión';
    }

    if (dom.range && !dom.range.matches(':active')) dom.range.value = String(muted ? 0 : volume);
    if (dom.value) dom.value.textContent = `${Math.round(muted ? 0 : volume)}%`;
    setFill(muted ? 0 : volume);

    if (dom.icon) dom.icon.dataset.level = muted || volume === 0 ? 'mute' : volume < 50 ? 'low' : 'high';
    if (dom.mute) {
      dom.mute.classList.toggle('is-muted', muted);
      dom.mute.setAttribute('aria-pressed', muted ? 'true' : 'false');
      dom.mute.title = muted ? 'Activar sonido de Windows' : 'Silenciar Windows';
    }

    setControlDisabled(!loggedIn || !device || !online);
    if (dom.device) dom.device.disabled = !loggedIn || state.devices.size === 0;

    const canUseNative = isWindows && isExtension;
    if (dom.pair) {
      dom.pair.hidden = !canUseNative;
      dom.pair.disabled = state.native.connected;
      dom.pair.classList.toggle('is-linked', state.native.connected);
      dom.pair.textContent = state.native.connected ? 'Agente conectado' : 'Copiar ID para instalar';
    }

    if (dom.hint) {
      if (!loggedIn) {
        dom.hint.textContent = state.native.connected
          ? `${state.native.deviceName || 'Este PC'} · el EXE no usa Firebase; inicia sesión en StarTab para vincularlo.`
          : canUseNative
            ? 'Instala el EXE de Windows y luego inicia sesión en StarTab.'
            : 'La misma cuenta de StarTab permite controlar tus PCs desde móvil y web.';
      } else if (device) {
        dom.hint.textContent = `${device.deviceName || 'PC Windows'} · ${String(device.deviceId || '').slice(0, 8)}…`;
      } else if (canUseNative && !state.native.connected) {
        dom.hint.textContent = `Agente no detectado · ID de extensión: ${chrome.runtime.id}`;
      } else {
        dom.hint.textContent = 'Abre StarTab en el PC Windows para registrar su agente local.';
      }
    }
  }

  function connectDeviceListener() {
    state.unsubscribeDevices?.();
    state.unsubscribeDevices = null;
    state.devices.clear();

    if (!state.user?.uid || !state.db) {
      renderDevices();
      render();
      return;
    }

    state.unsubscribeDevices = state.db
      .collection('users')
      .doc(state.user.uid)
      .collection('windowsDevices')
      .onSnapshot(
        (snapshot) => {
          state.devices.clear();
          snapshot.forEach((doc) => {
            const data = doc.data() || {};
            state.devices.set(doc.id, { ...data, deviceId: data.deviceId || doc.id });
          });
          renderDevices();
          render();
        },
        (error) => {
          console.error('StarTab Windows Volume: error leyendo dispositivos:', error);
          if (dom.statusText) dom.statusText.textContent = 'No se pudo sincronizar Firestore';
        },
      );
  }

  function connectFirebase() {
    try {
      if (typeof firebase === 'undefined' || !firebase.apps?.length) {
        if (state.firebaseRetry++ < FIREBASE_READY_MAX_RETRIES) {
          window.setTimeout(connectFirebase, FIREBASE_READY_RETRY_MS);
        }
        return;
      }
      if (state.db) return;
      state.db = firebase.firestore();
      state.auth = firebase.auth();
      state.auth.onAuthStateChanged(() => syncUser());
      syncUser();
      connectDeviceListener();
    } catch (error) {
      console.error('StarTab Windows Volume: Firebase no disponible:', error);
    }
  }

  async function sendCommand(action, value = null) {
    const device = selectedDevice();
    if (!state.user?.uid || !state.db || !device || !isDeviceOnline(device)) return false;

    const command = {
      id: `${Date.now().toString(36)}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
      action,
      issuedBy: state.user.uid,
      issuedByClient: clientId,
      clientAt: Date.now(),
      expiresAtClient: Date.now() + 20_000,
      serverAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (Number.isFinite(Number(value))) command.value = Number(value);

    try {
      await state.db
        .collection('users')
        .doc(state.user.uid)
        .collection('windowsDevices')
        .doc(device.deviceId)
        .set({ command }, { merge: true });
      return true;
    } catch (error) {
      console.error('StarTab Windows Volume: no se pudo enviar el comando:', error);
      return false;
    }
  }

  function queueVolume(value) {
    state.pendingVolume = clamp(value, 0, 100);
    clearTimeout(state.commandTimer);
    state.commandTimer = window.setTimeout(() => {
      const next = state.pendingVolume;
      state.pendingVolume = null;
      void sendCommand('setVolume', next);
    }, 80);
  }

  function applyNativeStatus(payload) {
    if (!payload || typeof payload !== 'object') return;
    state.native.connected = !!payload.connected;
    const nativeState = payload.state || payload;
    if (nativeState?.deviceId) state.native.deviceId = nativeState.deviceId;
    if (nativeState?.deviceName) state.native.deviceName = nativeState.deviceName;
    if (Number.isFinite(Number(nativeState?.volume))) state.native.volume = Number(nativeState.volume);
    if (typeof nativeState?.muted === 'boolean') state.native.muted = nativeState.muted;
    if (payload.error) state.native.lastError = String(payload.error);
    render();
  }

  function connectNativeUiBridge() {
    state.native.supported = isWindows && isExtension;
    if (!state.native.supported) return;

    try {
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'STARTAB_WINDOWS_NATIVE_STATUS') {
          applyNativeStatus(message);
        }
      });
      chrome.runtime.sendMessage({ type: 'STARTAB_WINDOWS_NATIVE_GET_STATE' }, (response) => {
        void chrome.runtime.lastError;
        if (response) applyNativeStatus(response);
      });
      chrome.runtime.sendMessage({ type: 'STARTAB_WINDOWS_NATIVE_RECONNECT' }, () => {
        void chrome.runtime.lastError;
      });
    } catch (error) {
      state.native.lastError = String(error?.message || error);
    }
  }

  async function copyExtensionId() {
    if (!isExtension) return;
    const id = chrome.runtime.id;
    try {
      await navigator.clipboard.writeText(id);
      if (dom.pair) {
        const previous = dom.pair.textContent;
        dom.pair.textContent = 'ID copiado';
        window.setTimeout(() => {
          if (dom.pair && !state.native.connected) dom.pair.textContent = previous || 'Copiar ID para instalar';
        }, 1600);
      }
    } catch (_) {
      window.prompt('Copia este ID de extensión para instalar el agente:', id);
    }
  }

  function bindEvents() {
    dom.device?.addEventListener('change', () => {
      state.selectedDeviceId = dom.device.value || null;
      persistSelectedDevice();
      render();
    });

    dom.range?.addEventListener('input', () => {
      const value = clamp(dom.range.value, 0, 100);
      if (dom.value) dom.value.textContent = `${Math.round(value)}%`;
      setFill(value);
      queueVolume(value);
    });
    dom.range?.addEventListener('change', () => {
      clearTimeout(state.commandTimer);
      state.pendingVolume = null;
      void sendCommand('setVolume', clamp(dom.range.value, 0, 100));
    });

    dom.mute?.addEventListener('click', () => void sendCommand('toggleMute'));
    const stepVolume = (delta) => {
      if (!dom.range || dom.range.disabled) return;
      const next = clamp(Number(dom.range.value) + delta, 0, 100);
      dom.range.value = String(next);
      if (dom.value) dom.value.textContent = `${Math.round(next)}%`;
      setFill(next);
      void sendCommand('setVolume', next);
    };
    dom.down?.addEventListener('click', () => stepVolume(-5));
    dom.up?.addEventListener('click', () => stepVolume(5));
    dom.pair?.addEventListener('click', () => void copyExtensionId());
  }

  function init() {
    cacheDom();
    if (!dom.card) return;
    bindEvents();
    renderDevices();
    render();
    connectFirebase();
    connectNativeUiBridge();
    syncUser();
    state.userTimer = window.setInterval(syncUser, 900);
    state.statusTimer = window.setInterval(render, 5_000);
    window.addEventListener('storage', (event) => {
      if (event.key === 'starTab_lastUser') syncUser();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
