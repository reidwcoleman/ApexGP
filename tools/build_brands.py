"""Cut the sponsors' logo lockups (public/brands) from the generated design sheets
(assets-src/generated/brands/sheet_*.png: five banners stacked on magenta, GPT Image 2.6 through
Higgsfield). Each banner is found by the magenta between them, its flat colour read off its border and
the artwork trimmed to the logo; brands.ts draws it on that colour at any board's proportions.
All fictional brands (src/world/partners.ts).  python3 tools/build_brands.py"""
import os, json, re
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'assets-src', 'generated', 'brands')
OUT = os.path.join(ROOT, 'public', 'brands')
SHEETS = {
    'sheet_a.png': ['VALCOURT', 'VELTRA', 'SWIFTLINE', 'BRANDT 0.0', 'MAISON DUVAL'],
    'sheet_b.png': ['TAURO', 'CORVINA AIR', 'REDWOOD', 'stratus', 'PETRANOVA'],
    'sheet_c.png': ['MAISON VERNET', 'NOVACHAIN', 'MERIDIA CRUISES', 'Tessara', 'BRIANZA BANCA'],
    'sheet_d.png': ['LEONIDA', 'Aurelia', 'FONTALBA', 'TELVIA', 'ARDENZA'],
}
H = 220
# a tagline the generator misspelt is left off: keep only this top fraction of the banner
KEEP_TOP = {'VELTRA': 0.72}

def runs(mask, min_len):
    out, start = [], None
    for i, v in enumerate(list(mask) + [False]):
        if v and start is None: start = i
        elif not v and start is not None:
            if i - start >= min_len: out.append((start, i))
            start = None
    return out

os.makedirs(OUT, exist_ok=True)
index = {}
for sheet, names in SHEETS.items():
    path = os.path.join(SRC, sheet)
    if not os.path.exists(path):
        print('missing', sheet); continue
    a = np.asarray(Image.open(path).convert('RGB'), dtype=np.int32)
    mag = (a[..., 0] > 170) & (a[..., 2] > 170) & (a[..., 1] < 120)
    rows = runs((~mag).mean(1) > 0.6, a.shape[0] // 20)
    if len(rows) != len(names):
        print(sheet, 'found', len(rows), 'banners, expected', len(names)); continue
    for (y0, y1), name in zip(rows, names):
        cols = runs((~mag[y0:y1]).mean(0) > 0.6, a.shape[1] // 4)
        x0, x1 = cols[0][0], cols[-1][1]
        m = 10  # inside the anti-aliased magenta fringe
        b = a[y0 + m:y1 - m, x0 + m:x1 - m]
        ring = np.concatenate([b[:6].reshape(-1, 3), b[-6:].reshape(-1, 3), b[:, :6].reshape(-1, 3), b[:, -6:].reshape(-1, 3)])
        bg = np.median(ring, 0)
        diff = np.abs(b - bg).sum(-1) > 60
        if name in KEEP_TOP: diff[int(b.shape[0] * KEEP_TOP[name]):] = False
        ys, xs = np.where(diff)
        pad = int(b.shape[0] * 0.06)
        cy0, cy1 = max(0, ys.min() - pad), min(b.shape[0], ys.max() + pad)
        if name in KEEP_TOP: b = np.where((np.arange(b.shape[0]) > ys.max() + 2)[:, None, None], bg.astype(np.int32), b)
        cx0, cx1 = max(0, xs.min() - pad), min(b.shape[1], xs.max() + pad)
        c = b[cy0:cy1, cx0:cx1].astype(np.float64)
        # the banner's colour is not quite flat (the generator's soft vignette): pull everything near
        # the background onto it, so the crop vanishes into the board's fill
        d = np.abs(c - bg).sum(-1, keepdims=True)
        k = np.clip((d - 14) / 40, 0, 1)
        c = bg + (c - bg) * k
        im = Image.fromarray(np.round(c).astype(np.uint8))
        im = im.resize((max(1, round(im.width * H / im.height)), H), Image.LANCZOS)
        slug = re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')
        im.save(os.path.join(OUT, slug + '.webp'), 'WEBP', quality=92, method=6)
        index[name] = {'file': slug + '.webp', 'bg': '#%02x%02x%02x' % tuple(int(round(v)) for v in bg)}
        print(name, im.size, index[name]['bg'])
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), indent=1, ensure_ascii=False)
