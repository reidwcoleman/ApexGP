# TOY EXPRESS: a toy-town train set built across two playroom tables pushed nearly together.
# The wind-up engine and two wagons (mov_car_*) lap an oval track that crosses the gap between
# the tables on two trestle bridges; a wooden ruler makes a third, narrow bridge in the middle.
# A hill with a tunnel on the left table, a little town and a station on the right.
# Down the gap or off the edge it's a long way to the rug.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset()
random.seed(3)

TABLE = mat('table_wood', (0.8, 0.56, 0.34), 0.45, clearcoat=0.35)
TABLE2 = mat('table_edge', (0.6, 0.38, 0.22), 0.55)
BEECH = mat('track_beech', (0.95, 0.8, 0.56), 0.55, clearcoat=0.2)
GROOVE = mat('track_groove', (0.55, 0.4, 0.26), 0.7)
FELT = mat('felt', (0.45, 0.75, 0.4), 0.95, sheen=0.45)
FELT2 = mat('felt_path', (0.93, 0.86, 0.68), 0.95, sheen=0.3)
RED = mat('toy_red', (0.92, 0.18, 0.16), 0.32, clearcoat=0.8)
BLUE = mat('toy_blue', (0.16, 0.42, 0.92), 0.32, clearcoat=0.8)
YEL = mat('toy_yellow', (1.0, 0.78, 0.14), 0.32, clearcoat=0.8)
GREEN = mat('toy_green', (0.2, 0.72, 0.38), 0.32, clearcoat=0.8)
ORANGE = mat('toy_orange', (1.0, 0.5, 0.15), 0.32, clearcoat=0.8)
PINK = mat('toy_pink', (1.0, 0.55, 0.7), 0.32, clearcoat=0.8)
TEAL = mat('toy_teal', (0.15, 0.7, 0.72), 0.32, clearcoat=0.8)
BLACK = mat('toy_black', (0.09, 0.09, 0.11), 0.35, clearcoat=0.6)
WHITE = mat('toy_white', (0.97, 0.96, 0.92), 0.38, clearcoat=0.6)
BRASS = mat('brass', (0.95, 0.72, 0.3), 0.25, metal=1.0)
STONE = mat('tunnel_stone', (0.78, 0.72, 0.64), 0.75)
GRASS = mat('hill_grass', (0.38, 0.7, 0.32), 0.9, sheen=0.4)
GRASS2 = mat('hill_grass2', (0.45, 0.76, 0.36), 0.9, sheen=0.4)
LEAF = mat('tree_leaf', (0.3, 0.68, 0.32), 0.45, clearcoat=0.5)
LEAF2 = mat('tree_leaf2', (0.55, 0.78, 0.28), 0.45, clearcoat=0.5)
TRUNK = mat('trunk', (0.55, 0.35, 0.2), 0.55)
RULER = mat('ruler', (1.0, 0.9, 0.45), 0.35, clearcoat=0.6)
INK = mat('ink', (0.15, 0.12, 0.1), 0.6)
WATER = mat('fountain_water', (0.45, 0.75, 0.95), 0.08, clearcoat=1.0)
RUG = mat('rug', (0.3, 0.42, 0.75), 0.95, sheen=0.5)
RUG2 = mat('rug_band', (0.98, 0.8, 0.45), 0.95, sheen=0.5)
FLOOR = mat('floor_boards', (0.68, 0.48, 0.3), 0.5)
WALL = mat('wall_paper', (0.98, 0.9, 0.78), 0.9)
STRIPE = mat('wall_stripe', (0.96, 0.78, 0.64), 0.9)
SKY = mat('window_sky', (0.75, 0.88, 1.0), 0.3, emit=(0.85, 0.93, 1.0), emit_k=2.4)
FUR = mat('bear_fur', (0.72, 0.48, 0.28), 0.95, sheen=0.8)
FUR2 = mat('bear_muzzle', (0.95, 0.82, 0.62), 0.95, sheen=0.8)
SHELF = mat('shelf', (0.95, 0.95, 0.95), 0.5)
GLASS = mat('house_window', (0.55, 0.8, 1.0), 0.1, emit=(1.0, 0.85, 0.5), emit_k=0.6)
CRATE = mat('crate', (0.82, 0.62, 0.36), 0.7)
vis = []


