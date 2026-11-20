# 黒のストリート系コーデ一式を作る（Blender の中で exec する）。2 人目の女の子（girl2.blend）用
#   Street_Top（ブラックデニムのチューブトップ・カーキのレースのすそ・胸のリボン）/ Street_Skirt（ブラックデニムのミニ + カーキのベルトとポーチ）
#   Street_Shorts（スカートの中）/ Street_Tights（グレーのタイツ）/ Street_Boots（黒いブーツ）
#   Street_Accessories（チョーカー・金のブレスレット・ピアス）
# すべてコレクション Outfit_Street に入れる。ほかの服は隠すだけで残す。体の隠す頂点の控えは hidden_street。
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
_rig = bpy.data.objects.get("Girl_Rig"); _pose = _rig.data.pose_position if _rig else None    # 骨組みがあれば、作る間は基本の姿勢に戻す
if _rig: _rig.data.pose_position = 'REST'; bpy.context.view_layer.update()

ob = bpy.data.objects["Girl_Body"]; me = ob.data
mk = next(m for m in ob.modifiers if m.type == 'MASK')
mk.show_viewport = False; bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); e = ob.evaluated_get(dg); m = e.to_mesh()
co = [v.co.copy() for v in m.vertices]; e.to_mesh_clear(); mk.show_viewport = True
body = ob.vertex_groups["body"]; hid = ob.vertex_groups["hidden_by_clothes"]
def members(g): return {v.index for v in me.vertices if any(x.group == g.index and x.weight > 0.5 for x in v.groups)}
# 前の服で隠していた頂点を控えてから、いったん全部見せる
old_hidden = members(hid)
if "hidden_casual" not in ob.vertex_groups and old_hidden:
    ob.vertex_groups.new(name="hidden_casual").add(list(old_hidden), 1.0, 'REPLACE')
if old_hidden: body.add(list(old_hidden), 1.0, 'REPLACE'); hid.remove(list(old_hidden))
inb_set = members(body); inb = [i in inb_set for i in range(len(co))]
def joint(n):
    ps = [co[i] for i in members(ob.vertex_groups[n])]
    return sum(ps, Vector())/len(ps)
hand = joint("joint-l-hand"); elbow = joint("joint-l-elbow"); d = (hand-elbow).normalized()
knee = joint("joint-l-knee"); ankle = joint("joint-l-ankle"); hip = joint("joint-l-upper-leg")
def ss(t): t = max(0, min(1, t)); return t*t*(3-2*t)
def lerp(a, b, t): return a+(b-a)*t
bpolys = [tuple(p.vertices) for p in me.polygons if all(inb[v] for v in p.vertices)]
bvh = BVHTree.FromPolygons(co, bpolys)

COL = bpy.data.collections.get("Outfit_Street") or bpy.data.collections.new("Outfit_Street")
if COL.name not in bpy.context.scene.collection.children: bpy.context.scene.collection.children.link(COL)

def mat(name, col, rough, metal=0.0, **kw):
    mt = bpy.data.materials.get(name) or bpy.data.materials.new(name); mt.use_nodes = True
    b = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    for k, v in kw.items():
        if k in b.inputs: b.inputs[k].default_value = v
    mt.diffuse_color = (*col, 1); mt.use_backface_culling = False
    return mt
BLACK = mat("J_Black", (0.012, 0.012, 0.014), 0.85, **{"Sheen Weight": 0.3})
RIB = mat("J_BlackRib", (0.018, 0.018, 0.021), 0.92, **{"Sheen Weight": 0.45})
RED = mat("J_Red", (0.30, 0.010, 0.026), 0.8, **{"Sheen Weight": 0.3})
REDG = mat("J_RedGloss", (0.40, 0.008, 0.022), 0.14, **{"Coat Weight": 1.0})
BLACKG = mat("J_BlackGloss", (0.010, 0.010, 0.012), 0.28, **{"Coat Weight": 0.6})
SILVER = mat("J_Silver", (0.74, 0.74, 0.77), 0.3, 1.0)
WHITE = mat("J_White", (0.90, 0.89, 0.86), 0.7)
SOLE = mat("J_Sole", (0.014, 0.014, 0.014), 0.6)
REDP = mat("J_RedPlastic", (0.48, 0.012, 0.03), 0.35, **{"Coat Weight": 0.4})

