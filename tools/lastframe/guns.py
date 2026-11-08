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
M_POLY = new_mat('poly', (0.045, 0.045, 0.047), (0.16, 0.16, 0.16), 0.8, 0.6, 0.0)
M_STEEL = new_mat('steel', (0.05, 0.05, 0.052), (0.42, 0.41, 0.4), 0.8, 0.36, 1.0)
M_LENS = new_mat('lens', (0.01, 0.015, 0.02), (0.02, 0.02, 0.02), 0.0, 0.08, 0.0)

class B:
    def __init__(s): s.parts = []
    def add(s, mesh_obj, mat):
        mesh_obj.data.materials.append(mat); s.parts.append(mesh_obj); return mesh_obj
    def box(s, c, sz, mat=M_METAL, bevel=0.0012):
        bpy.ops.mesh.primitive_cube_add(size=1, location=c)
        o = bpy.context.active_object; o.scale = sz
        bpy.ops.object.transform_apply(scale=True)
        s._bevel(o, bevel); return s.add(o, mat)
    def cyl(s, y0, y1, r, x=0, z=0, mat=M_METAL, n=20, bevel=0.0006, r2=None):
        bpy.ops.mesh.primitive_cone_add(vertices=n, radius1=r, radius2=r if r2 is None else r2, depth=abs(y1 - y0), location=(x, (y0 + y1) / 2, z), rotation=(math.pi / 2, 0, 0))
        o = bpy.context.active_object
        bpy.ops.object.transform_apply(rotation=True)
        s._bevel(o, bevel); return s.add(o, mat)
    def tube(s, y0, y1, r, ri, x=0, z=0, mat=M_METAL, n=28):
        """a pipe along y, open both ends"""
        me = bpy.data.meshes.new('t'); bm = bmesh.new()
        rings = []
        for yy, rr in ((y0, r), (y1, r), (y1, ri), (y0, ri)):
            rings.append([bm.verts.new((x + math.cos(i / n * 6.2832) * rr, yy, z + math.sin(i / n * 6.2832) * rr)) for i in range(n)])
        for k in range(4):
            a, c = rings[k], rings[(k + 1) % 4]
            for i in range(n):
                bm.faces.new((a[i], a[(i + 1) % n], c[(i + 1) % n], c[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new('t', me); scene.collection.objects.link(o)
        bpy.context.view_layer.objects.active = o
        return s.add(o, mat)
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
        o = bpy.data.objects.new('p', me); scene.collection.objects.link(o)
        bpy.context.view_layer.objects.active = o
        s._bevel(o, bevel); return s.add(o, mat)
    def _bevel(s, o, w):
        if w <= 0: return
        d = o.modifiers.new('b', 'BEVEL'); d.width = w; d.segments = 2; d.limit_method = 'ANGLE'; d.angle_limit = math.radians(35)
    def rail(s, y0, y1, z, x=0, w=0.021):
        """a picatinny rail"""
        s.box((x, (y0 + y1) / 2, z), (w * 0.72, abs(y1 - y0), 0.006), M_METAL, 0.0004)
        n = int(abs(y1 - y0) / 0.01)
        for i in range(n):
            y = y0 - (i + 0.5) * 0.01 if y1 < y0 else y0 + (i + 0.5) * 0.01
            s.box((x, y, z + 0.0055), (w, 0.0052, 0.005), M_METAL, 0.0004)
    def join(s, name):
        bpy.ops.object.select_all(action='DESELECT')
        for o in s.parts:
            o.select_set(True); bpy.context.view_layer.objects.active = o
            for md in list(o.modifiers):
                bpy.ops.object.modifier_apply(modifier=md.name)
        bpy.ops.object.join()
        o = bpy.context.active_object; o.name = name
        return o

# ---------------------------------------------------------------- carbine
def carbine():
    b = B()
    # upper + lower receiver, y forward is negative
    b.poly([(0.075, 0.03), (0.075, 0.062), (-0.135, 0.062), (-0.135, 0.018), (-0.095, 0.018), (-0.09, 0.0), (0.03, 0.0), (0.075, 0.03)], 0.026, mat=M_METAL, bevel=0.0018)
    b.poly([(0.095, -0.012), (0.06, 0.03), (-0.1, 0.03), (-0.1, -0.052), (-0.03, -0.052), (0.02, -0.012)], 0.024, mat=M_METAL, bevel=0.0018)
    b.box((0, 0.0, 0.056), (0.013, 0.1, 0.012), M_METAL)
    b.box((-0.0128, -0.03, 0.044), (0.002, 0.075, 0.015), M_STEEL)   # ejection port cover
    b.cyl(0.03, 0.058, 0.0052, x=-0.016, z=0.05, mat=M_STEEL, n=12)   # forward assist
    b.box((0.0, 0.073, 0.056), (0.022, 0.018, 0.008), M_METAL)       # charging handle
    b.box((0.015, 0.018, 0.0), (0.006, 0.012, 0.016), M_METAL)      # selector
    # rail on the receiver and the handguard
    b.rail(0.06, -0.135, 0.067)
    # handguard: an eight-sided tube with slots
    b.cyl(-0.135, -0.46, 0.0235, z=0.043, n=8, mat=M_METAL, bevel=0.0012)
    for k in range(6):
        y = -0.16 - k * 0.05
        for sx in (-1, 1):
            b.box((sx * 0.0228, y, 0.043), (0.0016, 0.034, 0.008), M_STEEL, 0.0004)
    b.rail(-0.135, -0.46, 0.0665)
    # barrel, gas block, muzzle device
    b.cyl(-0.46, -0.635, 0.0082, z=0.043, mat=M_STEEL)
    b.cyl(-0.455, -0.478, 0.0145, z=0.043, mat=M_METAL, n=14)
    b.cyl(-0.635, -0.695, 0.0112, z=0.043, mat=M_STEEL, n=12, bevel=0.001)
    for k in range(4):
        b.box((0, -0.66 - k * 0.0095, 0.054), (0.008, 0.005, 0.004), M_LENS, 0)
    # magazine: a curved stick
    me = bpy.data.meshes.new('mag'); bm = bmesh.new()
    rings = []
    N = 12
    for i in range(N + 1):
        t = i / N
        ang = math.radians(4 + 15 * t)
        L = 0.205 * t
        y = -0.052 - 0.0 + L * math.sin(ang) * -0.95 - 0.0
        z = -0.012 - L * math.cos(ang)
        d, w = 0.0325, 0.0115
        c = [(-w, y - d, z), (w, y - d, z), (w, y + d, z), (-w, y + d, z)]
        rings.append([bm.verts.new(p) for p in c])
    for i in range(N):
        for k in range(4):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % 4], rings[i + 1][(k + 1) % 4], rings[i + 1][k]))
    bm.faces.new(rings[0]); bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    mag = bpy.data.objects.new('mag', me); scene.collection.objects.link(mag)
    mag.data.materials.append(M_POLY)
    # the floorplate and the ribs moulded down the sides of the body
    mb = B()
    ang = math.radians(19); L = 0.205
    yb = -0.052 + L * math.sin(ang) * -0.95; zb = -0.012 - L * math.cos(ang)
    mb.box((0, yb, zb - 0.004), (0.027, 0.074, 0.009), M_POLY, 0.002)
    for k in range(5):
        tt = 0.25 + k * 0.13
        a2 = math.radians(4 + 15 * tt); L2 = 0.205 * tt
        yy = -0.052 + L2 * math.sin(a2) * -0.95; zz = -0.012 - L2 * math.cos(a2)
        for sx in (-1, 1):
            mb.box((sx * 0.0118, yy, zz), (0.0014, 0.05, 0.004), M_POLY, 0.0005)
    mb.parts.insert(0, mag)
    bpy.context.view_layer.objects.active = mag
    d = mag.modifiers.new('b', 'BEVEL'); d.width = 0.0016; d.segments = 2; d.limit_method = 'ANGLE'; d.angle_limit = math.radians(35)
    mag = mb.join('mag')
    # trigger guard, trigger, grip
    b.box((0, -0.002, -0.05), (0.012, 0.075, 0.0035), M_METAL, 0.0008)
    b.box((0, -0.008, -0.02), (0.006, 0.006, 0.03), M_STEEL, 0.0008)
    b.poly([(0.035, -0.012), (0.09, -0.012), (0.1, -0.03), (0.125, -0.125), (0.08, -0.13), (0.052, -0.05)], 0.03, mat=M_POLY, bevel=0.004)
    # buffer tube and stock
    b.cyl(0.075, 0.26, 0.0155, z=0.03, mat=M_METAL, n=20)
    b.cyl(0.076, 0.086, 0.0185, z=0.03, mat=M_METAL, n=12)
    b.poly([(0.18, 0.05), (0.3, 0.05), (0.335, 0.045), (0.335, -0.075), (0.31, -0.08), (0.27, -0.012), (0.18, 0.006)], 0.036, mat=M_POLY, bevel=0.004)
    # red dot on a riser
    b.box((0, -0.045, 0.082), (0.03, 0.05, 0.016), M_METAL)
    b.tube(-0.012, -0.078, 0.0205, 0.0172, z=0.112)
    b.tube(-0.06, -0.08, 0.0225, 0.0172, z=0.112)
    b.tube(-0.02, 0.0, 0.0225, 0.0172, z=0.112)
    b.box((0.024, -0.045, 0.112), (0.012, 0.02, 0.018), M_METAL)
    b.box((0, -0.045, 0.138), (0.018, 0.02, 0.012), M_METAL)
    # weapon light on the right of the handguard
    b.box((0.03, -0.39, 0.043), (0.012, 0.04, 0.014), M_METAL)
    b.cyl(-0.34, -0.43, 0.0135, x=0.041, z=0.043, mat=M_METAL, n=18)
    b.cyl(-0.43, -0.455, 0.0175, x=0.041, z=0.043, mat=M_METAL, n=18)
    # front and rear flip sights
    b.box((0, -0.43, 0.078), (0.016, 0.009, 0.016), M_METAL)
    b.box((0, 0.045, 0.08), (0.02, 0.009, 0.012), M_METAL)
    # lens (glass in the tube)
    o = b.join('carbine')
    lens = B(); lens.cyl(-0.045, -0.042, 0.0185, z=0.112, mat=M_LENS, n=28, bevel=0)
    l = lens.join('carbine_lens')
    return o, mag, l

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
def unwrap_bake(objs, size, tag):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.004, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 24; scene.cycles.device = 'GPU'
    p = bpy.context.preferences.addons['cycles'].preferences; p.compute_device_type = 'METAL'; p.get_devices()
    for d in p.devices: d.use = d.type == 'METAL'
    col = bpy.data.images.new(tag + '_c', size, size); rgh = bpy.data.images.new(tag + '_r', size, size)
    mats = {m for o in objs for m in o.data.materials}
    def graph(m, target):
        nt = m.node_tree; nt.nodes.clear()
        k = dict(m['k'])
        out = nt.nodes.new('ShaderNodeOutputMaterial'); em = nt.nodes.new('ShaderNodeEmission')
        bev = nt.nodes.new('ShaderNodeBevel'); bev.samples = 8; bev.inputs['Radius'].default_value = 0.0035
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        dot = nt.nodes.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
        nt.links.new(bev.outputs[0], dot.inputs[0]); nt.links.new(geo.outputs['Normal'], dot.inputs[1])
        inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
        nt.links.new(dot.outputs['Value'], inv.inputs[1])
        sc = nt.nodes.new('ShaderNodeMath'); sc.operation = 'MULTIPLY'; sc.inputs[1].default_value = 14.0 * k['wear']; sc.use_clamp = True
        nt.links.new(inv.outputs[0], sc.inputs[0])
        tc = nt.nodes.new('ShaderNodeTexCoord')
        n1 = nt.nodes.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value = 90; n1.inputs['Detail'].default_value = 8
        nt.links.new(tc.outputs['Object'], n1.inputs['Vector'])
        n2 = nt.nodes.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = 900; n2.inputs['Detail'].default_value = 3
        nt.links.new(tc.outputs['Object'], n2.inputs['Vector'])
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.use_clamp = True
        rmp = nt.nodes.new('ShaderNodeMapRange'); rmp.inputs['From Min'].default_value = 0.42; rmp.inputs['From Max'].default_value = 0.6
        nt.links.new(n1.outputs[0], rmp.inputs['Value'])
        nt.links.new(sc.outputs[0], mul.inputs[0]); nt.links.new(rmp.outputs[0], mul.inputs[1])
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
        if target == 'c':
            mix.inputs['A'].default_value = (*k['dark'], 1); mix.inputs['B'].default_value = (*k['worn'], 1)
        else:
            r = k['rough']
            mix.inputs['A'].default_value = (r, r, r, 1); mix.inputs['B'].default_value = (min(1, r + 0.22),) * 3 + (1,)
        nt.links.new(mul.outputs[0], mix.inputs['Factor'])
        nt.links.new(mix.outputs['Result'], em.inputs['Color']); nt.links.new(em.outputs[0], out.inputs['Surface'])
        im = nt.nodes.new('ShaderNodeTexImage'); im.image = col if target == 'c' else rgh; nt.nodes.active = im
    for tgt, img in (('c', col), ('r', rgh)):
        for m in mats: graph(m, tgt)
        bpy.ops.object.bake(type='EMIT', margin=4, use_clear=True)
    # final principled
    g = bpy.data.materials.new(tag)
    g.use_nodes = True
    nt = g.node_tree; bs = nt.nodes.get('Principled BSDF')
    ci = nt.nodes.new('ShaderNodeTexImage'); ci.image = col
    ri = nt.nodes.new('ShaderNodeTexImage'); ri.image = rgh; rgh.colorspace_settings.name = 'Non-Color'
    nt.links.new(ci.outputs[0], bs.inputs['Base Color']); nt.links.new(ri.outputs[0], bs.inputs['Roughness'])
    bs.inputs['Metallic'].default_value = 0.65
    for o in objs:
        o.data.materials.clear(); o.data.materials.append(g)
        for p in o.data.polygons: p.use_smooth = True
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

