// script.js - VERSIÓN CORREGIDA CON CATEGORÍAS EDITABLES Y ARRASTRABLES
// ===== CONFIGURACIÓN DE FIREBASE =====
const firebaseConfig = {
    apiKey: "AIzaSyBU8DyN2kRcDq0fxB20qRUXWBHV0E-0d6A",
    authDomain: "startab-44e48.firebaseapp.com",
    projectId: "startab-44e48",
    storageBucket: "startab-44e48.firebasestorage.app",
    messagingSenderId: "874084877753",
    appId: "1:874084877753:web:cf9cbe9a344356dc9be268"
};

// Variables de Firebase
let db = null;
let auth = null;
let currentUser = null;
let userDocRef = null;
let unsubscribeCategories = null;
let unsubscribeNotas = null;
let firestorePersistenceReady = Promise.resolve();

// URL de autenticación
const AUTH_PAGE = 'https://jmstar2407.github.io/startab/auth.html';

// ===== CONSTANTES =====
const MAX_CATEGORIAS = 6;

const URLS_BUSQUEDA = {
    google: {
        web: 'https://www.google.com/search?q=',
        imagenes: 'https://www.google.com/search?tbm=isch&q=',
        video: 'https://www.google.com/search?tbm=vid&q=',
        noticias: 'https://www.google.com/search?tbm=nws&q='
    },
    bing: {
        web: 'https://www.bing.com/search?q=',
        imagenes: 'https://www.bing.com/images/search?q=',
        video: 'https://www.bing.com/videos/search?q=',
        noticias: 'https://www.bing.com/news/search?q='
    },
    duckduckgo: {
        web: 'https://duckduckgo.com/?q=',
        imagenes: 'https://duckduckgo.com/?q={termino}&iax=images&ia=images',
        video: 'https://duckduckgo.com/?q={termino}&iax=videos&ia=videos',
        noticias: 'https://duckduckgo.com/?q={termino}&iar=news&ia=news'
    }
};

const ESTILOS_DEFAULT = { tieneFondo: false, colorFondo: '#667eea', radioBorde: 0, tamanoIcono: 100 };
const NOMBRES_BUSCADOR = { google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo' };

const FONDO_DEFAULT = {
    tipo: 'imagen',
    url: 'img/backgrounds/img_background_1.jpg',
    opacidad: 0.2,
    desenfoque: 0,
    colorInicio: '#667eea',
    colorFin: '#764ba2'
};

// Configuración de la categoría General - AHORA EDITABLE
const CATEGORIA_GENERAL = {
    id: 'general',
    nombre: 'General',
    editable: true,
    orden: 1,
    background: { ...FONDO_DEFAULT }
};

// ===== NOTAS =====
let notaTimeouts = {};
let notaDOMActual = null;
let notaSyncResetTimer = null;
let notaMapaFirebaseVisto = false;
const NOTA_SAVE_DEBOUNCE = 5000;
const notaClienteId = (() => {
    const key = 'startab_notes_client_id';
    try {
        const existing = sessionStorage.getItem(key);
        if (existing) return existing;
        const created = (globalThis.crypto?.randomUUID?.() || `startab-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        sessionStorage.setItem(key, created);
        return created;
    } catch (_) {
        return `startab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
})();
let notaEstado = {
    sincronizado: true,
    notaActual: 1,
    notas: {
        1: { sincronizado: true, contenido: '', pendiente: false, writeSeq: 0, lastLocalEditAt: 0 },
        2: { sincronizado: true, contenido: '', pendiente: false, writeSeq: 0, lastLocalEditAt: 0 },
        3: { sincronizado: true, contenido: '', pendiente: false, writeSeq: 0, lastLocalEditAt: 0 },
        4: { sincronizado: true, contenido: '', pendiente: false, writeSeq: 0, lastLocalEditAt: 0 },
        5: { sincronizado: true, contenido: '', pendiente: false, writeSeq: 0, lastLocalEditAt: 0 }
    }
};

// ===== ESTADO DE LA APLICACIÓN =====
let categorias = [];
let iconosCache = new Map();

const estado = {
    categoriaActual: localStorage.getItem('categoriaSeleccionada') || 'general',
    buscadorActual: (() => {
        const saved = localStorage.getItem('buscadorSeleccionado');
        return saved && ['google', 'bing', 'duckduckgo'].includes(saved) ? saved : 'google';
    })(),
    filtroActual: 'web',
    iconoSeleccionadoIndex: null,
    elementoArrastrado: null,
    iconosActuales: [],
    isAuthenticated: false,
    firebaseInicializado: false
};

// ===== VARIABLES DE OPTIMIZACIÓN =====
let _renderizando = false;
let _iconosCache = null;
let _iconosCacheKey = null;
let _ultimoRenderizado = 0;
const DEBOUNCE_TIME = 100;

// El menú contextual puede entregar un acceso antes de que Firebase termine
// de hidratar las categorías. No procesamos la cola en ese momento porque el
// snapshot de Firebase podría sobrescribir inmediatamente el acceso recién
// agregado. Esperamos a que exista la sesión y las categorías reales.
let _startabCategoriasListas = false;
let _procesandoContextPending = false;

// ===== CACHÉ DE ELEMENTOS DOM =====
const DOM = {};

function cachearElementos() {
    DOM.contenedorIconos = document.getElementById('contenedor-iconos');
    DOM.barraBusqueda = document.getElementById('barra-busqueda');
    DOM.btnBuscar = document.getElementById('btn-buscar');
    DOM.btnLimpiar = document.getElementById('btn-limpiar');
    DOM.btnMicrofono = document.getElementById('btn-microfono');
    DOM.btnAgregar = document.getElementById('btn-agregar');
    DOM.btnPersonalizar = document.getElementById('btn-personalizar');
    DOM.modalIconos = document.getElementById('modal-iconos');
    DOM.modalPersonalizar = document.getElementById('modal-personalizar');
    DOM.authContainer = document.getElementById('auth-container');
    DOM.authBtn = document.getElementById('auth-btn');
    DOM.userMenu = document.getElementById('user-menu');
    DOM.userAvatar = document.getElementById('user-avatar');
    DOM.userDropdown = document.getElementById('user-dropdown');
    DOM.userName = document.getElementById('user-name');
    DOM.userEmail = document.getElementById('user-email');
    DOM.logoutBtn = document.getElementById('logout-btn');
}

// ===== INICIALIZACIÓN DE FIREBASE =====
function initFirebase() {
    if (estado.firebaseInicializado) return true;
    
    try {
        if (typeof firebase !== 'undefined' && !db) {
            firebase.initializeApp(firebaseConfig);
            db = firebase.firestore();

            // OFFLINE PERSISTENCE: Firestore conserva datos en caché y
            // encola escrituras sin Internet para sincronizarlas después.
            firestorePersistenceReady = db.enablePersistence({ synchronizeTabs: true })
                .then(() => {
                    console.log('StarTab: persistencia offline activada');
                })
                .catch((error) => {
                    if (error.code === 'failed-precondition') {
                        console.warn('StarTab: otra pestaña ya está usando la caché de Firestore. Se continuará usando la caché disponible.');
                    } else if (error.code === 'unimplemented') {
                        console.warn('StarTab: el navegador no soporta persistencia offline.');
                    } else {
                        console.warn('StarTab: error activando persistencia offline:', error);
                    }
                });

            auth = firebase.auth();
            
            // Persistencia permanente: la sesión nunca expira hasta logout explícito
            auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
                .catch(e => console.warn('setPersistence:', e));

            // Escuchar cambios de estado de Firebase Auth (fuente de verdad)
            auth.onAuthStateChanged(async (firebaseUser) => {
                if (firebaseUser) {
                    // Usuario autenticado en Firebase: refrescar token y actualizar sesión
                    const token = await firebaseUser.getIdToken(true).catch(() => null);
                    const userData = {
                        uid: firebaseUser.uid,
                        email: firebaseUser.email,
                        displayName: firebaseUser.displayName,
                        photoURL: firebaseUser.photoURL,
                        token: token,
                        emailVerified: firebaseUser.emailVerified,
                        timestamp: Date.now()
                    };
                    // Guardar sesión con token actualizado
                    localStorage.setItem('starTab_lastUser', JSON.stringify(userData));

                    if (!currentUser || currentUser.uid !== firebaseUser.uid) {
                        currentUser = userData;
                        estado.isAuthenticated = true;
                        actualizarUIAutenticacion(userData);
                        habilitarEdicion(true);
                        cargarCategoriasUsuario(userData.uid);
                    } else {
                        // Actualizar token en currentUser sin recargar todo
                        currentUser.token = token;
                        currentUser.timestamp = Date.now();
                    }

                    // Iniciar renovación automática del token cada 50 minutos
                    iniciarRenovacionAutomaticaToken();
                } else {
                    // Firebase confirma que no hay sesión activa.
                    // Solo actuar si el usuario YA estaba autenticado en esta sesión
                    // (evita cerrar sesión en el primer arranque en frío antes de que Firebase responda)
                    if (estado._firebaseRespondio && estado.isAuthenticated) {
                        console.warn('Sesión de Firebase expirada o revocada por Google.');
                        cancelarGuardadosNotasPendientes();
                        currentUser = null;
                        estado.isAuthenticated = false;
                        desconectarNotasTiempoReal();
                        localStorage.removeItem('starTab_lastUser');
                        localStorage.removeItem('starTab_auth_data');
                        actualizarUIAutenticacion(null);
                        habilitarEdicion(false);
                        cargarCategoriasLocales();
                    }
                    estado._firebaseRespondio = true;
                }
            });

            estado.firebaseInicializado = true;
            console.log('Firebase inicializado correctamente');
            return true;
        }
    } catch (e) {
        console.error('Error al inicializar Firebase:', e);
    }
    return false;
}

// ===== UTILIDADES =====
const convertirABase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
});

// Tamaño máximo (px) para cualquier icono que se guarde en Firebase.
// Se limita el LADO MÁS GRANDE (ancho o alto) a este valor, sin importar
// si el icono llegó por archivo subido o por URL externa.
const ICONO_TAMANO_MAX_GUARDADO = 256;

// Dibuja una imagen ya cargada (HTMLImageElement) en un canvas, la redimensiona
// para que su lado más grande no supere maxSize, y devuelve un data URL (base64)
// optimizado. Se usa tanto para archivos subidos como para imágenes descargadas
// desde una URL, por lo que centraliza toda la lógica de compresión.
const _redimensionarImagenEnCanvas = (img, maxSize, tipoOriginal = '') => {
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    if (!width || !height) {
        throw new Error('La imagen no tiene dimensiones válidas');
    }

    const esVectorial = tipoOriginal === 'image/svg+xml';
    const ladoMayor = Math.max(width, height);

    // Los SVG suelen declarar un tamaño intrínseco muy pequeño (ej. 24x24,
    // típico en iconos como los de lucide.dev), pero al ser vectores se
    // pueden re-renderizar a mayor resolución sin perder nitidez. Por eso
    // siempre se escalan al tamaño objetivo (hacia arriba o abajo).
    // Las imágenes rasterizadas (png/jpg/webp...) solo se reducen si son
    // más grandes que el máximo permitido; nunca se agrandan, para no
    // verse borrosas/pixeladas.
    if (esVectorial || ladoMayor > maxSize) {
        const ratio = maxSize / ladoMayor;
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    let mimeType = 'image/jpeg';
    let calidad = 0.95;

    if (tipoOriginal === 'image/png' || tipoOriginal === 'image/webp' || esVectorial || !tipoOriginal) {
        mimeType = 'image/png';
        calidad = 1;
    }

    const imageData = ctx.getImageData(0, 0, width, height);
    let hasTransparency = false;

    if (mimeType === 'image/jpeg') {
        for (let i = 3; i < imageData.data.length; i += 4) {
            if (imageData.data[i] < 255) {
                hasTransparency = true;
                break;
            }
        }

        if (hasTransparency) {
            mimeType = 'image/png';
            calidad = 1;
        }
    }

    return canvas.toDataURL(mimeType, calidad);
};

const comprimirYRedimensionarImagen = async (file, maxSize = ICONO_TAMANO_MAX_GUARDADO) => {
    return new Promise((resolve, reject) => {
        if (file.type === 'image/gif') {
            // Se conserva el GIF tal cual para no perder la animación.
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
            return;
        }

        const url = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(url);
            try {
                resolve(_redimensionarImagenEnCanvas(img, maxSize, file.type));
            } catch (err) {
                reject(err);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('No se pudo leer el archivo de imagen'));
        };
        img.src = url;
    });
};

// Detecta si el valor escrito en el campo "Icono" es una URL remota (http/https)
// en lugar de un data: URI ya convertido a base64.
const esURLDeImagenRemota = valor => /^https?:\/\//i.test((valor || '').trim());

// Descarga una imagen desde una URL externa (sin importar su formato: png, jpg,
// webp, svg, ico, gif, etc.), y la convierte a base64 comprimida/redimensionada
// a un máximo de `maxSize` px por lado, para optimizar el guardado en Firebase.
const convertirURLaBase64Comprimido = async (urlImagen, maxSize = ICONO_TAMANO_MAX_GUARDADO) => {
    const respuesta = await fetch(urlImagen, { credentials: 'omit' });
    if (!respuesta.ok) {
        throw new Error(`No se pudo descargar la imagen (HTTP ${respuesta.status})`);
    }

    const blob = await respuesta.blob();

    // Algunos servidores no envían un Content-Type correcto (ej. sirven un
    // .svg como "text/plain"), así que además del tipo MIME del blob se usa
    // la extensión del enlace como respaldo para no perder la detección.
    const extensionURL = (urlImagen.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
    const extensionesImagen = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'];
    const pareceImagenPorExtension = extensionesImagen.includes(extensionURL);

    let tipoDetectado = blob.type;
    if ((!tipoDetectado || !tipoDetectado.startsWith('image/')) && extensionURL === 'svg') {
        tipoDetectado = 'image/svg+xml';
    }

    if ((!tipoDetectado || !tipoDetectado.startsWith('image/')) && !pareceImagenPorExtension) {
        throw new Error('El enlace no apunta a una imagen válida');
    }

    if (tipoDetectado === 'image/gif') {
        // Igual que con los GIF subidos como archivo, se conserva la animación.
        return await convertirABase64(blob);
    }

    // Si el tipo detectado no coincide con el declarado por el servidor
    // (ej. SVG servido con Content-Type incorrecto), se reetiqueta el blob
    // para que el navegador lo interprete correctamente al cargarlo.
    const blobParaImagen = tipoDetectado && tipoDetectado !== blob.type
        ? new Blob([blob], { type: tipoDetectado })
        : blob;

    const blobUrl = URL.createObjectURL(blobParaImagen);

    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
            try {
                resolve(_redimensionarImagenEnCanvas(img, maxSize, tipoDetectado));
            } catch (err) {
                reject(err);
            } finally {
                URL.revokeObjectURL(blobUrl);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            reject(new Error('No se pudo procesar la imagen descargada (formato no soportado por el navegador)'));
        };

        img.src = blobUrl;
    });
};

// ===== FUNCIONES DE AUTENTICACIÓN =====
async function iniciarSesionGoogle() {
    try {
        if (!DOM.authBtn) return;
        
        DOM.authBtn.disabled = true;
        DOM.authBtn.innerHTML = '<img class="auth-btn-icon" src="img/icons/log_in_1.png" alt="Iniciar sesión">';

        const authWindow = window.open(
            AUTH_PAGE,
            'StarTab Auth',
            'width=500,height=700,left=100,top=100,scrollbars=yes,resizable=yes'
        );

        if (!authWindow) {
            alert('Por favor, permite las ventanas emergentes para iniciar sesión');
            DOM.authBtn.disabled = false;
            DOM.authBtn.innerHTML = '<img class="auth-btn-icon" src="img/icons/log_in_1.png" alt="Iniciar sesión">';
            return;
        }

        const messageHandler = async (event) => {
            if (!event.origin.includes('github.io') && !event.origin.includes('localhost')) return;

            if (event.data?.type === 'STAR_TAB_AUTH_SUCCESS') {
                window.removeEventListener('message', messageHandler);
                await procesarAutenticacionExitosa(event.data.user);
                if (authWindow && !authWindow.closed) {
                    setTimeout(() => authWindow.close(), 1000);
                }
            }
        };

        window.addEventListener('message', messageHandler);

        const checkInterval = setInterval(() => {
            try {
                const authData = localStorage.getItem('starTab_auth_data');
                if (authData) {
                    clearInterval(checkInterval);
                    window.removeEventListener('message', messageHandler);
                    localStorage.removeItem('starTab_auth_data');
                    const userData = JSON.parse(authData);
                    procesarAutenticacionExitosa(userData);
                    if (authWindow && !authWindow.closed) {
                        authWindow.close();
                    }
                }
            } catch (e) {
                console.error('Error en polling:', e);
            }
        }, 1000);

        setTimeout(() => {
            clearInterval(checkInterval);
            window.removeEventListener('message', messageHandler);
            if (!estado.isAuthenticated) {
                DOM.authBtn.disabled = false;
                DOM.authBtn.innerHTML = '<img class="auth-btn-icon" src="img/icons/log_in_1.png" alt="Iniciar sesión">';
            }
        }, 120000);

    } catch (error) {
        console.error('Error en iniciarSesionGoogle:', error);
        if (DOM.authBtn) {
            DOM.authBtn.disabled = false;
            DOM.authBtn.innerHTML = '<img class="auth-btn-icon" src="img/icons/log_in_1.png" alt="Iniciar sesión">';
        }
        alert('Error al conectar con el servicio de autenticación');
    }
}

async function procesarAutenticacionExitosa(user) {
    currentUser = user;
    estado.isAuthenticated = true;
    
    actualizarUIAutenticacion(user);
    
    if (initFirebase()) {
        // Configurar persistencia permanente en Firebase Auth
        if (auth) {
            try {
                await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            } catch(e) { console.warn('setPersistence:', e); }
        }
        await sincronizarPerfilUsuario(user);
        await cargarCategoriasUsuario(user.uid);
    }
    
    habilitarEdicion(true);
    
    try {
        // Guardar sesión CON token — permanente hasta logout
        localStorage.setItem('starTab_lastUser', JSON.stringify({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            token: user.token || null,
            timestamp: Date.now()
        }));
    } catch (e) {
        console.log('No se pudo guardar en localStorage:', e);
    }
}

function actualizarUIAutenticacion(user) {
    if (user && DOM.authBtn && DOM.userMenu) {
        DOM.authBtn.style.display = 'none';
        DOM.userMenu.style.display = 'flex';
        DOM.userAvatar.src = user.photoURL || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23667eea\'%3E%3Ccircle cx=\'12\' cy=\'12\' r=\'10\'/%3E%3C/svg%3E';
        DOM.userName.textContent = user.displayName || 'Usuario';
        DOM.userEmail.textContent = user.email || '';
    } else {
        if (DOM.authBtn) DOM.authBtn.style.display = 'flex';
        if (DOM.userMenu) DOM.userMenu.style.display = 'none';
        if (DOM.userAvatar) DOM.userAvatar.src = '';
        if (DOM.userName) DOM.userName.textContent = '';
        if (DOM.userEmail) DOM.userEmail.textContent = '';
    }
}

function cerrarSesion() {
    cancelarGuardadosNotasPendientes();
    currentUser = null;
    estado.isAuthenticated = false;
    
    actualizarUIAutenticacion(null);
    
    if (unsubscribeCategories) {
        unsubscribeCategories();
        unsubscribeCategories = null;
    }
    desconectarNotasTiempoReal();

    // Detener renovación automática de token
    if (window._tokenRenewalInterval) {
        clearInterval(window._tokenRenewalInterval);
        window._tokenRenewalInterval = null;
    }
    
    // Cerrar sesión también en Firebase Auth para invalidar el token
    if (auth) {
        auth.signOut().catch(e => console.warn('signOut error:', e));
    }
    
    localStorage.removeItem('starTab_lastUser');
    localStorage.removeItem('starTab_auth_data');
    
    cargarCategoriasLocales();
    habilitarEdicion(false);
}

// Renovar token automáticamente cada 50 min (expira en 60 min)
function iniciarRenovacionAutomaticaToken() {
    // Evitar múltiples intervalos
    if (window._tokenRenewalInterval) return;

    window._tokenRenewalInterval = setInterval(async () => {
        if (!auth || !auth.currentUser) return;
        try {
            const newToken = await auth.currentUser.getIdToken(true);
            if (currentUser) {
                currentUser.token = newToken;
                currentUser.timestamp = Date.now();
            }
            const saved = localStorage.getItem('starTab_lastUser');
            if (saved) {
                const userData = JSON.parse(saved);
                userData.token = newToken;
                userData.timestamp = Date.now();
                localStorage.setItem('starTab_lastUser', JSON.stringify(userData));
            }
            console.log('Token renovado automáticamente');
        } catch (e) {
            console.warn('No se pudo renovar token:', e);
        }
    }, 50 * 60 * 1000); // cada 50 minutos
}

async function descargarBackup() {
    if (!currentUser || !db) {
        alert('Debes iniciar sesión para descargar el backup');
        return;
    }

    try {
        // Mostrar indicador de carga
        const backupBtn = document.getElementById('backup-btn');
        if (backupBtn) {
            backupBtn.disabled = true;
            backupBtn.innerHTML = '<span class="backup-icon">⏳</span>Generando backup...';
        }

        // Obtener datos del usuario
        const userDoc = await userDocRef.get();
        const userData = userDoc.exists ? userDoc.data() : {};

        // Obtener todas las categorías
        const categoriasSnapshot = await userDocRef.collection('categorias').get();
        const categoriasData = [];
        
        for (const catDoc of categoriasSnapshot.docs) {
            const categoria = {
                id: catDoc.id,
                ...catDoc.data()
            };
            
            // Obtener iconos de cada categoría
            const iconosSnapshot = await catDoc.ref.collection('iconos').orderBy('orden').get();
            categoria.iconos = [];
            iconosSnapshot.forEach(iconoDoc => {
                categoria.iconos.push({
                    id: iconoDoc.id,
                    ...iconoDoc.data()
                });
            });
            
            categoriasData.push(categoria);
        }

        // Preparar el objeto de backup
        const backupData = {
            version: "1.0",
            fecha: new Date().toISOString(),
            usuario: {
                uid: currentUser.uid,
                email: currentUser.email,
                displayName: currentUser.displayName,
                photoURL: currentUser.photoURL
            },
            perfil: userData.profile || {},
            notas: userData.notas || {},
            categorias: categoriasData,
            metadata: {
                ...userData.metadata,
                fechaBackup: firebase.firestore.FieldValue.serverTimestamp()
            }
        };

        // Crear y descargar el archivo
        const backupJSON = JSON.stringify(backupData, null, 2);
        const blob = new Blob([backupJSON], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const fecha = new Date();
        const fechaStr = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}_${String(fecha.getHours()).padStart(2, '0')}-${String(fecha.getMinutes()).padStart(2, '0')}`;
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `startab_backup_${fechaStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        alert('✅ Backup descargado exitosamente');

    } catch (error) {
        console.error('Error al descargar backup:', error);
        alert('❌ Error al descargar el backup: ' + error.message);
    } finally {
        // Restaurar el botón
        const backupBtn = document.getElementById('backup-btn');
        if (backupBtn) {
            backupBtn.disabled = false;
            backupBtn.innerHTML = '<span class="backup-icon">💾</span>Descargar backup';
        }
    }
}


// ===== FORZAR SINCRONIZACIÓN DESDE FIREBASE (sobreescribe localStorage) =====
async function forzarSincronizacionFirebase() {
    if (!currentUser || !db) {
        alert('⚠️ Debes iniciar sesión para sincronizar con Firebase.');
        return;
    }

    if (!navigator.onLine) {
        alert('⚠️ Sin conexión a internet. Conéctate e inténtalo de nuevo.');
        return;
    }

    const refreshBtn = document.getElementById('refresh-firebase-btn');
    const originalHTML = refreshBtn ? refreshBtn.innerHTML : '';

    try {
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<span class="backup-icon">⏳</span>Sincronizando...';
        }

        console.log('Forzando sincronización desde Firebase...');

        // Limpiar caché local de iconos para que Firebase los recargue frescos
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('iconos_')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        localStorage.removeItem('starTab_config_backup');
        localStorage.removeItem('starTab_fondo_rapido');
        iconosCache.clear();

        // Recargar categorías desde Firebase directamente
        const categoriasSnapshot = await userDocRef.collection('categorias').get();
        const firestoreCategorias = [];

        for (const catDoc of categoriasSnapshot.docs) {
            const data = catDoc.data();
            const categoria = {
                id: catDoc.id,
                nombre: data.nombre || 'Sin nombre',
                editable: data.editable !== undefined ? data.editable : true,
                orden: data.orden !== undefined ? data.orden : 999,
                background: data.background || { ...FONDO_DEFAULT }
            };

            // Cargar iconos de cada categoría
            const iconosSnapshot = await catDoc.ref.collection('iconos').orderBy('orden').get();
            const iconos = [];
            iconosSnapshot.forEach(iconoDoc => {
                iconos.push({ id: iconoDoc.id, ...iconoDoc.data() });
            });

            // Guardar iconos en localStorage actualizados desde Firebase
            localStorage.setItem(`iconos_${catDoc.id}`, JSON.stringify(iconos));
            iconosCache.set(catDoc.id, iconos);

            firestoreCategorias.push(categoria);
        }

        firestoreCategorias.sort((a, b) => (a.orden || 999) - (b.orden || 999));

        if (!firestoreCategorias.some(c => c.id === 'general')) {
            firestoreCategorias.unshift({ ...CATEGORIA_GENERAL, id: 'general' });
        }

        // Cargar notas desde Firebase
        const userDoc = await userDocRef.get();
        if (userDoc.exists && userDoc.data().notas) {
            const notasFirebase = userDoc.data().notas;
            for (let i = 1; i <= 5; i++) {
                if (notasFirebase[`nota${i}`] !== undefined) {
                    notaEstado.notas[i].contenido = notasFirebase[`nota${i}`];
                }
            }
        }

        // Aplicar datos de Firebase como fuente de verdad
        categorias = firestoreCategorias;

        if (!categorias.some(c => c.id === estado.categoriaActual)) {
            estado.categoriaActual = 'general';
            localStorage.setItem('categoriaSeleccionada', 'general');
        }

        // Cargar iconos de la categoría actual en memoria
        const iconosActuales = iconosCache.get(estado.categoriaActual) || [];
        estado.iconosActuales = iconosActuales;

        // Actualizar fondo desde Firebase (categoría activa)
        const catActiva = categorias.find(c => c.id === estado.categoriaActual);
        if (catActiva && catActiva.background) {
            localStorage.setItem('starTab_fondo_rapido', JSON.stringify(catActiva.background));
        }

        renderizarCategorias();
        renderizarIconos();
        guardarBackupLocal();
        aplicarFondoCategoria(estado.categoriaActual);

        // Refrescar el workspace de notas con el mismo estado recibido de Firebase.
        try {
            const notaDOM = obtenerNotaDOM();
            cargarNota(notaEstado.notaActual, notaDOM);
            actualizarTodosLosPreviews(notaDOM);
        } catch(e) {}

        console.log('✅ Sincronización desde Firebase completada');
        mostrarToastExito('✅ Datos sincronizados desde Firebase');

    } catch (error) {
        console.error('Error al forzar sincronización:', error);
        alert('❌ Error al sincronizar: ' + error.message);
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = originalHTML;
        }
    }
}

// Mostrar toast de éxito
function mostrarToastExito(mensaje) {
    const toast = document.createElement('div');
    toast.textContent = mensaje;
    toast.style.cssText = [
        'position:fixed',
        'bottom:32px',
        'left:50%',
        'transform:translateX(-50%)',
        'background:rgba(6,210,107,0.95)',
        'color:#fff',
        'padding:12px 24px',
        'border-radius:50px',
        'font-size:14px',
        'font-weight:600',
        'z-index:99999',
        'box-shadow:0 4px 20px rgba(0,0,0,0.3)',
        'transition:opacity 0.4s ease',
        'pointer-events:none'
    ].join(';');
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; }, 2500);
    setTimeout(() => { toast.remove(); }, 3000);
}

