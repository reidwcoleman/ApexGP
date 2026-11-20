"""Blender: the bench the kit is made at. Where ward_kit.py had rods and boxes, this has what a thing is really made of:

  pipe      round tube along a path, bent round its corners the way a tube bender leaves it
  soft      something padded: a rounded slab with a crown, a sag, tufts, creases (mattresses, pillows, seats, bags)
  drape     cloth, by Blender's own cloth solver: dropped over whatever is under it, or hung from a rail
  plate     sheet metal or board: a flat outline with thickness, its corners rounded
  wheel     a castor in its fork
  panel     a box with its arrises rounded by a real bevel
  finish    every hard edge of a finished piece bevelled and its normals weighted, so edges catch the light instead of
            cutting it; applied to the whole kit

All of it adds to a cove_kit.B builder, so a piece is still `def thing(b, rng)`.
"""
import math, random
import bpy, bmesh
from mathutils import Vector, Matrix, Quaternion, noise


def _frame(z):
    x = z.cross(Vector((0, 0, 1))) if abs(z.z) < 0.95 else z.cross(Vector((1, 0, 0)))
    x.normalize()
    return x, z.cross(x)


def fillet(pts, bend, seg=5, closed=False):
    """a path with its corners rounded to radius `bend`"""
    P = [Vector(p) for p in pts]
    n = len(P)
    out = []
    rng_ = range(n) if closed else range(1, n - 1)
    if not closed: out.append(P[0])
    for i in rng_:
        a, c, d = P[(i - 1) % n], P[i], P[(i + 1) % n]
        u, v = a - c, d - c
        lu, lv = u.length, v.length
        if lu < 1e-6 or lv < 1e-6: continue
        u /= lu; v /= lv
        ang = u.angle(v)
        if ang > math.pi - 0.04 or bend <= 0:
            out.append(c); continue
        t = min(bend / math.tan(ang / 2), lu * 0.48, lv * 0.48)
        rr = t * math.tan(ang / 2)
        ctr = c + (u + v).normalized() * (rr / math.sin(ang / 2))
        s, e = c + u * t - ctr, c + v * t - ctr
        k = max(2, int(round(seg * (math.pi - ang) / (math.pi / 2))))
        axis = s.cross(e)
        if axis.length < 1e-9:
            out.append(c); continue
        axis.normalize()
        sweep_ = s.angle(e)
        for j in range(k + 1):
            out.append(ctr + Quaternion(axis, sweep_ * j / k) @ s)
    if not closed: out.append(P[-1])
    return out


def pipe(b, pts, r, m, n=10, bend=0.05, seg=5, caps=True, closed=False, r1=None):
    """round tube along the path pts, bent round its corners. r1: the radius it tapers to at the far end"""
    i = b.idx(m)
    line = fillet(pts, bend, seg, closed)
    if len(line) < 2: return
    L = len(line)
    tang = []
    for k in range(L):
        a = line[(k - 1) % L] if (closed or k > 0) else line[k]
        c = line[(k + 1) % L] if (closed or k < L - 1) else line[k]
        t = c - a
        tang.append(t.normalized() if t.length > 1e-9 else Vector((0, 0, 1)))
    x, y = _frame(tang[0])
    rings = []
    prev = tang[0]
    for k in range(L):
        q = prev.rotation_difference(tang[k])
        x = q @ x; y = q @ y
        prev = tang[k]
        rr = r if r1 is None else r + (r1 - r) * k / (L - 1)
        rings.append([b.bm.verts.new(line[k] + x * (rr * math.cos(j * 2 * math.pi / n)) + y * (rr * math.sin(j * 2 * math.pi / n))) for j in range(n)])
    for k in range(L - 1 if not closed else L):
        a0, a1 = rings[k], rings[(k + 1) % L]
        for j in range(n):
            f = b.bm.faces.new((a0[j], a0[(j + 1) % n], a1[(j + 1) % n], a1[j]))
            f.material_index = i; f.smooth = True
    if caps and not closed:
        b.bm.faces.new(list(reversed(rings[0]))).material_index = i
        b.bm.faces.new(rings[-1]).material_index = i


