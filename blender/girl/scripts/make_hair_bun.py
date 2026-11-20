# お団子ヘアを作る（Blender の中で exec する）。make_outfit_swim.py のあとに実行する。
#   Girl_HairBun：頭を包む髪 + 透け感のある前髪 + 頭のてっぺんのお団子 + 顔の横と耳の後ろのおくれ毛
#   Girl_Hair・Girl_HairBun は隠すだけで残す。色は Hair_Twin（ライトブラウン）をそのまま使う。
# 頭の形は Girl_Body["hair_params"]（make_hair.py と同じ値）を使う。
import bpy, bmesh, math, random
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
_rig = bpy.data.objects.get("Girl_Rig"); _pose = _rig.data.pose_position if _rig else None    # 骨組みがあれば、作る間は基本の姿勢に戻す
if _rig: _rig.data.pose_position = 'REST'; bpy.context.view_layer.update()

body = bpy.data.objects["Girl_Body"]
HP = body["hair_params"].to_dict() if "hair_params" in body else {}
dg = bpy.context.evaluated_depsgraph_get()
def make_bvh(names):
    vs = []; ps = []
    for name in names:
        o = bpy.data.objects.get(name)
        if not o: continue
        e = o.evaluated_get(dg); m = e.to_mesh(); b = len(vs)
        vs += [o.matrix_world @ v.co for v in m.vertices]
        ps += [tuple(b+i for i in p.vertices) for p in m.polygons]
        e.to_mesh_clear()
    return BVHTree.FromPolygons(vs, ps)
bvh = make_bvh(("Girl_Body", "Swim_Top"))

_sh = Vector(body.get("heel_shift", (0, 0, 0)))
C = Vector(HP.get("C", (0, -0.050, 1.520)))+_sh
RX = HP.get("RX", 0.101); RY = HP.get("RY", 0.113); RZ = HP.get("RZ", 0.108)
ZBANG = HP.get("ZBANG", 1.5365)+_sh.z; BANG = HP.get("BANG", 50)
ZSH = 1.345+_sh.z; ZSM = 1.50+_sh.z; ZLOCK = 1.405+_sh.z      # 顔の横の毛束の毛先（あごのあたり）
OFF = 0.011; BL = 0.06; NH = 9; ND = 10; LOCKW = 16

def ell(th, ph): return C+Vector((RX*math.sin(ph)*math.sin(th), -RY*math.sin(ph)*math.cos(th), RZ*math.cos(ph)))
def sstep(t): t = max(0, min(1, t)); return t*t*(3-2*t)
def lerp(a, b, t): return a+(b-a)*t
def front_y(x, z):
    h = bvh.ray_cast(Vector((x, -1, z)), Vector((0, 1, 0))); return h[0].y-OFF if h[0] else None

def strand(thd, kind):
    th = math.radians(thd)
    pts = [ell(th, math.radians(10*i)) for i in range(NH)]
    if kind == "bang":
        ph = math.acos((ZBANG-0.009-C.z)/RZ); p = ell(th, ph); pts.append(p); pts.append(p+Vector((0, 0.004, -0.005))); return pts
    if kind == "cap":                                   # 頭に沿って、えりあしまで
        a = thd if thd < 180 else 360-thd
        pe = lerp(98, 128, sstep((a-70)/60))
        return pts+[ell(th, math.radians(lerp(90, pe, i/5))) for i in range(6)]
    E = ell(th, math.radians(90)); pts.append(E)        # 顔の横の毛束
    s = 1 if E.x > 0 else -1; a = thd if thd < 180 else 360-thd
    xb = s*(0.050+min(1, (a-BANG)/LOCKW)*0.040); run = None
    for j in range(ND):
        z = E.z+(ZLOCK-E.z)*((j+1)/ND); t = sstep((E.z-z)/(E.z-ZLOCK)*1.5)
        x = E.x+(xb-E.x)*t; y = E.y
        fy = front_y(x, z)
        if fy is not None and z < ZSM:
            run = fy if run is None else (fy if fy < run else run+(fy-run)*0.25)
            if run < E.y: y = run
        pts.append(Vector((x, y, z)))
    return pts

def rng(a, b, n): return [a+(b-a)*i/n for i in range(n+1)]
panels = [("bang", rng(-BANG, BANG, 16)), ("cap", rng(BANG, 360-BANG, 56))]
_rnd = random.Random(7)
bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap"); uvt = bm.loops.layers.uv.new("Tip")
L_t = bm.verts.layers.float.new("t"); L_c = bm.verts.layers.float.new("clump")
for kind, ths in panels:
    grid = []; tips = []
    for th in ths:
        P = strand(th, kind); col = []; tv = []
        cl = 0.6*math.sin(th*0.31+1.3)+0.4*_rnd.uniform(-1, 1)
        zend = P[-1].z
        for j, pt in enumerate(P):
            v = bm.verts.new(pt)
            if kind == "bang": v[L_t] = j/(len(P)-1)*0.5; v[L_c] = cl*0.35; tv.append((pt.z-zend)/0.030)
            elif kind == "cap": v[L_t] = max(0.0, (j-(NH-1))/(len(P)-NH))*0.5; v[L_c] = cl*0.5; tv.append((len(P)-1-j)/1.5)
            else: v[L_t] = max(0.0, (j-(NH-1))/(len(P)-NH)); v[L_c] = cl; tv.append((pt.z-zend)/0.060)
            col.append(v)
        grid.append(col); tips.append(tv)
    for i in range(len(grid)-1):
        a, b = grid[i], grid[i+1]
        for j in range(len(a)-1):
            f = bm.faces.new((a[j], a[j+1], b[j+1], b[j]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i, j+1), (i+1, j+1), (i+1, j))):
                l[uv].uv = ((ths[ii]+BANG)/360, 1-jj/(NH+18))
                l[uvt].uv = ((ths[ii]+BANG)/360, tips[ii][jj])
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)

