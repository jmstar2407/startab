(() => {
  'use strict';

  const firebaseConfig = {
    apiKey: 'AIzaSyBU8DyN2kRcDq0fxB20qRUXWBHV0E-0d6A',
    authDomain: 'startab-44e48.firebaseapp.com',
    projectId: 'startab-44e48',
    storageBucket: 'startab-44e48.firebasestorage.app',
    messagingSenderId: '874084877753',
    appId: '1:874084877753:web:cf9cbe9a344356dc9be268',
  };

  const HEARTBEAT_MS = 25_000;
  const COMMAND_MAX_AGE_MS = 20_000;

  const state = {
    db: null,
    auth: null,
    authUser: null,
    user: null,
    nativeConnected: false,
    nativeState: null,
    deviceRef: null,
    unsubscribeDevice: null,
    heartbeat: 0,
    lastCommandId: null,
    bridgeKey: null,
    userTimer: 0,
  };

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

  function effectiveUser() {
    if (state.authUser?.uid) {
      return {
        uid: state.authUser.uid,
        email: state.authUser.email || '',
        displayName: state.authUser.displayName || '',
      };
    }
    return readSavedUser();
  }

  async function markCurrentOffline() {
    if (!state.deviceRef) return;
    try {
      await state.deviceRef.set({
        online: false,
        clientAt: Date.now(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (_) {}
  }

  function stopDeviceListener() {
    state.unsubscribeDevice?.();
    state.unsubscribeDevice = null;
    state.deviceRef = null;
    state.lastCommandId = null;
    state.bridgeKey = null;
  }

  async function syncUser() {
    const next = effectiveUser();
    const nextUid = next?.uid || null;
    if ((state.user?.uid || null) === nextUid) return;

    if (state.user?.uid && state.deviceRef) await markCurrentOffline();
    stopDeviceListener();
    state.user = next;
    await startDeviceBridge();
  }

  async function startDeviceBridge() {
    if (!state.db || !state.user?.uid || !state.nativeState?.deviceId) return;
    const deviceId = state.nativeState.deviceId;
    const nextBridgeKey = `${state.user.uid}:${deviceId}`;

    if (state.bridgeKey === nextBridgeKey && state.unsubscribeDevice) {
      await publishNativeState(false);
      return;
    }

    stopDeviceListener();
    state.bridgeKey = nextBridgeKey;
    state.deviceRef = state.db
      .collection('users')
      .doc(state.user.uid)
      .collection('windowsDevices')
      .doc(deviceId);

    await publishNativeState(true);

    state.unsubscribeDevice = state.deviceRef.onSnapshot(
      (snapshot) => {
        if (!snapshot.exists) return;
        const data = snapshot.data() || {};
        const command = data.command;
        if (!command?.id || command.id === state.lastCommandId || command.id === data.lastCommandId) return;

        const issuedAt = Number(command.clientAt) || 0;
        const expiresAt = Number(command.expiresAtClient) || (issuedAt + COMMAND_MAX_AGE_MS);
        if (!issuedAt || Date.now() > expiresAt + 2_000 || Date.now() - issuedAt > COMMAND_MAX_AGE_MS + 5_000) {
          state.lastCommandId = command.id;
          void acknowledgeCommand(command.id, false, 'expired');
          return;
        }

        state.lastCommandId = command.id;
        void executeCommand(command);
      },
      (error) => console.error('StarTab Windows bridge: listener Firestore:', error),
    );
  }

  function commandForNative(command) {
    const action = String(command?.action || '');
    if (action === 'setVolume') {
      return { type: 'setVolume', value: Math.max(0, Math.min(100, Number(command.value) || 0)) };
    }
    if (action === 'toggleMute') return { type: 'toggleMute' };
    if (action === 'setMute') return { type: 'setMute', muted: !!command.muted };
    if (action === 'step') return { type: 'step', delta: Math.max(-100, Math.min(100, Number(command.value) || 0)) };
    return null;
  }

  async function executeCommand(command) {
    const nativeCommand = commandForNative(command);
    if (!nativeCommand) {
      await acknowledgeCommand(command.id, false, 'invalid-command');
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'STARTAB_WINDOWS_NATIVE_COMMAND',
        command: nativeCommand,
      });
      await acknowledgeCommand(command.id, !!response?.ok, response?.ok ? null : response?.reason || 'native-disconnected');
    } catch (error) {
      await acknowledgeCommand(command.id, false, String(error?.message || error));
    }
  }

  async function acknowledgeCommand(commandId, ok, reason) {
    if (!state.deviceRef) return;
    try {
      await state.deviceRef.set({
        lastCommandId: commandId,
        commandResult: {
          id: commandId,
          ok: !!ok,
          reason: reason || null,
          clientAt: Date.now(),
        },
      }, { merge: true });
    } catch (error) {
      console.warn('StarTab Windows bridge: no se pudo confirmar comando:', error);
    }
  }

  async function publishNativeState(force = false) {
    if (!state.db || !state.user?.uid || !state.nativeState?.deviceId) return;
    const native = state.nativeState;
    const target = state.db
      .collection('users')
      .doc(state.user.uid)
      .collection('windowsDevices')
      .doc(native.deviceId);

    state.deviceRef = target;
    const payload = {
      deviceId: native.deviceId,
      deviceName: native.deviceName || 'PC Windows',
      platform: 'windows',
      bridge: 'nativeMessaging',
      agentVersion: native.agentVersion || '2.0.0',
      online: !!state.nativeConnected,
      clientAt: Date.now(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (Number.isFinite(Number(native.volume))) payload.volume = Math.max(0, Math.min(100, Number(native.volume)));
    if (typeof native.muted === 'boolean') payload.muted = native.muted;
    if (force) payload.connectedAt = firebase.firestore.FieldValue.serverTimestamp();

    try {
      await target.set(payload, { merge: true });
    } catch (error) {
      console.error('StarTab Windows bridge: no se pudo publicar estado:', error);
    }
  }

  async function handleNativeEvent(payload) {
    if (!payload || typeof payload !== 'object') return;

    if (payload.kind === 'disconnected') {
      state.nativeConnected = false;
      await publishNativeState(false);
      return;
    }

    if (payload.kind === 'connected') {
      state.nativeConnected = true;
      if (payload.state) state.nativeState = { ...(state.nativeState || {}), ...payload.state };
      await startDeviceBridge();
      return;
    }

    const message = payload.message || payload.state || payload;
    if (message?.type === 'hello') {
      const oldDeviceId = state.nativeState?.deviceId;
      state.nativeConnected = true;
      state.nativeState = { ...(state.nativeState || {}), ...message };
      if (oldDeviceId && oldDeviceId !== message.deviceId) stopDeviceListener();
      await startDeviceBridge();
      return;
    }

    if (message?.type === 'state') {
      state.nativeConnected = true;
      state.nativeState = { ...(state.nativeState || {}), ...message };
      await publishNativeState(false);
    }
  }

  function initFirebase() {
    try {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      state.db = firebase.firestore();
      state.auth = firebase.auth();
      state.auth.onAuthStateChanged((user) => {
        state.authUser = user || null;
        void syncUser();
      });
      void syncUser();
    } catch (error) {
      console.error('StarTab Windows bridge: Firebase init:', error);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.target !== 'startab-windows-offscreen') return;
    if (message.type === 'STARTAB_WINDOWS_NATIVE_EVENT') {
      void handleNativeEvent(message.payload);
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key === 'starTab_lastUser') void syncUser();
  });

  state.heartbeat = window.setInterval(() => {
    if (state.nativeConnected) void publishNativeState(false);
  }, HEARTBEAT_MS);

  state.userTimer = window.setInterval(() => void syncUser(), 3_000);

  initFirebase();

  try {
    chrome.runtime.sendMessage({ type: 'STARTAB_WINDOWS_NATIVE_GET_STATE' }).then((response) => {
      if (response?.connected) {
        void handleNativeEvent({ kind: 'connected', state: response.state });
      }
    }).catch(() => {});
  } catch (_) {}
})();
