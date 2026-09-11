# StarTab v1.4.10 · Selector global de PC

## Cambio principal

`windows-device-select` pasa a ser la única fuente de verdad para seleccionar qué PC se desea ver y controlar. Se elimina el concepto y el botón **Hacer principal**.

Al cambiar el selector se cambia en conjunto:

- Volumen maestro de Windows.
- Touchpad, mouse, scroll y teclado remoto.
- Acciones del sistema (monitor, bloqueo, suspensión, reinicio, apagado y cierre de sesión).
- Mobile Hotspot.
- OpenRGB / iluminación RGB.
- Pestañas multimedia detectadas en Chrome.
- Reproducir, pausar, anterior/siguiente, búsqueda, volumen de la pestaña, abrir pestaña y cerrar pestaña.

## Multimedia por dispositivo

Cada PC publica sus sesiones en Firestore usando el mismo `deviceId` del agente Windows:

- `users/{uid}/mediaRemote/state_{deviceId}`
- `users/{uid}/mediaRemote/command_{deviceId}`

Esto permite tener varias PCs conectadas simultáneamente sin mezclar pestañas ni comandos. El documento offscreen de cada Chrome publica siempre las sesiones de **su propia PC**, aunque en la interfaz de esa PC se haya seleccionado otro equipo.

## Comportamiento

- Si seleccionas PC A, todo StarTab apunta a PC A.
- Si cambias a PC B, multimedia y controles cambian inmediatamente a PC B.
- La última selección se conserva en `startab_windows_volume_selected_device_v2`.
- El cursor de baja latencia WebRTC continúa usando el PC seleccionado; Firebase queda como respaldo.
- El agente standalone de Windows continúa funcionando con Chrome cerrado para las funciones del sistema. Las pestañas multimedia requieren Chrome abierto en el PC seleccionado porque las pestañas dejan de existir al cerrar el navegador.

## Instalación

No requiere recompilar el EXE v2.8.0. Reemplaza/recarga la extensión desde `chrome://extensions`.