def V(o):
    vis.append(o)
    return o


def clip(pts, side, g):
    """Sutherland-Hodgman: the part of a convex polygon on one side of the gap (x <= -g or x >= g)"""
    out = []
    n = len(pts)
    inside = (lambda p: p[0] <= -g) if side < 0 else (lambda p: p[0] >= g)
    xg = -g if side < 0 else g
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        ia, ib = inside(a), inside(b)
        if ia:
            out.append(a)
        if ia != ib:
            t = (xg - a[0]) / (b[0] - a[0])
            out.append((xg, a[1] + (b[1] - a[1]) * t))
    return out


# ---- two tables with a gap between them
TW, TD, GAP = 28.0, 18.0, 1.3        # whole width, depth; half the gap
HW = TW / 2 - GAP                    # each table's width
for s in (-1, 1):
    cx = s * (GAP + HW / 2)
    V(box('table_top', (cx, -0.45, 0), (HW, 0.9, TD), TABLE, bevel=0.12))
    box('col_box_table', (cx, -0.45, 0), (HW, 0.9, TD))
    for lx in (GAP + 1.2, TW / 2 - 1.2):
        for sz in (-1, 1):
            V(box('table_leg', (s * lx, -8.5, sz * (TD / 2 - 1.2)), (1.4, 15.2, 1.4), TABLE2, bevel=0.1))
    V(box('apron', (cx, -1.3, TD / 2 - 0.5), (HW - 1.5, 0.9, 0.3), TABLE2))
    V(box('apron', (cx, -1.3, -TD / 2 + 0.5), (HW - 1.5, 0.9, 0.3), TABLE2))

# ---- the track: wide wooden pieces with two grooves (the game runs the cars on the same loop)
L, R = 6.5, 4.6
N = 32
TB = 1.15                             # half the track bed's width
V(ring_solid('track', stadium_pts(R - TB, L, N), stadium_pts(R + TB, L, N), 0.07, 0.09, BEECH))
for d in (-0.55, 0.55):
    V(ring_solid('groove', stadium_pts(R + d - 0.07, L, N), stadium_pts(R + d + 0.07, L, N), 0.075, 0.02, GROOVE))
pts = stadium_pts(R, L, 16)
for i in range(len(pts)):
    x, z = pts[i]
    x2, z2 = pts[(i + 1) % len(pts)]
    V(box('joint', (x, 0.072, z), (2.3, 0.01, 0.07), GROOVE, rot=(0, math.atan2(x2 - x, z2 - z) + math.pi / 2, 0)))

# trestle bridges where the track crosses the gap (front and back straights)
for sz in (-1, 1):
    z = sz * R
    V(box('bridge_deck', (0, -0.15, z), (GAP * 2 + 1.2, 0.3, TB * 2 + 0.2), TABLE2, bevel=0.04))
    box('col_box_bridge', (0, -0.15, z), (GAP * 2 + 1.2, 0.3, TB * 2 + 0.2))
    for s in (-1, 1):
        V(box('bridge_beam', (0, -0.5, z + s * (TB - 0.1)), (GAP * 2 + 0.4, 0.4, 0.2), RED, bevel=0.03))
        for k in range(5):
            x = -GAP + k * GAP / 2
            V(box('bridge_truss', (x, -1.6, z + s * (TB - 0.1)), (0.14, 2.2, 0.14), RED, rot=(0, 0, 0.5 * (1 if k % 2 else -1))))
        for sx in (-1, 1):
            V(box('bridge_post', (sx * (GAP + 0.2), 0.35, z + s * (TB + 0.15)), (0.2, 0.7, 0.2), WHITE, bevel=0.04))

