# ブラウン・ゆるい巻き髪の長いツインテールを作る（前髪は透け感のあるシースルー）（Blender の中で exec する）。make_outfit_jirai.py のあとに実行する。
#   Girl_HairTwin：頭を包む髪 + 前髪 + 顔の横の毛束 + 左右の縦ロール（太いの 1 本と細いの 1 本ずつ）+ 赤いリボン
#   もとの Girl_Hair は隠すだけで残す。色は Hair を写した Hair_Twin。
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
bvh = make_bvh(("Girl_Body", "Jirai_Top"))
bvh2 = make_bvh(("Girl_Body", "Jirai_Top", "Jirai_Headphones"))     # 縦ロールはヘッドホンもよける

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
panels = [("bang", rng(-BANG, BANG, 16)), ("lock", rng(BANG, BANG+LOCKW, 5)), ("cap", rng(BANG+LOCKW, 360-BANG-LOCKW, 50)),
          ("lock", rng(360-BANG-LOCKW, 360-BANG, 5))]
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

# ── 縦ロール ───────────────────────────────────
def catmull(P, n):
    Q = [P[0]]+list(P)+[P[-1]]; out = []
    for i in range(1, len(Q)-2):
        for k in range(n):
            t = k/n; a, b, c, e = Q[i-1], Q[i], Q[i+1], Q[i+2]
            out.append(0.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-e)*t*t+(-a+3*b-3*c+e)*t**3))
    out.append(P[-1]); return out
def resample(pts, n):
    d = [0.0]
    for a, b in zip(pts, pts[1:]): d.append(d[-1]+(b-a).length)
    out = []; j = 0
    for i in range(n+1):
        s = d[-1]*i/n
        while j < len(d)-2 and d[j+1] < s: j += 1
        t = (s-d[j])/max(1e-9, d[j+1]-d[j]); out.append(pts[j].lerp(pts[j+1], min(1, max(0, t))))
    return out
def tail(sgn, ctrl, seed):
    """ゆるい巻き髪の束：軸のまわりを、何本もの毛束がゆるく回りながら下りる。毛先ほど巻きが細かい"""
    NA = 200; rnd = random.Random(seed)
    ax = resample(catmull([Vector(p) for p in ctrl], 24), NA)
    def RB(s): return 0.007+0.030*sstep(s/0.30)+0.012*sstep((s-0.45)/0.5)      # 束の太さ（下へ行くほどふくらむ）
    for it in range(6):                                  # 体・服・ヘッドホンをよける
        for i in range(int(NA*0.08), NA+1):
            loc, nor, idx, dist = bvh2.find_nearest(ax[i]); need = RB(i/NA)*0.8+0.014
            if loc is not None:
                sd = (ax[i]-loc).dot(nor)
                if sd < need: ax[i] = ax[i]+nor*(need-sd)
        for _ in range(3): ax = [ax[0]]+[(ax[i-1]+ax[i]*2+ax[i+1])/4 for i in range(1, NA)]+[ax[-1]]
    ax = resample(ax, NA)
    T = [(ax[min(NA, i+1)]-ax[max(0, i-1)]).normalized() for i in range(NA+1)]
    U = [T[0].cross(Vector((0, 1, 0))).normalized()]
    for i in range(1, NA+1):
        u = U[-1]-T[i]*U[-1].dot(T[i]); U.append(u.normalized())
    W = [T[i].cross(U[i]) for i in range(NA+1)]
    def at(s):
        f = max(0.0, min(1.0, s))*NA; i = min(NA-1, int(f)); t = f-i
        return ax[i].lerp(ax[i+1], t), U[i].lerp(U[i+1], t).normalized(), W[i].lerp(W[i+1], t).normalized()
    NST = 9; NR = 64; NK = 4
    for k in range(NST):
        ph = 2*math.pi*k/NST+rnd.uniform(-0.3, 0.3); turns = rnd.uniform(1.5, 2.2); hand = 1 if k % 3 else -1
        send = rnd.uniform(0.80, 1.0); rr = rnd.uniform(0.75, 1.15); wid = rnd.uniform(0.020, 0.028)
        wamp = rnd.uniform(0.006, 0.011); wfr = rnd.uniform(3.0, 4.5); wph = rnd.uniform(0, 6.28)
        def center(s):
            p, u, w = at(s*send)
            th = ph+hand*2*math.pi*turns*s**1.5
            rad = u*math.cos(th)+w*math.sin(th)
            r = RB(s*send)*rr*(0.55+0.45*math.sin(th*0.5+ph)**2)+wamp*sstep(s/0.3)*math.sin(wfr*2*math.pi*s**1.3+wph)
            return p+rad*r, rad
        grid = []
        for i in range(NR+1):
            s = i/NR; c, rad = center(s); c2, _ = center(min(1, s+0.004)); c1, _ = center(max(0, s-0.004))
            tg = (c2-c1).normalized(); side = tg.cross(rad)
            if side.length < 1e-6: side = Vector((1, 0, 0))
            side.normalize(); nrm = side.cross(tg).normalized()
            w = wid*(0.45+0.55*sstep(s/0.15))*(1-0.75*sstep((s-0.72)/0.28))
            tw = 0.9*math.sin(wfr*2*math.pi*s**1.3+wph+1.2)             # 毛束がねじれる
            sd = side*math.cos(tw)+nrm*math.sin(tw); nr = nrm*math.cos(tw)-side*math.sin(tw)
            row = []
            for q in range(NK+1):
                kk = -1+2*q/NK; pt = c+sd*(kk*w/2)+nr*(0.004*(1-kk*kk))
                v = bm.verts.new(Vector((sgn*pt.x, pt.y, pt.z))); v[L_t] = 0.45+0.45*s; v[L_c] = 0.0
                row.append(v)
            grid.append(row)
        uc = (0.07 if sgn > 0 else 0.57)+k*0.045
        for i in range(NR):
            for q in range(NK):
                quad = (grid[i][q], grid[i+1][q], grid[i+1][q+1], grid[i][q+1]); idx = ((i, q), (i+1, q), (i+1, q+1), (i, q+1))
                if sgn < 0: quad = quad[::-1]; idx = idx[::-1]
                f = bm.faces.new(quad)
                for l, (ii, qq) in zip(f.loops, idx):
                    l[uv].uv = (uc+qq/NK*0.04, 1-ii/NR)
                    l[uvt].uv = (uc+qq/NK*0.04, (NR-ii)/NR/0.10)
