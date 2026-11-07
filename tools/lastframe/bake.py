"""Blender: builds Kessler Block from layout.py, bakes its light, writes the runtime geometry.
  blender -b --python tools/lastframe/bake.py -- --size 2048 --samples 32 [--nobake] [--out DIR]
"""
import bpy, bmesh, sys, os, json, math, struct, time
import numpy as np
from mathutils import Vector, Matrix
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import layout
from mats import MATS, UNLIT

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(k, d):
    return type(d)(argv[argv.index('--' + k) + 1]) if '--' + k in argv else d
SIZE = opt('size', 2048); SAMPLES = opt('samples', 32); OUT = opt('out', '/tmp/lf_out')
NOBAKE = '--nobake' in argv
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', 'assets-src', 'lf'))
os.makedirs(OUT, exist_ok=True)
t0 = time.time()
def log(*a): print(f'[{time.time()-t0:6.1f}s]', *a, flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
m = layout.build()

# ------------------------------------------------------------------ faces
class Grid:
    def __init__(s, boxes, cell=4.0):
        s.c = cell; s.d = {}
        for b in boxes:
            for i in range(int(b.a[0] // cell), int(b.b[0] // cell) + 1):
                for j in range(int(b.a[1] // cell), int(b.b[1] // cell) + 1):
                    s.d.setdefault((i, j), []).append(b)
    def inside(s, p):
        for b in s.d.get((int(p[0] // s.c), int(p[1] // s.c)), ()):
            if b.a[0] < p[0] < b.b[0] and b.a[1] < p[1] < b.b[1] and b.a[2] < p[2] < b.b[2]:
                return True
        return False

solid = [b for b in m.boxes if b.mat not in UNLIT and b.tag != 'far']
grid = Grid([b for b in solid if b.collide or b.tag in ('ext',)])

def room_of(p):
    for r in m.rooms:
        if r['a'][0] <= p[0] <= r['b'][0] and r['a'][1] <= p[1] <= r['b'][1] and r['a'][2] - 0.02 <= p[2] <= r['b'][2] + 0.25:
            return r
    return None

AX = {'-x': (0, -1), '+x': (0, 1), '-y': (1, -1), '+y': (1, 1), '-z': (2, -1), '+z': (2, 1)}
faces = []     # dict(mat, verts[4], n, uv[4], w, h, dens)
extras = []

def face_quad(b, f):
    ax, sg = AX[f]
    a, c = b.a, b.b
    u, v = [(1, 2), (0, 2), (0, 1)][ax]
    w = a[ax] if sg < 0 else c[ax]
    return ax, sg, u, v, w

def emit(b, f, mat, u0, u1, v0, v1):
    ax, sg, u, v, w = face_quad(b, f)
    pts = []
    for (uu, vv) in ((u0, v0), (u1, v0), (u1, v1), (u0, v1)):
        p = [0, 0, 0]; p[ax] = w; p[u] = uu; p[v] = vv
        pts.append(p)
    n = [0, 0, 0]; n[ax] = sg
    e1 = np.subtract(pts[1], pts[0]); e2 = np.subtract(pts[2], pts[0])
    if np.dot(np.cross(e1, e2), n) < 0:
        pts = [pts[0], pts[3], pts[2], pts[1]]
    sc = MATS[mat]['scale']
    if ax == 2:
        uv = [(p[0] / sc, p[1] / sc) for p in pts]
    elif ax == 0:
        uv = [(p[1] / sc, p[2] / sc) for p in pts]
    else:
        uv = [(p[0] / sc, p[2] / sc) for p in pts]
    faces.append(dict(mat=mat, v=pts, n=n, uv=uv, w=abs(u1 - u0), h=abs(v1 - v0), dens=b.density, tag=b.tag))

CHUNK = 28.0
for b in m.boxes:
    for f in layout.FACES:
        ax, sg, u, v, w = face_quad(b, f)
        u0, u1, v0, v1 = b.a[u], b.b[u], b.a[v], b.b[v]
        if u1 - u0 < 1e-4 or v1 - v0 < 1e-4:
            continue
        if b.tag == 'far' and f == '-z':
            continue
        # buried or never seen
        if f == '-z' and b.a[2] <= 0.02:
            continue
        if b.b[2] <= 0.0 and ax != 2 and not (b.b[2] > -0.2):
            continue
        cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
        hidden = True
        for (du, dv) in ((0, 0), (-.45, -.45), (.45, -.45), (.45, .45), (-.45, .45)):
            p = [0, 0, 0]; p[ax] = w + sg * 0.01; p[u] = cu + du * (u1 - u0); p[v] = cv + dv * (v1 - v0)
            if not grid.inside(p):
                hidden = False
                break
        if hidden and b.mat not in UNLIT:
            continue
        mat = b.faces.get(f, b.mat)
        # interiors take the room's finish
        p = [0, 0, 0]; p[ax] = w + sg * 0.06; p[u] = cu; p[v] = cv
        r = room_of(p)
        if r is not None and b.tag not in ('step', 'post', 'cargo', 'counter', 'container') and b.mat not in ('trim', 'shopframe', 'planks', 'grate', 'steel', 'wood_top'):
            if ax == 2:
                if f == '+z' and b.tag == 'floor':
                    mat = r['floor']
                elif f == '-z':
                    mat = r['ceil']
            elif b.tag in ('int', 'ext', 'wall'):
                mat = r['wall']
                # a skirting board along the foot of the wall
                if abs(b.a[2] - r['a'][2]) < 0.02:
                    pass
        # split long faces so the atlas packs
        nu = max(1, math.ceil((u1 - u0) / CHUNK)); nv = max(1, math.ceil((v1 - v0) / CHUNK))
        for i in range(nu):
            for j in range(nv):
                emit(b, f, mat, u0 + (u1 - u0) * i / nu, u0 + (u1 - u0) * (i + 1) / nu, v0 + (v1 - v0) * j / nv, v0 + (v1 - v0) * (j + 1) / nv)
log('faces', len(faces))

# ------------------------------------------------------------------ atlas
PAD = 2
lit = [f for f in faces if f['mat'] not in UNLIT]
def pack(d):
    rects = []
    for i, f in enumerate(lit):
        dd = d * f['dens']
        rects.append((max(2, math.ceil(f['w'] * dd)) + PAD * 2, max(2, math.ceil(f['h'] * dd)) + PAD * 2, i))
    rects.sort(key=lambda r: -r[1])
    x = y = rowh = 0
    out = {}
    for w, h, i in rects:
        if w > SIZE: return None
        if x + w > SIZE:
            x = 0; y += rowh; rowh = 0
        if y + h > SIZE: return None
        out[i] = (x, y, w, h); x += w; rowh = max(rowh, h)
    return out
lo, hi = 1.0, 200.0
best = None
for _ in range(16):
    mid = (lo + hi) / 2
    r = pack(mid)
    if r: best, lo = (r, mid), mid
    else: hi = mid
rects, dens = best
log(f'atlas {SIZE} density {dens:.1f} texels/m')
for i, f in enumerate(lit):
    x, y, w, h = rects[i]
    x0, y0, x1, y1 = x + PAD, y + PAD, x + w - PAD, y + h - PAD
    # corners by the face's own (u,v) order
    v = np.array(f['v'], float)
    e = [v[1] - v[0], v[3] - v[0]]
    uv = []
    for p in v:
        a = np.dot(p - v[0], e[0]) / max(1e-9, np.dot(e[0], e[0]))
        b = np.dot(p - v[0], e[1]) / max(1e-9, np.dot(e[1], e[1]))
        uv.append(((x0 + a * (x1 - x0)) / SIZE, (y0 + b * (y1 - y0)) / SIZE))
    f['lm'] = uv
for f in faces:
    f.setdefault('lm', [(0, 0)] * 4)

# ------------------------------------------------------------------ the mesh (Blender only sees it for the bake)
means = json.load(open(os.path.join(HERE, 'means.json')))
matnames = sorted({f['mat'] for f in faces})
def blender_mat(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bs = nt.nodes.get('Principled BSDF')
    mm = MATS[name]
    if mm['emit']:
        bs.inputs['Base Color'].default_value = (0, 0, 0, 1)
        bs.inputs['Emission Color'].default_value = (*mm['emit'], 1)
        bs.inputs['Emission Strength'].default_value = 1.0
    else:
        c = means[name]
        bs.inputs['Base Color'].default_value = (*c, 1)
        bs.inputs['Roughness'].default_value = 0.8
        bs.inputs['Specular IOR Level'].default_value = 0.2
    return mat
mesh = bpy.data.meshes.new('world')
verts, polys, pm = [], [], []
midx = {n: i for i, n in enumerate(matnames)}
for f in faces:
    i = len(verts)
    verts += [tuple(p) for p in f['v']]
    polys.append((i, i + 1, i + 2, i + 3))
    pm.append(midx[f['mat']])
mesh.from_pydata(verts, [], polys)
for n in matnames:
    mesh.materials.append(blender_mat(n))
mesh.polygons.foreach_set('material_index', pm)
uvl = mesh.uv_layers.new(name='lm')
uvd = np.array([c for f in faces for c in f['lm']], np.float32).ravel()
uvl.data.foreach_set('uv', uvd)
mesh.update()
world = bpy.data.objects.new('world', mesh)
scene = bpy.context.scene
scene.collection.objects.link(world)

# ------------------------------------------------------------------ props
cache, bbox = {}, {}
def load_part(name, part):
    key = (name, part)
    if key in cache: return cache[key]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f'{ROOT}/models/{name}/{name}.gltf')
    new = [o for o in bpy.data.objects if o not in before]
    keep = [o for o in new if o.type == 'MESH' and (part is None or o.name.startswith(part))]
    if part is not None:
        exact = [o for o in keep if o.name == part or o.name.split('.')[0] == part]
        keep = exact or keep
    if not keep: raise Exception(f'no part {part} in {name}: {[o.name for o in new]}')
    for o in new:
        if o not in keep: bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in keep:
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
        o.select_set(True)
    bpy.context.view_layer.objects.active = keep[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(keep) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    # origin: centred in plan, sitting at z=0
    vs = np.empty(len(o.data.vertices) * 3, np.float32); o.data.vertices.foreach_get('co', vs); vs = vs.reshape(-1, 3)
    mn, mx = vs.min(0), vs.max(0)
    off = Vector(((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, mn[2]))
    o.data.transform(Matrix.Translation(-off))
    o.data.update()
    bbox[key] = ((mx - mn) / 2).tolist()
    o.name = f'P_{name}_{part or "all"}'
    for c in list(o.users_collection): c.objects.unlink(o)
    cache[key] = o
    return o
for p in m.props:
    src = load_part(p['name'], p['part'])
    if p['loose']:      # it will move: no baked shadow to leave behind
        continue
    o = src.copy()      # linked data
    scene.collection.objects.link(o)
    o.location = p['pos']; o.rotation_euler = (p['tilt'], 0, p['rot']); o.scale = (p['scale'],) * 3
log('props', len(m.props), 'unique', len(cache))

# ------------------------------------------------------------------ light
def add_light(L):
    kind = L['kind']
    if kind == 'area':
        d = bpy.data.lights.new('l', 'AREA'); d.shape = 'RECTANGLE'; d.size, d.size_y = L['size']
    elif kind == 'spot':
        d = bpy.data.lights.new('l', 'SPOT'); d.spot_size = L.get('spot', 1.5); d.spot_blend = L.get('blend', 0.6); d.shadow_soft_size = L.get('radius', 0.1)
    else:
        d = bpy.data.lights.new('l', 'POINT'); d.shadow_soft_size = L.get('radius', 0.1)
    d.color = L['color']; d.energy = L['power']
    o = bpy.data.objects.new('l', d); scene.collection.objects.link(o); o.location = L['pos']
    if 'aim' in L:
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = Vector(L['aim']).normalized().to_track_quat('-Z', 'Y')
for L in m.lights: add_light(L)
w = bpy.data.worlds.new('sky'); scene.world = w; w.use_nodes = True
nt = w.node_tree
env = nt.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(f'{ROOT}/hdri/rooftop_night.hdr')
bg = nt.nodes['Background']; bg.inputs['Strength'].default_value = opt('sky', 2.6)
mixc = nt.nodes.new('ShaderNodeMix'); mixc.data_type = 'RGBA'; mixc.blend_type = 'MULTIPLY'; mixc.inputs['Factor'].default_value = 1.0
mixc.inputs['B'].default_value = (0.36, 0.62, 1.05, 1)    # pull the sunset down to blue hour
nt.links.new(env.outputs['Color'], mixc.inputs['A'])
nt.links.new(mixc.outputs['Result'], bg.inputs['Color'])

# ------------------------------------------------------------------ export the geometry
buf = bytearray(); meta = []
for n in matnames:
    fs = [f for f in faces if f['mat'] == n]
    pos = np.array([p for f in fs for p in f['v']], np.float32)
    pos = pos[:, [0, 2, 1]] * np.array([1, 1, -1], np.float32)       # z-up to y-up
    nor = np.array([f['n'] for f in fs for _ in range(4)], np.float32)[:, [0, 2, 1]] * np.array([1, 1, -1], np.float32)
    uv = np.array([c for f in fs for c in f['uv']], np.float32)
    lm = np.array([c for f in fs for c in f['lm']], np.float32)
    idx = np.array([[i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3] for i in range(len(fs))], np.uint32).ravel()
    e = dict(mat=n, verts=len(pos), tris=len(idx) // 3)
    for k, a in (('pos', pos), ('nor', nor), ('uv', uv), ('lm', lm), ('idx', idx)):
        e[k] = len(buf); buf += a.tobytes()
    meta.append(e)
open(f'{OUT}/world.bin', 'wb').write(buf)
def yup(p): return [p[0], p[2], -p[1]]
colliders = []
for b in m.boxes:
    if b.collide and b.mat not in UNLIT:
        colliders.append(dict(a=b.a, b=b.b, pen=b.pen, tag=b.tag, mat=b.mat))
for a, b, pen in m.solid:
    colliders.append(dict(a=a, b=b, pen=pen, tag='inv', mat=''))
props_out = []
for p in m.props:
    k = (p['name'], p['part'])
    h = np.array(bbox[k]) * p['scale']
    c = p['collide']
    if c is not False and not p['loose']:
        hx, hy, hz = c if c else h
        cs, sn = abs(math.cos(p['rot'])), abs(math.sin(p['rot']))
        ex, ey = hx * cs + hy * sn, hx * sn + hy * cs
        x, y, z = p['pos']
        colliders.append(dict(a=(x - ex, y - ey, z), b=(x + ex, y + ey, z + hz * 2), pen=not p['hard'], tag='prop', mat=''))
    e = dict(id=f"{p['name']}|{p['part'] or 'all'}", pos=p['pos'], rot=p['rot'], s=p['scale'])
    if p['tilt']: e['tilt'] = p['tilt']
    if p['loose']:
        e['loose'] = dict(p['loose'], half=[float(v) for v in h])
    props_out.append(e)
json.dump(dict(mats=meta, colliders=colliders, props=props_out, doors=m.doors, glass=m.glass, spawns=m.spawns, hold=m.hold, zones=m.zones, lights=m.lights, rooms=m.rooms,
               density=dens, size=SIZE), open(f'{OUT}/map_raw.json', 'w'))
log('geometry written', len(buf) // 1024, 'KB', len(colliders), 'colliders')
# the sky, small, for the backdrop
sky = env.image; sky.scale(1024, 512)
sp = np.empty(1024 * 512 * 4, np.float32); sky.pixels.foreach_get(sp)
np.save(f'{OUT}/sky.npy', sp.reshape(512, 1024, 4)[..., :3].astype(np.float16))
if '--props' in argv:
    col = bpy.data.collections.new('export'); scene.collection.children.link(col)
    keep_out = []
    seen_img = {}
    for key, src in cache.items():
        o = src.copy(); o.data = src.data.copy(); o.name = (key[0] + '|' + (key[1] or 'all'))
        col.objects.link(o)
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        size = 2 * max(bbox[key])
        budget = 340 if key[0] == 'cardboard_box_01' else (900 if size < 0.4 else 2200 if size < 1.3 else 5000)
        if tris > budget:
            d = o.modifiers.new('d', 'DECIMATE'); d.ratio = budget / tris
            bpy.ops.object.select_all(action='DESELECT'); bpy.context.view_layer.objects.active = o; o.select_set(True)
            bpy.ops.object.modifier_apply(modifier='d')
        px = 256 if size < 0.45 else 512
        if key[0] in ('cardboard_box_01',): px = 512
        for ms in o.material_slots:
            if not ms.material or not ms.material.use_nodes: continue
            for nd in ms.material.node_tree.nodes:
                if nd.type == 'TEX_IMAGE' and nd.image:
                    im = nd.image
                    if im.size[0] > px and seen_img.get(im.name, 0) < px:
                        im.scale(px, px); seen_img[im.name] = px
    bpy.ops.object.select_all(action='DESELECT')
    for o in col.objects: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/props.glb', export_format='GLB', use_selection=True, export_image_format='JPEG', export_image_quality=70, export_apply=False,
                              export_animations=False, export_cameras=False, export_lights=False, export_yup=True, export_tangents=False)
    log('props.glb', os.path.getsize(f'{OUT}/props.glb') // 1024, 'KB')
bpy.ops.wm.save_as_mainfile(filepath=f'{OUT}/scene.blend')
if NOBAKE: sys.exit(0)

# ------------------------------------------------------------------ bake
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'; prefs.get_devices()
for d in prefs.devices: d.use = d.type == 'METAL'
scene.cycles.device = 'GPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_adaptive_sampling = False
scene.cycles.max_bounces = 5; scene.cycles.diffuse_bounces = 4; scene.cycles.glossy_bounces = 1; scene.cycles.transmission_bounces = 0
scene.cycles.sample_clamp_indirect = 6.0
scene.cycles.caustics_reflective = False; scene.cycles.caustics_refractive = False
img = bpy.data.images.new('lightmap', SIZE, SIZE, alpha=False, float_buffer=True)
for mat in mesh.materials:
    nd = mat.node_tree.nodes.new('ShaderNodeTexImage'); nd.image = img; nd.select = True
    mat.node_tree.nodes.active = nd
bpy.ops.object.select_all(action='DESELECT')
world.select_set(True); bpy.context.view_layer.objects.active = world
log('baking', SIZE, SAMPLES)
bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=2, margin_type='EXTEND', use_clear=True, uv_layer='lm')
log('baked')
px = np.empty(SIZE * SIZE * 4, np.float32); img.pixels.foreach_get(px)
np.save(f'{OUT}/lightmap.npy', px.reshape(SIZE, SIZE, 4)[..., :3].astype(np.float16))
img.filepath_raw = f'{OUT}/lightmap.exr'; img.file_format = 'OPEN_EXR'; img.save()
log('saved', float(px.mean()), float(np.percentile(px, 99)))
