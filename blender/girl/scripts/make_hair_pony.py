# 高い位置のロングポニーテールを作る（Blender の中で exec する）。2 人目の女の子用。make_outfit_street.py のあとに実行する。
#   Girl_HairPony：頭を包む髪 + 前髪 + 顔の横の毛束 + 腰までのポニーテール + 胸の前へ下りる長い毛束。色は Hair_Ash（アッシュブラウン）
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
bvh = make_bvh(("Girl_Body", "Street_Top"))
bvh2 = make_bvh(("Girl_Body", "Street_Top", "Street_Skirt"))     # 縦ロールはヘッドホンもよける

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

PART = 0.55*BANG                                         # 分け目の位置（前髪の幅の 2 割のところ。正で本人の左寄り）
def hairline(a):
    """生えぎわ（頭のてっぺんからの角度）：こめかみ → 耳の上（耳の一番上の 1cm ほど上）→ 耳の後ろ → えりあし。
    ポニーテールなので、ここから上の毛は頭に沿って結び目へ引っ張られる"""
    # （角度は頭の中心＝目の高さが 90°。耳の一番上 ≒ 92°、耳たぶ ≒ 122°）。（方位, 角度）の表を、なだらかにつなぐ
    T = ((0, 98), (55, 101), (72, 97), (82, 89), (100, 89), (110, 93), (122, 118), (145, 134), (180, 137))      # 耳の上は耳のすぐ上。耳の後ろ（耳より後ろ）へ回ってから下ろす（耳たぶにかけない）
    for (a0, p0), (a1, p1) in zip(T, T[1:]):
        if a <= a1:
            pe = lerp(p0, p1, sstep((a-a0)/(a1-a0))); break
    else: pe = T[-1][1]
    pe += 16*math.cos(min(1.0, abs(a-70)/6.0)*math.pi/2)**2       # SIDEBURN：耳の前に、細いもみあげ（耳の中ほどの高さまで、幅 ±6°）
    return pe
def strand(thd, kind):
    th = math.radians(thd)
    pts = [ell(th, math.radians(10*i)) for i in range(NH)]
    if kind == "bang":
        # 横分け：分け目でおでこを出し、広い側は長くほおのわきまで流す。狭い側は短め
        rise = 0.050*(1-sstep((abs(thd)/BANG-0.45)/0.55))     # 額の生えぎわのすぐ下で終え、両端（こめかみ）は横の毛の生えぎわへ下ろしてつなぐ
        ph = math.acos(max(-0.99, min(0.99, (ZBANG-0.009+rise-C.z)/RZ))); p = ell(th, ph); pts.append(p); pts.append(p+Vector((0, 0.004, -0.005))); return pts
    if kind == "cap":                                   # 頭に沿って、えりあしまで
        a = thd if thd < 180 else 360-thd
        pe = hairline(a)
        # こめかみ：前髪の土台と重ねて、前髪の生えぎわの高さで終える（継ぎ目にすき間ができて、はげのように見えた）
        _rb = 0.050*(1-sstep((min(a, BANG)/BANG-0.45)/0.55))
        _pb = math.degrees(math.acos(max(-0.99, min(0.99, (ZBANG-0.009+_rb-C.z)/RZ))))+3
        pe = lerp(_pb, pe, sstep((a-(BANG-4))/16))
        # ポニーテールの結び目から生えぎわ（pe）まで、頭の表面に沿って下ろす（毛の流れが、生えぎわから結び目へ引き上げられた向きになる）
        d1 = Vector((math.sin(math.radians(pe))*math.sin(th), -math.sin(math.radians(pe))*math.cos(th), math.cos(math.radians(pe))))
        out = []
        for i in range(NH+6):
            t = sstep(i/(NH+5))*0.7+0.3*(i/(NH+5)); d = (TIE_D*(1-t)+d1*t).normalized()
            out.append(C+Vector((RX*d.x, RY*d.y, RZ*d.z)))
        return out
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

