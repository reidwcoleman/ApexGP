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


RUST = lambda: mat('lfrust', (0.3, 0.17, 0.1), 0.8, 0.3)
PAINTR = lambda: mat('lfradpaint', (0.62, 0.6, 0.55), 0.55)
CORK = lambda: mat('lfcork', (0.42, 0.3, 0.18), 0.9)
PLASTER = lambda: mat('lfplaster', (0.6, 0.58, 0.54), 0.95)
DUST = lambda: mat('lfdust', (0.36, 0.34, 0.31), 1.0)
GLASSG = lambda: mat('lfbottle', (0.06, 0.12, 0.06), 0.1)
GLASSB = lambda: mat('lfbottleb', (0.16, 0.08, 0.03), 0.1)
CANM = lambda: mat('lfcan', (0.5, 0.48, 0.45), 0.35, 1.0)
CABLE = lambda: mat('lfcable', (0.02, 0.02, 0.02), 0.5)
WOOD = lambda: mat('lfpallet', (0.42, 0.33, 0.22), 0.85)
SHARD = lambda: mat('lfshard', (0.5, 0.55, 0.55), 0.04)


def radiator(b, rng):
    """a cast-iron column radiator on its feet, its pipe into the floor; front looks along -y"""
    n = rng.randint(8, 14)
    W = n * 0.06
    for k in range(n):
        x = -W / 2 + 0.03 + k * 0.06
        obox(b, (x, 0.1, 0.42), (0.045, 0.1, 0.62), 0, PAINTR())
    rod(b, (-W / 2, 0.1, 0.15), (W / 2, 0.1, 0.15), 0.018, PAINTR())
    rod(b, (-W / 2, 0.1, 0.7), (W / 2, 0.1, 0.7), 0.018, PAINTR())
    for x in (-W / 2 + 0.03, W / 2 - 0.03):
        rod(b, (x, 0.1, 0.0), (x, 0.1, 0.12), 0.02, PAINTR())
    rod(b, (W / 2 + 0.05, 0.12, 0.0), (W / 2 + 0.05, 0.12, 0.16), 0.014, RUST())
    rod(b, (W / 2, 0.12, 0.16), (W / 2 + 0.05, 0.12, 0.16), 0.014, RUST())


def board(b, rng):
    """a notice board: cork in a frame, papers pinned crooked, one hanging by a pin; origin at its foot on the wall"""
    obox(b, (0, 0.012, 1.45), (1.2, 0.024, 0.85), 0, CORK())
    for (x, z, w, h) in ((0, 1.03, 1.24, 0.03), (0, 1.87, 1.24, 0.03)):
        obox(b, (x, 0.012, z), (w, 0.03, h), 0, WOOD())
    for k in range(rng.randint(6, 10)):
        x, z = rng.uniform(-0.48, 0.48), rng.uniform(1.15, 1.75)
        w, h = (0.21, 0.297) if rng.random() < 0.7 else (0.15, 0.1)
        m = PAPER() if rng.random() < 0.7 else PAPER2()
        a = rng.uniform(-0.12, 0.12)
        c, sn = math.cos(a), math.sin(a)
        y = -0.002 - k * 0.0015
        pts = [(x + c * dx - sn * dz, y, z + sn * dx + c * dz) for (dx, dz) in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]
        quad(b, pts, m, two=False)


def debris(b, rng):
    """plaster down off a wall or ceiling: chunks, crumbs and a fan of dust"""
    i = b.idx(DUST())
    n = 14
    cv = b.bm.verts.new((0, 0, 0.012))
    ring = [b.bm.verts.new((math.cos(k * 6.283 / n) * rng.uniform(0.5, 0.9), math.sin(k * 6.283 / n) * rng.uniform(0.4, 0.7), 0.004)) for k in range(n)]
    for k in range(n):
        b.bm.faces.new((cv, ring[k], ring[(k + 1) % n])).material_index = i
    for k in range(rng.randint(10, 18)):
        r = rng.uniform(0.02, 0.12)
        obox(b, (rng.uniform(-0.6, 0.6), rng.uniform(-0.45, 0.45), r * 0.3), (r * rng.uniform(1, 2.2), r * rng.uniform(0.8, 1.8), r * rng.uniform(0.3, 0.7)), rng.uniform(0, 3),
             PLASTER(), tilt=(rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4)))


def bottles(b, rng):
    """what someone drank and left: bottles stood and fallen, cans, one crushed"""
    for k in range(rng.randint(3, 6)):
        x, y = rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4)
        m = GLASSG() if rng.random() < 0.6 else GLASSB()
        if rng.random() < 0.5:
            rod(b, (x, y, 0), (x, y, 0.2), 0.035, m, 10)
            rod(b, (x, y, 0.2), (x, y, 0.28), 0.013, m, 8)
        else:
            a = rng.uniform(0, 6.28)
            dx, dy = math.cos(a), math.sin(a)
            rod(b, (x, y, 0.035), (x + dx * 0.2, y + dy * 0.2, 0.035), 0.035, m, 10)
            rod(b, (x + dx * 0.2, y + dy * 0.2, 0.035), (x + dx * 0.28, y + dy * 0.28, 0.035), 0.013, m, 8)
    for k in range(rng.randint(2, 5)):
        x, y = rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5)
        if rng.random() < 0.5:
            rod(b, (x, y, 0), (x, y, 0.115), 0.033, CANM(), 10)
        else:
            a = rng.uniform(0, 6.28)
            rod(b, (x, y, 0.033), (x + math.cos(a) * 0.115, y + math.sin(a) * 0.115, 0.033), 0.033, CANM(), 10)


def shards(b, rng):
    """glass on the floor under a window, a metre of it"""
    i = b.idx(SHARD())
    for k in range(rng.randint(18, 30)):
        x, y = rng.uniform(-0.6, 0.6), rng.uniform(-0.35, 0.35)
        r = rng.uniform(0.015, 0.08)
        a = rng.uniform(0, 6.28)
        v = [b.bm.verts.new((x + math.cos(a + t) * r * rng.uniform(0.5, 1.2), y + math.sin(a + t) * r * rng.uniform(0.5, 1.2), 0.003 + k * 0.0003)) for t in (0, 2.1, 4.0)]
        b.bm.faces.new(v).material_index = i


def cables(b, rng):
    """cables come down out of the ceiling, sagging; origin at the ceiling"""
    for k in range(rng.randint(2, 4)):
        x0, y0 = rng.uniform(-0.6, 0.6), rng.uniform(-0.3, 0.3)
        x1, y1 = x0 + rng.uniform(-0.8, 0.8), y0 + rng.uniform(-0.3, 0.3)
        drop = rng.uniform(0.3, 1.1)
        prev = None
        for j in range(9):
            t = j / 8
            p = (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, -drop * 4 * t * (1 - t) - 0.02)
            if prev: rod(b, prev, p, 0.007, CABLE(), 5)
            prev = p
        if rng.random() < 0.6:
            rod(b, (x1, y1, -0.02), (x1 + rng.uniform(-0.1, 0.1), y1, -rng.uniform(0.6, 1.4)), 0.007, CABLE(), 5)


def pallet(b, rng):
    for x in (-0.5, 0.0, 0.5):
        obox(b, (x, 0, 0.05), (0.1, 1.2, 0.1), 0, WOOD())
    for k in range(7):
        y = -0.55 + k * 0.1833
        obox(b, (0, y, 0.115), (1.0, 0.1, 0.025), 0, WOOD(), tilt=(0, rng.uniform(-0.02, 0.02)))
    for y in (-0.55, 0.0, 0.55):
        obox(b, (0, y, 0.0125), (1.0, 0.1, 0.025), 0, WOOD())


def conduit(b, rng):
    """a run of conduit on the wall, a switch box and a socket; origin at the floor on the wall's face"""
    L = rng.uniform(1.2, 2.2)
    rod(b, (-L / 2, -0.02, 2.4), (L / 2, -0.02, 2.4), 0.012, PAINTR(), 6)
    rod(b, (0.2, -0.02, 2.4), (0.2, -0.02, 1.25), 0.012, PAINTR(), 6)
    obox(b, (0.2, -0.025, 1.2), (0.08, 0.04, 0.08), 0, PAINTR())
    obox(b, (0.2, -0.046, 1.2), (0.025, 0.006, 0.035), 0, CABLE())
    if rng.random() < 0.7:
        rod(b, (-0.3, -0.02, 2.4), (-0.3, -0.02, 0.35), 0.012, PAINTR(), 6)
        obox(b, (-0.3, -0.025, 0.3), (0.1, 0.04, 0.08), 0, PAINTR())


BRICK = lambda: mat('lfbrick', (0.34, 0.15, 0.09), 0.85)
BRICK2 = lambda: mat('lfbrick2', (0.26, 0.12, 0.08), 0.85)
MORTAR = lambda: mat('lfmortar', (0.42, 0.4, 0.36), 0.95)
SLAT = lambda: mat('lfslat', (0.58, 0.56, 0.5), 0.5)


def plaster(b, rng):
    """plaster come away from a wall: a ragged lip round a patch of brick and mortar; origin on the wall's face at the
    patch's middle, looking along -y"""
    rx, rz = rng.uniform(0.3, 0.6), rng.uniform(0.22, 0.45)
    n = 22
    rad = [rng.uniform(0.75, 1.0) for _ in range(n)]
    def edge(k, f):
        a = k / n * 6.2832
        return (math.cos(a) * rx * rad[k % n] * f, math.sin(a) * rz * rad[k % n] * f)
    # the lip: plaster standing proud round the hole
    i = b.idx(PLASTER())
    for k in range(n):
        (ax, az), (bx, bz) = edge(k, 1.0), edge(k + 1, 1.0)
        (cx, cz), (dx, dz) = edge(k + 1, 0.86), edge(k, 0.86)
        v = [b.bm.verts.new(p) for p in ((ax, -0.004, az), (bx, -0.004, bz), (cx, -0.016, cz), (dx, -0.016, dz))]
        b.bm.faces.new(v).material_index = i
        w = [b.bm.verts.new(p) for p in ((dx, -0.016, dz), (cx, -0.016, cz), (cx, -0.002, cz), (dx, -0.002, dz))]
        b.bm.faces.new(w).material_index = i
    # mortar behind, then the bricks in courses
    j = b.idx(MORTAR())
    c = b.bm.verts.new((0, -0.001, 0))
    ring = [b.bm.verts.new((edge(k, 0.88)[0], -0.001, edge(k, 0.88)[1])) for k in range(n)]
    for k in range(n):
        b.bm.faces.new((c, ring[(k + 1) % n], ring[k])).material_index = j
    for row in range(-8, 9):
        z = row * 0.075
        off = 0.11 if row % 2 else 0.0
        for col in range(-6, 7):
            x = col * 0.225 + off
            if max(((x + e) / (rx * 0.78)) ** 2 + ((z + f) / (rz * 0.78)) ** 2 for e in (-0.108, 0.108) for f in (-0.033, 0.033)) > 1:
                continue
            obox(b, (x, -0.006, z), (0.215, 0.012, 0.065), 0, BRICK() if rng.random() < 0.7 else BRICK2())


def blinds(b, rng):
    """venetian blinds in a window, some slats bent, some gone, one end come down; origin at the sill, inside face"""
    W, H = 1.2, 1.35
    obox(b, (0, -0.02, H), (W + 0.04, 0.04, 0.035), 0, SLAT())
    drop = rng.random() < 0.5
    for k in range(int(H / 0.045)):
        z = H - 0.05 - k * 0.045
        if rng.random() < 0.12:
            continue
        tilt = rng.uniform(-0.3, 0.3) if rng.random() < 0.2 else 0.5
        sag = 0.0
        if drop:
            # the left cord gone: the slats hang from the right, steeper toward the bottom
            sag = (k / (H / 0.045)) * 0.5
        obox(b, (0, -0.03, z - sag * 0.5), (W, 0.038, 0.0025), 0, SLAT(), tilt=(tilt, sag * 0.9))
    for x in (-W * 0.3, W * 0.3):
        rod(b, (x, -0.03, H), (x, -0.03, 0.05), 0.0015, CABLE(), 4)


BAGB = lambda: mat('lfbodybag', (0.025, 0.028, 0.03), 0.32)
WAX = lambda: mat('lfwax', (0.62, 0.57, 0.44), 0.55)
SOOT = lambda: mat('lfsoot', (0.02, 0.018, 0.016), 0.9)


