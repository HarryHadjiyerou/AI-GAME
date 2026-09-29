# Blender (headless) stage 2: build tree species from bark tubes + photographic foliage cards, export
# game-ready GLBs (height normalised to 1, Y up) and collision data for the titans.
#
#   blender -b --factory-startup -P tools/trees/build_trees.py -- <out_dir> [preview_dir]
#
# Each GLB has two primitives with placeholder materials named "bark" and "foliage". The game supplies
# the textures: bark_<species>.jpg and the foliage atlas (4 cells: fir, pine, leaves, palm).
# Vertex colour COLOR_0 carries baked crown ambient occlusion.
import bpy, bmesh, sys, os, math, random, json
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
PREVIEW = argv[1] if len(argv) > 1 else None
os.makedirs(OUT, exist_ok=True)

LOD1_FRAC = 0.35
CELL = {'fir': 0, 'pine': 1, 'leaves': 2, 'palm': 3}
UP = Vector((0, 0, 1))


def clamp(v, a, b):
    return a if v < a else b if v > b else v


def enc(v):
    """Byte colour layers hold sRGB and the glTF exporter linearises them: pre-encode so COLOR_0 == v."""
    return 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055


class Tree:
    def __init__(self, name, seed):
        self.name = name
        self.rng = random.Random(seed)
        self.bark = self._bm()
        self.bark1 = self._bm()   # LOD1 wood: only the tubes flagged lod1, with fewer sides
        self.bark_normals = []    # custom normals per loop (in face order)
        self.bark1_normals = []
        self.cards = []           # recorded foliage cards, emitted per LOD at export
        self.caps = []    # collision capsules (a, b, r)
        self.spheres = []  # leaf clump spheres (c, r)
        self.crown = (Vector((0, 0, 0.6)), 0.3, 0.3)  # centre, radius xy, radius z (for AO/normals)
        self.ao_min = 0.3
        self.normal_up = 0.35  # upward bias of the volumetric foliage normals

    @staticmethod
    def _bm():
        bm = bmesh.new()
        bm.loops.layers.uv.new('UVMap')
        bm.loops.layers.color.new('Col')
        return bm

    # ------------------------------------------------------------------ bark tubes
    def tube(self, pts, radii, sides=8, uv_scale=1.0, flare=0.0, collide=True, lod1=True):
        self._tube(self.bark, self.bark_normals, pts, radii, sides, uv_scale, flare)
        if lod1:
            self._tube(self.bark1, self.bark1_normals, pts, radii, max(3, sides // 2 + 1), uv_scale, flare)
        if collide:
            for i in range(len(pts) - 1):
                self.caps.append((pts[i].copy(), pts[i + 1].copy(), (radii[i] + radii[i + 1]) / 2))

    def _tube(self, bm, normals, pts, radii, sides, uv_scale, flare):
        uvl = bm.loops.layers.uv['UVMap']; col = bm.loops.layers.color['Col']
        rings = []
        # parallel-transport frames along the path
        t0 = (pts[1] - pts[0]).normalized()
        ref = Vector((1, 0, 0)) if abs(t0.x) < 0.9 else Vector((0, 1, 0))
        n = t0.cross(ref).normalized()
        vlen = 0.0
        lengths = [0.0]
        for i in range(1, len(pts)):
            lengths.append(lengths[-1] + (pts[i] - pts[i - 1]).length)
        circ = max(radii) * math.tau
        for i, p in enumerate(pts):
            if i < len(pts) - 1:
                t = (pts[i + 1] - p).normalized()
            else:
                t = (p - pts[i - 1]).normalized()
            n = (n - t * n.dot(t)).normalized()
            b = t.cross(n)
            r = radii[i]
            ring = []
            for s in range(sides + 1):
                a = s / sides * math.tau
                rr = r
                if flare and i < 3:
                    rr *= 1 + flare * (1 - i / 3) * (0.7 + 0.3 * math.sin(a * 5 + 1.3))
                off = n * math.cos(a) * rr + b * math.sin(a) * rr
                ring.append((p + off, off.normalized(), (s / sides * max(1, round(circ / 0.05)) * 0.25 * uv_scale, lengths[i] / max(circ, 1e-4) * 0.25 * uv_scale)))
            rings.append(ring)
        vert_rings = [[bm.verts.new(v[0]) for v in ring] for ring in rings]
        for i in range(len(rings) - 1):
            for s in range(sides):
                vs = [vert_rings[i][s], vert_rings[i][s + 1], vert_rings[i + 1][s + 1], vert_rings[i + 1][s]]
                data = [rings[i][s], rings[i][s + 1], rings[i + 1][s + 1], rings[i + 1][s]]
                try:
                    f = bm.faces.new(vs)
                except ValueError:
                    continue
                for loop, d in zip(f.loops, data):
                    loop[uvl].uv = d[2]
                    ao = self.ao(d[0], wood=True)
                    e = enc(ao); loop[col] = (e, e, e, 1.0)
                    normals.append(d[1])

    # ------------------------------------------------------------------ foliage cards
    def card(self, base, direction, length, width, cell, tilt=0.0, droop=0.0, flat_normal=0.0, v=(0.0, 1.0), keep=None):
        """Record a quad from `base` along `direction` (card's up = texture v), rolled by `tilt`.
        `keep` (0..1) ranks the card for LOD1 thinning; cards sharing a value are kept or dropped together."""
        self.cards.append((base.copy(), direction.copy(), length, width, cell, tilt, droop, flat_normal, v,
                           self.rng.random() if keep is None else keep))

    def emit_cards(self, bm, normals, frac):
        k = frac ** -0.5
        for (base, d, L, W, cell, tilt, droop, fl, v, keep) in self.cards:
            if keep > frac:
                continue
            if frac < 1:
                # grow the survivors so the crown keeps its coverage; pull the base back so they stay centred
                base = base - d.normalized() * L * (k - 1) * 0.5
                L, W = L * k, W * k
            self._card(bm, normals, base, d, L, W, cell, tilt, droop, fl, v)

    def _card(self, bm, normals, base, direction, length, width, cell, tilt, droop, flat_normal, v):
        uvl = bm.loops.layers.uv['UVMap']; col = bm.loops.layers.color['Col']
        d = direction.normalized()
        side = d.cross(UP)
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
        side.normalize()
        side = Quaternion(d, tilt) @ side
        tip = base + d * length + Vector((0, 0, -droop * length))
        mid = base.lerp(tip, 0.5)
        pts = [base - side * width * 0.5, base + side * width * 0.5, tip + side * width * 0.5, tip - side * width * 0.5]
        u0, u1 = cell * 0.25 + 0.002, (cell + 1) * 0.25 - 0.002
        uvs = [(u0, v[0]), (u1, v[0]), (u1, v[1]), (u0, v[1])]
        vs = [bm.verts.new(p) for p in pts]
        f = bm.faces.new(vs)
        fn = (pts[1] - pts[0]).cross(pts[3] - pts[0]).normalized()
        if fn.z < 0:
            fn = -fn
        c, rxy, rz = self.crown
        for loop, p, uv in zip(f.loops, pts, uvs):
            loop[uvl].uv = uv
            ao = self.ao(p)
            e = enc(ao); loop[col] = (e, e, e, 1.0)
            # soft volumetric normals: point away from the crown centre, blended with the card normal
            rad = Vector(((p.x - c.x) / rxy, (p.y - c.y) / rxy, (p.z - c.z) / rz * 0.7 + self.normal_up)).normalized()
            normals.append(rad.lerp(fn, flat_normal).normalized())
        return f

    def ao(self, p, wood=False):
        """Cheap crown occlusion: darker towards the inside and the bottom of the crown."""
        c, rxy, rz = self.crown
        dx = math.hypot(p.x - c.x, p.y - c.y) / max(rxy, 1e-3)
        dz = (p.z - (c.z - rz)) / max(2 * rz, 1e-3)
        inside = clamp(1 - dx, 0, 1) * clamp(1.2 - abs(p.z - c.z) / max(rz, 1e-3), 0, 1)
        v = 1.0 - 0.55 * inside - 0.25 * clamp(1 - dz, 0, 1)
        if wood:
            v = min(v, 0.55 + 0.45 * clamp(dx, 0, 1)) if p.z > c.z - rz else v
        return clamp(v, self.ao_min, 1.0)

    # ------------------------------------------------------------------ export
    def build_object(self, bm, normals, name, obname=None):
        me = bpy.data.meshes.new(obname or name)
        bm.to_mesh(me)
        me.normals_split_custom_set([n[:] for n in normals]) if len(normals) == len(me.loops) else None
        ob = bpy.data.objects.new(obname or name, me)
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        me.materials.append(mat)
        return ob

    def export(self):
        coll = bpy.data.collections.new(self.name)
        bpy.context.scene.collection.children.link(coll)
        fol0, n0, fol1, n1 = self._bm(), [], self._bm(), []
        self.emit_cards(fol0, n0, 1.0)
        self.emit_cards(fol1, n1, LOD1_FRAC)
        obs = [self.build_object(self.bark, self.bark_normals, 'bark'), self.build_object(fol0, n0, 'foliage'),
               self.build_object(self.bark1, self.bark1_normals, 'bark', 'bark_lod1'), self.build_object(fol1, n1, 'foliage', 'foliage_lod1')]
        bark, fol = obs[0], obs[1]
        for ob in obs:
            coll.objects.link(ob)
        # normalise height to 1
        zmax = max(max((v.co.z for v in ob.data.vertices), default=0) for ob in (bark, fol))
        s = 1.0 / zmax
        for ob in obs:
            ob.data.transform(Matrix.Scale(s, 4))
        self.scale = s
        bpy.ops.object.select_all(action='DESELECT')
        for ob in obs:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = bark
        path = os.path.join(OUT, f'tree_{self.name}.glb')
        bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_materials='PLACEHOLDER',
                                  export_normals=True, export_vertex_color='ACTIVE', export_attributes=False, export_yup=True,
                                  export_apply=False, export_texcoords=True)
        tris = sum(len(p.vertices) - 2 for ob in (bark, fol) for p in ob.data.polygons)
        tris1 = sum(len(p.vertices) - 2 for ob in obs[2:] for p in ob.data.polygons)
        rxy = max(math.hypot(v.co.x, v.co.y) for ob in (bark, fol) for v in ob.data.vertices)
        info = {'tris': tris, 'tris_lod1': tris1, 'radius': rxy, 'file': os.path.basename(path)}
        if self.caps:
            # collision in glTF space (Y up): (x, z, -y) swizzle, scaled
            sw = lambda v: [v.x * s, v.z * s, -v.y * s]
            info['caps'] = [sw(a) + sw(b) + [r * s] for a, b, r in self.caps]
            info['spheres'] = [sw(c) + [r * s] for c, r in self.spheres]
        self.coll = coll
        return info


def inside(t, p, k):
    """Pull a point back inside `k` x the crown ellipsoid (only if it lies above the crown centre's base)."""
    c, rxy, rz = t.crown
    q = Vector(((p.x - c.x) / rxy, (p.y - c.y) / rxy, (p.z - c.z) / rz))
    if q.length <= k or p.z < c.z - rz:
        return p
    q = q / q.length * k
    return Vector((c.x + q.x * rxy, c.y + q.y * rxy, c.z + q.z * rz))


def drooping_path(start, direction, length, droop, segs=4, wobble=0.0, rng=None):
    pts = [start.copy()]
    d = direction.normalized()
    for i in range(1, segs + 1):
        t = i / segs
        p = start + d * (length * t) + Vector((0, 0, -droop * length * t * t))
        if wobble and rng:
            p += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * wobble * length
        pts.append(p)
    return pts


# ====================================================================== species
def conifer(name, seed, H, bare, crown_r, shape, n_branches, droop, cell, bark_r, cards_per_branch, spray_w):
    t = Tree(name, seed)
    rng = t.rng
    t.crown = (Vector((0, 0, H * (bare + (1 - bare) * 0.4))), crown_r * H, (1 - bare) * H * 0.55)
    # trunk
    trunk_pts = [Vector((rng.uniform(-0.002, 0.002) * H, rng.uniform(-0.002, 0.002) * H, H * z)) for z in (0, 0.03, 0.1, 0.25, 0.45, 0.65, 0.82, 0.95, 1.0)]
    radii = [bark_r * H * (1 - z * 0.92) for z in (0, 0.03, 0.1, 0.25, 0.45, 0.65, 0.82, 0.95, 1.0)]
    t.tube(trunk_pts, radii, sides=12, flare=0.9)
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n_branches):
        f = i / (n_branches - 1)
        z = H * (bare + (1 - bare) * 0.97 * f ** 0.9)
        r = crown_r * H * (1 - f) ** shape + 0.02 * H
        ang = i * golden + rng.uniform(-0.2, 0.2)
        d = Vector((math.cos(ang), math.sin(ang), -0.15 + f * 0.35))
        base = Vector((0, 0, z))
        pts = drooping_path(base, d, r, droop * (1 - f * 0.5), segs=3)
        if f < 0.85 and r > 0.04 * H:
            t.tube(pts, [bark_r * H * 0.14 * (1 - f * 0.5), bark_r * H * 0.08, bark_r * H * 0.05, bark_r * H * 0.025], sides=4, uv_scale=2, collide=False, lod1=False)
        # spray cards along the branch, lying mostly flat and fanning out
        for k in range(cards_per_branch):
            kt = k / max(1, cards_per_branch - 1)
            p = pts[0].lerp(pts[-1], 0.15 + kt * 0.55)
            dd = (pts[-1] - pts[0]).normalized()
            fan = Quaternion(UP, (kt - 0.5) * 0.9 + rng.uniform(-0.2, 0.2))
            L = r * (0.85 - kt * 0.3) + 0.03 * H
            t.card(p, fan @ dd, L, L * spray_w, cell, tilt=rng.uniform(-0.35, 0.35), droop=droop * 0.25, flat_normal=0.15)
        # an upright crossed card at the tip adds volume from the side
        if f < 0.92:
            t.card(pts[-1] - (pts[-1] - pts[0]).normalized() * r * 0.4, (pts[-1] - pts[0]).normalized(), r * 0.55, r * 0.35, cell, tilt=math.pi / 2, droop=0.1)
    # leader at the top
    for a in range(3):
        d = Vector((math.cos(a * 2.1) * 0.25, math.sin(a * 2.1) * 0.25, 1))
        t.card(Vector((0, 0, H * 0.9)), d, H * 0.13, H * 0.06, cell, tilt=a * 1.0)
    return t


