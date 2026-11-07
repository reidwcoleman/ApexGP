"""Cottages, built as walls with real openings. A wall is split round its windows and each opening gets its reveal, so the
sun puts a shadow in it. Everything is quads for the bake; the joinery comes from cove_kit as instanced modules."""
import math
import numpy as np

FLOOR = 2.46
NRM = {'-x': (-1, 0, 0), '+x': (1, 0, 0), '-y': (0, -1, 0), '+y': (0, 1, 0)}
ROT = {'-y': 0.0, '+y': math.pi, '+x': math.pi / 2, '-x': -math.pi / 2}
SIZES = {'sash': (0.92, 1.3), 'sash_s': (0.8, 1.02), 'case': (0.74, 0.86), 'wide': (1.34, 1.3), 'door': (0.9, 2.02)}


def qn(m, mat, p, n, dens=0.3):
    """a quad that faces along n, whichever way round it was given"""
    a, b, c, d = [np.array(q, float) for q in p]
    if np.dot(np.cross(b - a, d - a), np.array(n, float)) < 0:
        p = (p[0], p[3], p[2], p[1])
    m.quad(mat, *p, dens=dens)


def P(face, c, s, z):
    return (c, s, z) if face[1] == 'x' else (s, c, z)


def rect(m, mat, face, c, s0, s1, z0, z1, dens=0.3):
    if s1 - s0 < 1e-3 or z1 - z0 < 1e-3:
        return
    qn(m, mat, (P(face, c, s0, z0), P(face, c, s1, z0), P(face, c, s1, z1), P(face, c, s0, z1)), NRM[face], dens)


def wall(m, mat, face, c, s0, s1, z0, z1, ops=(), depth=0.2, dens=0.3):
    """ops: (s0, s1, zb, zt). Bands between the openings' heads and sills, each cut round what passes through it"""
    zs = sorted({z0, z1} | {o[2] for o in ops} | {o[3] for o in ops})
    sg = 1 if face[0] == '+' else -1
    for za, zb in zip(zs, zs[1:]):
        hs = sorted(o for o in ops if o[2] <= za + 1e-4 and o[3] >= zb - 1e-4)
        cur = s0
        for o in hs:
            rect(m, mat, face, c, cur, o[0], za, zb, dens)
            cur = o[1]
        rect(m, mat, face, c, cur, s1, za, zb, dens)
    ci = c - sg * depth
    ax = 0 if face[1] == 'y' else 1
    for a, b, zb, zt in ops:
        # jambs, head and sill of the reveal
        n0 = [0, 0, 0]; n0[ax] = 1
        n1 = [0, 0, 0]; n1[ax] = -1
        qn(m, mat, (P(face, c, a, zb), P(face, ci, a, zb), P(face, ci, a, zt), P(face, c, a, zt)), n0, 0.12)
        qn(m, mat, (P(face, c, b, zb), P(face, ci, b, zb), P(face, ci, b, zt), P(face, c, b, zt)), n1, 0.12)
        qn(m, mat, (P(face, c, a, zt), P(face, c, b, zt), P(face, ci, b, zt), P(face, ci, a, zt)), (0, 0, -1), 0.12)
        qn(m, mat, (P(face, c, a, zb), P(face, c, b, zb), P(face, ci, b, zb), P(face, ci, a, zb)), (0, 0, 1), 0.12)


def piece(m, name, face, c, s, z, tint=(1, 1, 1)):
    x, y = (c, s) if face[1] == 'x' else (s, c)
    m.unit('cove', [name], x, y, z, rot=ROT[face], tint=tint, far=True)


def opening(m, ops, name, face, c, s, z, tint=(1, 1, 1)):
    w, h = SIZES[name]
    ops.append((s - w / 2, s + w / 2, z, z + h))
    piece(m, name, face, c, s, z, tint)


def spread(a, b, n):
    return [a + (b - a) * (i + 0.5) / n for i in range(n)]


DOORS = [(0.1, 0.17, 0.3), (0.42, 0.09, 0.08), (0.08, 0.26, 0.24), (0.86, 0.84, 0.8), (0.1, 0.1, 0.12), (0.16, 0.34, 0.46), (0.5, 0.42, 0.16)]


def tn(m, mat, a, b, c, n, dens=0.1):
    """a triangle that faces along n"""
    A, B, C = np.array(a, float), np.array(b, float), np.array(c, float)
    if np.dot(np.cross(B - A, C - A), np.array(n, float)) < 0:
        a, b = b, a
    m.tri(mat, a, b, c, dens=dens)


