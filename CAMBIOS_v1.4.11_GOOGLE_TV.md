# StarTab v1.4.11 · Google TV

## Nuevo control remoto para Google TV

- Nuevo botón **Google TV** junto al control de cursor en el Centro multimedia.
- Vinculación inicial por **IP local + PIN de 6 dígitos** mostrado en la APK.
- El envío inicial de credenciales se protege con **ECDH P-256 + AES-GCM** durante el emparejamiento local.
- La credencial de Firebase no se guarda en Firestore; la APK la conserva cifrada con **Android Keystore**.
- Selección y persistencia de TVs vinculados por usuario.
- Touchpad remoto con movimiento relativo, clic, scroll y botón Atrás.
- Control de volumen del Google TV cuando Android no usa una política de volumen fijo.

## Transporte híbrido

1. **LAN directo**: StarTab intenta conectar por WebSocket a `ws://IP_DEL_TV:8765` para respuesta de baja latencia.
2. **Firebase fallback**: si la conexión local no está disponible, StarTab escribe comandos en `users/{uid}/tvDevices/{deviceId}` y la APK los procesa desde Firestore.
3. El fallback entra en modo de lectura rápida solo durante una sesión activa para no mantener lecturas intensivas todo el día.

## Requisito de Firestore

Añade esta regla dentro de `match /databases/{database}/documents`:

```rules
match /users/{uid}/tvDevices/{deviceId} {
  allow read, create, update, delete: if request.auth != null && request.auth.uid == uid;
}
```

## APK / proyecto Android

El proyecto Android se entrega por separado como `StarTabGoogleTV_Source.zip`.