def newobj(name, bm, mats, smooth=True, recalc=True):
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    if recalc: bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update(); mesh = bpy.data.meshes.new(name); bm.to_mesh(mesh); bm.free()
    for p in mesh.polygons: p.use_smooth = smooth
    o = bpy.data.objects.new(name, mesh); COL.objects.link(o)
    for mt in mats: mesh.materials.append(mt)
    return o
def from_body(sel):
    vs = [i for i in range(len(co)) if inb[i] and sel(co[i])]; s = set(vs)
    bm = bmesh.new(); mp = {i: bm.verts.new(co[i]) for i in vs}
    for p in me.polygons:
        if all(v in s for v in p.vertices):
            try: bm.faces.new([mp[v] for v in p.vertices])
            except ValueError: pass
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    return bm, s
def erode(sel_set, rings):
    inner = set(sel_set)
    for _ in range(rings):
        edge = set()
        for p in me.polygons:
            vs = p.vertices
            if any(v not in inner for v in vs): edge.update(v for v in vs if v in inner)
        inner -= edge
    return inner
def push_out(bm, dist, verts=None):
    for v in (verts or bm.verts):
        loc, nor, idx, dd = bvh.find_nearest(v.co)
        if loc and (v.co-loc).dot(nor) < dist: v.co = loc+nor*dist
def loft(bm, rings, wrap=True, matf=None):
    vs = [[bm.verts.new(p) for p in r] for r in rings]; n = len(rings[0])
    for i in range(len(rings)-1):
        for j in range(n if wrap else n-1):
            f = bm.faces.new((vs[i][j], vs[i][(j+1) % n], vs[i+1][(j+1) % n], vs[i+1][j]))
            if matf: f.material_index = matf(i, j)
    return vs
def fan(bm, ring, center, mi=0):
    c = bm.verts.new(center); n = len(ring)
    for j in range(n): bm.faces.new((ring[j], ring[(j+1) % n], c)).material_index = mi
def tube(bm, pts, r, seg=6, mi=0, closed=False, caps=True):
    rings = []; n = len(pts); prev = None
    for i, p in enumerate(pts):
        a = pts[(i-1) % n] if (closed or i > 0) else p; b = pts[(i+1) % n] if (closed or i < n-1) else p
        t = (b-a).normalized()
        u = (prev - t*prev.dot(t)) if prev is not None else t.orthogonal()
        u.normalize(); prev = u; w = t.cross(u)
        rings.append([p+(u*math.cos(k*2*math.pi/seg)+w*math.sin(k*2*math.pi/seg))*r for k in range(seg)])
    if closed: rings.append(rings[0])
    vs = loft(bm, rings, True, (lambda i, j: mi))
    if caps and not closed: fan(bm, vs[0], pts[0], mi); fan(bm, vs[-1], pts[-1], mi)
def box(bm, c, sx, sy, sz, mi=0, rot=None):
    vs = []
    for dx in (-1, 1):
        for dy in (-1, 1):
            for dz in (-1, 1):
                p = Vector((dx*sx/2, dy*sy/2, dz*sz/2))
                vs.append(bm.verts.new(c+(rot @ p if rot else p)))
    for q in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        bm.faces.new([vs[i] for i in q]).material_index = mi
