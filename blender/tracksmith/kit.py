# Tracksmith's track kit. Every road piece is modelled along the centre line the game's collision
# mesh is swept on (tools/tsexport.mjs -> data.json), so what you see is what you drive on: a bevelled
# deck with raised kerbs, painted lines, a chamfered side and a ribbed underside; then the gates,
# pylons, plates and blocks. Ambient occlusion is baked into the vertex colours with Cycles; the
# materials are only names ('road', 'edge', ...), and the game paints them from the theme.
#   blender -b --python blender/tracksmith/kit.py
import sys
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from common import *

sc = reset()
SLAB = DATA['SLAB']
SLOTS = ['road', 'line', 'edge', 'edgeAlt', 'side', 'under', 'boost', 'block', 'blockSide', 'steel', 'dark', 'light', 'banner', 'accent']
MATS = {}
for i, n in enumerate(SLOTS):
    m = bpy.data.materials.new(n)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.7, 0.7, 0.7, 1)
    MATS[n] = m


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


class Mesh:
    """quads with a material each, in game coordinates"""

    def __init__(self):
        self.v, self.f, self.m = [], [], []

    def quad(self, a, b, c, d, mat, out=None, inside=None):
        """wound so its face looks along `out`, or away from the point `inside`"""
        n = cross((b[0] - a[0], b[1] - a[1], b[2] - a[2]), (c[0] - a[0], c[1] - a[1], c[2] - a[2]))
        if inside is not None:
            g = ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2)
            out = (g[0] - inside[0], g[1] - inside[1], g[2] - inside[2])
        i = len(self.v)
        self.v += [a, b, c, d]
        flip = out is not None and n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0
        self.f.append((i + 3, i + 2, i + 1, i) if flip else (i, i + 1, i + 2, i + 3))
        self.m.append(SLOTS.index(mat))

    def box(self, x0, y0, z0, x1, y1, z1, mat, bev=0.0, top=None, xf=None):
        """a box; with `bev`, its top edges are chamfered"""
        t = lambda p: xf(p) if xf else p
        b = min(bev, (x1 - x0) / 3, (z1 - z0) / 3, (y1 - y0) / 3)
        P = lambda x, y, z: t((x, y, z))
        tm = top or mat
        yb = y1 - b
        C = P((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        self.quad(P(x0 + b, y1, z0 + b), P(x0 + b, y1, z1 - b), P(x1 - b, y1, z1 - b), P(x1 - b, y1, z0 + b), tm, inside=C)
        self.quad(P(x0, y0, z1), P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), mat, inside=C)
        for (ax, az, bx, bz, cx, cz, dx, dz) in (
            (x0, z0, x1, z0, x1 - b, z0 + b, x0 + b, z0 + b),
            (x1, z0, x1, z1, x1 - b, z1 - b, x1 - b, z0 + b),
            (x1, z1, x0, z1, x0 + b, z1 - b, x1 - b, z1 - b),
            (x0, z1, x0, z0, x0 + b, z0 + b, x0 + b, z1 - b),
        ):
            self.quad(P(ax, y0, az), P(ax, yb, az), P(bx, yb, bz), P(bx, y0, bz), mat, inside=C)
            if b > 0:
                self.quad(P(ax, yb, az), P(dx, y1, dz), P(cx, y1, cz), P(bx, yb, bz), mat, inside=C)

    def cyl(self, x, y0, y1, z, r0, r1, n, mat):
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            self.quad((x + math.cos(a0) * r0, y0, z + math.sin(a0) * r0), (x + math.cos(a0) * r1, y1, z + math.sin(a0) * r1),
                      (x + math.cos(a1) * r1, y1, z + math.sin(a1) * r1), (x + math.cos(a1) * r0, y0, z + math.sin(a1) * r0), mat, out=(math.cos((a0 + a1) / 2), 0, math.sin((a0 + a1) / 2)))

    def obj(self, name):
        me = bpy.data.meshes.new(name)
        me.from_pydata([G(*p) for p in self.v], [], self.f)
        for n in SLOTS:
            me.materials.append(MATS[n])
        for p, mi in zip(me.polygons, self.m):
            p.material_index = mi
        for p in me.polygons:
            p.use_smooth = False
        o = bpy.data.objects.new(name, me)
        sc.collection.objects.link(o)
        return o


def v_add(a, b, s=1.0):
    return (a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s)


def road(M, frames, width, feature):
    """the deck swept along the frames. x across, y up, in each frame's own axes"""
    hw = width / 2
    K = 0.72        # kerb width
    KH = 0.045      # how far it stands proud of the road (under the wheel's notice)
    LINE = 0.16     # painted edge line
    n = len(frames)
    # the columns of the top surface: (x, y, material or None for kerb)
    tops = [(-hw, KH * 0.3), (-hw + 0.1, KH), (-hw + K - 0.1, KH), (-hw + K, 0), (-hw + K + 0.28, 0), (-hw + K + 0.28 + LINE, 0), (-0.13, 0), (0.13, 0),
            (hw - K - 0.28 - LINE, 0), (hw - K - 0.28, 0), (hw - K, 0), (hw - K + 0.1, KH), (hw - 0.1, KH), (hw, KH * 0.3)]
    dist = 0.0
    total = 0.0
    for i in range(n - 1):
        total += math.dist(frames[i]['p'], frames[i + 1]['p'])
    for i in range(n - 1):
        A, B = frames[i], frames[i + 1]
        seg = math.dist(A['p'], B['p'])
        ra, rb = cross(A['f'], A['u']), cross(B['f'], B['u'])
        P = lambda F, r, x, y: v_add(v_add(F['p'], r, x), F['u'], y)
        at = dist + seg / 2
        kerb = 'edge' if int(at / 2.5) % 2 == 0 else 'edgeAlt'
        mid = at / max(total, 1e-3)
        for c in range(len(tops) - 1):
            (x0, y0), (x1, y1) = tops[c], tops[c + 1]
            mat = 'road'
            if c <= 2 or c >= len(tops) - 4:
                mat = kerb
            elif c == 4 or c == 8:
                mat = 'line'
            elif c == 6 and at % 5 < 2.5:
                mat = 'line'
            if feature == 'boost' and 4 < c < 8 and 0.1 < mid < 0.9:
                mat = 'boost'
            M.quad(P(A, ra, x0, y0), P(A, ra, x1, y1), P(B, rb, x1, y1), P(B, rb, x0, y0), mat, out=A['u'])
        for s in (1, -1):
            e, w = s * hw, s * (hw + 0.14)
            prof = [(e, KH * 0.3), (w, -0.14), (w, -SLAB + 0.16), (e, -SLAB)]
            for (x0, y0), (x1, y1) in zip(prof, prof[1:]):
                M.quad(P(A, ra, x0, y0), P(A, ra, x1, y1), P(B, rb, x1, y1), P(B, rb, x0, y0), 'side', out=(ra[0] * s, ra[1] * s, ra[2] * s))
        down = (-A['u'][0], -A['u'][1], -A['u'][2])
        M.quad(P(A, ra, hw, -SLAB), P(A, ra, -hw, -SLAB), P(B, rb, -hw, -SLAB), P(B, rb, hw, -SLAB), 'under', out=down)
        # a rib across the underside every 5 m
        if int(dist / 5) != int((dist + seg) / 5):
            d = -SLAB - 0.22
            back = (-A['f'][0], -A['f'][1], -A['f'][2])
            M.quad(P(A, ra, hw - 0.3, -SLAB), P(A, ra, hw - 0.3, d), P(A, ra, -hw + 0.3, d), P(A, ra, -hw + 0.3, -SLAB), 'dark', out=back)
            M.quad(P(B, rb, -hw + 0.3, -SLAB), P(B, rb, -hw + 0.3, d), P(B, rb, hw - 0.3, d), P(B, rb, hw - 0.3, -SLAB), 'dark', out=B['f'])
            M.quad(P(A, ra, hw - 0.3, d), P(B, rb, hw - 0.3, d), P(B, rb, -hw + 0.3, d), P(A, ra, -hw + 0.3, d), 'dark', out=down)
        dist += seg


def wedge(M, frames, width):
    """a kicker is solid: walls from the lifted deck down to the base"""
    hw = width / 2
    base = -SLAB
    for A, B in zip(frames, frames[1:]):
        if A['p'][1] < 0.02 and B['p'][1] < 0.02:
            continue
        ra, rb = cross(A['f'], A['u']), cross(B['f'], B['u'])
        for s in (1, -1):
            a = v_add(v_add(A['p'], ra, s * (hw + 0.14)), A['u'], -SLAB + 0.16)
            b = v_add(v_add(B['p'], rb, s * (hw + 0.14)), B['u'], -SLAB + 0.16)
            M.quad(a, b, (b[0], base, b[2]), (a[0], base, a[2]), 'side', out=(ra[0] * s, ra[1] * s, ra[2] * s))
    L = frames[-1]
    r = cross(L['f'], L['u'])
    t1 = v_add(v_add(L['p'], r, hw + 0.14), L['u'], -0.14)
    t2 = v_add(v_add(L['p'], r, -hw - 0.14), L['u'], -0.14)
    M.quad(t1, t2, (t2[0], base, t2[2]), (t1[0], base, t1[2]), 'dark', out=L['f'])
    # chevrons down the lip so you can read it at speed
    for k in range(3):
        F = frames[int(len(frames) * (0.45 + 0.17 * k))]
        rr = cross(F['f'], F['u'])
        for s in (1, -1):
            a = v_add(v_add(F['p'], rr, s * 0.3), F['u'], 0.012)
            b = v_add(v_add(F['p'], rr, s * 3.2), F['u'], 0.012)
            a2 = v_add(a, F['f'], 0.8)
            b2 = v_add(b, F['f'], -0.5 + 0.8)
            c = v_add(b, F['f'], -1.3)
            d = v_add(a, F['f'], 0.0)
            M.quad(d, a2, b, c, 'accent', out=F['u'])


def gate(M, kind):
    """an arch over the road: tapered posts on feet, a beam with a banner, lamps along it"""
    span = 10.6 / 2
    H = 6.3
    post = 'dark' if kind != 'check' else 'steel'
    for s in (1, -1):
        x = s * span
        M.box(x - 0.75, 0, -0.75, x + 0.75, 0.42, 0.75, post, bev=0.12)
        for y0, y1, r0, r1 in ((0.42, 0.9, 0.5, 0.42), (0.9, H - 0.2, 0.42, 0.3)):
            n = 8
            M.cyl(x, y0, y1, 0, r0, r1, n, post)
        # the lamp column on the inner face
        M.box(x - s * 0.34 - 0.07, 0.9, -0.2, x - s * 0.34 + 0.07, H - 1.1, 0.2, 'light')
    M.box(-span - 0.5, H - 1.0, -0.42, span + 0.5, H + 0.42, 0.42, post, bev=0.1)
    M.box(-span - 0.3, H - 0.82, -0.47, span + 0.3, H + 0.24, 0.47, 'banner', bev=0.03)
    M.box(-span + 0.1, H - 1.2, -0.12, span - 0.1, H - 1.02, 0.12, 'light')
    if kind != 'check':
        # the big one has a fin at each end
        for s in (1, -1):
            x = s * (span + 0.5)
            M.box(x - 0.28, H + 0.42, -0.3, x + 0.28, H + 1.5, 0.3, 'accent', bev=0.1)


def pylon(M):
    """a unit-tall column (scaled in the game) and its cap"""
    n = 8
    M.cyl(0, 0, 1, 0, 0.62, 0.62, n, 'steel')


def cap(M):
    M.cyl(0, -0.34, 0, 0, 0.62, 1.05, 8, 'steel')
    M.box(-1.15, 0, -1.15, 1.15, 0.12, 1.15, 'dark', bev=0.03)


objs = []
for d in DATA['pieces']:
    M = Mesh()
    if d['box']:
        x0, y0, z0, x1, y1, z1 = d['box']
        tall = d['feature'] == 'block'
        M.box(x0, y0, z0, x1, y1, z1, 'blockSide', bev=0.14, top='block' if tall else 'road')
        if tall:
            # a panel line round the side
            for y in (y0 + 0.5, y1 - 0.6):
                for (a, b, c, e) in ((x0, z0, x1, z0), (x1, z1, x0, z1)):
                    zz = b - (0.01 if b == z0 else -0.01)
                    M.quad((a, y, zz), (c, y, zz), (c, y + 0.08, zz), (a, y + 0.08, zz), 'dark', out=(0, 0, -1 if b == z0 else 1))
    else:
        road(M, d['frames'], d['width'], d['feature'])
        if d['feature'] == 'ramp':
            wedge(M, d['frames'], d['width'])
    objs.append(M.obj('p_' + d['id']))
for kind in ('start', 'check', 'finish'):
    M = Mesh()
    gate(M, kind)
    objs.append(M.obj('gate_' + kind))
M = Mesh()
pylon(M)
objs.append(M.obj('pylon'))
M = Mesh()
cap(M)
objs.append(M.obj('cap'))

# ---- occlusion into the vertices (each piece on its own: it has to tile with any neighbour)
sc.cycles.samples = 16
w = bpy.data.worlds.new('w')
sc.world = w
w.use_nodes = True
bg = w.node_tree.nodes.get('Background')
bg.inputs[0].default_value = (1, 1, 1, 1)
bg.inputs[1].default_value = 1.0
w.light_settings.distance = 1.6
for o in objs:
    # (they all stand at the origin: each one baked alone, or they shade each other black)
    for q in objs:
        q.hide_render = q is not o
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for _ in range(4):
        long = [e for e in bm.edges if e.calc_length() > 1.7]
        if not long:
            break
        bmesh.ops.subdivide_edges(bm, edges=long, cuts=1, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(o.data)
    bm.free()
    ca = o.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    o.data.color_attributes.active_color = ca
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    # (the bake replaces the attribute's storage: the old reference reads zeros)
    for c in o.data.color_attributes['Col'].data:
        a = 0.42 + 0.58 * c.color[0]
        c.color = (a, a, a, 1)
    print('baked', o.name, len(o.data.polygons))

for q in objs:
    q.hide_render = False
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=KIT, use_selection=True, export_format='GLB', export_animations=False, export_vertex_color='ACTIVE',
                          export_all_vertex_colors=False, export_materials='EXPORT', export_yup=True, export_apply=False, export_texcoords=False,
                          export_extras=False, export_draco_mesh_compression_enable=False)
print('wrote', KIT, os.path.getsize(KIT))
