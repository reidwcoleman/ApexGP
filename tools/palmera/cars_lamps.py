"""Give Palmera's car lamps their own coordinates (public/palmera/cars.glb, in place or to a new file).

Run: blender -b --python tools/palmera/cars_lamps.py -- <in.glb> <out.glb>

Every head and tail lamp mesh is split into its islands (one per lamp). Each island gets
  UVMap    (TEXCOORD_0): 0..1 across the lamp from its inner edge to its outer edge, and bottom to top
  LampSize (TEXCOORD_1): the lamp's width and height in metres (same for all its corners)
so the game's lamp shader can draw a lamp's insides at the right place and scale - a projector and a
daytime LED strip in a headlamp, a lit outline in a tail lamp - instead of a pattern tiled over it.
"""
import sys
import bpy
import bmesh

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

n_lamps = 0
for o in bpy.data.objects:
    if o.type != 'MESH' or not (o.name.endswith('_heads') or o.name.endswith('_tails')):
        continue
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    uv0 = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    uv1 = bm.loops.layers.uv.get('LampSize') or bm.loops.layers.uv.new('LampSize')
    mw = o.matrix_world
    seen = set()
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        # one island: faces linked through shared edges
        island, stack = [], [f0]
        seen.add(f0.index)
        while stack:
            f = stack.pop()
            island.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        pts = [(mw @ l.vert.co) for f in island for l in f.loops]
        # its face plane: across = |x| (inner -> outer, so left and right lamps match), up = z.
        # a lamp that faces sideways (wraps round the corner) uses the length (y) across instead.
        xs = [abs(p.x) for p in pts]
        ys = [p.y for p in pts]
        zs = [p.z for p in pts]
        side = (max(ys) - min(ys)) > 1.6 * (max(xs) - min(xs))
        a0, a1 = (min(ys), max(ys)) if side else (min(xs), max(xs))
        z0, z1 = min(zs), max(zs)
        w, h = max(1e-3, a1 - a0), max(1e-3, z1 - z0)
        for f in island:
            for l in f.loops:
                p = mw @ l.vert.co
                a = p.y if side else abs(p.x)
                u = (a - a0) / w
                if side and p.y < 0:
                    u = 1 - u  # rear lamps: inner (toward the car's middle) first
                l[uv0].uv = (u, (p.z - z0) / h)
                l[uv1].uv = (w, h)
        n_lamps += 1
    bm.to_mesh(me)
    bm.free()

bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_vertex_color='ACTIVE', export_texcoords=True,
                          export_apply=False, export_materials='EXPORT', export_yup=True)
print('lamps given coordinates:', n_lamps, '->', DST)
