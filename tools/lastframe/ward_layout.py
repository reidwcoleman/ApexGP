"""Ashgrove Ward: a closed hospital wing on a stormy night, as data. Same language as layout.py.
Metres, x east, y north, z up. The car park is south, the morgue north-east, a courtyard in the middle.

Three ways across, all of them dark:
  ground  - two corridors round the courtyard, the lobby in the middle of the south one
  upstairs - the long wards, and a balcony over the lobby; a floor that gave way into the day room
  under   - a service tunnel past the boiler, the cold store and a flooded room, stair to stair
Team A comes in from the west yard, team B from the east. The power is off: emergency lamps, a few
tubes still trying, the sodium lamp in the car park, a fire in a drum.
"""
import math, random
from layout import Map, EXT_T, INT_T

F2, TOP, BZ = 3.6, 7.2, -3.4
SLAB = 0.25
X0, X1, Y0, Y1 = 4.0, 68.0, 14.0, 44.0
SY0, SY1 = 20.0, 22.4      # south corridor
NY0, NY1 = 35.6, 38.0      # north corridor
CX0, CX1 = 28.0, 44.0      # the courtyard, between the corridors
WX0, WX1 = 14.0, 16.4      # the west wing's cross corridor (ground only)
EX0, EX1 = 55.6, 58.0      # the east wing's
LX0, LX1 = 30.0, 42.0      # the lobby, two storeys high
MY = 29.0                  # wing rooms split here
BC = -0.55                 # tunnel ceiling (pipes under it)

# a night with the storm on it: the city's glow low on the clouds, cold and green-grey
SKY = dict(hdri='rooftop_night', strength=1.15, tint=(0.34, 0.46, 0.7))
WEATHER = dict(key=0.13, rain=1, wet=1, fog=1.15, sky=[0.3, 0.33, 0.4], wb=[0.95, 1.0, 1.03])
VOLUME = dict(step=[2, 1.15, 2], min=[-10, -4.6, -56], dim=[48, 12, 34])

