"""Model Palmera's street props in Blender (public/palmera/props.glb).

Run: blender -b --python tools/palmera/props.py -- <out.glb>

Benches, litter bins, hydrants, newspaper boxes, parking meters, street signs, bus shelters, street
lamps and traffic signals - each at the game's own size and facing (front toward the road, +z in
the game), built from bevelled parts so the light catches real rounded edges, vertex coloured, with
ambient occlusion baked into the colours over a ground plane. One object per prop, prop_<kind>.
Game space (x, y up, z toward the road) -> Blender (x, -z, y).
"""
import sys, math
import bpy, bmesh
from mathutils import Vector

OUT = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def hexc(h):
    """sRGB hex -> linear rgb (vertex colours are linear in glTF)"""
    c = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
    return tuple((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def G(x, y, z):
    return Vector((x, -z, y))


parts = []


def finish(o, col, bevel):
    me = o.data
    a = me.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
    c = hexc(col) if isinstance(col, int) else col
    for d in a.data:
        d.color = (*c, 1.0)
    if bevel > 0:
        m = o.modifiers.new('b', 'BEVEL')
        m.width = bevel
        m.segments = 1
        m.limit_method = 'ANGLE'
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='b')
    parts.append(o)
    return o


def box(s, p, col, bevel=0.006, rot=(0, 0, 0)):
    """s = (x, y, z) game size, p = game centre; rot = game Euler (x, y, z)"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=G(*p), rotation=(rot[0], rot[2], rot[1]))
    o = bpy.context.active_object
    o.scale = (s[0], s[2], s[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, col, min(bevel, min(s) * 0.4))


def cyl(r1, r2, h, p, col, seg=16, axis='y', bevel=0.004, caps=True):
    rot = {'y': (0, 0, 0), 'x': (0, math.pi / 2, 0), 'z': (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r1, radius2=r2, depth=h, location=G(*p), rotation=rot, end_fill_type='NGON' if caps else 'NOTHING')
    return finish(bpy.context.active_object, col, bevel)


def sphere(r, p, col, scale=(1, 1, 1), seg=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=G(*p))
    o = bpy.context.active_object
    o.scale = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    return finish(o, col, 0)


def torus(R, r, p, col, axis='y'):
    rot = {'y': (0, 0, 0), 'x': (0, math.pi / 2, 0), 'z': (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=16, minor_segments=5, location=G(*p), rotation=rot)
    bpy.ops.object.shade_smooth()
    return finish(bpy.context.active_object, col, 0)


def smooth_cyl(o):
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    o.select_set(False)
    return o


def seg(a, b, r, col, sides=10):
    """a tube from game point a to b"""
    A, B = G(*a), G(*b)
    d = B - A
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=r, depth=d.length, location=(A + B) / 2)
    o = bpy.context.active_object
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return smooth_cyl(finish(o, col, 0))


def build(name):
    global parts
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = 'prop_' + name
    parts = []
    return o


# ---- the props -------------------------------------------------------------------------
IRON, WOOD = 0x26292c, 0x8a5a34


def bench():
    woods = [0x8a5a34, 0x93613a, 0x80522f, 0x8e5c36]
    for i in range(4):
        box((1.8, 0.04, 0.09), (0, 0.45, -0.18 + i * 0.11), woods[i])
    for i in range(3):
        box((1.8, 0.09, 0.035), (0, 0.62 + i * 0.12, -0.27 - i * 0.02), woods[(i + 1) % 4], rot=(0.12, 0, 0))
    for x in (-0.75, 0.75):
        # cast-iron ends: a front leg, a back leg sweeping up into the back support, an arm rest
        box((0.05, 0.44, 0.05), (x, 0.22, 0.12), IRON)
        box((0.05, 0.05, 0.44), (x, 0.42, -0.06), IRON)
        seg((x, 0.0, -0.22), (x, 0.42, -0.26), 0.03, hexc(IRON))
        seg((x, 0.42, -0.26), (x, 0.95, -0.36), 0.026, hexc(IRON))
        seg((x, 0.62, -0.24), (x, 0.66, 0.12), 0.022, hexc(IRON))
        box((0.09, 0.02, 0.09), (x, 0.01, 0.12), IRON)
        box((0.09, 0.02, 0.09), (x, 0.01, -0.22), IRON)


def bin_():
    G_ = 0x2f5a3c
    n = 12
    for i in range(n):
        a = i / n * math.tau
        box((0.1, 0.78, 0.02), (math.sin(a) * 0.255, 0.45, math.cos(a) * 0.255), G_, rot=(0, a, 0), bevel=0)
    for y in (0.08, 0.84):
        torus(0.262, 0.018, (0, y, 0), hexc(0x234431))
    cyl(0.24, 0.24, 0.7, (0, 0.43, 0), 0x151617, seg=18)  # the liner
    cyl(0.3, 0.2, 0.1, (0, 0.9, 0), 0x234431, seg=20)
    cyl(0.2, 0.2, 0.02, (0, 0.95, 0), 0x0c0d0d, seg=20)
    cyl(0.29, 0.29, 0.05, (0, 0.025, 0), 0x1c1d1e, seg=20)


def hydrant():
    Y = 0xd8b21c
    cyl(0.18, 0.18, 0.05, (0, 0.025, 0), 0xb0920e, seg=8)
    for i in range(4):
        a = i / 4 * math.tau + 0.4
        cyl(0.012, 0.012, 0.03, (math.sin(a) * 0.15, 0.06, math.cos(a) * 0.15), 0x7a6a20, seg=6)
    smooth_cyl(cyl(0.12, 0.13, 0.5, (0, 0.3, 0), Y, seg=20))
    torus(0.125, 0.018, (0, 0.53, 0), hexc(0xc49e10))
    sphere(0.14, (0, 0.6, 0), hexc(Y), scale=(1, 0.75, 1))
    cyl(0.04, 0.045, 0.07, (0, 0.73, 0), 0xb39012, seg=5)
    for sx in (-1, 1):
        smooth_cyl(cyl(0.05, 0.05, 0.12, (sx * 0.16, 0.42, 0), 0xc49e10, axis='x'))
        cyl(0.064, 0.064, 0.035, (sx * 0.235, 0.42, 0), 0x9a7c0c, seg=6, axis='x')
    smooth_cyl(cyl(0.07, 0.07, 0.12, (0, 0.38, 0.16), 0xc49e10, axis='z'))
    cyl(0.085, 0.085, 0.04, (0, 0.38, 0.235), 0x9a7c0c, seg=6, axis='z')


def news():
    for i, c in enumerate((0x2b5fa8, 0xd8402e, 0xf2c14e)):
        x = (i - 1) * 0.5
        box((0.44, 0.62, 0.38), (x, 0.56, 0), c, bevel=0.015)
        box((0.44, 0.06, 0.38), (x, 0.9, 0), c, bevel=0.02)
        box((0.36, 0.26, 0.02), (x, 0.66, 0.19), 0x121416, bevel=0.004)  # window frame
        box((0.32, 0.22, 0.01), (x, 0.66, 0.2), 0xdedad0, bevel=0.002)   # the paper behind it
        box((0.1, 0.12, 0.04), (x + 0.12, 0.83, 0.18), 0x2a2a2a)          # coin box
        box((0.26, 0.03, 0.04), (x, 0.42, 0.2), 0x2a2a2a)                  # handle
        box((0.1, 0.24, 0.1), (x, 0.13, 0), 0x2a2a2a)                      # pedestal
        box((0.34, 0.02, 0.3), (x, 0.01, 0), 0x2a2a2a)


def meter():
    smooth_cyl(cyl(0.035, 0.035, 1.1, (0, 0.55, 0), 0x3a3d40))
    cyl(0.08, 0.08, 0.03, (0, 0.015, 0), 0x3a3d40)
    box((0.2, 0.28, 0.16), (0, 1.22, 0), 0x6e7378, bevel=0.02)
    sphere(0.1, (0, 1.36, 0), hexc(0x6e7378), scale=(1, 0.6, 0.8))
    box((0.14, 0.09, 0.02), (0, 1.27, 0.08), 0x1a2a20)
    box((0.02, 0.05, 0.01), (0.06, 1.16, 0.083), 0x111111)


def sign():
    smooth_cyl(cyl(0.035, 0.035, 3.2, (0, 1.6, 0), 0x3a3d40))
    sphere(0.045, (0, 3.22, 0), hexc(0x3a3d40))
    for p, s in (((0, 3.0, 0), (1.1, 0.24, 0.03)), ((0, 2.7, 0), (0.03, 0.24, 1.1))):
        box((s[0] + (0.02 if s[0] > 0.5 else 0), s[1] + 0.02, s[2] + (0.02 if s[2] > 0.5 else 0)), p, 0xf2f2ee, bevel=0.01)
        box((s[0] - 0.02 if s[0] > 0.5 else s[0] + 0.004, s[1] - 0.025, s[2] - 0.02 if s[2] > 0.5 else s[2] + 0.004), p, 0x1d6b3e, bevel=0.005)
    # the street name along each blade, both faces: blocks of letter widths, a word space or two
    for along, y, seed in ((True, 3.0, 17), (False, 2.7, 91)):
        x, r = -0.4, seed
        while x < 0.38:
            r = (r * 9301 + 49297) % 233280
            w = 0.035 + (r / 233280) * 0.035
            if r % 7 == 0 and x > -0.3:
                x += 0.05
                continue
            h, dy = (0.068, -0.0105) if r % 5 == 0 else (0.089, 0.0)
            narrow = w < 0.047
            if narrow:
                w = 0.016
            # wider letters get a green counter cut in them - open at the foot (n), the top (u) or
            # closed (o) - so they read as letters, not a row of white windows
            cw, ch, cy = w - 0.028, h - 0.03, y + dy
            if r % 3 == 0:
                ch, cy = h - 0.014, y + dy - 0.008
            elif r % 3 == 1:
                ch, cy = h - 0.014, y + dy + 0.008
            for sz, cc, col in (((w, h, 0.036), (x + w / 2, y + dy), 0xf2f2ee), ((cw, ch, 0.04), (x + w / 2, cy), 0x1d6b3e)):
                if col != 0xf2f2ee and narrow:
                    continue
                if along:
                    box(sz, (cc[0], cc[1], 0), col, bevel=0)
                else:
                    box((sz[2], sz[1], sz[0]), (0, cc[1], cc[0]), col, bevel=0)
            x += w + 0.016
    # below them a no-parking sign (it was a blank red panel): a white plate, a black P in a red
    # ring struck through, two lines of small print
    box((0.46, 0.62, 0.03), (0, 2.12, 0.02), 0xf2f2ee, bevel=0.008)
    torus(0.155, 0.022, (0, 2.22, 0.037), 0xc0392b, axis='z')
    K = 0x1a1a1a
    box((0.04, 0.2, 0.006), (-0.035, 2.22, 0.037), K, bevel=0)
    box((0.085, 0.034, 0.006), (0.0, 2.303, 0.037), K, bevel=0)
    box((0.085, 0.034, 0.006), (0.0, 2.233, 0.037), K, bevel=0)
    box((0.034, 0.1, 0.006), (0.043, 2.268, 0.037), K, bevel=0)
    box((0.036, 0.31, 0.006), (0, 2.22, 0.041), 0xc0392b, bevel=0, rot=(0, 0, math.pi / 4))
    box((0.32, 0.03, 0.006), (0, 1.98, 0.037), K, bevel=0)
    box((0.22, 0.03, 0.006), (0, 1.92, 0.037), 0xc0392b, bevel=0)
    for y in (1.95, 2.35):
        box((0.08, 0.03, 0.06), (0, y, -0.01), 0x55585b)


def shelter():
    box((3.7, 0.08, 1.7), (0, 2.58, -0.1), 0xe8e6e0, bevel=0.02)
    box((3.7, 0.12, 0.06), (0, 2.5, 0.72), 0xc9c6bd, bevel=0.01)  # gutter
    for x in (-1.7, 1.7):
        for z in (-0.8, 0.55):
            smooth_cyl(cyl(0.045, 0.045, 2.5, (x, 1.25, z), 0x3a3d40))
    box((3.36, 1.9, 0.02), (0, 1.35, -0.82), 0x9fb6c0, bevel=0.003)
    box((3.4, 0.05, 0.05), (0, 2.31, -0.82), 0x3a3d40)
    box((3.4, 0.05, 0.05), (0, 0.39, -0.82), 0x3a3d40)
    box((0.02, 1.9, 1.3), (-1.7, 1.35, -0.15), 0x9fb6c0, bevel=0.003)
    box((1.14, 1.74, 0.08), (1.0, 1.35, -0.77), 0x2b2d30, bevel=0.01)   # the ad case
    box((1.04, 1.62, 0.02), (1.0, 1.35, -0.72), 0xf2b84b)
    box((2.0, 0.05, 0.38), (-0.5, 0.48, -0.55), 0x8a8d90, bevel=0.01)
    for x in (-1.3, 0.3):
        box((0.05, 0.45, 0.3), (x, 0.24, -0.6), 0x3a3d40)


def lamp():
    smooth_cyl(cyl(0.14, 0.085, 7.0, (0, 3.6, 0), 0x4a5056, seg=20))
    box((0.36, 0.5, 0.36), (0, 0.25, 0), 0x3a3f44, bevel=0.03)
    cyl(0.2, 0.14, 0.12, (0, 0.56, 0), 0x3a3f44, seg=20)
    # the arm: a curve from the top of the pole out over the road
    pts = [(0, 6.9 + 0.25 * math.sin(t * math.pi / 2), 1.55 * (1 - math.cos(t * math.pi / 2)) if t < 1 else 1.55) for t in [i / 6 for i in range(7)]]
    pts = [(0, 6.95 + 0.22 * math.sin(t * math.pi), 1.5 * t) for t in [i / 8 for i in range(9)]]
    for a, b in zip(pts, pts[1:]):
        seg(a, b, 0.045, hexc(0x4a5056))
    # a cobra-head luminaire, its lens underneath (the game draws the lit lens)
    sphere(0.3, (0, 7.08, 1.62), hexc(0x3a3f44), scale=(0.62, 0.32, 1.3))
    box((0.3, 0.02, 0.5), (0, 6.99, 1.62), 0x9aa0a6, bevel=0.01)


def signal():
    D = 0x22262a
    # a galvanized steel pole (dull zinc grey) - it was dark slate, and read pure black after dark
    GALV = 0x8e9599
    smooth_cyl(cyl(0.11, 0.085, 4.3, (0, 2.15, 0), GALV, seg=16))
    box((0.3, 0.06, 0.3), (0, 0.03, 0), GALV, bevel=0.01)
    box((0.36, 1.05, 0.28), (0, 4.75, 0), D, bevel=0.03)
    # backplate with a reflective yellow border
    box((0.56, 1.24, 0.03), (0, 4.75, -0.16), 0xe8c21c, bevel=0.01)
    box((0.48, 1.16, 0.035), (0, 4.75, -0.158), 0x16181a, bevel=0.006)
    for y in (5.1, 4.75, 4.4):
        cyl(0.115, 0.115, 0.02, (0, y, 0.145), 0x0d0e0f, seg=20, axis='z')
        # a visor over each lens: half a tube
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.135, depth=0.2, location=G(0, y, 0.24), rotation=(math.pi / 2, 0, 0), end_fill_type='NOTHING')
        o = bpy.context.active_object
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.02 and True or False] if False else [], context='VERTS')
        # keep the top half (Blender z after rotation is the cylinder's local y)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if (o.matrix_world.to_3x3() @ v.co).z < -0.04], context='VERTS')
        bm.to_mesh(o.data)
        bm.free()
        s = o.modifiers.new('s', 'SOLIDIFY')
        s.thickness = 0.008
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='s')
        finish(o, D, 0)


def planter():
    """a round concrete planter: tapered pot, a rolled lip, dark soil (the shrub is a leaf-card instance)"""
    C = 0xd9d2c4
    smooth_cyl(cyl(0.45, 0.55, 0.5, (0, 0.25, 0), C, seg=28))  # radius1 is the base: wider at the top
    torus(0.54, 0.04, (0, 0.52, 0), hexc(0xcfc7b8))
    cyl(0.5, 0.5, 0.03, (0, 0.5, 0), 0x3a2a1c, seg=28)
    cyl(0.47, 0.47, 0.04, (0, 0.02, 0), 0xa9a296, seg=28)


def mesh(verts, faces, col, smooth=True):
    """a mesh from game-space verts and quad/tri faces, one colour"""
    me = bpy.data.meshes.new('m')
    me.from_pydata([G(*v) for v in verts], [], faces)
    me.update()
    o = bpy.data.objects.new('m', me)
    sc.collection.objects.link(o)
    if smooth:
        for f in me.polygons:
            f.use_smooth = True
    return finish(o, col, 0)


def umbrella():
    """a beach umbrella: eight fabric panels sagging between their ribs (alternate panels white and
    grey, so the game's per-umbrella colour makes the stripes), a scalloped valance round the rim,
    ribs and stretchers underneath, a two-part pole with a hub, a finial and a ground anchor"""
    R, TOP, N = 1.5, 2.92, 8
    def y_at(r, f):
        k = r / R
        return TOP - 0.58 * k ** 1.1 - 0.085 * k * math.sin(math.pi * f) ** 1.2
    for k in range(N):
        col = 0xffffff if k % 2 == 0 else 0xa2a2a2
        a0, a1 = k * 2 * math.pi / N, (k + 1) * 2 * math.pi / N
        NR, NA = 9, 7
        verts, faces = [], []
        for i in range(NR + 1):
            r = 0.04 + (R - 0.04) * i / NR
            for j in range(NA + 1):
                f = j / NA
                a = a0 + (a1 - a0) * f
                verts.append((r * math.cos(a), y_at(r, f), r * math.sin(a)))
        for i in range(NR):
            for j in range(NA):
                v = i * (NA + 1) + j
                faces.append((v, v + 1, v + NA + 2, v + NA + 1))
        o = mesh(verts, faces, col)
        sol = o.modifiers.new('s', 'SOLIDIFY')
        sol.thickness = 0.008
        # the valance: a flap hanging from the rim, two scallops a panel
        vv, ff = [], []
        NV = 16
        for j in range(NV + 1):
            f = j / NV
            a = a0 + (a1 - a0) * f
            yt = y_at(R, f)
            yb = yt - 0.1 - 0.05 * math.sin(math.pi * ((2 * f) % 1.0))
            c, s_ = math.cos(a), math.sin(a)
            vv += [(R * c, yt + 0.005, R * s_), (R * 1.005 * c, yb, R * 1.005 * s_)]
        for j in range(NV):
            ff.append((2 * j, 2 * j + 2, 2 * j + 3, 2 * j + 1))
        v = mesh(vv, ff, col)
        v.modifiers.new('s', 'SOLIDIFY').thickness = 0.006
    STEEL = 0xd4d4d4
    for k in range(N):
        a = k * 2 * math.pi / N
        c, s_ = math.cos(a), math.sin(a)
        seg((0, TOP - 0.03, 0), (R * 0.99 * c, y_at(R, 0) - 0.012, R * 0.99 * s_), 0.008, STEEL, sides=5)
        rm = 0.8
        seg((0, 2.2, 0), (rm * c, y_at(rm, 0) - 0.012, rm * s_), 0.006, STEEL, sides=5)
    smooth_cyl(cyl(0.022, 0.022, 2.9, (0, 1.45, 0), STEEL, seg=10))
    smooth_cyl(cyl(0.03, 0.03, 0.12, (0, 2.2, 0), STEEL, seg=10))
    smooth_cyl(cyl(0.028, 0.028, 0.06, (0, 1.25, 0), 0x707070, seg=10))
    sphere(0.035, (0, TOP + 0.04, 0), STEEL, seg=10)
    smooth_cyl(cyl(0.05, 0.035, 0.12, (0, 0.06, 0), 0x8a8a8a, seg=10))


def lounger():
    """a white resin beach lounger, head end toward -z: side rails, four legs, the seat in slats and
    a backrest tilted up at 40 degrees in slats on its own rails"""
    W = 0xf4f4f2
    for sx in (-0.29, 0.29):
        box((0.045, 0.05, 1.25), (sx, 0.32, 0.27), W, bevel=0.012)
        seg((sx, 0.33, -0.33), (sx, 0.82, -0.92), 0.022, W, sides=8)
        for z in (-0.25, 0.8):
            box((0.045, 0.3, 0.05), (sx, 0.15, z), W, bevel=0.01)
        box((0.05, 0.08, 0.06), (sx, 0.04, -0.3), 0x9a9a9a, bevel=0.01)
    box((0.6, 0.04, 0.04), (0, 0.32, 0.86), W, bevel=0.01)
    z = -0.28
    while z < 0.84:
        box((0.58, 0.022, 0.065), (0, 0.355, z), W, bevel=0.008)
        z += 0.085
    th = math.atan2(0.49, 0.59)
    for i in range(8):
        t = (i + 0.5) / 8
        y = 0.345 + 0.49 * t
        zz = -0.33 - 0.59 * t
        box((0.58, 0.022, 0.065), (0, y + 0.02, zz), W, bevel=0.008, rot=(th, 0, 0))


def mailbox():
    """a kerbside mailbox, door toward +z (the street): a round-topped steel box on a mounting board on a
    square wooden post, a door with a pull, and a red flag on the side. The body is pure white so the
    game can paint some of them black."""
    WOOD, BODY, DARK, RED = 0x7a6248, 0xffffff, 0x2a2a2a, 0xc0392b
    box((0.09, 1.02, 0.09), (0, 0.51, -0.06), WOOD, bevel=0.008)
    box((0.13, 0.03, 0.42), (0, 1.035, 0), WOOD, bevel=0.006)
    box((0.04, 0.16, 0.04), (0, 0.95, 0.1), WOOD, bevel=0.004, rot=(0.7, 0, 0))
    # the body: a box below, a half-round roof along its length
    box((0.17, 0.1, 0.46), (0, 1.1, 0), BODY, bevel=0.01)
    cyl(0.085, 0.085, 0.46, (0, 1.15, 0), BODY, seg=20, axis='z', bevel=0.004)
    # the door: a slightly proud plate following the profile, a pull, hinge pins
    box((0.18, 0.11, 0.014), (0, 1.1, 0.236), BODY, bevel=0.004)
    cyl(0.09, 0.09, 0.014, (0, 1.15, 0.236), BODY, seg=20, axis='z', bevel=0.003)
    box((0.03, 0.025, 0.03), (0, 1.2, 0.252), DARK, bevel=0.006)
    # the flag on its pivot
    cyl(0.012, 0.012, 0.02, (0.092, 1.12, -0.12), DARK, seg=8, axis='x', bevel=0)
    box((0.01, 0.2, 0.025), (0.1, 1.2, -0.12), RED, bevel=0.003)
    box((0.01, 0.07, 0.11), (0.1, 1.27, -0.07), RED, bevel=0.003)


def lifeguard():
    """a beach lifeguard tower, ramp toward +z: square stilts with X bracing, a deck with a railed
    front porch, a hut with framed dark windows and a door, an overhanging hip roof with a fascia
    band and a flag on a pole, and a slatted ramp with handrails down to the sand. The game tints it
    each tower's pastel, so the light parts take the colour and the glass stays dark."""
    WH, TR, GL, WD = 0xffffff, 0xe6e6e6, 0x24323d, 0xdcdcdc
    # stilts and bracing
    for sx in (-1.1, 1.1):
        for sz in (-1.0, 1.0):
            box((0.16, 2.25, 0.16), (sx, 1.12, sz), TR, bevel=0.02)
            box((0.3, 0.06, 0.3), (sx, 0.03, sz), 0xbdbdbd, bevel=0.01)
    import math as _m
    for sx in (-1.1, 1.1):
        L = _m.hypot(2.0, 1.9)
        a = _m.atan2(1.9, 2.0)
        box((0.06, 0.08, L), (sx, 1.1, 0), TR, bevel=0.01, rot=(a, 0, 0))
        box((0.06, 0.08, L), (sx, 1.1, 0), TR, bevel=0.01, rot=(-a, 0, 0))
    for sz in (-1.0, 1.0):
        L = _m.hypot(2.2, 1.9)
        a = _m.atan2(1.9, 2.2)
        box((L, 0.08, 0.06), (0, 1.1, sz), TR, bevel=0.01, rot=(0, 0, a))
        box((L, 0.08, 0.06), (0, 1.1, sz), TR, bevel=0.01, rot=(0, 0, -a))
    # deck with a porch out front
    box((2.9, 0.14, 3.6), (0, 2.3, 0.35), WD, bevel=0.02)
    # porch railings (front and sides of the porch; the ramp comes up the middle of the front)
    for sx in (-1.4, 1.4):
        for z in (1.1, 1.65, 2.1):
            box((0.06, 0.95, 0.06), (sx, 2.84, z), WH, bevel=0.01)
        box((0.07, 0.06, 1.1), (sx, 3.3, 1.6), WH, bevel=0.01)
        box((0.05, 0.05, 1.1), (sx, 2.85, 1.6), WH, bevel=0.01)
    for sx in (-1.4, -0.95, 0.95, 1.4):
        box((0.06, 0.95, 0.06), (sx, 2.84, 2.12), WH, bevel=0.01)
    for x0, x1 in ((-1.4, -0.5), (0.5, 1.4)):
        box((x1 - x0, 0.06, 0.07), ((x0 + x1) / 2, 3.3, 2.12), WH, bevel=0.01)
        box((x1 - x0, 0.05, 0.05), ((x0 + x1) / 2, 2.85, 2.12), WH, bevel=0.01)
    # the hut
    box((2.3, 1.85, 2.0), (0, 3.31, -0.45), WH, bevel=0.03)
    box((2.42, 0.1, 2.12), (0, 2.42, -0.45), TR, bevel=0.02)
    # front window band and a door on the side
    box((1.7, 0.72, 0.04), (0, 3.55, 0.56), GL, bevel=0.004)
    for x in (-0.87, 0, 0.87):
        box((0.07, 0.8, 0.06), (x, 3.55, 0.58), TR, bevel=0.01)
    box((1.82, 0.07, 0.08), (0, 3.92, 0.58), TR, bevel=0.01)
    box((1.82, 0.07, 0.1), (0, 3.17, 0.6), TR, bevel=0.01)
    for sx in (-1.16, 1.16):
        box((0.04, 0.6, 1.2), (sx, 3.6, -0.55), GL, bevel=0.004)
        box((0.06, 0.07, 1.3), (sx * 1.01, 3.93, -0.55), TR, bevel=0.01)
        box((0.06, 0.07, 1.3), (sx * 1.01, 3.27, -0.55), TR, bevel=0.01)
    box((0.04, 1.55, 0.7), (1.16, 3.17, 0.15), 0xc8c8c8, bevel=0.01)
    box((0.06, 0.06, 0.06), (1.19, 3.15, -0.08), 0x555555, bevel=0.01)
    # hip roof over a fascia band, a flag on a pole
    box((2.8, 0.18, 2.55), (0, 4.3, -0.45), 0xd0d0d0, bevel=0.02)
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=1.95, radius2=0.25, depth=0.75, location=G(0, 4.76, -0.45), rotation=(0, 0, math.pi / 4))
    o = bpy.context.active_object
    o.scale = (1.0, 0.92, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    finish(o, WH, 0.02)
    smooth_cyl(cyl(0.025, 0.02, 1.4, (0.9, 5.4, -1.2), 0xd8d8d8, seg=8))
    box((0.5, 0.3, 0.015), (1.16, 5.9, -1.2), 0xd8d8d8, bevel=0.003)
    # the ramp: slats between stringers, handrails on posts, a support halfway
    import math as m2
    z0, y0, z1 = 2.1, 2.3, 5.0
    L = m2.hypot(z1 - z0, y0)
    ang = m2.atan2(y0, z1 - z0)
    for sx in (-0.48, 0.48):
        box((0.06, 0.14, L), (sx, y0 / 2, (z0 + z1) / 2), TR, bevel=0.01, rot=(ang, 0, 0))
        box((0.05, 0.05, L), (sx, y0 / 2 + 0.85, (z0 + z1) / 2), WH, bevel=0.01, rot=(ang, 0, 0))
        for t in (0.15, 0.5, 0.85):
            zz = z0 + (z1 - z0) * t
            yy = y0 * (1 - t)
            box((0.05, 0.85, 0.05), (sx, yy + 0.47, zz), WH, bevel=0.01)
        box((0.12, y0 * 0.5, 0.12), (sx, y0 * 0.25, z0 + (z1 - z0) * 0.5), TR, bevel=0.01)
    n = 16
    for i in range(n):
        t = (i + 0.5) / n
        zz = z0 + (z1 - z0) * t
        yy = y0 * (1 - t) + 0.07
        box((0.92, 0.04, L / n * 0.75), (0, yy, zz), WD, bevel=0.006, rot=(ang, 0, 0))


def ground():
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
    return bpy.context.active_object


sc.render.engine = 'CYCLES'
sc.cycles.samples = 64
sc.render.bake.target = 'VERTEX_COLORS'
sc.world = bpy.data.worlds.new('w')
sc.world.light_settings.distance = 0.5
made = []
for name, fn in (('bench', bench), ('bin', bin_), ('hydrant', hydrant), ('news', news), ('meter', meter), ('sign', sign),
                 ('shelter', shelter), ('lamp', lamp), ('signal', signal), ('planter', planter),
                 ('umbrella', umbrella), ('lounger', lounger), ('lifeguard', lifeguard), ('mailbox', mailbox)):
    fn()
    o = build(name)
    # AO over a ground plane into the colours (floor 0.45: soft contact shading, not soot)
    g = ground()
    for p in made:
        p.hide_render = True
    me = o.data
    ao = me.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
    me.color_attributes.active_color = ao
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type='AO')
    col = me.color_attributes['Color']
    for i in range(len(col.data)):
        k = max(0.45, min(1.0, ao.data[i].color[0]))
        c = col.data[i].color
        col.data[i].color = (c[0] * k, c[1] * k, c[2] * k, 1.0)
    me.color_attributes.remove(ao)
    me.color_attributes.active_color = me.color_attributes['Color']
    bpy.data.objects.remove(g, do_unlink=True)
    # lighter for the street: thousands are drawn (and shadowed) at once, so collapse each to ~300
    # triangles (the bevels and round sections are where the count went; the silhouettes stay)
    me.calc_loop_triangles()
    before = len(me.loop_triangles)
    target = {'sign': 1500, 'shelter': 420, 'signal': 380, 'lamp': 300, 'umbrella': 1500, 'lounger': 700, 'lifeguard': 2600, 'mailbox': 420}.get(name, 260)
    if before > target:
        m = o.modifiers.new('d', 'DECIMATE')
        m.ratio = target / before
        m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='d')
    me.calc_loop_triangles()
    made.append(o)
    print('prop', name, before, '->', len(me.loop_triangles), 'tris')
for p in made:
    p.hide_render = False
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_vertex_color='ACTIVE', export_materials='NONE', export_yup=True, export_apply=False)
print('exported', OUT)
