"""Porthenys Cove: an invented Cornish fishing village, as data. Same language as layout.py, plus ground, roofs and planting.
Metres, x east, y north, z up. The sea is south. Lanes climb the valley north-east from the slipway.
"""
import math, random
import numpy as np
import coveland as CL
from layout import Map, FACES

APT = 'modular_urban_apartments_facade'
SKY = dict(hdri='kloofendal_overcast_puresky', strength=0.9, tint=(1, 1, 1))
WEATHER = dict(key=0.2, rain=0, wet=0, fog=0.05, sky=[0.9, 0.9, 0.9], wb=[0.97, 1.0, 1.04])
INNER = (-180, -80, 200, 250)
LIMIT = (-140, -216, 165, 12)         # x0, z0, x1, z1 in game axes
VOLUME = dict(step=[6, 3.2, 6], min=[-160, -3, -240], dim=[56, 18, 44])


def lanes():
    """centre lines: the road up the valley, a west terrace, an east terrace, and the links between"""
    a = [(CL.valley_x(y) + 7, y) for y in np.arange(44, 206, 4.0)]
    b = [(CL.valley_x(y) - 25, y) for y in np.arange(72, 150, 4.0)]
    c = [(CL.valley_x(y) + 36, y) for y in np.arange(62, 164, 4.0)]
    link = []
    for y, x0, x1 in ((72, CL.valley_x(72) - 25, CL.valley_x(72) + 7), (148, CL.valley_x(148) - 25, CL.valley_x(148) + 7), (64, CL.valley_x(64) + 7, CL.valley_x(64) + 36), (160, CL.valley_x(160) + 7, CL.valley_x(160) + 36)):
        link.append([(x, y) for x in np.arange(float(x0), float(x1), 4.0)])
    return [a, b, c] + link


def sample(H, x, y):
    i = int(round(y - CL.Y0)); j = int(round(x - CL.X0))
    return float(H[i, j])


def plan():
    """everything the ground has to know about: returns pads, lanes with heights, and the house list"""
    X, Y, H0 = CL.build()
    R = random.Random(11)
    pads, ways = [], []
    for ln in lanes():
        zs = [max(sample(H0, x, y), 2.4) for x, y in ln]
        # a lane can't follow every bump: smooth it along its length
        k = np.ones(7) / 7
        zp = np.convolve(np.pad(zs, 3, mode='edge'), k, mode='valid')
        pts = []
        for (x, y), z in zip(ln, zp):
            pads.append((x - 2.4, y - 2.4, x + 2.4, y + 2.4, float(z), 5.5))
            pts.append((x, y, float(z)))
        ways.append(pts)
    rects = []

    def free(r, gap=1.4):
        for q in rects:
            if r[0] - gap < q[2] and r[2] + gap > q[0] and r[1] - gap < q[3] and r[3] + gap > q[1]:
                return False
        for w in ways:
            for x, y, _ in w:
                if r[0] - 2.8 < x < r[2] + 2.8 and r[1] - 2.8 < y < r[3] + 2.8:
                    return False
        return True

    houses = []

    def row(way, side, start=0, skip=0.06, back=0.0):
        i = start
        while i < len(way) - 2:
            x, y, z = way[i]
            w = R.uniform(5.4, 8.4)
            d = R.uniform(5.2, 7.0)
            off = 3.1 + R.uniform(0, 0.9) + back
            r = (x + off, y, x + off + d, y + w) if side > 0 else (x - off - d, y, x - off, y + w)
            if R.random() > skip and free(r, 0.5):
                # further from the lane the ground has its own say, in steps a house can sit on
                z0 = z + R.uniform(-0.1, 0.4)
                if back:
                    z0 = z + float(np.clip(sample(H0, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2) - z, -3.6, 3.6))
                rects.append(r)
                houses.append(dict(r=r, z=z0, floors=R.choice((2, 2, 2, 3)), mat=R.choice(('render', 'render', 'render', 'render_b', 'stonewall')), front=('-x' if side > 0 else '+x'), lane=(x, y)))
                i += max(1, int(round((w + 0.7) / 4)))
            else:
                i += 1

    a, b, c = ways[0], ways[1], ways[2]
    for w, sides in ((a, (1, -1)), (b, (-1, 1)), (c, (1, -1))):
        for sd in sides:
            row(w, sd)
    for w, sides in ((a, (1, -1)), (b, (-1,)), (c, (1,))):
        for sd in sides:
            row(w, sd, start=1, skip=0.25, back=9.0)
    for h in houses:
        x0, y0, x1, y1 = h['r']
        pads.append((x0 - 0.6, y0 - 0.6, x1 + 0.6, y1 + 0.6, h['z'], 3.0))
    # the square at the head of the slip, and the hut on the headland
    square = (8, 42, 34, 54, 2.7)
    pads.append((square[0], square[1], square[2], square[3], square[4], 15))
    hut = (-64, 22, -58, 27)
    hz = sample(H0, -61, 24)
    pads.append((hut[0] - 1, hut[1] - 1, hut[2] + 1, hut[3] + 1, hz, 4))
    return pads, ways, houses, square, (hut, hz)


