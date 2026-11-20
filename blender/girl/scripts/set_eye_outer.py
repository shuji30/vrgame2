# 目尻（耳側の目のはし）を外へ広げて下げる（Blender の中で exec する）。シェイプキー custom-eye-outer を作り直す（値は 0 のまま）。
# 使い方: exec(open(path, encoding="utf-8").read(), {"OUT": 0.004, "DOWN": 0.003})
#   OUT  … 目尻を外へ広げる量（m）
#   DOWN … 目尻を下げる量（m）
# 作ったあと set_eye_tilt.py の EXTRA_KEYS に {"custom-eye-outer": 1.0} を渡すと、アイラインやまつ毛の線も合わせ直される。
import bpy, numpy as np

IN_DOWN = globals().get("IN_DOWN", 0.0)                 # 目頭（鼻側の目のはし）を下げる量（m）
OUT = globals().get("OUT", 0.004); DOWN = globals().get("DOWN", 0.003); SIG = globals().get("SIG", 0.010)
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects.get("Girl_Rig")
was = rig.data.pose_position if rig else None
if rig: rig.data.pose_position = 'REST'
k = kb.get("custom-eye-outer") or ob.shape_key_add(name="custom-eye-outer", from_mix=False); k.value = 0
mk = next(m for m in ob.modifiers if m.type == 'MASK'); mk.show_viewport = False; bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
n = len(m.vertices); co = np.zeros(n*3); m.vertices.foreach_get("co", co); co = co.reshape(n, 3); ev.to_mesh_clear(); mk.show_viewport = True
gi = {g.name: g.index for g in ob.vertex_groups}
def mem(nm): return np.array([v.index for v in me.vertices if any(g.group == gi[nm] and g.weight > 0.5 for g in v.groups)])
eye = mem("helper-l-eye"); ec = co[eye].mean(axis=0); er = float((co[eye][:, 0].max()-co[eye][:, 0].min())/2)
ball = np.zeros(n, bool); ball[eye] = True; ball[mem("helper-r-eye")] = True
D = np.zeros((n, 3))
for sg in (1, -1):
    cx = sg*(ec[0]+er*0.80); cz = ec[2]                     # 目尻のあたり
    w = np.exp(-(((co[:, 0]-cx)**2+(co[:, 2]-cz)**2)/(SIG*SIG)))*(co[:, 1] < ec[1]+0.004)*(~ball)*(sg*co[:, 0] > ec[0]-er*0.2)
    D[:, 0] += sg*OUT*w; D[:, 2] -= DOWN*w; D[:, 1] += OUT*0.45*w       # 外へ動かす分、顔の丸みに沿って少し奥へ
    ix = sg*(ec[0]-er*0.85)                                  # 目頭のあたり
    wi = np.exp(-(((co[:, 0]-ix)**2+(co[:, 2]-cz)**2)/(SIG*SIG*0.8)))*(co[:, 1] < ec[1]+0.004)*(~ball)*(sg*co[:, 0] > 0.004)
    D[:, 2] -= IN_DOWN*wi
basis = np.zeros(n*3); kb["Basis"].data.foreach_get("co", basis)
k.data.foreach_set("co", (basis.reshape(n, 3)+D).ravel()); me.update()
if rig: rig.data.pose_position = was
print("eye outer key built. OUT", OUT, "DOWN", DOWN, "moved verts", int((np.abs(D).sum(axis=1) > 1e-5).sum()), "eye r", round(er, 4))
