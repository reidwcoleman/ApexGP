"""Halden's Hypermarket: a big-box grocery store that shut one night and never opened again, as data.
Same language as ward_layout.py. Metres, x east, y north, z up. 60 x 44 m, the car park to the south.

  front    the glass front and the doors in the middle, eight till lanes inside them. West corner: the pharmacy, the
           manager's office over it with a window down onto the tills. East corner: the cafe.
  floor    one hall, 6.4 m to the deck and the trusses under it. Produce to the west, eight runs of shelving north to
           south with a cross aisle half way, frozen to the east, the service counters along the back wall.
           Somebody cleared the middle of it and stood the trolleys in a ring.
  back     through the strip curtains: a corridor, the prep kitchen, the meat cold room with its rails still loaded,
           the freezer, and the stockroom, racking to the roof and the dock doors down.
  up       the office, a catwalk from it along the west wall over the produce, a loft over the cold rooms, a gantry
           stair down into the stockroom. A second stair off the catwalk by the deli. So the top is a loop too.

The power is off but for one circuit nobody found: a few tubes, two freezer banks, the sign over the meat counter.
"""
import math, random
from layout import Map, EXT_T, INT_T
from ward_layout import rects_minus

F2, TOP = 3.6, 6.4
SLAB = 0.25
X0, X1, Y0, Y1 = 0.0, 60.0, 0.0, 44.0
FY = 8.0                   # the front rooms end here
BY = 30.0                  # the sales floor's back wall
CY = 32.6                  # the back corridor's north wall
BX = 30.0                  # west of this the back is two storeys, east of it the stockroom
WX = 14.0                  # the west front block
EX = 46.0                  # the cafe
KX, MX2 = 10.0, 21.0       # kitchen | meat | freezer
ROWS = (16.0, 20.0, 24.0, 28.0, 32.0, 36.0, 40.0, 44.0)
SECT = ((12.5, 15.5), (21.0, 24.0))
TRUSS = (10.2, 18.25, 26.3)   # the truss lines, on the column lines     # gondola module centres along y, either side of the cross aisle

# a bright, broken-cloud morning: the building is lit by what comes in through the front glass and the rooflights, the
# way an empty one is, and the camera cannot hold the windows and the aisles at once
SKY = dict(hdri='kloofendal_overcast_puresky', strength=10.0, tint=(1.0, 1.0, 1.0), sun_bake=dict(dir=(0.3, -0.72, 0.62), power=42.0, color=(1.0, 0.95, 0.86)))
WEATHER = dict(key=0.085, day=1, shade=[0.301, 0.622, 0.723, 42], rain=0, wet=1, fog=0.2, sky=[1.0, 1.02, 1.06], wb=[1.0, 1.0, 1.0])
VOLUME = dict(step=[2, 1.15, 2], min=[-8, -1.2, -52], dim=[39, 9, 31])

TUBE = (0.8, 0.94, 1.0)
WARM = (1.0, 0.7, 0.4)
RED = (1.0, 0.07, 0.035)
SODIUM = (1.0, 0.55, 0.2)
HALO = (1.0, 0.86, 0.66)
COLD = (0.72, 0.84, 1.0)
CANDLE = (1.0, 0.52, 0.22)
SCREEN = (0.4, 0.6, 1.0)


