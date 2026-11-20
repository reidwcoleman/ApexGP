"""Blender: the kit, made again at the bench in forge.py. Every piece here replaces the one of the same name in ward_kit.py:
same size, same origin, same way round (looking along -y), so nothing in the layouts changes. ward_kit.make() looks here first."""
import math, random
import bpy, bmesh
from mathutils import Vector, Matrix
from cove_kit import B, mat
from forge import pipe, turned, soft, panel, plate, wheel, drape, fillet

STEEL = lambda: mat('lfsteel', (0.55, 0.56, 0.56), 0.38, 1.0)
CHROME = lambda: mat('lfchrome', (0.75, 0.76, 0.77), 0.22, 1.0)
CREAM = lambda: mat('lfcream', (0.62, 0.6, 0.52), 0.5)
ENAMEL = lambda: mat('lfenamel', (0.66, 0.67, 0.62), 0.42)
MATT = lambda: mat('lfmattress', (0.36, 0.42, 0.44), 0.7)
SHEET = lambda: mat('lfsheet', (0.6, 0.6, 0.57), 0.9)
PILLOW = lambda: mat('lfpillow', (0.66, 0.65, 0.6), 0.9)
BLANKET = lambda: mat('lfblanket', (0.3, 0.36, 0.4), 0.95)
CLOTH = lambda: mat('lfcurtain', (0.4, 0.5, 0.47), 0.95)
RUBBER = lambda: mat('lfrubber', (0.03, 0.03, 0.03), 0.7)
BLACKP = lambda: mat('lfblackp', (0.05, 0.05, 0.055), 0.5)
GREYP = lambda: mat('lfgreyp', (0.42, 0.43, 0.44), 0.5)


def hbed(b, rng):
    """a ward bed: enamelled tube frame on castors, laminate head and foot boards in bent hoops, a sectioned mattress with the
    back rest wound up, a pillow, the sheet pulled half off (dropped by the cloth solver), one side rail up and one down"""
    W, L, H = 0.92, 2.06, 0.56
    x, y = W / 2, L / 2
    S, C, E, R_ = STEEL(), CHROME(), ENAMEL(), RUBBER()
    zf = H - 0.075
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * (x - 0.05), sy * (y - 0.1)
            wheel(b, (cx, cy, 0), 0.055, R_, S, yaw=rng.uniform(0, 3.14))
            pipe(b, [(cx, cy, 0.125), (cx, cy, zf)], 0.02, E, 8, caps=False)
        # the long rails, box section
        panel(b, (sx * (x - 0.02), 0, zf), (0.032, L - 0.06, 0.05), E, 0.006)
        # a stretcher low down between the legs
        pipe(b, [(sx * (x - 0.05), -(y - 0.1), 0.19), (sx * (x - 0.05), y - 0.1, 0.19)], 0.012, E, 6, caps=False)
    for yy in (-y + 0.04, -0.32, 0.44, y - 0.04):
        panel(b, (0, yy, zf), (W - 0.07, 0.032, 0.04), E, 0.005)
    pipe(b, [(-(x - 0.05), 0.0, 0.19), (x - 0.05, 0.0, 0.19)], 0.012, E, 6, caps=False)
    # the deck: a flat section and the back rest, a pressed sheet each, the back wound up on its ratchet
    hinge = 0.4
    ang = rng.uniform(0.32, 0.62)
    zd = H - 0.035
    panel(b, (0, (hinge - y + 0.06) / 2, zd), (W - 0.1, hinge + y - 0.06, 0.012), S, 0.003)
    Lb = y - 0.07 - hinge
    panel(b, (0, hinge + math.cos(ang) * Lb / 2, zd + math.sin(ang) * Lb / 2), (W - 0.1, Lb, 0.012), S, 0.003, tilt=(ang, 0))
    # the strut that holds it
    top = (0, hinge + math.cos(ang) * Lb * 0.7, zd + math.sin(ang) * Lb * 0.7 - 0.01)
    for sx in (-0.2, 0.2):
        pipe(b, [(sx, hinge + 0.05 + Lb * 0.75, zf), (sx, top[1], top[2])], 0.008, S, 6)
    # the mattress: one piece, bent where the deck bends
    zb = -0.065
    Lm = L - 0.14

    def fold(q):
        t = q.y - (hinge - 0.0)
        if t <= 0: return q
        th = ang * min(1.0, t / 0.16)
        dz = q.z - zb
        return Vector((q.x, hinge + t * math.cos(th) - dz * math.sin(th), zb + t * math.sin(th) + dz * math.cos(th)))
    soft(b, (0, 0, H + 0.037), (W - 0.08, Lm, 0.13), MATT(), r=0.038, res=0.09, crown=0.01, lumps=0.004, seed=rng.random() * 9, shape=fold)
    # a pillow, where the head was
    d = 0.33
    py, pz = hinge + d * math.cos(ang) - 0.2 * math.sin(ang), H + 0.037 + zb + d * math.sin(ang) + 0.2 * math.cos(ang)
    if rng.random() < 0.8:
        soft(b, (rng.uniform(-0.08, 0.08), py, pz), (0.62, 0.4, 0.13), PILLOW(), r=0.06, res=0.075, yaw=rng.uniform(-0.3, 0.3), tilt=(ang, 0), crown=0.02, sag=0.035, pinch=0.9, lumps=0.006, seed=rng.random() * 9)
    # the sheet, pulled half off one side: let go above the mattress, off centre, and left where it falls
    s = 1 if rng.random() < 0.5 else -1
    cols = [((0, (hinge - y + 0.07) / 2, H + 0.037), (W - 0.08, hinge + y - 0.07, 0.13), 0, (0, 0)),
            ((0, hinge + math.cos(ang) * Lb / 2 - 0.065 * math.sin(ang), H + 0.037 + math.sin(ang) * Lb / 2), (W - 0.08, Lb + 0.1, 0.13), 0, (ang, 0)),
            ((0, 0, zf), (W, L, 0.05), 0, (0, 0))]
    k1, k2, k3 = rng.uniform(5, 9), rng.uniform(4, 8), rng.uniform(0, 6)
    # it starts lying on the mattress where it was tucked, and the rest of it is let fall over the side
    cx = s * 0.34
    ztop = H + 0.037 + 0.065 + 0.016
    held = lambda u, v: (cx + u * 0.86) * s < 0.2 + 0.1 * math.sin(v * 5 + k3)
    drape(b, SHEET(), (1.36, 1.3), (cx, -0.3, ztop + 0.02), cols, res=0.068, frames=40, pin=held,
          start=lambda u, v: (u * 0.86, v * 0.92, 0.012 * math.sin(u * k1 * 2 + k3) * math.sin(v * k2 + 1) + (0.03 * math.sin(v * k2 * 2 + u * 3.0) if (cx + u * 0.86) * s > 0.3 else 0.0)))
    # head and foot: a hoop of tube with a laminate board in it
    for (yy, tp) in ((y, 1.06), (-y, 0.84)):
        pipe(b, [(-x + 0.02, yy, zf - 0.02), (-x + 0.02, yy, tp), (x - 0.02, yy, tp), (x - 0.02, yy, zf - 0.02)], 0.019, C, 8, bend=0.085, seg=4)
        panel(b, (0, yy, (H + tp) / 2 + 0.015), (W - 0.12, 0.018, tp - H - 0.13), CREAM(), 0.005)
        for sx in (-1, 1):
            turned(b, (sx * (x + 0.005), yy, tp - 0.1), [(-0.012, 0.0), (-0.012, 0.03), (0.012, 0.03), (0.012, 0.0)], R_, 10, axis=(1, 0, 0))
    # side rails: a rounded frame with two bars in it, one up, one let down
    for side, up in ((-s, True), (s, False)):
        xx = side * (x + 0.035)
        z0 = H + 0.06 if up else H - 0.3
        loop = [(xx, -0.62, z0), (xx, 0.5, z0), (xx, 0.5, z0 + 0.34), (xx, -0.62, z0 + 0.34)]
        pipe(b, loop, 0.011, C, 6, bend=0.06, seg=3, closed=True)
        for k in (1, 2):
            pipe(b, [(xx, -0.62, z0 + 0.34 * k / 3), (xx, 0.5, z0 + 0.34 * k / 3)], 0.008, C, 6, caps=False)
        for yy in (-0.4, 0.28):
            pipe(b, [(xx, yy, z0), (xx, yy, zf - 0.03), (xx - side * 0.04, yy, zf - 0.03)], 0.009, C, 6, bend=0.02, seg=3)
    # the winding handle at the foot
    hx = rng.choice((-0.22, 0.22))
    pipe(b, [(hx, -y + 0.05, zf - 0.03), (hx, -y - 0.07, zf - 0.03), (hx, -y - 0.07, zf - 0.12)], 0.007, S, 6, bend=0.02, seg=3)
    turned(b, (hx, -y - 0.07, zf - 0.19), [(0, 0.011), (0.004, 0.014), (0.066, 0.014), (0.07, 0.011)], BLACKP(), 8)


KINDS = dict(hbed=hbed)
# how wide the bevel on a finished piece's hard edges is (None: left as it is, 0: only smoothed), and how many different ones
# of a kind are made however many seeds the layouts ask for
FINISH = dict(litter=None, debris=None, plaster=None, shards=None, rubble=None, tile=0.0, cables=None, bottles=None, candles=None, pool=None,
              gondola=None, gondolax=None, endcap=None, hooks=None, cardstack=None, producebin=None, crater=None, wire=None, spoil=None,
              hbed=0.0)
VARIANTS = dict(hbed=5, litter=10, debris=8, plaster=8, bottles=10, cables=8, rubble=6, shards=4, radiator=3, blinds=4, curtain=5, gurney=3)

import ward_kit as WK
from forge import loft, oval, sheet


def _star(b, c, n, reach, r_wheel, m_leg, m_wheel, m_fork, h=0.11, rng=None):
    """the foot of anything that rolls on a pole: n pressed legs out from a hub, a castor under each"""
    cx, cy, cz = c
    for k in range(n):
        a = k * 2 * math.pi / n + (rng.uniform(0, 1) if rng else 0.3)
        ex, ey = cx + math.cos(a) * reach, cy + math.sin(a) * reach
        pipe(b, [(cx, cy, cz + h + 0.03), (cx + math.cos(a) * reach * 0.25, cy + math.sin(a) * reach * 0.25, cz + h + 0.025), (ex, ey, cz + r_wheel * 2 + 0.03)], 0.014, m_leg, 6, bend=0.05, seg=3)
        wheel(b, (ex, ey, cz), r_wheel, m_wheel, m_fork, yaw=a + 1.2, w=0.02, stem=0.02)
    turned(b, (cx, cy, cz + h - 0.02), [(0, 0.03), (0.01, 0.04), (0.06, 0.04), (0.075, 0.028), (0.09, 0.022)], m_leg, 12)


def gurney(b, rng):
    """a patient trolley: a tube chassis on big castors, a deck that tips at the head, a vinyl pad with straps, a push
    handle, a shelf under for the cylinder, the drip pole still in its socket"""
    S, C, R_ = WK.STEEL(), WK.CHROME(), WK.RUBBER()
    hx, hy = 0.29, 0.9
    zt = 0.8
    for sx in (-1, 1):
        for sy in (-1, 1):
            wheel(b, (sx * hx, sy * (hy - 0.12), 0), 0.075, R_, S, yaw=rng.uniform(0, 3.14), w=0.034)
            pipe(b, [(sx * hx, sy * (hy - 0.12), 0.165), (sx * hx, sy * (hy - 0.12), zt)], 0.017, C, 8, caps=False)
        pipe(b, [(sx * hx, -(hy - 0.12), 0.3), (sx * hx, hy - 0.12, 0.3)], 0.014, C, 8, caps=False)
    for sy in (-1, 1):
        pipe(b, [(-hx, sy * (hy - 0.12), 0.3), (hx, sy * (hy - 0.12), 0.3)], 0.014, C, 8, caps=False)
    # the shelf under, a pressed tray with a lip
    panel(b, (0, 0, 0.31), (2 * hx - 0.02, 1.3, 0.012), S, 0.004)
    for sx in (-1, 1): panel(b, (sx * (hx - 0.02), 0, 0.335), (0.008, 1.3, 0.04), S, 0.003)
    # the top frame: one tube bent into a rounded rectangle
    pipe(b, [(-hx - 0.02, -hy, zt), (hx + 0.02, -hy, zt), (hx + 0.02, hy, zt), (-hx - 0.02, hy, zt)], 0.016, C, 10, bend=0.09, seg=5, closed=True)
    # deck in two parts, the head tipped
    hinge = 0.3
    ang = rng.choice((0.0, 0.0, rng.uniform(0.2, 0.5)))
    panel(b, (0, (hinge - hy) / 2, zt + 0.012), (2 * hx, hinge + hy - 0.03, 0.012), S, 0.004)
    Lb = hy - hinge - 0.03
    panel(b, (0, hinge + math.cos(ang) * Lb / 2, zt + 0.012 + math.sin(ang) * Lb / 2), (2 * hx, Lb, 0.012), S, 0.004, tilt=(ang, 0))
    zb = -0.035

    def fold(q):
        t = q.y - hinge
        if t <= 0 or ang == 0: return q
        th = ang * min(1.0, t / 0.12)
        dz = q.z - zb
        return Vector((q.x, hinge + t * math.cos(th) - dz * math.sin(th), zb + t * math.sin(th) + dz * math.cos(th)))
    soft(b, (0, 0, zt + 0.055), (2 * hx - 0.02, 2 * hy - 0.08, 0.07), WK.MATT(), r=0.028, res=0.07, crown=0.006, lumps=0.003, seed=rng.random() * 9, shape=fold)
    # straps over the pad, buckled
    for yy in (-0.45, 0.0):
        sheet(b, WK.BLACKM(), lambda u, v, yy=yy: ((u - 0.5) * (2 * hx + 0.02), yy + (v - 0.5) * 0.045, zt + 0.094 + 0.012 * math.sin(u * math.pi) - (0.07 if abs(u - 0.5) > 0.47 else 0)), 12, 1, two=True)
        panel(b, (rng.uniform(-0.1, 0.1), yy, zt + 0.11), (0.05, 0.05, 0.012), C, 0.003)
    # push handle at the head, and the side rails, folded down
    pipe(b, [(-hx + 0.03, hy - 0.02, zt), (-hx + 0.03, hy + 0.1, zt + 0.2), (hx - 0.03, hy + 0.1, zt + 0.2), (hx - 0.03, hy - 0.02, zt)], 0.014, C, 8, bend=0.05, seg=4)
    for sx in (-1, 1):
        up = rng.random() < 0.3
        z0 = zt + 0.03 if up else zt - 0.27
        xx = sx * (hx + 0.045)
        pipe(b, [(xx, -0.55, z0), (xx, 0.45, z0), (xx, 0.45, z0 + 0.25), (xx, -0.55, z0 + 0.25)], 0.01, C, 8, bend=0.05, seg=3, closed=True)
        pipe(b, [(xx, -0.55, z0 + 0.125), (xx, 0.45, z0 + 0.125)], 0.007, C, 6, caps=False)
    # the drip pole
    px, py = hx - 0.01, hy - 0.06
    pipe(b, [(px, py, zt), (px, py, 1.1)], 0.009, C, 8)
    for k in range(2):
        a = k * math.pi + 0.4
        pipe(b, [(px, py, 1.1), (px + math.cos(a) * 0.07, py + math.sin(a) * 0.07, 1.115), (px + math.cos(a) * 0.09, py + math.sin(a) * 0.09, 1.08)], 0.004, C, 5, bend=0.02, seg=3)


