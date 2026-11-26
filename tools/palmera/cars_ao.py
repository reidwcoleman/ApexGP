"""Bake ambient occlusion into Palmera's car bodies (public/palmera/cars.glb).

Run: blender -b --python tools/palmera/cars_ao.py -- <in.glb> <out.glb>

For each car, with the others hidden: a ground plane and the four tyres the game puts on it (the
wheels are built in code, so they're stand-ins here) are added as occluders, Cycles bakes AO into a
vertex colour layer, and that is multiplied into the body's own colour (white = paint, dark = trim),
floored at 0.32 so paint never reads as trim in the game's shader. Wheel arches, sills, the cabin's
base, lamp recesses and panel shut lines come out darker; the glass, lamps and names are untouched.
"""
import sys
import bpy
import bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]

# wheelbase and wheel radius per model (carKit.ts BODY)
BODY = {
    'sedan': (2.83, 0.33), 'compact': (2.64, 0.31), 'suv': (2.95, 0.38), 'gwagon': (2.89, 0.39),
    'pickup': (3.68, 0.42), 'coupe': (2.45, 0.34), 'super': (2.7, 0.36), 'muscle': (2.86, 0.36),
    'police': (3.05, 0.35), 'policeSuv': (3.02, 0.38), 'taxi': (2.83, 0.33),
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 128
scene.render.bake.target = 'VERTEX_COLORS'
scene.world = bpy.data.worlds.new('w')
scene.world.light_settings.distance = 0.9  # AO reach (m)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
bodies = [o for o in meshes if o.name.endswith('_body')]


def occluders(body, wb, r):
    """ground + tyres under this body, in Blender space (z up, glTF +z forward = Blender -y)"""
    bb = [body.matrix_world @ Vector(c) for c in body.bound_box]
    xs, ys = [p.x for p in bb], [p.y for p in bb]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    w = max(xs) - min(xs)
    made = []
    bpy.ops.mesh.primitive_plane_add(size=1, location=(cx, cy, 0))
    g = bpy.context.active_object
    g.scale = (w + 6, (max(ys) - min(ys)) + 6, 1)
    made.append(g)
    for sx in (-1, 1):
        for sy in (-1, 1):
            bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=0.24, vertices=24,
                                                location=(cx + sx * (w / 2 - 0.12 - 0.08), cy + sy * wb / 2, r),
                                                rotation=(0, 1.5708, 0))
            made.append(bpy.context.active_object)
    return made


done = 0
for body in bodies:
    car = body.name[len('car_'):-len('_body')]
    if car == 'van':
        # the game measures the van: wheelbase 58% of its length, radius 0.37
        L = max((body.matrix_world @ Vector(c)).y for c in body.bound_box) - min((body.matrix_world @ Vector(c)).y for c in body.bound_box)
        wb, r = L * 0.58, 0.37
    elif car not in BODY:
        print('skip (no wheel data):', car)
        continue
    else:
        wb, r = BODY[car]
    # only this car's body (and its lamps) occlude; glass is see-through
    for o in meshes:
        mine = o.name.startswith('car_' + car + '_')
        o.hide_render = not mine or o.name.endswith('_glass')
    extra = occluders(body, wb, r)
    me = body.data
    if 'AO' in me.color_attributes:
        me.color_attributes.remove(me.color_attributes['AO'])
    ao = me.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
    me.color_attributes.active_color = ao
    # the bake needs a material with an active image-less node: vertex-colour target is fine with any
    for o in bpy.context.selected_objects:
        o.select_set(False)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.bake(type='AO')
    col = me.color_attributes['Color']
    n = 0
    lo = 1.0
    for i in range(len(col.data)):
        a = ao.data[i].color[0]
        k = max(0.32, min(1.0, a ** 0.85))
        lo = min(lo, k)
        c = col.data[i].color
        col.data[i].color = (c[0] * k, c[1] * k, c[2] * k, c[3])
        n += 1
    me.color_attributes.remove(ao)
    me.color_attributes.active_color = me.color_attributes['Color']
    for o in extra:
        bpy.data.objects.remove(o, do_unlink=True)
    done += 1
    print(f'baked {car}: {n} corners, darkest {lo:.2f}')

for o in meshes:
    o.hide_render = False
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_vertex_color='ACTIVE', export_apply=False,
                          export_materials='EXPORT', export_yup=True)
print('exported', DST, 'bodies baked', done)
