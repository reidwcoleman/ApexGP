"""Steam store + library capsules from the beauty frames (tools/steamart.mjs → steam/art/raw).
python3 tools/steam_capsules.py  →  steam/art/*.png (sizes per Steamworks' graphical asset rules)."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, '..', 'steam', 'art')
RAW = os.path.join(ART, 'raw')
FONT = '/System/Library/Fonts/Supplemental/Arial Black.ttf'
RED = (255, 43, 63, 255)


def logo(h: int) -> Image.Image:
    """the wordmark: a red chevron and APEX GP, slanted, white, on transparent"""
    f = ImageFont.truetype(FONT, int(h * 0.78))
    tw = int(f.getlength('APEX GP'))
    w = int(tw + h * 1.35)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = h * 0.5
    # chevron
    x = h * 0.05
    d.polygon([(x, h * 0.12), (x + h * 0.26, h * 0.12), (x + h * 0.6, c), (x + h * 0.26, h * 0.88), (x, h * 0.88), (x + h * 0.34, c)], fill=RED)
    d.text((h * 0.78, c), 'APEX', font=f, fill=(255, 255, 255, 255), anchor='lm')
    gx = h * 0.78 + f.getlength('APEX ')
    d.text((gx, c), 'GP', font=f, fill=RED, anchor='lm')
    # italic: shear
    k = 0.18
    im = im.transform((int(w + h * k), h), Image.AFFINE, (1, k, -h * k, 0, 1, 0), resample=Image.BICUBIC)
    return im


def cover(src: Image.Image, w: int, h: int, fx=0.5, fy=0.5) -> Image.Image:
    s = max(w / src.width, h / src.height)
    im = src.resize((round(src.width * s), round(src.height * s)), Image.LANCZOS)
    x = int((im.width - w) * fx)
    y = int((im.height - h) * fy)
    return im.crop((x, y, x + w, y + h)).convert('RGBA')


def shade(im: Image.Image, side='left', strength=0.75) -> Image.Image:
    """a dark gradient on one side so the wordmark reads"""
    w, h = im.size
    g = Image.new('L', (w, h))
    px = g.load()
    for x in range(w):
        for y in range(h):
            t = x / w if side == 'left' else (1 - x / w) if side == 'right' else y / h if side == 'top' else 1 - y / h
            px[x, y] = int(255 * strength * max(0, 1 - t / 0.62) ** 1.4)
    black = Image.new('RGBA', (w, h), (6, 8, 12, 255))
    return Image.composite(black, im, g)


def put(canvas: Image.Image, mark: Image.Image, width: float, x: float, y: float):
    m = mark.resize((int(width), int(mark.height * width / mark.width)), Image.LANCZOS)
    canvas.alpha_composite(m, (int(x), int(y - m.height / 2)))


def main():
    hero = Image.open(os.path.join(RAW, 'yas_chase.png'))
    alt = Image.open(os.path.join(RAW, 'spa_chase.png'))
    mark = logo(400)
    out = {}
    # header capsule 920×430
    im = shade(cover(hero, 920, 430, 0.5, 0.45), 'left', 0.85)
    put(im, mark, 470, 40, 215)
    out['header_capsule.png'] = im
    # small capsule 462×174 (the logo must fill it)
    im = shade(cover(hero, 462, 174, 0.55, 0.5), 'left', 0.9)
    put(im, mark, 400, 30, 87)
    out['small_capsule.png'] = im
    # main capsule 1232×706
    im = shade(cover(hero, 1232, 706, 0.5, 0.5), 'left', 0.85)
    put(im, mark, 620, 56, 353)
    out['main_capsule.png'] = im
    # vertical capsule 748×896
    im = shade(cover(hero, 748, 896, 0.62, 0.5), 'top', 0.85)
    put(im, mark, 640, 54, 150)
    out['vertical_capsule.png'] = im
    # library capsule 600×900
    im = shade(cover(hero, 600, 900, 0.62, 0.5), 'top', 0.85)
    put(im, mark, 520, 40, 140)
    out['library_capsule.png'] = im
    # library hero 3840×1240 (no logo: Steam lays the library logo over it)
    out['library_hero.png'] = cover(alt, 3840, 1240, 0.5, 0.55)
    # library logo 1280×720, transparent
    im = Image.new('RGBA', (1280, 720), (0, 0, 0, 0))
    put(im, mark, 1200, 40, 360)
    out['library_logo.png'] = im
    for k, v in out.items():
        v.save(os.path.join(ART, k))
        print(k, v.size)


main()
