"""Build Downtown Miami's scene in Blender from work/dt.json (downtown/prep.py).
blender -b --factory-startup -P blender/oceandrive/downtown/build_dt.py [-- --preview]
Writes work/downtown.blend: LIGHTMAPPED (ground, buildings, the bridge), STATIC (railings, props, the
skyline), NOBAKE (the bay, the far ground), PALMS, PROPS."""
import bpy, sys, os, math, random, json
HERE = os.path.dirname(os.path.abspath(__file__))
OD = os.path.dirname(HERE)
sys.path.insert(0, OD)
sys.path.insert(0, HERE)
for m in ('lib', 'hotels', 'palms', 'props', 'towers', 'flora'):
    sys.modules.pop(m, None)
import lib, hotels, palms, props, towers, flora
from lib import MB, hexcol, WHITE
from mathutils import Vector

ASSETS = os.path.join(OD, 'assets')
WORK = os.path.join(OD, 'work')
lib.GEN = os.path.join(ASSETS, 'gen')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = '--preview' in argv
TILE = argv[argv.index('--tile') + 1] if '--tile' in argv else 'dt'
D = json.load(open(os.path.join(WORK, 'dt.json' if TILE == 'dt' else f'tile_{TILE}.json')))
# lightmapped objects carry the tile's name (their maps are named after them)
TP = 'dt' if TILE == 'dt' else TILE
BLEND = 'downtown.blend' if TILE == 'dt' else f'tile_{TILE}.blend'
SW = towers.SW
SEA = -1.5
SUN_AZ = math.radians(-36.0)
SUN_EL = math.radians(19.07)
SUN_E = (9.18, 7.38, 5.23)
HDRI = 'qwantani_late_afternoon_puresky'
HDRI_SUN_AZ = -36.0

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.system = 'METRIC'


def coll(name):
    c = bpy.data.collections.new(name)
    sc.collection.children.link(c)
    return c


def move(ob, c):
    for x in list(ob.users_collection):
        x.objects.unlink(ob)
    c.objects.link(ob)


C_LM = coll('LIGHTMAPPED')
C_STATIC = coll('STATIC')
C_NOBAKE = coll('NOBAKE')
C_TPL = coll('TEMPLATES')
C_PALM = coll('PALMS')
C_PROPS = coll('PROPS')
try:
    hotels.FONT = bpy.data.fonts.load('/System/Library/Fonts/Supplemental/Futura.ttc')
except Exception:
    pass


def tri_layer(mb, tri, z, mat, col=WHITE):
    V, T = tri['v'], tri['t']
    for i in range(0, len(T), 3):
        a, b, c = V[T[i]], V[T[i + 1]], V[T[i + 2]]
        mb.face([(a[0], a[1], z), (b[0], b[1], z), (c[0], c[1], z)], mat, col, n=(0, 0, 1))


# ------------------------------------------------------------------ ground (lightmapped)
mb_g = MB(f'lm_{TP}g')
T = D['tri']
tri_layer(mb_g, T['road'], 0.0, 'od_asphalt')
tri_layer(mb_g, T['pave'], SW, 'od_sidewalk')
tri_layer(mb_g, T['lawn'], SW, 'od_grass')
tri_layer(mb_g, T['paths'], SW, 'od_terrazzo')
tri_layer(mb_g, T['med_grass'], SW, 'od_grass')
tri_layer(mb_g, T['med_pave'], SW, 'od_sidewalk')
tri_layer(mb_g, T['curb'], SW, 'od_curb')
tri_layer(mb_g, T['paint_w'], 0.006, 'od_paint', hexcol('#f4f4f0'))
tri_layer(mb_g, T['xwalk'], 0.007, 'od_paint', hexcol('#f4f4f0'))
tri_layer(mb_g, T['paint_y'], 0.006, 'od_paintyel')
# curbs: the 15 cm step from the road up to the sidewalk (rings oriented: outward = right of each edge)
for r in D['curb_rings']:
    for i in range(len(r) - 1):
        a, b = r[i], r[i + 1]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        if L < 0.02:
            continue
        mb_g.face([(a[0], a[1], 0.0), (b[0], b[1], 0.0), (b[0], b[1], SW), (a[0], a[1], SW)], 'od_curb', WHITE, n=(dy / L, -dx / L, 0))
