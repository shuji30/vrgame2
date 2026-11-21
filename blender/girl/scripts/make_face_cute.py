# 顔を「かわいい」寄りに整える仕上げ（Blender の中で exec する）。何度実行してもよい。
#   set_eye_tilt.py・fit_face.py・make_makeup_jirai.py を実行すると、唇の厚み・チーク・シャドウが元に戻るので、
#   そのあとに必ずこれを実行する。
#   すること：唇を薄く（下唇は custom-lip-thin）／ほお・鼻・あごの形／肌とメイクの色／涙袋なし／
#             目の下のたるみをならす（custom-undereye-smooth）／鼻の下のしわをならす（custom-nosebase-smooth）／
#             表情のシェイプキーの作り直し
# 使い方: exec(open(path, encoding="utf-8").read(), {"EXPRESSIONS": True})
import bpy, numpy as np

D = "C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\"
EXPRESSIONS = globals().get("EXPRESSIONS", True)
LIP_LOWER_UP = globals().get("LIP_LOWER_UP", 0.0018)     # 下唇の下のふちを上げる量（m）。大きいほど下唇が薄い
LIP_UPPER_DOWN = globals().get("LIP_UPPER_DOWN", -0.0007)  # 上唇の上のふちを下げる量
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]
SK = bpy.data.materials["Skin"].node_tree; N = SK.nodes

# ── 形（シェイプキーの値） ──
V = {"custom-duck-lip": 0.0, "mouth-upperlip-volume-incr": 0.15, "mouth-lowerlip-volume-incr": 0.0, "mouth-scale-horiz-decr": 0.15,
     "mouth-scale-vert-decr": 0.35, "mouth-trans-backward": 0.6, "mouth-angles-up": 0.1,
     "custom-cheek-puff": 0.3, "l-cheek-volume-incr": 0.7, "r-cheek-volume-incr": 0.7, "l-cheek-inner-incr": 0.2, "r-cheek-inner-incr": 0.2,
     "nose-greek-incr": 0.1, "nose-scale-depth-incr": 0.15, "nose-scale-vert-decr": 0.75, "nose-scale-horiz-decr": 0.8, "nose-point-up": 0.45,
     "nose-trans-forward": 0.0, "nose-trans-up": -0.6, "chin-width-decr": 0.35, "custom-jaw-slim": 0.4, "head-invertedtriangular": 0.0, "chin-jaw-drop-decr": 0.4,
     "custom-tear-bag": 0.0, "l-cheek-bones-decr": 0.6, "r-cheek-bones-decr": 0.6, "l-eye-bag-decr": 1.3, "r-eye-bag-decr": 1.3}
V.update(globals().get("KEYS", {}))
for k, v in V.items():
    kb[k].slider_min = min(kb[k].slider_min, v); kb[k].slider_max = max(kb[k].slider_max, v); kb[k].value = v
for n in ("custom-lip-thin", "custom-undereye-smooth", "custom-nosebase-smooth", "custom-cheekbone", "custom-forehead-round", "custom-nasolabial-smooth", "custom-eye-slant"):
    if n in kb: kb[n].value = 0

def rest():
    """基本の姿勢・隠している所も含めた、いまの形の頂点の位置"""
    was = rig.data.pose_position; rig.data.pose_position = 'REST'
    mk = next(m for m in ob.modifiers if m.type == 'MASK'); mk.show_viewport = False; bpy.context.view_layer.update()
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
    n = len(m.vertices); co = np.zeros(n*3); m.vertices.foreach_get("co", co); ev.to_mesh_clear()
    mk.show_viewport = True; rig.data.pose_position = was
    return co.reshape(n, 3)
def ss(x): x = np.clip(x, 0, 1); return x*x*(3-2*x)
def key(name, delta):
    k = kb.get(name) or ob.shape_key_add(name=name, from_mix=False)
    b = np.zeros(len(me.vertices)*3); kb["Basis"].data.foreach_get("co", b)
    k.data.foreach_set("co", (b.reshape(-1, 3)+delta).ravel()); k.value = 1.0; me.update()
