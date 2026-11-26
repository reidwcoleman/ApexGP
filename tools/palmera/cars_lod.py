"""Distance versions of the kit cars (public/palmera/cars_lod.glb) from public/palmera/cars.glb.

Run: blender -b --python tools/palmera/cars_lod.py -- <cars.glb> <out.glb>

Every car_<model>_<part> collapsed with Decimate to a triangle budget (body ~2600, trim 500, glass
300, lamps 160 each), UVs and colours kept, same names - the game swaps a car to these past ~55 m.
"""
import sys
import bpy

src, out = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
BUDGET = {'body': 2600, 'trim': 500, 'glass': 300, 'heads': 160, 'tails': 160}
for o in list(bpy.data.objects):
    if o.type != 'MESH' or not o.name.startswith('car_'):
        continue
    part = o.name.rsplit('_', 1)[-1]
    me = o.data
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    t = BUDGET.get(part, 400)
    if n > t:
        m = o.modifiers.new('d', 'DECIMATE')
        m.ratio = t / n
        m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='d')
    me.calc_loop_triangles()
    print('lod', o.name, n, '->', len(me.loop_triangles))
for o in bpy.context.selected_objects:
    o.select_set(False)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_vertex_color='ACTIVE', export_materials='NONE', export_yup=True, export_apply=False)
print('exported', out)
