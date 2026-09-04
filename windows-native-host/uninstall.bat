@echo off
setlocal
set "AGENT=%LOCALAPPDATA%\StarTab\WindowsVolume\StartabWindowsVolume.exe"
if exist "%AGENT%" (
  "%AGENT%" --uninstall
) else (
  reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.startab.windows_volume" /f >nul 2>nul
  reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.startab.windows_volume" /f >nul 2>nul
  echo StarTab Windows Volume fue desvinculado.
)
pause
