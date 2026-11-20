# カジュアルな服一式を作る（Blender の中で exec する）
#   Girl_Sweater（ゆったりニット）/ Girl_Skirt（プリーツのミニ）/ Girl_Inner（スカートの中のインナー）
#   Girl_Socks（短いソックス）/ Girl_Shoes（スニーカー）
# 体は Girl_Body。足は平ら（custom-heel = 0）、靴底の厚みぶん全体が上がっている前提（"heel_shift" の z）。
import bpy, bmesh, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ob = bpy.data.objects["Girl_Body"]; me = ob.data
S = Vector(ob["heel_shift"]).z
mk = next(m for m in ob.modifiers if m.type == 'MASK')
mk.show_viewport = False; bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); e = ob.evaluated_get(dg); m = e.to_mesh()
co = [v.co.copy() for v in m.vertices]; e.to_mesh_clear(); mk.show_viewport = True
body = ob.vertex_groups["body"]; hid = ob.vertex_groups["hidden_by_clothes"]
gi = {body.index, hid.index}
inb = [any(g.group in gi and g.weight > 0.5 for g in v.groups) for v in me.vertices]
def joint(n):
    j = ob.vertex_groups[n].index
    ps = [co[v.index] for v in me.vertices if any(g.group == j and g.weight > 0.5 for g in v.groups)]
    return sum(ps, Vector())/len(ps)
hand = joint("joint-l-hand"); elbow = joint("joint-l-elbow"); d = (hand-elbow).normalized()
def ss(t): t = max(0, min(1, t)); return t*t*(3-2*t)

def mat(name, col, rough, **kw):
    mt = bpy.data.materials.get(name) or bpy.data.materials.new(name); mt.use_nodes = True
    b = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    if not b.inputs["Base Color"].is_linked: b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = rough
    for k, v in kw.items(): b.inputs[k].default_value = v
    mt.diffuse_color = (*col, 1); mt.use_backface_culling = False
    return mt
def newobj(name, bm, mats):
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    bm.normal_update(); mesh = bpy.data.meshes.new(name); bm.to_mesh(mesh); bm.free()
    for p in mesh.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(o)
    for mt in (mats if isinstance(mats, (list, tuple)) else [mats]): mesh.materials.append(mt)
    return o
def from_body(sel):
    vs = [i for i in range(len(co)) if inb[i] and sel(co[i])]; s = set(vs)
    bm = bmesh.new(); mp = {i: bm.verts.new(co[i]) for i in vs}
    for p in me.polygons:
        if all(v in s for v in p.vertices):
            try: bm.faces.new([mp[v] for v in p.vertices])
            except ValueError: pass
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    return bm, s
def erode(sel_set, rings):
    inner = set(sel_set)
    for _ in range(rings):
        edge = set()
        for p in me.polygons:
            vs = p.vertices
            if any(v not in inner for v in vs): edge.update(v for v in vs if v in inner)
        inner -= edge
    return inner
to_hide = set()

# ── ニット（ゆったり）────────────────────────────
HEM = 0.925+S
def LINE(y): return 1.352+S+(y+0.03)*0.30          # えりの線（後ろが少し高い）
def sweater_sel(c):
    ax = abs(c.x)
    if ax > 0.17:
        if ax < 0.27 and c.z < HEM+0.03: return False                    # 腰の横の出っぱり（腕ではない）
        p = Vector((ax, c.y, c.z)); return (p-hand).dot(d) < 0.022      # 手首を少しこえる長めの袖
    return HEM <= c.z <= LINE(c.y)
bm, ssel = from_body(sweater_sel)
inner = [v for v in bm.verts if not v.is_boundary]
for _ in range(12): bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.normal_update()
for v in bm.verts:
    ax = abs(v.co.x); c = v.co
    if v.is_boundary:
        if ax > 0.30:                                   # 袖口：軸に垂直にそろえ、少しすぼめる
            s = 1 if c.x > 0 else -1; p = Vector((ax, c.y, c.z)); p += d*(0.028-(p-hand).dot(d))
            v.co = Vector((s*p.x, p.y, p.z))+v.normal*0.009
        elif c.z > 1.30+S:                              # えり
            v.co.z = LINE(c.y); v.co += Vector((v.normal.x, v.normal.y, 0))*0.007
        else:                                           # すそ
            v.co.z = HEM; v.co += Vector((v.normal.x, v.normal.y, 0))*0.013
    else:
        off = 0.019 if ax < 0.13 else (0.019+(0.015-0.019)*ss((ax-0.13)/0.08))
        # すそ・袖口へ向かって少しふくらませてから、ふちですぼまる（リブの上のたるみ）
        if ax < 0.17: off += 0.006*ss((0.99+S-c.z)/0.06)
        else: off += 0.005*ss(((Vector((ax, c.y, c.z))-hand).dot(d)+0.07)/0.07)
        v.co += v.normal*off
