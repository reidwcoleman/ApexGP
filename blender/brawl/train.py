# TOY EXPRESS: a wooden train set on the playroom table. A wind-up engine and two wagons
# (mov_car_*) run round an oval track; ride the wagons, stand on the tunnel roof, mind the engine.
# Off the table's edge it's a long way down to the rug.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset()
random.seed(3)

TABLE = mat('table_wood', (0.78, 0.55, 0.34), 0.5, clearcoat=0.35)
TABLE2 = mat('table_edge', (0.62, 0.4, 0.23), 0.55)
BEECH = mat('track_beech', (0.93, 0.78, 0.55), 0.6)
GROOVE = mat('track_groove', (0.6, 0.45, 0.3), 0.7)
FELT = mat('felt', (0.42, 0.72, 0.38), 0.95, sheen=0.4)
RED = mat('toy_red', (0.9, 0.18, 0.15), 0.35, clearcoat=0.7)
BLUE = mat('toy_blue', (0.15, 0.4, 0.9), 0.35, clearcoat=0.7)
YEL = mat('toy_yellow', (1.0, 0.78, 0.12), 0.35, clearcoat=0.7)
GREEN = mat('toy_green', (0.2, 0.7, 0.35), 0.35, clearcoat=0.7)
BLACK = mat('toy_black', (0.1, 0.1, 0.12), 0.4, clearcoat=0.5)
WHITE = mat('toy_white', (0.97, 0.96, 0.92), 0.4, clearcoat=0.5)
BRASS = mat('brass', (0.95, 0.72, 0.3), 0.25, metal=1.0)
STONE = mat('tunnel_stone', (0.72, 0.68, 0.62), 0.8)
GRASS = mat('tunnel_grass', (0.35, 0.68, 0.3), 0.9, sheen=0.3)
TREE = mat('tree', (0.2, 0.55, 0.28), 0.6, clearcoat=0.3)
TRUNK = mat('trunk', (0.55, 0.35, 0.2), 0.6)
RUG = mat('rug', (0.35, 0.45, 0.75), 0.95, sheen=0.5)
RUG2 = mat('rug_band', (0.95, 0.8, 0.5), 0.95, sheen=0.5)
FLOOR = mat('floor_boards', (0.7, 0.5, 0.32), 0.55)
WALL = mat('wall_paper', (0.98, 0.9, 0.78), 0.9)
STRIPE = mat('wall_stripe', (0.95, 0.75, 0.62), 0.9)
SKY = mat('window_sky', (0.75, 0.88, 1.0), 0.3, emit=(0.85, 0.93, 1.0), emit_k=2.2)
FUR = mat('bear_fur', (0.72, 0.48, 0.28), 0.95, sheen=0.8)
FUR2 = mat('bear_muzzle', (0.95, 0.82, 0.62), 0.95, sheen=0.8)
SHELF = mat('shelf', (0.95, 0.95, 0.95), 0.5)
vis = []


def V(o):
    vis.append(o)
    return o


# ---- the table
TW, TD = 22.0, 13.0
V(box('table_top', (0, -0.45, 0), (TW, 0.9, TD), TABLE, bevel=0.12))
box('col_box_table', (0, -0.45, 0), (TW, 0.9, TD))
for sx in (-1, 1):
    for sz in (-1, 1):
        V(box('table_leg', (sx * (TW / 2 - 1.2), -8.5, sz * (TD / 2 - 1.2)), (1.4, 15.2, 1.4), TABLE2, bevel=0.1))
V(box('apron', (0, -1.3, TD / 2 - 0.5), (TW - 1.5, 0.9, 0.3), TABLE2))
V(box('apron', (0, -1.3, -TD / 2 + 0.5), (TW - 1.5, 0.9, 0.3), TABLE2))

# ---- the track (flat wooden pieces; the game runs the cars along the same loop)
L, R = 5.6, 3.6
N = 28
V(ring_solid('track', stadium_pts(R - 0.75, L, N), stadium_pts(R + 0.75, L, N), 0.06, 0.08, BEECH))
for d in (-0.35, 0.35):
    V(ring_solid('groove', stadium_pts(R + d - 0.06, L, N), stadium_pts(R + d + 0.06, L, N), 0.065, 0.02, GROOVE))