def ball(bm, c, rx, ry, rz, mi=0, nu=12, nv=8, rot=None):
    rings = []
    for i in range(1, nv):
        a = math.pi*i/nv
        rings.append([c+((rot @ Vector((rx*math.sin(a)*math.cos(k*2*math.pi/nu), ry*math.sin(a)*math.sin(k*2*math.pi/nu), rz*math.cos(a)))) if rot else
                         Vector((rx*math.sin(a)*math.cos(k*2*math.pi/nu), ry*math.sin(a)*math.sin(k*2*math.pi/nu), rz*math.cos(a)))) for k in range(nu)])
    vs = loft(bm, rings, True, (lambda i, j: mi))
    top = Vector((0, 0, rz)); bot = Vector((0, 0, -rz))
    fan(bm, vs[0], c+(rot @ top if rot else top), mi); fan(bm, vs[-1], c+(rot @ bot if rot else bot), mi)
def front_hit(x, z, tree=None, y0=-0.6):
    loc, nor, idx, dd = (tree or bvh).ray_cast(Vector((x, y0, z)), Vector((0, 1, 0)))
    return loc, nor
def radial(c, th, far=0.2):
    loc, nor, idx, dd = bvh.ray_cast(c, Vector((math.cos(th), math.sin(th), 0)))
    return dd if loc else far
to_hide = set()

SATIN = mat("ST_Black", (0.012, 0.012, 0.014), 0.38, **{"Sheen Weight": 0.3})
LEATHER = mat("ST_Leather", (0.016, 0.016, 0.018), 0.5)
KHAKI = mat("ST_Khaki", (0.20, 0.22, 0.09), 0.75)
SWHITE = mat("ST_White", (0.88, 0.88, 0.86), 0.6)
SILVER = mat("ST_Silver", (0.74, 0.74, 0.77), 0.3, 1.0)
GOLD = mat("ST_Gold", (0.83, 0.62, 0.22), 0.25, 1.0)
def denim():
    """ブラックデニム：濃いチャコールに、あや織りの細いななめの筋と、色のむら"""
    mt = mat("ST_Denim", (0.035, 0.038, 0.045), 0.9); nt = mt.node_tree; N = nt.nodes
    for n in [n for n in N if n.name.startswith("Dn")]: N.remove(n)
    b = next(n for n in N if n.type == "BSDF_PRINCIPLED")
    tc = N.new("ShaderNodeTexCoord"); tc.name = "DnCoord"
    wv = N.new("ShaderNodeTexWave"); wv.name = "DnTwill"; wv.bands_direction = 'DIAGONAL'; wv.inputs["Scale"].default_value = 260; wv.inputs["Distortion"].default_value = 0.6
    no = N.new("ShaderNodeTexNoise"); no.name = "DnNoise"; no.inputs["Scale"].default_value = 28
    m1 = N.new("ShaderNodeMix"); m1.name = "DnMix1"; m1.data_type = 'RGBA'; m1.inputs[6].default_value = (0.020, 0.022, 0.027, 1); m1.inputs[7].default_value = (0.075, 0.080, 0.092, 1)
    m2 = N.new("ShaderNodeMix"); m2.name = "DnMix2"; m2.data_type = 'RGBA'; m2.blend_type = 'MULTIPLY'; m2.inputs[0].default_value = 0.6
    L = nt.links
    L.new(tc.outputs["Object"], wv.inputs["Vector"]); L.new(tc.outputs["Object"], no.inputs["Vector"])
    L.new(wv.outputs[0], m1.inputs[0]); L.new(m1.outputs[2], m2.inputs[6]); L.new(no.outputs[0], m2.inputs[7]); L.new(m2.outputs[2], b.inputs["Base Color"])
    return mt
DENIM = denim()
TIGHTS = mat("ST_Tights", (0.15, 0.13, 0.15), 0.6, **{"Sheen Weight": 0.5})

