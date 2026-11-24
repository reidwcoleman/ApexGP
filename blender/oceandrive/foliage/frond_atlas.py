"""The palm leaf atlas, modelled and rendered in Blender: blender -b --factory-startup -P foliage/frond_atlas.py

Every leaf is real geometry, rendered straight down (orthographic) into an RGBA albedo atlas and a
tangent-space normal atlas (public/oceandrive/tex/palm_atlas.webp, palm_atlas_n.webp, 2560 x 1024):

  columns 0-3: coconut fronds 4.5 m long on a 2.3 x 4.6 m card, base at the bottom
     0 healthy, glossy green      1 healthy, sun-yellowed, a few torn leaflets
     2 ageing: yellowing, browned tips, gaps      3 dead: grey-brown, curled, ragged
  column 4: palmate fans (Washingtonia / Sabal): top half green, bottom half the dead, hanging skirt
  column 5: canopy clumps: top half sea grape (round leathery leaves), bottom half small-leaved shade tree

Each coconut leaflet is a long lanceolate blade folded along its midrib (so the normal map carries the
fold), set at 70 -> 50 degrees to the rachis from base to tip, ~105 a side, longest a third of the way
up; they bunch where the wind has split them, some are torn short or missing. Fans have ~60 pleated
segments radiating from the hastula, split into drooping threads at their tips."""
import bpy, bmesh, math, os, random, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', '..', 'public', 'oceandrive', 'tex')
TMP = os.path.join(HERE, '..', 'work')
CW, CH = 2.3, 4.6          # one coconut card (m)
NCOL = 6
bpy.ops.wm.read_factory_settings(use_empty=True)


def lin(c):
    return tuple((x / 255) ** 2.2 for x in c)