async function sincronizarPerfilUsuario(user) {
    if (!user || !user.uid || !db) return;

    try {
        userDocRef = db.collection('users').doc(user.uid);
        window.StarTabRedimensionamiento?.conectarFirebase(userDocRef);
        const doc = await userDocRef.get();

        if (doc.exists) {
            const data = doc.data();
            if (data.profile?.photoURL !== user.photoURL) {
                await userDocRef.set({
                    profile: {
                        displayName: user.displayName,
                        email: user.email,
                        photoURL: user.photoURL
                    }
                }, { merge: true });
            }
        } else {
            await userDocRef.set({
                profile: {
                    displayName: user.displayName,
                    email: user.email,
                    photoURL: user.photoURL,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                },
                metadata: {
                    ultimaModificacion: firebase.firestore.FieldValue.serverTimestamp(),
                    version: "1.0"
                }
            });
            
            // Crear categoría General automáticamente
            await crearCategoriaGeneralEnFirebase();
        }
    } catch (error) {
        console.error('Error al sincronizar perfil:', error);
    }
}

// ===== FUNCIÓN: Crear categoría General en Firebase =====
async function crearCategoriaGeneralEnFirebase() {
    if (!currentUser || !db) return;

    try {
        const categoriaRef = userDocRef.collection('categorias').doc('general');
        await categoriaRef.set({
            nombre: 'General',
            editable: true,
            orden: 1,
            background: { ...FONDO_DEFAULT },
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('Categoría General creada en Firebase');
    } catch (error) {
        console.error('Error creando categoría General:', error);
    }
}

function inicializarAutenticacion() {
    // Restaurar sesión desde localStorage SIN expiración de tiempo.
    // La sesión solo se cierra cuando el usuario hace logout explícito.
    try {
        const savedUser = localStorage.getItem('starTab_lastUser');
        if (savedUser) {
            const userData = JSON.parse(savedUser);
            // Sin límite de tiempo: sesión permanente hasta logout
            if (userData && userData.uid) {
                currentUser = userData;
                estado.isAuthenticated = true;
                actualizarUIAutenticacion(userData);
                habilitarEdicion(true);

                requestIdleCallback(() => {
                    if (initFirebase()) {
                        // Firebase tiene prioridad: siempre carga desde la nube
                        cargarCategoriasUsuario(userData.uid);
                        // Configurar persistencia permanente en Firebase Auth
                        if (auth) {
                            auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
                                .catch(e => console.warn('setPersistence error:', e));
                        }
                    }
                    setTimeout(() => inicializarDragAndDropCategorias(), 500);
                }, { timeout: 2000 });
            }
        }
    } catch (e) {
        console.log('Error al restaurar sesión:', e);
    }

    if (DOM.authBtn) {
        DOM.authBtn.addEventListener('click', iniciarSesionGoogle);
    }

    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', cerrarSesion);
    }

    // Event listener para el botón de backup
    const backupBtn = document.getElementById('backup-btn');
    if (backupBtn) {
        backupBtn.addEventListener('click', descargarBackup);
    }

    // Event listener para el botón de refresh (fuerza datos de Firebase)
    const refreshBtn = document.getElementById('refresh-firebase-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', forzarSincronizacionFirebase);
    }

    document.addEventListener('click', (e) => {
        if (DOM.userMenu && !DOM.userMenu.contains(e.target)) {
            DOM.userDropdown.style.display = 'none';
        }
    });

    if (DOM.userAvatar) {
        DOM.userAvatar.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = DOM.userDropdown.style.display === 'block';
            DOM.userDropdown.style.display = isVisible ? 'none' : 'block';
        });
    }
}

// ===== FUNCIONES DE RESPALDO LOCAL =====
function guardarBackupLocal() {
    try {
        const backupData = {
            categorias: categorias.map(c => ({
                id: c.id,
                nombre: c.nombre,
                editable: c.editable,
                orden: c.orden !== undefined ? c.orden : 999,
                background: c.background
            })),
            notas: {
                nota1: notaEstado.notas[1].contenido,
                nota2: notaEstado.notas[2].contenido,
                nota3: notaEstado.notas[3].contenido,
                nota4: notaEstado.notas[4].contenido,
                nota5: notaEstado.notas[5].contenido
            },
            metadata: {
                ultimaModificacionLocal: Date.now() / 1000,
                version: "1.0"
            }
        };
        
        const backupActual = localStorage.getItem('starTab_config_backup');
        const nuevoBackup = JSON.stringify(backupData);
        
        if (backupActual !== nuevoBackup) {
            localStorage.setItem('starTab_config_backup', nuevoBackup);
            console.log('Backup local guardado');
        }
    } catch (e) {
        console.log('Error guardando backup local:', e);
    }
}

function cargarBackupLocal() {
    try {
        const backupRaw = localStorage.getItem('starTab_config_backup');
        if (backupRaw) {
            return JSON.parse(backupRaw);
        }
    } catch (e) {
        console.log('Error cargando backup local:', e);
    }
    return null;
}

// ===== FUNCIONES DE CATEGORÍAS CORREGIDAS =====
async function cargarCategoriasUsuario(uid) {
    if (!db) {
        console.log('Firebase no inicializado, usando categorías locales');
        cargarCategoriasLocales();
        return;
    }
    
    try {
        if (unsubscribeCategories) {
            unsubscribeCategories();
        }

        if (userDocRef?.id && userDocRef.id !== uid) cancelarGuardadosNotasPendientes();
        userDocRef = db.collection('users').doc(uid);
        window.StarTabRedimensionamiento?.conectarFirebase(userDocRef);
        conectarNotasTiempoReal(userDocRef);
        
        // Mostrar datos locales SOLO como visualización temporal mientras carga Firebase
        // Firebase siempre tiene la prioridad y reemplazará estos datos
        const localBackup = cargarBackupLocal();
        if (localBackup && localBackup.categorias && localBackup.categorias.length > 0) {
            categorias = localBackup.categorias;
            await cargarIconosCategoriaActual();
            renderizarCategorias();
            aplicarFondoCategoria(estado.categoriaActual);
            // FIX: sin esto, el grid seguía mostrando los accesos por
            // defecto (los pintados al arrancar la página) hasta que el
            // usuario interactuaba con la interfaz (p. ej. cambiaba de
            // categoría), porque cargarIconosCategoriaActual() solo
            // actualiza el estado en memoria, no el DOM.
            renderizarIconos(true);
            console.log('Datos locales mostrados temporalmente mientras carga Firebase...');
        }

        // Escuchar cambios en categorías — Firebase ES la fuente de verdad
        unsubscribeCategories = userDocRef.collection('categorias').onSnapshot(async (snapshot) => {
            // IMPORTANTE: también procesamos snapshots de la caché local.
            // Así la interfaz sigue funcionando completamente sin Internet.
            const firestoreCategorias = [];
            
            snapshot.forEach(doc => {
                const data = doc.data();
                firestoreCategorias.push({
                    id: doc.id,
                    nombre: data.nombre || 'Sin nombre',
                    editable: data.editable !== undefined ? data.editable : true,
                    orden: data.orden !== undefined ? data.orden : 999,
                    background: data.background || { ...FONDO_DEFAULT }
                });
            });

            // Ordenar categorías
            firestoreCategorias.sort((a, b) => (a.orden || 999) - (b.orden || 999));

            // VERIFICAR Y CREAR CATEGORÍA GENERAL SI NO EXISTE
            const tieneGeneral = firestoreCategorias.some(c => c.id === 'general');
            if (!tieneGeneral) {
                console.log('Creando categoría General en Firebase');
                firestoreCategorias.unshift({ ...CATEGORIA_GENERAL, id: 'general' });
                try {
                    await userDocRef.collection('categorias').doc('general').set({
                        nombre: 'General',
                        editable: true,
                        orden: 1,
                        background: { ...FONDO_DEFAULT }
                    });
                } catch (e) {
                    console.error('Error creando General en Firebase:', e);
                }
            }

            // FIREBASE TIENE PRIORIDAD TOTAL sobre localStorage
            // Solo preservar el fondo de la categoría ACTIVA si fue modificado localmente
            // después de la última sincronización (para no perder cambios no guardados)
            const fondoGuardado = localStorage.getItem('starTab_fondo_rapido');
            if (fondoGuardado) {
                try {
                    const fondoLocal = JSON.parse(fondoGuardado);
                    const categoriaActiva = firestoreCategorias.find(c => c.id === estado.categoriaActual);
                    if (categoriaActiva && fondoLocal && fondoLocal._guardadoLocal) {
                        // Solo preservar si fue marcado explícitamente como cambio local pendiente
                        categoriaActiva.background = fondoLocal;
                    }
                } catch (e) {}
            }

            console.log('Firebase actualiza categorías (fuente de verdad):', firestoreCategorias.length);
            categorias = firestoreCategorias;
            _startabCategoriasListas = true;
            sincronizarCategoriasMenuContextual();

            // Validar categoría actual
            if (!categorias.some(c => c.id === estado.categoriaActual)) {
                estado.categoriaActual = 'general';
                localStorage.setItem('categoriaSeleccionada', 'general');
            }

            await cargarIconosCategoriaActual();
            renderizarCategorias();
            guardarBackupLocal();
            aplicarFondoCategoria(estado.categoriaActual);
            // FIX: este era el punto donde Firebase confirma los accesos
            // reales del usuario (la "fuente de verdad"), pero nunca se
            // pintaban en el grid — solo se actualizaba estado.iconosActuales
            // en memoria. Por eso los accesos por defecto se quedaban
            // visibles hasta que el usuario tocaba algo (cambiar de
            // categoría, que sí llama a renderizarIconos). Con esta línea,
            // en cuanto Firebase responde (con o sin sesión ya activa), el
            // grid se actualiza solo, sin ninguna interacción del usuario.
            renderizarIconos(true);

            // Ahora sí procesamos los accesos que llegaron desde el menú
            // contextual. Firebase ya es la fuente de verdad y la escritura
            // quedará persistida en la categoría correcta.
            await revisarAccesoPendienteDelMenuContextual();

            // Reinicializar drag & drop
            if (estado.isAuthenticated) {
                setTimeout(() => inicializarDragAndDropCategorias(), 100);
            }

        }, (error) => {
            console.error('Error en snapshot de categorías:', error);
            // En caso de error de Firebase, usar datos locales como fallback
            if (categorias.length === 0) {
                cargarCategoriasLocales();
            }
        });

    } catch (error) {
        console.error('Error al cargar categorías:', error);
        cargarCategoriasLocales();
    }
}

