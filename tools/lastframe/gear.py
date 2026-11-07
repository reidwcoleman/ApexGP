"""Blender: what people wear over the avatar, modelled to its measurements (bind pose, metres).
Ambient occlusion goes into the vertex colours, against a stand-in body, so a pouch sits in its own
shadow under any lamp. Exports gear.glb: one object per piece, in bind space, each worn on one bone.
  blender -b --python tools/lastframe/gear.py -- OUT.glb
Coordinates here are the game's: x left of the wearer, y up, z forward. P() turns them into Blender's.
"""
import bpy, bmesh, sys, math
from mathutils import Vector
OUT = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
PI = math.pi

def P(x, y, z): return (x, -z, y)

class Part:
    """one object made of many pieces; shade is carried in the colour attribute, per piece"""
    def __init__(s, name):
        s.name = name
        s.bm = bmesh.new()
        s.shade = s.bm.faces.layers.float.new('shade')
    def _set(s, faces, k):
        for f in faces: f[s.shade] = k
    def grid(s, fn, nu, nv, closeu=False, closev=False, k=1.0):
        """a skin over fn(u, v) -> (x, y, z), u, v in 0..1"""
        vs = []
        uu = nu if closeu else nu + 1
        vv = nv if closev else nv + 1
        for j in range(vv):
            row = []
            for i in range(uu):
                row.append(s.bm.verts.new(P(*fn(i / nu, j / nv))))
            vs.append(row)
        fs = []
        for j in range(nv):
            for i in range(nu):
                a = vs[j][i]; b = vs[j][(i + 1) % uu]; c = vs[(j + 1) % vv][(i + 1) % uu]; d = vs[(j + 1) % vv][i]
                if len({a, b, c, d}) == 4:
                    fs.append(s.bm.faces.new((a, b, c, d)))
        s._set(fs, k)
        return fs
    def shell(s, fn, nu, nv, t, closeu=False, k=1.0, normal=None):
        """a panel with thickness t: outside skin, inside skin, and the edge between them"""
        def out(u, v):
            p = Vector(fn(u, v)); n = Vector(normal(u, v)); return tuple(p + n * t)
        A = s.grid(out, nu, nv, closeu, False, k)
        B = s.grid(fn, nu, nv, closeu, False, k * 0.6)
        return A, B
    def box(s, c, sz, k=1.0, bevel=0.0, rot=None):
        """c centre, sz full size, rot (axis, angle) about the centre"""
        m = bmesh.ops.create_cube(s.bm, size=1.0)
        vs = m['verts']
        from mathutils import Matrix
        M = Matrix.Diagonal((sz[0], sz[2], sz[1], 1.0))
        bmesh.ops.transform(s.bm, matrix=M, verts=vs)
        if rot:
            ax, ang = rot
            bmesh.ops.rotate(s.bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(ang, 3, Vector(P(*ax))))
        bmesh.ops.translate(s.bm, verts=vs, vec=P(*c))
        fs = list({f for v in vs for f in v.link_faces})
        if bevel:
            es = list({e for v in vs for e in v.link_edges})
            r = bmesh.ops.bevel(s.bm, geom=es + vs, offset=bevel, segments=1, profile=0.5, affect='EDGES')
            fs = fs + r.get('faces', [])
            fs = [f for f in fs if f.is_valid]
        s._set(fs, k)
        return vs
    def tube(s, pts, r, n=8, k=1.0):
        """round section along a path"""
        pts = [Vector(p) for p in pts]
        def fn(u, v):
            i = min(len(pts) - 2, int(v * (len(pts) - 1)))
            t = v * (len(pts) - 1) - i
            p = pts[i].lerp(pts[i + 1], t)
            d = (pts[i + 1] - pts[i]).normalized()
            a = d.orthogonal().normalized(); b = d.cross(a)
            ang = u * 2 * PI
            return tuple(p + a * (math.cos(ang) * r) + b * (math.sin(ang) * r))
        return s.grid(fn, n, (len(pts) - 1) * 2, closeu=True, k=k)
    def cyl(s, c, axis, r, h, n=14, k=1.0, r2=None):
        """a disc or a can about an axis"""
        a = Vector(axis).normalized(); c = Vector(c)
        o = a.orthogonal().normalized(); b = a.cross(o)
        rs = (r, r2 if r2 is not None else r)
        rings = []
        for sgn, rr in ((-1, rs[0]), (1, rs[1])):
            rings.append([s.bm.verts.new(P(*(c + a * (h / 2 * sgn) + o * (math.cos(i / n * 2 * PI) * rr) + b * (math.sin(i / n * 2 * PI) * rr)))) for i in range(n)])
        fs = [s.bm.faces.new(rings[0]), s.bm.faces.new(list(reversed(rings[1])))]
        for i in range(n):
            j = (i + 1) % n
            fs.append(s.bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i])))
        s._set(fs, k)
    def finish(s):
        bmesh.ops.recalc_face_normals(s.bm, faces=s.bm.faces)
        me = bpy.data.meshes.new(s.name)
        s.bm.to_mesh(me)
        shade = [0.0] * len(me.polygons)
        lay = s.bm.faces.layers.float['shade']
        for i, f in enumerate(s.bm.faces): shade[i] = f[lay]
        s.bm.free()
        o = bpy.data.objects.new(s.name, me)
        scene.collection.objects.link(o)
        for p in me.polygons: p.use_smooth = True
        # corners stay crisp, curves stay round
        me.shade_smooth() if hasattr(me, 'shade_smooth') else None
        m = o.modifiers.new('e', 'EDGE_SPLIT'); m.split_angle = math.radians(48)
        o['shade'] = shade
        return o