names = [s.name for s in ob.material_slots]; NV = len(me.vertices)
skin = np.zeros(NV, bool); lipm = np.zeros(NV, bool)
for p in me.polygons:
    if p.material_index == names.index("Skin"): skin[list(p.vertices)] = True
    if p.material_index == names.index("Lips"): lipm[list(p.vertices)] = True
_bad = {g.index for g in ob.vertex_groups if g.name.startswith(("helper-", "joint-"))}
for v in me.vertices:
    if any(g.group in _bad and g.weight > 0.5 for g in v.groups): skin[v.index] = False
ed = np.zeros(len(me.edges)*2, int); me.edges.foreach_get("vertices", ed); ed = ed.reshape(-1, 2); ed = ed[skin[ed[:, 0]] & skin[ed[:, 1]]]
cnt = np.zeros(NV); np.add.at(cnt, ed[:, 0], 1); np.add.at(cnt, ed[:, 1], 1); cnt = np.maximum(cnt, 1)
def smooth(co, w, iters):
    """重み w の所だけ、まわりの頂点の平均へ寄せてならす"""
    P = co.copy()
    for _ in range(iters):
        acc = np.zeros((NV, 3)); np.add.at(acc, ed[:, 0], P[ed[:, 1]]); np.add.at(acc, ed[:, 1], P[ed[:, 0]])
        P = P+(acc/cnt[:, None]-P)*0.5*w[:, None]
    return P-co

# ── 目の傾き：まぶた（目のまわりの肌とまつ毛）を、目頭側は下へ・目尻側は上へずらす。目の玉は動かさない ──
#   既存のキー（eye-corner1-down・eye-corner2-up・fit_face の EYE_TILT）は、目頭・目尻そのものの位置がほとんど動かないため
EYE_IN_DOWN = globals().get("EYE_IN_DOWN", 0.0020); EYE_OUT_UP = globals().get("EYE_OUT_UP", 0.0008)      # 目頭を下げる量・目尻を上げる量（m）
co = rest(); AX = np.abs(co[:, 0]); Z = co[:, 2]; Y = co[:, 1]
_EX = N["LidCenter"].inputs["X"].default_value; _EZ = N["LidCenter"].inputs["Z"].default_value
_eg = {g.index for g in ob.vertex_groups if g.name in ("helper-l-eye", "helper-r-eye")}
_ball = np.zeros(NV, bool)
for v in me.vertices:
    if any(g.group in _eg and g.weight > 0.5 for g in v.groups): _ball[v.index] = True
_dx = AX-_EX; _L = np.sqrt(_dx**2+(Z-_EZ)**2)
w = (1-ss((_L-0.020)/0.020))*(Y < -0.07)*(~_ball)
dl = np.zeros((NV, 3)); dl[:, 2] = np.where(_dx < 0, -EYE_IN_DOWN*ss(-_dx/0.015), EYE_OUT_UP*ss(_dx/0.015))*w
# 目の形をひし形に：下まぶたの目頭側を持ち上げて、目頭をとがらせる（下まぶたが平らで、目が三角に見えるのを直す）
EYE_LOW_IN_UP = globals().get("EYE_LOW_IN_UP", 0.0030)
_lu = bpy.data.materials["Lash"].node_tree.nodes; _lw = bpy.data.materials["LashLower"].node_tree.nodes
def _crv(n): return n["Math.004"].inputs[1].default_value*_dx*_dx+n["LashSlope"].inputs[1].default_value*_dx+n["LashBase"].inputs[1].default_value
_mid = _EZ+(_crv(_lu)+_crv(_lw))/2                       # 上下のまぶたのふちのまん中（前回合わせた線から）
_lowz = _EZ+_crv(_lw)
dl[:, 2] += EYE_LOW_IN_UP*ss((-_dx-0.004)/0.010)*ss((_mid-Z)/0.0015)*(1-ss((_lowz-Z)/0.012))*(1-ss((-_dx-0.018)/0.008))*(Y < -0.07)*(~_ball)
key("custom-eye-slant", dl)

