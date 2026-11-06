# Tracksmith's track cards: each built-in track laid out from the kit, painted in its theme and
# rendered from above in Cycles for the campaign menu.
#   blender -b --python blender/tracksmith/cards.py [-- ts01 ts02 ...]
import sys
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from common import *

want = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else None
T, H, ROAD_Y = DATA['T'], DATA['H'], DATA['ROAD_Y']
PAINT = {'road': 'road', 'line': 'roadLine', 'edge': 'edge', 'edgeAlt': 'edgeAlt', 'side': 'side', 'under': 'under', 'boost': 'boost', 'block': 'block', 'blockSide': 'blockSide', 'steel': 'pillar', 'dark': 'under', 'banner': 'accent', 'accent': 'accent', 'light': 'accent', 'wall': 'blockSide', 'rail': 'accent'}


def render(td):
    th = DATA['themes'][td['theme']]
    sc = reset()
    sc.cycles.samples = 40
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 640, 360
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'WEBP'
    sc.render.image_settings.quality = 82
    bpy.ops.import_scene.gltf(filepath=KIT)
    kit = {}
    for o in list(bpy.data.objects):
        if o.type == 'MESH':
            kit[o.name] = o
            o.hide_render = True
            o.hide_viewport = True
    # the theme on the kit's materials, the baked occlusion multiplied in
    for m in bpy.data.materials:
        key = m.name.split('.')[0]
        if key not in PAINT or not m.use_nodes:
            continue
        nt = m.node_tree
        b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        for l in list(b.inputs['Base Color'].links):
            nt.links.remove(l)
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Color'
        mix = nt.nodes.new('ShaderNodeMath')
        rgb = nt.nodes.new('ShaderNodeRGB')
        k = 0.55 if key == 'dark' else 1
        rgb.outputs[0].default_value = (*[c * k for c in srgb(th[PAINT[key]])], 1)
        mul = nt.nodes.new('ShaderNodeVectorMath')
        mul.operation = 'MULTIPLY'
        nt.links.new(rgb.outputs[0], mul.inputs[0])
        nt.links.new(attr.outputs['Color'], mul.inputs[1])
        nt.links.new(mul.outputs[0], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = 0.7
        nt.nodes.remove(mix)
    # lay the track
    lo, hi = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
    for p in td['pieces']:
        src = kit.get('p_' + p['id'])
        if not src:
            continue
        o = bpy.data.objects.new('t', src.data)
        sc.collection.objects.link(o)
        o.location = G(p['x'] * T, p['l'] * H + ROAD_Y, p['z'] * T)
        o.rotation_euler = (0, 0, (p['r'] * math.pi) / 2)
        for c in range(3):
            lo[c] = min(lo[c], o.location[c])
            hi[c] = max(hi[c], o.location[c])
        for gk, g in (('start', 'gate_start'), ('check', 'gate_check'), ('finish', 'gate_finish'), ('tunnel', 'roof')):
            if p['id'] == gk and g in kit:
                q = bpy.data.objects.new('g', kit[g].data)
                sc.collection.objects.link(q)
                q.location, q.rotation_euler = o.location, o.rotation_euler
    # the ground, the sky, the sun
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*srgb(th.get('water', th['ground'])), 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
    bpy.ops.mesh.primitive_plane_add(size=6000, location=(0, 0, -0.02))
    bpy.context.object.data.materials.append(gm)
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (*srgb(th['hemiSky']), 1)
    bg.inputs[1].default_value = th['hemiIntensity'] * 0.5
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sc.collection.objects.link(sun)
    sun.data.energy = th['sunIntensity'] * 1.25
    sun.data.color = srgb(th['sunColor'])
    sun.data.angle = math.radians(3)
    sun.rotation_mode = 'QUATERNION'
    sun.rotation_quaternion = G(*th['sunDir']).normalized().to_track_quat('Z', 'Y')
    # a three-quarter view, from whichever side fills the card best
    pts = [o.location.copy() for o in sc.collection.objects if o.name.startswith('t')]
    best = None
    pitch = math.radians(52)
    for k in range(16):
        yaw = k * math.pi / 8
        back = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
        right = Vector((math.cos(yaw), math.sin(yaw), 0))
        up = back.cross(right).normalized() * -1
        xs = [p.dot(right) for p in pts]
        ys = [p.dot(up) for p in pts]
        w, h = max(xs) - min(xs) + 24, max(ys) - min(ys) + 24
        fit = max(w, h * 16 / 9)
        if best is None or fit < best[0]:
            best = (fit, back, right, up, (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2)
    fit, back, right, up, mx, my = best
    c = right * mx + up * my
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = fit * 1.1
    cam.data.clip_end = 9000
    cam.location = c + back * 3000
    cam.rotation_euler = (-back).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(OUT, 'cards', td['id'] + '.webp')
    bpy.ops.render.render(write_still=True)
    print('wrote', sc.render.filepath, os.path.getsize(sc.render.filepath))


for td in DATA['tracks']:
    if not want or td['id'] in want:
        render(td)
