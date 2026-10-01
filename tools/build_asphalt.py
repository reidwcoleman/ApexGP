"""Pack Poly Haven's 'Asphalt Track' scan (CC0, Dimitrios Savva, 2 m x 2 m) into the road shader's
asphalt texture: R = sqrt(albedo) and G = height, matched to the procedural texture's statistics the
shader was tuned on. The normals (B,A of the packed texture) are rebuilt from G at load time
(textures.ts scanAsphalt, with the gain printed here, chosen so their spread matches the procedural
texture's). Writes public/textures/asphalt.webp (lossless RGB, so the data channels survive).  python3 tools/build_asphalt.py [size=1024]"""
import sys, os
import numpy as np
from PIL import Image

SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 1024
SRC = os.path.join(os.path.dirname(__file__), '..', 'assets-src', 'polyhaven')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'textures', 'asphalt.webp')
# the procedural texture's channel mean / std (tools/asphstats.mjs), which ASPHALT_FRAG's contrast was tuned on
R_MS, G_MS, N_STD = (0.5392, 0.1569), (0.4334, 0.3296), 0.134

def fetch(name):
    # assets-src/ is git-ignored: the 2k scans come straight from Poly Haven
    path = os.path.join(SRC, name)
    if not os.path.exists(path):
        import urllib.request
        os.makedirs(SRC, exist_ok=True)
        urllib.request.urlretrieve(f'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_track/{name}', path)
    return path

def load(name):
    fetch(name)
    im = Image.open(os.path.join(SRC, name)).convert('RGB' if 'diff' in name else 'L')
    return np.asarray(im.resize((SIZE, SIZE), Image.LANCZOS), dtype=np.float64) / 255.0

def match(x, ms):
    return np.clip((x - x.mean()) / (x.std() + 1e-9) * ms[1] + ms[0], 0, 1)

d = load('asphalt_track_diff_2k.jpg')
lin = np.where(d <= 0.04045, d / 12.92, ((d + 0.055) / 1.055) ** 2.4)
lum = lin @ np.array([0.2126, 0.7152, 0.0722])
R = match(np.sqrt(lum), R_MS)
h = load('asphalt_track_disp_2k.jpg')
G = match(h, G_MS)
# normal gain on G (central differences), so the normals' spread matches the procedural texture's
gx = (np.roll(G, -1, 1) - np.roll(G, 1, 1)) * 0.5
gy = (np.roll(G, -1, 0) - np.roll(G, 1, 0)) * 0.5
def nstd(k):
    nx = -gx * k
    return (nx / np.sqrt(nx * nx + (gy * k) ** 2 + 1) * 0.5).std()
lo, hi = 0.1, 400.0
for _ in range(40):
    k = (lo + hi) / 2
    if nstd(k) < N_STD: lo = k
    else: hi = k
px = np.stack([R, G, np.zeros_like(R)], -1)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
Image.fromarray(np.round(px * 255).astype(np.uint8), 'RGB').save(OUT, 'WEBP', lossless=True, quality=100, method=6, exact=True)
print(OUT, os.path.getsize(OUT) // 1024, 'KB; normal gain on G:', round(k, 2), '; means', round(float(R.mean()), 4), round(float(G.mean()), 4))
