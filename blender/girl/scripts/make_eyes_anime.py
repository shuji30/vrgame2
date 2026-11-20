# 瞳をアニメ調にする（Blender の中で exec する）。Eye マテリアルに描き足す。何度実行してもよい。
#   瞳を大きく / 上が暗く下が明るいグラデーション / 濃いふち / 大きなハイライトと、反対側の小さなハイライト
import bpy
nt = bpy.data.materials["Eye"].node_tree; N = nt.nodes; L = nt.links
for n in [n for n in N if n.name.startswith("An")]: N.remove(n)
ramp = N["IrisRamp"]; ang = N["Math.001"].outputs[0]; dirv = N["Vector Math"].outputs["Vector"]
def math(op, name, a, b=None):
    n = N.new("ShaderNodeMath"); n.name = "An"+name; n.operation = op
    for i, v in enumerate((a, b)):
        if v is None: continue
        if isinstance(v, (int, float)): n.inputs[i].default_value = v
        else: L.new(v, n.inputs[i])
    return n.outputs[0]
def mrange(name, v, a, b, c, e):
    n = N.new("ShaderNodeMapRange"); n.name = "An"+name; n.interpolation_type = 'SMOOTHSTEP'; L.new(v, n.inputs[0])
    for i, x in zip((1, 2, 3, 4), (a, b, c, e)): n.inputs[i].default_value = x
    return n.outputs[0]
sc = math('MULTIPLY', "Scale", ang, 0.74)                # 瞳を約 1.35 倍に
L.new(sc, ramp.inputs[0])
for el in ramp.color_ramp.elements:
    q = round(el.position, 3)
    if q in (0.0, 0.178): el.color = (0.010, 0.015, 0.070, 1)
    elif q == 0.201: el.color = (0.020, 0.060, 0.300, 1)
    elif q == 0.29: el.color = (0.300, 0.680, 1.000, 1)
    elif q == 0.38: el.color = (0.100, 0.340, 0.900, 1)
    elif q in (0.466, 0.5): el.color = (0.008, 0.016, 0.090, 1)
sep = N.new("ShaderNodeSeparateXYZ"); sep.name = "AnSep"; L.new(dirv, sep.inputs[0])
grad = mrange("Grad", sep.outputs["Z"], -0.16, 0.30, 1.35, 0.30)        # 上ほど暗い
mask = mrange("Mask", sc, 0.50, 0.52, 1.0, 0.0)                         # 瞳の中だけ
mul = N.new("ShaderNodeMix"); mul.name = "AnMul"; mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'
L.new(mask, mul.inputs[0]); L.new(ramp.outputs["Color"], mul.inputs[6]); L.new(grad, mul.inputs[7])
L.new(mul.outputs[2], N["HlMix"].inputs[6])
N["HlRange"].inputs[1].default_value = 0.13; N["HlRange"].inputs[2].default_value = 0.165       # 大きなハイライト
d2 = N.new("ShaderNodeVectorMath"); d2.name = "AnHl2Dot"; d2.operation = 'DOT_PRODUCT'; L.new(dirv, d2.inputs[0]); d2.inputs[1].default_value = (-0.115, -0.975, -0.19)
h2 = mrange("Hl2", math('ARCCOSINE', "Hl2Acos", d2.outputs["Value"]), 0.050, 0.070, 1.0, 0.0)
both = math('MAXIMUM', "HlMax", N["HlRange"].outputs[0], h2)
L.new(both, N["HlMix"].inputs[0]); L.new(both, N["HlEm"].inputs[0])
print("anime eyes done")
