# 顔のスライダーを変えたあとに実行する。目の位置に合わせて作ってある物を、すべて合わせ直す。
#   目の拡大（custom-eye-big）・涙袋（custom-tear-bag）・ほおのふくらみ（custom-cheek-puff）
#   虹彩／チーク／涙袋の色の中心・眉・前髪の高さ・髪
# 使い方: exec(open(path, encoding="utf-8").read(), {"EYE_SX": 0.20, "EYE_SZ": 0.07, "EYE_BALL": 0.13, "CHEEK_DZ": -0.050})
import bpy, math
from mathutils import Vector
_rig = bpy.data.objects.get("Girl_Rig"); _pose = _rig.data.pose_position if _rig else None    # 骨組みがあれば、作る間は基本の姿勢に戻す
if _rig: _rig.data.pose_position = 'REST'; bpy.context.view_layer.update()

EYE_SX = globals().get("EYE_SX", 0.20)       # 目のまわりを横に広げる割合
EYE_SZ = globals().get("EYE_SZ", 0.07)       # 縦に広げる割合
EYE_BALL = globals().get("EYE_BALL", 0.13)   # 眼球を大きくする割合
CHEEK_DZ = globals().get("CHEEK_DZ", -0.050) # ほおのふくらみの中心（目からの高さ）
CHEEK_AMP = globals().get("CHEEK_AMP", 0.0022)
EYE_TILT = globals().get("EYE_TILT", 0.0)   # 目の傾き（度）。正で目尻が上がる
BANG_DZ = globals().get("BANG_DZ", 0.0085)   # 前髪の毛先（目の中心からの高さ）

ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; T = Vector(ob["heel_shift"])
mk = next(m for m in ob.modifiers if m.type == 'MASK')
def full():
    mk.show_viewport = False; bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get(); e = ob.evaluated_get(dg); m = e.to_mesh()
    co = [v.co.copy() for v in m.vertices]; nr = [v.normal.copy() for v in m.vertices]; e.to_mesh_clear(); mk.show_viewport = True
    return co, nr
bi = ob.vertex_groups["body"].index
helper = {ob.vertex_groups[n].index for n in ("helper-l-eye", "helper-r-eye", "helper-l-eyelashes-1", "helper-l-eyelashes-2", "helper-r-eyelashes-1", "helper-r-eyelashes-2")}
eyeg = {ob.vertex_groups[n].index for n in ("helper-l-eye", "helper-r-eye")}
def ss(t): t = max(0, min(1, t)); return t*t*(3-2*t)
basis = kb["Basis"].data
nodes_eye = bpy.data.materials["Eye"].node_tree.nodes; nodes_skin = bpy.data.materials["Skin"].node_tree.nodes
eye_old = Vector(nodes_eye["EyeCenter"].inputs[1].default_value)
tb = kb["custom-tear-bag"].value
for n in ("custom-eye-big", "custom-tear-bag", "custom-cheek-puff"): kb[n].value = 0

# 目の拡大
co, nr = full()
def center(side):
    gi = ob.vertex_groups[f"helper-{side}-eye"].index
    ps = [co[v.index] for v in me.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)]
    c = sum(ps, Vector())/len(ps); return c, max((p-c).length for p in ps)
cl, r = center("l"); cr, _ = center("r"); eye = cl.copy()
k = kb["custom-eye-big"]
for v in me.vertices:
    p = co[v.index]; k.data[v.index].co = basis[v.index].co
    if abs(p.z-cl.z) > 0.06: continue
    c = cl if p.x > 0 else cr; d = p-c; L = d.length
    if L > 0.048: continue
    w = 1-ss((L-r*1.05)/(0.048-r*1.05))
    w *= ss(abs(p.x)/0.016)                          # 顔の中央では 0 にする（左右の拡大がぶつかって、眉間に筋が出るのを防ぐ）
    sc = Vector((EYE_BALL,)*3) if any(g.group in eyeg and g.weight > 0.5 for g in v.groups) else Vector((EYE_SX, EYE_BALL, EYE_SZ))
    tilt = 0.0 if any(g.group in eyeg and g.weight > 0.5 for g in v.groups) else (abs(p.x)-abs(c.x))*math.tan(math.radians(EYE_TILT))   # 目尻側を上げ、目頭側を少し下げる
    k.data[v.index].co = basis[v.index].co+(Vector((d.x*sc.x, d.y*sc.y, d.z*sc.z))+Vector((0, 0, tilt)))*w
