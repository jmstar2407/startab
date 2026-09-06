# StarTab · Touchpad remoto de Windows

## Qué se agregó

- Botón con icono de cursor al inicio de `multimedia-topbar-actions`.
- Modal responsive de touchpad, a pantalla completa en móvil.
- Movimiento relativo del cursor con Pointer Events y eventos coalescidos.
- Toque corto sobre el touchpad = clic izquierdo.
- Botones dedicados de clic izquierdo y clic derecho.
- WebRTC DataChannel para movimiento de baja latencia.
- Firestore como señalización de WebRTC y como respaldo automático cuando no se logra conexión P2P.
- El documento offscreen mantiene el receptor activo aunque no exista una pestaña de StarTab abierta, mientras Chrome/Edge y la extensión sigan ejecutándose.
- El agente nativo v2.2 usa `user32.dll -> SendInput` para mover el cursor y ejecutar los clics.

## Actualizar el agente de Windows

El EXE anterior (v2.1 o inferior) no entiende los comandos del cursor. En Windows:

1. Cierra completamente Chrome/Edge para liberar el agente anterior.
2. Abre `windows-native-host`.
3. Ejecuta `build.bat` (requiere .NET SDK 8+ solamente para compilar).
4. Ejecuta `dist\\StartabWindowsVolume.exe`.
5. Pega el ID de tu extensión StarTab cuando lo solicite.
6. Abre Chrome/Edge y recarga la extensión.

El panel del touchpad comprueba `agentVersion` y avisará **Actualiza EXE** si el PC todavía usa una versión anterior a 2.2.

## Firestore

Además del acceso a `users/{uid}/windowsDevices/{deviceId}`, las reglas deben permitir las sesiones efímeras:

```text
users/{uid}/windowsDevices/{deviceId}/pointerSessions/{sessionId}
```

Usa el bloque incluido en `windows-native-host/firestore.rules.snippet` si tus reglas actuales no cubren subcolecciones con un wildcard más amplio.

## Transporte

El movimiento intenta primero:

`Móvil -> Firestore (señalización) -> WebRTC DataChannel -> Offscreen de StarTab -> Native Messaging -> EXE -> SendInput`

Si la red/NAT impide WebRTC, cambia automáticamente a:

`Móvil -> Firestore (relay coalescido) -> Offscreen de StarTab -> Native Messaging -> EXE -> SendInput`

El EXE no contiene credenciales, no abre un servidor y no se conecta directamente a Firebase.
