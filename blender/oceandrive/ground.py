"""Streets, sidewalks, curbs, markings, Lummus Park, the dunes, the beach and the sea (inside Blender)."""
import math, random
from lib import MB, hexcol, WHITE
from hotels import SW
import geo

# ---------------------------------------------------------------- street grid (local metres)
OD_W, OD_E = -6.5, 6.0                       # Ocean Drive curbs
XS = [  # north-south roads: (x0, x1, name)
    (-55.5, -49.5, 'Ocean Court'), (-114.4, -100.4, 'Collins Avenue'), (-165.5, -159.5, 'Collins Court'), (-228.8, -212.8, 'Washington Avenue')]
YS = [  # east-west streets (west of Ocean Drive): (y0, y1)
    (-222.2, -213.2), (-73.5, -64.5), (63.7, 72.7), (197.9, 206.9), (337.8, 346.8)]
CITY_X0, CITY_X1 = -262.0, OD_E
CITY_Y0, CITY_Y1 = -330.0, 420.0
WATER_X = 262.0
SEA = -1.5          # sea level (road surface is z=0)
NEAR = (-62.0, 125.0, -95.0, 95.0)   # x0, x1, y0, y1 of the high-detail ground


def lawn_h(x, y):
    """Lummus Park lawn height: gentle swells, flush with the coral wall's foot near the street"""
    t = min(1.0, max(0.0, (x - 11.5) / 6.0))
    return SW + 0.08 + t * (0.12 * math.sin(x * 0.11 + y * 0.05) * math.cos(y * 0.07) + 0.10)


def beach_h(x, y):
    """sand: dune crest ~x 112, then down to the waterline at WATER_X and on under the sea"""
    if x < 100:
        return lawn_h(x, y)
    if x < 132:
        u = (x - 100) / 32.0
        dune = 1.1 * math.sin(math.pi * u) ** 1.5 * (0.75 + 0.25 * math.sin(y * 0.09) * math.sin(y * 0.031 + 1))
        return lawn_h(100, y) * (1 - u) + 0.55 * u + dune
    if x < WATER_X:
        u = (x - 132) / (WATER_X - 132)
        return 0.55 + (SEA - 0.55) * (u ** 1.25) + 0.05 * math.sin(y * 0.05 + x * 0.02)
    return SEA - (x - WATER_X) * 0.035


def terrain_h(x, y):
    return lawn_h(x, y) if x < 100 else beach_h(x, y)


def in_road(x, y):
    if OD_W <= x <= OD_E:
        return True
    for a, b, _ in XS:
        if a <= x <= b:
            return True
    if x < OD_W:
        for a, b in YS:
            if a <= y <= b:
                return True
    return False


