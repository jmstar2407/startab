// auth.js - Para GitHub Pages
// Configuración de Firebase
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
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();

// Configurar proveedor
provider.addScope('profile');
provider.addScope('email');
provider.setCustomParameters({
    prompt: 'select_account'
});

// Elementos DOM
const googleBtn = document.getElementById('googleSignIn');
const statusDiv = document.getElementById('status');

// Función para mostrar estado
function showStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
}

// Función para enviar datos a la extensión
function sendToExtension(userData) {
    // Método 1: PostMessage (si la extensión abrió esta ventana)
    if (window.opener && !window.opener.closed) {
        try {
            window.opener.postMessage({
                type: 'STAR_TAB_AUTH_SUCCESS',
                user: userData
            }, '*');
            return true;
        } catch (e) {
            console.log('Error en postMessage:', e);
        }
    }
    
    // Método 2: Guardar en localStorage (la extensión hará polling)
    try {
        localStorage.setItem('starTab_auth_data', JSON.stringify({
            ...userData,
            timestamp: Date.now()
        }));
        return true;
    } catch (e) {
        console.log('Error en localStorage:', e);
    }
    
    return false;
}

// Manejar clic en botón de Google
googleBtn.addEventListener('click', async () => {
    try {
        showStatus('Iniciando sesión...', 'info');
        googleBtn.disabled = true;
        googleBtn.innerHTML = '<div class="btn-content"><div class="loader"></div><span>Conectando...</span></div>';

        // Usar signInWithPopup (funciona en GitHub Pages)
        const result = await auth.signInWithPopup(provider);
        const user = result.user;
        
        console.log('Usuario autenticado:', user.email);
        
        // Obtener token
        const token = await user.getIdToken();
        
        // Datos del usuario — incluir accessToken para que la extensión
        // pueda autenticar Firebase Auth localmente con signInWithCredential
        const userData = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            token: token,
            accessToken: result.credential?.accessToken || null,
            emailVerified: user.emailVerified,
            timestamp: Date.now()
        };

        // Enviar a la extensión
        const sent = sendToExtension(userData);
        
        if (sent) {
            showStatus('✅ ¡Autenticación exitosa! Puedes cerrar esta ventana.', 'success');
            setTimeout(() => window.close(), 2000);
        } else {
            showStatus('✅ Autenticación exitosa! Vuelve a la extensión y recarga.', 'success');
        }
        
    } catch (error) {
        console.error('Error de autenticación:', error);
        
        let errorMessage = 'Error al iniciar sesión';
        if (error.code === 'auth/popup-closed-by-user') {
            errorMessage = 'Ventana cerrada por el usuario';
        } else if (error.code === 'auth/account-exists-with-different-credential') {
            errorMessage = 'Ya existe una cuenta con otro método';
        } else if (error.code === 'auth/popup-blocked') {
            errorMessage = 'Bloqueador de ventanas emergentes activado';
        } else {
            errorMessage = error.message;
        }
        
        showStatus(`❌ ${errorMessage}`, 'error');
        
        googleBtn.disabled = false;
        googleBtn.innerHTML = '<img src="https://www.google.com/favicon.ico" alt="Google"> Continuar con Google';
    }
});

// Comprobar si hay sesión activa al cargar
auth.onAuthStateChanged(async (user) => {
    if (user) {
        showStatus('Sesión activa - enviando datos...', 'info');
        const token = await user.getIdToken();
        sendToExtension({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            token: token,
            emailVerified: user.emailVerified,
            timestamp: Date.now()
        });
    }
});

// Escuchar mensajes de la extensión
window.addEventListener('message', (event) => {
    if (event.data?.type === 'STAR_TAB_REQUEST_TOKEN') {
        const user = auth.currentUser;
        if (user) {
            user.getIdToken().then(token => {
                event.source.postMessage({
                    type: 'STAR_TAB_TOKEN_RESPONSE',
                    user: {
                        uid: user.uid,
                        email: user.email,
                        displayName: user.displayName,
                        photoURL: user.photoURL,
                        token: token
                    }
                }, event.origin);
            });
        }
    }
});