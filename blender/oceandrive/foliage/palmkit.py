"""Palms, second generation (inside Blender, with lib.MB): coconut, royal, Mexican fan (Washingtonia) and
cabbage (Sabal) palms whose leaves are cards cut from the modelled leaf atlas (foliage/frond_atlas.py).

A coconut frond is a card the shape of the atlas frond, laid along a rachis that leaves the crown at its
own angle and arcs over under its weight; the card is folded into a V along the rachis (the leaflets
hang either side, steeper toward the tip), the outer half folded further (each leaflet droops at its
end), and twisted a little. The crown is arranged by age around the golden angle: a spear of new
leaves standing up in the middle, young ones rising, mature ones arching out, old ones yellowing and
drooping, and a few dead ones hanging against the trunk. Fans are cupped discs on long petioles; the
Washingtonia keeps a skirt of dead fans. Trunks carry their leaf scars (rings in the geometry and the
colour), a swollen foot with a root plate, the coconut's boot and nut clusters, the royal palm's
smooth grey column and glossy green crownshaft, the cabbage palm's criss-crossed leaf bases.

Vertex colour on the leaves is a shade (0..1): darker toward the crown's heart and under the crown
(the runtime multiplies it in; the frond's length runs along the atlas v for the wind)."""
import math, random
from mathutils import Vector, Matrix
from lib import MB, hexcol, WHITE

NCOL = 6
CARD_W, CARD_H, FROND_L = 2.3, 4.6, 4.5
Z = Vector((0, 0, 1))


def shade(k):
    k = max(0.0, min(1.0, k))
    return (k, k, k, 1.0)


def frame(T):
    S = T.cross(Z)
    if S.length < 1e-4:
        S = Vector((1, 0, 0))
    S.normalize()
    N = S.cross(T).normalized()
    return S, N


def frond(mb, base, az, el, L, col, droop, fold0=0.42, fold1=0.95, twist=0.0, ao=1.0, rng=None, segs=14, side_bend=0.0):
    """a coconut frond card. base: where it leaves the crown; az/el: its heading; L its length (m)"""
    hw = CARD_W / 2 * (L / FROND_L)
    h = Vector((math.cos(az), math.sin(az), 0))
    lat = Vector((-h.y, h.x, 0))
    d0 = h * math.cos(el) + Z * math.sin(el)
    pts = []
    for i in range(segs + 1):
        s = i / segs
        p = base + d0 * (L * s) - Z * (droop * L * s * s) + lat * (side_bend * L * s * s)
        pts.append(p)
    u0 = col / NCOL
    du = 1 / NCOL
    rows = []
    for i, p in enumerate(pts):
        s = i / segs
        T = (pts[min(i + 1, segs)] - pts[max(i - 1, 0)]).normalized()
        S, N = frame(T)
        tw = twist * s
        S, N = S * math.cos(tw) + N * math.sin(tw), N * math.cos(tw) - S * math.sin(tw)
        f = fold0 + (fold1 - fold0) * s
        row = []
        for sg in (-1, 1):
            m = p + (S * sg * math.cos(f * 0.8) - N * math.sin(f * 0.8)) * hw * 0.5
            e = m + (S * sg * math.cos(f * 1.3) - N * math.sin(f * 1.3)) * hw * 0.5
            row.append((m, e))
        rows.append((p, row))
    v0, v1 = 0.06 / CARD_H, (0.06 + FROND_L) / CARD_H
    for i in range(segs):
        s0, s1 = i / segs, (i + 1) / segs
        va, vb = v0 + (v1 - v0) * s0, v0 + (v1 - v0) * s1
        c = shade(ao * (0.5 + 0.5 * min(1.0, ((s0 + s1) / 2) / 0.35)))
        (pa, ra), (pb, rb) = rows[i], rows[i + 1]
        for k, sg in enumerate((-1, 1)):
            ma, ea = ra[k]
            mb_, eb = rb[k]
            um, ue = u0 + du * (0.5 + sg * 0.25), u0 + du * (0.5 + sg * 0.5)
            uc = u0 + du * 0.5
            mb.face([pa, pb, mb_, ma], 'od_palmleaf', c, uvs=[(uc, va), (uc, vb), (um, vb), (um, va)])
            mb.face([ma, mb_, eb, ea], 'od_palmleaf', c, uvs=[(um, va), (um, vb), (ue, vb), (ue, va)])


