"""The print on what a supermarket sells: one sheet of packaging, 8 x 8 cells, every brand on it made up.

  python3 tools/lastframe/packtex.py            -> public/lastframe/tex/lf_pack_c.webp

  cells  0-15  boxes, front on (cereal, pasta, powder)
        16-23  bags
        24-31  tin labels, the front twice round
        32-39  bottle and jar labels, the front twice round
        40-43  flat packs, 44-45 multipacks of rolls, 46-47 shelf-edge tickets
  and four 2 x 2 blocks along the bottom: a printed case side, a plain one with its despatch label, a case top taped
  shut, and four singles (two offer cards, a darker case side, bare board).

Everything is drawn faded: these have stood under dead tubes for years, and bright labels read as toys.
The sheet is saved upside down, which is the way up the game's loader and a glTF's v axis between them want it.
"""
import math, os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'lastframe', 'tex', 'lf_pack_c.webp')
N, C = 8, 256
SS = 2                      # drawn at twice the size, then brought down
F = '/System/Library/Fonts/Supplemental/'
FONTS = dict(impact=(F + 'Impact.ttf', 0), black=(F + 'Arial Black.ttf', 0), din=(F + 'DIN Condensed Bold.ttf', 0), futura=(F + 'Futura.ttc', 4), futuram=(F + 'Futura.ttc', 0),
             rock=(F + 'Rockwell.ttc', 1), georgia=(F + 'Georgia Bold.ttf', 0), georgiai=(F + 'Georgia Bold Italic.ttf', 0), gill=(F + 'GillSans.ttc', 1), bodoni=(F + 'Bodoni 72.ttc', 2),
             type=(F + 'AmericanTypewriter.ttc', 1), copper=(F + 'Copperplate.ttc', 1), helv=('/System/Library/Fonts/Helvetica.ttc', 1), helvl=('/System/Library/Fonts/Helvetica.ttc', 0),
             treb=(F + 'Trebuchet MS Bold.ttf', 0))
_fc = {}


def font(name, px):
    k = (name, int(px))
    if k not in _fc:
        p, i = FONTS[name]
        try:
            _fc[k] = ImageFont.truetype(p, int(px), index=i)
        except Exception:
            _fc[k] = ImageFont.truetype(F + 'Arial Black.ttf', int(px))
    return _fc[k]


# ink that has had its years: nothing saturated, nothing clean
INK = dict(red=(150, 44, 38), brick=(128, 58, 44), navy=(34, 52, 92), blue=(52, 88, 132), teal=(40, 104, 104), green=(48, 96, 58), olive=(98, 104, 52), mustard=(186, 146, 52),
           yellow=(204, 172, 64), orange=(184, 104, 44), cream=(222, 212, 184), white=(226, 224, 214), black=(26, 26, 28), brown=(92, 60, 38), plum=(96, 48, 86), pink=(176, 104, 112),
           grey=(120, 122, 122), sky=(132, 164, 184), kraft=(164, 126, 84), kraft2=(140, 104, 66), mint=(140, 176, 150), maroon=(104, 34, 40))
BRANDS = ("HALDEN'S", 'MORROW', 'KETTLEWICK', 'FENN & CO', 'PELLHAM', 'CORVO', 'DUNMORE', 'TIDEWELL', "ASHBY'S", 'NORRLAND', 'LARKFIELD', 'OLD TANNERY', 'WREN', 'BRISCOE', 'MARLOW', 'HOLLIS')


def lum(c):
    return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]


def over(c):
    """an ink that reads on c"""
    return INK['cream'] if lum(c) < 120 else INK['black']


def mix(a, b, t):
    return tuple(int(a[k] + (b[k] - a[k]) * t) for k in range(3))


