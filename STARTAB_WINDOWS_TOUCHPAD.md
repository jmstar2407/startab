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

El paquete incluye el agente v2.2.1. El cursor y los clics son compatibles desde v2.2.0; v2.2.1 añade `pointerWheel` para el scroll lateral. Usa `user32!SendInput` y no abre puertos ni se conecta directamente a Firebase.

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

La vibración se activa solo cuando `navigator.vibrate()` está disponible y el dispositivo tiene entrada táctil/coarse. Los pulsos se agrupan, limitan y se ejecutan fuera del evento de movimiento para que la vibración no frene el touchpad ni el dial de volumen. Si el navegador no ofrece esa API, StarTab continúa funcionando sin vibración.
