# StarTab · Control remoto de Windows v2.2

## Arquitectura simplificada

El agente Windows **ya no usa Firebase** y no necesita Email/Password, Node.js, npm ni un servidor HTTP local.

Flujo:

`Windows Core Audio + Win32 SendInput ↔ StartabWindowsVolume.exe ↔ Native Messaging ↔ StarTab ↔ Firestore/WebRTC ↔ StarTab móvil`

- `StartabWindowsVolume.exe` solo controla y observa el volumen real de Windows.
- La extensión StarTab mantiene la conexión con el EXE.
- StarTab es quien publica estado y escucha órdenes en Firestore.
- Desde móvil se escribe la orden en Firestore; StarTab del PC la recibe y la entrega al EXE.

## 1. Compilar

En Windows, entra en `windows-native-host` y ejecuta:

`build.bat`

Se generará:

`windows-native-host\dist\StartabWindowsVolume.exe`

Necesitas .NET SDK 8+ **solo para compilar**. El EXE publicado es autocontenido.

## 2. Instalar el Native Messaging Host

1. Abre `chrome://extensions`.
2. Activa `Modo de desarrollador`.
3. Copia el ID de StarTab.
4. Ejecuta `StartabWindowsVolume.exe` con doble clic y pega ese ID.
5. Recarga StarTab.

También puedes ejecutar:

`StartabWindowsVolume.exe --install ID_DE_LA_EXTENSION`

No requiere administrador: se registra bajo `HKCU` y se copia a `%LOCALAPPDATA%\StarTab\WindowsVolume`.

## 3. Firestore

El agente no necesita ningún proveedor de Firebase Authentication.

StarTab utiliza `users/{uid}/windowsDevices/{deviceId}`. Si tus reglas ya protegen todo `users/{uid}`, conserva esa protección. En `windows-native-host/firestore.rules.snippet` hay un bloque mínimo de referencia.

## 4. Funcionamiento remoto

Mientras Chrome/Edge y la extensión estén ejecutándose en el PC, el service worker mantiene el enlace Native Messaging y un documento offscreen de StarTab mantiene la sincronización Firestore. No hace falta dejar abierta una pestaña de Startab.

Los cambios hechos desde el mezclador/teclas de Windows llegan por callbacks de Core Audio; no se hace polling del volumen. Solo se actualiza periódicamente la presencia del dispositivo para determinar si está online.

## Control multimedia remoto sin una pestaña de StarTab abierta

Esta versión mantiene el puente `mediaRemote` dentro del documento offscreen de Manifest V3. Mientras Chrome/Edge y la extensión estén ejecutándose, no es necesario conservar una pestaña de StarTab abierta para que el dispositivo principal publique las sesiones multimedia o reciba comandos desde el móvil.

- Heartbeat del dispositivo principal: cada 12 s mientras esté activo.
- El panel remoto considera perdido al principal si deja de actualizarse durante ~30 s.
- Al volver la red o reanudarse el PC, el bridge publica presencia/estado nuevamente y Firestore actualiza el móvil automáticamente.
- Si se cierra completamente Chrome/Edge, la extensión deja de ejecutarse; el móvil marcará el dispositivo como desconectado por expiración del heartbeat.


## Touchpad remoto

El botón con icono de cursor dentro de **Controles multimedia** abre un touchpad remoto. El móvil usa Firestore para señalizar la sesión y, cuando es posible, crea un **WebRTC DataChannel** directo con el documento offscreen del PC para enviar movimientos con baja latencia. Si WebRTC no logra establecerse por la red/NAT, StarTab usa automáticamente un modo de respaldo por Firestore.

El agente nativo v2.2 ejecuta el movimiento y los clics mediante `SendInput` de Windows. El EXE sigue sin conectarse directamente a Firebase.

Rutas adicionales usadas:

`users/{uid}/windowsDevices/{deviceId}/pointerSessions/{sessionId}`

Asegúrate de añadir también el bloque `pointerSessions` incluido en `windows-native-host/firestore.rules.snippet`.
