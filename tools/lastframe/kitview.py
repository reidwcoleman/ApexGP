"""Blender: a look at kit pieces on their own, as the game will get them (finished, with their baked contact shading).
  blender -b --python tools/lastframe/kitview.py -- OUT.png kind [kind ...] [--cam az,el] [--zoom k] [--spp n] [--raw]
"""
import bpy, sys, os, math, time
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]
kinds = [a for a in argv[1:] if not a.startswith('--') and not (argv[argv.index(a) - 1] in ('--cam', '--zoom', '--spp'))]
def opt(k, d):
    return argv[argv.index(k) + 1] if k in argv else d
az, el = (float(v) for v in opt('--cam', '35,22').split(','))
zoom = float(opt('--zoom', '1'))
bpy.ops.wm.read_factory_settings(use_empty=True)
import ward_kit
scene = bpy.context.scene
t0 = time.time()
x = 0.0
lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
for k in kinds:
    o = ward_kit.make(k)
    scene.collection.objects.link(o)
    vs = [v.co for v in o.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    o.location.x = x - mn.x
    # what hangs from a ceiling is shown hanging
    if mx.z < 0.05: o.location.z = -mn.z + 0.3
    for v in (mn, mx):
        w = v + o.location
        lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z))); hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    print(f'KIT {k}: {tris} tris, {mx.x - mn.x:.2f} x {mx.y - mn.y:.2f} x {mx.z - mn.z:.2f} m, {len(o.data.materials)} materials, {time.time() - t0:.1f}s', flush=True)
    x += (mx.x - mn.x) + 0.35
# a floor, a wall behind, soft light from a window to one side
me = bpy.data.meshes.new('floor'); me.from_pydata([(-40, -40, 0), (40, -40, 0), (40, 40, 0), (-40, 40, 0)], [], [(0, 1, 2, 3)])
fl = bpy.data.objects.new('floor', me); scene.collection.objects.link(fl)
fm = bpy.data.materials.new('floor'); fm.use_nodes = True
fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.3, 0.3, 0.29, 1); fm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
me.materials.append(fm)
w = bpy.data.worlds.new('w'); scene.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.6, 0.68, 1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.5
ld = bpy.data.lights.new('key', 'AREA'); ld.energy = 900 * max(1.0, (hi - lo).length / 3) ** 2; ld.size = 3.0; ld.color = (1.0, 0.95, 0.88)
ctr = (lo + hi) / 2
key = bpy.data.objects.new('key', ld); scene.collection.objects.link(key)
key.location = ctr + Vector((-2.5, -3.5, 3.2)) * max(1.0, (hi - lo).length / 3)
key.rotation_euler = (ctr - key.location).to_track_quat('-Z', 'Y').to_euler()
cam = bpy.data.cameras.new('cam'); cam.lens = 50
co = bpy.data.objects.new('cam', cam); scene.collection.objects.link(co); scene.camera = co
d = Vector((math.cos(math.radians(el)) * math.sin(math.radians(az)), -math.cos(math.radians(el)) * math.cos(math.radians(az)), math.sin(math.radians(el))))
size = max((hi - lo).length, 0.3)
co.location = ctr + d * (size * 1.25 / zoom + 0.3)
co.rotation_euler = (ctr - co.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'; prefs.get_devices()
for dv in prefs.devices: dv.use = dv.type == 'METAL'
scene.cycles.device = 'GPU'; scene.cycles.samples = int(opt('--spp', '40')); scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 1280, 720
scene.view_settings.view_transform = 'Standard'
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('KIT wrote', out, f'{time.time() - t0:.1f}s', flush=True)
