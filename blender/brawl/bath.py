# SPLASH TUB: a giant clawfoot bathtub. Fighters stand on the rim and on floating toys (dyn_: a
# rubber duck, soap bars, a sponge, a toy boat) that the game keeps afloat; fall in the water and
# you're out. A faucet pours in at one end, the drain swirls at the other.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset()
random.seed(5)

ENAMEL = mat('enamel', (0.97, 0.97, 0.95), 0.18, clearcoat=1.0)
ENAMEL_OUT = mat('enamel_out', (0.55, 0.78, 0.86), 0.25, clearcoat=0.8)
WATER = mat('water', (0.35, 0.72, 0.9), 0.04)
CHROME = mat('chrome', (0.92, 0.92, 0.95), 0.08, metal=1.0)
GOLD = mat('gold', (1.0, 0.76, 0.32), 0.2, metal=1.0)
DUCK = mat('duck', (1.0, 0.82, 0.08), 0.3, clearcoat=0.6)
BEAK = mat('beak', (1.0, 0.42, 0.05), 0.3, clearcoat=0.6)
EYE = mat('eye_black', (0.02, 0.02, 0.03), 0.1, clearcoat=1.0)
EYE_W = mat('eye_white', (1, 1, 1), 0.2)
SOAP = mat('soap_pink', (1.0, 0.62, 0.75), 0.15, clearcoat=0.8)
SOAP2 = mat('soap_mint', (0.6, 0.95, 0.82), 0.15, clearcoat=0.8)
SPONGE = mat('sponge', (1.0, 0.86, 0.28), 0.95)
SPONGE_G = mat('sponge_green', (0.3, 0.7, 0.3), 0.9)
BOAT = mat('boat_red', (0.9, 0.18, 0.15), 0.35, clearcoat=0.6)
BOAT_W = mat('boat_white', (0.96, 0.96, 0.94), 0.35)
TILE_A = mat('tile_a', (0.97, 0.97, 0.98), 0.2, clearcoat=0.5)
TILE_B = mat('tile_b', (0.2, 0.55, 0.75), 0.2, clearcoat=0.5)
WALLT = mat('wall_tile', (0.85, 0.93, 0.95), 0.3, clearcoat=0.4)
FOAM = mat('foam', (1, 1, 1), 0.6, sheen=0.5)
TOWEL = mat('towel', (1.0, 0.55, 0.45), 0.95, sheen=1.0)
TOWEL2 = mat('towel2', (1.0, 0.95, 0.85), 0.95, sheen=1.0)
BOTTLES = [mat('bottle_%d' % k, c, 0.2, clearcoat=0.8) for k, c in enumerate(((0.3, 0.5, 0.95), (0.95, 0.4, 0.6), (0.4, 0.85, 0.5), (1.0, 0.75, 0.3)))]
SKY = mat('window_sky', (0.75, 0.9, 1.0), 0.3, emit=(0.8, 0.92, 1.0), emit_k=2.5)
PLANT = mat('plant', (0.2, 0.6, 0.25), 0.7)
POT = mat('pot', (0.85, 0.45, 0.3), 0.7)
vis = []


def V(o):
    vis.append(o)
    return o


A, B = 9.0, 5.6       # inside of the rim
RIM_Y = 1.2
n = 72
# ---- the tub: the rim, the bowl inside (collision is the bowl itself), the outside down to claw feet
W_RIM = 1.5
rim_in = ell_pts(A, B, n)
rim_out = ell_pts(A + W_RIM, B + W_RIM, n)
RIM = [(rim_in, RIM_Y - 0.2), (ell_pts(A + 0.1, B + 0.1, n), RIM_Y - 0.03), (ell_pts(A + 0.25, B + 0.25, n), RIM_Y), (ell_pts(A + W_RIM - 0.25, B + W_RIM - 0.25, n), RIM_Y), (ell_pts(A + W_RIM - 0.1, B + W_RIM - 0.1, n), RIM_Y - 0.03), (rim_out, RIM_Y - 0.2)]
V(loft('rim', RIM, ENAMEL))
loft('col_mesh_rim', RIM)
bowl = [(rim_in, RIM_Y - 0.15), (ell_pts(A - 0.15, B - 0.15, n), 0.2), (ell_pts(A - 0.7, B - 0.7, n), -1.6), (ell_pts(A - 1.5, B - 1.4, n), -2.8), (ell_pts(A - 2.4, B - 2.2, n), -3.2)]
V(loft('bowl', bowl, ENAMEL, cap_last=True, flip=True))
loft('col_mesh_bowl', bowl, cap_last=True, flip=True)
V(loft('tub_out', [(rim_out, RIM_Y - 0.2), (ell_pts(A + W_RIM - 0.05, B + W_RIM - 0.05, n), -1.0), (ell_pts(A + W_RIM - 0.5, B + W_RIM - 0.5, n), -3.4), (ell_pts(A + 0.3, B + 0.2, n), -4.4)], ENAMEL_OUT, cap_last=True))
for sx in (1, -1):
    for sz in (1, -1):
        x, z = sx * (A - 1.6), sz * (B - 1.2)
        V(sphere('foot', (x, -5.6, z), 0.9, GOLD, scale=(1, 1.4, 1)))
        V(cyl('foot_leg', (x, -4.6, z), 0.45, 1.6, GOLD, seg=20))
        for k in range(3):
            a = k / 3 * math.tau
            V(sphere('claw', (x + math.cos(a) * 0.7, -6.6, z + math.sin(a) * 0.7), 0.35, GOLD))

