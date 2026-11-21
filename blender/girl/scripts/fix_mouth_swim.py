# 水着の子の「あ」「い」「う」の口を控えめにする（Blender の中で exec する）。make_face_cute.py（make_expressions.py）のあとに実行する。
#   あ … 開きを AA_SCALE 倍に（元は開きすぎ）
#   い … 開きを IH_SCALE 倍に（元は開きすぎ）
#   う … 口をすぼめる：開きを OU_OPEN 倍にして、唇を中央へ寄せて前へ突き出す
#   え … 元の「う」の形（開きは控えめ）
#   お … 口をすぼめる：開きを OH_OPEN 倍にして、唇を中央へ寄せて前へ突き出す
#   笑顔 … 目はそのまま、口（口角より下・まわり）の動きを HAPPY_MOUTH 倍に（元は口を開けすぎ）
#   ほくろ（肌の模様 MkMole0 / MkMole1）を消す
#   歯（Girl_Teeth）の同じ名前の表情も、同じ割合にする
# vrsample の blender/girl-knit/scripts/make_face_knit.py（3 人目）と同じ考え方。
import bpy
import numpy as np

AA_SCALE = globals().get("AA_SCALE", 0.50); IH_SCALE = globals().get("IH_SCALE", 0.40)
OU_OPEN = globals().get("OU_OPEN", 0.40); OU_PUCKER = globals().get("OU_PUCKER", 0.30); OU_FWD = globals().get("OU_FWD", 0.0035)
HAPPY_MOUTH = globals().get("HAPPY_MOUTH", 0.45)
OH_OPEN = globals().get("OH_OPEN", 0.55); OH_PUCKER = globals().get("OH_PUCKER", 0.22); OH_FWD = globals().get("OH_FWD", 0.0028)
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; n = len(me.vertices)
rig = bpy.data.objects["Girl_Rig"]
def ss(x): x = np.clip(x, 0, 1); return x*x*(3-2*x)
B = np.zeros(n*3); kb["Basis"].data.foreach_get("co", B); B = B.reshape(-1, 3)
def kd(name): a = np.zeros(n*3); kb[name].data.foreach_get("co", a); return a.reshape(-1, 3)-B
# いまの形（基本の姿勢・表情なし）で、口角と唇の合わせ目を測る
saved = {k.name: k.value for k in kb if k.name.startswith("exp-")}
for k in kb:
    if k.name.startswith("exp-"): k.value = 0
was = rig.data.pose_position; rig.data.pose_position = 'REST'
mk = next(m for m in ob.modifiers if m.type == 'MASK'); mk.show_viewport = False; bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
co = np.zeros(len(m.vertices)*3); m.vertices.foreach_get("co", co); ev.to_mesh_clear(); co = co.reshape(-1, 3)
mk.show_viewport = True; rig.data.pose_position = was
names = [s.name for s in ob.material_slots]; li = names.index("Lips")
lip = np.zeros(n, bool)
for p in me.polygons:
    if p.material_index == li: lip[list(p.vertices)] = True
L = co[lip]; cx = float(np.abs(L[:, 0]).max())
c = L[np.abs(L[:, 0]) < 0.004]; zc = float(c[np.argmax(c[:, 1]), 2])      # 唇の中央の、いちばん奥（合わせ目）
AX = np.abs(co[:, 0]); Z = co[:, 2]
front = ss((-0.10-co[:, 1])/0.02)
w = np.exp(-((AX/(cx+0.006))**2+((Z-zc)/0.016)**2))*front            # 口のまわり

Aa = kd("exp-aa"); Ih = kd("exp-ih"); Ou = kd("exp-ou"); Oh = kd("exp-oh")
kb["exp-ee"].data.foreach_set("co", (B+Ou).ravel())
D2 = Oh*OH_OPEN; D2[:, 0] -= co[:, 0]*OH_PUCKER*w; D2[:, 1] -= OH_FWD*w
kb["exp-oh"].data.foreach_set("co", (B+D2).ravel())
kb["exp-aa"].data.foreach_set("co", (B+Aa*AA_SCALE).ravel())
kb["exp-ih"].data.foreach_set("co", (B+Ih*IH_SCALE).ravel())
D = Ou*OU_OPEN; D[:, 0] -= co[:, 0]*OU_PUCKER*w; D[:, 1] -= OU_FWD*w
kb["exp-ou"].data.foreach_set("co", (B+D).ravel())
Hp = kd("exp-happy"); mw = 1-ss((Z-(zc+0.022))/0.012)          # 口のあたり（目より下）
kb["exp-happy"].data.foreach_set("co", (B+Hp*(1-(1-HAPPY_MOUTH)*mw[:, None])).ravel())
me.update()
for k, v in saved.items(): kb[k].value = v

t = bpy.data.objects.get("Girl_Teeth")
if t and t.data.shape_keys:
    tk = t.data.shape_keys.key_blocks; tB = [d.co.copy() for d in tk["Basis"].data]
    tOu = [d.co.copy() for d in tk["exp-ou"].data]
    if "exp-ee" in tk:
        for i, d in enumerate(tk["exp-ee"].data): d.co = tOu[i]
    for name, f in (("exp-aa", AA_SCALE), ("exp-ih", IH_SCALE), ("exp-ou", OU_OPEN), ("exp-oh", OH_OPEN), ("exp-happy", HAPPY_MOUTH)):
        if name not in tk: continue
        cur = [d.co.copy() for d in tk[name].data]
        for i, d in enumerate(tk[name].data): d.co = tB[i].lerp(cur[i], f)
SK = bpy.data.materials["Skin"].node_tree.nodes
for i in (0, 1):
    if f"MkMole{i}Fall" in SK: SK[f"MkMole{i}Fall"].inputs["To Min"].default_value = 0.0      # ほくろなし
print("swim mouth fixed: aa", AA_SCALE, "ih", IH_SCALE, "ou", OU_OPEN, "corner", round(cx, 4), "seam", round(zc, 4))
