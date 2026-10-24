'use strict';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

const app = $('#app');
const ROLE = {
  detective: { icon: '🕵️', name: 'Detective' },
  liar: { icon: '🎭', name: 'Mentiroso' },
};

let catalog = { categories: {}, levels: {} };
let session = store.get('session', null);
let guestName = store.get('guestName', '');
let playerKey = store.get('playerKey', null);
if (!playerKey) {
  playerKey = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  store.set('playerKey', playerKey);
}

let screen = 'auth';
let authTab = 'guest';
let authNote = '';
let state = null;
let offset = 0;
let actl = null;
const ui = { selectedLiar: null, pendingCode: new URLSearchParams(location.search).get('sala') || '' };

const now = () => Date.now() + offset;
const me = () => state?.players.find((p) => p.id === state.meId) || {};
const player = (id) => state?.players.find((p) => p.id === id);
const pname = (id) => esc(player(id)?.name || '¿?');
const cat = (id) => catalog.categories[id] || { name: '¿?', emoji: '❓', colors: ['#888', '#444'] };

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}

function identity() {
  return { playerKey, token: session?.token, name: session ? session.user.name : guestName };
}

async function api(path, body, method = 'POST') {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Error de conexión'), data);
  return data;
}

/* ---------------- Socket ---------------- */
const socket = io({ reconnectionDelayMax: 3000 });

const emit = (ev, data = {}) => new Promise((resolve) => {
  socket.timeout(8000).emit(ev, data, (err, r) => {
    if (err) { toast('Sin respuesta del servidor'); return resolve({ error: true }); }
    if (r?.error) toast(r.error);
    resolve(r || {});
  });
});

socket.on('state', (s) => {
  offset = s.serverNow - Date.now();
  const prev = state;
  state = s;
  screen = 'room';
  store.set('lastRoom', s.code);
  if (prev?.phase !== s.phase || prev?.turn?.liarId !== s.turn?.liarId) ui.selectedLiar = null;
  renderRoom(prev);
});

socket.on('kicked', (msg) => {
  state = null;
  actl = null;
  store.del('lastRoom');
  screen = 'menu';
  render();
  toast(msg || 'El admin te sacó de la sala');
});

socket.on('connect', () => {
  const code = store.get('lastRoom');
  if (code) {
    socket.emit('room:join', { ...identity(), code, rejoinOnly: true }, (r) => {
      if (r?.error) {
        store.del('lastRoom');
        if (screen === 'room') { state = null; actl = null; screen = 'menu'; render(); toast(r.error); }
      }
    });
  } else if (ui.pendingCode && screen === 'menu') {
    joinRoom(ui.pendingCode);
  }
  if (screen === 'room') renderRoom(state);
});
socket.on('disconnect', () => { if (screen === 'room') renderRoom(state); });

async function joinRoom(code) {
  code = String(code || '').toUpperCase().trim();
  if (code.length < 4) return toast('Escribe el código de la sala');
  ui.pendingCode = '';
  history.replaceState(null, '', location.pathname);
  await emit('room:join', { ...identity(), code });
}

/* ---------------- Rendering helpers ---------------- */
function render() {
  if (screen === 'room' && state) return renderRoom(state);
  actl = null;
  preserveInputs(() => { app.innerHTML = screen === 'menu' ? menuHtml() : authHtml(); });
  const auto = $('[autofocus]', app);
  if (auto && matchMedia('(pointer: fine)').matches) auto.focus();
}

// Re-rendering replaces the DOM; keep whatever the user was typing and their focus.
function preserveInputs(fn) {
  const active = document.activeElement;
  const activeId = active?.id;
  const sel = activeId && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const values = {};
  app.querySelectorAll('input[id]').forEach((i) => { if (i.type !== 'checkbox') values[i.id] = i.value; });
  fn();
  for (const [id, v] of Object.entries(values)) {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = v;
  }
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el && !el.disabled) {
      el.focus();
      if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ }
    }
  }
}

function card(catId, text, { flipped = false, cls = '', attrs = '', num = null } = {}) {
  const c = cat(catId);
  const style = `--c1:${esc(c.colors[0])};--c2:${esc(c.colors[1])}`;
  return `<div class="card ${flipped ? 'flipped' : ''} ${cls}" ${attrs}><div class="inner">
    <div class="face back" style="${style}"><div class="pattern"></div>${num != null ? `<div class="num">${num}</div>` : ''}
      <div class="emoji">${c.emoji}</div><div class="cat">${esc(c.name)}</div></div>
    <div class="face front" style="${style}"><div class="tag">${c.emoji} ${esc(c.name)}</div><div class="q">${esc(text || '')}</div></div>
  </div></div>`;
}