TUBE = (0.8, 0.94, 1.0)
WARM = (1.0, 0.7, 0.4)
RED = (1.0, 0.07, 0.035)
SODIUM = (1.0, 0.55, 0.2)


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
    m.rng = random.Random(13)
    R = m.rng
    box, wall, door, window, room, prop, light = m.box, m.wall, m.door, m.window, m.room, m.prop, m.light

    def D(n, x, y, z=0.0, r=0.0, **k):
        k.setdefault('collide', False)
        prop(n, x, y, z=z, rot=r, **k)

    def L(n, x, y, z=0.0, r=0.0, kg=4, sf='wood', **k):
        m.loose(n, x, y, z=z, rot=r, kg=kg, surf=sf, **k)

    def under(a, b, mat='dconc', **k):
        k.setdefault('density', 0.6)
        return box(a, b, mat, tag='under', **k)

    def tube(x, y, z, p, along='x', flick=0.0, lit=True):
        """a ceiling tube; flick > 0 means it can't make up its mind"""
        prop('mounted_fluorescent_lights', x, y, z=z - 0.03, rot=0 if along == 'x' else math.pi / 2, part='mounted_fluorescent_lights_a', collide=False)
        if lit:
            light('area', (x, y, z - 0.06), TUBE, p, size=(1.2, 0.14) if along == 'x' else (0.14, 1.2), flicker=flick)

    def emerg(x, y, z, p=5.0):
        """the red lamp over a door: the only thing on the battery"""
        box((x - 0.14, y - 0.05, z - 0.08), (x + 0.14, y + 0.05, z + 0.06), 'emerg', collide=False, density=0.1)
        light('point', (x, y, z - 0.16), RED, p, radius=0.06)

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

    m.stains = []      # blood, old and dark: x, y, z, nx, ny, nz, size

    # ================= outside: one wet apron round the building, a wall round that =================
    box((-14, -10, -1), (86, Y0, 0), 'asphalt', tag='ground', density=0.45)
    box((-14, Y0, -1), (X0, 58, 0), 'yard', tag='ground', density=0.5)
    box((X1, Y0, -1), (86, 58, 0), 'yard', tag='ground', density=0.5)
    box((X0, Y1, -1), (X1, 58, 0), 'yard', tag='ground', density=0.5)
    # bay lines, faded
    for x in range(-6, 30, 3):
        box((x, -2.0, -0.2), (x + 0.1, 4.5, 0.004), 'paint', collide=False, density=0.06)
    for x in range(46, 82, 3):
        box((x, -2.0, -0.2), (x + 0.1, 4.5, 0.004), 'paint', collide=False, density=0.06)
    box((30.0, 4.0, -0.2), (42.0, 4.12, 0.004), 'paint_y', collide=False, density=0.06)
    # the boundary wall, and the gate gone
    BW = 3.4
    for a, b in (((-14.4, -10.4), (86.4, -10)), ((-14.4, 58), (86.4, 58.4)), ((-14.4, -10), (-14, 58)), ((86, -10), (86.4, 58))):
        box((a[0], a[1], 0), (b[0], b[1], BW), 'hbrick_c', tag='ext', density=0.25)
        box((a[0] - 0.08, a[1] - 0.08, BW), (b[0] + 0.08, b[1] + 0.08, BW + 0.12), 'stone', collide=False, density=0.1)
    m.invisible((-14.4, -10.4, BW), (86.4, -10, BW + 6))
    m.invisible((-14.4, 58, BW), (86.4, 58.4, BW + 6))
    m.invisible((-14.4, -10, BW), (-14, 58, BW + 6))
    m.invisible((86, -10, BW), (86.4, 58, BW + 6))
    # the hospital's other blocks, dark against the cloud
    for (a, b, h) in (((-40, 64), (30, 84), 22), ((40, 66), (110, 90), 16), ((-50, -40), (-20, 50), 12), ((96, -30), (120, 50), 19), ((-10, -60), (80, -30), 9)):
        box((a[0], a[1], 0), (b[0], b[1], h), 'brick_b', collide=False, tag='far', density=0.02)

    # ================= slabs =================
    STW = (X0, Y0, X0 + 3.0, SY0 - 0.3)              # west stair: the way up
    STE = (X1 - 3.0, Y0, X1, SY0 - 0.3)
    DNW = (X0 + 3.0, Y0, X0 + 6.0, SY0 - 0.4)        # west stair: the way down
    DNE = (X1 - 6.0, Y0, X1 - 3.0, SY0 - 0.4)
    COURT = (CX0, SY1, CX1, NY0)
    LOBBY = (LX0, Y0, LX1, SY0)
    HOLE = (47.0, 24.0, 50.2, 27.4)                  # where the ward floor went through
    for r in rects_minus(X0, Y0, X1, Y1, [COURT, DNW, DNE]):
        box((r[0], r[1], -0.3), (r[2], r[3], 0.0), 'slab', tag='floor')
    for r in rects_minus(X0, Y0, X1, Y1, [COURT, STW, STE, LOBBY, HOLE]):
        box((r[0], r[1], F2 - SLAB), (r[2], r[3], F2), 'slab', tag='floor')
    # the broken edge: joists and lath hanging into the hole
    for i in range(5):
        x = HOLE[0] + 0.3 + i * 0.66
        box((x, HOLE[1] - 0.2, F2 - SLAB - R.uniform(0.1, 0.5)), (x + 0.12, HOLE[1] + R.uniform(0.3, 1.2), F2 - 0.05), 'planks', collide=False, density=0.3)
    box((HOLE[0] - 0.4, HOLE[1] + 0.6, 0.0), (HOLE[2] + 0.2, HOLE[3] - 0.2, 0.35), 'planks', pen=True, tag='counter', density=0.3)   # what came down
    for r in rects_minus(X0 - 0.3, Y0 - 0.3, X1 + 0.3, Y1 + 0.3, [(CX0 + 0.3, SY1 + 0.3, CX1 - 0.3, NY0 - 0.3)]):
        box((r[0], r[1], TOP), (r[2], r[3], TOP + 0.35), 'roof', density=0.1)
    # parapets, outside and round the courtyard
    for a, b in (((X0 - 0.3, Y0 - 0.3), (X1 + 0.3, Y0)), ((X0 - 0.3, Y1), (X1 + 0.3, Y1 + 0.3)), ((X0 - 0.3, Y0), (X0, Y1)), ((X1, Y0), (X1 + 0.3, Y1))):
        box((a[0], a[1], TOP + 0.35), (b[0], b[1], TOP + 1.0), 'hbrick', density=0.12)
        box((a[0] - 0.05, a[1] - 0.05, TOP + 1.0), (b[0] + 0.05, b[1] + 0.05, TOP + 1.1), 'stone', collide=False, density=0.08)
    # a string course between the floors
    for a, b in (((X0 - 0.42, Y0 - 0.42), (X1 + 0.42, Y0 - 0.16)), ((X0 - 0.42, Y1 + 0.16), (X1 + 0.42, Y1 + 0.42)), ((X0 - 0.42, Y0 - 0.16), (X0 - 0.16, Y1 + 0.16)), ((X1 + 0.16, Y0 - 0.16), (X1 + 0.42, Y1 + 0.16))):
        box((a[0], a[1], F2 - 0.3), (b[0], b[1], F2 - 0.1), 'stone', collide=False, density=0.1)
        box((a[0], a[1], 0), (b[0], b[1], 0.55), 'plinth', collide=False, density=0.1)

    # ================= the outside walls =================
    EXT = 'hbrick'
    # south front: the lobby doors in the middle, ward windows either side
    holes = [door('x', Y0, 35.45, 0.0, w=1.1, kind='steel', hinge=0), door('x', Y0, 36.55, 0.0, w=1.1, kind='steel', hinge=1)]
    for x, bd, gl in ((13.0, False, True), (19.0, True, True), (26.0, False, False), (32.2, False, True), (39.8, False, False), (46.0, True, True), (53.0, False, True), (59.0, False, False)):
        holes.append(window('x', Y0, x, 0.0, w=1.3, h=1.7, sill=0.95, boards=bd, glass=gl))
    wall('x', Y0, X0, X1, 0, F2, EXT_T, EXT, tag='ext', holes=holes)
    holes = []
    for x, bd, gl in ((7.0, False, True), (13.0, False, False), (19.0, False, True), (26.0, True, True), (32.2, False, True), (36.0, False, False), (39.8, False, True), (46.0, False, True), (53.0, False, False), (59.0, True, True), (65.0, False, True)):
        holes.append(window('x', Y0, x, F2, w=1.3, h=1.8, sill=0.9, boards=bd, glass=gl))
    wall('x', Y0, X0, X1, F2, TOP, EXT_T, EXT, tag='ext', holes=holes)
    # a canopy over the doors, and the sign gone dark
    box((33.2, Y0 - 2.6, 3.0), (38.8, Y0 - 0.16, 3.22), 'shopframe', collide=False, density=0.4)
    for x in (33.4, 38.6):
        box((x - 0.08, Y0 - 2.5, 0), (x + 0.08, Y0 - 2.34, 3.0), 'steel', density=0.2)
    box((33.6, Y0 - 0.2, 3.3), (38.4, Y0 - 0.16, 3.5), 'signboard', collide=False, density=0.2)
    # north
    holes = [window('x', Y1, 7.0, 0.0), window('x', Y1, 12.5, 0.0, glass=False), door('x', Y1, 9.6, 0.0, kind='steel', swing=-1),
             window('x', Y1, 31.5, 0.0, w=1.0, h=2.4, sill=0.8), window('x', Y1, 36.0, 0.0, w=1.0, h=2.4, sill=0.8, glass=False), window('x', Y1, 40.5, 0.0, w=1.0, h=2.4, sill=0.8),
             door('x', Y1, 63.0, 0.0, w=1.3, kind='steel', swing=-1)]
    wall('x', Y1, X0, X1, 0, F2, EXT_T, EXT, tag='ext', holes=holes)
    holes = []
    for x, bd, gl in ((7.0, False, True), (12.0, False, True), (20.0, True, True), (25.0, False, False), (31.0, False, True), (36.0, False, True), (41.0, False, False), (47.0, False, True), (52.0, True, True), (61.0, False, True), (65.5, False, False)):
        holes.append(window('x', Y1, x, F2, w=1.3, h=1.8, sill=0.9, boards=bd, glass=gl))
    wall('x', Y1, X0, X1, F2, TOP, EXT_T, EXT, tag='ext', holes=holes)
    # west and east: a door into each corridor, windows on the wing rooms
    for xc, sw in ((X0, 1), (X1, -1)):
        holes = [door('y', xc, (SY0 + SY1) / 2, 0.0, w=1.2, kind='steel', swing=sw), door('y', xc, (NY0 + NY1) / 2, 0.0, w=1.2, kind='steel', swing=sw),
                 window('y', xc, 25.5, 0.0, boards=xc == X1), window('y', xc, 32.5, 0.0, glass=xc == X0), window('y', xc, 41.0, 0.0)]
        wall('y', xc, Y0, Y1, 0, F2, EXT_T, EXT, tag='ext', holes=holes)
        holes = [window('y', xc, 16.0, F2, glass=False), window('y', xc, 25.5, F2), window('y', xc, 32.5, F2, boards=True), window('y', xc, 41.0, F2)]
        wall('y', xc, Y0, Y1, F2, TOP, EXT_T, EXT, tag='ext', holes=holes)
        emerg(xc + (0.3 if xc == X0 else -0.3), (SY0 + SY1) / 2, 2.55, 4)
        emerg(xc + (0.3 if xc == X0 else -0.3), (NY0 + NY1) / 2, 2.55, 4)

    # ================= the courtyard's four walls: windows both floors, a door in the middle of each =================
    for yc, sw in ((SY1, 1), (NY0, -1)):
        holes = [door('x', yc, 36.0, 0.0, w=1.0, kind='wood', swing=sw)]
        for x, gl in ((30.5, True), (33.2, False), (38.8, True), (41.5, True)):
            holes.append(window('x', yc, x, 0.0, w=1.4, h=1.6, sill=1.0, wt=INT_T + 0.1, glass=gl))
        wall('x', yc, CX0, CX1, 0, F2, 0.24, 'hbrick', tag='ext', holes=holes, pen=True)
        holes = [window('x', yc, x, F2, w=1.4, h=1.6, sill=1.0, wt=0.34, glass=gl) for x, gl in ((30.5, True), (34.0, False), (38.0, True), (41.5, False))]
        wall('x', yc, CX0, CX1, F2, TOP, 0.24, 'hbrick', tag='ext', holes=holes, pen=True)
    for xc, sw, dy in ((CX0, 1, 25.6), (CX1, -1, 32.4)):
        holes = [door('y', xc, dy, 0.0, kind='wood', swing=sw), window('y', xc, 29.0 if xc == CX1 else 31.5, 0.0, w=1.4, h=1.6, sill=1.0, wt=0.34)]
        wall('y', xc, SY1, NY0, 0, F2, 0.24, 'hbrick', tag='ext', holes=holes, pen=True)
        holes = [window('y', xc, y, F2, w=1.4, h=1.6, sill=1.0, wt=0.34, glass=y != 29.0) for y in (25.5, 29.0, 32.5)]
        wall('y', xc, SY1, NY0, F2, TOP, 0.24, 'hbrick', tag='ext', holes=holes, pen=True)

    # ================= ground floor =================
    Z = 0.0
    H1 = F2 - SLAB
    # south corridor, its south side: a door to every room, the lobby open
    holes = [door('x', SY0, X0 + 4.5, Z, swing=1), door('x', SY0, 16.0, Z), door('x', SY0, 26.0, Z), (LX0 + 2.0, LX1 - 1.0, Z, Z + 2.6),
             door('x', SY0, 46.0, Z), door('x', SY0, 56.0, Z, swing=-1), door('x', SY0, X1 - 4.5, Z, swing=-1)]
    wall('x', SY0, X0, X1, Z, H1, INT_T, 'wall_int', holes=holes, pen=True, tag='int')
    box((LX0 + 2.0, SY0 - 0.1, Z + 2.6), (LX1 - 1.0, SY0 + 0.1, H1), 'wall_int', tag='int', density=0.4)
    # its north side, west and east of the courtyard
    holes = [door('x', SY1, 9.0, Z), (WX0, WX1, Z, Z + 2.5), door('x', SY1, 22.0, Z, swing=-1)]
    wall('x', SY1, X0, CX0, Z, H1, INT_T, 'wall_int', holes=holes, pen=True, tag='int')
    holes = [door('x', SY1, 50.0, Z), (EX0, EX1, Z, Z + 2.5), door('x', SY1, 63.0, Z, swing=-1)]
    wall('x', SY1, CX1, X1, Z, H1, INT_T, 'wall_int', holes=holes, pen=True, tag='int')
    # north corridor
    holes = [door('x', NY0, 9.0, Z), (WX0, WX1, Z, Z + 2.5), door('x', NY0, 25.0, Z)]
    wall('x', NY0, X0, CX0, Z, H1, INT_T, 'wall_int', holes=holes, pen=True, tag='int')
    holes = [door('x', NY0, 50.0, Z), (EX0, EX1, Z, Z + 2.5)] + [door('x', NY0, 58 + 10 / 6 + i * 10 / 3, Z, kind='steel', w=0.86) for i in range(3)]
    wall('x', NY0, CX1, X1, Z, H1, INT_T, 'wall_int', holes=holes, pen=True, tag='int')
    holes = [door('x', NY1, 10.0, Z, swing=-1), door('x', NY1, 22.0, Z, w=1.3, kind='steel', swing=-1), door('x', NY1, 35.45, Z, w=1.1, hinge=0), door('x', NY1, 36.55, Z, w=1.1, hinge=1),
             door('x', NY1, 51.0, Z, kind='steel', swing=-1), door('x', NY1, 63.0, Z, swing=-1)]
    wall('x', NY1, X0, X1, Z, H1, INT_T, 'wall_int', holes=holes, pen=True, tag='int')
    # the wings' cross corridors
    wall('y', WX0, SY1, NY0, Z, H1, INT_T, 'wall_int', holes=[door('y', WX0, 25.6, Z), door('y', WX0, 32.4, Z, swing=-1)], pen=True, tag='int')
    wall('y', WX1, SY1, NY0, Z, H1, INT_T, 'wall_int', holes=[door('y', WX1, 25.8, Z, swing=-1), door('y', WX1, 31.4, Z)], pen=True, tag='int')
    wall('y', EX0, SY1, NY0, Z, H1, INT_T, 'wall_int', holes=[door('y', EX0, 25.0, Z), door('y', EX0, 32.4, Z, swing=-1)], pen=True, tag='int')
    wall('y', EX1, SY1, NY0, Z, H1, INT_T, 'wall_int', holes=[door('y', EX1, 26.0, Z, swing=-1)], pen=True, tag='int')
    # rooms split across the wings
    wall('x', MY, X0, WX0, Z, H1, INT_T, 'wall_int', holes=[(8.0, 10.0, Z, Z + 2.2)], pen=True, tag='int')
    wall('x', MY, WX1, CX0, Z, H1, INT_T, 'wall_int', pen=True, tag='int')
    wall('y', 22.0, MY, NY0, Z, H1, INT_T, 'wall_int', pen=True, tag='int')
    wall('x', MY, CX1, EX0, Z, H1, INT_T, 'wall_int', holes=[door('x', MY, 47.0, Z)], pen=True, tag='int')
    wall('x', MY, EX1, X1, Z, H1, INT_T, 'wall_int', pen=True, tag='int')
    # the isolation cells: three, steel doors, nothing inside
    for i in (1, 2):
        wall('y', 58 + i * 10 / 3, MY, NY0, Z, H1, 0.2, 'wall_conc', pen=False, tag='int')
    # south strip partitions; the lobby's go to the roof
    for x in (X0 + 6.0, 22.0, 50.0, X1 - 6.0):
        wall('y', x, Y0, SY0, Z, H1, INT_T, 'wall_int', pen=True, tag='int')
    wall('y', LX0, Y0, SY0, Z, TOP, INT_T, 'wall_int', pen=True, tag='int', holes=[door('y', LX0, 16.5, Z)])
    wall('y', LX1, Y0, SY0, Z, TOP, INT_T, 'wall_int', pen=True, tag='int', holes=[door('y', LX1, 17.5, Z, swing=-1)])
    # north strip partitions
    for x in (16.0, 28.0, 44.0, 58.0):
        wall('y', x, NY1, Y1, Z, H1, INT_T, 'wall_int', pen=True, tag='int')

    room('scor', X0, SY0, X1, SY1, Z, H1, 'hosp_wall', 'hlino')
    room('ncor', X0, NY0, X1, NY1, Z, H1, 'hosp_wall', 'hlino')
    room('wcor', WX0, SY1, WX1, NY0, Z, H1, 'hosp_wall', 'hlino')
    room('ecor', EX0, SY1, EX1, NY0, Z, H1, 'hosp_wall', 'hlino')
    room('stairw', X0, Y0, X0 + 6, SY0, BZ, TOP - BZ, 'wall_conc', 'concstep')
    room('stairs', X1 - 6, Y0, X1, SY0, BZ, TOP - BZ, 'wall_conc', 'concstep')
    room('warda', X0 + 6, Y0, 22, SY0, Z, H1, 'hosp_wall2', 'hlino')
    room('records', 22, Y0, LX0, SY0, Z, H1, 'hosp_wall2', 'hlino')
    room('lobby', LX0, Y0, LX1, SY0, Z, TOP, 'wall_paper', 'mtile')
    room('pharm', LX1, Y0, 50, SY0, Z, H1, 'wtile', 'mtile')
    room('wardb', 50, Y0, X1 - 6, SY0, Z, H1, 'hosp_wall2', 'hlino')
    room('nurse', X0, SY1, WX0, MY, Z, H1, 'hosp_wall', 'hlino')
    room('staff', X0, MY, WX0, NY0, Z, H1, 'wall_paper', 'carpet')
    room('xray', WX1, SY1, CX0, MY, Z, H1, 'wtile', 'mtile')
    room('exam1', WX1, MY, 22, NY0, Z, H1, 'hosp_wall2', 'hlino')
    room('exam2', 22, MY, CX0, NY0, Z, H1, 'hosp_wall2', 'hlino')
    room('dayroom', CX1, SY1, EX0, MY, Z, H1, 'wall_paper', 'carpet')
    room('store', CX1, MY, EX0, NY0, Z, H1, 'dconc', 'conc')
    room('laundry', EX1, SY1, X1, MY, Z, H1, 'wtile', 'mtile')
    room('cells', EX1, MY, X1, NY0, Z, H1, 'dconc', 'conc')
    room('canteen', X0, NY1, 16, Y1, Z, H1, 'wtile', 'mtile')
    room('theatre', 16, NY1, 28, Y1, Z, H1, 'wtile', 'mtile')
    room('chapel', 28, NY1, 44, Y1, Z, H1, 'wall_paper', 'wood')
    room('morgue', 44, NY1, 58, Y1, Z, H1, 'wtile', 'mtile')
    room('service', 58, NY1, X1, Y1, Z, H1, 'dconc', 'conc')

    # ---- stairs: up on the outer side, down beside it, both dog-legs
    def stairwell(mirror):
        fx = (lambda x: X1 - (x - X0)) if mirror else (lambda x: x)
        def rx(a, b):
            a, b = fx(a), fx(b)
            return min(a, b), max(a, b)
        # up: first flight runs south, a landing, then north to the upper corridor
        a, b = rx(X0 + 0.12, X0 + 1.48)
        m.stairs(a, 16.9, b, SY0 - 0.32, 0.0, 1.8, '-y')
        a, b = rx(X0 + 0.12, X0 + 2.95)
        box((a, Y0 + 0.16, 0.0), (b, 16.9, 1.8), 'concstep', tag='step', density=0.5)
        a, b = rx(X0 + 1.55, X0 + 2.95)
        m.stairs(a, 16.9, b, SY0 - 0.32, 1.8, F2, '+y', solid=False)
        box((a, 16.9, 0.0), (b, SY0 - 0.32, 1.8), 'wall_conc', tag='int', density=0.4)
        a, b = rx(X0 + 1.48, X0 + 1.55)
        box((a, 16.9, 1.8), (b, SY0 - 0.32, 2.9), 'steel', collide=False, density=0.2)
        m.invisible((a, 16.9, 1.8), (b, SY0 - 0.32, 2.9))
        # upstairs: a rail round the well
        c = fx(X0 + 3.0)
        m.rail('y', c, Y0 + 0.2, SY0 - 0.32, F2)
        # down: south, a landing, north again to the tunnel
        a, b = rx(X0 + 3.1, X0 + 4.5)
        m.stairs(a, 16.9, b, SY0 - 0.45, BZ + 1.7, 0.0, '-y')
        box((a, 16.9, BZ), (b, SY0 - 0.45, BZ + 1.7), 'wall_conc', tag='under', density=0.4)
        a2, b2 = rx(X0 + 3.1, X0 + 5.88)
        under((a2, Y0 + 0.16, BZ), (b2, 16.9, BZ + 1.7), 'concstep')
        a3, b3 = rx(X0 + 4.55, X0 + 5.88)
        m.stairs(a3, 16.9, b3, SY0 - 0.45, BZ, BZ + 1.7, '+y')
        a4, b4 = rx(X0 + 4.5, X0 + 4.55)
        m.rail('y', (a4 + b4) / 2, 16.9, SY0 - 0.45, BZ + 1.7)
        m.rail('x', SY0 - 0.42, a3, b3, 0.0)
        c = fx(X0 + 3.0)
        m.rail('y', c, Y0 + 0.2, SY0 - 0.45, 0.0, h=1.0)
        # the well's walls below ground
        a, b = rx(X0 - 0.2, X0 + 6.1)
        under((a, Y0 - 0.2, BZ - 0.3), (b, SY0, BZ), 'conc')
        under((a, Y0 - 0.2, BZ), (b, Y0, -0.3))
        xe = fx(X0 + 6.0)
        under((xe - 0.1, Y0, BZ), (xe + 0.1, SY0, -0.3))
        xo = fx(X0)
        under((xo - 0.16, Y0, BZ), (xo + 0.16, SY0, -0.3))
        lx = fx(X0 + 1.5)
        emerg(lx, SY0 - 0.15, 2.5, 4)
        emerg(lx, SY0 - 0.15, F2 + 2.5, 3)
        light('point', (fx(X0 + 4.5), 16.0, BZ + 2.6), RED, 4, radius=0.05)
        box((fx(X0 + 4.5) - 0.14, Y0 + 0.05, BZ + 2.7), (fx(X0 + 4.5) + 0.14, Y0 + 0.15, BZ + 2.86), 'emerg', collide=False, density=0.1)
    stairwell(False)
    stairwell(True)

    # ---- the lobby: stair up the west wall to the balcony, a desk, chairs in rows
    m.stairs(LX0 + 0.15, Y0 + 0.3, LX0 + 1.75, SY0 - 0.02, 0.0, F2, '+y')
    m.rail('y', LX0 + 1.8, 16.0, SY0, 0.0, h=0.95, mat='steel')
    for i in range(6):
        z = 0.95 + (F2 * (16.0 + i * 0.67 - Y0 - 0.3) / (SY0 - Y0 - 0.3))
        box((LX0 + 1.76, 16.0 + i * 0.67, z - 0.9), (LX0 + 1.8, 16.0 + i * 0.67 + 0.04, z), 'steel', collide=False, density=0.1)
    m.rail('x', SY0 + 0.05, LX0 + 1.8, LX1, F2, mat='steel')
    m.rail('y', LX1 - 0.05, SY0, SY0 + 0.0, F2)
    box((34.0, 16.6, 0), (38.0, 17.3, 1.05), 'planks', pen=True, tag='counter', density=0.5)
    box((33.9, 16.5, 1.05), (38.1, 17.4, 1.1), 'wood_top', collide=False, density=0.4)
    box((37.3, 17.3, 0), (38.0, 18.6, 1.05), 'planks', pen=True, tag='counter', density=0.5)
    for row in range(2):
        for k in range(4):
            if (row, k) in ((1, 2),):
                continue
            L('plastic_monobloc_chair_01', 33.4 + k * 0.62 + R.uniform(-0.05, 0.05), 18.9 - row * 0.9, r=math.pi + R.uniform(-0.3, 0.3), kg=2.5, sf='plastic')
    L('plastic_monobloc_chair_01', 39.6, 15.4, r=2.2, kg=2.5, sf='plastic')
    D('wheelchair_01', 40.6, 18.6, r=-2.4)
    D('wall_clock', 36.0, SY0 - 0.12, z=2.4, r=math.pi)
    D('Television_01', 35.0, 16.95, z=1.1, r=math.pi)
    D('clipboard', 36.6, 16.95, z=1.1, r=0.3)
    D('binder_notebook', 35.8, 16.9, z=1.1, r=2.4)
    prop('drawer_cabinet', 40.6, Y0 + 0.4, rot=0, part='drawer_cabinet')
    L('trashbag', 41.2, 16.2, kg=7, sf='bag')
    L('cardboard_box_01', 31.4, 19.3, r=0.5, kg=4, sf='card')
    D('fire_alarm', LX1 - 0.12, 19.0, z=1.4, r=-math.pi / 2)
    D('caged_hanging_light', 36.0, 17.6, z=TOP - 0.85)
    stains((36.8, 15.6, 0.0, 0, 0, 1, 1.6), (34.3, 16.58, 0.7, 0, -1, 0, 0.9))

    # ---- ward A, ward B: iron beds, curtains gone, a few things dragged about
    for x0 in (X0 + 6.0, 50.0):
        for i in range(4):
            x = x0 + 1.2 + i * 2.9 if x0 < 30 else x0 + 1.2 + i * 2.9
            if x > x0 + 11.4:
                continue
            ang = math.pi + R.uniform(-0.12, 0.12) + (0.0 if R.random() > 0.25 else 0.5)
            K(f'hbed_{i + int(x0)}', x, Y0 + 1.2, r=ang, solid=(0.48, 1.04, 0.7))
            D('ClassicNightstand_01', x + 0.85, Y0 + 0.4, r=R.uniform(-0.2, 0.2))
            if i < 3:
                K(f'curtain_{i * 7 + int(x0)}', x, Y0 + 2.7, z=H1)
            if R.random() < 0.6:
                K('iv', x - 0.75, Y0 + 0.9, r=R.uniform(0, 6), solid=(0.25, 0.25, 1.9))
        L('wheelchair_01', x0 + 4.0, 18.6, r=R.uniform(0, 6), kg=14, sf='metal')
        L('metal_trash_can', x0 + 9.4, 19.4, kg=6, sf='metal', shape='cyl', part='metal_trash_can')
        tube(x0 + 3.0, 17.0, H1, 0, lit=False)
        tube(x0 + 8.0, 17.0, H1, 0, lit=False)
    D('medical_box', 13.2, 15.6, z=0.6, r=0.4)
    L('trashbag', 20.6, 19.2, kg=7, sf='bag')
    stains((11.5, 15.2, 0.62, 0, 0, 1, 0.9), (20.0, SY0 - 0.08, 1.1, 0, -1, 0, 1.2), (55.8, 16.0, 0.0, 0, 0, 1, 1.4))
    light('point', (57.0, 16.5, 2.3), WARM, 5, radius=0.05, flicker=0.5)
    D('pull_chain_light_socket', 57.0, 16.5, z=H1 - 0.02)

    # ---- records: shelves of files, a desk
    for y in (15.0, 17.2):
        prop('steel_frame_shelves_02', 23.0, y, rot=math.pi / 2)
        prop('steel_frame_shelves_02', 23.6, y, rot=math.pi / 2)
        prop('worn_metal_rack', 25.3, y, rot=math.pi / 2)
    prop('metal_office_desk', 28.4, 16.0, rot=math.pi / 2, part='metal_office_desk')
    L('SchoolChair_01', 27.6, 16.4, r=1.0, kg=6)
    D('office_notepads', 28.4, 15.6, z=0.79, r=0.6)
    for i in range(5):
        L('cardboard_box_01', 26.6 + R.uniform(-0.5, 0.5), 18.6 + R.uniform(-0.5, 0.6), z=0, r=R.uniform(0, 3), kg=4, sf='card')

    # ---- pharmacy: a counter with a grille, shelves stripped
    box((LX1 + 0.2, 17.3, 0), (49.0, 17.9, 1.05), 'planks', pen=True, tag='counter', density=0.5)
    box((LX1 + 0.1, 17.25, 1.05), (49.1, 17.95, 1.1), 'wood_top', collide=False, density=0.4)
    for x in [LX1 + 0.3 + i * 0.12 for i in range(56)]:
        box((x, 17.58, 1.1), (x + 0.02, 17.62, 2.6), 'grate', collide=False, density=0.05)
    m.invisible((LX1 + 0.2, 17.55, 1.1), (49.0, 17.65, 2.6), pen=True)
    for x in (43.2, 45.0, 46.8):
        prop('Shelf_01', x, Y0 + 0.3, rot=0)
    D('medical_box', 44.0, 17.6, z=1.1, r=0.3)
    L('plastic_crate_01', 48.0, 15.8, r=0.4, kg=1.5, sf='plastic')
    L('plastic_crate_02', 47.6, 16.2, z=0.0, r=1.4, kg=1.5, sf='plastic')

    # ---- west wing: nurses' station, staff room, x-ray, two exam rooms
    box((6.0, 25.2, 0), (6.6, 28.2, 1.05), 'planks', pen=True, tag='counter', density=0.5)
    box((6.6, 25.2, 0), (10.6, 25.8, 1.05), 'planks', pen=True, tag='counter', density=0.5)
    box((5.95, 25.15, 1.05), (10.65, 25.85, 1.1), 'wood_top', collide=False, density=0.4)
    D('classic_laptop', 8.2, 25.5, z=1.1, r=math.pi)
    D('desk_lamp_arm_01', 6.3, 26.4, z=1.1, r=0.4)
    prop('drawer_cabinet', 4.6, 23.6, rot=math.pi / 2, part='drawer_cabinet')
    prop('vintage_cabinet_01', 12.6, 27.9, rot=math.pi, part='vintage_cabinet_01_body')
    L('SchoolChair_01', 8.8, 26.6, r=2.6, kg=6)
    L('SchoolChair_01', 11.0, 23.5, r=0.3, kg=6)
    D('standing_chalkboard_01', 12.2, 24.0, r=-0.6)
    D('wall_clock', 4.15, 26.0, z=2.3, r=-math.pi / 2)
    prop('Sofa_01', 9.0, 34.9, rot=math.pi)
    prop('ArmChair_01', 5.0, 32.6, rot=-math.pi / 2 + 0.3)
    prop('CoffeeTable_01', 8.8, 33.4, rot=0.1)
    D('Television_01', 12.9, 31.0, z=0.0, r=-math.pi / 2)
    D('ceiling_fan', 9.0, 32.2, z=H1 - 0.52)
    L('wine_bottles_01', 8.6, 33.3, z=0.52, kg=1, sf='glass')
    # x-ray: a gantry, a table, the lead door
    box((20.2, 24.4, 0), (24.6, 25.4, 0.85), 'steel', pen=True, tag='counter', density=0.4)
    box((20.1, 24.3, 0.85), (24.7, 25.5, 0.92), 'plastic_black', collide=False, density=0.4)
    box((22.0, 26.6, 0), (22.6, 27.2, 2.6), 'steel', density=0.3)
    box((21.1, 25.0, 2.0), (22.6, 26.6, 2.4), 'steel', collide=False, density=0.3)
    prop('metal_tool_chest', 26.9, 23.2, rot=-math.pi / 2)
    L('wheelchair_01', 18.4, 27.6, r=1.2, kg=14, sf='metal')
    stains((22.4, 24.9, 0.93, 0, 0, 1, 0.8), (21.0, 26.4, 0.0, 0, 0, 1, 1.3), (CX0 - 0.13, 27.4, 1.2, -1, 0, 0, 1.4))
    for (x, y) in ((19.2, 31.6), (25.0, 31.6)):
        K(f'hbed_{int(x)}', x, y, r=-math.pi / 2, solid=(0.48, 1.04, 0.7))
        K('screen', x - 0.4, y - 1.6, r=0.2, solid=(0.95, 0.3, 1.7))
        D('medical_box', x - 0.6, y + 2.6, z=0.0, r=1.0)
    prop('Shelf_01', 17.0, 34.9, rot=math.pi)
    L('metal_trash_can', 27.2, 34.6, kg=6, sf='metal', shape='cyl', part='metal_trash_can')
    light('point', (19.2, 32.0, 2.6), TUBE, 3.5, radius=0.05, flicker=0.8)
    D('pull_chain_light_socket', 19.2, 32.0, z=H1 - 0.02)

    # ---- east wing: day room, store, laundry, cells
    prop('Sofa_01', 46.0, 23.1, rot=0)
    prop('Sofa_01', 49.4, 23.1, rot=0.1)
    prop('ArmChair_01', 52.6, 24.4, rot=-1.2)
    prop('CoffeeTable_01', 47.6, 25.0, rot=0.05)
    D('television_02', 47.6, 28.5, z=0.0, r=math.pi)
    L('plastic_monobloc_chair_01', 53.4, 27.2, r=2.0, kg=2.5, sf='plastic')
    L('plastic_monobloc_chair_01', 45.0, 27.8, r=-0.5, kg=2.5, sf='plastic')
    D('ceiling_fan', 49.8, 25.6, z=H1 - 0.52)
    for x in (45.0, 47.4, 49.8):
        prop('steel_frame_shelves_02', x, NY0 - 0.4, rot=0)
    prop('worn_metal_rack', 52.4, NY0 - 0.4, rot=0)
    L('cement_bag', 46.0, 31.0, r=0.5, kg=25, sf='bag')
    L('cardboard_box_01', 48.2, 30.0, r=1.1, kg=4, sf='card')
    L('cardboard_box_01', 48.6, 30.4, z=0.35, r=0.4, kg=3, sf='card')
    L('plastic_crate_03', 53.8, 30.0, r=2.2, kg=2, sf='plastic')
    prop('industrial_storage_cart', 51.0, 31.6, rot=0.3, collide=(0.8, 0.55, 0.6))
    # laundry: drums and a long bench
    box((59.0, 22.6, 0), (67.8, 23.5, 0.9), 'steel', pen=True, tag='counter', density=0.4)
    for x in (60.0, 62.2, 64.4, 66.6):
        box((x - 0.4, 27.9, 0), (x + 0.4, 28.85, 1.0), 'steel', density=0.3)
        box((x - 0.25, 27.85, 0.35), (x + 0.25, 27.9, 0.85), 'plastic_black', collide=False, density=0.1)
    L('industrial_pastic_container', 65.6, 25.0, r=0.3, kg=14, sf='plastic', shape='cyl')
    L('trashbag', 61.4, 25.6, kg=7, sf='bag')
    L('trashbag', 61.9, 26.0, r=1.2, kg=7, sf='bag')
    # the cells: one has something on the floor of it
    stains((63.0, 31.8, 0.0, 0, 0, 1, 1.7), (64.55, 31.4, 1.0, -1, 0, 0, 1.5), (59.6, 33.6, 1.4, 0, 1, 0, 1.0))
    prop('old_bed_frame', 66.6, 32.0, rot=0.0, collide=(0.5, 1.05, 0.3))
    light('point', (63.0, 32.0, 2.9), RED, 2.5, radius=0.04)

    # ---- north strip
    # canteen: a counter, a stove, tables pushed over
    box((5.0, 42.6, 0), (12.6, 43.6, 0.95), 'steel', pen=True, tag='counter', density=0.4)
    prop('electric_stove', 13.3, 43.3, rot=math.pi)
    prop('electric_stove', 14.0, 43.3, rot=math.pi)
    for (x, y, r, t) in ((7.0, 40.0, 0.2, 0.0), (11.0, 40.4, 1.4, 0.0)):
        prop('dining_table', x, y, rot=r, collide=(1.1, 0.7, 0.44))
    for (x, y, r) in ((6.0, 39.3, 0.4), (8.2, 40.9, 2.8), (10.2, 39.4, 1.1), (12.0, 41.6, -2.0), (14.8, 39.2, 0.5)):
        L('dining_chair_02', x, y, r=r, kg=5)
    prop('CoffeeCart_01', 15.0, 41.4, rot=-math.pi / 2)
    D('vintage_microwave', 6.0, 43.1, z=0.95, r=math.pi)
    L('pot_enamel_01', 9.0, 43.0, z=0.95, kg=1, sf='metal')
    # the theatre: the table, the lamp over it, the trolleys, the drain
    box((21.0, 40.2, 0), (23.0, 41.0, 0.9), 'steel', pen=True, tag='counter', density=0.4)
    box((20.9, 40.1, 0.9), (23.1, 41.1, 0.95), 'plastic_black', collide=False, density=0.4)
    box((21.92, 40.5, 0), (22.08, 40.66, 0.05), 'grate', collide=False, density=0.1)
    box((21.7, 40.4, 2.6), (22.3, 41.0, 2.75), 'steel', collide=False, density=0.2)
    box((21.97, 40.67, 2.75), (22.03, 40.73, H1), 'steel', collide=False, density=0.1)
    light('spot', (22.0, 40.6, 2.55), (0.86, 0.96, 1.0), 130, spot=1.4, blend=0.6, radius=0.25, aim=(0, 0, -1), flicker=0.35)
    prop('industrial_storage_cart', 18.4, 42.6, rot=0.0, collide=(0.8, 0.55, 0.6))
    prop('metal_tool_chest', 26.8, 43.3, rot=math.pi)
    L('wheelchair_01', 25.6, 39.6, r=2.0, kg=14, sf='metal')
    D('medical_box', 22.6, 40.6, z=0.95, r=0.2)
    stains((22.3, 40.5, 0.96, 0, 0, 1, 1.0), (22.0, 41.6, 0.0, 0, 0, 1, 2.0), (20.2, Y1 - 0.18, 1.3, 0, -1, 0, 1.6), (16.12, 41.8, 1.0, 1, 0, 0, 1.2))
    # the chapel: pews, an altar, candles that someone lit
    for row in range(5):
        for side in (-1, 1):
            prop('painted_wooden_bench', 36.0 + side * 2.6, 39.4 + row * 0.95, rot=math.pi, collide=(0.6, 0.27, 0.45), scale=1.0)
            prop('painted_wooden_bench', 36.0 + side * 3.75, 39.4 + row * 0.95, rot=math.pi, collide=(0.6, 0.27, 0.45))
    box((34.4, 43.0, 0), (37.6, 43.7, 0.95), 'planks', pen=True, tag='counter', density=0.5)
    box((34.3, 42.95, 0.95), (37.7, 43.75, 1.0), 'wood_top', collide=False, density=0.4)
    box((35.9, 43.82, 1.4), (36.1, 43.86, 2.9), 'wood_top', collide=False, density=0.2)
    box((35.4, 43.82, 2.3), (36.6, 43.86, 2.5), 'wood_top', collide=False, density=0.2)
    for (x, p) in ((34.8, 1.6), (37.2, 1.4), (36.0, 1.2)):
        box((x - 0.03, 43.3, 1.0), (x + 0.03, 43.36, 1.16), 'candle', collide=False, density=0.05)
        light('point', (x, 43.33, 1.24), (1.0, 0.55, 0.22), p, radius=0.02, flicker=0.12)
    D('wooden_lantern_01', 30.0, 43.2, r=0.4)
    L('vintage_suitcase', 40.8, 39.0, r=0.7, kg=6, sf='bag')
    stains((36.0, 38.6, 0.0, 0, 0, 1, 1.2))
    # the morgue: the cold wall, two tables, the sheet still on one
    for i in range(4):
        x = 45.2 + i * 1.0
        for k in range(3):
            box((x, Y1 - 1.0, 0.15 + k * 0.8), (x + 0.9, Y1 - 0.98, 0.85 + k * 0.8), 'steel', collide=False, density=0.2)
            box((x + 0.3, Y1 - 1.06, 0.45 + k * 0.8), (x + 0.6, Y1 - 1.0, 0.52 + k * 0.8), 'steel', collide=False, density=0.1)
    box((45.1, Y1 - 1.0, 0), (49.1, Y1 - 0.1, 2.6), 'steel', density=0.3)
    box((45.1 + 1.0 * 2, Y1 - 3.0, 0.0), (45.1 + 1.0 * 2 + 0.9, Y1 - 1.0, 0.9), 'steel', pen=True, tag='counter', density=0.3)   # a drawer left out
    for (x, y) in ((52.0, 40.5), (55.4, 40.5)):
        box((x - 0.45, y - 1.0, 0), (x + 0.45, y + 1.0, 0.86), 'steel', pen=True, tag='counter', density=0.4)
        box((x - 0.04, y - 0.04, 0.86), (x + 0.04, y + 0.04, 0.88), 'grate', collide=False, density=0.1)
    box((51.5, 39.6, 0.86), (52.5, 41.5, 1.06), 'sheet', collide=False, density=0.3)
    box((51.62, 39.62, 1.06), (52.38, 40.0, 1.14), 'sheet', collide=False, density=0.3)
    tube(53.6, 40.5, H1, 34, along='y', flick=1.0)
    stains((55.4, 40.2, 0.87, 0, 0, 1, 0.9), (54.0, 42.0, 0.0, 0, 0, 1, 1.8), (57.88, 40.0, 1.0, -1, 0, 0, 1.3))
    # service: the freight lift, dead, its doors half open
    box((64.0, Y1 - 2.6, 0), (64.12, Y1 - 0.2, 3.3), 'wall_conc', tag='int', density=0.3)
    box((67.88, Y1 - 2.6, 0), (68.0, Y1 - 0.2, 3.3), 'wall_conc', tag='int', density=0.3)
    box((64.0, Y1 - 2.7, 2.6), (68.0, Y1 - 2.6, 3.3), 'steel', density=0.3)
    box((64.12, Y1 - 2.68, 0), (65.2, Y1 - 2.6, 2.6), 'steel', density=0.3)
    box((66.8, Y1 - 2.68, 0), (67.88, Y1 - 2.6, 2.6), 'steel', density=0.3)
    prop('hand_truck', 60.4, 42.9, rot=0.4)
    L('wooden_crate_02', 59.4, 39.4, r=0.3, kg=20)
    L('plastic_crate_01', 61.6, 39.0, r=1.2, kg=1.5, sf='plastic')
    prop('power_box_01', 58.3, 42.0, z=1.2, rot=math.pi / 2, part='power_box_01_box', collide=False)

    # ---- the corridors: a gurney, chairs, the signs over the doors
    L('industrial_storage_cart', 20.0, 21.2, r=1.57 + 0.15, kg=40, sf='metal')
    L('wheelchair_01', 44.0, 21.4, r=0.8, kg=14, sf='metal')
    L('WetFloorSign_01', 12.5, 21.0, r=1.0, kg=1.2, sf='plastic')
    L('plastic_monobloc_chair_01', 60.2, 21.7, r=-0.4, kg=2.5, sf='plastic')
    L('plastic_monobloc_chair_01', 61.0, 21.8, r=0.1, kg=2.5, sf='plastic')
    L('trashbag', 30.6, 36.2, kg=7, sf='bag')
    L('metal_trash_can', 15.1, 37.6, kg=6, sf='metal', shape='cyl', part='metal_trash_can')
    L('wheelchair_01', 27.0, 36.6, r=-2.5, kg=14, sf='metal')
    L('korean_fire_extinguisher_01', 41.6, 37.7, kg=6, sf='metal', shape='cyl')
    L('korean_fire_extinguisher_01', 15.6, 20.3, kg=6, sf='metal', shape='cyl')
    D('fire_alarm', 23.0, NY1 - 0.1, z=1.4, r=math.pi)
    D('wall_clock', 47.0, SY1 - 0.1, z=2.4, r=math.pi)
    for x in (10.0, 30.0, 50.0, 62.0):
        emerg(x, SY1 - 0.12, 2.75, 3.5)
    for x in (10.0, 36.0, 60.0):
        emerg(x, NY0 + 0.12, 2.75, 3.5)
    emerg(WX0 + 1.2, MY, 2.75, 2.5)
    emerg(EX0 + 1.2, MY, 2.75, 2.5)
    for x, p, f, lit in ((8.0, 0, 0, False), (18.0, 0, 0, False), (24.0, 26, 0.9, True), (40.0, 0, 0, False), (52.0, 0, 0, False), (60.0, 0, 0, False)):
        tube(x, (SY0 + SY1) / 2, H1, p, flick=f, lit=lit)
    for x, p, f, lit in ((8.0, 0, 0, False), (20.0, 0, 0, False), (32.0, 0, 0, False), (48.0, 24, 0.7, True), (58.0, 0, 0, False)):
        tube(x, (NY0 + NY1) / 2, H1, p, flick=f, lit=lit)
    stains((24.0, 21.0, 0.0, 0, 0, 1, 1.4), (24.8, SY1 - 0.08, 0.9, 0, -1, 0, 1.6), (48.0, 36.6, 0.0, 0, 0, 1, 1.2), (WX0 + 0.08, 30.0, 1.0, 1, 0, 0, 1.1), (EX1 - 0.08, 24.4, 1.3, -1, 0, 0, 1.2))
    # smears where something was dragged
    for i in range(6):
        stains((26.0 + i * 0.7, 21.0 + i * 0.05, 0.0, 0, 0, 1, 0.7))

    # ================= upstairs =================
    Z = F2
    H2 = TOP - F2
    holes = [door('x', SY0, X0 + 4.5, Z), door('x', SY0, 13.0, Z), door('x', SY0, 19.0, Z), door('x', SY0, 26.0, Z),
             door('x', SY0, 46.0, Z, swing=-1), door('x', SY0, 53.0, Z, swing=-1), door('x', SY0, 59.0, Z, swing=-1), door('x', SY0, X1 - 4.5, Z, swing=-1)]
    wall('x', SY0, X0, LX0, Z, TOP, INT_T, 'wall_int', holes=[h for h in holes if h[1] < LX0], pen=True, tag='int')
    wall('x', SY0, LX1, X1, Z, TOP, INT_T, 'wall_int', holes=[h for h in holes if h[0] > LX1], pen=True, tag='int')
    for x in (16.0, 22.0, 49.5, 56.0):
        wall('y', x, Y0, SY0, Z, TOP, INT_T, 'wall_int', pen=True, tag='int')
    wall('y', X0 + 6.0, Y0, SY0, Z, TOP, INT_T, 'wall_int', pen=True, tag='int')
    wall('y', X1 - 6.0, Y0, SY0, Z, TOP, INT_T, 'wall_int', pen=True, tag='int')
    holes = [door('x', SY1, 9.0, Z), door('x', SY1, 22.0, Z, swing=-1)]
    wall('x', SY1, X0, CX0, Z, TOP, INT_T, 'wall_int', holes=holes, pen=True, tag='int')
    holes = [door('x', SY1, 50.0, Z), door('x', SY1, 63.0, Z, swing=-1)]
    wall('x', SY1, CX1, X1, Z, TOP, INT_T, 'wall_int', holes=holes, pen=True, tag='int')
    holes = [door('x', NY0, 12.0, Z), door('x', NY0, 24.0, Z)]
    wall('x', NY0, X0, CX0, Z, TOP, INT_T, 'wall_int', holes=holes, pen=True, tag='int')
    holes = [door('x', NY0, 48.0, Z), door('x', NY0, 64.0, Z)]
    wall('x', NY0, CX1, X1, Z, TOP, INT_T, 'wall_int', holes=holes, pen=True, tag='int')
    holes = [door('x', NY1, 10.0, Z, swing=-1), door('x', NY1, 22.0, Z, swing=-1), door('x', NY1, 31.0, Z, swing=-1), door('x', NY1, 41.0, Z, swing=-1),
             door('x', NY1, 51.0, Z, swing=-1), door('x', NY1, 63.0, Z, swing=-1)]
    wall('x', NY1, X0, X1, Z, TOP, INT_T, 'wall_int', holes=holes, pen=True, tag='int')
    for x in (16.0, 28.0, 44.0, 58.0):
        wall('y', x, NY1, Y1, Z, TOP, INT_T, 'wall_int', pen=True, tag='int')
    room('scor2', X0, SY0, X1, SY1, Z, H2, 'hosp_wall', 'hlino')
    room('ncor2', X0, NY0, X1, NY1, Z, H2, 'hosp_wall', 'hlino')
    for (a, b, w, f) in (((X0 + 6, Y0), (16, SY0), 'hosp_wall2', 'hlino'), ((16, Y0), (22, SY0), 'wall_paper', 'hlino'), ((22, Y0), (LX0, SY0), 'hosp_wall2', 'hlino'),
                         ((LX1, Y0), (49.5, SY0), 'hosp_wall2', 'hlino'), ((49.5, Y0), (56, SY0), 'hosp_wall2', 'hlino'), ((56, Y0), (X1 - 6, SY0), 'wall_paper', 'hlino'),
                         ((X0, SY1), (CX0, NY0), 'hosp_wall', 'hlino'), ((CX1, SY1), (X1, NY0), 'hosp_wall2', 'hlino'),
                         ((X0, NY1), (16, Y1), 'wall_beige', 'carpet'), ((16, NY1), (28, Y1), 'dconc', 'conc'), ((28, NY1), (44, Y1), 'hosp_wall', 'hlino'),
                         ((44, NY1), (58, Y1), 'wall_paper', 'carpet'), ((58, NY1), (X1, Y1), 'dconc', 'conc')):
        room('up', a[0], a[1], b[0], b[1], Z, H2, w, f)
    # the patient rooms over the street: a bed each, the odd chair
    for (x, r) in ((13.0, 0.1), (19.0, -0.2), (26.0, 0.0), (46.0, 0.3), (53.0, 0.0), (59.0, -0.1)):
        K(f'hbed_{int(x * 3)}', x - 1.2, Y0 + 1.25, z=Z, r=math.pi + r, solid=(0.48, 1.04, 0.7))
        if R.random() < 0.7:
            K('iv', x - 2.0, Y0 + 0.8, z=Z, r=R.uniform(0, 6), solid=(0.25, 0.25, 1.9))
        K(f'curtain_{int(x * 5)}', x - 1.2, Y0 + 2.8, z=TOP)
        D('ClassicNightstand_01', x + 0.1, Y0 + 0.4, z=Z, r=R.uniform(-0.3, 0.3))
        if R.random() < 0.6:
            L('SchoolChair_01', x + 1.4, 17.8, z=Z, r=R.uniform(0, 6), kg=6)
    stains((19.4, Y0 + 1.2, Z + 0.62, 0, 0, 1, 0.8), (21.88, 16.6, Z + 1.0, -1, 0, 0, 1.4), (53.0, 18.4, Z, 0, 0, 1, 1.5))
    light('point', (26.0, 17.5, TOP - 0.5), WARM, 4, radius=0.05, flicker=0.6)
    D('pull_chain_light_socket', 26.0, 17.5, z=TOP - 0.02)
    # ward C: two rows of beds in the long room
    for i in range(6):
        for (y, r) in ((23.8, 0.0), (34.2, math.pi)):
            x = 6.0 + i * 3.6
            if (i, y) in ((2, 34.2), (4, 23.8)):
                continue
            prop('old_bed_frame', x, y, z=Z, rot=r + R.uniform(-0.15, 0.15), collide=(0.5, 1.05, 0.3))
    for i in range(3):
        tube(8.0 + i * 8.0, 29.0, TOP, 0, lit=False)
    L('wheelchair_01', 15.4, 29.0, z=Z, r=0.6, kg=14, sf='metal')
    L('industrial_storage_cart', 22.6, 28.4, z=Z, r=1.2, kg=40, sf='metal')
    stains((13.2, 29.4, Z, 0, 0, 1, 1.6), (6.0, 34.1, Z + 0.62, 0, 0, 1, 0.8))
    light('point', (23.0, 25.0, TOP - 0.3), TUBE, 6, radius=0.05, flicker=0.9)
    # ward D: the floor that went
    for i in range(6):
        for (y, r) in ((23.8, 0.0), (34.2, math.pi)):
            x = 46.0 + i * 3.6
            if HOLE[0] - 1 < x < HOLE[2] + 1 and y < 30:
                continue
            prop('old_bed_frame', x, y, z=Z, rot=r + R.uniform(-0.2, 0.2), collide=(0.5, 1.05, 0.3))
    m.rail('x', HOLE[1] - 0.05, HOLE[0] - 0.4, HOLE[2] + 0.4, F2, h=0.9, mat='planks')
    L('SchoolChair_01', 56.0, 30.0, z=Z, r=1.0, kg=6)
    light('point', (60.0, 29.0, TOP - 0.3), TUBE, 5, radius=0.05, flicker=0.7)
    # upstairs north: offices and a long ward
    prop('metal_office_desk', 9.0, 41.0, z=Z, rot=0.1, part='metal_office_desk')
    prop('wooden_bookshelf_worn', 5.0, 41.0, z=Z, rot=math.pi / 2)
    L('SchoolChair_01', 9.4, 40.2, z=Z, r=0.4, kg=6)
    for x in (18.0, 20.0, 22.0, 24.0, 26.0):
        prop('worn_metal_rack', x, Y1 - 0.4, z=Z, rot=math.pi)
    for i in range(4):
        prop('old_bed_frame', 30.0 + i * 3.8, 42.8, z=Z, rot=math.pi + R.uniform(-0.2, 0.2), collide=(0.5, 1.05, 0.3))
    prop('metal_office_desk', 50.0, 41.4, z=Z, rot=math.pi, part='metal_office_desk')
    prop('drawer_cabinet', 56.4, 43.4, z=Z, rot=math.pi, part='drawer_cabinet')
    L('cardboard_box_01', 61.0, 42.0, z=Z, r=0.6, kg=4, sf='card')
    L('cardboard_box_01', 61.4, 42.5, z=Z, r=1.4, kg=4, sf='card')
    stains((36.0, 40.4, Z, 0, 0, 1, 1.4))
    for x in (10.0, 30.0, 50.0, 62.0):
        emerg(x, SY1 - 0.12, Z + 2.9, 2.5)
    for x in (12.0, 36.0, 60.0):
        emerg(x, NY0 + 0.12, Z + 2.9, 2.5)
    for x in (8.0, 20.0, 46.0, 56.0):
        tube(x, (SY0 + SY1) / 2, TOP, 0, lit=False)
    for x in (16.0, 28.0, 40.0, 52.0):
        tube(x, (NY0 + NY1) / 2, TOP, 0, lit=False)
    L('trashbag', 47.0, 36.4, z=Z, kg=7, sf='bag')
    L('plastic_monobloc_chair_01', 26.0, 21.6, z=Z, r=2.1, kg=2.5, sf='plastic')

    # ================= under: the service tunnel and what opens off it =================
    TX0, TX1 = X0 + 6.0, X1 - 6.0
    under((TX0, Y0 - 0.2, BZ - 0.3), (TX1, SY1 + 0.2, BZ), 'conc')
    box((48.0, Y0, BZ - 0.3), (TX1, SY0, BZ + 0.02), 'conc_wet', tag='under', collide=False, density=0.5)
    under((TX0, Y0 - 0.2, BZ), (TX1, Y0, -0.3))
    under((X0 - 0.2, SY1, BZ), (X1 + 0.2, SY1 + 0.2, -0.3))
    under((X0 - 0.2, SY0, BZ - 0.3), (TX0, SY1, BZ), 'conc')
    under((TX1, SY0, BZ - 0.3), (X1 + 0.2, SY1, BZ), 'conc')
    under((X0 - 0.2, SY0, BZ), (X0, SY1, -0.3))
    under((X1, SY0, BZ), (X1 + 0.2, SY1, -0.3))
    # the ceiling, low in the tunnel where the pipes run
    under((X0, Y0, -0.32), (X1, SY0, -0.3), 'ceil', collide=False)
    under((X0, SY0, BC - 0.02), (X1, SY1, BC), 'wall_conc', collide=False)
    # the tunnel's south wall: a door for each room
    holes = [(X0 + 4.4, X0 + 5.9, BZ, BZ + 2.2), door('x', SY0, 17.0, BZ, kind='steel'), door('x', SY0, 29.0, BZ, kind='steel'), (38.0, 40.2, BZ, BZ + 2.3),
             door('x', SY0, 52.0, BZ, kind='steel', swing=-1), (X1 - 5.9, X1 - 4.4, BZ, BZ + 2.2)]
    hs = sorted(holes)
    cur = X0
    for (a, b, h0, h1) in hs:
        under((cur, SY0 - 0.1, BZ), (a, SY0 + 0.1, -0.3))
        under((a, SY0 - 0.1, h1), (b, SY0 + 0.1, -0.3))
        cur = b
    under((cur, SY0 - 0.1, BZ), (X1, SY0 + 0.1, -0.3))
    for x in (22.0, 34.0, 46.0):
        under((x - 0.1, Y0, BZ), (x + 0.1, SY0 - 0.1, -0.3))
    room('tunnel', X0, SY0, X1, SY1, BZ, -0.3 - BZ, 'dconc', 'conc')
    room('boiler', TX0, Y0, 22, SY0, BZ, -0.3 - BZ, 'dconc', 'conc')
    room('plant', 22, Y0, 34, SY0, BZ, -0.3 - BZ, 'dconc', 'conc')
    room('cold', 34, Y0, 46, SY0, BZ, -0.3 - BZ, 'wtile', 'mtile')
    room('flood', 46, Y0, TX1, SY0, BZ, -0.3 - BZ, 'wall_conc', 'conc_wet')
    m.zones.append(dict(a=(X0, Y0, BZ - 0.3), b=(X1, SY1, -0.3), kind='small'))
    # pipes along the tunnel
    m.hpipe(TX0 + 0.5, TX1 - 0.5, SY1 - 0.35, BC - 0.35)
    m.hpipe(TX0 + 0.5, TX1 - 0.5, SY1 - 0.75, BC - 0.3)
    m.hpipe(TX0 + 0.5, TX1 - 0.5, SY0 + 0.4, BC - 0.25)
    for x in (16.0, 40.0, 56.0):
        emerg(x, SY1 - 0.12, BZ + 2.45, 3.0)
    for x in (24.0, 46.0):
        prop('caged_hanging_light', x, (SY0 + SY1) / 2, z=BC - 0.75, collide=False)
    light('point', (24.0, (SY0 + SY1) / 2, BC - 0.6), WARM, 5, radius=0.05, flicker=0.45)
    # boiler room: the plant itself
    box((12.4, 15.0, BZ), (16.4, 17.6, BZ + 2.4), 'ruststeel', density=0.3)
    box((12.2, 14.8, BZ + 2.4), (16.6, 17.8, BZ + 2.6), 'steel', collide=False, density=0.2)
    box((14.0, 15.9, BZ + 2.6), (14.6, 16.5, -0.3), 'ruststeel', collide=False, density=0.2)
    prop('old_military_compressor', 19.6, 15.6, z=BZ, rot=0.0)
    prop('portable_generator', 18.4, 19.0, z=BZ, rot=1.0)
    L('propane_tank', 20.8, 19.2, z=BZ, kg=14, sf='metal', shape='cyl')
    L('metal_jerrycan', 11.0, 19.1, z=BZ, r=1.2, kg=8, sf='metal')
    light('point', (14.4, 18.4, BZ + 0.7), (1.0, 0.36, 0.1), 7, radius=0.1, flicker=0.25)       # the pilot, still lit
    # the plant room: switchgear, a desk, a cot someone slept on
    for x in (23.0, 24.2, 25.4):
        box((x, Y0 + 0.05, BZ), (x + 1.1, Y0 + 0.7, BZ + 2.1), 'steel', density=0.3)
    prop('metal_office_desk', 31.0, 18.8, z=BZ, rot=math.pi, part='metal_office_desk')
    prop('old_bed_frame', 32.6, 15.8, z=BZ, rot=0.0, collide=(0.5, 1.05, 0.3))
    L('trashbag', 29.0, 15.2, z=BZ, kg=7, sf='bag')
    L('russian_food_cans_01', 31.0, 18.8, z=BZ + 0.79, kg=1, sf='metal')
    D('wooden_lantern_01', 30.4, 18.6, z=BZ + 0.79, r=0.6)
    light('point', (30.4, 18.6, BZ + 1.1), (1.0, 0.6, 0.28), 3.5, radius=0.03, flicker=0.15)
    stains((32.6, 15.4, BZ + 0.62, 0, 0, 1, 0.9))
    # the cold store: shelves of drawers, a table, a drain
    for x in (35.0, 37.0, 39.0, 41.0, 43.0):
        box((x, Y0 + 0.05, BZ), (x + 1.8, Y0 + 0.9, BZ + 2.4), 'steel', density=0.3)
        for k in range(3):
            box((x + 0.1, Y0 + 0.9, BZ + 0.2 + k * 0.75), (x + 1.7, Y0 + 0.92, BZ + 0.85 + k * 0.75), 'steel', collide=False, density=0.15)
    box((39.4, 16.8, BZ), (40.4, 18.8, BZ + 0.88), 'steel', pen=True, tag='counter', density=0.3)
    box((39.45, 16.9, BZ + 0.88), (40.35, 18.7, BZ + 1.1), 'sheet', collide=False, density=0.3)
    box((39.6, 17.8, BZ), (39.76, 17.96, BZ + 0.02), 'grate', collide=False, density=0.1)
    tube(40.0, 17.6, -0.32, 22, along='y', flick=1.0)
    stains((40.4, 18.0, BZ, 0, 0, 1, 2.2), (34.12, 17.0, BZ + 1.0, 1, 0, 0, 1.3), (39.9, 17.2, BZ + 1.11, 0, 0, 1, 0.6))
    # the flooded store: crates and boxes standing in black water
    for (x, y, r) in ((49.0, 15.4, 0.2), (51.6, 15.2, 0.0), (55.0, 15.6, 0.4), (58.4, 16.2, 1.2)):
        prop('wooden_crate_02', x, y, z=BZ, rot=r)
    prop('wooden_crate_01', 53.0, 18.6, z=BZ, rot=0.5)
    L('cardboard_box_01', 57.2, 18.4, z=BZ, r=0.4, kg=4, sf='card')
    L('plastic_crate_01', 50.4, 18.8, z=BZ, r=1.0, kg=1.5, sf='plastic')
    for i in range(10):
        box((46.4 + i * 1.2, SY0 - 0.12, -1.0), (46.44 + i * 1.2, SY0 - 0.1, -0.3), 'ruststeel', collide=False, density=0.05)
    light('point', (56.0, 17.4, -0.6), (0.4, 0.55, 0.8), 2.5, radius=0.05)

    # ================= the courtyard: what grew, a fountain, the rain =================
    box((CX0, SY1, -0.5), (CX1, NY0, 0.0), 'yard', tag='ground', density=0.55)
    for (a, b) in (((CX0 + 0.3, SY1 + 0.3), (CX0 + 4.4, NY0 - 0.3)), ((CX1 - 4.4, SY1 + 0.3), (CX1 - 0.3, NY0 - 0.3))):
        box((a[0], a[1], 0.0), (b[0], b[1], 0.08), 'ter_dirt', collide=False, density=0.4)
        box((a[0] - 0.12, a[1] - 0.12, 0.0), (b[0] + 0.12, a[1], 0.22), 'stone', collide=False, density=0.2)
        box((a[0] - 0.12, b[1], 0.0), (b[0] + 0.12, b[1] + 0.12, 0.22), 'stone', collide=False, density=0.2)
    cx, cy = 36.0, 29.0
    for (a, b) in (((cx - 2.0, cy - 2.0), (cx + 2.0, cy - 1.7)), ((cx - 2.0, cy + 1.7), (cx + 2.0, cy + 2.0)), ((cx - 2.0, cy - 1.7), (cx - 1.7, cy + 1.7)), ((cx + 1.7, cy - 1.7), (cx + 2.0, cy + 1.7))):
        box((a[0], a[1], 0.0), (b[0], b[1], 0.55), 'stone', pen=True, density=0.3)
    box((cx - 1.7, cy - 1.7, 0.0), (cx + 1.7, cy + 1.7, 0.18), 'conc_wet', collide=False, density=0.3)
    box((cx - 0.25, cy - 0.25, 0.0), (cx + 0.25, cy + 0.25, 1.5), 'stone', density=0.3)
    box((cx - 0.6, cy - 0.6, 1.5), (cx + 0.6, cy + 0.6, 1.7), 'stone', collide=False, density=0.3)
    prop('dead_tree_trunk', 31.0, 25.8, rot=0.6)
    prop('painted_wooden_bench', 36.0, 24.0, rot=0.0, collide=(0.6, 0.27, 0.45))
    prop('painted_wooden_bench', 36.0, 34.0, rot=math.pi, collide=(0.6, 0.27, 0.45))
    for (x, y) in ((30.0, 30.5), (31.6, 33.2), (41.2, 25.0), (42.2, 31.0), (29.5, 23.6), (40.6, 34.4)):
        D('nettle_plant', x, y, z=0.08, r=R.uniform(0, 6))
        D('weed_plant_02', x + 0.6, y - 0.5, z=0.08, r=R.uniform(0, 6))
    D('moss_01', 37.0, 28.0, z=0.18)
    L('wheelchair_01', 40.0, 27.2, r=2.6, kg=14, sf='metal')
    L('metal_trash_can', 32.6, 34.6, kg=6, sf='metal', shape='cyl', part='metal_trash_can')

    # ================= the grounds =================
    # the car park: an ambulance nobody came back for, cars under sheets, a fire in a drum
    prop('covered_car', 22.0, 4.0, rot=0.1, part=None)
    prop('covered_car', 52.0, 3.6, rot=-0.05, part=None)
    prop('covered_car', -4.0, 2.0, rot=1.4, part=None)
    prop('covered_car', 76.0, 6.0, rot=1.65, part=None)
    # the ambulance: a box on a cab, its back doors open
    AX, AY = 44.0, 8.6
    box((AX - 1.1, AY - 3.1, 0.35), (AX + 1.1, AY + 0.6, 2.75), 'ambulance', density=0.4)
    box((AX - 1.0, AY + 0.6, 0.35), (AX + 1.0, AY + 2.4, 1.85), 'ambulance', density=0.4)
    box((AX - 0.95, AY + 1.4, 1.2), (AX + 0.95, AY + 2.35, 1.82), 'darkwin', collide=False, density=0.2)
    box((AX - 1.12, AY - 2.0, 1.4), (AX + 1.12, AY - 1.4, 1.75), 'paint_r', collide=False, density=0.2)
    for (x, y) in ((AX - 1.0, AY - 2.2), (AX + 1.0, AY - 2.2), (AX - 1.0, AY + 1.6), (AX + 1.0, AY + 1.6)):
        box((x - 0.14, y - 0.4, 0), (x + 0.14, y + 0.4, 0.75), 'plastic_black', collide=False, density=0.2)
    box((AX - 1.1, AY - 3.3, 0.5), (AX - 1.0, AY - 3.1, 2.6), 'ambulance', collide=False, density=0.2)
    box((AX - 1.9, AY - 3.2, 0.5), (AX - 1.1, AY - 3.12, 2.6), 'ambulance', density=0.2)
    box((AX + 1.1, AY - 3.2, 0.5), (AX + 1.9, AY - 3.12, 2.6), 'ambulance', density=0.2)
    light('point', (AX, AY - 1.0, 2.5), (0.9, 0.95, 1.0), 6, radius=0.1, flicker=0.6)
    stains((AX, AY - 1.2, 0.36, 0, 0, 1, 1.2), (AX - 0.3, AY - 4.0, 0.0, 0, 0, 1, 1.5))
    for (x, y, r) in ((14.0, 9.0, 0.0), (17.0, 9.4, 0.1), (60.0, 9.0, -0.1), (63.0, 8.8, 0.0)):
        prop('concrete_road_barrier', x, y, rot=r)
    # the drum
    BX, BY = 30.0, 9.0
    prop('barrel_03', BX, BY, rot=0.3)
    light('point', (BX, BY, 1.25), (1.0, 0.42, 0.12), 60, radius=0.25, flicker=0.2)
    for (x, y, r) in ((BX + 1.2, BY + 0.5, 1.2), (BX - 1.0, BY + 1.0, 2.5)):
        L('plastic_monobloc_chair_01', x, y, r=r, kg=2.5, sf='plastic')
    L('trashbag', BX + 1.8, BY - 0.8, kg=7, sf='bag')
    # the lamp in the car park, and the one that's out
    prop('street_lamp_01', 8.0, 11.0, rot=0.0)
    light('spot', (8.0, 11.5, 6.1), SODIUM, 900, spot=2.3, blend=0.85, radius=0.15, aim=(0.25, 0.05, -1))
    prop('street_lamp_01', 64.0, 11.0, rot=0.0)
    # security lights over the side doors
    for (x, y, a) in ((X0 - 0.2, (NY0 + NY1) / 2, (-0.6, 0, -0.8)), (X1 + 0.2, (SY0 + SY1) / 2, (0.6, 0, -0.8))):
        prop('security_light', x, y, z=3.0, rot=math.pi / 2 if x < 30 else -math.pi / 2, part='security_light', collide=False)
        light('spot', (x + (-0.3 if x < 30 else 0.3), y, 2.9), (0.9, 0.95, 1.0), 160 if x < 30 else 0.0001, spot=2.0, blend=0.8, radius=0.08, aim=a)
    light('spot', (X1 + 0.5, 41.0, 3.4), (1.0, 0.72, 0.4), 220, spot=2.2, blend=0.8, radius=0.1, aim=(0.5, -0.2, -0.8), flicker=0.5)
    # the yards: skips, pallets, a wall of containers by the east fence
    for (x, y) in ((-6.0, 30.0), (78.0, 34.0)):
        box((x - 1.0, y - 2.0, 0), (x + 1.0, y + 2.0, 1.5), 'dumpster', density=0.4)
    m.container(76.0, 16.0, 0.0, rot90=True, tint='cont_b')
    m.container(-12.0, 40.0, 0.0, rot90=True, tint='cont_a')
    for (x, y, r) in ((-2.0, 24.0, 0.2), (72.0, 26.0, 1.4), (1.0, 46.0, 0.6), (70.0, 46.0, 2.2)):
        prop('wooden_crate_02', x, y, rot=r)
    for (x, y) in ((-8.0, 20.0), (80.0, 44.0), (20.0, 50.0), (50.0, 52.0)):
        L('trashbag', x, y, kg=7, sf='bag')
        L('trashbag', x + 0.6, y + 0.3, r=1.0, kg=7, sf='bag')
    prop('old_tyre', -5.0, 44.0, rot=0.5)
    prop('utility_box_01', 66.0, 50.0, rot=0.0)
    prop('power_box_01', 6.0, Y1 + 0.3, z=1.0, rot=math.pi, part='power_box_01_box', collide=False)
    # cover across the north strip
    for (x, y) in ((20.0, 49.0), (36.0, 48.0), (52.0, 49.5)):
        box((x - 1.2, y - 0.4, 0), (x + 1.2, y + 0.4, 1.05), 'stone', density=0.3)

    # ---- what fell and what was dropped: ceiling tiles hanging, papers, the signs over the corridors
    for (x, y) in ((11.5, 21.0), (27.0, 21.5), (47.5, 20.8), (63.0, 21.6), (18.0, 37.2), (39.0, 36.6), (56.6, 37.0), (15.2, 26.0), (56.8, 31.5)):
        K(f'tile_{int(x * 7 + y)}', x, y, z=H1, r=R.uniform(0, 6.28))
    for (x, y) in ((24.0, 36.8), (52.0, 21.0), (WX0 + 1.2, 33.0)):
        K(f'tile_{int(x * 3 + y)}', x, y, z=H1, r=R.uniform(0, 6.28))
    for (x, y) in ((9.0, 34.0), (60.0, 36.8)):
        K(f'tile_{int(x + y)}', x, y, z=TOP, r=R.uniform(0, 6.28))
    for (x, y, z) in ((25.0, 17.0, 0.0), (13.0, 21.0, 0.0), (45.0, 21.4, 0.0), (26.0, 36.8, 0.0), (8.0, 26.6, 0.0), (52.0, 24.0, 0.0), (40.0, 41.0, 0.0),
                      (22.0, 21.0, F2), (54.0, 36.8, F2), (9.0, 41.6, F2), (30.0, 21.0, BZ), (60.0, 16.2, BZ), (62.0, 30.6, 0.0), (36.0, 16.0, 0.0)):
        K(f'litter_{int(x * 11 + y * 3 + z)}', x, y, z=z, r=R.uniform(0, 6.28))
    for x in (12.0, 26.0, 46.0, 60.0):
        K('sign', x, (SY0 + SY1) / 2, z=H1, r=math.pi / 2)
    for x in (14.0, 34.0, 54.0):
        K('sign', x, (NY0 + NY1) / 2, z=H1, r=-math.pi / 2)
    K('iv', 21.0, 36.9, r=1.0, solid=(0.25, 0.25, 1.9))
    K('iv', 51.0, 39.2, r=2.0, solid=(0.25, 0.25, 1.9))
    K('screen', 56.4, 39.0, r=math.pi / 2 + 0.3, solid=(0.95, 0.3, 1.7))
    K(f'hbed_5', 31.0, 21.2, r=math.pi / 2 + 0.25, solid=(0.48, 1.04, 0.7))

    # finishes: a two-tone wall and a dropped ceiling wherever it was a hospital
    for r in m.rooms:
        if r['wall'] in ('hosp_wall', 'hosp_wall2'):
            r['dado'] = ('hosp_dado' if r['wall'] == 'hosp_wall' else 'hosp_dado2', 1.15)
        if r['wall'] in ('hosp_wall', 'hosp_wall2', 'wall_paper', 'wall_beige') and r['a'][2] > BZ + 0.1 and r['name'] != 'lobby':
            r['ceil'] = 'ceil_tile'

    # zones: the lobby echoes; the rest are rooms; the courtyard and grounds are outside
    m.zones.insert(0, dict(a=(LX0, Y0, 0), b=(LX1, SY0, TOP), kind='hall'))
    m.zones.append(dict(a=(X0, Y0, -0.3), b=(CX0, Y1, TOP), kind='small'))
    m.zones.append(dict(a=(CX1, Y0, -0.3), b=(X1, Y1, TOP), kind='small'))
    m.zones.append(dict(a=(CX0, Y0, -0.3), b=(CX1, SY1, TOP), kind='small'))
    m.zones.append(dict(a=(CX0, NY0, -0.3), b=(CX1, Y1, TOP), kind='small'))

    # spawns: each team in its own yard; the free-for-all anywhere
    m.spawns['a'] = [[-4.0, 18.0, 0], [-6.0, 22.0, 0], [-2.0, 27.0, 0], [-8.0, 33.0, 0], [-4.0, 38.0, 0], [-2.0, 43.0, 0], [-9.0, 46.0, 0], [-5.0, 50.0, 0]]
    m.spawns['b'] = [[76.0, 23.0, 0], [74.0, 28.0, 0], [80.0, 30.0, 0], [74.0, 38.0, 0], [79.0, 41.0, 0], [76.0, 47.0, 0], [81.0, 50.0, 0], [72.0, 51.0, 0]]
    m.spawns['ffa'] = m.spawns['a'][:4] + m.spawns['b'][:4] + [[36.0, 2.0, 0], [10.0, 21.2, 0], [62.0, 37.0, 0], [36.0, 31.5, 0], [9.0, 32.0, 0], [49.0, 32.0, 0],
                                                               [12.0, 17.0, F2], [60.0, 17.0, F2], [20.0, 29.0, F2], [36.0, 40.0, F2], [28.0, 17.0, BZ], [56.0, 21.2, BZ], [36.0, 50.0, 0], [16.0, 40.0, 0]]
    m.hold = [[36.0, 17.8, 0], [36.0, 31.0, 0], [40.0, 21.2, BZ]]
    m.sky = SKY
    m.weather = WEATHER
    m.centre = [36.0, -29.0]
    m.attract = [[7.0, 1.5, -21.2], [22.0, 1.5, -21.0]]    # game axes: a slow walk down the south corridor
    # and what everyone left behind
    import clutter
    clutter.trim(m)
    clutter.dress(m, 'hospital', random.Random(41), outside=[(-13.0, -9.0, 85.0, 13.0, 0.0), (-13.0, 14.0, 3.5, 57.0, 0.0), (68.5, 14.0, 85.0, 57.0, 0.0), (4.0, 44.5, 68.0, 57.0, 0.0), (CX0, SY1, CX1, NY0, 0.0)], out_n=90)
    return m


if __name__ == '__main__':
    import sys
    from layout import draw
    m = build()
    print('boxes', len(m.boxes), 'props', len(m.props), 'lights', len(m.lights), 'doors', len(m.doors), 'glass', len(m.glass), 'stains', len(m.stains))
    out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ward'
    draw(m, out + '_g.png', (0.3, 1.6))
    draw(m, out + '_u.png', (F2 + 0.3, F2 + 1.6))
    draw(m, out + '_b.png', (BZ + 0.3, BZ + 1.6))
