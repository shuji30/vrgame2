# 地雷系メイク（Blender の中で exec する）。肌（Skin）と唇（Lips）のマテリアルに描き足す。何度実行してもよい。
#   目の下から鼻にかけての濃いチーク / 赤茶のアイシャドウ / 太めのアイラインと跳ね上げ / 明るい涙袋 / ほくろ / ツヤのある赤リップ
# 顔の位置は Skin の LidCenter（目の中心）から決めるので、fit_face.py のあとに実行する。
import bpy

ob = bpy.data.objects["Girl_Body"]; kb = ob.data.shape_keys.key_blocks
nt = bpy.data.materials["Skin"].node_tree; N = nt.nodes; L = nt.links
for n in [n for n in N if n.name.startswith("Mk")]: N.remove(n)
EX = N["LidCenter"].inputs["X"].default_value; EZ = N["LidCenter"].inputs["Z"].default_value
POS = N["Combine XYZ"].outputs[0]          # (|x|, 0, z)
FRONT = N["FrontMask"].outputs[0]          # 顔の前面だけ 1
X0 = 900

def node(kind, name, **props):
    global X0
    n = N.new(kind); n.name = "Mk"+name; n.label = name; n.location = (X0, -900); X0 += 40
    for k, v in props.items(): setattr(n, k, v)
    return n
def math(op, name, a, b=None, c=None):
    n = node("ShaderNodeMath", name, operation=op)
    for i, v in enumerate((a, b, c)):
        if v is None: continue
        if isinstance(v, (int, float)): n.inputs[i].default_value = v
        else: L.new(v, n.inputs[i])
    return n.outputs[0]
def maprange(name, v, a, b, c, d, interp='SMOOTHERSTEP'):
    n = node("ShaderNodeMapRange", name, interpolation_type=interp); L.new(v, n.inputs[0])
    for i, x in zip((1, 2, 3, 4), (a, b, c, d)): n.inputs[i].default_value = x
    return n.outputs[0]
def blob(name, cx, cz, sx, sz, r0, r1, strength, src=POS):
    """(cx, cz) を中心にした、だ円のぼかし。中心で strength、r1 で 0"""
    s = node("ShaderNodeVectorMath", name+"Sub", operation='SUBTRACT'); L.new(src, s.inputs[0]); s.inputs[1].default_value = (cx, 0, cz)
    m = node("ShaderNodeVectorMath", name+"Scl", operation='MULTIPLY'); L.new(s.outputs[0], m.inputs[0]); m.inputs[1].default_value = (sx, 0, sz)
    ln = node("ShaderNodeVectorMath", name+"Len", operation='LENGTH'); L.new(m.outputs[0], ln.inputs[0])
    return math('MULTIPLY', name+"Front", maprange(name+"Fall", ln.outputs["Value"], r0, r1, strength, 0.0), FRONT)
def layer(name, prev, fac, col):
    n = node("ShaderNodeMix", name+"Mix", data_type='RGBA'); L.new(fac, n.inputs[0]); L.new(prev, n.inputs[6]); n.inputs[7].default_value = (*col, 1)
    return n.outputs[2]

# チーク：目のすぐ下に、横に広く、濃く
N["CheekCenter"].inputs[1].default_value = (EX+0.010, 0, EZ-0.0205)
N["Vector Math"].inputs[1].default_value = (1.0, 0, 1.9)
N["CheekFalloff"].inputs["From Min"].default_value = 0.004; N["CheekFalloff"].inputs["From Max"].default_value = 0.036
N["CheekFalloff"].inputs["To Min"].default_value = 0.42
N["CheekMix"].inputs[7].default_value = (0.88, 0.25, 0.28, 1)
BLUSH = (0.88, 0.25, 0.28)
col = N["CheekMix"].outputs[2]
col = layer("Nose", col, blob("Nose", 0.0, EZ-0.0215, 1.0, 1.9, 0.002, 0.031, 0.36), BLUSH)           # 鼻筋にも赤み
# アイシャドウ：目のまわりに明るいブラウン、目尻は少し濃く
col = layer("Shadow", col, blob("Shadow", EX+0.003, EZ+0.001, 1.0, 1.45, 0.012, 0.030, 0.80), (0.60, 0.36, 0.21))
col = layer("Shadow2", col, blob("Shadow2", EX+0.021, EZ+0.0015, 1.0, 1.4, 0.0, 0.015, 0.65), (0.42, 0.23, 0.12))
# ほくろ（左ほおと、口の右下）
RAW = node("ShaderNodeCombineXYZ", "RawPos"); L.new(N["Separate XYZ"].outputs["X"], RAW.inputs["X"]); L.new(N["Separate XYZ"].outputs["Z"], RAW.inputs["Z"])
for i, (mx, mz) in enumerate(((0.041, EZ-0.036), (-0.029, EZ-0.071))):
    col = layer(f"Mole{i}", col, blob(f"Mole{i}", mx, mz, 1.0, 1.0, 0.0006, 0.0012, 0.9, RAW.outputs[0]), (0.10, 0.05, 0.04))
