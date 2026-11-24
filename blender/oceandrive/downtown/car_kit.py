"""The traffic's car bodies, modelled in Blender: blender -b --factory-startup -P downtown/car_kit.py [-- preview]

Each model is a cage of cross-sections (the same proportions the game's specs give: length, width,
height, wheelbase, cowl, roof and deck lines, hood and belt heights, tumblehome, squareness) built as
one closed quad mesh, with the shoulder line, the sill, the roof edge and the windscreen base creased,
then subdivided twice (Catmull-Clark) so the panels come out smooth and curved like pressed steel.
The wheel wells are cut with booleans (the cut closes the shell, so the wells are lined). The faces
are then sorted by where they are and which way they face: glass (windscreen, side windows, backlight),
black pillars and trim, headlamp and tail-lamp clusters, the grille and the lower intake; mirrors,
handles, plates and a dark cabin are added.

-> public/oceandrive/cars.glb: per model, car_<id>_body (vertex colour white = paint, anything darker
is trim), car_<id>_glass, car_<id>_heads, car_<id>_tails. Car frame: +y up, +z forward (three), the
origin on the ground under the middle of the wheelbase."""
import bpy, bmesh, sys, os, math
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'public', 'oceandrive')
PREVIEW = 'preview' in sys.argv

SPECS = {
    'sedan': dict(L=4.85, W=1.84, H=1.45, wb=2.83, wheelR=0.33, cowl=0.42, roofF=0.12, roofR=-0.42, deck=-0.7, hoodH=0.82, beltH=0.96, deckH=0.98, clear=0.15, box=0.3, tumble=0.16),
    'compact': dict(L=4.3, W=1.78, H=1.46, wb=2.64, wheelR=0.31, cowl=0.4, roofF=0.12, roofR=-0.58, deck=-0.92, hoodH=0.8, beltH=0.95, deckH=1.0, clear=0.15, box=0.35, tumble=0.15),
    'suv': dict(L=4.95, W=1.98, H=1.78, wb=2.95, wheelR=0.38, cowl=0.45, roofF=0.2, roofR=-0.82, deck=-0.97, hoodH=1.08, beltH=1.18, deckH=1.2, clear=0.22, box=0.55, tumble=0.12),
    'gwagon': dict(L=4.85, W=1.98, H=1.97, wb=2.89, wheelR=0.39, cowl=0.42, roofF=0.3, roofR=-0.9, deck=-0.97, hoodH=1.16, beltH=1.24, deckH=1.3, clear=0.24, box=0.95, tumble=0.02),
    'pickup': dict(L=5.9, W=2.03, H=1.95, wb=3.68, wheelR=0.42, cowl=0.5, roofF=0.3, roofR=-0.12, deck=-0.15, hoodH=1.25, beltH=1.33, deckH=1.28, clear=0.26, box=0.75, tumble=0.08),
    'coupe': dict(L=4.52, W=1.9, H=1.3, wb=2.45, wheelR=0.34, cowl=0.32, roofF=0.0, roofR=-0.4, deck=-0.78, hoodH=0.76, beltH=0.88, deckH=0.86, clear=0.12, box=0.25, tumble=0.2),
    'super': dict(L=4.62, W=2.02, H=1.14, wb=2.7, wheelR=0.36, cowl=0.56, roofF=0.14, roofR=-0.22, deck=-0.86, hoodH=0.7, beltH=0.8, deckH=0.9, clear=0.1, box=0.18, tumble=0.26),
    'muscle': dict(L=4.92, W=1.96, H=1.34, wb=2.86, wheelR=0.36, cowl=0.2, roofF=-0.06, roofR=-0.46, deck=-0.84, hoodH=0.93, beltH=0.99, deckH=0.98, clear=0.13, box=0.5, tumble=0.17),
    'van': dict(L=5.9, W=2.0, H=2.55, wb=3.66, wheelR=0.36, cowl=0.72, roofF=0.6, roofR=-0.98, deck=-0.995, hoodH=1.1, beltH=1.2, deckH=2.3, clear=0.2, box=0.8, tumble=0.05),
    'taxi': dict(L=4.85, W=1.84, H=1.48, wb=2.83, wheelR=0.33, cowl=0.42, roofF=0.12, roofR=-0.42, deck=-0.7, hoodH=0.82, beltH=0.96, deckH=0.98, clear=0.15, box=0.3, tumble=0.16),
    'police': dict(L=5.1, W=1.9, H=1.48, wb=3.05, wheelR=0.35, cowl=0.4, roofF=0.1, roofR=-0.42, deck=-0.72, hoodH=0.88, beltH=1.0, deckH=1.02, clear=0.14, box=0.4, tumble=0.15),
    'policeSuv': dict(L=5.05, W=2.0, H=1.8, wb=3.02, wheelR=0.38, cowl=0.45, roofF=0.2, roofR=-0.82, deck=-0.97, hoodH=1.08, beltH=1.18, deckH=1.2, clear=0.22, box=0.55, tumble=0.12),
}

