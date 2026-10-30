# TILT: a giant pinball table in an arcade. The playfield is built flat inside a 'table' node tilted
# 6 degrees (the far end up); flippers swing (mov_), pop bumpers kick, a chrome ball rolls (dyn_)
# and the drain between the flippers is the way out. Art on the playfield is meshes: stars, arrows,
# rings, lettering, lit inserts (emissive, the game makes them blink).
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset()
random.seed(4)

FIELD = mat('field', (0.07, 0.13, 0.42), 0.45, clearcoat=0.6)
FIELD2 = mat('field2', (0.32, 0.09, 0.5), 0.45, clearcoat=0.6)
PINK = mat('decal_pink', (1.0, 0.25, 0.6), 0.4, clearcoat=0.6)
YELLOW = mat('decal_yellow', (1.0, 0.82, 0.15), 0.4, clearcoat=0.6)
CYAN = mat('decal_cyan', (0.15, 0.85, 1.0), 0.4, clearcoat=0.6)
ORANGE = mat('decal_orange', (1.0, 0.45, 0.1), 0.4, clearcoat=0.6)
WHITE = mat('decal_white', (0.95, 0.95, 0.95), 0.4, clearcoat=0.6)
CHROME = mat('chrome', (0.9, 0.9, 0.92), 0.12, metal=1.0)
WOOD = mat('wood', (0.55, 0.32, 0.16), 0.5, clearcoat=0.5)
PLASTIC_W = mat('plastic_white', (0.95, 0.95, 0.97), 0.25, clearcoat=0.8)
RUBBER = mat('rubber_red', (0.85, 0.08, 0.1), 0.6)
RUBBER_B = mat('rubber_black', (0.04, 0.04, 0.05), 0.7)
CAB = mat('cabinet', (0.08, 0.06, 0.12), 0.5)
CAB_ART = mat('cabinet_art', (1.0, 0.3, 0.55), 0.5)
CARPET = mat('carpet', (0.09, 0.05, 0.16), 0.95)
GLOW = {k: mat('insert_' + k, c, 0.3, emit=c, emit_k=4.0) for k, c in (
    ('red', (1.0, 0.15, 0.15)), ('yellow', (1.0, 0.8, 0.15)), ('green', (0.2, 1.0, 0.35)), ('blue', (0.25, 0.5, 1.0)), ('pink', (1.0, 0.3, 0.8)), ('white', (1, 1, 1)))}
NEON_P = mat('neon_pink', (1, 0.3, 0.8), 0.4, emit=(1, 0.25, 0.75), emit_k=6)
NEON_C = mat('neon_cyan', (0.2, 0.9, 1), 0.4, emit=(0.2, 0.85, 1), emit_k=6)
NEON_Y = mat('neon_yellow', (1, 0.85, 0.2), 0.4, emit=(1, 0.8, 0.2), emit_k=5)
SCREEN = mat('screen', (1, 0.5, 0.1), 0.5, emit=(1.0, 0.45, 0.08), emit_k=3)
DARK = mat('dark', (0.03, 0.03, 0.05), 0.6)

TILT = math.radians(6)
table = empty('table', (0, 1.2, 0))
table.rotation_euler = (TILT, 0, 0)
vis, cols = [], []


def V(o):
    vis.append(o)
    return o


# ---- playfield: the main slab, the arch at the top, the lower floors either side of the drain
V(box('playfield', (0, -0.25, -3.5), (14, 0.5, 17), FIELD, bevel=0.02, parent=table))
col_box('playfield', (0, -0.25, -3.5), (14, 0.5, 17), parent=table)
arch = []
for i in range(25):
    a = i / 24 * math.pi
    arch.append((7 * math.cos(a), -12 - 3.2 * math.sin(a)))
arch_floor = flat_shape('arch_floor', arch, (0, -0.5, 0), FIELD2, depth=0.5, parent=table)
V(arch_floor)
c = flat_shape('col_hull_arch', arch, (0, -0.5, 0), None, depth=0.5, parent=table)
for s in (1, -1):
    V(box('lowfloor', (s * 4.6, -0.25, 7.6), (4.8, 0.5, 5.2), FIELD, bevel=0.02, parent=table))
    col_box('lowfloor', (s * 4.6, -0.25, 7.6), (4.8, 0.5, 5.2), parent=table)
    # apron at the very bottom
    V(box('apron', (s * 4.6, -0.1, 10.6), (4.8, 0.8, 1.0), CAB, bevel=0.05, parent=table))
    col_box('apron', (s * 4.6, -0.1, 10.6), (4.8, 0.8, 1.0), parent=table)