c, cm, cl = carbine()
unwrap_bake([c, cm], 1024, 'carbine_tex')
cl.data.materials.clear()
lm = bpy.data.materials.new('lens'); lm.use_nodes = True
b = lm.node_tree.nodes.get('Principled BSDF'); b.inputs['Base Color'].default_value = (0.02, 0.03, 0.04, 1); b.inputs['Roughness'].default_value = 0.08; b.inputs['Metallic'].default_value = 0.5
cl.data.materials.append(lm)
s, sp = shotgun()
unwrap_bake([s, sp], 1024, 'shotgun_tex')

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
    if o.name not in ('carbine', 'mag', 'carbine_lens', 'shotgun', 'shotgun_pump', 'pistol', 'pistol_slide', 'pistol_hammer', 'pistol_trigger', 'pistol_mag', 'rifle', 'rifle_bolt', 'rifle_trigger', 'rifle_scope'):
        bpy.data.objects.remove(o)
bpy.data.objects['mag'].name = 'carbine_mag'
for im in bpy.data.images:
    if im.size[0] > 1024: im.scale(1024, 1024)
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
for name, grp, dz in (('A', ('carbine', 'carbine_mag', 'carbine_lens'), 0), ('B', ('shotgun', 'shotgun_pump'), 0), ('C', ('pistol', 'pistol_slide', 'pistol_mag', 'pistol_hammer', 'pistol_trigger'), 0), ('D', ('rifle', 'rifle_bolt', 'rifle_scope', 'rifle_trigger'), 0)):
    for o in bpy.data.objects:
        if o.type == 'MESH': o.hide_render = o.name not in grp
    scene.render.filepath = f'{OUT}/gun_{name}.png'
    bpy.ops.render.render(write_still=True)
print('GUNS DONE', os.path.getsize(f'{OUT}/guns.glb') // 1024, 'KB')
