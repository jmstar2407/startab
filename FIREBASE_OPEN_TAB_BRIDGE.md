# StarTab · Firebase Open Tab Bridge v5

La apertura remota ya no comparte el mismo documento que play/pause/seek/volumen.

## Mailbox dedicado

El móvil escribe en:

`users/{uid}/mediaRemote/openTabCommand`

El documento offscreen de la extensión escucha este buzón en tiempo real incluso sin una pestaña StarTab abierta. La orden incluye `tabId`, `windowId`, `pageUrl` y `sessionKey`.

El bridge envía `STARTAB_MEDIA_OPEN_TAB` al service worker. El service worker resuelve la pestaña por ID y, si ese ID quedó obsoleto, busca por la URL publicada de la sesión. Después activa la pestaña, restaura la ventana si estaba minimizada y enfoca la ventana.

Cada comando usa un ID único. La PC escribe `processedId` y `commandResult` en el mismo documento. El móvil espera esa confirmación y reintenta una vez con un ID nuevo si no recibe ACK.

La recepción de `openTab` no depende del Web Lock usado para elegir quién publica el estado multimedia; así no puede quedar bloqueada porque una página StarTab visible tenga el liderazgo. El service worker deduplica solicitudes simultáneas por `requestId`.

## Compatibilidad

Si Firestore rechaza `openTabCommand` por reglas antiguas, el móvil reintenta automáticamente usando `users/{uid}/mediaRemote/command`. El documento offscreen detecta `command.action == "openTab"` en ese canal y lo procesa sin depender del Web Lock.
