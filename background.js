// StarTab - menú contextual "Añadir a StarTab"
const MENU_ROOT = 'startab-add-root';
const MENU_PREFIX = 'startab-add-category-';
const STORAGE_KEY = 'starTab_contextMenuCategories';
const PENDING_KEY = 'starTab_pendingContextAdd';
let pendingWriteChain = Promise.resolve();
let contextMenuRebuildChain = Promise.resolve();
let lastContextMenuSignature = null;

function buildFavicon(url) {
  // StarTab usa el mismo favicon moderno que los favoritos arrastrados
  // desde el navegador. No usamos tab.favIconUrl porque puede devolver
  // directamente algo como https://sitio.com/favicon.ico.
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`;
  } catch (_) {
    return '';
  }
}

async function getCategories() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const cats = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  return cats.length ? cats : [{ id: 'general', nombre: 'General', orden: 1 }];
}

async function performContextMenuRebuild(force = false) {
  const cats = await getCategories();
  cats.sort((a,b) => (a.orden || 999) - (b.orden || 999));

  const signature = JSON.stringify(cats.map(cat => [cat.id, cat.nombre || 'Sin nombre', cat.orden || 999]));
  if (!force && signature === lastContextMenuSignature) return;

  // Una única reconstrucción atómica por vez. Antes, varias llamadas a
  // removeAll/create podían solaparse y dejar temporalmente sin la opción
  // "Añadir a StarTab" en el menú de clic derecho de una pestaña.
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_ROOT,
    title: 'Añadir a StarTab',
    contexts: ['tab']
  });

  for (const cat of cats) {
    chrome.contextMenus.create({
      id: MENU_PREFIX + cat.id,
      parentId: MENU_ROOT,
      title: cat.nombre || 'Sin nombre',
      contexts: ['tab']
    });
  }

  lastContextMenuSignature = signature;
}

function rebuildContextMenus(force = false) {
  contextMenuRebuildChain = contextMenuRebuildChain
    .catch(() => {})
    .then(() => performContextMenuRebuild(force))
    .catch(error => console.error('StarTab: no se pudo crear el menú contextual', error));
  return contextMenuRebuildChain;
}

chrome.runtime.onInstalled.addListener(() => rebuildContextMenus(true));
chrome.runtime.onStartup.addListener(() => rebuildContextMenus(true));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]) rebuildContextMenus(false);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuItemId = String(info?.menuItemId || '');
  if (!tab || !menuItemId.startsWith(MENU_PREFIX)) return;
  const categoryId = menuItemId.slice(MENU_PREFIX.length);
  const url = tab.url || '';
  if (!/^https?:\/\//i.test(url)) return;

  // Cada clic crea una nueva instancia; no se deduplica por URL.
  const pending = {
    id: Date.now() + '_' + Math.random().toString(36).slice(2),
    categoriaId: categoryId,
    nombre: (tab.title || '').trim().slice(0, 120) || (() => { try { return new URL(url).hostname; } catch (_) { return 'Acceso directo'; } })(),
    url,
    icono: buildFavicon(url),
    createdAt: Date.now()
  };

  // Primero intentamos entregarlo a una página StarTab ya abierta, para que
  // el usuario lo vea aparecer al instante. Le damos un tiempo máximo corto
  // (no debe "colgarse" nunca esperando una respuesta que quizá no llegue).
  try {
    const tabs = await chrome.tabs.query({});
    const starTab = tabs.find(t => t.url && t.url.startsWith(chrome.runtime.getURL('index.html')));
    if (starTab && starTab.id != null) {
      let delivered = false;
      try {
        // IMPORTANTE: index.html es una página de extensión, no un content
        // script. Por eso tabs.sendMessage() NO es fiable aquí. runtime.sendMessage()
        // entrega el evento directamente a las páginas de la extensión abiertas.
        const response = await Promise.race([
          chrome.runtime.sendMessage({ type: 'STARTAB_ADD_CONTEXT_TAB', payload: pending }),
          new Promise(resolve => setTimeout(() => resolve(null), 1200))
        ]);
        delivered = !!response?.ok;
      } catch (_) {
        delivered = false;
      }
      if (delivered) {
        // No activamos ni enfocamos StarTab: el usuario debe seguir en la
        // pestaña desde la que abrió el menú contextual.
        return;
      }
    }
  } catch (_) {}

  // Si no había una StarTab abierta, o no respondió a tiempo: NUNCA abrimos
  // una pestaña nueva solo para agregar un acceso (eso era el problema).
  // Como StarTab reemplaza la pestaña nueva del navegador, basta con dejar
  // la operación en cola: se añadirá sola, sin fallos ni demoras, en cuanto
  // el usuario abra su siguiente pestaña (algo que de todas formas suele
  // ocurrir enseguida, y sin interrumpir lo que esté haciendo ahora mismo).
  //
  // Se guarda como COLA (array), no como un único valor: si el usuario
  // agrega varios accesos seguidos desde distintas pestañas antes de volver
  // a abrir StarTab, cada `set` sobrescribiría al anterior y se perderían
  // todos menos el último. Con la cola, todos quedan y se procesan en orden
  // la próxima vez que se abra StarTab.
  pendingWriteChain = pendingWriteChain.then(async () => {
    try {
      const data = await chrome.storage.local.get(PENDING_KEY);
      const existente = data[PENDING_KEY];
      const cola = Array.isArray(existente) ? existente : (existente ? [existente] : []);
      cola.push(pending);
      await chrome.storage.local.set({ [PENDING_KEY]: cola });
    } catch (_) {}
  });
  await pendingWriteChain;
});

rebuildContextMenus(true);

/* ============================================================================
   StarTab · Global Media Registry 3.0
   Registro central compartido por TODAS las páginas StarTab.
   Los agentes de cada web publican aquí su estado y el service worker lo
   distribuye en tiempo real a cada nueva pestaña de StarTab abierta.
   ============================================================================ */
const MEDIA_REGISTRY_KEY = 'starTab_mediaRegistry_v4';
let mediaRegistry = Object.create(null);
let mediaRegistryLoaded = false;
let mediaPersistTimer = null;
let mediaLastPersistAt = 0;

function mediaSessionKey(tabId, frameId) {
  return `${tabId}:${Number.isInteger(frameId) ? frameId : 0}`;
}

function mediaText(value, max = 1024) {
  return String(value || '').slice(0, max);
}

async function ensureMediaRegistryLoaded() {
  if (mediaRegistryLoaded) return;
  mediaRegistryLoaded = true;
  try {
    const data = await chrome.storage.session.get(MEDIA_REGISTRY_KEY);
    const saved = data?.[MEDIA_REGISTRY_KEY];
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      mediaRegistry = saved;
      // Migración suave de registros anteriores: dar a cada sesión un orden
      // de llegada persistente. updatedAt sólo refleja actividad y jamás debe
      // cambiar la posición visual de una fuente multimedia.
      const legacy = Object.values(mediaRegistry)
        .filter(Boolean)
        .sort((a, b) => (Number(a.updatedAt) || 0) - (Number(b.updatedAt) || 0));
      const seed = Date.now() - legacy.length;
      legacy.forEach((session, index) => {
        if (!Number.isFinite(Number(session.firstSeenAt))) {
          session.firstSeenAt = Number(session.updatedAt) || (seed + index);
        }
      });
    }
  } catch (_) {
    mediaRegistry = Object.create(null);
  }
  await pruneMediaRegistryAgainstOpenTabs();
}

function scheduleMediaRegistryPersist() {
  if (mediaPersistTimer) return;
  const elapsed = Date.now() - mediaLastPersistAt;
  const delay = elapsed >= 1400 ? 80 : Math.max(80, 1400 - elapsed);
  mediaPersistTimer = setTimeout(async () => {
    mediaPersistTimer = null;
    mediaLastPersistAt = Date.now();
    try {
      await chrome.storage.session.set({ [MEDIA_REGISTRY_KEY]: mediaRegistry });
    } catch (_) {}
  }, delay);
}

function exportedMediaSessions() {
  // Orden estable y compartido por todas las pestañas StarTab. El estado de
  // reproducción sólo afecta el resaltado, nunca la posición de la tarjeta.
  return Object.values(mediaRegistry)
    .filter(session => session?.nativeEligible !== false)
    .sort((a, b) => {
      const af = Number(a.firstSeenAt) || Number(a.updatedAt) || 0;
      const bf = Number(b.firstSeenAt) || Number(b.updatedAt) || 0;
      return af - bf || (Number(a.tabId) || 0) - (Number(b.tabId) || 0) || (Number(a.frameId) || 0) - (Number(b.frameId) || 0);
    });
}

async function broadcastMediaRegistry() {
  const message = { type: 'STARTAB_MEDIA_REGISTRY_UPDATE', sessions: exportedMediaSessions() };
  try {
    await chrome.runtime.sendMessage(message);
  } catch (_) {}
}

async function pruneMediaRegistryAgainstOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    const open = new Map(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => [tab.id, tab]));
    let changed = false;
    for (const [key, session] of Object.entries(mediaRegistry)) {
      const tab = open.get(session.tabId);
      if (!tab) {
        delete mediaRegistry[key];
        changed = true;
        continue;
      }
      // Si una pestaña navegó y el agente anterior quedó persistido, se elimina.
      if (session.pageUrl && tab.url && session.pageUrl !== tab.url && !tab.url.startsWith(session.pageUrl + '#')) {
        delete mediaRegistry[key];
        changed = true;
      }
    }
    if (changed) scheduleMediaRegistryPersist();
  } catch (_) {}
}

function removeMediaForTab(tabId) {
  let changed = false;
  for (const [key, session] of Object.entries(mediaRegistry)) {
    if (session.tabId === tabId) {
      delete mediaRegistry[key];
      changed = true;
    }
  }
  if (changed) {
    scheduleMediaRegistryPersist();
    broadcastMediaRegistry();
  }
}

function sanitizeMediaPayload(payload, sender) {
  const tab = sender?.tab;
  if (!tab || !Number.isInteger(tab.id)) return null;
  const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
  const playbackState = ['playing', 'paused', 'ended'].includes(payload?.playbackState)
    ? payload.playbackState
    : 'paused';
  return {
    key: mediaSessionKey(tab.id, frameId),
    tabId: tab.id,
    frameId,
    windowId: tab.windowId,
    tabTitle: mediaText(tab.title, 500),
    pageUrl: mediaText(payload?.pageUrl || tab.url, 4096),
    host: mediaText(payload?.host, 300),
    favicon: mediaText(tab.favIconUrl, 4096),
    title: mediaText(payload?.title || tab.title || 'Contenido multimedia', 1000),
    artist: mediaText(payload?.artist, 1000),
    album: mediaText(payload?.album, 1000),
    artwork: mediaText(payload?.artwork, 8192),
    playbackState,
    currentTime: Math.max(0, Number(payload?.currentTime) || 0),
    duration: Math.max(0, Number(payload?.duration) || 0),
    playbackRate: Math.max(0.1, Math.min(16, Number(payload?.playbackRate) || 1)),
    volume: Math.max(0, Math.min(1, Number(payload?.volume) || 0)),
    muted: !!payload?.muted,
    canSeek: !!payload?.canSeek,
    canSeekBackward: !!payload?.canSeekBackward,
    canSeekForward: !!payload?.canSeekForward,
    canPrev: !!payload?.canPrev,
    canNext: !!payload?.canNext,
    canVolume: payload?.canVolume !== false,
    transportAdapter: mediaText(payload?.transportAdapter, 100),
    mediaKind: payload?.mediaKind === 'video' ? 'video' : 'audio',
    nativeEligible: payload?.nativeEligible !== false,
    controllable: true,
    readyState: Number(payload?.readyState) || 0,
    updatedAt: Date.now()
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith?.('STARTAB_MEDIA_')) return;

  if (message.type === 'STARTAB_MEDIA_STATE') {
    ensureMediaRegistryLoaded().then(() => {
      const session = sanitizeMediaPayload(message.payload, sender);
      if (!session) return;

      const previous = mediaRegistry[session.key];
      let tabFirstSeenAt = Number(previous?.firstSeenAt) || 0;
      if (!tabFirstSeenAt) {
        for (const existing of Object.values(mediaRegistry)) {
          if (existing?.tabId !== session.tabId) continue;
          const value = Number(existing.firstSeenAt) || 0;
          if (value && (!tabFirstSeenAt || value < tabFirstSeenAt)) tabFirstSeenAt = value;
        }
      }
      session.firstSeenAt = tabFirstSeenAt || Date.now();

      mediaRegistry[session.key] = session;
      scheduleMediaRegistryPersist();
      broadcastMediaRegistry();
    });
    return;
  }

  if (message.type === 'STARTAB_MEDIA_REMOVE_FRAME') {
    ensureMediaRegistryLoaded().then(() => {
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId)) return;
      const key = mediaSessionKey(tabId, Number.isInteger(sender.frameId) ? sender.frameId : 0);
      if (!mediaRegistry[key]) return;
      delete mediaRegistry[key];
      scheduleMediaRegistryPersist();
      broadcastMediaRegistry();
    });
    return;
  }

  if (message.type === 'STARTAB_MEDIA_GET_REGISTRY') {
    ensureMediaRegistryLoaded().then(() => {
      sendResponse({ ok: true, sessions: exportedMediaSessions() });
    }).catch(error => sendResponse({ ok: false, reason: String(error?.message || error), sessions: [] }));
    return true;
  }

  if (message.type === 'STARTAB_MEDIA_CONTROL') {
    (async () => {
      await ensureMediaRegistryLoaded();
      const tabId = Number(message?.target?.tabId);
      const frameId = Number(message?.target?.frameId) || 0;
      if (!Number.isInteger(tabId)) {
        sendResponse({ ok: false, reason: 'invalid-target' });
        return;
      }
      const key = mediaSessionKey(tabId, frameId);
      const session = mediaRegistry[key];
      if (!session) {
        sendResponse({ ok: false, reason: 'media-session-not-found' });
        return;
      }
      try {
        const result = await chrome.tabs.sendMessage(
          tabId,
          { type: 'STARTAB_MEDIA_COMMAND', command: message.command || {} },
          { frameId }
        );
        if (result?.ok && result?.state && typeof result.state === 'object') {
          // El agente devuelve el estado post-comando. Lo promovemos de inmediato
          // al registro central para que TODAS las pestañas StarTab cambien a la vez.
          const refreshed = sanitizeMediaPayload(result.state, {
            tab: {
              id: session.tabId,
              windowId: session.windowId,
              title: session.tabTitle,
              url: session.pageUrl,
              favIconUrl: session.favicon
            },
            frameId: session.frameId
          });
          if (refreshed) {
            refreshed.favicon = session.favicon || refreshed.favicon;
            refreshed.tabTitle = session.tabTitle || refreshed.tabTitle;
            refreshed.firstSeenAt = Number(session.firstSeenAt) || Date.now();
            mediaRegistry[key] = refreshed;
            scheduleMediaRegistryPersist();
            broadcastMediaRegistry();
            result.state = refreshed;
          }
        } else if (!result?.ok && (message?.command?.action === 'prev' || message?.command?.action === 'next')) {
          const field = message.command.action === 'prev' ? 'canPrev' : 'canNext';
          session[field] = false;
          session.updatedAt = Date.now();
          mediaRegistry[key] = session;
          scheduleMediaRegistryPersist();
          broadcastMediaRegistry();
        }
        sendResponse(result || { ok: false, reason: 'no-agent-response' });
      } catch (error) {
        sendResponse({ ok: false, reason: String(error?.message || error) });
      }
    })();
    return true;
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  ensureMediaRegistryLoaded().then(() => removeMediaForTab(tabId));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    ensureMediaRegistryLoaded().then(() => removeMediaForTab(tabId));
  }
});

async function bootstrapMediaAgents() {
  await ensureMediaRegistryLoaded();
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(tabs
      .filter(tab => Number.isInteger(tab.id) && /^https?:\/\//i.test(tab.url || ''))
      .map(async tab => {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: ['media-session-bridge.js'],
            world: 'MAIN'
          });
        } catch (_) {}
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: ['media-agent.js'],
            world: 'ISOLATED'
          });
        } catch (_) {}
      })
    );
  } catch (_) {}
}

chrome.runtime.onInstalled.addListener(() => bootstrapMediaAgents());
chrome.runtime.onStartup.addListener(() => bootstrapMediaAgents());
// También al arrancar/rearrancar el service worker: así una recarga manual de
// la extensión conecta las pestañas que ya estaban abiertas sin obligar a
// cerrar StarTab. Los agentes/bridge tienen guardas contra doble inyección.
bootstrapMediaAgents();