async function cargarIconosCategoriaActual() {
    if (!estado.categoriaActual) return;
    
    const categoria = categorias.find(c => c.id === estado.categoriaActual);
    if (!categoria) return;

    // Firestore puede responder desde su caché persistente aunque no haya Internet.
    if (currentUser && db) {
        try {
            const iconosSnapshot = await userDocRef
                .collection('categorias')
                .doc(estado.categoriaActual)
                .collection('iconos')
                .orderBy('orden')
                .get();

            const iconos = [];
            iconosSnapshot.forEach(doc => {
                iconos.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            estado.iconosActuales = iconos;
            iconosCache.set(estado.categoriaActual, iconos);
            
            try {
                localStorage.setItem(`iconos_${estado.categoriaActual}`, JSON.stringify(iconos));
            } catch (e) {}
            
            return;
        } catch (error) {
            console.error('Error cargando iconos de Firebase:', error);
        }
    }
    
    // Fallback: cargar desde localStorage
    try {
        const iconosGuardados = localStorage.getItem(`iconos_${estado.categoriaActual}`);
        if (iconosGuardados) {
            estado.iconosActuales = JSON.parse(iconosGuardados);
        } else if (estado.categoriaActual === 'general') {
            estado.iconosActuales = obtenerIconosPorDefecto();
        } else {
            estado.iconosActuales = [];
        }
    } catch (e) {
        estado.iconosActuales = estado.categoriaActual === 'general' ? obtenerIconosPorDefecto() : [];
    }
}

async function guardarIconosEnFirebase(iconos) {
    // Nunca persistir duplicados, aunque una versión anterior ya los haya creado.
    iconos = deduplicarAccesos(iconos);
    if (estado.categoriaActual) {
        estado.iconosActuales = [...iconos];
        iconosCache.set(estado.categoriaActual, [...iconos]);
    }
    // Guardar localmente de inmediato; la interfaz no depende de Internet.
    guardarIconosLocalmente(iconos);

    if (!currentUser || !db) {
        return;
    }

    // Con persistencia offline, Firestore encola las escrituras si no hay red.
    try {
        const batch = db.batch();
        const iconosRef = userDocRef
            .collection('categorias')
            .doc(estado.categoriaActual)
            .collection('iconos');

        const existing = await iconosRef.get();
        existing.forEach(doc => {
            batch.delete(doc.ref);
        });

        iconos.forEach((icono, index) => {
            const newDocRef = iconosRef.doc(idEstableAcceso(icono.url));
            batch.set(newDocRef, {
                nombre: icono.nombre,
                url: icono.url,
                icono: icono.icono,
                estilos: icono.estilos || ESTILOS_DEFAULT,
                orden: index,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        await batch.commit();
        console.log('Iconos guardados en Firebase');

        await userDocRef
            .collection('categorias')
            .doc(estado.categoriaActual)
            .set({
                ultimaModificacion: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

        guardarIconosLocalmente(iconos);
        
    } catch (error) {
        console.error('Error guardando iconos:', error);
        guardarIconosLocalmente(iconos);
    }
}

function guardarIconosLocalmente(iconos) {
    try {
        localStorage.setItem(`iconos_${estado.categoriaActual}`, JSON.stringify(iconos));
        estado.iconosActuales = iconos;
        guardarBackupLocal();
    } catch (e) {
        console.error('Error guardando iconos localmente:', e);
    }
}

async function crearCategoriaEnFirebase(categoriaData) {
    if (!currentUser || !db) return null;

    try {
        const categoriaRef = userDocRef.collection('categorias').doc(categoriaData.id);
        await categoriaRef.set({
            nombre: categoriaData.nombre,
            editable: true,
            orden: categoriaData.orden,
            background: categoriaData.background,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        return categoriaData.id;
    } catch (error) {
        console.error('Error creando categoría:', error);
        return null;
    }
}

async function actualizarCategoriaEnFirebase(categoriaId, data) {
    if (!currentUser || !db) return;

    try {
        await userDocRef
            .collection('categorias')
            .doc(categoriaId)
            .set(data, { merge: true });
    } catch (error) {
        console.error('Error actualizando categoría:', error);
    }
}

async function eliminarCategoriaDeFirebase(categoriaId) {
    if (!currentUser || !db) return;

    try {
        const batch = db.batch();
        const categoriaRef = userDocRef.collection('categorias').doc(categoriaId);
        
        const iconos = await categoriaRef.collection('iconos').get();
        iconos.forEach(doc => {
            batch.delete(doc.ref);
        });

        batch.delete(categoriaRef);
        await batch.commit();
        console.log('Categoría eliminada de Firebase');
    } catch (error) {
        console.error('Error eliminando categoría:', error);
    }
}

// ===== FUNCIONES DE CATEGORÍAS LOCALES =====
function cargarCategoriasLocales() {
    console.log('Cargando categorías locales...');
    
    const backup = cargarBackupLocal();
    let fondoGuardado = null;
    
    try {
        fondoGuardado = JSON.parse(localStorage.getItem('starTab_fondo_rapido') || 'null');
    } catch (e) {}

    if (backup && backup.categorias && backup.categorias.length > 0) {
        categorias = backup.categorias;
        
        // SIEMPRE priorizar el fondo guardado en localStorage
        if (fondoGuardado) {
            const categoriaActual = categorias.find(c => c.id === estado.categoriaActual);
            if (categoriaActual) {
                categoriaActual.background = fondoGuardado;
            }
        }
    } else {
        categorias = [{
            ...CATEGORIA_GENERAL,
            background: fondoGuardado || { ...FONDO_DEFAULT }
        }];
    }

    // Asegurar que la categoría General tiene todos los campos
    const generalIndex = categorias.findIndex(c => c.id === 'general');
    if (generalIndex === -1) {
        categorias.unshift({ ...CATEGORIA_GENERAL });
    } else {
        if (categorias[generalIndex].orden === undefined) {
            categorias[generalIndex].orden = 1;
        }
        if (categorias[generalIndex].editable === undefined) {
            categorias[generalIndex].editable = true;
        }
        // Asegurar que el fondo de General también use el localStorage
        if (fondoGuardado && categorias[generalIndex].id === estado.categoriaActual) {
            categorias[generalIndex].background = fondoGuardado;
        }
    }

    // Validar categoría actual
    if (!categorias.some(c => c.id === estado.categoriaActual)) {
        estado.categoriaActual = 'general';
        localStorage.setItem('categoriaSeleccionada', 'general');
        
        // Aplicar fondo guardado a General
        if (fondoGuardado) {
            const general = categorias.find(c => c.id === 'general');
            if (general) {
                general.background = fondoGuardado;
            }
        }
    }

    // Cargar iconos
    const iconosGuardados = localStorage.getItem(`iconos_${estado.categoriaActual}`);
    if (iconosGuardados) {
        estado.iconosActuales = JSON.parse(iconosGuardados);
    } else if (estado.categoriaActual === 'general') {
        estado.iconosActuales = obtenerIconosPorDefecto();
        guardarIconosLocalmente(estado.iconosActuales);
    } else {
        estado.iconosActuales = [];
    }

    // Cargar notas, incluyendo notas vacías (vaciar una nota también es un cambio válido).
    if (backup && backup.notas) {
        for (let i = 1; i <= 5; i++) {
            const key = `nota${i}`;
            if (Object.prototype.hasOwnProperty.call(backup.notas, key)) {
                notaEstado.notas[i].contenido = typeof backup.notas[key] === 'string' ? backup.notas[key] : '';
            }
        }
    }

    renderizarCategorias();
    aplicarFondoCategoria(estado.categoriaActual);
    renderizarIconos(true);
    
    const notaDOM = obtenerNotaDOM();
    if (notaDOM.textarea) cargarNota(notaEstado.notaActual, notaDOM);
}

function renderizarCategorias() {
    sincronizarCategoriasMenuContextual();
    const container = document.querySelector('.categorias-container');
    if (!container) return;

    let html = '';

    // Ordenar categorías antes de renderizar
    const categoriasOrdenadas = [...categorias].sort((a, b) => (a.orden || 999) - (b.orden || 999));

    categoriasOrdenadas.forEach(cat => {
        const activo = cat.id === estado.categoriaActual ? 'activo' : '';
        const editable = cat.editable ? 'true' : 'false';

        html += `
            <div class="categoria-wrapper" data-categoria-id="${cat.id}" data-categoria-editable="${editable}" draggable="${estado.isAuthenticated}">
                <button class="categoria-btn ${activo}" data-categoria="${cat.id}">
                    <span class="categoria-nombre">${cat.nombre || 'Sin nombre'}</span>
                </button>
            </div>
        `;
    });

    if (categorias.length < MAX_CATEGORIAS && estado.isAuthenticated) {
        html += `
            <button class="categoria-btn agregar-categoria-btn" id="btn-agregar-categoria">
                <span class="agregar-categoria">+</span>
            </button>
        `;
    }

    if (container.innerHTML !== html) {
        container.innerHTML = html;
        inicializarListenersCategorias();
        if (!navegacionScrollCategorias.activo) {
            sincronizarSelectorScrollConCategoriaActual();
        }
        
        // Inicializar drag & drop después de renderizar
        if (estado.isAuthenticated) {
            setTimeout(() => inicializarDragAndDropCategorias(), 50);
        }
    }
}

// ===== DROP DE ACCESOS DIRECTOS DESDE EL NAVEGADOR =====
// Acepta favoritos/accesos directos arrastrados desde la barra de favoritos de
// Chrome u otro navegador compatible. Se conserva nombre, URL y un favicon.
function extraerAccesoDirectoDesdeDrop(dataTransfer) {
    if (!dataTransfer) return null;

    let url = '';
    let nombre = '';

    // Chrome suele entregar la URL mediante text/uri-list.
    try {
        const uriList = dataTransfer.getData('text/uri-list');
        if (uriList) {
            url = uriList.split(/\r?\n/).find(line => line && !line.startsWith('#'))?.trim() || '';
        }
    } catch (e) {}

    // text/html suele conservar el título exacto del favorito.
    try {
        const html = dataTransfer.getData('text/html');
        if (html) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const anchor = doc.querySelector('a[href]');
            if (anchor) {
                if (!url) url = anchor.href || anchor.getAttribute('href') || '';
                nombre = (anchor.textContent || '').trim();
            }
        }
    } catch (e) {}

    // Algunos navegadores usan text/x-moz-url: primera línea URL, segunda título.
    try {
        const moz = dataTransfer.getData('text/x-moz-url');
        if (moz) {
            const lines = moz.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
            if (!url && lines[0]) url = lines[0];
            if (!nombre && lines[1]) nombre = lines[1];
        }
    } catch (e) {}

    // Último recurso: text/plain.
    if (!url) {
        try {
            const plain = dataTransfer.getData('text/plain')?.trim() || '';
            const possibleUrl = plain.split(/\s+/).find(v => /^https?:\/\//i.test(v));
            if (possibleUrl) url = possibleUrl;
        } catch (e) {}
    }

    if (!/^https?:\/\//i.test(url)) return null;

    if (!nombre) {
        try {
            nombre = new URL(url).hostname.replace(/^www\./i, '');
        } catch (e) {
            nombre = 'Acceso directo';
        }
    }

    // Los favoritos de Chrome no suelen entregar el favicon en DataTransfer.
    // Usamos el servicio de favicon de Google para obtenerlo a partir de la URL.
    // Esto funciona también después de guardar el acceso en Firebase/localStorage.
    let favicon;
    try {
        const parsed = new URL(url);
        favicon = `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(parsed.hostname)}`;
    } catch (e) {
        favicon = `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(new URL(url).hostname)}`;
    }

    return {
        nombre: nombre.slice(0, 120),
        url,
        icono: favicon,
        estilos: { ...ESTILOS_DEFAULT }
    };
}

// Cola por página para impedir dos altas simultáneas desde eventos distintos.
let _contextAddChain = Promise.resolve();

function normalizarUrlAcceso(url) {
    try {
        const u = new URL(String(url || '').trim());
        u.hash = '';
        return u.href.replace(/\/$/, '').toLowerCase();
    } catch (_) {
        return String(url || '').trim().replace(/\/$/, '').toLowerCase();
    }
}

function deduplicarAccesos(iconos) {
    const vistos = new Set();
    const resultado = [];
    for (const icono of (iconos || [])) {
        const clave = normalizarUrlAcceso(icono?.url);
        if (!clave || vistos.has(clave)) continue;
        vistos.add(clave);
        resultado.push(icono);
    }
    return resultado;
}

function idEstableAcceso(url) {
    // ID determinista: dos procesos/pestañas que intenten guardar la misma URL
    // terminan escribiendo exactamente el mismo documento, nunca dos.
    const texto = normalizarUrlAcceso(url);
    let h1 = 2166136261, h2 = 16777619;
    for (let i = 0; i < texto.length; i++) {
        const c = texto.charCodeAt(i);
        h1 ^= c; h1 = Math.imul(h1, 16777619);
        h2 ^= c + i; h2 = Math.imul(h2, 2246822519);
    }
    return 'url_' + (h1 >>> 0).toString(36) + '_' + (h2 >>> 0).toString(36);
}

async function agregarAccesoDirectoDesdeDrop(icono, categoriaId) {
    if (!icono || !categoriaId) return false;

    // Serializamos altas para que un mensaje runtime y un cambio de storage
    // no puedan procesar el mismo acceso al mismo tiempo.
    let resultado = false;
    _contextAddChain = _contextAddChain.then(async () => {
        const iconosActuales = await obtenerIconosCategoriaParaMover(categoriaId);
        const iconos = deduplicarAccesos(iconosActuales);
        const claveNueva = normalizarUrlAcceso(icono.url);

        // REGLA ABSOLUTA: una misma URL solo puede existir una vez por categoría.
        if (claveNueva && iconos.some(i => normalizarUrlAcceso(i?.url) === claveNueva)) {
            // Aun así limpiamos posibles duplicados antiguos que ya estuvieran guardados.
            if (iconos.length !== iconosActuales.length) {
                iconosCache.set(categoriaId, [...iconos]);
                try { localStorage.setItem(`iconos_${categoriaId}`, JSON.stringify(iconos)); } catch (e) {}
                if (categoriaId === estado.categoriaActual) {
                    estado.iconosActuales = [...iconos];
                    await renderizarIconos(true);
                }
                await guardarIconosEnCategoriaSinCambiarVista(categoriaId, iconos);
            }
            resultado = true;
            return;
        }

        iconos.push({ ...icono });
        iconosCache.set(categoriaId, [...iconos]);
        try { localStorage.setItem(`iconos_${categoriaId}`, JSON.stringify(iconos)); } catch (e) {}
        try { guardarBackupLocal(); } catch (e) {}

        if (categoriaId === estado.categoriaActual) {
            estado.iconosActuales = [...iconos];
            await renderizarIconos(true);
            if (currentUser && db) {
                await guardarIconosEnFirebase(estado.iconosActuales);
            }
        } else {
            await guardarIconosEnCategoriaSinCambiarVista(categoriaId, iconos);
        }
        resultado = true;
    }).catch(error => {
        console.error('StarTab: error agregando acceso directo:', error);
        resultado = false;
    });
    await _contextAddChain;
    return resultado;
}


function inicializarDropAccesosDirectos() {
    const container = DOM.contenedorIconos;
    const areaStarTab = document.querySelector('.box-master');
    if (!container || !areaStarTab || areaStarTab.dataset.externalDropReady === '1') return;
    areaStarTab.dataset.externalDropReady = '1';

    // El área completa de StarTab acepta favoritos externos. Si se sueltan
    // fuera de un botón de categoría, se usan automáticamente los iconos de
    // la categoría que está actualmente visible.
    const esBotonCategoria = (target) => !!target?.closest('.categoria-btn, #btn-agregar-categoria');
    const obtenerTargetVisual = (target) => target?.closest('.contenedor-iconos, .contenedor-iconos-master, .box-master') || areaStarTab;

    areaStarTab.addEventListener('dragover', (e) => {
        // IMPORTANTE: durante dragover Chrome no siempre permite leer
        // DataTransfer.getData(). Por eso NO intentamos detectar el favorito
        // antes de cancelar el evento. Si no cancelamos dragover, Chrome puede
        // interpretar el soltado como una navegación y abrir el acceso directo.
        // Los handlers específicos de categorías se encargan de sus propios drops.
        if (esBotonCategoria(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }
        obtenerTargetVisual(e.target).classList.add('external-shortcut-drop-target');
    });

    areaStarTab.addEventListener('dragleave', (e) => {
        if (!areaStarTab.contains(e.relatedTarget)) {
            areaStarTab.querySelectorAll('.external-shortcut-drop-target')
                .forEach(el => el.classList.remove('external-shortcut-drop-target'));
        }
    });

    areaStarTab.addEventListener('drop', async (e) => {
        // Cancelar SIEMPRE el drop en el área general antes de leer los datos.
        // Así nunca cae en la navegación por defecto del navegador.
        if (esBotonCategoria(e.target)) return;
        e.preventDefault();
        e.stopPropagation();

        const icono = extraerAccesoDirectoDesdeDrop(e.dataTransfer);
        if (!icono) return;
        areaStarTab.querySelectorAll('.external-shortcut-drop-target')
            .forEach(el => el.classList.remove('external-shortcut-drop-target'));

        // Cualquier zona de StarTab que no sea un botón de categoría usa la
        // categoría actualmente mostrada. Los botones de categoría tienen su
        // propio drop handler y no llegan aquí por el stopPropagation.
        await agregarAccesoDirectoDesdeDrop(icono, estado.categoriaActual);
    });
}

// ===== DRAG AND DROP DE CATEGORÍAS =====
function inicializarDragAndDropCategorias() {
    const container = document.querySelector('.categorias-container');
    if (!container || !estado.isAuthenticated) return;

    let draggedItem = null;

    container.querySelectorAll('.categoria-wrapper').forEach(wrapper => {
        wrapper.draggable = true;
        wrapper.addEventListener('dragstart', (e) => {
            draggedItem = wrapper;
            wrapper.classList.add('arrastrando');
            e.dataTransfer.setData('text/plain', wrapper.dataset.categoriaId);
            e.dataTransfer.effectAllowed = 'move';
        });

        wrapper.addEventListener('dragend', () => {
            wrapper.classList.remove('arrastrando');
            container.querySelectorAll('.categoria-wrapper').forEach(w => w.classList.remove('drag-over'));
        });

        wrapper.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        wrapper.addEventListener('dragenter', (e) => {
            e.preventDefault();
            if (wrapper !== draggedItem) {
                wrapper.classList.add('drag-over');
            }
        });

        wrapper.addEventListener('dragleave', () => {
            wrapper.classList.remove('drag-over');
        });

        wrapper.addEventListener('drop', async (e) => {
            e.preventDefault();
            wrapper.classList.remove('drag-over');

            // Si viene un favorito/acceso directo externo (por ejemplo desde
            // la barra de favoritos de Chrome), agrégalo directamente aquí.
            const accesoExterno = extraerAccesoDirectoDesdeDrop(e.dataTransfer);
            if (accesoExterno) {
                e.stopPropagation();
                wrapper.classList.add('external-shortcut-drop-target');
                try {
                    await agregarAccesoDirectoDesdeDrop(
                        accesoExterno,
                        wrapper.dataset.categoriaId
                    );
                } finally {
                    setTimeout(() => wrapper.classList.remove('external-shortcut-drop-target'), 120);
                }
                return;
            }
            
            if (wrapper === draggedItem) return;

            const fromId = e.dataTransfer.getData('text/plain');
            const toId = wrapper.dataset.categoriaId;

            if (fromId === toId) return;

            // Reordenar categorías
            const fromIndex = categorias.findIndex(c => c.id === fromId);
            const toIndex = categorias.findIndex(c => c.id === toId);

            if (fromIndex === -1 || toIndex === -1) return;

            // Mover el elemento
            const [movedCategory] = categorias.splice(fromIndex, 1);
            categorias.splice(toIndex, 0, movedCategory);

            // Actualizar órdenes empezando desde 1
            categorias.forEach((cat, index) => {
                cat.orden = index + 1;
            });

            // Guardar cambios en Firebase
            if (currentUser && db) {
                try {
                    const batch = db.batch();
                    for (const cat of categorias) {
                        const catRef = userDocRef.collection('categorias').doc(cat.id);
                        batch.set(catRef, {
                            nombre: cat.nombre,
                            editable: cat.editable,
                            orden: cat.orden,
                            background: cat.background
                        }, { merge: true });
                    }
                    await batch.commit();
                } catch (error) {
                    console.error('Error guardando orden de categorías:', error);
                }
            }

            // Guardar backup local
            guardarBackupLocal();

            // Actualizar UI
            renderizarCategorias();
            
            // Si la categoría actual cambió de posición, mantenerla seleccionada
            if (estado.categoriaActual === fromId || estado.categoriaActual === toId) {
                actualizarCategoriasUI();
            }
        });
    });

    container.addEventListener('dragover', (e) => e.preventDefault());
}

/* ===== NAVEGACIÓN MODERNA DE CATEGORÍAS POR SCROLL =====
   El scroll vertical dentro de StarTab actúa como un selector horizontal:
   arriba = categoría anterior (izquierda), abajo = siguiente (derecha).
   La categoría real solo cambia después de 1 segundo de permanencia. */
let navegacionScrollCategorias = {
    indice: -1,
    timer: null,
    acumulado: 0,
    ultimoEvento: 0,
    bloqueadoHasta: 0,
    activo: false
};

function obtenerCategoriasOrdenadasParaScroll() {
    return [...categorias]
        .sort((a, b) => (a.orden || 999) - (b.orden || 999));
}

function limpiarSeleccionScrollCategoria() {
    document.querySelectorAll('.categoria-btn.scroll-seleccionada')
        .forEach(btn => btn.classList.remove('scroll-seleccionada'));
    if (navegacionScrollCategorias.timer) {
        clearTimeout(navegacionScrollCategorias.timer);
        navegacionScrollCategorias.timer = null;
    }
}

function sincronizarSelectorScrollConCategoriaActual() {
    const lista = obtenerCategoriasOrdenadasParaScroll();
    const indiceActual = lista.findIndex(c => c.id === estado.categoriaActual);
    navegacionScrollCategorias.indice = indiceActual;
    navegacionScrollCategorias.acumulado = 0;
    navegacionScrollCategorias.activo = false;
    limpiarSeleccionScrollCategoria();
}

function seleccionarCategoriaPorScroll(indice) {
    const lista = obtenerCategoriasOrdenadasParaScroll();
    if (!lista.length) return;

    indice = Math.max(0, Math.min(indice, lista.length - 1));
    const categoria = lista[indice];
    if (!categoria) return;

    navegacionScrollCategorias.indice = indice;
    navegacionScrollCategorias.activo = true;
    navegacionScrollCategorias.acumulado = 0;

    limpiarSeleccionScrollCategoria();

    const btn = document.querySelector(`.categoria-btn[data-categoria="${CSS.escape(categoria.id)}"]`);
    if (!btn) return;

    btn.classList.add('scroll-seleccionada');
    btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

    // La categoría se confirma únicamente si el selector permanece 1 segundo.
    navegacionScrollCategorias.timer = setTimeout(async () => {
        navegacionScrollCategorias.timer = null;
        const listaActual = obtenerCategoriasOrdenadasParaScroll();
        const candidata = listaActual[navegacionScrollCategorias.indice];
        if (!candidata) return;

        // Si el usuario ya está en ella, solo sincronizamos el selector.
        if (candidata.id !== estado.categoriaActual) {
            await cambiarCategoria(candidata.id);
        }

        sincronizarSelectorScrollConCategoriaActual();
    }, 1000);
}

function manejarScrollCategorias(e) {
    // No interferir con modales, campos de texto, selects, editores ni drag & drop.
    // Bloquear la navegación solo cuando un modal esté REALMENTE abierto.
    // No basta con encontrar [aria-modal="true"], porque esos nodos existen
    // permanentemente en el DOM aunque Notas rápidas/Centro de pestañas estén cerrados.
    if (document.body.classList.contains('modal-abierto') ||
        document.body.classList.contains('startab-tabs-modal-open') ||
        document.querySelector(
            '.modal.active, .modal.show, ' +
            '.modal-moderno.modal-abierto, ' +
            '.modal-personalizar.modal-personalizar-abierto, ' +
            '.nota-modal.nota-modal-abierto, ' +
            '.multimedia-modal.is-open, ' +
            '.startab-tab-center.open'
        )) return;

    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], .modal, .context-menu')) return;
    if (document.body.classList.contains('icon-dragging') ||
        document.body.classList.contains('dragging') ||
        document.body.classList.contains('arrastrando')) return;

    // Solo responde al scroll dentro del área funcional de StarTab.
    if (!target?.closest('.box-master')) return;

    const lista = obtenerCategoriasOrdenadasParaScroll();
    if (lista.length < 2) return;

    const ahora = performance.now();
    if (ahora < navegacionScrollCategorias.bloqueadoHasta) return;

    // El touchpad genera muchos eventos pequeños; acumulamos hasta superar
    // un umbral para que la navegación sea controlada y no salte categorías.
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : 0;
    if (!delta) return;

    navegacionScrollCategorias.acumulado += delta;
    const umbral = 35;
    if (Math.abs(navegacionScrollCategorias.acumulado) < umbral) return;

    e.preventDefault();

    // Navegación natural para StarTab:
    //   rueda hacia ARRIBA  -> categoría a la DERECHA
    //   rueda hacia ABAJO   -> categoría a la IZQUIERDA
    const direccion = navegacionScrollCategorias.acumulado < 0 ? 1 : -1;
    navegacionScrollCategorias.acumulado = 0;
    navegacionScrollCategorias.bloqueadoHasta = ahora + 115;

    // Siempre partimos de la categoría realmente activa si el selector aún
    // no estaba siendo utilizado.
    if (!navegacionScrollCategorias.activo) {
        const indiceActual = lista.findIndex(c => c.id === estado.categoriaActual);
        navegacionScrollCategorias.indice = indiceActual >= 0 ? indiceActual : 0;
    }

    const siguiente = Math.max(
        0,
        Math.min(lista.length - 1, navegacionScrollCategorias.indice + direccion)
    );

    // En los extremos no permitimos que el índice avance más allá del límite.
    // Aun así, mostramos el selector durante su ciclo normal de 1 segundo.
    // Si ya estamos en esa categoría, al terminar el segundo se limpia la
    // preselección y el botón vuelve a su estado normal (no queda resaltado).
    if (siguiente === navegacionScrollCategorias.indice) {
        const categoriaExtremo = lista[navegacionScrollCategorias.indice];
        const btnExtremo = categoriaExtremo
            ? document.querySelector(`.categoria-btn[data-categoria="${CSS.escape(categoriaExtremo.id)}"]`)
            : null;

        if (btnExtremo) {
            // Cancelar cualquier dwell anterior para que cada intento tenga
            // exactamente una ventana limpia de 1 segundo.
            if (navegacionScrollCategorias.timer) {
                clearTimeout(navegacionScrollCategorias.timer);
                navegacionScrollCategorias.timer = null;
            }

            btnExtremo.classList.add('scroll-seleccionada');
            btnExtremo.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

            const indiceExtremo = navegacionScrollCategorias.indice;
            const idExtremo = categoriaExtremo.id;
            navegacionScrollCategorias.activo = true;
            navegacionScrollCategorias.acumulado = 0;

            navegacionScrollCategorias.timer = setTimeout(async () => {
                navegacionScrollCategorias.timer = null;

                // Si el extremo ya era la categoría activa, esto fue solo una
                // preselección visual: limpiar y volver al estado normal.
                if (estado.categoriaActual === idExtremo) {
                    btnExtremo.classList.remove('scroll-seleccionada');
                    navegacionScrollCategorias.activo = false;
                    navegacionScrollCategorias.indice = indiceExtremo;
                    return;
                }

                // Si llegamos al extremo desde otra categoría, sí es una
                // selección válida y debe confirmarse después de 1 segundo.
                const listaActual = obtenerCategoriasOrdenadasParaScroll();
                const candidata = listaActual[indiceExtremo];
                if (candidata && candidata.id !== estado.categoriaActual) {
                    await cambiarCategoria(candidata.id);
                }
                sincronizarSelectorScrollConCategoriaActual();
            }, 1000);
        }
        return;
    }

    // Si ya había una selección pendiente, sustituirla por la nueva categoría
    // y reiniciar el contador de confirmación de forma limpia.
    seleccionarCategoriaPorScroll(siguiente);
}

function inicializarNavegacionScrollCategorias() {
    if (window.__starTabScrollCategoriasInicializado) return;
    window.__starTabScrollCategoriasInicializado = true;

    sincronizarSelectorScrollConCategoriaActual();

    // capture permite interceptar el wheel antes de que elementos internos
    // intenten consumirlo. passive:false es necesario para bloquear el
    // desplazamiento de la página durante la navegación.
    window.addEventListener('wheel', manejarScrollCategorias, {
        passive: false,
        capture: true
    });
}

function inicializarListenersCategorias() {
    const container = document.querySelector('.categorias-container');
    if (!container) return;

    container.addEventListener('click', async (e) => {
        const btn = e.target.closest('.categoria-btn[data-categoria]');
        if (btn) {
            await cambiarCategoria(btn.dataset.categoria);
            return;
        }
        
        const addBtn = e.target.closest('#btn-agregar-categoria');
        if (addBtn && estado.isAuthenticated) {
            e.preventDefault();
            e.stopPropagation();
            await agregarCategoria();
            return;
        }
    });

    container.addEventListener('contextmenu', (e) => {
        const wrapper = e.target.closest('.categoria-wrapper');
        if (wrapper && estado.isAuthenticated) {
            e.preventDefault();
            const categoriaId = wrapper.dataset.categoriaId;
            const esEditable = wrapper.dataset.categoriaEditable === 'true';
            if (esEditable) {
                mostrarMenuContextualCategoria(e, categoriaId);
            }
        }
    });
}

async function cambiarCategoria(categoriaId) {
    if (!categorias.some(c => c.id === categoriaId) || categoriaId === estado.categoriaActual) return;

    estado.categoriaActual = categoriaId;
    localStorage.setItem('categoriaSeleccionada', categoriaId);
    
    await cargarIconosCategoriaActual();
    
    actualizarCategoriasUI();
    renderizarIconos(true);
    aplicarFondoCategoria(categoriaId);
    sincronizarSelectorScrollConCategoriaActual();
}

function actualizarCategoriasUI() {
    document.querySelectorAll('.categoria-btn[data-categoria]').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.categoria === estado.categoriaActual);
    });
}

async function agregarCategoria() {
    if (!estado.isAuthenticated) {
        alert('Debes iniciar sesión para crear categorías');
        return;
    }

    // Prevenir múltiples clics
    const addBtn = document.getElementById('btn-agregar-categoria');
    if (addBtn) {
        addBtn.disabled = true;
        addBtn.style.opacity = '0.5';
        addBtn.style.cursor = 'not-allowed';
    }

    try {
        const nombre = prompt('Nombre de la nueva categoría (máx 20 caracteres):', 'Nueva categoría');
        
        // Si el usuario cancela o cierra el prompt
        if (nombre === null) {
            return;
        }

        const nombreTrim = nombre.trim();
        if (!nombreTrim) {
            alert('El nombre no puede estar vacío');
            return;
        }

        if (nombreTrim.length > 20) {
            alert('El nombre no puede tener más de 20 caracteres');
            return;
        }

        // Verificar duplicados de manera más estricta
        const nombreExistente = categorias.some(c => 
            c.nombre.toLowerCase().trim() === nombreTrim.toLowerCase()
        );
        
        if (nombreExistente) {
            alert('Ya existe una categoría con ese nombre');
            return;
        }

        const nuevoId = 'cat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const orden = categorias.length + 1;
        
        const categoriaActual = categorias.find(c => c.id === estado.categoriaActual);
        const fondoBase = categoriaActual && categoriaActual.background ? categoriaActual.background : FONDO_DEFAULT;

        const nuevaCategoria = {
            id: nuevoId,
            nombre: nombreTrim,
            editable: true,
            orden: orden,
            background: { ...fondoBase }
        };

        // Agregar la categoría
        categorias.push(nuevaCategoria);
        sincronizarCategoriasMenuContextual();
        
        if (currentUser && db) {
            await crearCategoriaEnFirebase(nuevaCategoria);
        }
        
        guardarBackupLocal();
        renderizarCategorias();
        
        // Cambiar a la nueva categoría
        estado.categoriaActual = nuevoId;
        localStorage.setItem('categoriaSeleccionada', nuevoId);
        estado.iconosActuales = [];
        guardarIconosLocalmente([]);
        await renderizarIconos(true);
        aplicarFondoCategoria(nuevoId);
        
    } catch (error) {
        console.error('Error al crear categoría:', error);
        alert('Error al crear la categoría. Intenta de nuevo.');
    } finally {
        // Restaurar el botón después de un pequeño retraso
        setTimeout(() => {
            if (addBtn) {
                addBtn.disabled = false;
                addBtn.style.opacity = '1';
                addBtn.style.cursor = 'pointer';
            }
        }, 500);
    }
}

function mostrarMenuContextualCategoria(event, categoriaId) {
    document.querySelector('.menu-contextual-categoria')?.remove();
    
    const categoria = categorias.find(c => c.id === categoriaId);
    if (!categoria || !categoria.editable) return;
    
    const menu = document.createElement('div');
    menu.className = 'menu-contextual menu-contextual-categoria';
    
    menu.innerHTML = `
        <div class="menu-item" data-action="editar-categoria">
            <span class="menu-icono">✏️</span>Renombrar
        </div>
        <div class="menu-item" data-action="eliminar-categoria">
            <span class="menu-icono">🗑️</span>Eliminar
        </div>
    `;

    document.body.appendChild(menu);
    
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    
    let left = event.clientX;
    let top = event.clientY;
    
    if (left + menuWidth > window.innerWidth) {
        left = window.innerWidth - menuWidth - 10;
    }
    if (left < 10) left = 10;
    
    if (top + menuHeight > window.innerHeight) {
        top = event.clientY - menuHeight - 5;
    } else {
        top = event.clientY + 5;
    }
    
    if (top < 5) top = 5;
    
    menu.style.cssText = `left:${left}px;top:${top}px;position:fixed;z-index:2000;`;

    menu.querySelector('[data-action="editar-categoria"]').addEventListener('click', async () => {
        menu.remove();
        await editarCategoria(categoriaId);
    });
    
    menu.querySelector('[data-action="eliminar-categoria"]').addEventListener('click', async () => {
        menu.remove();
        await eliminarCategoria(categoriaId);
    });
    
    setTimeout(() => {
        const cerrarMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', cerrarMenu);
                document.removeEventListener('contextmenu', cerrarMenu);
            }
        };
        document.addEventListener('click', cerrarMenu);
        document.addEventListener('contextmenu', cerrarMenu);
    }, 100);
}

async function editarCategoria(categoriaId) {
    const categoria = categorias.find(c => c.id === categoriaId);
    
    const nuevoNombre = prompt('Renombrar categoría (máx 20 caracteres):', categoria.nombre);
    
    if (nuevoNombre === null) return;
    
    const nombreTrim = nuevoNombre.trim();
    if (!nombreTrim) {
        alert('El nombre no puede estar vacío');
        return;
    }
    
    if (nombreTrim.length > 20) {
        alert('El nombre no puede tener más de 20 caracteres');
        return;
    }
    
    if (categorias.some(c => c.id !== categoriaId && c.nombre.toLowerCase() === nombreTrim.toLowerCase())) {
        alert('Ya existe otra categoría con ese nombre');
        return;
    }
    
    categoria.nombre = nombreTrim;
    
    if (currentUser && db) {
        await actualizarCategoriaEnFirebase(categoriaId, { nombre: nombreTrim });
    }
    
    guardarBackupLocal();
    renderizarCategorias();
}

async function eliminarCategoria(categoriaId) {
    const categoria = categorias.find(c => c.id === categoriaId);
    
    const mensaje = estado.iconosActuales.length > 0
        ? `¿Eliminar la categoría "${categoria.nombre}" y todos sus ${estado.iconosActuales.length} accesos directos?`
        : `¿Eliminar la categoría "${categoria.nombre}"?`;
    
    if (!confirm(mensaje)) return;
    
    const index = categorias.findIndex(c => c.id === categoriaId);
    if (index !== -1) {
        categorias.splice(index, 1);
        
        if (currentUser && db) {
            await eliminarCategoriaDeFirebase(categoriaId);
        }
        
        localStorage.removeItem(`iconos_${categoriaId}`);
        
        guardarBackupLocal();
        
        if (estado.categoriaActual === categoriaId) {
            estado.categoriaActual = 'general';
            localStorage.setItem('categoriaSeleccionada', 'general');
            await cargarIconosCategoriaActual();
            aplicarFondoCategoria('general');
            await renderizarIconos(true);
        }
        
        renderizarCategorias();
    }
}

// ===== FUNCIONES DE ICONOS =====
function obtenerIconosPorDefecto() {
    return [
        {
            nombre: 'Google',
            url: 'https://www.google.com',
            icono: './img/icons/google_1.png',
            estilos: { ...ESTILOS_DEFAULT }
        },
        {
            nombre: 'YouTube',
            url: 'https://www.youtube.com',
            icono: './img/icons/youtube_1.png',
            estilos: { ...ESTILOS_DEFAULT }
        },
        {
            nombre: 'Facebook',
            url: 'https://www.facebook.com',
            icono: './img/icons/facebook_1.png',
            estilos: { ...ESTILOS_DEFAULT }
        }
    ];
}

function obtenerIconosListaKey(iconos = estado.iconosActuales || []) {
    return iconos.map((icono, i) => `${i}|${icono.url || ''}|${icono.nombre || ''}|${icono.icono || ''}`).join('||');
}

function aplicarEstilosIconoDOM(item, icono) {
    if (!item || !icono) return;
    const estilos = { ...ESTILOS_DEFAULT, ...(icono.estilos || {}) };
    const radioBorde = Math.max(0, Math.min(100, Number(estilos.radioBorde ?? ESTILOS_DEFAULT.radioBorde)));
    const tamanoIcono = Math.max(30, Math.min(100, Number(estilos.tamanoIcono ?? ESTILOS_DEFAULT.tamanoIcono)));
    const bgColor = estilos.tieneFondo && estilos.colorFondo ? estilos.colorFondo : 'transparent';
    const boxShadow = estilos.tieneFondo ? '0 4px 15px rgba(0,0,0,0.2)' : 'none';
    const contenedor = item.querySelector('.icono-contenedor');
    const img = item.querySelector('img');
    const nombre = item.querySelector(':scope > span');

    // El radio es siempre individual. El tamaño solo crea una anulación local
    // cuando el usuario lo baja de 100%; así los iconos no personalizados
    // siguen respondiendo al control global de tamaño de StarTab.
    item.style.setProperty('--startab-shortcut-radius', `${radioBorde}%`);
    if (tamanoIcono < 100) item.style.setProperty('--startab-shortcut-icon-size', `${tamanoIcono}%`);
    else item.style.removeProperty('--startab-shortcut-icon-size');

    if (contenedor) {
        contenedor.style.backgroundColor = bgColor;
        contenedor.style.borderRadius = `${radioBorde}%`;
        contenedor.style.boxShadow = boxShadow;
    }
    if (img) {
        img.src = icono.icono || ICONO_PREVIEW_DEFECTO;
        img.alt = icono.nombre || '';
        img.style.borderRadius = `${radioBorde}%`;
    }
    if (nombre) nombre.textContent = icono.nombre || '';
    item.href = icono.url || '#';
}

function crearIconoDOM(icono, index) {
    const estilos = { ...ESTILOS_DEFAULT, ...(icono.estilos || {}) };
    const bgColor = estilos.tieneFondo && estilos.colorFondo ? estilos.colorFondo : 'transparent';
    const boxShadow = estilos.tieneFondo ? '0 4px 15px rgba(0,0,0,0.2)' : 'none';
    const wrapper = document.createElement('a');
    wrapper.href = icono.url || '#';
    wrapper.className = 'icono-item';
    wrapper.target = '_self';
    wrapper.dataset.index = String(index);
    wrapper.style.animation = 'aparecerIcono 0.3s cubic-bezier(0.2, 0, 0, 1) both';

    const radioBorde = Math.max(0, Math.min(100, Number(estilos.radioBorde ?? ESTILOS_DEFAULT.radioBorde)));
    const tamanoIcono = Math.max(30, Math.min(100, Number(estilos.tamanoIcono ?? ESTILOS_DEFAULT.tamanoIcono)));
    wrapper.style.setProperty('--startab-shortcut-radius', `${radioBorde}%`);
    if (tamanoIcono < 100) wrapper.style.setProperty('--startab-shortcut-icon-size', `${tamanoIcono}%`);

    const contenedor = document.createElement('div');
    contenedor.className = 'icono-contenedor';
    contenedor.style.cssText = `background-color:${bgColor};border-radius:${radioBorde}%;box-shadow:${boxShadow};display:flex;align-items:center;justify-content:center;margin-bottom:.5rem;transition:all .3s ease;`;

    const img = document.createElement('img');
    img.src = icono.icono || ICONO_PREVIEW_DEFECTO;
    img.alt = icono.nombre || '';
    img.loading = 'lazy';
    img.style.objectFit = 'contain';
    img.style.borderRadius = `${radioBorde}%`;
    img.style.transition = 'all .3s ease';
    contenedor.appendChild(img);

    const incognito = document.createElement('div');
    incognito.className = 'btn-incognito-small';
    incognito.title = 'Abrir en incógnito';
    incognito.dataset.url = icono.url || '';
    incognito.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-hat-glasses-icon lucide-hat-glasses"><path d="M14 18a2 2 0 0 0-4 0"/><path d="m19 11-2.11-6.657a2 2 0 0 0-2.752-1.148l-1.276.61A2 2 0 0 1 12 4H8.5a2 2 0 0 1-1.925 1.456L5 11"/><path d="M2 11h20"/><circle cx="17" cy="18" r="3"/><circle cx="7" cy="18" r="3"/></svg>`;

    const label = document.createElement('span');
    label.textContent = icono.nombre || '';

    wrapper.append(contenedor, incognito, label);
    return wrapper;
}

function sincronizarIconoDOMIndividual(index, icono, esNuevo = false) {
    const container = DOM.contenedorIconos;
    if (!container || !icono) return;

    if (esNuevo) {
        const item = crearIconoDOM(icono, index);
        container.appendChild(item);
    } else {
        const item = container.querySelector(`.icono-item[data-index="${index}"]`);
        if (item) aplicarEstilosIconoDOM(item, icono);
        else container.appendChild(crearIconoDOM(icono, index));
    }

    actualizarLayoutIconos();
    _iconosCacheKey = obtenerIconosListaKey();
}

async function renderizarIconos(ignorarCache = false) {
    // Render estructural: solo se ejecuta cuando realmente cambia la lista de
    // accesos. Los cambios de filas/columnas/alineación NO vuelven a crear los
    // <a>, <img>, listeners ni imágenes: solo actualizan su layout.
    const iconos = estado.iconosActuales || [];
    const listaKey = obtenerIconosListaKey(iconos);

    if (_iconosCacheKey === listaKey && DOM.contenedorIconos?.querySelector('.icono-item')) {
        // Aunque el llamador pida un render forzado, si la lista no cambió no
        // se reconstruye el DOM. Solo se recalcula el layout cuando hace falta.
        actualizarLayoutIconos();
        return;
    }
    if (_renderizando) return;
    _renderizando = true;
    _iconosCacheKey = listaKey;

    requestAnimationFrame(() => {
        const nuevoHTML = iconos.map((icono, index) => {
            const estilos = { ...ESTILOS_DEFAULT, ...(icono.estilos || {}) };
            const bgColor = estilos.tieneFondo && estilos.colorFondo ? estilos.colorFondo : 'transparent';
            const boxShadow = estilos.tieneFondo ? '0 4px 15px rgba(0,0,0,0.2)' : 'none';
            const radioBorde = Math.max(0, Math.min(100, Number(estilos.radioBorde ?? ESTILOS_DEFAULT.radioBorde)));
            const tamanoIcono = Math.max(30, Math.min(100, Number(estilos.tamanoIcono ?? ESTILOS_DEFAULT.tamanoIcono)));
            const tamanoPersonalizado = tamanoIcono < 100 ? `--startab-shortcut-icon-size:${tamanoIcono}%;` : '';
            return `
                <a href="${icono.url}" class="icono-item" target="_self" data-index="${index}"
                   style="animation: aparecerIcono 0.3s cubic-bezier(0.2, 0, 0, 1) ${index * 0.03}s both;--startab-shortcut-radius:${radioBorde}%;${tamanoPersonalizado}">
                    <div class="icono-contenedor"
                         style="background-color: ${bgColor};
                                border-radius: ${radioBorde}%;
                                box-shadow: ${boxShadow};
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                margin-bottom: 0.5rem;
                                transition: all 0.3s ease;">
                        <img src="${icono.icono}" alt="${icono.nombre}" loading="lazy"
                             style="object-fit: contain; border-radius: ${radioBorde}%; transition: all 0.3s ease;">
                    </div>
                    <div class="btn-incognito-small" title="Abrir en incógnito" data-url="${icono.url}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-hat-glasses-icon lucide-hat-glasses">
                            <path d="M14 18a2 2 0 0 0-4 0"/><path d="m19 11-2.11-6.657a2 2 0 0 0-2.752-1.148l-1.276.61A2 2 0 0 1 12 4H8.5a2 2 0 0 1-1.925 1.456L5 11"/><path d="M2 11h20"/><circle cx="17" cy="18" r="3"/><circle cx="7" cy="18" r="3"/>
                        </svg>
                    </div>
                    <span>${icono.nombre}</span>
                </a>`;
        }).join('');

        if (DOM.contenedorIconos.innerHTML !== nuevoHTML) {
            DOM.contenedorIconos.innerHTML = nuevoHTML;
        }

        DOM.contenedorIconos.oncontextmenu = e => {
            const item = e.target.closest('.icono-item');
            if (item && estado.isAuthenticated) {
                e.preventDefault();
                const index = parseInt(item.dataset.index, 10);
                estado.iconoSeleccionadoIndex = index;
                mostrarMenuContextual(e, iconos[index]);
            }
        };

        inicializarDragAndDrop();
        inicializarDropAccesosDirectos();
        actualizarLayoutIconos();
        _renderizando = false;
        _ultimoRenderizado = Date.now();
    });
}

function actualizarLayoutIconos() {
    const container = DOM.contenedorIconos;
    if (!container) return;

    const rootStyles = getComputedStyle(document.documentElement);
    const filasConfiguradas = Math.max(1, Math.min(4, parseInt(rootStyles.getPropertyValue('--redim-icon-rows'), 10) || 2));
    const columnasConfiguradas = Math.max(1, Math.min(14, parseInt(rootStyles.getPropertyValue('--redim-icon-columns'), 10) || 8));
    const alineacionRaw = rootStyles.getPropertyValue('--redim-icon-align').trim();
    const alineacion = ['left', 'center', 'right'].includes(alineacionRaw) ? alineacionRaw : 'left';
    const modoScrollCompacto = window.matchMedia('(max-height: 569.98px)').matches;

    const items = [...container.querySelectorAll('.icono-item')];
    const csInicial = getComputedStyle(container);
    const gapXInicial = parseFloat(csInicial.columnGap) || parseFloat(csInicial.gap) || 0;

    /*
     * ANCHO DISPONIBLE REVERSIBLE
     * ---------------------------
     * El grid usa width:fit-content. Si calculamos las columnas desde su propio
     * clientWidth, al estrechar la ventana el grid se hace pequeño y ese ancho
     * reducido puede convertirse en su nueva referencia permanente. Al volver a
     * ensanchar el viewport ya no tendría cómo "descubrir" el espacio recuperado.
     *
     * La referencia correcta es el viewport físico que le ofrece el master. Así
     * el layout puede contraerse Y volver a expandirse sin reconstruir accesos.
     */
    const master = container.closest('.contenedor-iconos-master') || container.parentElement;
    const masterStyles = master ? getComputedStyle(master) : null;
    const masterPaddingX = masterStyles
        ? (parseFloat(masterStyles.paddingLeft) || 0) + (parseFloat(masterStyles.paddingRight) || 0)
        : 0;
    const anchoMaster = master ? Math.max(0, master.clientWidth - masterPaddingX) : 0;
    const fallbackWidth = Math.max(0, document.documentElement.clientWidth || window.innerWidth || 0);
    const innerWidthInicial = Math.min(1200, anchoMaster || fallbackWidth);

    /*
     * COLUMNAS RESPONSIVE REALES
     * --------------------------
     * El valor configurado por el usuario sigue siendo el máximo deseado,
     * pero nunca obligamos a una celda a ser más estrecha de lo razonable.
     * Si la ventana se hace pequeña, StarTab reduce automáticamente el número
     * de columnas y refluye los accesos a filas nuevas, evitando choques.
     */
    const minCellWidth = innerWidthInicial < 360 ? 58
        : innerWidthInicial < 480 ? 62
        : innerWidthInicial < 700 ? 68
        : 74;
    const columnasQueCaben = innerWidthInicial > 0
        ? Math.max(1, Math.floor((innerWidthInicial + gapXInicial) / (minCellWidth + gapXInicial)))
        : columnasConfiguradas;
    const columnas = Math.max(1, Math.min(columnasConfiguradas, columnasQueCaben));

    /*
     * ANCHO FÍSICO DE CADA ACCESO
     * ---------------------------
     * Antes las columnas eran 1fr y la tarjeta tenía un max-width menor.
     * Eso dejaba espacio invisible dentro de cada track y hacía que entre dos
     * accesos hubiera más distancia que el `gap`. Ahora el track y la tarjeta
     * tienen exactamente el mismo ancho; por tanto, la única separación real
     * entre accesos es column-gap/row-gap.
     */
    const anchoCelda = Math.min(120, Math.max(
        minCellWidth,
        columnas > 0
            ? (innerWidthInicial - gapXInicial * Math.max(0, columnas - 1)) / columnas
            : minCellWidth
    ));
    container.style.setProperty('--layout-cell-width', `${anchoCelda}px`);

    // En vista normal respetamos la capacidad configurada (filas × columnas
    // originales), pero la redistribuimos en más filas si el ancho se reduce.
    // Con menos de 570px de alto mostramos TODOS los accesos para que el scroll
    // vertical sea realmente útil y no existan elementos ocultos fuera de vista.
    const capacidadConfigurada = filasConfiguradas * columnasConfiguradas;
    const maxVisibles = modoScrollCompacto ? items.length : capacidadConfigurada;
    const total = Math.min(items.length, maxVisibles);
    const filasUsadas = Math.max(1, Math.ceil(total / columnas));

    const modoAnterior = container.dataset.modoScrollCompacto;
    container.style.setProperty('--layout-columns', String(columnas));
    container.style.setProperty('--layout-rows', String(filasUsadas));
    container.dataset.modoScrollCompacto = modoScrollCompacto ? '1' : '0';
    container.dataset.columnasEfectivas = String(columnas);

    // Al entrar por primera vez al modo compacto, el viewport desplazable
    // comienza en la primera fila. No lo repetimos en renders posteriores
    // para no interrumpir al usuario mientras está haciendo scroll.
    if (modoScrollCompacto && modoAnterior !== '1') {
        const master = container.closest('.contenedor-iconos-master');
        if (master) master.scrollTop = 0;
    }

    // Con el número efectivo de columnas ya aplicado, medimos el pitch REAL.
    // Esto conserva la alineación izquierda/centro/derecha y el drag geométrico.
    const cs = getComputedStyle(container);
    const gapX = parseFloat(cs.columnGap) || parseFloat(cs.gap) || 0;
    const paddingX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const innerWidth = Math.max(0, container.clientWidth - paddingX);
    const trackWidth = columnas > 0
        ? Math.max(0, (innerWidth - gapX * Math.max(0, columnas - 1)) / columnas)
        : 0;
    const pitch = trackWidth + gapX;

    items.forEach((item, index) => {
        if (index >= maxVisibles) {
            item.hidden = true;
            item.style.display = 'none';
            item.style.translate = '0 0';
            return;
        }

        item.hidden = false;
        item.style.display = '';

        const fila = Math.floor(index / columnas) + 1;
        const posicion = index % columnas;
        const cantidadEnFila = Math.min(columnas, total - ((fila - 1) * columnas));
        const esUltimaFila = fila === filasUsadas;
        const huecos = columnas - cantidadEnFila;

        let offset = 0;
        if (esUltimaFila) {
            if (alineacion === 'center') offset = (huecos / 2) * pitch;
            else if (alineacion === 'right') offset = huecos * pitch;
        }

        item.style.gridRowStart = String(fila);
        item.style.gridRowEnd = String(fila + 1);
        item.style.gridColumnStart = String(posicion + 1);
        item.style.gridColumnEnd = String(posicion + 2);
        item.style.justifySelf = 'center';
        item.style.alignSelf = 'start';
        item.style.translate = `${offset}px 0`;
    });

    container.dataset.filasUsadas = String(filasUsadas);
    container.dataset.capacidad = String(maxVisibles);
}

function cargarIconosRapidos(sinAnimacion = false) {
    const iconosDefault = obtenerIconosPorDefecto();
    if (DOM.contenedorIconos) {
        const estiloAnimacion = sinAnimacion ? 'animation: none;' : 'animation: aparecerIcono 0.5s cubic-bezier(0.2, 0, 0, 1) both;';
        
        const nuevoHTML = iconosDefault.map((icono, index) => {
            return `
                <a href="${icono.url}" class="icono-item" target="_self" data-index="${index}"
                   style="${estiloAnimacion} animation-delay: ${index * 0.05}s">
                    <div class="icono-contenedor">
                        <img src="${icono.icono}" alt="${icono.nombre}" loading="lazy">
                    </div>
                    <span>${icono.nombre}</span>
                </a>
            `;
        }).join('');
        
        if (DOM.contenedorIconos.innerHTML !== nuevoHTML) {
            DOM.contenedorIconos.innerHTML = nuevoHTML;
        }
    }
}

async function eliminarIcono(index) {
    // Actualización optimista: la UI cambia inmediatamente y no se vuelve a
    // renderizar el grid completo. Solo se elimina el nodo afectado.
    const iconoElement = DOM.contenedorIconos?.querySelector(
        `.icono-item[data-index="${index}"]`
    );

    if (index < 0 || index >= estado.iconosActuales.length) return;

    // Cerrar cualquier menú contextual antes de iniciar la animación.
    document.querySelectorAll('.menu-contextual').forEach(menu => menu.remove());

    // Actualizar estado y caché inmediatamente.
    const [iconoEliminado] = estado.iconosActuales.splice(index, 1);
    iconosCache.set(estado.categoriaActual, [...estado.iconosActuales]);

    try {
        localStorage.setItem(
            `iconos_${estado.categoriaActual}`,
            JSON.stringify(estado.iconosActuales)
        );
    } catch (e) {}

    // Los demás iconos conservan sus mismos nodos DOM, imágenes y estado de
    // carga. Solo se corrigen sus índices lógicos, sin innerHTML ni rerender.
    const items = DOM.contenedorIconos
        ? [...DOM.contenedorIconos.querySelectorAll('.icono-item')]
        : [];

    for (const item of items) {
        const itemIndex = Number(item.dataset.index);
        if (itemIndex > index) item.dataset.index = String(itemIndex - 1);
    }

    if (iconoElement) {
        iconoElement.classList.add('icono-eliminando');

        // Un frame para iniciar la transición; después se elimina únicamente
        // este nodo y el grid hace su reflow natural.
        requestAnimationFrame(() => {
            setTimeout(() => { iconoElement.remove(); actualizarLayoutIconos(); _iconosCacheKey = obtenerIconosListaKey(); }, 180);
        });
    }

    // Persistencia fuera del camino crítico de la interfaz.
    try { guardarBackupLocal(); } catch (e) {}
    void guardarIconosEnFirebase(estado.iconosActuales)
        .catch(error => console.error('Error guardando eliminación:', error));

    return iconoEliminado;
}

// ===== DRAG AND DROP DE ICONOS — MOTOR 4.0 =====
// Drag directo al cursor + reordenamiento real sin placeholder.
// El icono original conserva su slot dentro del grid (solo se vuelve invisible),
// se crea una copia flotante para el cursor y otra copia muy tenue para previsualizar
// exactamente el lugar donde quedará. Los demás iconos se desplazan automáticamente.
const iconDragState = {
    active: false,
    pointerId: null,
    item: null,
    floating: null,
    preview: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    startIndex: -1,
    targetIndex: -1,
    moved: false,
    suppressNextClick: false,
    offsetX: 0,
    offsetY: 0,
    raf: 0,
    originalWidth: 0,
    originalHeight: 0,
    sourceCategoryId: null,
    categoryDropTarget: null,
    categoryDropPrepared: null,
    draggedData: null
};

function inicializarDragAndDrop() {
    const container = DOM.contenedorIconos;
    if (!container || container.dataset.pointerDragReady === '1') return;
    container.dataset.pointerDragReady = '1';
    container.addEventListener('pointerdown', iconPointerDown, { passive: false });
    container.addEventListener('click', iconClickAfterDrag, true);

    // Responsive: si cambia el ancho del contenedor (redimensionar ventana,
    // zoom del navegador, rotación, panel lateral, etc.) recalculamos el
    // layout para que el pitch de columnas y el offset de centrado sigan
    // reflejando la geometría real. No se toca durante un drag activo:
    // el hit-test ya lee getBoundingClientRect() en vivo en cada frame, así
    // que interferir aquí solo podría desincronizar el reordenamiento FLIP.
    if (!inicializarDragAndDrop._resizeObserverReady) {
        inicializarDragAndDrop._resizeObserverReady = true;
        let resizeRaf = 0;
        const onResize = () => {
            if (iconDragState.active) return;
            if (resizeRaf) cancelAnimationFrame(resizeRaf);
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = 0;
                actualizarLayoutIconos();
            });
        };
        if (typeof ResizeObserver === 'function') {
            const layoutResizeObserver = new ResizeObserver(onResize);
            layoutResizeObserver.observe(container);
            const master = container.closest('.contenedor-iconos-master');
            if (master && master !== container) layoutResizeObserver.observe(master);
            // Conservamos una referencia para que el observer permanezca activo
            // durante toda la vida de StarTab.
            inicializarDragAndDrop._layoutResizeObserver = layoutResizeObserver;
        }
        // El breakpoint vertical (<570px) depende del viewport, no sólo del
        // tamaño intrínseco del grid. Escuchamos resize siempre para detectar
        // inmediatamente cuando se entra o sale del modo de scroll compacto.
        window.addEventListener('resize', onResize, { passive: true });
        const compactQuery = window.matchMedia('(max-height: 569.98px)');
        compactQuery.addEventListener?.('change', onResize);
    }
}

function iconPointerDown(e) {
    if (!estado.isAuthenticated || e.button !== 0) return;
    const item = e.target.closest('.icono-item');
    if (!item || !DOM.contenedorIconos.contains(item)) return;
    if (e.target.closest('.btn-incognito-small')) return;

    const r = item.getBoundingClientRect();
    const s = iconDragState;
    s.active = true;
    s.pointerId = e.pointerId;
    s.item = item;
    s.startX = s.currentX = e.clientX;
    s.startY = s.currentY = e.clientY;
    s.startIndex = [...DOM.contenedorIconos.querySelectorAll('.icono-item')].indexOf(item);
    s.draggedData = estado.iconosActuales[s.startIndex] ? { ...estado.iconosActuales[s.startIndex] } : null;
    s.targetIndex = s.startIndex;
    s.moved = false;
    s.suppressNextClick = false;
    s.offsetX = e.clientX - r.left;
    s.offsetY = e.clientY - r.top;
    s.originalWidth = r.width;
    s.originalHeight = r.height;
    // Guardamos la categoría de origen: el drop sobre una categoría NO cambia
    // la categoría visible, solo mueve el acceso directo en segundo plano.
    s.sourceCategoryId = estado.categoriaActual;
    s.categoryDropTarget = null;
    s.categoryDropPrepared = null;

    item.setPointerCapture?.(e.pointerId);
    item.classList.add('drag-preparing');
    window.addEventListener('pointermove', iconPointerMove, { passive: false });
    window.addEventListener('pointerup', iconPointerUp, { passive: false });
    window.addEventListener('pointercancel', iconPointerCancel, { passive: false });
}

function comenzarIconoDragVisual() {
    const s = iconDragState;
    const item = s.item;
    const container = DOM.contenedorIconos;
    if (!item || !container) return;

    const r = item.getBoundingClientRect();

    // El original NO sale del grid. Esto evita crear un hueco adicional.
    // Solo queda invisible mientras el orden se va modificando en tiempo real.
    item.classList.remove('drag-preparing');
    item.classList.add('drag-source-hidden');

    // Copia que viaja pegada al cursor.
    const floating = item.cloneNode(true);
    floating.classList.remove('drag-source-hidden', 'drag-preparing');
    floating.classList.add('arrastrando-moderno', 'drag-floating-clone');
    floating.removeAttribute('data-index');
    floating.setAttribute('aria-hidden', 'true');
    floating.style.width = `${r.width}px`;
    floating.style.height = `${r.height}px`;
    floating.style.left = `${r.left}px`;
    floating.style.top = `${r.top}px`;
    floating.style.position = 'fixed';
    // IMPORTANTE: el nodo original puede tener `translate` horizontal para
    // centrar una fila incompleta. getBoundingClientRect() YA incluye ese
    // desplazamiento. Como cloneNode copia el style inline, si no lo anulamos
    // aquí el clon fijo recibe el centrado una segunda vez y visualmente queda
    // corrido (parecía que el drag seguía calculando desde la izquierda).
    floating.style.translate = '0px 0px';
    floating.style.gridArea = 'auto';
    floating.style.placeSelf = 'auto';
    floating.style.pointerEvents = 'none';
    document.body.appendChild(floating);
    s.floating = floating;

    // Copia tenue que muestra el resultado en el slot actual/destino.
    const preview = floating.cloneNode(true);
    preview.classList.remove('arrastrando-moderno', 'drag-floating-clone');
    preview.classList.add('icono-drag-preview');
    preview.setAttribute('aria-hidden', 'true');
    preview.style.width = `${r.width}px`;
    preview.style.height = `${r.height}px`;
    preview.style.position = 'fixed';
    preview.style.left = `${r.left}px`;
    preview.style.top = `${r.top}px`;
    // Igual que el clon flotante: left/top ya son coordenadas físicas finales.
    // Nunca heredamos el translate de centrado del elemento de la cuadrícula.
    preview.style.translate = '0px 0px';
    preview.style.gridArea = 'auto';
    preview.style.placeSelf = 'auto';
    preview.style.pointerEvents = 'none';
    document.body.appendChild(preview);
    s.preview = preview;

    document.body.classList.add('icon-dragging');
    actualizarPosicionIconoFlotante();
    actualizarPreviewDestino();
}

function iconPointerMove(e) {
    const s = iconDragState;
    if (!s.active || e.pointerId !== s.pointerId) return;

    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.moved) {
        if (Math.hypot(dx, dy) < 5) return;
        s.moved = true;
        s.suppressNextClick = true;
        e.preventDefault();
        comenzarIconoDragVisual();
    }

    s.currentX = e.clientX;
    s.currentY = e.clientY;
    e.preventDefault();
    if (!s.raf) s.raf = requestAnimationFrame(actualizarIconoDrag);
}

function actualizarPosicionIconoFlotante() {
    const s = iconDragState;
    if (!s.floating) return;
    s.floating.style.left = `${s.currentX - s.offsetX}px`;
    s.floating.style.top = `${s.currentY - s.offsetY}px`;
}

function obtenerCentroFisicoIconoArrastrado() {
    const s = iconDragState;
    return {
        x: (s.currentX - s.offsetX) + (s.originalWidth / 2),
        y: (s.currentY - s.offsetY) + (s.originalHeight / 2)
    };
}

function actualizarIconoDrag() {
    const s = iconDragState;
    s.raf = 0;
    if (!s.active || !s.item || !s.moved) return;

    actualizarPosicionIconoFlotante();
    actualizarDestinoCategoria(s.currentX, s.currentY);

    // El hit-test sigue el CENTRO FÍSICO del acceso flotante, no el puntero.
    // Si el usuario agarra el icono por una esquina, la decisión de inserción
    // continúa correspondiendo al lugar donde realmente está el acceso.
    const puntoActivo = obtenerCentroFisicoIconoArrastrado();
    const nuevoIndice = calcularIndiceObjetivoReal(puntoActivo.x, puntoActivo.y);
    if (nuevoIndice !== s.targetIndex) {
        reubicarIconoRealEnIndice(nuevoIndice);
        s.targetIndex = nuevoIndice;
        // Esperamos al siguiente layout para que la previsualización coincida
        // exactamente con la nueva posición física del icono.
        requestAnimationFrame(actualizarPreviewDestino);
    } else {
        actualizarPreviewDestino();
    }
}

function obtenerBotonCategoriaBajoCursor(x, y) {
    // elementFromPoint sigue funcionando aunque la copia flotante esté sobre el cursor
    // porque esta tiene pointer-events:none.
    const el = document.elementFromPoint(x, y);
    const btn = el?.closest?.('.categoria-btn[data-categoria]');
    if (!btn) return null;
    if (btn.classList.contains('agregar-categoria-btn')) return null;
    if (!document.querySelector('.categorias-container')?.contains(btn)) return null;
    return btn;
}

function actualizarDestinoCategoria(x, y) {
    const s = iconDragState;
    if (!s.active || !s.moved) return;

    const btn = obtenerBotonCategoriaBajoCursor(x, y);
    const targetId = btn?.dataset.categoria || null;

    if (targetId === s.sourceCategoryId) {
        // Soltar en la categoría actual no debe provocar un movimiento de categoría.
        limpiarDestinoCategoriaVisual();
        s.categoryDropTarget = null;
        return;
    }

    if (s.categoryDropTarget === targetId) return;

    limpiarDestinoCategoriaVisual();
    s.categoryDropTarget = targetId;

    if (btn) {
        btn.classList.add('icon-category-drop-target');
        if (s.floating) s.floating.classList.add('icon-drag-over-category');
    }
}

function limpiarDestinoCategoriaVisual() {
    document.querySelectorAll('.categoria-btn.icon-category-drop-target')
        .forEach(btn => btn.classList.remove('icon-category-drop-target'));
    iconDragState.floating?.classList.remove('icon-drag-over-category');
}

async function obtenerIconosCategoriaParaMover(categoriaId) {
    if (iconosCache.has(categoriaId)) {
        return [...(iconosCache.get(categoriaId) || [])];
    }

    try {
        const local = localStorage.getItem(`iconos_${categoriaId}`);
        if (local) {
            const parsed = JSON.parse(local);
            iconosCache.set(categoriaId, parsed);
            return [...parsed];
        }
    } catch (e) {}

    // Si todavía no se ha visitado esa categoría, obtenemos sus iconos sin
    // cambiar estado.categoriaActual ni navegar la interfaz.
    if (currentUser && db) {
        try {
            const snap = await userDocRef
                .collection('categorias')
                .doc(categoriaId)
                .collection('iconos')
                .orderBy('orden')
                .get();

            const iconos = [];
            snap.forEach(doc => iconos.push({ id: doc.id, ...doc.data() }));
            iconosCache.set(categoriaId, iconos);
            try {
                localStorage.setItem(`iconos_${categoriaId}`, JSON.stringify(iconos));
            } catch (e) {}
            return iconos;
        } catch (e) {
            console.error('No se pudieron cargar los iconos de la categoría destino:', e);
        }
    }

    // En modo local, General conserva sus accesos predeterminados.
    if (categoriaId === 'general') {
        const defaults = obtenerIconosPorDefecto();
        iconosCache.set(categoriaId, defaults);
        return [...defaults];
    }

    iconosCache.set(categoriaId, []);
    return [];
}

async function guardarIconosEnCategoriaSinCambiarVista(categoriaId, iconos) {
    // Actualización local inmediata, eliminando cualquier URL repetida.
    const copia = deduplicarAccesos(iconos);
    iconosCache.set(categoriaId, copia);
    try {
        localStorage.setItem(`iconos_${categoriaId}`, JSON.stringify(copia));
    } catch (e) {}
    try { guardarBackupLocal(); } catch (e) {}

    if (!currentUser || !db) return;

    try {
        const batch = db.batch();
        const iconosRef = userDocRef
            .collection('categorias')
            .doc(categoriaId)
            .collection('iconos');

        const existing = await iconosRef.get();
        existing.forEach(doc => batch.delete(doc.ref));

        copia.forEach((icono, index) => {
            const newDocRef = iconosRef.doc(idEstableAcceso(icono.url));
            batch.set(newDocRef, {
                nombre: icono.nombre,
                url: icono.url,
                icono: icono.icono,
                estilos: icono.estilos || ESTILOS_DEFAULT,
                orden: index,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        await batch.commit();
        await userDocRef
            .collection('categorias')
            .doc(categoriaId)
            .set({
                ultimaModificacion: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
    } catch (error) {
        console.error(`Error guardando iconos de la categoría ${categoriaId}:`, error);
    }
}

async function moverIconoACategoriaDestino(icono, sourceCategoryId, targetCategoryId) {
    if (!icono || !sourceCategoryId || !targetCategoryId || sourceCategoryId === targetCategoryId) return;

    // El origen se actualiza en el mismo frame para que el usuario vea el drop
    // como una acción instantánea. El destino se resuelve sin abrirlo.
    const sourceIcons = estado.iconosActuales.filter(i => i !== icono);
    estado.iconosActuales = sourceIcons;
    iconosCache.set(sourceCategoryId, [...sourceIcons]);
    try {
        localStorage.setItem(`iconos_${sourceCategoryId}`, JSON.stringify(sourceIcons));
    } catch (e) {}
    try { guardarBackupLocal(); } catch (e) {}

    // No cambiamos estado.categoriaActual.
    // Cargamos la categoría destino solo para combinar sus iconos actuales.
    const targetIcons = await obtenerIconosCategoriaParaMover(targetCategoryId);
    if (!targetIcons.some(i => i.url === icono.url && i.nombre === icono.nombre)) {
        targetIcons.push({ ...icono });
    }

    iconosCache.set(targetCategoryId, targetIcons);
    try {
        localStorage.setItem(`iconos_${targetCategoryId}`, JSON.stringify(targetIcons));
    } catch (e) {}

    // Persistimos ambas categorías independientemente de cuál esté visible.
    Promise.all([
        guardarIconosEnCategoriaSinCambiarVista(sourceCategoryId, sourceIcons),
        guardarIconosEnCategoriaSinCambiarVista(targetCategoryId, targetIcons)
    ]).catch(error => console.error('Error moviendo icono entre categorías:', error));
}

function calcularIndiceObjetivoReal(x, y) {
    const s = iconDragState;
    const container = DOM.contenedorIconos;
    if (!container || !s.item) return s.targetIndex;

    /*
     * MOTOR DE HIT-TEST 6.0 — GEOMETRÍA FÍSICA
     * No usamos la posición teórica de las columnas del grid. Usamos la
     * geometría REAL que el usuario está viendo, incluyendo translate()
     * aplicado a filas centradas. X/Y representan el centro físico del acceso
     * flotante (no el cursor), por lo que el punto de agarre no desplaza las
     * zonas de inserción y una fila centrada se comporta desde donde está.
     */
    const all = [...container.querySelectorAll('.icono-item')]
        .filter(el => el !== s.item && !el.hidden && getComputedStyle(el).display !== 'none');

    if (!all.length) return 0;

    const cards = all.map((el, domIndex) => {
        const r = el.getBoundingClientRect();
        return {
            el,
            domIndex,
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            cx: r.left + r.width / 2,
            cy: r.top + r.height / 2,
            w: r.width,
            h: r.height
        };
    }).sort((a, b) => a.top - b.top || a.left - b.left);

    // Agrupar por bandas físicas. La tolerancia se basa en la altura real,
    // no en una constante, por lo que funciona también con escalado/zoom.
    const rows = [];
    for (const card of cards) {
        let row = rows.find(r => {
            const tolerance = Math.min(card.h, r.avgH) * 0.42;
            return Math.abs(card.cy - r.cy) <= tolerance;
        });

        if (!row) {
            row = { items: [], cy: card.cy, avgH: card.h };
            rows.push(row);
        }

        row.items.push(card);
        row.cy = row.items.reduce((sum, c) => sum + c.cy, 0) / row.items.length;
        row.avgH = row.items.reduce((sum, c) => sum + c.h, 0) / row.items.length;
    }

    rows.sort((a, b) => a.cy - b.cy);
    rows.forEach(row => row.items.sort((a, b) => a.left - b.left));

    // Elegimos la fila mediante bandas entre filas. Si el cursor está entre
    // dos filas, el límite queda justo a mitad de camino: mucho más natural
    // que "la fila cuyo centro esté más cerca".
    let rowIndex = 0;
    if (rows.length > 1) {
        for (let i = 0; i < rows.length - 1; i++) {
            const boundary = (rows[i].cy + rows[i + 1].cy) / 2;
            if (y >= boundary) rowIndex = i + 1;
            else break;
        }
    }

    const row = rows[rowIndex];
    const items = row.items;

    // Hit zones horizontales: el corte entre "insertar antes" e "insertar
    // después" de un acceso es su propio centro geométrico real (no el punto
    // medio entre dos accesos vecinos).
    //
    // FIX MOTOR 5.1 — bug de la "penúltima posición":
    // La versión anterior generaba las zonas a partir de puntos medios
    // ENTRE cada par de accesos (N accesos -> N-1 puntos medios -> solo
    // N zonas alcanzables). Pero para insertar en cualquiera de las N+1
    // posiciones posibles (antes del primero, entre cada par, después del
    // último) hacen falta N cortes, no N-1. Al faltar uno, la zona
    // "justo antes del último elemento" y la zona "después del último
    // elemento" quedaban fusionadas, y el cursor solo podía resolver a
    // "después del último" (el algoritmo saltaba directo al final,
    // saltándose la penúltima posición).
    //
    // La solución correcta es usar el centro de CADA acceso como corte:
    // así hay exactamente N cortes para N accesos, cubriendo las N+1
    // posiciones de inserción sin zonas muertas. Esto también coincide
    // exactamente con el criterio pedido: mitad izquierda de un icono ->
    // insertar antes; mitad derecha -> insertar después.
    for (let i = 0; i < items.length; i++) {
        if (x < items[i].cx) return items[i].domIndex;
    }

    return items[items.length - 1].domIndex + 1;
}

function reubicarIconoRealEnIndice(index) {
    const s = iconDragState;
    const container = DOM.contenedorIconos;
    if (!container || !s.item) return;

    const items = [...container.querySelectorAll('.icono-item')].filter(el => el !== s.item);
    const safeIndex = Math.max(0, Math.min(index, items.length));
    const reference = items[safeIndex] || null;

    // ===== FLIP (First-Last-Invert-Play) =====
    // grid-column-start/grid-row-start no son propiedades animables, así que
    // cuando un acceso cambia de celda dentro de la cuadrícula, el navegador
    // lo saltaría de golpe aunque `translate`/`transform` tengan transición.
    // Para conseguir el desplazamiento suave pedido (sin reconstruir el DOM
    // ni usar timers), medimos la posición real de cada acceso ANTES del
    // reordenamiento (First), lo movemos y recalculamos el layout (Last),
    // y luego aplicamos un `transform: translate3d()` que compensa
    // exactamente la diferencia (Invert) para animarlo a cero en el
    // siguiente frame (Play). `transform` es una propiedad CSS separada de
    // `translate` (que ya usa actualizarLayoutIconos para el offset de
    // centrado), así que ambas se combinan sin pisarse.
    const visibles = items.filter(el => !el.hidden && getComputedStyle(el).display !== 'none');
    const firstRects = new Map();
    for (const el of visibles) firstRects.set(el, el.getBoundingClientRect());

    if (reference) {
        if (s.item.nextElementSibling !== reference) container.insertBefore(s.item, reference);
    } else if (container.lastElementChild !== s.item) {
        container.appendChild(s.item);
    }

    // El contenedor usa una cuadrícula determinista, pero la posición de cada
    // acceso depende de su orden DOM. Al mover un nodo no se debe renderizar
    // nuevamente ni recrear imágenes/listeners: únicamente recalculamos las
    // coordenadas CSS del layout para que la nueva posición sea inmediata.
    actualizarLayoutIconos();
    container.classList.add('iconos-reordenando');

    for (const [el, first] of firstRects) {
        const last = el.getBoundingClientRect();
        const dx = first.left - last.left;
        const dy = first.top - last.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

        // Invert: colocamos el elemento visualmente donde ya estaba, sin
        // transición, para que el salto de celda sea invisible.
        el.style.setProperty('transition', 'none', 'important');
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        el.getBoundingClientRect(); // fuerza el reflow antes de animar.

        // Play: en el siguiente frame restauramos la transición normal
        // (75ms, definida en CSS) y animamos hacia la posición final real.
        requestAnimationFrame(() => {
            el.style.removeProperty('transition');
            el.style.transform = '';
        });
    }
}

function actualizarPreviewDestino() {
    const s = iconDragState;
    if (!s.preview || !s.item) return;
    const r = s.item.getBoundingClientRect();
    s.preview.style.left = `${r.left}px`;
    s.preview.style.top = `${r.top}px`;
    s.preview.style.width = `${r.width}px`;
    s.preview.style.height = `${r.height}px`;
}

async function iconPointerUp(e) {
    const s = iconDragState;
    if (!s.active || e.pointerId !== s.pointerId) return;
    e.preventDefault();
    if (s.moved) finalizarIconoDrag();
    else limpiarIconoDrag();
}

function iconPointerCancel(e) {
    if (iconDragState.active && e.pointerId === iconDragState.pointerId) limpiarIconoDrag(true);
}

async function finalizarIconoDrag() {
    const s = iconDragState;
    const container = DOM.contenedorIconos;
    const item = s.item;
    if (!item || !container) { limpiarIconoDrag(); return; }

    const categoryTarget = s.categoryDropTarget;
    const sourceCategory = s.sourceCategoryId;
    const draggedIcon = s.draggedData;

    // Drop sobre una categoría: NO cambiamos de pestaña/categoría.
    if (categoryTarget && sourceCategory && categoryTarget !== sourceCategory && draggedIcon) {
        // Cerramos el drag visual primero; luego la persistencia continúa en segundo plano.
        limpiarIconoDrag();
        // Quitamos el icono inmediatamente de la categoría visible.
        const sourceIcons = estado.iconosActuales.filter((_, index) => index !== s.startIndex);
        estado.iconosActuales = sourceIcons;
        iconosCache.set(sourceCategory, [...sourceIcons]);
        try { localStorage.setItem(`iconos_${sourceCategory}`, JSON.stringify(sourceIcons)); } catch (e) {}
        try { guardarBackupLocal(); } catch (e) {}
        await renderizarIconos(true);

        // Mover al destino sin navegar.
        moverIconoACategoriaDestino(draggedIcon, sourceCategory, categoryTarget);
        return;
    }

    const currentItems = [...container.querySelectorAll('.icono-item')];
    const fromIndex = s.startIndex;
    const toIndex = currentItems.indexOf(item);

    // IMPORTANTE: cerrar visualmente el drag primero. Nunca esperamos a Firebase.
    // El usuario ve el icono colocado en el mismo frame del pointerup.
    limpiarIconoDrag();

    if (fromIndex !== toIndex && fromIndex >= 0 && toIndex >= 0) {
        const [moved] = estado.iconosActuales.splice(fromIndex, 1);
        estado.iconosActuales.splice(toIndex, 0, moved);
        sincronizarIndicesIconosSinRender();
        guardarIconosLocalmente(estado.iconosActuales);

        // Persistencia en segundo plano: jamás bloquea el drop.
        Promise.resolve(guardarIconosEnFirebase(estado.iconosActuales))
            .catch(error => console.error('Error guardando nuevo orden de iconos:', error));
    }
}

function sincronizarIndicesIconosSinRender() {
    [...DOM.contenedorIconos.querySelectorAll('.icono-item')].forEach((el, index) => {
        el.dataset.index = index;
    });
}

function limpiarIconoDrag(restorePosition = false) {
    const s = iconDragState;
    if (s.raf) cancelAnimationFrame(s.raf);
    s.raf = 0;

    if (restorePosition && s.item && DOM.contenedorIconos) {
        const items = [...DOM.contenedorIconos.querySelectorAll('.icono-item')].filter(el => el !== s.item);
        const ref = items[s.startIndex];
        if (ref) DOM.contenedorIconos.insertBefore(s.item, ref);
        else DOM.contenedorIconos.appendChild(s.item);
    }

    limpiarDestinoCategoriaVisual();
    s.floating?.remove();
    s.preview?.remove();

    if (s.item) {
        s.item.classList.remove('arrastrando-moderno', 'drag-preparing', 'drag-over', 'drag-source-hidden');
        s.item.style.pointerEvents = '';
        s.item.style.opacity = '';
        s.item.style.transform = '';
    }

    // Por si el drag terminó a mitad de una animación FLIP (poco probable
    // dados los 75ms, pero posible con pointercancel): dejamos cada acceso
    // sin transform/transition inline residual para que no quede "pegado"
    // en una posición intermedia.
    DOM.contenedorIconos?.querySelectorAll('.icono-item').forEach(el => {
        if (el === s.item) return;
        el.style.removeProperty('transition');
        el.style.transform = '';
    });

    DOM.contenedorIconos?.classList.remove('iconos-reordenando');
    document.body.classList.remove('icon-dragging');

    window.removeEventListener('pointermove', iconPointerMove);
    window.removeEventListener('pointerup', iconPointerUp);
    window.removeEventListener('pointercancel', iconPointerCancel);

    s.active = false;
    s.pointerId = null;
    s.item = null;
    s.floating = null;
    s.preview = null;
    s.moved = false;
    s.sourceCategoryId = null;
    s.categoryDropTarget = null;
    s.categoryDropPrepared = null;
    s.draggedData = null;
}

function iconClickAfterDrag(e) {
    if (iconDragState.suppressNextClick) {
        e.preventDefault();
        e.stopPropagation();
        iconDragState.suppressNextClick = false;
    }
}

// ===== MENÚ CONTEXTUAL =====
function mostrarMenuContextual(event, icono) {
    if (!estado.isAuthenticated) return;

    document.querySelector('.menu-contextual')?.remove();

    const menu = document.createElement('div');
    menu.className = 'menu-contextual';
    menu.style.cssText = `left:${event.clientX}px;top:${event.clientY}px`;
    menu.innerHTML = `
        <div class="menu-item" data-action="editar"><span class="menu-icono">✏️</span>Editar</div>
        <div class="menu-item" data-action="eliminar"><span class="menu-icono">🗑️</span>Eliminar</div>
    `;

    document.body.appendChild(menu);

    menu.addEventListener('click', async e => {
        const action = e.target.closest('.menu-item')?.dataset.action;
        if (action === 'editar') abrirModalEdicion(estado.iconoSeleccionadoIndex, icono);
        else if (action === 'eliminar') {
            menu.remove();
            void eliminarIcono(estado.iconoSeleccionadoIndex);
            return;
        }
        menu.remove();
    });

    setTimeout(() => {
        const cerrar = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', cerrar); }};
        document.addEventListener('click', cerrar);
    }, 100);
}

// ===== FUNCIONES DE FONDO CORREGIDAS =====
let _fondoToken = 0;
let _ultimaCategoriaFondo = null;
// Inicializar desde lo que fondo-rapido.js ya aplicó (si aplicó algo)
let _fondoActivoConfig = window._fondoActivoConfig || null;

function _fondoConfigIgual(a, b) {
    if (!a || !b) return false;
    return a.tipo === b.tipo &&
        a.url === b.url &&
        a.colorInicio === b.colorInicio &&
        a.colorFin === b.colorFin &&
        a.opacidad === b.opacidad &&
        a.desenfoque === b.desenfoque;
}

async function aplicarFondoCategoria(categoriaId) {
    const categoria = categorias.find(c => c.id === categoriaId);
    if (!categoria || !categoria.background) return;

    const fondoConfig = categoria.background;

    // Si ya hay un VIDEO con la misma URL reproduciéndose, conservarlo SIEMPRE.
    // Firebase, la caché local y los renders de iconos pueden volver a invocar
    // esta función durante el arranque. Nunca debemos destruir/recrear el video
    // en ese caso: hacerlo provoca el parpadeo y el micro-corte visible.
    if (fondoConfig.tipo === 'video' && fondoConfig.url) {
        const fondos = document.querySelectorAll('#fondo-activo, #fondo-temporal');
        for (const fondoEl of fondos) {
            const videoExistente = fondoEl.querySelector('video');
            if (videoExistente && videoExistente.src === new URL(fondoConfig.url, document.baseURI).href) {
                _ultimaCategoriaFondo = categoriaId;
                _fondoActivoConfig = { ...fondoConfig };
                window.fondoActualCategoria = fondoConfig;
                guardarFondoLocalStorage(fondoConfig);
                return;
            }
        }
    }

    // Si el fondo en pantalla ya coincide, no hacer nada.
    const fondoActualEl = document.getElementById('fondo-activo');
    if (fondoActualEl && _fondoConfigIgual(_fondoActivoConfig, fondoConfig)) {
        _ultimaCategoriaFondo = categoriaId;
        guardarFondoLocalStorage(fondoConfig);
        return;
    }

    const miToken = ++_fondoToken;

    // Precargar solo imágenes (no precargar video — ya lo tiene fondo-rapido.js)
    if (fondoConfig.tipo === 'imagen' && fondoConfig.url) {
        await precargarImagen(fondoConfig.url);
    }

    if (miToken !== _fondoToken) return;

    _ultimaCategoriaFondo = categoriaId;
    aplicarFondoConFade(fondoConfig);
}

function precargarImagen(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = url;
    });
}

function aplicarFondoConFade(fondoConfig) {
    // Los vídeos también usan doble buffer + crossfade. Mantenemos el vídeo
    // anterior visible mientras el nuevo prepara su primer frame para evitar
    // cortes, pantallas negras o cambios bruscos al navegar entre categorías.
    if (fondoConfig.tipo === 'video' && fondoConfig.url) {
        const actual = document.getElementById('fondo-activo');
        const videoActual = actual?.querySelector('video');
        const urlVideo = new URL(fondoConfig.url, document.baseURI).href;

        if (videoActual && videoActual.src === urlVideo) {
            _fondoActivoConfig = { ...fondoConfig };
            window.fondoActualCategoria = fondoConfig;
            guardarFondoLocalStorage(fondoConfig);
            if (videoActual.paused) videoActual.play().catch(() => {});
            return;
        }

        const DURACION_FADE_VIDEO = 450;
        const tokenEsteVideo = _fondoToken;

        // Solo puede existir un buffer pendiente. Esto evita que cambios
        // rápidos de categoría acumulen vídeos y consuman memoria/CPU.
        document.querySelectorAll('[id="fondo-temporal"]').forEach(el => el.remove());

        const nuevo = document.createElement('div');
        nuevo.id = 'fondo-temporal';
        nuevo.dataset.tipo = 'video';
        nuevo.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -1;
            opacity: 0;
            transition: opacity ${DURACION_FADE_VIDEO}ms cubic-bezier(0.4, 0, 0.2, 1);
            pointer-events: none;
            overflow: hidden;
            background: transparent;
        `;

        // El nuevo vídeo se prepara fuera de pantalla visualmente, mientras
        // el anterior continúa reproduciéndose sin interrupción.
        document.body.insertBefore(nuevo, actual || document.body.firstChild);
        aplicarEstiloFondo(nuevo, fondoConfig);
        const nuevoVideo = nuevo.querySelector('video');

        const limpiarSiObsoleto = () => {
            if (tokenEsteVideo !== _fondoToken) {
                nuevoVideo?.pause();
                nuevo.remove();
                return true;
            }
            return false;
        };

        const activar = () => {
            if (limpiarSiObsoleto()) return;

            if (nuevoVideo) {
                nuevoVideo.play().catch(() => {});
            }

            // Esperar al siguiente frame garantiza que el usuario nunca vea
            // el contenedor vacío antes de comenzar el crossfade.
            requestAnimationFrame(() => {
                if (limpiarSiObsoleto()) return;

                nuevo.style.opacity = '1';
                if (actual) {
                    actual.style.transition = `opacity ${DURACION_FADE_VIDEO}ms cubic-bezier(0.4, 0, 0.2, 1)`;
                    actual.style.opacity = '0';
                }

                setTimeout(() => {
                    if (limpiarSiObsoleto()) return;
                    nuevo.id = 'fondo-activo';
                    if (actual && actual !== nuevo) {
                        actual.querySelector('video')?.pause();
                        actual.remove();
                    }
                    _fondoActivoConfig = { ...fondoConfig };
                    window.fondoActualCategoria = fondoConfig;
                    guardarFondoLocalStorage(fondoConfig);
                }, DURACION_FADE_VIDEO);
            });
        };

        if (nuevoVideo) {
            if (nuevoVideo.readyState >= 2) {
                requestAnimationFrame(activar);
            } else {
                nuevoVideo.addEventListener('loadeddata', activar, { once: true });
                nuevoVideo.addEventListener('canplay', activar, { once: true });
                // En algunos vídeos locales/rápidos loadeddata puede no volver
                // a dispararse después de que ya exista metadata suficiente.
                setTimeout(() => {
                    if (nuevoVideo.readyState >= 2) activar();
                }, 80);
            }
        } else {
            activar();
        }

        return;
    }

    const DURACION_FADE = 400;
    const tokenEsteFrame = _fondoToken;

    // Eliminar fondos temporales anteriores
    document.querySelectorAll('[id="fondo-temporal"]').forEach(el => el.remove());

    let fondoActual = document.getElementById('fondo-activo');

    const nuevoFondo = document.createElement('div');
    nuevoFondo.id = 'fondo-temporal';
    nuevoFondo.dataset.tipo = fondoConfig.tipo;
    nuevoFondo.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: -1;
        opacity: 0;
        transition: opacity ${DURACION_FADE}ms cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
    `;

    document.body.insertBefore(nuevoFondo, fondoActual || document.body.firstChild);
    aplicarEstiloFondo(nuevoFondo, fondoConfig);

    // Forzar reflow
    nuevoFondo.offsetHeight;

    if (fondoActual) {
        fondoActual.style.opacity = '0';
        fondoActual.style.transition = `opacity ${DURACION_FADE}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    }

    requestAnimationFrame(() => {
        if (tokenEsteFrame !== _fondoToken) {
            nuevoFondo.remove();
            return;
        }
        nuevoFondo.style.opacity = '1';

        setTimeout(() => {
            if (tokenEsteFrame !== _fondoToken) {
                nuevoFondo.remove();
                return;
            }
            nuevoFondo.id = 'fondo-activo';
            if (fondoActual) {
                fondoActual.remove();
            }
            // ✅ Registrar qué config está ahora en pantalla
            _fondoActivoConfig = { ...fondoConfig };
        }, DURACION_FADE);
    });

    window.fondoActualCategoria = fondoConfig;
    guardarFondoLocalStorage(fondoConfig);
}

function guardarFondoLocalStorage(fondoConfig) {
    try {
        const fondoActual = localStorage.getItem('starTab_fondo_rapido');
        const nuevoFondo = JSON.stringify({
            tipo: fondoConfig.tipo,
            url: fondoConfig.url || null,
            opacidad: fondoConfig.opacidad,
            desenfoque: fondoConfig.desenfoque,
            colorInicio: fondoConfig.colorInicio || null,
            colorFin: fondoConfig.colorFin || null
        });
        
        if (fondoActual !== nuevoFondo) {
            localStorage.setItem('starTab_fondo_rapido', nuevoFondo);
            console.log('Fondo guardado en localStorage');
        }
    } catch(e) {
        console.log('Error guardando fondo en localStorage:', e);
    }
}

function aplicarEstiloFondo(elemento, config) {
    const { tipo, url, colorInicio, colorFin, opacidad, desenfoque } = config;
    
    // Limpiar estilos anteriores
    elemento.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: -1;
        pointer-events: none;
    `;
    
    // Aplicar desenfoque si es necesario
    if (desenfoque > 0) {
        elemento.style.filter = `blur(${desenfoque}px)`;
    } else {
        elemento.style.filter = 'none';
    }
    
    if (tipo === 'gradiente') {
        elemento.style.background = `linear-gradient(135deg, ${colorInicio}, ${colorFin})`;
        elemento.style.backgroundSize = 'cover';
    } 
    else if (tipo === 'imagen' && url) {
        const op = opacidad || 0.2;
        elemento.style.background = `linear-gradient(rgba(0,0,0,${op}), rgba(0,0,0,${op})), url('${url}')`;
        elemento.style.backgroundSize = 'cover';
        elemento.style.backgroundPosition = 'center';
        
        // Eliminar video si existía
        const oldVideo = elemento.querySelector('video');
        if (oldVideo) oldVideo.remove();
    } 
    else if (tipo === 'video' && url) {
        elemento.style.background = '#000';
        
        // Limpiar fondo de imagen
        elemento.style.backgroundImage = 'none';
        
        let video = elemento.querySelector('video');
        if (!video) {
            video = document.createElement('video');
            video.className = 'video-fondo';
            video.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                object-fit: cover;
            `;
            elemento.appendChild(video);
        }
        
        // IMPORTANTE: no reasignar src/load/play si el elemento ya contiene
        // exactamente este vídeo. Cada load() fuerza una nueva decodificación
        // y produce el parpadeo que se veía al abrir una pestaña nueva.
        const videoUrl = new URL(url, document.baseURI).href;
        const yaEsEsteVideo = video.src === videoUrl;

        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.preload = 'auto';

        if (!yaEsEsteVideo) {
            video.src = url;
            video.load();
        }

        if (video.paused) {
            video.play().catch(() => {});
        }
    }
}

async function guardarFondoCategoria(nuevaConfiguracion) {
    const categoria = categorias.find(c => c.id === estado.categoriaActual);
    if (!categoria) return;

    // El fondo se guarda como un objeto completo. Si es una imagen subida,
    // `url` contiene el data URL/Base64 y Firestore lo conserva con la
    // persistencia offline, incluso aunque en ese momento no haya Internet.
    categoria.background = {
        tipo: nuevaConfiguracion.tipo,
        url: nuevaConfiguracion.url,
        opacidad: nuevaConfiguracion.opacidad,
        desenfoque: nuevaConfiguracion.desenfoque,
        colorInicio: nuevaConfiguracion.colorInicio,
        colorFin: nuevaConfiguracion.colorFin
    };

    // GUARDAR EN LOCALSTORAGE SIEMPRE PRIMERO
    guardarFondoLocalStorage(categoria.background);
    
    // IMPORTANTE: NO comprobamos navigator.onLine. Firestore debe recibir la
    // escritura tanto online como offline; su caché persistente la encola y la
    // sincroniza automáticamente cuando vuelva la conexión.
    if (currentUser && db) {
        try {
            await firestorePersistenceReady;
            await actualizarCategoriaEnFirebase(estado.categoriaActual, {
                background: categoria.background
            });
            console.log('StarTab: fondo guardado en Firestore (online/offline).');
        } catch (error) {
            console.error('StarTab: no se pudo guardar el fondo en Firestore:', error);
        }
    }

    // APLICAR INMEDIATAMENTE
    aplicarFondoCategoria(estado.categoriaActual);
    
    guardarBackupLocal();
}

// ===== BARRA DE BÚSQUEDA =====
function inicializarBarraBusqueda() {
    if (!DOM.barraBusqueda) return;

    if (['google', 'bing', 'duckduckgo'].includes(estado.buscadorActual)) {
        actualizarBuscadorUI();
    }
    
    actualizarPlaceholder();
    DOM.barraBusqueda.focus();

    document.querySelector('.selectores-buscador')?.addEventListener('click', e => {
        const circulo = e.target.closest('.circulo-buscador');
        if (circulo) {
            estado.buscadorActual = circulo.dataset.buscador;
            localStorage.setItem('buscadorSeleccionado', estado.buscadorActual);
            actualizarBuscadorUI();
            actualizarPlaceholder();
            DOM.barraBusqueda.focus();
        }
    });

    document.querySelector('.filtros-busqueda')?.addEventListener('click', e => {
        const filtro = e.target.closest('.filtro-item');
        if (filtro) {
            document.querySelectorAll('.filtro-item').forEach(f => f.classList.remove('activo'));
            filtro.classList.add('activo');
            estado.filtroActual = filtro.dataset.filtro;
            DOM.barraBusqueda.focus();
        }
    });

    DOM.barraBusqueda.addEventListener('input', () => {
        const hasValue = DOM.barraBusqueda.value.length > 0;
        DOM.btnLimpiar?.classList.toggle('visible', hasValue);
        DOM.btnBuscar?.classList.toggle('activo', hasValue);
    });

    DOM.btnLimpiar?.addEventListener('click', () => {
        DOM.barraBusqueda.value = '';
        DOM.barraBusqueda.focus();
        DOM.btnLimpiar.classList.remove('visible');
        DOM.btnBuscar?.classList.remove('activo');
    });

    DOM.btnBuscar?.addEventListener('click', realizarBusqueda);
    DOM.barraBusqueda.addEventListener('keypress', e => e.key === 'Enter' && realizarBusqueda());

    inicializarReconocimientoVoz();
}

// NUEVA FUNCIÓN: Inicializar doble clic en buscadores
function inicializarDobleClickBuscadores() {
    const circulosBuscadores = document.querySelectorAll('.circulo-buscador');
    
    circulosBuscadores.forEach(circulo => {
        circulo.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const buscador = circulo.dataset.buscador;
            let urlPaginaPrincipal = '';
            
            // Definir la URL principal de cada buscador
            switch(buscador) {
                case 'google':
                    urlPaginaPrincipal = 'https://www.google.com';
                    break;
                case 'bing':
                    urlPaginaPrincipal = 'https://www.bing.com';
                    break;
                case 'duckduckgo':
                    urlPaginaPrincipal = 'https://duckduckgo.com';
                    break;
                default:
                    return;
            }
            
            // Abrir en una nueva pestaña
            window.open(urlPaginaPrincipal, '_self');
        });
    });
}

function actualizarBuscadorUI() {
    document.querySelectorAll('.circulo-buscador').forEach(c => {
        c.classList.toggle('activo', c.dataset.buscador === estado.buscadorActual);
    });
}

function actualizarPlaceholder() {
    if (DOM.barraBusqueda) {
        DOM.barraBusqueda.placeholder = `Buscar en ${NOMBRES_BUSCADOR[estado.buscadorActual]}...`;
    }
}

function realizarBusqueda() {
    const termino = DOM.barraBusqueda?.value.trim();
    if (!termino) return;

    let url = URLS_BUSQUEDA[estado.buscadorActual][estado.filtroActual];
    
    if (estado.buscadorActual === 'duckduckgo' && estado.filtroActual !== 'web') {
        url = url.replace('{termino}', encodeURIComponent(termino));
    } else {
        url += encodeURIComponent(termino);
    }
    
    // CAMBIO AQUÍ: '_blank' → '_self' o window.location.href
    window.location.href = url; // Se abre en la MISMA pestaña
}

function inicializarReconocimientoVoz() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        if (DOM.btnMicrofono) {
            Object.assign(DOM.btnMicrofono.style, { opacity: '0.5', cursor: 'not-allowed' });
            DOM.btnMicrofono.title = 'Reconocimiento de voz no soportado';
        }
        return;
    }

    const reconocimiento = new SpeechRecognition();
    Object.assign(reconocimiento, { lang: 'es-ES', continuous: false, interimResults: false });

    DOM.btnMicrofono?.addEventListener('click', () => {
        DOM.btnMicrofono.classList.add('grabando');
        reconocimiento.start();
    });

    reconocimiento.onresult = (event) => {
        DOM.barraBusqueda.value = event.results[0][0].transcript;
        DOM.btnLimpiar?.classList.add('visible');
        DOM.btnBuscar?.classList.add('activo');
        DOM.btnMicrofono?.classList.remove('grabando');
        setTimeout(realizarBusqueda, 500);
    };

    reconocimiento.onerror = reconocimiento.onend = () => {
        DOM.btnMicrofono?.classList.remove('grabando');
    };
}

// ===== MODAL DE ICONOS =====
const STARTAB_FOLDER_ICON_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>
    </svg>`;

function restaurarIconoCarpetaSubida(fileText = document.querySelector('.file-text')) {
    if (!fileText) return;
    fileText.innerHTML = STARTAB_FOLDER_ICON_SVG;
}

function inicializarModalIconos() {
    const modal = DOM.modalIconos;
    if (!modal) return;

    const elementos = {
        titulo: modal.querySelector('h2'),
        nombre: document.getElementById('nombre-sitio'),
        url: document.getElementById('url-sitio'),
        icono: document.getElementById('icono-sitio'),
        tieneFondo: document.getElementById('tiene-fondo-icono'),
        colorFondoContainer: document.getElementById('color-fondo-container'),
        colorFondo: document.getElementById('color-fondo-icono'),
        radioBorde: document.getElementById('radio-borde-icono'),
        radioValor: document.getElementById('radio-valor'),
        tamanoIcono: document.getElementById('tamano-icono'),
        tamanoValor: document.getElementById('tamano-valor'),
        previewIcono: document.getElementById('preview-icono'),
        previewImg: document.getElementById('preview-img'),
        guardarBtn: document.getElementById('guardar-icono'),
        cancelarBtn: document.getElementById('cancelar-icono'),
        cerrarBtn: document.getElementById('cerrar-modal-iconos'),
        fileInput: document.getElementById('icono-file'),
        fileName: document.getElementById('file-name'),
        fileLabel: document.querySelector('.file-label'),
        fileText: document.querySelector('.file-text'),
        colorValor: document.getElementById('color-valor')
    };

    const inputNombre = document.getElementById('nombre-sitio');
    const previewNombre = document.getElementById('preview-nombre');

    if (inputNombre && previewNombre) {
        inputNombre.addEventListener('input', (e) => {
            previewNombre.textContent = e.target.value;
        });
    }

    elementos.tieneFondo?.addEventListener('change', () => {
        elementos.colorFondoContainer.style.display = elementos.tieneFondo.checked ? 'flex' : 'none';
        actualizarPreviewDesdeModal(elementos);
    });

    elementos.colorFondo?.addEventListener('input', () => {
        if (elementos.colorValor) elementos.colorValor.textContent = elementos.colorFondo.value;
        actualizarPreviewDesdeModal(elementos);
    });

    elementos.radioBorde?.addEventListener('input', () => {
        elementos.radioValor.textContent = `${elementos.radioBorde.value}%`;
        actualizarProgresoRange(elementos.radioBorde);
        actualizarPreviewDesdeModal(elementos);
    });

    elementos.tamanoIcono?.addEventListener('input', () => {
        elementos.tamanoValor.textContent = `${elementos.tamanoIcono.value}%`;
        actualizarProgresoRange(elementos.tamanoIcono);
        actualizarPreviewDesdeModal(elementos);
    });

    const ICONO_PREVIEW_DEFECTO = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'64\' height=\'64\' viewBox=\'0 0 24 24\' fill=\'%23666\'%3E%3Ccircle cx=\'12\' cy=\'12\' r=\'10\'/%3E%3C/svg%3E';

    elementos.icono?.addEventListener('input', () => {
        const valor = elementos.icono.value.trim();

        // Se previsualiza cualquier URL o data URI directamente en el <img>,
        // sin importar el formato (png, jpg, svg, webp, ico, gif...).
        // Si la imagen no puede cargarse (enlace roto, bloqueo del sitio, etc.)
        // se cae de nuevo al icono por defecto en lugar de dejar una imagen rota.
        elementos.previewImg.onerror = () => {
            elementos.previewImg.onerror = null;
            elementos.previewImg.src = ICONO_PREVIEW_DEFECTO;
        };
        elementos.previewImg.src = valor || ICONO_PREVIEW_DEFECTO;
        actualizarPreviewDesdeModal(elementos);
    });

    elementos.fileInput?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (!file.type.startsWith('image/')) {
            alert('Por favor, selecciona un archivo de imagen válido.');
            return;
        }
        
        elementos.fileName.textContent = file.name;
        elementos.fileLabel?.classList.add('seleccionado');
        restaurarIconoCarpetaSubida(elementos.fileText);
        
        try {
            const base64Procesada = await comprimirYRedimensionarImagen(file, ICONO_TAMANO_MAX_GUARDADO);
            
            elementos.icono.value = base64Procesada;
            elementos.previewImg.src = base64Procesada;
            
            restaurarIconoCarpetaSubida(elementos.fileText);
            
        } catch (error) {
            console.error('Error al procesar imagen:', error);
            alert('Error al procesar la imagen. Intenta con otra imagen.');
            restaurarIconoCarpetaSubida(elementos.fileText);
            
            elementos.fileInput.value = '';
            elementos.fileName.textContent = '';
            elementos.fileLabel?.classList.remove('seleccionado');
        }
    });

    elementos.guardarBtn?.addEventListener('click', async () => {
        if (!estado.isAuthenticated) {
            alert('Debes iniciar sesión para guardar accesos directos');
            return;
        }
        
        const nombre = elementos.nombre.value;
        const url = elementos.url.value;
        let icono = elementos.icono.value.trim();
        const index = estado.iconoSeleccionadoIndex;
        const estabaEditando = index !== null && index >= 0 && index < estado.iconosActuales.length;

        if (!nombre || !url) {
            alert('Por favor, completa al menos el nombre y la URL');
            return;
        }

        const estilos = {
            tieneFondo: elementos.tieneFondo.checked,
            colorFondo: elementos.colorFondo.value,
            radioBorde: parseInt(elementos.radioBorde.value),
            tamanoIcono: parseInt(elementos.tamanoIcono.value)
        };

        // Mostrar estado de carga en el botón
        const btnGuardar = elementos.guardarBtn;
        const textoOriginal = btnGuardar.innerHTML;
        btnGuardar.disabled = true;
        btnGuardar.innerHTML = '<span class="btn-loading-spinner"></span>Guardando...';
        btnGuardar.classList.add('btn-cargando');

        try {
            // Si el icono es una URL externa (y no ya un data: URI base64),
            // se descarga y se convierte a base64 comprimido (máx. 128px por
            // lado) antes de guardar, para no almacenar enlaces "en crudo"
            // ni imágenes pesadas en Firebase.
            if (esURLDeImagenRemota(icono)) {
                btnGuardar.innerHTML = '<span class="btn-loading-spinner"></span>Optimizando icono...';
                try {
                    const iconoOptimizado = await convertirURLaBase64Comprimido(icono, ICONO_TAMANO_MAX_GUARDADO);
                    icono = iconoOptimizado;
                    elementos.icono.value = iconoOptimizado;
                    elementos.previewImg.src = iconoOptimizado;
                } catch (errorConversion) {
                    console.error('No se pudo optimizar el icono desde la URL:', errorConversion);
                    const continuarSinOptimizar = confirm(
                        'No se pudo descargar/optimizar la imagen de esa URL (puede que el sitio de origen bloquee la descarga). ' +
                        '¿Deseas guardar de todos modos usando el enlace original, sin comprimir?'
                    );
                    if (!continuarSinOptimizar) {
                        return;
                    }
                }
                btnGuardar.innerHTML = '<span class="btn-loading-spinner"></span>Guardando...';
            }

            if (estabaEditando) {
                estado.iconosActuales[index] = { 
                    ...estado.iconosActuales[index],
                    nombre, url, icono, estilos
                };
            } else {
                estado.iconosActuales.push({ nombre, url, icono, estilos });
            }
            
            // Actualización optimista: solo se crea/modifica el nodo afectado.
            // Los iconos existentes conservan sus <img>, listeners y estado de carga.
            const esNuevo = !estabaEditando;
            // El índice se evalúa antes de guardar; para una edición existente
            // siempre actualizamos ese nodo y para un alta añadimos solo uno.
            const indiceDOM = (index !== null && index >= 0 && index < estado.iconosActuales.length) ? index : estado.iconosActuales.length - 1;
            sincronizarIconoDOMIndividual(indiceDOM, estado.iconosActuales[indiceDOM], esNuevo);
            cerrarModalIconos(elementos);

            // Firebase queda fuera del camino crítico visual.
            void guardarIconosEnFirebase(estado.iconosActuales).catch(error =>
                console.error('Error guardando acceso directo:', error)
            );
        } finally {
            // Restaurar el botón en caso de error
            btnGuardar.disabled = false;
            btnGuardar.innerHTML = textoOriginal;
            btnGuardar.classList.remove('btn-cargando');
        }
    });

    elementos.cancelarBtn?.addEventListener('click', () => cerrarModalIconos(elementos));
    elementos.cerrarBtn?.addEventListener('click', () => cerrarModalIconos(elementos));

    modal.addEventListener('click', e => {
        if (e.target === modal) cerrarModalIconos(elementos);
    });

    DOM.btnAgregar?.addEventListener('click', () => {
        if (!estado.isAuthenticated) {
            alert('Debes iniciar sesión para agregar accesos directos');
            return;
        }
        resetearModalIconos(elementos);
        elementos.titulo.textContent = 'Agregar acceso directo';
        estado.iconoSeleccionadoIndex = null;
        modal.classList.add('modal-abierto');
        modal.style.display = 'flex';

        document.querySelectorAll('.control-range').forEach(input => actualizarProgresoRange(input));
    });
}

function actualizarPreviewDesdeModal(elementos) {
    if (!elementos.previewIcono || !elementos.previewImg) return;
    
    Object.assign(elementos.previewIcono.style, {
        backgroundColor: elementos.tieneFondo.checked ? elementos.colorFondo.value : 'transparent',
        borderRadius: `${elementos.radioBorde.value}%`,
        boxShadow: elementos.tieneFondo.checked ? '0 4px 15px rgba(0,0,0,0.2)' : 'none'
    });
    
    Object.assign(elementos.previewImg.style, {
        width: `${elementos.tamanoIcono.value}%`,
        height: `${elementos.tamanoIcono.value}%`,
        borderRadius: `${elementos.radioBorde.value}%`
    });
}

function abrirModalEdicion(index, icono) {
    if (!estado.isAuthenticated) return;
    
    const modal = DOM.modalIconos;
    if (!modal) return;

    const elementos = {
        titulo: modal.querySelector('h2'),
        nombre: document.getElementById('nombre-sitio'),
        url: document.getElementById('url-sitio'),
        icono: document.getElementById('icono-sitio'),
        tieneFondo: document.getElementById('tiene-fondo-icono'),
        colorFondoContainer: document.getElementById('color-fondo-container'),
        colorFondo: document.getElementById('color-fondo-icono'),
        radioBorde: document.getElementById('radio-borde-icono'),
        radioValor: document.getElementById('radio-valor'),
        tamanoIcono: document.getElementById('tamano-icono'),
        tamanoValor: document.getElementById('tamano-valor'),
        previewIcono: document.getElementById('preview-icono'),
        previewImg: document.getElementById('preview-img'),
        colorValor: document.getElementById('color-valor')
    };

    // Resetear el campo de archivo primero
    const fileInput = document.getElementById('icono-file');
    const fileName = document.getElementById('file-name');
    const fileText = document.querySelector('.file-text');
    
    if (fileInput) fileInput.value = '';
    if (fileName) fileName.textContent = '';
    document.querySelector('.file-label')?.classList.remove('seleccionado');
    restaurarIconoCarpetaSubida(fileText);

    const estilos = { ...ESTILOS_DEFAULT, ...(icono.estilos || {}) };

    elementos.titulo.textContent = 'Editar acceso directo';
    elementos.nombre.value = icono.nombre || '';
    elementos.url.value = icono.url || '';
    
    // FORZAR la actualización del campo de icono y la vista previa
    elementos.icono.value = icono.icono || '';
    elementos.previewImg.src = icono.icono || './img/icons/interrogacion.png';
    
    elementos.tieneFondo.checked = estilos.tieneFondo || false;
    elementos.colorFondo.value = estilos.colorFondo || '#667eea';
    if (elementos.colorValor) elementos.colorValor.textContent = estilos.colorFondo || '#667eea';
    elementos.radioBorde.value = estilos.radioBorde ?? ESTILOS_DEFAULT.radioBorde;
    elementos.radioValor.textContent = `${elementos.radioBorde.value}%`;
    elementos.tamanoIcono.value = estilos.tamanoIcono ?? ESTILOS_DEFAULT.tamanoIcono;
    elementos.tamanoValor.textContent = `${elementos.tamanoIcono.value}%`;
    elementos.colorFondoContainer.style.display = elementos.tieneFondo.checked ? 'flex' : 'none';

    // Actualizar el nombre en la vista previa
    const previewNombre = document.getElementById('preview-nombre');
    if (previewNombre) {
        previewNombre.textContent = icono.nombre || '';
    }

    // Forzar la actualización de la vista previa
    actualizarPreviewDesdeModal(elementos);
    
    modal.classList.add('modal-abierto');
    modal.style.display = 'flex';
    document.querySelectorAll('.control-range').forEach(input => actualizarProgresoRange(input));
}

function resetearModalIconos(elementos) {
    elementos.nombre.value = '';
    elementos.url.value = '';
    elementos.icono.value = '';
    elementos.tieneFondo.checked = false;
    elementos.colorFondoContainer.style.display = 'none';
    elementos.colorFondo.value = '#667eea';
    if (elementos.colorValor) elementos.colorValor.textContent = '#667eea';
    elementos.radioBorde.value = '0';
    elementos.radioValor.textContent = '0%';
    elementos.tamanoIcono.value = '100';
    elementos.tamanoValor.textContent = '100%';
    
    const previewNombre = document.getElementById('preview-nombre');
    if (previewNombre) {
        previewNombre.textContent = '';
    }
    
    const fileInput = document.getElementById('icono-file');
    const fileName = document.getElementById('file-name');
    const fileText = document.querySelector('.file-text');
    
    if (fileInput) fileInput.value = '';
    if (fileName) fileName.textContent = '';
    document.querySelector('.file-label')?.classList.remove('seleccionado');
    restaurarIconoCarpetaSubida(fileText);
    
    Object.assign(elementos.previewIcono.style, { 
        backgroundColor: 'transparent', 
        borderRadius: '0%', 
        boxShadow: 'none' 
    });
    Object.assign(elementos.previewImg.style, { 
        width: '100%', 
        height: '100%',
        borderRadius: '0%'
    });
    
    // Usar la imagen de interrogación por defecto
    elementos.previewImg.src = './img/icons/interrogacion.png';
}

function cerrarModalIconos(elementos) {
    const modal = DOM.modalIconos;
    if (!modal) return;
    
    const previewNombre = document.getElementById('preview-nombre');
    if (previewNombre) {
        previewNombre.textContent = '';
    }
    
    modal.classList.remove('modal-abierto');
    modal.classList.add('modal-cerrando');
    setTimeout(() => {
        modal.classList.remove('modal-cerrando');
        modal.style.display = 'none';
    }, 280);
}

function actualizarProgresoRange(input) {
    if (!input) return;
    
    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max) || 100;
    const value = parseFloat(input.value) || min;
    
    const porcentaje = ((value - min) / (max - min)) * 100;
    
    input.style.background = `linear-gradient(to right, white, white ${porcentaje}%, rgba(255,255,255,0.2) ${porcentaje}%, rgba(255,255,255,0.2))`;
}

// ===== MODAL DE PERSONALIZACIÓN =====
function inicializarModalPersonalizar() {
    const modal = DOM.modalPersonalizar;
    if (!modal) return;

    const elementos = {
        tipo: document.getElementById('fondo-tipo'),
        url: document.getElementById('fondo-url-input'),
        imagenFileBtn: document.getElementById('fondo-imagen-file-btn'),
        imagenFile: document.getElementById('fondo-imagen-file'),
        opacidad: document.getElementById('fondo-opacidad'),
        opacidadValor: document.getElementById('opacidad-valor'),
        desenfoque: document.getElementById('fondo-desenfoque'),
        desenfoqueValor: document.getElementById('desenfoque-valor'),
        colorInicio: document.getElementById('color-inicio'),
        colorFin: document.getElementById('color-fin'),
        grupoColores: document.getElementById('grupo-colores'),
        imagenesSection: document.getElementById('imagenes-predefinidas'),
        videosSection: document.getElementById('videos-predefinidos'),
        previewFondo: document.getElementById('preview-fondo'),
        previewVideo: document.getElementById('preview-video'),
        guardarBtn: document.getElementById('guardar-personalizacion'),
        cancelarBtn: document.getElementById('cancelar-personalizacion')
    };

    // Convierte la imagen local a Base64 optimizado. Se reduce antes de guardarla
    // para evitar superar el límite de ~1 MiB por documento de Firestore.
    const convertirImagenABase64 = (file) => new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith('image/')) {
            reject(new Error('El archivo seleccionado no es una imagen válida.'));
            return;
        }

        const reader = new FileReader();
        reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                let maxSide = 1600;
                let quality = 0.82;
                let resultado = '';

                for (let intento = 0; intento < 6; intento++) {
                    const escala = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
                    canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
                    const ctx = canvas.getContext('2d', { alpha: false });
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resultado = canvas.toDataURL('image/jpeg', quality);

                    // Dejamos margen para metadatos del documento Firestore.
                    if (resultado.length <= 850000) break;
                    maxSide = Math.round(maxSide * 0.8);
                    quality = Math.max(0.55, quality - 0.06);
                }

                if (!resultado) {
                    reject(new Error('No se pudo convertir la imagen a Base64.'));
                    return;
                }
                resolve(resultado);
            };
            img.onerror = () => reject(new Error('La imagen seleccionada no pudo procesarse.'));
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });

    const actualizarBotonSubirImagen = () => {
        const esImagen = elementos.tipo.value === 'imagen';
        if (elementos.imagenFileBtn) {
            elementos.imagenFileBtn.style.display = esImagen ? 'inline-flex' : 'none';
        }
    };

    elementos.imagenFileBtn?.addEventListener('click', () => {
        if (elementos.tipo.value === 'imagen') elementos.imagenFile?.click();
    });

    elementos.imagenFile?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            elementos.imagenFileBtn?.classList.add('cargando');
            const base64 = await convertirImagenABase64(file);
            elementos.url.value = base64;
            actualizarPreviewFondo(elementos);
        } catch (error) {
            console.error('Error al convertir la imagen a Base64:', error);
            alert('No se pudo cargar la imagen seleccionada.');
        } finally {
            elementos.imagenFileBtn?.classList.remove('cargando');
            event.target.value = '';
        }
    });

    actualizarBotonSubirImagen();

    const botonesTipo = document.querySelectorAll('#fondo-tipo-buttons .btn-tipo');

    botonesTipo.forEach(boton => {
        boton.addEventListener('click', () => {
            botonesTipo.forEach(b => b.classList.remove('activo'));
            boton.classList.add('activo');
            elementos.tipo.value = boton.dataset.value;
            actualizarSeccionesFondo(elementos);
            actualizarBotonSubirImagen();
            actualizarPreviewFondo(elementos);
        });
    });

    document.querySelectorAll('.opcion-fondo').forEach(opcion => {
        opcion.addEventListener('click', () => {
            const tipo = opcion.dataset.tipo;
            const url = opcion.dataset.url;

            elementos.tipo.value = tipo;
            elementos.url.value = url;

            document.querySelectorAll('.opcion-fondo').forEach(item => {
                item.classList.toggle('seleccionada', item === opcion);
            });

            botonesTipo.forEach(b => {
                b.classList.toggle('activo', b.dataset.value === tipo);
            });
            actualizarBotonSubirImagen();

            actualizarSeccionesFondo(elementos);
            actualizarPreviewFondo(elementos);
        });
    });

    elementos.url?.addEventListener('input', () => actualizarPreviewFondo(elementos));
    elementos.colorInicio?.addEventListener('input', () => actualizarPreviewFondo(elementos));
    elementos.colorFin?.addEventListener('input', () => actualizarPreviewFondo(elementos));

    elementos.opacidad?.addEventListener('input', () => {
        elementos.opacidadValor.textContent = `${elementos.opacidad.value}%`;
        actualizarProgresoRange(elementos.opacidad);
        actualizarPreviewFondo(elementos);
    });

    elementos.desenfoque?.addEventListener('input', () => {
        elementos.desenfoqueValor.textContent = `${elementos.desenfoque.value}px`;
        actualizarProgresoRange(elementos.desenfoque);
        actualizarPreviewFondo(elementos);
    });

    elementos.guardarBtn?.addEventListener('click', () => {
        if (!estado.isAuthenticated) {
            alert('Debes iniciar sesión para personalizar el fondo');
            return;
        }

        const opacidadSlider = parseInt(elementos.opacidad.value);
        const opacidadGuardar = (opacidadSlider / 100) * 0.5;

        const config = {
            tipo: elementos.tipo.value,
            url: elementos.url.value || null,
            opacidad: opacidadGuardar,
            desenfoque: parseInt(elementos.desenfoque.value),
            colorInicio: elementos.colorInicio.value,
            colorFin: elementos.colorFin.value
        };

        guardarFondoCategoria(config);
        cerrarModalPersonalizar(modal);
    });

    elementos.cancelarBtn?.addEventListener('click', () => cerrarModalPersonalizar(modal));

    modal.addEventListener('click', e => {
        if (e.target === modal) cerrarModalPersonalizar(modal);
    });

    DOM.btnPersonalizar?.addEventListener('click', () => {
        if (!estado.isAuthenticated) {
            alert('Debes iniciar sesión para personalizar el fondo');
            return;
        }

        cargarValoresActualesEnModal(elementos);

        botonesTipo.forEach(b => {
            b.classList.toggle('activo', b.dataset.value === elementos.tipo.value);
        });

        ocultarAccionRedimensionarFlotante();
        modal.classList.add('modal-personalizar-abierto');
        modal.style.display = 'flex';
        
        setTimeout(() => {
            document.querySelectorAll('.control-range').forEach(input => actualizarProgresoRange(input));
        }, 50);
    });
}

function cargarValoresActualesEnModal(elementos) {
    const categoria = categorias.find(c => c.id === estado.categoriaActual);
    const fondoActual = categoria && categoria.background ? categoria.background : FONDO_DEFAULT;

    const { tipo, opacidad, desenfoque, colorInicio, colorFin, url } = fondoActual;

    elementos.tipo.value = tipo || 'gradiente';
    elementos.url.value = url || '';

    const opacidadSlider = Math.round(((opacidad !== undefined ? opacidad : 0.2) / 0.5) * 100);
    elementos.opacidad.value = opacidadSlider;
    elementos.opacidadValor.textContent = `${opacidadSlider}%`;

    elementos.desenfoque.value = desenfoque || 0;
    elementos.desenfoqueValor.textContent = `${desenfoque || 0}px`;

    elementos.colorInicio.value = colorInicio || '#667eea';
    elementos.colorFin.value = colorFin || '#764ba2';

    actualizarSeccionesFondo(elementos);

    document.querySelectorAll('.opcion-fondo').forEach(opcion => {
        opcion.classList.toggle(
            'seleccionada',
            opcion.dataset.tipo === elementos.tipo.value && opcion.dataset.url === elementos.url.value
        );
    });

    actualizarPreviewFondo(elementos);
    
    if (elementos.opacidad) actualizarProgresoRange(elementos.opacidad);
    if (elementos.desenfoque) actualizarProgresoRange(elementos.desenfoque);
}

function actualizarSeccionesFondo(elementos) {
    const tipo = elementos.tipo.value;
    
    elementos.grupoColores.style.display = tipo === 'gradiente' ? 'inline-flex' : 'none';
    elementos.imagenesSection.style.display = tipo === 'imagen' ? 'block' : 'none';
    elementos.videosSection.style.display = tipo === 'video' ? 'block' : 'none';
    
    const urlInputGroup = document.querySelector('.personalizar-input-group:has(#fondo-url-input)');
    if (urlInputGroup) {
        urlInputGroup.style.display = tipo === 'gradiente' ? 'none' : 'inline-flex';
    }
}

function actualizarPreviewFondo(elementos) {
    const tipo = elementos.tipo.value;
    const urlEscrita = (elementos.url.value || '').trim();
    const colorInicio = elementos.colorInicio.value;
    const colorFin = elementos.colorFin.value;
    const opacidadCapa = Math.max(0, Math.min(0.5, (parseInt(elementos.opacidad.value, 10) || 0) / 100 * 0.5));
    const desenfoquePx = Math.max(0, Math.min(20, parseInt(elementos.desenfoque.value, 10) || 0));
    const previerMasterBox = document.querySelector('.previer-master-box');

    if (!previerMasterBox || !elementos.previewFondo || !elementos.previewVideo) return;

    /* Si se cambia a Imagen/Video y el campo todavía está vacío, la vista
       previa conserva una opción real visible en vez de quedarse en blanco. */
    const opcionSeleccionada = document.querySelector(`.opcion-fondo.seleccionada[data-tipo="${tipo}"]`);
    const primeraOpcion = document.querySelector(`.opcion-fondo[data-tipo="${tipo}"]`);
    const urlPreview = urlEscrita || opcionSeleccionada?.dataset.url || primeraOpcion?.dataset.url || '';

    // El oscurecimiento es una capa independiente del medio. No se mezcla con
    // la imagen antes del blur: así la intensidad se mantiene limpia y estable.
    previerMasterBox.style.setProperty('--preview-darkness', String(opacidadCapa));
    previerMasterBox.dataset.previewTipo = tipo;

    /* El blur expande píxeles fuera de los límites del elemento. Escalamos la
       capa multimedia lo justo para cubrir ese halo y el marco lo recorta con
       overflow/clip-path. Esto evita bordes transparentes y cualquier fuga. */
    const escalaBlur = 1 + Math.min(0.22, desenfoquePx / 100);
    const aplicarEfectoMedia = (el) => {
        el.style.filter = desenfoquePx > 0 ? `blur(${desenfoquePx}px)` : 'none';
        el.style.transform = `translateZ(0) scale(${escalaBlur})`;
        el.style.opacity = '1';
    };

    if (tipo === 'video' && urlPreview) {
        elementos.previewFondo.style.display = 'none';
        elementos.previewVideo.style.display = 'block';
        elementos.previewVideo.style.background = 'transparent';
        aplicarEfectoMedia(elementos.previewVideo);

        if (elementos.previewVideo.dataset.previewSrc !== urlPreview) {
            elementos.previewVideo.dataset.previewSrc = urlPreview;
            elementos.previewVideo.src = urlPreview;
            elementos.previewVideo.load();
        }
        elementos.previewVideo.play().catch(() => {});
    } else {
        elementos.previewVideo.pause();
        elementos.previewVideo.style.display = 'none';
        elementos.previewFondo.style.display = 'block';
        aplicarEfectoMedia(elementos.previewFondo);

        elementos.previewFondo.style.backgroundColor = '#111';
        elementos.previewFondo.style.backgroundRepeat = 'no-repeat';
        elementos.previewFondo.style.backgroundSize = 'cover';
        elementos.previewFondo.style.backgroundPosition = 'center';

        if (tipo === 'imagen' && urlPreview) {
            // JSON.stringify genera una cadena CSS segura también para Base64.
            elementos.previewFondo.style.backgroundImage = `url(${JSON.stringify(urlPreview)})`;
        } else if (tipo === 'gradiente') {
            elementos.previewFondo.style.backgroundImage = `linear-gradient(135deg, ${colorInicio}, ${colorFin})`;
        } else {
            elementos.previewFondo.style.backgroundImage = 'linear-gradient(135deg, #23252b, #111216)';
        }
    }

    // El marco nunca debe duplicar la imagen ni recibir blur propio.
    previerMasterBox.style.backgroundImage = 'none';
    previerMasterBox.style.filter = 'none';
    previerMasterBox.style.backdropFilter = 'none';
    previerMasterBox.style.webkitBackdropFilter = 'none';
}

function ocultarAccionRedimensionarFlotante() {
    const grupo = document.getElementById('acciones-personalizacion-flotantes');
    const personalizar = document.getElementById('btn-personalizar');
    const redimensionar = document.getElementById('btn-redimensionar');

    grupo?.classList.remove('is-resize-revealed');
    redimensionar?.setAttribute('aria-hidden', 'true');

    // :focus-within también puede mantener visible el botón secundario.
    // Al cerrar Personalización retiramos ese foco residual inmediatamente.
    if (document.activeElement === redimensionar) redimensionar.blur();
    if (document.activeElement === personalizar) personalizar.blur();
}

function cerrarModalPersonalizar(modal) {
    // El botón secundario debe desaparecer desde el primer frame del cierre,
    // incluso si el cursor/foco todavía está sobre el disparador flotante.
    ocultarAccionRedimensionarFlotante();

    modal.classList.remove('modal-personalizar-abierto');
    modal.classList.add('modal-personalizar-cerrando');
    setTimeout(() => {
        modal.classList.remove('modal-personalizar-cerrando');
        modal.style.display = 'none';
    }, 280);
}

// ===== NOTAS RÁPIDAS · FIREBASE REALTIME =====
function obtenerNotaDOM() {
    if (notaDOMActual?.textarea?.isConnected) return notaDOMActual;
    notaDOMActual = {
        icono: document.getElementById('nota-icono'),
        modal: document.getElementById('nota-modal'),
        cerrar: document.getElementById('nota-modal-cerrar'),
        textarea: document.getElementById('nota-textarea'),
        charCount: document.getElementById('nota-char-count'),
        syncIcon: document.getElementById('nota-sync-icon'),
        syncText: document.getElementById('nota-sync-text'),
        cloudStatus: document.getElementById('nota-cloud-status'),
        lastSync: document.getElementById('nota-last-sync'),
        currentLabel: document.getElementById('nota-current-label'),
        editorHint: document.getElementById('nota-editor-hint'),
        copiarBtn: document.getElementById('nota-btn-copiar'),
        notaBtns: document.querySelectorAll('.nota-btn-numero'),
        previews: document.querySelectorAll('[data-nota-preview]')
    };
    return notaDOMActual;
}

function inicializarNota() {
    const notaDOM = obtenerNotaDOM();
    if (!notaDOM.textarea) return;

    cargarNotasIniciales(notaDOM);

    notaDOM.notaBtns.forEach(btn => {
        btn.addEventListener('click', () => cambiarNota(Number(btn.dataset.nota), notaDOM));
    });

    notaDOM.icono?.addEventListener('click', () => abrirModalNota(notaDOM));
    notaDOM.cerrar?.addEventListener('click', () => cerrarModalNota(notaDOM));
    notaDOM.copiarBtn?.addEventListener('click', () => copiarNota(notaDOM));
    notaDOM.modal?.querySelector('[data-close-notes]')?.addEventListener('click', () => cerrarModalNota(notaDOM));

    notaDOM.textarea.addEventListener('input', (e) => {
        const texto = e.target.value;
        const notaNum = notaEstado.notaActual;
        actualizarContadorCaracteres(texto, notaDOM);
        actualizarPreviewNota(notaNum, texto, notaDOM);
        guardarNotaEnTiempoReal(notaNum, texto, notaDOM);
    });

    notaDOM.textarea.addEventListener('blur', () => flushNotaPendiente(notaEstado.notaActual, notaDOM));

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushTodasLasNotasPendientes(notaDOM);
    });
    window.addEventListener('pagehide', () => flushTodasLasNotasPendientes(notaDOM));

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) {
            e.preventDefault();
            abrirModalNota(notaDOM);
            return;
        }

        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '5' && notaDOM.modal?.classList.contains('nota-modal-abierto')) {
            e.preventDefault();
            cambiarNota(Number(e.key), notaDOM);
            return;
        }

        if (e.key === 'Escape' && notaDOM.modal?.classList.contains('nota-modal-abierto')) {
            cerrarModalNota(notaDOM);
        }
    });

    if (estado.isAuthenticated && userDocRef) conectarNotasTiempoReal(userDocRef);
    else actualizarEstadoNotaSync(navigator.onLine ? 'local' : 'offline', estado.isAuthenticated ? 'Preparando Firebase…' : 'Solo en este dispositivo', notaDOM);
}

