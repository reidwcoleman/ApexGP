"""Export downtown for the browser.
blender -b work/downtown_baked.blend (or work/downtown.blend, unbaked) -P downtown/export_dt.py
 -> public/oceandrive/downtown.glb            (meshopt, GPU instances, vertex colours, UV0 metres, UV1 lightmap)
 -> public/oceandrive/height_dt*.bin.gz       (walk/drive heightmaps: the streets, the bridge)
 -> public/oceandrive/downtown_scene.json     (lightmap manifest, the height layers)"""
import bpy, os, sys, json, math, struct, gzip, time
import numpy as np
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
OD = os.path.dirname(HERE)
sys.path.insert(0, OD)
ROOT = os.path.abspath(os.path.join(OD, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'oceandrive')
WORK = os.path.join(OD, 'work')
sc = bpy.context.scene
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TILE = argv[argv.index('--tile') + 1] if '--tile' in argv else 'dt'
D = json.load(open(os.path.join(WORK, 'dt.json' if TILE == 'dt' else f'tile_{TILE}.json')))
# the skyline lives in its own file now (downtown's first build carried it)
for o in list(bpy.data.objects):
    if o.name.startswith(('dt_sky', 'dt_beachsky', 'dt_land', 'dt_bay', 'dt_far')):
        bpy.data.objects.remove(o)
SEA = -1.5

# ------------------------------------------------------------------ heightmaps
# the ground under you is what a ray from 4 m finds (so the Metromover, the canopies and the balconies
# overhead don't count); where it finds nothing you're inside a building: its roof (the walls block)
OVER = [o for o in bpy.data.objects if o.type == 'MESH' and (o.name.endswith(('_mover', '_poles', '_balcony', '_rail', '_piers')) or o.name.startswith(('palm', 'lamp')) or (o.users_collection and o.users_collection[0].name in ('PALMS', 'PROPS', 'TEMPLATES')))]
for o in OVER:
    o.hide_viewport = True
dg = bpy.context.evaluated_depsgraph_get()
blockers = []
for o in bpy.data.objects:
    if o.users_collection and o.users_collection[0].name == 'PALMS':
        blockers.append((o.location.x, o.location.y, 0.36))
    elif o.users_collection and o.users_collection[0].name == 'PROPS':
        blockers.append((o.location.x, o.location.y, 0.2))
for x, y in D['mover_cols']:
    blockers.append((x, y, 0.85))


def layer(name, X0, X1, Y0, Y1, RES):
    nx, ny = int((X1 - X0) / RES), int((Y1 - Y0) / RES)
    H = np.full((ny, nx), SEA - 3, np.float32)
    B = np.zeros((ny, nx), np.uint8)
    t0 = time.time()
    down = Vector((0, 0, -1))
    for j in range(ny):
        y = Y0 + (j + 0.5) * RES
        for i in range(nx):
            x = X0 + (i + 0.5) * RES
            hit, loc, *_ = sc.ray_cast(dg, Vector((x, y, 4.0)), down, distance=12)
            if hit:
                H[j, i] = loc.z
                continue
            hit, loc, *_ = sc.ray_cast(dg, Vector((x, y, 400.0)), down, distance=420)
            if hit and loc.z > 0.5:
                H[j, i] = loc.z
            elif hit:
                H[j, i] = loc.z
    for (bx, by, r) in blockers:
        for j in range(int((by - r - Y0) / RES), int((by + r - Y0) / RES) + 1):
            for i in range(int((bx - r - X0) / RES), int((bx + r - X0) / RES) + 1):
                if 0 <= i < nx and 0 <= j < ny and (X0 + (i + .5) * RES - bx) ** 2 + (Y0 + (j + .5) * RES - by) ** 2 < r * r:
                    B[j, i] = 1
    hq = np.clip(np.round((H + 10.0) * 100.0), 0, 65535).astype(np.uint16)
    raw = struct.pack('<4sIIffff', b'ODH1', nx, ny, X0, Y0, RES, -10.0) + hq.tobytes() + B.tobytes()
    fn = f'height_{name}.bin.gz'
    with gzip.open(os.path.join(OUT, fn), 'wb', compresslevel=9) as f:
        f.write(raw)
    print('heightmap', name, nx, ny, round(time.time() - t0, 1), 's', os.path.getsize(os.path.join(OUT, fn)) // 1024, 'KB', flush=True)
    return dict(file=fn, x0=X0, y0=Y0, res=RES, nx=nx, ny=ny)


cx = [p[0] for p in D['core']]
cy = [p[1] for p in D['core']]
layers = [layer(TILE, math.floor(min(cx)) - 2, math.ceil(max(cx)) + 2, math.floor(min(cy)) - 2, math.ceil(max(cy)) + 2, 0.5)]
if D.get('bridge'):
    layers.append(layer('br', -790.0, -262.0, -150.0, -20.0, 0.5))
for o in OVER:
    o.hide_viewport = False

# ------------------------------------------------------------------ props to game budgets, templates out
for mname, ratio in {'ph_lamp': 0.12}.items():
    me = bpy.data.meshes.get(mname)
    if not me:
        continue
    users = [o for o in bpy.data.objects if o.data == me]
    tmp = bpy.data.objects.new('tmp_dec', me)
    sc.collection.objects.link(tmp)
    mod = tmp.modifiers.new('dec', 'DECIMATE')
    mod.ratio = ratio
    new = bpy.data.meshes.new_from_object(tmp.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    new.name = mname + '_lod'
    for o in users:
        o.data = new
    bpy.data.objects.remove(tmp)
tpl = bpy.data.collections.get('TEMPLATES')
for o in list(tpl.objects) if tpl else []:
    bpy.data.objects.remove(o)
for o in list(bpy.data.objects):
    if o.type in ('CAMERA', 'EMPTY', 'LIGHT'):
        bpy.data.objects.remove(o)
for o in bpy.data.objects:
    o.hide_render = False
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

# ------------------------------------------------------------------ glTF
GLB = 'downtown.glb' if TILE == 'dt' else f'tile_{TILE}.glb'
for o in bpy.data.objects:
    o.select_set(False)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, GLB), export_format='GLB', use_visible=False, use_renderable=False,
    export_apply=True, export_texcoords=True, export_normals=True, export_vertex_color='ACTIVE',
    export_all_vertex_colors=False, export_materials='EXPORT', export_image_format='WEBP', export_image_quality=82,
    export_gpu_instances=True, export_yup=True, export_lights=False, export_cameras=False,
    export_meshopt_compression_enable=True)
print('glb', os.path.getsize(os.path.join(OUT, GLB)) / 1e6, 'MB')
lmf = os.path.join(WORK, f'lightmaps_{TILE}.json')
baked = bpy.data.filepath.endswith('_baked.blend')
lm = json.load(open(lmf)) if (baked and os.path.exists(lmf)) else {}
json.dump(dict(lightmaps=lm, layers=layers, core=D['core']), open(os.path.join(OUT, 'downtown_scene.json' if TILE == 'dt' else f'tile_{TILE}_scene.json'), 'w'), indent=1)
print('done')
