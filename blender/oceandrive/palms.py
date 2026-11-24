"""Coconut palms (inside Blender): a curved, ringed trunk, a boot, 18-26 fronds whose leaflets hang in a
V from the rachis, a few dead fronds and a coconut cluster. A handful of variants are built once and
placed as linked duplicates (exported as GPU instances)."""
import math, random
from mathutils import Vector
from lib import MB, hexcol, WHITE


def palm_variant(name, rng, height):
    mb = MB(name)
    lean = Vector((1.0, 0.0, 0.0)) * rng.uniform(0.8, 2.6)
    def spine(t):
        # leans early, straightens toward the crown
        off = lean * (1 - (1 - t) ** 2.2)
        return Vector((off.x, off.y, height * t))
    seg, rad = 34, 14
    rings = []
    for i in range(seg + 1):
        t = i / seg
        p = spine(t)
        q = spine(min(1, t + 0.01)) - spine(max(0, t - 0.01))
        q.normalize()
        ax = q.orthogonal().normalized(); ay = q.cross(ax)
        r = 0.19 - 0.06 * t + 0.12 * max(0, 1 - t * 14) ** 2      # flare at the base
        r *= 1 + 0.025 * math.sin(t * height * 9)                 # leaf-scar rings
        rings.append([p + (ax * math.cos(2 * math.pi * k / rad) + ay * math.sin(2 * math.pi * k / rad)) * r for k in range(rad + 1)])
    for i in range(seg):
        v0, v1 = height * i / seg, height * (i + 1) / seg
        for k in range(rad):
            u0, u1 = k / rad * 1.2, (k + 1) / rad * 1.2
            mb.face([rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]], 'od_bark', WHITE,
                    uvs=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    top = spine(1.0)
    # boot (old leaf bases)
    mb.cyl(top - Vector((0, 0, 0.55)), 0.2, 0.3, 0.75, 12, 'od_bark', hexcol('#9c8a6a'))
    crown = top + Vector((0, 0, 0.15))
    # coconuts
    for k in range(rng.randint(3, 8)):
        a = rng.uniform(0, 6.28)
        c = crown + Vector((math.cos(a) * 0.26, math.sin(a) * 0.26, -0.3 - rng.uniform(0, 0.25)))
        mb.cyl(c - Vector((0, 0, 0.1)), 0.1, 0.06, 0.22, 8, 'od_bark', hexcol(rng.choice(['#6f7a2e', '#8a7a3a', '#5f6b2a'])))
    nf = rng.randint(18, 26)
    for f in range(nf):
        az = 2 * math.pi * f / nf + rng.uniform(-0.15, 0.15)
        young = f % 3 == 0
        el = math.radians(rng.uniform(45, 70) if young else rng.uniform(-25, 35))
        L = rng.uniform(3.8, 5.0) * (0.8 if young else 1.0)
        d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        sag = rng.uniform(0.10, 0.22) * (0.4 if young else 1.0)
        frond(mb, crown, d, L, sag, 'od_frond', rng)
    for f in range(rng.randint(2, 5)):
        az = rng.uniform(0, 6.28)
        d = Vector((math.cos(az) * 0.35, math.sin(az) * 0.35, -0.94))
        frond(mb, crown - Vector((0, 0, 0.35)), d, rng.uniform(2.4, 3.4), 0.02, 'od_frond_dry', rng, fold=60)
    return mb


def frond(mb, base, d, L, sag, mat, rng, fold=None):
    n = 12
    fold = math.radians(fold if fold is not None else rng.uniform(28, 42))
    up = Vector((0, 0, 1))
    pts = []
    for i in range(n + 1):
        s = L * i / n
        p = base + d * s + Vector((0, 0, -sag * s * s))
        pts.append(p)
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        p0, p1 = pts[i], pts[i + 1]
        tg = (p1 - p0).normalized()
        side = tg.cross(up)
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
        side.normalize()
        nrm = side.cross(tg).normalized()
        w0 = 1.15 * (math.sin(math.pi * min(1, t0 * 1.15)) ** 0.5 if t0 > 0 else 0.05)
        w1 = 1.15 * (math.sin(math.pi * min(1, t1 * 1.15)) ** 0.5)
        w0, w1 = max(w0, 0.08), max(w1, 0.05)
        # V: each half drops by `fold` below the rachis
        def edge(p, w, sgn):
            return p + (side * sgn * math.cos(fold) - nrm * math.sin(fold)) * w
        l0, l1, r0, r1 = edge(p0, w0, 1), edge(p1, w1, 1), edge(p0, w0, -1), edge(p1, w1, -1)
        # texture: u 0..1 across (rachis at 0.5), v 0..1 base->tip; the texture is 1.1 m half-width
        ua0, ua1 = 0.5 + 0.5 * w0 / 1.15, 0.5 + 0.5 * w1 / 1.15
        ub0, ub1 = 0.5 - 0.5 * w0 / 1.15, 0.5 - 0.5 * w1 / 1.15
        mb.face([p0, p1, l1, l0], mat, WHITE, uvs=[(0.5, t0), (0.5, t1), (ua1, t1), (ua0, t0)])
        mb.face([r0, r1, p1, p0], mat, WHITE, uvs=[(ub0, t0), (ub1, t1), (0.5, t1), (0.5, t0)])
