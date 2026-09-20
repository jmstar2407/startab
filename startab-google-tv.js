(() => {
  'use strict';

  const SELECTED_KEY = 'startab_google_tv_selected_v1';
  const PAIRINGS_KEY = 'startab_google_tv_pairings_v1';
  const QUICK_APPS_KEY = 'startab_google_tv_quick_apps_v1';
  const DEVICE_STALE_MS = 390_000;
  const FIREBASE_MOTION_MS = 95;
  const CONTROL_LOCAL_HOLD_MS = 2400;
  const NAV_REPEAT_SLOW_MS = 700;
  const NAV_REPEAT_FAST_MS = 300;
  const LAN_HEALTH_PING_MS = 2_000;
  const LAN_HEALTH_REPLY_TIMEOUT_MS = 700;
  const LAN_UNRESPONSIVE_FAILURES = 2;
  const LAN_OFFLINE_FAILURES = 3;
  const state = {
    db: null, auth: null, user: null, devices: new Map(), unsubscribe: null,
    selectedId: '', ws: null, wsReady: false, wsConnecting: false,
    motionDx: 0, motionDy: 0, motionTimer: 0, scrollDy: 0, scrollTimer: 0,
    volumeTimer: 0, pendingVolume: null, optimisticVolume: null, lastVolumeInputAt: 0, lastVolumeFirebaseAt: 0, volumeHoldUntil: 0,
    brightnessTimer: 0, pendingBrightness: null, optimisticBrightness: null, lastBrightnessInputAt: 0, lastBrightnessFirebaseAt: 0, brightnessHoldUntil: 0,
    muted: false, powerOn: null,
    pointerId: null, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false, downAt: 0,
    longPressTimer: 0, longPressSent: false, navDirection: '', navStrength: 0, navRepeatTimer: 0, navLastSentAt: 0,
    navRaf: 0, navVisualX: 0, navVisualY: 0, navVisualStrength: 0, navTargetX: 0, navTargetY: 0, navTargetStrength: 0,
    editingAppPackage: '', editingBackground: '', contextAppPackage: '', appEditHoldTimer: 0,
    cameraStream: null, scannerActive: false, scanTimer: 0, scanBusy: false, barcodeDetector: null,
    availableApps: [], appSearch: '', wsKeepAlive: 0, firebaseSessionTimer: 0, modalOpen: false, keyboardBuffer: '', keyboardTimer: 0,
    unsubscribePresence: null, realtimeCommandOk: null,
    lanHealth: '', lanFailures: 0, lanLastAliveAt: 0, lanTrackedDeviceId: '', preconnectTimer: 0,
  };
  const dom = {};
  const $ = id => document.getElementById(id);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, Number(n) || 0));
  const uid = () => state.auth?.currentUser?.uid || readUser()?.uid || '';
  const unique = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function readUser() { try { return JSON.parse(localStorage.getItem('starTab_lastUser') || 'null'); } catch (_) { return null; } }
  function readPairings() { try { return JSON.parse(localStorage.getItem(PAIRINGS_KEY) || '{}') || {}; } catch (_) { return {}; } }
  function savePairing(deviceId, data) { const p = readPairings(); p[deviceId] = { ...(p[deviceId] || {}), ...data }; localStorage.setItem(PAIRINGS_KEY, JSON.stringify(p)); }
  function pairingFor(id) { return readPairings()[id] || null; }
  function readQuickApps(deviceId = state.selectedId) {
    try {
      const all = JSON.parse(localStorage.getItem(QUICK_APPS_KEY) || '{}') || {};
      const saved = Array.isArray(all[deviceId]) ? all[deviceId] : null;
      return saved || [
        { name:'YouTube', packageName:'com.google.android.youtube.tv' },
        { name:'Netflix', packageName:'com.netflix.ninja' }
      ];
    } catch (_) { return [{name:'YouTube',packageName:'com.google.android.youtube.tv'},{name:'Netflix',packageName:'com.netflix.ninja'}]; }
  }
  function saveQuickApps(apps, deviceId = state.selectedId) {
    if (!deviceId) return;
    let all = {}; try { all = JSON.parse(localStorage.getItem(QUICK_APPS_KEY) || '{}') || {}; } catch (_) {}
    all[deviceId] = apps.slice(0, 12).map(a => ({
      name:String(a.name||a.packageName||'App'),
      packageName:String(a.packageName||''),
      background: typeof a.background === 'string' ? a.background : ''
    })).filter(a => a.packageName);
    localStorage.setItem(QUICK_APPS_KEY, JSON.stringify(all));
  }

  const ICONS = {
    remote: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="3"></rect><circle cx="12" cy="7" r="1.4"></circle><path d="M9.6 12h4.8M12 9.6v4.8"></path><path d="M9.5 17h.01M14.5 17h.01"></path></svg>',
    power: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v10"></path><path d="M6.3 5.7a8 8 0 1 0 11.4 0"></path></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1.03-1.56V3h4v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.56 1.03H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"></path></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6-6 6 6 6"></path><path d="M3 12h10a7 7 0 0 1 7 7"></path></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8"></path><path d="M5 10v10h14V10"></path><path d="M9 20v-6h6v6"></path></svg>',
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"></path></svg>',
    assistant: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3"></circle><circle cx="16.5" cy="7.5" r="2.2"></circle><circle cx="15.5" cy="16" r="3.2"></circle><circle cx="7" cy="16.5" r="1.7"></circle></svg>',
    input: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M8 12h8m-3-3 3 3-3 3"></path></svg>',
    cursor: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3 19 13l-6 1 3 6-3 1-3-6-5 4Z"></path></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19Z"></path><path class="tv-volume-wave" d="M15 9.5a4 4 0 0 1 0 5"></path><path class="tv-volume-wave" d="M17.8 6.8a8 8 0 0 1 0 10.4"></path><path class="tv-muted-mark" d="m16 9 5 5m0-5-5 5"></path></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>',
    scan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h8v6H8z"></path></svg>',
    keyboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="3"></rect><path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M7 13h.01M10 13h.01M13 13h.01M16 13h.01M8 16h8"></path></svg>'
  };

  function injectUi() {
    if ($('startab-tv-toggle')) return;
    const cursorButton = $('multimedia-cursor-toggle');
    if (cursorButton) {
      const b = document.createElement('button');
      b.id = 'startab-tv-toggle'; b.type = 'button'; b.className = 'startab-tv-toggle';
      b.title = 'Controlar Google TV'; b.setAttribute('aria-label', 'Controlar Google TV');
      b.innerHTML = '<svg aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.65" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="13" rx="2.5"></rect><path d="M8 21h8M12 18v3"></path><path d="m9 2 3 3 3-3"></path></svg>';
      cursorButton.insertAdjacentElement('afterend', b);
    }

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="startab-tv-modal" id="startab-tv-modal" aria-hidden="true">
        <div class="startab-tv-backdrop" id="startab-tv-backdrop"></div>
        <section class="startab-tv-card startab-tv-remote-shell" role="dialog" aria-modal="true" aria-label="Control remoto de Google TV">
          <header class="startab-tv-head startab-tv-head-compact">
            <div class="startab-tv-status-data" hidden aria-hidden="true">
              <i id="startab-tv-led"></i><b id="startab-tv-status-title">Sin TV</b><span id="startab-tv-status-note">Selecciona o agrega un televisor.</span>
            </div>
            <div class="startab-tv-head-actions">
              <div class="startab-tv-device-select-wrap startab-tv-device-select-head"><select id="startab-tv-device-select" aria-label="Google TV seleccionado"><option value="">Sin TVs vinculados</option></select></div>
              <button id="startab-tv-close" class="startab-tv-close" type="button" aria-label="Cerrar">×</button>
            </div>
          </header>

          <div class="startab-tv-body startab-tv-remote-body">
            <div class="startab-tv-empty" id="startab-tv-empty">
              <span>${ICONS.remote}</span><b>Agrega un Google TV</b><small>Abre el selector superior y elige “Añadir otro TV…” para vincular por QR o por IP y PIN.</small>
            </div>

            <div class="startab-tv-remote-content" id="startab-tv-remote-content">
              <form class="windows-touchpad-keyboard startab-tv-keyboard-bar is-ready" id="startab-tv-keyboard-bar" autocomplete="off">
                <label class="windows-touchpad-keyboard-shell startab-tv-keyboard-shell" for="startab-tv-keyboard-input">
                  <span class="windows-touchpad-keyboard-icon" aria-hidden="true">${ICONS.keyboard}</span>
                  <input id="startab-tv-keyboard-input" type="text" inputmode="text" enterkeyhint="enter" autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false" placeholder="Escribe en el Google TV…" aria-label="Teclado remoto de Google TV">
                  <span class="windows-touchpad-keyboard-state" id="startab-tv-keyboard-state">TECLADO TV</span>
                </label>
              </form>
              <div class="startab-tv-navigation-stage startab-tv-gesture-stage">
                <button class="startab-tv-round-action startab-tv-power" id="startab-tv-power" type="button" data-tv-control aria-label="Encender o apagar TV" title="Power">${ICONS.power}<span>Power</span></button>

                <div class="startab-tv-nav-touch" id="startab-tv-nav-touch" tabindex="0" role="application" aria-label="Control circular de navegación del Google TV" data-tv-control>
                  <div class="startab-tv-nav-touch-glow" aria-hidden="true"></div>
                  <div class="startab-tv-nav-touch-ring" aria-hidden="true"></div>
                  <div class="startab-tv-nav-touch-knob" id="startab-tv-nav-knob" aria-hidden="true"><span>OK</span></div>
                  <small class="startab-tv-nav-touch-hint" id="startab-tv-nav-hint" aria-hidden="true">desliza desde cualquier punto</small>
                  <i class="startab-tv-nav-touch-arrow is-up" aria-hidden="true"></i>
                  <i class="startab-tv-nav-touch-arrow is-right" aria-hidden="true"></i>
                  <i class="startab-tv-nav-touch-arrow is-down" aria-hidden="true"></i>
                  <i class="startab-tv-nav-touch-arrow is-left" aria-hidden="true"></i>
                </div>

                <div class="startab-tv-side-actions is-right">
                  <button class="startab-tv-round-action startab-tv-input" id="startab-tv-input" type="button" data-tv-control aria-label="Cambiar entrada o fuente" title="Input">${ICONS.input}<span>Input</span></button>
                </div>
              </div>

              <div class="startab-tv-nav-row startab-tv-nav-row-five">
                <button id="startab-tv-back" type="button" data-tv-control aria-label="Atrás" title="Atrás">${ICONS.back}</button>
                <button id="startab-tv-menu" type="button" data-tv-control aria-label="Menú" title="Menú">${ICONS.menu}</button>
                <button id="startab-tv-home" type="button" data-tv-control aria-label="Home" title="Home">${ICONS.home}</button>
                <button id="startab-tv-assistant" type="button" data-tv-control aria-label="Google Assistant" title="Google Assistant">${ICONS.assistant}</button>
                <button id="startab-tv-settings" type="button" data-tv-control aria-label="Configuración" title="Configuración">${ICONS.settings}</button>
              </div>



              <div class="startab-tv-app-row startab-tv-quick-apps" id="startab-tv-quick-apps"></div>

              <section class="startab-tv-control-card startab-tv-volume-card">
                <div class="startab-tv-control-title"><div><b>Volumen</b><span>Audio del Google TV</span></div><strong id="startab-tv-volume-value">0%</strong></div>
                <div class="startab-tv-volume-line">
                  <button class="startab-tv-mute" id="startab-tv-mute" type="button" data-tv-control aria-label="Silenciar">${ICONS.mute}</button>
                  <button class="startab-tv-step" id="startab-tv-vol-down" type="button" data-tv-control aria-label="Bajar volumen">−</button>
                  <div class="startab-tv-range-wrap"><div class="startab-tv-range-fill" id="startab-tv-volume-fill"></div><input id="startab-tv-volume" type="range" min="0" max="100" step="1" value="0" data-tv-control aria-label="Volumen del TV"></div>
                  <button class="startab-tv-step" id="startab-tv-vol-up" type="button" data-tv-control aria-label="Subir volumen">+</button>
                </div>
              </section>

              <section class="startab-tv-control-card startab-tv-brightness-card">
                <div class="startab-tv-control-title"><div><b>Brillo</b><span>10 niveles de intensidad</span></div><strong id="startab-tv-brightness-value">100%</strong></div>
                <div class="startab-tv-brightness-wrap">
                  <input id="startab-tv-brightness" type="range" min="0" max="10" step="1" value="10" data-tv-control aria-label="Brillo del TV">
                  <div class="startab-tv-brightness-ticks" aria-hidden="true">${Array.from({length:11},(_,i)=>`<i data-n="${i}"></i>`).join('')}</div>
                </div>
              </section>
            </div>
          </div>

        </section>

        <div class="startab-tv-layer startab-tv-add-layer" id="startab-tv-add-layer" aria-hidden="true">
          <div class="startab-tv-layer-backdrop"></div>
          <section class="startab-tv-submodal startab-tv-add-card" role="dialog" aria-modal="true" aria-labelledby="startab-tv-add-title">
            <header><div><span>VINCULAR DISPOSITIVO</span><h3 id="startab-tv-add-title">Agregar Google TV</h3></div><button id="startab-tv-add-close" type="button" aria-label="Cerrar">×</button></header>
            <div class="startab-tv-submodal-body">
              <button class="startab-tv-scan-primary" id="startab-tv-scan-btn" type="button">${ICONS.scan}<div><b>Escanear código QR</b><span>La forma más rápida y recomendada</span></div></button>
              <div class="startab-tv-or"><span>o vincular manualmente</span></div>
              <div class="startab-tv-manual-grid">
                <label><span>IP del TV</span><input id="startab-tv-pair-ip" inputmode="decimal" autocomplete="off" placeholder="192.168.1.50"></label>
                <label><span>PIN</span><input id="startab-tv-pair-pin" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"></label>
              </div>
              <button class="startab-tv-manual-pair" id="startab-tv-pair-btn" type="button">Vincular TV</button>
            </div>
          </section>
        </div>

        <div class="startab-tv-layer startab-tv-apps-layer" id="startab-tv-apps-layer" aria-hidden="true">
          <div class="startab-tv-layer-backdrop"></div>
          <section class="startab-tv-submodal startab-tv-apps-card" role="dialog" aria-modal="true" aria-labelledby="startab-tv-apps-title">
            <header><div><span>ACCESOS RÁPIDOS</span><h3 id="startab-tv-apps-title">Apps del Google TV</h3></div><button id="startab-tv-apps-close" type="button" aria-label="Cerrar">×</button></header>
            <div class="startab-tv-submodal-body startab-tv-apps-body">
              <label class="startab-tv-app-search"><input id="startab-tv-app-search" type="search" placeholder="Buscar app instalada…" autocomplete="off"></label>
              <div class="startab-tv-apps-list" id="startab-tv-apps-list"><div class="startab-tv-apps-loading">Buscando apps instaladas…</div></div>
            </div>
            <footer class="startab-tv-apps-footer">Toca una app para agregarla o quitarla de los accesos rápidos.</footer>
          </section>
        </div>

        <div class="startab-tv-layer startab-tv-app-edit-layer" id="startab-tv-app-edit-layer" aria-hidden="true">
          <div class="startab-tv-layer-backdrop"></div>
          <section class="startab-tv-submodal startab-tv-app-edit-card" role="dialog" aria-modal="true" aria-labelledby="startab-tv-app-edit-title">
            <header><div><span>PERSONALIZAR ACCESO</span><h3 id="startab-tv-app-edit-title">Editar acceso rápido</h3></div><button id="startab-tv-app-edit-close" type="button" aria-label="Cerrar">×</button></header>
            <div class="startab-tv-submodal-body startab-tv-app-edit-body">
              <div class="startab-tv-app-edit-preview" id="startab-tv-app-edit-preview"><span>Vista previa</span></div>
              <label class="startab-tv-app-edit-upload">
                <input id="startab-tv-app-edit-file" type="file" accept="image/*">
                <span>Subir imagen de fondo</span>
              </label>
              <small>La imagen se optimiza y se guarda como Base64. Cuando hay imagen, el botón no muestra texto.</small>
            </div>
            <footer class="startab-tv-app-edit-footer"><button id="startab-tv-app-edit-reset" type="button">Quitar imagen</button><button id="startab-tv-app-edit-save" type="button">Guardar</button></footer>
          </section>
        </div>

        <div class="startab-tv-app-context" id="startab-tv-app-context" aria-hidden="true"><button id="startab-tv-app-context-edit" type="button">Editar</button></div>

        <div class="startab-tv-scanner" id="startab-tv-scanner" aria-hidden="true">
          <div class="startab-tv-scanner-backdrop"></div>
          <section class="startab-tv-scanner-card" role="dialog" aria-modal="true" aria-labelledby="startab-tv-scanner-title">
            <header class="startab-tv-scanner-head"><div><span>EMPAREJAMIENTO</span><h3 id="startab-tv-scanner-title">Escanear código QR</h3></div><button id="startab-tv-scanner-close" type="button" aria-label="Cerrar escáner">×</button></header>
            <div class="startab-tv-scanner-body"><div class="startab-tv-camera-stage"><video id="startab-tv-scanner-video" playsinline muted></video><div class="startab-tv-camera-shade"></div><div class="startab-tv-camera-frame"><i></i><i></i><i></i><i></i></div></div><p id="startab-tv-scanner-note">Apunta la cámara al QR que aparece en StarTab TV.</p></div>
            <footer class="startab-tv-scanner-footer"><span>La cámara solo se usa mientras este escáner está abierto.</span><button id="startab-tv-scanner-cancel" type="button">Cancelar</button></footer>
          </section>
        </div>
      </div>`;
    document.body.append(...wrap.childNodes);
    cacheDom();
    bindUi();
  }

  function cacheDom() {
    const ids = [
      'toggle','modal','backdrop','close','led','status-title','status-note','device-select','empty','remote-content',
      'power','input','keyboard','back','menu','home','assistant','settings','nav-touch','nav-knob','nav-hint','quick-apps',
      'mute','volume','volume-value','volume-fill','vol-down','vol-up','brightness','brightness-value',
      'add','add-layer','add-close','scan-btn','pair-ip','pair-pin','pair-btn',
      'apps-layer','apps-close','app-search','apps-list',
      'app-edit-layer','app-edit-close','app-edit-file','app-edit-preview','app-edit-save','app-edit-reset','app-context','app-context-edit',
      'keyboard-bar','keyboard-state','keyboard-layer','keyboard-close','keyboard-input','keyboard-backspace','keyboard-enter',
      'scanner','scanner-video','scanner-note','scanner-close','scanner-cancel'
    ];
    ids.forEach(k => {
      const id = `startab-tv-${k}`;
      dom[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = $(id);
    });
  }

  function setStatus(kind, title, note) {
    if (dom.led) dom.led.dataset.state = kind;
    if (dom.statusTitle) dom.statusTitle.textContent = title;
    if (dom.statusNote) dom.statusNote.textContent = note;
  }

  function selectedDevice() { return state.devices.get(state.selectedId) || null; }
  function presenceStatus(d = selectedDevice()) {
    if (!d) return { state:'offline', online:false, source:'none' };
    const userId = uid();
    const deviceId = d.deviceId || state.selectedId;
    const useLanHealth = state.modalOpen && state.lanTrackedDeviceId === deviceId && !!state.lanHealth;
    const adaptive = globalThis.StarTabPresence?.status?.(userId, 'tv', deviceId, d, {
      localConnected: state.wsReady && deviceId === state.selectedId,
      localState: useLanHealth ? state.lanHealth : '',
      localAge: useLanHealth && state.lanLastAliveAt ? Date.now() - state.lanLastAliveAt : 0,
      aggressive: state.modalOpen && !document.hidden,
    });
    if (adaptive) return adaptive;
    const online = !!d?.online && Date.now() - Number(d.clientAt || 0) < DEVICE_STALE_MS;
    return { state: online ? (d?.powerOn === false ? 'standby' : 'online') : 'offline', online, source:'firestore' };
  }
  function isOnline(d) { return !!presenceStatus(d).online; }

  function applyRemoteState(data = {}, force = false) {
    const now = performance.now();
    if (Number.isFinite(Number(data.volume))) {
      const remoteVolume = Math.round(clamp(Number(data.volume), 0, 100));
      const matchesLocal = state.optimisticVolume != null && remoteVolume === Math.round(state.optimisticVolume);
      if (matchesLocal || state.optimisticVolume == null || now >= state.volumeHoldUntil) state.optimisticVolume = remoteVolume;
    }
    if (typeof data.muted === 'boolean') state.muted = data.muted;
    if (typeof data.powerOn === 'boolean') state.powerOn = data.powerOn;
    if (Number.isFinite(Number(data.brightnessLevel))) {
      const remoteBrightness = Math.round(clamp(Number(data.brightnessLevel), 0, 10));
      const matchesLocal = state.optimisticBrightness != null && remoteBrightness === Math.round(state.optimisticBrightness);
      if (matchesLocal || state.optimisticBrightness == null || now >= state.brightnessHoldUntil) state.optimisticBrightness = remoteBrightness;
    }
  }

  function quickApps() {
    const remote = selectedDevice()?.quickApps;
    if (Array.isArray(remote)) return remote.filter(a=>a?.packageName).map(a=>({name:String(a.name||a.packageName),packageName:String(a.packageName),background:typeof a.background==='string'?a.background:''}));
    return readQuickApps(state.selectedId);
  }
  function appMark(name = '') {
    const n = String(name).trim();
    if (/youtube/i.test(n)) return '▶';
    if (/netflix/i.test(n)) return 'N';
    return (n[0] || 'A').toUpperCase();
  }
  function quickAppsPayload(list = quickApps()) {
    return list.map(x => ({
      name:String(x.name || x.packageName || 'App'),
      packageName:String(x.packageName || ''),
      background:typeof x.background === 'string' ? x.background : ''
    })).filter(x => x.packageName);
  }

  function persistQuickApps(list) {
    const payload = quickAppsPayload(list);
    saveQuickApps(payload);
    const d = selectedDevice(); if (d) d.quickApps = payload;
    firebaseMerge({ quickApps: payload }, 12000);
    if (dom.quickApps) dom.quickApps.dataset.signature = '';
    renderQuickApps();
  }

  function closeAppContext() {
    if (!dom.appContext) return;
    dom.appContext.classList.remove('is-open');
    dom.appContext.setAttribute('aria-hidden','true');
    state.contextAppPackage = '';
  }

  function openAppContext(app, x, y) {
    if (!dom.appContext || !app?.packageName) return;
    state.contextAppPackage = app.packageName;
    dom.appContext.classList.add('is-open');
    dom.appContext.setAttribute('aria-hidden','false');
    const pad = 8, w = 132, h = 46;
    dom.appContext.style.left = `${Math.max(pad, Math.min(window.innerWidth - w - pad, x || window.innerWidth / 2))}px`;
    dom.appContext.style.top = `${Math.max(pad, Math.min(window.innerHeight - h - pad, y || window.innerHeight / 2))}px`;
  }

  function closeAppEditor() {
    dom.appEditLayer?.classList.remove('is-open');
    dom.appEditLayer?.setAttribute('aria-hidden','true');
    state.editingAppPackage = '';
    state.editingBackground = '';
    if (dom.appEditFile) dom.appEditFile.value = '';
  }

  function updateAppEditPreview() {
    if (!dom.appEditPreview) return;
    const bg = state.editingBackground || '';
    dom.appEditPreview.classList.toggle('has-image', !!bg);
    dom.appEditPreview.style.setProperty('--tv-app-bg', bg ? `url("${bg.replace(/"/g,'%22')}")` : 'none');
    dom.appEditPreview.innerHTML = bg ? '' : '<span>Vista previa</span>';
  }

  function openAppEditor(packageName) {
    closeAppContext();
    const app = quickApps().find(x => x.packageName === packageName);
    if (!app) return;
    state.editingAppPackage = packageName;
    state.editingBackground = typeof app.background === 'string' ? app.background : '';
    updateAppEditPreview();
    dom.appEditLayer?.classList.add('is-open');
    dom.appEditLayer?.setAttribute('aria-hidden','false');
  }

  async function imageFileToBase64(file) {
    if (!file || !String(file.type || '').startsWith('image/')) throw new Error('invalid-image');
    const raw = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = reject; reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const el = new Image(); el.onload = () => resolve(el); el.onerror = reject; el.src = raw;
    });
    const maxW = 420, maxH = 236;
    const scale = Math.min(1, maxW / Math.max(1,img.naturalWidth), maxH / Math.max(1,img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { alpha:false });
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    let out = canvas.toDataURL('image/jpeg', .78);
    if (out.length > 60000) {
      const small = document.createElement('canvas');
      const s = Math.min(1, 320 / canvas.width, 180 / canvas.height);
      small.width = Math.max(1, Math.round(canvas.width*s)); small.height = Math.max(1, Math.round(canvas.height*s));
      small.getContext('2d',{alpha:false}).drawImage(canvas,0,0,small.width,small.height);
      out = small.toDataURL('image/jpeg', .64);
      if (out.length > 60000) out = small.toDataURL('image/jpeg', .48);
    }
    return out;
  }

  function renderQuickApps() {
    if (!dom.quickApps) return;
    const apps = quickApps();
    const signature = `${state.selectedId}|${apps.map(a=>`${a.packageName}:${(a.background||'').length}:${String(a.background||'').slice(-16)}`).join('|')}`;
    if (dom.quickApps.dataset.signature === signature) return;
    dom.quickApps.dataset.signature = signature;
    dom.quickApps.innerHTML = '';
    apps.forEach(app => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'startab-tv-quick-app'; b.dataset.tvControl = ''; b.dataset.packageName = app.packageName;
      b.setAttribute('aria-label', app.name || 'App'); b.title = `${app.name || 'App'} · clic derecho para editar`;
      if (app.background) {
        b.classList.add('has-background');
        b.style.setProperty('--tv-app-bg', `url("${String(app.background).replace(/"/g,'%22')}")`);
        b.innerHTML = '';
      } else {
        b.innerHTML = `<span class="app-mark">${appMark(app.name)}</span><b>${escapeHtml(app.name || 'App')}</b>`;
      }
      let hold = 0, suppressLaunch = false;
      b.addEventListener('click', e => {
        if (suppressLaunch) { suppressLaunch=false; e.preventDefault(); e.stopPropagation(); return; }
        sendAction('launchApp', { packageName: app.packageName });
      });
      b.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); openAppContext(app,e.clientX,e.clientY); });
      b.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse') return;
        suppressLaunch=false; clearTimeout(hold);
        hold=setTimeout(()=>{ suppressLaunch=true; openAppContext(app,e.clientX,e.clientY); },560);
      });
      ['pointerup','pointercancel','pointerleave'].forEach(ev=>b.addEventListener(ev,()=>clearTimeout(hold)));
      dom.quickApps.appendChild(b);
    });
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'startab-tv-quick-app is-add-app'; add.dataset.tvControl = '';
    add.innerHTML = `${ICONS.plus}<b>Añadir</b>`;
    add.addEventListener('click', openAppsModal);
    dom.quickApps.appendChild(add);
  }
  function escapeHtml(value='') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function currentAppCatalog() {
    const d = selectedDevice();
    const list = Array.isArray(state.availableApps) && state.availableApps.length ? state.availableApps : (Array.isArray(d?.appCatalog) ? d.appCatalog : []);
    return list.filter(a => a && a.packageName).map(a => ({name:String(a.name || a.packageName), packageName:String(a.packageName)}));
  }
  function renderAppsList() {
    if (!dom.appsList) return;
    const q = String(dom.appSearch?.value || state.appSearch || '').trim().toLowerCase();
    const selected = new Set(quickApps().map(a => a.packageName));
    const apps = currentAppCatalog().filter(a => !q || a.name.toLowerCase().includes(q) || a.packageName.toLowerCase().includes(q));
    dom.appsList.innerHTML = '';
    if (!apps.length) { dom.appsList.innerHTML = '<div class="startab-tv-apps-loading">No se encontraron apps. Si estás por Firebase, espera un momento y vuelve a intentar.</div>'; return; }
    apps.forEach(app => {
      const b = document.createElement('button');
      b.type='button'; b.className='startab-tv-app-choice'; b.classList.toggle('is-selected', selected.has(app.packageName));
      b.innerHTML = `<span class="startab-tv-app-choice-mark">${appMark(app.name)}</span><span><b>${escapeHtml(app.name)}</b><small>${escapeHtml(app.packageName)}</small></span><i>${selected.has(app.packageName) ? '✓' : '+'}</i>`;
      b.addEventListener('click', () => {
        let list = quickApps(); const exists = list.some(x => x.packageName === app.packageName);
        list = exists ? list.filter(x => x.packageName !== app.packageName) : [...list, app];
        persistQuickApps(list);
        renderAppsList();
      });
      dom.appsList.appendChild(b);
    });
  }

  const controlPaint = { volume: null, brightness: null, muted: null, powerOn: null };

  function paintTvControls(force = false) {
    const d = selectedDevice();
    const volume = Math.round(clamp(state.optimisticVolume ?? Number(d?.volume ?? 0), 0, 100));
    if (force || controlPaint.volume !== volume) {
      const text = String(volume);
      if (dom.volume && dom.volume.value !== text) dom.volume.value = text;
      if (dom.volumeValue && dom.volumeValue.textContent !== `${volume}%`) dom.volumeValue.textContent = `${volume}%`;
      if (dom.volumeFill) {
        dom.volumeFill.style.setProperty('--tv-volume', `${volume}%`);
        dom.volumeFill.style.setProperty('--tv-volume-scale', String(volume / 100));
      }
      controlPaint.volume = volume;
    }

    const brightness = Math.round(clamp(state.optimisticBrightness ?? Number(d?.brightnessLevel ?? 10), 0, 10));
    if (force || controlPaint.brightness !== brightness) {
      const text = String(brightness);
      if (dom.brightness && dom.brightness.value !== text) dom.brightness.value = text;
      if (dom.brightnessValue && dom.brightnessValue.textContent !== `${brightness * 10}%`) dom.brightnessValue.textContent = `${brightness * 10}%`;
      dom.brightness?.style.setProperty('--tv-brightness', `${brightness * 10}%`);
      document.querySelectorAll('.startab-tv-brightness-ticks i').forEach((el, i) => {
        const active = i <= brightness;
        if (el.classList.contains('is-active') !== active) el.classList.toggle('is-active', active);
      });
      controlPaint.brightness = brightness;
    }

    if (force || controlPaint.muted !== !!state.muted) {
      dom.mute?.classList.toggle('is-muted', !!state.muted);
      controlPaint.muted = !!state.muted;
    }
    if (force || controlPaint.powerOn !== state.powerOn) {
      dom.power?.classList.toggle('is-on', state.powerOn === true);
      controlPaint.powerOn = state.powerOn;
    }
  }

  function render() {
    const d = selectedDevice();
    if (d) {
      const now = performance.now();
      if (Number.isFinite(Number(d.volume))) {
        const remoteVolume = Math.round(clamp(Number(d.volume), 0, 100));
        if (state.optimisticVolume == null || remoteVolume === Math.round(state.optimisticVolume) || now >= state.volumeHoldUntil) state.optimisticVolume = remoteVolume;
      }
      if (Number.isFinite(Number(d.brightnessLevel))) {
        const remoteBrightness = Math.round(clamp(Number(d.brightnessLevel), 0, 10));
        if (state.optimisticBrightness == null || remoteBrightness === Math.round(state.optimisticBrightness) || now >= state.brightnessHoldUntil) state.optimisticBrightness = remoteBrightness;
      }
      if (typeof d.muted === 'boolean') state.muted = d.muted;
      if (typeof d.powerOn === 'boolean') state.powerOn = d.powerOn;
      if (Array.isArray(d.appCatalog) && d.appCatalog.length && !state.availableApps.length) state.availableApps = d.appCatalog;
    }

    if (dom.deviceSelect) {
      const current = state.selectedId;
      dom.deviceSelect.innerHTML = '';
      if (!state.devices.size) dom.deviceSelect.add(new Option('Sin TVs vinculados', ''));
      else [...state.devices.values()].sort((a,b)=>String(a.deviceName).localeCompare(String(b.deviceName))).forEach(item => {
        const itemStatus = presenceStatus(item);
        const direct = item.deviceId === state.selectedId && state.wsReady;
        const statusLabel = direct ? 'Directo'
          : itemStatus.state === 'standby' ? 'Standby'
            : itemStatus.state === 'reconnecting' ? 'Reconectando'
              : itemStatus.state === 'unresponsive' ? 'Sin respuesta'
                : itemStatus.online ? 'Firebase' : 'No disponible';
        dom.deviceSelect.add(new Option(`${item.deviceName || 'Google TV'} · ${statusLabel}`, item.deviceId));
      });
      dom.deviceSelect.add(new Option('＋ Añadir otro TV…', '__add_tv__'));
      dom.deviceSelect.value = state.devices.has(current) ? current : (state.devices.size ? [...state.devices.keys()][0] : '');
    }

    paintTvControls();

    dom.empty?.classList.toggle('is-visible', !d);
    dom.remoteContent?.classList.toggle('is-hidden', !d);
    dom.modal?.querySelectorAll('[data-tv-control]').forEach(el => { el.disabled = !d; });
    renderQuickApps();

    const pstatus = d ? presenceStatus(d) : { state:'offline', online:false, source:'none' };
    if (!uid()) setStatus('error','Sin sesión','Inicia sesión en StarTab.');
    else if (!d && state.selectedId) setStatus('warn','Buscando TV','Sincronizando con Firebase…');
    else if (!d) setStatus('idle','Sin TV','Toca + para agregar uno.');
    else if (d.accessibility === false) setStatus('warn','Activar Accesibilidad','En el TV activa “StarTab TV · Cursor remoto”.');
    else if (state.wsReady) setStatus('direct','Directo',`${d.deviceName || 'Google TV'} · LAN de baja latencia${globalThis.StarTabPresence?.isRealtimeConnected?.() === false ? ' · sin Internet' : ''}`);
    else if (pstatus.state === 'standby') setStatus('firebase','Standby',`${d.deviceName || 'Google TV'} · conectado y en reposo`);
    else if (pstatus.state === 'online') setStatus('firebase','Firebase',`${d.deviceName || 'Google TV'} · conexión remota en tiempo real`);
    else if (pstatus.state === 'reconnecting') setStatus('warn','Reconectando',`${d.deviceName || 'Google TV'} · recuperando presencia por Firebase…`);
    else if (pstatus.state === 'unresponsive') setStatus('warn','Sin respuesta',`${d.deviceName || 'Google TV'} dejó de responder recientemente.`);
    else setStatus('error','No disponible',`${d.deviceName || 'Google TV'} está apagado, sin Internet o sin corriente.`);
  }

  async function initFirebase(retry = 0) {
    try {
      if (!globalThis.firebase?.firestore) throw new Error('firebase-not-ready');
      state.db = firebase.firestore(); state.auth = firebase.auth?.() || null;
      state.user = state.auth?.currentUser || readUser();
      state.auth?.onAuthStateChanged?.(() => { state.user = state.auth.currentUser || readUser(); listenDevices(); });
      listenDevices();
    } catch (_) { if (retry < 40) setTimeout(()=>initFirebase(retry+1), 300); }
  }

  function listenDevices() {
    closeWs();
    for (const entry of directPending.values()) clearTimeout(entry.timer); directPending.clear();
    state.unsubscribe?.(); state.unsubscribe = null;
    state.unsubscribePresence?.(); state.unsubscribePresence = null;
    state.devices.clear();
    const userId = uid(); if (!state.db || !userId) { render(); return; }
    if (globalThis.StarTabPresence?.watchType) {
      state.unsubscribePresence = globalThis.StarTabPresence.watchType(userId, 'tv', () => render());
    }
    state.unsubscribe = state.db.collection('users').doc(userId).collection('tvDevices').onSnapshot(snap => {
      state.devices.clear(); snap.forEach(doc => state.devices.set(doc.id, { deviceId: doc.id, ...doc.data() }));
      const saved = localStorage.getItem(SELECTED_KEY) || '';
      if (!state.selectedId) state.selectedId = state.devices.has(saved) ? saved : ([...state.devices.keys()][0] || '');
      if (state.selectedId && !state.devices.has(state.selectedId) && state.devices.size) state.selectedId = [...state.devices.keys()][0];
      if (state.selectedId) localStorage.setItem(SELECTED_KEY, state.selectedId);
      connectSelectedLocal(); render();
      if (dom.appsLayer?.classList.contains('is-open')) renderAppsList();
    }, () => render());
  }

  function resetLanTracking() {
    state.lanHealth = '';
    state.lanFailures = 0;
    state.lanLastAliveAt = 0;
    state.lanTrackedDeviceId = '';
  }

  function markLanAlive() {
    const was = state.lanHealth;
    state.lanTrackedDeviceId = state.selectedId;
    state.lanLastAliveAt = Date.now();
    state.lanFailures = 0;
    state.lanHealth = 'online';
    if (was && was !== 'online' && state.modalOpen) render();
  }

  function markLanFailure() {
    if (!state.modalOpen || !state.selectedId) return;
    if (state.lanTrackedDeviceId && state.lanTrackedDeviceId !== state.selectedId) resetLanTracking();
    state.lanTrackedDeviceId = state.selectedId;
    state.lanFailures = Math.min(LAN_OFFLINE_FAILURES, state.lanFailures + 1);
    const next = state.lanFailures >= LAN_OFFLINE_FAILURES
      ? 'offline'
      : (state.lanFailures >= LAN_UNRESPONSIVE_FAILURES ? 'unresponsive' : 'online');
    if (state.lanHealth !== next) {
      state.lanHealth = next;
      render();
    }
  }

  function closeWs() {
    state.wsReady = false; state.wsConnecting = false;
    clearInterval(state.wsKeepAlive); state.wsKeepAlive = 0;
    try { state.ws?.close(); } catch (_) {} state.ws = null;
    resetLanTracking();
  }

  function startWsKeepAlive() {
    clearInterval(state.wsKeepAlive);
    state.wsKeepAlive = setInterval(() => {
      if (!state.wsReady || state.ws?.readyState !== WebSocket.OPEN) return;
      const probeAt = Date.now();
      if (!wsSend({ t:'ping', id:`lan-health-${probeAt}` })) { markLanFailure(); return; }
      window.setTimeout(() => {
        if (!state.modalOpen || state.lanTrackedDeviceId !== state.selectedId) return;
        if (state.lanLastAliveAt < probeAt) { markLanFailure(); closeWs(); scheduleLocalReconnect(); }
      }, LAN_HEALTH_REPLY_TIMEOUT_MS);
    }, LAN_HEALTH_PING_MS);
  }

  function localEndpoint(device) {
    const p = pairingFor(device?.deviceId || state.selectedId) || {};
    const ip = String(device?.localIp || p.ip || '').trim();
    const port = Number(device?.localPort || p.port || 8765);
    const secret = String(device?.localSecret || p.secret || '');
    return { ip, port, secret };
  }

  function commandErrorMessage(reason = '') {
    const map = {
      'accessibility-disabled':'Activa “StarTab TV · Cursor remoto” en Accesibilidad del Google TV.',
      'dpad-unavailable':'La cruceta no pudo mover el foco en esta pantalla del TV.',
      'ok-unavailable':'No hay un elemento seleccionable para ejecutar OK.',
      'home-unavailable':'Android TV no permitió ejecutar Home.',
      'fixed-volume-policy':'Este Google TV delega el volumen por CEC/IR y Android no puede modificarlo directamente.',
      'power-admin-required':'Mira el TV: StarTab abrió el permiso adicional para apagar/suspender de forma fiable.',
      'wake-unavailable':'El fabricante no permitió despertar la pantalla desde la app.',
      'power-unavailable':'El control de energía no está disponible en este modelo.',
      'app-not-installed':'La aplicación ya no está instalada en el Google TV.',
      'input-unavailable':'Este Google TV no expuso el selector de entradas a aplicaciones. Prueba el botón Input físico una vez y vuelve a intentar.',
      'assistant-unavailable':'Google Assistant no está disponible o está deshabilitado en este TV.',
      'menu-unavailable':'La app actual no expuso una acción de menú compatible.',
      'text-field-unavailable':'Selecciona primero un campo de texto en el Google TV y vuelve a escribir.',
    };
    return map[reason] || `El TV rechazó la orden (${reason || 'error'}).`;
  }

  function showCommandError(reason) {
    setStatus('error','Orden no ejecutada',commandErrorMessage(reason));
    setTimeout(() => render(), 2600);
  }

  function mobileDirectWarmEnabled() {
    try { return !document.hidden && window.matchMedia?.('(max-width: 760px), (hover: none) and (pointer: coarse)')?.matches; }
    catch (_) { return false; }
  }

  function shouldKeepLocalWarm() {
    return state.modalOpen || mobileDirectWarmEnabled();
  }

  function scheduleLocalReconnect(delay = 850) {
    clearTimeout(state.preconnectTimer);
    state.preconnectTimer = 0;
    if (!shouldKeepLocalWarm() || !state.selectedId || state.wsReady || state.wsConnecting) return;
    state.preconnectTimer = setTimeout(() => {
      state.preconnectTimer = 0;
      connectSelectedLocal();
    }, Math.max(350, Number(delay) || 850));
  }

  function connectSelectedLocal() {
    if (!shouldKeepLocalWarm()) return;
    const d = selectedDevice(); if (!d || state.wsConnecting || state.wsReady) return;
    const { ip, port, secret } = localEndpoint(d); if (!ip || !secret) return;
    if (Date.now() - (state.localAttemptAt || 0) < 5000) return;
    state.localAttemptAt = Date.now();
    state.wsConnecting = true;
    let ws;
    try { ws = new WebSocket(`ws://${ip}:${port}`); } catch (_) { state.wsConnecting = false; markLanFailure(); return; }
    state.ws = ws;
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} }, 1800);
    ws.onopen = () => { if (state.ws !== ws) return; ws.send(JSON.stringify({ type:'hello', secret })); };
    ws.onmessage = ev => {
      if (state.ws !== ws) return;
      try {
        const data = JSON.parse(ev.data || '{}');
        if (data.ok === true) markLanAlive();
        if (data.reason === 'unauthorized') { closeWs(); return; }
        if (data.type === 'state' && data.ok) {
          clearTimeout(timer); state.wsReady = true; state.wsConnecting = false; applyRemoteState(data); startWsKeepAlive(); render();
        }
        if (data.type === 'ack') {
          const pending = directPending.get(data.id); if (pending) { clearTimeout(pending.timer); directPending.delete(data.id); }
          if (data.ok === false) { showCommandError(data.reason || 'error'); return; }
          if (Array.isArray(data.apps)) { state.availableApps = data.apps; renderAppsList(); }
          const hasState = Number.isFinite(Number(data.volume)) || Number.isFinite(Number(data.brightnessLevel)) || typeof data.muted === 'boolean' || typeof data.powerOn === 'boolean';
          if (hasState) { applyRemoteState(data); render(); }
        }
      } catch (_) {}
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      clearTimeout(timer);
      if (state.ws === ws) {
        state.ws = null; state.wsReady = false; state.wsConnecting = false;
        clearInterval(state.wsKeepAlive); state.wsKeepAlive = 0;
        markLanFailure();
        render();
        scheduleLocalReconnect(state.modalOpen ? 650 : 1200);
      }
    };
  }

  const directPending = new Map();
  function cloudPayload(obj) {
    const data = {...obj, clientAt:obj.clientAt || Date.now()}; delete data.secret;
    const names = {move:'motionRelay',scroll:'scrollRelay',click:'clickRelay',volume:'volumeCommand',back:'backCommand'};
    const name = names[obj.t] || 'actionCommand';
    if (name === 'actionCommand') data.type = obj.t;
    delete data.t;
    return {[name]:data};
  }
  function wsSend(obj) {
    if (!state.wsReady || state.ws?.readyState !== WebSocket.OPEN || state.ws.bufferedAmount > 65536) return false;
    const device = selectedDevice(), userId = uid();
    const data = {...obj, id:obj.id || unique(), clientAt:Date.now()};
    const payload = cloudPayload(data);
    const envelope = globalThis.StarTabTransport.envelope(payload, 8000, data.id);
    data.expiresAtClient = envelope.expiresAtClient;
    try {
      state.ws.send(JSON.stringify({...data,secret:localEndpoint(device).secret}));
      if (obj.t !== 'ping') {
        const timer = setTimeout(() => {
          directPending.delete(data.id);
          // Same ID on both transports. Do not reroute to a newly selected TV/account.
          if (uid() !== userId || state.selectedId !== device?.deviceId) return;
          closeWs(); scheduleLocalReconnect();
          void firebaseMerge(payload,8000,{device,uid:userId},envelope);
        },1100);
        directPending.set(data.id,{timer,deviceId:device?.deviceId});
      }
      return true;
    } catch (_) { closeWs(); scheduleLocalReconnect(); return false; }
  }

  function bytesToBase64(bytes) {
    let binary = ''; const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
    return btoa(binary);
  }
  function base64ToBytes(value) {
    const binary = atob(String(value || '')); const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  async function buildSecurePairPayload(serverPublicKeyB64, credentials, pin) {
    const serverKey = await crypto.subtle.importKey('spki', base64ToBytes(serverPublicKeyB64), { name:'ECDH', namedCurve:'P-256' }, false, []);
    const clientKeys = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveBits']);
    const sharedBits = await crypto.subtle.deriveBits({ name:'ECDH', public:serverKey }, clientKeys.privateKey, 256);
    const digest = await crypto.subtle.digest('SHA-256', sharedBits);
    const aesKey = await crypto.subtle.importKey('raw', digest, { name:'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const clear = new TextEncoder().encode(JSON.stringify({ pin, uid:credentials.uid, refreshToken:credentials.refreshToken }));
    const encrypted = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, aesKey, clear);
    const clientPublic = await crypto.subtle.exportKey('spki', clientKeys.publicKey);
    return { type:'pair-secure', clientPublicKey:bytesToBase64(clientPublic), iv:bytesToBase64(iv), payload:bytesToBase64(encrypted) };
  }

  function parsePairQr(rawValue) {
    try {
      const url = new URL(String(rawValue || '').trim());
      if (url.protocol !== 'startabtv:' || url.hostname !== 'pair') return null;
      const ip = String(url.searchParams.get('ip') || '').trim();
      const pin = String(url.searchParams.get('pin') || '').replace(/\D/g, '').slice(0, 6);
      const port = Number(url.searchParams.get('port') || 8765);
      const version = Number(url.searchParams.get('v') || 1);
      if (version !== 1 || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || pin.length !== 6 || !Number.isInteger(port) || port < 1 || port > 65535) return null;
      const octets = ip.split('.').map(Number);
      if (octets.some(n => n < 0 || n > 255)) return null;
      return { ip, pin, port, deviceId: String(url.searchParams.get('device') || '') };
    } catch (_) { return null; }
  }

  function closeAddModal() { dom.addLayer?.classList.remove('is-open'); dom.addLayer?.setAttribute('aria-hidden','true'); }
  function openAddModal() { dom.addLayer?.classList.add('is-open'); dom.addLayer?.setAttribute('aria-hidden','false'); setTimeout(()=>dom.pairIp?.focus(),120); }
  function closeAppsModal() { dom.appsLayer?.classList.remove('is-open'); dom.appsLayer?.setAttribute('aria-hidden','true'); }
  function openAppsModal() {
    if (!selectedDevice()) return;
    dom.appsLayer?.classList.add('is-open'); dom.appsLayer?.setAttribute('aria-hidden','false');
    state.appSearch=''; if (dom.appSearch) dom.appSearch.value='';
    renderAppsList(); requestAppCatalog();
    setTimeout(()=>dom.appSearch?.focus(),100);
  }
  function requestAppCatalog() {
    if (wsSend({t:'listApps', id:unique()})) return;
    firebaseMerge({ actionCommand:{ id:unique(), type:'listApps', clientAt:Date.now() } });
  }

  async function pairTv(pairData) {
    const userId = uid();
    const ip = String(pairData?.ip || '').trim();
    const pin = String(pairData?.pin || '').replace(/\D/g, '').slice(0,6);
    const port = Number(pairData?.port || 8765);
    if (!userId) { setStatus('error','Sin sesión','Inicia sesión en StarTab primero.'); return; }
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || pin.length !== 6 || !Number.isInteger(port)) { setStatus('error','Datos no válidos','Verifica la IP y el PIN del TV.'); return; }
    setStatus('warn','Vinculando…','Conectando directamente con el Google TV.');
    let credentials = readUser();
    if (!credentials?.refreshToken && state.auth?.currentUser?.refreshToken) credentials = { uid: state.auth.currentUser.uid, refreshToken: state.auth.currentUser.refreshToken };
    if (!credentials?.refreshToken) { try { credentials = await globalThis.chrome?.runtime?.sendMessage?.({ type:'STARTAB_CAPTURE_FIREBASE_CREDENTIALS', uid:userId }); } catch (_) {} }
    if (!credentials?.refreshToken) { setStatus('error','Falta credencial','Abre nuevamente el inicio de sesión de StarTab y vuelve a intentar.'); return; }

    let ws;
    try { ws = new WebSocket(`ws://${ip}:${port}`); } catch (_) { setStatus('error','No se pudo conectar','Verifica que el móvil y el TV estén en la misma red Wi‑Fi.'); return; }
    const timeout = setTimeout(() => { try { ws.close(); } catch (_) {} setStatus('error','TV no encontrado','El PIN puede haber vencido o no están en la misma red.'); }, 5500);
    ws.onopen = () => ws.send(JSON.stringify({ type:'pair-init' }));
    ws.onmessage = async ev => {
      let data; try { data = JSON.parse(ev.data || '{}'); } catch (_) { return; }
      if (data.type === 'pair-init' && data.ok && data.publicKey) {
        try { ws.send(JSON.stringify(await buildSecurePairPayload(data.publicKey, { uid:userId, refreshToken:credentials.refreshToken }, pin))); }
        catch (_) { clearTimeout(timeout); try { ws.close(); } catch (_) {} setStatus('error','Error de seguridad','No se pudo cifrar el vínculo con el Google TV.'); }
        return;
      }
      if (data.type !== 'paired' || !data.ok) { if (data.reason === 'pairing-rejected') setStatus('error','PIN vencido','Genera un nuevo código en el Google TV.'); return; }
      clearTimeout(timeout);
      savePairing(data.deviceId, { secret:data.secret, ip:data.ip || ip, port:data.port || port, name:data.deviceName || 'Google TV' });
      state.selectedId = data.deviceId; localStorage.setItem(SELECTED_KEY, data.deviceId);
      try { ws.close(); } catch (_) {}
      closeAddModal();
      setStatus('direct','TV vinculado','Conexión segura completada.');
      setTimeout(() => { listenDevices(); connectSelectedLocal(); }, 700);
    };
    ws.onerror = () => {};
    ws.onclose = () => { clearTimeout(timeout); };
  }

  function setScannerNote(message, kind = '') { if (!dom.scannerNote) return; dom.scannerNote.textContent = message; dom.scannerNote.dataset.state = kind; }

  function stopQrScanner() {
    state.scannerActive = false; state.scanBusy = false; clearTimeout(state.scanTimer); state.scanTimer = 0;
    if (state.cameraStream) { try { state.cameraStream.getTracks().forEach(track => track.stop()); } catch (_) {} state.cameraStream = null; }
    if (dom.scannerVideo) { try { dom.scannerVideo.pause(); } catch (_) {} dom.scannerVideo.srcObject = null; }
    dom.scanner?.classList.remove('is-open'); dom.scanner?.setAttribute('aria-hidden','true');
  }

  async function scanQrFrame() {
    if (!state.scannerActive || !state.barcodeDetector || !dom.scannerVideo) return;
    if (state.scanBusy || dom.scannerVideo.readyState < 2) { state.scanTimer = setTimeout(scanQrFrame, 120); return; }
    state.scanBusy = true;
    try {
      const results = await state.barcodeDetector.detect(dom.scannerVideo);
      const raw = results?.[0]?.rawValue || '';
      if (raw) {
        const pair = parsePairQr(raw);
        if (pair) { globalThis.StartabHaptics?.success?.(); setScannerNote('QR detectado. Vinculando con el TV…', 'ok'); stopQrScanner(); await pairTv(pair); return; }
        setScannerNote('Ese QR no pertenece a StarTab TV.', 'error');
      }
    } catch (_) {}
    state.scanBusy = false; state.scanTimer = setTimeout(scanQrFrame, 120);
  }

  async function openQrScanner() {
    if (!uid()) { setStatus('error','Sin sesión','Inicia sesión en StarTab antes de escanear el TV.'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setStatus('error','Cámara no disponible','Abre StarTab desde un navegador seguro compatible con cámara.'); return; }
    if (!('BarcodeDetector' in globalThis)) { setStatus('error','Escáner no compatible','Actualiza Chrome/Edge en el móvil para usar el lector QR integrado.'); return; }
    dom.scanner?.classList.add('is-open'); dom.scanner?.setAttribute('aria-hidden','false'); setScannerNote('Solicitando acceso a la cámara…');
    try {
      const supported = await BarcodeDetector.getSupportedFormats?.(); if (Array.isArray(supported) && !supported.includes('qr_code')) throw new Error('qr-not-supported');
      state.barcodeDetector = new BarcodeDetector({ formats:['qr_code'] });
      state.cameraStream = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ facingMode:{ ideal:'environment' }, width:{ ideal:1280 }, height:{ ideal:720 } } });
      dom.scannerVideo.srcObject = state.cameraStream; await dom.scannerVideo.play(); state.scannerActive = true; setScannerNote('Apunta la cámara al QR que aparece en StarTab TV.'); scanQrFrame();
    } catch (error) {
      stopQrScanner(); const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
      setStatus('error', denied ? 'Permiso de cámara bloqueado' : 'No se pudo abrir la cámara', denied ? 'Permite la cámara para StarTab y vuelve a intentarlo.' : 'Verifica que ninguna otra app esté usando la cámara.');
    }
  }

  async function firebaseMerge(payload, leaseMs = 12000, target = null, envelope = null) {
    const d = target?.device || selectedDevice();
    const userId = target?.uid || uid();
    if (!d || !state.db || !userId) return false;
    if (payload.quickApps) {
      try { await state.db.collection('users').doc(userId).collection('tvDevices').doc(d.deviceId).set(payload,{merge:true}); return true; }
      catch (_) { return false; }
    }
    const result = await globalThis.StarTabTransport.send(userId, 'tv', d.deviceId, payload, leaseMs, envelope || '');
    if (d.deviceId === state.selectedId && userId === uid()) {
      state.realtimeCommandOk = result.ok;
      if (!result.ok && result.reason !== 'superseded') showCommandError(result.reason);
      if (result.ok && Array.isArray(result.apps)) { state.availableApps = result.apps; renderAppsList(); }
      if (result.ok) { applyRemoteState(result); render(); }
    }
    return result.ok;
  }

  function sendAction(type, extra = {}, haptic = true) {
    if (haptic) globalThis.StartabHaptics?.click?.();
    if (wsSend({ id:unique(), t:type, ...extra })) return;
    firebaseMerge({ actionCommand:{ id:unique(), type, ...extra, clientAt:Date.now() } });
  }

  function sendMove(dx,dy) {
    dx = clamp(dx,-500,500); dy = clamp(dy,-500,500); if (!dx && !dy) return;
    if (wsSend({ t:'move', dx:Math.round(dx), dy:Math.round(dy) })) return;
    state.motionDx += dx; state.motionDy += dy; if (state.motionTimer) return;
    state.motionTimer = setTimeout(() => { state.motionTimer = 0; const x=state.motionDx,y=state.motionDy; state.motionDx=state.motionDy=0; firebaseMerge({ motionRelay:{ id:unique(), dx:Math.round(x), dy:Math.round(y), clientAt:Date.now() } }); }, FIREBASE_MOTION_MS);
  }

  function sendScroll(delta) {
    delta=clamp(delta,-720,720); if (!delta) return;
    if (wsSend({ t:'scroll', delta:Math.round(delta) })) return;
    state.scrollDy += delta; if (state.scrollTimer) return;
    state.scrollTimer=setTimeout(()=>{ state.scrollTimer=0; const value=state.scrollDy;state.scrollDy=0;firebaseMerge({scrollRelay:{id:unique(),delta:Math.round(value),clientAt:Date.now()}});},90);
  }

  function sendClick(button='left') {
    globalThis.StartabHaptics?.click?.(button);
    if (wsSend({ t:'click', button })) return;
    firebaseMerge({ clickRelay:{ id:unique(), button, clientAt:Date.now() } });
  }

  function sendBack() { if (wsSend({id:unique(),t:'back'})) return; firebaseMerge({backCommand:{id:unique(),clientAt:Date.now()}}); }

  function setVolume(value) {
    value = Math.round(clamp(value,0,100));
    const now = performance.now();
    state.optimisticVolume = value; state.lastVolumeInputAt = now; state.volumeHoldUntil = now + CONTROL_LOCAL_HOLD_MS;
    paintTvControls();
    if (wsSend({id:unique(),t:'volume',value})) return;
    state.pendingVolume=value;
    const elapsed=now-state.lastVolumeFirebaseAt;
    if (elapsed>=60) { state.lastVolumeFirebaseAt=now; const v=state.pendingVolume;state.pendingVolume=null;firebaseMerge({volumeCommand:{id:unique(),value:v,clientAt:Date.now()}}); return; }
    clearTimeout(state.volumeTimer); state.volumeTimer=setTimeout(()=>{state.lastVolumeFirebaseAt=performance.now();const v=state.pendingVolume;state.pendingVolume=null;if(v!=null)firebaseMerge({volumeCommand:{id:unique(),value:v,clientAt:Date.now()}});},Math.max(0,60-elapsed));
  }

  function stepVolume(steps) {
    steps = Math.max(-8, Math.min(8, Math.trunc(Number(steps) || 0)));
    if (!steps) return;
    globalThis.StartabHaptics?.click?.();
    const d = selectedDevice();
    const maxSteps = Math.max(1, Number(d?.volumeMaxSteps) || 20);
    const current = Number(state.optimisticVolume ?? d?.volume ?? 0);
    state.optimisticVolume = Math.round(clamp(current + (steps * 100 / maxSteps), 0, 100));
    state.lastVolumeInputAt = performance.now();
    state.volumeHoldUntil = state.lastVolumeInputAt + CONTROL_LOCAL_HOLD_MS;
    paintTvControls();
    const commandId = unique();
    if (wsSend({ id:commandId, t:'volumeStep', value:steps })) return;
    firebaseMerge({ actionCommand:{ id:commandId, type:'volumeStep', value:steps, clientAt:Date.now() } });
  }

  function toggleMute() {
    state.muted = !state.muted; paintTvControls();
    if (wsSend({id:unique(),t:'mute', muted:state.muted})) return;
    firebaseMerge({ actionCommand:{ id:unique(), type:'mute', muted:state.muted, clientAt:Date.now() } });
  }

  function setBrightness(level) {
    level = Math.round(clamp(level,0,10));
    const now = performance.now();
    state.optimisticBrightness = level; state.lastBrightnessInputAt = now; state.brightnessHoldUntil = now + CONTROL_LOCAL_HOLD_MS;
    paintTvControls();
    if (wsSend({id:unique(),t:'brightness', level})) return;
    state.pendingBrightness=level; const elapsed=now-state.lastBrightnessFirebaseAt;
    if(elapsed>=70){state.lastBrightnessFirebaseAt=now;const v=state.pendingBrightness;state.pendingBrightness=null;firebaseMerge({actionCommand:{id:unique(),type:'brightness',level:v,clientAt:Date.now()}});return;}
    clearTimeout(state.brightnessTimer); state.brightnessTimer=setTimeout(()=>{state.lastBrightnessFirebaseAt=performance.now();const v=state.pendingBrightness;state.pendingBrightness=null;if(v!=null)firebaseMerge({actionCommand:{id:unique(),type:'brightness',level:v,clientAt:Date.now()}});},Math.max(0,70-elapsed));
  }

  function hapticNav() {
    try {
      const h = globalThis.StartabHaptics;
      if (h?.pulse?.('tv-nav-repeat', 11, 80)) return;
    } catch (_) {}
    try { navigator.vibrate?.(11); } catch (_) {}
  }

  function flashNav(direction) {
    if (!dom.navTouch) return;
    dom.navTouch.dataset.gesture = direction || 'ok';
    clearTimeout(dom.navTouch._gestureTimer);
    dom.navTouch._gestureTimer = setTimeout(() => { if (dom.navTouch && state.pointerId === null) delete dom.navTouch.dataset.gesture; }, 170);
  }

  function sendNavDirection(direction) {
    hapticNav(); flashNav(direction); sendAction('dpad',{direction},false);
  }

  function sendNavOk() {
    hapticNav(); flashNav('ok'); sendAction('ok',{},false);
  }

  function bindNavTouch() {
    const el = dom.navTouch; if (!el) return;

    const paintStickFrame = () => {
      state.navRaf = 0;
      const active = state.pointerId !== null;
      const easing = active ? 0.46 : 0.24;
      state.navVisualX += (state.navTargetX - state.navVisualX) * easing;
      state.navVisualY += (state.navTargetY - state.navVisualY) * easing;
      state.navVisualStrength += (state.navTargetStrength - state.navVisualStrength) * easing;

      if (Math.abs(state.navTargetX - state.navVisualX) < 0.08) state.navVisualX = state.navTargetX;
      if (Math.abs(state.navTargetY - state.navVisualY) < 0.08) state.navVisualY = state.navTargetY;
      if (Math.abs(state.navTargetStrength - state.navVisualStrength) < 0.003) state.navVisualStrength = state.navTargetStrength;

      el.style.setProperty('--tv-stick-x', `${state.navVisualX.toFixed(2)}px`);
      el.style.setProperty('--tv-stick-y', `${state.navVisualY.toFixed(2)}px`);
      el.style.setProperty('--tv-stick-strength', state.navVisualStrength.toFixed(3));
      el.style.setProperty('--tv-stick-glow-scale', (0.88 + state.navVisualStrength * 0.18).toFixed(3));
      el.style.setProperty('--tv-stick-glow-opacity', (0.34 + state.navVisualStrength * 0.42).toFixed(3));

      const unsettled = Math.abs(state.navTargetX - state.navVisualX) > 0.08 ||
        Math.abs(state.navTargetY - state.navVisualY) > 0.08 ||
        Math.abs(state.navTargetStrength - state.navVisualStrength) > 0.003;
      if (unsettled) state.navRaf = requestAnimationFrame(paintStickFrame);
    };

    const queueVisual = v => {
      state.navTargetX = v.x; state.navTargetY = v.y; state.navTargetStrength = v.strength;
      if (!state.navRaf) state.navRaf = requestAnimationFrame(paintStickFrame);
    };

    const resetVisual = () => {
      state.navDirection = ''; state.navStrength = 0;
      clearTimeout(state.navRepeatTimer); state.navRepeatTimer = 0;
      el.classList.remove('is-pressed','is-driving');
      state.navTargetX = 0; state.navTargetY = 0; state.navTargetStrength = 0;
      queueVisual({x:0,y:0,strength:0});
      delete el.dataset.gesture;
    };

    const vectorFor = (clientX, clientY) => {
      const dx = clientX - state.startX, dy = clientY - state.startY;
      const maxTravel = Math.max(42, Math.min(el.clientWidth, el.clientHeight) * 0.28);
      const rawDist = Math.hypot(dx, dy);
      const scale = rawDist > maxTravel && rawDist > 0 ? maxTravel / rawDist : 1;
      const x = dx * scale, y = dy * scale;
      const dist = Math.min(maxTravel, rawDist);
      const strength = clamp(dist / maxTravel, 0, 1);
      let direction = '';
      if (strength >= 0.16) direction = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up');
      return { x, y, strength, direction, rawDist, maxTravel };
    };

    const repeatInterval = strength => {
      const t = clamp((strength - 0.16) / 0.84, 0, 1);
      // Desplazamiento corto: ~0.7 s. Cerca del borde: ~0.3 s.
      return Math.round(NAV_REPEAT_SLOW_MS - Math.pow(t, 0.92) * (NAV_REPEAT_SLOW_MS - NAV_REPEAT_FAST_MS));
    };

    const scheduleRepeat = () => {
      clearTimeout(state.navRepeatTimer); state.navRepeatTimer = 0;
      if (state.pointerId === null || !state.navDirection || state.navStrength < 0.16) return;
      const interval = repeatInterval(state.navStrength);
      const wait = Math.max(40, interval - (performance.now() - state.navLastSentAt));
      state.navRepeatTimer = setTimeout(() => {
        state.navRepeatTimer = 0;
        if (state.pointerId === null || !state.navDirection || state.navStrength < 0.16) return;
        state.navLastSentAt = performance.now();
        hapticNav(); // una vibración por cada repetición real enviada al TV
        sendAction('dpad', { direction: state.navDirection }, false);
        scheduleRepeat();
      }, wait);
    };

    const updateDirection = v => {
      const changed = v.direction !== state.navDirection;
      state.navStrength = v.strength;
      el.classList.toggle('is-driving', v.strength >= 0.16);
      if (v.direction) el.dataset.gesture = v.direction; else delete el.dataset.gesture;

      if (changed) {
        state.navDirection = v.direction;
        clearTimeout(state.navRepeatTimer); state.navRepeatTimer = 0;
        if (v.direction) {
          state.navLastSentAt = performance.now();
          hapticNav();
          sendAction('dpad', { direction: v.direction }, false);
        }
      }
      if (v.direction) scheduleRepeat();
    };

    el.addEventListener('pointerdown', e => {
      if (state.pointerId !== null) return;
      state.pointerId = e.pointerId;
      state.startX = state.lastX = e.clientX;
      state.startY = state.lastY = e.clientY;
      state.downAt = performance.now(); state.moved = false;
      state.navDirection = ''; state.navStrength = 0; state.navLastSentAt = 0;
      state.navVisualX = state.navTargetX = 0;
      state.navVisualY = state.navTargetY = 0;
      state.navVisualStrength = state.navTargetStrength = 0;
      el.classList.add('is-pressed');
      try { el.setPointerCapture?.(e.pointerId); } catch (_) {}
      queueVisual({x:0,y:0,strength:0});
      e.preventDefault();
    }, { passive:false });

    el.addEventListener('pointermove', e => {
      if (e.pointerId !== state.pointerId) return;
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
      const point = events?.length ? events[events.length - 1] : e;
      state.lastX = point.clientX; state.lastY = point.clientY;
      const v = vectorFor(point.clientX, point.clientY);
      if (v.rawDist > 8) state.moved = true;
      queueVisual(v);
      updateDirection(v);
      e.preventDefault();
    }, { passive:false });

    const finish = (e, cancelled = false) => {
      if (e.pointerId !== state.pointerId) return;
      const v = vectorFor(e.clientX, e.clientY);
      const elapsed = performance.now() - state.downAt;
      const tap = !cancelled && v.rawDist < 13 && elapsed < 850;
      state.pointerId = null;
      clearTimeout(state.navRepeatTimer); state.navRepeatTimer = 0;
      try { el.releasePointerCapture?.(e.pointerId); } catch (_) {}
      resetVisual();
      if (tap) sendNavOk();
      e.preventDefault();
    };
    el.addEventListener('pointerup', e => finish(e, false), { passive:false });
    el.addEventListener('pointercancel', e => finish(e, true), { passive:false });

    el.addEventListener('keydown', e => {
      const map = {ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'};
      if (map[e.key]) { sendNavDirection(map[e.key]); e.preventDefault(); }
      else if (e.key === 'Enter' || e.key === ' ') { sendNavOk(); e.preventDefault(); }
    });
  }

  function openKeyboard() {
    if (!selectedDevice() || !dom.keyboardInput) return;
    const el=dom.keyboardInput;
    el.value=''; el.dataset.prev='';
    // Si el usuario cerró manualmente el teclado pero el campo conservó foco,
    // blur + focus dentro del mismo gesto fuerza a reabrir el IME móvil.
    try { el.blur(); } catch (_) {}
    // El focus ocurre dentro del click del usuario: en móvil abre directamente
    // el teclado nativo, sin mostrar ningún modal/campo de StarTab.
    try { el.focus({preventScroll:true}); } catch (_) { try { el.focus(); } catch (_) {} }
    try { el.setSelectionRange(0,0); } catch (_) {}
    // Respaldo para navegadores móviles que necesitan un segundo focus breve.
    setTimeout(()=>{ if(document.activeElement!==el){try{el.focus({preventScroll:true});}catch(_){try{el.focus();}catch(__){}}} },35);
  }
  function closeKeyboard() {
    try { dom.keyboardInput?.blur(); } catch (_) {}
  }
  function sendKeyboardText(text) {
    const value=String(text||''); if(!value)return;
    if (wsSend({id:unique(),t:'text',text:value})) return;
    state.keyboardBuffer += value;
    clearTimeout(state.keyboardTimer);
    state.keyboardTimer=setTimeout(()=>{const chunk=state.keyboardBuffer;state.keyboardBuffer='';if(chunk)firebaseMerge({actionCommand:{id:unique(),type:'text',text:chunk,clientAt:Date.now()}},15000);},55);
  }
  function sendKeyboardKey(key, count=1) {
    const safeKey=String(key||''), safeCount=Math.max(1,Math.min(20,Number(count)||1));
    if (wsSend({id:unique(),t:'key',key:safeKey,count:safeCount})) return;
    clearTimeout(state.keyboardTimer);
    const pending=state.keyboardBuffer; state.keyboardBuffer='';
    const sendKey=()=>firebaseMerge({actionCommand:{id:unique(),type:'key',key:safeKey,count:safeCount,clientAt:Date.now()}},15000);
    if(pending) firebaseMerge({actionCommand:{id:unique(),type:'text',text:pending,clientAt:Date.now()}},15000).finally(sendKey); else sendKey();
  }
  function handleKeyboardInput() {
    const el=dom.keyboardInput;if(!el)return;
    const prev=String(el.dataset.prev||''), next=String(el.value||'');
    if(next===prev)return;
    if(next.startsWith(prev)) sendKeyboardText(next.slice(prev.length));
    else if(prev.startsWith(next)) sendKeyboardKey('backspace',prev.length-next.length);
    else { const common=[...prev].findIndex((c,i)=>next[i]!==c); const i=common<0?Math.min(prev.length,next.length):common; if(prev.length>i)sendKeyboardKey('backspace',prev.length-i); if(next.length>i)sendKeyboardText(next.slice(i)); }
    el.dataset.prev=next;
    if(next.length>700){el.value=next.slice(-350);el.dataset.prev=el.value;}
  }

  function stopFirebaseSessionLease() {
    clearInterval(state.firebaseSessionTimer); state.firebaseSessionTimer=0;
    const d = selectedDevice();
    if (d && uid()) void globalThis.StarTabPresence?.setWatcher?.(uid(), 'tv', d.deviceId, false, 'tv-control');
  }
  function startFirebaseSessionLease() {
    stopFirebaseSessionLease();
    const d = selectedDevice();
    if (!state.modalOpen || !d || !uid()) return;
    const activate = async () => {
      await globalThis.StarTabPresence?.setWatcher?.(uid(), 'tv', d.deviceId, !document.hidden, 'tv-control');
      // No escribimos leases vacíos en Firestore. El snapshot existente es
      // suficiente como respaldo si RTDB tarda en reconectar.
    };
    void activate();
    state.firebaseSessionTimer=setInterval(()=>{ if(state.modalOpen) void activate(); },24000);
  }

  function bindUi() {
    dom.toggle = $('startab-tv-toggle');
    dom.toggle?.addEventListener('click',()=>{ state.modalOpen=true; dom.modal?.classList.add('is-open'); dom.modal?.setAttribute('aria-hidden','false'); document.documentElement.classList.add('startab-tv-modal-open'); connectSelectedLocal(); startFirebaseSessionLease(); render(); });
    const close=()=>{ state.modalOpen=false; stopFirebaseSessionLease(); if (!mobileDirectWarmEnabled()) closeWs(); else scheduleLocalReconnect(450); stopQrScanner(); closeAddModal(); closeAppsModal(); closeAppEditor(); closeAppContext(); closeKeyboard(); dom.modal?.classList.remove('is-open'); dom.modal?.setAttribute('aria-hidden','true'); document.documentElement.classList.remove('startab-tv-modal-open'); };
    dom.close?.addEventListener('click',close); dom.backdrop?.addEventListener('click',close);

    dom.add?.addEventListener('click',openAddModal); dom.addClose?.addEventListener('click',closeAddModal); dom.addLayer?.querySelector('.startab-tv-layer-backdrop')?.addEventListener('click',closeAddModal);
    dom.scanBtn?.addEventListener('click',openQrScanner);
    dom.pairBtn?.addEventListener('click',()=>pairTv({ip:dom.pairIp?.value||'',pin:dom.pairPin?.value||'',port:8765}));
    dom.pairPin?.addEventListener('keydown',e=>{if(e.key==='Enter')dom.pairBtn?.click();});

    dom.appsClose?.addEventListener('click',closeAppsModal); dom.appsLayer?.querySelector('.startab-tv-layer-backdrop')?.addEventListener('click',closeAppsModal);
    dom.appSearch?.addEventListener('input',()=>{state.appSearch=dom.appSearch.value||'';renderAppsList();});
    dom.appContextEdit?.addEventListener('click',()=>{ if(state.contextAppPackage) openAppEditor(state.contextAppPackage); });
    dom.appEditClose?.addEventListener('click',closeAppEditor); dom.appEditLayer?.querySelector('.startab-tv-layer-backdrop')?.addEventListener('click',closeAppEditor);
    dom.appEditFile?.addEventListener('change', async ()=>{
      const file=dom.appEditFile.files?.[0]; if(!file)return;
      try{ state.editingBackground=await imageFileToBase64(file); updateAppEditPreview(); }
      catch(_){ setStatus('error','Imagen no válida','Selecciona una imagen JPG, PNG o WebP.'); setTimeout(render,2200); }
    });
    dom.appEditReset?.addEventListener('click',()=>{state.editingBackground='';updateAppEditPreview();});
    dom.appEditSave?.addEventListener('click',()=>{
      const list=quickApps().map(a=>a.packageName===state.editingAppPackage?{...a,background:state.editingBackground||''}:a);
      persistQuickApps(list); closeAppEditor();
    });
    document.addEventListener('pointerdown',e=>{if(dom.appContext?.classList.contains('is-open')&&!dom.appContext.contains(e.target))closeAppContext();});
    window.addEventListener('resize',closeAppContext); window.addEventListener('scroll',closeAppContext,true);

    dom.scannerClose?.addEventListener('click',stopQrScanner); dom.scannerCancel?.addEventListener('click',stopQrScanner); dom.scanner?.querySelector('.startab-tv-scanner-backdrop')?.addEventListener('click',stopQrScanner);
    dom.deviceSelect?.addEventListener('change',()=>{clearPendingControls();const next=dom.deviceSelect.value||'';if(next==='__add_tv__'){openAddModal();dom.deviceSelect.value=state.selectedId||'';return;}stopFirebaseSessionLease();state.selectedId=next;localStorage.setItem(SELECTED_KEY,state.selectedId);state.optimisticVolume=null;state.optimisticBrightness=null;state.volumeHoldUntil=0;state.brightnessHoldUntil=0;controlPaint.volume=null;controlPaint.brightness=null;state.availableApps=[];closeWs();connectSelectedLocal();startFirebaseSessionLease();render();});

    dom.power?.addEventListener('click',()=>{
      const action = state.powerOn === false ? 'on' : 'off';
      state.powerOn = action === 'on';
      render();
      sendAction('power',{action});
    });
    dom.input?.addEventListener('click',()=>sendAction('input'));
    dom.keyboard?.addEventListener('click',openKeyboard);
    dom.keyboardBar?.addEventListener('submit',e=>e.preventDefault());
    const sendKeyboardEnter=()=>{const now=Date.now();if(now-(state.lastKeyboardEnterAt||0)<120)return;state.lastKeyboardEnterAt=now;sendKeyboardKey('enter');};
    dom.keyboardInput?.addEventListener('beforeinput',e=>{if(e.inputType==='insertLineBreak'||e.inputType==='insertParagraph'){e.preventDefault();sendKeyboardEnter();}});
    dom.keyboardInput?.addEventListener('input',handleKeyboardInput);
    dom.keyboardInput?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();sendKeyboardEnter();} });
    dom.back?.addEventListener('click',sendBack);
    dom.menu?.addEventListener('click',()=>sendAction('menu'));
    dom.home?.addEventListener('click',()=>sendAction('home'));
    dom.assistant?.addEventListener('click',()=>sendAction('assistant'));
    dom.settings?.addEventListener('click',()=>sendAction('settings'));
    dom.mute?.addEventListener('click',toggleMute);
    dom.volume?.addEventListener('input',()=>setVolume(dom.volume.value));
    dom.volDown?.addEventListener('click',()=>stepVolume(-1));
    dom.volUp?.addEventListener('click',()=>stepVolume(1));
    dom.brightness?.addEventListener('input',()=>setBrightness(dom.brightness.value));

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (dom.scanner?.classList.contains('is-open')) { stopQrScanner(); e.preventDefault(); return; }
      if (dom.appEditLayer?.classList.contains('is-open')) { closeAppEditor(); e.preventDefault(); return; }
      if (dom.appsLayer?.classList.contains('is-open')) { closeAppsModal(); e.preventDefault(); return; }
      if (dom.appContext?.classList.contains('is-open')) { closeAppContext(); e.preventDefault(); return; }
      if (dom.addLayer?.classList.contains('is-open')) { closeAddModal(); e.preventDefault(); return; }
      if (dom.modal?.classList.contains('is-open')) { close(); e.preventDefault(); }
    });
    document.addEventListener('visibilitychange',()=>{
      if (document.hidden) {
        if (state.modalOpen) {
          const d=selectedDevice(); if(d&&uid()) void globalThis.StarTabPresence?.setWatcher?.(uid(),'tv',d.deviceId,false,'tv-control');
        }
        if (!state.modalOpen) closeWs();
      } else {
        if (state.modalOpen) startFirebaseSessionLease();
        if (shouldKeepLocalWarm()) scheduleLocalReconnect(120);
      }
    });
    bindNavTouch();
  }

  function clearPendingControls() {
    for (const name of ['volumeTimer','brightnessTimer','motionTimer','scrollTimer','keyboardTimer']) { clearTimeout(state[name]); state[name]=0; }
    state.pendingVolume=null; state.pendingBrightness=null; state.motionDx=state.motionDy=state.scrollDy=0; state.keyboardBuffer='';
    for (const entry of directPending.values()) clearTimeout(entry.timer); directPending.clear();
  }
  window.addEventListener('online',()=>{closeWs();scheduleLocalReconnect(100);});
  window.addEventListener('pagehide',()=>{clearPendingControls();closeWs();});
  function boot() {
    injectUi(); state.selectedId=localStorage.getItem(SELECTED_KEY)||''; initFirebase();
    setInterval(()=>{if(shouldKeepLocalWarm()&&state.selectedId&&!state.wsReady&&!state.wsConnecting)connectSelectedLocal();},1500);
    setInterval(()=>{if(dom.modal?.classList.contains('is-open'))render();},1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true}); else boot();
})();