def bodybag(b, rng):
    """a body bag on the floor: black plastic over the shape of someone, a zip down the middle; origin at its centre"""
    i = b.idx(BAGB())
    L = 1.85
    # (along, half width, height) from the feet to the head: feet, shins, knees, thighs, hips, waist, chest, shoulders, neck, head
    prof = [(0.0, 0.1, 0.08), (0.08, 0.2, 0.13), (0.3, 0.2, 0.14), (0.5, 0.22, 0.16), (0.78, 0.25, 0.2), (0.95, 0.26, 0.21), (1.2, 0.27, 0.24),
            (1.38, 0.28, 0.23), (1.48, 0.2, 0.16), (1.6, 0.13, 0.17), (1.75, 0.13, 0.17), (1.85, 0.09, 0.1)]
    n = 12
    sag = rng.uniform(-0.12, 0.12)
    rings = []
    for (t, hw, h) in prof:
        y = t - L / 2
        ring = []
        for k in range(n + 1):
            a = math.pi * k / n          # 0..pi over the top; the bottom is the floor
            x = math.cos(a) * hw * (1.0 + 0.12 * math.sin(a))
            z = math.sin(a) * h * (0.92 + 0.08 * rng.random())
            ring.append(b.bm.verts.new((x + sag * (t / L - 0.5) ** 2, y, max(0.004, z))))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(n):
            b.bm.faces.new((r0[k], r1[k], r1[k + 1], r0[k + 1])).material_index = i
    b.bm.faces.new(list(rings[0])).material_index = i
    b.bm.faces.new(list(reversed(rings[-1]))).material_index = i
    # the zip, and a tag on a string at the feet
    pts = [(sag * (t / L - 0.5) ** 2, t - L / 2, h * 0.98 + 0.004) for (t, hw, h) in prof[1:-1]]
    for p0, p1 in zip(pts, pts[1:]):
        rod(b, p0, p1, 0.006, STEEL(), 5)
    quad(b, [(0.05, -L / 2 - 0.12, 0.003), (0.13, -L / 2 - 0.12, 0.003), (0.13, -L / 2 - 0.02, 0.003), (0.05, -L / 2 - 0.02, 0.003)], PAPER())


def candles(b, rng):
    """candles burnt down on the floor in a ring, wax run together, soot on the floor; origin at the middle"""
    W, S = WAX(), SOOT()
    quad(b, [(-0.5, -0.5, 0.002), (0.5, -0.5, 0.002), (0.5, 0.5, 0.002), (-0.5, 0.5, 0.002)], S, two=False)
    k = rng.randint(7, 11)
    for j in range(k):
        a = j / k * 2 * math.pi + rng.uniform(-0.2, 0.2)
        r = rng.uniform(0.28, 0.42)
        x, y = math.cos(a) * r, math.sin(a) * r
        h = rng.uniform(0.04, 0.22)
        rod(b, (x, y, 0.0), (x, y, h), rng.uniform(0.018, 0.03), W, 8)
        obox(b, (x, y, 0.004), (0.09, 0.09, 0.008), a, W)
        rod(b, (x, y, h), (x, y, h + 0.012), 0.0015, S, 4)


# ---------------------------------------------------------------------------------------------------------- the trenches
BURLAP = lambda: mat('lfburlap', (0.3, 0.25, 0.16), 0.95)
BURLAP2 = lambda: mat('lfburlap2', (0.24, 0.2, 0.13), 0.95)
WIRE = lambda: mat('lfwire', (0.09, 0.07, 0.055), 0.55, 0.6)
PICKET = lambda: mat('lfpicket', (0.12, 0.1, 0.08), 0.6, 0.5)
MUDK = lambda: mat('lfmud', (0.16, 0.12, 0.085), 0.55)
MUDK2 = lambda: mat('lfmud2', (0.12, 0.095, 0.07), 0.45)
RUST = lambda: mat('lfrust', (0.19, 0.11, 0.065), 0.75, 0.35)
RUST2 = lambda: mat('lfrust2', (0.13, 0.085, 0.06), 0.8, 0.3)


def pillow(b, c, size, yaw, m, rng):
    """a filled sack: an ellipsoid with its underside pressed flat by the weight on it"""
    i = b.idx(m)
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    R = Matrix.Rotation(yaw, 3, 'Z') @ Matrix.Rotation(rng.uniform(-0.05, 0.05), 3, 'X')
    C = Vector(c)
    nu, nv = 10, 6
    rows = []
    for j in range(nv + 1):
        v = -math.pi / 2 + math.pi * j / nv
        row = []
        for k in range(nu):
            u = 2 * math.pi * k / nu
            # squarer than an egg: sacks fill to their corners
            cu, su, cv, sv = math.cos(u), math.sin(u), math.cos(v), math.sin(v)
            x = math.copysign(abs(cu) ** 0.6, cu) * abs(cv) ** 0.7 * sx
            y = math.copysign(abs(su) ** 0.6, su) * abs(cv) ** 0.7 * sy
            z = max(math.copysign(abs(sv) ** 0.8, sv) * sz, -sz * 0.75)
            row.append(b.bm.verts.new(C + R @ Vector((x, y, z))))
        rows.append(row)
    for j in range(nv):
        for k in range(nu):
            b.bm.faces.new((rows[j][k], rows[j][(k + 1) % nu], rows[j + 1][(k + 1) % nu], rows[j + 1][k])).material_index = i


def sandbags(b, rng, courses):
    """a run of sandbag wall 2 m long along x, two bags deep, laid in a stretcher bond; origin at the foot of its middle"""
    L, bl, bw, bh = 2.0, 0.52, 0.28, 0.14
    z = bh * 0.45
    for c in range(courses):
        off = (c % 2) * bl / 2
        for row in (-1, 1):
            x = -L / 2 + off + bl / 2 - (bl / 2 if off else 0)
            while x < L / 2 + 0.01:
                if x - bl / 2 >= -L / 2 - 0.02 and x + bl / 2 <= L / 2 + 0.02:
                    pillow(b, (x + rng.uniform(-0.02, 0.02), row * bw / 2 * 1.02, z), (bl * rng.uniform(0.94, 1.02), bw * rng.uniform(0.95, 1.05), bh * rng.uniform(0.9, 1.1)),
                           rng.uniform(-0.06, 0.06), BURLAP() if rng.random() < 0.6 else BURLAP2(), rng)
                x += bl
        z += bh * 0.82


def sandbag2(b, rng): sandbags(b, rng, 2)
def sandbag3(b, rng): sandbags(b, rng, 3)
def sandbag5(b, rng): sandbags(b, rng, 5)


def wire(b, rng):
    """a 3 m bay of entanglement along x: screw pickets, strands strung between them with barbs on, and a coil of concertina
    along the foot; origin on the ground at its middle"""
    W = WIRE()
    xs = [-1.5, -0.5, 0.5, 1.5]
    tops = []
    for x in xs:
        lean = rng.uniform(-0.12, 0.12)
        h = rng.uniform(0.95, 1.2)
        rod(b, (x, 0, 0), (x + lean * 0.3, lean, h), 0.014, PICKET(), 6)
        tops.append((x + lean * 0.3, lean, h))
    def strand(p0, p1, sag):
        n = 8
        pts = []
        for k in range(n + 1):
            t = k / n
            pts.append(Vector(p0).lerp(Vector(p1), t) - Vector((0, 0, sag * 4 * t * (1 - t))))
        for q0, q1 in zip(pts, pts[1:]):
            rod(b, q0, q1, 0.0035, W, 4)
            # barbs
            m = (q0 + q1) / 2
            rod(b, m + Vector((0, -0.025, -0.02)), m + Vector((0, 0.025, 0.02)), 0.0025, W, 3)
    for (a, c) in zip(tops, tops[1:]):
        for f in (0.3, 0.6, 1.0):
            strand((a[0], a[1], a[2] * f), (c[0], c[1], c[2] * f), rng.uniform(0.04, 0.12))
        strand((a[0], a[1], a[2]), (c[0], c[1], 0.1), 0.05)
    # the concertina coil
    loops, seg = 11, 12
    R0 = 0.42
    prev = None
    for k in range(loops * seg + 1):
        t = k / (loops * seg)
        u = t * loops * 2 * math.pi
        r = R0 * rng.uniform(0.92, 1.05)
        p = Vector((-1.5 + 3.0 * t + 0.05 * math.sin(u), 0.55 + math.cos(u) * r, R0 + math.sin(u) * r * 0.95))
        if prev is not None:
            rod(b, prev, p, 0.003, W, 3)
        prev = p


def crater(b, rng, ri, dep):
    """a shell hole: a bowl dug into the ground, its spoil thrown up round it in a rim; origin at ground level at its
    middle. ri: radius where the bowl meets the ground, dep: depth at the middle"""
    i, j2 = b.idx(MUDK()), b.idx(MUDK2())
    nu, nr = 36, 16
    R = ri * 1.45
    ph = [rng.uniform(0, 6.28) for _ in range(3)]
    def zf(r, u):
        w = 1 + 0.08 * math.sin(3 * u + ph[0]) + 0.05 * math.sin(5 * u + ph[1])
        q = r / (ri * w)
        if q < 1:
            return -dep * math.cos(math.pi / 2 * q) ** 1.2 + 0.03 * math.sin(7 * u + q * 9 + ph[2])
        t = (r - ri * w) / (R - ri * w)
        return 0.42 * ri / 3.5 * math.sin(math.pi * min(1.0, t)) ** 1.4 * (1 - 0.3 * t) * w
    ring = [[b.bm.verts.new((0, 0, -dep))]]
    for k in range(1, nr + 1):
        r = R * (k / nr) ** 0.85
        ring.append([b.bm.verts.new((math.cos(2 * math.pi * u / nu) * r, math.sin(2 * math.pi * u / nu) * r, zf(r, 2 * math.pi * u / nu))) for u in range(nu)])
    for u in range(nu):
        b.bm.faces.new((ring[0][0], ring[1][u], ring[1][(u + 1) % nu])).material_index = j2
    for k in range(1, nr):
        for u in range(nu):
            b.bm.faces.new((ring[k][u], ring[k + 1][u], ring[k + 1][(u + 1) % nu], ring[k][(u + 1) % nu])).material_index = j2 if k < nr * 0.55 else i
    for f in b.bm.faces:
        f.smooth = True
    # the outer edge tucked a hand under the ground, so no light comes through the seam
    out = [b.bm.verts.new((v.co.x * 1.01, v.co.y * 1.01, -0.08)) for v in ring[nr]]
    for u in range(nu):
        b.bm.faces.new((ring[nr][u], out[u], out[(u + 1) % nu], ring[nr][(u + 1) % nu])).material_index = i


def crater_dish(b, rng, seed):
    ri = seed / 10.0
    crater(b, rng, ri, min(2.3, ri * 0.42))


def tank(b, rng):
    """a wrecked rhomboid tank of the first war: the tracks run right round the hull, a gun in a sponson each side, the
    cab on top; burnt, holed, nose down. Origin on the ground at its middle, 8 m along x"""
    Rm, R2 = RUST(), RUST2()
    prof = [(-4.0, 1.5), (-3.1, 2.55), (2.4, 2.55), (4.1, 1.0), (3.1, 0.0), (-2.6, 0.0)]
    for side in (-1, 1):
        y0, y1 = side * 1.45, side * 2.05
        i = b.idx(Rm)
        top = [b.bm.verts.new((x, y0, z)) for (x, z) in prof]
        bot = [b.bm.verts.new((x, y1, z)) for (x, z) in prof]
        b.bm.faces.new(top if side < 0 else list(reversed(top))).material_index = i
        b.bm.faces.new(list(reversed(bot)) if side < 0 else bot).material_index = i
        n = len(prof)
        for k in range(n):
            b.bm.faces.new((top[k], top[(k + 1) % n], bot[(k + 1) % n], bot[k])).material_index = b.idx(R2)
        # track plates
        for k in range(n):
            (xa, za), (xb, zb) = prof[k], prof[(k + 1) % n]
            L = math.hypot(xb - xa, zb - za)
            m = max(2, int(L / 0.35))
            for q in range(m):
                t = (q + 0.5) / m
                x, z = xa + (xb - xa) * t, za + (zb - za) * t
                obox(b, (x, (y0 + y1) / 2, z), (0.26, abs(y1 - y0) + 0.04, 0.05), 0, R2, tilt=(0, -math.atan2(zb - za, xb - xa)))
        # the sponson and its gun
        obox(b, (0.2, side * 2.45, 1.2), (1.6, 0.8, 1.1), 0, Rm)
        rod(b, (0.6, side * 2.6, 1.25), (1.9, side * 2.75, 1.32), 0.06, R2, 8)
    obox(b, (-0.2, 0, 1.3), (5.2, 2.9, 2.2), 0, Rm)
    obox(b, (1.6, 0, 2.75), (1.4, 1.6, 0.6), 0, Rm)
    obox(b, (-2.6, 0, 2.7), (0.9, 1.2, 0.35), 0.1, R2, tilt=(0.3, 0.2))
    # rivet lines
    for x in range(-2, 3):
        for side in (-1, 1):
            obox(b, (x * 1.0, side * 1.46, 2.0), (0.04, 0.03, 0.04), 0, R2)


