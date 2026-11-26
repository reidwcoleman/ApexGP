"""Render Palmera's office and flat interiors into an atlas (public/palmera/rooms.webp).

Run: blender -b --python tools/palmera/rooms.py -- <out_dir>    then  tools/palmera/shops_atlas.py <out_dir> <out.webp> rooms

Same method as shops.py (whose kit this reuses), for the upper floors: two offices for the glass
towers (window cell 4.32 x 4.61 m, 6 m deep) and two flats for everything else (3.0 x 2.8 m, 4 m
deep - the shader stretches them a little for the other window sizes): an open-plan office in grey
and blue, a warmer one in timber, a living room and a kitchen-diner. Back wall, both side walls and
the floor of each, rendered in Cycles under its own lights (cool panels in the offices, warm lamps
at home).
"""
import os, sys, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shops as S
from shops import Kit
from mathutils import Vector
import bpy

OUT = sys.argv[sys.argv.index('--') + 1]
random.seed(11)


def size(w, h, d):
    S.W, S.H, S.D = w, h, d


def bookcase(k, x_wall, s, zc, length, height, col, rows):
    """a hollow bookcase against a side wall: back panel, two ends, top, shelves - filled"""
    W = S.W
    k.box('wood', (x_wall + s * 0.015, height / 2, zc), (0.03, height, length), col)
    for dz in (-length / 2, length / 2):
        k.box('wood', (x_wall + s * 0.18, height / 2, zc + dz), (0.36, height, 0.03), col)
    k.box('wood', (x_wall + s * 0.18, height, zc), (0.36, 0.03, length), col)
    for y in rows:
        k.box('wood', (x_wall + s * 0.18, y - 0.015, zc), (0.36, 0.03, length), col)
        S.fill_shelf(k, zc - length / 2 + 0.04, zc + length / 2 - 0.04, y, s * 2, x_wall + s * 0.03, deep=0.28, h_max=0.3)


def desk_row(k, x_wall, s, z0, z1, top, legs, chair):
    """desks against a side wall, a monitor on each, a chair pulled in"""
    W = S.W
    z = z0
    while z + 1.4 <= z1:
        k.box('wood', (x_wall + s * 0.4, 0.74, z + 0.7), (0.8, 0.04, 1.36), top)
        for dz in (0.08, 1.28):
            k.box('metal', (x_wall + s * 0.4, 0.37, z + dz), (0.7, 0.72, 0.04), legs)
        k.box('metal', (x_wall + s * 0.12, 1.02, z + 0.7), (0.03, 0.36, 0.6), (0.05, 0.05, 0.06))
        k.box('screen', (x_wall + s * 0.14, 1.02, z + 0.7), (0.005, 0.32, 0.56), (0.15, 0.25, 0.45), (0.55, 0.7, 0.9))
        k.box('metal', (x_wall + s * 0.2, 0.82, z + 0.7), (0.12, 0.16, 0.1), (0.15, 0.15, 0.16))
        k.box('prod', (x_wall + s * 0.5, 0.76, z + 0.45), (0.15, 0.01, 0.4), (0.12, 0.12, 0.13))
        k.box('cloth', (x_wall + s * 1.05, 0.48, z + 0.7), (0.5, 0.08, 0.5), chair)
        k.box('cloth', (x_wall + s * 1.32, 0.85, z + 0.7), (0.08, 0.62, 0.48), chair)
        k.cyl('metal', (x_wall + s * 1.1, 0.22, z + 0.7), 0.025, 0.4, (0.2, 0.2, 0.2))
        z += 1.6