const hearts = (n) => '❤️'.repeat(n) + '🖤'.repeat(Math.max(0, 3 - n));
const clock = (deadline, cls = 'clock') => `<span class="${cls}" data-deadline="${deadline}">${Math.max(0, Math.ceil((deadline - now()) / 1000))}</span>`;
const bar = (deadline, total) => `<div class="timer-bar"><div data-deadline="${deadline}" data-total="${total}"></div></div>`;

/* ---------------- Auth & menu screens ---------------- */
function authHtml() {
  const tab = (id, label) => `<button class="${authTab === id ? 'on' : ''}" data-action="tab" data-tab="${id}">${label}</button>`;
  let form = '';
  if (authTab === 'guest') {
    form = `<form data-action="guest">
      <label for="g-name">¿Cómo te llamas?</label>
      <input type="text" id="g-name" name="name" maxlength="16" value="${esc(guestName)}" placeholder="Tu apodo" autocomplete="nickname" autofocus required>
      <button class="btn">Jugar como invitado</button>
      <p class="muted small center">Como invitado no se guardan tus fichas ni estadísticas.</p>
    </form>`;
  } else if (authTab === 'login') {
    form = `<form data-action="login">
      <label for="l-email">Correo</label>
      <input type="email" id="l-email" name="email" autocomplete="email" required autofocus>
      <label for="l-pass">Contraseña</label>
      <input type="password" id="l-pass" name="password" autocomplete="current-password" required>
      <button class="btn">Entrar</button>
    </form>`;
  } else {
    form = `<form data-action="register">
      <label for="r-name">Apodo en el juego</label>
      <input type="text" id="r-name" name="name" maxlength="16" required autofocus autocomplete="nickname">
      <label for="r-email">Correo</label>
      <input type="email" id="r-email" name="email" autocomplete="email" required>
      <label for="r-pass">Contraseña (mín. 6)</label>
      <input type="password" id="r-pass" name="password" minlength="6" autocomplete="new-password" required>
      <button class="btn">Crear cuenta</button>
    </form>`;
  }
  return `<div class="wrap">
    <div class="logo"><div class="icons">🕵️🎭</div><h1>¿Quién <span>Miente?</span></h1><p>El juego para tu llamada con amigos</p></div>
    <div class="panel">
      <div class="tabs">${tab('guest', 'Invitado')}${tab('login', 'Entrar')}${tab('register', 'Crear cuenta')}</div>
      ${form}
      ${authNote ? `<div class="note">${authNote}</div>` : ''}
    </div>
  </div>`;
}

function menuHtml() {
  const u = session?.user;
  return `<div class="wrap">
    <div class="logo"><div class="icons">🕵️🎭</div><h1>¿Quién <span>Miente?</span></h1></div>
    <div class="panel">
      <div class="row" style="align-items:center">
        <div><div class="muted small">${u ? 'Sesión iniciada' : 'Invitado'}</div><div style="font-size:22px;font-weight:600">${esc(u ? u.name : guestName)}</div></div>
        <button class="ghost small" style="flex:0 0 auto" data-action="logout">${u ? 'Cerrar sesión' : 'Cambiar'}</button>
      </div>
      ${u ? `<div class="stats"><div><b>🪙 ${u.chips}</b>fichas</div><div><b>${u.games}</b>partidas</div><div><b>${u.wins}</b>victorias</div></div>` : ''}
    </div>
    <div class="panel">
      <button class="menu-btn" disabled><span class="ic">🌎</span><div><b>Sala pública <span class="soon">Próximamente</span></b><span class="muted">Juega con desconocidos</span></div></button>
      <form data-action="join" class="menu-btn" style="cursor:default;display:block">
        <div style="display:flex;gap:14px;align-items:center"><span class="ic">🔑</span><div><b>Unirse a sala privada</b><span class="muted">Con el código que te compartieron</span></div></div>
        <div class="row" style="margin-top:12px">
          <input type="text" id="join-code" name="code" class="code-input" maxlength="5" placeholder="ABCDE" value="${esc(ui.pendingCode)}" autocomplete="off" autocapitalize="characters">
          <button class="btn" style="margin:0;flex:0 0 auto;width:auto">Unirse</button>
        </div>
      </form>
      <button class="menu-btn" data-action="create"><span class="ic">➕</span><div><b>Crear sala privada</b><span class="muted">Tú serás el admin y compartes el código</span></div></button>
      <details>
        <summary>¿Cómo se juega?</summary>
        <ol>
          <li>De 2 a 12 jugadores, todos en una llamada (WhatsApp, etc.).</li>
          <li>Al iniciar, a cada uno le toca ser <b>Detective</b> 🕵️ o <b>Mentiroso</b> 🎭.</li>
          <li>Los mentirosos responden rápido unas cartas de preguntas (pocos segundos por carta).</li>
          <li>En el interrogatorio, un detective elige a un mentiroso y una de sus cartas. La pregunta se revela, pero la respuesta escrita queda oculta.</li>
          <li>El mentiroso repite en voz alta lo que respondió (y lo escribe). Puede decir lo mismo… o cambiarlo.</li>
          <li>El detective decide: <b>VERDAD</b> (dijo lo mismo) o <b>MENTIROSO</b> (cambió su respuesta).</li>
          <li>Si acierta: +5 fichas y el mentiroso queda eliminado esa ronda. Si falla: pierde una vida (tiene 3).</li>
          <li>Ganan los detectives si eliminan a todos los mentirosos; ganan los mentirosos si dejan sin vidas a los detectives.</li>
        </ol>
      </details>
    </div>
  </div>`;
}

