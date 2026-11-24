"""Blender: the four weapons. The pistol and bolt rifle are Poly Haven scans; the carbine and the pump
gun are built here, unwrapped and baked with edge wear. Exports guns.glb, gun-local: +z forward in
three (Blender -y), origin in the firing hand's palm.
  blender -b --python tools/lastframe/guns.py -- /tmp/lf_guns
"""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
OUT = sys.argv[sys.argv.index('--') + 1]
os.makedirs(OUT, exist_ok=True)
R = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets-src', 'lf', 'models'))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def new_mat(name, dark, worn, wear, rough, metal):
    m = bpy.data.materials.new(name); m.use_nodes = True
    m['k'] = dict(dark=dark, worn=worn, wear=wear, rough=rough, metal=metal)
    return m
M_METAL = new_mat('metal', (0.022, 0.022, 0.024), (0.34, 0.33, 0.31), 1.0, 0.42, 0.9)
M_POLY = new_mat('poly', (0.027, 0.027, 0.029), (0.085, 0.085, 0.088), 0.6, 0.62, 0.0)
M_STEEL = new_mat('steel', (0.05, 0.05, 0.052), (0.42, 0.41, 0.4), 0.8, 0.36, 1.0)
M_LENS = new_mat('lens', (0.01, 0.015, 0.02), (0.02, 0.02, 0.02), 0.0, 0.08, 0.0)

M_RUBBER = new_mat('rubber', (0.02, 0.02, 0.021), (0.05, 0.05, 0.05), 0.25, 0.85, 0.0)
M_BRASS = new_mat('brass', (0.5, 0.36, 0.13), (0.72, 0.58, 0.3), 0.35, 0.34, 1.0)
M_COPPER = new_mat('copper', (0.42, 0.2, 0.1), (0.6, 0.36, 0.22), 0.3, 0.36, 1.0)
M_SHELL = new_mat('shell', (0.33, 0.035, 0.03), (0.5, 0.12, 0.1), 0.3, 0.5, 0.0)
M_HOLE = new_mat('hole', (0.004, 0.004, 0.005), (0.01, 0.01, 0.01), 0.0, 0.9, 0.0)

def link(me, name='o'):
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    return o

