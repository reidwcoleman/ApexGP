"""Ashgrove Ward, rebuilt: a closed hospital on a stormy night, as data. Same language as layout.py.
Metres, x east, y north, z up. 52 x 34 m, the car park to the south.

The plan is a ring round an atrium, so there is never one way to anywhere:
  ground   the south corridor and the north corridor, joined at each end through the rooms and in the middle through
           the atrium (a colonnade down each side of it, under the galleries). South of the south corridor: the wards
           and reception. North of the north one: kitchen, canteen, a chapel two storeys high, the morgue, the plant room.
           West block: nurses, exam, staff, x-ray. East block: pharmacy, lab, the theatre, the scrub room.
  upstairs a gallery all round the atrium's void; the long ward (one room, fifteen metres of beds) to the west, the
           children's ward and isolation to the east, rooms over the street, rooms over the kitchens.
  under    a service tunnel from stair to stair below the south corridor, the boiler, a cold store and a flooded
           store off it, and a branch north under the east aisle to the incinerator, which has its own stair up into
           the morgue.
Up and down: a stair at each end of the south corridor (both go up and down), the incinerator stair, a floor that
came down into the atrium and can be climbed, and a hole in the isolation ward over the theatre table.

Somebody has been in since it closed. There's a generator running somewhere: a few tubes, site lights on tripods,
the battery lamps over the stairs. Every one of them can be shot out.
"""
import math, random
from layout import Map, EXT_T, INT_T

F2, TOP, BZ = 3.6, 7.2, -3.4
SLAB = 0.25
X0, X1, Y0, Y1 = 0.0, 52.0, 0.0, 34.0
SY0, SY1 = 6.0, 8.6        # south corridor
NY0, NY1 = 23.4, 26.0      # north corridor
AX0, AX1 = 15.0, 37.0      # the atrium, aisles and all
VX0, VX1, VY0, VY1 = 18.0, 34.0, 11.0, 21.0     # its void, open to the lantern
LANT = TOP + 1.6
BC = -0.55                 # tunnel ceiling (pipes under it)
MX = 7.5                   # west block split
EXM = 44.5                 # east block split
MY = 16.0                  # both blocks split here

# a night with the storm on it: the city's glow low on the clouds, cold and green-grey
SKY = dict(hdri='rooftop_night', strength=1.0, tint=(0.34, 0.46, 0.7))
WEATHER = dict(key=0.125, rain=1, wet=1, fog=1.25, sky=[0.3, 0.33, 0.4], wb=[0.96, 1.0, 1.02])
VOLUME = dict(step=[2, 1.15, 2], min=[-8, -4.6, -44], dim=[35, 13, 28])

TUBE = (0.8, 0.94, 1.0)
WARM = (1.0, 0.7, 0.4)
RED = (1.0, 0.07, 0.035)
SODIUM = (1.0, 0.55, 0.2)
HALO = (1.0, 0.86, 0.66)       # a halogen site light
EMBER = (1.0, 0.34, 0.08)
COLD = (0.72, 0.84, 1.0)
CANDLE = (1.0, 0.52, 0.22)
SCREEN = (0.4, 0.6, 1.0)


