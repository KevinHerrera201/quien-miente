// Prueba el motor de partida contra una base de datos en memoria que imita a Firebase RTDB.
// Uso: npm test
import { HostEngine, answersMatch, toArr } from '../public/engine.js';

let failed = 0;
const ok = (cond, msg) => { console.log(cond ? '✅' : '❌', msg); if (!cond) failed++; };

/* ---------- Fake RTDB ---------- */
const split = (p) => p.split('/').filter(Boolean);
function normalize(v, path) {
  if (v === undefined) throw new Error(`undefined en ${path}`);
  if (v === null || typeof v !== 'object') return v;
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    const n = normalize(val, `${path}/${k}`);
    if (n !== null && !(typeof n === 'object' && !Object.keys(n).length)) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}
function toClient(v) {
  if (v === null || typeof v !== 'object') return v;
  const keys = Object.keys(v);
  const ints = keys.every((k) => /^\d+$/.test(k));
  if (ints) {
    const max = Math.max(...keys.map(Number));
    if (keys.length > max / 2) {
      const arr = [];
      for (const k of keys) arr[Number(k)] = toClient(v[k]);
      return arr;
    }
  }
  return Object.fromEntries(keys.map((k) => [k, toClient(v[k])]));
}
function makeDb() {
  const db = { root: {}, listeners: [] };
  const getAt = (path) => split(path).reduce((n, k) => (n && typeof n === 'object' ? n[k] : undefined), db.root) ?? null;
  const setAt = (path, value) => {
    const parts = split(path);
    const last = parts.pop();
    let node = db.root;
    for (const k of parts) { if (!node[k] || typeof node[k] !== 'object') node[k] = {}; node = node[k]; }
    const v = normalize(value, path);
    if (v === null) delete node[last]; else node[last] = v;
    db.root = normalize(db.root, '') || {};
  };
  const notify = () => {
    for (const l of db.listeners) {
      const v = JSON.stringify(getAt(l.path));
      if (v !== l.last) { l.last = v; l.cb({ val: () => toClient(JSON.parse(v)), exists: () => v !== 'null' }); }
    }
  };
  const fb = {
    ref: (_db, path) => ({ path }),
    update: async (r, obj) => {
      for (const [k, v] of Object.entries(obj)) setAt(`${r.path}/${k}`, v);
      notify();
    },
    onValue: (r, cb) => {
      const l = { path: r.path, cb, last: undefined };
      db.listeners.push(l);
      notify();
      return () => { db.listeners = db.listeners.filter((x) => x !== l); };
    },
  };
  let pushN = 0;
  return {
    db, fb, getAt,
    set: async (path, v) => { setAt(path, v); notify(); },
    push: async (path, v) => { setAt(`${path}/k${String(++pushN).padStart(6, '0')}`, v); notify(); },
  };
}

/* ---------- Test ---------- */
for (const [a, b, exp] of [['Perro', 'el perro', true], ['Pizza', 'Hamburguesa', false], ['Futbol', 'fútbol', true], ['', '', true]]) {
  ok(answersMatch(a, b) === exp, `answersMatch("${a}", "${b}") = ${exp}`);
}

const F = makeDb();
let clock = 1_000_000;
const code = 'TEST1';
const R = (p) => `rooms/${code}/${p}`;
await F.set(R('meta'), { hostUid: 'ana', phase: 'lobby', settings: { numQuestions: 5, level: 'cabrones', answerTime: 4, revealTime: 200, numDetectives: 1 } });
for (const [i, id] of ['ana', 'beto', 'caro'].entries()) {
  await F.set(R(`players/${id}`), { name: id, joinedAt: i, connected: true, lastSeen: clock });
}
const eng = new HostEngine({ db: F.db, fb: F.fb, code, uid: 'ana', now: () => clock });
eng.start();
clearInterval(eng.timer);
const meta = () => toClient(F.getAt(R('meta')));
const pl = (id) => toClient(F.getAt(R(`players/${id}`)));
const run = async (ms = 0) => { clock += ms; await eng.tick(); };

ok(eng.settings.answerTime === 12 && eng.settings.revealTime === 120, 'tiempos fuera de rango se ajustan a 12 s y 2 min');
await eng.updateSettings({ revealTime: 25 });
ok(eng.settings.revealTime === 25 && !('hints' in eng.settings), 'revelar en 25 s y sin pistas');
ok((await eng.startGame()).ok, 'partida iniciada');
ok(meta().phase === 'roles', 'fase de roles');
const dets = toArr(meta().detectiveOrder);
const liars = toArr(meta().liarOrder);
ok(dets.length === 1 && liars.length === 2, `1 detective (${dets}) y 2 mentirosos (${liars})`);
const det = dets[0];