function cargarNotasIniciales(notaDOM) {
    const backup = cargarBackupLocal();
    if (backup?.notas) {
        for (let i = 1; i <= 5; i++) {
            const key = `nota${i}`;
            if (Object.prototype.hasOwnProperty.call(backup.notas, key) && typeof backup.notas[key] === 'string') {
                notaEstado.notas[i].contenido = backup.notas[key];
            }
        }
    }
    cargarNota(notaEstado.notaActual, notaDOM);
    actualizarTodosLosPreviews(notaDOM);
}

function conectarNotasTiempoReal(ref = userDocRef) {
    if (!ref || !db) return;
    desconectarNotasTiempoReal(false);

    const notaDOM = obtenerNotaDOM();
    actualizarEstadoNotaSync('sincronizando', 'Conectando con Firebase…', notaDOM);

    unsubscribeNotas = ref.onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
        if (!snapshot.exists) return;
        const data = snapshot.data() || {};
        const tieneCampoNotas = Object.prototype.hasOwnProperty.call(data, 'notas');
        const notasFirebase = data.notas || {};
        const notasMeta = data.notasMeta || {};
        if (tieneCampoNotas) notaMapaFirebaseVisto = true;
        let cambioRemotoVisible = false;

        for (let i = 1; i <= 5; i++) {
            const key = `nota${i}`;
            const tieneNotaRemota = Object.prototype.hasOwnProperty.call(notasFirebase, key);
            if (!tieneNotaRemota && !notaMapaFirebaseVisto) continue;

            const nota = notaEstado.notas[i];
            // Si Firebase elimina una nota/campo que antes existía, se interpreta
            // como una nota vacía para que el borrado también viaje en tiempo real.
            const remoto = tieneNotaRemota
                ? (typeof notasFirebase[key] === 'string' ? notasFirebase[key] : String(notasFirebase[key] ?? ''))
                : '';
            const meta = notasMeta[key] || {};
            const vieneDeEsteCliente = meta.clientId === notaClienteId;

            // Mientras exista una edición local pendiente, ningún snapshot distinto
            // puede pisar lo que el usuario está escribiendo, incluso si el
            // snapshot anterior lleva el mismo clientId de este dispositivo.
            if (nota.pendiente && remoto !== nota.contenido) continue;

            if (remoto !== nota.contenido) {
                nota.contenido = remoto;
                nota.sincronizado = true;
                cambioRemotoVisible = cambioRemotoVisible || !vieneDeEsteCliente;
                if (i === notaEstado.notaActual) aplicarTextoRemotoEnTextarea(remoto, notaDOM);
                actualizarPreviewNota(i, remoto, notaDOM, !vieneDeEsteCliente);
            }

            if (vieneDeEsteCliente && remoto === nota.contenido && !snapshot.metadata.hasPendingWrites) {
                nota.pendiente = false;
                nota.sincronizado = true;
            }
        }

        actualizarTodosLosPreviews(notaDOM);
        guardarBackupLocal();

        if (snapshot.metadata.hasPendingWrites) {
            actualizarEstadoNotaSync(navigator.onLine ? 'guardando' : 'offline', navigator.onLine ? 'Guardando cambios…' : 'Guardado local · esperando conexión', notaDOM);
        } else if (!navigator.onLine) {
            actualizarEstadoNotaSync('offline', 'Sin conexión · cambios protegidos localmente', notaDOM);
        } else if (snapshot.metadata.fromCache) {
            actualizarEstadoNotaSync('sincronizando', 'Sincronizando con la nube…', notaDOM);
        } else if (cambioRemotoVisible) {
            actualizarEstadoNotaSync('remoto', 'Actualizado desde otro dispositivo', notaDOM);
            programarEstadoSincronizado(notaDOM);
        } else {
            actualizarEstadoNotaSync('sincronizado', 'Sincronizado en la nube', notaDOM);
        }
    }, (error) => {
        console.error('StarTab Notes: error en sincronización en tiempo real:', error);
        actualizarEstadoNotaSync('error', 'No se pudo sincronizar', notaDOM);
    });
}

