# あごへ向かって顔の幅をしぼるシェイプキー custom-vline を作り直す（Blender の中で exec する）。値は変えない（make_face_doll.py が入れる）。
# 使い方: exec(open(path, encoding="utf-8").read(), {"AMT": 0.20})   AMT … あごの高さで幅を何割しぼるか
# 目の高さより下の顔の前半分を、下へ行くほど中央へ寄せる（目の高さでは 0。首は動かさない）。
import bpy
import numpy as np
AMT = globals().get("AMT", 0.20)
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks
rig = bpy.data.objects.get("Girl_Rig"); was = rig.data.pose_position if rig else None
if rig: rig.data.pose_position = 'REST'
k = kb.get("custom-vline") or ob.shape_key_add(name="custom-vline", from_mix=False); keep = k.value; k.value = 0
mk = next(m for m in ob.modifiers if m.type == 'MASK'); mk.show_viewport = False; bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
n = len(m.vertices); co = np.zeros(n*3); m.vertices.foreach_get("co", co); co = co.reshape(n, 3); ev.to_mesh_clear(); mk.show_viewport = True
EZ = bpy.data.materials["Skin"].node_tree.nodes["LidCenter"].inputs["Z"].default_value
def ss(t): t = np.clip(t, 0, 1); return t*t*(3-2*t)
z = co[:, 2]; w = ss((EZ-0.010-z)/0.060)*ss((z-1.405)/0.022)*ss((0.02-co[:, 1])/0.05)*ss((0.13-np.abs(co[:, 0]))/0.03)
b = np.zeros(n*3); kb["Basis"].data.foreach_get("co", b); b = b.reshape(n, 3)
b[:, 0] -= co[:, 0]*AMT*w
k.data.foreach_set("co", b.ravel()); k.value = keep; me.update()
if rig: rig.data.pose_position = was
print("vline key made. AMT", AMT)
