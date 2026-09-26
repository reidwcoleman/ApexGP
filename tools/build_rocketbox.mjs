// Build the web people from the Microsoft Rocketbox avatars (MIT) in assets-src/rocketbox
// (fetched by tools/rocketbox_fetch.py). Runs the conversion page (src/dev/rbconvert.ts) in
// headless Chrome against the stable dev server and writes public/models/rocketbox/.
//
//   node tools/build_rocketbox.mjs [--port 5191] [--only Name,Name] [--anims-only] [--no-anims]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'assets-src', 'rocketbox');
const OUT = path.join(ROOT, 'public', 'models', 'rocketbox');
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const has = (k) => args.includes('--' + k);
const port = opt('port', '5191');

/** the avatars the game uses (src/people/Humans.ts ROSTER); others convert with --only */
export const AVATARS = [
  'Male_Adult_01', 'Male_Adult_05', 'Male_Adult_07', 'Male_Adult_08', 'Male_Adult_09', 'Male_Adult_10', 'Male_Adult_11', 'Male_Adult_12',
  'Male_Adult_14', 'Male_Adult_15', 'Male_Adult_16',
  'Female_Adult_01', 'Female_Adult_02', 'Female_Adult_04',
  'Sports_Male_01', 'Sports_Male_02', 'Sports_Female_02',
  'Pilot_Male_03', 'Pilot_Female_01', 'Pilot_Female_02', 'Gardener_Male_01', 'Delivery_Male_01',
];

/** our clip name ← the Rocketbox clip; trimmed / loop-blended where the source is long */
export const CLIPS = [
  { name: 'idle', src: 'idle_neutral_01', range: [0, 12], loop: 0.6 },
  { name: 'idle_breathe', src: 'idle_breathe_01', loop: 0.4 },
  { name: 'look_around', src: 'idle_look_around_01', loop: 0.5 },
  { name: 'waiting', src: 'idle_waiting_01', range: [0, 12], loop: 0.6 },
  { name: 'talk', src: 'gestic_talk_neutral_01', range: [0, 12], loop: 0.6 },
  { name: 'listen', src: 'gestic_listen_neutral_01', range: [0, 10], loop: 0.6 },
  { name: 'cheer', src: 'cheer_01', range: [0, 10], loop: 0.5 },
  { name: 'cheer3', src: 'cheer_03', loop: 0.4 },
  { name: 'cheer4', src: 'cheer_04', loop: 0.4 },
  { name: 'cheer5', src: 'cheer_05', loop: 0.4 },
  { name: 'clap', src: 'claphands_01', range: [0, 8], loop: 0.4 },
  { name: 'wave', src: 'wave_01', loop: 0.4 },
  { name: 'dance', src: 'dancing_neutral', range: [0, 10], loop: 0.5 },
  { name: 'phone', src: 'cell_phone_textmessage', range: [0, 12], loop: 0.6 },
  { name: 'photo', src: 'take_picture', loop: 0.5 },
  { name: 'crouch', src: 'crouch_idle', loop: 0.5 },
  { name: 'crouch_work', src: 'crouch_gestic', range: [0, 11], loop: 0.5 },
  { name: 'sit', src: 'sit_chair_idle_neutral_01', range: [0, 12], loop: 0.6 },
  { name: 'work', src: 'work_mid', range: [0, 12], loop: 0.5 },
  { name: 'work_table', src: 'work_table', range: [0, 12], loop: 0.5 },
  { name: 'trolley', src: 'trolley_idle', range: [0, 10], loop: 0.5 },
  { name: 'walk', src: 'walk_neutral_01', inPlace: true, fps: 24 },
  { name: 'jog', src: 'run_slow_01', inPlace: true, fps: 24 },
  { name: 'run', src: 'run_neutral_01', inPlace: true, fps: 24 },
];

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
await page.route('**/__rb/ls**', (route) => {
  const dir = new URL(route.request().url()).searchParams.get('dir');
  const full = path.join(SRC, dir);
  const list = fs.existsSync(full) ? fs.readdirSync(full) : [];
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) });
});
page.setDefaultTimeout(600000);
await page.goto(`http://localhost:${port}/src/dev/rbconvert.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
fs.mkdirSync(OUT, { recursive: true });
const indexPath = path.join(OUT, 'index.json');
const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : { avatars: {}, anims: {} };
const write = (files) => {
  let n = 0;
  for (const [f, b64] of Object.entries(files)) {
    const buf = Buffer.from(b64, 'base64');
    fs.writeFileSync(path.join(OUT, f), buf);
    n += buf.length;
  }
  return n;
};
const only = opt('only', null)?.split(',');
let bones = null;
if (!has('anims-only')) {
  for (const name of only ?? AVATARS) {
    const t0 = Date.now();
    const r = await page.evaluate(([n]) => window.__rbAvatar(n), [name]);
    const bytes = write(r.files);
    const { log, boneNames, ...meta } = r.meta;
    bones = boneNames;
    index.avatars[name] = { ...meta, bytes, files: Object.keys(r.files) };
    console.log(`${name}: ${(bytes / 1024).toFixed(0)} KB, ${meta.verts} verts, ${meta.tris} tris, ${Date.now() - t0} ms`);
    for (const l of log) console.log('   ', l);
  }
}
if (!has('no-anims')) {
  if (!bones) {
    const r = await page.evaluate(() => window.__rbAvatar('Male_Adult_01', { tex: 64, ntex: 64, hair: 64 }));
    bones = r.meta.boneNames;
  }
  for (const g of ['m', 'f']) {
    const r = await page.evaluate(([g, specs, bones]) => window.__rbAnims(g, specs, bones), [g, CLIPS, bones]);
    const bytes = write(r.files);
    index.anims[g] = { bytes, file: `anims_${g}.bin` };
    console.log(`anims_${g}: ${(bytes / 1024).toFixed(0)} KB`);
    try { fs.unlinkSync(path.join(OUT, `anims_${g}.glb`)); } catch {}
    for (const l of r.meta.log) console.log('   ', l);
  }
}
// (only what the game ships stays in the index: --only adds to it)
if (!only) for (const k of Object.keys(index.avatars)) if (!AVATARS.includes(k)) delete index.avatars[k];
fs.writeFileSync(indexPath, JSON.stringify(index, null, 1));
fs.writeFileSync(
  path.join(OUT, 'LICENSE.txt'),
  `Microsoft Rocketbox Avatar Library
https://github.com/microsoft/Microsoft-Rocketbox

MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Avatars and animations by Microsoft Rocketbox, converted for APEX GP by
tools/build_rocketbox.mjs (metres, quantized GLB, resized WebP textures, a
cloth mask, resampled rotation-only animations; the face rig folded into the head).
`,
);
await browser.close();
