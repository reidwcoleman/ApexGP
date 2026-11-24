"""Blender: the sleeves and gloves the player sees on their own arms. Built from the avatar's own arms and hands (so the
skeleton, the weights and every pose the game puts them in still fit): the mesh is rounded, the cloth and the glove are
pushed out from it with their folds and mouldings, and colour, normal and roughness are baked for it at 2K.
  node tools/lastframe/dumparms.mjs PORT assets-src/lf/arms/body.json        (once: the avatar as the game holds it)
  blender -b --python tools/lastframe/arms.py -- assets-src/lf/arms public/lastframe [size]
Writes arms.bin + arms.json (the mesh) and arms_c / arms_n / arms_orm .png (turned into .webp by the caller).
"""
import bpy, bmesh, sys, os, json, math, struct, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import armtex

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
SIZE = int(argv[2]) if len(argv) > 2 else 2048
t0 = time.time()
log = lambda *a: print(f'[arms {time.time() - t0:5.1f}s]', *a, flush=True)

D = json.load(open(os.path.join(SRC, 'body.json')))
bones = D['bones']
P = np.array(D['position'], np.float64).reshape(-1, 3)
part = np.array(D['part'])
idx = np.array(D['index'], np.int64).reshape(-1, 3)
SI = np.array(D['skinIndex'], np.int64).reshape(-1, 4)
SW = np.array(D['skinWeight'], np.float64).reshape(-1, 4)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---- the arms and hands alone
keep = np.isin(part, (3, 4, 5))
tris = idx[keep[idx].all(1)]
used = np.unique(tris)
remap = -np.ones(len(P), np.int64)
remap[used] = np.arange(len(used))
me = bpy.data.meshes.new('arms')
me.from_pydata([tuple(v) for v in P[used]], [], [tuple(int(remap[i]) for i in t) for t in tris])
me.update()
ob = bpy.data.objects.new('arms', me)
scene.collection.objects.link(ob)
bpy.context.view_layer.objects.active = ob
ob.select_set(True)
groups = {}
for vi, src in enumerate(used):
    for k in range(4):
        w = SW[src, k]
        if w <= 0:
            continue
        name = bones[SI[src, k]]['name']
        g = groups.get(name) or ob.vertex_groups.new(name=name)
        groups[name] = g
        g.add([vi], float(w), 'ADD')
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
R = armtex.Rig(bones)
END = R.sleeve_end

def along(co):
    """metres down the arm, for a point on either side"""
    q = np.array([[abs(co[0]), co[1], co[2]]])
    return float(R.arm(q)[0][0])

# ---- The avatar wears a shirt: its sleeve ends in a cuff, closed off by a ring of faces that run in to the wrist, and
# the hand carries on from there. Take the ring out and the two come apart: the sleeve, open at the cuff, and the hand
# with its wrist, which becomes the glove
bm = bmesh.new()
bm.from_mesh(me)
bm.normal_update()
va = {v.index: along(v.co) for v in bm.verts}
# (the sleeve's own surface stops at the cuff's edge; the ring and the wrist inside the cuff lie in the three centimetres
# past it, and the hand proper starts beyond those)
cap = [f for f in bm.faces if any(END + 0.0005 < va[v.index] < END + 0.03 for v in f.verts)]
bmesh.ops.delete(bm, geom=cap, context='FACES')
bm.to_mesh(me)
bm.free()
log('arms', len(me.vertices), 'verts', len(me.polygons), 'faces;', len(cap), 'faces of the cuffs\' ends taken out')
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.tris_convert_to_quads(face_threshold=math.radians(60), shape_threshold=math.radians(60))
bpy.ops.object.mode_set(mode='OBJECT')
sub = ob.modifiers.new('round', 'SUBSURF')
sub.levels = 2
sub.subdivision_type = 'CATMULL_CLARK'
bpy.ops.object.modifier_apply(modifier='round')
me = ob.data
log('rounded', len(me.vertices), 'verts', len(me.polygons), 'faces')

bm = bmesh.new()
bm.from_mesh(me)
gl = bm.verts.layers.float.new('glove')
hm = bm.verts.layers.float.new('hem')
bm.verts.ensure_lookup_table()
# which piece each vertex is in: the one that reaches the fingers is the glove
seen = {}
for v0 in bm.verts:
    if v0.index in seen:
        continue
    stack, piece = [v0], []
    seen[v0.index] = True
    while stack:
        v = stack.pop()
        piece.append(v)
        for e in v.link_edges:
            w = e.other_vert(v)
            if w.index not in seen:
                seen[w.index] = True
                stack.append(w)
    reach = max(along(v.co) for v in piece[::7])
    if reach > R.L1 + R.L2 + 0.03:
        for v in piece:
            v[gl] = 1.0
