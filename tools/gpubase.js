(async () => {
  const g = window.__game;
  g.adaptQuality = () => {};
  const gl = g.gfx.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const orig = g.gfx.render.bind(g.gfx);
  const pending = []; let samples = [];
  g.gfx.render = (dt) => { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); orig(dt); gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) { const q0 = pending.shift(); if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) samples.push(gl.getQueryParameter(q0, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q0); } };
  const frames = (n) => new Promise((r) => { let k = 0; const f = () => (++k < n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); });
  const med = async (n = 120) => { samples = []; const t0 = performance.now(); await frames(n); const ms = (performance.now() - t0) / n; const s = samples.slice().sort((a, b) => a - b); return { gpu: +s[Math.floor(s.length / 2)].toFixed(1), raf: +ms.toFixed(1) }; };
  const out = {};
  await frames(90);
  for (const q of (window.__qs ?? ['high'])) { g.gfx.setQuality(q); g.gfx.setDynamicScale(1); await frames(40); out[q] = await med(); }
  out.calls = g.gfx.renderer.info.render.calls; out.tris = g.gfx.renderer.info.render.triangles;
  return out;
})()
