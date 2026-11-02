# CAKE WALK: a three-tier birthday cake on a turntable cake stand (mov_turntable carries the plate,
# the tiers and the candles). The icing rim on the bottom tier is slippery, the plate's lip is a
# ledge to hang off, and past it the kitchen counter is a long way down.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset()
random.seed(21)

PLATE = mat('porcelain', (0.96, 0.95, 0.93), 0.18, clearcoat=0.9)
GOLD = mat('gold', (1.0, 0.76, 0.33), 0.25, metal=1.0)
PINK = mat('icing_pink', (1.0, 0.62, 0.72), 0.55, sheen=0.4)
PINK2 = mat('icing_rose', (0.95, 0.38, 0.55), 0.5, sheen=0.4)
MINT = mat('icing_mint', (0.58, 0.9, 0.76), 0.55, sheen=0.4)
LEMON = mat('icing_lemon', (1.0, 0.9, 0.55), 0.55, sheen=0.4)
CREAM = mat('icing_cream', (1.0, 0.97, 0.9), 0.5, sheen=0.5)
CHOC = mat('chocolate', (0.32, 0.17, 0.09), 0.35, clearcoat=0.5)
BERRY = mat('strawberry', (0.9, 0.08, 0.14), 0.25, clearcoat=0.8)
SEED = mat('seed', (1.0, 0.86, 0.4), 0.5)
LEAF = mat('leaf', (0.25, 0.65, 0.22), 0.6)
WAX_A = mat('wax_blue', (0.35, 0.65, 1.0), 0.4, clearcoat=0.4)
WAX_B = mat('wax_white', (0.98, 0.98, 0.98), 0.4, clearcoat=0.4)
FLAME = mat('flame', (1.0, 0.7, 0.2), 0.5, emit=(1.0, 0.6, 0.15), emit_k=12.0)
WICK = mat('wick', (0.1, 0.08, 0.06), 0.8)
MAC = [mat('mac_' + k, c, 0.6, sheen=0.3) for k, c in (('lav', (0.75, 0.62, 0.95)), ('pist', (0.7, 0.88, 0.5)), ('pch', (1.0, 0.7, 0.55)), ('sky', (0.55, 0.8, 1.0)))]
SPRINK = [mat('spr_' + str(i), c, 0.4, clearcoat=0.5) for i, c in enumerate(((1, 0.3, 0.3), (0.3, 0.6, 1), (1, 0.85, 0.2), (0.4, 0.85, 0.4), (1, 1, 1), (0.85, 0.4, 1)))]
GLASS = mat('glass_stem', (0.85, 0.95, 1.0), 0.05, clearcoat=1.0)
MARBLE = mat('marble', (0.85, 0.83, 0.8), 0.25, clearcoat=0.6)
VEIN = mat('marble_vein', (0.62, 0.62, 0.66), 0.3)
WOOD = mat('cabinet', (0.55, 0.78, 0.82), 0.55)
WALLM = mat('wall_tile', (0.62, 0.84, 0.8), 0.35, clearcoat=0.3)
GROUT = mat('grout', (0.9, 0.88, 0.82), 0.8)
WINDOW = mat('window_sky', (0.75, 0.9, 1.0), 0.2, emit=(0.8, 0.92, 1.0), emit_k=2.4)
FRAME = mat('frame_white', (0.96, 0.96, 0.96), 0.4)
MIXER = mat('mixer_red', (0.88, 0.16, 0.2), 0.25, clearcoat=0.9)
STEEL = mat('steel', (0.82, 0.84, 0.88), 0.18, metal=1.0)
JAR = mat('jar_glass', (0.8, 0.9, 0.95), 0.08, clearcoat=1.0)
LID = mat('jar_lid', (0.95, 0.75, 0.2), 0.3, metal=0.6)
PIN = mat('rolling_pin', (0.85, 0.65, 0.42), 0.55)
vis = []


def V(o):
    vis.append(o)
    return o


tt = empty('mov_turntable', (0, 0, 0))

