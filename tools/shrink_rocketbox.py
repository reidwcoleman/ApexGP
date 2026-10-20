"""Shrink the avatars' textures after tools/build_rocketbox.mjs (a download diet, ~9 MB -> ~3 MB):
normal maps to 1024 wide, and the colour + hair maps of the avatars only the fans wear to half size
(the fans are seen in the stands and on the concourses, never in the garage close-ups).
Needs cwebp.   python3 tools/shrink_rocketbox.py"""
import glob, os, subprocess, sys, tempfile
from PIL import Image

DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'models', 'rocketbox')
# Humans.ts ROSTER.fansM + fansF (the avatars nothing but a fan wears)
FANS = {'Male_Adult_01', 'Male_Adult_14', 'Male_Adult_05', 'Male_Adult_08', 'Male_Adult_09', 'Male_Adult_15', 'Delivery_Male_01',
        'Female_Adult_01', 'Female_Adult_02', 'Female_Adult_04', 'Sports_Female_02'}
tmp = tempfile.mkdtemp()
for f in sorted(glob.glob(os.path.join(DIR, '*.webp'))):
    base = os.path.basename(f)[:-5]
    name, kind = base.rsplit('_', 1)
    im = Image.open(f)
    w, h = im.size
    target = w
    if kind == 'n': target = min(w, 1024)
    if name in FANS and kind in ('c', 'h'): target = min(w, {'c': 1024, 'h': 512}[kind])
    if target >= w: continue
    png = os.path.join(tmp, base + '.png')
    im.resize((target, round(h * target / w)), Image.LANCZOS).save(png, compress_level=1)
    subprocess.run(['cwebp', '-quiet', '-q', '90' if kind == 'n' else '86', '-m', '4', '-metadata', 'none', '-exact', png, '-o', f], check=True)
    print(base, w, '->', target, os.path.getsize(f) // 1024, 'KB')
