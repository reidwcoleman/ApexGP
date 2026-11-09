"""Harrowgate House: a country mansion shut up for decades, on a hill in the rain at night. Same language as layout.py:
metres, x east, y north, z up. All of it is played indoors.

  ground  a two-storey foyer with a stair up each side to a gallery; west of it the drawing room (a fire still in the
          grate), the study and the morning room; east the dining room, the pantry and the gun room; across the long hall
          the library, the ballroom (two storeys, chandeliers, the furniture under dust sheets) and the kitchen
  upper   the gallery and the long hall, bedrooms, the master suite, a nursery, the servants' rooms over the kitchen,
          and a balcony along the long hall that looks down into the ballroom
  cellar  the wine cellar under the library, a brick tunnel under the ballroom, the boiler room under the kitchen; a stair
          down from the library and one from the kitchen, so it's a third way across
Team A starts in the west rooms, team B in the east.
"""
import math, random
from layout import Map, INT_T
from ward_layout import rects_minus

EXT_T = 0.5
F2, TOP, BZ = 4.2, 8.2, -3.2
SLAB = 0.3
H1 = F2 - SLAB
X1, Y1 = 56.0, 36.0
CY0, CY1 = 18.0, 21.0                 # the long hall
FX0, FX1, FY = 20.0, 36.0, 12.0       # the foyer, and the gallery's edge over it
BX0, BX1 = 14.0, 42.0                 # the ballroom

SKY = dict(hdri='rooftop_night', strength=0.8, tint=(0.3, 0.38, 0.55))
WEATHER = dict(key=0.13, rain=1, wet=1, fog=1.3, sky=[0.12, 0.13, 0.18], wb=[0.97, 1.0, 1.04])
VOLUME = dict(step=[2, 1.15, 2], min=[-4, -3.8, -40], dim=[33, 12, 22])

WARM = (1.0, 0.66, 0.36)
CANDLE = (1.0, 0.52, 0.22)
EMBER = (1.0, 0.32, 0.08)
MOON = (0.55, 0.65, 0.9)