# ---- the plate (its lip is a ledge 1.2 m below the cake top)
V(cyl('plate', (0, -1.33, 0), 9.8, 0.26, PLATE, seg=96, parent=tt, bevel=0.06))
cyl('col_hull_plate', (0, -1.33, 0), 9.8, 0.26, None, seg=40, parent=tt)
V(torus('plate_rim', (0, -1.2, 0), 9.72, 0.07, GOLD, seg=96, rseg=8, parent=tt))
V(torus('plate_rim2', (0, -1.2, 0), 9.05, 0.035, GOLD, seg=96, rseg=6, parent=tt))

# ---- the tiers
TIERS = [('tier1', 8.4, -1.2, 1.2, PINK), ('tier2', 5.0, 0.0, 1.0, MINT), ('tier3', 2.4, 1.0, 0.9, LEMON)]
for name, r, y0, h, m in TIERS:
    V(cyl(name, (0, y0 + h / 2, 0), r, h, m, seg=96, parent=tt, bevel=0.08))
    cyl('col_hull_' + name, (0, y0 + h / 2, 0), r, h, None, seg=40, parent=tt)
    # a chocolate band round the bottom and drips of icing down the side
    V(torus(name + '_band', (0, y0 + 0.08, 0), r + 0.02, 0.09, CHOC, seg=96, rseg=8, parent=tt))
    n = int(r * 3.2)
    for i in range(n):
        a = i / n * math.tau + random.uniform(-0.05, 0.05)
        L = random.uniform(0.25, 0.6) * h
        V(sphere(name + '_drip', (math.cos(a) * (r + 0.01), y0 + h - L / 2, math.sin(a) * (r + 0.01)), 0.13, CREAM, seg=10, rings=6, scale=(1, 1, L / 0.26), parent=tt))
    # rosettes round the top edge (not on the bottom tier: that rim is the slippery icing)
    if name != 'tier1':
        n = int(r * 4.2)
        for i in range(n):
            a = i / n * math.tau
            V(cyl(name + '_rose', (math.cos(a) * (r - 0.2), y0 + h + 0.1, math.sin(a) * (r - 0.2)), 0.2, 0.22, PINK2 if i % 2 else CREAM, seg=8, r2=0.04, parent=tt))

# the slippery icing rim on the bottom tier (its own collider, a hair higher)
V(annulus('icing_rim', 7.65, 8.42, 0.08, CREAM, seg=96, parent=tt, c=(0, 0.02, 0)))
ic = annulus('col_mesh_icing', 7.65, 8.42, 0.08, None, seg=48, parent=tt, c=(0, 0.02, 0))
ic['slick'] = 0.8
for i in range(76):
    a = i / 76 * math.tau
    V(sphere('icing_bead', (math.cos(a) * 8.4, 0.05, math.sin(a) * 8.4), 0.13, CREAM, seg=10, rings=6, parent=tt))
# rosettes round the plate (the base border)
for i in range(66):
    a = i / 66 * math.tau
    V(cyl('base_rose', (math.cos(a) * 8.65, -1.07, math.sin(a) * 8.65), 0.24, 0.26, PINK2 if i % 3 else CREAM, seg=8, r2=0.05, parent=tt))

# ---- candles on the bottom tier: posts to grab, flames that sting
for i in range(6):
    a = i / 6 * math.tau + math.pi / 6
    x, z = math.cos(a) * 6.4, math.sin(a) * 6.4
    V(cyl('candle', (x, 0.75, z), 0.17, 1.5, WAX_A if i % 2 else WAX_B, seg=20, parent=tt))
    for k in range(4):
        V(cyl('candle_stripe', (x, 0.2 + k * 0.38, z), 0.175, 0.1, WAX_B if i % 2 else WAX_A, seg=20, parent=tt))
    cyl('col_hull_candle', (x, 0.75, z), 0.17, 1.5, None, seg=12, parent=tt)
    V(cyl('wick', (x, 1.58, z), 0.025, 0.16, WICK, seg=6, parent=tt))
    fl = sphere('flame_%d' % i, (x, 1.82, z), 0.13, FLAME, seg=12, rings=8, scale=(1, 1, 2.0), parent=tt)
    V(fl)