def fieldgun(b, rng):
    """a field gun of the first war: two spoked wheels, the shield, the barrel on its cradle, the trail down behind; origin
    on the ground under the axle, the muzzle along +y"""
    G, G2, Wd = mat('lfgungreen', (0.11, 0.12, 0.09), 0.6, 0.4), RUST2(), mat('lfgunwood', (0.22, 0.15, 0.09), 0.8)
    rw = 0.68
    for side in (-1, 1):
        x = side * 0.78
        n = 18
        rim = [(x, math.cos(2 * math.pi * k / n) * rw, rw + math.sin(2 * math.pi * k / n) * rw) for k in range(n)]
        for k in range(n):
            rod(b, rim[k], rim[(k + 1) % n], 0.035, Wd, 6)
            if k % 2 == 0:
                rod(b, (x, 0, rw), rim[k], 0.018, Wd, 5)
        rod(b, (x - 0.08, 0, rw), (x + 0.08, 0, rw), 0.09, G2, 10)
    rod(b, (-0.8, 0, rw), (0.8, 0, rw), 0.05, G2, 8)
    # the shield, the cradle and the barrel, a little cocked up
    obox(b, (0, 0.15, rw + 0.45), (1.3, 0.04, 1.1), 0, G, tilt=(-0.12, 0))
    obox(b, (0, 0.25, rw + 0.32), (0.3, 1.3, 0.22), 0, G, tilt=(0.08, 0))
    rod(b, (0, -0.4, rw + 0.38), (0, 1.9, rw + 0.62), 0.065, G, 12)
    rod(b, (0, 1.75, rw + 0.6), (0, 1.95, rw + 0.62), 0.08, G2, 12)
    # the trail, its spade in the mud
    rod(b, (-0.25, -0.1, rw - 0.05), (-0.05, -2.6, 0.12), 0.06, G, 8)
    rod(b, (0.25, -0.1, rw - 0.05), (0.05, -2.6, 0.12), 0.06, G, 8)
    obox(b, (0, -2.65, 0.12), (0.5, 0.12, 0.3), 0, G2, tilt=(0.4, 0))


WATTLE = lambda: mat('lfwattle', (0.17, 0.12, 0.075), 0.9)
STAKE = lambda: mat('lfstake', (0.2, 0.15, 0.1), 0.85)
DUCKW = lambda: mat('lfduck', (0.2, 0.15, 0.1), 0.75)
WATER = lambda: mat('lfpool', (0.018, 0.016, 0.012), 0.16)
STEELH = lambda: mat('lfhelmet', (0.13, 0.14, 0.1), 0.55, 0.5)
CANVAS = lambda: mat('lfcanvas', (0.26, 0.24, 0.17), 0.95)


def sbwall(b, rng):
    """sandbags laid up a trench wall as its revetment: one skin of bags 2 m along x, from the floor to near the top,
    leaning back into the earth a little; origin at the foot of the face, the face looking along -y"""
    bl, bh = 0.5, 0.15
    courses = rng.randint(9, 12)
    for c in range(courses):
        z = bh * 0.45 + c * bh * 0.84
        back = c * 0.022
        off = (c % 2) * bl / 2
        x = -1.0 + off - (bl / 2 if off else 0) + bl / 2
        while x < 1.0:
            if x - bl / 2 > -1.03 and x + bl / 2 < 1.03 and not (c == courses - 1 and rng.random() < 0.3):
                pillow(b, (x + rng.uniform(-0.02, 0.02), 0.13 + back, z), (bl * rng.uniform(0.93, 1.02), 0.26, bh * rng.uniform(0.9, 1.1)),
                       rng.uniform(-0.07, 0.07), BURLAP() if rng.random() < 0.55 else BURLAP2(), rng)
            x += bl


def wattle(b, rng):
    """a hurdle of woven brushwood held to the trench wall by stakes: 2 m along x, 1.6 m high; origin at the foot of
    the face, the face looking along -y"""
    stakes = [-0.95 + k * 0.38 for k in range(6)]
    for x in stakes:
        rod(b, (x, 0.06, -0.05), (x + rng.uniform(-0.02, 0.02), 0.08, rng.uniform(1.55, 1.75)), 0.025, STAKE(), 6)
    z = 0.06
    k = 0
    while z < 1.55:
        ph = k % 2
        prev = None
        for i in range(14):
            x = -1.0 + i / 13 * 2.0
            # in front of one stake, behind the next
            y = 0.07 + 0.03 * math.cos((x - stakes[0]) / 0.38 * math.pi + ph * math.pi)
            p = Vector((x, y, z + 0.01 * math.sin(i * 0.7 + k)))
            if prev is not None:
                rod(b, prev, p, 0.016, WATTLE(), 4)
            prev = p
        z += rng.uniform(0.04, 0.05)
        k += 1


def duck(b, rng):
    """a duckboard: two runners on short legs, slats across with gaps between, 2 m along y; origin on the trench floor"""
    W_ = DUCKW()
    h = rng.uniform(0.1, 0.16)
    for x in (-0.28, 0.28):
        obox(b, (x, 0, h - 0.04), (0.07, 2.0, 0.07), 0, W_)
        for y in (-0.8, 0.0, 0.8):
            obox(b, (x, y, (h - 0.075) / 2), (0.06, 0.06, h - 0.075), 0, W_)
    for k in range(12):
        y = -0.95 + k * 0.172
        if rng.random() < 0.06:
            continue
        obox(b, (rng.uniform(-0.02, 0.02), y, h + 0.012), (0.72, 0.11, 0.025), rng.uniform(-0.04, 0.04), W_, tilt=(0, rng.uniform(-0.04, 0.04)))


def pool(b, rng):
    """standing water: a flat irregular sheet of it, about 1.6 x 2.4 m, a few cm deep; origin at its middle"""
    i = b.idx(WATER())
    n = 20
    c = b.bm.verts.new((0, 0, 0.0))
    ring = []
    ph = [rng.uniform(0, 6.28) for _ in range(3)]
    for k in range(n):
        a = 2 * math.pi * k / n
        r = 1.0 + 0.18 * math.sin(2 * a + ph[0]) + 0.1 * math.sin(3 * a + ph[1]) + 0.06 * math.sin(5 * a + ph[2])
        ring.append(b.bm.verts.new((math.cos(a) * r * 0.8, math.sin(a) * r * 1.2, 0.0)))
    for k in range(n):
        b.bm.faces.new((c, ring[k], ring[(k + 1) % n])).material_index = i


def spoil(b, rng):
    """a heap of thrown-up earth, lumpy: about 4 x 3 m and up to 0.45 m high; origin on the ground at its middle"""
    i, j = b.idx(MUDK()), b.idx(MUDK2())
    nu, nr = 24, 8
    hgt = rng.uniform(0.3, 0.45)
    ph = [rng.uniform(0, 6.28) for _ in range(4)]
    ring = [[b.bm.verts.new((0, 0, hgt))]]
    for k in range(1, nr + 1):
        t = k / nr
        row = []
        for u in range(nu):
            a = 2 * math.pi * u / nu
            r = t * (1 + 0.15 * math.sin(3 * a + ph[0]) + 0.08 * math.sin(5 * a + ph[1]))
            z = hgt * (1 - t * t) * (1 + 0.12 * math.sin(7 * a + ph[2] + t * 5)) - (0.05 if k == nr else 0)
            row.append(b.bm.verts.new((math.cos(a) * r * 2.0, math.sin(a) * r * 1.5, z)))
        ring.append(row)
    for u in range(nu):
        b.bm.faces.new((ring[0][0], ring[1][u], ring[1][(u + 1) % nu])).material_index = j
    for k in range(1, nr):
        for u in range(nu):
            b.bm.faces.new((ring[k][u], ring[k + 1][u], ring[k + 1][(u + 1) % nu], ring[k][(u + 1) % nu])).material_index = i if (k + u) % 3 else j
    for f in b.bm.faces:
        f.smooth = True


def helmet(b, rng):
    """a steel helmet lying in the mud, shallow bowl and wide brim (the British one) or deep with a flared skirt (the
    German), on its side or upturned; origin on the ground"""
    i = b.idx(STEELH())
    brit = rng.random() < 0.55
    n, m_ = 16, 6
    rows = []
    for j in range(m_ + 1):
        t = j / m_
        if brit:
            r, z = (0.17 * math.sin(t * math.pi / 2) if j < m_ else 0.2), (0.1 * math.cos(t * math.pi / 2) if j < m_ else 0.0)
        else:
            r, z = 0.15 * math.sin(t * math.pi / 2) + (0.03 * (t - 0.8) / 0.2 if t > 0.8 else 0), 0.17 * math.cos(t * math.pi / 2) - (0.04 if t > 0.8 else 0)
        rows.append([Vector((math.cos(2 * math.pi * k / n) * r, math.sin(2 * math.pi * k / n) * r * (1.12 if not brit else 1.0), z)) for k in range(n)])
    tilt = Matrix.Rotation(rng.choice([0.0, 0.9, math.pi]), 3, 'X')
    lift = Vector((0, 0, 0.08 if True else 0))
    vs = [[b.bm.verts.new(tilt @ p + lift) for p in row] for row in rows]
    for j in range(m_):
        for k in range(n):
            b.bm.faces.new((vs[j][k], vs[j][(k + 1) % n], vs[j + 1][(k + 1) % n], vs[j + 1][k])).material_index = i


def stretcher(b, rng):
    """a canvas stretcher left on the ground: two poles, the canvas sagging between; origin on the ground"""
    for x in (-0.28, 0.28):
        rod(b, (x, -1.15, 0.06), (x, 1.15, 0.06), 0.022, STAKE(), 6)
    quad(b, [(-0.27, -0.9, 0.05), (0.27, -0.9, 0.05), (0.27, 0.9, 0.04), (-0.27, 0.9, 0.04)], CANVAS())


def picket(b, rng):
    """a screw picket and the wire still on it, knocked askew, a coil of loose wire by it; origin on the ground"""
    lean = rng.uniform(0.2, 0.6)
    rod(b, (0, 0, 0), (lean * 0.6, 0.1, 1.0 - lean * 0.3), 0.014, PICKET(), 6)
    prev = None
    for k in range(60):
        t = k / 59
        a = t * 6 * 2 * math.pi
        p = Vector((0.5 + t * 0.9 + math.sin(a) * 0.05, math.cos(a) * 0.3, 0.3 + math.sin(a) * 0.28))
        if prev is not None:
            rod(b, prev, p, 0.003, WIRE(), 3)
        prev = p



# ---------------------------------------------------------------------------------------------------------------
# what the people who came after brought in, and what the building did on its own
YELLOW = lambda: mat('lfyellow', (0.55, 0.4, 0.04), 0.5)
BLACKM = lambda: mat('lfblackm', (0.03, 0.03, 0.035), 0.45, 0.4)
CONC = lambda: mat('lfconc', (0.3, 0.29, 0.27), 0.95)
CONC2 = lambda: mat('lfconc2', (0.22, 0.21, 0.2), 0.95)
LOCKER = lambda: mat('lflocker', (0.2, 0.27, 0.26), 0.5, 0.3)
LENS = lambda: mat('lflens', (0.7, 0.7, 0.66), 0.08)


def worklight(b, rng):
    """a site light: a tripod, a mast, two halogen heads on a bar, the cable trailing off; it looks along -y.
    The lamp itself is a light in the layout, at head height (1.72)"""
    S = BLACKM()
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.5
        rod(b, (0, 0, 0.62), (math.cos(a) * 0.55, math.sin(a) * 0.55, 0.02), 0.014, S)
        rod(b, (0, 0, 0.3), (math.cos(a) * 0.27, math.sin(a) * 0.27, 0.32), 0.008, S, 5)
    rod(b, (0, 0, 0.3), (0, 0, 1.2), 0.02, S)
    rod(b, (0, 0, 1.1), (0, 0, 1.66), 0.014, YELLOW())
    rod(b, (-0.3, 0, 1.66), (0.3, 0, 1.66), 0.012, S)
    for x in (-0.22, 0.22):
        tilt = rng.uniform(-0.15, 0.1)
        obox(b, (x, -0.03, 1.76), (0.26, 0.11, 0.2), 0, YELLOW(), tilt=(tilt, 0))
        obox(b, (x, -0.09, 1.76), (0.22, 0.012, 0.16), 0, LENS(), tilt=(tilt, 0))
        for dx in (-0.1, 0.1):
            rod(b, (x + dx, -0.1, 1.67), (x + dx, -0.1, 1.85), 0.004, S, 4)
        rod(b, (x, 0.02, 1.86), (x, 0.06, 1.9), 0.012, S, 6)
    # the cable, off along the floor
    prev = (0.0, 0.04, 1.1)
    pts = [(0.05, 0.1, 0.5), (0.12, 0.2, 0.02)]
    a = rng.uniform(0, 6.28)
    x, y = 0.12, 0.2
    for k in range(7):
        a += rng.uniform(-0.7, 0.7)
        x += math.cos(a) * 0.45; y += abs(math.sin(a)) * 0.45 + 0.1
        pts.append((x, y, 0.012))
    for p in pts:
        rod(b, prev, p, 0.009, CABLE(), 5)
        prev = p