def office_a(k):
    size(4.32, 4.608, 6.0)
    W, H, D = S.W, S.H, S.D
    S.room_shell(k, (0.8, 0.81, 0.82), lambda k: S.tiles(k, (0.36, 0.4, 0.46), (0.34, 0.38, 0.44), 0.5))
    S.ceiling_lights(k, (2, 3), (0.95, 0.98, 1.0))
    for x_wall, s in ((0.0, 1), (W, -1)):
        desk_row(k, x_wall, s, 0.4, D - 0.6, (0.92, 0.92, 0.9), (0.6, 0.62, 0.65), (0.15, 0.17, 0.22))
        k.box('wood', (x_wall + s * 0.02, 1.8, D * 0.5), (0.02, 0.7, 1.2), (0.95, 0.95, 0.95))  # whiteboard
        for q in range(5):
            k.box('prod', (x_wall + s * 0.03, 1.95 - q * 0.1, D * 0.5 - 0.4 + random.uniform(0, 0.4)), (0.01, 0.015, random.uniform(0.2, 0.6)), random.choice([(0.1, 0.2, 0.6), (0.7, 0.1, 0.1), (0.1, 0.1, 0.1)]))
    # back wall: a glass meeting room front, a long low cabinet, plants
    k.box('glass', (W / 2, 1.35, D - 1.6), (W - 0.6, 2.7, 0.02), (0.9, 0.95, 1.0))
    k.box('metal', (W / 2, 2.72, D - 1.6), (W - 0.6, 0.06, 0.06), (0.25, 0.25, 0.27))
    k.box('wood', (W / 2, 0.74, D - 0.8), (2.2, 0.04, 1.0), (0.6, 0.45, 0.3))
    for i in range(4):
        k.box('cloth', (W / 2 - 0.9 + i * 0.6, 0.48, D - 0.15), (0.45, 0.08, 0.45), (0.2, 0.22, 0.28))
    k.box('wood', (W / 2, 1.7, D - 0.03), (1.6, 0.9, 0.02), (0.1, 0.1, 0.11))
    k.box('screen', (W / 2, 1.7, D - 0.05), (1.5, 0.82, 0.01), (0.1, 0.25, 0.4), (0.4, 0.6, 0.8))
    for x in (0.35, W - 0.35):
        S.Kit.cyl(k, 'stone', (x, 0.25, D - 0.35), 0.2, 0.5, (0.85, 0.85, 0.83))
        for q in range(8):
            k.sphere('leaf', (x + random.uniform(-0.15, 0.15), 0.6 + random.uniform(0, 0.8), D - 0.35 + random.uniform(-0.15, 0.15)), random.uniform(0.1, 0.18), (0.14, 0.34, 0.12))


def office_b(k):
    size(4.32, 4.608, 6.0)
    W, H, D = S.W, S.H, S.D
    S.room_shell(k, (0.88, 0.85, 0.8), lambda k: S.planks(k, (0.55, 0.4, 0.27), 0.2))
    S.ceiling_lights(k, (2, 3), (1.0, 0.92, 0.82))
    for x_wall, s in ((0.0, 1), (W, -1)):
        desk_row(k, x_wall, s, 0.4, D - 2.2, (0.55, 0.4, 0.26), (0.15, 0.15, 0.16), (0.55, 0.3, 0.2) if s > 0 else (0.3, 0.4, 0.35))
        # a tall bookcase near the back
        bookcase(k, x_wall, s, D - 1.25, 1.6, 2.2, (0.35, 0.25, 0.17), (0.3, 0.75, 1.2, 1.65))
    k.box('wood', (W / 2, 1.0, D - 0.04), (W - 0.4, 2.0, 0.04), (0.42, 0.3, 0.2))  # panelled back wall
    k.box('cloth', (W / 2, 1.75, D - 0.08), (1.4, 0.9, 0.02), (0.75, 0.55, 0.35))  # a big print
    k.box('cloth', (W / 2 - 0.25, 1.85, D - 0.09), (0.6, 0.5, 0.01), (0.25, 0.35, 0.5))
    k.box('cloth', (W / 2, 0.42, D - 0.55), (1.8, 0.4, 0.8), (0.3, 0.35, 0.45))  # sofa
    k.box('cloth', (W / 2, 0.75, D - 0.2), (1.8, 0.5, 0.2), (0.3, 0.35, 0.45))


