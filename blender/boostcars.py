# Boostball's six car bodies, modelled hard-surface: a body extruded from its side profile with
# crowned panels and a tapered nose and tail, fender pods unioned on and the wheel arches cut out,
# a glass greenhouse with painted roof and pillars, then the carbon (splitter, diffuser, skirts,
# intakes), the lights and grille, and each car's own piece (wing, scoop, ducktail, fins, truck bed).
# Original designs, one per hitbox class; wheels, nozzles and the hitbox fit stay in the game's rig.
# Car frame = the game's: x forward, y left, z up, centimetres (uu).
#   blender -b --python blender/boostcars.py  ->  public/boost/cars.glb
import os, math
import bpy, bmesh
from mathutils import Vector, Matrix

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'boost', 'cars.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
MATS = {}
for name in ('paint', 'glass', 'carbon', 'accent', 'grille', 'head', 'tail'):
    MATS[name] = bpy.data.materials.new(name)


def sm(a, b, x):
    if abs(b - a) < 1e-6:
        return 1.0 if x >= b else 0.0
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def link(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    SC.collection.objects.link(o)
    me.materials.append(MATS[mat])
    o['mat'] = mat
    return o


def hull(name, pts, mat):
    bm = bmesh.new()
    vs = [bm.verts.new(Vector(p)) for p in pts]
    bmesh.ops.convex_hull(bm, input=vs)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return link(name, bm, mat)


def box(name, x0, x1, y0, y1, z0, z1, mat, bev=0.8):
    o = hull(name, [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)], mat)
    if bev:
        bevel(o, bev, 2, 50)
    return o


def tube(name, a, b, r, mat, seg=10):
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
    rot = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=bm.verts)
    return link(name, bm, mat)


def cyl_y(name, x, z, r, y0, y1, mat='paint', seg=56):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=abs(y1 - y0))
    bmesh.ops.transform(bm, matrix=Matrix.Translation((x, (y0 + y1) / 2, z)) @ Matrix.Rotation(math.pi / 2, 4, 'X'), verts=bm.verts)
    return link(name, bm, mat)


def bevel(o, w, seg=3, angle=35):
    m = o.modifiers.new('bev', 'BEVEL')
    m.width = w
    m.segments = seg
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.use_clamp_overlap = True


def boolean(o, cutter, op):
    m = o.modifiers.new('b', 'BOOLEAN')
    m.object = cutter
    m.operation = op
    m.solver = 'EXACT'
    apply(o)
    bpy.data.objects.remove(cutter)


def apply(o):
    for m in list(o.modifiers):
        with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
            bpy.ops.object.modifier_apply(modifier=m.name)


def interp(poly, x):
    """z on a polyline of (x, z) sorted by x"""
    if x <= poly[0][0]:
        return poly[0][1]
    for (x0, z0), (x1, z1) in zip(poly, poly[1:]):
        if x0 <= x <= x1:
            return z0 + (z1 - z0) * (x - x0) / max(1e-6, x1 - x0)
    return poly[-1][1]


