"""An original 7 m centre-console runabout for Palmera's marina (public/palmera/boat.glb).

Run: blender -b --python tools/palmera/boat.py -- <out.glb> [preview_dir]

Game frame (x right, y up, z forward/bow; 7.0 x 2.4 m; the waterline at y = 0). Objects:
  boat_paint - the topsides above the chine (white: the game tints each moored boat its colour)
  boat_rest  - anti-fouling below the chine, deck and gunwale cap, centre console with a tinted
               windscreen, leaning-post seat, stern bench with cushions, bow rails and cleats in
               stainless, and the outboard motor on the transom
The hull is lofted through V sections: deadrise at the keel, a hard chine, flared topsides and a
raked stem that rises toward the bow.
"""
import sys, os, math
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kitlib as K

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
PREV = args[1] if len(args) > 1 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
K.PREFIX = 'boat_'

L, HW = 7.0, 1.2
N = 24


def ss(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def section(t):
    """the hull's half-profile at fraction t (0 stern .. 1 bow): sheer, chine and keel"""
    z = -L / 2 + L * t
    hw = HW * (1.0 if t < 0.55 else max(0.0, math.cos((t - 0.55) / 0.45 * math.pi / 2)) ** 0.75)
    sheer = 0.72 + 0.28 * ss(0.45, 1.0, t)
    chine_y = -0.12 + 0.34 * ss(0.55, 1.0, t)
    keel = -0.42 + 0.5 * ss(0.62, 1.0, t)
    return z, hw, sheer, chine_y, keel


def mesh(verts, faces, col):
    me = bpy.data.meshes.new('m')
    me.from_pydata([K.G(*v) for v in verts], [], faces)
    me.update()
    o = bpy.data.objects.new('m', me)
    bpy.context.scene.collection.objects.link(o)
    for f in me.polygons:
        f.use_smooth = True
    K.finish(o, col)
    K.parts.append(o) if o not in K.parts else None
    return o


# ---------------------------------------------------------------- topsides (painted)
top_v, top_f = [], []
bot_v, bot_f = [], []
for i in range(N + 1):
    z, hw, sh, cy, kl = section(i / N)
    cw = hw * 0.9
    # topsides: chine -> two flare points -> sheer, both sides
    for s in (-1, 1):
        top_v += [(s * cw, cy, z), (s * hw * 0.97, cy + (sh - cy) * 0.45, z), (s * hw, sh, z)]
    # bottom: chine -> half -> keel -> half -> chine
    bot_v += [(-cw, cy, z), (-cw * 0.5, (cy + kl) / 2 - 0.03, z), (0, kl, z), (cw * 0.5, (cy + kl) / 2 - 0.03, z), (cw, cy, z)]
for i in range(N):
    for s in range(2):
        for j in range(2):
            a = i * 6 + s * 3 + j
            b = a + 6
            f = (a, a + 1, b + 1, b) if s == 1 else (a, b, b + 1, a + 1)
            top_f.append(f)
    for j in range(4):
        a = i * 5 + j
        b = a + 5
        bot_f.append((a, b, b + 1, a + 1))
mesh(top_v, top_f, (1.0, 1.0, 1.0))
paint = K.build('paint')

# ---------------------------------------------------------------- everything else
BOTTOM, DECK, CAP, STEEL, GLASS, CUSH, MOTOR = 0x1f2a3a, 0xf3f1ec, 0xfafafa, 0xcfd3d6, 0x2b3d4a, 0xe7e2d6, 0xf0f0f0
mesh(bot_v, bot_f, BOTTOM)
# the transom (stern face) in the topside colour of the rest, and the deck
z0, hw0, sh0, cy0, kl0 = section(0)
mesh([(-hw0, sh0, z0), (-hw0 * 0.9, cy0, z0), (-hw0 * 0.45, (cy0 + kl0) / 2, z0), (0, kl0, z0), (hw0 * 0.45, (cy0 + kl0) / 2, z0), (hw0 * 0.9, cy0, z0), (hw0, sh0, z0)],
     [(0, 1, 2, 3), (3, 4, 5, 6), (0, 3, 6)], 0xeae8e2)
dv, df = [], []
for i in range(N + 1):
    z, hw, sh, cy, kl = section(i / N)
    inset = max(0.0, hw - 0.12)
    dv += [(-inset, sh - 0.12, z), (inset, sh - 0.12, z)]
for i in range(N):
    a = i * 2
    df.append((a, a + 2, a + 3, a + 1))
mesh(dv, df, DECK)
# gunwale cap and the inside of the bulwark
for s in (-1, 1):
    pts = []
    for i in range(N + 1):
        z, hw, sh, cy, kl = section(i / N)
        pts.append((s * max(0.02, hw - 0.04), sh + 0.02, z))
    K.path(pts[::2] + [pts[-1]], 0.045, CAP, sides=6)
# centre console, windscreen, leaning post, stern bench
K.soft((0.95, 1.0, 0.85), (0, 0.6 + 0.5, 0.35), CAP, bev=0.12, lv=1)
K.box((0.85, 0.06, 0.55), (0, 1.62, 0.42), 0x3a3f44, bevel=0.01, rot=(-0.35, 0, 0))
K.box((0.95, 0.42, 0.03), (0, 1.75, 0.82), GLASS, bevel=0.01, rot=(-0.45, 0, 0))
K.path([(-0.48, 1.6, 0.78), (-0.48, 1.98, 0.62), (0.48, 1.98, 0.62), (0.48, 1.6, 0.78)], 0.018, STEEL, sides=6)
K.cyl(0.11, 0.11, 0.04, (0.0, 1.66, 0.12), 0x222222, seg=16, axis='z')
K.soft((0.9, 0.55, 0.45), (0, 0.85, -0.65), CAP, bev=0.1, lv=1)
K.soft((0.85, 0.16, 0.42), (0, 1.18, -0.65), CUSH, bev=0.06, lv=1)
K.soft((0.85, 0.4, 0.12), (0, 1.45, -0.86), CUSH, bev=0.05, lv=1)
K.soft((2.0, 0.42, 0.55), (0, 0.8, -2.85), CAP, bev=0.1, lv=1)
K.soft((1.9, 0.14, 0.5), (0, 1.07, -2.85), CUSH, bev=0.05, lv=1)
K.soft((1.9, 0.38, 0.12), (0, 1.3, -3.1), CUSH, bev=0.05, lv=1)
# bow rails on stanchions, cleats
for s in (-1, 1):
    pts = []
    for t in (0.6, 0.7, 0.8, 0.9, 0.97):
        z, hw, sh, cy, kl = section(t)
        pts.append((s * max(0.04, hw - 0.1), sh + 0.38, z))
        K.tube((s * max(0.04, hw - 0.1), sh, z), (s * max(0.04, hw - 0.1), sh + 0.38, z), 0.014, STEEL, sides=6)
    K.path(pts, 0.016, STEEL, sides=6)
    for t in (0.1, 0.55):
        z, hw, sh, cy, kl = section(t)
        K.box((0.05, 0.06, 0.24), (s * (hw - 0.1), sh + 0.05, z), STEEL, bevel=0.015)
zb, hwb, shb, _, _ = section(0.995)
K.box((0.06, 0.06, 0.24), (0, shb + 0.04, zb - 0.25), STEEL, bevel=0.015)
# the outboard: cowling, a lower unit down into the water, the bracket on the transom
K.soft((0.55, 0.75, 0.62), (0, 1.05, -3.72), MOTOR, bev=0.22, lv=2)
K.box((0.5, 0.05, 0.58), (0, 0.69, -3.72), 0x2b2b2b, bevel=0.01)
K.soft((0.16, 0.95, 0.3), (0, 0.15, -3.78), 0x2b2b2b, bev=0.3, lv=1)
K.soft((0.22, 0.16, 0.55), (0, -0.32, -3.74), 0x2b2b2b, bev=0.3, lv=1)
K.box((0.3, 0.35, 0.15), (0, 0.7, -3.52), 0x5a5a5a, bevel=0.01)
rest = K.build('rest')

# moored by the dozen: hold the rest to ~2400 triangles (the bevels and rounded cushions are where it went)
rest.data.calc_loop_triangles()
if len(rest.data.loop_triangles) > 2400:
    m = rest.modifiers.new('d', 'DECIMATE')
    m.ratio = 2400 / len(rest.data.loop_triangles)
    m.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = rest
    bpy.ops.object.modifier_apply(modifier='d')
objs = [o for o in bpy.data.objects if o.name.startswith('boat_')]
for o in objs:
    o.data.calc_loop_triangles()
print('tris', {o.name: len(o.data.loop_triangles) for o in objs})
if PREV:
    K.render_preview(PREV, 'boat', [], [('bow', (8.0, -9.0, 3.6), (0, 0, 0.4)), ('stern', (-7.0, 9.5, 3.4), (0, 0, 0.4))])
K.export(OUT)
print('exported', OUT)