PAINT = (1.0, 1.0, 1.0, 1.0)
DARK = (0.022, 0.022, 0.025, 1.0)
TRIM = (0.05, 0.05, 0.055, 1.0)
CHROME = (0.7, 0.7, 0.72, 1.0)
PLATE = (0.86, 0.86, 0.82, 1.0)
GRILLE = (0.03, 0.032, 0.035, 1.0)
DOOR = (0.9, 0.9, 0.89, 1.0)      # under 0.94: keeps its own white whatever the paint


def table(pairs):
    pairs = sorted(pairs)
    def f(y):
        if y <= pairs[0][0]:
            return pairs[0][1]
        for (a, va), (b, vb) in zip(pairs, pairs[1:]):
            if y <= b:
                t = (y - a) / (b - a) if b > a else 0
                t = t * t * (3 - 2 * t)          # smooth between keys
                return va + (vb - va) * t
        return pairs[-1][1]
    return f


class Shape:
    def __init__(self, kind, m):
        self.kind = kind
        self.m = m
        hl, hw = m['L'] / 2, m['W'] / 2
        self.hl, self.hw = hl, hw
        rnd = 1 - m['box']
        self.rnd = rnd
        self.cowl, self.roofF, self.roofR, self.deck = m['cowl'] * hl, m['roofF'] * hl, m['roofR'] * hl, m['deck'] * hl
        self.wz = m['wb'] / 2
        self.archR = m['wheelR'] + 0.075
        cl = m['clear']
        self.width = table([(hl, hw * (0.62 + 0.3 * m['box'])), (hl - 0.12 - rnd * 0.12, hw * (0.9 + 0.06 * m['box'])), (hl - 0.5 - rnd * 0.2, hw * 0.995), (0, hw),
                            (-hl + 0.45 + rnd * 0.15, hw * 0.99), (-hl + 0.1 + rnd * 0.1, hw * (0.92 + 0.05 * m['box'])), (-hl, hw * (0.72 + 0.22 * m['box']))])
        self.bottom = table([(hl, cl + 0.22), (hl - 0.45, cl + 0.02), (-hl + 0.5, cl + 0.02), (-hl, cl + 0.26)])
        self.belt = table([(hl, m['hoodH'] - 0.1 - rnd * 0.1), (hl - 0.4, m['hoodH'] - 0.01), (self.cowl, m['beltH'] - 0.02), (self.deck, m['beltH']),
                           (-hl + 0.3, m['deckH'] - 0.02), (-hl, m['deckH'] - 0.08 - rnd * 0.08)])
        if kind == 'pickup':
            tp = [(hl, m['hoodH']), (hl - 0.4, m['hoodH'] + 0.04), (self.cowl, m['hoodH'] + 0.08), (self.roofF, m['H']), (self.roofR, m['H']), (self.roofR - 0.08, m['beltH'] + 0.03), (-hl, m['beltH'] + 0.03)]
        else:
            tp = [(hl, m['hoodH'] - 0.05), (hl - 0.45, m['hoodH'] + 0.02), (self.cowl, m['hoodH'] + 0.09), (self.roofF, m['H']), (self.roofR, m['H'] - 0.02),
                  (self.deck, m['deckH'] + 0.05), (-hl + 0.3, m['deckH'] + 0.03), (-hl, m['deckH'] - 0.05)]
        self.top = table(tp)
        self.g0 = (self.roofR - 0.08) if kind == 'pickup' else self.deck

    def in_glass(self, y):
        return self.g0 + 0.01 < y < self.cowl - 0.01

    def ring(self, y):
        m = self.m
        w = self.width(y)
        zb = self.bottom(y)
        be = self.belt(y)
        tp = max(self.top(y), be + 0.02)
        g = self.in_glass(y)
        rw = w * (1 - m['tumble'] - 0.04 * self.rnd) if g else w * 0.9
        half = [
            (w * 0.78, zb),
            (w * 0.97, zb + 0.1),
            (w * (1.0 + 0.012 * self.rnd), zb + (be - zb) * 0.55),
            (w, be),
        ]
        if g:
            half += [(w + (rw - w) * 0.55, be + (tp - be) * 0.55), (rw, tp - 0.035 * (0.5 + self.rnd)), (rw * 0.55, tp - 0.004)]
        else:
            half += [(w * 0.93, be + (tp - be) * 0.7), (w * 0.72, tp - 0.004), (w * 0.38, tp)]
        # full ring: bottom centre, the +x half up, the top centre, the -x half down
        pts = [(0.0, zb - 0.005)] + half + [(0.0, tp + 0.004 * self.rnd)] + [(-x, z) for x, z in reversed(half)]
        return pts

    def bpillars(self):
        k = self.kind
        if k == 'van':
            return []
        if k == 'pickup':
            return [(self.cowl + self.roofR) / 2 - 0.1]
        out = [(self.roofF + self.roofR) / 2 + 0.05]
        if k in ('suv', 'gwagon', 'policeSuv'):
            out.append(self.roofR + 0.07)
        return out

    def stations(self):
        hl, wz, a = self.hl, self.wz, self.archR
        ys = [hl, hl - 0.07, hl - 0.25, hl - 0.55, wz + a + 0.1, wz, wz - a - 0.1, self.cowl + 0.06, self.cowl, (self.cowl + self.roofF) / 2, self.roofF,
              self.roofR, (self.roofR + self.g0) / 2, self.g0, self.g0 - 0.06, -wz + a + 0.1, -wz, -wz - a - 0.1, -hl + 0.5,
              -hl + 0.22, -hl + 0.06, -hl]
        for p in self.bpillars():
            ys += [p + 0.055, p - 0.055]
        if self.roofF - self.roofR > 1.2:
            ys += [self.roofF - (self.roofF - self.roofR) * 0.3, self.roofR + (self.roofF - self.roofR) * 0.3]
        ys = sorted(set(round(y, 3) for y in ys if -hl <= y <= hl), reverse=True)
        out = []
        for y in ys:
            if not out or out[-1] - y > 0.045:
                out.append(y)
        return out

    def side_mat(self, seg, y0, y1):
        """material of the cage face between stations y0 > y1, ring segment seg (0..15, see cage)"""
        k = self.kind
        ym = (y0 + y1) / 2
        lowg, upg, top = seg in (4, 11), seg in (5, 10), seg in (6, 7, 8, 9)
        # the black-and-white: doors and roof white, the rest the (black) paint
        if k in ('police', 'policeSuv'):
            if seg in (2, 3, 12, 13) and self.roofR - 0.25 <= ym <= self.cowl + 0.05:
                return 'door'
            if top and self.roofR <= ym <= self.roofF:
                return 'door'
        if seg in (0, 15):
            return 'dark'
        if seg in (1, 14) and k in ('suv', 'gwagon', 'pickup', 'policeSuv', 'van'):
            return 'dark'
        if not (lowg or upg or top):
            return 'paint'
        if not (self.g0 - 0.001 <= ym <= self.cowl + 0.001):
            return 'paint'
        if self.roofF <= ym <= self.cowl:            # the windscreen bay
            if top:
                return 'glass'
            if upg:
                return 'dark'                          # A-pillar
            return 'glass' if k not in ('van', 'pickup') else 'dark'
        if self.roofR <= ym <= self.roofF:           # under the roof: the side windows
            if top:
                return 'paint'
            if any(abs(ym - p) < 0.06 for p in self.bpillars()):
                return 'dark'                          # B-pillar
            if k == 'van' and ym < self.cowl - 1.1:
                return 'paint'
            return 'glass'
        # behind the roof: the backlight and the C-pillar
        if top:
            return 'glass'
        if k in ('suv', 'gwagon', 'policeSuv', 'van'):
            return 'glass' if lowg or upg else 'paint'
        return 'paint'