def gurney(b, rng):
    """a trolley: a tube frame on castors, a thin mattress, one side rail up, a strap hanging"""
    W, L, H = 0.66, 1.92, 0.82
    x, y = W / 2, L / 2
    S = CHROME()
    for (cx, cy) in ((-x + 0.05, -y + 0.16), (x - 0.05, -y + 0.16), (-x + 0.05, y - 0.16), (x - 0.05, y - 0.16)):
        rod(b, (cx - 0.03, cy, 0.06), (cx + 0.03, cy, 0.06), 0.06, RUBBER(), 10)
        rod(b, (cx, cy, 0.12), (cx, cy, H - 0.05), 0.016, S)
    for z in (0.3, H - 0.05):
        for (p0, p1) in (((-x, -y, z), (x, -y, z)), ((-x, y, z), (x, y, z)), ((-x, -y, z), (-x, y, z)), ((x, -y, z), (x, y, z))):
            rod(b, (p0[0] * 0.92, p0[1] * (0.84 if z < 0.5 else 1), z), (p1[0] * 0.92, p1[1] * (0.84 if z < 0.5 else 1), z), 0.014, S)
    obox(b, (0, 0, 0.31), (W - 0.12, L * 0.8, 0.012), 0, STEEL())
    obox(b, (0, -0.05, H + 0.02), (W - 0.04, L - 0.2, 0.07), 0, MATT())
    ang = rng.uniform(0.0, 0.5)
    obox(b, (0, y - 0.32 + 0.0, H + 0.03 + 0.2 * math.sin(ang)), (W - 0.04, 0.5, 0.07), 0, MATT(), tilt=(ang, 0))
    xx = (x + 0.02) * (1 if rng.random() < 0.5 else -1)
    for yy in (-0.5, 0.4):
        rod(b, (xx, yy, H - 0.05), (xx, yy, H + 0.3), 0.01, S)
    rod(b, (xx, -0.56, H + 0.3), (xx, 0.46, H + 0.3), 0.01, S)
    # a strap undone, and what was under the sheet
    quad(b, [(-x, -0.2, H + 0.06), (-x, -0.14, H + 0.06), (-x - 0.03, -0.12, H - 0.42), (-x - 0.03, -0.18, H - 0.44)], RUBBER())
    if rng.random() < 0.6:
        quad(b, [(-x + 0.02, -0.8, H + 0.062), (x - 0.02, -0.8, H + 0.062), (x - 0.02, 0.2, H + 0.062), (-x + 0.02, 0.2, H + 0.062)], SHEET(), two=False)
        s = 1 if rng.random() < 0.5 else -1
        quad(b, [(s * x, -0.75, H + 0.06), (s * x, 0.15, H + 0.06), (s * (x + 0.05), 0.2, H - 0.3), (s * (x + 0.08), -0.6, H - 0.38)], SHEET())


def rubble(b, rng):
    """what a floor is once it has come down: slabs, lumps, crumbs, bent bar sticking out. About 2.6 x 2 m, half a metre high"""
    i = b.idx(DUST())
    n = 16
    cv = b.bm.verts.new((0, 0, 0.02))
    ring = [b.bm.verts.new((math.cos(k * 6.283 / n) * rng.uniform(1.2, 1.7), math.sin(k * 6.283 / n) * rng.uniform(0.9, 1.3), 0.004)) for k in range(n)]
    for k in range(n):
        b.bm.faces.new((cv, ring[k], ring[(k + 1) % n])).material_index = i
    for k in range(rng.randint(5, 8)):
        w, d = rng.uniform(0.5, 1.2), rng.uniform(0.4, 0.9)
        r = math.sqrt(rng.random())
        a = rng.uniform(0, 6.28)
        obox(b, (math.cos(a) * r * 0.8, math.sin(a) * r * 0.6, rng.uniform(0.08, 0.32)), (w, d, rng.uniform(0.1, 0.18)), rng.uniform(0, 3.1),
             CONC() if rng.random() < 0.6 else CONC2(), tilt=(rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5)))
    for k in range(rng.randint(26, 40)):
        r = rng.uniform(0.05, 0.2)
        d = math.sqrt(rng.random())
        a = rng.uniform(0, 6.28)
        obox(b, (math.cos(a) * d * 1.3, math.sin(a) * d * 1.0, r * 0.4 + max(0.0, 0.3 - d * 0.3) * rng.random()), (r * rng.uniform(1, 2), r * rng.uniform(0.8, 1.6), r * rng.uniform(0.5, 1)), rng.uniform(0, 3),
             rng.choice((CONC, CONC2, PLASTER, BRICK))(), tilt=(rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6)))
    for k in range(rng.randint(3, 6)):
        x, y = rng.uniform(-0.8, 0.8), rng.uniform(-0.6, 0.6)
        a = rng.uniform(0, 6.28)
        l = rng.uniform(0.5, 1.1)
        mid = (x + math.cos(a) * l * 0.5, y + math.sin(a) * l * 0.5, rng.uniform(0.3, 0.7))
        rod(b, (x, y, 0.1), mid, 0.008, RUST(), 5)
        rod(b, mid, (mid[0] + math.cos(a + 0.6) * l * 0.5, mid[1] + math.sin(a + 0.6) * l * 0.5, mid[2] + rng.uniform(-0.25, 0.2)), 0.008, RUST(), 5)


def oplamp(b, rng):
    """the lamp over an operating table: a stem from the ceiling, a jointed arm, a wide dish with its glass. Origin at the ceiling"""
    S = CREAM()
    rod(b, (0, 0, 0), (0, 0, -0.5), 0.035, S)
    rod(b, (0, 0, -0.5), (0.55, 0.1, -0.62), 0.028, S)
    rod(b, (0.55, 0.1, -0.62), (0.3, -0.2, -1.0), 0.024, S)
    c = (0.3, -0.2, -1.06)
    n = 18
    i = b.idx(S)
    j = b.idx(LENS())
    top = [b.bm.verts.new((c[0] + math.cos(k * 6.283 / n) * 0.18, c[1] + math.sin(k * 6.283 / n) * 0.18, c[2] + 0.07)) for k in range(n)]
    rim = [b.bm.verts.new((c[0] + math.cos(k * 6.283 / n) * 0.42, c[1] + math.sin(k * 6.283 / n) * 0.42, c[2] - 0.05)) for k in range(n)]
    for k in range(n):
        b.bm.faces.new((top[k], top[(k + 1) % n], rim[(k + 1) % n], rim[k])).material_index = i
    b.bm.faces.new(list(reversed(top))).material_index = i
    b.bm.faces.new(rim).material_index = j
    rod(b, (c[0] + 0.42, c[1], c[2] - 0.02), (c[0] + 0.56, c[1], c[2] - 0.02), 0.012, CHROME(), 6)


def lockers(b, rng):
    """a bank of four steel lockers, 1.2 wide: doors with vents, one hanging open, one gone; they look along -y"""
    W, D, H = 0.3, 0.45, 1.8
    M = LOCKER()
    for k in range(4):
        x = -0.6 + k * W + W / 2
        obox(b, (x, D / 2, H / 2 + 0.08), (W - 0.004, D, H), 0, M)
        state = rng.random()
        if state < 0.2:
            # the door's gone: a dark inside
            obox(b, (x, 0.012, H / 2 + 0.08), (W - 0.05, 0.03, H - 0.06), 0, SOOT())
            continue
        ang = rng.uniform(0.5, 1.6) if state < 0.45 else 0.0
        hx = x - W / 2 + 0.01
        c, sn = math.cos(ang), math.sin(ang)
        obox(b, (hx + c * (W / 2 - 0.01), -0.012 - sn * (W / 2 - 0.01), H / 2 + 0.08), (W - 0.03, 0.014, H - 0.05), -ang, M)
        if ang == 0.0:
            for z in (1.55, 1.6, 1.65):
                obox(b, (x, -0.021, z), (W * 0.5, 0.004, 0.012), 0, SOOT())
            obox(b, (x + W * 0.3, -0.026, 1.0), (0.02, 0.014, 0.09), 0, CHROME())
    obox(b, (0, D / 2, 0.04), (1.2, D - 0.04, 0.08), 0, SOOT())


# ---- what's fixed to a hospital's walls and stood along them. Wall pieces: origin on the floor at the wall's face, out along -y
REDP = lambda: mat('lfredp', (0.5, 0.04, 0.03), 0.38)
WHITEP = lambda: mat('lfwhitep', (0.66, 0.66, 0.63), 0.4)
GREYP = lambda: mat('lfgreyp', (0.2, 0.21, 0.22), 0.5)
BLUEP = lambda: mat('lfbluep', (0.1, 0.2, 0.36), 0.45)
SEATP = lambda: mat('lfseatp', (0.16, 0.3, 0.34), 0.45)
CORK = lambda: mat('lfcork', (0.36, 0.25, 0.14), 0.95)
GLASSD = lambda: mat('lfglassd', (0.015, 0.018, 0.02), 0.06)
GREENC = lambda: mat('lfgreenc', (0.08, 0.2, 0.1), 0.4, 0.5)
YELLOWP = lambda: mat('lfyellowp', (0.6, 0.47, 0.06), 0.5)


def extinguisher(b, rng):
    """a fire point: the red bottle on its bracket, hose and horn, the sign over it"""
    obox(b, (0, -0.006, 1.32), (0.1, 0.012, 0.5), 0, STEEL())
    rod(b, (0, -0.085, 1.06), (0, -0.085, 1.5), 0.07, REDP(), 14)
    rod(b, (0, -0.085, 1.5), (0, -0.085, 1.55), 0.045, REDP(), 10)
    rod(b, (0, -0.085, 1.55), (0, -0.085, 1.6), 0.02, BLACKM(), 6)
    rod(b, (-0.05, -0.085, 1.6), (0.07, -0.085, 1.62), 0.012, BLACKM(), 6)
    rod(b, (0.02, -0.085, 1.58), (0.1, -0.1, 1.3), 0.011, RUBBER(), 6)
    rod(b, (0.1, -0.1, 1.3), (0.1, -0.1, 1.14), 0.022, RUBBER(), 8)
    obox(b, (0, -0.1, 1.3), (0.15, 0.004, 0.012), 0, STEEL())
    obox(b, (0, -0.004, 1.9), (0.2, 0.008, 0.2), 0, REDP())
    obox(b, (0, -0.009, 1.9), (0.1, 0.003, 0.12), 0, WHITEP())
    if rng.random() < 0.35:
        obox(b, (0.24, -0.004, 1.9), (0.2, 0.008, 0.2), 0, BLUEP())


def sanitiser(b, rng):
    """a hand-gel dispenser, its drip tray, and the notice telling you to use it, hanging by one corner"""
    obox(b, (0, -0.045, 1.28), (0.11, 0.09, 0.22), 0, WHITEP())
    obox(b, (0, -0.095, 1.24), (0.07, 0.014, 0.1), 0, GREYP())
    obox(b, (0, -0.05, 1.14), (0.06, 0.07, 0.03), 0, GLASSD())
    obox(b, (0, -0.06, 1.05), (0.12, 0.1, 0.012), 0, WHITEP())
    a = rng.uniform(-0.5, 0.5)
    obox(b, (0.02, -0.004, 1.62), (0.21, 0.004, 0.297), 0, PAPER(), tilt=(0, a if rng.random() < 0.4 else rng.uniform(-0.05, 0.05)))


def notice(b, rng):
    """a notice board: cork in an aluminium frame, rotas and warnings pinned over one another, some let go at a corner"""
    W, H, z = 1.2, 0.9, 1.62
    obox(b, (0, -0.012, z), (W, 0.024, H), 0, CORK())
    for (x, zz, w, h) in ((0, z + H / 2, W + 0.03, 0.03), (0, z - H / 2, W + 0.03, 0.03), (-W / 2, z, 0.03, H), (W / 2, z, 0.03, H)):
        obox(b, (x, -0.016, zz), (w, 0.034, h), 0, STEEL())
    for k in range(rng.randint(6, 11)):
        w, h = rng.choice(((0.21, 0.297), (0.21, 0.297), (0.148, 0.21), (0.297, 0.21)))
        x = rng.uniform(-W / 2 + w / 2 + 0.03, W / 2 - w / 2 - 0.03)
        zz = rng.uniform(z - H / 2 + h / 2 + 0.03, z + H / 2 - h / 2 - 0.03)
        t = rng.uniform(-0.12, 0.12) if rng.random() < 0.8 else rng.uniform(-0.6, 0.6)
        obox(b, (x, -0.027 - k * 0.0012, zz), (w, 0.001, h), 0, rng.choice((PAPER, PAPER, PAPER2, WHITEP))(), tilt=(rng.uniform(-0.04, 0.0), t))
        obox(b, (x, -0.03 - k * 0.0012, zz + h / 2 - 0.02), (0.012, 0.006, 0.012), 0, rng.choice((REDP, BLUEP, YELLOWP))())