def build():
    m = Map()
    m.rng = random.Random(53)
    R = m.rng
    box, wall, window, room, prop, light = m.box, m.wall, m.window, m.room, m.prop, m.light

    def grid(p, w):
        a, b = p - w / 2, p + w / 2
        if any(a + 0.28 <= q <= b - 0.28 for q in range(int(math.floor(a)), int(math.ceil(b)) + 1)):
            return p
        return float(round(p))

    def door(axis, c, p, z, w=0.92, **k):
        return m.door(axis, c, grid(p, max(w, 1.1)), z, w=w, **k)
    m.stains = []
    m.signs = []       # printed boards: x, y, z, nx, ny, which, how wide
    H1 = F2 - SLAB
    H2 = TOP - F2

    def D(n, x, y, z=0.0, r=0.0, **k):
        k.setdefault('collide', False)
        prop(n, x, y, z=z, rot=r, **k)

    def L(n, x, y, z=0.0, r=0.0, kg=4, sf='wood', **k):
        m.loose(n, x, y, z=z, rot=r, kg=kg, surf=sf, **k)

    def K(kind, x, y, z=0.0, r=0.0, solid=None, tint=(1, 1, 1)):
        m.unit('ward', [kind], x, y, z, rot=r, tint=tint, far=True)
        if solid:
            hx, hy, h = solid
            c, sn = abs(math.cos(r)), abs(math.sin(r))
            ex, ey = c * hx + sn * hy, sn * hx + c * hy
            m.invisible((x - ex, y - ey, z), (x + ex, y + ey, z + h), pen=True)

    def stains(*ss):
        m.stains.extend(ss)

    def tube(x, y, z, p, along='x', lit=True, reach=7.5):
        prop('mounted_fluorescent_lights', x, y, z=z - 0.03, rot=0 if along == 'x' else math.pi / 2, part='mounted_fluorescent_lights_a', collide=False)
        if lit:
            light('area', (x, y, z - 0.06), TUBE, p * 0.7, size=(1.2, 0.14) if along == 'x' else (0.14, 1.2), reach=reach)

    def emerg(x, y, z, p=4.0):
        box((x - 0.14, y - 0.05, z - 0.08), (x + 0.14, y + 0.05, z + 0.06), 'emerg', collide=False, density=0.1)
        light('point', (x, y, z - 0.16), RED, p, radius=0.06, reach=5.5)

    def exit_sign(axis, c, p, z, side, t=INT_T):
        f0 = c + side * (t / 2 + 0.004)
        f1 = f0 + side * 0.05
        if axis == 'x':
            box((p - 0.22, min(f0, f1), z), (p + 0.22, max(f0, f1), z + 0.17), 'exitsign', collide=False, density=0.15)
        else:
            box((min(f0, f1), p - 0.22, z), (max(f0, f1), p + 0.22, z + 0.17), 'exitsign', collide=False, density=0.15)

    def bulb(x, y, z, p, col=WARM, cage=False):
        if cage:
            prop('caged_hanging_light', x, y, z=z - 0.15, collide=False)
        else:
            D('pull_chain_light_socket', x, y, z=z - 0.02)
        light('point', (x, y, z - (0.42 if cage else 0.3)), col, p, radius=0.05)

    def site_light(x, y, z, aim, p=260.0):
        a = math.atan2(aim[1], aim[0])
        K(f'worklight_{int(x * 7 + y * 3) % 2 + 1}', x, y, z, r=a + math.pi / 2, solid=(0.22, 0.22, 1.8))
        al = math.hypot(*aim) or 1.0
        light('spot', (x + aim[0] / al * 0.16, y + aim[1] / al * 0.16, z + 1.74), HALO, p, spot=1.75, blend=0.5, radius=0.06, aim=(aim[0] / al, aim[1] / al, -0.16), reach=11.0)

    def way(axis, c, p, z, w=1.5, h=2.3):
        p = grid(p, w)
        a, b = p - w / 2, p + w / 2
        m.casing(axis, c, a, b, z, z + h)
        m.openings.append((p, c, z, w, axis) if axis == 'x' else (c, p, z, w, axis))
        return (a, b, z, z + h)

    def curtain(axis, c, p, z, seed):
        """a way through with a plastic strip curtain hung in it"""
        hole = way(axis, c, p, z, w=1.8, h=2.3)
        pp = (hole[0] + hole[1]) / 2
        if axis == 'x':
            K(f'strips_{seed}', pp, c, z, r=0.0)
        else:
            K(f'strips_{seed}', c, pp, z, r=math.pi / 2)
        return hole

    def idoor(axis, c, p, z, w=0.92, **k):
        """where a door hung inside the shop: the leaf is gone and the opening taken out wider, so nothing indoors is shut"""
        return way(axis, c, p, z, w=max(w + 0.7, 1.9))

    def breach(axis, c, p, z, w=1.6, h=1.9, t=INT_T):
        p = grid(p, w)
        a, b = p - w / 2, p + w / 2
        m.openings.append((p, c, z, w, axis) if axis == 'x' else (c, p, z, w, axis))
        for k in range(7):
            q = R.uniform(a, b)
            hh = R.uniform(0.04, 0.2)
            ww = R.uniform(0.1, 0.24)
            top = R.random() < 0.6
            z0, z1 = (z + h - hh, z + h) if top else (z, z + hh * 0.7)
            if axis == 'x':
                box((q - ww / 2, c - t / 2 + 0.01, z0), (q + ww / 2, c + t / 2 - 0.01, z1), 'hbrick_c', collide=False, density=0.3)
            else:
                box((c - t / 2 + 0.01, q - ww / 2, z0), (c + t / 2 - 0.01, q + ww / 2, z1), 'hbrick_c', collide=False, density=0.3)
        for s in (-1, 1):
            px, py = (p + R.uniform(-0.3, 0.3), c + s * 0.9) if axis == 'x' else (c + s * 0.9, p + R.uniform(-0.3, 0.3))
            K(f'debris_{int(px * 13 + py * 7) % 5 + 1}', px, py, z + 0.001, R.uniform(0, 6.28))
        return (a, b, z, z + h)

    def part(axis, c, p0, p1, z, h, holes=(), t=INT_T, mat='wall_int', tag='int', pen=True):
        wall(axis, c, p0, p1, z, z + h, t, mat, tag=tag, holes=list(holes), pen=pen)

    def guard(axis, c, p0, p1, z, h=1.05, mat='steel'):
        m.rail(axis, c, p0, p1, z, h=h, mat=mat)
        a, b, _ = m.solid[-1]
        m.solid[-1] = (a, b, False)

    def counter(x0, y0, x1, y1, z=0.0, h=1.05, top='steel', body='wtile'):
        box((x0, y0, z), (x1, y1, z + h), body, pen=True, tag='counter', density=0.5)
        box((x0 - 0.05, y0 - 0.05, z + h), (x1 + 0.05, y1 + 0.05, z + h + 0.05), top, collide=False, density=0.4)

    def table(x0, y0, x1, y1, z=0.0, h=0.88, sheet=False):
        box((x0, y0, z + h - 0.06), (x1, y1, z + h), 'steel', pen=True, tag='counter', density=0.4)
        m.invisible((x0, y0, z), (x1, y1, z + h - 0.06), pen=True)
        for (x, y) in ((x0 + 0.05, y0 + 0.05), (x1 - 0.05, y0 + 0.05), (x0 + 0.05, y1 - 0.05), (x1 - 0.05, y1 - 0.05)):
            box((x - 0.03, y - 0.03, z), (x + 0.03, y + 0.03, z + h - 0.06), 'steel', collide=False, density=0.15)
        if sheet:
            box((x0 + 0.04, y0 + 0.1, z + h), (x1 - 0.04, y1 - 0.1, z + h + 0.19), 'sheet', collide=False, density=0.3)
            box((x0 + 0.14, y0 + 0.14, z + h + 0.19), (x1 - 0.14, y0 + 0.5, z + h + 0.27), 'sheet', collide=False, density=0.3)

    def candle(x, y, z, p):
        box((x - 0.03, y - 0.03, z), (x + 0.03, y + 0.03, z + 0.1 + p * 0.05), 'candle', collide=False, density=0.05)
        light('point', (x, y, z + 0.24), CANDLE, p, radius=0.02, flicker=0.1, reach=4.5)

    # ================= outside: the car park, a wall round the lot; only seen through the glass =================
    box((-20, -24, -1), (80, Y0, 0), 'asphalt', tag='ground', density=0.4)
    box((-20, Y0, -1), (X0, 62, 0), 'yard', tag='ground', density=0.4)
    box((X1, Y0, -1), (80, 62, 0), 'yard', tag='ground', density=0.4)
    box((X0, Y1, -1), (X1, 62, 0), 'asphalt', tag='ground', density=0.4)
    for x in list(range(-14, 76, 3)):
        box((x, -16.0, -0.2), (x + 0.1, -10.5, 0.004), 'paint', collide=False, density=0.05)
    box((22.0, -6.0, -0.2), (38.0, -5.88, 0.004), 'paint_y', collide=False, density=0.05)
    BW = 3.4
    for a, b in (((-20.4, -24.4), (80.4, -24)), ((-20.4, 62), (80.4, 62.4)), ((-20.4, -24), (-20, 62)), ((80, -24), (80.4, 62))):
        box((a[0], a[1], 0), (b[0], b[1], BW), 'hbrick_c', tag='ext', density=0.2)
    for (a, b, h) in (((-60, 68), (30, 90), 14), ((40, 70), (110, 94), 19), ((-66, -44), (-30, 56), 11), ((90, -34), (114, 56), 16), ((-14, -76), (80, -40), 9)):
        box((a[0], a[1], 0), (b[0], b[1], h), 'brick_b', collide=False, tag='far', density=0.02)
    # trolleys nobody brought back, a bay of them by the doors
    for i, (x, y) in enumerate(((24.0, -3.0), (36.5, -8.0), (12.0, -5.5), (47.0, -2.4), (31.0, -12.0))):
        K(f'cart_{i + 40}', x, y, 0.0, r=R.uniform(0, 6.28))
    # the lot's one working lamp, orange through the glass onto the tills; and the moon's worth along the west side
    light('spot', (30.0, -7.5, 6.2), SODIUM, 520, spot=2.3, blend=0.85, radius=0.15, aim=(0.05, 0.75, -0.6), reach=15.0)
    light('spot', (X0 - 4.0, 19.0, 8.5), COLD, 200, spot=2.1, blend=0.8, radius=0.1, aim=(0.8, 0.0, -0.45), reach=13.0)

    # ================= slabs =================
    STW = (X0, Y0, 3.15, 5.4)
    box((X0, Y0, -0.3), (X1, Y1, 0.0), 'slab', tag='floor')
    for r in rects_minus(X0, Y0, WX, FY, [STW]):
        box((r[0], r[1], F2 - SLAB), (r[2], r[3], F2), 'slab', tag='floor')
    box((X0, BY, F2 - SLAB), (BX, Y1, F2), 'slab', tag='floor')
    # the roof, with the rooflights cut out of it: the glass went years ago, so what comes down through each is the sky
    # itself and, when it is out, a bar of sun that crosses the floor through the morning
    LIGHTS = ((10.0, 15.0), (22.0, 22.5), (34.0, 14.5), (46.0, 22.5), (54.0, 15.0), (40.0, 39.5), (52.0, 34.0),
              (16.0, 8.0), (28.0, 9.0), (40.0, 7.5), (52.0, 8.0), (16.0, 24.0), (28.0, 17.0), (40.0, 19.5), (34.0, 24.5))
    LW, LD = 1.5, 2.8
    xs = sorted({X0 - 0.3, X1 + 0.3, *[v for (x, y) in LIGHTS for v in (x, x + LW)]})
    ys = sorted({Y0 - 0.3, Y1 + 0.3, *[v for (x, y) in LIGHTS for v in (y, y + LD)]})
    def is_hole(cx, cy):
        return any(x < cx < x + LW and y < cy < y + LD for (x, y) in LIGHTS)
    for j in range(len(ys) - 1):
        i = 0
        while i < len(xs) - 1:
            if is_hole((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2):
                i += 1
                continue
            k = i
            while k + 1 < len(xs) - 1 and not is_hole((xs[k + 1] + xs[k + 2]) / 2, (ys[j] + ys[j + 1]) / 2):
                k += 1
            box((xs[i], ys[j], TOP), (xs[k + 1], ys[j + 1], TOP + 0.35), 'roof', tag='floor', density=0.1)
            i = k + 1
    # a kerb round each, standing proud of the deck
    for (x, y) in LIGHTS:
        for (a, b) in (((x - 0.06, y - 0.06), (x + LW + 0.06, y)), ((x - 0.06, y + LD), (x + LW + 0.06, y + LD + 0.06)), ((x - 0.06, y), (x, y + LD)), ((x + LW, y), (x + LW + 0.06, y + LD))):
            box((a[0], a[1], TOP - 0.12), (b[0], b[1], TOP + 0.5), 'trim', collide=False, density=0.2)
    for a, b in (((X0 - 0.3, Y0 - 0.3), (X1 + 0.3, Y0)), ((X0 - 0.3, Y1), (X1 + 0.3, Y1 + 0.3)), ((X0 - 0.3, Y0), (X0, Y1)), ((X1, Y0), (X1 + 0.3, Y1))):
        box((a[0], a[1], TOP + 0.35), (b[0], b[1], TOP + 1.0), 'tin', density=0.1)

    # ================= the outside walls =================
    EXT = 'hbrick'
    # the front: shop glass from the pharmacy to the cafe, the doors in the middle, a canopy over them
    holes = [door('x', Y0, 29.4, 0.0, w=1.2, kind='steel', hinge=0, swing=1), door('x', Y0, 30.6, 0.0, w=1.2, kind='steel', hinge=1, swing=1)]
    for i, p in enumerate((16.5, 19.5, 22.5, 25.5, 34.5, 37.5, 40.5, 43.5)):
        holes.append(window('x', Y0, p, 0.0, w=2.4, h=2.5, sill=0.45, glass=i not in (2, 5), boards=i == 6))
    holes += [window('x', Y0, p, 0.0, w=1.3, h=1.5, sill=1.1, boards=p == 10.0) for p in (6.5, 10.0)]
    holes += [window('x', Y0, p, 0.0, w=1.6, h=2.4, sill=0.5, glass=p != 53.0) for p in (49.0, 53.0, 57.0)]
    holes += [window('x', Y0, p, F2, w=1.4, h=1.5, sill=0.9, glass=p != 7.5) for p in (4.5, 7.5, 11.0)]
    wall('x', Y0, X0, X1, 0.0, TOP, EXT_T, EXT, tag='ext', holes=holes)
    box((25.0, Y0 - 3.2, 3.3), (35.0, Y0 - 0.16, 3.55), 'shopframe', collide=False, density=0.3)
    for x in (25.3, 34.7):
        box((x - 0.08, Y0 - 3.1, 0), (x + 0.08, Y0 - 2.94, 3.3), 'steel', density=0.15)
    box((20.0, Y0 - 0.22, 4.3), (40.0, Y0 - 0.16, 5.5), 'signboard', collide=False, density=0.15)
    # west: high windows over the catwalk; east: the same over the freezers, and the fire door
    holes = [window('y', X0, p, F2, w=1.6, h=1.3, sill=0.9, glass=p != 20.5) for p in (11.5, 16.0, 20.5, 25.0)]
    holes += [window('y', X0, 3.0, F2, w=1.2, h=1.4, sill=0.9), window('y', X0, 38.0, F2, w=1.2, h=1.0, sill=1.2, glass=False)]
    wall('y', X0, Y0, Y1, 0.0, TOP, EXT_T, EXT, tag='ext', holes=holes)
    holes = [window('y', X1, p, 0.0, w=1.6, h=1.3, sill=4.3, glass=p != 18.0) for p in (12.0, 18.0, 24.0)]
    holes += [door('y', X1, 28.6, 0.0, w=1.2, kind='steel', swing=-1), window('y', X1, 4.0, 0.0, w=1.6, h=2.4, sill=0.5), window('y', X1, 37.0, 0.0, w=1.6, h=1.0, sill=4.6)]
    wall('y', X1, Y0, Y1, 0.0, TOP, EXT_T, EXT, tag='ext', holes=holes)
    # north: the kitchen's yard door, the dock: two roller doors down, the door beside them
    holes = [door('x', Y1, 5.0, 0.0, w=1.2, kind='steel', swing=-1), window('x', Y1, 15.0, F2, w=1.2, h=1.0, sill=1.2, boards=True), window('x', Y1, 25.0, F2, w=1.2, h=1.0, sill=1.2),
             door('x', Y1, 58.6, 0.0, w=1.2, kind='steel', swing=-1), window('x', Y1, 40.0, 0.0, w=1.6, h=1.0, sill=4.6), window('x', Y1, 46.0, 0.0, w=1.6, h=1.0, sill=4.6, glass=False)]
    wall('x', Y1, X0, X1, 0.0, TOP, EXT_T, EXT, tag='ext', holes=holes)
    for x in (49.6, 53.6):
        box((x, Y1 - 0.2, 0.0), (x + 3.4, Y1 - 0.16, 3.5), 'tin_roof', collide=False, density=0.3)
        box((x - 0.1, Y1 - 0.24, 3.5), (x + 3.5, Y1 - 0.16, 3.9), 'steel', collide=False, density=0.15)
        for xx in (x - 0.1, x + 3.4):
            box((xx, Y1 - 0.24, 0.0), (xx + 0.1, Y1 - 0.16, 3.5), 'paint_y', collide=False, density=0.1)

    # ================= the front corners =================
    Z = 0.0
    # ---- west: the stair, the pharmacy, the office over them
    part('x', FY, X0, WX, Z, H1, holes=[way('x', FY, 1.6, Z, w=1.6), (5.0, 9.0, Z + 1.05, Z + 2.3), idoor('x', FY, 12.0, Z)])
    m.casing('x', FY, 5.0, 9.0, Z + 1.05, Z + 2.3, INT_T, 'trim', sill=True)
    box((4.95, FY - 0.3, 1.0), (9.05, FY + 0.3, 1.05), 'wood_top', collide=False, density=0.3)
    part('y', WX, Y0, FY, Z, H1, holes=[idoor('y', WX, 4.5, Z, kind='steel')])
    part('y', 3.15, Y0, FY, Z, H1)
    part('x', FY, X0, WX, F2, H2, holes=[way('x', FY, 1.0, F2, w=1.2), window('x', FY, 5.5, F2, w=2.4, h=1.4, sill=0.9, wt=INT_T), window('x', FY, 8.8, F2, w=2.4, h=1.4, sill=0.9, wt=INT_T, glass=False),
                                         window('x', FY, 12.0, F2, w=2.0, h=1.4, sill=0.9, wt=INT_T)])
    part('y', WX, Y0, FY, F2, H2, holes=[window('y', WX, 2.4, F2, w=2.2, h=1.4, sill=0.9, wt=INT_T, glass=False), window('y', WX, 5.6, F2, w=2.2, h=1.4, sill=0.9, wt=INT_T)])
    # the stair: south to a half landing, back north to the office
    m.stairs(0.15, 1.6, 1.55, 5.4, 0.0, 1.8, '-y')
    box((0.15, 0.16, 0.0), (3.05, 1.6, 1.8), 'concstep', tag='step', density=0.5)
    m.stairs(1.65, 1.6, 3.05, 5.4, 1.8, F2, '+y', solid=False)
    box((1.65, 1.6, 0.0), (3.05, 5.4, 1.8), 'wall_conc', tag='int', density=0.4)
    box((1.55, 1.6, 0.0), (1.65, 5.4, 2.85), 'wall_conc', tag='int', density=0.3)
    guard('y', 3.15, 0.2, 5.4, F2)
    guard('x', 5.4, 0.16, 1.6, F2)
    room('stairw', X0, Y0, 3.15, FY, Z, TOP, 'wall_conc', 'concstep')
    room('pharm', 3.15, Y0, WX, FY, Z, H1, 'hosp_wall3', 'mtile')
    room('office', 3.15, Y0, WX, FY, F2, H2, 'wall_paper', 'carpet')
    # pharmacy: the dispensing counter behind the hatch, shelves stripped, the controlled-drugs cabinet forced
    counter(5.0, 6.6, 9.0, 7.2, body='planks', top='wood_top')
    for (x, r) in ((4.6, 0.0), (8.0, 0.0), (11.4, 0.0)):
        K(f'gondola_{int(x) % 12 + 1}', x, 2.6, r=r, solid=(1.5, 0.5, 1.95))
    K('lockers_2', 13.3, 1.2, r=-math.pi / 2, solid=(0.6, 0.3, 1.9))
    for k in range(5):
        K(f'bottles_{k + 1}', R.uniform(4.0, 13.0), R.uniform(4.0, 6.2), 0.001, R.uniform(0, 6.28))
    tube(8.5, 4.6, H1, 0, lit=False)
    emerg(12.0, FY - 0.12, 2.45, p=3.0)
    stains((6.8, 5.6, 0.0, 0, 0, 1, 1.6), (7.0, 6.56, 0.7, 0, -1, 0, 1.0), (10.4, 4.4, 0.0, 0, 0, 1, 0.9))
    for i in range(5):
        stains((7.4 + i * 0.85, 5.3 - i * 0.2, 0.0, 0, 0, 1, 0.7))
    # office: desks, the safe open, the monitor wall still showing the floor in grey
    box((13.84, 0.8, F2 + 1.1), (13.87, 1.7, F2 + 1.7), 'screenglow', collide=False, density=0.1)
    light('point', (13.4, 1.25, F2 + 1.4), SCREEN, 2.4, radius=0.05, reach=5.0)
    K('lockers_1', 6.0, 0.55, z=F2, r=math.pi, solid=(0.6, 0.3, 1.9))
    K('monitor_1', 12.6, 7.4, F2, r=0.0)
    stains((9.0, 6.6, F2, 0, 0, 1, 1.5), (10.2, FY - 0.08, F2 + 1.1, 0, -1, 0, 1.2), (5.0, 3.0, F2, 0, 0, 1, 1.0))
    tube(8.5, 4.0, TOP, 0, lit=False)
    # ---- east: the cafe, open to the floor over a counter
    counter(EX - 0.3, 3.2, EX + 0.3, FY, body='planks', top='wood_top')
    counter(EX + 0.3, FY - 0.6, 55.0, FY, body='planks', top='wood_top')
    counter(57.6, 1.0, 59.4, 1.7, body='wtile', top='steel')
    room('canteen', EX, Y0, X1, FY, Z, TOP, 'hosp_wall3', 'mtile', ceil='tin_in')
    K('vending_1', 59.3, 5.4, r=-math.pi / 2, solid=(0.5, 0.42, 1.85))
    box((58.9, 4.95, 0.75), (58.93, 5.85, 1.75), 'lightbox', collide=False, density=0.15)
    light('point', (58.5, 5.4, 1.3), COLD, 3.0, radius=0.06, reach=6.0)
    stains((51.0, 4.0, 0.0, 0, 0, 1, 1.5), (54.0, 6.0, 0.0, 0, 0, 1, 1.0), (X1 - 0.18, 3.0, 1.0, -1, 0, 0, 1.2))

    # ================= the hall =================
    part('x', BY, X0, X1, Z, TOP, holes=[curtain('x', BY, 5.0, Z, 1), idoor('x', BY, 19.0, Z, w=1.2), way('x', BY, 27.0, Z, w=1.5),
                                         curtain('x', BY, 34.0, Z, 2), idoor('x', BY, 56.0, Z, w=1.3), way('x', BY, 1.0, F2, w=1.2)], t=0.2, mat='hbrick')
    room('tills', WX, Y0, EX, FY, Z, TOP, 'hosp_wall3', 'mtile', ceil='tin_in')
    room('sales', X0, FY, X1, BY, Z, TOP, 'hosp_wall3', 'mtile', ceil='tin_in')
    # the roof steel: three lines of truss over the hall, a dead fitting on most bays
    for ty in TRUSS:
        for k in range(20):
            K(f'trussbay_{k + int(ty)}', k * 3.0, ty, TOP - 0.001)
    # most of the hall is still lit: every other fitting, a dark patch over the ring and the far corners
    lit = {(x, ty): 46 for ty in TRUSS for x in (9.0, 21.0, 33.0, 45.0, 57.0)}
    lit.update({(x, TRUSS[1]): 40 for x in (15.0, 39.0, 51.0)})
    lit.update({(27.0, TRUSS[0]): 40, (51.0, TRUSS[0]): 40, (15.0, TRUSS[2]): 40})
    for kk in ((33.0, TRUSS[1]), (33.0, TRUSS[2]), (57.0, TRUSS[2])):
        del lit[kk]
    lit[(33.0, 5.2)] = 34
    for ty in TRUSS:
        for x in (9.0, 15.0, 21.0, 27.0, 33.0, 39.0, 45.0, 51.0, 57.0):
            if (x, ty) in lit:
                tube(x, ty - 0.35, TOP - 0.9, lit[(x, ty)], reach=10.0)
            elif R.random() < 0.6:
                tube(x, ty - 0.35, TOP - 0.9, 0, lit=False)
    tube(33.0, 5.2, H1 + 0.6, lit[(33.0, 5.2)], along='y', reach=8.0)
    for x in (18.0, 24.0, 40.0):
        tube(x, 5.2, H1 + 0.6, 30 if x != 24.0 else 0, along='y', lit=x != 24.0, reach=8.0)
    # ---- the structure: a column under each truss every twelve metres, in line with the shelving, a yellow sleeve round its foot
    for cx in (8.0, 20.0, 32.0, 44.0, 56.0):
        for cy in TRUSS:
            box((cx - 0.13, cy - 0.13, 0.0), (cx + 0.13, cy + 0.13, TOP - 0.7), 'wall_conc', tag='post', density=0.3)
            box((cx - 0.17, cy - 0.17, 0.0), (cx + 0.17, cy + 0.17, 1.2), 'paint_y', collide=False, density=0.2)
    # the air: two runs of duct the length of the hall
    for dy in (14.4, 22.6):
        for k in range(20):
            K(f'duct_{k + int(dy)}', k * 3.0, dy, TOP - 0.001)
    # what was on offer the last week: banners off the steel, pallets stood in the aisles
    for i, (x, ty) in enumerate(((14.0, 1), (22.0, 1), (38.0, 1), (46.0, 1), (12.0, 2), (26.0, 2), (34.0, 2), (48.0, 2), (5.0, 0), (52.0, 0))):
        K(f'banner_{i + 1}', x, TRUSS[ty] + 0.02, TOP - 0.7)
    for i, (x, y, r) in enumerate(((22.0, 9.0, 0.1), (37.6, 9.2, 1.5), (13.0, 18.3, 0.0), (54.2, 18.6, 1.6), (46.0, 9.6, 0.3))):
        K(f'promo_{i + 1}', x, y, 0.0, r=r, solid=(0.62, 0.62, 0.9))
    # a painted band round the hall above the fittings
    box((WX, Y0 + 0.165, 3.75), (EX, Y0 + 0.18, 4.3), 'paint_g', collide=False, density=0.1)
    box((X0, BY - 0.118, 3.75), (X1, BY - 0.105, 4.3), 'paint_g', collide=False, density=0.1)
    box((X1 - 0.18, FY, 3.5), (X1 - 0.165, BY, 4.05), 'paint_g', collide=False, density=0.1)
    # the way in: matting, the tag gates, baskets
    box((27.6, 0.3, 0.0), (32.4, 2.2, 0.008), 'plastic_black', collide=False, density=0.2)
    for gx in (28.5, 30.0, 31.5):
        box((gx - 0.03, 2.4, 0.0), (gx + 0.03, 2.9, 1.5), 'trim', pen=True, tag='post', density=0.3)
        box((gx - 0.06, 2.36, 0.0), (gx + 0.06, 2.94, 0.06), 'plastic_black', collide=False, density=0.2)
    K('baskets_1', 26.6, 0.9, 0.0, r=0.2)
    K('baskets_2', 33.4, 1.0, 0.0, r=2.0)
    for i, x in enumerate((16.5, 22.5, 25.5, 37.5, 43.5)):
        K(f'endcap_{i % 7 + 1}', x + 0.1, 7.75, 0.0, r=-math.pi / 2, solid=(0.5, 0.25, 1.7))
    # where the roof lets the rain in: black water under the rooflights
    for i, (x, y) in enumerate(((10.6, 16.6), (34.6, 16.0), (46.6, 23.7), (22.6, 18.4), (54.6, 16.2))):
        K(f'pool_{i + 1}', x, y, 0.003, r=R.uniform(0, 6.28))
    for i in range(22):
        K(f'litter_{i % 6 + 1}', R.uniform(15.0, 45.0), R.uniform(1.0, 10.0), 0.001, R.uniform(0, 6.28))
    # ---- the signs: a board over each department, the thank-you over the doors, staff only by the curtains
    m.signs += [(11.75, BY - 0.12, 5.25, 0, -1, 2, 3.6), (26.5, BY - 0.12, 5.25, 0, -1, 3, 3.6), (41.0, BY - 0.12, 5.25, 0, -1, 4, 3.6),
                (X1 - 0.17, 15.0, 3.0, -1, 0, 1, 2.6), (X1 - 0.17, 21.0, 3.0, -1, 0, 1, 2.6), (X0 + 0.17, 18.25, 2.6, 1, 0, 0, 2.4), (X0 + 0.17, 13.75, 2.6, 1, 0, 0, 2.4),
                (7.0, FY + 0.075, 2.82, 0, 1, 5, 2.0), (X1 - 0.17, 6.4, 3.3, -1, 0, 6, 2.4), (30.0, Y0 + 0.17, 3.05, 0, 1, 7, 2.4),
                (6.6, BY - 0.12, 1.6, 0, -1, 8, 0.7), (35.6, BY - 0.12, 1.6, 0, -1, 8, 0.7), (19.0, BY - 0.12, 2.5, 0, -1, 8, 0.7), (55.0, BY - 0.12, 1.6, 0, -1, 8, 0.7)]
    # ---- real things: a till on every lane, bins, what got dropped and kicked about (all of it loose)
    for i, x in enumerate((16.5, 19.5, 22.5, 25.5, 34.5, 37.5, 40.5, 43.5)):
        if i not in (2, 5):
            D('CashRegister_01', x + 0.02, 5.05, z=0.89, r=math.pi / 2)
    for (x, y) in ((17.6, 3.9), (26.6, 3.8), (35.6, 3.9), (44.4, 3.7), (13.2, 9.0), (46.8, 26.8)):
        L('metal_trash_can', x, y, kg=6, sf='metal', shape='cyl')
    for i in range(16):
        x, y = R.choice((18.0, 22.0, 26.0, 34.0, 38.0, 42.0)) + R.uniform(-0.9, 0.9), R.uniform(11.0, 25.5)
        L(('cardboard_box_01', 'plastic_bottle_gallon', 'multi_cleaner_5_litre', 'cardboard_box_01')[i % 4], x, y, r=R.uniform(0, 6.28), kg=(4, 1.5, 2.5, 4)[i % 4], sf=('card', 'plastic', 'plastic', 'card')[i % 4])
    for i in range(8):
        L('plastic_crate_01' if i % 2 else 'plastic_crate_02', R.uniform(3.4, 12.6), R.uniform(9.2, 27.0), r=R.uniform(0, 6.28), kg=1.5, sf='plastic')
    for (x, y) in ((36.0, 32.2), (41.5, 36.8), (52.6, 35.0), (47.2, 42.6), (33.2, 40.4)):
        L('cardboard_box_01', x, y, r=R.uniform(0, 6.28), kg=4, sf='card')
        L('trashbag', x + 0.7, y + 0.3, r=R.uniform(0, 6.28), kg=7, sf='bag')
    for i in range(14):
        x, y = R.choice((18.0, 22.0, 26.0, 34.0, 38.0, 42.0, 46.5)) + R.uniform(-1.0, 1.0), R.uniform(9.0, 26.5)
        L(('russian_food_cans_01', 'long_life_food', 'wine_bottles_01')[i % 3], x, y, r=R.uniform(0, 6.28), kg=(1.5, 1.5, 1)[i % 3], sf=('metal', 'card', 'glass')[i % 3])
    D('WetFloorSign_01', 47.4, 20.0, r=0.4)
    D('WetFloorSign_01', 21.6, 27.0, r=2.2)
    # ---- the tills: four lanes either side of the way in, one screen still asking for a card
    for i, x in enumerate((16.5, 19.5, 22.5, 25.5, 34.5, 37.5, 40.5, 43.5)):
        K(f'checkout_{i + 1}', x, 5.6, r=0.0, solid=(0.42, 1.35, 0.9))
    box((22.7, 5.07, 1.31), (22.98, 5.075, 1.53), 'screenglow', collide=False, density=0.1)
    light('point', (22.84, 4.8, 1.42), SCREEN, 1.6, radius=0.04, reach=4.5)
    exit_sign('x', Y0, 30.0, 2.5, 1, t=EXT_T)
    for i, (x, y) in enumerate(((27.6, 1.4), (27.6, 2.2), (27.7, 3.0), (32.6, 1.6), (33.2, 9.4), (18.2, 9.6), (41.0, 9.0), (12.6, 9.2), (47.5, 9.8))):
        K(f'cart_{i + 1}', x, y, 0.0, r=R.uniform(-0.2, 0.2) if i < 3 else R.uniform(0, 6.28), solid=(0.3, 0.3, 1.0) if i < 3 else None)
    K('wetfloor_2', 30.4, 4.0, 0.0, r=0.6)
    stains((30.2, 2.6, 0.0, 0, 0, 1, 1.8), (25.5, 6.4, 0.9, 0, 0, 1, 0.8), (25.0, 5.2, 0.0, 0, 0, 1, 1.4), (37.9, 6.6, 0.0, 0, 0, 1, 1.1))
    for i in range(9):
        stains((30.0 + math.sin(i * 0.7) * 0.25, 3.6 + i * 0.85, 0.0, 0, 0, 1, 0.72))       # dragged in off the car park, up the middle
    # ---- the shelving. Two rows are left out in the middle of the back half: that is where the ring is
    n = 0
    for x in ROWS:
        for si, sect in enumerate(SECT):
            ring = si == 1 and x in (28.0, 32.0)
            if ring:
                continue
            for y in sect:
                n += 1
                if (x, y) in ((40.0, 24.0),):
                    K(f'gondolax_{n}', x, y, 0.0, r=math.pi / 2 if x < 30 else -math.pi / 2, solid=(1.5, 1.2, 0.55))
                    continue
                if (x, y) in ((24.0, 21.0),):
                    K(f'debris_{n % 5 + 1}', x, y, 0.001, R.uniform(0, 6.28))
                    K(f'litter_{n % 6 + 1}', x + 0.4, y - 0.6, 0.001, R.uniform(0, 6.28))
                    continue
                K(f'gondola_{n % 12 + 1}', x, y, 0.0, r=math.pi / 2 if n % 2 else -math.pi / 2, solid=(1.5, 0.5, 1.95))
            K(f'endcap_{n % 7 + 1}', x, sect[0] - 1.53, 0.0, r=0.0, solid=(0.5, 0.25, 1.7))
            K(f'endcap_{(n + 3) % 7 + 1}', x, sect[1] + 1.53, 0.0, r=math.pi, solid=(0.5, 0.25, 1.7))
    whole = [q for q in range(1, 60) if random.Random(q).random() >= 0.18]      # boards still on both chains
    for i, x in enumerate((18.0, 22.0, 26.0, 30.0, 34.0, 38.0, 42.0)):
        K(f'aislesign_{whole[i]}', x, TRUSS[0], TOP - 0.7)
        for sy in (-1, 1):
            m.signs.append((x, TRUSS[0] + sy * 0.02, TOP - 0.7 - 2.6, 0, sy, 9 + i, 0.9))
    for i in range(26):
        x, y = R.choice((18.0, 22.0, 26.0, 30.0, 34.0, 38.0, 42.0)) + R.uniform(-1.0, 1.0), R.uniform(10.5, 26.0)
        K(f'litter_{i % 6 + 1}' if i % 3 else f'bottles_{i % 5 + 1}', x, y, 0.001, R.uniform(0, 6.28))
    # ---- the ring: ten trolleys stood nose-in round something under a sheet, candles burnt down between them
    CX, CY2 = 30.0, 22.4
    for k in range(10):
        if k == 7:
            continue        # the way in
        a = k * math.tau / 10 + 0.2
        K(f'cart_{k + 20}', CX + math.cos(a) * 2.35, CY2 + math.sin(a) * 2.35, 0.0, r=a + math.pi / 2, solid=(0.3, 0.3, 1.0))
    K('bodybag_3', CX, CY2, 0.001, r=0.3)
    K('bodybag_6', CX + 0.7, CY2 - 0.5, 0.001, r=1.2)
    K('candles_2', CX - 0.6, CY2 + 0.7, 0.001, 0.0)
    for k in range(6):
        a = k * math.tau / 6 + 0.5
        candle(CX + math.cos(a) * 1.25, CY2 + math.sin(a) * 1.25, 0.0, 1.1 + 0.25 * (k % 3))
    stains((CX, CY2, 0.0, 0, 0, 1, 2.6), (CX - 1.0, CY2 - 0.4, 0.0, 0, 0, 1, 1.5), (CX + 1.2, CY2 + 0.9, 0.0, 0, 0, 1, 1.2))
    for i in range(10):
        stains((CX + 1.6 + i * 0.75, CY2 + 1.6 + i * 0.52, 0.0, 0, 0, 1, 0.72))      # and where it was brought from: the back
    # ---- produce: islands of it gone to black, under the catwalk the crates it came in
    for i, (x, y) in enumerate(((10.0, 11.5), (10.0, 15.5), (10.0, 19.5), (10.0, 24.0), (5.6, 11.5), (5.6, 15.5), (5.6, 19.5))):
        K(f'producebin_{i * 2 + 1}', x, y, 0.0, r=0.0, solid=(1.0, 0.5, 0.95))
        K(f'producebin_{i * 2 + 2}', x, y + 1.0, 0.0, r=math.pi, solid=(1.0, 0.5, 0.95))
    for i, y in enumerate((10.0, 14.0, 18.6)):
        K(f'cardstack_{i + 1}', 1.0, y, 0.0, r=math.pi / 2, solid=(0.8, 0.6, 1.2) if i != 1 else None)
    stains((7.8, 13.4, 0.0, 0, 0, 1, 1.3), (5.0, 22.4, 0.0, 0, 0, 1, 1.8), (X0 + 0.18, 16.8, 1.1, 1, 0, 0, 1.3))
    # ---- frozen: uprights down the east wall and a double bank mid-floor, chest freezers between. Two banks still lit
    FLIT = {(59.4, 11.5), (59.4, 14.5), (59.4, 20.5), (59.4, 23.5), (51.6, 12.5), (51.6, 22.0), (52.4, 15.5), (52.4, 25.0)}
    k = 0
    for (x, r, ys) in ((59.4, -math.pi / 2, (11.5, 14.5, 17.5, 20.5, 23.5, 26.0)), (51.6, -math.pi / 2, (12.5, 15.5, 22.0, 25.0)), (52.4, math.pi / 2, (12.5, 15.5, 22.0, 25.0))):
        for y in ys:
            k += 1
            K(f'freezer_{k % 6 + 1}', x, y, 0.0, r=r, solid=(1.5, 0.4, 2.05))
            if (x, y) in FLIT:
                s = -1 if r < 0 else 1
                box((x + s * 0.26, y - 1.4, 1.83), (x + s * 0.3, y + 1.4, 1.87), 'lightbox', collide=False, density=0.15)
                light('point', (x + s * 0.75, y, 1.6), COLD, 5.5, radius=0.08, reach=6.5)
    for i, (x, y) in enumerate(((48.3, 12.7), (48.3, 15.3), (48.3, 22.2), (48.3, 24.8), (56.0, 13.0), (56.0, 15.6), (56.0, 22.0), (56.0, 24.6))):
        K(f'coffin_{i + 1}', x, y, 0.0, r=math.pi / 2, solid=(1.2, 0.5, 0.9))
    exit_sign('y', X1, 28.6, 2.3, -1, t=EXT_T)
    emerg(X1 - 0.24, 28.6, 2.75, p=3.5)
    stains((57.6, 14.4, 0.0, 0, 0, 1, 1.6), (58.96, 14.9, 1.0, -1, 0, 0, 1.3), (54.2, 23.0, 0.0, 0, 0, 1, 1.4), (50.0, 18.4, 0.0, 0, 0, 1, 1.0))
    # ---- the counters along the back: deli, the butcher, the bakery. The butcher's sign is still on
    for (a, b) in ((7.5, 16.0), (20.6, 25.6), (28.4, 32.4), (36.0, 46.0)):
        counter(a, 27.8, b, 28.6)
        box((a + 0.1, 27.86, 1.1), (b - 0.1, 27.9, 1.5), 'darkwin', collide=False, density=0.15)
        box((a + 0.1, 27.86, 1.5), (b - 0.1, 28.3, 1.53), 'darkwin', collide=False, density=0.15)
    box((21.0, BY - 0.16, 2.7), (32.0, BY - 0.12, 3.4), 'signboard', collide=False, density=0.12)
    box((23.4, BY - 0.19, 2.86), (29.6, BY - 0.16, 3.24), 'meatsign', collide=False, density=0.12)
    light('area', (26.5, BY - 0.45, 3.0), (1.0, 0.12, 0.07), 9, size=(5.0, 0.3), reach=8.5)
    box((8.0, BY - 0.16, 2.7), (15.5, BY - 0.12, 3.4), 'signboard', collide=False, density=0.12)
    box((36.5, BY - 0.16, 2.7), (45.5, BY - 0.12, 3.4), 'signboard', collide=False, density=0.12)
    table(22.0, 28.95, 24.4, 29.7)
    table(38.0, 28.95, 41.0, 29.7)
    K('sink_1', 11.0, BY - 0.103, 0.0, r=0.0)
    K('sink_2', 43.5, BY - 0.103, 0.0, r=0.0)
    exit_sign('x', BY, 34.0, 2.5, -1, t=0.2)
    exit_sign('x', BY, 5.0, 2.5, -1, t=0.2)
    stains((23.2, 29.3, 0.89, 0, 0, 1, 1.0), (23.0, 28.9, 0.0, 0, 0, 1, 1.9), (25.9, BY - 0.12, 1.2, 0, -1, 0, 1.6), (30.0, 27.0, 0.0, 0, 0, 1, 1.2), (12.0, 27.2, 0.0, 0, 0, 1, 1.0))
    for i in range(7):
        stains((26.2 + i * 0.12, 29.2 - i * 0.05 + (i % 2) * 0.1, 0.0, 0, 0, 1, 0.7))
        stains((27.0, 29.6 + i * 0.5 - 0.6, 0.0, 0, 0, 1, 0.7))       # out through the staff way
    # ---- the catwalk: grating on brackets along the west wall from the office to the loft, a stair off it by the deli
    box((X0 + 0.16, FY, F2 - 0.1), (2.0, BY - 0.1, F2), 'grate', tag='floor', density=0.3)
    for y in (9.0, 12.5, 16.0, 19.5, 23.0, 26.5, 29.4):
        box((1.9, y - 0.05, 0.0), (2.0, y + 0.05, F2 - 0.1), 'ruststeel', collide=False, density=0.1)
        m.invisible((1.85, y - 0.1, 0.0), (2.05, y + 0.1, F2 - 0.1), pen=True)
        box((X0 + 0.16, y - 0.04, F2 - 0.22), (2.0, y + 0.04, F2 - 0.1), 'ruststeel', collide=False, density=0.1)
    guard('y', 2.0, FY + 0.1, 21.3, F2)
    guard('y', 2.0, 22.5, BY - 0.1, F2)
    box((2.0, 21.3, F2 - 0.1), (3.2, 22.5, F2), 'grate', tag='floor', density=0.3)
    guard('x', 21.3, 2.0, 3.2, F2)
    guard('y', 3.2, 21.3, 22.5, F2)
    m.stairs(2.05, 22.5, 3.2, 28.6, 0.0, F2, '-y', mat='steelstep', solid=False)
    m.invisible((3.17, 22.5, 0.0), (3.23, 28.6, 0.9), pen=True)
    for i in range(5):
        y = 23.0 + i * 1.3
        box((3.17, y - 0.03, 0.0), (3.23, y + 0.03, F2 - (y - 22.5) * F2 / 6.1 + 0.95), 'ruststeel', collide=False, density=0.1)
    emerg(X0 + 0.24, 21.9, F2 + 2.3, p=3.0)

    # ================= the back, west: corridor, kitchen, the cold rooms; a loft over all of it =================
    part('x', CY, X0, BX, Z, H1, holes=[way('x', CY, 4.0, Z, w=1.6), curtain('x', CY, 15.0, Z, 3), curtain('x', CY, 25.6, Z, 4)])
    part('y', KX, CY, Y1, Z, H1, holes=[breach('y', KX, 38.6, Z)])
    part('y', MX2, CY, Y1, Z, H1, holes=[way('y', MX2, 40.0, Z, w=1.5)])
    part('y', BX, BY, Y1, Z, H1, holes=[way('y', BX, 31.3, Z, w=1.8)], t=0.2, mat='hbrick')
    room('backcor', X0, BY, BX, CY, Z, H1, 'wall_conc', 'conc')
    room('kitchen', X0, CY, KX, Y1, Z, H1, 'wtile', 'mtile')
    room('cold_meat', KX, CY, MX2, Y1, Z, H1, 'wtile', 'conc_wet')
    room('cold_frozen', MX2, CY, BX, Y1, Z, H1, 'sqtile', 'conc_wet')
    room('loft', X0, BY, BX, Y1, F2, H2, 'dconc', 'conc', ceil='tin_in')
    # corridor: one tube, red lamps, the cages nobody unloaded
    tube(22.0, (BY + CY) / 2, H1, 20)
    for x in (6.0, 14.0):
        tube(x, (BY + CY) / 2, H1, 0, lit=False)
    emerg(15.0, CY - 0.1, 2.5, p=3.5)
    K('cardstack_5', 9.6, CY - 0.75, 0.0, r=0.0, solid=(0.8, 0.6, 1.2))
    K('cardstack_6', 21.2, BY + 0.75, 0.0, r=math.pi)
    K('wetfloor_5', 12.4, 31.2, 0.0, r=2.0)
    stains((15.0, 31.4, 0.0, 0, 0, 1, 1.5), (18.4, CY - 0.08, 1.0, 0, -1, 0, 1.4), (26.8, 31.0, 0.0, 0, 0, 1, 1.0))
    for i in range(9):
        stains((15.2 + i * 1.3, 31.3 + math.sin(i) * 0.2, 0.0, 0, 0, 1, 0.72))
    # kitchen: steel tables, sinks, the ovens, a bulb somebody ran in
    table(2.0, 35.6, 4.6, 36.5)
    table(2.0, 39.0, 4.6, 39.9, sheet=True)
    table(6.6, 42.6, 9.2, 43.4)
    K('sink_3', 0.26, 37.6, 0.0, r=math.pi / 2)
    K('sink_4', 0.26, 41.4, 0.0, r=math.pi / 2)
    D('electric_stove', 8.9, 34.0, r=-math.pi / 2, collide=None)
    bulb(4.4, 38.0, H1, 4.5, WARM)
    stains((3.3, 39.4, 1.08, 0, 0, 1, 1.0), (3.6, 40.6, 0.0, 0, 0, 1, 1.9), (X0 + 0.18, 39.6, 1.2, 1, 0, 0, 1.4), (7.0, 37.6, 0.0, 0, 0, 1, 1.2))
    # the meat room: three rails across it, loaded; one caged lamp, cold; the drain in the middle has been busy
    for j, y in enumerate((35.4, 38.4, 41.6)):
        for i, x in enumerate((12.0, 15.3, 18.6)):
            if (j, i) == (1, 2):
                continue
            K(f'hooks_{j * 3 + i + 1}', x + (0.4 if j == 1 else 0.0), y, H1, r=0.0)
    bulb(15.6, 37.0, H1, 5.0, COLD, cage=True)
    table(18.4, 42.4, 20.6, 43.3, sheet=True)
    box((15.2, 39.6, 0.0), (15.8, 40.2, 0.006), 'grate', collide=False, density=0.2)
    stains((15.5, 39.9, 0.0, 0, 0, 1, 2.6), (12.4, 35.6, 0.0, 0, 0, 1, 1.5), (18.8, 41.4, 0.0, 0, 0, 1, 1.6), (13.0, 41.8, 0.0, 0, 0, 1, 1.3), (KX + 0.1, 36.0, 1.1, 1, 0, 0, 1.5),
           (19.5, 42.85, 0.9, 0, 0, 1, 0.9), (16.0, Y1 - 0.18, 1.3, 0, -1, 0, 1.6), (17.2, 38.6, 0.0, 0, 0, 1, 1.1))
    # the freezer: racks, what is on the floor in bags, a red lamp
    emerg(25.6, CY + 0.1, 2.5, p=4.0)
    K('bodybag_1', 23.4, 41.6, 0.001, r=0.2)
    K('bodybag_4', 24.0, 42.6, 0.001, r=0.0)
    K('bodybag_5', 27.6, 42.4, 0.001, r=1.6)
    K('hooks_12', 26.0, 38.0, H1, r=math.pi / 2)
    stains((24.0, 41.8, 0.0, 0, 0, 1, 1.8), (27.0, 36.0, 0.0, 0, 0, 1, 1.2), (BX - 0.14, 38.0, 1.0, -1, 0, 0, 1.3))
    # the loft: the seasonal stock, and where somebody has been sleeping. Open to the stockroom along its east edge
    guard('y', BX, BY + 0.2, 42.9, F2)
    for i, (x, y) in enumerate(((4.0, 41.0), (9.0, 33.0), (14.0, 42.0), (20.0, 35.0), (25.0, 42.4), (12.0, 36.6))):
        K(f'cardstack_{i + 10}', x, y, F2, r=R.uniform(0, 6.28), solid=(0.8, 0.8, 1.2))
    K('rack_21', 6.0, 43.3, F2 - 0.0, r=0.0, solid=(1.4, 0.55, 2.7), tint=(0.8, 0.8, 0.8))
    K('hbed_3', 22.4, 39.0, F2, r=0.3, solid=(0.5, 1.0, 0.6))
    K('candles_4', 23.6, 38.2, F2 + 0.001, 0.0)
    candle(23.6, 38.2, F2, 1.3)
    candle(21.2, 40.3, F2, 1.0)
    emerg(1.0, BY + 0.14, F2 + 2.3, p=3.0)
    stains((22.6, 39.2, F2 + 0.55, 0, 0, 1, 0.9), (24.4, 39.6, F2, 0, 0, 1, 1.4), (10.0, 38.0, F2, 0, 0, 1, 1.2), (4.0, 33.0, F2, 0, 0, 1, 1.0))
    for i in range(8):
        stains((3.0 + i * 2.3, 31.2 + i * 0.9, F2, 0, 0, 1, 0.7))

    # ================= the stockroom =================
    room('stockroom', BX, BY, X1, Y1, Z, TOP, 'dconc', 'gfloor', ceil='tin_in')
    for k in range(10):
        K(f'trussbay_{k + 70}', BX + k * 3.0, 37.0, TOP - 0.001)
    n = 0
    for y in (34.6, 39.4):
        for x in (35.2, 38.0, 40.8, 43.6, 46.4):
            n += 1
            K(f'rack_{n}', x, y, 0.0, r=0.0 if y < 37 else math.pi, solid=(1.42, 0.55, 4.6))
    # the gantry stair up to the loft, along the wall
    m.stairs(30.2, 36.4, 31.4, 43.0, 0.0, F2, '+y', mat='steelstep', solid=False)
    box((30.1, 43.0, F2 - 0.1), (31.4, Y1 - 0.16, F2), 'grate', tag='floor', density=0.3)
    guard('y', 31.4, 43.0, Y1 - 0.16, F2)
    m.invisible((31.37, 36.4, 0.0), (31.43, 43.0, 0.9), pen=True)
    for i in range(5):
        y = 37.4 + i * 1.3
        box((31.37, y - 0.03, 0.0), (31.43, y + 0.03, (y - 36.4) * F2 / 6.6 + 0.95), 'ruststeel', collide=False, density=0.1)
    # the dock end: pallets down, a truck's worth never put away, the lights somebody stood up
    for i, (x, y) in enumerate(((50.5, 41.5), (52.4, 41.2), (55.6, 41.8), (51.2, 33.0), (57.8, 36.0), (54.0, 37.4))):
        K(f'pallet_{i + 1}', x, y, 0.0, r=R.uniform(-0.3, 0.3), solid=(0.55, 0.65, 0.14))
        if i % 2 == 0:
            K(f'cardstack_{i + 20}', x, y, 0.15, r=R.uniform(0, 6.28), solid=(0.8, 0.6, 1.2))
    D('hand_truck', 49.0, 36.6, r=0.7, collide=None)
    D('industrial_storage_cart', 33.6, 31.6, r=0.1, collide=None)
    site_light(57.6, 42.0, 0.0, (-1.0, -0.42), p=150.0)
    tube(42.0, 37.0 - 0.35, TOP - 0.9, 0, lit=False)
    tube(51.0, 37.0 - 0.35, TOP - 0.9, 0, lit=False)
    emerg(58.6, Y1 - 0.24, 2.6, p=4.0)
    exit_sign('x', Y1, 58.6, 2.3, -1, t=EXT_T)
    emerg(BX + 0.16, 31.3, 2.6, p=3.0)
    stains((44.0, 37.0, 0.0, 0, 0, 1, 2.0), (52.0, 38.6, 0.0, 0, 0, 1, 1.4), (38.0, 35.2, 1.61, 0, 0, 1, 0.8), (X1 - 0.18, 40.0, 1.1, -1, 0, 0, 1.3), (33.0, 42.0, 0.0, 0, 0, 1, 1.2))
    for i in range(11):
        stains((34.6 + i * 0.95, 31.6 + i * 0.5, 0.0, 0, 0, 1, 0.72))

    # ---- what every wall of a shop has
    for (x, y, r) in ((14.2, 6.6, -math.pi / 2), (45.8, 2.0, math.pi / 2)):
        K('extinguisher_1', x + (0.0 if r < 0 else 0.0), y, 0.0, r=r)
    K('callpoint_1', 27.9, Y0 + 0.17, 0.0, r=math.pi)
    K('notice_2', 24.0, BY + 0.105, 0.0, r=math.pi)
    K('notice_3', 9.0, BY + 0.105, 0.0, r=math.pi)
    K('extinguisher_2', 28.6, BY + 0.105, 0.0, r=math.pi)
    K('callpoint_2', BX + 0.105, 33.2, 0.0, r=-math.pi / 2)
    K('notice_1', 33.0, BY + 0.105, 0.0, r=math.pi)
    K('wallphone_1', 3.25, 6.6, 0.0, r=-math.pi / 2)
    # sprinkler mains under the low ceilings
    for x in range(0, 30, 3):
        K(f'sprinkler_{x % 5 + 1}', x + 1.5, BY + 0.5, H1, r=0.0)

    # ================= all of it indoors =================
    import indoor, clutter
    m.zones.insert(0, dict(a=(X0, Y0, -0.3), b=(X1, BY, TOP), kind='hall'))
    m.zones.insert(1, dict(a=(BX, BY, -0.3), b=(X1, Y1, TOP), kind='hall'))
    m.zones.append(dict(a=(X0, Y0, -0.3), b=(X1, Y1, TOP), kind='small'))

    m.spawns['a'] = [[4.0, 10.0, 0], [8.0, 14.0, 0], [4.0, 18.0, 0], [8.0, 22.0, 0], [12.0, 10.0, 0], [6.0, 38.0, 0], [8.0, 31.0, 0], [8.0, 5.0, 0]]
    m.spawns['b'] = [[54.0, 11.0, 0], [54.0, 18.0, 0], [58.0, 19.0, 0], [50.0, 10.0, 0], [54.0, 27.0, 0], [57.0, 33.0, 0], [48.0, 42.0, 0], [52.0, 4.0, 0]]
    m.spawns['ffa'] = m.spawns['a'][:5] + m.spawns['b'][:5] + [[30.0, 10.0, 0], [18.0, 18.0, 0], [42.0, 18.0, 0], [34.0, 27.0, 0], [14.0, 38.0, 0], [25.0, 36.0, 0], [40.0, 37.0, 0],
                                                               [8.0, 4.0, F2], [1.0, 15.0, F2], [15.0, 37.0, F2], [26.0, 34.0, F2], [22.0, 31.0, 0], [57.0, 42.0, 0]]
    m.hold = [[30.0, 20.0, 0], [45.0, 37.0, 0], [16.0, 37.0, 0]]
    m.sky = SKY
    m.weather = WEATHER
    m.centre = [30.0, -22.0]
    m.attract = [[10.0, 1.5, -9.4], [40.0, 1.5, -9.5]]
    print('  sealed doors, windows:', indoor.seal(m, indoor.inside_fn(m)))
    clutter.trim(m)
    print('  furnished:', clutter.furnish(m, 'hospital', random.Random(71), skip=('sales', 'tills', 'stairw', 'kitchen', 'cold_meat', 'backcor', 'loft', 'stockroom')))
    clutter.dress(m, 'hospital', random.Random(41), outside=[(-19.0, -23.0, 79.0, -1.0, 0.0), (-19.0, 0.0, -0.6, 61.0, 0.0), (60.6, 0.0, 79.0, 61.0, 0.0), (0.0, 44.6, 60.0, 61.0, 0.0)], out_n=50, blood=0.8)

    def supported(x, y, z):
        for b in m.boxes:
            if b.collide and abs(b.b[2] - z) < 0.08 and b.a[0] - 0.05 <= x <= b.b[0] + 0.05 and b.a[1] - 0.05 <= y <= b.b[1] + 0.05:
                return True
        return False
    floors = sorted({round(r['a'][2], 3) for r in m.rooms})
    gone = 0
    for lst, pos in ((m.props, lambda p: p['pos']), (m.units, lambda u: u['pos'])):
        keep = []
        for it in lst:
            x, y, z = pos(it)
            on_floor = any(abs(z - f) < 0.03 for f in floors) and X0 < x < X1 and Y0 < y < Y1
            if on_floor and not supported(x, y, z):
                gone += 1
                continue
            keep.append(it)
        lst[:] = keep
    print('  taken off floors that are not there:', gone)
    print('  cleared from the halls:', indoor.clear_halls(m))
    print('  cleared from the ways through:', indoor.clear_ways(m))
    return m


if __name__ == '__main__':
    import sys
    from layout import draw
    m = build()
    print('boxes', len(m.boxes), 'props', len(m.props), 'lights', len(m.lights), 'doors', len(m.doors), 'glass', len(m.glass), 'stains', len(m.stains), 'units', len(m.units))
    out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/store'
    draw(m, out + '_g.png', (0.3, 1.6))
    draw(m, out + '_u.png', (F2 + 0.3, F2 + 1.6))
