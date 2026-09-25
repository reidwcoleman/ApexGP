#!/usr/bin/env python3
"""
Build the web assets for the people from Quaternius's CC0 packs (assets-src/, not committed):
  Universal Base Characters [Standard]  -> male/female bodies, hairstyles (glTF + resized JPG textures)
  Universal Animation Library [Standard] -> anims.glb: the clips we use, rotation tracks only
Run: python3 tools/build_people.py
"""
import json, struct, os, shutil, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets-src')
UBC = os.path.join(SRC, 'UBC', 'Universal Base Characters[Standard]')
UAL = os.path.join(SRC, 'UAL', 'Universal Animation Library[Standard]', 'Unreal-Godot', 'UAL1_Standard.glb')
OUT = os.path.join(ROOT, 'public', 'models', 'people')
os.makedirs(OUT, exist_ok=True)

BODY_TEX = os.path.join(UBC, 'Base Characters', 'Textures')
GL_NORM = os.path.join(BODY_TEX, 'Normals Unity - Godot')

def jpg(src, dst, size, q=85):
    subprocess.run(['sips', '-Z', str(size), '-s', 'format', 'jpeg', '-s', 'formatOptions', str(q), src, '--out', os.path.join(OUT, dst)], check=True, capture_output=True)

# ---------------------------------------------------------------- textures
jpg(os.path.join(BODY_TEX, 'T_Superhero_Male_Ligh.png'), 'male_light.jpg', 1024)
jpg(os.path.join(BODY_TEX, 'T_Superhero_Male_Dark.png'), 'male_dark.jpg', 1024)
jpg(os.path.join(BODY_TEX, 'T_Superhero_Female_Light_BaseColor.png'), 'female_light.jpg', 1024)
jpg(os.path.join(BODY_TEX, 'T_Superhero_Female_Dark_BaseColor.png'), 'female_dark.jpg', 1024)
jpg(os.path.join(GL_NORM, 'T_Superhero_Male_Normal.png'), 'male_n.jpg', 1024, 92)
jpg(os.path.join(GL_NORM, 'T_Superhero_Female_Normal.png'), 'female_n.jpg', 1024, 92)
jpg(os.path.join(BODY_TEX, 'T_Superhero_Male_Roughness.png'), 'male_r.jpg', 512)
jpg(os.path.join(BODY_TEX, 'T_Superhero_Female_Roughness.png'), 'female_r.jpg', 512)
jpg(os.path.join(BODY_TEX, 'T_Eye_Brown.png'), 'eye_c.jpg', 256)
jpg(os.path.join(GL_NORM, 'T_Eye_Normal.png'), 'eye_n.jpg', 256, 92)
for k in (1, 2):
    jpg(os.path.join(BODY_TEX, f'T_Hair_{k}_BaseColor.png'), f'hair{k}_c.jpg', 1024)
    jpg(os.path.join(GL_NORM, f'T_Hair_{k}_Normal.png'), f'hair{k}_n.jpg', 1024, 92)

def retex(uri):
    u = uri.lower()
    if 'eye_normal' in u: return 'eye_n.jpg'
    if 'eye_' in u: return 'eye_c.jpg'
    for k in ('1', '2'):
        if f'hair_{k}_normal' in u: return f'hair{k}_n.jpg'
        if f'hair_{k}_base' in u: return f'hair{k}_c.jpg'
    sex = 'female' if 'female' in u else 'male'
    if 'normal' in u: return f'{sex}_n.jpg'
    if 'rough' in u: return f'{sex}_r.jpg'
    return f'{sex}_dark.jpg'

def copy_gltf(src, name):
    g = json.load(open(src))
    for im in g.get('images', []):
        im['uri'] = retex(im['uri'])
    old_bin = g['buffers'][0]['uri']
    shutil.copy(os.path.join(os.path.dirname(src), old_bin), os.path.join(OUT, name + '.bin'))
    g['buffers'][0]['uri'] = name + '.bin'
    json.dump(g, open(os.path.join(OUT, name + '.gltf'), 'w'), separators=(',', ':'))