TIE_D = Vector((0.0, 0.50, 0.80)).normalized()          # 結び目の向き（頭の中心から。下の TIE と同じ所）
def rng(a, b, n): return [a+(b-a)*i/n for i in range(n+1)]
panels = [("bang", rng(-BANG, BANG, 24)), ("cap", rng(BANG-16, 360-BANG+16, 124))]      # 横の毛は前髪と 16° 重ねる      # 顔の横の板のような毛束は作らない（巻いた毛束を別に下ろす）
_rnd = random.Random(7)
_capv = set(); _bangv = set()
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
            if kind == "bang": v[L_t] = j/(len(P)-1)*0.5; v[L_c] = cl*0.35; tv.append((pt.z-zend)/(0.022*(1-0.65*sstep((abs(th)/BANG-0.5)/0.5))))      # こめかみ側は切れ込みの帯を細く（地肌が大きく透けた）
            elif kind == "cap": v[L_t] = max(0.0, (j-(NH-1))/(len(P)-NH)); v[L_c] = cl*0.25; tv.append(sum((P[q+1]-P[q]).length for q in range(j, len(P)-1))/0.009); _capv.add(v)      # 生えぎわは細かいギザギザ。帯は 9mm（2.2cm だと耳まわり・えりあしがまばらに透けて、はげて見えた）
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
# 土台の毛の生えぎわより下（頭のいちばん張った所より下）は、頭・首の肌に沿わせる（垂れ下がって、ボブのように見えていた）
_cap_alive = [v for v in _capv if v.is_valid]
# 生えぎわの線（土台の毛のすそのふち）を、ふちに沿ってならして、なめらかな曲線にする
_rim = [v for v in _cap_alive if v.is_boundary and v.co.z < C.z+0.03]
for _ in range(12):
    _nw = {}
    for v in _rim:
        nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
        if len(nb) == 2: _nw[v] = v.co*0.5+(nb[0].co+nb[1].co)*0.25
    for v, c in _nw.items(): v.co = c
# 頭に沿わせるときの当たり判定は、耳を外した体（耳に当たると、髪が耳の上に乗って段になった）
_bo = bpy.data.objects["Girl_Body"]; _eg = _bo.vertex_groups["ears"].index
_earv = {v.index for v in _bo.data.vertices if any(g.group == _eg and g.weight > 0.3 for g in v.groups)}
_mkb = next(m for m in _bo.modifiers if m.type == 'MASK'); _mkb.show_viewport = False; bpy.context.view_layer.update()
_eb = _bo.evaluated_get(bpy.context.evaluated_depsgraph_get()); _mb = _eb.to_mesh()
_hv = [_bo.matrix_world @ v.co for v in _mb.vertices]
_bi = _bo.vertex_groups["body"].index; _vis = {v.index for v in _bo.data.vertices if any(g.group == _bi and g.weight > 0.5 for g in v.groups)}
_hp = [tuple(p_.vertices) for p_ in _mb.polygons if all(i in _vis and i not in _earv for i in p_.vertices)]
_eb.to_mesh_clear(); _mkb.show_viewport = True
bvh_noear = BVHTree.FromPolygons(_hv, _hp)
for v in _cap_alive:
    if v.co.z > C.z+0.08: continue
    dv = (v.co-C).normalized()                          # 外から頭の中心へ光線を当てて、最初に当たる外側の肌に沿わせる
    hit = bvh_noear.ray_cast(C+dv*0.30, -dv, 0.30)      # （いちばん近い面だと、体の中の補助の形に当たって内側へ寄った）
    if hit[0] is None: continue
    k = sstep((C.z+0.08-v.co.z)/0.04)                   # 耳の上（頭の横の張り出し）から下を、頭に沿わせる
    off = 0.0035+0.0045*sstep((v.co.z-(C.z-0.01))/0.06)   # 生えぎわに近いほど、頭にぴったり（3.5mm）。上は髪の厚み（8mm）
    v.co = v.co.lerp(hit[0]+dv*off, k)

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
def tail(sgn, ctrl, seed, fat=1.0, NST=9, TURNS=(1.5, 2.2), WIDK=1.0):
    """ゆるい巻き髪の束：軸のまわりを、何本もの毛束がゆるく回りながら下りる。毛先ほど巻きが細かい"""
    NA = 200; rnd = random.Random(seed)
    ax = resample(catmull([Vector(p) for p in ctrl], 24), NA)
    def RB(s): return (0.007+0.030*sstep(s/0.30)+0.012*sstep((s-0.45)/0.5))*fat*(1-0.55*sstep((s-0.80)/0.20))      # 束の太さ（下へ行くほどふくらむ）
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
    NR = 96; NK = 4
    for k in range(NST):
        ph = 2*math.pi*k/NST+rnd.uniform(-0.3, 0.3); turns = rnd.uniform(*TURNS); hand = 1 if k % 3 else -1
        send = rnd.uniform(0.80, 1.0); rr = rnd.uniform(0.75, 1.15); wid = rnd.uniform(0.026, 0.038)*WIDK
        wamp = rnd.uniform(0.005, 0.009)*WIDK; wfr = rnd.uniform(2.0, 3.2); wph = rnd.uniform(0, 6.28)
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
# 高い位置のポニーテール：頭のてっぺんの後ろで結び、背中を腰まで下りる。ゆるい波
TIE = Vector((0.0, C.y+RY*0.50, C.z+RZ*0.80))          # 結び目は頭の表面（後ろ寄りのてっぺん）に置く。頭の大きさに合わせる
YB = C.y+RY                                              # 後頭部のいちばん後ろ
# 背中へ下りる大きなポニーテール（腰まで）。顔の左右に垂らす毛束は作らない
PONY = (TIE, (0.004, YB-0.008, C.z+RZ*0.95), (0.006, YB+0.035, C.z+RZ*0.45), (0.006, YB+0.050, C.z-0.10), (0.006, YB+0.050, C.z-0.30), (0.004, YB+0.045, C.z-0.50), (0.0, YB+0.040, C.z-0.68))
tail(1, PONY, 11, fat=2.3, NST=26, TURNS=(0.3, 0.6))
# FLOW：髪の流れ。頭の表面に沿った細い毛束を重ねる（前髪は分け目から斜めに流し、サイドは生えぎわから結び目へ向かって流す）
def _dir_of(thd, phd):
    th = math.radians(thd); ph = math.radians(phd); return Vector((math.sin(ph)*math.sin(th), -math.sin(ph)*math.cos(th), math.cos(ph)))
