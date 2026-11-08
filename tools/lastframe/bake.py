"""Blender: builds Kessler Block from layout.py, bakes its light, writes the runtime geometry.
  blender -b --python tools/lastframe/bake.py -- --size 2048 --samples 32 [--nobake] [--out DIR]
"""
import bpy, bmesh, sys, os, json, math, struct, time, faulthandler
faulthandler.enable()
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
COVE = opt('map', 'block') == 'cove'
WARD = opt('map', 'block') == 'ward'
if COVE:
    import cove_layout, coveland, cove_kit
    m = cove_layout.build()
elif WARD:
    import ward_layout, ward_kit
    m = ward_layout.build()
else:
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


def put(b, f, ax, sg, u, v, w, u0, u1, v0, v1):
    cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
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
    # a two-tone wall: the lower part in harder paint, the line at the same height all round the room
    bands = [(v0, v1, mat)]
    if r is not None and r.get('dado') and ax != 2 and mat == r['wall']:
        dz = r['a'][2] + r['dado'][1]
        if v0 < dz - 0.01 and v1 > dz + 0.01:
            bands = [(v0, dz, r['dado'][0]), (dz, v1, mat)]
        elif v1 <= dz + 0.01:
            bands = [(v0, v1, r['dado'][0])]
    # split long faces so the atlas packs
    for (bv0, bv1, bm) in bands:
        nu = max(1, math.ceil((u1 - u0) / CHUNK)); nv = max(1, math.ceil((bv1 - bv0) / CHUNK))
        for i in range(nu):
            for j in range(nv):
                emit(b, f, bm, u0 + (u1 - u0) * i / nu, u0 + (u1 - u0) * (i + 1) / nu, bv0 + (bv1 - bv0) * j / nv, bv0 + (bv1 - bv0) * (j + 1) / nv)


for b in m.boxes:
    for f in layout.FACES:
        ax, sg, u, v, w = face_quad(b, f)
        u0, u1, v0, v1 = b.a[u], b.b[u], b.a[v], b.b[v]
        if u1 - u0 < 1e-4 or v1 - v0 < 1e-4:
            continue
        if b.tag == 'far' and f == '-z':
            continue
        # buried or never seen
        if f == '-z' and b.a[2] <= 0.02 and b.tag != 'under':
            continue
        if b.b[2] <= 0.0 and ax != 2 and not (b.b[2] > -0.2) and b.tag not in ('under', 'step'):
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
        # a slab under several rooms takes each room's floor and ceiling: cut it on their edges
        cells = [(u0, u1, v0, v1)]
        if ax == 2 and b.tag == 'floor':
            zz = w + sg * 0.06
            rs = [r for r in m.rooms if r['a'][2] - 0.02 <= zz <= r['b'][2] + 0.25]
            us = sorted({u0, u1, *[e for r in rs for e in (r['a'][u], r['b'][u]) if u0 < e < u1]})
            vs_ = sorted({v0, v1, *[e for r in rs for e in (r['a'][v], r['b'][v]) if v0 < e < v1]})
            cells = [(us[i], us[i + 1], vs_[j], vs_[j + 1]) for i in range(len(us) - 1) for j in range(len(vs_) - 1)]
        for (cu0, cu1, cv0, cv1) in cells:
            put(b, f, ax, sg, u, v, w, cu0, cu1, cv0, cv1)


# roofs and hulls: quads that aren't on any box
for q in getattr(m, 'quads', ()):
    v = np.array(q['v'], float)
    e1, e2 = v[1] - v[0], v[3] - v[0]
    n = np.cross(e1, e2)
    if q.get('tri'): n = np.cross(v[1] - v[0], v[2] - v[0])
    n = n / max(1e-9, np.linalg.norm(n))
    w_ = np.linalg.norm(e1); h_ = np.linalg.norm(e2)
    u_ = e1 / max(1e-9, w_); b_ = np.cross(n, u_)
    sc = MATS[q['mat']]['scale']
    # anchored to the world, not the quad: a wall cut round its windows has to read as one wall
    uv = [(float(np.dot(p, u_) / sc), float(np.dot(p, b_) / sc)) for p in v]
    faces.append(dict(mat=q['mat'], v=[list(map(float, p)) for p in v], n=[float(c) for c in n], uv=uv, w=float(w_), h=float(h_), dens=q['dens'], tag='quad', tri=q.get('tri', False)))
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
    if f.get('tri'):
        f['lm'] = [(x0 / SIZE, y0 / SIZE), (x1 / SIZE, y0 / SIZE), ((x0 + x1) / 2 / SIZE, y1 / SIZE), ((x0 + x1) / 2 / SIZE, y1 / SIZE)]
        continue
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
    keep = [o for o in new if o.type == 'MESH' and (part is None or o.name.startswith(part)) and not any(f'LOD{i}' in o.name for i in (1, 2, 3, 4))]
    if part is not None:
        exact = [o for o in keep if o.name == part or o.name.split('.')[0] == part]
        keep = exact or keep
    if not keep: raise Exception(f'no part {part} in {name}: {[o.name for o in new]}')
    for o in new:
        if o not in keep: bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in keep:
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
        o.data = o.data.copy()
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

