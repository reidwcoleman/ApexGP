"""Render Palmera's shop interiors into an atlas (public/palmera/shops.webp).

Run: blender -b --python tools/palmera/shops.py -- <out_dir>      (then the atlas is assembled by PIL)

The street-floor shop windows show a room 6.04 x 4.65 x 8 m deep (interior mapping in world/city.ts).
Four rooms are modelled here at exactly that size - a grocery, a boutique, a cafe and an electronics
shop - and lit with warm ceiling panels. Cycles renders each one's back wall, its two side walls and
its floor orthographically, the camera clipped to a slab in front of each surface so the shelving,
goods, counters and screens against it come out with real light, shadow and bounce. The shader puts
those images on the room's surfaces; the ceiling, shoppers and mannequin stay procedural.
Room space: x across the window (Blender X), y up (Blender Z), z into the building (Blender Y).
"""
import sys, math, random
import bpy, bmesh
from mathutils import Vector, Euler

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else ''
W, H, D = 6.035, 4.646, 8.0
random.seed(7)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:
        print('GPU unavailable, CPU', e)
    sc.cycles.samples = 96
    sc.cycles.transmission_bounces = 8
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.film_transparent = False
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.02, 0.02, 0.02, 1)
    sc.world = w
    return sc


class Kit:
    """merged geometry per material, coloured by a vertex attribute"""

    def __init__(self):
        self.parts = {}

    def bm(self, mat):
        if mat not in self.parts:
            b = bmesh.new()
            self.parts[mat] = (b, b.loops.layers.float_color.new('Col'))
        return self.parts[mat]

    def box(self, mat, c, s, col, col2=None, rot=0.0):
        """c = centre (room x, y, z), s = size; col2 = colour at the top (a gradient)"""
        b, L = self.bm(mat)
        r = bmesh.ops.create_cube(b, size=1.0)
        vs = r['verts']
        m = Euler((0, 0, rot)).to_matrix().to_4x4()
        for v in vs:
            p = Vector((v.co.x * s[0], v.co.z * s[2], v.co.y * s[1]))  # (x, z->Blender Y, y->Blender Z)
            p = Vector((v.co.x * s[0], v.co.z * s[2] * 0 + v.co.y * s[2], v.co.z * s[1]))
            p = m @ p
            v.co = Vector((c[0], c[2], c[1])) + p
        for f in {f for v in vs for f in v.link_faces}:
            for l in f.loops:
                top = l.vert.co.z > c[1]
                cc = col2 if (col2 and top) else col
                l[L] = (*cc, 1.0)

    def cyl(self, mat, c, r, h, col, seg=12, axis='y'):
        b, L = self.bm(mat)
        res = bmesh.ops.create_cone(b, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=h)
        for v in res['verts']:
            x, y, z = v.co.x, v.co.y, v.co.z
            if axis == 'y':
                v.co = Vector((c[0] + x, c[2] + y, c[1] + z))
            else:  # lying along x
                v.co = Vector((c[0] + z, c[2] + y, c[1] + x))
            for f in v.link_faces:
                for l in f.loops:
                    l[L] = (*col, 1.0)

    def sphere(self, mat, c, r, col):
        b, L = self.bm(mat)
        res = bmesh.ops.create_uvsphere(b, u_segments=12, v_segments=8, radius=r)
        for v in res['verts']:
            v.co = Vector((c[0] + v.co.x, c[2] + v.co.y, c[1] + v.co.z))
            for f in v.link_faces:
                for l in f.loops:
                    l[L] = (*col, 1.0)

    def build(self, mats):
        for name, (b, L) in self.parts.items():
            me = bpy.data.meshes.new(name)
            b.to_mesh(me)
            b.free()
            ob = bpy.data.objects.new(name, me)
            bpy.context.scene.collection.objects.link(ob)
            ob.data.materials.append(mats[name])


