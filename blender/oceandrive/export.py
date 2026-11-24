"""Export the baked block for the browser.
blender -b work/oceandrive_baked.blend -P export.py
 -> public/oceandrive/block.glb      (meshopt, GPU instances, vertex colours, UV0 metres + UV1 lightmap)
 -> public/oceandrive/height.bin     (walk heightmap + blocked mask, see HEADER below)
 -> public/oceandrive/scene.json     (lightmap manifest, sun, palm trunks, spawn points)
Props are decimated to game budgets here and the scanned sea grape is swapped for card bushes."""
import bpy, bmesh, os, sys, json, math, random, struct
import numpy as np
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lib, ground, hotels
from lib import MB, WHITE, hexcol
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'oceandrive')
os.makedirs(OUT, exist_ok=True)
WORK = os.path.join(HERE, 'work')
lib.GEN = os.path.join(HERE, 'assets', 'gen')
rng = random.Random(5)

# ------------------------------------------------------------------ decimate the scanned props (shared mesh data)
BUDGET = {'ph_bistro': 0.3, 'ph_lamp': 0.12, 'ph_hydrant': 0.04, 'ph_aircon': 0.08, 'ph_shrub': 0.12, 'ph_shrub2': 0.12,
          'ph_trash': 0.3, 'ph_bench': 0.4}
dg = bpy.context.evaluated_depsgraph_get()
for mname, ratio in BUDGET.items():
    me = bpy.data.meshes.get(mname)
    if not me:
        continue
    users = [o for o in bpy.data.objects if o.data == me]
    tmp = bpy.data.objects.new('tmp_dec', me)
    bpy.context.scene.collection.objects.link(tmp)
    mod = tmp.modifiers.new('dec', 'DECIMATE')
    mod.ratio = ratio
    dg = bpy.context.evaluated_depsgraph_get()
    new = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    new.name = mname + '_lod'
    for o in users:
        o.data = new
    bpy.data.objects.remove(tmp)
    print('decimated', mname, len(me.polygons), '->', len(new.polygons))

# ------------------------------------------------------------------ volleyball nets: drawn in the browser
# (cords a few mm thick don't survive quantization: take them out here, the page draws the net)
import geo
NETS = []
for w in geo.WAYS:
    t = w['tags']
    if t.get('leisure') == 'pitch' and t.get('surface') == 'sand':
        q = geo.way_local(w)
        if len(q) >= 4 and ground.NEAR[2] < q[0][1] < ground.NEAR[3] and q[0][0] < 100:
            q = q[:4]
            cx = sum(p[0] for p in q) / 4; cy = sum(p[1] for p in q) / 4
            NETS.append((cx, cy, ground.terrain_h(cx, cy), math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0])))
ps = bpy.data.objects.get('props_static')
if ps and NETS:
    bm = bmesh.new()
    bm.from_mesh(ps.data)
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        for (x, y, z, rot) in NETS:
            cs, sn = math.cos(rot), math.sin(rot)
            dx, dy = c.x - x, c.y - y
            across = dx * cs + dy * sn
            along = -dx * sn + dy * cs
            if abs(across) < 0.03 and abs(along) < 4.95 and z + 1.5 < c.z < z + 2.5:
                kill.append(f)
                break
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(ps.data)
    bm.free()
    print('nets: removed', len(kill), 'faces')

# ------------------------------------------------------------------ sea grape: card bushes
def bush(name, r, h, n):
    mb = MB(name)
    for k in range(n):
        # a point on a squashed dome, the card facing outward
        u, v = rng.uniform(0, 6.283), rng.uniform(0.05, 1.0) ** 0.7
        c = Vector((math.cos(u) * r * math.sin(v * 1.4), math.sin(u) * r * math.sin(v * 1.4), h * 0.35 + h * 0.65 * math.cos(v * 1.4)))
        nrm = Vector((c.x / r, c.y / r, (c.z - h * 0.2) / h)).normalized()
        nrm = (nrm + Vector((rng.uniform(-.3, .3), rng.uniform(-.3, .3), rng.uniform(-.1, .3)))).normalized()
        t = nrm.orthogonal().normalized()
        b = nrm.cross(t)
        s = rng.uniform(0.75, 1.15)
        q = [c + (t * sx + b * sy) * s * 0.6 for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        mb.face(q, 'od_bush', WHITE, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], n=nrm)
    # a few stems
    for k in range(4):
        a = rng.uniform(0, 6.283)
        mb.cyl((0, 0, 0), 0.05, 0.03, h * 0.6, 5, 'od_bark', hexcol('#6a5a48'), axis=(math.cos(a) * 0.6, math.sin(a) * 0.6, 1))
    return mb.build(weld=False)