def curtain(b, rng):
    """a bed curtain: a track hung from the ceiling on rods, round two sides of the bed space, and what is left of the curtain
    on it. The cloth is pleated the way it hangs from its hooks, bunched where it was pushed back, torn at the foot."""
    S, Cl = WK.STEEL(), WK.CLOTH()
    zt = -0.62
    path = fillet([(-1.2, 0, zt), (1.2, 0, zt), (1.2, -1.6, zt)], 0.3, 6)
    # the track: a flat rail
    i = 0
    for a, c in zip(path, path[1:]):
        d = (c - a); L = d.length
        if L < 1e-5: continue
        yaw = math.atan2(d.y, d.x)
        panel(b, ((a.x + c.x) / 2, (a.y + c.y) / 2, zt), (L + 0.004, 0.022, 0.028), S, 0.003, yaw=yaw, seg=1)
    for (x, y) in ((-1.1, 0), (0.1, 0), (1.2, -0.25), (1.2, -1.5)):
        pipe(b, [(x, y, 0), (x, y, zt + 0.014)], 0.006, S, 6)
        turned(b, (x, y, -0.006), [(0, 0.03), (0.006, 0.03)], S, 10)
    # distance along the track
    cum = [0.0]
    for a, c in zip(path, path[1:]): cum.append(cum[-1] + (c - a).length)
    total = cum[-1]

    def on_track(s):
        s = max(0.0, min(total, s))
        for k in range(len(path) - 1):
            if s <= cum[k + 1] + 1e-9:
                t = (s - cum[k]) / max(1e-9, cum[k + 1] - cum[k])
                p = path[k].lerp(path[k + 1], t)
                d = (path[k + 1] - path[k]).normalized()
                return p, Vector((-d.y, d.x, 0))
        return path[-1], Vector((0, 1, 0))
    # two or three lengths of curtain, each drawn out or bunched up
    s = rng.uniform(0.0, 0.4)
    top, foot = zt - 0.03, -2.84
    while s < total - 0.3:
        bunched = rng.random() < 0.45
        run = rng.uniform(0.25, 0.5) if bunched else rng.uniform(0.9, 1.7)
        run = min(run, total - s)
        wave = 0.075 if bunched else rng.uniform(0.13, 0.17)
        amp = 0.05 if bunched else rng.uniform(0.022, 0.035)
        nu = max(6, int(run / wave * 6))
        nv = 9
        ph = rng.uniform(0, 6)
        tear = [rng.uniform(0.0, 1.0) for _ in range(nu + 2)]
        hang = rng.uniform(0.0, 0.25) if rng.random() < 0.3 else 0.0     # one end off its hooks, sagging
        s0 = s

        def pt(u, v, s0=s0, run=run, wave=wave, amp=amp, ph=ph, nu=nu, tear=tear, hang=hang):
            p, nrm = on_track(s0 + u * run)
            a_ = amp * (0.55 + 0.9 * v) * (1 + 0.3 * math.sin(u * 5 + ph))
            off = math.sin(u * run / wave * 2 * math.pi + ph) * a_ + 0.012 * math.sin(v * 9 + u * 31)
            k = min(nu, int(u * nu))
            ragged = (0.25 * tear[k] ** 3 + 0.03 * tear[k + 1]) if v > 0.999 else 0.0
            z = top + (foot - top) * v + ragged - hang * (u ** 2) * (1 - v * 0.4)
            # the cloth swings in a little toward the foot
            return (p.x + nrm.x * off, p.y + nrm.y * off, z)
        sheet(b, Cl, pt, nu, nv)
        # hooks: a wire from the track to each pleat
        for k in range(0, nu + 1, 6):
            u = k / nu
            p, _ = on_track(s0 + u * run)
            q = pt(u, 0)
            if hang and u > 0.5: continue
            pipe(b, [(p.x, p.y, zt - 0.012), q], 0.0025, S, 4, caps=False)
        s += run + rng.uniform(0.1, 0.5)


def iv(b, rng):
    """a drip stand: five legs on castors, a pole in two parts with its clamp, four hooks, a bag still hanging with its line"""
    C, R_ = WK.CHROME(), WK.RUBBER()
    _star(b, (0, 0, 0), 5, 0.27, 0.025, C, R_, C, h=0.1, rng=rng)
    pipe(b, [(0, 0, 0.16), (0, 0, 1.15)], 0.0125, C, 10)
    turned(b, (0, 0, 1.1), [(0, 0.014), (0.004, 0.019), (0.05, 0.019), (0.054, 0.014)], WK.BLACKM(), 10)
    pipe(b, [(0.03, 0, 1.125), (0.045, 0, 1.125)], 0.006, WK.BLACKM(), 6)
    turned(b, (0.045, 0, 1.125), [(0, 0.013), (0.012, 0.013)], WK.BLACKM(), 8, axis=(1, 0, 0))
    pipe(b, [(0, 0, 1.15), (0, 0, 1.92)], 0.008, C, 8)
    hooks = []
    for k in range(4):
        a = k * math.pi / 2 + 0.3
        tip = (math.cos(a) * 0.11, math.sin(a) * 0.11, 1.93)
        pipe(b, [(0, 0, 1.92), (math.cos(a) * 0.05, math.sin(a) * 0.05, 1.975), (math.cos(a) * 0.11, math.sin(a) * 0.11, 1.975), tip], 0.0035, C, 5, bend=0.025, seg=3)
        hooks.append(tip)
    # a bag: a flat pouch, slack, with its ports and a line down to nothing
    hx, hy, hz = hooks[0]
    bz = hz - 0.16
    soft(b, (hx, hy, bz), (0.12, 0.02, 0.2), WK.BAG(), r=0.009, res=0.03, yaw=0.3 + math.pi / 2, crown=0.0, lumps=0.003, seed=rng.random() * 5,
         shape=lambda q: Vector((q.x * (0.75 + 0.25 * (0.5 - q.z / 0.2)), q.y * (1.0 + 1.6 * max(0.0, 0.5 - q.z / 0.2)), q.z)))
    pipe(b, [(hx, hy, hz), (hx, hy, bz + 0.1)], 0.0025, C, 4, caps=False)
    turned(b, (hx, hy, bz - 0.16), [(0, 0.004), (0.01, 0.009), (0.05, 0.009), (0.06, 0.004)], WK.BAG(), 8)
    line = [(hx, hy, bz - 0.1), (hx, hy, bz - 0.5), (hx + 0.05, hy + 0.03, bz - 0.9), (hx - 0.03, hy + 0.1, bz - 1.2), (hx + 0.06, hy + 0.16, 0.012), (hx + 0.2, hy + 0.3, 0.008)]
    pipe(b, line, 0.0028, WK.BAG(), 5, bend=0.12, seg=4)


def screen(b, rng):
    """a folding ward screen: three tube frames on little wheels, hinged, cloth gathered on a rod top and bottom of each"""
    S, Cl, R_ = WK.CHROME(), WK.CLOTH(), WK.RUBBER()
    w, h = 0.56, 1.68
    x, y, a = -0.9, 0.0, rng.uniform(0.25, 0.5)
    for k in range(3):
        ang = a if k % 2 == 0 else -a
        if k == 2: ang = rng.uniform(-0.2, 0.9)
        dx, dy = math.cos(ang), math.sin(ang)
        P = lambda u, z, x=x, y=y, dx=dx, dy=dy: (x + dx * u, y + dy * u, z)
        pipe(b, [P(0, 0.06), P(0, h), P(w, h), P(w, 0.06)], 0.011, S, 8, bend=0.05, seg=4)
        pipe(b, [P(0, 0.2), P(w, 0.2)], 0.008, S, 6, caps=False)
        for u in (0.0, w):
            turned(b, P(u, 0.0), [(0, 0.02), (0.012, 0.024), (0.04, 0.024), (0.06, 0.011)], R_, 8)
        # the cloth: gathered, hanging between the top bar and the bottom one, a little slack
        ph = rng.uniform(0, 6)
        torn = rng.random() < 0.3
        sheet(b, Cl, lambda u, v, P=P, dx=dx, dy=dy, ph=ph, torn=torn: (lambda p, off: (p[0] - dy * off, p[1] + dx * off, p[2]))(
            P(0.02 + u * (w - 0.04), h - 0.03 - v * (h - 0.25 - (0.5 * u if torn else 0))), (0.012 + 0.01 * math.sin(v * 3.1)) * math.sin(u * 44 + ph) * (0.6 + 0.4 * abs(v - 0.5) * 2) + 0.02 * math.sin(v * 3.14)), 40, 6)
        x, y = x + dx * w, y + dy * w


def lockers(b, rng):
    """a bank of four steel lockers on a plinth: folded doors with louvres and a hasp, one standing open on its shelf and
    hook, one stove in"""
    Lk, C = WK.LOCKER(), WK.CHROME()
    n, w, d, h = 4, 0.3, 0.45, 1.8
    y0, y1 = -0.25, 0.2
    panel(b, (0, (y0 + y1) / 2, 0.04), (n * w - 0.02, d - 0.03, 0.08), WK.SOOT(), 0.004)
    # carcass: back, sides, dividers, top with a slope so nothing is left on it
    panel(b, (0, y1 - 0.006, 0.08 + h / 2), (n * w, 0.012, h), Lk, 0.002)
    for k in range(n + 1):
        panel(b, (-n * w / 2 + k * w, (y0 + y1) / 2, 0.08 + h / 2), (0.012, d, h), Lk, 0.003)
    panel(b, (0, (y0 + y1) / 2, 0.08 + h - 0.006), (n * w, d, 0.012), Lk, 0.003)
    panel(b, (0, (y0 + y1) / 2, 0.086), (n * w, d, 0.012), Lk, 0.003)
    for k in range(n):
        cx = -n * w / 2 + (k + 0.5) * w
        state = rng.random()
        opening = state < 0.3
        ang = rng.uniform(0.9, 1.9) if opening else (rng.uniform(0.04, 0.12) if state < 0.5 else 0.0)
        hx = cx - w / 2 + 0.008           # hinge edge
        # the door, about its hinge
        dw = w - 0.016
        ca, sa = math.cos(-ang), math.sin(-ang)

        def D(u, v, out=0.0, hx=hx, ca=ca, sa=sa):
            """a point on the door: u across from the hinge, v up, out toward the room"""
            return (hx + ca * u - sa * (-out), y0 + sa * u + ca * (-out), 0.09 + v)
        yaw = -ang
        mid = D(dw / 2, (h - 0.02) / 2, 0.006)
        panel(b, mid, (dw, 0.014, h - 0.02), Lk, 0.004, yaw=yaw)
        # louvres top and bottom: pressed slots, each a little lip
        for v0 in (0.16, h - 0.3):
            for j in range(4):
                c = D(dw / 2, v0 + j * 0.035, 0.016)
                panel(b, c, (dw * 0.6, 0.006, 0.012), WK.SOOT(), 0.002, yaw=yaw, tilt=(0.5, 0))
        # handle plate and hasp, a number plate
        c = D(dw - 0.04, h * 0.55, 0.016)
        panel(b, c, (0.03, 0.006, 0.1), C, 0.003, yaw=yaw)
        c = D(dw - 0.04, h * 0.55 - 0.02, 0.026)
        pipe(b, [D(dw - 0.04, h * 0.55 - 0.035, 0.018), D(dw - 0.04, h * 0.55 - 0.035, 0.04), D(dw - 0.04, h * 0.55 + 0.01, 0.04), D(dw - 0.04, h * 0.55 + 0.01, 0.018)], 0.003, C, 5, bend=0.012, seg=3)
        panel(b, D(dw / 2, h - 0.12, 0.014), (0.07, 0.003, 0.03), WK.WHITEP(), 0.001, yaw=yaw)
        # inside, where it shows: a shelf and a hook, something left behind
        if opening:
            panel(b, (cx, (y0 + y1) / 2, 0.09 + h - 0.3), (w - 0.02, d - 0.03, 0.01), Lk, 0.002)
            pipe(b, [(cx, y1 - 0.02, 0.09 + h - 0.36), (cx, y1 - 0.06, 0.09 + h - 0.36), (cx, y1 - 0.06, 0.09 + h - 0.4)], 0.004, C, 5, bend=0.015, seg=3)
            if rng.random() < 0.7:
                soft(b, (cx, (y0 + y1) / 2 + 0.03, 0.14), (0.2, 0.26, 0.09), WK.BLACKM(), r=0.035, res=0.05, lumps=0.012, seed=rng.random() * 9, crown=0.02)


