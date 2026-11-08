"""What people leave in places: one pass over a map's rooms and yards that fills them with things, after the
layout has put down its own. Never on a doorway, a spawn, a stair or anything already there; the bigger things go
against walls, the flat things anywhere; a share of it is loose, so it can be kicked and shot about.

dress(m, style, rng, outside=[(x0, y0, x1, y1, z)], skip=(room names))
"""
import math

# kind, name, radius, height on the wall (None: on the floor), extra
#   L: loose (kg, surf, shape)   D: set down, no collision   P: set down, solid   K: a ward_kit unit (solid half sizes or None)
HOSP_WALL = [('L', 'cardboard_box_01', 0.3, (4, 'card', 'box')), ('L', 'plastic_crate_01', 0.3, (1.5, 'plastic', 'box')),
             ('L', 'metal_trash_can', 0.25, (6, 'metal', 'cyl'), 'metal_trash_can'), ('L', 'plastic_monobloc_chair_01', 0.35, (2.5, 'plastic', 'box')),
             ('L', 'SchoolChair_01', 0.35, (6, 'wood', 'box')), ('L', 'trashbag', 0.3, (7, 'bag', 'box')), ('L', 'multi_cleaner_5_litre', 0.15, (2.5, 'plastic', 'box')),
             ('L', 'plastic_bottle_gallon', 0.15, (1.5, 'plastic', 'box')), ('L', 'korean_fire_extinguisher_01', 0.15, (6, 'metal', 'cyl')),
             ('D', 'medical_box', 0.25), ('L', 'wheelchair_01', 0.45, (14, 'metal', 'box')), ('K', 'radiator', 0.02, None, (0.5, 0.12, 0.8)),
             ('L', 'vintage_suitcase', 0.35, (6, 'bag', 'box')), ('D', 'street_rat', 0.12)]
FLAT_WALL = [('L', 'cardboard_box_01', 0.3, (4, 'card', 'box')), ('L', 'trashbag', 0.3, (7, 'bag', 'box')), ('L', 'wine_bottles_01', 0.15, (1, 'glass', 'box')),
             ('L', 'WoodenChair_01', 0.35, (5, 'wood', 'box')), ('L', 'dining_chair_02', 0.35, (5, 'wood', 'box')), ('L', 'plastic_crate_02', 0.3, (1.5, 'plastic', 'box')),
             ('L', 'vintage_suitcase', 0.35, (6, 'bag', 'box')), ('L', 'pot_enamel_01', 0.15, (1, 'metal', 'cyl')), ('L', 'boombox', 0.2, (3, 'plastic', 'box')),
             ('L', 'metal_trash_can', 0.25, (6, 'metal', 'cyl'), 'metal_trash_can'), ('K', 'radiator', 0.02, None, (0.5, 0.12, 0.8)), ('D', 'street_rat', 0.12),
             ('L', 'plastic_bottle_gallon', 0.15, (1.5, 'plastic', 'box'))]
COTTAGE_WALL = [('L', 'WoodenChair_01', 0.35, (5, 'wood', 'box')), ('L', 'wooden_bucket_01', 0.2, (2, 'wood', 'cyl')), ('L', 'wine_bottles_01', 0.15, (1, 'glass', 'box')),
                ('L', 'vintage_suitcase', 0.35, (6, 'bag', 'box')), ('L', 'cardboard_box_01', 0.3, (4, 'card', 'box')), ('L', 'pot_enamel_01', 0.15, (1, 'metal', 'cyl')),
                ('D', 'wooden_lantern_01', 0.15), ('L', 'plastic_crate_03', 0.3, (1.5, 'plastic', 'box'))]
OUT = [('L', 'trashbag', 0.3, (7, 'bag', 'box')), ('L', 'cardboard_box_01', 0.3, (4, 'card', 'box')), ('L', 'plastic_crate_01', 0.3, (1.5, 'plastic', 'box')),
       ('L', 'wooden_crate_02', 0.4, (20, 'wood', 'box')), ('P', 'old_tyre', 0.4), ('L', 'metal_jerrycan', 0.2, (8, 'metal', 'box')),
       ('L', 'plastic_jerrycan', 0.2, (3, 'plastic', 'box')), ('L', 'propane_tank', 0.2, (12, 'metal', 'cyl')), ('L', 'cement_bag', 0.35, (25, 'bag', 'box')),
       ('K', 'pallet', 0.75, None, (0.55, 0.65, 0.14)), ('L', 'metal_trash_can', 0.25, (6, 'metal', 'cyl'), 'metal_trash_can'), ('D', 'can_rusted', 0.1)]
