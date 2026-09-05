# StarTab · Open Tab remoto por Firebase

Flujo implementado:

1. El móvil escribe `openTab` en `users/{uid}/mediaRemote/command`.
2. El documento incluye `targetDeviceId`, `tabId`, `windowId`, `pageUrl`, `clientAt` e `id` único.
3. El dispositivo principal recibe el snapshot desde el puente offscreen persistente, incluso si no hay una pestaña de StarTab abierta.
4. Para `openTab`, el puente envía `STARTAB_MEDIA_OPEN_TAB` al service worker.
5. El service worker localiza la pestaña por `tabId`; si ya no existe, intenta recuperarla por `pageUrl`/ventana.
6. Si la ventana está minimizada se restaura, la pestaña se activa y la ventana recibe foco.
7. El dispositivo principal escribe `processedId` y `commandResult` en el mismo documento Firebase como confirmación.

La orden caduca para evitar ejecutar clics antiguos después de una desconexión prolongada.
