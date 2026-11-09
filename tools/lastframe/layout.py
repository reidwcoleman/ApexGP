"""The map, as data: axis-aligned boxes with per-face materials, props, lights, doors, spawns.
Pure Python so it can be drawn and checked without Blender. Metres, x east, y north, z up.
Kessler Block: a wet city block at dusk. West the tenement, east the warehouse, the alley between,
yards to the north, the street along the south.
"""
import math, random

# the block at night under rain: a low sky with the city's glow on it, and no more light than that
WEATHER = dict(key=0.13, rain=1, wet=1, fog=1.05, sky=[0.14, 0.17, 0.26], wb=[0.97, 1.0, 1.03])

FACES = ('-x', '+x', '-y', '+y', '-z', '+z')
FL = 0.0          # ground floor
F2 = 3.2          # upper floor
TOP = 6.4         # tenement ceiling
EXT_T = 0.32
INT_T = 0.14


class Box:
    __slots__ = ('a', 'b', 'mat', 'collide', 'pen', 'tag', 'density', 'faces', 'surf')

    def __init__(s, a, b, mat, collide=True, pen=False, tag='', density=1.0, faces=None, surf=None):
        s.a = tuple(min(a[i], b[i]) for i in range(3))
        s.b = tuple(max(a[i], b[i]) for i in range(3))
        s.mat, s.collide, s.pen, s.tag, s.density = mat, collide, pen, tag, density
        s.faces = faces or {}
        s.surf = surf


class Map:
    def __init__(s):
        s.boxes, s.props, s.lights, s.doors, s.rooms = [], [], [], [], []
        s.spawns = {'a': [], 'b': [], 'ffa': []}
        s.hold = []
        s.zones = []     # indoor reverb zones
        s.glass = []
        s.windows = []   # every window opening, glazed or not
        s.solid = []     # invisible colliders
        s.units = []     # facade modules from the scanned kits, each with its own lightmap tile
        s.rng = random.Random(7)

    def box(s, a, b, mat, **k):
        o = Box(a, b, mat, **k)
        s.boxes.append(o)
        return o

    def invisible(s, a, b, pen=False):
        s.solid.append((tuple(min(a[i], b[i]) for i in range(3)), tuple(max(a[i], b[i]) for i in range(3)), pen))

    # ---- walls with openings. holes: (p0, p1, h0, h1) along the wall, heights from z0
    def wall(s, axis, c, p0, p1, z0, z1, t, mat, neg=None, pos=None, holes=(), pen=False, tag='wall', density=1.0):
        """axis 'x': runs along x at y=c. neg/pos: material of the -normal/+normal face."""
        hs = sorted(holes)
        cur = p0
        for i in range(len(hs) - 1):
            if hs[i][1] > hs[i + 1][0] + 1e-3 and hs[i][2] < hs[i + 1][3] and hs[i + 1][2] < hs[i][3]:
                print(f'  ! holes overlap in wall {axis}={c}: {hs[i][:2]} and {hs[i + 1][:2]}')

        def seg(a, b, h0, h1):
            if b - a < 1e-3 or h1 - h0 < 1e-3:
                return
            if axis == 'x':
                A, B = (a, c - t / 2, h0), (b, c + t / 2, h1)
                f = {'-y': neg or mat, '+y': pos or mat}
            else:
                A, B = (c - t / 2, a, h0), (c + t / 2, b, h1)
                f = {'-x': neg or mat, '+x': pos or mat}
            s.box(A, B, mat, faces=f, pen=pen, tag=tag, density=density)

        for (a, b, h0, h1) in hs:
            seg(cur, a, z0, z1)
            seg(a, b, z0, h0)
            seg(a, b, h1, z1)
            cur = b
        seg(cur, p1, z0, z1)

    def door(s, axis, c, p, z, w=0.92, h=2.08, kind='wood', hinge=0, swing=1, t=0.05, frame='trim'):
        """A hinged door centred at p along the wall. Returns the hole to pass to wall().
        Never narrower than 1.1 m: two people pass each other in it, and nobody catches on the leaf."""
        w = max(w, 1.1)
        a, b = p - w / 2, p + w / 2
        hinge_p = a if hinge == 0 else b
        hx, hy = (hinge_p, c) if axis == 'x' else (c, hinge_p)
        s.doors.append(dict(axis=axis, hinge=[hx, hy, z], w=w, h=h, sign=1 if hinge == 0 else -1, swing=swing, kind=kind, t=t))
        s.casing(axis, c, a, b, z, z + h)
        return (a, b, z, z + h)

    def casing(s, axis, c, a, b, z0, z1, wt=0.2, mat='trim', sill=False):
        """the frame round an opening, proud of the wall on both sides"""
        k, d = 0.07, wt / 2 + 0.012
        parts = [((a - k, z0), (a, z1)), ((b, z0), (b + k, z1)), ((a - k, z1), (b + k, z1 + k))]
        if sill:
            parts.append(((a - k, z0 - k), (b + k, z0)))
        for (p0, h0), (p1, h1) in parts:
            if axis == 'x':
                s.box((p0, c - d, h0), (p1, c + d, h1), mat, collide=False, density=0.4)
            else:
                s.box((c - d, p0, h0), (c + d, p1, h1), mat, collide=False, density=0.4)

    def window(s, axis, c, p, z, w=1.2, h=1.45, sill=0.9, wt=EXT_T, boards=False, glass=True):
        a, b = p - w / 2, p + w / 2
        s.windows.append(dict(axis=axis, c=c, a=a, b=b, z0=z + sill, z1=z + sill + h))
        s.casing(axis, c, a, b, z + sill, z + sill + h, wt, 'trim', sill=True)
        # mullion and transom
        d = 0.025
        m = (a + b) / 2
        hz = z + sill + h * 0.55
        if axis == 'x':
            s.box((m - 0.02, c - d, z + sill), (m + 0.02, c + d, z + sill + h), 'trim', collide=False, density=0.3)
            s.box((a, c - d, hz - 0.02), (b, c + d, hz + 0.02), 'trim', collide=False, density=0.3)
        else:
            s.box((c - d, m - 0.02, z + sill), (c + d, m + 0.02, z + sill + h), 'trim', collide=False, density=0.3)
            s.box((c - d, a, hz - 0.02), (c + d, b, hz + 0.02), 'trim', collide=False, density=0.3)
        if boards:
            for i in range(3):
                zz = z + sill + 0.2 + i * 0.42 + s.rng.uniform(-0.05, 0.05)
                if axis == 'x':
                    s.box((a - 0.1, c - 0.19, zz), (b + 0.1, c - 0.165, zz + 0.16), 'planks', collide=False, density=0.3)
                else:
                    s.box((c - 0.19, a - 0.1, zz), (c - 0.165, b + 0.1, zz + 0.16), 'planks', collide=False, density=0.3)
        elif glass:
            s.glass.append(dict(axis=axis, c=c, a=a, b=b, z0=z + sill, z1=z + sill + h))
        return (a, b, z + sill, z + sill + h)

    def room(s, name, x0, y0, x1, y1, z, h, wall, floor, ceil='ceil', base='trim', dado=None):
        """dado: (material, height) for the lower part of the walls"""
        s.rooms.append(dict(name=name, a=(x0, y0, z), b=(x1, y1, z + h), wall=wall, floor=floor, ceil=ceil, base=base, dado=dado))

    def prop(s, name, x, y, z=0.0, rot=0.0, scale=1.0, part=None, collide=None, hard=True, tilt=0.0):
        """collide: None = the prop's bounding box, False = none, or (hx, hy, hz) half sizes"""
        s.props.append(dict(name=name, part=part, pos=[x, y, z], rot=rot, scale=scale, collide=collide, hard=hard, tilt=tilt, loose=None))

    def loose(s, name, x, y, z=0.0, rot=0.0, scale=1.0, part=None, kg=4.0, surf='wood', shape='box'):
        """a thing nobody bolted down: left out of the bake, simulated in the game"""
        s.props.append(dict(name=name, part=part, pos=[x, y, z], rot=rot, scale=scale, collide=False, hard=False, tilt=0.0, loose=dict(kg=kg, surf=surf, shape=shape)))

    def unit(s, kit, parts, x, y, z=0.0, rot=0.0, sc=(1, 1, 1), tint=(1, 1, 1), far=False):
        """one kit module. parts share an origin at the module's corner; it runs 3 m along kit -x,
        and its face looks along kit -y. rot pi faces north, 0 south, pi/2 east, -pi/2 west"""
        s.units.append(dict(kit=kit, parts=parts, pos=[x, y, z], rot=rot, sc=list(sc), tint=list(tint), far=far))

    def hpipe(s, x0, x1, y, z, part='modular_industrial_pipes_01_pipe02', run='x'):
        """scanned pipe laid on its side, section after section"""
        L = 1.93
        n = max(1, int(abs(x1 - x0) / L))
        sg = 1 if x1 > x0 else -1
        for i in range(n):
            p = x0 + sg * i * L
            if run == 'x':
                s.prop('modular_industrial_pipes_01', p, y, z=z, rot=sg * math.pi / 2, part=part, collide=False, tilt=math.pi / 2)
            else:
                s.prop('modular_industrial_pipes_01', y, p, z=z, rot=0 if sg > 0 else math.pi, part=part, collide=False, tilt=-math.pi / 2)

    def downpipe(s, x, y, z1):
        """a rainwater pipe down a wall"""
        z = 0.0
        while z < z1 - 0.3:
            s.prop('modular_industrial_pipes_01', x, y, z=z, part='modular_industrial_pipes_01_pipe02', collide=False, scale=0.62)
            z += 1.2

    def facade_window(s, x, y, z, lit=None, w=1.25, h=1.7):
        """a window on a wall that faces +y and can't be reached"""
        s.box((x - w / 2, y, z), (x + w / 2, y + 0.02, z + h), lit or 'darkwin', collide=False, density=0.02)
        s.box((x - w / 2 - 0.1, y, z - 0.12), (x + w / 2 + 0.1, y + 0.13, z - 0.02), 'stone', collide=False, density=0.1)
        s.box((x - w / 2 - 0.12, y, z + h), (x + w / 2 + 0.12, y + 0.1, z + h + 0.2), 'stone', collide=False, density=0.1)
        s.box((x - w / 2 - 0.05, y, z), (x - w / 2, y + 0.07, z + h), 'trim', collide=False, density=0.06)
        s.box((x + w / 2, y, z), (x + w / 2 + 0.05, y + 0.07, z + h), 'trim', collide=False, density=0.06)
        s.box((x - 0.025, y, z), (x + 0.025, y + 0.05, z + h), 'trim', collide=False, density=0.06)

    def light(s, kind, pos, color, power, **k):
        d = dict(kind=kind, pos=list(pos), color=list(color), power=power)
        d.update(k)
        s.lights.append(d)

    def stairs(s, x0, y0, x1, y1, z0, z1, direction, mat='concstep', n=None, solid=True):
        """a straight flight rising toward direction ('+x','-x','+y','-y') in the rectangle"""
        n = n or round((z1 - z0) / 0.178)
        rise = (z1 - z0) / n
        for i in range(n):
            za = z0 + rise * (i + 1)
            f0 = i / n
            f1 = (i + 1) / n
            if direction == '+y':
                a, b = (x0, y0 + (y1 - y0) * f0, z0 if solid else za - 0.1), (x1, y0 + (y1 - y0) * f1, za)
            elif direction == '-y':
                a, b = (x0, y1 - (y1 - y0) * f1, z0 if solid else za - 0.1), (x1, y1 - (y1 - y0) * f0, za)
            elif direction == '+x':
                a, b = (x0 + (x1 - x0) * f0, y0, z0 if solid else za - 0.1), (x0 + (x1 - x0) * f1, y1, za)
            else:
                a, b = (x1 - (x1 - x0) * f1, y0, z0 if solid else za - 0.1), (x1 - (x1 - x0) * f0, y1, za)
            s.box(a, b, mat, tag='step', density=0.5)

    def rail(s, axis, c, p0, p1, z, h=1.05, mat='steel'):
        """a pipe rail: posts and two runs; stops you and little else"""
        d = 0.025
        n = max(1, int(abs(p1 - p0) / 1.6))
        for i in range(n + 1):
            p = p0 + (p1 - p0) * i / n
            if axis == 'x':
                s.box((p - d, c - d, z), (p + d, c + d, z + h), mat, collide=False, density=0.15)
            else:
                s.box((c - d, p - d, z), (c + d, p + d, z + h), mat, collide=False, density=0.15)
        for hh in (h, h * 0.55):
            if axis == 'x':
                s.box((p0, c - d, z + hh - d), (p1, c + d, z + hh + d), mat, collide=False, density=0.15)
            else:
                s.box((c - d, p0, z + hh - d), (c + d, p1, z + hh + d), mat, collide=False, density=0.15)
        if axis == 'x':
            s.invisible((p0, c - 0.05, z), (p1, c + 0.05, z + h), pen=True)
        else:
            s.invisible((c - 0.05, p0, z), (c + 0.05, p1, z + h), pen=True)

    def cargo(s, x0, y0, z, x1, y1, layers):
        """a pallet load of the scanned carton (0.52 x 0.39 x 0.34), one collider round it"""
        nx, ny = max(1, int((x1 - x0) / 0.53)), max(1, int((y1 - y0) / 0.4))
        for k in range(layers):
            for i in range(nx):
                for j in range(ny):
                    if k == layers - 1 and s.rng.random() < 0.18:
                        continue
                    px = x0 + (i + 0.5) * (x1 - x0) / nx + s.rng.uniform(-0.012, 0.012)
                    py = y0 + (j + 0.5) * (y1 - y0) / ny + s.rng.uniform(-0.012, 0.012)
                    s.prop('cardboard_box_01', px, py, z=z + k * 0.34, rot=math.pi / 2 + s.rng.uniform(-0.05, 0.05), collide=False)
        s.invisible((x0, y0, z), (x1, y1, z + layers * 0.34), pen=True)

    def container(s, x, y, z, rot90=False, tint='cont_a', open_end=False):
        L, W, H = 6.06, 2.44, 2.59
        a = (x, y, z)
        b = (x + (W if rot90 else L), y + (L if rot90 else W), z + H)
        s.box(a, b, tint, tag='container', density=0.5)
        # the corner posts and rails read as a real box
        for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
            cx = a[0] + (b[0] - a[0]) * dx
            cy = a[1] + (b[1] - a[1]) * dy
            s.box((cx - 0.09, cy - 0.09, z), (cx + 0.09, cy + 0.09, z + H + 0.02), 'ruststeel', collide=False, density=0.15)


