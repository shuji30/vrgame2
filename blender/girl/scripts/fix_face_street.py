# ストリートの子（girl2.blend）の口まわりのしわを取る（Blender の中で exec する）。
#   ほくろ（肌の模様 MkMole0 / MkMole1）を消す。チークの位置を上げる（目の下 2.5cm）
#   custom-mouth-smooth … 小鼻のわきから口角の外を通ってあごへ下りる線、口角のくぼみ、唇のまわりの盛り上がりを、
#   まわりの頂点の平均へ寄せてならす。唇・口の中・体の中の補助の頂点は動かさない。動かすのは MAX_MOVE まで
# vrsample の blender/girl-knit/scripts/make_face_knit.py（3 人目）と同じやり方。
import bpy
import numpy as np

ITER = globals().get("ITER", 40); MAX_MOVE = globals().get("MAX_MOVE", 0.003)
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; n = len(me.vertices)
rig = bpy.data.objects["Girl_Rig"]
def ss(x): x = np.clip(x, 0, 1); return x*x*(3-2*x)
if "custom-mouth-smooth" in kb: kb["custom-mouth-smooth"].value = 0.0
saved = {k.name: k.value for k in kb if k.name.startswith("exp-")}
for k in kb:
    if k.name.startswith("exp-"): k.value = 0
was = rig.data.pose_position; rig.data.pose_position = 'REST'
mk = next(m for m in ob.modifiers if m.type == 'MASK'); mk.show_viewport = False; bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
co = np.zeros(len(m.vertices)*3); m.vertices.foreach_get("co", co); ev.to_mesh_clear(); co = co.reshape(-1, 3)
mk.show_viewport = True; rig.data.pose_position = was
names = [s.name for s in ob.material_slots]
skin = np.zeros(n, bool); lip = np.zeros(n, bool); inner = np.zeros(n, bool)
for p in me.polygons:
    nm = names[p.material_index]
    if nm == "Skin": skin[list(p.vertices)] = True
    elif nm == "Lips": lip[list(p.vertices)] = True
    elif nm in ("MouthInner", "Teeth", "Tongue"): inner[list(p.vertices)] = True
bi = ob.vertex_groups["body"].index
vis = np.array([any(g.group == bi and g.weight > 0.5 for g in v.groups) for v in me.vertices])
skin &= vis & ~lip & ~inner
L = co[lip]; cx = float(np.abs(L[:, 0]).max()); zc = float(L[:, 2].mean())
AX = np.abs(co[:, 0]); Z = co[:, 2]; Y = co[:, 1]
yfront = float(co[vis & (AX < 0.01) & (Z > zc-0.03) & (Z < zc+0.05)][:, 1].min())        # 鼻先あたり（顔のいちばん前）
w = ss((cx+0.030-AX)/0.012)*ss((Z-(zc-0.040))/0.010)*ss((zc+0.030-Z)/0.010)*ss((yfront+0.060-Y)/0.010)*skin
w *= 1-ss((Z-(zc+0.010))/0.004)*ss((0.026-AX)/0.006)          # 鼻（鼻の穴・小鼻）は動かさない
skin_nose = (Z > zc+0.010) & (AX < 0.026)
ed = np.zeros(len(me.edges)*2, int); me.edges.foreach_get("vertices", ed); ed = ed.reshape(-1, 2)
ok = (skin | lip) & ~skin_nose; ed = ed[ok[ed[:, 0]] & ok[ed[:, 1]]]     # 鼻の頂点は、ならす相手にも入れない
cnt = np.zeros(n); np.add.at(cnt, ed[:, 0], 1); np.add.at(cnt, ed[:, 1], 1); cnt = np.maximum(cnt, 1)
P = co.copy()
for _ in range(ITER):
    acc = np.zeros((n, 3)); np.add.at(acc, ed[:, 0], P[ed[:, 1]]); np.add.at(acc, ed[:, 1], P[ed[:, 0]])
    P = P+(acc/cnt[:, None]-P)*0.5*w[:, None]
