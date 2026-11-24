import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from osmdt import *
from shapely.geometry import LineString, Polygon, box, Point
from shapely.ops import unary_union, polygonize
# working extent (final coords): downtown + Brickell + Edgewater, the bay to the east of it
EXT = box(-3400, -2900, -300, 1500)
def land_and_water():
    lines = [LineString(pts(w)) for w in WAYS if w.get('tags', {}).get('natural') == 'coastline' and len(pts(w)) > 1]
    lines.append(EXT.exterior)
    faces = list(polygonize(unary_union(lines)))
    bnodes = [Point(NODES[w['nodes'][0]]) for w in WAYS if 'building' in w.get('tags', {}) and w['nodes'][0] in NODES]
    land = []
    for f in faces:
        if not f.within(EXT.buffer(1)):
            continue
        n = sum(1 for p in bnodes[::7] if f.contains(p))
        land.append((f, n))
    return land
if __name__ == '__main__':
    for f, n in sorted(land_and_water(), key=lambda a: -a[0].area)[:30]:
        c = f.representative_point()
        print(round(f.area), n, round(c.x), round(c.y))
