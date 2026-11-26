"""Road decals for Palmera (public/palmera/decals.png: 1024 x 256 RGBA, four 256 px tiles).

Run: blender -b --python tools/palmera/decals.py -- <out_dir>

Rendered top-down in Cycles on a transparent background, each tile 1 x 1 m (the grate 1 x 1 m too):
  0 manhole cover - cast iron disc in its ring, a grid of raised studs, two lift holes
  1 storm-drain grate - a steel frame with deep slots
  2 asphalt patch - a darker rectangle with sealed seams, soft at the edges
  3 oil stain - a dark, glossy blotch from noise, fading out
"""
import sys, math, random
import bpy, bmesh
from mathutils import Vector

OUT = sys.argv[sys.argv.index('--') + 1]
random.seed(3)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 64
sc.cycles.use_denoising = True
sc.render.film_transparent = True
sc.view_settings.view_transform = 'Standard'
sc.render.resolution_x = sc.render.resolution_y = 256
w = bpy.data.worlds.new('w')
w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
sc.world = w
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 2.0
sun.rotation_euler = (math.radians(30), math.radians(15), 0)
sc.collection.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 1.0
cam.location = (0, 0, 2)
sc.collection.objects.link(cam)
sc.camera = cam


def mat(name, col, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*col, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    return m


IRON = mat('iron', (0.11, 0.105, 0.1), 0.55, 0.7)
DARK = mat('dark', (0.01, 0.01, 0.01), 0.9)
ASPH = mat('asph', (0.07, 0.07, 0.072), 0.95)
SEAL = mat('seal', (0.025, 0.025, 0.027), 0.6)


def clear():
    for o in list(bpy.data.objects):
        if o.type == 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)


def cyl(r, h, loc, m, seg=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=h, location=loc)
    o = bpy.context.active_object
    o.data.materials.append(m)
    return o


def box(s, loc, m):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.scale = s
    o.data.materials.append(m)
    return o


def shot(name):
    sc.render.filepath = f'{OUT}/decal_{name}.png'
    bpy.ops.render.render(write_still=True)


# 0 manhole: ring, lid, studs, lift holes
clear()
cyl(0.46, 0.02, (0, 0, 0), IRON)
cyl(0.4, 0.03, (0, 0, 0.005), IRON)
cyl(0.395, 0.002, (0, 0, 0.021), DARK)  # the gap round the lid
cyl(0.39, 0.03, (0, 0, 0.008), IRON)
for i in range(-7, 8):
    for j in range(-7, 8):
        x, y = i * 0.05, j * 0.05
        if x * x + y * y < 0.34 ** 2 and not (abs(x) < 0.07 and abs(y) < 0.07):
            box((0.025, 0.025, 0.012), (x, y, 0.028), IRON)
for x in (-0.2, 0.2):
    cyl(0.025, 0.01, (x, 0, 0.025), DARK, 16)
cyl(0.07, 0.012, (0, 0, 0.028), IRON, 32)
shot('manhole')
# 1 grate: frame with slots
clear()
box((0.9, 0.5, 0.02), (0, 0, 0), IRON)
for i in range(9):
    box((0.06, 0.4, 0.01), (-0.36 + i * 0.09, 0, 0.012), DARK)
shot('grate')
# 2 patch: a darker slab of asphalt with sealed seams
clear()
box((0.8, 0.6, 0.01), (0, 0, 0), ASPH)
for s, loc in (((0.82, 0.02, 0.012), (0, 0.3, 0)), ((0.82, 0.02, 0.012), (0, -0.3, 0)), ((0.02, 0.62, 0.012), (0.4, 0, 0)), ((0.02, 0.62, 0.012), (-0.4, 0, 0))):
    box(s, loc, SEAL)
shot('patch')
# 3 oil stain: a noise-shaped glossy blotch, alpha from the noise
clear()
m = bpy.data.materials.new('oil')
m.use_nodes = True
m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
nt = m.node_tree
p = nt.nodes['Principled BSDF']
p.inputs['Base Color'].default_value = (0.01, 0.01, 0.012, 1)
p.inputs['Roughness'].default_value = 0.15
tc = nt.nodes.new('ShaderNodeTexCoord')
noise = nt.nodes.new('ShaderNodeTexNoise')
noise.inputs['Scale'].default_value = 3.5
noise.inputs['Detail'].default_value = 6
grad = nt.nodes.new('ShaderNodeTexGradient')
grad.gradient_type = 'SPHERICAL'
mapping = nt.nodes.new('ShaderNodeMapping')
mapping.inputs['Scale'].default_value = (2.4, 2.4, 2.4)
nt.links.new(tc.outputs['Object'], mapping.inputs['Vector'])
nt.links.new(mapping.outputs['Vector'], grad.inputs['Vector'])
nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
mul = nt.nodes.new('ShaderNodeMath')
mul.operation = 'MULTIPLY'
nt.links.new(grad.outputs['Fac'], mul.inputs[0])
nt.links.new(noise.outputs['Fac'], mul.inputs[1])
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].position = 0.12
ramp.color_ramp.elements[1].position = 0.35
nt.links.new(mul.outputs['Value'], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], p.inputs['Alpha'])
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
pl = bpy.context.active_object
pl.data.materials.append(m)
shot('oil')
print('rendered decals')
