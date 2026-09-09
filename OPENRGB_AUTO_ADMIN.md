# StarTab · OpenRGB Auto-Admin v2.7.0

## Objetivo

Permitir que OpenRGB conserve privilegios administrativos para detectar/controlar RAM mediante SMBus/I2C sin mostrar la confirmación UAC cada vez que Windows inicia sesión.

## Funcionamiento

1. Ejecuta `windows-native-host\build.bat`.
2. Ejecuta el nuevo `dist\StartabWindowsVolume.exe` e instala el agente normalmente.
3. Si OpenRGB está instalado y todavía no existe la tarea, Windows pedirá permiso de administrador **una sola vez**. Acepta ese aviso.
4. StarTab registra `StarTab OpenRGB Elevated SDK` con privilegios máximos y desactiva el `Start At Login` tradicional de OpenRGB.
5. Desde el siguiente inicio de sesión, OpenRGB arranca minimizado y elevado con el servidor SDK local en `127.0.0.1:6742` sin una nueva confirmación UAC.
6. Si OpenRGB se cierra, StarTab puede iniciar la misma tarea bajo demanda sin UAC y seguir controlando motherboard, GPU y RAM.

No se desactiva UAC de Windows y no se eleva Chrome ni todo StarTab. Solo OpenRGB recibe los privilegios que necesita.
