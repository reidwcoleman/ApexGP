"""Small mesh-building kit for the Ocean Drive build (runs inside Blender).

MB collects faces with a material name and an sRGB colour per face; UV0 is world-space metres,
projected per face along its dominant axis (the runtime scales it per material), so every surface
tiles its scanned texture at true size with no stretching."""
import bpy, bmesh, math
from mathutils import Vector


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h, a=1.0):
    h = h.lstrip('#')
    return (srgb_to_lin(int(h[0:2], 16) / 255), srgb_to_lin(int(h[2:4], 16) / 255), srgb_to_lin(int(h[4:6], 16) / 255), a)


WHITE = (1.0, 1.0, 1.0, 1.0)


class MB:
    def __init__(self, name):
        self.name = name
        self.verts = []
        self.faces = []      # (vertex indices, material, colour, uv override or None)

    def face(self, pts, mat, col=WHITE, uvs=None, n=None):
        if n is not None:
            # orient so the face looks along n (Newell normal)
            nx = ny = nz = 0.0
            for i in range(len(pts)):
                a, b = pts[i], pts[(i + 1) % len(pts)]
                nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1])
            if nx * n[0] + ny * n[1] + nz * n[2] < 0:
                pts = list(pts)[::-1]
                if uvs is not None: uvs = list(uvs)[::-1]
        base = len(self.verts)
        self.verts.extend(Vector(p) for p in pts)
        self.faces.append((list(range(base, base + len(pts))), mat, col, uvs))

    def quad(self, a, b, c, d, mat, col=WHITE, uvs=None):
        self.face([a, b, c, d], mat, col, uvs)

    def box(self, x0, y0, z0, x1, y1, z1, mat, col=WHITE, skip=()):
        """axis-aligned box; skip: faces to leave out ('-x','+x','-y','+y','-z','+z')"""
        p = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        F = {'-z': (0, 3, 2, 1), '+z': (4, 5, 6, 7), '-y': (0, 1, 5, 4), '+y': (2, 3, 7, 6), '-x': (3, 0, 4, 7), '+x': (1, 2, 6, 5)}
        for k, idx in F.items():
            if k in skip:
                continue
            self.face([p[i] for i in idx], mat, col)

    def obox(self, c, ax, ay, az, hx, hy, hz, mat, col=WHITE, skip=()):
        """oriented box: centre c, unit axes ax/ay/az, half sizes"""
        c, ax, ay, az = Vector(c), Vector(ax), Vector(ay), Vector(az)
        def P(sx, sy, sz):
            return c + ax * (sx * hx) + ay * (sy * hy) + az * (sz * hz)
        p = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)]
        F = {'-z': (0, 3, 2, 1), '+z': (4, 5, 6, 7), '-y': (0, 1, 5, 4), '+y': (2, 3, 7, 6), '-x': (3, 0, 4, 7), '+x': (1, 2, 6, 5)}
        for k, idx in F.items():
            if k not in skip:
                self.face([p[i] for i in idx], mat, col)

    def cyl(self, c, r0, r1, h, n, mat, col=WHITE, caps=True, axis=(0, 0, 1)):
        c = Vector(c)
        az = Vector(axis).normalized()
        ax = az.orthogonal().normalized()
        ay = az.cross(ax)
        ring0 = [c + (ax * math.cos(2 * math.pi * i / n) + ay * math.sin(2 * math.pi * i / n)) * r0 for i in range(n)]
        ring1 = [c + az * h + (ax * math.cos(2 * math.pi * i / n) + ay * math.sin(2 * math.pi * i / n)) * r1 for i in range(n)]
        for i in range(n):
            j = (i + 1) % n
            self.quad(ring0[i], ring0[j], ring1[j], ring1[i], mat, col)
        if caps:
            self.face(ring1, mat, col)
            self.face(ring0[::-1], mat, col)

    def build(self, smooth=False, weld=True):
        me = bpy.data.meshes.new(self.name)
        mats = []
        for _, m, _, _ in self.faces:
            if m not in mats:
                mats.append(m)
        me.from_pydata([tuple(v) for v in self.verts], [], [f[0] for f in self.faces])
        for m in mats:
            me.materials.append(get_mat(m))
        mi = {m: i for i, m in enumerate(mats)}
        for poly, f in zip(me.polygons, self.faces):
            poly.material_index = mi[f[1]]
        col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        uv = me.uv_layers.new(name='UVMap')
        for poly, f in zip(me.polygons, self.faces):
            n = poly.normal
            ax = max(range(3), key=lambda k: abs(n[k]))
            for k, li in enumerate(poly.loop_indices):
                col.data[li].color = f[2]
                if f[3] is not None:
                    uv.data[li].uv = f[3][k]
                else:
                    v = me.vertices[me.loops[li].vertex_index].co
                    if ax == 2:
                        uv.data[li].uv = (v.x, v.y)
                    elif ax == 0:
                        uv.data[li].uv = (v.y * (1 if n.x > 0 else -1), v.z)
                    else:
                        uv.data[li].uv = (v.x * (-1 if n.y > 0 else 1), v.z)
        if weld:
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
            bm.to_mesh(me)
            bm.free()
        for p in me.polygons:
            p.use_smooth = smooth
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


