/**
 * One scale for every overlay (HUD, broadcast, menus): the UI is laid out on a
 * 1600 × 900 canvas and zoomed with the window, so a 4K screen gets the same
 * composition as a laptop instead of a postage stamp in the corner.
 *
 * 1280 × 720 → 0.85, 1024 × 600 → 0.74, 800 × 600 and smaller → 0.7 (the floor), 1920 × 1080 → 1.2,
 * 2560 × 1440 → 1.6, 3840 × 2160 → 2.4. Published as `--ui` on :root, which the
 * stylesheets use as `zoom: var(--ui)` (and to divide viewport units inside a zoomed box).
 */

let current = 1;

/** the current UI zoom (layout px → screen px) */
export function uiScale(): number {
  return current;
}

/** the layout height the overlays see (CSS px before the zoom) */
export function uiHeight(): number {
  return innerHeight / current;
}

function compute() {
  const s = Math.min(innerWidth / 1600, innerHeight / 900);
  // the floor: 0.85 at 720p, easing down to 0.7 for small windows (below that text gets too small to
  // read; the layout still fits down to ~1100 × 780 layout px, and phones get the narrow layout)
  const lo = Math.max(0.7, Math.min(0.85, s + 0.1));
  const next = Math.round(Math.max(lo, Math.min(2.4, s)) * 1000) / 1000;
  if (next === current && document.documentElement.style.getPropertyValue('--ui')) return;
  current = next;
  document.documentElement.style.setProperty('--ui', String(current));
}

let started = false;
export function initUiScale() {
  if (started) return;
  started = true;
  compute();
  addEventListener('resize', compute);
}