# ---- walls: wooden side rails, the arch rail, the plunger lane
for s in (1, -1):
    V(box('rail', (s * 7.35, 0.45, -1.0), (0.7, 1.4, 23.2), WOOD, bevel=0.08, parent=table))
    col_box('rail', (s * 7.35, 0.45, -1.0), (0.7, 1.4, 23.2), parent=table)
    V(box('rail_chrome', (s * 7.0, 0.55, -1.0), (0.08, 0.5, 23.2), CHROME, parent=table))
for i in range(24):
    a0, a1 = i / 24 * math.pi, (i + 1) / 24 * math.pi
    p0 = Vector((7.2 * math.cos(a0), -12 - 3.45 * math.sin(a0)))
    p1 = Vector((7.2 * math.cos(a1), -12 - 3.45 * math.sin(a1)))
    m = (p0 + p1) / 2
    d = p1 - p0
    yaw = math.atan2(d.x, d.y)
    V(box('arch_rail', (m.x, 0.45, m.y), (0.6, 1.4, d.length + 0.12), WOOD, rot=(0, yaw, 0), parent=table))
    col_box('arch_rail', (m.x, 0.45, m.y), (0.6, 1.4, d.length + 0.12), rot=(0, yaw, 0), parent=table)
V(box('lane_wall', (5.95, 0.35, 2.0), (0.22, 0.7, 17), CHROME, parent=table))
col_box('lane_wall', (5.95, 0.35, 2.0), (0.22, 0.7, 17), parent=table)
# inlane guides above the flippers
for s in (1, -1):
    V(box('guide', (s * 4.9, 0.3, 4.6), (0.16, 0.6, 3.2), CHROME, rot=(0, s * 0.35, 0), parent=table))
    col_box('guide', (s * 4.9, 0.3, 4.6), (0.16, 0.6, 3.2), rot=(0, s * 0.35, 0), parent=table)

# ---- slingshots: rubber-faced triangles that kick
for s in (1, -1):
    tri = [(s * 4.6, 2.6), (s * 4.6, 5.6), (s * 2.9, 5.2)]
    if s < 0:
        tri = tri[::-1]
    o = flat_shape('sling', tri, (0, 0, 0), PLASTIC_W, depth=0.7, parent=table)
    V(o)
    flat_shape('col_hull_sling_' + ('L' if s > 0 else 'R'), tri, (0, 0, 0), None, depth=0.7, parent=table)
    V(box('sling_rubber', (s * 3.75, 0.35, 3.95), (0.12, 0.5, 2.85), RUBBER, rot=(0, -s * 0.555 + math.pi, 0), parent=table))
    V(box('sling_light', (s * 4.1, 0.71, 4.6), (0.4, 0.02, 0.9), GLOW['yellow'], parent=table))
    e = empty('kick_sling_' + ('L' if s > 0 else 'R'), (s * 3.75, 0.35, 3.95), parent=table)

# ---- flippers (mov_flipper_L/R): pivot at the node, the bat along local +x / -x
for s, n in ((1, 'L'), (-1, 'R')):
    piv = empty('mov_flipper_' + n, (s * -2.25, 0.3, 6.1), parent=table)
    piv.rotation_euler = (0, 0, -s * math.radians(30))
    L = 2.1
    # the bat: the hull of a fat round end and a thin one
    bm = bmesh.new()
    for cx, r in ((0.0, 0.3), (s * L, 0.15)):
        for k in range(24):
            a = k / 24 * math.tau
            for y in (-0.25, 0.25):
                bm.verts.new(Vector((cx + math.cos(a) * r, math.sin(a) * r, y)))
    bmesh.ops.convex_hull(bm, input=bm.verts)
    fl = obj_from_bm(bm, 'flipper_' + n, PLASTIC_W, piv)
    modifier(fl, 'BEVEL', width=0.05, segments=3, limit_method='ANGLE')
    smooth(fl, math.radians(35))
    V(fl)
    V(box('flipper_rubber_' + n, (s * L * 0.5, 0, 0), (L, 0.18, 0.62), RUBBER, parent=piv))
    box('col_hull_flipper_' + n, (s * L * 0.5, 0, 0), (L + 0.3, 0.5, 0.5), parent=piv)
    V(cyl('flipper_cap', (0, 0.28, 0), 0.12, 0.06, CHROME, seg=16, parent=piv))