class Mesh:
    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new('Col')

    def quad(self, pts, c):
        vs = [self.bm.verts.new(p) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return
        for l in f.loops:
            l[self.col] = (*c, 1.0)

    def obj(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def leaflet(M, root, d, L, w, fold, c, rng, curl=0.0, ragged=False):
    """a folded blade from root along d (unit, in the card plane), length L, max width w"""
    d = Vector((d.x, d.y, 0)).normalized()
    side = Vector((-d.y, d.x, 0))
    up = Vector((0, 0, 1))
    N = 10
    # a gentle arc: the blade bends back toward the frond's tip
    bend = Vector((0, 1, 0)) * rng.uniform(0.05, 0.16) * L
    prev = None
    tipc = c
    for i in range(N + 1):
        s = i / N
        p = root + d * (L * s) + bend * (s * s)
        wd = w * (math.sin(math.pi * min(1.0, s * 1.6 + 0.05)) ** 0.55) * (1 - s) ** 0.35
        if ragged and s > 0.7:
            wd *= rng.uniform(0.3, 1.0)
        wd *= (1 - curl * s)
        h = wd * 0.5 * math.tan(fold)
        e1 = p + side * wd * 0.5
        e2 = p - side * wd * 0.5
        mid = p + up * h
        cur = (e1, mid, e2)
        if prev:
            k = (i - 0.5) / N
            cc = tuple(c[j] * (0.9 + 0.2 * k) for j in range(3))
            if k > 0.86 and rng.random() < 0.5:
                cc = tipc
            M.quad([prev[0], prev[1], cur[1], cur[0]], cc)
            M.quad([prev[1], prev[2], cur[2], cur[1]], tuple(x * 0.93 for x in cc))
        prev = cur


def coconut(M, cx, kind, rng):
    """kind 0 healthy, 1 sun-yellowed, 2 ageing, 3 dead"""
    L = 4.5
    base = Vector((cx, 0.06, 0))
    # rachis: tapered, keeled, yellow-green
    rc = {0: (150, 156, 70), 1: (168, 160, 74), 2: (176, 150, 76), 3: (142, 118, 88)}[kind]
    for i in range(40):
        s0, s1 = i / 40, (i + 1) / 40
        w0, w1 = 0.075 * (1 - s0) ** 0.8 + 0.008, 0.075 * (1 - s1) ** 0.8 + 0.008
        y0, y1 = base.y + L * s0, base.y + L * s1
        M.quad([(cx - w0, y0, 0.01), (cx + w0, y0, 0.01), (cx + w1, y1, 0.01), (cx - w1, y1, 0.01)], lin(tuple(int(v * (1 - 0.2 * s0)) for v in rc)))
    n = 105
    miss = {0: 0.02, 1: 0.05, 2: 0.13, 3: 0.3}[kind]
    for side in (-1, 1):
        # the wind splits the frond: leaflets bunch into groups with gaps
        clump_ph = rng.uniform(0, 6.28)
        for i in range(n):
            t = 0.1 + 0.89 * (i + rng.uniform(0, 0.6)) / n
            t += 0.006 * math.sin(i * 0.9 + clump_ph)
            if rng.random() < miss:
                continue
            p = (t - 0.08) / 0.92
            prof = (1 - (1 - min(1, p / 0.3)) ** 2) * (1 - 0.68 * max(0, (p - 0.3) / 0.7) ** 1.4)
            Lf = 1.2 * max(0.12, prof) * rng.uniform(0.9, 1.06)
            if rng.random() < {0: 0.03, 1: 0.07, 2: 0.15, 3: 0.3}[kind]:
                Lf *= rng.uniform(0.35, 0.75)          # torn
            th = math.radians(80 - 30 * t + rng.uniform(-6, 6))
            d = Vector((side * math.sin(th), math.cos(th), 0))
            root = Vector((cx + side * (0.06 * (1 - t) + 0.01), base.y + L * t, 0.012))
            g = rng.uniform(0.82, 1.12)
            if kind == 0:
                c = (78 * g, 108 * g, 36 * g)
                c = tuple(c[j] + rng.uniform(-6, 6) for j in range(3))
            elif kind == 1:
                y = rng.uniform(0.15, 0.45)
                c = ((84 + 60 * y) * g, (110 + 22 * y) * g, (36 + 4 * y) * g)
            elif kind == 2:
                y = rng.uniform(0.35, 0.85)
                c = ((92 + 80 * y) * g, (108 + 20 * y) * g, (38 + 10 * y) * g)
            else:
                c = (rng.uniform(118, 150) * g, rng.uniform(98, 120) * g, rng.uniform(74, 90) * g)
            tipc = lin((150 * g, 118 * g, 70 * g)) if kind else lin((112 * g, 112 * g, 48 * g))
            cl = lin(tuple(max(0, min(255, v)) for v in c))
            w = 0.048 * (1.15 - 0.4 * t) * (0.7 if kind == 3 else 1)
            leaflet(M, root, d, Lf, w, math.radians(rng.uniform(18, 32)), cl, rng,
                    curl=0.5 if kind == 3 else 0.0, ragged=kind >= 2)
            if kind >= 1 and rng.random() < 0.35:
                pass


def fan(M, cx, cy, R, dry, rng):
    """a palmate fan from above: pleated segments radiating over ~260 degrees, split at the tips"""
    nseg = 62
    a0 = math.radians(-40)
    span = math.radians(260)
    hast = Vector((cx, cy, 0.02))
    for k in range(nseg):
        a = a0 + span * (k + 0.5) / nseg + rng.uniform(-0.01, 0.01)
        d = Vector((math.cos(a), math.sin(a), 0))
        Ls = R * rng.uniform(0.88, 1.0)
        g = rng.uniform(0.85, 1.1)
        if dry:
            c = lin((rng.uniform(128, 160) * g, rng.uniform(108, 128) * g, rng.uniform(78, 94) * g))
        else:
            c = lin((60 * g, 90 * g, 50 * g))
        # the segment: a long wedge, pleated (alternate segments fold up / down)
        wmax = 2 * R * math.sin(span / nseg / 2) * 1.02
        side = Vector((-d.y, d.x, 0))
        N = 8
        prev = None
        split = rng.uniform(0.6, 0.75)
        for i in range(N + 1):
            s = i / N
            p = hast + d * (Ls * (0.08 + 0.92 * s))
            wd = wmax * (0.08 + 0.92 * s)
            if s > split:
                wd *= 0.6 * (1 - (s - split) / (1 - split)) + 0.05   # split, tapering to points
            fold = (1 if k % 2 else -1) * wd * 0.35
            e1, e2 = p + side * wd * 0.5, p - side * wd * 0.5
            mid = p + Vector((0, 0, fold))
            cur = (e1, mid, e2)
            if prev:
                M.quad([prev[0], prev[1], cur[1], cur[0]], c)
                M.quad([prev[1], prev[2], cur[2], cur[1]], tuple(x * 0.9 for x in c))
            prev = cur
        # the threads beyond the split
        for th in (-1, 1):
            q = hast + d * (Ls * (0.08 + 0.92 * split)) + side * th * wmax * 0.2
            leaflet(M, q, d + side * th * 0.08, Ls * (1 - split) * rng.uniform(0.9, 1.5), wmax * 0.25, 0.2, c, rng)


def leafcluster(M, cx, cy, kind, rng):
    """a clump of leaves seen from above, filling a disc of ~1 m radius (the card's canopy texture).
    kind 'grape': ~70 round, leathery sea grape leaves with pale veins, a few turning red;
    kind 'oak': ~700 small elliptic leaves on twigs (live oak / mahogany)"""
    up = Vector((0, 0, 1))
    n = 150 if kind == 'grape' else 1700
    for k in range(n):
        a = rng.uniform(0, 6.283)
        r = (rng.random() ** 0.7) * 0.98
        cxy = Vector((cx + math.cos(a) * r, cy + math.sin(a) * r, rng.uniform(0, 0.3)))
        if kind == 'grape':
            R = rng.uniform(0.08, 0.13)
            g = rng.uniform(0.75, 1.1)
            red = rng.random() < 0.05
            c = lin(((140 if red else 58) * g, (60 if red else 96) * g, (40 if red else 40) * g))
            seg = 14
        else:
            R = rng.uniform(0.035, 0.06)
            g = rng.uniform(0.7, 1.15)
            c = lin((52 * g, 82 * g, 30 * g)) if rng.random() > 0.08 else lin((110 * g, 104 * g, 44 * g))
            seg = 6
        rot = rng.uniform(0, 6.283)
        tilt = Vector((rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), 1)).normalized()
        ax = tilt.orthogonal().normalized()
        ay = tilt.cross(ax)
        el = 1.0 if kind == 'grape' else 0.5
        ring = []
        for i in range(seg):
            th = 2 * math.pi * i / seg + rot
            rr = R * (1 - 0.1 * math.cos(2 * th)) if kind == 'grape' else R
            ring.append(cxy + ax * math.cos(th) * rr + ay * math.sin(th) * rr * el + tilt * (0.15 * R * math.cos(th) ** 2))
        # a fan of triangles: centre slightly raised (the leaf's cup), a lighter midrib side
        ctr = cxy + tilt * R * 0.12
        for i in range(seg):
            a_, b_ = ring[i], ring[(i + 1) % seg]
            cc = c if i < seg // 2 else tuple(x * 1.12 for x in c)
            M.quad([ctr, a_, b_, ctr + (b_ - ctr) * 0.001], cc)
    # twigs showing through
    for k in range(18 if kind == 'oak' else 8):
        a = rng.uniform(0, 6.283)
        r0, r1 = rng.uniform(0, 0.2), rng.uniform(0.5, 0.95)
        p0 = Vector((cx + math.cos(a) * r0, cy + math.sin(a) * r0, -0.05))
        p1 = Vector((cx + math.cos(a) * r1, cy + math.sin(a) * r1, -0.05))
        sd = Vector((-math.sin(a), math.cos(a), 0)) * 0.012
        M.quad([p0 - sd, p0 + sd, p1 + sd * 0.4, p1 - sd * 0.4], lin((92, 80, 66)))


def material(mode):
    mt = bpy.data.materials.new('atlas_' + mode)
    mt.use_nodes = True
    nt = mt.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    if mode == 'albedo':
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        nt.links.new(vc.outputs['Color'], em.inputs['Color'])
    else:
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        # tangent space of a card lying in the xy plane: x -> u, y -> v, z -> n
        mul = nt.nodes.new('ShaderNodeVectorMath'); mul.operation = 'MULTIPLY_ADD'
        mul.inputs[1].default_value = (0.5, 0.5, 0.5)
        mul.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(geo.outputs['Normal'], mul.inputs[0])
        nt.links.new(mul.outputs['Vector'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return mt


rng = random.Random(2026)
M = Mesh()
for k in range(4):
    coconut(M, k * CW + CW / 2, k, random.Random(100 + k))
fan(M, 4 * CW + CW / 2, CH * 0.75, 1.1, False, random.Random(7))
fan(M, 4 * CW + CW / 2, CH * 0.25, 1.1, True, random.Random(8))
leafcluster(M, 5 * CW + CW / 2, CH * 0.75, 'grape', random.Random(9))
leafcluster(M, 5 * CW + CW / 2, CH * 0.25, 'oak', random.Random(10))
ob = M.obj('atlas')
# every face facing up (the camera looks down -z)
for p in ob.data.polygons:
    if p.normal.z < 0:
        p.flip()
ob.data.update()

sc = bpy.context.scene
cam = bpy.data.cameras.new('cam')
cam.type = 'ORTHO'
cam.ortho_scale = NCOL * CW
co = bpy.data.objects.new('cam', cam)
co.location = (NCOL * CW / 2, CH / 2, 10)
sc.collection.objects.link(co)
sc.camera = co
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 512 * NCOL * 2, 1024 * 2
sc.render.film_transparent = True
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.render.filter_size = 1.0
try:
    sc.eevee.taa_render_samples = 16
except Exception:
    pass
for mode in ('albedo', 'normal'):
    ob.data.materials.clear()
    ob.data.materials.append(material(mode))
    sc.view_settings.view_transform = 'Standard' if mode == 'albedo' else 'Raw'
    sc.render.filepath = os.path.join(TMP, f'atlas_{mode}.png')
    bpy.ops.render.render(write_still=True)
    print('rendered', mode, flush=True)
