# StarTab · OpenRGB (Windows Agent v2.7.0)

## Qué se añadió

- Nueva tarjeta **Iluminación RGB** debajo de **Mobile Hotspot** en el modal de Control del PC principal.
- Encendido/apagado global de las luces detectadas por OpenRGB.
- Selector de color y 8 colores rápidos.
- Estado ON/OFF, disponibilidad de OpenRGB y transporte usado (SDK local elevado).
- Último color persistente: al volver a encender se reutiliza el último color seleccionado en StarTab.
- Ruta rápida local: si StarTab se está usando en el mismo PC como extensión, el comando RGB va directo por Native Messaging sin pasar por Firestore.
- Ruta remota: desde móvil/web conserva el puente Firestore -> extensión/offscreen -> agente Windows.
- El agente usa una conexión SDK directa a `127.0.0.1:6742`. La instalación v2.7.0 registra una tarea de Windows con privilegios máximos para iniciar **solo OpenRGB** elevado, minimizado y limitado a localhost.
- StarTab ya no ejecuta `OpenRGB.exe --client` para cada color. Tampoco necesita pedir UAC en cada inicio: la tarea **StarTab OpenRGB Elevated SDK** queda autorizada una sola vez durante la instalación y puede ejecutarse al iniciar sesión o bajo demanda.
- El botón de apagado ahora guarda el modo activo de cada dispositivo (por ejemplo `Rainbow`) y selecciona explícitamente el modo `Off` cuando existe. Al volver a encender, restaura el modo anterior.
- Elegir un color desde StarTab usa `Static` cuando está disponible o `Direct/Custom` como fallback, con pausas cortas y doble escritura para controladores DRAM/SMBus.

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

El servidor SDK debe estar disponible en el puerto local `6742`. StarTab intenta iniciarlo automáticamente con `runas` (Administrador) y `--server --server-host 127.0.0.1 --server-port 6742 --startminimized`. Una vez abierto, los cambios de color se envían directamente por TCP al SDK y no vuelven a lanzar OpenRGB.

> En v2.7.0 Windows debe pedir UAC solamente una vez al instalar/actualizar el agente, cuando se registra la tarea administrativa. Después de eso no debe volver a pedir confirmación en cada inicio de sesión. OpenRGB conserva acceso elevado a SMBus/I2C para detectar la RAM y el agente principal de StarTab permanece sin privilegios elevados.

> El instalador desactiva automáticamente el `Start At Login` propio de OpenRGB (`--autostart-disable`) y lo reemplaza por la tarea elevada de StarTab. Esto evita dos arranques simultáneos y evita que el acceso directo normal de OpenRGB genere un aviso UAC separado.

> El control alcanza los dispositivos y zonas que OpenRGB detecte y soporte. Hardware no compatible con OpenRGB no puede controlarse desde StarTab.

## Ajustes de interfaz v2

- Paleta rápida, en orden: `000000`, `FF0000`, `FFFF00`, `00FF00`, `00FFFF`, `0000FF`, `FF00FF`, `FFFFFF`.
- El modal **Control del PC principal** se puede abrir desde el Touchpad remoto y también desde el botón de PC situado junto al botón de cursor del Centro multimedia.
- En pantallas móviles (hasta 760 px), el modal ocupa toda la pantalla (`100dvh`) y usa una transición GPU-friendly basada en `translate3d`: entra desde abajo y sale hacia abajo.


## Inicio administrativo automático sin UAC repetitivo (v2.7.0)

La tarea creada es `StarTab OpenRGB Elevated SDK` y se ejecuta al iniciar sesión del usuario con `RunLevel=Highest`. Su acción es:

`OpenRGB.exe --server --server-host 127.0.0.1 --server-port 6742 --startminimized`

La tarea tiene instancia única (`IgnoreNew`), no se detiene al pasar a batería, permite reinicio automático si falla y no tiene límite de ejecución. Si OpenRGB se cerró manualmente y StarTab necesita RGB, el agente intenta `schtasks /Run` sobre esa misma tarea, por lo que vuelve a iniciar elevado sin mostrar UAC. El antiguo `runas` queda únicamente como fallback si la tarea no existe o está dañada.
