// script.js - Versión con Autenticación de Google y Datos por Usuario

// ===== CONFIGURACIÓN DE FIREBASE =====
const firebaseConfig = {
    apiKey: "AIzaSyBU8DyN2kRcDq0fxB20qRUXWBHV0E-0d6A",
    authDomain: "startab-44e48.firebaseapp.com",
    projectId: "startab-44e48",
    storageBucket: "startab-44e48.firebasestorage.app",
    messagingSenderId: "874084877753",
    appId: "1:874084877753:web:cf9cbe9a344356dc9be268"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();

// ===== CONSTANTES =====
const CATEGORIAS_PREDETERMINADAS = {
    general: { nombre: 'General', orden: 0 }
};

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
const MAX_CATEGORIAS = 6;

// ===== ICONOS POR DEFECTO (SIN SESIÓN) =====
const ICONOS_PUBLICOS = [
    { nombre: 'Google', url: 'https://www.google.com', icono: 'https://www.google.com/favicon.ico', estilos: { ...ESTILOS_DEFAULT } },
    { nombre: 'YouTube', url: 'https://www.youtube.com', icono: 'https://www.youtube.com/favicon.ico', estilos: { ...ESTILOS_DEFAULT } },
    { nombre: 'Facebook', url: 'https://www.facebook.com', icono: 'https://www.facebook.com/favicon.ico', estilos: { ...ESTILOS_DEFAULT } }
];

// ===== ESTADO DE LA APLICACIÓN =====
const estado = {
    usuario: null,
    autenticado: false,
    categoriaActual: 'general',
    categoriasUsuario: {},
    buscadorActual: localStorage.getItem('buscadorSeleccionado') || 'google',
    filtroActual: 'web',
    iconoSeleccionadoIndex: null,
    elementoArrastrado: null,
    iconosActuales: [...ICONOS_PUBLICOS],
    // Fondos por categoría
    fondos: {
        general: {
            tipo: 'gradiente',
            url: null,
            opacidad: 0.8,
            desenfoque: 0,
            colorInicio: '#667eea',
            colorFin: '#764ba2'
        }
    },
    notas: {
        1: { contenido: '📝 Nota 1\n\n• Inicia sesión para guardar tus notas\n• Las notas se sincronizan automáticamente' },
        2: { contenido: '📝 Nota 2\n\n• Inicia sesión para acceder a todas tus notas' },
        3: { contenido: '📝 Nota 3' },
        4: { contenido: '📝 Nota 4' },
        5: { contenido: '📝 Nota 5' }
    },
    notaActual: 1
};

// ===== CACHÉ DE ELEMENTOS DOM =====
const DOM = {};

// ===== FUNCIONES DE UTILIDAD =====
function cachearElementos() {
    DOM.contenedorIconos = document.getElementById('contenedor-iconos');
    DOM.barraBusqueda = document.getElementById('barra-busqueda');
    DOM.btnBuscar = document.getElementById('btn-buscar');
    DOM.btnLimpiar = document.getElementById('btn-limpiar');
    DOM.btnMicrofono = document.getElementById('btn-microfono');
    DOM.btnAgregar = document.getElementById('btn-agregar');
    DOM.btnPersonalizar = document.getElementById('btn-personalizar');
    DOM.btnLogin = document.getElementById('btn-login');
    DOM.userAvatar = document.getElementById('user-avatar');
    DOM.userMenu = document.getElementById('user-menu');
    DOM.categoriasContainer = document.querySelector('.categorias-container');
    DOM.btnAgregarCategoria = document.getElementById('btn-agregar-categoria');
}

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
function inicializarAuth() {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            // Usuario autenticado
            estado.usuario = user;
            estado.autenticado = true;
            actualizarUIAutenticado(user);
            
            // Cargar datos del usuario
            await cargarDatosUsuario(user.uid);
            
            // Habilitar botones de edición
            habilitarEdicion(true);
        } else {
            // Usuario no autenticado
            estado.usuario = null;
            estado.autenticado = false;
            actualizarUINoAutenticado();
            
            // Restablecer datos públicos
            estado.categoriasUsuario = { ...CATEGORIAS_PREDETERMINADAS };
            estado.categoriaActual = 'general';
            estado.iconosActuales = [...ICONOS_PUBLICOS];
            estado.fondos = {
                general: {
                    tipo: 'gradiente',
                    url: null,
                    opacidad: 0.8,
                    desenfoque: 0,
                    colorInicio: '#667eea',
                    colorFin: '#764ba2'
                }
            };
            
            // Renderizar vista pública
            actualizarCategoriasUI();
            aplicarFondo();
            renderizarIconos();
            
            // Deshabilitar botones de edición
            habilitarEdicion(false);
        }
    });
    
    // Evento del botón de login
    DOM.btnLogin?.addEventListener('click', iniciarSesionGoogle);
    
    // Cerrar menú al hacer clic fuera
    document.addEventListener('click', (e) => {
        if (!DOM.userMenu?.contains(e.target) && !DOM.userAvatar?.contains(e.target)) {
            DOM.userMenu?.classList.remove('visible');
        }
    });
}

function iniciarSesionGoogle() {
    auth.signInWithPopup(provider).catch(error => {
        console.error('Error al iniciar sesión:', error);
        mostrarNotificacionError('Error al iniciar sesión');
    });
}

function cerrarSesion() {
    auth.signOut().catch(error => {
        console.error('Error al cerrar sesión:', error);
        mostrarNotificacionError('Error al cerrar sesión');
    });
    DOM.userMenu?.classList.remove('visible');
}

function actualizarUIAutenticado(user) {
    if (DOM.btnLogin) DOM.btnLogin.style.display = 'none';
    if (DOM.userAvatar) {
        DOM.userAvatar.style.display = 'flex';
        const img = DOM.userAvatar.querySelector('img');
        if (img) {
            img.src = user.photoURL || 'https://via.placeholder.com/32';
            img.alt = user.displayName || 'Usuario';
        }
    }
}

function actualizarUINoAutenticado() {
    if (DOM.btnLogin) DOM.btnLogin.style.display = 'flex';
    if (DOM.userAvatar) DOM.userAvatar.style.display = 'none';
    DOM.userMenu?.classList.remove('visible');
}

function habilitarEdicion(habilitado) {
    const elementos = [
        DOM.btnAgregar,
        DOM.btnPersonalizar,
        DOM.btnAgregarCategoria,
        document.getElementById('nota-icono')
    ];
    
    elementos.forEach(el => {
        if (el) {
            if (habilitado) {
                el.classList.remove('deshabilitado');
                el.removeAttribute('disabled');
                el.title = el.dataset.originalTitle || el.title;
            } else {
                el.classList.add('deshabilitado');
                el.setAttribute('disabled', 'disabled');
                el.dataset.originalTitle = el.title;
                el.title = 'Inicia sesión para usar esta función';
            }
        }
    });
    
    // Deshabilitar menú contextual en iconos
    DOM.contenedorIconos?.classList.toggle('editable', habilitado);
}

function toggleUserMenu() {
    DOM.userMenu?.classList.toggle('visible');
    
    if (DOM.userMenu && estado.usuario) {
        DOM.userMenu.innerHTML = `
            <div class="user-menu-header">
                <img src="${estado.usuario.photoURL || 'https://via.placeholder.com/40'}" alt="Avatar">
                <div>
                    <div class="user-name">${estado.usuario.displayName || 'Usuario'}</div>
                    <div class="user-email">${estado.usuario.email}</div>
                </div>
            </div>
            <div class="user-menu-item" onclick="cerrarSesion()">
                <span class="user-menu-icon">🚪</span>
                Cerrar sesión
            </div>
        `;
    }
}

// ===== FUNCIONES DE DATOS DE USUARIO =====
async function cargarDatosUsuario(uid) {
    try {
        // Referencias a colecciones del usuario
        const userRef = db.collection('usuarios').doc(uid);
        const categoriasRef = userRef.collection('categorias');
        const iconosRef = userRef.collection('iconos');
        const fondosRef = userRef.collection('fondos');
        const notasRef = userRef.collection('notas').doc('principales');
        
        // Cargar categorías
        const categoriasSnapshot = await categoriasRef.get();
        if (categoriasSnapshot.empty) {
            // Crear categoría por defecto
            await categoriasRef.doc('general').set({
                nombre: 'General',
                orden: 0,
                creada: firebase.firestore.FieldValue.serverTimestamp()
            });
            estado.categoriasUsuario = { general: { nombre: 'General', orden: 0 } };
        } else {
            estado.categoriasUsuario = {};
            categoriasSnapshot.forEach(doc => {
                estado.categoriasUsuario[doc.id] = doc.data();
            });
        }
        
        // Establecer primera categoría como actual
        estado.categoriaActual = Object.keys(estado.categoriasUsuario)[0] || 'general';
        
        // Cargar iconos de la categoría actual
        await cargarIconosUsuario(uid, estado.categoriaActual);
        
        // Cargar fondos
        const fondoDoc = await fondosRef.doc(estado.categoriaActual).get();
        if (fondoDoc.exists) {
            estado.fondos[estado.categoriaActual] = fondoDoc.data();
        } else {
            // Guardar fondo por defecto
            await fondosRef.doc(estado.categoriaActual).set(estado.fondos[estado.categoriaActual]);
        }
        
        // Cargar notas
        const notasDoc = await notasRef.get();
        if (notasDoc.exists) {
            estado.notas = notasDoc.data().notas || estado.notas;
        } else {
            await notasRef.set({ notas: estado.notas });
        }
        
        // Actualizar UI
        actualizarCategoriasUI();
        aplicarFondo();
        renderizarIconos();
        cargarNota(estado.notaActual);
        
    } catch (error) {
        console.error('Error al cargar datos del usuario:', error);
        mostrarNotificacionError('Error al cargar tus datos');
    }
}

