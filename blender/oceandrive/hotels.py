"""Ocean Drive's Art Deco frontage, from the OSM footprints (runs inside Blender).

Every building facing Ocean Drive becomes a hotel in the 1930s-40s Tropical Deco idiom the street is
known for: a raised terrazzo porch (open loggia under the upper floors, or a canopy / striped awning),
recessed windows with frames and sills, eyebrow ledges over each floor, racing-stripe grooves, a stepped
crown, often a central pylon carrying a vertical neon sign. Proportions and colours per building come
from SPECS (the real hotels' massing and palette, by street number); geometry comes from the footprint."""
import math, random
from lib import MB, hexcol, text_mesh, WHITE

SW = 0.15      # sidewalk top
FL0 = 4.3      # ground floor (sidewalk to first-floor slab)
FLH = 3.15     # upper floor height
PORCH_UP = 0.45

# housenumber -> look. body/trim/accent are sRGB; sign kinds: v (vertical on the pylon), top (on the crown), fascia
SPECS = {
    '530': dict(floors=4, body='#f3ebdf', trim='#9fc9d9', accent='#2f7fa3', porch='loggia', crown='step', sign='BARBIZON', sk='top', neon='#5ad1ff'),
    '600': dict(floors=4, body='#f8d9a8', trim='#e8a06a', accent='#c2593a', porch='awning', crown='flat', sign='BEACH PARK', sk='top', neon='#ff6a3d', aw='#d9573b'),
    '320': dict(floors=4, body='#cfeee3', trim='#8fd3c1', accent='#2b8f7c', porch='canopy', crown='fins'),
    '626': dict(floors=3, body='#f9d3e0', trim='#f2a7c3', accent='#c4487a', porch='canopy', crown='step', sign='HEATHCOTE', sk='top', neon='#ff4fa0'),
    '640': dict(floors=7, body='#b9c8ec', trim='#f4f4f2', accent='#5d72a8', porch='loggia', crown='fins', sign='PARK CENTRAL', sk='top', neon='#4fa8ff', pylon=True),
    '650': dict(floors=4, body='#dff2e8', trim='#a9d6c8', accent='#4b9b86', porch='canopy', crown='step', sign='GABRIEL', sk='top', neon='#7dffd8'),
    '660': dict(floors=4, body='#f7f6f1', trim='#5fbfd6', accent='#1f6e86', porch='loggia', crown='step', sign='MAJESTIC', sk='v', neon='#5ad1ff', pylon=True),
    '700': dict(floors=3, body='#fbf6e6', trim='#f3c63a', accent='#e0a91f', porch='canopy', crown='step', sign='AVALON', sk='top', neon='#45b6ff', corner=True),
    '720': dict(floors=4, body='#f8f6f0', trim='#f6cc3d', accent='#e8574a', accent2='#36b5b0', porch='awning', crown='step', sign='BEACON', sk='v', neon='#ff4a4a', pylon=True, aw='#f2f2f2'),
    '728': dict(floors=2, body='#f1dcc0', trim='#c9b79a', accent='#8f7a5c', porch='none', crown='flat', sign='PHARMACY', sk='fascia', neon='#ff3b3b'),
    '736': dict(floors=4, body='#f9f9f6', trim='#22a3e0', accent='#1d6fb3', porch='canopy', crown='step', sign='COLONY', sk='v', neon='#3fb8ff', pylon=True),
    '740': dict(floors=3, body='#e4f6ef', trim='#5fd0b0', accent='#2f9e86', porch='awning', crown='step', sign='BOULEVARD', sk='top', neon='#55ffcc', aw='#2f9e86'),
    '750': dict(floors=3, body='#f7c6d3', trim='#fbf4ef', accent='#d9577f', porch='canopy', crown='step', sign='STARLITE', sk='v', neon='#ff4fa0', pylon=True),
    '760': dict(floors=3, body='#f8df8a', trim='#f1f0ea', accent='#e8784e', porch='awning', crown='flat', sign='CAFE 760', sk='fascia', neon='#ffb13d', aw='#e8784e'),
    '800': dict(floors=2, body='#f3e6c4', trim='#2f5d45', accent='#2f5d45', porch='awning', crown='flat', sign='NEWS CAFE', sk='fascia', neon='#ffffff', aw='#2f5d45'),
    '810': dict(floors=3, body='#cfe2f2', trim='#f7f7f5', accent='#6f97b8', porch='canopy', crown='step'),
    '820': dict(floors=3, body='#e6dcf5', trim='#b7a3d6', accent='#7a5fae', porch='loggia', crown='step', sign='SHORE PARK', sk='top', neon='#c27bff'),
    '826': dict(floors=4, body='#f8bd96', trim='#bfa4dc', accent='#7a5fae', porch='awning', crown='fins', sign='PELICAN', sk='v', neon='#ff8a3d', pylon=True, aw='#7a5fae'),
    '834': dict(floors=4, body='#f3dcb0', trim='#d0a46a', accent='#8c5a2b', porch='loggia', crown='flat', sign='CASA GRANDE', sk='top', neon='#ffcf6a'),
    '844': dict(floors=3, body='#d6f0dc', trim='#9bd3a6', accent='#3f8f55', porch='canopy', crown='step'),
    '860': dict(floors=4, body='#f7f5ef', trim='#f2a88a', accent='#d06a4c', porch='canopy', crown='step', sign='WALDORF TOWERS', sk='top', neon='#ff7a5a', tower=True),
    '900': dict(floors=2, body='#f9d34a', trim='#3bb3c4', accent='#e8434a', porch='awning', crown='flat', sign='TROPICAL CAFE', sk='fascia', neon='#ff4fd8', aw='#e8434a'),
    '918': dict(floors=3, body='#c9eee5', trim='#f4f4f2', accent='#3a9c8a', porch='canopy', crown='step'),
    '928': dict(floors=3, body='#f4dbeb', trim='#e5a3c8', accent='#b04f86', porch='awning', crown='flat', aw='#b04f86'),
    '940': dict(floors=4, body='#f7f6f0', trim='#3a6fd1', accent='#f4c430', porch='canopy', crown='step', sign='BREAKWATER', sk='v', neon='#3d7bff', pylon=True),
    '960': dict(floors=4, body='#efe2c8', trim='#c9a66b', accent='#8c6a3b', porch='loggia', crown='step', sign='EDISON', sk='top', neon='#ffd27a'),
}
DEFAULT = dict(floors=3, body='#f2efe6', trim='#c8d8de', accent='#6a8fa0', porch='canopy', crown='flat')

