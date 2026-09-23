new Promise((res) => {
  const ts = [];
  let last = performance.now();
  const g = window.__game;
  const f = (now) => {
    ts.push(now - last);
    last = now;
    if (ts.length < 240) requestAnimationFrame(f);
    else {
      ts.sort((a, b) => a - b);
      const avg = ts.reduce((a, b) => a + b, 0) / ts.length;
      const info = g.gfx.renderer.info;
      res({ avgMs: +avg.toFixed(2), p50: +ts[120].toFixed(2), p95: +ts[228].toFixed(2), calls: info.render.calls, tris: info.render.triangles, geos: info.memory.geometries, tex: info.memory.textures });
    }
  };
  requestAnimationFrame(f);
})
