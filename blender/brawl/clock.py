# TICK TOCK: inside a clock tower. A copper hub in the middle, painted gears turning around it at
# different heights (mov_gear_*), a pendulum sweeping through (mov_pendulum), the clock face lit
# from behind, the drop into the works below.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset()
random.seed(7)

BRASS = mat('brass', (0.92, 0.66, 0.28), 0.32, metal=1.0)
COPPER = mat('copper', (0.86, 0.45, 0.28), 0.35, metal=1.0)
IRON = mat('iron', (0.2, 0.21, 0.24), 0.5, metal=0.6)
TEAL = mat('paint_teal', (0.1, 0.55, 0.58), 0.45, clearcoat=0.4)
RED = mat('paint_red', (0.8, 0.18, 0.16), 0.45, clearcoat=0.4)
YEL = mat('paint_yellow', (0.98, 0.72, 0.15), 0.45, clearcoat=0.4)
NAVY = mat('paint_navy', (0.12, 0.2, 0.45), 0.45, clearcoat=0.4)
FACE = mat('face', (0.9, 0.84, 0.72), 0.6, emit=(1.0, 0.85, 0.6), emit_k=0.2)
INK = mat('ink', (0.08, 0.06, 0.06), 0.5)
BRICK = mat('brick', (0.55, 0.28, 0.2), 0.9)
STONE = mat('stone', (0.62, 0.56, 0.5), 0.85)
WOOD = mat('wood', (0.5, 0.3, 0.16), 0.6)
GLASS = mat('window', (1.0, 0.8, 0.5), 0.2, emit=(1.0, 0.72, 0.4), emit_k=3.0)
LAMP = mat('lamp', (1.0, 0.85, 0.55), 0.3, emit=(1.0, 0.75, 0.4), emit_k=2.2)
PIT = mat('pit', (0.08, 0.06, 0.05), 0.9)
vis = []


def V(o):
    vis.append(o)
    return o


# ---- the hub
V(cyl('hub', (0, -0.3, 0), 2.4, 0.6, COPPER, seg=64, bevel=0.05))
cyl('col_hull_hub', (0, -0.3, 0), 2.4, 0.6, None, seg=32)
V(cyl('hub_inlay', (0, 0.005, 0), 1.6, 0.02, BRASS, seg=64))
V(flat_shape('hub_star', star_pts(1.2, 0.45, 8), (0, 0.02, 0), NAVY, depth=0.01))
for i in range(12):
    a = i / 12 * math.tau
    V(cyl('rivet', (math.cos(a) * 2.15, 0.02, math.sin(a) * 2.15), 0.07, 0.06, BRASS, seg=10))
V(cyl('axle', (0, -23, 0), 0.9, 45, IRON, seg=32))
for y in (-3, -8, -13):
    V(cyl('collar', (0, y, 0), 1.25, 0.6, BRASS, seg=40, bevel=0.06))

# ---- the gears
gears = [
    ('gear_a', (-6.4, 0.0, 0.6), 3.4, 0.55, 20, TEAL, 5),
    ('gear_b', (5.8, -0.5, 2.0), 3.0, 0.55, 18, RED, 6),
    ('gear_c', (0.4, 0.35, -6.2), 3.2, 0.55, 19, YEL, 0),
    ('gear_d', (-4.2, 1.15, -4.3), 1.6, 0.4, 11, NAVY, 0),
]
nodes = []
for name, c, r, h, n, m, sp in gears:
    node, parts = gear(name, (c[0], c[1] - h / 2, c[2]), r, h, n, m, spokes=sp, hub_mat=BRASS)
    vis.extend(parts)
    nodes.append(node)
    # each gear on its own axle
    V(cyl(name + '_axle', (c[0], c[1] - h - 10, c[2]), 0.4, 20, IRON, seg=20))

# ---- the pendulum: pivot high above, a rod, a big brass bob that sweeps through at chest height
piv = empty('mov_pendulum', (0, 17.0, -1.5))
V(box('rod', (0, -8.0, 0), (0.22, 15.6, 0.22), BRASS, parent=piv))
V(box('rod2', (0, -8.0, 0.25), (0.08, 15.6, 0.08), IRON, parent=piv))
bob = cyl('bob', (0, -15.6, 0), 1.35, 0.55, BRASS, seg=48, rot=(math.pi / 2, 0, 0), parent=piv, bevel=0.12)
V(bob)
V(cyl('bob_face', (0, -15.6, 0.3), 0.95, 0.06, COPPER, seg=48, rot=(math.pi / 2, 0, 0), parent=piv))
V(cyl('bob_face2', (0, -15.6, -0.3), 0.95, 0.06, COPPER, seg=48, rot=(math.pi / 2, 0, 0), parent=piv))
cyl('col_hull_bob', (0, -15.6, 0), 1.35, 0.6, None, seg=24, rot=(math.pi / 2, 0, 0), parent=piv)
V(box('beam', (0, 17.4, -1.5), (6, 0.8, 0.8), IRON))

