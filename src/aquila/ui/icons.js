// Small inline SVG icons for unit classes and UI.
const S = (body, vb = '0 0 32 32') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  sword: S('<path d="M7 25l14-14M21 11l3-6-6 3M9 19l4 4M6 26l2-2"/>'),
  spear: S('<path d="M6 26L24 8M24 8l2-4-4 2M10 18l4 4"/>'),
  pike: S('<path d="M4 28L28 4M28 4l-1 5-4-4zM8 20l4 4M14 14l4 4"/>'),
  bow: S('<path d="M10 5c9 4 9 18 0 22M10 5v22M10 16h16M23 13l3 3-3 3"/>'),
  javelin: S('<path d="M5 22L27 10M27 10l-5 0 2 4M8 20l3 3"/>'),
  sling: S('<path d="M8 6c6 6 6 14 12 18M20 24a3 3 0 1 0 0.1 0"/>'),
  horse: S('<path d="M7 26v-7l4-3 1-5 5-4 6 1 3 4-3 2-3-1-1 4 3 3v6M11 26v-5M23 26v-4"/>'),
  harcher: S('<path d="M6 26v-6l4-3 1-4 4-3M17 6c5 3 5 11 0 14M17 6v14M10 13h12"/>'),
  elephant: S('<path d="M4 24v-8c0-5 4-8 9-8h6c5 0 8 4 8 8v3c0 2-1 3-2 4M24 18c2 2 1 6-1 7M9 24v-4M15 24v-4M20 24v-4"/>'),
  eagle: S('<path d="M16 6v20M16 10c-4-4-9-3-12 0 3 1 6 3 7 6M16 10c4-4 9-3 12 0-3 1-6 3-7 6M12 26h8M16 6l-2-2h4z"/>'),
  shield: S('<path d="M16 4l10 4v7c0 7-5 11-10 13C11 26 6 22 6 15V8z"/>'),
  run: S('<path d="M18 6a2 2 0 1 0 .1 0M12 28l3-7 4 3v5M15 21l2-7-5 1-3 4M17 14l4 3 4-1"/>'),
  halt: S('<rect x="8" y="8" width="16" height="16" rx="2"/>'),
  testudo: S('<rect x="5" y="9" width="7" height="7"/><rect x="12.5" y="9" width="7" height="7"/><rect x="20" y="9" width="7" height="7"/><rect x="5" y="16.5" width="7" height="7"/><rect x="12.5" y="16.5" width="7" height="7"/><rect x="20" y="16.5" width="7" height="7"/>'),
  phalanx: S('<path d="M4 26L20 6M10 26L26 6M16 26L28 12M6 24h20"/>'),
  fire: S('<path d="M8 24L24 8M24 8h-6M24 8v6M6 18l3 3M12 24l3 3"/>'),
  rally: S('<path d="M10 28V5M10 5h14l-4 5 4 5H10"/>'),
  pause: S('<path d="M11 8v16M21 8v16"/>'),
  play: S('<path d="M10 7l15 9-15 9z"/>'),
  ff: S('<path d="M6 8l10 8-10 8zM16 8l10 8-10 8z"/>'),
  coin: S('<circle cx="16" cy="16" r="10"/><path d="M16 10v12M13 13h5a2 2 0 0 1 0 4h-4a2 2 0 0 0 0 4h5"/>'),
  scroll: S('<path d="M8 6h14a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H10M8 6a3 3 0 0 0-3 3v2h6V9a3 3 0 0 0-3-3zM12 13h9M12 18h9"/>'),
  laurel: S('<path d="M16 28c-6-2-10-8-10-16M16 28c6-2 10-8 10-16M7 18c2 0 4 1 5 3M6 12c2 0 4 1 4 3M25 18c-2 0-4 1-5 3M26 12c-2 0-4 1-4 3"/>'),
  temple: S('<path d="M4 12L16 5l12 7M6 12h20M8 12v11M13 12v11M19 12v11M24 12v11M5 26h22"/>'),
  wall: S('<path d="M4 26V12h4v3h4v-3h4v3h4v-3h4v3h4V26zM12 26v-5h8v5"/>'),
  farm: S('<path d="M4 24h24M8 24c0-6 2-10 2-14M14 24c0-6 2-10 2-14M20 24c0-6 2-10 2-14M10 14l-3-2M16 14l3-2M22 14l-3-2"/>'),
  forum: S('<path d="M6 26V14l10-6 10 6v12M6 26h20M11 26v-7h10v7M16 8v-3"/>'),
  barracks: S('<path d="M5 26V13l11-7 11 7v13M10 26v-6l6-4 6 4v6M5 26h22"/>'),
  aqueduct: S('<path d="M3 9h26M3 13h26M5 13v13M27 13v13M5 26c0-6 3-8 5.5-8s5.5 2 5.5 8M16 26c0-6 3-8 5.5-8S27 20 27 26M10.5 13v5M21.5 13v5"/>'),
  arena: S('<ellipse cx="16" cy="12" rx="12" ry="5"/><path d="M4 12v9c0 3 5 5 12 5s12-2 12-5v-9M9 16v8M16 17v9M23 16v8"/>'),
  port: S('<path d="M16 5v18M11 9h10M16 5a2 2 0 1 0 0.1 0M5 18c0 5 5 8 11 8s11-3 11-8M5 18l3 2M27 18l-3 2"/>'),
  smithy: S('<path d="M5 13h17l5-3v4c-2 2-5 3-8 3h-2l1 4h3v4H11v-4h3l1-4h-2c-4 0-8-1-8-4z"/>'),
  stables: S('<path d="M4 15L16 6l12 9M7 13v13h18V13M12 26v-7h8v7M12 22h8"/>'),
  academy: S('<path d="M5 26h22M7 26V15M12 26V15M20 26V15M25 26V15M5 15h22M8 15c0-5 4-8 8-8s8 3 8 8M16 7V4"/>'),
  mine: S('<path d="M7 26L20 13M15 8c5-2 10 0 12 4-4-1-7-1-10 1zM4 26h10"/>'),
  people: S('<circle cx="11" cy="10" r="3.5"/><circle cx="22" cy="11" r="3"/><path d="M4 26c0-5 3-8 7-8s7 3 7 8M17 19c1-1 3-2 5-2 4 0 6 3 6 7"/>'),
  order: S('<path d="M16 4v24M8 9h16M8 9l-4 9c0 2 2 3 4 3s4-1 4-3zM24 9l-4 9c0 2 2 3 4 3s4-1 4-3zM11 28h10"/>'),
  crown: S('<path d="M5 24h22M6 24L4 10l7 6 5-9 5 9 7-6-2 14"/>'),
  hammer: S('<path d="M18 6l8 8-3 3-8-8zM15 12L5 22l4 4 10-10"/>'),
  back: S('<path d="M19 7l-9 9 9 9"/>'),
  next: S('<path d="M13 7l9 9-9 9"/>'),
  amphora: S('<path d="M13 4h6M14 4v4c-4 2-6 6-6 10 0 5 3 9 8 10 5-1 8-5 8-10 0-4-2-8-6-10V4M10 10c-3 0-4 4-2 6M22 10c3 0 4 4 2 6"/>'),
  dice: S('<rect x="6" y="6" width="20" height="20" rx="4"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="20" cy="20" r="1.5" fill="currentColor"/><circle cx="16" cy="16" r="1.5" fill="currentColor"/>'),
  close: S('<path d="M9 9l14 14M23 9L9 23"/>'),
  sound: S('<path d="M6 13h5l6-5v16l-6-5H6zM21 12c2 2 2 6 0 8M24 9c4 4 4 10 0 14"/>'),
  mute: S('<path d="M6 13h5l6-5v16l-6-5H6zM21 12l6 8M27 12l-6 8"/>'),
};

