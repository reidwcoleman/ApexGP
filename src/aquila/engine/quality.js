// Graphics quality, persisted per browser. 'high' (default) or 'balanced' for weaker machines.
export const Q = { level: (() => { try { return localStorage.getItem('aquila.quality') || 'high'; } catch { return 'high'; } })() };
export const high = () => Q.level === 'high';
export function setQuality(level, renderer) {
  Q.level = level;
  try { localStorage.setItem('aquila.quality', level); } catch { /* storage blocked */ }
  if (renderer) { renderer.setPixelRatio(pixelRatio()); renderer.setSize(innerWidth, innerHeight, false); }
}
export const pixelRatio = () => Math.min(window.devicePixelRatio || 1, high() ? 1.75 : 1.1);
