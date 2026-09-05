(() => {
  'use strict';

  const HISTORY_PAGE_SIZE = 250;
  const state = {
    overlay: null,
    panel: null,
    button: null,
    list: null,
    search: null,
    status: null,
    currentUser: null,
    entries: [],
    loading: false,
    lastDoc: null,
    hasMore: true,
    historyMode: false,
    unsubscribeAuth: null,
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char]));

  function getFirebase() {
    if (typeof firebase === 'undefined' || !firebase.apps?.length) return null;
    return firebase;
  }

  function getSavedUser() {
    try {
      const raw = localStorage.getItem('starTab_lastUser');
      if (!raw) return null;
      const user = JSON.parse(raw);
      return user?.uid ? user : null;
    } catch (_) {
      return null;
    }
  }

  function getCurrentIdentity(fb) {
    return fb?.auth?.().currentUser || getSavedUser() || null;
  }

  function formatDateKey(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(date, today)) return 'Hoy';
    if (sameDay(date, yesterday)) return 'Ayer';
    return new Intl.DateTimeFormat('es-DO', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(date);
  }

  function formatTime(timestamp) {
    return new Intl.DateTimeFormat('es-DO', {
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
    }).format(new Date(timestamp));
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function fallbackFavicon(entry) {
    if (entry.favicon && /^https?:|^data:image\//i.test(entry.favicon)) return entry.favicon;
    try {
      const host = new URL(entry.url).hostname;
      return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`;
    } catch (_) {
      return '';
    }
  }

  function entryTimestamp(entry) {
    if (Number.isFinite(Number(entry.clientAt))) return Number(entry.clientAt);
    const visitedAt = entry.visitedAt;
    if (visitedAt?.toMillis) return visitedAt.toMillis();
    if (Number.isFinite(Number(visitedAt?.seconds))) return Number(visitedAt.seconds) * 1000;
    return Date.now();
  }

  function setMode(enabled) {
    state.historyMode = enabled;
    if (!state.overlay) return;
    state.overlay.classList.toggle('startab-history-mode', enabled);
    state.button?.classList.toggle('active', enabled);
    state.button?.setAttribute('aria-pressed', String(enabled));
    const tabSearch = state.overlay.querySelector('#startab-tab-search');
    if (tabSearch) tabSearch.disabled = enabled;
    if (enabled) {
      void loadHistory();
      requestAnimationFrame(() => state.search?.focus());
    }
  }

  function createUi(overlay) {
    if (!overlay || overlay.querySelector('#startab-history-btn')) return;
    state.overlay = overlay;
    const actions = overlay.querySelector('.startab-tab-actions');
    const viewSwitch = overlay.querySelector('.startab-view-switch');
    const modal = overlay.querySelector('.startab-tab-modal');
    if (!actions || !modal) return;

    const button = document.createElement('button');
    button.id = 'startab-history-btn';
    button.className = 'startab-history-btn';
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.title = 'Ver historial de navegación';
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path>
        <path d="M3 3v5h5"></path>
        <path d="M12 7v5l3 2"></path>
      </svg>
      <b>Historial</b>`;
    actions.insertBefore(button, viewSwitch || actions.lastElementChild);

    const panel = document.createElement('section');
    panel.id = 'startab-history-panel';
    panel.className = 'startab-history-panel';
    panel.setAttribute('aria-label', 'Historial de navegación');
    panel.innerHTML = `
      <div class="startab-history-toolbar">
        <div>
          <span class="startab-history-kicker">STAR TAB · FIREBASE HISTORY</span>
          <h3>Historial de navegación</h3>
          <p>Sitios visitados y búsquedas guardados con fecha y hora.</p>
        </div>
        <div class="startab-history-controls">
          <label class="startab-history-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
            <input id="startab-history-search" type="search" autocomplete="off" placeholder="Buscar en el historial..." aria-label="Buscar en el historial">
          </label>
          <button id="startab-history-refresh" type="button" title="Actualizar historial" aria-label="Actualizar historial">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 4v7h-7"></path></svg>
          </button>
          <button id="startab-history-back" type="button">Pestañas</button>
        </div>
      </div>
      <div id="startab-history-status" class="startab-history-status"></div>
      <div id="startab-history-list" class="startab-history-list"></div>`;

    const footer = modal.querySelector('.startab-tab-footer');
    modal.insertBefore(panel, footer || null);

    state.button = button;
    state.panel = panel;
    state.list = panel.querySelector('#startab-history-list');
    state.search = panel.querySelector('#startab-history-search');
    state.status = panel.querySelector('#startab-history-status');

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      setMode(!state.historyMode);
    });
    panel.querySelector('#startab-history-back')?.addEventListener('click', () => setMode(false));
    panel.querySelector('#startab-history-refresh')?.addEventListener('click', () => void loadHistory(true));
    state.search?.addEventListener('input', renderHistory);
    state.search?.addEventListener('keydown', (event) => event.stopPropagation());
    state.panel?.addEventListener('keydown', (event) => {
      if (event.target.closest('input,button')) event.stopPropagation();
    });
    state.list?.addEventListener('click', (event) => {
      const loadMore = event.target.closest('[data-history-load-more]');
      if (loadMore) {
        void loadHistory(false, true);
        return;
      }
      const target = event.target.closest('[data-history-url]');
      if (!target) return;
      const url = safeUrl(target.dataset.historyUrl);
      if (!url) return;
      if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        chrome.tabs.create({ url });
      } else {
        window.open(url, '_blank', 'noopener');
      }
    });

    overlay.querySelectorAll('[data-close-tabs]').forEach((close) => {
      close.addEventListener('click', () => {
        if (state.historyMode) setMode(false);
      }, { capture: true });
    });

    const classObserver = new MutationObserver(() => {
      if (!overlay.classList.contains('open') && state.historyMode) setMode(false);
    });
    classObserver.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }

  function renderHistory() {
    if (!state.list) return;
    const query = (state.search?.value || '').trim().toLowerCase();
    const filtered = state.entries.filter((entry) => {
      if (!query) return true;
      return `${entry.title || ''} ${entry.domain || ''} ${entry.url || ''} ${entry.searchQuery || ''}`
        .toLowerCase().includes(query);
    });

    if (!state.currentUser) {
      state.list.innerHTML = `
        <div class="startab-history-empty">
          <div class="startab-history-empty-icon">☁</div>
          <h4>Inicia sesión para ver tu historial</h4>
          <p>El historial en Firebase se asocia únicamente a tu cuenta de StarTab.</p>
        </div>`;
      return;
    }

    if (!filtered.length) {
      state.list.innerHTML = `
        <div class="startab-history-empty">
          <div class="startab-history-empty-icon">⌛</div>
          <h4>${query ? 'No hay coincidencias' : 'Aún no hay historial guardado'}</h4>
          <p>${query ? 'Prueba con otro título, dominio, URL o búsqueda.' : 'Las próximas páginas y búsquedas aparecerán aquí automáticamente.'}</p>
        </div>`;
      return;
    }

    const groups = new Map();
    filtered.forEach((entry) => {
      const timestamp = entryTimestamp(entry);
      const key = formatDateKey(timestamp);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...entry, _timestamp: timestamp });
    });

    state.list.innerHTML = [...groups.entries()].map(([dateLabel, entries]) => `
      <section class="startab-history-day">
        <div class="startab-history-day-title"><span>${escapeHtml(dateLabel)}</span><em>${entries.length}</em></div>
        <div class="startab-history-items">
          ${entries.map((entry) => {
            const favicon = fallbackFavicon(entry);
            const search = entry.type === 'search' && entry.searchQuery;
            const title = search ? entry.searchQuery : (entry.title || entry.domain || entry.url || 'Página visitada');
            const subtitle = search
              ? `${entry.searchEngine || 'Buscador'} · ${entry.domain || ''}`
              : (entry.domain || entry.url || '');
            return `
              <button class="startab-history-item" type="button" data-history-url="${escapeHtml(entry.url)}" title="Abrir ${escapeHtml(entry.url)}">
                <span class="startab-history-favicon">${favicon ? `<img src="${escapeHtml(favicon)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<span>↗</span>'}</span>
                <span class="startab-history-copy">
                  <span class="startab-history-title-row">
                    ${search ? '<span class="startab-history-type">BÚSQUEDA</span>' : ''}
                    ${entry.incognito === true ? '<span class="startab-history-incognito">INCÓGNITO</span>' : ''}
                    <strong>${escapeHtml(title)}</strong>
                  </span>
                  <small>${escapeHtml(subtitle)}</small>
                  <span class="startab-history-url">${escapeHtml(entry.url || '')}</span>
                </span>
                <time datetime="${new Date(entry._timestamp).toISOString()}">${escapeHtml(formatTime(entry._timestamp))}</time>
              </button>`;
          }).join('')}
        </div>
      </section>`).join('') + (state.hasMore && !query ? `
        <div class="startab-history-load-more-wrap">
          <button class="startab-history-load-more" type="button" data-history-load-more>
            Cargar más historial
          </button>
        </div>` : '');
  }

  async function waitForFirebase(timeout = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const fb = getFirebase();
      if (fb) return fb;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  }

  async function ensureAuthObserver() {
    const fb = await waitForFirebase();
    if (!fb) return;
    if (state.unsubscribeAuth) return;
    state.unsubscribeAuth = fb.auth().onAuthStateChanged((user) => {
      state.currentUser = user || getSavedUser() || null;
      renderHistory();
      if (state.currentUser && state.historyMode) void loadHistory(true);
    });
  }

  async function loadHistory(force = false, append = false) {
    if (state.loading) return;
    const fb = await waitForFirebase();
    if (!fb) {
      if (state.status) state.status.textContent = 'Firebase no está disponible en este momento.';
      return;
    }
    const user = getCurrentIdentity(fb);
    state.currentUser = user || null;
    if (!user) {
      state.entries = [];
      if (state.status) state.status.textContent = 'Sesión no iniciada';
      renderHistory();
      return;
    }

    state.loading = true;
    state.panel?.classList.add('is-loading');
    if (!append) {
      state.lastDoc = null;
      state.hasMore = true;
    }
    if (state.status) state.status.textContent = append ? 'Cargando más historial…' : 'Actualizando historial…';
    try {
      let query = fb.firestore()
        .collection('users').doc(user.uid)
        .collection('history')
        .orderBy('clientAt', 'desc')
        .limit(HISTORY_PAGE_SIZE);
      if (append && state.lastDoc) query = query.startAfter(state.lastDoc);
      const snapshot = await query.get();
      const page = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      state.entries = append ? state.entries.concat(page) : page;
      state.lastDoc = snapshot.docs[snapshot.docs.length - 1] || state.lastDoc;
      state.hasMore = snapshot.size === HISTORY_PAGE_SIZE;
      if (state.status) {
        state.status.textContent = `${state.entries.length} ${state.entries.length === 1 ? 'registro cargado' : 'registros cargados'} · Firebase${state.hasMore ? ' · hay más' : ''}`;
      }
      renderHistory();
    } catch (error) {
      console.error('StarTab History: no se pudo cargar el historial:', error);
      if (state.status) state.status.textContent = 'No se pudo cargar el historial. Revisa la conexión o las reglas de Firestore.';
      state.entries = [];
      renderHistory();
    } finally {
      state.loading = false;
      state.panel?.classList.remove('is-loading');
    }
  }

  function observeTabCenter() {
    const attach = () => {
      const overlay = document.getElementById('startab-tab-center');
      if (overlay) createUi(overlay);
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== 'starTab_lastUser') return;
    state.currentUser = getSavedUser();
    renderHistory();
    if (state.currentUser && state.historyMode) void loadHistory(true);
  });

  state.currentUser = getSavedUser();
  window.setInterval(() => {
    const nextUser = getCurrentIdentity(getFirebase());
    const previousUid = state.currentUser?.uid || null;
    const nextUid = nextUser?.uid || null;
    if (previousUid === nextUid) return;
    state.currentUser = nextUser;
    if (!nextUser) state.entries = [];
    renderHistory();
    if (nextUser && state.historyMode) void loadHistory(true);
  }, 2000);
  ensureAuthObserver();
  observeTabCenter();
})();
