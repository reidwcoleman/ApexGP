# Hats for the plush fighters, one object each, built around the head's centre (the game hangs
# them on the head bone at the rest head centre (0, 1.61, 0)): the crown of the head is y = 0.29.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset()
TOP = 0.28
hats = []


def finish(name, objs):
    for o in objs:
        active(o)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    h = join(objs, 'hat_' + name)
    smooth(h, math.radians(35))
    hats.append(h)
    return h


RED = mat('h_red', (0.85, 0.12, 0.12), 0.5)
YEL = mat('h_yellow', (1.0, 0.78, 0.12), 0.5)
BLU = mat('h_blue', (0.12, 0.35, 0.9), 0.5)
WHT = mat('h_white', (0.95, 0.95, 0.93), 0.7)
BLK = mat('h_black', (0.05, 0.05, 0.06), 0.45)
GOLD = mat('h_gold', (1.0, 0.72, 0.25), 0.25, metal=1.0)
GEM = mat('h_gem', (0.9, 0.1, 0.3), 0.05)
GRN = mat('h_green', (0.2, 0.7, 0.3), 0.5)
ORG = mat('h_orange', (1.0, 0.42, 0.08), 0.45)
PINK = mat('h_pink', (1.0, 0.45, 0.7), 0.7, sheen=0.8)
KNIT = mat('h_knit', (0.15, 0.6, 0.85), 0.95, sheen=1.0)
KNIT2 = mat('h_knit2', (0.97, 0.94, 0.88), 0.95, sheen=1.0)
STRAW = mat('h_straw', (0.88, 0.72, 0.42), 0.85)
GREY = mat('h_grey', (0.55, 0.57, 0.62), 0.35, metal=0.6)

# party cone, striped
ps = []
for i in range(6):
    y0 = TOP - 0.02 + i * 0.065
    r0 = 0.15 * (1 - i / 6)
    r1 = 0.15 * (1 - (i + 1) / 6)
    ps.append(cyl('p', (0, y0 + 0.0325, 0), r0, 0.065, (YEL, BLU)[i % 2], seg=28, r2=max(0.004, r1)))
ps.append(sphere('pom', (0, TOP + 0.38, 0), 0.04, WHT, seg=16, rings=8))
finish('party', ps)

# crown
cr = [cyl('band', (0, TOP + 0.03, 0), 0.19, 0.08, GOLD, seg=40, cap=False)]
for i in range(8):
    a = i / 8 * math.tau
    cr.append(cyl('pt', (math.cos(a) * 0.185, TOP + 0.11, math.sin(a) * 0.185), 0.035, 0.09, GOLD, seg=8, r2=0.002))
    cr.append(sphere('gem', (math.cos(a) * 0.195, TOP + 0.04, math.sin(a) * 0.195), 0.022, GEM if i % 2 else BLU, seg=10, rings=6))
finish('crown', cr)

# beanie with a pompom, knit stripes
bn = []
for i in range(4):
    y = TOP - 0.1 + i * 0.05
    bn.append(cyl('b', (0, y, 0), 0.3 - i * 0.012, 0.05, KNIT if i % 2 == 0 else KNIT2, seg=36))
bn.append(sphere('dome', (0, TOP + 0.08, 0), 0.26, KNIT, scale=(1, 0.55, 1)))
bn.append(sphere('pom', (0, TOP + 0.21, 0), 0.075, KNIT2, seg=20, rings=10))
finish('beanie', bn)

# chef's toque
ch = [cyl('band', (0, TOP + 0.04, 0), 0.2, 0.12, WHT, seg=36)]
for i in range(6):
    a = i / 6 * math.tau
    ch.append(sphere('puff', (math.cos(a) * 0.12, TOP + 0.22, math.sin(a) * 0.12), 0.13, WHT, seg=18, rings=10))
ch.append(sphere('top', (0, TOP + 0.27, 0), 0.15, WHT, seg=18, rings=10))
finish('chef', ch)

