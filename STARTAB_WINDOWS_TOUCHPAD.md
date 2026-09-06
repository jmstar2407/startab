# StarTab · Touchpad remoto de Windows

## Qué se agregó

- Botón con icono de cursor al inicio de `multimedia-topbar-actions`.
- Modal responsive de touchpad, a pantalla completa en móvil.
- Movimiento relativo con `pointerrawupdate` cuando Chromium lo ofrece y fallback a Pointer Events + eventos coalescidos.
- Toque corto sobre el touchpad = clic izquierdo.
- Botones dedicados de clic izquierdo y clic derecho.
- Zona vertical de scroll a la derecha del touchpad: deslizar hacia arriba sube y hacia abajo baja.
- Fast path interno con `chrome.runtime.Port` persistente desde offscreen al service worker y Native Messaging.
- WebRTC DataChannel P2P con paquetes binarios compactos; movimiento/scroll usan canal no ordenado y sin retransmisión para minimizar latencia.
- Firestore como señalización de WebRTC y como respaldo automático cuando no se logra conexión P2P.
- El documento offscreen mantiene el receptor activo aunque no exista una pestaña de StarTab abierta, mientras Chrome/Edge y la extensión sigan ejecutándose.
- El agente nativo v2.3 usa `user32.dll -> SendInput` para mover el cursor, inyectar scroll vertical y ejecutar los clics.

## Actualizar el agente de Windows

El EXE anterior (v2.2 o inferior) no incluye el nuevo comando de scroll ni el protocolo fast-path v2.3. En Windows:

1. Cierra completamente Chrome/Edge para liberar el agente anterior.
2. Abre `windows-native-host`.
3. Ejecuta `build.bat` (requiere .NET SDK 8+ solamente para compilar).
4. Ejecuta `dist\\StartabWindowsVolume.exe`.
5. Pega el ID de tu extensión StarTab cuando lo solicite.
6. Abre Chrome/Edge y recarga la extensión.

El panel del touchpad comprueba `agentVersion` y avisará **Actualiza EXE** si el PC todavía usa una versión anterior a 2.3.

## Firestore

Además del acceso a `users/{uid}/windowsDevices/{deviceId}`, las reglas deben permitir las sesiones efímeras:

```text
users/{uid}/windowsDevices/{deviceId}/pointerSessions/{sessionId}
```

Usa el bloque incluido en `windows-native-host/firestore.rules.snippet` si tus reglas actuales no cubren subcolecciones con un wildcard más amplio.

## Transporte

El movimiento intenta primero:

`Móvil -> Firestore (solo señalización) -> WebRTC DataChannel binario P2P -> Offscreen -> runtime.Port persistente -> Native Messaging -> EXE -> SendInput`

Si la red/NAT impide WebRTC, cambia automáticamente a:

`Móvil -> Firestore (relay coalescido) -> Offscreen de StarTab -> Native Messaging -> EXE -> SendInput`

El EXE no contiene credenciales, no abre un servidor y no se conecta directamente a Firebase.


## Por qué no WebTransport para este control

WebTransport es una tecnología HTTP/3/QUIC moderna para cliente-servidor, pero requiere un servidor HTTP/3 intermedio. Para el movimiento del cursor, cuando WebRTC logra ruta P2P, añadir ese servidor supondría un salto de red adicional. Por eso StarTab conserva WebRTC P2P para el fast path y Firebase únicamente para señalización/respaldo.