class Art:
    def __init__(s, w, h, bg):
        s.w, s.h = w * SS, h * SS
        s.im = Image.new('RGB', (s.w, s.h), bg)
        s.d = ImageDraw.Draw(s.im)

    def R(s, x0, y0, x1, y1, c, r=0):
        b = [x0 * s.w, y0 * s.h, x1 * s.w, y1 * s.h]
        if r:
            s.d.rounded_rectangle(b, r * s.w, fill=c)
        else:
            s.d.rectangle(b, fill=c)

    def O(s, cx, cy, rx, ry, c, outline=None, width=0):
        s.d.ellipse([(cx - rx) * s.w, (cy - ry) * s.h, (cx + rx) * s.w, (cy + ry) * s.h], fill=c, outline=outline, width=int(width * s.w))

    def P(s, pts, c):
        s.d.polygon([(x * s.w, y * s.h) for x, y in pts], fill=c)

    def T(s, txt, cx, cy, size, c, f='impact', maxw=0.9, anchor='mm', track=0):
        """text centred on (cx, cy), size as a fraction of the height, shrunk to fit maxw of the width"""
        px = size * s.h
        fn = font(f, px)
        w = s.d.textlength(txt, font=fn)
        if w > maxw * s.w:
            px *= maxw * s.w / w
            fn = font(f, px)
        s.d.text((cx * s.w, cy * s.h), txt, font=fn, fill=c, anchor=anchor)

    def lines(s, x0, y0, x1, n, gap, c, rng, th=0.006):
        """small print: rows of it, broken into words"""
        for k in range(n):
            y = y0 + k * gap
            x = x0
            end = x1 - (rng.random() * 0.3 * (x1 - x0) if k == n - 1 else 0)
            while x < end - 0.02:
                wl = rng.uniform(0.03, 0.11)
                s.R(x, y, min(end, x + wl), y + th, c)
                x += wl + 0.014

    def barcode(s, x0, y0, x1, y1, rng):
        s.R(x0 - 0.01, y0 - 0.008, x1 + 0.01, y1 + 0.02, INK['white'])
        x = x0
        while x < x1:
            w = rng.choice((0.004, 0.004, 0.008, 0.012)) * (x1 - x0) * 6
            s.R(x, y0, min(x1, x + w), y1, INK['black'])
            x += w + rng.choice((0.004, 0.008)) * (x1 - x0) * 6

    def out(s, w=C, h=C):
        return s.im.resize((w, h), Image.LANCZOS)


