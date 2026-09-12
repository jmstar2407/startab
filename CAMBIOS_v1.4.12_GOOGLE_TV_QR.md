# StarTab v1.4.12 · Google TV QR

- Emparejamiento de Google TV mediante código QR; ya no se escribe IP/PIN.
- Acceso a cámara con `getUserMedia`, priorizando la cámara trasera.
- Lectura de QR con `BarcodeDetector` del navegador.
- El QR `startabtv://pair` contiene IP, puerto y PIN temporal y conserva el intercambio cifrado ECDH/AES-GCM existente.
- La cámara se detiene al detectar, cancelar o cerrar el modal.
- Modal de Google TV elevado a la capa superior de StarTab.
- Estructura del modal separada en header/body/footer.
- Solo el body del modal principal tiene scroll.
- Escáner QR con modal propio por encima del control remoto.
