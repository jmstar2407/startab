# StarTab v1.4.10 · Ajustes móvil, favicon y volumen

- Zoom web bloqueado únicamente en dispositivos/mode móvil; el escritorio conserva el zoom normal del navegador.
- Favicon de la interfaz principal y autenticación cambiado a `icono.png` ubicado en la raíz.
- Botones `-` y `+` de volumen actualizan la UI inmediatamente.
- Los cambios rápidos de volumen se coalescen y se envían a Firebase en orden, conservando siempre el valor más reciente.
- Se evita que una respuesta/error de una solicitud antigua revierta un ajuste de volumen más nuevo.

## Corrección anti-rebote del dial de volumen
- Corregido el salto visual `7 → 6 → 7` al pulsar rápidamente los botones `windows-volume-dial-down` y `windows-volume-dial-up`.
- Un snapshot atrasado de Firestore ya no se considera confirmación si difiere aunque sea por 1 punto del último valor solicitado.
- Mientras exista un comando de volumen en cola o en tránsito, el último valor local conserva prioridad en la UI.
- La interfaz solo abandona el valor optimista cuando el valor remoto coincide exactamente con el objetivo más reciente o cuando realmente falla el envío.
