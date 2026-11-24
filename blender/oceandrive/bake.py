"""Bake the indirect light of the block into lightmaps (Cycles, GPU).
blender -b work/oceandrive.blend -P bake.py [-- test]

For every lightmapped object: a second UV set ('lightmap', smart-projected + packed), then two diffuse
bakes with the surface colour left out (so the maps hold light, not albedo):
  A  sky only (the sun lamp hidden): direct + indirect skylight, i.e. sky occlusion and its bounces
  B  sun only (the sky black): indirect only, i.e. the sun's bounce light
The runtime draws the sun's direct light itself (with real-time shadows), so A + B is everything else.
Maps are stored as 8-bit gamma-encoded value/SCALE (manifest in work/lightmaps.json)."""
import bpy, os, sys, json, math, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'work')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TEST = 'test' in argv
# only=lm_a,lm_b: bake just these (the others keep work/<name>.png from the last bake; their UVs come out the same)
ONLY = next((a.split('=', 1)[1].split(',') for a in argv if a.startswith('only=')), None)
sc = bpy.context.scene
SIZES = {'lm_block': 4096, 'lm_gnear': 4096, 'lm_front2': 2048, 'lm_city': 2048, 'lm_gfar': 2048}
if TEST:
    SIZES = {'lm_gnear': 1024}
SAMPLES = 64 if TEST else 128
NOLM = {'od_glass', 'od_shopglass', 'od_interior', 'od_neon', 'od_water', 'od_frame'}

sc.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'
prefs.get_devices()
for d in prefs.devices:
    d.use = True
sc.cycles.device = 'GPU'
sc.cycles.samples = SAMPLES
sc.cycles.max_bounces = 4
sc.cycles.diffuse_bounces = 3
sc.cycles.glossy_bounces = 1
sc.cycles.transparent_max_bounces = 8
sc.render.bake.margin = 3
sc.render.bake.margin_type = 'EXTEND'