pts = stadium_pts(R, L, 14)
for i in range(len(pts)):
    x, z = pts[i]
    x2, z2 = pts[(i + 1) % len(pts)]
    V(box('joint', (x, 0.062, z), (1.5, 0.01, 0.06), GROOVE, rot=(0, math.atan2(x2 - x, z2 - z) + math.pi / 2, 0)))
# the felt middle with toy trees
V(flat_shape('felt', stadium_pts(R - 0.9, L, N), (0, 0.0, 0), FELT, depth=0.04))
for k, (x, z) in enumerate(((-3.4, 0.6), (-1.8, -1.1), (2.4, 0.9), (4.0, -0.8), (0.4, 1.6))):
    h = 1.6 + (k % 3) * 0.35
    V(cyl('trunk', (x, 0.25, z), 0.14, 0.5, TRUNK, seg=10))
    V(cyl('tree', (x, 0.5 + h / 2, z), 0.65, h, TREE, seg=16, r2=0.02))
    cyl('col_hull_tree', (x, 0.5 + h / 2 - 0.25, z), 0.5, h + 0.5, None, seg=10, r2=0.05)

# ---- the tunnel over the back straight: walk on its roof, the train goes under
TX0, TX1 = -2.4, 2.0
TZ = -R
for s in (-1, 1):
    V(box('tunnel_wall', ((TX0 + TX1) / 2, 1.05, TZ + s * 1.25), (TX1 - TX0, 2.1, 0.4), STONE, bevel=0.06))
    box('col_box_tunnel_wall', ((TX0 + TX1) / 2, 1.05, TZ + s * 1.25), (TX1 - TX0, 2.1, 0.4))
V(box('tunnel_roof', ((TX0 + TX1) / 2, 2.3, TZ), (TX1 - TX0 + 0.2, 0.4, 3.2), GRASS, bevel=0.12))
box('col_box_tunnel_roof', ((TX0 + TX1) / 2, 2.3, TZ), (TX1 - TX0 + 0.2, 0.4, 3.2))
for x in (TX0, TX1):
    V(torus('portal', (x, 1.1, TZ), 1.15, 0.18, STONE, seg=32, rot=(0, 0, math.pi / 2)))
# steps up the side so you can climb it
for k, (x, h) in enumerate(((TX1 + 1.6, 0.7), (TX1 + 0.75, 1.35))):
    V(box('tunnel_step', (x, h / 2, TZ - 1.9), (0.9, h, 1.3), STONE, bevel=0.05))
    box('col_box_tunnel_step', (x, h / 2, TZ - 1.9), (0.9, h, 1.3))
V(box('tunnel_ledge', (TX1 - 0.3, 1.9, TZ - 1.9), (0.9, 0.2, 1.3), STONE, bevel=0.04))
box('col_box_tunnel_ledge', (TX1 - 0.3, 1.0, TZ - 1.9), (0.9, 2.0, 1.3))

# ---- the station: a raised platform on the front straight
SX, SZ = 0.0, R + 2.0
V(box('platform', (SX, 0.3, SZ), (6.5, 0.6, 1.6), WHITE, bevel=0.06))
box('col_box_platform', (SX, 0.3, SZ), (6.5, 0.6, 1.6))
V(box('platform_edge', (SX, 0.61, SZ - 0.82), (6.5, 0.03, 0.14), YEL))
V(box('station', (SX + 1.5, 1.4, SZ + 0.3), (2.4, 1.6, 0.8), RED, bevel=0.06))
V(box('station_roof', (SX + 1.5, 2.35, SZ + 0.3), (2.8, 0.25, 1.4), BLUE, bevel=0.08))
box('col_box_station', (SX + 1.5, 1.4, SZ + 0.3), (2.4, 1.6, 0.8))
V(cyl('clock_post', (SX - 2.4, 1.2, SZ), 0.08, 1.8, BLACK, seg=10))
V(cyl('station_clock', (SX - 2.4, 2.2, SZ), 0.35, 0.12, WHITE, seg=24, rot=(math.pi / 2, 0, 0)))
cyl('col_hull_post', (SX - 2.4, 1.2, SZ), 0.1, 2.4, None, seg=8)


