"""Render preview stills of work/oceandrive.blend.  blender -b work/oceandrive.blend -P preview.py -- name[,name] [cycles]"""
import bpy, os, sys
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
sc = bpy.context.scene
CAMS = {
    'street': ((-8.2, -38.0, 1.7), (-11.0, 20.0, 6.0)),
    'park': ((26.0, -12.0, 1.7), (-12.0, 8.0, 7.0)),
    'aerial': ((70.0, -130.0, 45.0), (-20.0, 0.0, 0.0)),
    'beach': ((160.0, 10.0, 2.0), (0.0, 0.0, 9.0)),
    'colony': ((4.0, 2.0, 1.7), (-12.0, 8.0, 9.0)),
    'north': ((2.0, -80.0, 2.2), (-2.0, 60.0, 4.0)),
    'south': ((-2.0, 80.0, 2.2), (-6.0, -60.0, 5.0)),
    'dunes': ((95.0, -30.0, 1.8), (140.0, 10.0, 1.0)),
    'loungers': ((180.0, -30.0, 2.0), (205.0, 0.0, 0.0)),
    'side': ((-3.0, -64.0, 1.8), (-30.0, -58.0, 6.0)),
}
names = argv[0].split(',') if argv else list(CAMS)
cyc = 'cycles' in argv
if cyc:
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = True
    sc.cycles.device = 'GPU'; sc.cycles.samples = 64; sc.cycles.use_denoising = True
else:
    sc.render.engine = 'BLENDER_EEVEE'
    sc.eevee.taa_render_samples = 16
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
sc.view_settings.view_transform = 'AgX'
sc.view_settings.exposure = -1.6
cam = bpy.data.objects.get('cam')
if not cam:
    cd = bpy.data.cameras.new('cam'); cd.lens = 24
    cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam)
sc.camera = cam
for n in names:
    p, t = CAMS[n]
    cam.location = p
    cam.rotation_euler = (Vector(t) - Vector(p)).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(HERE, 'work', f'prev_{n}.png')
    bpy.ops.render.render(write_still=True)