async function cargarIconosUsuario(uid, categoria) {
    try {
        const userRef = db.collection('usuarios').doc(uid);
        const iconosRef = userRef.collection('iconos').doc(categoria);
        
        const doc = await iconosRef.get();
        if (doc.exists) {
            estado.iconosActuales = doc.data().accesos || [];
        } else {
            // Crear iconos por defecto para esta categoría
            estado.iconosActuales = [
                { nombre: 'Google', url: 'https://www.google.com', icono: 'https://www.google.com/favicon.ico', estilos: { ...ESTILOS_DEFAULT } },
                { nombre: 'YouTube', url: 'https://www.youtube.com', icono: 'https://www.youtube.com/favicon.ico', estilos: { ...ESTILOS_DEFAULT } },
                { nombre: 'Facebook', url: 'https://www.facebook.com', icono: 'https://www.facebook.com/favicon.ico', estilos: { ...ESTILOS_DEFAULT } }
            ];
            await iconosRef.set({ accesos: estado.iconosActuales });
        }
    } catch (error) {
        console.error('Error al cargar iconos:', error);
    }
}

async function guardarIconosUsuario() {
    if (!estado.autenticado || !estado.usuario) return;
    
    try {
        const userRef = db.collection('usuarios').doc(estado.usuario.uid);
        const iconosRef = userRef.collection('iconos').doc(estado.categoriaActual);
        await iconosRef.set({ accesos: estado.iconosActuales });
    } catch (error) {
        console.error('Error al guardar iconos:', error);
        mostrarNotificacionError('Error al guardar los cambios');
    }
}

// ===== FUNCIONES DE CATEGORÍAS =====
function actualizarCategoriasUI() {
    if (!DOM.categoriasContainer) return;
    
    const categoriasArray = Object.entries(estado.categoriasUsuario)
        .sort((a, b) => (a[1].orden || 0) - (b[1].orden || 0));
    
    let html = '';
    categoriasArray.forEach(([id, cat]) => {
        html += `
            <button class="categoria-btn ${id === estado.categoriaActual ? 'activo' : ''}" 
                    data-categoria="${id}">
                ${cat.nombre}
            </button>
        `;
    });
    
    // Agregar botón de nueva categoría (solo si está autenticado y hay menos de MAX_CATEGORIAS)
    if (estado.autenticado && categoriasArray.length < MAX_CATEGORIAS) {
        html += `
            <button class="categoria-btn btn-agregar-categoria" id="btn-agregar-categoria" title="Agregar categoría (máx ${MAX_CATEGORIAS})">
                +
            </button>
        `;
    }
    
    DOM.categoriasContainer.innerHTML = html;
    
    // Reasignar event listeners
    DOM.categoriasContainer.querySelectorAll('.categoria-btn:not(.btn-agregar-categoria)').forEach(btn => {
        btn.addEventListener('click', () => cambiarCategoria(btn.dataset.categoria));
        
        if (estado.autenticado && btn.dataset.categoria !== 'general') {
            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                mostrarMenuCategoria(e, btn.dataset.categoria, btn.textContent);
            });
        }
    });
    
    const btnAgregar = document.getElementById('btn-agregar-categoria');
    if (btnAgregar) {
        btnAgregar.addEventListener('click', mostrarModalNuevaCategoria);
    }
}

async function cambiarCategoria(categoria) {
    if (categoria === estado.categoriaActual) return;
    
    estado.categoriaActual = categoria;
    
    if (estado.autenticado && estado.usuario) {
        await cargarIconosUsuario(estado.usuario.uid, categoria);
        
        // Cargar fondo de la categoría
        const userRef = db.collection('usuarios').doc(estado.usuario.uid);
        const fondoDoc = await userRef.collection('fondos').doc(categoria).get();
        if (fondoDoc.exists) {
            estado.fondos[categoria] = fondoDoc.data();
        } else {
            estado.fondos[categoria] = {
                tipo: 'gradiente',
                url: null,
                opacidad: 0.8,
                desenfoque: 0,
                colorInicio: '#667eea',
                colorFin: '#764ba2'
            };
        }
    }
    
    actualizarCategoriasUI();
    aplicarFondo();
    renderizarIconos();
    mostrarNotificacionCategoria(estado.categoriasUsuario[categoria]?.nombre || categoria);
}

function mostrarMenuCategoria(event, categoriaId, categoriaNombre) {
    const menu = document.createElement('div');
    menu.className = 'menu-contextual';
    menu.style.cssText = `left:${event.clientX}px;top:${event.clientY}px`;
    menu.innerHTML = `
        <div class="menu-item" data-action="editar"><span class="menu-icono">✏️</span>Editar categoría</div>
        <div class="menu-item" data-action="eliminar"><span class="menu-icono">🗑️</span>Eliminar categoría</div>
    `;
    
    document.body.appendChild(menu);
    
    menu.addEventListener('click', async (e) => {
        const action = e.target.closest('.menu-item')?.dataset.action;
        if (action === 'editar') {
            mostrarModalEditarCategoria(categoriaId, categoriaNombre);
        } else if (action === 'eliminar') {
            await eliminarCategoria(categoriaId);
        }
        menu.remove();
    });
    
    setTimeout(() => {
        const cerrar = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', cerrar); } };
        document.addEventListener('click', cerrar);
    }, 100);
}

function mostrarModalNuevaCategoria() {
    const nombre = prompt('Nombre de la nueva categoría:');
    if (nombre && nombre.trim()) {
        crearCategoria(nombre.trim());
    }
}

function mostrarModalEditarCategoria(categoriaId, nombreActual) {
    const nuevoNombre = prompt('Editar nombre de la categoría:', nombreActual);
    if (nuevoNombre && nuevoNombre.trim()) {
        editarCategoria(categoriaId, nuevoNombre.trim());
    }
}