def turned(b, c, prof, m, n=12, axis=(0, 0, 1), cap0=True, cap1=True):
    """something turned on a lathe about any axis: prof is (along, radius)"""
    i = b.idx(m)
    z = Vector(axis).normalized()
    x, y = _frame(z)
    C = Vector(c)
    rings = [[b.bm.verts.new(C + z * h + x * (r * math.cos(j * 2 * math.pi / n)) + y * (r * math.sin(j * 2 * math.pi / n))) for j in range(n)] for h, r in prof]
    for a0, a1 in zip(rings, rings[1:]):
        for j in range(n):
            f = b.bm.faces.new((a0[j], a0[(j + 1) % n], a1[(j + 1) % n], a1[j]))
            f.material_index = i; f.smooth = True
    if cap0: b.bm.faces.new(list(reversed(rings[0]))).material_index = i
    if cap1: b.bm.faces.new(rings[-1]).material_index = i


def _xf(c, yaw, tilt):
    return Matrix.Translation(Vector(c)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(tilt[0], 4, 'X') @ Matrix.Rotation(tilt[1], 4, 'Y')


def soft(b, c, size, m, r=0.04, yaw=0.0, tilt=(0.0, 0.0), res=0.06, crown=0.0, sag=0.0, tuft=None, lumps=0.0, seed=0, pinch=0.0, shape=None):
    """A padded thing. A slab of `size` centred on c with every edge rounded to r, cut into a grid about `res` across:
    crown lifts the middle of the top, sag drops it, tuft=(nx, ny, depth) buttons it down, lumps is how uneven it lies,
    pinch draws the corners in like a pillow's. shape(p) -> p moves every point last (to fold it, hang it, bend it)."""
    i = b.idx(m)
    sx, sy, sz = (v / 2 for v in size)
    r = min(r, sx, sy, sz)
    nx, ny, nz = (max(2, int(round(2 * s / res))) for s in (sx, sy, sz))
    M = _xf(c, yaw, tilt)
    cache = {}

    def vert(p):
        key = (round(p[0], 5), round(p[1], 5), round(p[2], 5))
        v = cache.get(key)
        if v is not None: return v
        q = Vector(p)
        # the rounded slab: pull the point onto a box r smaller, then push it r out again
        inner = Vector((max(-sx + r, min(sx - r, q.x)), max(-sy + r, min(sy - r, q.y)), max(-sz + r, min(sz - r, q.z))))
        d = q - inner
        if d.length > 1e-9: q = inner + d.normalized() * r
        fx, fy = q.x / sx, q.y / sy
        top = max(0.0, q.z / sz)
        dome = (1 - fx * fx) * (1 - fy * fy)
        q.z += top * (crown - sag) * dome
        if pinch:
            k = pinch * (abs(fx) * abs(fy)) ** 1.5
            q.z *= 1 - k * 0.85
            q.x *= 1 - k * 0.12; q.y *= 1 - k * 0.12
        if tuft and top > 0.5:
            tx, ty, td = tuft
            for a in range(tx):
                for e in range(ty):
                    px, py = -sx + (a + 0.5) * 2 * sx / tx, -sy + (e + 0.5) * 2 * sy / ty
                    g = math.exp(-((q.x - px) ** 2 + (q.y - py) ** 2) / (2 * 0.035 ** 2))
                    q.z -= td * g
        if lumps:
            nn = noise.noise(Vector((q.x * 2.3 + seed * 3.1, q.y * 2.3 - seed, q.z * 2.3 + seed * 0.7)))
            n2 = noise.noise(Vector((q.x * 7.0 - seed, q.y * 7.0 + seed * 2, q.z * 7.0)))
            q += (q - inner * 0.999).normalized() * (lumps * (nn + 0.4 * n2)) if (q - inner * 0.999).length > 1e-6 else Vector()
        if shape: q = Vector(shape(q))
        v = cache[key] = b.bm.verts.new(M @ q)
        return v

    def face(pa, pb, pc, pd):
        vs = [vert(pa), vert(pb), vert(pc), vert(pd)]
        if len({id(v) for v in vs}) < 3: return
        seen, uniq = set(), []
        for v in vs:
            if id(v) not in seen: seen.add(id(v)); uniq.append(v)
        try:
            f = b.bm.faces.new(uniq)
        except ValueError:
            return
        f.material_index = i; f.smooth = True
    gx = [-sx + 2 * sx * k / nx for k in range(nx + 1)]
    gy = [-sy + 2 * sy * k / ny for k in range(ny + 1)]
    gz = [-sz + 2 * sz * k / nz for k in range(nz + 1)]
    for a in range(nx):
        for e in range(ny):
            face((gx[a], gy[e], sz), (gx[a + 1], gy[e], sz), (gx[a + 1], gy[e + 1], sz), (gx[a], gy[e + 1], sz))
            face((gx[a], gy[e + 1], -sz), (gx[a + 1], gy[e + 1], -sz), (gx[a + 1], gy[e], -sz), (gx[a], gy[e], -sz))
    for a in range(nx):
        for e in range(nz):
            face((gx[a], -sy, gz[e]), (gx[a + 1], -sy, gz[e]), (gx[a + 1], -sy, gz[e + 1]), (gx[a], -sy, gz[e + 1]))
            face((gx[a + 1], sy, gz[e]), (gx[a], sy, gz[e]), (gx[a], sy, gz[e + 1]), (gx[a + 1], sy, gz[e + 1]))
    for a in range(ny):
        for e in range(nz):
            face((sx, gy[a], gz[e]), (sx, gy[a + 1], gz[e]), (sx, gy[a + 1], gz[e + 1]), (sx, gy[a], gz[e + 1]))
            face((-sx, gy[a + 1], gz[e]), (-sx, gy[a], gz[e]), (-sx, gy[a], gz[e + 1]), (-sx, gy[a + 1], gz[e + 1]))


def panel(b, c, size, m, r=0.006, yaw=0.0, tilt=(0.0, 0.0), seg=2, top=(1.0, 1.0)):
    """a box whose arrises are really rounded (a bevel of its own, whatever the finish pass does)"""
    i = b.idx(m)
    t = bmesh.new()
    bmesh.ops.create_cube(t, size=1.0)
    for v in t.verts:
        k = (v.co.z + 0.5)
        v.co.x *= size[0] * (1 + (top[0] - 1) * k); v.co.y *= size[1] * (1 + (top[1] - 1) * k); v.co.z *= size[2]
    rr = min(r, min(size) * 0.45)
    if rr > 1e-4:
        bmesh.ops.bevel(t, geom=list(t.edges), offset=rr, segments=seg, profile=0.5, affect='EDGES', clamp_overlap=True)
    M = _xf(c, yaw, tilt)
    vm = {v: b.bm.verts.new(M @ v.co) for v in t.verts}
    for f in t.faces:
        nf = b.bm.faces.new([vm[v] for v in f.verts])
        nf.material_index = i
        nf.smooth = True
    t.free()


def plate(b, outline, thick, m, origin=(0, 0, 0), x=(1, 0, 0), y=(0, 1, 0), bend=0.0, seg=4, holes=()):
    """sheet: a flat outline (2D points) given thickness, standing in the plane of x and y at origin"""
    i = b.idx(m)
    O, X, Y = Vector(origin), Vector(x).normalized(), Vector(y).normalized()
    N = X.cross(Y).normalized()
    pts = [Vector((p[0], p[1], 0)) for p in outline]
    if bend > 0: pts = fillet(pts, bend, seg, closed=True)
    lo = [b.bm.verts.new(O + X * p.x + Y * p.y - N * (thick / 2)) for p in pts]
    hi = [b.bm.verts.new(O + X * p.x + Y * p.y + N * (thick / 2)) for p in pts]
    n = len(pts)
    for k in range(n):
        f = b.bm.faces.new((lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k]))
        f.material_index = i; f.smooth = bend > 0
    b.bm.faces.new(hi).material_index = i
    b.bm.faces.new(list(reversed(lo))).material_index = i