# ------------------------------------------------------------------ the helmet
def helmet():
    p = Part('helmet')
    cx, cy, cz = 0, 1.708, 0.024
    R = (0.1125, 0.112, 0.133)
    def rim(th):
        """how far down the shell comes, by the angle round the head: cut high at the ears and brow"""
        f = math.cos(th)                      # 1 at the front
        side = abs(math.sin(th))
        low = 1.62 + 0.055 * max(0, f) ** 2 + 0.19 * side ** 6 * (1 if f > -0.1 else 0.42) - 0.0 * f
        return low
    def fn(u, v):
        th = u * 2 * PI
        lim = rim(th)
        ph = v ** 0.9 * (lim / 2)             # polar angle from the crown, down to the cut
        return (cx + math.sin(th) * math.sin(ph) * R[0], cy + math.cos(ph) * R[1], cz + math.cos(th) * math.sin(ph) * R[2])
    def nrm(u, v):
        a = Vector(fn(u, v)); return tuple((a - Vector((cx, cy, cz))).normalized())
    p.shell(fn, 40, 10, 0.0085, closeu=True, normal=nrm, k=1.0)
    # rails down each side and a shroud on the brow
    for s in (-1, 1):
        for i in range(3):
            p.box((s * 0.114, 1.722 - i * 0.002, -0.022 + i * 0.03), (0.012, 0.022, 0.026), k=0.72, bevel=0.002, rot=((0, 0, 1), s * 0.25))
        # ear cups and their arms
        p.cyl((s * 0.098, 1.676, 0.026), (1, 0, 0), 0.038, 0.03, k=0.55, r2=0.033)
        p.cyl((s * 0.116, 1.676, 0.026), (1, 0, 0), 0.02, 0.008, k=0.8)
        p.tube([(s * 0.1, 1.71, 0.022), (s * 0.108, 1.74, 0.02), (s * 0.1, 1.7, 0.02)], 0.004, 6, k=0.6)
    p.box((0, 1.758, 0.142), (0.052, 0.04, 0.012), k=0.74, bevel=0.002, rot=((1, 0, 0), -0.32))
    p.box((0, 1.775, 0.128), (0.03, 0.016, 0.02), k=0.6, bevel=0.002)
    # velcro on the crown and the back
    p.box((0, 1.815, 0.006), (0.09, 0.006, 0.09), k=1.15, bevel=0.001)
    p.box((0, 1.74, -0.106), (0.08, 0.05, 0.008), k=1.15, rot=((1, 0, 0), 0.3))
    # chin strap
    for s in (-1, 1):
        p.tube([(s * 0.1, 1.66, 0.04), (s * 0.09, 1.61, 0.06), (s * 0.05, 1.565, 0.08), (0, 1.552, 0.088)], 0.0052, 5, k=0.7)
    # boom mic
    p.tube([(-0.098, 1.665, 0.048), (-0.09, 1.635, 0.1), (-0.055, 1.625, 0.15)], 0.0028, 5, k=0.6)
    p.cyl((-0.05, 1.625, 0.155), (1, 0, 0.3), 0.009, 0.022, k=0.5)
    return p.finish()

