"""Marinas: the docks (OSM piers) and where boats lie alongside them, plus loops in the bay for boats under way.
  work/venv/bin/python downtown/marina.py -> work/marina.json (docks for Blender), public/oceandrive/marina.json"""
import json, os, sys, math, random
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ['OD_FRAME'] = 'main'
os.environ['OD_OSM'] = 'osm_downtown.json,osm_north.json'
os.environ['OD_EXT'] = '-3600,-3200,-300,3300'
from osmdt import WAYS, pts
import land as LANDM
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union
WORK = os.path.join(os.path.dirname(HERE), 'work')
PUB = os.path.join(os.path.dirname(HERE), '..', '..', 'public', 'oceandrive')
rng = random.Random(31)
LAND = max(LANDM.land_and_water(), key=lambda a: a[0].area)[0]
BOX = (-1400, -2700, -300, 1600)
piers = []
for w in WAYS:
    t = w.get('tags', {})
    if t.get('man_made') != 'pier':
        continue
    p = pts(w)
    if len(p) < 2:
        continue
    ls = LineString(p)
    x0, y0, x1, y1 = ls.bounds
    if x0 < BOX[0] or x1 > BOX[2] or y0 < BOX[1] or y1 > BOX[3]:
        continue
    if ls.within(LAND.buffer(-2)):
        continue
    piers.append(ls)
print('piers', len(piers))
docks = [[[round(x, 2), round(y, 2)] for x, y in ls.coords] for ls in piers]
deck = unary_union([ls.buffer(1.3, cap_style='flat') for ls in piers])
# boats alongside: both sides of every dock stretch long enough, never on land or another dock
MODELS = [('yacht', 18.0, 5.2), ('cruiser', 12.5, 4.0), ('console', 8.5, 2.8), ('sail', 11.5, 3.6), ('super', 34.0, 8.0)]
moored = []
taken = []
for ls in piers:
    if ls.length < 14:
        continue
    for side in (-1, 1):
        s = 3.0
        while s < ls.length - 3:
            m = rng.choices(MODELS, weights=[4, 5, 4, 3, 0.6 if ls.length > 60 else 0])[0]
            name, L, W = m
            if s + L > ls.length:
                break
            a = ls.interpolate(s)
            b = ls.interpolate(s + L)
            hx, hy = b.x - a.x, b.y - a.y
            n = math.hypot(hx, hy) or 1
            hx, hy = hx / n, hy / n
            nx, ny = -hy * side, hx * side
            off = 1.3 + W / 2 + 0.6
            cx, cy = (a.x + b.x) / 2 + nx * off, (a.y + b.y) / 2 + ny * off
            fp = Polygon([(cx + hx * L / 2 + nx * W / 2, cy + hy * L / 2 + ny * W / 2), (cx - hx * L / 2 + nx * W / 2, cy - hy * L / 2 + ny * W / 2),
                          (cx - hx * L / 2 - nx * W / 2, cy - hy * L / 2 - ny * W / 2), (cx + hx * L / 2 - nx * W / 2, cy + hy * L / 2 - ny * W / 2)])
            ok = not fp.intersects(LAND.buffer(1)) and not fp.intersects(deck) and not any(fp.intersects(q) for q in taken)
            if ok and rng.random() < 0.85:
                taken.append(fp)
                # bow out or in at random (the hull model's bow is +y)
                hd = math.atan2(hx, hy) + (math.pi if rng.random() < 0.5 else 0)
                moored.append([name, round(cx, 2), round(cy, 2), round(hd, 3)])
            s += L + rng.uniform(1.5, 4)
print('moored', len(moored))
# under way: loops out in the bay between the two shores (Blender x, y), never near land
loops = []
for k in range(7):
    cx = rng.uniform(-470, -380)
    cy = rng.uniform(-1500, 1200)
    rx, ry = rng.uniform(40, 70), rng.uniform(250, 600)
    pts_ = []
    for i in range(48):
        a = 2 * math.pi * i / 48
        pts_.append((cx + rx * math.cos(a), cy + ry * math.sin(a)))
    ring = LineString(pts_ + [pts_[0]])
    if ring.distance(LAND) < 25:
        continue
    loops.append(dict(model=rng.choice(['yacht', 'cruiser', 'console', 'console', 'cruiser']), pts=[[round(x, 1), round(y, 1)] for x, y in pts_], speed=round(rng.uniform(6, 11), 1)))
print('loops', len(loops))
json.dump(dict(docks=docks), open(os.path.join(WORK, 'marina.json'), 'w'))
json.dump(dict(moored=moored, loops=loops, models={m[0]: [m[1], m[2]] for m in MODELS}), open(os.path.join(PUB, 'marina.json'), 'w'))