def seats(b, rng):
    """waiting-room beam seating: moulded shells on a steel beam, two feet, an arm at each end; one shell gone"""
    St, Sh = WK.BLACKM(), WK.SEATP()
    n = 4
    w = 0.5
    y = -0.3
    # the beam and its legs
    panel(b, (0, y, 0.38), (n * w - 0.1, 0.06, 0.04), St, 0.006)
    for sx in (-1, 1):
        x = sx * (n * w / 2 - 0.35)
        panel(b, (x, y, 0.2), (0.05, 0.04, 0.36), St, 0.006)
        pipe(b, [(x, y - 0.24, 0.02), (x, y + 0.22, 0.02)], 0.02, St, 8, bend=0)
        for yy in (y - 0.24, y + 0.22):
            turned(b, (x, yy, 0.0), [(0, 0.028), (0.008, 0.03), (0.016, 0.022)], WK.RUBBER(), 8)
    gone = rng.randrange(n) if rng.random() < 0.6 else -1
    for k in range(n):
        cx = -n * w / 2 + (k + 0.5) * w
        # the bracket every shell sits on
        panel(b, (cx, y, 0.41), (0.3, 0.2, 0.012), St, 0.003)
        if k == gone: continue

        def shell(u, v, cx=cx):
            """one piece: seat (v 0..0.55) curving up into back (v 0.55..1), dished, the front edge rolled over"""
            x = (u - 0.5) * 0.44
            dish = 0.022 * (1 - (2 * u - 1) ** 2)
            if v < 0.5:
                t = v / 0.5
                yy = y - 0.24 + t * 0.4
                zz = 0.44 - dish + 0.03 * (1 - t) ** 3 * -1 + 0.012 * t
                if t < 0.12: zz -= 0.03 * (1 - t / 0.12) ** 2
            else:
                t = (v - 0.5) / 0.5
                ang = min(1.0, t / 0.25) * 1.38
                # the bend, then straight up the back
                if t < 0.25:
                    yy = y + 0.16 + 0.07 * math.sin(ang)
                    zz = 0.452 - dish + 0.07 * (1 - math.cos(ang))
                else:
                    s = (t - 0.25) / 0.75 * 0.36
                    yy = y + 0.16 + 0.07 * math.sin(1.38) + s * math.cos(1.38)
                    zz = 0.452 - dish * (1 - 0.5 * (t - 0.25)) + 0.07 * (1 - math.cos(1.38)) + s * math.sin(1.38)
                    yy += dish * 0.6
            return (cx + x * (1.0 - 0.06 * max(0, v - 0.7) / 0.3), yy, zz)
        vs = sheet(b, Sh, shell, 8, 18)
        # thickness: the same again a little under it, joined at the rim
        i = b.idx(Sh)
        under = [[b.bm.verts.new(Vector(v.co) + Vector((0, 0.008 if j > 10 else 0, -0.012 if j <= 10 else -0.004))) for v in row] for j, row in enumerate(vs)]
        for j in range(len(vs) - 1):
            for q in range(len(vs[0]) - 1):
                f = b.bm.faces.new((under[j][q], under[j + 1][q], under[j + 1][q + 1], under[j][q + 1])); f.material_index = i; f.smooth = True
        for j in range(len(vs) - 1):
            for q in (0, len(vs[0]) - 1):
                f = b.bm.faces.new((vs[j][q], vs[j + 1][q], under[j + 1][q], under[j][q]) if q else (vs[j + 1][q], vs[j][q], under[j][q], under[j + 1][q])); f.material_index = i
        for q in range(len(vs[0]) - 1):
            f = b.bm.faces.new((vs[0][q + 1], vs[0][q], under[0][q], under[0][q + 1])); f.material_index = i
            f = b.bm.faces.new((vs[-1][q], vs[-1][q + 1], under[-1][q + 1], under[-1][q])); f.material_index = i
    for sx in (-1, 1):
        x = sx * (n * w / 2 - 0.02)
        pipe(b, [(x, y - 0.18, 0.4), (x, y - 0.2, 0.64), (x, y + 0.14, 0.64), (x, y + 0.16, 0.4)], 0.013, St, 8, bend=0.05, seg=4)


def monitor(b, rng):
    """a bedside monitor on a rolling stand: the box with its dead screen, knobs and a handle, a basket under it, leads hanging"""
    C, R_ = WK.CHROME(), WK.RUBBER()
    _star(b, (0, 0, 0), 5, 0.25, 0.025, C, R_, C, rng=rng)
    pipe(b, [(0, 0, 0.15), (0, 0, 1.18)], 0.016, C, 10)
    # the basket: wire
    for z in (0.78, 0.9):
        pipe(b, [(-0.14, -0.2, z), (0.14, -0.2, z), (0.14, -0.02, z), (-0.14, -0.02, z)], 0.003, C, 4, bend=0.03, seg=3, closed=True)
    for k in range(7):
        x = -0.14 + k * 0.28 / 6
        pipe(b, [(x, -0.2, 0.9), (x, -0.2, 0.78), (x, -0.02, 0.78), (x, -0.02, 0.9)], 0.0022, C, 4, bend=0.01, seg=2)
    # the monitor
    zc = 1.33
    panel(b, (0, -0.04, zc), (0.42, 0.3, 0.32), WK.CREAM(), 0.022, seg=3)
    panel(b, (-0.06, -0.192, zc + 0.02), (0.25, 0.012, 0.2), WK.GLASSD(), 0.01)
    panel(b, (-0.06, -0.19, zc + 0.02), (0.28, 0.006, 0.23), WK.GREYP(), 0.012)
    for k in range(4):
        turned(b, (0.13, -0.19, zc + 0.1 - k * 0.055), [(0, 0.014), (-0.012, 0.014), (-0.016, 0.01)], WK.GREYP(), 10, axis=(0, 1, 0))
    for k in range(5):
        panel(b, (-0.16 + k * 0.05, -0.192, zc - 0.125), (0.03, 0.008, 0.016), WK.GREYP(), 0.003)
    pipe(b, [(-0.14, -0.04, zc + 0.16), (-0.14, -0.04, zc + 0.2), (0.14, -0.04, zc + 0.2), (0.14, -0.04, zc + 0.16)], 0.008, WK.GREYP(), 6, bend=0.03, seg=3)
    # leads: out of the side, over the basket, down
    for k in range(3):
        x0 = 0.21
        pts = [(x0, -0.1 + k * 0.03, zc - 0.1), (x0 + 0.06, -0.1 + k * 0.03, zc - 0.14), (x0 + 0.05 + rng.uniform(-0.05, 0.05), -0.12, 0.95), (0.1 + rng.uniform(-0.1, 0.1), -0.2 - rng.uniform(0, 0.1), 0.5 + rng.uniform(-0.2, 0.2)),
               (rng.uniform(-0.2, 0.2), -0.3, 0.012)]
        pipe(b, pts, 0.003, WK.CABLE(), 5, bend=0.1, seg=4)


def crashcart(b, rng):
    """the resuscitation trolley: a red drawer cabinet on castors, drawers part out, the defibrillator on top, a cylinder in
    its ring, a pole, a push bar"""
    R_, C, Rd = WK.RUBBER(), WK.CHROME(), WK.REDP()
    w, d, h = 0.62, 0.48, 0.78
    y = -0.36
    for sx in (-1, 1):
        for sy in (-1, 1):
            wheel(b, (sx * (w / 2 - 0.05), y + sy * (d / 2 - 0.05), 0), 0.05, R_, WK.STEEL(), yaw=rng.uniform(0, 3), w=0.026)
    z0 = 0.13
    panel(b, (0, y, z0 + h / 2), (w, d, h), Rd, 0.014, seg=3)
    # drawers: fronts proud of the carcass, a bar handle each, some left out
    n = 5
    dh = (h - 0.06) / n
    for k in range(n):
        out = rng.choice((0.0, 0.0, 0.0, rng.uniform(0.05, 0.22)))
        zc = z0 + 0.03 + (k + 0.5) * dh
        panel(b, (0, y - d / 2 - 0.006 - out, zc), (w - 0.04, 0.02, dh - 0.012), Rd, 0.005)
        if out > 0.02:
            panel(b, (0, y - d / 2 - out / 2, zc - 0.01), (w - 0.07, out, dh - 0.04), WK.STEEL(), 0.002)
        pipe(b, [(-0.15, y - d / 2 - 0.016 - out, zc), (-0.15, y - d / 2 - 0.04 - out, zc), (0.15, y - d / 2 - 0.04 - out, zc), (0.15, y - d / 2 - 0.016 - out, zc)], 0.005, C, 6, bend=0.015, seg=3)
        panel(b, (0.2, y - d / 2 - 0.018 - out, zc + 0.02), (0.07, 0.002, 0.025), WK.WHITEP(), 0.0005)
    # top: a lipped tray, the defibrillator
    zt = z0 + h
    for (cx, cy, sx, sy) in ((0, y - d / 2 + 0.006, w, 0.012), (0, y + d / 2 - 0.006, w, 0.012), (-w / 2 + 0.006, y, 0.012, d), (w / 2 - 0.006, y, 0.012, d)):
        panel(b, (cx, cy, zt + 0.02), (sx, sy, 0.04), Rd, 0.004)
    panel(b, (-0.08, y, zt + 0.1), (0.34, 0.3, 0.2), WK.CREAM(), 0.02, seg=3)
    panel(b, (-0.12, y - 0.151, zt + 0.13), (0.16, 0.006, 0.1), WK.GLASSD(), 0.006)
    for k in range(2):
        turned(b, (0.03 + k * 0.045, y - 0.151, zt + 0.13), [(0, 0.016), (-0.014, 0.016), (-0.018, 0.012)], WK.GREYP(), 10, axis=(0, 1, 0))
    pipe(b, [(-0.2, y, zt + 0.2), (-0.2, y, zt + 0.24), (0.04, y, zt + 0.24), (0.04, y, zt + 0.2)], 0.008, WK.GREYP(), 6, bend=0.03, seg=3)
    # the paddles' leads, coiled
    pts = [(0.1, y - 0.05, zt + 0.06)]
    for k in range(14):
        a = k * 1.3
        pts.append((0.2 + math.cos(a) * 0.035, y - 0.02 + math.sin(a) * 0.035, zt + 0.03 + k * 0.004))
    pipe(b, pts, 0.004, WK.CABLE(), 5, bend=0.03, seg=2)
    # push bar, pole, cylinder
    pipe(b, [(w / 2, y - 0.16, zt - 0.08), (w / 2 + 0.07, y - 0.16, zt - 0.08), (w / 2 + 0.07, y + 0.16, zt - 0.08), (w / 2, y + 0.16, zt - 0.08)], 0.011, C, 8, bend=0.035, seg=4)
    px, py = -w / 2 + 0.03, y + d / 2 - 0.03
    pipe(b, [(px, py, zt), (px, py, 1.7)], 0.009, C, 8)
    for k in range(2):
        a = k * math.pi + 0.8
        pipe(b, [(px, py, 1.69), (px + math.cos(a) * 0.08, py + math.sin(a) * 0.08, 1.71), (px + math.cos(a) * 0.1, py + math.sin(a) * 0.1, 1.67)], 0.004, C, 5, bend=0.02, seg=3)
    cx, cy = -w / 2 - 0.075, y + 0.06
    turned(b, (cx, cy, 0.2), [(0, 0.03), (0.01, 0.055), (0.5, 0.055), (0.56, 0.03), (0.6, 0.016), (0.64, 0.016), (0.65, 0.026), (0.68, 0.026), (0.69, 0.012)], WK.BLACKM(), 12)
    turned(b, (cx, cy, 0.56), [(0, 0.0565), (0.14, 0.0565)], WK.WHITEP(), 12, cap0=False, cap1=False)
    for z in (0.3, 0.62):
        pipe(b, [(-w / 2, cy - 0.06, z), (cx, cy - 0.066, z), (cx - 0.066, cy, z), (cx, cy + 0.066, z), (-w / 2, cy + 0.06, z)], 0.004, C, 5, bend=0.05, seg=4)