def build():
    m = Map()
    box, wall, door, window, room, prop, light = m.box, m.wall, m.door, m.window, m.room, m.prop, m.light

    # ================= ground =================
    box((-44, 0, -1), (140, 10, -0.12), 'asphalt', tag='road', density=0.6)
    box((-44, -3.4, -1), (140, 0, 0), 'sidewalk', tag='ground', density=0.45)
    box((-44, 10, -1), (140, 13, 0), 'sidewalk', tag='ground', density=0.55)
    for x in (-44,):
        pass
    # curbs
    box((-44, -0.16, -0.5), (140, 0.0, 0.02), 'curb', collide=False, density=0.3)
    box((-44, 10.0, -0.5), (140, 10.16, 0.02), 'curb', collide=False, density=0.3)
    # west yard, alley, north yard, east lot: one concrete apron
    HX0, HX1, HY0, HY1 = 26.9, 28.3, 24.9, 30.2          # the way down, in the boiler room
    box((0, 13, -1), (HX0, 62, 0), 'yard', tag='ground', density=0.55)
    box((HX1, 13, -1), (34, 62, 0), 'yard', tag='ground', density=0.55)
    box((HX0, 13, -1), (HX1, HY0, 0), 'yard', tag='ground', density=0.55)
    box((HX0, HY1, -1), (HX1, 62, 0), 'yard', tag='ground', density=0.55)
    box((34, 13, -1), (50, 62, 0), 'alley', tag='ground', density=0.7)
    box((50, 45, -1), (96, 62, 0), 'yard', tag='ground', density=0.55)
    box((86, 13, -1), (96, 45, 0), 'alley', tag='ground', density=0.6)

    # ================= tenement =================
    X0, X1, Y0, Y1 = 6.0, 34.0, 13.0, 33.0
    CY0, CY1 = 22.0, 24.2           # the corridor
    box((X0, Y0, -0.4), (HX0, Y1, 0.0), 'slab', tag='floor')
    box((HX1, Y0, -0.4), (X1, Y1, 0.0), 'slab', tag='floor')
    box((HX0, Y0, -0.4), (HX1, HY0, 0.0), 'slab', tag='floor')
    box((HX0, HY1, -0.4), (HX1, Y1, 0.0), 'slab', tag='floor')
    box((X0, Y0, F2 - 0.22), (X1, Y1, F2), 'slab', tag='floor')
    box((X0 - 0.3, Y0 - 0.3, TOP), (X1 + 0.3, Y1 + 0.3, TOP + 0.3), 'roof', density=0.1)
    # stairwell hole in the upper slab is cut by replacing that slab: see below
    m.boxes.pop(-2)
    SX0, SX1, SY0, SY1 = 22.0, 26.0, 24.2, 30.4     # stairwell opening
    box((X0, Y0, F2 - 0.22), (SX0, Y1, F2), 'slab', tag='floor')
    box((SX1, Y0, F2 - 0.22), (X1, Y1, F2), 'slab', tag='floor')
    box((SX0, Y0, F2 - 0.22), (SX1, SY0, F2), 'slab', tag='floor')
    box((SX0, SY1, F2 - 0.22), (SX1, Y1, F2), 'slab', tag='floor')

    # south facade: the shopfront, the lobby door, upstairs windows
    holes = [(7.6, 16.4, 0.5, 2.75)]
    holes.append(door('x', Y0, 22.0, 0.0, w=1.05, kind='street', t=0.06))
    holes.append(window('x', Y0, 29.5, 0.0))
    for i, p in enumerate((9.0, 14.0, 19.5, 24.5, 29.5)):
        pass
    wall('x', Y0, X0, X1, 0, F2, EXT_T, 'brick_a', neg='brick_a', pos='wall_int', holes=holes, tag='ext')
    # shopfront glass and frame
    m.casing('x', Y0, 7.6, 16.4, 0.5, 2.75, EXT_T, 'shopframe', sill=True)
    for p in (10.5, 13.5):
        box((p - 0.04, Y0 - 0.04, 0.5), (p + 0.04, Y0 + 0.04, 2.75), 'shopframe', collide=False, density=0.3)
    for a, b in ((7.6, 10.46), (10.54, 13.46), (13.54, 16.4)):
        m.glass.append(dict(axis='x', c=Y0, a=a, b=b, z0=0.5, z1=2.75))
    box((6.9, Y0 - 0.9, 2.86), (17.1, Y0 - 0.16, 3.0), 'awning', collide=False, density=0.5)
    # upstairs the kit's plaster front, stretched to the block: nine bays, two of them blank where a partition lands
    BAY = (X1 - X0) / 9
    holes = []
    APT = 'modular_urban_apartments_facade'
    for i in range(9):
        x0 = X0 + i * BAY
        c = x0 + BAY / 2
        kx, kz = BAY / 3, (TOP - F2) / 3
        if i in (3, 6):
            m.unit(APT, ['wall_standard_standard_01'], x0 + 3 * kx, Y0 - EXT_T / 2 - 0.012, F2, rot=0, sc=(kx, 1, kz), tint=(0.86, 0.8, 0.72))
            continue
        m.unit(APT, ['wall_window_centered_small_01'], x0 + 3 * kx, Y0 - EXT_T / 2 - 0.012, F2, rot=0, sc=(kx, 1, kz), tint=(0.86, 0.8, 0.72))
        holes.append(window('x', Y0, c, F2, w=0.98, h=2.26, sill=0.2, boards=i == 1))
    wall('x', Y0, X0, X1, F2, TOP, EXT_T, 'brick_a', pos='wall_int', holes=holes, tag='ext')

    # north facade
    holes = [window('x', Y1, 10.0, 0.0, boards=True), window('x', Y1, 18.0, 0.0), door('x', Y1, 30.0, 0.0, kind='steel', swing=-1)]
    wall('x', Y1, X0, X1, 0, F2, EXT_T, 'brick_a', neg='wall_int', holes=holes, tag='ext')
    holes = [window('x', Y1, 10.0, F2), window('x', Y1, 18.0, F2, boards=True), door('x', Y1, 28.5, F2, kind='steel', swing=-1), window('x', Y1, 24.0, F2)]
    wall('x', Y1, X0, X1, F2, TOP, EXT_T, 'brick_a', neg='wall_int', holes=holes, tag='ext')

    # west facade: the corridor door; east facade: corridor door, the bridge door upstairs
    holes = [door('y', X0, 23.1, 0.0, kind='steel'), window('y', X0, 17.0, 0.0), window('y', X0, 28.0, 0.0, boards=True)]
    wall('y', X0, Y0, Y1, 0, F2, EXT_T, 'brick_a', pos='wall_int', holes=holes, tag='ext')
    holes = [window('y', X0, 17.0, F2), window('y', X0, 23.1, F2), window('y', X0, 28.0, F2)]
    wall('y', X0, Y0, Y1, F2, TOP, EXT_T, 'brick_a', pos='wall_int', holes=holes, tag='ext')
    holes = [door('y', X1, 23.1, 0.0, kind='steel', swing=-1), window('y', X1, 17.5, 0.0), window('y', X1, 28.5, 0.0)]
    wall('y', X1, Y0, Y1, 0, F2, EXT_T, 'brick_a', neg='wall_int', holes=holes, tag='ext')
    holes = [door('y', X1, 23.1, F2, kind='steel', swing=-1), window('y', X1, 17.5, F2), window('y', X1, 28.5, F2, boards=True)]
    wall('y', X1, Y0, Y1, F2, TOP, EXT_T, 'brick_a', neg='wall_int', holes=holes, tag='ext')
    # parapet + cornice
    for a, b in (((X0 - 0.2, Y0 - 0.2), (X1 + 0.2, Y0 + 0.1)), ((X0 - 0.2, Y1 - 0.1), (32.3, Y1 + 0.2)), ((X0 - 0.2, Y0), (X0 + 0.1, Y1)), ((X1 - 0.1, Y0), (X1 + 0.2, Y1 - 0.1))):
        box((a[0], a[1], TOP + 0.3), (b[0], b[1], TOP + 1.05), 'brick_a', density=0.15)

    for z, top in ((0.0, F2 - 0.22), (F2, TOP)):
        up = z > 0
        # corridor walls
        s_doors = [door('x', CY0, 11.5, z, swing=1), door('x', CY0, 20.0, z, swing=1), door('x', CY0, 30.0, z, swing=1)]
        n_doors = [door('x', CY1, 10.0, z, swing=-1), door('x', CY1, 18.0, z, swing=-1), door('x', CY1, 30.0, z, swing=-1)]
        if not up:
            s_doors.append((23.0, 25.2, z, z + 2.3))     # the lobby opens onto the corridor
        wall('x', CY0, X0, X1, z, top, INT_T, 'wall_int', holes=s_doors, pen=True, tag='int')
        hole_st = (22.6, 25.4, z, z + 2.3)
        wall('x', CY1, X0, X1, z, top, INT_T, 'wall_int', holes=n_doors + [hole_st], pen=True, tag='int')
        # south room partitions
        for x in (17.0, 26.0):
            wall('y', x, Y0, CY0, z, top, INT_T, 'wall_int', pen=True, tag='int')
        # north partitions
        for x in (14.0, 22.0, 26.0):
            wall('y', x, CY1, Y1, z, top, INT_T, 'wall_int', pen=True, tag='int')
        if up:
            wall('y', 11.5 + 0.0, Y0, CY0, z, top, INT_T, 'wall_int', pen=True, tag='int', holes=[door('y', 11.5, 16.5, z, swing=1)])
            wall('y', 21.5, Y0, CY0, z, top, INT_T, 'wall_int', pen=True, tag='int', holes=[door('y', 21.5, 17.0, z, swing=1)])

    # stairs: a dog-leg in the well
    LAND = 1.6
    m.stairs(SX0 + 0.1, SY0 + 0.2, SX0 + 1.9, 30.2 - 1.6, 0.0, 1.6, '+y')
    box((SX0 + 0.1, 30.2 - 1.6, 0), (SX1 - 0.1, 31.8, 1.6), 'concstep', tag='step', density=0.5)
    m.stairs(SX0 + 2.1, SY0 + 0.2, SX1 - 0.1, 30.2 - 1.6, 1.6, F2, '-y')
    m.invisible((SX0 + 1.92, SY0, 0), (SX0 + 2.08, 30.2 - 1.6, 4.2))
    box((SX0 + 1.92, SY0, 0.0), (SX0 + 2.08, 30.2 - 1.6, 1.3), 'wall_int', collide=False, density=0.4)
    m.rail('x', SY0 + 0.05, SX0, SX0 + 1.92, F2)

    # rooms: floors, walls, ceilings
    room('corridor', X0, CY0, X1, CY1, 0, 3, 'wall_green', 'lino')
    room('shop', X0, Y0, 17, CY0, 0, 3, 'wall_beige', 'tile')
    room('lobby', 17, Y0, 26, CY0, 0, 3, 'wall_paper', 'tile')
    room('bar', 26, Y0, X1, CY0, 0, 3, 'wall_dmg', 'wood')
    room('kitchen', X0, CY1, 14, Y1, 0, 3, 'wall_beige', 'tile')
    room('store', 14, CY1, 22, Y1, 0, 3, 'wall_dmg', 'conc')
    room('well', 22, CY1, 26, Y1, 0, 6.4, 'wall_green', 'conc')
    room('boiler', 26, CY1, X1, Y1, 0, 3, 'wall_conc', 'conc')
    room('corridor2', X0, CY0, X1, CY1, F2, 3.2, 'wall_green', 'lino')
    room('apt1', X0, Y0, 11.5, CY0, F2, 3.2, 'wall_paper', 'carpet')
    room('apt1b', 11.5, Y0, 17, CY0, F2, 3.2, 'wall_beige', 'wood')
    room('apt2', 17, Y0, 21.5, CY0, F2, 3.2, 'wall_dmg', 'wood')
    room('apt2b', 21.5, Y0, 26, CY0, F2, 3.2, 'wall_paper', 'carpet')
    room('apt3', 26, Y0, X1, CY0, F2, 3.2, 'wall_beige', 'carpet')
    room('apt4', X0, CY1, 14, Y1, F2, 3.2, 'wall_dmg', 'wood')
    room('apt5', 14, CY1, 22, Y1, F2, 3.2, 'wall_paper', 'wood')
    room('apt6', 26, CY1, X1, Y1, F2, 3.2, 'wall_beige', 'carpet')
    m.zones.append(dict(a=(X0, Y0, 0), b=(X1, Y1, TOP), kind='small'))

    # ---- tenement dressing
    # the shop: two aisles of shelves, a counter
    for y in (15.2, 18.6):
        prop('steel_frame_shelves_03', 9.5, y, rot=0, part='steel_frame_shelves_03')
        prop('steel_frame_shelves_03', 13.0, y, rot=0, part='steel_frame_shelves_03')
    box((7.0, 20.0, 0), (9.0, 21.5, 1.0), 'planks', pen=True, tag='counter', density=0.5)
    m.loose('cardboard_box_01', 7.6, 20.4, z=1.0, rot=0.4, kg=3, surf='card')
    m.loose('cardboard_box_01', 15.5, 20.5, rot=1.1, kg=5, surf='card')
    m.loose('cardboard_box_01', 15.7, 20.6, z=0.35, rot=0.9, kg=3, surf='card')
    m.loose('WetFloorSign_01', 14.6, 21.2, rot=0.7, kg=1.2, surf='plastic')
    # the lobby
    prop('drawer_cabinet', 18.0, 13.6, rot=0, part='drawer_cabinet')
    prop('wooden_table_02', 24.2, 15.2, rot=1.2)
    m.loose('painted_wooden_chair_01', 23.2, 15.6, rot=2.4, kg=5)
    m.loose('korean_fire_extinguisher_01', 17.3, 21.6, rot=0, kg=6, surf='metal', shape='cyl')
    prop('fire_alarm', 18.5, 21.9, z=1.4, rot=math.pi, collide=False)
    # the bar: a long counter, stools
    box((27.0, 19.4, 0), (33.2, 20.0, 1.08), 'planks', pen=True, tag='counter', density=0.5)
    box((26.9, 19.34, 1.08), (33.3, 20.06, 1.13), 'wood_top', collide=False, density=0.4)
    prop('metal_office_desk', 30.0, 15.4, rot=0.1, part='metal_office_desk')
    m.loose('plastic_monobloc_chair_01', 28.1, 16.4, rot=0.9, kg=2.5, surf='plastic')
    m.loose('television_02', 33.0, 20.5, z=0, rot=-2.2, kg=11, surf='plastic')
    # kitchen
    prop('vintage_cabinet_01', 7.1, 31.5, rot=math.pi / 2, part='vintage_cabinet_01_body')
    prop('wooden_table_02', 10.5, 28.2, rot=0.2)
    m.loose('painted_wooden_chair_01', 11.4, 27.5, rot=-0.6, kg=5)
    m.loose('painted_wooden_chair_01', 9.2, 28.6, rot=2.0, kg=5)
    # store room
    for (x, y, r) in ((15.2, 31.8, 0.0), (18.0, 31.8, 0.0), (20.8, 31.8, 0.0)):
        prop('worn_metal_rack', x, y, rot=r)
    prop('wooden_crate_02', 16.0, 27.0, rot=1.3, part=None)
    prop('wooden_crate_01', 19.5, 26.0, rot=0.5, part=None)
    m.loose('cement_bag', 20.3, 27.8, rot=1.1, kg=25, surf='bag')
    # boiler room
    prop('portable_generator', 32.5, 31.6, rot=2.8)
    m.loose('propane_tank', 27.0, 32.1, kg=14, surf='metal', shape='cyl')
    m.loose('propane_tank', 27.5, 31.7, rot=1, kg=14, surf='metal', shape='cyl')
    prop('tool_cart', 32.4, 26.0, rot=1.5)
    m.loose('metal_jerrycan', 28.2, 25.1, rot=2.0, kg=8, surf='metal')
    # upstairs: squatted flats
    prop('sofa_03', 8.6, 21.2, z=F2, rot=math.pi)
    m.loose('television_02', 8.6, 14.0, z=F2, rot=0, kg=11, surf='plastic')
    prop('old_bed_frame', 16.0, 15.2, z=F2, rot=0)
    prop('old_bed_frame', 19.5, 15.2, z=F2, rot=0.05)
    m.loose('cardboard_box_01', 24.4, 21.0, z=F2, rot=0.7, kg=4, surf='card')
    prop('wooden_table_02', 24.0, 15.2, z=F2, rot=0.3)
    prop('drawer_cabinet', 33.2, 16.2, z=F2, rot=-math.pi / 2, part='drawer_cabinet')
    prop('sofa_03', 30.2, 21.1, z=F2, rot=math.pi)
    prop('old_bed_frame', 7.5, 30.8, z=F2, rot=math.pi / 2)
    prop('metal_office_desk', 11.0, 25.6, z=F2, rot=0, part='metal_office_desk')
    prop('wooden_crate_02', 17.5, 25.5, z=F2, rot=0.1)
    m.loose('cardboard_box_01', 20.3, 31.4, z=F2, rot=0.9, kg=4, surf='card')
    m.loose('plastic_crate_01', 19.2, 31.8, z=F2, rot=0.2, kg=1.5, surf='plastic')
    prop('old_bed_frame', 31.5, 31.0, z=F2, rot=math.pi / 2)
    prop('wooden_table_02', 28.0, 26.0, z=F2, rot=0.5)
    m.loose('trashbag', 29.5, 22.8, z=F2, kg=7, surf='bag')
    m.loose('trashbag', 12.3, 23.6, rot=1, kg=7, surf='bag')
    m.loose('WetFloorSign_01', 17.0, 23.4, rot=2.0, kg=1.2, surf='plastic')

    # ---- tenement lights: tubes in the corridors, a few live rooms, the rest dark
    TUBE = (0.82, 0.92, 1.0)
    WARM = (1.0, 0.72, 0.42)
    for x, p in ((10.0, 26), (20.0, 12), (30.0, 22)):
        light('area', (x, 23.1, 2.94), TUBE, p * 1.8, size=(1.2, 0.14))
        prop('mounted_fluorescent_lights', x, 23.1, z=2.97, rot=math.pi / 2, part='mounted_fluorescent_lights_a', collide=False)
    for x, p in ((12.0, 24), (28.0, 9)):
        light('area', (x, 23.1, 6.14), TUBE, p * 1.8, size=(1.2, 0.14))
        prop('mounted_fluorescent_lights', x, 23.1, z=6.17, rot=math.pi / 2, part='mounted_fluorescent_lights_a', collide=False)
    light('area', (11.5, 16.9, 2.94), TUBE, 42, size=(1.4, 0.2))
    light('point', (21.5, 18.0, 2.7), WARM, 24, radius=0.08)
    light('point', (30.0, 17.0, 2.5), (1.0, 0.45, 0.25), 30, radius=0.08)
    light('point', (10.0, 28.5, 2.5), WARM, 16, radius=0.08)
    light('point', (18.0, 28.5, 2.5), WARM, 7, radius=0.08)
    light('point', (24.0, 26.8, 2.8), WARM, 14, radius=0.08)
    light('point', (24.0, 28.0, 5.9), TUBE, 12, radius=0.08)
    light('point', (8.6, 17.5, 5.6), WARM, 20, radius=0.08)
    light('point', (19.5, 17.5, 5.6), WARM, 9, radius=0.08)
    light('point', (30.0, 17.5, 5.6), (1.0, 0.6, 0.35), 11, radius=0.08)
    light('point', (10.0, 28.5, 5.7), WARM, 10, radius=0.08)
    light('point', (30.0, 28.5, 2.5), (1.0, 0.5, 0.2), 12, radius=0.08)

    # ================= warehouse =================
    WX0, WX1, WY0, WY1, WH = 50.0, 86.0, 13.0, 45.0, 8.2
    QX0, QX1 = 50.5, 51.9                                 # and back up, along the shed's west wall
    box((WX0, WY0, -0.4), (QX0, WY1, 0.0), 'wfloor', tag='floor', density=0.7)
    box((QX1, WY0, -0.4), (WX1, WY1, 0.0), 'wfloor', tag='floor', density=0.7)
    box((QX0, WY0, -0.4), (QX1, HY0, 0.0), 'wfloor', tag='floor', density=0.7)
    box((QX0, HY1, -0.4), (QX1, WY1, 0.0), 'wfloor', tag='floor', density=0.7)
    box((WX0 - 0.3, WY0 - 0.3, WH), (WX1 + 0.3, WY1 + 0.3, WH + 0.25), 'tin_roof', density=0.25)
    # south: the roller door stands open; west: side door + bridge door; north, east
    east_door = door('y', WX1, 30.0, 0.0, kind='steel', swing=-1)
    holes_s = [(59.4, 64.6, 0.0, 2.74), door('x', WY0, 75.5, 0.0, kind='steel', w=1.1, h=2.2)]
    BR = 2.4
    wall('x', WY0, WX0, WX1, 0, BR, EXT_T, 'brick_b', pos='brick_b', holes=[(59.4, 64.6, 0.0, BR), holes_s[1]], tag='ext')
    wall('x', WY0, WX0, WX1, BR, WH, EXT_T, 'tin', pos='tin_in', holes=[(59.4, 64.6, BR, 2.74)], tag='ext', density=0.5)
    FAC = 'modular_factory_facade'
    WF = WY0 - EXT_T / 2 - 0.22      # the kit's face: its windows go 0.2 back into the wall
    tall = (('wall_window_tall_large_01', 'window_tall_large_01'), ('wall_window_centered_large_01', 'window_centered_large_01'), ('wall_window_centered_medium_01', 'window_centered_medium_01'))
    k = 0
    while k < 12:
        x0 = WX0 + k * 3
        if k == 3:
            m.unit(FAC, ['wall_door_garage_door_01'], x0 + 6, WF + 0.2, 0, rot=0)
            k += 2
        else:
            m.unit(FAC, ['wall_door_centered_small_01'] if k == 8 else ['wall_standard_standard_01'], x0 + 3, WF + (0.2 if k == 8 else 0.2), 0, rot=0)
            k += 1
    for k in range(12):
        x0 = WX0 + k * 3
        m.unit(FAC, list(tall[k % 3 if k % 2 else 1]), x0 + 3, WF, 3.0, rot=0)
        m.unit(FAC, ['wall_standard_standard_01'], x0 + 3, WF + 0.2, 6.0, rot=0, sc=(1, 1, 0.78))
        m.unit(FAC, ['cornice01_standard_standard_01'], x0 + 3, WF + 0.2, 3.0, rot=0)
        m.unit(FAC, ['crown_standard_standard_01'], x0 + 3, WF + 0.2, 8.34, rot=0)
    # the brick stands proud of the old wall: bodies and bullets stop at its face, not behind it
    for a, b in ((WX0, 59.4), (64.6, 74.9), (76.1, WX1)):
        m.invisible((a, WF + 0.2, 0), (b, WY0 - EXT_T / 2, WH))
    m.invisible((59.4, WF + 0.2, 2.74), (64.6, WY0 - EXT_T / 2, WH))
    m.invisible((74.9, WF + 0.2, 2.25), (76.1, WY0 - EXT_T / 2, WH))
    # the shutter, rolled up on the lintel
    box((59.4, WY0 - 0.2, 2.5), (64.6, WY0 - 0.05, 2.74), 'ruststeel', collide=False, density=0.3)

    WB = (WY1 - WY0) / 11
    hw = door('y', WX0, WY0 + 7.5 * WB, 0.0, kind='steel', w=1.1, h=2.2)
    wall('y', WX0, WY0, WY1, 0, BR, EXT_T, 'brick_b', holes=[hw], tag='ext')
    hb = door('y', WX0, 23.1, F2, kind='steel', swing=1, w=1.1, h=2.1)
    wall('y', WX0, WY0, WY1, BR, WH, EXT_T, 'tin', pos='tin_in', holes=[hb], tag='ext', density=0.5)
    # the alley side of the shed, the same brick
    WW = WX0 - EXT_T / 2 - 0.22
    kx = WB / 3
    for k in range(11):
        y0 = WY0 + k * WB
        mid = y0 + WB / 2
        m.unit(FAC, ['wall_door_centered_small_01'] if k == 7 else ['wall_standard_standard_01'], WW + 0.2, y0, 0, rot=-math.pi / 2, sc=(kx, 1, 1))
        if k == 3:
            m.unit(FAC, ['wall_door_centered_small_01'], WW + 0.2, y0, 3.0, rot=-math.pi / 2, sc=(kx, 1, 1))
        else:
            m.unit(FAC, list(tall[1 if k % 2 else 2]), WW, y0, 3.0, rot=-math.pi / 2, sc=(kx, 1, 1))
        m.unit(FAC, ['wall_standard_standard_01'], WW + 0.2, y0, 6.0, rot=-math.pi / 2, sc=(kx, 1, 0.78))
        m.unit(FAC, ['cornice01_standard_standard_01'], WW + 0.2, y0, 3.0, rot=-math.pi / 2, sc=(kx, 1, 1))
        m.unit(FAC, ['crown_standard_standard_01'], WW + 0.2, y0, 8.34, rot=-math.pi / 2, sc=(kx, 1, 1))
    dy = WY0 + 7.5 * WB
    for a, b in ((WY0, 22.5), (23.7, dy - 0.6), (dy + 0.6, WY1)):
        m.invisible((WW + 0.2, a, 0), (WX0 - EXT_T / 2, b, WH))
    m.invisible((WW + 0.2, 22.5, 0), (WX0 - EXT_T / 2, 23.7, 3.1))
    m.invisible((WW + 0.2, 22.5, 5.35), (WX0 - EXT_T / 2, 23.7, WH))
    m.invisible((WW + 0.2, dy - 0.6, 2.25), (WX0 - EXT_T / 2, dy + 0.6, WH))
    hn = door('x', WY1, 70.0, 0.0, w=1.6, h=2.4, kind='steel', swing=-1)
    m.doors[-1]['double'] = False
    wall('x', WY1, WX0, WX1, 0, BR + 0.2, EXT_T, 'brick_b', holes=[hn], tag='ext')
    wall('x', WY1, WX0, WX1, BR + 0.2, WH, EXT_T, 'tin', neg='tin_in', tag='ext', density=0.5)
    wall('y', WX1, WY0, WY1, 0, BR, EXT_T, 'brick_b', holes=[east_door], tag='ext')
    wall('y', WX1, WY0, WY1, BR, WH, EXT_T, 'tin', neg='tin_in', tag='ext', density=0.5)
    # high windows (skylight strips)
    m.zones.append(dict(a=(WX0, WY0, 0), b=(WX1, WY1, WH), kind='hall'))

    # office block in the SE corner: two rooms under the mezzanine deck
    OX0, OY1 = 72.0, 23.0
    ho = [door('y', OX0, 17.0, 0.0, swing=1), window('y', OX0, 20.5, 0.0, wt=INT_T, glass=False)]
    wall('y', OX0, WY0, OY1, 0, 3.0, 0.16, 'wall_int', holes=ho, pen=True, tag='int')
    ho = [door('x', OY1, 79.0, 0.0, swing=-1), window('x', OY1, 75.0, 0.0, wt=INT_T, glass=False)]
    wall('x', OY1, OX0, WX1, 0, 3.0, 0.16, 'wall_int', holes=ho, pen=True, tag='int')
    wall('y', 80.0, WY0, OY1, 0, 3.0, 0.16, 'wall_int', pen=True, tag='int', holes=[door('y', 80.0, 18.0, 0.0, swing=-1)])
    box((OX0 - 0.08, WY0, 3.0), (WX1, OY1 + 0.08, 3.2), 'slab', tag='floor')
    room('office', OX0, WY0, 80, OY1, 0, 3, 'wall_beige', 'carpet')
    room('office2', 80, WY0, WX1, OY1, 0, 3, 'wall_dmg', 'lino')
    prop('metal_office_desk', 76.0, 15.0, rot=0, part='metal_office_desk')
    prop('drawer_cabinet', 79.2, 22.3, rot=math.pi, part='drawer_cabinet')
    m.loose('plastic_monobloc_chair_01', 75.0, 16.6, rot=2.5, kg=2.5, surf='plastic')
    prop('metal_office_desk', 83.5, 20.5, rot=math.pi, part='metal_office_desk')
    m.loose('cardboard_box_01', 84.8, 14.1, rot=0.3, kg=5, surf='card')
    m.loose('cardboard_box_01', 84.6, 14.3, z=0.35, rot=1.0, kg=3, surf='card')
    light('area', (76.0, 18.0, 2.94), TUBE, 16, size=(1.2, 0.3))

    # mezzanine: west side and north side, a steel deck on posts
    MZ = F2
    box((WX0 + 0.16, WY0, MZ - 0.12), (56.0, WY1, MZ), 'grate', tag='floor', density=0.5)
    box((56.0, 39.0, MZ - 0.12), (WX1, WY1, MZ), 'grate', tag='floor', density=0.5)
    m.rail('y', 56.0, WY0, 39.0, MZ)
    m.rail('x', 39.0, 56.0, 78.0, MZ)
    m.rail('x', 39.0, 81.0, WX1 - 0.2, MZ)
    for y in (17.0, 25.0, 33.0):
        box((55.84, y - 0.09, 0), (56.02, y + 0.09, MZ - 0.12), 'steel', tag='post', density=0.2)
    for x in (62.0, 70.0, 80.0):
        box((x - 0.09, 38.86, 0), (x + 0.09, 39.04, MZ - 0.12), 'steel', tag='post', density=0.2)
    # stairs up to the north deck, and a ladder-steep flight on the office deck
    m.stairs(78.2, 32.8, 80.8, 39.0, 0, MZ, '+y', mat='steelstep', solid=False)
    m.rail('y', 78.15, 32.8, 39.0, 0.0, mat='steel')
    # deck on top of the offices joined to the north deck by a catwalk at the east wall
    box((83.0, OY1, MZ - 0.12), (WX1 - 0.16, 39.0, MZ), 'grate', tag='floor', density=0.5)
    m.rail('y', 83.0, OY1, 39.0, MZ)
    m.rail('x', OY1 + 0.05, OX0, 83.0, MZ)
    m.rail('y', OX0 - 0.05, WY0, OY1, MZ)

    # pallet racking: three long runs, gaps to cut through
    def racks(y, x0, x1, z_levels=(1.55, 3.1, 4.65)):
        n = int((x1 - x0) / 2.7)
        for i in range(n + 1):
            x = x0 + i * 2.7
            for yy in (y - 0.55, y + 0.55):
                box((x - 0.05, yy - 0.05, 0), (x + 0.05, yy + 0.05, 5.0), 'rack_blue', tag='post', density=0.15)
        for z in z_levels:
            for yy in (y - 0.55, y + 0.55):
                box((x0, yy - 0.05, z), (x0 + n * 2.7, yy + 0.05, z + 0.12), 'rack_orange', collide=False, density=0.15)
        # a solid back so racks are real cover
        for i in range(n):
            xa = x0 + i * 2.7
            for k, z in enumerate((0.14,) + z_levels):
                r = m.rng.random()
                if r < 0.78:
                    w = m.rng.choice((1.1, 1.2, 2.3))
                    xc = xa + 0.2
                    box((xc, y - 0.52, z + 0.12), (xc + w, y + 0.52, z + 0.14), 'pallet', collide=False, density=0.1)
                    m.cargo(xc + 0.02, y - 0.5, z + 0.14, xc + w - 0.02, y + 0.5, m.rng.choice((2, 3)) if k < 2 else 2)
    racks(29.0, 60.0, 76.0)
    racks(35.0, 58.0, 68.0)
    racks(23.0, 58.2, 69.0)
    # floor clutter
    prop('wooden_military_crate', 60.5, 18.0, rot=0.3)
    m.loose('wooden_military_crate', 60.45, 18.05, z=0.46, rot=0.4, kg=18)
    m.loose('barrel_03', 69.0, 16.0, kg=16, surf='metal', shape='cyl')
    m.loose('barrel_03', 69.75, 16.5, rot=1, kg=16, surf='metal', shape='cyl')
    m.loose('barrel_03', 69.2, 17.05, rot=2, kg=16, surf='metal', shape='cyl')
    m.loose('hand_truck', 68.0, 25.0, rot=2.2, kg=11, surf='metal')
    prop('tool_cart', 52.0, 15.5, rot=math.pi / 2)
    prop('steel_frame_shelves_03', 53.0, 42.5, rot=0, part='steel_frame_shelves_03')
    prop('steel_frame_shelves_03', 56.2, 43.5, rot=0, part='steel_frame_shelves_03')
    m.cargo(73, 40.0, 0, 76.5, 42.0, 4)
    m.cargo(77.2, 42.0, 0, 79.2, 44.4, 3)
    m.cargo(52.4, 28.0, 0, 54.6, 30.2, 4)
    m.cargo(80.0, 26.0, 0, 82.4, 28.0, 4)
    prop('ladder_sectioned_01', 62.1, 38.6, rot=0, part='ladder_section_01', collide=False)
    # mezzanine cover
    m.cargo(51.0, 30.0, MZ, 53.0, 31.2, 3)
    m.cargo(53.8, 18.0, MZ, 55.3, 19.1, 3)
    m.cargo(66.0, 41.2, MZ, 68.2, 43.0, 3)
    prop('wooden_crate_02', 84.3, 30.0, z=MZ, rot=0.1)

    # hanging lamps, warm pools with dark between
    for (x, y, p) in ((62, 19, 80), (75, 29, 70), (63, 40, 46), (53, 22, 30), (67, 26, 60), (53, 36, 36), (80, 36, 50), (70, 16.5, 44)):
        prop('hanging_industrial_lamp', x, y, z=6.8, collide=False)
        light('spot', (x, y, 6.72), (1.0, 0.78, 0.5), p * 12, spot=2.0, blend=0.75, radius=0.1, aim=(0, 0, -1))
    # dusk through the open door and high skylights
    for x, y in ((64, 32), (74, 20), (70, 41)):
        light('point', (x, y, 5.2), (0.62, 0.72, 1.0), 150, radius=0.5)
    for x in (58, 70, 80):
        box((x, 28.4, WH - 0.01), (x + 3.0, 29.6, WH + 0.02), 'skylight', collide=False, density=0.1)

    # ================= the bridge across the alley =================
    box((34.16, 22.0, F2 - 0.1), (49.84, 24.2, F2), 'grate', tag='floor', density=0.5)
    m.rail('x', 22.0, 34.2, 49.6, F2)
    m.rail('x', 24.2, 34.2, 49.6, F2)
    for x in (37.5, 46.5):
        for y in (22.05, 24.15):
            box((x - 0.07, y - 0.07, 0), (x + 0.07, y + 0.07, F2 - 0.1), 'ruststeel', tag='post', density=0.2)

    # ================= the alley =================
    # dumpsters and clutter leave a zig-zag through
    def dumpster(x, y, rot90=False):
        w, d, h = (2.0, 1.3, 1.35) if not rot90 else (1.3, 2.0, 1.35)
        box((x, y, 0.16), (x + w, y + d, h), 'dumpster', tag='container', density=0.5)
        box((x - 0.04, y - 0.04, h), (x + w + 0.04, y + d + 0.04, h + 0.1), 'plastic_black', collide=False, density=0.4)
    dumpster(35.0, 15.5, True)
    dumpster(47.4, 27.0, True)
    dumpster(35.0, 37.0, True)
    m.loose('trashbag', 37.0, 16.2, rot=0.4, kg=7, surf='bag')
    m.loose('trashbag', 37.5, 15.5, rot=2.4, kg=7, surf='bag')
    m.loose('trashbag', 46.8, 26.6, rot=2.4, kg=7, surf='bag')
    m.loose('trashbag', 36.8, 36.2, rot=1.4, kg=7, surf='bag')
    m.loose('metal_trash_can', 49.0, 15.5, part='metal_trash_can', kg=6, surf='metal', shape='cyl')
    m.loose('barrel_03', 49.0, 20.6, kg=16, surf='metal', shape='cyl')
    prop('wooden_crate_01', 34.8, 30.2, rot=0.3)
    prop('wooden_crate_02', 42.5, 30.5, rot=1.0)
    m.loose('wooden_crate_02', 42.5, 30.45, z=0.5, rot=1.2, kg=16)
    m.loose('old_tyre', 44.0, 19.5, rot=0.2, kg=9, surf='rubber', shape='cyl')
    prop('exterior_aircon_unit', 34.5, 26.0, z=2.0, rot=-math.pi / 2, part='exterior_aircon_unit', collide=False)
    prop('utility_box_02', 49.4, 39.2, rot=math.pi / 2)
    prop('power_box_01', 34.3, 18.8, z=1.6, rot=-math.pi / 2, part='power_box_01_box', collide=False)
    prop('security_light', 49.6, 33.0, z=3.5, rot=-math.pi / 2, part='security_light', collide=False)
    light('spot', (49.2, 33.0, 3.5), (1.0, 0.92, 0.72), 340, spot=2.2, blend=0.8, radius=0.1, aim=(-0.6, 0, -0.7))
    light('point', (34.6, 23.1, 2.55), (1.0, 0.7, 0.4), 16, radius=0.06)
    prop('industrial_wall_lamp', 34.3, 23.1, z=2.45, rot=-math.pi / 2, collide=False)
    # yard end of the alley
    light('spot', (49.4, 50.0, 4.5), (1.0, 0.7, 0.42), 300, spot=2.4, blend=0.8, radius=0.1, aim=(-0.4, 0.1, -0.8))

    # ================= west yard =================
    box((14.0, 33.2, 0), (21.5, 33.3, 0), 'yard', collide=False, density=0.01)
    m.container(4.0, 40.0, 0, tint='cont_a')
    m.container(4.0, 42.44, 0, tint='cont_b')
    m.container(4.0, 41.2, 2.59, tint='cont_c')
    m.container(21.0, 37.0, 0, rot90=True, tint='cont_b')
    m.container(14.0, 52.0, 0, tint='cont_c')
    m.container(26.0, 52.0, 0, rot90=False, tint='cont_a')
    prop('wooden_crate_02', 14.5, 39.5, rot=0.4)
    prop('wooden_crate_01', 15.6, 38.7, rot=1.5)
    prop('concrete_road_barrier', 9.5, 37.0, rot=0.1)
    prop('concrete_road_barrier', 29.5, 46.0, rot=1.4)
    m.loose('old_tyre', 18.2, 45.0, rot=1.2, kg=9, surf='rubber', shape='cyl')
    prop('portable_generator', 12.2, 48.0, rot=0.5)
    # fire escape up to the tenement's north door
    FE_X = 28.5
    box((FE_X - 1.1, 33.2, F2 - 0.1), (FE_X + 1.1, 34.6, F2), 'grate', tag='floor', density=0.3)
    m.stairs(20.8, 33.3, 27.4, 34.5, 0, F2, '+x', mat='steelstep', solid=False)
    m.rail('x', 34.6, 20.8, FE_X + 1.1, F2 * 0.5, h=1.6, mat='ruststeel')
    light('spot', (30.0, 33.5, 2.85), (1.0, 0.86, 0.6), 130, spot=2.3, blend=0.8, radius=0.08, aim=(0, 0.6, -0.8))
    prop('security_light', 30.0, 33.3, z=2.9, rot=0, part='security_light', collide=False)

    # ================= north yard =================
    m.container(53.0, 48.0, 0, tint='cont_c')
    m.container(53.0, 50.44, 0, tint='cont_a')
    m.container(66.0, 53.0, 0, rot90=True, tint='cont_b')
    m.container(76.0, 47.5, 0, tint='cont_a')
    m.container(76.0, 47.5, 2.59, tint='cont_b')
    m.container(88.0, 52.0, 0, rot90=True, tint='cont_c')
    prop('wooden_military_crate', 62.0, 47.0, rot=0.2)
    prop('concrete_road_barrier', 72.0, 56.0, rot=0.5)
    prop('concrete_road_barrier', 44.0, 54.0, rot=1.2)
    prop('concrete_road_barrier', 42.0, 46.0, rot=1.57)
    m.loose('barrel_03', 59.0, 56.0, kg=16, surf='metal', shape='cyl')
    m.loose('barrel_03', 59.7, 56.5, rot=1, kg=16, surf='metal', shape='cyl')
    m.loose('propane_tank', 74.0, 46.5, kg=14, surf='metal', shape='cyl')
    light('spot', (70.0, 45.5, 4.2), (1.0, 0.72, 0.42), 340, spot=2.4, blend=0.8, radius=0.1, aim=(0, 0.7, -0.7))
    prop('security_light', 70.0, 45.3, z=4.3, rot=0, part='security_light', collide=False)

    # ================= east lot =================
    prop('concrete_road_barrier', 90.0, 18.0, rot=1.5)
    prop('concrete_road_barrier', 91.5, 31.0, rot=0.1)
    prop('utility_box_01', 86.5, 38.0, rot=-math.pi / 2)
    prop('wooden_crate_02', 93.0, 25.0, rot=0.8)
    prop('covered_car', 92.5, 41.0, rot=0.1, part=None, collide=(1.0, 2.3, 0.75))
    light('spot', (86.4, 30.0, 4.0), (1.0, 0.8, 0.5), 240, spot=2.4, blend=0.8, radius=0.1, aim=(0.7, 0, -0.7))
    prop('security_light', 86.3, 30.0, z=4.1, rot=math.pi / 2, part='security_light', collide=False)

    # ================= the street =================
    prop('covered_car', 18.0, 2.3, rot=math.pi / 2 + 0.03, collide=(2.3, 1.0, 0.75))
    prop('covered_car', 44.0, 7.8, rot=math.pi / 2 - 0.04, collide=(2.3, 1.0, 0.75))
    prop('covered_car', 72.0, 2.2, rot=math.pi / 2 + 0.02, collide=(2.3, 1.0, 0.75))
    for x, y, r in ((31, 5, 0.3), (33, 6.2, 0.2), (56, 3.5, 1.1), (60.5, 7.0, -0.2), (84, 4.5, 1.4), (6, 6, 1.5), (42, 11.5, 0.05), (11, 3.8, 0.7), (26.5, 7.6, 1.2), (47, 2.4, 0.4), (66, 3.6, 0.1), (74, 7.4, 1.5), (90, 7.0, 0.6)):
        prop('concrete_road_barrier', x, y, z=-0.12 if y < 10 else 0, rot=r)
    prop('fire_hydrant', 25.5, 11.0, rot=0, part='fire_hydrant', collide=(0.2, 0.2, 0.4))
    for x, y in ((12.0, 5.5), (50.0, 3.3), (70.0, 6.0)):
        prop('water_manhole_cover', x, y, z=-0.12, part='water_manhole_cover', collide=False)
    m.loose('metal_trash_can', 16.5, 11.8, part='metal_trash_can', kg=6, surf='metal', shape='cyl')
    m.loose('trashbag', 17.2, 11.6, kg=7, surf='bag')
    m.loose('trashbag', 40.8, 12.2, rot=1.2, kg=7, surf='bag')
    prop('utility_box_01', 55.0, 12.3, rot=math.pi)
    prop('utility_box_02', 3.0, 12.0, rot=math.pi)
    for x in (8.0, 38.0, 68.0, 94.0):
        prop('street_lamp_01', x, 11.0, rot=math.pi / 2, scale=1.75, collide=(0.12, 0.12, 3.4))
        light('spot', (x, 9.4, 6.5), (1.0, 0.62, 0.3), 1300, spot=2.5, blend=0.9, radius=0.15, aim=(0, -0.1, -1))
    for x in (23.0, 53.0, 83.0):
        prop('street_lamp_01', x, -1.2, rot=-math.pi / 2, scale=1.75, collide=(0.12, 0.12, 3.4))
        light('spot', (x, 0.4, 6.5), (1.0, 0.62, 0.3), 1300, spot=2.5, blend=0.9, radius=0.15, aim=(0, 0.1, -1))

    # ================= across the street =================
    # a terrace of kit buildings, each with its own height and paint; two shops are open, and a service
    # passage runs behind them, so the long street has a second way along it
    SY = -3.4
    BK = SY - 8
    CW = -9.7                    # the wall between the shops and the passage
    DN0, DN1, BB0, BB1 = 31.0, 43.0, 64.0, 76.0
    box((DN0 - 1, BK, -0.4), (BB1 + 1, SY, 0.0), 'slab', tag='floor', density=0.5)
    for a, b in ((-44, DN0), (DN1, BB0), (BB1, 140)):
        box((a, CW - 0.1, 0), (b, SY, 3.2), 'brick_c', tag='ext', density=0.25)
    box((-44, BK, 0), (DN0, CW - 0.1, 3.2), 'brick_c', tag='ext', density=0.1)
    box((BB1, BK, 0), (140, CW - 0.1, 3.2), 'brick_c', tag='ext', density=0.1)
    hd = door('x', CW, DN0 + 2.0, 0.0, kind='steel', swing=-1)
    hb2 = door('x', CW, BB1 - 2.0, 0.0, kind='steel', swing=-1)
    wall('x', CW, DN0, DN1, 0, 3.2, 0.2, 'wall_int', holes=[hd], tag='ext')
    wall('x', CW, BB0, BB1, 0, 3.2, 0.2, 'wall_int', holes=[hb2], tag='ext')
    # the shop fronts: door, plate glass, frames
    def shopfront(x0, x1, dcol):
        holes = []
        for k in range(4):
            c0 = x0 + k * 3
            if k == dcol:
                holes.append(door('x', SY - 0.15, c0 + 1.0, 0.0, w=1.0, h=2.2, kind='street', t=0.05))
            else:
                a, b = c0 + 0.3, c0 + 2.7
                m.casing('x', SY - 0.15, a, b, 0.6, 2.35, 0.32, 'shopframe', sill=True)
                m.glass.append(dict(axis='x', c=SY - 0.15, a=a, b=b, z0=0.6, z1=2.35))
                holes.append((a, b, 0.6, 2.35))
        wall('x', SY - 0.15, x0, x1, 0, 3.2, 0.3, 'plinth', pos='plinth', holes=holes, tag='ext', density=0.5)
    shopfront(DN0, DN1, 2)
    shopfront(BB0, BB1, 1)
    room('diner', DN0, CW, DN1, SY, 0, 3.2, 'wall_beige', 'tile')
    room('barber', BB0, CW, BB1, SY, 0, 3.2, 'wall_green', 'lino')
    room('passage', DN0 - 1, BK, BB1 + 1, CW, 0, 3.2, 'wall_conc', 'conc')
    m.zones.append(dict(a=(DN0 - 1, BK, -0.3), b=(BB1 + 1, SY, 3.2), kind='small'))
    box((DN0 - 1, BK, 3.2), (DN0, CW, 3.2), 'brick_c', collide=False, density=0.01)
    # the terrace
    APTK = 'modular_urban_apartments_facade'
    blocks = ((-14, 4, 3, (0.62, 0.6, 0.56)), (-2, 5, 4, (0.9, 0.84, 0.72)), (13, 4, 3, (0.66, 0.5, 0.42)), (25, 6, 4, (0.82, 0.8, 0.76)), (43, 5, 3, (0.72, 0.72, 0.62)), (58, 6, 4, (0.92, 0.82, 0.66)), (76, 5, 3, (0.56, 0.58, 0.6)), (91, 7, 4, (0.84, 0.76, 0.66)))
    ups = (('wall_window_centered_large_01', 'window_centered_large_01'), ('wall_window_centered_double_01', 'window_centered_double_01'), ('wall_window_centered_small_01', 'window_centered_small_01'), ('wall_window_centered_large_03', 'window_centered_large_03'), ('wall_window_centered_double_03', 'window_centered_double_03'))
    FY = SY + 0.25
    for bi, (x0, n, fl, tint) in enumerate(blocks):
        top = 3.2 + 3 * fl
        box((x0, BK, 3.2), (x0 + n * 3, SY, top), 'brick_a', tag='ext', density=0.03)
        box((x0 - 0.02, BK, top + 0.0), (x0 + n * 3 + 0.02, SY - 0.1, top + 0.3), 'roof', collide=False, density=0.04)
        style = (ups[bi % 5], ups[(bi + 2) % 5])
        for c in range(n):
            xc = x0 + c * 3
            open_shop = DN0 <= xc < DN1 or BB0 <= xc < BB1
            if not open_shop:
                g = ('wall_door_centered_large_01', 'door_centered_large_01') if (c + bi) % 4 == 1 else ('wall_door_window_small_03', 'door_window_small_03') if (c + bi) % 2 else ('wall_door_window_small_07', 'door_window_small_07')
                m.unit(APTK, list(g), xc, FY, 0, rot=math.pi, tint=(0.5, 0.48, 0.45))
            else:
                k = (xc - (DN0 if xc < 50 else BB0)) // 3
                door_col = 2 if xc < 50 else 1
                m.unit(APTK, ['wall_door_centered_small_01'] if k == door_col else ['wall_window_centered_double_01'], xc, SY + 0.012, 0, rot=math.pi, tint=(0.42, 0.42, 0.42))
            m.unit(APTK, ['cornice_standard_standard_01'], xc, SY + 0.26 if not open_shop else SY + 0.02, 3.0, rot=math.pi, sc=(1, 3, 1), tint=tint)
            for f in range(fl):
                u = style[(c + f) % 2 if (c % 3 != 2) else 0]
                m.unit(APTK, list(u), xc, FY, 3.2 + f * 3, rot=math.pi, tint=tint)
            m.unit(APTK, ['crown_standard_standard_01'], xc, FY, top, rot=math.pi, tint=tint)
    for a, b in ((-14, DN0), (DN1, BB0), (BB1, 112)):
        m.invisible((a, SY, 0), (b, FY, 3.2))
    m.invisible((-14, SY, 3.2), (112, FY, 16))
    for x, w in ((7.0, 4.6), (19.0, 4.6), (37.0, 5.6), (52.0, 4.6), (70.0, 5.6), (85.0, 4.6)):
        yy = FY if not (DN0 <= x < DN1 or BB0 <= x < BB1) else SY + 0.03
        box((x - w / 2, yy, 2.5), (x + w / 2, yy + 0.1, 3.0), 'signboard', collide=False, density=0.2)
    for x in (10.0, 34.0, 58.0, 82.0):
        m.downpipe(x, FY + 0.06, 12.0)
    # the service passage: pipes along it, a lamp every so often, the odd dark stretch
    m.hpipe(DN0 - 0.6, BB1 + 0.6, CW - 0.24, 2.5)
    m.hpipe(DN0 - 0.6, BB1 + 0.6, BK + 0.2, 2.75)
    # bare bulbs down the service passage, far enough apart to leave dark between them
    for lx in range(int(DN0) + 6, int(BB1), 9):
        light('point', (lx, (BK + CW) / 2, 2.75), (1.0, 0.72, 0.42), 26, radius=0.06)
    for x, p in ((34.5, 16), (49, 8), (61, 12), (72.5, 16)):
        light('point', (x, -10.6, 2.75), (1.0, 0.76, 0.5), p, radius=0.06)
        prop('caged_hanging_light', x, -10.6, z=2.65, collide=False)
    for (x, n, kg, sf) in ((38.5, 'cardboard_box_01', 4, 'card'), (39.1, 'plastic_crate_02', 2, 'plastic'), (44.0, 'metal_jerrycan_green', 8, 'metal'), (55.0, 'cardboard_box_01', 4, 'card'), (55.6, 'cardboard_box_01', 4, 'card'), (66.0, 'plastic_crate_03', 2, 'plastic')):
        m.loose(n, x, -10.9, rot=x, kg=kg, surf=sf)
    prop('wooden_crate_01', 47.5, -10.75, rot=0.2)
    prop('metal_trash_can', 60.0, -10.9, part='metal_trash_can', collide=(0.3, 0.3, 0.45))
    # the diner
    box((DN0 + 0.6, -7.2, 0), (DN0 + 7.4, -6.7, 1.05), 'planks', pen=True, tag='counter', density=0.5)
    box((DN0 + 0.5, -7.28, 1.05), (DN0 + 7.5, -6.62, 1.1), 'wood_top', collide=False, density=0.4)
    for i in range(6):
        m.loose('bar_chair_round_01', DN0 + 1.2 + i * 1.1, -6.1, rot=i, kg=6, surf='metal')
    prop('CashRegister_01', DN0 + 1.1, -6.95, z=1.1, rot=math.pi, collide=False)
    prop('CoffeeCart_01', DN0 + 6.0, -8.6, rot=0.0)
    prop('electric_stove', DN0 + 3.0, -9.1, rot=0)
    prop('electric_stove', DN0 + 4.0, -9.1, rot=0)
    prop('vintage_microwave', DN0 + 1.6, -9.1, z=0.95, rot=0.1, collide=False)
    box((DN0 + 1.0, -9.5, 0), (DN0 + 2.3, -8.9, 0.92), 'steel', tag='counter', density=0.4)
    for (x, y, r) in ((39.4, -4.6, 0.0), (41.6, -4.6, 0.0), (41.6, -7.8, 0.0)):
        prop('dining_table', x, y, rot=r, scale=0.72)
        m.loose('dining_chair_02', x - 0.6, y + 0.1, rot=1.57, kg=5)
        m.loose('dining_chair_02', x + 0.6, y - 0.1, rot=-1.57, kg=5)
    m.loose('wine_bottles_01', DN0 + 3.2, -6.95, z=1.1, kg=2, surf='plastic')
    prop('wall_clock', DN1 - 0.05, -6.6, z=2.3, rot=math.pi / 2, collide=False)
    for x, p in ((34.5, 30), (40.0, 26)):
        light('area', (x, -6.5, 3.1), (1.0, 0.9, 0.74), p, size=(1.2, 0.3))
        prop('mounted_fluorescent_lights', x, -6.5, z=3.16, rot=math.pi / 2, part='mounted_fluorescent_lights_a', collide=False)
    # the barber's
    for i, x in enumerate((BB0 + 2.0, BB0 + 5.0, BB0 + 8.0)):
        prop('BarberShopChair_01', x, -8.0, rot=math.pi, collide=(0.33, 0.33, 0.6))
        prop('ornate_mirror_01', x, CW + 0.14, z=1.1, rot=0, collide=False, scale=1.2)
    for i in range(5):
        m.loose('SchoolChair_01', BB0 + 1.5 + i * 0.9, -4.1, rot=math.pi, kg=6)
    prop('side_table_01', BB0 + 6.5, -4.2, collide=False)
    prop('CashRegister_01', BB1 - 1.2, -8.4, z=0.95, rot=0, collide=False)
    box((BB1 - 1.8, -8.9, 0), (BB1 - 0.4, -7.9, 0.95), 'planks', pen=True, tag='counter', density=0.5)
    prop('potted_plant_02', BB1 - 0.8, -4.1, collide=False)
    for x, p in ((67.5, 30), (72.5, 16)):
        light('area', (x, -6.5, 3.1), (0.86, 0.96, 1.0), p, size=(1.2, 0.2))
        prop('mounted_fluorescent_lights', x, -6.5, z=3.16, rot=math.pi / 2, part='mounted_fluorescent_lights_a', collide=False)

    # the far buildings: they close the sky and carry lit windows
    def far(x0, y0, x1, y1, h, mat='brick_a'):
        box((x0, y0, 0), (x1, y1, h), mat, tag='far', density=0.03)
    far(-60, 13, -8, 70, 18, 'brick_b')
    far(104, 13, 150, 70, 22, 'brick_a')
    far(-60, 70, 150, 92, 26, 'brick_c')
    far(-60, -40, 150, -11.4, 24, 'brick_b')
    # the far blocks wear the kit too, in a cheap copy: no lightmap, just shapes and lit rooms
    tints = ((0.5, 0.48, 0.45), (0.42, 0.36, 0.33), (0.36, 0.38, 0.4), (0.46, 0.42, 0.36))
    uf = (('wall_window_centered_large_01', 'window_centered_large_01'), ('wall_window_centered_double_01', 'window_centered_double_01'), ('wall_window_centered_small_01', 'window_centered_small_01'))
    def farface(rot, fixed, a0, a1, hgt, step):
        p = a0
        i = 0
        while p < a1:
            t = tints[(i // 6) % 4]
            z = 0.0
            f = 0
            while z < hgt - 3:
                u = uf[(i + f * 2) % 3]
                if rot == math.pi: m.unit(APT, list(u), p, fixed, z, rot=rot, tint=t, far=True)
                elif rot == 0: m.unit(APT, list(u), p + 3, fixed, z, rot=rot, tint=t, far=True)
                elif rot > 0: m.unit(APT, list(u), fixed, p + 3, z, rot=rot, tint=t, far=True)
                else: m.unit(APT, list(u), fixed, p, z, rot=rot, tint=t, far=True)
                z += 3
                f += 1
            p += step
            i += 1
    farface(0, 69.8, -12, 110, 26, 3)
    farface(math.pi / 2, -7.8, 12, 70, 18, 3)
    farface(-math.pi / 2, 103.8, 12, 70, 22, 3)
    p = -12
    i = 0
    while p < 110:
        z = 12.0
        while z < 22:
            m.unit(APT, list(uf[i % 3]), p, -11.2, z, rot=math.pi, tint=tints[(i // 5) % 4], far=True)
            z += 3
        p += 3
        i += 1

    # boundary: yard walls, street closures
    wall('y', -0.16, 13, 62, 0, 3.6, 0.3, 'brick_c', tag='ext', density=0.4)
    wall('x', 62.15, 0, 96, 0, 3.6, 0.3, 'brick_c', tag='ext', density=0.4)
    wall('y', 96.16, 13, 62, 0, 3.6, 0.3, 'brick_c', tag='ext', density=0.4)
    wall('x', 13.0, 0, 6, 0, 3.6, 0.3, 'brick_c', tag='ext', density=0.4, holes=[(1.4, 4.8, 0, 3.0)])
    wall('x', 13.0, 86, 96, 0, 3.6, 0.3, 'brick_c', tag='ext', density=0.4, holes=[(89.0, 93.0, 0, 3.0)])
    wall('x', 13.0, 34, 50, 0, 3.6, 0.3, 'brick_c', tag='ext', density=0.4, holes=[(38.0, 46.0, 0, 3.0)])
    # the street ends: closed with barriers and a hoarding
    m.invisible((-0.6, -3.4, -1), (0, 13, 6))
    m.invisible((96, -3.4, -1), (96.6, 13, 6))
    for x in (-0.4, 96.4):
        box((x - 0.05, -3.2, 0), (x + 0.05, 12.8, 2.4), 'hoarding', collide=False, density=0.25)
    m.invisible((-1, -4, 13), (97, 63, 14))
    m.invisible((-0.6, -3.4, 6), (0, 13, 13))
    m.invisible((96, -3.4, 6), (96.6, 13, 13))


    # ================= the things that make it a place =================
    # the tenement: a stone course per floor, a plinth, downpipes
    for z in (F2 - 0.1,):
        box((X0 - 0.06, Y0 - 0.26, z), (X1 + 0.06, Y0 - 0.16, z + 0.16), 'stone', collide=False, density=0.1)
        box((X0 - 0.26, Y0 - 0.06, z), (X0 - 0.16, Y1 + 0.06, z + 0.16), 'stone', collide=False, density=0.1)
        box((X1 + 0.16, Y0 - 0.06, z), (X1 + 0.26, Y1 + 0.06, z + 0.16), 'stone', collide=False, density=0.1)
        box((X0 - 0.06, Y1 + 0.16, z), (X1 + 0.06, Y1 + 0.26, z + 0.16), 'stone', collide=False, density=0.1)
    box((X0 - 0.3, Y0 - 0.3, TOP - 0.02), (X1 + 0.3, Y0 - 0.16, TOP + 0.3), 'stone', collide=False, density=0.1)
    for a, b in (((16.5, Y0 - 0.2), (21.3, Y0 - 0.16)), ((22.8, Y0 - 0.2), (X1, Y0 - 0.16))):
        box((a[0], a[1], 0), (b[0], b[1], 0.5), 'plinth', collide=False, density=0.15)
    m.downpipe(X0 + 0.25, Y0 - 0.26, TOP)
    m.downpipe(X1 - 0.25, Y0 - 0.26, TOP)
    m.downpipe(X1 + 0.26, 26.0, TOP)
    m.downpipe(X0 - 0.26, 20.2, TOP)
    # the warehouse: piers on the outside, trusses and purlins under the roof, ducts, pipes
    for x in range(53, 85, 6):
        box((x - 0.07, WY0 + 0.2, WH - 1.05), (x + 0.07, WY1 - 0.2, WH - 0.9), 'steel', collide=False, density=0.1)
        box((x - 0.07, WY0 + 0.2, WH - 0.2), (x + 0.07, WY1 - 0.2, WH - 0.08), 'steel', collide=False, density=0.1)
        for y in range(15, 44, 3):
            box((x - 0.035, y - 0.035, WH - 0.9), (x + 0.035, y + 0.035, WH - 0.2), 'steel', collide=False, density=0.08)
    for y in range(16, 44, 5):
        box((WX0 + 0.2, y - 0.05, WH - 0.08), (WX1 - 0.2, y + 0.05, WH - 0.01), 'steel', collide=False, density=0.08)
    y = 14.2
    while y < 44.4:
        prop('modular_airduct_rectangular_01', 58.0, y, z=6.15, part='modular_airduct_rectangular_01_single_01', collide=False)
        y += 0.595
    m.hpipe(50.4, 85.6, WY1 - 0.26, 2.9)
    m.hpipe(50.4, 85.6, WY1 - 0.26, 3.2)
    m.hpipe(50.4, 71.0, WY0 + 0.3, 3.0)
    m.hpipe(26.3, 33.6, Y1 - 0.3, 2.45)
    m.hpipe(26.3, 33.6, Y1 - 0.3, 2.15)
    for x in (27.0, 31.0):
        for z in (0.0, 1.0):
            prop('modular_industrial_pipes_01', x, Y1 - 0.3, z=z, part='modular_industrial_pipes_01_pipe02', collide=False, scale=0.55)
    for x in (58, 70, 80):
        light('area', (x + 1.5, 29.0, WH - 0.05), (0.58, 0.68, 1.0), 170, size=(3.0, 1.2))
    # fire escapes on the alley side and the west side, reachable from the windows
    for (x, y, r) in ((X1 + 0.82, 17.5, -math.pi / 2), (X0 - 0.82, 17.0, math.pi / 2)):
        prop('modular_fire_escape', x, y, z=F2 - 0.68, rot=r, part='modular_fire_escape_platform_middle', collide=False)
        prop('modular_fire_escape', x, y, z=F2 + 0.02, rot=r, part='modular_fire_escape_railing_middle', collide=False)
        s = 1 if x > X1 else -1
        m.invisible((min(x - 0.68 * s, x + 0.68 * s), y - 2.4, F2 - 0.1), (max(x - 0.68 * s, x + 0.68 * s), y + 2.4, F2))
    # chain-link across the yards: you can see and shoot through it, not walk
    for (x, y, r, n) in ((22.5, 47.2, 0.0, 4), (80.4, 45.8, math.pi / 2, 0), (37.0, 58.0, 0.0, 3)):
        for i in range(n):
            prop('modular_chainlink_fence', x + i * 1.91, y, rot=r, part='modular_chainlink_fence_double', collide=False)
            prop('modular_chainlink_fence', x + i * 1.91 - 0.955, y, part='modular_chainlink_fence_post', collide=False)
        if n:
            prop('modular_chainlink_fence', x + n * 1.91 - 0.955, y, part='modular_chainlink_fence_post', collide=False)
            m.invisible((x - 0.95, y - 0.04, 0), (x + n * 1.91 - 0.95, y + 0.04, 2.4), pen=True)
    # the street's paint: lane dashes, bay lines, two crossings
    RZ = -0.114
    for x in range(1, 95, 5):
        box((x, 4.93, -0.2), (x + 2.4, 5.07, RZ), 'paint', collide=False, density=0.08)
    for x0, x1 in ((14.0, 24.0), (40.0, 49.0), (66.0, 78.0)):
        box((x0, 8.0, -0.2), (x1, 8.1, RZ), 'paint', collide=False, density=0.08)
        box((x0, 1.9, -0.2), (x1, 2.0, RZ), 'paint_y', collide=False, density=0.08)
    for cx in (30.0, 63.0):
        for k in range(9):
            y0 = 0.5 + k * 1.02
            box((cx - 1.6, y0, -0.2), (cx + 1.6, y0 + 0.52, RZ), 'paint', collide=False, density=0.1)
    for x in (0.5, 95.0):
        box((x, 0.2, -0.2), (x + 0.3, 9.8, RZ), 'paint', collide=False, density=0.1)

    # ================= the way under: boiler room to the shed, beneath the alley =================
    Z0, ZC = -3.4, -1.2
    def under(a, b, mat='wall_conc'):
        box(a, b, mat, tag='under', density=0.6)
    m.stairs(HX0, HY0, HX1, 30.3, Z0, 0.0, '-y', mat='concstep')
    m.stairs(QX0, HY0, QX1, 30.3, Z0, 0.0, '-y', mat='concstep')
    under((26.7, 24.7, Z0 - 0.2), (52.1, 32.3, Z0), 'conc')            # floor
    under((HX1, 29.7, ZC), (QX0, 32.3, ZC + 0.2))                      # roof of the run
    under((26.7, HY1, ZC), (HX1, 32.3, ZC + 0.2))
    under((QX0, HY1, ZC), (52.1, 32.3, ZC + 0.2))
    under((HX1, 30.1, Z0), (QX0, 30.3, ZC))                            # south wall of the run
    under((26.7, 24.7, Z0), (HX0, 32.3, 0))                            # the two stairwells
    under((HX1, 24.7, Z0), (HX1 + 0.2, 30.3, 0))
    under((HX0, 24.7, Z0), (HX1, HY0, 0))
    under((QX0 - 0.2, 24.7, Z0), (QX0, 30.3, 0))
    under((QX1, 24.7, Z0), (QX1 + 0.2, 32.3, 0))
    under((QX0, 24.7, Z0), (QX1, HY0, 0))
    # the north wall, with a pump chamber let into it halfway along
    under((26.7, 32.1, Z0), (38.0, 32.3, ZC))
    under((42.0, 32.1, Z0), (52.1, 32.3, ZC))
    under((37.8, 32.3, Z0), (38.0, 35.6, ZC))
    under((42.0, 32.3, Z0), (42.2, 35.6, ZC))
    under((37.8, 35.6, Z0), (42.2, 35.8, ZC))
    under((37.8, 32.3, Z0 - 0.2), (42.2, 35.8, Z0), 'conc')
    under((37.8, 32.1, ZC), (42.2, 35.8, ZC + 0.2))
    m.zones.append(dict(a=(26.7, 24.7, Z0 - 0.3), b=(52.2, 35.8, -0.5), kind='small'))
    prop('old_military_compressor', 40.0, 34.8, z=Z0, rot=0.3)
    prop('metal_tool_chest', 38.6, 35.1, z=Z0, rot=0.0)
    prop('caged_hanging_light', 40.0, 33.8, z=ZC - 0.15, collide=False)
    light('point', (40.0, 33.8, ZC - 0.35), (1.0, 0.7, 0.42), 9, radius=0.05)
    light('point', (27.6, 31.2, ZC - 0.3), (1.0, 0.74, 0.46), 7, radius=0.05)
    light('point', (51.2, 31.2, ZC - 0.3), (0.72, 0.84, 1.0), 6, radius=0.05)
    m.hpipe(28.6, 50.2, 30.5, Z0 + 1.9)
    m.hpipe(28.6, 50.2, 30.5, Z0 + 1.62)
    m.hpipe(28.6, 37.8, 31.9, Z0 + 2.0)
    m.hpipe(42.2, 50.2, 31.9, Z0 + 2.0)
    for (x, y, n, kg, sf) in ((33.0, 31.7, 'plastic_crate_02', 2, 'plastic'), (33.5, 31.8, 'plastic_crate_03', 2, 'plastic'), (45.5, 30.6, 'metal_jerrycan_green', 8, 'metal'), (47.0, 31.7, 'cardboard_box_01', 4, 'card')):
        m.loose(n, x, y, z=Z0, rot=x, kg=kg, surf=sf)
    prop('wooden_crate_02', 36.0, 30.75, z=Z0, rot=0.1)
    m.rail('x', HY0 - 0.05, HX0, HX1, 0.0)
    m.rail('y', HX1 + 0.05, HY0, HY1, 0.0)
    m.rail('y', HX0 - 0.05, HY0, HY1, 0.0)
    m.rail('y', QX1 + 0.05, HY0, HY1, 0.0)
    m.rail('x', HY1 + 0.05, QX0, QX1, 0.0)

    # ================= the roof =================
    m.stairs(29.7, 33.3, 33.7, 34.5, F2, TOP + 0.3, '+x', mat='steelstep', solid=False)
    box((33.7, 33.25, TOP + 0.2), (34.55, 34.6, TOP + 0.3), 'grate', tag='floor', density=0.3)
    box((32.3, 33.0, TOP + 0.2), (33.7, 33.3, TOP + 0.3), 'grate', tag='floor', density=0.3)
    m.rail('x', 34.62, 29.7, 34.55, TOP + 0.3, h=1.05, mat='ruststeel')
    m.rail('y', 34.58, 33.25, 34.6, TOP + 0.3, h=1.05, mat='ruststeel')
    m.invisible((29.7, 34.55, F2), (34.6, 34.68, TOP + 1.4))
    m.invisible((34.52, 33.25, F2), (34.62, 34.6, TOP + 1.4))
    R0 = TOP + 0.3
    box((22.2, 25.0, R0), (25.8, 30.0, R0 + 2.3), 'brick_a', density=0.2)                 # stair head
    box((22.0, 24.8, R0 + 2.3), (26.0, 30.2, R0 + 2.5), 'stone', collide=False, density=0.1)
    box((10.0, 17.0, R0), (12.2, 19.2, R0 + 1.5), 'tin', density=0.3)                     # a tank
    box((10.2, 17.2, R0 + 1.5), (12.0, 19.0, R0 + 1.7), 'ruststeel', collide=False, density=0.2)
    box((13.5, 26.5, R0), (17.0, 27.6, R0 + 0.9), 'ruststeel', density=0.3)              # a duct to hide behind
    box((28.0, 15.0, R0), (31.5, 16.1, R0 + 0.9), 'ruststeel', density=0.3)
    for (x, y, r) in ((8.5, 30.0, 0.0), (19.0, 16.0, math.pi), (31.0, 28.0, 1.57)):
        prop('exterior_aircon_unit', x, y, z=R0, rot=r, part='exterior_aircon_unit')
    prop('wooden_ladder', 26.4, 31.4, z=R0, rot=1.2, collide=False)
    for (x, y, n, kg, sf) in ((16.0, 22.0, 'plastic_crate_02', 2, 'plastic'), (21.0, 28.5, 'metal_jerrycan_green', 8, 'metal'), (27.0, 21.0, 'plastic_monobloc_chair_01', 2.5, 'plastic')):
        m.loose(n, x, y, z=R0, rot=x, kg=kg, surf=sf)
    light('spot', (24.0, 24.7, R0 + 2.2), (1.0, 0.78, 0.5), 160, spot=2.2, blend=0.8, radius=0.1, aim=(0, -0.4, -0.8))
    prop('security_light', 24.0, 24.75, z=R0 + 2.2, rot=math.pi, part='security_light', collide=False)

    # ================= rooms that look lived in =================
    def L(n, x, y, z=0.0, r=0.0, kg=4, sf='wood', **k):
        m.loose(n, x, y, z=z, rot=r, kg=kg, surf=sf, **k)
    def D(n, x, y, z=0.0, r=0.0, **k):
        k.setdefault('collide', False)
        prop(n, x, y, z=z, rot=r, **k)
    # the corner shop
    for y in (15.2, 18.6):
        for x in (9.5, 13.0):
            for z, it in ((0.42, 'long_life_food'), (1.12, 'russian_food_cans_01'), (1.82, 'plastic_bottle_gallon')):
                for dx in (-0.4, 0.05, 0.42):
                    D(it, x + dx, y + 0.05, z=z, r=dx * 3)
    D('CashRegister_01', 7.9, 20.9, z=1.0, r=math.pi)
    L('plastic_crate_02', 15.6, 14.0, kg=2, sf='plastic')
    L('plastic_crate_03', 16.0, 14.4, kg=2, sf='plastic')
    # the lobby
    prop('Sofa_01', 18.6, 19.0, rot=math.pi / 2)
    prop('CoffeeTable_01', 20.2, 19.0, rot=math.pi / 2)
    D('potted_plant_01', 25.4, 21.4)
    D('potted_plant_04', 17.5, 13.6)
    D('wall_clock', 21.0, 21.86, z=2.3, r=math.pi)
    D('hanging_picture_frame_01', 19.0, 21.88, z=1.6, r=math.pi)
    D('hanging_picture_frame_02', 23.4, 13.12, z=1.6, r=0)
    # the bar
    for i in range(6):
        L('bar_chair_round_01', 27.6 + i * 1.0, 18.8, r=i * 0.7, kg=6, sf='metal')
    prop('painted_wooden_shelves', 30.0, 21.65, rot=math.pi)
    for x in (28.8, 30.0, 31.2):
        D('wine_bottles_01', x, 19.7, z=1.13, r=x)
    D('dartboard', 33.82, 15.2, z=1.7, r=-math.pi / 2)
    prop('WoodenTable_01', 28.2, 14.8, rot=0.3)
    L('WoodenChair_01', 27.4, 15.4, r=2.6, kg=5)
    L('WoodenChair_01', 29.2, 14.2, r=-0.6, kg=5)
    D('boombox', 32.8, 20.5, z=0)
    D('hanging_picture_frame_03', 26.12, 17.4, z=1.7, r=math.pi / 2)
    # the kitchen
    prop('electric_stove', 6.55, 25.8, rot=math.pi / 2)
    prop('electric_stove', 6.55, 26.75, rot=math.pi / 2)
    D('pot_enamel_01', 6.6, 25.7, z=0.92)
    D('brass_pan_01', 6.6, 26.8, z=0.92, r=0.6)
    D('vintage_microwave', 12.0, 32.5, z=0.95, r=math.pi)
    prop('modern_wooden_cabinet', 12.0, 32.5, rot=math.pi)
    D('wooden_cutting_board', 10.4, 28.1, z=0.76, r=0.4)
    D('can_rusted', 10.8, 28.4, z=0.76)
    # the store room
    for x in (15.2, 18.0, 20.8):
        D('plastic_crate_02', x, 31.8, z=0.75, r=x)
        D('old_military_crate', x, 31.8, z=1.45, r=x * 2)
    prop('compost_bags', 15.2, 25.2, rot=0.6, collide=(0.5, 0.35, 0.35))
    D('tire_pump', 21.3, 25.1, r=0.8)
    # the boiler room
    prop('metal_tool_chest', 33.3, 28.6, rot=-math.pi / 2)
    D('metal_toolbox', 33.3, 28.6, z=0.95, r=0.3)
    prop('small_lpg_tank', 29.3, 32.1, collide=(0.18, 0.18, 0.4))
    D('pull_chain_light_socket', 30.0, 28.6, z=2.9)
    # upstairs: a flat somebody left in a hurry, one still lived in, one squatted
    prop('ArmChair_01', 9.8, 16.2, z=F2, rot=-2.3)
    prop('CoffeeTable_01', 8.6, 17.4, z=F2, rot=0.1)
    D('Television_01', 8.6, 14.0, z=F2 + 0.45, r=0)
    D('ceiling_fan', 8.6, 17.5, z=TOP - 0.55)
    D('hanging_picture_frame_01', 11.42, 19.4, z=F2 + 1.6, r=math.pi / 2)
    D('ornate_mirror_01', 6.2, 19.0, z=F2 + 1.0, r=-math.pi / 2)
    D('vintage_suitcase', 16.3, 19.8, z=F2, r=0.9)
    prop('ClassicNightstand_01', 13.8, 13.8, z=F2)
    prop('wooden_bookshelf_worn', 20.8, 21.6, z=F2, rot=math.pi)
    prop('SchoolDesk_01', 18.2, 20.4, z=F2, rot=math.pi)
    D('classic_laptop', 18.2, 20.4, z=F2 + 0.72, r=math.pi)
    L('WoodenChair_01', 18.2, 19.6, z=F2, r=0.2, kg=5)
    prop('Sofa_01', 28.0, 13.8, z=F2, rot=0.0)
    prop('CoffeeTable_01', 28.2, 15.3, z=F2, rot=0.2)
    D('potted_plant_02', 33.4, 13.6, z=F2)
    D('standing_chalkboard_01', 32.6, 21.5, z=F2, r=math.pi)
    prop('Shelf_01', 13.6, 32.6, z=F2, rot=math.pi)
    D('wheelchair_01', 9.3, 32.1, z=F2, r=2.5)
    D('medical_box', 11.0, 25.6, z=F2 + 0.75, r=0.2)
    prop('dining_table', 18.2, 29.2, z=F2, rot=0.3, scale=0.8)
    L('dining_chair_02', 17.3, 29.4, z=F2, r=1.6, kg=5)
    L('dining_chair_02', 19.0, 29.0, z=F2, r=-1.3, kg=5)
    D('boombox', 16.0, 32.6, z=F2, r=0.5)
    D('projector_screen', 33.3, 25.6, z=F2, r=-math.pi / 2)
    L('wooden_stool_01', 30.0, 27.2, z=F2, r=1.0, kg=3)
    L('metal_stool_01', 28.6, 24.9, z=F2, r=2.0, kg=4, sf='metal')
    # the shed: a shop floor, not an empty box
    prop('drill_press_01', 73.5, 25.0, rot=2.0, collide=(0.3, 0.3, 0.9))
    prop('old_drill_press', 75.0, 25.2, rot=1.0, collide=(0.3, 0.3, 0.8))
    prop('portable_welding_cart', 71.5, 26.1, rot=0.4, collide=(0.4, 0.4, 0.6))
    prop('metal_tool_chest', 77.0, 24.1, rot=0.0)
    D('metal_toolbox', 77.0, 24.1, z=0.95, r=0.5)
    prop('industrial_storage_cart', 66.0, 15.0, rot=0.3, collide=(0.6, 0.4, 0.5))
    prop('industrial_storage_cart', 56.6, 41.0, rot=1.8, collide=(0.6, 0.4, 0.5))
    prop('portable_generator', 83.0, 42.0, rot=2.0)
    prop('old_military_crate', 57.0, 14.5, rot=0.2)
    prop('old_military_crate', 57.2, 15.4, rot=1.3)
    prop('old_military_crate', 57.1, 14.9, z=0.42, rot=0.7, collide=False)
    D('portable_searchlight', 71.0, 42.5, r=2.4)
    D('wooden_ladder', 84.8, 36.0, r=-1.5)
    # offices
    D('classic_laptop', 76.0, 15.0, z=0.76, r=math.pi)
    D('desk_lamp_arm_01', 75.2, 14.9, z=0.76, r=0.3)
    D('binder_notebook', 76.8, 15.2, z=0.76, r=0.2)
    D('office_notepads', 83.5, 20.5, z=0.76, r=1.0)
    D('clipboard', 83.1, 20.4, z=0.76, r=0.4)
    D('standing_chalkboard_01', 78.8, 13.6, r=0.0)
    D('potted_plant_04', 72.6, 13.7)
    # the street and the yards
    D('korean_public_payphone_01', 27.2, 12.72, r=math.pi)
    prop('planter_box_01', 12.5, 11.6, rot=0.0, collide=(0.6, 0.3, 0.4))
    prop('planter_box_02', 60.5, 12.0, rot=0.1, collide=(0.6, 0.3, 0.4))
    prop('planter_box_01', 20.0, -1.8, rot=1.57, collide=(0.3, 0.6, 0.4))
    prop('planter_box_02', 58.0, -1.8, rot=1.5, collide=(0.3, 0.6, 0.4))
    D('security_camera_02', 33.9, 13.0, z=3.0, r=-2.0)
    D('security_camera_01', 49.8, 40.0, z=3.3, r=1.57)
    D('industrial_wall_sconce', 34.3, 30.0, z=2.3, r=-math.pi / 2)
    D('street_rat', 37.9, 16.8, r=2.0)
    D('street_rat', 46.1, 27.9, r=0.6)
    D('can_rusted', 41.0, 17.2, r=0.5)
    prop('wooden_picnic_table', 12.5, 44.5, rot=0.5, collide=(0.8, 0.7, 0.38))
    D('moss_01', 49.3, 30.2)
    prop('oil_tin', 15.2, 39.7, rot=0.3, collide=False)
    L('plastic_jerrycan', 16.2, 40.2, r=1.1, kg=3, sf='plastic')
    L('industrial_pastic_container', 90.6, 43.5, r=0.3, kg=14, sf='plastic', shape='cyl')
    L('plastic_container', 63.0, 47.2, r=0.3, kg=6, sf='plastic')

    # clutter that moves
    for (x, y, z, r, n, kg, sf) in (
        (31.6, 23.6, 0, 0.4, 'cardboard_box_01', 5, 'card'), (16.2, 23.7, 0, 1.0, 'cardboard_box_01', 5, 'card'), (24.6, 16.8, 0, 1.3, 'SchoolChair_01', 6, 'wood'),
        (29.8, 17.4, 0, 0.3, 'SchoolChair_01', 6, 'wood'), (32.2, 15.2, 0, 2.2, 'SchoolChair_01', 6, 'wood'), (12.8, 26.2, 0, 0.5, 'multi_cleaner_5_litre', 2.5, 'plastic'),
        (13.1, 26.6, 0, 1.4, 'multi_cleaner_5_litre', 2.5, 'plastic'), (20.4, 25.2, 0, 2.0, 'multi_cleaner_5_litre', 2.5, 'plastic'), (16.3, 19.8, 0, 0.0, 'plastic_crate_01', 1.5, 'plastic'),
        (39.2, 31.5, 0, 0.5, 'cardboard_box_01', 4, 'card'), (39.8, 31.2, 0, 1.4, 'cardboard_box_01', 4, 'card'), (39.5, 31.4, 0.35, 0.9, 'cardboard_box_01', 3, 'card'), (46.2, 41.0, 0, 0.8, 'plastic_crate_01', 1.5, 'plastic'),
        (46.8, 41.3, 0, 0.1, 'plastic_crate_01', 1.5, 'plastic'), (46.5, 41.2, 0.32, 0.4, 'plastic_crate_01', 1.5, 'plastic'), (55.5, 16.0, 0, 0.6, 'plastic_crate_01', 1.5, 'plastic'), (66.0, 18.0, 0, 1.1, 'metal_jerrycan', 8, 'metal'),
        (66.5, 18.3, 0, 2.1, 'metal_jerrycan', 8, 'metal'), (71.0, 37.0, 0, 1.0, 'cardboard_box_01', 5, 'card'), (71.6, 37.2, 0, 0.3, 'cardboard_box_01', 5, 'card'), (55.0, 36.5, F2, 0.5, 'cardboard_box_01', 4, 'card'),
        (12.0, 41.0, 0, 0.8, 'plastic_crate_01', 1.5, 'plastic'), (13.0, 40.2, 0, 2.2, 'metal_jerrycan', 8, 'metal'), (3.0, 26.0, 0, 1.0, 'WetFloorSign_01', 1.2, 'plastic'), (62.0, 11.8, 0, 0.4, 'cardboard_box_01', 4, 'card'),
        (90.0, 26.0, 0, 0.4, 'plastic_crate_01', 1.5, 'plastic'), (89.5, 25.4, 0, 1.0, 'metal_jerrycan', 8, 'metal'), (9.8, 15.5, F2, 0.8, 'SchoolChair_01', 6, 'wood'), (28.5, 19.5, F2, 1.8, 'SchoolChair_01', 6, 'wood'),
    ):
        m.loose(n, x, y, z=z, rot=r, kg=kg, surf=sf)

    # spawns
    # each side starts inside, in its own end of the building
    m.spawns['a'] = [[9.0, 16.0, 0], [14.0, 20.0, 0], [20.0, 16.0, 0], [24.0, 20.0, 0], [8.0, 27.0, 0], [12.0, 31.0, 0], [16.0, 27.0, 0], [20.0, 31.0, 0]]
    m.spawns['b'] = [[73.5, 15.0, 0], [78.5, 15.0, 0], [73.5, 20.5, 0], [78.5, 21.0, 0], [76.0, 18.0, 0], [81.5, 15.0, 0], [84.5, 20.0, 0], [82.0, 21.5, 0]]
    m.spawns['ffa'] = m.spawns['a'] + m.spawns['b'] + [[42, 30, 0], [38, 18, 0], [60, 40, 0], [30, 28, F2], [44, 23.1, F2], [58, 17, 0], [11, 23, 0], [31, 28, 0], [83, 35, 0]]
    m.hold = [[42, 23, 0], [66, 32, 0], [18, 23, 0]]
    # ================= all of it indoors =================
    # the alley between the two buildings under a roof, walled off at the street and the yard: a loading hall,
    # the bridge across it, the dumpsters still in it
    import indoor
    AH = TOP
    indoor.roof(m, X1 + 0.3, 12.7, WX0 - EXT_T / 2 - 0.02, 40.3, AH)
    wall('x', 13.0 - EXT_T / 2, X1 + EXT_T / 2, WX0 - EXT_T / 2, 0, AH, EXT_T, 'brick_b', tag='ext')
    box((37.0, 13.0 - EXT_T - 0.06, 0), (42.0, 13.0 - EXT_T, 3.2), 'ruststeel', collide=False, density=0.3)
    wall('x', 40.0, X1 - EXT_T / 2, WX0 - EXT_T / 2, 0, AH, EXT_T, 'brick_b', tag='ext')
    wall('y', X1, Y1, 40.0, 0, AH, EXT_T, 'brick_b', tag='ext')
    room('alleyhall', X1 + EXT_T / 2, 13.0, WX0 - EXT_T / 2, 40.0 - EXT_T / 2, 0, AH, 'brick_a', 'alley', ceil='ceil')
    m.zones.append(dict(a=(X1, 13.0, -0.3), b=(WX0, 40.0, AH), kind='hall'))
    for (x, y, p, fl) in ((41.0, 18.0, 6, 0.3), (42.0, 34.0, 0, 0.0)):
        prop('caged_hanging_light', x, y, z=AH - 1.0, collide=False)
        if p:
            light('point', (x, y, AH - 1.2), WARM, p, radius=0.05, flicker=fl)
    # freight nobody came for: a car under a sheet, pallets, crates stacked against the walls
    prop('covered_car', 42.0, 35.6, rot=math.pi / 2 + 0.05, part=None, collide=(2.3, 1.0, 0.75))
    for (x, y, h) in ((48.6, 19.0, 3), (48.6, 21.0, 1), (35.6, 33.5, 2)):
        for k in range(h):
            m.unit('ward', [f'pallet_{k + 1}'], x, y, k * 0.15, rot=math.pi / 2 + k * 0.1, far=True)
        m.invisible((x - 0.65, y - 0.55, 0), (x + 0.65, y + 0.55, h * 0.15), pen=True)
    for (x, y, r, n) in ((48.9, 31.0, 0.1, 'wooden_crate_01'), (48.7, 32.6, 0.3, 'wooden_crate_02'), (48.8, 31.8, 0.0, 'wooden_crate_02')):
        prop(n, x, y, rot=r)
    if not hasattr(m, 'stains'):
        m.stains = []
    m.stains.extend([(40.0, 26.0, 0.0, 0, 0, 1, 2.0), (34.33, 29.0, 1.2, 1, 0, 0, 1.4)])
    # the shed's roller door is down now
    box((59.4, WY0 - 0.14, 0.0), (64.6, WY0 - 0.02, 2.74), 'ruststeel', tag='wall', density=0.3)
    print('  sealed doors, windows:', indoor.seal(m, indoor.inside_fn(m)))
    # and what everyone left behind
    import clutter
    clutter.trim(m)
    clutter.dress(m, 'flat', random.Random(41), outside=[(0.0, 13.0, 34.0, 62.0, 0.0), (50.0, 45.0, 96.0, 62.0, 0.0)], out_n=60, blood=0.75)
    print('  cleared from the halls:', indoor.clear_halls(m))
    return m


def draw(m, path, z=(0.0, 1.0)):
    from PIL import Image, ImageDraw
    S = 14
    W, H = 100 * S, 70 * S
    im = Image.new('RGB', (W, H), (30, 30, 34))
    d = ImageDraw.Draw(im)

    def P(x, y):
        return ((x + 2) * S, H - (y + 5) * S)
    for b in m.boxes:
        if b.a[2] < z[1] and b.b[2] > z[0] and (b.b[2] - b.a[2]) > 0.02:
            c = (120, 120, 130) if b.collide else (70, 70, 80)
            if b.pen:
                c = (190, 150, 90)
            if b.tag == 'step':
                c = (90, 160, 210)
            x0, y1 = P(b.a[0], b.a[1])
            x1, y0 = P(b.b[0], b.b[1])
            d.rectangle((x0, y0, x1, y1), fill=c)
    for p in m.props:
        if z[0] - 0.3 <= p['pos'][2] < z[1]:
            x, y = P(p['pos'][0], p['pos'][1])
            d.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(90, 220, 120))
    for dd in m.doors:
        if z[0] - 0.2 <= dd['hinge'][2] < z[1]:
            x, y = P(dd['hinge'][0], dd['hinge'][1])
            d.ellipse((x - 5, y - 5, x + 5, y + 5), fill=(240, 80, 80))
    for k, c in (('a', (80, 160, 255)), ('b', (255, 170, 60))):
        for s in m.spawns[k]:
            x, y = P(s[0], s[1])
            d.rectangle((x - 5, y - 5, x + 5, y + 5), fill=c)
    im.save(path)


if __name__ == '__main__':
    import sys
    m = build()
    print('boxes', len(m.boxes), 'props', len(m.props), 'lights', len(m.lights), 'doors', len(m.doors), 'glass', len(m.glass))
    out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/lf'
    draw(m, out + '_g.png', (0.3, 1.6))
    draw(m, out + '_u.png', (3.4, 4.6))
