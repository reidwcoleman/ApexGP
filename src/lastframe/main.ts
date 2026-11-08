import { LF } from './lighting.ts';
import { Game } from './game.ts';
import { capture } from './capture.ts';

async function boot() {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const bar = document.getElementById('lbar') as HTMLElement;
  const step = document.getElementById('lstep') as HTMLElement;
  const g = new Game(canvas);
  g.hud.applyPrefs();
  const q = new URLSearchParams(location.search);
  if (q.has('dev')) g.autoInput = true;
  await g.load((f, what) => {
    bar.style.transform = `scaleX(${f})`;
    step.textContent = what;
  });
  document.getElementById('loading')?.classList.add('done');
  g.hud.ready();
  Object.assign(window, {
    __lf: { scene: g.scene, cam: g.cam, post: g.post, L: g.L, r: g.r, g, LF },
    __capture: async () => {
      g.hideLoose();
      const x = await capture(g.r, g.scene, g.L, (f) => console.log('cap', f));
      let t = '';
      for (let i = 0; i < x.bytes.length; i += 8192) t += String.fromCharCode(...x.bytes.subarray(i, i + 8192));
      return { meta: x.meta, b64: btoa(t) };
    },
  });
}
boot().catch((e) => {
  console.error(e);
  const s = document.getElementById('lstep');
  if (s) s.textContent = 'Could not start: ' + (e?.message ?? e);
});