TIE = Vector((0.088, 0.000, C.z+0.044))
# 耳の上で結び、ヘッドホンの外を回って、肩の上まで下りる
AXIS = (TIE, (0.140, 0.030, TIE.z+0.006), (0.194, 0.016, C.z-0.03), (0.205, -0.012, C.z-0.10), (0.202, -0.030, C.z-0.175))
for sgn in (1, -1): tail(sgn, AXIS, 11 if sgn > 0 else 23)
n_hair = len(bm.faces)

# 結び目の赤いリボン
def ball(c, rx, ry, rz, rot):
    nu = 12; nv = 6; rings = []
    for i in range(1, nv):
        a = math.pi*i/nv
        rings.append([bm.verts.new(c+rot @ Vector((rx*math.sin(a)*math.cos(k*2*math.pi/nu), ry*math.sin(a)*math.sin(k*2*math.pi/nu), rz*math.cos(a)))) for k in range(nu)])
    for i in range(len(rings)-1):
        for k in range(nu): bm.faces.new((rings[i][k], rings[i][(k+1) % nu], rings[i+1][(k+1) % nu], rings[i+1][k]))
    for ring, z in ((rings[0], rz), (rings[-1], -rz)):
        cv = bm.verts.new(c+rot @ Vector((0, 0, z)))
        for k in range(nu): bm.faces.new((ring[k], ring[(k+1) % nu], cv))
for sgn in (1, -1):
    c = Vector((sgn*(TIE.x+0.016), TIE.y+0.010, TIE.z+0.008))
    rot = Matrix.Rotation(sgn*0.5, 3, 'Y') @ Matrix.Rotation(sgn*0.5, 3, 'Z')
    for s in (-1, 1): ball(c+rot @ Vector((0, s*0.020, 0)), 0.007, 0.018, 0.013, rot)
    ball(c, 0.010, 0.008, 0.010, rot)
bmesh.ops.recalc_face_normals(bm, faces=[f for i, f in enumerate(bm.faces) if i >= n_hair])
for i, f in enumerate(bm.faces): f.material_index = 1 if i >= n_hair else 0

bm.verts.ensure_lookup_table(); _tw = [v[L_t] for v in bm.verts]
old = bpy.data.objects.get("Girl_HairTwin")
if old: bpy.data.objects.remove(old, do_unlink=True)
mesh = bpy.data.meshes.new("Girl_HairTwin"); bm.to_mesh(mesh); bm.free()
for p in mesh.polygons: p.use_smooth = True
h = bpy.data.objects.new("Girl_HairTwin", mesh); bpy.context.scene.collection.objects.link(h)
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
mesh.materials.append(mt); mesh.materials.append(bpy.data.materials.get("J_Red") or src)
oh = bpy.data.objects.get("Girl_Hair")
if oh: oh.hide_viewport = True; oh.hide_render = True
print("twin hair built", len(mesh.vertices), len(mesh.polygons))
if _rig:                                                 # 作り直した物を骨組みに付け直し、姿勢を元に戻す
    exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bind_rig.py", encoding="utf-8").read(), "bind_rig.py", "exec"), {"__name__": "__main__"})
    _rig.data.pose_position = _pose
