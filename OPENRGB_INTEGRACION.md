# StarTab · OpenRGB (Windows Agent v2.5.0)

## Qué se añadió

- Nueva tarjeta **Iluminación RGB** debajo de **Mobile Hotspot** en el modal de Control del PC principal.
- Encendido/apagado global de las luces detectadas por OpenRGB.
- Selector de color y 8 colores rápidos.
- Estado ON/OFF, disponibilidad de OpenRGB y transporte usado (SDK/CLI).
- Último color persistente: al volver a encender se reutiliza el último color seleccionado en StarTab.
- Ruta rápida local: si StarTab se está usando en el mismo PC como extensión, el comando RGB va directo por Native Messaging sin pasar por Firestore.
- Ruta remota: desde móvil/web conserva el puente Firestore -> extensión/offscreen -> agente Windows.
- El agente intenta usar el SDK local de OpenRGB en `127.0.0.1:6742` y arrancarlo minimizado si hace falta.
- Fallback CLI si el SDK no está disponible.

## Compilar el agente

1. Instala .NET SDK 8 o superior en Windows.
2. Abre `windows-native-host`.
3. Ejecuta `build.bat`.
4. El EXE se genera en `windows-native-host\dist\StartabWindowsVolume.exe`.
5. Ejecuta el nuevo EXE para instalar/actualizar el host de StarTab.

`build.bat` limpia automáticamente `obj`, `bin` y `dist` antes de compilar.

## OpenRGB

El agente busca `OpenRGB.exe` en la instalación, procesos abiertos, PATH, Registro de Windows y rutas comunes. Para una instalación portable no detectada puedes definir la variable de entorno:

`STARTAB_OPENRGB_PATH=C:\ruta\a\OpenRGB.exe`

Para máxima velocidad conviene que el servidor SDK de OpenRGB esté disponible en el puerto local 6742. El agente intentará iniciarlo automáticamente.

> El control alcanza los dispositivos y zonas que OpenRGB detecte y soporte. Hardware no compatible con OpenRGB no puede controlarse desde StarTab.

## Ajustes de interfaz v2

- Paleta rápida, en orden: `000000`, `FF0000`, `FFFF00`, `00FF00`, `00FFFF`, `0000FF`, `FF00FF`, `FFFFFF`.
- El modal **Control del PC principal** se puede abrir desde el Touchpad remoto y también desde el botón de PC situado junto al botón de cursor del Centro multimedia.
- En pantallas móviles (hasta 760 px), el modal ocupa toda la pantalla (`100dvh`) y usa una transición GPU-friendly basada en `translate3d`: entra desde abajo y sale hacia abajo.