class B:
    def __init__(s): s.parts = []
    def add(s, mesh_obj, mat):
        mesh_obj.data.materials.append(mat); s.parts.append(mesh_obj); return mesh_obj
    def box(s, c, sz, mat=M_METAL, bevel=0.0012, rot=None):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
        o = bpy.context.active_object; o.scale = sz
        bpy.ops.object.transform_apply(scale=True)
        if rot: o.rotation_euler = rot
        o.location = c
        bpy.ops.object.transform_apply(location=True, rotation=True)
        s._bevel(o, bevel); return s.add(o, mat)
    def cyl(s, y0, y1, r, x=0, z=0, mat=M_METAL, n=20, bevel=0.0006, r2=None):
        bpy.ops.mesh.primitive_cone_add(vertices=n, radius1=r, radius2=r if r2 is None else r2, depth=abs(y1 - y0), location=(x, (y0 + y1) / 2, z), rotation=(math.pi / 2, 0, 0))
        o = bpy.context.active_object
        bpy.ops.object.transform_apply(rotation=True)
        s._bevel(o, bevel); return s.add(o, mat)
    def pinx(s, x0, x1, y, z, r, mat=M_STEEL, n=16, bevel=0.0004):
        """a cylinder across the gun"""
        bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=r, depth=abs(x1 - x0), location=((x0 + x1) / 2, y, z), rotation=(0, math.pi / 2, 0))
        o = bpy.context.active_object
        bpy.ops.object.transform_apply(rotation=True)
        s._bevel(o, bevel); return s.add(o, mat)
    def pinz(s, z0, z1, x, y, r, mat=M_METAL, n=18, bevel=0.0005):
        """a cylinder standing up"""
        bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=r, depth=abs(z1 - z0), location=(x, y, (z0 + z1) / 2))
        o = bpy.context.active_object
        s._bevel(o, bevel); return s.add(o, mat)
    def lathe(s, prof, x=0, z=0, mat=M_METAL, n=24, bevel=0.0, closed=False, turn=0.0):
        """a profile [(y, r), ...] turned about the line along y through (x, z); closed: the last ring joins the first (a pipe)"""
        me = bpy.data.meshes.new('l'); bm = bmesh.new()
        rings = [[bm.verts.new((x + math.cos(i / n * 6.2832 + turn) * rr, yy, z + math.sin(i / n * 6.2832 + turn) * rr)) for i in range(n)] for yy, rr in prof]
        m = len(rings)
        for k in range(m if closed else m - 1):
            a, c = rings[k], rings[(k + 1) % m]
            for i in range(n):
                bm.faces.new((a[i], a[(i + 1) % n], c[(i + 1) % n], c[i]))
        if not closed:
            bm.faces.new(rings[0]); bm.faces.new(list(reversed(rings[-1])))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free()
        o = link(me)
        s._bevel(o, bevel); return s.add(o, mat)
    def tube(s, y0, y1, r, ri, x=0, z=0, mat=M_METAL, n=28, turn=0.0, bevel=0.0):
        """a pipe along y, open both ends"""
        return s.lathe([(y0, r), (y1, r), (y1, ri), (y0, ri)], x, z, mat, n, bevel, True, turn)
    def poly(s, pts, w, x=0, mat=M_POLY, bevel=0.002):
        """a profile in (y, z), extruded across x"""
        me = bpy.data.meshes.new('p'); bm = bmesh.new()
        a = [bm.verts.new((x - w / 2, p[0], p[1])) for p in pts]
        b = [bm.verts.new((x + w / 2, p[0], p[1])) for p in pts]
        bm.faces.new(a); bm.faces.new(list(reversed(b)))
        n = len(pts)
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free()
        o = link(me)
        s._bevel(o, bevel); return s.add(o, mat)
    def xsec(s, pts, y0, y1, mat=M_METAL, bevel=0.0):
        """a profile in (x, z), extruded along y"""
        me = bpy.data.meshes.new('x'); bm = bmesh.new()
        a = [bm.verts.new((p[0], y0, p[1])) for p in pts]
        b = [bm.verts.new((p[0], y1, p[1])) for p in pts]
        bm.faces.new(a); bm.faces.new(list(reversed(b)))
        n = len(pts)
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free()
        o = link(me)
        s._bevel(o, bevel); return s.add(o, mat)
    def _bevel(s, o, w, seg=2):
        if w <= 0: return
        d = o.modifiers.new('b', 'BEVEL'); d.width = w; d.segments = seg; d.limit_method = 'ANGLE'; d.angle_limit = math.radians(35); d.harden_normals = True
    def rail(s, y0, y1, z, x=0, w=0.0212):
        """an accessory rail: a dovetailed bed with a tooth every centimetre"""
        lo, hi = min(y0, y1), max(y0, y1)
        s.xsec([(x - w * 0.36, z - 0.003), (x + w * 0.36, z - 0.003), (x + w * 0.36, z + 0.0028), (x - w * 0.36, z + 0.0028)], lo, hi, M_METAL)
        tooth = [(x - w * 0.5 + 0.0028, z + 0.0018), (x - w * 0.5, z + 0.0046), (x - w * 0.5 + 0.0026, z + 0.0074), (x + w * 0.5 - 0.0026, z + 0.0074), (x + w * 0.5, z + 0.0046), (x + w * 0.5 - 0.0028, z + 0.0018)]
        n = int(round((hi - lo) / 0.01))
        for i in range(n):
            y = lo + (i + 0.5) * (hi - lo) / n
            s.xsec(tooth, y - 0.0024, y + 0.0024, M_METAL)
    def cut(s, target, cutters, bevel=0.0):
        """take the joined cutters out of a part"""
        c = cutters.join('cutter')
        bpy.ops.object.select_all(action='DESELECT'); target.select_set(True); bpy.context.view_layer.objects.active = target
        for md in list(target.modifiers):
            bpy.ops.object.modifier_apply(modifier=md.name)
        m = target.modifiers.new('c', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = c; m.solver = 'EXACT'
        bpy.ops.object.modifier_apply(modifier='c')
        bpy.data.objects.remove(c)
        s._bevel(target, bevel)
        return target
    def join(s, name):
        bpy.ops.object.select_all(action='DESELECT')
        for o in s.parts:
            o.select_set(True); bpy.context.view_layer.objects.active = o
            for md in list(o.modifiers):
                bpy.ops.object.modifier_apply(modifier=md.name)
        bpy.ops.object.join()
        o = bpy.context.active_object; o.name = name
        return o

def around(k, n, r, x=0, z=0, turn=0.0):
    a = k / n * 6.2832 + turn
    return x + math.cos(a) * r, z + math.sin(a) * r, a

# ---------------------------------------------------------------- carbine
# A gas-operated carbine of the usual pattern, to no maker's drawing. Blender axes: -y is forward, +x the shooter's left,
# the bore 43 mm above the top of the grip, the muzzle at y = -0.695, the optic's axis at z = 0.112.
def carbine():
    b = B()
    BZ = 0.043
    # ---- upper receiver: a slab-sided forging, the shoulders planed off under the rail
    up = b.xsec([(-0.0135, 0.0205), (0.0135, 0.0205), (0.0135, 0.049), (0.0098, 0.0598), (-0.0098, 0.0598), (-0.0135, 0.049)], -0.135, 0.078, M_METAL)
    c = B()
    c.box((-0.0125, -0.04, 0.0395), (0.016, 0.068, 0.0175), M_HOLE, 0.0)        # the ejection port, through the right wall
    b.cut(up, c, 0.0014)
    b.rail(0.066, -0.135, 0.0625)
    # the door of the port, hanging open under it, and its hinge
    b.box((-0.0158, -0.04, 0.0245), (0.0016, 0.07, 0.0135), M_METAL, 0.0005, rot=(0, math.radians(-16), 0))
    b.cyl(-0.078, -0.002, 0.0017, x=-0.0142, z=0.0305, mat=M_STEEL, n=10, bevel=0)
    # the shell deflector behind the port and the forward assist in its housing
    b.poly([(-0.002, 0.03), (0.02, 0.03), (0.02, 0.05), (0.008, 0.05)], 0.006, x=-0.0158, mat=M_METAL, bevel=0.0012)
    b.cyl(0.02, 0.06, 0.0072, x=-0.0178, z=0.0445, mat=M_METAL, n=16, bevel=0.001)
    b.cyl(0.06, 0.067, 0.0048, x=-0.0178, z=0.0445, mat=M_STEEL, n=14, bevel=0.0006)
    b.cyl(0.067, 0.0705, 0.0066, x=-0.0178, z=0.0445, mat=M_STEEL, n=14, bevel=0.0008)
    # charging handle: the bar across the back, its latch on the left
    b.box((0, 0.0835, 0.0552), (0.036, 0.011, 0.0068), M_METAL, 0.0012)
    b.box((0, 0.07, 0.0588), (0.012, 0.03, 0.005), M_METAL, 0.0008)
    b.box((0.0165, 0.0795, 0.0552), (0.0062, 0.017, 0.0078), M_STEEL, 0.001)
    # ---- lower receiver: magazine well, fire control pocket, the tang the grip hangs from
    lo = b.poly([(0.082, 0.0215), (0.094, 0.004), (0.094, -0.014), (0.036, -0.014), (0.03, -0.006), (-0.022, -0.006), (-0.03, -0.014), (-0.03, -0.057), (-0.102, -0.061),
                 (-0.104, -0.02), (-0.127, -0.006), (-0.127, 0.0215)], 0.0245, mat=M_METAL, bevel=0.0016)
    # the flared mouth of the well, the fence in front of it, ribs down its face
    fl = b.poly([(-0.027, -0.05), (-0.027, -0.0605), (-0.105, -0.0645), (-0.105, -0.054)], 0.0285, mat=M_METAL, bevel=0.0)
    c = B()
    c.box((0, -0.066, -0.06), (0.0175, 0.062, 0.03), M_HOLE, 0.0)
    b.cut(fl, c, 0.0012)
    for sx in (-1, 1):
        b.box((sx * 0.0078, -0.1035, -0.038), (0.0032, 0.003, 0.034), M_METAL, 0.0008)
    c = B()
    c.box((0, -0.066, -0.06), (0.0175, 0.062, 0.03), M_HOLE, 0.0)            # the well itself, open underneath
    b.cut(lo, c, 0.0016)
    # pins: pivot, takedown, hammer, trigger
    for (y, z, r) in ((-0.117, 0.01, 0.0034), (0.066, 0.009, 0.0034), (0.022, 0.006, 0.0021), (0.002, 0.001, 0.0021)):
        b.pinx(-0.0131, 0.0131, y, z, r)
    # selector on the left, its stops; the lever lies along the receiver
    b.pinx(0.012, 0.0148, 0.04, 0.004, 0.0052)
    b.box((0.0152, 0.028, 0.0045), (0.0028, 0.026, 0.0052), M_STEEL, 0.0008, rot=(math.radians(8), 0, 0))
    b.pinx(-0.0148, -0.012, 0.04, 0.004, 0.0044)
    # bolt catch: a ribbed paddle on the left above the trigger
    b.box((0.0138, -0.046, 0.021), (0.0034, 0.0125, 0.021), M_STEEL, 0.001)
    for k in range(4):
        b.box((0.0158, -0.046, 0.0275 - k * 0.0034), (0.0012, 0.0125, 0.0014), M_STEEL, 0)
    b.box((0.0132, -0.046, 0.006), (0.0026, 0.008, 0.012), M_STEEL, 0.0008)
    # magazine release: a ribbed button in a fence on the right
    b.pinx(-0.0152, -0.012, -0.036, -0.004, 0.0056, M_STEEL)
    b.box((-0.0136, -0.036, -0.004), (0.0026, 0.017, 0.016), M_METAL, 0.001)
    # trigger guard: a bow from the well to the grip; the trigger blade inside it
    b.poly([(-0.03, -0.0515), (-0.03, -0.056), (0.03, -0.0585), (0.045, -0.052), (0.05, -0.036), (0.046, -0.035), (0.0415, -0.0485), (0.029, -0.0545)], 0.0105, mat=M_METAL, bevel=0.0008)
    b.poly([(-0.006, -0.006), (0.001, -0.006), (0.0, -0.02), (-0.0035, -0.031), (-0.0085, -0.039), (-0.011, -0.0375), (-0.0075, -0.029), (-0.0055, -0.019)], 0.0062, mat=M_STEEL, bevel=0.0008)
    # ---- grip: raked, a swell at the heel, grooves cut across both sides
    b.poly([(0.035, -0.014), (0.09, -0.013), (0.098, -0.022), (0.105, -0.05), (0.127, -0.124), (0.122, -0.133), (0.086, -0.137), (0.079, -0.13), (0.06, -0.064), (0.052, -0.034)], 0.0305, mat=M_POLY, bevel=0.0055)
    for k in range(9):
        t = k / 8
        y, z = 0.079 + t * 0.021, -0.046 - t * 0.072
        for sx in (-1, 1):
            b.box((sx * 0.0153, y, z), (0.0016, 0.032, 0.0036), M_POLY, 0.0006, rot=(math.radians(-17), 0, 0))
    b.poly([(0.08, -0.131), (0.124, -0.127), (0.125, -0.134), (0.082, -0.139)], 0.0325, mat=M_POLY, bevel=0.0012)
    # ---- receiver extension: end plate, castle nut, the tube with its rail of detents
    b.box((0, 0.0805, 0.027), (0.027, 0.004, 0.036), M_STEEL, 0.001)
    b.lathe([(0.0825, 0.0186), (0.094, 0.0186)], z=0.03, mat=M_STEEL, n=12, bevel=0.0008)
    b.cyl(0.094, 0.268, 0.0148, z=0.03, mat=M_METAL, n=22, bevel=0.0012)
    b.box((0, 0.185, 0.0125), (0.0105, 0.16, 0.0075), M_METAL, 0.0012)
    # ---- stock: a hollow frame over the tube, cheek ridge, latch, a ribbed rubber pad
    st = b.poly([(0.158, 0.052), (0.3, 0.054), (0.333, 0.05), (0.342, 0.036), (0.342, -0.078), (0.318, -0.086), (0.29, -0.046), (0.25, -0.012), (0.2, -0.002), (0.158, 0.002)], 0.039, mat=M_POLY, bevel=0.0)
    c = B()
    c.poly([(0.262, 0.0), (0.322, 0.0), (0.322, -0.058), (0.302, -0.046)], 0.06, mat=M_HOLE, bevel=0.0)
    b.cut(st, c, 0.0042)
    b.poly([(0.335, 0.05), (0.3445, 0.036), (0.3445, -0.079), (0.336, -0.082), (0.336, 0.04)], 0.041, mat=M_RUBBER, bevel=0.002)
    for k in range(11):
        b.box((0, 0.3458, 0.03 - k * 0.0105), (0.036, 0.0022, 0.0052), M_RUBBER, 0.0008)
    b.poly([(0.176, 0.0), (0.238, -0.006), (0.236, -0.012), (0.19, -0.012)], 0.016, mat=M_POLY, bevel=0.0012)
    for sx in (-1, 1):
        b.pinx(sx * 0.0188, sx * 0.0205, 0.3, 0.03, 0.0072, M_STEEL)
        b.pinx(sx * 0.0196, sx * 0.0208, 0.3, 0.03, 0.0042, M_HOLE, bevel=0)
    # ---- handguard: an eight-sided tube, slots through seven of its faces, the rail along the eighth
    R1, R0 = 0.0238, 0.0212
    hg = b.lathe([(-0.139, R1), (-0.455, R1), (-0.459, R1 - 0.0022), (-0.459, R0), (-0.139, R0)], z=BZ, mat=M_METAL, n=8, closed=True, turn=math.radians(22.5))
    c = B()
    flat = R1 * math.cos(math.radians(22.5))
    for face in (0, 1, 3, 4, 5, 6, 7):
        ang = face * math.pi / 4
        n = 6 if face in (0, 4, 6) else 5
        for k in range(n):
            y = -0.172 - k * 0.049 - (0 if n == 6 else 0.0245)
            cx, cz = math.cos(ang) * flat, BZ + math.sin(ang) * flat
            c.box((cx, y, cz), (0.012, 0.033, 0.0068), M_HOLE, 0.003, rot=(0, -ang, 0))
    b.cut(hg, c, 0.0007)
    b.rail(-0.137, -0.457, 0.0625)
    # barrel nut and the collar the handguard clamps round, two cross bolts under it
    b.lathe([(-0.135, 0.0205), (-0.1395, 0.0245), (-0.154, 0.0245), (-0.156, 0.0238)], z=BZ, mat=M_METAL, n=24)
    for y in (-0.144, -0.151):
        b.pinx(-0.012, 0.012, y, BZ - 0.0262, 0.0026, M_STEEL)
    b.box((0, -0.1475, BZ - 0.0258), (0.02, 0.016, 0.006), M_METAL, 0.001)
    # ---- barrel, gas block and tube, the cage on the muzzle
    b.lathe([(-0.13, 0.0125), (-0.2, 0.0125), (-0.215, 0.0092), (-0.33, 0.0092), (-0.332, 0.0099), (-0.36, 0.0099), (-0.362, 0.0088), (-0.628, 0.0088), (-0.63, 0.0066), (-0.64, 0.0066)], z=BZ, mat=M_STEEL, n=20)
    b.cyl(-0.33, -0.362, 0.0128, z=BZ, mat=M_METAL, n=16, bevel=0.001)
    b.box((0, -0.346, BZ + 0.0125), (0.012, 0.03, 0.01), M_METAL, 0.0012)
    b.cyl(-0.13, -0.335, 0.0026, z=BZ + 0.0158, mat=M_STEEL, n=8, bevel=0)
    mz = b.lathe([(-0.634, 0.0072), (-0.636, 0.0104), (-0.641, 0.0104), (-0.643, 0.0114), (-0.69, 0.0114), (-0.695, 0.0102), (-0.695, 0.0048), (-0.652, 0.0048), (-0.65, 0.0072)], z=BZ, mat=M_STEEL, n=20, closed=True)
    c = B()
    for k in (-1, 0, 1, 2, 3):
        ang = math.radians(90 + (k - 1) * 0 + k * 60 - 60)
        c.box((math.cos(ang) * 0.0092, -0.6705, BZ + math.sin(ang) * 0.0092), (0.012, 0.027, 0.0034), M_HOLE, 0.0014, rot=(0, -ang, 0))
    b.cut(mz, c, 0.0004)
    b.lathe([(-0.628, 0.0104), (-0.634, 0.0098)], z=BZ, mat=M_STEEL, n=16)
    # ---- back-up sights, folded flat on the rail
    for y, L in ((-0.436, 0.03), (0.048, 0.03)):
        b.box((0, y, 0.0726), (0.0225, L, 0.0058), M_METAL, 0.0012)
        b.box((0, y + 0.004, 0.0772), (0.0105, L - 0.008, 0.0042), M_METAL, 0.001)
        b.pinx(-0.0135, 0.0135, y - L / 2 + 0.005, 0.0745, 0.0026, M_STEEL)
        b.pinx(0.0112, 0.0162, y, 0.07, 0.0036, M_STEEL)
    # ---- the red dot: a tube in a ring mount, turrets top and right, a lever clamp on the left
    b.box((0, -0.045, 0.0734), (0.0245, 0.056, 0.0078), M_METAL, 0.0014)
    b.box((0.0138, -0.045, 0.0702), (0.006, 0.05, 0.0098), M_METAL, 0.0012)
    b.pinx(0.016, 0.0225, -0.045, 0.0702, 0.0058, M_STEEL)
    b.box((0.0235, -0.056, 0.0702), (0.0028, 0.03, 0.0072), M_STEEL, 0.001)
    b.poly([(-0.068, 0.0765), (-0.022, 0.0765), (-0.027, 0.094), (-0.063, 0.094)], 0.015, mat=M_METAL, bevel=0.0016)
    b.tube(-0.0625, -0.0275, 0.0238, 0.0196, z=0.112, n=28, bevel=0.0008)
    b.box((0, -0.045, 0.1365), (0.0098, 0.035, 0.0048), M_METAL, 0.0008)
    for sy in (-0.058, -0.032):
        b.pinz(0.129, 0.1415, -0.0072, sy, 0.0026, M_STEEL, n=10)
    # the body: a tube that steps up to a hood at each end
    b.lathe([(0.0, 0.0226), (-0.008, 0.0226), (-0.0105, 0.0206), (-0.079, 0.0206), (-0.0815, 0.0228), (-0.092, 0.0228), (-0.092, 0.0176), (-0.0885, 0.0172), (-0.004, 0.0172), (0.0, 0.0176)], z=0.112, mat=M_METAL, n=32, closed=True)
    b.pinz(0.1325, 0.1465, 0, -0.045, 0.0086, M_METAL, n=20, bevel=0.0012)
    b.pinz(0.1465, 0.1482, 0, -0.045, 0.0074, M_STEEL, n=20, bevel=0.0004)
    b.pinx(-0.0345, -0.0205, -0.045, 0.112, 0.0096, M_METAL, n=20, bevel=0.0012)
    b.pinx(-0.0362, -0.0345, -0.045, 0.112, 0.0082, M_STEEL, n=20, bevel=0.0004)
    for k in range(10):
        cx, cz, a = around(k, 10, 0.0097, 0, 0.112)
        b.box((-0.0282, -0.045 + math.cos(a) * 0.0097, 0.112 + math.sin(a) * 0.0097), (0.011, 0.0018, 0.0018), M_METAL, 0, rot=(a, 0, 0))
    # ---- weapon light on the left of the handguard: tail cap, body, a finned head, its clamp
    LX = 0.0415
    b.box((0.0285, -0.392, BZ), (0.0105, 0.036, 0.0165), M_METAL, 0.0014)
    b.pinx(0.022, 0.035, -0.392, BZ - 0.0105, 0.0032, M_STEEL)
    b.lathe([(-0.332, 0.0098), (-0.334, 0.0128), (-0.352, 0.0128), (-0.354, 0.0118), (-0.418, 0.0118), (-0.424, 0.0162), (-0.452, 0.0162), (-0.455, 0.0152), (-0.455, 0.0128), (-0.449, 0.0126)], x=LX, z=BZ, mat=M_METAL, n=24)
    for k in range(12):
        cx, cz, a = around(k, 12, 0.0162, LX, BZ)
        b.box((cx, -0.437, cz), (0.0016, 0.022, 0.0034), M_METAL, 0, rot=(0, -a, 0))
    for k in range(4):
        b.lathe([(-0.336 - k * 0.0042, 0.0134), (-0.338 - k * 0.0042, 0.0134)], x=LX, z=BZ, mat=M_METAL, n=24)
    b.cyl(-0.33, -0.3325, 0.0078, x=LX, z=BZ, mat=M_RUBBER, n=14, bevel=0.0006)
    b.cyl(-0.4488, -0.4492, 0.0126, x=LX, z=BZ, mat=M_LENS, n=24, bevel=0)
    # a sling plate behind the receiver and a hand stop under the handguard
    b.poly([(-0.33, BZ - 0.022), (-0.292, BZ - 0.022), (-0.298, BZ - 0.04), (-0.322, BZ - 0.036)], 0.0155, mat=M_POLY, bevel=0.0022)
    o = b.join('carbine')
    # ---- the bolt carrier, seen through the port; it runs back with every shot
    bc = B()
    bc.cyl(-0.082, 0.012, 0.0116, z=BZ, mat=M_STEEL, n=20, bevel=0.0008)
    bc.box((-0.0102, -0.05, BZ - 0.001), (0.0036, 0.03, 0.0098), M_STEEL, 0.0008)
    for k in range(5):
        bc.box((-0.0112, -0.022 + k * 0.0052, BZ - 0.001), (0.0018, 0.0024, 0.012), M_STEEL, 0)
    carrier = bc.join('carbine_bolt')
    # ---- magazine: a curved polymer box, ribbed, a floorplate, the top round showing
    me = bpy.data.meshes.new('mag'); bm = bmesh.new()
    rings = []
    N = 12
    def at(t):
        ang = math.radians(4 + 15 * t); L = 0.205 * t
        return -0.066 + L * math.sin(ang) * -0.95, -0.012 - L * math.cos(ang), ang
    for i in range(N + 1):
        y, z, ang = at(i / N)
        d, w = 0.0305, 0.0112
        rings.append([bm.verts.new(q) for q in [(-w, y - d, z), (w, y - d, z), (w, y + d, z), (-w, y + d, z)]])
    for i in range(N):
        for k in range(4):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % 4], rings[i + 1][(k + 1) % 4], rings[i + 1][k]))
    bm.faces.new(rings[0]); bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    mag = link(me, 'mag')
    mag.data.materials.append(M_POLY)
    d = mag.modifiers.new('b', 'BEVEL'); d.width = 0.0022; d.segments = 2; d.limit_method = 'ANGLE'; d.angle_limit = math.radians(35); d.harden_normals = True
    mb = B()
    yb, zb, ab = at(1.0)
    mb.box((0, yb - 0.001, zb - 0.0035), (0.0262, 0.07, 0.0085), M_POLY, 0.0024, rot=(-ab * 0.9, 0, 0))
    mb.box((0, yb + 0.03, zb - 0.0005), (0.012, 0.01, 0.0075), M_POLY, 0.0014, rot=(-ab * 0.9, 0, 0))
    # ribs down both sides and a spine down the back, as the mould leaves them
    for k in range(9):
        tt = 0.24 + k * 0.078
        yy, zz, a2 = at(tt)
        for sx in (-1, 1):
            mb.box((sx * 0.0116, yy - 0.004, zz), (0.0014, 0.04, 0.0046), M_POLY, 0.0005, rot=(-a2 * 0.9, 0, 0))
    for k in range(4):
        yy, zz, a2 = at(0.3 + k * 0.2)
        mb.box((0, yy + 0.0308, zz), (0.0075, 0.0018, 0.03), M_POLY, 0.0005, rot=(-a2 * 0.9, 0, 0))
    # the top round and the follower under it
    mb.cyl(-0.083, -0.04, 0.0047, z=-0.0085, mat=M_BRASS, n=14, bevel=0.0004)
    mb.cyl(-0.083, -0.096, 0.0047, z=-0.0085, mat=M_COPPER, n=14, bevel=0, r2=0.0012)
    mb.cyl(-0.04, -0.0378, 0.0047, z=-0.0085, mat=M_STEEL, n=14, bevel=0)
    mb.box((0, -0.066, -0.0135), (0.0185, 0.05, 0.003), M_POLY, 0.0008)
    mb.parts.insert(0, mag)
    mag = mb.join('mag')
    lens = B(); lens.cyl(-0.045, -0.042, 0.0185, z=0.112, mat=M_LENS, n=28, bevel=0)
    l = lens.join('carbine_lens')
    return o, mag, l, carrier

