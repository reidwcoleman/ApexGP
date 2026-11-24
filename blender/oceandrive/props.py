"""Street furniture (inside Blender): Poly Haven scans as linked-duplicate templates, plus procedural
parasols, lifeguard towers, volleyball nets, stop signs and street-name blades."""
import bpy, math, os
from mathutils import Vector, Matrix
from lib import MB, hexcol, WHITE

TEMPLATES = {}
PH = {
    'bistro': 'outdoor_table_chair_set_01', 'lamp': 'street_lamp_01', 'hydrant': 'fire_hydrant',
    'trash': 'metal_trash_can', 'seagrape': 'island_tree_02', 'seagrape2': 'island_tree_01', 'shrub': 'shrub_02', 'shrub2': 'shrub_04',
    'aircon': 'exterior_aircon_unit', 'planter': 'planter_box_01', 'potted': 'potted_plant_02',
    'manhole': 'water_manhole_cover', 'utility': 'utility_box_01', 'bench': 'painted_wooden_bench',
}


def template(kind, assets, coll):
    if kind in TEMPLATES:
        return TEMPLATES[kind]
    aid = PH[kind]
    path = os.path.join(assets, 'models', aid, aid + '.gltf')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = set(o for o in bpy.data.objects if o not in before)
    meshes = [o for o in bpy.data.objects if o in new and o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    # bake parent transforms into the meshes, then join
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    keep = ob.name
    for o in list(bpy.data.objects):
        try:
            if o in new and o.name != keep:
                bpy.data.objects.remove(o)
        except ReferenceError:
            pass
    # origin at the bottom centre
    vs = [v.co for v in ob.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    c = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    ob.data.transform(Matrix.Translation(-c))
    ob.location = (0, 0, 0)
    ob.name = 'tpl_' + kind
    ob.data.name = 'ph_' + kind
    for c_ in list(ob.users_collection):
        c_.objects.unlink(ob)
    coll.objects.link(ob)
    ob.hide_render = True
    ob.hide_set(True)
    TEMPLATES[kind] = ob
    print('template', kind, 'size', tuple(round(v, 2) for v in (mx - mn)))
    return ob


def place(kind, x, y, z, rot, assets, coll, tcoll, scale=1.0):
    t = template(kind, assets, tcoll)
    o = bpy.data.objects.new(f'{kind}', t.data)
    o.location = (x, y, z)
    o.rotation_euler = (0, 0, rot)
    o.scale = (scale, scale, scale)
    coll.objects.link(o)
    return o


def parasol(mb, x, y, z, col, r=1.35, h=2.45):
    """market umbrella: pole, eight-panel canopy, valance"""
    mb.cyl((x, y, z), 0.025, 0.025, h + 0.25, 8, 'od_metal', hexcol('#e9e6df'))
    n = 8
    c = hexcol(col)
    apex = Vector((x, y, z + h + 0.42))
    rim = [Vector((x + math.cos(2 * math.pi * k / n) * r, y + math.sin(2 * math.pi * k / n) * r, z + h)) for k in range(n)]
    for k in range(n):
        a, b = rim[k], rim[(k + 1) % n]
        mb.face([a, b, apex], 'od_fabric', c, n=(0, 0, 1))
        mb.face([a, b, apex], 'od_fabric', c, n=(0, 0, -1))
        mb.face([a, b, b - Vector((0, 0, 0.18)), a - Vector((0, 0, 0.18))], 'od_fabric', c, n=((a.x + b.x) / 2 - x, (a.y + b.y) / 2 - y, 0))
        mb.face([a, b, b - Vector((0, 0, 0.18)), a - Vector((0, 0, 0.18))], 'od_fabric', c, n=(x - (a.x + b.x) / 2, y - (a.y + b.y) / 2, 0))
    # base
    mb.cyl((x, y, z), 0.22, 0.2, 0.08, 12, 'od_metal', hexcol('#3a3a3a'))


def lifeguard(mb, x, y, z, rot, colors):
    """a Miami Beach lifeguard stand: hut on stilts, ramp, flag pole"""
    ca, cb, cc = (hexcol(c) for c in colors)
    cs, sn = math.cos(rot), math.sin(rot)
    def T(px, py, pz):
        return (x + px * cs - py * sn, y + px * sn + py * cs, z + pz)
    ax, ay, az = (cs, sn, 0), (-sn, cs, 0), (0, 0, 1)
    def box(px, py, pz, hx, hy, hz, mat, col):
        mb.obox(T(px, py, pz), ax, ay, az, hx, hy, hz, mat, col)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(sx * 1.15, sy * 1.15, 0.9, 0.08, 0.08, 0.9, 'od_wood', WHITE)
    box(0, 0, 1.85, 1.6, 1.6, 0.06, 'od_wood', WHITE)                       # deck
    box(0.2, 0, 2.95, 1.1, 1.25, 1.05, 'od_stucco', ca)                      # cabin
    box(1.32, 0, 2.95, 0.02, 1.0, 0.45, 'od_glass', WHITE)                    # sea window
    box(0.2, 0, 4.1, 1.35, 1.5, 0.1, 'od_stucco', cb)                        # roof slab
    box(0.2, 0, 4.3, 0.9, 1.0, 0.12, 'od_stucco', cc)
    box(1.25, 0, 2.2, 0.03, 1.25, 0.25, 'od_stucco', cb)                     # stripe
    box(-1.6, 1.25, 1.85, 0.03, 0.35, 0.45, 'od_wood', WHITE)                # rail
    # ramp down the back
    L = 4.2
    for k in range(6):
        t = k / 6
        box(-1.6 - L * (t + 1 / 12), 0, 1.85 * (1 - t - 1 / 12), L / 12, 0.55, 0.04, 'od_wood', WHITE)
    mb.cyl(T(0.2, 1.2, 4.2), 0.025, 0.025, 2.2, 6, 'od_metal', WHITE)


def vball(mb, x, y, z, rot):
    cs, sn = math.cos(rot), math.sin(rot)
    for s in (-1, 1):
        px, py = x + (-sn) * s * 4.9, y + cs * s * 4.9
        mb.cyl((px, py, z), 0.05, 0.05, 2.55, 8, 'od_metal', hexcol('#d8d8d8'))
    a = (x - (-sn) * 4.9, y - cs * 4.9)
    b = (x + (-sn) * 4.9, y + cs * 4.9)
    # the net: white top and bottom tapes, a mesh of cords between (real geometry: it survives export)
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    ax_, ay_, az_ = (ux, uy, 0), (cs, sn, 0), (0, 0, 1)
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    top, bot = z + 2.43, z + 1.55
    mb.obox((mx, my, top), ax_, ay_, az_, L / 2, 0.006, 0.035, 'od_fabric', WHITE)
    mb.obox((mx, my, bot), ax_, ay_, az_, L / 2, 0.006, 0.025, 'od_fabric', WHITE)
    k = 0.1
    t = 0.0
    while t <= L:
        px, py = a[0] + ux * t, a[1] + uy * t
        mb.obox((px, py, (top + bot) / 2), ax_, ay_, az_, 0.006, 0.004, (top - bot) / 2, 'od_metal', hexcol('#2a2a2a'))
        t += k * 1.0
    zz = bot
    while zz < top:
        mb.obox((mx, my, zz), ax_, ay_, az_, L / 2, 0.004, 0.006, 'od_metal', hexcol('#2a2a2a'))
        zz += 0.1
    # guy lines to the sand
    for s in (-1, 1):
        px, py = x + (-sn) * s * 4.9, y + cs * s * 4.9
        ex, ey = x + (-sn) * s * 6.6, y + cs * s * 6.6
        mb.cyl((px, py, z + 2.4), 0.008, 0.008, math.hypot(1.7, 2.4), 4, 'od_metal', hexcol('#cfcfcf'), axis=(ex - px, ey - py, -2.4))


def stop_sign(mb, x, y, z, facing):
    mb.cyl((x, y, z), 0.035, 0.035, 2.6, 8, 'od_metal', hexcol('#9a9a9a'))
    cx, cy, cz = x + math.cos(facing) * 0.05, y + math.sin(facing) * 0.05, z + 2.3
    ux, uy = -math.sin(facing), math.cos(facing)
    r = 0.38
    pts = [(cx + ux * r * math.cos(math.pi / 8 + k * math.pi / 4), cy + uy * r * math.cos(math.pi / 8 + k * math.pi / 4), cz + r * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    mb.face(pts, 'od_paint', hexcol('#b3121b'), n=(math.cos(facing), math.sin(facing), 0))
    mb.face(pts, 'od_metal', hexcol('#9a9a9a'), n=(-math.cos(facing), -math.sin(facing), 0))


def lounger(mb, x, y, z, rot, col='#f4f4f0'):
    """a beach chaise: white frame, a slatted bed with the back raised"""
    cs, sn = math.cos(rot), math.sin(rot)
    def T(px, py, pz):
        return (x + px * cs - py * sn, y + px * sn + py * cs, z + pz)
    ax, ay, az = (cs, sn, 0), (-sn, cs, 0), (0, 0, 1)
    c = hexcol(col)
    mb.obox(T(0, -0.25, 0.32), ax, ay, az, 0.33, 0.62, 0.03, 'od_fabric', c)
    # back, tilted 50 degrees
    a = math.radians(50)
    bc = T(0, 0.62, 0.32 + 0.38 * math.sin(a))
    by = (-sn * math.cos(a), cs * math.cos(a), math.sin(a))
    bz = (sn * math.sin(a), -cs * math.sin(a), math.cos(a))
    mb.obox(bc, ax, by, bz, 0.33, 0.4, 0.03, 'od_fabric', c)
    for px in (-0.3, 0.3):
        for py in (-0.8, 0.35):
            mb.obox(T(px, py, 0.15), ax, ay, az, 0.025, 0.025, 0.16, 'od_metal', hexcol('#e8e8e8'))
