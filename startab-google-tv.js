(() => {
  'use strict';

  const SELECTED_KEY = 'startab_google_tv_selected_v1';
  const PAIRINGS_KEY = 'startab_google_tv_pairings_v1';
  const QUICK_APPS_KEY = 'startab_google_tv_quick_apps_v1';
  const DEVICE_STALE_MS = 390_000;
  const FIREBASE_MOTION_MS = 95;
  const state = {
    db: null, auth: null, user: null, devices: new Map(), unsubscribe: null,
    selectedId: '', ws: null, wsReady: false, wsConnecting: false,
    motionDx: 0, motionDy: 0, motionTimer: 0, scrollDy: 0, scrollTimer: 0,
    volumeTimer: 0, pendingVolume: null, optimisticVolume: null, lastVolumeInputAt: 0, lastVolumeFirebaseAt: 0,
    brightnessTimer: 0, pendingBrightness: null, optimisticBrightness: null, lastBrightnessInputAt: 0, lastBrightnessFirebaseAt: 0,
    muted: false, powerOn: null,
    pointerId: null, lastX: 0, lastY: 0, moved: false, downAt: 0,
    longPressTimer: 0, longPressSent: false,
    cameraStream: null, scannerActive: false, scanTimer: 0, scanBusy: false, barcodeDetector: null,
    availableApps: [], appSearch: '', wsKeepAlive: 0, firebaseSessionTimer: 0, modalOpen: false,
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
    all[deviceId] = apps.slice(0, 12).map(a => ({ name:String(a.name||a.packageName||'App'), packageName:String(a.packageName||'') })).filter(a => a.packageName);
    localStorage.setItem(QUICK_APPS_KEY, JSON.stringify(all));
  }

  const ICONS = {
    remote: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="3"></rect><circle cx="12" cy="7" r="1.4"></circle><path d="M9.6 12h4.8M12 9.6v4.8"></path><path d="M9.5 17h.01M14.5 17h.01"></path></svg>',
    power: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v10"></path><path d="M6.3 5.7a8 8 0 1 0 11.4 0"></path></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1.03-1.56V3h4v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.56 1.03H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"></path></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6-6 6 6 6"></path><path d="M3 12h10a7 7 0 0 1 7 7"></path></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8"></path><path d="M5 10v10h14V10"></path><path d="M9 20v-6h6v6"></path></svg>',
    cursor: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3 19 13l-6 1 3 6-3 1-3-6-5 4Z"></path></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19Z"></path><path class="tv-volume-wave" d="M15 9.5a4 4 0 0 1 0 5"></path><path class="tv-volume-wave" d="M17.8 6.8a8 8 0 0 1 0 10.4"></path><path class="tv-muted-mark" d="m16 9 5 5m0-5-5 5"></path></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>',
    scan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h8v6H8z"></path></svg>'
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
        <section class="startab-tv-card startab-tv-remote-shell" role="dialog" aria-modal="true" aria-labelledby="startab-tv-title">
          <header class="startab-tv-head startab-tv-head-compact">
            <div class="startab-tv-head-brand">
              <span class="startab-tv-head-icon">${ICONS.remote}</span>
              <div class="startab-tv-head-copy">
                <h3 id="startab-tv-title">StarTab - Google TV</h3>
                <div class="startab-tv-head-status"><i id="startab-tv-led"></i><b id="startab-tv-status-title">Sin TV</b><span id="startab-tv-status-note">Selecciona o agrega un televisor.</span></div>
              </div>
            </div>
            <button id="startab-tv-close" class="startab-tv-close" type="button" aria-label="Cerrar">×</button>
          </header>

          <div class="startab-tv-body startab-tv-remote-body">
            <div class="startab-tv-empty" id="startab-tv-empty">
              <span>${ICONS.remote}</span><b>Agrega un Google TV</b><small>Usa el botón + de abajo para vincular por QR o por IP y PIN.</small>
            </div>

            <div class="startab-tv-remote-content" id="startab-tv-remote-content">
              <div class="startab-tv-navigation-stage">
                <button class="startab-tv-round-action startab-tv-power" id="startab-tv-power" type="button" data-tv-control aria-label="Encender o apagar TV">${ICONS.power}<span>Power</span></button>

                <div class="startab-tv-pad-v2" aria-label="Cruceta de navegación">
                  <button class="startab-tv-pad-key is-up" id="startab-tv-dpad-up" type="button" data-tv-control aria-label="Arriba"><svg viewBox="0 0 24 24"><path d="m6 14 6-6 6 6"></path></svg></button>
                  <button class="startab-tv-pad-key is-left" id="startab-tv-dpad-left" type="button" data-tv-control aria-label="Izquierda"><svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"></path></svg></button>
                  <button class="startab-tv-pad-ok" id="startab-tv-ok" type="button" data-tv-control>OK</button>
                  <button class="startab-tv-pad-key is-right" id="startab-tv-dpad-right" type="button" data-tv-control aria-label="Derecha"><svg viewBox="0 0 24 24"><path d="m10 6 6 6-6 6"></path></svg></button>
                  <button class="startab-tv-pad-key is-down" id="startab-tv-dpad-down" type="button" data-tv-control aria-label="Abajo"><svg viewBox="0 0 24 24"><path d="m6 10 6 6 6-6"></path></svg></button>
                </div>

                <button class="startab-tv-round-action startab-tv-settings" id="startab-tv-settings" type="button" data-tv-control aria-label="Abrir configuración del TV">${ICONS.settings}<span>Ajustes</span></button>
              </div>

              <div class="startab-tv-nav-row">
                <button id="startab-tv-back" type="button" data-tv-control>${ICONS.back}<span>Atrás</span></button>
                <button id="startab-tv-home" type="button" data-tv-control>${ICONS.home}<span>Home</span></button>
                <button id="startab-tv-cursor" type="button" data-tv-control>${ICONS.cursor}<span>Cursor</span></button>
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

          <footer class="startab-tv-footer startab-tv-footer-compact">
            <button class="startab-tv-add" id="startab-tv-add" type="button" aria-label="Agregar TV">${ICONS.plus}</button>
            <div class="startab-tv-device-select-wrap"><select id="startab-tv-device-select" aria-label="Google TV seleccionado"><option value="">Sin TVs vinculados</option></select></div>
          </footer>
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

        <div class="startab-tv-layer startab-tv-touchpad-layer" id="startab-tv-touchpad-layer" aria-hidden="true">
          <div class="startab-tv-layer-backdrop"></div>
          <section class="startab-tv-submodal startab-tv-touchpad-card" role="dialog" aria-modal="true" aria-labelledby="startab-tv-touchpad-title">
            <header><div><span>CONTROL DE CURSOR</span><h3 id="startab-tv-touchpad-title">Touchpad del TV</h3></div><button id="startab-tv-touchpad-close" type="button" aria-label="Cerrar">×</button></header>
            <div class="startab-tv-submodal-body startab-tv-touchpad-body">
              <div class="startab-tv-touch-wrap">
                <div class="startab-tv-touch" id="startab-tv-touch" tabindex="0"><div class="startab-tv-touch-grid"></div><span>Desliza para mover · toca o mantén para OK</span></div>
              </div>
            </div>
            <footer class="startab-tv-touchpad-footer"><span>Toque = OK · Mantener = OK · Deslizar = mover cursor</span></footer>
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
      'power','settings','dpad-up','dpad-down','dpad-left','dpad-right','ok','back','home','cursor','quick-apps',
      'mute','volume','volume-value','volume-fill','vol-down','vol-up','brightness','brightness-value',
      'add','add-layer','add-close','scan-btn','pair-ip','pair-pin','pair-btn',
      'touchpad-layer','touchpad-close','touch',
      'apps-layer','apps-close','app-search','apps-list',
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
  function isOnline(d) { return !!d?.online && Date.now() - Number(d.clientAt || 0) < DEVICE_STALE_MS; }

  function applyRemoteState(data = {}, force = false) {
    const now = performance.now();
    if (Number.isFinite(Number(data.volume)) && (force || now - state.lastVolumeInputAt > 320)) state.optimisticVolume = clamp(Number(data.volume), 0, 100);
    if (typeof data.muted === 'boolean') state.muted = data.muted;
    if (typeof data.powerOn === 'boolean') state.powerOn = data.powerOn;
    if (Number.isFinite(Number(data.brightnessLevel)) && (force || now - state.lastBrightnessInputAt > 260)) state.optimisticBrightness = clamp(Math.round(Number(data.brightnessLevel)), 0, 10);
  }

  function quickApps() {
    const remote = selectedDevice()?.quickApps;
    if (Array.isArray(remote)) return remote.filter(a=>a?.packageName).map(a=>({name:String(a.name||a.packageName),packageName:String(a.packageName)}));
    return readQuickApps(state.selectedId);
  }
  function appMark(name = '') {
    const n = String(name).trim();
    if (/youtube/i.test(n)) return '▶';
    if (/netflix/i.test(n)) return 'N';
    return (n[0] || 'A').toUpperCase();
  }
  function renderQuickApps() {
    if (!dom.quickApps) return;
    const apps = quickApps();
    const signature = `${state.selectedId}|${apps.map(a=>a.packageName).join('|')}`;
    if (dom.quickApps.dataset.signature === signature) return;
    dom.quickApps.dataset.signature = signature;
    dom.quickApps.innerHTML = '';
    apps.forEach(app => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'startab-tv-quick-app'; b.dataset.tvControl = '';
      b.innerHTML = `<span class="app-mark">${appMark(app.name)}</span><b>${escapeHtml(app.name || 'App')}</b>`;
      b.addEventListener('click', () => sendAction('launchApp', { packageName: app.packageName }));
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
        saveQuickApps(list);
        firebaseMerge({ quickApps:list.map(x=>({name:x.name,packageName:x.packageName})) }, 12000);
        if (dom.quickApps) dom.quickApps.dataset.signature='';
        renderQuickApps(); renderAppsList();
      });
      dom.appsList.appendChild(b);
    });
  }

  function render() {
    const d = selectedDevice();
    if (d) {
      const now = performance.now();
      if (Number.isFinite(Number(d.volume)) && (state.optimisticVolume == null || now - state.lastVolumeInputAt > 650)) state.optimisticVolume = clamp(Number(d.volume), 0, 100);
      if (Number.isFinite(Number(d.brightnessLevel)) && (state.optimisticBrightness == null || now - state.lastBrightnessInputAt > 650)) state.optimisticBrightness = clamp(Math.round(Number(d.brightnessLevel)), 0, 10);
      if (typeof d.muted === 'boolean') state.muted = d.muted;
      if (typeof d.powerOn === 'boolean') state.powerOn = d.powerOn;
      if (Array.isArray(d.appCatalog) && d.appCatalog.length && !state.availableApps.length) state.availableApps = d.appCatalog;
    }

    if (dom.deviceSelect) {
      const current = state.selectedId;
      dom.deviceSelect.innerHTML = '';
      if (!state.devices.size) dom.deviceSelect.add(new Option('Sin TVs vinculados', ''));
      else [...state.devices.values()].sort((a,b)=>String(a.deviceName).localeCompare(String(b.deviceName))).forEach(item => {
        const suffix = isOnline(item) ? '' : ' · sin conexión';
        dom.deviceSelect.add(new Option(`${item.deviceName || 'Google TV'}${suffix}`, item.deviceId));
      });
      dom.deviceSelect.value = state.devices.has(current) ? current : '';
    }

    const volume = state.optimisticVolume ?? Number(d?.volume ?? 0);
    if (dom.volume) dom.volume.value = String(Math.round(clamp(volume,0,100)));
    if (dom.volumeValue) dom.volumeValue.textContent = `${Math.round(clamp(volume,0,100))}%`;
    if (dom.volumeFill) dom.volumeFill.style.setProperty('--tv-volume', `${clamp(volume,0,100)}%`);
    dom.mute?.classList.toggle('is-muted', !!state.muted);
    dom.power?.classList.toggle('is-on', state.powerOn === true);

    const brightness = state.optimisticBrightness ?? Number(d?.brightnessLevel ?? 10);
    if (dom.brightness) dom.brightness.value = String(Math.round(clamp(brightness,0,10)));
    if (dom.brightnessValue) dom.brightnessValue.textContent = `${Math.round(clamp(brightness,0,10)) * 10}%`;
    dom.brightness?.style.setProperty('--tv-brightness', `${clamp(brightness,0,10) * 10}%`);
    document.querySelectorAll('.startab-tv-brightness-ticks i').forEach((el, i) => el.classList.toggle('is-active', i <= brightness));

    dom.empty?.classList.toggle('is-visible', !d);
    dom.remoteContent?.classList.toggle('is-hidden', !d);
    dom.modal?.querySelectorAll('[data-tv-control]').forEach(el => { el.disabled = !d; });
    renderQuickApps();

    if (!uid()) setStatus('error','Sin sesión','Inicia sesión en StarTab.');
    else if (!d && state.selectedId) setStatus('warn','Buscando TV','Sincronizando con Firebase…');
    else if (!d) setStatus('idle','Sin TV','Toca + para agregar uno.');
    else if (state.wsReady) setStatus('direct','Directo',`${d.deviceName || 'Google TV'} · LAN de baja latencia`);
    else if (isOnline(d)) setStatus('firebase','Firebase',`${d.deviceName || 'Google TV'} · conexión remota`);
    else setStatus('error','Sin conexión',`${d.deviceName || 'Google TV'} no está disponible.`);
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
    state.unsubscribe?.(); state.unsubscribe = null; state.devices.clear();
    const userId = uid(); if (!state.db || !userId) { render(); return; }
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

  function closeWs() {
    state.wsReady = false; state.wsConnecting = false;
    clearInterval(state.wsKeepAlive); state.wsKeepAlive = 0;
    try { state.ws?.close(); } catch (_) {} state.ws = null;
  }

  function startWsKeepAlive() {
    clearInterval(state.wsKeepAlive);
    state.wsKeepAlive = setInterval(() => { if (state.wsReady) wsSend({ t:'ping' }); }, 12000);
  }

  function localEndpoint(device) {
    const p = pairingFor(device?.deviceId || state.selectedId) || {};
    const ip = String(device?.localIp || p.ip || '').trim();
    const port = Number(device?.localPort || p.port || 8765);
    const secret = String(p.secret || '');
    return { ip, port, secret };
  }

  function connectSelectedLocal() {
    if (!state.modalOpen) return;
    const d = selectedDevice(); if (!d || state.wsConnecting || state.wsReady) return;
    const { ip, port, secret } = localEndpoint(d); if (!ip || !secret) return;
    state.wsConnecting = true;
    let ws;
    try { ws = new WebSocket(`ws://${ip}:${port}`); } catch (_) { state.wsConnecting = false; return; }
    state.ws = ws;
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} }, 1600);
    ws.onopen = () => { clearTimeout(timer); ws.send(JSON.stringify({ type:'hello', secret })); };
    ws.onmessage = ev => {
      try {
        const data = JSON.parse(ev.data || '{}');
        if (data.type === 'state' && data.ok) {
          state.wsReady = true; state.wsConnecting = false; applyRemoteState(data); startWsKeepAlive(); render();
        }
        if (data.type === 'ack') {
          if (Array.isArray(data.apps)) { state.availableApps = data.apps; renderAppsList(); }
          const hasState = Number.isFinite(Number(data.volume)) || Number.isFinite(Number(data.brightnessLevel)) || typeof data.muted === 'boolean' || typeof data.powerOn === 'boolean';
          if (hasState) { applyRemoteState(data); render(); }
        }
      } catch (_) {}
    };
    ws.onerror = () => {};
    ws.onclose = () => { clearTimeout(timer); if (state.ws === ws) { state.ws = null; state.wsReady = false; state.wsConnecting = false; clearInterval(state.wsKeepAlive); state.wsKeepAlive=0; render(); } };
  }

  function wsSend(obj) {
    if (!state.wsReady || state.ws?.readyState !== WebSocket.OPEN) return false;
    try { state.ws.send(JSON.stringify({ ...obj, secret: pairingFor(state.selectedId)?.secret || '' })); return true; } catch (_) { return false; }
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
  function closeTouchpad() { dom.touchpadLayer?.classList.remove('is-open'); dom.touchpadLayer?.setAttribute('aria-hidden','true'); }
  function openTouchpad() { if (!selectedDevice()) return; dom.touchpadLayer?.classList.add('is-open'); dom.touchpadLayer?.setAttribute('aria-hidden','false'); }
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

  async function firebaseMerge(payload, leaseMs = 12000) {
    const d = selectedDevice(); if (!d || !state.db || !uid()) return false;
    const lease = { id: unique(), clientAt: Date.now(), expiresAtClient: Date.now() + leaseMs };
    try { await state.db.collection('users').doc(uid()).collection('tvDevices').doc(d.deviceId).set({ ...payload, controlLease: lease }, { merge:true }); return true; } catch (_) { return false; }
  }

  function sendAction(type, extra = {}) {
    globalThis.StartabHaptics?.click?.();
    if (wsSend({ t:type, ...extra })) return;
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

  function sendBack() { if (wsSend({t:'back'})) return; firebaseMerge({backCommand:{id:unique(),clientAt:Date.now()}}); }

  function setVolume(value) {
    value=Math.round(clamp(value,0,100)); state.optimisticVolume=value; state.lastVolumeInputAt=performance.now();
    if(dom.volume)dom.volume.value=String(value); if(dom.volumeValue)dom.volumeValue.textContent=`${value}%`; if(dom.volumeFill)dom.volumeFill.style.setProperty('--tv-volume',`${value}%`);
    if (wsSend({t:'volume',value})) return;
    state.pendingVolume=value;
    const now=performance.now(), elapsed=now-state.lastVolumeFirebaseAt;
    if (elapsed>=60) { state.lastVolumeFirebaseAt=now; const v=state.pendingVolume;state.pendingVolume=null;firebaseMerge({volumeCommand:{id:unique(),value:v,clientAt:Date.now()}}); return; }
    clearTimeout(state.volumeTimer); state.volumeTimer=setTimeout(()=>{state.lastVolumeFirebaseAt=performance.now();const v=state.pendingVolume;state.pendingVolume=null;if(v!=null)firebaseMerge({volumeCommand:{id:unique(),value:v,clientAt:Date.now()}});},Math.max(0,60-elapsed));
  }

  function toggleMute() {
    state.muted = !state.muted; render();
    if (wsSend({t:'mute', muted:state.muted})) return;
    firebaseMerge({ actionCommand:{ id:unique(), type:'mute', muted:state.muted, clientAt:Date.now() } });
  }

  function setBrightness(level) {
    level = Math.round(clamp(level,0,10)); state.optimisticBrightness = level; state.lastBrightnessInputAt=performance.now(); render();
    if (wsSend({t:'brightness', level})) return;
    state.pendingBrightness=level; const now=performance.now(), elapsed=now-state.lastBrightnessFirebaseAt;
    if(elapsed>=70){state.lastBrightnessFirebaseAt=now;const v=state.pendingBrightness;state.pendingBrightness=null;firebaseMerge({actionCommand:{id:unique(),type:'brightness',level:v,clientAt:Date.now()}});return;}
    clearTimeout(state.brightnessTimer); state.brightnessTimer=setTimeout(()=>{state.lastBrightnessFirebaseAt=performance.now();const v=state.pendingBrightness;state.pendingBrightness=null;if(v!=null)firebaseMerge({actionCommand:{id:unique(),type:'brightness',level:v,clientAt:Date.now()}});},Math.max(0,70-elapsed));
  }

  function bindTouch() {
    dom.touch?.addEventListener('pointerdown', e => {
      if(state.pointerId!==null)return;
      state.pointerId=e.pointerId; state.lastX=e.clientX; state.lastY=e.clientY; state.moved=false; state.longPressSent=false; state.downAt=performance.now();
      clearTimeout(state.longPressTimer);
      state.longPressTimer=setTimeout(()=>{ if(state.pointerId===e.pointerId && !state.moved){ state.longPressSent=true; sendAction('ok'); } }, 620);
      dom.touch.setPointerCapture?.(e.pointerId); e.preventDefault();
    });
    dom.touch?.addEventListener('pointermove', e => {
      if(e.pointerId!==state.pointerId)return;
      const dx=e.clientX-state.lastX,dy=e.clientY-state.lastY; state.lastX=e.clientX; state.lastY=e.clientY;
      if(Math.abs(dx)+Math.abs(dy)>.8){ state.moved=true; clearTimeout(state.longPressTimer); }
      sendMove(dx*1.45,dy*1.45); e.preventDefault();
    });
    const finish=e=>{
      if(e.pointerId!==state.pointerId)return;
      clearTimeout(state.longPressTimer);
      try{dom.touch.releasePointerCapture?.(e.pointerId)}catch(_){}
      const tap=!state.moved&&!state.longPressSent&&performance.now()-state.downAt<620;
      state.pointerId=null; if(tap)sendAction('ok'); e.preventDefault();
    };
    dom.touch?.addEventListener('pointerup',finish); dom.touch?.addEventListener('pointercancel',finish);
  }

  function stopFirebaseSessionLease() { clearInterval(state.firebaseSessionTimer); state.firebaseSessionTimer=0; }
  function startFirebaseSessionLease() {
    stopFirebaseSessionLease();
    const tick=()=>{ if(state.modalOpen && !state.wsReady && selectedDevice()) firebaseMerge({},25000); };
    setTimeout(tick,700); state.firebaseSessionTimer=setInterval(tick,20000);
  }

  function bindUi() {
    dom.toggle = $('startab-tv-toggle');
    dom.toggle?.addEventListener('click',()=>{ state.modalOpen=true; dom.modal?.classList.add('is-open'); dom.modal?.setAttribute('aria-hidden','false'); document.documentElement.classList.add('startab-tv-modal-open'); connectSelectedLocal(); startFirebaseSessionLease(); render(); });
    const close=()=>{ state.modalOpen=false; stopFirebaseSessionLease(); closeWs(); stopQrScanner(); closeAddModal(); closeTouchpad(); closeAppsModal(); dom.modal?.classList.remove('is-open'); dom.modal?.setAttribute('aria-hidden','true'); document.documentElement.classList.remove('startab-tv-modal-open'); };
    dom.close?.addEventListener('click',close); dom.backdrop?.addEventListener('click',close);

    dom.add?.addEventListener('click',openAddModal); dom.addClose?.addEventListener('click',closeAddModal); dom.addLayer?.querySelector('.startab-tv-layer-backdrop')?.addEventListener('click',closeAddModal);
    dom.scanBtn?.addEventListener('click',openQrScanner);
    dom.pairBtn?.addEventListener('click',()=>pairTv({ip:dom.pairIp?.value||'',pin:dom.pairPin?.value||'',port:8765}));
    dom.pairPin?.addEventListener('keydown',e=>{if(e.key==='Enter')dom.pairBtn?.click();});

    dom.touchpadClose?.addEventListener('click',closeTouchpad); dom.touchpadLayer?.querySelector('.startab-tv-layer-backdrop')?.addEventListener('click',closeTouchpad);
    dom.cursor?.addEventListener('click',openTouchpad);
    dom.appsClose?.addEventListener('click',closeAppsModal); dom.appsLayer?.querySelector('.startab-tv-layer-backdrop')?.addEventListener('click',closeAppsModal);
    dom.appSearch?.addEventListener('input',()=>{state.appSearch=dom.appSearch.value||'';renderAppsList();});

    dom.scannerClose?.addEventListener('click',stopQrScanner); dom.scannerCancel?.addEventListener('click',stopQrScanner); dom.scanner?.querySelector('.startab-tv-scanner-backdrop')?.addEventListener('click',stopQrScanner);
    dom.deviceSelect?.addEventListener('change',()=>{state.selectedId=dom.deviceSelect.value||'';localStorage.setItem(SELECTED_KEY,state.selectedId);state.optimisticVolume=null;state.optimisticBrightness=null;state.availableApps=[];closeWs();connectSelectedLocal();startFirebaseSessionLease();render();});

    dom.power?.addEventListener('click',()=>{ state.powerOn = state.powerOn == null ? false : !state.powerOn; render(); sendAction('power',{action:'toggle'}); });
    dom.settings?.addEventListener('click',()=>sendAction('settings'));
    dom.dpadUp?.addEventListener('click',()=>sendAction('dpad',{direction:'up'}));
    dom.dpadDown?.addEventListener('click',()=>sendAction('dpad',{direction:'down'}));
    dom.dpadLeft?.addEventListener('click',()=>sendAction('dpad',{direction:'left'}));
    dom.dpadRight?.addEventListener('click',()=>sendAction('dpad',{direction:'right'}));
    dom.ok?.addEventListener('click',()=>sendAction('ok'));
    dom.back?.addEventListener('click',sendBack);
    dom.home?.addEventListener('click',()=>sendAction('home'));
    dom.mute?.addEventListener('click',toggleMute);
    dom.volume?.addEventListener('input',()=>setVolume(dom.volume.value));
    dom.volDown?.addEventListener('click',()=>setVolume((state.optimisticVolume ?? Number(selectedDevice()?.volume||0))-1));
    dom.volUp?.addEventListener('click',()=>setVolume((state.optimisticVolume ?? Number(selectedDevice()?.volume||0))+1));
    dom.brightness?.addEventListener('input',()=>setBrightness(dom.brightness.value));

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (dom.scanner?.classList.contains('is-open')) { stopQrScanner(); e.preventDefault(); return; }
      if (dom.touchpadLayer?.classList.contains('is-open')) { closeTouchpad(); e.preventDefault(); return; }
      if (dom.appsLayer?.classList.contains('is-open')) { closeAppsModal(); e.preventDefault(); return; }
      if (dom.addLayer?.classList.contains('is-open')) { closeAddModal(); e.preventDefault(); return; }
      if (dom.modal?.classList.contains('is-open')) { close(); e.preventDefault(); }
    });
    bindTouch();
  }

  function boot() {
    injectUi(); state.selectedId=localStorage.getItem(SELECTED_KEY)||''; initFirebase();
    setInterval(()=>{if(state.modalOpen&&state.selectedId&&!state.wsReady)connectSelectedLocal();},1200);
    setInterval(()=>{if(dom.modal?.classList.contains('is-open'))render();},10000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true}); else boot();
})();