export function unitIcon(t) {
  if (t.general) return ICONS.eagle;
  if (t.cls === 'elephant') return ICONS.elephant;
  if (t.cls === 'harcher') return ICONS.harcher;
  if (t.cls === 'cav') return ICONS.horse;
  if (t.cls === 'missile') return t.missile === 'arrow' ? ICONS.bow : t.missile === 'stone' ? ICONS.sling : ICONS.javelin;
  if (t.cls === 'pike') return ICONS.pike;
  if (t.cls === 'spear') return ICONS.spear;
  return ICONS.sword;
}

export const BLD_ICON = { farm: 'farm', market: 'forum', barracks: 'barracks', walls: 'wall', temple: 'temple', aqueduct: 'aqueduct', arena: 'arena', port: 'port', smithy: 'smithy', stables: 'stables', academy: 'academy', mine: 'mine' };
// trade-good kind -> icon
export const RES_ICON = { metal: 'mine', food: 'farm', beast: 'horse', stone: 'temple', wood: 'stables', lux: 'amphora' };

// Filled silhouettes for unit cards and portraits (64×64, two tones via currentColor + shade)
const F = (body) => `<svg viewBox="0 0 64 64">${body}</svg>`;
const SH = 'fill="rgba(0,0,0,0.38)"';
export const ART = {
  inf: F(`<path d="M30 6 L50 52 L46 55 L26 9 Z" fill="currentColor" opacity=".55"/><rect x="14" y="10" width="28" height="46" rx="7" fill="currentColor"/><rect x="18" y="14" width="20" height="38" rx="5" ${SH}/><circle cx="28" cy="33" r="6" fill="currentColor"/><path d="M28 18v8M28 40v8" stroke="currentColor" stroke-width="3"/>`),
  spear: F(`<path d="M8 58 L52 8 L56 6 L54 12 L12 60 Z" fill="currentColor" opacity=".7"/><path d="M50 6l8-2-2 8z" fill="currentColor"/><circle cx="28" cy="36" r="19" fill="currentColor"/><circle cx="28" cy="36" r="14" ${SH}/><circle cx="28" cy="36" r="5" fill="currentColor"/>`),
  pike: F(`<path d="M2 50 L56 6 M8 56 L60 12 M14 62 L62 20" stroke="currentColor" stroke-width="3.5" opacity=".8"/><path d="M54 4l6-1-1 6zM58 10l5-1-1 5z" fill="currentColor"/><circle cx="22" cy="44" r="13" fill="currentColor"/><circle cx="22" cy="44" r="9" ${SH}/>`),
  bow: F(`<path d="M20 4 C44 14 44 50 20 60" stroke="currentColor" stroke-width="5" fill="none"/><path d="M20 4 L20 60" stroke="currentColor" stroke-width="1.5" opacity=".7"/><path d="M14 32 H56" stroke="currentColor" stroke-width="3"/><path d="M50 26 L60 32 L50 38 Z" fill="currentColor"/><path d="M14 28 L8 32 L14 36" stroke="currentColor" stroke-width="2.5" fill="none"/>`),
  javelin: F(`<path d="M6 46 L54 14 M12 54 L58 22" stroke="currentColor" stroke-width="3.5"/><path d="M52 10 L60 10 L56 18 Z M56 18 L63 18 L60 26 Z" fill="currentColor"/><circle cx="20" cy="44" r="13" fill="currentColor"/><circle cx="20" cy="44" r="8" ${SH}/>`),
  sling: F(`<path d="M10 10 C20 30 28 40 44 46" stroke="currentColor" stroke-width="3" fill="none"/><path d="M14 8 C30 22 40 30 46 42" stroke="currentColor" stroke-width="3" fill="none"/><circle cx="48" cy="48" r="9" fill="currentColor"/><circle cx="45" cy="45" r="3" ${SH}/>`),
  horse: F(`<path d="M14 60 L18 42 C14 30 20 16 32 10 L36 2 L40 10 C50 13 58 22 58 30 L56 36 L46 34 L42 30 L40 38 C46 44 46 52 44 60 Z" fill="currentColor"/><path d="M36 10 C30 14 26 22 26 30 L22 40" stroke="rgba(0,0,0,.35)" stroke-width="4" fill="none"/><circle cx="46" cy="20" r="2.5" ${SH}/>`),
  harcher: F(`<path d="M14 60 L18 42 C14 30 20 16 32 10 L36 2 L40 10 C50 13 58 22 58 30 L56 36 L46 34 L42 30 L40 38 C46 44 46 52 44 60 Z" fill="currentColor" opacity=".75"/><path d="M6 6 C26 14 26 44 6 52" stroke="currentColor" stroke-width="4" fill="none"/><path d="M6 6 L6 52" stroke="currentColor" stroke-width="1.5"/><circle cx="46" cy="20" r="2.5" ${SH}/>`),
  elephant: F(`<path d="M6 40 C6 24 18 14 32 14 C46 14 54 20 56 30 C58 38 60 48 58 58 L52 58 C54 50 52 44 50 42 L48 58 L41 58 L40 46 L26 46 L25 58 L18 58 L17 46 C12 46 10 50 10 56 L6 56 Z" fill="currentColor"/><path d="M42 18 C36 22 36 32 42 36" stroke="rgba(0,0,0,.35)" stroke-width="3" fill="none"/><path d="M52 34 L60 40" stroke="#f3ead8" stroke-width="3"/><rect x="18" y="4" width="20" height="12" rx="2" fill="currentColor" opacity=".8"/>`),
  eagle: F(`<path d="M32 12 C28 12 26 16 27 20 C18 16 9 17 2 24 C11 24 17 28 21 32 C15 33 11 37 9 42 C17 40 23 40 27 42 L27 50 L22 57 L32 53 L42 57 L37 50 L37 42 C41 40 47 40 55 42 C53 37 49 33 43 32 C47 28 53 24 62 24 C55 17 46 16 37 20 C38 16 36 12 32 12 Z" fill="currentColor"/><circle cx="33" cy="17" r="1.6" ${SH}/><path d="M22 58 H42" stroke="currentColor" stroke-width="3"/>`),
};
export function unitArt(t) {
  if (t.general) return ART.eagle;
  if (t.cls === 'elephant') return ART.elephant;
  if (t.cls === 'harcher') return ART.harcher;
  if (t.cls === 'cav') return ART.horse;
  if (t.cls === 'missile') return t.missile === 'arrow' ? ART.bow : t.missile === 'stone' ? ART.sling : ART.javelin;
  if (t.cls === 'pike') return ART.pike;
  if (t.cls === 'spear') return ART.spear;
  return ART.inf;
}
export const ABIL_ICON = {
  pila: S('<path d="M5 27L22 10M22 10l4-5-6 2zM9 27l15-15M24 12l4-4"/>'),
  testudo: ICONS.testudo, phalanx: ICONS.phalanx,
  charge: S('<path d="M4 16h14M14 10l6 6-6 6M18 8l10 8-10 8"/>'),
  wedge: S('<path d="M16 4L28 26H4z"/><path d="M16 12l6 10H10z"/>'),
  warcry: S('<path d="M6 12c4-4 8-4 10 0s6 4 10 0M6 20c4-4 8-4 10 0s6 4 10 0"/><path d="M4 26l4-2M28 26l-4-2"/>'),
  fire: S('<path d="M16 28c-6 0-9-4-9-9 0-6 6-8 6-14 4 3 5 6 4 9 2-1 3-3 3-5 4 3 6 6 6 10 0 5-4 9-10 9z"/>'),
  rally: ICONS.rally,
  inspire: S('<path d="M16 3l3.5 8.5L28 12l-6.5 5.5L23.5 26 16 21.5 8.5 26l2-8.5L4 12l8.5-.5z"/>'),
};