# the ruler: a narrow bridge across the middle of the gap
V(box('ruler', (0, 0.06, 0), (GAP * 2 + 3.2, 0.12, 1.3), RULER, bevel=0.03))
box('col_box_ruler', (0, 0.06, 0), (GAP * 2 + 3.2, 0.12, 1.3))
for k in range(-14, 15):
    big = k % 5 == 0
    V(box('ruler_tick', (k * 0.15, 0.125, 0.6 - (0.22 if big else 0.12) / 2), (0.02, 0.01, 0.22 if big else 0.12), INK))

# felt on each table inside the loop, with a sandy path
for s in (-1, 1):
    V(flat_shape('felt', clip(stadium_pts(R - TB - 0.1, L, N), s, GAP + 0.05), (0, 0.0, 0), FELT, depth=0.05))
    V(flat_shape('path', clip(stadium_pts(0.75, L - 1.0, 8), s, GAP + 0.05), (0, 0.003, 0), FELT2, depth=0.05))

# ---- left table: a grassy hill with the tunnel through it on the back straight
TX0, TX1, TZ = -10.6, -4.2, -R
TH = 3.3                                         # clearance under the roof
for s in (-1, 1):
    V(box('tunnel_wall', ((TX0 + TX1) / 2, TH / 2, TZ + s * (TB + 0.35)), (TX1 - TX0, TH, 0.6), GRASS, bevel=0.06))
    # grassy bank sloping down from the hill on the outside
    for k in range(6):
        x = TX0 + 0.5 + k * (TX1 - TX0 - 1.0) / 5
        V(sphere('hill_bank', (x, TH * 0.45, TZ + s * (TB + 0.75)), 1.0, GRASS if k % 2 else GRASS2, seg=16, rings=10, scale=(0.75, TH * 0.5, 0.45)))
    box('col_box_tunnel_wall', ((TX0 + TX1) / 2, TH / 2, TZ + s * (TB + 0.35)), (TX1 - TX0, TH, 0.6))
V(box('tunnel_roof', ((TX0 + TX1) / 2, TH + 0.25, TZ), (TX1 - TX0 + 0.3, 0.5, TB * 2 + 1.3), GRASS, bevel=0.2, seg=3))
box('col_box_tunnel_roof', ((TX0 + TX1) / 2, TH + 0.25, TZ), (TX1 - TX0 + 0.3, 0.5, TB * 2 + 1.3))
for x in (TX0, TX1):
    V(torus('portal', (x, 1.45, TZ), 1.45, 0.24, STONE, seg=36, rot=(0, 0, math.pi / 2)))
    V(box('portal_face', (x, TH - 0.35, TZ), (0.4, 0.7, TB * 2 + 1.0), STONE, bevel=0.05))
# a terraced bank up the hill from the back strip of the table (climb it)
for k, h in enumerate((1.2, 2.3)):
    x = TX1 - 1.2 - k * 1.6
    V(box('hill_step', (x, h / 2, TZ - TB - 1.55), (1.6, h, 1.8), GRASS, bevel=0.12, seg=3))
    box('col_box_hill_step', (x, h / 2, TZ - TB - 1.55), (1.6, h, 1.8))
# flowers on the hill
for k in range(14):
    x = random.uniform(TX0 + 0.4, TX1 - 0.4)
    z = TZ + random.uniform(-1.8, 1.8)
    V(cyl('stalk', (x, TH + 0.62, z), 0.03, 0.25, GREEN, seg=6))
    V(sphere('flower', (x, TH + 0.78, z), 0.12, (PINK, YEL, WHITE, ORANGE)[k % 4], seg=10, rings=6, scale=(1, 0.6, 1)))


def tree(x, z, h, m):
    V(cyl('trunk', (x, h * 0.3, z), 0.16, h * 0.6, TRUNK, seg=10))
    V(sphere('crown', (x, h * 0.6 + 0.55, z), 0.85, m, seg=20, rings=12, scale=(1, 1.15, 1)))
    cyl('col_hull_trunk', (x, h * 0.3, z), 0.2, h * 0.6, None, seg=8)
    sphere('col_hull_crown', (x, h * 0.6 + 0.55, z), 0.8, None, seg=10, rings=6, scale=(1, 1.15, 1))