# ---------------------------------------------------------------- pump gun
def pin(b, x0, x1, y, z, r, mat=None):
    """a cross pin: a short cylinder along x"""
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=r, depth=abs(x1 - x0), location=((x0 + x1) / 2, y, z), rotation=(0, math.pi / 2, 0))
    o = bpy.context.active_object
    bpy.ops.object.transform_apply(rotation=True)
    return b.add(o, mat or M_STEEL)

def shotgun():
    b = B()
    W = 0.0275
    # the receiver: a milled block, the top rounded off, the front squared to take the barrel
    b.poly([(0.09, 0.02), (0.087, 0.036), (0.078, 0.046), (0.062, 0.0505), (-0.128, 0.0505), (-0.135, 0.046), (-0.135, -0.008), (-0.13, -0.012),
            (0.035, -0.012), (0.058, -0.002), (0.09, 0.02)], W, mat=M_METAL, bevel=0.0028)
    # ejection port on the right, the bolt face showing in it
    b.box((-W / 2 - 0.0004, -0.056, 0.027), (0.0016, 0.068, 0.026), M_LENS, 0.0006)
    b.box((-W / 2 + 0.0012, -0.05, 0.027), (0.0016, 0.05, 0.016), M_STEEL, 0.0008)
    # loading port underneath and the shell lifter in it
    b.box((0, -0.06, -0.0128), (0.021, 0.084, 0.0016), M_LENS, 0.0004)
    b.box((0, -0.058, -0.0112), (0.016, 0.07, 0.0016), M_STEEL, 0.0006)
    # pins through the receiver, a cross-bolt safety behind the trigger
    for (y, z) in ((-0.02, -0.004), (0.028, -0.004)):
        pin(b, -W / 2 - 0.0006, W / 2 + 0.0006, y, z, 0.0022)
    pin(b, -0.016, 0.016, 0.044, -0.004, 0.0031)
    # the rail of grooves along the top the eye runs down
    for k in range(22):
        b.box((0, 0.05 - k * 0.0082, 0.0512), (0.008, 0.0012, 0.0012), M_STEEL, 0)
    # barrel with its rib and bead
    b.cyl(-0.135, -0.68, 0.0115, z=0.036, mat=M_STEEL, n=24)
    b.cyl(-0.135, -0.16, 0.0135, z=0.036, mat=M_STEEL, n=24)
    b.box((0, -0.41, 0.036 + 0.0128), (0.0062, 0.53, 0.0026), M_METAL, 0.0004)
    for k in range(40):
        b.box((0, -0.15 - k * 0.0131, 0.036 + 0.0142), (0.0062, 0.0014, 0.0008), M_STEEL, 0)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.0024, location=(0, -0.672, 0.036 + 0.0158))
    b.add(bpy.context.active_object, M_STEEL)
    b.cyl(-0.665, -0.68, 0.0122, z=0.036, mat=M_STEEL, n=24)
    # magazine tube under it, the barrel ring, the cap with its knurling
    b.cyl(-0.135, -0.59, 0.0125, z=0.008, mat=M_METAL, n=22)
    b.box((0, -0.583, 0.022), (0.014, 0.022, 0.034), M_METAL, 0.0016)
    b.cyl(-0.59, -0.618, 0.0141, z=0.008, mat=M_STEEL, n=22)
    for k in range(6):
        b.cyl(-0.593 - k * 0.0042, -0.5948 - k * 0.0042, 0.0146, z=0.008, mat=M_STEEL, n=22, bevel=0)
    b.cyl(-0.618, -0.622, 0.0105, z=0.008, mat=M_STEEL, n=16)
    # action bars running back from the pump into the receiver
    for sx in (-1, 1):
        b.box((sx * 0.0118, -0.215, 0.0055), (0.0018, 0.16, 0.0062), M_STEEL, 0.0004)
    # trigger guard as a loop, the trigger inside it
    b.poly([(0.06, -0.012), (0.066, -0.03), (0.05, -0.042), (-0.02, -0.042), (-0.032, -0.03), (-0.03, -0.012), (-0.024, -0.012), (-0.025, -0.028),
            (-0.017, -0.036), (0.046, -0.036), (0.058, -0.028), (0.053, -0.012)], 0.011, mat=M_METAL, bevel=0.0008)
    b.poly([(0.008, -0.012), (0.012, -0.022), (0.009, -0.033), (0.003, -0.033), (0.005, -0.022), (0.002, -0.012)], 0.006, mat=M_STEEL, bevel=0.0006)
    # stock: pistol grip and butt in one piece of polymer, a rubber pad on the end, a sling stud
    b.poly([(0.09, 0.05), (0.13, 0.043), (0.39, 0.03), (0.39, -0.1), (0.36, -0.11), (0.2, -0.052), (0.15, -0.052), (0.14, -0.078), (0.13, -0.122),
            (0.1, -0.128), (0.08, -0.124), (0.072, -0.06), (0.075, -0.012)], 0.037, mat=M_POLY, bevel=0.006)
    for k in range(9):
        b.box((0, 0.084 + k * 0.0036 * 1.2 + k * 0.0016, -0.08 + k * 0.0014), (0.0385, 0.0014, 0.06), M_POLY, 0.0004)
    b.poly([(0.39, 0.03), (0.415, 0.031), (0.418, -0.1), (0.39, -0.1)], 0.039, mat=M_LENS, bevel=0.004)
    pin(b, -0.004, 0.004, 0.3, -0.083, 0.004)
    # a shell carrier screwed to the left of the receiver: five rounds, brass up, in their loops
    b.box((W / 2 + 0.0018, -0.047, 0.02), (0.0036, 0.128, 0.044), M_POLY, 0.0014)
    for k in range(5):
        y = -0.095 + k * 0.024
        b.pinz(-0.014, 0.041, W / 2 + 0.0138, y, 0.0102, M_SHELL, n=16, bevel=0.0008)
        b.pinz(0.041, 0.0505, W / 2 + 0.0138, y, 0.0106, M_BRASS, n=16, bevel=0.0006)
        b.pinz(0.0505, 0.052, W / 2 + 0.0138, y, 0.0112, M_BRASS, n=16, bevel=0.0003)
        b.pinz(0.052, 0.0524, W / 2 + 0.0138, y, 0.003, M_COPPER, n=10, bevel=0)
        b.box((W / 2 + 0.0138, y, 0.018), (0.0236, 0.0222, 0.019), M_RUBBER, 0.0045)
    for (y, z) in ((-0.1, 0.036), (0.006, 0.036), (-0.1, 0.004), (0.006, 0.004)):
        pin(b, W / 2 + 0.0036, W / 2 + 0.0046, y, z, 0.0026)
    # a sling loop on the tube cap (the sight stays the bead: anything on the receiver stands in the eye's way)
    b.box((0, -0.606, -0.0105), (0.004, 0.012, 0.014), M_STEEL, 0.0012)
    o = b.join('shotgun')
    p = B()
    # the fore-end: grooved polymer on a steel sleeve
    for k in range(11):
        p.cyl(-0.29 - k * 0.0125, -0.29 - k * 0.0125 - 0.0088, 0.0248, z=0.012, mat=M_POLY, n=22, bevel=0.0016)
    p.cyl(-0.285, -0.43, 0.0222, z=0.012, mat=M_POLY, n=22)
    p.cyl(-0.28, -0.29, 0.0205, z=0.012, mat=M_STEEL, n=22)
    pump = p.join('shotgun_pump')
    return o, pump

