// script.js - VERSIÓN COMPLETA OPTIMIZADA PARA EXTENSIÓN SIN PARPADEOS
// ===== CONFIGURACIÓN DE FIREBASE (diferida) =====
const firebaseConfig = {
    apiKey: "AIzaSyBU8DyN2kRcDq0fxB20qRUXWBHV0E-0d6A",
    authDomain: "startab-44e48.firebaseapp.com",
    projectId: "startab-44e48",
    storageBucket: "startab-44e48.firebasestorage.app",
    messagingSenderId: "874084877753",
    appId: "1:874084877753:web:cf9cbe9a344356dc9be268"
};

// Variables de Firebase (inicialización diferida)
let db = null;
let auth = null;

// ===== VARIABLES DE AUTENTICACIÓN =====
let currentUser = null;
let userConfigRef = null;
let unsubscribeUserConfig = null;

// URL de autenticación (TU GITHUB PAGES)
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

const ESTILOS_DEFAULT = { tieneFondo: false, colorFondo: '#667eea', radioBorde: 50, tamanoIcono: 74 };
const NOMBRES_BUSCADOR = { google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo' };

const FONDO_DEFAULT = {
    tipo: 'gradiente',
    url: null,
    opacidad: 0.2,
    desenfoque: 0,
    colorInicio: '#667eea',
    colorFin: '#764ba2'
};

const CATEGORIA_GENERAL = {
    id: 'general',
    nombre: 'General',
    editable: false,
    background: { ...FONDO_DEFAULT },
    accesos: []
};

// Configuración por defecto para nuevos usuarios
const CONFIG_DEFAULT = {
    categorias: [
        {
            ...CATEGORIA_GENERAL,
            accesos: obtenerIconosPorDefecto()
        }
    ],
    notas: {
        nota1: '',
        nota2: '',
        nota3: '',
        nota4: '',
        nota5: ''
    },
    settings: {},
    metadata: {
        ultimaModificacion: null,
        version: "1.0"
    }
};

// ===== NOTAS =====
let notaTimeouts = {};
let notaEstado = {
    sincronizado: true,
    notaActual: 1,
    notas: {
        1: { sincronizado: true, contenido: '' },
        2: { sincronizado: true, contenido: '' },
        3: { sincronizado: true, contenido: '' },
        4: { sincronizado: true, contenido: '' },
        5: { sincronizado: true, contenido: '' }
    }
};

// ===== ESTADO DE LA APLICACIÓN =====
let categoriasPersonalizadas = [];

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
let _ultimoRenderizado = 0;
const DEBOUNCE_TIME = 100; // ms

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

    // Elementos de autenticación
    DOM.authContainer = document.getElementById('auth-container');
    DOM.authBtn = document.getElementById('auth-btn');
    DOM.userMenu = document.getElementById('user-menu');
    DOM.userAvatar = document.getElementById('user-avatar');
    DOM.userDropdown = document.getElementById('user-dropdown');
    DOM.userName = document.getElementById('user-name');
    DOM.userEmail = document.getElementById('user-email');
    DOM.logoutBtn = document.getElementById('logout-btn');
}

