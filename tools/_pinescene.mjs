// Runs a list of "name|js" stages in one page and screenshots each. node tools/_pinescene.mjs <outdir> <file with stages>
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
import fs from 'node:fs';
const [dir, file] = process.argv.slice(2);
const stages = fs.readFileSync(file, 'utf8').split('\n---\n');
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +(process.env.W ?? 1440), height: +(process.env.H ?? 900) }, deviceScaleFactor: +(process.env.DPR ?? 1) });
const errs = []; page.on('pageerror', (e) => errs.push(e.message + ' ' + (e.stack ?? '').split('\n')[1])); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); if (m.text().startsWith('[t]')) console.log(m.text()); });
await page.goto(`http://localhost:${process.env.PORT ?? 5311}/pine.html?skip`); await page.waitForFunction(() => window.__ready === true); await page.waitForTimeout(600);
for (const st of stages) {
  const nl = st.indexOf('\n'), head = st.slice(0, nl).trim(), js = st.slice(nl + 1), [name, wait] = head.split(' ');
  const r = await page.evaluate(js); if (r !== undefined && r !== null) console.log(name, JSON.stringify(r));
  await page.waitForTimeout(+(wait ?? 900)); await page.screenshot({ path: `${dir}/${name}.png` });
}
console.log(errs.slice(0, 10).join('\n') || 'no errors'); await browser.close();
