"""An original naked sport motorbike for Palmera (public/palmera/bike.glb).

Run: blender -b --python tools/palmera/bike.py -- <out.glb> [preview_dir]

Game frame (x right, y up, z forward; wheels at z = +-0.7, radius 0.32). Objects:
  bike_body  - the painted parts (white; the game tints them): tank, tail, headlight cowl, fenders, belly pan
  bike_trim  - trellis frame, gold forks, triple clamps, bars, mirrors, engine with finned cylinders,
               radiator, headers and silencer, swingarm, shock, chain and sprockets, seat, pegs, plate
  bike_glass - the little fly screen;  bike_heads / bike_tails - the lamp lenses
  bike_wheel - one wheel, axis along x, centred: tyre, rim lips, three split spokes, hub, brake disc
"""
import sys, math
import bpy, bmesh
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
PREV = args[1] if len(args) > 1 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def hexc(h):
    c = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
    return tuple((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def G(x, y, z):
    return Vector((x, -z, y))


parts = []


def finish(o, col, bevel=0.0):
    me = o.data
    a = me.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
    c = hexc(col) if isinstance(col, int) else col
    for d in a.data:
        d.color = (*c, 1.0)
    if bevel > 0:
        m = o.modifiers.new('b', 'BEVEL')
        m.width = bevel
        m.segments = 1
        m.limit_method = 'ANGLE'
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='b')
    parts.append(o)
    return o


def smooth(o, ang=40):
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(ang))
    o.select_set(False)
    return o


