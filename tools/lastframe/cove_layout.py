"""Porthenys Cove: an invented Cornish fishing village, as data. Same language as layout.py, plus ground, roofs and planting.
Metres, x east, y north, z up. The sea is south. Lanes climb the valley north-east from the slipway.
"""
import math, random
import numpy as np
import coveland as CL
from layout import Map, FACES
import cove_house as CH

# a June afternoon: the sun over the west headland, cumulus coming in off the Atlantic
SKY = dict(hdri='kloofendal_48d_partly_cloudy_puresky', strength=1.0, tint=(1, 1, 1), sun_az=(-0.5, -0.86), sky_e=0.62, sun_k=3.4, clamp=7.0, tone=(1.0, 0.95, 0.86))
# a sea fret rolled in at the end of the day: the sun gone behind it, the village a few doors deep, then grey
WEATHER = dict(key=0.2, rain=0, wet=0, fog=7.0, sky=[1.0, 1.0, 1.0], wb=[0.97, 1.0, 1.03], dim=0.3, sunK=0.03, skyTint=[0.08, 0.085, 0.095], expMax=1.15, sat=0.5)
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

    def free(r, gap=-0.01):
        for q in rects:
            if r[0] - gap < q[2] and r[2] + gap > q[0] and r[1] - gap < q[3] and r[3] + gap > q[1]:
                return False
        for w in ways:
            for x, y, _ in w:
                if r[0] - 2.8 < x < r[2] + 2.8 and r[1] - 2.8 < y < r[3] + 2.8:
                    return False
        return True

    houses = []

    def lane_at(way, y):
        k = (y - way[0][1]) / 4.0
        i = int(np.clip(math.floor(k), 0, len(way) - 2))
        t = float(np.clip(k - i, 0, 1))
        return way[i][0] + (way[i + 1][0] - way[i][0]) * t, way[i][2] + (way[i + 1][2] - way[i][2]) * t

    def row(way, side, y0, y1, back=0.0, gap=0.72):
        """a terrace along the lane: houses share their party walls, each its own step up the hill, with a ginnel every few doors"""
        y = y0
        while y < y1:
            w = R.uniform(4.6, 7.2)
            d = R.uniform(5.4, 7.2)
            x, z = lane_at(way, y + w / 2)
            off = 3.05 + R.uniform(0, 0.5) + back
            r = (x + off, y, x + off + d, y + w) if side > 0 else (x - off - d, y, x - off, y + w)
            if free(r):
                z0 = z + R.uniform(-0.05, 0.25)
                if back:
                    z0 = z + float(np.clip(sample(H0, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2) - z, -3.6, 3.6))
                rects.append(r)
                near = y < 74
                mat = R.choice(('stonewall', 'stonewall', 'render_w', 'render_w', 'render_c')) if near else R.choice(('render_w', 'render_w', 'render_w', 'render_w', 'render_c', 'render_c', 'render_p', 'render_g', 'stonewall'))
                houses.append(dict(r=r, z=z0, floors=R.choice((2, 2, 2, 2, 3)) if not back else R.choice((1, 2, 2)), mat=mat, front=('-x' if side > 0 else '+x'), lane=(x, y), seed=R.randrange(1000), slate=R.choice(('slate', 'slate', 'slate_b')), pitch=R.uniform(0.78, 0.95), shut={}))
                y += w + (0.0 if R.random() < gap else R.uniform(1.9, 3.4))
            else:
                y += 1.0

    a, b, c = ways[0], ways[1], ways[2]
    for w, sides in ((a, (1, -1)), (b, (-1, 1)), (c, (1, -1))):
        ya, yb = w[0][1] + 2, w[-1][1] - 6
        for sd in sides:
            row(w, sd, ya, yb)
    for w, sides in ((a, (1, -1)), (b, (-1,)), (c, (1,))):
        ya, yb = w[0][1] + 6, w[-1][1] - 8
        for sd in sides:
            row(w, sd, ya, yb, back=9.0, gap=0.3)
    # what shares a wall has no windows in it
    for p_ in houses:
        for q in houses:
            if p_ is q: continue
            if abs(p_['r'][3] - q['r'][1]) < 0.05 and min(p_['r'][2], q['r'][2]) - max(p_['r'][0], q['r'][0]) > 1.0:
                p_['shut']['+y'] = True
                q['shut']['-y'] = True
    for h in houses:
        x0, y0, x1, y1 = h['r']
        pads.append((x0 - 0.6, y0 - 0.6, x1 + 0.6, y1 + 0.6, h['z'], 3.0))
    # the square at the head of the slip, and the hut on the headland
    square = (8, 42, 34, 54, 2.7)
    pads.append((square[0], square[1], square[2], square[3], square[4], 15))
    hut = (-64, 22, -58, 27)
    hz = sample(H0, -61, 24)
    pads.append((hut[0] - 1, hut[1] - 1, hut[2] + 1, hut[3] + 1, hz, 4))
    # last of all, each footprint exactly at its own floor: a neighbour's levelling mustn't come up through it
    for h in houses:
        x0, y0, x1, y1 = h['r']
        pads.append((x0 + 0.1, y0 + 0.1, x1 - 0.1, y1 - 0.1, h['z'] - 0.06, 0.5))
    return pads, ways, houses, square, (hut, hz)


