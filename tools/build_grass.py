"""ambientCG 'Grass 001' (CC0, 1.4 m x 1.4 m) for the trackside grass: the colour scaled so its linear
mean matches the procedural grass the GRASS_FRAG grade was tuned on (tools/grassstats.mjs), keeping the
scan's own variation; the GL normal map as is. Writes public/textures/grass_c.webp and grass_n.webp.
python3 tools/build_grass.py [size=1024]"""
import sys, os, io, zipfile, urllib.request
import numpy as np
from PIL import Image

SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 1024
SRC = os.path.join(os.path.dirname(__file__), '..', 'assets-src', 'ambientcg')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'textures')
MEAN = np.array([0.0499, 0.0841, 0.0209])

def src(kind):
    path = os.path.join(SRC, f'Grass001_2K-JPG_{kind}.jpg')
    if not os.path.exists(path):
        # assets-src/ is git-ignored: fetch the 2K set from ambientCG
        os.makedirs(SRC, exist_ok=True)
        z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen('https://ambientcg.com/get?file=Grass001_2K-JPG.zip').read()))
        for k in ('Color', 'NormalGL'):
            z.extract(f'Grass001_2K-JPG_{k}.jpg', SRC)
    return Image.open(path).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)

c = np.asarray(src('Color'), dtype=np.float64) / 255
lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
lin *= MEAN / lin.reshape(-1, 3).mean(0)
s = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.clip(lin, 0, 1), 1 / 2.4) - 0.055)
os.makedirs(OUT, exist_ok=True)
# stored upside down: the game uploads them as ImageBitmaps (no flipY), which puts the GL normal map's
# up back where three expects it
flip = Image.Transpose.FLIP_TOP_BOTTOM
Image.fromarray(np.round(np.clip(s, 0, 1) * 255).astype(np.uint8)).transpose(flip).save(os.path.join(OUT, 'grass_c.webp'), 'WEBP', quality=88, method=6)
src('NormalGL').transpose(flip).save(os.path.join(OUT, 'grass_n.webp'), 'WEBP', quality=90, method=6)
for f in ('grass_c.webp', 'grass_n.webp'):
    print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')
