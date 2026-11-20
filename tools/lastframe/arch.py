"""The joinery and trim of a building, modelled rather than painted on: what stands between a box with a scan on it and a room.

A layout is walls, floors and holes. This pass reads the finished layout and models what a builder would have fixed to it:

  skirting      a moulded board (or a coved tile, a rubber base, a stone course) along the foot of every wall that stands in a
                room, mitred round every corner, dying into the door frames
  dado rails    a moulding on the paint line of the two-tone rooms
  cornices      plaster coving where the old ceilings meet the walls, a shadow angle round the suspended ones
  door frames   linings through the wall, a stop, moulded architraves mitred at the head on both faces, a threshold strip
  windows       chamfered frames, mullion and transom, a bullnosed window board on the room side
  hatches       lined and cased on all four sides
  rails         the square pipe rails turned into round tube on base plates
  stairs        a nosing on the edge of every tread
  ceilings      tiles gone from the suspended ceilings: a real hole into the void, the grid left across it, a pipe or two above

Everything is quads and triangles in the layout's own space (x east, y north, z up), handed to bake.py as `m.quads` with
lm2=True: it is lit by the bake like the walls, on the second lightmap. Nothing here collides.
"""
import math, random
import numpy as np

WALL = ('int', 'ext', 'wall', 'post')


def V(*a):
    return np.array(a, float)


class Out:
    def __init__(s):
        s.q = []
        s.count = {}

    def _n(s, what):
        s.count[what] = s.count.get(what, 0) + 1

    def quad(s, pts, mat, hint, dens=0.5, vn=None):
        p = [np.asarray(q, float) for q in pts]
        n = np.cross(p[1] - p[0], p[3] - p[0])
        if float(np.dot(n, n)) < 1e-14:
            return
        if float(np.dot(n, hint)) < 0:
            p = [p[0], p[3], p[2], p[1]]
            if vn is not None: vn = [vn[0], vn[3], vn[2], vn[1]]
        e = dict(v=[q.tolist() for q in p], mat=mat, dens=dens, lm2=True)
        if vn is not None: e['vn'] = [[float(c) for c in x] for x in vn]
        s.q.append(e)

    def tri(s, a, b, c, mat, hint, dens=0.5):
        a, b, c = (np.asarray(q, float) for q in (a, b, c))
        n = np.cross(b - a, c - a)
        if float(np.dot(n, n)) < 1e-14:
            return
        if float(np.dot(n, hint)) < 0: b, c = c, b
        s.q.append(dict(v=[a.tolist(), b.tolist(), c.tolist(), c.tolist()], mat=mat, dens=dens, lm2=True, tri=True))


def sweep(o, P0, P1, A, B, prof, mat, m0=0.0, m1=0.0, dens=0.5, cap0=False, cap1=False, ref=None, closed=False, smooth=True):
    """A moulding: the profile `prof` (points (a, b) in the plane across the run) carried from P0 to P1. A and B are the
    directions a and b go in. m0, m1 mitre the ends: the run is that much longer (or, negative, shorter) per metre of a, so
    +1 at both ends of each side takes a moulding round an outside corner and -1 round an inside one."""
    P0, P1, A, B = (np.asarray(q, float) for q in (P0, P1, A, B))
    L = P1 - P0
    ln = float(np.linalg.norm(L))
    if ln < 1e-4: return
    Ld = L / ln
    n = len(prof)
    p0 = [P0 + A * a + B * b - Ld * (m0 * a) for a, b in prof]
    p1 = [P1 + A * a + B * b + Ld * (m1 * a) for a, b in prof]
    if ref is None:
        ref = (-0.02, sum(b for _, b in prof) / n) if not closed else (sum(a for a, _ in prof) / n, sum(b for _, b in prof) / n)
    segs = list(range(n - 1))
    sn = []
    for i in segs:
        (a0, b0), (a1, b1) = prof[i], prof[i + 1]
        da, db = a1 - a0, b1 - b0
        l2 = math.hypot(da, db)
        if l2 < 1e-9:
            sn.append(None); continue
        na, nb = db / l2, -da / l2
        if (((a0 + a1) / 2 - ref[0]) * na + ((b0 + b1) / 2 - ref[1]) * nb) < 0: na, nb = -na, -nb
        sn.append(A * na + B * nb)

    def vnorm(i, k):
        """the normal at profile point k as seen from segment i: shared with the next segment where the bend is gentle"""
        me = sn[i]
        other = None
        if k == i and (i > 0 or closed): other = sn[(i - 1) % len(sn)]
        if k == i + 1 and (i + 1 < len(sn) or closed): other = sn[(i + 1) % len(sn)]
        if smooth and other is not None and float(np.dot(me, other)) > 0.62:
            v = me + other
            return v / np.linalg.norm(v)
        return me
    for i in segs:
        if sn[i] is None: continue
        o.quad([p0[i], p1[i], p1[i + 1], p0[i + 1]], mat, sn[i], dens, vn=[vnorm(i, i), vnorm(i, i), vnorm(i, i + 1), vnorm(i, i + 1)])
    for cap, pts, hint in ((cap0, p0, -Ld), (cap1, p1, Ld)):
        if not cap: continue
        poly = list(pts[:-1] if closed else pts)
        if not closed:
            # back along the wall to where it started
            base = P0 if pts is p0 else P1
            if abs(prof[-1][0]) > 1e-6: poly.append(base + B * prof[-1][1])
            if abs(prof[0][0]) > 1e-6: poly.append(base + B * prof[0][1])
        c = sum(poly) / len(poly)
        for k in range(len(poly)):
            o.tri(c, poly[k], poly[(k + 1) % len(poly)], mat, hint, dens * 0.6)


def tube(o, P0, P1, r, mat, n=8, dens=0.4, caps=(False, False)):
    """round tube from P0 to P1, shaded round"""
    P0, P1 = np.asarray(P0, float), np.asarray(P1, float)
    L = P1 - P0
    ln = float(np.linalg.norm(L))
    if ln < 1e-4: return
    z = L / ln
    x = np.cross(z, V(0, 0, 1)) if abs(z[2]) < 0.95 else np.cross(z, V(1, 0, 0))
    x /= np.linalg.norm(x); y = np.cross(z, x)
    ring = [x * math.cos(k * 2 * math.pi / n) + y * math.sin(k * 2 * math.pi / n) for k in range(n)]
    for k in range(n):
        a, b = ring[k], ring[(k + 1) % n]
        o.quad([P0 + a * r, P1 + a * r, P1 + b * r, P0 + b * r], mat, a + b, dens, vn=[a, a, b, b])
    for cap, P, h in ((caps[0], P0, -z), (caps[1], P1, z)):
        if cap:
            for k in range(1, n - 1):
                o.tri(P + ring[0] * r, P + ring[k] * r, P + ring[k + 1] * r, mat, h, dens * 0.5)


