"""Boats and docks (inside Blender, no bake): blender -b --factory-startup -P downtown/boats.py
-> public/oceandrive/boats.glb: one object per model (boat_yacht, boat_cruiser, boat_console, boat_sail,
boat_super; the waterline at z = 0, bow toward +y) and 'docks' (every marina's floating docks and piles).

Hulls are lofted from stations (a deep-V forward flattening aft, a raked stem, a flat transom), shaded
smooth; superstructures are boxes with a raked windscreen band of tinted glass, a hardtop or a flybridge,
stainless rails; the sailboat carries a mast, boom and furled sail."""
import bpy, sys, os, math, json
HERE = os.path.dirname(os.path.abspath(__file__))
OD = os.path.dirname(HERE)
sys.path.insert(0, OD)
for m in ('lib',):
    sys.modules.pop(m, None)
import lib
from lib import MB, hexcol, WHITE
from mathutils import Vector

lib.GEN = os.path.join(OD, 'assets', 'gen')
lib.MATS.update({
    'od_hull': dict(col=(0.9, 0.9, 0.88), rough=0.15),
    'od_antifoul': dict(col=(0.08, 0.1, 0.16), rough=0.6),
    'od_boatglass': dict(col=(0.02, 0.025, 0.03), rough=0.05),
    'od_teak': dict(col=(0.45, 0.33, 0.22), rough=0.7),
    'od_chrome': dict(col=(0.8, 0.8, 0.8), rough=0.15),
    'od_canvas': dict(col=(0.85, 0.85, 0.82), rough=0.8),
})
bpy.ops.wm.read_factory_settings(use_empty=True)
WORK = os.path.join(OD, 'work')
OUT = os.path.join(OD, '..', '..', 'public', 'oceandrive')


def hull(mb, L, B, D, sheer, deadrise, col):
    """L long, B beam, D depth below the waterline; sheer: freeboard (m) at the deck edge"""
    N, K = 22, 9
    rings = []
    for i in range(N + 1):
        u = i / N                       # 0 transom .. 1 bow
        y = -L / 2 + L * u
        # half-beam: full aft, fining toward the bow (a curve), zero at the stem
        b = B / 2 * (1 - max(0, (u - 0.55) / 0.45) ** 1.8) if u < 1 else 0.02
        b = max(b, 0.02)
        keel = -D * (0.75 + 0.25 * math.sin(math.pi * min(1, u * 1.1)))
        if u > 0.85:
            keel *= 1 - (u - 0.85) / 0.15 * 0.9
        top = sheer + 0.35 * u ** 2.5   # the sheer rises to the bow
        dr = deadrise * (0.6 + 0.8 * u)
        ring = []
        for k in range(K + 1):
            t = k / K                   # 0 keel .. 1 deck edge
            # V bottom to the chine, then a flared topside
            if t < 0.45:
                s = t / 0.45
                x = b * 0.92 * s
                z = keel + (keel * -1) * s * (1 - dr) + (0.05 * s)
                z = keel * (1 - s) + (-D * 0.12) * s
            else:
                s = (t - 0.45) / 0.55
                x = b * (0.92 + 0.08 * math.sin(s * math.pi / 2))
                z = -D * 0.12 * (1 - s) + top * s
            ring.append((x, y, z))
        rings.append(ring)
    for i in range(N):
        for k in range(K):
            for sgn in (1, -1):
                a, b2, c, d = rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]
                q = [(sgn * p[0], p[1], p[2]) for p in (a, b2, c, d)]
                if sgn < 0:
                    q = q[::-1]
                zc = sum(p[2] for p in q) / 4
                mb.face(q, 'od_antifoul' if zc < 0.08 else 'od_hull', WHITE if zc < 0.08 else col)
    # transom
    r0 = rings[0]
    tr = [(p[0], p[1], p[2]) for p in r0] + [(-p[0], p[1], p[2]) for p in r0[::-1]]
    mb.face(tr, 'od_hull', col, n=(0, -1, 0))
    # deck: teak aft, white forward
    for i in range(N):
        a, b2 = rings[i][K], rings[i + 1][K]
        mat = 'od_teak' if i < N * 0.35 else 'od_hull'
        mb.face([(-a[0], a[1], a[2]), (a[0], a[1], a[2]), (b2[0], b2[1], b2[2]), (-b2[0], b2[1], b2[2])], mat, WHITE if mat == 'od_teak' else col, n=(0, 0, 1))
    return rings


