# Shared by Tracksmith's Blender scripts (blender -b --python blender/tracksmith/<x>.py).
# Everything is written in the game's frame (x, y up, z) and goes into Blender's z-up through G();
# the glTF exporter converts back, so G(x, y, z) lands at (x, y, z) in the game.
import bpy, bmesh, json, math, os
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'public', 'tracksmith')
DATA = json.load(open(os.path.join(HERE, 'data.json')))
# (the game loads a packed copy: npx @gltf-transform/cli meshopt blender/tracksmith/kit.raw.glb public/tracksmith/kit.glb)
KIT = os.path.join(HERE, 'kit.raw.glb')


def G(x, y, z):
    return Vector((x, -z, y))


def srgb(hexv):
    """a theme colour (sRGB hex) in Blender's linear space"""
    out = []
    for s in ((hexv >> 16) & 255, (hexv >> 8) & 255, hexv & 255):
        c = s / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def reset(engine='CYCLES'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = engine
    sc.cycles.device = 'CPU'
    return sc
