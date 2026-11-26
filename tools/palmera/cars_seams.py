"""Cut panel shut lines into Palmera's car bodies (public/palmera/cars.glb).

Run: blender -b --python tools/palmera/cars_seams.py -- <in.glb> <out.glb>   (after cars_ao.py)

Each seam is three parallel bisects 6 mm apart through the faces it crosses, with the middle cut line
darkened in the body's vertex colour (paint only - the trim keeps its colour): a crisp ~12 mm shut
line. Placed from each model's wheel positions (wheelbase, radius) and its glass (the window line):
  - door edges on both sides: behind the front arch, a B-pillar (four-door models) and ahead of the rear arch
  - the door bottoms along the sill
  - the bonnet's back edge at the base of the windscreen, the boot lid's front edge at the rear window
Blender space: z up, the car's nose toward -y (glTF +z forward).
"""
import sys
import bpy
import bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]
BODY = {
    'sedan': (2.83, 0.33, 4), 'compact': (2.64, 0.31, 4), 'suv': (2.95, 0.38, 4), 'gwagon': (2.89, 0.39, 4),
    'pickup': (3.68, 0.42, 4), 'coupe': (2.45, 0.34, 2), 'super': (2.7, 0.36, 2), 'muscle': (2.86, 0.36, 2),
    'police': (3.05, 0.35, 4), 'policeSuv': (3.02, 0.38, 4), 'taxi': (2.83, 0.33, 4),
}
GAP = 0.006
DARK = 0.3

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)


def bbox(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))), Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))


def seam(bm, col, faces_ok, co, no):
    """three bisects GAP apart; darken the paint at the middle one"""
    mid = []
    for k in (-1, 0, 1):
        faces = [f for f in bm.faces if faces_ok(f)]
        if not faces:
            return 0
        edges = list({e for f in faces for e in f.edges})
        verts = list({v for f in faces for v in f.verts})
        res = bmesh.ops.bisect_plane(bm, geom=faces + edges + verts, plane_co=co + no * (k * GAP), plane_no=no, dist=0.0005)
        if k == 0:
            mid = [g for g in res['geom_cut'] if isinstance(g, bmesh.types.BMVert)]
    n = 0
    for v in mid:
        for l in v.link_loops:
            c = l[col]
            if c[0] > 0.25 or c[1] > 0.25:  # paint, not trim
                l[col] = (c[0] * DARK, c[1] * DARK, c[2] * DARK, c[3])
                n += 1
    return n


total = 0
for body in [o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('_body')]:
    car = body.name[4:-5]
    if car not in BODY:
        print('skip', car)
        continue
    wb, r, doors = BODY[car]
    lo, hi = bbox(body)
    glass = bpy.data.objects.get('car_' + car + '_glass')
    glo, ghi = bbox(glass) if glass else (lo, hi)
    cy = (lo.y + hi.y) / 2
    fa, ra = cy - wb / 2, cy + wb / 2  # front / rear axle (nose toward -y)
    belt = glo.z - 0.03
    sill = r * 1.1 + 0.08
    mw = body.matrix_world
    mwi = mw.inverted()
    bm = bmesh.new()
    bm.from_mesh(body.data)
    col = bm.loops.layers.float_color.get('Color') or bm.loops.layers.color.get('Color')
    if col is None:
        print('no colour layer', car)
        continue

    def fc(f):
        return mw @ f.calc_center_median()

    def nrm(f):
        return (mw.to_3x3() @ f.normal).normalized()

    def side_between(y0, y1):
        return lambda f: abs(nrm(f).x) > 0.55 and sill - 0.02 < fc(f).z < belt + 0.02 and y0 < fc(f).y < y1

    n = 0
    # door edges (vertical cuts across the side)
    front_edge = fa + r + 0.22
    rear_edge = ra - r - 0.18 if doors == 4 else fa + wb * 0.62
    cuts = [front_edge, rear_edge] + ([cy + (front_edge + rear_edge - 2 * cy) / 2 + 0.05] if doors == 4 else [])
    loc = lambda p: mwi @ p
    for y in cuts:
        co = mwi @ Vector((0, y, 0))
        no = (mwi.to_3x3() @ Vector((0, 1, 0))).normalized()
        n += seam(bm, col, side_between(y - 0.15, y + 0.15), co, no)
    # door bottoms along the sill
    co = mwi @ Vector((0, 0, sill))
    no = (mwi.to_3x3() @ Vector((0, 0, 1))).normalized()
    n += seam(bm, col, lambda f: abs(nrm(f).x) > 0.55 and abs(fc(f).z - sill) < 0.12 and front_edge < fc(f).y < rear_edge, co, no)
    # bonnet back edge and boot lid front edge across the top
    for y, ok in ((glo.y - 0.04, lambda f: nrm(f).z > 0.45 and abs(fc(f).y - (glo.y - 0.04)) < 0.2 and abs(fc(f).x) < (hi.x - lo.x) * 0.45),
                  (ghi.y + 0.04, lambda f: nrm(f).z > 0.45 and abs(fc(f).y - (ghi.y + 0.04)) < 0.2 and abs(fc(f).x) < (hi.x - lo.x) * 0.45)):
        if car in ('suv', 'gwagon', 'policeSuv', 'pickup') and y > cy:
            continue  # hatchbacks / beds: no boot lid seam there
        co = mwi @ Vector((0, y, 0))
        no = (mwi.to_3x3() @ Vector((0, 1, 0))).normalized()
        n += seam(bm, col, ok, co, no)
    bm.to_mesh(body.data)
    bm.free()
    total += n
    print(f'seams {car}: {n} corners darkened, belt {belt:.2f} sill {sill:.2f}')

bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_vertex_color='ACTIVE', export_texcoords=True,
                          export_apply=False, export_materials='EXPORT', export_yup=True)
print('exported', DST, 'total', total)
