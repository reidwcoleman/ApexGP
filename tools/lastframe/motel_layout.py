"""The Pinewood Motor Inn: a roadside motel closed for years, in the pines, in fog and rain at night. Same language as
layout.py: metres, x east, y north, z up.

  the wing    two floors of rooms along the north side of the lot, doors on a walkway and a balcony above it,
              stairs at both ends; some party walls are broken through, so a fight can go room to room
  the office  reception at the west end, the manager's room above it
  the diner   a one-room diner across the lot to the east: booths, a counter, the kitchen behind
  the pool    drained, in the middle of the lot: two metres down, steps at the deep end
  the road    south, with the sign still trying to say VACANCY
Team A comes in from the trees to the west, team B from behind the diner to the east.
"""
import math, random
from layout import Map, EXT_T, INT_T
from ward_layout import rects_minus

F2, TOP = 3.0, 6.0
SLAB = 0.25
WX0, WX1 = -2.0, 54.0          # the wing, office included
WY0, WY1 = 36.0, 44.0          # rooms: front wall to back wall
BAL = 34.0                     # the walkway's outer edge
RW = 4.0                       # one room
DX0, DY0, DX1, DY1 = 60.0, 0.0, 76.0, 14.0     # the diner
PX0, PY0, PX1, PY1 = 34.0, 8.0, 48.0, 20.0     # the pool
PZ = -1.9

SKY = dict(hdri='rooftop_night', strength=0.9, tint=(0.3, 0.4, 0.55))
WEATHER = dict(key=0.13, rain=1, wet=1, fog=1.4, sky=[0.1, 0.12, 0.17], wb=[0.97, 1.0, 1.04])
VOLUME = dict(step=[2, 1.15, 2], min=[-24, -3, -62], dim=[54, 10, 42])

WARM = (1.0, 0.68, 0.38)
TUBE = (0.8, 0.94, 1.0)
SODIUM = (1.0, 0.55, 0.2)
NEON = (1.0, 0.08, 0.06)
TV = (0.45, 0.6, 1.0)