def gable(m, x0, y0, x1, y1, zt, ridge, wall, over=0.28):
    """a pitched slate roof over the rectangle, walls closed up to it"""
    pitch = 0.8
    if ridge == 'x':
        half = (y1 - y0) / 2
        zr = zt + half * pitch
        ym = (y0 + y1) / 2
        lo = -over * pitch
        m.quad('slate', (x0 - over, y0 - over, zt + lo), (x1 + over, y0 - over, zt + lo), (x1 + over, ym, zr), (x0 - over, ym, zr))
        m.quad('slate', (x1 + over, y1 + over, zt + lo), (x0 - over, y1 + over, zt + lo), (x0 - over, ym, zr), (x1 + over, ym, zr))
        m.tri(wall, (x0, y1, zt), (x0, y0, zt), (x0, ym, zr))
        m.tri(wall, (x1, y0, zt), (x1, y1, zt), (x1, ym, zr))
    else:
        half = (x1 - x0) / 2
        zr = zt + half * pitch
        xm = (x0 + x1) / 2
        lo = -over * pitch
        m.quad('slate', (x1 + over, y0 - over, zt + lo), (x1 + over, y1 + over, zt + lo), (xm, y1 + over, zr), (xm, y0 - over, zr))
        m.quad('slate', (x0 - over, y1 + over, zt + lo), (x0 - over, y0 - over, zt + lo), (xm, y0 - over, zr), (xm, y1 + over, zr))
        m.tri(wall, (x0, y0, zt), (x1, y0, zt), (xm, y0, zr))
        m.tri(wall, (x1, y1, zt), (x0, y1, zt), (xm, y1, zr))
    return zr


def front_windows(m, h, zt):
    """sash windows on the two long faces, a door on the lane"""
    x0, y0, x1, y1 = h['r']
    z = h['z']
    s = 0.54
    tint = (0.95, 0.95, 0.92)
    part = ['window_centered_small_01']
    for f in range(h['floors']):
        zc = z + 1.45 + f * 2.6
        for face, a0, a1, c in (('-x', y0, y1, x0), ('+x', y0, y1, x1), ('-y', x0, x1, y0), ('+y', x0, x1, y1)):
            n = max(1, int((a1 - a0) / 2.6))
            for i in range(n):
                p = a0 + (a1 - a0) * (i + 0.5) / n
                far = True
                if face == '-y':
                    m.unit(APT, part, p + 1.5 * s, c - 0.02, zc - 1.3 * s, rot=0, sc=(s, s, s), tint=tint, far=far)
                elif face == '+y':
                    m.unit(APT, part, p - 1.5 * s, c + 0.02, zc - 1.3 * s, rot=math.pi, sc=(s, s, s), tint=tint, far=far)
                elif face == '+x':
                    m.unit(APT, part, c + 0.02, p + 1.5 * s, zc - 1.3 * s, rot=math.pi / 2, sc=(s, s, s), tint=tint, far=far)
                else:
                    m.unit(APT, part, c - 0.02, p - 1.5 * s, zc - 1.3 * s, rot=-math.pi / 2, sc=(s, s, s), tint=tint, far=far)


