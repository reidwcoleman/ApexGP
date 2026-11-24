"""public/oceandrive/county.json: the tiles that have been built (names, labels, cores, files, height layers)"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, '..', '..', '..', 'public', 'oceandrive')
T = json.load(open(os.path.join(HERE, 'tiles.json')))
out = []
for k, v in T.items():
    glb = 'downtown.glb' if k == 'dt' else f'tile_{k}.glb'
    sc = 'downtown_scene.json' if k == 'dt' else f'tile_{k}_scene.json'
    gm = 'downtown.json' if k == 'dt' else f'tile_{k}.json'
    if not all(os.path.exists(os.path.join(PUB, f)) for f in (glb, sc, gm)):
        continue
    s = json.load(open(os.path.join(PUB, sc)))
    out.append(dict(name=k, label=v.get('label', k), frame=v.get('frame', 'main'), core=v['core'], glb=glb, scene=sc, data=gm, layers=[l['file'] for l in s['layers']]))
json.dump(dict(tiles=out), open(os.path.join(PUB, 'county.json'), 'w'), indent=1)
print('county', [t['name'] for t in out])
