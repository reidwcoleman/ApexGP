# The plush fighter: one soft skinned body (metaball families fused per limb so an arm can swing
# free of the torso), eleven bones that match the ragdoll's eleven rigid bodies one to one, button
# eyes, a stitched smile and a belly patch riding on the bones. Rest pose = the physics rest pose
# (src/brawl/fighter.ts BODY): facing +z, feet on y = 0, arms hanging.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from mathutils import Quaternion
from mathutils.bvhtree import BVHTree

reset()
K = 1 / 0.574  # metaball radius -> surface radius (stiffness 2, threshold 0.6)

PLUSH = mat('plush', (1, 1, 1), rough=0.95, sheen=1.0)
PATCH = mat('patch', (1, 1, 1), rough=0.95, sheen=1.0)
BUTTON = mat('button', (0.025, 0.02, 0.03), rough=0.22, clearcoat=1.0)
THREAD = mat('thread', (0.06, 0.04, 0.05), rough=0.85)
KO = mat('thread_ko', (0.06, 0.04, 0.05), rough=0.85)
NOSE = mat('nose', (0.16, 0.07, 0.07), rough=0.7, sheen=0.6)


def meta(name, elems, res=0.022):
    mb = bpy.data.metaballs.new(name)
    mb.resolution = res
    mb.render_resolution = res
    mb.threshold = 0.6
    o = bpy.data.objects.new(name, mb)
    link(o)
    for e in elems:
        el = mb.elements.new()
        el.stiffness = 2.0
        kind = e[0]
        if kind == 'ball':
            _, c, r = e
            el.type = 'BALL'
            el.co = G(*c)
            el.radius = r * K
        elif kind == 'ell':
            _, c, rr = e
            el.type = 'ELLIPSOID'
            el.co = G(*c)
            el.radius = K
            el.size_x, el.size_y, el.size_z = rr[0], rr[2], rr[1]
        elif kind == 'cap':
            _, a, b, r = e
            A, B = G(*a), G(*b)
            d = B - A
            el.type = 'CAPSULE'
            el.co = (A + B) / 2
            el.radius = r * K
            el.size_x = d.length / 2
            el.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized())
    active(o)
    bpy.ops.object.convert(target='MESH')
    m = bpy.context.active_object
    m.name = name
    return m


def mirror(c):
    return (-c[0], c[1], c[2])


SH, EL, WR = (0.31, 1.3, 0), (0.38, 1.03, 0), (0.39, 0.77, 0)
HIP, KNEE, ANK = (0.12, 0.72, 0), (0.12, 0.41, 0), (0.12, 0.12, 0)

body = meta('mb_body', [
    ('ell', (0, 1.61, 0), (0.315, 0.29, 0.29)),
    ('ball', (0.205, 1.86, -0.01), 0.085),
    ('ball', (-0.205, 1.86, -0.01), 0.085),
    ('ell', (0, 1.11, 0.01), (0.29, 0.3, 0.27)),
    ('ell', (0, 0.83, 0), (0.25, 0.17, 0.22)),
    ('ball', (0, 1.36, 0), 0.14),
])


def arm(s):
    f = (lambda c: c) if s > 0 else mirror
    return meta('mb_arm' + ('L' if s > 0 else 'R'), [
        ('cap', f(SH), f(EL), 0.088),
        ('cap', f(EL), f(WR), 0.082),
        ('ell', f((0.395, 0.71, 0.0)), (0.1, 0.12, 0.09)),
        ('ball', f((0.335, 0.77, 0.06)), 0.045),
    ])


def leg(s):
    f = (lambda c: c) if s > 0 else mirror
    return meta('mb_leg' + ('L' if s > 0 else 'R'), [
        ('cap', f(HIP), f(KNEE), 0.1),
        ('cap', f(KNEE), f(ANK), 0.092),
        ('ell', f((0.12, 0.075, 0.05)), (0.105, 0.075, 0.155)),
    ])


