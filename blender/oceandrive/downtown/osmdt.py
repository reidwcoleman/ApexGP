"""Downtown Miami OSM in the game's frame: the same local frame as Ocean Drive (geo.L), moved east by
(TX, TY) so the downtown waterfront sits across a narrowed Biscayne Bay from the block (Port Boulevard's
bridge lands on 7th Street). All coordinates here are final Blender metres."""
import json, os, sys, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import geo
TX, TY = 4633.0, 644.0
_d = json.load(open(os.path.join(os.path.dirname(HERE), 'data', 'osm_downtown.json')))
NODES = {}
NTAGS = {}
for e in _d['elements']:
    if e['type'] == 'node':
        x, y = geo.L(geo.raw(e['lat'], e['lon']))
        NODES[e['id']] = (x + TX, y + TY)
        if 'tags' in e:
            NTAGS[e['id']] = e['tags']
WAYS = [e for e in _d['elements'] if e['type'] == 'way']
WAY = {w['id']: w for w in WAYS}
RELS = [e for e in _d['elements'] if e['type'] == 'relation']

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