# ---- the train: built facing +z, each car on its own mover
def wheels(node, w, l, m):
    for sx in (-1, 1):
        for sz in (-l, l):
            V(cyl('wheel', (sx * (w / 2 + 0.02), 0.32, sz), 0.3, 0.14, m, seg=20, rot=(0, 0, math.pi / 2), parent=node))
            V(cyl('hub', (sx * (w / 2 + 0.1), 0.32, sz), 0.1, 0.06, BRASS, seg=12, rot=(0, 0, math.pi / 2), parent=node))


eng = empty('mov_car_0', (0, 0, 0))
V(box('eng_base', (0, 0.45, 0), (1.3, 0.3, 2.6), BLACK, bevel=0.05, parent=eng))
V(cyl('eng_boiler', (0, 1.0, 0.35), 0.55, 1.9, RED, seg=28, rot=(math.pi / 2, 0, 0), parent=eng, bevel=0.04))
V(cyl('eng_front', (0, 1.0, 1.32), 0.5, 0.08, BLACK, seg=28, rot=(math.pi / 2, 0, 0), parent=eng))
V(cyl('eng_chimney', (0, 1.75, 0.95), 0.2, 0.6, BLACK, seg=16, r2=0.28, parent=eng))
V(cyl('eng_dome', (0, 1.6, 0.2), 0.24, 0.24, BRASS, seg=16, parent=eng))
V(box('eng_cab', (0, 1.25, -0.85), (1.3, 1.3, 0.95), BLUE, bevel=0.06, parent=eng))
V(box('eng_cab_roof', (0, 1.98, -0.85), (1.5, 0.14, 1.2), RED, bevel=0.05, parent=eng))
V(box('eng_window', (0.66, 1.45, -0.85), (0.02, 0.45, 0.5), WHITE, parent=eng))
V(box('eng_window', (-0.66, 1.45, -0.85), (0.02, 0.45, 0.5), WHITE, parent=eng))
V(box('eng_cow', (0, 0.42, 1.45), (1.2, 0.35, 0.35), YEL, bevel=0.08, rot=(-0.4, 0, 0), parent=eng))
V(box('eng_lamp', (0, 1.0, 1.4), (0.3, 0.3, 0.1), mat('lamp', (1, 0.95, 0.7), 0.3, emit=(1, 0.9, 0.5), emit_k=5.0), parent=eng))
key = empty('wind_key', (0, 1.35, -1.45), parent=eng)
V(cyl('key_shaft', (0, 0, -0.15), 0.06, 0.3, BRASS, seg=10, rot=(math.pi / 2, 0, 0), parent=key))
for s in (-1, 1):
    V(sphere('key_loop', (s * 0.3, 0, -0.32), 0.24, BRASS, seg=16, rings=10, scale=(1, 1, 0.3), parent=key))
wheels(eng, 1.3, 0.8, RED)
col_box('eng_base', (0, 0.75, 0.3), (1.3, 0.9, 2.2), parent=eng)
col_box('eng_cab', (0, 1.3, -0.85), (1.3, 1.4, 0.95), parent=eng)

for k, (m, trim) in enumerate(((YEL, GREEN), (GREEN, BLUE))):
    car = empty('mov_car_%d' % (k + 1), (0, 0, 0))
    V(box('car_base', (0, 0.45, 0), (1.3, 0.3, 2.3), BLACK, bevel=0.05, parent=car))
    V(box('car_floor', (0, 0.68, 0), (1.3, 0.16, 2.3), m, bevel=0.04, parent=car))
    col_box('car_floor', (0, 0.55, 0), (1.3, 0.4, 2.3), parent=car)
    if k == 0:
        # an open wagon with low sides: stand in it
        for s in (-1, 1):
            V(box('car_side', (s * 0.6, 0.98, 0), (0.1, 0.5, 2.3), trim, bevel=0.03, parent=car))
            col_box('car_side', (s * 0.6, 0.98, 0), (0.1, 0.5, 2.3), parent=car)
            V(box('car_end', (0, 0.98, s * 1.1), (1.3, 0.5, 0.1), trim, bevel=0.03, parent=car))
            col_box('car_end', (0, 0.98, s * 1.1), (1.3, 0.5, 0.1), parent=car)
    else:
        # a flat car with a crate strapped on
        V(box('car_crate', (0, 1.15, -0.45), (1.0, 0.8, 0.9), mat('crate', (0.8, 0.6, 0.35), 0.7), bevel=0.04, parent=car))
        col_box('car_crate', (0, 1.15, -0.45), (1.0, 0.8, 0.9), parent=car)
        V(box('car_strap', (0, 1.15, -0.45), (1.04, 0.84, 0.1), RED, parent=car))
    wheels(car, 1.3, 0.7, trim)

