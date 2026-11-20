// Load the game headless and run a script in the page: node tools/lastframe/eval.mjs PORT map script.js   (the script is a function body; __lf.g is the game; what it returns is printed)
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { CHROME, ANGLE } from '../chrome.mjs';
const [port, map, file] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 400000 });
const out = await p.evaluate(`(async () => { ${readFileSync(file, 'utf8')} })()`);
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
await b.close();