def glasses():
    p = Part('glasses')
    def fn(u, v):
        a = (u - 0.5) * 2.3
        return (math.sin(a) * 0.092, 1.671 + 0.04 * v, 0.022 + math.cos(a) * 0.112 - 0.004 * math.sin(v * PI))
    p.grid(fn, 18, 3, k=1.0)
    return p.finish()

# ------------------------------------------------------------------ the vest
def chest_curve(x, z0, bow):
    return z0 + bow * (1 - (x / 0.2) ** 2)

def panel(p, front, y0, y1, w, k=1.0, t=0.03, scoop=0.0):
    """a plate bag: curved a little across the chest, its top cut away for the neck"""
    s = 1 if front else -1
    def fn(u, v):
        x = (u - 0.5) * 2 * w * (1 - 0.1 * v * v)
        top = y1 - scoop * math.exp(-(x / 0.075) ** 2)
        y = y0 + (top - y0) * v
        z = s * (chest_curve(x, 0.138, 0.04) + 0.004 * math.sin(v * PI))
        return (x, y, z + (-0.022 if not front else 0.0) * 0 - 0.012 * s * 0 + (0.0))
    def nrm(u, v): return (0, 0, s)
    A, B = p.shell(fn, 14, 10, t, normal=nrm, k=k)
    # close the rim
    return fn

def pouch(p, x, y, z, w, h, d, k=0.92, flap=True, s=1):
    p.box((x, y, z), (w, h, d), k=k, bevel=0.005)
    if flap:
        p.box((x, y + h / 2 - 0.012, z + s * d * 0.2), (w + 0.006, 0.03, d * 0.72), k=k * 0.9, bevel=0.004)
        p.box((x, y + h / 2 - 0.03, z + s * (d * 0.56 + 0.002)), (0.022, 0.016, 0.004), k=0.55)