def box(s, p, col, bevel=0.004, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=G(*p), rotation=(rot[0], rot[2], rot[1]))
    o = bpy.context.active_object
    o.scale = (s[0], s[2], s[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, col, min(bevel, min(s) * 0.4))


def soft(s, p, col, rot=(0, 0, 0), taper=(1.0, 1.0), front=(1.0, 1.0), bev=0.32, lv=2):
    """a rounded, optionally tapered body panel: a cube, bevelled then subdivided"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    o = bpy.context.active_object
    o.scale = (s[0], s[2], s[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for v in o.data.vertices:
        # Blender +y is game -z (the rear)
        k = taper if v.co.y > 0 else front
        v.co.x *= k[0]
        v.co.z *= k[1]
    m = o.modifiers.new('b', 'BEVEL')
    m.width = bev * min(s)
    m.segments = 2
    s2 = o.modifiers.new('s', 'SUBSURF')
    s2.levels = lv
    s2.render_levels = lv
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='b')
    bpy.ops.object.modifier_apply(modifier='s')
    o.rotation_euler = (rot[0], rot[2], rot[1])
    o.location = G(*p)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
    bpy.ops.object.shade_smooth()
    return finish(o, col)


def cyl(r1, r2, h, p, col, seg=16, axis='y', caps=True, sm=True):
    rot = {'y': (0, 0, 0), 'x': (0, math.pi / 2, 0), 'z': (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r1, radius2=r2, depth=h, location=G(*p), rotation=rot, end_fill_type='NGON' if caps else 'NOTHING')
    o = finish(bpy.context.active_object, col)
    return smooth(o) if sm else o


def tube(a, b, r, col, sides=10):
    A, B = G(*a), G(*b)
    d = B - A
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=r, depth=d.length, location=(A + B) / 2)
    o = bpy.context.active_object
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
    return smooth(finish(o, col))


def path(pts, r, col, sides=10):
    """a bent tube through game points (a joint ball at each bend)"""
    for a, b in zip(pts, pts[1:]):
        tube(a, b, r, col, sides)
    for q in pts[1:-1]:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=sides, ring_count=sides // 2, radius=r, location=G(*q))
        bpy.ops.object.shade_smooth()
        finish(bpy.context.active_object, col)


def build(name):
    global parts
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = 'bike_' + name
    parts = []
    return o


PAINT = (1.0, 1.0, 1.0)
GRAPH, BLACK, METAL, CHROME, GOLD, RUBBER = 0x2b2d31, 0x111214, 0x8c8f94, 0xc9ccd0, 0xc9962e, 0x0a0a0b
SEAT = 0x1a1716

# ---------------------------------------------------------------- painted bodywork
# tank: deep at the front, tapering into the seat; knee cut-outs come from the taper
soft((0.36, 0.25, 0.52), (0, 0.93, 0.17), PAINT, rot=(0.08, 0, 0), taper=(0.72, 0.8), bev=0.4)
# tank cap
# tail: a slim wedge rising to the back
soft((0.2, 0.13, 0.44), (0, 0.96, -0.62), PAINT, rot=(-0.2, 0, 0), taper=(0.55, 0.7), front=(1.0, 1.0), bev=0.35)
# headlight cowl, front fender, belly pan, side panels under the seat
soft((0.26, 0.22, 0.16), (0, 0.95, 0.66), PAINT, rot=(-0.35, 0, 0), taper=(1.1, 1.05), bev=0.4)
# front fender: short segments along an arc over the tyre
for k in range(5):
    a = math.radians(55 + k * 17)
    soft((0.13, 0.03, 0.12), (0, 0.32 + math.sin(a) * 0.37, 0.7 + math.cos(a) * 0.37), PAINT, rot=(math.pi / 2 - a, 0, 0), bev=0.3, lv=1)
soft((0.3, 0.12, 0.34), (0, 0.3, 0.06), PAINT, rot=(0.1, 0, 0), taper=(0.8, 0.8), bev=0.3)
body = build('body')

# ---------------------------------------------------------------- trim
# trellis frame: steering head to the swingarm pivot, upper and lower rails with diagonals
head_t, head_b = (0, 1.0, 0.5), (0, 0.84, 0.55)
cyl(0.035, 0.035, 0.2, (0, 0.92, 0.52), GRAPH, seg=12, axis='y')
for s in (-1, 1):
    up = [(s * 0.05, 0.97, 0.48), (s * 0.15, 0.86, 0.12), (s * 0.15, 0.74, -0.14)]
    lo = [(s * 0.05, 0.86, 0.5), (s * 0.15, 0.66, 0.22), (s * 0.15, 0.5, -0.12)]
    path(up, 0.016, 0xb32020)
    path(lo, 0.016, 0xb32020)
    tube(up[1], lo[1], 0.012, 0xb32020)
    tube(up[1], lo[2], 0.012, 0xb32020)
    tube(up[2], lo[2], 0.016, 0xb32020)
    # subframe to the tail
    tube(up[2], (s * 0.08, 0.92, -0.72), 0.012, 0xb32020)
    tube(lo[2], (s * 0.08, 0.9, -0.55), 0.011, 0xb32020)
# forks: gold upside-down legs, black stanchion lowers, triple clamps, axle
for s in (-1, 1):
    tube((s * 0.085, 0.36, 0.69), (s * 0.085, 0.66, 0.6), 0.026, GOLD, 14)
    tube((s * 0.085, 0.66, 0.6), (s * 0.085, 1.04, 0.49), 0.03, BLACK, 14)
    box((0.04, 0.06, 0.05), (s * 0.085, 0.34, 0.7), BLACK)
box((0.24, 0.035, 0.09), (0, 0.86, 0.555), METAL, rot=(-0.3, 0, 0))
box((0.24, 0.03, 0.09), (0, 1.03, 0.5), METAL, rot=(-0.3, 0, 0))
# bars, grips, levers, clocks, mirrors
path([(-0.36, 1.1, 0.42), (-0.2, 1.08, 0.47), (0.2, 1.08, 0.47), (0.36, 1.1, 0.42)], 0.012, BLACK)
for s in (-1, 1):
    tube((s * 0.3, 1.095, 0.44), (s * 0.38, 1.1, 0.42), 0.017, RUBBER)
    tube((s * 0.24, 1.09, 0.49), (s * 0.34, 1.09, 0.5), 0.006, METAL)
    tube((s * 0.24, 1.09, 0.46), (s * 0.29, 1.2, 0.47), 0.006, BLACK)
    soft((0.1, 0.055, 0.025), (s * 0.31, 1.22, 0.47), BLACK, bev=0.3, lv=1)
soft((0.13, 0.08, 0.05), (0, 1.1, 0.53), BLACK, rot=(-0.6, 0, 0), bev=0.3, lv=1)
# radiator
box((0.34, 0.26, 0.04), (0, 0.66, 0.38), 0x1d1f22, rot=(0.25, 0, 0))
for i in range(9):
    box((0.335, 0.004, 0.045), (0, 0.55 + i * 0.026, 0.39 - i * 0.0065), 0x3a3d41, bevel=0)
# engine: crankcase, finned twin-cylinder block leaning forward, cam cover, covers
soft((0.3, 0.26, 0.42), (0, 0.46, 0.0), 0x34363a, bev=0.15, lv=1)
for k in range(7):
    box((0.29, 0.012, 0.2), (0, 0.6 + k * 0.03, 0.17 + k * 0.012), 0x5d6066, bevel=0, rot=(0.35, 0, 0))
soft((0.3, 0.07, 0.21), (0, 0.82, 0.25), 0x2a2c30, rot=(0.35, 0, 0), bev=0.25, lv=1)
cyl(0.11, 0.11, 0.04, (0.165, 0.44, 0.02), METAL, seg=24, axis='x')
cyl(0.08, 0.08, 0.04, (-0.165, 0.47, 0.08), 0x34363a, seg=24, axis='x')
# exhaust: two headers out of the front of the head, under the engine, into a stubby side silencer
for s in (-1, 1):
    path([(s * 0.06, 0.68, 0.33), (s * 0.08, 0.5, 0.4), (s * 0.06, 0.26, 0.3), (s * 0.03, 0.2, 0.05), (0.08, 0.24, -0.15)], 0.021, 0x9a8a78, 10)
path([(0.08, 0.24, -0.15), (0.17, 0.33, -0.3)], 0.03, 0x8c8f94, 12)
cyl(0.068, 0.06, 0.34, (0.19, 0.4, -0.45), CHROME, seg=20, axis='z')
o = parts[-1]
o.rotation_euler.x += math.radians(-14)
cyl(0.055, 0.055, 0.02, (0.19, 0.44, -0.625), BLACK, seg=20, axis='z')
# swingarm, shock, chain and sprockets
for s in (-1, 1):
    box((0.04, 0.065, 0.58), (s * 0.12, 0.4, -0.43), 0x5a5d62, rot=(0.24, 0, 0), bevel=0.01)
box((0.24, 0.05, 0.06), (0, 0.48, -0.16), 0x5a5d62)
tube((0, 0.78, -0.2), (0, 0.46, -0.42), 0.02, METAL, 12)
for k in range(8):
    t = k / 7
    cyl(0.038, 0.038, 0.014, (0, 0.74 - 0.26 * t, -0.23 - 0.17 * t), 0xd8b21c, seg=14, axis='y')
cyl(0.055, 0.055, 0.012, (-0.155, 0.42, 0.02), BLACK, seg=16, axis='x')
cyl(0.1, 0.1, 0.008, (-0.14, 0.32, -0.7), METAL, seg=24, axis='x')
tube((-0.15, 0.475, 0.02), (-0.15, 0.42, -0.7), 0.008, BLACK, 6)
tube((-0.15, 0.365, 0.02), (-0.15, 0.22, -0.7), 0.008, BLACK, 6)
# seat and pillion
soft((0.27, 0.075, 0.42), (0, 0.97, -0.3), SEAT, rot=(-0.1, 0, 0), taper=(0.7, 1.0), bev=0.35)
soft((0.16, 0.05, 0.16), (0, 1.03, -0.6), SEAT, rot=(-0.2, 0, 0), bev=0.4, lv=1)
# pegs, hangers, rear hugger, plate
for s in (-1, 1):
    tube((s * 0.15, 0.4, -0.12), (s * 0.24, 0.4, -0.12), 0.012, METAL, 8)
    box((0.02, 0.12, 0.07), (s * 0.15, 0.46, -0.14), 0x5a5d62)
tube((0, 0.9, -0.76), (0, 0.74, -0.86), 0.012, BLACK, 8)
box((0.19, 0.12, 0.01), (0, 0.7, -0.87), 0xe8e6de, rot=(-0.2, 0, 0))
# airbox / battery box filling the space under the seat
soft((0.22, 0.16, 0.42), (0, 0.83, -0.3), 0x1d1f22, rot=(-0.1, 0, 0), bev=0.2, lv=1)
soft((0.13, 0.03, 0.3), (0, 0.62, -0.62), BLACK, rot=(0.3, 0, 0), bev=0.3, lv=1)
trim = build('trim')

# glass: a small fly screen over the clocks
soft((0.2, 0.14, 0.012), (0, 1.12, 0.62), (0.05, 0.06, 0.07), rot=(-0.55, 0, 0), bev=0.3, lv=1)
build('glass')
# lamps: round headlight lens, tail strip, little indicators
cyl(0.085, 0.085, 0.02, (0, 0.95, 0.745), (1, 0.96, 0.88), seg=24, axis='z')
build('heads')
soft((0.12, 0.035, 0.02), (0, 1.0, -0.85), (0.85, 0.03, 0.02), rot=(-0.3, 0, 0), bev=0.3, lv=1)
build('tails')

# ---------------------------------------------------------------- the wheel (axis along x, centred)
R, TW = 0.32, 0.14
bpy.ops.mesh.primitive_torus_add(major_radius=R - TW * 0.42, minor_radius=TW * 0.42, major_segments=40, minor_segments=10, location=(0, 0, 0), rotation=(0, math.pi / 2, 0))
o = bpy.context.active_object
o.scale = (1.0, 1.0, 1.0)
for v in o.data.vertices:
    v.co.z *= 1.0
bpy.ops.object.shade_smooth()
finish(o, RUBBER)
for s in (-1, 1):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.235, minor_radius=0.01, major_segments=36, minor_segments=6, location=(s * 0.045, 0, 0), rotation=(0, math.pi / 2, 0))
    bpy.ops.object.shade_smooth()
    finish(bpy.context.active_object, BLACK)
bpy.ops.mesh.primitive_cylinder_add(vertices=36, radius=0.232, depth=0.09, location=(0, 0, 0), rotation=(0, math.pi / 2, 0), end_fill_type='NOTHING')
finish(bpy.context.active_object, 0x1c1d1f)
bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.05, depth=0.12, location=(0, 0, 0), rotation=(0, math.pi / 2, 0))
finish(bpy.context.active_object, METAL)
# three split spokes (pairs)
for k in range(3):
    a = k * math.tau / 3
    for d in (-0.16, 0.16):
        a0, a1 = a, a + d
        A = Vector((0, math.cos(a0) * 0.05, math.sin(a0) * 0.05))
        B = Vector((0, math.cos(a1) * 0.23, math.sin(a1) * 0.23))
        dd = B - A
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.011, depth=dd.length, location=(A + B) / 2)
        sp = bpy.context.active_object
        sp.rotation_mode = 'QUATERNION'
        sp.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(dd.normalized())
        bpy.ops.object.shade_smooth()
        finish(sp, BLACK)
# brake disc with a wavy look from alternating bright/dark sectors
bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=0.13, depth=0.006, location=(0.058, 0, 0), rotation=(0, math.pi / 2, 0))
finish(bpy.context.active_object, 0x7d8085)
bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.09, depth=0.01, location=(0.058, 0, 0), rotation=(0, math.pi / 2, 0))
finish(bpy.context.active_object, BLACK)
w = build('wheel')

objs = [o for o in bpy.data.objects if o.name.startswith('bike_')]
print('faces', {o.name: len(o.data.polygons) for o in objs})

if PREV:
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.color_type = 'VERTEX'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = 900, 600
    # wheels placed for the preview only
    import copy
    pw = []
    for z in (0.7, -0.7):
        c = w.copy()
        c.data = w.data.copy()
        c.location = G(0, 0.32, z)
        sc.collection.objects.link(c)
        pw.append(c)
    w.hide_render = True
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    for nm, loc in (('side', (2.6, 0, 0.7)), ('q', (1.9, -1.9, 1.3))):
        cam.location = loc
        d = Vector((0, 0, 0.6)) - cam.location
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = f'{PREV}/bike_{nm}.png'
        bpy.ops.render.render(write_still=True)
    for c in pw:
        bpy.data.objects.remove(c, do_unlink=True)
    w.hide_render = False

for o in bpy.context.selected_objects:
    o.select_set(False)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_vertex_color='ACTIVE', export_materials='NONE', export_yup=True, export_apply=False)
print('exported', OUT)
