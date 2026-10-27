// Game master that runs in the room admin's browser. It reads the whole room
// (including secret answers, allowed by the database rules only to the admin)
// and is the only writer of phases, turns and results.
import { CATEGORIES, LEVELS } from './questions.js';
import { sanitizeBet } from './profile.js';

export const C = {
  MAX_PLAYERS: 12,
  MIN_PLAYERS: 2,
  ROLE_MS: 6000,
  FLIP_MS: 1200,
  PICK_MS: 60000,
  REANSWER_MS: 60000,
  RESULT_MS: 7000,
  ROUND_MS: 5000,
  POINTS_PER_HIT: 5,
  DET_LIVES: 3,
  LIAR_LIVES: 2,
  LOBBY_DROP_MS: 90000,
  HOST_TAKEOVER_MS: 15000,
};

export const DEFAULT_SETTINGS = { numQuestions: 5, level: 'panales', answerTime: 12, revealTime: 30, numDetectives: 1, bet: 0 };

export const EMPTY = ' ';

export function toArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return Object.keys(v).sort((a, b) => a - b).map((k) => v[k]);
}

function randInt(n) {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0] % n;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pickRandom = (arr) => arr[randInt(arr.length)];

export function sanitizeSettings(s = {}) {
  const n = (v, min, max, d) => {
    v = parseInt(v, 10);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
  };
  const D = DEFAULT_SETTINGS;
  return {
    numQuestions: n(s.numQuestions, 5, 10, D.numQuestions),
    level: LEVELS[s.level] ? s.level : D.level,
    answerTime: n(s.answerTime, 12, 25, D.answerTime),
    revealTime: n(s.revealTime, 25, 120, D.revealTime),
    numDetectives: n(s.numDetectives, 1, 3, D.numDetectives),
    bet: sanitizeBet(s.bet),
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
export function answersMatch(written, spoken) {
  const a = normalize(written);
  const b = normalize(spoken);
  if (!a || !b) return a === b;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return true;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length) >= 0.75;
}

export class HostEngine {
  constructor({ db, fb, code, uid, now }) {
    Object.assign(this, { db, fb, code, uid, now });
    this.data = {};
    this.unsubs = [];
    this.busy = false;
    this.timer = null;
  }

  start() {
    for (const key of ['meta', 'players', 'board', 'liar', 'answers', 'input', 'hostData']) {
      this.unsubs.push(this.fb.onValue(this.fb.ref(this.db, `rooms/${this.code}/${key}`), (snap) => { this.data[key] = snap.val(); }));
    }
    this.timer = setInterval(() => this.tick(), 250);
  }

  stop() {
    clearInterval(this.timer);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }

  get meta() { return this.data.meta || {}; }
  get players() { return this.data.players || {}; }
  get hd() { return this.data.hostData || {}; }
  get settings() { return sanitizeSettings({ ...DEFAULT_SETTINGS, ...this.meta.settings }); }
  get liarOrder() { return toArr(this.meta.liarOrder); }
  get detectiveOrder() { return toArr(this.meta.detectiveOrder); }
  get questions() { return toArr(this.hd.questions); }
  p(id) { return this.players[id]; }
  inGame() { return !['lobby', 'gameover'].includes(this.meta.phase); }

  write(u) {
    return this.fb.update(this.fb.ref(this.db, `rooms/${this.code}`), u);
  }

  log(u, text) {
    const base = u['meta/log'] || toArr(this.meta.log);
    u['meta/log'] = [...base, text].slice(-8);
  }

  phase(u, phase, ms) {
    u['meta/phase'] = phase;
    u['meta/deadline'] = ms ? this.now() + ms : null;
  }

  async tick() {
    if (this.busy || !this.data.meta || this.meta.hostUid !== this.uid) return;
    this.busy = true;
    try { await this.step(); } catch (e) { console.error('engine', e); } finally { this.busy = false; }
  }

  async step() {
    const m = this.meta;
    const now = this.now();

    const inputs = this.data.input || {};
    for (const [uid, list] of Object.entries(inputs)) {
      const [key, inp] = Object.entries(list || {}).sort((a, b) => (a[1].t || 0) - (b[1].t || 0))[0] || [];
      if (!key) continue;
      await this.write({ [`input/${uid}/${key}`]: null });
      return this.handleInput(uid, inp);
    }

    if (!this.inGame()) {
      const u = {};
      const entries = Object.entries(this.players).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
      entries.forEach(([id, p], i) => {
        if (id === this.uid) return;
        const stale = !p.connected && now - (p.lastSeen || 0) > C.LOBBY_DROP_MS;
        if (stale || (m.phase === 'lobby' && i >= C.MAX_PLAYERS)) u[`players/${id}`] = null;
      });
      if (Object.keys(u).length) await this.write(u);
      return;
    }

    const missing = [...this.liarOrder, ...this.detectiveOrder].filter((id) => !this.p(id));
    if (missing.length) return this.handleLeft(missing);

    if (m.phase === 'answering') {
      if (this.allAnswered()) return this.startInterrogation();
      const progress = Object.fromEntries(this.activeLiars().map((id) => [id, Object.keys(this.data.answers?.[id] || {}).length]));
      if (JSON.stringify(progress) !== JSON.stringify(m.progress || {})) await this.write({ 'meta/progress': progress });
    }

    if (m.deadline && now >= m.deadline) return this.onDeadline();
  }

  onDeadline() {
    switch (this.meta.phase) {
      case 'roles':
      case 'roundEnd': return this.startRound();
      case 'answering': return this.startInterrogation();
      case 'pick': return this.autoPick();
      case 'question': return this.resolve(this.hd.turn || {});
      case 'result': return this.nextTurn();
      default: return null;
    }
  }

  handleInput(uid, inp = {}) {
    switch (inp.type) {
      case 'pick': return this.pick(uid, inp.liarId, inp.pos);
      case 'reanswer': return this.reanswer(uid, inp.text);
      case 'decide': return this.decide(uid, inp.verdict);
      default: return null;
    }
  }

  async handleLeft(missing) {
    const gone = new Set(missing);
    const u = {
      'meta/liarOrder': this.liarOrder.filter((id) => !gone.has(id)),
      'meta/detectiveOrder': this.detectiveOrder.filter((id) => !gone.has(id)),
    };
    for (const id of missing) this.log(u, 'Un jugador salió de la partida');
    await this.write(u);
    const t = this.meta.turn || {};
    if (['pick', 'question'].includes(this.meta.phase) && (gone.has(t.detectiveId) || gone.has(t.liarId))) return this.nextTurn();
    const w = {};
    if (this.checkWin(w)) return this.write(w);
  }

  /* ----- Admin actions (called directly by the admin's UI) ----- */

  updateSettings(s) {
    if (this.meta.phase !== 'lobby') return null;
    return this.write({ 'meta/settings': sanitizeSettings({ ...this.settings, ...s }) });
  }

  kick(pid) {
    if (this.meta.phase !== 'lobby' || pid === this.uid) return null;
    return this.write({ [`players/${pid}`]: null });
  }

  async startGame() {
    if (this.meta.phase !== 'lobby') return { error: 'La partida ya empezó' };
    const all = Object.entries(this.players);
    const ps = all.filter(([, p]) => p.connected).map(([id]) => id);
    if (ps.length < C.MIN_PLAYERS) return { error: `Se necesitan al menos ${C.MIN_PLAYERS} jugadores conectados` };
    const s = this.settings;
    const nd = Math.min(s.numDetectives, ps.length - 1);
    const dets = shuffle(ps).slice(0, nd);
    const bettors = await this.findBettors(ps, s.bet);
    const u = { board: null, liar: null, answers: null, private: null, input: null, hostData: null };
    const bettorRoles = {};
    for (const [id] of all) if (!ps.includes(id)) u[`players/${id}`] = null;
    for (const id of ps) {
      const det = dets.includes(id);
      const role = det ? 'detective' : 'liar';
      if (bettors.includes(id)) bettorRoles[id] = role;
      Object.assign(u, {
        [`players/${id}/role`]: role,
        [`players/${id}/lives`]: det ? C.DET_LIVES : C.LIAR_LIVES,
        [`players/${id}/points`]: 0,
        [`players/${id}/alive`]: true,
      });
    }
    Object.assign(u, {
      'meta/bettors': bettors.length ? bettorRoles : null,
      'meta/bet': bettors.length ? s.bet : 0,
      'meta/detectiveOrder': shuffle(dets),
      'meta/liarOrder': shuffle(ps.filter((id) => !dets.includes(id))),
      'meta/round': 0,
      'meta/winner': null,
      'meta/result': null,
      'meta/turn': null,
      'meta/progress': null,
      'meta/gameId': `${Date.now()}`,
      'meta/log': ['¡Comienza la partida!'],
    });
    this.phase(u, 'roles', C.ROLE_MS);
    await this.write(u);
    return { ok: true };
  }

  // Registered players who can cover the bet put it in the pot; guests play without betting.
  async findBettors(ids, bet) {
    if (!bet) return [];
    const res = await Promise.all(ids.map(async (id) => {
      if (this.p(id)?.guest !== false) return null;
      try {
        const snap = await this.fb.get(this.fb.ref(this.db, `users/${id}/chips`));
        return (snap.val() || 0) >= bet ? id : null;
      } catch { return null; }
    }));
    return res.filter(Boolean);
  }

  backToLobby() {
    if (this.meta.phase !== 'gameover') return null;
    const u = { board: null, liar: null, answers: null, private: null, input: null, hostData: null };
    for (const id of Object.keys(this.players)) {
      for (const k of ['role', 'lives', 'points', 'alive']) u[`players/${id}/${k}`] = null;
    }
    Object.assign(u, {
      'meta/bettors': null, 'meta/bet': null,
      'meta/detectiveOrder': null, 'meta/liarOrder': null, 'meta/round': 0, 'meta/winner': null,
      'meta/result': null, 'meta/turn': null, 'meta/progress': null, 'meta/log': null, 'meta/numQuestions': null,
    });
    this.phase(u, 'lobby');
    return this.write(u);
  }

  /* ----- Game flow ----- */

  startRound() {
    const s = this.settings;
    const round = (this.meta.round || 0) + 1;
    const u = {};
    const pool = LEVELS[s.level].questions;
    let used = { ...(this.hd.usedQ || {}) };
    let avail = pool.filter((q) => !used[q.id]);
    if (avail.length < s.numQuestions) { used = {}; avail = pool; }
    const qs = shuffle(avail).slice(0, s.numQuestions);
    qs.forEach((q) => { used[q.id] = true; });

    u.hostData = { usedQ: used, questions: qs, detIdx: -1 };
    u.answers = null;
    u.private = null;
    u.board = {};
    u.liar = {};
    for (const id of this.activeLiars()) {
      const order = shuffle(qs.map((_, i) => i));
      u.liar[id] = { order, cards: order.map((qi) => ({ qIdx: qi, catId: qs[qi].catId, text: qs[qi].text })) };
      u.board[id] = order.map((qi, pos) => ({ pos, catId: qs[qi].catId, asked: false }));
    }
    Object.assign(u, {
      'meta/round': round,
      'meta/numQuestions': qs.length,
      'meta/answerStart': this.now(),
      'meta/progress': null,
      'meta/turn': null,
      'meta/result': null,
    });
    this.log(u, `Ronda ${round}: los mentirosos responden`);
    this.phase(u, 'answering', qs.length * (s.answerTime * 1000 + C.FLIP_MS) + 3000);
    return this.write(u);
  }

  // Liars still in the game; those who lost both lives sit out the remaining rounds.
  activeLiars() {
    return this.liarOrder.filter((id) => this.p(id)?.alive);
  }

  allAnswered() {
    const n = this.questions.length;
    return n > 0 && this.activeLiars().every((id) => Object.keys(this.data.answers?.[id] || {}).length >= n);
  }

  startInterrogation() {
    const u = {};
    this.log(u, '¡Todos a la sala de interrogatorio!');
    return this.nextTurn(u);
  }

  aliveDetectives() {
    return this.detectiveOrder.filter((id) => this.p(id)?.alive);
  }

  liarsWithCards() {
    return this.liarOrder.filter((id) => {
      const cards = toArr(this.data.board?.[id]);
      return this.p(id)?.alive && cards.some((c) => !c.asked);
    });
  }

  eligibleLiars(detId) {
    const liars = this.liarsWithCards();
    if (this.aliveDetectives().length === 1 && liars.length > 1) {
      return liars.filter((id) => id !== this.hd.lastTarget?.[detId]);
    }
    return liars;
  }

  nextTurn(u = {}) {
    if (this.checkWin(u)) return this.write(u);
    if (!this.liarsWithCards().length) {
      this.log(u, `Fin de la ronda ${this.meta.round}: se acabaron las cartas`);
      this.phase(u, 'roundEnd', C.ROUND_MS);
      return this.write(u);
    }
    const dets = this.detectiveOrder;
    let idx = this.hd.detIdx ?? -1;
    for (let k = 0; k < dets.length; k++) {
      idx = (idx + 1) % dets.length;
      if (this.p(dets[idx])?.alive) break;
    }
    const detId = dets[idx];
    Object.assign(u, {
      'hostData/detIdx': idx,
      'hostData/turn': null,
      private: null,
      'meta/turn': { detectiveId: detId, eligible: this.eligibleLiars(detId) },
      'meta/result': null,
    });
    this.phase(u, 'pick', C.PICK_MS);
    return this.write(u);
  }

  autoPick() {
    const detId = this.meta.turn?.detectiveId;
    const liarId = pickRandom(this.eligibleLiars(detId));
    const free = toArr(this.data.board?.[liarId]).filter((c) => !c.asked);
    return this.pick(detId, liarId, pickRandom(free).pos);
  }

  pick(byId, liarId, pos) {
    if (this.meta.phase !== 'pick' || byId !== this.meta.turn?.detectiveId) return null;
    if (!this.eligibleLiars(byId).includes(liarId)) return null;
    pos = parseInt(pos, 10);
    const card = toArr(this.data.board?.[liarId])[pos];
    const qIdx = toArr(this.data.liar?.[liarId]?.order)[pos];
    if (!card || card.asked || qIdx === undefined) return null;
    const q = this.questions[qIdx];
    const u = {
      [`board/${liarId}/${pos}/asked`]: true,
      [`board/${liarId}/${pos}/text`]: q.text,
      [`hostData/lastTarget/${byId}`]: liarId,
      'hostData/turn': { detectiveId: byId, liarId, pos, qIdx, reanswered: false },
      'meta/turn': { detectiveId: byId, liarId, pos, catId: q.catId, question: q.text, decided: false, reanswered: false },
    };
    this.log(u, `${this.p(byId)?.name} interroga a ${this.p(liarId)?.name} sobre ${CATEGORIES[q.catId].name}`);
    this.phase(u, 'question', C.FLIP_MS + C.REANSWER_MS);
    return this.write(u);
  }

  reanswer(byId, text) {
    const t = this.hd.turn;
    if (this.meta.phase !== 'question' || !t || byId !== t.liarId || t.reanswered) return null;
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60) || EMPTY;
    const next = { ...t, reanswer: clean, reanswered: true };
    if (t.decision) return this.resolve(next);
    // The reveal countdown only starts once the liar has given their answer.
    return this.write({
      'hostData/turn': next,
      'meta/turn/reanswered': true,
      'meta/turn/reanswer': clean,
      'meta/deadline': this.now() + this.settings.revealTime * 1000,
      [`private/${byId}/reanswer`]: clean,
    });
  }

  decide(byId, verdict) {
    const t = this.hd.turn;
    if (this.meta.phase !== 'question' || !t || byId !== t.detectiveId || t.decision) return null;
    if (!['liar', 'truth'].includes(verdict)) return null;
    const next = { ...t, decision: verdict };
    if (t.reanswered) return this.resolve(next);
    return this.write({
      'hostData/turn': next,
      'meta/turn/decided': true,
      [`private/${byId}/decision`]: verdict,
    });
  }

  resolve(t) {
    const det = this.p(t.detectiveId);
    const liar = this.p(t.liarId);
    if (!det || !liar || t.qIdx === undefined) return this.nextTurn();
    const written = String(this.data.answers?.[t.liarId]?.[t.qIdx] ?? '').trim();
    const spoken = t.reanswered ? String(t.reanswer || '').trim() : null;
    const match = spoken !== null && answersMatch(written, spoken);
    const correct = t.decision ? (t.decision === 'truth') === match : false;
    const u = {};
    let liarLives = liar.lives ?? C.LIAR_LIVES;
    if (correct) {
      liarLives = Math.max(0, liarLives - 1);
      u[`players/${t.detectiveId}/points`] = (det.points || 0) + C.POINTS_PER_HIT;
      u[`players/${t.liarId}/lives`] = liarLives;
      if (!liarLives) u[`players/${t.liarId}/alive`] = false;
      this.log(u, liarLives
        ? `✅ ${det.name} acertó: ${liar.name} pierde una vida`
        : `✅ ${det.name} acertó: ${liar.name} queda eliminado`);
    } else {
      const lives = Math.max(0, (det.lives ?? C.DET_LIVES) - 1);
      u[`players/${t.detectiveId}/lives`] = lives;
      if (!lives) u[`players/${t.detectiveId}/alive`] = false;
      this.log(u, `❌ ${det.name} falló y pierde una vida${lives ? '' : ' (eliminado)'}`);
    }
    const q = this.questions[t.qIdx];
    u['hostData/turn'] = t;
    u['meta/turn/decided'] = !!t.decision;
    u['meta/turn/reanswered'] = !!t.reanswered;
    u['meta/result'] = {
      detectiveId: t.detectiveId, liarId: t.liarId, catId: q.catId, question: q.text,
      written, reanswer: spoken, match, verdict: t.decision || null, correct, timeout: !t.decision,
      liarLives,
    };
    this.phase(u, 'result', C.RESULT_MS);
    return this.write(u);
  }

  // Applies the winner to `u` when the game is over. Reads alive flags from `u` first so it sees pending changes.
  checkWin(u) {
    const alive = (id) => (`players/${id}/alive` in u ? u[`players/${id}/alive`] : this.p(id)?.alive);
    const liars = u['meta/liarOrder'] || this.liarOrder;
    const dets = u['meta/detectiveOrder'] || this.detectiveOrder;
    const liarsAlive = liars.some(alive);
    const detsAlive = dets.some(alive);
    if (liarsAlive && detsAlive) return false;
    const winner = detsAlive ? 'detectives' : 'liars';
    u['meta/winner'] = winner;
    this.log(u, winner === 'detectives' ? '🕵️ ¡Ganan los detectives!' : '🎭 ¡Ganan los mentirosos!');
    this.phase(u, 'gameover');
    return true;
  }
}
