# 瞳を大きく見せるブルーのカラコンにする（Blender の中で exec する）。リアル顔用。何度実行してもよい。
# 使い方: exec(open(path, encoding="utf-8").read(), {"SIZE": 1.25})   SIZE … 瞳の大きさの倍率
import bpy
SIZE = globals().get("SIZE", 1.25)
nt = bpy.data.materials["Eye"].node_tree; N = nt.nodes; L = nt.links
for n in [n for n in N if n.name.startswith(("An", "Ct"))]: N.remove(n)
sc = N.new("ShaderNodeMath"); sc.name = "CtScale"; sc.operation = 'MULTIPLY'; sc.inputs[1].default_value = 1.0/SIZE
L.new(N["Math.001"].outputs[0], sc.inputs[0]); L.new(sc.outputs[0], N["IrisRamp"].inputs[0])
L.new(N["IrisRamp"].outputs["Color"], N["HlMix"].inputs[6]); L.new(N["HlRange"].outputs[0], N["HlMix"].inputs[0]); L.new(N["HlRange"].outputs[0], N["HlEm"].inputs[0])
COLOR = globals().get("COLOR", "blue")                   # "blue" か "brown"
PAL = {"blue": ((0.004, 0.005, 0.012), (0.04, 0.13, 0.36), (0.20, 0.50, 0.88), (0.09, 0.28, 0.66), (0.006, 0.012, 0.040)),
       "brown": ((0.004, 0.004, 0.004), (0.07, 0.030, 0.014), (0.30, 0.15, 0.065), (0.14, 0.065, 0.028), (0.014, 0.008, 0.006))}[COLOR]
for el in N["IrisRamp"].color_ramp.elements:
    q = round(el.position, 3)
    if q in (0.0, 0.178): el.color = PAL[0]+(1,)
    elif q == 0.201: el.color = PAL[1]+(1,)
    elif q == 0.29: el.color = PAL[2]+(1,)
    elif q == 0.38: el.color = PAL[3]+(1,)
    elif q in (0.466, 0.5): el.color = PAL[4]+(1,)       # ふちの濃いリング
print(COLOR, "contacts done. size", SIZE)
