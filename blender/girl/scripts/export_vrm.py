# ゲーム用に VRM 1.0 で書き出す（Blender の中で exec する）。出力は export\girl.vrm。
#   1) 見えている物（体・服・髪・眉・口の中）の写しを X_* という名前で作る。サングラスは入れない
#      体：隠してある頂点を消し、いまの顔・体の形を基本の形にして、表情（exp-*）だけを残す
#   2) 色を画像に焼く：肌・瞳・まつ毛・髪・服の柄は Blender 専用の計算で描いているので、そのままでは書き出せない
#   3) 人型の骨の割り当て・表情・作者などを VRM の設定に入れ、T ポーズにして書き出す
# 書き出したあと、写しは消して、姿勢を元に戻す。
import bpy, bmesh, os, re, math
import numpy as np
from mathutils import Vector, Matrix

D = "C:\\Users\\shuji\\Documents\\girl-blender\\"
OUT = D+"export\\"; os.makedirs(OUT, exist_ok=True)
NAME = globals().get("NAME", "girl"); TITLE = globals().get("TITLE", "Girl (swim)")      # 出力ファイル名（NAME.vrm）と、モデルの名前
sc = bpy.context.scene; rig = bpy.data.objects["Girl_Rig"]; arm = rig.data
EXPS = ("aa", "ih", "ou", "ee", "oh", "happy", "surprised", "blink", "relaxed", "blinkLeft", "blinkRight")
for o in [o for o in bpy.data.objects if o.name.startswith("X_")]: bpy.data.objects.remove(o, do_unlink=True)
col = bpy.data.collections.get("Export") or bpy.data.collections.new("Export")
if col.name not in sc.collection.children: sc.collection.children.link(col)
rig.data.pose_position = 'REST'; bpy.context.view_layer.update()
if "hairSwingEnd" not in arm.bones:                     # 髪の揺れ骨の先（揺れものは、骨が 2 つつながっていないと動かない）
    for o in bpy.context.view_layer.objects: o.select_set(False)
    _hid = (rig.hide_viewport, rig.hide_get()); rig.hide_viewport = False; rig.hide_set(False)      # 隠してあると編集に入れない
    rig.select_set(True); bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
    _p = arm.edit_bones["hairSwing"]; _e = arm.edit_bones.new("hairSwingEnd"); _e.head = _p.tail; _e.tail = _p.tail+(_p.tail-_p.head).normalized()*0.05; _e.parent = _p; _e.use_connect = True
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.hide_viewport = _hid[0]; rig.hide_set(_hid[1])

# ── 1) 写しを作る ──
def copy_obj(src, name):
    o = src.copy(); o.data = src.data.copy(); o.name = name; o.data.name = name
    for c in list(o.users_collection): c.objects.unlink(o)
    col.objects.link(o); o.hide_viewport = False; o.hide_render = False
    for md in [m for m in o.modifiers if m.type != 'ARMATURE']: o.modifiers.remove(md)
    return o
src_body = bpy.data.objects["Girl_Body"]
xb = copy_obj(src_body, "X_Body")
bidx = xb.vertex_groups["body"].index
bm = bmesh.new(); bm.from_mesh(xb.data); dl = bm.verts.layers.deform.verify()
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v[dl].get(bidx, 0.0) <= 0.5], context='VERTS')
bm.to_mesh(xb.data); bm.free(); xb.data.update()
kb = xb.data.shape_keys.key_blocks; n = len(xb.data.vertices)
def kco(k): a = np.zeros(n*3); k.data.foreach_get("co", a); return a.reshape(n, 3)
for e in EXPS: kb["exp-"+e].value = 0
bpy.context.view_layer.update()
ev = xb.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
mix = np.zeros(n*3); m.vertices.foreach_get("co", mix); mix = mix.reshape(n, 3); ev.to_mesh_clear()
B = kco(kb["Basis"]); deltas = {e: kco(kb["exp-"+e])-B for e in EXPS}
xb.shape_key_clear(); xb.data.vertices.foreach_set("co", mix.ravel()); xb.data.update()
xb.shape_key_add(name="Basis", from_mix=False)
for e in EXPS: xb.shape_key_add(name="exp-"+e, from_mix=False).data.foreach_set("co", (mix+deltas[e]).ravel())
for g in [g for g in xb.vertex_groups if g.name not in arm.bones]: xb.vertex_groups.remove(g)
others = {}
for o in list(bpy.data.objects):
    if o.type != 'MESH' or o is src_body or o.name.startswith("X_") or o.hide_viewport or o.parent is not rig or o.parent_type == 'BONE': continue
    x = copy_obj(o, "X_"+o.name.split("_", 1)[-1]); others[o.name] = x
    for g in [g for g in x.vertex_groups if g.name not in arm.bones]: x.vertex_groups.remove(g)