def living(k):
    size(3.0, 2.8, 4.0)
    W, H, D = S.W, S.H, S.D
    wall = random.choice([(0.9, 0.86, 0.78), (0.78, 0.84, 0.82)])
    S.room_shell(k, wall, lambda k: S.planks(k, (0.6, 0.43, 0.28), 0.14))
    k.box('cloth', (W / 2, 0.0, D * 0.55), (1.8, 0.01, 2.0), (0.62, 0.5, 0.42))  # rug
    k.sphere('emit', (0.4, 1.55, D - 0.4), 0.13, (1.0, 0.72, 0.42))  # floor lamp
    k.box('metal', (0.4, 0.75, D - 0.4), (0.02, 1.5, 0.02), (0.1, 0.1, 0.1))
    k.box('emit', (W / 2, H - 0.05, D / 2), (0.35, 0.04, 0.35), (1.0, 0.8, 0.55))
    # back wall: a sofa with cushions, art over it
    k.box('cloth', (W / 2 + 0.2, 0.22, D - 0.45), (1.9, 0.44, 0.85), (0.35, 0.38, 0.45))
    k.box('cloth', (W / 2 + 0.2, 0.62, D - 0.12), (1.9, 0.55, 0.22), (0.35, 0.38, 0.45))
    for i, c in enumerate([(0.85, 0.65, 0.3), (0.75, 0.75, 0.7), (0.6, 0.25, 0.2)]):
        k.box('cloth', (W / 2 - 0.4 + i * 0.6, 0.6, D - 0.3), (0.35, 0.35, 0.12), c)
    k.box('wood', (W / 2 + 0.2, 1.55, D - 0.02), (1.0, 0.7, 0.02), (0.08, 0.08, 0.08))
    k.box('cloth', (W / 2 + 0.2, 1.55, D - 0.04), (0.92, 0.62, 0.01), random.choice([(0.3, 0.45, 0.6), (0.8, 0.5, 0.3), (0.4, 0.55, 0.35)]))
    # one side: TV on a low unit; the other: a bookshelf and a plant
    k.box('wood', (0.25, 0.25, D * 0.45), (0.45, 0.5, 1.6), (0.3, 0.22, 0.16))
    k.box('metal', (0.06, 1.05, D * 0.45), (0.04, 0.62, 1.1), (0.03, 0.03, 0.035))
    k.box('screen', (0.085, 1.05, D * 0.45), (0.005, 0.56, 1.04), (0.15, 0.2, 0.35), (0.45, 0.55, 0.75))
    bookcase(k, W, -1, D * 0.4, 1.1, 2.0, (0.85, 0.83, 0.8), (0.15, 0.55, 0.95, 1.35, 1.75))
    k.cyl('stone', (W - 0.3, 0.2, D * 0.4 + 0.95), 0.18, 0.4, (0.8, 0.5, 0.35))
    for q in range(7):
        k.sphere('leaf', (W - 0.3 + random.uniform(-0.15, 0.15), 0.5 + random.uniform(0, 0.6), D * 0.4 + 0.95 + random.uniform(-0.15, 0.15)), random.uniform(0.1, 0.16), (0.16, 0.36, 0.14))


