# SUSHI SPIN: a giant conveyor-sushi counter. A belt loops round the chef's island (its surface
# moves: the game gives it a belt velocity), plates ride it (mov_plate_*), maki rolls sit on some
# (dyn_), a chef's knife chops down on the belt now and then (mov_knife), and off the counter's
# edge it's a long way down to the restaurant floor.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset()
random.seed(11)

BELT = mat('belt', (0.16, 0.17, 0.2), 0.55)
SLAT = mat('slat', (0.3, 0.32, 0.36), 0.4, metal=0.5)
STEEL = mat('steel', (0.8, 0.82, 0.86), 0.2, metal=1.0)
WOOD = mat('wood_light', (0.86, 0.66, 0.42), 0.55, clearcoat=0.3)
WOOD2 = mat('wood_dark', (0.42, 0.24, 0.12), 0.6)
RICE = mat('rice', (0.97, 0.96, 0.92), 0.85, sheen=0.5)
SALMON = mat('salmon', (1.0, 0.48, 0.28), 0.35, clearcoat=0.5)
TUNA = mat('tuna', (0.82, 0.12, 0.18), 0.35, clearcoat=0.5)
EGG = mat('egg', (1.0, 0.82, 0.25), 0.5)
NORI = mat('nori', (0.06, 0.14, 0.08), 0.7)
CUKE = mat('cucumber', (0.35, 0.75, 0.25), 0.5)
IKURA = mat('ikura', (1.0, 0.35, 0.05), 0.1, clearcoat=1.0)
WASABI = mat('wasabi', (0.55, 0.78, 0.25), 0.8)
SOY = mat('soy', (0.15, 0.06, 0.03), 0.15, clearcoat=1.0)
PLATES = [mat('plate_' + k, c, 0.25, clearcoat=0.8) for k, c in (('red', (0.9, 0.15, 0.2)), ('blue', (0.15, 0.35, 0.85)), ('yellow', (1.0, 0.8, 0.15)), ('green', (0.2, 0.65, 0.35)), ('white', (0.95, 0.95, 0.92)), ('black', (0.08, 0.08, 0.1)))]
PLATE_RIM = mat('plate_rim', (0.98, 0.97, 0.94), 0.3, clearcoat=0.8)
LANTERN = mat('lantern', (1.0, 0.25, 0.15), 0.6, emit=(1.0, 0.3, 0.12), emit_k=2.5)
LANTERN_W = mat('lantern_w', (1.0, 0.9, 0.7), 0.6, emit=(1.0, 0.85, 0.6), emit_k=2.0)
NOREN = mat('noren', (0.12, 0.2, 0.42), 0.9, sheen=0.6)
INK = mat('ink_white', (0.97, 0.95, 0.9), 0.8)
WALL = mat('wall_plaster', (0.93, 0.86, 0.74), 0.9)
TILE = mat('floor_tile', (0.32, 0.22, 0.16), 0.6)
CAT = mat('cat_white', (0.97, 0.96, 0.93), 0.4, clearcoat=0.6)
CAT_R = mat('cat_red', (0.9, 0.12, 0.12), 0.4, clearcoat=0.6)
GOLD = mat('gold', (1.0, 0.75, 0.3), 0.25, metal=1.0)
RED_LAC = mat('lacquer_red', (0.7, 0.08, 0.06), 0.25, clearcoat=0.8)
vis = []


def V(o):
    vis.append(o)
    return o


L, R = 5.0, 4.6
N = 26
inner = stadium_pts(R - 0.95, L, N)
outer = stadium_pts(R + 0.95, L, N)
# ---- the belt (its surface carries you: the game knows the loop's shape)
V(ring_solid('belt', inner, outer, 0.0, 0.3, BELT))
ring_solid('col_mesh_belt', inner, outer, 0.0, 0.3)
pts = stadium_pts(R, L, N * 2)
for i in range(0, len(pts), 1):
    x, z = pts[i]
    x2, z2 = pts[(i + 1) % len(pts)]
    yaw = math.atan2(x2 - x, z2 - z)
    V(box('slat', (x, 0.005, z), (1.8, 0.012, 0.05), SLAT, rot=(0, yaw + math.pi / 2, 0)))
