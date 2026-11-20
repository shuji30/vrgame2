# 表情のシェイプキーを作る（Blender の中で exec する）。顔の形（fit_face.py・set_eye_tilt.py など）を変えたら実行し直す。
#   exp-aa / exp-ih / exp-ou / exp-ee / exp-oh … 口の形（あ・い・う・え・お）
#   exp-happy（笑顔）/ exp-surprised（驚き）/ exp-blink（まばたき）
# 名前は VRM の表情（happy / surprised / aa / ih / ou / ee / oh / blink）に合わせてある。
# 作り方：基本の姿勢・表情なしの形から、頂点をどれだけ動かすかを式で決める。
#   あごを開く  … 耳の前あたりを軸に、下あご（下唇・あご・下の歯・舌）を回す
#   口の幅      … 口のまわりを左右に広げる／すぼめる
#   口をとがらす … 唇を前へ出す
#   口角を上げる … 口角とほおを持ち上げる
#   まぶた      … 上まぶたのふちを下まぶたの線まで下ろす（目の玉にめり込まないよう、玉の外へ出す）
# 口の中は暗い色にする。歯と舌は体のメッシュに入っているが、位置が合わないので隠したままにする。
import bpy, math
import numpy as np
_rig = bpy.data.objects.get("Girl_Rig"); _pose = _rig.data.pose_position if _rig else None
if _rig: _rig.data.pose_position = 'REST'; bpy.context.view_layer.update()

ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks
NAMES = ("aa", "ih", "ou", "ee", "oh", "happy", "surprised", "blink")
for n in NAMES:
    if "exp-"+n in kb: kb["exp-"+n].value = 0
mk = next(m for m in ob.modifiers if m.type == 'MASK'); mk.show_viewport = False; bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); e = ob.evaluated_get(dg); m = e.to_mesh()
co = np.array([v.co[:] for v in m.vertices]); nrm = np.array([v.normal[:] for v in m.vertices]); e.to_mesh_clear(); mk.show_viewport = True
gi = {g.name: g.index for g in ob.vertex_groups}
def mem(n): return np.array(sorted(v.index for v in me.vertices if any(g.group == gi[n] and g.weight > 0.5 for g in v.groups)), dtype=int)
def ss(t): t = np.clip(t, 0, 1); return t*t*(3-2*t)
NV = len(co); X = co[:, 0]; Y = co[:, 1]; Z = co[:, 2]; AX = np.abs(X); SG = np.sign(X)

# ── 歯・舌・口の中を見えるようにする ──
def mat(name, col, rough):
    mt = bpy.data.materials.get(name) or bpy.data.materials.new(name); mt.use_nodes = True
    b = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough; mt.diffuse_color = (*col, 1)
    if name not in [s.name for s in ob.material_slots]: me.materials.append(mt)
    return [s.name for s in ob.material_slots].index(name)
M_TEETH = mat("Teeth", (0.86, 0.84, 0.78), 0.3); M_TONGUE = mat("Tongue", (0.62, 0.22, 0.25), 0.4); M_MOUTH = mat("MouthInner", (0.16, 0.035, 0.045), 0.6)
teeth = set(mem("helper-upper-teeth").tolist()) | set(mem("helper-lower-teeth").tolist()); tongue = set(mem("helper-tongue").tolist())
lips = mem("lips"); lipset = set(lips.tolist()); bodyg = ob.vertex_groups["body"]
# 前の実行で口のまわりから隠した肌の頂点を、いったん見える状態に戻す（補助の形・関節の目印・服の下は除く）
_helper = {g.index for g in ob.vertex_groups if g.name.startswith(("helper-", "joint-")) or g.name in ("HelperGeometry", "JointCubes", "hidden_by_clothes", "body")}
_back = [v.index for v in me.vertices if abs(X[v.index]) < 0.04 and 1.42 < Z[v.index] < 1.50 and Y[v.index] < -0.05
         and not any(g.group in _helper and g.weight > 0.5 for g in v.groups)]
if _back: bodyg.add(_back, 1.0, 'REPLACE')
bodyg.remove(sorted(teeth | tongue))                     # 歯と舌は隠したままにする。顔の形を大きく変えてあるので位置が合わず、口を開けると欠けらのように見えた。
                                                         # 口の中は暗い色の壁だけにする（アニメ調の口）