print("copies:", ["X_Body"]+[x.name for x in others.values()], "body verts", n)

# ── 2) 色を焼く ──
old_engine = sc.render.engine; sc.render.engine = 'CYCLES'; sc.cycles.samples = 1; sc.cycles.device = 'CPU'
def image(name, size, noncolor=False):
    im = bpy.data.images.get(name)
    if im: bpy.data.images.remove(im)
    im = bpy.data.images.new(name, size, size, alpha=True)
    if noncolor: im.colorspace_settings.name = 'Non-Color'
    return im
dummy = image("bake_dummy", 16)
def bake(obj, targets, alpha=False):
    """targets: {マテリアル名: 画像}。alpha=True のときは、透明度（Alpha につながっている値）を色として焼く"""
    temp = []; undo = []
    for slot in obj.material_slots:
        mt = slot.material; nt = mt.node_tree
        nd = nt.nodes.new("ShaderNodeTexImage"); nd.image = targets.get(mt.name, dummy); nt.nodes.active = nd; temp.append((nt, nd))
        if alpha and mt.name in targets:
            b = next(x for x in nt.nodes if x.type == "BSDF_PRINCIPLED"); bc = b.inputs["Base Color"]
            prev = bc.links[0].from_socket if bc.is_linked else None
            if b.inputs["Alpha"].is_linked: nt.links.new(b.inputs["Alpha"].links[0].from_socket, bc)
            else:
                for l in list(bc.links): nt.links.remove(l)
                undo.append((bc, tuple(bc.default_value))); bc.default_value = (1, 1, 1, 1)
            undo.append((nt, bc, prev))
    for o in bpy.context.view_layer.objects: o.select_set(False)
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=8, use_clear=True)
    for u in undo:
        if len(u) == 3:
            nt, bc, prev = u
            for l in list(bc.links): nt.links.remove(l)
            if prev: nt.links.new(prev, bc)
    for u in undo:
        if len(u) == 2: u[0].default_value = u[1]
    for nt, nd in temp: nt.nodes.remove(nd)
def merge(color, alpha_im, path):
    w, h = color.size; a = np.empty(w*h*4, dtype=np.float32); color.pixels.foreach_get(a); a = a.reshape(-1, 4)
    if alpha_im is not None:
        b = np.empty(w*h*4, dtype=np.float32); alpha_im.pixels.foreach_get(b); a[:, 3] = b.reshape(-1, 4)[:, 0]
    else: a[:, 3] = 1.0
    color.pixels.foreach_set(a.ravel()); color.filepath_raw = path; color.file_format = 'PNG'; color.save()
def texmat(name, img, cutout=False):
    mt = bpy.data.materials.get(name)
    if mt: bpy.data.materials.remove(mt)
    mt = bpy.data.materials.new(name); mt.use_nodes = True; nt = mt.node_tree
    b = next(x for x in nt.nodes if x.type == "BSDF_PRINCIPLED"); b.inputs["Roughness"].default_value = 0.7
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = img; nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    if cutout:                                           # 透明度を 0 か 1 に丸める（書き出しで「切りぬき」になる）
        r = nt.nodes.new("ShaderNodeMath"); r.operation = 'ROUND'; nt.links.new(t.outputs["Alpha"], r.inputs[0]); nt.links.new(r.outputs[0], b.inputs["Alpha"])
    mt.use_backface_culling = False
    return mt
def one_material(obj, mt):
    obj.data.materials.clear(); obj.data.materials.append(mt)
    for p in obj.data.polygons: p.material_index = 0
def unwrap(obj):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    if not obj.data.uv_layers: obj.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(island_margin=0.02); bpy.ops.object.mode_set(mode='OBJECT')

