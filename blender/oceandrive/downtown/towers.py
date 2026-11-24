"""Downtown buildings from OSM footprints and heights (inside Blender).

Styles (picked per building, every part of one building alike):
  curtain  glass curtain wall (office, hotel): the facade is one surface, the runtime draws the
           mullions, spandrels and the offices behind the glass; corner fins, a storefront podium with
           a canopy, a parapet, a mechanical penthouse, some with a lit crown
  condo    Miami's residential towers: floor-to-ceiling glass behind continuous balcony slabs with
           glass railings, a lobby, a sculpted top
  ribbon   older offices: concrete with bands of windows
  garage   parking decks: open floors between slabs
  low      shops and walk-ups: the same generator as the beach block's back streets
Skyline buildings (beyond the playable streets) are simple extrusions with the same facade shaders."""
import math, random, zlib
from mathutils import Vector
import hotels
from lib import hexcol, WHITE

SW = 0.15
GLASS_TINTS = ['#3e5a73', '#4d6b66', '#7d878f', '#5b5148', '#33414e', '#6f8fa6', '#58707a', '#8c9aa3']
CONCRETE = ['#efece4', '#e6e2d8', '#d8d4cb', '#f3f1ec', '#cfc9bd', '#e9e0cf']
CROWN = ['#ffffff', '#9fd8ff', '#3a7bff', '#ff4fb0', '#7af0e0', '#ffcf7a']
FLOOR = 3.15        # residential floor (matches the window glass's rooms)
OFFICE = 3.9        # office floor (matches the curtain wall's spandrels)


def ccw(pts):
    a = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return pts if a > 0 else pts[::-1]


def clean(pts, eps=0.25):
    out = []
    for p in pts:
        if not out or math.dist(out[-1], p) > eps:
            out.append(p)
    if len(out) > 2 and math.dist(out[0], out[-1]) < eps:
        out.pop()
    return out


def offset_ring(pts, d):
    """miter offset of a ccw ring (outward for d > 0), miters clamped"""
    n = len(pts)
    out = []
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        e0 = Vector((p1[0] - p0[0], p1[1] - p0[1])).normalized()
        e1 = Vector((p2[0] - p1[0], p2[1] - p1[1])).normalized()
        n0 = Vector((e0.y, -e0.x))
        n1 = Vector((e1.y, -e1.x))
        m = n0 + n1
        if m.length < 1e-4:
            m = n0
        m.normalize()
        k = d / max(0.35, m.dot(n1))
        out.append((p1[0] + m.x * k, p1[1] + m.y * k))
    return out


def style_of(b, rng):
    nm = (b.get('name') or '').lower()
    k = (b.get('kind') or 'yes').lower()
    H = b['h']
    if k in ('parking', 'garage', 'garages') or 'garage' in nm or 'parking' in nm:
        return 'garage'
    if H < 17:
        return 'low'
    resid = k in ('residential', 'apartments', 'hotel', 'dormitory') or any(s in nm for s in ('residence', 'condo', 'lofts', 'apartments', 'marquis', 'opera', 'ten museum', 'marinablue', 'quantum', 'vizcayne', 'met ', 'epic', 'icon', 'one thousand', 'paramount', 'aston'))
    if resid and H >= 35:
        return 'condo' if rng.random() < 0.85 else 'curtain'
    if H >= 55:
        return 'curtain' if rng.random() < 0.75 else 'ribbon'
    return 'ribbon' if rng.random() < 0.6 else 'curtain'


class Bld:
    """per-building choices, shared by all its parts"""
    def __init__(self, b):
        self.rng = random.Random(zlib.crc32(str(b.get('pid', b['id'])).encode()))
        r = self.rng
        self.style = style_of(b, r)
        self.tint = hexcol(r.choice(GLASS_TINTS))
        self.conc = hexcol(b['col']) if b.get('col') and str(b['col']).startswith('#') and len(str(b['col'])) == 7 else hexcol(r.choice(CONCRETE))
        self.crown = hexcol(r.choice(CROWN)) if r.random() < 0.45 else None
        self.balcony = r.uniform(1.5, 2.3)
        self.rail_k = r.random()


def walls(mb, ring, z0, z1, mat, col):
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        if math.dist(a, b) < 0.05:
            continue
        mb.face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], mat, col)


def roof(mb, ring, z, mat='od_roof', col=WHITE):
    mb.face([(p[0], p[1], z) for p in ring], mat, col, n=(0, 0, 1))


def edges(ring):
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        if L < 0.05:
            continue
        yield a, b, L, (dx / L, dy / L, 0.0), (dy / L, -dx / L, 0.0)


def corner_fins(mb, ring, z0, z1, col):
    n = len(ring)
    for i in range(n):
        p0, p1, p2 = ring[i - 1], ring[i], ring[(i + 1) % n]
        a = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
        b = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
        turn = abs(math.atan2(math.sin(b - a), math.cos(b - a)))
        if turn < 0.35:
            continue
        mb.box(p1[0] - 0.18, p1[1] - 0.18, z0, p1[0] + 0.18, p1[1] + 0.18, z1, 'od_frame', col, skip=('-z',))


