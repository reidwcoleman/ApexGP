"""Downtown Miami from OSM -> everything the Blender build and the game need, in final Blender metres.

  work/venv/bin/python downtown/prep.py      -> work/dt.json (Blender), public/oceandrive/downtown.json (game),
                                                public/oceandrive/map.webp (the minimap of both districts)

The playable core is Biscayne Boulevard from SE 4th Street to the arena, west to NE 2nd Avenue, east to the
bay (Bayfront Park, Bayside). Around it the rest of downtown, Brickell and Edgewater stand as a skyline.
Port Boulevard's bridge crosses the (narrowed) bay to Ocean Drive's 7th Street."""
import json, math, os, sys, random
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from osmdt import NODES, NTAGS, WAYS, pts, num, TX, TY, rel_polys
from land import land_and_water
from shapely.geometry import Polygon, MultiPolygon, LineString, Point, box, mapping
from shapely.ops import unary_union, substring, linemerge
from shapely import affinity
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
WORK = os.path.join(os.path.dirname(HERE), 'work')
PUB = os.path.join(ROOT, 'public', 'oceandrive')
rng = random.Random(1896)

# ------------------------------------------------------------------ extents
CORE = Polygon([(-1300, 45), (-700, 45), (-520, -400), (-500, -1260), (-1090, -1260)])
SKY = box(-3400, -2900, -480, 1500)          # the skyline around it (nothing east of the bay's west shore)
lands = land_and_water()
LAND = max(lands, key=lambda a: a[0].area)[0]
water_polys = []
for w in WAYS:
    t = w.get('tags', {})
    if (t.get('natural') == 'water' or t.get('waterway') == 'riverbank' or t.get('water') in ('river', 'canal')) and len(pts(w)) > 3:
        try:
            p = Polygon(pts(w)).buffer(0)
            if p.area > 3000:
                water_polys.append(p)
        except Exception:
            pass
LAND = LAND.difference(unary_union(water_polys)).buffer(0) if water_polys else LAND
CORE_LAND = CORE.intersection(LAND).buffer(0)
print('core land', round(CORE_LAND.area))

