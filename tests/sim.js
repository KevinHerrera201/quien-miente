// Simula una partida completa: 1 detective y 2 mentirosos. Uso: node tests/sim.js (con el servidor corriendo)
const { io } = require('socket.io-client');
const { answersMatch } = require('../server/game');

const URL = process.env.URL || 'http://localhost:3000';
const assert = (cond, msg) => { if (!cond) { console.error('❌', msg); process.exit(1); } console.log('✅', msg); };

for (const [a, b, exp] of [['Perro', 'el perro', true], ['Guepardo', 'guepardo', true], ['Pizza', 'Hamburguesa', false], ['', '', true], ['Futbol', 'fútbol', true]]) {
  assert(answersMatch(a, b) === exp, `answersMatch("${a}", "${b}") = ${exp}`);
}

function client(name) {
  const s = io(URL, { forceNew: true });
  const c = { s, name, key: `k${name}${'x'.repeat(20)}`, state: null };
  s.on('state', (st) => { c.state = st; c.onState?.(st); });
  c.call = (ev, d = {}) => new Promise((r) => s.emit(ev, d, r));
  return c;
}

(async () => {
  const [a, b, c] = ['Ana', 'Beto', 'Caro'].map(client);
  await new Promise((r) => setTimeout(r, 500));
  const created = await a.call('room:create', { name: a.name, playerKey: a.key });
  assert(created.code?.length === 5, `sala creada ${created.code}`);
  const code = created.code;
  assert((await b.call('room:join', { name: b.name, playerKey: b.key, code })).ok, 'Beto se une');
  assert((await c.call('room:join', { name: c.name, playerKey: c.key, code: code.toLowerCase() })).ok, 'Caro se une (código en minúsculas)');
  assert((await b.call('game:start')).error, 'solo el admin puede iniciar');
  await a.call('room:settings', { settings: { numQuestions: 5, answerTime: 4, revealTime: 10, numDetectives: 1, hints: 1, level: 'cabrones' } });
  assert(a.state.settings.level === 'cabrones', 'ajustes guardados');
  assert((await a.call('game:start')).ok, 'partida iniciada');
  const late = client('Tardío');
  await new Promise((r) => setTimeout(r, 300));
  assert((await late.call('room:join', { name: 'Tardío', playerKey: late.key, code })).error, 'no se puede entrar con la partida empezada');
  late.s.close();

  const all = [a, b, c];
  const byId = (id) => all.find((x) => x.state.meId === id);
  const roles = a.state.players.map((p) => p.role);
  assert(roles.filter((r) => r === 'detective').length === 1 && roles.filter((r) => r === 'liar').length === 2, 'roles: 1 detective, 2 mentirosos');

  // Mentirosos responden
  await new Promise((r) => { const iv = setInterval(() => { if (a.state.phase === 'answering') { clearInterval(iv); r(); } }, 100); });
  const liars = all.filter((x) => x.state.players.find((p) => p.id === x.state.meId).role === 'liar');
  const det = all.find((x) => !liars.includes(x));
  for (const l of liars) {
    const cards = l.state.answering.cards;
    assert(cards.length === 5, `${l.name} recibe 5 cartas`);
    const texts = new Set(cards.map((k) => k.text));
    assert(texts.size === 5, 'sin preguntas repetidas');
    for (const k of cards) await l.call('answer:submit', { qIdx: k.qIdx, text: `resp${k.qIdx}` });
  }
  assert(!det.state.answering?.cards, 'el detective no ve las preguntas');
  const [o1, o2] = liars.map((l) => l.state.answering?.cards?.map((k) => k.qIdx).join());
  console.log('   orden mentiroso 1:', o1, '| orden mentiroso 2:', o2);

  const waitPhase = (p) => new Promise((r) => { const iv = setInterval(() => { if (det.state.phase === p) { clearInterval(iv); r(); } }, 50); });
  await waitPhase('pick');
  assert(det.state.board.every((row) => row.cards.every((k) => k.text === null)), 'cartas ocultas para el detective antes de voltear');

  // Turno 1: el mentiroso cambia su respuesta, el detective dice VERDAD -> falla
  let target = det.state.turn.eligible[0];
  assert((await liars[0].call('turn:pick', { liarId: target, pos: 0 })).error, 'un mentiroso no puede elegir');
  assert((await det.call('turn:pick', { liarId: target, pos: 0 })).ok, 'detective elige carta 1');
  await waitPhase('question');
  assert(det.state.turn.question && !('written' in det.state.turn), 'pregunta visible, respuesta oculta');
  assert((await det.call('turn:hint')).ok && det.state.turn.hint, `pista: ${det.state.turn.hint}`);
  await det.call('turn:decide', { verdict: 'truth' });
  await byId(target).call('turn:reanswer', { text: 'otra cosa totalmente distinta' });
  await waitPhase('result');
  assert(det.state.result.correct === false && det.state.players.find((p) => p.id === det.state.meId).lives === 2, 'falló: pierde 1 vida (quedan 2)');

  // Turno 2: no puede repetir mentiroso
  await waitPhase('pick');
  assert(!det.state.turn.eligible.includes(target), 'no puede preguntar dos veces seguidas al mismo mentiroso');
  const target2 = det.state.turn.eligible[0];
  await det.call('turn:pick', { liarId: target2, pos: 2 });
  await waitPhase('question');
  const l2 = byId(target2);
  const card = l2.state.board.find((r) => r.liarId === target2).cards[2];
  const qIdx = l2.state.answering?.cards?.[2]?.qIdx;
  await l2.call('turn:reanswer', { text: `RESP${qIdx ?? ''}` });
  await det.call('turn:decide', { verdict: qIdx != null ? 'truth' : 'liar' });
  await waitPhase('result');
  console.log('   resultado turno 2:', det.state.result);
  assert(det.state.result.written.startsWith('resp'), 'respuesta escrita revelada al final');
  const correct2 = det.state.result.correct;

  // Turno 3: vuelve al primero; carta 1 ya usada
  await waitPhase('pick');
  const row = det.state.board.find((r) => r.liarId === target);
  assert(row.cards[0].asked && row.cards[0].text, 'la carta 1 queda usada y visible');
  assert((await det.call('turn:pick', { liarId: target, pos: 0 })).error, 'no se puede repetir la misma carta');
  if (det.state.turn.eligible.includes(target)) {
    await det.call('turn:pick', { liarId: target, pos: 1 });
    await waitPhase('question');
    await byId(target).call('turn:reanswer', { text: 'mentira' });
    await det.call('turn:decide', { verdict: 'liar' });
    await waitPhase('result');
    assert(det.state.result.correct, 'acierto: +5 fichas y mentiroso eliminado');
    assert(det.state.players.find((p) => p.id === target).alive === false, 'mentiroso eliminado');
  }
  console.log(`   fichas detective: ${det.state.players.find((p) => p.id === det.state.meId).chips} (turno 2 ${correct2 ? 'acertado' : 'fallado'})`);

  // Termina: el detective acierta hasta ganar o pierde vidas
  while (det.state.phase !== 'gameover') {
    await new Promise((r) => { const iv = setInterval(() => { if (['pick', 'gameover', 'answering'].includes(det.state.phase)) { clearInterval(iv); r(); } }, 50); });
    if (det.state.phase === 'gameover') break;
    if (det.state.phase === 'answering') {
      for (const l of liars) for (const k of l.state.answering.cards) await l.call('answer:submit', { qIdx: k.qIdx, text: 'x' });
      continue;
    }
    const t = det.state.turn.eligible[0];
    const free = det.state.board.find((r) => r.liarId === t).cards.find((k) => !k.asked);
    await det.call('turn:pick', { liarId: t, pos: free.pos });
    await waitPhase('question');
    await byId(t).call('turn:reanswer', { text: 'nada que ver' });
    await det.call('turn:decide', { verdict: 'liar' });
    await waitPhase('result');
  }
  assert(det.state.winner === 'detectives', 'ganan los detectives');
  assert((await a.call('game:lobby')).ok && a.state.phase === 'lobby', 'regresan a la sala');
  all.forEach((x) => x.s.close());
  console.log('\n🎉 Simulación completa sin errores');
  process.exit(0);
})();
