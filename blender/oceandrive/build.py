"""Build the Ocean Drive block scene in Blender from OSM + the generators.
blender -b --factory-startup -P blender/oceandrive/build.py [-- --preview]
Writes work/oceandrive.blend (and preview renders with --preview)."""
import bpy, sys, os, math, random
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
for m in ('lib', 'geo', 'hotels', 'ground', 'palms', 'props'):
    sys.modules.pop(m, None)
import lib, geo, hotels, ground, palms, props
from lib import MB, hexcol, WHITE
from mathutils import Vector

ASSETS = os.path.join(HERE, 'assets')
WORK = os.path.join(HERE, 'work'); os.makedirs(WORK, exist_ok=True)
lib.GEN = os.path.join(ASSETS, 'gen')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = '--preview' in argv

# sun: over the sea, 36 deg south of the street's normal, at the HDRI's own 19 deg
SUN_AZ = math.radians(-36.0)
SUN_EL = math.radians(19.07)
SUN_E = (9.18, 7.38, 5.23)
HDRI = 'qwantani_late_afternoon_puresky'
HDRI_SUN_AZ = -36.0        # where the sun sits in the equirect at rotation 0 (Blender: phi = pi(1-2u), u=0.6003)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.system = 'METRIC'
rng = random.Random(20261123)

def coll(name):
    c = bpy.data.collections.new(name)
    sc.collection.children.link(c)
    return c

def move(ob, c):
    for x in list(ob.users_collection):
        x.objects.unlink(ob)
    c.objects.link(ob)

C_LM = coll('LIGHTMAPPED')
C_STATIC = coll('STATIC')       # occluders / shaded at runtime, no lightmap
C_NOBAKE = coll('NOBAKE')       # sea, horizon (not in the bake at all)
C_TPL = coll('TEMPLATES')

# font for the neon
try:
    hotels.FONT = bpy.data.fonts.load('/System/Library/Fonts/Supplemental/Futura.ttc')
except Exception as e:
    print('font fallback', e)
    hotels.FONT = bpy.data.fonts.get('Bfont Regular') or None

# ------------------------------------------------------------------ frontage
front = {}
for w in geo.WAYS:
    t = w['tags']
    if 'building' not in t:
        continue
    pts = geo.way_local(w)
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    if max(xs) > -20 and min(xs) < -25 and max(xs) < -3 and ground.CITY_Y0 + 10 < min(ys) and max(ys) < ground.CITY_Y1 - 10:
        key = (round(min(ys)), round(max(ys)))
        num = t.get('addr:housenumber', '')
        if key in front and front[key][1]:
            continue
        if not num:
            # unnamed frontage: give it a street number from its position (for the SPECS palette)
            num = {(168, 181): '844', (92, 105): '810'}.get(key, '')
        front[key] = (w, num, (max(min(xs), -48.5), max(xs), min(ys), max(ys)))
mb_block = MB('lm_block')
mb_front2 = MB('lm_front2')
signs, placements = [], []
front_feet = []
for key, (w, num, foot) in sorted(front.items()):
    cy = (foot[2] + foot[3]) / 2
    mb = mb_block if -128 < cy < 140 else mb_front2
    H = hotels.build_hotel(mb, foot, num, random.Random(f'hotel{key}'), signs, placements)
    front_feet.append((foot, H, num))
print('frontage', len(front))
for s in signs:
    move(s, C_STATIC)