def vest():
    p = Part('vest')
    front = panel(p, True, 1.09, 1.45, 0.158, scoop=0.07)
    panel(p, False, 1.09, 1.46, 0.158, scoop=0.03)
    # cummerbund: round the waist under the arms
    def cb(u, v, r=0.0):
        a = -0.9 + 1.8 * u                       # angle about the side
        return None
    for s in (-1, 1):
        def fn(u, v, s=s):
            a = (u - 0.5) * 2.0
            x = s * (0.158 + 0.052 * math.cos(a * PI / 2))
            return (x, 1.075 + 0.135 * v, math.sin(a * PI / 2) * 0.178)
        def nr(u, v, s=s):
            a = (u - 0.5) * 2.0
            return (s * math.cos(a * PI / 2), 0, math.sin(a * PI / 2))
        p.shell(fn, 12, 3, 0.012, normal=nr, k=0.95)
        # shoulder straps over the top
        pts = [(s * 0.098, 1.44, 0.15), (s * 0.112, 1.495, 0.1), (s * 0.122, 1.514, 0.03), (s * 0.122, 1.51, -0.04), (s * 0.112, 1.48, -0.11), (s * 0.098, 1.44, -0.15)]
        def st(u, v, pts=pts):
            i = min(len(pts) - 2, int(v * (len(pts) - 1)))
            t = v * (len(pts) - 1) - i
            q = Vector(pts[i]).lerp(Vector(pts[i + 1]), t)
            return (q.x + (u - 0.5) * 0.058, q.y, q.z)
        def sn(u, v): return (0, 1, 0)
        p.shell(st, 2, 12, 0.009, normal=sn, k=0.9)
    # MOLLE: rows of webbing, front
    for row in range(5):
        y = 1.235 + row * 0.03
        z = 0.2
        for i in range(6):
            x = -0.125 + i * 0.05
            p.box((x, y, chest_curve(x, 0.17, 0.04) + 0.002), (0.042, 0.016, 0.006), k=0.78)
    # three double magazine pouches along the bottom, the radio high on the left, admin on the right
    for x in (-0.103, 0, 0.103):
        pouch(p, x, 1.145, chest_curve(x, 0.17, 0.04) + 0.03, 0.09, 0.15, 0.052)
    pouch(p, 0.112, 1.345, chest_curve(0.11, 0.17, 0.04) + 0.024, 0.066, 0.13, 0.042, k=0.8)
    p.box((0.112, 1.42, chest_curve(0.11, 0.17, 0.04) + 0.03), (0.012, 0.03, 0.012), k=0.5)
    p.tube([(0.128, 1.41, 0.17), (0.138, 1.5, 0.15), (0.16, 1.66, 0.1)], 0.0036, 5, k=0.45)
    pouch(p, -0.095, 1.345, chest_curve(0.095, 0.17, 0.04) + 0.018, 0.1, 0.085, 0.03)
    # the camera on the chest: this is whose film it is
    p.box((0.0, 1.405, chest_curve(0, 0.175, 0.04) + 0.014), (0.062, 0.078, 0.026), k=0.5, bevel=0.003)
    p.cyl((0.0, 1.415, chest_curve(0, 0.175, 0.04) + 0.03), (0, 0, 1), 0.013, 0.008, k=0.28)
    # back: a hydration pouch and a drag handle
    pouch(p, 0, 1.25, -0.2, 0.2, 0.24, 0.05, s=-1, flap=False, k=0.88)
    p.tube([(-0.06, 1.44, -0.178), (-0.05, 1.47, -0.195), (0.05, 1.47, -0.195), (0.06, 1.44, -0.178)], 0.008, 6, k=0.7)
    return p.finish()

def belt():
    p = Part('belt')
    def fn(u, v):
        a = u * 2 * PI
        return (math.sin(a) * 0.195, 0.965 + 0.05 * v, math.cos(a) * 0.17 + 0.012)
    def nr(u, v):
        a = u * 2 * PI
        return (math.sin(a), 0, math.cos(a))
    p.shell(fn, 26, 2, 0.012, closeu=True, normal=nr, k=0.8)
    p.box((0, 0.99, 0.2), (0.05, 0.04, 0.012), k=0.5, bevel=0.002)
    pouch(p, -0.17, 0.96, 0.1, 0.05, 0.1, 0.07, flap=True, k=0.85)
    pouch(p, 0.17, 0.965, 0.09, 0.05, 0.09, 0.08, k=0.85)
    pouch(p, 0.12, 0.95, -0.17, 0.09, 0.1, 0.05, s=-1, k=0.85)
    return p.finish()

def holster():
    p = Part('holster')
    # strapped to the outside of the right thigh; the pistol's grip stands out of it
    p.box((-0.185, 0.72, 0.01), (0.04, 0.2, 0.09), k=0.6, bevel=0.008)
    p.box((-0.188, 0.84, -0.005), (0.03, 0.075, 0.032), k=0.45, bevel=0.005)
    def ring(y, k):
        def fn(u, v):
            a = u * 2 * PI
            return (-0.105 + math.sin(a) * 0.095, y + 0.02 * v, 0.01 + math.cos(a) * 0.11)
        def nr(u, v):
            a = u * 2 * PI
            return (math.sin(a), 0, math.cos(a))
        p.shell(fn, 18, 1, 0.005, closeu=True, normal=nr, k=k)
    ring(0.67, 0.72)
    ring(0.77, 0.72)
    p.box((-0.15, 0.91, 0.005), (0.04, 0.2, 0.02), k=0.72, rot=((0, 0, 1), -0.12))
    return p.finish()

