"""mean albedo of each scan, for the light bake's bounce colour (Blender's python has no Pillow)"""
import json, os
from PIL import Image
from mats import MATS
R = os.path.join(os.path.dirname(__file__), '..', '..', 'assets-src', 'lf', 'tex')
o = {}
for k, v in MATS.items():
    im = Image.open(f"{R}/{v['tex']}_diff.jpg").convert('RGB').resize((1, 1), Image.BOX).getpixel((0, 0))
    lin = list(v['tint']) if v.get('mono') else [((c / 255) ** 2.2) * t for c, t in zip(im, v['tint'])]
    o[k] = lin
json.dump(o, open(os.path.join(os.path.dirname(__file__), 'means.json'), 'w'))