def wallphone(b, rng):
    """the ward telephone: the box on the wall, the handset off its hook on the end of its cord"""
    obox(b, (0, -0.03, 1.42), (0.2, 0.06, 0.26), 0, CREAM())
    for r in range(4):
        for c in range(3):
            obox(b, (-0.045 + c * 0.045, -0.062, 1.36 + r * 0.035), (0.028, 0.006, 0.02), 0, GREYP())
    drop = rng.uniform(0.35, 0.8)
    prev = (-0.07, -0.05, 1.3)
    for k in range(1, 9):
        t = k / 8
        p = (-0.07 - 0.03 * math.sin(t * 9), -0.05 - 0.02 * t, 1.3 - drop * t)
        rod(b, prev, p, 0.005, CABLE(), 5)
        prev = p
    obox(b, (prev[0], prev[1] - 0.02, prev[2] - 0.1), (0.05, 0.045, 0.21), 0, CREAM(), tilt=(0.1, rng.uniform(-0.3, 0.3)))


def seats(b, rng):
    """waiting-room seats: four shells on one beam, bolted down, backs to the wall; one shell cracked off its mounts"""
    n = 4
    rod(b, (-1.0, -0.3, 0.38), (1.0, -0.3, 0.38), 0.03, BLACKM(), 8)
    for x in (-0.86, 0.86):
        rod(b, (x, -0.3, 0.38), (x, -0.3, 0.02), 0.025, BLACKM(), 8)
        obox(b, (x, -0.3, 0.012), (0.08, 0.5, 0.024), 0, BLACKM())
    gone = rng.randrange(n) if rng.random() < 0.5 else -1
    for k in range(n):
        x = -0.78 + k * 0.52
        if k == gone:
            obox(b, (x, -0.3, 0.41), (0.3, 0.08, 0.02), 0, STEEL())
            continue
        tip = rng.uniform(-0.03, 0.03)
        obox(b, (x, -0.3, 0.44), (0.46, 0.44, 0.035), 0, SEATP(), tilt=(-0.06, tip))
        obox(b, (x, -0.08, 0.72), (0.46, 0.035, 0.42), 0, SEATP(), tilt=(-0.2, tip))
        rod(b, (x - 0.15, -0.1, 0.44), (x - 0.15, -0.07, 0.6), 0.012, BLACKM(), 5)
        rod(b, (x + 0.15, -0.1, 0.44), (x + 0.15, -0.07, 0.6), 0.012, BLACKM(), 5)


def vending(b, rng):
    """a drinks machine, 0.9 wide: the cabinet, a dark glass front with the shelves behind it, the slot, the tray.
    Its lit panel is a box in the layout"""
    W, D, H = 0.9, 0.78, 1.85
    obox(b, (0, -D / 2, H / 2), (W, D, H), 0, GREYP())
    obox(b, (-0.12, -D - 0.006, 1.12), (0.58, 0.012, 1.2), 0, GLASSD())
    for z in (0.7, 0.95, 1.2, 1.45):
        obox(b, (-0.12, -D + 0.02, z), (0.56, 0.02, 0.012), 0, STEEL())
        for k in range(rng.randint(0, 5)):
            rod(b, (-0.36 + k * 0.1, -D + 0.03, z + 0.01), (-0.36 + k * 0.1, -D + 0.03, z + 0.13), 0.03, rng.choice((REDP, BLUEP, GREENC, YELLOWP))(), 8)
    obox(b, (0.32, -D - 0.008, 1.2), (0.16, 0.016, 0.34), 0, BLACKM())
    obox(b, (0.32, -D - 0.018, 1.05), (0.07, 0.01, 0.02), 0, CHROME())
    obox(b, (-0.12, -D - 0.01, 0.3), (0.5, 0.02, 0.2), 0, BLACKM())
    obox(b, (0, -D / 2, 0.03), (W - 0.06, D - 0.06, 0.06), 0, SOOT())


def monitor(b, rng):
    """a patient monitor on a roll stand: five feet, a pole, a basket, the box with its dark screen, leads hanging"""
    S = CHROME()
    for k in range(5):
        a = k * 2 * math.pi / 5 + 0.3
        rod(b, (0, 0, 0.1), (math.cos(a) * 0.26, math.sin(a) * 0.26, 0.05), 0.012, S, 6)
        rod(b, (math.cos(a) * 0.26, math.sin(a) * 0.26 - 0.02, 0.03), (math.cos(a) * 0.26, math.sin(a) * 0.26 + 0.02, 0.03), 0.03, RUBBER(), 8)
    rod(b, (0, 0, 0.1), (0, 0, 1.2), 0.016, S)
    obox(b, (0, -0.02, 0.8), (0.3, 0.2, 0.14), 0, STEEL())
    obox(b, (0, -0.03, 1.36), (0.36, 0.17, 0.3), 0, CREAM())
    obox(b, (-0.03, -0.117, 1.37), (0.25, 0.006, 0.2), 0, GLASSD())
    for k in range(4):
        obox(b, (0.14, -0.118, 1.28 + k * 0.055), (0.03, 0.008, 0.03), 0, GREYP())
    for k in range(rng.randint(2, 3)):
        x0 = -0.12 + k * 0.1
        prev = (x0, -0.1, 1.22)
        for j in range(1, 8):
            t = j / 7
            p = (x0 + 0.25 * t + 0.04 * math.sin(t * 7 + k), -0.1 - 0.25 * t, 1.22 - 1.2 * t * t if t < 1 else 0.012)
            p = (p[0], p[1], max(0.012, p[2]))
            rod(b, prev, p, 0.004, CABLE(), 4)
            prev = p


def cylinders(b, rng):
    """oxygen: a wheeled rack against the wall with three or four bottles chained in, black with white shoulders"""
    n = rng.randint(3, 4)
    obox(b, (0, -0.2, 0.05), (0.9, 0.36, 0.04), 0, STEEL())
    for x in (-0.44, 0.44):
        rod(b, (x, -0.04, 0.05), (x, -0.04, 1.15), 0.014, STEEL(), 6)
        rod(b, (x, -0.36, 0.05), (x, -0.36, 0.7), 0.014, STEEL(), 6)
    rod(b, (-0.44, -0.04, 1.15), (0.44, -0.04, 1.15), 0.014, STEEL(), 6)
    rod(b, (-0.44, -0.37, 0.72), (0.44, -0.37, 0.72 - rng.uniform(0, 0.08)), 0.006, CHROME(), 5)
    for k in range(n):
        x = -0.33 + k * 0.22
        if k == n - 1 and rng.random() < 0.4:
            # one has gone over
            rod(b, (0.7, -0.5, 0.08), (0.7 + 0.9, -0.5 - 0.5, 0.08), 0.08, BLACKM(), 12)
            continue
        rod(b, (x, -0.2, 0.07), (x, -0.2, 1.1), 0.085, BLACKM(), 12)
        rod(b, (x, -0.2, 1.1), (x, -0.2, 1.2), 0.06, WHITEP(), 12)
        rod(b, (x, -0.2, 1.2), (x, -0.2, 1.3), 0.022, CHROME(), 8)
        rod(b, (x - 0.05, -0.2, 1.28), (x + 0.05, -0.2, 1.28), 0.014, CHROME(), 6)
        if rng.random() < 0.5:
            rod(b, (x, -0.2, 1.3), (x, -0.25, 1.36), 0.03, GREENC(), 8)


def crashcart(b, rng):
    """a resus trolley: red drawers, one pulled out, a board on the back, the paddles' box on top, castors"""
    W, D, H = 0.7, 0.48, 0.95
    for (x, y) in ((-0.3, -0.06), (0.3, -0.06), (-0.3, -0.42), (0.3, -0.42)):
        rod(b, (x - 0.02, y, 0.05), (x + 0.02, y, 0.05), 0.05, RUBBER(), 8)
    obox(b, (0, -D / 2, 0.1 + (H - 0.1) / 2), (W, D, H - 0.1), 0, REDP())
    out = rng.randrange(5)
    for k in range(5):
        z = 0.2 + k * 0.15
        pull = rng.uniform(0.12, 0.3) if k == out else 0.0
        obox(b, (0, -D - 0.008 - pull / 2, z + 0.06), (W - 0.05, 0.016 + pull, 0.13), 0, REDP() if not pull else STEEL())
        obox(b, (0, -D - 0.02 - pull, z + 0.09), (0.2, 0.012, 0.016), 0, CHROME())
    obox(b, (0, -D / 2, H + 0.01), (W + 0.04, D + 0.04, 0.02), 0, STEEL())
    obox(b, (-0.1, -D / 2, H + 0.11), (0.36, 0.3, 0.18), 0, CREAM())
    obox(b, (-0.1, -D / 2 - 0.152, H + 0.12), (0.2, 0.004, 0.11), 0, GLASSD())
    rod(b, (0.28, -0.04, H), (0.28, -0.04, H + 0.75), 0.012, CHROME(), 6)
    rod(b, (0.28, -0.04, H + 0.75), (0.2, -0.04, H + 0.75), 0.008, CHROME(), 5)


def sink(b, rng):
    """a clinical basin: no plug, elbow taps, the towel box over it and the bin under"""
    obox(b, (0, -0.2, 0.86), (0.5, 0.4, 0.05), 0, WHITEP())
    obox(b, (0, -0.2, 0.78), (0.4, 0.3, 0.14), 0, WHITEP())
    obox(b, (0, -0.2, 0.885), (0.38, 0.27, 0.004), 0, GREYP())
    rod(b, (0, -0.16, 0.74), (0, -0.16, 0.45), 0.02, CHROME(), 8)
    rod(b, (0, -0.16, 0.45), (0, 0.0, 0.45), 0.02, CHROME(), 8)
    rod(b, (0, -0.04, 0.88), (0, -0.04, 1.06), 0.014, CHROME(), 6)
    rod(b, (0, -0.04, 1.06), (0, -0.2, 1.04), 0.012, CHROME(), 6)
    for x in (-0.12, 0.12):
        rod(b, (x, -0.04, 0.9), (x * 1.9, -0.14, 0.94), 0.008, CHROME(), 5)
    obox(b, (0, -0.006, 1.2), (0.6, 0.012, 0.5), 0, WHITEP())
    obox(b, (0.02, -0.06, 1.62), (0.28, 0.12, 0.34), 0, WHITEP())
    quad(b, [(-0.08, -0.07, 1.45), (0.1, -0.07, 1.45), (0.09, -0.08, 1.36), (-0.07, -0.09, 1.38)], PAPER())
    rod(b, (0.42, -0.18, 0.0), (0.42, -0.18, 0.42), 0.15, YELLOWP(), 12)
    rod(b, (0.42, -0.18, 0.42), (0.42, -0.18, 0.44), 0.16, WHITEP(), 12)


REDPIPE = lambda: mat('lfredpipe', (0.68, 0.06, 0.045), 0.35)


def sprinkler(b, rng):
    """three metres of sprinkler main under a ceiling, along x from the origin: the red pipe hung well clear of the tiles
    on its hangers, a coupling, a head on a short drop at each third. Origin at the ceiling"""
    z = -0.26
    P = REDPIPE()
    rod(b, (0, 0, z), (3.0, 0, z), 0.042, P, 10)
    for x in (0.4, 2.2):
        rod(b, (x, 0, 0), (x, 0, z + 0.04), 0.006, STEEL(), 4)
        obox(b, (x, 0, z), (0.035, 0.11, 0.11), 0, STEEL())
    rod(b, (1.45, 0, z), (1.55, 0, z), 0.052, P, 10)
    for hx in (0.75, 2.25):
        rod(b, (hx, 0, z), (hx, 0, z - 0.13), 0.016, P, 6)
        rod(b, (hx, 0, z - 0.13), (hx, 0, z - 0.18), 0.011, CHROME(), 6)
        obox(b, (hx, 0, z - 0.185), (0.06, 0.06, 0.005), 0, CHROME())


def wetfloor(b, rng):
    """the yellow sign someone stood up the last time the floor was mopped; some have gone over"""
    Y = YELLOWP()
    if rng.random() < 0.35:
        obox(b, (0, 0, 0.02), (0.3, 0.62, 0.03), rng.uniform(0, 3), Y)
        return
    for sgn in (-1, 1):
        obox(b, (0, sgn * 0.11, 0.3), (0.3, 0.02, 0.62), 0, Y, tilt=(sgn * 0.33, 0))
        obox(b, (0, sgn * 0.125, 0.36), (0.16, 0.004, 0.2), 0, BLACKM(), tilt=(sgn * 0.33, 0))
    obox(b, (0, 0, 0.6), (0.3, 0.05, 0.03), 0, Y)


def doorplate(b, rng):
    """beside a door: the room's plate, and under it the light switch. Wall piece, 4 cm proud so it shows on any wall"""
    obox(b, (0, -0.02, 1.6), (0.3, 0.04, 0.1), 0, BLUEP())
    obox(b, (-0.02, -0.041, 1.6), (0.2, 0.002, 0.03 if rng.random() < 0.6 else 0.05), 0, WHITEP())
    if rng.random() < 0.75:
        obox(b, (0, -0.02, 1.2), (0.085, 0.04, 0.085), 0, WHITEP())
        obox(b, (0, -0.043, 1.2 + rng.choice((-0.008, 0.008))), (0.02, 0.006, 0.035), 0, WHITEP(), tilt=(rng.choice((-0.25, 0.25)), 0))