async function crearCategoria(nombre) {
    if (!estado.autenticado || !estado.usuario) {
        mostrarNotificacionError('Debes iniciar sesión');
        return;
    }
    
    const categoriasArray = Object.entries(estado.categoriasUsuario);
    if (categoriasArray.length >= MAX_CATEGORIAS) {
        mostrarNotificacionError(`No puedes tener más de ${MAX_CATEGORIAS} categorías`);
        return;
    }
    
    const id = nombre.toLowerCase().replace(/\s+/g, '_');
    
    if (estado.categoriasUsuario[id]) {
        mostrarNotificacionError('Ya existe una categoría con ese nombre');
        return;
    }
    
    try {
        const nuevaCategoria = {
            nombre,
            orden: categoriasArray.length,
            creada: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        // Guardar en Firebase
        const userRef = db.collection('usuarios').doc(estado.usuario.uid);
        await userRef.collection('categorias').doc(id).set(nuevaCategoria);
        
        // Actualizar estado local
        estado.categoriasUsuario[id] = nuevaCategoria;
        
        // Crear iconos por defecto para la nueva categoría
        const iconosRef = userRef.collection('iconos').doc(id);
        await iconosRef.set({ accesos: [...ICONOS_PUBLICOS] });
        
        // Crear fondo por defecto
        const fondosRef = userRef.collection('fondos').doc(id);
        await fondosRef.set({
            tipo: 'gradiente',
            url: null,
            opacidad: 0.8,
            desenfoque: 0,
            colorInicio: '#667eea',
            colorFin: '#764ba2'
        });
        
        actualizarCategoriasUI();
        mostrarNotificacionExitosa('Categoría creada');
        
    } catch (error) {
        console.error('Error al crear categoría:', error);
        mostrarNotificacionError('Error al crear la categoría');
    }
}

async function editarCategoria(categoriaId, nuevoNombre) {
    if (!estado.autenticado || !estado.usuario) return;
    
    try {
        const userRef = db.collection('usuarios').doc(estado.usuario.uid);
        await userRef.collection('categorias').doc(categoriaId).update({
            nombre: nuevoNombre
        });
        
        estado.categoriasUsuario[categoriaId].nombre = nuevoNombre;
        actualizarCategoriasUI();
        mostrarNotificacionExitosa('Categoría actualizada');
        
    } catch (error) {
        console.error('Error al editar categoría:', error);
        mostrarNotificacionError('Error al editar la categoría');
    }
}

async function eliminarCategoria(categoriaId) {
    if (!estado.autenticado || !estado.usuario) return;
    if (categoriaId === 'general') {
        mostrarNotificacionError('No puedes eliminar la categoría General');
        return;
    }
    
    if (!confirm(`¿Eliminar categoría "${estado.categoriasUsuario[categoriaId]?.nombre}"?`)) return;
    
    try {
        const userRef = db.collection('usuarios').doc(estado.usuario.uid);
        
        // Eliminar documentos de la categoría
        await userRef.collection('categorias').doc(categoriaId).delete();
        await userRef.collection('iconos').doc(categoriaId).delete();
        await userRef.collection('fondos').doc(categoriaId).delete();
        
        // Eliminar del estado local
        delete estado.categoriasUsuario[categoriaId];
        
        // Si la categoría actual era la eliminada, cambiar a general
        if (estado.categoriaActual === categoriaId) {
            estado.categoriaActual = 'general';
            await cargarIconosUsuario(estado.usuario.uid, 'general');
        }
        
        actualizarCategoriasUI();
        renderizarIconos();
        aplicarFondo();
        mostrarNotificacionExitosa('Categoría eliminada');
        
    } catch (error) {
        console.error('Error al eliminar categoría:', error);
        mostrarNotificacionError('Error al eliminar la categoría');
    }
}

// ===== FUNCIONES DE FONDO =====
async function guardarFondoEnFirebase(nuevaConfiguracion) {
    if (!estado.autenticado || !estado.usuario) {
        mostrarNotificacionError('Debes iniciar sesión para personalizar');
        return;
    }
    
    try {
        Object.assign(estado.fondos[estado.categoriaActual], nuevaConfiguracion);
        
        const userRef = db.collection('usuarios').doc(estado.usuario.uid);
        await userRef.collection('fondos').doc(estado.categoriaActual).set(estado.fondos[estado.categoriaActual]);
        
        aplicarFondo();
        mostrarNotificacionExitosa('Fondo actualizado');
        
    } catch (error) {
        console.error('Error al guardar fondo:', error);
        mostrarNotificacionError('Error al guardar el fondo');
    }
}

function aplicarFondo() {
    const body = document.body;
    const fondoActual = estado.fondos[estado.categoriaActual] || estado.fondos.general;
    const { tipo, url, colorInicio, colorFin, opacidad, desenfoque } = fondoActual;

    // Crear overlay de transición si no existe
    let overlay = document.querySelector('.fondo-transition-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'fondo-transition-overlay';
        document.body.appendChild(overlay);
    }

    // Configurar el overlay con el nuevo fondo
    if (tipo === 'video' && url) {
        let videoOverlay = overlay.querySelector('video');
        if (!videoOverlay) {
            videoOverlay = document.createElement('video');
            videoOverlay.className = 'video-fondo-overlay';
            videoOverlay.muted = true;
            videoOverlay.loop = true;
            videoOverlay.playsInline = true;
            overlay.appendChild(videoOverlay);
        }

        videoOverlay.src = url;
        videoOverlay.load();
        videoOverlay.play().catch(e => console.log('Error al reproducir video:', e));
        overlay.style.background = 'none';
        overlay.style.opacity = '0';

        const opacidadValor = opacidad !== undefined ? opacidad : 0;
        videoOverlay.style.opacity = 1 - opacidadValor;
        videoOverlay.style.filter = desenfoque ? `blur(${desenfoque}px)` : 'none';

    } else if (tipo === 'imagen' && url) {
        overlay.querySelector('video')?.remove();
        const opacidadCapa = opacidad !== undefined ? opacidad : 0;
        overlay.style.background = `linear-gradient(rgba(0, 0, 0, ${opacidadCapa}), rgba(0, 0, 0, ${opacidadCapa})), url('${url}')`;
        overlay.style.backgroundSize = 'cover';
        overlay.style.backgroundPosition = 'center';
        overlay.style.backgroundAttachment = 'fixed';
        overlay.style.filter = desenfoque ? `blur(${desenfoque}px)` : 'none';
        overlay.style.opacity = '0';

    } else if (tipo === 'gradiente') {
        overlay.querySelector('video')?.remove();
        overlay.style.background = `linear-gradient(135deg, ${colorInicio}, ${colorFin})`;
        overlay.style.filter = desenfoque ? `blur(${desenfoque}px)` : 'none';
        overlay.style.opacity = '0';
    }

    requestAnimationFrame(() => {
        overlay.style.opacity = '1';

        body.dataset.fondoTipo = tipo;
        body.dataset.fondoUrl = url || '';
        body.dataset.fondoColorInicio = colorInicio;
        body.dataset.fondoColorFin = colorFin;

        setTimeout(() => {
            document.querySelector('.video-fondo')?.remove();
            body.classList.remove('fondo-imagen', 'fondo-video');
            body.style.background = '';
            body.style.backdropFilter = '';

            switch (tipo) {
                case 'gradiente':
                    body.style.background = `linear-gradient(135deg, ${colorInicio} 0%, ${colorFin} 100%)`;
                    break;
                case 'imagen':
                    if (url) {
                        body.classList.add('fondo-imagen');
                        const opacidadCapa = opacidad !== undefined ? opacidad : 0;
                        body.style.background = `linear-gradient(rgba(0, 0, 0, ${opacidadCapa}), rgba(0, 0, 0, ${opacidadCapa})), url('${url}')`;
                        body.style.backgroundSize = 'cover';
                        body.style.backgroundPosition = 'center';
                        body.style.backgroundAttachment = 'fixed';
                    }
                    break;
                case 'video':
                    if (url) {
                        body.classList.add('fondo-video');
                        const video = document.createElement('video');
                        Object.assign(video, {
                            className: 'video-fondo',
                            src: url,
                            autoplay: true,
                            loop: true,
                            muted: true,
                            playsInline: true
                        });
                        const opacidadValor = opacidad !== undefined ? opacidad : 0;
                        video.style.opacity = 1 - opacidadValor;
                        body.appendChild(video);
                        video.play().catch(e => console.log('Error al reproducir video:', e));
                    }
                    break;
            }

            if (desenfoque !== undefined && desenfoque > 0) {
                if (tipo === 'video') {
                    const video = document.querySelector('.video-fondo');
                    if (video) video.style.filter = `blur(${desenfoque}px)`;
                } else {
                    body.style.backdropFilter = `blur(${desenfoque}px)`;
                }
            }

            overlay.style.opacity = '0';
        }, 500);
    });
}

// ===== FUNCIONES DE ICONOS =====
async function renderizarIconos() {
    DOM.contenedorIconos.style.opacity = '0';

    requestAnimationFrame(() => {
        DOM.contenedorIconos.innerHTML = estado.iconosActuales.map((icono, index) => {
            const estilos = { ...ESTILOS_DEFAULT, ...(icono.estilos || {}) };
            const bgColor = estilos.tieneFondo && estilos.colorFondo ? estilos.colorFondo : 'transparent';
            const boxShadow = estilos.tieneFondo ? '0 4px 15px rgba(0,0,0,0.2)' : 'none';

            return `
                <a href="${icono.url}" class="icono-item ${estado.autenticado ? 'editable' : ''}" target="_blank" data-index="${index}"
                   style="animation: aparecerIcono 0.5s cubic-bezier(0.2, 0, 0, 1) ${index * 0.05}s both">
                    <div class="icono-contenedor" style="background-color:${bgColor};border-radius:${estilos.radioBorde}%;width:100px;height:100px;display:flex;align-items:center;justify-content:center;margin-bottom:0.5rem;transition:all 0.3s ease;box-shadow:${boxShadow}">
                        <img src="${icono.icono}" alt="${icono.nombre}" 
                             style="width:${estilos.tamanoIcono}%;height:${estilos.tamanoIcono}%;object-fit:contain"
                             onerror="this.src='https://via.placeholder.com/64'">
                    </div>
                    <span>${icono.nombre}</span>
                </a>
            `;
        }).join('');

        if (estado.autenticado) {
            DOM.contenedorIconos.oncontextmenu = e => {
                const item = e.target.closest('.icono-item');
                if (item) {
                    e.preventDefault();
                    const index = parseInt(item.dataset.index);
                    estado.iconoSeleccionadoIndex = index;
                    mostrarMenuContextual(e, estado.iconosActuales[index]);
                }
            };
        } else {
            DOM.contenedorIconos.oncontextmenu = null;
        }

        inicializarDragAndDrop();

        DOM.contenedorIconos.style.transition = 'opacity 0.3s ease';
        DOM.contenedorIconos.style.opacity = '1';
    });
}

function inicializarDragAndDrop() {
    if (!estado.autenticado) return;
    
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

    if (estado.autenticado) {
        await guardarIconosUsuario();
    }
    await renderizarIconos();
}

function mostrarMenuContextual(event, icono) {
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
        const cerrar = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', cerrar); } };
        document.addEventListener('click', cerrar);
    }, 100);
}

