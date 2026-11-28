"""An original low-floor city bus for Palmera (public/palmera/bus.glb).

Run: blender -b --python tools/palmera/bus.py -- <out.glb> [preview_dir]

Game frame (x right, y up, z forward; 11.5 x 2.55 x 3.1 m; axles at z = +-3.2, wheel radius 0.5; the
driver sits on +x, the doors are on -x). Objects:
  bus_body  - painted (white; the game tints it with the livery): the lower body between the arches
  bus_trim  - white upper body and roof, dark glazing frames and pillars, door frames, arch liners,
              bumpers, grille, roof AC pod, mirrors on their arms, rubbing strips
  bus_glass - side windows, windscreen, rear window, door panes
  bus_heads - headlights and the destination sign;  bus_tails - tail lamp strips
  bus_wheel - one steel wheel, axis along x, centred: tyre, dished rim, ten nuts, hub cap
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
K.PREFIX = 'bus_'

L, W, H = 11.5, 2.55, 3.1
ZF, ZR = L / 2, -L / 2
AX = 3.2
PAINT = (1.0, 1.0, 1.0)
WHITE, DARK, BLACK, GREY, METAL, RUBBER = 0xeceeee, 0x16181b, 0x0c0d0e, 0x5b5f64, 0xb8bcc0, 0x0a0a0b
GL = (0.03, 0.04, 0.05)
YB, YM, YT = 0.32, 1.18, 2.98   # body bottom, belt line, roof


def arch_cutters():
    out = []
    for z in (AX, -AX):
        bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=0.64, depth=W + 1, location=K.G(0, 0.5, z), rotation=(0, math.pi / 2, 0))
        out.append(bpy.context.active_object)
    return out


# ---------------------------------------------------------------- painted lower body with wheel arches
lo = K.rounded_box((W, YM - YB, L), (0, (YB + YM) / 2, 0), 0.14)
for c in arch_cutters():
    K.cut(lo, c)
K.finish(lo, PAINT)
K.build('body')

# ---------------------------------------------------------------- trim
up = K.rounded_box((W, YT - YM, L), (0, (YM + YT) / 2, 0), 0.2, 4)
K.finish(up, WHITE)
# arch liners: dark half-tubes inside the arches
for z in (AX, -AX):
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=0.63, depth=W - 0.06, location=K.G(0, 0.5, z), rotation=(0, math.pi / 2, 0), end_fill_type='NOTHING')
    o = bpy.context.active_object
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    for v in o.data.vertices:
        v.select = v.co.z < 0.45   # blender z = game y: drop the lower half
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.delete(type='VERT')
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.shade_smooth()
    K.finish(o, BLACK)
# the glazing band: a dark frame proud of the side, glass laid on it later; pillars between panes
for s in (-1, 1):
    x = s * (W / 2 + 0.004)
    K.box((0.01, 1.32, L - 0.75), (x, 1.98, 0.125), DARK, bevel=0)
    for k in range(7):
        z = ZR + 0.95 + k * 1.52
        if s < 0 and (3.95 < z < 5.2 or -0.45 < z < 0.95):
            continue
        K.box((0.03, 1.3, 0.09), (s * (W / 2 + 0.018), 1.98, z), BLACK, bevel=0.005)
    # rubbing strip along the lower body
    spans = [(ZR + 0.4, -AX - 0.72), (-AX + 0.72, AX - 0.72), (AX + 0.72, ZF - 0.4)]
    for za, zb in spans:
        cuts = [(-0.5, 1.0), (3.95, 5.2)] if s < 0 else []
        segs = [(za, zb)]
        for ca, cb in cuts:
            segs = [q for a0, b0 in segs for q in ((a0, min(b0, ca)), (max(a0, cb), b0)) if q[1] - q[0] > 0.2]
        for a0, b0 in segs:
            K.box((0.03, 0.07, b0 - a0), (s * (W / 2 + 0.012), 0.82, (a0 + b0) / 2), GREY, bevel=0.01)
# doors on the -x side: dark frames round the openings
for z0, z1 in ((4.0, 5.15), (-0.45, 0.95)):
    zc, zw = (z0 + z1) / 2, z1 - z0
    K.box((0.04, 2.38, 0.07), (-(W / 2 + 0.02), 1.5, z0), GREY, bevel=0.01)
    K.box((0.04, 2.38, 0.07), (-(W / 2 + 0.02), 1.5, z1), GREY, bevel=0.01)
    K.box((0.04, 0.07, zw), (-(W / 2 + 0.02), 2.66, zc), GREY, bevel=0.01)
    K.box((0.025, 2.3, 0.05), (-(W / 2 + 0.025), 1.5, zc), BLACK, bevel=0)
    K.box((0.012, 2.3, zw - 0.06), (-(W / 2 + 0.008), 1.5, zc), DARK, bevel=0)
# front: black mask round the windscreen and sign, bumper, lower grille
K.box((W - 0.3, 2.0, 0.01), (0, 1.95, ZF + 0.004), DARK, bevel=0)
K.box((W - 0.06, 0.32, 0.22), (0, 0.42, ZF + 0.04), DARK, bevel=0.04)
for i in range(5):
    K.box((1.1, 0.025, 0.02), (0, 0.66 + i * 0.05, ZF + 0.012), BLACK, bevel=0)
# rear: engine grille louvres, bumper, rear window mask
K.box((W - 0.06, 0.32, 0.22), (0, 0.42, ZR - 0.04), DARK, bevel=0.04)
for i in range(8):
    K.box((1.7, 0.03, 0.03), (0, 0.66 + i * 0.065, ZR - 0.012), BLACK, bevel=0)
K.box((W - 0.5, 1.0, 0.01), (0, 2.2, ZR - 0.004), DARK, bevel=0)
# roof: the AC pod and two hatches
pod = K.rounded_box((1.7, 0.26, 3.0), (0, YT + 0.12, -2.6), 0.1, 3)
K.finish(pod, 0xdfe1e2)
for z in (2.2, 0.0):
    K.box((0.8, 0.06, 0.7), (0, YT + 0.03, z), 0xd2d4d6, bevel=0.02)
# mirrors: arms curving out and forward from the front corners, heads hanging in front of the screen
for s in (-1, 1):
    K.path([(s * (W / 2 - 0.05), 2.75, ZF - 0.1), (s * (W / 2 + 0.25), 2.85, ZF + 0.15), (s * (W / 2 + 0.2), 2.75, ZF + 0.42)], 0.025, BLACK)
    K.soft((0.2, 0.36, 0.08), (s * (W / 2 + 0.2), 2.5, ZF + 0.44), BLACK, bev=0.3, lv=1)
up_trim = K.build('trim')

# ---------------------------------------------------------------- glass
for s in (-1, 1):
    for k in range(6):
        za = ZR + 0.95 + k * 1.52 + 0.06
        zb = za + 1.52 - 0.12
        segs = [(za, zb)]
        if s < 0:
            # cut round the door openings (whole bays used to be dropped, leaving a black slab of
            # frame either side of each door)
            for ca, cb in ((-0.45 - 0.06, 0.95 + 0.06), (3.95 - 0.06, 5.2 + 0.06)):
                segs = [q for a0, b0 in segs for q in ((a0, min(b0, ca)), (max(a0, cb), b0)) if q[1] - q[0] > 0.25]
        for a0, b0 in segs:
            K.box((0.012, 1.18, b0 - a0), (s * (W / 2 + 0.012), 2.0, (a0 + b0) / 2), GL, bevel=0)
    if s > 0:
        K.box((0.012, 1.18, 0.9), (W / 2 + 0.012, 2.0, ZF - 0.75), GL, bevel=0)
for z0, z1 in ((4.0, 5.15), (-0.45, 0.95)):
    for half in (0, 1):
        za = z0 + 0.05 + half * (z1 - z0) / 2
        zb = za + (z1 - z0) / 2 - 0.1
        K.box((0.01, 1.05, zb - za), (-(W / 2 + 0.03), 2.0, (za + zb) / 2), GL, bevel=0)
        K.box((0.01, 0.85, zb - za), (-(W / 2 + 0.03), 0.85, (za + zb) / 2), GL, bevel=0)
K.box((W - 0.42, 1.55, 0.012), (0, 1.85, ZF + 0.012), GL, bevel=0)
K.box((W - 0.7, 0.85, 0.012), (0, 2.2, ZR - 0.012), GL, bevel=0)
K.build('glass')
# ---------------------------------------------------------------- lamps
K.box((W - 0.7, 0.24, 0.02), (0, 2.8, ZF + 0.012), (1.0, 0.62, 0.12), bevel=0)
for s in (-1, 1):
    K.box((0.36, 0.16, 0.03), (s * (W / 2 - 0.34), 0.72, ZF + 0.012), (1, 0.96, 0.88), bevel=0.01)
K.build('heads')
for s in (-1, 1):
    K.box((0.2, 0.5, 0.03), (s * (W / 2 - 0.2), 1.0, ZR - 0.012), (0.85, 0.03, 0.02), bevel=0.01)
    K.box((0.2, 0.12, 0.03), (s * (W / 2 - 0.2), 2.88, ZR - 0.012), (0.85, 0.03, 0.02), bevel=0.01)
K.build('tails')

# ---------------------------------------------------------------- the wheel (axis x, centred)
R, TW = 0.5, 0.3
bpy.ops.mesh.primitive_torus_add(major_radius=R - 0.15, minor_radius=0.15, major_segments=40, minor_segments=10, location=(0, 0, 0), rotation=(0, math.pi / 2, 0))
t = bpy.context.active_object
for v in t.data.vertices:
    v.co.x *= TW / 0.3
bpy.ops.object.shade_smooth()
K.finish(t, RUBBER)
K.cyl(0.31, 0.31, TW * 0.9, (0, 0, 0), 0x1e2023, seg=36, axis='x')
o = K.parts[-1]
K.cyl(0.28, 0.17, 0.05, (TW * 0.42, 0, 0), METAL, seg=36, axis='x')
K.cyl(0.11, 0.09, 0.06, (TW * 0.47, 0, 0), 0xd8dadc, seg=24, axis='x')
for k in range(10):
    a = k * math.tau / 10
    K.cyl(0.016, 0.016, 0.04, (TW * 0.46, math.sin(a) * 0.14, math.cos(a) * 0.14), 0x9a9da1, seg=6, axis='x', sm=False)
w = K.build('wheel')

objs = [o for o in bpy.data.objects if o.name.startswith('bus_')]
print('faces', {o.name: len(o.data.polygons) for o in objs})
if PREV:
    ws = []
    for x, z in ((W / 2 - 0.12, AX), (W / 2 - 0.12, -AX), (-(W / 2 - 0.12), AX), (-(W / 2 - 0.12), -AX)):
        c = w.copy()
        c.data = w.data.copy()
        c.location = K.G(x, 0.5, z)
        if x < 0:
            c.rotation_euler.z = math.pi
        bpy.context.scene.collection.objects.link(c)
        ws.append(c)
    w.hide_render = True
    K.render_preview(PREV, 'bus', ws, [('front', (-5.5, -13.0, 2.4), (0, -3, 1.5)), ('rear', (5.5, 13.0, 2.8), (0, 3, 1.5))])
    for c in ws:
        bpy.data.objects.remove(c, do_unlink=True)
    w.hide_render = False
K.export(OUT)
print('exported', OUT)
