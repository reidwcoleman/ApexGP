# Shared helpers for Plush Panic's Blender scripts (run headless: blender -b --python blender/brawl/<x>.py).
# Everything is written in the game's frame (x left, y up, z forward, metres) and converted to
# Blender's (z up) on the way in; the glTF exporter converts back, so G(x, y, z) lands at (x, y, z).
import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix, Euler

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'brawl')
os.makedirs(OUT, exist_ok=True)


def G(x, y, z):
    return Vector((x, -z, y))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 32
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    if bg:
        bg.inputs[0].default_value = (1, 1, 1, 1)
        bg.inputs[1].default_value = 1.0
    w.light_settings.distance = 0.6
    return sc


def mat(name, rgb=(1, 1, 1), rough=0.6, metal=0.0, emit=None, emit_k=0.0, sheen=0.0, alpha=1.0, clearcoat=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if sheen:
        b.inputs['Sheen Weight'].default_value = sheen
        b.inputs['Sheen Roughness'].default_value = 0.45
    if clearcoat:
        b.inputs['Coat Weight'].default_value = clearcoat
    if emit is not None:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_k
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    m.diffuse_color = (*rgb, 1)
    return m


def link(o, coll=None):
    (coll or bpy.context.scene.collection).objects.link(o)
    return o


def obj_from_bm(bm, name, material=None, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    link(o)
    if material:
        me.materials.append(material)
    if parent:
        o.parent = parent
    return o


def active(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def apply_all(o):
    active(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def modifier(o, kind, **kw):
    m = o.modifiers.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(m, k, v)
    active(o)
    bpy.ops.object.modifier_apply(modifier=m.name)
    return o


def smooth(o, angle=None):
    for p in o.data.polygons:
        p.use_smooth = True
    if angle is not None:
        active(o)
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=angle)
        except Exception:
            pass
    return o


def join(objs, name):
    with bpy.context.temp_override(active_object=objs[0], selected_objects=objs, selected_editable_objects=objs):
        bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


# ---- primitives built in the game frame -------------------------------------------------------

def box(name, c, size, material=None, bevel=0.0, seg=2, parent=None, rot=(0, 0, 0)):
    """a box centred at c (game xyz), size (w, h, d), rotated by rot (game-frame euler, radians)"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[2], v.co.z * size[1]))
    o = obj_from_bm(bm, name, material, parent)
    o.rotation_euler = Euler((rot[0], -rot[2], rot[1]), 'XYZ')
    o.location = G(*c)
    if bevel > 0:
        modifier(o, 'BEVEL', width=bevel, segments=seg, limit_method='ANGLE')
    return o


def cyl(name, c, r, h, material=None, seg=32, rot=(0, 0, 0), bevel=0.0, r2=None, parent=None, cap=True):
    """a cylinder centred at c along the game y axis (rot turns it), radius r (r2 at the top)"""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    o = obj_from_bm(bm, name, material, parent)
    o.rotation_euler = Euler((rot[0], -rot[2], rot[1]), 'XYZ')
    o.location = G(*c)
    if bevel > 0:
        modifier(o, 'BEVEL', width=bevel, segments=2, limit_method='ANGLE')
    smooth(o, math.radians(40))
    return o


def sphere(name, c, r, material=None, seg=32, rings=16, scale=(1, 1, 1), parent=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[2], v.co.z * scale[1]))
    o = obj_from_bm(bm, name, material, parent)
    o.location = G(*c)
    smooth(o)
    return o


def torus(name, c, R, r, material=None, seg=48, rseg=16, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg, minor_segments=rseg)
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    # the torus lies in Blender's xy plane = the game's xz plane (flat on the ground)
    o.rotation_euler = Euler((rot[0], -rot[2], rot[1]), 'XYZ')
    o.location = G(*c)
    if material:
        o.data.materials.append(material)
    if parent:
        o.parent = parent
    smooth(o)
    return o


def empty(name, c, parent=None, yaw=0.0):
    o = bpy.data.objects.new(name, None)
    link(o)
    o.location = G(*c)
    o.rotation_euler = Euler((0, 0, yaw), 'XYZ')
    if parent:
        o.parent = parent
    return o


def col_box(name, c, size, rot=(0, 0, 0), parent=None, **props):
    """a hidden collision box (the game reads col_box_*)"""
    o = box('col_box_' + name, c, size, rot=rot, parent=parent)
    for k, v in props.items():
        o[k] = v
    return o


def subdivide_long(o, edge=0.35):
    """cut long faces so the occlusion bake has vertices to land on"""
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for _ in range(6):
        long = [e for e in bm.edges if e.calc_length() > edge]
        if not long:
            break
        bmesh.ops.subdivide_edges(bm, edges=long, cuts=1, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(me)
    bm.free()


def bake_ao(objs, distance=0.6, samples=24, dense=0.0):
    """occlusion into a per-vertex 'Col' (white = open), the whole set shading itself"""
    sc = bpy.context.scene
    sc.world.light_settings.distance = distance
    sc.cycles.samples = samples
    for o in objs:
        if o.type != 'MESH':
            continue
        if dense > 0:
            subdivide_long(o, dense)
        me = o.data
        if not me.materials:
            me.materials.append(mat('m_' + o.name))
        ca = me.color_attributes.get('Col') or me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        me.color_attributes.active_color = ca
        active(o)
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
        # soften: plush and toys never go fully black in the creases
        for d in ca.data:
            a = d.color[0]
            a = 0.35 + 0.65 * a
            d.color = (a, a, a, 1)


def export(objs, name, skins=False):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_skins=skins,
                              export_animations=False, export_attributes=False, export_vertex_color='ACTIVE',
                              export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
                              export_materials='EXPORT', export_yup=True, export_apply=True, export_texcoords=True,
                              export_extras=True, export_draco_mesh_compression_enable=False)
    print('wrote', path, os.path.getsize(path))
    return path


def all_of(root):
    out = [root]
    for c in root.children_recursive:
        out.append(c)
    return out


FONT_PATHS = ['/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Black.ttf']


def text(name, s, c, size, material, depth=0.02, rot=(0, 0, 0), align='CENTER', font=None, parent=None):
    """lettering as a mesh, lying flat facing +y unless rot turns it (game-frame euler)"""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = s
    cu.size = size
    cu.extrude = depth / 2
    cu.align_x = align
    cu.align_y = 'CENTER'
    for p in ([font] if font else FONT_PATHS):
        if p and os.path.exists(p):
            cu.font = bpy.data.fonts.load(p, check_existing=True)
            break
    o = bpy.data.objects.new(name, cu)
    link(o)
    active(o)
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.active_object
    o.name = name
    # the curve lies in Blender's xy plane (= the game's xz, facing up); rot turns it
    o.rotation_euler = Euler((rot[0], -rot[2], rot[1]), 'XYZ')
    o.location = G(*c)
    o.data.materials.clear()
    o.data.materials.append(material)
    if parent:
        o.parent = parent
    return o


def flat_shape(name, pts, c, material, depth=0.01, parent=None, rot=(0, 0, 0)):
    """a flat extruded polygon (game-frame xz points around c), for playfield art"""
    bm = bmesh.new()
    vs = [bm.verts.new(Vector((x, -z, 0))) for x, z in pts]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z += depth
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(bm, name, material, parent)
    o.rotation_euler = Euler((rot[0], -rot[2], rot[1]), 'XYZ')
    o.location = G(*c)
    return o


def star_pts(r0, r1, n=5, a0=0.0):
    return [((r0 if i % 2 == 0 else r1) * math.sin(a0 + i * math.pi / n), (r0 if i % 2 == 0 else r1) * math.cos(a0 + i * math.pi / n)) for i in range(2 * n)]


def circle_pts(r, n=32, rz=None):
    rz = r if rz is None else rz
    return [(r * math.cos(i / n * math.tau), rz * math.sin(i / n * math.tau)) for i in range(n)]


def annulus(name, r_in, r_out, h, material=None, seg=48, parent=None, c=(0, 0, 0)):
    """a flat ring (game frame: lying in xz, from y - h/2 to y + h/2)"""
    bm = bmesh.new()
    rings = []
    for (r, y) in ((r_out, h / 2), (r_in, h / 2), (r_in, -h / 2), (r_out, -h / 2)):
        rings.append([bm.verts.new(Vector((math.cos(i / seg * math.tau) * r, math.sin(i / seg * math.tau) * r, y))) for i in range(seg)])
    for k in range(4):
        a, b = rings[k], rings[(k + 1) % 4]
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(bm, name, material, parent)
    o.location = G(*c)
    smooth(o, math.radians(30))
    return o


def gear(name, c, r, h, teeth, material, spokes=0, hub_mat=None, parent=None, tooth=0.42, yaw=0.0, hole_r=0.0):
    """a gear on a mov_<name> node: rim + teeth (+ spokes and a hub, or a solid disc), with collision.
    Returns the node."""
    node = empty('mov_' + name, c, parent=parent, yaw=yaw)
    parts = []
    if spokes:
        r_in = r - 0.75
        parts.append(annulus(name + '_rim', r_in, r, h, material, seg=max(48, teeth * 3), parent=node))
        n = 24
        for i in range(n):
            a0, a1 = i / n * math.tau, (i + 1) / n * math.tau
            am = (a0 + a1) / 2
            rm = (r + r_in) / 2
            L = 2 * r * math.sin(math.pi / n) + 0.05
            col_box(name + '_rim', (math.cos(am) * rm, 0, math.sin(am) * rm), (r - r_in, h, L), rot=(0, -am, 0), parent=node)
        for i in range(spokes):
            a = i / spokes * math.tau
            L = r_in - 0.4
            parts.append(box(name + '_spoke', (math.cos(a) * (0.4 + L / 2), 0, math.sin(a) * (0.4 + L / 2)), (L + 0.2, h * 0.8, 0.55), material, bevel=0.05, rot=(0, -a, 0), parent=node))
            col_box(name + '_spoke', (math.cos(a) * (0.4 + L / 2), 0, math.sin(a) * (0.4 + L / 2)), (L + 0.2, h * 0.8, 0.55), rot=(0, -a, 0), parent=node)
        parts.append(cyl(name + '_hub', (0, 0.05, 0), 0.9, h + 0.1, hub_mat or material, seg=32, parent=node, bevel=0.04))
        cyl('col_hull_' + name + '_hub', (0, 0.05, 0), 0.9, h + 0.1, None, seg=16, parent=node)
    else:
        parts.append(cyl(name + '_disc', (0, 0, 0), r, h, material, seg=max(48, teeth * 3), parent=node, bevel=0.03))
        cyl('col_hull_' + name + '_disc', (0, 0, 0), r, h, None, seg=32, parent=node)
        parts.append(cyl(name + '_cap', (0, h / 2 + 0.05, 0), 0.7, 0.12, hub_mat or material, seg=32, parent=node, bevel=0.03))
    for i in range(teeth):
        a = i / teeth * math.tau
        w = 2 * math.pi * r / teeth * 0.5
        tc = (math.cos(a) * (r + tooth / 2 - 0.02), 0, math.sin(a) * (r + tooth / 2 - 0.02))
        parts.append(box(name + '_tooth', tc, (tooth + 0.04, h, w), material, bevel=0.04, rot=(0, -a, 0), parent=node))
        col_box(name + '_tooth', tc, (tooth + 0.04, h, w), rot=(0, -a, 0), parent=node)
    return node, parts


def stadium_pts(R, L, n=24):
    """a stadium outline (two straights of half-length L along x, ends of radius R), counter-clockwise
    seen from above in game xz, starting at the front straight's left end"""
    pts = []
    for i in range(n):
        pts.append((-L + 2 * L * i / n, R))
    for i in range(n):
        a = math.pi / 2 - math.pi * i / n
        pts.append((L + R * math.cos(a), R * math.sin(a)))
    for i in range(n):
        pts.append((L - 2 * L * i / n, -R))
    for i in range(n):
        a = -math.pi / 2 - math.pi * i / n
        pts.append((-L + R * math.cos(a), R * math.sin(a)))
    return pts


def ring_solid(name, inner, outer, y_top, depth, material=None, parent=None):
    """a closed band between two matching outlines (game xz lists), top at y_top"""
    bm = bmesh.new()
    n = len(inner)
    loops = []
    for pts, y in ((outer, y_top), (inner, y_top), (inner, y_top - depth), (outer, y_top - depth)):
        loops.append([bm.verts.new(G(x, y, z)) for x, z in pts])
    for k in range(4):
        a, b = loops[k], loops[(k + 1) % 4]
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(bm, name, material, parent)
    return o


def ell_pts(a, b, n=64):
    return [(a * math.cos(i / n * math.tau), b * math.sin(i / n * math.tau)) for i in range(n)]


def loft(name, loops, material=None, cap_last=False, parent=None, flip=False):
    """quads between consecutive outlines: loops = [(pts, y), ...] (same point count each)"""
    bm = bmesh.new()
    vl = [[bm.verts.new(G(x, y, z)) for x, z in pts] for pts, y in loops]
    n = len(vl[0])
    for k in range(len(vl) - 1):
        a, b = vl[k], vl[k + 1]
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((a[i], a[j], b[j], b[i]) if not flip else (b[i], b[j], a[j], a[i]))
    if cap_last:
        last = vl[-1]
        f = bm.faces.new(last if not flip else last[::-1])
    o = obj_from_bm(bm, name, material, parent)
    return o
