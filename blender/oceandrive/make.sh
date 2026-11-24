#!/bin/zsh
# Ocean Drive asset pipeline: OSM + Poly Haven -> Blender scene -> Cycles lightmaps -> GLB/heightmap for the browser.
#   ./make.sh          bake + export (uses work/oceandrive.blend)
#   ./make.sh build    rebuild the scene first
set -e
cd "$(dirname "$0")"
mkdir -p work ../../public/oceandrive/lm
[[ -d assets/tex ]] || python3 fetch_assets.py
[[ -f assets/gen/palm_frond.png ]] || python3 gen_textures.py
if [[ "$1" == "build" ]]; then blender -b --factory-startup -P build.py > work/build.log 2>&1; fi
(cd work && blender -b oceandrive.blend -P ../bake.py -- ${BAKE_ONLY:+only=$BAKE_ONLY} > bake.log 2>&1)
grep -E "lm_|done" work/bake.log
(cd work && blender -b oceandrive_baked.blend -P ../export.py > export.log 2>&1)
grep -E "decimated|heightmap|glb|done|Error" work/export.log
python3 - <<'PY'
from PIL import Image
import json, os
m = json.load(open('work/lightmaps.json'))
for n in m:
    Image.open(f'work/{n}.png').convert('RGB').save(f'../../public/oceandrive/lm/{n}.webp', quality=92, method=6)
print('lightmaps', sorted(os.listdir('../../public/oceandrive/lm')))
PY