def rail(mb, pts, h):
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        L = (b - a).length
        if L < 0.05:
            continue
        mb.cyl(tuple(a + Vector((0, 0, h))), 0.02, 0.02, L, 5, 'od_chrome', WHITE, caps=False, axis=tuple((b - a).normalized()))
        mb.cyl(tuple(a), 0.018, 0.018, h, 5, 'od_chrome', WHITE, caps=False)


def cabin(mb, y0, y1, w0, w1, z0, h, col, glass_h=0.55, rake=0.6):
    """a deckhouse: tapered in plan, a raked front with a band of glass"""
    pts_lo = [(-w0 / 2, y0, z0), (w0 / 2, y0, z0), (w1 / 2, y1, z0), (-w1 / 2, y1, z0)]
    pts_hi = [(-w0 / 2 * 0.95, y0, z0 + h), (w0 / 2 * 0.95, y0, z0 + h), (w1 / 2 * 0.9, y1 - rake, z0 + h), (-w1 / 2 * 0.9, y1 - rake, z0 + h)]
    for i in range(4):
        a, b, c, d = pts_lo[i], pts_lo[(i + 1) % 4], pts_hi[(i + 1) % 4], pts_hi[i]
        mb.face([a, b, c, d], 'od_hull', col)
        # the glass band round the top of each side
        g = glass_h / h
        ga = tuple(Vector(a).lerp(Vector(d), 1 - g - 0.08)); gb = tuple(Vector(b).lerp(Vector(c), 1 - g - 0.08))
        gc = tuple(Vector(b).lerp(Vector(c), 0.92)); gd = tuple(Vector(a).lerp(Vector(d), 0.92))
        nrm = (Vector(b) - Vector(a)).cross(Vector(d) - Vector(a)).normalized() * 0.01
        mb.face([tuple(Vector(p) + nrm) for p in (ga, gb, gc, gd)], 'od_boatglass', WHITE)
    mb.face(pts_hi, 'od_hull', col, n=(0, 0, 1))