def roof(m, h, zt, ridge, slate, wmat, R, dormers=0):
    """slates, fascia, soffit, barge boards, ridge tiles and the gable walls, in (u across, v along) so one body serves both ways round"""
    x0, y0, x1, y1 = h['r']
    pitch = h.get('pitch', 0.86)
    over, verge = 0.26, 0.14
    if ridge == 'y':
        u0, u1, v0, v1 = x0, x1, y0, y1
        M = lambda u, v, z: (u, v, z)
        N = lambda a, b, c: (a, b, c)
    else:
        u0, u1, v0, v1 = y0, y1, x0, x1
        M = lambda u, v, z: (v, u, z)
        N = lambda a, b, c: (b, a, c)
    um = (u0 + u1) / 2
    zr = zt + (u1 - u0) / 2 * pitch
    e = zt - over * pitch
    va, vb = v0 - verge, v1 + verge
    for sg, ue in ((1, u1 + over), (-1, u0 - over)):
        qn(m, slate, (M(ue, va, e), M(ue, vb, e), M(um, vb, zr), M(um, va, zr)), N(sg * pitch, 0, 1), 0.3)
        wall_u = u1 if sg > 0 else u0
        # fascia and soffit
        qn(m, 'paint_w', (M(ue, va, e - 0.17), M(ue, vb, e - 0.17), M(ue, vb, e), M(ue, va, e)), N(sg, 0, 0), 0.08)
        qn(m, 'paint_w', (M(wall_u, va, e - 0.17), M(wall_u, vb, e - 0.17), M(ue, vb, e - 0.17), M(ue, va, e - 0.17)), (0, 0, -1), 0.08)
        for vv, nn in ((va, -1), (vb, 1)):
            qn(m, 'paint_w', (M(ue, vv, e - 0.17), M(um, vv, zr - 0.17), M(um, vv, zr), M(ue, vv, e)), N(0, nn, 0), 0.08)
        # the gutter: one metre long module, stretched
        if ridge == 'y':
            rot, st = (math.pi / 2, va) if sg > 0 else (-math.pi / 2, vb)
        else:
            rot, st = (math.pi, vb) if sg > 0 else (0.0, va)
        px, py = M(ue, st, 0)[:2]
        m.unit('cove', ['gutter'], px, py, e - 0.1, rot=rot, sc=(vb - va, 1, 1), far=True)
    for sg in (1, -1):
        qn(m, 'ridge', (M(um + sg * 0.15, va, zr - 0.09), M(um + sg * 0.15, vb, zr - 0.09), M(um, vb, zr + 0.07), M(um, va, zr + 0.07)), N(sg * 0.5, 0, 1), 0.08)
    for vv, nn in ((v0, -1), (v1, 1)):
        tn(m, wmat, M(u0, vv, zt), M(u1, vv, zt), M(um, vv, zr), N(0, nn, 0), 0.3)
    # dormers on the lane side
    fs = h.get('front', '-x')
    if dormers and ridge == ('y' if fs[1] == 'x' else 'x'):
        sg = 1 if fs[0] == '+' else -1
        wall_u = u1 if sg > 0 else u0
        uf = wall_u - sg * 0.3
        zb = zt + 0.3 * pitch
        ht, w = 1.14, 0.62
        ut = uf - sg * ht / pitch
        zp = zb + ht + w * 0.72
        up = uf - sg * (ht + w * 0.72) / pitch
        if abs(up - um) < 0.2 or (up - um) * sg < 0:
            return zr
        for vc in spread(v0 + 0.8, v1 - 0.8, dormers):
            wall(m, 'paint_w', fs, uf, vc - w, vc + w, zb, zb + ht, [(vc - 0.37, vc + 0.37, zb + 0.14, zb + 1.0)], depth=0.2, dens=0.1)
            piece(m, 'case', fs, uf, vc, zb + 0.14)
            for s2 in (-1, 1):
                vv = vc + s2 * w
                tn(m, 'paint_w', M(uf, vv, zb), M(uf, vv, zb + ht), M(ut, vv, zb + ht), N(0, s2, 0), 0.06)
                ve = vc + s2 * (w + 0.1)
                qn(m, slate, (M(uf + sg * 0.1, ve, zb + ht - 0.07), M(ut, ve, zb + ht - 0.07), M(up, vc, zp), M(uf + sg * 0.1, vc, zp)), N(0, s2 * 0.75, 1), 0.08)
            tn(m, 'paint_w', M(uf, vc - w, zb + ht), M(uf, vc + w, zb + ht), M(uf, vc, zp), N(sg, 0, 0), 0.06)
    return zr