# ---- loose toy blocks
LET = 'ABCPOW'
for k in range(6):
    node = empty('dyn_block_%d' % k, ((-6.5, 7.0, -7.6, 6.2, 1.0, -0.8)[k], 0.45 + (0.9 if k == 5 else 0), (5.0, -4.5, -0.2, 0.6, 0.0, 0.0)[k]))
    m = (RED, BLUE, YEL, GREEN, RED, BLUE)[k]
    V(box('block', (0, 0, 0), (0.85, 0.85, 0.85), m, bevel=0.06, parent=node))
    for f, rot in (((0, 0, 0.43), (math.pi / 2, 0, 0)), ((0, 0, -0.43), (-math.pi / 2, 0, math.pi)), ((0.43, 0, 0), (math.pi / 2, math.pi / 2, 0)), ((-0.43, 0, 0), (math.pi / 2, -math.pi / 2, 0))):
        V(text('block_letter', LET[k], f, 0.55, WHITE, depth=0.02, rot=rot, parent=node))
    box('col_box_block', (0, 0, 0), (0.85, 0.85, 0.85), parent=node)
    node['mass'] = 10

# ---- the playroom
FY = -16.0
V(box('floor', (0, FY - 0.2, -5), (90, 0.4, 70), FLOOR))
box('col_box_floor', (0, FY - 0.2, -5), (90, 0.4, 70))
V(cyl('rug', (0, FY + 0.03, 0), 20, 0.06, RUG, seg=72))
for r in (17, 13):
    V(torus('rug_band', (0, FY + 0.06, 0), r, 0.35, RUG2, seg=72, rseg=6))
V(box('wall', (0, FY + 25, -32), (90, 50, 1), WALL))
stripes = []
for i in range(-22, 23):
    stripes.append(box('stripe', (i * 2.0, FY + 25, -31.45), (0.7, 50, 0.05), STRIPE))
V(join(stripes, 'wall_stripes'))
V(box('window', (-14, FY + 26, -31.3), (12, 14, 0.1), SKY))
V(box('window_frame', (-14, FY + 26, -31.2), (12.8, 0.6, 0.3), SHELF))
V(box('window_frame', (-14, FY + 26, -31.2), (0.6, 14.8, 0.3), SHELF))
V(box('shelf', (16, FY + 18, -29), (16, 0.6, 5), SHELF))
for k in range(5):
    V(box('book', (10 + k * 1.3, FY + 20.4, -29), (1.0, 4.2 + (k % 2) * 0.8, 3.5), (RED, BLUE, YEL, GREEN, RED)[k], bevel=0.05))
# a big teddy bear sitting by the table, watching
BX, BY, BZ = 17, FY, -12
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

# ---- spawns: round the felt, by the station, by the tunnel steps
SP = ((-2.6, 1.0, 0.0), (2.0, 1.0, -0.2), (-0.6, 1.0, 0.4), (4.6, 1.0, 0.6), (-1.6, 1.6, R + 2.0), (-0.2, 1.6, R + 1.9), (-9.2, 1.0, 4.5), (9.2, 1.0, -4.5))
for i, (x, y, z) in enumerate(SP):
    e = empty('spawn_%d' % i, (x, y, z))
    e.rotation_euler = (0, 0, math.atan2(x, -z) + math.pi)

bpy.context.view_layer.update()
big = [o for o in vis if o.name in ('table_top', 'track', 'felt', 'tunnel_roof', 'platform')]
bake_ao(big, distance=0.8, samples=16, dense=0.9)
export([o for o in bpy.data.objects], 'train')