MATS = ['paint', 'glass', 'dark', 'heads', 'tails', 'grille', 'trim', 'door']


def cage(sh):
    bm = bmesh.new()
    crease = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
    ys = sh.stations()
    rings = []
    for y in ys:
        r = [bm.verts.new((x, y, z)) for x, z in sh.ring(y)]
        rings.append(r)
    n = len(rings[0])
    MI = {m: i for i, m in enumerate(MATS)}
    for i in range(len(rings) - 1):
        for k in range(n):
            a, b = rings[i][k], rings[i][(k + 1) % n]
            c, d = rings[i + 1][(k + 1) % n], rings[i + 1][k]
            try:
                f = bm.faces.new((a, d, c, b))
                f.material_index = MI[sh.side_mat(k, ys[i], ys[i + 1])]
            except ValueError:
                pass
    # nose and tail: a ring set in (the lamps on its upper corners, the intake low), a second ring set
    # deeper (the fascia), then the cap (the grille in front)
    for idx, sgn in ((0, 1), (len(rings) - 1, -1)):
        r = rings[idx]
        cz = sum(v.co.z for v in r) / n
        y1 = r[0].co.y + sgn * 0.04
        in1 = [bm.verts.new((v.co.x * 0.9, y1, cz + (v.co.z - cz) * 0.86)) for v in r]
        y2 = y1 + sgn * 0.02
        gz = cz - 0.06 if sgn > 0 else cz
        in2 = [bm.verts.new((v.co.x * 0.5, y2, gz + (v.co.z - cz) * 0.38)) for v in r]
        for ring_a, ring_b, which in ((r, in1, 'outer'), (in1, in2, 'inner')):
            for k in range(n):
                a, b = ring_a[k], ring_a[(k + 1) % n]
                c, d = ring_b[(k + 1) % n], ring_b[k]
                try:
                    f = bm.faces.new((a, b, c, d) if sgn > 0 else (a, d, c, b))
                except ValueError:
                    continue
                m = 'paint'
                if which == 'outer':
                    if k in (0, 1, 14, 15):
                        m = 'dark'
                    elif k in (6, 7, 8, 9) and sgn > 0 and sh.kind == 'van':
                        m = 'glass'
                else:
                    # the fascia's upper corners carry the lamps
                    if k in (3, 4, 11, 12):
                        m = 'heads' if sgn > 0 else 'tails'
                    elif k in (0, 15):
                        m = 'dark'
                f.material_index = MI[m]
        try:
            f = bm.faces.new(in2 if sgn > 0 else list(reversed(in2)))
            f.material_index = MI['grille' if sgn > 0 else 'paint']
        except ValueError:
            pass
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # creases: the shoulder (ring point 4 = the belt), the sill (2), the roof edge (6) along the car
    bx = sh.m['box']
    lines = {2: 0.55 + 0.4 * bx, 4: 0.85 + 0.15 * bx, 6: 0.55 + 0.43 * bx, 3: 0.6 * bx * bx}
    for i in range(len(rings) - 1):
        for k, c in lines.items():
            for kk in (k, n - k):
                e = bm.edges.get((rings[i][kk], rings[i + 1][kk]))
                if e:
                    e[crease] = c
    # and every edge between two different materials, a little (crisp lamp, glass and grille outlines)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.link_faces[0].material_index != e.link_faces[1].material_index:
            e[crease] = max(e[crease], 0.7)
    # boxy bodies: the nose and tail edges sharp too
    if bx > 0.5:
        for ring in (rings[0], rings[-1]):
            for k in range(n):
                e = bm.edges.get((ring[k], ring[(k + 1) % n]))
                if e:
                    e[crease] = max(e[crease], 0.5 + 0.45 * bx)
    me = bpy.data.meshes.new('cage_' + sh.kind)
    bm.to_mesh(me)
    bm.free()
    for m in MATS:
        me.materials.append(bpy.data.materials.get('cage_' + m) or bpy.data.materials.new('cage_' + m))
    ob = bpy.data.objects.new('car_' + sh.kind, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def apply_mods(ob):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    for md in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=md.name)


