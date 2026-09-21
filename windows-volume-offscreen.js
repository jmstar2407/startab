(() => {
    "use strict";
    const firebaseConfig = {
        apiKey: "AIzaSyBU8DyN2kRcDq0fxB20qRUXWBHV0E-0d6A",
        authDomain: "startab-44e48.firebaseapp.com",
        databaseURL: "https://startab-44e48-default-rtdb.firebaseio.com",
        projectId: "startab-44e48",
        storageBucket: "startab-44e48.firebasestorage.app",
        messagingSenderId: "874084877753",
        appId: "1:874084877753:web:cf9cbe9a344356dc9be268"
    };
    const PRESENCE_ACTIVE_MS = 3e3;
    const PRESENCE_IDLE_MS = 45e3;
    const PRESENCE_SCHEDULER_MS = 500;
    const COMMAND_MAX_AGE_MS = 2e4;
    const state = {
        db: null,
        auth: null,
        authUser: null,
        user: null,
        nativeConnected: false,
        nativeState: null,
        deviceRef: null,
        unsubscribeDevice: null,
        unsubscribePointerSessions: null,
        pointerPeers: new Map,
        heartbeat: 0,
        lastCommandId: null,
        bridgeKey: null,
        userTimer: 0,
        standaloneCloudOnline: false,
        presenceRef: null,
        presenceOnDisconnect: null,
        presenceWatchersRef: null,
        presenceWatchersHandler: null,
        observerActiveUntil: 0,
        lastPresenceHeartbeatAt: 0
    };
    function readSavedUser() {
        try {
            const raw = localStorage.getItem("starTab_lastUser");
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
                email: state.authUser.email || "",
                displayName: state.authUser.displayName || ""
            };
        }
        return readSavedUser();
    }
    function stopPresenceWatcherObserver() {
        try {
            if (state.presenceWatchersRef && state.presenceWatchersHandler) {
                state.presenceWatchersRef.off("value", state.presenceWatchersHandler);
            }
        } catch (_) {}
        state.presenceWatchersRef = null;
        state.presenceWatchersHandler = null;
        state.observerActiveUntil = 0;
    }
    function startPresenceWatcherObserver() {
        stopPresenceWatcherObserver();
        if (!state.user?.uid || !state.nativeState?.deviceId || typeof firebase.database !== "function") return;
        try {
            const ref = firebase.database().ref(`startab/v2/users/${state.user.uid}/devices/${state.nativeState.deviceId}/watchers`);
            const handler = snap => {
                const raw = snap.val() || {};
                const now = Date.now();
                let activeUntil = 0;
                Object.values(raw).forEach(watcher => {
                    if (!watcher || watcher.active !== true) return;
                    const expires = Number(watcher.expiresAtClient || 0);
                    if (expires > now) activeUntil = Math.max(activeUntil, expires + 2e3);
                });
                const wasActive = state.observerActiveUntil > now;
                state.observerActiveUntil = activeUntil;
                if (!wasActive && activeUntil > now) {
                    state.lastPresenceHeartbeatAt = Date.now();
                    void publishPresenceHeartbeat();
                }
            };
            state.presenceWatchersRef = ref;
            state.presenceWatchersHandler = handler;
            ref.on("value", handler, () => {});
        } catch (_) {}
    }
    function adaptivePresenceDelay() {
        return Date.now() < state.observerActiveUntil ? PRESENCE_ACTIVE_MS : PRESENCE_IDLE_MS;
    }
    async function publishRealtimePresence(online = true) {
        if (!online && nativeSupportsStandaloneCloud()) return false;
        if (!state.user?.uid || !state.nativeState?.deviceId || state.standaloneCloudOnline) return false;
        try {
            if (typeof firebase.database !== "function") return false;
            const ref = firebase.database().ref(`startab/v2/users/${state.user.uid}/devices/${state.nativeState.deviceId}/connection`);
            state.presenceRef = ref;
            const payload = {
                state: online ? "online" : "offline",
                standby: false,
                platform: "windows",
                transport: "extension-offscreen",
                clientAt: Date.now(),
                lastSeen: firebase.database.ServerValue.TIMESTAMP,
                deviceName: state.nativeState.deviceName || "PC Windows",
                agentVersion: state.nativeState.agentVersion || "2.0.0"
            };
            await ref.update(payload);
            try {
                if (nativeSupportsStandaloneCloud()) { await ref.onDisconnect().cancel(); return true; }
                const od = ref.onDisconnect();
                state.presenceOnDisconnect = od;
                await od.update({
                    state: "offline",
                    clientAt: Date.now(),
                    lastSeen: firebase.database.ServerValue.TIMESTAMP
                });
            } catch (_) {}
            return true;
        } catch (_) {
            return false;
        }
    }
    async function publishPresenceHeartbeat() {
        if (!state.nativeConnected || state.standaloneCloudOnline) return;
        const realtimeOk = await publishRealtimePresence(true);
        return realtimeOk;
    }
    async function markCurrentOffline() {
        if (state.standaloneCloudOnline || nativeSupportsStandaloneCloud()) return;
        if (!state.standaloneCloudOnline) {
            try {
                await publishRealtimePresence(false);
            } catch (_) {}
        }

    }
    function stopDeviceListener() {
        stopPresenceWatcherObserver();
        state.unsubscribeDevice?.();
        state.unsubscribeDevice = null;
        stopPointerSessionBridge();
        state.deviceRef = null;
        state.lastCommandId = null;
        state.bridgeKey = null;
        state.standaloneCloudOnline = false;
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
    function standaloneCloudActive(data) {
        const at = Number(data?.clientAt) || 0;
        return data?.standalone === true && data?.cloudLinked === true && data?.online === true && at > 0 && Date.now() - at < 7e4;
    }
    function nativeSupportsStandaloneCloud(native = state.nativeState) {
        const match = /^(\d+)\.(\d+)/.exec(String(native?.agentVersion || "").trim());
        if (!match) return false;
        const major = Number(match[1]) || 0;
        const minor = Number(match[2]) || 0;
        return major > 2 || major === 2 && minor >= 8;
    }
    async function startDeviceBridge() {
        if (!state.user?.uid || !state.nativeState?.deviceId) return;
        const deviceId = state.nativeState.deviceId;
        const nextBridgeKey = `${state.user.uid}:${deviceId}`;
        if (state.bridgeKey === nextBridgeKey) { await publishNativeState(false); return; }
        stopDeviceListener();
        state.bridgeKey = nextBridgeKey;
        // v1.7.6: Windows ya no escucha comandos ni touchpad desde Firestore.
        // El agente nativo consume devices/{deviceId}/commands directamente desde RTDB.
        state.deviceRef = null;
        // Limpieza única de campos vivos heredados. Firestore conserva solo registro/metadatos.
        if (state.db) {
            try {
                const legacy = state.db.collection("users").doc(state.user.uid).collection("windowsDevices").doc(deviceId);
                const del = firebase.firestore.FieldValue.delete();
                await legacy.set({
                    online:del, clientAt:del, updatedAt:del, connectedAt:del, connectedAtClient:del,
                    volume:del, muted:del, audioActive:del, hotspotState:del, hotspotClients:del, hotspotMessage:del,
                    rgbControl:del, rgbAvailable:del, rgbState:del, rgbColor:del, rgbTransport:del, rgbMessage:del,
                    presenceMode:del, lastCommandId:del, commandResult:del, command:del
                }, {merge:true});
            } catch (_) {}
        }
        await publishNativeState(true);
        state.lastPresenceHeartbeatAt = Date.now();
        void publishRealtimePresence(true);
        startPresenceWatcherObserver();
    }
    function waitForIceGathering(pc, timeoutMs = 3200) {
        if (!pc || pc.iceGatheringState === "complete") return Promise.resolve();
        return new Promise(resolve => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                pc.removeEventListener("icegatheringstatechange", onState);
                resolve();
            };
            const onState = () => {
                if (pc.iceGatheringState === "complete") finish();
            };
            const timer = setTimeout(finish, timeoutMs);
            pc.addEventListener("icegatheringstatechange", onState);
        });
    }
    async function sendPointerNative(command) {
        if (!state.nativeConnected || !command) return false;
        try {
            const response = await chrome.runtime.sendMessage({
                type: "STARTAB_WINDOWS_NATIVE_COMMAND",
                command: command
            });
            return !!response?.ok;
        } catch (_) {
            return false;
        }
    }
    function closePointerPeer(sessionId) {
        const entry = state.pointerPeers.get(sessionId);
        if (!entry) return;
        entry.closed = true;
        if (entry.leftDown) {
            entry.leftDown = false;
            void sendPointerNative({
                type: "pointerButton",
                button: "left",
                down: false
            });
        }
        try {
            entry.pc?.close();
        } catch (_) {}
        state.pointerPeers.delete(sessionId);
    }
    function stopPointerSessionBridge() {
        state.unsubscribePointerSessions?.();
        state.unsubscribePointerSessions = null;
        for (const sessionId of [ ...state.pointerPeers.keys() ]) closePointerPeer(sessionId);
    }
    function handlePointerPayload(payload, entry) {
        if (!payload || typeof payload !== "object") return;
        if (payload.t === "lease") {
            void sendPointerNative({
                type: "pointerLease"
            });
            return;
        }
        if (payload.t === "ping") {
            try {
                entry.controlChannel?.send(JSON.stringify({
                    t: "pong"
                }));
            } catch (_) {}
            return;
        }
        if (payload.t === "mediaCommand" && payload.envelope?.id) {
            const current = entry.controlChannel;
            void globalThis.StarTabMediaBridge?.receive(payload.envelope).then(result => {
                if (result) current?.send(JSON.stringify({t:'commandAck',...result}));
            }).catch(()=>{});
            return;
        }
        if (payload.t === "command" && payload.envelope?.id) {
            const envelope = payload.envelope;
            const current = entry.controlChannel;
            entry.commandChain = (entry.commandChain || Promise.resolve()).catch(() => {}).then(async () => {
                const result = await chrome.runtime.sendMessage({
                    type: "STARTAB_WINDOWS_NATIVE_COMMAND",
                    command: {
                        type: "remoteCommand",
                        envelope: envelope
                    }
                });
                if (result?.reason === "native-timeout" || result?.reason === "native-disconnected") return;
                try {
                    current?.send(JSON.stringify({
                        t: "commandAck",
                        id: envelope.id,
                        ok: result?.ok === true,
                        reason: result?.reason || ""
                    }));
                } catch (_) {}
            }).catch(() => {});
            return;
        }
        if (payload.t === "move") {
            const dx = Math.max(-500, Math.min(500, Number(payload.dx) || 0));
            const dy = Math.max(-500, Math.min(500, Number(payload.dy) || 0));
            if (dx || dy) void sendPointerNative({
                type: "pointerMove",
                dx: dx,
                dy: dy
            });
            return;
        }
        if (payload.t === "scroll") {
            const delta = Math.max(-1440, Math.min(1440, Number(payload.delta) || 0));
            if (delta) void sendPointerNative({
                type: "pointerWheel",
                delta: delta
            });
            return;
        }
        if (payload.t === "click" && (payload.button === "left" || payload.button === "right")) {
            void sendPointerNative({
                type: "pointerClick",
                button: payload.button
            });
            return;
        }
        if (payload.t === "button" && (payload.button === "left" || payload.button === "right")) {
            const down = !!payload.down;
            if (entry && payload.button === "left") entry.leftDown = down;
            void sendPointerNative({
                type: "pointerButton",
                button: payload.button,
                down: down
            });
            return;
        }
        if (payload.t === "text") {
            const text = String(payload.text || "").slice(0, 2048);
            if (text) void sendPointerNative({
                type: "textInput",
                text: text
            });
            return;
        }
        if (payload.t === "key") {
            const key = String(payload.key || "").toLowerCase();
            if ([ "backspace", "delete", "enter", "tab" ].includes(key)) void sendPointerNative({
                type: "keyInput",
                key: key
            });
        }
    }
    function attachPointerDataChannel(channel, entry) {
        if (!channel) return;
        if (channel.label === "control") entry.controlChannel = channel;
        channel.addEventListener("message", event => {
            try {
                handlePointerPayload(JSON.parse(String(event.data || "")), entry);
            } catch (_) {}
        });
        channel.addEventListener("close", () => {
            if (channel.label === "control" && entry?.leftDown) {
                entry.leftDown = false;
                void sendPointerNative({
                    type: "pointerButton",
                    button: "left",
                    down: false
                });
            }
        });
    }
    async function answerPointerOffer(sessionId, ref, data, entry) {
        if (!globalThis.RTCPeerConnection || !data?.offer?.sdp || !data?.offer?.type) return;
        const pc = new RTCPeerConnection({
            iceServers: [ {
                urls: "stun:stun.l.google.com:19302"
            }, {
                urls: "stun:stun1.l.google.com:19302"
            } ]
        });
        entry.pc = pc;
        pc.addEventListener("datachannel", event => attachPointerDataChannel(event.channel, entry));
        pc.addEventListener("connectionstatechange", () => {
            const status = pc.connectionState;
            if (![ "connected", "failed", "disconnected", "closed" ].includes(status)) return;
            if (entry.leftDown && [ "failed", "disconnected", "closed" ].includes(status)) {
                entry.leftDown = false;
                void sendPointerNative({
                    type: "pointerButton",
                    button: "left",
                    down: false
                });
            }
            ref.set({
                pcConnectionState: status,
                pcAtClient: Date.now()
            }, {
                merge: true
            }).catch(() => {});
        });
        try {
            await pc.setRemoteDescription(data.offer);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await waitForIceGathering(pc);
            if (state.pointerPeers.get(sessionId) !== entry || entry.closed) {
                try {
                    pc.close();
                } catch (_) {}
                return;
            }
            if (!pc.localDescription) throw new Error("WebRTC answer vacía");
            await ref.set({
                answer: {
                    type: pc.localDescription.type,
                    sdp: pc.localDescription.sdp
                },
                status: "answered",
                answeredAtClient: Date.now()
            }, {
                merge: true
            });
        } catch (error) {
            console.warn("StarTab Windows Touchpad: WebRTC answer:", error);
            try {
                pc.close();
            } catch (_) {}
            entry.pc = null;
            if (state.pointerPeers.get(sessionId) === entry && !entry.closed) {
                ref.set({
                    status: "relay",
                    pcConnectionState: "failed",
                    pcAtClient: Date.now()
                }, {
                    merge: true
                }).catch(() => {});
            }
        }
    }
    function handlePointerRelay(data, entry) {
        const motion = data?.motionRelay;
        const motionSeq = Number(motion?.seq) || 0;
        if (motionSeq && motionSeq !== entry.lastMotionSeq) {
            entry.lastMotionSeq = motionSeq;
            const dx = Math.max(-1200, Math.min(1200, Number(motion.dx) || 0));
            const dy = Math.max(-1200, Math.min(1200, Number(motion.dy) || 0));
            if (dx || dy) void sendPointerNative({
                type: "pointerMove",
                dx: dx,
                dy: dy
            });
        }
        const scroll = data?.scrollRelay;
        const scrollSeq = Number(scroll?.seq) || 0;
        if (scrollSeq && scrollSeq !== entry.lastScrollSeq) {
            entry.lastScrollSeq = scrollSeq;
            const delta = Math.max(-2400, Math.min(2400, Number(scroll.delta) || 0));
            if (delta) void sendPointerNative({
                type: "pointerWheel",
                delta: delta
            });
        }
        const click = data?.clickRelay;
        const clickSeq = Number(click?.seq) || 0;
        if (clickSeq && clickSeq !== entry.lastClickSeq && (click.button === "left" || click.button === "right")) {
            entry.lastClickSeq = clickSeq;
            void sendPointerNative({
                type: "pointerClick",
                button: click.button
            });
        }
        const button = data?.buttonRelay;
        const buttonSeq = Number(button?.seq) || 0;
        if (buttonSeq && buttonSeq !== entry.lastButtonSeq && (button.button === "left" || button.button === "right")) {
            entry.lastButtonSeq = buttonSeq;
            const down = !!button.down;
            if (button.button === "left") entry.leftDown = down;
            void sendPointerNative({
                type: "pointerButton",
                button: button.button,
                down: down
            });
        }
        const keyboardOps = Array.isArray(data?.keyboardRelay?.ops) ? data.keyboardRelay.ops : [];
        const pendingKeyboardOps = keyboardOps.filter(operation => Number(operation?.seq) > entry.lastKeyboardSeq).sort((a, b) => Number(a.seq) - Number(b.seq));
        for (const operation of pendingKeyboardOps) {
            const seq = Number(operation.seq) || 0;
            if (!seq) continue;
            entry.lastKeyboardSeq = Math.max(entry.lastKeyboardSeq, seq);
            if (operation.kind === "text") {
                const text = String(operation.text || "").slice(0, 2048);
                if (text) void sendPointerNative({
                    type: "textInput",
                    text: text
                });
            } else if (operation.kind === "key") {
                const key = String(operation.key || "").toLowerCase();
                if ([ "backspace", "delete", "enter", "tab" ].includes(key)) void sendPointerNative({
                    type: "keyInput",
                    key: key
                });
            }
        }
    }
    function handlePointerSessionSnapshot(doc) {
        const sessionId = doc.id;
        const data = doc.data() || {};
        const expiresAt = Number(data.expiresAtClient) || 0;
        if (expiresAt && Date.now() > expiresAt + 5e3) {
            closePointerPeer(sessionId);
            doc.ref.delete().catch(() => {});
            return;
        }
        let entry = state.pointerPeers.get(sessionId);
        if (!entry) {
            entry = {
                pc: null,
                offerId: null,
                lastMotionSeq: 0,
                lastScrollSeq: 0,
                lastClickSeq: 0,
                lastButtonSeq: 0,
                lastKeyboardSeq: 0,
                leftDown: false,
                closed: false
            };
            state.pointerPeers.set(sessionId, entry);
        }
        if (!nativeSupportsStandaloneCloud() && !state.standaloneCloudOnline) handlePointerRelay(data, entry);
        const offerId = String(data.offerId || "");
        if (!offerId || !data.offer?.sdp || offerId === entry.offerId) return;
        entry.offerId = offerId;
        if (entry.pc) {
            try {
                entry.pc.close();
            } catch (_) {}
            entry.pc = null;
        }
        void answerPointerOffer(sessionId, doc.ref, data, entry);
    }
    function startPointerSessionBridge() {
        stopPointerSessionBridge();
        if (!state.deviceRef || !state.nativeConnected) return;
        state.unsubscribePointerSessions = state.deviceRef.collection("pointerSessions").onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === "removed") closePointerPeer(change.doc.id); else handlePointerSessionSnapshot(change.doc);
            });
        }, error => console.error("StarTab Windows Touchpad: listener Firestore:", error));
    }
    function commandForNative(command) {
        const action = String(command?.action || "");
        if (action === "setVolume") {
            return {
                type: "setVolume",
                value: Math.max(0, Math.min(100, Number(command.value) || 0))
            };
        }
        if (action === "toggleMute") return {
            type: "toggleMute"
        };
        if (action === "setMute") return {
            type: "setMute",
            muted: !!command.muted
        };
        if (action === "step") return {
            type: "step",
            delta: Math.max(-100, Math.min(100, Number(command.value) || 0))
        };
        if ([ "monitorOff", "shutdown", "sleep", "restart", "logoff", "lock", "getSystemState" ].includes(action)) return {
            type: action
        };
        if (action === "setHotspot") return {
            type: "setHotspot",
            enabled: !!command.enabled
        };
        if (action === "setRgb") {
            const color = /^#[0-9a-f]{6}$/i.test(String(command.color || "")) ? String(command.color).toUpperCase() : "#FFFFFF";
            const intent = String(command.intent || "power").toLowerCase() === "color" ? "color" : "power";
            return {
                type: "setRgb",
                enabled: !!command.enabled,
                color: color,
                intent: intent
            };
        }
        return null;
    }
    async function executeCommand(command) {
        const nativeCommand = commandForNative(command);
        if (!nativeCommand) {
            await acknowledgeCommand(command.id, false, "invalid-command");
            return;
        }
        try {
            if (nativeCommand.type === "setVolume") {
                const unmuteResponse = await chrome.runtime.sendMessage({
                    type: "STARTAB_WINDOWS_NATIVE_COMMAND",
                    command: {
                        type: "setMute",
                        muted: false
                    }
                });
                if (!unmuteResponse?.ok) {
                    await acknowledgeCommand(command.id, false, unmuteResponse?.reason || "native-disconnected");
                    return;
                }
            }
            const response = await chrome.runtime.sendMessage({
                type: "STARTAB_WINDOWS_NATIVE_COMMAND",
                command: nativeCommand
            });
            await acknowledgeCommand(command.id, !!response?.ok, response?.ok ? null : response?.reason || "native-disconnected");
        } catch (error) {
            await acknowledgeCommand(command.id, false, String(error?.message || error));
        }
    }
    async function acknowledgeCommand(commandId, ok, reason) {
        // v1.7.6: ACK de Windows exclusivamente por RTDB. El agente nativo publica
        // commandAck y elimina el comando procesado; la extensión no escribe estado vivo en Firestore.
        if (!state.user?.uid || !state.nativeState?.deviceId || typeof firebase.database !== "function") return;
        try {
            const base = firebase.database().ref(`startab/v2/users/${state.user.uid}/devices/${state.nativeState.deviceId}`);
            await base.child("commandAck").set({ id: commandId, ok: !!ok, reason: reason || null, clientAt: Date.now(), updatedAt: firebase.database.ServerValue.TIMESTAMP });
        } catch (_) {}
    }
    async function publishNativeState(force = false) {
        if (!state.user?.uid || !state.nativeState?.deviceId || typeof firebase.database !== "function") return;
        const native = state.nativeState;
        try { localStorage.setItem("startab_windows_native_device_id_v1", String(native.deviceId)); } catch (_) {}
        try { if (native.deviceName) localStorage.setItem("startab_windows_native_device_name_v1", String(native.deviceName)); } catch (_) {}
        try {
            const base = firebase.database().ref(`startab/v2/users/${state.user.uid}/devices/${native.deviceId}`);
            const live = {
                power: "on",
                updatedAt: firebase.database.ServerValue.TIMESTAMP
            };
            if (Number.isFinite(Number(native.volume))) live.volume = Math.max(0, Math.min(100, Number(native.volume)));
            if (typeof native.muted === "boolean") live.muted = native.muted;
            if (typeof native.audioActive === "boolean") live.audioActive = native.audioActive;
            if (typeof native.hotspotState === "string") live.hotspotState = native.hotspotState;
            if (Number.isFinite(Number(native.hotspotClients))) live.hotspotClients = Math.max(0, Number(native.hotspotClients));
            if (typeof native.hotspotMessage === "string") live.hotspotMessage = native.hotspotMessage.slice(0, 500);
            if (typeof native.rgbControl === "boolean") live.rgbControl = native.rgbControl;
            if (typeof native.rgbAvailable === "boolean") live.rgbAvailable = native.rgbAvailable;
            if (typeof native.rgbState === "string") live.rgbState = native.rgbState;
            if (typeof native.rgbColor === "string") live.rgbColor = native.rgbColor.slice(0, 16);
            if (typeof native.rgbTransport === "string") live.rgbTransport = native.rgbTransport.slice(0, 40);
            if (typeof native.rgbMessage === "string") live.rgbMessage = native.rgbMessage.slice(0, 500);
            await base.child("state").update(live);
            if (force) await base.child("info").update({ deviceId:native.deviceId, name:native.deviceName||"PC Windows", type:"windows", platform:"windows", agentVersion:native.agentVersion||"2.0.0" });
        } catch (error) { console.warn("StarTab Windows: no se pudo publicar estado RTDB:", error); }
    }
    async function handleNativeEvent(payload) {
        if (!payload || typeof payload !== "object") return;
        if (payload.kind === "disconnected") {
            state.nativeConnected = false;
            stopPointerSessionBridge();
            if (!nativeSupportsStandaloneCloud(state.nativeState)) {
                await publishNativeState(false);
            }
            return;
        }
        if (payload.kind === "connected") {
            state.nativeConnected = true;
            if (payload.state) state.nativeState = {
                ...state.nativeState || {},
                ...payload.state
            };
            await startDeviceBridge();
            return;
        }
        const message = payload.message || payload.state || payload;
        if (message?.type === "hello") {
            const oldDeviceId = state.nativeState?.deviceId;
            state.nativeConnected = true;
            state.nativeState = {
                ...state.nativeState || {},
                ...message
            };
            if (oldDeviceId && oldDeviceId !== message.deviceId) stopDeviceListener();
            await startDeviceBridge();
            return;
        }
        if (message?.type === "state") {
            state.nativeConnected = true;
            state.nativeState = {
                ...state.nativeState || {},
                ...message
            };
            await publishNativeState(false);
            return;
        }
        if (message?.type === "systemState") {
            state.nativeConnected = true;
            state.nativeState = {
                ...state.nativeState || {},
                ...message
            };
            await publishNativeState(false);
            return;
        }
        if (message?.type === "rgbState") {
            state.nativeConnected = true;
            state.nativeState = {
                ...state.nativeState || {},
                ...message
            };
            await publishNativeState(false);
            return;
        }
        if (message?.type === "meter") {
            state.nativeConnected = true;
            const previousActive = state.nativeState?.audioActive;
            state.nativeState = {
                ...state.nativeState || {},
                ...message
            };
            if (previousActive !== message.audioActive) await publishNativeState(false);
        }
    }
    function initFirebase() {
        try {
            if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
            state.db = firebase.firestore();
            state.auth = firebase.auth();
            state.auth.onAuthStateChanged(user => {
                state.authUser = user || null;
                void syncUser();
            });
            void syncUser();
        } catch (error) {
            console.error("StarTab Windows bridge: Firebase init:", error);
        }
    }
    chrome.runtime.onMessage.addListener(message => {
        if (message?.target !== "startab-windows-offscreen") return;
        if (message.type === "STARTAB_WINDOWS_NATIVE_EVENT") {
            void handleNativeEvent(message.payload);
        }
    });
    window.addEventListener("storage", event => {
        if (event.key === "starTab_lastUser") void syncUser();
    });
    state.heartbeat = window.setInterval(() => {
        if (!state.nativeConnected) return;
        const now = Date.now();
        if (state.lastPresenceHeartbeatAt && now - state.lastPresenceHeartbeatAt < adaptivePresenceDelay()) return;
        state.lastPresenceHeartbeatAt = now;
        void publishPresenceHeartbeat();
    }, PRESENCE_SCHEDULER_MS);
    state.userTimer = window.setInterval(() => void syncUser(), 3e3);
    initFirebase();
    try {
        chrome.runtime.sendMessage({
            type: "STARTAB_WINDOWS_NATIVE_GET_STATE"
        }).then(response => {
            if (response?.connected) {
                void handleNativeEvent({
                    kind: "connected",
                    state: response.state
                });
            }
        }).catch(() => {});
    } catch (_) {}
})();

