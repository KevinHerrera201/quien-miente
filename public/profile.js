// Progresión de cuentas registradas: fichas, apuestas, experiencia, niveles y rangos.

export const START_CHIPS = 100;
export const RESCUE_CHIPS = 100;
export const RESCUE_BELOW = 10;
export const RESCUE_EVERY_MS = 24 * 3600 * 1000;
export const BET_STEP = 10;
export const MAX_BET = 100;

const RANKS = [
  [1, '🐣', 'Novato'],
  [3, '🤥', 'Mentirosillo'],
  [5, '🧐', 'Sospechoso'],
  [8, '🔎', 'Investigador'],
  [12, '🕵️', 'Detective Privado'],
  [16, '🎖️', 'Inspector'],
  [20, '👑', 'Leyenda'],
];

// Experiencia total necesaria para llegar al nivel n: 0, 100, 300, 600, 1000…
export const xpForLevel = (n) => 50 * n * (n - 1);

export function levelInfo(xp = 0) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  const [, icon, name] = [...RANKS].reverse().find(([min]) => level >= min);
  return { level, rankIcon: icon, rankName: name, progress: (xp - from) / (to - from), xpToNext: to - xp };
}

// Experiencia ganada en una partida.
export function xpForGame({ won, points = 0, survived = false }) {
  return 10 + (won ? 25 : 0) + points + (survived ? 10 : 0);
}

// Reparto del bote: los apostadores del equipo ganador se lo reparten en partes iguales.
// Si nadie del equipo ganador apostó, a cada apostador se le devuelve su apuesta.
export function settlement({ bet = 0, bettors = {}, winner }) {
  const ids = Object.keys(bettors);
  const pot = bet * ids.length;
  const winRole = winner === 'detectives' ? 'detective' : 'liar';
  const winners = ids.filter((id) => bettors[id] === winRole);
  const payout = {};
  for (const id of ids) {
    payout[id] = winners.length ? (bettors[id] === winRole ? Math.floor(pot / winners.length) : 0) : bet;
  }
  return { pot, payout };
}

export function sanitizeBet(v) {
  const n = Math.round((parseInt(v, 10) || 0) / BET_STEP) * BET_STEP;
  return Math.min(MAX_BET, Math.max(0, n));
}