def pine(name, seed, H=1.0):
    t = Tree(name, seed)
    rng = t.rng
    bare = 0.52
    t.crown = (Vector((0, 0, H * 0.8)), 0.24 * H, 0.18 * H)
    lean = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)).normalized() * 0.04 * H
    zs = (0, 0.05, 0.2, 0.4, 0.6, 0.78, 0.9, 1.0)
    trunk_pts = [Vector((0, 0, H * z)) + lean * (z ** 2) for z in zs]
    t.tube(trunk_pts, [0.022 * H * (1 - z * 0.85) for z in zs], sides=10, flare=0.6)
    for i in range(13):
        f = i / 12
        z = H * (bare + 0.38 * f)
        ang = i * 2.4 + rng.uniform(-0.3, 0.3)
        L = (0.26 - f * 0.12) * H
        d = Vector((math.cos(ang), math.sin(ang), 0.35 + f * 0.25))
        base = trunk_pts[0].lerp(trunk_pts[-1], z / H)
        pts = drooping_path(base, d, L, -0.1, segs=3, wobble=0.05, rng=rng)
        t.tube(pts, [0.008 * H, 0.006 * H, 0.004 * H, 0.002 * H], sides=5, uv_scale=2, collide=False, lod1=f < 0.6)
        # needle tufts: clusters of crossed cards at the branch ends
        for k in range(7):
            p = pts[rng.choice((-1, -1, -2))] + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.3, 0.6))) * 0.06 * H
            dd = Vector((d.x, d.y, 0.3)).normalized()
            dd = Quaternion(UP, rng.uniform(-1.2, 1.2)) @ dd
            s = rng.uniform(0.11, 0.16) * H
            keep = rng.random()
            t.card(p - dd * s * 0.4, dd, s, s * 0.8, CELL['pine'], tilt=rng.uniform(-0.6, 0.6), flat_normal=0.1, keep=keep)
            t.card(p - dd * s * 0.4, dd, s, s * 0.8, CELL['pine'], tilt=math.pi / 2 + rng.uniform(-0.3, 0.3), flat_normal=0.1, keep=keep)
    # top tuft
    for k in range(6):
        dd = Quaternion(UP, k * 1.05) @ Vector((1, 0, 0.8)).normalized()
        t.card(trunk_pts[-1] - Vector((0, 0, 0.04 * H)), dd, 0.12 * H, 0.1 * H, CELL['pine'], tilt=rng.uniform(-0.4, 0.4))
    return t