def slab(o, lo, hi, mat, faces='-x+x-y+y-z+z', dens=0.5):
    """the chosen faces of a box"""
    lo, hi = np.minimum(lo, hi), np.maximum(lo, hi)
    for ax in range(3):
        u, v = [(1, 2), (0, 2), (0, 1)][ax]
        for sg, w in ((-1, lo[ax]), (1, hi[ax])):
            if ('-+'[sg > 0] + 'xyz'[ax]) not in faces: continue
            pts = []
            for (uu, vv) in ((lo[u], lo[v]), (hi[u], lo[v]), (hi[u], hi[v]), (lo[u], hi[v])):
                p = [0, 0, 0]; p[ax] = w; p[u] = uu; p[v] = vv
                pts.append(p)
            h = [0, 0, 0]; h[ax] = sg
            o.quad(pts, mat, V(*h), dens)


# ------------------------------------------------------------------ profiles: (out from the wall, up)
SKIRT_TIMBER = [(0.02, 0.0), (0.02, 0.104), (0.017, 0.116), (0.012, 0.122), (0.012, 0.138), (0.006, 0.148), (0.0, 0.15)]
SKIRT_TILE = [(0.013, 0.0), (0.013, 0.138), (0.009, 0.147), (0.0, 0.15)]
SKIRT_COVE = [(0.05, 0.003), (0.03, 0.007), (0.017, 0.018), (0.009, 0.036), (0.007, 0.096), (0.0, 0.1)]
SKIRT_STONE = [(0.035, 0.0), (0.035, 0.2), (0.02, 0.23), (0.0, 0.235)]
DADO_RAIL = [(0.0, -0.036), (0.01, -0.032), (0.014, -0.014), (0.027, -0.008), (0.029, 0.006), (0.02, 0.016), (0.013, 0.03), (0.0, 0.036)]
# (out from the wall, down from the ceiling as a negative height)
CORNICE = [(0.0, -0.115), (0.012, -0.11), (0.018, -0.09), (0.03, -0.066), (0.052, -0.042), (0.078, -0.026), (0.1, -0.018), (0.108, -0.012), (0.112, 0.0)]
CEIL_ANGLE = [(0.0, -0.024), (0.022, -0.024), (0.022, 0.0)]
# (across the face from the opening's edge, out of the wall)
ARCHITRAVE = [(0.0, 0.0), (0.0, 0.014), (0.008, 0.018), (0.03, 0.019), (0.05, 0.023), (0.058, 0.027), (0.066, 0.027), (0.07, 0.022), (0.07, 0.0)]
ARCH_W = 0.07
LINING = 0.03
REVEAL = 0.008


def bar_section(d, w, ch=0.008):
    """a planed bar with its arrises taken off: d half depth (through the wall), w half width"""
    return [(-d + ch, -w), (d - ch, -w), (d, -w + ch), (d, w - ch), (d - ch, w), (-d + ch, w), (-d, w - ch), (-d, -w + ch), (-d + ch, -w)]


STYLE = {
    'ward': dict(tint='trim', dark='wood_top', stone='stone', cove=None),
    'store': dict(tint='trim', dark='wood_top', stone='stone', cove='plastic_black'),
}
CONC = ('dconc', 'wall_conc', 'hbrick_c', 'wall_dmg', 'tin', 'tin_in', 'brick_a', 'brick_b', 'brick_c')
TILED = ('wtile', 'sqtile')
PAPERED = ('wall_paper', 'panel', 'mwall', 'mwall2')


class Ctx:
    def __init__(s, m, solid, room_of, which, seed=11):
        s.m, s.solid, s.room_of, s.which = m, solid, room_of, which
        s.st = STYLE.get(which, STYLE['ward'])
        s.rng = random.Random(seed)
        s.o = Out()
        live = {id(b) for b in m.boxes}
        s.cas = [c for c in getattr(m, 'casings', ()) if c['boxes'] and all(id(b) in live for b in c['boxes'])]
        s.rails = [r for r in getattr(m, 'rails', ()) if r['boxes'] and all(id(b) in live for b in r['boxes'])]
        s.levels = sorted({round(r['a'][2], 3) for r in m.rooms})
        s.holes = {}

    # which wall a frame stands in: its middle plane and thickness
    def wall_at(s, c):
        ax = 1 if c['axis'] == 'x' else 0
        u = 1 - ax
        best = None
        for (pu, pz) in ((c['a'] - 0.04, c['z0'] + 0.4), (c['b'] + 0.04, c['z0'] + 0.4), ((c['a'] + c['b']) / 2, c['z1'] + 0.04), ((c['a'] + c['b']) / 2, c['z0'] - 0.05)):
            p = [0, 0, 0]; p[ax] = c['c']; p[u] = pu; p[2] = pz
            for b in s.m.boxes:
                if b.tag in WALL and all(b.a[i] - 1e-6 <= p[i] <= b.b[i] + 1e-6 for i in range(3)):
                    t = b.b[ax] - b.a[ax]
                    if 0.05 < t < 0.7 and (best is None or t < best[1]):
                        best = ((b.a[ax] + b.b[ax]) / 2, t)
            if best: break
        return best or (c['c'], 0.14)

    def in_opening(s, p):
        for c in s.cas:
            ax = 1 if c['axis'] == 'x' else 0
            u = 1 - ax
            if c['a'] - 1e-4 <= p[u] <= c['b'] + 1e-4 and c['z0'] - 0.01 <= p[2] <= c['z1'] + 0.01 and abs(p[ax] - c['cc']) <= c['T'] / 2 + 0.075:
                return True
        return False

    def style(s, r):
        w = r['wall']
        d = dict(skirt=None, cornice=None, dado=None)
        if w in TILED:
            d['skirt'] = (SKIRT_TILE, w)
        elif w == 'hbrick':
            d['skirt'] = (SKIRT_STONE, s.st['stone'])
        elif w in CONC:
            pass
        elif s.st['cove'] and w not in PAPERED:
            d['skirt'] = (SKIRT_COVE, s.st['cove'])
        else:
            d['skirt'] = (SKIRT_TIMBER, s.st['dark'] if w in PAPERED else s.st['tint'])
        if r['ceil'] == 'ceil_tile':
            d['cornice'] = (CEIL_ANGLE, s.st['tint'])
        elif r['ceil'] == 'ceil' and w not in CONC and w not in TILED and w != 'hbrick':
            d['cornice'] = (CORNICE, 'ceil')
        if r.get('dado'):
            d['dado'] = (DADO_RAIL, s.st['dark'] if r['dado'][0] == 'panel' else s.st['tint'], r['dado'][1])
        return d


