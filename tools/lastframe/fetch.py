#!/usr/bin/env python3
"""Downloads the CC0 Poly Haven source assets for Last Frame into assets-src/lf (git-ignored)."""
import json, os, sys, urllib.request, concurrent.futures as cf
ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets-src', 'lf')
UA = {'User-Agent': 'apexgp-asset-fetch'}
TEX = '''asphalt_02 clean_asphalt concrete_pavement_02 factory_brick dark_brick_wall brick_wall_001 concrete_wall_006 concrete_wall_008
corrugated_iron_02 box_profile_metal_sheet beige_wall_001 damaged_plaster decrepit_wallpaper grey_plaster linoleum_brown dirty_carpet laminate_floor_02
garage_floor concrete_floor_worn_001 dirty_tiles metal_grate_rusty metal_plate green_metal_rust distressed_painted_planks gravel_concrete blue_plaster_weathered
hangar_concrete_floor'''.split()
MODELS = '''wooden_crate_01 wooden_crate_02 metal_trash_can trashbag cardboard_box_01 steel_frame_shelves_01 steel_frame_shelves_02 steel_frame_shelves_03
metal_office_desk drawer_cabinet sofa_03 old_bed_frame plastic_monobloc_chair_01 SchoolChair_01 vintage_cabinet_01 fire_hydrant concrete_road_barrier covered_car
street_lamp_01 street_lamp_02 exterior_aircon_unit utility_box_01 utility_box_02 power_box_01 propane_tank portable_generator barrel_03 metal_jerrycan old_tyre
mounted_fluorescent_lights hanging_industrial_lamp industrial_wall_lamp security_light rollershutter_door modular_chainlink_fence modular_fire_escape
modular_industrial_pipes_01 modular_airduct_rectangular_01 ladder_sectioned_01 tool_cart hand_truck plastic_crate_01 television_02 WetFloorSign_01 fire_alarm
water_manhole_cover korean_fire_extinguisher_01 service_pistol bolt_action_rifle_7_62 ammo_box wooden_military_crate worn_metal_rack wooden_table_02 painted_wooden_chair_01
modular_electric_cables security_camera_01 cement_bag multi_cleaner_5_litre'''.split()
HDRI = ['dresden_station_night', 'modern_buildings_night', 'rooftop_night', 'cobblestone_street_night']

def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0: return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120)
    with open(path + '.part', 'wb') as f: f.write(r.read())
    os.replace(path + '.part', path)

def files(a):
    return json.load(urllib.request.urlopen(urllib.request.Request('https://api.polyhaven.com/files/' + a, headers=UA), timeout=60))

def tex(a):
    d = files(a); res = '1k'
    out = []
    for k, n in (('Diffuse', 'diff'), ('nor_gl', 'nor'), ('arm', 'arm')):
        if k in d and res in d[k]:
            fm = d[k][res]
            f = fm.get('jpg') or fm.get('png')
            get(f['url'], f'{ROOT}/tex/{a}_{n}.jpg'); out.append(n)
    return a, out

def model(a):
    d = files(a); g = d['gltf']['1k']['gltf']
    base = f'{ROOT}/models/{a}'
    get(g['url'], f'{base}/{a}.gltf')
    for rel, m in g['include'].items(): get(m['url'], f'{base}/{rel}')
    return a, 'ok'

def hdri(a):
    d = files(a); get(d['hdri']['2k']['hdr']['url'], f'{ROOT}/hdri/{a}.hdr'); return a, 'ok'

jobs = [(tex, a) for a in TEX] + [(model, a) for a in MODELS] + [(hdri, a) for a in HDRI]
bad = 0
with cf.ThreadPoolExecutor(8) as ex:
    fs = {ex.submit(f, a): a for f, a in jobs}
    for f in cf.as_completed(fs):
        try: f.result()
        except Exception as e: bad += 1; print('FAIL', fs[f], e)
print('done', len(jobs), 'bad', bad)