def lane_door(m, h):
    x0, y0, x1, y1 = h['r']
    s = 0.74
    p = (y0 + y1) / 2
    if h['front'] == '-x':
        m.unit(APT, ['door_window_small_03'], x0 - 0.02, p - 1.5 * s, h['z'] - 0.02, rot=-math.pi / 2, sc=(s, s, s), tint=(0.5, 0.56, 0.6), far=True)
    else:
        m.unit(APT, ['door_window_small_03'], x1 + 0.02, p + 1.5 * s, h['z'] - 0.02, rot=math.pi / 2, sc=(s, s, s), tint=(0.5, 0.56, 0.6), far=True)


def house(m, h, enter=False):
    x0, y0, x1, y1 = h['r']
    z = h['z']
    zt = z + h['floors'] * 2.6 + 0.25
    wall = h['mat']
    ridge = 'x' if (x1 - x0) > (y1 - y0) else 'y'
    if not enter:
        m.box((x0, y0, z - 7), (x1, y1, zt), wall, tag='ext', density=0.35)
        front_windows(m, h, zt)
        lane_door(m, h)
    else:
        t = 0.28
        hz = z + 2.7
        mid = (y0 + y1) / 2
        lx = x0 if h['front'] == '-x' else x1
        ox = x1 if h['front'] == '-x' else x0
        m.box((x0, y0, z - 7), (x1, y1, z), 'stonewall', tag='floor', density=0.3)
        hd = [m.door('y', lx, mid, z, kind='wood', swing=1 if h['front'] == '-x' else -1)]
        m.wall('y', lx, y0, y1, z, hz, t, wall, holes=hd + [m.window('y', lx, y0 + 1.4, z, w=0.9, h=1.2), m.window('y', lx, y1 - 1.4, z, w=0.9, h=1.2)], tag='ext', density=0.5)
        m.wall('y', ox, y0, y1, z, hz, t, wall, holes=[m.window('y', ox, mid, z, w=1.1, h=1.2)], tag='ext', density=0.5)
        m.wall('x', y0, x0, x1, z, hz, t, wall, holes=[m.window('x', y0, (x0 + x1) / 2, z, w=1.0, h=1.2)], tag='ext', density=0.5)
        m.wall('x', y1, x0, x1, z, hz, t, wall, tag='ext', density=0.5)
        m.room('h%d' % len(m.rooms), x0, y0, x1, y1, z, 2.7, 'wall_dmg', 'wood')
        m.zones.append(dict(a=(x0, y0, z - 0.2), b=(x1, y1, z + 2.7), kind='small'))
        m.box((x0, y0, hz), (x1, y1, zt), wall, tag='ext', density=0.3)
        m.light('point', ((x0 + x1) / 2, mid, z + 2.45), (1.0, 0.8, 0.55), 12, radius=0.06)
        cx, cy = (x0 + x1) / 2, mid
        m.prop('wooden_crate_01', cx + 1.1, y0 + 0.9, z=z, rot=0.3)
        m.loose('wooden_crate_02', cx - 1.0, y1 - 0.9, z=z, rot=1.0, kg=9)
        m.prop('painted_wooden_bench', x0 + 1.0 if h['front'] == '+x' else x1 - 1.0, y1 - 1.5, z=z, rot=math.pi / 2)
    zr = gable(m, x0, y0, x1, y1, zt, ridge, wall)
    m.invisible((x0, y0, zt), (x1, y1, zr))
    # a stone stack on one gable
    cx = x0 + 0.5 if ridge == 'x' else (x0 + x1) / 2 - 0.35
    cy = (y0 + y1) / 2 - 0.35 if ridge == 'x' else y0 + 0.5
    m.box((cx, cy, zt), (cx + 0.7, cy + 0.7, zr + 0.8), 'stonewall', collide=False, density=0.15)


