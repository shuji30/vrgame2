# 顔をリアル寄り（1 人目の女の子と同じ作り）に戻す（Blender の中で exec する）。girl2.blend 用。
# ドール顔のための変形（custom-doll-base・custom-vline・custom-head-small）とアニメ調の瞳を外し、顔の形の値を元に戻す。
import bpy
D = "C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\"
ob = bpy.data.objects["Girl_Body"]; kb = ob.data.shape_keys.key_blocks
def run(f, g): exec(compile(open(D+f, encoding="utf-8").read(), D+f, "exec"), g)
fp = ob["face_params"].to_dict(); fp.update(EYE_SX=0.255, EYE_SZ=0.10, EYE_BALL=0.08, CHEEK_AMP=0.0024); ob["face_params"] = fp
BASE = {"custom-doll-base": 0.0, "custom-vline": 0.0, "custom-head-small": 0.0, "custom-jaw-slim": 1.0, "custom-eyenose-low": 1.0,
        "head-oval": 0.15, "head-round": 0.7, "head-invertedtriangular": 0.2, "head-fat-decr": 0.0,
        "chin-width-decr": 0.35, "l-cheek-volume-incr": 1.0, "r-cheek-volume-incr": 1.0, "l-cheek-inner-incr": 0.45, "r-cheek-inner-incr": 0.45,
        "l-cheek-bones-decr": 0.2, "r-cheek-bones-decr": 0.2, "l-eye-bag-decr": 1.0, "r-eye-bag-decr": 1.0,
        "nose-scale-horiz-decr": 0.55, "nose-scale-vert-decr": 0.45, "nose-curve-concave": 0.55, "nose-flaring-decr": 0.35,
        "nose-scale-depth-incr": 0.30, "nose-greek-incr": 0.05, "nose-trans-forward": 0.3, "nose-trans-up": -0.45, "nose-base-down": 0.25,
        "l-eye-trans-down": 1.25, "r-eye-trans-down": 1.25, "l-eye-trans-out": 0.45, "r-eye-trans-out": 0.45,
        "l-eye-height1-incr": 0.25, "r-eye-height1-incr": 0.25, "l-eye-height2-incr": 0.65, "r-eye-height2-incr": 0.65, "l-eye-height3-incr": 0.90, "r-eye-height3-incr": 0.90,
        "l-eye-corner1-down": 1.6, "r-eye-corner1-down": 1.6,      # 目頭（鼻側）を下げる
        "l-ear-wing-decr": 0.8, "r-ear-wing-decr": 0.8, "l-ear-scale-decr": 0.3, "r-ear-scale-decr": 0.3}
if "custom-lip-sym" in kb: kb["custom-lip-sym"].value = 0.0
for _k in ("l-eye-corner1-down", "r-eye-corner1-down", "l-eye-trans-down", "r-eye-trans-down"): kb[_k].slider_max = 2.0
kb["nose-trans-up"].slider_min = -1.0                    # 負の値で鼻を下げる
run("set_eye_outer.py", {"OUT": 0.0045, "DOWN": 0.0035, "IN_DOWN": 0.0040})      # 目尻を外へ広げて下げる形を作る
BASE["custom-eye-outer"] = 1.0
run("set_eye_tilt.py", {"TILT": 1.5, "CORNER": 0.0, "EXTRA_KEYS": {k: v for k, v in BASE.items() if k in kb}})
for k, v in (("mouth-upperlip-volume-incr", 0.35), ("mouth-lowerlip-volume-incr", 0.25), ("custom-duck-lip", 0.08), ("mouth-scale-horiz-decr", 0.0),
             ("mouth-trans-up", 0.35), ("mouth-trans-backward", 0.35), ("mouth-angles-up", 0.2), ("custom-tear-bag", 0.0)): kb[k].value = v
if "custom-lip-sym" in kb: kb["custom-lip-sym"].value = 0.0
SK = bpy.data.materials["Skin"].node_tree.nodes
SK["TearRange"].inputs["To Min"].default_value = 0.0                      # 涙袋なし（明るい色も入れない）
SK["CheekMix"].inputs[6].default_value = (0.80, 0.58, 0.49, 1)           # 肌：自然な明るさ
nt = bpy.data.materials["Eye"].node_tree; N = nt.nodes; L = nt.links      # 瞳：アニメ調の描き足しを外して、茶色に戻す
for n in [n for n in N if n.name.startswith("An")]: N.remove(n)
L.new(N["Math.001"].outputs[0], N["IrisRamp"].inputs[0]); L.new(N["IrisRamp"].outputs["Color"], N["HlMix"].inputs[6])
L.new(N["HlRange"].outputs[0], N["HlMix"].inputs[0]); L.new(N["HlRange"].outputs[0], N["HlEm"].inputs[0])
N["HlRange"].inputs[1].default_value = 0.10; N["HlRange"].inputs[2].default_value = 0.14
for el in N["IrisRamp"].color_ramp.elements:
    q = round(el.position, 3)
    if q in (0.0, 0.178): el.color = (0.004, 0.004, 0.004, 1)
    elif q == 0.201: el.color = (0.06, 0.027, 0.013, 1)
    elif q == 0.29: el.color = (0.22, 0.105, 0.045, 1)
    elif q == 0.38: el.color = (0.11, 0.05, 0.022, 1)
    elif q in (0.466, 0.5): el.color = (0.014, 0.008, 0.006, 1)