def push():
    for v in bm.verts:
        loc, nor, idx, dist = bvh.find_nearest(v.co)
        if loc is None: continue
        if (v.co-loc).dot(nor) < 0 or dist < 0.008:
            if v[L_t] > 0.2 and v.co.z >= ZSM and v.co.y < C.y:
                fy = front_y(v.co.x, v.co.z)            # 前髪の下：前へだけ逃がす
                if fy is not None: v.co.y = min(v.co.y, fy)
            else:
                v.co = loc+nor*0.008
push()
for it in range(3):
    bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if v.co.z < ZSM], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=False)
    push()
_bang = [v for v in bm.verts if v.co.z >= ZSM and v[L_t] > 0.28 and v.co.y < C.y]
for it in range(4):
    bmesh.ops.smooth_vert(bm, verts=_bang, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=False)
    for v in _bang:
        loc, nor, idx, dist = bvh.find_nearest(v.co)
        if loc is not None and ((v.co-loc).dot(nor) < 0 or dist < 0.006): v.co.y = min(v.co.y, (loc+nor*0.006).y)
for v in bm.verts:
    dv = Vector((v.co.x-C.x, v.co.y-C.y, 0))
    if dv.length > 1e-5: v.co += dv.normalized()*v[L_c]*0.0055*sstep(v[L_t]*1.4)

# ── お団子と、おくれ毛 ──────────────────────────────
rnd = random.Random(5)
def ribbon(pts, outs, wfn, uc, fade=True, t0=0.5):
    """毛束 1 本：点の列に沿った帯。outs は各点での外向き"""
    n = len(pts)-1; NK = 4; grid = []
    for i, p in enumerate(pts):
        tg = (pts[min(n, i+1)]-pts[max(0, i-1)]).normalized(); side = tg.cross(outs[i])
        if side.length < 1e-6: side = Vector((1, 0, 0))
        side.normalize(); nr = side.cross(tg).normalized(); w = wfn(i/n); row = []
        for q in range(NK+1):
            kk = -1+2*q/NK; v = bm.verts.new(p+side*(kk*w/2)+nr*(0.0035*(1-kk*kk))); v[L_t] = t0; v[L_c] = 0.0; row.append(v)
        grid.append(row)
    for i in range(n):
        for q in range(NK):
            f = bm.faces.new((grid[i][q], grid[i+1][q], grid[i+1][q+1], grid[i][q+1]))
            for l, (ii, qq) in zip(f.loops, ((i, q), (i+1, q), (i+1, q+1), (i, q+1))):
                l[uv].uv = (uc+qq/NK*0.04, 1-ii/n)
                l[uvt].uv = (uc+qq/NK*0.04, ((n-ii)/n/0.12) if fade else 2.0)
BC = C+Vector((0, 0.030, RZ+0.022)); BR = Vector((0.050, 0.050, 0.041))      # お団子の中心と大きさ
# 芯（毛束のすき間から向こうが見えないように）
NU = 16; NV = 9; core = []
for i in range(1, NV):
    a = math.pi*i/NV
    core.append([bm.verts.new(BC+Vector((BR.x*math.sin(a)*math.cos(k*2*math.pi/NU), BR.y*math.sin(a)*math.sin(k*2*math.pi/NU), BR.z*math.cos(a)))*0.86) for k in range(NU)])
for r in core:
    for v in r: v[L_t] = 0.5
for i in range(len(core)-1):
    for k in range(NU):
        f = bm.faces.new((core[i][k], core[i][(k+1) % NU], core[i+1][(k+1) % NU], core[i+1][k]))
        for l, kk in zip(f.loops, (k, k+1, k+1, k)): l[uv].uv = (0.3+kk/NU*0.3, 1-i/NV); l[uvt].uv = (0.3, 2.0)
tv = bm.verts.new(BC+Vector((0, 0, BR.z*0.86))); tv[L_t] = 0.5
for k in range(NU):
    f = bm.faces.new((core[0][k], tv, core[0][(k+1) % NU]))
    for l in f.loops: l[uv].uv = (0.3+k/NU*0.3, 1.0); l[uvt].uv = (0.3, 2.0)