(() => {
    "use strict";
    const FIREBASE_CONFIG = {
        apiKey: "AIzaSyBU8DyN2kRcDq0fxB20qRUXWBHV0E-0d6A",
        authDomain: "startab-44e48.firebaseapp.com",
        projectId: "startab-44e48",
        storageBucket: "startab-44e48.firebasestorage.app",
        messagingSenderId: "874084877753",
        appId: "1:874084877753:web:cf9cbe9a344356dc9be268"
    };
    const NATIVE_DEVICE_KEY = "startab_windows_native_device_id_v1";
    const LAST_COMMAND_PREFIX = "startab_media_remote_last_command_v3_";
    const LEADER_LOCK = "startab-media-cloud-bridge-v3";
    const HEARTBEAT_MS = 12e3;
    const COMMAND_MAX_AGE_MS = 25e3;
    const STATE_FORCE_REFRESH_MS = 45e3;
    const media = {
        db: null,
        auth: null,
        authUser: null,
        user: null,
        uid: null,
        refs: null,
        unsubs: [],
        boundDeviceId: "",
        isLeader: false,
        sessions: [],
        publishTimer: 0,
        lastPublishedFingerprint: "",
        lastPublishedSessions: [],
        lastPublishedAt: 0,
        lastCommandId: ""
    };
    function readSavedUser() {
        try {
            const raw = localStorage.getItem("starTab_lastUser");
            if (!raw) return null;
            const value = JSON.parse(raw);
            return value?.uid ? value : null;
        } catch (_) {
            return null;
        }
    }
    function effectiveUser() {
        const user = media.authUser;
        if (user?.uid) {
            return {
                uid: user.uid,
                email: user.email || "",
                displayName: user.displayName || ""
            };
        }
        return readSavedUser();
    }
    function mediaDeviceId() {
        try {
            return String(localStorage.getItem(NATIVE_DEVICE_KEY) || "").trim();
        } catch (_) {
            return "";
        }
    }
    function mediaDeviceLabel() {
        const id = mediaDeviceId();
        try {
            const raw = localStorage.getItem("startab_windows_native_device_name_v1");
            if (raw) return raw;
        } catch (_) {}
        const ua = String(navigator.userAgent || "");
        if (/Windows/i.test(ua)) return "PC con Windows";
        if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
        if (/Linux/i.test(ua)) return "Linux";
        return id ? "Dispositivo StarTab" : "PC StarTab";
    }
    function lastCommandKey(deviceId) {
        return `${LAST_COMMAND_PREFIX}${deviceId}`;
    }
    function restoreLastCommandId(deviceId) {
        try {
            return localStorage.getItem(lastCommandKey(deviceId)) || "";
        } catch (_) {
            return "";
        }
    }
    function saveLastCommandId(deviceId, commandId) {
        media.lastCommandId = String(commandId || "");
        try {
            localStorage.setItem(lastCommandKey(deviceId), media.lastCommandId);
        } catch (_) {}
    }
    function serverTimestamp() {
        try {
            return firebase.firestore.FieldValue.serverTimestamp();
        } catch (_) {
            return null;
        }
    }
    function sessionKey(session) {
        return session?.key || `${session?.tabId ?? "x"}:${session?.frameId ?? 0}`;
    }
    function playbackScore(session) {
        let score = 0;
        if (session?.playbackState === "playing") score += 1e6;
        if (session?.playbackState === "paused") score += 3e5;
        if (Number(session?.currentTime) > .05) score += 1e5;
        if (Number(session?.frameId) === 0) score += 1e3;
        score += Number(session?.updatedAt) || 0;
        return score;
    }
    function normalizeSessions(rawSessions) {
        const byTab = new Map;
        for (const raw of Array.isArray(rawSessions) ? rawSessions : []) {
            if (!raw || !Number.isInteger(raw.tabId) || raw.nativeEligible === false) continue;
            const session = {
                ...raw,
                key: sessionKey(raw)
            };
            const current = byTab.get(session.tabId);
            if (!current || playbackScore(session) > playbackScore(current)) byTab.set(session.tabId, session);
        }
        return [ ...byTab.values() ];
    }
    function text(value, max = 4096) {
        return String(value || "").slice(0, max);
    }
    function serializeSession(session) {
        return {
            key: sessionKey(session),
            tabId: Number(session.tabId),
            frameId: Number(session.frameId) || 0,
            windowId: Number(session.windowId) || 0,
            tabTitle: text(session.tabTitle, 500),
            pageUrl: text(session.pageUrl, 4096),
            host: text(session.host, 300),
            favicon: text(session.favicon, 4096),
            title: text(session.title, 1e3),
            artist: text(session.artist, 1e3),
            album: text(session.album, 1e3),
            artwork: text(session.artwork, 8192),
            playbackState: [ "playing", "paused", "ended" ].includes(session.playbackState) ? session.playbackState : "paused",
            currentTime: Math.max(0, Number(session.currentTime) || 0),
            duration: Math.max(0, Number(session.duration) || 0),
            playbackRate: Math.max(.1, Math.min(16, Number(session.playbackRate) || 1)),
            volume: Math.max(0, Math.min(1, Number(session.volume) || 0)),
            muted: !!session.muted,
            canSeek: !!session.canSeek,
            canSeekBackward: !!session.canSeekBackward,
            canSeekForward: !!session.canSeekForward,
            canPrev: !!session.canPrev,
            canNext: !!session.canNext,
            canVolume: session.canVolume !== false,
            transportAdapter: text(session.transportAdapter, 100),
            mediaKind: session.mediaKind === "video" ? "video" : "audio",
            nativeEligible: session.nativeEligible !== false,
            controllable: session.controllable !== false,
            readyState: Number(session.readyState) || 0,
            firstSeenAt: Number(session.firstSeenAt) || Number(session.updatedAt) || Date.now(),
            updatedAt: Number(session.updatedAt) || Date.now()
        };
    }
    function stableFingerprint(sessions) {
        return JSON.stringify(sessions.map(item => [ item.key, item.tabId, item.frameId, item.title, item.artist, item.album, item.artwork, item.favicon, item.playbackState, Math.round(item.duration * 10) / 10, item.playbackRate, Math.round(item.volume * 1e3) / 1e3, item.muted, item.canSeek, item.canSeekBackward, item.canSeekForward, item.canPrev, item.canNext, item.canVolume, item.mediaKind, item.pageUrl ]));
    }
    function stateNeedsPublish(nextSessions, force = false) {
        if (force) return true;
        const fingerprint = stableFingerprint(nextSessions);
        if (fingerprint !== media.lastPublishedFingerprint) return true;
        if (!media.lastPublishedAt || media.lastPublishedSessions.length !== nextSessions.length) return true;
        if (Date.now() - media.lastPublishedAt > STATE_FORCE_REFRESH_MS) return true;
        const elapsed = Math.max(0, (Date.now() - media.lastPublishedAt) / 1e3);
        const previous = new Map(media.lastPublishedSessions.map(item => [ item.key, item ]));
        for (const current of nextSessions) {
            const old = previous.get(current.key);
            if (!old) return true;
            const expected = old.playbackState === "playing" ? Math.min(old.duration || Infinity, (Number(old.currentTime) || 0) + elapsed * (Number(old.playbackRate) || 1)) : Number(old.currentTime) || 0;
            if (Math.abs((Number(current.currentTime) || 0) - expected) > 2.25) return true;
        }
        return false;
    }
    function disconnectRefs() {
        for (const unsubscribe of media.unsubs.splice(0)) {
            try {
                unsubscribe?.();
            } catch (_) {}
        }
        media.refs = null;
        media.boundDeviceId = "";
    }
    async function syncUser(force = false) {
        const next = effectiveUser();
        const uid = next?.uid || null;
        const deviceId = mediaDeviceId();
        const unchanged = uid === media.uid && deviceId === media.boundDeviceId && !!media.refs;
        media.user = next;
        media.uid = uid;
        if (unchanged && !force) return;
        disconnectRefs();
        lastDurableStateAt = 0;
        if (!uid || !deviceId || !media.db) return;
        connectRefs(deviceId);
    }
    let mediaCommandChain = Promise.resolve();
    const mediaResults = new Map;
    function receiveEnvelope(envelope, firestore = false) {
        const owner = media.uid, device = media.boundDeviceId;
        const task = mediaCommandChain.catch(() => {}).then(async () => {
            if (!media.isLeader || owner !== media.uid || device !== media.boundDeviceId || !envelope?.id || !envelope.payload) return;
            const now = Date.now();
            let result = mediaResults.get(envelope.id);
            if (!result) {
                if (!(envelope.clientAt > 0) || envelope.clientAt > now + 5e3 || !(envelope.expiresAtClient > now) || now - envelope.clientAt > 3e4) result = {
                    ok: false,
                    reason: "expired"
                }; else result = await handleCommandData({
                    ...envelope.payload,
                    id: envelope.id,
                    clientAt: envelope.clientAt
                }) || {
                    ok: false,
                    reason: "not-executed"
                };
                mediaResults.set(envelope.id, result);
                while (mediaResults.size > 1024) mediaResults.delete(mediaResults.keys().next().value);
            }
            const ack = {
                ...result,
                id: envelope.id,
                clientAt: Date.now()
            };
            if (firestore) void (media.refs?.state?.set({
                commandResult: ack
            }, {
                merge: true
            }).catch(() => {}));
            if (typeof firebase.database === "function") {
                const base = firebase.database().ref(`startab/v2/users/${owner}/devices/media/${device}`);
                void base.child("commandAck").set(ack).catch(() => {});
                void base.child(`commands/${envelope.id}`).remove().catch(() => {});
            }
            return ack;
        }).catch(error => ({id:envelope?.id,ok:false,reason:String(error?.message || error)}));
        mediaCommandChain = task;
        return task;
    }
    globalThis.StarTabMediaBridge = Object.freeze({receive:receiveEnvelope});
    function connectRefs(deviceId) {
        if (!media.db || !media.uid || !deviceId || media.refs) return;
        const userRoot = media.db.collection("users").doc(media.uid);
        media.boundDeviceId = deviceId;
        media.lastCommandId = restoreLastCommandId(deviceId);
        const realtimeCommand = typeof firebase.database === "function" ? firebase.database().ref(`startab/v2/users/${media.uid}/mediaCommands/${deviceId}`) : null;
        media.refs = {
            state: userRoot.collection("mediaRemote").doc(`state_${deviceId}`),
            command: realtimeCommand || userRoot.collection("mediaRemote").doc(`command_${deviceId}`),
            commandRealtime: !!realtimeCommand
        };
        if (media.refs.commandRealtime) {
            const commandRef = media.refs.command;
            const handler = snapshot => {
                void handleCommandData(snapshot?.val?.() || null);
            };
            const errorHandler = error => console.warn("StarTab Media background: RTDB command listener:", error);
            commandRef.on("value", handler, errorHandler);
            media.unsubs.push(() => {
                try {
                    commandRef.off("value", handler);
                } catch (_) {}
            });
        } else {
            media.unsubs.push(media.refs.command.onSnapshot(snapshot => {
                void handleCommandSnapshot(snapshot);
            }, error => console.warn("StarTab Media background: command listener:", error)));
        }
        const fallbackRef = userRoot.collection("mediaRemote").doc(`command_${deviceId}`);
        media.unsubs.push(fallbackRef.onSnapshot(snapshot => {
            const data = snapshot.data();
            if (data?.command?.payload) receiveEnvelope(data.command, true); else if (data?.targetDeviceId) void handleCommandData(data);
        }, () => {}));
        if (typeof firebase.database === "function") {
            const queue = firebase.database().ref(`startab/v2/users/${media.uid}/devices/media/${deviceId}/commands`);
            const onCommand = snap => receiveEnvelope(snap.val());
            queue.on("child_added", onCommand, () => { setTimeout(() => { if (media.boundDeviceId === deviceId) void syncUser(true); }, 1500); });
            media.unsubs.push(() => queue.off("child_added", onCommand));
        }
        if (media.isLeader) {
            void refreshRegistry(true);
            void publishHeartbeat(true);
        }
    }
    async function refreshRegistry(forcePublish = false) {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "STARTAB_MEDIA_GET_REGISTRY"
            });
            if (response?.ok) {
                media.sessions = Array.isArray(response.sessions) ? response.sessions : [];
                if (forcePublish) await publishState(true);
            }
        } catch (_) {}
    }
    let lastDurableStateAt = 0;
    async function publishState(force = false) {
        const deviceId = media.boundDeviceId || mediaDeviceId();
        if (!media.isLeader || !media.refs?.state || !media.uid || !deviceId) return;
        const sessions = normalizeSessions(media.sessions).map(serializeSession);
        if (!stateNeedsPublish(sessions, force)) return;
        const fingerprint = stableFingerprint(sessions);
        try {
            const live = {deviceId,deviceLabel:mediaDeviceLabel(),online:true,sessions,clientAt:Date.now()};
            let liveWritten = false;
            try {
                const ref = firebase.database().ref(`startab/v2/users/${media.uid}/devices/media/${deviceId}/state`);
                liveWritten = await globalThis.StarTabTransport.deadline(ref.set(live).then(()=>true), 800, false);
            } catch (_) {}
            if (!liveWritten || Date.now()-lastDurableStateAt >= 10000) {
                const saved = await globalThis.StarTabTransport.deadline(media.refs.state.set({...live,serverAt:serverTimestamp()},{merge:true}).then(()=>true),1000,false);
                if (saved) lastDurableStateAt=Date.now();
            }
            media.lastPublishedFingerprint = fingerprint;
            media.lastPublishedSessions = sessions.map(item => ({
                ...item
            }));
            media.lastPublishedAt = Date.now();
        } catch (error) {
            console.warn("StarTab Media background: no se pudo publicar estado:", error);
        }
    }
    function schedulePublish(force = false) {
        if (!media.isLeader || !media.refs?.state) return;
        if (force) {
            clearTimeout(media.publishTimer);
            media.publishTimer = window.setTimeout(() => {
                media.publishTimer = 0;
                void publishState(true);
            }, 50);
            return;
        }
        if (media.publishTimer) return;
        media.publishTimer = window.setTimeout(() => {
            media.publishTimer = 0;
            void publishState(false);
        }, 90);
    }
    async function publishHeartbeat(forceState = false) {
        const deviceId = media.boundDeviceId || mediaDeviceId();
        if (!media.isLeader || !media.refs?.state || !deviceId) return;
        try {
            await refreshRegistry(false);
            await publishState(true);
        } catch (error) {
            console.warn("StarTab Media background: heartbeat pendiente:", error);
        }
    }
    async function handleCommandSnapshot(snapshot) {
        if (!snapshot?.exists) return;
        await handleCommandData(snapshot.data() || {});
    }
    async function handleCommandData(data) {
        const deviceId = media.boundDeviceId || mediaDeviceId();
        if (!media.isLeader || !deviceId || !data || typeof data !== "object") return;
        const id = String(data.id || "");
        if (!id) return {
            ok: false,
            reason: "invalid-id"
        };
        if (id === media.lastCommandId) return {
            ok: false,
            reason: "already-processed"
        };
        if (String(data.targetDeviceId || "") !== deviceId) return;
        const issuedAt = Number(data.clientAt) || 0;
        if (!issuedAt || Date.now() - issuedAt > COMMAND_MAX_AGE_MS + 5e3) {
            saveLastCommandId(deviceId, id);
            return;
        }
        saveLastCommandId(deviceId, id);
        const target = data.target || {};
        const command = data.command || {};
        const action = String(command.action || "");
        const tabId = Number(target.tabId);
        let outcome = {
            ok: false,
            reason: "invalid-target"
        };
        try {
            if (action === "openTab") {
                if (Number.isInteger(tabId)) {
                    outcome = await chrome.runtime.sendMessage({
                        type: "STARTAB_MEDIA_OPEN_TAB",
                        target: {
                            tabId: tabId
                        }
                    });
                }
            } else if (action === "closeTab") {
                if (Number.isInteger(tabId)) {
                    outcome = await chrome.runtime.sendMessage({
                        type: "STARTAB_MEDIA_CLOSE_TAB",
                        target: {
                            tabId: tabId
                        }
                    });
                }
            } else {
                outcome = await chrome.runtime.sendMessage({
                    type: "STARTAB_MEDIA_CONTROL",
                    target: {
                        tabId: tabId,
                        frameId: Number(target.frameId) || 0
                    },
                    command: {
                        action: action,
                        value: command.value
                    }
                });
            }
        } catch (error) {
            outcome = {
                ok: false,
                reason: String(error?.message || error)
            };
            console.warn("StarTab Media background: no se pudo ejecutar el comando remoto:", action, error);
        }
        void refreshRegistry(false).then(() => schedulePublish(true));
        return {
            ok: outcome?.ok === true,
            reason: outcome?.reason || ""
        };
    }
    function startLeaderLock() {
        if (!navigator.locks?.request) {
            media.isLeader = true;
            void syncUser().then(() => refreshRegistry(true));
            return;
        }
        navigator.locks.request(LEADER_LOCK, {
            mode: "exclusive"
        }, async () => {
            media.isLeader = true;
            await syncUser();
            await refreshRegistry(true);
            await publishHeartbeat(true);
            await new Promise(() => {});
        }).catch(error => {
            console.warn("StarTab Media background: no se pudo adquirir liderazgo:", error);
        });
    }
    function initFirebase() {
        try {
            if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
            media.db = firebase.firestore();
            media.auth = firebase.auth();
            media.auth.onAuthStateChanged(user => {
                media.authUser = user || null;
                void syncUser();
            });
            void syncUser();
        } catch (error) {
            console.error("StarTab Media background: Firebase init:", error);
        }
    }
    chrome.runtime.onMessage.addListener(message => {
        if (message?.type === "STARTAB_MEDIA_REGISTRY_UPDATE") {
            media.sessions = Array.isArray(message.sessions) ? message.sessions : [];
            schedulePublish(false);
        }
        if (message?.type === "STARTAB_WINDOWS_NATIVE_STATUS") {
            const nativeId = String(message?.state?.deviceId || message?.deviceId || "").trim();
            if (nativeId) {
                try {
                    localStorage.setItem(NATIVE_DEVICE_KEY, nativeId);
                } catch (_) {}
                const nativeName = String(message?.state?.deviceName || message?.deviceName || "").trim();
                if (nativeName) {
                    try {
                        localStorage.setItem("startab_windows_native_device_name_v1", nativeName);
                    } catch (_) {}
                }
                void syncUser();
            }
        }
    });
    window.addEventListener("storage", event => {
        if (event.key === "starTab_lastUser" || event.key === NATIVE_DEVICE_KEY) void syncUser();
    });
    window.addEventListener("online", () => {
        void syncUser(true).then(() => publishHeartbeat(true));
    });
    window.setInterval(() => {
        void syncUser();
        if (media.isLeader && media.refs?.state) void publishHeartbeat(false);
    }, HEARTBEAT_MS);
    initFirebase();
    startLeaderLock();
    void refreshRegistry(false);
})();

