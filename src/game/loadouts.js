// Stock loadouts + persistence of custom loadouts and player settings.
import { WEAPONS } from './weapons.js';
import { TACTICALS, LETHALS } from './equipment.js';

export const STOCK_LOADOUTS = [
  { id: 'runner', name: 'RUNNER', desc: 'Fast hands, fast feet. Get in, get out.', primary: 'macdaddy', secondary: 'nine', tactical: 'flashbang', lethal: 'frag' },
  { id: 'enforcer', name: 'ENFORCER', desc: 'Kick the door in and clear the room.', primary: 'gauge', secondary: 'hammer', tactical: 'smoke', lethal: 'breach' },
  { id: 'capo', name: 'CAPO', desc: 'Runs the block from mid range.', primary: 'chopper', secondary: 'nine', tactical: 'stun', lethal: 'semtex' },
  { id: 'lookout', name: 'LOOKOUT', desc: 'Eyes on everything from the rooftops.', primary: 'fifty', secondary: 'switch', tactical: 'heartbeat', lethal: 'claymore' },
  { id: 'troublemaker', name: 'TROUBLEMAKER', desc: 'Quiet, sneaky, and nasty.', primary: 'whisper', secondary: 'hush', tactical: 'decoy', lethal: 'tomahawk' },
];

const KEY = 'gb.save.v1';
const DEFAULT_SAVE = {
  custom: [null, null, null],
  settings: { sensitivity: 1.0, touchSensitivity: 1.0, padSensitivity: 1.0, aimAssist: true, vibration: true, invertY: false, quality: 'high', volume: 0.8, adsHold: true, fov: 75, name: null },
  wallet: 1000,
  stats: { matches: 0, wins: 0, kills: 0, deaths: 0, bestStreak: 0, bets: 0, won: 0 },
};
let save = null;
export function getSave() {
  if (save) return save;
  try { const raw = localStorage.getItem(KEY); save = raw ? { ...structuredClone(DEFAULT_SAVE), ...JSON.parse(raw) } : structuredClone(DEFAULT_SAVE); } catch (e) { save = structuredClone(DEFAULT_SAVE); }
  save.settings = { ...DEFAULT_SAVE.settings, ...(save.settings || {}) };
  save.stats = { ...DEFAULT_SAVE.stats, ...(save.stats || {}) };
  if (!Array.isArray(save.custom) || save.custom.length !== 3) save.custom = [null, null, null];
  if (typeof save.wallet !== 'number') save.wallet = 1000;
  return save;
}
export function persist() { try { localStorage.setItem(KEY, JSON.stringify(getSave())); } catch (e) { /* private mode */ } }

export function allLoadouts() {
  const s = getSave();
  return [...STOCK_LOADOUTS, ...s.custom.map((c, i) => c ? { ...c, id: 'custom' + i, custom: true } : { id: 'custom' + i, name: `CUSTOM ${i + 1}`, empty: true, custom: true })];
}
export function resolveLoadout(lo) {
  return { ...lo, primary: WEAPONS[lo.primary] || WEAPONS.stick, secondary: WEAPONS[lo.secondary] || WEAPONS.nine, tactical: TACTICALS[lo.tactical] || TACTICALS.flashbang, lethal: LETHALS[lo.lethal] || LETHALS.frag };
}
export function randomLoadout(rng) {
  const prim = Object.values(WEAPONS).filter((w) => w.slot === 'primary'), sec = Object.values(WEAPONS).filter((w) => w.slot === 'secondary');
  return { id: 'bot', name: 'BOT', primary: rng.pick(prim).id, secondary: rng.pick(sec).id, tactical: rng.pick(Object.keys(TACTICALS)), lethal: rng.pick(Object.keys(LETHALS)) };
}