def wheel(b, c, r, m_tyre, m_fork, yaw=0.0, w=0.028, stem=0.06, fork=True):
    """a castor: a tyre on a hub in a pressed fork with a swivel plate; c is where the tyre touches the floor"""
    C = Vector(c)
    ax = Vector((math.cos(yaw), math.sin(yaw), 0))
    hub = C + Vector((0, 0, r))
    rim = r * 0.62
    turned(b, hub - ax * (w / 2), [(0, rim), (0.002, r * 0.94), (w * 0.3, r), (w * 0.7, r), (w - 0.002, r * 0.94), (w, rim)], m_tyre, 14, axis=ax)
    turned(b, hub - ax * (w / 2 + 0.003), [(0, rim * 0.5), (0.003, rim), (w + 0.003, rim), (w + 0.006, rim * 0.5)], m_fork, 10, axis=ax)
    if fork:
        side = Vector((-ax.y, ax.x, 0))
        top = hub + Vector((0, 0, r + 0.012)) + side * (r * 0.35)
        for s in (-1, 1):
            o = ax * (s * (w / 2 + 0.006))
            plate(b, [(-0.012, 0), (0.012, 0), (0.014, r + 0.012), (-0.014, r + 0.012)], 0.003, m_fork, origin=hub + o, x=side, y=(top - hub).normalized())
        turned(b, top + Vector((0, 0, -0.004)), [(0, w / 2 + 0.012), (0.006, w / 2 + 0.012), (0.008, 0.012), (stem, 0.012)], m_fork, 10)


