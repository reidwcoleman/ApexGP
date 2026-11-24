"""Downsample the rendered leaf atlas 2x, bleed the colour into the transparent texels (no dark halos in
the mips), flatten the normal map outside the leaves, write webp. work/venv/bin/python foliage/atlas_post.py"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(HERE, '..', 'work')
OUT = os.path.join(HERE, '..', '..', '..', 'public', 'oceandrive', 'tex')
alb = Image.open(os.path.join(W, 'atlas_albedo.png')).convert('RGBA')
nor = Image.open(os.path.join(W, 'atlas_normal.png')).convert('RGBA')
size = (alb.width // 2, alb.height // 2)
alb = alb.resize(size, Image.LANCZOS)
nor = nor.resize(size, Image.LANCZOS)
a = np.asarray(alb).astype(np.float32)
al = a[..., 3]
empty = al < 40
_, (iy, ix) = ndimage.distance_transform_edt(empty, return_indices=True)
rgb = a[..., :3][iy, ix]
img = Image.fromarray(np.concatenate([rgb, al[..., None]], -1).astype(np.uint8), 'RGBA')
img.save(os.path.join(OUT, 'palm_atlas.webp'), quality=92, method=6)
# the bakes (Cycles shadows through the leaves) read the same atlas
img.save(os.path.join(HERE, '..', 'assets', 'gen', 'palm_atlas.png'))
n = np.asarray(nor).astype(np.float32)[..., :3]
n = n[iy, ix]
flat = np.array([128, 128, 255], np.float32)
w = np.clip(al / 255.0, 0, 1)[..., None]
n = n * w + flat * (1 - w)
Image.fromarray(n.astype(np.uint8), 'RGB').save(os.path.join(OUT, 'palm_atlas_n.webp'), quality=92, method=6)
print('atlas', size)