// ===== INICIALIZACIÓN DE FIREBASE (DIFERIDA) =====
function initFirebase() {
    if (estado.firebaseInicializado) return true;
    
    try {
        if (typeof firebase !== 'undefined' && !db) {
            firebase.initializeApp(firebaseConfig);
            db = firebase.firestore();
            auth = firebase.auth();
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


// ===== UTILIDADES DE COMPRESIÓN DE IMÁGENES =====
// ===== UTILIDADES DE COMPRESIÓN DE IMÁGENES (MODIFICADA PARA GIFs) =====
const comprimirYRedimensionarImagen = async (file, maxHeight = 256) => {
    return new Promise((resolve, reject) => {
        // Si es GIF, NO procesar con canvas, devolver como Data URL directamente
        if (file.type === 'image/gif') {
            const reader = new FileReader();
            reader.onload = () => {
                const tamañoKB = Math.round((reader.result.length * 3/4) / 1024);
                console.log(`GIF procesado: ${tamañoKB}KB (sin compresión para mantener animación)`);
                resolve(reader.result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
            return;
        }

        // Para imágenes no-GIF, proceder con el procesamiento normal
        const url = URL.createObjectURL(file);
        const img = new Image();
        
        img.onload = () => {
            URL.revokeObjectURL(url);
            
            let width = img.width;
            let height = img.height;
            
            if (height > maxHeight) {
                const ratio = maxHeight / height;
                width = Math.round(width * ratio);
                height = maxHeight;
            }
            
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            
            let mimeType = 'image/jpeg';
            let calidad = 0.9;
            
            if (file.type === 'image/png' || file.type === 'image/webp') {
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
            
            const base64 = canvas.toDataURL(mimeType, calidad);
            const tamañoKB = Math.round((base64.length * 3/4) / 1024);
            console.log(`Imagen procesada: ${width}x${height}, ${tamañoKB}KB, formato: ${mimeType}`);
            
            resolve(base64);
        };
        
        img.onerror = (error) => {
            URL.revokeObjectURL(url);
            reject(error);
        };
        
        img.src = url;
    });
};


// ===== FUNCIONES DE AUTENTICACIÓN =====
async function iniciarSesionGoogle() {
    try {
        if (!DOM.authBtn) return;
        
        DOM.authBtn.disabled = true;
        DOM.authBtn.innerHTML = '<span class="auth-btn-text">Conectando...</span>';

        const authWindow = window.open(
            AUTH_PAGE,
            'StarTab Auth',
            'width=500,height=700,left=100,top=100,scrollbars=yes,resizable=yes'
        );

        if (!authWindow) {
            alert('Por favor, permite las ventanas emergentes para iniciar sesión');
            DOM.authBtn.disabled = false;
            DOM.authBtn.innerHTML = '<span class="auth-btn-text">Iniciar sesión</span>';
            return;
        }

        const messageHandler = async (event) => {
            if (!event.origin.includes('github.io') && !event.origin.includes('localhost')) return;

            if (event.data?.type === 'STAR_TAB_AUTH_SUCCESS') {
                window.removeEventListener('message', messageHandler);
                
                try {
                    await procesarAutenticacionExitosa(event.data.user);
                    if (authWindow && !authWindow.closed) {
                        setTimeout(() => authWindow.close(), 1000);
                    }
                } catch (error) {
                    console.error('Error al procesar usuario:', error);
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
                DOM.authBtn.innerHTML = '<span class="auth-btn-text">Iniciar sesión</span>';
            }
        }, 120000);

    } catch (error) {
        console.error('Error en iniciarSesionGoogle:', error);
        if (DOM.authBtn) {
            DOM.authBtn.disabled = false;
            DOM.authBtn.innerHTML = '<span class="auth-btn-text">Iniciar sesión</span>';
        }
        alert('Error al conectar con el servicio de autenticación');
    }
}

async function procesarAutenticacionExitosa(user) {
    currentUser = user;
    estado.isAuthenticated = true;
    
    actualizarUIAutenticacion(user);
    
    // Inicializar Firebase si es necesario
    if (initFirebase()) {
        await sincronizarPerfilUsuario(user);
        await cargarConfiguracionUsuario(user.uid);
    }
    
    habilitarEdicion(true);
    
    try {
        localStorage.setItem('starTab_lastUser', JSON.stringify({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
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
    currentUser = null;
    estado.isAuthenticated = false;
    
    actualizarUIAutenticacion(null);
    
    if (unsubscribeUserConfig) {
        unsubscribeUserConfig();
        unsubscribeUserConfig = null;
    }
    
    localStorage.removeItem('starTab_lastUser');
    localStorage.removeItem('starTab_auth_data');
    
    cargarConfiguracionLocal();
    habilitarEdicion(false);
}

async function sincronizarPerfilUsuario(user) {
    if (!user || !user.uid || !db) return;

    try {
        const userDocRef = db.collection('users').doc(user.uid);
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
                    photoURL: user.photoURL
                }
            }, { merge: true });
        }
    } catch (error) {
        console.error('Error al sincronizar perfil:', error);
    }
}

function inicializarAutenticacion() {
    try {
        const savedUser = localStorage.getItem('starTab_lastUser');
        if (savedUser) {
            const userData = JSON.parse(savedUser);
            if (Date.now() - userData.timestamp < 7 * 24 * 60 * 60 * 1000) {
                // Restaurar sesión sin Firebase inmediatamente
                currentUser = userData;
                estado.isAuthenticated = true;
                actualizarUIAutenticacion(userData);
                habilitarEdicion(true);
                
                // Inicializar Firebase en segundo plano
                requestIdleCallback(() => {
                    if (initFirebase()) {
                        cargarConfiguracionUsuario(userData.uid);
                    }
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

    document.addEventListener('click', (e) => {
        if (DOM.userMenu && !DOM.userMenu.contains(e.target)) {
            DOM.userDropdown.style.display = 'none';
        }
    });

    if (DOM.userAvatar) {
        DOM.userAvatar.addEventListener('click', (e) => {
            e.stopPropagation();
            const display = DOM.userDropdown.style.display;
            DOM.userDropdown.style.display = display === 'none' ? 'block' : 'none';
        });
    }
}

// ===== CONFIGURACIÓN POR USUARIO CON RESPALDO LOCAL =====
let _ultimaCategoriaFondo = null;

// Función para guardar backup local
function guardarBackupLocal(data) {
    try {
        const backupData = {
            ...data,
            metadata: {
                ...data.metadata,
                ultimaModificacionLocal: Date.now() / 1000
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

// Función para cargar backup local
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

// Función para aplicar configuración sin parpadeos
function aplicarConfiguracion(data) {
    if (!data) return;
    
    // Guardar backup local
    guardarBackupLocal(data);

    // Verificar si realmente hay cambios en categorías
    const categoriasCambiaron = JSON.stringify(categoriasPersonalizadas) !== JSON.stringify(data.categorias);
    
    if (categoriasCambiaron) {
        if (data.categorias && data.categorias.length > 0) {
            categoriasPersonalizadas = data.categorias;
        } else {
            categoriasPersonalizadas = [
                {
                    ...CATEGORIA_GENERAL,
                    accesos: obtenerIconosPorDefecto()
                }
            ];
        }

        renderizarCategorias();
        
        if (!categoriasPersonalizadas.some(c => c.id === estado.categoriaActual)) {
            estado.categoriaActual = 'general';
            localStorage.setItem('categoriaSeleccionada', 'general');
        }
    }

    // Verificar si hay cambios en notas
    if (data.notas) {
        let notasCambiaron = false;
        for (let i = 1; i <= 5; i++) {
            if (data.notas[`nota${i}`] !== undefined && 
                notaEstado.notas[i].contenido !== data.notas[`nota${i}`]) {
                notaEstado.notas[i].contenido = data.notas[`nota${i}`];
                notasCambiaron = true;
            }
        }
        
        if (notasCambiaron) {
            const notaDOM = {
                textarea: document.getElementById('nota-textarea')
            };
            if (notaDOM.textarea && document.getElementById('nota-modal')?.classList.contains('nota-modal-abierto')) {
                cargarNota(notaEstado.notaActual, notaDOM);
            }
        }
    }

    // Obtener iconos de la categoría actual
    const categoriaActual = categoriasPersonalizadas.find(c => c.id === estado.categoriaActual);
    const nuevosIconos = categoriaActual?.accesos || [];
    
    const iconosCambiaron = JSON.stringify(estado.iconosActuales) !== JSON.stringify(nuevosIconos);
    
    if (iconosCambiaron) {
        estado.iconosActuales = nuevosIconos;
        renderizarIconos(true);
    }

    if (categoriaActual && categoriaActual.background) {
        const fondoActual = window.fondoActualCategoria;
        const nuevoFondo = categoriaActual.background;
        
        if (!fondoActual || JSON.stringify(fondoActual) !== JSON.stringify(nuevoFondo)) {
            aplicarFondoCategoria(estado.categoriaActual);
        }
    }
}

async function cargarConfiguracionUsuario(uid) {
    if (!db) {
        console.log('Firebase no inicializado, usando configuración local');
        cargarConfiguracionLocal();
        return;
    }
    
    try {
        if (unsubscribeUserConfig) {
            unsubscribeUserConfig();
        }

        userConfigRef = db.collection('users').doc(uid);

        const localBackup = cargarBackupLocal();
        let localTimestamp = localBackup?.metadata?.ultimaModificacionLocal || 0;

        try {
            const doc = await userConfigRef.get();
            
            if (doc.exists) {
                const firebaseData = doc.data();
                const firebaseTimestamp = firebaseData.metadata?.ultimaModificacion?.seconds || 0;
                
                if (localTimestamp > firebaseTimestamp && localBackup) {
                    console.log('Configuración local más nueva, actualizando Firebase');
                    await userConfigRef.set(localBackup, { merge: true });
                    aplicarConfiguracion(localBackup);
                } else {
                    console.log('Usando configuración de Firebase');
                    aplicarConfiguracion(firebaseData);
                }
            } else {
                if (localBackup) {
                    console.log('No hay datos en Firebase, usando backup local');
                    await userConfigRef.set(localBackup);
                    aplicarConfiguracion(localBackup);
                } else {
                    await crearConfiguracionPorDefecto(uid);
                }
            }
        } catch (firebaseError) {
            console.log('Error conectando a Firebase, usando backup local:', firebaseError);
            
            if (localBackup) {
                console.log('Usando configuración de backup local');
                aplicarConfiguracion(localBackup);
            } else {
                cargarConfiguracionLocal();
            }
        }

        // Snapshot optimizado sin parpadeos
        unsubscribeUserConfig = userConfigRef.onSnapshot(async (doc) => {
            const isOnline = navigator.onLine;
            
            if (!isOnline || doc.metadata.hasPendingWrites) {
                return;
            }

            if (doc.exists) {
                const firebaseData = doc.data();
                const firebaseTimestamp = firebaseData.metadata?.ultimaModificacion?.seconds || 0;
                
                const currentLocalBackup = cargarBackupLocal();
                let currentLocalTimestamp = currentLocalBackup?.metadata?.ultimaModificacionLocal || 0;

                if (firebaseTimestamp > currentLocalTimestamp || !currentLocalBackup) {
                    const categoriasActuales = JSON.stringify(categoriasPersonalizadas);
                    const categoriasNuevas = JSON.stringify(firebaseData.categorias || []);
                    
                    const notasActuales = JSON.stringify({
                        nota1: notaEstado.notas[1].contenido,
                        nota2: notaEstado.notas[2].contenido,
                        nota3: notaEstado.notas[3].contenido,
                        nota4: notaEstado.notas[4].contenido,
                        nota5: notaEstado.notas[5].contenido
                    });
                    
                    const notasNuevas = JSON.stringify(firebaseData.notas || {});
                    
                    if (categoriasActuales !== categoriasNuevas || notasActuales !== notasNuevas) {
                        console.log('Snapshot: aplicando cambios de Firebase');
                        aplicarConfiguracion(firebaseData);
                    }
                }
            }
        }, (error) => {
            console.error('Error en snapshot de Firebase:', error);
        });

    } catch (error) {
        console.error('Error general en cargarConfiguracionUsuario:', error);
        cargarConfiguracionLocal();
    }
}

async function crearConfiguracionPorDefecto(uid) {
    if (!db) return;
    
    try {
        const configInicial = { ...CONFIG_DEFAULT };
        configInicial.profile = {
            displayName: currentUser?.displayName || 'Usuario',
            email: currentUser?.email || '',
            photoURL: currentUser?.photoURL || ''
        };
        await db.collection('users').doc(uid).set(configInicial);
        guardarBackupLocal(configInicial);
    } catch (error) {
        console.error('Error al crear configuración:', error);
    }
}

async function cargarConfiguracionLocal() {
    console.log('Cargando configuración local...');
    
    const backup = cargarBackupLocal();
    let fondoGuardado = null;
    
    try {
        fondoGuardado = JSON.parse(localStorage.getItem('starTab_fondo_rapido') || 'null');
    } catch (e) {}

    if (backup) {
        console.log('Cargando configuración desde backup local');
        
        categoriasPersonalizadas = backup.categorias || [
            {
                ...CATEGORIA_GENERAL,
                accesos: obtenerIconosPorDefecto(),
                background: fondoGuardado ? {
                    tipo: fondoGuardado.tipo || 'gradiente',
                    url: fondoGuardado.url || null,
                    opacidad: fondoGuardado.opacidad || 0.2,
                    desenfoque: fondoGuardado.desenfoque || 0,
                    colorInicio: fondoGuardado.colorInicio || '#667eea',
                    colorFin: fondoGuardado.colorFin || '#764ba2'
                } : { ...FONDO_DEFAULT }
            }
        ];

        if (backup.notas) {
            for (let i = 1; i <= 5; i++) {
                if (backup.notas[`nota${i}`]) {
                    notaEstado.notas[i].contenido = backup.notas[`nota${i}`];
                }
            }
        }

        renderizarCategorias();
        aplicarFondoCategoria(estado.categoriaActual);
        renderizarIconos(true);
        
        const notaDOM = {
            textarea: document.getElementById('nota-textarea')
        };
        if (notaDOM.textarea) {
            cargarNota(notaEstado.notaActual, notaDOM);
        }
        
        return;
    }

    console.log('No hay backup, usando configuración por defecto');
    categoriasPersonalizadas = [
        {
            ...CATEGORIA_GENERAL,
            accesos: obtenerIconosPorDefecto(),
            background: fondoGuardado ? {
                tipo: fondoGuardado.tipo || 'gradiente',
                url: fondoGuardado.url || null,
                opacidad: fondoGuardado.opacidad || 0.2,
                desenfoque: fondoGuardado.desenfoque || 0,
                colorInicio: fondoGuardado.colorInicio || '#667eea',
                colorFin: fondoGuardado.colorFin || '#764ba2'
            } : { ...FONDO_DEFAULT }
        }
    ];

    for (let i = 1; i <= 5; i++) {
        notaEstado.notas[i].contenido = `📝 Nota ${i}\n\n• Inicia sesión para sincronizar\n• Tus notas se guardarán en la nube`;
    }

    renderizarCategorias();
    
    if (fondoGuardado) {
        const fondoConfig = {
            tipo: fondoGuardado.tipo || 'gradiente',
            url: fondoGuardado.url || null,
            opacidad: fondoGuardado.opacidad || 0.2,
            desenfoque: fondoGuardado.desenfoque || 0,
            colorInicio: fondoGuardado.colorInicio || '#667eea',
            colorFin: fondoGuardado.colorFin || '#764ba2'
        };
        
        const fondoElement = document.getElementById('fondo-activo') || document.createElement('div');
        if (!fondoElement.id) {
            fondoElement.id = 'fondo-activo';
            fondoElement.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: -1;
                pointer-events: none;
            `;
            document.body.insertBefore(fondoElement, document.body.firstChild);
        }
        
        aplicarEstiloFondo(fondoElement, fondoConfig, false);
        fondoElement.style.opacity = '1';
        
        categoriasPersonalizadas[0].background = fondoConfig;
        window.fondoActualCategoria = fondoConfig;
    } else {
        await aplicarFondoCategoria(estado.categoriaActual);
    }
    
    await renderizarIconos(true);
}

// ===== GUARDADO EN FIREBASE CON RESPALDO LOCAL =====
async function guardarConfiguracionCompleta() {
    const datosAGuardar = {
        categorias: categoriasPersonalizadas,
        notas: {
            nota1: notaEstado.notas[1].contenido,
            nota2: notaEstado.notas[2].contenido,
            nota3: notaEstado.notas[3].contenido,
            nota4: notaEstado.notas[4].contenido,
            nota5: notaEstado.notas[5].contenido
        }
    };

    guardarBackupLocal(datosAGuardar);

    if (!currentUser || !userConfigRef || !db || !navigator.onLine) {
        console.log('Offline o no autenticado: cambios guardados solo localmente');
        return;
    }
    
    try {
        await userConfigRef.set({
            categorias: categoriasPersonalizadas,
            notas: {
                nota1: notaEstado.notas[1].contenido,
                nota2: notaEstado.notas[2].contenido,
                nota3: notaEstado.notas[3].contenido,
                nota4: notaEstado.notas[4].contenido,
                nota5: notaEstado.notas[5].contenido
            },
            metadata: {
                ultimaModificacion: firebase.firestore.FieldValue.serverTimestamp(),
                version: '1.0'
            }
        }, { merge: true });
        console.log('Configuración guardada en Firebase');
    } catch (error) {
        console.error('Error al guardar configuración en Firebase:', error);
    }
}

// ===== HABILITAR/DESABILITAR EDICIÓN =====
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
}

// ===== FUNCIONES DE CATEGORÍAS COMPLETAS =====
let _categoriasListenersInit = false;
let _agregarCategoriaEnProceso = false;

function inicializarListenersCategorias() {
    if (_categoriasListenersInit) return;
    
    const container = document.querySelector('.categorias-container');
    if (!container) return;

    // Delegación de eventos para clicks
    container.addEventListener('click', async (e) => {
        // Botón de categoría normal
        const btn = e.target.closest('.categoria-btn[data-categoria]');
        if (btn) {
            cambiarCategoria(btn.dataset.categoria);
            return;
        }
        
        // Botón de agregar categoría
        const addBtn = e.target.closest('#btn-agregar-categoria');
        if (addBtn && estado.isAuthenticated) {
            e.preventDefault();
            e.stopPropagation();
            await agregarCategoria();
            return;
        }
    });

    // Menú contextual en categorías editables
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

    _categoriasListenersInit = true;
}

function renderizarCategorias() {
    const container = document.querySelector('.categorias-container');
    if (!container) return;

    let html = '';

    categoriasPersonalizadas.forEach(cat => {
        const activo = cat.id === estado.categoriaActual ? 'activo' : '';

        html += `
            <div class="categoria-wrapper" data-categoria-id="${cat.id}" data-categoria-editable="${cat.editable !== false}">
                <button class="categoria-btn ${activo}" data-categoria="${cat.id}">
                    <span class="categoria-nombre">${cat.nombre}</span>
                </button>
            </div>
        `;
    });

    if (categoriasPersonalizadas.length < MAX_CATEGORIAS && estado.isAuthenticated) {
        html += `
            <button class="categoria-btn agregar-categoria-btn" id="btn-agregar-categoria">
                <span class="agregar-categoria">+</span>
            </button>
        `;
    }

    if (container.innerHTML !== html) {
        container.innerHTML = html;
        inicializarListenersCategorias();
    }
}

function actualizarCategoriasUI() {
    document.querySelectorAll('.categoria-btn[data-categoria]').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.categoria === estado.categoriaActual);
    });
}

async function cambiarCategoria(categoriaId) {
    if (!categoriasPersonalizadas.some(c => c.id === categoriaId) || categoriaId === estado.categoriaActual) return;

    estado.categoriaActual = categoriaId;
    localStorage.setItem('categoriaSeleccionada', categoriaId);
    
    const nuevaCategoria = categoriasPersonalizadas.find(c => c.id === categoriaId);
    estado.iconosActuales = nuevaCategoria?.accesos || [];
    
    actualizarCategoriasUI();
    aplicarFondoCategoria(categoriaId);
    await renderizarIconos(true);
}

// FUNCIÓN AGREGAR CATEGORÍA
async function agregarCategoria() {
    if (_agregarCategoriaEnProceso) return;
    _agregarCategoriaEnProceso = true;

    try {
        const nombre = prompt('Nombre de la nueva categoría (máx 20 caracteres):', 'Nueva categoría');
        if (nombre === null) {
            _agregarCategoriaEnProceso = false;
            return;
        }

        const nombreTrim = nombre.trim();
        if (!nombreTrim) {
            alert('El nombre no puede estar vacío');
            _agregarCategoriaEnProceso = false;
            return;
        }

        if (nombreTrim.length > 20) {
            alert('El nombre no puede tener más de 20 caracteres');
            _agregarCategoriaEnProceso = false;
            return;
        }

        if (categoriasPersonalizadas.some(c => c.nombre.toLowerCase() === nombreTrim.toLowerCase())) {
            alert('Ya existe una categoría con ese nombre');
            _agregarCategoriaEnProceso = false;
            return;
        }

        const nuevoId = 'cat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // Usar el fondo de la categoría actual como base
        const categoriaActual = categoriasPersonalizadas.find(c => c.id === estado.categoriaActual);
        const fondoBase = categoriaActual && categoriaActual.background ? categoriaActual.background : FONDO_DEFAULT;

        const nuevaCategoria = {
            id: nuevoId,
            nombre: nombreTrim,
            editable: true,
            background: { ...fondoBase },
            accesos: []
        };

        categoriasPersonalizadas.push(nuevaCategoria);
        
        await guardarConfiguracionCompleta();
        
        renderizarCategorias();
        
        // Cambiar automáticamente a la nueva categoría
        estado.categoriaActual = nuevoId;
        localStorage.setItem('categoriaSeleccionada', nuevoId);
        estado.iconosActuales = [];
        await renderizarIconos(true);
        aplicarFondoCategoria(nuevoId);
        
    } catch (error) {
        console.error('Error al agregar categoría:', error);
        alert('Error al crear la categoría');
    } finally {
        _agregarCategoriaEnProceso = false;
    }
}

// FUNCIÓN MOSTRAR MENÚ CONTEXTUAL DE CATEGORÍA
function mostrarMenuContextualCategoria(event, categoriaId) {
    // Eliminar menú existente
    document.querySelector('.menu-contextual-categoria')?.remove();
    
    const categoria = categoriasPersonalizadas.find(c => c.id === categoriaId);
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
    
    // Posicionar el menú
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

    // Event listeners del menú
    menu.querySelector('[data-action="editar-categoria"]').addEventListener('click', async () => {
        menu.remove();
        await editarCategoria(categoriaId);
    });
    
    menu.querySelector('[data-action="eliminar-categoria"]').addEventListener('click', async () => {
        menu.remove();
        await eliminarCategoria(categoriaId);
    });
    
    // Cerrar al hacer click fuera
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

// FUNCIÓN EDITAR CATEGORÍA
async function editarCategoria(categoriaId) {
    const categoria = categoriasPersonalizadas.find(c => c.id === categoriaId);
    if (!categoria || categoria.editable === false) {
        alert('No puedes editar la categoría General');
        return;
    }
    
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
    
    if (categoriasPersonalizadas.some(c => c.id !== categoriaId && c.nombre.toLowerCase() === nombreTrim.toLowerCase())) {
        alert('Ya existe otra categoría con ese nombre');
        return;
    }
    
    categoria.nombre = nombreTrim;
    
    await guardarConfiguracionCompleta();
    renderizarCategorias();
}

// FUNCIÓN ELIMINAR CATEGORÍA
async function eliminarCategoria(categoriaId) {
    const categoria = categoriasPersonalizadas.find(c => c.id === categoriaId);
    
    if (!categoria || categoria.editable === false) {
        alert('No puedes eliminar la categoría General');
        return;
    }
    
    const mensaje = categoria.accesos && categoria.accesos.length > 0
        ? `¿Eliminar la categoría "${categoria.nombre}" y todos sus ${categoria.accesos.length} accesos directos?`
        : `¿Eliminar la categoría "${categoria.nombre}"?`;
    
    if (!confirm(mensaje)) return;
    
    const index = categoriasPersonalizadas.findIndex(c => c.id === categoriaId);
    if (index !== -1) {
        categoriasPersonalizadas.splice(index, 1);
        
        await guardarConfiguracionCompleta();
        
        // Si la categoría actual fue eliminada, ir a 'general'
        if (estado.categoriaActual === categoriaId) {
            estado.categoriaActual = 'general';
            localStorage.setItem('categoriaSeleccionada', 'general');
            
            const categoriaGeneral = categoriasPersonalizadas.find(c => c.id === 'general');
            estado.iconosActuales = categoriaGeneral?.accesos || [];
            await aplicarFondoCategoria('general');
            await renderizarIconos(true);
        }
        
        renderizarCategorias();
    }
}

// ===== FUNCIONES DE ICONOS OPTIMIZADAS =====
async function guardarIconosEnFirebase(iconos) {
    try {
        const categoriaIndex = categoriasPersonalizadas.findIndex(c => c.id === estado.categoriaActual);
        if (categoriaIndex !== -1) {
            categoriasPersonalizadas[categoriaIndex].accesos = iconos;
            estado.iconosActuales = iconos;
            await guardarConfiguracionCompleta();
        }
    } catch (error) {
        console.error('Error al guardar iconos:', error);
    }
}

async function cargarIconosDeFirebase() {
    const categoriaActual = categoriasPersonalizadas.find(c => c.id === estado.categoriaActual);
    estado.iconosActuales = categoriaActual?.accesos || [];
    
    if (estado.categoriaActual === 'general' && estado.iconosActuales.length === 0) {
        estado.iconosActuales = obtenerIconosPorDefecto();
        await guardarIconosEnFirebase(estado.iconosActuales);
    }
    
    return estado.iconosActuales;
}

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

// ===== FUNCIONES DE RENDERIZADO OPTIMIZADAS SIN PARPADEOS =====
async function renderizarIconos(ignorarCache = false) {
    const ahora = Date.now();
    if (ahora - _ultimoRenderizado < DEBOUNCE_TIME && !ignorarCache) {
        return;
    }
    
    if (_renderizando) return;
    _renderizando = true;
    
    const iconos = await cargarIconosDeFirebase();
    
    if (!ignorarCache && _iconosCache && JSON.stringify(_iconosCache) === JSON.stringify(iconos)) {
        console.log('Iconos sin cambios, omitiendo renderizado');
        _renderizando = false;
        return;
    }
    
    _iconosCache = iconos;
    
    const iconosActuales = DOM.contenedorIconos.children;
    if (iconosActuales.length === iconos.length && !ignorarCache) {
        let sonIguales = true;
        for (let i = 0; i < iconosActuales.length; i++) {
            const iconoActual = iconosActuales[i];
            const iconoNuevo = iconos[i];
            
            const hrefActual = iconoActual.getAttribute('href');
            const imgActual = iconoActual.querySelector('img')?.src;
            const spanActual = iconoActual.querySelector('span')?.textContent;
            
            if (hrefActual !== iconoNuevo.url || 
                imgActual !== iconoNuevo.icono || 
                spanActual !== iconoNuevo.nombre) {
                sonIguales = false;
                break;
            }
        }
        
        if (sonIguales) {
            console.log('Iconos visualmente iguales, omitiendo renderizado');
            _renderizando = false;
            return;
        }
    }

    requestAnimationFrame(() => {
const nuevoHTML = iconos.map((icono, index) => {
    const estilos = { ...ESTILOS_DEFAULT, ...(icono.estilos || {}) };
    const bgColor = estilos.tieneFondo && estilos.colorFondo ? estilos.colorFondo : 'transparent';
    const boxShadow = estilos.tieneFondo ? '0 4px 15px rgba(0,0,0,0.2)' : 'none';

    return `
        <a href="${icono.url}" class="icono-item" target="_blank" data-index="${index}" style="animation: aparecerIcono 0.3s cubic-bezier(0.2, 0, 0, 1) ${index * 0.03}s both">
            <div class="icono-contenedor" style="background-color:${bgColor};border-radius:${estilos.radioBorde}%;display:flex;align-items:center;justify-content:center;margin-bottom:0.5rem;transition:all 0.3s ease;box-shadow:${boxShadow}">
                <img src="${icono.icono}" alt="${icono.nombre}" style="width:${estilos.tamanoIcono}%;height:${estilos.tamanoIcono}%;object-fit:contain" loading="lazy">
            </div>
            
            <div class="btn-incognito-small" title="Abrir en incógnito" data-url="${icono.url}">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-hat-glasses-icon lucide-hat-glasses"><path d="M14 18a2 2 0 0 0-4 0"/><path d="m19 11-2.11-6.657a2 2 0 0 0-2.752-1.148l-1.276.61A2 2 0 0 1 12 4H8.5a2 2 0 0 0-1.925 1.456L5 11"/><path d="M2 11h20"/><circle cx="17" cy="18" r="3"/><circle cx="7" cy="18" r="3"/></svg>
            </div>

            <span>${icono.nombre}</span>
        </a>
    `;
}).join('');

        if (DOM.contenedorIconos.innerHTML !== nuevoHTML) {
            DOM.contenedorIconos.innerHTML = nuevoHTML;
        }

        DOM.contenedorIconos.oncontextmenu = e => {
            const item = e.target.closest('.icono-item');
            if (item && estado.isAuthenticated) {
                e.preventDefault();
                const index = parseInt(item.dataset.index);
                estado.iconoSeleccionadoIndex = index;
                mostrarMenuContextual(e, iconos[index]);
            }
        };

        inicializarDragAndDrop();
        _renderizando = false;
        _ultimoRenderizado = Date.now();
    });
}

function cargarIconosRapidos(sinAnimacion = false) {
    const iconosDefault = obtenerIconosPorDefecto();
    if (DOM.contenedorIconos) {
        const estiloAnimacion = sinAnimacion ? 'animation: none;' : 'animation: aparecerIcono 0.5s cubic-bezier(0.2, 0, 0, 1) both;';
        
        const nuevoHTML = iconosDefault.map((icono, index) => {
            return `
                <a href="${icono.url}" class="icono-item" target="_blank" data-index="${index}"
                   style="${estiloAnimacion} animation-delay: ${index * 0.05}s">
                    <div class="icono-contenedor" style="background-color:transparent;border-radius:50%;width:100px;height:100px;display:flex;align-items:center;justify-content:center;margin-bottom:0.5rem;">
                        <img src="${icono.icono}" alt="${icono.nombre}" 
                             style="width:74%;height:74%;object-fit:contain" loading="lazy">
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
    const iconoElement = document.querySelector(`.icono-item[data-index="${index}"]`);
    
    if (iconoElement) {
        iconoElement.style.animation = 'eliminarIcono 0.5s cubic-bezier(0.2, 0, 0, 1) forwards';
        
        await new Promise(resolve => setTimeout(resolve, 400));
        estado.iconosActuales.splice(index, 1);
        await guardarIconosEnFirebase(estado.iconosActuales);
        await renderizarIconos(true);
    }
}

// ===== DRAG AND DROP =====
function inicializarDragAndDrop() {
    DOM.contenedorIconos?.querySelectorAll('.icono-item').forEach(item => {
        item.draggable = estado.isAuthenticated;
        if (estado.isAuthenticated) {
            item.addEventListener('dragstart', handleDragStart);
            item.addEventListener('dragend', handleDragEnd);
            item.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
            item.addEventListener('dragenter', handleDragEnter);
            item.addEventListener('dragleave', e => e.currentTarget.classList.remove('drag-over'));
            item.addEventListener('drop', handleDrop);
        }
    });

    DOM.contenedorIconos?.addEventListener('dragover', e => e.preventDefault());
}

function handleDragStart(e) {
    estado.elementoArrastrado = this;
    this.classList.add('arrastrando');
    e.dataTransfer.setData('text/plain', [...this.parentNode.children].indexOf(this));
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd() {
    this.classList.remove('arrastrando');
    document.querySelectorAll('.icono-item').forEach(item => item.classList.remove('drag-over'));
}

function handleDragEnter(e) {
    e.preventDefault();
    if (this !== estado.elementoArrastrado) this.classList.add('drag-over');
}

async function handleDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');
    
    if (this === estado.elementoArrastrado) return;

    const items = [...DOM.contenedorIconos.children];
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
    const toIndex = items.indexOf(this);
    
    if (fromIndex === toIndex) return;

    const [movedItem] = estado.iconosActuales.splice(fromIndex, 1);
    estado.iconosActuales.splice(toIndex, 0, movedItem);
    
    await guardarIconosEnFirebase(estado.iconosActuales);
    await renderizarIconos(true);
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
        else if (action === 'eliminar') await eliminarIcono(estado.iconoSeleccionadoIndex);
        menu.remove();
    });

    setTimeout(() => {
        const cerrar = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', cerrar); }};
        document.addEventListener('click', cerrar);
    }, 100);
}

// ===== FUNCIONES DE FONDO OPTIMIZADAS =====
let _fondoToken = 0;

async function aplicarFondoCategoria(categoriaId) {
    if (_ultimaCategoriaFondo === categoriaId) {
        return;
    }
    
    const categoria = categoriasPersonalizadas.find(c => c.id === categoriaId);
    if (!categoria || !categoria.background) return;

    const miToken = ++_fondoToken;
    const fondoConfig = categoria.background;

    if (fondoConfig.tipo === 'imagen' && fondoConfig.url) {
        await precargarImagen(fondoConfig.url);
    } else if (fondoConfig.tipo === 'video' && fondoConfig.url) {
        await precargarVideo(fondoConfig.url);
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

function precargarVideo(url) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.oncanplay = () => resolve();
        video.onerror = () => resolve();
        video.src = url;
        setTimeout(resolve, 5000);
    });
}

function aplicarFondoConFade(fondoConfig) {
    const DURACION_FADE = 400;
    const tokenEsteFrame = _fondoToken;

    document.querySelectorAll('[id="fondo-temporal"]').forEach(el => el.remove());

    let fondoActual = document.getElementById('fondo-activo');

    if (fondoActual && fondoActual.dataset.fondoRapido === 'true') {
        const savedRaw = localStorage.getItem('starTab_fondo_rapido');
        const saved = savedRaw ? JSON.parse(savedRaw) : null;
        const mismoFondo = saved &&
            saved.tipo === fondoConfig.tipo &&
            saved.url === (fondoConfig.url || null) &&
            saved.colorInicio === (fondoConfig.colorInicio || null) &&
            saved.colorFin === (fondoConfig.colorFin || null);

        if (mismoFondo) {
            fondoActual.dataset.fondoRapido = 'false';
            window.fondoActualCategoria = fondoConfig;
            _guardarFondoLocalStorage(fondoConfig);
            return;
        } else {
            fondoActual.dataset.fondoRapido = 'false';
        }
    }

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
    aplicarEstiloFondo(nuevoFondo, fondoConfig, true);
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
        }, DURACION_FADE);
    });

    window.fondoActualCategoria = fondoConfig;
    _guardarFondoLocalStorage(fondoConfig);
}

function _guardarFondoLocalStorage(fondoConfig) {
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
        }
    } catch(e) {
        console.log('Error guardando fondo en localStorage:', e);
    }
}

// ===== FUNCIÓN DE FONDO SIMPLIFICADA =====
function aplicarEstiloFondo(elemento, config) {
    const { tipo, url, colorInicio, colorFin, opacidad, desenfoque } = config;
    
    // Limpiar estilos
    elemento.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: -1;
        pointer-events: none;
    `;
    
    // Aplicar desenfoque SIEMPRE de la misma manera
    if (desenfoque > 0) {
        elemento.style.filter = `blur(${desenfoque}px)`;
    }
    
    // Aplicar fondo según tipo
    if (tipo === 'gradiente') {
        elemento.style.background = `linear-gradient(135deg, ${colorInicio}, ${colorFin})`;
    } 
    else if (tipo === 'imagen' && url) {
        const op = opacidad || 0.2;
        elemento.style.background = `linear-gradient(rgba(0,0,0,${op}), rgba(0,0,0,${op})), url('${url}')`;
        elemento.style.backgroundSize = 'cover';
        elemento.style.backgroundPosition = 'center';
    } 
    else if (tipo === 'video' && url) {
        elemento.style.background = '#000';
        
        // Video simple
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
        
        video.src = url;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.play().catch(() => {});
    }
}

async function guardarFondoCategoria(nuevaConfiguracion) {
    const categoriaIndex = categoriasPersonalizadas.findIndex(c => c.id === estado.categoriaActual);
    if (categoriaIndex === -1) return;

    categoriasPersonalizadas[categoriaIndex].background = {
        tipo: nuevaConfiguracion.tipo,
        url: nuevaConfiguracion.url,
        opacidad: nuevaConfiguracion.opacidad,
        desenfoque: nuevaConfiguracion.desenfoque, // Esto ya se guarda
        colorInicio: nuevaConfiguracion.colorInicio,
        colorFin: nuevaConfiguracion.colorFin
    };

    aplicarFondoCategoria(estado.categoriaActual);
    await guardarConfiguracionCompleta();
    
    // Guardar en localStorage para fondo-rapido.js
    localStorage.setItem('starTab_fondo_rapido', JSON.stringify({
        tipo: nuevaConfiguracion.tipo,
        url: nuevaConfiguracion.url,
        opacidad: nuevaConfiguracion.opacidad,
        desenfoque: nuevaConfiguracion.desenfoque, // ¡Importante!
        colorInicio: nuevaConfiguracion.colorInicio,
        colorFin: nuevaConfiguracion.colorFin
    }));
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
    
    window.open(url, '_blank');
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
        fileText: document.querySelector('.file-text')
    };

const inputNombre = document.getElementById('nombre-sitio');
const previewNombre = document.getElementById('preview-nombre');

if (inputNombre && previewNombre) {
    inputNombre.addEventListener('input', (e) => {
        // Actualiza el texto de la previsualización con el valor del input
        previewNombre.textContent = e.target.value;
    });
}

    elementos.tieneFondo?.addEventListener('change', () => {
        elementos.colorFondoContainer.style.display = elementos.tieneFondo.checked ? 'flex' : 'none';
        actualizarPreviewDesdeModal(elementos);
    });

    elementos.colorFondo?.addEventListener('input', () => {
        actualizarPreviewDesdeModal(elementos);
    });

    elementos.radioBorde?.addEventListener('input', () => {
        elementos.radioValor.textContent = `${elementos.radioBorde.value}%`;
        actualizarPreviewDesdeModal(elementos);
    });

    elementos.tamanoIcono?.addEventListener('input', () => {
        elementos.tamanoValor.textContent = `${elementos.tamanoIcono.value}%`;
        actualizarPreviewDesdeModal(elementos);
    });

    elementos.icono?.addEventListener('input', () => {
        elementos.previewImg.src = elementos.icono.value || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'64\' height=\'64\' viewBox=\'0 0 24 24\' fill=\'%23666\'%3E%3Ccircle cx=\'12\' cy=\'12\' r=\'10\'/%3E%3C/svg%3E';
        actualizarPreviewDesdeModal(elementos);
    });

elementos.fileInput?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Verificar que sea una imagen
    if (!file.type.startsWith('image/')) {
        alert('Por favor, selecciona un archivo de imagen válido.');
        return;
    }
    
    elementos.fileName.textContent = file.name;
    elementos.fileLabel?.classList.add('seleccionado');
    if (elementos.fileText) elementos.fileText.textContent = '⏳';
    
    try {
        // Mostrar mensaje de proceso
        const previewNombre = document.getElementById('preview-nombre');
        if (previewNombre) previewNombre.textContent = 'Procesando...';
        
        // Comprimir y redimensionar la imagen (manteniendo transparencia)
        const base64Procesada = await comprimirYRedimensionarImagen(file, 256);
        
        // Actualizar campos
        elementos.icono.value = base64Procesada;
        elementos.previewImg.src = base64Procesada;
        
        // Restaurar texto del botón
        if (elementos.fileText) elementos.fileText.textContent = '✔';
        if (previewNombre) previewNombre.textContent = elementos.nombre.value || '';
        
    } catch (error) {
        console.error('Error al procesar imagen:', error);
        alert('Error al procesar la imagen. Intenta con otra imagen.');
        if (elementos.fileText) elementos.fileText.textContent = '+';
        
        // Limpiar el input en caso de error
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
        const icono = elementos.icono.value;
        const index = estado.iconoSeleccionadoIndex;

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

        if (index !== null && index >= 0) {
            estado.iconosActuales[index] = { 
                ...estado.iconosActuales[index],
                nombre, url, icono, estilos
            };
        } else {
            estado.iconosActuales.push({ nombre, url, icono, estilos });
        }
        
        await guardarIconosEnFirebase(estado.iconosActuales);
        await renderizarIconos(true);
        cerrarModalIconos(elementos);
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
        boxShadow: elementos.tieneFondo.checked ? 'none' : 'none'
    });
    
    Object.assign(elementos.previewImg.style, {
        width: `${elementos.tamanoIcono.value}%`,
        height: `${elementos.tamanoIcono.value}%`
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
        previewImg: document.getElementById('preview-img')
    };

    const estilos = { ...ESTILOS_DEFAULT, ...(icono.estilos || {}) };

    elementos.titulo.textContent = 'Editar acceso directo';
    elementos.nombre.value = icono.nombre || '';
    elementos.url.value = icono.url || '';
    elementos.icono.value = icono.icono || '';
    elementos.tieneFondo.checked = estilos.tieneFondo || false;
    elementos.colorFondo.value = estilos.colorFondo || '#667eea';
    elementos.radioBorde.value = estilos.radioBorde || 50;
    elementos.radioValor.textContent = `${elementos.radioBorde.value}%`;
    elementos.tamanoIcono.value = estilos.tamanoIcono || 74;
    elementos.tamanoValor.textContent = `${elementos.tamanoIcono.value}%`;
    elementos.colorFondoContainer.style.display = elementos.tieneFondo.checked ? 'flex' : 'none';

    actualizarPreviewDesdeModal(elementos);
    
    modal.classList.add('modal-abierto');
    modal.style.display = 'flex';
        document.querySelectorAll('.control-range').forEach(input => actualizarProgresoRange(input));

}

// En la función resetearModalIconos, agregar la línea para reiniciar preview-nombre
function resetearModalIconos(elementos) {
    elementos.nombre.value = '';
    elementos.url.value = '';
    elementos.icono.value = '';
    elementos.tieneFondo.checked = false;
    elementos.colorFondoContainer.style.display = 'none';
    elementos.colorFondo.value = '#667eea';
    elementos.radioBorde.value = '50';
    elementos.radioValor.textContent = '50%';
    elementos.tamanoIcono.value = '74';
    elementos.tamanoValor.textContent = '74%';
    
    // REINICIAR PREVIEW-NOMBRE
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
    if (fileText) fileText.textContent = '+';
    
    Object.assign(elementos.previewIcono.style, { backgroundColor: 'transparent', borderRadius: '12%', boxShadow: 'none' });
    Object.assign(elementos.previewImg.style, { width: '74%', height: '74%' });
    elementos.previewImg.src = './img/icons/interrogacion.png';
}

// También agregar en la función cerrarModalIconos para asegurar que se reinicie
function cerrarModalIconos(elementos) {
    const modal = DOM.modalIconos;
    if (!modal) return;
    
    // Reiniciar preview-nombre al cerrar
    const previewNombre = document.getElementById('preview-nombre');
    if (previewNombre) {
        previewNombre.textContent = '';
    }
    
    modal.classList.remove('modal-abierto');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}


function actualizarProgresoRange(input) {
    if (!input) return;
    
    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max) || 100;
    const value = parseFloat(input.value) || min;
    
    // Calcular porcentaje
    const porcentaje = ((value - min) / (max - min)) * 100;
    
    // Aplicar color blanco hasta el porcentaje
    input.style.background = `linear-gradient(to right, white, white ${porcentaje}%, rgba(255,255,255,0.2) ${porcentaje}%, rgba(255,255,255,0.2))`;
}

// Configurar los listeners para todos los inputs con esa clase
document.querySelectorAll('.control-range').forEach(input => {
    // Actualizar al cargar
    actualizarProgresoRange(input);
    
    // Actualizar al mover
    input.addEventListener('input', () => {
        actualizarProgresoRange(input);
    });
});


// ===== MODAL DE PERSONALIZACIÓN =====
function inicializarModalPersonalizar() {
    const modal = DOM.modalPersonalizar;
    if (!modal) return;

    const elementos = {
        tipo: document.getElementById('fondo-tipo'), // input hidden
        url: document.getElementById('fondo-url-input'),
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

    // ===== BUTTON SELECT TIPO FONDO =====
    const botonesTipo = document.querySelectorAll('#fondo-tipo-buttons .btn-tipo');

    botonesTipo.forEach(boton => {
        boton.addEventListener('click', () => {
            // Quitar activo a todos
            botonesTipo.forEach(b => b.classList.remove('activo'));

            // Activar el actual
            boton.classList.add('activo');

            // Actualizar input hidden
            elementos.tipo.value = boton.dataset.value;

            actualizarSeccionesFondo(elementos);
            actualizarPreviewFondo(elementos);
        });
    });

    // ===== OPCIONES PREDEFINIDAS =====
    document.querySelectorAll('.opcion-fondo').forEach(opcion => {
        opcion.addEventListener('click', () => {
            const tipo = opcion.dataset.tipo;
            const url = opcion.dataset.url;

            elementos.tipo.value = tipo;
            elementos.url.value = url;

            // Sincronizar botones visualmente
            botonesTipo.forEach(b => {
                b.classList.toggle('activo', b.dataset.value === tipo);
            });

            actualizarSeccionesFondo(elementos);
            actualizarPreviewFondo(elementos);
        });
    });

    // ===== LISTENERS GENERALES =====
    elementos.url?.addEventListener('input', () => actualizarPreviewFondo(elementos));
    elementos.colorInicio?.addEventListener('input', () => actualizarPreviewFondo(elementos));
    elementos.colorFin?.addEventListener('input', () => actualizarPreviewFondo(elementos));

    elementos.opacidad?.addEventListener('input', () => {
        elementos.opacidadValor.textContent = `${elementos.opacidad.value}%`;
        actualizarPreviewFondo(elementos);
    });

    elementos.desenfoque?.addEventListener('input', () => {
        elementos.desenfoqueValor.textContent = `${elementos.desenfoque.value}px`;
        actualizarPreviewFondo(elementos);
    });

    // ===== GUARDAR =====
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

    // 1️⃣ Guardar en sistema
    guardarFondoCategoria(config);

    // 2️⃣ Aplicar inmediatamente al fondo visible
    let fondoActual = document.getElementById('fondo-activo');

    if (!fondoActual) {
        fondoActual = document.createElement('div');
        fondoActual.id = 'fondo-activo';
        fondoActual.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -1;
            pointer-events: none;
            transition: opacity 0.3s ease, filter 0.3s ease;
        `;
        document.body.insertBefore(fondoActual, document.body.firstChild);
    }

    aplicarEstiloFondo(fondoActual, config, false);

    cerrarModalPersonalizar(modal);
});

    // ===== CANCELAR =====
    elementos.cancelarBtn?.addEventListener('click', () => cerrarModalPersonalizar(modal));

    modal.addEventListener('click', e => {
        if (e.target === modal) cerrarModalPersonalizar(modal);
    });

    // ===== ABRIR MODAL =====
    DOM.btnPersonalizar?.addEventListener('click', () => {
        if (!estado.isAuthenticated) {
            alert('Debes iniciar sesión para personalizar el fondo');
            return;
        }

        cargarValoresActualesEnModal(elementos);

        // Sincronizar botones con valor actual
        botonesTipo.forEach(b => {
            b.classList.toggle('activo', b.dataset.value === elementos.tipo.value);
        });

        modal.classList.add('modal-personalizar-abierto');
        modal.style.display = 'flex';
    // 🔥 SOLO AGREGA ESTAS LÍNEAS:
    setTimeout(() => {
        document.querySelectorAll('.control-range').forEach(input => actualizarProgresoRange(input));
    }, 50);
});
}

function cargarValoresActualesEnModal(elementos) {
    const categoria = categoriasPersonalizadas.find(c => c.id === estado.categoriaActual);
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
    actualizarPreviewFondo(elementos);
    // 🔥 SOLO AGREGA ESTAS LÍNEAS:
    if (elementos.opacidad) actualizarProgresoRange(elementos.opacidad);
    if (elementos.desenfoque) actualizarProgresoRange(elementos.desenfoque);
}

// En la función actualizarSeccionesFondo, agrega la lógica para ocultar/mostrar el campo URL
function actualizarSeccionesFondo(elementos) {
    const tipo = elementos.tipo.value;
    
    elementos.grupoColores.style.display = tipo === 'gradiente' ? 'inline-flex' : 'none';
    elementos.imagenesSection.style.display = tipo === 'imagen' ? 'block' : 'none';
    elementos.videosSection.style.display = tipo === 'video' ? 'block' : 'none';
    
    // 🔥 NUEVO: Ocultar/mostrar el contenedor de URL personalizada
    const urlInputGroup = document.querySelector('.personalizar-input-group:has(#fondo-url-input)');
    if (urlInputGroup) {
        urlInputGroup.style.display = tipo === 'gradiente' ? 'none' : 'inline-flex';
    }
}

// script.js - Función actualizada para vistas previas diferenciadas

function actualizarPreviewFondo(elementos) {
    const tipo = elementos.tipo.value;
    const url = elementos.url.value;
    const colorInicio = elementos.colorInicio.value;
    const colorFin = elementos.colorFin.value;
    const opacidadCapa = (parseInt(elementos.opacidad.value) / 100) * 0.5;
    const desenfoquePx = parseInt(elementos.desenfoque.value);

    // *** ELEMENTO: La caja que solo mostrará la imagen limpia ***
    const previerMasterBox = document.querySelector('.previer-master-box');

    // --- ACTUALIZAR VISTA PREVIA COMPLETA (#preview-fondo) ---
    if (tipo === 'video' && url) {
        elementos.previewFondo.style.display = 'none';
        elementos.previewVideo.style.display = 'block';
        elementos.previewVideo.src = url;
        elementos.previewVideo.load();
        elementos.previewVideo.play().catch(() => {});
        elementos.previewVideo.style.opacity = 1 - opacidadCapa;
        elementos.previewVideo.style.filter = `blur(${desenfoquePx}px)`;
    } else {
        elementos.previewFondo.style.display = 'block';
        elementos.previewVideo.style.display = 'none';
        elementos.previewVideo.pause();

        let backgroundStyle = '';

        if (tipo === 'imagen' && url) {
            backgroundStyle = `linear-gradient(rgba(0, 0, 0, ${opacidadCapa}), rgba(0, 0, 0, ${opacidadCapa})), url('${url}')`;
            elementos.previewFondo.style.backgroundImage = backgroundStyle;
            elementos.previewFondo.style.backgroundSize = 'cover';
            elementos.previewFondo.style.backgroundPosition = 'center';
        } else if (tipo === 'gradiente') {
            backgroundStyle = `linear-gradient(135deg, ${colorInicio}, ${colorFin})`;
            elementos.previewFondo.style.backgroundImage = backgroundStyle;
            elementos.previewFondo.style.backgroundSize = 'auto';
            elementos.previewFondo.style.backgroundPosition = '0% 0%';
        } else {
            elementos.previewFondo.style.backgroundImage = 'none';
            elementos.previewFondo.style.backgroundColor = '#f0f0f0';
        }

        // Aplicar desenfoque SOLO a preview-fondo
        elementos.previewFondo.style.filter = `blur(${desenfoquePx}px)`;
    }

    // --- ACTUALIZAR PREVIER-MASTER-BOX (solo imagen limpia, sin blur ni opacidad) ---
    if (previerMasterBox) {
        // Resetear cualquier filtro o estilo adicional
        previerMasterBox.style.filter = 'none';
        
        if (tipo === 'imagen' && url) {
            // SOLO la imagen, sin capa de opacidad ni blur
            previerMasterBox.style.backgroundImage = `url('${url}')`;
            previerMasterBox.style.backgroundSize = 'cover';
            previerMasterBox.style.backgroundPosition = 'center';
        } else if (tipo === 'video' && url) {
            // Para video, usamos un frame representativo (el primer frame o una imagen por defecto)
            // O podrías dejar el fondo negro, pero mejor ponemos una imagen representativa
            previerMasterBox.style.backgroundImage = `url('img/backgrounds/video-placeholder.jpg')`; // Idealmente una imagen del video
            previerMasterBox.style.backgroundSize = 'cover';
            previerMasterBox.style.backgroundPosition = 'center';
            console.log('Modo video seleccionado - considera usar un placeholder');
        } else if (tipo === 'gradiente') {
            // Para gradiente, mostramos el gradiente limpio
            previerMasterBox.style.backgroundImage = `linear-gradient(135deg, ${colorInicio}, ${colorFin})`;
            previerMasterBox.style.backgroundSize = 'auto';
            previerMasterBox.style.backgroundPosition = '0% 0%';
        } else {
            // Fallback
            previerMasterBox.style.backgroundImage = `url('img/backgrounds/img_background_2.jpg')`;
            previerMasterBox.style.backgroundSize = 'cover';
            previerMasterBox.style.backgroundPosition = 'center';
        }
        
        // Asegurar que no tenga blur ni otros efectos
        previerMasterBox.style.backdropFilter = 'none';
        previerMasterBox.style.webkitBackdropFilter = 'none';
    }


}



function cerrarModalPersonalizar(modal) {
    modal.classList.remove('modal-personalizar-abierto');
    setTimeout(() => modal.style.display = 'none', 300);
}

// ===== FUNCIONES DE NOTAS =====
function inicializarNota() {
    const notaDOM = {
        icono: document.getElementById('nota-icono'),
        modal: document.getElementById('nota-modal'),
        cerrar: document.getElementById('nota-modal-cerrar'),
        textarea: document.getElementById('nota-textarea'),
        charCount: document.getElementById('nota-char-count'),
        syncIcon: document.getElementById('nota-sync-icon'),
        syncText: document.getElementById('nota-sync-text'),
        copiarBtn: document.getElementById('nota-btn-copiar'),
        notaBtns: document.querySelectorAll('.nota-btn-numero')
    };

    if (!notaDOM.textarea) return;

    cargarNotasIniciales(notaDOM);

    notaDOM.notaBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const notaNum = parseInt(btn.dataset.nota);
            cambiarNota(notaNum, notaDOM);
        });
    });

    notaDOM.icono?.addEventListener('click', () => abrirModalNota(notaDOM));
    notaDOM.cerrar?.addEventListener('click', () => cerrarModalNota(notaDOM));
    notaDOM.copiarBtn?.addEventListener('click', () => copiarNota(notaDOM));
    
    notaDOM.modal?.addEventListener('click', (e) => {
        if (e.target === notaDOM.modal) cerrarModalNota(notaDOM);
    });

    notaDOM.textarea?.addEventListener('input', (e) => {
        const texto = e.target.value;
        actualizarContadorCaracteres(texto, notaDOM);
        
        if (estado.isAuthenticated) {
            guardarNotaEnTiempoReal(notaEstado.notaActual, texto, notaDOM);
        } else {
            notaEstado.notas[notaEstado.notaActual].contenido = texto;
        }
    });

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !e.shiftKey) {
            e.preventDefault();
            abrirModalNota(notaDOM);
        }
        
        if (e.ctrlKey && !e.metaKey && e.key >= '1' && e.key <= '5') {
            e.preventDefault();
            const notaNum = parseInt(e.key);
            cambiarNota(notaNum, notaDOM);
        }
        
        if ((e.ctrlKey || e.metaKey) && e.key === 'c' && notaDOM.modal?.classList.contains('nota-modal-abierto')) {
            e.preventDefault();
            copiarNota(notaDOM);
        }
        
        if (e.key === 'Escape' && notaDOM.modal?.classList.contains('nota-modal-abierto')) {
            cerrarModalNota(notaDOM);
        }
    });
}