def parapet(mb, ring, z, hgt, mat, col, cap_col):
    """walls carried above the roof, their inner face, and a coping"""
    inner = offset_ring(ring, -0.3)
    walls(mb, ring, z, z + hgt, mat, col)
    walls(mb, inner[::-1], z, z + hgt, 'od_roof', WHITE)
    n = len(ring)
    for i in range(n):
        a, b, ia, ib = ring[i], ring[(i + 1) % n], inner[i], inner[(i + 1) % n]
        mb.face([(a[0], a[1], z + hgt), (b[0], b[1], z + hgt), (ib[0], ib[1], z + hgt), (ia[0], ia[1], z + hgt)], 'od_metal', cap_col, n=(0, 0, 1))


def penthouse(mb, ring, z, B, small=False):
    """the mechanical floors on the roof: an inset box, screened; sometimes a lit crown on it"""
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
    inset = offset_ring(ring, -max(2.0, min(max(xs) - min(xs), max(ys) - min(ys)) * 0.22))
    # the inset must stay inside: if the miter flipped (tiny or odd shapes), use a box round the centre
    if len(ring) <= 10 and all(math.dist(p, (cx, cy)) < math.dist(q, (cx, cy)) for p, q in zip(inset, ring)):
        pts = inset
    else:
        w = min(max(xs) - min(xs), max(ys) - min(ys)) * 0.25
        pts = [(cx - w, cy - w), (cx + w, cy - w), (cx + w, cy + w), (cx - w, cy + w)]
    h = B.rng.uniform(4.5, 8.0) if not small else 3.0
    mat = 'od_curtain' if B.style == 'curtain' else 'od_stucco'
    col = B.tint if B.style == 'curtain' else B.conc
    walls(mb, pts, z, z + h, mat, col)
    roof(mb, pts, z + h)
    if B.crown is not None and not small:
        crown_band(mb, pts, z + h - 0.9, 0.7, B.crown)
    return pts, z + h


def crown_band(mb, ring, z, hgt, col):
    out = offset_ring(ring, 0.06)
    walls(mb, out, z, z + hgt, 'od_crown', col)


def podium(mb, ring, z0, B, storefront=True):
    """street level: storefront glass, a canopy over it"""
    top = z0 + 5.2
    walls(mb, ring, z0, top, 'od_shopglass' if storefront else 'od_stucco', WHITE if storefront else B.conc)
    for a, b, L, U, N in edges(ring):
        if L < 4:
            continue
        c = ((a[0] + b[0]) / 2 + N[0] * 0.75, (a[1] + b[1]) / 2 + N[1] * 0.75, top - 0.15)
        mb.obox(c, U, N, (0, 0, 1), L / 2, 0.75, 0.15, 'od_trim', B.conc)
        # a band between the podium and the tower
        c2 = ((a[0] + b[0]) / 2 + N[0] * 0.06, (a[1] + b[1]) / 2 + N[1] * 0.06, top + 0.4)
        mb.obox(c2, U, N, (0, 0, 1), L / 2 + 0.06, 0.06, 0.4, 'od_trim', B.conc)
    return top + 0.8


def curtain(mb, ring, z0, z1, B, ground):
    zb = z0
    if ground:
        zb = podium(mb, ring, z0, B)
        walls(mb, ring, z0 + 5.2, zb, 'od_trim', B.conc)
    walls(mb, ring, zb, z1, 'od_curtain', B.tint)
    corner_fins(mb, ring, zb, z1 + 1.4, hexcol('#3a3f44'))
    parapet(mb, ring, z1, 1.4, 'od_curtain', B.tint, hexcol('#9aa0a6'))
    roof(mb, offset_ring(ring, -0.3), z1)


def ribbon(mb, ring, z0, z1, B, ground):
    zb = z0
    if ground:
        zb = podium(mb, ring, z0, B)
        walls(mb, ring, z0 + 5.2, zb, 'od_trim', B.conc)
    walls(mb, ring, zb, z1, 'od_ribbon', B.conc)
    parapet(mb, ring, z1, 1.1, 'od_stucco', B.conc, hexcol('#d6d2ca'))
    roof(mb, offset_ring(ring, -0.3), z1)


def garage(mb, ring, z0, z1, B, ground):
    walls(mb, ring, z0, z1, 'od_garage', B.conc)
    parapet(mb, ring, z1, 1.0, 'od_stucco', B.conc, hexcol('#cfcac0'))
    roof(mb, offset_ring(ring, -0.3), z1, 'od_asphalt')


