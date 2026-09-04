# StarTab Windows Volume Host v2

Este agente es deliberadamente pequeño: **no contiene Firebase, no usa Node.js, no abre un servidor HTTP y no guarda credenciales de StarTab**.

La comunicación es:

`Windows Core Audio <-> StartabWindowsVolume.exe <-> Chrome Native Messaging <-> Extensión StarTab <-> Firestore`

## Compilar el EXE

1. Instala **.NET SDK 8 o superior** en Windows.
2. Abre esta carpeta.
3. Ejecuta `build.bat`.
4. El ejecutable se crea en:

   `dist\StartabWindowsVolume.exe`

La publicación es `win-x64`, autocontenida y de un solo archivo. El equipo donde se use el EXE no necesita instalar Node.js.

## Vincularlo a StarTab

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador**.
3. Copia el **ID** de la extensión StarTab.
4. Ejecuta `dist\StartabWindowsVolume.exe` con doble clic.
5. Pega el ID cuando lo solicite.
6. Recarga StarTab en `chrome://extensions`.

También puedes instalarlo desde PowerShell:

```powershell
.\dist\StartabWindowsVolume.exe --install TU_ID_DE_EXTENSION
```

El programa se copia a `%LOCALAPPDATA%\StarTab\WindowsVolume\` y registra el Native Messaging Host para Chrome y Edge bajo `HKCU`, por lo que no requiere permisos de administrador.

## Funcionamiento

Chrome inicia el EXE automáticamente mediante `chrome.runtime.connectNative()` y lo mantiene enlazado mientras Startab lo necesita. El EXE controla el volumen maestro mediante `IAudioEndpointVolume` y recibe eventos de cambios mediante `IAudioEndpointVolumeCallback`.

El `deviceId` se genera una sola vez y se guarda localmente en:

`%LOCALAPPDATA%\StarTab\WindowsVolume\device-id.txt`

## Desinstalar

Ejecuta `uninstall.bat` o:

```powershell
%LOCALAPPDATA%\StarTab\WindowsVolume\StartabWindowsVolume.exe --uninstall
```