def _inside(x, y, poly):
    c = False
    n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def city_ground(near, far, feet=()):
    """west of Ocean Drive's east curb: roads at z=0, raised blocks/sidewalks at SW with curbs.
    feet: building footprints (polygons); ground wholly under a building is left out (never seen)."""
    xs = sorted({CITY_X0, CITY_X1, OD_W, NEAR[0]} | {v for a, b, _ in XS for v in (a, b)})
    ys = sorted({CITY_Y0, CITY_Y1, NEAR[2], NEAR[3]} | {v for a, b in YS for v in (a, b)})
    # split long cells so the lightmap/vertex density stays sane
    def refine(vals, step):
        out = []
        for a, b in zip(vals, vals[1:]):
            n = max(1, int(math.ceil((b - a) / step)))
            out += [a + (b - a) * i / n for i in range(n)]
        return out + [vals[-1]]
    xs, ys = refine(xs, 4.0), refine(ys, 4.0)
    def pick(x, y):
        return near if (NEAR[0] <= x <= NEAR[1] and NEAR[2] <= y <= NEAR[3]) else far
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            x0, x1, y0, y1 = xs[i], xs[i + 1], ys[j], ys[j + 1]
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            mb = pick(cx, cy)
            if feet and not in_road(cx, cy):
                corners = ((x0 + 0.3, y0 + 0.3), (x1 - 0.3, y0 + 0.3), (x1 - 0.3, y1 - 0.3), (x0 + 0.3, y1 - 0.3))
                if any(all(_inside(px, py, f) for px, py in corners) for f in feet if min(p[0] for p in f) <= x0 + 0.3 and max(p[0] for p in f) >= x1 - 0.3):
                    continue
            if in_road(cx, cy):
                mb.face([(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0)], 'od_asphalt', WHITE, n=(0, 0, 1))
            else:
                mb.face([(x0, y0, SW), (x1, y0, SW), (x1, y1, SW), (x0, y1, SW)], 'od_sidewalk', WHITE, n=(0, 0, 1))
                # curb faces toward neighbouring road cells
                for (nx, ny, a, b) in (((x1 + 0.01), cy, (x1, y0), (x1, y1)), ((x0 - 0.01), cy, (x0, y0), (x0, y1)),
                                       (cx, (y1 + 0.01), (x0, y1), (x1, y1)), (cx, (y0 - 0.01), (x0, y0), (x1, y0))):
                    if in_road(nx, ny) and CITY_X0 < nx < CITY_X1 + 1 and CITY_Y0 < ny < CITY_Y1:
                        d = (nx - cx, ny - cy, 0)
                        mb.face([(a[0], a[1], 0), (b[0], b[1], 0), (b[0], b[1], SW), (a[0], a[1], SW)], 'od_curb', WHITE, n=d)
                        # granite-ish curb top strip
                        L = math.hypot(d[0], d[1]); ux, uy = d[0] / L, d[1] / L
                        mb.face([(a[0], a[1], SW + 0.004), (b[0], b[1], SW + 0.004), (b[0] - ux * 0.25, b[1] - uy * 0.25, SW + 0.004), (a[0] - ux * 0.25, a[1] - uy * 0.25, SW + 0.004)], 'od_curb', WHITE, n=(0, 0, 1))


def markings(mb):
    """Ocean Drive: one northbound lane, a green bike lane, parking both sides; crosswalks at the corners"""
    def strip(x0, x1, y0, y1, mat, z=0.006):
        mb.face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat, WHITE, n=(0, 0, 1))
    Y0, Y1 = -95.0, 95.0
    # parking lane edge lines
    for x in (OD_W + 2.4, OD_E - 2.4):
        for k in range(int((Y1 - Y0) / 6)):
            y = Y0 + k * 6
            if any(a - 2 < y < b + 2 for a, b in YS):
                continue
            strip(x - 0.06, x + 0.06, y, y + 5.4, 'od_paint')
            # stall ticks
    # bike lane (green) next to the east parking
    bx1 = OD_E - 2.4 - 0.15
    bx0 = bx1 - 1.6
    for a, b in ((Y0, YS[1][0] - 4), (YS[1][1] + 4, YS[2][0] - 4), (YS[2][1] + 4, Y1)):
        strip(bx0, bx1, a, b, 'od_bikelane', 0.004)
        strip(bx0 - 0.15, bx0, a, b, 'od_paint')
    # lane centre dashes
    xc = (OD_W + 2.4 + bx0) / 2
    for k in range(int((Y1 - Y0) / 9)):
        y = Y0 + k * 9
        if any(a - 3 < y < b + 3 for a, b in YS):
            continue
        strip(xc - 0.07, xc + 0.07, y, y + 3, 'od_paint')
    # crosswalks across Ocean Drive at 7th and 8th (continental bars) and across the side streets
    for a, b in YS[1:3]:
        for y in (a - 3.6, b + 0.6):
            for k in range(int((OD_E - OD_W) / 0.9)):
                x = OD_W + 0.3 + k * 0.9
                strip(x, x + 0.5, y, y + 3.0, 'od_paint', 0.007)
        for k in range(int((b - a) / 0.9)):
            y = a + 0.25 + k * 0.9
            strip(OD_W - 4.2, OD_W - 1.2, y, y + 0.5, 'od_paint', 0.007)
        # stop bars
        strip(OD_W - 0.6, OD_W - 0.2, a + 0.3, b - 0.3, 'od_paint', 0.007)