parts = {'body': body, 'armL': arm(1), 'armR': arm(-1), 'legL': leg(1), 'legR': leg(-1)}
# tag every vertex with its family before joining (weights depend on it)
fam_of = {}
for i, (k, o) in enumerate(parts.items()):
    a = o.data.attributes.new('fam', 'INT', 'POINT')
    for d in a.data:
        d.value = i
    modifier(o, 'DECIMATE', ratio=0.55)
plush = join(list(parts.values()), 'plush')
plush.data.materials.clear()
plush.data.materials.append(PLUSH)
smooth(plush)
FAMS = list(parts.keys())

# ---- armature: one bone per rigid body, all at the root (the game drives them in world space)
BONES = {
    'pelvis': ((0, 0.8, 0), (0, 0.96, 0)),
    'chest': ((0, 0.96, 0), (0, 1.37, 0)),
    'head': ((0, 1.37, 0), (0, 1.85, 0)),
    'upperarm.L': (SH, EL), 'forearm.L': (EL, (0.39, 0.64, 0)),
    'upperarm.R': (mirror(SH), mirror(EL)), 'forearm.R': (mirror(EL), (-0.39, 0.64, 0)),
    'thigh.L': (HIP, KNEE), 'shin.L': (KNEE, (0.12, 0.06, 0.05)),
    'thigh.R': (mirror(HIP), mirror(KNEE)), 'shin.R': (mirror(KNEE), (-0.12, 0.06, 0.05)),
}
ad = bpy.data.armatures.new('rig')
rig = bpy.data.objects.new('rig', ad)
link(rig)
active(rig)
bpy.ops.object.mode_set(mode='EDIT')
for n, (h, t) in BONES.items():
    b = ad.edit_bones.new(n)
    b.head = G(*h)
    b.tail = G(*t)
    b.roll = 0
bpy.ops.object.mode_set(mode='OBJECT')


def seg_t(p, a, b):
    a, b = Vector(a), Vector(b)
    d = b - a
    return max(0.0, min(1.0, (p - a).dot(d) / d.length_squared))


def ss(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


groups = {n: plush.vertex_groups.new(name=n) for n in BONES}
fam = plush.data.attributes['fam'].data
for v in plush.data.vertices:
    p = Vector((v.co.x, v.co.z, -v.co.y))  # back to the game frame
    f = FAMS[fam[v.index].value]
    w = {}
    if f == 'body':
        hc = ss(1.3, 1.42, p.y)
        pc = ss(0.86, 1.02, p.y)
        w['head'] = hc
        w['chest'] = (1 - hc) * pc
        w['pelvis'] = (1 - hc) * (1 - pc)
    elif f in ('armL', 'armR'):
        s = 'L' if f == 'armL' else 'R'
        m = (lambda c: c) if s == 'L' else mirror
        sh, el = Vector(m(SH)), Vector(m(EL))
        d_up = (p - sh).dot((el - sh).normalized())
        fore = ss(-0.06, 0.06, d_up - (el - sh).length)
        root = ss(0.0, 0.1, d_up)
        w['forearm.' + s] = fore
        w['upperarm.' + s] = (1 - fore) * root
        w['chest'] = (1 - fore) * (1 - root)
    else:
        s = 'L' if f == 'legL' else 'R'
        kn = ss(0.47, 0.35, p.y)
        root = ss(0.74, 0.64, p.y)
        w['shin.' + s] = kn
        w['thigh.' + s] = (1 - kn) * root
        w['pelvis'] = (1 - kn) * (1 - root)
    tot = sum(w.values()) or 1
    for n, x in w.items():
        if x > 1e-3:
            groups[n].add([v.index], x / tot, 'REPLACE')
plush.data.attributes.remove(plush.data.attributes['fam'])

# ---- face and patch: placed on the surface by ray casts, riding the head / chest bones
bm = bmesh.new()
bm.from_mesh(plush.data)
bvh = BVHTree.FromBMesh(bm)
bm.free()


def surf(x, y):
    """the front surface point and normal at game (x, y)"""
    o = G(x, y, 1.0)
    hit, n, i, d = bvh.ray_cast(o, Vector((0, 1, 0)))
    return hit, n


def place(o, x, y, bone, lift=0.004, spin=0.0):
    p, n = surf(x, y)
    q = Vector((0, 0, 1)).rotation_difference(n)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = q @ Quaternion(Vector((0, 0, 1)), spin)
    o.location = p + n * lift
    o['bone'] = bone
    return o


def disc(name, r, h, m, seg=24, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=h)
    o = obj_from_bm(bm, name, m)
    if bevel:
        modifier(o, 'BEVEL', width=bevel, segments=3, limit_method='ANGLE')
    smooth(o, math.radians(50))
    return o


def dash(name, length, r, m):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=1)
    for v in bm.verts:
        v.co = Vector((v.co.x * length / 2, v.co.y * r, v.co.z * r))
    o = obj_from_bm(bm, name, m)
    smooth(o)
    return o