def wheel_wells(ob, sh):
    m = sh.m
    for y in (sh.wz, -sh.wz):
        for s in (1, -1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=sh.archR, depth=0.7, location=(s * (sh.hw + 0.05), y, m['wheelR'] + 0.01), rotation=(0, math.pi / 2, 0))
            cyl = bpy.context.active_object
            cyl.data.materials.append(ob.data.materials[MATS.index('dark')])
            md = ob.modifiers.new('well', 'BOOLEAN')
            md.material_mode = 'TRANSFER'
            md.operation = 'DIFFERENCE'
            md.solver = 'EXACT'
            md.object = cyl
            apply_mods(ob)
            bpy.data.objects.remove(cyl)


def classify(ob, sh):
    """split the subdivided body by the materials the cage gave its faces"""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    names = [m.name.replace('cage_', '').split('.')[0] for m in me.materials]
    cls = {f.index: names[f.material_index] if f.material_index < len(names) else 'paint' for f in bm.faces}
    parts = {}
    for name, keys in (('body', ('paint', 'dark', 'trim', 'grille', 'door')), ('glass', ('glass',)), ('heads', ('heads',)), ('tails', ('tails',))):
        b2 = bm.copy()
        b2.faces.ensure_lookup_table()
        kill = [f for f in b2.faces if cls[f.index] not in keys]
        bmesh.ops.delete(b2, geom=kill, context='FACES')
        colors = [{'paint': PAINT, 'dark': DARK, 'trim': TRIM, 'grille': GRILLE, 'door': DOOR}.get(cls[f.index], PAINT) for f in bm.faces if cls[f.index] in keys]
        me2 = bpy.data.meshes.new(f'car_{sh.kind}_{name}')
        b2.to_mesh(me2)
        if name == 'body':
            col = me2.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
            for poly in me2.polygons:
                for li in poly.loop_indices:
                    col.data[li].color = colors[poly.index]
        for p in me2.polygons:
            p.use_smooth = True
        parts[name] = me2
        b2.free()
    bm.free()
    return parts


