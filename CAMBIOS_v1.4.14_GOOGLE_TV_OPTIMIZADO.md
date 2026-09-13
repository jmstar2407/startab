# StarTab v1.4.14 · Google TV optimizado

- Eliminado el `firebaseMerge({})` que escribía en `tvDevices` cada 1.4 s con el modal abierto.
- Presencia del TV compatible con heartbeat de 5 minutos (`DEVICE_STALE_MS` ampliado).
- `controlLease` solo se renueva cuando realmente se envía una orden por Firebase.
- Se mantiene sin cambios el relay rápido del cursor por Firebase.
- Rediseño completo del modal: header más compacto, superficies limpias, menos gradientes y cruceta nueva en cuadrícula 3x3.
- Botones y tarjetas más pequeños y consistentes en móvil.
