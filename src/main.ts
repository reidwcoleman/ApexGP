import '@fontsource/titillium-web/600.css';
import '@fontsource/titillium-web/700.css';
import '@fontsource/titillium-web/900.css';
import './ui/tokens.css';
import './ui/hud.css';
import './ui/menu.css';
import { Game } from './game/Game.ts';
import { initUiScale } from './ui/scale.ts';
import { loadPeople } from './people/Humans.ts';
import { preloadPixels } from './core/pixelCache.ts';
import { loadAsphaltScan } from './world/trackside/textures.ts';
import { BRAND_FONTS } from './world/brands.ts';

// boot milestones on the performance timeline (tools/loadbench.mjs reads them: ms since navigation)
performance.mark('apex:main');

declare global {
  interface Window {
    __game?: Game;
    __ready?: boolean;
  }
}

const loading = document.getElementById('loading')!;
const bar = loading.querySelector('.lbar b') as HTMLElement;
const step = loading.querySelector('.lstep') as HTMLElement;
const err = loading.querySelector('.lerr') as HTMLElement;

// the overlays scale with the window (laid out at 1600 × 900)
initUiScale();

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;

/**
 * The downloads and off-thread decodes the boot waits on — the people (~6 MB), the liveries and
 * atlases painted on an earlier visit, the road scan, the fonts — started before anything else, so
 * they run under the Game's construction and the first build steps (each is memoised: boot() picks
 * the same promises up).
 */
let loadsStarted = false;
const startLoads = () => {
  if (loadsStarted) return;
  loadsStarted = true;
  loadPeople().catch(() => undefined);
  void preloadPixels();
  void loadAsphaltScan();
  Promise.all(BRAND_FONTS.map((f) => document.fonts.load(f))).then(
    () => performance.mark('apex:fonts'),
    () => undefined,
  );
};
// …but only once the loading screen has been painted: a module script runs before the page's first
// paint, and from the HTTP cache the downloads land at once — their parsing (the avatars' glTF)
// would keep the first frame back. They start from the frame callback (the frame itself is drawn
// in the same task, before any of them can answer). The Game (~0.5 s of synchronous work, and a
// WebGL context whose creation keeps the GPU process busy) waits until that frame is actually on
// screen — the browser's first contentful paint — or 300 ms at most: the boot's first steps wait
// on those downloads anyway. (A hidden tab never runs frame callbacks: the timeout starts it all.)
const painted = new Promise<void>((r) => {
  let go = false;
  const start = () => {
    if (go) return;
    go = true;
    startLoads();
    setTimeout(r, 0);
  };
  requestAnimationFrame(() => {
    performance.mark('apex:paint');
    startLoads();
  });
  try {
    new PerformanceObserver((list, obs) => {
      if (!list.getEntries().some((e) => e.name === 'first-contentful-paint')) return;
      obs.disconnect();
      start();
    }).observe({ type: 'paint', buffered: true });
  } catch {
    /* no paint timing: the timeout */
  }
  setTimeout(start, 300);
});
const game = await painted.then(() => new Game(canvas, ui));
window.__game = game;

game
  .boot((f, s) => {
    bar.style.width = `${Math.round(f * 100)}%`;
    step.textContent = s;
  })
  .then(async () => {
    performance.mark('apex:garage');
    loading.classList.add('done');
    // once faded out, drop the slideshow (its looping layers would keep compositing under the game)
    setTimeout(() => loading.querySelectorAll('.lart').forEach((im) => im.remove()), 1500);
    const q = new URLSearchParams(location.search);
    // the garage is up; demo sessions and the ready signal wait for the whole circuit behind it
    await game.whenWorld();
    performance.mark('apex:world');
    const demo = q.get('demo');
    if (demo) {
      game.debugStart({
        mode: demo === 'tt' ? 'timetrial' : 'race',
        camera: q.get('cam') ?? undefined,
        autopilot: q.get('auto') !== '0',
        skip: Number(q.get('skip') ?? 0),
        weather: (q.get('weather') as never) ?? undefined,
        time: (q.get('time') as never) ?? undefined,
        grid: q.get('grid') ? Number(q.get('grid')) : undefined,
        laps: q.get('laps') ? Number(q.get('laps')) : undefined,
      });
    }
    // let the loading fade and a few frames settle before signalling ready
    setTimeout(() => (window.__ready = true), Number(q.get('settle') ?? 1500));
  })
  .catch((e: unknown) => {
    console.error(e);
    err.textContent = String((e as Error)?.stack ?? e);
  });