def box_front(i, rng):
    """a carton seen front on: a band of the maker's colour, the name, what it is, a picture of it, the weight"""
    pal = [('cream', 'red', 'navy'), ('navy', 'yellow', 'cream'), ('mustard', 'brown', 'cream'), ('teal', 'cream', 'orange'), ('white', 'blue', 'red'), ('brick', 'cream', 'black'),
           ('olive', 'cream', 'brown'), ('sky', 'navy', 'white'), ('orange', 'white', 'brown'), ('green', 'yellow', 'cream'), ('plum', 'cream', 'mustard'), ('white', 'green', 'black'),
           ('yellow', 'red', 'black'), ('black', 'mustard', 'cream'), ('pink', 'maroon', 'white'), ('kraft', 'black', 'red')][i % 16]
    bg, a, b = (INK[k] for k in pal)
    what = ('CORN FLAKES', 'WHEAT BISCUITS', 'PORRIDGE OATS', 'PENNE RIGATE', 'SODA CRYSTALS', 'CREAM CRACKERS', 'BRAN STICKS', 'LONG GRAIN RICE', 'FUSILLI', 'WASHING POWDER',
            'TEA 80 BAGS', 'OAT CAKES', 'PUFFED RICE', 'GROUND COFFEE', 'ICING SUGAR', 'DOG BISCUIT')[i % 16]
    A = Art(200, 300, bg)
    style = i % 4
    brand = BRANDS[(i * 5 + 3) % len(BRANDS)]
    f1 = ('impact', 'rock', 'futura', 'georgia', 'din', 'black', 'copper', 'bodoni')[i % 8]
    if style == 0:
        A.R(0, 0, 1, 0.3, a)
        A.T(brand, 0.5, 0.15, 0.13, over(a), f1)
        A.O(0.5, 0.62, 0.36, 0.2, mix(bg, INK['black'], 0.12))
        A.O(0.5, 0.6, 0.33, 0.18, b)
        A.O(0.5, 0.6, 0.27, 0.14, mix(INK['mustard'], INK['cream'], 0.4))
        A.T(what, 0.5, 0.38, 0.062, over(bg), 'din', 0.86)
    elif style == 1:
        A.O(0.5, 0.26, 0.42, 0.19, a)
        A.T(brand, 0.5, 0.25, 0.12, over(a), f1, 0.7)
        A.R(0, 0.5, 1, 0.66, b)
        A.T(what, 0.5, 0.58, 0.08, over(b), 'impact', 0.9)
        for k in range(5):
            A.R(0.12 + k * 0.17, 0.72, 0.2 + k * 0.17, 0.9, mix(a, bg, 0.3), 0.03)
    elif style == 2:
        A.P([(0, 0), (1, 0), (1, 0.22), (0, 0.42)], a)
        A.T(brand, 0.45, 0.14, 0.11, over(a), f1, 0.8)
        A.T(what.split(' ')[0], 0.5, 0.55, 0.15, b if abs(lum(b) - lum(bg)) > 50 else over(bg), 'impact', 0.88)
        A.T(' '.join(what.split(' ')[1:]) or 'ORIGINAL', 0.5, 0.68, 0.07, over(bg), 'din', 0.8)
        A.R(0.1, 0.76, 0.9, 0.765, over(bg))
    else:
        A.R(0.07, 0.05, 0.93, 0.95, mix(bg, INK['black'] if lum(bg) > 120 else INK['white'], 0.1))
        A.R(0.1, 0.07, 0.9, 0.93, bg)
        A.T(brand, 0.5, 0.17, 0.09, a if abs(lum(a) - lum(bg)) > 50 else over(bg), f1, 0.72)
        A.R(0.2, 0.25, 0.8, 0.256, over(bg))
        A.T(what, 0.5, 0.33, 0.075, over(bg), 'gill', 0.72)
        A.O(0.5, 0.6, 0.27, 0.17, a)
        A.O(0.5, 0.6, 0.2, 0.125, b)
    A.T(('500 g', '750 g', '1 kg', '375 g', '2 kg', '250 g')[i % 6] + ' e', 0.8, 0.94, 0.04, over(bg), 'helv', 0.3)
    A.lines(0.08, 0.915, 0.5, 2, 0.02, mix(over(bg), bg, 0.35), rng, 0.007)
    return A.out()


def bag_front(i, rng):
    """a pillow bag: a window or a picture, a name across it, a torn-off price flash"""
    pal = [('red', 'cream'), ('navy', 'mustard'), ('green', 'cream'), ('mustard', 'brown'), ('black', 'orange'), ('white', 'blue'), ('brown', 'cream'), ('teal', 'yellow')][i % 8]
    bg, a = (INK[k] for k in pal)
    what = ('SALTED CRISPS', 'ROAST PEANUTS', 'BASMATI RICE', 'PLAIN FLOUR', 'DARK ROAST', 'CASTER SUGAR', 'RED LENTILS', 'TORTILLA CHIPS')[i % 8]
    A = Art(200, 280, bg)
    for k in range(9):
        A.R(0, k * 0.012, 1, k * 0.012 + 0.005, mix(bg, INK['black'], 0.25))           # the crimp
        A.R(0, 1 - k * 0.012 - 0.005, 1, 1 - k * 0.012, mix(bg, INK['black'], 0.25))
    brand = BRANDS[(i * 3 + 7) % len(BRANDS)]
    A.T(brand, 0.5, 0.2, 0.085, a, ('rock', 'futura', 'impact', 'georgia')[i % 4], 0.8)
    if i % 2:
        A.O(0.5, 0.52, 0.34, 0.2, a)
        A.T(what.split(' ')[0], 0.5, 0.5, 0.1, over(a), 'impact', 0.6)
        A.T(what.split(' ')[-1], 0.5, 0.6, 0.06, over(a), 'din', 0.5)
    else:
        A.R(0.1, 0.32, 0.9, 0.5, a)
        A.T(what, 0.5, 0.41, 0.09, over(a), 'impact', 0.74)
        A.O(0.5, 0.7, 0.28, 0.13, mix(bg, INK['black'], 0.35))
        A.O(0.5, 0.69, 0.25, 0.115, mix(INK['kraft'], INK['cream'], 0.3 + 0.1 * (i % 3)))
    A.T(('150 g', '1 kg', '500 g', '1.5 kg')[i % 4], 0.5, 0.88, 0.045, over(bg), 'helv', 0.3)
    return A.out()


