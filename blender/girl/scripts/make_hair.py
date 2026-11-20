# 髪のメッシュを作り直す（Blender の中で exec する）。頭の形を変えたあとに実行する。
# 使い方: exec(open(path, encoding="utf-8").read(), {"RX": 0.108})   RX/RY/RZ/C は省略可
import bpy, bmesh, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
_rig = bpy.data.objects.get("Girl_Rig"); _pose = _rig.data.pose_position if _rig else None    # 骨組みがあれば、作る間は基本の姿勢に戻す
if _rig: _rig.data.pose_position = 'REST'; bpy.context.view_layer.update()

# 当たり判定：体（見えている肌）と、その上の服。服の下の肌は隠してあるので、服も入れないと髪がもぐる
dg = bpy.context.evaluated_depsgraph_get()
_vs = []; _ps = []
for _name in ("Girl_Body", "Girl_Knit", "Girl_Sweater"):
    _o = bpy.data.objects.get(_name)
    if not _o: continue
    e = _o.evaluated_get(dg); m = e.to_mesh(); _b = len(_vs)
    _vs += [_o.matrix_world @ v.co for v in m.vertices]
    _ps += [tuple(_b+i for i in p.vertices) for p in m.polygons]
    e.to_mesh_clear()
bvh = BVHTree.FromPolygons(_vs, _ps)

C = Vector(globals().get("C", (0, -0.050, 1.520)))          # 頭の中心
RX = globals().get("RX", 0.101); RY = globals().get("RY", 0.113); RZ = globals().get("RZ", 0.108)
ZB = globals().get("ZB", 1.085) - 0.020   # 毛先の高さ（1.085 で胸の下、1.27 で胸の上）
ZSH = 1.345      # 肩の高さ
ZBANG = globals().get("ZBANG", 1.5365)   # 前髪の切りそろえる高さ（眉のすぐ上）
OFF = 0.011; BL = 0.06
# ヒールで体全体が動いたぶん（Girl_Body の "heel_shift"）を、上の数値に足す
_sh = Vector(bpy.data.objects["Girl_Body"].get("heel_shift", (0, 0, 0)))
C = C + _sh; ZB += _sh.z; ZSH += _sh.z; ZBANG += _sh.z
YBACK = 0.045 + _sh.y; ZSM = 1.50 + _sh.z
NH = 9; ND = 18
SPLIT = 100; SPLITW = 22    # 横髪と後ろ髪の境目の角度と、なじませる幅（度）
BANG = globals().get("BANG", 50)    # 前髪の端の角度（度）。小さくすると、横髪がより手前（顔の前寄り）から垂れる

def ell(th, ph): return C + Vector((RX*math.sin(ph)*math.sin(th), -RY*math.sin(ph)*math.cos(th), RZ*math.cos(ph)))
def sstep(t): t = max(0, min(1, t)); return t*t*(3-2*t)
def front_y(x, z):
    h = bvh.ray_cast(Vector((x, -1, z)), Vector((0, 1, 0))); return h[0].y-OFF if h[0] else None
def back_y(x, z):
    h = bvh.ray_cast(Vector((x, 1, z)), Vector((0, -1, 0))); return h[0].y+OFF if h[0] else None

def strand(thd, kind):
    th = math.radians(thd)
    pts = [ell(th, math.radians(10*i)) for i in range(NH)]
    if kind == "bang":
        ph = math.acos((ZBANG-C.z)/RZ); p = ell(th, ph); pts.append(p); pts.append(p+Vector((0, 0.004, -0.005))); return pts
    E = ell(th, math.radians(90)); pts.append(E)
    if kind == "long":
        # 横髪（肩の前へ）と後ろ髪（背中へ）を、耳のあたりでなだらかにつなぐ。割れ目を作らない
        a = thd if thd < 180 else 360-thd
        wf = 1-sstep((a-SPLIT+SPLITW)/(2*SPLITW))
        fo = drop(thd, E, "front") if wf > 0 else None
        bo = drop(thd, E, "back") if wf < 1 else None
        if fo is None: return pts+bo
        if bo is None: return pts+fo
        return pts+[b.lerp(f, wf) for f, b in zip(fo, bo)]
    return pts+drop(thd, E, kind)

def drop(thd, E, kind):
    zs = [E.z+(ZB-E.z)*((j+1)/ND) for j in range(ND)]
    if kind == "front":
        s = 1 if E.x > 0 else -1; a = thd if thd < 180 else 360-thd
        xb = s*(0.036+min(1, (a-BANG)/(100-BANG))*0.072)
    else:
        xb = E.x*1.08
    run = None; out = []
    for z in zs:
        t = sstep((E.z-z)/(E.z-ZB)*1.5)
        x = E.x+(xb-E.x)*t; y = E.y
        if z < ZSH+BL:
            w = sstep((ZSH+BL-z)/BL); zq = min(z, ZSH-0.01)
            if kind == "front":
                fy = front_y(x, zq)
                if fy is not None:
                    run = fy if run is None else (fy if fy < run else run+(fy-run)*0.25)
                    if run < E.y: y = E.y+(run-E.y)*w
            else:
                by = back_y(x, zq)
                if by is not None: run = by if run is None else (by if by > run else run+(by-run)*0.15)
                tgt = max(E.y, run if run is not None else E.y, YBACK if abs(x) > 0.02 else E.y)
                y = E.y+(tgt-E.y)*w
        out.append(Vector((x, y, z)))
    return out

