"""The new Monza's photo textures (public/monza/): every one is made from an image generated for this
circuit (Higgsfield, GPT Image 2.6; sources in assets-src/generated/monza, out of git) — nothing from
the earlier circuits' texture sets. Missing sources are written as plain stand-ins so the game runs.
python3 tools/build_monza.py"""
import os
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'assets-src', 'generated', 'monza')
# (git-ignored: the game no longer loads these directly; tools/build_monza_surface.py packs the asphalt
# and the grass from here into public/textures for the trackside shaders)
OUT = os.path.join(ROOT, 'assets-src', 'generated', 'monza', 'built')
os.makedirs(OUT, exist_ok=True)
W3 = np.array([0.2126, 0.7152, 0.0722])

def to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def to_srgb(l):
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(np.clip(l, 0, 1), 1 / 2.4) - 0.055)

def blur(a, r):
    m = max(a.max(), 1e-6)
    return np.asarray(Image.fromarray(np.uint8(np.clip(a / m, 0, 1) * 255)).filter(ImageFilter.GaussianBlur(r)), dtype=np.float64) / 255 * m

def tileable(a):
    """cross-fade with the half-offset copy (variance kept), so the tile wraps"""
    h, w = a.shape[:2]
    b = np.roll(a, (h // 2, w // 2), axis=(0, 1))
    y = np.abs(np.linspace(-1, 1, h, endpoint=False))[:, None]
    x = np.abs(np.linspace(-1, 1, w, endpoint=False))[None, :]
    wgt = np.clip((0.92 - np.maximum(x, y)) / 0.3, 0, 1)
    wgt = (wgt * wgt * (3 - 2 * wgt))[..., None]
    m = a.reshape(-1, a.shape[-1]).mean(0)
    return (a * wgt + b * (1 - wgt) - m) / np.sqrt(wgt * wgt + (1 - wgt) * (1 - wgt)) + m

def material(img, size, mean=None, flatten=True):
    """a square photo → a flat-lit, tileable linear albedo (float, HxWx3)"""
    s = min(img.size)
    img = img.convert('RGB').crop(((img.size[0] - s) // 2, (img.size[1] - s) // 2, (img.size[0] + s) // 2, (img.size[1] + s) // 2)).resize((size, size), Image.LANCZOS)
    lin = to_lin(np.asarray(img, dtype=np.float64) / 255)
    if flatten:
        lum = lin @ W3
        low = blur(lum, size / 6)
        lin *= (low.mean() / np.maximum(low, 1e-4))[..., None]
    lin = tileable(lin)
    if mean is not None:
        m = lin.reshape(-1, 3).mean(0)
        lin *= (np.array(mean) @ W3) / (m @ W3)
    return np.clip(lin, 0, 1)

def normals(lin, k=2.0, soft=1.0):
    h = blur(lin @ W3, soft)
    h = (h - h.mean()) / max(h.std(), 1e-5) * 0.18
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * k
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * k
    nz = 1 / np.sqrt(dx * dx + dy * dy + 1)
    return np.stack([-dx * nz * 0.5 + 0.5, dy * nz * 0.5 + 0.5, nz * 0.5 + 0.5], -1)

def save(name, arr, q=88):
    mode = 'RGBA' if arr.shape[-1] == 4 else 'RGB'
    Image.fromarray(np.round(np.clip(arr, 0, 1) * 255).astype(np.uint8), mode).save(os.path.join(OUT, name), 'WEBP', quality=q, method=6, exact=True)
    print(name, os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')

def src(name):
    p = os.path.join(SRC, name)
    return Image.open(p) if os.path.exists(p) else None

def standin(size, rgb, amp=0.25, seed=1):
    r = np.random.default_rng(seed)
    n = r.random((size, size))
    n = 0.6 * blur(n, 1.2) + 0.4 * n
    return np.clip(np.array(rgb)[None, None, :] * (1 - amp + 2 * amp * n[..., None]), 0, 1)

def quadrant(img, qx, qy):
    w, h = img.size
    m = int(w * 0.012)
    return img.crop((qx * w // 2 + m, qy * h // 2 + m, (qx + 1) * w // 2 - m, (qy + 1) * h // 2 - m))

# ---- asphalt: the fresh, near-black surface laid at Monza for 2024
a = src('asphalt.png')
lin = material(a, 1024, mean=[0.075, 0.075, 0.077]) if a else standin(1024, [0.06, 0.06, 0.062], 0.3)
save('asphalt_c.webp', to_srgb(lin), 90)
save('asphalt_n.webp', normals(lin, 2.4, 0.8), 90)

# ---- the 2 x 2 sheet: lawn, woodland floor, concrete, worn white paint
sheet = src('materials.png')
for name, (qx, qy), mean, col in [('grass', (0, 0), [0.07, 0.115, 0.03], [0.07, 0.115, 0.03]), ('floor', (1, 0), [0.09, 0.075, 0.05], [0.09, 0.075, 0.05]), ('concrete', (0, 1), [0.3, 0.3, 0.29], [0.3, 0.3, 0.29]), ('paint', (1, 1), [0.6, 0.6, 0.58], [0.6, 0.6, 0.58])]:
    q = quadrant(sheet, qx, qy) if sheet else None
    if q and name == 'paint':
        # (that quadrant came as a painted band across asphalt: the band's own middle is the paint)
        w, h = q.size
        q = q.crop((0, int(h * 0.42), w, int(h * 0.66))).resize((w, w), Image.LANCZOS)
    lin = material(q, 1024, mean=mean) if q else standin(1024, col, 0.22, hash(name) % 1000)
    save(name + '_c.webp', to_srgb(lin), 86)
    if name in ('grass', 'concrete'):
        save(name + '_n.webp', normals(lin, 1.6, 1.0), 86)

# ---- gravel (the bed of limestone chippings generated on 2026-11-10)
g = src('gravel.png')
lin = material(g, 1024, mean=[0.17, 0.166, 0.155]) if g else standin(1024, [0.17, 0.166, 0.155], 0.3)
save('gravel_c.webp', to_srgb(lin), 88)
save('gravel_n.webp', normals(lin, 2.2, 1.2), 88)

# ---- kerb paint (detail only: the blocks' colours are painted by the shader)
k = src('kerb.png')
if k:
    k = k.convert('RGB')
    save('kerb_c.webp', np.asarray(k.resize((1024, 1024), Image.LANCZOS), dtype=np.float64) / 255, 86)

# ---- cut-outs: the woodland edge, the four trees, the crowd
def cutout(name, out, size, fallback, crop=False):
    im = src(name)
    if im is None:
        im = fallback()
    im = im.convert('RGBA')
    if crop:
        # (down to the rows that hold anything: a tree fills its card from root to crown)
        al0 = np.asarray(im)[..., 3]
        ys = np.where((al0 > 40).mean(1) > 0.004)[0]
        im = im.crop((0, max(0, ys[0] - 4), im.size[0], min(im.size[1], ys[-1] + 2)))
    im = im.resize(size, Image.LANCZOS)
    a = np.asarray(im, dtype=np.float64) / 255
    # (colour bled out under the transparent texels, so the mips don't pick up a dark or white fringe)
    rgb, al = a[..., :3].copy(), a[..., 3]
    known = al > 0.5
    fill = rgb * known[..., None]
    wsum = known.astype(np.float64)
    for r in (2, 4, 8, 16, 32):
        fb = np.stack([blur(fill[..., c], r) for c in range(3)], -1)
        wb = blur(wsum, r)
        est = fb / np.maximum(wb, 1e-4)[..., None]
        need = (~known) & (wb > 1e-3)
        rgb[need] = est[need]
        known = known | need
        fill = rgb * known[..., None]
        wsum = known.astype(np.float64)
    save(out, np.concatenate([rgb, al[..., None]], -1), 88)

def blob_trees(n, w, h):
    def f():
        r = np.random.default_rng(7)
        im = np.zeros((h, w, 4))
        yy, xx = np.mgrid[0:h, 0:w]
        for i in range(n):
            cx = (i + 0.5) * w / n
            for _ in range(60):
                bx, by, br = cx + r.normal(0, w / n * 0.2), h * (0.15 + 0.5 * r.random()), w / n * (0.08 + 0.1 * r.random())
                m = ((xx - bx) ** 2 + (yy - by) ** 2) < br * br
                im[m] = [0.1 + 0.08 * r.random(), 0.22 + 0.14 * r.random(), 0.06, 1]
            m = (np.abs(xx - cx) < w / n * 0.03) & (yy > h * 0.6)
            im[m] = [0.16, 0.12, 0.09, 1]
        return Image.fromarray(np.uint8(im * 255), 'RGBA')
    return f

cutout('treeline.png', 'treeline.webp', (4096, 1024), blob_trees(14, 2048, 512), crop=True)
cutout('treeline2.png', 'treeline2.webp', (4096, 1024), blob_trees(11, 2048, 512))
cutout('trees.png', 'trees.webp', (2048, 1024), blob_trees(4, 1024, 512), crop=True)
c = src('crowd.png')
if c:
    c = c.convert('RGB').resize((2048, 868), Image.LANCZOS)
    save('crowd.webp', np.asarray(c, dtype=np.float64) / 255, 84)