# the seawall, down into the bay (both faces: the coastline's direction isn't known here)
mb_rail = MB(f'{TP}_rail')
for ln in D['sea_lines']:
    for i in range(len(ln) - 1):
        a, b = ln[i], ln[i + 1]
        q = [(a[0], a[1], SW), (b[0], b[1], SW), (b[0], b[1], -2.6), (a[0], a[1], -2.6)]
        mb_g.face(q, 'od_curb', hexcol('#cfc8bb'))
        mb_g.face(q[::-1], 'od_curb', hexcol('#cfc8bb'))
    # a railing along the baywalk: posts every 2.4 m, a top rail and a mid rail
    s = 0.0
    pts = [Vector((p[0], p[1], 0)) for p in ln]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        L = (b - a).length
        if L < 0.01:
            continue
        u = (b - a) / L
        nrm = Vector((u.y, -u.x, 0))
        for z, hz in ((SW + 1.05, 0.03), (SW + 0.55, 0.015)):
            mb_rail.obox((a + b) / 2 + Vector((0, 0, z)), u, nrm, (0, 0, 1), L / 2, 0.025, hz, 'od_metal', hexcol('#e8e8e4'))
        t = (2.4 - s) % 2.4
        while t < L:
            p = a + u * t
            mb_rail.box(p.x - 0.03, p.y - 0.03, SW, p.x + 0.03, p.y + 0.03, SW + 1.08, 'od_metal', hexcol('#e8e8e4'))
            t += 2.4
        s = (s + L) % 2.4

# river bridges: the deck's edge down to the girder, a concrete parapet
for ln in D.get('bridge_rails', []):
    for i in range(len(ln) - 1):
        a, b = ln[i], ln[i + 1]
        q = [(a[0], a[1], 0.0), (b[0], b[1], 0.0), (b[0], b[1], -1.3), (a[0], a[1], -1.3)]
        mb_g.face(q, 'od_curb', hexcol('#cfc8bb'))
        mb_g.face(q[::-1], 'od_curb', hexcol('#cfc8bb'))
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        u = Vector((dx / L, dy / L, 0)); n = Vector((-u.y, u.x, 0))
        c = Vector(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.55))
        mb_g.obox(c, u, n, (0, 0, 1), L / 2, 0.2, 0.55, 'od_curb', hexcol('#dcd6cb'))

# ------------------------------------------------------------------ buildings (lightmapped, two maps north / south)
mb_b1, mb_b2 = MB(f'lm_{TP}b1'), MB(f'lm_{TP}b2')
YMID = sum(p[1] for p in D['core']) / len(D['core'])
mb_rails = MB(f'{TP}_balcony')
placements = []
styles = {}
for b in D['buildings']:
    cy = sum(p[1] for p in b['fp'][0]) / len(b['fp'][0])
    B = towers.build(mb_b1 if cy > (-560 if TILE == 'dt' else YMID) else mb_b2, mb_rails, b, placements)
    styles[B.style] = styles.get(B.style, 0) + 1
print('buildings', len(D['buildings']), styles)

# ------------------------------------------------------------------ the bridge (lightmapped)
mb_br = MB(f'lm_{TP}br')
BR = D['bridge']
W = D['bridge_w']
def frame(i):
    a = Vector(BR[max(0, i - 1)][:2]); b = Vector(BR[min(len(BR) - 1, i + 1)][:2])
    u = (b - a).normalized()
    return Vector((BR[i][0], BR[i][1], BR[i][2])), Vector((u.x, u.y, 0)), Vector((-u.y, u.x, 0))
