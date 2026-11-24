#!/bin/zsh
# swap the palms in already-baked tiles for the palm kit's, then re-export them:  foliage/swap_tiles.sh west1 edge1 brk2
cd "$(dirname "$0")/.."
for T in "$@"; do
  B=work/tile_${T}_baked.blend
  [[ -f $B ]] || { echo "no $B"; continue; }
  blender -b $B -P foliage/swap_palms.py > work/swap_$T.log 2>&1
  grep -E "swapped|Error" work/swap_$T.log
  blender -b $B -P downtown/export_dt.py -- --tile $T > work/export_$T.log 2>&1
  npx -y @gltf-transform/cli@4 meshopt ../../public/oceandrive/tile_$T.glb work/opt_$T.glb --level medium > /dev/null 2>&1 && mv work/opt_$T.glb ../../public/oceandrive/tile_$T.glb
  ls -la ../../public/oceandrive/tile_$T.glb
done