await run(6100);
ok(meta().phase === 'answering', 'fase de respuestas');
const cards = Object.fromEntries(liars.map((id) => [id, toArr(toClient(F.getAt(R(`liar/${id}`))).cards)]));
ok(liars.every((id) => cards[id].length === 5), 'cada mentiroso tiene 5 cartas');
ok(new Set(cards[liars[0]].map((c) => c.text)).size === 5, 'sin preguntas repetidas');
ok(cards[liars[0]].map((c) => c.text).sort().join() === cards[liars[1]].map((c) => c.text).sort().join(), 'mismas preguntas para todos');
ok(toArr(F.getAt(R(`board/${liars[0]}`))).every((c) => !('text' in c)), 'el tablero no revela preguntas');

for (const id of liars) for (const c of cards[id]) await F.set(R(`answers/${id}/${c.qIdx}`), `resp ${c.qIdx}`);
await run();
ok(meta().phase === 'pick', 'todos respondieron: empieza el interrogatorio');
const elig1 = toArr(meta().turn.eligible);
ok(meta().turn.detectiveId === det && elig1.length === 2, 'turno del detective con 2 mentirosos elegibles');

// Turno 1: mentiroso cambia la respuesta y el detective dice VERDAD -> falla
const t1 = elig1[0];
await F.push(R(`input/${liars[0] === t1 ? liars[1] : liars[0]}`), { type: 'pick', liarId: t1, pos: 0, t: 1 });
await run();
ok(meta().phase === 'pick', 'un mentiroso no puede elegir carta');
await F.push(R(`input/${det}`), { type: 'pick', liarId: t1, pos: 0, t: 2 });
await run();
ok(meta().phase === 'question' && meta().turn.question, 'pregunta revelada al voltear la carta');
ok(!JSON.stringify(meta()).includes(`resp ${cards[t1][0].qIdx}`), 'la respuesta escrita sigue oculta');
await F.push(R(`input/${det}`), { type: 'decide', verdict: 'truth', t: 4 });
await run();
ok(meta().phase === 'question' && meta().turn.decided && !('decision' in meta().turn), 'decisión registrada sin revelarla al mentiroso');
await F.push(R(`input/${t1}`), { type: 'reanswer', text: 'algo completamente distinto', t: 5 });
await run();
ok(meta().phase === 'result' && meta().result.correct === false, 'falló: resultado mostrado');
ok(pl(det).lives === 2, 'detective pierde una vida (quedan 2)');
ok(meta().result.written === `resp ${cards[t1][0].qIdx}`, 'al final se revela la respuesta escrita');

// Turno 2: no puede repetir al mismo mentiroso
await run(7100);
const elig2 = toArr(meta().turn.eligible);
ok(meta().phase === 'pick' && !elig2.includes(t1), 'no puede preguntarle dos veces seguidas al mismo mentiroso');
const t2 = elig2[0];
await F.push(R(`input/${det}`), { type: 'pick', liarId: t1, pos: 1, t: 6 });
await run();
ok(meta().phase === 'pick', 'rechaza al mentiroso repetido');
await F.push(R(`input/${det}`), { type: 'pick', liarId: t2, pos: 2, t: 7 });
await run();
ok(meta().deadline === clock + 1200 + 60000, 'antes de responder: 60 s para que el mentiroso conteste');
await run(15000);
await F.push(R(`input/${t2}`), { type: 'reanswer', text: `Resp ${cards[t2][2].qIdx}`, t: 8 });
await run();
ok(meta().phase === 'question' && meta().deadline === clock + 25000, 'al responder empieza el reloj de revelar (25 s)');
await run(24000);
ok(meta().phase === 'question', 'aún no se revela antes de los 25 s');
await F.push(R(`input/${det}`), { type: 'decide', verdict: 'truth', t: 9 });
await run();
ok(meta().result.match && meta().result.correct, 'dijo la verdad y el detective acertó');
ok(pl(t2).alive === false && pl(det).chips === 5, 'mentiroso eliminado y +5 fichas');

// Turno 3: la carta 1 ya usada de t1 no se puede repetir
await run(7100);
const board1 = toArr(F.getAt(R(`board/${t1}`)));
ok(board1[0].asked && board1[0].text, 'carta usada queda visible para todos');
await F.push(R(`input/${det}`), { type: 'pick', liarId: t1, pos: 0, t: 10 });
await run();
ok(meta().phase === 'pick', 'no se puede repetir una carta');

// Tiempo agotado sin elegir: el juego elige solo; sin decisión el detective pierde vida
await run(60100);
ok(meta().phase === 'question' && meta().turn.liarId === t1, 'elección automática al acabarse el tiempo');
await run(30000);
ok(meta().phase === 'question', 'sin respuesta del mentiroso el reloj de revelar no ha empezado');
await run(31300);
ok(meta().phase === 'result' && meta().result.timeout && pl(det).lives === 1, 'nadie respondió a tiempo: el detective pierde vida');

