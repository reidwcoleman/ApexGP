"""Car interior kit for Palmera (public/palmera/interior.glb), placed into every kit car's cabin.

Run: blender -b --python tools/palmera/interior.py -- <out.glb> [preview_dir]

Game frame (x right/driver side +x, y up, z forward). Parts are modelled once at a reference size and
coloured near-white for the fabric so the game can tint each car's trim (charcoal, beige, tan):
  int_seat    - a front bucket seat; origin at the H-point (cushion top, rear): cushion forward to
                z = +0.5, back rising behind, bolsters, headrest on posts, the base and rails below
  int_bench   - the rear bench, 1.3 m wide, same origin convention, two headrests
  int_dash    - the dashboard, 1.5 m wide; origin at its top rear edge: soft top, instrument hood and
                dials on the driver's side, a centre stack with a screen and vents, glovebox seam
  int_wheel   - the steering wheel (origin at its centre, facing the driver) with its column
  int_console - the centre console (origin at its top front): gear selector, cup holders, armrest
"""
import sys, os, math
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kitlib as K

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
PREV = args[1] if len(args) > 1 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
K.PREFIX = 'int_'


def S(*a, **k):
    """soft panels at one subdivision level: a city of cars carries these"""
    k['lv'] = 1
    return K.soft(*a, **k)


FAB = (1.0, 1.0, 1.0)          # fabric: tinted in game
FAB2 = (0.78, 0.78, 0.78)      # seams / centre panels a shade darker
PLASTIC = (0.55, 0.55, 0.55)   # dark plastics: also tinted, so a beige car gets a beige-grey dash
BLACK, METAL, SCREEN = 0x111214, 0x9a9da2, 0x0b1016
BACK = 0.24                    # seat back recline (rad)


def seat_back(x, w, h, z0=0.0, y0=0.0, headrest=True):
    c, s = math.cos(BACK), math.sin(BACK)
    cy, cz = y0 + 0.02 + h / 2 * c, z0 - 0.06 - h / 2 * s
    S((w, h, 0.13), (x, cy, cz), FAB, rot=(-BACK, 0, 0), bev=0.35)
    # centre panel and side bolsters
    S((w * 0.56, h * 0.82, 0.03), (x, cy - 0.02, cz + 0.07 * c), FAB2, rot=(-BACK, 0, 0), bev=0.4, lv=1)
    for sx in (-1, 1):
        S((0.08, h * 0.8, 0.16), (x + sx * (w / 2 - 0.03), cy - 0.04, cz + 0.03), FAB, rot=(-BACK, 0, 0), bev=0.45, lv=1)
    if headrest:
        ty, tz = y0 + 0.02 + h * c, z0 - 0.06 - h * s
        for sx in (-1, 1):
            K.tube((x + sx * 0.07, ty - 0.02, tz), (x + sx * 0.07, ty + 0.08, tz - 0.02), 0.007, METAL, 6)
        S((0.26, 0.17, 0.1), (x, ty + 0.15, tz - 0.03), FAB, rot=(-BACK * 0.6, 0, 0), bev=0.45)


# ---------------------------------------------------------------- front seat
S((0.5, 0.12, 0.5), (0, -0.06, 0.25), FAB, rot=(-0.06, 0, 0), bev=0.35)
S((0.3, 0.02, 0.4), (0, 0.005, 0.25), FAB2, rot=(-0.06, 0, 0), bev=0.4, lv=1)
for sx in (-1, 1):
    S((0.08, 0.14, 0.46), (sx * 0.22, -0.03, 0.25), FAB, rot=(-0.06, 0, 0), bev=0.45, lv=1)
seat_back(0, 0.5, 0.66)
K.box((0.36, 0.16, 0.42), (0, -0.2, 0.22), PLASTIC, bevel=0.02)
for sx in (-1, 1):
    K.box((0.03, 0.03, 0.6), (sx * 0.16, -0.29, 0.2), METAL, bevel=0.004)
K.build('seat')

# ---------------------------------------------------------------- rear bench
S((1.3, 0.13, 0.48), (0, -0.065, 0.24), FAB, rot=(-0.05, 0, 0), bev=0.3)
for sx in (-0.33, 0.33):
    S((0.5, 0.015, 0.38), (sx, 0.002, 0.24), FAB2, rot=(-0.05, 0, 0), bev=0.4, lv=1)
seat_back(0, 1.3, 0.6, headrest=False)
for sx in (-0.4, 0.4):
    c, s = math.cos(BACK), math.sin(BACK)
    ty, tz = 0.02 + 0.6 * c, -0.06 - 0.6 * s
    S((0.26, 0.15, 0.09), (sx, ty + 0.1, tz - 0.02), FAB, rot=(-BACK * 0.6, 0, 0), bev=0.45)
K.box((1.3, 0.3, 0.46), (0, -0.28, 0.2), PLASTIC, bevel=0.02)
K.build('bench')