for k, (x, z) in enumerate(((-9.6, 1.2), (-7.8, -1.4), (-5.2, 1.8), (-3.0, -1.0), (-12.6, 6.6), (-3.2, 7.2), (-12.8, -7.0))):
    tree(x, z, 2.2 + (k % 3) * 0.5, LEAF if k % 2 else LEAF2)


# ---- right table: a little town (stand on the roofs) and the station
def prism(w, d, h, rh):
    bm = bmesh.new()
    for zz in (-d / 2 - 0.2, d / 2 + 0.2):
        for p in ((-w / 2 - 0.25, h), (w / 2 + 0.25, h), (0, h + rh)):
            bm.verts.new(Vector((p[0], -zz, p[1])))
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def house(x, z, w, d, h, wall, roof, yaw=0.0):
    node = empty('house', (x, 0, z), yaw=yaw)
    V(box('house_wall', (0, h / 2, 0), (w, h, d), wall, bevel=0.06, parent=node))
    col_box('house', (0, h / 2, 0), (w, h, d), parent=node)
    rh = 0.9
    V(obj_from_bm(prism(w, d, h, rh), 'house_roof', roof, node))
    obj_from_bm(prism(w, d, h, rh), 'col_hull_roof', None, node)
    V(box('house_door', (0, 0.55, d / 2 + 0.01), (0.6, 1.1, 0.04), WHITE, parent=node))
    for sx in (-1, 1):
        V(box('house_win', (sx * w * 0.28, h * 0.62, d / 2 + 0.01), (0.45, 0.45, 0.04), GLASS, parent=node))
    V(box('chimney', (w * 0.25, h + rh * 0.7, 0), (0.35, 0.8, 0.35), RED, parent=node))
    return node


house(4.4, -1.6, 2.0, 1.8, 1.7, PINK, BLUE)
house(8.2, 1.1, 2.4, 1.9, 2.1, YEL, RED)
house(10.6, -1.4, 1.6, 1.6, 1.4, TEAL, ORANGE)
# a fountain on the town square
V(cyl('fountain', (4.2, 0.3, 1.6), 0.95, 0.6, WHITE, seg=28, bevel=0.04))
V(cyl('fountain_water', (4.2, 0.55, 1.6), 0.8, 0.08, WATER, seg=28))
V(cyl('fountain_col', (4.2, 0.95, 1.6), 0.15, 0.8, WHITE, seg=12))
V(sphere('fountain_top', (4.2, 1.4, 1.6), 0.25, BLUE, seg=16, rings=8))
cyl('col_hull_fountain', (4.2, 0.3, 1.6), 0.95, 0.6, None, seg=16)

# the station on the right table's front strip
SX, SZ = 7.6, R + TB + 1.25
V(box('platform', (SX, 0.3, SZ), (7.0, 0.6, 1.9), WHITE, bevel=0.06))
box('col_box_platform', (SX, 0.3, SZ), (7.0, 0.6, 1.9))
V(box('platform_edge', (SX, 0.61, SZ - 0.9), (7.0, 0.03, 0.16), YEL))
V(box('station', (SX + 1.8, 1.55, SZ + 0.45), (2.8, 1.9, 0.9), RED, bevel=0.06))
box('col_box_station', (SX + 1.8, 1.55, SZ + 0.45), (2.8, 1.9, 0.9))
V(box('station_roof', (SX + 0.6, 2.7, SZ + 0.1), (5.4, 0.25, 2.0), BLUE, bevel=0.08))
box('col_box_station_roof', (SX + 0.6, 2.7, SZ + 0.1), (5.4, 0.25, 2.0))
for x in (SX - 1.9, SX - 0.2):
    V(cyl('roof_post', (x, 1.65, SZ - 0.6), 0.08, 2.1, WHITE, seg=10))
    cyl('col_hull_post', (x, 1.65, SZ - 0.6), 0.1, 2.1, None, seg=8)