def build(k, c):
    W, zb = c['W'], c['zb']
    top = c['top']                      # (x, z) from the tail to the nose, along the top
    x0, x1 = top[0][0], top[-1][0]
    nose = c.get('nose', 0.15)
    tail = c.get('tail', 0.06)
    crown = c.get('crown', 3.0) * 1.8

    def plan(x):
        return 1 - nose * sm(x1 - c.get('noseLen', 26), x1, x) ** 1.4 - tail * sm(x0 + 16, x0, x)

    g1x = c['cab'][1]

    def crx(x):
        # crowned over the cabin and tail; over the hood the sides rise into fender peaks
        return crown * (1 - c.get('peak', 1.6) * sm(g1x - 4, g1x + 14, x))

    def topz(x, y=0.0):
        return interp(top, x) - crx(x) * (y / W) ** 2

    # ---- the body: the side profile (top line, a rounded front face, flat floor) extruded across
    front = c.get('front', [(x1 + 0.3, top[-1][1] - 4), (x1 + 0.2, zb + 6), (x1 - 5, zb)])
    rear = [(x0 + 5, zb), (x0 - 0.3, zb + 5)]
    prof = []
    for (a, b) in zip(top, top[1:]):
        n = max(1, int(math.dist(a, b) / 3.0))
        for i in range(n):
            t = i / n
            prof.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    prof.append(top[-1])
    prof += front
    # the floor, in steps so the plan taper bends it too
    fx0, fx1 = front[-1][0], rear[0][0]
    n = max(1, int((fx0 - fx1) / 6))
    prof += [(fx0 + (fx1 - fx0) * i / n, zb) for i in range(1, n)]
    prof += rear
    ys = [W * (-1 + 2 * i / 16) for i in range(17)]
    bm = bmesh.new()
    rings = []
    for y in ys:
        t = abs(y) / W
        ring = []
        for (x, z) in prof:
            ztop = interp(top, x)
            k_up = sm(zb + 0.45 * (ztop - zb), ztop, z)
            zz = z - crx(x) * t * t * k_up
            # sides: a little tumblehome up top, tucked under at the sill
            side = (0.92 + 0.08 * sm(zb, zb + 8, z)) * (1 - 0.09 * sm(c['belt'] - 10, ztop + 1, z) ** 1.5)
            ring.append(bm.verts.new((x, y * plan(x) * side, zz)))
        rings.append(ring)
    P = len(prof)
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(P):
            j = (i + 1) % P
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    body = link(f'b{k}_body', bm, 'paint')

    # ---- fender pods over each wheel, unioned on
    for (wx, wr, wz, tr, ww), lift in ((c['wf'], c.get('podF', 1.5)), (c['wr'], c.get('podR', 3.5))):
        zt = wz + wr + lift
        for s in (1, -1):
            yo, yi = s * W * 0.995, s * (W - c.get('podIn', 19))
            pts = []
            for (dx, z, yin, yout) in ((wr + 12, zb + 3, yi, yo), (wr + 6, zt, yi - s * 4, yo - s * 4)):
                for x in (wx - dx, wx + dx):
                    pts += [(x, yin, z), (x, yout, z)]
            pod = hull(f'b{k}_pod', pts, 'paint')
            bevel(pod, 6.5, 5, 25)
            apply(pod)
            boolean(body, pod, 'UNION')
    # ---- the wheel arches
    for (wx, wr, wz, tr, ww) in (c['wf'], c['wr']):
        for s in (1, -1):
            yin = tr - ww / 2 - 3.5
            cut = cyl_y(f'b{k}_arch', wx, wz, wr + 3.4, s * yin, s * (W + 8))
            boolean(body, cut, 'DIFFERENCE')
    # truck bed / anything else carved out of the body
    for cb in c.get('carve', []):
        cut = box(f'b{k}_carve', *cb, 'paint', bev=0)
        boolean(body, cut, 'DIFFERENCE')
    bevel(body, 2.2, 4, 28)
    apply(body)

    objs = [body]
    add = objs.append

    # arch lips: a flared rim round each opening
    for (wx, wr, wz, tr, ww) in (c['wf'], c['wr']):
        for s in (1, -1):
            bm = bmesh.new()
            R0 = wr + 3.4
            seg = 28
            ring = []
            for i in range(seg + 1):
                a = math.radians(-8 + 196 * i / seg)
                ring.append((wx + math.cos(a) * R0, wz + math.sin(a) * R0))
            # a lip: 4 corners of a small section swept along the arch
            prev = None
            sec = [(0, 0), (1.6, 0.4), (2.0, 2.4), (0, 2.6)]   # (outward, radial)
            vs_all = []
            for (ax, az) in ring:
                d = Vector((ax - wx, 0, az - wz)).normalized()
                yb = s * (W * plan(ax) * 0.995 - 0.6)
                vs = [bm.verts.new((ax + d.x * rad, yb + s * o, az + d.z * rad)) for (o, rad) in sec]
                vs_all.append(vs)
            for va, vb in zip(vs_all, vs_all[1:]):
                for i in range(4):
                    j = (i + 1) % 4
                    bm.faces.new((va[i], va[j], vb[j], vb[i]))
            bm.faces.new(vs_all[0]); bm.faces.new(list(reversed(vs_all[-1])))
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            lip = link(f'b{k}_lip', bm, c.get('lipMat', 'carbon'))
            add(lip)

    # ---- the greenhouse
    g0, g1, r0, r1 = c['cab']
    Wc, Wr = c['Wc'], c['Wr']
    zB, zR = c['belt'], c['roof']
    gl = hull(f'b{k}_glass', [(x, s * w, z) for (x, w, z) in ((g0, Wc, zB - 2.5), (g1, Wc, zB - 2.5), (r0, Wr, zR - 1.6), (r1, Wr, zR - 1.6)) for s in (1, -1)], 'glass')
    bevel(gl, 4.0, 4, 22)
    add(gl)
    roof = hull(f'b{k}_roof', [(x, s * w, z) for (x, w) in ((r0 - 1.5, Wr + 0.7), (r1 + 1.2, Wr + 0.7)) for z in (zR - 2.2, zR + 0.5) for s in (1, -1)], 'paint')
    bevel(roof, 1.0, 2, 30)
    add(roof)
    for s in (1, -1):
        # A pillars
        add(tube(f'b{k}_apil', (g1 - 1, s * (Wc + 0.2), zB - 1), (r1 + 0.5, s * (Wr + 0.4), zR - 1.2), 1.5, 'paint', 8))
        # C pillars: a solid sail panel
        cp = hull(f'b{k}_cpil', [p for (x, w, z) in ((g0 - 0.3, Wc + 0.6, zB - 1.5), (g0 + c.get('cw', 10), Wc + 0.6, zB - 1.5), (r0 - 0.5, Wr + 0.7, zR - 1.6), (r0 + c.get('cw', 10) * 0.5, Wr + 0.7, zR - 1.6))
                                     for p in ((x, s * w, z), (x, s * (w - 2.2), z))], 'paint')
        bevel(cp, 0.6, 2, 40)
        add(cp)
        # B pillar
        bx = (g0 + g1) / 2 + c.get('bx', 0)
        t = (bx - g0) / (g1 - g0)
        add(tube(f'b{k}_bpil', (bx, s * (Wc + 0.3), zB - 1), (bx + (r0 + (r1 - r0) * t - bx) * 0.2, s * (Wr + 0.4), zR - 1.5), 1.1, 'carbon', 6))
        # mirrors
        mx, my, mz = g1 - 2, s * (Wc + 3.6), zB + 4
        mir = hull(f'b{k}_mirror', [(mx + dx, my + dy, mz + dz) for dx in (-3, 2) for dy in (-2.4, 2.4) for dz in (-1.6, 1.8)], 'paint')
        bevel(mir, 0.8, 2, 40)
        add(mir)
        add(tube(f'b{k}_mstalk', (mx, s * (Wc - 0.5), mz - 0.5), (mx, my, mz), 0.5, 'carbon', 6))

    # ---- front
    fz = top[-1][1]
    wN = W * plan(x1 - 1)
    sp = box(f'b{k}_splitter', x1 - 16, x1 + 2.5, -W * plan(x1 - 8) + 1, W * plan(x1 - 8) - 1, zb - 1.4, zb + 0.4, 'carbon', 0.5)
    add(sp)
    gz0, gz1 = zb + c.get('grilleLo', 3.5), fz - c.get('grilleTop', 3.5)
    if gz1 > gz0 + 2:
        add(box(f'b{k}_grille', x1 - 2.5, x1 + 0.8, -wN * c.get('grilleW', 0.55), wN * c.get('grilleW', 0.55), gz0, gz1, 'grille', 0.6))
    for s in (1, -1):
        # headlight clusters wrapping the nose corners
        hx = x1 - c.get('headBack', 3)
        hy0, hy1 = wN * 0.58, W * plan(hx - 8) - 2.5
        hz = topz(hx, hy1) - c.get('headDrop', 3.5)
        hl = hull(f'b{k}_head', [(hx + 2.5, s * hy0, hz), (hx + 2.5, s * hy0, hz - 3.2), (hx - 9, s * hy1, hz + 0.6), (hx - 9, s * hy1, hz - 2.6),
                                 (hx + 0.5, s * hy0, hz), (hx + 0.5, s * hy0, hz - 3.2), (hx - 9, s * (hy1 - 2), hz + 0.6), (hx - 9, s * (hy1 - 2), hz - 2.6)], 'head')
        add(hl)
        # brake-cooling ducts low in the bumper
        add(box(f'b{k}_duct', x1 - 4, x1 + 0.5, s * wN * 0.62, s * (W * plan(x1 - 4) - 3), zb + 2, zb + 6.5, 'carbon', 0.5))
    # hood vents
    if c.get('vents', True):
        for s in (1, -1):
            vx = (g1 + x1) / 2 - 2
            for i in range(3):
                x = vx + i * 3.2 - 3
                z = topz(x, 11) + 0.1
                add(box(f'b{k}_vent', x - 1, x + 1, s * 7, s * 15, z - 0.8, z + 0.5, 'carbon', 0.3))

    # ---- rear
    dz = interp(top, x0 + 6)
    wT = W * plan(x0 + 1)
    diff = box(f'b{k}_diffuser', x0 - 1.8, x0 + 14, -wT + 4, wT - 4, zb - 1.2, zb + 4.5, 'carbon', 0.5)
    add(diff)
    for i in range(5):
        y = -wT * 0.55 + i * wT * 0.275
        add(box(f'b{k}_fin', x0 - 2.5, x0 + 10, y - 0.4, y + 0.4, zb - 1, zb + 6, 'carbon', 0.2))
    tz = dz - c.get('tailDrop', 4.5)
    add(box(f'b{k}_tailbar', x0 - 0.9, x0 + 1.2, -wT * 0.86, wT * 0.86, tz - 1.8, tz, 'tail', 0.4))
    for s in (1, -1):
        add(box(f'b{k}_tailcap', x0 - 0.9, x0 + 2.5, s * wT * 0.62, s * (wT - 1.2), tz - 4.5, tz + 0.4, 'tail', 0.6))
    for (jx, jy, jz) in c['jets']:
        add(box(f'b{k}_exh', x0 - 2.2, x0 + 3, jy - 6.5, jy + 6.5, jz - 6, jz + 6, 'carbon', 1.6))

    # ---- sides: skirts and an intake ahead of the rear wheel
    xs0 = c['wr'][0] + c['wr'][1] + 4.5
    xs1 = c['wf'][0] - c['wf'][1] - 4.5
    for s in (1, -1):
        add(box(f'b{k}_skirt', xs0, xs1, s * (W * 0.93 - 1.5), s * (W * 0.93 + 1.4), zb - 0.5, zb + 3.5, 'carbon', 0.6))
        ix = xs0 + 2
        add(box(f'b{k}_intake', ix, ix + c.get('intakeLen', 12), s * (W * 0.965 - 2), s * (W * 0.965 + 0.6), zb + 8, min(zB - 4, zb + 8 + c.get('intakeH', 7)), 'carbon', 0.8))

    # ---- each car's own piece
    if 'wing' in c:
        wx0, wx1, wz, span = c['wing']
        add(box(f'b{k}_wing', wx0, wx1, -span, span, wz, wz + 1.6, 'accent', 0.6))
        add(box(f'b{k}_wingflap', wx0 - 0.5, wx0 + 3, -span, span, wz + 1.2, wz + 3.6, 'accent', 0.4))
        for s in (1, -1):
            add(box(f'b{k}_plate', wx0 - 1.5, wx1 + 1, s * (span - 0.4), s * (span + 0.8), wz - 3, wz + 5, 'carbon', 0.3))
            sy = s * span * 0.45
            add(tube(f'b{k}_strut', ((wx0 + wx1) / 2, sy, topz((wx0 + wx1) / 2 + 2, sy) - 1), ((wx0 + wx1) / 2 - 1, sy, wz), 0.9, 'carbon', 6))
    if 'duck' in c:
        x, z = c['duck']
        add(hull(f'b{k}_duck', [(xx, s * W * plan(xx) * 0.9, zz) for (xx, zz) in ((x, z), (x + 9, z - 2.5), (x, z - 2), (x + 9, z - 4)) for s in (1, -1)], 'accent'))
    if 'scoop' in c:
        sx0, sx1, h = c['scoop']
        zs = topz((sx0 + sx1) / 2)
        sc = hull(f'b{k}_scoop', [p for s in (1, -1) for p in ((sx0, s * 9, zs - 1), (sx1, s * 7, zs - 1), (sx0 + 1, s * 8, zs + h), (sx1 - 5, s * 6, zs + 0.5))], 'paint')
        bevel(sc, 1.0, 2, 30)
        add(sc)
        add(box(f'b{k}_scoopmouth', sx0 - 0.6, sx0 + 1.2, -7.5, 7.5, zs + 0.5, zs + h - 0.8, 'grille', 0.3))
    if 'fins' in c:
        fx0, fx1, fzt = c['fins']
        for s in (1, -1):
            y = s * (W * plan(fx0) - 7)
            add(hull(f'b{k}_fin', [(fx0, y - 0.6, topz(fx0, y) - 1), (fx0, y + 0.6, topz(fx0, y) - 1), (fx1, y - 0.6, topz(fx1, y) - 1), (fx1, y + 0.6, topz(fx1, y) - 1),
                                   (fx0 + 1, y - 0.5, fzt), (fx0 + 1, y + 0.5, fzt), (fx0 + 6, y - 0.4, fzt - 1)], 'accent'))
    if c.get('truck'):
        # roll bar over the bed, a light bar on the roof, a push bar on the nose
        rb = c['rollbar']
        for s in (1, -1):
            add(tube(f'b{k}_rb', (rb, s * (Wc - 2), zB - 2), (rb + 3, s * (Wc - 4), zR - 2), 1.6, 'carbon', 10))
            add(tube(f'b{k}_rbd', (rb + 3, s * (Wc - 4), zR - 2), (rb - 18, s * (Wc - 4), zB - 1), 1.2, 'carbon', 8))
        add(tube(f'b{k}_rbt', (rb + 3, Wc - 4, zR - 2), (rb + 3, -(Wc - 4), zR - 2), 1.6, 'carbon', 10))
        add(box(f'b{k}_lightbar', r1 - 5, r1 - 1, -Wr * 0.75, Wr * 0.75, zR + 0.4, zR + 2.4, 'head', 0.4))
        add(box(f'b{k}_lightbarhouse', r1 - 6, r1 - 0.5, -Wr * 0.78, Wr * 0.78, zR + 0.1, zR + 0.8, 'carbon', 0.2))
        for s in (1, -1):
            add(tube(f'b{k}_bb', (x1 + 3.5, s * W * 0.55, zb + 2), (x1 + 3.5, s * W * 0.55, fz + 1), 1.6, 'carbon', 10))
            add(tube(f'b{k}_bbs', (x1 + 3.5, s * W * 0.55, fz + 1), (x1 - 2, s * W * 0.55, fz + 1), 1.4, 'carbon', 8))
        add(tube(f'b{k}_bbt', (x1 + 3.5, W * 0.55, fz + 1), (x1 + 3.5, -W * 0.55, fz + 1), 1.6, 'carbon', 10))
        add(tube(f'b{k}_bbm', (x1 + 3.5, W * 0.55, zb + 7), (x1 + 3.5, -W * 0.55, zb + 7), 1.4, 'carbon', 10))

    # ---- join by material, smooth by angle, name b<k>_<mat>
    groups = {}
    for o in objs:
        apply(o)
        groups.setdefault(o['mat'], []).append(o)
    out = []
    for mat, os_ in groups.items():
        with bpy.context.temp_override(active_object=os_[0], selected_objects=os_, selected_editable_objects=os_):
            bpy.ops.object.join()
        o = os_[0]
        o.name = f'b{k}_{mat}'
        o.data.name = o.name
        with bpy.context.temp_override(active_object=o, selected_objects=[o], selected_editable_objects=[o], object=o):
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(34))
        apply(o)
        out.append(o)
        print('car', k, mat, len(o.data.polygons))
    return out


