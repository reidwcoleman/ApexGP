"""Downtown's palms (inside Blender): royal palms (Roystonea, the boulevard's: a smooth pale column with a
green crownshaft and arching fronds) and lighter coconut palms for the sidewalks and the park."""
import math, random
from mathutils import Vector
from lib import MB, hexcol, WHITE
from palms import frond


def royal(name, rng, height):
    mb = MB(name)
    seg, rad = 16, 10
    rings = []
    for i in range(seg + 1):
        t = i / seg
        z = height * t
        r = 0.26 + 0.05 * math.sin(math.pi * min(1, t * 1.25)) - 0.05 * t + 0.1 * max(0, 1 - t * 10) ** 2
        rings.append([Vector((math.cos(2 * math.pi * k / rad) * r, math.sin(2 * math.pi * k / rad) * r, z)) for k in range(rad + 1)])
    for i in range(seg):
        v0, v1 = height * i / seg, height * (i + 1) / seg
        for k in range(rad):
            mb.face([rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]], 'od_bark', hexcol('#c9c4b8'),
                    uvs=[(k / rad * 1.6, v0 * 0.3), ((k + 1) / rad * 1.6, v0 * 0.3), ((k + 1) / rad * 1.6, v1 * 0.3), (k / rad * 1.6, v1 * 0.3)])
    top = Vector((0, 0, height))
    # crownshaft: smooth, glossy green
    mb.cyl(top, 0.24, 0.2, 2.2, 10, 'od_bark', hexcol('#5c7a3a'))
    crown = top + Vector((0, 0, 2.2))
    nf = rng.randint(13, 17)
    for f in range(nf):
        az = 2 * math.pi * f / nf + rng.uniform(-0.2, 0.2)
        el = math.radians(rng.uniform(10, 60))
        L = rng.uniform(3.6, 4.6)
        d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        frond(mb, crown, d, L, rng.uniform(0.12, 0.2), 'od_frond', rng)
    return mb


def coconut(name, rng, height):
    """a lighter coconut palm (fewer segments than the beach's)"""
    mb = MB(name)
    lean = Vector((1.0, 0.0, 0.0)) * rng.uniform(0.5, 2.0)
    def spine(t):
        off = lean * (1 - (1 - t) ** 2.2)
        return Vector((off.x, off.y, height * t))
    seg, rad = 14, 8
    rings = []
    for i in range(seg + 1):
        t = i / seg
        p = spine(t)
        q = (spine(min(1, t + 0.01)) - spine(max(0, t - 0.01))).normalized()
        ax = q.orthogonal().normalized(); ay = q.cross(ax)
        r = 0.18 - 0.05 * t + 0.1 * max(0, 1 - t * 10) ** 2
        rings.append([p + (ax * math.cos(2 * math.pi * k / rad) + ay * math.sin(2 * math.pi * k / rad)) * r for k in range(rad + 1)])
    for i in range(seg):
        v0, v1 = height * i / seg, height * (i + 1) / seg
        for k in range(rad):
            mb.face([rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]], 'od_bark', WHITE,
                    uvs=[(k / rad * 1.2, v0), ((k + 1) / rad * 1.2, v0), ((k + 1) / rad * 1.2, v1), (k / rad * 1.2, v1)])
    top = spine(1.0)
    mb.cyl(top - Vector((0, 0, 0.5)), 0.19, 0.28, 0.7, 8, 'od_bark', hexcol('#9c8a6a'))
    crown = top + Vector((0, 0, 0.15))
    nf = rng.randint(14, 18)
    for f in range(nf):
        az = 2 * math.pi * f / nf + rng.uniform(-0.15, 0.15)
        young = f % 3 == 0
        el = math.radians(rng.uniform(45, 70) if young else rng.uniform(-25, 35))
        d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        frond(mb, crown, d, rng.uniform(3.6, 4.8) * (0.8 if young else 1.0), rng.uniform(0.1, 0.22) * (0.4 if young else 1.0), 'od_frond', rng)
    for f in range(rng.randint(1, 3)):
        az = rng.uniform(0, 6.28)
        d = Vector((math.cos(az) * 0.35, math.sin(az) * 0.35, -0.94))
        frond(mb, crown - Vector((0, 0, 0.35)), d, rng.uniform(2.4, 3.2), 0.02, 'od_frond_dry', rng, fold=60)
    return mb


