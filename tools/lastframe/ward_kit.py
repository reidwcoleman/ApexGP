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


KINDS_EXTRA = dict(sbwall=sbwall, wattle=wattle, duck=duck, pool=pool, spoil=spoil, helmet=helmet, stretcher=stretcher, picket=picket, fieldgun=fieldgun, sandbag2=sandbag2, sandbag3=sandbag3, sandbag5=sandbag5, wire=wire, crater=crater_dish, tank=tank)

KINDS = dict(bodybag=bodybag, candles=candles, plaster=plaster, blinds=blinds, hbed=hbed, iv=iv, curtain=curtain, screen=screen, tile=tile, litter=litter, sign=sign,
             radiator=radiator, board=board, debris=debris, bottles=bottles, shards=shards, cables=cables, pallet=pallet, conduit=conduit)


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
