# StarTab · Control remoto de Windows v2.3.0 · Stable

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

El agente nativo v2.3.0 ejecuta movimiento, scroll, clics, clic sostenido y entrada de teclado mediante `SendInput` de Windows. El movimiento conserva el pipeline estable de v2.2. Compatibilidad: cursor/clic desde v2.2.0, scroll desde v2.2.1 y teclado remoto + modo ARRASTRAR desde v2.3.0. El EXE sigue sin conectarse directamente a Firebase.

Rutas adicionales usadas:

`users/{uid}/windowsDevices/{deviceId}/pointerSessions/{sessionId}`

Asegúrate de añadir también el bloque `pointerSessions` incluido en `windows-native-host/firestore.rules.snippet`. La misma sesión transporta, cuando hace falta el fallback, movimiento, scroll, clic, estado de botón y operaciones ordenadas de teclado.


## Respuesta háptica móvil

StarTab incluye `startab-haptics.js`, una capa ligera que usa la API de vibración del navegador cuando el dispositivo móvil la permite. Produce pulsos cortos y limitados por frecuencia para evitar una vibración continua: textura al desplazar el touchpad, pasos en la banda de scroll, respuesta diferenciada en clic izquierdo/derecho, dientes al girar `windows-volume-dial` y patrón al activar/desactivar mute. En navegadores que no exponen vibración, la interfaz sigue funcionando normalmente sin errores.

## Agente v2.4.0 · control del sistema

Después de compilar e instalar v2.4.0, el mismo agente permite los controles remotos del PC desde el modal Touchpad remoto. No es necesario instalar otro servicio. El panel de PC requiere v2.4.0; las funciones anteriores siguen siendo compatibles con sus versiones mínimas correspondientes.


## Agente v2.5.0 · apagar todas las luces RGB/LED compatibles

En **Control del PC principal** aparece **Apagar luces RGB**. La función requiere `StartabWindowsVolume.exe` v2.5.0 y OpenRGB instalado o disponible junto al agente. El agente detecta OpenRGB automáticamente y el botón informa si no está disponible. Al pulsarlo se intenta apagar, de una sola vez, la iluminación de placa base, RAM, GPU y otros controladores/periféricos que OpenRGB detecte.

Si OpenRGB está instalado en una ruta no estándar, crea la variable de entorno `STARTAB_OPENRGB_PATH` apuntando a `OpenRGB.exe`. Para algunos controladores de placa/RAM puede ser necesario abrir OpenRGB una vez como administrador para habilitar/detectar el hardware.


## Agente v2.6.0 · RGB Studio

El panel de Control del PC ahora permite encender/apagar RGB, escoger color y ajustar intensidad 0-100%. El último ajuste se recuerda localmente. El estado se sincroniza con StarTab remoto. RGB Fusion se detecta como software adicional en equipos Gigabyte, mientras OpenRGB sigue siendo el backend automatizado para los dispositivos que expone.


## Agente v2.7.0 · RGB Engine Pro

Reprograma el transporte RGB para eliminar la latencia de lanzar OpenRGB por cada cambio. El agente usa `OpenRGB.NET` con una conexión SDK persistente, aplica modo de software/directo al hardware compatible, coalesce cambios del slider para conservar solo el valor más reciente y añade `rgbRevision` para descartar respuestas antiguas. En el mismo PC, StarTab intenta enviar RGB directamente por Native Messaging; desde móvil/otro dispositivo mantiene Firebase como transporte remoto. Los presets rápidos ahora usan valores RGB exactos.