# ---- a wooden bath caddy across the middle (a book and a candle on it)
WOODC = mat('caddy', (0.78, 0.56, 0.32), 0.5, clearcoat=0.3)
CX = -1.2
V(box('caddy', (CX, RIM_Y + 0.14, 0), (3.4, 0.28, 2 * B + 2.4), WOODC, bevel=0.06))
box('col_box_caddy', (CX, RIM_Y + 0.14, 0), (3.4, 0.28, 2 * B + 2.4))
for s_ in (1, -1):
    V(box('caddy_lip', (CX + s_ * 1.65, RIM_Y + 0.38, 0), (0.12, 0.25, 2 * B - 1.0), WOODC, bevel=0.03))
for k in range(-4, 5):
    V(box('caddy_slot', (CX, RIM_Y + 0.285, k * 1.2), (3.0, 0.01, 0.12), mat('caddy_dark', (0.5, 0.33, 0.18), 0.6)))
V(box('book', (CX + 0.2, RIM_Y + 0.45, -3.4), (1.6, 0.35, 1.2), BOTTLES[1], bevel=0.04))
box('col_box_book', (CX + 0.2, RIM_Y + 0.45, -3.4), (1.6, 0.35, 1.2))
V(box('book_pages', (CX + 0.25, RIM_Y + 0.45, -3.4), (1.5, 0.28, 1.12), BOAT_W))
V(cyl('candle', (CX - 0.3, RIM_Y + 0.75, 3.5), 0.35, 0.9, mat('candle', (1.0, 0.92, 0.8), 0.6), seg=24))
V(cyl('flame', (CX - 0.3, RIM_Y + 1.35, 3.5), 0.1, 0.3, mat('flame', (1, 0.7, 0.3), 0.5, emit=(1, 0.65, 0.2), emit_k=8), seg=12, r2=0.01))
cyl('col_hull_candle', (CX - 0.3, RIM_Y + 0.75, 3.5), 0.35, 0.9, None, seg=12)

# ---- water (the game animates it and makes it see-through), foam, the drain swirl
V(flat_shape('water', ell_pts(A - 0.1, B - 0.1, n), (0, -0.02, 0), WATER, depth=0.02))
DRAIN = (6.2, -1.6)
for i in range(26):
    a = random.uniform(0, math.tau)
    r = random.uniform(0, 1)
    x, z = math.cos(a) * (A - 1.2) * math.sqrt(r), math.sin(a) * (B - 1.0) * math.sqrt(r)
    if math.hypot(x - DRAIN[0], z - DRAIN[1]) < 2:
        continue
    cl = empty('foam_%d' % i, (x, 0.0, z))
    for k in range(random.randint(3, 6)):
        V(sphere('bubble', (random.uniform(-0.6, 0.6), random.uniform(0.0, 0.15), random.uniform(-0.6, 0.6)), random.uniform(0.15, 0.4), FOAM, seg=14, rings=8, scale=(1, 0.6, 1), parent=cl))
swirl = empty('swirl', (DRAIN[0], 0.02, DRAIN[1]))
for k in range(3):
    pts = []
    for i in range(30):
        a = i / 30 * math.pi * 1.6 + k * math.tau / 3
        r = 0.3 + i / 30 * 1.6
        pts.append((math.cos(a) * r, math.sin(a) * r))
    for i in range(len(pts) - 1):
        (x0, z0), (x1, z1) = pts[i], pts[i + 1]
        V(box('swirl_seg', ((x0 + x1) / 2, 0, (z0 + z1) / 2), (math.hypot(x1 - x0, z1 - z0) + 0.05, 0.02, 0.08 + i * 0.004), FOAM, rot=(0, -math.atan2(z1 - z0, x1 - x0), 0), parent=swirl))