def _bang_ph(thd):
    t_ = max(-BANG, min(BANG, thd))
    rise = 0.050*(1-sstep((abs(t_)/BANG-0.45)/0.55))
    return math.degrees(math.acos(max(-0.99, min(0.99, (ZBANG-0.009+rise-C.z)/RZ))))
_fr = random.Random(23); _nlock = [0]
def lock(dirs, wid, lift, tip_out=0.0, cut_at_root=False):
    NS = 28; NKL = 3
    ds = resample(catmull(dirs, 10), NS); grid = []; uc = 0.02+0.031*(_nlock[0] % 30); _nlock[0] += 1
    cs = []
    for i, d in enumerate(ds):
        d = d.normalized(); s = i/NS
        _pe = C+Vector((d.x*RX, d.y*RY, d.z*RZ)); _dn = (_pe-C).normalized()
        _h = bvh_noear.ray_cast(C+_dn*0.30, -_dn, 0.30)                 # 頭の表面（耳は外す）（外から光線を当てて最初に当たる所）。楕円のままだと、頭の横で 2cm 浮いた
        _r = max((_pe-C).length, ((_h[0]-C).length+0.006) if _h[0] is not None else 0.0) if _dn.z > 0.55 else (((_h[0]-C).length+0.006) if _h[0] is not None else (_pe-C).length)
        cs.append((C+_dn*(_r+lift*math.sin(math.pi*min(1, s*1.15))**0.6-0.0015+tip_out*s**3), d))      # 根元は髪の中から出て、頭に沿う
    for i, (c, d) in enumerate(cs):
        s = i/NS; tg = (cs[min(NS, i+1)][0]-cs[max(0, i-1)][0]).normalized(); side = tg.cross(d).normalized()
        w = wid*(0.35+0.65*sstep(s/0.25))*(1-0.97*sstep((s-0.45)/0.55)); row = []      # 毛先はほぼ 0 まで、長い距離で細くする（幅 15% で平らに切れて、くしの歯のように並んで見えた）
        for q in range(NKL+1):
            kk = -1+2*q/NKL; pt = c+side*(kk*w/2)+d*(0.0018*(1-kk*kk))
            loc, nor, idx, dist = bvh.find_nearest(pt)
            if loc is not None and ((pt-loc).dot(nor) < 0 or dist < 0.007): pt = loc+nor*0.007
            v = bm.verts.new(pt); v[L_t] = 0.80+0.18*s; v[L_c] = 0.0; row.append(v)
        grid.append(row)
    for i in range(NS):
        for q in range(NKL):
            f = bm.faces.new((grid[i][q], grid[i+1][q], grid[i+1][q+1], grid[i][q+1]))
            for l, (ii, qq) in zip(f.loops, ((i, q), (i+1, q), (i+1, q+1), (i, q+1))):
                l[uv].uv = (uc+qq/NKL*0.03, 1-ii/NS); l[uvt].uv = (uc+qq/NKL*0.03, 3.0+(ii/NS if cut_at_root else (NS-ii)/NS))      # 毛束は形が毛先へ細くなるので、透けの切れ込みは使わない（ゲームでギザギザに見えた）      # cut_at_root：毛先の切れ込みを始点（結び目）の側に