# ------------------------------------------------------------------ background city
mb_city = MB('lm_city')
city_feet = []
rng = random.Random('city')
frontage_ids = {v[0]['id'] for v in front.values()}
for w in geo.WAYS:
    t = w['tags']
    if 'building' not in t or w['id'] in frontage_ids or t.get('building') == 'lifeguard_tower':
        continue
    pts = geo.way_local(w)
    if len(pts) < 4:
        continue
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
    if not (ground.CITY_X0 < cx < -3 and ground.CITY_Y0 < cy < ground.CITY_Y1):
        continue
    if max(xs) > -10:     # sidewalk kiosks / dining enclosures on Ocean Drive (the frontage is built above)
        continue
    try:
        h = float(t.get('height', '0').split()[0])
    except ValueError:
        h = 0
    if not h:
        lv = t.get('building:levels')
        h = float(lv) * 3.4 + 1.2 if lv else rng.choice([8.5, 10.5, 11.5, 12.5, 14.0])
    # ccw
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2
    if area < 0:
        pts = pts[::-1]
    city_feet.append(pts)
    col = hexcol(rng.choice(['#f2efe6', '#f4e8d8', '#e8eef0', '#f3e1e4', '#e6efe6', '#efe9d2', '#e2e6ee', '#f6f1e9']))
    z0, z1 = hotels.SW, hotels.SW + h
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        nx, ny = b[1] - a[1], -(b[0] - a[0])
        mb_city.face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], 'od_far', col, n=(nx, ny, 0))
        # parapet lip
        mb_city.face([(a[0], a[1], z1), (b[0], b[1], z1), (b[0] + nx * 0.0, b[1] + ny * 0.0, z1 + 0.6), (a[0], a[1], z1 + 0.6)], 'od_far', col, n=(nx, ny, 0))
    mb_city.face([(p[0], p[1], z1) for p in pts], 'od_roof', WHITE, n=(0, 0, 1))

# ------------------------------------------------------------------ ground
rng = random.Random('ground')
mb_gnear = MB('lm_gnear')
mb_gfar = MB('lm_gfar')
feet = [[(f[0], f[2]), (f[1], f[2]), (f[1], f[3]), (f[0], f[3])] for f, _, _ in front_feet] + city_feet
ground.city_ground(mb_gnear, mb_gfar, feet)
ground.markings(mb_gnear)
walk = ground.park(mb_gnear, mb_gfar, placements, rng)
mb_sea = MB('sea'); ground.sea(mb_sea)
mb_hz = MB('horizon'); ground.horizon_ground(mb_hz)

# ------------------------------------------------------------------ procedural street props (static, not lightmapped)
rng = random.Random('props')
mb_props = MB('props_static')
# sidewalk cafes in front of the restaurant hotels: tables + parasols
CAFE = {'700': '#f2f2ee', '720': '#f2f2ee', '736': '#1d6fb3', '740': '#2f9e86', '750': '#d9577f', '760': '#e8784e', '800': '#2f5d45', '660': '#1f6e86', '650': '#f2f2ee', '820': '#7a5fae', '826': '#7a5fae', '900': '#e8434a'}
for foot, H, num in front_feet:
    if num not in CAFE:
        continue
    xb, xf, y0, y1 = foot
    y = y0 + 1.8
    while y < y1 - 1.6:
        x = -9.0 + rng.uniform(-0.25, 0.25)
        placements.append(('bistro', x, y, hotels.SW, rng.uniform(0, 6.28)))
        props.parasol(mb_props, x, y, hotels.SW, CAFE[num])
        y += 3.3
# lifeguard towers (the OSM ones), facing the sea
props.lifeguard(mb_props, 222, -96, ground.beach_h(222, -96) - 0.1, 0.0, ('#f45d8c', '#ffd23f', '#3bc6c9'))
props.lifeguard(mb_props, 238, 119, ground.beach_h(238, 119) - 0.1, 0.12, ('#3bc6c9', '#ff8c42', '#7b4fd6'))
# the beach rental: rows of loungers in pairs under blue umbrellas, between the lifeguard stands
for y in range(-86, 90, 7):
    if abs(y - 0) < 4:
        continue
    for row, x in enumerate((196.0, 205.0)):
        z = ground.beach_h(x, y)
        props.parasol(mb_props, x, y, z - 0.05, rng.choice(['#1f5fa8', '#1f5fa8', '#f2f2ee']), r=1.25, h=2.2)
        for s_ in (-0.85, 0.85):
            props.lounger(mb_props, x + 0.9, y + s_, ground.beach_h(x + 0.9, y + s_) - 0.02, -math.pi / 2)