def condo(mb, rails, ring, z0, z1, B, ground):
    """glass walls; balconies all round on every floor (simple footprints), glass railings"""
    zb = z0
    if ground:
        walls(mb, ring, z0, 4.45 + SW * 0, 'od_shopglass', WHITE)
        zb = 4.45
    simple = len(ring) <= 16
    walls(mb, ring, zb, z1, 'od_glass', WHITE)
    if simple:
        out = offset_ring(ring, B.balcony)
        k0 = max(1, math.ceil((zb - 4.45) / FLOOR))
        k = k0
        n = len(ring)
        while True:
            z = 4.45 + k * FLOOR
            if z > z1 - 1.0:
                break
            for i in range(n):
                a, b, oa, ob = ring[i], ring[(i + 1) % n], out[i], out[(i + 1) % n]
                # slab: top, underside, the edge
                mb.face([(a[0], a[1], z), (b[0], b[1], z), (ob[0], ob[1], z), (oa[0], oa[1], z)], 'od_trim', B.conc, n=(0, 0, 1))
                mb.face([(a[0], a[1], z - 0.24), (oa[0], oa[1], z - 0.24), (ob[0], ob[1], z - 0.24), (b[0], b[1], z - 0.24)], 'od_trim', B.conc, n=(0, 0, -1))
                mb.face([(oa[0], oa[1], z - 0.24), (ob[0], ob[1], z - 0.24), (ob[0], ob[1], z), (oa[0], oa[1], z)], 'od_trim', B.conc)
                rails.face([(oa[0], oa[1], z), (ob[0], ob[1], z), (ob[0], ob[1], z + 1.07), (oa[0], oa[1], z + 1.07)], 'od_rail', WHITE)
            k += 1
        # the end walls between the balconies: a solid fin at the corners
        corner_fins(mb, ring, zb, z1, B.conc)
    else:
        for z in [4.45 + k * FLOOR for k in range(1, int((z1 - 4.45) / FLOOR))]:
            walls(mb, offset_ring(ring, 0.12), z - 0.22, z, 'od_trim', B.conc)
    parapet(mb, ring, z1, 1.3, 'od_stucco', B.conc, hexcol('#e4e0d8'))
    roof(mb, offset_ring(ring, -0.3), z1)


def build(mb, rails, b, props):
    B = Bld(b)
    ring = ccw(clean([tuple(p) for p in b['fp'][0]]))
    if len(ring) < 3:
        return B
    z0 = SW + (b['mh'] if b['mh'] > 0.5 else 0.0)
    z1 = SW + b['h']
    if z1 - z0 < 1.0:
        return B
    ground = b['mh'] <= 0.5
    st = B.style
    if st == 'low':
        if ground:
            hotels.city_building(mb, ring, b['h'], B.rng, props, street=None)
        else:
            walls(mb, ring, z0, z1, 'od_stucco', B.conc)
            roof(mb, ring, z1)
        return B
    if st == 'curtain':
        curtain(mb, ring, z0, z1, B, ground and z1 > 25)
    elif st == 'ribbon':
        ribbon(mb, ring, z0, z1, B, ground and z1 > 15)
    elif st == 'garage':
        garage(mb, ring, z0, z1, B, ground)
    else:
        condo(mb, rails, ring, z0, z1, B, ground)
    # the top of a tall part: mechanical floors, a lit crown
    if b['h'] > 45 and B.rng.random() < 0.8:
        penthouse(mb, offset_ring(ring, -0.3), z1, B)
    return B


def skyline(mb, b, z_base=0.0, rng=None):
    """a building far from the streets you can reach: walls and a roof, the facade shader does the rest"""
    ring = ccw(clean([tuple(p) for p in b['fp'][0]], 0.6))
    if len(ring) < 3:
        return
    B = Bld(b)
    z0 = z_base + (b['mh'] if b['mh'] > 0.5 else 0.0)
    z1 = z_base + b['h']
    if z1 - z0 < 1.0:
        return
    st = B.style
    if st in ('curtain',):
        mat, col = 'od_curtain', B.tint
    elif st == 'condo':
        mat, col = 'od_skycondo', B.conc
    elif st == 'garage':
        mat, col = 'od_garage', B.conc
    elif st == 'ribbon':
        mat, col = 'od_ribbon', B.conc
    else:
        mat, col = 'od_far', hexcol(B.rng.choice(hotels.CITY_BODY))
    walls(mb, ring, z0, z1, mat, col)
    roof(mb, ring, z1)
    if b['h'] > 60 and B.rng.random() < 0.7:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        w = min(max(xs) - min(xs), max(ys) - min(ys)) * 0.22
        pts = [(cx - w, cy - w), (cx + w, cy - w), (cx + w, cy + w), (cx - w, cy + w)]
        h = B.rng.uniform(4, 9)
        walls(mb, pts, z1, z1 + h, mat, col)
        roof(mb, pts, z1 + h)
        if B.crown is not None:
            walls(mb, offset_ring(pts, 0.06), z1 + h - 1.0, z1 + h - 0.2, 'od_crown', B.crown)
