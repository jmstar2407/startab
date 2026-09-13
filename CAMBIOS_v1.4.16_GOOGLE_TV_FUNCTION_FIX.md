# StarTab 1.4.16 · Google TV Function Fix

- Power envía `on` u `off` explícitamente en vez de `toggle`.
- Se muestran errores reales devueltos por el Google TV (Accesibilidad desactivada, DPAD no disponible, política de volumen fijo, permiso Power, etc.).
- El header avisa cuando la APK reporta Accesibilidad desactivada.
- Todos los comandos LAN relevantes incluyen id de ACK.
- Firebase abre una sesión de baja latencia más rápido al abrir el modal.
- Cruceta móvil reconstruida con tamaño fijo 1:1 y botones cardinales simétricos para evitar deformaciones por CSS heredado.
- Se mantiene el touchpad sin barra de scroll.
