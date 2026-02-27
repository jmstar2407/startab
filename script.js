// script.js - Versión con Autenticación Google Firebase y Datos por Usuario
// Configuración de Firebase
const firebaseConfig = {
    apiKey: "AIzaSyBU8DyN2kRcDq0fxB20qRUXWBHV0E-0d6A",
    authDomain: "startab-44e48.firebaseapp.com",
    projectId: "startab-44e48",
    storageBucket: "startab-44e48.firebasestorage.app",
    messagingSenderId: "874084877753",
    appId: "1:874084877753:web:cf9cbe9a344356dc9be268"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// Habilitar persistencia de sesión
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

// ===== VARIABLES DE AUTENTICACIÓN =====
let currentUser = null;
let userConfigRef = null;
let unsubscribeUserConfig = null;

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
    settings: {
        buscadorActual: 'google',
        filtroActual: 'web'
    },
    metadata: {
        ultimaModificacion: null,
        version: "1.0"
    }
};

// ===== NOTAS =====
const NOTA_CONFIG = {
    coleccion: 'users'
};

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
    buscadorActual: localStorage.getItem('buscadorSeleccionado') || 'google',
    filtroActual: 'web',
    iconoSeleccionadoIndex: null,
    elementoArrastrado: null,
    iconosActuales: [],
    isAuthenticated: false
};

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

// ===== UTILIDADES =====
const debounce = (fn, delay) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
};

const convertirABase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
});

// ===== FUNCIONES DE AUTENTICACIÓN =====
function inicializarAutenticacion() {
    // Escuchar cambios en el estado de autenticación
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            // Usuario autenticado
            currentUser = user;
            estado.isAuthenticated = true;

            // Actualizar UI
            actualizarUIAutenticacion(user);

            // Sincronizar perfil con Firestore
            await sincronizarPerfilUsuario(user);

            // Cargar configuración del usuario desde Firestore
            await cargarConfiguracionUsuario(user.uid);

            // Habilitar edición
            habilitarEdicion(true);

            console.log('Usuario autenticado:', user.displayName);
        } else {
            // Usuario no autenticado
            currentUser = null;
            estado.isAuthenticated = false;

            // Actualizar UI
            actualizarUIAutenticacion(null);

            // Desuscribirse deconfiguración anterior
            if (unsubscribeUserConfig) {
                unsubscribeUserConfig();
                unsubscribeUserConfig = null;
            }

            // Cargar configuración por defecto (local)
            await cargarConfiguracionLocal();

            // Deshabilitar edición
            habilitarEdicion(false);

            console.log('Usuario no autenticado');
        }
    });

    // Event listeners para botones de auth
    DOM.authBtn?.addEventListener('click', iniciarSesionGoogle);
    DOM.logoutBtn?.addEventListener('click', cerrarSesion);

    // Cerrar dropdown al hacer clic fuera
    document.addEventListener('click', (e) => {
        if (DOM.userMenu && !DOM.userMenu.contains(e.target)) {
            DOM.userDropdown.style.display = 'none';
        }
    });

    // Toggle dropdown al hacer clic en el avatar
    DOM.userAvatar?.addEventListener('click', (e) => {
        e.stopPropagation();
        const display = DOM.userDropdown.style.display;
        DOM.userDropdown.style.display = display === 'none' ? 'block' : 'none';
    });
}

function actualizarUIAutenticacion(user) {
    if (user) {
        // Mostrar avatar y ocultar botón de login
        DOM.authBtn.style.display = 'none';
        DOM.userMenu.style.display = 'flex';

        // Actualizar información del usuario
        DOM.userAvatar.src = user.photoURL || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23667eea"><circle cx="12" cy="12" r="10"/></svg>';
        DOM.userName.textContent = user.displayName || 'Usuario';
        DOM.userEmail.textContent = user.email || '';
    } else {
        // Mostrar botón de login y ocultar avatar
        DOM.authBtn.style.display = 'flex';
        DOM.userMenu.style.display = 'none';
        DOM.userAvatar.src = '';
        DOM.userName.textContent = '';
        DOM.userEmail.textContent = '';
    }
}

async function iniciarSesionGoogle() {
    try {
        DOM.authBtn.disabled = true;
        DOM.authBtn.innerHTML = '<span class="auth-btn-text">Cargando...</span>';

        const result = await auth.signInWithPopup(googleProvider);

        console.log('Inicio de sesión exitoso:', result.user.displayName);
    } catch (error) {
        console.error('Error al iniciar sesión:', error);

        let mensajeError = 'Error al iniciar sesión';
        if (error.code === 'auth/popup-closed-by-user') {
            mensajeError = 'Ventana cerrada por el usuario';
        } else if (error.code === 'auth/account-exists-with-different-credential') {
            mensajeError = 'Ya existe una cuenta con diferente método de autenticación';
        }

        alert(mensajeError);
    } finally {
        DOM.authBtn.disabled = false;
        DOM.authBtn.innerHTML = '<span class="auth-btn-text">Iniciar sesión</span>';
    }
}

async function cerrarSesion() {
    try {
        await auth.signOut();
        DOM.userDropdown.style.display = 'none';
        console.log('Sesión cerrada');
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
    }
}

