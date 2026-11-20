# 頭を小さくするシェイプキー custom-head-small を作る（Blender の中で exec する）。値は 0 のままにしておき、
# set_eye_tilt.py に EXTRA_KEYS={"custom-head-small": 1.0} を渡して入れる（アイラインなどの線を、小さくなった顔に合わせ直すため）。
# 使い方: exec(open(path, encoding="utf-8").read(), {"S": 0.88})   S … 頭の大きさの倍率
# 首の付け根より上を、首の付け根へ向かって縮める。髪の大きさ（hair_params）と眉も合わせる（1 回だけ）。
import bpy
import numpy as np
S = globals().get("S", 0.88); PV = np.array([0.0, -0.030, 1.395])
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks
if "custom-head-small" not in kb:
    rig = bpy.data.objects.get("Girl_Rig")
    if rig: rig.data.pose_position = 'REST'
    k = ob.shape_key_add(name="custom-head-small", from_mix=False); k.value = 0
    mk = next(m for m in ob.modifiers if m.type == 'MASK'); mk.show_viewport = False; bpy.context.view_layer.update()
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
    n = len(m.vertices); co = np.zeros(n*3); m.vertices.foreach_get("co", co); co = co.reshape(n, 3); ev.to_mesh_clear(); mk.show_viewport = True
    t = np.clip((co[:, 2]-1.385)/0.04, 0, 1); w = t*t*(3-2*t)
    b = np.zeros(n*3); kb["Basis"].data.foreach_get("co", b); b = b.reshape(n, 3)+(w*(S-1))[:, None]*(co-PV)
    k.data.foreach_set("co", b.ravel()); me.update()
    hp = ob["hair_params"].to_dict(); C = np.array(hp["C"]); hp["C"] = list(PV+(C-PV)*S)
    for a in ("RX", "RY", "RZ"): hp[a] = hp[a]*S
    hp["ZBANG"] = float(PV[2]+(hp["ZBANG"]-PV[2])*S); ob["hair_params"] = hp
    br = bpy.data.objects.get("Girl_Brows")
    if br:
        for kk in (br.data.shape_keys.key_blocks if br.data.shape_keys else [None]):
            for i, v in enumerate(br.data.vertices):
                dd = (kk.data[i] if kk else v); dd.co.y = PV[1]+(dd.co.y-PV[1])*S; dd.co.z = PV[2]+(dd.co.z-PV[2])*S
    if rig: rig.data.pose_position = 'POSE'
    print("head-small key made. S", S)
else: print("head-small key exists")