prev = None
for i in range(len(BR)):
    p, u, n = frame(i)
    L, R = p + n * (W / 2), p - n * (W / 2)
    cur = dict(p=p, u=u, n=n, L=L, R=R)
    if prev:
        P, Q = prev, cur
        # deck: the two carriageways
        mb_br.face([P['R'], Q['R'], Q['L'], P['L']], 'od_asphalt', WHITE, n=(0, 0, 1))
        # deck edges and the girder underneath
        dz = Vector((0, 0, -1.7))
        for side in ('L', 'R'):
            a, b = P[side], Q[side]
            mb_br.face([a + dz, b + dz, b, a], 'od_curb', hexcol('#d4cfc5'))
            mb_br.face([a, b, b + dz, a + dz], 'od_curb', hexcol('#d4cfc5'))
        gL, gR = P['p'] + P['n'] * (W / 2 - 2) + dz, P['p'] - P['n'] * (W / 2 - 2) + dz
        hL, hR = Q['p'] + Q['n'] * (W / 2 - 2) + dz, Q['p'] - Q['n'] * (W / 2 - 2) + dz
        mb_br.face([P['L'] + dz, Q['L'] + dz, hL, gL], 'od_curb', hexcol('#c4beb2'), n=(0, 0, -1))
        mb_br.face([gR, hR, Q['R'] + dz, P['R'] + dz], 'od_curb', hexcol('#c4beb2'), n=(0, 0, -1))
        mb_br.face([gL, hL, hR, gR], 'od_curb', hexcol('#b8b2a6'), n=(0, 0, -1))
        # jersey barriers: both edges and the median
        for off, wid in ((W / 2 - 0.3, 0.3), (-(W / 2 - 0.3), 0.3), (0.0, 0.35)):
            for (sgn) in (1, -1):
                a0 = P['p'] + P['n'] * (off + sgn * wid); b0 = Q['p'] + Q['n'] * (off + sgn * wid)
                a1 = P['p'] + P['n'] * (off + sgn * 0.12) + Vector((0, 0, 0.85)); b1 = Q['p'] + Q['n'] * (off + sgn * 0.12) + Vector((0, 0, 0.85))
                f = [a0, b0, b1, a1] if sgn > 0 else [a1, b1, b0, a0]
                mb_br.face(f, 'od_curb', hexcol('#dcd7cd'))
            t0 = P['p'] + P['n'] * (off + 0.12) + Vector((0, 0, 0.85)); t1 = Q['p'] + Q['n'] * (off + 0.12) + Vector((0, 0, 0.85))
            t2 = Q['p'] + Q['n'] * (off - 0.12) + Vector((0, 0, 0.85)); t3 = P['p'] + P['n'] * (off - 0.12) + Vector((0, 0, 0.85))
            mb_br.face([t3, t2, t1, t0], 'od_curb', hexcol('#dcd7cd'), n=(0, 0, 1))
        # markings: lane lines (dashed), edge lines
        for off, mat, dash in ((W / 2 - 1.0, 'od_paint', False), (0.75, 'od_paintyel', False), (-0.75, 'od_paintyel', False), (-(W / 2 - 1.0), 'od_paint', False),
                               (4.6, 'od_paint', True), (-4.6, 'od_paint', True)):
            if dash and i % 4 >= 1:
                continue
            a = P['p'] + P['n'] * off + Vector((0, 0, 0.01)); b = Q['p'] + Q['n'] * off + Vector((0, 0, 0.01))
            if dash:
                b = a + (b - a) * 0.75
            w = P['n'] * 0.07
            mb_br.face([a - w, b - w, b + w, a + w], mat, hexcol('#f4f4f0') if mat == 'od_paint' else WHITE, n=(0, 0, 1))
    prev = cur
# piers in the water every ~36 m (where the deck is over the bay)
mb_pier = MB(f'{TP}_piers')
acc = 0.0
for i in range(1, len(BR)):
    acc += math.dist(BR[i][:2], BR[i - 1][:2])
    if acc < 36:
        continue
    acc = 0.0
    p, u, n = frame(i)
    if p.z < 1.0:
        continue
    for s in (-1, 1):
        c = p + n * s * 5.5
        mb_pier.cyl((c.x, c.y, SEA - 3), 0.9, 0.9, p.z - 1.7 - (SEA - 3), 14, 'od_curb', hexcol('#cbc5b9'))
    mb_pier.obox(p + Vector((0, 0, -2.3)), u, n, (0, 0, 1), 1.0, 8.0, 0.6, 'od_curb', hexcol('#c8c2b6'))

# light poles on the bridge's median, both ways
mb_poles = MB(f'{TP}_poles')
acc = 0.0
for i in range(1, len(BR)):
    acc += math.dist(BR[i][:2], BR[i - 1][:2])
    if acc < 42:
        continue
    acc = 0.0
    p, u, n = frame(i)
    mb_poles.cyl((p.x, p.y, p.z + 0.85), 0.12, 0.09, 10.5, 8, 'od_metal', hexcol('#9aa0a4'))
    for s in (-1, 1):
        a = p + Vector((0, 0, 11.2))
        tip = a + n * s * 3.2
        mb_poles.obox((a + tip) / 2, n * s, u, (0, 0, 1), 1.6, 0.06, 0.06, 'od_metal', hexcol('#9aa0a4'))
        mb_poles.obox(tip + Vector((0, 0, -0.1)), n * s, u, (0, 0, 1), 0.45, 0.2, 0.09, 'od_lamp', hexcol('#c9ccce'))

