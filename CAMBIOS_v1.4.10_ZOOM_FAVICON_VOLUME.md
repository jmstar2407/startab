# StarTab v1.4.10 · Ajustes móvil, favicon y volumen

- Zoom web bloqueado únicamente en dispositivos/mode móvil; el escritorio conserva el zoom normal del navegador.
- Favicon de la interfaz principal y autenticación cambiado a `icono.png` ubicado en la raíz.
- Botones `-` y `+` de volumen actualizan la UI inmediatamente.
- Los cambios rápidos de volumen se coalescen y se envían a Firebase en orden, conservando siempre el valor más reciente.
- Se evita que una respuesta/error de una solicitud antigua revierta un ajuste de volumen más nuevo.
