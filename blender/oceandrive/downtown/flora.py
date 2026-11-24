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
