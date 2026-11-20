# 人型の骨組み（Girl_Rig）を作り、体にウェイトを付ける（Blender の中で exec する）。
#   骨の位置は、体のメッシュに入っている関節の目印（頂点グループ joint-*）から決める。
#   骨の名前は VRM の人型と同じ（hips / spine / chest / upperChest / neck / head / leftUpperArm …）。
#   left は本人から見た左（Blender では +X 側。体は -Y を向いている）。
#   体のウェイトは、肌の面だけを取り出した仮のメッシュに自動ウェイトをかけて写す（目印などの補助の形が混ざると失敗するため）。
#   目・歯・舌・まつ毛は頭（目は目の骨）にぴったり付ける。
# 最後に bind_rig.py を実行して、服・髪・小物も追従させる。
import bpy, numpy as np
from mathutils import Vector

D = "C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\"
body = bpy.data.objects["Girl_Body"]; me = body.data
old = bpy.data.objects.get("Girl_Rig")
if old:
    for o in bpy.data.objects:
        if o.parent is old: o.parent = None
        for md in [m for m in o.modifiers if m.type == 'ARMATURE' and m.object is old] if o.type == 'MESH' else []: o.modifiers.remove(md)
    arm_old = old.data; bpy.data.objects.remove(old, do_unlink=True); bpy.data.armatures.remove(arm_old)
mk = next(m for m in body.modifiers if m.type == 'MASK'); mk.show_viewport = False; bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); e = body.evaluated_get(dg); m = e.to_mesh()
co = [v.co.copy() for v in m.vertices]; e.to_mesh_clear(); mk.show_viewport = True
gi = {g.name: g.index for g in body.vertex_groups}
def members(n): return [v.index for v in me.vertices if any(g.group == gi[n] and g.weight > 0.5 for g in v.groups)]
def J(n): ps = [co[i] for i in members("joint-"+n)]; return sum(ps, Vector())/len(ps)

# ── 骨の一覧：名前, 根元, 先, 親, 親の先につなぐか ──
B = [("hips", J("pelvis"), J("spine-3"), None, False), ("spine", J("spine-3"), J("spine-2"), "hips", True),
     ("chest", J("spine-2"), J("spine-1"), "spine", True), ("upperChest", J("spine-1"), J("neck"), "chest", True),
     ("neck", J("neck"), J("head"), "upperChest", True), ("head", J("head"), J("head-2"), "neck", True)]
FING = (("Thumb", 1), ("Index", 2), ("Middle", 3), ("Ring", 4), ("Little", 5))
for side, s in (("left", "l"), ("right", "r")):
    B += [(side+"Shoulder", J(s+"-clavicle"), J(s+"-shoulder"), "upperChest", False),
          (side+"UpperArm", J(s+"-shoulder"), J(s+"-elbow"), side+"Shoulder", True),
          (side+"LowerArm", J(s+"-elbow"), J(s+"-hand"), side+"UpperArm", True),
          (side+"Hand", J(s+"-hand"), J(s+"-finger-3-1"), side+"LowerArm", True),
          (side+"UpperLeg", J(s+"-upper-leg"), J(s+"-knee"), "hips", False),
          (side+"LowerLeg", J(s+"-knee"), J(s+"-ankle"), side+"UpperLeg", True),
          (side+"Foot", J(s+"-ankle"), J(s+"-foot-1"), side+"LowerLeg", True),
          (side+"Toes", J(s+"-foot-1"), J(s+"-foot-2"), side+"Foot", True),
          (side+"Eye", J(s+"-eye"), J(s+"-eye")+Vector((0, -0.03, 0)), "head", False)]
    for fname, k in FING:
        segs = ("Metacarpal", "Proximal", "Distal") if fname == "Thumb" else ("Proximal", "Intermediate", "Distal")
        parent = side+"Hand"
        for q, seg in enumerate(segs):
            nm = side+fname+seg
            B.append((nm, J(f"{s}-finger-{k}-{q+1}"), J(f"{s}-finger-{k}-{q+2}"), parent, q > 0)); parent = nm