# ------------------------------------------------------------------ the Metromover guideway
mb_mv = MB(f'{TP}_mover')
ZB = 8.6
for ln in D['mover']:
    for i in range(len(ln) - 1):
        a, b = Vector((*ln[i], 0)), Vector((*ln[i + 1], 0))
        L = (b - a).length
        if L < 0.05:
            continue
        u = (b - a) / L
        n = Vector((-u.y, u.x, 0))
        mb_mv.obox((a + b) / 2 + Vector((0, 0, ZB)), u, n, (0, 0, 1), L / 2 + 0.6, 1.25, 0.8, 'od_curb', hexcol('#d9d4ca'))
for x, y in D['mover_cols']:
    mb_mv.cyl((x, y, 0.0), 0.75, 0.65, ZB - 0.8, 12, 'od_curb', hexcol('#d2ccc1'))
    mb_mv.box(x - 1.3, y - 1.3, ZB - 1.2, x + 1.3, y + 1.3, ZB - 0.8, 'od_curb', hexcol('#d2ccc1'))

# ------------------------------------------------------------------ palms
rng = random.Random('dtpalms')
variants = {'royal': [], 'coco': []}
for i, h in enumerate((13.0, 15.5, 17.5, 19.5)):
    ob = flora.royal(f'dtpalm_r{i}', random.Random(300 + i), h).build(weld=False)
    move(ob, C_TPL); ob.hide_render = True
    variants['royal'].append(ob)
for i, h in enumerate((9.0, 10.8, 12.5, 14.0)):
    ob = flora.coconut(f'dtpalm_c{i}', random.Random(400 + i), h).build(weld=False)
    move(ob, C_TPL); ob.hide_render = True
    variants['coco'].append(ob)
for x, y, kind in D['palms']:
    v = rng.choice(variants['royal'] if kind == 'royal' or (kind == 'sidewalk' and rng.random() < 0.55) else variants['coco'])
    o = bpy.data.objects.new('palm', v.data)
    o.location = (x, y, SW - 0.05)
    o.rotation_euler = (0, 0, rng.uniform(0, 6.28))
    s = rng.uniform(0.88, 1.1)
    o.scale = (s, s, s)
    C_PALM.objects.link(o)
print('palms', len(D['palms']))

# ------------------------------------------------------------------ street lamps (the block's scanned lamp)
for x, y, h in D['lamps']:
    # face the road: the lamp arm points along -y in its own frame; h is the sidewalk line's heading
    props.place('lamp', x, y, SW, -h + math.pi, ASSETS, C_PROPS, C_TPL)

# ------------------------------------------------------------------ objects
for mb in (mb_g, mb_b1, mb_b2, mb_br):
    if mb.faces:
        ob = mb.build()
        move(ob, C_LM)
for mb in (mb_rail, mb_rails, mb_pier, mb_poles, mb_mv):
    if mb.faces:
        ob = mb.build()
        move(ob, C_STATIC)

# ------------------------------------------------------------------ world + sun (as the block's)
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
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, BLEND))
print('saved')

if PREVIEW:
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    try:
        sc.eevee.taa_render_samples = 16
    except Exception:
        pass
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = -1.6
    sc.render.film_transparent = False
    cams = {
        'aerial': ((-300.0, -100.0, 160.0), (-850.0, -650.0, 40.0)),
        'boulevard': ((-760.0, -650.0, 1.7), (-820.0, -900.0, 40.0)),
        'bridge': ((-330.0, -60.0, 12.0), (-800.0, -300.0, 60.0)),
    }
    cd = bpy.data.cameras.new('cam'); cd.lens = 24; cd.clip_end = 12000
    cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
    for name, (p, t) in cams.items():
        cam.location = p
        cam.rotation_euler = (Vector(t) - Vector(p)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(WORK, f'dtprev_{name}.png')
        bpy.ops.render.render(write_still=True)
        print('render', name)