COAST_OUT = [('L', 'wooden_crate_02', 0.4, (20, 'wood', 'box')), ('L', 'plastic_crate_01', 0.3, (1.5, 'plastic', 'box')), ('L', 'wooden_bucket_01', 0.2, (2, 'wood', 'cyl')),
             ('L', 'plastic_jerrycan', 0.2, (3, 'plastic', 'box')), ('K', 'pallet', 0.75, None, (0.55, 0.65, 0.14)), ('L', 'trashbag', 0.3, (7, 'bag', 'box')),
             ('L', 'metal_jerrycan', 0.2, (8, 'metal', 'box'))]
# on the wall: (name or kit, height, half width)
HOSP_HUNG = [('K:board', 0.0, 0.62), ('K:conduit', 0.0, 0.5), ('D:wall_clock', 2.3, 0.2), ('D:fire_alarm', 1.4, 0.1), ('K:conduit', 0.0, 0.5)]
FLAT_HUNG = [('D:hanging_picture_frame_01', 1.6, 0.3), ('D:hanging_picture_frame_02', 1.6, 0.3), ('D:hanging_picture_frame_03', 1.6, 0.3), ('D:wall_clock', 2.0, 0.2), ('K:conduit', 0.0, 0.5)]
COTTAGE_HUNG = [('D:hanging_picture_frame_01', 1.55, 0.3), ('D:hanging_picture_frame_03', 1.55, 0.3), ('D:wall_clock', 1.9, 0.2)]
STYLES = {
    'hospital': dict(wall=HOSP_WALL, hung=HOSP_HUNG, flat=['litter', 'debris', 'litter', 'bottles'], ceil=['cables', 'tile'], dense=1.0),
    'flat': dict(wall=FLAT_WALL, hung=FLAT_HUNG, flat=['litter', 'bottles', 'debris'], ceil=['cables'], dense=0.9),
    'cottage': dict(wall=COTTAGE_WALL, hung=COTTAGE_HUNG, flat=['litter'], ceil=[], dense=0.6),
}