# ── チューブトップ ──
TOP_T = 1.282; TOP_B = 1.075       # 上は胸の上まで、下はみぞおちの下まで
_bo = bpy.data.objects["Girl_Body"]; _ag = {g.index for g in _bo.vertex_groups if g.name.endswith("UpperArm")}
_arm = {tuple(round(q, 5) for q in co[v.index]) for v in _bo.data.vertices if sum(g.weight for g in v.groups if g.group in _ag) > 0.30}      # 腕の面はトップに入れない（ふちに角が出る）
def top_sel(c): return abs(c.x) < 0.172 and TOP_B-0.02 <= c.z <= TOP_T+0.02
bm, tsel = from_body(top_sel)
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
for zc, keep_up in ((TOP_B, True), (TOP_T, False)):      # 上下のふちは水平に切りそろえる
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:]+bm.edges[:]+bm.faces[:], plane_co=Vector((0, 0, zc)), plane_no=Vector((0, 0, 1)),
                           clear_inner=keep_up, clear_outer=not keep_up, dist=0.00005)
for sx_ in (-1, 1):                                         # わきの下は、ふちを斜めに下げて切りそろえる
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:]+bm.edges[:]+bm.faces[:], plane_co=Vector((sx_*0.098, 0, TOP_T)), plane_no=Vector((sx_*1.35, 0, 1)).normalized(),
                           clear_inner=False, clear_outer=True, dist=0.00005)
inner = [v for v in bm.verts if not v.is_boundary]
for _ in range(14): bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.normal_update()
for v in bm.verts: v.co += v.normal*0.008
push_out(bm, 0.004)
top_bvh = BVHTree.FromBMesh(bm)
top = newobj("Street_Top", bm, [DENIM], recalc=False)
sm = top.modifiers.new("Solidify", 'SOLIDIFY'); sm.thickness = 0.003; sm.offset = 1.0
to_hide |= erode({i for i in tsel if TOP_B < co[i].z < TOP_T}, 2)
# レースのすそ（カーキ）と、胸のリボン
bm = bmesh.new(); NA = 96; CY = -0.030
rows = [[], []]
for j in range(NA):
    a = 2*math.pi*j/NA; r = radial(Vector((0, CY, TOP_B)), a)+0.0125
    rows[0].append(Vector((r*math.cos(a), CY+r*math.sin(a), TOP_B+0.004)))
    rows[1].append(Vector(((r+0.004)*math.cos(a), CY+(r+0.004)*math.sin(a), TOP_B-0.016-0.010*abs(math.sin(12*a)))))
loc, nor = front_hit(0.0, 1.205, top_bvh); bc = loc+Vector((0, -0.010, 0))       # すそのカーキのレースは付けない
bc.y = min(front_hit(xx, zz, top_bvh)[0].y for xx in (0.0, 0.05, 0.078, 0.10) for zz in (1.17, 1.195, 1.22))-0.004      # リボンは胸のふくらみの前に出す（羽を突き抜けないように）; bc = loc+Vector((0, -0.010, 0))
rotL = Matrix.Rotation(0.30, 3, 'Y')                    # 大きなリボン：左右の輪を少し下げぎみに開く
# ちょうちょの形：上の大きな羽 2 枚、下の小さな羽 2 枚、まん中に細い胴。羽は平たくする
for s in (-1, 1):
    ball(bm, bc+Vector((s*0.070, -0.003, 0.020)), 0.078, 0.006, 0.036, 1, 18, 8, rot=Matrix.Rotation(-s*0.38, 3, 'Y'))      # 横に広い羽
    ball(bm, bc+Vector((s*0.050, -0.003, -0.030)), 0.054, 0.006, 0.027, 1, 16, 8, rot=Matrix.Rotation(s*0.42, 3, 'Y'))