sleeve = [v for v in bm.verts if v[gl] < 0.5]
log('pieces:', len(sleeve), 'sleeve verts,', len(bm.verts) - len(sleeve), 'glove verts')
# the sleeve carries the folds: a finer mesh for it
bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if e.verts[0][gl] < 0.5], cuts=1, use_grid_fill=True)
# its cuff is drawn in: a work shirt's hangs open like a bell, a jacket's is done up over the glove
for v in bm.verts:
    if v[gl] > 0.5:
        continue
    sx = 1.0 if v.co.x > 0 else -1.0
    c = np.array([v.co.x * sx, v.co.y, v.co.z])
    a = float(R.arm(c[None])[0][0])
    k = armtex.sstep(END - 0.085, END - 0.012, np.array([a]))[0]
    if k > 0:
        ax = R.E + R.d2 * (a - R.L1)
        c = ax + (c - ax) * (1 - 0.27 * k)
        v.co = (c[0] * sx, c[1], c[2])
# the glove's own cuff: on up the arm from where the wrist was cut, under the sleeve
for sx in (1.0, -1.0):
    loop = [e for e in bm.edges if e.is_boundary and e.verts[0][gl] > 0.5 and e.verts[0].co.x * sx > 0]
    if not loop:
        continue
    centre = np.mean([np.array(e.verts[0].co[:]) for e in loop], 0)
    no = R.d2 * np.array([sx, 1, 1])
    # (two steps: in to the thickness of a wrist, then straight on up the arm)
    for scale, back in ((0.8, 0.03), (0.9, 0.045)):
        geom = bmesh.ops.extrude_edge_only(bm, edges=loop)['geom']
        new = [g for g in geom if isinstance(g, bmesh.types.BMVert)]
        loop = [g for g in geom if isinstance(g, bmesh.types.BMEdge)]
        for v in new:
            c = np.array(v.co[:])
            v.co = tuple(centre + (c - centre) * scale - no * back)
            v[gl] = 1.0
        centre = centre - no * back
for f in bm.faces:
    f.smooth = True
bm.normal_update()
bm.to_mesh(me)
bm.free()
me.update()
log('sleeve and glove:', len(me.vertices), 'verts')

# ---- its own picture: islands laid out by where the surface faces
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0.006, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bpy.ops.object.mode_set(mode='OBJECT')
for p in me.polygons:
    p.use_smooth = True

# ---- baking
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 1
scene.render.bake.margin = 0
scene.render.bake.use_clear = True

def image(name, fill=(0, 0, 0, 0)):
    im = bpy.data.images.new(name, SIZE, SIZE, alpha=True, float_buffer=True)
    im.colorspace_settings.name = 'Non-Color'
    im.generated_color = fill
    return im

def material(kind):
    m = bpy.data.materials.new(kind)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tex = nt.nodes.new('ShaderNodeTexImage')
    nt.nodes.active = tex
    if kind == 'pos':
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(geo.outputs['Position'], em.inputs['Color'])
        nt.links.new(em.outputs[0], out.inputs[0])
    elif kind == 'glove':
        at = nt.nodes.new('ShaderNodeAttribute')
        at.attribute_name = 'glove'
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(at.outputs['Fac'], em.inputs['Color'])
        nt.links.new(em.outputs[0], out.inputs[0])
    else:
        bs = nt.nodes.new('ShaderNodeBsdfDiffuse')
        nt.links.new(bs.outputs[0], out.inputs[0])
    return m, tex

