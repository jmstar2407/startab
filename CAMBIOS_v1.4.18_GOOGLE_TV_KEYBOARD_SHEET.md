# StarTab v1.4.18 · Google TV Keyboard + Bottom Sheet

- Corrige imágenes Base64 negras en accesos rápidos (CSS background-image prioritario).
- Optimiza imágenes antes de Firestore para reducir tamaño del documento.
- Selector de Google TV movido al header; incluye “Añadir otro TV…”.
- Elimina el footer de selector/+ del control de TV.
- Añade botón de teclado debajo de Input y teclado remoto por LAN/Firebase.
- Añade Backspace y Enter remotos.
- El panel “Volumen del sistema” ahora es un bottom-sheet de altura libre controlado por una barra de arrastre.
- Bordes superiores redondeados en el bottom-sheet.
- Chrome en iPhone: se detectó que el transporte ws:// desde la versión web HTTPS está limitado por WebKit/mixed content; se mantiene Firebase como respaldo seguro.