def callpoint(b, rng):
    """break glass: the red box at shoulder height, its bell up by the ceiling with the conduit between them"""
    obox(b, (0, -0.025, 1.4), (0.09, 0.05, 0.09), 0, REDP())
    obox(b, (0, -0.051, 1.4), (0.05, 0.002, 0.04), 0, WHITEP() if rng.random() < 0.7 else GLASSD())
    rod(b, (0, -0.012, 1.45), (0, -0.012, 2.55), 0.008, STEEL(), 5)
    rod(b, (0, 0, 2.62), (0, -0.07, 2.62), 0.075, REDP(), 12)
    rod(b, (0, -0.07, 2.62), (0, -0.085, 2.62), 0.02, STEEL(), 6)


def liftdoor(b, rng):
    """a lift that stopped: the steel surround, two doors left a hand apart on the dark of the shaft, the call plate.
    2 m wide, standing 0.1 proud of the wall. The floor indicator is a lit box in the layout"""
    W, H = 2.0, 2.3
    S = STEEL()
    obox(b, (0, -0.05, H + 0.14), (W, 0.1, 0.28), 0, S)
    for x in (-W / 2 + 0.13, W / 2 - 0.13):
        obox(b, (x, -0.05, H / 2), (0.26, 0.1, H), 0, S)
    obox(b, (0, -0.02, H / 2), (W - 0.5, 0.02, H), 0, SOOT())
    gap = rng.uniform(0.1, 0.34)
    wl = (W - 0.52) / 2 - gap / 2
    for sgn in (-1, 1):
        cx = sgn * (gap / 2 + wl / 2)
        obox(b, (cx, -0.045, H / 2), (wl, 0.03, H), 0, CHROME())
        obox(b, (cx, -0.062, 1.0), (wl - 0.1, 0.004, 0.012), 0, S)
        obox(b, (sgn * (gap / 2 + 0.012), -0.05, H / 2), (0.024, 0.04, H), 0, RUBBER())
    obox(b, (W / 2 + 0.22, -0.01, 1.15), (0.1, 0.02, 0.24), 0, S)
    for z in (1.1, 1.2):
        rod(b, (W / 2 + 0.22, -0.02, z), (W / 2 + 0.22, -0.03, z), 0.018, CHROME(), 8)
    obox(b, (0, -0.105, H + 0.14), (0.34, 0.012, 0.14), 0, GLASSD())



# ---- a supermarket, shut and picked over. Floor pieces stand on the origin; a 3 m module runs along x, centred
SHELFM = lambda: mat('lfshelf', (0.36, 0.36, 0.34), 0.55, 0.2)
SHELFD = lambda: mat('lfshelfd', (0.12, 0.13, 0.14), 0.6, 0.3)
CARDB = lambda: mat('lfcardb', (0.24, 0.17, 0.1), 0.9)
CARDB2 = lambda: mat('lfcardb2', (0.3, 0.23, 0.14), 0.9)
TIN = lambda: mat('lftin', (0.3, 0.3, 0.3), 0.5, 0.5)
LABEL_R = lambda: mat('lflabr', (0.2, 0.045, 0.04), 0.8)
LABEL_B = lambda: mat('lflabb', (0.05, 0.085, 0.16), 0.6)
LABEL_G = lambda: mat('lflabg', (0.06, 0.13, 0.07), 0.6)
LABEL_Y = lambda: mat('lflaby', (0.27, 0.22, 0.07), 0.6)
LABEL_W = lambda: mat('lflabw', (0.36, 0.35, 0.32), 0.6)
ROT = lambda: mat('lfrot', (0.07, 0.055, 0.03), 0.95)
ROT2 = lambda: mat('lfrot2', (0.13, 0.1, 0.045), 0.9)
MOULD = lambda: mat('lfmould', (0.16, 0.2, 0.14), 1.0)
ORANGE = lambda: mat('lforange', (0.55, 0.2, 0.04), 0.5)
BLUES = lambda: mat('lfbluesteel', (0.07, 0.13, 0.26), 0.5, 0.3)
BELT = lambda: mat('lfbelt', (0.025, 0.025, 0.028), 0.75)
STRIPP = lambda: mat('lfstrip', (0.4, 0.4, 0.3), 0.3)
WRAP = lambda: mat('lfwrap', (0.4, 0.37, 0.33), 0.35)
WRAPD = lambda: mat('lfwrapd', (0.22, 0.1, 0.08), 0.5)
LABELS = (LABEL_R, LABEL_B, LABEL_G, LABEL_Y, LABEL_W, TIN, CARDB, CARDB2)


def _stock(b, rng, x0, x1, y, z, depth, h, fill):
    """what's left on a length of shelf: a few boxes and tins pushed about, most of it gone"""
    x = x0 + rng.uniform(0.02, 0.3)
    while x < x1 - 0.12:
        if rng.random() > fill:
            x += rng.uniform(0.2, 0.9)
            continue
        kind = rng.random()
        M = rng.choice(LABELS)()
        n = rng.randint(1, 4)
        if kind < 0.45:
            w, hh = rng.uniform(0.1, 0.22), min(h - 0.04, rng.uniform(0.14, 0.3))
            for k in range(n):
                if x + w > x1:
                    break
                fallen = rng.random() < 0.15
                obox(b, (x + w / 2, y + rng.uniform(-0.05, 0.03) * depth, z + (w if fallen else hh) / 2), (w - 0.012, depth * rng.uniform(0.4, 0.75), w - 0.012 if fallen else hh), rng.uniform(-0.25, 0.25) if rng.random() < 0.3 else 0, M)
                x += w
        else:
            r, hh = rng.uniform(0.034, 0.055), rng.uniform(0.09, 0.17)
            for k in range(n + 1):
                if x + 2 * r > x1:
                    break
                if rng.random() < 0.12:
                    rod(b, (x, y - depth * 0.2, z + r), (x + hh, y + rng.uniform(-0.1, 0.1), z + r), r, M, 8)
                    x += hh + 0.02
                else:
                    rod(b, (x + r, y + rng.uniform(-0.1, 0.06), z), (x + r, y + rng.uniform(-0.1, 0.06), z + hh), r, M, 8)
                    x += 2 * r + 0.006
        x += rng.uniform(0.03, 0.5)


def gondola(b, rng):
    """three metres of supermarket shelving, both sides: uprights, a back panel, five shelves a side with their price
    strips, what little stock is left, a shelf or two let go at one end"""
    L, D, H = 3.0, 1.0, 1.95
    obox(b, (0, 0, H / 2 + 0.12), (L, 0.03, H - 0.24), 0, SHELFM())
    obox(b, (0, 0, 0.08), (L, D, 0.16), 0, SHELFD())
    for x in (-L / 2 + 0.02, 0, L / 2 - 0.02):
        obox(b, (x, 0, H / 2), (0.04, 0.09, H), 0, SHELFD())
    fill = rng.uniform(0.12, 0.5)
    for sgn in (-1, 1):
        for k in range(5):
            z = 0.17 + k * 0.38
            d = 0.46 - k * 0.025
            yc = sgn * (0.015 + d / 2)
            sag = rng.random() < 0.07 and k > 0
            if sag:
                # let go at one end
                e = rng.choice((-1, 1))
                obox(b, (0, yc, z - 0.16), (L - 0.06, d, 0.022), 0, SHELFM(), tilt=(0, e * 0.11))
                continue
            obox(b, (0, yc, z), (L - 0.06, d, 0.022), 0, SHELFM())
            obox(b, (0, sgn * (0.015 + d + 0.004), z - 0.008), (L - 0.06, 0.008, 0.036), 0, LABEL_W() if rng.random() < 0.8 else LABEL_Y())
            _stock(b, rng, -L / 2 + 0.05, L / 2 - 0.05, yc, z + 0.011, d, 0.34, fill * (1.3 if k == 0 else 1))
    # what came off, on the floor against the kick board
    for k in range(rng.randint(0, 5)):
        sgn = rng.choice((-1, 1))
        if rng.random() < 0.5:
            r = rng.uniform(0.034, 0.05)
            a = rng.uniform(0, 3.1)
            x, y = rng.uniform(-1.3, 1.3), sgn * rng.uniform(0.6, 0.95)
            rod(b, (x, y, r), (x + math.cos(a) * 0.12, y + math.sin(a) * 0.12, r), r, rng.choice(LABELS)(), 8)
        else:
            w = rng.uniform(0.1, 0.2)
            obox(b, (rng.uniform(-1.3, 1.3), sgn * rng.uniform(0.6, 0.95), w * 0.35), (w, w * 1.5, w * 0.7), rng.uniform(0, 3), rng.choice(LABELS)())


def gondolax(b, rng):
    """a run of shelving that went over: on its side across the aisle, the shelves sprung, everything it held in a heap"""
    L, H = 3.0, 1.95
    obox(b, (0, 0.45, 0.52), (L, H, 0.03), 0, SHELFM(), tilt=(0.28, 0))
    obox(b, (0, -0.48, 0.14), (L, 0.16, 0.28), 0, SHELFD())
    for x in (-L / 2 + 0.02, 0, L / 2 - 0.02):
        obox(b, (x, 0.45, 0.56), (0.04, H, 0.09), 0, SHELFD(), tilt=(0.28, 0))
    for k in range(5):
        y = -0.3 + k * 0.38
        obox(b, (rng.uniform(-0.1, 0.1), y, 0.4 + k * 0.1 + rng.uniform(0, 0.2)), (L - 0.06, 0.022, 0.44), rng.uniform(-0.06, 0.06), SHELFM(), tilt=(0.28 + rng.uniform(-0.5, 0.3), rng.uniform(-0.1, 0.1)))
    for k in range(rng.randint(14, 24)):
        x, y = rng.uniform(-1.4, 1.4), rng.uniform(-1.3, -0.3)
        if rng.random() < 0.5:
            r = rng.uniform(0.034, 0.05)
            a = rng.uniform(0, 3.1)
            rod(b, (x, y, r), (x + math.cos(a) * 0.13, y + math.sin(a) * 0.13, r), r, rng.choice(LABELS)(), 8)
        else:
            w = rng.uniform(0.1, 0.22)
            obox(b, (x, y, w * 0.4), (w, w * 1.4, w * 0.8), rng.uniform(0, 3), rng.choice(LABELS)(), tilt=(rng.uniform(-0.3, 0.3), 0))


def endcap(b, rng):
    """the display on the end of an aisle: a metre of shelving facing out, a promotion's card still on top"""
    W, H = 1.0, 1.7
    obox(b, (0, 0.02, H / 2), (W, 0.03, H), 0, SHELFM())
    obox(b, (0, -0.2, 0.08), (W, 0.46, 0.16), 0, SHELFD())
    for k in range(4):
        z = 0.17 + k * 0.4
        obox(b, (0, -0.2, z), (W - 0.04, 0.42, 0.022), 0, SHELFM())
        _stock(b, rng, -W / 2 + 0.04, W / 2 - 0.04, -0.2, z + 0.011, 0.42, 0.36, rng.uniform(0.1, 0.6))
    obox(b, (0, -0.01, H + 0.16), (W * 0.8, 0.012, 0.3), 0, rng.choice((LABEL_R, LABEL_Y))(), tilt=(rng.uniform(-0.1, 0.1), rng.uniform(-0.12, 0.12)))


def checkout(b, rng):
    """a till lane, 2.6 long along y, the customer walking +y to -y on its -x side: the belt, the scanner well, the
    bagging shelf, the screen on its pole, the card reader, the divider rail, the lane's number on a post"""
    obox(b, (0, 0.5, 0.44), (0.62, 1.5, 0.88), 0, SHELFD())
    obox(b, (0, 0.5, 0.885), (0.5, 1.4, 0.012), 0, BELT())
    obox(b, (0, -0.55, 0.44), (0.62, 0.6, 0.88), 0, SHELFM())
    obox(b, (0, -0.55, 0.884), (0.34, 0.34, 0.01), 0, GLASSD())
    obox(b, (0, -1.1, 0.34), (0.62, 0.5, 0.68), 0, SHELFD())
    obox(b, (0.36, -0.2, 0.44), (0.1, 1.1, 0.88), 0, SHELFD())
    rod(b, (0.34, -0.5, 0.88), (0.34, -0.5, 1.32), 0.016, SHELFD(), 6)
    tw = rng.uniform(-0.5, 0.5)
    obox(b, (0.34, -0.5, 1.42), (0.34, 0.05, 0.26), tw, SHELFD())
    obox(b, (0.34 - 0.026 * math.sin(tw), -0.5 - 0.026 * math.cos(tw), 1.42), (0.3, 0.004, 0.22), tw, GLASSD())
    obox(b, (-0.22, -0.3, 0.95), (0.09, 0.14, 0.05), 0.3, GREYP(), tilt=(0.4, 0))
    rod(b, (-0.3, 1.24, 0.9), (-0.3, 1.24, 1.12), 0.012, CHROME(), 6)
    rod(b, (-0.3, 1.24, 1.12), (-0.3, 0.2, 1.12), 0.012, CHROME(), 6)
    rod(b, (-0.3, 0.2, 1.12), (-0.3, 0.2, 0.9), 0.012, CHROME(), 6)
    rod(b, (0.3, 1.2, 0.88), (0.3, 1.2, 2.3), 0.02, SHELFD(), 6)
    obox(b, (0.3, 1.2, 2.42), (0.4, 0.12, 0.3), 0, SHELFD())
    # a drawer left open, and what was under the counter
    if rng.random() < 0.6:
        obox(b, (0.5, -0.55, 0.72), (0.4, 0.36, 0.09), 0, SHELFD())
    for k in range(rng.randint(0, 3)):
        w = rng.uniform(0.12, 0.2)
        obox(b, (rng.uniform(-0.2, 0.2), rng.uniform(0.0, 1.0), 0.9 + w * 0.3), (w, w * 1.3, w * 0.6), rng.uniform(0, 3), rng.choice(LABELS)())