def knee(s, name):
    p = Part(name)
    def fn(u, v):
        a = (u - 0.5) * 2.4
        y = 0.43 + 0.15 * v
        b = math.sin(v * PI)
        return (s * 0.108 + math.sin(a) * (0.05 + 0.018 * b), y, 0.03 + math.cos(a) * (0.063 + 0.022 * b))
    def nr(u, v):
        a = (u - 0.5) * 2.4
        return (math.sin(a), 0, math.cos(a))
    p.shell(fn, 10, 6, 0.012, normal=nr, k=0.7)
    for y in (0.46, 0.55):
        def st(u, v, y=y):
            a = u * 2 * PI
            return (s * 0.108 + math.sin(a) * 0.066, y + 0.018 * v, 0.018 + math.cos(a) * 0.075)
        def sn(u, v):
            a = u * 2 * PI
            return (math.sin(a), 0, math.cos(a))
        p.shell(st, 14, 1, 0.003, closeu=True, normal=sn, k=0.8)
    return p.finish()

def pack():
    p = Part('pack')
    def fn(u, v):
        a = (u - 0.5) * 2 * PI
        x = math.sin(a) * 0.145
        y = 1.05 + 0.4 * v
        b = math.sin(min(1, v * 1.1) * PI) ** 0.5
        return (x, y, -0.2 + (math.cos(a) * -0.5 - 0.5) * 0.14 * (0.4 + 0.6 * b))
    p.grid(fn, 16, 6, closeu=True, k=0.82)
    pouch(p, 0, 1.16, -0.355, 0.2, 0.17, 0.05, s=-1, k=0.75)
    p.tube([(-0.11, 1.45, -0.21), (-0.115, 1.5, -0.1)], 0.012, 6, k=0.7)
    p.tube([(0.11, 1.45, -0.21), (0.115, 1.5, -0.1)], 0.012, 6, k=0.7)
    return p.finish()

# ------------------------------------------------------------------ the other side
def beanie():
    p = Part('beanie')
    cx, cy, cz = 0, 1.7, 0.022
    def fn(u, v):
        th = u * 2 * PI
        ph = v * 1.32
        rib = 1 + 0.012 * math.sin(th * 26) * (v > 0.72)
        return (cx + math.sin(th) * math.sin(ph) * 0.106 * rib, cy + math.cos(ph) * 0.122, cz + math.cos(th) * math.sin(ph) * 0.127 * rib)
    p.grid(fn, 52, 9, closeu=True, k=1.0)
    return p.finish()

def hood():
    p = Part('hood')
    # a hood down on the shoulders: a thick roll behind the neck
    def fn(u, v):
        a = (u - 0.5) * 3.9
        b = v * 2 * PI
        r = 0.04 + 0.028 * math.cos(a * 0.8) ** 2
        return (math.sin(a) * (0.11 + r * math.cos(b)), 1.5 + r * math.sin(b) * 1.1 - 0.05 * abs(math.sin(a)), -0.015 + math.cos(a) * -(0.09 + r * math.cos(b)) * 1.0)
    p.grid(fn, 22, 9, closev=True, k=0.92)
    return p.finish()

def rig():
    p = Part('rig')
    # four pouches on a chest panel, straps crossing behind
    def fn(u, v):
        x = (u - 0.5) * 0.3
        return (x, 1.14 + 0.15 * v, chest_curve(x, 0.145, 0.04))
    def nr(u, v): return (0, 0, 1)
    p.shell(fn, 10, 3, 0.012, normal=nr, k=0.9)
    for x in (-0.11, -0.037, 0.037, 0.11):
        pouch(p, x, 1.21, chest_curve(x, 0.158, 0.04) + 0.024, 0.066, 0.16, 0.048, k=0.82)
    for s in (-1, 1):
        p.tube([(s * 0.13, 1.28, 0.16), (s * 0.13, 1.42, 0.13), (s * 0.13, 1.5, 0.05), (s * 0.12, 1.49, -0.06), (s * 0.03, 1.36, -0.165), (-s * 0.13, 1.2, -0.18)], 0.012, 5, k=0.75)
    return p.finish()