D = P-co; ln = np.linalg.norm(D, axis=1); D *= np.minimum(1.0, MAX_MOVE/np.maximum(ln, 1e-9))[:, None]
B = np.zeros(n*3); kb["Basis"].data.foreach_get("co", B)
k = kb.get("custom-mouth-smooth") or ob.shape_key_add(name="custom-mouth-smooth", from_mix=False)
k.data.foreach_set("co", (B.reshape(-1, 3)+D).ravel()); k.value = 1.0; me.update()
for kk, v in saved.items(): kb[kk].value = v
print("street mouth smooth: moved verts", int((ln > 1e-4).sum()), "max mm", round(float(np.minimum(ln, MAX_MOVE).max())*1000, 2))
SK = bpy.data.materials["Skin"].node_tree.nodes
for i in (0, 1):
    if f"MkMole{i}Fall" in SK: SK[f"MkMole{i}Fall"].inputs["To Min"].default_value = 0.0      # ほくろなし
CHEEK_DZ = globals().get("CHEEK_DZ", -0.025)            # チークの中心の高さ（目の中心から。元は -0.040）
_c = SK["CheekCenter"].inputs[1].default_value; _c[2] = SK["LidCenter"].inputs["Z"].default_value+CHEEK_DZ

# 鼻のまわりのしわを取る（custom-nose-smooth）：小鼻のわきの折れ目と、小鼻からほおへの段差をならす。
# 鼻の穴のあたり（まん中 1.6cm）は動かさない。動かすのは NOSE_MAX_MOVE まで
NOSE_MAX_MOVE = globals().get("NOSE_MAX_MOVE", 0.0018)
if "custom-nose-smooth" in kb: kb["custom-nose-smooth"].value = 0.0
for k_ in kb:
    if k_.name.startswith("exp-"): k_.value = 0
rig.data.pose_position = 'REST'; mk.show_viewport = False; bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
co = np.zeros(len(m.vertices)*3); m.vertices.foreach_get("co", co); ev.to_mesh_clear(); co = co.reshape(-1, 3)
mk.show_viewport = True; rig.data.pose_position = was
AX = np.abs(co[:, 0]); Z = co[:, 2]; Y = co[:, 1]
wn = ss((AX-0.014)/0.006)*ss((0.046-AX)/0.010)*ss((Z-(zc+0.004))/0.006)*ss((zc+0.050-Z)/0.012)*ss((yfront+0.050-Y)/0.010)*skin
okn = skin; edn = np.zeros(len(me.edges)*2, int); me.edges.foreach_get("vertices", edn); edn = edn.reshape(-1, 2)
edn = edn[okn[edn[:, 0]] & okn[edn[:, 1]]]
cnt = np.zeros(n); np.add.at(cnt, edn[:, 0], 1); np.add.at(cnt, edn[:, 1], 1); cnt = np.maximum(cnt, 1)
P = co.copy()
for _ in range(30):
    acc = np.zeros((n, 3)); np.add.at(acc, edn[:, 0], P[edn[:, 1]]); np.add.at(acc, edn[:, 1], P[edn[:, 0]])
    P = P+(acc/cnt[:, None]-P)*0.5*wn[:, None]
D = P-co; ln = np.linalg.norm(D, axis=1); D *= np.minimum(1.0, NOSE_MAX_MOVE/np.maximum(ln, 1e-9))[:, None]
B = np.zeros(n*3); kb["Basis"].data.foreach_get("co", B)
k = kb.get("custom-nose-smooth") or ob.shape_key_add(name="custom-nose-smooth", from_mix=False)
k.data.foreach_set("co", (B.reshape(-1, 3)+D).ravel()); k.value = 1.0; me.update()
for kk, v in saved.items(): kb[kk].value = v
print("street nose smooth: max mm", round(float(np.minimum(ln, NOSE_MAX_MOVE).max())*1000, 2))