def polys(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    return [p for p in getattr(g, 'geoms', []) if isinstance(p, Polygon) and not p.is_empty]

def ring(p):
    return [[round(x, 3), round(y, 3)] for x, y in list(p.exterior.coords)[:-1]]

def pj(p):
    """polygon -> [outer, hole, hole...]"""
    return [ring(p)] + [[[round(x, 3), round(y, 3)] for x, y in list(h.coords)[:-1]] for h in p.interiors]

# ------------------------------------------------------------------ roads
DRIVE = {'primary': (4, 3.4), 'secondary': (3, 3.3), 'tertiary': (2, 3.4), 'residential': (2, 3.3), 'unclassified': (2, 3.2),
         'primary_link': (1, 3.6), 'secondary_link': (1, 3.6), 'tertiary_link': (1, 3.6), 'living_street': (2, 3.0)}
roads = []   # dict(id, name, pts, lanes, oneway, lw, width, hw)
for w in WAYS:
    t = w.get('tags', {})
    hw = t.get('highway')
    if hw not in DRIVE and not (hw == 'service' and t.get('service') == 'alley'):
        continue
    if t.get('bridge') == 'yes' or num(t.get('layer'), 0) > 0 or t.get('tunnel') == 'yes' or num(t.get('layer'), 0) < 0:
        continue
    p = pts(w)
    if len(p) < 2:
        continue
    ls = LineString(p)
    if not ls.intersects(CORE.buffer(60)):
        continue
    dl, lw = DRIVE.get(hw, (1, 3.2))
    oneway = t.get('oneway') in ('yes', '1', 'true', '-1')
    if t.get('oneway') == '-1':
        p = p[::-1]
    lanes = int(num(t.get('lanes'), 0)) or (dl if not oneway else max(1, dl // 2 + (1 if hw in ('primary', 'secondary') else 0)))
    if hw == 'service':
        lanes, lw = 1, 3.6
    width = lanes * lw + (0.6 if lanes > 1 else 0.8)
    roads.append(dict(id=w['id'], name=t.get('name', ''), pts=p, nodes=[i for i in w['nodes'] if i in NODES], lanes=lanes, oneway=oneway, lw=lw, width=width, hw=hw,
                      signals=[]))
print('roads', len(roads))

# junctions: nodes shared by two or more drivable ways (or a way's interior node used twice)
use = {}
for r in roads:
    for k, n in enumerate(r['nodes']):
        use.setdefault(n, []).append(r)
JUNC = {n: rs for n, rs in use.items() if len(rs) >= 2}

# road surface: each way buffered to its width, unioned, the block corners rounded (curb returns)
def road_poly(r):
    return LineString(r['pts']).buffer(r['width'] / 2, cap_style='flat', join_style='round', quad_segs=4)
caps = []
for n, rs in JUNC.items():
    caps.append(Point(NODES[n]).buffer(max(r['width'] for r in rs) / 2, quad_segs=6))
ROAD = unary_union([road_poly(r) for r in roads] + caps)
# curb returns: close the concave corners
# the bridge's approach (Port Boulevard runs to the seawall)
ROAD = ROAD.intersection(LAND.buffer(0.5)).buffer(0)
ROAD_CORE = ROAD.intersection(CORE).buffer(0)

# ------------------------------------------------------------------ buildings
def bparts():
    out = []
    for w in WAYS:
        t = w.get('tags', {})
        if 'building' not in t and 'building:part' not in t:
            continue
        p = pts(w)
        if len(p) < 4:
            continue
        try:
            poly = Polygon(p).buffer(0)
        except Exception:
            continue
        if poly.is_empty or poly.area < 12:
            continue
        if isinstance(poly, MultiPolygon):
            poly = max(poly.geoms, key=lambda g: g.area)
        h = num(t.get('height'), 0)
        lv = num(t.get('building:levels'), 0)
        if not h:
            h = lv * 3.6 + 2 if lv else 0
        mh = num(t.get('min_height'), 0)
        mlv = num(t.get('building:min_level'), 0)
        if not mh and mlv:
            mh = mlv * 3.6 + 2
        out.append(dict(id=w['id'], part='building:part' in t, poly=poly, h=h, mh=mh, lv=lv, t=t))
    for k, (poly, t) in enumerate(rel_polys(lambda t: 'building' in t or 'building:part' in t)):
        for g in getattr(poly, 'geoms', [poly]):
            if g.geom_type != 'Polygon' or g.area < 12:
                continue
            h = num(t.get('height'), 0)
            lv = num(t.get('building:levels'), 0)
            if not h:
                h = lv * 3.6 + 2 if lv else 0
            out.append(dict(id=-1 - k, part='building:part' in t, poly=g, h=h, mh=num(t.get('min_height'), 0), lv=lv, t=t))
    return out
PARTS = bparts()
# outlines that have parts: the parts carry the shape (the outline only fills what no part covers)
outl = [b for b in PARTS if not b['part']]
parts = [b for b in PARTS if b['part']]
from shapely.strtree import STRtree
ptree = STRtree([p['poly'] for p in parts]) if parts else None
final = []
for b in outl:
    covered = None
    if ptree is not None:
        idx = ptree.query(b['poly'])
        ps = [parts[i] for i in idx if parts[i]['poly'].intersection(b['poly']).area > 0.5 * parts[i]['poly'].area]
        if ps:
            covered = unary_union([p['poly'] for p in ps])
            for p in ps:
                p['parent'] = b
    if covered is not None and covered.area > 0.85 * b['poly'].area:
        b['skip'] = True
    final.append(b)
for p in parts:
    if 'parent' in p:
        final.append(p)
bl = [b for b in final if not b.get('skip')]
# default heights by kind for the unmeasured ones
for b in bl:
    if not b['h']:
        kind = b['t'].get('building', b['t'].get('building:part', 'yes'))
        b['h'] = {'parking': 14, 'roof': 6, 'house': 7, 'detached': 7, 'garage': 4}.get(kind, rng.choice([10, 13, 16, 20, 24]))
        if kind == 'roof':
            b['mh'] = b['h'] - 1.0
print('building pieces', len(bl))

def bkind(b):
    t = b['t']
    nm = (t.get('name') or (b.get('parent') or {}).get('t', {}).get('name') or '')
    k = t.get('building') or t.get('building:part') or 'yes'
    if (b.get('parent') or {}).get('t', {}).get('building'):
        k = b['parent']['t']['building'] if k in ('yes', 'part') else k
    return nm, k

core_b, sky_b = [], []
for b in bl:
    c = b['poly'].representative_point()
    if not SKY.contains(c):
        continue
    if not LAND.buffer(8).contains(c):
        continue
    nm, k = bkind(b)
    par = b.get('parent') or b
    rec = dict(id=b['id'], pid=par['id'], name=nm, kind=k, h=round(b['h'], 2), mh=round(b['mh'], 2), lv=b['lv'], fp=pj(b['poly'].simplify(0.15)),
               col=b['t'].get('building:colour') or b['t'].get('colour') or (b.get('parent') or {}).get('t', {}).get('building:colour'),
               mat=b['t'].get('building:material') or (b.get('parent') or {}).get('t', {}).get('building:material'),
               roof=b['t'].get('roof:shape'))
    if CORE.buffer(25).contains(c):
        core_b.append(rec)
    else:
        sky_b.append(rec)
print('core buildings', len(core_b), 'skyline', len(sky_b))

# ground footprints in the core (what the sidewalks stop at)
FOOT = unary_union([Polygon(r['fp'][0], r['fp'][1:]).buffer(0) for r in core_b if r['mh'] < 1.0]).buffer(0)

# ------------------------------------------------------------------ the blocks: sidewalk, lawn, medians, plazas
BLOCKS = CORE_LAND.difference(ROAD_CORE).buffer(0)
# curb returns: round each block's corners (a median too thin to round keeps its shape)
_bl = []
for blk in polys(BLOCKS):
    o = blk.buffer(-4.5, join_style='round', quad_segs=4).buffer(4.5, join_style='round', quad_segs=4)
    _bl.append(o if o.area > 0.75 * blk.area else blk)
BLOCKS = unary_union(_bl).buffer(0)
ROAD_CORE = CORE_LAND.difference(BLOCKS).buffer(0)
greens = []
for w in WAYS:
    t = w.get('tags', {})
    if (t.get('leisure') in ('park', 'garden') or t.get('landuse') in ('grass', 'village_green') or t.get('natural') in ('scrub', 'wood')) and len(pts(w)) > 3:
        try:
            g = Polygon(pts(w)).buffer(0)
        except Exception:
            continue
        if g.intersects(CORE):
            greens.append(g)
for g, t in rel_polys(lambda t: t.get('leisure') in ('park', 'garden') or t.get('landuse') in ('grass',)):
    if g.intersects(CORE):
        greens.append(g)
GREEN = unary_union(greens).buffer(0) if greens else Polygon()
paths = []
for w in WAYS:
    t = w.get('tags', {})
    if t.get('highway') in ('footway', 'pedestrian', 'path', 'cycleway', 'steps') and len(pts(w)) > 1:
        ls = LineString(pts(w))
        if ls.intersects(GREEN):
            paths.append(ls.buffer(1.4 if t.get('highway') != 'pedestrian' else 2.5, cap_style='round', quad_segs=3))
PATHS = unary_union(paths).intersection(GREEN) if paths else Polygon()
med_l, side_l = [], []
for blk in polys(BLOCKS):
    if blk.area < 4:
        continue
    thin = blk.area / max(blk.length, 1e-3)
    has_b = blk.intersects(FOOT) and blk.intersection(FOOT).area > 20
    rr = blk.minimum_rotated_rectangle
    cc = list(rr.exterior.coords)
    e1, e2 = math.dist(cc[0], cc[1]), math.dist(cc[1], cc[2])
    short, long_ = min(e1, e2), max(e1, e2)
    strip = short < 26 and long_ > 3.5 * short and blk.area > 0.55 * rr.area
    if not has_b and (thin < 7.0 and blk.area < 12000 or strip) and not blk.intersects(GREEN.buffer(-2) if not GREEN.is_empty else Polygon()):
        med_l.append(blk)
    else:
        side_l.append(blk)
MEDIAN = unary_union(med_l).buffer(0) if med_l else Polygon()
SIDE = unary_union(side_l).buffer(0)
LAWN = SIDE.intersection(GREEN).difference(PATHS).difference(FOOT).buffer(-0.01).buffer(0.01)
# lawns keep 2 m back from the curb (the sidewalk runs round the park)
LAWN = LAWN.difference(ROAD_CORE.buffer(3.2)).buffer(0)
PAVE = SIDE.difference(FOOT).difference(LAWN).buffer(0)
# medians wide enough get grass and palms
MED_GRASS = MEDIAN.buffer(-0.8).buffer(0)
MED_GRASS = unary_union([m for m in polys(MED_GRASS) if m.area > 25]) if not MED_GRASS.is_empty else Polygon()
MED_PAVE = MEDIAN.difference(MED_GRASS).buffer(0)
print('sidewalk', round(PAVE.area), 'lawn', round(LAWN.area), 'median', round(MEDIAN.area), 'median grass', round(MED_GRASS.area))

# ------------------------------------------------------------------ markings
def offset_line(p, d):
    ls = LineString(p)
    try:
        o = ls.offset_curve(d, quad_segs=2, join_style='mitre', mitre_limit=3)
    except Exception:
        return None
    if o.is_empty:
        return None
    if o.geom_type != 'LineString':
        o = max(o.geoms, key=lambda g: g.length)
    return o

JRAD = {}
for n, rs in JUNC.items():
    JRAD[n] = max(r['width'] for r in rs) / 2 + 1.2
JZONE = unary_union([Point(NODES[n]).buffer(JRAD[n] + 2.5) for n in JUNC]) if JUNC else Polygon()
paint_w, paint_y = [], []

def dashes(line, dash=3.0, gap=9.0):
    out = []
    L = line.length
    s = 0.0
    while s < L:
        seg = substring(line, s, min(L, s + dash))
        if seg.length > 0.3:
            out.append(seg)
        s += dash + gap
    return out

def stripe(line, w):
    return line.buffer(w / 2, cap_style='flat', join_style='mitre')

for r in roads:
    if r['hw'] == 'service':
        continue
    W, n, lw = r['width'], r['lanes'], r['lw']
    base = r['pts']
    if r['oneway']:
        for k in range(1, n):
            o = offset_line(base, -W / 2 + 0.3 + k * lw)
            if o is not None:
                for seg in dashes(o):
                    paint_w.append(stripe(seg, 0.13))
        if r['hw'] in ('primary', 'secondary') and n >= 2:
            ol = offset_line(base, W / 2 - 0.35)   # left edge (yellow on a divided road)
            orr = offset_line(base, -W / 2 + 0.35)
            if ol is not None:
                paint_y.append(stripe(ol, 0.13))
            if orr is not None:
                paint_w.append(stripe(orr, 0.13))
    else:
        for side in (-1, 1):
            o = offset_line(base, side * 0.12)
            if o is not None:
                paint_y.append(stripe(o, 0.11))
        per = n // 2
        for k in range(1, per):
            for side in (-1, 1):
                o = offset_line(base, side * k * lw)
                if o is not None:
                    for seg in dashes(o):
                        paint_w.append(stripe(seg, 0.13))

# crosswalks at the signals and marked crossings: a ladder across the leg, a stop bar before it
xwalk, stopbars = [], []
signals = []   # [x, y, heading of the leg (rad, Blender), node]
def legs(n):
    out = []
    for r in JUNC.get(n, []):
        k = r['nodes'].index(n)
        p = [NODES[i] for i in r['nodes']]
        for d in (-1, 1):
            j = k + d
            if 0 <= j < len(p):
                ax, ay = p[k]
                # walk out along the way until well past the junction
                ls = LineString(p[k::d] if d > 0 else p[k::-1])
                out.append((r, ls, d))
    return out

sig_nodes = [n for n, t in NTAGS.items() if t.get('highway') == 'traffic_signals' and n in NODES and CORE.contains(Point(NODES[n]))]
cross_nodes = [n for n, t in NTAGS.items() if t.get('highway') == 'crossing' and n in NODES and CORE.contains(Point(NODES[n]))]
# group the signal nodes into intersections: the junction nearest each
inter = {}
for n in sig_nodes:
    best, bd = None, 30.0
    for j in JUNC:
        d = math.dist(NODES[n], NODES[j])
        if d < bd:
            best, bd = j, d
    if best is not None:
        inter.setdefault(best, set()).add(n)
# cluster junctions that are one intersection of a divided road (within 22 m) -> one signal controller
SIGJ = list(inter)
ctrl = []
for j in SIGJ:
    for c in ctrl:
        if any(math.dist(NODES[j], NODES[k]) < 24 for k in c):
            c.append(j)
            break
    else:
        ctrl.append([j])
xw_done = []
def crosswalk(cx, cy, hx, hy, W):
    """a ladder across a road at (cx, cy); (hx, hy) along the road; W its width"""
    for q in xw_done:
        if math.dist(q, (cx, cy)) < 4:
            return
    xw_done.append((cx, cy))
    nx, ny = -hy, hx
    bars = []
    n = int(W / 1.2)
    for i in range(n + 1):
        s = -W / 2 + i * W / max(n, 1)
        a = (cx + nx * s, cy + ny * s)
        poly = Polygon([(a[0] - hx * 1.6 - nx * 0.3, a[1] - hy * 1.6 - ny * 0.3), (a[0] + hx * 1.6 - nx * 0.3, a[1] + hy * 1.6 - ny * 0.3),
                        (a[0] + hx * 1.6 + nx * 0.3, a[1] + hy * 1.6 + ny * 0.3), (a[0] - hx * 1.6 + nx * 0.3, a[1] - hy * 1.6 + ny * 0.3)])
        bars.append(poly)
    xwalk.append(unary_union(bars))

ctrl_out = []
for ci, c in enumerate(ctrl):
    cx = sum(NODES[j][0] for j in c) / len(c)
    cy = sum(NODES[j][1] for j in c) / len(c)
    heads = []
    for j in c:
        for r, ls, d in legs(j):
            if ls.length < 6:
                continue
            # the crosswalk sits just outside the junction on this leg (if the leg leaves the cluster)
            far = None
            off = JRAD[j] + 2.2
            p0 = ls.interpolate(off)
            if any(math.dist((p0.x, p0.y), NODES[k]) < JRAD[k] - 0.5 for k in c):
                continue
            p1 = ls.interpolate(off + 1.0)
            hx, hy = p1.x - p0.x, p1.y - p0.y
            L = math.hypot(hx, hy) or 1
            hx, hy = hx / L, hy / L
            crosswalk(p0.x, p0.y, hx, hy, r['width'] - 0.4)
            # stop bar on the incoming side (traffic arriving at the junction along this leg)
            nx, ny = -hy, hx
            incoming = r['oneway'] and d < 0 or not r['oneway']
            if incoming:
                sb = ls.interpolate(off + 2.4)
                # incoming lanes are on the right of travel toward the junction: travel dir = (-hx, -hy), right = (-hy, hx)*-1
                rx, ry = hy, -hx   # right of (-hx,-hy)
                w0 = 0.0 if not r['oneway'] else -r['width'] / 2
                w1 = r['width'] / 2
                a, b2 = (sb.x + rx * (w0 + 0.2), sb.y + ry * (w0 + 0.2)), (sb.x + rx * (w1 - 0.2), sb.y + ry * (w1 - 0.2))
                if r['oneway']:
                    a, b2 = (sb.x - nx * (r['width'] / 2 - 0.2), sb.y - ny * (r['width'] / 2 - 0.2)), (sb.x + nx * (r['width'] / 2 - 0.2), sb.y + ny * (r['width'] / 2 - 0.2))
                stopbars.append(LineString([a, b2]).buffer(0.25, cap_style='flat'))
            heads.append([round(p0.x, 2), round(p0.y, 2), round(math.atan2(-hx, -hy), 3), round(r['width'], 2), 1 if r['oneway'] else 0])
    if heads:
        ctrl_out.append(dict(x=round(cx, 2), y=round(cy, 2), legs=heads))
for n in cross_nodes:
    if any(math.dist(NODES[n], NODES[j]) < 25 for c in ctrl for j in c):
        continue
    # a mid-block crossing: across whichever road the node lies on
    for r in roads:
        if n in r['nodes']:
            k = r['nodes'].index(n)
            p = [NODES[i] for i in r['nodes']]
            a, b2 = p[max(0, k - 1)], p[min(len(p) - 1, k + 1)]
            hx, hy = b2[0] - a[0], b2[1] - a[1]
            L = math.hypot(hx, hy) or 1
            crosswalk(NODES[n][0], NODES[n][1], hx / L, hy / L, r['width'] - 0.4)
            break
print('signals', len(ctrl_out), 'crosswalks', len(xwalk))
PAINT_W = unary_union(paint_w).difference(JZONE).union(unary_union(stopbars) if stopbars else Polygon())
PAINT_Y = unary_union(paint_y).difference(JZONE)
XWALK = unary_union(xwalk) if xwalk else Polygon()
PAINT_W = PAINT_W.difference(XWALK.buffer(0.6)).intersection(ROAD_CORE.buffer(-0.15))
PAINT_Y = PAINT_Y.difference(XWALK.buffer(0.6)).intersection(ROAD_CORE.buffer(-0.15))
XWALK = XWALK.intersection(ROAD_CORE.buffer(-0.2))

# ------------------------------------------------------------------ the bridge to Ocean Drive's 7th Street
# Port Boulevard's two carriageways leave the seawall by Bayside; the deck rises over the bay and lands on 7th
pb_e = [r for r in roads if r['name'] == 'Port Boulevard' and r['oneway']]
coast_pt = None
best = -1e9
for r in pb_e:
    for p in r['pts']:
        if p[0] > best and LAND.buffer(2).contains(Point(p)):
            best, coast_pt = p[0], p
print('Port Boulevard at the seawall', coast_pt)
BX0 = coast_pt[0] - 3
BY0 = coast_pt[1] + 7
BX1, BY1 = -262.0, -69.0   # 7th Street's west end (centre)
def bridge_xy(u):
    """centreline at u in 0..1: a gentle S from Port Boulevard's line onto 7th Street"""
    x = BX0 + (BX1 - BX0) * u
    s = u * u * (3 - 2 * u)
    y = BY0 + (BY1 - BY0) * s
    return x, y
def bridge_z(u):
    L = BX1 - BX0
    d = u * L
    # rises 1:22 off each shore to 7.5 m over the channel
    return min(7.5, d / 22.0, (L - d) / 22.0)
BRIDGE = [[round(bridge_xy(u)[0], 3), round(bridge_xy(u)[1], 3), round(bridge_z(u), 3)] for u in np.linspace(0, 1, 121)]
BRIDGE_W = 21.0

# ------------------------------------------------------------------ the lane graph (traffic and police)
# ways split at junctions into segments; segments trimmed by the junction radius; lanes offset to the right
segs = []
for r in roads:
    if r['hw'] == 'service':
        continue
    cut = [0] + [k for k, n in enumerate(r['nodes']) if n in JUNC and 0 < k < len(r['nodes']) - 1] + [len(r['nodes']) - 1]
    for a, b in zip(cut, cut[1:]):
        nodes = r['nodes'][a:b + 1]
        p = [NODES[i] for i in nodes]
        ls = LineString(p)
        if ls.length < 1.0:
            continue
        segs.append(dict(r=r, a=nodes[0], b=nodes[-1], line=ls))
# our side: 7th St (bridge to Washington, on to Collins), Washington Ave, 8th St, Collins Ave between 7th and 8th
OURS = [
    ('7th Street', [(-262.0, -69.0), (-220.8, -69.0)], 2, 4.5),
    ('7th Street', [(-220.8, -69.0), (-107.4, -69.0)], 2, 4.5),
    ('Washington Avenue', [(-220.8, -69.0), (-220.8, 68.2)], 2, 4.0),
    ('8th Street', [(-220.8, 68.2), (-107.4, 68.2)], 2, 4.5),
    ('Collins Avenue', [(-107.4, 68.2), (-107.4, -69.0)], 2, 5.0),
]
OUR_NODES = {}
def our_node(p):
    k = (round(p[0], 1), round(p[1], 1))
    if k not in OUR_NODES:
        OUR_NODES[k] = 'o%d' % len(OUR_NODES)
        NODES[OUR_NODES[k]] = p
    return OUR_NODES[k]
for name, p, lanes, lw in OURS:
    r = dict(id=0, name=name, pts=p, nodes=[], lanes=lanes, oneway=False, lw=lw, width=lanes * lw, hw='ours')
    segs.append(dict(r=r, a=our_node(p[0]), b=our_node(p[1]), line=LineString(p)))
# the bridge: Port Boulevard's eastbound carriageway runs on over the bay to 7th Street, the westbound comes back
pb = [r for r in roads if r['name'] == 'Port Boulevard' and r['oneway']]
eb_end = max((r['nodes'][-1] for r in pb), key=lambda n: NODES[n][0])
wb_start = max((r['nodes'][0] for r in pb), key=lambda n: NODES[n][0])
print('bridge ends', NODES[eb_end], NODES[wb_start])
def bridge_lane(side):
    """the deck's centreline shifted to one carriageway (side -1 south/eastbound, +1 north/westbound)"""
    out = []
    for u in np.linspace(0, 1, 61):
        x, y = bridge_xy(u)
        x2, y2 = bridge_xy(min(1, u + 0.01))
        if u >= 1:
            x2, y2 = x + 1, y
        L = math.hypot(x2 - x, y2 - y) or 1
        nx, ny = -(y2 - y) / L, (x2 - x) / L
        off = 5.4 + (2.4 - 5.4) * (u * u * (3 - 2 * u))
        out.append((x + nx * side * off, y + ny * side * off))
    return out
e_pts = [NODES[eb_end]] + bridge_lane(-1)[1:-1] + [(BX1, BY1 - 2.4)]
w_pts = [(BX1, BY1 + 2.4)] + bridge_lane(1)[::-1][1:-1] + [NODES[wb_start]]
for nm, p, a_, b_ in (('Port Boulevard Bridge', e_pts, eb_end, None), ('Port Boulevard Bridge', w_pts, None, wb_start)):
    a_ = a_ or our_node((BX1, BY1))
    b_ = b_ or our_node((BX1, BY1))
    r = dict(id=0, name=nm, pts=p, nodes=[], lanes=2, oneway=True, lw=3.6, width=8.0, hw='bridge')
    segs.append(dict(r=r, a=a_, b=b_, line=LineString(p)))
for k, v in list(OUR_NODES.items()):
    JRAD.setdefault(v, 7.0)

def jr(n):
    return JRAD.get(n, 0.0) if (n in JUNC or isinstance(n, str)) else 0.0

lanes = []   # dict(seg, dir, k, pts) directed
def lane_pts(seg, d, off):
    ls = seg['line'] if d > 0 else LineString(list(seg['line'].coords)[::-1])
    L = ls.length
    a0 = min(jr(seg['a'] if d > 0 else seg['b']), L * 0.3)
    b0 = min(jr(seg['b'] if d > 0 else seg['a']), L * 0.3)
    if L - a0 - b0 < 0.8:
        return None
    core = substring(ls, a0, L - b0)
    o = core.offset_curve(-off, quad_segs=2, join_style='round') if abs(off) > 1e-3 else core   # right of travel
    if o.is_empty or o.geom_type != 'LineString':
        return None
    q = list(o.coords)
    # densify to ~2 m
    out = []
    for i in range(len(q) - 1):
        n = max(1, int(math.dist(q[i], q[i + 1]) / 2))
        for k in range(n):
            out.append((q[i][0] + (q[i + 1][0] - q[i][0]) * k / n, q[i][1] + (q[i + 1][1] - q[i][1]) * k / n))
    out.append(q[-1])
    return out
for si, seg in enumerate(segs):
    r = seg['r']
    W, n, lw = r['width'], r['lanes'], r['lw']
    dirs = [1] if r['oneway'] else [1, -1]
    for d in dirs:
        nd = n if r['oneway'] else max(1, n // 2)
        for k in range(nd):
            off = (-W / 2 + lw * (k + 0.5)) if r['oneway'] else (lw * (k + 0.5) + 0.15)
            # k = 0 is the leftmost of a one-way, the innermost of a two-way
            p = lane_pts(seg, d, off if r['oneway'] else off)
            if p is None:
                continue
            frm, to = (seg['a'], seg['b']) if d > 0 else (seg['b'], seg['a'])
            # rank from the right: 0 = kerb lane
            rk = (nd - 1 - k) if r['oneway'] else (nd - 1 - k)
            lanes.append(dict(seg=si, frm=frm, to=to, k=k, rk=rk, nd=nd, pts=p, name=r['name'], hw=r['hw']))
print('lanes', len(lanes))
# connections at each junction
out_of = {}
for i, l in enumerate(lanes):
    out_of.setdefault(l['frm'], []).append(i)
def head(p, end):
    if end:
        a, b = p[-2], p[-1]
    else:
        a, b = p[0], p[1]
    return math.atan2(b[0] - a[0], b[1] - a[1])
def angd(a, b):
    return math.atan2(math.sin(b - a), math.cos(b - a))
nxt = {}
for i, l in enumerate(lanes):
    h0 = head(l['pts'], True)
    cands = []
    loose = []
    for j in out_of.get(l['to'], []):
        m = lanes[j]
        if m['seg'] == l['seg'] or (l['hw'] == 'bridge' and m['hw'] == 'bridge'):
            continue   # no U-turns
        h1 = head(m['pts'], False)
        turn = angd(h0, h1)
        if abs(turn) > 2.6:
            continue
        kind = 'S' if abs(turn) < 0.5 else ('R' if turn > 0 else 'L')
        # Blender frame: heading atan2(dx, dy), +turn = clockwise = right
        ok = (kind == 'S' and (l['nd'] == 1 or m['nd'] == 1 or abs(l['rk'] - m['rk']) <= 1 or (l['rk'] >= m['nd'] and m['rk'] == m['nd'] - 1))) or \
             (kind == 'R' and l['rk'] == 0 and m['rk'] == 0) or (kind == 'L' and l['k'] == 0 and m['k'] == 0)
        if ok:
            cands.append((j, kind))
        else:
            loose.append((j, kind, m))
    if not cands:
        # a T junction or a lane that can't go straight on: it turns from whatever lane it's in
        for j, kind, m in loose:
            if kind == 'R' and m['rk'] == 0 or kind == 'L' and m['k'] == 0 or kind == 'S':
                cands.append((j, kind))
    nxt[i] = cands
def connector(p, q):
    """cubic from the end of lane p into the start of lane q"""
    a, b = p[-1], q[0]
    h0, h1 = head(p, True), head(q, False)
    d = math.dist(a, b)
    k = d * 0.42
    c1 = (a[0] + math.sin(h0) * k, a[1] + math.cos(h0) * k)
    c2 = (b[0] - math.sin(h1) * k, b[1] - math.cos(h1) * k)
    n = max(2, int(d / 1.5))
    out = []
    for i in range(1, n):
        t = i / n
        u = 1 - t
        out.append((u ** 3 * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * b[0], u ** 3 * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * b[1]))
    return out

# loops: random walks that come back to where they began (straight on mostly), inside the core or over the bridge
CORE_IN = CORE.buffer(-12)
def lane_ok(i):
    l = lanes[i]
    if l['hw'] in ('ours', 'bridge'):
        return True
    return all(CORE_IN.contains(Point(q)) for q in (l['pts'][0], l['pts'][-1]))
import heapq
LEN = [LineString(l['pts']).length for l in lanes]
def back_path(src, dst, ban):
    """shortest lane path src -> dst (excluding src itself), avoiding lanes in ban"""
    dist = {src: 0.0}
    prev = {}
    pq = [(0.0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == dst and u != src:
            break
        if d > dist.get(u, 1e18):
            continue
        for v, k in nxt.get(u, []):
            if not lane_ok(v) or (v in ban and v != dst):
                continue
            nd = d + LEN[v] + (8 if k != 'S' else 0)
            if v == dst:
                if nd < dist.get(('end',), 1e18):
                    dist[('end',)] = nd
                    prev[('end',)] = u
                continue
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    if ('end',) not in prev:
        return None
    out = []
    u = prev[('end',)]
    while u != src:
        out.append(u)
        u = prev[u]
    return out[::-1]
routes = []
used = {}
starts = [i for i in range(len(lanes)) if lane_ok(i) and nxt.get(i)]
rng.shuffle(starts)
# the bridge lanes first: some of the traffic crosses to the beach
starts.sort(key=lambda i: 0 if lanes[i]['hw'] == 'bridge' else 1)
for start in starts:
    if len(routes) >= 24:
        break
    if used.get(start, 0) >= 1 and lanes[start]['hw'] != 'bridge':
        continue
    if lanes[start]['hw'] == 'bridge' and sum(1 for r in routes if r['bridge']) >= 4:
        continue
    for attempt in range(25):
        path = [start]
        seen = {start}
        cur = start
        L = LEN[start]
        goal = rng.uniform(500, 1400)
        while L < goal:
            c = [(j, k) for j, k in nxt.get(cur, []) if lane_ok(j) and j not in seen]
            if not c:
                break
            wts = [{'S': 6.0, 'R': 2.0, 'L': 1.4}[k] / (1 + used.get(j, 0) * 1.5) for j, k in c]
            x = rng.random() * sum(wts)
            for (j, k), w in zip(c, wts):
                x -= w
                if x <= 0:
                    break
            path.append(j)
            seen.add(j)
            L += LEN[j]
            cur = j
        if L < goal:
            continue
        back = back_path(cur, start, seen)
        if back is None:
            continue
        path += back
        L += sum(LEN[j] for j in back)
        if len(set(path)) != len(path) or L > 5000:
            continue
        for j in path:
            used[j] = used.get(j, 0) + 1
        poly = []
        for a_, b_ in zip(path, path[1:] + [path[0]]):
            poly += lanes[a_]['pts'] + connector(lanes[a_]['pts'], lanes[b_]['pts'])
        routes.append(dict(pts=[[round(x, 2), round(y, 2)] for x, y in poly], len=round(L), bridge=any(lanes[j]['hw'] == 'bridge' for j in path),
                           names=sorted({lanes[j]['name'] for j in path})))
        break
print('routes', len(routes), [(r['len'], r['bridge']) for r in routes])

# police graph: every drivable segment, both ways (they drive on the wrong side when they must)
G_nodes = {}
def gid(n):
    if n not in G_nodes:
        G_nodes[n] = len(G_nodes)
    return G_nodes[n]
G_edges = []
for seg in segs:
    p = list(seg['line'].coords)
    G_edges.append([gid(seg['a']), gid(seg['b']), [[round(x, 2), round(y, 2)] for x, y in p], round(seg['r']['width'], 2)])
G_pts = [None] * len(G_nodes)
for n, i in G_nodes.items():
    G_pts[i] = [round(NODES[n][0], 2), round(NODES[n][1], 2)]

# ------------------------------------------------------------------ people: walking lines along the sidewalks
walks = []
inner = PAVE.buffer(-0.01)
for blk in polys(SIDE):
    for d in (2.0,):
        sh = blk.buffer(-d, join_style='mitre')
        for p in polys(sh):
            ln = LineString(p.exterior.coords)
            # keep the parts outside buildings and inside the core
            ok = ln.difference(FOOT.buffer(0.8)).intersection(CORE.buffer(-6))
            for g in getattr(ok, 'geoms', [ok]):
                if g.geom_type == 'LineString' and g.length > 25:
                    q = g.simplify(0.5)
                    walks.append([[round(x, 2), round(y, 2)] for x, y in q.coords])
# park paths
for w in WAYS:
    t = w.get('tags', {})
    if t.get('highway') in ('footway', 'pedestrian', 'path') and len(pts(w)) > 1:
        ls = LineString(pts(w))
        if ls.within(GREEN.buffer(1)) and ls.within(CORE) and ls.length > 20:
            walks.append([[round(x, 2), round(y, 2)] for x, y in ls.simplify(0.5).coords])
print('walk lines', len(walks), round(sum(LineString(w).length for w in walks)))

# ------------------------------------------------------------------ street furniture: palms, lamps, trees
def along(line, step, off=0.0):
    L = line.length
    s = step * 0.5
    while s < L:
        p = line.interpolate(s)
        q = line.interpolate(min(L, s + 0.5))
        yield p.x, p.y, math.atan2(q.x - p.x, q.y - p.y)
        s += step
palms_l, lamps_l, trees_l = [], [], []
# the boulevard's median: royal palms down the middle
for m in polys(MED_GRASS):
    # the median's long axis: its minimum rotated rectangle
    rr = m.minimum_rotated_rectangle
    c = list(rr.exterior.coords)
    e1, e2 = (c[0], c[1]), (c[1], c[2])
    a, b = (e1 if math.dist(*e1) > math.dist(*e2) else e2)
    L = math.dist(a, b)
    if L < 14:
        continue
    cx, cy = m.centroid.x, m.centroid.y
    ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    s = -L / 2 + 5
    while s < L / 2 - 5:
        x, y = cx + ux * s, cy + uy * s
        if m.buffer(-0.6).contains(Point(x, y)):
            palms_l.append([round(x, 2), round(y, 2), 'royal'])
        s += 9.0
# sidewalk palms and street lights: a line 1.2 m in from the curb
for blk in polys(SIDE):
    sh = blk.buffer(-1.3, join_style='mitre')
    for p in polys(sh):
        ln = LineString(p.exterior.coords)
        near_road = ln.intersection(ROAD_CORE.buffer(2.0))
        for g in getattr(near_road, 'geoms', [near_road]):
            if g.geom_type != 'LineString' or g.length < 10:
                continue
            for x, y, h in along(g, 28.0):
                if FOOT.buffer(1.5).contains(Point(x, y)) or JZONE.buffer(3).contains(Point(x, y)) or not CORE.contains(Point(x, y)):
                    continue
                lamps_l.append([round(x, 2), round(y, 2), round(h, 3)])
            for x, y, h in along(g, 11.0):
                if rng.random() < 0.35 or FOOT.buffer(2.5).contains(Point(x, y)) or JZONE.buffer(5).contains(Point(x, y)) or not CORE.contains(Point(x, y)):
                    continue
                if any(math.dist((x, y), q[:2]) < 4 for q in lamps_l[-6:]):
                    continue
                palms_l.append([round(x, 2), round(y, 2), 'sidewalk'])
# park trees: palms in groves on the lawns, shade trees along the paths
for g in polys(LAWN):
    if g.area < 60:
        continue
    n = int(g.area / 260)
    minx, miny, maxx, maxy = g.bounds
    k = 0
    for _ in range(n * 6):
        if k >= n:
            break
        x, y = rng.uniform(minx, maxx), rng.uniform(miny, maxy)
        if g.buffer(-2).contains(Point(x, y)) and not any(math.dist((x, y), q[:2]) < 6 for q in palms_l[-40:]):
            palms_l.append([round(x, 2), round(y, 2), 'park'])
            k += 1
print('palms', len(palms_l), 'lamps', len(lamps_l))

# ------------------------------------------------------------------ the Metromover (elevated, on the core's streets)
mover = []
for w in WAYS:
    t = w.get('tags', {})
    if t.get('railway') == 'monorail' and len(pts(w)) > 1:
        ls = LineString(pts(w))
        if ls.intersects(CORE.buffer(40)):
            mover.append([[round(x, 2), round(y, 2)] for x, y in ls.simplify(0.3).coords])
print('metromover lines', len(mover))

# ------------------------------------------------------------------ skyline ground: other streets (flat ribbons), land
sky_roads = []
for w in WAYS:
    t = w.get('tags', {})
    hw = t.get('highway')
    if hw in DRIVE or hw in ('motorway', 'motorway_link', 'trunk', 'trunk_link'):
        p = pts(w)
        if len(p) < 2:
            continue
        ls = LineString(p)
        if not ls.intersects(SKY) or ls.within(CORE.buffer(-5)):
            continue
        # only what's over the land (the causeways would run out over the narrowed bay)
        ls = ls.intersection(LAND.buffer(4))
        if ls.is_empty:
            continue
        if ls.geom_type != 'LineString':
            parts = [g for g in getattr(ls, 'geoms', []) if g.geom_type == 'LineString' and g.length > 4]
            if not parts:
                continue
            ls = max(parts, key=lambda g: g.length)
        dl, lw = DRIVE.get(hw, (4, 3.6))
        lanes_n = int(num(t.get('lanes'), 0)) or dl
        elev = t.get('bridge') == 'yes' or num(t.get('layer'), 0) > 0
        sky_roads.append(dict(pts=[[round(x, 2), round(y, 2)] for x, y in ls.simplify(0.8).coords], w=round(lanes_n * lw + 0.6, 2), hw=hw, elev=bool(elev), layer=num(t.get('layer'), 0)))
print('skyline roads', len(sky_roads))

# ------------------------------------------------------------------ triangles for Blender
import mapbox_earcut as earcut
def tris(g, simplify=0.05):
    """polygons -> {'v': [[x, y]...], 't': [i...]} (earcut, holes kept)"""
    V, T = [], []
    for p in polys(g.simplify(simplify) if simplify else g):
        rings = [list(p.exterior.coords)[:-1]] + [list(h.coords)[:-1] for h in p.interiors]
        rings = [r for r in rings if len(r) >= 3]
        if not rings:
            continue
        flat = np.array([q for r in rings for q in r], dtype=np.float64)
        ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
        idx = earcut.triangulate_float64(flat, ends)
        base = len(V)
        V += [[round(x, 3), round(y, 3)] for x, y in flat]
        T += [int(i) + base for i in idx]
    return dict(v=V, t=T)
BLK = unary_union([SIDE, MEDIAN]).buffer(0)
CURB = BLK.difference(BLK.buffer(-0.32, join_style='mitre')).buffer(0)
inner = lambda g: g.difference(CURB).buffer(0)
curb_rings = []
from shapely.geometry.polygon import orient
for p in polys(BLK):
    p = orient(p, 1.0)
    for r in [p.exterior] + list(p.interiors):
        q = list(r.simplify(0.05).coords)
        curb_rings.append([[round(x, 3), round(y, 3)] for x, y in q])
# the seawall: where the core's land meets the bay
sea_lines = []
coast = LAND.boundary.intersection(CORE.buffer(-0.5))
for g in getattr(coast, 'geoms', [coast]):
    if g.geom_type == 'LineString' and g.length > 2:
        sea_lines.append([[round(x, 3), round(y, 3)] for x, y in g.simplify(0.2).coords])
# Metromover columns: every ~28 m along the guideway, never in the road
mover_cols = []
for ln in mover:
    ls = LineString(ln)
    s_ = 6.0
    while s_ < ls.length:
        p = ls.interpolate(s_)
        if not ROAD_CORE.buffer(0.8).contains(p) and LAND.contains(p):
            mover_cols.append([round(p.x, 2), round(p.y, 2)])
            s_ += 28.0
        else:
            s_ += 3.0
# Miami Beach beyond the modelled blocks (north and south along the island), from the block's own OSM
import geo
_bd = json.load(open(os.path.join(os.path.dirname(HERE), 'data', 'osm_beach.json')))
_bn = {e['id']: geo.L(geo.raw(e['lat'], e['lon'])) for e in _bd['elements'] if e['type'] == 'node'}
beach_sky = []
for w in _bd['elements']:
    if w['type'] != 'way' or 'tags' not in w:
        continue
    t = w['tags']
    if 'building' not in t and 'building:part' not in t:
        continue
    q = [_bn[i] for i in w['nodes'] if i in _bn]
    if len(q) < 4:
        continue
    try:
        poly = Polygon(q).buffer(0)
    except Exception:
        continue
    if poly.is_empty or poly.area < 15:
        continue
    if isinstance(poly, MultiPolygon):
        poly = max(poly.geoms, key=lambda g: g.area)
    c = poly.representative_point()
    if not (-262 < c.x < 160):
        continue
    if -345 < c.y < 435 and c.x < 140:
        continue   # the modelled city
    h = num(t.get('height'), 0)
    lv = num(t.get('building:levels'), 0)
    if not h:
        h = lv * 3.3 + 1.5 if lv else rng.choice([9, 11, 12.5, 14, 16])
    beach_sky.append(dict(id=w['id'], name=t.get('name', ''), kind=t.get('building', 'yes'), h=round(h, 2), mh=round(num(t.get('min_height'), 0), 2), fp=pj(poly.simplify(0.2))))
print('beach skyline', len(beach_sky), 'tallest', sorted([b['h'] for b in beach_sky])[-5:])
# ------------------------------------------------------------------ write
def mp(g):
    return [pj(p) for p in polys(g)]
dt = dict(
    tx=TX, ty=TY, core=ring(CORE), land=mp(LAND.intersection(SKY).simplify(0.5)), core_land=mp(CORE_LAND),
    road=mp(ROAD_CORE), pave=mp(PAVE), lawn=mp(LAWN), paths=mp(PATHS.intersection(CORE)), med_grass=mp(MED_GRASS), med_pave=mp(MED_PAVE),
    paint_w=mp(PAINT_W), paint_y=mp(PAINT_Y), xwalk=mp(XWALK), foot=mp(FOOT),
    buildings=core_b, skyline=sky_b, sky_roads=sky_roads, palms=palms_l, lamps=lamps_l, mover=mover,
    bridge=BRIDGE, bridge_w=BRIDGE_W, signals=ctrl_out,
    tri=dict(road=tris(ROAD_CORE), pave=tris(inner(PAVE)), lawn=tris(inner(LAWN)), paths=tris(inner(PATHS.intersection(CORE).intersection(BLK))),
             med_grass=tris(inner(MED_GRASS)), med_pave=tris(inner(MED_PAVE)), curb=tris(CURB, 0), paint_w=tris(PAINT_W, 0.02), paint_y=tris(PAINT_Y, 0.02),
             xwalk=tris(XWALK, 0.02), skyland=tris(LAND.intersection(SKY).difference(CORE).buffer(0), 0.5)),
    curb_rings=curb_rings, sea_lines=sea_lines, mover_cols=mover_cols, beach_sky=beach_sky,
)
json.dump(dt, open(os.path.join(WORK, 'dt.json'), 'w'))
game = dict(
    tx=TX, ty=TY, core=ring(CORE), bridge=BRIDGE, bridge_w=BRIDGE_W, routes=routes, signals=ctrl_out, walks=walks,
    lamps=[[p[0], p[1]] for p in lamps_l],
    graph=dict(pts=G_pts, edges=G_edges),
)
json.dump(game, open(os.path.join(PUB, 'downtown.json'), 'w'))
print('wrote dt.json', os.path.getsize(os.path.join(WORK, 'dt.json')) // 1024, 'KB; downtown.json', os.path.getsize(os.path.join(PUB, 'downtown.json')) // 1024, 'KB')

# ------------------------------------------------------------------ a picture to check it
if '--viz' in sys.argv:
    from viz import Viz
    v = Viz(-1320, -480, -1280, 60, 1.2)
    v.poly(CORE_LAND, (70, 70, 70))
    v.poly(ROAD_CORE, (45, 45, 48))
    v.poly(PAVE, (150, 148, 140))
    v.poly(LAWN, (80, 140, 70))
    v.poly(MED_GRASS, (60, 160, 60))
    v.poly(MED_PAVE, (180, 170, 150))
    v.poly(FOOT, (90, 120, 170))
    v.poly(PAINT_W, (255, 255, 255))
    v.poly(PAINT_Y, (240, 200, 0))
    v.poly(XWALK, (255, 255, 255))
    for r in routes[:8]:
        v.line([tuple(q) for q in r['pts']], (255, 0, 200), 1)
    for p in palms_l:
        v.d.ellipse([*(a - 1.5 for a in v.T(p)), *(a + 1.5 for a in v.T(p))], fill=(0, 255, 0))
    for c in ctrl_out:
        v.d.ellipse([*(a - 3 for a in v.T((c['x'], c['y']))), *(a + 3 for a in v.T((c['x'], c['y'])))], outline=(255, 0, 0))
    v.save(os.path.join(WORK, 'dt_ground.png'))
