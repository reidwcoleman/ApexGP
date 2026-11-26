"""Roof surfaces for Palmera (public/palmera/roofs.webp: 1024 x 1024 - top row colour, bottom row normals;
left column barrel clay tiles, right column asphalt shingles; each tile a seamless 2 x 2 m patch).

Run: blender -b --python tools/palmera/roofs.py -- <out_dir>

Modelled, then rendered top-down (orthographic, image-up = up the slope) twice: once in near-white
materials under an even white sky (so the result is colour x occlusion and the game tints it with the
roof's colour), once with every surface emitting its normal (Raw view) for a tangent-space normal map.
"""
import sys, math, random
import bpy, bmesh
from mathutils import Vector

OUT = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 48
sc.cycles.use_denoising = True
sc.render.resolution_x = sc.render.resolution_y = 512
w = bpy.data.worlds.new('w')
w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1)
sc.world = w
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 2.0
cam.location = (1, 1, 5)
sc.collection.objects.link(cam)
sc.camera = cam
SIZE = 2.0


def tone_mat(name, base, var_scale=40.0, var=0.12, rough=0.8):
    """near-white material with a fine granular variation (multiplied by the roof colour in game)"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Roughness'].default_value = rough
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'tone'
    attr.attribute_type = 'OBJECT'
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = var_scale
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    mix = nt.nodes.new('ShaderNodeMath')
    mix.operation = 'MULTIPLY_ADD'
    mix.inputs[1].default_value = var
    mix.inputs[2].default_value = base - var * 0.5
    nt.links.new(noise.outputs['Fac'], mix.inputs[0])
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    nt.links.new(mix.outputs[0], mul.inputs[0])
    nt.links.new(attr.outputs['Fac'], mul.inputs[1])
    nt.links.new(mul.outputs[0], p.inputs['Base Color'])
    return m


def clear():
    for o in list(bpy.data.objects):
        if o.type == 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)


def put(obj, m, tone):
    obj.data.materials.append(m)
    obj['tone'] = tone
    return obj


def render_pair(name):
    # colour
    sc.view_settings.view_transform = 'Standard'
    sc.render.filepath = f'{OUT}/{name}_col.png'
    bpy.ops.render.render(write_still=True)
    # normals: override every object with an emission of its (object = world here) normal
    nm = bpy.data.materials.new('nrm')
    nm.use_nodes = True
    nt = nm.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    vm = nt.nodes.new('ShaderNodeVectorMath')
    vm.operation = 'MULTIPLY_ADD'
    vm.inputs[1].default_value = (0.5, 0.5, 0.5)
    vm.inputs[2].default_value = (0.5, 0.5, 0.5)
    em = nt.nodes.new('ShaderNodeEmission')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(geo.outputs['Normal'], vm.inputs[0])
    nt.links.new(vm.outputs[0], em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    vl = sc.view_layers[0]
    vl.material_override = nm
    sc.view_settings.view_transform = 'Raw'
    s0 = sc.cycles.samples
    sc.cycles.samples = 16
    sc.cycles.use_denoising = False
    sc.render.filepath = f'{OUT}/{name}_nrm.png'
    bpy.ops.render.render(write_still=True)
    vl.material_override = None
    sc.cycles.samples = s0
    sc.cycles.use_denoising = True


# ---------------------------------------------------------------- barrel clay tiles
random.seed(11)
clay = tone_mat('clay', 0.9, 25.0, 0.1, 0.75)
COLS, ROWS = 8, 5            # 0.25 m pitch across, 0.4 m courses
pitch, course = SIZE / COLS, SIZE / ROWS
tone = {(i, j): 0.82 + random.random() * 0.18 for i in range(COLS) for j in range(ROWS)}
tone2 = {(i, j): 0.8 + random.random() * 0.2 for i in range(COLS) for j in range(ROWS)}
clear()
for j in range(-1, ROWS + 1):
    for i in range(-1, COLS + 1):
        x0 = i * pitch
        y0 = j * course
        k = (i % COLS, j % ROWS)
        # the pan: a shallow concave channel (a half-cylinder seen from inside, flattened)
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.085, depth=course + 0.06, location=(x0 + pitch * 0.5, y0 + course * 0.5, 0.0), rotation=(math.radians(90), 0, 0))
        pan = bpy.context.active_object
        pan.scale = (1, 0.35, 1)
        pan.rotation_euler.x += math.radians(-4)
        put(pan, clay, tone2[k] * 0.92)
        # the cap: a convex half-cylinder over the joint between two pans, tapered, lower end lifted
        bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.075, radius2=0.062, depth=course + 0.07, location=(x0, y0 + course * 0.5, 0.05), rotation=(math.radians(-90), 0, 0))
        cap = bpy.context.active_object
        cap.scale = (1, 0.85, 1)
        cap.rotation_euler.x += math.radians(5)
        put(cap, clay, tone[k])
bpy.ops.mesh.primitive_plane_add(size=SIZE * 2, location=(1, 1, -0.06))
put(bpy.context.active_object, clay, 0.35)
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
bpy.ops.object.shade_smooth()
render_pair('barrel')

# ---------------------------------------------------------------- asphalt shingles
random.seed(5)
shing = tone_mat('shing', 0.85, 160.0, 0.35, 0.9)
clear()
TABS, CRS = 6, 14            # 0.333 m tabs, 0.143 m exposure
tw, ex = SIZE / TABS, SIZE / CRS
st = {(i, j): 0.72 + random.random() * 0.28 for i in range(TABS) for j in range(CRS)}
for j in range(-1, CRS + 1):
    off = (j % 2) * tw * 0.5
    for i in range(-1, TABS + 1):
        k = (i % TABS, j % CRS)
        x = i * tw + off
        y = j * ex
        # each tab a thin slab, its lower edge proud of the course below (the slope steps)
        bm = bmesh.new()
        r = bmesh.ops.create_cube(bm, size=1)
        for v in r['verts']:
            v.co = Vector((x + tw * 0.5 + v.co.x * (tw - 0.014), y + ex + v.co.y * (ex * 2), 0.03 + v.co.z * 0.01 + (0.5 - v.co.y) * 0.05))
        me = bpy.data.meshes.new('t')
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new('t', me)
        sc.collection.objects.link(o)
        put(o, shing, st[k])
bpy.ops.mesh.primitive_plane_add(size=SIZE * 2, location=(1, 1, -0.03))
put(bpy.context.active_object, shing, 0.25)
render_pair('shingle')
print('rendered roofs')
