new Promise((res) => {
  const g = window.__game;
  const acc = { render: 0, race: 0, env: 0, frame: 0, n: 0 };
  const wrap = (obj, key, bucket) => { const f = obj[key].bind(obj); obj[key] = (...a) => { const t = performance.now(); const r = f(...a); acc[bucket] += performance.now() - t; return r; }; };
  wrap(g.gfx, 'render', 'render');
  wrap(g.race, 'update', 'race');
  wrap(g.env, 'update', 'env');
  const fr = g.frame.bind(g);
  g.frame = (dt) => { const t = performance.now(); fr(dt); acc.frame += performance.now() - t; acc.n++; };
  const ts = []; let last = performance.now();
  const f = (now) => { ts.push(now - last); last = now; if (ts.length < 180) requestAnimationFrame(f); else { const n = acc.n; res({ rafMs: +(ts.reduce((a,b)=>a+b,0)/ts.length).toFixed(1), frameJs: +(acc.frame/n).toFixed(2), renderJs: +(acc.render/n).toFixed(2), raceJs: +(acc.race/n).toFixed(2), envJs: +(acc.env/n).toFixed(2) }); } };
  requestAnimationFrame(f);
})
