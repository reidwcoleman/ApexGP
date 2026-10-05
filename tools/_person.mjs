// Close-up of one garage person (index into GarageScene.people). node tools/personshot.mjs [idx=0] [out]
import { chromium } from 'playwright-core';
const [idx = '0', out = 'shots/garage/person.png', dist = '2.4', yawOff = '0.6'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=monza`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.evaluate(() => window.__game.menu['setTab']('race'));
await page.waitForTimeout(1200);
await page.evaluate(([i, d, yo]) => {
  const g = window.__game;
  const p = g.garage.people[i].p;
  const v = p.root.getWorldPosition(p.root.position.clone());
  const yaw = p.root.getWorldQuaternion(p.root.quaternion.clone());
  const fwd = { x: Math.sin(p.root.rotation.y + g.garage.group.rotation.y + yo), z: Math.cos(p.root.rotation.y + g.garage.group.rotation.y + yo) };
  document.getElementById('ui').style.visibility = 'hidden';
  g.freeCam = { pos: [v.x + fwd.x * d, v.y + 1.2, v.z + fwd.z * d], look: [v.x, v.y + 0.95, v.z], fov: 45 };
}, [Number(idx), Number(dist), Number(yawOff)]);
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
await browser.close();
