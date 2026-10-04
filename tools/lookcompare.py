#!/usr/bin/env python3
"""
Tone / colour comparison of game frames against reference footage (the TikTok look study).

usage:
  tools/lookcompare.py REF_SPEC GAME_SPEC [--name label]          one pair
  tools/lookcompare.py --pairs pairs.txt [G=dir] [label ...]       many pairs, one per line: label REF_SPEC GAME_SPEC
                                                                   (`R=dir` lines define path prefixes R/…)

A SPEC is a file, a directory (every .jpg/.png in it) or a glob, optionally followed by
`@x0,y0,x1,y1` (a crop in fractions of the frame: cut letterboxes, captions, the cockpit).
Several frames are pooled into one histogram (and the per-frame numbers are medianed), so a clip's
look is measured, not one lucky frame.

Measured (display-referred sRGB, 0 … 1):
  L p1/p5/p25/p50/p75/p95/p99   luminance percentiles: p1 = black point, p99 = white point
  mean, sat                      mean luminance, mean saturation (HSV-style, ignoring near-black)
  sh / mid / hi                  share of pixels and mean colour (r/g, b/g) of shadows (<0.15),
                                 mids, highlights (>0.5): the colour of the light and the shade
  bands                          the frame cut into 6 horizontal bands, top → bottom: mean L and
                                 local contrast (std of a 9 px high-pass: detail that survives the
                                 haze). The top bands are sky/distance, the bottom the near ground or
                                 cockpit; `sky/gnd` is the brightest band over the darkest.
  haze                           detail of the 2nd band (the horizon) relative to the frame's
                                 busiest band: low = the distance is fogged flat
"""
import glob
import os
import sys

import numpy as np
from PIL import Image

W709 = np.array([0.2126, 0.7152, 0.0722], np.float32)


def files_of(spec):
    path, _, crop = spec.partition('@')
    if os.path.isdir(path):
        fs = sorted(f for f in glob.glob(os.path.join(path, '*')) if f.lower().endswith(('.jpg', '.jpeg', '.png')))
    else:
        fs = sorted(glob.glob(path))
    box = [float(v) for v in crop.split(',')] if crop else None
    return fs, box


def load(f, box, max_w=640):
    im = Image.open(f).convert('RGB')
    if box:
        w, h = im.size
        im = im.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))
    if im.size[0] > max_w:
        im = im.resize((max_w, int(im.size[1] * max_w / im.size[0])), Image.BILINEAR)
    return np.asarray(im).astype(np.float32) / 255.0


def box_blur(a, r):
    k = 2 * r + 1
    p = np.pad(a, r, mode='edge')
    c = p.cumsum(0)
    c = np.vstack([np.zeros((1, c.shape[1]), c.dtype), c])
    v = (c[k:] - c[:-k]) / k
    c = v.cumsum(1)
    c = np.hstack([np.zeros((c.shape[0], 1), c.dtype), c])
    return (c[:, k:] - c[:, :-k]) / k


def frame_stats(a):
    px = a.reshape(-1, 3)
    l = px @ W709
    mx, mn = px.max(1), px.min(1)
    sat = np.where(mx > 0.04, (mx - mn) / np.maximum(mx, 1e-4), 0)
    L = a @ W709
    hp = L - box_blur(L, 4)
    h = L.shape[0]
    bands = []
    for i in range(6):
        s = slice(int(i * h / 6), int((i + 1) * h / 6))
        bands.append((float(L[s].mean()), float(hp[s].std())))
    out = {'mean': float(l.mean()), 'sat': float(sat[l > 0.02].mean()) if (l > 0.02).any() else 0.0, 'bands': bands}
    return out, px, l


def tone(px, l):
    p = np.percentile(l, [1, 5, 25, 50, 75, 95, 99])
    zones = {}
    for lo, hi, tag in ((0.0, 0.15, 'sh'), (0.15, 0.5, 'mid'), (0.5, 1.01, 'hi')):
        m = (l >= lo) & (l < hi)
        if m.sum() < 50:
            zones[tag] = None
            continue
        c = px[m].mean(0)
        zones[tag] = (float(m.mean()), float(c[0] / max(c[1], 1e-4)), float(c[2] / max(c[1], 1e-4)))
    return p, zones


