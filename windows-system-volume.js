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
    dialDragging: false,
    dialValue: 0,
    dialHapticBucket: null,
    mobileLayoutMql: null,
    optimisticVolume: null,
    optimisticMuted: null,
    optimisticUntil: 0,
    optimisticTimer: 0,
    native: {
      supported: false,
      connected: false,
      deviceId: null,
      deviceName: null,
      volume: null,
      muted: null,
      audioActive: null,
      lastError: null,
    },
  };

  const dom = {};
  const $ = (id) => document.getElementById(id);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const isWindows = /Windows/i.test(navigator.userAgent || '');
  const isExtension = !!globalThis.chrome?.runtime?.id;
  const MOBILE_MEDIA_QUERY = '(max-width: 760px)';
  const DIAL_START_DEG = 135;
  const DIAL_SWEEP_DEG = 270;
  const DIAL_END_DEG = DIAL_START_DEG + DIAL_SWEEP_DEG;
  const DIAL_SEGMENTS = 37;

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
    dom.footer = $('multimedia-system-footer');
    dom.footerToggle = $('multimedia-system-volume-toggle');
    dom.dialPanel = $('windows-volume-dial-panel');
    dom.dial = $('windows-volume-dial');
    dom.dialSegments = $('windows-volume-dial-segments');
    dom.dialValue = $('windows-volume-dial-value');
    dom.dialMute = $('windows-volume-dial-mute');
    dom.spectrum = $('windows-volume-spectrum');
    dom.sourceList = $('multimedia-source-list');
    dom.mobileSourceSlot = $('multimedia-mobile-source-slot');
    dom.desktopSourceAnchor = $('multimedia-source-desktop-anchor');
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

  function buildSpectrumBars() {
    if (!dom.spectrum || dom.spectrum.childElementCount) return;
    const fragment = document.createDocumentFragment();
    const heights = [.42,.58,.74,.91,.63,.82,.51,.96,.69,.86,1,.77,.59,.9,.66,.84,.48,.76,.57,.88,.44];
    heights.forEach((height, index) => {
      const bar = document.createElement('span');
      bar.setAttribute('aria-hidden', 'true');
      bar.style.setProperty('--spectrum-index', String(index));
      bar.style.setProperty('--spectrum-delay', `${index * -31}ms`);
      bar.style.setProperty('--spectrum-height', String(height));
      bar.style.setProperty('--spectrum-mid', String(Math.max(.28, height * .62)));
      bar.style.setProperty('--spectrum-speed', `${0.43 + ((index * 17) % 19) / 100}s`);
      fragment.append(bar);
    });
    dom.spectrum.append(fragment);
  }

  function renderSpectrum(active) {
    if (!dom.spectrum) return;
    dom.spectrum.classList.toggle('is-active', !!active);
    dom.spectrum.setAttribute('aria-label', active ? 'Windows está reproduciendo audio' : 'Sin actividad de audio en Windows');
  }

  function clearOptimisticState() {
    state.optimisticVolume = null;
    state.optimisticMuted = null;
    state.optimisticUntil = 0;
    clearTimeout(state.optimisticTimer);
    state.optimisticTimer = 0;
  }

  function holdOptimisticState({ volume = state.optimisticVolume, muted = state.optimisticMuted } = {}) {
    if (volume !== null && volume !== undefined) state.optimisticVolume = clamp(volume, 0, 100);
    if (typeof muted === 'boolean') state.optimisticMuted = muted;
    state.optimisticUntil = Date.now() + 2400;
    clearTimeout(state.optimisticTimer);
    state.optimisticTimer = window.setTimeout(() => {
      if (Date.now() >= state.optimisticUntil) {
        clearOptimisticState();
        render();
      }
    }, 2450);
  }

  function reconcileOptimisticState(device) {
    if (!device || Date.now() >= state.optimisticUntil) {
      if (state.optimisticUntil) clearOptimisticState();
      return;
    }

    const volumeMatches = state.optimisticVolume == null
      || Math.abs(clamp(device.volume, 0, 100) - state.optimisticVolume) <= 1;
    const muteMatches = state.optimisticMuted == null
      || !!device.muted === state.optimisticMuted;
    if (volumeMatches && muteMatches) clearOptimisticState();
  }

  function effectiveMuted(device = selectedDevice()) {
    if (Date.now() < state.optimisticUntil && typeof state.optimisticMuted === 'boolean') return state.optimisticMuted;
    return !!device?.muted;
  }

  function buildDialSegments() {
    if (!dom.dialSegments || dom.dialSegments.childElementCount) return;
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < DIAL_SEGMENTS; index += 1) {
      const segment = document.createElement('i');
      const progress = index / (DIAL_SEGMENTS - 1);
      const angle = DIAL_START_DEG + (progress * DIAL_SWEEP_DEG);
      segment.style.setProperty('--segment-angle', `${angle}deg`);
      segment.dataset.index = String(index);
      fragment.append(segment);
    }
    dom.dialSegments.append(fragment);
  }

  function renderDial(value, muted = false) {
    const normalized = clamp(value, 0, 100);
    state.dialValue = normalized;
    const angle = DIAL_START_DEG + ((normalized / 100) * DIAL_SWEEP_DEG);
    dom.dial?.style.setProperty('--dial-angle', `${angle}deg`);
    dom.dial?.style.setProperty('--dial-progress', String(normalized / 100));
    dom.dial?.setAttribute('aria-valuenow', String(Math.round(normalized)));
    dom.dial?.setAttribute('aria-valuetext', `${Math.round(normalized)} por ciento`);
    if (dom.dialValue) dom.dialValue.textContent = `${Math.round(normalized)}%`;

    if (dom.dialSegments) {
      const activeMax = Math.round((normalized / 100) * (DIAL_SEGMENTS - 1));
      [...dom.dialSegments.children].forEach((segment, index) => {
        segment.classList.toggle('is-active', normalized > 0 && index <= activeMax);
      });
    }

    if (dom.dialMute) {
      dom.dialMute.classList.toggle('is-muted', muted);
      dom.dialMute.setAttribute('aria-pressed', muted ? 'true' : 'false');
      dom.dialMute.setAttribute('aria-label', muted ? 'Activar sonido de Windows' : 'Silenciar volumen de Windows');
      dom.dialMute.title = muted ? 'Activar sonido de Windows' : 'Silenciar Windows';
    }
  }

  function pointerAngleToDialValue(event) {
    if (!dom.dial) return state.dialValue;
    const rect = dom.dial.getBoundingClientRect();
    const centerX = rect.left + (rect.width / 2);
    const centerY = rect.top + (rect.height / 2);
    let angle = Math.atan2(event.clientY - centerY, event.clientX - centerX) * (180 / Math.PI);
    if (angle < 0) angle += 360;

    // The active arc runs clockwise from the lower-left to lower-right through the top.
    // The 90° gap at the bottom snaps to the closest end stop so the dial cannot loop.
    let unwrapped;
    if (angle >= DIAL_START_DEG) {
      unwrapped = angle;
    } else if (angle <= (DIAL_END_DEG - 360)) {
      unwrapped = angle + 360;
    } else {
      unwrapped = angle < 90 ? DIAL_END_DEG : DIAL_START_DEG;
    }

    const clampedAngle = clamp(unwrapped, DIAL_START_DEG, DIAL_END_DEG);
    return clamp(((clampedAngle - DIAL_START_DEG) / DIAL_SWEEP_DEG) * 100, 0, 100);
  }

  function commitDialVolume(value, final = false) {
    if (!dom.dial || dom.dial.getAttribute('aria-disabled') === 'true') return;
    const normalized = clamp(value, 0, 100);
    const hapticBucket = Math.round((normalized / 100) * (DIAL_SEGMENTS - 1));
    if (hapticBucket !== state.dialHapticBucket) {
      state.dialHapticBucket = hapticBucket;
      globalThis.StartabHaptics?.pulse?.('windows-volume-dial', 6, 28);
    }
    holdOptimisticState({ volume: normalized, muted: false });
    renderDial(normalized, false);
    if (dom.range) dom.range.value = String(Math.round(normalized));
    if (dom.value) dom.value.textContent = `${Math.round(normalized)}%`;
    if (dom.mute) {
      dom.mute.classList.remove('is-muted');
      dom.mute.setAttribute('aria-pressed', 'false');
    }
    setFill(normalized);

    if (final) {
      clearTimeout(state.commandTimer);
      state.pendingVolume = null;
      void sendCommand('setVolume', normalized).then((ok) => {
        if (!ok) { clearOptimisticState(); render(); }
      });
    } else {
      queueVolume(normalized);
    }
  }

  function updateDialFromPointer(event) {
    if (!state.dialDragging) return;
    commitDialVolume(pointerAngleToDialValue(event), false);
  }

  function finishDialPointer(event) {
    if (!state.dialDragging) return;
    state.dialDragging = false;
    dom.dial?.classList.remove('is-dragging');
    try {
      if (dom.dial?.hasPointerCapture?.(event.pointerId)) dom.dial.releasePointerCapture(event.pointerId);
    } catch (_) {}
    commitDialVolume(pointerAngleToDialValue(event), true);
  }

  function syncMobileSourcePlacement() {
    if (!dom.sourceList || !dom.mobileSourceSlot || !dom.desktopSourceAnchor) return;
    const mobile = state.mobileLayoutMql?.matches ?? window.matchMedia(MOBILE_MEDIA_QUERY).matches;
    if (mobile) {
      if (dom.sourceList.parentElement !== dom.mobileSourceSlot) dom.mobileSourceSlot.append(dom.sourceList);
    } else if (dom.sourceList.previousElementSibling !== dom.desktopSourceAnchor) {
      dom.desktopSourceAnchor.after(dom.sourceList);
    }
  }

  function setFooterExpanded(expanded) {
    if (!dom.footer || !dom.footerToggle) return;
    dom.footer.classList.toggle('is-expanded', !!expanded);
    dom.footerToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 280);
  }

  function setControlDisabled(disabled) {
    for (const element of [dom.range, dom.mute, dom.down, dom.up, dom.dialMute]) {
      if (element) element.disabled = !!disabled;
    }
    if (dom.dial) {
      dom.dial.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      dom.dial.tabIndex = disabled ? -1 : 0;
      dom.dial.classList.toggle('is-disabled', !!disabled);
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
    reconcileOptimisticState(device);
    const rawVolume = device ? clamp(device.volume, 0, 100) : 0;
    const rawMuted = !!device?.muted;
    const optimisticActive = Date.now() < state.optimisticUntil;
    const volume = optimisticActive && state.optimisticVolume != null ? state.optimisticVolume : rawVolume;
    const muted = optimisticActive && typeof state.optimisticMuted === 'boolean' ? state.optimisticMuted : rawMuted;

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

    if (dom.range && !dom.range.matches(':active')) dom.range.value = String(volume);
    if (dom.value) dom.value.textContent = `${Math.round(volume)}%`;
    setFill(volume);
    if (!state.dialDragging) renderDial(volume, muted);
    const nativeAudioActive = device?.deviceId && device.deviceId === state.native.deviceId && typeof state.native.audioActive === 'boolean'
      ? state.native.audioActive
      : null;
    renderSpectrum(online && !muted && (nativeAudioActive ?? !!device?.audioActive));

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
      if (next == null) return;
      void sendCommand('setVolume', next).then((ok) => {
        if (!ok) { clearOptimisticState(); render(); }
      });
    }, 220);
  }

  function applyNativeStatus(payload) {
    if (!payload || typeof payload !== 'object') return;
    state.native.connected = !!payload.connected;
    const nativeState = payload.state || payload;
    if (nativeState?.deviceId) state.native.deviceId = nativeState.deviceId;
    if (nativeState?.deviceName) state.native.deviceName = nativeState.deviceName;
    if (Number.isFinite(Number(nativeState?.volume))) state.native.volume = Number(nativeState.volume);
    if (typeof nativeState?.muted === 'boolean') state.native.muted = nativeState.muted;
    if (typeof nativeState?.audioActive === 'boolean') state.native.audioActive = nativeState.audioActive;
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
    dom.footerToggle?.addEventListener('click', () => {
      setFooterExpanded(!dom.footer?.classList.contains('is-expanded'));
    });

    dom.dial?.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (event.target.closest?.('button')) return;
      if (dom.dial.getAttribute('aria-disabled') === 'true') return;
      state.dialDragging = true;
      state.dialHapticBucket = null;
      globalThis.StartabHaptics?.resetTexture?.('windows-volume-dial');
      dom.dial.classList.add('is-dragging');
      try { dom.dial.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
      commitDialVolume(pointerAngleToDialValue(event), false);
    });
    dom.dial?.addEventListener('pointermove', (event) => {
      if (!state.dialDragging) return;
      event.preventDefault();
      updateDialFromPointer(event);
    });
    dom.dial?.addEventListener('pointerup', finishDialPointer);
    dom.dial?.addEventListener('pointercancel', finishDialPointer);
    dom.dial?.addEventListener('keydown', (event) => {
      if (dom.dial.getAttribute('aria-disabled') === 'true') return;
      let next = state.dialValue;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += 2;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= 2;
      else if (event.key === 'PageUp') next += 10;
      else if (event.key === 'PageDown') next -= 10;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = 100;
      else return;
      event.preventDefault();
      commitDialVolume(next, true);
    });
    dom.dialMute?.addEventListener('click', async () => {
      const nextMuted = !effectiveMuted();
      globalThis.StartabHaptics?.mute?.(nextMuted);
      holdOptimisticState({ muted: nextMuted });
      render();
      const ok = await sendCommand('toggleMute');
      if (!ok) { clearOptimisticState(); render(); }
    });

    dom.device?.addEventListener('change', () => {
      clearOptimisticState();
      state.selectedDeviceId = dom.device.value || null;
      persistSelectedDevice();
      render();
    });

    dom.range?.addEventListener('input', () => {
      const value = clamp(dom.range.value, 0, 100);
      holdOptimisticState({ volume: value, muted: false });
      if (dom.value) dom.value.textContent = `${Math.round(value)}%`;
      setFill(value);
      renderDial(value, false);
      queueVolume(value);
    });
    dom.range?.addEventListener('change', () => {
      clearTimeout(state.commandTimer);
      state.pendingVolume = null;
      const value = clamp(dom.range.value, 0, 100);
      holdOptimisticState({ volume: value, muted: false });
      void sendCommand('setVolume', value).then((ok) => {
        if (!ok) { clearOptimisticState(); render(); }
      });
    });

    dom.mute?.addEventListener('click', async () => {
      const nextMuted = !effectiveMuted();
      globalThis.StartabHaptics?.mute?.(nextMuted);
      holdOptimisticState({ muted: nextMuted });
      render();
      const ok = await sendCommand('toggleMute');
      if (!ok) { clearOptimisticState(); render(); }
    });
    const stepVolume = (delta) => {
      if (!dom.range || dom.range.disabled) return;
      const next = clamp(Number(dom.range.value) + delta, 0, 100);
      holdOptimisticState({ volume: next, muted: false });
      dom.range.value = String(next);
      if (dom.value) dom.value.textContent = `${Math.round(next)}%`;
      setFill(next);
      renderDial(next, false);
      void sendCommand('setVolume', next).then((ok) => {
        if (!ok) { clearOptimisticState(); render(); }
      });
    };
    dom.down?.addEventListener('click', () => stepVolume(-5));
    dom.up?.addEventListener('click', () => stepVolume(5));
    dom.pair?.addEventListener('click', () => void copyExtensionId());
  }

  function init() {
    cacheDom();
    if (!dom.card) return;
    buildDialSegments();
    buildSpectrumBars();
    state.mobileLayoutMql = window.matchMedia(MOBILE_MEDIA_QUERY);
    state.mobileLayoutMql.addEventListener?.('change', syncMobileSourcePlacement);
    syncMobileSourcePlacement();
    setFooterExpanded(false);
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
