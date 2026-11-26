"""Leaves and leaf-card shrubs for Palmera (public/palmera/leaves.png + public/palmera/foliage.glb).

Run: blender -b --python tools/palmera/foliage.py -- <out_dir>

1. A leaf atlas: ~220 leaves (pointed ellipses with a slight cup and a tilt, a dozen greens and a few
   yellowing ones) scattered over a square and rendered from above in Cycles under a sun and sky, on
   a transparent background - real shaded leaves for the game to alpha-cut.
2. Shrubs, hedges and flower-bed mounds as leaf cards: quads sitting on (and a little inside) an
   ellipsoid shell, turned outward with a random twist, each showing a random part of the atlas;
   vertex colour darkens toward the middle so the inside of a bush is shady. A low-card version of
   each for the distance. Objects fol_<kind> and fol_<kind>_lod, same size and pivot as the game's.
"""
import sys, math, random
import bpy, bmesh
from mathutils import Vector, Matrix, Euler

OUT = sys.argv[sys.argv.index('--') + 1]
random.seed(5)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# ---- 1. the leaf atlas -------------------------------------------------------------------
sc.render.engine = 'CYCLES'
sc.cycles.samples = 48
sc.cycles.use_denoising = True
sc.render.film_transparent = True
sc.view_settings.view_transform = 'Standard'
sc.render.resolution_x = sc.render.resolution_y = 512
w = bpy.data.worlds.new('w')
w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.65, 0.8, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 0.6
sc.world = w
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(35), math.radians(20), 0)
sc.collection.objects.link(sun)

mat = bpy.data.materials.new('leaf')
mat.use_nodes = True
nt = mat.node_tree
p = nt.nodes['Principled BSDF']
a = nt.nodes.new('ShaderNodeVertexColor')
a.layer_name = 'Col'
nt.links.new(a.outputs['Color'], p.inputs['Base Color'])
p.inputs['Roughness'].default_value = 0.45
p.inputs['Subsurface Weight'].default_value = 0.0

GREENS = [(0.05, 0.16, 0.03), (0.07, 0.2, 0.04), (0.1, 0.24, 0.05), (0.06, 0.13, 0.035), (0.12, 0.27, 0.06), (0.08, 0.22, 0.07),
          (0.04, 0.12, 0.03), (0.14, 0.3, 0.08), (0.09, 0.18, 0.04), (0.11, 0.21, 0.035)]
bm = bmesh.new()
col = bm.loops.layers.float_color.new('Col')
for i in range(400):
    L = random.uniform(0.07, 0.12)
    Wd = L * random.uniform(0.38, 0.5)
    c = random.choice(GREENS) if random.random() > 0.06 else (0.3, 0.3, 0.08)
    # an outline: a pointed ellipse, then fan triangles to a raised midrib
    n = 14
    ring = []
    for k in range(n):
        t = k / n * math.tau
        x = math.cos(t) * L / 2
        y = math.sin(t) * Wd / 2 * (1 - 0.35 * (math.cos(t) > 0) * math.cos(t) ** 2)
        ring.append(Vector((x, y, -abs(y) * 0.5)))  # cupped: the edges dip
    m = Matrix.Translation((random.uniform(-0.47, 0.47), random.uniform(-0.47, 0.47), random.uniform(0, 0.05))) @ \
        Euler((random.uniform(-0.4, 0.4), random.uniform(-0.4, 0.4), random.uniform(0, math.tau))).to_matrix().to_4x4()
    cv = bm.verts.new(m @ Vector((0, 0, 0.004)))
    vs = [bm.verts.new(m @ v) for v in ring]
    shade = random.uniform(0.85, 1.15)
    for k in range(n):
        f = bm.faces.new((cv, vs[k], vs[(k + 1) % n]))
        for l in f.loops:
            l[col] = (c[0] * shade, c[1] * shade, c[2] * shade, 1)
me = bpy.data.meshes.new('leaves')
bm.to_mesh(me)
bm.free()
ob = bpy.data.objects.new('leaves', me)
ob.data.materials.append(mat)
sc.collection.objects.link(ob)
bpy.context.view_layer.objects.active = ob
ob.select_set(True)
bpy.ops.object.shade_smooth()
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 1.0
cam.location = (0, 0, 2)
sc.collection.objects.link(cam)
sc.camera = cam
sc.render.filepath = OUT + '/leaves.png'
bpy.ops.render.render(write_still=True)
print('rendered leaves')

# ---- 2. the card shrubs -----------------------------------------------------------------
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)


def card_bush(name, radii, cy, cards, size, floor=0.02):
    """cards on an ellipsoid (radii x, y, z in game space, centre height cy), Blender z up"""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    cl = bm.loops.layers.float_color.new('Color')
    rx, ry, rz = radii
    for i in range(cards):
        # a point on (and a little inside) the shell, more of them on the upper half
        u = random.uniform(-0.35, 1.0)
        th = random.uniform(0, math.tau)
        r = math.sqrt(max(0.0, 1 - u * u))
        depth = random.uniform(0.55, 1.0)
        nx, ny, nz = r * math.cos(th), r * math.sin(th), u
        c = Vector((nx * rx * depth, ny * rz * depth, cy + nz * ry * depth))
        if c.z < floor + size * 0.2:
            c.z = floor + size * 0.2
        out = Vector((nx / rx, ny / rz, nz / ry)).normalized()
        # the card faces outward, then a random twist and tilt
        rot = out.to_track_quat('Z', 'Y').to_matrix().to_4x4() @ Euler((random.uniform(-0.5, 0.5), random.uniform(-0.5, 0.5), random.uniform(0, math.tau))).to_matrix().to_4x4()
        s = size * random.uniform(0.8, 1.25)
        corners = [Vector((-s / 2, -s / 2, 0)), Vector((s / 2, -s / 2, 0)), Vector((s / 2, s / 2, 0)), Vector((-s / 2, s / 2, 0))]
        vs = [bm.verts.new(c + (rot @ v)) for v in corners]
        f = bm.faces.new(vs)
        # a random half of the atlas (leaves at a sensible scale), sometimes flipped
        u0, v0 = random.uniform(0, 0.5), random.uniform(0, 0.5)
        fl = random.random() < 0.5
        uvs = [(u0, v0), (u0 + 0.5, v0), (u0 + 0.5, v0 + 0.5), (u0, v0 + 0.5)]
        if fl:
            uvs = [uvs[1], uvs[0], uvs[3], uvs[2]]
        k = 0.5 + 0.5 * depth  # shady inside
        k *= 0.8 + 0.2 * min(1, (c.z - floor) / (cy + ry))  # and toward the ground
        for l, t in zip(f.loops, uvs):
            l[uv].uv = t
            l[cl] = (k, k, k, 1)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    me.color_attributes.active_color = me.color_attributes['Color']
    return o


# the game's shrub ~1.6 m across and 1.2 tall; hedge similar but denser and squarer; mound low
for name, radii, cy, n, nl, size in (('shrub', (0.75, 0.6, 0.75), 0.62, 90, 26, 0.55), ('hedge', (0.8, 0.55, 0.65), 0.58, 100, 28, 0.55),
                                     ('mound', (0.7, 0.35, 0.7), 0.25, 40, 14, 0.45)):
    card_bush('fol_' + name, radii, cy, n, size)
    card_bush('fol_' + name + '_lod', radii, cy, nl, size * 1.5)
bpy.ops.export_scene.gltf(filepath=OUT + '/foliage.glb', export_format='GLB', export_vertex_color='ACTIVE', export_texcoords=True, export_materials='NONE', export_yup=True)
print('exported foliage')
