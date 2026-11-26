"""Shared modelling helpers for the Palmera vehicle scripts (bike.py, bus.py).

Game frame: x right, y up, z forward; G() maps it into Blender (x, -z, y). Parts are collected and
joined into one named object by build(); every part carries a linear vertex colour.
"""
import math
import bpy, bmesh
from mathutils import Vector

PREFIX = 'kit_'


def hexc(h):
    c = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
    return tuple((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def G(x, y, z):
    return Vector((x, -z, y))


parts = []


def finish(o, col, bevel=0.0):
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


def smooth(o, ang=40):
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(ang))
    o.select_set(False)
    return o


def box(s, p, col, bevel=0.004, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=G(*p), rotation=(rot[0], rot[2], rot[1]))
    o = bpy.context.active_object
    o.scale = (s[0], s[2], s[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, col, min(bevel, min(s) * 0.4))


def soft(s, p, col, rot=(0, 0, 0), taper=(1.0, 1.0), front=(1.0, 1.0), bev=0.32, lv=2):
    """a rounded, optionally tapered body panel: a cube, bevelled then subdivided"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    o = bpy.context.active_object
    o.scale = (s[0], s[2], s[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for v in o.data.vertices:
        # Blender +y is game -z (the rear)
        k = taper if v.co.y > 0 else front
        v.co.x *= k[0]
        v.co.z *= k[1]
    m = o.modifiers.new('b', 'BEVEL')
    m.width = bev * min(s)
    m.segments = 2
    s2 = o.modifiers.new('s', 'SUBSURF')
    s2.levels = lv
    s2.render_levels = lv
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='b')
    bpy.ops.object.modifier_apply(modifier='s')
    o.rotation_euler = (rot[0], rot[2], rot[1])
    o.location = G(*p)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
    bpy.ops.object.shade_smooth()
    return finish(o, col)


def cyl(r1, r2, h, p, col, seg=16, axis='y', caps=True, sm=True):
    rot = {'y': (0, 0, 0), 'x': (0, math.pi / 2, 0), 'z': (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r1, radius2=r2, depth=h, location=G(*p), rotation=rot, end_fill_type='NGON' if caps else 'NOTHING')
    o = finish(bpy.context.active_object, col)
    return smooth(o) if sm else o


def tube(a, b, r, col, sides=10):
    A, B = G(*a), G(*b)
    d = B - A
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=r, depth=d.length, location=(A + B) / 2)
    o = bpy.context.active_object
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
    return smooth(finish(o, col))


def path(pts, r, col, sides=10):
    """a bent tube through game points (a joint ball at each bend)"""
    for a, b in zip(pts, pts[1:]):
        tube(a, b, r, col, sides)
    for q in pts[1:-1]:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=sides, ring_count=sides // 2, radius=r, location=G(*q))
        bpy.ops.object.shade_smooth()
        finish(bpy.context.active_object, col)


def build(name):
    global parts
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = PREFIX + name
    parts = []
    return o




def cut(o, cutter):
    """boolean-subtract a cutter object from o (before finish(): new faces get no colour otherwise)"""
    m = o.modifiers.new('x', 'BOOLEAN')
    m.object = cutter
    m.operation = 'DIFFERENCE'
    m.solver = 'EXACT'
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='x')
    bpy.data.objects.remove(cutter, do_unlink=True)
    return o


def rounded_box(s, p, r, segs=3):
    """an uncoloured box with its edges rounded by r (call finish() after any cuts)"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=G(*p))
    o = bpy.context.active_object
    o.scale = (s[0], s[2], s[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    m = o.modifiers.new('b', 'BEVEL')
    m.width = r
    m.segments = segs
    m.limit_method = 'ANGLE'
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='b')
    return smooth(o, 35)


def render_preview(prev, name, objs_extra, cams):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.color_type = 'VERTEX'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = 900, 600
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    for nm, loc, look in cams:
        cam.location = loc
        cam.rotation_euler = (Vector(look) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = f'{prev}/{name}_{nm}.png'
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


def export(out):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_vertex_color='ACTIVE', export_materials='NONE', export_yup=True, export_apply=False)
