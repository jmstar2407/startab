(() => {
  'use strict';

  const MOBILE_QUERY = '(max-width: 760px), (hover: none) and (pointer: coarse)';
  const state = {
    mode: 'media',
    mediaPane: null,
    pcPane: null,
    tvPane: null,
    morePane: null,
    nav: null,
    panel: null,
    main: null,
    footer: null,
    mediaHome: null,
    pcModal: null,
    touchpadModal: null,
    tvModal: null,
    mediaObserver: null,
    statusTimer: 0,
    windowsWatchedId: '',
    headerDeviceHost: null,
    headerPcShell: null,
    headerTvShell: null,
  };

  const $ = (id) => document.getElementById(id);

  const ICONS = {
    media: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="4"></rect><path d="m10 9 5 3-5 3Z"></path></svg>',
    pc: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2.5"></rect><path d="M8 21h8M12 17v4"></path><path d="M7 8h10"></path></svg>',
    tv: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="13" rx="2.5"></rect><path d="M8 21h8M12 18v3"></path><path d="m9 2 3 3 3-3"></path></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7"></circle><circle cx="12" cy="12" r="1.7"></circle><circle cx="19" cy="12" r="1.7"></circle></svg>',
    mouse: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="6"></rect><path d="M12 3v6"></path><path d="M6 10h12"></path></svg>',
    volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M18 6a8 8 0 0 1 0 12"></path></svg>',
  };

  function currentUser() {
    try {
      const user = globalThis.firebase?.auth?.()?.currentUser;
      if (user?.uid) return user;
    } catch (_) {}
    try {
      const parsed = JSON.parse(localStorage.getItem('starTab_lastUser') || 'null');
      return parsed?.uid ? parsed : null;
    } catch (_) { return null; }
  }

  function selectedWindowsDeviceId() {
    const select = $('windows-device-select');
    if (select?.value) return String(select.value);
    try {
      const saved = JSON.parse(localStorage.getItem('startab_windows_volume_selected_device_v2') || 'null');
      return String(saved?.deviceId || '');
    } catch (_) { return ''; }
  }

  function selectedPcLabel() {
    const select = $('windows-device-select');
    const option = select?.selectedOptions?.[0];
    return option?.textContent?.replace(/\s·\s(?:Directo|Firebase|En línea|Standby|Sin respuesta|No disponible).*$/i, '').trim() || 'PC seleccionado';
  }

  function selectedTvLabel() {
    const select = $('startab-tv-device-select');
    const option = select?.selectedOptions?.[0];
    return option?.textContent?.replace(/\s·\s(?:Directo|Firebase|Standby|Sin respuesta|No disponible|sin conexión)$/i, '').trim() || 'Google TV';
  }

  async function setMediaWindowsWatcher(active) {
    const user = currentUser();
    const id = selectedWindowsDeviceId();
    if (state.windowsWatchedId && (!active || state.windowsWatchedId !== id)) {
      try { await globalThis.StarTabPresence?.setWatcher?.(user?.uid || '', 'windows', state.windowsWatchedId, false); } catch (_) {}
      state.windowsWatchedId = '';
    }
    if (!active || !user?.uid || !id || document.hidden) return;
    state.windowsWatchedId = id;
    try { await globalThis.StarTabPresence?.setWatcher?.(user.uid, 'windows', id, true); } catch (_) {}
  }

  function makeNavButton(mode, label, icon) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'startab-control-mode';
    button.dataset.mode = mode;
    button.dataset.availability = mode === 'media' || mode === 'more' ? 'available' : 'unknown';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = `<span class="startab-control-mode-icon">${icon}<i aria-hidden="true"></i></span><span class="startab-control-mode-label">${label}</span>`;
    return button;
  }

  function buildNav() {
    const actions = document.querySelector('.multimedia-topbar-actions');
    if (!actions || $('startab-control-nav')) return;
    const nav = document.createElement('nav');
    nav.id = 'startab-control-nav';
    nav.className = 'startab-control-nav';
    nav.setAttribute('aria-label', 'Modos del Centro de control');
    nav.append(
      makeNavButton('media', 'Multimedia', ICONS.media),
      makeNavButton('pc', 'PC', ICONS.pc),
      makeNavButton('tv', 'TV', ICONS.tv),
      makeNavButton('more', 'Más', ICONS.more),
    );
    const sync = $('multimedia-sync-pill');
    actions.insertBefore(nav, sync || actions.firstChild);
    nav.addEventListener('click', (event) => {
      const button = event.target.closest('[data-mode]');
      if (!button) return;
      switchMode(button.dataset.mode);
    });
    state.nav = nav;
  }

  function buildHeaderDeviceHost() {
    const topbar = document.querySelector('.multimedia-topbar');
    const actions = document.querySelector('.multimedia-topbar-actions');
    if (!topbar || !actions) return null;

    let host = $('startab-control-header-device');
    if (!host) {
      host = document.createElement('div');
      host.id = 'startab-control-header-device';
      host.className = 'startab-control-header-device';
      host.setAttribute('aria-label', 'Dispositivo seleccionado');
      host.innerHTML = `
        <div class="startab-control-header-select-shell" data-device-kind="pc" hidden>
          <span class="startab-control-header-device-icon" aria-hidden="true">${ICONS.pc}<i id="startab-control-header-pc-dot"></i></span>
          <div class="startab-control-header-select-slot" id="startab-control-header-pc-slot"></div>
        </div>
        <div class="startab-control-header-select-shell" data-device-kind="tv" hidden>
          <span class="startab-control-header-device-icon is-tv" aria-hidden="true">${ICONS.tv}<i id="startab-control-header-tv-dot"></i></span>
          <div class="startab-control-header-select-slot" id="startab-control-header-tv-slot"></div>
        </div>`;
      topbar.insertBefore(host, actions);
    }
    state.headerDeviceHost = host;
    state.headerPcShell = host.querySelector('[data-device-kind="pc"]');
    state.headerTvShell = host.querySelector('[data-device-kind="tv"]');
    return host;
  }

  function mountHeaderDeviceSelectors() {
    const host = buildHeaderDeviceHost();
    if (!host) return;

    const pcSelect = $('windows-device-select');
    const pcSlot = $('startab-control-header-pc-slot');
    if (pcSelect && pcSlot && pcSelect.parentElement !== pcSlot) pcSlot.appendChild(pcSelect);

    const tvSelect = $('startab-tv-device-select');
    const tvSlot = $('startab-control-header-tv-slot');
    if (tvSelect && tvSlot && tvSelect.parentElement !== tvSlot) tvSlot.appendChild(tvSelect);

    const oldPcWrap = document.querySelector('.windows-volume-device-wrap');
    if (oldPcWrap && !oldPcWrap.querySelector('select')) oldPcWrap.classList.add('startab-control-device-wrap-without-select');
    const oldTvWrap = document.querySelector('.startab-tv-device-select-head');
    if (oldTvWrap && !oldTvWrap.querySelector('select')) oldTvWrap.classList.add('startab-control-device-wrap-without-select');
  }

  function updateHeaderDeviceSelector(mode = state.mode) {
    mountHeaderDeviceSelectors();
    const pcVisible = mode !== 'tv';
    const tvVisible = mode === 'tv';
    if (state.headerPcShell) state.headerPcShell.hidden = !pcVisible;
    if (state.headerTvShell) state.headerTvShell.hidden = !tvVisible;
    if (state.headerDeviceHost) state.headerDeviceHost.hidden = !(pcVisible || tvVisible);
  }

  function buildPanes() {
    state.panel = document.querySelector('.multimedia-modal-panel');
    state.main = document.querySelector('.multimedia-main');
    if (!state.panel || !state.main || $('startab-control-pane-media')) return;

    state.panel.classList.add('startab-control-center-panel');
    state.main.classList.add('startab-control-center-main');

    const mediaPane = document.createElement('section');
    mediaPane.id = 'startab-control-pane-media';
    mediaPane.className = 'startab-control-pane startab-control-pane-media is-active';
    mediaPane.dataset.controlPane = 'media';

    const pcPane = document.createElement('section');
    pcPane.id = 'startab-control-pane-pc';
    pcPane.className = 'startab-control-pane startab-control-pane-pc';
    pcPane.dataset.controlPane = 'pc';
    pcPane.innerHTML = `
      <div class="startab-control-pc-touchpad-slot" id="startab-control-pc-touchpad-slot"></div>
      <div class="startab-control-pc-system-slot" id="startab-control-pc-system-slot"></div>
      <div class="startab-control-volume-slot" id="startab-control-pc-volume-slot"></div>`;

    const tvPane = document.createElement('section');
    tvPane.id = 'startab-control-pane-tv';
    tvPane.className = 'startab-control-pane startab-control-pane-tv';
    tvPane.dataset.controlPane = 'tv';
    tvPane.innerHTML = '<div class="startab-control-loading"><span></span><strong>Preparando Google TV</strong><small>Sincronizando el control remoto…</small></div>';

    const morePane = document.createElement('section');
    morePane.id = 'startab-control-pane-more';
    morePane.className = 'startab-control-pane startab-control-pane-more';
    morePane.dataset.controlPane = 'more';
    morePane.innerHTML = `
      <div class="startab-control-more-head"><span>STARTAB</span><h3>Dispositivos y conexión</h3><p>Consulta rápidamente qué equipos están disponibles sin perder el contexto del Centro de control.</p></div>
      <div class="startab-control-more-grid">
        <button type="button" data-jump-mode="pc" class="startab-control-device-card"><span class="startab-control-device-icon">${ICONS.pc}</span><span><strong id="startab-more-pc-name">PC seleccionado</strong><small id="startab-more-pc-state">Comprobando…</small></span><i id="startab-more-pc-dot"></i></button>
        <button type="button" data-jump-mode="tv" class="startab-control-device-card"><span class="startab-control-device-icon">${ICONS.tv}</span><span><strong id="startab-more-tv-name">Google TV</strong><small id="startab-more-tv-state">Comprobando…</small></span><i id="startab-more-tv-dot"></i></button>
      </div>`;
    morePane.addEventListener('click', (event) => {
      const target = event.target.closest('[data-jump-mode]');
      if (target) switchMode(target.dataset.jumpMode);
    });

    const topbar = state.main.querySelector('.multimedia-topbar');
    const movable = [
      $('multimedia-empty'),
      $('multimedia-player'),
      $('multimedia-system-footer'),
    ].filter(Boolean);
    movable.forEach((node) => mediaPane.appendChild(node));
    const mobileSourceSlot = $('multimedia-mobile-source-slot');
    if (mobileSourceSlot) mediaPane.prepend(mobileSourceSlot);
    topbar.after(mediaPane, pcPane, tvPane, morePane);

    state.mediaPane = mediaPane;
    state.pcPane = pcPane;
    state.tvPane = tvPane;
    state.morePane = morePane;
    state.mediaHome = mediaPane;
    state.footer = $('multimedia-system-footer');

  }

  function embedPcModal() {
    const modal = $('windows-pc-control-modal');
    const slot = $('startab-control-pc-system-slot');
    if (!modal || !slot || modal.classList.contains('startab-control-embedded')) return false;
    modal.classList.add('startab-control-embedded');
    slot.appendChild(modal);
    state.pcModal = modal;
    return true;
  }


  function embedTouchpadModal() {
    const modal = $('windows-touchpad-modal');
    const slot = $('startab-control-pc-touchpad-slot');
    if (!modal || !slot) return false;
    if (modal.parentElement !== slot) slot.appendChild(modal);
    modal.classList.add('startab-control-touchpad-embedded');
    state.touchpadModal = modal;
    return true;
  }

  function embedTvModal() {
    const modal = $('startab-tv-modal');
    if (!modal || !state.tvPane || modal.classList.contains('startab-tv-embedded')) return false;
    state.tvPane.innerHTML = '';
    modal.classList.add('startab-tv-embedded');
    state.tvPane.appendChild(modal);
    state.tvModal = modal;
    return true;
  }

  function ensureEmbedded() {
    embedPcModal();
    embedTvModal();
    mountHeaderDeviceSelectors();
    if ($('windows-touchpad-modal')?.classList.contains('is-open')) embedTouchpadModal();
  }

  function setVolumeHome(mode) {
    if (!state.footer) state.footer = $('multimedia-system-footer');
    const footer = state.footer;
    if (!footer) return;
    const wasPcMode = footer.classList.contains('is-pc-mode');
    const destination = mode === 'pc' ? $('startab-control-pc-volume-slot') : state.mediaPane;
    if (destination && footer.parentElement !== destination) destination.appendChild(footer);
    footer.classList.toggle('is-pc-mode', mode === 'pc');
    const toggle = $('multimedia-system-volume-toggle');
    // PC uses the same compact bottom bar as Multimedia. Never force it open.
    if (wasPcMode !== (mode === 'pc') && toggle?.getAttribute('aria-expanded') === 'true') toggle.click();
  }


  function activateTouchpad(active) {
    const modal = $('windows-touchpad-modal');
    if (!modal) return;
    const isOpen = modal.classList.contains('is-open');
    if (active && !isOpen) {
      $('multimedia-cursor-toggle')?.click();
      // openModal() marks it open synchronously before starting WebRTC/Firebase setup.
      embedTouchpadModal();
    } else if (active) {
      embedTouchpadModal();
    } else if (!active && isOpen) {
      $('windows-touchpad-close')?.click();
    }
  }

  function activatePc(active) {
    ensureEmbedded();
    const modal = $('windows-pc-control-modal');
    if (!modal) return;
    const isOpen = modal.classList.contains('is-open');
    if (active && !isOpen) {
      const toggle = document.querySelector('[data-windows-pc-control-toggle]');
      toggle?.click();
    } else if (!active && isOpen) {
      $('windows-pc-control-close')?.click();
    }
  }

  function activateTv(active) {
    ensureEmbedded();
    const modal = $('startab-tv-modal');
    if (!modal) return;
    const isOpen = modal.classList.contains('is-open');
    if (active && !isOpen) $('startab-tv-toggle')?.click();
    else if (!active && isOpen) $('startab-tv-close')?.click();
  }

  function updateTopbar() {
    const title = document.querySelector('.multimedia-topbar-copy strong');
    const sub = document.querySelector('.multimedia-topbar-copy span');
    if (title && title.textContent !== 'Centro de control') title.textContent = 'Centro de control';
    if (sub && sub.textContent !== 'Multimedia, PC y Google TV en un solo espacio') sub.textContent = 'Multimedia, PC y Google TV en un solo espacio';
  }

  function switchMode(mode = 'media') {
    if (!['media', 'pc', 'tv', 'more'].includes(mode)) mode = 'media';
    ensureEmbedded();
    const previous = state.mode;
    state.mode = mode;
    state.panel?.setAttribute('data-control-mode', mode);
    document.documentElement.dataset.startabControlMode = mode;

    document.querySelectorAll('[data-control-pane]').forEach((pane) => pane.classList.toggle('is-active', pane.dataset.controlPane === mode));
    state.nav?.querySelectorAll('[data-mode]').forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });

    if (previous === 'pc' && mode !== 'pc') { activateTouchpad(false); activatePc(false); }
    if (previous === 'tv' && mode !== 'tv') activateTv(false);

    if (mode === 'pc') {
      setVolumeHome('pc');
      activateTouchpad(true);
      activatePc(true);
      void setMediaWindowsWatcher(false);
    } else {
      setVolumeHome('media');
      if (mode === 'tv') activateTv(true);
      if (mode === 'media') void setMediaWindowsWatcher(true);
      else void setMediaWindowsWatcher(false);
    }

    updateTopbar();
    updateHeaderDeviceSelector(mode);
    updateStatuses();
    window.dispatchEvent(new Event('resize'));
  }

  function pcStatus() {
    const card = $('windows-system-volume');
    const statusText = $('windows-volume-status-text')?.textContent || '';
    const data = card?.dataset.state || 'empty';
    if (/sin respuesta/i.test(statusText)) return { key: 'unresponsive', text: 'Sin respuesta' };
    if (/standby/i.test(statusText)) return { key: 'standby', text: 'Standby' };
    if (data === 'online') return { key: 'online', text: 'En línea' };
    if (data === 'signed-out') return { key: 'offline', text: 'Sin sesión' };
    if (data === 'empty') return { key: 'offline', text: 'Sin PC seleccionado' };
    return { key: 'offline', text: 'No disponible' };
  }

  function tvStatus() {
    const title = $('startab-tv-status-title')?.textContent || '';
    const led = $('startab-tv-led')?.dataset.state || 'idle';
    if (/sin respuesta/i.test(title)) return { key: 'unresponsive', text: 'Sin respuesta' };
    if (/standby/i.test(title)) return { key: 'standby', text: 'Standby' };
    if (led === 'direct' || led === 'firebase') return { key: 'online', text: title || 'En línea' };
    if (led === 'warn' && /standby/i.test(title)) return { key: 'standby', text: 'Standby' };
    return { key: 'offline', text: title && !/sin tv|buscando/i.test(title) ? title : 'No disponible' };
  }

  function paintModeStatus(mode, status, label) {
    const button = state.nav?.querySelector(`[data-mode="${mode}"]`);
    if (!button) return;
    const availability = status.key === 'online' ? 'available' : status.key;
    button.dataset.availability = availability;
    button.title = `${label} · ${status.text}`;
    button.setAttribute('aria-label', `${label}. ${status.text}`);
  }

  function enhanceVolumeToggle() {
    const toggle = $('multimedia-system-volume-toggle');
    if (!toggle || toggle.querySelector('.startab-control-volume-meta')) return;
    const text = toggle.querySelector('span:nth-of-type(2)');
    if (text) text.textContent = 'Volumen del PC';
    const meta = document.createElement('span');
    meta.className = 'startab-control-volume-meta';
    meta.innerHTML = '<b id="startab-control-volume-device">PC seleccionado</b><small id="startab-control-volume-value">0%</small>';
    toggle.insertBefore(meta, toggle.querySelector('.multimedia-system-volume-chevron'));
  }

  function updateStatuses() {
    enhanceVolumeToggle();
    const pc = pcStatus();
    const tv = tvStatus();
    const pcName = selectedPcLabel();
    const tvName = selectedTvLabel();
    paintModeStatus('pc', pc, pcName);
    paintModeStatus('tv', tv, tvName);
    const headerPcDot = $('startab-control-header-pc-dot');
    const headerTvDot = $('startab-control-header-tv-dot');
    if (headerPcDot) headerPcDot.dataset.state = pc.key;
    if (headerTvDot) headerTvDot.dataset.state = tv.key;

    const volDevice = $('startab-control-volume-device');
    const volValue = $('startab-control-volume-value');
    if (volDevice) volDevice.textContent = pcName;
    if (volValue) volValue.textContent = $('windows-volume-dial-value')?.textContent || $('windows-volume-value')?.textContent || '0%';

    const morePcName = $('startab-more-pc-name');
    const morePcState = $('startab-more-pc-state');
    const morePcDot = $('startab-more-pc-dot');
    if (morePcName) morePcName.textContent = pcName;
    if (morePcState) morePcState.textContent = pc.text;
    if (morePcDot) morePcDot.dataset.state = pc.key;

    const moreTvName = $('startab-more-tv-name');
    const moreTvState = $('startab-more-tv-state');
    const moreTvDot = $('startab-more-tv-dot');
    if (moreTvName) moreTvName.textContent = tvName;
    if (moreTvState) moreTvState.textContent = tv.text;
    if (moreTvDot) moreTvDot.dataset.state = tv.key;

    updateTopbar();
    updateHeaderDeviceSelector(state.mode);
  }

  function handleModalVisibility() {
    const modal = $('multimedia-modal');
    if (!modal) return;
    const opened = modal.classList.contains('is-open');
    if (opened) {
      ensureEmbedded();
      switchMode(state.mode || 'media');
    } else {
      activateTouchpad(false);
      activatePc(false);
      activateTv(false);
      void setMediaWindowsWatcher(false);
    }
  }

  function bindGlobalEvents() {
    const modal = $('multimedia-modal');
    if (modal) {
      state.mediaObserver = new MutationObserver(handleModalVisibility);
      state.mediaObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });
    }

    $('windows-device-select')?.addEventListener('change', () => {
      if (state.mode === 'media' && $('multimedia-modal')?.classList.contains('is-open')) void setMediaWindowsWatcher(true);
      setTimeout(updateStatuses, 30);
    });
    $('startab-tv-device-select')?.addEventListener('change', () => setTimeout(updateStatuses, 30));
    window.addEventListener('startab-device-selection-change', () => setTimeout(updateStatuses, 30));
    window.addEventListener('startab-presence-connection', updateStatuses);
    document.addEventListener('visibilitychange', () => {
      if (!$('multimedia-modal')?.classList.contains('is-open')) return;
      if (state.mode === 'media') void setMediaWindowsWatcher(!document.hidden);
    });

    document.addEventListener('pointerdown', (event) => {
      if (state.mode !== 'pc' && state.mode !== 'media') return;
      const footer = state.footer || $('multimedia-system-footer');
      const toggle = $('multimedia-system-volume-toggle');
      if (!footer?.classList.contains('is-expanded')) return;
      if (footer.contains(event.target)) return;
      if (toggle?.getAttribute('aria-expanded') === 'true') toggle.click();
    }, { capture: true });

    state.statusTimer = window.setInterval(() => {
      ensureEmbedded();
      updateStatuses();
    }, 650);
  }

  function relabel() {
    const modalTitle = $('multimedia-modal-title');
    if (modalTitle) modalTitle.textContent = 'Centro de control';
    const kicker = document.querySelector('.multimedia-sidebar-head .multimedia-kicker');
    if (kicker) kicker.textContent = 'StarTab · CONTROL CENTER';
    const copy = document.querySelector('.multimedia-sidebar-head p');
    if (copy) copy.textContent = 'Multimedia, Windows y Google TV en un solo espacio.';
    const button = $('multimedia-button');
    if (button) { button.title = 'Centro de control'; button.setAttribute('aria-label', 'Centro de control'); }
    const tooltip = $('multimedia-tooltip');
    if (tooltip) tooltip.textContent = 'Centro de control';
    updateTopbar();
  }

  function boot() {
    relabel();
    buildNav();
    buildHeaderDeviceHost();
    buildPanes();
    enhanceVolumeToggle();

    let attempts = 0;
    const waitForDynamic = () => {
      ensureEmbedded();
      updateStatuses();
      attempts += 1;
      if ((!state.pcModal || !state.tvModal) && attempts < 80) setTimeout(waitForDynamic, 100);
    };
    waitForDynamic();
    bindGlobalEvents();
    switchMode('media');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
