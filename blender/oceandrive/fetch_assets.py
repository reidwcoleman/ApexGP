"""Download the CC0 Poly Haven sources (skies, scanned textures, props) into assets/.
Run: python3 blender/oceandrive/fetch_assets.py   (idempotent)"""
import json, os, sys, urllib.request, concurrent.futures as cf
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'assets')
UA = {'User-Agent': 'asset-fetch/1.0'}
HDRIS = {'qwantani_late_afternoon_puresky': '2k', 'qwantani_dusk_2_puresky': '2k'}
TEX = ['white_stucco_02', 'white_plaster_02', 'concrete_pavement', 'asphalt_02', 'coast_sand_01', 'leafy_grass',
       'terrazzo_tiles', 'coral_stone_wall', 'palm_tree_bark', 'weathered_planks', 'concrete_floor_01', 'patio_tiles']
MAPS = {'Diffuse': 'diff', 'nor_gl': 'nor', 'Rough': 'rough', 'AO': 'ao'}
MODELS = ['outdoor_table_chair_set_01', 'street_lamp_01', 'fire_hydrant', 'metal_trash_can', 'island_tree_02',
          'island_tree_01', 'shrub_02', 'shrub_04', 'exterior_aircon_unit', 'potted_plant_02', 'planter_box_01',
          'water_manhole_cover', 'bar_chair_round_01', 'round_wooden_table_01', 'utility_box_01', 'painted_wooden_bench']

def get(url, dst):
    if os.path.exists(dst) and os.path.getsize(dst) > 0: return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r, open(dst + '.part', 'wb') as f:
        f.write(r.read())
    os.replace(dst + '.part', dst)

def files(aid):
    with urllib.request.urlopen(urllib.request.Request('https://api.polyhaven.com/files/' + aid, headers=UA), timeout=60) as r:
        return json.load(r)

jobs = []
for h, res in HDRIS.items():
    jobs.append((files(h)['hdri'][res]['hdr']['url'], f'{OUT}/hdri/{h}.hdr'))
for t in TEX:
    f = files(t)
    for k, short in MAPS.items():
        if k in f:
            jobs.append((f[k]['2k']['jpg']['url'], f'{OUT}/tex/{t}_{short}.jpg'))
for m in MODELS:
    g = files(m)['gltf']['1k']['gltf']
    jobs.append((g['url'], f'{OUT}/models/{m}/{m}.gltf'))
    for rel, inc in g.get('include', {}).items():
        jobs.append((inc['url'], f'{OUT}/models/{m}/{rel}'))
with cf.ThreadPoolExecutor(8) as ex:
    for _ in ex.map(lambda j: get(*j), jobs): pass
print(len(jobs), 'files ok')
