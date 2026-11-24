"""What the first-person sleeves and gloves are made of, as functions of where on the arm a point is. Pure numpy: used by
arms.py inside Blender (to move the mesh's own vertices and to fill the textures), and runnable by itself on the cached
bakes while a look is being worked out:
  python3 tools/lastframe/armtex.py assets-src/lf/arms            (reads bake.npz + body.json, writes arms_*.png)

Everything is worked out on the left arm; a point on the right is mirrored onto it first.
Units are metres. Heights are metres out from the surface.
"""
import json, os, sys
import numpy as np

F = np.float32


# ---------------------------------------------------------------------------------------------- noise
def _hash(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h &= 0xffffffff
    h ^= h >> 15
    h = (h * 0x2c1b3c6d) & 0xffffffff
    h ^= h >> 12
    h = (h * 0x297a2d39) & 0xffffffff
    h ^= h >> 15
    return (h & 0xffffff).astype(F) / F(0xffffff)


def vnoise(p, seed=0):
    """value noise, 0..1, one cell a unit"""
    i = np.floor(p).astype(np.int64)
    f = (p - i).astype(F)
    u = f * f * (3 - 2 * f)
    x, y, z = i[:, 0], i[:, 1], i[:, 2]
    out = np.zeros(len(p), F)
    for dx in (0, 1):
        wx = u[:, 0] if dx else 1 - u[:, 0]
        for dy in (0, 1):
            wy = u[:, 1] if dy else 1 - u[:, 1]
            for dz in (0, 1):
                wz = u[:, 2] if dz else 1 - u[:, 2]
                out += _hash(x + dx, y + dy, z + dz, seed) * wx * wy * wz
    return out


def fbm(p, octaves=3, seed=0, lac=2.07, gain=0.5):
    a, s, n, q = 1.0, 0.0, np.zeros(len(p), F), p.astype(F)
    for o in range(octaves):
        n += vnoise(q, seed + o * 17) * a
        s += a
        a *= gain
        q = q * lac + 11.3
    return n / s


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def bump(x, w):
    """1 at 0, 0 beyond w, smooth"""
    return 1 - sstep(0, w, np.abs(x))


# ---------------------------------------------------------------------------------------------- the arm
class Rig:
    def __init__(self, bones):
        B = {b['name']: np.array(b['m'], dtype=np.float64).reshape(4, 4).T for b in bones}
        pos = lambda n: B[n][:3, 3].copy()
        xax = lambda n: B[n][:3, 0] / np.linalg.norm(B[n][:3, 0])
        self.S, self.E, self.W = pos('Bip01_L_UpperArm'), pos('Bip01_L_Forearm'), pos('Bip01_L_Hand')
        self.d1 = (self.E - self.S) / np.linalg.norm(self.E - self.S)
        self.d2 = (self.W - self.E) / np.linalg.norm(self.W - self.E)
        self.L1, self.L2 = np.linalg.norm(self.E - self.S), np.linalg.norm(self.W - self.E)
        Z = np.array([0, 0, 1.0])
        self.e1a = Z - self.d1 * Z.dot(self.d1); self.e1a /= np.linalg.norm(self.e1a)
        self.e2a = np.cross(self.d1, self.e1a)
        self.e1b = Z - self.d2 * Z.dot(self.d2); self.e1b /= np.linalg.norm(self.e1b)
        self.e2b = np.cross(self.d2, self.e1b)
        # fingers: 0 thumb, 1 index .. 4 little; each a root, two joints and a tip
        self.fing = []
        for k in range(5):
            j0, j1, j2 = pos(f'Bip01_L_Finger{k}'), pos(f'Bip01_L_Finger{k}1'), pos(f'Bip01_L_Finger{k}2')
            tip = j2 + xax(f'Bip01_L_Finger{k}2') * (0.03 if k == 0 else 0.024 if k in (2, 3) else 0.021)
            self.fing.append(np.array([j0, j1, j2, tip]))
        roots = np.array([f[0] for f in self.fing[1:]])
        h = roots.mean(0) - self.W
        self.h = h / np.linalg.norm(h)
        r0 = self.fing[1][0] - self.fing[4][0]
        r0 -= self.h * r0.dot(self.h)
        self.r0 = r0 / np.linalg.norm(r0)
        self.D = np.cross(self.r0, self.h)          # the back of the hand faces this way
        self.D /= np.linalg.norm(self.D)
        # where the knuckles are, in the hand's own frame
        self.kn = [((f[0] - self.W).dot(self.h), (f[0] - self.W).dot(self.r0)) for f in self.fing[1:]]
        # the sleeve stops short of the wrist; the glove's cuff runs up under it
        self.sleeve_end = self.L1 + self.L2 - 0.03

    def arm(self, p):
        """a: metres down the arm from the shoulder; c1, c2: which way round it (a unit vector's two parts); rad: how far out"""
        t1 = (p - self.S) @ self.d1
        t2 = (p - self.E) @ self.d2
        fore = t2 > 0
        ax = np.where(fore[:, None], self.E + np.maximum(t2, 0)[:, None] * self.d2, self.S + t1[:, None] * self.d1)
        r = p - ax
        rad = np.linalg.norm(r, axis=1) + 1e-9
        rh = r / rad[:, None]
        c1 = np.where(fore, rh @ self.e1b, rh @ self.e1a)
        c2 = np.where(fore, rh @ self.e2b, rh @ self.e2a)
        a = np.where(fore, self.L1 + t2, t1)
        return a.astype(F), c1.astype(F), c2.astype(F), rad.astype(F)

    def hand(self, p):
        q = p - self.W
        return (q @ self.h).astype(F), (q @ self.r0).astype(F), (q @ self.D).astype(F)

    def fingers(self, p):
        """nearest finger: which, how far from its middle line, how far along it from the knuckle, how long it is"""
        best = np.full(len(p), 1e9, F)
        which = np.zeros(len(p), np.int8)
        along = np.zeros(len(p), F)
        total = np.zeros(len(p), F)
        for k, f in enumerate(self.fing):
            acc = 0.0
            L = sum(np.linalg.norm(f[i + 1] - f[i]) for i in range(3))
            for i in range(3):
                a, b = f[i], f[i + 1]
                d = b - a
                l = np.linalg.norm(d)
                d = d / l
                t = np.clip((p - a) @ d, 0 if i else -0.02, l if i < 2 else l + 0.01)
                dist = np.linalg.norm(p - (a + t[:, None] * d), axis=1).astype(F)
                m = dist < best
                best[m] = dist[m]
                which[m] = k
                along[m] = (acc + t[m]).astype(F)
                total[m] = L
                acc += l
        return which, best, along, total


def fields(R, P, N, glove, fine=True, hem=None):
    """For points P (left arm, metres) with unit normals N: the surface there.
    Returns a dict: hv (height the mesh's own vertices carry), ht (height only the texture carries), colour (n,3 linear),
    rough, tint (1: cloth dyed by the side's colour), cav (0 open .. 1 deep in a crease), glove (1 on the glove)"""
    n = len(P)
    P = P.astype(np.float64)
    a, c1, c2, rad = R.arm(P)
    u, v, w = R.hand(P)
    dors = (N @ R.D).astype(F)
    glove = np.asarray(glove, bool)
    hv = np.zeros(n, F)
    ht = np.zeros(n, F)
    cav = np.zeros(n, F)
    col = np.zeros((n, 3), F)
    rough = np.full(n, 0.8, F)
    tint = np.zeros(n, F)

    # ------------------------------------------------------------------ the sleeve
    s = ~glove
    if s.any():
        Ps = P[s]
        A, C1, C2 = a[s], c1[s], c2[s]
        end = R.sleeve_end
        # round the arm, as a point on a ring 9 cm across: the same place whichever way it is reached
        ring = np.stack([A, C1 * 0.045, C2 * 0.045], 1).astype(F)
        # how much the cloth has to give at each height: it rucks up inside the elbow, stacks above the cuff, hangs
        # easier on the upper arm
        inner = sstep(-0.2, 0.9, C1)                                  # the front of the arm, where the elbow closes
        el = np.exp(-((A - R.L1) / 0.075) ** 2)
        cuffz = np.exp(-((A - (end - 0.075)) / 0.05) ** 2)
        env = 0.4 + 0.75 * el * (0.55 + 0.45 * inner) + 0.55 * cuffz
        # folds run round the limb and wander: long round it, short along it, bent by a slower field
        wrp = fbm(ring * [5.0, 9.0, 9.0], 2, 3) - 0.5
        q = ring * [27.0, 8.0, 8.0]
        q[:, 0] += wrp * 2.6 + C2 * 1.3
        n1 = fbm(q, 2, 5)
        n2 = fbm(q * [1.9, 2.2, 2.2] + 5.1, 2, 9)
        # broad rounded ridges with tighter valleys between
        r1 = 1 - np.abs(2 * n1 - 1) ** 0.75
        r2 = 1 - np.abs(2 * n2 - 1) ** 0.8
        big = (r1 - 0.52) * 1.0 + (r2 - 0.5) * 0.42
        hv_s = 0.0045 + big * 0.0105 * env
        # the last of it before the cuff is gathered, and the cuff itself is a flat double band with a tab
        cuff = sstep(end - 0.046, end - 0.040, A)
        hv_s = hv_s * (1 - cuff) + cuff * 0.0028
        if hem is not None:
            # the turned-in edge sits inside the cloth it is the end of
            hv_s = np.where(hem[s], 0.0016, hv_s)
        hv[s] = hv_s
        valley = np.clip((0.5 - r1) * 1.9, 0, 1) * np.clip(env, 0, 1.2) * (1 - cuff)
        cav[s] = np.clip(valley * 0.9, 0, 1)
        hts = np.zeros(len(A), F)
        if fine:
            # the small creases cloth has everywhere, at the scale of a finger's width
            q3 = ring * [120.0, 34.0, 34.0]
            q3[:, 0] += wrp * 5
            n3 = fbm(q3, 2, 21)
            hts += (1 - np.abs(2 * n3 - 1) ** 0.8 - 0.5) * 0.0007 * (0.5 + env * 0.5) * (1 - cuff)
            # the seam down the back of the arm: two rows of stitching either side of a lapped edge
            sd = C1 + 0.86
            near = bump(sd, 0.08)
            lap = sstep(-0.012, 0.012, sd) * near
            hts += lap * 0.0005 - bump(sd, 0.006) * 0.00035
            st = (bump(sd - 0.045, 0.006) + bump(sd + 0.045, 0.006)) * (np.sin(A * 2 * np.pi / 0.0032) > 0.1)
            hts += st * 0.00016
            # the cuff: two rows of stitching round it, and the adjusting tab across the back of the wrist
            for at in (end - 0.037, end - 0.008):
                row = bump(A - at, 0.0011) * (np.sin(np.arctan2(C2, C1) * 62) > 0.0)
                hts += row * 0.00018
                cav[s] = np.maximum(cav[s], bump(A - at, 0.0016) * 0.35)
            tab = sstep(0.15, 0.25, C2) * (1 - sstep(0.93, 0.99, np.abs(C2) * (C1 > -0.4))) * bump(A - (end - 0.0225), 0.0105)
            tab_edge = np.clip(tab * 6, 0, 1)
            hts += tab_edge * 0.0011
            cav[s] = np.maximum(cav[s], (tab_edge > 0.02) * (tab_edge < 0.5) * 0.5)
            # an oval patch sewn over the elbow, on the outside of the arm
            ex, ey = (A - R.L1 - 0.01) / 0.075, (np.arctan2(C2, -C1)) / 1.0
            pd = np.sqrt(ex * ex + ey * ey)
            patch = 1 - sstep(0.94, 1.0, pd)
            hts += patch * 0.0006
            sew = bump(pd - 0.9, 0.035) * (np.sin(np.arctan2(ey, ex) * 46) > 0.0)
            hts += sew * 0.00016
            cav[s] = np.maximum(cav[s], bump(pd - 0.985, 0.03) * 0.4)
        else:
            tab_edge = patch = st = np.zeros(len(A), F)
            near = lap = np.zeros(len(A), F)
        ht[s] = hts
        # cloth: a mid grey for the side's dye to go over, a little uneven, darker where it has been handled
        tone = 0.5 + (fbm(Ps * 9.0, 3, 31) - 0.5) * 0.16 + (fbm(Ps * 61.0, 2, 33) - 0.5) * 0.07
        tone *= 1 - cuff * 0.06
        grime = sstep(0.55, 0.85, fbm(Ps * 6.0 + 3, 3, 41)) * 0.14 + sstep(end - 0.14, end, A) * 0.08
        tone *= 1 - grime
        if fine:
            tone *= 1 - patch * 0.12
            tone = tone * (1 - tab_edge * 0.25)
        cs = np.stack([tone, tone, tone], 1)
        if fine:
            thread = np.clip(st + sew, 0, 1) * 0.5
            cs = cs * (1 - thread[:, None]) + thread[:, None] * np.array([0.62, 0.6, 0.55], F)
        col[s] = cs
        rs = 0.86 + (fbm(Ps * 40.0, 2, 51) - 0.5) * 0.1
        if fine:
            rs = rs * (1 - tab_edge) + tab_edge * 0.93
        rough[s] = rs
        tint[s] = 1.0

    # ------------------------------------------------------------------ the glove
    g = glove
    if g.any():
        Pg = P[g]
        U, V, Wd, Dn = u[g], v[g], w[g], dors[g]
        A = a[g]
        which, fd, fs, fl = R.fingers(Pg)
        back = sstep(0.05, 0.4, Dn)
        palm = sstep(0.05, 0.4, -Dn)
        side = 1 - back - palm
        kn_u = float(np.mean([k[0] for k in R.kn]))
        onf = (U > kn_u + 0.006) | ((which == 0) & (fs > 0.004) & (fd < 0.016))      # on a finger, past the knuckle
        thumb = (which == 0) & onf
        hv_g = np.full(len(U), 0.0013, F)
        htg = np.zeros(len(U), F)
        cg = np.zeros(len(U), F)
        # materials: 0 stretch cloth (back of the hand), 1 suede (palm, fingers), 2 moulded rubber, 3 strap, 4 cuff
        # (dark things are darker than they look: black cloth gives back two parts in a hundred of the light on it)
        C_CLOTH = np.array([0.020, 0.021, 0.021], F)
        C_SUEDE = np.array([0.050, 0.044, 0.036], F)
        C_RUBBER = np.array([0.010, 0.010, 0.011], F)
        C_STRAP = np.array([0.013, 0.013, 0.014], F)
        C_CUFF = np.array([0.015, 0.0155, 0.0165], F)
        C_THREAD = np.array([0.085, 0.08, 0.068], F)
        grain = fbm(Pg * 900.0, 2, 61)
        mott = fbm(Pg * 120.0, 3, 63)
        # back of the hand: a ribbed stretch cloth; palm and the fingers all round: suede, napped and scuffed
        suede_k = np.clip(1 - back, 0, 1)
        base = C_CLOTH[None] * (0.82 + 0.36 * mott[:, None])
        suede = C_SUEDE[None] * (0.7 + 0.5 * mott[:, None]) * (0.9 + 0.2 * grain[:, None])
        cglove = base * (1 - suede_k[:, None]) + suede * suede_k[:, None]
        rg = 0.9 - suede_k * 0.12 + (grain - 0.5) * 0.12
        if fine:
            ribs = np.sin(V * 2 * np.pi / 0.0016)
            htg += ribs * 0.00005 * (1 - suede_k)
            htg += (grain - 0.5) * 0.00012 * suede_k
            # worn pale where it rubs: finger pads, the heel of the hand
            rubbed = palm * sstep(0.45, 0.8, fbm(Pg * 70.0 + 9, 2, 67))
            cglove = cglove * (1 + rubbed[:, None] * 0.35)
        # ---- the knuckle guard: one moulding over the four knuckles, a boss on each
        guard = np.zeros(len(U), F)
        plate = np.zeros(len(U), F)
        for (ku, kv) in R.kn:
            du, dv = (U - ku + 0.015) / 0.0135, (V - kv) / 0.0088
            d = (np.abs(du) ** 3 + np.abs(dv) ** 3) ** (1 / 3)
            guard = np.maximum(guard, 1 - sstep(0.72, 1.0, d))
            d2 = (np.abs(du / 1.25) ** 4 + np.abs(dv / 1.32) ** 4) ** 0.25
            plate = np.maximum(plate, 1 - sstep(0.9, 1.0, d2))
        on_back = sstep(0.15, 0.45, Dn)
        guard *= on_back
        plate *= on_back
        hv_g += plate * 0.0011 + guard * 0.0021
        rubber = np.clip(plate, 0, 1)
        if fine:
            # a groove across each boss, and the edge of the plate standing proud of the cloth
            for (ku, kv) in R.kn:
                htg -= bump(U - ku + 0.015, 0.0012) * bump(V - kv, 0.0065) * 0.00045 * guard
            cg = np.maximum(cg, (plate > 0.02) * (plate < 0.55) * 0.55)
        # ---- the fingers: ribbed where they bend, creased underneath, a seam up each side
        if fine:
            for k, f in enumerate(R.fing):
                m = (which == k) & onf if k else (which == 0) & (fs > 0.004)
                if not m.any():
                    continue
                acc = 0.0
                for i in (1, 2):
                    acc += np.linalg.norm(f[i] - f[i - 1])
                    ds = fs[m] - acc
                    # across the back of the joint, a concertina of ribs; under it, the crease
                    rib = np.cos(ds * 2 * np.pi / 0.0026) * bump(ds, 0.0075) * back[m]
                    htg[m] += rib * 0.00022
                    cr = bump(ds, 0.0016) * palm[m]
                    htg[m] -= cr * 0.0005
                    cg[m] = np.maximum(cg[m], cr * 0.7 + bump(ds, 0.007) * back[m] * 0.15)
                # fingertip: a patch of smoother stuff sewn over the pad
                tipk = sstep(fl[m] - 0.02, fl[m] - 0.016, fs[m]) * palm[m]
                cglove[m] = cglove[m] * (1 - tipk[:, None] * 0.35)
                rg[m] = rg[m] * (1 - tipk) + tipk * 0.62
            seam = bump(Dn, 0.1) * (onf | (U > 0.012))
            htg -= bump(Dn, 0.03) * (onf | (U > 0.012)) * 0.0003
            stitch = (bump(Dn - 0.075, 0.035) + bump(Dn + 0.075, 0.035)) * (np.sin((U + V * 0.2) * 2 * np.pi / 0.0024) > 0.15) * (onf | (U > 0.012))
            htg += stitch * 0.00013
            cg = np.maximum(cg, bump(Dn, 0.035) * (onf | (U > 0.012)) * 0.6)
            cglove = cglove * (1 - seam[:, None] * 0.25)
            cglove = cglove * (1 - stitch[:, None] * 0.6) + C_THREAD[None] * stitch[:, None] * 0.6
            # the palm: a padded panel under the fingers and one on the heel, each with its row of stitches
            for (pu, pv, ru, rv) in ((kn_u - 0.012, 0.0, 0.016, 0.036), (0.022, -0.012, 0.02, 0.022)):
                d = np.sqrt(((U - pu) / ru) ** 2 + ((V - pv) / rv) ** 2)
                pad = (1 - sstep(0.86, 1.0, d)) * palm
                htg += pad * 0.0006
                sw = bump(d - 0.8, 0.045) * palm * (np.sin(np.arctan2((V - pv) / rv, (U - pu) / ru) * 40) > 0.0)
                htg += sw * 0.00013
                cglove = cglove * (1 - sw[:, None] * 0.6) + C_THREAD[None] * sw[:, None] * 0.6
                cg = np.maximum(cg, bump(d - 0.95, 0.06) * palm * 0.4)
        # ---- the cuff: neoprene up to the wrist, a strap across the back of it with its tab
        cuffk = 1 - sstep(0.004, 0.011, U)
        cglove = cglove * (1 - cuffk[:, None]) + (C_CUFF[None] * (0.85 + 0.3 * mott[:, None])) * cuffk[:, None]
        rg = rg * (1 - cuffk) + cuffk * 0.78
        strap = bump(U + 0.0115, 0.0105) * sstep(-0.35, -0.1, Dn)
        strap_e = np.clip(strap * 5, 0, 1)
        hv_g += strap_e * 0.0010
        if fine:
            htg += (fbm(Pg * 1500.0, 1, 71) - 0.5) * 0.00012 * strap_e
            cg = np.maximum(cg, (strap_e > 0.02) * (strap_e < 0.5) * 0.5)
            # where the cuff meets the hand, a line of stitching
            row = bump(U - 0.0075, 0.0011) * (np.sin(np.arctan2(Wd, V) * 70) > 0.0)
            htg += row * 0.00014
            cglove = cglove * (1 - row[:, None] * 0.5) + C_THREAD[None] * row[:, None] * 0.5
        cglove = cglove * (1 - strap_e[:, None]) + (C_STRAP[None] * (0.8 + 0.4 * grain[:, None])) * strap_e[:, None]
        rg = rg * (1 - strap_e) + strap_e * 0.95
        # rubber over everything it covers
        cglove = cglove * (1 - rubber[:, None]) + (C_RUBBER[None] * (0.85 + 0.3 * mott[:, None])) * rubber[:, None]
        rg = rg * (1 - rubber) + rubber * (0.56 + (mott - 0.5) * 0.14)
        # under the end of the sleeve the cuff goes into the dark
        under = 1 - sstep(R.sleeve_end - 0.004, R.sleeve_end + 0.004, A)
        cg = np.maximum(cg, under * 0.9)
        # the glove sits closer than the sleeve: the step between them is the end of the sleeve
        hv[g] = hv_g
        ht[g] = htg
        cav[g] = cg
        col[g] = cglove
        rough[g] = np.clip(rg, 0.3, 1)
    return dict(hv=hv, ht=ht, colour=col, rough=rough, tint=tint, cav=cav, glove=glove.astype(F))


def vertex_offset(bones, V, VN, glove, hem):
    """how far out along its normal each vertex of the mesh goes (both arms)"""
    R = Rig(bones)
    sgn = np.where(V[:, 0] < 0, -1.0, 1.0)
    P = V * np.stack([sgn, np.ones(len(V)), np.ones(len(V))], 1)
    N = VN * np.stack([sgn, np.ones(len(V)), np.ones(len(V))], 1)
    f = fields(R, P, N.astype(F), glove, fine=False, hem=np.asarray(hem, bool))
    return f['hv']


def synth(bones, Pm, Nm, AOm, cover, Gm, log=print):
    """textures from the baked maps (H x W x 3 rest position, object normal; H x W ambient occlusion; H x W bool)"""
    R = Rig(bones)
    H, W = cover.shape
    idx = np.nonzero(cover.ravel())[0]
    P = Pm.reshape(-1, 3)[idx].astype(np.float64)
    N = Nm.reshape(-1, 3)[idx].astype(np.float64)
    N /= np.linalg.norm(N, axis=1)[:, None] + 1e-9
    sgn = np.where(P[:, 0] < 0, -1.0, 1.0)
    P[:, 0] *= sgn
    N[:, 0] *= sgn
    N32 = N.astype(F)
    gl = Gm.ravel()[idx]
    log(f'[armtex] {len(idx)} texels')
    f0 = fields(R, P, N32, gl)
    # the slope of the fine height, in the round: six more looks, a quarter of a millimetre either side
    eps = 0.00025
    G = np.zeros((len(idx), 3), F)
    for i in range(3):
        d = np.zeros(3)
        d[i] = eps
        hp = fields(R, P + d, N32, gl)
        hm = fields(R, P - d, N32, gl)
        G[:, i] = ((hp['ht'] + 0.45 * hp['hv']) - (hm['ht'] + 0.45 * hm['hv'])) / (2 * eps)
        log(f'[armtex] slope {i + 1}/3')
    G[:, 0] *= sgn.astype(F)
    # which way the picture's own u and v run across the surface at each texel
    Pm2 = Pm.astype(F)
    cov = cover
    def diff(axis):
        fwd = np.roll(Pm2, -1, axis) - Pm2
        bwd = Pm2 - np.roll(Pm2, 1, axis)
        okf = cov & np.roll(cov, -1, axis)
        okb = cov & np.roll(cov, 1, axis)
        d = np.where(okf[..., None] & okb[..., None], (fwd + bwd) * 0.5, np.where(okf[..., None], fwd, np.where(okb[..., None], bwd, 0)))
        return d
    Tu = diff(1).reshape(-1, 3)[idx]
    Tv = diff(0).reshape(-1, 3)[idx]
    Nw = Nm.reshape(-1, 3)[idx].astype(F)
    Nw /= np.linalg.norm(Nw, axis=1)[:, None] + 1e-9
    # (the same frame the renderer builds from the picture's coordinates: along u, along v, and the surface's own normal)
    def unit(x):
        return x / (np.linalg.norm(x, axis=1)[:, None] + 1e-12)
    Tu = unit(Tu - Nw * (Tu * Nw).sum(1)[:, None])
    Tv = unit(Tv - Nw * (Tv * Nw).sum(1)[:, None])
    Gt = G - Nw * (G * Nw).sum(1)[:, None]
    nx = -(Gt * Tu).sum(1)
    ny = -(Gt * Tv).sum(1)
    nz = np.ones(len(idx), F)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.zeros((H * W, 3), F)
    normal[:] = (0.5, 0.5, 1.0)
    normal[idx] = np.stack([nx / l * 0.5 + 0.5, ny / l * 0.5 + 0.5, nz / l * 0.5 + 0.5], 1)
    ao = np.ones(H * W, F)
    ao[idx] = np.clip(AOm.ravel()[idx], 0, 1) ** 1.25 * (1 - f0['cav'] * 0.72)
    colour = np.zeros((H * W, 4), F)
    colour[idx, :3] = f0['colour']
    colour[idx, 3] = f0['tint']
    rough = np.ones(H * W, F)
    rough[idx] = f0['rough']
    return dict(normal=normal.reshape(H, W, 3), colour=colour.reshape(H, W, 4), ao=ao.reshape(H, W), rough=rough.reshape(H, W))


def bleed(img, cover, n=12):
    """carry the edge of every island out into the empty picture, so a blurred lookup near a seam finds more of the same"""
    img = img.copy()
    cov = cover.copy()
    for _ in range(n):
        acc = np.zeros_like(img)
        cnt = np.zeros(cov.shape, F)
        for ax, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
            c = np.roll(cov, sh, ax)
            acc += np.roll(img, sh, ax) * (c[..., None] if img.ndim == 3 else c)
            cnt += c
        new = (~cov) & (cnt > 0)
        if img.ndim == 3:
            img[new] = acc[new] / cnt[new][:, None]
        else:
            img[new] = acc[new] / cnt[new]
        cov |= new
    return img


def save(out, tex, cover, write=None):
    """three pictures: colour (alpha: where the side's dye goes), normal, and occlusion / roughness / nothing"""
    if write is None:
        from PIL import Image
        def write(path, rgba):
            a = (np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8)[::-1]
            Image.fromarray(a).save(path)
    srgb = lambda x: np.where(x <= 0.0031308, x * 12.92, 1.055 * np.clip(x, 1e-9, None) ** (1 / 2.4) - 0.055)
    one = np.ones(cover.shape + (1,), F)
    c = bleed(tex['colour'], cover)
    write(os.path.join(out, 'arms_c.png'), np.concatenate([srgb(c[..., :3]), c[..., 3:]], 2))
    write(os.path.join(out, 'arms_n.png'), np.concatenate([bleed(tex['normal'], cover), one], 2))
    orm = np.stack([bleed(tex['ao'], cover), bleed(tex['rough'], cover), np.zeros_like(tex['ao'])], 2)
    write(os.path.join(out, 'arms_orm.png'), np.concatenate([orm, one], 2))


if __name__ == '__main__':
    d = sys.argv[1]
    bones = json.load(open(os.path.join(d, 'body.json')))['bones']
    z = np.load(os.path.join(d, 'bake.npz'))
    tex = synth(bones, z['P'], z['N'], z['AO'], z['cover'], z['G'])
    save(d, tex, z['cover'])
    print('wrote', d)