# rails either side of the belt
V(ring_solid('rail_in', stadium_pts(R - 1.05, L, N), inner, 0.12, 0.45, STEEL))
V(ring_solid('rail_out', outer, stadium_pts(R + 1.05, L, N), 0.12, 0.45, STEEL))
# ---- the chef's island
isl = stadium_pts(R - 1.05, L, N)
V(flat_shape('island', isl, (0, -0.6, 0), WOOD, depth=0.78))
flat_shape('col_hull_island', isl, (0, -0.6, 0), None, depth=0.78)
V(flat_shape('island_mat', stadium_pts(R - 1.6, L - 0.3, N), (0, 0.185, 0), WOOD2, depth=0.01))
V(box('board', (-2.6, 0.32, 0.3), (2.4, 0.26, 1.5), WOOD, bevel=0.06))
box('col_box_board', (-2.6, 0.32, 0.3), (2.4, 0.26, 1.5))
V(cyl('rice_tub', (2.4, 0.6, -0.4), 1.0, 0.85, WOOD2, seg=40, bevel=0.04))
cyl('col_hull_tub', (2.4, 0.6, -0.4), 1.0, 0.85, None, seg=20)
V(cyl('rice_in_tub', (2.4, 1.0, -0.4), 0.9, 0.08, RICE, seg=40))
for k in range(3):
    V(torus('tub_band', (2.4, 0.3 + k * 0.28, -0.4), 1.01, 0.03, GOLD))
# a big salmon fillet on the board
V(box('fillet', (-2.6, 0.55, 0.3), (1.8, 0.2, 0.8), SALMON, bevel=0.08))
for k in range(5):
    V(box('fillet_line', (-3.3 + k * 0.35, 0.655, 0.3), (0.05, 0.01, 0.75), RICE, rot=(0, 0.4, 0)))
# lucky cat at the end of the island, one paw waving (cat_arm)
CX, CZ = 0.0, 0.0
V(sphere('cat_body', (CX, 0.95, CZ), 0.62, CAT, scale=(1, 1.15, 0.9)))
V(sphere('cat_head', (CX, 1.85, CZ + 0.05), 0.55, CAT, scale=(1.15, 0.95, 0.95)))
for s in (1, -1):
    V(cyl('cat_ear', (CX + s * 0.36, 2.35, CZ + 0.02), 0.18, 0.3, CAT, seg=4, r2=0.02))
    V(sphere('cat_eye', (CX + s * 0.2, 1.92, CZ + 0.55), 0.07, NORI, seg=12, rings=8, scale=(1, 0.5, 0.5)))
V(torus('cat_collar', (CX, 1.42, CZ + 0.03), 0.42, 0.06, CAT_R))
V(sphere('cat_bell', (CX, 1.32, CZ + 0.45), 0.1, GOLD, seg=14, rings=8))
V(cyl('cat_coin', (CX - 0.25, 0.95, CZ + 0.55), 0.3, 0.06, GOLD, rot=(math.pi / 2, 0, 0)))
arm = empty('cat_arm', (CX + 0.5, 1.45, CZ + 0.1))
V(cyl('cat_paw', (0, 0.35, 0), 0.15, 0.7, CAT, seg=16, parent=arm))
V(sphere('cat_pawtip', (0, 0.72, 0), 0.18, CAT, parent=arm))
sphere('col_hull_cat', (CX, 1.3, CZ), 0.75, None, seg=16, rings=8, scale=(1, 1.6, 0.9))
# ---- the outer counter top and the long way down
ctr_in = stadium_pts(R + 1.05, L, N)
ctr_out = stadium_pts(R + 2.6, L + 0.0, N)
V(ring_solid('counter', ctr_in, ctr_out, 0.18, 1.2, WOOD))
ring_solid('col_mesh_counter', ctr_in, ctr_out, 0.18, 1.2)
V(ring_solid('counter_front', ctr_out, stadium_pts(R + 2.75, L, N), 0.12, 9.5, WOOD2))
# chopsticks, soy dishes, a teapot (decor + a few loose)
for i, (x, z) in enumerate(((-3, 6.4), (2.5, 6.4), (9.6, -4.4), (-9.6, -4.4), (0, -6.4))):
    V(box('chopstick', (x, 0.28, z), (2.8, 0.12, 0.12), RED_LAC, bevel=0.03, rot=(0, 0.2, 0)))
    V(box('chopstick', (x, 0.28, z + 0.25), (2.8, 0.12, 0.12), RED_LAC, bevel=0.03, rot=(0, 0.15, 0)))
for i, (x, z) in enumerate(((4.0, -6.4), (-1.5, 6.5))):
    d = empty('dyn_soy_%d' % i, (x, 0.45, z))
    d['mass'] = 6.0
    V(cyl('dish', (0, 0, 0), 0.55, 0.16, PLATE_RIM, seg=32, parent=d, bevel=0.04))
    V(cyl('soy_pool', (0, 0.07, 0), 0.45, 0.03, SOY, seg=32, parent=d))
    cyl('col_hull_dish', (0, 0, 0), 0.55, 0.16, None, seg=16, parent=d)
