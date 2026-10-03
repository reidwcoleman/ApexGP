// Load-time benchmark of a production build: a cold visit (empty profile: no HTTP cache, no pixel
// cache, no GPU shader cache), then a warm one in the same profile (everything cached), then a
// circuit switch and a race start. Reads the performance marks main.ts sets (apex:main = bundle
// evaluated, apex:garage = garage up and interactive, apex:world = circuit complete = __ready without
// the settle delay), long tasks while the circuit grows behind the garage, and the bytes transferred.
//
//   npm run build && node tools/pagesserve.mjs 5217 &      (GitHub-Pages-like: gzip, max-age=600, ETag)
//   node tools/loadbench.mjs [--port 5217] [--track monza] [--to spa] [--runs 1] [--warm 3] [--net 50] [--ports 5217,5218] [--switch 0]
//
// --net <Mbit/s> throttles the download (plus 25 ms RTT) through CDP; --ports interleaves the runs
// over several servers (A/B: e.g. a baseline dist on another port) and prints a median table per port.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const ports = String(arg('ports', arg('port', '5217'))).split(',');
const track = arg('track', 'monza');
const to = arg('to', 'spa');
const runs = Number(arg('runs', 1));
const net = Number(arg('net', 0));
const race = arg('race', '1') !== '0';
const TIMEOUT = 600000;

// CPU time per process (s) from the browser target: renderer + GPU work, much steadier than wall
// time on a busy machine (wall time is what the player feels; this is how much work it took)
let bcdp = null;
async function cpu() {
  const { processInfo } = await bcdp.send('SystemInfo.getProcessInfo');
  return new Map(processInfo.map((p) => [p.id, p]));
}
const cpuDelta = (a, b, type) => {
  let t = 0;
  for (const [id, p] of b) if (p.type === type) t += p.cpuTime - (a.get(id)?.cpuTime ?? 0);
  return Math.round(t * 1000);
};

async function visit(ctx, url) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  // LOG=<text>: echo the page's console lines containing it (e.g. LOG='[shot]')
  if (process.env.LOG) page.on('console', (m) => m.text().includes(process.env.LOG) && console.log('  [console]', m.text().slice(0, 400)));
  if (net) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 25, downloadThroughput: (net * 1e6) / 8, uploadThroughput: (10 * 1e6) / 8 });
  }
  await page.addInitScript(() => {
    window.__lt = [];
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true });
    } catch {}
  });
  const c0 = await cpu();
  await page.goto(url);
  await page.waitForFunction(() => performance.getEntriesByName('apex:garage').length > 0, null, { timeout: TIMEOUT, polling: 100 });
  const c1 = await cpu();
  await page.waitForFunction(() => performance.getEntriesByName('apex:world').length > 0, null, { timeout: TIMEOUT, polling: 250 });
  const c2 = await cpu();
  const r = await page.evaluate(() => {
    const m = (k) => Math.round(performance.getEntriesByName(k)[0]?.startTime ?? -1);
    const fcp = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint');
    const res = performance.getEntriesByType('resource');
    const nav = performance.getEntriesByType('navigation')[0];
    const g = m('apex:garage');
    const after = window.__lt.filter(([s]) => s >= g);
    return {
      fcp: Math.round(fcp?.startTime ?? -1),
      paint: m('apex:paint'),
      // (the boot's downloads and decodes: when each was ready)
      ready: { fonts: m('apex:fonts'), ground: m('apex:ground'), grass: m('apex:grass') },
      main: m('apex:main'),
      garage: g,
      world: m('apex:world'),
      kb: Math.round((res.reduce((a, e) => a + (e.transferSize || 0), 0) + (nav?.transferSize || 0)) / 1024),
      reqs: res.length,
      ltMax: after.reduce((a, [, d]) => Math.max(a, d), 0),
      ltSum: after.reduce((a, [, d]) => a + d, 0),
      ltBefore: window.__lt.filter(([s]) => s < g).reduce((a, [, d]) => a + d, 0),
      steps: window.__game.bootSteps,
      wt: window.__game.worldTimes,
    };
  });
  // (ms of CPU: the page's renderer and the GPU process, to the garage and to the complete circuit)
  r.cpu = { rGarage: cpuDelta(c0, c1, 'renderer'), gGarage: cpuDelta(c0, c1, 'GPU'), rWorld: cpuDelta(c0, c2, 'renderer'), gWorld: cpuDelta(c0, c2, 'GPU') };
  return { page, r };
}