function cargarNotasIniciales(notaDOM) {
    for (let i = 1; i <= 5; i++) {
        if (!notaEstado.notas[i].contenido) {
            notaEstado.notas[i].contenido = `📝 Nota ${i}\n\n• Inicia sesión para sincronizar tus notas\n• Se guardarán automáticamente en la nube\n• Accede desde cualquier dispositivo\n\n¡Empieza a escribir! ✨`;
        }
    }
    cargarNota(1, notaDOM);
    
    if (estado.isAuthenticated) {
        cargarNotasDeFirebase(notaDOM);
    }
}

async function cargarNotasDeFirebase(notaDOM) {
    if (!currentUser || !userConfigRef || !db) return;

    try {
        const doc = await userConfigRef.get();
        if (doc.exists && doc.data() && doc.data().notas) {
            const data = doc.data();
            for (let i = 1; i <= 5; i++) {
                if (data.notas[`nota${i}`]) {
                    notaEstado.notas[i].contenido = data.notas[`nota${i}`];
                }
            }
            cargarNota(notaEstado.notaActual, notaDOM);
        }
    } catch (error) {
        console.error('Error al cargar notas:', error);
    }
}

function cargarNota(notaNum, notaDOM) {
    if (notaEstado.notas[notaNum] && notaEstado.notas[notaNum].contenido) {
        notaDOM.textarea.value = notaEstado.notas[notaNum].contenido;
    } else {
        notaDOM.textarea.value = '';
    }
    
    actualizarContadorCaracteres(notaDOM.textarea.value, notaDOM);
}