def wall_runs(C, b, ax, sg, z, zf=None, d=0.04, ceil=False):
    """along one side of a wall box at height z: the stretches of it that stand free in a room.
    -> [(u0, u1, room, e0, e1)], e: 'corner' (the wall turns away: mitre out), 'jamb' (a cased opening), 'butt'"""
    u = 1 - ax
    w = b.a[ax] if sg < 0 else b.b[ax]
    u0, u1 = b.a[u], b.b[u]
    if u1 - u0 < 0.02: return []

    def at(t, dd=d, zz=z):
        p = [0, 0, 0]; p[ax] = w + sg * dd; p[u] = t; p[2] = zz
        return p

    def ok(t):
        p = at(t)
        if C.solid(p) or C.in_opening(p): return None
        r = C.room_of(p)
        if r is None: return None
        if ceil:
            q = at(t, zz=r['b'][2] + 0.06)
            if abs(r['b'][2] - (z + 0.06)) > 0.03 or not C.solid(q): return None
        else:
            if zf is not None and abs(r['a'][2] - zf) > 0.03: return None
            # a floor under it: not the edge of a stair well or a hole
            q = at(t, zz=r['a'][2] - 0.06)
            if not C.solid(q) and C.room_of(at(t, zz=r['a'][2] - 0.6)) is not None: return None
        return r['name']

    step = 0.05
    n = max(1, int(math.ceil((u1 - u0) / step)))
    ts = [u0 + 0.004] + [u0 + (u1 - u0) * i / n for i in range(1, n)] + [u1 - 0.004]
    vals = [ok(t) for t in ts]
    runs = []
    i = 0
    while i < len(ts):
        if vals[i] is None:
            i += 1; continue
        j = i
        while j + 1 < len(ts) and vals[j + 1] == vals[i]: j += 1
        # the ends, found to a millimetre
        def edge(t_in, t_out):
            for _ in range(7):
                mid = (t_in + t_out) / 2
                if ok(mid) == vals[i]: t_in = mid
                else: t_out = mid
            return t_in
        a = u0 if i == 0 else edge(ts[i], ts[i - 1])
        c = u1 if j == len(ts) - 1 else edge(ts[j], ts[j + 1])
        ends = []
        for (t, sgn, onedge) in ((a, -1, i == 0), (c, 1, j == len(ts) - 1)):
            kind = 'butt'
            if onedge:
                front = at(t + sgn * 0.03)
                behind = at(t + sgn * 0.03, dd=-0.03)
                if C.in_opening(front) or C.in_opening(behind): kind = 'jamb'
                elif not C.solid(behind) and not C.solid(front): kind = 'corner'
                elif C.solid(behind) and not C.solid(front): kind = 'on'
            ends.append(kind)
        if c - a > 0.03:
            runs.append((a, c, vals[i], ends[0], ends[1]))
        i = j + 1
    return runs


def trims(C):
    o = C.o
    rooms = {r['name']: r for r in C.m.rooms}
    tops = sorted({round(r['b'][2], 3) for r in C.m.rooms})
    for b in C.m.boxes:
        if b.tag not in WALL or not b.collide: continue
        if b.b[2] - b.a[2] < 0.12: continue
        for ax in (0, 1):
            u = 1 - ax
            A0 = V(0, 0, 0)
            for sg in (-1, 1):
                A = V(*[sg if i == ax else 0 for i in range(3)])
                w = b.a[ax] if sg < 0 else b.b[ax]

                def run(prof, mat, z, a, c, e0, e1, dens=0.5):
                    P0 = [0, 0, 0]; P0[ax] = w; P0[u] = a; P0[2] = z
                    P1 = list(P0); P1[u] = c
                    dmax = max(p[0] for p in prof)
                    m = []
                    caps = []
                    for e in (e0, e1):
                        m.append(1.0 if e == 'corner' else 0.0)
                        caps.append(e == 'jamb' and dmax > 0.023)
                    sweep(o, P0, P1, A, V(0, 0, 1), prof, mat, m[0], m[1], dens, caps[0], caps[1])

                for zf in C.levels:
                    if not (b.a[2] <= zf + 0.02 and b.b[2] >= zf + 0.24): continue
                    for (a, c, rn, e0, e1) in wall_runs(C, b, ax, sg, zf + 0.07, zf):
                        r = rooms[rn]; st = C.style(r)
                        if st['skirt']:
                            prof, mat = st['skirt']
                            # at a cased doorway the board stops against the outer edge of the architrave
                            a2 = a + (ARCH_W - LINING + REVEAL) if e0 == 'jamb' else a
                            c2 = c - (ARCH_W - LINING + REVEAL) if e1 == 'jamb' else c
                            if c2 - a2 > 0.02:
                                run(prof, mat, zf, a2, c2, e0, e1)
                                o.count['skirting m'] = o.count.get('skirting m', 0) + (c2 - a2)
                    for dh in sorted({r['dado'][1] for r in C.m.rooms if r.get('dado') and abs(r['a'][2] - zf) < 0.03}):
                        if not (b.b[2] >= zf + dh + 0.05 and b.a[2] <= zf + dh - 0.05): continue
                        for (a3, c3, rn3, f0, f1) in wall_runs(C, b, ax, sg, zf + dh, None):
                            r = rooms[rn3]
                            if not r.get('dado') or r['dado'][1] != dh or abs(r['a'][2] - zf) > 0.03: continue
                            prof, mat, _ = C.style(r)['dado']
                            P0 = [0, 0, 0]; P0[ax] = w; P0[u] = a3; P0[2] = zf + dh
                            P1 = list(P0); P1[u] = c3
                            sweep(o, P0, P1, A, V(0, 0, 1), prof, mat, 1.0 if f0 == 'corner' else 0.0, 1.0 if f1 == 'corner' else 0.0, 0.5)
                            o._n('dado rail runs')
                for zc in tops:
                    if not (b.a[2] <= zc - 0.13 and b.b[2] >= zc - 0.02): continue
                    for (a, c, rn, e0, e1) in wall_runs(C, b, ax, sg, zc - 0.06, None, ceil=True):
                        r = rooms[rn]; st = C.style(r)
                        if not st['cornice']: continue
                        prof, mat = st['cornice']
                        P0 = [0, 0, 0]; P0[ax] = w; P0[u] = a; P0[2] = zc
                        P1 = list(P0); P1[u] = c
                        sweep(o, P0, P1, A, V(0, 0, 1), prof, mat, 1.0 if e0 == 'corner' else 0.0, 1.0 if e1 == 'corner' else 0.0, 0.5, ref=(-0.02, 0.02))
                        o._n('cornice runs')


