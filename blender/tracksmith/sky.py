# Tracksmith's skies, rendered in Cycles: one 360 panorama per theme, with its own far country round
# the horizon (buttes, snow peaks, tropical islands, crystal spires) and sculpted clouds. The game
# wraps it round the world as the sky.   blender -b --python blender/tracksmith/sky.py [-- themeIndex]
import sys, random
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from common import *

only = None
if '--' in sys.argv and len(sys.argv) > sys.argv.index('--') + 1:
    only = int(sys.argv[sys.argv.index('--') + 1])


def mat(name, hexv, rough=0.85, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb(hexv), 1)
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*srgb(hexv), 1)
        b.inputs['Emission Strength'].default_value = emit
    return m


def rock(name, m, x, y, r, h, seed, sides=7, top=0.7, jag=0.18):
    """a faceted mesa or peak: stacked rings, each knocked about a little"""
    rnd = random.Random(seed)
    bm = bmesh.new()
    rings = []
    steps = 4
    for k in range(steps + 1):
        u = k / steps
        rr = r * (1 - (1 - top) * u ** 1.4)
        ring = []
        for i in range(sides):
            a = 2 * math.pi * i / sides + rnd.uniform(-0.12, 0.12)
            j = 1 + rnd.uniform(-jag, jag)
            ring.append(bm.verts.new((x + math.cos(a) * rr * j, y + math.sin(a) * rr * j, h * u + rnd.uniform(-0.03, 0.03) * h * (0 < k < steps))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(sides):
            bm.faces.new((a[i], a[(i + 1) % sides], b[(i + 1) % sides], b[i]))
    bm.faces.new(rings[-1])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def cloud(m, x, y, z, s, seed):
    """puffs melted into one low-poly bank"""
    rnd = random.Random(seed)
    for i in range(rnd.randint(4, 7)):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=s * rnd.uniform(0.5, 1.0), location=(x + rnd.uniform(-1.6, 1.6) * s, y + rnd.uniform(-1.6, 1.6) * s, z + rnd.uniform(-0.1, 0.28) * s))
        o = bpy.context.object
        o.scale = (1.5, 1.5, 0.62)
        o.data.materials.append(m)


def world(th, sc):
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    r = ramp.color_ramp
    r.elements[0].position = 0.0
    r.elements[0].color = (*srgb(th['skyHorizon']), 1)
    r.elements[1].position = 0.75
    r.elements[1].color = (*srgb(th['skyTop']), 1)
    mid = r.elements.new(0.13)
    a, b = srgb(th['skyHorizon']), srgb(th['skyTop'])
    mid.color = (*[a[i] * 0.55 + b[i] * 0.45 for i in range(3)], 1)
    nt.links.new(ramp.outputs[0], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0


def build(i, th):
    sc = reset()
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 3072, 1536
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'WEBP'
    sc.render.image_settings.quality = 88
    world(th, sc)
    # the sun
    d = th['sunDir']
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sc.collection.objects.link(sun)
    sun.data.energy = th['sunIntensity'] * 1.1
    sun.data.color = srgb(th['sunColor'])
    sun.data.angle = math.radians(2.5)
    v = G(*d).normalized()
    sun.rotation_mode = 'QUATERNION'
    sun.rotation_quaternion = v.to_track_quat('Z', 'Y')
    # a visible disc
    disc = mat('disc', th['sunColor'], emit=6)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=170, location=v * 2600)
    bpy.context.object.data.materials.append(disc)
    rnd = random.Random(40 + i)
    far, far2 = mat('far', th['far']), mat('far2', th['farAlt'])
    snow = mat('snow', 0xf6f8fc, 0.6)
    kind = th['props']
    ground = mat('ground', th.get('water', th['ground']) if kind == 'palm' else th['ground'], 0.5 if kind == 'palm' else 0.9)
    bpy.ops.mesh.primitive_circle_add(vertices=64, radius=9000, fill_type='NGON', location=(0, 0, -6))
    bpy.context.object.data.materials.append(ground)
    # the far country, at three depths
    n = 0
    for band, (dist, count) in enumerate(((1500, 16), (2300, 20), (3200, 22))):
        for k in range(count):
            a = 2 * math.pi * k / count + rnd.uniform(-0.1, 0.1)
            dd = dist * rnd.uniform(0.9, 1.15)
            x, y = math.cos(a) * dd, math.sin(a) * dd
            n += 1
            if kind == 'mesa':
                r, h = rnd.uniform(120, 300), rnd.uniform(90, 240) * (1 + band * 0.35)
                rock('r', far if rnd.random() < 0.6 else far2, x, y, r, h, n, sides=rnd.randint(6, 9), top=rnd.uniform(0.72, 0.9))
                if rnd.random() < 0.5:
                    rock('r', far2, x + rnd.uniform(-90, 90), y + rnd.uniform(-90, 90), r * 0.45, h * 1.32, n + 500, sides=6, top=0.85)
            elif kind == 'pine':
                r, h = rnd.uniform(240, 460), rnd.uniform(260, 560) * (1 + band * 0.32)
                rock('r', far, x, y, r, h, n, sides=7, top=0.04, jag=0.12)
                rock('r', snow, x, y, r * 0.42, h * 1.02, n + 900, sides=7, top=0.03, jag=0.1).location.z = h * 0.58 - h * 0.0
                bpy.context.scene.objects[-1:] if False else None
            elif kind == 'palm':
                r, h = rnd.uniform(130, 300), rnd.uniform(50, 150)
                rock('r', far if rnd.random() < 0.7 else far2, x, y, r, h, n, sides=8, top=0.28, jag=0.16)
            else:
                r, h = rnd.uniform(60, 170), rnd.uniform(260, 720) * (1 + band * 0.3)
                rock('r', far if rnd.random() < 0.6 else far2, x, y, r, h, n, sides=5, top=0.08, jag=0.1)
    # the clouds
    if kind != 'crystal':
        cm = mat('cloud', 0xffffff, 0.9)
        cm.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (*srgb(th['skyHorizon']), 1)
        cm.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 0.35
    else:
        cm = mat('cloud', 0x4a3f78, 0.9, emit=0.4)
    for k in range(34):
        a = rnd.uniform(0, 2 * math.pi)
        dd = rnd.uniform(1200, 2900)
        cloud(cm, math.cos(a) * dd, math.sin(a) * dd, rnd.uniform(420, 1000), rnd.uniform(70, 170), 1000 + k)
    # the eye: at the middle of the world, looking all ways
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.location = (0, 0, 30)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    cam.data.clip_end = 30000
    cam.data.type = 'PANO'
    cam.data.panorama_type = 'EQUIRECTANGULAR'
    sc.render.filepath = os.path.join(OUT, 'sky', f'sky{i}.webp')
    bpy.ops.render.render(write_still=True)
    print('wrote', sc.render.filepath, os.path.getsize(sc.render.filepath))


for i, th in enumerate(DATA['themes']):
    if only is None or only == i:
        build(i, th)