def measure(spec):
    fs, box = files_of(spec)
    if not fs:
        raise SystemExit(f'no frames for {spec}')
    per, pxs, ls = [], [], []
    for f in fs:
        st, px, l = frame_stats(load(f, box))
        per.append(st)
        # pool a subsample of every frame's pixels for the histogram
        idx = np.random.default_rng(1).choice(len(l), size=min(len(l), 60000), replace=False)
        pxs.append(px[idx])
        ls.append(l[idx])
    px, l = np.concatenate(pxs), np.concatenate(ls)
    p, zones = tone(px, l)
    bands = np.median(np.array([s['bands'] for s in per]), axis=0)
    detail = bands[:, 1]
    return {
        'n': len(fs),
        'p': p,
        'mean': float(np.median([s['mean'] for s in per])),
        'sat': float(np.median([s['sat'] for s in per])),
        'zones': zones,
        'bands': bands,
        'skygnd': float(bands[:, 0].max() / max(bands[:, 0].min(), 1e-3)),
        'haze': float(detail[1] / max(detail.max(), 1e-4)),
    }


def fmt_zone(z):
    return '      -          ' if z is None else f'{z[0]*100:3.0f}% {z[1]:.2f} {z[2]:.2f}'


def report(label, ref, game):
    print(f'== {label}   (ref {ref["n"]} frames, game {game["n"]} frames)')
    print(f'  {"":6s} {"p1":>5s} {"p5":>5s} {"p25":>5s} {"p50":>5s} {"p75":>5s} {"p95":>5s} {"p99":>5s} | mean  sat  | sky/gnd haze')
    for tag, m in (('ref', ref), ('game', game)):
        print(f'  {tag:6s} ' + ' '.join(f'{v:5.2f}' for v in m['p']) + f' | {m["mean"]:.2f} {m["sat"]:.2f} | {m["skygnd"]:6.2f} {m["haze"]:.2f}')
    d = game['p'] - ref['p']
    print(f'  {"diff":6s} ' + ' '.join(f'{v:+5.2f}' for v in d) + f' | {game["mean"]-ref["mean"]:+.2f} {game["sat"]-ref["sat"]:+.2f} |')
    print(f'  zones (share r/g b/g)   {"shadows":17s} {"mids":17s} {"highlights":17s}')
    for tag, m in (('ref', ref), ('game', game)):
        print(f'  {tag:6s}                  ' + '  '.join(fmt_zone(m['zones'][k]) for k in ('sh', 'mid', 'hi')))
    print('  bands L/detail  ' + '  '.join(f'{b[0]:.2f}/{b[1]:.3f}' for b in ref['bands']) + '   (ref)')
    print('                  ' + '  '.join(f'{b[0]:.2f}/{b[1]:.3f}' for b in game['bands']) + '   (game)')


def main(argv):
    if argv and argv[0] == '--pairs':
        # `NAME=dir` lines (or arguments after the file, which win) define prefixes: `NAME/x.jpg`
        # → dir/x.jpg, so one pairs file serves every round of shots (G=round3)
        defs = dict(a.split('=', 1) for a in argv[2:] if '=' in a)
        only = [a for a in argv[2:] if '=' not in a]
        sub = lambda s: next((d + s[len(k):] for k, d in {**fdefs, **defs}.items() if s.startswith(k + '/')), s)
        fdefs = {}
        for line in open(argv[1]):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line.split()[0] and len(line.split()) == 1:
                k, v = line.split('=', 1)
                fdefs[k] = v
                continue
            label, r, g = line.split()[:3]
            if only and label not in only:
                continue
            try:
                report(label, measure(sub(r)), measure(sub(g)))
            except SystemExit as e:
                print(f'== {label}: {e}')
        return
    if len(argv) < 2:
        print(__doc__)
        return
    label = argv[argv.index('--name') + 1] if '--name' in argv else 'pair'
    report(label, measure(argv[0]), measure(argv[1]))


if __name__ == '__main__':
    main(sys.argv[1:])