def fan(mb, hast, nrm, up, R, dry, cup=0.28, ao=1.0, n=6):
    """a palmate fan: the atlas fan (top half of the last column green, bottom half dry) on a cupped
    disc around hast, facing nrm"""
    nrm = nrm.normalized()
    ax = up.cross(nrm)
    if ax.length < 1e-4:
        ax = Vector((1, 0, 0))
    ax.normalize()
    ay = nrm.cross(ax).normalized()
    # the texture square is 2.3 m and the fan in it 1.1 m: scale to R
    k = R / 1.1
    vc = 0.25 if dry else 0.75
    u0 = 4 / NCOL
    for i in range(n):
        for j in range(n):
            q = []
            uv = []
            for (a, b) in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                x = (a / n - 0.5) * CARD_W
                y = (b / n - 0.5) * CARD_W
                r2 = (x * x + y * y) / (1.1 * 1.1)
                p = hast + (ax * x + ay * y) * k - nrm * (cup * r2 * R)
                q.append(p)
                uv.append((u0 + (a / n) / NCOL, vc + (b / n - 0.5) * CARD_W / CARD_H))
            mb.face(q, 'od_palmleaf', shade(ao), uvs=uv)


def trunk(mb, spine, radius, height, col, rings=0.1, ring_amp=0.04, seg=None, rad=12, scar_dark=0.8, mat='od_bark'):
    """a trunk along spine(t) (t 0..1), radius(t), leaf-scar rings every `rings` m"""
    seg = seg or max(16, int(height / 0.25))
    prev = None
    for i in range(seg + 1):
        t = i / seg
        p = spine(t)
        q = (spine(min(1, t + 0.01)) - spine(max(0, t - 0.01))).normalized()
        ax = q.orthogonal().normalized()
        ay = q.cross(ax)
        zz = height * t
        ring = math.sin(zz / rings * math.pi * 2)
        r = radius(t) * (1 + ring_amp * max(0, ring))
        cur = [p + (ax * math.cos(2 * math.pi * k / rad) + ay * math.sin(2 * math.pi * k / rad)) * r for k in range(rad + 1)]
        if prev:
            pz = height * (i - 0.5) / seg
            band = 0.5 + 0.5 * math.cos(pz / rings * math.pi * 2)
            c = tuple(col[j] * (scar_dark + (1 - scar_dark) * band) for j in range(3)) + (1.0,)
            for k in range(rad):
                u0, u1 = k / rad, (k + 1) / rad
                mb.face([prev[k], prev[k + 1], cur[k + 1], cur[k]], mat, c,
                        uvs=[(u0, height * (i - 1) / seg), (u1, height * (i - 1) / seg), (u1, zz), (u0, zz)])
        prev = cur


def root_plate(mb, base, r, rng, col):
    """the swollen foot: a flared collar and a mat of surface roots"""
    mb.cyl(tuple(base - Vector((0, 0, 0.15))), r * 1.9, r * 1.15, 0.5, 14, 'od_bark', col)
    for k in range(rng.randint(10, 16)):
        a = 2 * math.pi * k / 14 + rng.uniform(-0.2, 0.2)
        d = Vector((math.cos(a), math.sin(a), -0.35)).normalized()
        mb.cyl(tuple(base + Vector((math.cos(a), math.sin(a), 0)) * r * 0.9 + Vector((0, 0, 0.05))), 0.035, 0.02, rng.uniform(0.25, 0.5), 5, 'od_bark',
               hexcol('#6b5d4c'), caps=False, axis=tuple(d))


