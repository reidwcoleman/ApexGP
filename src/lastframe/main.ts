import * as THREE from 'three';
import { LF } from './lighting.ts';
import { Game } from './game.ts';
import { capture } from './capture.ts';

async function boot() {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const g = new Game(canvas);
  g.hud.applyPrefs();
  const q = new URLSearchParams(location.search);
  if (q.has('dev')) g.autoInput = true;
  // the menu is up at once; the location loads behind it, and starting waits for it if it has to
  g.hud.ready();
  document.getElementById('loading')?.classList.add('done');
  await g.load((f, what) => g.hud.loading(f, what));
  g.hud.loading(1, 'Ready');
  Object.assign(window, {
    __lf: { scene: g.scene, cam: g.cam, post: g.post, L: g.L, r: g.r, g, LF, THREE },
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
  document.getElementById('loading')?.classList.remove('done');
  const s = document.getElementById('lstep');
  if (s) s.textContent = 'Could not start: ' + (e?.message ?? e);
});
