const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'users.json');
const VERIFY_TTL = 24 * 3600 * 1000;
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const IS_PROD = process.env.NODE_ENV === 'production';

let db = { users: {}, sessions: {} };
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

async function sendVerification(user, req) {
  const base = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  const link = `${base}/api/verify?token=${user.verifyToken}`;
  if (!mailer) {
    console.log(`\n[correo simulado] Verificación para ${user.email}:\n${link}\n`);
    return link;
  }
  await mailer.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: user.email,
    subject: 'Verifica tu cuenta de ¿Quién Miente?',
    text: `Hola ${user.name}, confirma tu correo entrando a: ${link}`,
    html: `<p>Hola <b>${user.name}</b>,</p><p>Confirma tu correo para empezar a jugar:</p><p><a href="${link}">Verificar mi cuenta</a></p><p>El enlace vence en 24 horas.</p>`,
  });
  return null;
}

const findByEmail = (email) => Object.values(db.users).find((u) => u.email === email);
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, chips: u.chips, games: u.games, wins: u.wins });
const cleanName = (n) => String(n || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

function userFromToken(token) {
  const s = typeof token === 'string' && db.sessions[token];
  if (!s || s.expires < Date.now()) return null;
  return db.users[s.userId] || null;
}

function addStats(userId, chips, won) {
  const u = db.users[userId];
  if (!u) return;
  u.chips += chips;
  u.games += 1;
  if (won) u.wins += 1;
  save();
}

// Simple in-memory throttle against brute force on login/register.
const hits = new Map();
function throttled(key, max = 10, windowMs = 10 * 60000) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

function routes(app) {
  const bearer = (req) => (req.get('authorization') || '').replace(/^Bearer /, '');

  app.post('/api/register', async (req, res) => {
    if (throttled(`reg:${req.ip}`)) return res.status(429).json({ error: 'Demasiados intentos, espera unos minutos' });
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const name = cleanName(req.body.name);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Correo inválido' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    if (name.length < 2) return res.status(400).json({ error: 'El nombre debe tener al menos 2 letras' });
    let user = findByEmail(email);
    if (user?.verified) return res.status(409).json({ error: 'Ese correo ya tiene una cuenta' });
    const hash = await bcrypt.hash(password, 10);
    if (!user) {
      user = { id: crypto.randomUUID(), email, chips: 0, games: 0, wins: 0, created: Date.now() };
      db.users[user.id] = user;
    }
    Object.assign(user, { name, hash, verified: false, verifyToken: crypto.randomBytes(24).toString('hex'), verifyExpires: Date.now() + VERIFY_TTL });
    save();
    try {
      const devLink = await sendVerification(user, req);
      res.json({ ok: true, devLink: IS_PROD ? undefined : devLink || undefined });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo enviar el correo de verificación' });
    }
  });

  app.post('/api/resend', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (throttled(`resend:${email}`, 3)) return res.status(429).json({ error: 'Espera unos minutos antes de reenviar' });
    const user = findByEmail(email);
    if (!user || user.verified) return res.json({ ok: true });
    user.verifyToken = crypto.randomBytes(24).toString('hex');
    user.verifyExpires = Date.now() + VERIFY_TTL;
    save();
    try {
      const devLink = await sendVerification(user, req);
      res.json({ ok: true, devLink: IS_PROD ? undefined : devLink || undefined });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo enviar el correo' });
    }
  });

  app.get('/api/verify', (req, res) => {
    const token = String(req.query.token || '');
    const user = token && Object.values(db.users).find((u) => u.verifyToken === token);
    if (!user || user.verifyExpires < Date.now()) return res.redirect('/?verified=0');
    user.verified = true;
    user.verifyToken = null;
    save();
    res.redirect('/?verified=1');
  });

  app.post('/api/login', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (throttled(`login:${req.ip}`, 20) || throttled(`login:${email}`, 8)) {
      return res.status(429).json({ error: 'Demasiados intentos, espera unos minutos' });
    }
    const user = findByEmail(email);
    const ok = user && (await bcrypt.compare(String(req.body.password || ''), user.hash));
    if (!ok) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    if (!user.verified) return res.status(403).json({ error: 'Primero verifica tu correo', unverified: true });
    const token = crypto.randomBytes(32).toString('hex');
    db.sessions[token] = { userId: user.id, expires: Date.now() + SESSION_TTL };
    for (const [t, s] of Object.entries(db.sessions)) if (s.expires < Date.now()) delete db.sessions[t];
    save();
    res.json({ token, user: publicUser(user) });
  });

  app.get('/api/me', (req, res) => {
    const user = userFromToken(bearer(req));
    if (!user) return res.status(401).json({ error: 'Sesión expirada' });
    res.json({ user: publicUser(user) });
  });

  app.post('/api/logout', (req, res) => {
    delete db.sessions[bearer(req)];
    save();
    res.json({ ok: true });
  });
}

module.exports = { routes, userFromToken, addStats };
