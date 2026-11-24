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
# quantize + meshopt (Blender's own meshopt pass barely compresses): ~half the size
npx -y @gltf-transform/cli@4 meshopt ../../public/oceandrive/block.glb work/block_opt.glb --level medium > work/pack.log 2>&1 && mv work/block_opt.glb ../../public/oceandrive/block.glb
tail -1 work/pack.log
python3 - <<'PY'
from PIL import Image
import json, os
import numpy as np
from scipy import ndimage
m = json.load(open('work/lightmaps.json'))
for n in m:
    a = np.asarray(Image.open(f'work/{n}.png').convert('RGB'))
    # dilate: every empty texel between the islands takes its nearest baked one, so the mip levels
    # (and the far, grazing views of thin strips like the side streets) don't fade into black
    empty = a.sum(axis=2) < 4
    _, (iy, ix) = ndimage.distance_transform_edt(empty, return_indices=True)
    Image.fromarray(a[iy, ix]).save(f'../../public/oceandrive/lm/{n}.webp', quality=92, method=6)
print('lightmaps', sorted(os.listdir('../../public/oceandrive/lm')))
PY