# ---- the plates riding the belt, sushi on top (some loose rolls you can pick up and throw)
NP = 9
per = 4 * L + 2 * math.pi * R


def path(s):
    s = s % per
    if s < 2 * L:
        return (-L + s, R), 0.0
    s -= 2 * L
    if s < math.pi * R:
        a = math.pi / 2 - s / R
        return (L + R * math.cos(a), R * math.sin(a)), 0.0
    s -= math.pi * R
    if s < 2 * L:
        return (L - s, -R), 0.0
    s -= 2 * L
    a = -math.pi / 2 - s / R
    return (-L + R * math.cos(a), R * math.sin(a)), 0.0


def nigiri(name, top, parent, at=(0, 0, 0), yaw=0.0):
    x, y, z = at
    V(box(name + '_rice', (x, y + 0.18, z), (0.85, 0.36, 0.48), RICE, bevel=0.14, seg=3, parent=parent, rot=(0, yaw, 0)))
    V(box(name + '_top', (x, y + 0.42, z), (1.0, 0.13, 0.55), top, bevel=0.06, seg=3, parent=parent, rot=(0, yaw, 0)))
    if top == EGG:
        V(box(name + '_band', (x, y + 0.3, z), (0.18, 0.48, 0.58), NORI, parent=parent, rot=(0, yaw, 0)))
    elif top != TUNA:
        for k in range(3):
            V(box(name + '_line', (x - 0.3 + k * 0.3, y + 0.49, z), (0.05, 0.01, 0.5), RICE, parent=parent, rot=(0, yaw + 0.5, 0)))


