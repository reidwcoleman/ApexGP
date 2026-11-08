"""Blender: what a hospital leaves behind, modelled. Each piece is at real size, origin on the floor (or the ceiling, for what
hangs), looking along -y like every other module, so rot means the same as anywhere else.

  hbed     a ward bed: tube frame, raised head, side rails (one dropped), castors, a mattress and a sheet pulled half off
  iv       a drip stand on five feet, a bag still hanging
  curtain  a ceiling track and what's left of the curtain on it: pleats, torn at the foot, some hooks empty
  screen   a three-leaf folding screen, one leaf swung out
  tile     a ceiling tile hanging by a corner from its grid, origin at the ceiling
  litter   papers, a clipboard, broken tile on the floor (2 x 2 m)
  sign     a sign hung from the ceiling over a corridor, origin at the ceiling
"""
import math, random
import bpy, bmesh
from mathutils import Vector, Matrix
from cove_kit import B, mat

STEEL = lambda: mat('lfsteel', (0.55, 0.56, 0.56), 0.38, 1.0)
CHROME = lambda: mat('lfchrome', (0.75, 0.76, 0.77), 0.22, 1.0)
CREAM = lambda: mat('lfcream', (0.62, 0.6, 0.52), 0.5)
MATT = lambda: mat('lfmattress', (0.36, 0.42, 0.44), 0.7)
SHEET = lambda: mat('lfsheet', (0.6, 0.6, 0.57), 0.9)
CLOTH = lambda: mat('lfcurtain', (0.4, 0.5, 0.47), 0.95)
RUBBER = lambda: mat('lfrubber', (0.03, 0.03, 0.03), 0.7)
BAG = lambda: mat('lfbag', (0.55, 0.58, 0.55), 0.15)
PAPER = lambda: mat('lfpaper', (0.62, 0.6, 0.53), 0.95)
PAPER2 = lambda: mat('lfpaper2', (0.5, 0.45, 0.34), 0.95)
BOARD = lambda: mat('lfboard', (0.3, 0.2, 0.12), 0.6)
TILE = lambda: mat('lftile', (0.62, 0.61, 0.57), 0.95)
SIGN = lambda: mat('lfsign', (0.08, 0.16, 0.3), 0.5)
SIGNW = lambda: mat('lfsignw', (0.72, 0.72, 0.68), 0.5)


def rod(b, p0, p1, r, m, n=8):
    """a tube from p0 to p1, capped"""
    i = b.idx(m)
    a, c = Vector(p0), Vector(p1)
    d = (c - a)
    L = d.length
    if L < 1e-5: return
    z = d / L
    x = z.cross(Vector((0, 0, 1))) if abs(z.z) < 0.95 else z.cross(Vector((1, 0, 0)))
    x.normalize(); y = z.cross(x)
    lo, hi = [], []
    for k in range(n):
        t = k * 2 * math.pi / n
        o = x * (r * math.cos(t)) + y * (r * math.sin(t))
        lo.append(b.bm.verts.new(a + o)); hi.append(b.bm.verts.new(c + o))
    for k in range(n):
        b.bm.faces.new((lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k])).material_index = i
    b.bm.faces.new(list(reversed(lo))).material_index = i
    b.bm.faces.new(hi).material_index = i


def quad(b, pts, m, two=True):
    """a flat piece; two: a back face too, for cloth and paper seen from either side"""
    i = b.idx(m)
    v = [b.bm.verts.new(p) for p in pts]
    b.bm.faces.new(v).material_index = i
    if two:
        w = [b.bm.verts.new(Vector(p)) for p in reversed(pts)]
        b.bm.faces.new(w).material_index = i


def obox(b, c, size, yaw, m, tilt=(0.0, 0.0)):
    """a box turned about z (and tipped a little)"""
    i = b.idx(m)
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    R = Matrix.Rotation(yaw, 3, 'Z') @ Matrix.Rotation(tilt[0], 3, 'X') @ Matrix.Rotation(tilt[1], 3, 'Y')
    C = Vector(c)
    v = [b.bm.verts.new(C + R @ Vector(p)) for p in ((-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz), (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz))]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        b.bm.faces.new([v[k] for k in f]).material_index = i