def fan_leaf(mb, base, d, L, R, rng, mat='od_frond'):
    """a palmate leaf: a petiole out along d, then a fan of ~22 drooping segments radiating from its tip"""
    up = Vector((0, 0, 1))
    tip = base + d * L
    mb.cyl(tuple(base), 0.025, 0.018, L, 4, 'od_bark', hexcol('#7d8a4a'), caps=False, axis=tuple(d))
    side = d.cross(up)
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    nrm = side.cross(d).normalized()
    n = 22
    for k in range(n):
        a = -1.25 + 2.5 * k / (n - 1)
        dirk = (d * math.cos(a) + side * math.sin(a)).normalized()
        steps = 4
        prev_c = tip
        w0 = 0.07
        for i in range(steps):
            t0, t1 = i / steps, (i + 1) / steps
            droop = (t1 ** 2) * 0.45 * R
            c1 = tip + dirk * (R * t1) - nrm * droop * 0.3 - up * droop
            w1 = 0.09 * (1 - t1) + 0.02
            sd = dirk.cross(up).normalized() if dirk.cross(up).length > 1e-3 else side
            q = [prev_c - sd * w0, c1 - sd * w1, c1 + sd * w1, prev_c + sd * w0]
            mb.face([tuple(p) for p in q], mat, WHITE, uvs=[(0.45, t0), (0.45, t1), (0.55, t1), (0.55, t0)])
            prev_c, w0 = c1, w1


def washingtonia(name, rng, height):
    """Mexican fan palm: a very tall slim trunk, a small round head of fan leaves over a skirt of dead ones"""
    mb = MB(name)
    seg, rad = 18, 8
    lean = Vector((rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), 0))
    rings = []
    for i in range(seg + 1):
        t = i / seg
        p = lean * t * t + Vector((0, 0, height * t))
        r = 0.2 - 0.07 * t + 0.12 * max(0, 1 - t * 12) ** 2
        rings.append([p + Vector((math.cos(2 * math.pi * k / rad) * r, math.sin(2 * math.pi * k / rad) * r, 0)) for k in range(rad + 1)])
    for i in range(seg):
        v0, v1 = height * i / seg, height * (i + 1) / seg
        for k in range(rad):
            mb.face([rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]], 'od_bark', hexcol('#9c8d78'),
                    uvs=[(k / rad, v0), ((k + 1) / rad, v0), ((k + 1) / rad, v1), (k / rad, v1)])
    top = lean + Vector((0, 0, height))
    # the skirt of dead fronds hanging down the trunk
    mb.cyl(tuple(top - Vector((0, 0, 2.2))), 0.42, 0.34, 2.0, 10, 'od_frond_dry', WHITE)
    for f in range(14):
        az = 2 * math.pi * f / 14 + rng.uniform(-0.2, 0.2)
        el = math.radians(rng.uniform(-10, 55))
        d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        fan_leaf(mb, top, d, rng.uniform(0.6, 1.0), rng.uniform(0.9, 1.25), rng)
    return mb


def sabal(name, rng, height):
    """cabbage palm (Florida's own): a rough trunk with the old leaf bases criss-crossed, a dense round crown"""
    mb = MB(name)
    seg, rad = 12, 8
    rings = []
    for i in range(seg + 1):
        t = i / seg
        r = 0.24 + 0.03 * math.sin(t * 40)
        rings.append([Vector((math.cos(2 * math.pi * k / rad) * r, math.sin(2 * math.pi * k / rad) * r, height * t)) for k in range(rad + 1)])
    for i in range(seg):
        v0, v1 = height * i / seg, height * (i + 1) / seg
        for k in range(rad):
            mb.face([rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]], 'od_bark', hexcol('#8a7e6a'),
                    uvs=[(k / rad, v0), ((k + 1) / rad, v0), ((k + 1) / rad, v1), (k / rad, v1)])
    top = Vector((0, 0, height))
    for f in range(26):
        az = 2 * math.pi * f / 26 + rng.uniform(-0.15, 0.15)
        el = math.radians(rng.uniform(-35, 70))
        d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        fan_leaf(mb, top, d, rng.uniform(0.8, 1.4), rng.uniform(0.9, 1.3), rng)
    return mb
