// StarTab — Centro de pestañas
// Panel visual para navegar rápidamente entre muchas pestañas y ventanas.
// Usa las APIs de Chrome de forma reactiva: no crea renders completos cada vez que cambia una pestaña.

(() => {
    'use strict';

    let tabUpdateTimer = null;
    let isPanelOpen = false;
    let currentView = localStorage.getItem('startab-tabs-view') === 'list' ? 'list' : 'grid';
    let searchTerm = '';
    let allTabs = [];
    let allWindows = [];
    let selectedIndex = 0;
    let renderQueued = false;
    let previewBusy = false;
    let previewTargetTabId = null;
    let selectedWindowId = null;
    let duplicateModeOpen = false;
    let showLoadedPreviews = localStorage.getItem('startab-show-loaded-previews') === 'true';
    // Caché de vistas previas: se conserva aunque el modal se cierre y se vuelva a abrir.
    // La clave incluye URL para evitar reutilizar una captura de una pestaña que cambió de página.
    const previewCache = new Map();
    const PREVIEW_STORAGE_KEY = 'startab-preview-cache-v2';
    let previewStorageReady = false;
    let previewPreloadRun = 0;
    let previewPreloadTimer = null;
    const previewPreloading = new Set();

    function previewStorageAvailable() {
        return !!(chromeApi() && chrome.storage?.local);
    }

    async function hydratePreviewCache() {
        if (previewStorageReady || !previewStorageAvailable()) return;
        previewStorageReady = true;
        try {
            const result = await new Promise(resolve => chrome.storage.local.get(PREVIEW_STORAGE_KEY, resolve));
            const saved = result?.[PREVIEW_STORAGE_KEY] || {};
            Object.entries(saved).forEach(([key, value]) => {
                if (typeof value === 'string' && value.startsWith('data:image/')) previewCache.set(key, value);
            });
            if (isPanelOpen && showLoadedPreviews) queueRender();
        } catch (err) {
            console.warn('StarTab: no se pudo recuperar la caché de vistas previas:', err);
        }
    }

    function previewKey(tab) {
        return `${tab.id}::${tab.url || ''}`;
    }

    function getCachedPreview(tab) {
        return previewCache.get(previewKey(tab)) || previewCache.get(String(tab.id)) || null;
    }

    async function saveCachedPreview(tab, image) {
        const key = previewKey(tab);
        previewCache.set(key, image);
        if (!previewStorageAvailable()) return;
        try {
            const result = await new Promise(resolve => chrome.storage.local.get(PREVIEW_STORAGE_KEY, resolve));
            const saved = result?.[PREVIEW_STORAGE_KEY] || {};
            saved[key] = image;
            await new Promise(resolve => chrome.storage.local.set({ [PREVIEW_STORAGE_KEY]: saved }, resolve));
        } catch (err) {
            console.warn('StarTab: no se pudo guardar la vista previa:', err);
        }
    }

    async function removeCachedPreview(tab) {
        const keys = [previewKey(tab), String(tab.id)];
        keys.forEach(key => previewCache.delete(key));
        if (!previewStorageAvailable()) return;
        try {
            const result = await new Promise(resolve => chrome.storage.local.get(PREVIEW_STORAGE_KEY, resolve));
            const saved = result?.[PREVIEW_STORAGE_KEY] || {};
            keys.forEach(key => delete saved[key]);
            await new Promise(resolve => chrome.storage.local.set({ [PREVIEW_STORAGE_KEY]: saved }, resolve));
        } catch (_) {}
    }

    const els = { container: null, windows: null, tabs: null, overlay: null, content: null, windowTabs: null, duplicatesBtn: null, duplicatesContent: null };

    const chromeApi = () => typeof chrome !== 'undefined' && chrome.tabs && chrome.windows;

    function getAllWindows() {
        return new Promise(resolve => chrome.windows.getAll({ populate: true }, windows => {
            if (chrome.runtime?.lastError) return resolve([]);
            resolve(windows || []);
        }));
    }

    function getAllTabs() {
        return new Promise(resolve => chrome.tabs.query({}, tabs => {
            if (chrome.runtime?.lastError) return resolve([]);
            resolve(tabs || []);
        }));
    }

    function favicon(tab) {
        if (tab.favIconUrl) return tab.favIconUrl;
        try {
            const host = new URL(tab.url || '').hostname;
            if (host) return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`;
        } catch (_) {}
        return '';
    }

    function domain(tab) {
        try { return new URL(tab.url || '').hostname.replace(/^www\./, ''); }
        catch (_) { return tab.url || 'Nueva pestaña'; }
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, c => ({
            '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
        }[c]));
    }

    function tabLabel(tab) {
        return tab.title || domain(tab) || 'Nueva pestaña';
    }

    function refreshStats(tabs, windows) {
        if (els.windows) els.windows.textContent = windows.length;
        if (els.tabs) els.tabs.textContent = tabs.length;
    }

    async function loadData() {
        if (!chromeApi()) return;
        hydratePreviewCache();
        const [windows, tabs] = await Promise.all([getAllWindows(), getAllTabs()]);
        allWindows = windows;
        allTabs = tabs;
        refreshStats(tabs, windows);
        if (isPanelOpen) {
            queueRender();
            if (showLoadedPreviews) scheduleLoadedTabPreviews(0);
        }
    }

    function ensurePanel() {
        if (els.overlay) return;

        const overlay = document.createElement('div');
        overlay.id = 'startab-tab-center';
        overlay.className = 'startab-tab-center';
        overlay.innerHTML = `
            <div class="startab-tab-backdrop" data-close-tabs></div>
            <section class="startab-tab-modal" role="dialog" aria-modal="true" aria-labelledby="startab-tab-title">
                <header class="startab-tab-header">
                    <div class="startab-tab-heading">
                        <div class="startab-tab-symbol"><span></span><span></span><span></span></div>
                        <div>
                            <div class="startab-tab-kicker">StarTab · WORKSPACE</div>
                            <h2 id="startab-tab-title">Centro de pestañas</h2>
                            <p id="startab-tab-subtitle">Navega entre todas tus pestañas y ventanas.</p>
                        </div>
                    </div>
                    <div class="startab-tab-actions">
                        <div class="startab-tab-search">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
                            <input id="startab-tab-search" type="search" autocomplete="off" spellcheck="false" placeholder="Buscar pestañas..." aria-label="Buscar pestañas">
                            <kbd>⌘ K</kbd>
                        </div>
                        <button id="startab-duplicates-btn" class="startab-special-btn" type="button" title="Ver pestañas duplicadas" aria-label="Ver pestañas duplicadas" style="display:none">
                            <span>⧉</span><b>Pestañas duplicadas</b><em id="startab-duplicates-count">0</em>
                        </button>
                        <button id="startab-preview-toggle" class="startab-preview-toggle" type="button" role="switch" aria-checked="false" title="Mostrar u ocultar las vistas previas que ya están cargadas">
                            <span class="startab-preview-toggle-icon">▣</span><b>Vista previa</b><i></i>
                        </button>
                        <div class="startab-view-switch" role="group" aria-label="Vista">
                            <button data-view="list" title="Vista de lista" aria-label="Vista de lista">
                                <svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>
                            </button>
                            <button data-view="grid" title="Vista de cuadros" aria-label="Vista de cuadros">
                                <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                            </button>
                        </div>
                        <button class="startab-tab-close" data-close-tabs title="Cerrar (Esc)" aria-label="Cerrar">×</button>
                    </div>
                </header>
                <div class="startab-tab-toolbar">
                    <div class="startab-tab-summary"><strong id="startab-results-count">0</strong><span>pestañas</span><i></i><strong id="startab-window-count">0</strong><span>ventanas</span></div>
                    <div class="startab-tab-hint"><span class="startab-key">↑↓</span> navegar <span class="startab-key">Enter</span> abrir <span class="startab-key">Esc</span> cerrar</div>
                </div>
                <div id="startab-window-tabs" class="startab-window-tabs"></div>
                <div id="startab-tab-content" class="startab-tab-content"></div>
                <footer class="startab-tab-footer">
                    <span><span class="startab-live-dot"></span> Sincronizado en tiempo real</span>
                    <span>Haz clic en una pestaña para cambiar a ella · Clic derecho para vista previa</span>
                </footer>
                <div class="startab-real-preview" aria-hidden="true">
                    <div class="startab-real-preview-backdrop" data-close-preview></div>
                    <section class="startab-real-preview-card" role="dialog" aria-modal="true" aria-labelledby="startab-preview-title">
                        <header class="startab-real-preview-header">
                            <div class="startab-real-preview-heading">
                                <img id="startab-preview-favicon" alt="">
                                <div><span>VISTA PREVIA EN VIVO</span><h3 id="startab-preview-title">Vista previa</h3></div>
                            </div>
                            <button class="startab-real-preview-close" data-close-preview aria-label="Cerrar vista previa">×</button>
                        </header>
                        <div class="startab-real-preview-stage">
                            <div class="startab-real-preview-loading"><span></span><strong>Capturando pestaña…</strong><small>Obteniendo una vista real sin cerrar este centro</small></div>
                            <img id="startab-real-preview-image" alt="Vista previa de la pestaña">
                            <div class="startab-real-preview-error"><strong>No se pudo capturar esta pestaña</strong><span>Chrome no permite capturar este tipo de página.</span></div>
                        </div>
                        <footer class="startab-real-preview-footer"><span id="startab-preview-domain"></span><div class="startab-preview-actions"><button class="startab-preview-delete" data-preview-close-tab>× Cerrar pestaña</button><button data-preview-open>Abrir pestaña</button></div></footer>
                    </section>
                </div>
                <div class="startab-duplicates-modal" aria-hidden="true">
                    <div class="startab-duplicates-backdrop" data-close-duplicates></div>
                    <section class="startab-duplicates-card" role="dialog" aria-modal="true" aria-labelledby="startab-duplicates-title">
                        <header class="startab-duplicates-header">
                            <div><span>STAR TAB · LIMPIEZA</span><h3 id="startab-duplicates-title">Pestañas duplicadas</h3><p>Revisa los grupos y cierra manualmente las que quieras.</p></div>
                            <button class="startab-real-preview-close" data-close-duplicates aria-label="Cerrar">×</button>
                        </header>
                        <div id="startab-duplicates-content" class="startab-duplicates-content"></div>
                        <footer class="startab-duplicates-footer"><span id="startab-duplicates-summary"></span><div><button data-close-duplicates>Cancelar</button><button class="startab-duplicates-remove-all" data-close-duplicates-and-clean>Dejar solo una por grupo</button></div></footer>
                    </section>
                </div>
            </section>`;
        document.body.appendChild(overlay);

        els.overlay = overlay;
        els.content = overlay.querySelector('#startab-tab-content');
        els.windowTabs = overlay.querySelector('#startab-window-tabs');
        els.duplicatesBtn = overlay.querySelector('#startab-duplicates-btn');
        const previewToggle = overlay.querySelector('#startab-preview-toggle');
        syncPreviewToggle(previewToggle);
        hydratePreviewCache();
        els.duplicatesContent = overlay.querySelector('#startab-duplicates-content');

        overlay.addEventListener('click', e => {
            const closePreview = e.target.closest('[data-close-preview]');
            if (closePreview) { closePreviewPanel(); return; }

            const previewOpen = e.target.closest('[data-preview-open]');
            if (previewOpen && previewTargetTabId) { activateTab(previewTargetTabId); return; }

            const previewCloseTab = e.target.closest('[data-preview-close-tab]');
            if (previewCloseTab && previewTargetTabId) {
                const id = previewTargetTabId;
                closePreviewPanel();
                closeTab(id);
                return;
            }

            const previewToggleBtn = e.target.closest('#startab-preview-toggle');
            if (previewToggleBtn) {
                showLoadedPreviews = !showLoadedPreviews;
                localStorage.setItem('startab-show-loaded-previews', String(showLoadedPreviews));
                syncPreviewToggle(previewToggleBtn);
                queueRender();
                if (showLoadedPreviews) scheduleLoadedTabPreviews(0);
                else {
                    previewPreloadRun++;
                    if (previewPreloadTimer) { clearTimeout(previewPreloadTimer); previewPreloadTimer = null; }
                }
                return;
            }

            const dupBtn = e.target.closest('#startab-duplicates-btn');
            if (dupBtn) { openDuplicates(); return; }
            if (e.target.closest('[data-close-duplicates]')) { closeDuplicates(); return; }
            if (e.target.closest('[data-close-duplicates-and-clean]')) { cleanDuplicates(); return; }

            const winBtn = e.target.closest('[data-window-id]');
            if (winBtn) { selectedWindowId = Number(winBtn.dataset.windowId); selectedIndex = 0; queueRender(); return; }

            const close = e.target.closest('[data-close-tabs]');
            if (close) { closePanel(); return; }

            const view = e.target.closest('[data-view]');
            if (view) { setView(view.dataset.view); return; }

            // El botón X de una pestaña solo la cierra; nunca activa la tarjeta ni el modal.
            if (e.target.closest('[data-close-tab]')) return;

            const tabCard = e.target.closest('[data-tab-id]');
            if (tabCard) activateTab(Number(tabCard.dataset.tabId));
        });

        overlay.addEventListener('contextmenu', e => {
            const tabCard = e.target.closest('[data-tab-id]');
            if (!tabCard) return;
            e.preventDefault();
            e.stopPropagation();
            showRealPreview(Number(tabCard.dataset.tabId));
        });

        const input = overlay.querySelector('#startab-tab-search');
        input.addEventListener('input', e => {
            searchTerm = e.target.value.trim().toLowerCase();
            selectedIndex = 0;
            queueRender();
        });

        input.addEventListener('keydown', handleKeyboard);
        overlay.addEventListener('keydown', handleKeyboard);
    }

    function syncPreviewToggle(button) {
        if (!button) return;
        button.classList.toggle('active', showLoadedPreviews);
        button.setAttribute('aria-checked', String(showLoadedPreviews));
        button.title = showLoadedPreviews
            ? 'Ocultar las vistas previas que ya están cargadas'
            : 'Mostrar las vistas previas que ya están cargadas';
    }

    function filteredTabs() {
        if (!searchTerm) return allTabs;
        return allTabs.filter(tab =>
            `${tab.title || ''} ${domain(tab)} ${tab.url || ''}`.toLowerCase().includes(searchTerm)
        );
    }

    function groupTabs(tabs) {
        const map = new Map();
        tabs.forEach(tab => {
            const id = tab.windowId;
            if (!map.has(id)) {
                const win = allWindows.find(w => w.id === id);
                map.set(id, { id, tabs: [], window: win });
            }
            map.get(id).tabs.push(tab);
        });
        return [...map.values()].sort((a, b) => {
            const af = a.window?.focused ? 0 : 1;
            const bf = b.window?.focused ? 0 : 1;
            return af - bf || a.id - b.id;
        });
    }

    function windowLabel(group, index) {
        return group.window?.focused ? `Ventana ${index + 1} · actual` : `Ventana ${index + 1}`;
    }

    function getWindowGroups(tabs = allTabs) {
        return groupTabs(tabs);
    }

    function duplicateGroups() {
        const map = new Map();
        allTabs.forEach(tab => {
            const key = (tab.url || '').trim();
            if (!key || key.startsWith('chrome://newtab')) return;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(tab);
        });
        return [...map.entries()].filter(([, tabs]) => tabs.length > 1).map(([url, tabs]) => ({ url, tabs }));
    }

    function renderWindowTabs(groups) {
        if (!els.windowTabs) return;
        const current = selectedWindowId == null ? null : groups.find(g => g.id === selectedWindowId);
        if (!current && groups.length) selectedWindowId = groups[0].id;
        els.windowTabs.innerHTML = groups.map((group, i) => `
            <button class="startab-window-tab${group.id === selectedWindowId ? ' active' : ''}" data-window-id="${group.id}">
                <span class="startab-window-tab-icon">${group.window?.focused ? '◉' : '○'}</span>
                <span><b>${escapeHtml(windowLabel(group, i))}</b><small>${group.tabs.length} ${group.tabs.length === 1 ? 'pestaña' : 'pestañas'}</small></span>
            </button>`).join('');
    }

    function updateDuplicateButton() {
        const groups = duplicateGroups();
        const total = groups.reduce((n, g) => n + g.tabs.length - 1, 0);
        if (els.duplicatesBtn) {
            els.duplicatesBtn.style.display = groups.length ? 'inline-flex' : 'none';
            const count = els.duplicatesBtn.querySelector('#startab-duplicates-count');
            if (count) count.textContent = total;
        }
    }

    function renderDuplicates() {
        const groups = duplicateGroups();
        if (!els.duplicatesContent) return;
        els.duplicatesContent.innerHTML = groups.length ? groups.map((group, i) => `
            <div class="startab-duplicate-group">
                <div class="startab-duplicate-heading"><strong>Grupo ${i + 1}</strong><span>${group.tabs.length} pestañas iguales</span><small title="${escapeHtml(group.url)}">${escapeHtml(domain(group.tabs[0]))}</small></div>
                <div class="startab-duplicate-tabs">${group.tabs.map((tab, j) => `
                    <div class="startab-duplicate-tab" data-tab-id="${tab.id}">
                        <img src="${escapeHtml(favicon(tab))}" alt="" onerror="this.style.display='none'">
                        <div><b>${escapeHtml(tabLabel(tab))}</b><small>${escapeHtml(tab.windowId === group.tabs[0].windowId ? 'Misma ventana' : `Ventana ${tab.windowId}`)}</small></div>
                        <button data-close-tab="${tab.id}" title="Cerrar esta duplicada" aria-label="Cerrar esta pestaña">×</button>
                    </div>`).join('')}</div>
            </div>`).join('') : `<div class="startab-empty"><div class="startab-empty-orbit"><span>✓</span></div><h3>No hay pestañas duplicadas</h3><p>Todo está limpio.</p></div>`;
        const total = groups.reduce((n, g) => n + g.tabs.length - 1, 0);
        const summary = els.overlay.querySelector('#startab-duplicates-summary');
        if (summary) summary.textContent = total ? `${total} duplicaciones que se pueden cerrar` : 'No hay duplicaciones que cerrar';
    }

    function openDuplicates() {
        duplicateModeOpen = true;
        renderDuplicates();
        const modal = els.overlay?.querySelector('.startab-duplicates-modal');
        modal?.classList.add('open');
        modal?.setAttribute('aria-hidden', 'false');
    }

    function closeDuplicates() {
        duplicateModeOpen = false;
        const modal = els.overlay?.querySelector('.startab-duplicates-modal');
        modal?.classList.remove('open');
        modal?.setAttribute('aria-hidden', 'true');
    }

    async function cleanDuplicates() {
        const groups = duplicateGroups();
        const ids = groups.flatMap(group => group.tabs.slice(1).map(tab => tab.id));
        if (!ids.length) { closeDuplicates(); return; }
        await new Promise(resolve => chrome.tabs.remove(ids, () => resolve()));
        await loadData();
        renderDuplicates();
    }

    function cardHtml(tab, index, listMode) {
        const active = tab.active ? ' is-active' : '';
        const pin = tab.pinned ? '<span class="startab-pin">PIN</span>' : '';
        const fav = favicon(tab);
        const title = escapeHtml(tabLabel(tab));
        const host = escapeHtml(domain(tab));
        const cachedPreview = showLoadedPreviews ? getCachedPreview(tab) : null;
        const previewContent = cachedPreview
            ? `<img class="startab-cached-preview-image" src="${escapeHtml(cachedPreview)}" alt="Vista previa cargada de ${title}">`
            : `<div class="startab-preview-placeholder">
                    <div class="startab-preview-bar"><span></span><span></span><span></span><b>${escapeHtml(host)}</b></div>
                    <div class="startab-preview-body">
                        ${fav ? `<img src="${escapeHtml(fav)}" alt="" onerror="this.style.display='none'">` : '<div class="startab-fallback-icon">✦</div>'}
                        <div class="startab-preview-lines"><i></i><i></i><i></i></div>
                    </div>
               </div>`;
        return `
            <article class="startab-tab-card${active}${cachedPreview && showLoadedPreviews ? ' has-cached-preview' : ''}" data-tab-id="${tab.id}" data-index="${index}" tabindex="0">
                <div class="startab-tab-preview">
                    ${previewContent}
                    ${cachedPreview && showLoadedPreviews ? '<span class="startab-preview-ready">PREVIA CARGADA</span>' : ''}
                    ${tab.active ? '<div class="startab-active-glow"></div>' : ''}
                </div>
                <div class="startab-tab-info">
                    <div class="startab-tab-title" title="${title}">${title}</div>
                    <div class="startab-tab-domain">${host}</div>
                </div>
                ${pin}
                <button class="startab-tab-dismiss" data-close-tab="${tab.id}" title="Cerrar pestaña" aria-label="Cerrar pestaña">×</button>
            </article>`;
    }

    function renderList(groups) {
        let globalIndex = 0;
        return groups.map(group => {
            const groupIndex = groups.indexOf(group);
            const winTitle = windowLabel(group, groupIndex);
            const tabs = group.tabs.map(tab => cardHtml(tab, globalIndex++, true)).join('');
            return `
                <div class="startab-window-section">
                    <div class="startab-window-heading">
                        <span class="startab-window-icon">${group.window?.focused ? '◉' : '○'}</span>
                        <strong>${escapeHtml(winTitle)}</strong>
                        <span>${group.tabs.length} ${group.tabs.length === 1 ? 'pestaña' : 'pestañas'}</span>
                    </div>
                    <div class="startab-list">${tabs}</div>
                </div>`;
        }).join('');
    }

    function renderGrid(groups) {
        let globalIndex = 0;
        return groups.map(group => {
            const groupIndex = groups.indexOf(group);
            const winTitle = windowLabel(group, groupIndex);
            const tabs = group.tabs.map(tab => cardHtml(tab, globalIndex++, false)).join('');
            return `
                <div class="startab-window-section">
                    <div class="startab-window-heading">
                        <span class="startab-window-icon">${group.window?.focused ? '◉' : '○'}</span>
                        <strong>${escapeHtml(winTitle)}</strong>
                        <span>${group.tabs.length} ${group.tabs.length === 1 ? 'pestaña' : 'pestañas'}</span>
                    </div>
                    <div class="startab-grid">${tabs}</div>
                </div>`;
        }).join('');
    }

    function queueRender() {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
            renderQueued = false;
            renderPanel();
        });
    }

    function renderPanel() {
        if (!els.content) return;
        const searchedTabs = filteredTabs();
        const allGroups = getWindowGroups(allTabs);
        if (selectedWindowId == null && allGroups.length) selectedWindowId = allGroups[0].id;
        const groups = selectedWindowId == null ? allGroups : allGroups.filter(g => g.id === selectedWindowId).map(g => ({ ...g, tabs: g.tabs.filter(tab => searchedTabs.some(t => t.id === tab.id)) }));
        const tabs = groups.flatMap(g => g.tabs);
        renderWindowTabs(allGroups);
        updateDuplicateButton();
        const count = els.overlay.querySelector('#startab-results-count');
        const wins = els.overlay.querySelector('#startab-window-count');
        const subtitle = els.overlay.querySelector('#startab-tab-subtitle');

        count.textContent = allTabs.length;
        wins.textContent = allWindows.length;
        const selectedGroup = allGroups.find(g => g.id === selectedWindowId);
        subtitle.textContent = searchTerm
            ? `Resultados para “${searchTerm}” · ${selectedGroup ? windowLabel(selectedGroup, allGroups.indexOf(selectedGroup)) : 'todas las ventanas'}`
            : `Mostrando ${selectedGroup ? windowLabel(selectedGroup, allGroups.indexOf(selectedGroup)) : 'todas las ventanas'} · total: ${allTabs.length} pestañas en ${allWindows.length} ventanas.`;

        els.content.className = `startab-tab-content ${currentView === 'grid' ? 'view-grid' : 'view-list'}`;

        if (!tabs.length) {
            els.content.innerHTML = `
                <div class="startab-empty">
                    <div class="startab-empty-orbit"><span>⌕</span></div>
                    <h3>No encontramos esa pestaña</h3>
                    <p>Prueba con otro título, sitio web o palabra clave.</p>
                </div>`;
            return;
        }

        els.content.innerHTML = currentView === 'grid' ? renderGrid(groups) : renderList(groups);
        updateSelected();
    }

    function updateSelected() {
        const cards = [...els.content.querySelectorAll('[data-tab-id]')];
        cards.forEach((card, i) => card.classList.toggle('is-key-selected', i === selectedIndex));
    }

    function setView(view) {
        currentView = view === 'list' ? 'list' : 'grid';
        localStorage.setItem('startab-tabs-view', currentView);
        els.overlay?.querySelectorAll('[data-view]').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.view === currentView)
        );
        queueRender();
    }

    function getTabById(tabId) {
        return allTabs.find(tab => tab.id === tabId) || null;
    }

    function closePreviewPanel() {
        const preview = els.overlay?.querySelector('.startab-real-preview');
        if (!preview) return;
        preview.classList.remove('open');
        preview.setAttribute('aria-hidden', 'true');
        previewTargetTabId = null;
        previewBusy = false;
    }

    function setPreviewLoading(state) {
        const preview = els.overlay?.querySelector('.startab-real-preview');
        if (!preview) return;
        preview.classList.toggle('loading', state);
        preview.classList.remove('has-image', 'has-error');
    }

    function getActiveTabAndWindow() {
        return new Promise(resolve => {
            chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
                if (chrome.runtime?.lastError || !tabs?.[0]) {
                    resolve(null);
                    return;
                }
                const activeTab = tabs[0];
                resolve({ tabId: activeTab.id, windowId: activeTab.windowId });
            });
        });
    }

    function updateTab(tabId, updateProperties) {
        return new Promise((resolve, reject) => {
            chrome.tabs.update(tabId, updateProperties, tab => {
                const err = chrome.runtime.lastError;
                if (err) reject(new Error(err.message));
                else resolve(tab);
            });
        });
    }

    function updateWindow(windowId, updateProperties) {
        return new Promise((resolve, reject) => {
            chrome.windows.update(windowId, updateProperties, win => {
                const err = chrome.runtime.lastError;
                if (err) reject(new Error(err.message));
                else resolve(win);
            });
        });
    }

    function waitForTabLoaded(tabId, timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            let finished = false;
            let timeoutId = null;

            const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
                chrome.tabs.onUpdated.removeListener(onUpdated);
            };

            const finish = (fn, value) => {
                if (finished) return;
                finished = true;
                cleanup();
                fn(value);
            };

            const onUpdated = (updatedTabId, changeInfo, updatedTab) => {
                if (updatedTabId !== tabId) return;
                if (changeInfo.status === 'complete' || updatedTab?.status === 'complete') {
                    finish(resolve, updatedTab);
                }
            };

            chrome.tabs.onUpdated.addListener(onUpdated);

            chrome.tabs.get(tabId, tab => {
                const err = chrome.runtime.lastError;
                if (err) {
                    finish(reject, new Error(err.message));
                    return;
                }
                if (tab?.status === 'complete' && !tab.discarded) {
                    finish(resolve, tab);
                }
            });

            timeoutId = setTimeout(() => {
                chrome.tabs.get(tabId, tab => {
                    if (!chrome.runtime.lastError && tab && !tab.discarded && tab.status === 'complete') {
                        finish(resolve, tab);
                    } else {
                        finish(reject, new Error('La pestaña tardó demasiado en cargarse.'));
                    }
                });
            }, timeoutMs);
        });
    }

    async function ensureTabLoadedForPreview(tabId, { allowWake = true } = {}) {
        const tab = await new Promise((resolve, reject) => {
            chrome.tabs.get(tabId, result => {
                const err = chrome.runtime.lastError;
                if (err) reject(new Error(err.message));
                else resolve(result);
            });
        });

        // Las pestañas descartadas (Memory Saver) o aún no cargadas no pueden
        // ser capturadas por debugger. Las activamos temporalmente para que
        // Chrome las vuelva a cargar antes de tomar la captura.
        const needsLoad = !!tab.discarded || tab.status === 'unloaded';

        if (!needsLoad) {
            return { restore: null, tab };
        }

        if (!allowWake) {
            throw new Error('Pestaña suspendida: no se fuerza su carga para generar la miniatura.');
        }

        const restore = await getActiveTabAndWindow();

        // Activar la pestaña hace que Chrome la "descarte" de nuevo estado
        // y comience su navegación/carga sin cerrar el Centro de pestañas.
        await updateWindow(tab.windowId, { focused: true });
        await updateTab(tabId, { active: true });
        const loadedTab = await waitForTabLoaded(tabId);

        return { restore, tab: loadedTab };
    }

    async function restoreActiveTab(restore) {
        if (!restore?.tabId) return;
        try {
            if (restore.windowId) {
                await updateWindow(restore.windowId, { focused: true });
            }
            await updateTab(restore.tabId, { active: true });
        } catch (err) {
            console.warn('StarTab: no se pudo restaurar la pestaña activa después de la vista previa:', err);
        }
    }

    async function captureTabPreview(tabId, options = {}) {
        if (!chromeApi() || !chrome.debugger) throw new Error('La captura avanzada no está disponible.');
        const tab = getTabById(tabId);
        if (!tab) throw new Error('Tab not found');

        // Regla crítica de memoria: una captura pasiva NUNCA despierta una pestaña
        // descartada. Solo una acción explícita del usuario puede usar allowWake.
        const loadState = await ensureTabLoadedForPreview(tabId, options);
        const target = { tabId };
        let attached = false;
        try {
            // Mantener el periodo de debugger al mínimo absoluto. No usamos
            // Page.enable porque captureScreenshot puede solicitarse directamente.
            await new Promise((resolve, reject) => chrome.debugger.attach(target, '1.3', () => {
                const err = chrome.runtime.lastError;
                if (err) reject(new Error(err.message));
                else { attached = true; resolve(); }
            }));

            const result = await new Promise((resolve, reject) => chrome.debugger.sendCommand(
                target, 'Page.captureScreenshot', {
                    format: 'jpeg',
                    quality: 68,
                    fromSurface: true,
                    captureBeyondViewport: false
                }, response => {
                    const err = chrome.runtime.lastError;
                    if (err) reject(new Error(err.message));
                    else if (!response?.data) reject(new Error('Empty screenshot'));
                    else resolve(response.data);
                }
            ));
            return `data:image/jpeg;base64,${result}`;
        } finally {
            if (attached) {
                // Detach immediately so Chrome's "started debugging" UI is visible
                // for the shortest practical interval.
                await new Promise(resolve => chrome.debugger.detach(target, () => resolve()));
            }
            await restoreActiveTab(loadState.restore);
        }
    }

    function isTabCapturableWithoutLoading(tab) {
        // IMPORTANT: never wake/discard a sleeping tab just to create a thumbnail.
        // Only tabs that are already resident and completely loaded are eligible
        // for the passive thumbnail cache.
        return !!tab && !tab.discarded && tab.status === 'complete';
    }

    function updateCardPreview(tabId, image) {
        if (!els.content || !image) return;
        const card = els.content.querySelector(`[data-tab-id="${CSS.escape(String(tabId))}"]`);
        const stage = card?.querySelector('.startab-tab-preview');
        if (!stage) return;

        const old = stage.querySelector('.startab-preview-placeholder');
        if (old) old.outerHTML = `<img class="startab-cached-preview-image" src="${escapeHtml(image)}" alt="Vista previa cargada">`;
        else {
            const img = stage.querySelector('.startab-cached-preview-image');
            if (img && img.src !== image) img.src = image;
        }
        card.classList.add('has-cached-preview');
        if (!stage.querySelector('.startab-preview-ready')) {
            stage.insertAdjacentHTML('beforeend', '<span class="startab-preview-ready">PREVIA CARGADA</span>');
        }
    }

    function scheduleLoadedTabPreviews(delay = 0) {
        if (previewPreloadTimer) clearTimeout(previewPreloadTimer);
        if (!isPanelOpen || !showLoadedPreviews || !chromeApi() || !chrome.debugger) return;
        previewPreloadTimer = setTimeout(() => {
            previewPreloadTimer = null;
            preloadLoadedTabPreviews();
        }, delay);
    }

    async function preloadLoadedTabPreviews() {
        if (!isPanelOpen || !showLoadedPreviews || !chromeApi() || !chrome.debugger) return;
        const run = ++previewPreloadRun;
        const candidates = allTabs.filter(isTabCapturableWithoutLoading);

        // Solo pestañas residentes en memoria. Las descartadas/suspendidas quedan
        // completamente intactas y se capturan únicamente mediante acción manual.
        for (const tab of candidates) {
            if (run !== previewPreloadRun || !isPanelOpen || !showLoadedPreviews) return;
            if (getCachedPreview(tab) || previewPreloading.has(tab.id)) continue;
            previewPreloading.add(tab.id);
            try {
                const image = await captureTabPreview(tab.id, { allowWake: false });
                if (image) {
                    await saveCachedPreview(tab, image);
                    updateCardPreview(tab.id, image);
                }
            } catch (_) {
                // chrome://, páginas protegidas y pestañas que cambien de estado
                // durante la captura simplemente quedan sin miniatura.
            } finally {
                previewPreloading.delete(tab.id);
            }
            // Dejar un pequeño hueco entre targets evita mantener continuamente
            // activa la UI de "debugging" cuando hay muchas pestañas.
            await new Promise(r => setTimeout(r, 40));
        }
    }

    async function showRealPreview(tabId) {
        const tab = getTabById(tabId);
        const preview = els.overlay?.querySelector('.startab-real-preview');
        if (!tab || !preview || previewBusy) return;

        previewBusy = true;
        previewTargetTabId = tabId;
        preview.classList.add('open');
        preview.setAttribute('aria-hidden', 'false');
        setPreviewLoading(true);

        const img = preview.querySelector('#startab-real-preview-image');
        const faviconImg = preview.querySelector('#startab-preview-favicon');
        const title = preview.querySelector('#startab-preview-title');
        const domainEl = preview.querySelector('#startab-preview-domain');
        const error = preview.querySelector('.startab-real-preview-error');

        img.removeAttribute('src');
        title.textContent = tabLabel(tab);
        domainEl.textContent = domain(tab);
        faviconImg.src = favicon(tab) || '';
        error.querySelector('span').textContent = 'Chrome no permite capturar este tipo de página.';

        try {
            const image = await captureTabPreview(tabId);
            if (previewTargetTabId !== tabId) return;
            img.src = image;
            await saveCachedPreview(tab, image);
            updateCardPreview(tab.id, image);
            preview.classList.remove('loading', 'has-error');
            preview.classList.add('has-image');
        } catch (err) {
            if (previewTargetTabId !== tabId) return;
            error.querySelector('span').textContent = err?.message || 'No se pudo obtener la vista previa.';
            preview.classList.remove('loading', 'has-image');
            preview.classList.add('has-error');
        } finally {
            previewBusy = false;
        }
    }

    async function activateTab(tabId) {
        if (!chromeApi()) return;
        const tab = allTabs.find(t => t.id === tabId);
        if (!tab) return;

        await new Promise(resolve => chrome.tabs.update(tabId, { active: true }, resolve));
        await new Promise(resolve => chrome.windows.update(tab.windowId, { focused: true }, resolve));

        // Manual opening is allowed to generate its thumbnail. This is intentionally
        // done only after the user chose the tab; sleeping tabs are never awakened
        // by the passive preview system.
        if (showLoadedPreviews) {
            try {
                const current = await new Promise(resolve => chrome.tabs.get(tabId, resolve));
                if (current && current.status === 'complete' && !current.discarded) {
                    const image = await captureTabPreview(tabId, { allowWake: false });
                    await saveCachedPreview(current, image);
                }
            } catch (_) {}
        }
        closePanel();
    }

    function closeTab(tabId, event) {
        if (event) event.stopPropagation();
        const closingTab = getTabById(tabId);
        if (closingTab) removeCachedPreview(closingTab);
        if (!chromeApi()) return;
        chrome.tabs.remove(tabId, () => {
            previewCache.delete(tabId);
            // El Centro de pestañas permanece abierto y simplemente actualiza su contenido.
            if (chrome.runtime?.lastError) return;
            loadData();
        });
    }

    function handleKeyboard(e) {
        if (!isPanelOpen) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            const preview = els.overlay?.querySelector('.startab-real-preview.open');
            if (preview) { closePreviewPanel(); return; }
            closePanel();
            return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            els.overlay.querySelector('#startab-tab-search')?.focus();
            return;
        }
        const cards = [...els.content.querySelectorAll('[data-tab-id]')];
        if (!cards.length || document.activeElement?.id === 'startab-tab-search') return;

        const cols = currentView === 'grid'
            ? Math.max(1, Math.floor(els.content.clientWidth / 240))
            : 1;

        if (e.key === 'ArrowRight') selectedIndex = Math.min(cards.length - 1, selectedIndex + 1);
        else if (e.key === 'ArrowLeft') selectedIndex = Math.max(0, selectedIndex - 1);
        else if (e.key === 'ArrowDown') selectedIndex = Math.min(cards.length - 1, selectedIndex + cols);
        else if (e.key === 'ArrowUp') selectedIndex = Math.max(0, selectedIndex - cols);
        else if (e.key === 'Enter') {
            const id = Number(cards[selectedIndex]?.dataset.tabId);
            if (id) activateTab(id);
            return;
        } else return;

        e.preventDefault();
        updateSelected();
        cards[selectedIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function openPanel() {
        ensurePanel();
        isPanelOpen = true;
        searchTerm = '';
        selectedIndex = 0;
        const initialGroups = groupTabs(allTabs);
        selectedWindowId = initialGroups.find(g => g.window?.focused)?.id ?? initialGroups[0]?.id ?? null;
        const input = els.overlay.querySelector('#startab-tab-search');
        input.value = '';
        els.overlay.querySelectorAll('[data-view]').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.view === currentView)
        );
        els.overlay.classList.add('open');
        document.body.classList.add('startab-tabs-modal-open');
        // Renderiza inmediatamente usando la caché ya disponible; si la caché
        // aún se está recuperando de chrome.storage, hydratePreviewCache()
        // disparará otro render en cuanto termine.
        hydratePreviewCache();
        queueRender();
        loadData();
        if (showLoadedPreviews) scheduleLoadedTabPreviews(0);
        setTimeout(() => input.focus(), 80);
    }

    function closePanel() {
        if (!els.overlay) return;
        isPanelOpen = false;
        previewPreloadRun++;
        if (previewPreloadTimer) { clearTimeout(previewPreloadTimer); previewPreloadTimer = null; }
        els.overlay.classList.remove('open');
        document.body.classList.remove('startab-tabs-modal-open');
    }

    function initEvents() {
        els.container = document.getElementById('tab-counter-container');
        els.windows = document.getElementById('tab-counter-windows');
        els.tabs = document.getElementById('tab-counter-tabs');
        if (!els.container) return;

        els.container.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            openPanel();
        });

        // Botón de cerrar individual delegado en el panel.
        document.addEventListener('click', e => {
            const btn = e.target.closest('[data-close-tab]');
            if (btn) closeTab(Number(btn.dataset.closeTab), e);
        });

        if (chromeApi()) {
            const events = [
                chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated,
                chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached,
                chrome.tabs.onActivated, chrome.windows.onCreated, chrome.windows.onRemoved,
                chrome.windows.onFocusChanged
            ];
            events.forEach(ev => ev?.addListener(() => {
                clearTimeout(tabUpdateTimer);
                tabUpdateTimer = setTimeout(loadData, 80);
            }));
            loadData();
        } else {
            // Vista de desarrollo fuera de Chrome: no inventamos datos.
            refreshStats([], []);
        }

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && isPanelOpen) closePanel();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEvents, { once: true });
    } else initEvents();

    window.StarTabCounter = {
        iniciar: loadData,
        actualizar: loadData,
        abrirCentro: openPanel,
        cerrarCentro: closePanel,
        getStats: () => ({ windows: allWindows.length, tabs: allTabs.length })
    };
})();