def dress(m, style, rng, outside=(), skip=(), out_items=None, out_n=40):
    st = STYLES[style]
    solids = [b for b in m.boxes if b.collide] + [type('S', (), dict(a=a, b=b, collide=True, tag='inv'))() for (a, b, _) in m.solid]
    doors = []
    for d in m.doors:
        hx, hy, hz = d['hinge']
        if d['axis'] == 'x':
            doors.append((hx + d['sign'] * d['w'] / 2, hy, hz))
        else:
            doors.append((hx, hy + d['sign'] * d['w'] / 2, hz))
    taken = [(p['pos'][0], p['pos'][1], p['pos'][2], 0.55) for p in m.props]
    taken += [(u['pos'][0], u['pos'][1], u['pos'][2], 1.1 if u['parts'][0].startswith('hbed') else 0.6) for u in m.units if u['kit'] == 'ward']
    spawns = [tuple(s) + (0,) * (3 - len(s)) for k in ('a', 'b', 'ffa') for s in m.spawns[k]]
    placed = {'n': 0, 'loose': 0}

    def solid_at(x, y, z):
        for b in solids:
            if b.a[0] - 1e-3 <= x <= b.b[0] + 1e-3 and b.a[1] - 1e-3 <= y <= b.b[1] + 1e-3 and b.a[2] <= z <= b.b[2]:
                return True
        return False

    def free(x, y, z, r, flat=False):
        for (dx, dy, dz) in doors:
            if abs(dz - z) < 1.2 and math.hypot(dx - x, dy - y) < 1.25 + r:
                return False
        for (sx, sy, sz) in spawns:
            if abs(sz - z) < 1.2 and math.hypot(sx - x, sy - y) < 1.0 + r:
                return False
        if flat:
            return True
        for (px, py, pz, pr) in taken:
            if abs(pz - z) < 1.2 and math.hypot(px - x, py - y) < pr + r:
                return False
        for b in solids:
            if b.tag in ('floor',) or b.b[2] < z + 0.08 or b.a[2] > z + 1.2:
                continue
            if b.a[0] - r < x < b.b[0] + r and b.a[1] - r < y < b.b[1] + r:
                return False
        return True

    def put(item, x, y, z, rot):
        kind, name, r = item[0], item[1], item[2]
        if kind == 'L' and rng.random() > 0.45:
            # most of it just stands there; small things don't stop anyone, bigger ones do but not a round
            if r <= 0.2:
                m.prop(name, x, y, z=z, rot=rot, collide=False, part=item[4] if len(item) > 4 else None)
            else:
                m.prop(name, x, y, z=z, rot=rot, hard=False, part=item[4] if len(item) > 4 else None)
        elif kind == 'L':
            kg, surf, shape = item[3]
            m.loose(name, x, y, z=z, rot=rot, kg=kg, surf=surf, shape=shape, part=item[4] if len(item) > 4 else None)
            placed['loose'] += 1
        elif kind == 'D':
            m.prop(name, x, y, z=z, rot=rot, collide=False)
        elif kind == 'P':
            m.prop(name, x, y, z=z, rot=rot)
        else:
            unit(name, x, y, z, rot + math.pi, item[4] if len(item) > 4 else None)
        taken.append((x, y, z, r))
        placed['n'] += 1

    def unit(kind, x, y, z, rot, solid=None):
        """kit pieces look along -y at rot 0, props along +y: callers give the prop's rot"""
        m.unit('ward', [f'{kind}_{rng.randint(1, 9)}' if kind in ('litter', 'debris', 'bottles', 'shards', 'cables', 'tile', 'conduit', 'board', 'radiator') else kind],
               x, y, z, rot=rot, far=True)
        if solid:
            hx, hy, h = solid
            c, sn = abs(math.cos(rot)), abs(math.sin(rot))
            m.invisible((x - c * hx - sn * hy, y - sn * hx - c * hy, z), (x + c * hx + sn * hy, y + sn * hx + c * hy, z + h), pen=True)

    for room in m.rooms:
        if room['name'] in skip or 'stair' in room['name']:
            continue
        (x0, y0, z0), (x1, y1, z1) = room['a'], room['b']
        W, D = x1 - x0, y1 - y0
        if z1 - z0 < 2.2 or W < 1.6 or D < 1.6:
            continue
        corridor = min(W, D) < 3.0
        per = 2 * (W + D)
        k = st['dense']
        # the four walls: inward normal, the run along them
        edges = [((x0, y0), (x1, y0), (0, 1)), ((x0, y1), (x1, y1), (0, -1)), ((x0, y0), (x0, y1), (1, 0)), ((x1, y0), (x1, y1), (-1, 0))]

        def wall_spot(r):
            (ax, ay), (bx, by), (nx, ny) = edges[rng.randrange(4)]
            t = rng.uniform(0.15, 0.85)
            ex, ey = ax + (bx - ax) * t, ay + (by - ay) * t
            if not solid_at(ex, ey, z0 + 1.5):
                return None
            # step in off the wall's centre line to its face
            f = 0.0
            while f < 0.4 and solid_at(ex + nx * f, ey + ny * f, z0 + 1.5):
                f += 0.01
            d = f + r + 0.02
            # prop front is +y at rot 0: face into the room
            return ex + nx * d, ey + ny * d, math.atan2(-nx, ny), (nx, ny)

        # things on the floor against the walls
        want = int(per / (6.5 if corridor else 4.2) * k)
        tries = 0
        n = 0
        while n < want and tries < want * 12:
            tries += 1
            item = rng.choice(st['wall'])
            if corridor and item[2] > 0.3:
                continue
            s = wall_spot(item[2])
            if not s:
                continue
            x, y, rot, _ = s
            if not free(x, y, z0, item[2]):
                continue
            put(item, x, y, z0, rot + rng.uniform(-0.5, 0.5) if item[0] != 'K' else rot)
            n += 1
        # things on the walls
        want = max(1, int(per / 9 * k))
        tries = 0
        n = 0
        while n < want and tries < want * 10:
            tries += 1
            name, h, hw = rng.choice(st['hung'])
            s = wall_spot(0.0)
            if not s:
                continue
            x, y, rot, (nx, ny) = s
            x, y = x - nx * 0.02, y - ny * 0.02
            if not free(x, y, z0, hw, flat=True) or any(abs(t[0] - x) + abs(t[1] - y) < hw + 0.3 and abs(t[2] - z0 - h) < 1.2 for t in taken):
                continue
            # not over a window
            if any(abs((g['c'] - y) if g['axis'] == 'x' else (g['c'] - x)) < 0.4 and (g['a'] - hw < (x if g['axis'] == 'x' else y) < g['b'] + hw) and g['z0'] < z0 + 2.6 and g['z1'] > z0 + 0.5 for g in m.glass):
                continue
            kind, nm = name.split(':')
            if kind == 'K':
                unit(nm, x, y, z0 + h, rot + math.pi)
            else:
                m.prop(nm, x, y, z=z0 + h, rot=rot, collide=False)
            taken.append((x, y, z0 + h, hw))
            n += 1
        # flat things in the open
        want = max(1, int(W * D / (10 if corridor else 14) * k))
        for _ in range(want * 4):
            if want <= 0:
                break
            x, y = rng.uniform(x0 + 0.6, x1 - 0.6), rng.uniform(y0 + 0.6, y1 - 0.6)
            if not free(x, y, z0, 0.3, flat=True):
                continue
            unit(rng.choice(st['flat']), x, y, z0 + 0.002, rng.uniform(0, 6.28))
            want -= 1
        # what hangs from the ceiling
        if st['ceil'] and rng.random() < 0.7:
            for _ in range(1 + int(W * D / 40)):
                x, y = rng.uniform(x0 + 0.8, x1 - 0.8), rng.uniform(y0 + 0.8, y1 - 0.8)
                unit(rng.choice(st['ceil']), x, y, z1, rng.uniform(0, 6.28))
        # glass under the broken windows
        for g in m.glass:
            if rng.random() < 0.35 and z0 - 0.1 < g['z0'] < z0 + 1.5:
                if g['axis'] == 'x' and x0 - 0.3 < (g['a'] + g['b']) / 2 < x1 + 0.3 and abs(g['c'] - y0) < 0.3:
                    unit('shards', (g['a'] + g['b']) / 2, y0 + 0.5, z0 + 0.002, 0.0)
                elif g['axis'] == 'x' and x0 - 0.3 < (g['a'] + g['b']) / 2 < x1 + 0.3 and abs(g['c'] - y1) < 0.3:
                    unit('shards', (g['a'] + g['b']) / 2, y1 - 0.5, z0 + 0.002, 0.0)

    # the yards: along the walls and fences, and some in the open
    items = out_items or OUT
    if outside:
        n, tries = 0, 0
        while n < out_n and tries < out_n * 40:
            tries += 1
            x0, y0, x1, y1, z = rng.choice(outside)
            x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
            item = rng.choice(items)
            r = item[2]
            # against something tall: a step out from a wall in one of four directions
            near = None
            for (nx, ny) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if solid_at(x - nx * (r + 0.35), y - ny * (r + 0.35), z + 1.4):
                    near = (nx, ny)
                    break
            if near is None and rng.random() < 0.75:
                continue
            if any(r_['a'][0] < x < r_['b'][0] and r_['a'][1] < y < r_['b'][1] and r_['a'][2] - 0.5 < z < r_['b'][2] for r_ in m.rooms):
                continue
            if not free(x, y, z, r):
                continue
            rot = math.atan2(-near[0], near[1]) + rng.uniform(-0.6, 0.6) if near else rng.uniform(0, 6.28)
            put(item, x, y, z, rot)
            n += 1
            if rng.random() < 0.3:
                unit(rng.choice(['litter', 'bottles']), x + rng.uniform(-1, 1), y + rng.uniform(-1, 1), z + 0.002, rng.uniform(0, 6.28))
    return placed