def coconut(name, rng, height, lean=None):
    mb = MB(name)
    lean = lean if lean is not None else rng.uniform(0.6, 2.8)
    la = rng.uniform(0, 6.28)
    lv = Vector((math.cos(la), math.sin(la), 0)) * lean
    def spine(t):
        # leans early, curving back up toward the crown (the palm reaching for the light)
        return lv * (1 - (1 - t) ** 2.2) + Z * (height * t)
    bark = (0.52, 0.47, 0.41)
    trunk(mb, spine, lambda t: 0.18 - 0.05 * t + 0.15 * max(0, 1 - t * 10) ** 2 + 0.01 * math.sin(t * 7), height, hexcol('#8f8576'),
          rings=0.09, ring_amp=0.05)
    root_plate(mb, spine(0), 0.22, rng, hexcol('#7d7264'))
    top = spine(1.0)
    # the boot: old leaf bases and fibre wrapped round the top of the trunk
    for k in range(10):
        a = 2 * math.pi * k / 10 + rng.uniform(-0.2, 0.2)
        d = Vector((math.cos(a), math.sin(a), 0))
        p0 = top - Z * 0.55 + d * 0.13
        mb.face([p0 - Z * 0.1 + d.cross(Z) * 0.12, p0 - Z * 0.1 - d.cross(Z) * 0.12, p0 + Z * 0.55 + d * 0.12 - d.cross(Z) * 0.09, p0 + Z * 0.55 + d * 0.12 + d.cross(Z) * 0.09],
                'od_bark', hexcol(rng.choice(['#6e5a40', '#7a6446', '#5e4c36'])))
    mb.cyl(tuple(top - Z * 0.6), 0.17, 0.25, 0.75, 12, 'od_bark', hexcol('#6f6250'))
    crown = top + Z * 0.15
    # nuts: a cluster or two under the leaves
    for cl in range(rng.randint(1, 3)):
        a0 = rng.uniform(0, 6.28)
        for k in range(rng.randint(4, 9)):
            a = a0 + rng.uniform(-0.6, 0.6)
            rr = 0.24 + rng.uniform(0, 0.12)
            c = crown + Vector((math.cos(a) * rr, math.sin(a) * rr, -0.25 - rng.uniform(0, 0.35)))
            col = hexcol(rng.choice(['#6f7d2a', '#7f8a30', '#9a8a36', '#8a6a34', '#5f6e24']))
            nut = 0.11 + rng.uniform(0, 0.03)
            mb.cyl(tuple(c - Z * nut), nut * 0.75, nut * 0.75, nut * 1.7, 7, 'od_bark', col)
    # the crown by age: newest (spear) to dead
    nf = rng.randint(24, 32)
    golden = math.radians(137.5)
    a0 = rng.uniform(0, 6.28)
    for k in range(nf):
        age = k / (nf - 1)
        az = a0 + k * golden + rng.uniform(-0.12, 0.12)
        L = rng.uniform(4.0, 5.0)
        if age < 0.1:
            el, L, droop, col, f0, f1, ao = math.radians(rng.uniform(72, 86)), L * 0.65, 0.03, 0, 0.6, 0.9, 1.0
        elif age < 0.32:
            el, droop, col, f0, f1, ao = math.radians(rng.uniform(45, 65)), rng.uniform(0.14, 0.24), rng.choice([0, 0, 1]), 0.4, 0.85, 0.95
        elif age < 0.72:
            el, droop, col, f0, f1, ao = math.radians(rng.uniform(18, 45)), rng.uniform(0.3, 0.46), rng.choice([0, 0, 1]), 0.38, 0.95, 0.85
        elif age < 0.9:
            el, droop, col, f0, f1, ao = math.radians(rng.uniform(-12, 15)), rng.uniform(0.4, 0.6), rng.choice([1, 2, 2]), 0.36, 1.05, 0.7
        else:
            el, L, droop, col, f0, f1, ao = math.radians(rng.uniform(-82, -62)), L * 0.85, 0.01, 3, 0.9, 1.2, 0.6
        base = crown + Vector((math.cos(az), math.sin(az), 0)) * 0.12 - Z * (0.1 + 0.35 * age)
        frond(mb, base, az, el, L, col, droop, f0, f1, twist=rng.uniform(-0.45, 0.45), ao=ao, side_bend=rng.uniform(-0.05, 0.05))
    return mb


