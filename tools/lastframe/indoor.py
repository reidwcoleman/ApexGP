"""Every map is played indoors: the ways out are boarded and barred, nothing to climb out of, the halls kept clear.

seal(m, inside)        doors with the outside on one side become shut, nailed doors; windows that give onto the
                       outside get a barrier you can shoot through but not climb through
clear_halls(m)         nothing that stops you stands in the middle of a corridor: what does is taken out
inside_fn(m, extra)    a test for "indoors" from the map's rooms and zones (layout coordinates, z up)
roof(m, rect, z, ...)  a ceiling over somewhere that was open, so it can be made a room
"""
import math

# things that block, by kit piece: the rest (litter, tiles, papers, plaster, cables overhead) you walk over or under
BLOCKING_UNITS = ('hbed', 'screen', 'iv', 'pallet', 'radiator')


def inside_fn(m, extra=()):
    spaces = [(tuple(r['a']), tuple(r['b'])) for r in m.rooms]
    spaces += [(tuple(z['a']), tuple(z['b'])) for z in m.zones]
    spaces += [(tuple(a), tuple(b)) for a, b in extra]

    def f(x, y, z):
        for a, b in spaces:
            if a[0] <= x <= b[0] and a[1] <= y <= b[1] and a[2] - 0.35 <= z <= b[2]:
                return True
        return False
    return f


def seal(m, inside, keep=lambda d: False, rng=None):
    """returns (doors sealed, windows barred)"""
    import random
    rng = rng or random.Random(5)
    nd = nw = 0
    for d in list(m.doors):
        hx, hy, hz = d['hinge']
        w, h = d['w'], d['h']
        if d['axis'] == 'x':
            a, b = sorted((hx, hx + d['sign'] * w))
            cx, cy = (a + b) / 2, hy
            sides = [inside(cx, cy - 0.7, hz + 1.0), inside(cx, cy + 0.7, hz + 1.0)]
        else:
            a, b = sorted((hy, hy + d['sign'] * w))
            cx, cy = hx, (a + b) / 2
            sides = [inside(cx - 0.7, cy, hz + 1.0), inside(cx + 0.7, cy, hz + 1.0)]
        if sides[0] == sides[1] or keep(d):
            continue
        m.doors.remove(d)
        nd += 1
        # the door shut in its frame, and boards nailed across it on the inside
        t = 0.05
        mat = 'steel' if d['kind'] == 'steel' else 'wood'
        ins = 1 if sides[1] else -1
        if d['axis'] == 'x':
            m.box((a + 0.01, cy - t / 2, hz), (b - 0.01, cy + t / 2, hz + h - 0.01), mat, tag='wall', density=0.4)
            for i in range(3):
                zz = hz + 0.45 + i * 0.6 + rng.uniform(-0.08, 0.08)
                y0 = cy + ins * (t / 2 + 0.005)
                m.box((a - 0.12, min(y0, y0 + ins * 0.025), zz), (b + 0.12, max(y0, y0 + ins * 0.025), zz + 0.15), 'planks', collide=False, density=0.3)
        else:
            m.box((cx - t / 2, a + 0.01, hz), (cx + t / 2, b - 0.01, hz + h - 0.01), mat, tag='wall', density=0.4)
            for i in range(3):
                zz = hz + 0.45 + i * 0.6 + rng.uniform(-0.08, 0.08)
                x0 = cx + ins * (t / 2 + 0.005)
                m.box((min(x0, x0 + ins * 0.025), a - 0.12, zz), (max(x0, x0 + ins * 0.025), b + 0.12, zz + 0.15), 'planks', collide=False, density=0.3)
    for g in getattr(m, 'windows', []):
        c, a, b, z0, z1 = g['c'], g['a'], g['b'], g['z0'], g['z1']
        mid, zc = (a + b) / 2, (z0 + z1) / 2
        if g['axis'] == 'x':
            sides = [inside(mid, c - 0.7, zc), inside(mid, c + 0.7, zc)]
        else:
            sides = [inside(c - 0.7, mid, zc), inside(c + 0.7, mid, zc)]
        if sides[0] == sides[1]:
            continue
        nw += 1
        # a round goes through, a person doesn't
        if g['axis'] == 'x':
            m.invisible((a - 0.05, c - 0.06, z0 - 0.05), (b + 0.05, c + 0.06, z1 + 0.05), pen=True)
        else:
            m.invisible((c - 0.06, a - 0.05, z0 - 0.05), (c + 0.06, b + 0.05, z1 + 0.05), pen=True)
    return nd, nw


