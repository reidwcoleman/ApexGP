"""Procedural textures the scanned libraries don't have: the coconut palm frond (RGBA leaflets) and its
normal map. Run with system python3 (PIL + numpy). Output: assets/gen/"""
import math, os, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'assets', 'gen'); os.makedirs(OUT, exist_ok=True)
random.seed(7)

def frond(path, W=512, H=1024, S=3, dry=False):
    """u across (rachis at the centre), v along: base at the bottom (v=0 -> y=H), tip at the top."""
    w, h = W * S, H * S
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    n = 74
    for side in (-1, 1):
        for i in range(n):
            t = 0.04 + 0.94 * (i + random.random() * 0.5) / n       # along the rachis
            y0 = h * (1 - t)
            # leaflet length: short at the base, longest a third up, tapering to the tip
            L = (0.12 + 0.88 * math.sin(math.pi * min(1, t * 1.25)) ** 0.7) * (1 - 0.55 * t ** 2) * w * 0.47
            L *= 0.85 + 0.3 * random.random()
            if random.random() < 0.06: L *= 0.55                     # torn
            ang = math.radians(32 + 22 * t + random.uniform(-6, 6))  # sweep toward the tip
            droop = random.uniform(0.05, 0.22)
            base_w = (5.0 + 4 * (1 - t)) * S
            pts_l, pts_r = [], []
            steps = 14
            for k in range(steps + 1):
                s = k / steps
                x = side * (s * L * math.sin(ang))
                y = -(s * L * math.cos(ang)) + droop * L * s * s
                width = base_w * (1 - s) ** 0.9 + 0.6 * S
                # perpendicular
                dx, dy = side * math.sin(ang), -math.cos(ang) + 2 * droop * s
                nl = math.hypot(dx, dy); nx, ny = -dy / nl, dx / nl
                cx, cy = w / 2 + x, y0 + y
                pts_l.append((cx + nx * width / 2, cy + ny * width / 2))
                pts_r.append((cx - nx * width / 2, cy - ny * width / 2))
            g = random.uniform(0.78, 1.08)
            yellow = random.uniform(0, 0.25) + (0.25 if t < 0.15 else 0)
            if dry:
                col = (int(150 * g), int(118 * g), int(70 * g), 255)
            else:
                col = (int((58 + 70 * yellow) * g), int((92 + 30 * yellow) * g), int((34 + 6 * yellow) * g), 255)
            d.polygon(pts_l + pts_r[::-1], fill=col)
            # midrib highlight
            d.line([((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in zip(pts_l, pts_r)], fill=tuple(min(255, int(c * 1.25)) for c in col[:3]) + (255,), width=max(1, S))
            # brown dry tip
            if random.random() < 0.35 or dry:
                k0 = int(steps * random.uniform(0.75, 0.92))
                tip = pts_l[k0:] + pts_r[k0:][::-1]
                if len(tip) > 2: d.polygon(tip, fill=(int(140 * g), int(110 * g), int(62 * g), 255))
    # rachis
    for k in range(60):
        t0, t1 = k / 60, (k + 1) / 60
        wd = (14 * (1 - t0) + 3) * S
        c = (int(150 - 30 * t0), int(150 - 20 * t0), int(80 - 10 * t0), 255) if not dry else (160, 128, 80, 255)
        d.rectangle([w / 2 - wd / 2, h * (1 - t1), w / 2 + wd / 2, h * (1 - t0)], fill=c)
    im = im.resize((W, H), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    # bleed colour into transparent texels so mips don't halo black
    rgb, al = a[..., :3], a[..., 3:4] / 255
    blur = np.asarray(Image.fromarray(np.uint8(np.clip(rgb * al, 0, 255))).filter(ImageFilter.GaussianBlur(6))).astype(np.float32)
    wb = np.asarray(Image.fromarray(np.uint8(al[..., 0] * 255)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32)[..., None] / 255
    fill = blur / np.maximum(wb, 1e-3)
    rgb = np.where(al > 0.02, rgb / np.maximum(al, 1e-3) * np.minimum(al * 50, 1) + 0 * fill, fill)
    rgb = np.where(al > 0.02, a[..., :3], fill)
    out = np.concatenate([np.clip(rgb, 0, 255), a[..., 3:4]], -1).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(path)
    # normal map from luminance (leaflet ridges)
    lum = np.asarray(Image.fromarray(out).convert('L').filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255
    gy, gx = np.gradient(lum)
    nx, ny, nz = -gx * 6, gy * 6, np.ones_like(lum)
    nl = np.sqrt(nx * nx + ny * ny + nz * nz)
    nm = np.stack([nx / nl * 0.5 + 0.5, ny / nl * 0.5 + 0.5, nz / nl * 0.5 + 0.5], -1)
    Image.fromarray(np.uint8(nm * 255)).save(path.replace('.png', '_n.png'))

frond(os.path.join(OUT, 'palm_frond.png'))
frond(os.path.join(OUT, 'palm_frond_dry.png'), dry=True)
print('ok')


def seagrape_leaves(path, W=512, S=2):
    """a cluster of round, leathery sea grape leaves (RGBA card)"""
    w = W * S
    im = Image.new('RGBA', (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    rnd = random.Random(11)
    for k in range(150):
        a = rnd.uniform(0, 6.283); r = (rnd.random() ** 0.6) * w * 0.42
        cx, cy = w / 2 + math.cos(a) * r, w / 2 + math.sin(a) * r * 0.9
        R = rnd.uniform(0.05, 0.085) * w
        g = rnd.uniform(0.7, 1.1)
        red = rnd.random() < 0.12
        base = (int((70 if not red else 140) * g), int((105 if not red else 70) * g), int((38 if not red else 40) * g))
        rot = rnd.uniform(0, 3.14)
        pts = []
        for t in range(28):
            th = 6.283 * t / 28
            rr = R * (1 - 0.12 * math.cos(th * 2)) * (0.9 if math.sin(th) < -0.85 else 1)
            pts.append((cx + math.cos(th + rot) * rr, cy + math.sin(th + rot) * rr * 0.92))
        d.polygon(pts, fill=base + (255,))
        # a lighter side and the midrib
        d.polygon([(cx, cy)] + pts[2:12], fill=tuple(min(255, int(c * 1.18)) for c in base) + (255,))
        d.line([(cx - math.cos(rot) * R * 0.9, cy - math.sin(rot) * R * 0.9), (cx + math.cos(rot) * R * 0.9, cy + math.sin(rot) * R * 0.9)], fill=(180, 160, 90, 255) if not red else (200, 120, 90, 255), width=S)
    im = im.resize((W, W), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    al = a[..., 3:4] / 255
    blur = np.asarray(Image.fromarray(np.uint8(np.clip(a[..., :3] * al, 0, 255))).filter(ImageFilter.GaussianBlur(5))).astype(np.float32)
    wb = np.asarray(Image.fromarray(np.uint8(al[..., 0] * 255)).filter(ImageFilter.GaussianBlur(5))).astype(np.float32)[..., None] / 255
    rgb = np.where(al > 0.02, a[..., :3], blur / np.maximum(wb, 1e-3))
    Image.fromarray(np.concatenate([np.clip(rgb, 0, 255), a[..., 3:4]], -1).astype(np.uint8), 'RGBA').save(path)

seagrape_leaves(os.path.join(OUT, 'seagrape.png'))
print('ok2')