# ---- sprinkles on the tops (one mesh)
spr = []
for _ in range(260):
    t = random.random()
    if t < 0.55:
        r, y = random.uniform(1.0, 7.4), 0.005
        if r < 5.2:
            r, y = random.uniform(0.6, 4.6), 1.005
            if r < 2.5:
                y = 1.905
    else:
        r, y = random.uniform(0.3, 2.1), 1.905
    a = random.uniform(0, math.tau)
    spr.append(box('sprinkle', (math.cos(a) * r, y, math.sin(a) * r), (0.06, 0.03, 0.2), random.choice(SPRINK), rot=(0, random.uniform(0, math.pi), 0), parent=tt))
V(join(spr, 'sprinkles'))

# ---- loose things: a giant strawberry on top, macarons to throw
def strawberry(name, c, s):
    node = empty(name, c)
    V(sphere(name + '_body', (0, 0, 0), 0.55 * s, BERRY, scale=(1, 1, 1.25), parent=node))
    for k in range(18):
        a = k * 2.399
        yy = math.cos(k / 18 * math.pi * 0.9) * 0.55 * s
        rr = math.sqrt(max(0.0, 1 - (yy / (0.69 * s)) ** 2)) * 0.55 * s
        V(sphere(name + '_seed', (math.cos(a) * rr, -yy * 0.9, math.sin(a) * rr), 0.035 * s, SEED, seg=6, rings=4, parent=node))
    for k in range(5):
        a = k / 5 * math.tau
        V(box(name + '_leaf', (math.cos(a) * 0.2 * s, 0.62 * s, math.sin(a) * 0.2 * s), (0.42 * s, 0.04, 0.16 * s), LEAF, rot=(0, -a, 0.35), parent=node))
    sphere('col_hull_' + name, (0, 0, 0), 0.55 * s, None, seg=12, rings=8, scale=(1, 1, 1.25), parent=node)
    node['mass'] = 30
    return node


strawberry('dyn_berry', (0.4, 2.65, -0.2), 1.25)
for i in range(4):
    a = i / 4 * math.tau + 0.4
    node = empty('dyn_macaron_%d' % i, (math.cos(a) * 3.6, 1.35, math.sin(a) * 3.6) if i < 2 else (math.cos(a) * 6.9, 0.35, math.sin(a) * 6.9))
    m = MAC[i]
    V(cyl('mac_top', (0, 0.13, 0), 0.42, 0.14, m, seg=28, parent=node, bevel=0.05))
    V(cyl('mac_bot', (0, -0.13, 0), 0.42, 0.14, m, seg=28, parent=node, bevel=0.05))
    V(cyl('mac_fill', (0, 0, 0), 0.37, 0.12, CREAM, seg=28, parent=node))
    cyl('col_hull_mac', (0, 0, 0), 0.42, 0.4, None, seg=14, parent=node)
    node['mass'] = 8

# ---- the stand (fixed): a glass stem down to the counter
V(cyl('stem', (0, -5.6, 0), 1.0, 8.2, GLASS, seg=48, r2=0.7))
V(cyl('stem_top', (0, -1.6, 0), 3.2, 0.3, GLASS, seg=64, r2=1.2))
V(cyl('stem_foot', (0, -9.6, 0), 3.6, 0.5, GLASS, seg=64, r2=1.8))
cyl('col_hull_stem', (0, -5.6, 0), 1.0, 8.2, None, seg=16)

# ---- the kitchen: a marble counter far below, tiled wall, window, cabinets, mixer, jar, rolling pin
CY = -10.0
V(box('counter', (0, CY - 0.5, -6), (70, 1.0, 40), MARBLE, bevel=0.1))
box('col_box_counter', (0, CY - 0.5, -6), (70, 1.0, 40))
for i in range(14):
    x0, z0 = random.uniform(-30, 30), random.uniform(-24, 12)
    V(box('vein', (x0, CY + 0.005, z0), (random.uniform(4, 12), 0.01, 0.06), VEIN, rot=(0, random.uniform(0, math.pi), 0)))