# 体：肌・唇 / 目 / まつ毛を、べつの画像へ（UV が重なっているかもしれないので分ける）
names = [s.name for s in xb.material_slots]
skin_i = image("bake_skin", 2048); eye_i = image("bake_eye", 512); lash_i = image("bake_lash", 512); lash_a = image("bake_lash_a", 512, True)
SKIN = ("Skin", "Lips", "MouthInner", "Teeth", "Tongue"); LASH = ("Lash", "LashLower")
tg = {nm: skin_i for nm in SKIN}; tg["Eye"] = eye_i; tg.update({nm: lash_i for nm in LASH})
def _eye_uv():
    """目の玉の UV を、目の画像いっぱいに広げる（元の UV では目が 27×13 ピクセルほどしかなく、瞳がつぶれて白くなる）"""
    if "Eye" not in names: return
    uvd = xb.data.uv_layers.active.data; ei = names.index("Eye")
    ls = [l for p in xb.data.polygons if p.material_index == ei for l in p.loop_indices]
    if not ls: return
    us = [uvd[l].uv.x for l in ls]; vs = [uvd[l].uv.y for l in ls]; u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    for l in ls: uvd[l].uv = (0.04+0.92*(uvd[l].uv.x-u0)/max(u1-u0, 1e-6), 0.04+0.92*(uvd[l].uv.y-v0)/max(v1-v0, 1e-6))
_eye_uv()
bake(xb, tg); bake(xb, {nm: lash_a for nm in LASH}, alpha=True)
merge(skin_i, None, OUT+"skin.png"); merge(eye_i, None, OUT+"eye.png"); merge(lash_i, lash_a, OUT+"lash.png")
M = [texmat("X_Skin", skin_i), texmat("X_Eye", eye_i), texmat("X_Lash", lash_i, True)]
grp = [0 if nm in SKIN else (1 if nm == "Eye" else (2 if nm in LASH else 0)) for nm in names]
pm = [grp[p.material_index] for p in xb.data.polygons]
xb.data.materials.clear()
for mt in M: xb.data.materials.append(mt)
for p, g in zip(xb.data.polygons, pm): p.material_index = g
print("baked body")
# 髪・柄のある服
def _linked(mt):
    b = next((x for x in mt.node_tree.nodes if x.type == "BSDF_PRINCIPLED"), None) if mt and mt.node_tree else None
    return bool(b and b.inputs["Base Color"].is_linked)
for o in others.values():
    mats = [s.name for s in o.material_slots]
    if o.name.startswith("X_Hair"):
        ci = image("bake_"+o.name, 1024); ai = image("bake_"+o.name+"_a", 1024, True)
        bake(o, {mats[0]: ci}); bake(o, {mats[0]: ai}, alpha=True); merge(ci, ai, OUT+o.name+".png")
        one_material(o, texmat(o.name+"_M", ci, True))
    elif "S_Pattern" in mats or "J_Pattern" in mats:
        unwrap(o); ci = image("bake_"+o.name, 1024)
        bake(o, {nm: ci for nm in mats}); merge(ci, None, OUT+o.name+".png"); one_material(o, texmat(o.name+"_M", ci))
    elif any(_linked(s.material) for s in o.material_slots):      # 計算で描いた柄（デニムなど）の材質だけを画像に焼く。金具などはそのまま
        lk = [s.name for s in o.material_slots if _linked(s.material)]
        unwrap(o); ci = image("bake_"+o.name, 1024)
        bake(o, {nm: ci for nm in lk}); merge(ci, None, OUT+o.name+".png"); tm = texmat(o.name+"_M", ci)
        for s in o.material_slots:
            if s.name in lk: s.material = tm
            else: s.material.use_backface_culling = False
    else:
        for s in o.material_slots: s.material.use_backface_culling = False
    print("baked", o.name)
sc.render.engine = old_engine

# ── 3) VRM の設定 ──
ext = arm.vrm_addon_extension; ext.spec_version = ext.SPEC_VERSION_VRM1; v1 = ext.vrm1
def snake(s): return re.sub(r"(?<!^)(?=[A-Z])", "_", s).lower()
hb = v1.humanoid.human_bones
for b in arm.bones:
    if b.name.startswith("hairSwing"): continue
    getattr(hb, snake(b.name)).node.bone_name = b.name
