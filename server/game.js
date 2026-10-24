const crypto = require('crypto');
const { LEVELS, CATEGORIES } = require('./questions');

const MAX_PLAYERS = 12;
const MIN_PLAYERS = 2;
const ROLE_MS = 6000;
const FLIP_MS = 1200;
const PICK_MS = 60000;
const RESULT_MS = 7000;
const ROUND_MS = 5000;
const CHIPS_PER_HIT = 5;
const LIVES = 3;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const DEFAULT_SETTINGS = { numQuestions: 5, level: 'panales', hints: 1, answerTime: 6, revealTime: 20, numDetectives: 1 };

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pickRandom = (arr) => arr[crypto.randomInt(arr.length)];

function sanitizeSettings(s = {}) {
  const n = (v, min, max, d) => {
    v = parseInt(v, 10);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
  };
  return {
    numQuestions: n(s.numQuestions, 5, 10, DEFAULT_SETTINGS.numQuestions),
    level: LEVELS[s.level] ? s.level : DEFAULT_SETTINGS.level,
    hints: n(s.hints, 0, 3, DEFAULT_SETTINGS.hints),
    answerTime: n(s.answerTime, 4, 15, DEFAULT_SETTINGS.answerTime),
    revealTime: n(s.revealTime, 10, 40, DEFAULT_SETTINGS.revealTime),
    numDetectives: n(s.numDetectives, 1, 3, DEFAULT_SETTINGS.numDetectives),
  };
}

const STOP_WORDS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'mi', 'mis', 'de', 'del', 'y', 'al']);

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join('');
}

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Tolerant comparison: typos, accents and articles shouldn't turn a truthful repeat into a "lie".
function answersMatch(written, spoken) {
  const a = normalize(written);
  const b = normalize(spoken);
  if (!a || !b) return a === b;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return true;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length) >= 0.75;
}

