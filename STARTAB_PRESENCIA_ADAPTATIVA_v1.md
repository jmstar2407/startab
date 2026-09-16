# StarTab · Presencia adaptativa + canal realtime

Esta entrega cambia la comunicación de presencia para que PC/TV no generen lecturas continuas cuando están inactivos.

## Arquitectura implementada

- **Google TV**: canal Realtime Database por **SSE** para comandos remotos. Si el canal está disponible, Firestore deja de sondearse continuamente y solo se consulta cada ~120 s como compatibilidad con clientes antiguos.
- **Windows standalone**: mantiene el listener Firestore existente para comandos (ya es event-driven) y mueve el heartbeat/presencia a Realtime Database.
- **Web/Extensión**: escucha presencia RTDB y combina `lastSeen` con el estado Firestore anterior. Si RTDB no está disponible todavía, StarTab sigue funcionando con Firestore.
- **LAN**: WebSocket/directo sigue teniendo prioridad y no pasa movimientos continuos por Firebase cuando la conexión local funciona.

## Modo adaptativo

Cuando el panel de un dispositivo está abierto y la página está visible, StarTab crea un watcher temporal en RTDB.

- Panel abierto: presencia del dispositivo ~cada **10 s**.
- Panel cerrado/inactivo: presencia ~cada **45 s**.
- Watcher web: se renueva ~cada **12 s** y expira solo.
- Con el panel abierto, una presencia de hasta **25 s** se considera fresca; entre **25–45 s** se muestra **Sin respuesta** y después pasa a **No disponible** (salvo que LAN siga respondiendo).
- Con el panel cerrado, la ventana se relaja: hasta **65 s** se considera fresca; entre **65–105 s** se muestra **Sin respuesta** y después **No disponible**.

## Estados

- `online`: dispositivo disponible.
- `standby`: TV conectada pero pantalla/sistema en reposo.
- `unresponsive`: dejó de enviar presencia recientemente.
- `offline`: no disponible (apagado, sin Internet o sin corriente; desde Internet esas causas no siempre pueden distinguirse).
- Si LAN responde pero Firebase no: StarTab puede seguir indicando disponibilidad local.

## Realtime Database requerido

El código usa por defecto:

`https://startab-44e48-default-rtdb.firebaseio.com`

En Firebase Console debe existir Realtime Database para el proyecto `startab-44e48`. Copia las reglas de `realtime-database.rules.json` en **Realtime Database > Rules** y publícalas.

Si Firebase Console muestra una URL de base diferente (por región), sustituye la URL anterior en:

- `startab.bundle.js`
- `auth.js`
- `windows-volume-offscreen.js`
- `windows-native-host/CloudAgent.cs`
- `app/src/main/java/com/startab/tv/FirebaseFallbackAgent.java`

## Compatibilidad / seguridad

Las reglas incluidas limitan lectura y escritura a `auth.uid === $uid`. Los agentes Android/Windows reutilizan el ID token obtenido a partir del refresh token cifrado que StarTab ya guardaba.

> Nota técnica: el `onDisconnect()` nativo se usa desde la capa web/extensión, donde está disponible el SDK RTDB. Los agentes Android/Windows actuales usan REST/SSE para conservar el emparejamiento existente; por eso su protección ante corte brusco se basa en `lastSeen` + expiración adaptativa. De este modo un corte de luz o Internet termina en **Sin respuesta/No disponible** aunque el proceso no alcance a publicar `offline`.

Si RTDB todavía no está creado o las reglas no están publicadas:

- TV vuelve automáticamente al fallback Firestore existente.
- Windows publica un heartbeat Firestore mínimo cada ~60 s como fallback.
- No se pierde el control remoto existente.