def sink(b, rng):
    """a clinical hand basin on the wall: the bowl, lever taps, the trap under it, a splashback, soap and towels over, a
    pedal bin beside"""
    Wh, C = WK.WHITEP(), WK.CHROME()
    zr = 0.86
    c = (0, -0.21)
    rings = [oval(c, 0.2, 0.15, zr - 0.2, 22, 3.2), oval(c, 0.27, 0.2, zr - 0.07, 22, 3.6), oval(c, 0.28, 0.205, zr - 0.012, 22, 3.8), oval(c, 0.275, 0.2, zr, 22, 3.8),
             oval(c, 0.245, 0.17, zr, 22, 3.6), oval(c, 0.235, 0.16, zr - 0.012, 22, 3.4), oval((0, -0.215), 0.19, 0.125, zr - 0.09, 22, 3.0), oval((0, -0.22), 0.09, 0.06, zr - 0.135, 22, 2.4),
             oval((0, -0.22), 0.022, 0.022, zr - 0.14, 22, 2.0)]
    loft(b, rings, Wh, cap0=True, cap1=True)
    turned(b, (0, -0.22, zr - 0.142), [(0, 0.024), (0.004, 0.024)], C, 10)
    # splashback, taps with long levers
    panel(b, (0, -0.008, zr + 0.2), (0.6, 0.012, 0.42), Wh, 0.004)
    for sx in (-1, 1):
        x = sx * 0.09
        pipe(b, [(x, -0.03, zr), (x, -0.03, zr + 0.1), (x, -0.16, zr + 0.11), (x, -0.165, zr + 0.085)], 0.011, C, 8, bend=0.03, seg=4)
        pipe(b, [(x, -0.03, zr + 0.1), (x + sx * 0.02, -0.035, zr + 0.125), (x + sx * 0.14, -0.1, zr + 0.13)], 0.006, C, 6, bend=0.02, seg=3)
    # the trap
    pipe(b, [(0, -0.22, zr - 0.14), (0, -0.22, zr - 0.3), (0, -0.16, zr - 0.36), (0, -0.1, zr - 0.3), (0, -0.1, zr - 0.25), (0, 0.0, zr - 0.25)], 0.018, C, 10, bend=0.045, seg=4)
    turned(b, (0, -0.22, zr - 0.3), [(0, 0.024), (0.03, 0.024)], C, 10)
    for sx in (-1, 1):
        pipe(b, [(sx * 0.09, -0.04, zr - 0.02), (sx * 0.09, -0.04, zr - 0.3), (sx * 0.09, 0.0, zr - 0.32)], 0.006, C, 6, bend=0.02, seg=3)
    # brackets
    for sx in (-1, 1):
        plate(b, [(0, 0), (0.26, 0), (0.26, -0.03), (0.03, -0.2), (0, -0.2)], 0.004, Wh, origin=(sx * 0.2, 0, zr - 0.08), x=(0, -1, 0), y=(0, 0, 1))
    # soap, and the towel box with one hanging out
    panel(b, (-0.2, -0.05, zr + 0.5), (0.09, 0.09, 0.2), WK.GREYP(), 0.012, seg=3)
    pipe(b, [(-0.2, -0.09, zr + 0.4), (-0.2, -0.13, zr + 0.4), (-0.2, -0.13, zr + 0.37)], 0.005, C, 5, bend=0.012, seg=3)
    panel(b, (0.2, -0.06, zr + 0.62), (0.3, 0.12, 0.34), Wh, 0.012, seg=3)
    sheet(b, WK.PAPER(), lambda u, v: (0.1 + u * 0.2, -0.1 - 0.02 * math.sin(v * 2.4) - 0.008 * math.sin(u * 9), zr + 0.455 - v * 0.14), 6, 5)
    # the bin: a pedal bin with its lid up
    bx, by = 0.44, -0.2
    turned(b, (bx, by, 0), [(0, 0.12), (0.01, 0.13), (0.4, 0.14), (0.41, 0.132)], WK.YELLOWP(), 14, cap1=False)
    turned(b, (bx, by, 0.4), [(0, 0.132), (0.01, 0.125)], WK.SOOT(), 14, cap0=False)
    plate(b, [(math.cos(k * 0.5236) * 0.14, math.sin(k * 0.5236) * 0.14) for k in range(12)], 0.006, Wh, origin=(bx, by + 0.11, 0.52), x=(1, 0, 0), y=(0, 0.3, 1))
    panel(b, (bx, by - 0.15, 0.02), (0.07, 0.05, 0.012), WK.BLACKM(), 0.004)