# 唇：合わせ目に近い所の暗い色を明るくする（ゲームで、唇のふちや口角に暗い斑点が出ていた）
LP = bpy.data.materials["Lips"].node_tree.nodes
LP["MkMix"].inputs[6].default_value = (0.84, 0.40, 0.41, 1)      # 合わせ目寄りの色。明るい色（0.86, 0.42, 0.42）とほぼ同じにする（口角で、合わせ目から離れた所まで暗くなり斑点に見えた）
# まつ毛：毛の筋を細かく（本数を増やす）、下まつ毛は抜けを少なく
# （下まつ毛を濃くするとゲジゲジに見えたので、下まつ毛は短く・まばらに、上まつ毛も少し短くする）
for _mn, _f in (("Lash", 3600.0), ("LashLower", 2800.0)):
    _nn = bpy.data.materials[_mn].node_tree.nodes; _nn["Math.008"].inputs[1].default_value = _f
_ln = bpy.data.materials["LashLower"].node_tree.nodes["Map Range"]
_ln.inputs["From Min"].default_value = 0.50; _ln.inputs["From Max"].default_value = 0.72
_l = bpy.data.materials["LashLower"].node_tree.nodes["LashLen"]; _l.inputs["To Min"].default_value = -0.0012; _l.inputs["To Max"].default_value = -0.0026
_u = bpy.data.materials["Lash"].node_tree.nodes["LashLen"]; _u.inputs["To Min"].default_value = 0.0034; _u.inputs["To Max"].default_value = 0.0080
# 眉：毛の筋を描く（make_brows_fine.py）
exec(compile(open(r"C:\Users\shuji\vrgame2\blender\girl\scripts\make_brows_fine.py", encoding="utf-8").read(), "make_brows_fine.py", "exec"), {"__name__": "__main__"})

# 口の中の袋（Girl_MouthBag）を小さくして上げる：下のふちがあご先の近くまで下がっていて、首を傾けたときに、あごの肌を突き抜けて暗く見えた
_bag = bpy.data.objects.get("Girl_MouthBag")
if _bag and not _bag.get("shrunk"):
    import mathutils
    _vs = [v.co for v in _bag.data.vertices]
    _c = sum(_vs, mathutils.Vector())/len(_vs)
    for v in _bag.data.vertices:
        d = v.co-_c; v.co = _c+mathutils.Vector((d.x*0.82, d.y*0.92, d.z*0.82))+mathutils.Vector((0, 0, 0.003))
    _bag["shrunk"] = 1; _bag.data.update()


# 顔の肌の重みを直す：make_rig.py の自動ウェイトが、口・あご・ほおの肌を目の骨と髪の揺れ骨（hairSwing）にも付けていた。
# 髪の揺れ骨は真下を向いて揺れるので、首を回すと口とあごが引っ張られて裂け、口角に暗い所が出た（3 人目の make_face_knit.py と同じ直し）
_vg = {g.name: g for g in ob.vertex_groups}; _gi = {g.index: g.name for g in ob.vertex_groups}
_eyeball = {_vg[nm].index for nm in ("helper-l-eye", "helper-r-eye") if nm in _vg}
_moved = 0
for _v in me.vertices:
    if any(g.group in _eyeball and g.weight > 0.5 for g in _v.groups): continue
    _w = sum(g.weight for g in _v.groups if _gi[g.group] in ("leftEye", "rightEye", "hairSwing"))
    if _w <= 0: continue
    _h = next((g.weight for g in _v.groups if _gi[g.group] == "head"), 0.0)
    for nm in ("leftEye", "rightEye", "hairSwing"):
        if nm in _vg: _vg[nm].remove([_v.index])
    _vg["head"].add([_v.index], _h+_w, 'REPLACE'); _moved += 1
print("moved eye/hairSwing weights to head:", _moved)
# 重みを直したので、服・小物（チョーカーなど）を骨組みに付け直す（体の重みを写して付けているため。直す前の重みのままだと、首を回すとチョーカーが外れた）
exec(compile(open(r"C:\Users\shuji\Documents\girl-blender\scripts\bind_rig.py", encoding="utf-8").read(), "bind_rig.py", "exec"), {"__name__": "__main__"})
