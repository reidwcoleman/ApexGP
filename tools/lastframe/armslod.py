"""Blender: the made arms again on a tenth of the mesh, for everybody who is not the wearer. Same pictures, same bones.
  blender -b --python tools/lastframe/armslod.py -- public/lastframe [ratio]
Reads arms.bin / arms.json (see arms.py), writes arms_lo.bin / arms_lo.json in the same layout."""
import bpy, bmesh, sys, os, json
import numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
DIR = argv[0]
RATIO = float(argv[1]) if len(argv) > 1 else 0.1
meta = json.load(open(os.path.join(DIR, 'arms.json')))
buf = open(os.path.join(DIR, 'arms.bin'), 'rb').read()
n, t = meta['verts'], meta['tris'] * 3
o = 0
def take(dt, count):
    global o
    a = np.frombuffer(buf, dt, count, o); o += a.nbytes; return a
pos = take('<f4', n * 3).reshape(n, 3); nor = take('<f4', n * 3).reshape(n, 3); uv = take('<f4', n * 2).reshape(n, 2)
sw = take('<f4', n * 4).reshape(n, 4); idx = take('<u4', t).reshape(-1, 3); si = take('u1', n * 4).reshape(n, 4)
bpy.ops.wm.read_factory_settings(use_empty=True)
me = bpy.data.meshes.new('arms')
me.from_pydata([tuple(p) for p in pos], [], [tuple(int(i) for i in f) for f in idx])
me.update()
ul = me.uv_layers.new(name='uv')
for li, lp in enumerate(me.loops):
    ul.data[li].uv = tuple(uv[lp.vertex_index])
ob = bpy.data.objects.new('arms', me); bpy.context.scene.collection.objects.link(ob)
for b, name in enumerate(meta['bones']):
    ob.vertex_groups.new(name=name)
for v in range(n):
    for k in range(4):
        if sw[v, k] > 0:
            ob.vertex_groups[int(si[v, k])].add([v], float(sw[v, k]), 'ADD')
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
# the picture's seams were cut into the mesh on the way out: sewn up again, so nothing opens along them
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=1e-6); bpy.ops.object.mode_set(mode='OBJECT')
d = ob.modifiers.new('d', 'DECIMATE'); d.ratio = RATIO; d.delimit = {'UV'} if hasattr(d, 'delimit') else set()
bpy.ops.object.modifier_apply(modifier='d')
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.quads_convert_to_tris(); bpy.ops.object.mode_set(mode='OBJECT')
me = ob.data
for p in me.polygons: p.use_smooth = True
me.update()
ul = me.uv_layers['uv']
# one vertex for every (corner, uv) that differs
key = {}
P, N, U, W, I, tri = [], [], [], [], [], []
for poly in me.polygons:
    for li in poly.loop_indices:
        vi = me.loops[li].vertex_index
        u = ul.data[li].uv
        k = (vi, round(u[0], 5), round(u[1], 5))
        if k not in key:
            key[k] = len(P)
            v = me.vertices[vi]
            P.append(v.co[:]); N.append(v.normal[:]); U.append((u[0], u[1]))
            g = sorted(((gr.weight, gr.group) for gr in v.groups), reverse=True)[:4]
            s = sum(w for w, _ in g) or 1.0
            W.append([w / s for w, _ in g] + [0.0] * (4 - len(g)))
            I.append([gi for _, gi in g] + [0] * (4 - len(g)))
        tri.append(key[k])
out = os.path.join(DIR, 'arms_lo.bin')
with open(out, 'wb') as f:
    f.write(np.asarray(P, '<f4').tobytes()); f.write(np.asarray(N, '<f4').tobytes()); f.write(np.asarray(U, '<f4').tobytes())
    f.write(np.asarray(W, '<f4').tobytes()); f.write(np.asarray(tri, '<u4').tobytes()); f.write(np.asarray(I, 'u1').tobytes())
json.dump({'verts': len(P), 'tris': len(tri) // 3, 'bones': meta['bones']}, open(os.path.join(DIR, 'arms_lo.json'), 'w'))
print('ARMS LO', len(P), 'verts', len(tri) // 3, 'tris', os.path.getsize(out) // 1024, 'KB')
