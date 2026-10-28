#!/bin/zsh
# Builds src/boost/sim/rs/rs.mjs + rs.wasm: RocketSim (MIT, github.com/ZealanL/RocketSim) and its Bullet,
# compiled with Emscripten, plus rsjs.cpp (the flat interface the game calls).
#   git clone --depth 1 https://github.com/ZealanL/RocketSim.git <dir>
#   tools/rocketsim/build.sh <dir>        (needs emsdk: source ~/emsdk/emsdk_env.sh)
# Never build with -ffast-math: the host and every guest must run the same arithmetic.
set -e
RS=${1:?path to a RocketSim checkout}
HERE=$(cd "$(dirname $0)" && pwd)
OUT=$HERE/../../src/boost/sim/rs
OBJ=$(mktemp -d)
source ~/emsdk/emsdk_env.sh >/dev/null 2>&1
FLAGS="-O3 -std=c++20 -DRS_DONT_LOG -DNDEBUG -fno-fast-math -I$RS/src"
files=($(find $RS/src $RS/libsrc -name '*.cpp') $HERE/rsjs.cpp)
for f in $files; do
  while (( $(jobs -r | wc -l) >= 8 )); do sleep 0.2; done
  em++ ${=FLAGS} -c $f -o $OBJ/$(echo $f | tr '/' '_').o 2>/dev/null &
done
wait
em++ -O3 $OBJ/*.o -o $OUT/rs.mjs \
  -sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createRS -sALLOW_MEMORY_GROWTH -sENVIRONMENT=web,node \
  -sINITIAL_MEMORY=64MB -sSTACK_SIZE=1MB -sEXPORTED_RUNTIME_METHODS=HEAPF64,HEAPU8 \
  -sEXPORTED_FUNCTIONS=_rs_init,_rs_create,_rs_add_car,_rs_clear_cars,_rs_controls,_rs_step,_rs_tick,_rs_set_tick,_rs_get_car,_rs_set_car,_rs_get_ball,_rs_set_ball,_rs_pad_count,_rs_pad_info,_rs_get_pads,_rs_set_pads,_rs_events,_rs_malloc,_rs_free
rm -rf $OBJ
ls -la $OUT/rs.mjs $OUT/rs.wasm
