"""Model and render the run-offs' ground tiles in Blender: a bed of crushed stone and a mown sward,
built as real geometry (every chipping, every blade), lit by an even sky and photographed from
straight above by an orthographic camera that frames exactly one tile. The geometry wraps (anything
near an edge is repeated across it), so the renders tile with no blending. Three renders each:
colour (the materials under the sky: albedo with the bed's own occlusion), the surface normal and the
height. tools/build_ground.py packs them for the trackside shaders.

  blender -b -P tools/blender/ground_bake.py -- gravel|grass <out dir> [size=1024]
"""
import sys, os, math
import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
KIND, OUT = argv[0], argv[1]
SIZE = int(argv[2]) if len(argv) > 2 else 1024
TILE = 1.3 if KIND == 'gravel' else 1.4  # metres: GRAVEL_TILE / GRASS_TILE (trackside/textures.ts)
rng = np.random.default_rng(7 if KIND == 'gravel' else 11)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def mesh_from(verts, faces_flat, loop_total, colors, name):
    """one mesh from numpy arrays (verts n×3, face corner indices, corners per face, per-corner RGBA)"""
    me = bpy.data.meshes.new(name)
    nf = len(faces_flat) // loop_total
    me.vertices.add(len(verts))
    me.vertices.foreach_set('co', verts.astype(np.float32).ravel())
    me.loops.add(len(faces_flat))
    me.loops.foreach_set('vertex_index', faces_flat.astype(np.int32))
    me.polygons.add(nf)
    me.polygons.foreach_set('loop_start', np.arange(nf, dtype=np.int32) * loop_total)
    me.polygons.foreach_set('loop_total', np.full(nf, loop_total, dtype=np.int32))
    me.update(calc_edges=True)
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    col.data.foreach_set('color', colors.astype(np.float32).ravel())
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def wrap(centres, reach):
    """indices and offsets of the copies that put everything near an edge across the opposite one"""
    idx, off = [np.arange(len(centres))], [np.zeros((len(centres), 2))]
    for ox in (-1, 0, 1):
        for oy in (-1, 0, 1):
            if ox == 0 and oy == 0:
                continue
            x, y = centres[:, 0] + ox * TILE, centres[:, 1] + oy * TILE
            m = (x > -reach) & (x < TILE + reach) & (y > -reach) & (y < TILE + reach)
            idx.append(np.nonzero(m)[0])
            off.append(np.tile([ox * TILE, oy * TILE], (m.sum(), 1)))
    return np.concatenate(idx), np.concatenate(off)


def rot_z(a):
    c, s = np.cos(a), np.sin(a)
    z, o = np.zeros_like(a), np.ones_like(a)
    return np.stack([np.stack([c, -s, z], -1), np.stack([s, c, z], -1), np.stack([z, z, o], -1)], -2)


def rot_axis(axis, a):
    """Rodrigues: n×3 unit axes, n angles → n×3×3"""
    x, y, z = axis[:, 0], axis[:, 1], axis[:, 2]
    c, s = np.cos(a), np.sin(a)
    C = 1 - c
    return np.stack([
        np.stack([c + x * x * C, x * y * C - z * s, x * z * C + y * s], -1),
        np.stack([y * x * C + z * s, c + y * y * C, y * z * C - x * s], -1),
        np.stack([z * x * C - y * s, z * y * C + x * s, c + z * z * C], -1)], -2)


