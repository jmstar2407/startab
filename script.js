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

// Configuración de la categoría General - AHORA EDITABLE
const CATEGORIA_GENERAL = {
    id: 'general',
    nombre: 'General',
    editable: true, // Cambiado de false a true
    orden: 1,
    background: { ...FONDO_DEFAULT }
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
let _ultimoRenderizado = 0;
const DEBOUNCE_TIME = 100;

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

const comprimirYRedimensionarImagen = async (file, maxHeight = 256) => {
    return new Promise((resolve, reject) => {
        if (file.type === 'image/gif') {
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
            resolve(base64);
        };
        
        img.onerror = reject;
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
    
    if (initFirebase()) {
        await sincronizarPerfilUsuario(user);
        await cargarCategoriasUsuario(user.uid);
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
    
    if (unsubscribeCategories) {
        unsubscribeCategories();
        unsubscribeCategories = null;
    }
    
    // Cancelar listener de notas
    if (window.unsubscribeNotas) {
        window.unsubscribeNotas();
        window.unsubscribeNotas = null;
    }
    
    localStorage.removeItem('starTab_lastUser');
    localStorage.removeItem('starTab_auth_data');
    
    cargarCategoriasLocales();
    habilitarEdicion(false);
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


async function sincronizarPerfilUsuario(user) {
    if (!user || !user.uid || !db) return;

    try {
        userDocRef = db.collection('users').doc(user.uid);
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
            editable: true, // Cambiado de false a true
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
    try {
        const savedUser = localStorage.getItem('starTab_lastUser');
        if (savedUser) {
            const userData = JSON.parse(savedUser);
            if (Date.now() - userData.timestamp < 7 * 24 * 60 * 60 * 1000) {
                currentUser = userData;
                estado.isAuthenticated = true;
                actualizarUIAutenticacion(userData);
                habilitarEdicion(true);
                
                requestIdleCallback(() => {
                    if (initFirebase()) {
                        cargarCategoriasUsuario(userData.uid);
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

    // NUEVO: Event listener para el botón de backup
    const backupBtn = document.getElementById('backup-btn');
    if (backupBtn) {
        backupBtn.addEventListener('click', descargarBackup);
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

        userDocRef = db.collection('users').doc(uid);
        
        // Cargar backup local primero
        const localBackup = cargarBackupLocal();
        if (localBackup && localBackup.categorias) {
            categorias = localBackup.categorias;
            await cargarIconosCategoriaActual();
            renderizarCategorias();
            aplicarFondoCategoria(estado.categoriaActual);
        }

        // Escuchar cambios en las categorías
        unsubscribeCategories = userDocRef.collection('categorias').onSnapshot(async (snapshot) => {
            const isOnline = navigator.onLine;
            
            if (!isOnline || snapshot.metadata.hasPendingWrites) {
                return;
            }

            const firestoreCategorias = [];
            
            // Procesar categorías de Firebase
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
                firestoreCategorias.unshift({
                    ...CATEGORIA_GENERAL,
                    id: 'general'
                });
                
                // Guardar en Firebase
                try {
                    await userDocRef.collection('categorias').doc('general').set({
                        nombre: 'General',
                        editable: true, // Cambiado de false a true
                        orden: 1,
                        background: { ...FONDO_DEFAULT }
                    });
                } catch (e) {
                    console.error('Error creando General en Firebase:', e);
                }
            }

            // Comparar con categorías actuales
            const categoriasActualesStr = JSON.stringify(categorias.map(c => ({
                id: c.id,
                nombre: c.nombre,
                editable: c.editable,
                orden: c.orden,
                background: c.background
            })));
            
            const categoriasNuevasStr = JSON.stringify(firestoreCategorias.map(c => ({
                id: c.id,
                nombre: c.nombre,
                editable: c.editable,
                orden: c.orden,
                background: c.background
            })));

            if (categoriasActualesStr !== categoriasNuevasStr) {
                console.log('Categorías actualizadas desde Firebase');
                categorias = firestoreCategorias;
                
                // Validar categoría actual
                if (!categorias.some(c => c.id === estado.categoriaActual)) {
                    estado.categoriaActual = 'general';
                    localStorage.setItem('categoriaSeleccionada', 'general');
                }
                
                await cargarIconosCategoriaActual();
                renderizarCategorias();
                aplicarFondoCategoria(estado.categoriaActual);
                guardarBackupLocal();
                
                // Reinicializar drag & drop
                if (estado.isAuthenticated) {
                    setTimeout(() => inicializarDragAndDropCategorias(), 100);
                }
            }
        }, (error) => {
            console.error('Error en snapshot de categorías:', error);
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

    // Si está autenticado y online, cargar desde Firebase
    if (currentUser && db && navigator.onLine) {
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
    if (!currentUser || !db || !navigator.onLine) {
        guardarIconosLocalmente(iconos);
        return;
    }

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
            const newDocRef = iconosRef.doc();
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
        // Asegurar que tiene orden 1
        if (categorias[generalIndex].orden === undefined) {
            categorias[generalIndex].orden = 1; // Cambiado de 0 a 1
        }
        // Asegurar que es editable
        if (categorias[generalIndex].editable === undefined) {
            categorias[generalIndex].editable = true;
        }
    }

    // Validar categoría actual
    if (!categorias.some(c => c.id === estado.categoriaActual)) {
        estado.categoriaActual = 'general';
        localStorage.setItem('categoriaSeleccionada', 'general');
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

    // Cargar notas
    if (backup && backup.notas) {
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
}

function renderizarCategorias() {
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
        
        // Inicializar drag & drop después de renderizar
        if (estado.isAuthenticated) {
            setTimeout(() => inicializarDragAndDropCategorias(), 50);
        }
    }
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
        cat.orden = index + 1; // Cambiado de index a index + 1
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

async function renderizarIconos(ignorarCache = false) {
    const ahora = Date.now();
    if (ahora - _ultimoRenderizado < DEBOUNCE_TIME && !ignorarCache) {
        return;
    }
    
    if (_renderizando) return;
    _renderizando = true;
    
    const iconos = estado.iconosActuales;
    
    if (!ignorarCache && _iconosCache && JSON.stringify(_iconosCache) === JSON.stringify(iconos)) {
        console.log('Iconos sin cambios, omitiendo renderizado');
        _renderizando = false;
        return;
    }
    
    _iconosCache = iconos;
    
    requestAnimationFrame(() => {
        const nuevoHTML = iconos.map((icono, index) => {
            const estilos = { ...ESTILOS_DEFAULT, ...(icono.estilos || {}) };
            const bgColor = estilos.tieneFondo && estilos.colorFondo ? estilos.colorFondo : 'transparent';
            const boxShadow = estilos.tieneFondo ? '0 4px 15px rgba(0,0,0,0.2)' : 'none';

            return `
                    <a href="${icono.url}" class="icono-item" target="_self" data-index="${index}" style="animation: aparecerIcono 0.3s cubic-bezier(0.2, 0, 0, 1) ${index * 0.03}s both">
                    <div class="icono-contenedor">
                        <img src="${icono.icono}" alt="${icono.nombre}" loading="lazy">
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
    const iconoElement = document.querySelector(`.icono-item[data-index="${index}"]`);
    
    if (iconoElement) {
        iconoElement.style.animation = 'eliminarIcono 0.5s cubic-bezier(0.2, 0, 0, 1) forwards';
        
        await new Promise(resolve => setTimeout(resolve, 400));
        estado.iconosActuales.splice(index, 1);
        await guardarIconosEnFirebase(estado.iconosActuales);
        await renderizarIconos(true);
    }
}

// ===== DRAG AND DROP DE ICONOS =====
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

// ===== FUNCIONES DE FONDO CORREGIDAS =====
let _fondoToken = 0;
let _ultimaCategoriaFondo = null;

async function aplicarFondoCategoria(categoriaId) {
    // Permitir aplicar incluso si es la misma categoría (para cambios inmediatos)
    const categoria = categorias.find(c => c.id === categoriaId);
    if (!categoria || !categoria.background) return;

    const miToken = ++_fondoToken;
    const fondoConfig = categoria.background;

    // Precargar si es necesario
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
        
        video.src = url;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.load();
        video.play().catch(e => console.log('Error reproduciendo video:', e));
    }
}

async function guardarFondoCategoria(nuevaConfiguracion) {
    const categoria = categorias.find(c => c.id === estado.categoriaActual);
    if (!categoria) return;

    categoria.background = {
        tipo: nuevaConfiguracion.tipo,
        url: nuevaConfiguracion.url,
        opacidad: nuevaConfiguracion.opacidad,
        desenfoque: nuevaConfiguracion.desenfoque,
        colorInicio: nuevaConfiguracion.colorInicio,
        colorFin: nuevaConfiguracion.colorFin
    };

    // Guardar en Firebase
    if (currentUser && db) {
        await actualizarCategoriaEnFirebase(estado.categoriaActual, {
            background: categoria.background
        });
    }

    // APLICAR INMEDIATAMENTE
    aplicarFondoCategoria(estado.categoriaActual);
    
    guardarFondoLocalStorage(categoria.background);
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

    elementos.icono?.addEventListener('input', () => {
        elementos.previewImg.src = elementos.icono.value || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'64\' height=\'64\' viewBox=\'0 0 24 24\' fill=\'%23666\'%3E%3Ccircle cx=\'12\' cy=\'12\' r=\'10\'/%3E%3C/svg%3E';
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
        if (elementos.fileText) elementos.fileText.textContent = '⏳';
        
        try {
            const base64Procesada = await comprimirYRedimensionarImagen(file, 256);
            
            elementos.icono.value = base64Procesada;
            elementos.previewImg.src = base64Procesada;
            
            if (elementos.fileText) elementos.fileText.textContent = '✔';
            
        } catch (error) {
            console.error('Error al procesar imagen:', error);
            alert('Error al procesar la imagen. Intenta con otra imagen.');
            if (elementos.fileText) elementos.fileText.textContent = '+';
            
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

        if (index !== null && index >= 0 && index < estado.iconosActuales.length) {
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
        boxShadow: elementos.tieneFondo.checked ? '0 4px 15px rgba(0,0,0,0.2)' : 'none'
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
    if (fileText) fileText.textContent = '+';

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
    elementos.radioBorde.value = estilos.radioBorde || 50;
    elementos.radioValor.textContent = `${elementos.radioBorde.value}%`;
    elementos.tamanoIcono.value = estilos.tamanoIcono || 74;
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
    elementos.radioBorde.value = '50';
    elementos.radioValor.textContent = '50%';
    elementos.tamanoIcono.value = '74';
    elementos.tamanoValor.textContent = '74%';
    
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
    
    Object.assign(elementos.previewIcono.style, { 
        backgroundColor: 'transparent', 
        borderRadius: '12%', 
        boxShadow: 'none' 
    });
    Object.assign(elementos.previewImg.style, { 
        width: '74%', 
        height: '74%' 
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
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
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

    const botonesTipo = document.querySelectorAll('#fondo-tipo-buttons .btn-tipo');

    botonesTipo.forEach(boton => {
        boton.addEventListener('click', () => {
            botonesTipo.forEach(b => b.classList.remove('activo'));
            boton.classList.add('activo');
            elementos.tipo.value = boton.dataset.value;
            actualizarSeccionesFondo(elementos);
            actualizarPreviewFondo(elementos);
        });
    });

    document.querySelectorAll('.opcion-fondo').forEach(opcion => {
        opcion.addEventListener('click', () => {
            const tipo = opcion.dataset.tipo;
            const url = opcion.dataset.url;

            elementos.tipo.value = tipo;
            elementos.url.value = url;

            botonesTipo.forEach(b => {
                b.classList.toggle('activo', b.dataset.value === tipo);
            });

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
    const url = elementos.url.value;
    const colorInicio = elementos.colorInicio.value;
    const colorFin = elementos.colorFin.value;
    const opacidadCapa = (parseInt(elementos.opacidad.value) / 100) * 0.5;
    const desenfoquePx = parseInt(elementos.desenfoque.value);

    const previerMasterBox = document.querySelector('.previer-master-box');

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
            elementos.previewFondo.style.backgroundSize = 'cover';
            elementos.previewFondo.style.backgroundPosition = 'center';
        } else {
            elementos.previewFondo.style.backgroundImage = 'none';
            elementos.previewFondo.style.backgroundColor = '#f0f0f0';
        }

        elementos.previewFondo.style.filter = `blur(${desenfoquePx}px)`;
    }

    if (previerMasterBox) {
        previerMasterBox.style.filter = 'none';
        
        if (tipo === 'imagen' && url) {
            previerMasterBox.style.backgroundImage = `url('${url}')`;
            previerMasterBox.style.backgroundSize = 'cover';
            previerMasterBox.style.backgroundPosition = 'center';
        } else if (tipo === 'video' && url) {
            previerMasterBox.style.backgroundImage = `url('img/backgrounds/video-placeholder.jpg')`;
            previerMasterBox.style.backgroundSize = 'cover';
            previerMasterBox.style.backgroundPosition = 'center';
        } else if (tipo === 'gradiente') {
            previerMasterBox.style.backgroundImage = `linear-gradient(135deg, ${colorInicio}, ${colorFin})`;
            previerMasterBox.style.backgroundSize = 'cover';
            previerMasterBox.style.backgroundPosition = 'center';
        } else {
            previerMasterBox.style.backgroundImage = `url('img/backgrounds/img_background_2.jpg')`;
            previerMasterBox.style.backgroundSize = 'cover';
            previerMasterBox.style.backgroundPosition = 'center';
        }
        
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

    // Variable para controlar si el cambio viene de Firebase
    let ignorarSiguienteCambio = false;

    notaDOM.textarea?.addEventListener('input', (e) => {
        if (ignorarSiguienteCambio) return;
        
        const texto = e.target.value;
        actualizarContadorCaracteres(texto, notaDOM);
        
        if (estado.isAuthenticated && currentUser && db) {
            // Cambiar ícono a "sincronizando"
            notaDOM.syncIcon.style.animation = 'girar 1s infinite linear';
            notaDOM.syncText.textContent = 'Guardando...';
            
            // Guardar en tiempo real
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

    // Inicializar listener de tiempo real para notas
    if (estado.isAuthenticated && currentUser && db) {
        iniciarListenerNotas(notaDOM);
    }
}

// ===== FUNCIÓN NUEVA: Listener en tiempo real para notas =====
function iniciarListenerNotas(notaDOM) {
    if (!currentUser || !userDocRef || !db) return;

    // Variable para evitar bucles
    let ignorarSiguienteCambio = false;

    // Escuchar cambios en el documento del usuario
    const unsubscribe = userDocRef.onSnapshot((doc) => {
        if (!doc.exists) return;
        
        const data = doc.data();
        if (!data || !data.notas) return;

        // Verificar si hay cambios en las notas
        const notasFirebase = data.notas;
        let hayCambios = false;

        for (let i = 1; i <= 5; i++) {
            const notaFirebase = notasFirebase[`nota${i}`];
            if (notaFirebase !== undefined && notaFirebase !== notaEstado.notas[i].contenido) {
                notaEstado.notas[i].contenido = notaFirebase;
                hayCambios = true;
            }
        }

        // Si hay cambios y la nota actual es la que se modificó, actualizar el textarea
        if (hayCambios) {
            ignorarSiguienteCambio = true;
            
            // Actualizar la nota actual si está abierta
            if (notaDOM.modal?.classList.contains('nota-modal-abierto')) {
                const notaActual = notaEstado.notaActual;
                const contenidoFirebase = notasFirebase[`nota${notaActual}`];
                
                if (contenidoFirebase !== undefined && 
                    contenidoFirebase !== notaDOM.textarea.value) {
                    notaDOM.textarea.value = contenidoFirebase;
                    actualizarContadorCaracteres(contenidoFirebase, notaDOM);
                }
            }
            
            // Mostrar indicador de sincronización
            notaDOM.syncIcon.style.animation = 'none';
            notaDOM.syncIcon.style.transform = 'scale(1)';
            notaDOM.syncText.textContent = 'Sincronizado';
            
            setTimeout(() => {
                ignorarSiguienteCambio = false;
            }, 100);
        }
    }, (error) => {
        console.error('Error en listener de notas:', error);
    });

    // Guardar la función para poder cancelarla al cerrar sesión
    window.unsubscribeNotas = unsubscribe;
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
    if (!currentUser || !userDocRef || !db) return;

    try {
        const doc = await userDocRef.get();
        if (doc.exists && doc.data() && doc.data().notas) {
            const data = doc.data();
            for (let i = 1; i <= 5; i++) {
                if (data.notas[`nota${i}`]) {
                    notaEstado.notas[i].contenido = data.notas[`nota${i}`];
                }
            }
            cargarNota(notaEstado.notaActual, notaDOM);
        }
        
        // Iniciar listener de tiempo real después de cargar los datos iniciales
        if (!window.unsubscribeNotas) {
            iniciarListenerNotas(notaDOM);
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
            if (!currentUser || !userDocRef || !db) return;
            
            const updateData = {};
            updateData[`notas.nota${notaNum}`] = texto;
            updateData['metadata.ultimaModificacion'] = firebase.firestore.FieldValue.serverTimestamp();
            
            await userDocRef.set(updateData, { merge: true });
            
            // Actualizar ícono de sincronización
            notaDOM.syncIcon.style.animation = 'none';
            notaDOM.syncIcon.style.transform = 'scale(1)';
            notaDOM.syncText.textContent = 'Sincronizado';
            
        } catch (error) {
            console.error('Error al guardar nota:', error);
            notaDOM.syncIcon.style.animation = 'none';
            notaDOM.syncIcon.innerHTML = '⚠️';
            notaDOM.syncText.textContent = 'Error al guardar';
            
            setTimeout(() => {
                notaDOM.syncIcon.innerHTML = '🔄';
                notaDOM.syncText.textContent = 'Sincronizado';
            }, 3000);
        }
    }, 500); // Reducido a 500ms para mejor feedback
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

// ===== INICIALIZACIÓN PRINCIPAL =====
document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('no-animation');
    
    cachearElementos();
    
    inicializarBarraBusqueda();
    inicializarDobleClickBuscadores(); // NUEVA FUNCIÓN AGREGADA AQUÍ
    inicializarAutenticacion();
    inicializarNota();
    
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
        if (currentUser && currentUser.uid && estado.firebaseInicializado) {
            cargarCategoriasUsuario(currentUser.uid);
            
            // Reiniciar listener de notas
            if (window.unsubscribeNotas) {
                window.unsubscribeNotas();
                window.unsubscribeNotas = null;
            }
            
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
            
            iniciarListenerNotas(notaDOM);
        }
    });

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

/* 1 */