def boat(m, x, y, z, yaw, length=5.2, beam=1.9, skin='hullw'):
    """a clinker punt hauled up on the hard: lofted in plain quads"""
    st = [(-0.5, 0.42, 0.52), (-0.3, 0.86, 0.3), (-0.05, 1.0, 0.2), (0.2, 0.9, 0.24), (0.38, 0.6, 0.38), (0.5, 0.04, 0.62)]
    c, s = math.cos(yaw), math.sin(yaw)

    def P(u, v, w):
        a, b = u * length, v * beam / 2
        return (x + a * c - b * s, y + a * s + b * c, z + w)
    for sd in (1, -1):
        for (u0, b0, k0), (u1, b1, k1) in zip(st, st[1:]):
            q = [P(u0, sd * b0, 0.92), P(u1, sd * b1, 0.92), P(u1, sd * b1 * 0.5, k1 * 0.5), P(u0, sd * b0 * 0.5, k0 * 0.5)]
            m.quad(skin, *(q if sd > 0 else q[::-1]))
            r = [P(u0, sd * b0 * 0.5, k0 * 0.5), P(u1, sd * b1 * 0.5, k1 * 0.5), P(u1, 0, k1 * 0.3), P(u0, 0, k0 * 0.3)]
            m.quad('hullb', *(r if sd > 0 else r[::-1]))
    m.quad('hullr', P(-0.5, -0.42, 0.92), P(-0.5, 0.42, 0.92), P(-0.5, 0.21, 0.26), P(-0.5, -0.21, 0.26))
    ex = abs(length * c) / 2 + abs(beam * s) / 2
    ey = abs(length * s) / 2 + abs(beam * c) / 2
    m.invisible((x - ex, y - ey, z), (x + ex, y + ey, z + 0.95))


