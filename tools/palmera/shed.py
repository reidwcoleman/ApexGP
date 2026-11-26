"""Facade tiles for Palmera's sheds and warehouses (public/palmera/shed.webp, 1024 x 512).

Run: blender -b --python tools/palmera/shed.py -- <out_dir>

Two 4 x 4 m bays, modelled and rendered head-on under an even white sky (so each image is colour x
occlusion only - the game's own sun does the lighting and the building's colour tints it):
  left  - corrugated metal siding, a clerestory window strip near the top, a downpipe, a kick strip
  right - the same with a recessed roller door: slatted door, steel frame, guide rails, header box
"""
import sys, math
import bpy, bmesh
from mathutils import Vector

OUT = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 64
sc.cycles.use_denoising = True
sc.view_settings.view_transform = 'Standard'
sc.render.resolution_x = sc.render.resolution_y = 512
w = bpy.data.worlds.new('w')
w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
sc.world = w


def mat(name, col, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*col, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    return m


SID = mat('siding', (0.82, 0.82, 0.82), 0.7)
DOOR = mat('door', (0.72, 0.73, 0.74), 0.5)
DARK = mat('dark', (0.04, 0.045, 0.05), 0.2)
STEEL = mat('steel', (0.35, 0.36, 0.38), 0.4)
CONC = mat('conc', (0.6, 0.58, 0.55), 0.9)
GLASS = mat('glass', (0.06, 0.08, 0.1), 0.05)


def add(me_name, build, m):
    bm = bmesh.new()
    build(bm)
    me = bpy.data.meshes.new(me_name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(me_name, me)
    sc.collection.objects.link(o)
    o.data.materials.append(m)
    return o


def box(name, c, s, m):
    def b(bm):
        r = bmesh.ops.create_cube(bm, size=1)
        for v in r['verts']:
            v.co = Vector((c[0] + v.co.x * s[0], c[1] + v.co.y * s[1], c[2] + v.co.z * s[2]))
    return add(name, b, m)


def corrugated(name, x0, x1, z0, z1, hole=None):
    """vertical ribs (period 0.15 m, 15 mm deep) facing -y; hole = (x0, x1, z0, z1) left open"""
    def b(bm):
        n = int((x1 - x0) / 0.025)
        cols = []
        for i in range(n + 1):
            x = x0 + (x1 - x0) * i / n
            y = 0.0075 * math.cos(x / 0.15 * math.tau)
            cols.append((x, y))
        for i in range(n):
            (xa, ya), (xb, yb) = cols[i], cols[i + 1]
            spans = [(z0, z1)]
            if hole and hole[0] < (xa + xb) / 2 < hole[1]:
                spans = [(z0, hole[2]), (hole[3], z1)]
            for za, zb in spans:
                if zb - za < 1e-3:
                    continue
                vs = [bm.verts.new((xa, ya, za)), bm.verts.new((xb, yb, za)), bm.verts.new((xb, yb, zb)), bm.verts.new((xa, ya, zb))]
                bm.faces.new(vs)
    o = add(name, b, SID)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.shade_smooth()
    o.select_set(False)
    return o


def common(tag):
    # kick strip, clerestory windows with mullions, a downpipe with brackets
    box(tag + 'kick', (2, -0.03, 0.12), (4, 0.06, 0.24), CONC)
    box(tag + 'win', (2, -0.01, 3.35), (3.6, 0.02, 0.5), GLASS)
    box(tag + 'wsill', (2, -0.04, 3.08), (3.7, 0.06, 0.04), STEEL)
    box(tag + 'whead', (2, -0.04, 3.62), (3.7, 0.06, 0.04), STEEL)
    for k in range(5):
        box(tag + 'mull%d' % k, (0.2 + k * 0.9, -0.03, 3.35), (0.04, 0.05, 0.54), STEEL)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.045, depth=4.0, location=(3.82, -0.09, 2.0))
    p = bpy.context.active_object
    p.data.materials.append(STEEL)
    for z in (0.8, 2.0, 3.2):
        box(tag + 'br%.1f' % z, (3.82, -0.05, z), (0.12, 0.08, 0.03), STEEL)


def render(path):
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 4.0
    cam.location = (2, -6, 2)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


# left: plain siding bay
corrugated('sid', 0, 4, 0.24, 4)
common('a')
render(OUT + '/shed_siding.png')
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
# right: a roller door bay
corrugated('sid', 0, 4, 0.24, 4, hole=(0.4, 3.6, 0.0, 2.95))
common('b')
# the opening's frame, the recess, the slatted door, guide rails, the header box
for x in (0.37, 3.63):
    box('jamb%.2f' % x, (x, -0.05, 1.5), (0.08, 0.1, 3.0), STEEL)
    box('rail%.2f' % x, (x + (0.07 if x < 2 else -0.07), 0.08, 1.45), (0.06, 0.06, 2.9), STEEL)
box('lintel', (2, -0.05, 3.0), (3.34, 0.1, 0.1), STEEL)
box('recessL', (0.42, 0.06, 1.47), (0.02, 0.2, 2.94), CONC)
box('recessR', (3.58, 0.06, 1.47), (0.02, 0.2, 2.94), CONC)
box('header', (2, 0.06, 2.82), (3.16, 0.24, 0.3), STEEL)
def slats(bm):
    for i in range(32):
        z0 = i * 0.084
        y = 0.15
        a = [bm.verts.new((0.45, y, z0)), bm.verts.new((3.55, y, z0)), bm.verts.new((3.55, y - 0.012, z0 + 0.042)), bm.verts.new((0.45, y - 0.012, z0 + 0.042))]
        b = [a[3], a[2], bm.verts.new((3.55, y, z0 + 0.084)), bm.verts.new((0.45, y, z0 + 0.084))]
        bm.faces.new(a)
        bm.faces.new(b)
add('door', slats, DOOR)
box('bottomrail', (2, 0.13, 0.03), (3.1, 0.05, 0.06), DARK)
box('handle', (2, 0.12, 0.5), (0.3, 0.03, 0.04), STEEL)
render(OUT + '/shed_door.png')
print('rendered shed tiles')
