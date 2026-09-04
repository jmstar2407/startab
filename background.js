const MENU_ROOT='startab-add-root';const MENU_PREFIX='startab-add-category-';const STORAGE_KEY='starTab_contextMenuCategories';const PENDING_KEY='starTab_pendingContextAdd';let pendingWriteChain=Promise.resolve();let contextMenuRebuildChain=Promise.resolve();let lastContextMenuSignature=null;function buildFavicon(url){try{const host=new URL(url).hostname;return`https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`;}catch(_){return'';}}async function getCategories(){const data=await chrome.storage.local.get(STORAGE_KEY);const cats=Array.isArray(data[STORAGE_KEY])?data[STORAGE_KEY]:[];return cats.length?cats:[{id:'general',nombre:'General',orden:1}];}async function performContextMenuRebuild(force=false){const cats=await getCategories();cats.sort((a,b)=>(a.orden||999)-(b.orden||999));const signature=JSON.stringify(cats.map(cat=>[cat.id,cat.nombre||'Sin nombre',cat.orden||999]));if(!force&&signature===lastContextMenuSignature)return;await chrome.contextMenus.removeAll();chrome.contextMenus.create({id:MENU_ROOT,title:'Añadir a StarTab',contexts:['tab']});for(const cat of cats){chrome.contextMenus.create({id:MENU_PREFIX+cat.id,parentId:MENU_ROOT,title:cat.nombre||'Sin nombre',contexts:['tab']});}lastContextMenuSignature=signature;}function rebuildContextMenus(force=false){contextMenuRebuildChain=contextMenuRebuildChain.catch(()=>{}).then(()=>performContextMenuRebuild(force)).catch(error=>console.error('StarTab: no se pudo crear el menú contextual',error));return contextMenuRebuildChain;}chrome.runtime.onInstalled.addListener(()=>rebuildContextMenus(true));chrome.runtime.onStartup.addListener(()=>rebuildContextMenus(true));chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[STORAGE_KEY])rebuildContextMenus(false);});chrome.contextMenus.onClicked.addListener(async(info,tab)=>{const menuItemId=String(info?.menuItemId||'');if(!tab||!menuItemId.startsWith(MENU_PREFIX))return;const categoryId=menuItemId.slice(MENU_PREFIX.length);const url=tab.url||'';if(!/^https?:\/\//i.test(url))return;const pending={id:Date.now()+'_'+Math.random().toString(36).slice(2),categoriaId:categoryId,nombre:(tab.title||'').trim().slice(0,120)||(()=>{try{return new URL(url).hostname;}catch(_){return'Acceso directo';}})(),url,icono:buildFavicon(url),createdAt:Date.now()};try{const tabs=await chrome.tabs.query({});const starTab=tabs.find(t=>t.url&&t.url.startsWith(chrome.runtime.getURL('index.html')));if(starTab&&starTab.id!=null){let delivered=false;try{const response=await Promise.race([chrome.runtime.sendMessage({type:'STARTAB_ADD_CONTEXT_TAB',payload:pending}),new Promise(resolve=>setTimeout(()=>resolve(null),1200))]);delivered=!!response?.ok;}catch(_){delivered=false;}if(delivered){return;}}}catch(_){}pendingWriteChain=pendingWriteChain.then(async()=>{try{const data=await chrome.storage.local.get(PENDING_KEY);const existente=data[PENDING_KEY];const cola=Array.isArray(existente)?existente:(existente?[existente]:[]);cola.push(pending);await chrome.storage.local.set({[PENDING_KEY]:cola});}catch(_){}});await pendingWriteChain;});rebuildContextMenus(true);const MEDIA_REGISTRY_KEY='starTab_mediaRegistry_v4';let mediaRegistry=Object.create(null);let mediaRegistryLoaded=false;let mediaPersistTimer=null;let mediaLastPersistAt=0;function mediaSessionKey(tabId,frameId){return`${tabId}:${Number.isInteger(frameId)?frameId:0}`;}function mediaText(value,max=1024){return String(value||'').slice(0,max);}async function ensureMediaRegistryLoaded(){if(mediaRegistryLoaded)return;mediaRegistryLoaded=true;try{const data=await chrome.storage.session.get(MEDIA_REGISTRY_KEY);const saved=data?.[MEDIA_REGISTRY_KEY];if(saved&&typeof saved==='object'&&!Array.isArray(saved)){mediaRegistry=saved;const legacy=Object.values(mediaRegistry).filter(Boolean).sort((a,b)=>(Number(a.updatedAt)||0)-(Number(b.updatedAt)||0));const seed=Date.now()-legacy.length;legacy.forEach((session,index)=>{if(!Number.isFinite(Number(session.firstSeenAt))){session.firstSeenAt=Number(session.updatedAt)||(seed+index);}});}}catch(_){mediaRegistry=Object.create(null);}await pruneMediaRegistryAgainstOpenTabs();}function scheduleMediaRegistryPersist(){if(mediaPersistTimer)return;const elapsed=Date.now()-mediaLastPersistAt;const delay=elapsed>=1400?80:Math.max(80,1400-elapsed);mediaPersistTimer=setTimeout(async()=>{mediaPersistTimer=null;mediaLastPersistAt=Date.now();try{await chrome.storage.session.set({[MEDIA_REGISTRY_KEY]:mediaRegistry});}catch(_){}},delay);}function exportedMediaSessions(){return Object.values(mediaRegistry).filter(session=>session?.nativeEligible!==false).sort((a,b)=>{const af=Number(a.firstSeenAt)||Number(a.updatedAt)||0;const bf=Number(b.firstSeenAt)||Number(b.updatedAt)||0;return af-bf||(Number(a.tabId)||0)-(Number(b.tabId)||0)||(Number(a.frameId)||0)-(Number(b.frameId)||0);});}async function broadcastMediaRegistry(){const message={type:'STARTAB_MEDIA_REGISTRY_UPDATE',sessions:exportedMediaSessions()};try{await chrome.runtime.sendMessage(message);}catch(_){}}async function pruneMediaRegistryAgainstOpenTabs(){try{const tabs=await chrome.tabs.query({});const open=new Map(tabs.filter(tab=>Number.isInteger(tab.id)).map(tab=>[tab.id,tab]));let changed=false;for(const[key,session]of Object.entries(mediaRegistry)){const tab=open.get(session.tabId);if(!tab){delete mediaRegistry[key];changed=true;continue;}if(session.pageUrl&&tab.url&&session.pageUrl!==tab.url&&!tab.url.startsWith(session.pageUrl+'#')){delete mediaRegistry[key];changed=true;}}if(changed)scheduleMediaRegistryPersist();}catch(_){}}function removeMediaForTab(tabId){let changed=false;for(const[key,session]of Object.entries(mediaRegistry)){if(session.tabId===tabId){delete mediaRegistry[key];changed=true;}}if(changed){scheduleMediaRegistryPersist();broadcastMediaRegistry();}}function sanitizeMediaPayload(payload,sender){const tab=sender?.tab;if(!tab||!Number.isInteger(tab.id))return null;const frameId=Number.isInteger(sender.frameId)?sender.frameId:0;const playbackState=['playing','paused','ended'].includes(payload?.playbackState)?payload.playbackState:'paused';return{key:mediaSessionKey(tab.id,frameId),tabId:tab.id,frameId,windowId:tab.windowId,tabTitle:mediaText(tab.title,500),pageUrl:mediaText(payload?.pageUrl||tab.url,4096),host:mediaText(payload?.host,300),favicon:mediaText(tab.favIconUrl,4096),title:mediaText(payload?.title||tab.title||'Contenido multimedia',1000),artist:mediaText(payload?.artist,1000),album:mediaText(payload?.album,1000),artwork:mediaText(payload?.artwork,8192),playbackState,currentTime:Math.max(0,Number(payload?.currentTime)||0),duration:Math.max(0,Number(payload?.duration)||0),playbackRate:Math.max(0.1,Math.min(16,Number(payload?.playbackRate)||1)),volume:Math.max(0,Math.min(1,Number(payload?.volume)||0)),muted:!!payload?.muted,canSeek:!!payload?.canSeek,canSeekBackward:!!payload?.canSeekBackward,canSeekForward:!!payload?.canSeekForward,canPrev:!!payload?.canPrev,canNext:!!payload?.canNext,canVolume:payload?.canVolume!==false,transportAdapter:mediaText(payload?.transportAdapter,100),mediaKind:payload?.mediaKind==='video'?'video':'audio',nativeEligible:payload?.nativeEligible!==false,controllable:true,readyState:Number(payload?.readyState)||0,updatedAt:Date.now()};}chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{if(!message?.type?.startsWith?.('STARTAB_MEDIA_'))return;if(message.type==='STARTAB_MEDIA_STATE'){ensureMediaRegistryLoaded().then(()=>{const session=sanitizeMediaPayload(message.payload,sender);if(!session)return;const previous=mediaRegistry[session.key];let tabFirstSeenAt=Number(previous?.firstSeenAt)||0;if(!tabFirstSeenAt){for(const existing of Object.values(mediaRegistry)){if(existing?.tabId!==session.tabId)continue;const value=Number(existing.firstSeenAt)||0;if(value&&(!tabFirstSeenAt||value<tabFirstSeenAt))tabFirstSeenAt=value;}}session.firstSeenAt=tabFirstSeenAt||Date.now();mediaRegistry[session.key]=session;scheduleMediaRegistryPersist();broadcastMediaRegistry();});return;}if(message.type==='STARTAB_MEDIA_REMOVE_FRAME'){ensureMediaRegistryLoaded().then(()=>{const tabId=sender?.tab?.id;if(!Number.isInteger(tabId))return;const key=mediaSessionKey(tabId,Number.isInteger(sender.frameId)?sender.frameId:0);if(!mediaRegistry[key])return;delete mediaRegistry[key];scheduleMediaRegistryPersist();broadcastMediaRegistry();});return;}if(message.type==='STARTAB_MEDIA_GET_REGISTRY'){ensureMediaRegistryLoaded().then(()=>{sendResponse({ok:true,sessions:exportedMediaSessions()});}).catch(error=>sendResponse({ok:false,reason:String(error?.message||error),sessions:[]}));return true;}if(message.type==='STARTAB_MEDIA_CONTROL'){(async()=>{await ensureMediaRegistryLoaded();const tabId=Number(message?.target?.tabId);const frameId=Number(message?.target?.frameId)||0;if(!Number.isInteger(tabId)){sendResponse({ok:false,reason:'invalid-target'});return;}const key=mediaSessionKey(tabId,frameId);const session=mediaRegistry[key];if(!session){sendResponse({ok:false,reason:'media-session-not-found'});return;}try{const result=await chrome.tabs.sendMessage(tabId,{type:'STARTAB_MEDIA_COMMAND',command:message.command||{}},{frameId});if(result?.ok&&result?.state&&typeof result.state==='object'){const refreshed=sanitizeMediaPayload(result.state,{tab:{id:session.tabId,windowId:session.windowId,title:session.tabTitle,url:session.pageUrl,favIconUrl:session.favicon},frameId:session.frameId});if(refreshed){refreshed.favicon=session.favicon||refreshed.favicon;refreshed.tabTitle=session.tabTitle||refreshed.tabTitle;refreshed.firstSeenAt=Number(session.firstSeenAt)||Date.now();mediaRegistry[key]=refreshed;scheduleMediaRegistryPersist();broadcastMediaRegistry();result.state=refreshed;}}else if(!result?.ok&&(message?.command?.action==='prev'||message?.command?.action==='next')){const field=message.command.action==='prev'?'canPrev':'canNext';session[field]=false;session.updatedAt=Date.now();mediaRegistry[key]=session;scheduleMediaRegistryPersist();broadcastMediaRegistry();}sendResponse(result||{ok:false,reason:'no-agent-response'});}catch(error){sendResponse({ok:false,reason:String(error?.message||error)});}})();return true;}});chrome.tabs.onRemoved.addListener(tabId=>{ensureMediaRegistryLoaded().then(()=>removeMediaForTab(tabId));});chrome.tabs.onUpdated.addListener((tabId,changeInfo)=>{if(changeInfo.status==='loading'||changeInfo.url){ensureMediaRegistryLoaded().then(()=>removeMediaForTab(tabId));}});async function bootstrapMediaAgents(){await ensureMediaRegistryLoaded();try{const tabs=await chrome.tabs.query({});await Promise.allSettled(tabs.filter(tab=>Number.isInteger(tab.id)&&/^https?:\/\//i.test(tab.url||'')).map(async tab=>{try{await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['media-session-bridge.js'],world:'MAIN'});}catch(_){}try{await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['media-agent.js'],world:'ISOLATED'});}catch(_){}}));}catch(_){}}chrome.runtime.onInstalled.addListener(()=>bootstrapMediaAgents());chrome.runtime.onStartup.addListener(()=>bootstrapMediaAgents());bootstrapMediaAgents();
/* StarTab Windows master volume · Native Messaging bridge v2 */
(() => {
  'use strict';

  const HOST = 'com.startab.windows_volume';
  const OFFSCREEN_PATH = 'windows-volume-offscreen.html';
  const IS_WINDOWS = /Windows/i.test(navigator.userAgent || '');
  const RECONNECT_MS = 30_000;

  let nativePort = null;
  let nativeConnected = false;
  let nativeState = null;
  let reconnectTimer = null;
  let creatingOffscreen = null;

  async function ensureOffscreen() {
    if (!IS_WINDOWS || !chrome.offscreen) return;
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl],
      });
      if (contexts.length) return;
    } catch (_) {}

    if (creatingOffscreen) return creatingOffscreen;
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['LOCAL_STORAGE'],
      justification: 'Mantener la sesión de StarTab que sincroniza el volumen del PC con Firestore mientras Chrome está abierto.',
    }).catch((error) => {
      console.warn('StarTab Windows: no se pudo crear el bridge offscreen:', error);
    }).finally(() => {
      creatingOffscreen = null;
    });
    return creatingOffscreen;
  }

  function sendRuntime(message) {
    try {
      const promise = chrome.runtime.sendMessage(message);
      if (promise?.catch) promise.catch(() => {});
    } catch (_) {}
  }

  function emitToOffscreen(payload) {
    void ensureOffscreen().then(() => {
      sendRuntime({
        type: 'STARTAB_WINDOWS_NATIVE_EVENT',
        target: 'startab-windows-offscreen',
        payload,
      });
    });
  }

  function broadcastStatus(error = null) {
    sendRuntime({
      type: 'STARTAB_WINDOWS_NATIVE_STATUS',
      connected: nativeConnected,
      state: nativeState,
      error,
    });
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectNative, RECONNECT_MS);
  }

  function connectNative() {
    if (!IS_WINDOWS || nativePort) return;
    void ensureOffscreen();

    try {
      nativePort = chrome.runtime.connectNative(HOST);
    } catch (error) {
      nativePort = null;
      nativeConnected = false;
      broadcastStatus(String(error?.message || error));
      scheduleReconnect();
      return;
    }

    nativePort.onMessage.addListener((message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'hello' || message.type === 'state') {
        nativeConnected = true;
        nativeState = { ...(nativeState || {}), ...message };
      }
      emitToOffscreen({ kind: 'message', message });
      broadcastStatus();
    });

    nativePort.onDisconnect.addListener(() => {
      const reason = chrome.runtime.lastError?.message || null;
      nativePort = null;
      nativeConnected = false;
      emitToOffscreen({ kind: 'disconnected', error: reason, state: nativeState });
      broadcastStatus(reason);
      scheduleReconnect();
    });

    try { nativePort.postMessage({ type: 'getState' }); } catch (_) {}
  }

  function postNativeCommand(command) {
    if (!nativePort || !nativeConnected) return false;
    if (!command || typeof command !== 'object') return false;
    const type = String(command.type || '');
    if (!['getState', 'setVolume', 'setMute', 'toggleMute', 'step', 'ping'].includes(type)) return false;
    try {
      nativePort.postMessage(command);
      return true;
    } catch (_) {
      return false;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.type?.startsWith?.('STARTAB_WINDOWS_NATIVE_')) return;

    if (message.type === 'STARTAB_WINDOWS_NATIVE_GET_STATE') {
      sendResponse({ connected: nativeConnected, state: nativeState });
      return;
    }

    if (message.type === 'STARTAB_WINDOWS_NATIVE_RECONNECT') {
      clearTimeout(reconnectTimer);
      connectNative();
      sendResponse({ ok: true, connected: nativeConnected });
      return;
    }

    if (message.type === 'STARTAB_WINDOWS_NATIVE_COMMAND') {
      const ok = postNativeCommand(message.command);
      sendResponse({ ok, reason: ok ? null : 'native-disconnected' });
      return;
    }
  });

  chrome.runtime.onInstalled.addListener(() => {
    void ensureOffscreen();
    connectNative();
  });
  chrome.runtime.onStartup.addListener(() => {
    void ensureOffscreen();
    connectNative();
  });

  void ensureOffscreen();
  connectNative();
})();