def broadleaf(name, seed, H=1.0, crown=(0.62, 0.34, 0.26), limbs=5, cards=80, bark_r=0.03, banyan=False, titan=False):
    t = Tree(name, seed)
    rng = t.rng
    cz, crx, crz = crown
    t.crown = (Vector((0, 0, cz * H)), crx * H, crz * H)
    fork = (cz - crz * 0.9) * H
    zs = [0, 0.04, 0.12, 0.3, 0.6, 0.85, 1.0]
    trunk_pts = [Vector((rng.uniform(-0.004, 0.004) * H, rng.uniform(-0.004, 0.004) * H, fork * z)) for z in zs]
    t.tube(trunk_pts, [bark_r * H * (1 - z * 0.25) for z in zs], sides=14 if titan else 10, flare=1.4 if titan else 0.7)
    tips = []
    for i in range(limbs):
        ang = i / limbs * math.tau + rng.uniform(-0.3, 0.3)
        up = rng.uniform(0.6, 1.1) if not banyan else rng.uniform(0.15, 0.4)
        d = Vector((math.cos(ang), math.sin(ang), up))
        L = crx * H * rng.uniform(0.85, 1.15) * (1.25 if banyan else 1)
        pts = drooping_path(trunk_pts[-1], d, L, -0.05, segs=4, wobble=0.04, rng=rng)
        pts = [inside(t, p, 0.8) for p in pts]
        r0 = bark_r * H * 0.55
        t.tube(pts, [r0, r0 * 0.8, r0 * 0.62, r0 * 0.45, r0 * 0.3], sides=8 if titan else 6, uv_scale=1.5)
        # secondary branches
        for k in range(4 if titan else 3):
            kt = 0.35 + k * 0.2
            o = pts[1].lerp(pts[-1], kt)
            sa = ang + rng.uniform(-1.2, 1.2)
            sd = Vector((math.cos(sa), math.sin(sa), rng.uniform(0.2, 0.8)))
            sl = L * rng.uniform(0.35, 0.55)
            spts = [inside(t, p, 0.85) for p in drooping_path(o, sd, sl, 0.05, segs=3, wobble=0.05, rng=rng)]
            t.tube(spts, [r0 * 0.3, r0 * 0.22, r0 * 0.15, r0 * 0.08], sides=5, uv_scale=2, collide=titan, lod1=titan)
            tips.append((spts[-1], sd))
        tips.append((pts[-1], d))
        if banyan:
            # aerial roots: a few prop roots from the outer half of the limb, thickening towards the ground
            for k in range(rng.choice((0, 1, 1, 2))):
                o = pts[1].lerp(pts[-1], rng.uniform(0.45, 0.85))
                g = Vector((o.x * 1.04 + rng.uniform(-1, 1) * 0.02 * H, o.y * 1.04 + rng.uniform(-1, 1) * 0.02 * H, -0.01 * H))
                sw = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.015 * H
                rp = [o, o.lerp(g, 0.3) + sw, o.lerp(g, 0.65) + sw * 0.6, o.lerp(g, 0.9), g]
                rr = rng.uniform(0.004, 0.007) * H
                t.tube(rp, [rr * 0.6, rr * 0.8, rr, rr * 1.3, rr * 2.2], sides=6, uv_scale=3, flare=0.0)
    # leaf cluster cards: clumps at every branch tip plus a fill throughout the crown shell, crossed pairs
    c = t.crown[0]
    anchors = [tip for tip, d in tips]
    per = max(1, int(cards * 0.6) // len(anchors))
    shell = int(cards * 0.4)
    def put(p, spread_scale):
        q = Vector(((p.x - c.x) / (crx * H), (p.y - c.y) / (crx * H), (p.z - c.z) / (crz * H)))
        if q.length > 1.0:
            p = c + Vector((q.x * crx * H, q.y * crx * H, q.z * crz * H)) / q.length
        out = (p - c); out.z *= 0.4
        dd = (Vector((out.x, out.y, 0.25)).normalized() if out.length > 1e-3 else Vector((1, 0, 0.3)).normalized())
        dd = Quaternion(UP, rng.uniform(-0.8, 0.8)) @ dd
        s = rng.uniform(0.22, 0.32) * crx * H * spread_scale
        keep = rng.random()
        t.card(p - dd * s * 0.45, dd, s, s * 0.6, CELL['leaves'], tilt=rng.uniform(-0.5, 0.5), droop=0.1, flat_normal=0.1, keep=keep)
        t.card(p - dd * s * 0.45, dd, s, s * 0.6, CELL['leaves'], tilt=math.pi / 2 + rng.uniform(-0.3, 0.3), droop=0.05, keep=keep)
        t.spheres.append((p.copy(), s * 0.6))
    for tip in anchors:
        for k in range(per):
            put(tip + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.5, 0.8))) * crx * H * 0.3, 1.0)
    for k in range(shell):
        # points in the outer 40% of the ellipsoid, biased to the top
        v = Vector((rng.gauss(0, 1), rng.gauss(0, 1), abs(rng.gauss(0, 1)) * 1.2 - 0.3)).normalized() * rng.uniform(0.6, 0.98)
        put(c + Vector((v.x * crx * H, v.y * crx * H, v.z * crz * H)), 0.9)
    return t