# ---- the clock face behind, lit from the inside, hands turning
FC = (0, 7.5, -17.0)
V(cyl('face', FC, 12.0, 0.4, FACE, seg=96, rot=(math.pi / 2, 0, 0)))
V(torus('face_rim', FC, 12.2, 0.55, BRASS, seg=96, rot=(math.pi / 2, 0, 0)))
NUM = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI']
for i, s in enumerate(NUM):
    a = i / 12 * math.tau
    x, y = math.sin(a) * 9.6, math.cos(a) * 9.6
    V(text('num', s, (FC[0] + x, FC[1] + y, FC[2] + 0.25), 1.6, INK, depth=0.08, rot=(math.pi / 2, 0, 0), font='/System/Library/Fonts/Supplemental/Arial Black.ttf'))
for i in range(60):
    a = i / 60 * math.tau
    L = 0.9 if i % 5 == 0 else 0.4
    V(box('tick', (FC[0] + math.sin(a) * 11.2, FC[1] + math.cos(a) * 11.2, FC[2] + 0.22), (0.12, L, 0.05), INK, rot=(0, 0, -a)))
for name, L, w in (('hand_hour', 6.0, 0.6), ('hand_min', 9.0, 0.38)):
    hn = empty(name, (FC[0], FC[1], FC[2] + 0.35))
    V(box(name + '_bar', (0, L / 2 - 0.8, 0), (w, L, 0.12), INK, bevel=0.03, parent=hn))
    V(flat_shape(name + '_tip', [(-w * 1.2, 0), (w * 1.2, 0), (0, -1.3)], (0, L - 0.8, 0.0), INK, depth=0.12, parent=hn, rot=(math.pi / 2, 0, 0)))
V(cyl('hand_cap', (FC[0], FC[1], FC[2] + 0.5), 0.7, 0.3, BRASS, seg=32, rot=(math.pi / 2, 0, 0)))

# ---- the tower: brick walls round about, round windows glowing, catwalks, lamps
for i in range(28):
    a = i / 28 * math.tau
    if abs(math.atan2(math.sin(a), math.cos(a)) + math.pi / 2) < 0.5:
        continue
    x, z = math.cos(a) * 24, math.sin(a) * 24
    V(box('wall', (x, 2, z), (5.6, 60, 1.5), BRICK, rot=(0, -a + math.pi / 2, 0)))
for i in range(5):
    a = -math.pi / 2 + (i - 2) * 0.55
    if i == 2:
        continue
    x, z = math.cos(a) * 23.0, math.sin(a) * 23.0
    V(cyl('window', (x, 10, z), 2.4, 0.3, GLASS, seg=40, rot=(math.pi / 2, 0, -a - math.pi / 2)))
    V(torus('window_rim', (x, 10, z), 2.5, 0.25, STONE, rot=(math.pi / 2, 0, -a - math.pi / 2)))
for i in range(6):
    a = i / 6 * math.tau + 0.3
    x, z = math.cos(a) * 15, math.sin(a) * 15
    V(cyl('lamp', (x, 13, z), 0.3, 0.6, LAMP, seg=16))
    V(cyl('lamp_chain', (x, 17, z), 0.04, 7, IRON, seg=6))
# a catwalk ring round the walls (out of reach) and cross-beams
V(annulus('catwalk', 19, 21, 0.3, WOOD, seg=64, c=(0, 4, 0)))
for i in range(4):
    a = i / 4 * math.tau + 0.4
    V(box('girder', (math.cos(a) * 18, 14, math.sin(a) * 18), (0.6, 0.6, 14), IRON, rot=(0, -a, 0)))
# the works below: big gears turning slowly in the dark
for i in range(7):
    a = random.uniform(0, math.tau)
    rr = random.uniform(5, 15)
    y = random.uniform(-26, -12)
    node, parts = gear('deco_%d' % i, (math.cos(a) * rr, y, math.sin(a) * rr), random.uniform(3, 6), 0.6, random.randint(14, 26), random.choice([BRASS, COPPER, IRON, TEAL]), spokes=random.choice([0, 5, 6]), hub_mat=BRASS)
    node.name = 'deco_gear_%d' % i
    for o in node.children:
        if o.name.startswith('col_'):
            bpy.data.objects.remove(o)
    vis.extend(parts)
V(cyl('pit_floor', (0, -46, 0), 30, 1, PIT, seg=48))

# ---- spawns
# (the spoked gears have holes: spawn on their rims)
for i, (x, z) in enumerate(((1.0, 0.8), (-1.0, -0.8), (-6.4, 0.6 + 3.0), (-6.4 - 3.0, 0.6), (5.8, 2.0 + 2.6), (5.8 + 2.6, 2.0), (0.4 + 1.6, -6.2), (0.4 - 1.6, -6.2))):
    y = 0.95
    if x < -3:
        y = 0.95
    if x > 3:
        y = 0.45
    if z < -4:
        y = 1.3
    e = empty('spawn_%d' % i, (x, y, z))
    e.rotation_euler = (0, 0, math.atan2(x, -z) + math.pi)

bpy.context.view_layer.update()
big = [o for o in vis if o.name.startswith(('hub', 'gear_a_rim', 'gear_b_rim', 'gear_c_disc', 'gear_d_disc', 'bob'))]
bake_ao(big, distance=0.8, samples=16, dense=0.8)
export([o for o in bpy.data.objects], 'clock')
