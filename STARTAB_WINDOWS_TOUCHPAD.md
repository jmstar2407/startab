# StarTab · Touchpad remoto de Windows · Stable + Haptics + Keyboard

## Arquitectura

Esta versión vuelve al pipeline estable de v2.2 para el movimiento del cursor:

`Pointer Events -> requestAnimationFrame -> JSON -> WebRTC DataChannel -> Offscreen -> Native Messaging -> EXE -> SendInput`

No usa `pointerrawupdate`, paquetes binarios ni el fast path experimental de la edición UltraLowLatency. Firestore sigue siendo señalización y respaldo cuando WebRTC no está disponible.

## Funciones

- Touchpad relativo para mover el cursor.
- Toque corto = clic izquierdo.
- Botones dedicados de clic izquierdo y derecho.
- Banda vertical de **SCROLL** a la derecha: dedo hacia arriba = scroll arriba; dedo hacia abajo = scroll abajo.
- Barra de **TECLADO REMOTO** sobre el touchpad para escribir en Windows usando el teclado del móvil.
- Modo **ARRASTRAR** dentro del touchpad: mantiene pulsado el clic izquierdo mientras mueves el cursor; el estado activo se resalta en morado.
- Modal elevado al `body` con `z-index: 2147483647` para quedar por encima del resto de StarTab.
- Respuesta háptica en móviles compatibles: textura ligera al mover, ticks de scroll, clics, dial de volumen y mute.

## Agente Windows

El paquete incluye el agente v2.3.0. El cursor y los clics normales son compatibles desde v2.2.0; v2.2.1 añade `pointerWheel` para el scroll lateral; v2.3.0 añade escritura remota (`textInput`/`keyInput`) y `pointerButton` para mantener pulsado el clic durante el modo ARRASTRAR. Usa `user32!SendInput` y no abre puertos ni se conecta directamente a Firebase.

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

El mismo documento puede contener `motionRelay`, `scrollRelay`, `clickRelay`, `buttonRelay` y `keyboardRelay` cuando se usa el respaldo por Firebase. Los comandos de teclado del respaldo llevan secuencia para conservar el orden.

## Haptics

La vibración se activa solo cuando `navigator.vibrate()` está disponible y el dispositivo tiene entrada táctil/coarse. Los pulsos se agrupan, limitan y se ejecutan fuera del evento de movimiento para que la vibración no frene el touchpad ni el dial de volumen. Si el navegador no ofrece esa API, StarTab continúa funcionando sin vibración.

## Control remoto del PC · agente v2.4.0

StarTab v2.4 del agente añade un panel de control del sistema encima del Touchpad remoto. El nuevo panel permite apagar el monitor, apagar/reiniciar/suspender el PC, cerrar sesión, bloquear Windows y consultar/cambiar Mobile Hotspot.

Compatibilidad por capacidad:
- v2.2.0+: cursor y clics.
- v2.2.1+: scroll remoto.
- v2.3.0+: teclado remoto y clic izquierdo sostenido.
- v2.4.0+: controles del sistema y estado ON/OFF de Mobile Hotspot.

Los controles del sistema usan el mismo documento `users/{uid}/windowsDevices/{deviceId}` y la misma autenticación de StarTab. El estado del hotspot se consulta en Windows mediante la API de tethering de Windows Runtime y se publica como `hotspotState` (`on`, `off`, `unavailable`, `error`) y `hotspotClients`.
