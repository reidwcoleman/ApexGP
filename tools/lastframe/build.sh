#!/bin/zsh
# One location from layout to game:  tools/lastframe/build.sh ward|store OUT [SIZE] [SAMPLES] [PORT]
# PORT is a running stable dev server (npx vite --config vite.stable.config.mjs --port 5281) for the light volume; 0 skips it.
# Kit only (no light bake):          KIT=1 tools/lastframe/build.sh store OUT   (OUT must hold an earlier bake)
set -e
MAP=$1; OUT=$2; SIZE=${3:-4096}; SPP=${4:-128}; PORT=${5:-5281}
HERE=${0:a:h}; ROOT=${HERE:h:h}
cd $ROOT
if [[ -n "$KIT" ]]; then
  blender -b --python tools/lastframe/bake.py -- --map $MAP --size $SIZE --samples 8 --props --nobake --out $OUT 2>&1 | grep -E "^\[|Error|Traceback|  File |  !|Exception" || true
  python3 tools/lastframe/pack.py $OUT --$MAP --tex | tail -2
  exit 0
fi
blender -b --python tools/lastframe/bake.py -- --map $MAP --size $SIZE --samples $SPP --props --out $OUT ${=EXTRA} 2>&1 | grep -E "^\[|Error|Traceback|  File |  !|Exception" || true
blender -b --python tools/lastframe/denoise.py -- $OUT 2>&1 | grep -E "dn mean|Error" || true
[[ -f $OUT/lightmap2.exr ]] && (blender -b --python tools/lastframe/denoise.py -- $OUT lightmap2 2>&1 | grep -E "dn mean|Error" || true)
python3 tools/lastframe/pack.py $OUT --$MAP --tex | tail -2
[[ "$PORT" != "0" ]] && node tools/lastframe/volume.mjs $PORT $MAP | tail -2
echo built $MAP