ball(bm, bc+Vector((0, -0.008, -0.004)), 0.0075, 0.008, 0.040, 1)
# 肩ひも：胸の上のふちから肩をこえて、背中のふちまで
for s in (-1, 1):
    sx = s*0.092; cc = Vector((sx, -0.035, 1.262)); pts = []
    for q in range(41):
        t = math.pi*q/40; dv = Vector((0, -math.cos(t), math.sin(t)))
        loc, nor, idx, dd = bvh.ray_cast(cc+dv*0.16, -dv)             # 遠くから撃つと耳や頭に当たる
        if loc and loc.z > TOP_T-0.012: pts.append(loc+nor*0.0035)
    for _ in range(2): pts = [pts[0]]+[(pts[i-1]+pts[i]*2+pts[i+1])/4 for i in range(1, len(pts)-1)]+[pts[-1]]
    rows = [[p+Vector((dx, 0, 0)) for p in pts] for dx in (-0.007, 0.007)]
    vs = loft(bm, [rows[0], rows[1]] if s > 0 else [rows[1], rows[0]], False, lambda i, j: 1)
newobj("Street_TopDeco", bm, [KHAKI, SATIN])

# ── ショートパンツ（スカートの中）──
def shorts_sel(c): return abs(c.x) < 0.22 and 0.742 <= c.z <= 0.975
bm, isel = from_body(shorts_sel); bm.normal_update()
for v in bm.verts: v.co += v.normal*0.003
newobj("Street_Shorts", bm, [SATIN], recalc=False)
to_hide |= erode(isel, 2)

# ── ミニスカートとベルト ──
NA = 160
ZT = [0.80+0.01*i for i in range(20)]            # 0.80 より下は脚の間を光線がすりぬけるので、0.80 の値を使う
raw = [[radial(Vector((0, CY, z)), 2*math.pi*j/NA) for j in range(NA)] for z in ZT]
env = [r[:] for r in raw]; ti = min(range(len(ZT)), key=lambda i: abs(ZT[i]-0.93))
for i in range(ti-1, -1, -1): env[i] = [max(env[i][j], env[i+1][j]) for j in range(NA)]
def tab(T, z, j):
    f = (max(ZT[0], min(ZT[-1], z))-ZT[0])/0.01; i = min(len(ZT)-2, int(f)); t = f-i
    return lerp(T[i][j], T[i+1][j], t)
def P(r, j, z): a = 2*math.pi*j/NA; return Vector((r*math.cos(a), CY+r*math.sin(a), z))
bm = bmesh.new(); SK_T = 0.950; SK_B = 0.750; NR = 12
# ボディコン：体の線にぴったり沿わせる。ただし、2 本の太ももの間のへこみは拾わず、ぴんと張った布のように渡す
# （各高さの輪郭を、まわりの最大値でならしてから、なめらかにする。こうすると、すその線がまっすぐになる）
def tight(row):
    w1 = NA//10; mx = [max(row[(j+k) % NA] for k in range(-w1, w1+1)) for j in range(NA)]
    w2 = NA//20; ws = [math.exp(-(k/(w2*0.6))**2) for k in range(-w2, w2+1)]; tot = sum(ws)
    return [sum(mx[(j+k) % NA]*ws[k+w2] for k in range(-w2, w2+1))/tot for j in range(NA)]
envs = [tight(r) for r in env]
def skr(i, j):
    t = i/NR; z = lerp(SK_T, SK_B, t)
    return max(tab(envs, z, j)*0.985, tab(env, z, j))+0.007+0.003*t
loft(bm, [[P(skr(i, j), j, lerp(SK_T, SK_B, i/NR)) for j in range(NA)] for i in range(NR+1)], True, lambda i, j: 0)
loft(bm, [[P(tab(raw, z, j)+off, j, z) for j in range(NA)] for z, off in ((0.985, 0.004), (0.982, 0.008), (0.962, 0.009))], True, lambda i, j: 2)      # 白い見せゴム
BZ = 0.930                                               # ベルト（スカートの表面 envs に沿わせる）：太めで、腰にななめにかける（本人の右が高く、左が低い。前も少し下がる）
def bz(j): a = 2*math.pi*j/NA; return BZ-0.022*math.cos(a)-0.008*max(0.0, -math.sin(a))
def boff(j): return 0.020+0.006*max(0.0, math.cos(2*math.pi*j/NA))          # 低い側は腰から少し浮く
loft(bm, [[P(tab(envs, bz(j)+dz, j)+boff(j)+off, j, bz(j)+dz) for j in range(NA)] for dz, off in ((0.023, 0.0), (0.020, 0.005), (-0.020, 0.005), (-0.023, 0.0))], True, lambda i, j: 1)
for j in range(0, NA, 6):                                # はとめ（2 列）
    for dz in (0.011, -0.011):
        p = P(tab(envs, bz(j)+dz, j)+boff(j)+0.006, j, bz(j)+dz); ball(bm, p, 0.0032, 0.0032, 0.0032, 3, 8, 4)