/* ---------------- Room screens ---------------- */
function renderRoom(prev) {
  if (screen !== 'room' || !state) return;
  const m = me();
  if (state.phase === 'answering' && state.answering?.cards) {
    if (!actl || actl.round !== state.round || !$('#aslot')) startAnswering();
    else updateAnswerProgress();
    return;
  }
  actl = null;
  const entered = prev?.phase !== state.phase;
  preserveInputs(() => {
    app.innerHTML = state.phase === 'lobby' ? lobbyHtml(m) : layout(phaseHtml(m, entered));
  });
  if (entered && state.phase === 'question') {
    const c = $('#turn-card');
    if (c) setTimeout(() => c.classList.add('flipped'), 450);
  }
}

function playersHtml() {
  const t = state.turn || {};
  const ids = [...state.detectiveOrder, ...state.liarOrder];
  return ids.map((id) => {
    const p = player(id);
    if (!p) return '';
    const isDet = p.role === 'detective';
    const meta = isDet
      ? `${hearts(p.lives)} · 🪙${p.chips}`
      : (p.alive ? 'En juego' : '☠️ Eliminado');
    const active = ['pick', 'question', 'result'].includes(state.phase) && (id === t.detectiveId || id === t.liarId);
    return `<div class="pl ${p.alive ? '' : 'out'} ${active ? 'active' : ''}">
      <span class="av">${ROLE[p.role]?.icon || '🙂'}</span>
      <div><span class="nm">${esc(p.name)}${id === state.meId ? ' (tú)' : ''}</span><span class="meta">${meta}</span></div>
      ${p.connected ? '' : '<span class="off" title="Desconectado">●</span>'}
    </div>`;
  }).join('');
}

function layout(inner) {
  const m = me();
  return `<div class="game">
    <header class="topbar">
      <div class="code">Sala <b>${esc(state.code)}</b></div>
      ${state.round ? `<div class="round">· Ronda ${state.round}</div>` : ''}
      <div class="spacer"></div>
      ${m.role ? `<span class="badge ${m.role}">${ROLE[m.role].icon} ${ROLE[m.role].name}</span>` : ''}
      <button class="ghost small" data-action="leave">Salir</button>
    </header>
    ${socket.connected ? '' : '<div class="conn">Reconectando…</div>'}
    <div class="game-body">
      <aside class="players">${playersHtml()}</aside>
      <main class="stage">${inner}</main>
    </div>
    ${state.log.length ? `<div class="log">${state.log.slice().reverse().map((l) => `<div>${esc(l.text)}</div>`).join('')}</div>` : ''}
  </div>`;
}

