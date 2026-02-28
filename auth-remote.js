// auth-remote.js - Este archivo vive en GitHub Pages
// URL: https://TU-USUARIO.github.io/TU-REPO/auth-remote.js

(function() {
    console.log('🚀 Auth Remote: Cargando módulo de autenticación...');

    // Configuración de Firebase
    const firebaseConfig = {
        apiKey: "AIzaSyBU8DyN2kRcDq0fxB20qRUXWBHV0E-0d6A",
        authDomain: "startab-44e48.firebaseapp.com",
        projectId: "startab-44e48",
        storageBucket: "startab-44e48.firebasestorage.app",
        messagingSenderId: "874084877753",
        appId: "1:874084877753:web:cf9cbe9a344356dc9be268"
    };

    // Inicializar Firebase si no está inicializado
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
        console.log('✅ Auth Remote: Firebase inicializado');
    }

    const auth = firebase.auth();
    const db = firebase.firestore();
    const googleProvider = new firebase.auth.GoogleAuthProvider();

    // Configurar persistencia
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

    // Estado de autenticación
    window.AuthModule = {
        currentUser: null,
        isAuthenticated: false,
        db: db,
        auth: auth
    };

    // Escuchar cambios en autenticación
    auth.onAuthStateChanged((user) => {
        console.log('🔄 Auth Remote: Estado cambiado', user ? user.email : 'no usuario');
        
        window.AuthModule.currentUser = user;
        window.AuthModule.isAuthenticated = !!user;

        // Disparar evento personalizado
        const event = new CustomEvent('authStateChanged', {
            detail: {
                user: user ? {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName,
                    photoURL: user.photoURL
                } : null,
                isAuthenticated: !!user
            }
        });
        window.dispatchEvent(event);
    });

    // Función para iniciar sesión con Google
    window.loginWithGoogle = async function() {
        console.log('🔑 Auth Remote: Intentando login con Google...');
        try {
            const result = await auth.signInWithPopup(googleProvider);
            console.log('✅ Auth Remote: Login exitoso', result.user.email);
            return { 
                success: true, 
                user: {
                    uid: result.user.uid,
                    email: result.user.email,
                    displayName: result.user.displayName,
                    photoURL: result.user.photoURL
                }
            };
        } catch (error) {
            console.error('❌ Auth Remote: Error en login', error);
            return { 
                success: false, 
                error: error.message,
                code: error.code
            };
        }
    };

    // Función para cerrar sesión
    window.logout = async function() {
        console.log('🔒 Auth Remote: Cerrando sesión...');
        try {
            await auth.signOut();
            console.log('✅ Auth Remote: Sesión cerrada');
            return { success: true };
        } catch (error) {
            console.error('❌ Auth Remote: Error al cerrar sesión', error);
            return { success: false, error: error.message };
        }
    };

    // Función para obtener datos del usuario
    window.getCurrentUser = function() {
        return window.AuthModule.currentUser;
    };

    // Función para obtener referencia a Firestore
    window.getFirestore = function() {
        return db;
    };

    // Función para guardar datos
    window.saveUserData = async function(uid, data) {
        try {
            await db.collection('users').doc(uid).set(data, { merge: true });
            return { success: true };
        } catch (error) {
            console.error('Error guardando datos:', error);
            return { success: false, error: error.message };
        }
    };

    // Función para cargar datos
    window.loadUserData = async function(uid) {
        try {
            const doc = await db.collection('users').doc(uid).get();
            if (doc.exists) {
                return { success: true, data: doc.data() };
            } else {
                return { success: true, data: null };
            }
        } catch (error) {
            console.error('Error cargando datos:', error);
            return { success: false, error: error.message };
        }
    };

    console.log('✅ Auth Remote: Módulo listo');
})();