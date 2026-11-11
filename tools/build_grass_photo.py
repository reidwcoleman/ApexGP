"""A photographed sward for the verges (a top-down photo of mown turf generated with Higgsfield /
GPT Image 2.6, kept out of git in assets-src): evened out, made to tile (cross-faded over its own
half-offset copy, variance preserved), its linear mean matched to the grass GRASS_FRAG was graded on,
and a normal map taken from its brightness (blade tips are pale, the thatch between them dark).
Writes public/textures/grass_c.webp and grass_n.webp (stored upside down, as tools/build_grass.py).
python3 tools/build_grass_photo.py [src.png] [size=1024]"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'assets-src', 'generated', 'monza', 'grass2.png')
SIZE = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
OUT = os.path.join(ROOT, 'public', 'textures')
MEAN = np.array([0.0499, 0.0841, 0.0209])
W = np.array([0.2126, 0.7152, 0.0722])

def to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def to_srgb(l):
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(np.clip(l, 0, 1), 1 / 2.4) - 0.055)

def tileable(a):
    h, w = a.shape[:2]
    b = np.roll(a, (h // 2, w // 2), axis=(0, 1))
    y = np.abs(np.linspace(-1, 1, h, endpoint=False))[:, None]
    x = np.abs(np.linspace(-1, 1, w, endpoint=False))[None, :]
    wgt = np.clip((0.92 - np.maximum(x, y)) / 0.3, 0, 1)
    wgt = (wgt * wgt * (3 - 2 * wgt))[..., None]
    m = a.reshape(-1, a.shape[-1]).mean(0)
    return (a * wgt + b * (1 - wgt) - m) / np.sqrt(wgt * wgt + (1 - wgt) * (1 - wgt)) + m

im = Image.open(SRC).convert('RGB')
s = min(im.size)
im = im.crop(((im.size[0] - s) // 2, (im.size[1] - s) // 2, (im.size[0] + s) // 2, (im.size[1] + s) // 2)).resize((SIZE, SIZE), Image.LANCZOS)
lin = to_lin(np.asarray(im, dtype=np.float64) / 255)
lum = lin @ W
low = np.asarray(Image.fromarray(np.uint8(np.clip(lum / lum.max(), 0, 1) * 255)).filter(ImageFilter.GaussianBlur(SIZE / 6)), dtype=np.float64) / 255 * lum.max()
lin *= (low.mean() / np.maximum(low, 1e-4))[..., None]
lin = np.clip(tileable(lin), 0, None)
# the shader's grade was set on this mean; the hue stays two thirds the photograph's own
m = lin.reshape(-1, 3).mean(0)
own = m * (MEAN @ W) / (m @ W)
lin *= (own * 0.65 + MEAN * 0.35) / m
lum = lin @ W
hgt = np.asarray(Image.fromarray(np.uint8(np.clip(lum / np.percentile(lum, 99.5), 0, 1) * 255)).filter(ImageFilter.GaussianBlur(1.0)), dtype=np.float64) / 255
k = 3.0
dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * k
dy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * k
nz = 1 / np.sqrt(dx * dx + dy * dy + 1)
nrm = np.stack([-dx * nz * 0.5 + 0.5, dy * nz * 0.5 + 0.5, nz * 0.5 + 0.5], -1)
flip = Image.Transpose.FLIP_TOP_BOTTOM
Image.fromarray(np.round(np.clip(to_srgb(lin), 0, 1) * 255).astype(np.uint8)).transpose(flip).save(os.path.join(OUT, 'grass_c.webp'), 'WEBP', quality=90, method=6)
Image.fromarray(np.round(np.clip(nrm, 0, 1) * 255).astype(np.uint8)).transpose(flip).save(os.path.join(OUT, 'grass_n.webp'), 'WEBP', quality=90, method=6)
for f in ('grass_c.webp', 'grass_n.webp'):
    print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')