# 胴：体に沿わせず、いちばん出ている所（胸・肩甲骨・脇）からまっすぐ落ちる筒にする（ゆったりした服）
_tp = [tuple(p.vertices) for p in me.polygons if all(inb[v] and abs(co[v].x) < 0.165 for v in p.vertices)]
_tb = BVHTree.FromPolygons(co, _tp); CYT = -0.045; NA = 72
def _br(th, z):
    dirv = Vector((math.sin(th), -math.cos(th), 0)); h = _tb.ray_cast(Vector((0, CYT, z))+dirv*0.40, -dirv, 0.40)
    return (0.40-h[3]) if h[0] else 0.0
_zs = [HEM+0.02*i for i in range(int((1.27+S-HEM)/0.02)+1)]
tube = [max(_br(2*math.pi*a/NA, z) for z in _zs)+0.020 for a in range(NA)]
# 断面を凸にする（胸の谷間や脇のくぼみに布が沈まないように、出ている所どうしを布が渡る）
_pts = [(tube[a]*math.sin(2*math.pi*a/NA), -tube[a]*math.cos(2*math.pi*a/NA)) for a in range(NA)]
def _hull(P):
    P = sorted(set(P))
    def cr(o, a, b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lo = []
    for q in P:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], q) <= 0: lo.pop()
        lo.append(q)
    up = []
    for q in reversed(P):
        while len(up) >= 2 and cr(up[-2], up[-1], q) <= 0: up.pop()
        up.append(q)
    return lo[:-1]+up[:-1]
_H = _hull(_pts)
def _ray(th):
    dxr, dyr = math.sin(th), -math.cos(th); best = 0.0
    for i in range(len(_H)):
        (x1, y1), (x2, y2) = _H[i], _H[(i+1) % len(_H)]
        ex, ey = x2-x1, y2-y1; den = dxr*ey-dyr*ex
        if abs(den) < 1e-9: continue
        t = (x1*ey-y1*ex)/den; u = (x1*dyr-y1*dxr)/den
        if t > 0 and -1e-6 <= u <= 1+1e-6: best = max(best, t)
    return best
tube = [_ray(2*math.pi*a/NA) for a in range(NA)]
def r_tube(th):
    f = (th % (2*math.pi))/(2*math.pi)*NA; a = int(f) % NA; return tube[a]+(tube[(a+1) % NA]-tube[a])*(f-int(f))
for v in bm.verts:
    c = v.co; ax = abs(c.x)
    if c.z > 1.33+S: continue
    wx = 1.0 if c.z < 1.17+S else 1-ss((ax-0.135)/0.06)*ss((c.z-(1.17+S))/0.04)
    if wx <= 0: continue
    dx, dy = c.x, c.y-CYT; r = math.hypot(dx, dy)
    if r < 1e-5: continue
    th = math.atan2(dx, -dy); rt = r_tube(th)*(0.975 if v.is_boundary else 1.0)
    k = (1-ss((c.z-(1.22+S))/0.09))*wx
    if rt > r:
        nr = r+(rt-r)*k; v.co.x = dx/r*nr; v.co.y = CYT+dy/r*nr