function cleanName(name) {
  return String(name || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

class Room {
  constructor(mgr, code) {
    this.mgr = mgr;
    this.code = code;
    this.players = [];
    this.hostId = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.phase = 'lobby';
    this.timer = null;
    this.deadline = null;
    this.usedQuestionIds = new Set();
    this.log = [];
    this.resetGame();
  }

  resetGame() {
    this.round = 0;
    this.questions = [];
    this.liarData = {};
    this.detectiveOrder = [];
    this.liarOrder = [];
    this.detIdx = -1;
    this.turn = null;
    this.result = null;
    this.winner = null;
    this.lastTargetByDet = {};
    this.answerStart = null;
    this.log = [];
  }

  get(id) {
    return this.players.find((p) => p.id === id);
  }

  addLog(text) {
    this.log.push({ t: Date.now(), text });
    if (this.log.length > 30) this.log.shift();
  }

  emitAll() {
    for (const p of this.players) {
      if (p.socketId) this.mgr.io.to(p.socketId).emit('state', this.view(p));
    }
  }

  setPhase(phase, ms, next) {
    clearTimeout(this.timer);
    this.timer = null;
    this.phase = phase;
    this.deadline = ms ? Date.now() + ms : null;
    if (ms && next) {
      this.timer = setTimeout(() => {
        try { next(); } catch (e) { console.error(e); }
      }, ms);
    }
    this.emitAll();
  }

  inGame() {
    return !['lobby', 'gameover'].includes(this.phase);
  }

  addPlayer({ key, name, userId }) {
    let finalName = name;
    let i = 2;
    while (this.players.some((p) => p.name.toLowerCase() === finalName.toLowerCase())) finalName = `${name.slice(0, 13)}${i++}`;
    const p = {
      id: crypto.randomBytes(6).toString('hex'),
      key, name: finalName, userId,
      socketId: null, connected: false,
      role: null, lives: LIVES, chips: 0, alive: true, hintsLeft: 0,
      dropTimer: null,
    };
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    return p;
  }

  removePlayer(pid) {
    const p = this.get(pid);
    if (!p) return;
    clearTimeout(p.dropTimer);
    this.players = this.players.filter((x) => x !== p);
    if (!this.players.length) return this.mgr.remove(this.code);
    if (this.hostId === pid) this.hostId = (this.players.find((x) => x.connected) || this.players[0]).id;

    if (this.inGame()) {
      this.addLog(`${p.name} salió de la partida`);
      this.liarOrder = this.liarOrder.filter((id) => id !== pid);
      this.detectiveOrder = this.detectiveOrder.filter((id) => id !== pid);
      delete this.liarData[pid];
      if (this.phase === 'answering' && this.allAnswered()) return this.startInterrogation();
      if (['pick', 'question'].includes(this.phase) && (this.turn?.detectiveId === pid || this.turn?.liarId === pid)) {
        return this.nextTurn();
      }
      if (this.checkWin()) return;
    }
    this.emitAll();
  }

  onDisconnect(p) {
    p.connected = false;
    p.socketId = null;
    clearTimeout(p.dropTimer);
    // Phones lock their screen often: give players time to come back before dropping them.
    p.dropTimer = setTimeout(() => {
      if (p.connected) return;
      if (this.phase === 'lobby' || this.phase === 'gameover') this.removePlayer(p.id);
      else if (this.hostId === p.id) {
        const other = this.players.find((x) => x.connected);
        if (other) { this.hostId = other.id; this.emitAll(); }
      }
    }, this.phase === 'lobby' ? 90000 : 30000);
    if (!this.players.some((x) => x.connected)) {
      clearTimeout(this.emptyTimer);
      this.emptyTimer = setTimeout(() => {
        if (!this.players.some((x) => x.connected)) this.mgr.remove(this.code);
      }, 10 * 60000);
    }
    this.emitAll();
  }

  updateSettings(byId, s) {
    if (byId !== this.hostId || this.phase !== 'lobby') return { error: 'Solo el admin puede cambiar los ajustes' };
    this.settings = sanitizeSettings({ ...this.settings, ...s });
    this.emitAll();
  }

  kick(byId, pid) {
    if (byId !== this.hostId || this.phase !== 'lobby' || pid === byId) return { error: 'No permitido' };
    const p = this.get(pid);
    if (!p) return;
    if (p.socketId) this.mgr.io.to(p.socketId).emit('kicked');
    this.mgr.detachSocket(p.socketId);
    this.removePlayer(pid);
  }

  start(byId) {
    if (byId !== this.hostId || this.phase !== 'lobby') return { error: 'Solo el admin puede iniciar' };
    const ps = this.players.filter((p) => p.connected);
    if (ps.length < MIN_PLAYERS) return { error: `Se necesitan al menos ${MIN_PLAYERS} jugadores conectados` };
    for (const p of this.players.filter((x) => !x.connected)) clearTimeout(p.dropTimer);
    this.players = ps;
    this.resetGame();
    const nd = Math.min(this.settings.numDetectives, ps.length - 1);
    const dets = new Set(shuffle(ps.map((p) => p.id)).slice(0, nd));
    for (const p of ps) {
      p.role = dets.has(p.id) ? 'detective' : 'liar';
      p.lives = LIVES;
      p.chips = 0;
      p.alive = true;
      p.hintsLeft = this.settings.hints;
    }
    this.detectiveOrder = shuffle([...dets]);
    this.liarOrder = shuffle(ps.filter((p) => p.role === 'liar').map((p) => p.id));
    this.usedQuestionIds.clear();
    this.addLog('¡Comienza la partida!');
    this.setPhase('roles', ROLE_MS, () => this.startRound());
  }

  startRound() {
    this.round++;
    for (const id of this.liarOrder) {
      const p = this.get(id);
      if (p) p.alive = true;
    }
    this.lastTargetByDet = {};
    this.detIdx = -1;
    const pool = LEVELS[this.settings.level].questions;
    let avail = pool.filter((q) => !this.usedQuestionIds.has(q.id));
    if (avail.length < this.settings.numQuestions) {
      this.usedQuestionIds.clear();
      avail = pool;
    }
    this.questions = shuffle(avail).slice(0, this.settings.numQuestions);
    this.questions.forEach((q) => this.usedQuestionIds.add(q.id));
    this.liarData = {};
    for (const id of this.liarOrder) {
      this.liarData[id] = { order: shuffle(this.questions.map((_, i) => i)), answers: {}, asked: new Set() };
    }
    this.addLog(`Ronda ${this.round}: los mentirosos responden`);
    const ms = this.questions.length * (this.settings.answerTime * 1000 + FLIP_MS) + 3000;
    this.answerStart = Date.now();
    this.setPhase('answering', ms, () => this.startInterrogation());
  }

  allAnswered() {
    return this.liarOrder.every((id) => {
      const d = this.liarData[id];
      return !d || Object.keys(d.answers).length >= this.questions.length;
    });
  }

  submitAnswer(pid, qIdx, text) {
    if (this.phase !== 'answering') return;
    const d = this.liarData[pid];
    qIdx = parseInt(qIdx, 10);
    if (!d || !(qIdx >= 0 && qIdx < this.questions.length) || qIdx in d.answers) return;
    d.answers[qIdx] = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (this.allAnswered()) this.startInterrogation();
    else this.emitAll();
  }

  startInterrogation() {
    for (const id of this.liarOrder) {
      const d = this.liarData[id];
      if (!d) continue;
      this.questions.forEach((_, i) => { if (!(i in d.answers)) d.answers[i] = ''; });
    }
    this.addLog('¡Todos a la sala de interrogatorio!');
    this.nextTurn();
  }

  aliveDetectives() {
    return this.detectiveOrder.filter((id) => this.get(id)?.alive);
  }

  liarsWithCards() {
    return this.liarOrder.filter((id) => {
      const p = this.get(id);
      const d = this.liarData[id];
      return p?.alive && d && d.asked.size < this.questions.length;
    });
  }

  eligibleLiars(detId) {
    const liars = this.liarsWithCards();
    if (this.aliveDetectives().length === 1 && liars.length > 1) {
      return liars.filter((id) => id !== this.lastTargetByDet[detId]);
    }
    return liars;
  }

  nextTurn() {
    if (this.checkWin()) return;
    if (!this.liarsWithCards().length) return this.endRound();
    const dets = this.detectiveOrder;
    for (let k = 0; k < dets.length; k++) {
      this.detIdx = (this.detIdx + 1) % dets.length;
      if (this.get(dets[this.detIdx])?.alive) break;
    }
    this.turn = { detectiveId: dets[this.detIdx], liarId: null };
    this.result = null;
    this.setPhase('pick', PICK_MS, () => this.autoPick());
  }

  autoPick() {
    const liarId = pickRandom(this.eligibleLiars(this.turn.detectiveId));
    const d = this.liarData[liarId];
    const free = d.order.map((qi, pos) => ({ qi, pos })).filter((c) => !d.asked.has(c.qi));
    this.pick(this.turn.detectiveId, liarId, pickRandom(free).pos);
  }

  pick(byId, liarId, pos) {
    if (this.phase !== 'pick' || byId !== this.turn?.detectiveId) return { error: 'No es tu turno' };
    if (!this.eligibleLiars(byId).includes(liarId)) return { error: 'No puedes preguntarle a ese jugador ahora' };
    const d = this.liarData[liarId];
    pos = parseInt(pos, 10);
    const qIdx = d.order[pos];
    if (qIdx === undefined || d.asked.has(qIdx)) return { error: 'Esa carta ya se usó' };
    d.asked.add(qIdx);
    this.lastTargetByDet[byId] = liarId;
    this.turn = { detectiveId: byId, liarId, pos, qIdx, decision: null, reanswer: null, reanswered: false, hint: null };
    this.addLog(`${this.get(byId).name} interroga a ${this.get(liarId).name} sobre ${CATEGORIES[this.questions[qIdx].catId].name}`);
    this.setPhase('question', this.settings.revealTime * 1000 + FLIP_MS, () => this.resolve());
  }

  reanswer(byId, text) {
    const t = this.turn;
    if (this.phase !== 'question' || byId !== t.liarId || t.reanswered) return { error: 'No permitido' };
    t.reanswer = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    t.reanswered = true;
    if (t.decision) return this.resolve();
    this.emitAll();
  }

  decide(byId, verdict) {
    const t = this.turn;
    if (this.phase !== 'question' || byId !== t.detectiveId || t.decision) return { error: 'No permitido' };
    if (!['liar', 'truth'].includes(verdict)) return { error: 'Decisión inválida' };
    t.decision = verdict;
    if (t.reanswered) return this.resolve();
    this.emitAll();
  }

  useHint(byId) {
    const t = this.turn;
    const det = this.get(byId);
    if (this.phase !== 'question' || byId !== t.detectiveId || t.hint || !det || det.hintsLeft <= 0) return { error: 'Sin pistas disponibles' };
    det.hintsLeft--;
    const written = this.liarData[t.liarId]?.answers[t.qIdx] || '';
    t.hint = written
      ? `Empieza con "${written[0].toUpperCase()}" y tiene ${written.replace(/\s/g, '').length} letras`
      : 'No escribió nada en esta carta';
    this.emitAll();
  }

  resolve() {
    const t = this.turn;
    const det = this.get(t.detectiveId);
    const liar = this.get(t.liarId);
    if (!det || !liar) return this.nextTurn();
    const written = this.liarData[t.liarId]?.answers[t.qIdx] ?? '';
    const match = t.reanswered ? answersMatch(written, t.reanswer) : false;
    const correct = t.decision ? (t.decision === 'truth') === match : false;
    if (correct) {
      det.chips += CHIPS_PER_HIT;
      liar.alive = false;
      this.addLog(`✅ ${det.name} acertó: ${liar.name} queda eliminado`);
    } else {
      det.lives = Math.max(0, det.lives - 1);
      if (!det.lives) det.alive = false;
      this.addLog(`❌ ${det.name} falló y pierde una vida${det.alive ? '' : ' (eliminado)'}`);
    }
    const q = this.questions[t.qIdx];
    this.result = {
      detectiveId: det.id, liarId: liar.id, catId: q.catId, question: q.text,
      written, reanswer: t.reanswered ? t.reanswer : null, match,
      verdict: t.decision, correct, timeout: !t.decision,
    };
    this.setPhase('result', RESULT_MS, () => this.nextTurn());
  }

  endRound() {
    this.addLog(`Fin de la ronda ${this.round}: se acabaron las cartas`);
    this.setPhase('roundEnd', ROUND_MS, () => this.startRound());
  }

  checkWin() {
    const liarsAlive = this.liarOrder.some((id) => this.get(id)?.alive);
    const detsAlive = this.aliveDetectives().length > 0;
    if (liarsAlive && detsAlive) return false;
    this.winner = detsAlive ? 'detectives' : 'liars';
    this.addLog(this.winner === 'detectives' ? '🕵️ ¡Ganan los detectives!' : '🎭 ¡Ganan los mentirosos!');
    for (const p of this.players) {
      if (p.userId) this.mgr.auth.addStats(p.userId, p.chips, p.role === (this.winner === 'detectives' ? 'detective' : 'liar'));
    }
    this.setPhase('gameover');
    return true;
  }

  backToLobby(byId) {
    if (byId !== this.hostId || this.phase !== 'gameover') return { error: 'Solo el admin puede hacerlo' };
    for (const p of this.players) p.role = null;
    this.resetGame();
    this.setPhase('lobby');
  }

  view(me) {
    const q = (i) => this.questions[i];
    const v = {
      code: this.code,
      serverNow: Date.now(),
      phase: this.phase,
      deadline: this.deadline,
      round: this.round,
      hostId: this.hostId,
      meId: me.id,
      settings: this.settings,
      winner: this.winner,
      log: this.log.slice(-8),
      maxPlayers: MAX_PLAYERS,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, connected: p.connected, guest: !p.userId,
        role: this.phase === 'lobby' ? null : p.role,
        lives: p.lives, chips: p.chips, alive: p.alive,
        hintsLeft: p.role === 'detective' ? p.hintsLeft : 0,
      })),
      detectiveOrder: this.detectiveOrder,
      liarOrder: this.liarOrder,
      numQuestions: this.questions.length,
    };

    if (this.phase === 'answering') {
      v.answering = {
        start: this.answerStart,
        answerTime: this.settings.answerTime,
        flipMs: FLIP_MS,
        progress: this.liarOrder.map((id) => ({ id, done: Object.keys(this.liarData[id]?.answers || {}).length })),
      };
      const d = this.liarData[me.id];
      if (d) {
        v.answering.cards = d.order.map((qi) => ({ qIdx: qi, catId: q(qi).catId, text: q(qi).text }));
        v.answering.answered = Object.keys(d.answers).map(Number);
      }
    }

    if (['pick', 'question', 'result'].includes(this.phase)) {
      v.board = this.liarOrder.map((id) => {
        const d = this.liarData[id];
        return {
          liarId: id,
          cards: d ? d.order.map((qi, pos) => ({
            pos,
            catId: q(qi).catId,
            asked: d.asked.has(qi),
            text: d.asked.has(qi) || id === me.id ? q(qi).text : null,
          })) : [],
        };
      });
      const t = this.turn;
      v.turn = { detectiveId: t.detectiveId, liarId: t.liarId, pos: t.pos ?? null };
      if (this.phase === 'pick' && me.id === t.detectiveId) v.turn.eligible = this.eligibleLiars(me.id);
      if (this.phase !== 'pick') {
        v.turn.catId = q(t.qIdx).catId;
        v.turn.question = q(t.qIdx).text;
        v.turn.decided = !!t.decision;
        v.turn.reanswered = t.reanswered;
        v.turn.flipMs = FLIP_MS;
        if (me.id === t.detectiveId) { v.turn.myDecision = t.decision; v.turn.hint = t.hint; }
        if (me.id === t.liarId) v.turn.myReanswer = t.reanswer;
      }
    }

    if (this.phase === 'result') v.result = this.result;
    return v;
  }
}

