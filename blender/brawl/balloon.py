# BALLOON DRIFT: three hot-air balloon baskets above the clouds at sunset. The big one in the middle
# (mov_basket_main) has rope ladders off both ends; the small ones (mov_basket_L / _R) bob and drift
# in and out of jumping range. Everything below is cloud.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset()
random.seed(9)

WICKER = mat('wicker', (0.78, 0.56, 0.3), 0.8)
WICKER2 = mat('wicker_dark', (0.55, 0.36, 0.18), 0.85)
LEATHER = mat('leather', (0.45, 0.22, 0.12), 0.6)
FLOORM = mat('basket_floor', (0.62, 0.42, 0.24), 0.8)
ROPE = mat('rope', (0.85, 0.78, 0.6), 0.9)
STEEL = mat('burner_steel', (0.7, 0.72, 0.76), 0.25, metal=1.0)
FLAME = mat('burner_flame', (1.0, 0.6, 0.2), 0.5, emit=(1.0, 0.55, 0.15), emit_k=14.0)
BLUEF = mat('burner_blue', (0.4, 0.6, 1.0), 0.5, emit=(0.35, 0.55, 1.0), emit_k=8.0)
SAND = mat('sandbag', (0.85, 0.75, 0.55), 0.95, sheen=0.4)
FLAG = mat('flag', (1.0, 0.35, 0.3), 0.7)
CLOUD = mat('cloud', (1.0, 0.94, 0.92), 0.95, sheen=0.6)
CLOUD2 = mat('cloud_pink', (1.0, 0.8, 0.78), 0.95, sheen=0.6)
SUN = mat('sun_disc', (1.0, 0.85, 0.6), 0.5, emit=(1.0, 0.75, 0.45), emit_k=6.0)
PAL = {
    'main': [mat('env_red', (0.92, 0.22, 0.2), 0.45, clearcoat=0.3), mat('env_yellow', (1.0, 0.8, 0.2), 0.45, clearcoat=0.3)],
    'L': [mat('env_blue', (0.2, 0.45, 0.92), 0.45, clearcoat=0.3), mat('env_white', (0.97, 0.96, 0.94), 0.45, clearcoat=0.3)],
    'R': [mat('env_green', (0.22, 0.72, 0.42), 0.45, clearcoat=0.3), mat('env_cream', (1.0, 0.92, 0.75), 0.45, clearcoat=0.3)],
    'far': [mat('env_purple', (0.62, 0.38, 0.9), 0.45), mat('env_orange', (1.0, 0.58, 0.25), 0.45)],
}
vis = []


def V(o):
    vis.append(o)
    return o


def envelope(name, c, r, mats, parent=None, gores=12):
    """a striped balloon envelope (taller than wide, narrowing to the mouth)"""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=gores * 4, v_segments=24, radius=r)
    for v in bm.verts:
        x, y, z = v.co.x, v.co.y, v.co.z   # blender coords (z up)
        k = z / r
        squeeze = 1.0 if k > -0.2 else max(0.18, 1.0 - (-0.2 - k) * 1.05)
        v.co = Vector((x * squeeze, y * squeeze, z * 1.18))
    o = obj_from_bm(bm, name, None, parent)
    o.data.materials.append(mats[0])
    o.data.materials.append(mats[1])
    for f in o.data.polygons:
        cx, cy = f.center.x, f.center.y
        a = math.atan2(cy, cx) % math.tau
        f.material_index = int(a / (math.tau / gores)) % 2
    o.location = G(*c)
    smooth(o)
    return o