def clear_halls(m, clear=0.6):
    """a corridor keeps a lane down its middle (2 x clear wide, or what's left after 0.55 m each side in a
    narrow one): anything that stops you whose centre stands in that lane is taken out (things against the
    walls stay). Returns how many."""
    lanes = []
    for r in m.rooms:
        (x0, y0, z0), (x1, y1, z1) = r['a'], r['b']
        W, D = x1 - x0, y1 - y0
        if min(W, D) > 4.5 or max(W, D) < 2.0 * min(W, D):
            continue
        if W >= D:
            c, half = (y0 + y1) / 2, min(clear, D / 2 - 0.55)
            lanes.append((x0 - 0.3, c - half, x1 + 0.3, c + half, z0))
        else:
            c, half = (x0 + x1) / 2, min(clear, W / 2 - 0.55)
            lanes.append((c - half, y0 - 0.3, c + half, y1 + 0.3, z0))

    def in_lane(x, y, z, r):
        for (a0, b0, a1, b1, zf) in lanes:
            if -0.3 < z - zf < 1.6 and a0 - r < x < a1 + r and b0 - r < y < b1 + r:
                return True
        return False
    n = 0
    keep = []
    for p in m.props:
        x, y, z = p['pos']
        blocks = p.get('collide') is not False or p.get('loose')
        if blocks and in_lane(x, y, z, 0.0):
            n += 1
            continue
        keep.append(p)
    m.props[:] = keep
    keep = []
    for u in m.units:
        x, y, z = u['pos']
        kind = u['parts'][0].split('_')[0] if u['kit'] == 'ward' else ''
        if kind in BLOCKING_UNITS and in_lane(x, y, z, 0.0 if kind != 'hbed' else 0.5):
            n += 1
            continue
        keep.append(u)
    m.units[:] = keep
    keep = []
    for (a, b, pen) in m.solid:
        cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        if pen and b[2] - a[2] < 1.6 and (b[0] - a[0]) < 2.5 and (b[1] - a[1]) < 2.5 and in_lane(cx, cy, a[2], 0.0):
            n += 1
            continue
        keep.append((a, b, pen))
    m.solid[:] = keep
    return n


def roof(m, x0, y0, x1, y1, z, mat='roof', ceil='ceil', t=0.3):
    """a slab over an open space at height z: its underside is a ceiling"""
    m.box((x0, y0, z), (x1, y1, z + t), mat, faces={'-z': ceil}, tag='roof', density=0.1)


# ---------------------------------------------------------------------------------------------------------------
# opening the buildings up: most walls between two rooms come down to their columns and a beam; the rest get wide
# openings in place of their doors

def _near_plane(w, x, y, z, d):
    if w['axis'] == 'x':
        return abs(y - w['c']) < d and w['p0'] - 0.05 <= x <= w['p1'] + 0.05 and w['z0'] - 0.15 <= z <= w['z1']
    return abs(x - w['c']) < d and w['p0'] - 0.05 <= y <= w['p1'] + 0.05 and w['z0'] - 0.15 <= z <= w['z1']


def _room_at(m, x, y, z):
    for r in m.rooms:
        if r['a'][0] <= x <= r['b'][0] and r['a'][1] <= y <= r['b'][1] and r['a'][2] - 0.3 <= z <= r['b'][2]:
            return r
    return None


def stair_names(names):
    return any(k in n for n in names for k in ('stair', 'well', 'lift', 'bath', 'wc', 'cell'))