def house(m, h, R, enter=False):
    x0, y0, x1, y1 = h['r']
    z = h['z']
    zt = z + h['floors'] * CH.FLOOR + 0.2
    wall = h['mat']
    # the ridge runs with the lane, except now and then a gable turned to it
    ridge = 'y' if h['front'][1] == 'x' else 'x'
    if not h['shut'] and R.random() < 0.3:
        ridge = 'x' if ridge == 'y' else 'y'
    if not enter:
        CH.shell(m, h, R)
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
    dorm = 0
    if h['floors'] <= 2 and R.random() < 0.34 and (x1 - x0 if ridge == 'x' else y1 - y0) > 5:
        dorm = R.choice((1, 2, 2))
    zr = CH.roof(m, h, zt, ridge, h.get('slate', 'slate'), wall, R, dormers=dorm)
    m.invisible((x0, y0, zt), (x1, y1, zr))
    for end in ((-1, 1) if R.random() < 0.55 else (R.choice((-1, 1)),)):
        CH.chimney(m, h, zt, zr, ridge, wall if wall != 'render_p' else 'render_w', end, R)
    if not enter:
        CH.dress(m, h, zt, ridge, wall, R)


def lane_walls(m, ways, houses, Z, R):
    """dry stone along the lanes wherever there isn't a house: chest-high cover, with a gap every so often to get through"""
    rects = [h['r'] for h in houses]

    def near(x, y, pad):
        return any(r[0] - pad < x < r[2] + pad and r[1] - pad < y < r[3] + pad for r in rects)
    n = 0
    for w in ways[:3]:
        for side in (-1, 1):
            run = 0
            off = 3.0
            for (ax, ay, az), (bx, by, bz) in zip(w, w[1:]):
                run += 1
                L = math.hypot(bx - ax, by - ay)
                px, py = -(by - ay) / L * side, (bx - ax) / L * side
                xa, ya, xb, yb = ax + px * off, ay + py * off, bx + px * off, by + py * off
                if near(xa, ya, 1.0) or near(xb, yb, 1.0) or ay < 56 or run % 7 == 0:
                    continue
                za, zb = Z(xa, ya) - 0.1, Z(xb, yb) - 0.1
                hg = 1.05 + 0.12 * math.sin(ay * 0.3)
                tx, ty = px * 0.26, py * 0.26
                # batter: narrower at the top
                CH.qn(m, 'drystone', ((xa + tx, ya + ty, za), (xb + tx, yb + ty, zb), (xb + tx * 0.7, yb + ty * 0.7, zb + hg), (xa + tx * 0.7, ya + ty * 0.7, za + hg)), (px, py, 0.1), 0.15)
                CH.qn(m, 'drystone', ((xa - tx, ya - ty, za), (xb - tx, yb - ty, zb), (xb - tx * 0.7, yb - ty * 0.7, zb + hg), (xa - tx * 0.7, ya - ty * 0.7, za + hg)), (-px, -py, 0.1), 0.15)
                CH.qn(m, 'copestone', ((xa + tx * 0.9, ya + ty * 0.9, za + hg), (xb + tx * 0.9, yb + ty * 0.9, zb + hg), (xb - tx * 0.9, yb - ty * 0.9, zb + hg), (xa - tx * 0.9, ya - ty * 0.9, za + hg)), (0, 0, 1), 0.1)
                m.hard((min(xa, xb) - 0.24, min(ya, yb) - 0.1, min(za, zb) - 0.2), (max(xa, xb) + 0.24, max(ya, yb) + 0.1, max(za, zb) + hg), 'drystone', pen=False)
                n += 1
    return n


HULLS = [(0.86, 0.85, 0.8), (0.1, 0.2, 0.36), (0.1, 0.32, 0.3), (0.5, 0.1, 0.08), (0.12, 0.42, 0.56), (0.8, 0.62, 0.2)]