(() => {
    "use strict";
    const pending = [];
    const MAX_PENDING = 80;
    let db = null;
    let auth = null;
    let currentUser = null;
    let authResolved = false;
    let writeChain = Promise.resolve();
    function readSavedUser() {
        try {
            const raw = localStorage.getItem("starTab_lastUser");
            if (!raw) return null;
            const user = JSON.parse(raw);
            return user?.uid ? user : null;
        } catch (_) {
            return null;
        }
    }
    function refreshIdentity(authUser = null) {
        currentUser = authUser || readSavedUser() || null;
        return currentUser;
    }
    function sanitizeEntry(raw) {
        if (!raw || typeof raw !== "object") return null;
        const url = String(raw.url || "").slice(0, 8192);
        if (!/^https?:\/\//i.test(url)) return null;
        const clientAt = Number(raw.clientAt) || Date.now();
        return {
            id: String(raw.id || `${clientAt}_${Math.random().toString(36).slice(2)}`).slice(0, 180),
            type: raw.type === "search" ? "search" : "visit",
            url: url,
            domain: String(raw.domain || "").slice(0, 500),
            title: String(raw.title || "").slice(0, 1e3),
            favicon: String(raw.favicon || "").slice(0, 8192),
            searchQuery: String(raw.searchQuery || "").slice(0, 500),
            searchEngine: String(raw.searchEngine || "").slice(0, 80),
            searchCategory: String(raw.searchCategory || "").slice(0, 80),
            clientAt: clientAt,
            localIso: String(raw.localIso || new Date(clientAt).toISOString()).slice(0, 80),
            tabId: Number.isInteger(raw.tabId) ? raw.tabId : null,
            windowId: Number.isInteger(raw.windowId) ? raw.windowId : null,
            incognito: raw.incognito === true,
            transitionType: String(raw.transitionType || "").slice(0, 80),
            transitionQualifiers: Array.isArray(raw.transitionQualifiers) ? raw.transitionQualifiers.map(value => String(value).slice(0, 80)).slice(0, 10) : [],
            source: String(raw.source || "navigation").slice(0, 80)
        };
    }
    async function writeEntry(entry) {
        if (!db || !currentUser || !entry) return false;
        const ref = db.collection("users").doc(currentUser.uid).collection("history").doc(entry.id);
        await ref.set({
            ...entry,
            visitedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, {
            merge: true
        });
        return true;
    }
    function enqueueWrite(entry) {
        writeChain = writeChain.catch(() => {}).then(async () => {
            try {
                await writeEntry(entry);
            } catch (error) {
                console.warn("StarTab History: no se pudo guardar una entrada en Firestore:", error);
            }
        });
    }
    function flushPending() {
        if (!currentUser) {
            pending.length = 0;
            return;
        }
        const batch = pending.splice(0, pending.length);
        batch.forEach(enqueueWrite);
    }
    function receiveEntry(raw) {
        const entry = sanitizeEntry(raw);
        if (!entry) return;
        if (!currentUser) refreshIdentity(auth?.currentUser || null);
        if (!authResolved && !currentUser) {
            pending.push(entry);
            if (pending.length > MAX_PENDING) pending.shift();
            return;
        }
        if (!currentUser) return;
        enqueueWrite(entry);
    }
    function init() {
        try {
            if (typeof firebase === "undefined" || !firebase.apps?.length) return;
            db = firebase.firestore();
            auth = firebase.auth();
            refreshIdentity(auth.currentUser || null);
            auth.onAuthStateChanged(user => {
                refreshIdentity(user || null);
                authResolved = true;
                flushPending();
            });
        } catch (error) {
            console.warn("StarTab History: Firebase no está disponible en offscreen:", error);
        }
    }
    chrome.runtime.onMessage.addListener(message => {
        if (message?.target !== "startab-history-offscreen") return;
        if (message.type === "STARTAB_HISTORY_EVENT") receiveEntry(message.payload);
    });
    window.addEventListener("storage", event => {
        if (event.key !== "starTab_lastUser") return;
        refreshIdentity(auth?.currentUser || null);
        if (currentUser) flushPending();
    });
    window.setInterval(() => {
        refreshIdentity(auth?.currentUser || null);
    }, 3e3);
    init();
})();