# ---- the faucet at the far end, the stream it pours
FX = -A - 0.4
V(cyl('tap_base', (FX, RIM_Y + 0.2, 0), 0.5, 0.4, CHROME, seg=32))
V(cyl('tap_pipe', (FX, RIM_Y + 2.0, 0), 0.32, 3.4, CHROME, seg=24))
V(cyl('tap_spout', (FX + 1.2, RIM_Y + 3.6, 0), 0.3, 2.6, CHROME, seg=24, rot=(0, 0, math.pi / 2)))
V(sphere('tap_elbow', (FX, RIM_Y + 3.6, 0), 0.34, CHROME))
V(cyl('tap_mouth', (FX + 2.45, RIM_Y + 3.4, 0), 0.32, 0.5, CHROME, seg=24))
cyl('col_hull_tap', (FX, RIM_Y + 2.0, 0), 0.35, 3.4, None, seg=12)
for s in (1, -1):
    V(cyl('tap_knob', (FX, RIM_Y + 2.6, s * 1.0), 0.35, 0.3, CHROME, seg=6, rot=(math.pi / 2, 0, 0), bevel=0.05))
    V(cyl('tap_knob_cap', (FX, RIM_Y + 2.6, s * 1.18), 0.18, 0.06, BOTTLES[0] if s > 0 else BOTTLES[1], seg=16, rot=(math.pi / 2, 0, 0)))
stream = empty('stream', (FX + 2.45, 0, 0))
V(cyl('stream_col', (0, (RIM_Y + 3.15) / 2, 0), 0.22, RIM_Y + 3.15, WATER, seg=20, parent=stream, cap=False))

# ---- floating toys (dyn_: the game floats them; mass and the float box in custom props)
def toy(name, c, mass, hx, hy, hz):
    d = empty('dyn_' + name, c)
    d['mass'] = mass
    d['fx'], d['fy'], d['fz'] = hx, hy, hz
    return d


duck = toy('duck', (-5.0, 0.6, 1.4), 520.0, 2.0, 0.9, 1.2)
V(sphere('duck_body', (0, 0.2, 0), 1.3, DUCK, scale=(1.75, 0.85, 1.15), parent=duck))
V(sphere('duck_tail', (-1.9, 0.75, 0), 0.5, DUCK, scale=(1.2, 1.0, 0.8), parent=duck))
V(sphere('duck_head', (1.55, 1.75, 0), 0.82, DUCK, parent=duck))
V(sphere('duck_beak', (2.35, 1.6, 0), 0.42, BEAK, scale=(1.4, 0.45, 0.9), parent=duck))
for s in (1, -1):
    V(sphere('duck_eye_w', (2.0, 2.0, s * 0.42), 0.22, EYE_W, parent=duck))
    V(sphere('duck_eye', (2.12, 2.03, s * 0.48), 0.12, EYE, parent=duck))
    V(sphere('duck_wing', (0.0, 0.55, s * 1.2), 0.6, DUCK, scale=(1.3, 0.6, 0.35), parent=duck))
sphere('col_hull_duck_body', (0, 0.2, 0), 1.3, None, seg=16, rings=8, scale=(1.75, 0.85, 1.15), parent=duck)
sphere('col_hull_duck_head', (1.55, 1.75, 0), 0.82, None, seg=12, rings=6, parent=duck)

for i, (x, z, m) in enumerate(((2.6, 2.6, SOAP), (2.0, -2.8, SOAP2))):
    s = toy('soap_%d' % i, (x, 0.3, z), 180.0, 1.2, 0.35, 0.75)
    s['slick'] = 1.0
    V(box('soap', (0, 0, 0), (2.4, 0.7, 1.5), m, bevel=0.3, seg=4, parent=s))
    V(box('soap_inset', (0, 0.36, 0), (1.6, 0.04, 0.9), m, bevel=0.1, seg=3, parent=s))
    col = box('col_box_soap_%d' % i, (0, 0, 0), (2.4, 0.7, 1.5), parent=s)
    col['slick'] = 1.0
    col['friction'] = 0.03

sp = toy('sponge', (-5.4, 0.3, -2.6), 140.0, 1.3, 0.45, 0.9)
V(box('sponge', (0, 0, 0), (2.6, 0.9, 1.8), SPONGE, bevel=0.12, seg=3, parent=sp))
V(box('sponge_scrub', (0, -0.3, 0), (2.62, 0.3, 1.82), SPONGE_G, bevel=0.08, seg=2, parent=sp))
for k in range(14):
    V(sphere('pore', (random.uniform(-1.1, 1.1), 0.45, random.uniform(-0.75, 0.75)), random.uniform(0.06, 0.13), SPONGE_G, seg=10, rings=6, scale=(1, 0.3, 1), parent=sp))
box('col_box_sponge', (0, 0, 0), (2.6, 0.9, 1.8), parent=sp)