def royal(name, rng, height):
    """Roystonea regia: a smooth pale-grey column swelling in the middle, a glossy green crownshaft,
    arching plumose fronds (leaflets in more than one plane: two cards per frond)"""
    mb = MB(name)
    shaft = 2.0
    th = height - shaft
    def spine(t):
        return Z * (th * t) + Vector((0.12, 0, 0)) * math.sin(t * 2.4)
    trunk(mb, spine, lambda t: 0.25 + 0.07 * math.sin(math.pi * min(1, t * 1.2)) + 0.14 * max(0, 1 - t * 12) ** 2, th, hexcol('#b9b5ab'),
          rings=0.35, ring_amp=0.012, scar_dark=0.93)
    root_plate(mb, spine(0), 0.3, rng, hexcol('#a8a398'))
    top = spine(1.0)
    mb.cyl(tuple(top), 0.27, 0.22, shaft, 14, 'od_metal', hexcol('#4f7a2e'))
    crown = top + Z * shaft
    nf = rng.randint(14, 18)
    golden = math.radians(137.5)
    a0 = rng.uniform(0, 6.28)
    for k in range(nf):
        age = k / (nf - 1)
        az = a0 + k * golden
        L = rng.uniform(4.2, 5.0)
        if age < 0.12:
            el, droop = math.radians(rng.uniform(70, 85)), 0.05
        elif age < 0.5:
            el, droop = math.radians(rng.uniform(40, 62)), rng.uniform(0.3, 0.42)
        else:
            el, droop = math.radians(rng.uniform(15, 40)), rng.uniform(0.45, 0.62)
        base = crown + Vector((math.cos(az), math.sin(az), 0)) * 0.1 - Z * 0.2 * age
        tw = rng.uniform(-0.3, 0.3)
        frond(mb, base, az, el, L, 0, droop, 0.3, 0.8, twist=tw, ao=0.9 - 0.2 * age)
        frond(mb, base, az + 0.03, el + 0.05, L * 0.96, 1, droop * 0.9, -0.45, -0.1, twist=tw, ao=0.95 - 0.2 * age)
    return mb


def washingtonia(name, rng, height):
    """Mexican fan palm: tall, slim, a small round head of fans and a skirt of dead ones"""
    mb = MB(name)
    lv = Vector((rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), 0))
    def spine(t):
        return lv * t * t + Z * (height * t)
    trunk(mb, spine, lambda t: 0.21 - 0.06 * t + 0.16 * max(0, 1 - t * 12) ** 2, height, hexcol('#8e8170'), rings=0.05, ring_amp=0.03, scar_dark=0.85)
    root_plate(mb, spine(0), 0.24, rng, hexcol('#7e7262'))
    top = spine(1.0)
    # skirt: dead fans hanging against the trunk
    for k in range(rng.randint(12, 18)):
        a = rng.uniform(0, 6.28)
        d = Vector((math.cos(a), math.sin(a), 0))
        hz = rng.uniform(0.6, 2.6)
        fan(mb, top - Z * (hz * 0.5) + d * 0.28, d, -Z, rng.uniform(0.8, 1.0), True, cup=0.15, ao=0.7)
    mb.cyl(tuple(top - Z * 0.4), 0.26, 0.3, 0.6, 10, 'od_bark', hexcol('#6b5a45'))
    nf = rng.randint(18, 24)
    golden = math.radians(137.5)
    a0 = rng.uniform(0, 6.28)
    for k in range(nf):
        age = k / (nf - 1)
        az = a0 + k * golden
        el = math.radians(80 - 95 * age + rng.uniform(-6, 6))
        h = Vector((math.cos(az), math.sin(az), 0))
        d = h * math.cos(el) + Z * math.sin(el)
        pl = rng.uniform(0.9, 1.4)
        p0 = top + Z * 0.15
        p1 = p0 + d * pl
        mb.cyl(tuple(p0), 0.035, 0.025, pl, 5, 'od_bark', hexcol('#8a8a4a'), caps=False, axis=tuple(d))
        # the blade lies in the petiole's plane, opening outward from its tip (the empty sector toward the trunk)
        nrm = Z * math.cos(el) - h * math.sin(el)
        fan(mb, p1, nrm, d, rng.uniform(0.72, 0.92), age > 0.93, cup=0.22, ao=0.9 - 0.3 * age)
    return mb


