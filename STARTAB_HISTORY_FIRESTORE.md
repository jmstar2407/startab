# StarTab · Historial Firebase

Esta versión registra navegación de marco principal desde el service worker de Manifest V3 y la envía al documento offscreen de StarTab para guardarla aunque no exista una pestaña de StarTab abierta.

## Estructura

`users/{uid}/history/{entryId}`

Cada visita es un documento independiente para evitar el límite de tamaño de un único documento de Firestore. Campos principales:

- `type`: `visit` o `search`
- `title`, `url`, `domain`, `favicon`
- `searchQuery`, `searchEngine`, `searchCategory`
- `clientAt`: timestamp en milisegundos del navegador
- `visitedAt`: `serverTimestamp()` de Firestore
- `tabId`, `windowId`, `transitionType`, `source`

## Centro de pestañas

El botón **Historial** aparece en el encabezado del Centro de pestañas. La vista permite filtrar lo ya cargado, actualizar y cargar páginas adicionales de historial.

## Privacidad

No se registran páginas internas del navegador ni navegación en ventanas de incógnito. El historial se asocia al usuario guardado por StarTab.

## Historial en modo incógnito

Esta versión también registra navegación y búsquedas realizadas en ventanas de incógnito y guarda `incognito: true` en cada entrada correspondiente. El `manifest.json` usa `"incognito": "spanning"` para compartir el mismo contexto de extensión/Firebase entre ventanas normales e incógnitas.

Chrome exige que el usuario habilite manualmente el acceso: `chrome://extensions` → StarTab → Detalles → **Permitir en modo incógnito**. Por seguridad, una extensión no puede activar ese permiso mediante código.