# 髪の揺れ骨：頭の子。耳の高さを支点に、いつも真下を向く（頭を傾けても、髪の下のほうは重力で垂れる）
_hp = body["hair_params"].to_dict() if "hair_params" in body else {}
HC = Vector(_hp.get("C", (0, -0.05, 1.52)))+Vector(body.get("heel_shift", (0, 0, 0)))+Vector((0, 0, -0.012))
B.append(("hairSwing", HC, HC+Vector((0, 0, -0.12)), "head", False))
arm = bpy.data.armatures.new("Girl_Rig"); rig = bpy.data.objects.new("Girl_Rig", arm)
bpy.context.scene.collection.objects.link(rig); rig.show_in_front = True; arm.display_type = 'STICK'
for o in bpy.context.view_layer.objects: o.select_set(False)
bpy.context.view_layer.objects.active = rig; rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for nm, h, t, par, con in B:
    b = arm.edit_bones.new(nm); b.head = h; b.tail = t if (t-h).length > 1e-4 else h+Vector((0, 0, 0.02))
    if par: b.parent = arm.edit_bones[par]; b.use_connect = con and (arm.edit_bones[par].tail-b.head).length < 1e-4
bpy.ops.object.mode_set(mode='OBJECT')
names = [b[0] for b in B]
dn = bpy.data.objects.get("Girl_HairDown") or bpy.data.objects.new("Girl_HairDown", None)      # はるか真下の目印
if dn.name not in bpy.context.scene.collection.objects: bpy.context.scene.collection.objects.link(dn)
dn.parent = rig; dn.location = (HC.x, HC.y, -100.0); dn.empty_display_size = 0.02; dn.hide_viewport = True; dn.hide_render = True
_c = rig.pose.bones["hairSwing"].constraints.new('DAMPED_TRACK'); _c.name = "真下へ垂らす"; _c.target = dn; _c.track_axis = 'TRACK_Y'; _c.influence = 0.85      # 1 にすると完全に真下。顔や肩へのめり込みは bind_rig.py の「めり込み防止」が外へ押し出す

# ── 体のウェイト：肌の面だけの仮メッシュに自動ウェイト ──
real = [v.index for v in me.vertices if any(g.group in (gi["body"], gi["hidden_by_clothes"]) and g.weight > 0.5 for g in v.groups)]
INNER = {}                                               # 体の中の部品は、骨にぴったり付ける
for n, bone in (("helper-l-eye", "leftEye"), ("helper-r-eye", "rightEye"), ("helper-upper-teeth", "head"), ("helper-lower-teeth", "head"),
                ("helper-tongue", "head"), ("helper-l-eyelashes-1", "head"), ("helper-l-eyelashes-2", "head"),
                ("helper-r-eyelashes-1", "head"), ("helper-r-eyelashes-2", "head")):
    for i in members(n): INNER[i] = bone
skin = [i for i in real if i not in INNER]; pos = {i: j for j, i in enumerate(skin)}
tm = bpy.data.meshes.new("_rig_tmp")
tm.from_pydata([co[i] for i in skin], [], [[pos[v] for v in p.vertices] for p in me.polygons if all(v in pos for v in p.vertices)])
tmp = bpy.data.objects.new("_rig_tmp", tm); bpy.context.scene.collection.objects.link(tmp)
for o in bpy.context.view_layer.objects: o.select_set(False)
tmp.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
got = {g.index: g.name for g in tmp.vertex_groups}
W = {}
for v in tm.vertices:
    ws = {got[g.group]: g.weight for g in v.groups if g.weight > 0.003}
    W[skin[v.index]] = ws
n_empty = sum(1 for ws in W.values() if not ws)
bpy.data.objects.remove(tmp, do_unlink=True); bpy.data.meshes.remove(tm)
for i, bone in INNER.items(): W[i] = {bone: 1.0}
for g in [g for g in body.vertex_groups if g.name in names]: body.vertex_groups.remove(g)
vg = {n: body.vertex_groups.new(name=n) for n in names}
for i, ws in W.items():
    tot = sum(ws.values())
    if tot <= 0: ws = {"hips": 1.0}; tot = 1.0
    for n, w in ws.items(): vg[n].add([i], w/tot, 'REPLACE')
md = next((x for x in body.modifiers if x.type == 'ARMATURE'), None) or body.modifiers.new("Armature", 'ARMATURE')
md.object = rig; k = list(body.modifiers).index(md)
if k > 0: body.modifiers.move(k, 0)                      # 隠すマスクより先に、骨で動かす
body.parent = rig; body.matrix_parent_inverse = rig.matrix_world.inverted()
for o in bpy.context.view_layer.objects: o.select_set(False)
print("rig built. bones", len(names), "skin verts", len(skin), "verts without weight", n_empty)
exec(compile(open(D+"bind_rig.py", encoding="utf-8").read(), D+"bind_rig.py", "exec"), {"__name__": "__main__"})
exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bake_face_pos.py", encoding="utf-8").read(), "bake_face_pos.py", "exec"), {"__name__": "__main__"})   # 顔の模様の位置を書き直す