def basket(name, W, D, H, mats, ladders=False, burner_h=3.0, env_r=6.0, env_y=11.0):
    node = empty('mov_basket_' + name, (0, 0, 0))
    T = 0.28
    # floor
    V(box(name + '_floor', (0, -0.2, 0), (W, 0.4, D), FLOORM, bevel=0.05, parent=node))
    col_box(name + '_floor', (0, -0.2, 0), (W, 0.4, D), parent=node)
    # woven walls (slats), a leather rim on top
    for sx, sz, w, d in ((0, D / 2 - T / 2, W, T), (0, -D / 2 + T / 2, W, T), (W / 2 - T / 2, 0, T, D), (-W / 2 + T / 2, 0, T, D)):
        V(box(name + '_wall', (sx, H / 2, sz), (w, H, d), WICKER, parent=node))
        col_box(name + '_wall', (sx, H / 2, sz), (w, H, d), parent=node)
        V(box(name + '_rim', (sx, H + 0.05, sz), (w + 0.12, 0.14, d + 0.12), LEATHER, bevel=0.04, parent=node))
        for k in range(1, 5):
            V(box(name + '_weave', (sx, H * k / 5, sz), (w + 0.03, 0.07, d + 0.03), WICKER2, parent=node))
        staves = []
        long = w > d
        n = int((w if long else d) / 0.22)
        for i in range(n + 1):
            u = -0.5 + i / n
            px, pz = (sx + u * (w - 0.1), sz) if long else (sx, sz + u * (d - 0.1))
            staves.append(box(name + '_stave', (px, H / 2, pz), (0.07 if long else w + 0.04, H - 0.05, d + 0.04 if long else 0.07), WICKER2))
        st = join(staves, name + '_staves')
        st.parent = node
        V(st)
    # corner poles up to the burner frame (grab them)
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = sx * (W / 2 - 0.25), sz * (D / 2 - 0.25)
            V(cyl(name + '_pole', (x, (H + burner_h) / 2, z), 0.07, burner_h - H + 0.2, STEEL, seg=10, parent=node))
            cyl('col_hull_' + name + '_pole', (x, (H + burner_h) / 2, z), 0.09, burner_h - H + 0.2, None, seg=8, parent=node)
            # ropes up to the envelope
            top = (sx * env_r * 0.42, env_y - env_r * 0.6, sz * env_r * 0.42)
            dx, dy, dz = top[0] - x, top[1] - burner_h, top[2] - z
            Lr = math.sqrt(dx * dx + dy * dy + dz * dz)
            rope = cyl(name + '_rope', (x + dx / 2, burner_h + dy / 2, z + dz / 2), 0.03, Lr, ROPE, seg=6, parent=node)
            rope.rotation_euler = (Vector((dx, -dz, dy)).normalized()).to_track_quat('Z', 'Y').to_euler()
            V(rope)
    for sz in (-1, 1):
        V(box(name + '_frame', (0, burner_h, sz * (D / 2 - 0.25)), (W - 0.4, 0.1, 0.1), STEEL, parent=node))
    for sx in (-1, 1):
        V(box(name + '_frame', (sx * (W / 2 - 0.25), burner_h, 0), (0.1, 0.1, D - 0.4), STEEL, parent=node))
    V(box(name + '_frame', (0, burner_h, 0), (W - 0.4, 0.08, 0.08), STEEL, parent=node))
    V(box(name + '_frame', (0, burner_h, 0), (0.08, 0.08, D - 0.4), STEEL, parent=node))
    V(cyl(name + '_burner', (0, burner_h + 0.25, 0), 0.4, 0.5, STEEL, seg=20, parent=node, bevel=0.04))
    V(cyl(name + '_pilot', (0, burner_h + 0.6, 0), 0.12, 0.25, BLUEF, seg=12, r2=0.0, parent=node))
    fl = cyl('flame_' + name, (0, burner_h + 1.6, 0), 0.45, 2.0, FLAME, seg=16, r2=0.05, parent=node)
    V(fl)
    # the envelope
    V(envelope(name + '_envelope', (0, env_y, 0), env_r, mats, parent=node))
    V(cyl(name + '_skirt', (0, env_y - env_r * 1.05, 0), env_r * 0.22, env_r * 0.35, mats[0], seg=24, r2=env_r * 0.32, parent=node, cap=False))
    # sandbags hanging off the outside
    for k in range(int(W)):
        x = -W / 2 + 0.6 + k * (W - 1.2) / max(1, int(W) - 1)
        for sz in (-1, 1):
            V(sphere(name + '_bag', (x, H - 0.45, sz * (D / 2 + 0.22)), 0.24, SAND, seg=12, rings=8, scale=(1, 0.8, 1.3), parent=node))
    if ladders:
        for sx in (-1, 1):
            x = sx * (W / 2 + 0.12)
            for s in (-1, 1):
                V(cyl(name + '_ladder_rope', (x, -2.2, s * 0.5), 0.035, 4.8, ROPE, seg=6, parent=node))
            for k in range(7):
                y = -0.6 - k * 0.62
                V(box(name + '_rung', (x, y, 0), (0.08, 0.08, 1.05), LEATHER, parent=node))
                col_box(name + '_rung', (x, y, 0), (0.1, 0.1, 1.05), parent=node)
    return node