k.value = 1.0

# 涙袋
co, nr = full()
lid = [co[v.index] for v in me.vertices if any(g.group == bi for g in v.groups) and not any(g.group in helper and g.weight > 0.5 for g in v.groups)
       and abs(co[v.index].x-eye.x) < 0.006 and eye.z-0.025 < co[v.index].z < eye.z and co[v.index].y < eye.y-0.005]
zl = max(p.z for p in lid if p.z < eye.z-0.003); ZC = zl-0.0050
k = kb["custom-tear-bag"]
for v in me.vertices:
    k.data[v.index].co = basis[v.index].co
    if not any(g.group == bi for g in v.groups) or any(g.group in helper and g.weight > 0.5 for g in v.groups): continue
    p = co[v.index]
    if abs(p.z-ZC) > 0.014 or p.y > eye.y+0.012: continue
    dx = abs(abs(p.x)-eye.x-0.001); zc = ZC+0.0022*(dx/0.019)**2
    w = math.exp(-((p.z-zc)/0.0036)**2)*ss((0.023-dx)/0.008)
    if w >= 0.02: k.data[v.index].co = basis[v.index].co+nr[v.index]*0.0019*w
k.value = tb

# ほおのふくらみ
co, nr = full()
cx, cz = eye.x+0.014, eye.z+CHEEK_DZ
k = kb["custom-cheek-puff"]
for v in me.vertices:
    k.data[v.index].co = basis[v.index].co
    if not any(g.group == bi for g in v.groups): continue
    p = co[v.index]
    if p.y > eye.y+0.06 or abs(p.z-cz) > 0.06: continue
    w = math.exp(-(math.hypot(abs(p.x)-cx, (p.z-cz)*0.9)/0.024)**2)
    if w >= 0.02: k.data[v.index].co = basis[v.index].co+nr[v.index]*CHEEK_AMP*w
k.value = 1.0

# 色の中心・眉・前髪
dz = eye.z-eye_old.z; kx = eye.x/eye_old.x
nodes_eye["EyeCenter"].inputs[1].default_value = eye
nodes_skin["CheekCenter"].inputs[1].default_value = (eye.x+0.016, 0, eye.z-0.040)
nodes_skin["TearCenter"].inputs[1].default_value = (eye.x+0.001, 0, ZC)
if "FrontMask" in nodes_skin:      # チークなどを顔の前面だけに出すための境目
    nodes_skin["FrontMask"].inputs[1].default_value = eye.y+0.045; nodes_skin["FrontMask"].inputs[2].default_value = eye.y+0.075
for _n in nodes_skin:
    if _n.name.startswith("LidLESS_THAN") and not _n.inputs[1].is_linked: _n.inputs[1].default_value = eye.y+0.02
for _mn in ("Lash", "LashLower"):     # マスカラ（上まつ毛・下まつ毛）も目に合わせる
    _m = bpy.data.materials.get(_mn)
    if _m and "LidCenter" in _m.node_tree.nodes:
        _m.node_tree.nodes["LidCenter"].inputs["X"].default_value = eye.x; _m.node_tree.nodes["LidCenter"].inputs["Z"].default_value = eye.z
if "LidCenter" in nodes_skin:      # 二重の線と、まつ毛の生えぎわの線
    nodes_skin["LidCenter"].inputs["X"].default_value = eye.x; nodes_skin["LidCenter"].inputs["Z"].default_value = eye.z
br = bpy.data.objects["Girl_Brows"]
for v in br.data.vertices: v.co.z += dz; v.co.x *= kx
br.data.update()
p = ob["hair_params"].to_dict(); p["ZBANG"] = eye.z-T.z+BANG_DZ; ob["hair_params"] = p
exec(compile(open(r"C:\Users\shuji\Documents\girl-blender\scripts\make_hair.py", encoding="utf-8").read(), "make_hair", "exec"), dict(p))
print("face fitted. eye", tuple(round(a, 4) for a in eye), "dz", round(dz, 4))
exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bake_face_pos.py", encoding="utf-8").read(), "bake_face_pos.py", "exec"), {"__name__": "__main__"})   # 顔の模様の位置を書き直す
if _rig: _rig.data.pose_position = _pose                 # 姿勢を元に戻す
