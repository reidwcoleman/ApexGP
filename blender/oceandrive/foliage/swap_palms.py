"""Swap a baked tile's palms for the palm kit's (no re-bake: palms carry no lightmaps), then save.
  blender -b work/tile_X_baked.blend -P foliage/swap_palms.py
Each old instance keeps its place, turn and size; its species is read from its template's name
(dtpalm_r royal, _c coconut, _w Washingtonia, _s Sabal)."""
import bpy, sys, os, random
HERE = os.path.dirname(os.path.abspath(__file__))
OD = os.path.dirname(HERE)
sys.path.insert(0, OD)
sys.path.insert(0, HERE)
for m in ('lib', 'palmkit'):
    sys.modules.pop(m, None)
import lib, palmkit
lib.GEN = os.path.join(OD, 'assets', 'gen')

old = []
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name.startswith('palm') and o.data.name.startswith('dtpalm_'):
        old.append((o.data.name[7], o.location.copy(), o.rotation_euler.copy(), o.scale.copy(), o.users_collection[0]))
        bpy.data.objects.remove(o)
for o in list(bpy.data.objects):
    if o.name.startswith('dtpalm_'):
        bpy.data.objects.remove(o)
for me in list(bpy.data.meshes):
    if me.name.startswith('dtpalm_') and me.users == 0:
        bpy.data.meshes.remove(me)
tpl = bpy.data.collections['TEMPLATES']
kinds = {'r': ('royal', (13.0, 15.5, 17.5, 19.5), 300), 'c': ('coconut', (8.5, 9.8, 11.0, 12.5, 13.8, 15.0), 400),
         'w': ('washingtonia', (16.0, 19.0, 22.0), 500), 's': ('sabal', (6.5, 8.0), 600), 't': ('shadetree', (8.0, 10.0, 12.5), 900)}
variants = {}
for k, (fn, hs, seed) in kinds.items():
    variants[k] = []
    for i, h in enumerate(hs):
        ob = getattr(palmkit, fn)(f'dtpalm_{k}{i}', random.Random(seed + i), h).build(weld=False)
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        tpl.objects.link(ob)
        ob.hide_render = True
        variants[k].append(ob)
rng = random.Random('swap')
already = any(k == 't' for k, *_ in old)
for k, loc, rot, sc, col in old:
    # a third of the coconuts were lawn and street trees: Miami's broadleaf shade trees take those (once)
    if k == 'c' and not already and rng.random() < 0.3:
        k = 't'
    v = rng.choice(variants.get(k, variants['c']))
    o = bpy.data.objects.new('palm', v.data)
    o.location, o.rotation_euler, o.scale = loc, rot, sc
    col.objects.link(o)
print('swapped', len(old))
bpy.ops.wm.save_mainfile()
