# Blender (headless) stage 1: assemble photographed Poly Haven sprigs/leaves (CC0) into dense foliage
# "cards" and render them to a texture atlas (albedo+alpha and tangent-space normals).
#
#   blender -b --factory-startup -P tools/trees/build_cards.py -- <src_dir> <out_dir>
#
# Atlas: 2048 x 1024, four 512 x 1024 cells (branch base at the bottom, tip at the top):
#   0 fir spray, 1 pine tuft branch, 2 broadleaf leaf cluster, 3 palm frond
import bpy, bmesh, sys, os, math, random, json
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
os.makedirs(OUT, exist_ok=True)
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 24
scene.cycles.use_denoising = False
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.world = bpy.data.worlds.new('w')
scene.world.color = (0, 0, 0)

def load(name, colorspace):
    img = bpy.data.images.load(os.path.join(SRC, name))
    img.colorspace_settings.name = colorspace
    return img

# ---------------------------------------------------------------- sprig detection
def components(alpha_img, min_px=1500, keep=lambda b: True):
    """Connected components of the alpha map (downsampled) -> list of UV boxes (u0, v0, u1, v1)."""
    w, h = alpha_img.size
    px = np.array(alpha_img.pixels[:], dtype=np.float32).reshape(h, w, alpha_img.channels)[:, :, 0]
    s = 4
    a = px[::s, ::s] > 0.35
    H, W = a.shape
    lab = np.zeros(a.shape, np.int32)
    boxes = []
    n = 0
    for y in range(H):
        for x in range(W):
            if a[y, x] and not lab[y, x]:
                n += 1
                stack = [(y, x)]
                lab[y, x] = n
                x0 = x1 = x; y0 = y1 = y; cnt = 0
                while stack:
                    cy, cx = stack.pop(); cnt += 1
                    x0 = min(x0, cx); x1 = max(x1, cx); y0 = min(y0, cy); y1 = max(y1, cy)
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < H and 0 <= nx < W and a[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n; stack.append((ny, nx))
                if cnt * s * s >= min_px:
                    b = ((x0 - 1) / W, (y0 - 1) / H, (x1 + 2) / W, (y1 + 2) / H, cnt)
                    if keep(b):
                        boxes.append(b)
    return boxes

def masked_alpha(alpha_img, keep, min_px=1500, name='masked'):
    """New alpha image keeping only pixels of the selected components (removes neighbouring atlas
    content that would otherwise bleed into a sprig's bounding box)."""
    w, h = alpha_img.size
    px = np.array(alpha_img.pixels[:], dtype=np.float32).reshape(h, w, alpha_img.channels)[:, :, 0]
    s = 4
    a = px[::s, ::s] > 0.2
    H, W = a.shape
    lab = np.zeros(a.shape, np.int32)
    keepmask = np.zeros(a.shape, bool)
    n = 0
    for y in range(H):
        for x in range(W):
            if a[y, x] and not lab[y, x]:
                n += 1
                stack = [(y, x)]; lab[y, x] = n; cells = []
                x0 = x1 = x; y0 = y1 = y
                while stack:
                    cy, cx = stack.pop(); cells.append((cy, cx))
                    x0 = min(x0, cx); x1 = max(x1, cx); y0 = min(y0, cy); y1 = max(y1, cy)
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < H and 0 <= nx < W and a[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n; stack.append((ny, nx))
                b = ((x0 - 1) / W, (y0 - 1) / H, (x1 + 2) / W, (y1 + 2) / H, len(cells))
                if len(cells) * s * s >= min_px and keep(b):
                    for cy, cx in cells: keepmask[cy, cx] = True
    # dilate one cell so edges survive, then upsample to full resolution
    k = keepmask.copy()
    k[1:, :] |= keepmask[:-1, :]; k[:-1, :] |= keepmask[1:, :]; k[:, 1:] |= keepmask[:, :-1]; k[:, :-1] |= keepmask[:, 1:]
    full = np.repeat(np.repeat(k, s, 0), s, 1)[:h, :w]
    out = px * full
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    rgba = np.stack([out, out, out, np.ones_like(out)], -1)
    img.pixels[:] = rgba.ravel()
    return img

# ---------------------------------------------------------------- materials
def card_material(name, diff, alpha, nor, mode):
    """mode 'albedo': emit texture colour; mode 'normal': emit world normal (for a top-down camera
    this is the tangent-space normal of the card)."""
    m = bpy.data.materials.new(f'{name}_{mode}')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    uv = nt.nodes.new('ShaderNodeTexCoord')
    td = nt.nodes.new('ShaderNodeTexImage'); td.image = diff
    ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = alpha
    for t in (td, ta): nt.links.new(uv.outputs['UV'], t.inputs['Vector'])
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'shade'
    em = nt.nodes.new('ShaderNodeEmission')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    if mode == 'albedo':
        mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        nt.links.new(td.outputs['Color'], mul.inputs['A'])
        nt.links.new(vc.outputs['Color'], mul.inputs['B'])
        nt.links.new(mul.outputs['Result'], em.inputs['Color'])
    else:
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nor
        nt.links.new(uv.outputs['UV'], tn.inputs['Vector'])
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        # world normal -> [0,1] colour
        vm = nt.nodes.new('ShaderNodeVectorMath'); vm.operation = 'MULTIPLY_ADD'
        vm.inputs[1].default_value = (0.5, 0.5, 0.5); vm.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(nm.outputs['Normal'], vm.inputs[0])
        nt.links.new(vm.outputs['Vector'], em.inputs['Color'])
    nt.links.new(ta.outputs['Color'], mix.inputs['Fac'])
    nt.links.new(tr.outputs['BSDF'], mix.inputs[1])
    nt.links.new(em.outputs['Emission'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    return m

# ---------------------------------------------------------------- card geometry
def add_quad(bm, uvl, shl, center, axis_len, width, angle, uvbox, shade, z, flip=False, bend=0.0):
    """A quad whose texture 'up' (v increasing) runs along `angle` in the XY plane from `center`."""
    u0, v0, u1, v1 = uvbox[:4]
    d = Vector((math.cos(angle), math.sin(angle), 0))
    n = Vector((-d.y, d.x, 0))
    if flip: n = -n
    base = Vector((center[0], center[1], z))
    pts = [base - n * width / 2, base + n * width / 2, base + n * width / 2 + d * axis_len, base - n * width / 2 + d * axis_len]
    pts[2].z += bend; pts[3].z += bend
    vs = [bm.verts.new(p) for p in pts]
    f = bm.faces.new(vs)
    # component boxes come from Blender pixel rows, which start at the bottom like UV v
    uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    for loop, uvc in zip(f.loops, uvs):
        loop[uvl].uv = uvc
        loop[shl] = (shade, shade, shade, 1.0)
    return f

def build_card(name, parts, diff, alpha, nor):
    """parts: list of (center, len, width, angle, uvbox, shade, z)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    shl = bm.loops.layers.color.new('shade')
    for p in parts: add_quad(bm, uvl, shl, *p)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob['mats'] = [card_material(name, diff, alpha, nor, 'albedo').name, card_material(name, diff, alpha, nor, 'normal').name]
    return ob

# ---------------------------------------------------------------- layouts (cell space: x in [-0.5,0.5], y in [0, 2])
def img_box_aspect(b):
    return (b[2] - b[0]) / max(1e-6, b[3] - b[1])

def fir_spray(boxes):
    """Flat, feathery fir branch: a fishbone of sprigs along a main axis."""
    parts = []
    big = sorted(boxes, key=lambda b: -(b[2] - b[0]) * (b[3] - b[1]))
    L = 1.9
    k = 0
    # side sprigs, both sides, shrinking to the tip
    for i in range(16):
        t = i / 15
        y = 0.1 + t * (L - 0.35)
        size = 0.62 * (1 - t * 0.55) * random.uniform(0.85, 1.1)
        for side in (-1, 1):
            b = big[k % len(big)]; k += 1
            ang = math.pi / 2 + side * random.uniform(0.75, 1.05)
            w = size * img_box_aspect(b)
            parts.append(((0.0, y), size, w, ang, b, random.uniform(0.62, 0.9), 0.01 * i + random.uniform(0, 0.005)))
    # sprigs along the spine and the tip
    for i in range(9):
        t = i / 8
        b = big[(k + i) % 3]
        size = 0.55 * (1 - t * 0.4)
        parts.append(((random.uniform(-0.03, 0.03), 0.05 + t * (L - 0.55)), size, size * img_box_aspect(b), math.pi / 2 + random.uniform(-0.25, 0.25), b, random.uniform(0.85, 1.0), 0.3 + 0.01 * i))
    return parts

def pine_branch(boxes):
    """Pine: long tufts of needles fanning out along the branch."""
    parts = []
    b0 = sorted(boxes, key=lambda b: -(b[2] - b[0]) * (b[3] - b[1]))
    for i in range(22):
        t = i / 21
        y = 0.05 + t * 1.45
        b = b0[i % len(b0)]
        size = random.uniform(0.45, 0.62) * (1 - t * 0.2)
        ang = math.pi / 2 + random.uniform(-1.0, 1.0)
        parts.append(((random.uniform(-0.05, 0.05), y), size, size * img_box_aspect(b), ang, b, random.uniform(0.6, 1.0), 0.01 * i))
    # terminal tuft
    for i in range(6):
        b = b0[i % len(b0)]
        parts.append(((0, 1.35), 0.55, 0.55 * img_box_aspect(b), math.pi / 2 + (i - 2.5) * 0.35, b, 0.95, 0.3 + i * 0.01))
    return parts

def leaf_cluster(boxes):
    """Broadleaf branchlet: three twigs fanning from the base, leaves alternating along each twig,
    angled forward, shrinking to the tips, plus terminal leaves. Deeper leaves are darker."""
    parts = []
    twigs = [(-0.3, 1.45), (-0.1, 1.75), (0.12, 1.7), (0.3, 1.4)]  # (angle from vertical, length)
    for ti, (tang, tlen) in enumerate(twigs):
        base = Vector((0.0, 0.05, 0))
        d = Vector((math.sin(tang), math.cos(tang), 0))
        n = 18
        for i in range(n):
            t = (i + 1) / (n + 1)
            p = base + d * (t * tlen)
            side = 1 if i % 2 else -1
            b = boxes[(i + ti * 3) % len(boxes)]
            size = (0.34 - t * 0.1) * random.uniform(0.88, 1.08)
            ang = math.atan2(d.y, d.x) + side * random.uniform(0.7, 1.05)
            depth = 0.55 + 0.45 * t
            parts.append(((p.x, p.y), size, size * img_box_aspect(b), ang, b, depth * random.uniform(0.82, 1.0), 0.01 * i + ti * 0.002))
        # terminal leaves
        tip = base + d * tlen
        for k in range(3):
            b = boxes[(k + ti) % len(boxes)]
            size = 0.28
            parts.append(((tip.x - d.x * 0.25, tip.y - d.y * 0.25), size, size * img_box_aspect(b), math.atan2(d.y, d.x) + (k - 1) * 0.45, b, random.uniform(0.9, 1.0), 0.2 + k * 0.01))
    return parts

def palm_frond(boxes):
    """Pinnate palm frond: narrow leaflets along a curved rachis."""
    parts = []
    for i in range(34):
        t = i / 33
        y = 0.08 + t * 1.8
        xoff = math.sin(t * 1.2) * 0.05
        size = 0.55 * math.sin(math.pi * (0.15 + t * 0.8)) + 0.12
        for side in (-1, 1):
            b = boxes[(i * 2 + (side > 0)) % len(boxes)]
            ang = math.pi / 2 + side * (1.15 - t * 0.5)
            parts.append(((xoff, y), size, size * img_box_aspect(b) * 0.38, ang, b, random.uniform(0.7, 1.0), 0.01 * i))
    return parts

# ---------------------------------------------------------------- render
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.0  # height 2 (y in [0,2]); resolution 512x1024 -> width 1
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.location = (0, 1.0, 5)
cam.rotation_euler = (0, 0, 0)
scene.render.resolution_x = 512
scene.render.resolution_y = 1024

def render(ob, mode, path):
    for o in scene.objects:
        if o.type == 'MESH': o.hide_render = o is not ob
    ob.data.materials.clear()
    ob.data.materials.append(bpy.data.materials[ob['mats'][0 if mode == 'albedo' else 1]])
    scene.view_settings.view_transform = 'Standard' if mode == 'albedo' else 'Raw'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

fir_d = load('fir_tree_01__twig_diff.png', 'sRGB'); fir_a = load('fir_tree_01__twig_alpha.png', 'Non-Color'); fir_n = load('fir_tree_01__twig_nor_gl.png', 'Non-Color')
pin_d = load('pine_tree_01__twig_diff.png', 'sRGB'); pin_a0 = load('pine_tree_01__twig_alpha.png', 'Non-Color'); pin_n = load('pine_tree_01__twig_nor_gl.png', 'Non-Color')
lea_d = load('island_tree_01__leaves_diff.png', 'sRGB'); lea_a = load('island_tree_01__leaves_alpha.png', 'Non-Color'); lea_n = load('island_tree_01__leaves_nor_gl.png', 'Non-Color')

# fir sprigs: skip the bark strip on the left and the twigs along the bottom
fir_boxes = components(fir_a, keep=lambda b: b[1] > 0.15 and (b[3] - b[1]) < 0.5 and b[4] > 400)
# pine sprigs: the two needle sprays (top-left and middle-right); skip cones/bark
pin_keep = lambda b: b[4] > 3000 and (b[2] - b[0]) * (b[3] - b[1]) < 0.2
pin_a = masked_alpha(pin_a0, pin_keep, min_px=4000, name='pine_mask')
pin_boxes = components(pin_a0, min_px=4000, keep=lambda b: b[4] > 3000 and (b[2] - b[0]) * (b[3] - b[1]) < 0.2)
lea_boxes = components(lea_a, min_px=4000)
print('boxes', len(fir_boxes), len(pin_boxes), len(lea_boxes))
json.dump({'fir': fir_boxes, 'pine': pin_boxes, 'leaves': lea_boxes}, open(os.path.join(OUT, 'boxes.json'), 'w'))

cards = [
    ('fir', fir_spray(fir_boxes), fir_d, fir_a, fir_n),
    ('pine', pine_branch(pin_boxes), pin_d, pin_a, pin_n),
    ('leaves', leaf_cluster(lea_boxes), lea_d, lea_a, lea_n),
    ('palm', palm_frond(lea_boxes), lea_d, lea_a, lea_n),
]
for name, parts, d, a, n in cards:
    ob = build_card(name, parts, d, a, n)
    render(ob, 'albedo', os.path.join(OUT, f'card_{name}_albedo.png'))
    render(ob, 'normal', os.path.join(OUT, f'card_{name}_normal.png'))
print('done')