def boat(m, x, y, z, yaw, kind='punt_l', tint=(0.86, 0.85, 0.8)):
    """a clinker boat hauled out on the hard"""
    m.unit('cove', [kind], x, y, z, rot=yaw, tint=tint, far=True)
    ex = abs(2.5 * math.cos(yaw)) + abs(0.95 * math.sin(yaw))
    ey = abs(2.5 * math.sin(yaw)) + abs(0.95 * math.cos(yaw))
    m.hard((x - ex * 0.82, y - ey * 0.82, z), (x + ex * 0.82, y + ey * 0.82, z + 0.95), 'hullw')


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
    m.hards = []
    m.hard = lambda a, b, mat, pen=False: m.hards.append(dict(a=tuple(min(a[i], b[i]) for i in range(3)), b=tuple(max(a[i], b[i]) for i in range(3)), mat=mat, pen=pen))
    Z = lambda x, y: sample(H, x, y)
    # ---- houses; those nearest the square can be walked into
    order = sorted(range(len(houses)), key=lambda i: houses[i]['r'][1])
    open_ones = set(order[1:16:2])
    for i, h in enumerate(houses):
        house(m, h, R, enter=i in open_ones)
    # ---- the hard: slip, pier, fish cellars
    sx0, sx1 = 15.0, 21.0
    sq0z = square[4]
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
    for i, (bx, by, yaw, k) in enumerate(((12, 39, 1.5, 'punt_l'), (24, 37, 1.72, 'punt_r'), (27, 45, 1.3, 'punt_l'), (9, 34, 1.44, 'punt_r'), (23.5, 27, 1.62, 'punt_l'))):
        boat(m, bx, by, Z(bx, by) + 0.02, yaw, k, HULLS[i % len(HULLS)])
    # afloat in the cove: the game rides these on the swell
    for i, (bx, by, yaw) in enumerate(((30, -8, 0.5), (8, -14, 2.4), (44, -2, 1.3), (-2, -4, 3.5))):
        m.unit('cove', ['punt'], bx, by, -0.16, rot=yaw, tint=HULLS[(i + 2) % len(HULLS)], far=True)
        m.units[-1]['float'] = 1
    # what a working quay collects: pots in stacks, posts, buckets
    for i, (px, py) in enumerate(((-16.6, 14.5), (-16.6, 15.3), (-15.8, 14.5), (-13.6, 33.5), (-13.6, 34.3), (-1, 8.1), (-0.2, 8.1), (3.6, 8.1))):
        m.unit('cove', ['lobster'], px, py, top, rot=(i * 1.7) % 3.1, far=True)
        if i % 3 == 0:
            m.unit('cove', ['lobster'], px + 0.05, py, top + 0.4, rot=(i * 2.3) % 3.1, far=True)
    m.invisible((-17, 14, top), (-15.3, 15.8, top + 0.8))
    m.invisible((-14, 33, top), (-13.2, 34.8, top + 0.45))
    m.invisible((-1.5, 7.7, top), (0.3, 8.6, top + 0.45))
    for px, py in ((-17.6, 13), (-17.6, 21), (-17.6, 29), (-12, 7.4), (-4, 7.4), (4, 7.4)):
        m.unit('cove', ['post'], px, py, top, rot=0, far=True)
    for px, py, r_ in ((-14.2, 11, 0.4), (-8, 10.6, 2.0), (31.4, 48, 1.1), (11, 51, 0.2)):
        m.prop('wooden_bucket_01', px, py, z=top if px < 0 else sq0z, rot=r_, collide=False)
    for bx, by in ((31, 44), (33, 47), (10, 46)):
        m.loose('wooden_crate_01', bx, by, z=sq[4], rot=R.random() * 3, kg=8)
    m.prop('painted_wooden_bench', 22, 53, z=sq[4], rot=math.pi)
    # ---- the hut on the headland, and Cornish hedges round the top fields
    hh = dict(r=hut, z=hz, floors=1, mat='render_w', front='+x', lane=(0, 0), seed=3, shut={})
    house(m, hh, R, enter=True)
    print('lane walls', lane_walls(m, ways, houses, Z, R))
    for (ax, ay, bx, by) in ((-125, 62, -34, 58), (-125, 112, -50, 106), (-34, 58, -50, 106), (86, 42, 160, 46), (100, 44, 104, 124), (-128, 8, -118, 62), (-92, 60, -96, 110), (-60, 26, -40, 58), (100, 84, 162, 92), (130, 44, 136, 90), (-125, 112, -116, 176), (-50, 106, -42, 170), (-116, 176, -42, 170), (104, 124, 170, 132)):
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
            quad('hedge', (xb + px * 0.6, yb + py * 0.6, zb + hgt), (xa + px * 0.6, ya + py * 0.6, za + hgt), (xa - px * 0.6, ya - py * 0.6, za + hgt), (xb - px * 0.6, yb - py * 0.6, zb + hgt), dens=0.15)
            # blackthorn and bramble along the top, as on any Cornish hedge
            for k in range(2):
                t_ = R.random()
                m.veg.append(dict(id=R.choice(('shrub_03|shrub_03_a', 'shrub_03|shrub_03_b', 'shrub_03|shrub_03_c', 'shrub_02|shrub_02_b')), pos=[xa + (xb - xa) * t_, ya + (yb - ya) * t_, za + (zb - za) * t_ + hgt - 0.1], rot=R.random() * 6.28, s=R.uniform(0.8, 1.5)))
            m.invisible((min(xa, xb) - 0.5, min(ya, yb) - 0.5, min(za, zb) - 0.5), (max(xa, xb) + 0.5, max(ya, yb) + 0.5, max(za, zb) + hgt))
    # ---- pots by the doors, and the buoys off the point
    for i, h in enumerate(houses):
        if i % 3 == 0 and i not in open_ones:
            x0, y0, x1, y1 = h['r']
            px = x0 - 0.3 if h['front'] == '-x' else x1 + 0.3
            py = (y0 + y1) / 2 + (1.25 if i % 2 else -1.25)
            m.prop('planter_pot_clay', px, py, z=h['z'], rot=i * 0.9, scale=1.5, collide=False)
            m.veg.append(dict(id='shrub_sorrel_01|all', pos=[px, py, h['z'] + 0.3], rot=i * 1.3, s=0.75))
    for bx, by in ((26, -24), (-30, -32), (62, -30)):
        m.prop('ocean_buoy', bx, by, z=-0.3, rot=bx * 0.3, collide=False)
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
    for x, y in ((14, 50), (20, 46), (12, 47), (24, 44), (17, 44), (10, 43)):
        m.spawns['b'].append([x, y, Z(x, y) + 0.1])
    for w in ways[:3]:
        for x, y, z in w[3::6]:
            m.spawns['ffa'].append([x, y, z + 0.1])
    m.hold = [[20, 48, sq[4]], [-56, 24, hz], [ways[0][len(ways[0]) // 2][0], ways[0][len(ways[0]) // 2][1], ways[0][len(ways[0]) // 2][2]]]
    m.centre = [ways[0][14][0], -ways[0][14][1]]
    m.rects = [h['r'] for h in houses] + [hut]
    # the shot behind the menu: from over the water, the way the village first shows itself
    m.attract = [[-40, 15, 6], [-10, 17, -2]]
    plant(m, H, X, Y, houses, ways)
    print('houses', len(houses), 'boxes', len(m.boxes), 'quads', len(m.quads), 'units', len(m.units), 'veg', len(m.veg), 'spawns', {k: len(v) for k, v in m.spawns.items()})
    # what's left about the cottages
    import clutter
    GH = m.ground[2]

    def zf(x, y):
        fx, fy = (x - CL.X0) / CL.STEP, (y - CL.Y0) / CL.STEP
        i, j = int(fx), int(fy)
        if not (0 <= i < GH.shape[1] - 1 and 0 <= j < GH.shape[0] - 1):
            return -9.0
        u, v = fx - i, fy - j
        return float(GH[j, i] * (1 - u) * (1 - v) + GH[j, i + 1] * u * (1 - v) + GH[j + 1, i] * (1 - u) * v + GH[j + 1, i + 1] * u * v)
    clutter.dress(m, 'cottage', random.Random(41), outside=[(-20.0, 15.0, 130.0, 175.0, 0.0)], out_items=clutter.COAST_OUT, out_n=70, zf=zf, blood=0.5)
    return m


def lane_mask(X, Y, ways):
    d = np.full(X.shape, 1e9, np.float32)
    for w in ways:
        for x, y, _ in w:
            i0, j0 = int(y - 9 - CL.Y0), int(x - 9 - CL.X0)
            sl = (slice(max(i0, 0), i0 + 18), slice(max(j0, 0), j0 + 18))
            d[sl] = np.minimum(d[sl], np.hypot(X[sl] - x, Y[sl] - y))
    return d


def splat(H, X, Y, ways, rects=()):
    """RGBA weights: grass, rock, shingle, lane"""
    gy, gx = np.gradient(H, CL.STEP)
    sl = np.hypot(gx, gy)
    n = CL.fbm(X, Y, 0.05, 4, 71)
    rock = CL.smooth(0.62, 0.98, sl + n * 0.22)
    near_sea = CL.smooth(4.2, 1.2, H + n * 1.3)
    rock = np.maximum(rock, near_sea * CL.smooth(30, 60, np.abs(X - 12)))
    # the sea cliffs: anything steep in the first stretch above the water is bare, gnawed back in bays
    away = CL.smooth(34, 62, np.abs(X - 12))
    rock = np.maximum(rock, CL.smooth(0.3, 0.56, sl + n * 0.25) * CL.smooth(30, 13, H + n * 9) * away)
    sand = near_sea * (1 - rock)
    lane = CL.smooth(3.6, 2.2, lane_mask(X, Y, ways) + n * 0.5) * (1 - rock * 0.5)
    grass = np.clip(1 - rock - sand - lane, 0, 1)
    # the square and the head of the slip are laid, not grown
    sq = (slice(int(40 - CL.Y0), int(56 - CL.Y0)), slice(int(6 - CL.X0), int(36 - CL.X0)))
    lane[sq] = 1
    grass[sq] = 0
    for r in rects:
        sl_ = (slice(int(r[1] - 1 - CL.Y0), int(r[3] + 2 - CL.Y0)), slice(int(r[0] - 1 - CL.X0), int(r[2] + 2 - CL.X0)))
        lane[sl_] = np.maximum(lane[sl_], grass[sl_]); grass[sl_] = 0
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

    def scatter(names, count, s0, s1, lo, hi, zmin, box=INNER, lane_gap=3.5, pad=1.0, zmax=1e9):
        n = 0
        tries = 0
        while n < count and tries < count * 30:
            tries += 1
            x = R.uniform(box[0], box[2]); y = R.uniform(box[1], box[3])
            i, j = int(y - CL.Y0), int(x - CL.X0)
            h = H[i, j]
            if h < zmin or h > zmax or not (lo <= sl[i, j] < hi) or lane[i, j] < lane_gap or not ok(x, y, pad):
                continue
            # the hard, the slip and the quay are kept clear: this is where boats are hauled
            if 'rock' in names[0] and -24 < x < 44 and 4 < y < 60:
                continue
            nm = names[int(R.integers(len(names)))]
            sz = float(R.uniform(s0, s1))
            add(dict(id=nm, pos=[float(x), float(y), float(h) - (0.14 * sz if 'rock' in nm else 0.05)], rot=float(R.uniform(0, 6.28)), s=sz))
            n += 1
    g = 'grass_medium_01|grass_medium_01_'
    scatter([g + 'tall_a_LOD0', g + 'tall_b_LOD0', g + 'tall_c_LOD0'], 1600, 1.4, 2.4, 0.25, 0.9, 4.2, box=(-140, -10, 165, 215))
    scatter(['fern_02|fern_02_a', 'fern_02|fern_02_d', 'nettle_plant|nettle_plant_small_b_LOD0'], 1400, 0.9, 1.7, 0.18, 1.0, 8)
    bushes = ['shrub_03|shrub_03_a', 'shrub_03|shrub_03_b', 'shrub_03|shrub_03_c', 'shrub_03|shrub_03_d', 'shrub_02|shrub_02_b', 'shrub_02|shrub_02_d', 'shrub_04|all']
    scatter(bushes, 760, 0.9, 2.2, 0.15, 0.95, 6, pad=2)
    # the wood up the valley sides: the same bushes, grown on
    scatter(bushes, 340, 2.4, 5.2, 0.08, 0.8, 16, box=(-120, 70, 180, 250), lane_gap=6, pad=3.5)
    # rock that the heights can't draw: overhangs, boulders and skerries round the cove
    scatter([n + '|all' for n in ('coast_rocks_01', 'coast_rocks_02', 'coast_rocks_03', 'coast_rocks_05')], 280, 1.6, 6.0, 0.1, 9, -1.6, box=(-200, -74, 210, 70), lane_gap=4, zmax=9)
    scatter([n + '|all' for n in ('coast_land_rocks_02', 'coast_land_rocks_03', 'coast_land_rocks_04', 'coast_rocks_03')], 420, 3.5, 10, 0.72, 9, 0.6, box=(-200, -74, 210, 22), lane_gap=4, zmax=30)


if __name__ == '__main__':
    build()