L.new(col, N["TearMix"].inputs[6])

# 涙袋：ふくらみと明るさはひかえめに
kb["custom-tear-bag"].value = 0.15
N["TearRange"].inputs["To Min"].default_value = 0.04
N["TearMix"].inputs[7].default_value = (1.0, 0.82, 0.76, 1)
# アイライン：太く、目尻は跳ね上げる
N["LidBand.001"].inputs["From Min"].default_value = 0.0008; N["LidBand.001"].inputs["From Max"].default_value = 0.0015
N["LidMULTIPLY.013"].inputs[1].default_value = 0.70
N["LidLinerMix"].inputs[7].default_value = (0.10, 0.055, 0.04, 1)
a = N["LidMULTIPLY.007"].inputs[1].default_value; b = N["LidMULTIPLY.008"].inputs[1].default_value; c = N["LidADD.003"].inputs[1].default_value
D0 = N["LidWinB.001"].inputs["From Min"].default_value          # 目尻（アイラインの終わり）
Z0 = a*D0*D0+b*D0+c; SL = 0.25; LEN = 0.0060     # タレ目なので、跳ね上げずに目尻を横へ少しのばす
dx = N["LidSUBTRACT"].outputs[0]; dz = N["LidSUBTRACT.001"].outputs[0]
zl = math('MULTIPLY_ADD', "WingLine", dx, SL, Z0-D0*SL)
diff = math('ABSOLUTE', "WingAbs", math('SUBTRACT', "WingDiff", dz, zl))
wid = maprange("WingWidth", dx, D0, D0+LEN, 0.0013, 0.0004, 'LINEAR')              # 先へ向かって細く
band = maprange("WingBand", math('DIVIDE', "WingRel", diff, wid), 0.6, 1.0, 1.0, 0.0)
win = math('MULTIPLY', "WingWin", maprange("WingA", dx, D0-0.003, D0-0.001, 0.0, 1.0), maprange("WingB", dx, D0+LEN-0.002, D0+LEN, 1.0, 0.0))
fac = math('MULTIPLY', "WingFac", math('MULTIPLY', "WingFac0", band, win), FRONT)
out = layer("Wing", N["LidLinerMix"].outputs[2], math('MULTIPLY', "WingSoft", fac, 0.6), (0.10, 0.055, 0.04))
# 下まぶたのふちにもラインを入れて、目をぐるりと縁取る（下まつ毛の生えぎわの線に沿わせる）
LLN = bpy.data.materials["LashLower"].node_tree.nodes
la = LLN["Math.004"].inputs[1].default_value; lb = LLN["LashSlope"].inputs[1].default_value; lc = LLN["LashBase"].inputs[1].default_value
lz = math('ADD', "LowLine", math('MULTIPLY_ADD', "LowQuad", math('MULTIPLY', "LowSq", dx, dx), la, lc+0.0011), math('MULTIPLY', "LowLin", dx, lb))
ldiff = math('ABSOLUTE', "LowAbs", math('SUBTRACT', "LowDiff", dz, lz))
lband = maprange("LowBand", ldiff, 0.0009, 0.0017, 1.0, 0.0)
lwin = math('MULTIPLY', "LowWin", maprange("LowA", dx, -0.0175, -0.0140, 0.0, 1.0), maprange("LowB", dx, D0-0.001, D0+0.002, 1.0, 0.0))
lfac = math('MULTIPLY', "LowFac", math('MULTIPLY', "LowFac0", lband, lwin), math('MULTIPLY', "LowFront", FRONT, 0.13))
out = layer("Low", out, lfac, (0.22, 0.13, 0.10))
L.new(out, N["Principled BSDF"].inputs["Base Color"])

