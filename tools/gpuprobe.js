(async () => {
  const g = window.__game;
  const measure = () => new Promise((res) => { const ts = []; let last = performance.now(); const f = (now) => { ts.push(now - last); last = now; if (ts.length < 90) requestAnimationFrame(f); else { ts.sort((a,b)=>a-b); res(+ts[45].toFixed(1)); } }; requestAnimationFrame(f); });
  const out = {};
  out.base = await measure();
  g.gfx.ao.enabled = false; out.noAO = await measure(); g.gfx.ao.enabled = true;
  const sm = g.gfx.renderer.shadowMap; sm.enabled = false; out.noShadow = await measure(); sm.enabled = true;
  const passes = g.gfx.composer.passes; const post = passes.slice(1); post.forEach(p => p.enabled = false); passes[passes.length-1].renderToScreen = false; passes[0].renderToScreen = true; out.noPost = await measure(); passes[0].renderToScreen = false; post.forEach(p => p.enabled = true);
  g.gfx.renderer.setPixelRatio(0.5); g.gfx.composer.setSize(innerWidth, innerHeight); out.halfRes = await measure(); g.gfx.renderer.setPixelRatio(1); g.gfx.composer.setSize(innerWidth, innerHeight);
  g.env.group.visible = false; out.noEnv = await measure(); g.env.group.visible = true;
  g.trackside.group.visible = false; out.noTrackside = await measure(); g.trackside.group.visible = true;
  g.carsGroup.visible = false; out.noCars = await measure(); g.carsGroup.visible = true;
  return out;
})()