# ---------------------------------------------------------------- wear bake
def unwrap_bake(objs, size, tag, alone=None):
    """one picture for a gun's parts: finish and wear, how rough, how much metal, and the shade its own shapes throw on it.
    alone: the parts that move apart from each other (a magazine, a bolt), shaded each by itself"""
    import numpy as np
    # hard edges stay hard, everything else is smooth
    for o in objs:
        bm = bmesh.new(); bm.from_mesh(o.data)
        for e in bm.edges:
            e.smooth = not (len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(32))
        for f in bm.faces:
            f.smooth = True
        bm.to_mesh(o.data); bm.free()
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.0025, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 24; scene.cycles.device = 'GPU'
    p = bpy.context.preferences.addons['cycles'].preferences; p.compute_device_type = 'METAL'; p.get_devices()
    for d in p.devices: d.use = d.type == 'METAL'
    def image(n, colour=False):
        im = bpy.data.images.new(tag + n, size, size)
        if not colour: im.colorspace_settings.name = 'Non-Color'
        return im
    col, rgh, mtl, occ = image('_c', True), image('_r'), image('_m'), image('_o')
    mats = {m for o in objs for m in o.data.materials}
    def graph(m, target, img):
        nt = m.node_tree; nt.nodes.clear()
        k = dict(m['k'])
        out = nt.nodes.new('ShaderNodeOutputMaterial'); em = nt.nodes.new('ShaderNodeEmission')
        bev = nt.nodes.new('ShaderNodeBevel'); bev.samples = 8; bev.inputs['Radius'].default_value = 0.003
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        dot = nt.nodes.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
        nt.links.new(bev.outputs[0], dot.inputs[0]); nt.links.new(geo.outputs['Normal'], dot.inputs[1])
        inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
        nt.links.new(dot.outputs['Value'], inv.inputs[1])
        sc = nt.nodes.new('ShaderNodeMath'); sc.operation = 'MULTIPLY'; sc.inputs[1].default_value = 11.0 * k['wear']; sc.use_clamp = True
        nt.links.new(inv.outputs[0], sc.inputs[0])
        tc = nt.nodes.new('ShaderNodeTexCoord')
        n1 = nt.nodes.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value = 90; n1.inputs['Detail'].default_value = 8
        nt.links.new(tc.outputs['Object'], n1.inputs['Vector'])
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.use_clamp = True
        rmp = nt.nodes.new('ShaderNodeMapRange'); rmp.inputs['From Min'].default_value = 0.44; rmp.inputs['From Max'].default_value = 0.62
        nt.links.new(n1.outputs[0], rmp.inputs['Value'])
        nt.links.new(sc.outputs[0], mul.inputs[0]); nt.links.new(rmp.outputs[0], mul.inputs[1])
        # the finish is not one flat tone either: it is a shade lighter and darker in patches the size of a thumb
        n3 = nt.nodes.new('ShaderNodeTexNoise'); n3.inputs['Scale'].default_value = 26; n3.inputs['Detail'].default_value = 5
        nt.links.new(tc.outputs['Object'], n3.inputs['Vector'])
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
        if target == 'c':
            pat = nt.nodes.new('ShaderNodeMapRange'); pat.inputs['From Min'].default_value = 0.3; pat.inputs['From Max'].default_value = 0.7
            pat.inputs['To Min'].default_value = 0.82; pat.inputs['To Max'].default_value = 1.2
            nt.links.new(n3.outputs[0], pat.inputs['Value'])
            base = nt.nodes.new('ShaderNodeMix'); base.data_type = 'RGBA'; base.blend_type = 'MULTIPLY'; base.inputs['Factor'].default_value = 1.0
            base.inputs['A'].default_value = (*k['dark'], 1)
            nt.links.new(pat.outputs[0], base.inputs['B'])
            nt.links.new(base.outputs['Result'], mix.inputs['A']); mix.inputs['B'].default_value = (*k['worn'], 1)
        elif target == 'r':
            r = k['rough']
            mix.inputs['A'].default_value = (r, r, r, 1); mix.inputs['B'].default_value = (max(0.2, r - 0.16) if k['metal'] > 0.5 else min(1, r + 0.2),) * 3 + (1,)
        else:
            mt = k['metal']
            mix.inputs['A'].default_value = (mt, mt, mt, 1); mix.inputs['B'].default_value = (mt, mt, mt, 1)
        nt.links.new(mul.outputs[0], mix.inputs['Factor'])
        nt.links.new(mix.outputs['Result'], em.inputs['Color']); nt.links.new(em.outputs[0], out.inputs['Surface'])
        im = nt.nodes.new('ShaderNodeTexImage'); im.image = img; nt.nodes.active = im
    for tgt, img in (('c', col), ('r', rgh), ('m', mtl)):
        for m in mats: graph(m, tgt, img)
        bpy.ops.object.bake(type='EMIT', margin=4, use_clear=True)
    # shade: each moving part by itself, so a magazine is not black where the well was round it
    for m in mats: graph(m, 'm', occ)
    scene.cycles.samples = 48
    groups = alone or [objs]
    for gi, grp in enumerate(groups):
        for o in objs:
            o.hide_render = o not in grp
        bpy.ops.object.select_all(action='DESELECT')
        for o in grp:
            o.select_set(True)
        bpy.context.view_layer.objects.active = grp[0]
        bpy.ops.object.bake(type='AO', margin=4, use_clear=gi == 0)
    for o in objs:
        o.hide_render = False
    def px(im):
        a = np.empty(size * size * 4, np.float32); im.pixels.foreach_get(a); return a.reshape(size, size, 4)
    C, Rr, Mm, O = px(col), px(rgh), px(mtl), px(occ)
    ao = np.clip(O[..., 0], 0, 1)
    C[..., :3] *= (0.3 + 0.7 * ao ** 1.3)[..., None]
    col.pixels.foreach_set(C.ravel()); col.update()
    orm = image('_orm')
    P = np.ones((size, size, 4), np.float32)
    P[..., 0] = ao; P[..., 1] = np.clip(Rr[..., 0] + (1 - ao) * 0.12, 0, 1); P[..., 2] = Mm[..., 0]
    orm.pixels.foreach_set(P.ravel()); orm.update()
    for im in (rgh, mtl, occ):
        bpy.data.images.remove(im)
    # final principled
    g = bpy.data.materials.new(tag)
    g.use_nodes = True
    nt = g.node_tree; bs = nt.nodes.get('Principled BSDF')
    ci = nt.nodes.new('ShaderNodeTexImage'); ci.image = col
    ri = nt.nodes.new('ShaderNodeTexImage'); ri.image = orm
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(ri.outputs[0], sep.inputs[0])
    nt.links.new(ci.outputs[0], bs.inputs['Base Color']); nt.links.new(sep.outputs['Green'], bs.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], bs.inputs['Metallic'])
    for o in objs:
        o.data.materials.clear(); o.data.materials.append(g)
    return g