def hbed(b, rng):
    W, L, H = 0.92, 2.06, 0.56
    x, y = W / 2, L / 2
    S = STEEL()
    # castors and legs
    for (cx, cy) in ((-x + 0.06, -y + 0.08), (x - 0.06, -y + 0.08), (-x + 0.06, y - 0.08), (x - 0.06, y - 0.08)):
        rod(b, (cx - 0.035, cy, 0.05), (cx + 0.035, cy, 0.05), 0.05, RUBBER(), 10)
        rod(b, (cx, cy, 0.1), (cx, cy, H - 0.06), 0.022, S)
    # the frame round the spring base
    for (p0, p1) in (((-x, -y, H - 0.06), (x, -y, H - 0.06)), ((-x, y, H - 0.06), (x, y, H - 0.06)),
                     ((-x, -y, H - 0.06), (-x, y, H - 0.06)), ((x, -y, H - 0.06), (x, y, H - 0.06))):
        rod(b, p0, p1, 0.018, S)
    for k in range(1, 9):
        yy = -y + k * L / 9
        rod(b, (-x, yy, H - 0.06), (x, yy, H - 0.06), 0.006, S, 5)
    # head and foot: panels on posts, the head end higher
    for (yy, top) in ((y, 1.05), (-y, 0.86)):
        rod(b, (-x, yy, 0.1), (-x, yy, top), 0.02, S)
        rod(b, (x, yy, 0.1), (x, yy, top), 0.02, S)
        rod(b, (-x, yy, top), (x, yy, top), 0.02, S)
        obox(b, (0, yy, (H + top) / 2 + 0.04), (W - 0.08, 0.025, top - H - 0.1), 0, CREAM())
    # the back rest raised: mattress in two parts, the head part tipped up
    obox(b, (0, -0.25, H + 0.07), (W - 0.1, 1.42, 0.14), 0, MATT())
    hinge = 0.46
    ang = rng.uniform(0.25, 0.6)
    obox(b, (0, hinge + 0.3 * math.cos(ang), H + 0.07 + 0.3 * math.sin(ang)), (W - 0.1, 0.6, 0.14), 0, MATT(), tilt=(ang, 0))
    # the sheet, pulled half off one side and hanging
    s = 1 if rng.random() < 0.5 else -1
    quad(b, [(-x + 0.02, -0.9, H + 0.145), (x - 0.02, -0.9, H + 0.145), (x - 0.02, 0.35, H + 0.145), (-x + 0.02, 0.35, H + 0.145)], SHEET(), two=False)
    edge = s * (x + 0.02)
    quad(b, [(edge, -0.85, H + 0.14), (edge, 0.3, H + 0.14), (edge + s * 0.06, 0.4, H - 0.4), (edge + s * 0.1, -0.7, H - 0.5)], SHEET())
    # side rails: one up, one dropped
    for side, up in ((-1, True), (1, False)):
        xx = side * (x + 0.03)
        zt = H + 0.38 if up else H + 0.05
        for yy in (-0.6, 0.45):
            rod(b, (xx, yy, H - 0.02), (xx, yy, zt), 0.012, CHROME())
        for k in range(3):
            z = zt - k * 0.12
            if z < H - 0.02: continue
            rod(b, (xx, -0.66, z), (xx, 0.52, z), 0.012, CHROME())


def iv(b, rng):
    S = CHROME()
    for k in range(5):
        a = k * 2 * math.pi / 5
        rod(b, (0, 0, 0.1), (math.cos(a) * 0.3, math.sin(a) * 0.3, 0.06), 0.012, S)
        rod(b, (math.cos(a) * 0.3 - 0.02, math.sin(a) * 0.3, 0.03), (math.cos(a) * 0.3 + 0.02, math.sin(a) * 0.3, 0.03), 0.028, RUBBER(), 8)
    rod(b, (0, 0, 0.06), (0, 0, 1.95), 0.013, S)
    for k in range(2):
        a = k * math.pi
        rod(b, (0, 0, 1.95), (math.cos(a) * 0.14, math.sin(a) * 0.14, 1.99), 0.006, S, 5)
    # a bag, near empty, its line hanging down and cut
    obox(b, (0.13, 0, 1.78), (0.09, 0.025, 0.17), 0, BAG())
    rod(b, (0.13, 0, 1.69), (0.17, 0.02, 0.9), 0.0035, BAG(), 4)


