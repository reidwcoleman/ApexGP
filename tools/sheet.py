# contact sheet: python3 tools/sheet.py out.png cols w img1 img2 ...
import sys
from PIL import Image
out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ims = [Image.open(p).convert('RGB') for p in sys.argv[4:]]
h = int(w * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (cols * w, rows * h), (0, 0, 0))
for i, im in enumerate(ims):
    S.paste(im.resize((w, h), Image.LANCZOS), ((i % cols) * w, (i // cols) * h))
S.save(out)