V(cyl('station_clock', (SX + 1.8, 2.1, SZ - 0.02), 0.4, 0.1, WHITE, seg=24, rot=(math.pi / 2, 0, 0)))
V(cyl('station_clock_rim', (SX + 1.8, 2.1, SZ - 0.04), 0.45, 0.06, BLACK, seg=24, rot=(math.pi / 2, 0, 0)))

# a signal by the track
V(cyl('signal_post', (-2.4, 1.2, R + TB + 0.5), 0.07, 2.4, BLACK, seg=8))
V(box('signal_head', (-2.4, 2.4, R + TB + 0.5), (0.35, 0.8, 0.3), BLACK, bevel=0.05))
V(sphere('signal_red', (-2.4, 2.6, R + TB + 0.66), 0.11, mat('sig_red', (1, 0.2, 0.15), 0.3, emit=(1, 0.15, 0.1), emit_k=4.0), seg=12, rings=8))
V(sphere('signal_green', (-2.4, 2.25, R + TB + 0.66), 0.11, mat('sig_green', (0.3, 1, 0.4), 0.3), seg=12, rings=8))


# ---- the train: built facing +z, each car on its own mover. Big enough to ride.
def wheels(node, w, zs, m, r=0.42):
    for sx in (-1, 1):
        for sz in zs:
            V(cyl('wheel', (sx * (w / 2 + 0.03), r, sz), r, 0.18, m, seg=24, rot=(0, 0, math.pi / 2), parent=node))
            V(cyl('hub', (sx * (w / 2 + 0.13), r, sz), 0.13, 0.06, BRASS, seg=12, rot=(0, 0, math.pi / 2), parent=node))


EW = 2.0
eng = empty('mov_car_0', (0, 0, 0))
V(box('eng_base', (0, 0.6, 0), (EW, 0.4, 3.4), BLACK, bevel=0.06, parent=eng))
V(cyl('eng_boiler', (0, 1.45, 0.45), 0.8, 2.4, RED, seg=32, rot=(math.pi / 2, 0, 0), parent=eng, bevel=0.05))
for k in range(3):
    V(cyl('eng_band', (0, 1.45, -0.4 + k * 0.85), 0.83, 0.1, BRASS, seg=32, rot=(math.pi / 2, 0, 0), parent=eng))
V(cyl('eng_front', (0, 1.45, 1.68), 0.72, 0.1, BLACK, seg=32, rot=(math.pi / 2, 0, 0), parent=eng))
V(cyl('eng_chimney', (0, 2.55, 1.2), 0.26, 0.8, BLACK, seg=16, r2=0.4, parent=eng))
V(cyl('eng_dome', (0, 2.3, 0.35), 0.32, 0.3, BRASS, seg=16, parent=eng))
V(box('eng_cab', (0, 1.75, -1.15), (EW, 1.9, 1.2), BLUE, bevel=0.07, parent=eng))
V(box('eng_cab_roof', (0, 2.8, -1.15), (EW + 0.3, 0.18, 1.6), RED, bevel=0.06, parent=eng))
for s in (-1, 1):
    V(box('eng_window', (s * (EW / 2 + 0.01), 2.05, -1.15), (0.02, 0.6, 0.65), WHITE, parent=eng))
V(box('eng_cow', (0, 0.55, 1.85), (EW - 0.1, 0.45, 0.45), YEL, bevel=0.1, rot=(-0.4, 0, 0), parent=eng))
V(box('eng_lamp', (0, 1.15, 1.75), (0.4, 0.3, 0.12), mat('lamp', (1, 0.95, 0.7), 0.3, emit=(1, 0.9, 0.5), emit_k=5.0), parent=eng))
for s in (-1, 1):
    V(sphere('eng_eye', (s * 0.28, 1.68, 1.73), 0.11, BLACK, seg=12, rings=8, parent=eng))