jr = int(NA*0.83); ar = 2*math.pi*jr/NA                  # 金の輪 2 つ（本人の左前。ベルトから下がる）
side_v = Vector((-math.sin(ar), math.cos(ar), 0))
for k in (-1, 1):
    c = P(tab(envs, bz(jr), jr)+boff(jr)+0.010, jr, bz(jr)-0.030)+side_v*(k*0.013)
    tube(bm, [c+side_v*(0.013*math.cos(t))+Vector((0, 0, 0.013*math.sin(t))) for t in [2*math.pi*q/20 for q in range(20)]], 0.0022, 6, 4, closed=True)
jc = int(NA*0.66)                                        # チェーン（本人の右前から、太ももの中ほどまで下がる）
for q in range(20):
    p = P(tab(envs, bz(jc), jc)+boff(jc)+0.010+0.0019*q, jc, bz(jc)-0.024-q*0.0115)       # 下へ行くほど外へ（スカートの広がりに沿わせる）; ball(bm, p, 0.0038, 0.0038, 0.0052, 3, 6, 4)
for jj, w in ((int(NA*0.92), 0.050),):       # ポーチ（本人から見て左だけ）
    a = 2*math.pi*jj/NA; p = P(tab(envs, bz(jj)-0.03, jj)+boff(jj)+0.014, jj, bz(jj)-0.036)
    rot = Matrix((Vector((-math.sin(a), math.cos(a), 0)), Vector((math.cos(a), math.sin(a), 0)), Vector((0, 0, 1)))).transposed()
    box(bm, p, w, 0.026, 0.058, 1, rot=rot); box(bm, p+Vector((0, 0, 0.018)), w+0.004, 0.030, 0.022, 1, rot=rot)
newobj("Street_Skirt", bm, [DENIM, KHAKI, SWHITE, SILVER, GOLD])

# ── タイツ ──
def tights_sel(c): return abs(c.x) < 0.30 and c.z <= 0.80
bm, gsel = from_body(tights_sel)
_gt = joint("joint-ground").z-0.020; bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < _gt+0.105], context='VERTS'); bm.normal_update()      # 足先はブーツの中なので作らない（ヒールの形からはみ出す）
for v in bm.verts: v.co += v.normal*0.0022
newobj("Street_Tights", bm, [TIGHTS], recalc=False)
to_hide |= erode(gsel, 1)

