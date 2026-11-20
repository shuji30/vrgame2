# ドール顔の土台を作るシェイプキー custom-doll-base を作り直す（Blender の中で exec する）。値は変えない（make_face_doll.py が入れる）。
# 使い方: exec(open(path, encoding="utf-8").read(), {"SHORT": 0.80, "NARROW": 0.16})
#   SHORT  … 目から下の顔の長さの倍率（小さいほど、あごが上がって顔の下半分が短くなる）
#   NARROW … あごの高さで、顔の幅を何割しぼるか
# 部分ごとではなく、頭全体をなめらかに変形する（前だけでなく、あごの横・後ろもいっしょに動かすので、つまんだような形にならない）。
import bpy
import numpy as np
SHORT = globals().get("SHORT", 0.80); NARROW = globals().get("NARROW", 0.16)
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks
rig = bpy.data.objects.get("Girl_Rig"); was = rig.data.pose_position if rig else None
if rig: rig.data.pose_position = 'REST'
k = kb.get("custom-doll-base") or ob.shape_key_add(name="custom-doll-base", from_mix=False); keep = k.value; k.value = 0
mk = next(m for m in ob.modifiers if m.type == 'MASK'); mk.show_viewport = False; bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
n = len(m.vertices); co = np.zeros(n*3); m.vertices.foreach_get("co", co); co = co.reshape(n, 3); ev.to_mesh_clear(); mk.show_viewport = True
EZ = bpy.data.materials["Skin"].node_tree.nodes["LidCenter"].inputs["Z"].default_value
def ss(t): t = np.clip(t, 0, 1); return t*t*(3-2*t)
x, y, z = co[:, 0], co[:, 1], co[:, 2]
head = ss((z-1.400)/0.030)*ss((0.15-np.abs(x))/0.03)             # 首より上（腕や肩は除く）
low = ss((EZ-0.006-z)/0.030)                                     # 目より下
front = ss((0.060-y)/0.110)                                      # 顔の前から、耳の後ろあたりまで
D = np.zeros((n, 3))
D[:, 2] = (EZ-z)*(1-SHORT)*low*head*front                        # あごを上げる
depth = ss((EZ-0.010-z)/0.075)
D[:, 0] = -x*NARROW*depth*head*front                             # 下へ行くほど幅をしぼる
D[:, 1] = (-0.045-y)*0.10*depth*head*front*ss((-0.045-y)/0.05)   # あご先を少し引く
FILL = globals().get("FILL", 0.0040)                     # 目の下のくぼみを、前へふくらませて埋める量（m）
EX = bpy.data.materials["Skin"].node_tree.nodes["LidCenter"].inputs["X"].default_value
D[:, 1] -= FILL*np.exp(-((np.abs(x)-EX-0.003)/0.030)**2-((z-(EZ-0.028))/0.017)**2)*head*ss((-0.06-y)/0.03)
b = np.zeros(n*3); kb["Basis"].data.foreach_get("co", b); b = b.reshape(n, 3)+D
k.data.foreach_set("co", b.ravel()); k.value = keep; me.update()
if rig: rig.data.pose_position = was
print("doll-base key made. SHORT", SHORT, "NARROW", NARROW)