key = empty('wind_key', (0, 1.9, -1.85), parent=eng)
V(cyl('key_shaft', (0, 0, -0.2), 0.08, 0.4, BRASS, seg=10, rot=(math.pi / 2, 0, 0), parent=key))
for s in (-1, 1):
    V(sphere('key_loop', (s * 0.4, 0, -0.42), 0.32, BRASS, seg=16, rings=10, scale=(1, 1, 0.3), parent=key))
wheels(eng, EW, (-1.0, 0.1, 1.1), RED)
col_box('eng_base', (0, 1.1, 0.45), (EW, 1.4, 2.5), parent=eng)
col_box('eng_cab', (0, 1.75, -1.15), (EW, 1.9, 1.2), parent=eng)
col_box('eng_cab_roof', (0, 2.8, -1.15), (EW + 0.3, 0.18, 1.6), parent=eng)

for k, (m, trim) in enumerate(((YEL, GREEN), (GREEN, BLUE))):
    car = empty('mov_car_%d' % (k + 1), (0, 0, 0))
    V(box('car_base', (0, 0.6, 0), (EW, 0.4, 3.2), BLACK, bevel=0.06, parent=car))
    V(box('car_floor', (0, 0.88, 0), (EW, 0.2, 3.2), m, bevel=0.05, parent=car))
    col_box('car_floor', (0, 0.75, 0), (EW, 0.5, 3.2), parent=car)
    if k == 0:
        # an open wagon with sides to hang off and hide in
        for s in (-1, 1):
            V(box('car_side', (s * (EW / 2 - 0.07), 1.3, 0), (0.14, 0.65, 3.2), trim, bevel=0.04, parent=car))
            col_box('car_side', (s * (EW / 2 - 0.07), 1.3, 0), (0.14, 0.65, 3.2), parent=car)
            V(box('car_end', (0, 1.3, s * 1.53), (EW, 0.65, 0.14), trim, bevel=0.04, parent=car))
            col_box('car_end', (0, 1.3, s * 1.53), (EW, 0.65, 0.14), parent=car)
    else:
        # a flat car with a big crate strapped on (climb it, ride on top)
        V(box('car_crate', (0, 1.65, -0.5), (1.6, 1.3, 1.6), CRATE, bevel=0.05, parent=car))
        col_box('car_crate', (0, 1.65, -0.5), (1.6, 1.3, 1.6), parent=car)
        V(box('car_strap', (0, 1.65, -0.5), (1.64, 1.34, 0.14), RED, parent=car))
    wheels(car, EW, (-0.95, 0.95), trim)

# ---- loose toy blocks
LET = 'ABCPOW'
BL = ((-7.8, 1.6), (-3.6, 2.8), (11.0, 2.0), (6.2, -0.4), (-12.4, -4.0), (12.6, -6.6))
for k in range(6):
    x, z = BL[k]
    node = empty('dyn_block_%d' % k, (x, 0.48, z))
    m = (RED, BLUE, YEL, GREEN, ORANGE, BLUE)[k]
    V(box('block', (0, 0, 0), (0.9, 0.9, 0.9), m, bevel=0.06, parent=node))
    for f, rot in (((0, 0, 0.455), (math.pi / 2, 0, 0)), ((0, 0, -0.455), (-math.pi / 2, 0, math.pi)), ((0.455, 0, 0), (math.pi / 2, math.pi / 2, 0)), ((-0.455, 0, 0), (math.pi / 2, -math.pi / 2, 0))):
        V(text('block_letter', LET[k], f, 0.58, WHITE, depth=0.02, rot=rot, parent=node))
    box('col_box_block', (0, 0, 0), (0.9, 0.9, 0.9), parent=node)
    node['mass'] = 10

# ---- the playroom
FY = -16.0
V(box('floor', (0, FY - 0.2, -5), (100, 0.4, 80), FLOOR))
box('col_box_floor', (0, FY - 0.2, -5), (100, 0.4, 80))
V(cyl('rug', (0, FY + 0.03, 0), 22, 0.06, RUG, seg=72))
for r in (19, 14.5):
    V(torus('rug_band', (0, FY + 0.06, 0), r, 0.35, RUG2, seg=72, rseg=6))
