"""The county skyline (no bake): blender -b --factory-startup -P downtown/build_sky.py
work/skyline.json -> public/oceandrive/skyline.glb. Objects: sky_<group> (buildings), skyland_<group>,
skyroad_<group> (a tile's group hides when that tile is loaded in detail; 'far' always shows), and
sky_bay (Biscayne Bay), sky_far (the land beyond), sky_beach (Miami Beach's ground north and south of the
modelled blocks), sky_seawall (the beach's west shore)."""
import bpy, sys, os, math, json
HERE = os.path.dirname(os.path.abspath(__file__))
OD = os.path.dirname(HERE)
sys.path.insert(0, OD)
sys.path.insert(0, HERE)
for m in ('lib', 'hotels', 'towers'):
    sys.modules.pop(m, None)
import lib, hotels, towers
from lib import MB, hexcol, WHITE
from mathutils import Vector

WORK = os.path.join(OD, 'work')
OUT = os.path.join(OD, '..', '..', 'public', 'oceandrive')
lib.GEN = os.path.join(OD, 'assets', 'gen')
S = json.load(open(os.path.join(WORK, 'skyline.json')))
SEA = -1.5
bpy.ops.wm.read_factory_settings(use_empty=True)


def tri_layer(mb, tri, z, mat, col=WHITE):
    V, T = tri['v'], tri['t']
    for i in range(0, len(T), 3):
        a, b, c = V[T[i]], V[T[i + 1]], V[T[i + 2]]
        mb.face([(a[0], a[1], z), (b[0], b[1], z), (c[0], c[1], z)], mat, col, n=(0, 0, 1))


obs = []
for g, G in S['groups'].items():
    mb = MB('sky_' + g)
    for b in G['buildings']:
        towers.skyline(mb, b, 0.0)
    if mb.faces:
        obs.append(mb.build())
    ml = MB('skyland_' + g)
    tri_layer(ml, G['land'], -0.05, 'od_farground')
    for r in G['roads']:
        pts = r['pts']
        z = 0.02 if not r['elev'] else 6.5 * max(1, r['layer'])
        w = r['w'] / 2
        for i in range(len(pts) - 1):
            a, b = Vector((*pts[i], z)), Vector((*pts[i + 1], z))
            L = (b - a).length
            if L < 0.05:
                continue
            u = (b - a) / L
            n = Vector((-u.y, u.x, 0)) * w
            ml.face([a - n, b - n, b + n, a + n], 'od_asphalt', WHITE, n=(0, 0, 1))
            if r['elev']:
                dz = Vector((0, 0, -1.4))
                ml.face([a + n + dz, b + n + dz, b + n, a + n], 'od_curb', hexcol('#cfc9be'))
                ml.face([a - n, b - n, b - n + dz, a - n + dz], 'od_curb', hexcol('#cfc9be'))
                ml.face([a + n + dz, a - n + dz, b - n + dz, b + n + dz], 'od_curb', hexcol('#b9b3a8'))
                if i % 3 == 0:
                    ml.cyl((a.x, a.y, 0), 0.9, 0.9, z - 1.4, 8, 'od_curb', hexcol('#cfc9be'))
    if ml.faces:
        obs.append(ml.build())
    print('group', g, len(G['buildings']), flush=True)

# Miami Beach's west shore: a seawall along x = -262 (the beach blocks end there), and its ground north and south
mw = MB('sky_seawall')
for y0 in range(-3200, 3600, 40):
    mw.face([(-262.0, y0, 0.0), (-262.0, y0 + 40, 0.0), (-262.0, y0 + 40, -2.6), (-262.0, y0, -2.6)], 'od_curb', hexcol('#cfc8bb'), n=(-1, 0, 0))
obs.append(mw.build())
mbe = MB('sky_beach')
for (y0, y1) in ((-6000.0, -330.0), (420.0, 6000.0)):
    mbe.face([(-262.0, y0, -0.03), (140.0, y0, -0.03), (140.0, y1, -0.03), (-262.0, y1, -0.03)], 'od_farground', WHITE, n=(0, 0, 1))
obs.append(mbe.build())
K = 9000.0
mbb = MB('sky_bay')
mbb.face([(-K, -K, SEA), (-262.0, -K, SEA), (-262.0, K, SEA), (-K, K, SEA)], 'od_bay', WHITE, n=(0, 0, 1))
obs.append(mbb.build())
mf = MB('sky_far')
mf.face([(-K, -K, 0.0), (-3600.0, -K, 0.0), (-3600.0, K, 0.0), (-K, K, 0.0)], 'od_farground', WHITE, n=(0, 0, 1))
mf.face([(-3600.0, 3300.0, 0.0), (-480.0, 3300.0, 0.0), (-480.0, K, 0.0), (-3600.0, K, 0.0)], 'od_farground', WHITE, n=(0, 0, 1))
mf.face([(-3600.0, -K, 0.0), (-480.0, -K, 0.0), (-480.0, -3200.0, 0.0), (-3600.0, -3200.0, 0.0)], 'od_farground', WHITE, n=(0, 0, 1))
obs.append(mf.build())

for o in bpy.data.objects:
    o.select_set(False)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, 'skyline.glb'), export_format='GLB', use_visible=False, use_renderable=False,
    export_apply=True, export_texcoords=True, export_normals=True, export_vertex_color='ACTIVE',
    export_all_vertex_colors=False, export_materials='EXPORT', export_image_format='WEBP', export_image_quality=82,
    export_lights=False, export_cameras=False, export_meshopt_compression_enable=True)
print('glb', os.path.getsize(os.path.join(OUT, 'skyline.glb')) / 1e6, 'MB')
