#!/bin/zsh
# One county tile, start to finish: OSM -> Blender -> Cycles lightmaps -> GLB + heightmap.
#   downtown/make_tile.sh brk1            (prep, build, bake, export)
#   NOBAKE=1 downtown/make_tile.sh brk1   (no lightmaps: a quick look)
#   SKIP_PREP=1 ...                       (reuse work/tile_<name>.json)
set -e
cd "$(dirname "$0")/.."
T=$1
W=work
BLEND=tile_$T.blend; [[ $T == dt ]] && BLEND=downtown.blend
GLB=tile_$T.glb; [[ $T == dt ]] && GLB=downtown.glb
[[ -n $SKIP_PREP ]] || work/venv/bin/python downtown/prep.py --tile $T > $W/prep_$T.log 2>&1
blender -b --factory-startup -P downtown/build_dt.py -- --tile $T > $W/build_$T.log 2>&1
SRC=$BLEND
if [[ -z $NOBAKE ]]; then
  SIZES="lm_${T}g:4096,lm_${T}b1:4096,lm_${T}b2:4096"
  [[ $T == dt ]] && SIZES="$SIZES,lm_dtbr:1024"
  (cd $W && OD_BAKE_SIZES=$SIZES OD_BAKE_TAG=$T blender -b $BLEND -P ../bake.py > bake_$T.log 2>&1)
  SRC=${BLEND%.blend}_baked.blend
fi
blender -b $W/$SRC -P downtown/export_dt.py -- --tile $T > $W/export_$T.log 2>&1
grep -E "heightmap|glb" $W/export_$T.log
npx -y @gltf-transform/cli@4 meshopt ../../public/oceandrive/$GLB $W/opt_$T.glb --level medium > /dev/null 2>&1 && mv $W/opt_$T.glb ../../public/oceandrive/$GLB
if [[ -z $NOBAKE ]]; then
  python3 downtown/dilate.py $T
fi
ls -la ../../public/oceandrive/$GLB
