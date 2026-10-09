// Cold boot over a throttled connection (default 20 Mbps, 40 ms): when the garage is up, and the request waterfall.
//   node tools/_netboot.mjs [url=http://localhost:5194/?track=monza] [mbps=20]
import { chromium } from 'playwright-core';
const [url = 'http://localhost:5194/?track=monza', mbps = '20'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (Number(mbps) * 1e6) / 8, uploadThroughput: 5e6 / 8 });
const t0 = Date.now();
await page.goto(url);
let garage = 0;
await page.waitForFunction(() => !!document.querySelector('.hub-rail'), null, { timeout: 600000 }).then(() => (garage = Date.now() - t0));
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
const ready = Date.now() - t0;
const res = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => [Math.round(r.startTime), Math.round(r.responseEnd), Math.round(r.transferSize / 1024), r.name.replace(location.origin, '')]));
const boot = await page.evaluate(() => window.__bootTimes ?? null);
console.log(`garage visible ${garage} ms · ready ${ready} ms · ${res.length} requests · ${Math.round(res.reduce((a, r) => a + r[2], 0) / 1024)} MB`);
res.sort((a, b) => a[0] - b[0]);
for (const r of res) console.log(String(r[0]).padStart(6), String(r[1]).padStart(6), String(r[2]).padStart(6) + 'k', r[3].slice(0, 90));
await browser.close();
