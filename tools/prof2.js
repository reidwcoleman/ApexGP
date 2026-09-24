new Promise((res) => {
  const g = window.__game;
  const acc = {};
  const wrap = (obj, key, bucket) => { if (!obj || !obj[key]) return; const f = obj[key].bind(obj); acc[bucket] = 0; obj[key] = (...a) => { const t = performance.now(); const r = f(...a); acc[bucket] += performance.now() - t; return r; }; };
  wrap(g.gfx, 'render', 'render');
  wrap(g.race, 'update', 'race');
  wrap(g.env, 'update', 'env');
  wrap(g.env, 'setWeather', 'envWeather');
  wrap(g.env, 'focusShadow', 'shadowFocus');
  wrap(g.trackside, 'update', 'trackside');
  wrap(g.pits, 'update', 'pits');
  wrap(g.carFx, 'update', 'carFx');
  wrap(g.particles, 'update', 'particles');
  wrap(g.hud, 'update', 'hud');
  wrap(g, 'syncAllViews', 'views');
  wrap(g, 'updateAudio', 'audio');
  wrap(g.cams, 'update', 'cams');
  acc.frame = 0; let n = 0;
  const fr = g.frame.bind(g);
  g.frame = (dt) => { const t = performance.now(); fr(dt); acc.frame += performance.now() - t; n++; };
  const ts = []; let last = performance.now();
  const f = (now) => { ts.push(now - last); last = now; if (ts.length < 240) requestAnimationFrame(f); else { const out = { rafMs: +(ts.reduce((a,b)=>a+b,0)/ts.length).toFixed(1) }; for (const k in acc) out[k] = +(acc[k] / n).toFixed(2); const info = g.gfx.renderer.info; out.calls = info.render.calls; out.tris = info.render.triangles; out.scale = g.gfx.dynamicScale; res(out); } };
  requestAnimationFrame(f);
})