def kitchen(k):
    size(3.0, 2.8, 4.0)
    W, H, D = S.W, S.H, S.D
    S.room_shell(k, (0.92, 0.9, 0.86), lambda k: S.tiles(k, (0.8, 0.78, 0.74), (0.7, 0.68, 0.64), 0.4))
    k.box('emit', (W / 2, H - 0.05, D * 0.4), (0.8, 0.04, 0.2), (1.0, 0.85, 0.65))
    k.box('emit', (W / 2, H - 0.05, D * 0.8), (0.8, 0.04, 0.2), (1.0, 0.85, 0.65))
    front = random.choice([(0.25, 0.35, 0.3), (0.85, 0.85, 0.82), (0.3, 0.32, 0.4)])
    # back wall: base units, worktop, splashback, wall units, a fridge, a window-light strip
    k.box('wood', (W / 2 - 0.3, 0.45, D - 0.3), (W - 0.9, 0.9, 0.6), front)
    k.box('stone', (W / 2 - 0.3, 0.92, D - 0.3), (W - 0.85, 0.04, 0.64), (0.9, 0.89, 0.86))
    k.box('stone', (W / 2 - 0.3, 1.2, D - 0.02), (W - 0.9, 0.55, 0.02), (0.75, 0.82, 0.85))
    k.box('wood', (W / 2 - 0.3, 1.85, D - 0.18), (W - 0.9, 0.7, 0.35), front)
    k.box('emit', (W / 2 - 0.3, 1.48, D - 0.3), (W - 1.0, 0.02, 0.05), (1.0, 0.9, 0.75))
    k.box('steel', (W - 0.4, 0.95, D - 0.35), (0.7, 1.9, 0.68), (0.75, 0.76, 0.78))
    for i in range(6):
        k.cyl('prod', (0.6 + i * 0.25, 1.0, D - 0.25), random.uniform(0.04, 0.07), random.uniform(0.1, 0.25), random.choice(S.PACK))
    k.box('steel', (1.3, 0.95, D - 0.35), (0.5, 0.04, 0.4), (0.6, 0.6, 0.62))
    # dining table and chairs by one wall, shelves on the other
    k.box('wood', (0.55, 0.75, D * 0.4), (0.9, 0.04, 1.4), (0.55, 0.38, 0.24))
    for dz in (-0.45, 0.45):
        k.box('wood', (1.15, 0.45, D * 0.4 + dz), (0.4, 0.04, 0.4), (0.3, 0.2, 0.13))
        k.box('wood', (1.33, 0.7, D * 0.4 + dz), (0.04, 0.5, 0.4), (0.3, 0.2, 0.13))
    k.sphere('emit', (0.55, 1.6, D * 0.4), 0.12, (1.0, 0.75, 0.45))
    for y in (1.1, 1.5):
        k.box('wood', (W - 0.13, y, D * 0.45), (0.26, 0.03, 1.2), (0.55, 0.38, 0.24))
        S.fill_shelf(k, D * 0.45 - 0.55, D * 0.45 + 0.55, y + 0.02, -2, W - 0.02, deep=0.2, h_max=0.25)


R = S.R
for name, fn, exposure in (('officeA', office_a, -0.6), ('officeB', office_b, -0.4), ('living', living, 0.6), ('kitchen', kitchen, 0.3)):
    sc = S.reset()
    sc.cycles.samples = 64
    m = S.mats()
    k = Kit()
    fn(k)
    k.build(m)
    W, H, D = S.W, S.H, S.D
    sc.view_settings.exposure = exposure
    slab = 1.3 if D > 5 else 1.0   # back wall
    side = 1.8                     # side walls: all the furniture against them
    shots = {
        'back': ((W / 2, D - slab, H / 2), (R(90), 0, 0), max(W, H), slab + 0.05, (512, round(512 * H / W)) if W >= H else (round(512 * W / H), 512)),
        'xlo': ((side, D / 2, H / 2), (R(90), 0, R(90)), max(D, H), side + 0.05, (512, round(512 * H / D))),
        'xhi': ((W - side, D / 2, H / 2), (R(90), 0, R(-90)), max(D, H), side + 0.05, (512, round(512 * H / D))),
        # just the floor (and rugs): the furniture's shadows on it, not its sliced-off feet
        'floor': ((W / 2, D / 2, 0.03), (0, 0, 0), max(W, D), 0.045, (round(512 * W / D), 512)),
    }
    for face, (loc, rot, ortho, clip, res) in shots.items():
        c = S.cam(face, loc, rot, ortho, clip, res)
        bpy.context.view_layer.update()
        mw = c.matrix_world.to_3x3()
        right, up = mw @ Vector((1, 0, 0)), mw @ Vector((0, 1, 0))
        sc.render.filepath = f'{OUT}/{name}_{face}.png'
        bpy.ops.render.render(write_still=True)
        with open(f'{OUT}/{name}_{face}.axes', 'w') as fh:
            fh.write(f'{right.x:.0f} {right.y:.0f} {right.z:.0f} {up.x:.0f} {up.y:.0f} {up.z:.0f}\n')
        print('rendered', name, face)