def build():
    m = Map()
    m.rng = random.Random(23)
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

    def tube(x, y, z, p, flick=0.0, along='x'):
        prop('mounted_fluorescent_lights', x, y, z=z - 0.03, rot=0 if along == 'x' else math.pi / 2, part='mounted_fluorescent_lights_a', collide=False)
        if p:
            light('area', (x, y, z - 0.06), TUBE, p, size=(1.2, 0.14) if along == 'x' else (0.14, 1.2), flicker=flick)

    # ================= the ground: the lot, the road, the pool cut into it =================
    holes = [(PX0, PY0, PX1, PY1), (WX0, WY0, WX1, WY1), (DX0, DY0, DX1, DY1)]
    for r in rects_minus(-24, -16, 84, 60, holes):
        box((r[0], r[1], -1), (r[2], r[3], 0), 'asphalt', tag='ground', density=0.45)
    # the road along the south, its lines, the verge
    for x in range(-22, 84, 6):
        box((x, -12.1, -0.2), (x + 3, -11.95, 0.004), 'paint', collide=False, density=0.06)
    for x in range(-2, 32, 3):
        box((x, 22.0, -0.2), (x + 0.1, 28.0, 0.004), 'paint', collide=False, density=0.06)
    box((WX0, BAL, -0.2), (WX1 + 4, WY0, 0.12), 'conc', tag='step', density=0.4)
    # the pool: tiled, empty, rain standing at the bottom
    box((PX0, PY0, PZ - 0.3), (PX1, PY1, PZ), 'conc_wet', tag='under', density=0.5)
    for a, b in (((PX0 - 0.3, PY0 - 0.3), (PX1 + 0.3, PY0)), ((PX0 - 0.3, PY1), (PX1 + 0.3, PY1 + 0.3)), ((PX0 - 0.3, PY0), (PX0, PY1)), ((PX1, PY0), (PX1 + 0.3, PY1))):
        box((a[0], a[1], PZ - 0.3), (b[0], b[1], 0.0), 'wtile', tag='under', density=0.5)
        box((a[0] - 0.25, a[1] - 0.25, 0.0), (b[0] + 0.25, b[1] + 0.25, 0.08), 'stone', collide=False, density=0.15)
    m.stairs(PX1 - 3.2, PY1 - 3.0, PX1 - 0.4, PY1, PZ, 0.0, '+y')
    box((PX1 - 3.2, PY1 - 3.0, PZ), (PX1 - 0.4, PY1, PZ + 0.02), 'wtile', collide=False, tag='under', density=0.2)
    for x in (PX0 + 1.0, PX0 + 1.6):
        box((x - 0.025, PY0 - 0.1, PZ), (x + 0.025, PY0 - 0.05, 0.9), 'steel', collide=False, density=0.05)
    m.rail('x', PY0 - 0.6, PX0 + 4, PX0 + 9, 0.0, h=0.9)
    L('plastic_monobloc_chair_01', 39.0, 13.0, z=PZ, r=1.0, kg=2.5, sf='plastic')
    L('trashbag', 45.0, 10.0, z=PZ, kg=7, sf='bag')
    D('street_rat', 37.0, 17.0, z=PZ, r=2.0)
    m.stains.extend([(41.0, 12.0, PZ, 0, 0, 1, 2.2), (PX0 + 0.01, 15.0, PZ + 1.0, 1, 0, 0, 1.4)])
    for (x, y, r) in ((31.0, 12.0, 0.3), (31.5, 16.0, -0.2), (51.0, 14.0, 2.9)):
        prop('outdoor_table_chair_set_01', x, y, rot=r)

    # ================= the wing: rooms on two floors =================
    for r in rects_minus(WX0, WY0, WX1, WY1, []):
        box((r[0], r[1], -0.3), (r[2], r[3], 0.0), 'slab', tag='floor')
    box((WX0, BAL, F2 - SLAB), (WX1, WY1, F2), 'slab', tag='floor')
    box((WX1, BAL, F2 - SLAB), (WX1 + 4.0, WY0, F2), 'slab', tag='floor')
    box((WX0 - 0.3, BAL - 0.3, TOP), (WX1 + 0.3, WY1 + 0.3, TOP + 0.3), 'roof', density=0.1)
    box((WX0 - 0.3, BAL - 0.6, TOP + 0.3), (WX1 + 0.3, BAL - 0.3, TOP + 0.9), 'planks', density=0.15)
    # the balcony: its edge, a rail, posts down to the walkway
    m.rail('x', BAL + 0.05, WX0, WX1 + 4.0, F2)
    for x in range(int(WX0), int(WX1) + 5, 4):
        box((x - 0.08, BAL + 0.05, 0.0), (x + 0.08, BAL + 0.21, F2 - SLAB), 'steel', density=0.2)
    # stairs up at both ends, outside the rooms
    m.stairs(WX1 + 2.4, 25.0, WX1 + 3.9, BAL, 0.0, F2, '+y')
    m.rail('y', WX1 + 3.95, 25.0, BAL, 0.0)
    m.stairs(WX0 - 3.6, 25.0, WX0 - 2.1, BAL, 0.0, F2, '+y')
    box((WX0 - 3.6, BAL, F2 - SLAB), (WX0, WY0, F2), 'slab', tag='floor')
    m.rail('y', WX0 - 3.65, 25.0, WY0, 0.0)
    nrooms = int((WX1 - 6.0) / RW)
    broken = {(2, 0), (5, 0), (7, 0), (3, 1), (8, 1), (10, 1)}     # party walls knocked through: (wall index, floor)
    lit = {(3, 0): 'lamp', (8, 0): 'tv', (1, 1): 'tv', (6, 1): 'lamp', (11, 1): 'lamp'}
    for fl, z in ((0, 0.0), (1, F2)):
        h = F2 - SLAB if fl == 0 else TOP - F2
        holes = []
        for i in range(nrooms):
            x0 = 6.0 + i * RW
            holes.append(door('x', WY0, x0 + 0.85, z, kind='wood', swing=-1))
            holes.append(window('x', WY0, x0 + 2.65, z, w=1.6, h=1.2, sill=0.95, boards=R.random() < 0.25, glass=R.random() < 0.75))
        # the office / manager's room at the west end
        holes.append(door('x', WY0, WX0 + 1.2, z, kind='steel' if fl == 0 else 'wood', swing=-1))
        if fl == 0:
            holes.append(window('x', WY0, WX0 + 4.4, z, w=2.6, h=1.6, sill=0.8))
        wall('x', WY0, WX0, WX1, z, z + h, EXT_T, 'render_c', tag='ext', holes=holes)
        holes = [window('x', WY1, 6.0 + i * RW + 3.2, z, w=0.6, h=0.5, sill=1.7, glass=R.random() < 0.5) for i in range(0, nrooms, 2)]
        holes.append(door('x', WY1, 29.0, z, kind='steel', swing=1) if fl == 0 else window('x', WY1, 29.0, z, w=0.6, h=0.5, sill=1.7))
        wall('x', WY1, WX0, WX1, z, z + h, EXT_T, 'render_c', tag='ext', holes=holes)
        for xc in (WX0, WX1):
            wall('y', xc, WY0, WY1, z, z + h, EXT_T, 'render_c', tag='ext', holes=[window('y', xc, 40.0, z, w=1.0, h=1.0, sill=1.1)])
        for i in range(nrooms + 1):
            xw = 6.0 + i * RW
            if xw >= WX1:
                continue
            hl = [(38.6, 40.4, z, z + 2.0)] if (i, fl) in broken else []
            wall('y', xw, WY0, WY1, z, z + h, INT_T, 'wall_paper', tag='int', holes=hl, pen=True)
        for i in range(nrooms):
            x0 = 6.0 + i * RW
            # the bathroom across the back, its door at the side
            wall('x', 41.6, x0, x0 + RW, z, z + h, INT_T, 'wtile', tag='int', holes=[(x0 + 2.9, x0 + 3.8, z, z + 2.05)], pen=True)
            room(f'r{fl}{i}', x0, WY0, x0 + RW, 41.6, z, h, 'wall_paper', 'carpet', ceil='ceil_tile', dado=('hosp_dado2', 0.9))
            room(f'b{fl}{i}', x0, 41.6, x0 + RW, WY1, z, h, 'wtile', 'mtile')
            # a bed against the party wall, a nightstand, a dresser with a television
            bx = x0 + 2.0
            box((bx - 0.75, 39.3, z), (bx + 0.75, 41.45, z + 0.32), 'planks', pen=True, tag='counter', density=0.4)
            box((bx - 0.72, 39.35, z + 0.32), (bx + 0.72, 41.4, z + 0.55), 'sheet', collide=False, density=0.3)
            box((bx - 0.78, 41.38, z), (bx + 0.78, 41.48, z + 1.1), 'planks', collide=False, density=0.3)
            D('ClassicNightstand_01', bx - 1.05, 41.1, z=z, r=math.pi)
            box((x0 + 3.35, 37.4, z), (x0 + 3.85, 38.8, z + 0.8), 'planks', pen=True, tag='counter', density=0.3)
            D('Television_01', x0 + 3.6, 38.1, z=z + 0.8, r=-math.pi / 2)
            if R.random() < 0.5:
                L('WoodenChair_01', x0 + 2.4, 37.6, z=z, r=R.uniform(0, 6), kg=5)
            if R.random() < 0.35:
                m.stains.append((bx + R.uniform(-0.4, 0.4), 40.4, z + 0.56, 0, 0, 1, R.uniform(0.7, 1.2)))
            box((x0 + 0.3, 42.0, z), (x0 + 1.9, 43.7, z + 0.55), 'wtile', pen=True, tag='counter', density=0.3)
            what = lit.get((i, fl))
            if what == 'lamp':
                light('point', (bx - 1.05, 41.1, z + 1.0), WARM, 3.5, radius=0.05, flicker=0.15)
                D('desk_lamp_arm_01', bx - 1.05, 41.1, z=z + 0.55, r=0.4)
            elif what == 'tv':
                light('point', (x0 + 3.2, 38.1, z + 1.05), TV, 4.0, radius=0.08, flicker=0.9)
                box((x0 + 3.33, 37.86, z + 0.92), (x0 + 3.36, 38.34, z + 1.24), 'litwin_b', collide=False, density=0.05)
            # the sconce by each door; a few still on
            D('industrial_wall_sconce', x0 + 1.75, WY0 - 0.2, z=z + 2.3, r=math.pi)
            if R.random() < 0.25:
                light('point', (x0 + 1.75, WY0 - 0.4, z + 2.25), WARM, 2.5, radius=0.05, flicker=0.6 if R.random() < 0.5 else 0.0)
        # office / manager's room
        if fl == 0:
            room('office', WX0, WY0, 6.0, WY1, z, h, 'wall_beige', 'wood', ceil='ceil_tile')
            box((WX0 + 0.4, 38.6, 0), (WX0 + 6.0, 39.2, 1.05), 'planks', pen=True, tag='counter', density=0.5)
            box((WX0 + 0.35, 38.55, 1.05), (WX0 + 6.05, 39.25, 1.1), 'wood_top', collide=False, density=0.4)
            D('CashRegister_01', WX0 + 2.0, 38.9, z=1.1, r=math.pi)
            D('binder_notebook', WX0 + 4.0, 38.9, z=1.1, r=2.4)
            prop('steel_frame_shelves_02', WX0 + 4.6, 43.4, rot=math.pi)
            prop('drawer_cabinet', WX0 + 1.0, 43.5, rot=math.pi, part='drawer_cabinet')
            tube(WX0 + 4.0, 40.5, F2 - SLAB, 18, flick=0.8)
            m.stains.extend([(WX0 + 3.0, 39.5, 0.0, 0, 0, 1, 1.6), (WX0 + 3.0, 39.25, 0.6, 0, 1, 0, 1.2)])
        else:
            room('manager', WX0, WY0, 6.0, WY1, z, h, 'wall_paper', 'carpet', ceil='ceil_tile')
            prop('Sofa_01', WX0 + 3.0, 43.4, z=z, rot=math.pi)
            D('television_02', WX0 + 3.0, 36.8, z=z, r=0)
            L('boombox', WX0 + 1.0, 37.0, z=z, kg=3, sf='plastic')
    # the walkway under the balcony: an ice machine and a vending machine, both dead
    box((24.6, 34.7, 0), (25.6, 35.7, 1.6), 'steel', density=0.3)
    box((44.6, 34.6, 0), (45.6, 35.7, 1.9), 'paint_r', density=0.3)
    box((44.62, 34.58, 0.5), (45.58, 34.6, 1.7), 'litwin_c', collide=False, density=0.05)
    light('point', (45.1, 34.3, 1.2), (1.0, 0.45, 0.2), 2.0, radius=0.1, flicker=0.7)

    # ================= the diner =================
    box((DX0, DY0, -0.3), (DX1, DY1, 0.0), 'slab', tag='floor')
    DH = 3.4
    box((DX0 - 0.4, DY0 - 0.4, DH), (DX1 + 0.4, DY1 + 0.4, DH + 0.3), 'roof', density=0.1)
    holes = [door('x', DY0, 66.0, 0.0, w=1.0, kind='steel', swing=1)]
    for x in (62.0, 64.0, 68.5, 70.5, 72.5, 74.4):
        holes.append(window('x', DY0, x, 0.0, w=1.6, h=1.5, sill=0.9, glass=R.random() < 0.7))
    wall('x', DY0, DX0, DX1, 0, DH, EXT_T, 'render_p', tag='ext', holes=holes)
    wall('x', DY1, DX0, DX1, 0, DH, EXT_T, 'render_p', tag='ext', holes=[door('x', DY1, 74.0, 0.0, kind='steel', swing=-1), window('x', DY1, 63.0, 0.0, w=1.0, h=0.8, sill=1.3)])
    wall('y', DX0, DY0, DY1, 0, DH, EXT_T, 'render_p', tag='ext', holes=[window('y', DX0, 3.5, 0.0, w=1.6, h=1.5, sill=0.9), window('y', DX0, 7.0, 0.0, w=1.6, h=1.5, sill=0.9)])
    wall('y', DX1, DY0, DY1, 0, DH, EXT_T, 'render_p', tag='ext', holes=[door('y', DX1, 5.0, 0.0, kind='steel', swing=-1)])
    wall('x', 9.5, DX0, DX1, 0, DH, INT_T, 'wtile', tag='int', holes=[(70.0, 71.2, 0, 2.1), (63.0, 67.0, 1.1, 2.0)], pen=True)
    room('diner', DX0, DY0, DX1, 9.5, 0.0, DH, 'wall_beige', 'mtile', ceil='ceil_tile', dado=('paint_r', 1.0))
    room('kitchen', DX0, 9.5, DX1, DY1, 0.0, DH, 'wtile', 'mtile', ceil='ceil_tile')
    # the counter and its stools; booths along the front windows
    box((61.0, 6.6, 0), (69.0, 7.3, 1.05), 'steel', pen=True, tag='counter', density=0.5)
    box((60.95, 6.55, 1.05), (69.05, 7.35, 1.1), 'wood_top', collide=False, density=0.4)
    for x in (61.8, 63.0, 64.2, 65.4, 66.6, 67.8):
        D('bar_chair_round_01', x, 5.9, r=R.uniform(0, 6)) if R.random() < 0.8 else L('bar_chair_round_01', x + 0.4, 5.2, r=R.uniform(0, 6), kg=6, sf='metal')
    for x in (68.4, 71.4, 74.2):
        for dy in (0.5, 2.3):
            box((x - 0.9, dy, 0), (x + 0.9, dy + 0.5, 0.5), 'paint_r', pen=True, tag='counter', density=0.3)
            box((x - 0.9, dy + (0.4 if dy < 1 else 0), 0.5), (x + 0.9, dy + (0.5 if dy < 1 else 0.1), 1.2), 'paint_r', collide=False, density=0.2)
        box((x - 0.6, 1.1, 0.72), (x + 0.6, 2.2, 0.76), 'wood_top', pen=True, tag='counter', density=0.3)
    prop('electric_stove', 63.0, 13.2, rot=math.pi)
    prop('electric_stove', 64.4, 13.2, rot=math.pi)
    box((66.0, 12.6, 0), (69.5, 13.7, 0.9), 'steel', pen=True, tag='counter', density=0.3)
    prop('metal_tool_chest', 75.2, 12.0, rot=-math.pi / 2)
    tube(64.0, 4.0, DH, 22, flick=0.9)
    tube(71.0, 4.0, DH, 0)
    tube(67.0, 11.8, DH, 16, flick=0.4)
    box((61.0, DY0 + 0.17, 2.1), (63.0, DY0 + 0.2, 2.5), 'emerg', collide=False, density=0.05)
    light('point', (62.0, DY0 + 0.5, 2.3), NEON, 4.0, radius=0.1, flicker=0.5)
    m.stains.extend([(65.0, 4.5, 0.0, 0, 0, 1, 1.8), (67.0, 9.4, 1.2, 0, -1, 0, 1.4), (72.0, 12.0, 0.0, 0, 0, 1, 1.5)])

    # ================= the lot, the road, the sign =================
    for (x, y, r) in ((8.0, 24.0, 0.1), (14.0, 25.0, -0.2), (24.0, 23.5, 3.0), (52.0, 26.0, 1.6)):
        prop('covered_car', x, y, rot=r)
    for (x, y, on, fl) in ((4.0, 18.0, True, 0.0), (30.0, 4.0, True, 0.5), (54.0, 20.0, False, 0.0), (18.0, -6.0, True, 0.2)):
        prop('street_lamp_01', x, y, rot=0.0)
        if on:
            light('spot', (x, y + 0.5, 6.1), SODIUM, 700, spot=2.3, blend=0.85, radius=0.15, aim=(0.15, 0.05, -1), flicker=fl)
    # the sign by the road: a pole, a box, red letters that come and go
    box((29.8, -8.2, 0), (30.2, -7.8, 6.0), 'steel', density=0.2)
    box((27.6, -8.15, 6.0), (32.4, -7.85, 7.6), 'signboard', collide=False, density=0.2)
    box((28.0, -8.2, 6.3), (32.0, -8.15, 6.75), 'emerg', collide=False, density=0.05)
    box((28.0, -7.85, 6.3), (32.0, -7.8, 6.75), 'emerg', collide=False, density=0.05)
    light('point', (30.0, -7.2, 6.5), NEON, 30, radius=0.2, flicker=0.35)
    light('point', (30.0, -8.8, 6.5), NEON, 30, radius=0.2, flicker=0.35)
    # a fire in a drum, where someone was sleeping in the lot
    prop('barrel_03', 20.0, 8.0)
    light('point', (20.0, 8.0, 1.3), (1.0, 0.42, 0.12), 14, radius=0.3, flicker=0.12)
    prop('old_tyre', 21.4, 8.6, rot=0.4)
    L('cardboard_box_01', 19.0, 9.2, r=0.7, kg=4, sf='card')
    # the trees: dead trunks and scrub round the edge, a fence, and nothing past it but fog
    for i in range(46):
        a = i / 46 * 6.283
        x = 30 + math.cos(a) * 52 * R.uniform(0.95, 1.05)
        y = 22 + math.sin(a) * 36 * R.uniform(0.95, 1.05)
        if -16 < y < -9:
            continue
        if R.random() < 0.6:
            prop('dead_tree_trunk', x, y, rot=R.uniform(0, 6), scale=R.uniform(1.0, 1.6), collide=False)
        else:
            prop(R.choice(['shrub_01', 'shrub_02', 'shrub_03']), x, y, rot=R.uniform(0, 6), scale=R.uniform(1.2, 2.0), collide=False)
    for (a, b) in (((-24, 60), (84, 60.2)), ((-24, -16), (-23.8, 60)), ((83.8, -16), (84, 60))):
        box((a[0], a[1], 0), (b[0], b[1], 2.0), 'fence', tag='ext', density=0.15)
        m.invisible((a[0], a[1], 2.0), (b[0], b[1], 8.0))
    m.invisible((-24, -16.2, 0), (84, -16, 8.0))
    # past the fence, more dead trees, thinning into the fog
    for i in range(70):
        a = R.uniform(0, 6.283)
        rr = R.uniform(1.12, 1.6)
        x, y = 30 + math.cos(a) * 54 * rr, 22 + math.sin(a) * 38 * rr
        if -20 < y < -8 and -30 < x < 90:
            continue
        prop('dead_tree_trunk', x, y, rot=R.uniform(0, 6), scale=R.uniform(1.2, 2.2), collide=False)

    # zones: the rooms are small; the lot is outside
    for fl, z in ((0, 0.0), (1, F2)):
        m.zones.append(dict(a=(WX0, WY0, z - 0.3), b=(WX1, WY1, z + 2.9), kind='small'))
    m.zones.append(dict(a=(DX0, DY0, -0.3), b=(DX1, DY1, 3.4), kind='small'))

    # spawns: A in the trees to the west, B behind the diner to the east
    m.spawns['a'] = [[-18.0, 4.0, 0], [-18.0, 10.0, 0], [-16.0, 16.0, 0], [-19.0, 22.0, 0], [-16.0, 28.0, 0], [-18.0, 34.0, 0], [-15.0, 46.0, 0], [-19.0, 52.0, 0]]
    m.spawns['b'] = [[80.0, 20.0, 0], [78.0, 26.0, 0], [80.0, 32.0, 0], [78.0, 38.0, 0], [80.0, 44.0, 0], [78.0, 50.0, 0], [80.0, 4.0, 0], [79.0, -4.0, 0]]
    m.spawns['ffa'] = m.spawns['a'][:4] + m.spawns['b'][:4] + [[30.0, 0.0, 0], [41.0, 14.0, PZ], [20.0, 39.0, 0], [40.0, 39.0, F2], [12.0, 39.0, F2], [66.0, 4.0, 0],
                                                               [10.0, 30.0, 0], [50.0, 30.0, 0], [2.0, 40.0, 0], [30.0, 50.0, 0]]
    m.hold = [[41.0, 14.0, PZ], [30.0, 35.0, F2], [66.0, 4.5, 0]]
    m.sky = SKY
    m.weather = WEATHER
    m.centre = [30.0, -24.0]
    m.attract = [[56.5, 1.6, -26.0], [30.0, 4.6, -35.0]]    # game axes: up the east stair onto the balcony
    import clutter
    clutter.trim(m)
    clutter.dress(m, 'flat', random.Random(43), outside=[(-22.0, -9.0, 33.0, 33.0, 0.0), (49.0, -9.0, 82.0, 33.0, 0.0), (33.0, -9.0, 49.0, 7.0, 0.0), (33.0, 21.0, 49.0, 33.0, 0.0), (-22.0, 33.0, -3.0, 58.0, 0.0), (55.0, 33.0, 82.0, 58.0, 0.0), (-2.0, 45.0, 55.0, 58.0, 0.0)], out_n=80, blood=0.55)
    return m


if __name__ == '__main__':
    import sys
    from layout import draw
    m = build()
    print('boxes', len(m.boxes), 'props', len(m.props), 'lights', len(m.lights), 'doors', len(m.doors), 'glass', len(m.glass), 'stains', len(m.stains))
    out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/motel'
    draw(m, out + '_g.png', (0.3, 1.6))
    draw(m, out + '_u.png', (F2 + 0.3, F2 + 1.6))
