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