def build():
    m = Map()
    m.rng = random.Random(31)
    R = m.rng
    box, wall, door, window, room, prop, light = m.box, m.wall, m.door, m.window, m.room, m.prop, m.light
    m.stains = []

    def D(n, x, y, z=0.0, r=0.0, **k):
        k.setdefault('collide', False)
        prop(n, x, y, z=z, rot=r, **k)

    def L(n, x, y, z=0.0, r=0.0, kg=4, sf='wood', **k):
        m.loose(n, x, y, z=z, rot=r, kg=kg, surf=sf, **k)

    def K(kind, x, y, z=0.0, r=0.0, solid=None):
        m.unit('ward', [kind], x, y, z, rot=r, far=True)
        if solid:
            hx, hy, h = solid
            c, sn = abs(math.cos(r)), abs(math.sin(r))
            m.invisible((x - c * hx - sn * hy, y - sn * hx - c * hy, z), (x + c * hx + sn * hy, y + sn * hx + c * hy, z + h), pen=True)

    def candles(x, y, z, p=2.0):
        K(f'candles_{R.randint(1, 9)}', x, y, z + 0.001, R.uniform(0, 6.28))
        light('point', (x, y, z + 0.3), CANDLE, p, radius=0.04, flicker=0.14)

    # ================= outside: a gravel sweep, dead trees, a dry fountain; only seen through the windows =================
    for r in rects_minus(-40, -40, 96, 76, [(0, 0, X1, Y1)]):
        box((r[0], r[1], -1), (r[2], r[3], 0), 'yard', tag='ground', density=0.4)
    for (a, b) in (((24.0, -14.0), (32.0, -13.6)), ((24.0, -6.4), (32.0, -6.0)), ((24.0, -13.6), (24.4, -6.4)), ((31.6, -13.6), (32.0, -6.4))):
        box((a[0], a[1], 0), (b[0], b[1], 0.7), 'stone', density=0.2)
    box((27.6, -10.4, 0), (28.4, -9.6, 2.2), 'stone', density=0.2)
    box((27.0, -11.0, 2.2), (29.0, -9.0, 2.4), 'stone', collide=False, density=0.2)
    for i in range(40):
        a = i / 40 * 6.283
        x, y = 28 + math.cos(a) * 46 * R.uniform(0.9, 1.1), 18 + math.sin(a) * 36 * R.uniform(0.9, 1.1)
        prop('dead_tree_trunk', x, y, rot=R.uniform(0, 6), scale=R.uniform(1.3, 2.2), collide=False)
    prop('covered_car', 40.0, -12.0, rot=0.4, part=None)
    for x in (22.0, 34.0):
        box((x - 0.4, -20.4, 0), (x + 0.4, -19.6, 2.6), 'cbrick', density=0.2)
        box((x - 0.5, -20.5, 2.6), (x + 0.5, -19.5, 2.8), 'stone', collide=False, density=0.2)

    # ================= slabs, roof =================
    LIBH = (1.0, 34.0, 8.0, 35.6)          # the library stair down
    KITH = (44.0, 34.0, 51.0, 35.6)        # the kitchen stair down
    SSH = (52.3, 24.0, 54.0, 34.0)         # the servants' stair up
    for r in rects_minus(0, 0, X1, Y1, [LIBH, KITH]):
        box((r[0], r[1], -SLAB), (r[2], r[3], 0.0), 'slab', tag='floor')
    for r in rects_minus(0, 0, X1, Y1, [(FX0, 0, FX1, FY), (BX0, CY1, BX1, Y1), SSH]):
        box((r[0], r[1], F2 - SLAB), (r[2], r[3], F2), 'slab', tag='floor')
    box((-0.3, -0.3, TOP), (X1 + 0.3, Y1 + 0.3, TOP + 0.4), 'roof', faces={'-z': 'ceil'}, density=0.1)
    for a, b in (((-0.3, -0.3), (X1 + 0.3, 0.0)), ((-0.3, Y1), (X1 + 0.3, Y1 + 0.3)), ((-0.3, 0.0), (0.0, Y1)), ((X1, 0.0), (X1 + 0.3, Y1))):
        box((a[0], a[1], TOP + 0.4), (b[0], b[1], TOP + 1.3), 'cbrick', density=0.12)
        box((a[0] - 0.08, a[1] - 0.08, TOP + 1.3), (b[0] + 0.08, b[1] + 0.08, TOP + 1.42), 'stone', collide=False, density=0.08)
    for a, b in (((-0.45, -0.45), (X1 + 0.45, -0.2)), ((-0.45, Y1 + 0.2), (X1 + 0.45, Y1 + 0.45)), ((-0.45, -0.2), (-0.2, Y1 + 0.2)), ((X1 + 0.2, -0.2), (X1 + 0.45, Y1 + 0.2))):
        box((a[0], a[1], F2 - 0.35), (b[0], b[1], F2 - 0.1), 'stone', collide=False, density=0.1)
        box((a[0], a[1], 0), (b[0], b[1], 0.7), 'stone', collide=False, density=0.1)

    # ================= the outside walls: tall windows, both floors =================
    def ext(axis, c, p0, p1, wins_g, wins_u, doors_g=()):
        holes = [door(axis, c, p, 0.0, w=w, kind='wood', hinge=hg, swing=1 if c < 1 else -1) for (p, w, hg) in doors_g]
        holes += [window(axis, c, p, 0.0, w=1.3, h=2.4, sill=0.75, wt=EXT_T, boards=R.random() < 0.3, glass=R.random() < 0.75) for p in wins_g]
        wall(axis, c, p0, p1, 0.0, F2, EXT_T, 'cbrick', tag='ext', holes=holes)
        holes = [window(axis, c, p, F2, w=1.3, h=2.3, sill=0.8, wt=EXT_T, boards=R.random() < 0.25, glass=R.random() < 0.7) for p in wins_u]
        wall(axis, c, p0, p1, F2, TOP, EXT_T, 'cbrick', tag='ext', holes=holes)
    ext('x', 0.0, 0.0, X1, (3.0, 7.0, 13.0, 17.0, 23.5, 32.5, 39.0, 43.0, 47.0, 53.0), (3.0, 7.0, 13.0, 17.0, 23.5, 28.0, 32.5, 39.0, 43.0, 47.0, 53.0),
        doors_g=((27.4, 1.2, 0), (28.6, 1.2, 1)))
    ext('x', Y1, 0.0, X1, (3.5, 10.5, 18.0, 23.0, 33.0, 38.0, 45.5, 53.0), (3.5, 10.5, 18.0, 23.0, 28.0, 33.0, 38.0, 45.5),
        doors_g=((27.4, 1.2, 0), (28.6, 1.2, 1), (49.0, 1.1, 0)))
    ext('y', 0.0, 0.0, Y1, (5.0, 13.0, 25.0, 31.0), (4.5, 13.5, 24.5, 32.0))
    ext('y', X1, 0.0, Y1, (4.5, 13.5, 25.0, 31.0), (4.5, 13.5, 25.0, 32.0))

    # ================= ground floor =================
    def part(axis, c, p0, p1, z, h, doors=(), mat='wall_int', open_=()):
        holes = [door(axis, c, p, z, w=w, kind='wood', swing=sw) for (p, w, sw) in doors] + [(a, b, z, z + hh) for (a, b, hh) in open_]
        wall(axis, c, p0, p1, z, z + h, INT_T, mat, tag='int', holes=holes, pen=True)

    part('x', CY0, 0.0, FX0, 0.0, H1, doors=((5.0, 1.2, 1), (15.0, 1.2, 1)))
    part('x', CY0, FX1, X1, 0.0, H1, doors=((41.0, 1.4, -1), (53.0, 1.2, -1)))
    part('x', CY1, 0.0, BX0, 0.0, H1, doors=((7.0, 1.6, -1),))
    part('x', CY1, BX0, BX1, 0.0, H1, doors=((24.0, 1.6, 1), (32.0, 1.6, 1)))
    part('x', CY1, BX1, X1, 0.0, H1, doors=((47.0, 1.3, 1),))
    part('y', 10.0, 0.0, CY0, 0.0, H1, doors=((14.0, 1.2, 1),))
    part('y', FX0, 0.0, CY0, 0.0, H1, doors=((6.0, 1.3, 1),), open_=((12.4, 17.6, 3.0),))
    part('x', 10.0, 10.0, FX0, 0.0, H1, doors=((15.0, 1.2, 1),))
    part('y', FX1, 0.0, CY0, 0.0, H1, doors=((6.0, 1.6, -1),), open_=((12.4, 17.6, 3.0),))
    part('y', 50.0, 0.0, CY0, 0.0, H1, doors=((4.0, 1.2, -1), (14.0, 1.2, -1)))
    part('x', 9.0, 50.0, X1, 0.0, H1, doors=((53.0, 1.2, 1),))
    part('y', BX0, CY1, Y1, 0.0, H1, doors=((30.0, 1.4, 1),))
    part('y', BX0, CY1, Y1, F2, TOP - F2, mat='wall_int')
    part('y', BX1, CY1, Y1, 0.0, H1, doors=((26.0, 1.4, -1),))
    part('y', BX1, CY1, Y1, F2, TOP - F2, mat='wall_int')
    # the foyer's walls go up to the roof
    for xc in (FX0, FX1):
        wall('y', xc, 0.0, FY, F2, TOP, INT_T, 'wall_int', tag='int', pen=True)
    box((FX0, CY0 - 0.07, H1), (FX1, CY0 + 0.07, F2), 'wall_int', tag='int', density=0.3)

    room('drawing', 0, 0, 10, CY0, 0, H1, 'mred', 'parquet', dado=('panel', 1.1))
    room('study', 10, 0, FX0, 10, 0, H1, 'panel', 'oldwood')
    room('morning', 10, 10, FX0, CY0, 0, H1, 'mplaster', 'parquet')
    room('foyer', FX0, 0, FX1, CY0, 0, TOP, 'mwall', 'marble', dado=('panel', 1.3))
    room('dining', FX1, 0, 50, CY0, 0, H1, 'mwall', 'parquet', dado=('panel', 1.2))
    room('pantry', 50, 0, X1, 9, 0, H1, 'mbroken', 'oldwood')
    room('gunroom', 50, 9, X1, CY0, 0, H1, 'panel', 'oldwood')
    room('hall0', 0, CY0, X1, CY1, 0, H1, 'mwall2', 'parquet', dado=('panel', 1.1))
    room('library', 0, CY1, BX0, Y1, 0, H1, 'panel', 'oldwood')
    room('ballroom', BX0, CY1, BX1, Y1, 0, TOP, 'mplaster', 'parquet', dado=('mwall2', 1.2))
    room('kitchen', BX1, CY1, X1, Y1, 0, H1, 'wtile', 'mtile')

    # the foyer: a stair up each side to the gallery; the chandelier, and the one that came down
    m.stairs(FX0 + 0.4, 3.6, FX0 + 1.9, FY, 0.0, F2, '+y', mat='dplanks')
    m.stairs(FX1 - 1.9, 3.6, FX1 - 0.4, FY, 0.0, F2, '+y', mat='dplanks')
    m.rail('y', FX0 + 1.95, 3.6, FY, 0.0, h=1.0, mat='trim')
    m.rail('y', FX1 - 1.95, 3.6, FY, 0.0, h=1.0, mat='trim')
    m.rail('x', FY + 0.05, FX0 + 1.95, FX1 - 1.95, F2, h=1.0, mat='trim')
    prop('Chandelier_01', 28.0, 5.0, z=TOP - 2.0, collide=False)
    prop('Chandelier_01', 28.4, 9.0, z=0.0, rot=0.7, tilt=0.35, collide=(0.8, 0.8, 0.5))
    m.stains.extend([(28.0, 8.0, 0.0, 0, 0, 1, 2.2)])
    prop('vintage_grandfather_clock_01', 23.0, CY0 - 0.45, rot=math.pi)
    prop('ClassicConsole_01', 31.5, CY0 - 0.35, rot=math.pi)
    D('ornate_mirror_01', 31.5, CY0 - 0.12, z=1.3, r=math.pi)
    D('antique_ceramic_vase_01', 31.0, CY0 - 0.35, z=0.82)
    light('point', (28.0, 5.0, TOP - 2.4), WARM, 10, radius=0.05, flicker=0.7)
    candles(25.5, 14.5, 0.0)

    # the drawing room: a fire still going in the grate, chairs round it
    box((0.0, 7.6, 0.0), (0.7, 10.4, 1.45), 'stone', density=0.3)
    box((0.0, 8.3, 0.0), (0.72, 9.7, 1.0), 'tar', collide=False, density=0.2)
    box((0.0, 7.4, 1.45), (0.85, 10.6, 1.55), 'wood_top', collide=False, density=0.3)
    box((0.3, 8.6, 0.0), (0.6, 9.4, 0.12), 'candle', collide=False, density=0.1)
    light('point', (0.9, 9.0, 0.4), EMBER, 9, radius=0.15, flicker=0.25)
    D('fancy_picture_frame_01', 0.3, 9.0, z=1.9, r=-math.pi / 2)
    prop('ArmChair_01', 2.6, 7.4, rot=-math.pi / 2 + 0.5)
    prop('ArmChair_01', 2.6, 10.8, rot=-math.pi / 2 - 0.5)
    prop('Sofa_01', 6.8, 9.0, rot=math.pi / 2)
    prop('gothic_coffee_table', 4.6, 9.0, rot=math.pi / 2)
    prop('sofa_03', 5.0, 1.0, rot=0.0)
    prop('side_table_tall_01', 8.8, 16.6, rot=math.pi)
    D('brass_candleholders', 8.8, 16.6, z=0.9)
    light('point', (8.8, 16.6, 1.25), CANDLE, 2.5, radius=0.03, flicker=0.15)

    # the study
    prop('WoodenTable_01', 15.0, 5.2, rot=0.0)
    prop('painted_wooden_chair_01', 15.0, 4.0, rot=0.3)
    for x in (11.2, 13.0, 17.0, 18.8):
        prop('wooden_bookshelf_worn', x, 0.55, rot=0.0)
    prop('vintage_cabinet_01', 19.4, 8.6, rot=math.pi / 2)
    D('desk_lamp_arm_01', 16.0, 5.4, z=0.78, r=2.0)
    light('point', (16.0, 5.4, 1.2), WARM, 2.2, radius=0.03, flicker=0.4)
    L('vintage_suitcase', 11.5, 8.8, r=0.6, kg=6, sf='bag')

    # the morning room: a rocking chair facing the wall
    prop('Rockingchair_01', 18.6, 16.8, rot=0.0)
    prop('painted_wooden_sofa', 12.4, 14.0, rot=-math.pi / 2)
    prop('side_table_01', 15.0, 12.0, rot=0.4)

    # the dining room: the long table still laid, a candelabra lit
    for x in (40.6, 45.4):
        prop('dining_table', x, 9.0, rot=math.pi / 2)
    for i, x in enumerate((39.0, 40.6, 42.2, 43.8, 45.4, 47.0)):
        prop('dining_chair_02', x, 7.6, rot=0.0) if i != 2 else L('dining_chair_02', x - 0.3, 6.3, r=1.9, kg=5)
        prop('dining_chair_02', x, 10.4, rot=math.pi)
    D('brass_candleholders', 43.0, 9.0, z=0.78)
    light('point', (43.0, 9.0, 1.15), CANDLE, 3.0, radius=0.03, flicker=0.15)
    prop('GothicCabinet_01', 49.4, 9.0, rot=math.pi / 2)
    D('fancy_picture_frame_02', 43.0, 0.3, z=2.0, r=0.0)
    m.stains.extend([(42.0, 9.0, 0.79, 0, 0, 1, 1.0), (44.2, 7.0, 0.0, 0, 0, 1, 1.8)])

    # the pantry and the gun room
    for y in (1.0, 3.0, 5.5):
        prop('painted_wooden_shelves', 55.4, y, rot=math.pi / 2)
    D('wine_bottles_01', 51.0, 0.8, r=0.3)
    prop('GothicCommode_01', 55.3, 13.5, rot=math.pi / 2)
    prop('WoodenTable_01', 53.0, 13.5, rot=math.pi / 2)
    D('bolt_action_rifle_7_62', 53.0, 13.5, z=0.78, r=0.4)
    prop('wooden_military_crate', 51.2, 16.8, rot=0.2)
    light('point', (53.0, 13.5, 1.3), CANDLE, 1.6, radius=0.03, flicker=0.2)

    # the long hall: consoles, pictures, a fallen picture
    for x in (12.0, 44.0):
        prop('ClassicConsole_01', x, CY1 - 0.35, rot=math.pi)
    for x in (4.0, 18.0, 38.0, 51.0):
        D('fancy_picture_frame_02' if x > 30 else 'fancy_picture_frame_01', x, CY1 - 0.1, z=1.9, r=math.pi)

    # the library: shelves to the ceiling, a reading table, the stair down in the corner
    for y in (22.6, 26.6, 28.6):
        prop('wooden_bookshelf_worn', 0.6, y, rot=-math.pi / 2)
    for y in (22.6, 24.6, 26.6, 32.6):
        prop('wooden_bookshelf_worn', BX0 - 0.6, y, rot=math.pi / 2)
    prop('WoodenTable_01', 7.0, 27.0, rot=0.0)
    prop('ArmChair_01', 9.4, 25.0, rot=2.4)
    D('wooden_candlestick', 7.2, 27.0, z=0.8)
    light('point', (7.2, 27.0, 1.2), CANDLE, 2.0, radius=0.03, flicker=0.15)
    m.stairs(*LIBH[:2], *LIBH[2:], BZ, 0.0, '+x', mat='dplanks')
    m.rail('x', LIBH[1] - 0.05, LIBH[0], LIBH[2], 0.0, h=1.0, mat='trim')

    # the ballroom: everything under dust sheets, two chandeliers, a balcony along the hall upstairs
    for (x, y) in ((19.0, 24.0), (19.0, 33.0), (37.0, 24.0), (37.0, 33.0)):
        box((x - 0.3, y - 0.3, 0.0), (x + 0.3, y + 0.3, TOP), 'mplaster', tag='post', density=0.3)
    for x in (21.0, 35.0):
        prop('Chandelier_02', x, 28.5, z=TOP - 2.2, collide=False)
    for (x, y, w, d, h) in ((15.4, 26.0, 1.0, 2.2, 0.8), (15.4, 31.0, 0.7, 0.7, 1.1), (16.0, 34.6, 0.7, 0.7, 1.0), (40.6, 25.0, 0.8, 1.8, 0.9),
                            (40.6, 29.0, 0.7, 0.7, 1.15), (40.6, 33.5, 1.6, 0.8, 1.3), (25.0, 34.8, 0.7, 0.7, 1.0), (31.0, 34.8, 2.0, 0.9, 1.0)):
        box((x - w / 2, y - d / 2, 0.0), (x + w / 2, y + d / 2, h), 'sheet', pen=True, tag='counter', density=0.3)
        box((x - w / 2 - 0.06, y - d / 2 - 0.06, 0.0), (x + w / 2 + 0.06, y + d / 2 + 0.06, 0.12), 'sheet', collide=False, density=0.2)
    for (x, y, r) in ((24.0, 27.0, 0.4), (30.5, 30.0, 2.0), (27.0, 25.0, 4.0), (33.0, 26.5, 1.0)):
        L('painted_wooden_chair_01', x, y, r=r, kg=5)
    light('point', (28.0, 28.5, 0.6), CANDLE, 2.2, radius=0.03, flicker=0.15)
    K('candles_4', 28.0, 28.5, 0.001)
    m.stains.extend([(28.0, 28.5, 0.0, 0, 0, 1, 2.4), (26.5, 29.4, 0.0, 0, 0, 1, 1.6)])
    holes = [(x - 1.6, x + 1.6, F2 + 0.95, F2 + 3.0) for x in (18.0, 24.0, 32.0, 38.0)]
    wall('x', CY1, BX0, BX1, F2, TOP, INT_T, 'wall_int', tag='int', holes=holes, pen=True)
    m.invisible((BX0, CY1 - 0.08, F2), (BX1, CY1 + 0.08, F2 + 0.95))

    # the kitchen
    box((45.6, 25.6, 0.0), (50.4, 27.0, 0.9), 'planks', pen=True, tag='counter', density=0.4)
    box((45.5, 25.5, 0.9), (50.5, 27.1, 0.96), 'wood_top', collide=False, density=0.4)
    for y in (24.0, 28.0):
        prop('electric_stove', X1 - 0.6, y, rot=math.pi / 2) if y < 26 else prop('vintage_cabinet_01', X1 - 0.55, y, rot=math.pi / 2)
    D('brass_pan_01', 47.0, 26.3, z=0.96)
    D('wooden_cutting_board', 48.6, 26.2, z=0.96, r=0.3)
    D('pot_enamel_01', 49.6, 26.4, z=0.96)
    prop('wooden_lantern_01', 46.0, 26.2, z=0.96, collide=False)
    light('point', (46.0, 26.2, 1.25), WARM, 2.5, radius=0.04, flicker=0.2)
    m.stairs(*KITH[:2], *KITH[2:], BZ, 0.0, '-x', mat='dplanks')
    m.rail('x', KITH[1] - 0.05, KITH[0], KITH[2], 0.0, h=1.0, mat='trim')
    m.stairs(*SSH[:2], *SSH[2:], 0.0, F2, '+y', mat='dplanks')
    m.stains.extend([(48.0, 26.3, 0.97, 0, 0, 1, 1.2), (47.5, 24.4, 0.0, 0, 0, 1, 2.0)])

    # ================= upper floor =================
    Z = F2
    HU = TOP - F2
    part('x', CY0, 0.0, FX0, Z, HU, doors=((5.0, 1.2, 1), (15.0, 1.2, 1)))
    part('x', CY0, FX1, X1, Z, HU, doors=((41.0, 1.2, -1), (51.0, 1.2, -1)))
    part('x', CY1, 0.0, BX0, Z, HU, doors=((7.0, 1.2, -1),))
    part('x', CY1, BX1, X1, Z, HU, doors=((46.0, 1.2, -1), (53.0, 1.2, -1)))
    part('y', 10.0, 0.0, CY0, Z, HU)
    part('x', 9.0, 0.0, 10.0, Z, HU, doors=((5.0, 1.2, 1),))
    part('y', FX0, FY, CY0, Z, HU, doors=((15.0, 1.2, 1),))
    part('y', FX1, FY, CY0, Z, HU, doors=((15.0, 1.2, -1),))
    part('y', 46.0, 0.0, CY0, Z, HU)
    part('x', 9.0, 46.0, X1, Z, HU, doors=((51.0, 1.2, 1),))
    part('x', 28.5, 0.0, BX0, Z, HU, doors=((7.0, 1.2, 1),))
    part('y', 49.0, CY1, Y1, Z, HU, doors=((30.0, 1.2, 1),))
    m.rail('y', SSH[0] - 0.05, SSH[1], SSH[3], Z, h=1.0, mat='trim')
    m.rail('y', SSH[2] + 0.05, SSH[1], SSH[3], Z, h=1.0, mat='trim')
    m.rail('x', SSH[1] - 0.05, SSH[0], SSH[2], Z, h=1.0, mat='trim')

    room('bed_a', 0, 0, 10, 9, Z, HU, 'wall_paper', 'oldwood')
    room('bed_b', 0, 9, 10, CY0, Z, HU, 'mwall2', 'carpet')
    room('master', 10, 0, FX0, CY0, Z, HU, 'mred', 'carpet', dado=('panel', 1.0))
    room('gallery', FX0, FY, FX1, CY0, Z, HU, 'mwall', 'parquet', dado=('panel', 1.3))
    room('hall1', 0, CY0, X1, CY1, Z, HU, 'mwall2', 'parquet', dado=('panel', 1.1))
    room('bed_e', FX1, 0, 46, CY0, Z, HU, 'wall_paper', 'oldwood')
    room('bath', 46, 0, X1, 9, Z, HU, 'wtile', 'mtile')
    room('bed_f', 46, 9, X1, CY0, Z, HU, 'mplaster', 'carpet')
    room('nursery', 0, CY1, BX0, 28.5, Z, HU, 'wall_paper', 'oldwood')
    room('bed_n', 0, 28.5, BX0, Y1, Z, HU, 'mred', 'oldwood')
    room('maids', BX1, CY1, 49, Y1, Z, HU, 'mbroken', 'oldwood')
    room('stair_s', 49, CY1, X1, Y1, Z, HU, 'mbroken', 'oldwood')

    for (x, y, r) in ((5.0, 1.6, 0.0), (5.0, 16.4, math.pi), (15.0, 1.6, 0.0), (41.0, 1.6, 0.0), (51.0, 16.4, math.pi), (7.0, 34.4, math.pi)):
        prop('GothicBed_01', x, y, z=Z, rot=r)
    prop('old_bed_frame', 45.5, 34.0, z=Z, rot=math.pi)
    prop('old_bed_frame', 45.5, 23.0, z=Z, rot=0.0)
    for (x, y, r, n) in ((8.8, 4.0, math.pi / 2, 'GothicCommode_01'), (19.4, 9.0, math.pi / 2, 'GothicCabinet_01'), (11.0, 9.0, -math.pi / 2, 'vintage_wooden_drawer_01'),
                         (45.4, 9.0, math.pi / 2, 'GothicCommode_01'), (37.0, 14.0, -math.pi / 2, 'vintage_wooden_drawer_01'), (55.4, 13.5, math.pi / 2, 'GothicCabinet_01'),
                         (13.4, 33.0, math.pi / 2, 'GothicCommode_01')):
        prop(n, x, y, z=Z, rot=r)
    D('ornate_mirror_01', 10.15, 13.0, z=Z + 1.3, r=-math.pi / 2)
    prop('Ottoman_01', 15.0, 4.6, z=Z, rot=0.0)
    prop('vintage_day_bed', 28.0, 16.8, z=Z, rot=math.pi)
    # the nursery: a rocking chair in the middle of the floor, a ring of candles in front of it
    prop('Rockingchair_01', 7.0, 25.6, z=Z, rot=math.pi + 0.3)
    candles(7.0, 24.0, Z, 2.4)
    prop('ClassicNightstand_01', 1.0, 22.0, z=Z, rot=-math.pi / 2)
    # the bath: a tub with something in it
    box((52.0, 0.8, Z), (55.4, 2.2, Z + 0.6), 'wtile', pen=True, tag='counter', density=0.3)
    m.stains.extend([(53.7, 1.5, Z + 0.61, 0, 0, 1, 1.4), (53.7, 0.6, Z + 0.9, 0, 1, 0, 1.1)])
    for (x, y, p, fl) in ((12.0, 12.0, 2.2, 0.4), (41.0, 12.0, 0.0, 0.0), (46.0, 30.0, 2.0, 0.6)):
        if p:
            light('point', (x, y, Z + 1.0), CANDLE, p, radius=0.03, flicker=fl)
            K(f'candles_{int(x)}', x, y, Z + 0.001)

    # ================= the cellar =================
    def under(a, b, mat='cbrick'):
        box(a, b, mat, tag='under', density=0.6)
    under((0.0, CY1, BZ - 0.3), (X1, Y1, BZ), 'cellar')
    for a, b in (((0.0, CY1 - 0.25), (X1, CY1)), ((0.0, Y1), (X1, Y1 + 0.25)), ((-0.25, CY1), (0.0, Y1)), ((X1, CY1), (X1 + 0.25, Y1))):
        under((a[0], a[1], BZ), (b[0], b[1], -SLAB))
    TY0, TY1 = 27.0, 30.0
    for a, b in (((BX0, CY1), (BX0 + 0.3, TY0)), ((BX0, TY1), (BX0 + 0.3, Y1)), ((BX1 - 0.3, CY1), (BX1, TY0)), ((BX1 - 0.3, TY1), (BX1, Y1)),
                 ((BX0 + 0.3, TY0 - 0.3), (BX1 - 0.3, TY0)), ((BX0 + 0.3, TY1), (BX1 - 0.3, TY1 + 0.3))):
        under((a[0], a[1], BZ), (b[0], b[1], -SLAB))
    # the earth the tunnel runs through
    under((BX0 + 0.3, CY1, BZ), (BX1 - 0.3, TY0 - 0.3, -SLAB), 'cellar')
    under((BX0 + 0.3, TY1 + 0.3, BZ), (BX1 - 0.3, Y1, -SLAB), 'cellar')
    room('wine', 0, CY1, BX0, Y1, BZ, -SLAB - BZ, 'cbrick', 'cellar', ceil='wall_conc')
    room('tunnel', BX0, TY0, BX1, TY1, BZ, -SLAB - BZ, 'cbrick', 'cellar', ceil='wall_conc')
    room('boiler', BX1, CY1, X1, Y1, BZ, -SLAB - BZ, 'cbrick', 'cellar', ceil='wall_conc')
    for y in (22.2, 24.4, 32.0, 34.2):
        box((10.5, y - 0.9, BZ), (13.6, y + 0.9, BZ + 2.4), 'dplanks', pen=True, tag='counter', density=0.3)
        D('wine_bottles_01', 12.0, y, z=BZ + 1.2, r=1.57)
    for (x, y) in ((3.0, 23.0), (5.4, 23.2), (3.2, 29.5)):
        prop('wooden_barrels_01', x, y, z=BZ, rot=R.uniform(0, 6))
    prop('old_military_compressor', 54.6, 23.0, z=BZ, rot=math.pi / 2)
    prop('metal_tool_chest', 54.8, 30.0, z=BZ, rot=math.pi / 2)
    prop('portable_generator', 46.0, 22.6, z=BZ, rot=0.3)
    for (x, y, c, fl) in ((7.0, 27.0, WARM, 0.6), (28.0, 28.5, (1.0, 0.07, 0.035), 0.0), (49.0, 28.0, (0.72, 0.84, 1.0), 0.7)):
        prop('caged_hanging_light', x, y, z=-SLAB - 0.15, collide=False)
        light('point', (x, y, -SLAB - 0.4), c, 5 if fl else 3, radius=0.05, flicker=fl)
    m.hpipe(BX0 + 0.5, BX1 - 0.5, TY1 - 0.15, -SLAB - 0.3)
    m.stains.extend([(28.0, 28.5, BZ, 0, 0, 1, 2.0), (BX0 + 2.0, TY0, BZ + 1.2, 0, 1, 0, 1.4), (50.0, 32.0, BZ, 0, 0, 1, 1.6)])

    # ================= indoors: every way out shut =================
    import indoor
    m.zones.append(dict(a=(FX0, 0.0, -0.3), b=(FX1, CY0, TOP), kind='hall'))
    m.zones.append(dict(a=(BX0, CY1, -0.3), b=(BX1, Y1, TOP), kind='hall'))
    m.zones.append(dict(a=(0.0, 0.0, BZ - 0.3), b=(X1, Y1, TOP), kind='small'))
    print('  sealed doors, windows:', indoor.seal(m, indoor.inside_fn(m)))
    print('  opened up (gutted, widened):', indoor.open_up(m, indoor.inside_fn(m), random.Random(63), gut=0.75))

    # spawns: A in the west rooms, B in the east
    m.spawns['a'] = [[5.0, 5.0, 0], [5.0, 14.0, 0], [15.0, 7.0, 0], [15.0, 14.0, 0], [4.0, 19.5, 0], [7.0, 31.0, 0], [5.0, 13.0, F2], [15.0, 12.0, F2]]
    m.spawns['b'] = [[43.0, 4.0, 0], [43.0, 14.0, 0], [53.0, 4.0, 0], [53.0, 15.0, 0], [52.0, 19.5, 0], [47.0, 31.0, 0], [41.0, 10.0, F2], [51.0, 12.0, F2]]
    m.spawns['ffa'] = m.spawns['a'][:4] + m.spawns['b'][:4] + [[28.0, 8.0, 0], [24.0, 28.0, 0], [33.0, 31.0, 0], [28.0, 15.0, F2], [28.0, 28.5, BZ], [7.0, 26.0, BZ],
                                                               [49.0, 26.0, BZ], [7.0, 24.0, F2], [46.0, 28.0, F2], [28.0, 19.5, 0]]
    m.hold = [[28.0, 8.0, 0], [28.0, 28.5, 0], [28.0, 28.5, BZ]]
    m.sky = SKY
    m.weather = WEATHER
    m.centre = [28.0, -18.0]
    m.attract = [[28.0, 1.6, -2.0], [28.0, 5.8, -15.0]]   # game axes: in at the door, up to the gallery
    import clutter
    clutter.trim(m)
    print('  furnished:', clutter.furnish(m, 'manor', random.Random(71)))
    clutter.dress(m, 'manor', random.Random(47), blood=0.7)
    print('  cleared from the halls:', indoor.clear_halls(m))
    print('  cleared from the ways through:', indoor.clear_ways(m))
    return m


if __name__ == '__main__':
    m = build()
    print('boxes', len(m.boxes), 'props', len(m.props), 'lights', len(m.lights), 'doors', len(m.doors), 'glass', len(m.glass), 'stains', len(m.stains), 'units', len(m.units))