# ぐるぐる巻いた毛束
for j in range(18):
    a = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.4, 1.6))).normalized()
    e1 = a.orthogonal().normalized(); e2 = a.cross(e1)
    o = rnd.uniform(-0.45, 0.45); rr = math.sqrt(1-o*o); ph0 = rnd.uniform(0, 6.28); span = rnd.uniform(0.7, 1.0)*2*math.pi
    pts = []; outs = []
    for i in range(41):
        t = ph0+span*i/40; dv = (e1*math.cos(t)+e2*math.sin(t))*rr+a*o
        wob = 1+0.07*math.sin(3*t+j)
        pts.append(BC+Vector((dv.x*BR.x, dv.y*BR.y, dv.z*BR.z))*wob); outs.append(dv.normalized())
    ribbon(pts, outs, lambda s: 0.024*(0.5+0.5*math.sin(math.pi*s)**0.5), 0.05+j*0.05)
# お団子から飛び出した毛先
for j in range(5):
    dv = Vector((rnd.uniform(-1, 1), rnd.uniform(-0.6, 1), rnd.uniform(0.1, 1))).normalized(); ph = rnd.uniform(0, 6.28)
    pts = []; outs = []
    for i in range(21):
        s = i/20
        p = BC+Vector((dv.x*BR.x, dv.y*BR.y, dv.z*BR.z))*(0.95+0.75*s)+Vector((0.008*s*math.sin(5*s+ph), 0.008*s*math.cos(5*s+ph), -0.045*s*s))
        pts.append(p); outs.append(dv)
    ribbon(pts, outs, lambda s: 0.013*(1-0.7*s), 0.12+j*0.17)
# おくれ毛：顔の横（長め）と耳の後ろ
for sgn in (1, -1):
    for thd, zend, turns, ph in ((BANG+5, C.z-0.205, 2.4, 0.5), (BANG+19, C.z-0.150, 2.0, 2.1), (112, C.z-0.175, 2.2, 3.4)):
        th = math.radians(thd if sgn > 0 else 360-thd); st = ell(th, math.radians(80)); pts = []; outs = []
        for i in range(49):
            s = i/48; z = lerp(st.z, zend, s)
            fwd = -0.014*s if thd < 90 else 0.010*s
            p = Vector((st.x+sgn*(0.006*s+0.011*s*math.sin(2*math.pi*turns*s+ph)), st.y+fwd+0.011*s*math.cos(2*math.pi*turns*s+ph), z))
            loc, nor, idx, dist = bvh.find_nearest(p)
            if loc is not None and (p-loc).dot(nor) < 0.010: p = loc+nor*0.010
            pts.append(p); o = Vector((p.x, p.y-C.y, 0)); outs.append(o.normalized() if o.length > 1e-6 else Vector((sgn, 0, 0)))
        for _ in range(2): pts = [pts[0]]+[(pts[i-1]+pts[i]*2+pts[i+1])/4 for i in range(1, 48)]+[pts[-1]]
        ribbon(pts, outs, lambda s: 0.011*(1-0.6*s), (0.08 if sgn > 0 else 0.58)+thd*0.002, t0=0.7)
for f in bm.faces: f.material_index = 0

bm.verts.ensure_lookup_table(); _tw = [v[L_t] for v in bm.verts]
old = bpy.data.objects.get("Girl_HairBun")
if old: bpy.data.objects.remove(old, do_unlink=True)
mesh = bpy.data.meshes.new("Girl_HairBun"); bm.to_mesh(mesh); bm.free()
for p in mesh.polygons: p.use_smooth = True
h = bpy.data.objects.new("Girl_HairBun", mesh); bpy.context.scene.collection.objects.link(h)
g = h.vertex_groups.new(name="thick")
for i, t in enumerate(_tw): g.add([i], max(0.05, 1-0.95*t), 'REPLACE')
md = h.modifiers.new("Solidify", 'SOLIDIFY'); md.thickness = 0.01; md.offset = -1.0
md.vertex_group = "thick"; md.thickness_vertex_group = 0.05

# 髪の色：ブラウン（Hair を写して色だけ変える）
src = bpy.data.materials["Hair"]
mt = bpy.data.materials.get("Hair_Twin")
if not mt: mt = src.copy(); mt.name = "Hair_Twin"
mix = next(n for n in mt.node_tree.nodes if n.type == 'MIX' and n.data_type == 'RGBA')
mix.inputs[6].default_value = (0.055, 0.027, 0.015, 1); mix.inputs[7].default_value = (0.24, 0.125, 0.065, 1)
mt.diffuse_color = (0.17, 0.09, 0.05, 1)
mesh.materials.append(mt)
oh = bpy.data.objects.get("Girl_Hair")
if oh: oh.hide_viewport = True; oh.hide_render = True
print("bun hair built", len(mesh.vertices), len(mesh.polygons))
ot = bpy.data.objects.get("Girl_HairTwin")
if ot: ot.hide_viewport = True; ot.hide_render = True
if _rig:                                                 # 作り直した物を骨組みに付け直し、姿勢を元に戻す
    exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bind_rig.py", encoding="utf-8").read(), "bind_rig.py", "exec"), {"__name__": "__main__"})
    _rig.data.pose_position = _pose