ring = [v for v in bm.verts if not v.is_boundary and any(ed.other_vert(v).is_boundary for ed in v.link_edges)]
bmesh.ops.smooth_vert(bm, verts=ring, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
_front = [v for v in bm.verts if not v.is_boundary and abs(v.co.x) < 0.15 and v.co.z < 1.30+S]     # 胸の先のとがりを消す
for _ in range(8): bmesh.ops.smooth_vert(bm, verts=_front, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
allv = [v for v in bm.verts if not v.is_boundary]
for _ in range(3): bmesh.ops.smooth_vert(bm, verts=allv, factor=0.4, use_axis_x=True, use_axis_y=True, use_axis_z=True)
sweater = newobj("Girl_Sweater", bm, mat("Sweater", (0.86, 0.79, 0.68), 0.95, **{"Sheen Weight": 0.3}))
to_hide |= erode(ssel, 2)

# ── インナー（スカートの中）─────────────────────────
def inner_sel(c): return abs(c.x) < 0.22 and 0.715+S <= c.z <= 1.01+S
bm, isel = from_body(inner_sel)
bm.normal_update()
for v in bm.verts: v.co += v.normal*0.003
innerw = newobj("Girl_Inner", bm, mat("Inner", (0.80, 0.50, 0.56), 0.8))
to_hide |= erode(isel, 2)

# ── プリーツのミニスカート ─────────────────────────
polys = [tuple(p.vertices) for p in me.polygons if all(inb[v] and abs(co[v].x) < 0.30 for v in p.vertices)]
bvh = BVHTree.FromPolygons(co, polys)
def body_r(th, z, cy):
    dirv = Vector((math.sin(th), -math.cos(th), 0)); h = bvh.ray_cast(Vector((0, cy, z))+dirv*0.40, -dirv, 0.40)
    return (0.40-h[3]) if h[0] else 0.0
ZW = 1.005+S; ZH = 0.625+S; NP = 22; SEG = 5; NC = NP*SEG; NR = 10
bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap"); rows = []
for j in range(NR+1):
    t = j/NR; z = ZW+(ZH-ZW)*t; cy = -0.052+0.012*t; ringv = []
    for i in range(NC):
        th = 2*math.pi*i/NC
        br = max(body_r(th, z, cy), body_r(th, min(z+0.03, ZW), cy) if j > 0 else 0)+0.012
        ex = 0.125+(0.232-0.125)*t**0.9; ey = 0.085+(0.212-0.085)*t**0.9
        fr = 1/math.sqrt((math.sin(th)/ex)**2+(math.cos(th)/ey)**2)
        saw = (i % SEG)/(SEG-1)                         # ひだ：だんだん出て、折り返しで戻る
        fr *= 1+0.085*(t**0.8)*(saw-0.5)
        r = max(br, fr) if t > 0.08 else br
        ringv.append(bm.verts.new((r*math.sin(th), cy-r*math.cos(th), z)))
    rows.append(ringv)
for j in range(NR):
    for i in range(NC):
        a, b = rows[j], rows[j+1]; i2 = (i+1) % NC
        f = bm.faces.new((a[i], b[i], b[i2], a[i2]))
        for l, (ii, jj) in zip(f.loops, ((i, j), (i, j+1), (i+1, j+1), (i+1, j))): l[uv].uv = (ii/NC, 1-jj/NR)
skirt = newobj("Girl_Skirt", bm, mat("Skirt_Pink", (0.88, 0.50, 0.58), 0.8))
for p in skirt.data.polygons: p.use_smooth = False          # ひだの折り目を立てる

# ── ソックス ────────────────────────────────
SOCK_TOP = 0.165+S
def sock_sel(c): return abs(c.x) < 0.25 and 0.030+S <= c.z <= SOCK_TOP
bm, ksel = from_body(sock_sel)
bm.normal_update()
for v in bm.verts:
    v.co += v.normal*0.0032
    if v.is_boundary and v.co.z > 0.12+S: v.co.z = SOCK_TOP
socks = newobj("Girl_Socks", bm, mat("Socks", (0.90, 0.90, 0.89), 0.9))
to_hide |= erode(ksel, 1)

# ── スニーカー ───────────────────────────────
fpoly = [tuple(p.vertices) for p in me.polygons if all(inb[v] and co[v].z < 0.2+S for v in p.vertices)]
fbvh = BVHTree.FromPolygons(co, fpoly)
F = [co[i] for i in range(len(co)) if inb[i] and co[i].x > 0 and co[i].z < 0.085+S]
toe = min(c.y for c in F); heel = max(c.y for c in F if c.z < 0.05+S)
NS = 18; st = []
for i in range(NS+1):
    t = i/NS; y = heel+(toe-heel)*t
    sl = [c for c in F if abs(c.y-y) < 0.012 and c.z < 0.06+S]
    st.append([t, y, min(c.x for c in sl)-0.0065, max(c.x for c in sl)+0.0065, max(c.z for c in sl)-S+0.007])
for _ in range(2):
    st = [st[0]]+[[st[i][0], st[i][1]]+[(st[i-1][j]+2*st[i][j]+st[i+1][j])/4 for j in (2, 3, 4)] for i in range(1, NS)]+[st[-1]]
TC = 0.30                     # ここから先（つま先側）は甲を覆う
def topline(t): return 0.066 if t < 0.12 else 0.066-(t-0.12)/0.18*0.012
W = 3; A = 7
bm = bmesh.new(); solef = []; keep = set()
def build(sgn):
    secs = []
    for (t, y, xl, xr, H) in st:
        cx = (xl+xr)/2; w = (xr-xl)/2
        if t < 0.05: w *= 0.72
        if t > 0.93: w *= 0.86
        closed = t > TC; tl = topline(t) if not closed else min(0.034, H*0.62)
        zb = S-0.002
        L = [bm.verts.new((sgn*(cx-w*(1+0.04*math.sin(math.pi*q/(W-1)))), y, zb+tl*q/(W-1))) for q in range(W)]
        R = [bm.verts.new((sgn*(cx+w*(1+0.04*math.sin(math.pi*q/(W-1)))), y, zb+tl*q/(W-1))) for q in range(W)]
        SL = [bm.verts.new((sgn*(cx-w*1.07), y, zb)), bm.verts.new((sgn*(cx-w*1.07), y, 0.0))]      # 靴底の側面
        SR = [bm.verts.new((sgn*(cx+w*1.07), y, zb)), bm.verts.new((sgn*(cx+w*1.07), y, 0.0))]
        for v in SL+SR+[L[0], R[0]]: keep.add(v)
        top = []
        if closed:
            Hh = min(H, 0.078)
            for a in range(1, A):
                ang = math.pi*a/A; top.append(bm.verts.new((sgn*(cx-w*math.cos(ang)), y, zb+tl+(Hh-tl)*math.sin(ang)**0.8)))
        secs.append((closed, L, top, R, SL, SR))
    def face(vs, sole=False):
        try:
            f = bm.faces.new(vs if sgn > 0 else vs[::-1])
            if sole: solef.append(f)
        except ValueError: pass
    for i in range(NS):
        (c0, L0, T0, R0, SL0, SR0), (c1, L1, T1, R1, SL1, SR1) = secs[i], secs[i+1]
        for q in range(W-1):
            face([L0[q], L0[q+1], L1[q+1], L1[q]]); face([R0[q+1], R0[q], R1[q], R1[q+1]])
        face([SL0[0], L0[0], L1[0], SL1[0]], True); face([R0[0], SR0[0], SR1[0], R1[0]], True)      # 底の張り出し
        face([SL0[1], SL0[0], SL1[0], SL1[1]], True); face([SR0[0], SR0[1], SR1[1], SR1[0]], True)  # 側面
        face([SL0[1], SL1[1], SR1[1], SR0[1]], True)                                                # 底
        if c0 and c1:
            a = [L0[-1]]+T0+[R0[-1]]; b = [L1[-1]]+T1+[R1[-1]]
            for q in range(len(a)-1): face([a[q], a[q+1], b[q+1], b[q]])
    c, L, T, R, SL, SR = secs[-1]; s = st[-1]; cx = (s[2]+s[3])/2
    tip = bm.verts.new((sgn*cx, s[1]-0.009, S+0.016)); tipb = bm.verts.new((sgn*cx, s[1]-0.012, S-0.002)); tipg = bm.verts.new((sgn*cx, s[1]-0.012, 0.0))
    for v in (tipb, tipg): keep.add(v)
    ringv = L+T+R[::-1]
    for q in range(len(ringv)-1): face([ringv[q], ringv[q+1], tip])
    face([L[0], tip, tipb]); face([tip, R[0], tipb])
    face([SL[0], L[0], tipb], True); face([R[0], SR[0], tipb], True)
    face([SL[1], SL[0], tipb, tipg], True); face([SR[0], SR[1], tipg, tipb], True); face([SL[1], tipg, SR[1]], True)
    c, L, T, R, SL, SR = secs[0]; s = st[0]; cx = (s[2]+s[3])/2
    hb = [bm.verts.new((sgn*cx, s[1]+0.008, S-0.002+topline(0)*q/(W-1))) for q in range(W)]
    hg = bm.verts.new((sgn*cx, s[1]+0.011, 0.0)); keep.add(hg); keep.add(hb[0])
    for q in range(W-1): face([L[q+1], L[q], hb[q], hb[q+1]]); face([R[q], R[q+1], hb[q+1], hb[q]])
    face([L[0], SL[0], hb[0]], True); face([SR[0], R[0], hb[0]], True)
    face([SL[0], SL[1], hg, hb[0]], True); face([SR[1], SR[0], hb[0], hg], True); face([SL[1], SR[1], hg], True)
build(1); build(-1)
for v in bm.verts:
    if v in keep: continue
    loc, nor, idx, dist = fbvh.find_nearest(v.co)
    if loc and ((v.co-loc).dot(nor) < 0 or dist < 0.005):
        p = loc+nor*0.005; v.co.x = p.x; v.co.y = p.y
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0003)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces: f.material_index = 1 if f in set(solef) else 0
shoes = newobj("Girl_Shoes", bm, [mat("Sneaker", (0.90, 0.90, 0.88), 0.55), mat("Sneaker_Sole", (0.70, 0.70, 0.69), 0.7)])
for p in shoes.data.polygons: p.use_smooth = p.material_index == 0

# 靴の中の足を隠す（はき口より下）
to_hide |= {i for i in range(len(co)) if inb[i] and co[i].z < 0.034+S}

body.remove(list(to_hide)); hid.add(list(to_hide), 1.0, 'REPLACE')
print("outfit built. hidden", len(to_hide), {o.name: len(o.data.polygons) for o in (sweater, innerw, skirt, socks, shoes)})