# ── 唇を薄く（合わせ目は動かさず、上唇の上のふちを下げ、下唇の下のふちを上げる） ──
co = rest(); AX = np.abs(co[:, 0]); Z = co[:, 2]; Y = co[:, 1]
L = co[lipm]; AXL = np.abs(L[:, 0])
cen = L[AXL < 0.004]; deep = cen[np.argsort(-cen[:, 1])][:4]; ZC = float(deep[:, 2].mean()); YS = float(deep[:, 1].mean())
W = float(AXL.max()); ZK = float(L[AXL > W-0.002][:, 2].mean())
front = L[L[:, 1] < YS+0.002]; ctr = front[np.abs(front[:, 0]) < 0.006]; up0 = float(ctr[:, 2].max())-ZC; lo0 = ZC-float(ctr[:, 2].min())
tx = np.clip(1-(AX/W)**2, 0, 1); seam = ZC+(ZK-ZC)*(np.clip(AX/W, 0, 1))**2
top = seam+up0*tx**0.6; bot = seam-lo0*tx**0.6; dz = np.zeros(NV)
a = Z >= seam; dz[a] = -LIP_UPPER_DOWN*np.where(Z[a] <= top[a], (Z[a]-seam[a])/np.maximum(top[a]-seam[a], 1e-5), 1-ss((Z[a]-top[a])/0.012))
b = ~a; dz[b] = LIP_LOWER_UP*np.where(Z[b] >= bot[b], (seam[b]-Z[b])/np.maximum(seam[b]-bot[b], 1e-5), 1-ss((bot[b]-Z[b])/0.016))
dz *= tx*ss((YS+0.004-Y)/0.004)*(AX < W)
dl = np.zeros((NV, 3)); dl[:, 2] = dz; key("custom-lip-thin", dl)
print("lips mm: upper", round((up0-LIP_UPPER_DOWN)*1000, 1), "lower", round((lo0-LIP_LOWER_UP)*1000, 1))

# ── 目の下のたるみをならす（下まぶたのふちより下だけ） ──
co = rest(); AX = np.abs(co[:, 0]); Z = co[:, 2]; Y = co[:, 1]
EX = N["LidCenter"].inputs["X"].default_value; EZ = N["LidCenter"].inputs["Z"].default_value; TZ = N["TearCenter"].inputs[1].default_value[2]
_ll = bpy.data.materials["LashLower"].node_tree.nodes        # 下まぶたのふちの線（前回合わせた 2 次曲線）。そのすぐ下からならして、涙袋を残さない
_d = AX-EX; ZL = EZ+_ll["Math.004"].inputs[1].default_value*_d*_d+_ll["LashSlope"].inputs[1].default_value*_d+_ll["LashBase"].inputs[1].default_value
ZL = np.where(np.abs(_d) < 0.020, ZL, TZ+0.001)
w = ss((ZL-0.0012-Z)/0.004)*ss((Z-(TZ-0.032))/0.010)*ss((AX-0.005)/0.005)*ss((EX+0.034-AX)/0.010)*(Y < -0.085)*skin
key("custom-undereye-smooth", smooth(co, w, 60))

# ── 鼻の下・小鼻のわきのしわをならす（上唇の上から鼻先の高さまで） ──
co = rest(); AX = np.abs(co[:, 0]); Z = co[:, 2]; Y = co[:, 1]
f = skin & (Z > EZ-0.085) & (Z < EZ+0.035) & (AX < 0.004); tip = np.where(f)[0][np.argmin(Y[f])]; ZN = Z[tip]; YN = Y[tip]
LT = Z[lipm & (AX < 0.006)].max()
w = ss((Z-(LT+0.0005))/0.003)*ss((ZN+0.002-Z)/0.006)*ss((0.032-AX)/0.010)*(Y < YN+0.045)*skin*(~lipm)
key("custom-nosebase-smooth", smooth(co, w, 14))

# ── ほうれい線をならす（小鼻のわきから口角の外・下まで。唇と鼻の穴は動かさない） ──
co = rest(); AX = np.abs(co[:, 0]); Z = co[:, 2]; Y = co[:, 1]
w = ss((AX-0.010)/0.008)*ss((0.058-AX)/0.012)*ss((Z-(ZC-0.026))/0.010)*ss((ZN+0.008-Z)/0.008)*(Y < YN+0.050)*skin*(~lipm)
key("custom-nasolabial-smooth", smooth(co, w, 30))