def box(bm, col_layer, colors, c, h, color):
    """an axis box (centre, half sizes) added to bm, recording its face colour"""
    x, y, z = c
    hx, hy, hz = h
    v = [bm.verts.new((x + sx * hx, y + sy * hy, z + sz * hz)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    for q in quads:
        f = bm.faces.new([v[i] for i in q])
        colors.append(color)


def extras(sh):
    """mirrors, door handles, plates, a dark cabin, exhausts: one more mesh merged into the body"""
    m = sh.m
    bm = bmesh.new()
    colors = []
    hw, hl = sh.hw, sh.hl
    be = m['beltH']
    for s in (1, -1):
        # mirror: a stalk and a housing just behind the A-pillar foot
        y = sh.cowl - 0.12
        w = sh.width(y)
        bz = sh.belt(y)
        box(bm, None, colors, (s * (w + 0.03), y, bz + 0.05), (0.05, 0.03, 0.02), DARK)
        box(bm, None, colors, (s * (w + 0.1), y - 0.02, bz + 0.1), (0.08, 0.05, 0.065), PAINT)
        # door handles
        doors = [sh.cowl - 0.55] if sh.kind in ('coupe', 'super', 'muscle') else [sh.cowl - 0.6, (sh.roofF + sh.roofR) / 2 - 0.25]
        for yd in doors:
            box(bm, None, colors, (s * (sh.width(yd) + 0.008), yd, be - 0.09), (0.012, 0.09, 0.016), CHROME if sh.kind in ('police',) else TRIM)
    # police: a push bar on the nose, a light bar base and its feet on the roof, a spotlight by the A-pillar
    if sh.kind in ('police', 'policeSuv'):
        for sx in (-0.32, 0.32):
            box(bm, None, colors, (sx, hl + 0.1, (m['hoodH'] + m['clear']) / 2), (0.035, 0.035, (m['hoodH'] - m['clear']) / 2 - 0.05), DARK)
        for zz in (m['hoodH'] - 0.12, m['clear'] + 0.25):
            box(bm, None, colors, (0, hl + 0.11, zz), (0.42, 0.03, 0.03), DARK)
        yb = (sh.roofF + sh.roofR) / 2 + 0.12
        box(bm, None, colors, (0, yb, m['H'] + 0.02), (0.64, 0.17, 0.025), DARK)
        y = sh.cowl - 0.15
        box(bm, None, colors, (sh.width(y) * 0.98, y, sh.belt(y) + 0.22), (0.04, 0.07, 0.04), CHROME)
    # plates
    box(bm, None, colors, (0, hl + 0.005, m['clear'] + 0.32), (0.26, 0.012, 0.065), PLATE)
    box(bm, None, colors, (0, -hl - 0.005, m['deckH'] - 0.42), (0.26, 0.012, 0.065), PLATE)
    # the cabin seen through the glass: dark tub, two rows of seat backs
    y0, y1 = sh.g0 + 0.15, sh.cowl - 0.25
    if y1 > y0:
        w = hw - 0.16
        box(bm, None, colors, (0, (y0 + y1) / 2, be - 0.05), (w, (y1 - y0) / 2, 0.12), DARK)
        for yr in ((y0 + y1) / 2 + 0.05, (y0 + y1) / 2 - 0.75):
            if y0 < yr < y1:
                top = sh.top(yr) - 0.14
                h = max(0.1, (top - be) / 2)
                for s in (1, -1):
                    box(bm, None, colors, (s * w * 0.48, yr, be + h - 0.05), (0.24, 0.06, h), DARK)
    # exhausts
    if sh.kind in ('muscle', 'super', 'coupe', 'sedan'):
        for s in ((1, -1) if sh.kind != 'sedan' else (1,)):
            bpy_y = -hl - 0.02
            box(bm, None, colors, (s * hw * 0.55, bpy_y, m['clear'] + 0.1), (0.045, 0.06, 0.045), CHROME)
    me = bpy.data.meshes.new('extras_' + sh.kind)
    bm.to_mesh(me)
    bm.free()
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for poly in me.polygons:
        for li in poly.loop_indices:
            col.data[li].color = colors[poly.index]
    return me


def material(name, col, emissive=None):
    mt = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mt.use_nodes = True
    bsdf = mt.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = col
    if name == 'od-body':
        vc = mt.node_tree.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        mt.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.25
        bsdf.inputs['Coat Weight'].default_value = 1.0
    if emissive:
        bsdf.inputs['Emission Color'].default_value = emissive
        bsdf.inputs['Emission Strength'].default_value = 2.0
    if name == 'od-carglass':
        bsdf.inputs['Roughness'].default_value = 0.02
        bsdf.inputs['Metallic'].default_value = 0.4
    return mt


def build(kind):
    sh = Shape(kind, SPECS[kind])
    ob = cage(sh)
    md = ob.modifiers.new('sub', 'SUBSURF')
    md.levels = 2
    md.render_levels = 2
    md.use_creases = True
    apply_mods(ob)
    wheel_wells(ob, sh)
    parts = classify(ob, sh)
    # merge the extras into the body
    ex = extras(sh)
    bmb = bmesh.new()
    bmb.from_mesh(parts['body'])
    bmb.from_mesh(ex)
    me = parts['body']
    bmb.to_mesh(me)
    bmb.free()
    bpy.data.objects.remove(ob)
    out = []
    mats = {'body': material('od-body', (1, 1, 1, 1)), 'glass': material('od-carglass', (0.02, 0.025, 0.03, 1)),
            'heads': material('od-carhead', (0.9, 0.9, 0.9, 1), (1, 1, 0.95, 1)), 'tails': material('od-cartail', (0.5, 0.02, 0.02, 1), (1, 0.05, 0.03, 1))}
    for name, me in parts.items():
        me.materials.clear()
        me.materials.append(mats[name])
        o = bpy.data.objects.new(f'car_{kind}_{name}', me)
        bpy.context.scene.collection.objects.link(o)
        out.append(o)
    print(kind, {k: len(v.polygons) for k, v in parts.items()}, flush=True)
    return out


bpy.ops.wm.read_factory_settings(use_empty=True)
made = {}
for kind in SPECS:
    made[kind] = build(kind)

if PREVIEW:
    sc = bpy.context.scene
    only = [k for k in sys.argv[sys.argv.index('preview') + 2:]] or list(made)
    for kind, obs in made.items():
        for o in obs:
            o.hide_render = kind not in only
    cols = min(4, len(only))
    for i, kind in enumerate(only):
        for o in made[kind]:
            o.location = ((i % cols) * 4.2, -(i // cols) * 7.5, 0)
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.0
    so = bpy.data.objects.new('sun', sun)
    so.rotation_euler = (math.radians(45), 0, math.radians(-35))
    sc.collection.objects.link(so)
    sc.world = bpy.data.worlds.new('w')
    sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.45, 0.55, 0.7, 1)
    sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.5
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
    gm = bpy.data.materials.new('ground'); gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.18, 0.18, 0.18, 1)
    bpy.context.active_object.data.materials.append(gm)
    # paint the bodies a mid blue so the trim reads
    bm_ = bpy.data.materials['od-body']
    nt = bm_.node_tree
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    vc = [n for n in nt.nodes if n.type == 'VERTEX_COLOR'][0]
    nt.links.new(vc.outputs['Color'], mix.inputs['A'])
    mix.inputs['B'].default_value = (0.08, 0.2, 0.55, 1)
    nt.links.new(mix.outputs['Result'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    cam = bpy.data.cameras.new('cam')
    cam.lens = 45
    co = bpy.data.objects.new('cam', cam)
    cx = (cols - 1) * 2.1
    rows = (len(only) + cols - 1) // cols
    cy = -(rows - 1) * 3.75
    co.location = (cx + 7 + cols * 1.5, cy + 9 + rows * 4.5, 3.5 + rows * 2.2)
    sc.collection.objects.link(co)
    direction = Vector((cx, cy, 0.5)) - co.location
    co.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 1400, 800
    sc.render.filepath = sys.argv[sys.argv.index('preview') + 1]
    bpy.ops.render.render(write_still=True)
else:
    for kind, obs in made.items():
        for o in obs:
            # Blender forward +y -> three +z: turn the car round (x and y flip; the body is symmetric)
            o.data.transform(__import__('mathutils').Matrix.Rotation(math.pi, 4, 'Z'))
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'cars.glb'), export_format='GLB', export_apply=True, export_normals=True,
                              export_vertex_color='ACTIVE', export_materials='EXPORT', export_lights=False, export_cameras=False)
    print('glb', os.path.getsize(os.path.join(OUT, 'cars.glb')) / 1e6)
