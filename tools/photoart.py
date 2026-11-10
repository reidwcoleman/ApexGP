"""Loading / key art from photographs: each in-engine frame of public/loading (tools/loadart.mjs) was
re-rendered as a real motorsport photograph of the same composition (Higgsfield, GPT Image 2.6, the
in-engine frame as its reference; sources kept in assets-src/generated/loading, out of git) and is
written here at the loader's size. Running tools/loadart.mjs again puts the in-engine frames back.
python3 tools/photoart.py [name ...]"""
import sys, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'assets-src', 'generated', 'loading')
OUT = os.path.join(ROOT, 'public', 'loading')
W, H = 1800, 1620
names = sys.argv[1:] or sorted(f[:-4] for f in os.listdir(SRC) if f.endswith('.png'))
for n in names:
    im = Image.open(os.path.join(SRC, n + '.png')).convert('RGB')
    # cover-fit to the loader's 10:9 frame (the sources are 9:8: a sliver off the sides)
    k = max(W / im.size[0], H / im.size[1])
    im = im.resize((round(im.size[0] * k), round(im.size[1] * k)), Image.LANCZOS)
    x, y = (im.size[0] - W) // 2, (im.size[1] - H) // 2
    im.crop((x, y, x + W, y + H)).save(os.path.join(OUT, n + '.webp'), 'WEBP', quality=74, method=6)
    print(n, os.path.getsize(os.path.join(OUT, n + '.webp')) // 1024, 'KB')