async function sincronizarPerfilUsuario(user) {
    if (!user || !user.uid) return;

    try {
        const userDocRef = db.collection('users').doc(user.uid);
        const doc = await userDocRef.get();

        if (doc.exists) {
            const data = doc.data();
            // Actualizar photoURL si ha cambiado en Google
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
            // Crear documento de usuario con perfil
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

// ===== CONFIGURACIÓN POR USUARIO =====
async function cargarConfiguracionUsuario(uid) {
    try {
        // Desuscribirse deconfiguración anterior si existe
        if (unsubscribeUserConfig) {
            unsubscribeUserConfig();
        }

        // Referencia al documento del usuario
        userConfigRef = db.collection('users').doc(uid);

        // Escuchar cambios en tiempo real
        unsubscribeUserConfig = userConfigRef.onSnapshot(async (doc) => {
            if (doc.exists) {
                const data = doc.data();

                // ── Cambio originado en ESTE dispositivo ─────────────────────────────
                // hasPendingWrites = true → el cliente aún no recibió confirmación del servidor.
                // Significa que este snapshot es el eco de nuestra propia escritura, ya aplicada
                // localmente. Solo actualizamos memoria y mostramos "Guardando...".
                const esCambioLocal = doc.metadata.hasPendingWrites;

                if (esCambioLocal) {
                    // Sincronizar datos en memoria (sin tocar el DOM)
                    if (data.categorias && data.categorias.length > 0) {
                        categoriasPersonalizadas = data.categorias;
                    }
                    if (data.settings) {
                        if (data.settings.buscadorActual) estado.buscadorActual = data.settings.buscadorActual;
                        if (data.settings.filtroActual)   estado.filtroActual   = data.settings.filtroActual;
                    }
                    mostrarIndicadorSync('guardando');
                    return; // Cambio ya aplicado localmente → no re-renderizar
                }

                // ── Confirmación del servidor (o cambio desde otro dispositivo) ─────
                mostrarIndicadorSync('guardado');

                // Cargar categorías
                if (data.categorias && data.categorias.length > 0) {
                    categoriasPersonalizadas = data.categorias;
                } else {
                    // Nueva configuración por defecto
                    categoriasPersonalizadas = [
                        {
                            ...CATEGORIA_GENERAL,
                            accesos: obtenerIconosPorDefecto()
                        }
                    ];
                    await guardarConfiguracionCompleta();
                }

                // Cargar notas
                if (data.notas) {
                    for (let i = 1; i <= 5; i++) {
                        if (data.notas[`nota${i}`]) {
                            notaEstado.notas[i].contenido = data.notas[`nota${i}`];
                        }
                    }
                }

                // Cargar configuración del buscador
                if (data.settings) {
                    if (data.settings.buscadorActual) {
                        estado.buscadorActual = data.settings.buscadorActual;
                        localStorage.setItem('buscadorSeleccionado', estado.buscadorActual);
                    }
                    if (data.settings.filtroActual) {
                        estado.filtroActual = data.settings.filtroActual;
                    }
                }

                // Validar categoría actual
                if (!categoriasPersonalizadas.some(c => c.id === estado.categoriaActual)) {
                    estado.categoriaActual = 'general';
                    localStorage.setItem('categoriaSeleccionada', 'general');
                }

                // Actualizar estado.iconosActuales
                const categoriaActual = categoriasPersonalizadas.find(c => c.id === estado.categoriaActual);
                estado.iconosActuales = categoriaActual?.accesos || [];

                // Renderizar
                renderizarCategorias();
                actualizarBuscadorUI();
                actualizarPlaceholder();
                aplicarFondoCategoria(estado.categoriaActual);
                await renderizarIconos();

                // Actualizar notas si el modal está abierto
                const notaDOM = {
                    textarea: document.getElementById('nota-textarea')
                };
                if (notaDOM.textarea) {
                    cargarNota(notaEstado.notaActual, notaDOM);
                }

                console.log('Configuración sincronizada desde Firestore');
            } else {
                // Primer inicio de sesión - crear configuración por defecto
                console.log('Creando configuración por defecto para nuevo usuario');
                await crearConfiguracionPorDefecto(uid);
            }
        }, (error) => {
            console.error('Error al escuchar configuración:', error);
            mostrarIndicadorSync('error');
            cargarConfiguracionLocal();
        });

    } catch (error) {
        console.error('Error al cargar configuración de usuario:', error);
        await cargarConfiguracionLocal();
    }
}

async function crearConfiguracionPorDefecto(uid) {
    try {
        const configInicial = { ...CONFIG_DEFAULT };
        configInicial.profile = {
            displayName: currentUser?.displayName || 'Usuario',
            email: currentUser?.email || '',
            photoURL: currentUser?.photoURL || ''
        };

        await db.collection('users').doc(uid).set(configInicial);
        console.log('Configuración por defecto creada');
    } catch (error) {
        console.error('Error al crear configuración por defecto:', error);
    }
}

async function cargarConfiguracionLocal() {
    // Cargar configuración por defecto sin usuario
    categoriasPersonalizadas = [
        {
            ...CATEGORIA_GENERAL,
            accesos: obtenerIconosPorDefecto()
        }
    ];

    // Reiniciar notas
    for (let i = 1; i <= 5; i++) {
        notaEstado.notas[i].contenido = '';
    }

    // Renderizar
    renderizarCategorias();
    await aplicarFondoCategoria(estado.categoriaActual);
    await renderizarIconos();

    console.log('Configuración local cargada');
}

// ===== INDICADOR DE SINCRONIZACIÓN =====
let _syncHideTimeout = null;

function mostrarIndicadorSync(estado) {
    let indicator = document.getElementById('sync-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'sync-indicator';
        indicator.style.cssText = `
            position: fixed;
            bottom: 18px;
            left: 18px;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 0.3px;
            pointer-events: none;
            z-index: 9999;
            transition: opacity 0.35s ease, transform 0.35s ease;
            opacity: 0;
            transform: translateY(6px);
        `;
        document.body.appendChild(indicator);
    }

    clearTimeout(_syncHideTimeout);

    if (estado === 'guardando') {
        indicator.textContent = '⏳ Guardando...';
        indicator.style.background = 'rgba(30,30,50,0.82)';
        indicator.style.color = '#a5b4fc';
        indicator.style.border = '1px solid rgba(165,180,252,0.25)';
        indicator.style.opacity = '1';
        indicator.style.transform = 'translateY(0)';
    } else if (estado === 'guardado') {
        indicator.textContent = '✓ Guardado';
        indicator.style.background = 'rgba(20,40,30,0.82)';
        indicator.style.color = '#6ee7b7';
        indicator.style.border = '1px solid rgba(110,231,183,0.25)';
        indicator.style.opacity = '1';
        indicator.style.transform = 'translateY(0)';
        _syncHideTimeout = setTimeout(() => {
            indicator.style.opacity = '0';
            indicator.style.transform = 'translateY(6px)';
        }, 2000);
    } else if (estado === 'error') {
        indicator.textContent = '✗ Error al guardar';
        indicator.style.background = 'rgba(50,20,20,0.82)';
        indicator.style.color = '#fca5a5';
        indicator.style.border = '1px solid rgba(252,165,165,0.25)';
        indicator.style.opacity = '1';
        indicator.style.transform = 'translateY(0)';
        _syncHideTimeout = setTimeout(() => {
            indicator.style.opacity = '0';
            indicator.style.transform = 'translateY(6px)';
        }, 4000);
    }
}

// ===== GUARDADO EN FIREBASE =====
async function guardarConfiguracionCompleta() {
    if (!currentUser || !userConfigRef) return;
    mostrarIndicadorSync('guardando');
    try {
        await userConfigRef.set({
            categorias: categoriasPersonalizadas,
            metadata: {
                ultimaModificacion: firebase.firestore.FieldValue.serverTimestamp(),
                version: '1.0'
            }
        }, { merge: true });
        // El indicador "guardado" lo mostrará el onSnapshot cuando llegue la confirmación
    } catch (error) {
        console.error('Error al guardar configuración:', error);
        mostrarIndicadorSync('error');
    }
}

async function guardarConfiguracionNotas() {
    try {
        if (currentUser && userConfigRef) {
            const notasData = {};
            for (let i = 1; i <= 5; i++) {
                notasData[`nota${i}`] = notaEstado.notas[i].contenido || '';
            }

            await userConfigRef.set({
                notas: notasData,
                metadata: {
                    ultimaModificacion: firebase.firestore.FieldValue.serverTimestamp()
                }
            }, { merge: true });
        }
    } catch (error) {
        console.error('Error al guardar notas:', error);
    }
}

async function guardarConfiguracionBuscador() {
    if (!currentUser || !userConfigRef) return;
    mostrarIndicadorSync('guardando');
    try {
        await userConfigRef.set({
            settings: {
                buscadorActual: estado.buscadorActual,
                filtroActual: estado.filtroActual
            },
            metadata: {
                ultimaModificacion: firebase.firestore.FieldValue.serverTimestamp()
            }
        }, { merge: true });
    } catch (error) {
        console.error('Error al guardar configuración de buscador:', error);
        mostrarIndicadorSync('error');
    }
}

// ===== HABILITAR/DESABILITAR EDICIÓN =====
function habilitarEdicion(habilitar) {
    // Botón agregar acceso directo
    if (DOM.btnAgregar) {
        DOM.btnAgregar.style.display = habilitar ? 'flex' : 'none';
    }

    // Botón personalizar fondo
    if (DOM.btnPersonalizar) {
        DOM.btnPersonalizar.style.display = habilitar ? 'flex' : 'none';
    }

    // Categorías - agregar nueva
    const btnAgregarCategoria = document.getElementById('btn-agregar-categoria');
    if (btnAgregarCategoria) {
        btnAgregarCategoria.style.display = habilitar ? 'inline-flex' : 'none';
    }

    // Menú contextual para editar/eliminar iconos
    // Esto se maneja en el renderizado de iconos

    // Actualizar estado
    estado.isAuthenticated = habilitar;

    console.log('Edición', habilitar ? 'habilitada' : 'deshabilitada');
}

// ===== FUNCIONES DE CATEGORÍAS =====

// Flag para asegurarse de que los listeners del contenedor se registren UNA SOLA VEZ
let _categoriasListenersInit = false;

function inicializarListenersCategorias() {
    if (_categoriasListenersInit) return;
    const container = document.querySelector('.categorias-container');
    if (!container) return;

    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.categoria-btn[data-categoria]');
        if (btn) {
            cambiarCategoria(btn.dataset.categoria);
            return;
        }
        const addBtn = e.target.closest('#btn-agregar-categoria');
        if (addBtn) {
            agregarCategoria();
        }
    });

    container.addEventListener('contextmenu', (e) => {
        const wrapper = e.target.closest('.categoria-wrapper');
        if (wrapper) {
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

    // Botón para agregar nueva categoría (si no se ha alcanzado el límite)
    if (categoriasPersonalizadas.length < MAX_CATEGORIAS) {
        html += `
            <button class="categoria-btn agregar-categoria-btn" id="btn-agregar-categoria">
                <span class="agregar-icono">+</span>
            </button>
        `;
    }

    container.innerHTML = html;

    // Registrar listeners solo la primera vez (evita acumulación con cada render)
    inicializarListenersCategorias();
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
    
    // Cargar los iconos de la nueva categoría
    const nuevaCategoria = categoriasPersonalizadas.find(c => c.id === categoriaId);
    estado.iconosActuales = nuevaCategoria?.accesos || [];
    
    actualizarCategoriasUI();
    // No await: el token interno cancela transiciones obsoletas si el usuario cambia rápido
    aplicarFondoCategoria(categoriaId);
    await renderizarIconos();
}

function mostrarMenuContextualCategoria(event, categoriaId) {
    // Verificar si el usuario está autenticado
    if (!estado.isAuthenticated) {
        // Cerrar menú contextual existente
        document.querySelector('.menu-contextual-categoria')?.remove();

        const menu = document.createElement('div');
        menu.className = 'menu-contextual menu-contextual-categoria';
        menu.style.cssText = `left:${event.clientX}px;top:${event.clientY}px`;
        menu.innerHTML = `
            <div class="menu-item" style="cursor: default;">
                <span class="menu-icono">🔒</span>Inicia sesión para editar
            </div>
        `;

        document.body.appendChild(menu);

        setTimeout(() => {
            menu.remove();
        }, 2000);

        return;
    }

    // Cerrar menú contextual existente
    document.querySelector('.menu-contextual-categoria')?.remove();

    const categoria = categoriasPersonalizadas.find(c => c.id === categoriaId);
    if (!categoria) return;

    // Crear el menú pero oculto temporalmente para medir
    const menu = document.createElement('div');
    menu.className = 'menu-contextual menu-contextual-categoria';
    menu.style.cssText = 'visibility:hidden;position:fixed;';
    menu.innerHTML = `
        <div class="menu-item" data-action="editar-categoria" data-categoria-id="${categoriaId}">
            <span class="menu-icono">✏️</span>Editar categoría
        </div>
        <div class="menu-item" data-action="eliminar-categoria" data-categoria-id="${categoriaId}">
            <span class="menu-icono">🗑️</span>Eliminar categoría
        </div>
    `;

    document.body.appendChild(menu);
    
    // Obtener dimensiones reales
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    
    // Calcular posición
    let left = event.clientX;
    let top = event.clientY;
    
    // Ajustar horizontal
    if (left + menuWidth > window.innerWidth) {
        left = window.innerWidth - menuWidth - 10;
    }
    if (left < 10) {
        left = 10;
    }
    
    // Ajustar vertical - mostrar hacia arriba si no cabe abajo
    if (top + menuHeight > window.innerHeight) {
        top = event.clientY - menuHeight - 5;
    } else {
        top = event.clientY + 5;
    }
    
    // Asegurar que no se salga por arriba
    if (top < 5) {
        top = 5;
    }
    
    // Aplicar posición y hacer visible
    menu.style.cssText = `left:${left}px;top:${top}px;visibility:visible;`;

    // Event listeners
    menu.addEventListener('click', async (e) => {
        const action = e.target.closest('.menu-item')?.dataset.action;
        if (action === 'editar-categoria') {
            await editarCategoria(categoriaId);
        } else if (action === 'eliminar-categoria') {
            await eliminarCategoria(categoriaId);
        }
        menu.remove();
    });

    // Cerrar menú al hacer clic fuera
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

let _agregarCategoriaEnProceso = false;

async function agregarCategoria() {
    // Guard: evitar que se abra el prompt múltiples veces si hay listeners duplicados
    if (_agregarCategoriaEnProceso) return;
    _agregarCategoriaEnProceso = true;

    try {
        const nombre = prompt('Ingresa el nombre de la nueva categoría (máx 20 caracteres):');

        if (nombre === null) return;

        const nombreTrim = nombre.trim();
        if (!nombreTrim) {
            alert('El nombre no puede estar vacío');
            return;
        }

        if (nombreTrim.length > 20) {
            alert('El nombre no puede tener más de 20 caracteres');
            return;
        }

        // Verificar si ya existe una categoría con ese nombre
        if (categoriasPersonalizadas.some(c => c.nombre.toLowerCase() === nombreTrim.toLowerCase())) {
            alert('Ya existe una categoría con ese nombre');
            return;
        }

        // Generar ID único
        const id = 'cat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

        // Usar el fondo de la categoría actual como base para la nueva
        const categoriaActual = categoriasPersonalizadas.find(c => c.id === estado.categoriaActual);
        const fondoBase = categoriaActual && categoriaActual.background ? categoriaActual.background : FONDO_DEFAULT;

        const nuevaCategoria = {
            id: id,
            nombre: nombreTrim,
            editable: true,
            background: { ...fondoBase },
            accesos: []
        };

        categoriasPersonalizadas.push(nuevaCategoria);
        await guardarConfiguracionCompleta();

        renderizarCategorias();
    } finally {
        // Siempre liberar el guard, incluso si hay un error o se canceló
        _agregarCategoriaEnProceso = false;
    }
}

async function editarCategoria(categoriaId) {
    const categoria = categoriasPersonalizadas.find(c => c.id === categoriaId);
    if (!categoria || categoria.editable === false) {
        alert('No puedes editar la categoría General');
        return;
    }
    
    const nuevoNombre = prompt('Editar nombre de la categoría (máx 20 caracteres):', categoria.nombre);
    
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
    
    // Verificar si ya existe otra categoría con ese nombre
    if (categoriasPersonalizadas.some(c => c.id !== categoriaId && c.nombre.toLowerCase() === nombreTrim.toLowerCase())) {
        alert('Ya existe otra categoría con ese nombre');
        return;
    }
    
    categoria.nombre = nombreTrim;
    await guardarConfiguracionCompleta();
    
    renderizarCategorias();
}

async function eliminarCategoria(categoriaId) {
    const categoria = categoriasPersonalizadas.find(c => c.id === categoriaId);
    
    if (!categoria || categoria.editable === false) {
        alert('No puedes eliminar la categoría General');
        return;
    }
    
    if (confirm(`¿Eliminar la categoría "${categoria.nombre}"? Los accesos directos se perderán.`)) {
        const index = categoriasPersonalizadas.findIndex(c => c.id === categoriaId);
        if (index !== -1) {
            categoriasPersonalizadas.splice(index, 1);
            await guardarConfiguracionCompleta();
            
            // Si la categoría actual es la que se eliminó, cambiar a General
            if (estado.categoriaActual === categoriaId) {
                estado.categoriaActual = 'general';
                localStorage.setItem('categoriaSeleccionada', 'general');
                const categoriaGeneral = categoriasPersonalizadas.find(c => c.id === 'general');
                estado.iconosActuales = categoriaGeneral?.accesos || [];
                await aplicarFondoCategoria('general');
                await renderizarIconos();
            }
            
            renderizarCategorias();
        }
    }
}

// ===== FUNCIONES DE ICONOS =====
async function guardarIconosEnFirebase(iconos) {
    try {
        // Actualizar los accesos de la categoría actual
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
    // Los iconos ya deberían estar en estado.iconosActuales
    // Pero por si acaso, recargamos de la categoría actual
    const categoriaActual = categoriasPersonalizadas.find(c => c.id === estado.categoriaActual);
    estado.iconosActuales = categoriaActual?.accesos || [];
    
    // Si es la categoría General y está vacía, cargar iconos por defecto
    if (estado.categoriaActual === 'general' && estado.iconosActuales.length === 0) {
        estado.iconosActuales = obtenerIconosPorDefecto();
        await guardarIconosEnFirebase(estado.iconosActuales);
    }
    
    return estado.iconosActuales;
}

function obtenerIconosPorDefecto() {
    const crearIcono = (nombre, url) => ({
        nombre,
        url,
        icono: `${url}/favicon.ico`,
        estilos: { ...ESTILOS_DEFAULT }
    });

    return [
        crearIcono('Google', 'https://www.google.com'),
        crearIcono('YouTube', 'https://www.youtube.com'),
        crearIcono('Facebook', 'https://www.facebook.com')
    ];
}

// ===== FUNCIONES DE RENDERIZADO =====
async function renderizarIconos() {
    const iconos = await cargarIconosDeFirebase();
    
    DOM.contenedorIconos.style.opacity = '0';
    
    requestAnimationFrame(() => {
        DOM.contenedorIconos.innerHTML = iconos.map((icono, index) => {
            const estilos = { ...ESTILOS_DEFAULT, ...(icono.estilos || {}) };
            const bgColor = estilos.tieneFondo && estilos.colorFondo ? estilos.colorFondo : 'transparent';
            const boxShadow = estilos.tieneFondo ? '0 4px 15px rgba(0,0,0,0.2)' : 'none';
            
            return `
                <a href="${icono.url}" class="icono-item" target="_blank" data-index="${index}"
                   style="animation: aparecerIcono 0.5s cubic-bezier(0.2, 0, 0, 1) ${index * 0.05}s both">
                    <div class="icono-contenedor" style="background-color:${bgColor};border-radius:${estilos.radioBorde}%;width:100px;height:100px;display:flex;align-items:center;justify-content:center;margin-bottom:0.5rem;transition:all 0.3s ease;box-shadow:${boxShadow}">
                        <img src="${icono.icono}" alt="${icono.nombre}" 
                             style="width:${estilos.tamanoIcono}%;height:${estilos.tamanoIcono}%;object-fit:contain"
                             onerror="this.src='https://via.placeholder.com/64?text=${icono.nombre.charAt(0)}'">
                    </div>
                    <span>${icono.nombre}</span>
                </a>
            `;
        }).join('');

        DOM.contenedorIconos.oncontextmenu = e => {
            const item = e.target.closest('.icono-item');
            if (item) {
                e.preventDefault();
                const index = parseInt(item.dataset.index);
                estado.iconoSeleccionadoIndex = index;
                mostrarMenuContextual(e, iconos[index]);
            }
        };

        inicializarDragAndDrop();
        
        DOM.contenedorIconos.style.transition = 'opacity 0.3s ease';
        DOM.contenedorIconos.style.opacity = '1';
    });
}

async function eliminarIcono(index) {
    const iconoElement = document.querySelector(`.icono-item[data-index="${index}"]`);
    
    if (iconoElement) {
        iconoElement.style.animation = 'eliminarIcono 0.5s cubic-bezier(0.2, 0, 0, 1) forwards';
        
        await new Promise(resolve => setTimeout(resolve, 400));
        estado.iconosActuales.splice(index, 1);
        await guardarIconosEnFirebase(estado.iconosActuales);
        await renderizarIconos();
    }
}

// ===== DRAG AND DROP =====
function inicializarDragAndDrop() {
    DOM.contenedorIconos?.querySelectorAll('.icono-item').forEach(item => {
        item.draggable = true;
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragleave', e => e.currentTarget.classList.remove('drag-over'));
        item.addEventListener('drop', handleDrop);
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
    await renderizarIconos();
}

// ===== MENÚ CONTEXTUAL =====
function mostrarMenuContextual(event, icono) {
    // Verificar si el usuario está autenticado
    if (!estado.isAuthenticated) {
        // Mostrar mensaje de que debe iniciar sesión
        document.querySelector('.menu-contextual')?.remove();

        const menu = document.createElement('div');
        menu.className = 'menu-contextual';
        menu.style.cssText = `left:${event.clientX}px;top:${event.clientY}px`;
        menu.innerHTML = `
            <div class="menu-item" style="cursor: default;">
                <span class="menu-icono">🔒</span>Inicia sesión para editar
            </div>
        `;

        document.body.appendChild(menu);

        setTimeout(() => {
            menu.remove();
        }, 2000);

        return;
    }

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

// ===== FUNCIONES DE FONDO =====

// Token global para cancelar transiciones obsoletas al cambiar rápidamente de categoría
let _fondoToken = 0;

async function aplicarFondoCategoria(categoriaId) {
    const categoria = categoriasPersonalizadas.find(c => c.id === categoriaId);
    if (!categoria || !categoria.background) return;

    // Incrementar token — cualquier llamada anterior con token distinto quedará cancelada
    const miToken = ++_fondoToken;

    const fondoConfig = categoria.background;

    // Pre-cargar el recurso según el tipo
    if (fondoConfig.tipo === 'imagen' && fondoConfig.url) {
        await precargarImagen(fondoConfig.url);
    } else if (fondoConfig.tipo === 'video' && fondoConfig.url) {
        await precargarVideo(fondoConfig.url);
    }

    // Si mientras precargábamos llegó un cambio más reciente, cancelar esta transición
    if (miToken !== _fondoToken) return;

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
        video.onstalled = () => resolve();

        video.src = url;

        // Timeout de seguridad
        setTimeout(resolve, 5000);
    });
}

function aplicarFondoConFade(fondoConfig) {
    const DURACION_FADE = 600; // ms - transición suave

    // Capturar token actual de forma síncrona (sin await)
    const tokenEsteFrame = _fondoToken;

    // Limpiar fondos temporales huérfanos de transiciones anteriores
    document.querySelectorAll('[id="fondo-temporal"]').forEach(el => el.remove());

    // Obtener el fondo activo actual
    let fondoActual = document.getElementById('fondo-activo');

    // Crear nuevo fondo
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

    // Insertar delante del actual
    document.body.insertBefore(nuevoFondo, fondoActual || document.body.firstChild);

    // Aplicar estilos al nuevo fondo
    aplicarEstiloFondo(nuevoFondo, fondoConfig, true);

    // Forzar reflow para que la transición funcione
    nuevoFondo.offsetHeight;

    // Iniciar transición de salida del fondo actual (si existe)
    if (fondoActual) {
        fondoActual.style.opacity = '0';
        fondoActual.style.transition = `opacity ${DURACION_FADE}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    }

    // Iniciar transición de entrada del nuevo fondo
    requestAnimationFrame(() => {
        // Si llegó otro cambio mientras esperábamos el frame, cancelar esta transición
        if (tokenEsteFrame !== _fondoToken) {
            nuevoFondo.remove();
            return;
        }
        nuevoFondo.style.opacity = '1';

        // Renombrar y limpiar después de la transición
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

    // Guardar la configuración actual
    window.fondoActualCategoria = fondoConfig;
}

function aplicarEstiloFondo(elemento, config, esTransicion = false) {
    const { tipo, url, colorInicio, colorFin, opacidad, desenfoque } = config;
    const DURACION_FADE = 600;

    // Configuración base
    elemento.style.backdropFilter = 'none';
    elemento.style.filter = 'none';

    // Aplicar desenfoque si existe
    if (desenfoque !== undefined && desenfoque > 0) {
        if (tipo === 'video') {
            // El desenfoque se aplica al video internamente
        } else {
            elemento.style.backdropFilter = `blur(${desenfoque}px)`;
            elemento.style.webkitBackdropFilter = `blur(${desenfoque}px)`;
        }
    }

    switch (tipo) {
        case 'gradiente':
            elemento.style.background = `linear-gradient(135deg, ${colorInicio} 0%, ${colorFin} 100%)`;
            elemento.style.backgroundSize = 'cover';
            elemento.style.backgroundPosition = 'center';
            elemento.style.transition = esTransicion ? `background ${DURACION_FADE}ms ease` : 'none';
            break;

        case 'imagen':
            if (url) {
                const opacidadCapa = opacidad !== undefined ? opacidad : 0.2;
                elemento.style.background = `linear-gradient(rgba(0, 0, 0, ${opacidadCapa}), rgba(0, 0, 0, ${opacidadCapa})), url('${url}')`;
                elemento.style.backgroundSize = 'cover';
                elemento.style.backgroundPosition = 'center';
                elemento.style.backgroundAttachment = 'fixed';
                elemento.style.transition = esTransicion ? `background ${DURACION_FADE}ms ease` : 'none';
            }
            break;

        case 'video':
            if (url) {
                // Remover videos anteriores
                const videoAnterior = elemento.querySelector('video');
                if (videoAnterior) videoAnterior.remove();

                // Crear video optimizado para evitar lag
                const video = document.createElement('video');
                video.className = 'video-fondo';
                video.src = url;
                video.autoplay = true;
                video.loop = true;
                video.muted = true;
                video.playsInline = true;
                video.preload = 'auto';
                video.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    transition: opacity ${DURACION_FADE}ms cubic-bezier(0.4, 0, 0.2, 1);
                `;

                // Aplicar desenfoque al video si está configurado
                if (desenfoque !== undefined && desenfoque > 0) {
                    video.style.filter = `blur(${desenfoque}px)`;
                    video.style.webkitFilter = `blur(${desenfoque}px)`;
                }

                elemento.style.background = '#000';
                elemento.appendChild(video);

                // Reproducir con manejo de errores
                video.play().catch(e => {
                    console.log('Video autoplay bloqueado, intentando con interacción:', e);
                    // Intentar reproducir en el siguiente clic del usuario
                    document.addEventListener('click', function reproducirVideo() {
                        video.play().catch(() => {});
                        document.removeEventListener('click', reproducirVideo);
                    }, { once: true });
                });

                // Transición suave para el video
                video.style.opacity = '0';
                requestAnimationFrame(() => {
                    video.style.opacity = '1';
                });
            }
            break;
    }
}

async function guardarFondoCategoria(nuevaConfiguracion) {
    const categoriaIndex = categoriasPersonalizadas.findIndex(c => c.id === estado.categoriaActual);
    if (categoriaIndex === -1) return;

    // Actualizar el fondo en memoria
    categoriasPersonalizadas[categoriaIndex].background = {
        tipo: nuevaConfiguracion.tipo,
        url: nuevaConfiguracion.url,
        opacidad: nuevaConfiguracion.opacidad,
        desenfoque: nuevaConfiguracion.desenfoque,
        colorInicio: nuevaConfiguracion.colorInicio,
        colorFin: nuevaConfiguracion.colorFin
    };

    // Aplicar visualmente de inmediato (feedback instantáneo)
    aplicarFondoCategoria(estado.categoriaActual);

    // Persistir en Firebase (mostrará indicador automáticamente)
    await guardarConfiguracionCompleta();
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
            guardarConfiguracionBuscador(); // Sincronizar con Firebase en tiempo real
        }
    });

    document.querySelector('.filtros-busqueda')?.addEventListener('click', e => {
        const filtro = e.target.closest('.filtro-item');
        if (filtro) {
            document.querySelectorAll('.filtro-item').forEach(f => f.classList.remove('activo'));
            filtro.classList.add('activo');
            estado.filtroActual = filtro.dataset.filtro;
            DOM.barraBusqueda.focus();
            guardarConfiguracionBuscador(); // Sincronizar con Firebase en tiempo real
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
        elementos.previewImg.src = elementos.icono.value || 'https://via.placeholder.com/64?text=Img';
        actualizarPreviewDesdeModal(elementos);
    });

    elementos.fileInput?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        
        elementos.fileName.textContent = file.name;
        elementos.fileLabel?.classList.add('seleccionado');
        
        try {
            const base64 = await convertirABase64(file);
            elementos.icono.value = base64;
            elementos.previewImg.src = base64;
            if (elementos.fileText) elementos.fileText.textContent = 'Imagen seleccionada';
        } catch (error) {
            console.error('Error al convertir imagen:', error);
            alert('Error al cargar la imagen.');
        }
    });

    elementos.guardarBtn?.addEventListener('click', async () => {
        const nombre = elementos.nombre.value;
        const url = elementos.url.value;
        let icono = elementos.icono.value;
        const index = estado.iconoSeleccionadoIndex;

        if (!nombre || !url) {
            alert('Por favor, completa al menos el nombre y la URL');
            return;
        }

        if (!icono) {
            try {
                const urlObj = new URL(url);
                icono = `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;
            } catch {
                icono = 'https://via.placeholder.com/64?text=' + nombre.charAt(0);
            }
        }

        const estilos = {
            tieneFondo: elementos.tieneFondo.checked,
            colorFondo: elementos.colorFondo.value,
            radioBorde: parseInt(elementos.radioBorde.value),
            tamanoIcono: parseInt(elementos.tamanoIcono.value)
        };

        if (index !== null && index >= 0) {
            // Editar
            estado.iconosActuales[index] = { 
                ...estado.iconosActuales[index],
                nombre, url, icono, estilos
            };
        } else {
            // Agregar nuevo
            estado.iconosActuales.push({ nombre, url, icono, estilos });
        }
        
        await guardarIconosEnFirebase(estado.iconosActuales);
        await renderizarIconos();
        cerrarModalIconos(elementos);
    });

    elementos.cancelarBtn?.addEventListener('click', () => cerrarModalIconos(elementos));
    elementos.cerrarBtn?.addEventListener('click', () => cerrarModalIconos(elementos));

    modal.addEventListener('click', e => {
        if (e.target === modal) cerrarModalIconos(elementos);
    });

    DOM.btnAgregar?.addEventListener('click', () => {
        resetearModalIconos(elementos);
        elementos.titulo.textContent = 'Agregar acceso directo';
        estado.iconoSeleccionadoIndex = null;
        modal.classList.add('modal-abierto');
        modal.style.display = 'flex';
    });
}

function actualizarPreviewDesdeModal(elementos) {
    if (!elementos.previewIcono || !elementos.previewImg) return;
    
    Object.assign(elementos.previewIcono.style, {
        backgroundColor: elementos.tieneFondo.checked ? elementos.colorFondo.value : 'transparent',
        borderRadius: `${elementos.radioBorde.value}%`,
        boxShadow: elementos.tieneFondo.checked ? '0 10px 30px rgba(0,0,0,0.2)' : 'none'
    });
    
    Object.assign(elementos.previewImg.style, {
        width: `${elementos.tamanoIcono.value}%`,
        height: `${elementos.tamanoIcono.value}%`
    });
}

function abrirModalEdicion(index, icono) {
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
}

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
    
    const fileInput = document.getElementById('icono-file');
    const fileName = document.getElementById('file-name');
    const fileText = document.querySelector('.file-text');
    
    if (fileInput) fileInput.value = '';
    if (fileName) fileName.textContent = '';
    document.querySelector('.file-label')?.classList.remove('seleccionado');
    if (fileText) fileText.textContent = 'Seleccionar imagen';
    
    Object.assign(elementos.previewIcono.style, { backgroundColor: 'transparent', borderRadius: '50%', boxShadow: 'none' });
    Object.assign(elementos.previewImg.style, { width: '74%', height: '74%' });
    elementos.previewImg.src = 'https://via.placeholder.com/64?text=Img';
}

function cerrarModalIconos(elementos) {
    const modal = DOM.modalIconos;
    if (!modal) return;
    
    modal.classList.remove('modal-abierto');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
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

    // Opciones predefinidas
    document.querySelectorAll('.opcion-fondo').forEach(opcion => {
        opcion.addEventListener('click', () => {
            const tipo = opcion.dataset.tipo;
            const url = opcion.dataset.url;
            elementos.tipo.value = tipo;
            elementos.url.value = url;
            actualizarSeccionesFondo(elementos);
            actualizarPreviewFondo(elementos);
        });
    });

    elementos.tipo?.addEventListener('change', () => {
        actualizarSeccionesFondo(elementos);
        actualizarPreviewFondo(elementos);
    });

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

    elementos.guardarBtn?.addEventListener('click', () => {
        const opacidadSlider = parseInt(elementos.opacidad.value);
        const opacidadGuardar = (opacidadSlider / 100) * 0.5;
        
        guardarFondoCategoria({
            tipo: elementos.tipo.value,
            url: elementos.url.value || null,
            opacidad: opacidadGuardar,
            desenfoque: parseInt(elementos.desenfoque.value),
            colorInicio: elementos.colorInicio.value,
            colorFin: elementos.colorFin.value
        });
        cerrarModalPersonalizar(modal);
    });

    elementos.cancelarBtn?.addEventListener('click', () => cerrarModalPersonalizar(modal));

    modal.addEventListener('click', e => {
        if (e.target === modal) cerrarModalPersonalizar(modal);
    });

    DOM.btnPersonalizar?.addEventListener('click', () => {
        cargarValoresActualesEnModal(elementos);
        modal.classList.add('modal-personalizar-abierto');
        modal.style.display = 'flex';
    });
}

function cargarValoresActualesEnModal(elementos) {
    // Cargar la configuración del fondo de la categoría actual
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
}

function actualizarSeccionesFondo(elementos) {
    const tipo = elementos.tipo.value;
    
    elementos.grupoColores.style.display = tipo === 'gradiente' ? 'block' : 'none';
    elementos.imagenesSection.style.display = tipo === 'imagen' ? 'block' : 'none';
    elementos.videosSection.style.display = tipo === 'video' ? 'block' : 'none';
}

function actualizarPreviewFondo(elementos) {
    const tipo = elementos.tipo.value;
    const url = elementos.url.value;
    const colorInicio = elementos.colorInicio.value;
    const colorFin = elementos.colorFin.value;
    const opacidadCapa = (parseInt(elementos.opacidad.value) / 100) * 0.5;
    const desenfoquePx = parseInt(elementos.desenfoque.value);

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
        } else {
            elementos.previewFondo.style.backgroundImage = 'none';
            elementos.previewFondo.style.backgroundColor = '#f0f0f0';
        }
        
        elementos.previewFondo.style.filter = `blur(${desenfoquePx}px)`;
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

    cargarNotasDeFirebase(notaDOM);

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
        guardarNotaEnTiempoReal(notaEstado.notaActual, texto, notaDOM);
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
    
    if (!notaEstado.notas[notaEstado.notaActual].sincronizado) {
        guardarNotaEnFirebase(notaEstado.notaActual, notaDOM.textarea.value);
    }
    
    notaEstado.notaActual = notaNum;
    
    notaDOM.notaBtns.forEach(btn => {
        btn.classList.toggle('activo', parseInt(btn.dataset.nota) === notaNum);
    });
    
    cargarNota(notaNum, notaDOM);
    notaDOM.textarea.placeholder = `Nota ${notaNum} - Escribe aquí...`;
}

async function cargarNotasDeFirebase(notaDOM) {
    try {
        // Si no hay usuario autenticado, cargar notas vacías
        if (!currentUser || !userConfigRef) {
            console.log('Usuario no autenticado - mostrando notas locales');
            for (let i = 1; i <= 5; i++) {
                const notaDefault = `📝 Nota ${i}\n\n• Inicia sesión para sincronizar tus notas\n• Se guardarán automáticamente en la nube\n• Accede desde cualquier dispositivo\n\n¡Empieza a escribir! ✨`;
                notaEstado.notas[i].contenido = notaDefault;
            }
            cargarNota(1, notaDOM);
            actualizarEstadoSync('sincronizado', 'Sin sesión', notaDOM);
            return;
        }

        actualizarEstadoSync('sincronizando', 'Cargando...', notaDOM);

        const doc = await userConfigRef.get();

        if (doc.exists && doc.data() && doc.data().notas) {
            const data = doc.data();

            for (let i = 1; i <= 5; i++) {
                if (data.notas[`nota${i}`]) {
                    notaEstado.notas[i].contenido = data.notas[`nota${i}`];
                } else {
                    const notaDefault = `📝 Nota ${i}\n\n• Escribe lo que necesites recordar\n• Se guarda automáticamente\n• Sincronizado con todos tus dispositivos\n• Atajo: Ctrl+${i} para cambiar\n\n¡Empieza a escribir! ✨`;
                    notaEstado.notas[i].contenido = notaDefault;
                }
            }
        } else {
            // Primer usuario - crear notas por defecto
            for (let i = 1; i <= 5; i++) {
                const notaDefault = `📝 Nota ${i}\n\n• Escribe lo que necesites recordar\n• Se guarda automáticamente\n• Sincronizado con todos tus dispositivos\n• Atajo: Ctrl+${i} para cambiar\n\n¡Empieza a escribir! ✨`;
                notaEstado.notas[i].contenido = notaDefault;
            }
            await guardarTodasLasNotasEnFirebase();
        }

        cargarNota(1, notaDOM);
        actualizarEstadoSync('sincronizado', 'Sincronizado', notaDOM);
    } catch (error) {
        console.error('Error al cargar notas:', error);
        actualizarEstadoSync('error', 'Error al cargar', notaDOM);
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
    notaEstado.notas[notaNum].sincronizado = false;
    notaEstado.sincronizado = false;
    actualizarEstadoSync('sincronizando', 'Guardando...', notaDOM);
    
    if (notaTimeouts[notaNum]) clearTimeout(notaTimeouts[notaNum]);
    
    notaTimeouts[notaNum] = setTimeout(async () => {
        try {
            await guardarNotaEnFirebase(notaNum, texto);
            notaEstado.notas[notaNum].sincronizado = true;
            
            let todasSincronizadas = true;
            for (let i = 1; i <= 5; i++) {
                if (!notaEstado.notas[i].sincronizado) {
                    todasSincronizadas = false;
                    break;
                }
            }
            
            if (todasSincronizadas) {
                notaEstado.sincronizado = true;
                actualizarEstadoSync('sincronizado', 'Sincronizado', notaDOM);
            }
        } catch (error) {
            console.error('Error al guardar nota:', error);
            actualizarEstadoSync('error', 'Error al guardar', notaDOM);
        }
    }, 1000);
}

async function guardarNotaEnFirebase(notaNum, texto) {
    try {
        // Solo guardar si hay usuario autenticado
        if (!currentUser || !userConfigRef) {
            console.log('Nota guardada solo en memoria (sin usuario)');
            return;
        }

        notaEstado.notas[notaNum].contenido = texto;

        const updateData = {};
        updateData[`notas.nota${notaNum}`] = texto;
        updateData['metadata.ultimaModificacion'] = firebase.firestore.FieldValue.serverTimestamp();

        await userConfigRef.set(updateData, { merge: true });
    } catch (error) {
        throw error;
    }
}

async function guardarTodasLasNotasEnFirebase() {
    try {
        // Solo guardar si hay usuario autenticado
        if (!currentUser || !userConfigRef) {
            console.log('Notas guardadas solo en memoria (sin usuario)');
            return;
        }

        const notasData = {};
        for (let i = 1; i <= 5; i++) {
            if (notaEstado.notas[i] && notaEstado.notas[i].contenido) {
                notasData[`notas.nota${i}`] = notaEstado.notas[i].contenido;
            }
        }

        notasData['metadata.ultimaModificacion'] = firebase.firestore.FieldValue.serverTimestamp();

        await userConfigRef.set(notasData, { merge: true });
    } catch (error) {
        console.error('Error al guardar todas las notas:', error);
        throw error;
    }
}

function actualizarContadorCaracteres(texto, notaDOM) {
    if (!notaDOM.charCount) return;
    
    const caracteres = texto.length;
    const palabras = texto.trim() ? texto.trim().split(/\s+/).length : 0;
    
    notaDOM.charCount.textContent = `${caracteres} caracteres · ${palabras} palabras`;
    
    if (caracteres > 500000) {
        notaDOM.charCount.style.color = '#f87171';
    } else if (caracteres > 400000) {
        notaDOM.charCount.style.color = '#fbbf24';
    } else {
        notaDOM.charCount.style.color = 'rgb(0 229 255 / 94%)';
    }
}

function actualizarEstadoSync(estado, texto, notaDOM) {
    if (!notaDOM.syncIcon || !notaDOM.syncText) return;
    
    notaDOM.syncIcon.classList.remove('sincronizando', 'sincronizado', 'error');
    
    switch(estado) {
        case 'sincronizando':
            notaDOM.syncIcon.classList.add('sincronizando');
            notaDOM.syncIcon.textContent = '🔄';
            break;
        case 'sincronizado':
            notaDOM.syncIcon.classList.add('sincronizado');
            notaDOM.syncIcon.textContent = '✅';
            break;
        case 'error':
            notaDOM.syncIcon.classList.add('error');
            notaDOM.syncIcon.textContent = '❌';
            break;
    }
    
    notaDOM.syncText.textContent = texto;
}

function abrirModalNota(notaDOM) {
    if (!notaDOM.modal) return;
    
    notaDOM.modal.classList.add('nota-modal-abierto');
    document.body.style.overflow = 'hidden';
    
    setTimeout(() => {
        notaDOM.textarea?.focus();
    }, 300);
    
    notaDOM.icono?.classList.add('nota-icono-click');
    setTimeout(() => {
        notaDOM.icono?.classList.remove('nota-icono-click');
    }, 300);
}

function cerrarModalNota(notaDOM) {
    if (!notaDOM.modal) return;
    
    notaDOM.modal.classList.remove('nota-modal-abierto');
    document.body.style.overflow = '';
    
    if (!notaEstado.notas[notaEstado.notaActual].sincronizado) {
        guardarNotaEnFirebase(notaEstado.notaActual, notaDOM.textarea.value);
    }
}

// ===== INICIALIZACIÓN =====
document.addEventListener('DOMContentLoaded', () => {
    cachearElementos();

    // Inicializar autenticación primero
    // Esto disparará la carga de configuración según el estado del usuario
    inicializarAutenticacion();

    // Inicializar resto de componentes
    inicializarBarraBusqueda();
    inicializarNota();
    inicializarModalIconos();
    inicializarModalPersonalizar();

    // Deshabilitar edición inicialmente (hasta que se verifique auth)
    habilitarEdicion(false);
});
