# SPIN CYCLE: inside a giant front-loading washing machine. The drum (mov_drum) turns about the
# z axis, its three paddles carry you up the wall and drop you; the rubber door seal at the front
# is a lip to throw people over, and below the door it's a long slide to the laundromat floor.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset()
random.seed(5)

STEEL = mat('drum_steel', (0.78, 0.8, 0.84), 0.28, metal=1.0)
HOLE = mat('drum_hole', (0.08, 0.09, 0.11), 0.6)
PADDLE = mat('paddle', (0.86, 0.88, 0.92), 0.2, metal=0.8)
RUBBER = mat('rubber', (0.42, 0.46, 0.52), 0.75)
BODY = mat('machine_body', (0.96, 0.96, 0.95), 0.3, clearcoat=0.8)
TRIM = mat('machine_trim', (0.55, 0.78, 0.95), 0.3, clearcoat=0.6)
CHROME = mat('chrome', (0.9, 0.9, 0.92), 0.12, metal=1.0)
GLASS = mat('door_glass', (0.7, 0.85, 0.95), 0.05, clearcoat=1.0, alpha=0.35)
DISPLAY = mat('display', (0.1, 0.9, 0.7), 0.4, emit=(0.15, 1.0, 0.75), emit_k=4.0)
DARK = mat('panel_dark', (0.12, 0.13, 0.16), 0.4)
LAMP = mat('drum_lamp', (1.0, 0.95, 0.85), 0.3, emit=(1.0, 0.92, 0.8), emit_k=6.0)
FLOOR_A = mat('floor_a', (0.95, 0.92, 0.85), 0.5)
FLOOR_B = mat('floor_b', (0.32, 0.6, 0.66), 0.5)
WALL = mat('wall', (0.98, 0.84, 0.62), 0.85)
BASKET = mat('basket', (0.95, 0.45, 0.4), 0.5)
BOTTLE = mat('bottle', (0.35, 0.45, 0.95), 0.25, clearcoat=0.8)
CAP = mat('bottle_cap', (1.0, 0.85, 0.2), 0.3)
BUBBLE = mat('bubble', (0.9, 0.95, 1.0), 0.05, clearcoat=1.0, alpha=0.3)
SOCKS = [mat('sock_' + k, c, 0.9, sheen=0.25) for k, c in (('red', (0.9, 0.25, 0.25)), ('stripe', (0.98, 0.85, 0.3)), ('blue', (0.3, 0.5, 0.95)), ('green', (0.35, 0.8, 0.45)))]
TOWEL = mat('towel', (0.98, 0.6, 0.75), 0.95, sheen=0.3)
vis = []


def V(o):
    vis.append(o)
    return o


RD = 5.5           # drum radius (inside)
DZ = 7.5           # drum depth
AX = (0.0, RD, -DZ / 2)   # the axis centre: the drum floor is at y = 0


def tube(name, r, z0, z1, n, material, parent=None):
    """an open cylinder about the z axis, in the parent's frame"""
    bm = bmesh.new()
    a0 = [bm.verts.new(G(math.cos(i / n * math.tau) * r, math.sin(i / n * math.tau) * r, z0)) for i in range(n)]
    a1 = [bm.verts.new(G(math.cos(i / n * math.tau) * r, math.sin(i / n * math.tau) * r, z1)) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a0[i], a1[i], a1[j], a0[j]))
    o = obj_from_bm(bm, name, material, parent)
    smooth(o)
    return o


def disc_z(name, c, r, h, material, seg=32, parent=None):
    """a cylinder lying along the z axis"""
    return cyl(name, c, r, h, material, seg=seg, rot=(math.pi / 2, 0, 0), parent=parent)


drum = empty('mov_drum', AX)
V(tube('drum_shell', RD, -DZ / 2, DZ / 2, 96, STEEL, parent=drum))
V(tube('drum_shell_out', RD + 0.45, -DZ / 2, DZ / 2, 64, STEEL, parent=drum))
V(torus('drum_lip', (0, 0, DZ / 2), RD + 0.22, 0.24, CHROME, seg=96, rot=(math.pi / 2, 0, 0), parent=drum))
# the perforations (one mesh)
holes = []
for k in range(7):
    z = -DZ / 2 + 0.7 + k * (DZ - 1.4) / 6
    for i in range(54):
        a = (i + (k % 2) * 0.5) / 54 * math.tau
        holes.append(cyl('hole', (math.cos(a) * (RD - 0.005), math.sin(a) * (RD - 0.005), z), 0.09, 0.02, HOLE, seg=10, rot=(0, 0, a + math.pi / 2), parent=drum))