for e in EXPS:
    ex = getattr(v1.expressions.preset, snake(e)); ex.morph_target_binds.clear()
    for obj in [xb]+[o for o in others.values() if o.data.shape_keys and "exp-"+e in o.data.shape_keys.key_blocks]:
        bd = ex.morph_target_binds.add(); bd.node.mesh_object_name = obj.name; bd.index = "exp-"+e; bd.weight = 1.0
# 視線：目の骨を回して、見る相手を追う。目の位置（頭の骨から見た、両目のまん中）を入れる
_hb = arm.bones["head"].head_local; _em = (arm.bones["leftEye"].head_local+arm.bones["rightEye"].head_local)/2
v1.look_at.type = 'bone'; v1.look_at.offset_from_head_bone = tuple(_em-_hb)
for _n, _out in (("range_map_horizontal_inner", 8.0), ("range_map_horizontal_outer", 10.0), ("range_map_vertical_down", 8.0), ("range_map_vertical_up", 8.0)):
    _r = getattr(v1.look_at, _n); _r.input_max_value = 90.0; _r.output_scale = _out
# 揺れもの：髪（耳の高さから下）を、頭の動きに遅れて揺らす
_sb = ext.spring_bone1
while len(_sb.springs): bpy.ops.vrm.remove_spring_bone1_spring(armature_object_name=rig.name, spring_index=0)
bpy.ops.vrm.add_spring_bone1_spring(armature_object_name=rig.name); _sp = _sb.springs[0]; _sp.vrm_name = "hair"
for _bn in ("hairSwing", "hairSwingEnd"):
    bpy.ops.vrm.add_spring_bone1_spring_joint(armature_object_name=rig.name, spring_index=0, guess_properties=False)
    _j = _sp.joints[-1]; _j.node.bone_name = _bn; _j.hit_radius = 0.0; _j.stiffness = 0.8; _j.gravity_power = 0.35; _j.gravity_dir = (0, 0, -1); _j.drag_force = 0.45
v1.meta.vrm_name = TITLE; v1.meta.version = "1"
v1.meta.authors.clear(); v1.meta.authors.add().value = "shuji30"
v1.meta.commercial_usage = "corporation"                 # 売り物のゲームに使えるように、商用利用を許可（再配布・改変は「不可」のまま）
# T ポーズ：腕を真横、脚を真下へ
rig.data.pose_position = 'POSE'; P = rig.pose.bones
sw = [(c, c.mute) for c in P["hairSwing"].constraints]
for c, _ in sw: c.mute = True
saved = {pb.name: (pb.rotation_mode, pb.rotation_quaternion.copy(), pb.location.copy()) for pb in P}
for pb in P: pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
bpy.context.view_layer.update()
def aim(name, d):
    pb = P[name]; q = (pb.tail-pb.head).normalized().rotation_difference(Vector(d).normalized())
    pb.matrix = Matrix.Translation(pb.head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-pb.head) @ pb.matrix; bpy.context.view_layer.update()
for side, s in (("left", 1), ("right", -1)):
    for b in ("Shoulder", "UpperArm", "LowerArm", "Hand"): aim(side+b, (s, 0, 0))
    for b in ("UpperLeg", "LowerLeg"): aim(side+b, (0, 0, -1))
try: v1.humanoid.pose = 'currentPose'
except Exception as err: print("pose enum:", [i.identifier for i in v1.humanoid.bl_rna.properties["pose"].enum_items], err)
for o in bpy.context.view_layer.objects: o.select_set(False)
for o in [rig, xb]+list(others.values()): o.select_set(True)
bpy.context.view_layer.objects.active = rig
res = bpy.ops.export_scene.vrm(filepath=OUT+NAME+".vrm", export_only_selections=True, export_invisibles=False, armature_object_name=rig.name, ignore_warning=True)
print("export:", res, os.path.getsize(OUT+NAME+".vrm") if os.path.exists(OUT+NAME+".vrm") else "no file")
# 片づけ
for pb in P:
    md, q, l = saved[pb.name]; pb.rotation_mode = md; pb.rotation_quaternion = q; pb.location = l
for c, mu in sw: c.mute = mu
for o in [xb]+list(others.values()): bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.update()
