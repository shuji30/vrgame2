# 体を細くする（Blender の中で exec する）。シェイプキー custom-slim を作り直す。骨組み（Girl_Rig）が要る。
# 使い方: exec(open(path, encoding="utf-8").read(), {"LIMB": 0.84, "TORSO": 0.90})
#   LIMB  … 腕と脚の太さの倍率（1 で元のまま）
#   TORSO … 胴・腰の太さの倍率
# 各頂点を、ウェイトの付いている骨の軸へ向かって寄せる（骨の長さ方向には動かさないので、背や手足の長さは変わらない）。
# 頭・手・足先は変えない。実行したあとは、服と髪のスクリプトを実行し直す。
import bpy
import numpy as np

LIMB = globals().get("LIMB", 0.84); TORSO = globals().get("TORSO", 0.90); LEG = globals().get("LEG", LIMB)       # LEG … 脚だけの倍率
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]
was = rig.data.pose_position; rig.data.pose_position = 'REST'
k = kb.get("custom-slim") or ob.shape_key_add(name="custom-slim", from_mix=False); k.value = 0
mk = next(m for m in ob.modifiers if m.type == 'MASK'); mk.show_viewport = False; bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
n = len(m.vertices); co = np.zeros(n*3); m.vertices.foreach_get("co", co); co = co.reshape(n, 3); ev.to_mesh_clear(); mk.show_viewport = True
S = {}
for side in ("left", "right"):
    for b in ("UpperArm", "LowerArm"): S[side+b] = LIMB
    for b in ("UpperLeg", "LowerLeg"): S[side+b] = LEG
    S[side+"Shoulder"] = (1+TORSO)/2
for b in ("hips", "spine", "chest", "upperChest"): S[b] = TORSO
S["neck"] = (1+TORSO)/2
gname = {g.index: g.name for g in ob.vertex_groups if g.name in rig.data.bones}
axis = {}
for b, s in S.items():
    bn = rig.data.bones[b]; h = np.array(bn.head_local); t = np.array(bn.tail_local); d = (t-h)/np.linalg.norm(t-h); axis[b] = (h, d, s)
D = np.zeros((n, 3))
for v in me.vertices:
    p = co[v.index]; tot = 0.0; acc = np.zeros(3)
    for g in v.groups:
        b = gname.get(g.group)
        if b is None: continue
        tot += g.weight
        if b in axis:
            h, d, s = axis[b]; r = p-h; perp = r-d*np.dot(r, d); acc += g.weight*(s-1)*perp
    if tot > 1e-6: D[v.index] = acc/tot
basis = np.zeros(n*3); kb["Basis"].data.foreach_get("co", basis)
k.data.foreach_set("co", (basis.reshape(n, 3)+D).ravel()); k.value = 1.0; me.update()
rig.data.pose_position = was
print("slim set. LIMB", LIMB, "TORSO", TORSO, "max move mm", round(float(np.abs(D).max())*1000, 1))