FONT = None   # set by build.py
STREET = None  # (x, y) -> is there a road: set by build.py
SHOPS = []     # street-facing shopfronts, for the browser to dress (signs, awnings, light)


def window_wall(mb, o, U, N, w, h, openings, mat, col, depth=0.2, frame_col=WHITE, glass='od_glass', sills=True, ac=None, frames=True):
    """A wall in the plane o + U*u + Z*v (u in [0,w], v in [0,h]) facing N, with real recessed openings.
    openings: (u0, v0, u1, v1, kind) kind 'win' | 'shop' | 'door' | 'void' (open, no glass)"""
    Z = (0.0, 0.0, 1.0)
    def P(u, v, n=0.0):
        return (o[0] + U[0] * u + N[0] * n, o[1] + U[1] * u + N[1] * n, o[2] + v + N[2] * n)
    us = sorted({0.0, w} | {x for op in openings for x in (op[0], op[2])})
    vs = sorted({0.0, h} | {x for op in openings for x in (op[1], op[3])})
    def inside(u, v):
        for op in openings:
            if op[0] < u < op[2] and op[1] < v < op[3]:
                return True
        return False
    for i in range(len(us) - 1):
        for j in range(len(vs) - 1):
            if us[i + 1] - us[i] < 1e-4 or vs[j + 1] - vs[j] < 1e-4:
                continue
            if inside((us[i] + us[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2):
                continue
            mb.face([P(us[i], vs[j]), P(us[i + 1], vs[j]), P(us[i + 1], vs[j + 1]), P(us[i], vs[j + 1])], mat, col, n=N)
    negU = (-U[0], -U[1], -U[2])
    for (u0, v0, u1, v1, kind) in openings:
        d = depth if kind == 'win' else (0.3 if kind in ('shop', 'door') else 2.5)
        # reveals
        mb.face([P(u0, v0), P(u1, v0), P(u1, v0, -d), P(u0, v0, -d)], mat, col, n=Z)
        mb.face([P(u0, v1), P(u1, v1), P(u1, v1, -d), P(u0, v1, -d)], mat, col, n=(0, 0, -1))
        mb.face([P(u0, v0), P(u0, v1), P(u0, v1, -d), P(u0, v0, -d)], mat, col, n=U)
        mb.face([P(u1, v0), P(u1, v1), P(u1, v1, -d), P(u1, v0, -d)], mat, col, n=negU)
        if kind == 'void':
            mb.face([P(u0, v0, -d), P(u1, v0, -d), P(u1, v1, -d), P(u0, v1, -d)], 'od_interior', WHITE, n=N)
            continue
        g = glass if kind == 'win' else 'od_shopglass'
        mb.face([P(u0, v0, -d), P(u1, v0, -d), P(u1, v1, -d), P(u0, v1, -d)], g, WHITE, n=N)
        if not frames:
            if kind == 'win' and sills:
                c = P((u0 + u1) / 2, v0 - 0.05, 0.04)
                mb.obox(c, U, N, Z, (u1 - u0) / 2 + 0.07, 0.07, 0.05, 'od_trim', col)
            continue
        # frame: border + mullions, slightly proud of the glass
        fw, fd = 0.055, 0.045
        def bar(ua, va, ub, vb):
            c = P((ua + ub) / 2, (va + vb) / 2, -d + fd / 2)
            mb.obox(c, U, N, Z, (ub - ua) / 2, fd / 2, (vb - va) / 2, 'od_frame', frame_col)
        bar(u0, v0, u1, v0 + fw); bar(u0, v1 - fw, u1, v1); bar(u0, v0, u0 + fw, v1); bar(u1 - fw, v0, u1, v1)
        ww = u1 - u0
        if kind == 'win':
            nm = 2 if ww > 1.6 else 1
            for k in range(1, nm + 1):
                um = u0 + ww * k / (nm + 1)
                bar(um - fw / 2, v0, um + fw / 2, v1)
            vt = v0 + (v1 - v0) * 0.62
            bar(u0, vt - fw / 2, u1, vt + fw / 2)
            if sills:
                c = P((u0 + u1) / 2, v0 - 0.05, 0.04)
                mb.obox(c, U, N, Z, ww / 2 + 0.07, 0.07, 0.05, 'od_trim', col)
            if ac is not None and ac.random() < 0.22:
                ac_unit(mb, P, u0, u1, v0, N, ac)
        else:
            nm = max(1, int(ww / 1.4))
            for k in range(1, nm):
                um = u0 + ww * k / nm
                bar(um - 0.03, v0, um + 0.03, v1)
            vt = v1 - 0.55
            bar(u0, vt - 0.03, u1, vt + 0.03)


def ac_unit(mb, P, u0, u1, v0, N, rng):
    """a through-the-wall air conditioner under a window: beige box, grille, drip stain"""
    uc = (u0 + u1) / 2
    c = P(uc, v0 - 0.32, 0.22)
    mb.obox(c, (P(1, 0)[0] - P(0, 0)[0], P(1, 0)[1] - P(0, 0)[1], 0), N, (0, 0, 1), 0.33, 0.24, 0.2, 'od_metal', hexcol(rng.choice(['#d9d2c3', '#e6e1d6', '#c9c4ba'])))


def bays(w, bw=2.7, margin=0.7):
    n = max(1, int(round((w - 2 * margin) / bw)))
    s = (w - 2 * margin) / n
    return [(margin + s * i, margin + s * (i + 1)) for i in range(n)]


def neon_text(mb_list, name, txt, font, size, origin, U, N, col, vertical=False, tube=0.028):
    """neon tube letters (outlined, bevelled) standing on a wall: returns an object list"""
    import bpy
    from mathutils import Matrix, Vector
    obs = []
    lines = list(txt) if vertical else [txt]
    for i, line in enumerate(lines):
        if line == ' ':
            continue
        me = text_mesh(f'{name}_{i}', line, font, size, bevel=tube, outline=True)
        # letters lie in XY: x along, y up -> map x->U, y->Z, z->N
        if vertical:
            off = Vector(origin) - Vector((0, 0, i * size * 1.08))
        else:
            off = Vector(origin)
        M = Matrix(((U[0], 0, N[0], off.x), (U[1], 0, N[1], off.y), (U[2], 1, N[2], off.z), (0, 0, 0, 1)))
        me.transform(M)
        if not me.color_attributes.get('Col'):
            me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        ca = me.color_attributes['Col']
        c = hexcol(col)
        for d in ca.data:
            d.color = c
        me.materials.clear()
        from lib import get_mat
        me.materials.append(get_mat('od_neon'))
        if not me.uv_layers:
            me.uv_layers.new(name='UVMap')
        ob = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(ob)
        obs.append(ob)
    return obs


def build_hotel(mb, foot, number, rng, signs, props):
    """foot: (x_back, x_front, y0, y1) in local metres; mb collects stucco/glass geometry;
    signs: list to collect neon objects; props: list of prop placements (kind, x, y, z, rot)"""
    sp = dict(DEFAULT)
    sp.update(SPECS.get(number, {}))
    xb, xf, y0, y1 = foot
    W = y1 - y0
    body, trim, acc = hexcol(sp['body']), hexcol(sp['trim']), hexcol(sp['accent'])
    acc2 = hexcol(sp.get('accent2', sp['accent']))
    N = sp['floors']
    Htop = FL0 + FLH * (N - 1) + 1.2 + SW
    porch = sp['porch']
    pd = 3.4 if porch != 'none' else 0.0
    if porch == 'loggia':
        xu, xg = xf - 0.15, xf - pd
    else:
        xu = xf - pd
        xg = xu - 0.15
    UF, NF = (0.0, 1.0, 0.0), (1.0, 0.0, 0.0)       # front: along +y, facing +x
    pylon = sp.get('pylon', False)
    yc = (y0 + y1) / 2
    pw = 1.7 if pylon else 0.0

    # ---------------- upper facade (front)
    ops = []
    def bay_list():
        if not pylon:
            return bays(W)
        half = (W - pw) / 2
        L = bays(half, margin=0.6)
        return L + [(W - b, W - a) for a, b in L]
    BL = bay_list()
    for f in range(1, N):
        zf = FL0 + FLH * (f - 1)
        for a, b in BL:
            cw = b - a
            ww = min(cw - 0.5, 1.9)
            u0 = a + (cw - ww) / 2
            ops.append((u0, zf + 0.85, u0 + ww, zf + 0.85 + 1.6, 'win'))
    hu = Htop - FL0 - SW
    window_wall(mb, (xu, y0, FL0 + SW), UF, NF, W, hu, ops, 'od_stucco', body, depth=0.22)
    # soffit/top of the ground floor where the upper wall overhangs (loggia) or the setback roof (canopy)
    if porch == 'loggia':
        mb.face([(xg, y0, FL0 + SW), (xu, y0, FL0 + SW), (xu, y1, FL0 + SW), (xg, y1, FL0 + SW)], 'od_stucco', body, n=(0, 0, -1))
    # ---------------- ground floor storefront
    gops = []
    for a, b in bays(W, bw=3.2, margin=0.55):
        gops.append((a + 0.12, PORCH_UP + 0.15 if porch != 'none' else 0.05, b - 0.12, FL0 - 0.45, 'shop'))
    window_wall(mb, (xg, y0, SW), UF, NF, W, FL0, gops, 'od_stucco', body)
    if porch == 'loggia':
        # columns along the porch edge + end piers
        cols = [a for a, b in bays(W, bw=3.2, margin=0.55)][1:]
        for u in cols:
            mb.box(xf - 0.75, y0 + u - 0.22, SW + PORCH_UP, xf - 0.3, y0 + u + 0.22, FL0 + SW, 'od_stucco', trim)
        for ya, yb in ((y0, y0 + 0.55), (y1 - 0.55, y1)):
            mb.box(xg, ya, SW, xf - 0.15, yb, FL0 + SW, 'od_stucco', body, skip=('-z',))
        # band across the loggia head
        mb.box(xu - 0.05, y0, FL0 + SW - 0.55, xu + 0.06, y1, FL0 + SW, 'od_trim', trim)
    elif porch == 'canopy':
        # thin concrete canopy slab across the porch, slim posts at the front
        zc = FL0 - 0.55 + SW
        mb.box(xu, y0 + 0.1, zc, xf + 0.15, y1 - 0.1, zc + 0.16, 'od_trim', trim)
        mb.box(xf + 0.13, y0 + 0.1, zc - 0.04, xf + 0.19, y1 - 0.1, zc + 0.2, 'od_trim', acc)
        for u in (0.5, W - 0.5):
            mb.cyl((xf - 0.1, y0 + u, SW + PORCH_UP), 0.06, 0.06, zc - SW - PORCH_UP, 10, 'od_metal', hexcol('#e8e8e8'))
        # low side walls of the porch
        for ya, yb in ((y0, y0 + 0.25), (y1 - 0.25, y1)):
            mb.box(xg, ya, SW, xf, yb, SW + PORCH_UP + 0.9, 'od_stucco', body)
        # the setback roof between canopy and upper wall is the upper wall itself (xu): close the ground floor top
        mb.face([(xg, y0, FL0 + SW), (xu, y0, FL0 + SW), (xu, y1, FL0 + SW), (xg, y1, FL0 + SW)], 'od_stucco', body, n=(0, 0, 1))
    elif porch == 'awning':
        for ya, yb in ((y0, y0 + 0.25), (y1 - 0.25, y1)):
            mb.box(xg, ya, SW, xf, yb, SW + PORCH_UP + 0.9, 'od_stucco', body)
        mb.face([(xg, y0, FL0 + SW), (xu, y0, FL0 + SW), (xu, y1, FL0 + SW), (xg, y1, FL0 + SW)], 'od_stucco', body, n=(0, 0, 1))
        awc = hexcol(sp.get('aw', sp['accent']))
        za, zb = FL0 - 0.2 + SW, FL0 - 1.35 + SW
        xe = xf + 0.3
        # sloped fabric + valance (uv: stripes run down the slope -> u along y)
        mb.face([(xu, y0 + 0.2, za), (xu, y1 - 0.2, za), (xe, y1 - 0.2, zb), (xe, y0 + 0.2, zb)], 'od_awning', awc,
                uvs=[(0, 0), (W - 0.4, 0), (W - 0.4, 1), (0, 1)], n=(0.7, 0, 0.7))
        mb.face([(xu, y0 + 0.2, za - 0.01), (xu, y1 - 0.2, za - 0.01), (xe, y1 - 0.2, zb - 0.01), (xe, y0 + 0.2, zb - 0.01)], 'od_awning', awc,
                uvs=[(0, 0), (W - 0.4, 0), (W - 0.4, 1), (0, 1)], n=(-0.7, 0, -0.7))
        mb.face([(xe, y0 + 0.2, zb), (xe, y1 - 0.2, zb), (xe, y1 - 0.2, zb - 0.32), (xe, y0 + 0.2, zb - 0.32)], 'od_awning', awc,
                uvs=[(0, 1), (W - 0.4, 1), (W - 0.4, 1.25), (0, 1.25)], n=(1, 0, 0))
        mb.face([(xe, y0 + 0.2, zb), (xe, y1 - 0.2, zb), (xe, y1 - 0.2, zb - 0.32), (xe, y0 + 0.2, zb - 0.32)], 'od_awning', awc,
                uvs=[(0, 1), (W - 0.4, 1), (W - 0.4, 1.25), (0, 1.25)], n=(-1, 0, 0))
        for u in (0.3, W - 0.3):
            mb.cyl((xe - 0.05, y0 + u, SW + PORCH_UP), 0.035, 0.035, zb - SW - PORCH_UP, 8, 'od_metal', hexcol('#d8d8d8'))
    # porch slab + steps
    if porch != 'none':
        xs = xf - 0.9
        mb.box(xg, y0, SW, xs, y1, SW + PORCH_UP, 'od_terrazzo', WHITE, skip=('-z',))
        for k in range(3):
            mb.box(xs + 0.3 * k, y0 + 0.25, SW, xs + 0.3 * (k + 1), y1 - 0.25, SW + PORCH_UP * (3 - k) / 3, 'od_terrazzo', WHITE, skip=('-z',))
        # cafe tables on the porch
        for a, b in bays(W, bw=2.4, margin=1.0):
            props.append(('bistro', (xg + xs) / 2 + rng.uniform(-0.3, 0.3), y0 + (a + b) / 2, SW + PORCH_UP, rng.uniform(0, 6.28)))
    # ---------------- eyebrows + bands
    pyl = (yc - pw / 2 - 0.05, yc + pw / 2 + 0.05) if pylon else None
    for f in range(1, N):
        z = FL0 + SW + FLH * (f - 1) + 0.85 + 1.6 + 0.16
        segs = [(y0 + 0.25, y1 - 0.25)] if not pyl else [(y0 + 0.25, pyl[0]), (pyl[1], y1 - 0.25)]
        for a, b in segs:
            mb.box(xu, a, z, xu + 0.62, b, z + 0.09, 'od_trim', trim)
            mb.box(xu + 0.58, a, z - 0.1, xu + 0.64, b, z + 0.09, 'od_trim', acc)
        # floor band (racing stripe) at sill level
        zb = FL0 + SW + FLH * (f - 1) + 0.55
        mb.box(xu, y0 + 0.02, zb, xu + 0.035, y1 - 0.02, zb + 0.09, 'od_trim', acc2 if f % 2 else acc)
    # parapet stripes
    for k in range(3):
        z = Htop - 0.32 - k * 0.24
        mb.box(xu, y0, z, xu + 0.04, y1, z + 0.09, 'od_trim', acc if k != 1 else trim)
    # cornice
    mb.box(xu, y0 - 0.06, Htop - 0.04, xu + 0.22, y1 + 0.06, Htop + 0.1, 'od_trim', trim)
    # ---------------- crown
    crown = sp.get('crown', 'flat')
    if crown == 'step':
        for k, (wf, hh) in enumerate(((0.5, 1.1), (0.26, 0.9))):
            cw = W * wf
            z0 = Htop + 0.1 + (0 if k == 0 else 1.1)
            mb.box(xu - 1.2, yc - cw / 2, z0, xu + 0.02 + 0.1 * k, yc + cw / 2, z0 + hh, 'od_stucco', body if k == 0 else trim, skip=('-z',))
            mb.box(xu + 0.02 + 0.1 * k, yc - cw / 2, z0 + hh - 0.25, xu + 0.08 + 0.1 * k, yc + cw / 2, z0 + hh - 0.12, 'od_trim', acc)
    elif crown == 'fins':
        for k in range(-2, 3):
            hh = 1.8 - abs(k) * 0.5
            mb.box(xu - 0.6, yc + k * 0.55 - 0.09, Htop, xu + 0.3, yc + k * 0.55 + 0.09, Htop + hh, 'od_trim', trim)
    # ---------------- pylon
    if pylon:
        ztop = Htop + 2.6
        mb.box(xu, yc - pw / 2, FL0 + SW, xu + 0.42, yc + pw / 2, ztop, 'od_trim', trim, skip=('-x',))
        mb.box(xu + 0.42, yc - pw / 2 - 0.08, ztop - 0.3, xu + 0.5, yc + pw / 2 + 0.08, ztop + 0.05, 'od_trim', acc)
        for s in (-1, 1):
            mb.box(xu, yc + s * (pw / 2 + 0.06) - 0.06, FL0 + SW + 0.6, xu + 0.62, yc + s * (pw / 2 + 0.06) + 0.06, ztop - 0.8, 'od_trim', acc)
        mb.box(xu - 0.6, yc - pw / 2, Htop, xu, yc + pw / 2, ztop, 'od_trim', trim, skip=('-z',))
    # ---------------- body box: sides, back, roof
    for (yy, nrm, UU) in ((y0, (0, -1, 0), (1, 0, 0)), (y1, (0, 1, 0), (-1, 0, 0))):
        # side wall from back to the upper facade, with windows
        L = xu - xb
        o = (xb, yy, SW) if nrm[1] < 0 else (xu, yy, SW)
        sops = []
        # a corner hotel's side wall on a cross street gets shopfronts and a side entrance
        if STREET and STREET((xb + xu) / 2, yy + nrm[1] * 5):
            SHOPS.append(dict(x=round(o[0], 2), y=round(o[1], 2), ux=UU[0], uy=UU[1], nx=nrm[0], ny=nrm[1], L=round(L, 2), gf=FL0, h=round(Htop - SW, 2),
                              bays=[[round(a, 2), round(b, 2)] for a, b in bays(L - 1.0, bw=3.4, margin=0.6)], hotel=True))
            for a, b in bays(L - 1.0, bw=3.4, margin=0.6):
                if rng.random() < 0.8:
                    sops.append((a + 0.15, 0.1, b - 0.15, FL0 - 0.7, 'shop'))
                else:
                    sops.append(((a + b) / 2 - 0.55, 0.1, (a + b) / 2 + 0.55, 2.5, 'door'))
        for f in range(1, N):
            zf = FL0 + FLH * (f - 1)
            for a, b in bays(L, bw=3.6, margin=1.6):
                sops.append((a + 0.6, zf + 0.85, b - 0.6, zf + 2.25, 'win'))
        window_wall(mb, o, UU, nrm, L, Htop - SW, sops, 'od_stucco', body, depth=0.18, ac=rng)
    mb.face([(xb, y0, SW), (xb, y1, SW), (xb, y1, Htop), (xb, y0, Htop)], 'od_stucco', body, n=(-1, 0, 0))
    mb.face([(xb, y0, Htop), (xu, y0, Htop), (xu, y1, Htop), (xb, y1, Htop)], 'od_roof', WHITE, n=(0, 0, 1))
    hotel_roof(mb, xb, xu, y0, y1, Htop, body, rng, props)
    # downspouts at the back corners
    for yy in (y0 + 0.12, y1 - 0.12):
        mb.cyl((xb - 0.1, yy, SW), 0.05, 0.05, Htop - SW, 8, 'od_metal', hexcol('#cfcac0'))
    # rooftop clutter
    for k in range(rng.randint(2, 4)):
        props.append(('aircon', rng.uniform(xb + 3, xu - 4), rng.uniform(y0 + 2, y1 - 2), Htop, rng.choice((0, 1.57, 3.14))))
    # ---------------- signs
    sk, txt = sp.get('sk'), sp.get('sign')
    if txt and FONT:
        if sk == 'v' and pylon:
            n = len(txt)
            size = min(0.95, (Htop + 2.0 - (FL0 + SW + 1.2)) / (n * 1.08))
            top = Htop + 2.0 - size * 0.9
            signs += neon_text(None, f'sign_{number}', txt, FONT, size, (xu + 0.47, yc, top), UF, NF, sp['neon'], vertical=True)
        elif sk == 'top':
            size = min(1.0, W * 0.75 / max(4, len(txt)) * 1.4)
            z = Htop + (1.3 if crown == 'step' else 0.15)
            signs += neon_text(None, f'sign_{number}', txt, FONT, size, (xu + 0.18, yc, z), UF, NF, sp['neon'])
        elif sk == 'fascia':
            z = FL0 + SW + 0.35
            signs += neon_text(None, f'sign_{number}', txt, FONT, 0.62, (xu + 0.08, yc, z), UF, NF, sp['neon'])
    return Htop


# ------------------------------------------------------------------ the city behind the frontage
CITY_BODY = ['#f2efe6', '#f4e8d8', '#e8eef0', '#f3e1e4', '#e6efe6', '#efe9d2', '#e2e6ee', '#f6f1e9',
             '#f7d9b8', '#d8ecf2', '#f2d5df', '#dcefe2', '#efe0f2', '#fbe7a8', '#cfe6f5', '#f0c9b0']
CITY_TRIM = ['#ffffff', '#f4f2ea', '#8fc7d6', '#e8a6b8', '#9fd3b8', '#c9b6e6', '#f2c46a', '#5aa9c9', '#d9785a']


def city_building(mb, pts, h, rng, props, street=None):
    """A background building from its OSM footprint (ccw): every wall with real recessed windows in
    floors and bays, shopfronts at street level on the longer walls, a trim band per floor on some,
    a cornice, a parapet with coping, and roof clutter (bulkhead, AC units, a water tank)."""
    col = hexcol(rng.choice(CITY_BODY))
    trim = hexcol(rng.choice(CITY_TRIM))
    z0 = SW
    floors = max(1, int((h - 1.0) / 3.25))
    gf = 4.0 if h > 7 else 3.4
    shops = rng.random() < 0.75
    banded = rng.random() < 0.5
    winw = rng.choice((1.1, 1.3, 1.6, 1.9))
    par = rng.choice((0.7, 0.9, 1.2))
    with_ac = rng.random() < 0.35
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        if L < 0.05:
            continue
        U = (dx / L, dy / L, 0.0)
        N = (dy / L, -dx / L, 0.0)          # outward for a ccw footprint
        o = (a[0], a[1], z0)
        ops = []
        mx, my = a[0] + dx / 2 + N[0] * 5, a[1] + dy / 2 + N[1] * 5
        onst = bool(street and street(mx, my))
        shop_here = (onst and rng.random() < 0.9) or (shops and not street)
        if L > 3.2:
            # street level
            for u0, u1 in bays(L, bw=3.4, margin=0.6):
                if shop_here and L > 6:
                    ops.append((u0 + 0.15, 0.1, u1 - 0.15, gf - 0.7, 'shop'))
                elif u1 - u0 > 1.4:
                    ops.append(((u0 + u1) / 2 - 0.6, 0.95, (u0 + u1) / 2 + 0.6, 2.45, 'win'))
            for f in range(1, floors):
                zf = gf + 3.25 * (f - 1)
                if zf + 2.4 > h:
                    break
                for u0, u1 in bays(L, bw=2.9, margin=0.8):
                    ww = min(winw, u1 - u0 - 0.5)
                    if ww < 0.6:
                        continue
                    uc = (u0 + u1) / 2
                    ops.append((uc - ww / 2, zf + 0.9, uc + ww / 2, zf + 2.4, 'win'))
        window_wall(mb, o, U, N, L, h + par, ops, 'od_stucco', col, depth=0.16, ac=rng if (L > 6 and with_ac) else None, frames=False)
        def strip(z, hz, out, mat, c):
            cc = (a[0] + dx / 2 + N[0] * out / 2, a[1] + dy / 2 + N[1] * out / 2, z)
            mb.obox(cc, U, N, (0, 0, 1), L / 2 + out / 2, out / 2 + 0.01, hz, mat, c)
        # cornice under the parapet, a base band, floor bands on some
        strip(z0 + h - 0.12, 0.12, 0.22, 'od_trim', trim)
        strip(z0 + 0.25, 0.25, 0.06, 'od_trim', hexcol('#b9b3a6'))
        if banded:
            for f in range(1, floors):
                zf = z0 + gf + 3.25 * (f - 1) + 0.6
                if zf + 1 < z0 + h:
                    strip(zf, 0.05, 0.05, 'od_trim', trim)
        if shop_here and L > 6:
            SHOPS.append(dict(x=round(a[0], 2), y=round(a[1], 2), ux=round(U[0], 4), uy=round(U[1], 4), nx=round(N[0], 4), ny=round(N[1], 4),
                              L=round(L, 2), gf=gf, h=round(h, 2), bays=[[round(u0, 2), round(u1, 2)] for u0, u1 in bays(L, bw=3.4, margin=0.6)]))
            # a signboard band over the shops
            strip(z0 + gf - 0.35, 0.3, 0.08, 'od_trim', hexcol(rng.choice(CITY_TRIM)))
        # parapet: inner face and coping
        zt = z0 + h + par
        ia = (a[0] - N[0] * 0.25, a[1] - N[1] * 0.25)
        ib = (b[0] - N[0] * 0.25, b[1] - N[1] * 0.25)
        mb.face([(ia[0], ia[1], z0 + h), (ib[0], ib[1], z0 + h), (ib[0], ib[1], zt), (ia[0], ia[1], zt)], 'od_stucco', col, n=(-N[0], -N[1], 0))
        strip(zt + 0.04, 0.05, 0.36, 'od_trim', hexcol('#e9e5dc'))
    # roof slab
    mb.face([(p[0], p[1], z0 + h) for p in pts], 'od_roof', WHITE, n=(0, 0, 1))
    # roof clutter, inside the footprint's bounding box (pulled toward the centroid)
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    sx, sy = (max(xs) - min(xs)) * 0.25, (max(ys) - min(ys)) * 0.25
    if sx > 1.5 and sy > 1.5:
        if rng.random() < 0.6:
            bx, by = cx + rng.uniform(-sx, sx) * 0.5, cy + rng.uniform(-sy, sy) * 0.5
            mb.box(bx - 1.5, by - 1.8, z0 + h, bx + 1.5, by + 1.8, z0 + h + 2.6, 'od_stucco', col, skip=('-z',))
            mb.box(bx - 1.6, by - 1.9, z0 + h + 2.6, bx + 1.6, by + 1.9, z0 + h + 2.75, 'od_trim', hexcol('#d8d4ca'), skip=('-z',))
        for k in range(rng.randint(1, 4)):
            props.append(('aircon', cx + rng.uniform(-sx, sx), cy + rng.uniform(-sy, sy), z0 + h, rng.choice((0, 1.57, 3.14, 4.71))))
        if rng.random() < 0.18:
            tx, ty = cx + rng.uniform(-sx, sx) * 0.6, cy + rng.uniform(-sy, sy) * 0.6
            for lx, ly in ((-0.8, -0.8), (0.8, -0.8), (0.8, 0.8), (-0.8, 0.8)):
                mb.cyl((tx + lx, ty + ly, z0 + h), 0.07, 0.07, 2.2, 6, 'od_metal', hexcol('#6d6a64'))
            mb.cyl((tx, ty, z0 + h + 2.2), 1.3, 1.3, 2.4, 16, 'od_wood', hexcol('#8a6f52'))
            mb.cyl((tx, ty, z0 + h + 4.6), 1.35, 0.1, 0.7, 16, 'od_metal', hexcol('#5c5852'))


def hotel_roof(mb, xb, xu, y0, y1, Htop, body, rng, props):
    """the hotel roofs: a parapet round the sides and back, a stair bulkhead, a vent stack"""
    par = 0.85
    for (ya, yb) in ((y0, y0 + 0.22), (y1 - 0.22, y1)):
        mb.box(xb, ya, Htop, xu - 0.3, yb, Htop + par, 'od_stucco', body, skip=('-z',))
    mb.box(xb, y0, Htop, xb + 0.22, y1, Htop + par, 'od_stucco', body, skip=('-z',))
    for (x0, x1, ya, yb) in ((xb - 0.05, xu - 0.3, y0 - 0.05, y0 + 0.27), (xb - 0.05, xu - 0.3, y1 - 0.27, y1 + 0.05), (xb - 0.05, xb + 0.27, y0, y1)):
        mb.box(x0, ya, Htop + par, x1, yb, Htop + par + 0.07, 'od_trim', hexcol('#ece8de'))
    bx = xb + (xu - xb) * rng.uniform(0.25, 0.45)
    by = (y0 + y1) / 2 + rng.uniform(-2, 2)
    mb.box(bx - 1.6, by - 1.9, Htop, bx + 1.6, by + 1.9, Htop + 2.7, 'od_stucco', body, skip=('-z',))
    mb.box(bx - 1.7, by - 2.0, Htop + 2.7, bx + 1.7, by + 2.0, Htop + 2.85, 'od_trim', hexcol('#e2ddd2'), skip=('-z',))
    for k in range(rng.randint(1, 3)):
        mb.cyl((xb + rng.uniform(1.5, (xu - xb) * 0.7), rng.uniform(y0 + 1.2, y1 - 1.2), Htop), 0.09, 0.09, 1.6, 8, 'od_metal', hexcol('#8d8a84'))