# stop signs where 7th and 8th meet Ocean Drive
props.stop_sign(mb_props, -7.1, -74.6, hotels.SW, math.pi)
props.stop_sign(mb_props, -7.1, 62.3, hotels.SW, math.pi)
for kind, x, y, z, r in [p for p in placements if p[0] == 'vball']:
    props.vball(mb_props, x, y, z, r)

# ------------------------------------------------------------------ Poly Haven props
rng = random.Random('scans')
C_PROPS = coll('PROPS')
for kind, x, y, z, r in placements:
    if kind == 'vball':
        continue
    props.place(kind, x, y, z, r, ASSETS, C_PROPS, C_TPL)
for y in range(-320, 410, 26):
    props.place('lamp', 7.15, y + 4, hotels.SW, math.pi, ASSETS, C_PROPS, C_TPL)
    if y % 52 == 0:
        props.place('trash', 9.6, y + 9, hotels.SW, rng.uniform(0, 6.28), ASSETS, C_PROPS, C_TPL)
for (x, y) in ((-7.0, -48.0), (-7.0, 38.5), (7.0, 12.0), (-7.0, 80.0)):
    props.place('hydrant', x, y, hotels.SW, rng.uniform(0, 6.28), ASSETS, C_PROPS, C_TPL)
# benches along the beachwalk
for i, p in enumerate(walk):
    if i % 9 == 4 and ground.NEAR[2] - 60 < p[1] < ground.NEAR[3] + 60:
        a, b = walk[max(0, i - 1)], walk[min(len(walk) - 1, i + 1)]
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        nx, ny = -math.sin(ang), math.cos(ang)
        bx, by = p[0] + nx * 3.2, p[1] + ny * 3.2
        props.place('bench', bx, by, ground.terrain_h(bx, by), ang + math.pi / 2, ASSETS, C_PROPS, C_TPL)
# dune vegetation: sea grape + shrubs
for k in range(260):
    y = rng.uniform(ground.CITY_Y0, ground.CITY_Y1)
    if any(abs(y - g) < 3.5 for g in (-68.5, 68.2)):
        continue
    x = rng.uniform(101, 128)
    kind = rng.choice(['seagrape', 'seagrape', 'seagrape2', 'shrub', 'shrub2'])
    s = rng.uniform(0.55, 0.95) if kind.startswith('seagrape') else rng.uniform(0.9, 1.6)
    props.place(kind, x, y, ground.terrain_h(x, y) - 0.15, rng.uniform(0, 6.28), ASSETS, C_PROPS, C_TPL, scale=s)

# ------------------------------------------------------------------ palms
rng = random.Random('palms')
C_PALM = coll('PALMS')
variants = []
for i, h in enumerate((9.5, 11.0, 12.2, 13.4, 14.6, 16.0)):
    ob = palms.palm_variant(f'palm_{i}', random.Random(100 + i), h).build(weld=False)
    move(ob, C_TPL)
    ob.hide_render = True
    variants.append(ob)
spots = []
for e in geo.NODES.values():
    if e.get('tags', {}).get('natural') == 'tree':
        x, y = geo.L(geo.raw(e['lat'], e['lon']))
        if 11.5 < x < 99 and ground.CITY_Y0 < y < ground.CITY_Y1:
            spots.append((x, y))
def near_walk(x, y, d):
    return any((x - p[0]) ** 2 + (y - p[1]) ** 2 < d * d for p in walk)
def free(x, y, d=4.5):
    return all((x - a) ** 2 + (y - b) ** 2 > d * d for a, b in spots)
y = ground.CITY_Y0 + 4
while y < ground.CITY_Y1 - 4:
    x = 13.6 + rng.uniform(-0.4, 0.6)
    if all(abs(y - g) > 4 for g in (-68.5, 68.2, -28.5, 30.5)) and free(x, y):
        spots.append((x, y))
    y += rng.uniform(8.5, 11.5)
