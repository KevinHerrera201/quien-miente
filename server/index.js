const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const auth = require('./auth');
const { RoomManager } = require('./game');
const { CATEGORIES, LEVELS } = require('./questions');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/catalog', (req, res) => {
  const levels = Object.fromEntries(Object.entries(LEVELS).map(([k, l]) => [k, { label: l.label, emoji: l.emoji }]));
  res.json({ categories: CATEGORIES, levels });
});
auth.routes(app);

const server = http.createServer(app);
const io = new Server(server);
const rooms = new RoomManager(io, auth);
io.on('connection', (socket) => rooms.handle(socket));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`¿Quién Miente? escuchando en http://localhost:${PORT}`));
