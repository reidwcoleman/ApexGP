# Fill the tree atlases' empty/edge texels from their solid neighbours (push-pull), so mips and
# bilinear filtering never pull black colour or backward normals into a leaf's edge. Without it every
# crown and leaf clump had a dark ink outline (the colour mips bled the black under transparent
# texels; leaf_n's half-size normals at the edge pointed backwards, imp_n's AO was dark at the rim).
# Run after tools/bake_trees.mjs, in a folder holding public/trees/{leaf,imp}_{c,n}.webp:
#   python3 tools/fix_tree_atlas.py && re-encode the PNGs (cwebp -q 80/88/78/85 -alpha_q 100 -exact -m 6)
import numpy as np
from PIL import Image

def pushpull(val, w):
    """val HxWxC, w HxW weights (0..1); returns val filled where w==0 by weighted pyramid average"""
    levels = []
    c = val * w[..., None]
    ww = w.copy()
    while True:
        levels.append((c, ww))
        H, W = ww.shape
        if H <= 1 or W <= 1:
            break
        H2, W2 = H // 2 * 2, W // 2 * 2
        c = c[:H2, :W2].reshape(H2 // 2, 2, W2 // 2, 2, -1).sum(axis=(1, 3))
        ww = ww[:H2, :W2].reshape(H2 // 2, 2, W2 // 2, 2).sum(axis=(1, 3))
    # coarsest
    c, ww = levels[-1]
    filled = np.where(ww[..., None] > 0, c / np.maximum(ww, 1e-9)[..., None], 0)
    for c, ww in reversed(levels[:-1]):
        H, W = ww.shape
        up = np.repeat(np.repeat(filled, 2, axis=0), 2, axis=1)
        if up.shape[0] < H or up.shape[1] < W:
            up = np.pad(up, ((0, H - up.shape[0]), (0, W - up.shape[1]), (0, 0)), mode='edge')
        up = up[:H, :W]
        own = c / np.maximum(ww, 1e-9)[..., None]
        k = np.clip(ww, 0, 1)[..., None]
        filled = own * k + up * (1 - k)
    return filled

def load(f):
    return np.array(Image.open(f + '.webp').convert('RGBA')).astype(np.float64) / 255

for cf, nf in [('leaf_c', 'leaf_n'), ('imp_c', 'imp_n')]:
    c = load(cf)
    a = c[..., 3]
    # colour: fill the transparent texels (alpha kept exactly)
    solid = (a > 0.5).astype(np.float64)
    fill = pushpull(c[..., :3], solid)
    rgb = np.where((a < 0.5)[..., None], fill, c[..., :3])
    out = np.dstack([rgb, a])
    Image.fromarray(np.round(out * 255).clip(0, 255).astype(np.uint8), 'RGBA').save(cf + '.png')
    # normals (+ their alpha: AO / leaf shade) at half size: coverage from the colour's alpha
    n = load(nf)
    H, W = a.shape
    cov = a.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3))
    wN = (cov > 0.9).astype(np.float64)
    nfill = pushpull(n, wN)
    nout = np.where((cov <= 0.9)[..., None], nfill, n)
    # renormalise the filled normals
    v = nout[..., :3] * 2 - 1
    v /= np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-6)
    nout[..., :3] = np.where((cov <= 0.9)[..., None], v * 0.5 + 0.5, nout[..., :3])
    Image.fromarray(np.round(nout * 255).clip(0, 255).astype(np.uint8), 'RGBA').save(nf + '.png')
    # report
    for lo, hi in [(0.01, 0.5), (0.5, 0.9), (0.9, 1.01)]:
        m = (cov >= lo) & (cov < hi)
        print(nf, lo, hi, 'alpha', nout[..., 3][m].mean().round(3), 'nz', (nout[..., 2][m] * 2 - 1).mean().round(3))