V(join(holes, 'drum_holes'))
# its collision: a ring of slabs (solid, nothing tunnels through)
N = 48
for i in range(N):
    a = (i + 0.5) / N * math.tau
    w = 2 * (RD + 0.3) * math.sin(math.pi / N) + 0.06
    col_box('drum', (math.cos(a) * (RD + 0.3), math.sin(a) * (RD + 0.3), 0), (0.6, w, DZ), rot=(0, 0, a), parent=drum)
# the back wall, with a star-shaped hub
V(disc_z('drum_back', (0, 0, -DZ / 2 - 0.15), RD + 0.2, 0.3, STEEL, seg=96, parent=drum))
disc_z('col_hull_back', (0, 0, -DZ / 2 - 0.15), RD + 0.2, 0.3, None, seg=32, parent=drum)
for i in range(3):
    a = i / 3 * math.tau + math.pi / 2
    V(box('back_spoke', (math.cos(a) * 1.9, math.sin(a) * 1.9, -DZ / 2 + 0.02), (3.4, 0.7, 0.08), PADDLE, rot=(0, 0, a), parent=drum))
V(disc_z('back_hub', (0, 0, -DZ / 2 + 0.05), 1.0, 0.12, CHROME, seg=48, parent=drum))
# three paddles along the drum (they lift you up the side)
for i in range(3):
    a = i / 3 * math.tau - math.pi / 2
    c = (math.cos(a) * (RD - 0.32), math.sin(a) * (RD - 0.32), 0.0)
    V(box('paddle_%d' % i, c, (0.75, 0.62, DZ - 0.4), PADDLE, bevel=0.18, seg=3, rot=(0, 0, a), parent=drum))
    col_box('paddle', c, (0.75, 0.62, DZ - 0.4), rot=(0, 0, a), parent=drum)

# ---- the door seal (fixed): a rubber lip at the front, 1.5 m tall at the bottom
SZ = 0.35
V(torus('seal', (0, RD, SZ), RD - 0.65, 0.68, RUBBER, seg=96, rseg=20, rot=(math.pi / 2, 0, 0)))
for i in range(N):
    a = (i + 0.5) / N * math.tau
    rm = (RD - 1.45 + RD + 0.4) / 2
    w = 2 * rm * math.sin(math.pi / N) + 0.12
    col_box('seal', (math.cos(a) * rm, RD + math.sin(a) * rm, SZ), (RD + 0.4 - (RD - 1.45), w, 0.9), rot=(0, 0, a))

# ---- the machine: a front panel with the round hole, a control strip, the door swung open
PZ = 0.95
panel = box('front_panel', (0, 0, PZ), (17, 30, 0.6), BODY, bevel=0.3, seg=3)
cut = cyl('cutter', (0, RD, PZ), RD + 0.15, 3.0, None, seg=96, rot=(math.pi / 2, 0, 0))
modifier(panel, 'BOOLEAN', operation='DIFFERENCE', object=cut)
bpy.data.objects.remove(cut)
V(panel)
box('col_box_panel_low', (0, -7.6, PZ), (17, 14.6, 0.6))
V(torus('panel_ring', (0, RD, PZ + 0.32), RD + 0.35, 0.22, TRIM, seg=96, rot=(math.pi / 2, 0, 0)))
V(box('control_strip', (0, 13.0, PZ + 0.35), (16, 2.6, 0.2), DARK, bevel=0.1))
V(box('display_bg', (2.5, 13.0, PZ + 0.47), (4.2, 1.5, 0.06), DARK))
V(text('display', 'SPIN 1400', (2.5, 13.0, PZ + 0.52), 0.85, DISPLAY, depth=0.02, rot=(math.pi / 2, 0, 0)))
for k, x in enumerate((-6, -3.5)):
    V(cyl('dial', (x, 13.0, PZ + 0.6), 0.85, 0.5, CHROME, seg=40, rot=(math.pi / 2, 0, 0), bevel=0.06))
    V(box('dial_mark', (x, 13.4, PZ + 0.87), (0.12, 0.55, 0.05), DARK))
for k in range(4):
    V(cyl('wash_light_%d' % k, (6.0 + k * 0.85, 13.0, PZ + 0.48), 0.22, 0.1, TRIM, seg=16, rot=(math.pi / 2, 0, 0)))
V(text('brand', 'SUDSY', (-6.2, 11.4, PZ + 0.32), 0.9, TRIM, depth=0.04, rot=(math.pi / 2, 0, 0)))
# the door, swung open to the left
door = empty('door', (-RD - 0.7, RD, PZ + 0.4))
door.rotation_euler = (0, 0, math.radians(-115))
V(torus('door_ring', (RD + 0.2, 0, 0), RD + 0.1, 0.42, CHROME, seg=96, rot=(math.pi / 2, 0, 0), parent=door))
V(disc_z('door_glass', (RD + 0.2, 0, 0.05), RD, 0.15, GLASS, seg=96, parent=door))
V(box('door_handle', (2 * RD + 0.5, 0, 0.3), (0.5, 2.4, 0.5), CHROME, bevel=0.2, parent=door))
# the drum lamp up top
V(box('lamp_bar', (0, 2 * RD + 0.3, -1.2), (3.2, 0.12, 0.5), LAMP))
# the machine's sides and top, and the tub around the drum (it's dark in there)
V(box('machine_top', (0, 15.2, -6.5), (17, 0.6, 15.6), BODY, bevel=0.2))
for s in (-1, 1):
    V(box('machine_side', (s * 8.2, 0, -6.5), (0.6, 30, 15.6), BODY))