cen = co[lips][np.abs(co[lips][:, 0]) < 0.004]
deep = cen[np.argsort(-cen[:, 1])][:4]; ZC = float(deep[:, 2].mean()); YSEAM = float(deep[:, 1].mean())      # 唇の合わせ目
skin_i = [s.name for s in ob.material_slots].index("Skin")
MC = np.array([0.0, YSEAM+0.030, ZC])                    # 口の中の中心
for p in me.polygons:
    vs = p.vertices
    if all(v in teeth for v in vs): p.material_index = M_TEETH
    elif all(v in tongue for v in vs): p.material_index = M_TONGUE
    elif p.material_index in (skin_i, M_MOUTH) and not any(v in lipset for v in vs):
        # 唇より奥の、口の中の壁：面が口の中心のほうを向いている（外の肌は外を向いている）
        c = co[list(vs)].mean(axis=0); inside = abs(c[0]) < 0.03 and 1.44 < c[2] < 1.49 and YSEAM+0.001 < c[1] < -0.06
        toward = float(np.dot(np.array(p.normal), c-MC)) < 0
        p.material_index = M_MOUTH if (inside and toward) else skin_i

# 口の奥の袋（体のメッシュ）を隠す：上唇と下唇の裏をつないでいるので、口を開けると膜のように伸びて見える。
# 口の中の壁から、唇を通らずに辺でたどれる頂点を隠す（かわりに、下で作る暗い色の袋を見せる）
_seed = {v for p in me.polygons if p.material_index == M_MOUTH for v in p.vertices}
_adj = {}
for e_ in me.edges:
    a_, b_ = e_.vertices
    if a_ in lipset or b_ in lipset: continue
    if not (AX[a_] < 0.035 and AX[b_] < 0.035 and 1.43 < Z[a_] < 1.50 and 1.43 < Z[b_] < 1.50 and Y[a_] > YSEAM-0.001 and Y[b_] > YSEAM-0.001): continue
    _adj.setdefault(a_, []).append(b_); _adj.setdefault(b_, []).append(a_)
_sock = set(_seed); _todo = list(_seed)
while _todo:
    for j in _adj.get(_todo.pop(), ()):
        if j not in _sock: _sock.add(j); _todo.append(j)
bodyg.remove(sorted(_sock))

# ── 動かし方の部品 ──
HY, HZ = -0.050, 1.497                                   # あごを回す軸（耳の前あたり。x 方向の軸）
CORNER = co[lips][co[lips][:, 0].argmax()]               # 口角
lowjaw = np.zeros(NV)                                    # 下あごの重み
front = ss((-0.055-Y)/0.05)
# 上唇か下唇かは、唇を厚くしたりとがらせたりする前の形（Basis）で見分ける。
# 今の形では上唇が下唇にかぶさっていて、高さだけでは上唇まで下あごに入ってしまう
B0 = np.zeros(NV*3); kb["Basis"].data.foreach_get("co", B0); B0 = B0.reshape(NV, 3)
_c0 = B0[lips][np.abs(B0[lips][:, 0]) < 0.004]; ZC0 = float(_c0[np.argsort(-_c0[:, 1])][:4][:, 2].mean())      # Basis での唇の合わせ目
# 合わせ目のすぐ近くは高さがほぼ同じなので、元の形での面の向きで分ける
# （下唇の合わせ面と口の底は上向き、上唇の合わせ面と口の天井は下向き。前を向いた面は高さで分ける）。
# 中間の重みを作ると上下の唇が膜のようにつながって伸びるので、0 か 1 にする
_tm = bpy.data.meshes.new("_basis_tmp"); _tm.from_pydata(B0.tolist(), [], [tuple(p.vertices) for p in me.polygons]); _tm.update()
N0 = np.array([v.normal[:] for v in _tm.vertices]); bpy.data.meshes.remove(_tm)
_islip = np.zeros(NV, bool); _islip[lips] = True
_band = np.abs(B0[:, 2]-ZC0) < 0.0040
lab = np.where(B0[:, 2] < ZC0, 1.0, 0.0)                 # 1 = 下あご側
sure = ~_band | (np.abs(N0[:, 2]) > 0.30)
lab = np.where(_band & (np.abs(N0[:, 2]) > 0.30), (N0[:, 2] > 0).astype(float), lab)
# 上唇の中央は合わせ目より 4mm ほど下まで垂れている。唇の頂点で、面がはっきり下（上）を向いているものは、少し広い範囲でも向きで決める
_strong = _islip & (np.abs(B0[:, 2]-ZC0) < 0.0075) & (np.abs(N0[:, 2]) > 0.6)
lab = np.where(_strong, (N0[:, 2] > 0).astype(float), lab); sure = sure | _strong
# 向きがはっきりしない頂点（前を向いた面など）は、辺でつながった隣の「はっきりした頂点」の多数決で決める
_near = (np.abs(B0[:, 0]) < 0.035) & (np.abs(B0[:, 2]-ZC0) < 0.02)
_ed = [(e_.vertices[0], e_.vertices[1]) for e_ in me.edges if _near[e_.vertices[0]] and _near[e_.vertices[1]]]
for _ in range(12):
    vote = np.zeros(NV); cnt = np.zeros(NV)
    for i, j in _ed:
        if sure[j] and not sure[i]: vote[i] += lab[j]; cnt[i] += 1
        if sure[i] and not sure[j]: vote[j] += lab[i]; cnt[j] += 1
    new = (~sure) & (cnt > 0)
    if not new.any(): break
    lab[new] = (vote[new]/cnt[new] > 0.5).astype(float); sure = sure | new