# ------------------------------------------------------------------ the kit: facades with a lightmap of their own
kits = {}
def kit_of(name):
    if name in kits: return kits[name]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f'{ROOT}/models/{name}/{name}.gltf')
    new = [o for o in bpy.data.objects if o not in before]
    d = {}
    for o in new:
        if o.type == 'MESH': d[o.name.split('.')[0]] = o
        for c in list(o.users_collection): c.objects.unlink(o)
    kits[name] = d
    return d
units = {}
def unit_obj(kit, parts, far):
    key = (kit, tuple(parts), far)
    if key in units: return units[key]
    if kit in ('cove', 'ward'):
        o = (cove_kit if kit == 'cove' else ward_kit).make(parts[0])
        o.name = f'UF|{kit}|' + parts[0]
        units[key] = o
        return o
    d = kit_of(kit)
    origin = d[parts[0]].matrix_world.translation.copy()
    objs = []
    for pn in parts:
        src = d[pn]
        o = src.copy(); o.data = src.data.copy(); o.parent = None
        o.matrix_world = Matrix.Translation(-origin) @ src.matrix_world
        scene.collection.objects.link(o)
        objs.append(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    cap = 420 if far else 800
    if tris > cap:
        dm = o.modifiers.new('d', 'DECIMATE'); dm.ratio = cap / tris
        bpy.ops.object.modifier_apply(modifier='d')
    if not far:
        # flat from the front. A module is a thin slice of wall, so one projection gives it smooth light; an automatic
        # unwrap of modelled brick shatters into islands smaller than a texel, and those bake to black
        me = o.data
        lmuv = me.uv_layers.new(name='lm')
        nv = len(me.vertices); co = np.empty(nv * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        nl = len(me.loops); vi = np.empty(nl, np.int32); me.loops.foreach_get('vertex_index', vi)
        npoly = len(me.polygons); ls = np.empty(npoly, np.int32); me.polygons.foreach_get('loop_start', ls)
        lt = np.empty(npoly, np.int32); me.polygons.foreach_get('loop_total', lt)
        pn = np.empty(npoly * 3, np.float32); me.polygons.foreach_get('normal', pn); pn = pn.reshape(-1, 3)
        lo, hi = co.min(0), co.max(0); sp = np.maximum(hi - lo, 1e-3)
        uv = np.stack([(co[vi, 0] - lo[0]) / sp[0], (co[vi, 2] - lo[2]) / sp[2]], 1) * 0.96 + 0.02
        # what faces away from the street goes to one corner, or it would bake over the front
        back = np.repeat(pn[:, 1] > 0.5, lt)
        uv[back] = 0.004
        lmuv.data.foreach_set('uv', uv.ravel().astype(np.float32))
    o.name = ('UF|' if far else 'U|') + kit + '|' + '+'.join(parts)
    scene.collection.objects.unlink(o)
    units[key] = o
    return o
TILE = 128
PER = SIZE // TILE
placed = []
units_out = []
for u in m.units:
    o0 = unit_obj(u['kit'], u['parts'], u['far'])
    e = dict(id=o0.name, pos=u['pos'], rot=u['rot'], sc=u['sc'], tint=u['tint'])
    if u.get('float'): e['float'] = 1
    if not u['far']:
        i = len(placed)
        if i >= PER * PER: raise Exception('out of tiles')
        cx, cy = i % PER, i // PER
        tile = [(cx * TILE + 3) / SIZE, (cy * TILE + 3) / SIZE, (TILE - 6) / SIZE, (TILE - 6) / SIZE]
        e['tile'] = tile
        o = o0.copy(); o.data = o0.data.copy(); o.name = f'inst{i}'
        la = o.data.uv_layers['lm']
        a = np.empty(len(la.data) * 2, np.float32); la.data.foreach_get('uv', a); a = a.reshape(-1, 2)
        a = a * np.array(tile[2:], np.float32) + np.array(tile[:2], np.float32)
        la.data.foreach_set('uv', a.ravel())
        o.data.uv_layers.active = la
        # imported kit objects rotate by quaternion, and rotation_euler would be silently ignored
        o.rotation_mode = 'XYZ'
        o.location = u['pos']; o.rotation_euler = (0, 0, u['rot']); o.scale = u['sc']
        scene.collection.objects.link(o)
        placed.append(o)
    units_out.append(e)
log('units', len(m.units), 'kinds', len(units), 'tiled', len(placed))
# one mesh: a bake restarts the renderer for every selected object, which is an hour at this count
if len(placed) > 1:
    bpy.ops.object.select_all(action='DESELECT')
    for o in placed: o.select_set(True)
    bpy.context.view_layer.objects.active = placed[0]
    bpy.ops.object.join()
    placed = [bpy.context.view_layer.objects.active]
    placed[0].data.uv_layers.active = placed[0].data.uv_layers['lm']

# ------------------------------------------------------------------ the ground, with a top-down lightmap of its own
land = None
if COVE:
    GX, GY, GH = m.ground
    nyg, nxg = GH.shape
    i0, j0 = int(cove_layout.INNER[0] - coveland.X0), int(cove_layout.INNER[1] - coveland.Y0)
    i1, j1 = int(cove_layout.INNER[2] - coveland.X0), int(cove_layout.INNER[3] - coveland.Y0)
    vs, fs_, seen_v = [], [], {}
    def vid(i, j):
        k = j * nxg + i
        r = seen_v.get(k)
        if r is None:
            r = seen_v[k] = len(vs)
            vs.append((float(GX[j, i]), float(GY[j, i]), float(GH[j, i])))
        return r
    for j in range(j0, j1):
        for i in range(i0, i1):
            fs_.append((vid(i, j), vid(i + 1, j), vid(i + 1, j + 1), vid(i, j + 1)))
    st = 4
    for j in range(0, nyg - st, st):
        for i in range(0, nxg - st, st):
            if i + st > i0 and i < i1 and j + st > j0 and j < j1: continue
            fs_.append((vid(i, j), vid(i + st, j), vid(i + st, j + st), vid(i, j + st)))
    lmesh = bpy.data.meshes.new('land')
    lmesh.from_pydata(vs, [], fs_)
    lmat = bpy.data.materials.new('land'); lmat.use_nodes = True
    lb = lmat.node_tree.nodes.get('Principled BSDF'); lb.inputs['Base Color'].default_value = (0.2, 0.24, 0.13, 1); lb.inputs['Roughness'].default_value = 0.9
    lmesh.materials.append(lmat)
    lu = lmesh.uv_layers.new(name='lm')
    co = np.array(vs, np.float32)
    uvv = np.stack([(co[:, 0] - coveland.X0) / (coveland.X1 - coveland.X0), (co[:, 1] - coveland.Y0) / (coveland.Y1 - coveland.Y0)], 1)
    vi = np.empty(len(lmesh.loops), np.int32); lmesh.loops.foreach_get('vertex_index', vi)
    lu.data.foreach_set('uv', uvv[vi].ravel())
    lmesh.update()
    land = bpy.data.objects.new('land', lmesh)
    scene.collection.objects.link(land)
    log('land', len(vs), 'verts')

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
SKY = getattr(m, 'sky', dict(hdri='rooftop_night', strength=opt('sky', 2.6), tint=(0.36, 0.62, 1.05)))
env = nt.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(f"{ROOT}/hdri/{SKY['hdri']}.hdr")
bg = nt.nodes['Background']; bg.inputs['Strength'].default_value = SKY['strength']
sun_obj = None
sun_out = None
if 'sun_az' in SKY:
    # the sun comes out of the sky and becomes a lamp: turned to where the map wants it, clipped out of the picture, and
    # the bake then holds only the sky and the bounce. The game draws the direct light itself, so the normal maps answer to it
    src = env.image; W_, H_ = src.size
    px = np.empty(W_ * H_ * 4, np.float32); src.pixels.foreach_get(px); px = px.reshape(H_, W_, 4)[..., :3].copy()
    lum = px @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    up = lum[H_ // 2:]
    r, c = np.unravel_index(int(np.argmax(up)), up.shape); r += H_ // 2
    elev = (r + 0.5) / H_ * math.pi - math.pi / 2
    want = 0.5 - math.atan2(SKY['sun_az'][1], SKY['sun_az'][0]) / (2 * math.pi)
    sh = int(round((want - (c + 0.5) / W_) * W_))
    px = np.roll(px, sh, axis=1); lum = np.roll(lum, sh, axis=1)
    med = float(np.median(up))
    cap = med * SKY['clamp']
    k_ = np.minimum(1.0, cap / np.maximum(lum, 1e-5))[..., None]
    px = px * k_
    rows = (np.arange(H_) + 0.5) / H_ * math.pi - math.pi / 2
    dom = np.cos(rows) * (2 * math.pi / W_) * (math.pi / H_)
    lum2 = px @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    e_up = float(((lum2 * (np.sin(np.maximum(rows, 0)) * dom)[:, None])[H_ // 2:]).sum() / math.pi)
    kk = SKY['sky_e'] / e_up
    img_s = bpy.data.images.new('skyproc', W_, H_, alpha=False, float_buffer=True)
    rgba = np.ones((H_, W_, 4), np.float32); rgba[..., :3] = px
    img_s.pixels.foreach_set(rgba.ravel()); img_s.update(); img_s.pack()
    env.image = img_s
    bg.inputs['Strength'].default_value = kk
    az = math.atan2(SKY['sun_az'][1], SKY['sun_az'][0])
    sd = Vector((math.cos(elev) * math.cos(az), math.cos(elev) * math.sin(az), math.sin(elev)))
    S = SKY['sun_k'] * math.pi * SKY['sky_e']
    ld = bpy.data.lights.new('sun', 'SUN'); ld.energy = S; ld.angle = math.radians(1.0); ld.color = SKY['tone']
    sun_obj = bpy.data.objects.new('sun', ld); scene.collection.objects.link(sun_obj)
    sun_obj.rotation_mode = 'QUATERNION'; sun_obj.rotation_quaternion = (-sd).to_track_quat('-Z', 'Y')
    sun_out = dict(dir=[sd.x, sd.z, -sd.y], power=S, color=list(SKY['tone']), sky=kk)
    log('sun', [round(v, 3) for v in sd], 'elev', round(math.degrees(elev), 1), 'sky strength', round(kk, 4), 'median', round(med, 3), 'E', round(e_up, 3), 'S', round(S, 2))
mixc = nt.nodes.new('ShaderNodeMix'); mixc.data_type = 'RGBA'; mixc.blend_type = 'MULTIPLY'; mixc.inputs['Factor'].default_value = 1.0
mixc.inputs['B'].default_value = (*SKY['tint'], 1)    # the block pulls its sunset down to blue hour
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
for h_ in getattr(m, 'hards', ()):
    colliders.append(dict(a=h_['a'], b=h_['b'], pen=h_['pen'], tag='inv', mat=h_['mat']))
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
json.dump(dict(veg=getattr(m, 'veg', []), centre=getattr(m, 'centre', None), attract=getattr(m, 'attract', None), mats=meta, colliders=colliders, props=props_out, units=units_out, doors=m.doors, glass=m.glass, spawns=m.spawns, hold=m.hold, zones=m.zones, lights=m.lights, rooms=m.rooms,
               density=dens, size=SIZE, sun=sun_out), open(f'{OUT}/map_raw.json', 'w'))
log('geometry written', len(buf) // 1024, 'KB', len(colliders), 'colliders')
# the sky, small, for the backdrop
sky = env.image
SW, SH = (4096, 2048) if sun_obj else (1024, 512)
if sky.size[0] != SW:
    sky = sky.copy(); sky.scale(SW, SH)
sp = np.empty(SW * SH * 4, np.float32); sky.pixels.foreach_get(sp)
np.save(f'{OUT}/sky.npy', sp.reshape(SH, SW, 4)[..., :3].astype(np.float16))
if '--props' in argv:
    col = bpy.data.collections.new('export'); scene.collection.children.link(col)
    # planting never goes in the bake: it only needs to be in the file
    for vid_ in sorted({v_['id'] for v_ in getattr(m, 'veg', ())}):
        a_, b_ = vid_.split('|')
        load_part(a_, None if b_ == 'all' else b_)
    keep_out = []
    seen_img = {}
    for key, src in cache.items():
        o = src.copy(); o.data = src.data.copy(); o.name = (key[0] + '|' + (key[1] or 'all'))
        col.objects.link(o)
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        size = 2 * max(bbox[key])
        budget = 340 if key[0] == 'cardboard_box_01' else (900 if size < 0.4 else 2200 if size < 1.3 else 5000)
        if key[0].startswith('grass'): budget = 240
        elif key[0].startswith(('fern', 'nettle')): budget = 420
        elif key[0].startswith('shrub'): budget = 900
        elif key[0].startswith('tree'): budget = 3000
        elif key[0].startswith(('coast', 'rock')): budget = 1500
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
    for key, src in units.items():
        # the source gives up its name, or the export gets a .001 on it and the game can't find the module
        name = src.name; src.name = name + '~'
        o = src.copy(); o.data = src.data.copy(); o.name = name
        col.objects.link(o)
    for kit in kits.values():
        for mo in kit.values():
            for ms in mo.material_slots:
                if not ms.material or not ms.material.use_nodes: continue
                for nd in ms.material.node_tree.nodes:
                    if nd.type == 'TEX_IMAGE' and nd.image and nd.image.size[0] > 1024 and seen_img.get(nd.image.name, 0) < 1024:
                        nd.image.scale(1024, 1024); seen_img[nd.image.name] = 1024
    bpy.ops.object.select_all(action='DESELECT')
    for o in col.objects: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/props.glb', export_format='GLB', use_selection=True, export_image_format='JPEG', export_image_quality=70, export_apply=False,
                              export_animations=False, export_cameras=False, export_lights=False, export_yup=True, export_tangents=False)
    log('props.glb', os.path.getsize(f'{OUT}/props.glb') // 1024, 'KB')
# 350 MB of debugging aid: only on request
if '--blend' in argv: bpy.ops.wm.save_as_mainfile(filepath=f'{OUT}/scene.blend')
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
def bake_light(image, margin):
    """with a sun in the sky, two goes: all the bounce with the lamp on, then the direct sky with it off. The lamp's direct light stays out"""
    if sun_obj is None:
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=margin, margin_type='EXTEND', use_clear=True, uv_layer='lm')
        return
    keep = sun_obj.data.energy
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'INDIRECT'}, margin=margin, margin_type='EXTEND', use_clear=True, uv_layer='lm')
    n = image.size[0] * image.size[1] * 4
    a = np.empty(n, np.float32); image.pixels.foreach_get(a)
    sun_obj.data.energy = 0
    mb = scene.cycles.max_bounces; scene.cycles.max_bounces = 0
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT'}, margin=margin, margin_type='EXTEND', use_clear=True, uv_layer='lm')
    b_ = np.empty(n, np.float32); image.pixels.foreach_get(b_)
    sun_obj.data.energy = keep; scene.cycles.max_bounces = mb
    image.pixels.foreach_set(a + b_)
    image.update()
bake_light(img, 2)
log('baked')
px = np.empty(SIZE * SIZE * 4, np.float32); img.pixels.foreach_get(px)
np.save(f'{OUT}/lightmap.npy', px.reshape(SIZE, SIZE, 4)[..., :3].astype(np.float16))
img.filepath_raw = f'{OUT}/lightmap.exr'; img.file_format = 'OPEN_EXR'; img.save()
log('saved', float(px.mean()), float(np.percentile(px, 99)))
# the same again for the kit, into its own atlas
img2 = bpy.data.images.new('lightmap2', SIZE, SIZE, alpha=False, float_buffer=True)
seen = set()
for o in placed:
    for ms in o.material_slots:
        mt = ms.material
        if mt is None or mt.name in seen: continue
        seen.add(mt.name)
        nd = mt.node_tree.nodes.new('ShaderNodeTexImage'); nd.image = img2; nd.select = True
        mt.node_tree.nodes.active = nd
if placed:
    bpy.ops.object.select_all(action='DESELECT')
    for o in placed: o.select_set(True)
    bpy.context.view_layer.objects.active = placed[0]
    log('baking kit', len(placed))
    bake_light(img2, 2)
    log('baked kit')
img2.filepath_raw = f'{OUT}/lightmap2.exr'; img2.file_format = 'OPEN_EXR'; img2.save()
if land is not None:
    img3 = bpy.data.images.new('lightmap3', SIZE, SIZE, alpha=False, float_buffer=True)
    nd = lmat.node_tree.nodes.new('ShaderNodeTexImage'); nd.image = img3; nd.select = True
    lmat.node_tree.nodes.active = nd
    bpy.ops.object.select_all(action='DESELECT')
    land.select_set(True); bpy.context.view_layer.objects.active = land
    lmesh.uv_layers.active = lu
    log('baking land')
    bake_light(img3, 4)
    log('baked land')
    img3.filepath_raw = f'{OUT}/lightmap3.exr'; img3.file_format = 'OPEN_EXR'; img3.save()