def vending(b, rng):
    """a drinks machine: a steel cabinet with a glass front on racks of coils, a few things still in them, the coin panel, the
    flap they dropped out of; forced, so the door stands a hand's width open"""
    G, C = WK.GREYP(), WK.CHROME()
    w, d, h = 0.9, 0.78, 1.83
    y = -d / 2
    panel(b, (0, y + 0.012, h / 2 + 0.02), (w, d - 0.03, h), G, 0.012, seg=2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            turned(b, (sx * (w / 2 - 0.07), y + sy * (d / 2 - 0.08), 0), [(0, 0.03), (0.02, 0.03)], WK.BLACKM(), 8)
    # the door: a frame round the glass, hung on the left, a little open
    ang = rng.uniform(0.0, 0.22)
    hx, hy = -w / 2 + 0.01, -d + 0.02
    ca, sa = math.cos(-ang), math.sin(-ang)
    D = lambda u, v, out=0.0: (hx + ca * u + sa * out, hy + sa * u - ca * out, 0.02 + v)
    yaw = -ang
    gw = 0.62
    panel(b, D((w - 0.02) / 2, h / 2, 0.0), (w - 0.02, 0.05, h - 0.01), G, 0.012, yaw=yaw, seg=2)
    panel(b, D(0.05 + gw / 2, 0.42 + 1.3 / 2, 0.022), (gw, 0.012, 1.3), WK.GLASSD(), 0.004, yaw=yaw)
    # bands of colour either side of the glass and along the top, the maker's panel
    panel(b, D((w - 0.02) / 2, h - 0.07, 0.027), (w - 0.06, 0.004, 0.09), WK.REDP(), 0.002, yaw=yaw)
    panel(b, D(0.05 + gw + 0.09, 1.2, 0.027), (0.13, 0.004, 0.9), WK.BLACKM(), 0.004, yaw=yaw)
    panel(b, D(0.05 + gw + 0.09, 1.42, 0.03), (0.09, 0.006, 0.13), WK.GLASSD(), 0.004, yaw=yaw)
    for j in range(4):
        for k in range(3):
            panel(b, D(0.05 + gw + 0.06 + k * 0.03, 1.27 - j * 0.03, 0.031), (0.02, 0.006, 0.02), C, 0.003, yaw=yaw)
    panel(b, D(0.05 + gw + 0.09, 1.05, 0.031), (0.05, 0.008, 0.012), WK.SOOT(), 0.002, yaw=yaw)
    panel(b, D(0.05 + gw + 0.09, 0.92, 0.031), (0.08, 0.008, 0.06), C, 0.006, yaw=yaw)
    # the flap
    panel(b, D(0.05 + gw / 2, 0.22, 0.027), (gw - 0.06, 0.008, 0.2), WK.SOOT(), 0.012, yaw=yaw)
    panel(b, D(0.05 + gw / 2, 0.3, 0.034), (gw - 0.1, 0.006, 0.03), C, 0.003, yaw=yaw)
    # inside: trays of wire coils, a tin or a packet left in a few
    for j in range(5):
        z = 0.52 + j * 0.25
        panel(b, (-0.1, y + 0.05, z), (gw - 0.02, d - 0.2, 0.01), WK.STEEL(), 0.002)
        for k in range(5):
            cx = -0.1 - (gw - 0.1) / 2 + k * (gw - 0.1) / 4
            pts = []
            for q in range(15):
                a = q * 1.5
                pts.append((cx + math.cos(a) * 0.035, y - d / 2 + 0.12 + q * 0.028, z + 0.05 + math.sin(a) * 0.035))
            pipe(b, pts, 0.0025, C, 4, bend=0.02, seg=1, caps=False)
            if rng.random() < 0.22:
                m = rng.choice((WK.LABEL_R(), WK.LABEL_B(), WK.LABEL_Y(), WK.LABEL_G()))
                if rng.random() < 0.5: turned(b, (cx, y - d / 2 + 0.14 + rng.uniform(0, 0.2), z + 0.006), [(0, 0.028), (0.005, 0.031), (0.11, 0.031), (0.118, 0.026)], m, 10)
                else: panel(b, (cx, y - d / 2 + 0.14 + rng.uniform(0, 0.2), z + 0.07), (0.06, 0.03, 0.12), m, 0.006)


def cylinders(b, rng):
    """gas bottles: a row chained to a wall rack, their caps and valves on, a pair on a hand trolley, one rolled away"""
    def bottle(x, y, z, hgt, r, m, lie=None):
        prof = [(0, r * 0.6), (0.012, r * 0.93), (0.03, r), (hgt * 0.8, r), (hgt * 0.87, r * 0.8), (hgt * 0.92, r * 0.42), (hgt * 0.94, r * 0.3), (hgt * 0.97, r * 0.3)]
        ax = lie or (0, 0, 1)
        turned(b, (x, y, z), prof, m, 14, axis=ax)
        A = Vector(ax).normalized()
        top = Vector((x, y, z)) + A * (hgt * 0.97)
        turned(b, top, [(0, r * 0.34), (0.01, r * 0.5), (hgt * 0.06, r * 0.5), (hgt * 0.075, r * 0.3)], WK.BLACKM(), 10, axis=ax)
        turned(b, Vector((x, y, z)) + A * (hgt * 0.83), [(0, r * 0.905), (hgt * 0.05, r * 0.72)], WK.WHITEP(), 14, axis=ax, cap0=False, cap1=False)
    mats = (WK.BLACKM(), WK.GREENC(), WK.STEEL(), WK.BLACKM())
    # the rack: two rails on the wall, a chain across
    for z in (0.5, 1.0):
        panel(b, (0.2, -0.03, z), (1.2, 0.04, 0.05), WK.STEEL(), 0.006)
    xs = []
    for k in range(4):
        x = -0.3 + k * 0.33 + rng.uniform(-0.02, 0.02)
        hgt = rng.choice((1.2, 1.36, 1.36))
        bottle(x, -0.18, 0, hgt, 0.105, mats[k])
        xs.append(x)
    pts = [(-0.42, -0.04, 0.95)]
    for x in xs:
        pts += [(x - 0.1, -0.24, 0.9), (x, -0.3, 0.88), (x + 0.1, -0.24, 0.9)]
    pts.append((xs[-1] + 0.16, -0.04, 0.95))
    pipe(b, pts, 0.006, WK.STEEL(), 5, bend=0.06, seg=3)
    # the hand trolley with two small ones
    tx, ty = 1.3, -0.45
    pipe(b, [(tx - 0.16, ty + 0.1, 0.08), (tx - 0.16, ty + 0.36, 1.15), (tx + 0.16, ty + 0.36, 1.15), (tx + 0.16, ty + 0.1, 0.08)], 0.014, WK.STEEL(), 8, bend=0.08, seg=4)
    panel(b, (tx, ty, 0.03), (0.4, 0.26, 0.012), WK.STEEL(), 0.004)
    for sx in (-1, 1):
        turned(b, (tx + sx * 0.2, ty + 0.14, 0.09), [(-0.02, 0.06), (-0.016, 0.09), (0.016, 0.09), (0.02, 0.06)], WK.RUBBER(), 14, axis=(1, 0, 0))
        bottle(tx + sx * 0.085, ty + 0.02, 0.04, 0.92, 0.075, WK.GREENC() if sx < 0 else WK.BLACKM())
    pipe(b, [(tx - 0.16, ty + 0.2, 0.55), (tx, ty - 0.08, 0.55), (tx + 0.16, ty + 0.2, 0.55)], 0.005, WK.STEEL(), 5, bend=0.08, seg=4)
    # and one on the floor
    bottle(0.3 + rng.uniform(-0.2, 0.2), -0.85, 0.106, 1.2, 0.105, WK.GREENC(), lie=(math.cos(0.4), math.sin(0.4), 0))


def worklight(b, rng):
    """a site light: a tripod with its braces, a telescoping mast, two halogen floods on a bar (finned backs, wire guards,
    handles), the cable off across the floor. It looks along -y; the lamp is a light in the layout at head height (1.74)"""
    S, Y = WK.BLACKM(), WK.YELLOW()
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.5
        fx, fy = math.cos(a) * 0.55, math.sin(a) * 0.55
        pipe(b, [(math.cos(a) * 0.03, math.sin(a) * 0.03, 0.64), (fx, fy, 0.03)], 0.013, S, 8)
        pipe(b, [(math.cos(a) * 0.02, math.sin(a) * 0.02, 0.3), (fx * 0.5, fy * 0.5, 0.33)], 0.007, S, 6)
        turned(b, (fx, fy, 0), [(0, 0.022), (0.03, 0.022), (0.04, 0.014)], WK.RUBBER(), 8)
    turned(b, (0, 0, 0.6), [(0, 0.03), (0.01, 0.04), (0.06, 0.04), (0.07, 0.03)], S, 10)
    turned(b, (0, 0, 0.27), [(0, 0.028), (0.05, 0.028)], S, 10)
    pipe(b, [(0, 0, 0.27), (0, 0, 1.2)], 0.019, S, 10)
    turned(b, (0, 0, 1.17), [(0, 0.024), (0.05, 0.024)], S, 10)
    pipe(b, [(0.024, 0, 1.195), (0.06, 0, 1.195)], 0.005, S, 6)
    pipe(b, [(0, 0, 1.2), (0, 0, 1.66)], 0.013, Y, 10)
    pipe(b, [(-0.32, 0, 1.66), (0.32, 0, 1.66)], 0.012, S, 8)
    for x in (-0.22, 0.22):
        tilt = rng.uniform(-0.15, 0.1)
        M = Matrix.Translation((x, -0.03, 1.76)) @ Matrix.Rotation(tilt, 4, 'X')
        T = lambda p: tuple(M @ Vector(p))
        # the housing: a tray tapering back, fins across the back
        panel(b, T((0, 0.0, 0)), (0.27, 0.085, 0.2), Y, 0.012, tilt=(tilt, 0), top=(1.0, 1.0), seg=2)
        for k in range(7):
            panel(b, T((-0.105 + k * 0.035, 0.055, 0)), (0.006, 0.03, 0.17), Y, 0.002, tilt=(tilt, 0), seg=1)
        panel(b, T((0, -0.046, 0)), (0.235, 0.008, 0.165), WK.LENS(), 0.004, tilt=(tilt, 0), seg=1)
        # guard: wires across the glass
        for k in range(5):
            xx = -0.1 + k * 0.05
            pipe(b, [T((xx, -0.043, -0.09)), T((xx, -0.075, -0.07)), T((xx, -0.075, 0.07)), T((xx, -0.043, 0.09))], 0.002, S, 4, bend=0.02, seg=2)
        # the stirrup it tilts in, and a handle
        pipe(b, [(x - 0.15, 0.0, 1.76), (x - 0.15, 0.0, 1.66), (x + 0.15, 0.0, 1.66), (x + 0.15, 0.0, 1.76)], 0.005, S, 6, bend=0.03, seg=3)
        pipe(b, [T((-0.05, 0.02, 0.1)), T((-0.05, 0.02, 0.135)), T((0.05, 0.02, 0.135)), T((0.05, 0.02, 0.1))], 0.006, S, 6, bend=0.02, seg=3)
    # the cable: down the mast, off along the floor in loose curves
    pts = [(0.0, 0.03, 1.55), (0.02, 0.05, 1.1), (0.05, 0.1, 0.5), (0.12, 0.2, 0.012)]
    a = rng.uniform(0, 6.28)
    x, y = 0.12, 0.2
    for k in range(7):
        a += rng.uniform(-0.7, 0.7)
        x += math.cos(a) * 0.45; y += abs(math.sin(a)) * 0.45 + 0.1
        pts.append((x, y, 0.01))
    pipe(b, pts, 0.008, WK.CABLE(), 6, bend=0.18, seg=4)


def oplamp(b, rng):
    """the lamp over the operating table: a ceiling plate, a stem, two jointed arms, a wide dish with its facets and the
    sterile handle in the middle. Origin at the ceiling"""
    S, C = WK.CREAM(), WK.CHROME()
    turned(b, (0, 0, -0.03), [(0, 0.16), (0.03, 0.16)], S, 20)
    pipe(b, [(0, 0, -0.03), (0, 0, -0.5)], 0.035, S, 12)
    turned(b, (0, 0, -0.56), [(0, 0.03), (0.01, 0.055), (0.07, 0.055), (0.08, 0.03)], S, 14)
    pipe(b, [(0, 0, -0.52), (0.55, 0.1, -0.62)], 0.028, S, 10)
    turned(b, (0.55, 0.1, -0.66), [(0, 0.03), (0.01, 0.045), (0.07, 0.045), (0.08, 0.03)], S, 14)
    pipe(b, [(0.55, 0.1, -0.62), (0.3, -0.2, -0.95)], 0.024, S, 10)
    c = (0.3, -0.2, -1.06)
    turned(b, (c[0], c[1], c[2] + 0.11), [(0, 0.03), (0.01, 0.05), (0.04, 0.05)], S, 12)
    # the dish: a shallow bowl of pressed metal, a rolled rim, the glass under it in rings
    prof = [(0.07, 0.06), (0.066, 0.18), (0.05, 0.28), (0.02, 0.37), (-0.02, 0.415), (-0.046, 0.425), (-0.056, 0.415)]
    turned(b, c, list(reversed([(h, r) for h, r in prof])), S, 28, cap0=False, cap1=True)
    turned(b, c, [(-0.056, 0.412), (-0.05, 0.3), (-0.05, 0.0005)], WK.LENS(), 28, cap0=False, cap1=False)
    for r in (0.13, 0.26, 0.38):
        turned(b, (c[0], c[1], c[2] - 0.052), [(0, r), (-0.004, r + 0.004), (0, r + 0.008)], C, 28, cap0=False, cap1=False)
    turned(b, (c[0], c[1], c[2] - 0.05), [(0, 0.03), (-0.02, 0.022), (-0.12, 0.018), (-0.13, 0.012)], WK.WHITEP(), 12)
    pipe(b, [(c[0] + 0.42, c[1], c[2] - 0.02), (c[0] + 0.5, c[1], c[2] - 0.02), (c[0] + 0.5, c[1], c[2] - 0.1)], 0.01, C, 8, bend=0.03, seg=3)


def bodybag(b, rng):
    """a body bag with someone in it: the shape under the vinyl, the zip down the middle, a tag on the toe end"""
    Bg = WK.BAGB()
    L, W = 1.9, 0.54

    def body(q):
        t = (q.y + L / 2) / L             # 0 at the feet, 1 at the head
        wide = 0.52 + 0.48 * max(0.0, math.sin(min(1.0, t * 1.15) * math.pi)) ** 0.7
        tall = (0.45 + 0.3 * math.exp(-((t - 0.05) / 0.06) ** 2) + 0.55 * math.exp(-((t - 0.62) / 0.2) ** 2) + 0.5 * math.exp(-((t - 0.92) / 0.06) ** 2)) * (0.6 + 0.4 * wide)
        z = q.z
        if z > -0.09: z = -0.09 + (z + 0.09) * tall * 1.15
        # the vinyl sags between what holds it up
        z -= 0.012 * (1 + math.sin(q.y * 23 + q.x * 9)) * max(0.0, 1 - abs(q.x) / (W / 2))
        return Vector((q.x * wide, q.y, z))
    soft(b, (0, -0.05, 0.1), (W, L, 0.2), Bg, r=0.07, res=0.05, lumps=0.006, seed=rng.random() * 9, shape=body)
    # the zip: a raised line along the top, its puller
    sheet(b, WK.STEEL(), lambda u, v: (rng.uniform(-0.002, 0.002) + (v - 0.5) * 0.012 + 0.03 * math.sin(u * 3), -0.9 + u * 1.7, 0.2 + 0.05 * math.exp(-((u - 0.62) / 0.2) ** 2) + 0.05 * math.exp(-((u - 0.92) / 0.06) ** 2) - 0.05 * (1 - max(0.0, math.sin(min(1, u * 1.15) * math.pi)) ** 0.7) + 0.004), 30, 1, two=True)
    sheet(b, WK.PAPER(), lambda u, v: (0.1 + u * 0.09, -0.98 - v * 0.05, 0.12 - u * 0.05 - v * 0.03), 1, 1, two=True)


KINDS.update(gurney=gurney, curtain=curtain, iv=iv, screen=screen, lockers=lockers, seats=seats, monitor=monitor, crashcart=crashcart, sink=sink, vending=vending,
             cylinders=cylinders, worklight=worklight, oplamp=oplamp, bodybag=bodybag)
FINISH.update(curtain=0.0, screen=0.0, iv=0.0, bodybag=0.0, gurney=0.0, seats=0.0, monitor=0.0, crashcart=0.0, sink=0.0, vending=0.0, cylinders=0.0, worklight=0.0, oplamp=0.0, lockers=0.0)
VARIANTS.update(iv=3, screen=3, lockers=3, seats=3, monitor=2, bodybag=3, cylinders=2, vending=2, sink=2, crashcart=2)


# ------------------------------------------------------------------ the store
def _pallet(b, rng, c=(0, 0, 0), yaw=0.0, m=None):
    """a timber pallet, 1.0 x 1.2: nine blocks, three bearers, deck boards with gaps, the odd one split or gone"""
    m = m or WK.WOOD()
    M = Matrix.Translation(Vector(c)) @ Matrix.Rotation(yaw, 4, 'Z')
    P = lambda x, y, z: tuple(M @ Vector((x, y, z)))
    for y in (-0.55, 0.0, 0.55):
        panel(b, P(0, y, 0.011), (1.0, 0.1, 0.022), m, 0.003, yaw=yaw, seg=1)
        for x in (-0.45, 0.0, 0.45):
            panel(b, P(x, y, 0.061), (0.1, 0.1, 0.078), m, 0.004, yaw=yaw, seg=1)
    for x in (-0.45, 0.0, 0.45):
        panel(b, P(x, 0, 0.111), (0.1, 1.2, 0.022), m, 0.003, yaw=yaw, seg=1)
    for k in range(7):
        if rng.random() < 0.07: continue
        y = -0.55 + k * 0.1833
        short = rng.random() < 0.08
        w = 0.6 if short else 1.0
        panel(b, P(-(1.0 - w) / 2, y + rng.uniform(-0.006, 0.006), 0.133), (w, rng.uniform(0.085, 0.1), 0.022), m, 0.003, yaw=yaw + rng.uniform(-0.012, 0.012), tilt=(0, rng.uniform(-0.01, 0.01)), seg=1)


def pallet(b, rng):
    _pallet(b, rng)


def checkout(b, rng):
    """a till lane, 2.6 long along y, the customer walking +y to -y on its -x side: a belt between steel rails with its end
    roller, the scanner in its bezel, the bagging well with its hooks, the screen on an arm, the card reader on its stalk,
    the drawer out, the divider rail, the lane light on its post"""
    Bd, Lt, C, Bl = WK.SHELFD(), WK.SHELFM(), WK.CHROME(), WK.BELT()
    # the body: belt section, scanner section, bagging end, the cashier's upstand
    panel(b, (0, 0.5, 0.435), (0.62, 1.5, 0.87), Bd, 0.02, seg=2)
    panel(b, (0, -0.55, 0.435), (0.62, 0.6, 0.87), Lt, 0.02, seg=2)
    panel(b, (0, -1.1, 0.33), (0.62, 0.5, 0.66), Bd, 0.02, seg=2)
    panel(b, (0.36, -0.2, 0.44), (0.1, 1.1, 0.88), Bd, 0.012, seg=2)
    panel(b, (0, 0.1, 0.03), (0.66, 2.5, 0.06), WK.SOOT(), 0.004, seg=1)
    # the belt: let into the top, a rail each side, a roller at each end
    panel(b, (0, 0.5, 0.874), (0.46, 1.36, 0.01), Bl, 0.002, seg=1)
    for sx in (-1, 1):
        panel(b, (sx * 0.255, 0.5, 0.884), (0.05, 1.46, 0.018), WK.STEEL(), 0.006, seg=2)
    for yy in (-0.2, 1.2):
        turned(b, (-0.23, yy, 0.862), [(0, 0.018), (0.46, 0.018)], WK.STEEL(), 10, axis=(1, 0, 0))
    # the scanner: glass in a steel bezel, the upright scanner behind it
    panel(b, (0, -0.55, 0.873), (0.4, 0.4, 0.012), WK.STEEL(), 0.012, seg=2)
    panel(b, (0, -0.55, 0.876), (0.33, 0.33, 0.01), WK.GLASSD(), 0.006, seg=1)
    panel(b, (0.2, -0.55, 0.98), (0.07, 0.3, 0.22), Bd, 0.014, seg=2)
    panel(b, (0.163, -0.55, 0.98), (0.006, 0.24, 0.16), WK.GLASSD(), 0.003, seg=1)
    # the bagging end: a frame of wire with the bags still on it
    pipe(b, [(-0.2, -1.3, 0.66), (-0.2, -1.3, 0.98), (0.2, -1.3, 0.98), (0.2, -1.3, 0.66)], 0.006, C, 6, bend=0.03, seg=3)
    for sx in (-0.14, 0.14):
        pipe(b, [(sx, -1.3, 0.98), (sx, -1.16, 0.98), (sx, -1.14, 0.96)], 0.004, C, 5, bend=0.015, seg=2)
    sheet(b, WK.BAG(), lambda u, v: (-0.14 + u * 0.28, -1.17 - 0.02 * math.sin(u * 3.14) - 0.03 * v + 0.01 * math.sin(u * 21 + v * 5), 0.975 - v * 0.3 - 0.012 * math.sin(u * 17)), 12, 5)
    # the screen on its arm, the keyboard, the card reader, the printer
    tw = rng.uniform(-0.5, 0.5)
    pipe(b, [(0.34, -0.5, 0.88), (0.34, -0.5, 1.3), (0.34 - 0.06 * math.sin(tw), -0.5 - 0.06 * math.cos(tw) + 0.06, 1.36)], 0.014, Bd, 8, bend=0.04, seg=3)
    panel(b, (0.34, -0.5, 1.42), (0.36, 0.045, 0.27), Bd, 0.012, yaw=tw, seg=2)
    panel(b, (0.34 - 0.024 * math.sin(tw), -0.5 - 0.024 * math.cos(tw), 1.425), (0.31, 0.004, 0.22), WK.GLASSD(), 0.004, yaw=tw, seg=1)
    panel(b, (0.2, -0.2, 0.895), (0.14, 0.34, 0.02), WK.GREYP(), 0.006, tilt=(0, -0.12), seg=1)
    for j in range(4):
        for k in range(9):
            panel(b, (0.155 + j * 0.03, -0.34 + k * 0.035, 0.908 - j * 0.0036), (0.022, 0.026, 0.008), WK.BLACKM(), 0.002, seg=1)
    pipe(b, [(-0.22, -0.3, 0.88), (-0.22, -0.3, 0.96), (-0.24, -0.31, 1.0)], 0.008, WK.GREYP(), 6, bend=0.02, seg=2)
    panel(b, (-0.25, -0.31, 1.01), (0.085, 0.15, 0.04), WK.GREYP(), 0.01, yaw=0.3, tilt=(0.45, 0), seg=2)
    pts = [(-0.22, -0.25, 0.9)] + [(-0.2 + math.cos(k * 1.4) * 0.012, -0.22 + k * 0.012, 0.9 + math.sin(k * 1.4) * 0.012) for k in range(12)] + [(0.0, -0.05, 0.89)]
    pipe(b, pts, 0.0028, WK.CABLE(), 4, bend=0.01, seg=1)
    panel(b, (0.2, 0.08, 0.93), (0.13, 0.16, 0.1), WK.GREYP(), 0.012, seg=2)
    sheet(b, WK.PAPER(), lambda u, v: (0.14 - v * 0.16 - 0.04 * math.sin(v * 2), 0.03 + u * 0.075, 0.975 + 0.05 * math.sin(v * 3.1) - v * 0.07), 2, 8)
    # the cash drawer, out
    if rng.random() < 0.7:
        out = rng.uniform(0.15, 0.32)
        panel(b, (0.41 + out / 2, -0.55, 0.72), (out + 0.1, 0.36, 0.085), Bd, 0.006, seg=1)
        for k in range(5):
            panel(b, (0.38 + out / 2, -0.69 + k * 0.07, 0.75), (out * 0.6, 0.004, 0.03), WK.BLACKM(), 0.001, seg=1)
    # the divider, and the lane light
    pipe(b, [(-0.3, 1.24, 0.87), (-0.3, 1.24, 1.12), (-0.3, 0.2, 1.12), (-0.3, 0.2, 0.87)], 0.012, C, 8, bend=0.06, seg=4)
    pipe(b, [(0.3, 1.2, 0.87), (0.3, 1.2, 2.26)], 0.019, Bd, 8)
    panel(b, (0.3, 1.2, 2.42), (0.42, 0.13, 0.32), Bd, 0.02, seg=2)
    for sy in (-1, 1):
        panel(b, (0.3, 1.2 + sy * 0.066, 2.42), (0.34, 0.004, 0.24), WK.WHITEP(), 0.004, seg=1)
    # what was left on the belt
    for k in range(rng.randint(0, 3)):
        w = rng.uniform(0.12, 0.2)
        WK.obox(b, (rng.uniform(-0.15, 0.15), rng.uniform(0.0, 1.0), 0.88 + w * 0.3), (w, w * 1.3, w * 0.6), rng.uniform(0, 3), rng.choice(WK.LABELS)())


def trussbay(b, rng):
    """the roof steel over the sales floor, a 3 m length along x, origin at the underside of the deck: an open-web joist
    (double-angle chords, a round bar bent zigzag between them), a purlin across, a ladder of cable tray on drop rods with
    its cables, a dead fitting's chains"""
    S = WK.RUST()
    zt, zb = -0.06, -0.7
    for (z, sg) in ((zt, 1), (zb, -1)):
        # two angles back to back: a flange each side, the legs down (or up) between
        panel(b, (1.5, 0, z + sg * 0.03), (3.0, 0.13, 0.008), S, 0.0, seg=1)
        for sy in (-0.012, 0.012):
            panel(b, (1.5, sy, z - sg * 0.004), (3.0, 0.008, 0.07), S, 0.0, seg=1)
    pts = []
    for k in range(9):
        pts.append((k * 0.375, 0, (zb + 0.03) if k % 2 == 0 else (zt - 0.03)))
    pipe(b, pts, 0.011, S, 6, bend=0.03, seg=2)
    # a purlin across, and a cleat
    panel(b, (rng.choice((0.75, 2.25)), 0.21, zt + 0.03 - 0.07), (0.05, 0.5, 0.012), S, 0.0, seg=1)
    # the tray: two rails and rungs, hung on studding, cables lying in it
    ty, tz = 0.35, -0.82
    for sy in (-0.1, 0.1):
        panel(b, (1.5, ty + sy, tz + 0.02), (3.0, 0.004, 0.05), WK.STEEL(), 0.0, seg=1)
    for k in range(10):
        panel(b, (0.15 + k * 0.3, ty, tz), (0.02, 0.2, 0.012), WK.STEEL(), 0.0, seg=1)
    for x in (0.4, 2.6):
        for sy in (-0.11, 0.11):
            pipe(b, [(x, ty + sy, tz), (x, ty + sy, -0.02)], 0.004, WK.STEEL(), 4, caps=False)
        panel(b, (x, ty, tz - 0.012), (0.03, 0.26, 0.02), WK.STEEL(), 0.0, seg=1)
    for k in range(rng.randint(3, 5)):
        yy = ty - 0.07 + k * 0.035
        r = rng.choice((0.006, 0.008, 0.011))
        pipe(b, [(0, yy, tz + 0.012 + r), (0.75, yy + rng.uniform(-0.01, 0.01), tz + 0.01 + r), (1.5, yy + rng.uniform(-0.012, 0.012), tz + 0.012 + r), (2.25, yy + rng.uniform(-0.01, 0.01), tz + 0.01 + r), (3.0, yy, tz + 0.012 + r)],
             r, WK.CABLE(), 5, bend=0.3, seg=2, caps=False)
    # something that hung here: a cable left down, or a pair of chains with nothing on them
    for k in range(rng.randint(1, 2)):
        x = rng.uniform(0.3, 2.7)
        if rng.random() < 0.5:
            pts = [(x, ty, tz + 0.01)]
            zz = tz
            for j in range(1, 5):
                zz -= rng.uniform(0.15, 0.3)
                pts.append((x + rng.uniform(-0.1, 0.1), ty + rng.uniform(-0.08, 0.08), zz))
            pipe(b, pts, 0.006, WK.CABLE(), 5, bend=0.12, seg=3)
        else:
            for dx in (-0.3, 0.3):
                pipe(b, [(x + dx, 0.0, zb - 0.03), (x + dx + rng.uniform(-0.02, 0.02), 0.0, zb - rng.uniform(0.5, 0.9))], 0.004, WK.STEEL(), 4)


def duct(b, rng):
    """three metres of air duct under the deck, origin at the deck: galvanised sheet, each panel cross-broken so it doesn't
    drum, a flanged joint at each end and the middle, on trapeze hangers; a diffuser under some; now and then a length has
    come off its rods at one end and hangs"""
    G, S = WK.GALV(), WK.STEEL()
    z = -1.0
    down = rng.random() < 0.08
    ang = 0.16 if down else 0.0
    w, h = 0.7, 0.42
    i = b.idx(G)
    M = Matrix.Translation((1.5, 0, z - (0.24 if down else 0))) @ Matrix.Rotation(ang, 4, 'Y')
    T = lambda x, y, zz: M @ Vector((x - 1.5, y, zz))

    def face(p0, p1, p2, p3, out):
        """a sheet panel creased corner to corner: its middle stands a finger out"""
        c = (Vector(p0) + Vector(p1) + Vector(p2) + Vector(p3)) / 4 + Vector(out) * 0.012
        v = [b.bm.verts.new(T(*p)) for p in (p0, p1, p2, p3)]
        cv = b.bm.verts.new(T(*c))
        for k in range(4):
            a, d = v[k], v[(k + 1) % 4]
            f = b.bm.faces.new((a, d, cv))
            f.material_index = i
            n = f.normal if f.normal.length > 0 else None
        return v
    for (x0, x1) in ((0.0, 1.5), (1.5, 3.0)):
        face((x0, -w / 2, -h / 2), (x1, -w / 2, -h / 2), (x1, -w / 2, h / 2), (x0, -w / 2, h / 2), (0, -1, 0))
        face((x1, w / 2, -h / 2), (x0, w / 2, -h / 2), (x0, w / 2, h / 2), (x1, w / 2, h / 2), (0, 1, 0))
        face((x0, w / 2, -h / 2), (x1, w / 2, -h / 2), (x1, -w / 2, -h / 2), (x0, -w / 2, -h / 2), (0, 0, -1))
        face((x0, -w / 2, h / 2), (x1, -w / 2, h / 2), (x1, w / 2, h / 2), (x0, w / 2, h / 2), (0, 0, 1))
    # flanges: a frame of folded edge round each joint, the corner pieces
    for x in (0.015, 1.5, 2.985):
        c = T(x, 0, 0)
        for (sy, sz, dy, dz) in ((0, h / 2 + 0.014, w + 0.056, 0.028), (0, -h / 2 - 0.014, w + 0.056, 0.028), (w / 2 + 0.014, 0, 0.028, h), (-w / 2 - 0.014, 0, 0.028, h)):
            panel(b, tuple(T(x, sy, sz)), (0.03 if x == 1.5 else 0.022, dy, dz), G, 0.003, tilt=(0, ang), seg=1)
    # trapeze hangers: studding down each side to a channel under the duct
    for x in (0.5, 2.5):
        if down and x > 1:
            pipe(b, [(x, 0.4, 0), (x, 0.4, -0.5)], 0.005, S, 4)
            continue
        zz = z - h / 2 - 0.03
        for sy in (-0.4, 0.4):
            pipe(b, [(x, sy, 0), (x, sy, zz - 0.02)], 0.005, S, 4, caps=False)
            turned(b, (x, sy, zz - 0.022), [(0, 0.011), (0.008, 0.011)], S, 6)
        panel(b, (x, 0, zz), (0.04, 0.86, 0.035), S, 0.003, seg=1)
    if rng.random() < 0.4 and not down:
        # a diffuser on a short neck: nested square louvres
        dx = rng.uniform(0.8, 2.2)
        zz = z - h / 2
        panel(b, (dx, 0, zz - 0.04), (0.3, 0.3, 0.08), G, 0.004, seg=1)
        for k in range(4):
            s_ = 0.56 - k * 0.12
            for (ax_, ay_) in ((1, 0), (0, 1)):
                for sg in (-1, 1):
                    panel(b, (dx + (0 if ax_ else sg * s_ / 2), (0 if ay_ else sg * s_ / 2), zz - 0.09 - k * 0.006), (s_ if ax_ else 0.012, s_ if ay_ else 0.012, 0.03), WK.WHITEP(), 0.002,
                          tilt=((-sg * 0.5 if ax_ else 0), (sg * 0.5 if ay_ else 0)), seg=1)
    if rng.random() < 0.3:
        # the lagging, come away
        x = rng.uniform(0.4, 2.6)
        sheet(b, WK.ROT(), lambda u, v: (x - 0.2 + u * 0.4 + 0.05 * v * math.sin(u * 5), 0.355 + 0.03 * v * math.sin(u * 7 + 1), z + 0.2 - v * (0.55 + 0.15 * math.sin(u * 4))), 6, 5)


def cart(b, rng):
    """a shopping trolley: a wire basket narrowing to the front on a bent tube chassis, the child seat flap, a plastic
    handle with its coin lock, four castors; a few of them over on their sides"""
    C = WK.CHROME()
    v0 = len(b.bm.verts)
    b.bm.verts.ensure_lookup_table()
    wf, wb = 0.2, 0.27              # half width front (-y) and back
    yf, yb = -0.45, 0.42
    zt = 0.98

    def side(t):                    # half width and floor of the basket along its length, t 0 front .. 1 back
        return wf + (wb - wf) * t, 0.52 - 0.07 * t
    # rims: top one heavier
    top = [(-wf, yf, zt), (wf, yf, zt), (wb, yb, zt), (-wb, yb, zt)]
    pipe(b, top, 0.008, C, 6, bend=0.05, seg=3, closed=True)
    bot = [(-wf, yf, 0.52), (wf, yf, 0.52), (wb, yb, 0.45), (-wb, yb, 0.45)]
    pipe(b, bot, 0.005, C, 5, bend=0.04, seg=2, closed=True)
    for zk in (0.33, 0.66):
        pipe(b, [(-wf, yf, 0.52 + (zt - 0.52) * zk), (wf, yf, 0.52 + (zt - 0.52) * zk), (wb, yb, 0.45 + (zt - 0.45) * zk), (-wb, yb, 0.45 + (zt - 0.45) * zk)], 0.003, C, 4, bend=0.04, seg=2, closed=True)
    # the wires: up the sides, front and back, and across the floor
    n = 12
    for k in range(1, n):
        t = k / n
        w, zf = side(t)
        y = yf + (yb - yf) * t
        for sg in (-1, 1):
            pipe(b, [(sg * w, y, zf), (sg * w, y, zt)], 0.0025, C, 3, caps=False)
        if k % 2 == 0:
            pipe(b, [(-w, y, zf), (w, y, zf)], 0.0025, C, 3, caps=False)
    for k in range(1, 7):
        x = -wf + 2 * wf * k / 7
        pipe(b, [(x, yf, 0.52), (x, yf, zt)], 0.0025, C, 3, caps=False)
        x2 = -wb + 2 * wb * k / 7
        pipe(b, [(x2, yb, 0.45), (x2, yb, zt)], 0.0025, C, 3, caps=False)
        pipe(b, [(x, yf, 0.52), (x2, yb, 0.45)], 0.0025, C, 3, caps=False)
    # the child seat: a flap of wire and a red plastic rest
    panel(b, (0, yb - 0.11, 0.8), (2 * wb - 0.06, 0.012, 0.2), WK.LABEL_R(), 0.004, tilt=(-0.35, 0), seg=1)
    # the chassis: each side one tube, from the handle down the back, along the floor, up to the nose
    for sg in (-1, 1):
        pipe(b, [(sg * wb, yb + 0.15, 1.05), (sg * wb, yb + 0.02, zt - 0.02), (sg * (wb - 0.01), yb + 0.09, 0.14), (sg * 0.2, -0.36, 0.14), (sg * 0.2, yf + 0.02, 0.5)], 0.0125, C, 8, bend=0.07, seg=4)
        for (y, yaw) in ((-0.34, rng.uniform(0, 3)), (0.48, rng.uniform(0, 3))):
            wheel(b, (sg * (0.21 if y < 0 else wb - 0.02), y, 0), 0.05, WK.RUBBER(), WK.STEEL(), yaw=yaw, w=0.024, stem=0.03)
    pipe(b, [(-0.2, -0.36, 0.14), (0.2, -0.36, 0.14)], 0.01, C, 6, caps=False)
    pipe(b, [(-(wb - 0.01), yb + 0.09, 0.14), (wb - 0.01, yb + 0.09, 0.14)], 0.01, C, 6, caps=False)
    # the handle: a plastic grip with the coin lock at one end
    turned(b, (-wb, yb + 0.15, 1.05), [(0, 0.012), (0.02, 0.017), (2 * wb - 0.02, 0.017), (2 * wb, 0.012)], WK.LABEL_R(), 10, axis=(1, 0, 0))
    panel(b, (wb - 0.07, yb + 0.15, 1.085), (0.08, 0.045, 0.05), WK.LABEL_R(), 0.008, seg=2)
    if rng.random() < 0.45:
        for k in range(rng.randint(1, 4)):
            w = rng.uniform(0.1, 0.2)
            WK.obox(b, (rng.uniform(-0.1, 0.1), rng.uniform(-0.3, 0.3), 0.52 + w * 0.4 + k * 0.05), (w, w * 1.3, w * 0.8), rng.uniform(0, 3), rng.choice(WK.LABELS)())
    if rng.random() < 0.3:
        # over on its side
        R = Matrix.Translation((0, 0, 0.3)) @ Matrix.Rotation(math.pi / 2 * rng.choice((-1, 1)), 4, 'Y') @ Matrix.Translation((0, 0, -0.5))
        b.bm.verts.ensure_lookup_table()
        for v in list(b.bm.verts)[v0:]:
            v.co = R @ v.co


def rack(b, rng):
    """a bay of pallet racking, 2.8 wide and 4.6 high: slotted uprights on bolted feet with their bracing, stepped orange
    beams on hook plates at three levels, yellow guards at the foot; pallets on some, shrink-wrapped, torn open, or gone"""
    W, D, H = 2.8, 1.1, 4.6
    Bl, Or = WK.BLUES(), WK.ORANGE()
    cs = [(-0.045, -0.035), (0.045, -0.035), (0.045, -0.015), (0.036, -0.015), (0.036, -0.027), (-0.036, -0.027), (-0.036, 0.027), (0.036, 0.027), (0.036, 0.015), (0.045, 0.015), (0.045, 0.035), (-0.045, 0.035)]
    for sx in (-W / 2, W / 2):
        for sy in (-D / 2 + 0.04, D / 2 - 0.04):
            # an upright: a channel, its open side to the middle of the frame
            plate(b, [(p[0] if sy < 0 else -p[0], p[1]) for p in cs] if False else cs, H, Bl, origin=(sx, sy, H / 2), x=(0, 1 if sy < 0 else -1, 0), y=(1 if sy < 0 else -1, 0, 0))
            panel(b, (sx, sy, 0.004), (0.14, 0.11, 0.008), Bl, 0.002, seg=1)
            for (dx, dy) in ((-0.05, -0.035), (0.05, 0.035)):
                turned(b, (sx + dx, sy + dy, 0.008), [(0, 0.009), (0.008, 0.009)], WK.STEEL(), 6)
            # the slots, as a dark strip down the face
            panel(b, (sx, sy + (-0.0355 if sy < 0 else 0.0355), H / 2), (0.012, 0.002, H - 0.2), WK.SOOT(), 0.0, seg=1)
        for k in range(6):
            z0, z1 = 0.3 + k * 0.7, 0.3 + (k + 1) * 0.7
            pipe(b, [(sx, -D / 2 + 0.06, z0 if k % 2 else z1), (sx, D / 2 - 0.06, z1 if k % 2 else z0)], 0.011, Bl, 4, caps=False)
            pipe(b, [(sx, -D / 2 + 0.06, z0), (sx, D / 2 - 0.06, z0)], 0.011, Bl, 4, caps=False)
        # a guard round the foot of the aisle-side upright
        gx = sx + (0.0 if abs(sx) < 0.1 else 0)
        pipe(b, [(gx - 0.1, -D / 2 - 0.02, 0.0), (gx - 0.1, -D / 2 - 0.1, 0.36), (gx + 0.1, -D / 2 - 0.1, 0.36), (gx + 0.1, -D / 2 - 0.02, 0.0)], 0.022, WK.YELLOW(), 8, bend=0.07, seg=3)
    for z in (0.0, 1.55, 3.1):
        if z > 0:
            for sy in (-D / 2 + 0.04, D / 2 - 0.04):
                sg = -1 if sy < 0 else 1
                # a stepped box beam, and the hook plate at each end
                panel(b, (0, sy + sg * 0.012, z), (W - 0.1, 0.05, 0.12), Or, 0.005, seg=1)
                panel(b, (0, sy - sg * 0.02, z + 0.035), (W - 0.1, 0.022, 0.05), Or, 0.004, seg=1)
                for sx in (-1, 1):
                    panel(b, (sx * (W / 2 - 0.05), sy + sg * 0.042, z), (0.006, 0.07, 0.2), Or, 0.002, seg=1)
            # bars across for the pallets to sit on
            for x in (-1.0, -0.36, 0.32, 1.0):
                panel(b, (x, 0, z + 0.052), (0.04, D - 0.1, 0.03), WK.STEEL(), 0.003, seg=1)
        for k in range(2):
            x = -0.68 + k * 1.36
            r = rng.random()
            if r < 0.3: continue
            zz = z + (0.068 if z > 0 else 0.0)
            _pallet(b, rng, (x, 0, zz), yaw=math.pi / 2 + rng.uniform(-0.03, 0.03), m=WK.BOARD())
            if r < 0.45: continue
            hh = rng.uniform(0.5, 1.25)
            if r < 0.75:
                # a wrapped load: the boxes showing through as ribs in the film, the top drawn in
                soft(b, (x, 0, zz + 0.145 + hh / 2), (1.06, 0.92, hh), WK.WRAP(), r=0.045, res=0.16, yaw=rng.uniform(-0.04, 0.04), lumps=0.012, seed=rng.random() * 9, crown=0.02,
                     shape=lambda q: Vector((q.x + 0.008 * math.sin(q.z * 21), q.y + 0.008 * math.sin(q.z * 21 + 1), q.z)))
                panel(b, (x, -0.47, zz + 0.145 + hh * 0.6), (0.3, 0.004, 0.2), WK.LABEL_W(), 0.0, seg=1)
            else:
                for j in range(rng.randint(3, 8)):
                    w = rng.uniform(0.3, 0.5)
                    WK.cbox(b, rng, (x + rng.uniform(-0.3, 0.3), rng.uniform(-0.25, 0.25), zz + 0.145 + w * 0.35 + (j // 3) * 0.3), (w, w * 1.2, w * 0.7), rng.uniform(-0.4, 0.4))
    # the load notice
    panel(b, (-W / 2 + 0.3, -D / 2 - 0.004, 1.9), (0.3, 0.003, 0.4), WK.LABEL_W(), 0.0, seg=1)


KINDS.update(pallet=pallet, checkout=checkout, trussbay=trussbay, duct=duct, cart=cart, rack=rack)
FINISH.update(pallet=0.0, checkout=0.0, trussbay=0.0, duct=0.0, cart=0.0, rack=0.0)
# the old pieces with a lot in them are only smoothed: a bevel on every edge of a radiator is a hundred thousand triangles nobody sees
FINISH.update(radiator=0.0, sprinkler=0.0, blinds=0.0, freezer=0.0, coffin=0.0, strips=0.0, baskets=0.0, promo=0.0)
VARIANTS.update(trussbay=6, duct=6, pallet=4, rack=6, checkout=4)


def _shelf(b, x0, x1, yc, z, d, sgn, rail, posts, fallen=0):
    """a pressed steel shelf: the tray with its front edge turned down, the ticket rail leaning back on it, a gusset
    bracket hooked into each upright. fallen: -1/1 the end that has let go"""
    L = x1 - x0
    cx = (x0 + x1) / 2
    if fallen:
        panel(b, (cx, yc, z - 0.16), (L, d, 0.022), WK.SHELFM(), 0.004, seg=1, tilt=(0, fallen * 0.11))
        return
    panel(b, (cx, yc, z), (L, d, 0.022), WK.SHELFM(), 0.004, seg=1)
    yf = yc + sgn * (d / 2 + 0.005)
    panel(b, (cx, yf, z - 0.012), (L, 0.007, 0.042), rail, 0.0, seg=1, tilt=(-sgn * 0.22, 0))
    for xu in posts:
        plate(b, [(0.0, 0.0), (d * 0.92, 0.0), (d * 0.92, -0.02), (0.0, -0.12)], 0.004, WK.SHELFD(), origin=(xu, yc - sgn * d / 2, z - 0.011), x=(0, sgn, 0), y=(0, 0, 1))


def gondola(b, rng):
    """three metres of supermarket shelving, both sides: slotted uprights on base legs, back panels in two bays, a plinth
    with its kick strip, five shelves a side on gusset brackets with their ticket rails, what stock is left, a shelf or two
    let go at one end"""
    L, D, H = 3.0, 1.0, 1.95
    Lt, Dk = WK.SHELFM(), WK.SHELFD()
    posts = (-L / 2 + 0.02, 0.0, L / 2 - 0.02)
    panel(b, (0, 0, 0.085), (L - 0.02, D - 0.06, 0.15), Dk, 0.006, seg=1)
    for bay in (-0.745, 0.745):
        panel(b, (bay, 0, H / 2 + 0.1), (1.45, 0.02, H - 0.28), Lt, 0.003, seg=1)
    panel(b, (0, 0, H - 0.02), (L, 0.05, 0.04), Dk, 0.006, seg=1)
    for x in posts:
        panel(b, (x, 0, H / 2), (0.04, 0.085, H), Dk, 0.004, seg=1)
        for sgn in (-1, 1):
            panel(b, (x, sgn * 0.0435, H / 2 + 0.1), (0.012, 0.002, H - 0.3), WK.SOOT(), 0.0, seg=1)
            panel(b, (x, sgn * 0.27, 0.035), (0.04, 0.46, 0.06), Dk, 0.004, seg=1)
    for sgn in (-1, 1):
        # the base shelf's front, and the kick strip under it set back
        panel(b, (0, sgn * (D / 2 - 0.012), 0.15), (L - 0.02, 0.024, 0.045), Lt, 0.004, seg=1)
        panel(b, (0, sgn * (D / 2 - 0.05), 0.05), (L - 0.06, 0.012, 0.1), WK.SOOT(), 0.0, seg=1)
    fill = rng.uniform(0.6, 0.97) if rng.random() < 0.85 else rng.uniform(0.15, 0.4)
    # overstock left on the top, still in its cases
    x = -L / 2 + rng.uniform(0.1, 0.8)
    while x < L / 2 - 0.5:
        if rng.random() < 0.45:
            w, hh = rng.uniform(0.3, 0.5), rng.uniform(0.2, 0.34)
            WK.cbox(b, rng, (x + w / 2, rng.uniform(-0.1, 0.1), H + hh / 2), (w, rng.uniform(0.3, 0.42), hh), rng.uniform(-0.2, 0.2))
            x += w
        x += rng.uniform(0.1, 0.9)
    for sgn in (-1, 1):
        cat = rng.choice(WK.CAT_LIST)
        for k in range(5):
            z = 0.17 + k * 0.38
            d = 0.46 - k * 0.025
            yc = sgn * (0.015 + d / 2)
            sag = rng.random() < 0.07 and k > 0
            if sag:
                _shelf(b, -L / 2 + 0.03, L / 2 - 0.03, yc, z, d, sgn, None, (), fallen=rng.choice((-1, 1)))
                continue
            _shelf(b, -L / 2 + 0.03, L / 2 - 0.03, yc, z, d, sgn, WK.LABEL_W() if rng.random() < 0.8 else WK.LABEL_Y(), posts if k > 0 else ())
            WK._stock(b, rng, -L / 2 + 0.05, L / 2 - 0.05, yc, z + 0.011, d, 0.34, fill, sgn, cat if rng.random() < 0.8 else None)
    # what came off, on the floor against the kick board
    for k in range(rng.randint(0, 5)):
        sgn = rng.choice((-1, 1))
        if rng.random() < 0.5:
            r = rng.uniform(0.034, 0.05)
            a = rng.uniform(0, 3.1)
            x, y = rng.uniform(-1.3, 1.3), sgn * rng.uniform(0.6, 0.95)
            WK.lrod(b, (x, y, r), (x + math.cos(a) * 0.12, y + math.sin(a) * 0.12, r), r, WK.cellr(24 + rng.randrange(8)), 8, cap=WK.TIN())
        else:
            w = rng.uniform(0.1, 0.2)
            WK.pbox(b, (rng.uniform(-1.3, 1.3), sgn * rng.uniform(0.6, 0.95), w * 0.18), (w * 1.5, w * 0.36, w * 1.0), rng.uniform(0, 3), WK.cellr(rng.randrange(16)), tilt=(1.5708, 0))


def endcap(b, rng):
    """the display on the end of an aisle: a metre of shelving facing out between two posts, its plinth, a promotion's card
    in a frame on top"""
    W, H = 1.0, 1.7
    Lt, Dk = WK.SHELFM(), WK.SHELFD()
    posts = (-W / 2 + 0.02, W / 2 - 0.02)
    panel(b, (0, 0.02, H / 2 + 0.06), (W - 0.06, 0.02, H - 0.14), Lt, 0.003, seg=1)
    panel(b, (0, -0.2, 0.08), (W - 0.02, 0.44, 0.15), Dk, 0.006, seg=1)
    panel(b, (0, -0.425, 0.15), (W - 0.02, 0.024, 0.045), Lt, 0.004, seg=1)
    for x in posts:
        panel(b, (x, 0.02, H / 2), (0.04, 0.07, H), Dk, 0.004, seg=1)
        panel(b, (x, -0.0165, H / 2 + 0.1), (0.012, 0.002, H - 0.3), WK.SOOT(), 0.0, seg=1)
    for k in range(4):
        z = 0.17 + k * 0.4
        _shelf(b, -W / 2 + 0.02, W / 2 - 0.02, -0.2, z, 0.42, -1, WK.LABEL_W(), posts if k > 0 else ())
        WK._stock(b, rng, -W / 2 + 0.04, W / 2 - 0.04, -0.2, z + 0.011, 0.42, 0.36, rng.uniform(0.6, 0.98))
    # the card: in a wire frame on two stalks
    for x in (-0.3, 0.3):
        pipe(b, [(x, 0.0, H), (x, 0.0, H + 0.02)], 0.005, WK.CHROME(), 5)
    WK.pbox(b, (0, -0.01, H + 0.22), (W * 0.8, 0.012, 0.44), 0, rng.choice((WK.OFFER_R, WK.OFFER_Y)), tilt=(rng.uniform(-0.1, 0.1), rng.uniform(-0.12, 0.12)))


def freezer(b, rng):
    """a bank of upright freezers, three metres, four glass doors in their frames with gaskets and bar handles: one standing
    open, one with its glass gone; wire shelves inside, a slotted grille along the foot, the lit canopy over the top, and
    what ran out under the doors dried on the floor. Faces -y. Its light is a box in the layout"""
    L, D, H = 3.0, 0.8, 2.05
    W = WK.WHITEP()
    panel(b, (0, D / 2 - 0.02, H / 2), (L, 0.04, H), W, 0.006, seg=1)
    panel(b, (0, 0, 0.09), (L, D, 0.18), WK.SHELFD(), 0.008, seg=1)
    panel(b, (0, 0, H - 0.09), (L, D, 0.18), W, 0.012, seg=2)
    for x in (-L / 2 + 0.02, L / 2 - 0.02):
        panel(b, (x, 0, H / 2), (0.04, D, H), W, 0.008, seg=1)
    # the grille along the foot: slots
    for k in range(22):
        panel(b, (-L / 2 + 0.12 + k * (L - 0.24) / 21, -D / 2 - 0.003, 0.09), (0.09, 0.006, 0.014), WK.RUBBER(), 0.0, seg=1)
        panel(b, (-L / 2 + 0.12 + k * (L - 0.24) / 21, -D / 2 - 0.003, 0.06), (0.09, 0.006, 0.014), WK.RUBBER(), 0.0, seg=1)
    panel(b, (0, -D / 2 - 0.004, H - 0.09), (L - 0.06, 0.008, 0.13), WK.LABEL_B(), 0.0, seg=1)
    dw = (L - 0.08) / 4
    for k in range(4):
        x = -L / 2 + 0.04 + dw * (k + 0.5)
        panel(b, (x - dw / 2, -0.02, H / 2), (0.03, D - 0.1, H - 0.36), W, 0.004, seg=1)
        for z in (0.5, 0.86, 1.22, 1.58):
            # a wire shelf: a frame and its rods
            pipe(b, [(x - dw / 2 + 0.03, -0.3, z), (x + dw / 2 - 0.03, -0.3, z), (x + dw / 2 - 0.03, 0.34, z), (x - dw / 2 + 0.03, 0.34, z)], 0.005, WK.STEEL(), 4, bend=0.02, seg=1, closed=True)
            for j in range(1, 6):
                yy = -0.3 + j * 0.64 / 6
                pipe(b, [(x - dw / 2 + 0.03, yy, z), (x + dw / 2 - 0.03, yy, z)], 0.003, WK.STEEL(), 3, caps=False)
            if rng.random() < 0.9:
                WK._stock(b, rng, x - dw / 2 + 0.04, x + dw / 2 - 0.04, 0.05, z + 0.008, 0.5, 0.3, 0.85, -1, 'frozen')
        state = rng.random()
        ang = rng.uniform(0.7, 1.7) if state < 0.22 else 0.0
        hx = x - dw / 2 + 0.02
        c, sn = math.cos(ang), math.sin(ang)
        cx, cy = hx + c * (dw / 2 - 0.02), -D / 2 + 0.02 - sn * (dw / 2 - 0.02)
        for oz in (0.2, H - 0.2):
            panel(b, (cx, cy, oz), (dw - 0.03, 0.035, 0.055), WK.SHELFD(), 0.006, yaw=-ang, seg=1)
        for e in (-1, 1):
            panel(b, (cx + e * c * (dw / 2 - 0.035), cy - e * sn * (dw / 2 - 0.035), H / 2), (0.045, 0.035, H - 0.4), WK.SHELFD(), 0.006, yaw=-ang, seg=1)
        if state > 0.36 or state < 0.22:
            panel(b, (cx, cy, H / 2), (dw - 0.1, 0.008, H - 0.44), WK.GLASSD(), 0.0, yaw=-ang, seg=1)
        # a bar handle on two stand-offs
        hxx, hyy = cx + c * (dw / 2 - 0.09) - sn * 0.0, cy - sn * (dw / 2 - 0.09)
        ox, oy = -sn * 0.045, -c * 0.045
        pipe(b, [(hxx, hyy, 0.9), (hxx + ox, hyy + oy, 0.9), (hxx + ox, hyy + oy, 1.32), (hxx, hyy, 1.32)], 0.008, WK.CHROME(), 6, bend=0.02, seg=2)
    # the puddle it left, dried black at the edge
    n = 12
    i = b.idx(WK.ROT())
    cv = b.bm.verts.new((rng.uniform(-0.8, 0.8), -0.7, 0.004))
    ring = [b.bm.verts.new((cv.co.x + math.cos(k * 6.283 / n) * rng.uniform(0.5, 1.2), -0.75 + math.sin(k * 6.283 / n) * rng.uniform(0.25, 0.5), 0.003)) for k in range(n)]
    for k in range(n):
        b.bm.faces.new((cv, ring[k], ring[(k + 1) % n])).material_index = i


KINDS.update(gondola=gondola, endcap=endcap, freezer=freezer)
FINISH.update(freezer=0.0)


def radiator(b, rng):
    """a cast-iron column radiator: each section a waisted column with rounded ends, joined by the nipples top and bottom,
    on two cast feet, the wheel valve and its pipe into the floor; front looks along -y"""
    n = rng.randint(8, 14)
    W = n * 0.06
    P = WK.PAINTR()
    for k in range(n):
        x = -W / 2 + 0.03 + k * 0.06
        c = (x, 0.1)
        rings = [oval(c, 0.012, 0.03, 0.115, 6, 2.6), oval(c, 0.024, 0.05, 0.15, 6, 3.0), oval(c, 0.024, 0.05, 0.69, 6, 3.0), oval(c, 0.012, 0.03, 0.728, 6, 2.6)]
        loft(b, rings, P, cap0=True, cap1=True)
    for z in (0.17, 0.67):
        pipe(b, [(-W / 2 + 0.02, 0.1, z), (W / 2 - 0.02, 0.1, z)], 0.016, P, 6, caps=False)
    for x in (-W / 2 + 0.03, W / 2 - 0.03):
        turned(b, (x, 0.1, 0.0), [(0, 0.03), (0.012, 0.024), (0.06, 0.016), (0.12, 0.02)], P, 6)
    # the valve at one end, its wheel, the pipe down
    vx = W / 2 + 0.05
    pipe(b, [(W / 2 - 0.02, 0.1, 0.17), (vx, 0.1, 0.17), (vx, 0.1, 0.0)], 0.011, WK.RUST(), 6, bend=0.025, seg=2)
    turned(b, (vx, 0.1, 0.19), [(0, 0.012), (0.02, 0.012), (0.024, 0.026), (0.036, 0.026), (0.04, 0.01)], WK.RUST(), 8)


KINDS.update(radiator=radiator)
FINISH.update(radiator=0.0)


def coffin(b, rng):
    """a chest freezer island, 2.4 x 1: a moulded tub with rounded corners, its liner, a bumper round the foot, a rail round
    the rim, glass lids sliding on it (one off and on the floor), a black soup in the bottom and what was in it"""
    L, D, H = 2.4, 1.0, 0.88
    W = WK.WHITEP()
    c = (0, 0)
    a, e = L / 2, D / 2
    rings = [oval(c, a - 0.03, e - 0.03, 0.12, 28, 9), oval(c, a, e, 0.16, 28, 9), oval(c, a, e, H - 0.03, 28, 9), oval(c, a - 0.008, e - 0.008, H, 28, 9),
             oval(c, a - 0.06, e - 0.06, H, 28, 9), oval(c, a - 0.07, e - 0.07, H - 0.02, 28, 9), oval(c, a - 0.09, e - 0.09, 0.31, 28, 9)]
    loft(b, rings, W)
    loft(b, [oval(c, a - 0.09, e - 0.09, 0.31, 28, 9)], WK.ROT(), cap1=True)
    panel(b, (0, 0, 0.065), (L - 0.08, D - 0.08, 0.13), WK.SHELFD(), 0.01, seg=1)
    # the bumper and the rim rail
    loft(b, [oval(c, a + 0.012, e + 0.012, z, 28, 9) for z in (0.2, 0.215, 0.255, 0.27)][::1], WK.RUBBER())
    pipe(b, [(p[0], p[1], H + 0.012) for p in oval(c, a - 0.03, e - 0.03, 0, 12, 9)], 0.009, WK.CHROME(), 5, bend=0, closed=True)
    pipe(b, [(-L / 2 + 0.04, 0, H + 0.012), (L / 2 - 0.04, 0, H + 0.012)], 0.008, WK.CHROME(), 5, caps=False)
    for k in range(rng.randint(3, 9)):
        w = rng.uniform(0.12, 0.26)
        WK.obox(b, (rng.uniform(-1.0, 1.0), rng.uniform(-0.35, 0.35), 0.31 + w * 0.2), (w, w * 1.4, w * 0.4), rng.uniform(0, 3), rng.choice((WK.ROT2, WK.MOULD, WK.CARDB, WK.LABEL_W))(), tilt=(rng.uniform(-0.2, 0.2), 0))
    for k in range(3):
        x = -L / 2 + 0.42 + k * 0.78
        if rng.random() < 0.3:
            panel(b, (x + rng.uniform(-0.3, 0.3), -D / 2 - 0.35, 0.02), (0.76, 0.5, 0.012), WK.GLASSD(), 0.004, yaw=rng.uniform(-0.6, 0.6), seg=1)
            continue
        xx = x + rng.uniform(-0.2, 0.2)
        panel(b, (xx, 0, H + 0.022), (0.76, D - 0.09, 0.008), WK.GLASSD(), 0.003, seg=1)
        for sy in (-1, 1):
            panel(b, (xx, sy * (D / 2 - 0.05), H + 0.024), (0.76, 0.02, 0.014), WK.CHROME(), 0.003, seg=1)
        panel(b, (xx + 0.3, 0, H + 0.03), (0.03, 0.2, 0.012), WK.SHELFD(), 0.004, seg=1)
    panel(b, (0, -D / 2 - 0.004, H - 0.12), (L - 0.3, 0.006, 0.09), WK.LABEL_B(), 0.0, seg=1)
    # the grille at one end where the works are
    for k in range(6):
        panel(b, (L / 2 + 0.002, 0, 0.3 + k * 0.035), (0.006, D * 0.5, 0.014), WK.RUBBER(), 0.0, seg=1)


def taggate(b, rng):
    """a security pedestal at the shop door: a loop of tube inside a loop of tube on a plastic foot, the alarm box at the top.
    It stands across x (thin), half a metre along y"""
    G = WK.GREYP()
    panel(b, (0, 0, 0.03), (0.1, 0.56, 0.06), WK.BLACKM(), 0.012, seg=2)
    pipe(b, [(0, -0.23, 0.05), (0, -0.23, 1.5), (0, 0.23, 1.5), (0, 0.23, 0.05)], 0.02, G, 8, bend=0.12, seg=5)
    pipe(b, [(0, -0.13, 0.05), (0, -0.13, 1.3), (0, 0.13, 1.3), (0, 0.13, 0.05)], 0.011, G, 6, bend=0.08, seg=4)
    panel(b, (0, 0, 1.42), (0.05, 0.2, 0.07), G, 0.012, seg=2)
    turned(b, (0.026, 0, 1.42), [(0, 0.01), (0.004, 0.008)], WK.REDP(), 8, axis=(1, 0, 0))


KINDS.update(coffin=coffin, taggate=taggate)
FINISH.update(coffin=0.0, taggate=0.0)
VARIANTS.update(coffin=4, freezer=6, endcap=12)