def frames(C):
    """door linings and architraves, window joinery, hatches"""
    o = C.o
    for c in C.cas:
        ax = 1 if c['axis'] == 'x' else 0
        u = 1 - ax
        cc, T = c['cc'], c['T']
        a, b, z0, z1 = c['a'], c['b'], c['z0'], c['z1']
        mat = c.get('mat', 'trim')
        if mat not in ('trim', 'shopframe'): mat = 'trim'
        N = V(*[1 if i == ax else 0 for i in range(3)])
        U = V(*[1 if i == u else 0 for i in range(3)])
        Z = V(0, 0, 1)

        def P(along, across, z):
            p = [0, 0, 0]; p[u] = along; p[ax] = across; p[2] = z
            return V(*p)

        def lo_hi(a0, a1, c0, c1, h0, h1):
            return P(a0, c0, h0), P(a1, c1, h1)
        if c['kind'] == 'window':
            D, W = 0.034, 0.026
            sec = bar_section(D, W)
            thin = bar_section(D - 0.006, 0.019, 0.006)
            # the frame: jambs, head, a deeper bottom rail
            for al in (a + W, b - W):
                sweep(o, P(al, cc, z0), P(al, cc, z1), N, U, sec, mat, dens=0.4, closed=True)
            sweep(o, P(a, cc, z1 - W), P(b, cc, z1 - W), N, Z, sec, mat, dens=0.4, closed=True)
            sweep(o, P(a, cc, z0 + 0.034), P(b, cc, z0 + 0.034), N, Z, bar_section(D + 0.008, 0.034), mat, dens=0.4, closed=True)
            sweep(o, P(c['mull'], cc, z0 + 0.06), P(c['mull'], cc, z1 - 2 * W), N, U, thin, mat, dens=0.4, closed=True)
            sweep(o, P(a + 2 * W, cc, c['transom']), P(b - 2 * W, cc, c['transom']), N, Z, thin, mat, dens=0.4, closed=True)
            # small panes in the top lights, as these old sashes had
            if b - a > 1.0:
                for k in (1, 2):
                    for (x0, x1) in ((a + 2 * W, c['mull']), (c['mull'], b - 2 * W)):
                        xx = x0 + (x1 - x0) * k / 3
                        sweep(o, P(xx, cc, c['transom']), P(xx, cc, z1 - 2 * W), N, U, bar_section(0.02, 0.009, 0.004), mat, dens=0.3, closed=True)
            # a window board on any side that is a room
            for sg in (-1, 1):
                if C.room_of(P(a + 0.3, cc + sg * (T / 2 + 0.15), z0 - 0.2).tolist()) is None: continue
                reach = T / 2 - D
                prof = [(-reach, 0.016), (0.03, 0.016), (0.042, 0.01), (0.046, 0.0), (0.042, -0.012), (0.03, -0.018), (0.0, -0.018)]
                sweep(o, P(a - 0.05, cc + sg * T / 2, z0), P(b + 0.05, cc + sg * T / 2, z0), N * sg, Z, prof, mat, dens=0.5, cap0=True, cap1=True, ref=(-0.01, -0.005))
                # and the little moulding under it
                sweep(o, P(a - 0.03, cc + sg * T / 2, z0 - 0.018), P(b + 0.03, cc + sg * T / 2, z0 - 0.018), N * sg, Z, [(0.0, -0.03), (0.008, -0.026), (0.012, -0.01), (0.02, 0.0)], mat, dens=0.4, cap0=True, cap1=True)
            o._n('windows')
            continue
        tl = LINING
        hatch = c['kind'] == 'hatch'
        # linings: boards through the thickness of the wall, proud of both faces by a hair
        e = T / 2 + 0.004
        slab(o, *lo_hi(a, a + tl, cc - e, cc + e, z0, z1), mat, '+' + 'xyz'[u] + '-' + 'xyz'[ax] + '+' + 'xyz'[ax])
        slab(o, *lo_hi(b - tl, b, cc - e, cc + e, z0, z1), mat, '-' + 'xyz'[u] + '-' + 'xyz'[ax] + '+' + 'xyz'[ax])
        slab(o, *lo_hi(a + tl, b - tl, cc - e, cc + e, z1 - tl, z1), mat, '-z' + '-' + 'xyz'[ax] + '+' + 'xyz'[ax])
        if hatch:
            slab(o, *lo_hi(a + tl, b - tl, cc - e - 0.03, cc + e + 0.03, z0, z0 + tl), mat, '+z' + '-' + 'xyz'[ax] + '+' + 'xyz'[ax] + '-z')
        else:
            # the stop the door shut against
            st = 0.012
            slab(o, *lo_hi(a + tl, a + tl + st, cc - 0.02, cc + 0.02, z0, z1 - tl), mat, '+' + 'xyz'[u] + '-' + 'xyz'[ax] + '+' + 'xyz'[ax], dens=0.3)
            slab(o, *lo_hi(b - tl - st, b - tl, cc - 0.02, cc + 0.02, z0, z1 - tl), mat, '-' + 'xyz'[u] + '-' + 'xyz'[ax] + '+' + 'xyz'[ax], dens=0.3)
            slab(o, *lo_hi(a + tl, b - tl, cc - 0.02, cc + 0.02, z1 - tl - st, z1 - tl), mat, '-z' + '-' + 'xyz'[ax] + '+' + 'xyz'[ax], dens=0.3)
            # hinges: three leaves on one jamb, the knuckle standing proud
            side = a + tl if C.rng.random() < 0.5 else b - tl
            sgn = 1 if side == a + tl else -1
            for hz in (z0 + 0.22, z0 + (z1 - z0) * 0.5, z1 - 0.26):
                slab(o, *lo_hi(side, side + sgn * 0.003, cc + 0.022, cc + 0.06, hz - 0.05, hz + 0.05), 'steel', ('+' if sgn > 0 else '-') + 'xyz'[u] + '+z-z', dens=0.25)
            # and a strip across the floor, if there is one
            if C.solid(P((a + b) / 2, cc, z0 - 0.05).tolist()) and b - a < 3.2:
                prof = [(-T / 2 - 0.03, 0.0), (-T / 2 - 0.012, 0.007), (T / 2 + 0.012, 0.007), (T / 2 + 0.03, 0.0)]
                sweep(o, P(a + tl, cc, z0), P(b - tl, cc, z0), N, Z, prof, 'steel', dens=0.4, ref=(0, -0.02))
        # architraves on both faces, mitred at the corners
        ia, ib = a + tl - REVEAL, b - tl + REVEAL
        zt = z1 - tl + REVEAL
        zb = z0 + tl - REVEAL
        for sg in (-1, 1):
            face = cc + sg * T / 2
            if C.solid(P(a - 0.02, face + sg * 0.01, (z0 + z1) / 2).tolist()) and C.solid(P(b + 0.02, face + sg * 0.01, (z0 + z1) / 2).tolist()):
                continue        # that face is buried in something
            Nn = N * sg
            if hatch:
                sweep(o, P(ia, face, zb), P(ia, face, zt), -U, Nn, ARCHITRAVE, mat, 1.0, 1.0, 0.5, ref=(0.035, -0.02))
                sweep(o, P(ib, face, zb), P(ib, face, zt), U, Nn, ARCHITRAVE, mat, 1.0, 1.0, 0.5, ref=(0.035, -0.02))
                sweep(o, P(ia, face, zt), P(ib, face, zt), Z, Nn, ARCHITRAVE, mat, 1.0, 1.0, 0.5, ref=(0.035, -0.02))
                # a shelf of a sill: deeper, bullnosed, with horns past the legs
                prof = [(-0.004, 0.0), (0.05, 0.0), (0.062, -0.008), (0.066, -0.019), (0.062, -0.03), (0.05, -0.038), (0.0, -0.038)]
                sweep(o, P(ia - ARCH_W - 0.03, face, zb), P(ib + ARCH_W + 0.03, face, zb), Nn, Z, prof, mat, dens=0.5, cap0=True, cap1=True, ref=(0.0, -0.02))
            else:
                sweep(o, P(ia, face, z0), P(ia, face, zt), -U, Nn, ARCHITRAVE, mat, 0.0, 1.0, 0.5, ref=(0.035, -0.02))
                sweep(o, P(ib, face, z0), P(ib, face, zt), U, Nn, ARCHITRAVE, mat, 0.0, 1.0, 0.5, ref=(0.035, -0.02))
                sweep(o, P(ia, face, zt), P(ib, face, zt), Z, Nn, ARCHITRAVE, mat, 1.0, 1.0, 0.5, ref=(0.035, -0.02))
        o._n('hatches' if hatch else 'door frames')