def build(name, L, B, kind):
    mb = MB('boat_' + name)
    col = WHITE if kind != 'console' else hexcol('#e9eef2')
    D = {'super': 2.2, 'yacht': 1.3, 'cruiser': 0.95, 'console': 0.55, 'sail': 1.9}[kind]
    sheer = {'super': 2.4, 'yacht': 1.6, 'cruiser': 1.15, 'console': 0.85, 'sail': 0.95}[kind]
    rings = hull(mb, L, B, D, sheer, 0.3, col)
    z = sheer
    if kind == 'super':
        cabin(mb, -L * 0.38, L * 0.22, B * 0.86, B * 0.6, z, 2.6, col, 1.4, 2.0)
        cabin(mb, -L * 0.28, L * 0.1, B * 0.74, B * 0.5, z + 2.6, 2.4, col, 1.3, 1.6)
        cabin(mb, -L * 0.18, -L * 0.0, B * 0.6, B * 0.45, z + 5.0, 2.2, col, 1.2, 1.0)
        mb.cyl((0, -L * 0.08, z + 7.2), 0.25, 0.15, 3.0, 8, 'od_chrome', WHITE)
    elif kind == 'yacht':
        cabin(mb, -L * 0.28, L * 0.18, B * 0.82, B * 0.55, z, 2.1, col, 1.0, 1.4)
        # flybridge with a hardtop on struts
        cabin(mb, -L * 0.22, L * 0.02, B * 0.66, B * 0.5, z + 2.1, 0.9, col, 0.0001, 0.3)
        for sx in (-1, 1):
            for sy in (-0.2, 0.0):
                mb.cyl((sx * B * 0.28, L * sy, z + 3.0), 0.04, 0.04, 1.9, 6, 'od_chrome', WHITE)
        mb.box(-B * 0.33, -L * 0.24, z + 4.9, B * 0.33, L * 0.02, z + 5.0, 'od_hull', col)
    elif kind == 'cruiser':
        cabin(mb, -L * 0.18, L * 0.22, B * 0.78, B * 0.45, z, 1.0, col, 0.55, 1.2)
        # an arch over the cockpit
        for sx in (-1, 1):
            mb.cyl((sx * B * 0.36, -L * 0.22, z), 0.05, 0.05, 1.9, 6, 'od_hull', col)
        mb.box(-B * 0.38, -L * 0.26, z + 1.85, B * 0.38, -L * 0.17, z + 2.0, 'od_hull', col)
    elif kind == 'console':
        mb.box(-0.5, -0.4, z, 0.5, 0.6, z + 1.0, 'od_hull', col)
        mb.face([(-0.5, 0.6, z + 1.0), (0.5, 0.6, z + 1.0), (0.45, 0.8, z + 1.5), (-0.45, 0.8, z + 1.5)], 'od_boatglass', WHITE)
        for sx in (-1, 1):
            mb.cyl((sx * 0.6, -0.6, z), 0.03, 0.03, 2.1, 6, 'od_chrome', WHITE)
        mb.box(-0.75, -1.4, z + 2.05, 0.75, 0.4, z + 2.12, 'od_canvas', hexcol('#1d3d5e'))
        # outboards on the transom
        for sx in (-0.35, 0.35):
            mb.box(sx - 0.22, -L / 2 - 0.6, z - 0.8, sx + 0.22, -L / 2 - 0.1, z + 0.5, 'od_hull', hexcol('#e8e8e8'))
    elif kind == 'sail':
        cabin(mb, -L * 0.12, L * 0.18, B * 0.62, B * 0.4, z, 0.7, col, 0.3, 0.4)
        mb.cyl((0, L * 0.1, z), 0.09, 0.06, L * 1.35, 8, 'od_chrome', WHITE)
        mb.cyl((0, L * 0.1, z + 1.3), 0.06, 0.06, L * 0.42, 6, 'od_chrome', WHITE, axis=(0, -1, 0))
        mb.cyl((0, L * 0.1 - L * 0.21, z + 1.45), 0.18, 0.16, L * 0.4, 8, 'od_canvas', hexcol('#1f4f8a'), axis=(0, 1, 0))
    # bow rail along the deck edge, forward half
    top = [r[-1] for r in rings]
    fwd = [p for p in top if p[1] > 0]
    if len(fwd) > 2 and kind != 'super':
        rail(mb, [(p[0] * 0.95, p[1], p[2]) for p in fwd], 0.7)
        rail(mb, [(-p[0] * 0.95, p[1], p[2]) for p in fwd], 0.7)
    return mb.build(smooth=True, weld=True)


obs = []
for name, L, B in (('yacht', 18.0, 5.2), ('cruiser', 12.5, 4.0), ('console', 8.5, 2.8), ('sail', 11.5, 3.6), ('super', 34.0, 8.0)):
    o = build(name, L, B, name)
    # flat-shade the boxy parts: smooth normals only make sense on the hull (weld keeps it simple)
    obs.append(o)

# docks: a deck of planks on piles along every pier line
D = json.load(open(os.path.join(WORK, 'marina.json')))
mb = MB('docks')
for ln in D['docks']:
    for i in range(len(ln) - 1):
        a, b = Vector((*ln[i], 0)), Vector((*ln[i + 1], 0))
        L = (b - a).length
        if L < 0.1:
            continue
        u = (b - a) / L
        n = Vector((-u.y, u.x, 0))
        c = (a + b) / 2
        mb.obox(c + Vector((0, 0, -0.95)), u, n, (0, 0, 1), L / 2, 1.25, 0.12, 'od_wood', WHITE)
        k = 0.0
        while k <= L:
            p = a + u * k
            for s in (-1, 1):
                q = p + n * s * 1.35
                mb.cyl((q.x, q.y, -3.5), 0.16, 0.16, 3.4, 8, 'od_wood', hexcol('#6b5a48'))
            k += 4.0
obs.append(mb.build())
for o in bpy.data.objects:
    o.select_set(False)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'boats.glb'), export_format='GLB', export_apply=True, export_texcoords=True, export_normals=True,
                          export_vertex_color='ACTIVE', export_materials='EXPORT', export_lights=False, export_cameras=False)
print('glb', os.path.getsize(os.path.join(OUT, 'boats.glb')) / 1e6)