main = basket('main', 6.6, 5.0, 1.15, PAL['main'], ladders=True, burner_h=3.1, env_r=6.5, env_y=12.0)
left = basket('L', 3.8, 3.6, 1.1, PAL['L'], burner_h=2.8, env_r=4.4, env_y=9.6)
right = basket('R', 3.8, 3.6, 1.1, PAL['R'], burner_h=2.8, env_r=4.4, env_y=9.6)
left.location = G(-7.6, 0, 0)
right.location = G(7.6, 0, 0)
# a pennant on the main burner frame (it shows the wind)
fl = empty('wind_flag', (0, 3.1, -2.25), parent=main)
V(cyl('flag_pole', (0, 0.6, 0), 0.04, 1.2, STEEL, seg=8, parent=fl))
V(flat_shape('flag', [(0, 0), (1.3, 0.25), (0, 0.5)], (0, 0.75, 0), FLAG, depth=0.03, parent=fl, rot=(math.pi / 2, 0, 0)))

# ---- loose sandbags in the big basket
for k in range(4):
    node = empty('dyn_sandbag_%d' % k, ((-2.2, 2.2, -1.2, 1.4)[k], 0.4, (1.4, -1.4, -1.5, 1.6)[k]))
    V(sphere('sandbag', (0, 0, 0), 0.38, SAND, seg=16, rings=10, scale=(1, 0.75, 1.25), parent=node))
    V(torus('sandbag_tie', (0, 0.24, 0), 0.12, 0.04, ROPE, seg=12, parent=node))
    sphere('col_hull_sandbag', (0, 0, 0), 0.38, None, seg=10, rings=6, scale=(1, 0.75, 1.25), parent=node)
    node['mass'] = 16

# ---- the sky: clouds below, far balloons, the setting sun
clouds = []
for k in range(46):
    a = random.uniform(0, math.tau)
    r = random.uniform(6, 70)
    x, z = math.cos(a) * r, math.sin(a) * r - 14
    if z > 4:
        z = -z
    y = random.uniform(-34, -27) if r < 30 else random.uniform(-30, -8)
    for j in range(random.randint(3, 6)):
        s = random.uniform(2.0, 5.0) * (1 + r / 60)
        clouds.append(sphere('cloud', (x + random.uniform(-4, 4), y + random.uniform(-0.6, 1.2), z + random.uniform(-3, 3)), s, CLOUD if random.random() < 0.6 else CLOUD2, seg=16, rings=10, scale=(1.4, 1, 0.65)))
V(join(clouds, 'clouds'))
for k, (x, y, z, s) in enumerate(((-34, 6, -50, 0.8), (40, 12, -62, 1.0), (22, -2, -40, 0.6), (-52, 14, -75, 1.1))):
    V(envelope('far_envelope', (x, y, z), 5 * s, PAL['far'] if k % 2 else PAL['L'] if k == 2 else PAL['R']))
    V(box('far_basket', (x, y - 7.2 * s, z), (1.4 * s, 1.0 * s, 1.4 * s), WICKER))
V(sphere('sun', (20, 4, -140), 14, SUN, seg=32, rings=16))

# ---- spawns: four in the big basket, two in each small one
SP = ((-1.8, 1.2, 1.2), (1.8, 1.2, -1.2), (-1.8, 1.2, -1.2), (1.8, 1.2, 1.2), (-7.9, 1.2, 0.6), (-7.3, 1.2, -0.6), (7.3, 1.2, 0.6), (7.9, 1.2, -0.6))
for i, (x, y, z) in enumerate(SP):
    e = empty('spawn_%d' % i, (x, y, z))
    e.rotation_euler = (0, 0, math.atan2(x, -z) + math.pi)

bpy.context.view_layer.update()
big = [o for o in vis if o.name in ('main_floor', 'L_floor', 'R_floor')]
bake_ao(big, distance=0.8, samples=16, dense=0.6)
export([o for o in bpy.data.objects], 'balloon')