lib.MATS['od_bush'] = dict(col=(0.25, 0.33, 0.15), rough=0.7, alpha='seagrape.png')
bushes = [bush(f'bush_{i}', rr, hh, nn) for i, (rr, hh, nn) in enumerate(((2.1, 2.0, 42), (1.6, 1.5, 30), (2.6, 2.4, 55)))]
for bo in bushes:
    for c in list(bo.users_collection):
        c.objects.unlink(bo)
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.data.name.startswith(('ph_seagrape', 'ph_seagrape2')):
        o.data = rng.choice(bushes).data
        s = o.scale.x
        o.scale = (s * 1.25, s * 1.25, s * 1.1)

# ------------------------------------------------------------------ remove templates and helpers
tpl = bpy.data.collections.get('TEMPLATES')
for o in list(tpl.objects) if tpl else []:
    bpy.data.objects.remove(o)
for o in list(bpy.data.objects):
    if o.type in ('CAMERA', 'EMPTY'):
        bpy.data.objects.remove(o)
for o in bpy.data.objects:
    o.hide_render = False
    try:
        o.hide_set(False)
    except Exception:
        pass

# ------------------------------------------------------------------ heightmap (walkable ground + what blocks)
HX0, HX1, HY0, HY1, RES = -62.0, 282.0, -104.0, 104.0, 0.25
nx, ny = int((HX1 - HX0) / RES), int((HY1 - HY0) / RES)
sc = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()
skip = set()
blockers = set()
for o in bpy.data.objects:
    n = o.name
    if n.startswith(('palm', 'seagrape', 'shrub', 'bush', 'sea', 'horizon', 'sign_', 'gl_')) or o.type != 'MESH':
        skip.add(n)
    elif o.users_collection and o.users_collection[0].name in ('PROPS',) or n == 'props_static':
        blockers.add(n)
for n in skip:
    bpy.data.objects[n].hide_viewport = True
dg = bpy.context.evaluated_depsgraph_get()
H = np.zeros((ny, nx), np.float32)
B = np.zeros((ny, nx), np.uint8)
for j in range(ny):
    y = HY0 + (j + 0.5) * RES
    for i in range(nx):
        x = HX0 + (i + 0.5) * RES
        hit, loc, nrm, idx, ob, mat = sc.ray_cast(dg, Vector((x, y, 80.0)), Vector((0, 0, -1)), distance=200)
        if hit:
            H[j, i] = loc.z
            if ob.name in blockers or (ob.parent and ob.parent.name in blockers):
                # props stand on the ground: find it below them
                B[j, i] = 1
                h2, l2, *_ = sc.ray_cast(dg, loc - Vector((0, 0, 0.05)), Vector((0, 0, -1)), distance=10)
                k = 0
                while h2 and k < 6:
                    _, _, _, _, o2, _ = sc.ray_cast(dg, l2 + Vector((0, 0, 0.001)), Vector((0, 0, -1)), distance=0.01)
                    H[j, i] = l2.z
                    if not (o2 and (o2.name in blockers)):
                        break
                    h2, l2, *_ = sc.ray_cast(dg, l2 - Vector((0, 0, 0.05)), Vector((0, 0, -1)), distance=10)
                    k += 1
        else:
            H[j, i] = ground.SEA - 3
for n in skip:
    bpy.data.objects[n].hide_viewport = False
# palm trunks block (a disc at the base)
palms = []
for o in bpy.data.objects:
    if o.name.startswith('palm') and o.type == 'MESH' and o.users_collection and o.users_collection[0].name == 'PALMS':
        x, y = o.location.x, o.location.y
        palms.append([round(x, 2), round(y, 2), round(o.location.z, 2), round(o.rotation_euler.z, 3), round(o.scale.x, 3), o.data.name])
        r = 0.38
        for j in range(int((y - r - HY0) / RES), int((y + r - HY0) / RES) + 1):
            for i in range(int((x - r - HX0) / RES), int((x + r - HX0) / RES) + 1):
                if 0 <= i < nx and 0 <= j < ny and (HX0 + (i + .5) * RES - x) ** 2 + (HY0 + (j + .5) * RES - y) ** 2 < r * r:
                    B[j, i] = 1
