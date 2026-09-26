#!/usr/bin/env python3
"""Fetch a selection of Microsoft Rocketbox avatars + animations (MIT) into assets-src/rocketbox."""
import json, os, sys, urllib.request, urllib.error, concurrent.futures as cf
API = 'https://api.github.com/repos/microsoft/Microsoft-Rocketbox/contents/Assets/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets-src', 'rocketbox')
AVATARS = [f'Adults/Male_Adult_{i:02d}' for i in range(1, 17)] + [f'Adults/Female_Adult_{i:02d}' for i in range(1, 7)] + \
  [f'Professions/Sports_Male_{i:02d}' for i in range(1, 5)] + [f'Professions/Sports_Female_{i:02d}' for i in range(1, 3)] + \
  ['Professions/Pilot_Male_01', 'Professions/Pilot_Female_01', 'Professions/Pilot_Male_02', 'Professions/Pilot_Male_03',
   'Professions/Pilot_Female_02', 'Professions/Gardener_Male_01', 'Professions/Delivery_Male_01']
CLIPS = ['idle_neutral_01', 'idle_neutral_02', 'idle_neutral_03', 'idle_neutral_04', 'idle_breathe_01', 'idle_look_around_01',
  'idle_look_around_02', 'idle_waiting_01', 'cheer_01', 'cheer_03', 'cheer_04', 'cheer_05', 'claphands_01', 'claphands_02',
  'dancing_cool', 'dancing_neutral', 'cell_phone_textmessage', 'take_picture', 'wave_01', 'wave_02', 'crouch_idle', 'crouch_gestic',
  'gestic_talk_neutral_01', 'gestic_talk_relaxed_01', 'gestic_listen_neutral_01', 'gestic_talk_excited_01', 'sit_chair_idle_neutral_01',
  'sit_chair_breathe_01', 'sit_chair_idle_look_around', 'work_mid', 'work_table', 'headphones_idle', 'drink_idle', 'idle_stretch_arms_01',
  'trolley_idle']
# locomotion lives in the root-motion (xy) folder; the build strips the horizontal travel
CLIPS_XY = ['walk_neutral_01', 'walk_neutral_02', 'run_slow_01', 'run_neutral_01']
def ls(path):
    req = urllib.request.Request(API + path, headers={'User-Agent': 'apexgp'})
    return json.load(urllib.request.urlopen(req))
def get(url, dst):
    if os.path.exists(dst) and os.path.getsize(dst) > 0: return 0
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    urllib.request.urlretrieve(url, dst + '.part'); os.replace(dst + '.part', dst)
    return os.path.getsize(dst)
RAW = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/'
def raw_avatar(a, name):
    # without the API (rate-limited): the FBX by its known path, the textures by the names it references
    import re
    fbx = os.path.join(OUT, 'avatars', name, name + '.fbx')
    get(RAW + f'Avatars/{a}/Export/{name}.fbx', fbx)
    data = open(fbx, 'rb').read()
    names = sorted(set(m.decode() for m in re.findall(rb'([A-Za-z0-9]+_(?:body|head|opacity|hat)_(?:color|normal|specular))\.tga', data)))
    return [(RAW + f'Avatars/{a}/Textures/{n}.tga', os.path.join(OUT, 'avatars', name, n + '.tga')) for n in names]
jobs = []
for a in AVATARS:
    name = a.split('/')[-1]
    d = os.path.join(OUT, 'avatars', name)
    if os.path.isdir(d) and any(f.endswith('.fbx') for f in os.listdir(d)): continue
    try:
        for sub in ['Export', 'Textures']:
            for f in ls(f'Avatars/{a}/{sub}'):
                if f['type'] != 'file' or f['name'].endswith('_facial.fbx'): continue
                jobs.append((f['download_url'], os.path.join(OUT, 'avatars', name, f['name'])))
    except urllib.error.HTTPError:
        jobs += raw_avatar(a, name)
for folder, clips in [('all_animations_max_motextr_static', CLIPS), ('all_animations_max_motextr_xy', CLIPS_XY)]:
    for c in clips:
        for g in 'mf':
            n = f'{g}_{c}.max.fbx'
            dst = os.path.join(OUT, 'anims', n)
            if not os.path.exists(dst): jobs.append((RAW + f'Animations/{folder}/{n}', dst))
print(len(jobs), 'files', flush=True)
tot = 0
with cf.ThreadPoolExecutor(8) as ex:
    for i, n in enumerate(ex.map(lambda j: get(*j), jobs)):
        tot += n
        if i % 40 == 0: print(i, f'{tot/1e6:.0f} MB', flush=True)
print('done', f'{tot/1e6:.0f} MB')