def scan(name, parts, rot_z=-math.pi / 2):
    """import a scanned gun, keep some parts, turn it to face -y"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f'{R}/{name}/{name}.gltf')
    new = [o for o in bpy.data.objects if o not in before]
    keep = {}
    for o in new:
        if o.type == 'MESH' and o.name.split('.')[0] in parts:
            keep[o.name.split('.')[0]] = o
    for o in new:
        if o not in keep.values(): bpy.data.objects.remove(o)
    return keep

def place(o, origin, name):
    """grip point -> 0, barrel along -y"""
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z') @ Matrix.Translation(-Vector(origin)))
    o.data.update(); o.name = name

def decimate(o, tris):
    n = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if n <= tris: return
    d = o.modifiers.new('d', 'DECIMATE'); d.ratio = tris / n
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='d')

c, cm, cl, cb = carbine()
unwrap_bake([c, cm, cb], 2048, 'carbine_tex', [[c], [cm], [cb]])
cl.data.materials.clear()
lm = bpy.data.materials.new('lens'); lm.use_nodes = True
b = lm.node_tree.nodes.get('Principled BSDF'); b.inputs['Base Color'].default_value = (0.02, 0.03, 0.04, 1); b.inputs['Roughness'].default_value = 0.08; b.inputs['Metallic'].default_value = 0.5
cl.data.materials.append(lm)
# seen across a room in somebody else's hands, the carbine is the same picture on a fifth of the mesh
bpy.ops.object.select_all(action='DESELECT'); c.select_set(True); bpy.context.view_layer.objects.active = c
bpy.ops.object.duplicate()
clo = bpy.context.active_object; clo.name = 'carbine_lo'
dm = clo.modifiers.new('d', 'DECIMATE'); dm.ratio = 0.17
bpy.ops.object.modifier_apply(modifier='d')
s, sp = shotgun()
unwrap_bake([s, sp], 2048, 'shotgun_tex', [[s], [sp]])

P = scan('service_pistol', {'service_pistol_pistol_a', 'service_pistol_slide_a', 'service_pistol_hammer_a', 'service_pistol_trigger_a', 'service_pistol_magazine_loaded'})
PO = (-0.012, 0, 0.0)
for k, n in (('service_pistol_pistol_a', 'pistol'), ('service_pistol_slide_a', 'pistol_slide'), ('service_pistol_hammer_a', 'pistol_hammer'), ('service_pistol_trigger_a', 'pistol_trigger')):
    place(P[k], PO, n)
m = P['service_pistol_magazine_loaded']
# the loose magazine (x -0.128..-0.071, z -0.052..0.055) slid up into the grip
mw = m.matrix_world.copy(); m.parent = None; m.matrix_world = mw
bpy.ops.object.select_all(action='DESELECT'); m.select_set(True); bpy.context.view_layer.objects.active = m
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
ctr = Vector((-0.0995, 0, 0.0015))
m.data.transform(Matrix.Translation(Vector((-0.021, 0, 0.0))) @ Matrix.Rotation(math.radians(0), 4, 'Y') @ Matrix.Translation(-ctr))
place(m, PO, 'pistol_mag')
for n, t in (('pistol', 3200), ('pistol_slide', 1800), ('pistol_mag', 500)):
    decimate(bpy.data.objects[n], t)

Rf = scan('bolt_action_rifle_7_62', {'bolt_action_rifle_7_62', 'bolt_action_rifle_7_62_bolt_a', 'bolt_action_rifle_7_62_trigger'})
RO = (-0.335, 0, -0.012)
place(Rf['bolt_action_rifle_7_62'], RO, 'rifle')
place(Rf['bolt_action_rifle_7_62_bolt_a'], RO, 'rifle_bolt')
place(Rf['bolt_action_rifle_7_62_trigger'], RO, 'rifle_trigger')
decimate(bpy.data.objects['rifle'], 5000)
# a plain scope on the scan
b = B()
zc = 0.103
b.cyl(0.04, -0.2, 0.0145, z=zc, n=26, mat=M_METAL)
b.cyl(0.06, 0.03, 0.0195, z=zc, n=26, mat=M_METAL, r2=0.0145)
b.cyl(0.095, 0.06, 0.0195, z=zc, n=26, mat=M_METAL)
b.cyl(-0.19, -0.25, 0.0145, z=zc, n=26, mat=M_METAL, r2=0.024)
b.cyl(-0.25, -0.29, 0.024, z=zc, n=26, mat=M_METAL)
b.cyl(-0.06, -0.1, 0.0165, z=zc, n=20, mat=M_METAL)
b.box((0, -0.08, zc + 0.022), (0.016, 0.02, 0.014), M_METAL)
b.box((0.022, -0.08, zc), (0.014, 0.02, 0.016), M_METAL)
for y in (-0.03, -0.13):
    b.box((0, y, zc - 0.022), (0.024, 0.016, 0.02), M_METAL)
sc = b.join('rifle_scope')
unwrap_bake([sc], 512, 'scope_tex')

for o in list(bpy.data.objects):
    if o.name not in ('carbine', 'carbine_lo', 'mag', 'carbine_lens', 'carbine_bolt', 'shotgun', 'shotgun_pump', 'pistol', 'pistol_slide', 'pistol_hammer', 'pistol_trigger', 'pistol_mag', 'rifle', 'rifle_bolt', 'rifle_trigger', 'rifle_scope'):
        bpy.data.objects.remove(o)
bpy.data.objects['mag'].name = 'carbine_mag'
for im in bpy.data.images:
    if im.size[0] > 1024 and not im.name.startswith(('carbine_tex', 'shotgun_tex')): im.scale(1024, 1024)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=f'{OUT}/guns.glb', export_format='GLB', use_selection=True, export_image_format='JPEG', export_image_quality=82, export_apply=True, export_yup=True, export_animations=False)
# preview turntable-less: one side-on render
cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = 1.15
co = bpy.data.objects.new('c', cam); scene.collection.objects.link(co)
co.location = (1.2, -0.2, 0.0); co.rotation_euler = (math.pi / 2, 0, math.pi / 2)
scene.camera = co
sun = bpy.data.lights.new('s', 'SUN'); sun.energy = 3; so = bpy.data.objects.new('s', sun); scene.collection.objects.link(so); so.rotation_euler = (1.0, 0.4, 1.2)
w = bpy.data.worlds.new('w'); scene.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.4, 0.4, 0.42, 1)
scene.render.resolution_x, scene.render.resolution_y = 1200, 500
offs = dict(carbine=0.28, carbine_mag=0.28, carbine_lens=0.28, shotgun=-0.0, shotgun_pump=0)
for name, grp, dz in (('A', ('carbine', 'carbine_mag', 'carbine_lens', 'carbine_bolt'), 0), ('B', ('shotgun', 'shotgun_pump'), 0), ('C', ('pistol', 'pistol_slide', 'pistol_mag', 'pistol_hammer', 'pistol_trigger'), 0), ('D', ('rifle', 'rifle_bolt', 'rifle_scope', 'rifle_trigger'), 0)):
    for o in bpy.data.objects:
        if o.type == 'MESH': o.hide_render = o.name not in grp
    scene.render.filepath = f'{OUT}/gun_{name}.png'
    bpy.ops.render.render(write_still=True)
# and from three-quarters, both sides, close enough to judge the detail
pc = bpy.data.cameras.new('p'); pc.lens = 42
po = bpy.data.objects.new('p', pc); scene.collection.objects.link(po)
scene.camera = po
scene.cycles.samples = 48
scene.render.resolution_x, scene.render.resolution_y = 1500, 900
for name, grp, at in (('A', ('carbine', 'carbine_mag', 'carbine_lens', 'carbine_bolt'), (0, -0.2, 0.02)), ('B', ('shotgun', 'shotgun_pump'), (0, -0.14, 0.0))):
    for o in bpy.data.objects:
        if o.type == 'MESH': o.hide_render = o.name not in grp
    for tag2, eye in (('L', (0.8, -0.75, 0.4)), ('R', (-0.85, -0.55, 0.4)), ('F', (0.3, 0.62, 0.3))):
        po.location = eye
        po.rotation_euler = (Vector(at) - Vector(eye)).to_track_quat('-Z', 'Z').to_euler()
        scene.render.filepath = f'{OUT}/gun_{name}_{tag2}.png'
        bpy.ops.render.render(write_still=True)
# webp: the first-person guns were the second biggest download
import subprocess, shutil
shutil.move(f'{OUT}/guns.glb', f'{OUT}/guns_jpeg.glb')
subprocess.run(['npx', '--yes', '@gltf-transform/cli', 'webp', f'{OUT}/guns_jpeg.glb', f'{OUT}/guns.glb', '--quality', '84'], check=True, cwd=os.path.join(HERE, '..', '..') if 'HERE' in dir() else None)
print('GUNS DONE', os.path.getsize(f'{OUT}/guns.glb') // 1024, 'KB')
