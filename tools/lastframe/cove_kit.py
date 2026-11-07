"""Blender: the joinery of a Cornish cottage, modelled, not scanned. Each piece is built at real size with its origin on the
outer face of the wall at the foot of the opening, looking along -y (so rot means the same as for any other module)."""
import bpy, bmesh
from mathutils import Vector

MATS = {}
def mat(name, col, rough=0.5, metal=0.0):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    MATS[name] = m
    return m

PAINT = lambda: mat('lfpaint', (0.82, 0.82, 0.8), 0.42)
GLASS = lambda: mat('lfglass', (0.05, 0.06, 0.07), 0.05)
DOORP = lambda: mat('lfdoor', (0.8, 0.8, 0.8), 0.36)
BLACK = lambda: mat('lfblack', (0.018, 0.018, 0.02), 0.38)
CLAY = lambda: mat('lfclay', (0.45, 0.2, 0.12), 0.8)
SLATE = lambda: mat('lfslate', (0.13, 0.14, 0.15), 0.6)
BRASS = lambda: mat('lfbrass', (0.72, 0.55, 0.26), 0.3, 1.0)
STONE = lambda: mat('lfstone', (0.42, 0.41, 0.38), 0.85)


class B:
    def __init__(s, name):
        s.name = name; s.bm = bmesh.new(); s.mats = []
    def idx(s, m):
        if m not in s.mats: s.mats.append(m)
        return s.mats.index(m)
    def box(s, a, b, m):
        i = s.idx(m)
        (x0, y0, z0), (x1, y1, z1) = a, b
        v = [s.bm.verts.new(p) for p in ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            s.bm.faces.new([v[k] for k in f]).material_index = i
    def plane(s, a, b, m):
        """a pane in the xz plane, looking along -y"""
        i = s.idx(m)
        (x0, y, z0), (x1, _, z1) = a, b
        v = [s.bm.verts.new(p) for p in ((x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1))]
        s.bm.faces.new(v).material_index = i
    def cyl(s, c, r, h, m, n=10, r2=None):
        i = s.idx(m)
        import math
        lo = [s.bm.verts.new((c[0] + r * math.cos(k * 6.2832 / n), c[1] + r * math.sin(k * 6.2832 / n), c[2])) for k in range(n)]
        r2 = r if r2 is None else r2
        hi = [s.bm.verts.new((c[0] + r2 * math.cos(k * 6.2832 / n), c[1] + r2 * math.sin(k * 6.2832 / n), c[2] + h)) for k in range(n)]
        for k in range(n):
            s.bm.faces.new((lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k])).material_index = i
    def done(s):
        me = bpy.data.meshes.new(s.name)
        s.bm.normal_update()
        s.bm.to_mesh(me); s.bm.free()
        for m in s.mats: me.materials.append(m)
        return bpy.data.objects.new(s.name, me)


def sash(b, w, h, d, cols=2, rows=2, sill=True):
    """a box sash: frame set back in the reveal, a meeting rail at the middle, glazing bars either side of it"""
    P = PAINT()
    x = w / 2
    f = 0.055
    y0, y1 = d, d + 0.05
    b.plane((-x, y1 - 0.01, 0), (x, y1 - 0.01, h), GLASS())
    b.box((-x, y0, 0), (-x + f, y1, h), P)
    b.box((x - f, y0, 0), (x, y1, h), P)
    b.box((-x, y0, h - f), (x, y1, h), P)
    b.box((-x, y0, 0), (x, y1, f * 1.5), P)
    # the upper sash stands a little proud of the lower
    b.box((-x + f, y0 - 0.012, h / 2 - 0.02), (x - f, y1, h / 2 + 0.02), P)
    bar = 0.013
    for i in range(1, cols):
        c = -x + w * i / cols
        b.box((c - bar, y0 + 0.014, f), (c + bar, y1, h - f), P)
    for j in range(1, rows):
        for half in (0, 1):
            c = (h / 2) * (half + j / rows)
            if abs(c - h / 2) > 0.05: b.box((-x + f, y0 + 0.014, c - bar), (x - f, y1, c + bar), P)
    if sill:
        b.box((-x - 0.05, -0.05, -0.05), (x + 0.05, d + 0.01, 0.0), SLATE())


