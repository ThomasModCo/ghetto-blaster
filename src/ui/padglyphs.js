// Controller button badges for PlayStation and Xbox layouts.
const NAMES = {
  ps: { A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', LS: 'L3', RS: 'R3', START: 'OPTIONS', BACK: 'CREATE' },
  xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', LS: 'LS', RS: 'RS', START: 'MENU', BACK: 'VIEW' },
};
export function btn(type, name) {
  const t = type === 'ps' ? 'ps' : 'xbox';
  return `<span class="pb pb-${name.toLowerCase()} ${t === 'ps' ? 'ps' : 'xb'}">${NAMES[t][name] || name}</span>`;
}
export function padLabel(type) { return type === 'ps' ? 'PLAYSTATION' : 'XBOX'; }