# ── ブーツ（ふくらはぎの下までの丈・厚めの底）──
PH = Vector((0.158, 0.040, 0)); PT = Vector((0.172, -0.225, 0)); PC = (PH+PT)/2
SA = (PT-PH).length/2; SB = 0.052; SN = 2.5; HS = 0.034; KIN = 0.92
EU = (PT-PH).normalized(); EV = Vector((-EU.y, EU.x, 0))
def sp(c): return math.copysign(abs(c)**(2/SN), c)
def outline(ph): u = SA*sp(math.cos(ph)); return u, SB*(1+0.10*u/SA)*sp(math.sin(ph))
def SH(u): return lerp(0.090, 0.046, (u/SA+1)/2)
def SP(u, v, z, sgn=1): p = PC+EU*u+EV*v; return Vector((sgn*p.x, p.y, z))
def leg_c(z): t = (z-ankle.z)/(knee.z-ankle.z); return Vector((lerp(ankle.x, knee.x, t), lerp(ankle.y, knee.y, t), z))
G = joint("joint-ground").z-0.020                       # 床の高さ（脚を長くすると 0 より下がる）
HH = 0.060; GF = G-HH; ST = 0.012                        # ヒールの高さ・ヒールをはいたときの床・底の厚さ
def TOPZ(u): return lerp(GF+ST, G+HS, ss((0.30*SA-u)/(1.15*SA)))      # 底の上の面：つま先は低く、かかとは高い
def SHD(u): return lerp(G+HS+0.090, GF+ST+0.046, (u/SA+1)/2)-TOPZ(u)      # 甲：足首からつま先へまっすぐ下る
bm = bmesh.new(); NO = 56; NL = 40; BT = ankle.z+0.25
for sgn in (1, -1):
    def R(row): return row if sgn > 0 else row[::-1]
    # ヒール：底はつま先で床につき、かかとへ向かって持ち上がる。かかとの下に、先の細いヒールを立てる（床は HH だけ下がる）
    rings = [R([SP(outline(2*math.pi*k/NO)[0]*s, outline(2*math.pi*k/NO)[1]*s, max(GF, TOPZ(outline(2*math.pi*k/NO)[0]*s)+off), sgn) for k in range(NO)]) for off, s in ((-ST, 0.96), (-ST+0.004, 1.0), (-0.004, 1.0), (0, 0.97))]
    vs = loft(bm, rings, True, lambda i, j: 1); fan(bm, vs[0], SP(0, 0, max(GF, TOPZ(0)-ST), sgn), 1); fan(bm, vs[-1], SP(0, 0, TOPZ(0), sgn), 1)
    NHL = 20; hr = []
    for u0, ru, rv, zz in ((-0.66*SA, 0.27*SA, SB*0.70, None), (-0.72*SA, 0.15*SA, SB*0.42, G-0.012), (-0.76*SA, 0.016, 0.014, GF+0.006), (-0.76*SA, 0.017, 0.015, GF)):
        hr.append(R([SP(u0+ru*math.cos(2*math.pi*k/NHL), rv*math.sin(2*math.pi*k/NHL), (TOPZ(u0+ru*math.cos(2*math.pi*k/NHL))-ST+0.002) if zz is None else zz, sgn) for k in range(NHL)]))
    vs = loft(bm, hr, True, lambda i, j: 1); fan(bm, vs[-1], SP(-0.76*SA, 0, GF, sgn), 1)
    NJ = 12; rings = []
    for q in range(NJ):
        al = (math.pi/2)*q/NJ; rho = math.cos(al)**0.5
        rings.append(R([SP(outline(2*math.pi*k/NO)[0]*KIN*rho, outline(2*math.pi*k/NO)[1]*KIN*rho, TOPZ(outline(2*math.pi*k/NO)[0]*KIN*rho)-0.001+SHD(outline(2*math.pi*k/NO)[0]*KIN*rho)*math.sin(al)**0.7, sgn) for k in range(NO)]))
    vs = loft(bm, rings, True, lambda i, j: 0); fan(bm, vs[-1], SP(0, 0, TOPZ(0)+SHD(0), sgn), 0)
    rings = []                                           # 筒
    for i in range(15):
        z = lerp(BT, G+0.070, i/14); c = leg_c(max(z, ankle.z+0.026)); row = []
        for j in range(NL):
            a = 2*math.pi*j/NL; r = min(radial(c, a, 0.06), 0.070)+0.011+0.006*ss((ankle.z+0.07-z)/0.08)+(0.004 if i == 0 else 0)
            row.append(Vector((sgn*(c.x+r*math.cos(a)), c.y+r*math.sin(a), z)))
        rings.append(R(row))
    loft(bm, rings, True, lambda i, j: 0)
boots = newobj("Street_Boots", bm, [LEATHER, mat("ST_Sole", (0.012, 0.012, 0.012), 0.6)])
for p in boots.data.polygons: p.use_smooth = p.material_index == 0
sm = boots.modifiers.new("Solidify", 'SOLIDIFY'); sm.thickness = 0.003; sm.offset = 1.0

