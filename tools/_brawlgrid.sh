#!/bin/sh
# screenshot every arena (CPU match, N seconds in) into shots/<tag>_grid.png
TAG=${1:-now}; SECS=${2:-4}
for a in tilt clock sushi bath cake wash train balloon; do node tools/brawlshot.mjs $a shots/${TAG}_$a.png --secs $SECS --w 1280 --h 720 >/dev/null & done; wait
python3 -c "
from PIL import Image
ims=[Image.open(f'shots/${TAG}_{a}.png').resize((640,360)) for a in 'tilt clock sushi bath cake wash train balloon'.split()]
W=Image.new('RGB',(1280,1440))
for i,im in enumerate(ims): W.paste(im,((i%2)*640,(i//2)*360))
W.save('shots/${TAG}_grid.png')"
