"""A photographed gravel bed for the traps (assets-src/generated/gravel.png: a top-down photo of crushed
limestone chippings, generated with Higgsfield / GPT Image and kept out of git with the rest of
assets-src). Made to tile (the frame is cross-faded over its own half-offset copy along both axes),
its linear mean matched to the procedural gravel the GRAVEL_FRAG grade was tuned on, a height taken
from its brightness (stone tops are pale, the voids between them dark) in the alpha, and a normal map
from that height. Writes public/textures/gravel_c.webp (RGB albedo + A height) and gravel_n.webp.
python3 tools/build_gravel.py [src.png] [size=1024]"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'assets-src', 'generated', 'gravel.png')
SIZE = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
OUT = os.path.join(ROOT, 'public', 'textures')
# the procedural gravel's linear mean (gravelData(512))
MEAN = np.array([0.3095, 0.2808, 0.2352])

def to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def to_srgb(l):
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(np.clip(l, 0, 1), 1 / 2.4) - 0.055)

def tileable(a):
    """cross-fade with the half-offset copy: the seams move to the middle, where the other copy covers them"""
    h, w = a.shape[:2]
    b = np.roll(a, (h // 2, w // 2), axis=(0, 1))
    y = np.abs(np.linspace(-1, 1, h, endpoint=False))[:, None]
    x = np.abs(np.linspace(-1, 1, w, endpoint=False))[None, :]
    # weight of the original: 1 in the middle of the frame, 0 at its edges (where its seams are)
    d = np.maximum(x, y)
    wgt = np.clip((0.92 - d) / 0.3, 0, 1)
    wgt = (wgt * wgt * (3 - 2 * wgt))[..., None]
    # (variance-preserving: a plain average of two unrelated patches of stones is a paler, flatter
    # patch — the cross-fade showed as a washed band; rescale the blend's contrast round the mean)
    m = a.reshape(-1, a.shape[-1]).mean(0)
    return (a * wgt + b * (1 - wgt) - m) / np.sqrt(wgt * wgt + (1 - wgt) * (1 - wgt)) + m

im = Image.open(SRC).convert('RGB')
s = min(im.size)
im = im.crop(((im.size[0] - s) // 2, (im.size[1] - s) // 2, (im.size[0] + s) // 2, (im.size[1] + s) // 2)).resize((SIZE, SIZE), Image.LANCZOS)
lin = to_lin(np.asarray(im, dtype=np.float64) / 255)
# flatten any lighting falloff across the frame (a photo is never evenly lit; a tile must be)
lum = lin @ np.array([0.2126, 0.7152, 0.0722])
low = np.asarray(Image.fromarray(np.uint8(np.clip(lum / lum.max(), 0, 1) * 255)).filter(ImageFilter.GaussianBlur(SIZE / 6)), dtype=np.float64) / 255 * lum.max()
lin *= (low.mean() / np.maximum(low, 1e-4))[..., None]
lin = tileable(lin)
# brightness matched to the procedural bed; the colour stays mostly the stone's own grey, warmed a
# third of the way to the old beige (matched all the way, lit by a low sun, a trap came out orange sand)
W = np.array([0.2126, 0.7152, 0.0722])
m = lin.reshape(-1, 3).mean(0)
grey = m * (MEAN @ W) / (m @ W)
# (2026-11-11: 5 % now, with a paler pale-grey source: the 35 % mix still read as brown earth)
lin *= (grey * 0.95 + MEAN * 0.05) / m
lum = lin @ np.array([0.2126, 0.7152, 0.0722])
# height: brightness, a little smoothed (a stone's top, not its speckle), stretched to the procedural's spread
hgt = np.asarray(Image.fromarray(np.uint8(np.clip(lum / np.percentile(lum, 99.5), 0, 1) * 255)).filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float64) / 255
hgt = np.clip((hgt - hgt.mean()) / max(hgt.std(), 1e-4) * 0.177 + 0.628, 0, 1)
# normals from the height (wrapping, as the tile does)
k = 2.2
dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * k
dy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * k
nz = 1 / np.sqrt(dx * dx + dy * dy + 1)
nrm = np.stack([-dx * nz * 0.5 + 0.5, dy * nz * 0.5 + 0.5, nz * 0.5 + 0.5], -1)
os.makedirs(OUT, exist_ok=True)
rgba = np.concatenate([to_srgb(lin), hgt[..., None]], -1)
# (stored upside down, as the grass: uploaded as ImageBitmaps with no flipY)
flip = Image.Transpose.FLIP_TOP_BOTTOM
Image.fromarray(np.round(np.clip(rgba, 0, 1) * 255).astype(np.uint8), 'RGBA').transpose(flip).save(os.path.join(OUT, 'gravel_c.webp'), 'WEBP', quality=90, method=6, exact=True)
Image.fromarray(np.round(np.clip(nrm, 0, 1) * 255).astype(np.uint8), 'RGB').transpose(flip).save(os.path.join(OUT, 'gravel_n.webp'), 'WEBP', quality=90, method=6)
for f in ('gravel_c.webp', 'gravel_n.webp'):
    print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')