def rails(C):
    """pipe rails: round tube, posts on base plates, the top rail through"""
    o = C.o
    for r in C.rails:
        ax = 1 if r['axis'] == 'x' else 0
        u = 1 - ax

        def P(along, z, off=0.0):
            p = [0, 0, 0]; p[u] = along; p[ax] = r['c'] + off; p[2] = z
            return V(*p)
        mat = r['mat']
        z, h = r['z'], r['h']
        for i in range(r['n'] + 1):
            p = r['p0'] + (r['p1'] - r['p0']) * i / r['n']
            tube(o, P(p, z), P(p, z + h), 0.021, mat, 8, 0.4)
            lo, hi = P(p - 0.05, z, -0.05), P(p + 0.05, z + 0.008, 0.05)
            slab(o, lo, hi, mat, '-x+x-y+y+z', dens=0.3)
        tube(o, P(r['p0'] - 0.03, z + h), P(r['p1'] + 0.03, z + h), 0.024, mat, 8, 0.4, caps=(True, True))
        tube(o, P(r['p0'], z + h * 0.55), P(r['p1'], z + h * 0.55), 0.016, mat, 6, 0.4)
        o._n('rails')


def nosings(C):
    """the edge of every tread"""
    o = C.o
    steps = [b for b in C.m.boxes if b.tag == 'step']
    prof = [(0.0, -0.034), (0.011, -0.034), (0.016, -0.026), (0.016, 0.003), (0.012, 0.007), (-0.055, 0.007), (-0.06, 0.0)]
    for b in steps:
        top = b.b[2]
        for ax in (0, 1):
            u = 1 - ax
            for sg in (-1, 1):
                w = b.a[ax] if sg < 0 else b.b[ax]
                # a riser: just outside it, a little under the tread, there is air, and a step down
                def at(t, dd, zz):
                    p = [0, 0, 0]; p[ax] = w + sg * dd; p[u] = t; p[2] = zz
                    return p
                mid = (b.a[u] + b.b[u]) / 2
                if b.b[u] - b.a[u] < 0.5: continue
                if C.solid(at(mid, 0.04, top - 0.03)): continue
                # what is under the air in front: a lower tread within a step's height
                if not any(C.solid(at(mid, 0.06, top - k)) for k in (0.1, 0.16, 0.22, 0.28)): continue
                # not the open side of a flight: the tread behind this edge must run back from it
                if (b.b[ax] - b.a[ax]) < 0.18: continue
                A = V(*[sg if i == ax else 0 for i in range(3)])
                P0 = V(*at(b.a[u], 0.0, top)); P1 = V(*at(b.b[u], 0.0, top))
                sweep(o, P0, P1, A, V(0, 0, 1), prof, 'steelstep', dens=0.4, ref=(-0.01, -0.02))
                o._n('stair nosings')


# ------------------------------------------------------------------ ceilings: tiles gone
CELL = 0.6


def plan_holes(C):
    """which tiles of each suspended ceiling are missing. Holes are whole tiles of the 600 mm grid the scan is drawn on."""
    m, rng = C.m, C.rng
    lights = [(L['pos'][0], L['pos'][1], L['pos'][2]) for L in m.lights]
    hung = [(u['pos'][0], u['pos'][1], u['pos'][2]) for u in m.units if u['kit'] == 'ward' and u['parts'][0].startswith('tile')]
    for r in m.rooms:
        if r['ceil'] != 'ceil_tile': continue
        zc = r['b'][2]
        i0, i1 = math.ceil((r['a'][0] + 0.25) / CELL), math.floor((r['b'][0] - 0.25) / CELL)
        j0, j1 = math.ceil((r['a'][1] + 0.25) / CELL), math.floor((r['b'][1] - 0.25) / CELL)
        if i1 - i0 < 2 or j1 - j0 < 2: continue
        taken = set()

        def free(i, j):
            if not (i0 <= i < i1 and j0 <= j < j1) or (i, j) in taken: return False
            cx, cy = (i + 0.5) * CELL, (j + 0.5) * CELL
            if C.solid([cx, cy, zc - 0.05]) or not C.solid([cx, cy, zc + 0.05]): return False
            if C.room_of([cx, cy, zc - 0.3]) is not r: return False
            for (lx, ly, lz) in lights:
                if abs(lz - zc) < 0.8 and abs(lx - cx) < 1.0 and abs(ly - cy) < 1.0: return False
            return True
        out = []

        def take(i, j, ni, nj):
            cells = [(i + a, j + b) for a in range(ni) for b in range(nj)]
            if not all(free(*c) for c in cells): return False
            # not touching another hole: a strip of ceiling between
            for (a, b) in cells:
                for (da, db) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    if (a + da, b + db) in taken: return False
            taken.update(cells)
            out.append((i * CELL, j * CELL, (i + ni) * CELL, (j + nj) * CELL, zc))
            return True
        for (hx, hy, hz) in hung:
            if abs(hz - zc) < 0.3 and r['a'][0] < hx < r['b'][0] and r['a'][1] < hy < r['b'][1]:
                take(math.floor(hx / CELL), math.floor(hy / CELL), 1, 1)
        area = (r['b'][0] - r['a'][0]) * (r['b'][1] - r['a'][1])
        for _ in range(int(area * 0.05) + 1):
            ni, nj = rng.choice(((1, 1), (1, 1), (1, 1), (2, 1), (1, 2), (2, 1), (2, 2), (3, 2), (1, 3)))
            take(rng.randint(i0, i1 - 1), rng.randint(j0, j1 - 1), ni, nj)
        if out: C.holes[r['name']] = out