async function switchAndRace(page) {
  const sw = await page.evaluate(async (id) => {
    const t = performance.now();
    await window.__game.travelAsync(id);
    const garage = performance.now() - t;
    await window.__game.whenWorld();
    return { garage: Math.round(garage), world: Math.round(performance.now() - t), times: window.__game.worldTimes };
  }, to);
  if (!race) return { sw };
  const rs = await page.evaluate(async () => {
    // a race from the garage: frames until the intro runs smoothly, and the worst frame in its first 3 s
    const ft = [];
    let last = performance.now();
    const t0 = last;
    window.__game.debugStart({ mode: 'race', camera: 'chase', autopilot: true });
    await new Promise((res) => {
      const f = (now) => {
        ft.push(now - last);
        last = now;
        if (now - t0 < 3000) requestAnimationFrame(f);
        else res();
      };
      requestAnimationFrame(f);
    });
    return { first: Math.round(ft[0]), max: Math.round(Math.max(...ft)), frames: ft.length, over50: ft.filter((x) => x > 50).length };
  });
  return { sw, rs };
}

// one browser for every port (each its own origin: its own HTTP cache, IndexedDB and code cache;
// the GPU program cache is shared, as on a player's machine): per run, a cold visit to each
// port, then --warm visits to each in turn (interleaved, so the machine's load hits both alike), then
// a circuit switch and a race start on each port's last warm page
const all = Object.fromEntries(ports.map((p) => [p, { cold: [], warm: [], sw: [], rs: [] }]));
const warmN = Number(arg('warm', 1));
for (let k = 0; k < runs; k++) {
  // (a fresh browser per run, on a fresh on-disk profile: empty HTTP cache, IndexedDB and GPU program
  // cache; the run's visits share it, like a player's profile. Chrome is started here and attached
  // over CDP: a persistent profile with the browser target, for the per-process CPU times.)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apexload-'));
  const dport = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', 'about:blank'],
    { stdio: 'ignore' },
  );
  let browser = null;
  for (let i = 0; i < 120 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${dport}`);
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  bcdp = await browser.newBrowserCDPSession();
  const ctx = browser.contexts()[0];
  const url = (port) => `http://localhost:${port}/?track=${track}&settle=0`;
  // (the cold visits share the GPU's program cache: the first port of a run pays for both, so the
  // order flips every run)
  for (const port of k % 2 ? [...ports].reverse() : ports) {
    const cold = await visit(ctx, url(port));
    console.log(`[${port} run ${k + 1}] cold`, JSON.stringify(cold.r));
    all[port].cold.push(cold.r);
    await cold.page.waitForTimeout(12000); // idle-time cache writes (pixel cache, code cache)
    await cold.page.close();
  }
  for (let w = 0; w < warmN; w++)
    for (const port of ports) {
      const warm = await visit(ctx, url(port));
      console.log(`[${port} run ${k + 1}] warm ${w + 1}`, JSON.stringify(warm.r));
      all[port].warm.push(warm.r);
      if (w === warmN - 1 && arg('switch', '1') !== '0') {
        const sr = await switchAndRace(warm.page);
        console.log(`[${port} run ${k + 1}] switch→${to}`, JSON.stringify(sr));
        all[port].sw.push(sr.sw);
        if (sr.rs) all[port].rs.push(sr.rs);
      }
      await warm.page.waitForTimeout(3000);
      await warm.page.close();
    }
  await browser.close().catch(() => {});
  chrome.kill();
  await new Promise((r) => setTimeout(r, 1000));
  fs.rmSync(dir, { recursive: true, force: true });
}

const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};
console.log('\nmedians (ms since navigation; kB transferred)');
console.log('port  | cold fcp main garage world kB ltMax | warm fcp main garage world kB ltMax | switch garage world | race first max >50ms | CPU ms renderer/GPU: cold garage, cold world, warm garage, warm world');
for (const [port, R] of Object.entries(all)) {
  const c = (a, f) => med(a.map(f));
  console.log(
    `${port} | ${c(R.cold, (r) => r.fcp)} ${c(R.cold, (r) => r.main)} ${c(R.cold, (r) => r.garage)} ${c(R.cold, (r) => r.world)} ${c(R.cold, (r) => r.kb)} ${c(R.cold, (r) => r.ltMax)}` +
      ` | ${c(R.warm, (r) => r.fcp)} ${c(R.warm, (r) => r.main)} ${c(R.warm, (r) => r.garage)} ${c(R.warm, (r) => r.world)} ${c(R.warm, (r) => r.kb)} ${c(R.warm, (r) => r.ltMax)}` +
      ` | ${c(R.sw, (r) => r.garage)} ${c(R.sw, (r) => r.world)} | ${c(R.rs, (r) => r.first)} ${c(R.rs, (r) => r.max)} ${c(R.rs, (r) => r.over50)}` +
      ` | ${c(R.cold, (r) => r.cpu.rGarage)}/${c(R.cold, (r) => r.cpu.gGarage)} ${c(R.cold, (r) => r.cpu.rWorld)}/${c(R.cold, (r) => r.cpu.gWorld)} ${c(R.warm, (r) => r.cpu.rGarage)}/${c(R.warm, (r) => r.cpu.gGarage)} ${c(R.warm, (r) => r.cpu.rWorld)}/${c(R.warm, (r) => r.cpu.gWorld)}`,
  );
}
