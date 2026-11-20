# 脚を長くする（Blender の中で exec する）。シェイプキー custom-long-legs を作り直す。
# 使い方: exec(open(path, encoding="utf-8").read(), {"K": 1.14})   K … 脚の長さの倍率
# 太ももの付け根（高さ PIVOT）より下を、下へ向かって引きのばす。上半身の高さは変えないので、足の裏は床（z = 0）より下になる。
# 関節の目印もいっしょに動かすので、このあと make_rig.py で骨組みを作り直し、服と髪のスクリプトを実行し直す。
import bpy
import numpy as np
K = globals().get("K", 1.14); PIVOT = 0.78
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks
rig = bpy.data.objects.get("Girl_Rig")
if rig: rig.data.pose_position = 'REST'
k = kb.get("custom-long-legs") or ob.shape_key_add(name="custom-long-legs", from_mix=False); k.value = 0
mk = next(m for m in ob.modifiers if m.type == 'MASK'); mk.show_viewport = False; bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
n = len(m.vertices); co = np.zeros(n*3); m.vertices.foreach_get("co", co); co = co.reshape(n, 3); ev.to_mesh_clear(); mk.show_viewport = True
b = np.zeros(n*3); kb["Basis"].data.foreach_get("co", b); b = b.reshape(n, 3)
b[:, 2] += np.where(co[:, 2] < PIVOT, (PIVOT-co[:, 2])*(1-K), 0.0)
k.data.foreach_set("co", b.ravel()); k.value = 1.0; me.update()
if rig: rig.data.pose_position = 'POSE'
print("legs set. K", K, "ground z", round(float(-PIVOT*(K-1)), 3))