# ---------------------------------------------------------------- dashboard
S((1.5, 0.3, 0.5), (0, -0.15, 0.25), PLASTIC, taper=(1.0, 0.85), bev=0.3)
S((1.48, 0.04, 0.3), (0, 0.0, 0.3), PLASTIC, bev=0.4, lv=1)
# instrument hood and two dials on the driver's side (+x)
S((0.42, 0.09, 0.2), (0.38, 0.03, 0.06), PLASTIC, bev=0.4)
for dx in (-0.09, 0.09):
    K.cyl(0.055, 0.055, 0.01, (0.38 + dx, -0.04, -0.01), BLACK, seg=20, axis='z')
    K.cyl(0.05, 0.05, 0.004, (0.38 + dx, -0.04, -0.018), 0x2a3038, seg=20, axis='z')
# centre stack: screen, two vents, controls
K.box((0.3, 0.42, 0.06), (0, -0.25, 0.0), PLASTIC, bevel=0.015)
K.box((0.24, 0.14, 0.012), (0, -0.1, -0.034), SCREEN, bevel=0.003)
for dx in (-0.08, 0.08):
    K.box((0.1, 0.05, 0.012), (dx, -0.22, -0.034), BLACK, bevel=0.003)
for i in range(4):
    K.cyl(0.014, 0.014, 0.012, (-0.09 + i * 0.06, -0.33, -0.034), METAL, seg=10, axis='z')
# side vents and the glovebox seam
for dx in (-0.66, 0.66):
    K.box((0.12, 0.06, 0.012), (dx, -0.08, -0.004), BLACK, bevel=0.003)
K.box((0.36, 0.006, 0.01), (-0.38, -0.2, -0.003), BLACK, bevel=0)
K.build('dash')

# ---------------------------------------------------------------- steering wheel (in its own frame: plane facing -z, tilted)
TILT = -0.42
def wheel_pt(x, y, z):
    # rotate a point about x by TILT (wheel top leans toward the dash)
    c, s = math.cos(TILT), math.sin(TILT)
    return (x, y * c - z * s, y * s + z * c)
bpy.ops.mesh.primitive_torus_add(major_radius=0.18, minor_radius=0.017, major_segments=36, minor_segments=8, location=K.G(0, 0, 0), rotation=(TILT + math.pi / 2, 0, 0))
bpy.ops.object.shade_smooth()
K.finish(bpy.context.active_object, BLACK)
for a in (math.pi / 2 + 0.0, math.pi * 7 / 6 + 0.35, -math.pi / 6 - 0.35):
    pass
for ang in (-0.3, math.pi + 0.3, -math.pi / 2):
    K.tube(wheel_pt(0, 0, 0), wheel_pt(math.cos(ang) * 0.17, math.sin(ang) * 0.17, 0), 0.016, BLACK, 8)
K.cyl(0.06, 0.055, 0.05, (0, 0, 0.02), 0x1b1c1e, seg=20, axis='z')
o = K.parts[-1]
o.rotation_euler.x += TILT
K.tube(wheel_pt(0, 0, 0.03), wheel_pt(0, 0, 0.36), 0.035, BLACK, 12)
K.build('wheel')

# ---------------------------------------------------------------- centre console
S((0.22, 0.24, 0.62), (0, -0.12, -0.31), PLASTIC, bev=0.25)
K.box((0.16, 0.01, 0.2), (0, 0.002, -0.12), BLACK, bevel=0.002)
K.tube((0, 0.0, -0.14), (0, 0.08, -0.16), 0.008, METAL, 8)
S((0.04, 0.05, 0.05), (0, 0.09, -0.16), BLACK, bev=0.45, lv=1)
for dz in (-0.33, -0.41):
    K.cyl(0.035, 0.035, 0.012, (0, 0.001, dz), BLACK, seg=16, axis='y')
S((0.2, 0.06, 0.26), (0, 0.03, -0.52), FAB, bev=0.4)
K.build('console')

objs = [o for o in bpy.data.objects if o.name.startswith('int_')]
print('faces', {o.name: len(o.data.polygons) for o in objs})
if PREV:
    # lay them out as in a 1.8 m wide cabin for the preview
    lay = {'int_seat': (0.38, 0.6, 0.0), 'int_bench': (0, 0.62, -0.95), 'int_dash': (0, 0.95, 1.0), 'int_wheel': (0.38, 0.92, 0.65), 'int_console': (0, 0.55, 0.95)}
    extra = []
    for o in objs:
        o.location = K.G(*lay[o.name])
    s2 = objs[[o.name for o in objs].index('int_seat')].copy()
    s2.location = K.G(-0.38, 0.6, 0.0)
    bpy.context.scene.collection.objects.link(s2)
    K.render_preview(PREV, 'int', [], [('q', (-2.4, -2.4, 2.2), (0, 0, 0.7)), ('side', (-3.0, 0.2, 1.0), (0, 0.2, 0.75))])
    bpy.data.objects.remove(s2, do_unlink=True)
    for o in objs:
        o.location = (0, 0, 0)
K.export(OUT)
print('exported', OUT)