_tie_d = Vector(((TIE.x-C.x)/RX, (TIE.y-C.y)/RY, (TIE.z-C.z)/RZ)).normalized()
# 顔まわりの前髪（カーテン）：分け目から額の両わきへ流れ、顔の横をあごの下まで下りる長い毛束。毛先は少し外へ流れる
_ribv = []
def ribbon(P, wid, NS=40):
    """点の列 P に沿った、細い帯の毛束（根元と毛先は細く）。頭・顔の外へ出す"""
    ds = resample(catmull(P, 12), NS); grid = []; uc = 0.02+0.031*(_nlock[0] % 30); _nlock[0] += 1; NKL = 3
    for i, c in enumerate(ds):
        s_ = i/NS; tg = (ds[min(NS, i+1)]-ds[max(0, i-1)]).normalized()
        out = (c-Vector((C.x, C.y, c.z))).normalized() if c.z < C.z-0.02 else (c-C).normalized()
        side = tg.cross(out).normalized()
        w = wid*(0.25+0.75*sstep(s_/0.12))*(1-0.95*sstep((s_-0.55)/0.45)); row = []
        for q in range(NKL+1):
            kk = -1+2*q/NKL; pt = c+side*(kk*w/2)+out*(0.0015*(1-kk*kk))
            loc, nor, idx, dist = bvh.find_nearest(pt)
            if loc is not None and ((pt-loc).dot(nor) < 0 or dist < 0.005): pt = loc+nor*0.005
            v = bm.verts.new(pt); v[L_t] = 0.85+0.13*s_; v[L_c] = 0.0; row.append(v); _ribv.append(v)
        grid.append(row)
    for i in range(NS):
        for q in range(NKL):
            f = bm.faces.new((grid[i][q], grid[i+1][q], grid[i+1][q+1], grid[i][q+1]))
            for l, (ii, qq) in zip(f.loops, ((i, q), (i+1, q), (i+1, q+1), (i, q+1))):
                l[uv].uv = (uc+qq/NKL*0.03, 1-ii/NS); l[uvt].uv = (uc+qq/NKL*0.03, 3.0)
def _face_y(x, z, off):
    fy = front_y(x, z)
    return (fy+OFF-off) if fy is not None else None
ZHL = ZBANG+0.040                                       # 額の生えぎわの高さ
for sg in (1, -1):
    for k in range(10):
        t = k/9
        r0 = ell(math.radians(PART+sg*(1.5+2*t)), math.radians(14+5*t))                       # 分け目
        a1 = sg*(12+20*t); r1 = ell(math.radians(a1), math.acos(max(-0.99, min(0.99, (ZHL-C.z)/RZ))))   # 額の生えぎわ
        r1 = C+(r1-C)*1.06
        x2 = sg*(0.050+0.020*t); z2 = ZBANG-0.010-0.006*t                                    # こめかみ・目じりの横
        x3 = sg*(0.064+0.016*t); z3 = C.z-0.060                                              # ほおの横
        x4 = sg*(0.068+0.016*t); z4 = C.z-0.100-0.016*t+_fr.uniform(-0.006, 0.006)             # 毛先（あごの横。外へはねない）
        P = [r0, r1]; yprev = r1.y
        for (x, z, off) in ((x2, z2, 0.006), (x3, z3, 0.008), (x4, z4, 0.009)):
            y = _face_y(x, z, off)
            if y is None or y < yprev-0.02: y = yprev+0.012          # 顔に当たらない所（あごの横）は、前の点より少し後ろへ（前へ飛び出さない）
            P.append(Vector((x, y, z))); yprev = y
        ribbon(P, _fr.uniform(0.011, 0.015))
for sg in (1, -1):                                      # サイド：生えぎわから後ろ上の結び目へ
    for k in range(14):
        a0 = lerp(BANG+3, 124, k/13)+_fr.uniform(-2, 2); p0 = hairline(a0)-4+_fr.uniform(-2, 1)      # 端は生えぎわのすぐ上（地肌の上に浮かないように）
        lock([_tie_d, _dir_of(sg*lerp(a0, 172, 0.80), 30), _dir_of(sg*lerp(a0, 160, 0.42), 56), _dir_of(sg*lerp(a0, 150, 0.12), p0-14), _dir_of(sg*a0, p0)],
             _fr.uniform(0.010, 0.014), _fr.uniform(0.002, 0.0045), cut_at_root=True)      # サイドは生えぎわから引っ張られる：切れ込みは結び目の側（生えぎわの側に置くと、耳の上でギザギザの段に見えた）
# TOPFLOW：頭の上の流れ。前の生えぎわ・分け目から、てっぺんをこえて結び目へ引きつめる毛束。後ろはえりあしから結び目へ上げる
def _arc(d0, n=3, wob=0.0):
    out = [_tie_d]
    for i in range(1, n+1):
        t = i/(n+1); m_ = (_tie_d*(1-t)+d0*t).normalized()
        sd_ = m_.cross(Vector((0, 0, 1)));  out.append((m_+sd_*wob*math.sin(math.pi*t)).normalized())
    return out+[d0]