# ---- pop bumpers
for i, (x, z) in enumerate(((-2.4, -6.0), (2.4, -6.0), (0.0, -8.9))):
    n = 'bumper_%d' % i
    e = empty(n, (x, 0, z), parent=table)
    V(cyl(n + '_base', (x, 0.15, z), 0.95, 0.3, PLASTIC_W, seg=36, parent=table, bevel=0.03))
    V(cyl(n + '_skirt', (x, 0.5, z), 0.78, 0.4, GLOW['red' if i < 2 else 'blue'], seg=36, parent=table))
    V(cyl(n + '_body', (x, 0.85, z), 0.62, 0.45, PLASTIC_W, seg=36, parent=table))
    V(cyl(n + '_cap', (x, 1.15, z), 0.82, 0.18, (PINK, CYAN, YELLOW)[i], seg=36, parent=table, bevel=0.04))
    V(cyl(n + '_star', (x, 1.25, z), 0.32, 0.03, WHITE, seg=5, parent=table))
    cyl('col_hull_' + n, (x, 0.6, z), 0.85, 1.2, None, seg=16, parent=table)
    V(flat_shape(n + '_ring', circle_pts(1.45, 40), (x, 0.005, z), YELLOW, depth=0.01, parent=table))
    V(flat_shape(n + '_ring_in', circle_pts(1.25, 40), (x, 0.012, z), FIELD2, depth=0.01, parent=table))

# ---- the ramp on the left up to a balcony
RAMP_X, RY = -5.4, 2.6
ramp = box('ramp', (RAMP_X, RY / 2, -3.0), (1.9, 0.18, math.hypot(6.6, RY)), CHROME, rot=(math.atan2(RY, 6.6), 0, 0), parent=table)
ramp.data.materials.clear()
ramp.data.materials.append(PLASTIC_W)
V(ramp)
col_box('ramp', (RAMP_X, RY / 2, -3.0), (1.9, 0.18, math.hypot(6.6, RY)), rot=(math.atan2(RY, 6.6), 0, 0), parent=table)
for s in (1, -1):
    V(box('ramp_rail', (RAMP_X + s * 0.95, RY / 2 + 0.35, -3.0), (0.06, 0.06, math.hypot(6.6, RY)), CHROME, rot=(math.atan2(RY, 6.6), 0, 0), parent=table))
V(box('balcony', (-5.4, RY - 0.1, -8.0), (3.2, 0.2, 3.4), FIELD2, bevel=0.03, parent=table))
col_box('balcony', (-5.4, RY - 0.1, -8.0), (3.2, 0.2, 3.4), parent=table)
for x, z in ((-4.0, -6.5), (-4.0, -9.5), (-6.7, -9.5)):
    V(cyl('post', (x, RY / 2 - 0.1, z), 0.1, RY, CHROME, seg=12, parent=table))
V(box('balcony_rail', (-5.4, RY + 0.35, -9.65), (3.2, 0.08, 0.08), CHROME, parent=table))
V(box('balcony_sign', (-5.4, RY + 0.75, -9.68), (2.6, 0.7, 0.08), NEON_P, parent=table))
V(text('balcony_txt', 'JACKPOT', (-5.4, RY + 0.75, -9.62), 0.48, WHITE, depth=0.03, rot=(math.pi / 2, 0, 0), parent=table))

# ---- drop targets, rollover lanes, standups
for i in range(4):
    V(box('target_%d' % i, (5.3, 0.4, -1.4 - i * 0.75), (0.25, 0.8, 0.6), (PINK, YELLOW, CYAN, ORANGE)[i], bevel=0.03, parent=table))
    col_box('target_%d' % i, (5.3, 0.4, -1.4 - i * 0.75), (0.25, 0.8, 0.6), parent=table)
for i in range(4):
    x = -2.25 + i * 1.5
    V(box('lane_post', (x, 0.4, -12.6), (0.18, 0.8, 1.4), CHROME, parent=table))
    col_box('lane_post', (x, 0.4, -12.6), (0.18, 0.8, 1.4), parent=table)
for i, x in enumerate((-1.5, 0.0, 1.5)):
    V(flat_shape('lane_light_%d' % i, circle_pts(0.22, 20), (x, 0.01, -12.3), GLOW[('yellow', 'green', 'pink')[i]], depth=0.015, parent=table))

