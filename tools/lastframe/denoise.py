"""Blender: runs Open Image Denoise over the baked lightmap.  blender -b --python denoise.py -- OUTDIR"""
import bpy, sys, numpy as np
OUT = sys.argv[sys.argv.index('--') + 1]
NAME = sys.argv[sys.argv.index('--') + 2] if len(sys.argv) > sys.argv.index('--') + 2 else 'lightmap'
bpy.ops.wm.read_factory_settings(use_empty=True)
s = bpy.context.scene
img = bpy.data.images.load(f'{OUT}/{NAME}.exr')
W, H = img.size
s.render.resolution_x, s.render.resolution_y, s.render.resolution_percentage = W, H, 100
ng = bpy.data.node_groups.new('c', 'CompositorNodeTree')
s.compositing_node_group = ng
n = ng.nodes
i = n.new('CompositorNodeImage'); i.image = img
d = n.new('CompositorNodeDenoise')
print([x.name for x in d.inputs], [x.identifier for x in d.inputs])
ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
g = n.new('NodeGroupOutput')
ng.links.new(i.outputs['Image'], d.inputs['Image'])
ng.links.new(d.outputs[0], g.inputs[0])
s.render.image_settings.file_format = 'OPEN_EXR'
s.render.image_settings.color_depth = '32'
s.render.filepath = f'{OUT}/dn_{NAME}.exr'
s.render.use_compositing = True
s.render.use_sequencer = False
s.render.dither_intensity = 0
s.view_settings.view_transform = 'Raw' if 'Raw' in [e.identifier for e in type(s.view_settings).bl_rna.properties['view_transform'].enum_items] else 'Standard'
bpy.ops.render.render(write_still=True)
r = bpy.data.images.load(f'{OUT}/dn_{NAME}.exr')
px = np.empty(W * H * 4, np.float32); r.pixels.foreach_get(px)
px = px.reshape(H, W, 4)[..., :3]
print('dn mean', px.mean(), 'max', px.max())
np.save(f'{OUT}/{NAME}.npy', px.astype(np.float16))
