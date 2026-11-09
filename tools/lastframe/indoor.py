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
