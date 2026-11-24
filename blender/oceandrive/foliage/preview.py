"""blender -b --factory-startup -P foliage/preview.py -- out.png : a row of the palm kit's species, Eevee"""
import bpy, sys, os, math, random
HERE = os.path.dirname(os.path.abspath(__file__))
OD = os.path.dirname(HERE)
sys.path.insert(0, OD)
sys.path.insert(0, HERE)
for m in ('lib', 'palmkit'):
    sys.modules.pop(m, None)
import lib, palmkit
from mathutils import Vector
lib.GEN = os.path.join(OD, 'assets', 'gen')
bpy.ops.wm.read_factory_settings(use_empty=True)
out = sys.argv[sys.argv.index('--') + 1]
x = 0
specs = [('shadetree', 9.0), ('shadetree', 12.5), ('washingtonia', 17.0), ('sabal', 7.5), ('seagrape', 3.5), ('shadetree', 11.0)]
for i, (kind, h) in enumerate(specs):
    ob = getattr(palmkit, kind)(f'{kind}{i}', random.Random(10 + i), h).build(weld=False)
    ob.location = (x, 0, 0)
    x += 9
sc = bpy.context.scene
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 4.5; sun.angle = 0.02
so = bpy.data.objects.new('sun', sun); so.rotation_euler = (math.radians(40), 0, math.radians(150)); sc.collection.objects.link(so)
sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True
bg = sc.world.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.35, 0.5, 0.8, 1); bg.inputs['Strength'].default_value = 1.0
bpy.ops.mesh.primitive_plane_add(size=300, location=(20, 0, 0))
g = bpy.data.materials.new('g'); g.use_nodes = True
g.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.35, 0.3, 0.22, 1)
bpy.context.active_object.data.materials.append(g)
cam = bpy.data.cameras.new('cam'); cam.lens = 30
co = bpy.data.objects.new('cam', cam); co.location = (22.5, -44, 9)
sc.collection.objects.link(co)
co.rotation_euler = (Vector((22.5, 0, 9.5)) - co.location).to_track_quat('-Z', 'Y').to_euler()
sc.camera = co
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 1800, 900
sc.view_settings.view_transform = 'AgX'
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
