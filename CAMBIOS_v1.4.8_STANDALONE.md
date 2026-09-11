# StarTab v1.4.8 · Windows Standalone

## Cambio principal

El PC principal ya no depende de una pestaña de StarTab ni del proceso de Chrome para recibir controles de Windows.

Se añadió `windows-native-host/CloudAgent.cs`, un modo persistente del agente Windows que:

- arranca con Windows usando `--daemon`;
- escucha directamente las órdenes del usuario en Firestore;
- ejecuta volumen, mute, mouse/touchpad, scroll, clics, teclado, acciones del sistema, hotspot y OpenRGB;
- mantiene el estado online con heartbeat propio;
- conserva el refresh token cifrado mediante Windows DPAPI para la cuenta de usuario actual.

## Activación después de actualizar

1. Compila e instala de nuevo `windows-native-host/StartabWindowsVolume.exe` mediante `windows-native-host/build.bat`.
2. Recarga StarTab en Chrome.
3. Cierra sesión e inicia sesión una vez en StarTab para enlazar Firebase con el agente v2.8.0.
4. Prueba los controles y luego cierra Chrome completamente en el PC principal. Los controles del sistema deben continuar disponibles desde el otro dispositivo.

Las funciones que controlan contenido *dentro de Chrome* requieren Chrome abierto, porque esas pestañas dejan de existir al cerrar el navegador.