# propeller cap (the propeller is its own object so the game can spin it)
pc = [sphere('cap', (0, TOP - 0.04, 0), 0.27, RED, scale=(1, 0.5, 1)), box('bill', (0, TOP - 0.06, 0.24), (0.3, 0.02, 0.16), BLU, bevel=0.01)]
pc.append(cyl('stem', (0, TOP + 0.13, 0), 0.012, 0.08, GOLD, seg=8))
finish('propeller', pc)
prop = [box('blade', (0, 0, 0), (0.42, 0.012, 0.06), YEL, bevel=0.005), cyl('hub', (0, 0, 0), 0.025, 0.03, GOLD, seg=12)]
for o in prop:
    active(o)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
pr = join(prop, 'spin_propeller')
pr.location = G(0, TOP + 0.175, 0)
hats.append(pr)

# traffic cone
tc = [box('base', (0, TOP - 0.02, 0), (0.42, 0.04, 0.42), ORG, bevel=0.01)]
for i in range(4):
    y0 = TOP + i * 0.09
    tc.append(cyl('c', (0, y0 + 0.045, 0), 0.15 - i * 0.032, 0.09, (ORG, WHT)[i % 2 if i < 3 else 0], seg=24, r2=0.15 - (i + 1) * 0.032 + 0.005))
finish('cone', tc)

# top hat
th = [cyl('brim', (0, TOP - 0.01, 0), 0.3, 0.02, BLK, seg=40, bevel=0.006), cyl('crown', (0, TOP + 0.15, 0), 0.17, 0.3, BLK, seg=36, r2=0.18),
      cyl('band', (0, TOP + 0.05, 0), 0.172, 0.05, RED, seg=36)]
finish('tophat', th)

# daisy (on the side)
dz = [sphere('mid', (0.16, TOP - 0.02, 0.06), 0.045, YEL, seg=14, rings=8)]
for i in range(9):
    a = i / 9 * math.tau
    dz.append(sphere('petal', (0.16 + math.cos(a) * 0.075, TOP - 0.02, 0.06 + math.sin(a) * 0.075), 0.045, WHT, seg=12, rings=6, scale=(1.4, 0.35, 0.8)))
finish('daisy', dz)

# straw sun hat
sh = [cyl('brim', (0, TOP - 0.03, 0), 0.42, 0.018, STRAW, seg=48, bevel=0.006), sphere('crown', (0, TOP + 0.02, 0), 0.22, STRAW, scale=(1, 0.6, 1)),
      cyl('ribbon', (0, TOP + 0.0, 0), 0.215, 0.04, PINK, seg=40)]
finish('sunhat', sh)

# viking-ish helmet with soft horns
vk = [sphere('dome', (0, TOP - 0.05, 0), 0.3, GREY, scale=(1, 0.62, 1)), cyl('rim', (0, TOP - 0.07, 0), 0.305, 0.05, GOLD, seg=40)]
for s in (1, -1):
    for i in range(5):
        t = i / 4
        vk.append(sphere('horn', (s * (0.27 + t * 0.12), TOP + t * 0.18, 0), 0.06 * (1 - t * 0.7), WHT, seg=12, rings=8))
finish('viking', vk)

# headphones
hp = [torus('band', (0, TOP - 0.06, 0), 0.32, 0.025, BLK, rot=(0, 0, math.pi / 2))]
for s in (1, -1):
    hp.append(cyl('cup', (s * 0.31, TOP - 0.26, 0), 0.1, 0.07, PINK, seg=24, rot=(0, 0, math.pi / 2), bevel=0.015))
finish('phones', hp)

# bucket hat
bk = [cyl('crown', (0, TOP + 0.04, 0), 0.24, 0.16, GRN, seg=36, r2=0.2), cyl('brim', (0, TOP - 0.06, 0), 0.34, 0.05, GRN, seg=40, r2=0.25)]
finish('bucket', bk)

# sailor cap
sl = [cyl('band', (0, TOP + 0.0, 0), 0.24, 0.07, WHT, seg=36), cyl('top', (0, TOP + 0.07, 0), 0.26, 0.05, WHT, seg=36, r2=0.27),
      cyl('stripe', (0, TOP - 0.01, 0), 0.243, 0.025, BLU, seg=36)]
finish('sailor', sl)

bake_ao([h for h in hats], distance=0.05, samples=16)
export(hats, 'hats')