def pixels(im):
    a = np.empty(SIZE * SIZE * 4, np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(SIZE, SIZE, 4)

def bake(kind, im, tex, **kw):
    tex.image = im
    bpy.ops.object.bake(type=kind, **kw)
    return pixels(im)

mpos, tpos = material('pos')
mdif, tdif = material('dif')
ob.data.materials.append(mpos)
# where every texel is on the arm as the avatar came (negative x is a real place: the picture is cleared to a marker)
im = image('P', (0, 0, 0, 0))
Pm = bake('EMIT', im, tpos)
# (a texel nothing was baked into is left clear: no point of the arms is at the origin)
cover = (np.abs(Pm[..., :3]).sum(2) > 1e-6)
mgl, tgl = material('glove')
ob.data.materials[0] = mgl
Gm = bake('EMIT', image('G', (0, 0, 0, 0)), tgl)[..., 0] > 0.5
log('position baked,', int(cover.sum()), 'texels covered of', SIZE * SIZE)

# ---- the cloth and the glove, as shape: out along the normal by what armtex says
V = np.array([v.co[:] for v in me.vertices], np.float64)
VN = np.array([v.normal[:] for v in me.vertices], np.float64)
vglove = np.array([d.value for d in me.attributes['glove'].data]) > 0.5
vhem = np.array([d.value for d in me.attributes['hem'].data]) > 0.5
off = armtex.vertex_offset(bones, V, VN, vglove, vhem)
for v, o, nrm in zip(me.vertices, off, VN):
    v.co = v.co + type(v.co)(nrm) * float(o)
me.update()
log('pushed out: mean %.1f mm, most %.1f mm' % (off.mean() * 1000, off.max() * 1000))
if '--debug' in argv:
    # which is which, from where the cuff is looked at: glove red, sleeve blue; faces turned away are dark
    m = bpy.data.materials.new('dbg'); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial'); em = nt.nodes.new('ShaderNodeEmission')
    a1 = nt.nodes.new('ShaderNodeAttribute'); a1.attribute_name = 'glove'
    a2 = nt.nodes.new('ShaderNodeAttribute'); a2.attribute_name = 'hem'
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    cmb = nt.nodes.new('ShaderNodeCombineColor')
    nt.links.new(a1.outputs['Fac'], cmb.inputs[0]); nt.links.new(a2.outputs['Fac'], cmb.inputs[1]); cmb.inputs[2].default_value = 0.6
    mul = nt.nodes.new('ShaderNodeMixRGB'); mul.blend_type = 'MULTIPLY'; mul.inputs['Color2'].default_value = (0.15, 0.15, 0.15, 1)
    nt.links.new(geo.outputs['Backfacing'], mul.inputs['Fac']); nt.links.new(cmb.outputs[0], mul.inputs['Color1'])
    nt.links.new(mul.outputs[0], em.inputs['Color']); nt.links.new(em.outputs[0], o.inputs[0])
    ob.data.materials[0] = m
    if '--nosleeve' in argv or '--noglove' in argv:
        bmd = bmesh.new(); bmd.from_mesh(me)
        lg = bmd.verts.layers.float['glove']
        kill = [v for v in bmd.verts if (v[lg] > 0.5) == ('--noglove' in argv)]
        bmesh.ops.delete(bmd, geom=kill, context='VERTS')
        bmd.to_mesh(me); bmd.free()
    scene.cycles.samples = 4
    scene.render.resolution_x, scene.render.resolution_y = 1000, 660
    from mathutils import Vector
    cam = bpy.data.cameras.new('c'); cam.lens = 70
    co = bpy.data.objects.new('c', cam); scene.collection.objects.link(co); scene.camera = co
    eye, at = (0.86, 1.2, 0.42), (0.57, 1.07, 0.07)
    co.location = eye
    co.rotation_euler = (Vector(at) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(SRC, 'look_dbg.png')
    bpy.ops.render.render(write_still=True)
    sys.exit(0)

ob.data.materials[0] = mdif
scene.cycles.samples = 48 if SIZE >= 2048 else 12
Nm = bake('NORMAL', image('N', (0.5, 0.5, 1, 1)), tdif, normal_space='OBJECT')[..., :3] * 2 - 1
log('normals baked')
# occlusion from itself only: what the fingers shade of each other, the cuff of the wrist
scene.world = bpy.data.worlds.new('w')
AOm = bake('AO', image('AO', (1, 1, 1, 1)), tdif)[..., 0]
log('occlusion baked')
np.savez_compressed(os.path.join(SRC, 'bake.npz'), P=Pm[..., :3], N=Nm, AO=AOm, cover=cover, G=Gm)

def write_png(path, rgba):
    # bottom row first, 0..1, already in the numbers the file should hold
    h, w = rgba.shape[:2]
    im = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    im.colorspace_settings.name = 'Non-Color'
    im.alpha_mode = 'STRAIGHT'
    im.pixels.foreach_set(np.clip(rgba, 0, 1).astype(np.float32).ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)

tex = armtex.synth(bones, Pm[..., :3], Nm, AOm, cover, Gm, log)
armtex.save(SRC, tex, cover, write_png)
log('textures written')

# ---- the mesh, as the game wants it: a vertex for every corner that has its own place in the picture
me.calc_loop_triangles()
uvl = me.uv_layers.active.data
names = sorted(groups)
gi = {ob.vertex_groups[n].index: names.index(n) for n in names}
key, verts = {}, []
out_idx = []
for t in me.loop_triangles:
    for li in t.loops:
        vi = me.loops[li].vertex_index
        uv = uvl[li].uv
        k = (vi, round(uv[0], 6), round(uv[1], 6))
        j = key.get(k)
        if j is None:
            j = key[k] = len(verts)
            verts.append((vi, uv[0], uv[1]))
        out_idx.append(j)
n = len(verts)
pos = np.zeros((n, 3), np.float32); nor = np.zeros((n, 3), np.float32); uvs = np.zeros((n, 2), np.float32)
si = np.zeros((n, 4), np.uint8); sw = np.zeros((n, 4), np.float32)
for j, (vi, u, v) in enumerate(verts):
    mv = me.vertices[vi]
    pos[j] = mv.co[:]; nor[j] = mv.normal[:]; uvs[j] = (u, v)
    ws = sorted(((g.weight, gi[g.group]) for g in mv.groups if g.group in gi), reverse=True)[:4]
    tot = sum(w for w, _ in ws) or 1.0
    for k, (w, b) in enumerate(ws):
        si[j, k] = b; sw[j, k] = w / tot
ix = np.array(out_idx, np.uint32)
with open(os.path.join(OUT, 'arms.bin'), 'wb') as f:
    for a in (pos, nor, uvs, sw, ix, si):
        f.write(a.tobytes())
json.dump({'verts': n, 'tris': len(ix) // 3, 'bones': names, 'order': ['position f32x3', 'normal f32x3', 'uv f32x2', 'skinWeight f32x4', 'index u32', 'skinIndex u8x4']}, open(os.path.join(OUT, 'arms.json'), 'w'))
log('mesh written:', n, 'verts', len(ix) // 3, 'tris,', len(names), 'bones')

# ---- a look at it, lit plainly, before it goes anywhere near the game
if '--look' in argv:
    def tex_node(nt, path, cs):
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(path)
        t.image.colorspace_settings.name = cs
        return t
    m = bpy.data.materials.new('look'); m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes['Principled BSDF']
    c = tex_node(nt, os.path.join(SRC, 'arms_c.png'), 'sRGB')
    nrm = tex_node(nt, os.path.join(SRC, 'arms_n.png'), 'Non-Color')
    orm = tex_node(nt, os.path.join(SRC, 'arms_orm.png'), 'Non-Color')
    # cloth is baked a mid grey: the side's dye goes over it, twice as strong; the glove keeps its own colours
    dye = nt.nodes.new('ShaderNodeMixRGB'); dye.blend_type = 'MULTIPLY'
    dye.inputs['Color2'].default_value = (0.26, 0.29, 0.40, 1)
    nt.links.new(c.outputs['Alpha'], dye.inputs['Fac'])
    nt.links.new(c.outputs['Color'], dye.inputs['Color1'])
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(orm.outputs['Color'], sep.inputs[0])
    aom = nt.nodes.new('ShaderNodeMixRGB'); aom.blend_type = 'MULTIPLY'; aom.inputs['Fac'].default_value = 1
    nt.links.new(dye.outputs[0], aom.inputs['Color1'])
    nt.links.new(sep.outputs[0], aom.inputs['Color2'])
    nt.links.new(aom.outputs[0], bs.inputs['Base Color'])
    nt.links.new(sep.outputs[1], bs.inputs['Roughness'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nrm.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs[0], bs.inputs['Normal'])
    ob.data.materials[0] = m
    scene.cycles.samples = 20
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1300, 860
    w = scene.world; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.22, 0.23, 0.25, 1)
    def lamp(loc, energy, size=0.6):
        l = bpy.data.lights.new('l', 'AREA'); l.energy = energy; l.size = size
        o = bpy.data.objects.new('l', l); o.location = loc; scene.collection.objects.link(o)
        d = np.array([0.6, 1.0, 0.1]) - np.array(loc)
        o.rotation_euler = (-np.array([0, 0, 0])).tolist()
        from mathutils import Vector
        o.rotation_euler = Vector(d).to_track_quat('-Z', 'Y').to_euler()
    lamp((1.1, 1.7, 0.9), 60)
    lamp((0.2, 0.6, 0.8), 14, 1.0)
    cam = bpy.data.cameras.new('c'); cam.lens = 70
    co = bpy.data.objects.new('c', cam); scene.collection.objects.link(co); scene.camera = co
    from mathutils import Vector
    views = {'back': ((1.1, 1.08, 0.48), (0.6, 1.0, 0.09)), 'sleeve': ((0.95, 1.6, 0.8), (0.47, 1.2, 0.0)), 'cuff': ((0.86, 1.2, 0.42), (0.57, 1.07, 0.07))}
    if '--palm' in argv:
        views['palm'] = ((0.2, 0.95, 0.45), (0.62, 0.99, 0.1))
    for name, (eye, at) in views.items():
        co.location = eye
        co.rotation_euler = (Vector(at) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(SRC, f'look_{name}.png')
        bpy.ops.render.render(write_still=True)
    log('looks rendered')
