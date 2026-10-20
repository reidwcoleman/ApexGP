// Bytes fetched during a cold boot of the production build (preview on :5194), biggest first.
//   node tools/_netsize.mjs [track]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [track = 'monza'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const rows = [];
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
if (process.env.MBPS) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 25, downloadThroughput: (Number(process.env.MBPS) * 1e6) / 8, uploadThroughput: 5e6 / 8 });
const urls = new Map();
cdp.on('Network.responseReceived', (e) => urls.set(e.requestId, e.response.url));
cdp.on('Network.loadingFinished', (e) => rows.push([urls.get(e.requestId), e.encodedDataLength, e.timestamp]));
const t0 = Date.now();
await page.goto(process.env.URL ?? `http://localhost:${process.env.PORT ?? 5194}/?track=${track}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
console.log('page→ready', Date.now() - t0, 'ms', 'menu shown', await page.evaluate(() => window.__game.bootSteps?.menu));
console.log(JSON.stringify(await page.evaluate(() => ({ boot: window.__game.bootMs, steps: window.__game.bootSteps, world: window.__game.worldTimes, warm: window.__game.warmTimes }))));
const tot = rows.reduce((s, r) => s + r[1], 0);
console.log('requests', rows.length, 'total', (tot / 1048576).toFixed(2), 'MB');
for (const r of rows.sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.N ?? 30))) console.log(String((r[1] / 1024).toFixed(0)).padStart(7), 'kB', r[0]?.replace(/^http:\/\/localhost:\d+/, ''));
await browser.close();