def build():
    pads, ways, houses, square, (hut, hz) = plan()
    X, Y, H = CL.build(pads)
    m = Map()
    m.quads = []
    m.veg = []
    m.ground = (X, Y, H)
    m.ways = ways
    m.sky = SKY
    m.weather = WEATHER
    R = random.Random(23)

    def quad(mat, a, b, c, d, dens=0.5):
        m.quads.append(dict(mat=mat, v=[a, b, c, d], dens=dens))

    def tri(mat, a, b, c, dens=0.4):
        m.quads.append(dict(mat=mat, v=[a, b, c, c], dens=dens, tri=True))
    m.quad, m.tri = quad, tri
    Z = lambda x, y: sample(H, x, y)
    # ---- houses; those nearest the square can be walked into
    order = sorted(range(len(houses)), key=lambda i: houses[i]['r'][1])
    open_ones = set(order[1:16:2])
    for i, h in enumerate(houses):
        house(m, h, enter=i in open_ones)
    # ---- the hard: slip, pier, fish cellars
    sx0, sx1 = 15.0, 21.0
    ys = list(np.arange(12, 48.1, 3.0))
    for ya, yb in zip(ys, ys[1:]):
        za, zb = Z(18, ya) + 0.05, Z(18, yb) + 0.05
        quad('slip', (sx0, ya, za), (sx1, ya, za), (sx1, yb, zb), (sx0, yb, zb), dens=0.8)
    top = 2.9
    m.box((-18, 12, -3), (-12.5, 36, top), 'stonewall', tag='ext', faces={'+z': 'cobble'}, density=0.6)
    m.box((-18, 7, -3), (6, 12, top), 'stonewall', tag='ext', faces={'+z': 'cobble'}, density=0.6)
    m.box((-18, 6.4, top), (6, 7, top + 0.9), 'stonewall', tag='ext', density=0.4)
    m.stairs(-12.5, 28, -9.5, 32, Z(-9, 30), top, '-x', mat='stonewall')
    for bx, by, r in ((-6, 9.5, 0.0), (2, 9.5, 2.1), (-15, 20, 1.2)):
        m.prop('wooden_barrels_01', bx, by, z=top, rot=r)
    m.prop('lifebuoy', -14.8, 24.0, z=top + 0.05, rot=1.2, collide=False)
    # ---- open square at the head of the slip, with stone edging
    sq = square
    m.box((sq[0] - 0.4, sq[1] - 0.5, sq[4] - 2), (sq[2] + 0.4, sq[1], sq[4] + 0.5), 'stonewall', tag='ext', density=0.4)
    for bx, by, yaw, skin in ((12, 39, 1.5, 'hullw'), (24, 37, 1.72, 'hullb'), (27, 45, 1.3, 'hullw'), (9, 34, 1.44, 'hullr')):
        boat(m, bx, by, Z(bx, by) + 0.02, yaw, skin=skin)
    for bx, by in ((31, 44), (33, 47), (10, 46)):
        m.loose('wooden_crate_01', bx, by, z=sq[4], rot=R.random() * 3, kg=8)
    m.prop('painted_wooden_bench', 22, 53, z=sq[4], rot=math.pi)
    # ---- the hut on the headland, and Cornish hedges round the top fields
    hh = dict(r=hut, z=hz, floors=1, mat='render', front='+x', lane=(0, 0))
    house(m, hh, enter=True)
    for (ax, ay, bx, by) in ((-125, 62, -34, 58), (-125, 112, -50, 106), (-34, 58, -50, 106), (86, 42, 160, 46), (100, 44, 104, 124)):
        n = int(math.hypot(bx - ax, by - ay) / 3)
        L_ = math.hypot(bx - ax, by - ay)
        px, py = -(by - ay) / L_ * 0.55, (bx - ax) / L_ * 0.55
        for i in range(n):
            xa, ya = ax + (bx - ax) * i / n, ay + (by - ay) * i / n
            xb, yb = ax + (bx - ax) * (i + 1) / n, ay + (by - ay) * (i + 1) / n
            za, zb = Z(xa, ya), Z(xb, yb)
            hgt = 1.3
            # banked stone with turf on top, laid along the slope in plain quads
            quad('hedge', (xb + px, yb + py, zb - 0.3), (xa + px, ya + py, za - 0.3), (xa + px * 0.6, ya + py * 0.6, za + hgt), (xb + px * 0.6, yb + py * 0.6, zb + hgt), dens=0.2)
            quad('hedge', (xa - px, ya - py, za - 0.3), (xb - px, yb - py, zb - 0.3), (xb - px * 0.6, yb - py * 0.6, zb + hgt), (xa - px * 0.6, ya - py * 0.6, za + hgt), dens=0.2)
            quad('ter_grass', (xb + px * 0.6, yb + py * 0.6, zb + hgt), (xa + px * 0.6, ya + py * 0.6, za + hgt), (xa - px * 0.6, ya - py * 0.6, za + hgt), (xb - px * 0.6, yb - py * 0.6, zb + hgt), dens=0.15)
            m.invisible((min(xa, xb) - 0.5, min(ya, yb) - 0.5, min(za, zb) - 0.5), (max(xa, xb) + 0.5, max(ya, yb) + 0.5, max(za, zb) + hgt))
    # ---- street furniture
    for w in ways[:3]:
        for i in range(4, len(w), 11):
            x, y, z = w[i]
            m.prop('street_lamp_01', x + 2.7, y, z=z, rot=math.pi, collide=(0.1, 0.1, 2))
    # ---- spawns and the fight
    a = ways[0]
    for x, y, z in a[-9::2]:
        for dx in (-1.3, 1.3):
            m.spawns['a'].append([x + dx, y, z + 0.1])
    for x, y in ((14, 50), (26, 50), (12, 47), (24, 44), (17, 44), (28, 52)):
        m.spawns['b'].append([x, y, Z(x, y) + 0.1])
    for w in ways[:3]:
        for x, y, z in w[3::6]:
            m.spawns['ffa'].append([x, y, z + 0.1])
    m.hold = [[20, 48, sq[4]], [-56, 24, hz], [ways[0][len(ways[0]) // 2][0], ways[0][len(ways[0]) // 2][1], ways[0][len(ways[0]) // 2][2]]]
    m.centre = [ways[0][14][0], -ways[0][14][1]]
    # the shot behind the menu: from over the water, the way the village first shows itself
    m.attract = [[-40, 15, 6], [-10, 17, -2]]
    plant(m, H, X, Y, houses, ways)
    print('houses', len(houses), 'boxes', len(m.boxes), 'quads', len(m.quads), 'units', len(m.units), 'veg', len(m.veg), 'spawns', {k: len(v) for k, v in m.spawns.items()})
    return m


def lane_mask(X, Y, ways):
    d = np.full(X.shape, 1e9, np.float32)
    for w in ways:
        for x, y, _ in w:
            i0, j0 = int(y - 9 - CL.Y0), int(x - 9 - CL.X0)
            sl = (slice(max(i0, 0), i0 + 18), slice(max(j0, 0), j0 + 18))
            d[sl] = np.minimum(d[sl], np.hypot(X[sl] - x, Y[sl] - y))
    return d


def splat(H, X, Y, ways):
    """RGBA weights: grass, rock, shingle, lane"""
    gy, gx = np.gradient(H, CL.STEP)
    sl = np.hypot(gx, gy)
    n = CL.fbm(X, Y, 0.05, 4, 71)
    rock = CL.smooth(0.72, 1.12, sl + n * 0.2)
    near_sea = CL.smooth(4.2, 1.2, H + n * 1.3)
    rock = np.maximum(rock, near_sea * CL.smooth(30, 60, np.abs(X - 12)))
    sand = near_sea * (1 - rock)
    lane = CL.smooth(3.6, 2.2, lane_mask(X, Y, ways) + n * 0.5) * (1 - rock * 0.5)
    grass = np.clip(1 - rock - sand - lane, 0, 1)
    return np.dstack([grass, rock * (1 - lane), sand * (1 - lane), lane])


def plant(m, H, X, Y, houses, ways):
    """what grows, by slope, height and shelter"""
    R = np.random.default_rng(5)
    gy, gx = np.gradient(H, CL.STEP)
    sl = np.hypot(gx, gy)
    lane = lane_mask(X, Y, ways)
    rects = np.array([h['r'] for h in houses])
    add = m.veg.append

    def ok(x, y, pad):
        return not (((rects[:, 0] - pad < x) & (rects[:, 2] + pad > x) & (rects[:, 1] - pad < y) & (rects[:, 3] + pad > y)).any())

    def scatter(names, count, s0, s1, lo, hi, zmin, box=INNER, lane_gap=3.5, pad=1.0):
        n = 0
        tries = 0
        while n < count and tries < count * 30:
            tries += 1
            x = R.uniform(box[0], box[2]); y = R.uniform(box[1], box[3])
            i, j = int(y - CL.Y0), int(x - CL.X0)
            h = H[i, j]
            if h < zmin or not (lo <= sl[i, j] < hi) or lane[i, j] < lane_gap or not ok(x, y, pad):
                continue
            nm = names[int(R.integers(len(names)))]
            sz = float(R.uniform(s0, s1))
            add(dict(id=nm, pos=[float(x), float(y), float(h) - (0.3 * sz if 'rock' in nm else 0.05)], rot=float(R.uniform(0, 6.28)), s=sz))
            n += 1
    g = 'grass_medium_01|grass_medium_01_'
    scatter([g + 'tall_a_LOD0', g + 'tall_b_LOD0', g + 'tall_c_LOD0', g + 'small_b_LOD0'], 7000, 1.4, 2.4, 0, 0.75, 4.2, box=(-140, -10, 165, 215))
    scatter(['fern_02|fern_02_a', 'fern_02|fern_02_d', 'nettle_plant|nettle_plant_small_b_LOD0'], 500, 0.8, 1.4, 0.1, 0.8, 5)
    bushes = ['shrub_03|shrub_03_a', 'shrub_03|shrub_03_b', 'shrub_03|shrub_03_c', 'shrub_03|shrub_03_d', 'shrub_02|shrub_02_b', 'shrub_02|shrub_02_d', 'shrub_04|all']
    scatter(bushes, 520, 0.9, 2.0, 0.15, 0.95, 6, pad=2)
    # the wood up the valley sides: the same bushes, grown on
    scatter(bushes, 300, 2.4, 4.6, 0.08, 0.8, 16, box=(-120, 70, 180, 250), lane_gap=6, pad=3.5)
    scatter(['tree_small_02|all'], 90, 0.9, 1.5, 0.08, 0.72, 16, box=(-120, 70, 180, 250), lane_gap=6, pad=3.5)
    # rock that the heights can't draw: overhangs, boulders and skerries round the cove
    scatter([n + '|all' for n in ('coast_rocks_01', 'coast_rocks_02', 'coast_rocks_03', 'coast_rocks_05', 'rock_face_02')], 150, 1.5, 4.5, 0.15, 2.5, -0.6, box=(-180, -70, 200, 60), lane_gap=4)
    scatter([n + '|all' for n in ('coast_land_rocks_02', 'coast_land_rocks_03', 'rock_face_01', 'rock_face_02')], 120, 2.5, 7, 0.9, 3.2, 1, box=(-180, -70, 200, 90), lane_gap=4)


if __name__ == '__main__':
    build()
