# StarTab v1.4.9 · Cursor directo + accesos compactos en móvil

- Recupera la ruta WebRTC directa de baja latencia cuando Chrome está abierto en el PC, incluso si el daemon standalone v2.8.0 también está conectado.
- El daemon standalone sigue procesando el fallback por Firestore cuando Chrome está cerrado.
- Cuando ambos están activos, Chrome responde WebRTC pero no vuelve a procesar el mismo relay de Firestore; así se evita duplicar movimientos.
- En móvil, los accesos directos conservan el número de filas configurado. En vez de crear filas adicionales, se reducen las celdas/iconos para que entren las columnas configuradas.
- Reduce al mínimo el padding y margen lateral del área de accesos directos para aprovechar el ancho de la pantalla.
