"""The generated Monza photographs (tools/build_monza.py made them tileable in assets-src/generated/monza/built) packed for
the trackside shaders in place of the stock scans: the asphalt as R = sqrt(albedo), G = height (taken
from the photograph's luminance: aggregate is pale, the binder between it dark), matched to the
statistics ASPHALT_FRAG was tuned on like tools/build_asphalt.py; the grass colour scaled to the mean
GRASS_FRAG was graded on like tools/build_grass.py, with its normal map. Overwrites
public/textures/asphalt.webp, grass_c.webp and grass_n.webp.  python3 tools/build_monza_surface.py"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public')
BUILT = os.path.join(os.path.dirname(__file__), '..', 'assets-src', 'generated', 'monza', 'built')
SIZE = 1024
R_MS, G_MS = (0.5392, 0.1569), (0.4334, 0.3296)
GRASS_MEAN = np.array([0.0499, 0.0841, 0.0209])

def load(name):
    im = Image.open(os.path.join(BUILT, name)).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
    return np.asarray(im, dtype=np.float64) / 255

def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def match(x, ms):
    return np.clip((x - x.mean()) / (x.std() + 1e-9) * ms[1] + ms[0], 0, 1)

def blur(x, r):
    # separable box blur, wrapping (the tile repeats)
    for ax in (0, 1):
        acc = np.zeros_like(x)
        for k in range(-r, r + 1):
            acc += np.roll(x, k, ax)
        x = acc / (2 * r + 1)
    return x

lum = lin(load('asphalt_c.webp')) @ np.array([0.2126, 0.7152, 0.0722])
R = match(np.sqrt(lum), R_MS)
# height: the stones stand proud. Local contrast only (a slow tonal drift is not relief)
h = np.sqrt(lum)
h = blur(h, 1) - blur(h, 12)
G = match(h, G_MS)
px = np.stack([R, G, np.zeros_like(R)], -1)
out = os.path.join(ROOT, 'textures', 'asphalt.webp')
Image.fromarray(np.round(px * 255).astype(np.uint8), 'RGB').save(out, 'WEBP', lossless=True, quality=100, method=6, exact=True)
print(out, os.path.getsize(out) // 1024, 'KB')

g = lin(load('grass_c.webp'))
g *= GRASS_MEAN / g.reshape(-1, 3).mean(0)
s = np.where(g <= 0.0031308, g * 12.92, 1.055 * np.power(np.clip(g, 0, 1), 1 / 2.4) - 0.055)
# stored upside down like build_grass.py (uploaded as ImageBitmaps, no flipY)
flip = Image.Transpose.FLIP_TOP_BOTTOM
Image.fromarray(np.round(np.clip(s, 0, 1) * 255).astype(np.uint8)).transpose(flip).save(os.path.join(ROOT, 'textures', 'grass_c.webp'), 'WEBP', quality=88, method=6)
Image.open(os.path.join(BUILT, 'grass_n.webp')).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS).transpose(flip).save(os.path.join(ROOT, 'textures', 'grass_n.webp'), 'WEBP', quality=90, method=6)
for f in ('grass_c.webp', 'grass_n.webp'):
    print(f, os.path.getsize(os.path.join(ROOT, 'textures', f)) // 1024, 'KB')
