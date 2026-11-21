# 眉を、きめ細かくする（Blender の中で exec する）。vrsample の blender/girl-knit/scripts/make_brows_knit.py の写し（どの子の眉にも使える）。
#   眉（Girl_Brows）は、左右それぞれ「眉頭から眉尻へ 11 列 × 上下 2 点」の帯に 1 色を塗っただけだった。
#   帯に UV（u = 眉頭→眉尻、v = 下→上）を付けて上下を少し広げ、マテリアルで毛の筋を描いて、筋のあいだを透かす。
#   毛の筋は、眉頭では立ち気味、眉尻へ向かって寝ていく。眉頭はふんわり薄く、眉尻へ細くなる。
#   書き出し（export_vrm_knit.py）では、髪と同じく色と透けを画像に焼き、透けは切りぬきにする。
import bpy

br = bpy.data.objects["Girl_Brows"]; me = br.data
keys = me.shape_keys.key_blocks if me.shape_keys else []
NCOL = len(me.vertices)//4                               # 片側の列の数（左右 × 上下 2 点）
EXPAND = 0.0008                                          # 上下に広げる量（m）。ぼかしの余地
if not br.get("brow_fine"):
    for side in range(2):
        for k in range(NCOL):
            b = side*NCOL*2+2*k; t = b+1
            for blk in [None]+list(keys):
                d = (lambda i: me.vertices[i].co) if blk is None else (lambda i, blk=blk: blk.data[i].co)
                cb, ct = d(b), d(t); mid = (cb+ct)/2; h = (ct-cb).normalized()
                cb -= h*EXPAND; ct += h*EXPAND
    br["brow_fine"] = 1
uvl = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
for p in me.polygons:
    for li in p.loop_indices:
        vi = me.loops[li].vertex_index; k = (vi % (NCOL*2))//2
        uvl.data[li].uv = (k/(NCOL-1), float(vi % 2))
me.update()

mt = bpy.data.materials["Brow"]; mt.use_nodes = True; nt = mt.node_tree; Nn = nt.nodes; L = nt.links
for n in [n for n in Nn if n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL")]: Nn.remove(n)
bsdf = next(n for n in Nn if n.type == "BSDF_PRINCIPLED")
uv = Nn.new("ShaderNodeUVMap"); uv.uv_map = "UVMap"
sep = Nn.new("ShaderNodeSeparateXYZ"); L.new(uv.outputs["UV"], sep.inputs[0])
U, V = sep.outputs["X"], sep.outputs["Y"]
def m(op, a, b=None, c=None):
    n = Nn.new("ShaderNodeMath"); n.operation = op
    for i, x in enumerate((a, b, c)):
        if x is None: continue
        if isinstance(x, (int, float)): n.inputs[i].default_value = x
        else: L.new(x, n.inputs[i])
    return n.outputs[0]
def sstep(e0, e1, x):
    n = Nn.new("ShaderNodeMapRange"); n.interpolation_type = 'SMOOTHSTEP'
    n.inputs["From Min"].default_value = e0; n.inputs["From Max"].default_value = e1; L.new(x, n.inputs["Value"])
    return n.outputs[0]
# 毛の筋：s = u*本数 + v*傾き(u) + ゆらぎ。眉頭（u=0）では傾き 0（縦の筋＝立った毛）、眉尻へ傾きを大きく（寝た毛）
noise = Nn.new("ShaderNodeTexNoise"); noise.noise_dimensions = '2D'; noise.inputs["Scale"].default_value = 5.0; noise.inputs["Detail"].default_value = 1.0
cm = Nn.new("ShaderNodeCombineXYZ"); L.new(m('MULTIPLY', U, 4.0), cm.inputs[0]); L.new(V, cm.inputs[1]); L.new(cm.outputs[0], noise.inputs["Vector"])
slant = m('ADD', 0.8, m('MULTIPLY', m('MULTIPLY', U, U), 7.0))      # 眉頭でも少し寝かせる
s = m('ADD', m('ADD', m('MULTIPLY', U, 36.0), m('MULTIPLY', V, slant)), m('MULTIPLY', m('SUBTRACT', noise.outputs["Fac"], 0.5), 0.35))
d = m('ABSOLUTE', m('SUBTRACT', m('FRACT', s), 0.5))           # 筋のまん中で 0、すき間で 0.5
line1 = m('SUBTRACT', 1.0, sstep(0.10, 0.30, d))
# 2 層目：本数と傾きを変えた細い筋を重ねて、等間隔（バーコード）に見えないようにする。筋ごとに濃さも変える
s2 = m('ADD', m('ADD', m('MULTIPLY', U, 53.0), m('MULTIPLY', V, m('MULTIPLY', slant, 1.25))), m('MULTIPLY', m('SUBTRACT', noise.outputs["Fac"], 0.5), 0.6))
d2 = m('ABSOLUTE', m('SUBTRACT', m('FRACT', s2), 0.5))
wn = Nn.new("ShaderNodeTexWhiteNoise"); wn.noise_dimensions = '1D'; L.new(m('FLOOR', s2), wn.inputs["W"])
line2 = m('MULTIPLY', m('SUBTRACT', 1.0, sstep(0.08, 0.24, d2)), m('ADD', 0.55, m('MULTIPLY', wn.outputs["Value"], 0.45)))
line = m('MAXIMUM', line1, line2)
# 形：上下のふちはぼかし、眉頭はふんわり、眉尻へ細く薄く
top = m('SUBTRACT', 1.0, m('MULTIPLY', U, 0.35))               # 眉尻ほど上のふちが下がる（細くなる）
mtop = Nn.new("ShaderNodeMapRange"); mtop.interpolation_type = 'SMOOTHSTEP'; L.new(V, mtop.inputs["Value"])
L.new(top, mtop.inputs["From Min"]); L.new(m('SUBTRACT', top, 0.28), mtop.inputs["From Max"])     # v が top に近いほど 0
mv = m('MULTIPLY', sstep(0.04, 0.30, V), mtop.outputs[0])
mu = m('MULTIPLY', sstep(0.0, 0.12, U), m('SUBTRACT', 1.0, sstep(0.80, 1.0, U)))
dens = m('ADD', 0.12, m('MULTIPLY', line, 0.88))     # 筋のあいだは薄く（切りぬきで消える）、筋は濃く
head = m('ADD', 0.75, m('MULTIPLY', sstep(0.0, 0.35, U), 0.25))      # 眉頭は少し薄く
alpha = m('MINIMUM', m('MULTIPLY', m('MULTIPLY', m('MULTIPLY', m('MULTIPLY', mv, mu), dens), head), 1.8), 1.0)   # ゲーム用の切りぬき（0.5 で丸める）でも筋が残るよう、濃くしておく
L.new(alpha, bsdf.inputs["Alpha"])
# 色：こげ茶。筋はやや濃く、すき間はやや明るく
mix = Nn.new("ShaderNodeMix"); mix.data_type = 'RGBA'; L.new(line, mix.inputs[0])
mix.inputs[6].default_value = (0.12, 0.08, 0.06, 1); mix.inputs[7].default_value = (0.045, 0.030, 0.024, 1)
L.new(mix.outputs[2], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.8
try: mt.surface_render_method = 'DITHERED'
except Exception: pass
mt.use_backface_culling = False
print("brows refined: cols", NCOL)