hq = np.clip(np.round((H + 10.0) * 100.0), 0, 65535).astype(np.uint16)
with open(os.path.join(OUT, 'height.bin'), 'wb') as f:
    f.write(struct.pack('<4sIIffff', b'ODH1', nx, ny, HX0, HY0, RES, -10.0))
    f.write(hq.tobytes())
    f.write(B.tobytes())
print('heightmap', nx, ny)

# the whole city at 50 cm (streets, sidewalks, every footprint): walking and driving anywhere you can
# get to by car, beyond the detailed map above
FX0, FX1, FY0, FY1, FRES = ground.CITY_X0, 300.0, ground.CITY_Y0, ground.CITY_Y1, 0.5
fnx, fny = int((FX1 - FX0) / FRES), int((FY1 - FY0) / FRES)
for n in skip:
    bpy.data.objects[n].hide_viewport = True
dg = bpy.context.evaluated_depsgraph_get()
FH = np.full((fny, fnx), ground.SEA - 3, np.float32)
FB = np.zeros((fny, fnx), np.uint8)
for j in range(fny):
    y = FY0 + (j + 0.5) * FRES
    for i in range(fnx):
        x = FX0 + (i + 0.5) * FRES
        hit, loc, nrm, idx, ob, mat = sc.ray_cast(dg, Vector((x, y, 120.0)), Vector((0, 0, -1)), distance=260)
        if hit:
            FH[j, i] = loc.z
            if ob.name in blockers:
                FB[j, i] = 1
for n in skip:
    bpy.data.objects[n].hide_viewport = False
fq = np.clip(np.round((FH + 10.0) * 100.0), 0, 65535).astype(np.uint16)
with open(os.path.join(OUT, 'height_far.bin'), 'wb') as f:
    f.write(struct.pack('<4sIIffff', b'ODH1', fnx, fny, FX0, FY0, FRES, -10.0))
    f.write(fq.tobytes())
    f.write(FB.tobytes())
print('far heightmap', fnx, fny)

# ------------------------------------------------------------------ glTF
# the scanned props don't need alpha (their opacity maps would be merged into new images, which fails)
for m in bpy.data.materials:
    if m.name.startswith('od_') or not m.node_tree:
        continue
    for n in list(m.node_tree.nodes):
        if n.type == 'TEX_IMAGE' and n.image and 'opacity' in n.image.name.lower():
            m.node_tree.nodes.remove(n)
            continue
        if n.type == 'BSDF_PRINCIPLED' and n.inputs['Alpha'].links:
            for l in list(n.inputs['Alpha'].links):
                m.node_tree.links.remove(l)
            n.inputs['Alpha'].default_value = 1.0

for o in bpy.data.objects:
    o.select_set(False)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, 'block.glb'), export_format='GLB', use_visible=False, use_renderable=False,
    export_apply=True, export_texcoords=True, export_normals=True, export_vertex_color='ACTIVE',
    export_all_vertex_colors=False, export_materials='EXPORT', export_image_format='WEBP', export_image_quality=82,
    export_gpu_instances=True, export_yup=True, export_lights=False, export_cameras=False,
    export_meshopt_compression_enable=True)
print('glb', os.path.getsize(os.path.join(OUT, 'block.glb')) / 1e6, 'MB')

lm = json.load(open(os.path.join(WORK, 'lightmaps.json')))
sun = [o for o in bpy.data.objects if o.type == 'LIGHT']
meta = dict(lightmaps=lm, sea=ground.SEA, water_x=ground.WATER_X, sw=hotels.SW, palms=len(palms), nets=[[round(v, 3) for v in n] for n in NETS],
            height=dict(x0=HX0, y0=HY0, res=RES, nx=nx, ny=ny))
json.dump(meta, open(os.path.join(OUT, 'scene.json'), 'w'), indent=1)
print('done')