lower_side = lab
# 唇のすぐ裏で上下をつないでいる膜（唇ではない面で、上側と下側の頂点が混ざっているもの）を隠す。口を開けると白い膜に見える
_cx0 = float(np.abs(B0[lips][:, 0]).max()); _mem = set()
for p in me.polygons:
    vs = list(p.vertices)
    if max(abs(B0[v][0]) for v in vs) > _cx0-0.004 or abs(np.mean([B0[v][2] for v in vs])-ZC0) > 0.014: continue
    if 0 < sum(lab[v] for v in vs) < len(vs): _mem.update(v for v in vs if v not in lipset and Y[v] > YSEAM-0.0015)      # 合わせ目より奥だけ（手前の肌は隠さない）
if _mem: bodyg.remove(sorted(_mem))
# 口角は動かさない：唇の高さでは、口角へ向かって下あごの重みを 0 にする（口が、口角を両端にした形に開く）
_cx = float(np.abs(B0[lips][:, 0]).max())
_taper = ss((_cx-0.0005-np.abs(B0[:, 0]))/0.011)
_lipzone = 1-ss((ZC0-0.003-B0[:, 2])/0.010)              # 1 = 唇の高さ、0 = あご
corner_fix = _taper*_lipzone+(1-_lipzone)
lowjaw = lower_side*corner_fix*ss((0.062-AX)/0.040)*ss((Z-1.385)/0.03)*front
for i in mem("helper-lower-teeth"): lowjaw[i] = 1.0
for i in mem("helper-tongue"): lowjaw[i] = 1.0
upper_teeth = mem("helper-upper-teeth"); lowjaw[upper_teeth] = 0.0
mouth_w = ss(1-np.hypot(AX, (Z-ZC)*1.2)/0.052)*front     # 口のまわり
lip_w = np.zeros(NV); lip_w[lips] = 1.0
lip_w = np.maximum(lip_w, ss(1-np.hypot(AX, (Z-ZC)*1.3)/0.034)*front*0.6)
corner_w = np.exp(-(((AX-CORNER[0])/0.013)**2+((Z-CORNER[2])/0.011)**2))*front
cheek_w = np.exp(-(((AX-0.046)/0.022)**2+((Z-(ZC+0.030))/0.020)**2))*front
inner = np.array([1.0 if (i in teeth or i in tongue) else 0.0 for i in range(NV)])
is_tongue = np.array([1.0 if i in tongue else 0.0 for i in range(NV)])