def open_up(m, inside, rng, gut=0.6, keep=lambda w: False, never=lambda w: False, col=4.2, min_len=2.0):
    """returns (gutted, widened)"""
    ng = nw = 0
    dead = set()

    def pt(w, along, off):
        return (along, w['c'] + off) if w['axis'] == 'x' else (w['c'] + off, along)

    def has_floor(x, y, z):
        for b in m.boxes:
            if id(b) in dead or not b.collide:
                continue
            if b.a[0] <= x <= b.b[0] and b.a[1] <= y <= b.b[1] and z - 0.12 <= b.b[2] <= z + 0.05:
                return True
        return False

    for w in list(m.walls):
        L = w['p1'] - w['p0']
        H = w['z1'] - w['z0']
        if L < min_len or H < 2.0 or never(w):
            continue
        zc = w['z0'] + min(1.2, H / 2)
        both = True
        names = set()
        for t in (0.15, 0.5, 0.85):
            al = w['p0'] + L * t
            for off in (-0.6, 0.6):
                x, y = pt(w, al, off)
                if not inside(x, y, zc):
                    both = False
                r = _room_at(m, x, y, zc)
                if r:
                    names.add(r['name'])
        if not both:
            # a long wall that's indoors both sides for some of its run (the end of a hall against a yard): a couple of
            # wide ways through in that stretch, the rest as it was
            if L < 6 or stair_names(names) or keep(w):
                continue
            run, best = None, None
            k = 0.5
            while k < L - 0.5:
                al = w['p0'] + k
                ok = all(inside(*pt(w, al, off), zc) for off in (-0.6, 0.6))
                if ok:
                    run = [al, al] if run is None else [run[0], al]
                    if best is None or run[1] - run[0] > best[1] - best[0]:
                        best = list(run)
                else:
                    run = None
                k += 0.5
            if not best or best[1] - best[0] < 5:
                continue
            holes = [list(h) for h in w['holes']]
            add = []
            for _ in range(30):
                if len(add) >= (2 if best[1] - best[0] > 12 else 1):
                    break
                wd = 3.2
                c = rng.uniform(best[0] + wd / 2 + 0.4, best[1] - wd / 2 - 0.4)
                if all(c + wd / 2 + 0.8 < h[0] or c - wd / 2 - 0.8 > h[1] for h in holes + add):
                    add.append([c - wd / 2, c + wd / 2, w['z0'], min(w['z1'] - 0.25, w['z0'] + 2.9)])
            if not add:
                continue
            dead.update(id(b) for b in w['boxes'])
            m.wall(w['axis'], w['c'], w['p0'], w['p1'], w['z0'], w['z1'], w['t'], w['mat'], neg=w['neg'], pos=w['pos'],
                   holes=[tuple(h) for h in sorted(holes + add)], pen=w['pen'], tag=w['tag'], density=w['density'])
            for (a, b, h0, h1) in add:
                m.casing(w['axis'], w['c'], a, b, h0, h1, wt=w['t'] + 0.04)
                x, y = pt(w, (a + b) / 2, 0)
                m.openings.append((x, y, h0, b - a, w['axis']))
            nw += 1
            continue
        stair = stair_names(names)
        # what sits on this wall: its doors, windows, frames, glass
        on = lambda axis, c, along, z: axis == w['axis'] and abs(c - w['c']) < w['t'] / 2 + 0.1 and w['p0'] - 0.05 <= along <= w['p1'] + 0.05 and w['z0'] - 0.1 <= z <= w['z1']
        doors = []
        for d in m.doors:
            hx, hy, hz = d['hinge']
            c, along = (hy, hx) if d['axis'] == 'x' else (hx, hy)
            if on(d['axis'], c, along, hz):
                doors.append(d)
        for d in doors:
            m.doors.remove(d)
            dead.update(id(b) for b in m.cas.get(id(d), []))
        dead.update(id(b) for b in w['boxes'])
        wide = not stair and not keep(w) and rng.random() < gut
        if wide:
            ng += 1
            wins = [g for g in m.windows if on(g['axis'], g['c'], (g['a'] + g['b']) / 2, g['z0'])]
            for g in wins:
                m.windows.remove(g)
                dead.update(id(b) for b in m.cas.get(id(g), []))
                m.glass[:] = [q for q in m.glass if not (q['axis'] == g['axis'] and abs(q['c'] - g['c']) < 0.05 and abs(q['a'] - g['a']) < 0.05 and abs(q['z0'] - g['z0']) < 0.05)]
            # what hung on it goes, what stood against it stays
            m.props[:] = [p for p in m.props if not (p.get('collide') is False and not p.get('loose') and p['pos'][2] > w['z0'] + 0.5 and _near_plane(w, *p['pos'], 0.45))]
            m.units[:] = [u for u in m.units if not (u['pos'][2] > w['z0'] + 0.3 and _near_plane(w, *u['pos'], 0.35))]
            ax = 1 if w['axis'] == 'x' else 0
            if hasattr(m, 'stains'):
                m.stains[:] = [s for s in m.stains if not (abs(s[3 + ax]) > 0.7 and _near_plane(w, s[0], s[1], s[2], 0.35))]
            T = max(w['t'], 0.2)

            def slab(a, b, z0, z1, th, mat=None):
                if w['axis'] == 'x':
                    return m.box((a, w['c'] - th / 2, z0), (b, w['c'] + th / 2, z1), mat or w['mat'], faces={'-y': w['neg'] or w['mat'], '+y': w['pos'] or w['mat']}, tag='int', density=0.5)
                return m.box((w['c'] - th / 2, a, z0), (w['c'] + th / 2, b, z1), mat or w['mat'], faces={'-x': w['neg'] or w['mat'], '+x': w['pos'] or w['mat']}, tag='int', density=0.5)
            # the beam it leaves, the stubs at its ends, and columns on the way
            top = w['z1']
            beam = min(0.38, H * 0.12)
            slab(w['p0'], w['p1'], top - beam, top, T + 0.06)
            for end, sg in ((w['p0'], 1), (w['p1'], -1)):
                ln = rng.uniform(0.3, 0.75) if L > 4 else 0.25
                a, b = sorted((end, end + sg * ln))
                slab(a, b, w['z0'], top - beam, w['t'])
            n = max(1, round(L / col))
            for i in range(1, n):
                al = w['p0'] + L * i / n
                slab(al - 0.22, al + 0.22, w['z0'], top - beam, 0.44)
            # a floor on one side only: it looked over a drop, so it gets a rail
            al = w['p0'] + L / 2
            fa, fb = has_floor(*pt(w, al, -0.5), w['z0']), has_floor(*pt(w, al, 0.5), w['z0'])
            if fa != fb and w['z0'] > 0.5:
                m.rail(w['axis'], w['c'], w['p0'] + 0.3, w['p1'] - 0.3, w['z0'], h=1.0, mat='trim')
            for _ in range(rng.randint(1, 3)):
                x, y = pt(w, rng.uniform(w['p0'] + 0.6, w['p1'] - 0.6), rng.uniform(-0.6, 0.6))
                m.unit('ward', [f'debris_{rng.randint(1, 9)}'], x, y, w['z0'] + 0.002, rot=rng.uniform(0, 6.28), far=True)
        else:
            nw += 1
            holes = []
            for (a, b, h0, h1) in w['holes']:
                if h0 > w['z0'] + 0.1:
                    holes.append([a, b, h0, h1, False, (a, b, h0, h1)])
                    continue
                c = (a + b) / 2
                wd = min(max(b - a, 3.0), L - 0.5)
                c = min(max(c, w['p0'] + 0.25 + wd / 2), w['p1'] - 0.25 - wd / 2)
                holes.append([c - wd / 2, c + wd / 2, h0, max(h1, min(w['z1'] - 0.2, w['z0'] + 2.7)), True, (a, b, h0, h1)])
            # no way through comes out onto a flight of stairs: slide it along the wall to where it doesn't
            steps = [q for q in m.boxes if q.tag == 'step' and id(q) not in dead]

            def on_stairs(a, b):
                for q in steps:
                    if q.b[2] <= w['z0'] + 0.25 or q.a[2] >= w['z0'] + 2.0:
                        continue
                    if w['axis'] == 'x':
                        if q.a[0] < b and q.b[0] > a and q.a[1] < w['c'] + 1.2 and q.b[1] > w['c'] - 1.2:
                            return True
                    elif q.a[1] < b and q.b[1] > a and q.a[0] < w['c'] + 1.2 and q.b[0] > w['c'] - 1.2:
                        return True
                return False
            for h in holes:
                if not h[4] or not on_stairs(h[0], h[1]):
                    continue
                wd = h[1] - h[0]
                moved = False
                for k in range(1, 25):
                    for sg in (1, -1):
                        a2 = h[0] + sg * k * 0.5
                        if a2 < w['p0'] + 0.25 or a2 + wd > w['p1'] - 0.25 or on_stairs(a2, a2 + wd):
                            continue
                        if any(o is not h and a2 - 0.3 < o[1] and o[0] < a2 + wd + 0.3 for o in holes):
                            continue
                        h[0], h[1] = a2, a2 + wd
                        moved = True
                        break
                    if moved:
                        break
                if not moved:
                    h[4] = None
            holes = [h for h in holes if h[4] is not None]
            # a wider doorway can't run into a window beside it: that one keeps its width
            fixed = [h for h in holes if not h[4]]
            for i, (a, b, h0, h1, door, o) in enumerate(holes):
                if door and any(a - 0.15 < f[1] and f[0] < b + 0.15 for f in fixed):
                    holes[i] = [o[0], o[1], o[2], max(o[3], min(w['z1'] - 0.2, w['z0'] + 2.5)), True, o]
            if L >= 7 and not stair:
                for _ in range(12):
                    wd = 4.0
                    c = rng.uniform(w['p0'] + 0.6 + wd / 2, w['p1'] - 0.6 - wd / 2)
                    if all(c + wd / 2 + 0.6 < h[0] or c - wd / 2 - 0.6 > h[1] for h in holes) and not on_stairs(c - wd / 2, c + wd / 2):
                        holes.append([c - wd / 2, c + wd / 2, w['z0'], min(w['z1'] - 0.25, w['z0'] + 2.9), True, None])
                        break
            holes.sort()
            merged = []
            for h in holes:
                if merged and h[0] < merged[-1][1] + 0.3 and h[4] and merged[-1][4]:
                    merged[-1][1] = max(merged[-1][1], h[1])
                    merged[-1][3] = max(merged[-1][3], h[3])
                else:
                    merged.append(h)
            m.wall(w['axis'], w['c'], w['p0'], w['p1'], w['z0'], w['z1'], w['t'], w['mat'], neg=w['neg'], pos=w['pos'],
                   holes=[tuple(h[:4]) for h in merged], pen=w['pen'], tag=w['tag'], density=w['density'])
            for (a, b, h0, h1, door, _o) in merged:
                if not door:
                    continue
                m.casing(w['axis'], w['c'], a, b, h0, h1, wt=w['t'] + 0.04)
                x, y = pt(w, (a + b) / 2, 0)
                m.openings.append((x, y, h0, b - a, w['axis']))
    m.boxes[:] = [b for b in m.boxes if id(b) not in dead]
    return ng, nw