def satchel():
    p = Part('satchel')
    p.box((-0.215, 1.0, -0.03), (0.08, 0.2, 0.26), k=0.82, bevel=0.012)
    p.box((-0.255, 1.06, -0.03), (0.012, 0.09, 0.27), k=0.7, bevel=0.003)
    p.tube([(-0.18, 1.1, 0.03), (-0.1, 1.28, 0.165), (0.08, 1.46, 0.13), (0.17, 1.5, 0.0), (0.1, 1.42, -0.15), (-0.1, 1.24, -0.17), (-0.2, 1.1, -0.08)], 0.011, 5, k=0.72)
    return p.finish()

parts = [helmet(), glasses(), vest(), belt(), holster(), knee(1, 'kneeL'), knee(-1, 'kneeR'), pack(), beanie(), hood(), rig(), satchel()]

# ------------------------------------------------------------------ AO, against a stand-in for the body
body = []
bm = bmesh.new()
def ell(c, r):
    m = bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=14, radius=1.0)
    from mathutils import Matrix
    bmesh.ops.transform(bm, matrix=Matrix.Translation(P(*c)) @ Matrix.Diagonal((r[0], r[2], r[1], 1.0)), verts=m['verts'])
ell((0, 1.28, 0), (0.185, 0.3, 0.14))
ell((0, 0.95, 0), (0.19, 0.16, 0.15))
ell((0, 1.7, 0.03), (0.095, 0.125, 0.115))
ell((0.11, 0.7, 0.01), (0.09, 0.32, 0.1))
ell((-0.11, 0.7, 0.01), (0.09, 0.32, 0.1))
me = bpy.data.meshes.new('standin'); bm.to_mesh(me); bm.free()
stand = bpy.data.objects.new('standin', me); scene.collection.objects.link(stand)

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 64
scene.world = bpy.data.worlds.new('w'); scene.world.use_nodes = True
scene.world.light_settings.distance = 0.12
mat = bpy.data.materials.new('white'); mat.use_nodes = True
for o in parts:
    o.data.materials.append(mat)
for o in parts:
    bpy.ops.object.select_all(action='DESELECT')
    for q in parts: q.hide_render = q is not o
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='e')
    # the shade per face moved through the split: carry it by polygon centre
    ca = o.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    o.data.color_attributes.active_color = ca
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    col = o.data.color_attributes['Col'].data
    shade = list(o['shade'])
    k = [1.0] * len(o.data.vertices)
    for poly in o.data.polygons:
        if poly.index < len(shade):
            for v in poly.vertices: k[v] = shade[poly.index]
    for i, c in enumerate(col):
        a = (0.3 + 0.7 * c.color[0]) * k[i]
        c.color = (a, a, a, 1)
    print('baked', o.name, len(o.data.polygons), flush=True)
for o in parts:
    o.hide_render = False
    o.data.materials.clear()
    mm = bpy.data.materials.new(o.name)
    mm.use_nodes = True
    o.data.materials.append(mm)
    # box-projected uvs for the weave: 1 unit = 6 cm
    uvl = o.data.uv_layers.new(name='uv')
    for poly in o.data.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            c = o.data.vertices[o.data.loops[li].vertex_index].co
            a, b = [(c.y, c.z), (c.x, c.z), (c.x, c.y)][ax]
            uvl.data[li].uv = (a / 0.06, b / 0.06)
bpy.data.objects.remove(stand)
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=False, export_animations=False, export_cameras=False, export_lights=False, export_yup=True, export_tangents=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False)
print('tris', sum(len(p.vertices) - 2 for o in parts for p in o.data.polygons))