C_LM = bpy.data.collections['LIGHTMAPPED']
C_STATIC = bpy.data.collections['STATIC']
sun = bpy.data.objects['sun']
bgnode = [n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND'][0]


def select_only(ob):
    bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def split_glass(ob):
    """move the non-lightmapped materials (glass, neon, interiors) into their own static object"""
    idx = [i for i, m in enumerate(ob.data.materials) if m and m.name in NOLM]
    if not idx:
        return
    select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    for i in idx:
        ob.active_material_index = i
        bpy.ops.object.material_slot_select()
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in bpy.context.selected_objects:
        if o != ob:
            o.name = ob.name.replace('lm_', 'gl_')
            for c in list(o.users_collection):
                c.objects.unlink(o)
            C_STATIC.objects.link(o)


def lightmap_uv(ob):
    select_only(ob)
    me = ob.data
    if 'lightmap' not in me.uv_layers:
        me.uv_layers.new(name='lightmap')
    me.uv_layers.active = me.uv_layers['lightmap']
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    # ~3 texels between islands (a fraction of the map): wide margins strand the thousands of small islands
    bpy.ops.uv.pack_islands(rotate=True, margin=3.0 / SIZES[ob.name], shape_method='AABB', margin_method='FRACTION')
    bpy.ops.object.mode_set(mode='OBJECT')
    me.uv_layers.active = me.uv_layers['UVMap']
    me.uv_layers['UVMap'].active_render = True


def bake_pass(ob, img, filt):
    for m in ob.data.materials:
        nt = m.node_tree
        n = nt.nodes.get('LM_TARGET') or nt.nodes.new('ShaderNodeTexImage')
        n.name = 'LM_TARGET'
        n.image = img
        uvn = nt.nodes.get('LM_UV') or nt.nodes.new('ShaderNodeUVMap')
        uvn.name = 'LM_UV'; uvn.uv_map = 'lightmap'
        if not n.inputs['Vector'].links:
            nt.links.new(uvn.outputs['UV'], n.inputs['Vector'])
        nt.nodes.active = n
    select_only(ob)
    bpy.ops.object.bake(type='DIFFUSE', pass_filter=filt, margin=3, uv_layer='lightmap', use_clear=True)
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def _box(a, r, axis):
    """box sum of a 2D float32 array along an axis, radius r (edges clamped), small temporaries"""
    n = a.shape[axis]
    c = np.cumsum(a, axis=axis, dtype=np.float32)
    z = np.zeros((1, a.shape[1]) if axis == 0 else (a.shape[0], 1), np.float32)
    s = np.concatenate([z, c], axis=axis)
    del c
    hi = np.minimum(np.arange(n) + r + 1, n)
    lo = np.maximum(np.arange(n) - r, 0)
    return (s[hi] - s[lo]) if axis == 0 else (s[:, hi] - s[:, lo])


def denoise(rgb, mask, r=2):
    """masked separable box blur, twice (~gaussian), per channel in float32: no light leaks across atlas gaps"""
    den = mask.astype(np.float32)
    for _ in range(2):
        den = _box(_box(den, r, 0), r, 1)
    ok = den > 1e-4
    inv = np.where(ok, 1.0 / np.maximum(den, 1e-4), 0).astype(np.float32)
    for ch in range(3):
        num = rgb[..., ch] * mask
        for _ in range(2):
            num = _box(_box(num, r, 0), r, 1)
        rgb[..., ch] = np.where(ok, num * inv, rgb[..., ch])
        del num
    return rgb


# leaf cards (palms, sea grape, shrubs) are left out of the bake: alpha-tested foliage makes every ray
# slow, and their soft sky occlusion is small next to the sharp sun shadows the runtime draws anyway
for o in bpy.data.objects:
    if o.name.startswith(('palm', 'seagrape', 'shrub')) or (o.users_collection and o.users_collection[0].name == 'PALMS'):
        o.hide_render = True
manifest = {}
SCALE = 1.6
t0 = time.time()
for name, size in SIZES.items():
    ob = bpy.data.objects[name]
    split_glass(ob)
    lightmap_uv(ob)
    if ONLY and name not in ONLY:
        prev = json.load(open(os.path.join(WORK, 'lightmaps.json'))) if os.path.exists(os.path.join(WORK, 'lightmaps.json')) else {}
        manifest[name] = prev.get(name, dict(size=size, scale=SCALE, gamma=2.2))
        print(name, 'kept', flush=True)
        continue
    img = bpy.data.images.new(name + '_img', size, size, alpha=True, float_buffer=True)
    img.generated_color = (0, 0, 0, 0)
    # A: sky (sun off)
    sun.hide_render = True
    bgnode.inputs['Strength'].default_value = 1.0
    sc.cycles.samples = SAMPLES
    A = bake_pass(ob, img, {'DIRECT', 'INDIRECT'})
    print(name, 'A', round(time.time() - t0, 1), 's', flush=True)
    # B: the sun's bounce (sky off)
    sun.hide_render = False
    bgnode.inputs['Strength'].default_value = 0.0
    sc.cycles.samples = max(32, int(SAMPLES * 0.7))
    B = bake_pass(ob, img, {'INDIRECT'})
    bgnode.inputs['Strength'].default_value = 1.0
    print(name, 'B', round(time.time() - t0, 1), 's', flush=True)
    mask = (A[..., 3] > 0.5).astype(np.float32)
    rgb = np.ascontiguousarray(A[..., :3] + B[..., :3])
    del A, B
    rgb = denoise(rgb, mask, 1)
    print(name, 'max', rgb.max(), 'p99', np.percentile(rgb[mask > 0], 99), 'mean', rgb[mask > 0].mean(), flush=True)
    enc = np.clip(rgb / SCALE, 0, 1) ** (1 / 2.2)
    out = bpy.data.images.new(name + '_out', size, size, alpha=False)
    px = np.concatenate([enc, np.ones(enc.shape[:2] + (1,), np.float32)], -1)
    out.pixels.foreach_set(px.ravel())
    out.filepath_raw = os.path.join(WORK, name + '.png')
    out.file_format = 'PNG'
    out.save()
    manifest[name] = dict(size=size, scale=SCALE, gamma=2.2)
    # drop the bake nodes again
    for m in ob.data.materials:
        for k in ('LM_TARGET', 'LM_UV'):
            n = m.node_tree.nodes.get(k)
            if n:
                m.node_tree.nodes.remove(n)
json.dump(manifest, open(os.path.join(WORK, 'lightmaps.json'), 'w'), indent=1)
if not TEST:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, 'oceandrive_baked.blend'))
print('done', round(time.time() - t0, 1))