function desconectarNotasTiempoReal(actualizarUI = true) {
    if (unsubscribeNotas) {
        try { unsubscribeNotas(); } catch (_) {}
        unsubscribeNotas = null;
    }
    if (actualizarUI) {
        const notaDOM = obtenerNotaDOM();
        actualizarEstadoNotaSync('local', 'Solo en este dispositivo', notaDOM);
    }
}

function guardarNotaEnTiempoReal(notaNum, texto, notaDOM = obtenerNotaDOM()) {
    const nota = notaEstado.notas[notaNum];
    if (!nota) return;

    nota.contenido = texto;
    nota.lastLocalEditAt = Date.now();
    nota.pendiente = estado.isAuthenticated;
    nota.sincronizado = !estado.isAuthenticated;
    guardarBackupLocal();

    if (!estado.isAuthenticated || !currentUser || !userDocRef || !db) {
        actualizarEstadoNotaSync('local', 'Guardado en este dispositivo', notaDOM);
        return;
    }

    actualizarEstadoNotaSync(navigator.onLine ? 'guardando' : 'offline', navigator.onLine ? 'Cambios pendientes · guardado en 5 s' : 'Sin conexión · se sincronizará después', notaDOM);
    if (notaTimeouts[notaNum]) clearTimeout(notaTimeouts[notaNum]);
    nota.pendingUid = currentUser.uid;
    nota.pendingRef = userDocRef;
    notaTimeouts[notaNum] = setTimeout(
        () => enviarNotaAFirebase(notaNum, notaDOM, nota.pendingRef, nota.pendingUid),
        NOTA_SAVE_DEBOUNCE
    );
}