def sabal(name, rng, height):
    """cabbage palm (Florida's state tree): a rough trunk of criss-crossed leaf bases, a dense round
    head of strongly cupped fans"""
    mb = MB(name)
    def spine(t):
        return Z * (height * t) + Vector((0.15, 0.05, 0)) * t * t
    trunk(mb, spine, lambda t: 0.25 + 0.02 * math.sin(t * 9) + 0.1 * max(0, 1 - t * 10) ** 2, height, hexcol('#857a68'), rings=0.22, ring_amp=0.08, scar_dark=0.7)
    root_plate(mb, spine(0), 0.26, rng, hexcol('#7a6e5e'))
    # bootjacks: the split leaf bases, criss-crossed up the upper trunk
    for k in range(int(height * 5)):
        t = 0.35 + 0.63 * k / (height * 5)
        p = spine(t)
        a = k * 2.4
        d = Vector((math.cos(a), math.sin(a), 0))
        sd = d.cross(Z)
        for sg in (-1, 1):
            q0 = p + d * 0.22 + sd * sg * 0.03
            q1 = q0 + (d * 0.07 + sd * sg * 0.1 + Z * 0.18)
            w = sd * 0.05
            mb.face([q0 - w, q0 + w, q1 + w * 0.6, q1 - w * 0.6], 'od_bark', hexcol(rng.choice(['#6e6050', '#7a6a55', '#5f5242'])))
    top = spine(1.0)
    nf = rng.randint(26, 34)
    golden = math.radians(137.5)
    a0 = rng.uniform(0, 6.28)
    for k in range(nf):
        age = k / (nf - 1)
        az = a0 + k * golden
        el = math.radians(80 - 110 * age + rng.uniform(-8, 8))
        h = Vector((math.cos(az), math.sin(az), 0))
        d = h * math.cos(el) + Z * math.sin(el)
        pl = rng.uniform(1.2, 1.8)
        p0 = top + Z * 0.1
        mb.cyl(tuple(p0), 0.03, 0.02, pl, 5, 'od_bark', hexcol('#7f854a'), caps=False, axis=tuple(d))
        nrm = Z * math.cos(el) - h * math.sin(el)
        fan(mb, p0 + d * pl, nrm, d, rng.uniform(0.75, 0.95), age > 0.95, cup=0.3, ao=0.9 - 0.35 * age)
    return mb


def clump(mb, c, nrm, up, R, kind, ao=1.0, cup=0.25, n=4):
    """a canopy clump card (last atlas column: top half sea grape, bottom half small-leaved) at c"""
    nrm = nrm.normalized()
    ax = up.cross(nrm)
    if ax.length < 1e-4:
        ax = Vector((1, 0, 0))
    ax.normalize()
    ay = nrm.cross(ax).normalized()
    k = R / 1.0
    vc = 0.75 if kind == 'grape' else 0.25
    u0 = 5 / NCOL
    for i in range(n):
        for j in range(n):
            q, uv = [], []
            for (a, b) in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                x = (a / n - 0.5) * CARD_W
                y = (b / n - 0.5) * CARD_W
                r2 = (x * x + y * y) / 1.0
                q.append(c + (ax * x + ay * y) * k - nrm * (cup * r2 * R))
                uv.append((u0 + (a / n) / NCOL, vc + (b / n - 0.5) * CARD_W / CARD_H))
            mb.face(q, 'od_palmleaf', shade(ao), uvs=uv)


def branches(mb, rng, base, d, L, r, depth, tips, col, kink=0.35):
    """a crooked branch: tapered segments, forking; records its tips (point, direction, depth)"""
    p = base
    segs = 4
    for i in range(segs):
        d = (d + Vector((rng.uniform(-kink, kink), rng.uniform(-kink, kink), rng.uniform(-0.1, 0.25)))).normalized()
        l = L / segs
        r1 = r * (1 - 0.18 * (i + 1) / segs)
        mb.cyl(tuple(p), r, r1, l, 7, 'od_bark', col, caps=False, axis=tuple(d))
        p = p + d * l
        r = r1
    if depth <= 0 or r < 0.025:
        tips.append((p, d))
        return
    for k in range(rng.choice((2, 2, 3))):
        nd = (d + Vector((rng.uniform(-0.9, 0.9), rng.uniform(-0.9, 0.9), rng.uniform(0.0, 0.6)))).normalized()
        branches(mb, rng, p, nd, L * rng.uniform(0.55, 0.8), r * 0.62, depth - 1, tips, col, kink)
    tips.append((p, d))


