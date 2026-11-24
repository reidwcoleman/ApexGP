"""Downtown Miami OSM in the game's frame: the same local frame as Ocean Drive (geo.L), moved east by
(TX, TY) so the downtown waterfront sits across a narrowed Biscayne Bay from the block (Port Boulevard's
bridge lands on 7th Street). All coordinates here are final Blender metres."""
import json, os, sys, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import geo
# which side of the bay: 'main' (downtown, Brickell, Edgewater... moved east by TX, TY) or 'beach' (Miami
# Beach, in the block's own frame). OD_FRAME picks it.
FRAME = os.environ.get('OD_FRAME', 'main')
TX, TY = (4633.0, 644.0) if FRAME == 'main' else (0.0, 0.0)
FILES = os.environ['OD_OSM'].split(',') if os.environ.get('OD_OSM') else (['osm_downtown.json', 'osm_north.json', 'osm_west.json'] if FRAME == 'main' else ['osm_mb.json'])
NODES = {}
NTAGS = {}
_seen = set()
WAYS = []
RELS = []
for fn in FILES:
    p = os.path.join(os.path.dirname(HERE), 'data', fn)
    if not os.path.exists(p):
        continue
    _d = json.load(open(p))
    for e in _d['elements']:
        k = (e['type'], e['id'])
        if k in _seen:
            continue
        _seen.add(k)
        if e['type'] == 'node':
            x, y = geo.L(geo.raw(e['lat'], e['lon']))
            NODES[e['id']] = (x + TX, y + TY)
            if 'tags' in e:
                NTAGS[e['id']] = e['tags']
        elif e['type'] == 'way':
            WAYS.append(e)
        elif e['type'] == 'relation':
            RELS.append(e)
    del _d
WAY = {w['id']: w for w in WAYS}

def pts(w):
    return [NODES[i] for i in w['nodes'] if i in NODES]

def num(s, d=0.0):
    try:
        return float(str(s).split()[0].replace(',', '.').rstrip('m'))
    except (ValueError, AttributeError, IndexError):
        return d

def rel_polys(pred):
    """multipolygon relations whose tags satisfy pred -> [(polygon, tags)]"""
    from shapely.geometry import LineString, Polygon
    from shapely.ops import polygonize, unary_union
    out = []
    for r in RELS:
        t = r.get('tags', {})
        if t.get('type') != 'multipolygon' or not pred(t):
            continue
        outer, inner = [], []
        for m in r.get('members', []):
            if m['type'] != 'way' or m['ref'] not in WAY:
                continue
            p = pts(WAY[m['ref']])
            if len(p) < 2:
                continue
            (inner if m.get('role') == 'inner' else outer).append(LineString(p))
        try:
            po = unary_union(list(polygonize(unary_union(outer)))) if outer else None
            if po is None or po.is_empty:
                continue
            if inner:
                pi = unary_union(list(polygonize(unary_union(inner))))
                po = po.difference(pi)
            out.append((po.buffer(0), t))
        except Exception:
            pass
    return out