def rng(a, b, n): return [a+(b-a)*i/n for i in range(n+1)]
panels = [("bang", rng(-BANG, BANG, 16)), ("long", rng(BANG, 360-BANG, 56))]
TIP_LONG = 0.060; TIP_BANG = 0.005     # 毛先がばらける幅（長い髪／前髪）。この幅の中で、毛束ごとに長さが変わる
import random
_rnd = random.Random(7)
bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap"); uvt = bm.loops.layers.uv.new("Tip")
L_t = bm.verts.layers.float.new("t"); L_c = bm.verts.layers.float.new("clump")
for kind, ths in panels:
    grid = []; tips = []
    for ci, th in enumerate(ths):
        P = strand(th, kind); col = []
        cl = 0.6*math.sin(th*0.31+1.3)+0.4*_rnd.uniform(-1, 1)        # 毛束ごとの出っぱり
        zend = P[-1].z; span = TIP_BANG if kind == "bang" else TIP_LONG
        tv = []
        for j, pt in enumerate(P):
            v = bm.verts.new(pt); t = max(0.0, (j-(NH-1))/(len(P)-NH)) if kind != "bang" else j/(len(P)-1)*0.5
            v[L_t] = t; v[L_c] = cl if kind != "bang" else cl*0.35
            col.append(v); tv.append((pt.z-zend)/span)
        grid.append(col); tips.append(tv)
    for i in range(len(grid)-1):
        a, b = grid[i], grid[i+1]
        for j in range(len(a)-1):
            f = bm.faces.new((a[j], a[j+1], b[j+1], b[j]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i, j+1), (i+1, j+1), (i+1, j))):
                l[uv].uv = ((ths[ii]+BANG)/360, 1-jj/(NH+ND))
                l[uvt].uv = ((ths[ii]+BANG)/360, tips[ii][jj])
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)

def push():
    n = 0
    for v in bm.verts:
        loc, nor, idx, dist = bvh.find_nearest(v.co)
        if loc is None: continue
        if (v.co-loc).dot(nor) < 0 or dist < 0.008:
            if v[L_t] > 0.2 and v.co.z >= ZSM and v.co.y < C.y:
                # 前髪の下のほう：いちばん近い面へ寄せると、鼻筋の付け根へ引き下ろされて中央が V 字に欠ける。
                # 高さと横位置は変えず、前へだけ逃がす
                fy = front_y(v.co.x, v.co.z)
                if fy is not None: v.co.y = min(v.co.y, fy)
            else:
                v.co = loc+nor*0.008
            n += 1
    return n
push()
for it in range(3):
    bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if ZB+0.01 < v.co.z < ZSM], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=False)
    push()

# 前髪の下のほう：眉間や眉の出っぱりに押されて一部だけ飛び出すので、横にならす
_bang = [v for v in bm.verts if v.co.z >= ZSM and v[L_t] > 0.28 and v.co.y < C.y]
for it in range(4):
    bmesh.ops.smooth_vert(bm, verts=_bang, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=False)
    for v in _bang:
        loc, nor, idx, dist = bvh.find_nearest(v.co)
        if loc is not None and ((v.co-loc).dot(nor) < 0 or dist < 0.006): v.co.y = min(v.co.y, (loc+nor*0.006).y)
# 毛束の凹凸：束ごとに、下へ行くほど少し出入りさせる（布の一枚板に見えないように）
for v in bm.verts:
    d = Vector((v.co.x-C.x, v.co.y-C.y, 0))
    if d.length > 1e-5: v.co += d.normalized()*v[L_c]*0.0055*sstep(v[L_t]*1.4)
bm.verts.ensure_lookup_table()
_tw = [v[L_t] for v in bm.verts]
h = bpy.data.objects["Girl_Hair"]; bm.to_mesh(h.data); bm.free()
# 厚み：毛先へ向かって薄くする
g = h.vertex_groups.get("thick") or h.vertex_groups.new(name="thick")
for i, t in enumerate(_tw): g.add([i], max(0.05, 1-0.95*t), 'REPLACE')
for md in h.modifiers:
    if md.type == 'SOLIDIFY': md.vertex_group = "thick"; md.thickness_vertex_group = 0.05
for p in h.data.polygons: p.use_smooth = True
h.data.update()
print("hair rebuilt", len(h.data.vertices), len(h.data.polygons))
if _rig: _rig.data.pose_position = _pose                 # 姿勢を元に戻す