face = []
for s, x in (('L', 0.105), ('R', -0.105)):
    e = disc('eye_' + s, 0.058, 0.03, BUTTON, bevel=0.012)
    holes = []
    for k, (hx, hy) in enumerate(((0.017, 0.017), (-0.017, 0.017), (0.017, -0.017), (-0.017, -0.017))):
        h = disc('hole', 0.008, 0.02, THREAD, seg=10)
        h.location = Vector((hx, hy, 0.012))
        holes.append(h)
    e = join([e] + holes, 'eye_' + s)
    face.append(place(e, x, 1.665, 'head', lift=0.006))
    # the knocked-out eyes: stitched crosses, hidden until then
    a = dash('ko_a', 0.11, 0.011, THREAD)
    a.rotation_euler = (0, 0, math.radians(45))
    b = dash('ko_b', 0.11, 0.011, THREAD)
    b.rotation_euler = (0, 0, math.radians(-45))
    a.data.materials.clear(); a.data.materials.append(KO)
    b.data.materials.clear(); b.data.materials.append(KO)
    x2 = join([a, b], 'eyeko_' + s)
    bpy.context.view_layer.update()
    active(x2)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    face.append(place(x2, x, 1.665, 'head', lift=0.008))
nose = disc('nose', 0.03, 0.03, NOSE, bevel=0.01)
nose.scale = (1.25, 0.9, 1)
face.append(place(nose, 0, 1.6, 'head', lift=0.004))
for i in range(5):
    t = (i - 2) / 2
    x, y = t * 0.075, 1.535 + (t * t) * 0.022
    d = dash('mouth', 0.032, 0.009, THREAD)
    face.append(place(d, x, y, 'head', lift=0.002, spin=math.atan2(2 * t * 0.022, 0.075) * 0.8))
# the belly patch and its stitches
patch = disc('patch', 0.12, 0.012, PATCH, seg=40, bevel=0.005)
patch.scale = (1.0, 1.15, 1)
face.append(place(patch, 0, 1.06, 'chest', lift=0.002))
for i in range(14):
    a = i / 14 * math.tau
    x, y = math.cos(a) * 0.104, 1.06 + math.sin(a) * 0.122
    d = dash('stitch', 0.028, 0.007, THREAD)
    face.append(place(d, x, y, 'chest', lift=0.007, spin=a + math.pi / 2))
# a seam over the top of the head
for i in range(7):
    y = 1.73 + i * 0.03
    d = dash('seam', 0.026, 0.0075, THREAD)
    p, n = surf(0.0, min(y, 1.86))
    face.append(place(d, 0.0, min(y, 1.86), 'head', lift=0.003, spin=math.pi / 2))

for f in face:
    for p in f.data.polygons:
        p.use_smooth = True

# occlusion in the rest pose: local creases only (limbs move)
bake_ao([plush], distance=0.09, samples=32)
# the face joins the skinned mesh, all of each piece on its bone
for f in face:
    active(f)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    vg = f.vertex_groups.new(name=f['bone'])
    vg.add([v.index for v in f.data.vertices], 1.0, 'REPLACE')
    ca = f.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for d in ca.data:
        d.color = (1, 1, 1, 1)
plush = join([plush] + face, 'plush')
plush.parent = rig
mod = plush.modifiers.new('rig', 'ARMATURE')
mod.object = rig

export([rig, plush], 'fighter', skins=True)
print('verts', len(plush.data.vertices))