def can_label(i, rng):
    """a tin's paper label: the same front twice round, the small print between"""
    pal = [('red', 'cream', 'black'), ('cream', 'green', 'red'), ('navy', 'cream', 'orange'), ('mustard', 'black', 'red'), ('green', 'yellow', 'cream'), ('white', 'red', 'navy'),
           ('brown', 'cream', 'mustard'), ('teal', 'white', 'black')][i % 8]
    bg, a, b = (INK[k] for k in pal)
    what = ('BAKED BEANS', 'GARDEN PEAS', 'TOMATO SOUP', 'SWEETCORN', 'CHOPPED TOMATOES', 'PEACH SLICES', 'OXTAIL SOUP', 'TUNA CHUNKS')[i % 8]
    A = Art(640, 240, bg)
    brand = BRANDS[(i * 7 + 1) % len(BRANDS)]
    for h in (0.0, 0.5):
        cx = h + 0.25
        if i % 3 == 0:
            A.R(h + 0.02, 0.08, h + 0.48, 0.36, a)
            A.T(brand, cx, 0.22, 0.2, over(a), 'rock', 0.4)
            A.T(what, cx, 0.52, 0.14, over(bg), 'impact', 0.42)
            A.O(cx, 0.78, 0.1, 0.13, b)
        elif i % 3 == 1:
            A.O(cx, 0.5, 0.2, 0.42, a)
            A.T(brand, cx, 0.3, 0.14, over(a), 'futura', 0.3)
            A.T(what.split(' ')[0], cx, 0.52, 0.2, over(a), 'impact', 0.32)
            A.T(what.split(' ')[-1], cx, 0.72, 0.11, over(a), 'din', 0.28)
        else:
            A.R(h, 0.0, h + 0.5, 0.16, b)
            A.R(h, 0.84, h + 0.5, 1.0, b)
            A.T(brand, cx, 0.3, 0.17, a, 'georgia', 0.4)
            A.T(what, cx, 0.58, 0.16, over(bg), 'impact', 0.42)
        A.lines(h + 0.435, 0.2, h + 0.5, 9, 0.07, mix(over(bg), bg, 0.4), rng, 0.022)
    return A.out()


