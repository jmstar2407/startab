// Configuración de Firebase (la misma que en la extensión)
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

// Elementos DOM
const googleBtn = document.getElementById('googleSignIn');
const statusDiv = document.getElementById('status');

// Función para mostrar estado
function showStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
}

// Función para enviar token a la extensión
async function sendTokenToExtension(user) {
    try {
        // Obtener token de Firebase
        const token = await user.getIdToken();
        
        // Datos completos del usuario
        const userData = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            token: token,
            timestamp: Date.now()
        };

        // Intentar enviar a la extensión (si está abierta)
        // Usamos window.opener para comunicación entre pestañas
        if (window.opener && !window.opener.closed) {
            try {
                window.opener.postMessage({
                    type: 'STAR_TAB_AUTH_SUCCESS',
                    user: userData
                }, '*'); // En producción, especifica tu origen
                
                showStatus('✅ ¡Autenticación exitosa! Puedes cerrar esta ventana.', 'success');
                
                // Auto-cerrar después de 3 segundos
                setTimeout(() => {
                    window.close();
                }, 3000);
                
                return;
            } catch (e) {
                console.log('No se pudo comunicar con la ventana padre');
            }
        }

        // Si no hay opener, usar chrome.runtime si estamos en extensión
        if (window.chrome?.runtime?.id) {
            try {
                chrome.runtime.sendMessage({
                    type: 'AUTH_TOKEN',
                    user: userData
                });
                
                showStatus('✅ Token enviado a la extensión', 'success');
                return;
            } catch (e) {
                console.log('No se pudo enviar mensaje a la extensión');
            }
        }

        // Si llegamos aquí, mostrar código para copiar manualmente
        showStatus(`
            ✅ Autenticación exitosa!
            
            Copia este código y pégalo en la extensión:
            ${token.substring(0, 20)}...${token.substring(token.length - 20)}
            
            O simplemente recarga la extensión.
        `, 'success');
        
        // Guardar en localStorage como respaldo
        localStorage.setItem('starTab_lastAuth', JSON.stringify({
            user: {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL
            },
            token: token,
            timestamp: Date.now()
        }));
        
    } catch (error) {
        console.error('Error al obtener token:', error);
        showStatus('Error al procesar autenticación', 'error');
    }
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
        await sendTokenToExtension(user);
        
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
        showStatus('Sesión activa - enviando token...', 'info');
        await sendTokenToExtension(user);
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
                    token: token,
                    user: {
                        uid: user.uid,
                        email: user.email,
                        displayName: user.displayName,
                        photoURL: user.photoURL
                    }
                }, event.origin);
            });
        }
    }
});

// Auto-cerrar si viene de la extensión y ya estaba autenticado
if (window.opener && !window.opener.closed) {
    const user = auth.currentUser;
    if (user) {
        sendTokenToExtension(user);
    }
}