# ---- playfield art: arrows, stars, inserts, lettering
def arrow(name, x, z, ang, m, s=1.0):
    pts = [(-0.35 * s, 0.5 * s), (0, -0.55 * s), (0.35 * s, 0.5 * s), (0, 0.25 * s)]
    o = flat_shape(name, pts, (x, 0.008, z), m, depth=0.015, parent=table, rot=(0, ang, 0))
    return V(o)


for i in range(5):
    arrow('ins_ramp_%d' % i, -4.2, 3.2 - i * 0.85, -0.25, GLOW[('red', 'yellow', 'green', 'blue', 'pink')[i]], 0.8)
for i in range(4):
    a = -0.9 + i * 0.6
    arrow('ins_fan_%d' % i, math.sin(a) * 3.1, 1.6 - math.cos(a) * 3.1, -a, GLOW[('yellow', 'pink', 'green', 'blue')[i]], 0.75)
for i in range(7):
    a = i / 7 * math.tau
    V(flat_shape('ins_ring_%d' % i, circle_pts(0.24, 20), (math.sin(a) * 2.0, 0.008, -1.0 + math.cos(a) * 2.0), GLOW[('red', 'yellow', 'green', 'blue', 'pink', 'white', 'yellow')[i]], depth=0.015, parent=table))
V(flat_shape('center_disc', circle_pts(2.6, 48), (0, 0.004, -1.0), FIELD2, depth=0.01, parent=table))
V(flat_shape('center_star', star_pts(1.5, 0.7, 5), (0, 0.009, -1.0), YELLOW, depth=0.012, parent=table))
V(text('logo', 'TILT!', (0, 0.025, -1.0), 1.15, WHITE, depth=0.03, parent=table))
V(text('logo_shadow', 'TILT!', (0.06, 0.018, -0.94), 1.15, FIELD, depth=0.02, parent=table))
for i in range(26):
    x = random.uniform(-6.2, 5.2)
    z = random.uniform(-11.5, 4.0)
    if math.hypot(x, z + 1) < 3 or any(math.hypot(x - bx, z - bz) < 1.7 for bx, bz in ((-2.4, -6), (2.4, -6), (0, -8.9))) or (x < -4.2 and z < 0.5):
        continue
    V(flat_shape('spark_%d' % i, star_pts(random.uniform(0.15, 0.32), 0.07, 4, random.uniform(0, 1)), (x, 0.006, z), random.choice([WHITE, CYAN, YELLOW, PINK]), depth=0.008, parent=table))
for s in (1, -1):
    for i in range(3):
        V(flat_shape('stripe', [(-0.15, -1.2), (0.15, -1.2), (0.15, 1.2), (-0.15, 1.2)], (s * (5.6 - i * 0.4), 0.006, 7.6), (CYAN, PINK, YELLOW)[i], depth=0.01, parent=table, rot=(0, s * 0.35, 0)))
V(text('lane_txt', 'SHOOT', (6.6, 0.02, 7.0), 0.36, YELLOW, depth=0.02, rot=(0, math.pi / 2, 0), parent=table))

# ---- the steel ball and the plunger
ball = empty('dyn_ball', (6.6, 1.0, 9.0), parent=None)
ball['mass'] = 160.0
b = sphere('ball_mesh', (0, 0, 0), 0.8, CHROME, seg=48, rings=24, parent=ball)
V(b)
sphere('col_hull_ball', (0, 0, 0), 0.8, None, seg=16, rings=8, parent=ball)
V(cyl('plunger', (6.6, 0.35, 10.3), 0.18, 0.7, CHROME, seg=16, rot=(math.pi / 2, 0, 0), parent=table))
V(cyl('plunger_knob', (6.6, 0.35, 10.9), 0.32, 0.3, RUBBER, seg=20, rot=(math.pi / 2, 0, 0), parent=table))

# ---- cabinet, legs, lockdown bar, backbox
V(box('cab_body', (0, -1.6, -1.8), (15.6, 2.4, 25.0), CAB, bevel=0.08, parent=table))
for s in (1, -1):
    V(box('cab_stripe', (s * 7.82, -1.4, -1.8), (0.04, 0.5, 24.0), CAB_ART, parent=table))
    V(box('cab_stripe2', (s * 7.82, -2.0, -1.8), (0.04, 0.2, 24.0), NEON_C, parent=table))
