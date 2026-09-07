# StarTab · Touchpad remoto de Windows · Stable + Haptics

## Arquitectura

Esta versión vuelve al pipeline estable de v2.2 para el movimiento del cursor:

`Pointer Events -> requestAnimationFrame -> JSON -> WebRTC DataChannel -> Offscreen -> Native Messaging -> EXE -> SendInput`

No usa `pointerrawupdate`, paquetes binarios ni el fast path experimental de v2.3. Firestore sigue siendo señalización y respaldo cuando WebRTC no está disponible.

## Funciones

- Touchpad relativo para mover el cursor.
- Toque corto = clic izquierdo.
- Botones dedicados de clic izquierdo y derecho.
- Banda vertical de **SCROLL** a la derecha: dedo hacia arriba = scroll arriba; dedo hacia abajo = scroll abajo.
- Modal elevado al `body` con `z-index: 2147483647` para quedar por encima del resto de StarTab.
- Respuesta háptica en móviles compatibles: textura ligera al mover, ticks de scroll, clics, dial de volumen y mute.

## Agente Windows

El agente es v2.2.1. Mantiene el comportamiento estable de v2.2 y añade únicamente `pointerWheel` para el scroll. Usa `user32!SendInput` y no abre puertos ni se conecta directamente a Firebase.

Para actualizarlo:

1. Cierra completamente Chrome/Edge.
2. Abre `windows-native-host`.
3. Ejecuta `build.bat` (requiere .NET SDK 8+ para compilar).
4. Ejecuta `dist\StartabWindowsVolume.exe`.
5. Pega el ID de la extensión cuando lo solicite.
6. Abre Chrome/Edge y recarga StarTab.

## Firestore

Las sesiones efímeras siguen usando:

`users/{uid}/windowsDevices/{deviceId}/pointerSessions/{sessionId}`

El mismo documento puede contener `motionRelay`, `scrollRelay` y `clickRelay` cuando se usa el respaldo por Firebase.

## Haptics

La vibración se activa solo cuando `navigator.vibrate()` está disponible y el dispositivo tiene entrada táctil/coarse. Los pulsos se agrupan y limitan para no saturar el motor de vibración. Si el navegador no ofrece esa API, StarTab continúa funcionando sin vibración.
