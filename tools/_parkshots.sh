#!/bin/bash
# usage: tools/_parkshots.sh [suffix] [extra url params]
cd "$(dirname "$0")/.."
SUF=${1:-}
EXTRA=${2:-}
shoot() { # name s lat h s2 lat2 h2
  C=$(node tools/_cam.mjs $2 $3 $4 $5 $6 $7)
  node tools/shot.mjs "/src/dev/world.html?$C$EXTRA" shots/park_$1$SUF.png --w 1600 --h 900 --wait 90000 2>&1 | grep -E "saved|error|Error" | head -3
}
shoot straight_t1 880 -2 1.2 1160 -10 4
shoot curvagrande 1500 1 1.2 1680 -8 3
shoot lesmo 2700 0 1.2 2850 8 3
shoot bridge 3600 2 1.2 3720 0 5
shoot ascari 4080 0 1.2 4200 10 2
shoot parabolica_tv 5330 -40 14 5460 5 0
shoot centrale_tv 560 30 16 560 -60 6