def palm(name, seed, H=1.0):
    t = Tree(name, seed)
    rng = t.rng
    t.crown = (Vector((0, 0, 0.92 * H)), 0.35 * H, 0.2 * H)
    t.ao_min = 0.65  # a single layer of fronds: little self-occlusion
    t.normal_up = 1.6  # drooping fronds still catch the sky
    bend = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)).normalized()
    zs = [i / 12 for i in range(13)]
    pts = [Vector((0, 0, z * H)) + bend * (0.12 * H * z * z) for z in zs]
    t.tube(pts, [0.02 * H * (1 - z * 0.3) * (1 + 0.08 * math.sin(z * 90)) for z in zs], sides=8, uv_scale=1.5, flare=0.5)
    top = pts[-1]
    for i in range(16):
        ang = i / 16 * math.tau + rng.uniform(-0.15, 0.15)
        up = rng.uniform(-0.1, 0.6) if i % 2 else rng.uniform(0.3, 0.9)
        d = Vector((math.cos(ang), math.sin(ang), up)).normalized()
        L = rng.uniform(0.38, 0.5) * H
        # arched frond as 3 segments sharing the card texture (v split into thirds); LOD1 keeps whole fronds
        prev = top
        frond_tilt = rng.uniform(-0.2, 0.2)
        frond_keep = 0.0 if i % 2 == 0 else 1.0
        for sgi in range(3):
            t0, t1 = sgi / 3, (sgi + 1) / 3
            seg_dir = (d + Vector((0, 0, -0.9 * (t0 + t1)))).normalized()
            seg_len = L / 3
            t.card(prev, seg_dir, seg_len, L * 0.34, CELL['palm'], tilt=frond_tilt, flat_normal=0.2, v=(t0, t1), keep=frond_keep)
            prev = prev + seg_dir * seg_len
    return t


