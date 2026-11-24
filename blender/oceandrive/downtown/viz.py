from PIL import Image, ImageDraw
class Viz:
    def __init__(s, x0, x1, y0, y1, S=0.5):
        s.x0, s.y1, s.S = x0, y1, S
        s.im = Image.new('RGB', (int((x1 - x0) * S), int((y1 - y0) * S)), (40, 40, 40)); s.d = ImageDraw.Draw(s.im)
    def T(s, p): return ((p[0] - s.x0) * s.S, (s.y1 - p[1]) * s.S)
    def poly(s, g, fill, outline=None):
        gs = getattr(g, 'geoms', [g])
        for p in gs:
            if p.is_empty: continue
            s.d.polygon([s.T(q) for q in p.exterior.coords], fill=fill, outline=outline)
            for h in p.interiors: s.d.polygon([s.T(q) for q in h.coords], fill=(40, 40, 40))
    def line(s, pts, fill, w=1): s.d.line([s.T(q) for q in pts], fill=fill, width=w)
    def text(s, p, t, fill=(255, 0, 0)): s.d.text(s.T(p), t, fill=fill)
    def save(s, f): s.im.save(f)
