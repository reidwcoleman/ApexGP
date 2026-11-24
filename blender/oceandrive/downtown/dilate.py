"""work/<lightmap>.png -> public/oceandrive/lm/<lightmap>.webp, islands dilated into the padding (mips stay clean)"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(os.path.dirname(HERE), 'work')
OUT = os.path.join(os.path.dirname(HERE), '..', '..', 'public', 'oceandrive', 'lm')
m = json.load(open(os.path.join(W, f'lightmaps_{sys.argv[1]}.json')))
for n in m:
    a = np.asarray(Image.open(os.path.join(W, n + '.png')).convert('RGB'))
    empty = a.sum(axis=2) < 4
    _, (iy, ix) = ndimage.distance_transform_edt(empty, return_indices=True)
    Image.fromarray(a[iy, ix]).save(os.path.join(OUT, n + '.webp'), quality=92, method=6)
    print('lightmap', n)