def curtain(b, rng):
    # the track on the ceiling, origin at the ceiling, 2.4 m along x, round the corner 1.6 m along -y
    T = STEEL()
    obox(b, (0, 0, -0.02), (2.4, 0.03, 0.03), 0, T)
    obox(b, (1.2, -0.8, -0.02), (0.03, 1.6, 0.03), 0, T)
    for xx in (-1.0, 1.0):
        rod(b, (xx, 0, -0.03), (xx, 0, 0), 0.006, T, 5)
    # pleats: a zigzag hanging from a part of the track, torn ragged at the foot
    def hang(x0, x1, along_y=False):
        n = max(3, int(abs(x1 - x0) / 0.11))
        pts = []
        for k in range(n + 1):
            t = x0 + (x1 - x0) * k / n
            off = 0.06 if k % 2 else -0.06
            pts.append((t, off))
        # the hem: long, with a few places torn up short
        bot = [-0.08 - (rng.uniform(2.55, 2.85) if rng.random() < 0.8 else rng.uniform(1.3, 2.2)) for _ in range(n + 1)]
        for k in range(n):
            (a, oa), (c, oc) = pts[k], pts[k + 1]
            za, zc = bot[k], bot[k + 1]
            if along_y:
                P = [(1.2 + oa, a, -0.06), (1.2 + oc, c, -0.06), (1.2 + oc, c, zc), (1.2 + oa, a, za)]
            else:
                P = [(a, oa, -0.06), (c, oc, -0.06), (c, oc, zc), (a, oa, za)]
            quad(b, P, CLOTH())
    hang(-1.15, -0.2)
    hang(0.5, 1.15)
    hang(-0.05, -0.9, along_y=True)


def screen(b, rng):
    S = STEEL()
    W, H = 0.62, 1.7
    x = -W * 1.5
    y = 0.0
    for k, ang in enumerate((0.0, -0.35, 0.8)):
        dx, dy = math.cos(ang) * W, math.sin(ang) * W
        x1, y1 = x + dx, y + dy
        for (px, py) in ((x, y), (x1, y1)):
            rod(b, (px, py, 0.0), (px, py, H), 0.012, S)
        rod(b, (x, y, H), (x1, y1, H), 0.012, S)
        rod(b, (x, y, 0.25), (x1, y1, 0.25), 0.012, S)
        quad(b, [(x, y, 0.27), (x1, y1, 0.27), (x1, y1, H - 0.03), (x, y, H - 0.03)], CLOTH())
        x, y = x1, y1


def tile(b, rng):
    # a broken length of the T-bar and a tile hanging off it by one corner
    obox(b, (0.0, 0.0, -0.012), (0.6, 0.024, 0.024), 0, CREAM())
    obox(b, (0.32, -0.25, -0.12), (0.024, 0.55, 0.024), 0, CREAM(), tilt=(0.42, 0))
    a = rng.uniform(1.0, 1.3)
    obox(b, (0.0, -0.3 * math.cos(a) - 0.02, -0.3 * math.sin(a) - 0.02), (0.6, 0.6, 0.016), rng.uniform(-0.2, 0.2), TILE(), tilt=(-a, rng.uniform(-0.2, 0.2)))


def litter(b, rng):
    for k in range(16):
        x, y = rng.uniform(-1, 1), rng.uniform(-1, 1)
        w, h = (0.21, 0.297) if rng.random() < 0.8 else (0.15, 0.1)
        a = rng.uniform(0, math.pi)
        tip = rng.uniform(-0.15, 0.15)
        m = PAPER() if rng.random() < 0.7 else PAPER2()
        obox(b, (x, y, 0.004 + k * 0.0012), (w, h, 0.002), a, m, tilt=(0, tip * 0.1))
    obox(b, (rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), 0.008), (0.23, 0.32, 0.006), rng.uniform(0, 3), BOARD())
    for k in range(5):
        obox(b, (rng.uniform(-0.9, 0.9), rng.uniform(-0.9, 0.9), 0.012), (rng.uniform(0.08, 0.24), rng.uniform(0.06, 0.2), 0.016), rng.uniform(0, 3), TILE(), tilt=(rng.uniform(-0.1, 0.1), 0))


def sign(b, rng):
    for xx in (-0.4, 0.4):
        rod(b, (xx, 0, 0), (xx, 0, -0.3), 0.005, STEEL(), 5)
    obox(b, (0, 0, -0.43), (1.1, 0.04, 0.26), 0, SIGN(), tilt=(0, rng.uniform(-0.03, 0.12)))
    # an arrow and a word, no more than blocks of white at this distance
    obox(b, (-0.36, -0.021, -0.43), (0.16, 0.003, 0.05), 0, SIGNW())
    obox(b, (0.12, -0.021, -0.43), (0.56, 0.003, 0.07), 0, SIGNW())


KINDS = dict(hbed=hbed, iv=iv, curtain=curtain, screen=screen, tile=tile, litter=litter, sign=sign)


def make(name):
    """name is kind or kind_N (a seed, for the pieces that vary)"""
    kind, _, seed = name.partition('_')
    b = B('w_' + name)
    KINDS[kind](b, random.Random(sum(map(ord, name)) if not seed else int(seed)))
    return b.done()
