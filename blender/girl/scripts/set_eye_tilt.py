# 目尻の上げ下げを変える（Blender の中で exec する）。
# 使い方: exec(open(path, encoding="utf-8").read(), {"TILT": 5.0, "CORNER": 0.75})
#   TILT   … 目の傾き（度）。正で目尻が上がる（つり目）、負で下がる（タレ目）
#   CORNER … 目尻そのものの持ち上げ（シェイプキー l/r-eye-corner2-up、0〜1）
# 形を変えたあと、肌に描いてあるアイライン・二重の線と、まつ毛の生えぎわの線を、新しいまぶたの形に合わせ直す。
# （変える前にその線の上にあった頂点を覚えておき、変えたあとの位置に 2 次曲線を当てはめる）
# 最後に fit_face.py と make_makeup_jirai.py を実行する。
import bpy, numpy as np
_rig = bpy.data.objects.get("Girl_Rig"); _pose = _rig.data.pose_position if _rig else None    # 骨組みがあれば、作る間は基本の姿勢に戻す
if _rig: _rig.data.pose_position = 'REST'; bpy.context.view_layer.update()

TILT = globals().get("TILT", 0.0); CORNER = globals().get("CORNER", 0.5)
D = "C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\"
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks
mk = next(m for m in ob.modifiers if m.type == 'MASK')
def full():
    mk.show_viewport = False; bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get(); e = ob.evaluated_get(dg); m = e.to_mesh()
    co = np.array([v.co[:] for v in m.vertices]); e.to_mesh_clear(); mk.show_viewport = True
    return co
SK = bpy.data.materials["Skin"].node_tree.nodes
def lidc(): return SK["LidCenter"].inputs["X"].default_value, SK["LidCenter"].inputs["Z"].default_value
names = [s.name for s in ob.material_slots]
def mverts(mn):
    si = names.index(mn); return sorted({v for p in me.polygons if p.material_index == si for v in p.vertices})
co = full(); cx, cz = lidc()
def track(vs, A, B, C, tol, extra=None):
    out = []
    for i in vs:
        x, y, z = co[i]; dx = abs(x)-cx
        if -0.0185 < dx < 0.0255 and abs((z-cz)-(A*dx*dx+B*dx+C)) < tol and (extra is None or extra(co[i])): out.append(i)
    return out
ycut = SK["LidLESS_THAN"].inputs[1].default_value
T = {"liner": track(mverts("Skin"), SK["LidMULTIPLY.007"].inputs[1].default_value, SK["LidMULTIPLY.008"].inputs[1].default_value,
                    SK["LidADD.003"].inputs[1].default_value, 0.0013, lambda c: c[1] < ycut)}
for mn in ("Lash", "LashLower"):
    N = bpy.data.materials[mn].node_tree.nodes
    T[mn] = track(mverts(mn), N["Math.004"].inputs[1].default_value, N["LashSlope"].inputs[1].default_value, N["LashBase"].inputs[1].default_value, 0.002)

fp = ob["face_params"].to_dict(); fp["EYE_TILT"] = TILT
for q in "lr": kb[f"{q}-eye-corner2-up"].value = CORNER
exec(compile(open(D+"fit_face.py", encoding="utf-8").read(), D+"fit_face.py", "exec"), dict(fp)); ob["face_params"] = fp

co = full(); cx, cz = lidc()
def fit(vs):
    dx = np.abs(co[vs, 0])-cx; dz = co[vs, 2]-cz
    A = np.vstack([dx*dx, dx, np.ones_like(dx)]).T
    return [float(v) for v in np.linalg.lstsq(A, dz, rcond=None)[0]]
a, b, c = fit(T["liner"])
SK["LidMULTIPLY.007"].inputs[1].default_value = a; SK["LidMULTIPLY.008"].inputs[1].default_value = b; SK["LidADD.003"].inputs[1].default_value = c
SK["LidMULTIPLY.001"].inputs[1].default_value = a*0.88; SK["LidMULTIPLY.002"].inputs[1].default_value = b; SK["LidADD.001"].inputs[1].default_value = c+0.0040   # 二重の線
for mn in ("Lash", "LashLower"):
    if len(T[mn]) < 8: continue
    N = bpy.data.materials[mn].node_tree.nodes; a2, b2, c2 = fit(T[mn])
    N["Math.004"].inputs[1].default_value = a2; N["LashSlope"].inputs[1].default_value = b2; N["LashBase"].inputs[1].default_value = c2
exec(compile(open(D+"make_makeup_jirai.py", encoding="utf-8").read(), D+"make_makeup_jirai.py", "exec"), {"__name__": "__main__"})
print("eye tilt", TILT, "corner", CORNER, {k: len(v) for k, v in T.items()})
if _rig: _rig.data.pose_position = _pose                 # 姿勢を元に戻す
