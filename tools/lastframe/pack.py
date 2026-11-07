#!/usr/bin/env python3
"""Turns the bake output into what the game loads: public/lastframe/. Run with the system python."""
import json, os, sys, subprocess, shutil, math
import numpy as np
from PIL import Image
from mats import MATS, UNLIT
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/lf_out'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
DST = os.path.join(ROOT, 'public', 'lastframe')
SRC = os.path.join(ROOT, 'assets-src', 'lf', 'tex')
os.makedirs(DST + '/tex', exist_ok=True)
LOGR = 11.0          # log2 range of the encoding
K = 64.0             # lm = (2^(e*LOGR) - 1) / K

def enc(a):
    return np.clip(np.log2(1.0 + np.maximum(a, 0) * K) / LOGR, 0, 1)

lm = np.load(f'{OUT}/lightmap.npy').astype(np.float32)[::-1]    # blender rows run bottom-up
print('lightmap', lm.shape, 'mean', lm.mean(), 'p99', np.percentile(lm, 99), 'max', lm.max())
Image.fromarray((enc(lm) * 255 + 0.5).astype(np.uint8)).save(f'{DST}/lm.webp', quality=int(os.environ.get('LMQ', 96)), method=4)
lm2 = np.load(f'{OUT}/lightmap2.npy').astype(np.float32)[::-1]
Image.fromarray((enc(lm2) * 255 + 0.5).astype(np.uint8)).save(f'{DST}/lm2.webp', quality=int(os.environ.get('LMQ', 96)), method=4)
sky = np.load(f'{OUT}/sky.npy').astype(np.float32)[::-1]
Image.fromarray((enc(sky) * 255 + 0.5).astype(np.uint8)).save(f'{DST}/sky.webp', quality=88, method=4)

raw = json.load(open(f'{OUT}/map_raw.json'))
def yp(p): return [round(p[0], 4), round(p[2], 4), round(-p[1], 4)]
def ybox(a, b): return [a[0], a[2], -b[1]], [b[0], b[2], -a[1]]
cols = []
for c in raw['colliders']:
    a, b = ybox(c['a'], c['b'])
    cols.append([*[round(v, 3) for v in a], *[round(v, 3) for v in b], 1 if c['pen'] else 0, c['tag'], c['mat']])
tex = sorted({v['tex'] for k, v in MATS.items() if not v['emit']})
mats = {k: v for k, v in MATS.items()}
doors = []
for d in raw['doors']:
    doors.append(dict(axis=d['axis'], hinge=yp(d['hinge']), w=d['w'], h=d['h'], sign=d['sign'], swing=d['swing'], kind=d['kind'], t=d['t']))
glass = []
for g in raw['glass']:
    glass.append(dict(axis=g['axis'], c=g['c'], a=g['a'], b=g['b'], z0=g['z0'], z1=g['z1']))
out = dict(mats=raw['mats'], materials=mats, textures=tex, colliders=cols, props=[{**dict(id=p['id'], pos=yp(p['pos']), rot=p['rot'], s=p['s']), **({'tilt': p['tilt']} if 'tilt' in p else {}), **({'loose': p['loose']} if 'loose' in p else {})} for p in raw['props']], doors=doors, glass=glass, units=[dict(id=u['id'], pos=yp(u['pos']), rot=u['rot'], sc=u['sc'], tint=u['tint'], **({'tile': u['tile']} if 'tile' in u else {})) for u in raw['units']],
           spawns={k: [yp(s) for s in v] for k, v in raw['spawns'].items()}, hold=[yp(p) for p in raw['hold']],
           zones=[dict(a=ybox(z['a'], z['b'])[0], b=ybox(z['a'], z['b'])[1], kind=z['kind']) for z in raw['zones']],
           lights=[dict(kind=l['kind'], pos=yp(l['pos']), color=l['color'], power=l['power']) for l in raw['lights']],
           rooms=[dict(name=r['name'], a=ybox(r['a'], r['b'])[0], b=ybox(r['a'], r['b'])[1]) for r in raw['rooms']],
           lm=dict(logr=LOGR, k=K, size=raw['size']))
json.dump(out, open(f'{DST}/map.json', 'w'), separators=(',', ':'))
shutil.copy(f'{OUT}/world.bin', f'{DST}/world.bin')
if os.path.exists(f'{OUT}/props.glb'):
    # webp textures and meshopt geometry: 52 MB of props comes down to about 15
    import subprocess
    tmp = f'{OUT}/props_webp.glb'
    subprocess.run(['npx', '--yes', '@gltf-transform/cli', 'webp', f'{OUT}/props.glb', tmp, '--quality', '72'], check=True, cwd=ROOT)
    subprocess.run(['npx', '--yes', '@gltf-transform/cli', 'meshopt', tmp, f'{DST}/props.glb', '--level', 'medium'], check=True, cwd=ROOT)
if '--tex' in sys.argv:
    for t in tex:
        for suf, n, q in (('diff', 'c', 80), ('nor', 'n', 86), ('arm', 'a', 70)):
            s = f'{SRC}/{t}_{suf}.jpg'
            s2 = f'{SRC}2k/{t}_{suf}.jpg'
            if os.path.exists(s2):
                s = s2
                q = 66 if n == 'c' else 72
            if os.path.exists(s):
                subprocess.run(['cwebp', '-quiet', '-q', str(q), '-m', '6', s, '-o', f'{DST}/tex/{t}_{n}.webp'], check=True)
            elif n == 'a':
                # some scans ship no packed map: flat AO 1, roughness 0.85
                Image.new('RGB', (4, 4), (255, 217, 0)).save(f'{DST}/tex/{t}_a.webp', lossless=True)
sz = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(DST) for f in fs)
print('public/lastframe', sz // 1024 // 1024, 'MB')
