import '@fontsource/titillium-web/600.css';
import '@fontsource/titillium-web/700.css';
import '@fontsource/titillium-web/900.css';
import './ui/openworld.css';
import { OpenWorld } from './OpenWorld.ts';

/**
 * The open world's own page (miami.html): nothing of the race game's world is loaded — no
 * circuit, no garage, no pit crews, no grandstand crowds. Only the engine (renderer, sky,
 * weather), Miami, its traffic and people, and the vehicles.
 */

declare global {
  interface Window {
    __world?: OpenWorld;
    __ready?: boolean;
  }
}

performance.mark('ow:main');
const loading = document.getElementById('loading')!;
const bar = loading.querySelector('.lbar b') as HTMLElement;
const step = loading.querySelector('.lstep') as HTMLElement;
const err = loading.querySelector('.lerr') as HTMLElement;
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;

// let the loader paint before the heavy synchronous work starts
await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const world = new OpenWorld(canvas, ui);
window.__world = world;
world
  .boot((f, s) => {
    bar.style.width = `${Math.round(f * 100)}%`;
    step.textContent = s;
  })
  .then(() => {
    performance.mark('ow:ready');
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 1200);
    const q = new URLSearchParams(location.search);
    setTimeout(() => (window.__ready = true), Number(q.get('settle') ?? 1200));
  })
  .catch((e: unknown) => {
    console.error(e);
    err.textContent = String((e as Error)?.stack ?? e);
  });
