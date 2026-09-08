# StarTab · RGB Engine Pro (agente v2.7.0)

## Cambios principales

- Motor OpenRGB persistente mediante SDK local (`127.0.0.1:6742`).
- No abre un proceso OpenRGB nuevo por cada movimiento de brillo/color.
- Cola RGB **latest-only**: mientras se aplica un cambio, los movimientos intermedios se reemplazan por el último valor solicitado.
- El agente Windows también usa un **worker RGB único** con un solo valor pendiente; evita colas de procesos/tareas y garantiza que el último color solicitado sea el que termina aplicado.
- Revisiones de comandos para ignorar estados y órdenes antiguas.
- Ruta directa Extensión → Native Messaging cuando controlas el mismo PC; Firebase queda como transporte remoto para móvil/otro dispositivo.
- Presets corregidos a colores RGB exactos: rojo, naranja, amarillo, verde, cian, azul, violeta y blanco.
- El preset activo queda marcado visualmente.
- ON/OFF conserva el último color y la última intensidad distinta de cero.
- Persistencia de color/brillo con escritura diferida, evitando acceso a disco en cada frame.
- Fallback CLI automático si el servidor SDK no puede utilizarse.

## OpenRGB portable detectado

Se mantiene la detección automática de tu instalación:

`C:\Users\jmsta\Downloads\Programas\OpenRGB_0.9_Windows_64_b5f46e3\OpenRGB Windows 64-bit\OpenRGB.exe`

También puedes establecer `STARTAB_OPENRGB_PATH` apuntando al EXE o a su carpeta.

## Primer arranque

El primer cambio puede tardar un poco más porque StarTab intenta levantar/conectar el servidor SDK de OpenRGB. Una vez conectado, el mismo cliente permanece abierto y los cambios siguientes usan el canal persistente. Si el SDK no responde, StarTab cambia a `OpenRGB CLI` y lo indica en el panel.

## Gigabyte Z390 / RGB Fusion / RAM

StarTab detecta RGB Fusion e informa su presencia, pero no automatiza su interfaz gráfica. El motor v2.7 pide a OpenRGB el modo de software/directo para los controladores expuestos, lo que mejora la fidelidad de colores. Si una memoria RAM solo aparece en RGB Fusion y no en OpenRGB, esa RAM seguirá fuera del control de OpenRGB; el panel no simula que la está controlando.

Evita que RGB Fusion y OpenRGB estén escribiendo simultáneamente sobre el mismo controlador mientras pruebas StarTab, porque un software puede sobreescribir al otro.

## Instalar

1. Ejecuta `windows-native-host\build.bat` con .NET SDK 8 o superior.
2. El build restaura automáticamente la dependencia `OpenRGB.NET`.
3. Ejecuta `windows-native-host\dist\StartabWindowsVolume.exe`.
4. Registra el host con el ID de tu extensión.
5. Recarga StarTab desde `chrome://extensions`.
6. Confirma que el panel muestre `OpenRGB SDK · motor directo`.

El agente debe reportar versión `2.7.0`.