// Último error: detective sin vidas -> ganan los mentirosos
await run(7100);
const free = toArr(F.getAt(R(`board/${t1}`))).find((c) => !c.asked);
await F.push(R(`input/${det}`), { type: 'pick', liarId: t1, pos: free.pos, t: 11 });
await run();
await F.push(R(`input/${det}`), { type: 'decide', verdict: 'liar', t: 12 });
await run();
await F.push(R(`input/${t1}`), { type: 'reanswer', text: `resp ${cards[t1][free.pos].qIdx}`, t: 13 });
await run();
ok(meta().result.correct === false && pl(det).lives === 0, 'detective se queda sin vidas');
await run(7100);
ok(meta().phase === 'gameover' && meta().winner === 'liars', 'ganan los mentirosos');

await eng.backToLobby();
ok(meta().phase === 'lobby' && !pl('beto').role && !F.getAt(R('hostData')), 'regresan a la sala limpia');

// Nueva partida con rondas: si se acaban las cartas, nueva ronda y revive a los eliminados
await eng.updateSettings({ numQuestions: 5 });
await eng.startGame();
await run(6100);
const dets2 = toArr(meta().detectiveOrder);
const liars2 = toArr(meta().liarOrder);
const d2 = dets2[0];
for (const id of liars2) for (const c of toArr(toClient(F.getAt(R(`liar/${id}`))).cards)) await F.set(R(`answers/${id}/${c.qIdx}`), 'x');
await run();
let turns = 0;
while (meta().phase === 'pick' && turns < 20) {
  turns++;
  const target = toArr(meta().turn.eligible)[0];
  const card = toArr(F.getAt(R(`board/${target}`))).find((c) => !c.asked);
  await F.push(R(`input/${d2}`), { type: 'pick', liarId: target, pos: card.pos, t: 100 + turns });
  await run();
  await F.push(R(`input/${target}`), { type: 'reanswer', text: 'x', t: 200 + turns });
  await run();
  // alterna aciertos: sólo acierta en los primeros 2 turnos, luego "falla" diciendo mentiroso
  await F.push(R(`input/${d2}`), { type: 'decide', verdict: 'truth', t: 300 + turns });
  await run();
  await run(7100);
}
ok(meta().phase === 'gameover' && meta().winner === 'detectives', `con aciertos ganan los detectives (${turns} turnos)`);

// Salida de un jugador a media partida
await eng.backToLobby();
await eng.startGame();
await run(6100);
const liars3 = toArr(meta().liarOrder);
await F.set(R(`players/${liars3[0]}`), null);
await run();
ok(!toArr(meta().liarOrder).includes(liars3[0]), 'jugador que sale se quita de la partida');
await F.set(R(`players/${liars3[1]}`), null);
await run();
await run();
ok(meta().phase === 'gameover' && meta().winner === 'detectives', 'si salen todos los mentirosos ganan los detectives');

// 3 detectives y 1 mentiroso: turnos en orden fijo y nueva ronda al acabarse las cartas
await eng.backToLobby();
for (const [i, id] of ['ana', 'beto', 'caro', 'dani'].entries()) {
  await F.set(R(`players/${id}`), { name: id, joinedAt: i, connected: true, lastSeen: clock });
}
await eng.updateSettings({ numDetectives: 3 });
await eng.startGame();
await run(6100);
const order = toArr(meta().detectiveOrder);
const liar = toArr(meta().liarOrder)[0];
ok(order.length === 3, `3 detectives en orden ${order}`);
for (const c of toArr(toClient(F.getAt(R(`liar/${liar}`))).cards)) await F.set(R(`answers/${liar}/${c.qIdx}`), 'x');
await run();
const seen = [];
for (let i = 0; i < 5; i++) {
  const d = meta().turn.detectiveId;
  seen.push(d);
  const card = toArr(F.getAt(R(`board/${liar}`))).find((c) => !c.asked);
  await F.push(R(`input/${d}`), { type: 'pick', liarId: liar, pos: card.pos, t: 400 + i });
  await run();
  await F.push(R(`input/${liar}`), { type: 'reanswer', text: 'x', t: 500 + i });
  await run();
  await F.push(R(`input/${d}`), { type: 'decide', verdict: 'liar', t: 600 + i });
  await run();
  await run(7100);
}
ok(seen.join() === [...order, ...order].slice(0, 5).join(), 'los detectives preguntan siempre en el mismo orden');
ok(meta().phase === 'roundEnd', 'se acabaron las cartas: fin de ronda');
await run(5100);
ok(meta().phase === 'answering' && meta().round === 2, 'empieza la ronda 2 con preguntas nuevas');
const r1 = new Set(toArr(toClient(F.getAt(R(`liar/${liar}`))).cards).map((c) => c.text));
ok(r1.size === 5, 'ronda 2 con 5 cartas nuevas');

eng.stop();
console.log(failed ? `\n${failed} prueba(s) fallaron` : '\n🎉 Todas las pruebas pasaron');
process.exit(failed ? 1 : 0);
