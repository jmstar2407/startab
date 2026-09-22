/* StarTab v1.6.3: event-driven PC state and acknowledged commands. */
(() => {
  'use strict';
  const queues = new Map();
  const pending = new Map();
  const statuses = new Map();
  const inFlightProbes = new Map();

  function report(deviceId, status) {
    statuses.set(deviceId, status);
    window.dispatchEvent(new CustomEvent('startab-pc-command-status', { detail: { deviceId, ...status } }));
  }
  function observe(deviceId, data) {
    const result = data?.commandResult;
    if (result?.id) pending.get(`${deviceId}:${result.id}`)?.(result);
  }
  function waitForAck(deviceId, id, timeout) {
    let finish;
    const key = `${deviceId}:${id}`;
    const promise = new Promise(resolve => {
      finish = result => { clearTimeout(timer); pending.delete(key); resolve(result); };
      const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeout);
      pending.set(key, finish);
    });
    return { promise, finish };
  }
  function nativeCommand(command) {
    const native = { ...command, type: command.action };
    if (command.action === 'step') native.delta = command.value;
    return native;
  }
  async function execute({ db, user, device, action, extra = {}, native = false }) {
    if (!db || !user?.uid || !device?.deviceId) return false;
    const deviceId = device.deviceId;
    const id = crypto.randomUUID();
    const timeout = ['setRgb', 'setHotspot', 'getSystemState'].includes(action) ? 14000 : 7000;
    const command = { ...extra, id, operationId: id, action, issuedBy: user.uid,
      issuedByClient: id, clientAt: Date.now(), expiresAtClient: Date.now() + timeout };
    report(deviceId, { pending: true });
    let transport = 'Firebase';
    let result;
    try {
      // A local native connection can be used for all system actions.
      if (!native && globalThis.chrome?.runtime?.id) {
        const local = await chrome.runtime.sendMessage({ type: 'STARTAB_WINDOWS_NATIVE_GET_STATE' }).catch(() => null);
        native = !!local?.connected && local.state?.deviceId === deviceId;
      }
      if (native) {
        result = await chrome.runtime.sendMessage({ type: 'STARTAB_WINDOWS_NATIVE_COMMAND', awaitResult: true,
          command: nativeCommand(command) }).catch(() => null);
        if (result?.ok) transport = 'Directo';
      }
      if (!result?.ok) {
        const ok = await globalThis.StartabWindowsDirectAudio?.send(deviceId, command);
        if (ok) { result = { ok: true }; transport = 'Directo'; }
      }
      if (!result?.ok && Date.now() < command.expiresAtClient) {
        // Same operationId across transports; the agent deduplicates executions.
        const ack = waitForAck(deviceId, id, Math.max(100, command.expiresAtClient - Date.now()));
        try {
          const write = db.collection('users').doc(user.uid).collection('windowsDevices').doc(deviceId)
            .set({ command: { ...command, serverAt: firebase.firestore.FieldValue.serverTimestamp() } }, { merge: true });
          // Offline writes may stay queued: never wait for them without a deadline.
          Promise.resolve(write).catch(error => ack.finish({ ok: false, reason: error?.message || 'write-failed' }));
        } catch (error) { ack.finish({ ok: false, reason: error?.message || 'write-failed' }); }
        result = await ack.promise;
      }
    } catch (error) { result = { ok: false, reason: error?.message || 'connection-failed' }; }
    const ok = result?.ok === true;
    report(deviceId, { pending: false, ok, transport, reason: result?.reason || '', at: Date.now() });
    return ok;
  }
  function send(options) {
    const key = `${options.user?.uid || ''}:${options.device?.deviceId || ''}`;
    if (options.action === 'getSystemState' && inFlightProbes.has(key)) return inFlightProbes.get(key);
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => execute(options));
    queues.set(key, next);
    if (options.action === 'getSystemState') inFlightProbes.set(key, next);
    next.finally(() => {
      if (queues.get(key) === next) queues.delete(key);
      if (inFlightProbes.get(key) === next) inFlightProbes.delete(key);
    });
    return next;
  }
  globalThis.StartabWindowsCommands = {
    send, observe,
    status: id => statuses.get(id),
    label(id) {
      const status = statuses.get(id);
      if (status?.pending) return 'Esperando respuesta de la PC…';
      if (status?.ok === false) return 'La PC no respondió · puedes volver a intentar';
      if (status?.ok) return `Última respuesta recibida · ${status.transport}`;
      return 'Último estado guardado · listo para controlar';
    },
  };
})();