# ------------------------------------------------------------------ cloth, by the cloth solver
def drape(b, m, size, centre, colliders, res=0.05, frames=34, pin=None, seed=0, wind=0.0, mass=0.3, bend=0.06, tear=None, keep=None, rot=0.0, start=None, two=True):
    """A sheet of cloth size (w, l), let go at `centre` over the collider boxes [(c, size, yaw, tilt)], and where it has
    come to rest after `frames`. pin(x, y) -> True holds those points where they start (a curtain's hooks).
    start(x, y) -> (x, y, z) lays the cloth out some other way than flat first. tear(x, y) -> True cuts those faces out
    after. Returns nothing: the cloth is added to b. Units are metres; the floor at z=0 always collides."""
    scene = bpy.context.scene
    made = []

    def link(o):
        scene.collection.objects.link(o); made.append(o); return o
    # what it falls on
    for (cc, sz, yaw, tilt) in list(colliders) + [((0, 0, -0.05), (30, 30, 0.1), 0, (0, 0))]:
        me = bpy.data.meshes.new('col')
        t = bmesh.new(); bmesh.ops.create_cube(t, size=1.0)
        for v in t.verts: v.co = Vector((v.co.x * sz[0], v.co.y * sz[1], v.co.z * sz[2]))
        bmesh.ops.subdivide_edges(t, edges=list(t.edges), cuts=3, use_grid_fill=True)
        t.to_mesh(me); t.free()
        o = link(bpy.data.objects.new('col', me))
        o.matrix_world = _xf(cc, yaw, tilt)
        cm = o.modifiers.new('c', 'COLLISION')
        o.collision.thickness_outer = 0.012; o.collision.thickness_inner = 0.05; o.collision.cloth_friction = 12
    nx, ny = max(2, int(round(size[0] / res))), max(2, int(round(size[1] / res)))
    me = bpy.data.meshes.new('cloth')
    verts, faces, pins = [], [], []
    R = Matrix.Rotation(rot, 3, 'Z')
    for j in range(ny + 1):
        for k in range(nx + 1):
            x, y = -size[0] / 2 + size[0] * k / nx, -size[1] / 2 + size[1] * j / ny
            p = Vector(start(x, y)) if start else Vector((x, y, 0))
            verts.append(Vector(centre) + R @ p)
            if pin and pin(x, y): pins.append(len(verts) - 1)
    for j in range(ny):
        for k in range(nx):
            a = j * (nx + 1) + k
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    me.from_pydata(verts, [], faces)
    co = link(bpy.data.objects.new('cloth', me))
    if pins:
        vg = co.vertex_groups.new(name='pin'); vg.add(pins, 1.0, 'REPLACE')
    cl = co.modifiers.new('cloth', 'CLOTH')
    st = cl.settings
    st.quality = 8; st.mass = mass; st.air_damping = 1.0
    st.tension_stiffness = 10; st.compression_stiffness = 10; st.shear_stiffness = 3; st.bending_stiffness = bend
    st.tension_damping = 6; st.compression_damping = 6; st.bending_damping = 0.6
    if pins: st.vertex_group_mass = 'pin'
    cs = cl.collision_settings
    cs.use_collision = True; cs.distance_min = 0.012; cs.use_self_collision = False; cs.collision_quality = 3; cs.friction = 30
    cl.point_cache.frame_start = 1; cl.point_cache.frame_end = frames + 1
    keep_f = scene.frame_current
    for f in range(1, frames + 2):
        scene.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = co.evaluated_get(dg)
    pts = [ev.matrix_world @ v.co for v in ev.data.vertices]
    i = b.idx(m)
    vs = [b.bm.verts.new(p) for p in pts]
    for j in range(ny):
        for k in range(nx):
            x, y = -size[0] / 2 + size[0] * (k + 0.5) / nx, -size[1] / 2 + size[1] * (j + 0.5) / ny
            if tear and tear(x, y): continue
            a = j * (nx + 1) + k
            f = b.bm.faces.new((vs[a], vs[a + 1], vs[a + nx + 2], vs[a + nx + 1]))
            f.material_index = i; f.smooth = True
    scene.frame_set(keep_f)
    for o in made:
        d = o.data
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(d)