def punt(b, lean=0.0):
    """a clinker pulling boat, five metres: a lofted hull in overlapping strakes, painted above, antifouled below, with thwarts"""
    import math
    L, BE, ST, NS = 5.0, 0.95, 9, 40
    D = DOORP(); WOOD = mat('lfwood', (0.2, 0.13, 0.07), 0.7); RED = mat('lfanti', (0.32, 0.07, 0.05), 0.75); RAIL = mat('lfrail', (0.62, 0.6, 0.54), 0.5)
    def half(u):            # half beam along the boat, u from stern -.5 to bow .5
        return BE * (1 - (abs(u - 0.02) / 0.52) ** 2.4) ** 0.72 * (0.42 + 0.58 * min(1.0, (u + 0.5) / 0.2 + 0.25)) if u < 0.5 else 0.0
    def sheer(u):           # the gunwale's rise to each end
        return 0.72 + 0.34 * (2 * u) ** 2 + (0.12 * u if u > 0 else 0)
    def keel(u):            # the keel, rising to the stem
        return 0.04 + 0.5 * max(0.0, (u - 0.28) / 0.22) ** 2.2 + 0.2 * max(0.0, (-u - 0.3) / 0.2) ** 2
    def P(u, t, off=0.0):
        hb = half(u)
        y = (hb + off) * math.sin(t * math.pi / 2) ** 0.62
        z = keel(u) + (sheer(u) - keel(u)) * t ** 1.32
        return (u * L, y, z)
    tilt = lambda p: (p[0], p[1] * math.cos(lean) - p[2] * math.sin(lean), p[1] * math.sin(lean) + p[2] * math.cos(lean))
    us = [-0.5 + i / NS for i in range(NS + 1)]
    for sd in (1, -1):
        for k in range(ST):
            t0, t1 = k / ST, (k + 1) / ST
            m_ = RED if k < 3 else D
            i = b.idx(m_)
            for ua, ub in zip(us, us[1:]):
                # each strake laps the one below it
                q = [P(ua, t0, 0.018), P(ub, t0, 0.018), P(ub, t1), P(ua, t1)]
                vs = [b.bm.verts.new(tilt((a, c * sd, e))) for a, c, e in (q if sd > 0 else q[::-1])]
                f = b.bm.faces.new(vs); f.material_index = i; f.smooth = True
        # the inside
        i = b.idx(WOOD)
        for ua, ub in zip(us, us[1:]):
            q = [P(ua, 0.1, -0.03), P(ua, 1.0, -0.03), P(ub, 1.0, -0.03), P(ub, 0.1, -0.03)]
            vs = [b.bm.verts.new(tilt((a, c * sd, e))) for a, c, e in (q if sd > 0 else q[::-1])]
            f = b.bm.faces.new(vs); f.material_index = i; f.smooth = True
        # the gunwale, a pale rail along the top
        i = b.idx(RAIL)
        for ua, ub in zip(us, us[1:]):
            a0, a1, b0, b1 = P(ua, 1.0, 0.03), P(ub, 1.0, 0.03), P(ua, 1.0, -0.05), P(ub, 1.0, -0.05)
            q = [(a0[0], a0[1], a0[2] + 0.025), (a1[0], a1[1], a1[2] + 0.025), (b1[0], b1[1], b1[2] + 0.025), (b0[0], b0[1], b0[2] + 0.025)]
            vs = [b.bm.verts.new(tilt((x, y * sd, z))) for x, y, z in (q[::-1] if sd > 0 else q)]
            f = b.bm.faces.new(vs); f.material_index = i
    # the transom, the bottom boards and three thwarts
    i = b.idx(D)
    rim = [P(-0.5, k / ST, 0.018) for k in range(ST + 1)]
    vs = [b.bm.verts.new(tilt(p)) for p in rim] + [b.bm.verts.new(tilt((p[0], -p[1], p[2]))) for p in rim[::-1]]
    b.bm.faces.new(vs[::-1]).material_index = i
    for u, w in ((-0.2, 0.66), (0.02, 0.86), (0.24, 0.72)):
        i = b.idx(WOOD)
        z = 0.5
        a, c = (u * L - 0.11, -w, z), (u * L + 0.11, w, z + 0.03)
        v = [b.bm.verts.new(tilt(p)) for p in ((a[0], a[1], a[2]), (c[0], a[1], a[2]), (c[0], c[1], a[2]), (a[0], c[1], a[2]), (a[0], a[1], c[2]), (c[0], a[1], c[2]), (c[0], c[1], c[2]), (a[0], c[1], c[2]))]
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            b.bm.faces.new([v[k] for k in f]).material_index = i
    v = [b.bm.verts.new(tilt(p)) for p in ((-2.2, -0.4, 0.22), (2.0, -0.3, 0.22), (2.0, 0.3, 0.22), (-2.2, 0.4, 0.22))]
    b.bm.faces.new(v).material_index = b.idx(WOOD)