CARS = [
    # 0 Striker: tall all-rounder, big haunches, a wing on struts
    dict(W=44.0, zb=-8.5, belt=19, roof=44.6, cab=(-40, 34, -25, 8), Wc=37.5, Wr=31,
         top=[(-48.3, 9), (-46, 14), (-40, 17), (-28, 18.5), (30, 17.5), (40, 14.5), (60, 10.5), (70, 7.5), (75, 3)],
         wf=(51.3, 14.5, -2.5, 33.5, 12.5), wr=(-33.8, 17.5, 0.5, 34.5, 15.5), jets=[(-48.1, 12, 13), (-48.1, -12, 13)],
         wing=(-47, -38, 31, 40), crown=3.5, nose=0.16),
    # 1 Mako: long low muscle coupe, hood scoop, ducktail
    dict(W=43.3, zb=-9.5, belt=14.5, roof=32.8, cab=(-47, 16, -27, -3), Wc=37, Wr=30, cw=14,
         top=[(-55.2, 4), (-53, 10), (-47, 13), (-38, 14.5), (16, 14), (30, 12), (58, 8.5), (70, 5), (75, 0.5)],
         wf=(50.3, 14, -3.1, 35, 12.5), wr=(-34.8, 15.5, -1.6, 36, 15), jets=[(-55.2, 12, 9.9), (-55.2, -12, 9.9)],
         scoop=(26, 44, 4.5), duck=(-55, 14.5), crown=2.5, nose=0.1, podF=6, podR=7.5),
    # 2 Stingray: flat wedge, towering rear haunches, low wide wing
    dict(W=44.9, zb=-11.5, belt=10, roof=26.4, cab=(-40, 16, -24, -3), Wc=36, Wr=28,
         top=[(-58.6, 1.5), (-56, 7.5), (-48, 9.5), (-40, 10), (16, 9.5), (34, 7), (58, 3), (70, 0), (75.6, -3)],
         front=[(75.9, -6), (75, -9.5), (69, -11.5)], wf=(50, 14.5, -4.2, 36, 12), wr=(-35.4, 19, 0.3, 37, 18),
         jets=[(-58.8, 12, 5.3), (-58.8, -12, 5.3)], wing=(-58, -50, 19, 43), crown=2, nose=0.22, podR=6, podIn=15,
         grilleTop=4, headDrop=2.5),
    # 3 Viper: long pointed nose, narrow, tall wing
    dict(W=41.4, zb=-11, belt=11.5, roof=28.4, cab=(-37, 34, -18, 10), Wc=33, Wr=26,
         top=[(-56.4, 3), (-54, 9), (-46, 11.5), (-37, 12), (33, 11.5), (45, 9), (64, 4.5), (75, 1), (80.4, -2.5)],
         front=[(80.6, -5.5), (79, -9), (72, -11)], wf=(51.5, 15.5, -2.9, 33, 12.5), wr=(-35.8, 17, -1.4, 34, 15),
         jets=[(-56.6, 11, 7.6), (-56.6, -11, 7.6)], wing=(-55.5, -46.5, 25, 37), crown=2.5, nose=0.34, noseLen=34,
         grilleTop=4, grilleW=0.45),
    # 4 Comet: sleek fastback, twin tail fins
    dict(W=42.7, zb=-8.5, belt=18, roof=40, cab=(-45, 32, -14, 10), Wc=36, Wr=29, cw=6,
         top=[(-52.8, 8), (-50, 14), (-45, 17), (-30, 18), (32, 17.5), (44, 14), (64, 8.5), (75, 4), (79.5, 0)],
         wf=(51.3, 14.5, -2.5, 33, 12.5), wr=(-34, 17, 0, 34, 15), jets=[(-52.7, 12, 12), (-52.7, -12, 12)],
         fins=(-51, -38, 31), crown=3, nose=0.24, noseLen=30),
    # 5 Bulldog: tall pickup, bed, roll bar, light bar, push bar
    dict(W=40.7, zb=-6, belt=26, roof=46, cab=(-12, 28, -9, 13), Wc=37, Wr=34.5, cw=4, truck=True, rollbar=-15,
         top=[(-52.1, 23.5), (-50, 26), (-14, 26.5), (28, 26.5), (36, 22.5), (62, 20.5), (70, 18.5), (73.8, 14)],
         front=[(74.1, 8), (73.6, -3), (68, -6)], wf=(51.3, 17, -1.8, 32, 14), wr=(-33.8, 17, -1.8, 32, 15),
         jets=[(-52.3, 12, 10.2), (-52.3, -12, 10.2)], carve=[(-49.5, -16, -35.5, 35.5, 13, 32)],
         crown=1.2, nose=0.05, tail=0.02, podF=8, podR=8, podIn=10, vents=False, grilleTop=7, grilleW=0.62, headDrop=4.5,
         lipMat='carbon', tailDrop=6, intakeH=5),
]

allobjs = []
for k, c in enumerate(CARS):
    allobjs += build(k, c)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
for o in allobjs:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format='GLB', export_yup=False, export_apply=True,
                          export_materials='NONE', export_texcoords=False, export_normals=True)
print('wrote', OUT, os.path.getsize(OUT))
