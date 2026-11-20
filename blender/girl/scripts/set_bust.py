# 胸の大きさを変える（Blender の中で exec する）。シェイプキー custom-bust-small を作り直す。
# 使い方: exec(open(path, encoding="utf-8").read(), {"H": 0.046, "R": 0.076})
#   H … ふくらみの高さ（m）。0.020 で A カップ、0.034 で B カップ、0.046 で C カップ寄りの B くらい
#   R … ふくらみの半径（m）
# 胸のふくらみを一度取りのぞいて胸郭だけの形にし、その上に、先のとがらない丸いふくらみをのせる。
# 実行したあとは、服のスクリプト（make_outfit_swim.py など）を実行し直す。
import bpy, math
import numpy as np
_rig = bpy.data.objects.get("Girl_Rig"); _pose = _rig.data.pose_position if _rig else None    # 骨組みがあれば、作る間は基本の姿勢に戻す
if _rig: _rig.data.pose_position = 'REST'; bpy.context.view_layer.update()

H = globals().get("H", 0.046); R = globals().get("R", 0.076)
CX = globals().get("CX", 0.078); CZ = globals().get("CZ", 1.195)     # ふくらみの中心（正面から見た x, z）
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks
k = kb.get("custom-bust-small") or ob.shape_key_add(name="custom-bust-small", from_mix=False); k.value = 0
mk = next(m for m in ob.modifiers if m.type == 'MASK'); mk.show_viewport = False; bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); e = ob.evaluated_get(dg); m = e.to_mesh()
co = np.array([v.co[:] for v in m.vertices]); e.to_mesh_clear(); mk.show_viewport = True
gi = {g.name: g.index for g in ob.vertex_groups}
real = [v.index for v in me.vertices if any(g.group in (gi["body"], gi["hidden_by_clothes"]) and g.weight > 0.5 for g in v.groups)]
def ss(t): t = np.clip(t, 0, 1); return t*t*(3-2*t)
idx = np.array([i for i in real if 1.00 < co[i][2] < 1.39 and co[i][1] < 0.0 and abs(co[i][0]) < 0.24])   # 胸の前面と、そのまわり
P0 = co[idx].copy()
# 動かす強さ（ふちは 0）。わき（|x| が大きい所）は面が横を向いているので動かさない
W = ss((P0[:, 2]-1.04)/0.04)*ss((1.35-P0[:, 2])/0.04)*ss((0.152-np.abs(P0[:, 0]))/0.036)*ss((-0.02-P0[:, 1])/0.03)
# 1) もとの胸は、下側が胸板にかぶさる形（正面から見て面が重なる）。そのまま前後だけ動かすと面が折り重なるので、
#    先に辺をたどるならし（smooth_vert）で重なりをほどく
import bmesh
from mathutils import Vector
pos = {int(i): j for j, i in enumerate(idx)}
bm = bmesh.new(); bv = [bm.verts.new(Vector(p)) for p in P0]
for p in me.polygons:
    if all(v in pos for v in p.vertices):
        try: bm.faces.new([bv[pos[v]] for v in p.vertices])
        except ValueError: pass
mov = [bv[j] for j in range(len(bv)) if W[j] > 0.02]
for _ in range(300): bmesh.ops.smooth_vert(bm, verts=mov, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
P = np.array([v.co[:] for v in bv]); bm.free()
P = P0+(P-P0)*np.minimum(1.0, W*3)[:, None]
# 2) 胸郭の形：胸の谷間・胸の上下・わきの頂点（もとの位置）に、なめらかな面を当てはめ、胸のところの前後はその面にする。
#    （全体を平均でならすと、みぞおちまで奥へ引っこんでしまう。また、胸の先に残る円すい形もここで消える）
ax0 = np.abs(P0[:, 0]); z0 = P0[:, 2]
ref = (P0[:, 1] < -0.02) & ((ax0 < 0.020) | (z0 < 1.095) | (z0 > 1.285) | (ax0 > 0.150))
def basis_fn(ax, z): zz = z-1.19; return np.vstack([np.ones_like(ax), ax**2, zz, zz**2, ax**2*zz, ax**4, zz**3]).T
coef = np.linalg.lstsq(basis_fn(ax0[ref], z0[ref]), P0[ref, 1], rcond=None)[0]
yfit = basis_fn(np.abs(P[:, 0]), P[:, 2]) @ coef
Q = P.copy(); Q[:, 1] = P[:, 1]+(yfit-P[:, 1])*W
P = P0                                                   # （下で、もとの位置との差をシェイプキーに入れる）
# ふくらみ：正面から見た円の中に、丸い山をのせる（中心がいちばん高く、先はとがらない）
r = np.hypot(np.abs(Q[:, 0])-CX, (Q[:, 2]-CZ)*1.05)
h = np.where(r < R, H*np.clip(1-(r/R)**2, 0, 1)**1.5, 0.0)*np.minimum(1.0, W*1.5)
Q[:, 1] -= h*0.97; Q[:, 2] += h*0.08
basis = kb["Basis"].data
for v in me.vertices: k.data[v.index].co = basis[v.index].co
for j, i in enumerate(idx):
    dlt = Q[j]-P0[j]
    if abs(dlt).max() > 1e-6:
        b = basis[i].co; k.data[i].co = (b.x+float(dlt[0]), b.y+float(dlt[1]), b.z+float(dlt[2]))
k.value = 1.0
print("bust set. H", H, "R", R, "verts", len(idx))
if _rig: _rig.data.pose_position = _pose                 # 姿勢を元に戻す