def ribbon(mb, pts, width, mat, hfun, lift=0.03, step=1.0, col=WHITE):
    """a path ribbon draped on the terrain along a polyline"""
    P = []
    for (a, b) in zip(pts, pts[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, int(L / step))
        for i in range(n):
            t = i / n
            P.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    P.append(pts[-1])
    # smooth the polyline (chaikin) so the serpentine walk curves
    for _ in range(3):
        Q = [P[0]]
        for a, b in zip(P, P[1:]):
            Q += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]), (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
        Q.append(P[-1])
        P = Q
    P = P[::4] + [P[-1]]
    L = []
    for i, p in enumerate(P):
        a, b = P[max(0, i - 1)], P[min(len(P) - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        l = math.hypot(dx, dy) or 1
        nx, ny = -dy / l, dx / l
        l0 = (p[0] + nx * width / 2, p[1] + ny * width / 2)
        r0 = (p[0] - nx * width / 2, p[1] - ny * width / 2)
        L.append((l0, r0))
    for (la, ra), (lb, rb) in zip(L, L[1:]):
        q = [(ra[0], ra[1]), (rb[0], rb[1]), (lb[0], lb[1]), (la[0], la[1])]
        mb.face([(x, y, hfun(x, y) + lift) for x, y in q], mat, col, n=(0, 0, 1))
    return P


def park(near, far, props, rng):
    """Lummus Park: the east sidewalk, the coral rock wall, lawns, the serpentine beachwalk, volleyball,
    the dune line, the beach and the sea floor"""
    def pick(x, y):
        return near if (NEAR[0] <= x <= NEAR[1] and NEAR[2] <= y <= NEAR[3]) else far
    # east sidewalk
    for y in range(int(CITY_Y0), int(CITY_Y1), 10):
        mb = pick(8, y + 5)
        mb.face([(OD_E, y, SW), (10.5, y, SW), (10.5, y + 10, SW), (OD_E, y + 10, SW)], 'od_sidewalk', WHITE, n=(0, 0, 1))
        mb.face([(OD_E, y, 0), (OD_E, y + 10, 0), (OD_E, y + 10, SW), (OD_E, y, SW)], 'od_curb', WHITE, n=(-1, 0, 0))
        mb.face([(OD_E, y, SW + 0.004), (OD_E + 0.25, y, SW + 0.004), (OD_E + 0.25, y + 10, SW + 0.004), (OD_E, y + 10, SW + 0.004)], 'od_curb', WHITE, n=(0, 0, 1))
    # coral rock wall with openings at the paths
    gaps = [(-71.0, -66.0), (65.7, 70.7), (-210, -205), (199, 204), (-30, -27), (29, 32)]
    y = CITY_Y0
    segs = []
    cuts = sorted(gaps)
    cur = CITY_Y0
    for a, b in cuts:
        segs.append((cur, a)); cur = b
    segs.append((cur, CITY_Y1))
    for a, b in segs:
        k = a
        while k < b:
            e = min(b, k + 6.0)
            mb = pick(10.8, (k + e) / 2)
            h = SW + 0.62
            mb.box(10.5, k, 0.05, 11.2, e, h, 'od_coral', WHITE, skip=('-z',))
            mb.box(10.42, k, h, 11.28, e, h + 0.08, 'od_curb', WHITE, skip=('-z',))
            k = e
    # lawn grid (1.5 m) from the wall to the dunes, then the beach, all draped on terrain_h
    def grid(x0, x1, y0, y1, step, mat_fn):
        nx = max(1, int(math.ceil((x1 - x0) / step)))
        ny = max(1, int(math.ceil((y1 - y0) / step)))
        for i in range(nx):
            for j in range(ny):
                xa, xb = x0 + (x1 - x0) * i / nx, x0 + (x1 - x0) * (i + 1) / nx
                ya, yb = y0 + (y1 - y0) * j / ny, y0 + (y1 - y0) * (j + 1) / ny
                mat = mat_fn((xa + xb) / 2, (ya + yb) / 2)
                mb = pick((xa + xb) / 2, (ya + yb) / 2)
                mb.face([(xa, ya, terrain_h(xa, ya)), (xb, ya, terrain_h(xb, ya)), (xb, yb, terrain_h(xb, yb)), (xa, yb, terrain_h(xa, yb))], mat, WHITE, n=(0, 0, 1))
    def lawn_or_sand(x, y):
        return 'od_grass' if x < 100 else 'od_sand'
    # near region finer
    grid(11.2, NEAR[1], NEAR[2], NEAR[3], 1.5, lawn_or_sand)
    grid(11.2, NEAR[1], CITY_Y0, NEAR[2], 4.0, lawn_or_sand)
    grid(11.2, NEAR[1], NEAR[3], CITY_Y1, 4.0, lawn_or_sand)
    grid(NEAR[1], WATER_X + 60, CITY_Y0, CITY_Y1, 5.0, lambda x, y: 'od_sand')
    # beachwalk (serpentine) and the cross paths at 7th and 8th
    bw = [w for w in geo.WAYS if w['tags'].get('name') == 'Lummus Park Boardwalk']
    pts = []
    for w in bw:
        pts += geo.way_local(w)
    pts = sorted([p for p in pts if CITY_Y0 < p[1] < CITY_Y1], key=lambda p: p[1])
    # serpentine: the OSM line wanders 30-60 m out; keep its shape
    walk = []
    for p in pts:
        if not walk or abs(p[1] - walk[-1][1]) > 3:
            walk.append(p)
    ribbon(near, [p for p in walk if p[1] < NEAR[3] + 5 and p[1] > NEAR[2] - 5], 4.6, 'od_sidewalk', terrain_h, step=1.0)
    ribbon(far, [p for p in walk if p[1] < NEAR[2] + 1], 4.6, 'od_sidewalk', terrain_h, step=2.0)
    ribbon(far, [p for p in walk if p[1] > NEAR[3] - 1], 4.6, 'od_sidewalk', terrain_h, step=2.0)
    walk_pts = walk
    for yc in (-68.5, 68.2):
        xw = min(walk, key=lambda p: abs(p[1] - yc))[0]
        ribbon(near, [(11.0, yc), (xw, yc)], 3.6, 'od_sidewalk', terrain_h, step=1.0)
        # beach access through the dunes (wooden walk)
        ribbon(near if abs(yc) < NEAR[3] else far, [(xw, yc), (99.0, yc), (134.0, yc)], 2.4, 'od_wood', terrain_h, lift=0.12, step=1.0)
    # volleyball courts (OSM pitches)
    for w in geo.WAYS:
        t = w['tags']
        if t.get('leisure') == 'pitch' and t.get('surface') == 'sand':
            q = geo.way_local(w)
            if len(q) >= 4 and NEAR[2] < q[0][1] < NEAR[3] and q[0][0] < 100:
                q = q[:4]
                near.face([(x, y, terrain_h(x, y) + 0.02) for x, y in q], 'od_sand', WHITE, n=(0, 0, 1))
                # net between the midpoints of the long sides
                cx = sum(p[0] for p in q) / 4; cy = sum(p[1] for p in q) / 4
                props.append(('vball', cx, cy, terrain_h(cx, cy), math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0])))
    # sea floor beyond the waterline (not baked: the water hides it)
    return walk_pts


def sea(mb):
    S = 6000.0
    z = SEA
    mb.face([(WATER_X - 60, -S, z), (S, -S, z), (S, S, z), (WATER_X - 60, S, z)], 'od_water', WHITE, n=(0, 0, 1))


def horizon_ground(mb):
    """beyond the modelled city: a ground plane so the far haze never shows a void"""
    S = 6000.0
    for (x0, x1, y0, y1) in ((-S, CITY_X0, -S, S), (CITY_X0, WATER_X - 60, -S, CITY_Y0), (CITY_X0, WATER_X - 60, CITY_Y1, S)):
        mb.face([(x0, y0, -0.02), (x1, y0, -0.02), (x1, y1, -0.02), (x0, y1, -0.02)], 'od_far', WHITE, n=(0, 0, 1))
