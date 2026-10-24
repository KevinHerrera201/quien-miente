# ¿Quién Miente?

Juego web multijugador (2–12 jugadores) de mentirosos y detectives, pensado para jugar en una llamada de WhatsApp.

## Correr en tu PC

```bash
npm install
npm start
```

Abre http://localhost:3000. Para probar en el celular dentro de tu misma red WiFi, abre `http://<IP-de-tu-PC>:3000`.

## Correo de verificación

Sin configuración, el enlace de verificación se imprime en la consola y aparece en pantalla (modo desarrollo).
Para enviar correos reales define estas variables de entorno:

| Variable | Ejemplo |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `tucorreo@gmail.com` |
| `SMTP_PASS` | contraseña de aplicación |
| `MAIL_FROM` | `¿Quién Miente? <tucorreo@gmail.com>` |
| `APP_URL` | `https://tu-dominio.com` |
| `NODE_ENV` | `production` (oculta el enlace de desarrollo) |

## Estructura

- `server/index.js` – servidor web + Socket.IO
- `server/game.js` – reglas y estado de las salas
- `server/auth.js` – cuentas, verificación por correo, sesiones (guardadas en `data/users.json`)
- `server/questions.js` – banco de preguntas por nivel
- `public/` – interfaz (HTML/CSS/JS sin frameworks)