def mouth(open_deg=0.0, wide=0.0, pucker=0.0, smile=0.0, upper=0.0):
    D = np.zeros((NV, 3))
    th = -math.radians(open_deg)*lowjaw                  # あごを開く（軸のまわりに回す。下唇が下・少し奥へ動く向き）
    ry = Y-HY; rz = Z-HZ
    D[:, 1] += (ry*np.cos(th)+rz*np.sin(th))-ry; D[:, 2] += (-ry*np.sin(th)+rz*np.cos(th))-rz
    D[:, 1] += 0.0009*open_deg*is_tongue; D[:, 2] += -0.0003*open_deg*is_tongue      # 舌は口を開けるほど奥・下へ引く（口いっぱいに見えないように）
    D[:, 0] += X*wide*mouth_w*(1-inner)                  # 幅
    D[:, 1] += -pucker*lip_w                             # とがらす
    D[:, 2] += upper*lip_w*(1-lower_side)*_taper        # 上唇を上げる（口角は動かさない）
    D[:, 0] += SG*0.0045*smile*corner_w; D[:, 2] += 0.0065*smile*corner_w; D[:, 1] += 0.0015*smile*corner_w      # 口角を上げる
    D[:, 2] += 0.0030*smile*cheek_w; D[:, 1] += -0.0020*smile*cheek_w                                            # ほおが上がる
    return D

# ── まぶた ──
SK = bpy.data.materials["Skin"].node_tree.nodes; LL = bpy.data.materials["LashLower"].node_tree.nodes
EX = SK["LidCenter"].inputs["X"].default_value; EZ = SK["LidCenter"].inputs["Z"].default_value
la, lb, lc = (SK[n].inputs[1].default_value for n in ("LidMULTIPLY.007", "LidMULTIPLY.008", "LidADD.003"))      # 上まぶたのふち（アイラインの線）
wa, wb, wc = (LL[n].inputs[1].default_value for n in ("Math.004", "LashSlope", "LashBase"))                    # 下まぶたのふち（下まつ毛の生えぎわ）
dx = AX-EX; dz = Z-EZ
lid = la*dx*dx+lb*dx+lc; low = wa*dx*dx+wb*dx+wc+0.0012
eyeball = set(mem("helper-l-eye").tolist()) | set(mem("helper-r-eye").tolist())
lash_up = set(mem("helper-l-eyelashes-2").tolist()) | set(mem("helper-r-eyelashes-2").tolist())
lash_low = set(mem("helper-l-eyelashes-1").tolist()) | set(mem("helper-r-eyelashes-1").tolist())
not_ball = np.array([0.0 if i in eyeball else 1.0 for i in range(NV)])
is_lash_up = np.array([1.0 if i in lash_up else 0.0 for i in range(NV)]); is_lash_low = np.array([1.0 if i in lash_low else 0.0 for i in range(NV)])
eye_x = ss((dx+0.024)/0.006)*ss((0.031-dx)/0.006)*ss((-0.085-Y)/0.03)*not_ball
gap = np.maximum(0.0, lid-low)
EC = np.array([EX, float(bpy.data.materials["Eye"].node_tree.nodes["EyeCenter"].inputs[1].default_value[1]), EZ])
ER = float(max(np.linalg.norm(co[i]-EC*np.array([1, 1, 1])) for i in mem("helper-l-eye")))                   # 目の玉の半径
def eyes(close=0.0, lower_up=0.0, widen=0.0):
    """close: 上まぶたを下ろす（1 で閉じる）。lower_up: 下まぶたを上げる（m）。widen: 上まぶたを上げる（m）"""
    D = np.zeros((NV, 3))
    up = (dz > (lid+low)/2-0.0005) | (is_lash_up > 0)    # 上まぶた側
    w_up = np.where(up, 1-ss((dz-lid-0.001)/0.016), 0.0)*eye_x*(1-is_lash_low)
    D[:, 2] += -gap*close*w_up+widen*w_up
    dn = (~up) | (is_lash_low > 0)
    w_dn = np.where(dn, 1-ss((low-dz-0.001)/0.012), 0.0)*eye_x*(1-is_lash_up)
    D[:, 2] += lower_up*w_dn
    # 目の玉にめり込んだ所は、玉の外へ出す
    P = co+D; C = np.stack([SG*EC[0], np.full(NV, EC[1]), np.full(NV, EC[2])], axis=1)
    r = np.linalg.norm(P-C, axis=1); need = ER+0.0010
    mv = (np.abs(D[:, 2]) > 1e-6) & (r < need) & (not_ball > 0)
    D[mv] += (P[mv]-C[mv])/np.maximum(r[mv], 1e-6)[:, None]*(need-r[mv])[:, None]
    return D