def make(name):
    b = B('k_' + name)
    if name == 'sash':          # two over two
        sash(b, 0.92, 1.3, 0.2, 2, 4)
    elif name == 'sash_s':      # upstairs under the eaves
        sash(b, 0.8, 1.02, 0.2, 2, 4)
    elif name == 'case':        # a small cottage casement
        sash(b, 0.74, 0.86, 0.2, 2, 2)
    elif name == 'wide':        # the front room
        sash(b, 1.34, 1.3, 0.2, 3, 4)
    elif name == 'door':
        w, h, d = 0.9, 2.02, 0.14
        P, D = PAINT(), DOORP()
        x = w / 2
        y = d + 0.04
        b.box((-x, d, 0), (-x + 0.06, y + 0.02, h), P)
        b.box((x - 0.06, d, 0), (x, y + 0.02, h), P)
        b.box((-x, d, h - 0.07), (x, y + 0.02, h), P)
        # four panels: stiles, rails, and the fielded panels set back
        L, R, T = -x + 0.06, x - 0.06, h - 0.07
        b.plane((L, y + 0.018, 0), (R, y + 0.018, T), D)
        for z0, z1 in ((0, 0.2), (0.86, 1.02), (T - 0.13, T)):
            b.box((L, y - 0.012, z0), (R, y + 0.012, z1), D)
        for c0, c1 in ((L, L + 0.12), (-0.05, 0.05), (R - 0.12, R)):
            b.box((c0, y - 0.012, 0), (c1, y + 0.012, T), D)
        # a fanlight above the rail, brass where a hand goes
        b.plane((L + 0.13, y - 0.014, 1.5), (R - 0.13, y - 0.014, T - 0.15), GLASS())
        b.box((L + 0.12, y - 0.016, 1.42), (R - 0.12, y + 0.01, 1.5), D)
        b.cyl((R - 0.1, y - 0.03, 1.0), 0.028, 0.03, BRASS())
        b.box((-0.1, y - 0.02, 1.1), (0.1, y - 0.012, 1.135), BRASS())
    elif name == 'gutter':      # one metre, along +x, hung off the fascia
        b.box((0, -0.11, -0.05), (1, 0.0, -0.04), BLACK())
        b.box((0, -0.115, -0.05), (1, -0.104, 0.02), BLACK())
        b.box((0, -0.006, -0.05), (1, 0.0, 0.02), BLACK())
    elif name == 'pipe':        # one metre, up
        b.cyl((0, -0.06, 0), 0.036, 1.0, BLACK(), n=8)
    elif name == 'pot':         # a clay chimney pot
        b.cyl((0, 0, 0), 0.13, 0.42, CLAY(), n=10, r2=0.095)
        b.cyl((0, 0, 0.42), 0.115, 0.05, CLAY(), n=10)
    elif name == 'step':        # a slate doorstep
        b.box((-0.62, -0.42, -0.2), (0.62, 0.01, 0.1), SLATE())
    elif name == 'post':        # a mooring post on the quay, or a gatepost
        b.cyl((0, 0, 0), 0.13, 0.9, BLACK(), n=10, r2=0.11)
        b.cyl((0, 0, 0.9), 0.14, 0.08, BLACK(), n=10, r2=0.05)
    elif name == 'punt':
        punt(b)
    elif name == 'punt_l':      # hauled out, leaning on her bilge
        punt(b, 0.14)
    elif name == 'punt_r':
        punt(b, -0.11)
    elif name == 'pole':        # a telegraph pole, with its arm
        b.cyl((0, 0, 0), 0.13, 8.2, mat('lfpole', (0.09, 0.06, 0.04), 0.8), n=8, r2=0.09)
        b.box((-0.55, -0.04, 7.7), (0.55, 0.04, 7.8), mat('lfpole', (0.09, 0.06, 0.04), 0.8))
    elif name == 'lobster':     # a withy pot: a low dome of bars on a base
        import math
        W = mat('lfwithy', (0.28, 0.2, 0.11), 0.8)
        b.box((-0.34, -0.26, 0), (0.34, 0.26, 0.04), W)
        for i in range(7):
            x = -0.3 + i * 0.1
            hh = 0.34 * math.sqrt(max(0.05, 1 - (x / 0.36) ** 2))
            b.box((x - 0.008, -0.25, 0.04), (x + 0.008, -0.235, 0.04 + hh), W)
            b.box((x - 0.008, 0.235, 0.04), (x + 0.008, 0.25, 0.04 + hh), W)
            b.box((x - 0.008, -0.25, 0.03 + hh), (x + 0.008, 0.25, 0.05 + hh), W)
    else:
        raise Exception('no kit piece ' + name)
    return b.done()
