# ¿Quién Miente?

Juego web multijugador (2–12 jugadores) de mentirosos y detectives, pensado para jugar en una llamada de WhatsApp.
Es una página estática publicada en **GitHub Pages**. Usa **Firebase** para las cuentas (con verificación por correo) y la base de datos en tiempo real.

## Cómo funciona

- `public/` – la página (HTML/CSS/JS sin frameworks).
- `public/engine.js` – reglas de la partida. Corre en el navegador del admin de la sala; si el admin se desconecta, otro jugador toma su lugar.
- `database.rules.json` – reglas de seguridad: cada mentiroso solo lee sus respuestas, y los detectives no ven nada secreto.
- `.github/workflows/pages.yml` – publica `public/` en GitHub Pages en cada push a `main`.

## Configurar Firebase (una sola vez)

1. En https://console.firebase.google.com crea un proyecto (sin Google Analytics).
2. **Authentication → Sign-in method**: activa **Correo electrónico/contraseña** y **Anónimo**.
3. **Authentication → Configuración → Dominios autorizados**: agrega `kevinherrera201.github.io`.
4. **Realtime Database → Crear base de datos** (modo bloqueado). En la pestaña **Reglas**, pega el contenido de `database.rules.json` y publica.
5. **Configuración del proyecto → Tus apps → Web (</>)**: registra la app y copia el objeto `firebaseConfig` en `public/firebase-config.js`.

## Probar en local

```bash
npm start
```

Abre http://localhost:3000. Las pruebas del motor corren con `npm test`.