# 上唇が厚く、下唇の前へかぶさっているので、あごを大きめに開き、上唇も少し持ち上げないと口の中が見えない
SHAPES = {
    "aa": mouth(open_deg=15.0, wide=-0.04, upper=0.0045),
    "ih": mouth(open_deg=6.0, wide=0.16, smile=0.25, upper=0.0035),
    "ou": mouth(open_deg=7.0, wide=-0.26, pucker=0.0055, upper=0.0020),
    "ee": mouth(open_deg=9.0, wide=0.11, smile=0.10, upper=0.0035),
    "oh": mouth(open_deg=12.0, wide=-0.20, pucker=0.0035, upper=0.0030),
    "happy": mouth(open_deg=6.0, wide=0.09, smile=1.0, upper=0.0035)+eyes(close=0.22, lower_up=0.0022),
    "surprised": mouth(open_deg=11.0, wide=-0.14, pucker=0.002, upper=0.0030)+eyes(widen=0.0028, lower_up=-0.0008),
    "blink": eyes(close=1.0),
}
basis = kb["Basis"].data
for n, D in SHAPES.items():
    k = kb.get("exp-"+n) or ob.shape_key_add(name="exp-"+n, from_mix=False)
    k.value = 0; k.slider_min = 0; k.slider_max = 1
    flat = np.zeros(NV*3); basis.foreach_get("co", flat); flat = flat.reshape(NV, 3)+D
    k.data.foreach_set("co", flat.ravel())
me.update()
# 眉（別のオブジェクト）：驚きで上げ、笑顔で少し上げる
br = bpy.data.objects.get("Girl_Brows")
if br:
    if not br.data.shape_keys: br.shape_key_add(name="Basis", from_mix=False)
    for n, dzb in (("surprised", 0.0060), ("happy", 0.0012)):
        k = br.data.shape_keys.key_blocks.get("exp-"+n) or br.shape_key_add(name="exp-"+n, from_mix=False)
        k.value = 0
        for i, v in enumerate(br.data.vertices): k.data[i].co = (v.co.x, v.co.y, v.co.z+dzb)
# 口の中の壁：体のメッシュには口の奥の袋がなく、口を開けると頭の内側が見えてしまう。暗い色の袋を頭の中に置く
old_bag = bpy.data.objects.get("Girl_MouthBag")
if old_bag: bpy.data.objects.remove(old_bag, do_unlink=True)
import bmesh
from mathutils import Vector
bmb = bmesh.new(); BC = Vector((0.0, YSEAM+0.030, ZC-0.006)); BRX, BRY, BRZ = 0.026, 0.026, 0.030
rings = []
for i in range(1, 9):
    a = math.pi*i/9
    rings.append([bmb.verts.new(BC+Vector((BRX*math.sin(a)*math.cos(k*2*math.pi/16), BRY*math.sin(a)*math.sin(k*2*math.pi/16), BRZ*math.cos(a)))) for k in range(16)])
for i in range(len(rings)-1):
    for k in range(16): bmb.faces.new((rings[i][k], rings[i+1][k], rings[i+1][(k+1) % 16], rings[i][(k+1) % 16]))      # 内向きの面
for ring, zz in ((rings[0], BRZ), (rings[-1], -BRZ)):
    cv = bmb.verts.new(BC+Vector((0, 0, zz)))
    for k in range(16): bmb.faces.new((ring[k], ring[(k+1) % 16], cv))
mb = bpy.data.meshes.new("Girl_MouthBag"); bmb.to_mesh(mb); bmb.free()
for p in mb.polygons: p.use_smooth = True
mb.materials.append(bpy.data.materials["MouthInner"])
bag = bpy.data.objects.new("Girl_MouthBag", mb); bpy.context.scene.collection.objects.link(bag)
if _rig:                                                 # 頭の骨にぴったり付ける
    bag.vertex_groups.new(name="head").add(list(range(len(mb.vertices))), 1.0, 'REPLACE')
    bag.modifiers.new("Armature", 'ARMATURE').object = _rig; bag.parent = _rig
print("expressions built:", ", ".join("exp-"+n for n in SHAPES), "| mouth seam z", round(ZC, 4), "eye r", round(ER, 4))
if _rig: _rig.data.pose_position = _pose
