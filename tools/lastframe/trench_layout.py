"""The Trenches: two lines dug into a ruined field at night, in the rain, and the ground between them. Same language as
layout.py: metres, x east, y north, z up. The field is 120 x 80; the two sides are the same ground turned half round
(x, y) -> (120 - x, 80 - y), so neither has the better of it.

  each side   a fire trench in bays and traverses along the front, with a fire step you stand on to see over the sandbags
              and duck off to hide; a support trench behind it; three communication trenches between them, zig-zagging;
              two saps out to listening posts; dugouts cut into the back walls (one a headquarters with the wireless);
              steps up out of the trench in the front and back walls; a field gun dug in behind
  the tunnel  from a pocket off each fire trench, roofed with timber and earth, out under the wire to a sap head beyond
              it, steps up from there: the covered way across
  no-man's    two belts of wire with lanes through, shell holes deep enough to drop into, the great mine crater in the
              middle, a burnt-out farm to the south and a tank that died in a shell hole to the north, dead trees
Star shells go up from both lines and hang over the field (the game does those, see game.ts flares), and the guns
flash on the horizon.
"""
import math, random
from layout import Map
from ward_layout import rects_minus

XW, YW = 120.0, 80.0
F = -1.85          # trench floor
FS1, FS2 = -1.4, -0.95   # the fire step: two treads of it
W = 2.4            # trench width
TF = -2.35         # dugout and tunnel floor
ROOF = -0.4        # underside of a dugout or tunnel roof
UB = -6.0          # the bottom of the ground

SKY = dict(hdri='rooftop_night', strength=0.75, tint=(0.36, 0.4, 0.52))
WEATHER = dict(key=0.13, rain=1, wet=1, fog=1.85, sky=[0.1, 0.11, 0.14], wb=[1.0, 1.0, 1.02])
VOLUME = dict(step=[2, 1.15, 2], min=[-4, -4.6, -84], dim=[64, 12, 44])

WARM = (1.0, 0.62, 0.32)
FIRE = (1.0, 0.45, 0.16)


def mirror(x, y):
    return XW - x, YW - y


def seg_rects(pts, w):
    """an axis-aligned polyline as rectangles, each run widened to w and carried round its corners"""
    out = []
    h = w / 2
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        out.append((min(x0, x1) - h, min(y0, y1) - h, max(x0, x1) + h, max(y0, y1) + h))
    return out


