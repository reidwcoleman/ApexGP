"""The land under Porthenys Cove, as a height function. Pure numpy, so it can be drawn and checked without Blender.
Metres, x east, y north, z up. The sea is to the south; a valley climbs north-east from the beach.
"""
import numpy as np

X0, X1, Y0, Y1 = -260.0, 260.0, -220.0, 300.0
STEP = 1.0
SEA = 0.0


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _hash(ix, iy, seed):
    n = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFFFF) / float(0xFFFFFF)


def noise(x, y, seed=0):
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = x - ix, y - iy
    ux, uy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = _hash(ix, iy, seed), _hash(ix + 1, iy, seed)
    c, d = _hash(ix, iy + 1, seed), _hash(ix + 1, iy + 1, seed)
    return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1


def fbm(x, y, f, n=5, seed=1, gain=0.5):
    s, a, t = 0.0, 1.0, 0.0
    for i in range(n):
        s = s + noise(x * f, y * f, seed + i) * a
        t += a
        a *= gain
        f *= 2.03
    return s / t


def soft(v, k=14.0):
    """max(v, 0) without the kink"""
    return k * np.logaddexp(0, v / k)


def valley_x(y):
    """where the valley floor runs"""
    u = soft(y - 24)
    return 14 + 0.42 * u + 11 * np.sin(u / 42)


def shore(x):
    """y of the tide line: a straight coast with the cove bitten out of it"""
    w = 0.5 * np.sin(x / 31) + 0.3 * np.sin(x / 13 + 1.3)
    return -46 + 8 * w + 70 * np.exp(-(((x - 12) / 42) ** 2))


def land(x, y):
    """(height, rockiness 0..1)"""
    wob = fbm(x, y, 0.012, 4, 3) * 12
    s = y - shore(x + wob * 0.6) + fbm(x, y, 0.05, 3, 9) * 3.5
    xv = valley_x(y)
    d = np.abs(x - xv) + wob * 0.4
    climb = 3.0 + soft(y - 22) * 0.15
    # the west headland stands much taller than the east shoulder
    west = x < xv
    ridge = np.where(west, 46 + 10 * smooth(-40, -170, x), 30 + 14 * smooth(40, 170, x)) + fbm(x, y, 0.009, 3, 21) * 10
    width = 24 + 0.08 * soft(y, 30)
    up = smooth(width, width + 125, d) ** 1.15
    h = climb + ridge * up
    # the sea takes the land back: steep where the ground is high, a beach in the middle of the cove
    cove = np.exp(-(((x - 12) / 34) ** 2))
    cliff_w = 3.5 + 12 * cove + 2.2 * fbm(x, y, 0.04, 3, 31)
    edge = smooth(0, cliff_w, s)
    h = h * edge ** (0.55 + 1.3 * cove)
    # the beach: shingle, flat enough to walk, and a gentle climb to the village
    beach = cove * smooth(30, 8, s) * smooth(-3, 2, s)
    h = h * (1 - beach) + (s * 0.13) * beach
    # below the tide line, the seabed falls away; a shelf of rock runs out from the headlands
    depth = np.clip(-s, 0, None)
    bed = -(depth * (0.1 + 0.1 * (1 - cove))) ** 0.92
    h = np.where(s < 0, bed, h)
    # strata: rock lies in tilted beds, and the beds show wherever the ground is steep
    n = fbm(x, y, 0.02, 3, 41)
    strata = np.sin((h + x * 0.12 + y * 0.05) * 1.05 + n * 11.0)
    gx, gy = np.gradient(h, STEP)
    steep = smooth(0.7, 1.4, np.hypot(gx, gy))
    coast = smooth(70, 10, np.abs(s)) * smooth(-30, 2, s)
    h = h + strata * 1.1 * steep * coast + fbm(x, y, 0.11, 4, 51) * (0.4 + 2.4 * steep * coast)
    # rock skerries off the two points
    sk = np.maximum(fbm(x, y, 0.032, 4, 61) - 0.2, 0) * 26 * smooth(-44, -6, s) * smooth(2, -4, s) * (1 - cove * 0.95)
    h = h + sk
    return h, steep


def _slope(h):
    gx, gy = np.gradient(h, STEP)
    return np.hypot(gx, gy)


def grid():
    xs = np.arange(X0, X1 + STEP, STEP)
    ys = np.arange(Y0, Y1 + STEP, STEP)
    X, Y = np.meshgrid(xs, ys)
    return X, Y


def build(pads=()):
    """pads: (x0, y0, x1, y1, z, margin), levelled ground for houses and lanes"""
    X, Y = grid()
    H, steep = land(X, Y)
    for x0, y0, x1, y1, z, mg in pads:
        dx = np.maximum(np.maximum(x0 - X, X - x1), 0)
        dy = np.maximum(np.maximum(y0 - Y, Y - y1), 0)
        k = smooth(mg, 0, np.hypot(dx, dy))
        H = H * (1 - k) + z * k
    return X, Y, H


if __name__ == '__main__':
    import sys
    from PIL import Image
    X, Y, H = build()
    gy, gx = np.gradient(H, STEP)
    n = np.dstack([-gx, -gy, np.ones_like(H)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    l = np.array([-0.5, 0.45, 0.74])
    sh = np.clip(n @ l, 0, 1)
    sl = np.hypot(gx, gy)
    grass = np.array([0.33, 0.47, 0.2]); rock = np.array([0.42, 0.4, 0.38]); sand = np.array([0.62, 0.55, 0.44]); sea = np.array([0.1, 0.36, 0.38])
    c = np.where((sl > 0.95)[..., None], rock, grass)
    c = np.where(((H < 3) & (H > -0.2))[..., None], sand, c)
    c = c * (0.35 + 0.9 * sh[..., None])
    c = np.where((H < 0)[..., None], sea * (1 + np.clip(H / 14, -1, 0))[..., None], c)
    im = Image.fromarray((np.clip(c[::-1], 0, 1) * 255).astype('uint8'))
    im.save(sys.argv[1] if len(sys.argv) > 1 else '/tmp/cove.png')
    print('h', H.min(), H.max(), 'walkable share', float(((sl < 0.9) & (H > 0)).mean()))
