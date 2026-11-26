"""Replace Palmera's box exhaust pipes with modelled tips (public/palmera/cars.glb).

Run: blender -b --python tools/palmera/cars_exhausts.py -- <in.glb> <out.glb>   (last step, after cars_seams.py)

The bodies carried their exhausts as tiny boxes (<= 24 triangles, under 16 cm across, at the very back,
near the bottom) that the game painted dark grey - square blocks under the bumper. Each one is deleted
from the body and replaced, a little higher and further in (where the game used to nudge them), by a
round tip: a chrome outer tube with a rolled lip, a dark bore and a back cap, in a new object
car_<model>_trim that the game merges into the car's trim.
"""
import sys, math
import bpy
import bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

CHROME, BORE = (0.78, 0.78, 0.8, 1), (0.03, 0.03, 0.035, 1)


def tip(bm_out, col, c, r, length, rear_sign):
    """a tip at c, pointing out of the back (rear_sign = +1 if the back is +y)"""
    seg = 20
    y0, y1 = c.y - rear_sign * length, c.y + rear_sign * 0.01
    rings = [(r * 0.92, y0, CHROME), (r, y0 + rear_sign * 0.02, CHROME), (r, y1 - rear_sign * 0.012, CHROME),
             (r * 0.96, y1, CHROME), (r * 0.8, y1, BORE), (r * 0.78, y1 - rear_sign * 0.03, BORE), (r * 0.78, y0 + rear_sign * 0.04, BORE)]
    vs = []
    for rr, y, cc in rings:
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            ring.append((bm_out.verts.new((c.x + math.cos(a) * rr, y, c.z + math.sin(a) * rr)), cc))
        vs.append(ring)
    for i in range(len(vs) - 1):
        for k in range(seg):
            a, b = vs[i][k], vs[i][(k + 1) % seg]
            d, e = vs[i + 1][(k + 1) % seg], vs[i + 1][k]
            f = bm_out.faces.new((a[0], b[0], d[0], e[0]))
            for l, (_, cc) in zip(f.loops, (a, b, d, e)):
                l[col] = cc
    # the back of the bore
    cap = bm_out.faces.new([v for v, _ in vs[-1]])
    for l in cap.loops:
        l[col] = BORE


made = 0
for body in [o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('_body')]:
    car = body.name[4:-5]
    mw = body.matrix_world
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()
    pts = [mw @ v.co for v in bm.verts]
    ymin, ymax, zmin = min(p.y for p in pts), max(p.y for p in pts), min(p.z for p in pts)
    cy, half = (ymin + ymax) / 2, (ymax - ymin) / 2
    # islands by vertex position (the imported faces don't share vertices), as the game's own
    # detector does it
    parent = list(range(len(bm.faces)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    owner = {}
    for f in bm.faces:
        for v in f.verts:
            k = (round(v.co.x, 4), round(v.co.y, 4), round(v.co.z, 4))
            o = owner.get(k)
            if o is None:
                owner[k] = f.index
            else:
                parent[find(f.index)] = find(o)
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(f.index), []).append(f)
    pipes = []
    for isl in groups.values():
        if len(isl) > 24:
            continue
        q = [mw @ v.co for f in isl for v in f.verts]
        lo = Vector((min(p.x for p in q), min(p.y for p in q), min(p.z for p in q)))
        hi = Vector((max(p.x for p in q), max(p.y for p in q), max(p.z for p in q)))
        mid = (lo + hi) / 2
        size = hi - lo
        if abs(mid.y - cy) > half - 0.2 and size.x < 0.16 and size.z < 0.16 and lo.z < zmin + 0.2:
            pipes.append((isl, mid, size))
    if not pipes:
        print('no pipes:', car)
        bm.free()
        continue
    bmesh.ops.delete(bm, geom=list({f for isl, _, _ in pipes for f in isl}), context='FACES')
    bm.to_mesh(body.data)
    bm.free()
    me = bpy.data.meshes.new('car_' + car + '_trim')
    tb = bmesh.new()
    col = tb.loops.layers.float_color.new('Color')
    for _, mid, size in pipes:
        rear = 1 if mid.y > cy else -1
        r = max(0.035, min(0.06, max(size.x, size.z) * 0.6))
        # up into the curve of the rear valance and a little in (where the game used to move them)
        c = Vector((mid.x, mid.y - rear * 0.05 + rear * size.y / 2, mid.z + 0.1))
        tip(tb, col, c, r, 0.16, rear)
    tb.to_mesh(me)
    tb.free()
    me.color_attributes.active_color = me.color_attributes['Color']
    ob = bpy.data.objects.new('car_' + car + '_trim', me)
    ob.matrix_world = mw.copy()
    ob.data.transform(mw.inverted())  # verts were built in world space
    bpy.context.scene.collection.objects.link(ob)
    made += len(pipes)
    print(f'exhausts {car}: {len(pipes)} tips')

bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_vertex_color='ACTIVE', export_texcoords=True,
                          export_apply=False, export_materials='EXPORT', export_yup=True)
print('exported', DST, 'tips', made)