def rects_minus(x0, y0, x1, y1, holes):
    """the rectangle less the holes, as boxes: cut on every hole edge, keep the cells no hole covers"""
    xs = sorted({x0, x1, *[min(max(h[0], x0), x1) for h in holes], *[min(max(h[2], x0), x1) for h in holes]})
    ys = sorted({y0, y1, *[min(max(h[1], y0), y1) for h in holes], *[min(max(h[3], y0), y1) for h in holes]})
    out = []
    for i in range(len(xs) - 1):
        # merge runs along y for fewer boxes
        run = None
        for j in range(len(ys) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            hole = any(h[0] < cx < h[2] and h[1] < cy < h[3] for h in holes)
            if not hole:
                run = [xs[i], ys[j] if run is None else run[1], xs[i + 1], ys[j + 1]]
            elif run is not None:
                out.append(run); run = None
        if run is not None:
            out.append(run)
    return [r for r in out if r[2] - r[0] > 1e-3 and r[3] - r[1] > 1e-3]


def build():
    m = Map()
    m.rng = random.Random(29)
    R = m.rng
    box, wall, window, room, prop, light = m.box, m.wall, m.window, m.room, m.prop, m.light

    def grid(p, w):
        """the bots' path points stand a metre apart on whole numbers: a way through has to hold one with a body's width
        to spare, or the room behind it is cut off for them. Slide it to the nearest whole metre if it doesn't"""
        a, b = p - w / 2, p + w / 2
        if any(a + 0.28 <= q <= b - 0.28 for q in range(int(math.floor(a)), int(math.ceil(b)) + 1)):
            return p
        return float(round(p))

    def door(axis, c, p, z, w=0.92, **k):
        return m.door(axis, c, grid(p, max(w, 1.1)), z, w=w, **k)
    m.stains = []      # blood, old and dark: x, y, z, nx, ny, nz, size
    H1 = F2 - SLAB
    H2 = TOP - F2

    def D(n, x, y, z=0.0, r=0.0, **k):
        k.setdefault('collide', False)
        prop(n, x, y, z=z, rot=r, **k)

    def L(n, x, y, z=0.0, r=0.0, kg=4, sf='wood', **k):
        m.loose(n, x, y, z=z, rot=r, kg=kg, surf=sf, **k)

    def under(a, b, mat='dconc', **k):
        k.setdefault('density', 0.6)
        return box(a, b, mat, tag='under', **k)

    def K(kind, x, y, z=0.0, r=0.0, solid=None, tint=(1, 1, 1)):
        """a piece of the hospital kit (ward_kit.py); solid: (half along x, half along y, height) in its own axes"""
        m.unit('ward', [kind], x, y, z, rot=r, tint=tint, far=True)
        if solid:
            hx, hy, h = solid
            c, sn = abs(math.cos(r)), abs(math.sin(r))
            ex, ey = c * hx + sn * hy, sn * hx + c * hy
            m.invisible((x - ex, y - ey, z), (x + ex, y + ey, z + h), pen=True)

    def stains(*ss):
        m.stains.extend(ss)

    def tube(x, y, z, p, along='x', flick=0.0, lit=True):
        """a ceiling tube; flick > 0 means it can't make up its mind"""
        prop('mounted_fluorescent_lights', x, y, z=z - 0.03, rot=0 if along == 'x' else math.pi / 2, part='mounted_fluorescent_lights_a', collide=False)
        if lit:
            light('area', (x, y, z - 0.06), TUBE, p * 0.7, size=(1.2, 0.14) if along == 'x' else (0.14, 1.2), flicker=flick, reach=7.5)

    def emerg(x, y, z, p=4.0):
        """the red lamp over a door: on its own battery"""
        box((x - 0.14, y - 0.05, z - 0.08), (x + 0.14, y + 0.05, z + 0.06), 'emerg', collide=False, density=0.1)
        light('point', (x, y, z - 0.16), RED, p, radius=0.06, reach=5.5)

    def exit_sign(axis, c, p, z, side, t=INT_T):
        """a green running man over a way out, still lit; side is which way it faces (+1 / -1 along the wall's normal)"""
        f0 = c + side * (t / 2 + 0.004)
        f1 = f0 + side * 0.05
        if axis == 'x':
            box((p - 0.22, min(f0, f1), z), (p + 0.22, max(f0, f1), z + 0.17), 'exitsign', collide=False, density=0.15)
        else:
            box((min(f0, f1), p - 0.22, z), (max(f0, f1), p + 0.22, z + 0.17), 'exitsign', collide=False, density=0.15)

    def bulb(x, y, z, p, col=WARM, flick=0.0, cage=False):
        """a bare bulb on its flex (or a caged one), hung from z"""
        if cage:
            prop('caged_hanging_light', x, y, z=z - 0.15, collide=False)
        else:
            D('pull_chain_light_socket', x, y, z=z - 0.02)
        light('point', (x, y, z - (0.42 if cage else 0.3)), col, p, radius=0.05, flicker=flick)

    def site_light(x, y, z, aim, p=260.0, flick=0.0):
        """a halogen pair on a tripod, pointed along aim (x, y): hard light, long shadows, half the room left black"""
        a = math.atan2(aim[1], aim[0])
        K(f'worklight_{int(x * 7 + y * 3) % 2 + 1}', x, y, z, r=a + math.pi / 2, solid=(0.22, 0.22, 1.8))
        al = math.hypot(*aim) or 1.0
        light('spot', (x + aim[0] / al * 0.16, y + aim[1] / al * 0.16, z + 1.74), HALO, p, spot=1.75, blend=0.5, radius=0.06, aim=(aim[0] / al, aim[1] / al, -0.16), flicker=flick, reach=11.0)

    def way(axis, c, p, z, w=1.5, h=2.3):
        """a doorway whose door went long ago: the frame is still there"""
        p = grid(p, w)
        a, b = p - w / 2, p + w / 2
        m.casing(axis, c, a, b, z, z + h)
        m.openings.append((p, c, z, w, axis) if axis == 'x' else (c, p, z, w, axis))
        return (a, b, z, z + h)

    def breach(axis, c, p, z, w=1.6, h=1.9, t=INT_T):
        """a hole knocked through a wall, ragged: no frame, bricks showing at the edge, what came out of it on the floor"""
        p = grid(p, w)
        a, b = p - w / 2, p + w / 2
        m.openings.append((p, c, z, w, axis) if axis == 'x' else (c, p, z, w, axis))
        # teeth left round the edge
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
            for e in (a, b):
                ww = R.uniform(0.05, 0.14)
                zz = z + R.uniform(0.4, h - 0.5)
                if axis == 'x':
                    box((e - (ww if e == b else 0), c - t / 2 + 0.01, zz), (e + (ww if e == a else 0), c + t / 2 - 0.01, zz + R.uniform(0.15, 0.4)), 'hbrick_c', collide=False, density=0.3)
                else:
                    box((c - t / 2 + 0.01, e - (ww if e == b else 0), zz), (c + t / 2 - 0.01, e + (ww if e == a else 0), zz + R.uniform(0.15, 0.4)), 'hbrick_c', collide=False, density=0.3)
            px, py = (p + R.uniform(-0.3, 0.3), c + s * 0.9) if axis == 'x' else (c + s * 0.9, p + R.uniform(-0.3, 0.3))
            K(f'debris_{int(px * 13 + py * 7) % 5 + 1}', px, py, z + 0.001, R.uniform(0, 6.28))
        return (a, b, z, z + h)

    def part(axis, c, p0, p1, z, h, holes=(), t=INT_T, mat='wall_int', tag='int', pen=True):
        wall(axis, c, p0, p1, z, z + h, t, mat, tag=tag, holes=list(holes), pen=pen)

    def guard(axis, c, p0, p1, z, h=1.05, mat='steel'):
        """a rail that has to hold: its barrier stays whatever the tidy-up passes think"""
        m.rail(axis, c, p0, p1, z, h=h, mat=mat)
        a, b, _ = m.solid[-1]
        m.solid[-1] = (a, b, False)

    def counter(x0, y0, x1, y1, z=0.0, h=1.05, top='wood_top', body='planks'):
        box((x0, y0, z), (x1, y1, z + h), body, pen=True, tag='counter', density=0.5)
        box((x0 - 0.05, y0 - 0.05, z + h), (x1 + 0.05, y1 + 0.05, z + h + 0.05), top, collide=False, density=0.4)

    def table(x0, y0, x1, y1, z=0.0, h=0.88, sheet=False):
        """a steel table: mortuary, kitchen, theatre"""
        box((x0, y0, z + h - 0.06), (x1, y1, z + h), 'steel', pen=True, tag='counter', density=0.4)
        m.invisible((x0, y0, z), (x1, y1, z + h - 0.06), pen=True)
        for (x, y) in ((x0 + 0.05, y0 + 0.05), (x1 - 0.05, y0 + 0.05), (x0 + 0.05, y1 - 0.05), (x1 - 0.05, y1 - 0.05)):
            box((x - 0.03, y - 0.03, z), (x + 0.03, y + 0.03, z + h - 0.06), 'steel', collide=False, density=0.15)
        if sheet:
            box((x0 + 0.04, y0 + 0.1, z + h), (x1 - 0.04, y1 - 0.1, z + h + 0.19), 'sheet', collide=False, density=0.3)
            box((x0 + 0.14, y0 + 0.14, z + h + 0.19), (x1 - 0.14, y0 + 0.5, z + h + 0.27), 'sheet', collide=False, density=0.3)

    # ================= outside: a wet apron round the building, a wall round that; only seen through the glass =================
    box((-18, -20, -1), (70, Y0, 0), 'asphalt', tag='ground', density=0.4)
    box((-18, Y0, -1), (X0, 52, 0), 'yard', tag='ground', density=0.4)
    box((X1, Y0, -1), (70, 52, 0), 'yard', tag='ground', density=0.4)
    box((X0, Y1, -1), (X1, 52, 0), 'yard', tag='ground', density=0.4)
    for x in list(range(-12, 18, 3)) + list(range(36, 66, 3)):
        box((x, -12.0, -0.2), (x + 0.1, -6.5, 0.004), 'paint', collide=False, density=0.05)
    box((19.0, -5.0, -0.2), (33.0, -4.88, 0.004), 'paint_y', collide=False, density=0.05)
    BW = 3.4
    for a, b in (((-18.4, -20.4), (70.4, -20)), ((-18.4, 52), (70.4, 52.4)), ((-18.4, -20), (-18, 52)), ((70, -20), (70.4, 52))):
        box((a[0], a[1], 0), (b[0], b[1], BW), 'hbrick_c', tag='ext', density=0.2)
        box((a[0] - 0.08, a[1] - 0.08, BW), (b[0] + 0.08, b[1] + 0.08, BW + 0.12), 'stone', collide=False, density=0.08)
    # the hospital's other blocks, dark against the cloud
    for (a, b, h) in (((-50, 58), (20, 80), 22), ((30, 60), (100, 84), 16), ((-56, -44), (-26, 46), 12), ((80, -34), (104, 46), 19), ((-14, -66), (70, -36), 9)):
        box((a[0], a[1], 0), (b[0], b[1], h), 'brick_b', collide=False, tag='far', density=0.02)

    # ================= slabs =================
    DNW = (3.15, Y0, 6.0, 5.4)                      # west stair: the way down
    DNE = (X1 - 6.0, Y0, X1 - 3.15, 5.4)
    STW = (X0, Y0, 3.15, 5.4)                       # and the way up
    STE = (X1 - 3.15, Y0, X1, 5.4)
    MST = (36.4, 32.3, 42.4, 33.85)                 # the stair from the morgue down to the incinerator
    VOID = (VX0, VY0, VX1, VY1)
    CHAP = (20.0, NY1, 32.0, Y1)                    # the chapel goes up through both floors
    FALL = (38.0, 17.0, 40.6, 19.4)                 # where the isolation ward's floor went into the theatre
    for r in rects_minus(X0, Y0, X1, Y1, [DNW, DNE, MST]):
        box((r[0], r[1], -0.3), (r[2], r[3], 0.0), 'slab', tag='floor')
    for r in rects_minus(X0, Y0, X1, Y1, [STW, STE, VOID, CHAP, FALL]):
        box((r[0], r[1], F2 - SLAB), (r[2], r[3], F2), 'slab', tag='floor')
    # the roof: tagged as a floor so each room under it gets its own ceiling
    for r in rects_minus(X0 - 0.3, Y0 - 0.3, X1 + 0.3, Y1 + 0.3, [(VX0 + 0.02, VY0 + 0.02, VX1 - 0.02, VY1 - 0.02)]):
        box((r[0], r[1], TOP), (r[2], r[3], TOP + 0.35), 'roof', tag='floor', density=0.1)
    # the lantern over the void: a brick upstand, steel trusses, glass gone grey with dirt, a few panes still letting the sky in
    for a, b in (((VX0 - 0.3, VY0 - 0.3), (VX1 + 0.3, VY0)), ((VX0 - 0.3, VY1), (VX1 + 0.3, VY1 + 0.3)), ((VX0 - 0.3, VY0), (VX0, VY1)), ((VX1, VY0), (VX1 + 0.3, VY1))):
        box((a[0], a[1], TOP), (b[0], b[1], LANT), 'hbrick', tag='ext', density=0.25)
    box((VX0 - 0.3, VY0 - 0.3, LANT), (VX1 + 0.3, VY1 + 0.3, LANT + 0.25), 'tin_roof', faces={'-z': 'tin_in'}, tag='roof', density=0.15)
    for x in (20.0, 24.0, 28.0, 32.0):
        box((x - 0.07, VY0, LANT - 0.5), (x + 0.07, VY1, LANT - 0.36), 'ruststeel', collide=False, density=0.12)
        box((x - 0.05, VY0, LANT - 0.14), (x + 0.05, VY1, LANT - 0.02), 'ruststeel', collide=False, density=0.12)
        for k in range(6):
            y = VY0 + 0.8 + k * 1.7
            box((x - 0.03, y - 0.03, LANT - 0.5), (x + 0.03, y + 0.03, LANT - 0.02), 'ruststeel', collide=False, density=0.06)
    for (x, y, w, d) in ((21.0, 12.4, 1.8, 2.6), (25.0, 16.6, 1.8, 2.8), (29.0, 13.0, 1.8, 2.4), (21.2, 17.8, 1.6, 2.2), (30.6, 17.4, 1.8, 2.6)):
        box((x, y, LANT - 0.02), (x + w, y + d, LANT - 0.005), 'nightglass', collide=False, density=0.1)
    # parapets and a string course
    for a, b in (((X0 - 0.3, Y0 - 0.3), (X1 + 0.3, Y0)), ((X0 - 0.3, Y1), (X1 + 0.3, Y1 + 0.3)), ((X0 - 0.3, Y0), (X0, Y1)), ((X1, Y0), (X1 + 0.3, Y1))):
        box((a[0], a[1], TOP + 0.35), (b[0], b[1], TOP + 1.0), 'hbrick', density=0.1)
        box((a[0] - 0.05, a[1] - 0.05, TOP + 1.0), (b[0] + 0.05, b[1] + 0.05, TOP + 1.1), 'stone', collide=False, density=0.06)
    for a, b in (((X0 - 0.42, Y0 - 0.42), (X1 + 0.42, Y0 - 0.16)), ((X0 - 0.42, Y1 + 0.16), (X1 + 0.42, Y1 + 0.42)), ((X0 - 0.42, Y0 - 0.16), (X0 - 0.16, Y1 + 0.16)), ((X1 + 0.16, Y0 - 0.16), (X1 + 0.42, Y1 + 0.16))):
        box((a[0], a[1], F2 - 0.3), (b[0], b[1], F2 - 0.1), 'stone', collide=False, density=0.08)
        box((a[0], a[1], 0), (b[0], b[1], 0.55), 'plinth', collide=False, density=0.08)

    # ================= the outside walls =================
    EXT = 'hbrick'

    def ext(axis, c, p0, p1, wins_g, wins_u, doors_g=(), tall=()):
        holes = [door(axis, c, p, 0.0, w=w, kind='steel', hinge=hg, swing=1) for (p, w, hg) in doors_g]
        holes += [window(axis, c, p, 0.0, w=1.3, h=1.7, sill=0.95, boards=R.random() < 0.22, glass=R.random() < 0.72) for p in wins_g]
        holes += [window(axis, c, p, 0.0, w=1.5, h=2.5, sill=0.35, glass=g) for (p, g) in tall]
        wall(axis, c, p0, p1, 0.0, F2, EXT_T, EXT, tag='ext', holes=holes)
        holes = [window(axis, c, p, F2, w=1.3, h=1.8, sill=0.9, boards=R.random() < 0.2, glass=R.random() < 0.7) for p in wins_u]
        wall(axis, c, p0, p1, F2, TOP, EXT_T, EXT, tag='ext', holes=holes)

    # south front: the glazed entrance in the middle, ward windows either side
    ext('x', Y0, X0, X1, (8.5, 11.5, 14.5, 37.0, 40.0, 43.5), (8.0, 11.0, 13.5, 18.5, 21.5, 24.0, 28.5, 31.5, 34.0, 38.5, 41.0, 44.0),
        doors_g=((25.4, 1.2, 0), (26.6, 1.2, 1)), tall=((20.0, True), (22.4, False), (29.6, True), (32.0, True)))
    box((22.6, Y0 - 2.8, 3.0), (29.4, Y0 - 0.16, 3.22), 'shopframe', collide=False, density=0.3)
    for x in (22.8, 29.2):
        box((x - 0.08, Y0 - 2.7, 0), (x + 0.08, Y0 - 2.54, 3.0), 'steel', density=0.15)
    box((23.2, Y0 - 0.2, 3.3), (28.8, Y0 - 0.16, 3.5), 'signboard', collide=False, density=0.15)
    # north: the kitchen's yard door, the chapel's lancets (both floors high, glass in most), the plant's roller door
    def north(p0, p1, g_holes, u_wins):
        wall('x', Y1, p0, p1, 0.0, F2, EXT_T, EXT, tag='ext', holes=g_holes)
        wall('x', Y1, p0, p1, F2, TOP, EXT_T, EXT, tag='ext', holes=[window('x', Y1, x, F2, w=1.3, h=1.8, sill=0.9, boards=bd, glass=gl) for (x, bd, gl) in u_wins])
    north(X0, 20.0, [door('x', Y1, 4.5, 0.0, w=1.2, kind='steel', swing=-1), window('x', Y1, 7.5, 0.0, boards=True), window('x', Y1, 12.0, 0.0), window('x', Y1, 16.5, 0.0, glass=False)],
          [(4.0, False, True), (8.0, True, True), (12.5, False, False), (16.5, False, True)])
    holes = [window('x', Y1, x, 0.0, w=0.9, h=4.6, sill=1.4, glass=x != 28.4) for x in (22.0, 23.6, 28.4, 30.0)]
    holes.append(window('x', Y1, 26.0, 0.0, w=1.4, h=5.0, sill=1.4))
    wall('x', Y1, 20.0, 32.0, 0.0, TOP, EXT_T, EXT, tag='ext', holes=holes)
    north(32.0, X1, [window('x', Y1, 34.6, 0.0, w=1.0, h=1.0, sill=1.9), window('x', Y1, 45.5, 0.0), door('x', Y1, 49.0, 0.0, w=1.4, kind='steel', swing=-1)],
          [(34.5, False, True), (38.0, False, True), (41.0, True, True), (45.0, False, False), (49.0, False, True)])
    ext('y', X0, Y0, Y1, (11.0, 14.0, 19.0, 21.5, 29.0, 31.5), (2.5, 10.5, 13.0, 15.5, 18.0, 20.5, 29.0, 31.5), doors_g=((7.3, 1.2, 0),))
    ext('y', X1, Y0, Y1, (11.0, 14.0, 19.5, 29.0, 31.5), (2.5, 10.5, 13.5, 18.0, 21.0, 29.0, 31.5), doors_g=((24.7, 1.2, 0),))

    # ================= ground floor =================
    Z = 0.0
    # ---- the south corridor. Its south side: the stair, ward A, reception wide open on columns, triage, the stair
    part('x', SY0, X0, 18.0, Z, H1, holes=[way('x', SY0, 3.0, Z, w=5.4, h=2.45), way('x', SY0, 9.0, Z), door('x', SY0, 15.5, Z, swing=-1)])
    part('x', SY0, 34.0, X1, Z, H1, holes=[door('x', SY0, 36.5, Z, swing=-1), way('x', SY0, 43.0, Z), way('x', SY0, X1 - 3.0, Z, w=5.4, h=2.45)])
    box((18.0, SY0 - 0.12, 2.75), (34.0, SY0 + 0.12, H1), 'wall_int', tag='int', density=0.4)
    for x in (18.0, 23.3, 28.7, 34.0):
        box((x - 0.22, SY0 - 0.22, Z), (x + 0.22, SY0 + 0.22, 2.75), 'wall_int', tag='post', density=0.4)
    for x in (20.65, 26.0, 31.35):
        m.openings.append((x, SY0, Z, 4.6, 'x'))
    # its north side, west of the atrium and east of it
    part('x', SY1, X0, AX0, Z, H1, holes=[way('x', SY1, 3.5, Z), (8.6, 13.6, Z + 1.05, Z + 2.5)])
    m.casing('x', SY1, 8.6, 13.6, Z + 1.05, Z + 2.5, INT_T, 'trim', sill=True)
    part('x', SY1, AX1, X1, Z, H1, holes=[door('x', SY1, 40.5, Z), breach('x', SY1, 47.5, Z)])
    # the atrium's south wall: three ways through under the gallery, and glass between them
    aw = [way('x', SY1, 19.4, Z, w=2.6, h=2.5), way('x', SY1, 26.0, Z, w=3.0, h=2.5), way('x', SY1, 32.6, Z, w=2.6, h=2.5)]
    aw += [window('x', SY1, x, Z, w=1.6, h=1.5, sill=1.0, wt=0.22, glass=g) for (x, g) in ((16.4, True), (22.6, True), (29.4, False), (35.6, True))]
    wall('x', SY1, AX0, AX1, Z, H1, 0.2, 'hbrick', tag='int', holes=aw, pen=True)
    # ---- the north corridor
    part('x', NY0, X0, AX0, Z, H1, holes=[door('x', NY0, 3.5, Z), way('x', NY0, 11.0, Z)])
    part('x', NY0, AX1, X1, Z, H1, holes=[way('x', NY0, 41.5, Z, w=1.8), door('x', NY0, 49.0, Z, kind='steel')])
    aw = [way('x', NY0, 19.4, Z, w=2.6, h=2.5), way('x', NY0, 26.0, Z, w=3.0, h=2.5), way('x', NY0, 32.6, Z, w=2.6, h=2.5)]
    aw += [window('x', NY0, x, Z, w=1.6, h=1.5, sill=1.0, wt=0.22, glass=g) for (x, g) in ((16.4, False), (22.6, True), (29.4, True), (35.6, False))]
    wall('x', NY0, AX0, AX1, Z, H1, 0.2, 'hbrick', tag='int', holes=aw, pen=True)
    part('x', NY1, X0, 20.0, Z, H1, holes=[way('x', NY1, 4.5, Z), way('x', NY1, 14.5, Z, w=2.4)])
    part('x', NY1, 32.0, X1, Z, H1, holes=[door('x', NY1, 37.5, Z, w=1.3, kind='steel', swing=-1), way('x', NY1, 47.5, Z, w=1.8)])
    # the chapel's front goes to the roof: double doors, one off its hinges
    part('x', NY1, 20.0, 32.0, Z, TOP, holes=[way('x', NY1, 26.0, Z, w=2.2, h=2.6), (21.4, 23.6, F2 + 1.0, F2 + 2.6), (28.4, 30.6, F2 + 1.0, F2 + 2.6)])
    for (a, b) in ((21.4, 23.6), (28.4, 30.6)):
        m.casing('x', NY1, a, b, F2 + 1.0, F2 + 2.6, INT_T, 'trim', sill=True)
        m.invisible((a, NY1 - 0.08, F2), (b, NY1 + 0.08, F2 + 1.0))
    # ---- the two blocks either side of the atrium: their walls onto the aisles
    part('y', AX0, SY1, NY0, Z, H1, holes=[way('y', AX0, 12.0, Z), breach('y', AX0, 19.6, Z, w=1.8)], t=0.2, mat='hbrick')
    part('y', AX1, SY1, NY0, Z, H1, holes=[(9.4, 13.4, Z + 1.05, Z + 2.5), way('y', AX1, 14.6, Z, w=1.3), door('y', AX1, 19.8, Z, w=1.5, kind='steel', swing=-1)], t=0.2, mat='hbrick')
    # inside the west block
    part('y', MX, SY1, NY0, Z, H1, holes=[breach('y', MX, 12.0, Z), door('y', MX, 20.0, Z)])
    part('x', MY, X0, AX0, Z, H1, holes=[way('x', MY, 3.6, Z), door('x', MY, 11.5, Z, kind='steel', swing=-1)])
    # inside the east block
    part('y', EXM, SY1, MY, Z, H1, holes=[way('y', EXM, 12.4, Z)])
    part('y', 46.0, MY, NY0, Z, H1, holes=[way('y', 46.0, 19.6, Z, w=1.4)])
    part('x', MY, AX1, X1, Z, H1, holes=[breach('x', MY, 41.5, Z), way('x', MY, 49.0, Z)])
    # ---- the south rooms' partitions, and the north rooms'
    part('y', 6.0, Y0, SY0, Z, H1)
    part('y', 18.0, Y0, SY0, Z, H1, holes=[way('y', 18.0, 3.2, Z)])
    part('y', 34.0, Y0, SY0, Z, H1, holes=[breach('y', 34.0, 2.6, Z)])
    part('y', 46.0, Y0, SY0, Z, H1)
    part('y', 9.0, NY1, Y1, Z, H1, holes=[way('y', 9.0, 30.0, Z, w=2.2)])
    part('y', 20.0, NY1, Y1, Z, TOP, holes=[door('y', 20.0, 29.0, Z)], t=0.24)
    part('y', 32.0, NY1, Y1, Z, TOP, holes=[breach('y', 32.0, 28.6, Z, t=0.24)], t=0.24)
    part('y', 43.0, NY1, Y1, Z, H1, holes=[door('y', 43.0, 28.0, Z, kind='steel')])

    room('scor', X0, SY0, X1, SY1, Z, H1, 'hosp_wall', 'hlino')
    room('ncor', X0, NY0, X1, NY1, Z, H1, 'hosp_wall', 'hlino')
    room('stairw', X0, Y0, 6, SY0, BZ, TOP - BZ, 'wall_conc', 'concstep')
    room('stairs', 46, Y0, X1, SY0, BZ, TOP - BZ, 'wall_conc', 'concstep')
    room('warda', 6, Y0, 18, SY0, Z, H1, 'hosp_wall2', 'hlino')
    room('lobby', 18, Y0, 34, SY0, Z, H1, 'hosp_wall3', 'mtile')
    room('triage', 34, Y0, 46, SY0, Z, H1, 'hosp_wall2', 'hlino')
    # the atrium is five rooms so nothing is ever hung from, or laid on, a floor that isn't there: the well itself, and the aisle under each gallery
    room('atrium', VX0, VY0, VX1, VY1, Z, LANT, 'hbrick', 'mtile', ceil='tin_in')
    room('acor_s', AX0, SY1, AX1, VY0, Z, H1, 'hbrick', 'mtile', ceil='ceil')
    room('acor_n', AX0, VY1, AX1, NY0, Z, H1, 'hbrick', 'mtile', ceil='ceil')
    room('acor_w', AX0, VY0, VX0, VY1, Z, H1, 'hbrick', 'mtile', ceil='ceil')
    room('acor_e', VX1, VY0, AX1, VY1, Z, H1, 'hbrick', 'mtile', ceil='ceil')
    room('exam', X0, SY1, MX, MY, Z, H1, 'hosp_wall2', 'hlino')
    room('nurse', MX, SY1, AX0, MY, Z, H1, 'hosp_wall', 'hlino')
    room('staff', X0, MY, MX, NY0, Z, H1, 'wall_paper', 'carpet')
    room('xray', MX, MY, AX0, NY0, Z, H1, 'wtile', 'mtile')
    room('pharm', AX1, SY1, EXM, MY, Z, H1, 'hosp_wall3', 'mtile')
    room('lab', EXM, SY1, X1, MY, Z, H1, 'wtile', 'mtile')
    room('theatre', AX1, MY, 46, NY0, Z, H1, 'wtile', 'mtile')
    room('scrub', 46, MY, X1, NY0, Z, H1, 'wtile', 'mtile')
    room('kitchen', X0, NY1, 9, Y1, Z, H1, 'wtile', 'mtile')
    room('canteen', 9, NY1, 20, Y1, Z, H1, 'hosp_wall3', 'hlino')
    room('chapel', 20, NY1, 32, Y1, Z, TOP, 'wall_paper', 'wood', dado=('panel', 1.3))
    room('morgue', 32, NY1, 43, Y1, Z, H1, 'wtile', 'mtile')
    room('plant', 43, NY1, X1, Y1, Z, H1, 'dconc', 'gfloor')

    # ---- stairs: one at each end of the south corridor. West half of each well goes up, east half down
    def stairwell(mirror):
        fx = (lambda x: X1 - x) if mirror else (lambda x: x)

        def rx(a, b):
            a, b = fx(a), fx(b)
            return min(a, b), max(a, b)
        # up: south to a half landing, back north to the gallery
        a, b = rx(0.15, 1.55)
        m.stairs(a, 1.6, b, 5.4, 0.0, 1.8, '-y')
        a, b = rx(0.15, 3.05)
        box((a, 0.16, 0.0), (b, 1.6, 1.8), 'concstep', tag='step', density=0.5)
        a, b = rx(1.65, 3.05)
        m.stairs(a, 1.6, b, 5.4, 1.8, F2, '+y', solid=False)
        box((a, 1.6, 0.0), (b, 5.4, 1.8), 'wall_conc', tag='int', density=0.4)
        a, b = rx(1.55, 1.65)
        box((a, 1.6, 0.0), (b, 5.4, 2.85), 'wall_conc', tag='int', density=0.3)
        # the up landing looks down into the well of the way down: a rail
        guard('y', fx(3.15), 0.16, 1.6, 1.8)
        # upstairs: a rail round the well
        guard('y', fx(3.15), 0.2, 5.4, F2)
        # down: south to a half landing, back north to the tunnel
        a, b = rx(3.25, 4.5)
        m.stairs(a, 1.6, b, 5.4, BZ + 1.7, 0.0, '+y')
        under((a, 1.6, BZ), (b, 5.4, BZ + 1.7), 'wall_conc')
        a, b = rx(3.25, 5.85)
        box((a, 0.0, BZ), (b, 1.6, BZ + 1.7), 'concstep', tag='step', density=0.5)
        a, b = rx(4.6, 5.85)
        m.stairs(a, 1.6, b, 5.4, BZ, BZ + 1.7, '-y')
        # the wall between the two flights, up to a rail's height above the ground floor
        a, b = rx(4.5, 4.6)
        under((a, 1.6, BZ), (b, 5.4, 0.0), 'wall_conc')
        guard('y', fx(4.55), 1.6, 5.4, 0.0, h=1.0)
        a, b = rx(4.6, 5.9)
        guard('x', 5.42, a, b, 0.0, h=1.0)
        # between the way up and the way down at ground level
        a, b = rx(3.05, 3.25)
        box((a, 0.16, 0.0), (b, 1.6, 1.8), 'wall_conc', tag='int', density=0.3)
        under((a, 0.16, BZ), (b, 5.4, 0.0), 'wall_conc')
        # and that wall carried up beside the flight: a ledge a hand wide at floor level is somewhere to get stuck
        box((a, 1.6, 0.0), (b, 5.4, 1.8), 'wall_conc', tag='int', density=0.3)
        # the well below ground: floor, the earth under the way up, walls
        a, b = rx(-0.2, 6.2)
        under((a, -0.2, BZ - 0.3), (b, SY0, BZ), 'conc')
        under((a, -0.2, BZ), (b, 0.0, -0.3))
        a, b = rx(-0.2, 3.05)
        under((a, 0.0, BZ), (b, SY0, -0.3))
        a, b = rx(6.0, 6.2)
        under((a, 0.0, BZ), (b, SY0, -0.3))
        # lamps: red over the way up on both floors, a caged one at the bottom
        emerg(fx(1.6), SY0 - 0.18, 2.6, 4)
        emerg(fx(1.6), SY0 - 0.18, F2 + 2.7, 3)
        light('point', (fx(4.4), 0.9, BZ + 1.7 + 2.3), RED, 3.5, radius=0.05, reach=5.0)
        box((fx(4.4) - 0.14, 0.05, BZ + 1.7 + 2.38), (fx(4.4) + 0.14, 0.15, BZ + 1.7 + 2.52), 'emerg', collide=False, density=0.1)
    stairwell(False)
    stairwell(True)

    # ---- reception: the desk as an island, rows of seats, the entrance screen behind
    counter(22.6, 3.2, 29.4, 3.9)
    counter(22.6, 1.6, 23.3, 3.2)
    counter(28.7, 1.6, 29.4, 3.2)
    D('classic_laptop', 25.0, 3.5, z=1.1, r=math.pi)
    D('clipboard', 27.2, 3.55, z=1.1, r=0.4)
    D('binder_notebook', 23.6, 3.5, z=1.1, r=2.2)
    D('Television_01', 26.4, 3.45, z=1.1, r=math.pi)
    L('SchoolChair_01', 26.0, 2.4, r=2.9, kg=6)
    for row in range(2):
        for k in range(5):
            if (row, k) in ((0, 3), (1, 1)):
                continue
            L('plastic_monobloc_chair_01', 19.4 + row * 0.9, 1.2 + k * 0.7 + R.uniform(-0.05, 0.05), r=-math.pi / 2 + R.uniform(-0.3, 0.3), kg=2.5, sf='plastic')
    for k in range(4):
        L('plastic_monobloc_chair_01', 32.6, 1.3 + k * 0.72, r=math.pi / 2 + R.uniform(-0.4, 0.4), kg=2.5, sf='plastic')
    L('wheelchair_01', 30.8, 4.6, r=2.3, kg=14, sf='metal')
    D('wall_clock', 26.0, SY0 - 0.14, z=2.95, r=math.pi)
    prop('drawer_cabinet', 21.2, 0.5, rot=0, part='drawer_cabinet')
    D('potted_plant_02', 19.0, 5.2, r=1.0)
    D('potted_plant_04', 33.2, 5.3, r=2.0)
    tube(26.0, 2.6, H1, 22)
    exit_sign('x', Y0, 26.0, 2.45, 1, t=EXT_T)
    stains((27.6, 4.6, 0.0, 0, 0, 1, 1.7), (24.2, 3.94, 0.6, 0, 1, 0, 1.0), (26.3, 5.0, 0.0, 0, 0, 1, 0.9))
    for i in range(7):
        stains((27.4 - i * 0.25, 5.2 + i * 0.75, 0.0, 0, 0, 1, 0.75))        # dragged, towards the atrium

    # ---- ward A: iron beds down the south wall, curtains half gone
    for i in range(4):
        x = 7.6 + i * 2.8
        K(f'hbed_{(i + 6) % 8 + 1}', x, 1.25, r=math.pi + R.uniform(-0.12, 0.12) + (0.45 if i == 2 else 0.0), solid=(0.48, 1.04, 0.7))
        D('ClassicNightstand_01', x + 0.85, 0.42, r=R.uniform(-0.2, 0.2))
        if i != 1:
            K(f'curtain_{(i * 7 + 3) % 6 + 1}', x, 2.75, z=H1)
        if R.random() < 0.6:
            K('iv', x - 0.75, 0.9, r=R.uniform(0, 6), solid=(0.25, 0.25, 1.9))
    L('wheelchair_01', 10.6, 4.6, r=R.uniform(0, 6), kg=14, sf='metal')
    L('metal_trash_can', 16.8, 5.3, kg=6, sf='metal', shape='cyl', part='metal_trash_can')
    tube(9.0, 3.4, H1, 0, lit=False)
    tube(14.0, 3.4, H1, 0, lit=False)
    stains((13.2, 1.3, 0.62, 0, 0, 1, 0.9), (16.0, SY0 - 0.08, 1.1, 0, -1, 0, 1.2))

    # ---- triage: bays behind screens, a gurney left across the middle, a lamp someone brought
    for i in range(3):
        x = 36.6 + i * 3.1
        K(f'hbed_{(i + 31) % 8 + 1}', x, 1.25, r=math.pi + R.uniform(-0.15, 0.15), solid=(0.48, 1.04, 0.7))
        K(f'curtain_{(i * 5 + 11) % 6 + 1}', x + 1.5, 1.6, z=H1, r=math.pi / 2)
        if i < 2:
            K('screen', x + 1.5, 3.6, r=math.pi / 2 + R.uniform(-0.3, 0.3), solid=(0.95, 0.3, 1.7))
    K('gurney_2', 41.0, 4.5, r=1.2, solid=(0.36, 0.98, 0.95))
    D('medical_box', 44.9, 0.5, z=0.0, r=0.4)
    L('metal_stool_01', 38.4, 4.9, r=0.3, kg=4, sf='metal')
    bulb(40.0, 3.0, H1, 5, WARM)
    stains((39.7, 1.2, 0.62, 0, 0, 1, 0.9), (41.2, 4.4, 0.9, 0, 0, 1, 0.8), (42.6, 3.0, 0.0, 0, 0, 1, 1.5))

    # ---- the nurses' station: a counter under the hatch onto the corridor, charts, a lamp left on
    counter(8.6, SY1 + 0.14, 13.6, SY1 + 0.72)
    D('desk_lamp_arm_01', 9.2, SY1 + 0.45, z=1.1, r=0.5)
    light('point', (9.3, SY1 + 0.6, 1.5), WARM, 2.6, radius=0.03, reach=4.5)
    D('classic_laptop', 11.2, SY1 + 0.45, z=1.1, r=0.1)
    D('office_notepads', 12.6, SY1 + 0.42, z=1.1, r=0.6)
    D('clipboard', 10.2, SY1 + 0.4, z=1.1, r=1.0)
    prop('drawer_cabinet', 9.0, MY - 0.5, rot=math.pi, part='drawer_cabinet')
    prop('drawer_cabinet', 10.0, MY - 0.5, rot=math.pi, part='drawer_cabinet')
    L('SchoolChair_01', 10.8, 10.4, r=2.6, kg=6)
    K('lockers_1', 13.2, MY - 0.55, r=0.0, solid=(0.6, 0.3, 1.9))
    # ---- exam: two couches behind screens, a trolley
    for (x, y) in ((1.6, 14.6), (5.2, 14.6)):
        K(f'hbed_{(int(x) + 1) % 8 + 1}', x, y, r=0.0, solid=(0.48, 1.04, 0.7))
        K('screen', x + 1.3, 13.2, r=math.pi / 2 + 0.2, solid=(0.95, 0.3, 1.7))
    prop('industrial_storage_cart', 0.8, 10.4, rot=1.5, collide=(0.8, 0.55, 0.6))
    D('medical_box', 0.8, 10.4, z=0.62, r=0.3)
    L('metal_stool_02', 5.6, 11.0, r=0.6, kg=4, sf='metal')
    D('wall_clock', 0.18, 12.6, z=2.3, r=-math.pi / 2)
    stains((1.6, 14.4, 0.62, 0, 0, 1, 0.9), (3.4, 12.6, 0.0, 0, 0, 1, 1.4), (MX - 0.08, 13.6, 1.1, -1, 0, 0, 1.2))
    # ---- staff room: sofas, a television that still has a picture of nothing
    prop('Sofa_01', 3.6, 22.7, rot=math.pi)
    prop('ArmChair_01', 0.9, 19.6, rot=-math.pi / 2 + 0.3)
    prop('CoffeeTable_01', 3.6, 21.0, rot=0.1)
    prop('Television_01', 6.6, 17.6, z=0.0, rot=math.pi / 2 + 0.4, collide=(0.3, 0.3, 0.5))
    box((6.3, 17.3, 0.5), (6.36, 17.9, 0.9), 'screenglow', collide=False, density=0.1)
    light('point', (5.9, 17.7, 0.75), SCREEN, 2.4, radius=0.1, flicker=0.22, reach=5.0)
    D('ceiling_fan', 3.6, 20.0, z=H1 - 0.52)
    L('wine_bottles_01', 3.4, 21.0, z=0.52, kg=1, sf='glass')
    K('lockers_2', 0.65, 17.6, r=math.pi / 2, solid=(0.6, 0.3, 1.9))
    # ---- x-ray: the table and its gantry, the viewing box on the wall still lit, the lead screen
    table(10.0, 19.0, 12.2, 19.9)
    box((12.5, 19.1, 0), (13.1, 19.7, 2.7), 'steel', density=0.3)
    box((10.7, 19.2, 2.2), (13.1, 19.7, 2.5), 'steel', collide=False, density=0.3)
    box((11.0, 19.25, 1.7), (11.7, 19.65, 2.2), 'plastic_black', collide=False, density=0.2)
    box((9.2, NY0 - 0.1, 1.2), (10.9, NY0 - 0.075, 1.85), 'lightbox', collide=False, density=0.2)
    box((9.1, NY0 - 0.12, 1.14), (11.0, NY0 - 0.07, 1.2), 'steel', collide=False, density=0.1)
    box((7.9, 17.0, 0.0), (9.0, 17.12, 1.9), 'steel', pen=True, tag='counter', density=0.3)
    prop('metal_tool_chest', 14.4, 22.6, rot=math.pi / 2)
    L('wheelchair_01', 13.4, 17.4, r=1.2, kg=14, sf='metal')
    stains((11.0, 19.4, 0.89, 0, 0, 1, 0.8), (12.2, 21.2, 0.0, 0, 0, 1, 1.3), (AX0 - 0.12, 21.6, 1.2, -1, 0, 0, 1.4))

    # ---- pharmacy: a counter with a grille onto the aisle, shelves stripped
    counter(AX1 + 0.14, 9.4, AX1 + 0.7, 13.4)
    for y in [9.5 + i * 0.13 for i in range(30)]:
        box((AX1 - 0.02, y, 1.05), (AX1 + 0.02, y + 0.02, 2.5), 'grate', collide=False, density=0.04)
    m.invisible((AX1 - 0.05, 9.4, 1.05), (AX1 + 0.05, 13.4, 2.5), pen=True)
    for y in (9.6, 11.4, 13.2):
        prop('Shelf_01', EXM - 0.34, y, rot=math.pi / 2)
    for x in (39.4, 41.4):
        prop('steel_frame_shelves_02', x, 14.8, rot=0)
    L('plastic_crate_01', 42.6, 10.0, r=0.4, kg=1.5, sf='plastic')
    L('plastic_crate_02', 40.0, 11.6, r=1.4, kg=1.5, sf='plastic')
    D('medical_box', 37.5, 11.0, z=1.1, r=0.3)
    # ---- the lab: benches round the walls, an island, stools, a lamp
    counter(EXM + 0.14, 14.6, X1 - 0.14, 15.3, h=0.92, top='plastic_black', body='steel')
    counter(X1 - 0.8, 9.2, X1 - 0.14, 14.6, h=0.92, top='plastic_black', body='steel')
    counter(46.6, 10.8, 49.4, 11.6, h=0.92, top='plastic_black', body='steel')
    D('desk_lamp_arm_01', 47.0, 11.2, z=0.97, r=2.0)
    light('point', (47.1, 11.1, 1.4), WARM, 2.4, radius=0.03, reach=4.5)
    D('vintage_microwave', 51.5, 12.0, z=0.97, r=-math.pi / 2)
    L('metal_stool_01', 47.8, 12.4, r=0.3, kg=4, sf='metal')
    L('metal_stool_02', 46.2, 10.2, r=2.0, kg=4, sf='metal')
    L('plastic_bottle_gallon', 49.0, 11.2, z=0.97, kg=1.5, sf='plastic')
    stains((48.0, 11.2, 0.98, 0, 0, 1, 0.7), (49.6, 13.4, 0.0, 0, 0, 1, 1.2))
    # ---- the theatre: the table under its lamp, trolleys, the drain, and by the door the hole the floor above left
    table(42.2, 19.0, 44.2, 19.8)
    box((43.12, 20.2, 0), (43.28, 20.36, 0.03), 'grate', collide=False, density=0.1)
    K('oplamp', 42.9, 19.6, z=H1, r=0.0)
    light('spot', (43.2, 19.4, H1 - 1.2), (0.86, 0.96, 1.0), 80, spot=1.5, blend=0.6, radius=0.25, aim=(0.0, 0.0, -1), reach=7.5)
    prop('industrial_storage_cart', 44.8, 17.0, rot=0.0, collide=(0.8, 0.55, 0.6))
    prop('metal_tool_chest', 45.3, 22.7, rot=math.pi)
    K('iv', 44.8, 20.6, r=1.0, solid=(0.25, 0.25, 1.9))
    D('medical_box', 43.8, 19.4, z=0.89, r=0.2)
    # what came down with the floor: joists hanging in the hole, the heap under it (it can be stood on, not climbed)
    for i in range(5):
        x = FALL[0] + 0.3 + i * 0.52
        box((x, FALL[3] - R.uniform(0.3, 1.1), F2 - SLAB - R.uniform(0.1, 0.6)), (x + 0.1, FALL[3] + 0.2, F2 - 0.05), 'planks', collide=False, density=0.25)
    K('rubble_2', 39.3, 18.1, 0.001, r=0.4)
    box((38.4, 17.5, 0.0), (40.2, 18.7, 0.36), 'rubble', pen=True, tag='counter', density=0.3)
    stains((43.2, 19.4, 0.89, 0, 0, 1, 1.0), (43.4, 20.6, 0.0, 0, 0, 1, 2.0), (39.0, NY0 - 0.12, 1.3, 0, -1, 0, 1.6), (39.4, 18.2, 0.37, 0, 0, 1, 1.2))
    # ---- scrub: troughs down the wall, lockers
    for y in (17.2, 19.6):
        box((X1 - 0.75, y, 0.75), (X1 - 0.14, y + 1.7, 0.95), 'steel', pen=True, tag='counter', density=0.3)
        box((X1 - 0.5, y + 0.2, 0.0), (X1 - 0.4, y + 0.3, 0.75), 'steel', collide=False, density=0.1)
    K('lockers_3', 47.2, NY0 - 0.55, r=0.0, solid=(0.6, 0.3, 1.9))
    K('lockers_2', 48.5, NY0 - 0.55, r=0.0, solid=(0.6, 0.3, 1.9))
    L('trashbag', 50.6, 22.4, kg=7, sf='bag')

    # ---- the kitchen: ranges along the north wall, a steel island, the walk-in, a light over its door still on
    for x in (1.0, 1.75, 2.5):
        prop('electric_stove', x, Y1 - 0.55, rot=math.pi)
    table(3.0, 28.4, 6.2, 29.4)
    box((6.6, 31.0, 0.0), (8.86, 33.86, 2.5), 'steel', faces={'-y': 'steel'}, density=0.3)
    box((6.9, 30.92, 0.0), (7.9, 31.0, 2.1), 'plastic_black', collide=False, density=0.2)
    light('point', (7.5, 30.6, 2.2), COLD, 3.0, radius=0.04, reach=5.0)
    D('brass_pan_01', 4.0, 28.9, z=0.89)
    D('pot_enamel_01', 5.4, 28.8, z=0.89)
    D('wooden_cutting_board', 4.8, 29.1, z=0.89, r=0.3)
    L('pot_enamel_01', 2.2, 30.6, kg=1, sf='metal')
    prop('worn_metal_rack', 0.5, 28.6, rot=-math.pi / 2)
    stains((4.6, 28.9, 0.89, 0, 0, 1, 1.0), (4.4, 30.4, 0.0, 0, 0, 1, 1.8), (2.0, Y1 - 0.2, 1.2, 0, -1, 0, 1.3))
    # ---- the canteen: the serving counter, tables, half of them over
    counter(9.6, 31.6, 13.6, 32.3, h=0.95, top='steel', body='steel')
    for (x, y, r) in ((12.0, 28.4, 0.2), (16.6, 28.0, 1.4), (17.0, 31.6, 0.1)):
        prop('dining_table', x, y, rot=r, collide=(1.1, 0.7, 0.44))
    for (x, y, r) in ((11.0, 27.6, 0.4), (13.2, 29.2, 2.8), (15.6, 27.6, 1.1), (17.8, 29.0, -2.0), (16.0, 32.2, 0.5), (18.4, 31.4, 2.4)):
        L('dining_chair_02', x, y, r=r, kg=5)
    prop('CoffeeCart_01', 14.8, 32.9, rot=math.pi)
    D('vintage_microwave', 10.4, 31.95, z=1.0, r=math.pi)
    bulb(14.0, 29.6, H1, 4.5, WARM)
    # ---- the chapel: pews, the altar, candles someone lit tonight, the lancets with a fire burning outside them
    for row in range(4):
        for side in (-1, 1):
            if (row, side) == (1, 1):
                continue
            prop('painted_wooden_bench', 26.0 + side * 2.1, 27.6 + row * 1.05, rot=math.pi, collide=(0.6, 0.27, 0.45))
            prop('painted_wooden_bench', 26.0 + side * 3.3, 27.6 + row * 1.05, rot=math.pi + R.uniform(-0.05, 0.05), collide=(0.6, 0.27, 0.45))
    L('painted_wooden_bench', 28.6, 29.0, r=2.2, kg=18)
    counter(24.4, 32.4, 27.6, 33.1, h=0.95)
    box((25.9, Y1 - 0.2, 1.5), (26.1, Y1 - 0.16, 3.4), 'wood_top', collide=False, density=0.2)
    box((25.3, Y1 - 0.2, 2.6), (26.7, Y1 - 0.16, 2.8), 'wood_top', collide=False, density=0.2)
    for (x, p) in ((24.8, 1.7), (27.2, 1.5), (26.0, 1.3), (25.4, 1.1), (26.6, 1.2)):
        box((x - 0.03, 32.7, 1.0), (x + 0.03, 32.76, 1.0 + 0.1 + p * 0.05), 'candle', collide=False, density=0.05)
        light('point', (x, 32.73, 1.26), CANDLE, p, radius=0.02, flicker=0.12, reach=4.0)
    K('candles_3', 26.0, 30.4, 0.001, R.uniform(0, 6.28))
    light('point', (26.0, 30.4, 0.3), CANDLE, 2.0, radius=0.04, flicker=0.14, reach=4.0)
    K('bodybag_2', 26.0, 31.3, 0.001, r=math.pi / 2)
    D('wooden_lantern_01', 21.0, 33.2, r=0.4)
    L('vintage_suitcase', 30.6, 27.2, r=0.7, kg=6, sf='bag')
    stains((26.0, 30.9, 0.0, 0, 0, 1, 2.2), (26.0, 32.3, 0.5, 0, -1, 0, 1.2))
    # ---- the morgue: the cold wall, a drawer left out, two tables, the stair down to the furnace
    for i in range(4):
        x = 32.5 + i * 0.95
        for k in range(3):
            box((x, 27.0, 0.15 + k * 0.8), (x + 0.86, 27.02, 0.85 + k * 0.8), 'steel', collide=False, density=0.15)
            box((x + 0.3, 27.02, 0.45 + k * 0.8), (x + 0.56, 27.08, 0.52 + k * 0.8), 'steel', collide=False, density=0.08)
    box((32.4, NY1 + 0.08, 0), (36.3, 27.0, 2.6), 'steel', density=0.3)
    box((34.4, 27.0, 0.95), (35.26, 29.0, 1.03), 'steel', pen=True, tag='counter', density=0.3)        # a drawer left out
    box((34.44, 27.2, 1.03), (35.22, 28.9, 1.2), 'sheet', collide=False, density=0.3)
    table(38.2, 28.4, 39.1, 30.4, sheet=True)
    table(40.6, 28.4, 41.5, 30.4)
    box((39.8, 29.3, 0), (39.96, 29.46, 0.03), 'grate', collide=False, density=0.1)
    tube(39.8, 29.4, H1, 30, along='y')
    m.stairs(MST[0], MST[1], MST[2] - 0.6, MST[3], BZ, 0.0, '-x', mat='concstep')
    guard('x', MST[1] - 0.05, MST[0], MST[2], 0.0, h=1.0)
    guard('y', MST[2] + 0.05, MST[1], MST[3], 0.0, h=1.0)
    K('gurney_1', 36.6, 30.6, r=0.3, solid=(0.36, 0.98, 0.95))
    stains((40.9, 29.2, 0.89, 0, 0, 1, 0.9), (39.9, 31.0, 0.0, 0, 0, 1, 1.8), (43.0 - 0.1, 30.6, 1.0, -1, 0, 0, 1.3), (37.0, 31.6, 0.0, 0, 0, 1, 1.2))
    # ---- the plant room: switchgear humming, the generator they brought, fuel cans, the roller door down
    for y in (28.6, 29.8, 31.0):
        box((X1 - 0.8, y, 0), (X1 - 0.14, y + 1.1, 2.1), 'steel', density=0.3)
        box((X1 - 0.83, y + 0.2, 1.2), (X1 - 0.8, y + 0.5, 1.5), 'emerg' if y == 29.8 else 'plastic_black', collide=False, density=0.05)
    prop('portable_generator', 46.6, 32.4, rot=0.4)
    L('metal_jerrycan', 45.4, 33.0, r=1.2, kg=8, sf='metal')
    L('metal_jerrycan_green', 45.0, 32.2, r=0.2, kg=8, sf='metal')
    L('propane_tank', 44.0, 27.0, kg=14, sf='metal', shape='cyl')
    prop('hand_truck', 50.4, 33.0, rot=0.4)
    prop('tool_cart', 44.2, 30.6, rot=1.5)
    prop('power_box_01', 43.2, 31.6, z=1.2, rot=math.pi / 2, part='power_box_01_box', collide=False)
    bulb(47.0, 30.0, H1, 6, COLD, cage=True)

    # ---- the atrium: a planter round a dead tree, benches, the kiosk, a floor that came down from the north gallery
    for (x, y) in ((VX0, VY0), (26.0, VY0), (VX1, VY0), (VX0, VY1), (26.0, VY1), (VX1, VY1), (VX0, 16.0), (VX1, 16.0)):
        box((x - 0.25, y - 0.25, 0.0), (x + 0.25, y + 0.25, TOP), 'hbrick', tag='post', density=0.35)
        box((x - 0.3, y - 0.3, 0.0), (x + 0.3, y + 0.3, 0.35), 'stone', collide=False, density=0.15)
        box((x - 0.3, y - 0.3, F2 - SLAB - 0.2), (x + 0.3, y + 0.3, F2 - SLAB), 'stone', collide=False, density=0.15)
    cx, cy = 22.6, 15.6
    for (a, b) in (((cx - 1.7, cy - 1.7), (cx + 1.7, cy - 1.35)), ((cx - 1.7, cy + 1.35), (cx + 1.7, cy + 1.7)), ((cx - 1.7, cy - 1.35), (cx - 1.35, cy + 1.35)), ((cx + 1.35, cy - 1.35), (cx + 1.7, cy + 1.35))):
        box((a[0], a[1], 0.0), (b[0], b[1], 0.55), 'stone', pen=True, density=0.3)
    box((cx - 1.35, cy - 1.35, 0.0), (cx + 1.35, cy + 1.35, 0.4), 'ter_dirt', collide=False, density=0.3)
    prop('dead_tree_trunk', cx, cy, z=0.3, rot=0.6, scale=1.25, collide=(0.3, 0.3, 3.0))
    for (x, y) in ((cx - 0.7, cy + 0.6), (cx + 0.8, cy - 0.5), (cx + 0.3, cy + 0.9)):
        D('nettle_plant', x, y, z=0.4, r=R.uniform(0, 6))
        D('weed_plant_02', x + 0.3, y - 0.4, z=0.4, r=R.uniform(0, 6))
    prop('painted_wooden_bench', cx, cy - 2.3, rot=0.0, collide=(0.6, 0.27, 0.45))
    prop('painted_wooden_bench', cx - 2.4, cy, rot=math.pi / 2, collide=(0.6, 0.27, 0.45))
    counter(29.0, 11.8, 31.6, 12.5)                                 # the kiosk
    counter(31.0, 12.5, 31.6, 14.0)
    box((28.9, 11.7, 2.1), (31.7, 14.1, 2.2), 'shopframe', collide=False, density=0.2)
    for (x, y) in ((28.95, 11.75), (31.65, 11.75), (28.95, 14.05), (31.65, 14.05)):
        box((x - 0.04, y - 0.04, 1.1), (x + 0.04, y + 0.04, 2.1), 'shopframe', collide=False, density=0.1)
    D('CashRegister_01', 30.0, 12.15, z=1.1, r=math.pi)
    L('plastic_crate_03', 30.2, 13.2, r=0.5, kg=2, sf='plastic')
    K('gurney_1', 27.2, 18.3, r=1.9, solid=(0.36, 0.98, 0.95))
    L('wheelchair_01', 20.4, 19.6, r=2.6, kg=14, sf='metal')
    L('metal_trash_can', 33.0, 10.2, kg=6, sf='metal', shape='cyl', part='metal_trash_can')
    # the fall: the gallery's floor between two columns, down as a ramp of broken slab. It can be walked up
    RX0, RX1 = 27.4, 32.6
    NS = 20
    for i in range(NS):
        # each tread a slab of its own, wider or narrower than the last, some tipped a hand's width
        f0, f1 = i / NS, (i + 1) / NS
        j0, j1 = R.uniform(-0.55, 0.3), R.uniform(-0.3, 0.55)
        box((RX0 + j0, 15.6 + (VY1 - 15.6) * f0, 0.0), (RX1 + j1, 15.6 + (VY1 - 15.6) * f1, F2 * f1), 'rubble', tag='step', density=0.5)
        if R.random() < 0.5:
            x = R.uniform(RX0 + 0.3, RX1 - 0.9)
            w = R.uniform(0.3, 0.7)
            box((x, 15.6 + (VY1 - 15.6) * f0 + 0.02, F2 * f1), (x + w, 15.6 + (VY1 - 15.6) * f1 - 0.02, F2 * f1 + R.uniform(0.03, 0.07)), 'slab', collide=False, density=0.3)
    for i in range(14):
        x = R.choice((RX0 - R.uniform(0.1, 0.9), RX1 + R.uniform(0.1, 0.9)))
        y = R.uniform(15.6, VY1 - 0.4)
        h = (y - 15.6) / (VY1 - 15.6) * F2 * R.uniform(0.2, 0.75)
        w = R.uniform(0.3, 0.8)
        box((x - w / 2, y - w / 2, 0.0), (x + w / 2, y + w / 2, max(0.15, h)), 'rubble', tag='counter', pen=True, density=0.25)
    for (x, y, r) in ((26.6, 15.4, 0.3), (33.4, 15.0, 2.0), (30.0, 14.9, 1.1), (26.8, 19.6, 4.0), (33.6, 19.0, 5.2)):
        K(f'rubble_{int(x * 3 + y) % 3 + 1}', x, y, 0.001, r=r)
    for i in range(6):
        x = RX0 + 0.4 + i * 0.9
        box((x, VY1 - 0.3, F2 - SLAB - R.uniform(0.2, 0.9)), (x + 0.1, VY1 + 0.1, F2 - 0.02), 'ruststeel', collide=False, density=0.15)
    # a site light in the south-west corner, across the floor: every column throws a bar of shadow
    site_light(16.6, 10.2, 0.0, (1.0, 0.62), p=130.0)
    # and the chain lamp from the trusses, low over the tree
    box((25.19, 16.19, 4.74), (25.21, 16.21, LANT - 0.5), 'steel', collide=False, density=0.05)
    prop('caged_hanging_light', 25.2, 16.2, z=4.6, collide=False)
    light('point', (25.2, 16.2, 4.33), COLD, 6, radius=0.08, reach=9.0)
    exit_sign('x', SY1, 26.0, 2.62, 1, t=0.2)
    exit_sign('x', NY0, 26.0, 2.62, -1, t=0.2)
    stains((24.6, 12.2, 0.0, 0, 0, 1, 1.6), (27.3, 18.0, 0.9, 0, 0, 1, 0.8), (29.6, 17.0, 0.0, 0, 0, 1, 1.4), (20.2, 21.0 - 0.3, 1.1, 0, -1, 0, 1.1))

    # ---- the corridors: trolleys, chairs, the signs, ducts under the ceiling, what's left of the lights
    K('gurney_2', 11.6, 8.12, r=math.pi / 2 + 0.06, solid=(0.36, 0.98, 0.95))
    L('wheelchair_01', 38.4, 6.8, r=0.8, kg=14, sf='metal')
    L('WetFloorSign_01', 22.0, 7.0, r=1.0, kg=1.2, sf='plastic')
    K('gurney_3', 44.6, 23.92, r=math.pi / 2 - 0.05, solid=(0.36, 0.98, 0.95))
    L('wheelchair_01', 8.0, 25.2, r=-2.5, kg=14, sf='metal')
    L('korean_fire_extinguisher_01', 14.6, 25.7, kg=6, sf='metal', shape='cyl')
    L('korean_fire_extinguisher_01', 34.6, 6.3, kg=6, sf='metal', shape='cyl')
    D('fire_alarm', 12.0, SY0 + 0.1, z=1.4, r=0.0)
    D('wall_clock', 30.0, NY1 - 0.1, z=2.6, r=math.pi)
    for (x0, x1, y) in ((0.6, 14.4, SY0 + 0.45), (37.6, 51.4, SY0 + 0.45), (0.6, 19.4, NY1 - 0.5), (32.6, 51.4, NY1 - 0.5)):
        # a duct along the ceiling, in lengths, one length down at one end
        n = int((x1 - x0) / 2.4)
        for i in range(n):
            a = x0 + i * (x1 - x0) / n
            drop = 0.0
            if i == n // 2:
                continue
            box((a + 0.03, y - 0.22, H1 - 0.42 - drop), (a + (x1 - x0) / n - 0.03, y + 0.22, H1 - 0.1), 'tin_in', collide=False, density=0.2)
            box((a + 0.02, y - 0.24, H1 - 0.44), (a + 0.07, y + 0.24, H1 - 0.08), 'steel', collide=False, density=0.1)
    for x in (9.0, 43.0):
        K('sign', x, (SY0 + SY1) / 2, z=H1, r=math.pi / 2)
    for x in (11.0, 41.0):
        K('sign', x, (NY0 + NY1) / 2, z=H1, r=-math.pi / 2)
    for x, p, f, lit in ((5.0, 0, 0, False), (12.0, 24, 0, True), (21.0, 0, 0, False), (31.0, 0, 0, False), (40.5, 22, 0, True), (48.0, 0, 0, False)):
        tube(x, (SY0 + SY1) / 2 + 0.3, H1, p, flick=f, lit=lit)
    for x, p, f, lit in ((5.0, 0, 0, False), (16.0, 20, 0, True), (26.0, 0, 0, False), (36.0, 0, 0, False), (46.0, 0, 0, False)):
        tube(x, (NY0 + NY1) / 2 - 0.3, H1, p, flick=f, lit=lit)
    emerg(26.0, NY1 - 0.14, 2.9, 4.5)
    emerg(X0 + 0.16, 7.3, 2.6, 3.5)
    emerg(X1 - 0.16, 24.7, 2.6, 3.5)
    exit_sign('y', X0, 7.3, 2.3, 1, t=EXT_T)
    exit_sign('y', X1, 24.7, 2.3, -1, t=EXT_T)
    stains((14.0, 7.2, 0.0, 0, 0, 1, 1.4), (15.2, SY1 - 0.08, 0.9, 0, -1, 0, 1.6), (33.0, 24.6, 0.0, 0, 0, 1, 1.2), (44.0, NY1 - 0.08, 1.0, 0, -1, 0, 1.1), (7.0, NY0 + 0.08, 1.3, 0, 1, 0, 1.2))
    for i in range(6):
        stains((40.0 + i * 0.7, 24.5 + i * 0.05, 0.0, 0, 0, 1, 0.7))

    # ================= upstairs =================
    Z = F2
    # the south corridor's walls: closed either side of the atrium, the gallery open between
    part('x', SY0, X0, AX0, Z, H2, holes=[way('x', SY0, 3.0, Z, w=5.2, h=2.45), door('x', SY0, 9.0, Z, swing=-1), way('x', SY0, 13.0, Z)])
    part('x', SY0, AX0, AX1, Z, H2, holes=[way('x', SY0, 19.0, Z), breach('x', SY0, 29.4, Z, w=1.8), door('x', SY0, 33.0, Z, swing=-1)])
    part('x', SY0, AX1, X1, Z, H2, holes=[way('x', SY0, 41.0, Z), way('x', SY0, X1 - 3.0, Z, w=5.2, h=2.45)])
    part('x', SY1, X0, AX0, Z, H2, holes=[way('x', SY1, 4.0, Z, w=1.8), door('x', SY1, 11.5, Z, w=1.5)])
    part('x', SY1, AX1, X1, Z, H2, holes=[door('x', SY1, 40.5, Z), way('x', SY1, 47.5, Z)])
    part('x', NY0, X0, AX0, Z, H2, holes=[way('x', NY0, 4.0, Z, w=1.8), way('x', NY0, 11.5, Z)])
    part('x', NY0, AX1, X1, Z, H2, holes=[way('x', NY0, 40.5, Z), door('x', NY0, 48.5, Z, kind='steel')])
    part('x', NY1, X0, 20.0, Z, H2, holes=[door('x', NY1, 5.0, Z, swing=-1), way('x', NY1, 14.5, Z)])
    part('x', NY1, 32.0, X1, Z, H2, holes=[way('x', NY1, 37.5, Z), door('x', NY1, 47.5, Z, swing=-1)])
    # the two blocks onto the gallery's aisles
    part('y', AX0, SY1, NY0, Z, H2, holes=[way('y', AX0, 12.4, Z, w=2.4, h=2.5), way('y', AX0, 19.6, Z, w=2.4, h=2.5)], t=0.2, mat='hbrick')
    part('y', AX1, SY1, NY0, Z, H2, holes=[way('y', AX1, 12.4, Z), door('y', AX1, 19.6, Z, kind='steel', swing=-1)], t=0.2, mat='hbrick')
    # the east block: children south, two isolation rooms north
    part('x', MY, AX1, X1, Z, H2, holes=[way('x', MY, 49.5, Z)])
    part('y', EXM, MY, NY0, Z, H2, holes=[breach('y', EXM, 21.6, Z, w=1.5)])
    # rooms over the street
    part('y', 6.0, Y0, SY0, Z, H2)
    part('y', 16.0, Y0, SY0, Z, H2, holes=[way('y', 16.0, 3.0, Z)])
    part('y', 26.0, Y0, SY0, Z, H2)
    part('y', 36.0, Y0, SY0, Z, H2, holes=[breach('y', 36.0, 2.8, Z)])
    part('y', 46.0, Y0, SY0, Z, H2)
    # rooms over the kitchens
    part('y', 10.0, NY1, Y1, Z, H2, holes=[way('y', 10.0, 31.0, Z)])
    part('y', 43.0, NY1, Y1, Z, H2, holes=[way('y', 43.0, 30.0, Z)])

    room('scor2', X0, SY0, AX0, SY1, Z, H2, 'hosp_wall', 'hlino')
    room('scor2e', AX1, SY0, X1, SY1, Z, H2, 'hosp_wall', 'hlino')
    room('ncor2', X0, NY0, AX0, NY1, Z, H2, 'hosp_wall', 'hlino')
    room('ncor2e', AX1, NY0, X1, NY1, Z, H2, 'hosp_wall', 'hlino')
    room('gcor_s', AX0, SY0, AX1, VY0, Z, H2, 'hosp_wall3', 'mtile', ceil='ceil')
    room('gcor_n', AX0, VY1, AX1, NY1, Z, H2, 'hosp_wall3', 'mtile', ceil='ceil')
    room('gcor_w', AX0, VY0, VX0, VY1, Z, H2, 'hosp_wall3', 'mtile', ceil='ceil')
    room('gcor_e', VX1, VY0, AX1, VY1, Z, H2, 'hosp_wall3', 'mtile', ceil='ceil')
    room('side_a', 6, Y0, 16, SY0, Z, H2, 'hosp_wall2', 'hlino')
    room('office', 16, Y0, 26, SY0, Z, H2, 'wall_paper', 'carpet')
    room('records', 26, Y0, 36, SY0, Z, H2, 'hosp_wall3', 'hlino')
    room('side_b', 36, Y0, 46, SY0, Z, H2, 'hosp_wall2', 'hlino')
    room('longward', X0, SY1, AX0, NY0, Z, H2, 'hosp_wall', 'hlino')
    room('children', AX1, SY1, X1, MY, Z, H2, 'kidwall', 'hlino', dado=('kiddado', 1.2))
    room('iso_a', AX1, MY, EXM, NY0, Z, H2, 'wtile', 'mtile')
    room('iso_b', EXM, MY, X1, NY0, Z, H2, 'wtile', 'mtile')
    room('dayroom', X0, NY1, 10, Y1, Z, H2, 'wall_paper', 'carpet')
    room('dorm', 10, NY1, 20, Y1, Z, H2, 'hosp_wall2', 'hlino')
    room('ward_n', 32, NY1, 43, Y1, Z, H2, 'hosp_wall2', 'hlino')
    room('records_n', 43, NY1, X1, Y1, Z, H2, 'dconc', 'conc')

    # the gallery's rail round the void: gone where the floor went, and bent out at one corner
    guard('x', VY0 - 0.06, VX0 + 0.25, VX1 - 0.25, Z)
    guard('y', VX0 - 0.06, VY0 + 0.25, VY1 - 0.25, Z)
    guard('y', VX1 + 0.06, VY0 + 0.25, VY1 - 0.25, Z)
    guard('x', VY1 + 0.06, VX0 + 0.25, RX0 - 0.1, Z)
    guard('x', VY1 + 0.06, RX1 + 0.1, VX1 - 0.25, Z)
    # the hole over the theatre: a plank across one side of it, tape that was
    m.rail('x', FALL[3] + 0.3, FALL[0] - 0.2, FALL[2] + 0.2, Z, h=0.9, mat='planks')

    # ---- the long ward: two rows of beds the length of it, curtains, one bulb at the far end
    for i in range(5):
        for (x, r) in ((1.25, -math.pi / 2), (13.75, math.pi / 2)):
            y = 10.2 + i * 2.9
            if (i, x) in ((1, 13.75), (3, 1.25)) or abs(y - 12.4) < 1.3 and x > 10 or abs(y - 19.6) < 1.3 and x > 10:
                continue
            K(f'hbed_{(i * 2 + int(x) + 40) % 8 + 1}', x, y, z=Z, r=r + R.uniform(-0.12, 0.12), solid=(0.48, 1.04, 0.7))
            if R.random() < 0.55:
                K('iv', x + (0.3 if x < 5 else -0.3), y - 0.9, z=Z, r=R.uniform(0, 6), solid=(0.25, 0.25, 1.9))
            if R.random() < 0.7:
                K(f'curtain_{(i * 3 + int(x)) % 6 + 1}', x + (1.6 if x < 5 else -1.6), y, z=TOP, r=math.pi / 2)
    K('gurney_2', 7.4, 14.0, z=Z, r=0.5, solid=(0.36, 0.98, 0.95))
    L('wheelchair_01', 6.2, 20.4, z=Z, r=0.6, kg=14, sf='metal')
    K('screen', 9.0, 17.4, z=Z, r=0.4, solid=(0.95, 0.3, 1.7))
    for y in (11.0, 16.0, 21.0):
        tube(7.5, y, TOP, 0, along='y', lit=False)
    bulb(7.5, 21.6, TOP, 4.5, WARM)
    stains((6.6, 15.8, Z, 0, 0, 1, 1.9), (1.2, 16.0, Z + 0.62, 0, 0, 1, 0.8), (X0 + 0.12, 18.4, Z + 1.2, 1, 0, 0, 1.4), (9.6, 12.2, Z, 0, 0, 1, 1.2))
    for i in range(8):
        stains((6.9 + i * 0.5, 16.2 + i * 0.42, Z, 0, 0, 1, 0.7))
    # ---- the children's ward: small beds, desks, a board with sums on it, a night light
    for i in range(4):
        prop('old_bed_frame', 38.6 + i * 3.4, 14.8, z=Z, rot=R.uniform(-0.15, 0.15), collide=(0.5, 1.05, 0.3))
    for (x, y, r) in ((40.0, 10.2, 0.2), (41.6, 10.6, -0.3), (43.4, 10.0, 0.1)):
        prop('SchoolDesk_01', x, y, z=Z, rot=r, collide=(0.35, 0.3, 0.7))
    L('SchoolChair_01', 40.2, 11.2, z=Z, r=0.4, kg=6)
    L('SchoolChair_01', 44.6, 11.6, z=Z, r=2.1, kg=6)
    D('standing_chalkboard_01', 47.6, 9.6, z=Z, r=0.5)
    prop('Rockingchair_01', 50.2, 13.2, z=Z, rot=-2.2)
    D('Lantern_01', 49.6, 12.6, z=Z, r=0.2)
    light('point', (49.6, 12.6, Z + 0.3), WARM, 1.8, radius=0.04, flicker=0.12, reach=4.0)
    stains((45.4, 14.6, Z + 0.4, 0, 0, 1, 0.8), (48.0, 11.4, Z, 0, 0, 1, 1.3))
    # ---- isolation: a bed bolted down in each, the hole in the first one's floor, a light that works
    prop('old_bed_frame', 38.0, 22.0, z=Z, rot=math.pi / 2, collide=(1.05, 0.5, 0.3))
    prop('old_bed_frame', 50.6, 18.0, z=Z, rot=0.0, collide=(0.5, 1.05, 0.3))
    L('metal_stool_02', 47.0, 21.6, z=Z, r=0.3, kg=4, sf='metal')
    bulb(48.2, 19.6, TOP, 3.2, RED, cage=True)
    stains((48.4, 19.8, Z, 0, 0, 1, 1.7), (X1 - 0.12, 20.4, Z + 1.0, -1, 0, 0, 1.5), (44.0, NY0 - 0.1, Z + 1.4, 0, -1, 0, 1.0), (39.4, 19.4, Z, 0, 0, 1, 1.0))
    # ---- over the street: side wards, the office, records in their racks
    for (x, r) in ((8.4, 0.1), (12.6, -0.2), (38.4, 0.0), (42.8, 0.25)):
        K(f'hbed_{(int(x * 3)) % 8 + 1}', x, 1.25, z=Z, r=math.pi + r, solid=(0.48, 1.04, 0.7))
        D('ClassicNightstand_01', x + 0.9, 0.42, z=Z, r=R.uniform(-0.3, 0.3))
        K(f'curtain_{(int(x * 5)) % 6 + 1}', x, 2.8, z=TOP)
    prop('metal_office_desk', 20.0, 2.4, z=Z, rot=0.1, part='metal_office_desk')
    L('SchoolChair_01', 20.2, 1.4, z=Z, r=0.4, kg=6)
    prop('wooden_bookshelf_worn', 16.5, 4.6, z=Z, rot=-math.pi / 2)
    prop('Sofa_01', 23.6, 0.7, z=Z, rot=0.0)
    D('desk_lamp_arm_01', 20.6, 2.5, z=Z + 0.79, r=2.2)
    light('point', (20.5, 2.4, Z + 1.2), WARM, 2.4, radius=0.03, reach=4.5)
    for y in (1.2, 3.0, 4.8):
        for x in (28.4, 31.0, 33.6):
            if (x, y) == (31.0, 3.0):
                continue
            prop('steel_frame_shelves_02', x, y, z=Z, rot=math.pi / 2)
    for i in range(6):
        L('cardboard_box_01', 30.6 + R.uniform(-0.6, 0.6), 3.0 + R.uniform(-0.6, 0.6), z=Z, r=R.uniform(0, 3), kg=4, sf='card')
    # ---- over the kitchens: the lounge, the dormitory, the north ward, the archive
    prop('Sofa_01', 3.0, 33.3, z=Z, rot=math.pi)
    prop('ArmChair_01', 1.0, 29.4, z=Z, rot=-math.pi / 2)
    prop('CoffeeTable_01', 3.2, 31.6, z=Z, rot=0.1)
    prop('wooden_bookshelf_worn', 9.5, 28.0, z=Z, rot=math.pi / 2)
    for (x, r) in ((11.6, 0.0), (14.4, 0.1), (17.4, -0.1)):
        prop('old_bed_frame', x, 32.6, z=Z, rot=math.pi + r, collide=(0.5, 1.05, 0.3))
    K('lockers_1', 19.38, 28.4, z=Z, r=-math.pi / 2, solid=(0.6, 0.3, 1.9))
    for i in range(3):
        K(f'hbed_{(i + 71) % 8 + 1}', 34.0 + i * 3.2, 32.7, z=Z, r=R.uniform(-0.1, 0.1), solid=(0.48, 1.04, 0.7))
        K(f'curtain_{(i + 60) % 6 + 1}', 34.0 + i * 3.2, 31.2, z=TOP)
    for x in (44.0, 46.0, 48.0, 50.0):
        prop('worn_metal_rack', x, Y1 - 0.45, z=Z, rot=math.pi)
    L('cardboard_box_01', 45.0, 28.0, z=Z, r=0.6, kg=4, sf='card')
    L('cardboard_box_01', 45.4, 28.5, z=Z, r=1.4, kg=4, sf='card')
    bulb(47.5, 29.6, TOP, 3.5, WARM)
    # ---- the gallery: a second site light looking down the north side, benches, a trolley at the rail
    site_light(35.6, 24.6, Z, (-1.0, -0.12), p=100.0)
    prop('painted_wooden_bench', 22.0, 6.6, z=Z, rot=0.0, collide=(0.6, 0.27, 0.45))
    prop('painted_wooden_bench', 16.0, 16.0, z=Z, rot=-math.pi / 2, collide=(0.6, 0.27, 0.45))
    K('gurney_2', 30.4, 9.4, z=Z, r=math.pi / 2 + 0.3, solid=(0.36, 0.98, 0.95))
    L('wheelchair_01', 35.6, 13.0, z=Z, r=2.0, kg=14, sf='metal')
    L('plastic_monobloc_chair_01', 19.6, 22.6, z=Z, r=2.1, kg=2.5, sf='plastic')
    for x, lit in ((4.0, False), (11.0, False), (41.0, False), (48.0, False)):
        tube(x, (SY0 + SY1) / 2, TOP, 0, lit=lit)
    tube(8.0, (NY0 + NY1) / 2, TOP, 18)
    tube(45.0, (NY0 + NY1) / 2, TOP, 0, lit=False)
    emerg(X0 + 0.16, 24.7, Z + 2.7, 3.0)
    emerg(X1 - 0.16, 7.3, Z + 2.7, 3.0)
    stains((23.0, 7.4, Z, 0, 0, 1, 1.3), (16.6, 14.0, Z, 0, 0, 1, 1.2), (33.0, 22.4, Z, 0, 0, 1, 1.5), (AX1 - 0.12, 16.6, Z + 1.1, -1, 0, 0, 1.2))

    # ================= under: the tunnel from stair to stair, what opens off it, the branch to the furnace =================
    TZ = -0.3
    # the tunnel itself, below the south corridor
    under((X0 - 0.2, SY0, BZ - 0.3), (X1 + 0.2, SY1, BZ), 'conc')
    under((X0 - 0.2, SY0, BZ), (3.25, SY1, TZ))                     # earth at each end, north of the way up
    under((X1 - 3.25, SY0, BZ), (X1 + 0.2, SY1, TZ))
    under((3.25, SY0, BC - 0.02), (X1 - 3.25, SY1, BC), 'wall_conc', collide=False)

    def uwall(axis, c, p0, p1, holes, t=0.2, mat='dconc'):
        """an underground wall along an axis, with openings (a, b, height)"""
        cur = p0
        for (a, b, h) in sorted(holes):
            seg = ((cur, c - t / 2, BZ), (a, c + t / 2, TZ)) if axis == 'x' else ((c - t / 2, cur, BZ), (c + t / 2, a, TZ))
            if a - cur > 1e-3:
                under(*seg, mat)
            lin = ((a, c - t / 2, BZ + h), (b, c + t / 2, TZ)) if axis == 'x' else ((c - t / 2, a, BZ + h), (c + t / 2, b, TZ))
            under(*lin, mat)
            m.openings.append(((a + b) / 2, c, BZ, b - a, axis) if axis == 'x' else (c, (a + b) / 2, BZ, b - a, axis))
            cur = b
        seg = ((cur, c - t / 2, BZ), (p1, c + t / 2, TZ)) if axis == 'x' else ((c - t / 2, cur, BZ), (c + t / 2, p1, TZ))
        if p1 - cur > 1e-3:
            under(*seg, mat)

    # its south wall: only the two stairs open through it
    uwall('x', SY0, X0, X1, [(4.6, 6.0, 2.4), (X1 - 6.0, X1 - 4.6, 2.4)])
    # its north wall: the boiler, the cold store, the branch, the flooded store
    BRX0, BRX1 = 34.4, 37.0
    uwall('x', SY1, X0, X1, [(9.0, 10.6, 2.2), (24.0, 26.0, 2.2), (BRX0 + 0.2, BRX1 - 0.2, 2.3), (41.0, 43.0, 2.2)])
    # rooms north of the tunnel
    BN = 15.0
    for (x0, x1, name, wm, fm) in ((6.0, 15.0, 'boiler', 'dconc', 'conc'), (20.0, 30.0, 'cold', 'wtile', 'mtile'), (38.6, 47.0, 'flood', 'wall_conc', 'conc')):
        under((x0 - 0.2, SY1, BZ - 0.3), (x1 + 0.2, BN + 0.2, BZ), 'conc')
        under((x0 - 0.2, SY1 + 0.1, BZ), (x0, BN + 0.2, TZ), wm)
        under((x1, SY1 + 0.1, BZ), (x1 + 0.2, BN + 0.2, TZ), wm)
        under((x0, BN, BZ), (x1, BN + 0.2, TZ), wm)
        room(name, x0, SY1, x1, BN, BZ, TZ - BZ, wm, fm, ceil='wall_conc')
    box((20.0, SY1 + 0.1, BZ), (30.0, BN, BZ + 0.012), 'mtile', tag='under', collide=False, density=0.5)
    box((38.6, SY1 + 0.1, BZ), (47.0, BN, BZ + 0.03), 'conc_wet', tag='under', collide=False, density=0.5)
    # the branch north under the east aisle, and the furnace room under the morgue
    FX0, FX1, FY1 = 32.0, 43.0, Y1
    under((BRX0 - 0.2, SY1, BZ - 0.3), (BRX1 + 0.2, NY1, BZ), 'conc')
    under((BRX0 - 0.2, SY1 + 0.1, BZ), (BRX0, NY1, TZ))
    under((BRX1, SY1 + 0.1, BZ), (BRX1 + 0.2, NY1, TZ))
    under((BRX0, SY1 + 0.1, BC - 0.02), (BRX1, NY1, BC), 'wall_conc', collide=False)
    under((FX0 - 0.2, NY1, BZ - 0.3), (FX1 + 0.2, FY1 + 0.2, BZ), 'conc')
    under((FX0 - 0.2, NY1, BZ), (FX0, FY1 + 0.2, TZ), 'hbrick_c')
    under((FX1, NY1, BZ), (FX1 + 0.2, FY1 + 0.2, TZ), 'hbrick_c')
    under((FX0, FY1, BZ), (FX1, FY1 + 0.2, TZ), 'hbrick_c')
    uwall('x', NY1, FX0 - 0.2, FX1 + 0.2, [(BRX0 + 0.2, BRX1 - 0.2, 2.3)], mat='hbrick_c')
    # ceilings: the bake doesn't draw the underside of a slab at ground level, so every room down here gets its own
    for (x0, y0, x1, y1) in ((6.0, SY1, 15.0, BN), (20.0, SY1, 30.0, BN), (38.6, SY1, 47.0, BN), (3.25, SY0 - 0.6, 6.0, SY0), (X1 - 6.0, SY0 - 0.6, X1 - 3.25, SY0)):
        under((x0, y0, TZ - 0.02), (x1, y1, TZ), 'wall_conc', collide=False)
    for r_ in rects_minus(FX0, NY1, FX1, FY1, [MST]):
        under((r_[0], r_[1], TZ - 0.02), (r_[2], r_[3], TZ), 'wall_conc', collide=False)
    room('tunnel', 3.25, SY0, X1 - 3.25, SY1, BZ, TZ - BZ, 'dconc', 'conc', ceil='wall_conc')
    room('branch', BRX0, SY1, BRX1, NY1, BZ, TZ - BZ, 'dconc', 'conc', ceil='wall_conc')
    room('furnace', FX0, NY1, FX1, FY1, BZ, TZ - BZ, 'hbrick_c', 'conc', ceil='wall_conc')
    # pipes along the tunnel and the branch, red lamps, one caged white one on its way out
    m.hpipe(4.0, X1 - 4.0, SY1 - 0.35, BC - 0.35)
    m.hpipe(4.0, X1 - 4.0, SY1 - 0.75, BC - 0.3)
    m.hpipe(4.0, X1 - 4.0, SY0 + 0.4, BC - 0.25)
    m.hpipe(SY1 + 0.6, NY1 - 0.4, BRX1 - 0.4, BC - 0.3, run='y')
    for x in (12.0, 26.0, 40.0):
        emerg(x, SY1 - 0.14, BZ + 2.45, 3.2)
    emerg(BRX0 + 0.14, 16.0, BZ + 2.4, 3.0)
    bulb(18.6, (SY0 + SY1) / 2, BC, 5, WARM, cage=True)
    bulb(BRX0 + 1.3, 21.0, BC, 4, COLD, cage=True)
    K('gurney_1', 30.4, 8.1, z=BZ, r=math.pi / 2 + 0.05, solid=(0.36, 0.98, 0.95))
    L('wheelchair_01', 35.6, 12.0, z=BZ, r=1.0, kg=14, sf='metal')
    # the boiler room: the plant itself, the pilot still lit
    box((7.0, 11.6, BZ), (10.6, 14.2, BZ + 2.4), 'ruststeel', tag='under', density=0.3)
    box((6.8, 11.4, BZ + 2.4), (10.8, 14.4, BZ + 2.6), 'steel', tag='under', collide=False, density=0.2)
    box((8.5, 12.6, BZ + 2.6), (9.1, 13.2, TZ), 'ruststeel', tag='under', collide=False, density=0.2)
    prop('old_military_compressor', 13.4, 13.8, z=BZ, rot=0.0)
    L('propane_tank', 14.2, 9.6, z=BZ, kg=14, sf='metal', shape='cyl')
    L('metal_jerrycan', 6.8, 9.6, z=BZ, r=1.2, kg=8, sf='metal')
    light('point', (8.8, 11.2, BZ + 0.6), EMBER, 6.5, radius=0.1, flicker=0.25, reach=6.0)
    # the cold store: drawers down one wall, a table with a sheet, a tube that can't decide
    for x in (20.4, 22.4, 26.6, 28.4):
        under((x, BN - 0.9, BZ), (x + 1.5, BN - 0.02, BZ + 2.4), 'steel', density=0.3)
        for k in range(3):
            box((x + 0.1, BN - 0.92, BZ + 0.2 + k * 0.75), (x + 1.4, BN - 0.9, BZ + 0.85 + k * 0.75), 'steel', tag='under', collide=False, density=0.12)
    table(24.4, 10.6, 25.3, 12.6, z=BZ, sheet=True)
    tube(25.0, 11.6, TZ, 24, along='y')
    stains((25.4, 12.0, BZ, 0, 0, 1, 2.2), (20.12, 11.0, BZ + 1.0, 1, 0, 0, 1.3), (24.9, 11.2, BZ + 1.1, 0, 0, 1, 0.6))
    # the flooded store: crates standing in black water, one lamp over it
    for (x, y, r) in ((40.0, 13.6, 0.2), (42.4, 14.0, 0.0), (45.4, 13.4, 0.4), (45.8, 10.2, 1.2)):
        prop('wooden_crate_02', x, y, z=BZ, rot=r)
    prop('wooden_crate_01', 39.6, 10.6, z=BZ, rot=0.5)
    L('plastic_crate_01', 43.6, 11.6, z=BZ, r=1.0, kg=1.5, sf='plastic')
    bulb(43.0, 12.0, TZ, 3.2, (0.4, 0.55, 0.8), cage=True)
    # the furnace: the oven's mouth open and still red, the ash, the chute, the stair up
    box((33.0, FY1 - 2.2, BZ), (36.4, FY1 - 0.02, BZ + 2.5), 'hbrick_c', tag='under', density=0.3)
    box((34.2, FY1 - 2.26, BZ + 0.7), (35.2, FY1 - 2.2, BZ + 1.5), 'tar', tag='under', collide=False, density=0.2)
    box((34.3, FY1 - 2.24, BZ + 0.72), (35.1, FY1 - 2.21, BZ + 0.9), 'candle', collide=False, density=0.1)
    light('point', (34.7, FY1 - 2.7, BZ + 1.0), EMBER, 10, radius=0.2, flicker=0.2, reach=8.0)
    box((34.5, FY1 - 1.4, BZ + 2.5), (34.9, FY1 - 1.0, TZ), 'ruststeel', tag='under', collide=False, density=0.15)
    K('bodybag_5', 37.6, 29.0, BZ + 0.001, r=0.4)
    K('bodybag_7', 38.4, 28.0, BZ + 0.001, r=1.9)
    K('gurney_1', 40.4, 28.4, z=BZ, r=0.2, solid=(0.36, 0.98, 0.95))
    prop('wooden_barrels_01', 41.6, 27.2, z=BZ, rot=R.uniform(0, 6))
    L('metal_jerrycan', 33.2, 27.0, z=BZ, r=0.6, kg=8, sf='metal')
    stains((35.0, 30.6, BZ, 0, 0, 1, 2.2), (37.8, 28.6, BZ, 0, 0, 1, 1.6), (FX0 + 0.1, 29.0, BZ + 1.1, 1, 0, 0, 1.3))
    m.zones.append(dict(a=(X0, Y0, BZ - 0.3), b=(X1, Y1, -0.3), kind='small'))

    # ================= the grounds: what the windows look out on =================
    prop('covered_car', 12.0, -9.0, rot=0.1, part=None)
    prop('covered_car', 42.0, -9.4, rot=-0.05, part=None)
    prop('covered_car', -8.0, -6.0, rot=1.4, part=None)
    prop('covered_car', 60.0, -4.0, rot=1.65, part=None)
    # the ambulance backed up to the doors, its lamps still on: they come in through the entrance glass
    AXc, AYc = 26.0, -7.0
    box((AXc - 1.1, AYc - 3.4, 0.35), (AXc + 1.1, AYc + 0.3, 2.75), 'ambulance', density=0.3)
    box((AXc - 1.0, AYc + 0.3, 0.35), (AXc + 1.0, AYc + 2.1, 1.85), 'ambulance', density=0.3)
    box((AXc - 0.95, AYc + 1.1, 1.2), (AXc + 0.95, AYc + 2.05, 1.82), 'darkwin', collide=False, density=0.15)
    box((AXc - 1.12, AYc - 2.3, 1.4), (AXc + 1.12, AYc - 1.7, 1.75), 'paint_r', collide=False, density=0.15)
    for (x, y) in ((AXc - 1.0, AYc - 2.5), (AXc + 1.0, AYc - 2.5), (AXc - 1.0, AYc + 1.3), (AXc + 1.0, AYc + 1.3)):
        box((x - 0.14, y - 0.4, 0), (x + 0.14, y + 0.4, 0.75), 'plastic_black', collide=False, density=0.15)
    for sx in (-0.7, 0.7):
        light('spot', (AXc + sx, AYc + 2.2, 0.95), (0.9, 0.95, 1.0), 230, spot=1.15, blend=0.5, radius=0.07, aim=(sx * 0.95, 1.0, 0.09), reach=12.0)
    for (x, y, r) in ((6.0, -3.0, 0.0), (9.0, -2.6, 0.1), (44.0, -3.0, -0.1), (47.0, -3.2, 0.0)):
        prop('concrete_road_barrier', x, y, rot=r)
    # the car park's lamp, and the one that's out
    prop('street_lamp_01', 6.0, -5.0, rot=0.0)
    light('spot', (6.0, -4.5, 6.1), SODIUM, 520, spot=2.3, blend=0.85, radius=0.15, aim=(0.3, 0.3, -1), reach=14.0)
    prop('street_lamp_01', 48.0, -5.0, rot=0.0)
    # a drum fire in the north yard, outside the chapel's glass
    prop('barrel_03', 26.6, 38.4, rot=0.3)
    light('point', (26.6, 38.4, 1.25), (1.0, 0.42, 0.12), 60, radius=0.25, flicker=0.2, reach=12.0)
    for (x, y, r) in ((27.8, 38.9, 1.2), (25.6, 39.4, 2.5)):
        L('plastic_monobloc_chair_01', x, y, r=r, kg=2.5, sf='plastic')
    # security lights: one over the west door still working, cold, through the long ward's windows
    prop('security_light', X0 - 0.2, 16.0, z=6.6, rot=math.pi / 2, part='security_light', collide=False)
    light('spot', (X0 - 3.6, 16.0, 6.4), COLD, 220, spot=2.1, blend=0.8, radius=0.1, aim=(0.75, 0.0, -0.5), reach=12.0)
    light('spot', (X1 + 3.0, 12.0, 5.6), (1.0, 0.72, 0.4), 140, spot=2.2, blend=0.8, radius=0.1, aim=(-0.8, 0.05, -0.45), reach=11.0)
    for (x, y) in ((-7.0, 20.0), (60.0, 26.0)):
        box((x - 1.0, y - 2.0, 0), (x + 1.0, y + 2.0, 1.5), 'dumpster', density=0.3)
    m.container(58.0, 4.0, 0.0, rot90=True, tint='cont_b')
    m.container(-14.0, 30.0, 0.0, rot90=True, tint='cont_a')
    prop('dead_tree_trunk', 14.0, 40.0, rot=1.0, scale=1.6, collide=False)
    prop('dead_tree_trunk', 40.0, 42.0, rot=2.2, scale=1.9, collide=False)
    prop('dead_tree_trunk', -9.0, 8.0, rot=0.3, scale=1.7, collide=False)

    # ---- what fell and what was dropped
    for (x, y, z) in ((8.5, 7.4, H1), (24.0, 7.0, H1), (46.5, 7.6, H1), (12.0, 24.9, H1), (30.0, 24.4, H1), (47.0, 24.8, H1), (16.4, 13.0, H1), (35.8, 20.0, H1), (12.0, 3.0, H1), (40.0, 2.0, H1),
                      (4.0, 12.0, H1), (10.0, 30.0, H1), (6.0, 7.2, TOP), (44.0, 7.4, TOP), (12.0, 24.6, TOP), (40.0, 24.8, TOP), (5.0, 14.0, TOP), (10.0, 19.0, TOP), (30.0, 3.0, TOP), (40.0, 30.0, TOP)):
        K(f'tile_{int(x * 7 + y + z) % 6 + 1}', x, y, z=z, r=R.uniform(0, 6.28))
    for (x, y, z) in ((10.0, 7.2, 0.0), (30.0, 7.4, 0.0), (45.0, 7.0, 0.0), (20.0, 24.8, 0.0), (38.0, 24.6, 0.0), (26.0, 10.0, 0.0), (20.0, 20.0, 0.0), (3.0, 12.6, 0.0), (41.0, 12.0, 0.0), (5.0, 29.0, 0.0),
                      (47.0, 29.0, 0.0), (8.0, 7.2, F2), (44.0, 7.0, F2), (26.0, 23.0, F2), (16.6, 18.0, F2), (7.0, 12.0, F2), (30.0, 2.6, F2), (48.0, 30.0, F2), (20.0, 7.2, BZ), (44.0, 7.4, BZ), (35.6, 18.0, BZ)):
        K(f'litter_{int(x * 11 + y * 3 + z) % 6 + 1}', x, y, z=z + 0.001, r=R.uniform(0, 6.28))

    # ---- what a hospital has on every wall: a bump rail at hip height down the corridors, broken at each way through
    def spans(axis, c, z):
        out = []
        for d in m.doors:
            hx, hy, hz = d['hinge']
            if d['axis'] == axis and abs(hz - z) < 0.5 and abs((hy if axis == 'x' else hx) - c) < 0.2:
                a, b = sorted((hx if axis == 'x' else hy, (hx if axis == 'x' else hy) + d['sign'] * d['w']))
                out.append((a, b))
        for (x, y, oz, w, ax) in m.openings:
            if ax == axis and abs(oz - z) < 0.5 and abs((y if axis == 'x' else x) - c) < 0.2:
                p = x if axis == 'x' else y
                out.append((p - w / 2, p + w / 2))
        for g in m.windows:
            if g['axis'] == axis and abs(g['c'] - c) < 0.2 and g['z0'] < z + 1.1 and g['z1'] > z + 0.7:
                out.append((g['a'], g['b']))
        return sorted(out)

    def bump_rail(axis, c, p0, p1, z, side, t=INT_T, mat='wood_top'):
        cur = p0 + 0.12
        for (a, b) in spans(axis, c, z) + [(p1 - 0.12, p1)]:
            a2 = min(a - 0.2, p1 - 0.12)
            if a2 - cur > 0.5:
                f = c + side * (t / 2 + 0.045)
                lo, hi = min(f - 0.03, f + 0.03), max(f - 0.03, f + 0.03)
                if R.random() < 0.88:          # a length here and there has come off
                    if axis == 'x':
                        box((cur, lo, z + 0.84), (a2, hi, z + 0.96), mat, collide=False, density=0.25)
                        box((cur, lo, z + 0.2), (a2, lo + 0.02, z + 0.34), 'steel', collide=False, density=0.12)
                    else:
                        box((lo, cur, z + 0.84), (hi, a2, z + 0.96), mat, collide=False, density=0.25)
                        box((lo, cur, z + 0.2), (lo + 0.02, a2, z + 0.34), 'steel', collide=False, density=0.12)
            cur = max(cur, b + 0.2)
    for z in (0.0, F2):
        bump_rail('x', SY0, X0 + 6.0, 18.0 if z == 0 else AX0, z, 1)
        bump_rail('x', SY0, 34.0 if z == 0 else AX1, X1 - 6.0, z, 1)
        bump_rail('x', SY1, X0, AX0, z, -1)
        bump_rail('x', SY1, AX1, X1, z, -1)
        bump_rail('x', NY0, X0, AX0, z, 1)
        bump_rail('x', NY0, AX1, X1, z, 1)
        bump_rail('x', NY1, X0, 20.0, z, -1)
        bump_rail('x', NY1, 32.0, X1, z, -1)
    # bed-head trunking behind the ward beds: a cream box along the wall with its sockets and a gas outlet or two
    for (x0, x1, y, z) in ((6.3, 17.7, Y0 + EXT_T / 2 + 0.03, 0.0), (34.3, 45.7, Y0 + EXT_T / 2 + 0.03, 0.0), (32.3, 42.7, Y1 - EXT_T / 2 - 0.03, F2)):
        yy = (y, y + 0.07) if y < 10 else (y - 0.07, y)
        box((x0, yy[0], z + 1.32), (x1, yy[1], z + 1.5), 'trim', collide=False, density=0.25)
        for k in range(int((x1 - x0) / 1.4)):
            xx = x0 + 0.5 + k * 1.4
            box((xx, yy[0] - (0.012 if y > 10 else 0), z + 1.37), (xx + 0.09, yy[1] + (0.012 if y < 10 else 0), z + 1.45), 'plastic_black' if k % 3 else 'steel', collide=False, density=0.08)
    # ducts upstairs too, where the tiles have gone
    for (x0, x1, y) in ((0.6, 14.4, SY0 + 0.45), (37.6, 51.4, SY0 + 0.45), (0.6, 14.4, NY1 - 0.5), (37.6, 51.4, NY1 - 0.5)):
        n = int((x1 - x0) / 2.4)
        for i in range(n):
            if i in (1, n - 2):
                continue
            a = x0 + i * (x1 - x0) / n
            box((a + 0.03, y - 0.2, TOP - 0.4), (a + (x1 - x0) / n - 0.03, y + 0.2, TOP - 0.08), 'tin_in', collide=False, density=0.2)
    # the fall dressed: heaps of what it was made of along both edges and across the treads, bar sticking out of it
    for i in range(9):
        f = (i + 0.5) / 9
        y = 15.6 + (VY1 - 15.6) * f
        for x in (RX0 - 0.2, RX1 + 0.2):
            K(f'rubble_{i % 3 + 1}', x + R.uniform(-0.3, 0.3), y, F2 * f * R.uniform(0.55, 0.95) + 0.001, r=R.uniform(0, 6.28))
        if i % 2 == 0:
            K(f'debris_{i % 5 + 1}', R.uniform(RX0 + 1.0, RX1 - 1.0), y, F2 * (int(f * NS) + 1) / NS + 0.002, R.uniform(0, 6.28))

    # finishes: a two-tone wall and a dropped ceiling wherever it was a hospital
    DADO = {'hosp_wall': 'hosp_dado', 'hosp_wall2': 'hosp_dado2', 'hosp_wall3': 'hosp_dado3'}
    for r in m.rooms:
        if r['wall'] in DADO and not r.get('dado'):
            r['dado'] = (DADO[r['wall']], 1.15)
        if r['wall'] in ('hosp_wall', 'hosp_wall2', 'hosp_wall3', 'wall_paper', 'kidwall') and r['a'][2] > BZ + 0.1 and r['name'] not in ('chapel', 'atrium') and 'cor_' not in r['name']:
            r['ceil'] = 'ceil_tile'

    # ================= all of it indoors =================
    import indoor
    m.zones.insert(0, dict(a=(AX0, SY1, -0.3), b=(AX1, NY0, LANT), kind='hall'))
    m.zones.insert(1, dict(a=(20.0, NY1, -0.3), b=(32.0, Y1, TOP), kind='hall'))
    m.zones.append(dict(a=(X0, Y0, -0.3), b=(X1, Y1, TOP), kind='small'))

    # each side starts inside, in its own end of the building (a round picks its own spots after the first)
    m.spawns['a'] = [[2.0, 10.6, 0], [4.6, 13.6, 0], [2.4, 19.0, 0], [5.0, 21.4, 0], [10.4, 12.0, 0], [11.0, 21.6, 0], [3.0, 29.6, 0], [12.0, 3.6, 0]]
    m.spawns['b'] = [[50.0, 10.2, 0], [47.6, 13.4, 0], [49.6, 18.4, 0], [48.0, 21.6, 0], [42.4, 10.6, 0], [39.0, 21.4, 0], [47.0, 28.4, 0], [44.6, 4.2, 0]]
    m.spawns['ffa'] = m.spawns['a'][:5] + m.spawns['b'][:5] + [[26.0, 9.8, 0], [20.0, 12.6, 0], [33.0, 21.8, 0], [26.0, 28.6, 0], [14.0, 30.0, 0], [38.0, 31.0, 0],
                                                               [7.0, 15.0, F2], [44.0, 12.0, F2], [20.0, 9.0, F2], [32.0, 22.6, F2], [20.0, 3.0, F2], [38.0, 29.0, F2],
                                                               [16.0, 7.3, BZ], [38.0, 7.3, BZ], [38.0, 30.0, BZ]]
    m.hold = [[26.0, 13.0, 0], [26.0, 29.4, 0], [26.0, 7.3, BZ]]
    m.sky = SKY
    m.weather = WEATHER
    m.centre = [26.0, -17.0]
    m.attract = [[3.0, 1.5, -7.3], [22.0, 1.5, -7.2]]    # game axes: a slow walk down the south corridor
    import clutter
    print('  sealed doors, windows:', indoor.seal(m, indoor.inside_fn(m)))
    clutter.trim(m)
    print('  furnished:', clutter.furnish(m, 'hospital', random.Random(71), skip=('atrium', 'kitchen', 'theatre', 'morgue', 'xray', 'lab', 'furnace', 'chapel', 'scrub', 'longward', 'lobby')))
    clutter.dress(m, 'hospital', random.Random(41), outside=[(-17.0, -19.0, 69.0, -1.0, 0.0), (-17.0, 0.0, -0.6, 51.0, 0.0), (52.6, 0.0, 69.0, 51.0, 0.0), (0.0, 34.6, 52.0, 51.0, 0.0)], out_n=50, blood=0.8)
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
    out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ward'
    draw(m, out + '_g.png', (0.3, 1.6))
    draw(m, out + '_u.png', (F2 + 0.3, F2 + 1.6))
    draw(m, out + '_b.png', (BZ + 0.3, BZ + 1.6))