# ── ほお骨：目尻の下・外側に、なだらかな高まりを作る（目の横は張り出させない） ──
CHEEKBONE = globals().get("CHEEKBONE", 0.0030)             # 高さ（m）
co = rest(); AX = np.abs(co[:, 0]); Z = co[:, 2]; Y = co[:, 1]
_r = rig.data.pose_position; rig.data.pose_position = 'REST'; _mk = next(m for m in ob.modifiers if m.type == 'MASK'); _mk.show_viewport = False; bpy.context.view_layer.update()
_ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _m = _ev.to_mesh(); nr = np.zeros(len(_m.vertices)*3); _m.vertices.foreach_get("normal", nr); _ev.to_mesh_clear(); _mk.show_viewport = True; rig.data.pose_position = _r
if len(nr) == NV*3:
    nr = nr.reshape(NV, 3)
    w = np.exp(-(((AX-(EX+0.024))/0.017)**2+((Z-(EZ-0.026))/0.013)**2))*(Y < -0.06)*skin
    w[w < 0.02] = 0
    dl = nr*(CHEEKBONE*0.6*w)[:, None]
    # 正面から見た輪郭：目の横〜こめかみ（目より少し上）を内へ引き、ほお骨の高さ（目より下）を外へ出す
    TEMPLE_IN = globals().get("TEMPLE_IN", 0.0050); CHEEK_OUT = globals().get("CHEEK_OUT", 0.0035)
    side = ss((AX-0.035)/0.030)*ss((0.035-Y)/0.060)*skin          # 目の玉・まつ毛は動かさない
    dx = (-TEMPLE_IN*np.exp(-((Z-(EZ+0.014))/0.020)**2)+CHEEK_OUT*np.exp(-((Z-(EZ-0.024))/0.013)**2))*side
    dl[:, 0] += np.sign(co[:, 0])*dx
    key("custom-cheekbone", dl)

# ── おでこに丸みをつける：眉の上から生えぎわまでを、まん中ほど前へ出す ──
FOREHEAD = globals().get("FOREHEAD", 0.0060)               # 前へ出す量（m）
co = rest(); AX = np.abs(co[:, 0]); Z = co[:, 2]; Y = co[:, 1]
w = np.exp(-((AX/0.050)**2+((Z-(EZ+0.050))/0.030)**2))*ss((Z-(EZ+0.012))/0.015)*ss((-0.02-Y)/0.05)*skin
w[w < 0.01] = 0
dl = np.zeros((NV, 3)); dl[:, 1] = -FOREHEAD*w; dl[:, 2] = FOREHEAD*0.15*w
key("custom-forehead-round", dl)

# ── 肌・メイク ──
a = N.get("MkRestPos") or N.new("ShaderNodeAttribute"); a.name = "MkRestPos"; a.attribute_type = "GEOMETRY"; a.attribute_name = "mk_pos"
for n in N:                                              # 模様が位置を読めるようにつなぎ直す（外れるとチークもシャドウも消える）
    if n.type == "SEPXYZ" and not n.inputs[0].is_linked: SK.links.new(a.outputs["Vector"], n.inputs[0])