def clear_ways(m):
    """nothing that stops you stands in a doorway, an opening or the foot or head of a stair: 1.6 m clear each side
    of every way through, and 1.2 m round each stair's ends. Returns how many things were taken out."""
    zones = []
    for d in m.doors:
        hx, hy, hz = d['hinge']
        w = d['w']
        if d['axis'] == 'x':
            a, b = sorted((hx, hx + d['sign'] * w))
            zones.append((a - 0.35, hy - 1.6, b + 0.35, hy + 1.6, hz))
        else:
            a, b = sorted((hy, hy + d['sign'] * w))
            zones.append((hx - 1.6, a - 0.35, hx + 1.6, b + 0.35, hz))
    for (x, y, z, w, axis) in m.openings:
        if axis == 'x':
            zones.append((x - w / 2 - 0.3, y - 1.6, x + w / 2 + 0.3, y + 1.6, z))
        else:
            zones.append((x - 1.6, y - w / 2 - 0.3, x + 1.6, y + w / 2 + 0.3, z))
    steps = [b for b in m.boxes if b.tag == 'step']
    if steps:
        # each flight's ends: the lowest and highest tread of each run of touching treads
        for b in steps:
            zones.append((b.a[0] - 1.2, b.a[1] - 1.2, b.b[0] + 1.2, b.b[1] + 1.2, b.b[2] - 0.05))

    def hit(x, y, z, r=0.0):
        for (x0, y0, x1, y1, zf) in zones:
            if -0.3 < z - zf < 1.6 and x0 - r < x < x1 + r and y0 - r < y < y1 + r:
                return True
        return False
    n = 0
    keep = []
    for p in m.props:
        x, y, z = p['pos']
        blocks = p.get('collide') is not False or p.get('loose')
        if blocks and hit(x, y, z):
            n += 1
            continue
        keep.append(p)
    m.props[:] = keep
    keep = []
    for u in m.units:
        x, y, z = u['pos']
        kind = u['parts'][0].split('_')[0] if u['kit'] == 'ward' else ''
        if kind in BLOCKING_UNITS + ('bodybag',) and hit(x, y, z, 0.3 if kind == 'hbed' else 0.0):
            n += 1
            continue
        keep.append(u)
    m.units[:] = keep
    keep = []
    for (a, b, pen) in m.solid:
        cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        if pen and b[2] - a[2] < 2.0 and (b[0] - a[0]) < 3.0 and (b[1] - a[1]) < 3.0 and hit(cx, cy, a[2]):
            n += 1
            continue
        keep.append((a, b, pen))
    m.solid[:] = keep
    keep = []
    for b in m.boxes:
        if b.tag == 'counter' and b.collide and (b.b[0] - b.a[0]) < 3.0 and (b.b[1] - b.a[1]) < 3.0 and hit((b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2, b.a[2]):
            n += 1
            continue
        keep.append(b)
    m.boxes[:] = keep
    return n