for i, p in enumerate(walk):
    if i % 5 == 0:
        for s in (-1, 1):
            if rng.random() < 0.55:
                x, y = p[0] + s * rng.uniform(4.0, 6.5), p[1] + rng.uniform(-2, 2)
                if 12.5 < x < 98 and free(x, y) and not near_walk(x, y, 3.2):
                    spots.append((x, y))
for (x, y) in spots:
    v = rng.choice(variants)
    o = bpy.data.objects.new('palm', v.data)
    o.location = (x, y, ground.terrain_h(x, y) - 0.05)
    o.rotation_euler = (0, 0, rng.uniform(0, 6.28))
    s = rng.uniform(0.9, 1.08)
    o.scale = (s, s, s)
    C_PALM.objects.link(o)
print('palms', len(spots))

# ------------------------------------------------------------------ objects
for mb in (mb_block, mb_front2, mb_city, mb_gnear, mb_gfar):
    ob = mb.build()
    move(ob, C_LM)
ob = mb_props.build(); move(ob, C_STATIC)
for mb in (mb_sea, mb_hz):
    ob = mb.build(); move(ob, C_NOBAKE)

# ------------------------------------------------------------------ world + sun
world = bpy.data.worlds.new('sky')
sc.world = world
try:
    world.use_nodes = True
except Exception:
    pass
nt = world.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
tc = nt.nodes.new('ShaderNodeTexCoord')
mp = nt.nodes.new('ShaderNodeMapping')
mp.inputs['Rotation'].default_value = (0, 0, math.radians(HDRI_SUN_AZ - math.degrees(SUN_AZ)))
env = nt.nodes.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(os.path.join(ASSETS, 'hdri', HDRI + '.hdr'))
# clamp the sun disc out of the sky: the sun lamp carries it
sep = nt.nodes.new('ShaderNodeMix'); sep.data_type = 'RGBA'; sep.blend_type = 'DARKEN'
sep.inputs['Factor'].default_value = 1.0
sep.inputs['B'].default_value = (20, 20, 20, 1)
bg = nt.nodes.new('ShaderNodeBackground')
out = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
nt.links.new(env.outputs['Color'], sep.inputs['A'])
nt.links.new(sep.outputs['Result'], bg.inputs['Color'])
nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
sun_dir = Vector((math.cos(SUN_AZ) * math.cos(SUN_EL), math.sin(SUN_AZ) * math.cos(SUN_EL), math.sin(SUN_EL)))
sd = bpy.data.lights.new('sun', 'SUN')
mx = max(SUN_E)
sd.color = tuple(c / mx for c in SUN_E)
sd.energy = mx
sd.angle = math.radians(0.6)
sun = bpy.data.objects.new('sun', sd)
sun.rotation_euler = sun_dir.to_track_quat('Z', 'Y').to_euler()
sc.collection.objects.link(sun)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, 'oceandrive.blend'))
print('saved')

# ------------------------------------------------------------------ preview renders
if PREVIEW:
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    try:
        sc.eevee.taa_render_samples = 16
        sc.eevee.use_raytracing = True
    except Exception:
        pass
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = -1.6
    cams = {
        'street': ((-8.6, -45.0, 1.7), (-11.0, 20.0, 6.0)),
        'park': ((26.0, -12.0, 1.7), (-12.0, 8.0, 7.0)),
        'aerial': ((70.0, -130.0, 45.0), (-20.0, 0.0, 0.0)),
        'beach': ((160.0, 10.0, 2.0), (0.0, 0.0, 9.0)),
        'colony': ((4.0, 2.0, 1.7), (-12.0, 8.0, 9.0)),
    }
    if len(argv) > 1:
        cams = {k: v for k, v in cams.items() if k in argv}
    cd = bpy.data.cameras.new('cam'); cd.lens = 24
    cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
    for name, (p, t) in cams.items():
        cam.location = p
        cam.rotation_euler = (Vector(t) - Vector(p)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(WORK, f'prev_{name}.png')
        bpy.ops.render.render(write_still=True)
        print('render', name)
