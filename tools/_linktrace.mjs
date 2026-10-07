// Which shader programs are linked in which frame of the boot (cold profile): finds programs that a
// frame builds synchronously. Each link is tagged with the first custom comment of its fragment shader.
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const port = process.env.PORT ?? 5218;
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.addInitScript(() => {
  window.__links = [];
  window.__frames = [];
  const P = WebGL2RenderingContext.prototype;
  const src = new WeakMap();
  const ss = P.shaderSource;
  P.shaderSource = function (sh, s) { src.set(sh, s); return ss.call(this, sh, s); };
  const att = P.attachShader;
  const progFrag = new WeakMap();
  P.attachShader = function (pr, sh) { const s = src.get(sh) ?? ''; if (/gl_FragColor|pc_fragColor|out highp vec4|layout/.test(s) && s.includes('void main')) progFrag.set(pr, s); return att.call(this, pr, sh); };
  const link = P.linkProgram;
  let frame = 0;
  P.linkProgram = function (pr) {
    const s = progFrag.get(pr) ?? '';
    const name = (s.match(/#define SHADER_NAME (.*)/) ?? [])[1] ?? '?';
    const body = s.slice(s.indexOf('void main'));
    const tag = (body.match(/\/\/ ?([^\n]{8,70})/) ?? [])[1] ?? (s.match(/uniform \w+ (u[A-Z]\w+|apex\w*|c[A-Z]\w+)/) ?? [])[1] ?? '';
    window.__links.push([frame, Math.round(performance.now()), name, tag.trim()]);
    return link.call(this, pr);
  };
  let last = performance.now();
  const f = (t) => { window.__frames.push([frame, Math.round(t), Math.round(t - last), window.__game ? +window.__game.worldProgress.toFixed(3) : -1]); frame++; last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
await p.goto(`http://localhost:${port}/?track=${process.env.TRACK ?? 'monza'}`);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
const { links, frames } = await p.evaluate(() => ({ links: window.__links, frames: window.__frames }));
// long frames and the links made during them (link frame index = the frame that was running)
for (const [i, t, dt, wp] of frames) {
  if (dt < 400) continue;
  const ls = links.filter((l) => l[0] === i - 1);
  console.log(`frame ${i} t=${t} dt=${dt} world=${wp} links=${ls.length}`);
  for (const l of ls) console.log('    ', l[2], '|', l[3]);
}
console.log('total links', links.length);
await b.close();