def cut_ceiling(C, r, rect, thick):
    """a ceiling face (x0, x1, y0, y1) less the holes that fall in it -> the pieces left. Marks the holes as real."""
    hs = C.holes.get(r['name']) if r is not None else None
    if not hs or thick < 0.12: return [rect]
    x0, x1, y0, y1 = rect
    inside = [h for h in hs if h[0] >= x0 - 1e-6 and h[2] <= x1 + 1e-6 and h[1] >= y0 - 1e-6 and h[3] <= y1 + 1e-6]
    if not inside: return [rect]
    for h in inside:
        C.cut.add(h)
        C.depth[h] = min(0.2, thick - 0.04)
    xs = sorted({x0, x1, *[v for h in inside for v in (h[0], h[2])]})
    ys = sorted({y0, y1, *[v for h in inside for v in (h[1], h[3])]})

    def holed(cx, cy):
        return any(h[0] < cx < h[2] and h[1] < cy < h[3] for h in inside)
    out = []
    # rows of the cut grid, runs of solid ceiling joined along x, then equal runs joined up the rows
    rows = []
    for j in range(len(ys) - 1):
        row = []
        i = 0
        while i < len(xs) - 1:
            if holed((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2):
                i += 1; continue
            k = i
            while k + 1 < len(xs) - 1 and not holed((xs[k + 1] + xs[k + 2]) / 2, (ys[j] + ys[j + 1]) / 2): k += 1
            row.append((xs[i], xs[k + 1]))
            i = k + 1
        rows.append(row)
    open_ = {}
    for j, row in enumerate(rows):
        nxt = {}
        for span in row:
            if span in open_:
                nxt[span] = open_.pop(span)
            else:
                nxt[span] = ys[j]
        for span, ya in open_.items():
            out.append((span[0], span[1], ya, ys[j]))
        open_ = nxt
    for span, ya in open_.items():
        out.append((span[0], span[1], ya, ys[-1]))
    return out


def voids(C):
    """behind each missing tile: the dark above, the slab, the grid still crossing, a run of pipe or conduit"""
    o, rng = C.o, C.rng
    for h in sorted(C.cut):
        x0, y0, x1, y1, zc = h
        d = C.depth[h]
        up = V(0, 0, 1)
        o.quad([(x0, y0, zc + d), (x1, y0, zc + d), (x1, y1, zc + d), (x0, y1, zc + d)], 'void', -up, 0.35)
        o.quad([(x0, y0, zc), (x1, y0, zc), (x1, y0, zc + d), (x0, y0, zc + d)], 'void', V(0, 1, 0), 0.35)
        o.quad([(x0, y1, zc), (x1, y1, zc), (x1, y1, zc + d), (x0, y1, zc + d)], 'void', V(0, -1, 0), 0.35)
        o.quad([(x0, y0, zc), (x0, y1, zc), (x0, y1, zc + d), (x0, y0, zc + d)], 'void', V(1, 0, 0), 0.35)
        o.quad([(x1, y0, zc), (x1, y1, zc), (x1, y1, zc + d), (x1, y0, zc + d)], 'void', V(-1, 0, 0), 0.35)
        # the grid: a T on every line of the hole, its flange down, its web up into the dark
        fl, web = 0.012, 0.03

        def tee(a, b):
            a, b = V(*a), V(*b)
            L = b - a; L /= np.linalg.norm(L)
            S = np.cross(L, up)
            prof = [(-fl, 0.0), (fl, 0.0), (fl, 0.004), (0.001, 0.004), (0.001, web), (-0.001, web), (-0.001, 0.004), (-fl, 0.004), (-fl, 0.0)]
            sweep(o, a, b, S, up, prof, 'trim', dens=0.3, closed=True, smooth=False)
        ni, nj = round((x1 - x0) / CELL), round((y1 - y0) / CELL)
        for i in range(ni + 1):
            xx = x0 + i * CELL
            xx = min(max(xx, x0 + fl), x1 - fl) if i in (0, ni) else xx
            tee((xx, y0, zc), (xx, y1, zc))
        for j in range(nj + 1):
            yy = y0 + j * CELL
            yy = min(max(yy, y0 + fl), y1 - fl) if j in (0, nj) else yy
            tee((x0, yy, zc), (x1, yy, zc))
        # hangers
        for _ in range(ni * nj):
            hx, hy = x0 + rng.choice(range(ni + 1)) * CELL, rng.uniform(y0 + 0.1, y1 - 0.1)
            hx = min(max(hx, x0 + 0.004), x1 - 0.004)
            tube(o, (hx, hy, zc + web), (hx, hy, zc + d), 0.0025, 'steel', 4, 0.2)
        # services through the void
        if d > 0.12:
            kind = rng.random()
            along_x = rng.random() < 0.5
            zz = zc + d * rng.uniform(0.5, 0.72)
            if kind < 0.75:
                rr = rng.choice((0.018, 0.027, 0.04))
                t = rng.uniform(0.2, 0.8)
                if along_x: tube(o, (x0, y0 + (y1 - y0) * t, zz), (x1, y0 + (y1 - y0) * t, zz), rr, 'ruststeel' if rr > 0.02 else 'steel', 8, 0.3)
                else: tube(o, (x0 + (x1 - x0) * t, y0, zz), (x0 + (x1 - x0) * t, y1, zz), rr, 'ruststeel' if rr > 0.02 else 'steel', 8, 0.3)
            if kind > 0.4:
                # a tray of cable
                t = rng.uniform(0.25, 0.75)
                for k in range(3):
                    off = (k - 1) * 0.022
                    if along_x: tube(o, (x0, y0 + (y1 - y0) * t + off, zc + d - 0.03), (x1, y0 + (y1 - y0) * t + off, zc + d - 0.03), 0.008, 'plastic_black', 5, 0.2)
                    else: tube(o, (x0 + (x1 - x0) * t + off, y0, zc + d - 0.03), (x0 + (x1 - x0) * t + off, y1, zc + d - 0.03), 0.008, 'plastic_black', 5, 0.2)
        o._n('ceiling holes')


def prepare(m, solid, room_of, which):
    """before the faces are made: takes the stand-in boxes out of the map and plans the holes in the ceilings"""
    C = Ctx(m, solid, room_of, which)
    for c in C.cas:
        c['cc'], c['T'] = C.wall_at(c)
    drop = {id(b) for c in C.cas for b in c['boxes']} | {id(b) for r in C.rails for b in r['boxes']}
    m.boxes = [b for b in m.boxes if id(b) not in drop]
    C.cut, C.depth = set(), {}
    plan_holes(C)
    return C


def detail(C):
    """after the faces: everything modelled, as quads for the second lightmap"""
    trims(C)
    frames(C)
    rails(C)
    nosings(C)
    voids(C)
    steel(C)
    services(C)
    return C.o.q, C.o.count


# ------------------------------------------------------------------ structure: what holds the building up, and what runs through it
def _inside(boxes, p):
    for b in boxes:
        if b.a[0] < p[0] < b.b[0] and b.a[1] < p[1] < b.b[1] and b.a[2] < p[2] < b.b[2]:
            return True
    return False


def structure(m, which, seed=5):
    """Before anything else is worked out: piers and beams down the corridors (real boxes: they take the room's finish, the
    skirting goes round them, they stop a body), and where the steel stands in the big sheds (kept for detail())."""
    rng = random.Random(seed)
    solid = [b for b in m.boxes if b.collide]
    m.steel = []
    for r in list(m.rooms):
        x0, y0, z0 = r['a']; x1, y1, z1 = r['b']
        lx, ly = x1 - x0, y1 - y0
        name = r['name']
        corridor = ('cor' in name and not name.startswith(('acor', 'gcor'))) and max(lx, ly) > 3 * min(lx, ly) and r['ceil'] != 'tin_in'
        if corridor and z1 - z0 < 4.2:
            ax = 0 if lx > ly else 1           # runs along
            u = 1 - ax
            lo, hi = r['a'][ax], r['b'][ax]
            w0, w1 = r['a'][u], r['b'][u]
            n = max(1, int(round((hi - lo) / 4.2)))
            for k in range(n + 1):
                p = lo + (hi - lo) * k / n
                p = min(max(p, lo + 0.4), hi - 0.4)
                # walls both sides, the whole height, and for a hand's width either way along
                ok = True
                for dp in (-0.3, 0.0, 0.3):
                    for zz in (0.3, 1.2, 2.1):
                        for (wv, sg) in ((w0, -1), (w1, 1)):
                            q = [0, 0, 0]; q[ax] = p + dp; q[u] = wv + sg * 0.05; q[2] = z0 + zz
                            if not _inside(solid, q): ok = False
                            q[u] = wv - sg * 0.12
                            if _inside(solid, q): ok = False
                if not ok: continue
                dpt, wid = 0.075, 0.34
                for (wv, sg) in ((w0, 1), (w1, -1)):
                    a = [0, 0, 0]; c = [0, 0, 0]
                    a[ax], c[ax] = p - wid / 2, p + wid / 2
                    a[u], c[u] = (wv, wv + dpt) if sg > 0 else (wv - dpt, wv)
                    a[2], c[2] = z0, z1
                    m.box(tuple(a), tuple(c), 'wall_int', tag='int', pen=True, density=0.5)
                a = [0, 0, 0]; c = [0, 0, 0]
                a[ax], c[ax] = p - wid / 2, p + wid / 2
                a[u], c[u] = w0 + dpt, w1 - dpt
                a[2], c[2] = z1 - 0.2, z1
                m.box(tuple(a), tuple(c), 'trim', collide=False, density=0.4)
        if r['ceil'] == 'tin_in' and min(lx, ly) > 7 and which == 'store':
            # a shed: a column against the wall every six metres or so, girts between them
            big = ('gondola', 'endcap', 'freezer', 'coffin', 'producebin', 'rack', 'checkout', 'hooks', 'strips', 'lockers', 'vending', 'sink', 'cardstack', 'promo', 'radiator', 'liftdoor')
            busy = [(u_['pos'][0], u_['pos'][1]) for u_ in m.units if u_['parts'][0].split('_')[0] in big] + [(p_['pos'][0], p_['pos'][1]) for p_ in m.props if not p_['loose'] and p_['collide'] is not False]
            for (ax, wv, sg) in ((1, y0, 1), (1, y1, -1), (0, x0, 1), (0, x1, -1)):
                u = 1 - ax                # along the wall
                lo, hi = r['a'][u], r['b'][u]
                n = max(1, int(round((hi - lo) / 6.0)))
                cols = []
                for k in range(n + 1):
                    p = lo + (hi - lo) * k / n
                    p = min(max(p, lo + 0.25), hi - 0.25)
                    q = [0, 0, 0]; q[u] = p; q[ax] = wv - sg * 0.08
                    ok = all(_inside(solid, [q[0], q[1], z0 + zz]) for zz in (0.4, 1.5, 2.6))
                    q[ax] = wv + sg * 0.12
                    ok = ok and not any(_inside(solid, [q[0], q[1], z0 + zz]) for zz in (0.4, 1.5, 2.6))
                    if ok and any(math.hypot(bx - q[0], by - q[1]) < 0.75 for bx, by in busy): ok = False
                    if ok:
                        cols.append(p)
                        a = [0, 0, 0]; c = [0, 0, 0]
                        a[u], c[u] = p - 0.1, p + 0.1
                        a[ax], c[ax] = (wv, wv + 0.2) if sg > 0 else (wv - 0.2, wv)
                        a[2], c[2] = z0, z0 + 2.2
                        m.invisible(tuple(a), tuple(c), pen=False)
                m.steel.append(dict(ax=ax, w=wv, sg=sg, cols=cols, z0=z0, z1=z1, lo=lo, hi=hi, room=name))


def hsection(o, base, up, N, U, d, w, mat, dens=0.4):
    """a rolled column: two flanges and a web. base: its foot at the wall; N out from the wall, U along it; d deep, w wide"""
    base, up, N, U = (np.asarray(v, float) for v in (base, up, N, U))
    tf, tw = 0.012, 0.008
    top = base + up
    for (n0, n1) in ((0.0, tf), (d - tf, d)):
        lo = base + N * n0 - U * (w / 2); hi = top + N * n1 + U * (w / 2)
        slab(o, lo, hi, mat, '-x+x-y+y', dens)
    lo = base + N * tf - U * (tw / 2); hi = top + N * (d - tf) + U * (tw / 2)
    slab(o, lo, hi, mat, '-x+x-y+y', dens)


def steel(C):
    o, rng = C.o, C.rng
    for s in getattr(C.m, 'steel', ()):
        ax, u = s['ax'], 1 - s['ax']
        N = V(*[s['sg'] if i == ax else 0 for i in range(3)])
        U = V(*[1 if i == u else 0 for i in range(3)])
        h = s['z1'] - s['z0'] - 0.75

        def P(along, out, z):
            p = [0, 0, 0]; p[u] = along; p[ax] = s['w'] + s['sg'] * out; p[2] = s['z0'] + z
            return V(*p)
        for p in s['cols']:
            hsection(o, P(p, 0.0, 0), V(0, 0, h), N, U, 0.2, 0.2, 'ruststeel')
            # base plate and its four bolts
            slab(o, P(p - 0.16, 0.0, 0), P(p + 0.16, 0.3, 0.016), 'ruststeel', '-x+x-y+y+z', 0.3)
            for (da, dn) in ((-0.12, 0.05), (0.12, 0.05), (-0.12, 0.26), (0.12, 0.26)):
                tube(o, P(p + da, dn, 0.016), P(p + da, dn, 0.045), 0.012, 'steel', 6, 0.2, caps=(False, True))
            # a yellow guard up to the knee where the trolleys hit it
            slab(o, P(p - 0.115, 0.0, 0.016), P(p + 0.115, 0.215, 1.1), 'paint_y', '-x+x-y+y+z', 0.4)
            o._n('steel columns')
        # girts: a channel along the wall between columns, at two heights
        cs = s['cols']
        for a, c in zip(cs, cs[1:]):
            if c - a > 7.5: continue
            for zz in (2.5, 4.3):
                if zz > h - 0.3: continue
                sweep(o, P(a + 0.1, 0.0, zz), P(c - 0.1, 0.0, zz), N, V(0, 0, 1), [(0.0, -0.075), (0.06, -0.075), (0.06, -0.066), (0.008, -0.066), (0.008, 0.066), (0.06, 0.066), (0.06, 0.075), (0.0, 0.075)], 'ruststeel', dens=0.35, ref=(0.02, 0.0), smooth=False)
            # wind bracing in the odd bay: two rods crossed, a turnbuckle on each
            if rng.random() < 0.3 and h > 3.5:
                tube(o, P(a + 0.1, 0.1, 0.3), P(c - 0.1, 0.1, min(h - 0.2, 4.2)), 0.011, 'ruststeel', 6, 0.3)
                tube(o, P(a + 0.1, 0.13, min(h - 0.2, 4.2)), P(c - 0.1, 0.13, 0.3), 0.011, 'ruststeel', 6, 0.3)
                o._n('braced bays')


def line_free(C, P0, P1, step=0.12):
    """the stretches of the line P0..P1 that are in the clear"""
    P0, P1 = np.asarray(P0, float), np.asarray(P1, float)
    L = float(np.linalg.norm(P1 - P0))
    if L < 0.3: return []
    n = max(2, int(L / step))
    ok = [not C.solid((P0 + (P1 - P0) * (i / n)).tolist()) for i in range(n + 1)]
    out = []
    i = 0
    while i <= n:
        if not ok[i]:
            i += 1; continue
        j = i
        while j + 1 <= n and ok[j + 1]: j += 1
        if (j - i) * L / n > 0.5:
            out.append((P0 + (P1 - P0) * (i / n), P0 + (P1 - P0) * (j / n)))
        i = j + 1
    return out


def services(C):
    """pipes and trays under the ceilings of the rooms nobody dressed: the tunnel, the plant, the stores"""
    o, rng = C.o, C.rng
    for r in C.m.rooms:
        if r['wall'] not in CONC or r['ceil'] in ('ceil_tile', 'tin_in'): continue
        x0, y0, z0 = r['a']; x1, y1, z1 = r['b']
        if z1 - z0 > 4.5 or z1 - z0 < 2.2: continue
        lx, ly = x1 - x0, y1 - y0
        if max(lx, ly) < 4.0 or r['name'].startswith('stair'): continue
        ax = 0 if lx > ly else 1
        u = 1 - ax
        lo, hi = r['a'][ax] + 0.06, r['b'][ax] - 0.06
        side = rng.choice((0, 1))
        wv = (r['a'][u] + 0.34) if side == 0 else (r['b'][u] - 0.34)
        sg = 1 if side == 0 else -1

        def P(along, off, z):
            p = [0, 0, 0]; p[ax] = along; p[u] = wv + sg * off; p[2] = z
            return V(*p)
        zc = z1
        if not C.solid(P((lo + hi) / 2, 0, zc + 0.08).tolist()): continue
        runs = [(0.0, 0.058, 'sheet'), (0.15, 0.034, 'ruststeel'), (0.26, 0.02, 'paint_r')][:rng.choice((2, 3, 3))]
        zp = zc - 0.2
        for (off, rr, mat) in runs:
            for (a, c) in line_free(C, P(lo, off, zp), P(hi, off, zp)):
                tube(o, a, c, rr, mat, 8, 0.4, caps=(True, True))
                L = float(np.linalg.norm(c - a))
                d = (c - a) / L
                # a collar at every joint
                k = 1.5
                while k < L - 0.3:
                    tube(o, a + d * (k - 0.03), a + d * (k + 0.03), rr + 0.01, 'ruststeel' if mat != 'paint_r' else mat, 8, 0.3, caps=(True, True))
                    k += 3.0
                o._n('pipe runs')
        # the trapeze every metre and a half: two rods and a bar
        k = lo + 0.5
        wmax = runs[-1][0] + 0.08
        while k < hi - 0.2:
            if not C.solid(P(k, 0, zp).tolist()) and C.solid(P(k, 0, zc + 0.05).tolist()):
                for off in (-0.1, wmax):
                    tube(o, P(k, off, zp - 0.07), P(k, off, zc), 0.004, 'steel', 4, 0.2)
                slab(o, P(k - 0.02, -0.12, zp - 0.09), P(k + 0.02, wmax + 0.02, zp - 0.065), 'steel', '-x+x-y+y-z+z', 0.3)
            k += 1.5
        # a cable tray down the other side, three or four cables in it
        if min(lx, ly) > 1.9:
            tv = (r['b'][u] - 0.3) if side == 0 else (r['a'][u] + 0.3)

            def T(along, off, z):
                p = [0, 0, 0]; p[ax] = along; p[u] = tv + off; p[2] = z
                return V(*p)
            zt = zc - 0.16
            for (a, c) in line_free(C, T(lo, 0, zt), T(hi, 0, zt)):
                ta, tc = float(a[ax]), float(c[ax])
                slab(o, T(ta, -0.11, zt - 0.004), T(tc, 0.11, zt), 'steel', '-z+z', 0.3)
                for s_ in (-0.11, 0.11):
                    slab(o, T(ta, s_ - 0.002, zt), T(tc, s_ + 0.002, zt + 0.045), 'steel', '-x+x-y+y+z', 0.3)
                for kx in range(rng.randint(3, 4)):
                    oy = -0.07 + kx * 0.045
                    tube(o, T(ta, oy, zt + 0.012), T(tc, oy, zt + 0.012), rng.choice((0.007, 0.009, 0.012)), 'plastic_black', 5, 0.25)
                kk = ta + 0.4
                while kk < tc - 0.2:
                    for s_ in (-0.12, 0.12):
                        tube(o, T(kk, s_, zt), T(kk, s_, zc), 0.004, 'steel', 4, 0.2)
                    kk += 1.8
                o._n('cable trays')
