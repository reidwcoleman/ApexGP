"""Pack the Blender-rendered ground tiles (tools/blender/ground_bake.py → assets-src/blender/ground:
colour, normal and height of a modelled gravel bed and a modelled sward, already tiling) for the
trackside shaders: public/textures/gravel_c.webp (RGB albedo + A height), gravel_n.webp, grass_c.webp
and grass_n.webp. Brightness is matched to the levels GRAVEL_FRAG / GRASS_FRAG were graded on; the
normals are the geometry's own. Stored upside down (uploaded as ImageBitmaps with no flipY).

  blender -b -P tools/blender/ground_bake.py -- gravel assets-src/blender/ground
  blender -b -P tools/blender/ground_bake.py -- grass assets-src/blender/ground
  python3 tools/build_ground.py"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'assets-src', 'blender', 'ground')
OUT = os.path.join(ROOT, 'public', 'textures')
W = np.array([0.2126, 0.7152, 0.0722])
GRAVEL_MEAN = np.array([0.3095, 0.2808, 0.2352])
GRASS_MEAN = np.array([0.0499, 0.0841, 0.0209]) * np.array([1.95, 1.8, 1.6])
FLIP = Image.Transpose.FLIP_TOP_BOTTOM

def load(name):
    a = np.asarray(Image.open(os.path.join(SRC, name)))
    return a[..., :3].astype(np.float64) / (65535 if a.dtype == np.uint16 else 255)

def to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def to_srgb(l):
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(np.clip(l, 0, 1), 1 / 2.4) - 0.055)

def u8(a):
    return np.round(np.clip(a, 0, 1) * 255).astype(np.uint8)

def normals(name, gain):
    n = load(name) * 2 - 1
    n[..., :2] *= gain
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5

def save(img, name, **kw):
    img.transpose(FLIP).save(os.path.join(OUT, name), 'WEBP', method=4, **kw)
    print(name, os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')

# gravel: the stone's own grey at the old bed's brightness
lin = to_lin(load('gravel_colour.png'))
m = lin.reshape(-1, 3).mean(0)
grey = m * (GRAVEL_MEAN @ W) / (m @ W)
lin *= (grey * 0.95 + GRAVEL_MEAN * 0.05) / m
# (the render's deep black gaps, seen from a metre up, crawl as salt-and-pepper: ease the contrast a third)
lin = lin.reshape(-1, 3).mean(0) + (lin - lin.reshape(-1, 3).mean(0)) * 0.68
h = load('gravel_height.png')[..., 0]
h = np.clip((h - h.mean()) / max(h.std(), 1e-4) * 0.177 + 0.628, 0, 1)
save(Image.fromarray(u8(np.concatenate([to_srgb(lin), h[..., None]], -1)), 'RGBA'), 'gravel_c.webp', quality=92, exact=True)
save(Image.fromarray(u8(normals('gravel_normal.png', 1.0))), 'gravel_n.webp', quality=92)

# grass: two thirds its own hue, at the level the verge shader expects
lin = to_lin(load('grass_colour.png'))
m = lin.reshape(-1, 3).mean(0)
own = m * (GRASS_MEAN @ W) / (m @ W)
lin *= (own * 0.65 + GRASS_MEAN * 0.35) / m
save(Image.fromarray(u8(to_srgb(lin))), 'grass_c.webp', quality=92)
# (blades lie every way: their true normals, full strength, sparkle under a low sun — eased toward the ground's)
save(Image.fromarray(u8(normals('grass_normal.png', 0.55))), 'grass_n.webp', quality=92)