class RoomManager {
  constructor(io, auth) {
    this.io = io;
    this.auth = auth;
    this.rooms = new Map();
  }

  newCode() {
    let c;
    do {
      c = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
    } while (this.rooms.has(c));
    return c;
  }

  remove(code) {
    const r = this.rooms.get(code);
    if (!r) return;
    clearTimeout(r.timer);
    clearTimeout(r.emptyTimer);
    for (const p of r.players) clearTimeout(p.dropTimer);
    this.rooms.delete(code);
  }

  detachSocket(socketId) {
    const s = socketId && this.io.sockets.sockets.get(socketId);
    if (s) s.data = {};
  }

  identity(d) {
    const user = d.token ? this.auth.userFromToken(d.token) : null;
    const name = user ? user.name : cleanName(d.name);
    return { name, userId: user ? user.id : null };
  }

  attach(socket, room, player) {
    if (player.socketId && player.socketId !== socket.id) {
      this.io.to(player.socketId).emit('kicked', 'Te conectaste desde otra pestaña');
      this.detachSocket(player.socketId);
    }
    clearTimeout(player.dropTimer);
    clearTimeout(room.emptyTimer);
    player.socketId = socket.id;
    player.connected = true;
    socket.data = { code: room.code, pid: player.id };
    room.emitAll();
  }