def build():
    m = Map()
    m.rng = random.Random(1916)
    R = m.rng
    box, prop, light = m.box, m.prop, m.light
    m.stains = []
    m.flares = dict(x0=22.0, x1=98.0, y0=6.0, y1=74.0, h=42.0)

    def K(kind, x, y, z=0.0, r=0.0, sc=(1, 1, 1)):
        m.unit('ward', [kind], x, y, z, rot=r, sc=sc, far=True)

    # ---------------------------------------------------------------------------------------------------- one side
    # trenches as polylines (lane centres), then everything else in rectangles
    front = [(24, 3.5), (24, 12), (27, 12), (27, 21), (24, 21), (24, 30), (27, 30), (27, 39), (24, 39), (24, 48), (27, 48), (27, 57),
             (24, 57), (24, 66), (27, 66), (27, 76.5)]
    support = [(9, 9), (9, 30), (11, 30), (11, 50), (9, 50), (9, 71)]
    comms = [[(9, 18), (15, 18), (15, 23), (24, 23)], [(11, 41), (17, 41), (17, 36), (27, 36)], [(9, 62), (16, 62), (16, 59.5), (24, 59.5)]]
    saps = [[(27, 15), (31, 15), (31, 18), (34.5, 18)], [(27, 52), (32, 52), (32, 49.5), (35.5, 49.5)]]
    posts = [(33.0, 16.4, 36.6, 19.6), (34.0, 47.9, 37.6, 51.1)]
    # steps up and out: (x0, y0, x1, y1, rising toward)
    outs = [(25.2, 7.4, 28.9, 8.6, '+x'), (25.2, 25.4, 28.9, 26.6, '+x'), (28.2, 33.4, 31.9, 34.6, '+x'), (25.2, 61.4, 28.9, 62.6, '+x'),
            (4.1, 20.4, 7.8, 21.6, '-x'), (4.1, 57.4, 7.8, 58.6, '-x'), (33.5, 19.6, 34.7, 23.2, '+y')]
    # dugouts: rectangle, the side the door is on, the room's name
    dugouts = [((22.6, 31.6, 25.8, 37.4), '+x', 'dugout'), ((18.6, 59.0, 22.8, 64.0), '+x', 'dugout'), ((12.2, 31.5, 17.6, 37.5), '-x', 'dugout_hq')]
    # the covered way: an open pocket off the fire trench, the roofed run, an open sap head at the far end
    TY = 55.0
    tun_pocket = (28.2, TY - 0.8, 31.2, TY + 0.8)
    tun_run = (31.2, TY - 0.8, 46.0, TY + 0.8)
    tun_head = (46.0, TY - 1.6, 49.4, TY + 1.6)
    tun_out = (49.4, TY - 0.6, 53.1, TY + 0.6)

    lanes_one = []
    for pts in [front, support] + comms + saps:
        lanes_one += seg_rects(pts, W)
    lanes_one += posts

    def mir_rect(r):
        x0, y0 = mirror(r[2], r[3])
        x1, y1 = mirror(r[0], r[1])
        return (x0, y0, x1, y1)

    flip = {'+x': '-x', '-x': '+x', '+y': '-y', '-y': '+y'}
    lanes = lanes_one + [mir_rect(r) for r in lanes_one]
    outs_all = outs + [(*mir_rect(o[:4]), flip[o[4]]) for o in outs]
    dug_all = dugouts + [(mir_rect(d[0]), flip[d[1]], d[2]) for d in dugouts]
    tun = [tun_pocket, tun_run, tun_head, tun_out]
    tun_all = [tun] + [[mir_rect(r) for r in tun]]

    # ------------------------------------------------------------------------------------------------ craters
    # (x, y, radius where the bowl meets the ground): one side's, turned round for the other, and the mine crater
    craters_one = [(36.5, 27.0, 2.4), (42.5, 60.5, 2.8), (47.5, 36.5, 2.3), (33.5, 70.5, 2.1), (51.0, 13.0, 2.6), (50.5, 66.5, 2.0), (40.0, 6.5, 2.2)]
    craters = craters_one + [(*mirror(c[0], c[1]), c[2]) for c in craters_one] + [(60.0, 40.0, 6.5)]
    # and the shelling: the ground between the wire is holes on holes
    avoid = lanes + [o[:4] for o in outs_all] + [r for t in tun_all for r in t] + [d[0] for d in dug_all] + [(51.5, 3.5, 68.5, 15.5), (54.0, 64.5, 66.0, 73.5)]
    wires = [39.0, 44.5, XW - 39.0, XW - 44.5]

    def free_for(x, y, r, gap=1.0):
        if not (3 + r < x < XW - 3 - r and 3 + r < y < YW - 3 - r):
            return False
        for q in avoid:
            if q[0] - r - gap < x < q[2] + r + gap and q[1] - r - gap < y < q[3] + r + gap:
                return False
        for wx in wires:
            if abs(x - wx) < r * 1.45 + 0.9:
                return False
        for c in craters:
            if math.hypot(x - c[0], y - c[1]) < (r + c[2]) * 1.1 + 0.3:
                return False
        return True
    for _ in range(900):
        if len(craters) >= 31 + 2 * 26:
            break
        r = R.uniform(1.2, 2.4) if R.random() < 0.8 else R.uniform(2.4, 3.2)
        x, y = R.uniform(28.0, 59.0), R.uniform(4.0, 76.0)
        mx, my = mirror(x, y)
        if free_for(x, y, r) and math.hypot(x - mx, y - my) > 2 * r * 1.2 + 1:
            craters.append((x, y, r))
            if free_for(mx, my, r):
                craters.append((mx, my, r))
    # a few behind the lines too: the other side's guns reach there
    for _ in range(200):
        r = R.uniform(1.1, 1.8)
        x, y = R.uniform(2.0, 21.0), R.uniform(4.0, 76.0)
        if free_for(x, y, r, 1.4) and free_for(*mirror(x, y), r, 1.4) and sum(1 for c in craters if c[0] < 21.5) < 8:
            craters.append((x, y, r))
            craters.append((*mirror(x, y), r))

    def crater_sq(c):
        h = c[2]
        return (c[0] - h, c[1] - h, c[0] + h, c[1] + h)

    # ------------------------------------------------------------------------------------------------ the ground
    # upper layer: the surface down to the trench floor, cut wherever there's a trench, a way out, a dugout, a crater
    holes_u = lanes + [o[:4] for o in outs_all] + [d[0] for d in dug_all] + [r for t in tun_all for r in t] + [crater_sq(c) for c in craters]
    # the play area, then the field beyond it all round (cheaper in the bake, never walked)
    for r in rects_minus(-1.0, -1.0, XW + 1.0, YW + 1.0, holes_u):
        box((r[0], r[1], F), (r[2], r[3], 0.0), 'mud', faces={'+z': 'mud', '-x': 'mudwall', '+x': 'mudwall', '-y': 'mudwall', '+y': 'mudwall'}, tag='ground', density=0.32)
    for r in rects_minus(-70, -60, XW + 70, YW + 60, [(-1.0, -1.0, XW + 1.0, YW + 1.0)]):
        box((r[0], r[1], -1.0), (r[2], r[3], 0.0), 'mud', tag='ground', density=0.05)
    # lower layer: under the trench floor, cut for the dugouts and the covered way (whose floors are lower) and the mine crater
    deep = [c for c in craters if min(2.3, c[2] * 0.42) > -F - 0.05]
    holes_l = [d[0] for d in dug_all] + [r for t in tun_all for r in t] + [crater_sq(c) for c in deep]
    for r in rects_minus(-1.0, -1.0, XW + 1.0, YW + 1.0, holes_l):
        box((r[0], r[1], UB), (r[2], r[3], F), 'mud', faces={'+z': 'mud', '-x': 'mudwall', '+x': 'mudwall', '-y': 'mudwall', '+y': 'mudwall'}, tag='under', density=0.5)
    for d in dug_all:
        x0, y0, x1, y1 = d[0]
        box((x0, y0, UB), (x1, y1, TF), 'duck', tag='floor', density=0.6)
        # the roof: timber under a metre of earth
        box((x0, y0, ROOF), (x1, y1, 0.0), 'mud', faces={'-z': 'revet', '+z': 'mud', '-x': 'revet', '+x': 'revet', '-y': 'revet', '+y': 'revet'}, tag='under', density=0.3)
    for t in tun_all:
        for r in t:
            box((r[0], r[1], UB), (r[2], r[3], TF), 'mud', tag='floor', density=0.5)
        run = t[1]
        box((run[0], run[1] - 0.3, ROOF), (run[2], run[3] + 0.3, 0.0), 'mud', faces={'-z': 'revet', '+z': 'mud', '-x': 'revet', '+x': 'revet', '-y': 'revet', '+y': 'revet'}, tag='under', density=0.3)
    for c in deep:
        x0, y0, x1, y1 = crater_sq(c)
        box((x0, y0, UB), (x1, y1, -2.6), 'mud', tag='floor', density=0.3)

    # ------------------------------------------------------------------------------------------------ craters: bowls you walk
    for c in craters:
        cx, cy, ri = c
        dep = min(2.3, ri * 0.42)
        h = ri
        K(f'crater_{int(round(ri * 10))}', cx, cy, 0.0, R.uniform(0, 6.28))
        # rain lies in most of them: a sheet of black water at the bottom, its shore wherever the bowl comes up through it
        if R.random() < 0.62:
            K(f'pool_{R.randint(1, 4)}', cx, cy, -dep * 0.62, R.uniform(0, 6.28), (0.75 * ri, 0.75 * ri, 1))
        zf = lambda r: -dep * max(0.0, math.cos(math.pi / 2 * min(1.0, r / ri))) ** 1.2
        n = max(3, int(math.ceil(dep / 0.36)) + 1)
        for k in range(n):
            s0, s1 = h * (1 - k / n), h * (1 - (k + 1) / n)
            top = zf(s0 * 1.08)
            if k == n - 1:
                m.invisible((cx - s0, cy - s0, -dep - 0.6), (cx + s0, cy + s0, top))
                continue
            for (a, b) in (((cx - s0, cy - s0), (cx + s0, cy - s1)), ((cx - s0, cy + s1), (cx + s0, cy + s0)), ((cx - s0, cy - s1), (cx - s1, cy + s1)), ((cx + s1, cy - s1), (cx + s0, cy + s1))):
                m.invisible((a[0], a[1], -dep - 0.6), (b[0], b[1], top))
        # the spoil round the lip stops a round: low cover for whoever's in the hole
        rim = 0.42 * ri / 3.5
        if rim > 0.2:
            for k in range(10):
                a = k / 10 * 2 * math.pi
                rx, ry = cx + math.cos(a) * ri * 1.17, cy + math.sin(a) * ri * 1.17
                hw = ri * 0.32
                m.invisible((rx - hw, ry - hw, 0.0), (rx + hw, ry + hw, rim * 0.75))

    # ------------------------------------------------------------------------------------------------ trench furniture
    def lane_runs(rects):
        """the long runs of trench: (axis, x0, y0, x1, y1)"""
        out = []
        for (x0, y0, x1, y1) in rects:
            if y1 - y0 > x1 - x0 + 0.5:
                out.append(('y', x0, y0, x1, y1))
            elif x1 - x0 > y1 - y0 + 0.5:
                out.append(('x', x0, y0, x1, y1))
        return out

    def blocked_at(x, y, rr=1.6):
        for o in outs_all:
            if o[0] - rr < x < o[2] + rr and o[1] - rr < y < o[3] + rr:
                return True
        for d in dug_all:
            r = d[0]
            if r[0] - rr < x < r[2] + rr and r[1] - rr < y < r[3] + rr:
                return True
        for t in tun_all:
            r = t[0]
            if r[0] - rr < x < r[2] + rr and r[1] - rr < y < r[3] + rr:
                return True
        return False

    fronts = seg_rects(front, W)
    fronts_all = fronts + [mir_rect(r) for r in fronts]
    other = [r for r in lanes if r not in fronts_all]

    def front_side(r):
        """which wall of a fire-trench run faces the enemy: +x on the west side's line, -x on the east's"""
        return 1 if r[0] < XW / 2 else -1

    for r in lanes:
        for (ax, x0, y0, x1, y1) in lane_runs([r]):
            L = (y1 - y0) if ax == 'y' else (x1 - x0)
            # duckboards down the middle on their legs, and the water they're there for
            k = 0
            t = 1.0
            while t < L - 1.0:
                if ax == 'y':
                    x, y, rot = (x0 + x1) / 2 + R.uniform(-0.05, 0.05), y0 + t, R.uniform(-0.03, 0.03)
                else:
                    x, y, rot = x0 + t, (y0 + y1) / 2 + R.uniform(-0.05, 0.05), math.pi / 2 + R.uniform(-0.03, 0.03)
                if not blocked_at(x, y, 0.2):
                    K(f'duck_{R.randint(1, 6)}', x, y, F, rot)
                    if R.random() < 0.38:
                        K(f'pool_{R.randint(1, 4)}', x + R.uniform(-0.15, 0.15), y + R.uniform(-0.4, 0.4), F + 0.03, rot + R.uniform(-0.2, 0.2))
                t += 2.0
                k += 1
            # revetment on both walls, a few metres of one kind then another (never across a way through the wall)
            def opening(px, py):
                for q in holes_u:
                    if q is r:
                        continue
                    if q[0] < px < q[2] and q[1] < py < q[3]:
                        return True
                return False

            def wall_clear(a_, b_, side_):
                for t_ in (a_ + 0.05, (a_ + b_) / 2, b_ - 0.05):
                    if ax == 'y':
                        if opening((x1 if side_ > 0 else x0) + side_ * 0.3, t_):
                            return False
                    elif opening(t_, (y1 if side_ > 0 else y0) + side_ * 0.3):
                        return False
                return True
            # kinds: sandbags, woven hurdles, corrugated iron, planks, all held back by posts
            for side in (-1, 1):
                p = 0.0
                while p < L - 0.6:
                    kind = R.choices(['sb', 'wattle', 'iron', 'planks'], [0.36, 0.3, 0.2, 0.14])[0]
                    run = min(2.0 * R.randint(1, 3), L - p)
                    if ax == 'y':
                        wx = x1 if side > 0 else x0
                        face_rot = -math.pi / 2 if side > 0 else math.pi / 2
                    else:
                        wy = y1 if side > 0 else y0
                        face_rot = 0.0 if side > 0 else math.pi
                    if kind in ('sb', 'wattle') and run >= 1.9:
                        q = p + 1.0
                        while q <= p + run - 0.95:
                            lo_ = (y0 if ax == 'y' else x0) + q - 1.0
                            if not wall_clear(lo_, lo_ + 2.0, side):
                                q += 2.0
                                continue
                            if ax == 'y':
                                ux, uy = wx - side * 0.02, y0 + q
                            else:
                                ux, uy = x0 + q, wy - side * 0.02
                            K(f'{"sbwall" if kind == "sb" else "wattle"}_{R.randint(1, 5)}', ux, uy, F, face_rot)
                            q += 2.0
                    elif wall_clear((y0 if ax == 'y' else x0) + p, (y0 if ax == 'y' else x0) + p + run, side):
                        mat = 'riron' if kind == 'iron' else 'revet'
                        top = R.uniform(-0.45, -0.15)
                        if ax == 'y':
                            a, b = y0 + p, y0 + p + run
                            box((wx - side * 0.05 - 0.02, a, F), (wx - side * 0.05 + 0.02, b, top), mat, collide=False, density=0.3)
                            for q in (a + 0.1, b - 0.1):
                                box((wx - side * 0.11 - 0.05, q - 0.05, F), (wx - side * 0.11 + 0.05, q + 0.05, top + 0.12), 'revet', collide=False, density=0.25)
                        else:
                            a, b = x0 + p, x0 + p + run
                            box((a, wy - side * 0.05 - 0.02, F), (b, wy - side * 0.05 + 0.02, top), mat, collide=False, density=0.3)
                            for q in (a + 0.1, b - 0.1):
                                box((q - 0.05, wy - side * 0.11 - 0.05, F), (q + 0.05, wy - side * 0.11 + 0.05, top + 0.12), 'revet', collide=False, density=0.25)
                    p += run

    # the fire step and the parapet along every run of the fire trenches that faces the other side
    for r in fronts_all:
        for (ax, x0, y0, x1, y1) in lane_runs([r]):
            if ax != 'y':
                continue
            sd = front_side(r)
            wall = x1 if sd > 0 else x0
            y = y0 + 1.6
            while y < y1 - 1.6:
                y2 = min(y + 2.0, y1 - 1.6)
                beyond = any(q is not r and q[0] < wall + sd * 0.3 < q[2] and q[1] - 1.0 < yy_ < q[3] + 1.0 for q in holes_u for yy_ in (y, (y + y2) / 2, y2))
                if not beyond and not blocked_at(wall - sd * 0.5, (y + y2) / 2, 1.2) and y2 - y > 0.9:
                    # two treads: you stand on the top one to see over, step down to be under it
                    a1, a2 = sorted((wall - sd * 0.9, wall - sd * 0.45))
                    b1, b2 = sorted((wall - sd * 0.45, wall))
                    box((a1, y, F), (a2, y2, FS1), 'mud', faces={'+z': 'duck'}, tag='step', density=0.4)
                    box((b1, y, F), (b2, y2, FS2), 'mud', faces={'+z': 'duck'}, tag='step', density=0.4)
                    # sandbags along the lip: two courses, low enough to shoot over from the step
                    sx = wall + sd * 0.4
                    K(f'sandbag2_{R.randint(1, 6)}', sx, (y + y2) / 2, 0.0, math.pi / 2)
                    m.invisible((min(sx - 0.3, sx + 0.3), y, 0.0), (max(sx - 0.3, sx + 0.3), y2, 0.24))
                    # now and then a steel loophole plate set in the bags, for a sniper
                    if R.random() < 0.28:
                        ym = (y + y2) / 2 + R.uniform(-0.4, 0.4)
                        px0 = sx - sd * 0.2
                        box((px0 - 0.025, ym - 0.3, 0.0), (px0 + 0.025, ym - 0.04, 0.55), 'rmetal', tag='counter', density=0.4)
                        box((px0 - 0.025, ym + 0.04, 0.0), (px0 + 0.025, ym + 0.3, 0.55), 'rmetal', tag='counter', density=0.4)
                        box((px0 - 0.025, ym - 0.04, 0.0), (px0 + 0.025, ym + 0.04, 0.3), 'rmetal', tag='counter', density=0.4)
                        box((px0 - 0.025, ym - 0.04, 0.4), (px0 + 0.025, ym + 0.04, 0.55), 'rmetal', tag='counter', density=0.4)
                    # and higher on the back lip (the parados)
                    px = (x0 if sd > 0 else x1) - sd * 0.4
                    if R.random() < 0.7:
                        K(f'sandbag3_{R.randint(1, 6)}', px, (y + y2) / 2, 0.0, math.pi / 2)
                        m.invisible((px - 0.3, y, 0.0), (px + 0.3, y2, 0.36))
                y = y2

    # the steps out
    for (x0, y0, x1, y1, d) in outs_all:
        m.stairs(x0, y0, x1, y1, F, 0.0, d, mat='duck')
    # the dugouts: steps down, a timber frame, what they lived with
    for (rc, d, name) in dug_all:
        x0, y0, x1, y1 = rc
        m.room(name, x0, y0, x1, y1, TF, ROOF - TF, 'revet', 'duck', ceil='revet')
        m.zones.append(dict(a=(x0, y0, TF - 0.2), b=(x1, y1, ROOF), kind='small'))
        # the step down from the trench floor, inside the door
        if d in ('+x', '-x'):
            sx0, sx1 = (x1 - 1.0, x1) if d == '+x' else (x0, x0 + 1.0)
            m.stairs(sx0, (y0 + y1) / 2 - 0.7, sx1, (y0 + y1) / 2 + 0.7, TF, F, d, mat='duck')
        for (px, py) in ((x0 + 0.12, y0 + 0.12), (x1 - 0.12, y0 + 0.12), (x0 + 0.12, y1 - 0.12), (x1 - 0.12, y1 - 0.12), ((x0 + x1) / 2, y0 + 0.12), ((x0 + x1) / 2, y1 - 0.12)):
            box((px - 0.1, py - 0.1, TF), (px + 0.1, py + 0.1, ROOF), 'revet', tag='post', density=0.3)
        lx, ly = (x0 + x1) / 2, (y0 + y1) / 2
        prop('Lantern_01', lx, ly, z=ROOF - 0.42, collide=False)
        light('point', (lx, ly, ROOF - 0.55), WARM, 3.2, radius=0.04, flicker=0.25)
        if name == 'dugout_hq':
            prop('barrel_stove', x0 + 0.6 if d == '-x' else x1 - 1.6, y1 - 0.7, z=TF)
            light('point', (x0 + 0.6 if d == '-x' else x1 - 1.6, y1 - 0.7, TF + 0.5), FIRE, 2.6, radius=0.1, flicker=0.3)
    # the covered way
    for t in tun_all:
        pk, run, head, out = t
        westward = pk[0] < XW / 2
        # the pocket steps down from the fire trench; the head steps back up to the fire-step level, then out
        m.stairs(*pk, TF, F, '-x' if westward else '+x', mat='duck')
        m.stairs(*out, TF, 0.0, '+x' if westward else '-x', mat='duck')
        m.zones.append(dict(a=(run[0], run[1], TF - 0.2), b=(run[2], run[3], ROOF), kind='small'))
        m.room('tunnel', run[0], run[1], run[2], run[3], TF, ROOF - TF, 'revet', 'mud', ceil='revet')
        x = run[0] + 1.0
        while x < run[2] - 0.5:
            for yy in (run[1] + 0.1, run[3] - 0.1):
                box((x - 0.08, yy - 0.08, TF), (x + 0.08, yy + 0.08, ROOF), 'revet', tag='post', density=0.3)
            box((x - 0.08, run[1], ROOF - 0.16), (x + 0.08, run[3], ROOF), 'revet', collide=False, density=0.3)
            x += 1.8
        for k in range(3):
            lx = run[0] + (run[2] - run[0]) * (k + 0.5) / 3
            prop('caged_hanging_light', lx, (run[1] + run[3]) / 2, z=ROOF - 0.05, collide=False)
            light('point', (lx, (run[1] + run[3]) / 2, ROOF - 0.35), WARM if k != 1 else (1.0, 0.07, 0.035), 2.4, radius=0.05, flicker=0.35 if k == 0 else 0.0)
        # sandbags round the head, open toward the crater
        hx0, hy0, hx1, hy1 = head
        for yy in (hy0 - 0.4, hy1 + 0.4):
            K(f'sandbag3_{R.randint(1, 6)}', (hx0 + hx1) / 2, yy, 0.0, 0.0)
            m.invisible((hx0 - 0.1, yy - 0.3, 0.0), (hx1 + 0.1, yy + 0.3, 0.36))

    # listening posts: a ring of bags
    for pst in posts + [mir_rect(p) for p in posts]:
        x0, y0, x1, y1 = pst
        cx = x1 + 0.4 if pst[0] < XW / 2 else x0 - 0.4
        K(f'sandbag3_{R.randint(1, 6)}', cx, (y0 + y1) / 2, 0.0, math.pi / 2)
        m.invisible((cx - 0.3, y0, 0.0), (cx + 0.3, y1, 0.36))

    # lamps along the trenches, few and far between: the line's own light
    lamp_spots = [(9.0, 25.0), (9.0, 44.0), (11.0, 33.0), (24.0, 27.0), (27.0, 33.0), (24.0, 45.0), (27.0, 54.0), (24.0, 64.0), (15.0, 18.0), (17.0, 38.0)]
    for (x, y) in lamp_spots + [mirror(*p) for p in lamp_spots]:
        wx = x - 1.05 if x < XW / 2 else x + 1.05
        prop('Lantern_01', wx, y, z=-0.75, collide=False)
        light('point', (wx + (0.3 if x < XW / 2 else -0.3), y, -0.95), WARM, 2.2, radius=0.04, flicker=0.2)

    # stores in the bays, against the back wall: never in the walk
    stores = ['wooden_military_crate', 'ammo_box', 'Barrel_01', 'wooden_bucket_02', 'cement_bag', 'old_military_crate', 'folding_wooden_stool']
    for r in other:
        for (ax, x0, y0, x1, y1) in lane_runs([r]):
            L = (y1 - y0) if ax == 'y' else (x1 - x0)
            for k in range(int(L / 6)):
                t = R.uniform(1.5, L - 1.5)
                if ax == 'y':
                    x, y = x0 + 0.35, y0 + t
                else:
                    x, y = x0 + t, y0 + 0.35
                if blocked_at(x, y, 1.4):
                    continue
                m.prop(R.choice(stores), x, y, z=F, rot=R.uniform(0, 6.28), collide=False)

    # ------------------------------------------------------------------------------------------------ no-man's land
    # the wire: two belts in front of each line, lanes cut through
    def wire_belt(x, ys, gaps):
        y = ys[0]
        while y < ys[1] - 3.0:
            if not any(g0 - 1.5 < y + 1.5 < g1 + 1.5 for (g0, g1) in gaps):
                K(f'wire_{R.randint(1, 6)}', x, y + 1.5, 0.0, math.pi / 2 + R.uniform(-0.08, 0.08))
                m.invisible((x - 0.7, y, 0.0), (x + 0.7, y + 3.0, 1.0), pen=True)
            y += 3.0
    belts = [(39.0, (4.0, 76.0), [(11.0, 15.0), (29.0, 34.0), (46.0, 51.5), (63.0, 67.0)]), (44.5, (8.0, 72.0), [(19.0, 24.0), (38.0, 43.0), (55.5, 60.0)])]
    for (x, ys, gaps) in belts:
        wire_belt(x, ys, [g for g in gaps])
        mx = XW - x
        wire_belt(mx, (YW - ys[1], YW - ys[0]), [(YW - g1, YW - g0) for (g0, g1) in gaps])

    # dead trees and stumps
    def clear_ground(x, y, r=2.0):
        if not (2 < x < XW - 2 and 2 < y < YW - 2):
            return False
        for q in lanes + [o[:4] for o in outs_all] + [crater_sq(c) for c in craters]:
            if q[0] - r < x < q[2] + r and q[1] - r < y < q[3] + r:
                return False
        for c in craters:
            if math.hypot(x - c[0], y - c[1]) < c[2] * 1.5 + r:
                return False
        return True
    trees = ['dead_tree_trunk', 'dead_tree_trunk_02', 'tree_stump_01', 'tree_stump_02', 'tree_stump_02']
    placed = 0
    for _ in range(400):
        if placed >= 22:
            break
        x, y = R.uniform(30, 58), R.uniform(4, 76)
        if not clear_ground(x, y):
            continue
        n = R.choice(trees)
        sc = R.uniform(1.0, 1.6) if 'trunk' in n else R.uniform(0.9, 1.3)
        for (px, py) in ((x, y), mirror(x, y)):
            prop(n, px, py, rot=R.uniform(0, 6.28), scale=sc)
        placed += 1

    # the farm, burnt out: stone walls to the eaves in places, gone to the knee in others
    fx0, fy0, fx1, fy1 = 53.0, 5.0, 67.0, 14.0
    T = 0.5
    def wall_run(axis, c, p0, p1, gaps, hfn):
        p = p0
        cuts = sorted(gaps)
        segs = []
        for (g0, g1) in cuts:
            segs.append((p, g0))
            p = g1
        segs.append((p, p1))
        for (a, b) in segs:
            q = a
            while q < b - 1e-3:
                e = min(b, q + R.uniform(1.0, 2.2))
                h = hfn()
                if axis == 'x':
                    box((q, c - T / 2, 0.0), (e, c + T / 2, h), 'drystone', tag='ext', density=0.4)
                else:
                    box((c - T / 2, q, 0.0), (c + T / 2, e, h), 'drystone', tag='ext', density=0.4)
                q = e
    tall = lambda: R.choice([3.4, 3.1, 2.6, 1.9, 1.2, 0.8])
    wall_run('x', fy0, fx0, fx1, [(56.0, 57.4), (61.5, 64.0)], tall)
    wall_run('x', fy1, fx0, fx1, [(55.0, 57.5), (60.0, 61.4)], tall)
    wall_run('y', fx0, fy0 + T / 2, fy1 - T / 2, [(8.5, 10.5)], tall)
    wall_run('y', fx1, fy0 + T / 2, fy1 - T / 2, [(7.0, 9.2)], tall)
    wall_run('y', 60.0, fy0 + T / 2, fy1 - T / 2, [(9.0, 10.6)], lambda: R.choice([2.8, 2.2, 1.4]))
    box((fx0, fy0, 0.0), (fx1, fy1, 0.06), 'cobble', tag='floor', density=0.4)
    m.room('farm', fx0 + T / 2, fy0 + T / 2, fx1 - T / 2, fy1 - T / 2, 0.06, 3.0, 'drystone', 'cobble')
    # what's left of the roof: a few beams across, a corner still covered
    for x in (55.0, 58.2, 64.6):
        box((x - 0.1, fy0, 3.0), (x + 0.1, fy1, 3.2), 'revet', collide=False, density=0.3)
    box((62.0, 10.5, 3.1), (67.2, 14.3, 3.3), 'riron', faces={'-z': 'revet'}, density=0.3)
    for (x, y, w, d, h) in ((54.6, 12.5, 1.2, 0.9, 0.5), (65.8, 6.4, 1.0, 1.2, 0.7), (58.0, 6.1, 1.4, 0.7, 0.4), (63.2, 12.8, 0.9, 0.9, 0.55)):
        box((x - w / 2, y - d / 2, 0.0), (x + w / 2, y + d / 2, h), 'drystone', pen=False, tag='counter', density=0.3)
    prop('wooden_table_02', 57.0, 10.0, rot=0.6)
    prop('WoodenChair_01', 57.8, 11.0, rot=2.0)
    prop('wooden_barrels_01', 65.6, 11.8, rot=1.2, collide=False)
    light('point', (62.5, 7.5, 0.5), FIRE, 9.0, radius=0.3, flicker=0.45)
    m.stains.append((62.5, 7.5, 0.07, 0, 0, 1, 1.6))

    # the tank: nose down in a hole to the north, burning still
    tx, ty = 60.0, 69.0
    K('tank', tx, ty, -0.25, 0.0)
    m.invisible((tx - 3.9, ty - 2.1, 0.0), (tx + 3.9, ty + 2.1, 2.3))
    m.invisible((tx - 0.6, ty - 2.9, 0.6), (tx + 1.0, ty + 2.9, 1.8))
    light('point', (tx + 1.6, ty, 2.9), FIRE, 7.0, radius=0.25, flicker=0.5)
    light('point', (tx - 2.0, ty + 2.6, 0.4), FIRE, 3.0, radius=0.2, flicker=0.55)

    # the guns behind each line, dug in: a ring of bags round a field gun
    for (gx, gy, rot) in ((4.0, 40.0, 0.0), (XW - 4.0, YW - 40.0, math.pi)):
        K('fieldgun', gx, gy, 0.0, rot - math.pi / 2)
        m.invisible((gx - 1.3, gy - 1.3, 0.0), (gx + 1.3, gy + 1.3, 1.6))
        for k in range(6):
            a = k / 6 * 2 * math.pi + 0.3
            K(f'sandbag3_{R.randint(1, 6)}', gx + math.cos(a) * 2.7, gy + math.sin(a) * 2.7, 0.0, a + math.pi / 2)
            ex, ey = gx + math.cos(a) * 2.7, gy + math.sin(a) * 2.7
            m.invisible((ex - 0.6, ey - 0.6, 0.0), (ex + 0.6, ey + 0.6, 0.36))
        for k in range(4):
            prop('ammo_box', gx + R.uniform(-1.2, 1.2), gy + (1.6 if rot == 0 else -1.6) + R.uniform(-0.3, 0.3), rot=R.uniform(0, 6.28), collide=False)

    # ------------------------------------------------------------------------------------------------ what the shelling left
    def ground_free(x, y, r=1.2):
        if not free_for(x, y, 0.2, r):
            return False
        return True
    # heaps of thrown-up earth to get behind
    n = 0
    for _ in range(400):
        if n >= 12:
            break
        x, y = R.uniform(28.0, 58.0), R.uniform(5.0, 75.0)
        if not (ground_free(x, y, 2.4) and ground_free(*mirror(x, y), 2.4)):
            continue
        a = R.uniform(0, 6.28)
        for (px, py, rr) in ((x, y, a), (*mirror(x, y), a + math.pi)):
            K(f'spoil_{R.randint(1, 5)}', px, py, 0.0, rr)
            m.invisible((px - 1.3, py - 1.3, 0.0), (px + 1.3, py + 1.3, 0.16))
            m.invisible((px - 0.7, py - 0.7, 0.16), (px + 0.7, py + 0.7, 0.32))
        avoid.append((x - 2.0, y - 2.0, x + 2.0, y + 2.0))
        avoid.append((*[v - 2.0 for v in mirror(x, y)], *[v + 2.0 for v in mirror(x, y)]))
        n += 1
    # what was dropped: helmets, rifles, a stretcher, broken pickets and wire, boxes, boards, sheets of iron
    junk = ['helmet'] * 6 + ['rifle'] * 3 + ['picket'] * 4 + ['ammo'] * 2 + ['plank'] * 3 + ['iron'] * 2 + ['stretcher', 'can']
    n = 0
    for _ in range(1600):
        if n >= 48:
            break
        x, y = R.uniform(4.0, 58.0), R.uniform(3.0, 77.0)
        if not (ground_free(x, y, 0.6) and ground_free(*mirror(x, y), 0.6)):
            continue
        j = R.choice(junk)
        a = R.uniform(0, 6.28)
        for (px, py, rr) in ((x, y, a), (*mirror(x, y), a + math.pi)):
            if j == 'helmet':
                K(f'helmet_{R.randint(1, 8)}', px, py, 0.0, rr)
            elif j == 'rifle':
                prop('bolt_action_rifle_7_62', px, py, z=0.04, rot=rr, collide=False, tilt=math.pi / 2)
            elif j == 'picket':
                K(f'picket_{R.randint(1, 5)}', px, py, 0.0, rr)
            elif j == 'stretcher':
                K('stretcher', px, py, 0.0, rr)
            elif j == 'ammo':
                prop('ammo_box', px, py, rot=rr, collide=False)
            elif j == 'can':
                prop(R.choice(['metal_jerrycan', 'wooden_bucket_02']), px, py, rot=rr, collide=False)
            elif j == 'plank':
                L_ = R.uniform(1.2, 2.6)
                box((px - L_ / 2, py - 0.1, 0.0), (px + L_ / 2, py + 0.1, 0.04), 'revet', collide=False, density=0.2)
            else:
                box((px - 0.9, py - 0.5, 0.0), (px + 0.9, py + 0.5, 0.025), 'riron', collide=False, density=0.2)
        n += 1
    # scaling ladders against the front wall of the fire bays, for going over the top
    for r in fronts_all:
        for (ax, x0, y0, x1, y1) in lane_runs([r]):
            if ax != 'y' or y1 - y0 < 6:
                continue
            sd = front_side(r)
            wall = x1 if sd > 0 else x0
            y = R.uniform(y0 + 2.0, y1 - 2.0)
            if not blocked_at(wall, y, 1.3):
                prop('wooden_ladder_02', wall - sd * 0.75, y, z=FS2, rot=(math.pi / 2 if sd > 0 else -math.pi / 2), collide=False, tilt=-0.28)
    # the boards that name the trenches and warn you: one side's in English, the other's in German
    m.signs = []
    for k, pts in enumerate(comms):
        (ax_, ay_), (bx_, by_) = pts[0], pts[1]
        m.signs.append((ax_ + 2.4, ay_ + W / 2 - 0.02, F + 1.35, 0.0, -1.0, k, 0.95))
        ex, ey = pts[-1]
        m.signs.append((ex - 2.2, ey - W / 2 + 0.02, F + 1.35, 0.0, 1.0, 3, 0.95))
    hq = dugouts[2][0]
    m.signs.append((hq[0] + 0.02, hq[1] - 0.2, F + 1.0, -1.0, 0.0, 4, 0.8))
    m.signs.append((28.2 + 0.02, TY + 1.0 + 0.2, F + 1.4, -1.0, 0.0, 5, 0.85))
    for (x, y) in ((22.8 + 0.02, 44.0), (22.8 + 0.02, 8.0), (25.8 + 0.02, 15.0)):
        m.signs.append((x, y, F + 1.45, 1.0, 0.0, 6, 0.9))
    m.signs.append((11.0 - W / 2 + 0.02, 44.0, F + 1.3, 1.0, 0.0, 7, 0.8))
    one = list(m.signs)
    for (x, y, z, nx, ny, cell, w) in one:
        mx_, my_ = mirror(x, y)
        m.signs.append((mx_, my_, z, -nx, -ny, cell + 8, w))

    # ------------------------------------------------------------------------------------------------ the edges
    for (a, b) in (((-1.5, -1.5), (XW + 1.5, -1.0)), ((-1.5, YW + 1.0), (XW + 1.5, YW + 1.5)), ((-1.5, -1.0), (-1.0, YW + 1.0)), ((XW + 1.0, -1.0), (XW + 1.5, YW + 1.0))):
        m.invisible((a[0], a[1], UB), (b[0], b[1], 8.0))
    # and wire strung round the whole field, so the edge looks like one
    for y in range(0, int(YW), 3):
        for x in (-2.2, XW + 2.2):
            K(f'wire_{R.randint(1, 6)}', x, y + 1.5, 0.0, math.pi / 2)
    for x in range(0, int(XW), 3):
        for y in (-2.2, YW + 2.2):
            K(f'wire_{R.randint(1, 6)}', x + 1.5, y, 0.0, 0.0)
    # a wood the shelling went through: what's left of it stands among one end of each side's trenches, trunks
    # snapped off at all heights, some down across the ground; behind it, the wood that's still a wood
    n = 0
    for _ in range(1500):
        if n >= 34:
            break
        x, y = R.uniform(2.0, 34.0), R.uniform(62.0, 78.0)
        if not (free_for(x, y, 0.4, 0.9) and free_for(*mirror(x, y), 0.4, 0.9)):
            continue
        k = R.random()
        a = R.uniform(0, 6.28)
        for (px, py, rr) in ((x, y, a), (*mirror(x, y), a + math.pi)):
            if k < 0.62:
                prop(R.choice(['dead_tree_trunk', 'dead_tree_trunk_02']), px, py, rot=rr, scale=R.uniform(1.6, 3.0), collide=(0.28, 0.28, 3.0), tilt=R.uniform(-0.18, 0.18))
            elif k < 0.8:
                prop(R.choice(['dead_tree_trunk', 'dead_tree_trunk_02']), px, py, z=0.25, rot=rr, scale=R.uniform(1.2, 2.0), collide=False, tilt=R.choice([-1.35, 1.35]))
            else:
                prop(R.choice(['tree_stump_01', 'tree_stump_02']), px, py, rot=rr, scale=R.uniform(1.0, 1.6))
        avoid.append((x - 0.6, y - 0.6, x + 0.6, y + 0.6))
        n += 1
    for k in range(40):
        x, y = R.uniform(-30.0, 40.0), R.uniform(84.0, 104.0)
        for (px, py) in ((x, y), mirror(x, y)):
            prop('pine_tree_01', px, py, rot=R.uniform(0, 6.28), scale=R.uniform(0.9, 1.3), collide=False)

    # the horizon: shattered woods and a village gone to stumps of wall
    for k in range(70):
        a = k / 70 * 2 * math.pi + R.uniform(-0.04, 0.04)
        d = R.uniform(70, 110)
        prop(R.choice(['dead_tree_trunk', 'dead_tree_trunk_02']), XW / 2 + math.cos(a) * d * 1.2, YW / 2 + math.sin(a) * d, rot=R.uniform(0, 6.28), scale=R.uniform(1.6, 2.6), collide=False)
    for (x, y, w, d, h) in ((-40, 20, 8, 6, 7), (-34, 52, 6, 9, 11), (165, 30, 9, 6, 6), (158, 62, 7, 7, 13), (60, -45, 10, 6, 9), (68, 125, 8, 8, 14)):
        box((x, y, 0.0), (x + w, y + d, h), 'drystone', tag='far', density=0.05)
    # fires on the horizon
    for (x, y) in ((-30, 30), (150, 50), (40, -40), (90, 120)):
        light('point', (x, y, 2.0), FIRE, 40.0, radius=1.0, flicker=0.4)

    # ------------------------------------------------------------------------------------------------ who starts where
    def lane_points(rects, z, step=5.0):
        out = []
        for (ax, x0, y0, x1, y1) in lane_runs(rects):
            L = (y1 - y0) if ax == 'y' else (x1 - x0)
            t = 1.5
            while t < L - 1.5:
                if ax == 'y':
                    x, y = (x0 + x1) / 2 - (0.3 if x0 < XW / 2 else -0.3), y0 + t
                else:
                    x, y = x0 + t, (y0 + y1) / 2
                if not blocked_at(x, y, 0.8):
                    out.append([round(x, 2), round(y, 2), z])
                t += step
        return out
    side_a = lane_points(seg_rects(support, W) + [r for c in comms for r in seg_rects(c, W)] + fronts, F)
    m.spawns['a'] = side_a
    m.spawns['b'] = [[round(XW - p[0], 2), round(YW - p[1], 2), p[2]] for p in side_a]
    m.spawns['ffa'] = side_a[::2] + m.spawns['b'][::2] + [[57.0, 9.5, 0.06], [63.5, 10.0, 0.06], [60.0, 40.0, -2.0], [47.0, TY, TF], [73.0, YW - TY, TF]]
    m.sides = True
    m.hold = [[60.0, 40.0, -2.0], [60.0, 9.5, 0.06], [60.0, 65.0, 0.0]]
    m.sky = SKY
    m.weather = WEATHER
    m.centre = [60.0, -40.0]
    # game axes: from behind the west line looking out over the field, then low in the fire trench
    m.attract = [[8.0, 2.8, -40.0], [24.6, -0.5, -45.0]]
    import clutter
    print('  furnished:', clutter.furnish(m, 'dugout', random.Random(71)))
    return m


if __name__ == '__main__':
    m = build()
    print('boxes', len(m.boxes), 'props', len(m.props), 'lights', len(m.lights), 'units', len(m.units), 'solid', len(m.solid), 'spawns', len(m.spawns['a']))