SK["CheekFalloff"].inputs["To Min"].default_value = 0.32; SK["CheekFalloff"].inputs["From Max"].default_value = 0.044
SK["CheekCenter"].inputs[1].default_value = (0.050, 0.0, SK["LidCenter"].inputs["Z"].default_value-0.040)      # ほっぺのチーク
SK["CheekMix"].inputs[7].default_value = (0.90, 0.30, 0.34, 1)
LP = bpy.data.materials["Lips"].node_tree.nodes["MkMix"]
LP.inputs[6].default_value = (0.70, 0.17, 0.20, 1); LP.inputs[7].default_value = (0.86, 0.42, 0.42, 1)
_lm = bpy.data.materials["Lash"]; LU = _lm.node_tree.nodes
if "lash_base" in _lm: LU["LashLen"].inputs["To Min"].default_value, LU["LashLen"].inputs["To Max"].default_value = list(_lm["lash_base"])
if "lash_base" in _lm:            # マスカラ：まつ毛を長く、濃く
    LU["LashLen"].inputs["To Min"].default_value *= 1.9; LU["LashLen"].inputs["To Max"].default_value *= 2.1
LU["Map Range"].inputs["From Min"].default_value = 0.10; LU["Map Range"].inputs["From Max"].default_value = 0.36
_ll = bpy.data.materials["LashLower"].node_tree.nodes
if "lash_base" not in _ll["LashLen"]: _ll["LashLen"]["lash_base"] = [_ll["LashLen"].inputs["To Min"].default_value, _ll["LashLen"].inputs["To Max"].default_value]
_ll["LashLen"].inputs["To Min"].default_value = _ll["LashLen"]["lash_base"][0]*1.3; _ll["LashLen"].inputs["To Max"].default_value = _ll["LashLen"]["lash_base"][1]*1.4
b = next(n for n in bpy.data.materials["Brow"].node_tree.nodes if n.type == "BSDF_PRINCIPLED"); b.inputs["Base Color"].default_value = (0.19, 0.11, 0.062, 1)
def brows_fix():
    """眉を作り直す：目の上の肌の表面に沿った、細い弓形の帯（頭の大きさや目の位置を変えると、古い眉は肌の中に入ってしまう）"""
    import math
    from mathutils import Vector
    br = bpy.data.objects["Girl_Brows"]; rg = bpy.data.objects.get("Girl_Rig"); was = rg.data.pose_position if rg else None
    if rg: rg.data.pose_position = 'REST'; bpy.context.view_layer.update()
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    EX = SK["LidCenter"].inputs["X"].default_value; EZ = SK["LidCenter"].inputs["Z"].default_value
    vs = []; fs = []; NB = 14
    for sg in (1, -1):
        base = len(vs)
        for i in range(NB+1):
            t = i/NB; x = EX-0.017+0.041*t; zc = EZ+0.0165+0.0085*math.sin(math.pi*t**0.9)-0.0015*t; hw = 0.0022*(1-0.75*t**2)       # 細く、ゆるいアーチ
            for dz in (hw, -hw):
                hit, loc, nor, idx = ev.ray_cast(Vector((sg*x, -0.5, zc+dz)), Vector((0, 1, 0)))
                vs.append((sg*x, (loc.y if hit else -0.13)-0.0012, zc+dz))
        for i in range(NB):
            q = (base+2*i, base+2*i+1, base+2*i+3, base+2*i+2); fs.append(q if sg > 0 else q[::-1])
    if br.data.shape_keys: br.shape_key_clear()
    mats = list(br.data.materials); me2 = bpy.data.meshes.new("Girl_Brows"); me2.from_pydata(vs, [], fs); me2.update()
    for m_ in mats: me2.materials.append(m_)
    old = br.data; br.data = me2; bpy.data.meshes.remove(old)
    for g in list(br.vertex_groups): br.vertex_groups.remove(g)
    br.vertex_groups.new(name="head").add(list(range(len(vs))), 1.0, 'REPLACE')
    for m_ in mats: m_.use_backface_culling = False
    br.hide_viewport = False; br.hide_render = False
    if rg: rg.data.pose_position = was
    print("brows rebuilt", len(vs))
brows_fix()
run("set_lip_sym.py", {"AMT": 1.0})                     # 上下の唇を同じ厚さに
_lp = bpy.data.materials["Lips"].node_tree.nodes         # 色の濃淡を合わせ目から上下同じに。つやを弱めて、上下の光り方の差を小さく
_lp["MkSub"].inputs[1].default_value = ob["lip_seam_z"]
_pb = next(n for n in _lp if n.type == "BSDF_PRINCIPLED"); _pb.inputs["Coat Weight"].default_value = 0.2; _pb.inputs["Roughness"].default_value = 0.38
run("make_expressions.py", {"__name__": "__main__"}); run("bake_face_pos.py", {"__name__": "__main__"})
run("make_eyes_contact.py", {"SIZE": 1.25, "COLOR": "brown"})
_nt = bpy.data.materials["Skin"].node_tree            # 肌の模様が位置を読めるようにつなぎ直す（外れるとチークもアイシャドウも消える）
_a = _nt.nodes.get("MkRestPos") or _nt.nodes.new("ShaderNodeAttribute"); _a.name = "MkRestPos"; _a.attribute_type = "GEOMETRY"; _a.attribute_name = "mk_pos"
for _n in _nt.nodes:
    if _n.type == "SEPXYZ" and not _n.inputs[0].is_linked: _nt.links.new(_a.outputs["Vector"], _n.inputs[0])
print("real face done")