def material(name, rough=0.6, emit=0.0, metal=0.0, gloss_coat=0.0, glass=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    if glass:
        # clear glass: see the bottles and the pastries through it, a faint reflection on top
        p.inputs['Transmission Weight'].default_value = 1.0
        p.inputs['Roughness'].default_value = 0.02
        p.inputs['IOR'].default_value = 1.45
        p.inputs['Base Color'].default_value = (0.95, 0.98, 1.0, 1.0)
        return m
    a = nt.nodes.new('ShaderNodeVertexColor')
    a.layer_name = 'Col'
    nt.links.new(a.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if gloss_coat:
        p.inputs['Coat Weight'].default_value = gloss_coat
    if emit:
        nt.links.new(a.outputs['Color'], p.inputs['Emission Color'])
        p.inputs['Emission Strength'].default_value = emit
    return m


def room_shell(k, wall, floor_fn, wain=None):
    # walls / floor as boxes so they catch light; the ceiling a dark-ish plaster
    k.box('wall', (W / 2, H / 2, D + 0.05), (W + 0.2, H + 0.2, 0.1), wall)
    k.box('wall', (-0.05, H / 2, D / 2), (0.1, H + 0.2, D + 0.2), wall)
    k.box('wall', (W + 0.05, H / 2, D / 2), (0.1, H + 0.2, D + 0.2), wall)
    k.box('wall', (W / 2, H + 0.05, D / 2), (W + 0.2, 0.1, D + 0.2), (0.85, 0.85, 0.83))
    floor_fn(k)
    if wain:
        for x in (0.02, W - 0.02):
            k.box('wood', (x, 0.5, D / 2), (0.04, 1.0, D), wain)
        k.box('wood', (W / 2, 0.5, D - 0.02), (W, 1.0, 0.04), wain)


def ceiling_lights(k, n=(2, 3), col=(1.0, 0.88, 0.72)):
    for i in range(n[0]):
        for j in range(n[1]):
            x = W * (i + 0.5) / n[0]
            z = D * (j + 0.5) / n[1]
            k.box('emit', (x, H - 0.03, z), (1.2, 0.04, 0.6), col)


def tiles(k, a, b, s=0.6):
    nx, nz = int(W / s) + 1, int(D / s) + 1
    for i in range(nx):
        for j in range(nz):
            c = a if (i + j) % 2 == 0 else b
            k.box('floor', ((i + 0.5) * s, -0.02, (j + 0.5) * s), (s - 0.01, 0.04, s - 0.01), c)


def planks(k, base, s=0.18):
    n = int(W / s) + 1
    for i in range(n):
        z0 = 0.0
        while z0 < D:
            L = random.uniform(1.2, 2.4)
            f = random.uniform(0.82, 1.12)
            k.box('floor', ((i + 0.5) * s, -0.02, z0 + L / 2), (s - 0.006, 0.04, L - 0.006), tuple(min(1, c * f) for c in base))
            z0 += L


PACK = [(0.75, 0.12, 0.1), (0.95, 0.75, 0.15), (0.15, 0.3, 0.65), (0.92, 0.92, 0.9), (0.2, 0.55, 0.25), (0.95, 0.5, 0.12),
        (0.55, 0.2, 0.45), (0.1, 0.1, 0.12), (0.85, 0.3, 0.45), (0.4, 0.65, 0.85)]


def fill_shelf(k, x0, x1, y, depth_axis, wall, deep=0.42, h_max=0.34):
    """products standing along a shelf: boxes, cans, bottles"""
    a = x0
    while a < x1 - 0.06:
        kind = random.random()
        col = random.choice(PACK)
        if kind < 0.55:
            w, h, d = random.uniform(0.08, 0.2), random.uniform(0.12, h_max), random.uniform(0.12, deep * 0.8)
            n = random.randint(2, 5)
            for q in range(n):  # a facing: a few of the same in a row
                if a + w > x1:
                    break
                p = (a + w / 2, y + h / 2, wall + (d / 2 + 0.02) * depth_axis)
                if abs(depth_axis) == 2:
                    k.box('prod', (wall + (d / 2 + 0.02) * (depth_axis / 2), y + h / 2, a + w / 2), (d, h, w), col, tuple(min(1, c * 1.15) for c in col))
                else:
                    k.box('prod', p, (w, h, d), col, tuple(min(1, c * 1.15) for c in col))
                a += w + 0.005
        else:
            r, h = random.uniform(0.03, 0.05), random.uniform(0.1, min(h_max, 0.3))
            n = random.randint(3, 7)
            for q in range(n):
                if a + 2 * r > x1:
                    break
                if abs(depth_axis) == 2:
                    k.cyl('prod', (wall + (r + 0.03) * (depth_axis / 2), y + h / 2, a + r), r, h, col)
                else:
                    k.cyl('prod', (a + r, y + h / 2, wall + (r + 0.03) * depth_axis), r, h, col)
                a += 2 * r + 0.004
        a += 0.02


def grocery(k):
    room_shell(k, (0.86, 0.85, 0.81), lambda k: tiles(k, (0.78, 0.78, 0.76), (0.6, 0.62, 0.62)))
    ceiling_lights(k, (2, 4), (0.95, 0.97, 1.0))
    # shelving along both side walls: grey uprights, five shelves, goods
    for side, x_wall, dirn in (('L', 0.0, 2), ('R', W, -2)):
        for z0 in [0.6 + 1.25 * i for i in range(5)]:
            for zz in (z0, z0 + 1.2):
                k.box('metal', (x_wall + 0.25 * (1 if dirn > 0 else -1), 1.05, zz), (0.5, 2.1, 0.04), (0.3, 0.31, 0.33))
            for y in (0.12, 0.52, 0.92, 1.32, 1.72):
                k.box('metal', (x_wall + 0.25 * (1 if dirn > 0 else -1), y - 0.02, z0 + 0.6), (0.5, 0.03, 1.2), (0.7, 0.71, 0.72))
                fill_shelf(k, z0 + 0.04, z0 + 1.16, y, dirn, x_wall)
            # a coloured category board above
            k.box('emit', (x_wall + 0.02 * (1 if dirn > 0 else -1), 2.45, z0 + 0.6), (0.03, 0.28, 1.0), random.choice(PACK[:6]))
    # the back wall: chilled cabinets - glass doors, lit inside, bottles and cartons
    for i in range(5):
        x0 = 0.3 + i * 1.09
        k.box('metal', (x0 + 0.54, 1.1, D - 0.4), (1.06, 2.2, 0.75), (0.2, 0.21, 0.22))
        k.box('emit', (x0 + 0.54, 2.12, D - 0.12), (1.0, 0.04, 0.3), (0.9, 0.95, 1.0))
        for y in (0.15, 0.55, 0.95, 1.35, 1.75):
            k.box('metal', (x0 + 0.54, y - 0.02, D - 0.4), (1.0, 0.02, 0.6), (0.85, 0.86, 0.88))
            fill_shelf(k, x0 + 0.04, x0 + 1.04, y, -1, D - 0.62, deep=0.3, h_max=0.3)
        k.box('glass', (x0 + 0.54, 1.1, D - 0.78), (1.04, 2.1, 0.02), (0.9, 0.95, 1.0))
        k.box('metal', (x0 + 0.02, 1.1, D - 0.78), (0.04, 2.2, 0.05), (0.75, 0.76, 0.78))
    # a fascia over the cabinets: a deep green band with a lit edge (no words)
    k.box('wood', (W / 2, 2.75, D - 0.1), (W - 0.4, 0.6, 0.2), (0.12, 0.35, 0.22))
    k.box('emit', (W / 2, 2.44, D - 0.2), (W - 0.5, 0.03, 0.04), (0.95, 0.97, 1.0))


def boutique(k):
    room_shell(k, (0.93, 0.92, 0.9), lambda k: planks(k, (0.62, 0.45, 0.3)))
    # track spots: little warm pools
    for i in range(3):
        for j in range(4):
            k.box('emit', (W * (i + 0.5) / 3, H - 0.05, D * (j + 0.5) / 4), (0.25, 0.04, 0.25), (1.0, 0.85, 0.65))
    fabric = [(0.12, 0.13, 0.16), (0.85, 0.82, 0.76), (0.55, 0.12, 0.14), (0.25, 0.32, 0.5), (0.72, 0.6, 0.45), (0.3, 0.42, 0.3),
              (0.95, 0.95, 0.94), (0.82, 0.55, 0.6), (0.45, 0.45, 0.48)]
    for x_wall, s in ((0.0, 1), (W, -1)):
        for z0, z1 in ((0.8, 3.6), (4.3, 7.4)):
            k.cyl('metal', (x_wall + s * 0.32, 1.65, (z0 + z1) / 2), 0.015, z1 - z0, (0.8, 0.8, 0.82), axis='x') if False else k.box('metal', (x_wall + s * 0.32, 1.65, (z0 + z1) / 2), (0.03, 0.03, z1 - z0), (0.8, 0.8, 0.82))
            for z0b, z1b in ((z0, z1),):
                z = z0b + 0.06
                while z < z1b - 0.04:
                    col = random.choice(fabric)
                    L = random.uniform(0.6, 1.05)
                    t = random.uniform(0.03, 0.06)
                    k.box('cloth', (x_wall + s * 0.32, 1.62 - L / 2, z), (0.46, L, t), col)
                    k.box('metal', (x_wall + s * 0.32, 1.66, z), (0.36, 0.02, 0.01), (0.7, 0.7, 0.72))
                    z += t + random.uniform(0.01, 0.04)
            # a framed print above the rail
            k.box('wood', (x_wall + s * 0.02, 2.6, (z0 + z1) / 2), (0.03, 0.9, 1.3), (0.1, 0.1, 0.1))
            k.box('cloth', (x_wall + s * 0.04, 2.6, (z0 + z1) / 2), (0.02, 0.8, 1.2), random.choice(fabric))
    # back wall: shelves of folded stacks, a long mirror, a low bench
    for i in range(3):
        x0 = 0.4 + i * 1.95
        if i == 1:
            k.box('mirror', (x0 + 0.85, 1.35, D - 0.03), (1.0, 2.2, 0.02), (0.9, 0.9, 0.92))
            continue
        for y in (0.4, 0.9, 1.4, 1.9):
            k.box('wood', (x0 + 0.85, y, D - 0.22), (1.6, 0.04, 0.42), (0.9, 0.88, 0.85))
            a = x0 + 0.12
            while a < x0 + 1.5:
                col = random.choice(fabric)
                n = random.randint(3, 6)
                for q in range(n):
                    k.box('cloth', (a + 0.16, y + 0.03 + q * 0.035, D - 0.24), (0.3, 0.03, 0.3), col)
                a += 0.38
    k.box('wood', (W / 2, 0.22, D - 1.3), (1.6, 0.44, 0.45), (0.25, 0.18, 0.12))


def cafe(k):
    wall = random.choice([(0.78, 0.52, 0.38), (0.6, 0.68, 0.56)])
    room_shell(k, wall, lambda k: planks(k, (0.38, 0.25, 0.16), 0.15), wain=(0.3, 0.2, 0.13))
    # pendants over the counter, warm
    for i in range(4):
        x = 0.9 + i * 1.45
        k.box('metal', (x, 3.6, D - 1.2), (0.01, 2.0, 0.01), (0.1, 0.1, 0.1))
        k.sphere('emit', (x, 2.55, D - 1.2), 0.14, (1.0, 0.75, 0.45))
    ceiling_lights(k, (1, 2), (1.0, 0.8, 0.6))
    # the counter along the back: wood front, pale top, pastry case, machine, grinder, cups
    k.box('wood', (W / 2, 0.52, D - 0.75), (W - 0.6, 1.04, 0.7), (0.28, 0.18, 0.11))
    k.box('stone', (W / 2, 1.06, D - 0.75), (W - 0.5, 0.05, 0.78), (0.85, 0.83, 0.8))
    k.box('glass', (1.6, 1.32, D - 0.85), (1.6, 0.5, 0.55), (0.9, 0.95, 1.0))
    for i in range(10):
        k.sphere('prod', (0.95 + (i % 5) * 0.32, 1.17 + (i // 5) * 0.22, D - 0.85), 0.07, random.choice([(0.8, 0.55, 0.25), (0.6, 0.35, 0.18), (0.9, 0.8, 0.6), (0.45, 0.25, 0.15)]))
    k.box('emit', (1.6, 1.56, D - 0.85), (1.5, 0.02, 0.4), (1.0, 0.85, 0.65))
    k.box('steel', (3.9, 1.33, D - 0.85), (0.8, 0.5, 0.5), (0.78, 0.78, 0.8))
    k.box('metal', (3.9, 1.62, D - 0.85), (0.8, 0.06, 0.5), (0.15, 0.15, 0.16))
    k.box('steel', (4.65, 1.3, D - 0.85), (0.2, 0.45, 0.25), (0.2, 0.2, 0.22))
    for i in range(8):
        k.cyl('prod', (3.62 + (i % 4) * 0.13, 1.64 + 0.06, D - 0.95 + (i // 4) * 0.12), 0.04, 0.08, (0.95, 0.95, 0.93))
    # shelf of jars and the menu boards
    k.box('wood', (W / 2, 1.95, D - 0.15), (W - 1.0, 0.04, 0.3), (0.3, 0.2, 0.13))
    a = 0.7
    while a < W - 0.7:
        k.cyl('glass', (a, 2.07, D - 0.15), random.uniform(0.05, 0.08), random.uniform(0.15, 0.25), (0.85, 0.9, 0.9))
        k.cyl('prod', (a, 2.04, D - 0.15), 0.045, 0.1, random.choice([(0.35, 0.2, 0.1), (0.75, 0.55, 0.3), (0.9, 0.85, 0.7)]))
        a += random.uniform(0.25, 0.4)
    for x in (1.6, 4.4):
        k.box('slate', (x, 2.9, D - 0.04), (2.2, 1.1, 0.04), (0.06, 0.07, 0.07))
        k.box('wood', (x, 2.9, D - 0.05), (2.3, 1.2, 0.03), (0.3, 0.2, 0.12))
        for r in range(7):
            L = random.uniform(0.6, 1.6)
            k.box('chalk', (x - 0.95 + L / 2, 3.32 - r * 0.13, D - 0.07), (L, 0.025, 0.01), (0.88, 0.88, 0.85))
            k.box('chalk', (x + 0.88, 3.32 - r * 0.13, D - 0.07), (0.16, 0.025, 0.01), (0.88, 0.88, 0.85))
    # the side walls: a bench, small tables and chairs, pictures, a plant
    for x_wall, s in ((0.0, 1), (W, -1)):
        k.box('wood', (x_wall + s * 0.25, 0.23, 3.4), (0.5, 0.46, 5.6), (0.3, 0.2, 0.13))
        k.box('cloth', (x_wall + s * 0.25, 0.5, 3.4), (0.48, 0.1, 5.5), (0.55, 0.22, 0.18) if s > 0 else (0.22, 0.3, 0.38))
        k.box('cloth', (x_wall + s * 0.06, 0.8, 3.4), (0.1, 0.5, 5.5), (0.55, 0.22, 0.18) if s > 0 else (0.22, 0.3, 0.38))
        for z in (1.2, 2.7, 4.2, 5.7):
            k.cyl('stone', (x_wall + s * 0.95, 0.74, z), 0.32, 0.03, (0.88, 0.86, 0.82))
            k.cyl('metal', (x_wall + s * 0.95, 0.37, z), 0.03, 0.72, (0.12, 0.12, 0.12))
            k.cyl('prod', (x_wall + s * 0.9, 0.8, z + 0.1), 0.04, 0.09, (0.95, 0.95, 0.93))
            k.box('wood', (x_wall + s * 1.55, 0.45, z), (0.42, 0.04, 0.42), (0.3, 0.2, 0.13))
            k.box('wood', (x_wall + s * 1.74, 0.75, z), (0.04, 0.6, 0.42), (0.3, 0.2, 0.13))
            k.box('wood', (x_wall + s * 0.03, 1.7, z), (0.03, 0.5, 0.65), (0.15, 0.1, 0.07))
            k.box('cloth', (x_wall + s * 0.05, 1.7, z), (0.02, 0.42, 0.57), random.choice([(0.7, 0.6, 0.4), (0.3, 0.45, 0.55), (0.6, 0.3, 0.25), (0.85, 0.8, 0.7)]))
        k.cyl('stone', (x_wall + s * 0.4, 0.25, 6.9), 0.22, 0.5, (0.75, 0.42, 0.3))
        for q in range(9):
            k.sphere('leaf', (x_wall + s * (0.4 + random.uniform(-0.2, 0.2)), 0.65 + random.uniform(0, 0.7), 6.9 + random.uniform(-0.2, 0.2)), random.uniform(0.12, 0.2), (0.15, 0.35, 0.12))


def electronics(k):
    room_shell(k, (0.11, 0.115, 0.12), lambda k: tiles(k, (0.62, 0.63, 0.65), (0.6, 0.61, 0.63), 1.0))
    ceiling_lights(k, (2, 3), (0.95, 0.98, 1.0))
    screens = [((0.05, 0.2, 0.55), (0.4, 0.75, 1.0)), ((0.9, 0.4, 0.1), (0.95, 0.8, 0.3)), ((0.1, 0.45, 0.2), (0.5, 0.85, 0.6)),
               ((0.5, 0.1, 0.5), (0.95, 0.4, 0.6)), ((0.1, 0.1, 0.15), (0.6, 0.65, 0.75)), ((0.0, 0.35, 0.45), (0.9, 0.95, 1.0))]
    for x_wall, s in ((0.0, 1), (W, -1)):
        z = 0.8
        while z < 7.4:
            w = random.choice([0.9, 1.1, 1.3, 1.6])
            hh = w * 0.5625
            y = random.choice([1.5, 1.7, 1.9])
            a, b = random.choice(screens)
            k.box('metal', (x_wall + s * 0.06, y, z + w / 2), (0.05, hh + 0.04, w + 0.04), (0.03, 0.03, 0.035))
            k.box('screen', (x_wall + s * 0.09, y, z + w / 2), (0.01, hh, w), a, b)
            z += w + 0.25
        # a low shelf of boxed goods under them
        k.box('metal', (x_wall + s * 0.3, 0.45, 3.9), (0.6, 0.9, 6.8), (0.16, 0.165, 0.18))
        fill_shelf(k, 0.6, 7.2, 0.9, s * 2, x_wall + s * 0.02)
        k.box('emit', (x_wall + s * 0.02, 3.0, 3.9), (0.02, 0.05, 7.0), (0.5, 0.8, 1.0))
    # back wall: a big lit panel and a display table of laptops and phones
    k.box('screen', (W / 2, 2.7, D - 0.04), (3.4, 1.4, 0.02), (0.15, 0.3, 0.6), (0.55, 0.75, 1.0))
    k.box('stone', (W / 2, 0.45, D - 0.9), (4.4, 0.9, 1.0), (0.93, 0.93, 0.94))
    for i in range(5):
        x = W / 2 - 1.7 + i * 0.85
        k.box('metal', (x, 0.92, D - 0.85), (0.34, 0.02, 0.24), (0.7, 0.71, 0.73))
        k.box('screen', (x, 1.04, D - 0.98), (0.34, 0.22, 0.01), random.choice(screens)[1], random.choice(screens)[0])
    for i in range(6):
        k.box('screen', (W / 2 - 1.9 + i * 0.75, 0.92, D - 0.5), (0.08, 0.005, 0.16), (0.2, 0.3, 0.5), (0.6, 0.8, 1.0))


MATS = None


def mats():
    return {
        'wall': material('wall', 0.85), 'floor': material('floor', 0.35), 'wood': material('wood', 0.55), 'metal': material('metal', 0.35, metal=0.6),
        'prod': material('prod', 0.45), 'emit': material('emit', 0.3, emit=6.0), 'glass': material('glass', glass=True), 'cloth': material('cloth', 0.9),
        'mirror': material('mirror', 0.02, metal=1.0), 'stone': material('stone', 0.3), 'steel': material('steel', 0.25, metal=0.9),
        'slate': material('slate', 0.8), 'chalk': material('chalk', 0.9), 'leaf': material('leaf', 0.7), 'screen': material('screen', 0.1, emit=0.8),
    }


def cam(name, loc, rot, ortho, clip, res):
    sc = bpy.context.scene
    c = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    sc.collection.objects.link(c)
    c.location = loc
    c.rotation_euler = rot
    c.data.type = 'ORTHO'
    c.data.ortho_scale = ortho
    c.data.clip_start = 0.005
    c.data.clip_end = clip
    sc.camera = c
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    return c


R = math.radians


def main():
    for ki, (name, fn) in enumerate((('grocery', grocery), ('boutique', boutique), ('cafe', cafe), ('electronics', electronics))):
        sc = reset()
        m = mats()
        k = Kit()
        fn(k)
        k.build(m)
        sc.view_settings.exposure = {'grocery': -0.6, 'boutique': 1.1, 'cafe': 0.4, 'electronics': 0.0}[name]
        # Blender: X = room x, Y = room depth z, Z = room height y
        shots = {
            'back': ((W / 2, D - 2.6, H / 2), (R(90), 0, 0), W, 2.65, (640, round(640 * H / W))),
            'xlo': ((1.7, D / 2, H / 2), (R(90), 0, R(90)), D, 1.75, (640, round(640 * H / D))),
            'xhi': ((W - 1.7, D / 2, H / 2), (R(90), 0, R(-90)), D, 1.75, (640, round(640 * H / D))),
            'floor': ((W / 2, D / 2, 0.3), (0, 0, 0), D, 0.33, (round(640 * W / D), 640)),
        }
        for face, (loc, rot, ortho, clip, res) in shots.items():
            c = cam(face, loc, rot, ortho, clip, res)
            bpy.context.view_layer.update()
            mw = c.matrix_world.to_3x3()
            right, up = mw @ Vector((1, 0, 0)), mw @ Vector((0, 1, 0))
            sc.render.filepath = f'{OUT}/{name}_{face}.png'
            bpy.ops.render.render(write_still=True)
            # how the image's axes map to room axes (for the atlas step): right/up as world vectors
            with open(f'{OUT}/{name}_{face}.axes', 'w') as fh:
                fh.write(f'{right.x:.0f} {right.y:.0f} {right.z:.0f} {up.x:.0f} {up.y:.0f} {up.z:.0f}\n')
            print('rendered', name, face, 'right', tuple(round(v) for v in right), 'up', tuple(round(v) for v in up))


if __name__ == '__main__':
    main()