N["CheekMix"].inputs[6].default_value = (0.86, 0.63, 0.53, 1)            # 肌：明るく
N["CheekMix"].inputs[7].default_value = (0.96, 0.42, 0.45, 1)            # チーク：やわらかいピンク
N["CheekFalloff"].inputs["To Min"].default_value = 0.30
N["MkNoseFall"].inputs[3].default_value = 0.10                           # 鼻の赤みはひかえめ
N["MkShadowSub"].inputs[1].default_value = (EX+0.003, 0, EZ+0.008)       # アイシャドウは上まぶた寄りに、薄く
N["MkShadowFall"].inputs[3].default_value = 0.22; N["MkShadowMix"].inputs[7].default_value = (0.80, 0.50, 0.42, 1)
N["MkShadow2Sub"].inputs[1].default_value = (EX+0.021, 0, EZ+0.005)
N["MkShadow2Fall"].inputs[3].default_value = 0.35; N["MkShadow2Mix"].inputs[7].default_value = (0.62, 0.36, 0.28, 1)
N["TearRange"].inputs["To Min"].default_value = 0.0                      # 涙袋の明るい色なし
pb = N["Principled BSDF"]; pb.inputs["Subsurface Weight"].default_value = 0.3; pb.inputs["Roughness"].default_value = 0.45
pb.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.2)
LP = bpy.data.materials["Lips"].node_tree.nodes; lb = next(n for n in LP if n.type == "BSDF_PRINCIPLED")
LP["MkSub"].inputs[1].default_value = ZC; LP["MkRange"].inputs[2].default_value = 0.011
LP["MkMix"].inputs[6].default_value = (0.78, 0.24, 0.27, 1); LP["MkMix"].inputs[7].default_value = (0.88, 0.40, 0.40, 1)
lb.inputs["Coat Weight"].default_value = 0.3; lb.inputs["Roughness"].default_value = 0.3

for _mn, _a, _b in (("Lash", 0.00297, 0.00702), ("LashLower", -0.00252, -0.00528)):       # まつ毛の長さ（上・下）
    _n = bpy.data.materials[_mn].node_tree.nodes["LashLen"]; _n.inputs["To Min"].default_value = _a; _n.inputs["To Max"].default_value = _b
def run(f): exec(compile(open(D+f, encoding="utf-8").read(), D+f, "exec"), {"__name__": "__main__"})
if EXPRESSIONS: run("make_expressions.py")
run("bake_face_pos.py")
for n in N:
    if n.type == "SEPXYZ" and not n.inputs[0].is_linked: SK.links.new(N["MkRestPos"].outputs["Vector"], n.inputs[0])
# ── 眉を肌の表面に沿わせ直す（おでこやほおの形を変えると、眉が肌にもぐるため。高さは変えない） ──
from mathutils import Vector
_br = bpy.data.objects.get("Girl_Brows")
if _br:
    _r = rig.data.pose_position; rig.data.pose_position = 'REST'; bpy.context.view_layer.update()
    _ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    _ks = _br.data.shape_keys.key_blocks if _br.data.shape_keys else None
    for _i, _v in enumerate(_br.data.vertices):
        _c = _ks["Basis"].data[_i].co if _ks else _v.co
        _hit, _loc, _nor, _idx = _ev.ray_cast(Vector((_c.x, -0.5, _c.z)), Vector((0, 1, 0)))
        if not _hit: continue
        _d = (_loc.y-0.0012)-_c.y
        if _ks:
            for _k in _ks: _k.data[_i].co.y += _d
            _v.co = _ks["Basis"].data[_i].co
        else: _v.co.y += _d
    _br.data.update(); rig.data.pose_position = _r