tubn = empty('tub_axis', (0, RD, 0))
V(tube('tub', RD + 1.1, -DZ - 0.6, 0.4, 64, DARK, parent=tubn))

# ---- the laundromat
FY = -15.0
tiles = []
for i in range(-10, 11):
    for j in range(-8, 6):
        tiles.append(box('ftile', (i * 4, FY, j * 4), (4, 0.2, 4), FLOOR_A if (i + j) % 2 else FLOOR_B))
V(join(tiles, 'floor'))
box('col_box_floor', (0, FY, -6), (90, 0.2, 60))
V(box('back_wall', (0, FY + 25, -36), (90, 50, 1), WALL))
# the other machines in the row
for k, x in enumerate((-19, 19)):
    V(box('mach2_body', (x, 0, -6), (17, 30, 14), BODY, bevel=0.3))
    V(torus('mach2_ring', (x, RD, 1.05), RD + 0.2, 0.5, CHROME, seg=64, rot=(math.pi / 2, 0, 0)))
    V(disc_z('mach2_glass', (x, RD, 1.0), RD, 0.1, mat('mach2_glass_%d' % k, (0.35, 0.55, 0.85) if k else (0.95, 0.55, 0.65), 0.1, clearcoat=1.0), seg=64))
    V(box('mach2_strip', (x, 13.0, 1.1), (16, 2.6, 0.2), DARK))
# a laundry basket and a detergent bottle on the floor
V(cyl('basket', (-9, FY + 3, 8), 4.5, 6, BASKET, seg=40, r2=5.2, bevel=0.15))
for k in range(5):
    V(torus('basket_rib', (-9, FY + 0.8 + k * 1.2, 8), 4.6 + k * 0.14, 0.12, BASKET, seg=40))
V(cyl('bottle', (11, FY + 5.5, 7), 3.0, 11, BOTTLE, seg=40, bevel=0.6))
V(cyl('bottle_cap', (11, FY + 11.7, 7), 1.5, 1.5, CAP, seg=32, bevel=0.2))
# soap bubbles drifting about (the script floats them)
for k in range(14):
    V(sphere('bubble_%d' % k, (random.choice((-1, 1)) * random.uniform(10, 16), random.uniform(-6, 14), random.uniform(-2, 6)), random.uniform(0.3, 0.9), BUBBLE, seg=20, rings=12))

# ---- loose laundry: socks and a towel
def sock(name, c, m):
    node = empty(name, c)
    V(cyl(name + '_leg', (0, 0.35, 0), 0.32, 1.0, m, seg=18, bevel=0.1, parent=node))
    V(sphere(name + '_foot', (0, -0.2, 0.28), 0.36, m, seg=16, rings=10, scale=(1, 1.4, 0.9), parent=node))
    V(torus(name + '_cuff', (0, 0.85, 0), 0.3, 0.07, SOCKS[1] if m != SOCKS[1] else SOCKS[0], seg=24, parent=node))
    cyl('col_hull_' + name, (0, 0.2, 0.1), 0.38, 1.3, None, seg=10, parent=node)
    node['mass'] = 6
    return node


for k in range(4):
    sock('dyn_sock_%d' % k, (random.uniform(-3, 3), 1.3, -1.5 - k * 1.5), SOCKS[k])
tw = empty('dyn_towel', (2.2, 1.0, -5.5))
V(box('towel_body', (0, 0, 0), (2.2, 0.5, 1.6), TOWEL, bevel=0.22, seg=3, parent=tw))
box('col_box_towel', (0, 0, 0), (2.2, 0.5, 1.6), parent=tw)
tw['mass'] = 14

# ---- spawns: along the bottom of the drum
for i in range(8):
    x = (-1.8, 1.8)[i % 2] + random.uniform(-0.4, 0.4)
    z = -1.6 - (i // 2) * 1.35
    e = empty('spawn_%d' % i, (x, 1.1, z))
    e.rotation_euler = (0, 0, math.radians(90 if x < 0 else -90))

bpy.context.view_layer.update()
big = [o for o in vis if o.name in ('drum_shell', 'seal', 'drum_back', 'paddle_0', 'paddle_1', 'paddle_2')]
bake_ao(big, distance=1.2, samples=16, dense=0.9)
export([o for o in bpy.data.objects], 'wash')
