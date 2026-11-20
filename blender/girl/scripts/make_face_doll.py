# 2 人目の女の子の顔（ドール風：大きな青い目・色白・小さめの赤い唇）にする（Blender の中で exec する）。girl2.blend 用。
# 目の形 → 目尻とメイク（set_eye_tilt.py が fit_face.py と make_makeup_jirai.py を実行）→ 色と唇を上書き → 表情を作り直す、の順。
import bpy
D = "C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\"
ob = bpy.data.objects["Girl_Body"]; kb = ob.data.shape_keys.key_blocks
def run(f, g): exec(compile(open(D+f, encoding="utf-8").read(), D+f, "exec"), g)
fp = ob["face_params"].to_dict(); kb["custom-jaw-slim"].slider_max = 2.0; fp["CHEEK_AMP"] = 0.0016       # ほおのふくらみは付けない
fp.update(EYE_SX=0.38, EYE_SZ=0.50, EYE_BALL=0.28)       # 縦に大きい、丸い目
kb["custom-eyenose-low"].slider_max = 3.0; ob["face_params"] = fp
for k, v in (("l-ear-wing-decr", 0.0), ("r-ear-wing-decr", 0.0), ("l-ear-scale-decr", 0.0), ("r-ear-scale-decr", 0.0), ("chin-width-decr", 0.7), ("nose-scale-horiz-decr", 0.8), ("head-round", 0.5), ("head-oval", 0.4)): kb[k].value = v
run("set_head.py", {"S": 0.88})
run("set_vline.py", {"AMT": 0.09})
run("set_dollbase.py", {"SHORT": 0.80, "NARROW": 0.16, "FILL": 0.0080})       # 顔の土台：下半分を短く、あごへ向けて細く
run("set_eye_tilt.py", {"TILT": -5.0, "CORNER": 0.25, "EXTRA_KEYS": {"custom-head-small": 0.0, "l-eye-bag-decr": 1.0, "r-eye-bag-decr": 1.0, "custom-doll-base": 1.0, "custom-vline": 0.0, "l-cheek-volume-incr": 0.8, "r-cheek-volume-incr": 0.8, "l-cheek-inner-incr": 0.3, "r-cheek-inner-incr": 0.3, "l-cheek-bones-decr": 0.2, "r-cheek-bones-decr": 0.2, "head-fat-decr": 0.0, "head-fat-incr": 0.0, "l-eye-height1-incr": 0.2, "r-eye-height1-incr": 0.2, "l-eye-height2-incr": 0.7, "r-eye-height2-incr": 0.7, "l-eye-height3-incr": 0.4, "r-eye-height3-incr": 0.4, "l-eye-trans-out": 0.6, "r-eye-trans-out": 0.6, "nose-greek-incr": 0.2, "nose-scale-depth-incr": 0.35, "nose-trans-forward": 0.1, "nose-curve-concave": 0.45, "custom-eyenose-low": 1.0, "l-eye-trans-down": 0.45, "r-eye-trans-down": 0.45, "nose-trans-up": 0.2, "nose-base-down": 0.25}})       # たれ目・小さい頭・目と鼻を下へ
for k, v in (("mouth-upperlip-volume-incr", 0.75), ("mouth-lowerlip-volume-incr", 0.85), ("custom-duck-lip", 0.22), ("mouth-trans-up", 0.45), ("mouth-trans-backward", 0.20), ("mouth-angles-up", 0.35), ("mouth-scale-horiz-decr", 1.0), ("custom-tear-bag", 0.0)): kb[k].value = v
SK = bpy.data.materials["Skin"].node_tree.nodes
SK["TearRange"].inputs["To Min"].default_value = 0.0                      # 涙袋なし
SK["CheekMix"].inputs[6].default_value = (0.90, 0.73, 0.67, 1)           # 肌：色白
SK["CheekMix"].inputs[7].default_value = (0.95, 0.50, 0.55, 1); SK["CheekFalloff"].inputs["To Min"].default_value = 0.80; SK["CheekFalloff"].inputs["From Max"].default_value = 0.044      # ほおに、ふんわりしたピンクのチーク
if "MkNoseMix" in SK: SK["MkNoseMix"].inputs[7].default_value = (0.95, 0.50, 0.55, 1)
for n, c in (("MkShadowMix", (0.72, 0.42, 0.40)), ("MkShadow2Mix", (0.45, 0.24, 0.22))):
    if n in SK: SK[n].inputs[7].default_value = (*c, 1)
ramp = bpy.data.materials["Eye"].node_tree.nodes["IrisRamp"].color_ramp       # 瞳：青
for el in ramp.elements:
    q = round(el.position, 3)
    if q == 0.201: el.color = (0.04, 0.12, 0.34, 1)
    elif q == 0.29: el.color = (0.20, 0.50, 0.88, 1)
    elif q == 0.38: el.color = (0.08, 0.25, 0.62, 1)
    elif q in (0.466, 0.5): el.color = (0.006, 0.012, 0.035, 1)
LP = bpy.data.materials["Lips"].node_tree.nodes["MkMix"]                     # 唇：赤
LP.inputs[6].default_value = (0.50, 0.04, 0.12, 1); LP.inputs[7].default_value = (0.74, 0.17, 0.27, 1)       # 深いローズ
b = next(n for n in bpy.data.materials["Brow"].node_tree.nodes if n.type == "BSDF_PRINCIPLED"); b.inputs["Base Color"].default_value = (0.36, 0.26, 0.19, 1)
# まつ毛：上は長く、目尻へ向かってさらに長くはね上げる。下は短く、まばらに
_lm = bpy.data.materials["Lash"]; LU = _lm.node_tree.nodes
if "lash_base" not in _lm: _lm["lash_base"] = [LU["LashLen"].inputs["To Min"].default_value, LU["LashLen"].inputs["To Max"].default_value]
_b = list(_lm["lash_base"]); LU["LashLen"].inputs["To Min"].default_value = _b[0]*1.3; LU["LashLen"].inputs["To Max"].default_value = _b[1]*3.0
LW = bpy.data.materials["LashLower"].node_tree.nodes
LW["LashLen"].inputs["To Min"].default_value = -0.0012; LW["LashLen"].inputs["To Max"].default_value = -0.0030
LW["Map Range"].inputs["From Min"].default_value = 0.56; LW["Map Range"].inputs["From Max"].default_value = 0.74
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
            t = i/NB; x = EX-0.017+0.041*t; zc = EZ+0.0215+0.0026*math.sin(math.pi*min(1, t*1.25))-0.0025*t*t; hw = 0.0016*(1-0.75*t**2)       # 細く、ゆるいアーチ
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
run("make_eyes_anime.py", {"__name__": "__main__"})
run("make_expressions.py", {"__name__": "__main__", "BAG": 0.40}); run("bake_face_pos.py", {"__name__": "__main__"})
print("doll face done")
