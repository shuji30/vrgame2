# 水着のスポーティなコーデ一式を作る（Blender の中で exec する）
#   Swim_Top（青い半袖ラッシュガード：ラグラン袖は淡い柄、切り替えとわきは白）/ Swim_Skirt（淡い柄のフレアミニ）
#   Swim_Shorts（スカートの中の青いショートパンツ）/ Swim_Sandals（ビーチサンダル）
# すべてコレクション Outfit_Swim に入れる。地雷系（Outfit_Jirai）とカジュアル（Outfit_Casual）は隠すだけで残す。
# 体の隠す頂点は hidden_by_clothes。この服のぶんの控えは hidden_swim。
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

COL = bpy.data.collections.get("Outfit_Swim") or bpy.data.collections.new("Outfit_Swim")
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

BLUE = mat("S_Blue", (0.015, 0.30, 0.78), 0.62, **{"Sheen Weight": 0.2})
SWHITE = mat("S_White", (0.92, 0.93, 0.95), 0.6)
def pattern_mat():
    """白地に、淡いピンク・黄・水色がにじんだ柄"""
    mt = bpy.data.materials.get("S_Pattern") or bpy.data.materials.new("S_Pattern"); mt.use_nodes = True
    nt = mt.node_tree; N = nt.nodes
    for n in [n for n in N if n.name.startswith("Pt")]: N.remove(n)
    b = next(n for n in N if n.type == "BSDF_PRINCIPLED")
    tc = N.new("ShaderNodeAttribute"); tc.name = "PtCoord"; tc.attribute_type = 'GEOMETRY'; tc.attribute_name = "mk_pos"   # 基本の姿勢での位置（骨で動かしても柄が流れない）
    no = N.new("ShaderNodeTexNoise"); no.name = "PtNoise"; no.inputs["Scale"].default_value = 42; no.inputs["Detail"].default_value = 3
    rp = N.new("ShaderNodeValToRGB"); rp.name = "PtRamp"; el = rp.color_ramp.elements
    cols = ((0.30, (0.95, 0.95, 0.97)), (0.42, (0.98, 0.66, 0.74)), (0.50, (1.0, 0.92, 0.66)), (0.58, (0.55, 0.80, 0.98)), (0.70, (0.95, 0.95, 0.97)))
    el[0].position, el[0].color = cols[0][0], (*cols[0][1], 1); el[1].position, el[1].color = cols[-1][0], (*cols[-1][1], 1)
    for p, c in cols[1:-1]: e = el.new(p); e.color = (*c, 1)
    nt.links.new(tc.outputs["Vector"], no.inputs["Vector"]); nt.links.new(no.outputs[0], rp.inputs[0]); nt.links.new(rp.outputs[0], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.6; mt.diffuse_color = (0.93, 0.85, 0.9, 1); mt.use_backface_culling = False
    return mt
PAT = pattern_mat()
shoulder = joint("joint-l-shoulder"); dU = (elbow-shoulder).normalized()

# ── ラッシュガード（丸首・半袖・腰までの丈）────────────────
HEM = 0.935; SLV = 0.105
def LINE(y): return 1.350+(y+0.03)*0.36                 # えりの線（広めの丸首。後ろが少し高い）
def is_arm(c): return abs(c.x) > 0.17 and c.z > 1.08
def aproj(c): return (Vector((abs(c.x), c.y, c.z))-shoulder).dot(dU)
def top_sel(c):
    if is_arm(c): return aproj(c) < SLV+0.02
    return abs(c.x) < 0.25 and HEM-0.02 <= c.z <= LINE(c.y)+0.012
def top_final(c):
    if is_arm(c): return aproj(c) < SLV
    return abs(c.x) < 0.25 and HEM < c.z < LINE(c.y)
bm, tsel = from_body(top_sel)
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
# えりは 1 枚の平面（後ろが少し高い）。面の形のまま切るとふちがギザギザになるので、平面でメッシュを切ってから上を取る
CPL = (Vector((0, -0.03, LINE(-0.03))), Vector((0, -0.36, 1)).normalized())
_fs = [f for f in bm.faces if abs(f.calc_center_median().x) < 0.22 and f.calc_center_median().z > 1.24]
bmesh.ops.bisect_plane(bm, geom=list({v for f in _fs for v in f.verts})+list({e for f in _fs for e in f.edges})+_fs, plane_co=CPL[0], plane_no=CPL[1], dist=0.00005)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if abs(f.calc_center_median().x) < 0.22 and (f.calc_center_median()-CPL[0]).dot(CPL[1]) > 0], context='FACES')
bmesh.ops.delete(bm, geom=[f for f in bm.faces if not top_final(f.calc_center_median())], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
inner = [v for v in bm.verts if not v.is_boundary]
for _ in range(6): bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.normal_update()
for v in bm.verts:
    c = v.co; ax = abs(c.x)
    if v.is_boundary:
        if is_arm(c) and aproj(c) > SLV-0.03:           # 袖口
            s = 1 if c.x > 0 else -1; p = Vector((ax, c.y, c.z)); p += dU*(SLV-aproj(c))
            v.co = Vector((s*p.x, p.y, p.z))+v.normal*0.009
        elif c.z < 1.0:                                 # すそ
            v.co.z = HEM; v.co += Vector((v.normal.x, v.normal.y, 0))*0.011
        else:                                           # えり
            v.co.z = LINE(c.y); v.co += v.normal*0.004
    else:
        off = 0.006
        if is_arm(c): off += 0.004*ss(aproj(c)/0.05)    # 袖は少しゆるく
        else: off += 0.004*ss((1.0-c.z)/0.06)           # すそへ向かって少し広がる
        v.co += v.normal*off
push_out(bm, 0.004)
_side = [v for v in inner if not is_arm(v.co) and abs(v.co.x) > 0.085 and 0.99 < v.co.z < 1.30 and v.is_valid and not v.is_boundary]
for _ in range(30): bmesh.ops.smooth_vert(bm, verts=_side, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.normal_update()
for v in _side: v.co += v.normal*0.002
push_out(bm, 0.004, [v for v in _side if v.co.z < 1.115])
# 胸まわりの仕上げ。頂点を横や縦へは動かさず、前後（y）だけを決め直す。
# （胸の先はメッシュがとても細かい。3 方向にならすと頂点が 1 か所へ寄ってつぶれ、折り紙のような折れ線が出る。
#   辺をたどるならしでは逆に形が残る。正面から見た位置はそのままに、前後だけを距離の重みでならすのが安全）
import numpy as np
def ss_np(t): t = np.clip(t, 0, 1); return t*t*(3-2*t)
fr = [v for v in bm.verts if not is_arm(v.co) and v.co.y < 0.0 and abs(v.co.x) < 0.17 and HEM < v.co.z < 1.31 and not v.is_boundary]
Pf = np.array([v.co[:] for v in fr]); X = Pf[:, 0]; Z = Pf[:, 2]; Y = Pf[:, 1].copy()
D2 = (X[:, None]-X[None, :])**2+(Z[:, None]-Z[None, :])**2
def hf_smooth(Y, R, w, n):                               # 前後だけを、正面から見て近い頂点の平均へ寄せる（頂点の混みぐあいで割る）
    G = np.exp(-D2/R**2); G = G/G.sum(axis=1)[None, :]; G = G/G.sum(axis=1)[:, None]
    for _ in range(n): Y = Y+((G @ Y)-Y)*w
    return Y
WX = ss_np((0.150-np.abs(X))/0.045)*ss_np((-0.015-Pf[:, 1])/0.045)     # わき・背中側へは効かせない（面が横を向いている）
# 1) 胸の先のとがりを消す
Y = hf_smooth(Y, 0.022, WX*ss_np((Z-1.09)/0.04)*ss_np((1.30-Z)/0.04), 3)
# 2) 胸のトップから下は、体に張りつかせず、布がそのまま下へ落ちる形にする（胸の下のくびれを拾わない）。
#    トップの高さでの「いちばん前の線」を横方向になめらかにつなぎ（左右の胸の間も布が渡る）、そこから下へ垂らす。
#    下へ行くほど少しずつ体へ戻る（DRAPE_BACK）
DRAPE_BACK = 0.20
band0 = (Z > 1.12) & (Z < 1.26) & (np.abs(X) < 0.14)
ZA = float(Z[band0][Y[band0].argmin()])                  # 胸のトップの高さ
band = (np.abs(Z-ZA) < 0.018)
xs = np.linspace(-0.16, 0.16, 65)
ymin = np.array([Y[band & (np.abs(X-x) < 0.008)].min() if (band & (np.abs(X-x) < 0.008)).any() else 0.0 for x in xs])
Gx = np.exp(-((xs[:, None]-xs[None, :])/0.030)**2); ysm = (Gx @ ymin)/Gx.sum(axis=1)
yA = np.interp(X, xs, np.minimum(ysm, ymin*0.5+ysm*0.5))                 # 谷間は埋め、山は少しだけ丸める
yd = yA+DRAPE_BACK*(ZA-Z)
Y = Y+np.minimum(0.0, yd-Y)*WX*ss_np((ZA+0.005-Z)/0.035)
# 3) 体の面と垂れた面のつなぎ目に折れ線が出ないよう、前面全体をならす（すそとえりへ向かって弱める）
Y = hf_smooth(Y, 0.026, WX*ss_np((Z-HEM-0.004)/0.03)*ss_np((1.30-Z)/0.03), 3)
for v, y in zip(fr, Y): v.co.y = float(y)
# おなかから下は肌を隠していないので、ならした結果が体にもぐった所は外へ出す（胸は肌を隠してあるのでそのまま）
push_out(bm, 0.004, [v for v in fr if v.co.z < 1.115])
bmesh.ops.remove_doubles(bm, verts=[v for v in fr if 1.13 < v.co.z < 1.26 and v.co.y < -0.06], dist=0.0028)
bm.normal_update()
# 色の境目はメッシュを切ってから塗る（面の形のままだと境目がギザギザになる）
def cut(pco, pno, pred):
    fs = [f for f in bm.faces if pred(f.calc_center_median())]
    geom = list({v for f in fs for v in f.verts})+list({e for f in fs for e in f.edges})+fs
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector(pco), plane_no=Vector(pno).normalized(), dist=0.00005)
RG0 = (0.065, 1.392); RGS = 0.127/0.11; RGW = 0.009           # ラグランの線（えりからわきへ）と白い線の半幅
def ragz(ax): return RG0[1]-(ax-RG0[0])*RGS
# わきの白い切り替え：胴の軸（x = 0, y = AX_Y）のまわりの角度で区切る（正面から PH_F 度 〜 背中から PH_B 度の間）。
# 軸を通る平面で切るので、どの向きから見ても境目がまっすぐな縦の線になる
AX_Y = -0.030; PH_F = math.radians(54); PH_B = math.radians(50); SIDE_TOP = 1.275
def side_f(c, sgn): return sgn*c.x*math.cos(PH_F)+(c.y-AX_Y)*math.sin(PH_F)       # > 0 で前の境目より横
def side_b(c, sgn): return sgn*c.x*math.cos(PH_B)-(c.y-AX_Y)*math.sin(PH_B)       # > 0 で後ろの境目より横
def in_side(c): sgn = 1 if c.x > 0 else -1; return side_f(c, sgn) > 0 and side_b(c, sgn) > 0
for sgn in (1, -1):
    on = lambda c, sgn=sgn: c.x*sgn > 0.02
    for dz in (-RGW, RGW): cut((sgn*RG0[0], 0, RG0[1]+dz), (sgn*RGS, 0, 1), on)
    cut((sgn*0.17, 0, 0), (1, 0, 0), lambda c, sgn=sgn: c.x*sgn > 0.12 and c.z > 1.0)          # 袖と胴の境目
    cut((0, 0, SIDE_TOP), (0, 0, 1), lambda c, sgn=sgn: c.x*sgn > 0.06 and not is_arm(c))      # わきの白の上の端
    cut((0, 0, 1.08), (0, 0, 1), lambda c, sgn=sgn: c.x*sgn > 0.14)
    body_side = lambda c, sgn=sgn: c.x*sgn > 0.03 and not is_arm(c) and c.z < SIDE_TOP+0.02
    cut((0, AX_Y, 0), (sgn*math.cos(PH_F), math.sin(PH_F), 0), body_side)
    cut((0, AX_Y, 0), (sgn*math.cos(PH_B), -math.sin(PH_B), 0), body_side)
bm.normal_update()
for f in bm.faces:                                       # 色分け：ラグラン袖は柄、切り替えの線とわきは白
    c = f.calc_center_median(); ax = abs(c.x); zl = ragz(ax)
    if is_arm(c) or (ax > RG0[0] and c.z > zl+RGW): f.material_index = 1
    elif ax > RG0[0] and abs(c.z-zl) <= RGW: f.material_index = 2
    elif in_side(c) and c.z < min(SIDE_TOP, zl-RGW): f.material_index = 2
    else: f.material_index = 0
top_bvh = BVHTree.FromBMesh(bm)
top = newobj("Swim_Top", bm, [BLUE, PAT, SWHITE], recalc=False)
sm = top.modifiers.new("Solidify", 'SOLIDIFY'); sm.thickness = 0.0025; sm.offset = 1.0
to_hide |= erode({i for i in tsel if top_final(co[i])}, 2)

# ── 胸のロゴ（SPORT：本人から見て左の胸に、白い文字）────────────────
cu = bpy.data.curves.new("_logo", 'FONT'); cu.body = "SPORT"; cu.size = 0.019; cu.align_x = 'CENTER'
_to = bpy.data.objects.new("_logo", cu); bpy.context.scene.collection.objects.link(_to); bpy.context.view_layer.update()
_lm = bpy.data.meshes.new_from_object(_to.evaluated_get(bpy.context.evaluated_depsgraph_get()))
bpy.data.objects.remove(_to, do_unlink=True); bpy.data.curves.remove(cu)
bm = bmesh.new(); bm.from_mesh(_lm); bpy.data.meshes.remove(_lm)
LOGO_X = 0.064; LOGO_Z = 1.236
for v in bm.verts:                                       # 文字を正面から服の表面へ貼りつける
    x = LOGO_X+v.co.x; z = LOGO_Z+v.co.y
    loc, nor, idx, dd = top_bvh.ray_cast(Vector((x, -0.6, z)), Vector((0, 1, 0)))
    v.co = loc+Vector((0, -0.0042, 0)) if loc else Vector((x, -0.2, z))
newobj("Swim_Logo", bm, [SWHITE], smooth=False, recalc=False)

# ── ショートパンツ（スカートの中）──────────────────────
SH_B = 0.715                                             # すその高さ
def shorts_sel(c): return abs(c.x) < 0.22 and SH_B-0.03 <= c.z <= 0.990
bm, isel = from_body(shorts_sel)
# すそは面の形のままだとギザギザになるので、水平に切りそろえる
bmesh.ops.bisect_plane(bm, geom=bm.verts[:]+bm.edges[:]+bm.faces[:], plane_co=Vector((0, 0, SH_B)), plane_no=Vector((0, 0, 1)), clear_inner=True, dist=0.00005)
bm.normal_update()
for v in bm.verts: v.co += v.normal*(0.003 if v.co.z > SH_B+0.0005 else 0.0045)
newobj("Swim_Shorts", bm, [BLUE], recalc=False)
to_hide |= erode({i for i in isel if co[i].z > SH_B}, 2)

# ── フレアのミニスカート ───────────────────────────
NA = 240; CY = -0.030
ZT = [0.80+0.01*i for i in range(23)]
raw = [[radial(Vector((0, CY, z)), 2*math.pi*j/NA) for j in range(NA)] for z in ZT]
env = [r[:] for r in raw]
top_i = min(range(len(ZT)), key=lambda i: abs(ZT[i]-0.95))
for i in range(top_i-1, -1, -1): env[i] = [max(env[i][j], env[i+1][j]) for j in range(NA)]
def tab(T, z, j):
    f = (max(ZT[0], min(ZT[-1], z))-ZT[0])/0.01; i = min(len(ZT)-2, int(f)); t = f-i
    return lerp(T[i][j], T[i+1][j], t)
def P(r, j, z): a = 2*math.pi*j/NA; return Vector((r*math.cos(a), CY+r*math.sin(a), z))
SK_T = 0.942; SK_B = 0.728; NR = 16; rings = []
for i in range(NR+1):
    t = i/NR; z = lerp(SK_T, SK_B, t); row = []
    for j in range(NA):
        a = 2*math.pi*j/NA
        w = math.sin(14*a+0.6)+0.35*math.sin(29*a+2.0)
        r = tab(env, z, j)+0.007+0.062*t**0.9+(0.002+0.017*t**1.5)*w
        if t < 0.12: r = lerp(tab(raw, z, j)+0.0055, r, t/0.12)
        row.append(P(r, j, z-0.004*t*math.cos(29*a)))
    rings.append(row)
bm = bmesh.new(); loft(bm, rings, True, lambda i, j: 0)
newobj("Swim_Skirt", bm, [PAT])

# ── ビーチサンダル（足の輪郭に合わせて作る）──────────────────
HS = 0.020                                               # 底の厚み（足の裏は約 0.022 の高さ）
toe1 = joint("joint-l-toe-1-1"); toe2 = joint("joint-l-toe-2-1")
fp = [(co[i].x, co[i].y) for i in range(len(co)) if inb[i] and co[i].x > 0.05 and co[i].z < 0.060]
def hull(P):                                             # 足を上から見た輪郭（凸包）
    P = sorted(set(P))
    def cr(o, a, b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lo = []; up = []
    for p in P:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(P):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1]+up[:-1]                               # 反時計回り
H = [Vector((x, y, 0)) for x, y in hull(fp)]
def resample_loop(P, n):
    L = [0.0]
    for i in range(len(P)): L.append(L[-1]+(P[(i+1) % len(P)]-P[i]).length)
    out = []; j = 0
    for k in range(n):
        t = L[-1]*k/n
        while L[j+1] < t: j += 1
        out.append(P[j].lerp(P[(j+1) % len(P)], (t-L[j])/max(1e-9, L[j+1]-L[j])))
    return out
NO = 64; OUT = resample_loop(H, NO)
for _ in range(4): OUT = [(OUT[i-1]+OUT[i]*2+OUT[(i+1) % NO])/4 for i in range(NO)]
cen = sum(OUT, Vector())/NO
def grown(P, dd):                                        # 輪郭を外へ dd だけ広げる
    out = []
    for i in range(NO):
        t = (P[(i+1) % NO]-P[i-1]).normalized(); out.append(P[i]+Vector((t.y, -t.x, 0))*dd)
    return out
EDGE = grown(OUT, 0.009)                                 # 足より少し大きい底
def foot_top(x, y):
    loc, nor, idx, dd = bvh.ray_cast(Vector((x, y, 0.30)), Vector((0, 0, -1)))
    return loc.z if loc and loc.z < 0.15 else None
def edge_x(y, side):                                     # 高さ y での底のふち（side: -1 内側 / +1 外側）
    xs = [p.x for p in EDGE if abs(p.y-y) < 0.012 and (p.x-cen.x)*side > 0]
    return (max(xs) if side > 0 else min(xs)) if xs else cen.x+side*0.04
bm = bmesh.new(); RS = 0.0040
for sgn in (1, -1):
    def M(p, z=None): return Vector((sgn*p.x, p.y, p.z if z is None else z))
    rings = [[M(cen+(p-cen)*sc, z) for p in EDGE] for z, sc in ((0.0, 0.965), (0.004, 1.0), (HS-0.004, 1.0), (HS, 0.975))]
    if sgn < 0: rings = [r[::-1] for r in rings]
    vs = loft(bm, rings, True, lambda i, j: 0)
    fan(bm, vs[0], M(cen, 0.0), 0); fan(bm, vs[-1], M(cen, HS), 0)
    # 鼻緒：親指と人さし指の間から、甲に沿って左右のふちへ
    web = Vector(((toe1.x+toe2.x)/2, min(toe1.y, toe2.y)-0.006, 0))
    zt = max(foot_top(web.x-0.008, web.y+0.012) or 0.04, foot_top(web.x+0.008, web.y+0.012) or 0.04)+RS
    tube(bm, [M(web, HS-0.003), M(web, zt)], RS, 8, 1)
    for side in (-1, 1):
        ya = -0.100; anc = Vector((edge_x(ya, side)-side*0.006, ya, 0)); pts = []; N_ = 28
        for k in range(N_+1):
            t = k/N_; p = web.lerp(anc, t)+Vector((side*0.012*math.sin(math.pi*t), 0, 0))
            z = max([foot_top(p.x+dx, p.y+dy) or 0.0 for dx in (-0.004, 0, 0.004) for dy in (-0.004, 0, 0.004)])
            pts.append(Vector((p.x, p.y, max(HS, z)+RS)))
        pts[0].z = zt
        zs = [p.z for p in pts]
        for _ in range(3):                               # なめらかにしてから、足にもぐった所だけ持ち上げる
            sm_ = [zs[0]]+[(zs[i-1]+zs[i]*2+zs[i+1])/4 for i in range(1, N_)]+[zs[-1]]
            zs = [max(a_, b_) for a_, b_ in zip(sm_, [p.z for p in pts])]
        # 付け根：足の横を回りこんで、ななめに底へ下りる（まっすぐ棒のように立たせない）
        K = 7; z0 = zs[N_-K]
        for q in range(1, K+1):
            t = q/K; zs[N_-K+q] = lerp(z0, HS-0.003, t**1.6); pts[N_-K+q].x += side*0.007*math.sin(math.pi*min(1, t*1.15))
        tube(bm, [M(Vector((p.x, p.y, z))) for p, z in zip(pts, zs)], RS, 8, 1)
sandals = newobj("Swim_Sandals", bm, [SWHITE, BLUE])

# ── 体を隠す・前の服を片づける ─────────────────────
body.remove(list(to_hide)); hid.add(list(to_hide), 1.0, 'REPLACE')
hs = ob.vertex_groups.get("hidden_swim") or ob.vertex_groups.new(name="hidden_swim")
hs.remove(list(range(len(me.vertices)))); hs.add(list(to_hide), 1.0, 'REPLACE')
for cn in ("Outfit_Jirai", "Outfit_Casual", "Outfit_Black"):
    cc = bpy.data.collections.get(cn)
    if cc:
        for o in cc.objects: o.hide_viewport = True; o.hide_render = True
for o in COL.objects:                                    # 柄の位置を頂点に書きこむ（柄は、動かす前のこの位置から決まる）
    if o.type != 'MESH' or o.parent_type == 'BONE': continue
    at = o.data.attributes.get("mk_pos") or o.data.attributes.new("mk_pos", 'FLOAT_VECTOR', 'POINT')
    flat = [0.0]*(len(o.data.vertices)*3); o.data.vertices.foreach_get("co", flat); at.data.foreach_set("vector", flat)
print("swim outfit built. hidden", len(to_hide), {o.name: len(o.data.polygons) for o in COL.objects})
if _rig:                                                 # 作り直した物を骨組みに付け直し、姿勢を元に戻す
    exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bind_rig.py", encoding="utf-8").read(), "bind_rig.py", "exec"), {"__name__": "__main__"})
    _rig.data.pose_position = _pose
