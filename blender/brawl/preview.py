# Render a quick look at an exported GLB: blender -b --python blender/brawl/preview.py -- <name> [out.png] [yaw] [dist] [ty]
import bpy, sys, os, math
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
name = argv[0]
out = argv[1] if len(argv) > 1 else f'/tmp/{name}.png'
yaw = math.radians(float(argv[2])) if len(argv) > 2 else 0.5
dist = float(argv[3]) if len(argv) > 3 else 4.0
ty = float(argv[4]) if len(argv) > 4 else 1.0
pitch = math.radians(float(argv[5])) if len(argv) > 5 else 12
bpy.ops.wm.read_factory_settings(use_empty=True)
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
bpy.ops.import_scene.gltf(filepath=os.path.join(root, 'public', 'brawl', name + '.glb'))
for o in bpy.data.objects:
    if o.name.startswith('col_'):
        o.hide_render = True
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_WORKBENCH'
sc.render.resolution_x, sc.render.resolution_y = 900, 900
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.7, 0.85, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.data.energy = 3.5; sun.rotation_euler = (math.radians(50), 0, math.radians(30))
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
t = Vector((0, 0, ty))
cam.location = t + Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))) * dist
d = t - cam.location
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 50
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('rendered', out)