function guardarNotaEnTiempoReal(notaNum, texto, notaDOM) {
    notaEstado.notas[notaNum].contenido = texto;
    
    if (notaTimeouts[notaNum]) clearTimeout(notaTimeouts[notaNum]);
    
    notaTimeouts[notaNum] = setTimeout(async () => {
        try {
            if (!currentUser || !userConfigRef || !db) return;
            
            const updateData = {};
            updateData[`notas.nota${notaNum}`] = texto;
            updateData['metadata.ultimaModificacion'] = firebase.firestore.FieldValue.serverTimestamp();
            await userConfigRef.set(updateData, { merge: true });
        } catch (error) {
            console.error('Error al guardar nota:', error);
        }
    }, 1000);
}

function actualizarContadorCaracteres(texto, notaDOM) {
    if (!notaDOM.charCount) return;
    
    const caracteres = texto.length;
    const palabras = texto.trim() ? texto.trim().split(/\s+/).length : 0;
    
    notaDOM.charCount.textContent = `${caracteres} caracteres · ${palabras} palabras`;
}

function abrirModalNota(notaDOM) {
    if (!notaDOM.modal) return;
    
    notaDOM.modal.classList.add('nota-modal-abierto');
    document.body.style.overflow = 'hidden';
    
    setTimeout(() => {
        notaDOM.textarea?.focus();
    }, 300);
}