function enviarNotaAFirebase(notaNum, notaDOM = obtenerNotaDOM(), refDestino = userDocRef, uidDestino = currentUser?.uid) {
    const nota = notaEstado.notas[notaNum];

    if (notaTimeouts[notaNum]) {
        clearTimeout(notaTimeouts[notaNum]);
        delete notaTimeouts[notaNum];
    }

    // El destino se captura al escribir. Así un cambio de cuenta nunca puede
    // enviar accidentalmente texto pendiente al perfil que acaba de iniciar sesión.
    if (!nota || !estado.isAuthenticated || !currentUser || !refDestino || !db || currentUser.uid !== uidDestino) {
        if (nota) nota.pendiente = false;
        return;
    }

    const textoEnviado = nota.contenido;
    const seq = ++nota.writeSeq;
    const ahora = Date.now();
    const key = `nota${notaNum}`;
    const payload = {
        notas: { [key]: textoEnviado },
        notasMeta: {
            [key]: {
                clientId: notaClienteId,
                clientUpdatedAt: ahora,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }
        },
        metadata: { ultimaModificacion: firebase.firestore.FieldValue.serverTimestamp() }
    };

    // set(..., {merge:true}) mantiene compatibilidad con el esquema existente
    // y funciona también con la persistencia offline de Firestore.
    refDestino.set(payload, { merge: true }).then(() => {
        if (nota.writeSeq !== seq || nota.contenido !== textoEnviado) return;
        nota.pendiente = false;
        nota.sincronizado = true;
        if (navigator.onLine && currentUser?.uid === uidDestino) {
            actualizarEstadoNotaSync('sincronizado', 'Sincronizado en la nube', notaDOM);
            marcarUltimaSincronizacion(notaDOM);
        }
    }).catch((error) => {
        console.error(`StarTab Notes: error guardando nota ${notaNum}:`, error);
        if (nota.writeSeq === seq) {
            nota.pendiente = true;
            nota.sincronizado = false;
        }
        actualizarEstadoNotaSync('error', 'Error al guardar · se reintentará', notaDOM);
    });
}

