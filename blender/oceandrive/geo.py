"""OSM -> local metres. Frame: origin on Ocean Drive's centreline at the middle of the 7th-8th block,
+Y along Ocean Drive (north-north-east), +X across it toward the ocean, Z up (Blender)."""
import json, math, os
HERE = os.path.dirname(os.path.abspath(__file__))
LAT0, LON0 = 25.7775, -80.1316
KX = math.cos(math.radians(LAT0)) * 111320.0
KY = 110540.0

def raw(lat, lon):
    return ((lon - LON0) * KX, (lat - LAT0) * KY)

def load():
    d = json.load(open(os.path.join(HERE, 'data', 'osm.json')))
    nodes = {e['id']: e for e in d['elements'] if e['type'] == 'node'}
    ways = [e for e in d['elements'] if e['type'] == 'way' and 'tags' in e]
    return nodes, ways

NODES, WAYS = load()

def way_pts(w):
    return [raw(NODES[i]['lat'], NODES[i]['lon']) for i in w['nodes'] if i in NODES]

# Ocean Drive's bearing from its own centreline
_od = [p for w in WAYS if w['tags'].get('name') == 'Ocean Drive' for p in way_pts(w)]
_od.sort(key=lambda p: p[1])
# the block's own stretch (7th to 8th) sets the bearing, so the street is exactly along +Y here
_od = [p for p in _od if -120 < p[1] < 160] or _od
_dx, _dy = _od[-1][0] - _od[0][0], _od[-1][1] - _od[0][1]
ANG = math.atan2(_dx, _dy)  # rotation that maps the road direction onto +Y
_c, _s = math.cos(ANG), math.sin(ANG)

def rot(p):
    x, y = p
    return (x * _c - y * _s, x * _s + y * _c)

def street_x(name):
    """mean local coordinate of a named way (after rotation)"""
    pts = [rot(p) for w in WAYS if w['tags'].get('name') == name for p in way_pts(w)]
    return pts

def local(lat, lon):
    return rot(raw(lat, lon))

# shift so the origin sits on Ocean Drive, mid-block between 7th and 8th
def _mid():
    od = [rot(p) for p in _od]
    x0 = sum(p[0] for p in od) / len(od)
    def cross_y(name):
        pts = [rot(p) for w in WAYS if w['tags'].get('name') == name for p in way_pts(w)]
        near = [p for p in pts if abs(p[0] - x0) < 30]
        return sum(p[1] for p in near) / len(near)
    y7, y8 = cross_y('7th Street'), cross_y('8th Street')
    return x0, (y7 + y8) / 2, y7, y8

OX, OY, _Y7, _Y8 = _mid()
Y7, Y8 = _Y7 - OY, _Y8 - OY

def L(p):
    q = rot(p)
    return (q[0] - OX, q[1] - OY)

def way_local(w):
    return [L(p) for p in way_pts(w)]

if __name__ == '__main__':
    print('bearing deg', math.degrees(ANG), 'Y7', Y7, 'Y8', Y8)
    for nm in ['Ocean Drive', '7th Street', '8th Street', 'Collins Avenue', 'Ocean Court', 'Lummus Park Boardwalk', '6th Street', '9th Street']:
        pts = [p for w in WAYS if w['tags'].get('name') == nm for p in way_local(w)]
        if pts:
            print(nm, 'x', round(min(p[0] for p in pts)), round(max(p[0] for p in pts)), 'y', round(min(p[1] for p in pts)), round(max(p[1] for p in pts)))
    for w in WAYS:
        t = w['tags']
        if t.get('natural') in ('coastline', 'beach', 'sand') or t.get('leisure') == 'park':
            pts = way_local(w)
            print(t.get('natural') or t.get('leisure'), t.get('name', ''), len(pts), 'x', round(min(p[0] for p in pts)), round(max(p[0] for p in pts)), 'y', round(min(p[1] for p in pts)), round(max(p[1] for p in pts)))
    for w in WAYS:
        t = w['tags']
        if 'building' in t:
            pts = way_local(w)
            cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
            if -60 < cx < 20 and -140 < cy < 140:
                print('B', w['id'], t.get('name', ''), t.get('addr:housenumber', ''), t.get('addr:street', ''), 'h', t.get('height', ''), 'lv', t.get('building:levels', ''), 'x', round(min(p[0] for p in pts), 1), round(max(p[0] for p in pts), 1), 'y', round(min(p[1] for p in pts), 1), round(max(p[1] for p in pts), 1), 'n', len(pts))