# ── アイライン・二重の線・まつ毛の生えぎわを、実際の目の開きに合わせ直す ──
#   正面から光線を当てて、目の玉が見えている範囲（上のふち・下のふち・目頭・目尻）を測り、2 次曲線を当てはめる。
#   （目の形を大きく変えると、set_eye_tilt.py の追いかけ方では線がまぶたから離れていくため）
def fit_lid_lines():
    from mathutils.bvhtree import BVHTree
    _r = rig.data.pose_position; rig.data.pose_position = 'REST'; bpy.context.view_layer.update()
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
    vs = [v.co.copy() for v in m.vertices]; nm = [s.name for s in ob.material_slots]
    ps = [tuple(q.vertices) for q in m.polygons if not nm[q.material_index].startswith("Lash")]
    pm = [nm[q.material_index] for q in m.polygons if not nm[q.material_index].startswith("Lash")]
    ev.to_mesh_clear(); rig.data.pose_position = _r
    bvh = BVHTree.FromPolygons(vs, ps)
    cx = N["LidCenter"].inputs["X"].default_value; cz = N["LidCenter"].inputs["Z"].default_value
    pts = []
    for dx in np.arange(-0.022, 0.0261, 0.001):
        zz = [z for z in np.arange(cz-0.014, cz+0.016, 0.00025)
              if (lambda h: h[0] is not None and pm[h[2]].startswith("Eye"))(bvh.ray_cast(Vector((cx+dx, -0.5, z)), Vector((0, 1, 0))))]
        if zz: pts.append((dx, max(zz)-cz, min(zz)-cz))
    if len(pts) < 8: print("lid fit skipped"); return
    P = np.array(pts); xin = float(P[0, 0]); xout = float(P[-1, 0])
    A = np.vstack([P[:, 0]**2, P[:, 0], np.ones(len(P))]).T
    ua, ub, uc = [float(v) for v in np.linalg.lstsq(A, P[:, 1], rcond=None)[0]]
    la, lb, lc = [float(v) for v in np.linalg.lstsq(A, P[:, 2], rcond=None)[0]]
    # 肌：アイライン（上のふちのすぐ上）と二重の線
    N["LidMULTIPLY.007"].inputs[1].default_value = ua; N["LidMULTIPLY.008"].inputs[1].default_value = ub; N["LidADD.003"].inputs[1].default_value = uc+0.0007
    N["LidMULTIPLY.001"].inputs[1].default_value = ua*0.88; N["LidMULTIPLY.002"].inputs[1].default_value = ub; N["LidADD.001"].inputs[1].default_value = uc+0.0034
    D0 = xout-0.0005
    for a_, b_ in (("LidWinA", "LidWinB"), ("LidWinA.001", "LidWinB.001")):
        N[a_].inputs["From Min"].default_value = xin-0.0005; N[a_].inputs["From Max"].default_value = xin+0.0020
        N[b_].inputs["From Min"].default_value = D0; N[b_].inputs["From Max"].default_value = D0+0.0020
    # まつ毛の生えぎわ（上・下）
    for mn, (a_, b_, c_) in (("Lash", (ua, ub, uc)), ("LashLower", (la, lb, lc))):
        LN = bpy.data.materials[mn].node_tree.nodes
        LN["Math.004"].inputs[1].default_value = a_; LN["LashSlope"].inputs[1].default_value = b_; LN["LashBase"].inputs[1].default_value = c_
    # メイクで描き足した線：目尻の跳ね上げと、下まぶたのふちの線
    if "MkWingLine" in N:
        SL = 2*ua*D0+ub+0.45; LEN = 0.0045; Z0 = ua*D0*D0+ub*D0+uc+0.0007        # 上のふちの流れより少し上向きに跳ね上げる
        N["MkWingLine"].inputs[1].default_value = SL; N["MkWingLine"].inputs[2].default_value = Z0-D0*SL
        N["MkWingWidth"].inputs[1].default_value = D0; N["MkWingWidth"].inputs[2].default_value = D0+LEN
        N["MkWingA"].inputs[1].default_value = D0-0.003; N["MkWingA"].inputs[2].default_value = D0-0.001
        N["MkWingB"].inputs[1].default_value = D0+LEN-0.002; N["MkWingB"].inputs[2].default_value = D0+LEN
        N["MkLowQuad"].inputs[1].default_value = la; N["MkLowQuad"].inputs[2].default_value = lc-0.0006; N["MkLowLin"].inputs[1].default_value = lb
        N["MkLowA"].inputs[1].default_value = xin+0.0020; N["MkLowA"].inputs[2].default_value = xin+0.0055
        N["MkLowB"].inputs[1].default_value = D0-0.001; N["MkLowB"].inputs[2].default_value = D0+0.002
    print("lid lines fitted. inner", round(xin*1000, 1), round(float(P[0, 1]+P[0, 2])*500, 1), "outer", round(xout*1000, 1), round(float(P[-1, 1]+P[-1, 2])*500, 1),
          "tilt deg", round(float(np.degrees(np.arctan2((P[-1, 1]+P[-1, 2])/2-(P[0, 1]+P[0, 2])/2, xout-xin))), 1))
fit_lid_lines()
bpy.context.view_layer.update()
print("cute face done")