def seagrape(name, rng, height):
    """sea grape: several crooked grey stems sprawling out of the sand, a low dense dome of big round leaves"""
    mb = MB(name)
    tips = []
    col = hexcol('#8b8478')
    for s in range(rng.randint(3, 6)):
        a = rng.uniform(0, 6.28)
        d = Vector((math.cos(a) * 0.8, math.sin(a) * 0.8, 0.6)).normalized()
        branches(mb, rng, Vector((math.cos(a) * 0.2, math.sin(a) * 0.2, -0.1)), d, height * 0.55, 0.07, 2, tips, col, 0.45)
    for (p, d) in tips:
        for k in range(2):
            off = Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(-0.1, 0.25)))
            nrm = (Vector((d.x, d.y, 0)) * 0.6 + Z).normalized()
            clump(mb, p + off, nrm, Vector((d.x, d.y, 0.01)), rng.uniform(0.55, 0.85), 'grape', ao=0.65 + 0.35 * min(1, (p.z + off.z) / height), cup=0.3)
    # the dome: clumps over a low ellipsoid, facing out
    canopy(mb, rng, Vector((0, 0, height * 0.5)), Vector((height * 0.85, height * 0.85, height * 0.5)), 34, 'grape', (0.6, 0.85))
    return mb


def canopy(mb, rng, c, rad, n, kind, size):
    """n clumps over the shell of an ellipsoid (a few inside), each facing outward, darker underneath"""
    for k in range(n):
        u = rng.uniform(-0.55, 1.0)
        a = rng.uniform(0, 6.28)
        r = math.sqrt(max(0, 1 - u * u))
        dirn = Vector((r * math.cos(a), r * math.sin(a), u))
        sh_ = rng.uniform(0.75, 1.0) if rng.random() < 0.8 else rng.uniform(0.3, 0.6)
        p = c + Vector((dirn.x * rad.x, dirn.y * rad.y, dirn.z * rad.z)) * sh_
        nrm = (dirn + Z * 0.3).normalized()
        up = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0.2))
        ao = 0.5 + 0.5 * (u + 0.55) / 1.55
        clump(mb, p, nrm, up, rng.uniform(*size), kind, ao=ao, cup=0.12 if kind == 'oak' else 0.25)


def shadetree(name, rng, height):
    """a broadleaf shade tree (live oak / mahogany): a short trunk, spreading limbs, a broad canopy of clumps"""
    mb = MB(name)
    tips = []
    col = hexcol('#6f6658')
    th = height * 0.32
    mb.cyl((0, 0, -0.1), 0.32, 0.24, th + 0.1, 10, 'od_bark', col)
    root_plate(mb, Vector((0, 0, 0)), 0.3, rng, col)
    top = Vector((0, 0, th))
    for s in range(rng.randint(3, 5)):
        a = rng.uniform(0, 6.28)
        d = Vector((math.cos(a) * 0.75, math.sin(a) * 0.75, 0.7)).normalized()
        branches(mb, rng, top, d, height * 0.3, 0.17, 2, tips, col, 0.3)
    # a lobe of foliage at the end of every limb: an uneven, lumpy crown with gaps between
    ends = [p for (p, d) in tips if p.z > height * 0.45]
    rng.shuffle(ends)
    ends = ends[:14] or [Vector((0, 0, height * 0.7))]
    for p in ends:
        r = height * rng.uniform(0.13, 0.2)
        canopy(mb, rng, p + Vector((0, 0, r * 0.3)), Vector((r * 1.15, r * 1.15, r * 0.75)), 10, 'oak', (0.65, 1.0))
    # and a thin inner layer so you can't see straight through the middle
    canopy(mb, rng, Vector((0, 0, height * 0.66)), Vector((height * 0.3, height * 0.3, height * 0.18)), 14, 'oak', (0.8, 1.1))
    return mb