function flushNotaPendiente(notaNum, notaDOM = obtenerNotaDOM()) {
    if (!notaTimeouts[notaNum]) return;
    const nota = notaEstado.notas[notaNum];
    enviarNotaAFirebase(notaNum, notaDOM, nota?.pendingRef || userDocRef, nota?.pendingUid || currentUser?.uid);
}

function flushTodasLasNotasPendientes(notaDOM = obtenerNotaDOM()) {
    Object.keys(notaTimeouts).forEach(num => flushNotaPendiente(Number(num), notaDOM));
}

function cancelarGuardadosNotasPendientes() {
    Object.values(notaTimeouts).forEach(timer => clearTimeout(timer));
    notaTimeouts = {};
    notaMapaFirebaseVisto = false;
    for (let i = 1; i <= 5; i++) {
        const nota = notaEstado.notas[i];
        nota.pendiente = false;
        nota.sincronizado = true;
        nota.pendingUid = null;
        nota.pendingRef = null;
        nota.writeSeq++;
    }
}

function aplicarTextoRemotoEnTextarea(nuevoTexto, notaDOM = obtenerNotaDOM()) {
    const textarea = notaDOM.textarea;
    if (!textarea || textarea.value === nuevoTexto) return;

    const anterior = textarea.value;
    const start = textarea.selectionStart ?? anterior.length;
    const end = textarea.selectionEnd ?? start;

    let prefijo = 0;
    const maxPrefijo = Math.min(anterior.length, nuevoTexto.length);
    while (prefijo < maxPrefijo && anterior[prefijo] === nuevoTexto[prefijo]) prefijo++;

    let sufijo = 0;
    while (
        sufijo < anterior.length - prefijo &&
        sufijo < nuevoTexto.length - prefijo &&
        anterior[anterior.length - 1 - sufijo] === nuevoTexto[nuevoTexto.length - 1 - sufijo]
    ) sufijo++;

    const removidos = anterior.length - prefijo - sufijo;
    const agregados = nuevoTexto.length - prefijo - sufijo;
    const delta = agregados - removidos;
    textarea.value = nuevoTexto;

    const ajustar = (pos) => pos <= prefijo ? pos : Math.max(prefijo, Math.min(nuevoTexto.length, pos + delta));
    try { textarea.setSelectionRange(ajustar(start), ajustar(end)); } catch (_) {}

    textarea.classList.remove('nota-remota-pulse');
    void textarea.offsetWidth;
    textarea.classList.add('nota-remota-pulse');
    actualizarContadorCaracteres(nuevoTexto, notaDOM);
}

function cargarNota(notaNum, notaDOM = obtenerNotaDOM()) {
    if (!notaDOM?.previews) notaDOM = obtenerNotaDOM();
    const texto = notaEstado.notas[notaNum]?.contenido || '';
    if (notaDOM.textarea) notaDOM.textarea.value = texto;
    if (notaDOM.currentLabel) notaDOM.currentLabel.textContent = `Nota ${notaNum}`;
    if (notaDOM.textarea) notaDOM.textarea.placeholder = `Escribe en Nota ${notaNum}…`;
    actualizarContadorCaracteres(texto, notaDOM);
    actualizarTodosLosPreviews(notaDOM);
}

function actualizarContadorCaracteres(texto, notaDOM = obtenerNotaDOM()) {
    if (!notaDOM.charCount) return;
    const caracteres = texto.length;
    const palabras = texto.trim() ? texto.trim().split(/\s+/).length : 0;
    notaDOM.charCount.textContent = `${caracteres} ${caracteres === 1 ? 'carácter' : 'caracteres'} · ${palabras} ${palabras === 1 ? 'palabra' : 'palabras'}`;
}

function actualizarPreviewNota(notaNum, texto, notaDOM = obtenerNotaDOM(), remoto = false) {
    if (!notaDOM?.previews) notaDOM = obtenerNotaDOM();
    const preview = [...notaDOM.previews].find(el => Number(el.dataset.notaPreview) === notaNum);
    if (!preview) return;
    const limpio = texto.replace(/\s+/g, ' ').trim();
    preview.textContent = limpio || 'Vacía';
    preview.title = limpio || 'Sin contenido';
    const btn = preview.closest('.nota-btn-numero');
    btn?.classList.toggle('tiene-contenido', Boolean(limpio));
    if (remoto && btn) {
        btn.classList.remove('nota-remota');
        void btn.offsetWidth;
        btn.classList.add('nota-remota');
        setTimeout(() => btn.classList.remove('nota-remota'), 900);
    }
}

function actualizarTodosLosPreviews(notaDOM = obtenerNotaDOM()) {
    if (!notaDOM?.previews) notaDOM = obtenerNotaDOM();
    for (let i = 1; i <= 5; i++) actualizarPreviewNota(i, notaEstado.notas[i]?.contenido || '', notaDOM);
}

function actualizarEstadoNotaSync(tipo, texto, notaDOM = obtenerNotaDOM()) {
    if (!notaDOM.syncIcon || !notaDOM.syncText) return;
    notaDOM.syncIcon.className = `nota-sync-icon ${tipo}`;
    notaDOM.syncText.textContent = texto;
    notaDOM.cloudStatus?.setAttribute('data-state', tipo);
    if (notaDOM.editorHint) {
        const hints = {
            sincronizado: 'Cambios reflejados en todos tus dispositivos',
            remoto: 'Firebase recibió un cambio de otro dispositivo',
            guardando: 'Se guardará tras 5 segundos sin escribir',
            sincronizando: 'Estableciendo canal en tiempo real',
            offline: 'Firestore conservará la escritura hasta recuperar Internet',
            error: 'La copia local se mantiene protegida',
            local: 'Inicia sesión para activar sincronización entre dispositivos'
        };
        notaDOM.editorHint.textContent = hints[tipo] || 'Sincronización bidireccional en tiempo real';
    }
}

function programarEstadoSincronizado(notaDOM = obtenerNotaDOM()) {
    if (notaSyncResetTimer) clearTimeout(notaSyncResetTimer);
    notaSyncResetTimer = setTimeout(() => {
        if (navigator.onLine && estado.isAuthenticated) actualizarEstadoNotaSync('sincronizado', 'Sincronizado en la nube', notaDOM);
    }, 1600);
}

function marcarUltimaSincronizacion(notaDOM = obtenerNotaDOM()) {
    if (!notaDOM.lastSync) return;
    notaDOM.lastSync.textContent = 'Actualizado ahora';
}

function esDispositivoTactilParaNotas() {
    return window.matchMedia?.('(hover: none) and (pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

function abrirModalNota(notaDOM = obtenerNotaDOM()) {
    if (!notaDOM.modal) return;
    notaDOM.modal.style.display = 'flex';
    notaDOM.modal.classList.remove('nota-modal-cerrando');
    void notaDOM.modal.offsetWidth;
    notaDOM.modal.classList.add('nota-modal-abierto');
    document.body.style.overflow = 'hidden';
    actualizarTodosLosPreviews(notaDOM);

    // En móvil/táctil nunca abrimos el teclado al mostrar el modal. El usuario
    // decide cuándo escribir tocando explícitamente el textarea.
    if (esDispositivoTactilParaNotas()) {
        notaDOM.textarea?.blur();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        return;
    }
    setTimeout(() => notaDOM.textarea?.focus({ preventScroll: true }), 180);
}

function cerrarModalNota(notaDOM = obtenerNotaDOM()) {
    if (!notaDOM.modal) return;
    flushTodasLasNotasPendientes(notaDOM);
    notaDOM.modal.classList.remove('nota-modal-abierto');
    notaDOM.modal.classList.add('nota-modal-cerrando');
    setTimeout(() => {
        notaDOM.modal.classList.remove('nota-modal-cerrando');
        notaDOM.modal.style.display = 'none';
        document.body.style.overflow = '';
    }, 220);
}

async function copiarNota(notaDOM = obtenerNotaDOM()) {
    const texto = notaDOM.textarea?.value || '';
    if (!texto.trim()) return;
    try {
        await navigator.clipboard.writeText(texto);
        const span = notaDOM.copiarBtn?.querySelector('span');
        if (span) {
            const anterior = span.textContent;
            span.textContent = 'Copiado';
            notaDOM.copiarBtn.classList.add('copiado');
            setTimeout(() => {
                span.textContent = anterior;
                notaDOM.copiarBtn?.classList.remove('copiado');
            }, 1000);
        }
    } catch (err) {
        console.error('Error al copiar:', err);
    }
}

function cambiarNota(notaNum, notaDOM = obtenerNotaDOM()) {
    if (!notaEstado.notas[notaNum] || notaNum === notaEstado.notaActual) return;
    flushNotaPendiente(notaEstado.notaActual, notaDOM);
    notaEstado.notaActual = notaNum;

    notaDOM.notaBtns.forEach(btn => {
        const activo = Number(btn.dataset.nota) === notaNum;
        btn.classList.toggle('activo', activo);
        btn.setAttribute('aria-selected', activo ? 'true' : 'false');
    });

    cargarNota(notaNum, notaDOM);
    // Cambiar de Nota 1–5 desde un teléfono no debe invocar el teclado. Sólo
    // un toque directo dentro del área de escritura debe enfocarla.
    if (!esDispositivoTactilParaNotas()) notaDOM.textarea?.focus({ preventScroll: true });
}

function habilitarEdicion(habilitar) {
    if (DOM.btnAgregar) {
        DOM.btnAgregar.style.display = habilitar ? 'flex' : 'none';
    }

    if (DOM.btnPersonalizar) {
        DOM.btnPersonalizar.style.display = habilitar ? 'flex' : 'none';
    }

    const btnAgregarCategoria = document.getElementById('btn-agregar-categoria');
    if (btnAgregarCategoria) {
        btnAgregarCategoria.style.display = habilitar ? 'inline-flex' : 'none';
    }

    estado.isAuthenticated = habilitar;
    
    // Reinicializar drag & drop de categorías cuando cambia el estado de autenticación
    if (habilitar) {
        setTimeout(() => inicializarDragAndDropCategorias(), 100);
    }
}

// ===== INDICADOR DE CONEXIÓN EN TIEMPO REAL =====
function actualizarIndicadorConexion(online) {
    const indicator = document.getElementById('conexion-indicator');
    const dot       = document.getElementById('conexion-dot');
    const text      = document.getElementById('conexion-text');
    if (!indicator || !dot || !text) return;

    if (online) {
        indicator.classList.remove('offline', 'checking');
        text.textContent = 'En línea';
    } else {
        indicator.classList.remove('checking');
        indicator.classList.add('offline');
        text.textContent = 'Sin conexión';
    }
}


// ===== MENÚ CONTEXTUAL DE CHROME: AÑADIR A STARTAB =====
const STARTAB_CONTEXT_PENDING_KEY = 'starTab_pendingContextAdd';
const STARTAB_CONTEXT_CATEGORIES_KEY = 'starTab_contextMenuCategories';

async function sincronizarCategoriasMenuContextual() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    try {
        const lista = (categorias || []).map(c => ({
            id: c.id,
            nombre: c.nombre || 'Sin nombre',
            orden: c.orden || 999
        }));
        await chrome.storage.local.set({ [STARTAB_CONTEXT_CATEGORIES_KEY]: lista });
    } catch (e) {
        console.warn('StarTab: no se pudieron sincronizar las categorías del menú contextual', e);
    }
}

async function procesarAccesoDesdeMenuContextual(payload) {
    if (!payload || !payload.url || !payload.categoriaId) return false;
    const categoriaExiste = categorias.some(c => c.id === payload.categoriaId);
    if (!categoriaExiste) return false;

    const icono = {
        nombre: (payload.nombre || 'Acceso directo').slice(0, 120),
        url: payload.url,
        icono: payload.icono || '',
        estilos: { ...ESTILOS_DEFAULT }
    };
    const agregado = await agregarAccesoDirectoDesdeDrop(icono, payload.categoriaId);
    if (agregado) {
        // Si fue agregado a otra categoría, no cambiamos la categoría visible.
        return true;
    }
    return false;
}

function inicializarMenuContextualStarTab() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;

    // Si el menú contextual tuvo que dejar el acceso en cola mientras
    // Firebase/auth terminaba de inicializarse, procesarlo automáticamente
    // cuando la cola cambie evita que el usuario tenga que recargar StarTab.
    if (chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes[STARTAB_CONTEXT_PENDING_KEY]) return;
            if (_startabCategoriasListas && currentUser && db) {
                revisarAccesoPendienteDelMenuContextual();
            }
        });
    }
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type !== 'STARTAB_ADD_CONTEXT_TAB') return;
        procesarAccesoDesdeMenuContextual(message.payload)
            .then(ok => sendResponse({ ok }))
            .catch(error => {
                console.error('StarTab: error añadiendo desde menú contextual', error);
                sendResponse({ ok: false });
            });
        return true;
    });
}

async function revisarAccesoPendienteDelMenuContextual() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    if (_procesandoContextPending) return;

    // MUY IMPORTANTE: no consumimos la cola mientras Firebase todavía está
    // cargando. Antes se borraba la cola y el snapshot posterior restauraba
    // el estado antiguo, haciendo parecer que el acceso se había eliminado.
    if (!currentUser || !db || !_startabCategoriasListas) {
        return;
    }

    _procesandoContextPending = true;
    try {
        const data = await chrome.storage.local.get(STARTAB_CONTEXT_PENDING_KEY);
        const pendiente = data[STARTAB_CONTEXT_PENDING_KEY];
        if (!pendiente) return;

        // El fondo guarda una COLA (array) para no perder accesos si se agregan
        // varios seguidos. Se admite también el formato antiguo (un objeto).
        const cola = Array.isArray(pendiente) ? pendiente : [pendiente];
        const restantes = [];

        for (const item of cola) {
            const ok = await procesarAccesoDesdeMenuContextual(item);
            if (ok) {
                console.log('StarTab: pestaña añadida desde el menú contextual.');
            } else {
                // Si por cualquier motivo todavía no puede procesarse, NO se
                // pierde: permanece en la cola para el siguiente intento.
                restantes.push(item);
            }
        }

        if (restantes.length) {
            await chrome.storage.local.set({ [STARTAB_CONTEXT_PENDING_KEY]: restantes });
        } else {
            await chrome.storage.local.remove(STARTAB_CONTEXT_PENDING_KEY);
        }
    } catch (e) {
        console.error('StarTab: error procesando acceso contextual pendiente', e);
    } finally {
        _procesandoContextPending = false;
    }
}


/* ================================================================
   INFORMACIÓN EN VIVO · USD/DOP + CLIMA ACTUAL EN SANTO DOMINGO
   - Muestra caché de inmediato para que la nueva pestaña no "parpadee".
   - Clima: refresco cada 10 min (Open-Meteo).
   - USD/DOP: consulta la tasa oficial del Banco Central cada hora; usa una
     fuente de respaldo si la página oficial no responde.
   ================================================================ */
const STARTAB_LIVE_INFO_CACHE_KEY = 'startab_live_info_v1';
const STARTAB_LIVE_INFO = {
    weatherRefreshMs: 10 * 60 * 1000,
    currencyRefreshMs: 60 * 60 * 1000,
    requestTimeoutMs: 8500,
    weatherUrl: 'https://api.open-meteo.com/v1/forecast?latitude=18.4861&longitude=-69.9312&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day&temperature_unit=celsius&timezone=America%2FSanto_Domingo',
    currencyOfficialUrl: 'https://www.bancentral.gov.do/',
    currencyFallbackUrl: 'https://open.er-api.com/v6/latest/USD'
};

let startabLiveInfoTimers = { weather: 0, currency: 0 };
let startabLiveInfoRunning = { weather: false, currency: false };

function leerCacheInformacionEnVivo() {
    try {
        const raw = localStorage.getItem(STARTAB_LIVE_INFO_CACHE_KEY);
        if (!raw) return {};
        const data = JSON.parse(raw);
        return data && typeof data === 'object' ? data : {};
    } catch (_) {
        return {};
    }
}

function guardarCacheInformacionEnVivo(parcial) {
    try {
        const actual = leerCacheInformacionEnVivo();
        localStorage.setItem(STARTAB_LIVE_INFO_CACHE_KEY, JSON.stringify({ ...actual, ...parcial }));
    } catch (_) { /* La información en vivo nunca debe romper StarTab. */ }
}

