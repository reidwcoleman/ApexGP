#!/usr/bin/env python3
"""
Downloads the scanned CC0 trees the tree baker (tools/bake_trees.mjs) works from, into
assets-src/trees/<asset>/ (git-ignored). Poly Haven (https://polyhaven.com, CC0) glTF at 1k
textures: the geometry is the full-resolution scan (hundreds of thousands to millions of
triangles), so these are used OFFLINE ONLY — the game loads the compact baked output under
public/trees/ (tools/bake_trees.mjs).

    python3 tools/trees_fetch.py            # every asset below
    python3 tools/trees_fetch.py jacaranda_tree fir_tree_01
"""
import json
import os
import sys
import urllib.request

ASSETS = [
    'jacaranda_tree',   # broad round crown: the park broadleaf (plane / oak stand-in)
    'island_tree_02',   # big olive dome on a short bole (chestnut / oak)
    'island_tree_01',   # gnarled, open crown (oak)
    'tree_small_02',    # Burkea africana: flat umbrella crown (acacia / ghaf / gum)
    'fir_tree_01',      # three tall firs: the spruce plantations (Spa, Styria, Suzuka)
    'fir_sapling_medium',  # a young fir with branches to the ground: woodland edges
    'searsia_lucida',   # three bushes: the understorey / scrub
]
ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets-src', 'trees')


def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers={'User-Agent': 'apexgp-tree-fetch'})
    with urllib.request.urlopen(req) as r, open(path + '.part', 'wb') as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
    os.rename(path + '.part', path)


def main():
    names = sys.argv[1:] or ASSETS
    for a in names:
        meta = json.load(urllib.request.urlopen(urllib.request.Request(f'https://api.polyhaven.com/files/{a}', headers={'User-Agent': 'apexgp-tree-fetch'})))
        g = meta['gltf']['1k']['gltf']
        d = os.path.join(ROOT, a)
        get(g['url'], os.path.join(d, f'{a}.gltf'))
        for rel, v in g['include'].items():
            get(v['url'], os.path.join(d, rel))
        # the glTF's leaf colour maps are JPEGs (their alpha dropped): the cut-out masks come separately
        for k, v in meta.items():
            if 'alpha' in k.lower() and isinstance(v, dict) and '1k' in v:
                f = v['1k'].get('png') or v['1k'].get('jpg')
                if f:
                    get(f['url'], os.path.join(d, 'textures', os.path.basename(f['url'])))
                    print('  alpha', k, os.path.basename(f['url']))
        print('ok', a, flush=True)


if __name__ == '__main__':
    main()
