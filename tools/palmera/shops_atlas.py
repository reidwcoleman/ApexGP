"""Assemble the interior renders into an atlas: shops (tools/palmera/shops.py -> shops.webp) or rooms
(tools/palmera/rooms.py -> rooms.webp).

Run: python3 tools/palmera/shops_atlas.py <render_dir> <out.webp> [shops|rooms]
2048 x 2048: one row per shop (grocery, boutique, cafe, electronics from the top), one column per
surface (back wall, the wall at room x = 0, the wall at x = W, the floor), 512 px tiles. In every
tile u runs along the room's x (back wall, floor) or depth z (side walls), v up the wall (or along z
on the floor) - images are flipped here to match, from the axes each render wrote.
"""
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
set_ = sys.argv[3] if len(sys.argv) > 3 else 'shops'
NAMES = ('grocery', 'boutique', 'cafe', 'electronics') if set_ == 'shops' else ('officeA', 'officeB', 'living', 'kitchen')
T = 512
atlas = Image.new('RGB', (T * 4, T * 4))
for row, shop in enumerate(NAMES):
    for col, face in enumerate(('back', 'xlo', 'xhi', 'floor')):
        im = Image.open(f'{src}/{shop}_{face}.png').convert('RGB')
        rx, ry, rz, ux, uy, uz = map(float, open(f'{src}/{shop}_{face}.axes').read().split())
        # wanted: image right = +room u axis, image up = +room v axis
        # back: u = +X, v = +Z (Blender); sides: u = +Y (depth), v = +Z; floor: u = +X, v = +Y
        want_u = {'back': (1, 0, 0), 'xlo': (0, 1, 0), 'xhi': (0, 1, 0), 'floor': (1, 0, 0)}[face]
        want_v = {'back': (0, 0, 1), 'xlo': (0, 0, 1), 'xhi': (0, 0, 1), 'floor': (0, 1, 0)}[face]
        dot = lambda a, b: sum(x * y for x, y in zip(a, b))
        if dot((rx, ry, rz), want_u) < 0:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        if dot((ux, uy, uz), want_v) < 0:
            im = im.transpose(Image.FLIP_TOP_BOTTOM)
        atlas.paste(im.resize((T, T), Image.LANCZOS), (col * T, row * T))
atlas.save(dst, 'WEBP', quality=88, method=6)
print('atlas ->', dst)
