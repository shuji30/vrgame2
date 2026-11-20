# 上下の唇を同じ厚さにそろえる（Blender の中で exec する）。シェイプキー custom-lip-sym を作り直す。
# 使い方: exec(open(path, encoding="utf-8").read(), {"AMT": 1.0})
#   AMT … 1 で上下が同じ厚さ。0 で元のまま
# 唇の合わせ目は動かさず、上唇の上のふちと下唇の下のふちを上下に動かす。まわりの肌は、なだらかについていく。
import bpy, numpy as np

AMT = globals().get("AMT", 1.0)
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects.get("Girl_Rig")
was = rig.data.pose_position if rig else None
if rig: rig.data.pose_position = 'REST'
k = kb.get("custom-lip-sym") or ob.shape_key_add(name="custom-lip-sym", from_mix=False); k.value = 0
mk = next(m for m in ob.modifiers if m.type == 'MASK'); mk.show_viewport = False; bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
n = len(m.vertices); co = np.zeros(n*3); m.vertices.foreach_get("co", co); co = co.reshape(n, 3); ev.to_mesh_clear(); mk.show_viewport = True
li = next(i for i, s in enumerate(ob.material_slots) if s.material and s.material.name == "Lips")
lip = np.array(sorted({v for p in me.polygons if p.material_index == li for v in p.vertices}))
L = co[lip]; AXL = np.abs(L[:, 0])
cen = L[AXL < 0.004]; deep = cen[np.argsort(-cen[:, 1])][:4]; ZC = float(deep[:, 2].mean()); YS = float(deep[:, 1].mean())      # 合わせ目（まん中）
W = float(AXL.max()); ZK = float(L[AXL > W-0.002][:, 2].mean())                    # 口角
front = L[L[:, 1] < YS+0.002]; AF = np.abs(front[:, 0])
ctr = front[AF < 0.006]; up0 = float(ctr[:, 2].max())-ZC; lo0 = ZC-float(ctr[:, 2].min())      # いまの上唇・下唇の厚さ
H = (up0+lo0)/2; du = (H-up0)*AMT; dl = (lo0-H)*AMT                                # 上のふちを du、下のふちを dl だけ上へ
def ss(x): x = np.clip(x, 0, 1); return x*x*(3-2*x)
AX = np.abs(co[:, 0]); Z = co[:, 2]; Y = co[:, 1]
tx = np.clip(1-(AX/W)**2, 0, 1)                                                    # 口角では動かさない
seam = ZC+(ZK-ZC)*(np.clip(AX/W, 0, 1))**2
top = seam+up0*tx**0.6; bot = seam-lo0*tx**0.6
dz = np.zeros(n)
a = Z >= seam; dz[a] = du*np.where(Z[a] <= top[a], (Z[a]-seam[a])/np.maximum(top[a]-seam[a], 1e-5), 1-ss((Z[a]-top[a])/0.012))
b = ~a; dz[b] = dl*np.where(Z[b] >= bot[b], (seam[b]-Z[b])/np.maximum(seam[b]-bot[b], 1e-5), 1-ss((bot[b]-Z[b])/0.016))
dz *= tx*ss((YS+0.004-Y)/0.004)*(AX < W)                                           # 口の中は動かさない
basis = np.zeros(n*3); kb["Basis"].data.foreach_get("co", basis); basis = basis.reshape(n, 3); basis[:, 2] += dz
k.data.foreach_set("co", basis.ravel()); k.value = 1.0; me.update()
ob["lip_seam_z"] = ZC
if rig: rig.data.pose_position = was
print("lip sym set. upper mm", round(up0*1000, 1), "lower mm", round(lo0*1000, 1), "->", round(H*1000, 1), "moved verts", int((np.abs(dz) > 1e-5).sum()))