for k in range(30):                                     # 前から上へ
    t0 = lerp(-BANG-22, BANG+22, k/29)+_fr.uniform(-2, 2)
    lock(_arc(_dir_of(t0, _fr.uniform(40, 54)), 3, _fr.uniform(-0.10, 0.10)), _fr.uniform(0.012, 0.017), _fr.uniform(0.0045, 0.0075))
n_hair = len(bm.faces)
# KNOT：ポニーテールの結び目（黒いヘアゴム）。結び目から毛束が出る向きを軸にした輪
_dir = (Vector(PONY[1])-Vector(PONY[0])).normalized(); _kc = Vector(PONY[0])+_dir*0.006
_u = _dir.orthogonal().normalized(); _w = _dir.cross(_u); KR = 0.034; Kr = 0.011; _ring = []
for i in range(24):
    a = 2*math.pi*i/24; rad = _u*math.cos(a)+_w*math.sin(a)
    _ring.append([bm.verts.new(_kc+rad*(KR+Kr*math.cos(2*math.pi*k/10))+_dir*(Kr*math.sin(2*math.pi*k/10))) for k in range(10)])
for i in range(24):
    for k in range(10): bm.faces.new((_ring[i][k], _ring[(i+1) % 24][k], _ring[(i+1) % 24][(k+1) % 10], _ring[i][(k+1) % 10]))

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
bmesh.ops.recalc_face_normals(bm, faces=[f for i, f in enumerate(bm.faces) if i >= n_hair])
for i, f in enumerate(bm.faces): f.material_index = 1 if i >= n_hair else 0

bm.verts.ensure_lookup_table(); _tw = [v[L_t] for v in bm.verts]
bm.verts.index_update(); _rib_idx = [v.index for v in _ribv if v.is_valid]
old = bpy.data.objects.get("Girl_HairPony")
if old: bpy.data.objects.remove(old, do_unlink=True)
mesh = bpy.data.meshes.new("Girl_HairPony"); bm.to_mesh(mesh); bm.free()
for p in mesh.polygons: p.use_smooth = True
h = bpy.data.objects.new("Girl_HairPony", mesh); bpy.context.scene.collection.objects.link(h)
g = h.vertex_groups.new(name="thick")
for i, t in enumerate(_tw): g.add([i], max(0.05, 1-0.95*t), 'REPLACE')
md = h.modifiers.new("Solidify", 'SOLIDIFY'); md.thickness = 0.01; md.offset = -1.0
md.vertex_group = "thick"; md.thickness_vertex_group = 0.05

# 髪の色：ブラウン（Hair を写して色だけ変える）
src = bpy.data.materials["Hair"]
mt = bpy.data.materials.get("Hair_Ash")
if not mt: mt = src.copy(); mt.name = "Hair_Ash"
mix = next(n for n in mt.node_tree.nodes if n.type == 'MIX' and n.data_type == 'RGBA')
mix.inputs[6].default_value = (0.070, 0.030, 0.015, 1); mix.inputs[7].default_value = (0.31, 0.150, 0.072, 1)       # 栗色
mt.diffuse_color = (0.17, 0.09, 0.05, 1)
mesh.materials.append(mt); mesh.materials.append(bpy.data.materials.get("ST_Leather") or bpy.data.materials.get("J_Black") or src)
for _n in ("Girl_Hair", "Girl_HairTwin", "Girl_HairBun", "Girl_HairBob", "Girl_HairWavy"):
    oh = bpy.data.objects.get(_n)
    if oh: oh.hide_viewport = True; oh.hide_render = True
print("pony hair built", len(mesh.vertices), len(mesh.polygons))
if _rig:                                                 # 作り直した物を骨組みに付け直し、姿勢を元に戻す
    exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bind_rig.py", encoding="utf-8").read(), "bind_rig.py", "exec"), {"__name__": "__main__"})
    # 顔まわりの長い前髪は頭の骨だけに付ける（耳より下は髪の揺れ骨に付くので、首を回すと外へはねた）
    _ho = bpy.data.objects["Girl_HairPony"]; _gh = _ho.vertex_groups.get("head"); _gs = _ho.vertex_groups.get("hairSwing")
    if _gh and _rib_idx:
        if _gs: _gs.remove(_rib_idx)
        _gh.add(_rib_idx, 1.0, 'REPLACE')
    _rig.data.pose_position = _pose