# ------------------------------------------------------------------------------------------ gravel
def build_gravel():
    # a handful of chippings: an icosphere knocked about (broken faces, not river-worn pebbles)
    import bmesh
    protos = []
    for k in range(16):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1)
        v = np.array([p.co[:] for p in bm.verts])
        f = np.array([[q.index for q in face.verts] for face in bm.faces])
        bm.free()
        # facets: push the vertices in along a few random cutting planes, then a little jitter
        for _ in range(rng.integers(4, 8)):
            n = rng.normal(size=3)
            n /= np.linalg.norm(n)
            d = rng.uniform(0.35, 0.8)
            over = v @ n - d
            v -= np.outer(np.maximum(over, 0) * 0.9, n)
        v *= 1 + rng.normal(scale=0.06, size=(len(v), 1))
        v *= rng.uniform([0.75, 0.6, 0.45], [1.25, 1.0, 0.8])
        protos.append((v, f))
    nv, nf = len(protos[0][0]), len(protos[0][1])

    # three courses of stone: the lowest packs the bed, the upper ones lie loose on it
    centres, radius = [], []
    for z, n, r0, r1 in [(0.0, 9000, 0.007, 0.0125), (0.007, 7000, 0.0062, 0.0115), (0.014, 3500, 0.0055, 0.0105), (0.02, 900, 0.0045, 0.0085)]:
        # (jittered grid, so the bed is covered evenly rather than clumped as pure noise would be)
        g = int(math.ceil(math.sqrt(n)))
        ij = np.stack(np.meshgrid(np.arange(g), np.arange(g)), -1).reshape(-1, 2)[rng.permutation(g * g)[:n]]
        xy = (ij + rng.uniform(0, 1, size=(n, 2))) * (TILE / g)
        centres.append(np.concatenate([xy, z + rng.uniform(-0.002, 0.002, size=(n, 1))], 1))
        radius.append(rng.uniform(r0, r1, size=n) * rng.choice([1, 1, 1, 1.35], size=n))
    centres, radius = np.concatenate(centres), np.concatenate(radius)
    n = len(centres)
    which = rng.integers(0, len(protos), size=n)
    # every stone its own tumble
    ax = rng.normal(size=(n, 3))
    ax /= np.linalg.norm(ax, axis=1, keepdims=True)
    R = rot_axis(ax, rng.uniform(0, math.tau, size=n))
    # limestone: mostly pale grey, some warm buff, the odd dark flint and near-white chalk
    tone = rng.choice(4, size=n, p=[0.56, 0.27, 0.09, 0.08])
    base = np.array([[0.46, 0.45, 0.43], [0.5, 0.44, 0.36], [0.2, 0.2, 0.2], [0.68, 0.67, 0.64]])[tone]
    base = base * rng.uniform(0.82, 1.15, size=(n, 1)) * (1 + rng.normal(scale=0.025, size=(n, 3)))

    idx, off = wrap(centres, 0.03)
    PV = np.stack([p[0] for p in protos])  # 16 × nv × 3
    v = np.einsum('nij,nvj->nvi', R[idx], PV[which[idx]]) * radius[idx, None, None]
    v += centres[idx, None, :]
    v[:, :, :2] += off[:, None, :]
    PF = np.stack([p[1] for p in protos])
    faces = PF[which[idx]] + (np.arange(len(idx)) * nv)[:, None, None]
    cols = np.concatenate([np.repeat(base[idx], nf * 3, axis=0), np.ones((len(idx) * nf * 3, 1))], 1)
    ob = mesh_from(v.reshape(-1, 3), faces.reshape(-1), 3, cols, 'stones')

    mat = bpy.data.materials.new('stone')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'Col'
    # the stone's own grain: a fine speckle and a broader mottle, in object space
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 900
    noise.inputs['Detail'].default_value = 3
    mott = nt.nodes.new('ShaderNodeTexNoise')
    mott.inputs['Scale'].default_value = 160
    add = nt.nodes.new('ShaderNodeMath')
    add.operation = 'ADD'
    nt.links.new(noise.outputs['Fac'], add.inputs[0])
    nt.links.new(mott.outputs['Fac'], add.inputs[1])
    ramp = nt.nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Min'].default_value = 0.6
    ramp.inputs['From Max'].default_value = 1.4
    ramp.inputs['To Min'].default_value = 0.72
    ramp.inputs['To Max'].default_value = 1.22
    nt.links.new(add.outputs[0], ramp.inputs['Value'])
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1
    nt.links.new(attr.outputs['Color'], mul.inputs['A'])
    nt.links.new(ramp.outputs['Result'], mul.inputs['B'])
    nt.links.new(mul.outputs['Result'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.92
    ob.data.materials.append(mat)
    # the dust and fines under the stones
    floor(-0.006, (0.3, 0.285, 0.26))
    return -0.006, 0.034


# ------------------------------------------------------------------------------------------- grass
def build_grass():
    SEG = 5
    n = 150000
    # tufts: blades grow in clumps round crowns, the crowns spread evenly over the ground
    crowns = 9000
    g = int(math.ceil(math.sqrt(crowns)))
    ij = np.stack(np.meshgrid(np.arange(g), np.arange(g)), -1).reshape(-1, 2)[rng.permutation(g * g)[:crowns]]
    cxy = (ij + rng.uniform(0, 1, size=(crowns, 2))) * (TILE / g)
    c = rng.integers(0, crowns, size=n)
    root = (cxy[c] + rng.normal(scale=0.007, size=(n, 2))) % TILE
    # a patchy sward: longer and lusher in places, thinner and drier in others (smooth, wrapping fields)
    def field(freq, seed):
        r = np.random.default_rng(seed)
        out = np.zeros(n)
        for fx in range(-freq, freq + 1):
            for fy in range(-freq, freq + 1):
                if fx == 0 and fy == 0:
                    continue
                out += r.normal() / math.hypot(fx, fy) * np.cos(math.tau * (fx * root[:, 0] + fy * root[:, 1]) / TILE + r.uniform(0, math.tau))
        return out / (np.abs(out).max() + 1e-9)
    lush, dry = field(3, 1), field(4, 2)
    length = rng.uniform(0.03, 0.058, size=n) * (1 + 0.22 * lush)
    width = rng.uniform(0.0028, 0.0052, size=n)
    # mown turf lies every way: each blade leans out from its crown and curls over
    head = rng.uniform(0, math.tau, size=n)
    lean = rng.uniform(0.25, 1.05, size=n)
    curl = rng.uniform(0.3, 1.1, size=n)
    t = np.linspace(0, 1, SEG + 1)
    # the blade's spine in its own plane (u outward, w up), bending as it rises
    ang = lean[:, None] + curl[:, None] * t[None, :]
    du = np.sin(ang) * (length[:, None] / SEG)
    dw = np.cos(ang) * (length[:, None] / SEG)
    u = np.concatenate([np.zeros((n, 1)), np.cumsum(du[:, :-1], 1)], 1)
    w = np.concatenate([np.zeros((n, 1)), np.cumsum(dw[:, :-1], 1)], 1)
    w = np.maximum(w, 0.001)
    half = width[:, None] * 0.5 * (1 - t[None, :] ** 2.2 * 0.92)
    # a slight twist along the blade, so they catch the light differently
    tw = rng.uniform(-0.9, 0.9, size=n)[:, None] * t[None, :]
    ch, sh = np.cos(head)[:, None], np.sin(head)[:, None]
    sx, sy = -sh, ch  # across the blade
    px = root[:, 0:1] + u * ch
    py = root[:, 1:2] + u * sh
    ox, oy, oz = sx * np.cos(tw) * half, sy * np.cos(tw) * half, np.sin(tw) * half
    left = np.stack([px - ox, py - oy, w - oz], -1)
    right = np.stack([px + ox, py + oy, w + oz], -1)
    v = np.stack([left, right], 2)  # n × (SEG+1) × 2 × 3
    # colour: a living green, yellower and paler toward the tip, darker at the base; some dry straw
    hue = rng.uniform(0, 1, size=n)
    green = np.stack([0.06 + 0.08 * hue, 0.17 + 0.11 * hue, 0.025 + 0.03 * hue], -1) * (1 + 0.22 * lush[:, None]) * rng.uniform(0.75, 1.2, size=(n, 1))
    straw = np.array([0.36, 0.3, 0.12])
    isdry = (rng.uniform(0, 1, size=n) < 0.05 + 0.1 * np.clip(dry, 0, 1))[:, None]
    blade = np.where(isdry, straw * rng.uniform(0.7, 1.1, size=(n, 1)), green)
    grad = (0.45 + 0.75 * t)[None, :, None] * np.array([1.0, 1.0, 0.9])[None, None, :]
    tipy = 1 + (t ** 2)[None, :, None] * np.array([0.25, 0.1, -0.1])[None, None, :]
    vc = blade[:, None, :] * grad * tipy  # n × (SEG+1) × 3

    idx, off = wrap(np.concatenate([root, np.zeros((n, 1))], 1), 0.07)
    vv = v[idx].copy()
    vv[..., 0] += off[:, None, None, 0]
    vv[..., 1] += off[:, None, None, 1]
    m = len(idx)
    per = (SEG + 1) * 2
    base = (np.arange(m) * per)[:, None]
    k = np.arange(SEG)[None, :] * 2
    quads = np.stack([base + k, base + k + 1, base + k + 3, base + k + 2], -1)  # m × SEG × 4
    seg_of = np.array([0, 0, 1, 1])[None, None, :] + np.arange(SEG)[None, :, None]
    cols = vc[idx][np.arange(m)[:, None, None], seg_of]  # m × SEG × 4 × 3
    cols = np.concatenate([cols, np.ones(cols.shape[:-1] + (1,))], -1)
    ob = mesh_from(vv.reshape(-1, 3), quads.reshape(-1), 4, cols.reshape(-1, 4), 'blades')
    for p in ob.data.polygons:
        p.use_smooth = True

    mat = bpy.data.materials.new('blade')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.55
    # thin leaves: light comes through them
    if 'Transmission Weight' in bsdf.inputs:
        pass
    ob.data.materials.append(mat)
    # thatch and soil between the crowns
    floor(0.0, (0.05, 0.055, 0.025))
    return 0.0, 0.05


def floor(z, colour):
    bpy.ops.mesh.primitive_plane_add(size=TILE * 3, location=(TILE / 2, TILE / 2, z))
    mat = bpy.data.materials.new('floor')
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*colour, 1)
    b.inputs['Roughness'].default_value = 1
    bpy.context.object.data.materials.append(mat)


z0, z1 = build_gravel() if KIND == 'gravel' else build_grass()

# ---------------------------------------------------------------------------------- camera + render
cam = bpy.data.cameras.new('cam')
cam.type = 'ORTHO'
cam.ortho_scale = TILE
cam.clip_start, cam.clip_end = 0.1, 10
co = bpy.data.objects.new('cam', cam)
co.location = (TILE / 2, TILE / 2, 2)  # looking down −Z, +Y up the picture
scene.collection.objects.link(co)
scene.camera = co

world = bpy.data.worlds.new('sky')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1
scene.world = world

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print('GPU unavailable, rendering on the CPU:', e)
scene.cycles.use_denoising = False
scene.cycles.max_bounces = 4
scene.cycles.diffuse_bounces = 3
scene.cycles.filter_width = 1.2
scene.render.resolution_x = scene.render.resolution_y = SIZE
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.image_settings.color_depth = '16'
scene.display_settings.display_device = 'sRGB'
scene.view_settings.look = 'None'
os.makedirs(OUT, exist_ok=True)


def render(name, samples, transform):
    scene.view_settings.view_transform = transform
    scene.cycles.samples = samples
    scene.render.filepath = os.path.join(OUT, f'{KIND}_{name}.png')
    bpy.ops.render.render(write_still=True)


# 1: colour, under the even sky (the occlusion between stones / blades is part of the picture)
render('colour', 192, 'Standard')

# 2 and 3: the surface's normal and height, as emission (raw data, no lighting)
def data_material(kind):
    mat = bpy.data.materials.new(kind)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    if kind == 'normal':
        # (the shading normal faces the camera on both sides of a blade)
        m = nt.nodes.new('ShaderNodeVectorMath')
        m.operation = 'MULTIPLY_ADD'
        m.inputs[1].default_value = (0.5, 0.5, 0.5)
        m.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(geo.outputs['Normal'], m.inputs[0])
        nt.links.new(m.outputs[0], em.inputs['Color'])
    else:
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = z0
        mr.inputs['From Max'].default_value = z1
        nt.links.new(geo.outputs['Position'], sep.inputs[0])
        nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
        nt.links.new(mr.outputs['Result'], em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return mat


world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0
for kind in ('normal', 'height'):
    scene.view_layers[0].material_override = data_material(kind)
    render(kind, 24, 'Raw')
print('done', KIND)