def chimney(m, h, zt, zr, ridge, wmat, end, R):
    x0, y0, x1, y1 = h['r']
    w, d = 1.0, 0.56
    hi = zr + 0.75
    lo = zt
    if ridge == 'y':
        cx, cy = (x0 + x1) / 2, (y0 + 0.3 if end < 0 else y1 - 0.3)
        a, b = (cx - w / 2, cy - d / 2), (cx + w / 2, cy + d / 2)
    else:
        cx, cy = (x0 + 0.3 if end < 0 else x1 - 0.3), (y0 + y1) / 2
        a, b = (cx - d / 2, cy - w / 2), (cx + d / 2, cy + w / 2)
    m.box((a[0], a[1], lo), (b[0], b[1], hi), wmat, collide=False, density=0.1)
    m.box((a[0] - 0.05, a[1] - 0.05, hi - 0.16), (b[0] + 0.05, b[1] + 0.05, hi), 'stonewall', collide=False, density=0.08)
    for k in ((-0.24, 0.24) if R.random() < 0.6 else (0.0,)):
        ox, oy = (k, 0) if ridge == 'y' else (0, k)
        m.unit('cove', ['pot'], cx + ox, cy + oy, hi, rot=R.random() * 3, far=True)


def facade(m, h, face, c, s0, s1, z, zt, R, front):
    """the openings of one long wall, floor by floor"""
    ops = []
    L = s1 - s0
    floors = h['floors']
    n = max(1, min(4, int((L + 0.4) / 2.2)))
    bays = spread(s0, s1, n)
    door_at = None
    if front:
        door_at = bays[n // 2] if n % 2 else bays[(n // 2) - (1 if R.random() < 0.5 else 0)]
    tint = DOORS[h['seed'] % len(DOORS)]
    for f in range(floors):
        zf = z + f * FLOOR
        for s in bays:
            if f == 0 and s == door_at:
                opening(m, ops, 'door', face, c, s, z + 0.02, tint)
                piece(m, 'step', face, c, s, z + 0.02)
                continue
            if f == 0:
                nm = 'wide' if (front and L > 6.2 and R.random() < 0.3) else 'sash'
                opening(m, ops, nm, face, c, s, zf + 0.82)
            else:
                top = zt - 0.3
                nm = 'sash_s'
                zw = min(zf + 0.72, top - SIZES[nm][1])
                opening(m, ops, nm, face, c, s, zw)
    return ops


def pipe(m, face, c, s, zb, zt):
    x, y = (c, s) if face[1] == 'x' else (s, c)
    m.unit('cove', ['pipe'], x, y, zb, rot=ROT[face], sc=(1, 1, zt - zb), far=True)


def shell(m, h, R):
    """a cottage nobody goes into: four walls with windows in them, one solid box to shoot at"""
    x0, y0, x1, y1 = h['r']
    z = h['z']
    zt = z + h['floors'] * FLOOR + 0.2
    wm = h['mat']
    base = z - 3.0
    front = h['front']
    # long walls carry the door when the lane runs along them
    faces = {'-x': (x0, y0, y1), '+x': (x1, y0, y1), '-y': (y0, x0, x1), '+y': (y1, x0, x1)}
    for f, (c, s0, s1) in faces.items():
        if h.get('shut', {}).get(f):
            ops = []
        elif f == front:
            ops = facade(m, h, f, c, s0 + 0.15, s1 - 0.15, z, zt, R, True)
        elif f == {'-x': '+x', '+x': '-x', '-y': '+y', '+y': '-y'}[front]:
            ops = facade(m, h, f, c, s0 + 0.5, s1 - 0.5, z, zt, R, False) if R.random() < 0.8 else []
        elif R.random() < 0.65 and h['floors'] >= 2:
            ops = []
            opening(m, ops, 'case', f, c, (s0 + s1) / 2 + R.uniform(-0.6, 0.6), z + FLOOR + 0.75)
            if R.random() < 0.6:
                opening(m, ops, 'case', f, c, (s0 + s1) / 2 + R.uniform(-0.8, 0.8), z + 1.0)
        else:
            ops = []
        wall(m, wm, f, c, s0, s1, base, zt, ops)
        # tar round the foot: every wall by the sea has it, to keep the salt damp out
        if wm != 'stonewall':
            sg = 1 if f[0] == '+' else -1
            bands = [(s0, s1)]
            for o in sorted(ops):
                if o[2] < z + 0.6:
                    bands = [q for b in bands for q in ((b[0], o[0]), (o[1], b[1]))]
            for a, b in bands:
                rect(m, 'tar', f, c + sg * 0.012, a, b, base, z + 0.42, 0.1)
    m.hard((x0, y0, z - 7), (x1, y1, zt), wm)


def dress(m, h, zt, ridge, wm, R):
    fr = h['front']
    x0, y0, x1, y1 = h['r']
    z = h['z']
    # a downpipe at the corner of the lane side
    c, s = {'-x': (x0, y0 + 0.14), '+x': (x1, y1 - 0.14), '-y': (y0, x1 - 0.14), '+y': (y1, x0 + 0.14)}[fr]
    pipe(m, fr, c, s, z, zt - 0.2)