for i in range(NP):
    (x, z), _ = path(i / NP * per)
    pn = empty('mov_plate_%d' % i, (x, 0.0, z))
    m = PLATES[i % len(PLATES)]
    V(cyl('plate', (0, 0.07, 0), 0.78, 0.1, m, seg=40, parent=pn, bevel=0.03))
    V(torus('plate_rim', (0, 0.13, 0), 0.72, 0.05, PLATE_RIM, parent=pn))
    cyl('col_hull_plate', (0, 0.07, 0), 0.78, 0.12, None, seg=20, parent=pn)
    kind = i % 3
    if kind == 0:
        nigiri('n%d' % i, (SALMON, TUNA, EGG)[(i // 3) % 3], pn, (0, 0.14, 0))
        box('col_box_nigiri', (0, 0.4, 0), (0.95, 0.5, 0.5), parent=pn)
    elif kind == 1:
        # gunkan with ikura
        V(cyl('gunkan', (0, 0.4, 0), 0.38, 0.5, NORI, seg=24, parent=pn))
        for k in range(9):
            a = k / 9 * math.tau
            V(sphere('roe', (math.cos(a) * 0.2, 0.68, math.sin(a) * 0.2), 0.1, IKURA, seg=10, rings=6, parent=pn))
        cyl('col_hull_gunkan', (0, 0.4, 0), 0.38, 0.5, None, seg=12, parent=pn)
    # loose maki rolls (dyn_) on the plain plates
    if kind == 2:
        d = empty('dyn_maki_%d' % i, (x, 0.55, z))
        d['mass'] = 10.0
        V(cyl('maki_nori', (0, 0, 0), 0.38, 0.6, NORI, seg=28, parent=d))
        V(cyl('maki_rice', (0, 0.305, 0), 0.32, 0.02, RICE, seg=28, parent=d))
        V(cyl('maki_fill', (0, 0.32, 0), 0.13, 0.02, (CUKE, SALMON, TUNA)[i % 3], seg=16, parent=d))
        cyl('col_hull_maki', (0, 0, 0), 0.38, 0.6, None, seg=14, parent=d)

# ---- the chef's knife (mov_knife: its origin is the bottom of the blade, the blade across the belt)
kn = empty('mov_knife', (0, 6.0, 0))
blade = flat_shape('blade', [(-1.5, 0), (1.3, 0), (1.5, 0.35), (1.4, 1.25), (-1.5, 1.25)], (0, 0, 0), STEEL, depth=0.12, parent=kn, rot=(math.pi / 2, 0, 0))
blade.location = G(0, 0, -0.06)
V(blade)
V(box('handle', (-2.3, 1.0, 0), (1.6, 0.42, 0.32), WOOD2, bevel=0.1, parent=kn))
V(cyl('rivet', (-2.0, 1.0, 0.17), 0.06, 0.05, GOLD, rot=(math.pi / 2, 0, 0), parent=kn))
V(cyl('rivet', (-2.6, 1.0, 0.17), 0.06, 0.05, GOLD, rot=(math.pi / 2, 0, 0), parent=kn))
box('col_box_blade', (0, 0.62, 0), (3.0, 1.25, 0.16), parent=kn)
warn = empty('knife_warn', (0, 0.02, 0))
V(flat_shape('warn_ring', [(x * 1.0, z * 0.45) for x, z in circle_pts(1.7, 40)], (0, 0.0, 0), LANTERN, depth=0.01, parent=warn))

# ---- the restaurant: noren curtain, lanterns, menu boards, giant stools, warm walls
V(box('back_wall', (0, 4, -15), (44, 30, 0.6), WALL))
V(box('floor', (0, -9.4, 0), (60, 0.4, 60), TILE))
for i in range(5):
    x = -6 + i * 3
    V(box('noren', (x, 4.4, -14.5), (2.8, 3.6, 0.1), NOREN))
V(box('noren_bar', (0, 6.3, -14.4), (15.4, 0.2, 0.2), WOOD2))
V(text('noren_txt', 'SUSHI', (0, 4.6, -14.42), 2.0, INK, depth=0.03, rot=(math.pi / 2, 0, 0), font='/System/Library/Fonts/Supplemental/Arial Black.ttf'))
# shelves of jars and bottles along the back wall
JARS = [mat('jar_%d' % k, c, 0.2, clearcoat=0.8) for k, c in enumerate(((0.85, 0.3, 0.2), (0.2, 0.45, 0.75), (0.95, 0.85, 0.6), (0.25, 0.6, 0.35), (0.9, 0.6, 0.2)))]
for row, y in enumerate((-1.2, 1.4)):
    V(box('shelf', (0, y, -14.2), (30, 0.18, 1.2), WOOD2))
    x = -14.0
    while x < 14:
        if -8 < x < 8 and row == 1:
            x += 1.0
            continue
        k = random.randint(0, 4)
        h = random.uniform(0.7, 1.5)
        if random.random() < 0.5:
            V(cyl('bottle', (x, y + 0.09 + h / 2, -14.2), 0.28, h, JARS[k], seg=20, bevel=0.03))
            V(cyl('bottle_neck', (x, y + 0.09 + h + 0.2, -14.2), 0.1, 0.4, JARS[k], seg=12))
        else:
            V(cyl('jar', (x, y + 0.09 + 0.35, -14.2), 0.42, 0.7, JARS[k], seg=24, bevel=0.06))
            V(cyl('jar_lid', (x, y + 0.09 + 0.75, -14.2), 0.44, 0.12, WOOD2, seg=24))
        x += random.uniform(0.9, 1.4)
for i, (x, z, y) in enumerate(((-7, -4, 5.2), (0, -2, 5.8), (7, -4, 5.2), (-10, 3, 4.8), (10, 3, 4.8))):
    m = LANTERN if i % 2 == 0 else LANTERN_W
    V(sphere('lantern', (x, y, z), 0.8, m, scale=(1, 1.25, 1)))
    V(cyl('lantern_cap', (x, y + 1.05, z), 0.42, 0.2, WOOD2))
    V(cyl('lantern_cap2', (x, y - 1.05, z), 0.42, 0.2, WOOD2))
    V(cyl('lantern_cord', (x, y + 5, z), 0.03, 8, WOOD2, seg=6))
for i, (x, t) in enumerate(((-14, 'UDON'), (14, 'RAMEN'))):
    V(box('menu_board', (x, 4.2, -14.6), (6, 3.4, 0.2), WOOD2))
    V(text('menu_txt', t, (x, 4.2, -14.45), 1.3, INK, depth=0.03, rot=(math.pi / 2, 0, 0)))
for i in range(6):
    a = i / 6 * math.tau + 0.2
    x, z = math.cos(a) * 13.5, math.sin(a) * 9.5
    if z < -6:
        continue
    V(cyl('stool_seat', (x, -1.6, z), 2.2, 0.7, RED_LAC, seg=40, bevel=0.15))
    V(cyl('stool_leg', (x, -5.6, z), 0.4, 7.6, STEEL, seg=20))

# ---- spawns: on the island and the counter
for i, (x, z) in enumerate(((-1.5, 1.6), (1.5, 1.6), (-1.5, -1.6), (1.5, -1.6), (-4.2, 6.2), (4.2, -6.2), (4.2, 6.2), (-4.2, -6.2))):
    y = 1.1
    e = empty('spawn_%d' % i, (x, y, z))
    e.rotation_euler = (0, 0, math.atan2(x, -z) + math.pi)

bpy.context.view_layer.update()
big = [o for o in vis if o.name.startswith(('belt', 'island', 'counter', 'rail', 'board', 'rice_tub', 'cat_body', 'floor', 'back_wall'))]
bake_ao(big, distance=0.8, samples=16, dense=0.8)
export([o for o in bpy.data.objects], 'sushi')