BC = os.path.join(UBC, 'Base Characters', 'Godot - UE')
copy_gltf(os.path.join(BC, 'Superhero_Male_FullBody.gltf'), 'male')
copy_gltf(os.path.join(BC, 'Superhero_Female_FullBody.gltf'), 'female')
HR = os.path.join(UBC, 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)')
for h in ('Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_SimpleParted', 'Hair_Long', 'Hair_Buns', 'Hair_Beard'):
    copy_gltf(os.path.join(HR, h + '.gltf'), h.lower())

# ---------------------------------------------------------------- animations
KEEP = ['Idle_Loop', 'Idle_Talking_Loop', 'Dance_Loop', 'Fixing_Kneeling', 'Walk_Loop', 'Walk_Formal_Loop', 'Jump_Loop', 'Sitting_Idle_Loop',
        'Sitting_Talking_Loop', 'Interact', 'Crouch_Idle_Loop', 'PickUp_Table', 'Push_Loop', 'Driving_Loop', 'Jog_Fwd_Loop', 'A_TPose']
f = open(UAL, 'rb').read()
jl = struct.unpack('<I', f[12:16])[0]
g = json.loads(f[20:20 + jl])
binoff = 20 + jl
bl = struct.unpack('<I', f[binoff:binoff + 4])[0]
BIN = f[binoff + 8:binoff + 8 + bl]
names = [n['name'] for n in g['nodes']]
out_acc, out_views, blob = [], [], bytearray()
acc_map = {}
def take(ai):
    if ai in acc_map: return acc_map[ai]
    a = dict(g['accessors'][ai]); v = g['bufferViews'][a['bufferView']]
    start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    comps = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
    size = a['count'] * comps * 4
    while len(blob) % 4: blob.append(0)
    out_views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': size})
    blob.extend(BIN[start:start + size])
    a['bufferView'] = len(out_views) - 1
    a.pop('byteOffset', None)
    out_acc.append(a)
    acc_map[ai] = len(out_acc) - 1
    return acc_map[ai]
anims = []
for an in g['animations']:
    if an['name'] not in KEEP: continue
    ch, sa = [], []
    for c in an['channels']:
        node = names[c['target']['node']]
        path = c['target']['path']
        if path == 'scale': continue
        if path == 'translation' and node not in ('pelvis',): continue
        s = an['samplers'][c['sampler']]
        sa.append({'input': take(s['input']), 'output': take(s['output']), 'interpolation': s.get('interpolation', 'LINEAR')})
        ch.append({'sampler': len(sa) - 1, 'target': {'node': c['target']['node'], 'path': path}})
    anims.append({'name': an['name'], 'channels': ch, 'samplers': sa})
nodes = [{k: v for k, v in n.items() if k in ('name', 'children', 'rotation', 'translation', 'scale')} for n in g['nodes']]
out = {'asset': {'version': '2.0', 'generator': 'apexgp build_people.py (UAL1 Standard, CC0 Quaternius)'},
       'scene': 0, 'scenes': [{'nodes': [i for i, n in enumerate(g['nodes']) if not any(i in (m.get('children') or []) for m in g['nodes'])]}],
       'nodes': nodes, 'accessors': out_acc, 'bufferViews': out_views, 'buffers': [{'byteLength': len(blob)}], 'animations': anims}
js = json.dumps(out, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(blob) % 4: blob.append(0)
total = 12 + 8 + len(js) + 8 + len(blob)
with open(os.path.join(OUT, 'anims.glb'), 'wb') as o:
    o.write(struct.pack('<III', 0x46546C67, 2, total))
    o.write(struct.pack('<II', len(js), 0x4E4F534A)); o.write(js)
    o.write(struct.pack('<II', len(blob), 0x004E4942)); o.write(blob)
print('anims', [a['name'] for a in anims])
