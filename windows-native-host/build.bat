@echo off
setlocal
cd /d "%~dp0"
where dotnet >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: No se encontro .NET SDK 8 o superior.
  echo Instala el SDK de .NET y vuelve a ejecutar build.bat.
  echo.
  pause
  exit /b 1
)

echo Compilando StarTab Windows Volume para Windows x64...
dotnet publish "StarTab.WindowsVolumeHost.csproj" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false -o "%~dp0dist"
if errorlevel 1 (
  echo.
  echo La compilacion fallo.
  pause
  exit /b 1
)

echo.
echo ==============================================
echo LISTO
echo EXE: %~dp0dist\StartabWindowsVolume.exe
echo ==============================================
echo.
echo Ahora ejecuta ese EXE y pega el ID de StarTab cuando te lo pida.
pause