def cart(b, rng):
    """a shopping trolley: wire basket on a tube frame, a child seat, four castors; a few of them over on their sides"""
    S = CHROME()
    over = rng.random() < 0.3
    R = Matrix.Rotation(math.pi / 2 * rng.choice((-1, 1)), 3, 'Y') if over else Matrix.Identity(3)
    off = Vector((0, 0, 0.3)) if over else Vector((0, 0, 0))

    def P(x, y, z):
        return tuple(R @ Vector((x, y, z - (0.5 if over else 0))) + off + (Vector((0, 0, 0.0)) if not over else Vector((0, 0, 0))))
    x0, x1 = -0.27, 0.27
    # the basket: narrower at the front (-y), a grid of wire
    for (y, w, zb) in ((-0.45, 0.2, 0.52), (0.42, 0.27, 0.45)):
        rod(b, P(-w, y, zb), P(w, y, zb), 0.006, S, 4)
        rod(b, P(-w, y, 0.98), P(w, y, 0.98), 0.009, S, 5)
        for k in range(5):
            x = -w + 2 * w * k / 4
            rod(b, P(x, y, zb), P(x, y, 0.98), 0.004, S, 4)
    for sgn in (-1, 1):
        rod(b, P(sgn * 0.2, -0.45, 0.98), P(sgn * 0.27, 0.42, 0.98), 0.009, S, 5)
        rod(b, P(sgn * 0.2, -0.45, 0.52), P(sgn * 0.27, 0.42, 0.45), 0.006, S, 4)
        for k in range(1, 7):
            t = k / 7
            rod(b, P(sgn * (0.2 + 0.07 * t), -0.45 + 0.87 * t, 0.52 - 0.07 * t), P(sgn * (0.2 + 0.07 * t), -0.45 + 0.87 * t, 0.98), 0.004, S, 4)
        for z in (0.68, 0.83):
            rod(b, P(sgn * 0.2, -0.45, z), P(sgn * 0.27, 0.42, z - 0.02), 0.004, S, 4)
        # frame and wheels
        rod(b, P(sgn * 0.27, 0.42, 0.45), P(sgn * 0.25, 0.5, 0.12), 0.012, S, 5)
        rod(b, P(sgn * 0.25, 0.5, 0.12), P(sgn * 0.2, -0.4, 0.12), 0.012, S, 5)
        rod(b, P(sgn * 0.2, -0.4, 0.12), P(sgn * 0.2, -0.45, 0.52), 0.012, S, 5)
        rod(b, P(sgn * 0.27, 0.42, 0.98), P(sgn * 0.27, 0.56, 1.04), 0.011, S, 5)
        for y in (-0.38, 0.46):
            rod(b, P(sgn * 0.22 - 0.015, y, 0.05), P(sgn * 0.22 + 0.015, y, 0.05), 0.05, RUBBER(), 8)
    for k in range(4):
        y = -0.45 + 0.87 * (k + 0.5) / 4
        rod(b, P(-0.21 - 0.05 * k / 4, y, 0.5 - 0.05 * k / 4), P(0.21 + 0.05 * k / 4, y, 0.5 - 0.05 * k / 4), 0.004, S, 4)
    rod(b, P(-0.27, 0.56, 1.04), P(0.27, 0.56, 1.04), 0.016, LABEL_R(), 6)
    if rng.random() < 0.45 and not over:
        for k in range(rng.randint(1, 4)):
            w = rng.uniform(0.1, 0.2)
            obox(b, (rng.uniform(-0.1, 0.1), rng.uniform(-0.3, 0.3), 0.52 + w * 0.4 + k * 0.05), (w, w * 1.3, w * 0.8), rng.uniform(0, 3), rng.choice(LABELS)())


def freezer(b, rng):
    """a bank of upright freezers, three metres, four glass doors: one standing open, one with its glass gone, the
    shelves inside, what was in them long since run out under the doors. Faces -y. Its light is a box in the layout"""
    L, D, H = 3.0, 0.8, 2.05
    W = WHITEP()
    obox(b, (0, D / 2 - 0.02, H / 2), (L, 0.04, H), 0, W)
    obox(b, (0, 0, 0.09), (L, D, 0.18), 0, SHELFD())
    obox(b, (0, 0, H - 0.09), (L, D, 0.18), 0, W)
    for x in (-L / 2 + 0.02, L / 2 - 0.02):
        obox(b, (x, 0, H / 2), (0.04, D, H), 0, W)
    dw = (L - 0.08) / 4
    for k in range(4):
        x = -L / 2 + 0.04 + dw * (k + 0.5)
        obox(b, (x - dw / 2, -0.02, H / 2), (0.03, D - 0.1, H - 0.36), 0, W)
        for z in (0.5, 0.86, 1.22, 1.58):
            obox(b, (x, 0.02, z), (dw - 0.04, D - 0.16, 0.016), 0, STEEL())
            if rng.random() < 0.5:
                _stock(b, rng, x - dw / 2 + 0.04, x + dw / 2 - 0.04, 0.05, z + 0.008, 0.5, 0.3, 0.5)
        state = rng.random()
        ang = rng.uniform(0.7, 1.7) if state < 0.22 else 0.0
        hx = x - dw / 2 + 0.02
        c, sn = math.cos(ang), math.sin(ang)
        cx, cy = hx + c * (dw / 2 - 0.02), -D / 2 + 0.02 - sn * (dw / 2 - 0.02)
        for (ox, w2, h2, oz) in ((0, dw - 0.03, 0.05, 0.2), (0, dw - 0.03, 0.05, H - 0.2)):
            obox(b, (cx, cy, oz), (w2, 0.03, h2), -ang, SHELFD())
        for e in (-1, 1):
            obox(b, (cx + e * c * (dw / 2 - 0.035), cy - e * sn * (dw / 2 - 0.035), H / 2), (0.04, 0.03, H - 0.4), -ang, SHELFD())
        if state > 0.36 or state < 0.22:
            obox(b, (cx, cy, H / 2), (dw - 0.1, 0.008, H - 0.44), -ang, GLASSD())
        obox(b, (cx + c * (dw / 2 - 0.09), cy - sn * (dw / 2 - 0.09) - 0.03, 1.1), (0.025, 0.03, 0.4), -ang, CHROME())
    # the puddle it left, dried black at the edge
    n = 12
    i = b.idx(ROT())
    cv = b.bm.verts.new((rng.uniform(-0.8, 0.8), -0.7, 0.004))
    ring = [b.bm.verts.new((cv.co.x + math.cos(k * 6.283 / n) * rng.uniform(0.5, 1.2), -0.75 + math.sin(k * 6.283 / n) * rng.uniform(0.25, 0.5), 0.003)) for k in range(n)]
    for k in range(n):
        b.bm.faces.new((cv, ring[k], ring[(k + 1) % n])).material_index = i


def coffin(b, rng):
    """a chest freezer island, 2.4 x 1: the tub, sliding lids (one off and on the floor), a black soup in the bottom"""
    L, D, H = 2.4, 1.0, 0.88
    W = WHITEP()
    for (cx, cy, sx, sy) in ((0, -D / 2 + 0.03, L, 0.06), (0, D / 2 - 0.03, L, 0.06), (-L / 2 + 0.03, 0, 0.06, D), (L / 2 - 0.03, 0, 0.06, D)):
        obox(b, (cx, cy, H / 2), (sx, sy, H), 0, W)
    obox(b, (0, 0, 0.3), (L - 0.1, D - 0.1, 0.02), 0, ROT())
    obox(b, (0, 0, 0.06), (L - 0.06, D - 0.06, 0.12), 0, SHELFD())
    for k in range(rng.randint(3, 9)):
        w = rng.uniform(0.12, 0.26)
        obox(b, (rng.uniform(-1.0, 1.0), rng.uniform(-0.35, 0.35), 0.31 + w * 0.2), (w, w * 1.4, w * 0.4), rng.uniform(0, 3), rng.choice((ROT2, MOULD, CARDB, LABEL_W))(), tilt=(rng.uniform(-0.2, 0.2), 0))
    for k in range(3):
        x = -L / 2 + 0.42 + k * 0.78
        if rng.random() < 0.3:
            obox(b, (x + rng.uniform(-0.3, 0.3), -D / 2 - 0.35, 0.02), (0.76, 0.5, 0.012), rng.uniform(-0.6, 0.6), GLASSD())
            continue
        obox(b, (x + rng.uniform(-0.2, 0.2), 0, H + 0.006), (0.76, D - 0.08, 0.008), 0, GLASSD())
    obox(b, (0, 0, H + 0.02), (L, 0.03, 0.02), 0, CHROME())
    obox(b, (0, -D / 2 - 0.004, H - 0.12), (L - 0.2, 0.008, 0.09), 0, LABEL_B())


def producebin(b, rng):
    """a produce stand, two metres: a sloped bed in a timber surround, crates on it, what was in them gone to black
    and green, more of it on the floor, the scale still hanging at one end"""
    L, D = 2.0, 1.0
    obox(b, (0, 0.1, 0.35), (L, D - 0.2, 0.7), 0, BOARD())
    obox(b, (0, 0, 0.82), (L, D, 0.04), 0, BOARD(), tilt=(0.24, 0))
    obox(b, (0, -D / 2 + 0.02, 0.76), (L, 0.04, 0.16), 0, BOARD())
    for k in range(4):
        x = -L / 2 + 0.26 + k * 0.5
        y = rng.uniform(-0.12, 0.12)
        z = 0.87 + 0.24 * (y + 0.1)
        for (dx, dy, sx, sy) in ((0, -0.17, 0.44, 0.02), (0, 0.17, 0.44, 0.02), (-0.21, 0, 0.02, 0.34), (0.21, 0, 0.02, 0.34)):
            obox(b, (x + dx, y + dy, z + 0.06), (sx, sy, 0.14), 0, rng.choice((LABEL_G, SHELFD, CARDB))(), tilt=(0.24, 0))
        for j in range(rng.randint(2, 9)):
            r = rng.uniform(0.035, 0.07)
            px, py = x + rng.uniform(-0.15, 0.15), y + rng.uniform(-0.12, 0.12)
            obox(b, (px, py, z + 0.04 + r * 0.5 + 0.24 * (py - y)), (r * 2, r * 2, r * rng.uniform(0.6, 1.4)), rng.uniform(0, 3), rng.choice((ROT, ROT, ROT2, MOULD))(), tilt=(rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5)))
    for j in range(rng.randint(4, 10)):
        r = rng.uniform(0.03, 0.06)
        obox(b, (rng.uniform(-1.0, 1.0), -D / 2 - rng.uniform(0.05, 0.6), r * 0.4), (r * 2, r * 2, r * 0.8), rng.uniform(0, 3), rng.choice((ROT, ROT2, MOULD))())
    rod(b, (L / 2 - 0.1, 0.3, 0.9), (L / 2 - 0.1, 0.3, 1.9), 0.014, CHROME(), 6)
    rod(b, (L / 2 - 0.1, 0.3, 1.9), (L / 2 - 0.1, -0.05, 1.9), 0.012, CHROME(), 6)
    rod(b, (L / 2 - 0.1, -0.05, 1.9), (L / 2 - 0.1, -0.05, 1.6), 0.003, CHROME(), 4)
    rod(b, (L / 2 - 0.1, -0.05, 1.6), (L / 2 - 0.1, -0.05, 1.52), 0.11, CREAM(), 12)
    obox(b, (L / 2 - 0.1, -0.05, 1.42), (0.3, 0.3, 0.03), 0, TIN(), tilt=(rng.uniform(-0.3, 0.3), 0))