function fechaCortaInformacionEnVivo(timestamp) {
    if (!Number.isFinite(timestamp)) return '';
    try {
        return new Intl.DateTimeFormat('es-DO', {
            hour: 'numeric', minute: '2-digit', hour12: true
        }).format(new Date(timestamp));
    } catch (_) {
        return new Date(timestamp).toLocaleTimeString();
    }
}

function iconoClimaWMO(codigo, esDia = true) {
    const c = Number(codigo);
    if (c === 0) return esDia ? '☀️' : '🌙';
    if (c === 1) return esDia ? '🌤️' : '🌙';
    if (c === 2) return '⛅';
    if (c === 3) return '☁️';
    if (c === 45 || c === 48) return '🌫️';
    if ([51, 53, 55, 56, 57].includes(c)) return '🌦️';
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(c)) return '🌧️';
    if ([71, 73, 75, 77, 85, 86].includes(c)) return '❄️';
    if ([95, 96, 99].includes(c)) return '⛈️';
    return '🌤️';
}

function descripcionClimaWMO(codigo) {
    const c = Number(codigo);
    if (c === 0) return 'Despejado';
    if (c === 1) return 'Mayormente despejado';
    if (c === 2) return 'Parcialmente nublado';
    if (c === 3) return 'Nublado';
    if (c === 45 || c === 48) return 'Neblina';
    if ([51, 53, 55, 56, 57].includes(c)) return 'Llovizna';
    if ([61, 63, 65, 66, 67].includes(c)) return 'Lluvia';
    if ([71, 73, 75, 77].includes(c)) return 'Nieve';
    if ([80, 81, 82].includes(c)) return 'Chubascos';
    if ([85, 86].includes(c)) return 'Nieve con chubascos';
    if ([95, 96, 99].includes(c)) return 'Tormentas';
    return 'Clima actual';
}

function marcarEstadoLiveInfo(card, estado) {
    if (!card) return;
    card.classList.remove('is-loading', 'is-fresh', 'is-stale');
    if (estado) card.classList.add(`is-${estado}`);
}

function pintarDolarEnVivo(data, estado = 'fresh') {
    if (!data || !Number.isFinite(Number(data.rate))) return;
    const value = document.getElementById('live-usd-value');
    const label = document.getElementById('live-usd-label');
    const source = document.getElementById('live-usd-source');
    const card = document.getElementById('live-info-usd');
    if (!value || !card) return;

    const rate = Number(data.rate);
    value.textContent = `RD$ ${rate.toFixed(2)}`;
    const hora = fechaCortaInformacionEnVivo(Number(data.fetchedAt));

    if (data.source === 'bcrd') {
        if (label) label.textContent = 'USD · Venta BC';
        if (source) {
            source.href = 'https://www.bancentral.gov.do/';
            source.title = 'Fuente: Banco Central de la República Dominicana';
            source.setAttribute('aria-label', 'Fuente del tipo de cambio: Banco Central de la República Dominicana');
        }
        const compra = Number(data.buyRate);
        const compraText = Number.isFinite(compra) ? ` · Compra RD$ ${compra.toFixed(2)}` : '';
        const fechaText = data.rateDate ? ` · ${data.rateDate}` : '';
        card.title = `Banco Central RD · Venta RD$ ${rate.toFixed(2)}${compraText}${fechaText}${hora ? ` · Consultado ${hora}` : ''}`;
    } else {
        if (label) label.textContent = 'USD → DOP';
        if (source) {
            source.href = 'https://www.exchangerate-api.com';
            source.title = 'Fuente de respaldo: ExchangeRate-API';
            source.setAttribute('aria-label', 'Fuente de respaldo del tipo de cambio: ExchangeRate-API');
        }
        card.title = `1 USD = RD$ ${rate.toFixed(2)} · Tasa referencial de respaldo${hora ? ` · Consultado ${hora}` : ''}`;
    }
}

function pintarClimaEnVivo(data, estado = 'fresh') {
    if (!data || !Number.isFinite(Number(data.temperature))) return;
    const value = document.getElementById('live-weather-value');
    const icon = document.getElementById('live-weather-icon');
    const label = document.getElementById('live-weather-label');
    const card = document.getElementById('live-info-weather');
    if (!value || !icon || !label || !card) return;

    const temp = Math.round(Number(data.temperature));
    const feels = Number(data.apparentTemperature);
    const humidity = Number(data.humidity);
    const description = descripcionClimaWMO(data.weatherCode);
    value.textContent = `${temp}°C`;
    icon.textContent = iconoClimaWMO(data.weatherCode, Boolean(data.isDay));
    label.textContent = description;

    const extras = [];
    if (Number.isFinite(feels)) extras.push(`sensación ${Math.round(feels)}°C`);
    if (Number.isFinite(humidity)) extras.push(`humedad ${Math.round(humidity)}%`);
    const hora = fechaCortaInformacionEnVivo(Number(data.fetchedAt));
    card.title = `${description} en Santo Domingo · ${temp}°C${extras.length ? ` · ${extras.join(' · ')}` : ''}${hora ? ` · Actualizado ${hora}` : ''}`;
    marcarEstadoLiveInfo(card, estado);
}

async function fetchJsonConTimeout(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STARTAB_LIVE_INFO.requestTimeoutMs);
    try {
        const response = await fetch(url, {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

async function fetchTextConTimeout(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STARTAB_LIVE_INFO.requestTimeoutMs);
    try {
        const response = await fetch(url, {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal,
            headers: { 'Accept': 'text/html,application/xhtml+xml' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
    } finally {
        clearTimeout(timer);
    }
}

function extraerTasaBCRD(html) {
    if (typeof html !== 'string' || html.length < 100) return null;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = (doc.body?.textContent || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Limitamos el análisis al bloque que sigue a "Tipo de cambio" para no
    // confundirlo con otras cifras macroeconómicas presentes en la portada.
    const idx = text.search(/Tipo de cambio/i);
    if (idx < 0) return null;
    const bloque = text.slice(idx, idx + 650);

    const compraMatch = bloque.match(/Compra\s*(?:RD\$\s*)?([0-9]{1,3}(?:\.[0-9]{2,4})?)/i);
    const ventaMatch = bloque.match(/Venta\s*(?:RD\$\s*)?([0-9]{1,3}(?:\.[0-9]{2,4})?)/i);
    if (!compraMatch || !ventaMatch) return null;

    const buyRate = Number(compraMatch[1]);
    const sellRate = Number(ventaMatch[1]);
    if (!Number.isFinite(buyRate) || !Number.isFinite(sellRate) || buyRate <= 0 || sellRate <= 0) return null;

    // La fecha normalmente aparece pegada al título: "Tipo de cambio3 de Septiembre 2026".
    const fechaMatch = bloque.match(/Tipo de cambio\s*([^|]{0,65}?\b20\d{2})/i);
    return {
        rate: sellRate,
        buyRate,
        rateDate: fechaMatch ? fechaMatch[1].trim() : '',
        source: 'bcrd',
        fetchedAt: Date.now()
    };
}

async function consultarDolarBCRD() {
    const html = await fetchTextConTimeout(STARTAB_LIVE_INFO.currencyOfficialUrl);
    const parsed = extraerTasaBCRD(html);
    if (!parsed) throw new Error('No se encontró la tasa oficial en la portada del BCRD');
    return parsed;
}

async function consultarDolarRespaldo() {
    const data = await fetchJsonConTimeout(STARTAB_LIVE_INFO.currencyFallbackUrl);
    const rate = Number(data?.rates?.DOP);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Tasa DOP de respaldo inválida');
    return {
        rate,
        source: 'fallback',
        fetchedAt: Date.now(),
        sourceUpdatedAt: Number(data?.time_last_update_unix) * 1000 || null
    };
}

async function actualizarDolarEnVivo(forzar = false) {
    if (startabLiveInfoRunning.currency) return;
    const cache = leerCacheInformacionEnVivo().currency;
    const edad = cache?.fetchedAt ? Date.now() - Number(cache.fetchedAt) : Infinity;
    if (!forzar && cache && edad < STARTAB_LIVE_INFO.currencyRefreshMs) {
        pintarDolarEnVivo(cache, 'fresh');
        return;
    }

    const card = document.getElementById('live-info-usd');
    marcarEstadoLiveInfo(card, 'loading');
    startabLiveInfoRunning.currency = true;
    try {
        let nuevo;
        try {
            nuevo = await consultarDolarBCRD();
        } catch (officialError) {
            console.warn('StarTab: BCRD no respondió; usando tasa de respaldo', officialError);
            nuevo = await consultarDolarRespaldo();
        }
        guardarCacheInformacionEnVivo({ currency: nuevo });
        pintarDolarEnVivo(nuevo, 'fresh');
    } catch (error) {
        console.warn('StarTab: no se pudo actualizar USD/DOP', error);
        if (cache) pintarDolarEnVivo(cache, 'stale');
        else {
            const value = document.getElementById('live-usd-value');
            if (value) value.textContent = 'RD$ --.--';
            marcarEstadoLiveInfo(card, 'stale');
            if (card) card.title = 'No se pudo consultar el tipo de cambio. Se reintentará automáticamente.';
        }
    } finally {
        startabLiveInfoRunning.currency = false;
    }
}

async function actualizarClimaEnVivo(forzar = false) {
    if (startabLiveInfoRunning.weather) return;
    const cache = leerCacheInformacionEnVivo().weather;
    const edad = cache?.fetchedAt ? Date.now() - Number(cache.fetchedAt) : Infinity;
    if (!forzar && cache && edad < STARTAB_LIVE_INFO.weatherRefreshMs) {
        pintarClimaEnVivo(cache, 'fresh');
        return;
    }

    const card = document.getElementById('live-info-weather');
    marcarEstadoLiveInfo(card, 'loading');
    startabLiveInfoRunning.weather = true;
    try {
        const data = await fetchJsonConTimeout(STARTAB_LIVE_INFO.weatherUrl);
        const current = data?.current;
        const temperature = Number(current?.temperature_2m);
        if (!Number.isFinite(temperature)) throw new Error('Temperatura inválida');
        const nuevo = {
            temperature,
            apparentTemperature: Number(current?.apparent_temperature),
            humidity: Number(current?.relative_humidity_2m),
            weatherCode: Number(current?.weather_code),
            isDay: Number(current?.is_day) === 1,
            fetchedAt: Date.now()
        };
        guardarCacheInformacionEnVivo({ weather: nuevo });
        pintarClimaEnVivo(nuevo, 'fresh');
    } catch (error) {
        console.warn('StarTab: no se pudo actualizar el clima de Santo Domingo', error);
        if (cache) pintarClimaEnVivo(cache, 'stale');
        else {
            const value = document.getElementById('live-weather-value');
            if (value) value.textContent = '--°C';
            marcarEstadoLiveInfo(card, 'stale');
            if (card) card.title = 'No se pudo consultar el clima. Se reintentará automáticamente.';
        }
    } finally {
        startabLiveInfoRunning.weather = false;
    }
}

function inicializarInformacionEnVivo() {
    const strip = document.getElementById('live-info-strip');
    if (!strip || strip.dataset.ready === '1') return;
    strip.dataset.ready = '1';

    // Pintar primero el último dato conocido para una apertura instantánea.
    const cache = leerCacheInformacionEnVivo();
    if (cache.currency) pintarDolarEnVivo(cache.currency, 'stale');
    if (cache.weather) pintarClimaEnVivo(cache.weather, 'stale');

    void actualizarDolarEnVivo(false);
    void actualizarClimaEnVivo(false);

    startabLiveInfoTimers.weather = window.setInterval(() => {
        if (!document.hidden && navigator.onLine) void actualizarClimaEnVivo(true);
    }, STARTAB_LIVE_INFO.weatherRefreshMs);

    startabLiveInfoTimers.currency = window.setInterval(() => {
        if (!document.hidden && navigator.onLine) void actualizarDolarEnVivo(true);
    }, STARTAB_LIVE_INFO.currencyRefreshMs);

    window.addEventListener('online', () => {
        void actualizarClimaEnVivo(true);
        void actualizarDolarEnVivo(true);
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden || !navigator.onLine) return;
        void actualizarClimaEnVivo(false);
        void actualizarDolarEnVivo(false);
    });
}

// ===== INICIALIZACIÓN PRINCIPAL =====
document.addEventListener('DOMContentLoaded', () => {
    inicializarNavegacionScrollCategorias();
    document.body.classList.add('no-animation');
    
    cachearElementos();
    inicializarMenuContextualStarTab();
    revisarAccesoPendienteDelMenuContextual();
    
    inicializarBarraBusqueda();
    inicializarDobleClickBuscadores();
    inicializarAutenticacion();
    inicializarNota();
    inicializarInformacionEnVivo();
    
    cargarIconosRapidos(true);
    cargarCategoriasLocales();
    
    setTimeout(() => {
        document.body.classList.remove('no-animation');
    }, 100);
    
    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
            initFirebase();
            inicializarModalIconos();
            inicializarModalPersonalizar();
            
            if (currentUser && currentUser.uid && estado.firebaseInicializado) {
                cargarCategoriasUsuario(currentUser.uid);
            }
        }, { timeout: 2000 });
    } else {
        setTimeout(() => {
            initFirebase();
            inicializarModalIconos();
            inicializarModalPersonalizar();
            
            if (currentUser && currentUser.uid && estado.firebaseInicializado) {
                cargarCategoriasUsuario(currentUser.uid);
            }
        }, 1000);
    }

    window.addEventListener('online', () => {
        console.log('Conexión restaurada, sincronizando...');
        actualizarIndicadorConexion(true);
        if (estado.isAuthenticated) actualizarEstadoNotaSync('sincronizando', 'Reconectando con Firebase…');
        if (currentUser && currentUser.uid && estado.firebaseInicializado) {
            cargarCategoriasUsuario(currentUser.uid);
        }
    });

    window.addEventListener('offline', () => {
        console.log('Sin conexión');
        actualizarIndicadorConexion(false);
        if (estado.isAuthenticated) actualizarEstadoNotaSync('offline', 'Sin conexión · cambios protegidos localmente');
    });

    // Estado inicial
    actualizarIndicadorConexion(navigator.onLine);

    // Manejador de clics para el botón de incógnito
    document.getElementById('contenedor-iconos')?.addEventListener('click', (e) => {
        const btnIncognito = e.target.closest('.btn-incognito-small');
        
        if (btnIncognito) {
            e.preventDefault();
            e.stopPropagation();
            
            const url = btnIncognito.dataset.url;
            
            if (typeof chrome !== 'undefined' && chrome.windows) {
                chrome.windows.create({
                    url: url,
                    incognito: true,
                    type: 'normal'
                });
            } else {
                window.open(url, '_blank', 'noopener,noreferrer');
                console.warn("El modo incógnito real solo funciona si esto corre como Extensión de Chrome.");
            }
        }
    });
});

// Precargar imágenes de iconos comunes
window.addEventListener('load', () => {
    const imagenesPrecarga = [
        './img/icons/google_1.png',
        './img/icons/youtube_1.png',
        './img/icons/facebook_1.png'
    ];
    
    imagenesPrecarga.forEach(src => {
        const img = new Image();
        img.src = src;
    });
});

// Listener para el evento online (fondo pendiente)
window.addEventListener('online', function() {
    console.log('Conexión restaurada - verificando fondos pendientes');
    // No hacer nada automático, solo verificar si hay fondos pendientes
    if (window._fondoPendienteSincronizar) {
        console.log('Hay fondos pendientes de sincronizar');
    }
});

// ================================================================
// PANEL DE REDIMENSIONAMIENTO — PERFIL FIREBASE + OFFLINE
// ================================================================
(function inicializarPanelRedimensionar() {
    const $ = id => document.getElementById(id);
    const root = document.documentElement;
    const panel = $('panel-redimensionar');
    const backdrop = $('panel-redimensionar-backdrop');
    const abrir = $('btn-redimensionar');
    const cerrar = $('cerrar-panel-redimensionar');
    if (!panel || !backdrop || !abrir) return;

    const defaults = {
        searchY: 0, searchSize: 100,
        iconsY: 0, iconsSize: 100, iconSize: 100,
        iconBg: true, iconRadius: 12,
        iconAlign: 'left', iconRows: 2, iconColumns: 8
    };
    let config = { ...defaults };
    let settingsRef = null;
    let unsubscribeSettings = null;
    let firebaseReady = false;
    let applyingRemote = false;
    let firebaseSaveInProgress = false;
    let firebaseSavePending = false;
    let renderRedimTimer = null;

    const controles = {
        searchY: $('redim-busqueda-y'), searchSize: $('redim-busqueda-size'),
        iconsY: $('redim-iconos-y'), iconsSize: $('redim-iconos-size'),
        iconSize: $('redim-icono-size'), iconBg: $('redim-icono-bg'), iconRadius: $('redim-icono-radius'),
        iconAlign: $('redim-icono-align'), iconRows: $('redim-icono-rows'), iconColumns: $('redim-icono-columns')
    };

    function normalizar(c) {
        return {
            searchY: Math.max(-180, Math.min(180, Number(c.searchY) || 0)),
            searchSize: Math.max(70, Math.min(130, Number(c.searchSize) || 100)),
            iconsY: Math.max(-180, Math.min(180, Number(c.iconsY) || 0)),
            iconsSize: Math.max(70, Math.min(130, Number(c.iconsSize) || 100)),
            iconSize: Math.max(25, Math.min(100, Number(c.iconSize) || 100)),
            iconBg: c.iconBg !== false,
            iconRadius: Math.max(0, Math.min(40, Number(c.iconRadius) || 0)),
            iconAlign: ['left','center','right'].includes(c.iconAlign) ? c.iconAlign : 'left',
            iconRows: Math.max(1, Math.min(4, Number(c.iconRows) || 2)),
            iconColumns: Math.max(5, Math.min(14, Number(c.iconColumns) || 8))
        };
    }

    function guardarLocal() {
        try { localStorage.setItem('startab_redimensionamiento', JSON.stringify(config)); } catch (_) {}
    }

    // Firebase se escribe SOLO al cerrar el panel. Mientras se edita, la UI y
    // el respaldo local cambian inmediatamente, pero no se generan escrituras.
    async function guardarFirebaseAlCerrar() {
        guardarLocal();
        if (!settingsRef || applyingRemote || firebaseSaveInProgress) return;
        firebaseSaveInProgress = true;
        try {
            await settingsRef.set({
                redimensionamiento: {
                    ...config,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }
            }, { merge: true });
            firebaseSavePending = false;
        } catch (e) {
            // Con persistencia offline, Firestore conserva la escritura local y
            // la sincroniza automáticamente al recuperar conexión.
            firebaseSavePending = true;
            console.warn('StarTab: configuración guardada localmente; Firebase sincronizará cuando haya conexión:', e);
        } finally {
            firebaseSaveInProgress = false;
        }
    }

    function aplicar() {
        config = normalizar(config);
        root.style.setProperty('--redim-search-y', `${config.searchY}px`);
        root.style.setProperty('--redim-search-size', `${config.searchSize / 100}`);
        root.style.setProperty('--redim-icons-y', `${config.iconsY}px`);
        root.style.setProperty('--redim-icons-size', `${config.iconsSize / 100}`);
        root.style.setProperty('--redim-icon-size', `${config.iconSize}%`);
        root.style.setProperty('--redim-shortcut-bg', config.iconBg ? 'rgba(255,255,255,.06)' : 'transparent');
        root.style.setProperty('--redim-shortcut-border', config.iconBg ? 'rgba(255,255,255,.10)' : 'transparent');
        root.style.setProperty('--redim-shortcut-radius', `${config.iconRadius}px`);
        root.style.setProperty('--redim-icon-align', config.iconAlign);
        root.style.setProperty('--redim-icon-rows', String(config.iconRows));
        root.style.setProperty('--redim-icon-columns', String(config.iconColumns));

        Object.entries(controles).forEach(([key, el]) => {
            if (!el) return;
            if (el.type === 'checkbox') el.checked = config[key];
            else el.value = config[key];
        });
        $('valor-busqueda-y').textContent = `${config.searchY}px`;
        $('valor-busqueda-size').textContent = `${config.searchSize}%`;
        $('valor-iconos-y').textContent = `${config.iconsY}px`;
        $('valor-iconos-size').textContent = `${config.iconsSize}%`;
        $('valor-icono-size').textContent = `${config.iconSize}%`;
        $('valor-icono-radius').textContent = `${config.iconRadius}px`;
        $('valor-icono-align').textContent = ({left:'Izquierda',center:'Centro',right:'Derecha'})[config.iconAlign];
        $('valor-icono-rows').textContent = `${config.iconRows}`;
        $('valor-icono-columns').textContent = `${config.iconColumns}`;
        guardarLocal();

        // Filas, columnas y alineación cambian la posición física de cada
        // acceso. Hay que reconstruir sus coordenadas inmediatamente; antes
        // solo se actualizaban las variables CSS y la cuadrícula quedaba con
        // las posiciones del render anterior.
        clearTimeout(renderRedimTimer);
        renderRedimTimer = setTimeout(() => {
            actualizarLayoutIconos();
        }, 0);
    }

    function cargarLocal() {
        try {
            const guardado = JSON.parse(localStorage.getItem('startab_redimensionamiento') || 'null');
            if (guardado && typeof guardado === 'object') config = normalizar({ ...defaults, ...guardado });
        } catch (_) {}
        aplicar();
    }

    function conectarFirebase(ref) {
        if (!ref || settingsRef === ref) return;
        if (unsubscribeSettings) unsubscribeSettings();
        settingsRef = ref;
        firebaseReady = true;
        unsubscribeSettings = settingsRef.onSnapshot(snapshot => {
            const remote = snapshot.exists ? snapshot.data()?.redimensionamiento : null;
            if (remote && typeof remote === 'object') {
                applyingRemote = true;
                config = normalizar({ ...defaults, ...remote });
                aplicar();
                applyingRemote = false;
            }
        }, error => console.warn('StarTab: no se pudo escuchar configuración:', error));
    }

    window.StarTabRedimensionamiento = { conectarFirebase, aplicar, getConfig: () => ({ ...config }) };

    function abrirPanel() {
        panel.classList.add('abierto'); backdrop.classList.add('abierto');
        panel.setAttribute('aria-hidden', 'false'); backdrop.setAttribute('aria-hidden', 'false');
        document.body.classList.add('redimensionar-panel-abierto');
    }
    function cerrarPanel() {
        // Cierre visual inmediato: nunca bloqueamos la interfaz esperando a Firebase.
        panel.classList.remove('abierto'); backdrop.classList.remove('abierto');
        panel.setAttribute('aria-hidden', 'true'); backdrop.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('redimensionar-panel-abierto');

        // La persistencia continúa después del cierre sin retrasar la interacción.
        void guardarFirebaseAlCerrar();
    }

    const rangeMap = [
        ['searchY', 'valor-busqueda-y', v => `${v}px`], ['searchSize', 'valor-busqueda-size', v => `${v}%`],
        ['iconsY', 'valor-iconos-y', v => `${v}px`], ['iconsSize', 'valor-iconos-size', v => `${v}%`],
        ['iconSize', 'valor-icono-size', v => `${v}%`], ['iconRadius', 'valor-icono-radius', v => `${v}px`],
        ['iconRows', 'valor-icono-rows', v => `${v}`], ['iconColumns', 'valor-icono-columns', v => `${v}`]
    ];
    rangeMap.forEach(([key, outputId, format]) => controles[key]?.addEventListener('input', e => {
        config[key] = Number(e.target.value);
        const out = $(outputId); if (out) out.textContent = format(config[key]);
        aplicar();
    }));
    controles.iconBg?.addEventListener('change', e => { config.iconBg = e.target.checked; aplicar(); });
    controles.iconAlign?.addEventListener('change', e => { config.iconAlign = e.target.value; aplicar(); });

    const tabs = [['redim-tab-iconos','redim-panel-iconos'], ['redim-tab-busqueda','redim-panel-busqueda']];
    tabs.forEach(([tabId, panelId]) => $(tabId)?.addEventListener('click', () => {
        tabs.forEach(([t,p]) => {
            const active = t === tabId;
            $(t)?.classList.toggle('activo', active);
            $(t)?.setAttribute('aria-selected', active ? 'true' : 'false');
            const sec = $(p); if (sec) { sec.classList.toggle('activo', active); sec.hidden = !active; }
        });
    }));

    abrir.addEventListener('click', () => panel.classList.contains('abierto') ? cerrarPanel() : abrirPanel());
    cerrar?.addEventListener('click', cerrarPanel);
    backdrop.addEventListener('click', cerrarPanel);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('abierto')) cerrarPanel(); });
    $('restablecer-redimensionar')?.addEventListener('click', () => {
        config = { ...defaults };
        aplicar();
        // No se escribe en Firebase aquí; se guardará cuando el panel se cierre.
    });

    cargarLocal();

})();
/* ================================================================
   REVELADO PROGRESIVO DEL BOTÓN REDIMENSIONAR
   Se activa únicamente al entrar por Personalizar. La clase mantiene
   una zona-puente real durante el recorrido de 1rem para que el cursor
   pueda llegar al botón secundario sin que éste desaparezca.
   ================================================================ */
(function inicializarAccionRedimensionarDesdePersonalizar() {
    const grupo = document.getElementById('acciones-personalizacion-flotantes');
    const personalizar = document.getElementById('btn-personalizar');
    const redimensionar = document.getElementById('btn-redimensionar');
    if (!grupo || !personalizar || !redimensionar) return;
    if (grupo.dataset.resizeRevealReady === '1') return;
    grupo.dataset.resizeRevealReady = '1';

    let temporizadorCierre = 0;

    const cancelarCierre = () => {
        if (temporizadorCierre) {
            clearTimeout(temporizadorCierre);
            temporizadorCierre = 0;
        }
    };

    const mostrar = () => {
        cancelarCierre();
        // Permitir un nuevo despliegue únicamente cuando el usuario vuelva
        // a entrar por Personalizar después de haber pulsado Redimensionar.
        grupo.classList.remove('is-resize-force-hidden');
        // requestAnimationFrame separa el evento de entrada del cambio visual
        // y garantiza que Chromium componga correctamente el primer frame.
        requestAnimationFrame(() => {
            grupo.classList.add('is-resize-revealed');
            redimensionar.setAttribute('aria-hidden', 'false');
        });
    };

    const ocultar = () => {
        cancelarCierre();
        // Una tolerancia mínima evita cierres al cruzar físicamente el gap de 1rem.
        temporizadorCierre = window.setTimeout(() => {
            const focoDentro = grupo.contains(document.activeElement);
            const punteroDentro = grupo.matches(':hover');
            const panelAbierto = document.getElementById('panel-redimensionar')?.classList.contains('abierto');
            if (focoDentro || punteroDentro || panelAbierto) return;

            grupo.classList.remove('is-resize-revealed');
            redimensionar.setAttribute('aria-hidden', 'true');
            temporizadorCierre = 0;
        }, 110);
    };

    redimensionar.setAttribute('aria-hidden', 'true');

    // Sólo Personalizar puede iniciar el despliegue con puntero.
    personalizar.addEventListener('pointerenter', mostrar, { passive: true });
    personalizar.addEventListener('focus', mostrar);

    // Una vez abierto, toda la caja ampliada sirve de puente interactivo.
    grupo.addEventListener('pointerenter', cancelarCierre, { passive: true });
    grupo.addEventListener('pointerleave', ocultar, { passive: true });
    grupo.addEventListener('focusout', (event) => {
        if (!grupo.contains(event.relatedTarget)) ocultar();
    });

    redimensionar.addEventListener('pointerenter', cancelarCierre, { passive: true });

    // Al pulsarlo, el botón secundario se repliega inmediatamente. El estado
    // forzado evita que :focus-within lo vuelva a mostrar por el foco del click.
    redimensionar.addEventListener('click', () => {
        cancelarCierre();
        grupo.classList.remove('is-resize-revealed');
        grupo.classList.add('is-resize-force-hidden');
        redimensionar.setAttribute('aria-hidden', 'true');
        redimensionar.blur();
        if (document.activeElement === personalizar) personalizar.blur();
    });
})();