V(box('wall', (0, FY + 25, -34), (100, 50, 1), WALL))
stripes = []
for i in range(-24, 25):
    stripes.append(box('stripe', (i * 2.0, FY + 25, -33.45), (0.7, 50, 0.05), STRIPE))
V(join(stripes, 'wall_stripes'))
V(box('window', (-16, FY + 27, -33.3), (13, 15, 0.1), SKY))
V(box('window_frame', (-16, FY + 27, -33.2), (13.8, 0.6, 0.3), SHELF))
V(box('window_frame', (-16, FY + 27, -33.2), (0.6, 15.8, 0.3), SHELF))
V(box('shelf', (17, FY + 19, -31), (16, 0.6, 5), SHELF))
for k in range(6):
    V(box('book', (10.5 + k * 1.3, FY + 21.4, -31), (1.0, 4.2 + (k % 2) * 0.8, 3.5), (RED, BLUE, YEL, GREEN, RED, TEAL)[k], bevel=0.05))
# giant crayons on the rug
for k in range(7):
    a = random.uniform(0, math.tau)
    x, z = random.uniform(-16, 16), random.uniform(10, 20)
    V(cyl('crayon', (x, FY + 0.5, z), 0.5, 6, (RED, BLUE, YEL, GREEN, ORANGE, PINK, TEAL)[k], seg=16, rot=(math.pi / 2, a, 0)))
# a big teddy bear sitting by the tables, watching
BX, BY, BZ = 20, FY, -14
V(sphere('bear_body', (BX, BY + 7, BZ), 5.5, FUR, scale=(1, 1, 1.15)))
V(sphere('bear_belly', (BX - 1.0, BY + 6.5, BZ + 4.2), 3.6, FUR2, scale=(1, 0.5, 1.1)))
V(sphere('bear_head', (BX, BY + 15.5, BZ + 0.5), 4.2, FUR))
V(sphere('bear_muzzle', (BX - 0.9, BY + 14.6, BZ + 4.2), 1.8, FUR2, scale=(1.2, 0.8, 0.9)))
V(sphere('bear_nose', (BX - 1.0, BY + 15.2, BZ + 5.6), 0.55, BLACK))
for s in (-1, 1):
    V(sphere('bear_ear', (BX + s * 3.1, BY + 19.0, BZ - 0.3), 1.6, FUR, scale=(1, 0.5, 1)))
    V(sphere('bear_eye', (BX - 0.9 + s * 1.5, BY + 16.6, BZ + 4.1), 0.45, BLACK))
    V(sphere('bear_paw', (BX + s * 4.8, BY + 4.0, BZ + 3.0), 1.9, FUR, scale=(1, 1.3, 1)))
    V(sphere('bear_foot', (BX + s * 2.8, BY + 1.8, BZ + 5.2), 2.1, FUR, scale=(1, 1.3, 0.9)))

# ---- spawns: both tables' insides, the station, the outer strips
SP = ((-8.6, 1.0, -0.2), (-4.4, 1.0, 0.4), (6.0, 1.0, -0.2), (6.2, 1.0, 2.9), (4.8, 1.6, SZ - 0.1), (6.6, 1.6, SZ - 0.1), (-8.0, 1.0, R + TB + 1.4), (8.0, 1.0, -R - TB - 1.4))
for i, (x, y, z) in enumerate(SP):
    e = empty('spawn_%d' % i, (x, y, z))
    e.rotation_euler = (0, 0, math.atan2(x, -z) + math.pi)

bpy.context.view_layer.update()
big = [o for o in vis if o.name.startswith(('table_top', 'track', 'felt', 'tunnel_roof', 'platform', 'ruler', 'house_wall', 'hill_step'))]
bake_ao(big, distance=0.8, samples=16, dense=0.9)
export([o for o in bpy.data.objects], 'train')