async function eliminarIcono(index) {
    const iconoElement = document.querySelector(`.icono-item[data-index="${index}"]`);

    if (iconoElement) {
        iconoElement.style.animation = 'eliminarIcono 0.5s cubic-bezier(0.2, 0, 0, 1) forwards';

        await new Promise(resolve => setTimeout(resolve, 400));
        estado.iconosActuales.splice(index, 1);
        
        if (estado.autenticado) {
            await guardarIconosUsuario();
        }
        await renderizarIconos();
    }
}

async function agregarIcono(nombre, url, icono, estilos) {
    if (!estado.autenticado) {
        mostrarNotificacionError('Debes iniciar sesión para agregar accesos directos');
        return;
    }
    
    estado.iconosActuales.push({
        nombre,
        url,
        icono,
        estilos: { ...ESTILOS_DEFAULT, ...estilos }
    });
    
    await guardarIconosUsuario();
    await renderizarIconos();
}

async function guardarEdicion(index, estilos) {
    const nombre = document.getElementById('nombre-sitio').value;
    const url = document.getElementById('url-sitio').value;
    let icono = document.getElementById('icono-sitio').value;

    if (!nombre || !url) {
        alert('Por favor, completa al menos el nombre y la URL');
        return;
    }

    if (!icono) {
        try {
            const urlObj = new URL(url);
            icono = `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;
        } catch {
            icono = 'https://via.placeholder.com/64';
        }
    }

    estado.iconosActuales[index] = {
        ...estado.iconosActuales[index],
        nombre,
        url,
        icono,
        estilos: { ...ESTILOS_DEFAULT, ...estilos }
    };

    if (estado.autenticado) {
        await guardarIconosUsuario();
    }
    await renderizarIconos();
    cerrarModalModerno();
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

    notaDOM.icono?.addEventListener('click', () => abrirModalNota(notaDOM));
    notaDOM.cerrar?.addEventListener('click', () => cerrarModalNota(notaDOM));
    notaDOM.copiarBtn?.addEventListener('click', () => copiarNota(notaDOM));

    notaDOM.modal?.addEventListener('click', (e) => {
        if (e.target === notaDOM.modal) cerrarModalNota(notaDOM);
    });

    notaDOM.textarea?.addEventListener('input', (e) => {
        const texto = e.target.value;
        actualizarContadorCaracteres(texto, notaDOM);
        
        if (estado.autenticado) {
            guardarNotaEnTiempoReal(estado.notaActual, texto, notaDOM);
        } else {
            // Guardar solo localmente sin sesión
            estado.notas[estado.notaActual].contenido = texto;
        }
    });

    notaDOM.notaBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const notaNum = parseInt(btn.dataset.nota);
            cambiarNota(notaNum, notaDOM);
        });
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
    
    // Cargar primera nota
    cargarNota(1, notaDOM);
}

function copiarNota(notaDOM) {
    if (!notaDOM.textarea) return;

    const texto = notaDOM.textarea.value;

    if (!texto || texto.trim() === '') {
        mostrarNotificacionError('La nota está vacía');
        return;
    }

    navigator.clipboard.writeText(texto).then(() => {
        mostrarNotificacionExitosa(`Nota ${estado.notaActual} copiada al portapapeles`);
        notaDOM.copiarBtn.classList.add('copiando');
        setTimeout(() => {
            notaDOM.copiarBtn.classList.remove('copiando');
        }, 300);
    }).catch(err => {
        console.error('Error al copiar:', err);
        mostrarNotificacionError('Error al copiar la nota');
    });
}

function cambiarNota(notaNum, notaDOM) {
    if (notaNum === estado.notaActual) return;

    estado.notaActual = notaNum;

    notaDOM.notaBtns.forEach(btn => {
        btn.classList.toggle('activo', parseInt(btn.dataset.nota) === notaNum);
    });

    cargarNota(notaNum, notaDOM);

    notaDOM.textarea.placeholder = `Nota ${notaNum} - Escribe aquí...`;

    notaDOM.textarea.classList.add('nota-cambiando');
    setTimeout(() => {
        notaDOM.textarea.classList.remove('nota-cambiando');
    }, 300);
}

function cargarNota(notaNum, notaDOM) {
    if (estado.notas[notaNum] && estado.notas[notaNum].contenido) {
        notaDOM.textarea.value = estado.notas[notaNum].contenido;
    } else {
        notaDOM.textarea.value = '';
    }

    actualizarContadorCaracteres(notaDOM.textarea.value, notaDOM);
    
    if (notaDOM.syncIcon) {
        notaDOM.syncIcon.textContent = estado.autenticado ? '🔄' : '⚠️';
        notaDOM.syncText.textContent = estado.autenticado ? 'Listo' : 'Sin sesión';
    }
}

let notaTimeouts = {};
function guardarNotaEnTiempoReal(notaNum, texto, notaDOM) {
    estado.notas[notaNum].contenido = texto;
    
    if (notaTimeouts[notaNum]) clearTimeout(notaTimeouts[notaNum]);

    notaTimeouts[notaNum] = setTimeout(async () => {
        if (!estado.autenticado || !estado.usuario) return;
        
        try {
            const userRef = db.collection('usuarios').doc(estado.usuario.uid);
            await userRef.collection('notas').doc('principales').set({
                notas: estado.notas
            }, { merge: true });
            
            if (notaDOM.syncIcon) {
                notaDOM.syncIcon.textContent = '✅';
                notaDOM.syncText.textContent = 'Guardado';
                setTimeout(() => {
                    notaDOM.syncIcon.textContent = '🔄';
                    notaDOM.syncText.textContent = 'Listo';
                }, 2000);
            }
        } catch (error) {
            console.error('Error al guardar nota:', error);
            if (notaDOM.syncIcon) {
                notaDOM.syncIcon.textContent = '❌';
                notaDOM.syncText.textContent = 'Error';
            }
        }
    }, 1000);
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

// ===== MODALES =====
function abrirModalEdicion(index, icono) {
    const modal = document.querySelector('.modal-moderno');
    if (!modal) return;

    const oldGuardarBtn = document.getElementById('guardar-icono-moderno');
    const newGuardarBtn = oldGuardarBtn.cloneNode(true);
    oldGuardarBtn.parentNode.replaceChild(newGuardarBtn, oldGuardarBtn);

    resetearInputArchivo();

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
        previewIcono: document.querySelector('.preview-icono'),
        previewImg: document.querySelector('.preview-icono img'),
        guardarBtn: newGuardarBtn
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

    const actualizarPreview = () => {
        actualizarPreviewIcono(elementos.previewIcono, elementos.previewImg, elementos.icono.value, {
            tieneFondo: elementos.tieneFondo.checked,
            colorFondo: elementos.colorFondo.value,
            radioBorde: parseInt(elementos.radioBorde.value),
            tamanoIcono: parseInt(elementos.tamanoIcono.value)
        });
    };

    actualizarPreview();

    const handlers = {
        tieneFondo: () => {
            elementos.colorFondoContainer.style.display = elementos.tieneFondo.checked ? 'flex' : 'none';
            actualizarPreview();
        },
        colorFondo: actualizarPreview,
        radioBorde: () => {
            elementos.radioValor.textContent = `${elementos.radioBorde.value}%`;
            actualizarPreview();
        },
        tamanoIcono: () => {
            elementos.tamanoValor.textContent = `${elementos.tamanoIcono.value}%`;
            actualizarPreview();
        },
        icono: () => {
            elementos.previewImg.src = elementos.icono.value || 'https://via.placeholder.com/64';
            actualizarPreview();
        }
    };

    Object.entries(handlers).forEach(([key, handler]) => {
        const el = elementos[key];
        const event = key === 'tieneFondo' ? 'change' : 'input';

        if (key !== 'tieneFondo' && key !== 'guardarBtn') {
            const newEl = el.cloneNode(true);
            el.parentNode.replaceChild(newEl, el);
            elementos[key] = newEl;
        }

        elementos[key].addEventListener(event, handler);
    });

    elementos.guardarBtn.onclick = () => guardarEdicion(index, {
        tieneFondo: elementos.tieneFondo.checked,
        colorFondo: elementos.colorFondo.value,
        radioBorde: parseInt(elementos.radioBorde.value),
        tamanoIcono: parseInt(elementos.tamanoIcono.value)
    });

    modal.classList.add('modal-abierto');
    modal.style.display = 'flex';
}

function cerrarModalModerno() {
    const modal = document.querySelector('.modal-moderno');
    modal.classList.remove('modal-abierto');

    resetearInputArchivo();

    setTimeout(() => {
        modal.style.display = 'none';
        ['nombre-sitio', 'url-sitio', 'icono-sitio'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('tiene-fondo-icono').checked = false;
        document.getElementById('color-fondo-container').style.display = 'none';
        document.getElementById('color-fondo-icono').value = '#667eea';
        document.getElementById('radio-borde-icono').value = '50';
        document.getElementById('tamano-icono').value = '74';
        document.getElementById('radio-valor').textContent = '50%';
        document.getElementById('tamano-valor').textContent = '74%';
        document.querySelector('.modal-moderno h2').textContent = 'Agregar acceso directo';
    }, 300);
}

function resetearInputArchivo() {
    const fileInput = document.getElementById('icono-file');
    const fileName = document.getElementById('file-name');
    const fileLabel = document.querySelector('.file-label');
    const fileText = document.querySelector('.file-text');

    if (fileInput) {
        fileInput.value = '';
        fileName && (fileName.textContent = '');
        fileLabel?.classList.remove('seleccionado');
        fileText && (fileText.textContent = 'Seleccionar imagen');
    }
}

function actualizarPreviewIcono(contenedor, imgElement, iconoUrl, estilos) {
    if (!contenedor || !imgElement) return;

    Object.assign(contenedor.style, {
        backgroundColor: estilos.tieneFondo ? estilos.colorFondo : 'transparent',
        borderRadius: `${estilos.radioBorde}%`,
        boxShadow: estilos.tieneFondo ? '0 10px 30px rgba(0,0,0,0.2)' : 'none'
    });

    Object.assign(imgElement.style, { width: `${estilos.tamanoIcono}%`, height: `${estilos.tamanoIcono}%` });
    imgElement.src = iconoUrl || 'https://via.placeholder.com/64';
}

function abrirModalPersonalizar() {
    if (!estado.autenticado) {
        mostrarNotificacionError('Debes iniciar sesión para personalizar');
        return;
    }
    
    const modal = document.querySelector('.modal-personalizar');
    if (!modal) return;

    const fondoActual = estado.fondos[estado.categoriaActual] || estado.fondos.general;
    const { tipo, opacidad, desenfoque, colorInicio, colorFin, url } = fondoActual;

    const titulo = modal.querySelector('h2');
    const catNombre = estado.categoriasUsuario[estado.categoriaActual]?.nombre || estado.categoriaActual;
    titulo.innerHTML = `Personalizar fondo - <span style="color: #667eea;">${catNombre}</span>`;

    document.getElementById('fondo-tipo').value = tipo || 'gradiente';

    const opacidadValor = opacidad !== undefined ? opacidad : 0;
    document.getElementById('fondo-opacidad').value = (opacidadValor / 0.5) * 100;
    document.getElementById('opacidad-valor').textContent = `${Math.round((opacidadValor / 0.5) * 100)}%`;

    const desenfoqueValor = desenfoque !== undefined ? desenfoque : 0;
    document.getElementById('fondo-desenfoque').value = desenfoqueValor;
    document.getElementById('desenfoque-valor').textContent = `${desenfoqueValor}px`;

    document.getElementById('color-inicio').value = colorInicio || '#667eea';
    document.getElementById('color-fin').value = colorFin || '#764ba2';
    document.getElementById('fondo-url-input').value = url || '';

    const grupoColores = document.getElementById('grupo-colores');
    const imagenesSection = document.getElementById('imagenes-predefinidas');
    const videosSection = document.getElementById('videos-predefinidos');

    grupoColores.style.display = 'none';
    imagenesSection.style.display = 'none';
    videosSection.style.display = 'none';

    if (tipo === 'gradiente') {
        grupoColores.style.display = 'block';
    } else if (tipo === 'imagen') {
        imagenesSection.style.display = 'block';
    } else if (tipo === 'video') {
        videosSection.style.display = 'block';
    }

    actualizarPreviewFondo();

    modal.classList.add('modal-personalizar-abierto');
    modal.style.display = 'flex';
}

function cerrarModalPersonalizar() {
    const modal = document.querySelector('.modal-personalizar');
    modal.classList.remove('modal-personalizar-abierto');
    setTimeout(() => modal.style.display = 'none', 300);
}

function actualizarPreviewFondo() {
    const tipo = document.getElementById('fondo-tipo').value;
    const preview = document.querySelector('.preview-fondo');
    const previewVideo = document.querySelector('.preview-video');
    const url = document.getElementById('fondo-url-input').value;
    const colorInicio = document.getElementById('color-inicio').value;
    const colorFin = document.getElementById('color-fin').value;

    const opacidadInput = document.getElementById('fondo-opacidad');
    const desenfoqueInput = document.getElementById('fondo-desenfoque');

    const opacidadPorcentaje = opacidadInput ? parseInt(opacidadInput.value) : 0;
    const opacidadCapa = (opacidadPorcentaje / 100) * 0.5;

    const desenfoquePx = desenfoqueInput ? parseInt(desenfoqueInput.value) : 0;

    if (document.getElementById('opacidad-valor')) {
        document.getElementById('opacidad-valor').textContent = `${opacidadPorcentaje}%`;
    }
    if (document.getElementById('desenfoque-valor')) {
        document.getElementById('desenfoque-valor').textContent = `${desenfoquePx}px`;
    }

    if (tipo === 'video' && url) {
        preview.style.display = 'none';
        previewVideo.style.display = 'block';
        previewVideo.src = url;
        previewVideo.load();
        previewVideo.play().catch(() => { });

        previewVideo.style.opacity = 1 - opacidadCapa;

    } else {
        preview.style.display = 'block';
        previewVideo.style.display = 'none';
        previewVideo.pause();

        let backgroundStyle = '';

        if (tipo === 'imagen' && url) {
            backgroundStyle = `linear-gradient(rgba(0, 0, 0, ${opacidadCapa}), rgba(0, 0, 0, ${opacidadCapa})), url('${url}')`;
            preview.style.backgroundImage = backgroundStyle;
            preview.style.backgroundSize = 'cover';
            preview.style.backgroundPosition = 'center';
        } else if (tipo === 'gradiente') {
            backgroundStyle = `linear-gradient(135deg, ${colorInicio}, ${colorFin})`;
            preview.style.backgroundImage = backgroundStyle;
        } else {
            preview.style.backgroundImage = 'none';
            preview.style.backgroundColor = '#f0f0f0';
        }
    }

    if (tipo !== 'video') {
        preview.style.filter = `blur(${desenfoquePx}px)`;
    } else {
        previewVideo.style.filter = `blur(${desenfoquePx}px)`;
    }
}

window.seleccionarFondoPredefinido = function (tipo, url, esVideo = false) {
    document.getElementById('fondo-tipo').value = esVideo ? 'video' : 'imagen';
    document.getElementById('fondo-url-input').value = url;
    document.getElementById('grupo-colores').style.display = 'none';
    actualizarPreviewFondo();
};

// ===== NOTIFICACIONES =====
function mostrarNotificacionCategoria(nombre) {
    const notificacion = document.createElement('div');
    notificacion.className = 'categoria-notificacion';
    notificacion.innerHTML = `
        Categoría: <span class="categoria-nombre">${nombre}</span>
    `;
    document.body.appendChild(notificacion);

    setTimeout(() => notificacion.classList.add('mostrar'), 10);
    setTimeout(() => {
        notificacion.classList.remove('mostrar');
        setTimeout(() => notificacion.remove(), 300);
    }, 2000);
}

function mostrarNotificacionExitosa(mensaje) {
    mostrarNotificacion(mensaje, 'exito');
}

function mostrarNotificacionError(mensaje) {
    mostrarNotificacion(mensaje, 'error');
}

function mostrarNotificacion(mensaje, tipo) {
    const notificacion = document.createElement('div');
    notificacion.className = `nota-notificacion ${tipo}`;
    notificacion.innerHTML = `
        <span class="nota-notificacion-icono">${tipo === 'exito' ? '✅' : '❌'}</span>
        <span class="nota-notificacion-mensaje">${mensaje}</span>
    `;

    Object.assign(notificacion.style, {
        position: 'fixed',
        bottom: '2rem',
        left: '50%',
        transform: 'translateX(-50%) translateY(100px)',
        background: tipo === 'exito'
            ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
            : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
        color: 'white',
        padding: '1rem 2rem',
        borderRadius: '50px',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.8rem',
        zIndex: '9999',
        opacity: '0',
        transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        fontSize: '0.95rem',
        fontWeight: '500',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        backdropFilter: 'blur(10px)'
    });

    document.body.appendChild(notificacion);

    setTimeout(() => {
        notificacion.style.transform = 'translateX(-50%) translateY(0)';
        notificacion.style.opacity = '1';
    }, 10);

    setTimeout(() => {
        notificacion.style.transform = 'translateX(-50%) translateY(100px)';
        notificacion.style.opacity = '0';
        setTimeout(() => notificacion.remove(), 300);
    }, 3000);
}

// ===== INFORMACIÓN ÚTIL (Dólar y Clima) =====
const SANTO_DOMINGO = { lat: 18.4861, lon: -69.9312 };
const INTERVALO_DOLAR = 5 * 60 * 1000;
const INTERVALO_CLIMA = 15 * 60 * 1000;

async function obtenerPrecioDolar() {
    const elementoDolar = document.getElementById('valor-dolar');
    const itemDolar = document.getElementById('info-dolar');

    if (!elementoDolar) return;

    try {
        elementoDolar.classList.add('cargando');
        itemDolar?.classList.add('actualizando');

        const respuesta = await fetch('https://open.er-api.com/v6/latest/USD');

        if (!respuesta.ok) {
            throw new Error('Error en la respuesta de la API');
        }

        const datos = await respuesta.json();
        const precio = datos.rates?.DOP;

        if (precio) {
            const precioFormateado = precio.toLocaleString('es-DO', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
            elementoDolar.textContent = `RD$ ${precioFormateado}`;
            elementoDolar.classList.remove('cargando');
        } else {
            throw new Error('No se recibió el precio del dólar');
        }
    } catch (error) {
        console.error('Error al obtener el precio del dólar:', error);
        elementoDolar.textContent = 'No disponible';
        elementoDolar.classList.remove('cargando');
    } finally {
        itemDolar?.classList.remove('actualizando');
    }
}

async function obtenerClimaSantoDomingo() {
    const elementoClima = document.getElementById('valor-clima');
    const iconoClima = document.getElementById('icono-clima');
    const itemClima = document.getElementById('info-clima');

    if (!elementoClima) return;

    try {
        elementoClima.classList.add('cargando');
        itemClima?.classList.add('actualizando');

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${SANTO_DOMINGO.lat}&longitude=${SANTO_DOMINGO.lon}&current=temperature_2m,weather_code&timezone=auto`;

        const respuesta = await fetch(url);

        if (!respuesta.ok) {
            throw new Error('Error en la respuesta de la API');
        }

        const datos = await respuesta.json();
        const temperatura = datos.current?.temperature_2m;
        const weatherCode = datos.current?.weather_code;

        if (temperatura !== undefined) {
            elementoClima.textContent = `${Math.round(temperatura)}°C`;

            if (iconoClima) {
                iconoClima.innerHTML = obtenerIconoClima(weatherCode);
            }

            elementoClima.classList.remove('cargando');
        } else {
            throw new Error('No se recibió la temperatura');
        }
    } catch (error) {
        console.error('Error al obtener el clima:', error);
        elementoClima.textContent = 'No disponible';
        elementoClima.classList.remove('cargando');

        if (iconoClima) {
            iconoClima.innerHTML = `
                <svg class="clima-icono" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="2"/>
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
            `;
        }
    } finally {
        itemClima?.classList.remove('actualizando');
    }
}

function obtenerIconoClima(codigo) {
    const iconos = {
        0: `<svg class="clima-icono" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
        1: `<svg class="clima-icono" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17 8a5 5 0 00-10 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
        2: `<svg class="clima-icono" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="4" stroke="currentColor" stroke-width="2" fill="none"/><path d="M10 6v2M10 16v2M7.07 7.07l1.41 1.41M15.66 15.66l1.41 1.41M6 10h2M16 10h2M8.48 15.48l-1.41 1.41M16.52 7.52l-1.41 1.41" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M18 16a4 4 0 01-8 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
        3: `<svg class="clima-icono" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 16a4 4 0 01-8 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17 12a5 5 0 00-10 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
        51: `<svg class="clima-icono" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 16a4 4 0 01-8 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17 12a5 5 0 00-10 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 19v2M12 19v2M16 19v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
        61: `<svg class="clima-icono" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 14a4 4 0 01-8 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17 10a5 5 0 00-10 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 20l2 2M11 20l2 2M15 20l2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
        80: `<svg class="clima-icono" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 14a4 4 0 01-8 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17 10a5 5 0 00-10 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M13 19l-2 3M9 19l1 3M15 19l-1 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 8l3 3M11 8l2 3M14 8l-1 3" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg>`
    };
    return iconos[codigo] || iconos[0];
}

function inicializarInfoUtil() {
    obtenerPrecioDolar();
    obtenerClimaSantoDomingo();

    setInterval(obtenerPrecioDolar, INTERVALO_DOLAR);
    setInterval(obtenerClimaSantoDomingo, INTERVALO_CLIMA);

    const itemDolar = document.getElementById('info-dolar');
    const itemClima = document.getElementById('info-clima');

    itemDolar?.addEventListener('click', () => {
        window.open('https://www.google.com/search?q=dolar+peso+dominicano+Republica+Dominicana+hoy', '_blank');
    });

    itemClima?.addEventListener('click', () => {
        window.open('https://www.google.com/search?q=clima+Santo+Domingo+Republica+Dominicana', '_blank');
    });
}

// ===== INICIALIZACIÓN =====
document.addEventListener('DOMContentLoaded', () => {
    cachearElementos();

    // Configuración inicial
    estado.categoriasUsuario = { ...CATEGORIAS_PREDETERMINADAS };
    estado.categoriaActual = 'general';

    actualizarCategoriasUI();
    aplicarFondo();
    renderizarIconos();

    inicializarBarraBusqueda();
    inicializarNota();
    inicializarAuth();
    inicializarInfoUtil();

    crearModalIconos();
    crearModalPersonalizacion();

    // Event delegation para menú de usuario
    DOM.userAvatar?.addEventListener('click', toggleUserMenu);
});

// ===== CREACIÓN DE MODALES =====
function crearModalIconos() {
    if (document.querySelector('.modal-moderno')) return;

    const modalModerno = document.createElement('div');
    modalModerno.className = 'modal-moderno';
    modalModerno.innerHTML = `
        <div class="modal-moderno-contenido">
            <div class="modal-header">
                <h2>Agregar acceso directo</h2>
                <button class="modal-cerrar" id="cerrar-modal-moderno">×</button>
            </div>
            <div class="modal-contenido-scroll">
                <div class="modal-grid">
                    <div class="modal-preview">
                        <h3>Vista previa</h3>
                        <div class="preview-container">
                            <div class="preview-icono" style="background-color:transparent;border-radius:50%;width:150px;height:150px;display:flex;align-items:center;justify-content:center;margin:0 auto;transition:all 0.3s ease">
                                <img src="https://via.placeholder.com/64" alt="Preview" style="width:74%;height:74%;object-fit:contain;transition:all 0.3s ease">
                            </div>
                        </div>
                        <div class="control-grupo">
                            <div class="checkbox-container">
                                <input type="checkbox" id="tiene-fondo-icono">
                                <label for="tiene-fondo-icono">Agregar fondo al icono</label>
                            </div>
                        </div>
                        <div class="control-grupo" id="color-fondo-container" style="display:none">
                            <label>Color de fondo</label>
                            <div class="color-picker-container">
                                <input type="color" id="color-fondo-icono" value="#667eea">
                                <span class="color-valor" id="color-valor">#667eea</span>
                            </div>
                        </div>
                        <div class="control-grupo">
                            <div class="control-label"><label>Borde redondeado</label><span class="control-valor" id="radio-valor">50%</span></div>
                            <input type="range" id="radio-borde-icono" min="0" max="100" value="50" class="control-range">
                            <div class="range-marks"><span>0%</span><span>50%</span><span>100%</span></div>
                        </div>
                        <div class="control-grupo">
                            <div class="control-label"><label>Tamaño del icono</label><span class="control-valor" id="tamano-valor">74%</span></div>
                            <input type="range" id="tamano-icono" min="30" max="100" value="74" class="control-range">
                            <div class="range-marks"><span>30%</span><span>65%</span><span>100%</span></div>
                        </div>
                    </div>
                    <div class="modal-controles">
                        <h3>DETALLES DEL SITIO</h3>
                        <div class="control-separador"></div>
                        <div class="control-grupo"><label>Nombre del sitio</label><input type="text" id="nombre-sitio" placeholder="Ej: Google" class="control-input"></div>
                        <div class="control-grupo"><label>URL</label><input type="url" id="url-sitio" placeholder="https://ejemplo.com" class="control-input"></div>
                        <div class="control-grupo"><label>URL del icono (opcional)</label><input type="url" id="icono-sitio" placeholder="https://ejemplo.com/icono.png" class="control-input"></div>
                        <div class="control-grupo">
                            <label>O sube una imagen local</label>
                            <div class="file-upload-container">
                                <input type="file" id="icono-file" accept="image/*" class="file-input">
                                <label for="icono-file" class="file-label"><span class="file-icon">📁</span><span class="file-text">Seleccionar imagen</span></label>
                                <div class="file-name" id="file-name"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-botones">
                <button class="btn-secundario" id="cancelar-icono-moderno">Cancelar</button>
                <button class="btn-primario" id="guardar-icono-moderno">Guardar cambios</button>
            </div>
        </div>
    `;
    document.body.appendChild(modalModerno);

    const fileInput = document.getElementById('icono-file');
    fileInput?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;

        document.getElementById('file-name').textContent = file.name;
        document.querySelector('.file-label').classList.add('seleccionado');

        try {
            const base64 = await convertirABase64(file);
            document.getElementById('icono-sitio').value = base64;
            document.querySelector('.preview-icono img').src = base64;
            document.querySelector('.file-text').textContent = 'Imagen seleccionada';
        } catch (error) {
            console.error('Error al convertir imagen:', error);
            alert('Error al cargar la imagen.');
        }
    });

    DOM.btnAgregar?.addEventListener('click', () => {
        if (!estado.autenticado) {
            mostrarNotificacionError('Debes iniciar sesión para agregar accesos directos');
            return;
        }
        document.querySelector('.modal-moderno h2').textContent = 'Agregar acceso directo';
        resetearModalIconos();
        modalModerno.classList.add('modal-abierto');
        modalModerno.style.display = 'flex';
    });

    document.getElementById('cancelar-icono-moderno').addEventListener('click', cerrarModalModerno);
    document.getElementById('cerrar-modal-moderno').addEventListener('click', cerrarModalModerno);

    document.getElementById('tiene-fondo-icono').addEventListener('change', function () {
        document.getElementById('color-fondo-container').style.display = this.checked ? 'flex' : 'none';
        actualizarPreviewDesdeModal();
    });

    document.getElementById('radio-borde-icono').addEventListener('input', function () {
        document.getElementById('radio-valor').textContent = this.value + '%';
        actualizarPreviewDesdeModal();
    });

    document.getElementById('tamano-icono').addEventListener('input', function () {
        document.getElementById('tamano-valor').textContent = this.value + '%';
        actualizarPreviewDesdeModal();
    });

    document.getElementById('color-fondo-icono').addEventListener('input', actualizarPreviewDesdeModal);
    document.getElementById('icono-sitio').addEventListener('input', actualizarPreviewDesdeModal);

    function actualizarPreviewDesdeModal() {
        const previewIcono = document.querySelector('.preview-icono');
        const previewImg = previewIcono?.querySelector('img');
        if (!previewIcono || !previewImg) return;

        actualizarPreviewIcono(previewIcono, previewImg, document.getElementById('icono-sitio').value, {
            tieneFondo: document.getElementById('tiene-fondo-icono').checked,
            colorFondo: document.getElementById('color-fondo-icono').value,
            radioBorde: parseInt(document.getElementById('radio-borde-icono').value),
            tamanoIcono: parseInt(document.getElementById('tamano-icono').value)
        });
    }

    document.getElementById('guardar-icono-moderno').addEventListener('click', async () => {
        if (!estado.autenticado) return;
        
        const nombre = document.getElementById('nombre-sitio').value;
        const url = document.getElementById('url-sitio').value;
        let icono = document.getElementById('icono-sitio').value;

        if (!nombre || !url) {
            alert('Por favor, completa al menos el nombre y la URL');
            return;
        }

        if (!icono) {
            try {
                const urlObj = new URL(url);
                icono = `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;
            } catch {
                icono = 'https://via.placeholder.com/64';
            }
        }

        await agregarIcono(nombre, url, icono, {
            tieneFondo: document.getElementById('tiene-fondo-icono').checked,
            colorFondo: document.getElementById('color-fondo-icono').value,
            radioBorde: parseInt(document.getElementById('radio-borde-icono').value),
            tamanoIcono: parseInt(document.getElementById('tamano-icono').value)
        });
        cerrarModalModerno();
    });

    window.addEventListener('click', e => {
        if (e.target === modalModerno && modalModerno.classList.contains('modal-abierto')) {
            cerrarModalModerno();
        }
    });
}

function resetearModalIconos() {
    ['nombre-sitio', 'url-sitio', 'icono-sitio'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    const tieneFondo = document.getElementById('tiene-fondo-icono');
    if (tieneFondo) {
        tieneFondo.checked = false;
        document.getElementById('color-fondo-container').style.display = 'none';
    }

    const colorFondo = document.getElementById('color-fondo-icono');
    if (colorFondo) colorFondo.value = '#667eea';

    const radioBorde = document.getElementById('radio-borde-icono');
    if (radioBorde) {
        radioBorde.value = '50';
        document.getElementById('radio-valor').textContent = '50%';
    }

    const tamanoIcono = document.getElementById('tamano-icono');
    if (tamanoIcono) {
        tamanoIcono.value = '74';
        document.getElementById('tamano-valor').textContent = '74%';
    }

    resetearInputArchivo();

    const previewIcono = document.querySelector('.preview-icono');
    const previewImg = previewIcono?.querySelector('img');
    if (previewIcono && previewImg) {
        Object.assign(previewIcono.style, { backgroundColor: 'transparent', borderRadius: '50%', boxShadow: 'none' });
        Object.assign(previewImg.style, { width: '74%', height: '74%' });
        previewImg.src = 'https://via.placeholder.com/64';
    }
}

function crearModalPersonalizacion() {
    if (document.querySelector('.modal-personalizar')) return;

    const modalPersonalizar = document.createElement('div');
    modalPersonalizar.className = 'modal-personalizar';
    modalPersonalizar.innerHTML = `
        <div class="modal-personalizar-contenido">
            <h2>Personalizar fondo</h2>
            <div class="personalizar-input-group">
                <label>Tipo de fondo:</label>
                <select id="fondo-tipo" style="width:100%;padding:0.8rem;border-radius:8px;border:1px solid #ddd">
                    <option value="gradiente">Gradiente</option>
                    <option value="imagen">Imagen</option>
                    <option value="video">Video</option>
                </select>
            </div>
            
            <!-- Sección de imágenes predefinidas -->
            <div id="imagenes-predefinidas" style="display: none;">
                <h3>Imágenes predefinidas</h3>
                <div class="opciones-fondo" id="opciones-imagenes">
                    <div class="opcion-fondo" onclick="seleccionarFondoPredefinido('imagen', 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400')">
                        <img src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400" alt="Montañas" loading="lazy">
                    </div>
                    <div class="opcion-fondo" onclick="seleccionarFondoPredefinido('imagen', 'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=400')">
                        <img src="https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=400" alt="Lago" loading="lazy">
                    </div>
                    <div class="opcion-fondo" onclick="seleccionarFondoPredefinido('imagen', 'https://images.unsplash.com/photo-1426604966840-d7adac433b4b?w=400')">
                        <img src="https://images.unsplash.com/photo-1426604966840-d7adac433b4b?w=400" alt="Bosque" loading="lazy">
                    </div>
                    <div class="opcion-fondo" onclick="seleccionarFondoPredefinido('imagen', 'https://images.unsplash.com/photo-1505144808419-1957a94ca61e?w=400')">
                        <img src="https://images.unsplash.com/photo-1505144808419-1957a94ca61e?w=400" alt="Mar" loading="lazy">
                    </div>
                </div>
            </div>
            
            <!-- Sección de videos predefinidos -->
            <div id="videos-predefinidos" style="display: none;">
                <h3>Videos predefinidos</h3>
                <div class="opciones-fondo" id="opciones-videos">
                    <div class="opcion-fondo" onclick="seleccionarFondoPredefinido('video', 'https://player.vimeo.com/external/371937261.sd.mp4?s=1c4b9a3d4b5e7c3f8d9e2a1b0c5d6e7f&profile_id=165', true)">
                        <video src="https://player.vimeo.com/external/371937261.sd.mp4?s=1c4b9a3d4b5e7c3f8d9e2a1b0c5d6e7f&profile_id=165" muted loop playsinline></video>
                    </div>
                    <div class="opcion-fondo" onclick="seleccionarFondoPredefinido('video', 'https://player.vimeo.com/external/434045526.sd.mp4?s=2d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s&profile_id=165', true)">
                        <video src="https://player.vimeo.com/external/434045526.sd.mp4?s=2d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s&profile_id=165" muted loop playsinline></video>
                    </div>
                </div>
            </div>
            
            <div class="personalizar-input-group">
                <label>URL personalizada (opcional):</label>
                <input type="url" id="fondo-url-input" placeholder="https://ejemplo.com/imagen.jpg o video.mp4">
            </div>
            
            <div class="personalizar-input-group" id="grupo-colores">
                <label>Color inicio gradiente:</label>
                <input type="color" id="color-inicio" value="#667eea">
                <label style="margin-top:10px">Color fin gradiente:</label>
                <input type="color" id="color-fin" value="#764ba2">
            </div>
            
            <div class="range-group">
                <div class="range-header">
                    <label for="fondo-opacidad">Opacidad</label>
                    <span class="range-value" id="opacidad-valor">0%</span>
                </div>
                <input type="range" id="fondo-opacidad" min="0" max="100" value="0" class="control-range">
                <div class="range-marks">
                    <span>0% (claro)</span>
                    <span>100% (oscuro)</span>
                </div>
            </div>

            <div class="range-group">
                <div class="range-header">
                    <label for="fondo-desenfoque">Desenfoque</label>
                    <span class="range-value" id="desenfoque-valor">0px</span>
                </div>
                <input type="range" id="fondo-desenfoque" min="0" max="20" value="0" step="1" class="control-range">
                <div class="range-marks">
                    <span>0px</span>
                    <span>10px</span>
                    <span>20px</span>
                </div>
            </div>
            
            <h3>Vista previa</h3>
            <div class="preview-fondo-master">
                <div class="preview-fondo"></div>
            </div>
            <video class="preview-video" muted loop playsinline style="display:none"></video>
            
            <div class="personalizar-botones">
                <button id="cancelar-personalizacion">Cancelar</button>
                <button id="guardar-personalizacion">Guardar cambios</button>
            </div>
        </div>
    `;
    document.body.appendChild(modalPersonalizar);

    DOM.btnPersonalizar?.addEventListener('click', abrirModalPersonalizar);

    document.getElementById('fondo-tipo').addEventListener('change', function (e) {
        const tipo = e.target.value;
        const grupoColores = document.getElementById('grupo-colores');
        const imagenesSection = document.getElementById('imagenes-predefinidas');
        const videosSection = document.getElementById('videos-predefinidos');

        grupoColores.style.display = 'none';
        imagenesSection.style.display = 'none';
        videosSection.style.display = 'none';

        if (tipo === 'gradiente') {
            grupoColores.style.display = 'block';
        } else if (tipo === 'imagen') {
            imagenesSection.style.display = 'block';
        } else if (tipo === 'video') {
            videosSection.style.display = 'block';
        }

        actualizarPreviewFondo();
    });

    ['fondo-url-input', 'color-inicio', 'color-fin'].forEach(id => {
        document.getElementById(id).addEventListener('input', actualizarPreviewFondo);
    });

    document.getElementById('fondo-opacidad').addEventListener('input', actualizarPreviewFondo);
    document.getElementById('fondo-desenfoque').addEventListener('input', actualizarPreviewFondo);

    document.getElementById('guardar-personalizacion').addEventListener('click', () => {
        const opacidadSlider = parseInt(document.getElementById('fondo-opacidad').value);
        const opacidadGuardar = (opacidadSlider / 100) * 0.5;

        guardarFondoEnFirebase({
            tipo: document.getElementById('fondo-tipo').value,
            url: document.getElementById('fondo-url-input').value || null,
            opacidad: opacidadGuardar,
            desenfoque: parseInt(document.getElementById('fondo-desenfoque').value),
            colorInicio: document.getElementById('color-inicio').value,
            colorFin: document.getElementById('color-fin').value
        });
        cerrarModalPersonalizar();
    });

    document.getElementById('cancelar-personalizacion').addEventListener('click', cerrarModalPersonalizar);

    window.addEventListener('click', e => {
        if (e.target === modalPersonalizar && modalPersonalizar.classList.contains('modal-personalizar-abierto')) {
            cerrarModalPersonalizar();
        }
    });
}

// ===== ESTILOS ADICIONALES =====
const estilosAdicionales = document.createElement('style');
estilosAdicionales.textContent = `
    /* Estilos para autenticación */
    .auth-container {
        position: fixed;
        top: 1.5rem;
        right: 1.5rem;
        z-index: 1000;
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    .btn-login {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.6rem 1.2rem;
        background: rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 50px;
        color: white;
        font-size: 0.95rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
    }

    .btn-login:hover {
        transform: translateY(-3px);
        background: rgba(255, 255, 255, 0.25);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.25);
    }

    .btn-login:active {
        transform: translateY(-1px);
    }

    .btn-login-icono {
        font-size: 1.2rem;
    }

    .user-avatar {
        display: none;
        width: 45px;
        height: 45px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(10px);
        border: 2px solid rgba(255, 255, 255, 0.3);
        cursor: pointer;
        transition: all 0.3s ease;
        overflow: hidden;
    }

    .user-avatar:hover {
        transform: scale(1.1);
        border-color: white;
        box-shadow: 0 0 20px rgba(255, 255, 255, 0.3);
    }

    .user-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .user-menu {
        position: absolute;
        top: 70px;
        right: 1.5rem;
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        padding: 1rem;
        min-width: 250px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        opacity: 0;
        transform: translateY(-10px);
        pointer-events: none;
        transition: all 0.3s ease;
        z-index: 1001;
    }

    .user-menu.visible {
        opacity: 1;
        transform: translateY(0);
        pointer-events: all;
    }

    .user-menu-header {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 0.5rem;
    }

    .user-menu-header img {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 2px solid rgba(102, 126, 234, 0.5);
    }

    .user-name {
        color: white;
        font-weight: 600;
        font-size: 1rem;
        margin-bottom: 0.2rem;
    }

    .user-email {
        color: rgba(255, 255, 255, 0.6);
        font-size: 0.85rem;
    }

    .user-menu-item {
        padding: 0.8rem 1rem;
        color: white;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.8rem;
        transition: all 0.2s ease;
    }

    .user-menu-item:hover {
        background: rgba(255, 255, 255, 0.1);
    }

    .user-menu-icon {
        font-size: 1.2rem;
        opacity: 0.8;
    }

    /* Elementos deshabilitados */
    .deshabilitado,
    .deshabilitado:hover {
        opacity: 0.5;
        pointer-events: none;
        cursor: not-allowed;
        transform: none !important;
    }

    .icono-item.editable {
        cursor: pointer;
    }

    /* Botón agregar categoría */
    .btn-agregar-categoria {
        background: rgba(102, 126, 234, 0.3) !important;
        border: 2px dashed rgba(255, 255, 255, 0.5) !important;
        font-size: 1.5rem !important;
        font-weight: bold !important;
        color: white !important;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .btn-agregar-categoria:hover {
        background: rgba(102, 126, 234, 0.5) !important;
        border-color: white !important;
    }

    /* Responsive */
    @media (max-width: 768px) {
        .auth-container {
            top: 1rem;
            right: 1rem;
        }

        .btn-login {
            padding: 0.4rem 1rem;
            font-size: 0.85rem;
        }

        .user-avatar {
            width: 40px;
            height: 40px;
        }

        .user-menu {
            top: 60px;
            right: 1rem;
            min-width: 220px;
        }
    }

    /* Notificaciones */
    .nota-notificacion {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        letter-spacing: 0.3px;
    }

    .nota-notificacion.exito {
        background: linear-gradient(135deg, #10b981, #059669);
    }

    .nota-notificacion.error {
        background: linear-gradient(135deg, #ef4444, #dc2626);
    }

    /* Tooltips */
    [title] {
        position: relative;
    }

    [title]:hover::after {
        content: attr(title);
        position: absolute;
        bottom: -30px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.9);
        color: white;
        padding: 0.3rem 0.8rem;
        border-radius: 20px;
        font-size: 0.8rem;
        white-space: nowrap;
        border: 1px solid rgba(255, 255, 255, 0.2);
        pointer-events: none;
        z-index: 10000;
        backdrop-filter: blur(5px);
    }

    /* Mejora para el contenedor de iconos */
    .contenedor-iconos {
        min-height: 200px;
    }

    /* Animación para cambio de categoría */
    .categoria-btn {
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    /* Estilo para el menú contextual en categorías */
    .menu-contextual {
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 0.5rem;
        min-width: 180px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        z-index: 10000;
    }

    .menu-contextual .menu-item {
        color: white;
        padding: 0.8rem 1rem;
        border-radius: 8px;
        transition: all 0.2s ease;
    }

    .menu-contextual .menu-item:hover {
        background: rgba(102, 126, 234, 0.3);
    }
`;
document.head.appendChild(estilosAdicionales);

// Hacer funciones globales para los onclick
window.cerrarSesion = cerrarSesion;
window.seleccionarFondoPredefinido = seleccionarFondoPredefinido;