  leaveCurrent(socket) {
    const { code, pid } = socket.data || {};
    const room = code && this.rooms.get(code);
    socket.data = {};
    if (room) room.removePlayer(pid);
  }

  handle(socket) {
    const on = (ev, fn) => socket.on(ev, (data, cb) => {
      let r;
      try { r = fn(data || {}); } catch (e) { console.error(e); r = { error: 'Error interno' }; }
      if (typeof cb === 'function') cb(r || { ok: true });
    });
    const ctx = () => {
      const { code, pid } = socket.data || {};
      const room = code && this.rooms.get(code);
      const player = room && room.get(pid);
      return player ? { room, player } : null;
    };
    const withRoom = (fn) => (d) => {
      const c = ctx();
      return c ? fn(c.room, c.player, d) : { error: 'No estás en una sala' };
    };
    const validKey = (k) => typeof k === 'string' && /^[a-zA-Z0-9]{16,64}$/.test(k);

    on('room:create', (d) => {
      if (!validKey(d.playerKey)) return { error: 'Sesión inválida, recarga la página' };
      const id = this.identity(d);
      if (id.name.length < 2) return { error: 'Escribe un nombre de al menos 2 letras' };
      this.leaveCurrent(socket);
      const room = new Room(this, this.newCode());
      this.rooms.set(room.code, room);
      const p = room.addPlayer({ key: d.playerKey, ...id });
      this.attach(socket, room, p);
      return { ok: true, code: room.code };
    });

    on('room:join', (d) => {
      if (!validKey(d.playerKey)) return { error: 'Sesión inválida, recarga la página' };
      const code = String(d.code || '').toUpperCase().trim();
      const room = this.rooms.get(code);
      if (!room) return { error: 'No existe una sala con ese código' };
      const existing = room.players.find((p) => p.key === d.playerKey);
      if (existing) {
        if (socket.data?.code && socket.data.code !== code) this.leaveCurrent(socket);
        this.attach(socket, room, existing);
        return { ok: true, code };
      }
      if (d.rejoinOnly) return { error: 'Ya no estás en esa sala' };
      if (room.phase !== 'lobby') return { error: 'La partida ya empezó, espera a que termine' };
      if (room.players.length >= MAX_PLAYERS) return { error: `La sala está llena (máximo ${MAX_PLAYERS})` };
      const id = this.identity(d);
      if (id.name.length < 2) return { error: 'Escribe un nombre de al menos 2 letras' };
      this.leaveCurrent(socket);
      const p = room.addPlayer({ key: d.playerKey, ...id });
      this.attach(socket, room, p);
      return { ok: true, code };
    });

    on('room:leave', () => { this.leaveCurrent(socket); });
    on('room:settings', withRoom((r, p, d) => r.updateSettings(p.id, d.settings)));
    on('room:kick', withRoom((r, p, d) => r.kick(p.id, d.playerId)));
    on('game:start', withRoom((r, p) => r.start(p.id)));
    on('game:lobby', withRoom((r, p) => r.backToLobby(p.id)));
    on('answer:submit', withRoom((r, p, d) => r.submitAnswer(p.id, d.qIdx, d.text)));
    on('turn:pick', withRoom((r, p, d) => r.pick(p.id, d.liarId, d.pos)));
    on('turn:reanswer', withRoom((r, p, d) => r.reanswer(p.id, d.text)));
    on('turn:decide', withRoom((r, p, d) => r.decide(p.id, d.verdict)));
    on('turn:hint', withRoom((r, p) => r.useHint(p.id)));

    socket.on('disconnect', () => {
      const c = ctx();
      if (c && c.player.socketId === socket.id) c.room.onDisconnect(c.player);
    });
  }
}

module.exports = { RoomManager, answersMatch };
