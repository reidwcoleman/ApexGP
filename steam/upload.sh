#!/bin/sh
# Build Windows + Mac and upload them to Steam with SteamPipe.
#   1. Fill in YOUR_APP_ID / depot ids in app_build.vdf, depot_*.vdf (Steamworks → your app → SteamPipe → Depots)
#   2. Install steamcmd:  brew install --cask steamcmd   (or the Steamworks SDK's tools/ContentBuilder)
#   3. ./steam/upload.sh <steam-build-account>
set -e
cd "$(dirname "$0")/.."
ACCOUNT="${1:?usage: steam/upload.sh <steam username>}"
( cd desktop && npm install && npm run dist:win && npm run dist:mac )
steamcmd +login "$ACCOUNT" +run_app_build "$(pwd)/steam/app_build.vdf" +quit
echo "Uploaded. Set the build live on a branch in Steamworks → SteamPipe → Builds."