def rack(b, rng):
    """a bay of pallet racking, 2.8 wide and 4.6 high: blue frames, orange beams at three levels, pallets on some of
    them shrink-wrapped, some torn open, some gone and the boxes with them"""
    W, D, H = 2.8, 1.1, 4.6
    for sx in (-W / 2, W / 2):
        for sy in (-D / 2 + 0.04, D / 2 - 0.04):
            obox(b, (sx, sy, H / 2), (0.09, 0.07, H), 0, BLUES())
        for k in range(6):
            z0, z1 = 0.3 + k * 0.7, 0.3 + (k + 1) * 0.7
            rod(b, (sx, -D / 2 + 0.04, z0 if k % 2 else z1), (sx, D / 2 - 0.04, z1 if k % 2 else z0), 0.012, BLUES(), 4)
    for z in (0.0, 1.55, 3.1):
        if z > 0:
            for sy in (-D / 2 + 0.04, D / 2 - 0.04):
                obox(b, (0, sy, z), (W, 0.05, 0.12), 0, ORANGE())
        for k in range(2):
            x = -0.68 + k * 1.36
            r = rng.random()
            if r < 0.3:
                continue
            zz = z + (0.06 if z > 0 else 0.0)
            for y in (-0.4, 0, 0.4):
                obox(b, (x, y, zz + 0.05), (1.15, 0.1, 0.09), 0, BOARD())
            obox(b, (x, 0, zz + 0.11), (1.15, 1.0, 0.022), 0, BOARD())
            if r < 0.45:
                continue
            hh = rng.uniform(0.5, 1.25)
            if r < 0.75:
                obox(b, (x, 0, zz + 0.13 + hh / 2), (1.06, 0.92, hh), rng.uniform(-0.04, 0.04), WRAP())
                obox(b, (x, -0.465, zz + 0.13 + hh * 0.6), (0.3, 0.004, 0.2), 0, LABEL_W())
            else:
                for j in range(rng.randint(3, 8)):
                    w = rng.uniform(0.3, 0.5)
                    obox(b, (x + rng.uniform(-0.3, 0.3), rng.uniform(-0.25, 0.25), zz + 0.13 + w * 0.35 + (j // 3) * 0.3), (w, w * 1.2, w * 0.7), rng.uniform(-0.4, 0.4), rng.choice((CARDB, CARDB2))())


def strips(b, rng):
    """a plastic strip curtain across a doorway 1.8 wide and 2.3 high (origin at the floor, in the wall's plane): heavy
    yellowed strips, a few torn short, a few gone, one or two stuck to the next"""
    W, H = 1.8, 2.3
    n = 11
    obox(b, (0, 0, H + 0.03), (W + 0.1, 0.04, 0.06), 0, STEEL())
    for k in range(n):
        if rng.random() < 0.14:
            continue
        x = -W / 2 + (k + 0.5) * W / n
        ln = H - 0.03 if rng.random() < 0.8 else rng.uniform(0.6, 1.8)
        lean = rng.uniform(-0.05, 0.05)
        quad(b, [(x - 0.095, 0.0, H), (x + 0.095, 0.0, H), (x + 0.095 + lean, rng.uniform(-0.04, 0.04), H - ln), (x - 0.095 + lean, rng.uniform(-0.04, 0.04), H - ln)], STRIPP())
    for k in range(rng.randint(1, 3)):
        x = rng.uniform(-0.6, 0.6)
        quad(b, [(x - 0.1, 0.01, 1.5), (x + 0.1, 0.01, 1.5), (x + 0.12, 0.012, 0.9), (x - 0.06, 0.012, 1.0)], WRAPD())


def hooks(b, rng):
    """a meat rail under a cold room's ceiling, three metres, origin at the ceiling: the rail on its hangers, steel
    hooks, and on some of them what was hung there, wrapped in sheet and taped, long and heavy and the wrong shape"""
    z = -0.3
    rod(b, (-1.5, 0, z), (1.5, 0, z), 0.022, STEEL(), 8)
    for x in (-1.2, 0, 1.2):
        rod(b, (x, 0, 0), (x, 0, z), 0.008, STEEL(), 4)
    for k in range(6):
        x = -1.25 + k * 0.5 + rng.uniform(-0.08, 0.08)
        rod(b, (x, 0, z), (x, 0, z - 0.16), 0.006, CHROME(), 4)
        rod(b, (x, 0, z - 0.16), (x, 0.05, z - 0.22), 0.006, CHROME(), 4)
        r = rng.random()
        if r < 0.45:
            continue
        ln = rng.uniform(1.1, 1.75)
        top = z - 0.22
        sw = rng.uniform(-0.06, 0.06)
        # shoulders wide, tapering to where the feet would be: seven rings of it
        prev = None
        i = b.idx(WRAP() if r < 0.85 else SHEET())
        nseg = 8
        for j in range(7):
            t = j / 6
            w = (0.05 + 0.2 * math.sin(min(1, t * 2.4) * math.pi / 2)) * (1 - 0.45 * max(0, t - 0.35))
            d = w * 0.62
            zc = top - 0.05 - ln * t
            ring = [b.bm.verts.new((x + sw * t + math.cos(q * 6.283 / nseg) * w, 0.05 + math.sin(q * 6.283 / nseg) * d, zc)) for q in range(nseg)]
            if prev:
                for q in range(nseg):
                    b.bm.faces.new((prev[q], prev[(q + 1) % nseg], ring[(q + 1) % nseg], ring[q])).material_index = i
            else:
                b.bm.faces.new(ring).material_index = i
            prev = ring
        b.bm.faces.new(list(reversed(prev))).material_index = i
        for t in (0.18, 0.5, 0.8):
            zc = top - 0.05 - ln * t
            w = (0.05 + 0.2 * math.sin(min(1, t * 2.4) * math.pi / 2)) * (1 - 0.45 * max(0, t - 0.35)) + 0.006
            for q in range(nseg):
                a0, a1 = q * 6.283 / nseg, (q + 1) * 6.283 / nseg
                rod(b, (x + sw * t + math.cos(a0) * w, 0.05 + math.sin(a0) * w * 0.62, zc), (x + sw * t + math.cos(a1) * w, 0.05 + math.sin(a1) * w * 0.62, zc), 0.006, RUBBER(), 4)
        if rng.random() < 0.6:
            # it has been dripping
            quad(b, [(x - 0.07, -0.02, top - ln * 0.55), (x + 0.07, -0.02, top - ln * 0.55), (x + 0.04, -0.03, top - ln - 0.02), (x - 0.03, -0.03, top - ln - 0.02)], WRAPD())


def aislesign(b, rng):
    """the board over an aisle, hung on two chains from the ceiling (origin there, 2.6 above it): the number, and what
    was down there, one chain let go on a few so the board hangs by a corner"""
    drop = 2.4
    gone = rng.random() < 0.18
    for sx in (-0.55, 0.55):
        if gone and sx > 0:
            rod(b, (sx, 0, 0), (sx, 0, -0.9), 0.004, STEEL(), 4)
            continue
        rod(b, (sx, 0, 0), (sx, 0, -drop + (0.0 if not gone else 0.3)), 0.004, STEEL(), 4)
    tl = (0, 0.9) if gone else (0, rng.uniform(-0.04, 0.04))
    cz = -drop - 0.22 - (0.35 if gone else 0)
    cx = -0.25 if gone else 0
    obox(b, (cx, 0, cz), (1.3, 0.03, 0.46), 0, BLUEP(), tilt=tl)
    for sy in (-0.018, 0.018):
        obox(b, (cx, sy, cz + 0.02), (0.26, 0.004, 0.28), 0, WHITEP(), tilt=tl)
        for k in range(3):
            obox(b, (cx, sy, cz - 0.1 + k * 0.0), (1.1, 0.003, 0.02), 0, WHITEP(), tilt=tl) if k == 0 else None


def trussbay(b, rng):
    """the roof steel over the sales floor, a 3 m length along x, origin at the underside of the deck: top and bottom
    chords, the web between them, a purlin, a run of cable tray and a dead fitting or the chains where one hung"""
    S = RUST()
    rod(b, (0, 0, -0.06), (3.0, 0, -0.06), 0.035, S, 6)
    rod(b, (0, 0, -0.7), (3.0, 0, -0.7), 0.035, S, 6)
    for k in range(4):
        x0, x1 = k * 0.75, (k + 1) * 0.75
        rod(b, (x0, 0, -0.7 if k % 2 else -0.06), (x1, 0, -0.06 if k % 2 else -0.7), 0.018, S, 5)
    obox(b, (1.5, 0.35, -0.82), (3.0, 0.22, 0.05), 0, STEEL())
    for k in range(rng.randint(1, 3)):
        x = rng.uniform(0.3, 2.7)
        prev = (x, 0.35, -0.84)
        for j in range(1, 6):
            p = (x + rng.uniform(-0.08, 0.08), 0.35 + rng.uniform(-0.05, 0.05), -0.84 - j * rng.uniform(0.12, 0.3))
            rod(b, prev, p, 0.006, CABLE(), 4)
            prev = p


def cardstack(b, rng):
    """flattened boxes, a roll cage with what never got put out, a stack of crates: the back-of-house heap, 1.6 x 1.2"""
    for k in range(rng.randint(4, 9)):
        obox(b, (rng.uniform(-0.5, 0.0), rng.uniform(-0.3, 0.3), 0.012 + k * 0.022), (rng.uniform(0.7, 1.1), rng.uniform(0.5, 0.9), 0.02), rng.uniform(-0.3, 0.3), rng.choice((CARDB, CARDB2))())
    x = 0.5
    for (dx, dy) in ((-0.3, -0.35), (0.3, -0.35), (-0.3, 0.35), (0.3, 0.35)):
        rod(b, (x + dx, dy, 0.1), (x + dx, dy, 1.7), 0.012, CHROME(), 5)
        rod(b, (x + dx - 0.015, dy, 0.05), (x + dx + 0.015, dy, 0.05), 0.05, RUBBER(), 8)
    for z in (0.12, 0.9, 1.7):
        for (p0, p1) in (((-0.3, -0.35), (0.3, -0.35)), ((-0.3, 0.35), (0.3, 0.35)), ((-0.3, -0.35), (-0.3, 0.35))):
            rod(b, (x + p0[0], p0[1], z), (x + p1[0], p1[1], z), 0.008, CHROME(), 4)
    for k in range(6):
        rod(b, (x - 0.3, -0.35 + k * 0.14, 0.12), (x - 0.3, -0.35 + k * 0.14, 1.7), 0.004, CHROME(), 4)
    obox(b, (x, 0, 0.13), (0.6, 0.7, 0.02), 0, STEEL())
    for k in range(rng.randint(2, 6)):
        w = rng.uniform(0.25, 0.4)
        obox(b, (x + rng.uniform(-0.1, 0.1), rng.uniform(-0.15, 0.15), 0.15 + w * 0.35 + (k // 2) * 0.3), (w, w * 1.2, w * 0.7), rng.uniform(-0.3, 0.3), rng.choice((CARDB, CARDB2))())



KINDS_EXTRA = dict(sbwall=sbwall, wattle=wattle, duck=duck, pool=pool, spoil=spoil, helmet=helmet, stretcher=stretcher, picket=picket, fieldgun=fieldgun, sandbag2=sandbag2, sandbag3=sandbag3, sandbag5=sandbag5, wire=wire, crater=crater_dish, tank=tank)

KINDS = dict(bodybag=bodybag, candles=candles, plaster=plaster, blinds=blinds, hbed=hbed, iv=iv, curtain=curtain, screen=screen, tile=tile, litter=litter, sign=sign,
             radiator=radiator, board=board, debris=debris, bottles=bottles, shards=shards, cables=cables, pallet=pallet, conduit=conduit,
             worklight=worklight, gurney=gurney, rubble=rubble, oplamp=oplamp, lockers=lockers,
             extinguisher=extinguisher, sanitiser=sanitiser, notice=notice, wallphone=wallphone, seats=seats, vending=vending, monitor=monitor,
             cylinders=cylinders, crashcart=crashcart, sink=sink, liftdoor=liftdoor, sprinkler=sprinkler, doorplate=doorplate, callpoint=callpoint, wetfloor=wetfloor,
             gondola=gondola, gondolax=gondolax, endcap=endcap, checkout=checkout, cart=cart, freezer=freezer, coffin=coffin, producebin=producebin,
             rack=rack, strips=strips, hooks=hooks, aislesign=aislesign, trussbay=trussbay, cardstack=cardstack)


def make(name):
    """name is kind or kind_N (a seed, for the pieces that vary)"""
    kind, _, seed = name.partition('_')
    b = B('w_' + name)
    if kind == 'crater':
        crater_dish(b, random.Random(int(seed) * 7), int(seed))
    elif kind in KINDS_EXTRA:
        KINDS_EXTRA[kind](b, random.Random(sum(map(ord, name)) if not seed else int(seed)))
    else:
        KINDS[kind](b, random.Random(sum(map(ord, name)) if not seed else int(seed)))
    return b.done()