function lobbyHtml(m) {
  const isHost = state.hostId === m.id;
  const s = state.settings;
  const connected = state.players.filter((p) => p.connected).length;
  const opt = (name, values, cur, fmt = (v) => v) => isHost
    ? `<select data-setting="${name}" id="set-${name}">${values.map((v) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${fmt(v)}</option>`).join('')}</select>`
    : `<div class="ro">${fmt(cur)}</div>`;
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const levels = Object.keys(catalog.levels);
  const maxDet = Math.max(1, Math.min(3, connected - 1));

  return `<div class="game">
    <header class="topbar">
      <div class="code">Sala privada</div><div class="spacer"></div>
      <button class="ghost small" data-action="leave">Salir</button>
    </header>
    ${socket.connected ? '' : '<div class="conn">Reconectando…</div>'}
    <div class="lobby-grid">
      <div class="panel center">
        <div class="muted">Código de la sala</div>
        <div class="lobby-code">${esc(state.code)}</div>
        <div class="row">
          <button class="btn alt" data-action="copy">📋 Copiar enlace</button>
          <button class="btn wa" data-action="share">💬 WhatsApp</button>
        </div>
        <h3 style="margin-top:20px;text-align:left">Jugadores (${state.players.length}/${state.maxPlayers})</h3>
        <ul class="player-list">
          ${state.players.map((p) => `<li>
            <span>${p.id === state.hostId ? '👑' : '🙂'}</span>
            <span class="grow">${esc(p.name)}${p.id === m.id ? ' (tú)' : ''}${p.guest ? ' <span class="muted small">· invitado</span>' : ''}${p.connected ? '' : ' <span class="muted small">· desconectado</span>'}</span>
            ${isHost && p.id !== m.id ? `<button class="kick" data-action="kick" data-id="${p.id}" title="Sacar">✕</button>` : ''}
          </li>`).join('')}
        </ul>
      </div>
      <div class="panel">
        <h3>Ajustes ${isHost ? '' : '<span class="muted small">(solo el admin los cambia)</span>'}</h3>
        <div class="settings">
          <div class="full"><label>Dificultad</label>${opt('level', levels, s.level, (v) => `${catalog.levels[v]?.emoji || ''} ${esc(catalog.levels[v]?.label || v)}`)}</div>
          <div><label>Preguntas</label>${opt('numQuestions', range(5, 10), s.numQuestions)}</div>
          <div><label>Detectives</label>${opt('numDetectives', range(1, 3), s.numDetectives)}</div>
          <div><label>Seg. por respuesta</label>${opt('answerTime', [4, 5, 6, 8, 10, 12, 15], s.answerTime, (v) => `${v} s`)}</div>
          <div><label>Seg. para revelar</label>${opt('revealTime', [10, 15, 20, 25, 30, 40], s.revealTime, (v) => `${v} s`)}</div>
          <div class="full"><label>Pistas por detective</label>${opt('hints', range(0, 3), s.hints)}</div>
        </div>
        ${s.numDetectives > maxDet && connected >= 2 ? `<p class="muted small">Con ${connected} jugadores solo puede haber ${maxDet} detective(s); se ajustará al iniciar.</p>` : ''}
        <p class="muted small">💡 Una pista le muestra al detective la primera letra y el largo de la respuesta escrita.</p>
        ${isHost
          ? `<button class="btn" data-action="start" ${connected < 2 ? 'disabled' : ''}>${connected < 2 ? 'Esperando jugadores (mín. 2)…' : '¡Iniciar partida!'}</button>`
          : '<p class="center muted" style="margin-top:16px">Esperando a que el admin inicie la partida…</p>'}
      </div>
    </div>
  </div>`;
}

function phaseHtml(m, entered) {
  switch (state.phase) {
    case 'roles': return rolesHtml(m);
    case 'answering': return waitingHtml();
    case 'pick': return pickHtml(m);
    case 'question': return questionHtml(m, entered);
    case 'result': return resultHtml(m);
    case 'roundEnd': return `<div class="banner" style="margin-top:40px">🔄 Fin de la ronda ${state.round}</div>
      <p class="sub">Se acabaron las cartas. Los mentirosos eliminados regresan y llegan preguntas nuevas.</p>
      <div class="big-clock">${clock(state.deadline, '')}</div>`;
    case 'gameover': return gameoverHtml(m);
    default: return '';
  }
}

function rolesHtml(m) {
  const dets = state.detectiveOrder.map(pname).join(', ');
  const isLiar = m.role === 'liar';
  return `<div class="role-card ${m.role}">
      <div class="ic">${ROLE[m.role].icon}</div>
      <div>Eres</div><h2>${ROLE[m.role].name.toUpperCase()}</h2>
      <p>${isLiar
        ? 'Responde rápido cada carta. Después tendrás que repetir tus respuestas frente al detective… o engañarlo.'
        : 'Espera a que los mentirosos respondan. Luego interrógalos y descubre quién cambia su respuesta.'}</p>
    </div>
    <p class="sub">Detectives: <b>${dets}</b>${state.detectiveOrder.length > 1 ? ' (en ese orden de turno)' : ''}</p>
    <p class="muted">Comienza en ${clock(state.deadline)} s</p>`;
}

function waitingHtml() {
  const a = state.answering;
  return `<div class="banner">⏳ Los mentirosos están respondiendo</div>
    <p class="sub">Prepárate para interrogar. Aún no puedes ver las preguntas.</p>
    <div class="big-clock">${clock(state.deadline, '')}</div>
    <div class="status-row">${a.progress.map((p) => `<span>🎭 ${pname(p.id)}: ${p.done}/${state.numQuestions}</span>`).join('')}</div>`;
}

/* --- Answering (liars): driven locally so the input keeps focus between cards --- */
function startAnswering() {
  const a = state.answering;
  actl = {
    round: state.round,
    cards: a.cards,
    idx: 0,
    answered: new Set(a.answered),
    T: a.answerTime * 1000,
    flip: a.flipMs,
    cardDeadline: 0,
    flipTimer: null,
  };
  app.innerHTML = layout(`<div class="banner">🎭 ¡Responde rápido!</div>
    <p class="sub" id="aprog"></p>
    <div id="aslot"></div>
    <div class="timer-bar" id="abar-wrap"><div id="abar"></div></div>
    <form class="answer-form" data-action="answer" id="aform">
      <input type="text" id="ainput" maxlength="60" autocomplete="off" placeholder="Tu respuesta…" enterkeyhint="send">
      <button class="btn">Enviar</button>
    </form>
    <p class="muted small">Recuerda bien lo que escribes: luego tendrás que repetirlo frente al detective 😉</p>`);
  nextCard();
}

function nextCard() {
  const a = actl;
  clearTimeout(a.flipTimer);
  while (a.idx < a.cards.length && a.answered.has(a.cards[a.idx].qIdx)) a.idx++;
  const input = $('#ainput');
  if (a.idx >= a.cards.length) {
    a.cardDeadline = 0;
    $('#aslot').innerHTML = `<div class="big-clock" style="font-size:60px">✅</div><div class="banner">¡Listo!</div>
      <p class="sub">Esperando a los demás mentirosos… <span id="aprog2"></span></p>
      <div class="big-clock">${clock(state.deadline, '')}</div>`;
    $('#aform').style.display = 'none';
    $('#abar-wrap').style.display = 'none';
    $('#aprog').textContent = '';
    input.blur();
    updateAnswerProgress();
    return;
  }
  const c = a.cards[a.idx];
  $('#aprog').textContent = `Carta ${a.idx + 1} de ${a.cards.length}`;
  $('#aslot').innerHTML = card(c.catId, c.text, { num: a.idx + 1, attrs: 'id="acard"' });
  input.value = '';
  input.readOnly = true;
  a.cardDeadline = 0;
  $('#abar').style.width = '100%';
  a.flipTimer = setTimeout(() => {
    $('#acard')?.classList.add('flipped');
    a.flipTimer = setTimeout(() => {
      input.readOnly = false;
      if (document.activeElement !== input) input.focus();
      a.cardDeadline = Date.now() + a.T;
    }, 700);
  }, Math.max(0, a.flip - 700));
}

function submitCurrent() {
  const a = actl;
  if (!a || !a.cardDeadline) return;
  const c = a.cards[a.idx];
  const input = $('#ainput');
  socket.emit('answer:submit', { qIdx: c.qIdx, text: input.value });
  a.answered.add(c.qIdx);
  a.idx++;
  nextCard();
}

function updateAnswerProgress() {
  const el = $('#aprog2');
  if (!el || !state.answering) return;
  const total = state.answering.progress.length;
  const done = state.answering.progress.filter((p) => p.done >= state.numQuestions).length;
  el.textContent = `(${done}/${total} terminaron)`;
}

function tickAnswer() {
  const a = actl;
  if (!a || !a.cardDeadline) return;
  const rem = a.cardDeadline - Date.now();
  const barEl = $('#abar');
  if (barEl) barEl.style.width = `${Math.max(0, rem / a.T) * 100}%`;
  if (rem <= 0) submitCurrent();
}

/* --- Interrogation --- */
function pickHtml(m) {
  const t = state.turn;
  const isMine = t.detectiveId === m.id;
  const header = `<div class="banner">🕵️ Turno de ${pname(t.detectiveId)}</div>`;
  if (!isMine) {
    return `${header}<p class="sub">${pname(t.detectiveId)} está eligiendo a quién interrogar… (${clock(state.deadline)} s)</p>
      ${state.board.map((b) => boardRow(b, true)).join('')}`;
  }
  const eligible = t.eligible || [];
  if (!ui.selectedLiar || !eligible.includes(ui.selectedLiar)) ui.selectedLiar = eligible[0] || null;
  const liarButtons = state.liarOrder.map((id) => {
    const p = player(id);
    const ok = eligible.includes(id);
    const why = !p?.alive ? ' ☠️' : (!ok ? ' (no disponible)' : '');
    return `<button class="chip-btn ${ui.selectedLiar === id ? 'on' : ''}" data-action="selLiar" data-id="${id}" ${ok ? '' : 'disabled'}>🎭 ${esc(p?.name)}${why}</button>`;
  }).join('');
  const b = state.board.find((x) => x.liarId === ui.selectedLiar);
  return `${header}
    <p class="sub">Elige a un mentiroso y una de sus cartas · ${clock(state.deadline)} s</p>
    <div class="liar-picker">${liarButtons}</div>
    ${b ? `<div class="cards-grid">${b.cards.map((c) => card(c.catId, c.text, {
      flipped: c.asked,
      num: c.pos + 1,
      cls: c.asked ? 'used' : '',
      attrs: c.asked ? '' : `data-action="pick" data-liar="${b.liarId}" data-pos="${c.pos}" role="button" tabindex="0"`,
    })).join('')}</div>` : ''}`;
}

function boardRow(b, readonly) {
  const p = player(b.liarId);
  return `<div style="text-align:left;margin-top:14px"><b>🎭 ${esc(p?.name)}</b>${p?.alive ? '' : ' <span class="muted">· eliminado</span>'}
    <div class="cards-grid ${readonly ? 'readonly' : ''}">${b.cards.map((c) => card(c.catId, c.text, { flipped: c.asked || !!c.text, num: c.pos + 1, cls: c.asked ? 'used' : '' })).join('')}</div></div>`;
}

function questionHtml(m, entered) {
  const t = state.turn;
  const total = state.settings.revealTime * 1000 + t.flipMs;
  let action = '';
  if (m.id === t.liarId) {
    action = t.myReanswer != null
      ? `<div class="secret"><div class="lbl">Lo que dijiste</div><div class="val">${esc(t.myReanswer || '(vacío)')}</div></div>`
      : `<p><b>Responde en voz alta en la llamada</b> y escríbelo aquí:</p>
        <form class="answer-form" data-action="reanswer">
          <input type="text" id="reanswer" maxlength="60" autocomplete="off" placeholder="Lo que dices…" enterkeyhint="send">
          <button class="btn">Enviar</button>
        </form>`;
  } else if (m.id === t.detectiveId) {
    const hintsLeft = me().hintsLeft;
    action = `<p class="muted">Escucha su respuesta. ¿Dijo lo mismo que escribió?</p>
      <div class="verdict">
        <button class="btn red ${t.myDecision === 'liar' ? 'chosen' : ''}" data-action="decide" data-v="liar" ${t.myDecision ? 'disabled' : ''}>🤥 MENTIROSO</button>
        <button class="btn green ${t.myDecision === 'truth' ? 'chosen' : ''}" data-action="decide" data-v="truth" ${t.myDecision ? 'disabled' : ''}>😇 VERDAD</button>
      </div>
      ${t.hint ? `<div class="note">💡 ${esc(t.hint)}</div>` : (hintsLeft > 0 && !t.myDecision ? `<button class="ghost" style="margin-top:12px" data-action="hint">💡 Usar pista (${hintsLeft})</button>` : '')}
      ${t.myDecision && !t.reanswered ? `<p class="muted small">Esperando a que ${pname(t.liarId)} escriba su respuesta…</p>` : ''}`;
  } else {
    action = `<p class="muted">Escucha a <b>${pname(t.liarId)}</b> en la llamada…</p>`;
  }
  return `<div class="banner">${pname(t.detectiveId)} interroga a ${pname(t.liarId)}</div>
    <p class="sub">Carta ${t.pos + 1} · ${clock(state.deadline)} s</p>
    ${card(t.catId, t.question, { flipped: !entered, attrs: 'id="turn-card"' })}
    <div class="secret"><div class="lbl">Respuesta escrita</div><div class="val">🔒 Oculta</div></div>
    ${bar(state.deadline, total)}
    ${action}
    <div class="status-row">
      <span>🎭 ${pname(t.liarId)}: ${t.reanswered ? '✅ respondió' : '⏳ respondiendo'}</span>
      <span>🕵️ ${pname(t.detectiveId)}: ${t.decided ? '✅ decidió' : '⏳ pensando'}</span>
    </div>`;
}

function resultHtml() {
  const r = state.result;
  const verdict = r.timeout ? '⌛ No decidió a tiempo' : (r.verdict === 'truth' ? '😇 VERDAD' : '🤥 MENTIROSO');
  return `<div class="banner">${pname(r.detectiveId)} interrogó a ${pname(r.liarId)}</div>
    ${card(r.catId, r.question, { flipped: true })}
    <div class="row" style="max-width:420px;margin:0 auto">
      <div class="secret revealed"><div class="lbl">Escribió</div><div class="val">${esc(r.written || '(nada)')}</div></div>
      <div class="secret revealed"><div class="lbl">Dijo</div><div class="val">${r.reanswer == null ? '(no respondió)' : esc(r.reanswer || '(nada)')}</div></div>
    </div>
    <p>${r.match ? '✅ Coinciden: dijo la verdad' : '❌ No coinciden: mintió'} · El detective dijo <b>${verdict}</b></p>
    <div class="outcome ${r.correct ? 'good' : 'bad'}">${r.correct
      ? `🎯 ¡${pname(r.detectiveId)} acertó! +5 🪙 · ${pname(r.liarId)} eliminado`
      : `💔 ${pname(r.detectiveId)} falló y pierde una vida`}</div>
    <p class="muted small">Siguiente turno en ${clock(state.deadline)} s</p>`;
}

function gameoverHtml(m) {
  const winRole = state.winner === 'detectives' ? 'detective' : 'liar';
  const sorted = [...state.players].sort((a, b) => (b.role === winRole) - (a.role === winRole) || b.chips - a.chips);
  const iWon = m.role === winRole;
  return `<div style="font-size:80px">${state.winner === 'detectives' ? '🕵️' : '🎭'}</div>
    <div class="banner" style="font-size:30px">¡Ganan los ${state.winner === 'detectives' ? 'detectives' : 'mentirosos'}!</div>
    <p class="sub">${iWon ? '¡Felicidades, ganaste! 🎉' : 'Será la próxima…'}</p>
    <ul class="leader">${sorted.map((p) => `<li class="${p.role === winRole ? 'win' : ''}">
      <span>${ROLE[p.role]?.icon || ''}</span><span class="grow">${esc(p.name)}</span>
      <span>${p.role === 'detective' ? hearts(p.lives) : (p.alive ? 'Sobrevivió' : '☠️')}</span><b>🪙 ${p.chips}</b></li>`).join('')}</ul>
    ${state.hostId === m.id
      ? '<button class="btn" style="max-width:420px" data-action="lobby">Volver a la sala</button>'
      : '<p class="muted">Esperando a que el admin regrese a la sala…</p>'}`;
}

/* ---------------- Actions ---------------- */
const actions = {
  tab(el) { authTab = el.dataset.tab; authNote = ''; render(); },

  guest(f) {
    const name = f.name.value.replace(/\s+/g, ' ').trim();
    if (name.length < 2) return toast('Escribe un nombre de al menos 2 letras');
    guestName = name.slice(0, 16);
    store.set('guestName', guestName);
    goMenu();
  },

  async login(f) {
    try {
      const r = await api('/api/login', { email: f.email.value, password: f.password.value });
      session = r;
      store.set('session', session);
      goMenu();
    } catch (e) {
      authNote = esc(e.message) + (e.unverified ? ` <br><button class="ghost small" style="margin-top:8px" data-action="resend" data-email="${esc(f.email.value)}">Reenviar correo de verificación</button>` : '');
      render();
    }
  },

  async register(f) {
    try {
      const r = await api('/api/register', { name: f.name.value, email: f.email.value, password: f.password.value });
      authTab = 'login';
      authNote = `📧 Te enviamos un correo a <b>${esc(f.email.value)}</b>. Abre el enlace para verificar tu cuenta y luego inicia sesión.`
        + (r.devLink ? `<br><br><span class="muted small">Modo desarrollo (sin correo configurado):</span> <a href="${esc(r.devLink)}">verificar ahora</a>` : '');
      render();
    } catch (e) {
      authNote = esc(e.message);
      render();
    }
  },

  async resend(el) {
    try {
      const r = await api('/api/resend', { email: el.dataset.email });
      authNote = '📧 Correo reenviado.' + (r.devLink ? ` <a href="${esc(r.devLink)}">verificar ahora</a>` : '');
    } catch (e) { authNote = esc(e.message); }
    render();
  },

  async logout() {
    if (session) { api('/api/logout').catch(() => {}); session = null; store.del('session'); }
    screen = 'auth';
    authTab = 'guest';
    render();
  },

  create() { emit('room:create', identity()); },
  join(f) { joinRoom(f.code.value); },

  leave() {
    if (state && !['lobby', 'gameover'].includes(state.phase) && !confirm('¿Seguro que quieres salir de la partida?')) return;
    emit('room:leave');
    state = null;
    actl = null;
    store.del('lastRoom');
    goMenu();
  },

  async copy() {
    const link = `${location.origin}/?sala=${state.code}`;
    try { await navigator.clipboard.writeText(link); toast('¡Enlace copiado!'); } catch { prompt('Copia este enlace:', link); }
  },

  async share() {
    const link = `${location.origin}/?sala=${state.code}`;
    const text = `¡Juega ¿Quién Miente? conmigo! Código: ${state.code}\n${link}`;
    if (navigator.share) {
      try { await navigator.share({ title: '¿Quién Miente?', text }); return; } catch { /* cancelled */ }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  },

  kick(el) { if (confirm('¿Sacar a este jugador?')) emit('room:kick', { playerId: el.dataset.id }); },
  start() { emit('game:start'); },
  lobby() { emit('game:lobby'); },
  selLiar(el) { ui.selectedLiar = el.dataset.id; renderRoom(state); },
  pick(el) { emit('turn:pick', { liarId: el.dataset.liar, pos: Number(el.dataset.pos) }); },
  decide(el) { emit('turn:decide', { verdict: el.dataset.v }); },
  hint() { emit('turn:hint'); },

  reanswer(f) {
    const text = f.querySelector('input').value.trim();
    if (!text && !confirm('¿Enviar vacío?')) return;
    emit('turn:reanswer', { text });
  },

  answer() { submitCurrent(); },
};

function goMenu() {
  screen = 'menu';
  render();
  if (ui.pendingCode && socket.connected) joinRoom(ui.pendingCode);
}

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'FORM' || el.disabled) return;
  e.preventDefault();
  actions[el.dataset.action]?.(el, e);
});
app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('[data-action][role=button]');
  if (el) { e.preventDefault(); actions[el.dataset.action]?.(el, e); }
});
app.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  actions[f.dataset.action]?.(f, e);
});
app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.matches('[data-setting]')) emit('room:settings', { settings: { [el.dataset.setting]: el.value } });
});
app.addEventListener('input', (e) => {
  if (e.target.id === 'join-code') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

setInterval(() => {
  const t = now();
  document.querySelectorAll('[data-deadline]').forEach((el) => {
    const rem = Math.max(0, Number(el.dataset.deadline) - t);
    if (el.dataset.total) el.style.width = `${(rem / Number(el.dataset.total)) * 100}%`;
    else el.textContent = Math.ceil(rem / 1000);
    el.classList.toggle('urgent', rem < 5000);
  });
  tickAnswer();
}, 100);

/* ---------------- Boot ---------------- */
(async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.has('verified')) {
    authTab = 'login';
    authNote = params.get('verified') === '1' ? '✅ ¡Correo verificado! Ya puedes iniciar sesión.' : '⚠️ El enlace de verificación no es válido o venció.';
    history.replaceState(null, '', location.pathname);
  }
  try { catalog = await api('/api/catalog', null, 'GET'); } catch { toast('No se pudo cargar el juego'); }
  if (session) {
    try { session.user = (await api('/api/me', null, 'GET')).user; store.set('session', session); } catch { session = null; store.del('session'); }
  }
  screen = (session || guestName) && !params.has('verified') ? 'menu' : 'auth';
  render();
  if (screen === 'menu' && ui.pendingCode && socket.connected && !store.get('lastRoom')) joinRoom(ui.pendingCode);
})();