WZ = -26.0
V(box('wall', (0, CY + 20, WZ), (80, 42, 0.5), GROUT))
tiles = []
for row in range(26):
    for col in range(-14, 14):
        x = col * 2.6 + (1.3 if row % 2 else 0)
        y = CY + 0.6 + row * 1.3
        if abs(x) < 9 and 8 < y - CY < 24:
            continue
        tiles.append(box('tile', (x, y, WZ + 0.3), (2.5, 1.2, 0.12), WALLM))
V(join(tiles, 'wall_tiles'))
V(box('window', (0, CY + 16, WZ + 0.2), (17, 15, 0.1), WINDOW))
for x in (-8.7, 0, 8.7):
    V(box('mullion', (x, CY + 16, WZ + 0.35), (0.5, 15.6, 0.3), FRAME))
for y in (CY + 8.3, CY + 16, CY + 23.7):
    V(box('transom', (0, y, WZ + 0.35), (17.9, 0.5, 0.3), FRAME))
for x in (-24, 24):
    V(box('cabinet', (x, CY + 27, WZ + 3), (16, 9, 6), WOOD, bevel=0.15))
    V(box('cab_low', (x * 1.2, CY - 9, 14), (30, 17, 10), WOOD, bevel=0.15))
# the stand mixer, off to one side
MX, MZ = -27, -15
V(box('mixer_base', (MX, CY + 0.8, MZ), (7, 1.6, 9), MIXER, bevel=0.6, seg=4))
V(box('mixer_neck', (MX, CY + 7, MZ - 3.2), (4.4, 11, 3.6), MIXER, bevel=1.2, seg=4))
V(box('mixer_head', (MX, CY + 13.2, MZ - 0.5), (5.2, 4.2, 10), MIXER, bevel=1.6, seg=4))
V(cyl('mixer_bowl', (MX, CY + 4.2, MZ + 1.3), 3.3, 5.4, STEEL, seg=48, r2=4.2, bevel=0.1))
V(cyl('mixer_beater', (MX, CY + 8.5, MZ + 1.3), 0.4, 5, STEEL, seg=12))
# a jar of sprinkles and a rolling pin
JX, JZ = 26, -19
V(cyl('jar', (JX, CY + 5, JZ), 4.0, 10, JAR, seg=48, bevel=0.3))
V(cyl('jar_lid', (JX, CY + 10.4, JZ), 4.2, 1.0, LID, seg=48, bevel=0.15))
jar_s = []
for _ in range(180):
    a, r = random.uniform(0, math.tau), random.uniform(0, 3.6)
    jar_s.append(box('jar_spr', (JX + math.cos(a) * r, CY + random.uniform(0.3, 7.5), JZ + math.sin(a) * r), (0.3, 0.15, 0.9), random.choice(SPRINK), rot=(random.uniform(0, 3), random.uniform(0, 3), 0)))
V(join(jar_s, 'jar_sprinkles'))
V(cyl('pin', (14, CY + 1.3, 6), 1.3, 16, PIN, seg=40, rot=(0, 0.5, math.pi / 2), bevel=0.2))
for s in (-1, 1):
    V(cyl('pin_handle', (14 + s * 9.6 * math.cos(0.5), CY + 1.3, 6 - s * 9.6 * math.sin(0.5)), 0.55, 3.4, PIN, seg=24, rot=(0, 0.5, math.pi / 2), bevel=0.15))

# ---- spawns: round the bottom tier between the candles, and on the middle tier
for i in range(8):
    if i < 5:
        a = i / 5 * math.tau
        x, y, z = math.cos(a) * 5.9, 1.0, math.sin(a) * 5.9
    else:
        a = (i - 5) / 3 * math.tau + 0.5
        x, y, z = math.cos(a) * 3.5, 2.0, math.sin(a) * 3.5
    e = empty('spawn_%d' % i, (x, y, z))
    e.rotation_euler = (0, 0, math.atan2(x, -z) + math.pi)

bpy.context.view_layer.update()
big = [o for o in vis if o.name in ('tier1', 'tier2', 'tier3', 'plate', 'icing_rim')]
bake_ao(big, distance=0.9, samples=16, dense=0.9)
export([o for o in bpy.data.objects], 'cake')