def bottle_label(i, rng):
    """what is stuck on a bottle or a jar: smaller, more paper showing, the front twice round"""
    pal = [('cream', 'maroon', 'black'), ('white', 'navy', 'red'), ('black', 'mustard', 'cream'), ('cream', 'green', 'brown'), ('yellow', 'red', 'black'), ('white', 'teal', 'black'),
           ('kraft', 'black', 'red'), ('white', 'orange', 'navy')][i % 8]
    bg, a, b = (INK[k] for k in pal)
    what = ('MALT VINEGAR', 'OLIVE OIL', 'STOUT', 'PICKLED ONIONS', 'BROWN SAUCE', 'SPRING WATER', 'STRAWBERRY JAM', 'ORANGE SQUASH', 'BLEACH', 'DRY CIDER')[i % 10]
    A = Art(512, 240, bg)
    brand = BRANDS[(i * 11 + 5) % len(BRANDS)]
    for h in (0.0, 0.5):
        cx = h + 0.25
        A.R(h + 0.03, 0.05, h + 0.47, 0.95, mix(bg, a, 0.06))
        A.R(h + 0.03, 0.05, h + 0.47, 0.09, a)
        A.R(h + 0.03, 0.91, h + 0.47, 0.95, a)
        if i % 2:
            A.O(cx, 0.36, 0.11, 0.2, a)
            A.T(brand[:1], cx, 0.36, 0.26, over(a), 'bodoni', 0.2)
            A.T(what, cx, 0.72, 0.15, b if abs(lum(b) - lum(bg)) > 50 else over(bg), 'din', 0.38)
        else:
            A.T(brand, cx, 0.28, 0.17, a, ('bodoni', 'copper', 'georgia', 'rock')[i // 2 % 4], 0.38)
            A.R(h + 0.1, 0.42, h + 0.4, 0.435, b)
            A.T(what, cx, 0.6, 0.16, over(bg), 'impact', 0.38)
            A.T(('70 cl', '500 ml', '1 litre', '340 g')[i % 4], cx, 0.8, 0.09, over(bg), 'helv', 0.2)
    return A.out()


def flat_pack(i, rng):
    """the long edge of a flat box, the way they are stacked on a shelf"""
    pal = [('navy', 'cream', 'orange'), ('red', 'cream', 'black'), ('white', 'green', 'red'), ('black', 'yellow', 'cream')][i % 4]
    bg, a, b = (INK[k] for k in pal)
    what = ('FISH FINGERS  x10', 'MARGHERITA PIZZA', 'GARDEN PEAS 900 g', 'BEEF LASAGNE')[i % 4]
    A = Art(560, 150, bg)
    A.R(0, 0, 0.3, 1, a)
    A.T(BRANDS[(i * 9 + 2) % len(BRANDS)], 0.15, 0.5, 0.36, over(a), 'rock', 0.26)
    A.T(what, 0.64, 0.42, 0.34, over(bg), 'impact', 0.62)
    A.R(0.34, 0.74, 0.94, 0.8, b)
    return A.out()


def rolls(i, rng):
    """a printed film round a multipack: mostly clear, the rolls showing through as pale bars, a band across the middle"""
    bg = INK['white']
    a = (INK['blue'], INK['green'])[i % 2]
    A = Art(560, 320, bg)
    for k in range(4):
        A.R(k * 0.25 + 0.012, 0.0, k * 0.25 + 0.238, 1.0, mix(bg, INK['grey'], 0.1), 0.02)
        A.O(k * 0.25 + 0.125, 0.5, 0.03, 0.4, mix(bg, INK['grey'], 0.2))
    A.R(0, 0.3, 1, 0.7, a)
    A.T(BRANDS[(i * 13 + 4) % len(BRANDS)], 0.3, 0.5, 0.2, over(a), 'futura', 0.4)
    A.T(('KITCHEN TOWEL  x4', 'TOILET TISSUE  x9')[i % 2], 0.74, 0.5, 0.12, over(a), 'din', 0.42)
    return A.out()


def ticket(i, rng):
    """a shelf-edge ticket: the price big, what it is small, a barcode"""
    bg = (INK['white'], INK['yellow'])[i % 2]
    A = Art(240, 130, bg)
    A.T(('1.29', '0.89', '2.49', '3.15')[rng.randrange(4)], 0.36, 0.42, 0.62, INK['black'] if i % 2 == 0 else INK['red'], 'impact', 0.6)
    A.lines(0.06, 0.8, 0.6, 2, 0.08, INK['grey'], rng, 0.03)
    A.barcode(0.7, 0.2, 0.94, 0.7, rng)
    return A.out()


def board(w, h, base, rng, flutes=True):
    """corrugated board: the colour of it uneven, the flutes showing through as faint ribs, scuffs, a damp corner"""
    A = Art(w, h, base)
    px = A.im.load()
    nz = Image.effect_noise((A.w // 40, A.h // 40), 9).resize((A.w, A.h), Image.BICUBIC)
    nz2 = Image.effect_noise((A.w, A.h), 5)
    A.im = ImageChops.add(A.im, Image.merge('RGB', [nz] * 3), 1.0, -128)
    A.im = ImageChops.add(A.im, Image.merge('RGB', [nz2] * 3), 1.0, -128)
    A.d = ImageDraw.Draw(A.im)
    if flutes:
        ov = Image.new('L', (A.w, A.h), 128)
        od = ImageDraw.Draw(ov)
        step = max(6, A.w // 84)
        for x in range(0, A.w, step):
            od.line([(x, 0), (x, A.h)], fill=119, width=max(1, step // 3))
        A.im = ImageChops.add(A.im, Image.merge('RGB', [ov] * 3), 1.0, -128)
        A.d = ImageDraw.Draw(A.im)
    return A


def wear(A, rng, n=14):
    """scuffs where it was dragged, a crease, a corner that got wet"""
    ov = Image.new('L', (A.w, A.h), 0)
    od = ImageDraw.Draw(ov)
    for k in range(n):
        x, y = rng.uniform(0, A.w), rng.uniform(0, A.h)
        a = rng.uniform(-0.4, 0.4) + (0 if rng.random() < 0.7 else 1.57)
        ln = rng.uniform(0.05, 0.3) * A.w
        od.line([(x, y), (x + math.cos(a) * ln, y + math.sin(a) * ln)], fill=rng.randint(30, 90), width=rng.randint(2, 7))
    ov = ov.filter(ImageFilter.GaussianBlur(3))
    A.im = Image.composite(Image.new('RGB', (A.w, A.h), (206, 180, 140)), A.im, ov.point(lambda v: v * 0.6))
    st = Image.new('L', (A.w, A.h), 0)
    sd = ImageDraw.Draw(st)
    cx, cy = rng.choice((0, A.w)), A.h
    for k in range(5):
        r = rng.uniform(0.12, 0.34) * A.w
        sd.ellipse([cx - r + rng.uniform(-40, 40), cy - r * 0.7, cx + r + rng.uniform(-40, 40), cy + r * 0.7], fill=110)
    st = st.filter(ImageFilter.GaussianBlur(26))
    A.im = Image.composite(Image.new('RGB', (A.w, A.h), (70, 50, 32)), A.im, st)
    A.d = ImageDraw.Draw(A.im)


def stamp(A, draw, alpha=0.82):
    """ink on board is never solid: print through a layer and let the board show"""
    lay = Image.new('RGB', (A.w, A.h), (0, 0, 0))
    msk = Image.new('L', (A.w, A.h), 0)
    B = Art.__new__(Art)
    B.w, B.h, B.im, B.d = A.w, A.h, lay, ImageDraw.Draw(lay)
    M = Art.__new__(Art)
    M.w, M.h, M.im, M.d = A.w, A.h, msk, ImageDraw.Draw(msk)
    draw(B, M)
    nz = Image.effect_noise((A.w, A.h), 60).point(lambda v: 255 if v > 70 else 150)
    msk = ImageChops.multiply(msk, nz).point(lambda v: int(v * alpha))
    A.im = Image.composite(lay, A.im, msk)
    A.d = ImageDraw.Draw(A.im)


def case_side(k, rng, dark=False):
    base = INK['kraft2'] if dark else INK['kraft']
    A = board(256, 256, base, rng)
    ink = (38, 34, 30) if k % 2 == 0 else (84, 26, 22)
    brand = BRANDS[(k * 5) % len(BRANDS)]
    what = ('BAKED BEANS 24 x 415 g', 'PORRIDGE OATS 12 x 1 kg', 'TOMATO SOUP 24 x 400 g', 'KITCHEN TOWEL 6 x 4')[k % 4]

    def pr(B, M):
        for X, c in ((B, ink), (M, 255)):
            X.T(brand, 0.5, 0.3, 0.17, c, ('impact', 'rock', 'futura', 'black')[k % 4], 0.78)
            X.R(0.12, 0.42, 0.88, 0.432, c)
            X.T(what, 0.5, 0.5, 0.062, c, 'din', 0.74)
            # this way up, keep dry
            for j, x in enumerate((0.14, 0.26)):
                X.P([(x, 0.9), (x + 0.03, 0.9), (x + 0.03, 0.8), (x + 0.055, 0.8), (x + 0.015, 0.73), (x - 0.025, 0.8), (x, 0.8)], c)
            X.R(0.1, 0.915, 0.33, 0.925, c)
            X.T('BEST BEFORE END', 0.72, 0.8, 0.036, c, 'helv', 0.34)
            X.T(('03 / 19', '11 / 18', '07 / 19', '01 / 20')[k % 4] + '   L' + str(4100 + k * 37), 0.72, 0.86, 0.042, c, 'type', 0.34)
    stamp(A, pr)
    wear(A, rng)
    # the edge of the tape that comes over from the top
    A.R(0.4, 0.0, 0.6, 0.11, (150, 118, 76))
    A.R(0.4, 0.105, 0.6, 0.113, (120, 92, 58))
    return A


def case_plain(k, rng):
    A = board(256, 256, INK['kraft'], rng)

    def pr(B, M):
        for X, c in ((B, (40, 36, 32)), (M, 255)):
            # fragile: a glass
            X.P([(0.12, 0.62), (0.26, 0.62), (0.21, 0.74), (0.2, 0.84), (0.25, 0.86), (0.13, 0.86), (0.18, 0.84), (0.17, 0.74)], c)
            X.T('HANDLE WITH CARE', 0.19, 0.91, 0.03, c, 'din', 0.22)
            X.T('24', 0.84, 0.8, 0.16, c, 'impact', 0.2)
    stamp(A, pr, 0.7)
    wear(A, rng, 20)
    # a despatch label, stuck on crooked
    lab = Art(120, 84, (214, 212, 202))
    lab.T("HALDEN'S", 0.3, 0.14, 0.15, INK['black'], 'black', 0.5)
    lab.T('STORE 0417', 0.76, 0.14, 0.11, INK['black'], 'helv', 0.4)
    lab.R(0.04, 0.25, 0.96, 0.262, INK['black'])
    lab.lines(0.06, 0.33, 0.6, 4, 0.085, INK['grey'], rng, 0.03)
    lab.barcode(0.1, 0.72, 0.9, 0.92, rng)
    lab.T('AMBIENT', 0.8, 0.46, 0.13, INK['black'], 'impact', 0.3)
    li = lab.im.rotate(rng.uniform(-4, 4), expand=True, fillcolor=(0, 0, 0))
    lm = Image.new('L', lab.im.size, 255).rotate(0, expand=True)
    lm = Image.new('L', lab.im.size, 255).rotate(rng.uniform(-4, 4), expand=True)
    A.im.paste(li, (int(A.w * 0.3), int(A.h * 0.16)), lm.resize(li.size))
    A.d = ImageDraw.Draw(A.im)
    A.R(0.4, 0.0, 0.6, 0.11, (150, 118, 76))
    A.R(0.4, 0.105, 0.6, 0.113, (120, 92, 58))
    return A


def case_top(k, rng):
    A = board(256, 256, mix(INK['kraft'], INK['kraft2'], 0.3), rng, flutes=False)
    wear(A, rng, 10)
    # the flaps meet down the middle; tape over the seam, shinier and paler than the board, wrinkled
    A.R(0.0, 0.494, 1.0, 0.506, (84, 62, 40))
    tp = Image.new('RGB', (A.w, int(A.h * 0.2)), (170, 140, 92))
    nz = Image.effect_noise(tp.size, 14)
    tp = ImageChops.add(tp, Image.merge('RGB', [nz] * 3), 1.0, -128)
    td = ImageDraw.Draw(tp)
    for j in range(26):
        x = rng.uniform(0, tp.size[0])
        td.line([(x, 0), (x + rng.uniform(-30, 30), tp.size[1])], fill=(186, 158, 110), width=2)
    A.im.paste(tp, (0, int(A.h * 0.4)))
    A.d = ImageDraw.Draw(A.im)
    A.R(0.0, 0.398, 1.0, 0.404, (128, 100, 62))
    A.R(0.0, 0.596, 1.0, 0.602, (128, 100, 62))
    return A


def offer(k, rng):
    """the card over a display: an offer, in the shop's own hand"""
    bg = (INK['red'], INK['yellow'])[k % 2]
    fg = over(bg) if k % 2 else INK['cream']
    A = Art(256, 150, bg)
    A.R(0.03, 0.05, 0.97, 0.95, fg)
    A.R(0.045, 0.075, 0.955, 0.925, bg)
    if k % 2:
        A.T('2 FOR', 0.3, 0.46, 0.4, INK['black'], 'impact', 0.42)
        A.T('3.00', 0.7, 0.46, 0.52, INK['red'], 'impact', 0.42)
        A.T('ANY TWO  -  MIX AND MATCH', 0.5, 0.82, 0.1, INK['black'], 'din', 0.8)
    else:
        A.T('HALF PRICE', 0.5, 0.42, 0.44, fg, 'impact', 0.84)
        A.T("WHEN IT'S GONE IT'S GONE", 0.5, 0.8, 0.11, fg, 'din', 0.8)
    return A


def grime(im, rng, k=1.0):
    """dust settled on everything, darker toward the foot of each cell, and the colour gone out of it"""
    w, h = im.size
    g = im.convert('L').convert('RGB')
    im = Image.blend(im, g, 0.34)
    dust = Image.new('RGB', (w, h), (148, 140, 124))
    m = Image.effect_noise((w // 6, h // 6), 50).resize((w, h), Image.BICUBIC).point(lambda v: max(0, min(255, int((v - 96) * 0.9 * k))))
    im = Image.composite(dust, im, m.point(lambda v: int(v * 0.42)))
    sp = Image.effect_noise((w, h), 40).point(lambda v: 255 if v > 214 else 0).filter(ImageFilter.GaussianBlur(0.7))
    im = Image.composite(Image.new('RGB', (w, h), (60, 52, 44)), im, sp.point(lambda v: int(v * 0.5)))
    return im


def main():
    sheet = Image.new('RGB', (N * C, N * C), (120, 110, 96))
    rng = random.Random(417)

    def put(i, im):
        sheet.paste(grime(im, rng), ((i % N) * C, (i // N) * C))
    for i in range(16):
        put(i, box_front(i, rng))
    for i in range(8):
        put(16 + i, bag_front(i, rng))
        put(24 + i, can_label(i, rng))
        put(32 + i, bottle_label(i, rng))
    for i in range(4):
        put(40 + i, flat_pack(i, rng))
    for i in range(2):
        put(44 + i, rolls(i, rng))
        put(46 + i, ticket(i, rng))
    big = 2 * C
    sheet.paste(grime(case_side(0, rng).out(big, big), rng, 0.7), (0, 6 * C))
    sheet.paste(grime(case_plain(0, rng).out(big, big), rng, 0.7), (2 * C, 6 * C))
    sheet.paste(grime(case_top(0, rng).out(big, big), rng, 0.7), (4 * C, 6 * C))
    sheet.paste(grime(offer(0, rng).out(), rng, 0.6), (6 * C, 6 * C))
    sheet.paste(grime(offer(1, rng).out(), rng, 0.6), (7 * C, 6 * C))
    sheet.paste(grime(case_side(1, rng, dark=True).out(), rng, 0.7), (6 * C, 7 * C))
    b = board(256, 256, INK['kraft2'], rng)
    wear(b, rng, 18)
    sheet.paste(grime(b.out(), rng, 0.7), (7 * C, 7 * C))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.transpose(Image.FLIP_TOP_BOTTOM).save(OUT, 'WEBP', quality=90, method=6)
    sheet.save('/tmp/lf_pack_preview.png')
    print('wrote', os.path.normpath(OUT), os.path.getsize(OUT) // 1024, 'KB')


if __name__ == '__main__':
    main()
