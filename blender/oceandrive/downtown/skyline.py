"""The county's skyline: every building, street and patch of land the playable tiles don't model in detail,
grouped by tile (shown while that tile isn't loaded) or 'far' (always shown).

  work/venv/bin/python downtown/skyline.py   -> work/skyline.json (for build_sky.py)

Mainland (downtown, Brickell, Edgewater, Overtown, Little Havana) in the moved frame; Miami Beach east of
the narrowed bay in the block's own frame."""
import json, math, os, sys, random, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
TILES = json.load(open(os.path.join(HERE, 'tiles.json')))
WORK = os.path.join(os.path.dirname(HERE), 'work')
from shapely.geometry import Polygon, MultiPolygon, LineString, Point, box
from shapely.ops import unary_union
from shapely.strtree import STRtree
import numpy as np
import mapbox_earcut as earcut


def num(s, d=0.0):
    try:
        return float(str(s).split()[0].replace(',', '.').rstrip('m'))
    except (ValueError, AttributeError, IndexError):
        return d


def polys(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    return [p for p in getattr(g, 'geoms', []) if isinstance(p, Polygon) and not p.is_empty]


def pj(p):
    return [[[round(x, 2), round(y, 2)] for x, y in list(p.exterior.coords)[:-1]]]


def tris(g, simplify=0.5):
    V, T = [], []
    for p in polys(g.simplify(simplify)):
        rings = [list(p.exterior.coords)[:-1]] + [list(h.coords)[:-1] for h in p.interiors]
        rings = [r for r in rings if len(r) >= 3]
        if not rings:
            continue
        flat = np.array([q for r in rings for q in r], dtype=np.float64)
        ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
        idx = earcut.triangulate_float64(flat, ends)
        base = len(V)
        V += [[round(x, 2), round(y, 2)] for x, y in flat]
        T += [int(i) + base for i in idx]
    return dict(v=V, t=T)


def load(frame, files):
    os.environ['OD_FRAME'] = frame
    os.environ['OD_OSM'] = ','.join(files)
    for m in ('osmdt', 'land'):
        sys.modules.pop(m, None)
    import osmdt
    return osmdt


def buildings(O, keep):
    """parts and outlines as in prep.py: an outline whose parts cover it gives way to them"""
    out = []
    for w in O.WAYS:
        t = w.get('tags', {})
        if 'building' not in t and 'building:part' not in t:
            continue
        p = O.pts(w)
        if len(p) < 4:
            continue
        try:
            poly = Polygon(p).buffer(0)
        except Exception:
            continue
        if poly.is_empty or poly.area < 15:
            continue
        if isinstance(poly, MultiPolygon):
            poly = max(poly.geoms, key=lambda g: g.area)
        if not keep(poly):
            continue
        h = num(t.get('height'), 0)
        lv = num(t.get('building:levels'), 0)
        if not h:
            h = lv * 3.6 + 2 if lv else 0
        mh = num(t.get('min_height'), 0)
        out.append(dict(id=w['id'], part='building:part' in t, poly=poly, h=h, mh=mh, t=t))
    outl = [b for b in out if not b['part']]
    parts = [b for b in out if b['part']]
    tree = STRtree([p['poly'] for p in parts]) if parts else None
    res = []
    for b in outl:
        if tree is not None:
            ps = [parts[i] for i in tree.query(b['poly']) if parts[i]['poly'].intersection(b['poly']).area > 0.5 * parts[i]['poly'].area]
            for q in ps:
                q['pid'] = b['id']
                q['kind'] = b['t'].get('building', 'yes')
                q['name'] = b['t'].get('name', '')
            if ps and unary_union([q['poly'] for q in ps]).area > 0.85 * b['poly'].area:
                continue
        res.append(b)
    res += [q for q in parts if 'pid' in q]
    rng = random.Random(77)
    for b in res:
        if not b['h']:
            b['h'] = rng.choice([8, 10, 12, 14, 17, 21])
    return res


def rec(b):
    return dict(id=b['id'], pid=b.get('pid', b['id']), name=b.get('name') or b['t'].get('name', ''), kind=b.get('kind') or b['t'].get('building') or b['t'].get('building:part', 'yes'),
                h=round(b['h'], 1), mh=round(b['mh'], 1), fp=pj(b['poly'].simplify(0.6)), col=b['t'].get('building:colour'))


groups = {}
def grp(name):
    return groups.setdefault(name, dict(buildings=[], land=dict(v=[], t=[]), roads=[]))


# ------------------------------------------------------------------ mainland
O = load('main', ['osm_downtown.json', 'osm_north.json', 'osm_west.json'])
os.environ['OD_EXT'] = '-3600,-3200,-300,3300'
import land as LANDM
lands = LANDM.land_and_water()
LAND = max(lands, key=lambda a: a[0].area)[0]
water = []
for w in O.WAYS:
    t = w.get('tags', {})
    if (t.get('natural') == 'water' or t.get('waterway') == 'riverbank') and len(O.pts(w)) > 3:
        try:
            g = Polygon(O.pts(w)).buffer(0)
            if g.area > 3000:
                water.append(g)
        except Exception:
            pass
for g, t in O.rel_polys(lambda t: t.get('natural') == 'water' or t.get('waterway') == 'riverbank'):
    if g.area > 3000:
        water.append(g.buffer(0))
LAND = LAND.difference(unary_union(water)).buffer(0)
# the coastline doesn't close everywhere once the map files are joined: along the bay side, land with
# nothing on it (no building, street or footpath within 50 m) is taken for water
urban = []
for w in O.WAYS:
    t = w.get('tags', {})
    p = O.pts(w)
    if len(p) < 2:
        continue
    xs = [q[0] for q in p]
    if min(xs) < -1100:
        continue
    if 'building' in t or t.get('highway') in ('footway', 'pedestrian', 'path', 'cycleway', 'service', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'trunk', 'motorway'):
        if t.get('bridge') == 'yes':
            continue
        urban.append(LineString(p).buffer(50))
URB = unary_union(urban)
edge = LAND.intersection(box(-1100, -3200, -300, 3300))
LAND = LAND.difference(edge.difference(URB)).buffer(0)
SKY = box(-3600, -3200, -480, 3300)
LAND = LAND.intersection(SKY).buffer(0)
mtiles = {k: Polygon(v['core']) for k, v in TILES.items() if v.get('frame', 'main') == 'main'}
tree_t = list(mtiles.items())

def tile_of(pt):
    for k, c in tree_t:
        if c.contains(pt):
            return k
    return 'far'

bl = buildings(O, lambda p: SKY.contains(p.representative_point()) and LAND.buffer(8).contains(p.representative_point()))
for b in bl:
    grp(tile_of(b['poly'].representative_point()))['buildings'].append(rec(b))
print('mainland buildings', len(bl), {k: len(v['buildings']) for k, v in groups.items()})
# land: each tile's own patch (hidden with its skyline), the rest far
rest = LAND
for k, c in mtiles.items():
    g = LAND.intersection(c).buffer(0)
    grp(k)['land'] = tris(g)
    rest = rest.difference(c)
grp('far')['land'] = tris(rest.buffer(0))
# streets as flat ribbons (and elevated expressways), by tile
DRIVE = {'primary': 4, 'secondary': 3, 'tertiary': 2, 'residential': 2, 'unclassified': 2, 'motorway': 4, 'motorway_link': 1, 'trunk': 4, 'trunk_link': 1, 'primary_link': 1}
for w in O.WAYS:
    t = w.get('tags', {})
    hw = t.get('highway')
    if hw not in DRIVE:
        continue
    p = O.pts(w)
    if len(p) < 2:
        continue
    ls = LineString(p).intersection(LAND.buffer(4))
    if ls.is_empty:
        continue
    for g in getattr(ls, 'geoms', [ls]):
        if g.geom_type != 'LineString' or g.length < 4:
            continue
        lanes = int(num(t.get('lanes'), 0)) or DRIVE[hw]
        elev = t.get('bridge') == 'yes' or num(t.get('layer'), 0) > 0
        grp(tile_of(g.interpolate(0.5, normalized=True)))['roads'].append(dict(pts=[[round(x, 2), round(y, 2)] for x, y in g.simplify(0.8).coords], w=round(lanes * 3.4 + 0.6, 1), elev=bool(elev), layer=num(t.get('layer'), 0)))

# ------------------------------------------------------------------ Miami Beach (east of the narrowed bay)
O = load('beach', ['osm_mb.json'])
btiles = {k: Polygon(v['core']) for k, v in TILES.items() if v.get('frame') == 'beach'}
def btile_of(pt):
    for k, c in btiles.items():
        if c.contains(pt):
            return k
    return 'far'
def keep_b(p):
    c = p.representative_point()
    if not (-262 < c.x < 160):
        return False
    if -345 < c.y < 435 and c.x < 140:
        return False   # the modelled blocks
    return True
bb = buildings(O, keep_b)
for b in bb:
    grp(btile_of(b['poly'].representative_point()))['buildings'].append(rec(b))
print('beach buildings', len(bb))

json.dump(dict(groups=groups, tiles={k: v.get('frame', 'main') for k, v in TILES.items()}), open(os.path.join(WORK, 'skyline.json'), 'w'))
print('skyline.json', os.path.getsize(os.path.join(WORK, 'skyline.json')) // 1024, 'KB', {k: (len(v['buildings']), len(v['roads'])) for k, v in groups.items()})