V(box('lockdown', (0, 0.55, 11.15), (15.6, 0.25, 0.5), CHROME, bevel=0.06, parent=table))
for x, z in ((-7, 9.5), (7, 9.5), (-7, -11.5), (7, -11.5)):
    V(cyl('leg', (x, -7.2, z * math.cos(TILT)), 0.45, 10, CHROME, seg=16))
V(box('backbox', (0, 6.0, -15.6), (16, 10, 1.6), CAB, bevel=0.1))
V(box('backglass', (0, 6.4, -14.78), (14.6, 8.4, 0.05), FIELD2))
for i in range(14):
    a = i / 14 * math.pi * 2
    pts = [(0, 0), (math.cos(a) * 9, math.sin(a) * 9), (math.cos(a + 0.18) * 9, math.sin(a + 0.18) * 9)]
    o = flat_shape('ray', pts, (0, 6.4, -14.72), (PINK if i % 2 else FIELD), depth=0.01, rot=(math.pi / 2, 0, 0))
    V(o)
V(flat_shape('bg_star', star_pts(2.8, 1.2, 5), (0, 7.0, -14.7), YELLOW, depth=0.02, rot=(math.pi / 2, 0, 0)))
V(text('bg_title', 'TILT!', (0, 7.0, -14.62), 2.6, NEON_P, depth=0.12, rot=(math.pi / 2, 0, 0)))
V(text('bg_sub', 'PLUSH PANIC', (0, 4.2, -14.66), 0.9, NEON_C, depth=0.06, rot=(math.pi / 2, 0, 0)))
V(box('dmd', (0, 1.55, -14.7), (7, 1.3, 0.1), DARK))
V(text('dmd_txt', '00000000', (0, 1.55, -14.62), 0.95, SCREEN, depth=0.03, rot=(math.pi / 2, 0, 0)))

# ---- the arcade: carpet, other machines glowing in the dark, neon on the walls
V(box('floor', (0, -12.3, -2), (90, 0.4, 90), CARPET))
for i in range(40):
    V(flat_shape('carpet_star', star_pts(random.uniform(0.4, 0.9), 0.2, 5, random.uniform(0, 1)), (random.uniform(-40, 40), -12.09, random.uniform(-40, 30)), random.choice([NEON_P, NEON_C, NEON_Y]), depth=0.01))
for i, (x, z, yaw) in enumerate(((-16, -10, 0.4), (-19, -2, 0.9), (16, -10, -0.4), (19, -2, -0.9), (-14, 12, 2.6), (14, 12, -2.6), (0, -26, 0))):
    g = empty('machine_%d' % i, (x, -12.1, z), yaw=yaw)
    V(box('m_body', (0, 3.6, 0), (3.2, 7.2, 3.0), CAB, bevel=0.06, parent=g))
    V(box('m_screen', (0, 5.0, 1.52), (2.6, 2.0, 0.05), random.choice([NEON_P, NEON_C, SCREEN, NEON_Y]), parent=g))
    V(box('m_marquee', (0, 6.8, 1.4), (3.0, 0.6, 0.1), random.choice([NEON_P, NEON_C, NEON_Y]), parent=g))
    V(box('m_panel', (0, 3.2, 1.8), (3.0, 0.3, 1.0), CAB_ART, parent=g))
V(box('wall', (0, 4, -34), (90, 34, 1), CAB))
V(text('neon_wall', 'ARCADE', (0, 14, -33.3), 4.5, NEON_C, depth=0.2, rot=(math.pi / 2, 0, 0)))
V(text('neon_wall2', 'OPEN LATE', (0, 9.5, -33.3), 2.0, NEON_P, depth=0.15, rot=(math.pi / 2, 0, 0)))

# ---- spawns on the playfield, facing the middle
for i, (x, z) in enumerate(((-3.5, -2.5), (3.5, -2.5), (-1.8, 1.8), (1.8, 1.8), (-3.6, -9.6), (3.6, -9.6), (0, -4.4), (-1.0, -11.2))):
    e = empty('spawn_%d' % i, (x, 0.95, z), parent=table)
    e.rotation_euler = (0, 0, math.atan2(x, -(z + 2)) + math.pi)

bpy.context.view_layer.update()
big = [o for o in vis if o.name.startswith(('playfield', 'lowfloor', 'arch_floor', 'cab_body', 'balcony', 'floor', 'ramp', 'rail', 'apron')) or o.name.startswith('bumper')]
bake_ao(big, distance=1.2, samples=16, dense=0.9)
export([o for o in bpy.data.objects], 'tilt')