# ====================================================================== build all
bpy.ops.wm.read_factory_settings(use_empty=True)
species = [
    conifer('redwood', 11, 1.0, bare=0.4, crown_r=0.14, shape=0.7, n_branches=64, droop=0.35, cell=CELL['fir'], bark_r=0.03, cards_per_branch=4, spray_w=0.7),
    conifer('fir', 12, 1.0, bare=0.07, crown_r=0.25, shape=1.0, n_branches=52, droop=0.45, cell=CELL['fir'], bark_r=0.02, cards_per_branch=3, spray_w=0.6),
    pine('pine', 13),
    broadleaf('broadleaf', 14, limbs=6, cards=240),
    palm('palm', 15),
    broadleaf('titan_giant', 16, crown=(0.72, 0.36, 0.22), limbs=8, cards=700, bark_r=0.055, titan=True),
    broadleaf('titan_banyan', 17, crown=(0.62, 0.5, 0.16), limbs=9, cards=700, bark_r=0.07, banyan=True, titan=True),
]
meta = {}
for sp in species:
    meta[sp.name] = sp.export()
    print('built', sp.name, meta[sp.name]['tris'], 'tris')
json.dump(meta, open(os.path.join(OUT, 'trees.json'), 'w'), indent=1)

# ====================================================================== previews (Cycles, textured)
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    CARDS = os.path.join(os.path.dirname(OUT.rstrip('/')), 'tree-cards')
    SRC = os.path.join(os.path.dirname(OUT.rstrip('/')), 'tree-src')
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 48; scene.cycles.use_denoising = False
    scene.render.resolution_x = 640; scene.render.resolution_y = 800
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('sky'); scene.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.7, 0.95, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), 0, math.radians(35)); scene.collection.objects.link(sun)
    def img(p, cs):
        i = bpy.data.images.load(p); i.colorspace_settings.name = cs; return i
    atlas = [img(os.path.join(CARDS, f'card_{n}_albedo.png'), 'sRGB') for n in ('fir', 'pine', 'leaves', 'palm')]
    barks = {'redwood': 'japanese_cedar_bark__Diffuse.png', 'fir': 'fir_tree_01__bark_diff.png', 'pine': 'pine_tree_01__bark_diff.png',
             'broadleaf': 'island_tree_01__branches_diff.png', 'palm': 'pine_tree_01__bark_diff.png', 'titan_giant': 'japanese_cedar_bark__Diffuse.png', 'titan_banyan': 'island_tree_01__branches_diff.png'}
    def foliage_mat(sp):
        m = bpy.data.materials.new('pf_' + sp); m.use_nodes = True; nt = m.node_tree
        bsdf = nt.nodes['Principled BSDF']
        uv = nt.nodes.new('ShaderNodeUVMap')
        # route to the right card by u cell: remap u into the card's own 0..1 range
        sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(uv.outputs['UV'], sep.inputs[0])
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 4
        nt.links.new(sep.outputs['X'], mul.inputs[0])
        fr = nt.nodes.new('ShaderNodeMath'); fr.operation = 'FRACT'; nt.links.new(mul.outputs[0], fr.inputs[0])
        comb = nt.nodes.new('ShaderNodeCombineXYZ'); nt.links.new(fr.outputs[0], comb.inputs['X']); nt.links.new(sep.outputs['Y'], comb.inputs['Y'])
        cell = {'redwood': 0, 'fir': 0, 'pine': 1, 'broadleaf': 2, 'palm': 3}.get(sp, 2)
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = atlas[cell]; nt.links.new(comb.outputs[0], tex.inputs['Vector'])
        vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1
        nt.links.new(tex.outputs['Color'], mx.inputs['A']); nt.links.new(vc.outputs['Color'], mx.inputs['B'])
        nt.links.new(mx.outputs['Result'], bsdf.inputs['Base Color'])
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        bsdf.inputs['Roughness'].default_value = 0.7
        return m
    def bark_mat(sp):
        m = bpy.data.materials.new('pb_' + sp); m.use_nodes = True; nt = m.node_tree
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img(os.path.join(SRC, barks[sp]), 'sRGB')
        nt.links.new(tex.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
        return m
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
    ground = bpy.data.meshes.new('g'); bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=3); bm.to_mesh(ground)
    gob = bpy.data.objects.new('ground', ground); scene.collection.objects.link(gob)
    for sp in species:
        for c in bpy.data.collections: c.hide_render = c.name != sp.name
        for ob in sp.coll.objects:
            ob.hide_render = ob.name.endswith('_lod1')
            ob.data.materials.clear()
            ob.data.materials.append(foliage_mat(sp.name) if ob.name.startswith('foliage') else bark_mat(sp.name))
        cam.location = (1.5, -1.5, 0.75); cam.rotation_euler = (math.radians(80), 0, math.radians(45))
        cam.data.lens = 38
        scene.render.filepath = os.path.join(PREVIEW, f'{sp.name}.png')
        bpy.ops.render.render(write_still=True)
print('done')