# ── 小物（チョーカー・ブレスレット・ピアス）──
bm = bmesh.new()
NCK = 40; cn = Vector((0, -0.022, 1.412)); rows = [[], [], [], []]
for j in range(NCK):
    a = 2*math.pi*j/NCK; r = radial(cn, a, 0.05)
    for q, (dz, off) in enumerate(((0.0075, 0.001), (0.0060, 0.0035), (-0.0060, 0.0035), (-0.0075, 0.001))):
        y = cn.y+(r+off)*math.sin(a); rows[q].append(Vector(((r+off)*math.cos(a), y, cn.z+dz+0.22*(y-cn.y))))
loft(bm, rows, True, lambda i, j: 0)
loc, nor = front_hit(0.0, 1.400); ball(bm, loc+Vector((0, -0.006, -0.004)), 0.006, 0.004, 0.006, 1)
u0 = d.orthogonal().normalized(); w0 = d.cross(u0)       # ブレスレット（本人の右手首）
for k, (back, rr) in enumerate(((0.045, 0.031), (0.052, 0.033), (0.060, 0.032))):
    c = hand-d*back; tilt = 0.25*(k-1)
    ring = [c+(u0*math.cos(t)+w0*math.sin(t))*rr+d*(0.006*tilt*math.cos(t)) for t in [2*math.pi*q/28 for q in range(28)]]
    tube(bm, [Vector((-p.x, p.y, p.z)) for p in ring], 0.0016, 6, 2, closed=True)
_ear = [co[i] for i in members(ob.vertex_groups["ears"]) if co[i].x > 0]; _lobe = min(_ear, key=lambda p: p.z)       # 耳たぶ（頭の大きさが変わっても合うように、耳の位置から決める）
for s in (-1, 1): ball(bm, Vector((s*(_lobe.x+0.003), _lobe.y, _lobe.z-0.004)), 0.0045, 0.0045, 0.0045, 2)       # ピアス
newobj("Street_Accessories", bm, [LEATHER, SILVER, GOLD])

# ── 体を隠す・ほかの服を片づける ──
to_hide |= {i for i in range(len(co)) if inb[i] and co[i].z < G+0.110}       # ヒールでは足が靴の形と合わないので、足首まで隠す
body.remove(list(to_hide)); hid.add(list(to_hide), 1.0, 'REPLACE')
hs = ob.vertex_groups.get("hidden_street") or ob.vertex_groups.new(name="hidden_street")
hs.remove(list(range(len(me.vertices)))); hs.add(list(to_hide), 1.0, 'REPLACE')
for cn_ in ("Outfit_Swim", "Outfit_Jirai", "Outfit_Casual", "Outfit_Black"):
    cc = bpy.data.collections.get(cn_)
    if cc:
        for o in cc.objects: o.hide_viewport = True; o.hide_render = True
print("street outfit built. hidden", len(to_hide), {o.name: len(o.data.polygons) for o in COL.objects})
if _rig:
    exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bind_rig.py", encoding="utf-8").read(), "bind_rig.py", "exec"), {"__name__": "__main__"})
    _rig.data.pose_position = _pose
# このスカートは体に近いタイトな形。めり込み防止の押し出す距離（Margin を小さく）しないと、立っているだけですそが波打つ
_sk = bpy.data.objects["Street_Skirt"]; _md = next((x for x in _sk.modifiers if x.type == 'NODES'), None)
if _md:
    _id = next(it.identifier for it in _md.node_group.interface.items_tree if it.item_type == 'SOCKET' and it.in_out == 'INPUT' and it.name == "Margin")
    getattr(_md.properties.inputs, _id).value = 0.0015
    _md.show_viewport = False; _md.show_render = False      # 立ち姿では切る：スパッツのすそのふちに押されて、スカートのわきに切れ込みができるため
    _sk.update_tag()