# ------------------------------------------------------------------ the finish
def finish(o, width=0.004, angle=50.0, segs=1, limit=None, weld=False):
    """Every hard edge bevelled, then normals weighted by face area: flats stay flat, edges turn the light.
    limit: don't bevel if the piece would pass this many triangles (it is then only smoothed)."""
    me = o.data
    if not me.polygons: return o
    scene = bpy.context.scene
    linked = o.name in scene.collection.objects
    if not linked: scene.collection.objects.link(o)
    tris0 = sum(len(p.vertices) - 2 for p in me.polygons)
    if weld:
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.0004)
        bm.to_mesh(me); bm.free()
    do_bevel = width > 0 and (limit is None or tris0 * 3.4 < limit)
    if do_bevel:
        bv = o.modifiers.new('bevel', 'BEVEL')
        bv.width = width; bv.segments = segs; bv.limit_method = 'ANGLE'; bv.angle_limit = math.radians(angle)
        bv.harden_normals = False; bv.use_clamp_overlap = True; bv.miter_outer = 'MITER_SHARP'; bv.loop_slide = True
        bv.affect = 'EDGES'
    wn = o.modifiers.new('wn', 'WEIGHTED_NORMAL')
    wn.keep_sharp = True; wn.weight = 60; wn.mode = 'FACE_AREA_WITH_ANGLE'
    # what was flat shades smooth now, with the sharp edges kept where the angle is still hard after the bevel
    for p in me.polygons: p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(46 if do_bevel else 38))
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    me2 = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    o.modifiers.clear()
    old = o.data
    o.data = me2
    me2.name = old.name
    bpy.data.meshes.remove(old)
    if not linked: scene.collection.objects.unlink(o)
    return o


def loft(b, rings, m, closed=True, cap0=False, cap1=False, smooth=True):
    """a skin over a row of rings (each the same number of points)"""
    i = b.idx(m)
    vs = [[b.bm.verts.new(Vector(p)) for p in r] for r in rings]
    n = len(vs[0])
    for a0, a1 in zip(vs, vs[1:]):
        for j in range(n if closed else n - 1):
            try:
                f = b.bm.faces.new((a0[j], a0[(j + 1) % n], a1[(j + 1) % n], a1[j]))
            except ValueError:
                continue
            f.material_index = i; f.smooth = smooth
    if cap0: b.bm.faces.new(list(reversed(vs[0]))).material_index = i
    if cap1: b.bm.faces.new(vs[-1]).material_index = i


def oval(c, a, e, z, n=20, p=2.6, yaw=0.0):
    """a ring of n points: a squared-off oval (p=2 an ellipse, more a rounded rectangle) a by e round c at height z"""
    out = []
    for k in range(n):
        t = k * 2 * math.pi / n
        ct, st = math.cos(t), math.sin(t)
        x = a * (abs(ct) ** (2 / p)) * (1 if ct >= 0 else -1)
        y = e * (abs(st) ** (2 / p)) * (1 if st >= 0 else -1)
        out.append((c[0] + x * math.cos(yaw) - y * math.sin(yaw), c[1] + x * math.sin(yaw) + y * math.cos(yaw), z))
    return out


def sheet(b, m, pts_fn, nu, nv, two=False):
    """a surface from a function of (u, v) in 0..1: for cloth and pressed shapes that are known in advance"""
    i = b.idx(m)
    vs = [[b.bm.verts.new(Vector(pts_fn(k / nu, j / nv))) for k in range(nu + 1)] for j in range(nv + 1)]
    for j in range(nv):
        for k in range(nu):
            f = b.bm.faces.new((vs[j][k], vs[j][k + 1], vs[j + 1][k + 1], vs[j + 1][k]))
            f.material_index = i; f.smooth = True
    if two:
        ws = [[b.bm.verts.new(v.co) for v in row] for row in vs]
        for j in range(nv):
            for k in range(nu):
                f = b.bm.faces.new((ws[j][k], ws[j + 1][k], ws[j + 1][k + 1], ws[j][k + 1]))
                f.material_index = i; f.smooth = True
    return vs