# 唇：厚ぼったく
for _k, _v in (("mouth-upperlip-volume-incr", 1.30), ("mouth-lowerlip-volume-incr", 0.90), ("mouth-scale-vert-decr", 0.0)):
    kb[_k].slider_max = max(kb[_k].slider_max, 1.6); kb[_k].value = _v
# 目：ブラウンのカラコン（ふちは濃い色のリング）
ramp = bpy.data.materials["Eye"].node_tree.nodes["IrisRamp"].color_ramp
if len(ramp.elements) == 8: ramp.elements.new(0.29)
for el in ramp.elements:
    q = round(el.position, 3)
    if q == 0.201: el.color = (0.06, 0.027, 0.013, 1)
    elif q == 0.29: el.color = (0.22, 0.105, 0.045, 1)
    elif q == 0.38: el.color = (0.11, 0.05, 0.022, 1)
    elif q in (0.466, 0.5): el.color = (0.014, 0.008, 0.006, 1)
# 唇：薄いピンク（内側が少し濃いグラデーション）+ ひかえめなツヤ
lt = bpy.data.materials["Lips"].node_tree; LN = lt.nodes
for n in [n for n in LN if n.name.startswith("Mk")]: LN.remove(n)
bs = next(n for n in LN if n.type == 'BSDF_PRINCIPLED')
g = LN.new("ShaderNodeNewGeometry"); g.name = "MkGeo"
sp = LN.new("ShaderNodeSeparateXYZ"); sp.name = "MkSep"; lt.links.new(g.outputs["Position"], sp.inputs[0])
s1 = LN.new("ShaderNodeMath"); s1.name = "MkSub"; s1.operation = 'SUBTRACT'; lt.links.new(sp.outputs["Z"], s1.inputs[0]); s1.inputs[1].default_value = EZ-0.0622
s2 = LN.new("ShaderNodeMath"); s2.name = "MkAbs"; s2.operation = 'ABSOLUTE'; lt.links.new(s1.outputs[0], s2.inputs[0])
mr = LN.new("ShaderNodeMapRange"); mr.name = "MkRange"; mr.interpolation_type = 'SMOOTHSTEP'; lt.links.new(s2.outputs[0], mr.inputs[0])
mr.inputs[1].default_value = 0.0015; mr.inputs[2].default_value = 0.0115
mx = LN.new("ShaderNodeMix"); mx.name = "MkMix"; mx.data_type = 'RGBA'; lt.links.new(mr.outputs[0], mx.inputs[0])
mx.inputs[6].default_value = (0.74, 0.19, 0.21, 1); mx.inputs[7].default_value = (0.87, 0.44, 0.43, 1)
lt.links.new(mx.outputs[2], bs.inputs["Base Color"])
bs.inputs["Roughness"].default_value = 0.20; bs.inputs["Coat Weight"].default_value = 0.6; bs.inputs["Coat Roughness"].default_value = 0.04
# 下まつ毛：長めで 1 本ずつ見えるように。根元がつながって黒い帯にならないよう、本数をひかえめにし、色はこげ茶
LL = bpy.data.materials["LashLower"].node_tree.nodes
LL["LashLen"].inputs["To Min"].default_value = -0.0021; LL["LashLen"].inputs["To Max"].default_value = -0.0044
LL["Map Range"].inputs["From Min"].default_value = 0.47; LL["Map Range"].inputs["From Max"].default_value = 0.68
LL["Math.008"].inputs[1].default_value = 1800.0
LL["LashRootCut"].inputs[1].default_value = 0.06
LL["Principled BSDF"].inputs["Base Color"].default_value = (0.055, 0.032, 0.024, 1)
print("makeup done. eye", round(EX, 4), round(EZ, 4), "wing from", round(D0, 4), round(Z0, 4))
exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bake_face_pos.py", encoding="utf-8").read(), "bake_face_pos.py", "exec"), {"__name__": "__main__"})   # 顔の模様の位置を書き直す