# ------------------------------------------------------------------ materials
# Flat albedo for the bake (the runtime swaps every od_* material for its scanned-texture version)
MATS = {
    'od_stucco':   dict(col=(0.80, 0.78, 0.74), rough=0.85),
    'od_trim':     dict(col=(0.80, 0.78, 0.74), rough=0.7),
    'od_frame':    dict(col=(0.85, 0.85, 0.85), rough=0.4),
    'od_glass':    dict(col=(0.02, 0.025, 0.03), rough=0.05),
    'od_shopglass': dict(col=(0.05, 0.05, 0.05), rough=0.05),
    'od_terrazzo': dict(col=(0.70, 0.66, 0.60), rough=0.4),
    'od_sidewalk': dict(col=(0.55, 0.53, 0.50), rough=0.9),
    'od_curb':     dict(col=(0.60, 0.58, 0.55), rough=0.9),
    'od_asphalt':  dict(col=(0.10, 0.10, 0.10), rough=0.9),
    'od_paint':    dict(col=(0.85, 0.85, 0.82), rough=0.6),
    'od_paintyel': dict(col=(0.85, 0.65, 0.15), rough=0.6),
    'od_bikelane': dict(col=(0.15, 0.40, 0.22), rough=0.7),
    'od_grass':    dict(col=(0.17, 0.25, 0.08), rough=0.95),
    'od_sand':     dict(col=(0.80, 0.72, 0.58), rough=0.95),
    'od_coral':    dict(col=(0.62, 0.58, 0.50), rough=0.95),
    'od_wood':     dict(col=(0.45, 0.38, 0.30), rough=0.8),
    'od_metal':    dict(col=(0.20, 0.20, 0.20), rough=0.5),
    'od_awning':   dict(col=(0.60, 0.60, 0.60), rough=0.9),
    'od_fabric':   dict(col=(0.80, 0.80, 0.80), rough=0.9),
    'od_neon':     dict(col=(0.80, 0.80, 0.80), rough=0.3),
    'od_bark':     dict(col=(0.42, 0.38, 0.32), rough=0.9),
    'od_frond':    dict(col=(0.20, 0.28, 0.10), rough=0.7, alpha='palm_frond.png'),
    'od_frond_dry': dict(col=(0.45, 0.36, 0.22), rough=0.8, alpha='palm_frond_dry.png'),
    'od_roof':     dict(col=(0.55, 0.54, 0.52), rough=0.9),
    'od_rubber':   dict(col=(0.03, 0.03, 0.03), rough=0.8),
    'od_lamp':     dict(col=(0.9, 0.9, 0.85), rough=0.3),
    'od_signal':   dict(col=(0.05, 0.05, 0.05), rough=0.5),
    'od_interior': dict(col=(0.10, 0.09, 0.08), rough=0.8),
    'od_far':      dict(col=(0.75, 0.74, 0.71), rough=0.85),
    'od_water':    dict(col=(0.05, 0.15, 0.17), rough=0.05),
    'od_wetsand':  dict(col=(0.55, 0.48, 0.38), rough=0.4),
    # downtown
    'od_curtain':  dict(col=(0.16, 0.18, 0.20), rough=0.1),
    'od_ribbon':   dict(col=(0.55, 0.54, 0.52), rough=0.6),
    'od_garage':   dict(col=(0.45, 0.44, 0.42), rough=0.8),
    'od_crown':    dict(col=(0.75, 0.75, 0.75), rough=0.4),
    'od_rail':     dict(col=(0.10, 0.12, 0.12), rough=0.05),
    'od_skycondo': dict(col=(0.40, 0.42, 0.44), rough=0.3),
    'od_farground': dict(col=(0.40, 0.39, 0.37), rough=0.9),
    'od_bay':      dict(col=(0.05, 0.15, 0.17), rough=0.05),
}
GEN = None  # set by build.py: folder of generated textures


def get_mat(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    spec = MATS.get(name, dict(col=(0.7, 0.7, 0.7), rough=0.8))
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    c = spec['col']
    bsdf.inputs['Base Color'].default_value = (c[0], c[1], c[2], 1)
    bsdf.inputs['Roughness'].default_value = spec['rough']
    # vertex colour tint (per-building paint) multiplies the albedo
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    mix.inputs['A'].default_value = (c[0], c[1], c[2], 1)
    nt.links.new(attr.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    if 'alpha' in spec and GEN:
        img = bpy.data.images.load(GEN + '/' + spec['alpha'], check_existing=True)
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        uvn = nt.nodes.new('ShaderNodeUVMap')
        uvn.uv_map = 'UVMap'
        nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        nt.links.new(tex.outputs['Color'], mix.inputs['A'])
        try:
            m.surface_render_method = 'DITHERED'
        except Exception:
            pass
    return m


def text_mesh(name, body, font, size, extrude=0.0, bevel=0.0, outline=False, align='CENTER'):
    """text -> mesh object (letters in the XY plane, baseline at y=0, centred on x)"""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.font = font
    cu.size = size
    cu.align_x = align
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.bevel_resolution = 2
    if outline:
        cu.fill_mode = 'NONE'
    ob = bpy.data.objects.new(name + '_c', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    return me