function cerrarModalNota(notaDOM) {
    if (!notaDOM.modal) return;
    
    notaDOM.modal.classList.remove('nota-modal-abierto');
    document.body.style.overflow = '';
}

function copiarNota(notaDOM) {
    if (!notaDOM.textarea) return;
    
    const texto = notaDOM.textarea.value;
    if (!texto || texto.trim() === '') return;
    
    navigator.clipboard.writeText(texto).catch(err => {
        console.error('Error al copiar:', err);
    });
}

function cambiarNota(notaNum, notaDOM) {
    if (notaNum === notaEstado.notaActual) return;
    
    notaEstado.notaActual = notaNum;
    
    notaDOM.notaBtns.forEach(btn => {
        btn.classList.toggle('activo', parseInt(btn.dataset.nota) === notaNum);
    });
    
    cargarNota(notaNum, notaDOM);
    notaDOM.textarea.placeholder = `Nota ${notaNum} - Escribe aquí...`;
}

// ===== INICIALIZACIÓN PRINCIPAL OPTIMIZADA =====
document.addEventListener('DOMContentLoaded', () => {
    // Desactivar animaciones temporalmente
    document.body.classList.add('no-animation');
    
    // 1. Cachear elementos DOM primero
    cachearElementos();
    
    // 2. Inicializar UI inmediata (sin Firebase)
    inicializarBarraBusqueda();
    inicializarAutenticacion();
    inicializarNota();
    
    // 3. Cargar iconos rápidos SIN animación
    cargarIconosRapidos(true);
    
    // 4. Cargar configuración local primero
    cargarConfiguracionLocal();
    
    // 5. Reactivar animaciones después de la carga inicial
    setTimeout(() => {
        document.body.classList.remove('no-animation');
    }, 100);
    
    // 6. Inicializar Firebase y modales en segundo plano
    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
            initFirebase();
            inicializarModalIconos();
            inicializarModalPersonalizar();
            
            if (currentUser && currentUser.uid && estado.firebaseInicializado) {
                cargarConfiguracionUsuario(currentUser.uid);
            }
        }, { timeout: 2000 });
    } else {
        setTimeout(() => {
            initFirebase();
            inicializarModalIconos();
            inicializarModalPersonalizar();
            
            if (currentUser && currentUser.uid && estado.firebaseInicializado) {
                cargarConfiguracionUsuario(currentUser.uid);
            }
        }, 1000);
    }

    // 7. Listener para cuando vuelve la conexión
    window.addEventListener('online', () => {
        console.log('Conexión restaurada, sincronizando...');
        if (currentUser && currentUser.uid && estado.firebaseInicializado) {
            cargarConfiguracionUsuario(currentUser.uid);
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





// Manejador de clics para el botón de incógnito
document.getElementById('contenedor-iconos').addEventListener('click', (e) => {
    const btnIncognito = e.target.closest('.btn-incognito-small');
    
    if (btnIncognito) {
        e.preventDefault(); // Evita que el <a> padre se active
        e.stopPropagation(); // Evita que el evento suba
        
        const url = btnIncognito.dataset.url;
        
        // Intentar usar la API de Chrome si es una extensión
        if (typeof chrome !== 'undefined' && chrome.windows) {
            chrome.windows.create({
                url: url,
                incognito: true,
                type: 'normal'
            });
        } else {
            // Si se usa como web normal (no extensión), el modo incógnito real 
            // no es accesible por JS por seguridad, pero abrimos en nueva ventana.
            window.open(url, '_blank', 'noopener,noreferrer');
            console.warn("El modo incógnito real solo funciona si esto corre como Extensión de Chrome.");
        }
    }
});
/* 5 */