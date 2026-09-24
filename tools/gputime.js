(async () => {
  const g = window.__game;
  g.adaptQuality = () => {};
  const gl = g.gfx.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return 'no timer ext';
  const orig = g.gfx.render.bind(g.gfx);
  const pending = [];
  let samples = [];
  g.gfx.render = (dt) => {
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    orig(dt);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    pending.push(q);
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q0 = pending.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) samples.push(gl.getQueryParameter(q0, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q0);
    }
  };
  const frames = (n) => new Promise((r) => { let k = 0; const f = () => (++k < n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); });
  const med = async (n = 90) => { samples = []; await frames(n); const s = samples.slice().sort((a, b) => a - b); return s.length ? +s[Math.floor(s.length / 2)].toFixed(2) : -1; };
  const out = {};
  await frames(60);
  for (const sc of [1, 0.75]) { g.gfx.setDynamicScale(sc); await frames(20); out['gpu@' + sc] = await med(); }
  g.gfx.setDynamicScale(1);
  const scen = g.env.group.children.find((c) => c.name === 'Scenery');
  const tog = async (name, obj) => { if (!obj) return; obj.visible = false; await frames(10); out[name] = await med(60); obj.visible = true; };
  if (scen) for (const c of scen.children) await tog('-' + (c.name || c.type), c);
  await tog('-trackside', g.trackside.group);
  await tog('-pits', g.pits.group);
  await tog('-cars', g.carsGroup);
  await tog('-particles', g.particles.group);
  const sm = g.gfx.renderer.shadowMap; sm.autoUpdate = false; await frames(10); out['-shadowRender'] = await med(60); sm.autoUpdate = true;
  if (g.trackside.setReflections) { g.trackside.setReflections(false); await frames(10); out['-ssr'] = await med(60); g.trackside.setReflections(true); }
  const passes = g.gfx.composer.passes;
  for (const p of passes.slice(1)) { if (!p.enabled) continue; p.enabled = false; const last = passes.filter((x) => x.enabled).pop(); const was = last.renderToScreen; passes.forEach((x) => (x.renderToScreen = false)); last.renderToScreen = true; await frames(10); out['-' + (p.name || p.constructor.name)] = await med(60); p.enabled = true; passes.forEach((x) => (x.renderToScreen = false)); passes.filter((x) => x.enabled).pop().renderToScreen = true; }
  out.calls = g.gfx.renderer.info.render.calls; out.tris = g.gfx.renderer.info.render.triangles;
  return out;
})()