bt = toy('boat', (4.5, 0.35, -1.0), 260.0, 1.6, 0.45, 0.8)
hull = [(-1.6, -0.7), (1.0, -0.7), (1.8, 0.0), (1.0, 0.7), (-1.6, 0.7)]
V(flat_shape('boat_hull', hull, (0, -0.4, 0), BOAT, depth=0.8, parent=bt))
V(flat_shape('boat_deck', [(x * 0.92, z * 0.88) for x, z in hull], (0, 0.4, 0), BOAT_W, depth=0.06, parent=bt))
V(box('boat_cabin', (-0.4, 0.75, 0), (1.1, 0.7, 0.9), BOAT_W, bevel=0.1, parent=bt))
V(cyl('boat_funnel', (-0.4, 1.35, 0), 0.22, 0.7, BOAT, seg=16, parent=bt))
flat_shape('col_hull_boat', hull, (0, -0.4, 0), None, depth=0.86, parent=bt)

# ---- the bathroom: checker floor, tiled walls, a window, shelves, a towel, a plant
for i in range(-6, 7):
    for j in range(-6, 7):
        V(box('floor_tile', (i * 4, -6.95, j * 4), (4, 0.1, 4), TILE_A if (i + j) % 2 == 0 else TILE_B))
V(box('wall_back', (0, 6, -16), (60, 26, 0.5), WALLT))
for k in range(-7, 8):
    V(box('grout_v', (k * 4, 6, -15.74), (0.08, 26, 0.02), TILE_B))
for k in range(-1, 7):
    V(box('grout_h', (0, k * 4 - 1, -15.74), (60, 0.08, 0.02), TILE_B))
V(box('trim', (0, -5.2, -15.7), (60, 0.6, 0.1), TILE_B))
V(box('window', (-11, 10, -15.7), (8, 6, 0.1), SKY))
for s in (1, -1):
    V(box('win_frame_v', (-11 + s * 4.1, 10, -15.6), (0.3, 6.4, 0.3), TILE_A))
    V(box('win_frame_h', (-11, 10 + s * 3.1, -15.6), (8.5, 0.3, 0.3), TILE_A))
V(box('win_cross', (-11, 10, -15.6), (0.2, 6, 0.2), TILE_A))
V(box('shelf', (8, 6.0, -15.2), (10, 0.25, 1.4), TILE_A))
for k in range(5):
    x = 4.2 + k * 1.9
    h = random.uniform(1.4, 2.6)
    V(cyl('bottle', (x, 6.1 + h / 2, -15.2), 0.5, h, BOTTLES[k % 4], seg=24, bevel=0.1))
    V(cyl('bottle_cap', (x, 6.1 + h + 0.2, -15.2), 0.25, 0.4, BOTTLES[(k + 2) % 4], seg=16))
V(cyl('towel_bar', (14, 2, -15.3), 0.12, 7, CHROME, seg=12, rot=(0, 0, math.pi / 2)))
V(box('towel', (14, -0.6, -15.1), (5.2, 5.0, 0.3), TOWEL, bevel=0.1))
for k in range(3):
    V(box('towel_stripe', (14, -2.0 + k * 0.4, -14.93), (5.2, 0.18, 0.05), TOWEL2))
V(cyl('pot', (-17, -5.4, -11), 1.6, 3, POT, seg=32, r2=1.9, bevel=0.1))
for k in range(9):
    a = k / 9 * math.tau
    V(sphere('leaf', (-17 + math.cos(a) * 1.4, -2.4 + random.uniform(0, 2.4), -11 + math.sin(a) * 1.4), 1.0, PLANT, scale=(0.5, 1.4, 0.5)))

# ---- spawns: the rim and the toys
SP = [(-1.2, RIM_Y + 1.0, 1.6), (-1.2, RIM_Y + 1.0, -1.4), (-1.2, RIM_Y + 1.0, 4.8), (A + 0.75, RIM_Y + 0.9, 0), (3.0, RIM_Y + 0.9, B + 0.75),
      (3.0, RIM_Y + 0.9, -(B + 0.75)), (-5.5, RIM_Y + 0.9, B + 0.75), (-5.5, RIM_Y + 0.9, -(B + 0.75))]
for i, (x, y, z) in enumerate(SP):
    e = empty('spawn_%d' % i, (x, y, z))
    e.rotation_euler = (0, 0, math.atan2(x, -z) + math.pi)

bpy.context.view_layer.update()
big = [o for o in vis if o.name.startswith(('rim', 'bowl', 'tub_out', 'duck_body', 'sponge', 'soap', 'wall_back'))]
bake_ao(big, distance=0.8, samples=16, dense=0.9)
export([o for o in bpy.data.objects], 'bath')
