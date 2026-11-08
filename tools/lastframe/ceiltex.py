"""A drop ceiling that's been left: 600 mm mineral-fibre tiles in a T-bar grid, eight by eight (4.8 m), water rings, a few
tiles gone to the dark above. Writes lf_ceiling_tiles_{diff,nor,arm}.jpg at 1k and 2k beside the Poly Haven scans."""
import os
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

R = os.path.join(os.path.dirname(__file__), '..', '..', 'assets-src', 'lf')
N, T = 2048, 8
P = N // T
rng = np.random.default_rng(7)
y, x = np.mgrid[0:N, 0:N].astype(np.float32)


def noise(s, k=1.0):
    n = gaussian_filter(rng.standard_normal((N, N)).astype(np.float32), s, mode='wrap')
    return n / (n.std() + 1e-6) * k


# fissured fibre: fine speckle, small worm-like pits
speck = noise(0.7, 1.0)
pits = (noise(1.6) > 2.1).astype(np.float32)
fibre = 0.78 + speck * 0.025 - pits * 0.12 + noise(30, 0.02)
alb = np.stack([fibre * 0.93, fibre * 0.91, fibre * 0.86], -1)
height = speck * 0.15 - pits * 0.6

# the grid: a 24 mm T-bar is about 10 px, its edge a groove where the tile sits back
gx = np.minimum(x % P, P - (x % P))
gy = np.minimum(y % P, P - (y % P))
g = np.minimum(gx, gy)
bar = g < 5
alb[bar] = [0.66, 0.65, 0.62]
height = np.where(bar, 1.2, height - np.clip(1 - (g - 5) / 6, 0, 1) * 1.4)

ao = np.ones((N, N), np.float32)
rough = np.where(bar, 0.45, 0.92).astype(np.float32)

# which tiles: missing, stained, sagging dark
tiles = [(i, j) for i in range(T) for j in range(T)]
rng.shuffle(tiles)
gone, stained = tiles[:4], tiles[4:16]
ti, tj = (x // P).astype(int), (y // P).astype(int)
for (i, j) in stained:
    cx, cy = (i + rng.uniform(0.2, 0.8)) * P, (j + rng.uniform(0.2, 0.8)) * P
    r = rng.uniform(0.2, 0.55) * P
    d = np.hypot(x - cx, y - cy) / r + noise(14, 0.12)
    inside = (ti == i) & (tj == j)
    ring = np.exp(-((d - 1) ** 2) / 0.004) * 0.5 + (d < 1) * 0.22
    k = np.clip(ring, 0, 1) * inside
    alb *= 1 - k[..., None] * np.array([0.42, 0.52, 0.66])
for (i, j) in gone:
    inside = (ti == i) & (tj == j) & ~bar
    # the void above: black, a duct's edge and the slab barely there
    v = 0.012 + np.clip(noise(40, 0.006), -0.01, 0.01)
    alb[inside] = np.stack([v, v, v * 1.1], -1)[inside]
    height[inside] = -4
    ao[inside] = 0.1
    rough[inside] = 1
# dirt where the grid meets: grime gathers at the bars
grime = np.exp(-np.maximum(g - 5, 0) / 9) * (1 - bar)
alb *= (1 - grime * 0.18)[..., None]

hs = gaussian_filter(height, 0.8, mode='wrap')
dx = (np.roll(hs, -1, 1) - np.roll(hs, 1, 1)) * 0.5
dy = (np.roll(hs, -1, 0) - np.roll(hs, 1, 0)) * 0.5
nz = np.ones_like(dx)
n = np.stack([-dx * 2.2, dy * 2.2, nz], -1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
nor = (n * 0.5 + 0.5) * 255
srgb = np.clip(alb, 0, 1) ** (1 / 2.2) * 255
arm = np.stack([ao, rough, np.zeros_like(ao)], -1) * 255
for res, d in ((2048, 'tex2k'), (1024, 'tex')):
    os.makedirs(f'{R}/{d}', exist_ok=True)
    for nm, a in (('diff', srgb), ('nor', nor), ('arm', arm)):
        if d == 'tex2k' and nm == 'arm': continue
        Image.fromarray(a.astype(np.uint8)).resize((res, res), Image.LANCZOS).save(f'{R}/{d}/lf_ceiling_tiles_{nm}.jpg', quality=92)
print('ok')
