# 黒 × 赤の地雷系コーデ一式を作る（Blender の中で exec する）
#   Jirai_Top（短い丈の長袖・四角いえり・W 字のすそ）/ Jirai_TopDeco（胸の赤い羽根の柄・編み上げ）
#   Jirai_Shorts（スカートの中）/ Jirai_Skirt（3 段フリルのミニ・赤いふち・ハートのバックル）
#   Jirai_LegWarmers（赤いラインのレッグウォーマー）/ Jirai_Shoes（厚底・つま先が赤）
#   Jirai_Accessories（チョーカー・十字のネックレス・ガーターリング・ばんそうこう）/ Jirai_Headphones（赤いヘッドホン）
# すべてコレクション Outfit_Jirai に入れる。前のカジュアル服（Girl_Sweater など）は Outfit_Casual へ移して隠す。
# 体の隠す頂点は hidden_by_clothes。服ごとの控えを hidden_casual / hidden_jirai に残す（着替えるときに使う）。
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
_rig = bpy.data.objects.get("Girl_Rig"); _pose = _rig.data.pose_position if _rig else None    # 骨組みがあれば、作る間は基本の姿勢に戻す
if _rig: _rig.data.pose_position = 'REST'; bpy.context.view_layer.update()

ob = bpy.data.objects["Girl_Body"]; me = ob.data
mk = next(m for m in ob.modifiers if m.type == 'MASK')
mk.show_viewport = False; bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); e = ob.evaluated_get(dg); m = e.to_mesh()
co = [v.co.copy() for v in m.vertices]; e.to_mesh_clear(); mk.show_viewport = True
body = ob.vertex_groups["body"]; hid = ob.vertex_groups["hidden_by_clothes"]
def members(g): return {v.index for v in me.vertices if any(x.group == g.index and x.weight > 0.5 for x in v.groups)}
# 前の服で隠していた頂点を控えてから、いったん全部見せる
old_hidden = members(hid)
if "hidden_casual" not in ob.vertex_groups and old_hidden:
    ob.vertex_groups.new(name="hidden_casual").add(list(old_hidden), 1.0, 'REPLACE')
if old_hidden: body.add(list(old_hidden), 1.0, 'REPLACE'); hid.remove(list(old_hidden))
inb_set = members(body); inb = [i in inb_set for i in range(len(co))]
def joint(n):
    ps = [co[i] for i in members(ob.vertex_groups[n])]
    return sum(ps, Vector())/len(ps)
hand = joint("joint-l-hand"); elbow = joint("joint-l-elbow"); d = (hand-elbow).normalized()
knee = joint("joint-l-knee"); ankle = joint("joint-l-ankle"); hip = joint("joint-l-upper-leg")
def ss(t): t = max(0, min(1, t)); return t*t*(3-2*t)
def lerp(a, b, t): return a+(b-a)*t
bpolys = [tuple(p.vertices) for p in me.polygons if all(inb[v] for v in p.vertices)]
bvh = BVHTree.FromPolygons(co, bpolys)

COL = bpy.data.collections.get("Outfit_Jirai") or bpy.data.collections.new("Outfit_Jirai")
if COL.name not in bpy.context.scene.collection.children: bpy.context.scene.collection.children.link(COL)

def mat(name, col, rough, metal=0.0, **kw):
    mt = bpy.data.materials.get(name) or bpy.data.materials.new(name); mt.use_nodes = True
    b = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    for k, v in kw.items():
        if k in b.inputs: b.inputs[k].default_value = v
    mt.diffuse_color = (*col, 1); mt.use_backface_culling = False
    return mt
BLACK = mat("J_Black", (0.012, 0.012, 0.014), 0.85, **{"Sheen Weight": 0.3})
RIB = mat("J_BlackRib", (0.018, 0.018, 0.021), 0.92, **{"Sheen Weight": 0.45})
RED = mat("J_Red", (0.30, 0.010, 0.026), 0.8, **{"Sheen Weight": 0.3})
REDG = mat("J_RedGloss", (0.40, 0.008, 0.022), 0.14, **{"Coat Weight": 1.0})
BLACKG = mat("J_BlackGloss", (0.010, 0.010, 0.012), 0.28, **{"Coat Weight": 0.6})
SILVER = mat("J_Silver", (0.74, 0.74, 0.77), 0.3, 1.0)
WHITE = mat("J_White", (0.90, 0.89, 0.86), 0.7)
SOLE = mat("J_Sole", (0.014, 0.014, 0.014), 0.6)
REDP = mat("J_RedPlastic", (0.48, 0.012, 0.03), 0.35, **{"Coat Weight": 0.4})

def newobj(name, bm, mats, smooth=True, recalc=True):
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    if recalc: bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update(); mesh = bpy.data.meshes.new(name); bm.to_mesh(mesh); bm.free()
    for p in mesh.polygons: p.use_smooth = smooth
    o = bpy.data.objects.new(name, mesh); COL.objects.link(o)
    for mt in mats: mesh.materials.append(mt)
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
def push_out(bm, dist, verts=None):
    for v in (verts or bm.verts):
        loc, nor, idx, dd = bvh.find_nearest(v.co)
        if loc and (v.co-loc).dot(nor) < dist: v.co = loc+nor*dist
def loft(bm, rings, wrap=True, matf=None):
    vs = [[bm.verts.new(p) for p in r] for r in rings]; n = len(rings[0])
    for i in range(len(rings)-1):
        for j in range(n if wrap else n-1):
            f = bm.faces.new((vs[i][j], vs[i][(j+1) % n], vs[i+1][(j+1) % n], vs[i+1][j]))
            if matf: f.material_index = matf(i, j)
    return vs
def fan(bm, ring, center, mi=0):
    c = bm.verts.new(center); n = len(ring)
    for j in range(n): bm.faces.new((ring[j], ring[(j+1) % n], c)).material_index = mi
def tube(bm, pts, r, seg=6, mi=0, closed=False, caps=True):
    rings = []; n = len(pts); prev = None
    for i, p in enumerate(pts):
        a = pts[(i-1) % n] if (closed or i > 0) else p; b = pts[(i+1) % n] if (closed or i < n-1) else p
        t = (b-a).normalized()
        u = (prev - t*prev.dot(t)) if prev is not None else t.orthogonal()
        u.normalize(); prev = u; w = t.cross(u)
        rings.append([p+(u*math.cos(k*2*math.pi/seg)+w*math.sin(k*2*math.pi/seg))*r for k in range(seg)])
    if closed: rings.append(rings[0])
    vs = loft(bm, rings, True, (lambda i, j: mi))
    if caps and not closed: fan(bm, vs[0], pts[0], mi); fan(bm, vs[-1], pts[-1], mi)
def box(bm, c, sx, sy, sz, mi=0, rot=None):
    vs = []
    for dx in (-1, 1):
        for dy in (-1, 1):
            for dz in (-1, 1):
                p = Vector((dx*sx/2, dy*sy/2, dz*sz/2))
                vs.append(bm.verts.new(c+(rot @ p if rot else p)))
    for q in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        bm.faces.new([vs[i] for i in q]).material_index = mi
def ball(bm, c, rx, ry, rz, mi=0, nu=12, nv=8, rot=None):
    rings = []
    for i in range(1, nv):
        a = math.pi*i/nv
        rings.append([c+((rot @ Vector((rx*math.sin(a)*math.cos(k*2*math.pi/nu), ry*math.sin(a)*math.sin(k*2*math.pi/nu), rz*math.cos(a)))) if rot else
                         Vector((rx*math.sin(a)*math.cos(k*2*math.pi/nu), ry*math.sin(a)*math.sin(k*2*math.pi/nu), rz*math.cos(a)))) for k in range(nu)])
    vs = loft(bm, rings, True, (lambda i, j: mi))
    top = Vector((0, 0, rz)); bot = Vector((0, 0, -rz))
    fan(bm, vs[0], c+(rot @ top if rot else top), mi); fan(bm, vs[-1], c+(rot @ bot if rot else bot), mi)
def front_hit(x, z, tree=None, y0=-0.6):
    loc, nor, idx, dd = (tree or bvh).ray_cast(Vector((x, y0, z)), Vector((0, 1, 0)))
    return loc, nor
def radial(c, th, far=0.2):
    loc, nor, idx, dd = bvh.ray_cast(c, Vector((math.cos(th), math.sin(th), 0)))
    return dd if loc else far
to_hide = set()

# ── トップス（短い丈・体に沿う長袖）────────────────────
def LINE(y): return 1.374+(y+0.03)*0.30                 # えりの線（後ろが少し高い）
NECK_X = 0.082; NECK_F = 1.298; NECK_B = 1.348           # 四角いえり（前は深く、後ろは浅く）
def hemz(x, y):                                          # すそ：前は W 字（左右に 2 つの角）、横と後ろはまっすぐ
    ax = abs(x); t = ss((-0.045-y)/0.045)
    f = lerp(1.088, 1.046, ax/0.055) if ax < 0.055 else lerp(1.046, 1.100, min(1, (ax-0.055)/0.065))
    return lerp(1.100, f, t)
def neck_hole(c):
    if c.z > LINE(c.y): return True
    return abs(c.x) < NECK_X and c.z > (NECK_F if c.y < 0 else NECK_B)
def is_arm(c): return abs(c.x) > 0.17 and not (abs(c.x) < 0.27 and c.z < 1.05)
def top_sel(c):
    ax = abs(c.x)
    if ax > 0.17:
        if ax < 0.27 and c.z < 1.05: return False                       # 腰の横の出っぱり（腕ではない）
        return (Vector((ax, c.y, c.z))-hand).dot(d) < 0.022
    return 1.02 <= c.z <= LINE(c.y)+0.012
bm, tsel = from_body(top_sel)
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
def _cut(f):
    c = f.calc_center_median()
    if is_arm(c): return False
    return neck_hole(c) or c.z < hemz(c.x, c.y)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if _cut(f)], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
inner = [v for v in bm.verts if not v.is_boundary]
for _ in range(6): bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
# 胸は体の細かい形を拾わないように、布が張った形までならす
def bust_w(c): return ss((c.z-1.10)/0.04)*ss((1.31-c.z)/0.04)*ss((-0.06-c.y)/0.04) if abs(c.x) < 0.17 else 0.0
bw = {v: bust_w(v.co) for v in inner}; bust = [v for v in inner if bw[v] > 0.5]
for _ in range(40): bmesh.ops.smooth_vert(bm, verts=bust, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.normal_update()
for v in bm.verts:
    c = v.co; ax = abs(c.x)
    if v.is_boundary:
        if ax > 0.30:                                   # 袖口：軸に垂直にそろえる
            s = 1 if c.x > 0 else -1; p = Vector((ax, c.y, c.z)); p += d*(0.028-(p-hand).dot(d))
            v.co = Vector((s*p.x, p.y, p.z))+v.normal*0.006
        elif c.z < 1.17 and ax < 0.17:                  # すそ
            v.co.z = hemz(c.x, c.y); v.co += Vector((v.normal.x, v.normal.y, 0))*0.006
        elif ax < 0.17:                                 # えり
            if ax > NECK_X+0.010 and c.z > LINE(c.y)-0.014: v.co.z = LINE(c.y)
            else:
                zl = NECK_F if c.y < 0 else NECK_B
                if abs(c.z-zl) < abs(ax-NECK_X): v.co.z = zl
                else: v.co.x = math.copysign(NECK_X, c.x)
            v.co += v.normal*0.005
        else: v.co += v.normal*0.007
    else:
        v.co += v.normal*(0.007+0.002*bw.get(v, 0.0))
push_out(bm, 0.004)
# 胸の先のとがりが服に出ないように、押し出したあとでもう一度ならす（下の肌は隠してあるので、もぐってもよい）。
# 胸の先はメッシュがとても細かく、辺をたどるならし（smooth_vert）では形が残るので、距離で重みをつけてならす
import numpy as np
bust2 = [v for v in inner if bw[v] > 0.02]
for _ in range(3):
    Pn = np.array([v.co[:] for v in bust2]); Wb = np.array([bw[v] for v in bust2])
    D2 = ((Pn[:, None, :]-Pn[None, :, :])**2).sum(axis=2); G = np.exp(-D2/0.024**2)
    Qn = (G @ Pn)/G.sum(axis=1)[:, None]
    for v, q, w in zip(bust2, Qn, Wb): v.co = v.co.lerp(Vector(q), float(w))
bm.normal_update()
for v in bust2: v.co += v.normal*0.004*bw[v]
top_bvh = BVHTree.FromBMesh(bm)
top = newobj("Jirai_Top", bm, [BLACK], recalc=False)
sm = top.modifiers.new("Solidify", 'SOLIDIFY'); sm.thickness = 0.003; sm.offset = 1.0
def top_final(c):
    if not top_sel(c): return False
    if is_arm(c): return True
    return not neck_hole(c) and c.z > hemz(c.x, c.y)
to_hide |= erode({i for i in tsel if top_final(co[i])}, 2)

# ── 胸の柄（赤い羽根）と編み上げ ─────────────────────
bm = bmesh.new()
def wing(ax, z):
    u = (ax-0.030)/0.085
    if u < 0 or u > 1: return False
    tp = 1.226+0.042*u**0.6
    th = 0.034*(1-u)**0.5+0.004+0.009*abs(math.sin(4*math.pi*u))*(1-u)
    return tp-th < z < tp
STEP = 0.0025; grid = {}
def gv(i, k, sgn):
    key = (i, k, sgn)
    if key not in grid:
        x = sgn*(0.030+i*STEP); z = 1.17+k*STEP
        loc, nor = front_hit(x, z, top_bvh)
        grid[key] = bm.verts.new(loc+Vector((0, -0.0042, 0))) if loc else None
    return grid[key]
for sgn in (1, -1):
    for i in range(35):
        for k in range(44):
            if all(wing(0.030+(i+a)*STEP, 1.17+(k+b)*STEP) for a in (0, 1) for b in (0, 1)):
                q = [gv(i, k, sgn), gv(i+1, k, sgn), gv(i+1, k+1, sgn), gv(i, k+1, sgn)]
                if all(q): bm.faces.new(q if sgn > 0 else q[::-1]).material_index = 0
EX = 0.015; eyes = []
for k in range(6):
    z = 1.262-k*0.034; row = []
    for sgn in (-1, 1):
        loc, nor = front_hit(sgn*EX, z, top_bvh)
        p = loc+Vector((0, -0.0045, 0)); row.append(p)
        ring = [p+Vector((0.0042*math.cos(a*math.pi/5), 0, 0.0042*math.sin(a*math.pi/5))) for a in range(10)]
        tube(bm, ring, 0.0013, 5, 1, closed=True)
    eyes.append(row)
for k in range(5):                                       # ひもを交差させる
    for a, b in ((0, 1), (1, 0)):
        p0 = eyes[k][a]; p1 = eyes[k+1][b]; pts = []
        for t in (0, 0.25, 0.5, 0.75, 1):
            p = p0.lerp(p1, t); loc, nor = front_hit(p.x, p.z, top_bvh)
            pts.append(Vector((p.x, (loc.y if loc else p.y)-0.0050-(0.0012 if a == 0 else 0), p.z)))
        tube(bm, pts, 0.0011, 5, 2)
newobj("Jirai_TopDeco", bm, [RED, SILVER, RED], recalc=True)

# ── ショートパンツ（スカートの中）──────────────────────
def shorts_sel(c): return abs(c.x) < 0.22 and 0.742 <= c.z <= 1.000
bm, isel = from_body(shorts_sel)
bm.normal_update()
for v in bm.verts: v.co += v.normal*0.003
shorts = newobj("Jirai_Shorts", bm, [BLACK], recalc=False)
to_hide |= erode(isel, 2)

# ── 3 段フリルのミニスカート ─────────────────────────
NA = 240; CY = -0.030
ZT = [0.80+0.01*i for i in range(23)]                    # 0.80 … 1.02
raw = [[radial(Vector((0, CY, z)), 2*math.pi*j/NA) for j in range(NA)] for z in ZT]
env = [r[:] for r in raw]                                # 下へ行くほど広がる（腰の出っぱりより内へ入らない）
top_i = min(range(len(ZT)), key=lambda i: abs(ZT[i]-0.99))
for i in range(top_i-1, -1, -1): env[i] = [max(env[i][j], env[i+1][j]) for j in range(NA)]
def tab(T, z, j):
    f = (max(ZT[0], min(ZT[-1], z))-ZT[0])/0.01; i = min(len(ZT)-2, int(f)); t = f-i
    return lerp(T[i][j], T[i+1][j], t)
def sil(z, j): return tab(env, z, j)+0.006+0.078*max(0, (0.985-z)/0.285)**0.8
def P(r, j, z): a = 2*math.pi*j/NA; return Vector((r*math.cos(a), CY+r*math.sin(a), z))
bm = bmesh.new()
# ウエストのゴム
wb = [[P(tab(raw, z, j)+off+0.0015*math.sin(40*2*math.pi*j/NA), j, z) for j in range(NA)]
      for z, off in ((1.016, 0.004), (1.013, 0.0085), (1.000, 0.0095), (0.987, 0.0085), (0.984, 0.004))]
loft(bm, wb, True, lambda i, j: 0)
TIERS = [(0.988, 0.878, 0.0, 0.0), (0.902, 0.790, 0.014, 1.9), (0.814, 0.700, 0.014, 4.1)]
NW = 20; NR = 12
for zt, zb, tuck, ph in TIERS:
    rings = []
    for i in range(NR+1):
        t = i/NR; row = []
        for j in range(NA):
            a = 2*math.pi*j/NA
            w = math.sin(NW*a+ph)+0.4*math.sin((2*NW+1)*a+1.7*ph)
            tr = max(0, (t-0.78)/0.22)                   # 赤いふち（フリル）
            z = lerp(zt, zb, t)
            r = sil(z, j)-tuck*(1-t)**2+0.012*math.sin(math.pi*t)+(0.003+0.011*t*t+0.007*tr)*w
            if zt > 0.98 and t < 0.15: r = lerp(tab(raw, z, j)+0.006, r, t/0.15)
            row.append(P(r, j, z-0.005*tr*math.cos((2*NW+1)*a+ph)))
        rings.append(row)
    loft(bm, rings, True, lambda i, j: 1 if i >= NR-3 else 0)
# ハートのバックル（前の中心）
jf = NA*3//4; ry = tab(raw, 1.0, jf)+0.0115
def heart(t): return Vector((16*math.sin(t)**3, 0, 13*math.cos(t)-5*math.cos(2*t)-2*math.cos(3*t)-math.cos(4*t)))*(0.017/16)
hc = Vector((0, CY-ry, 0.998)); NH = 28
for inner_s, mi in ((1.0, 2), (0.55, 0)):
    fr = [bm.verts.new(hc+heart(2*math.pi*k/NH)*inner_s+Vector((0, -0.006 if mi == 2 else -0.0068, 0))) for k in range(NH)]
    bk = [bm.verts.new(hc+heart(2*math.pi*k/NH)*inner_s+Vector((0, 0.002, 0))) for k in range(NH)]
    for k in range(NH): bm.faces.new((fr[k], fr[(k+1) % NH], bk[(k+1) % NH], bk[k])).material_index = mi
    fan(bm, fr, hc+Vector((0, -0.0075 if mi == 2 else -0.0070, 0.003)), mi)
# 赤いリボン（向かって左の腰）
jb = int(NA*(0.75-0.085)); a = 2*math.pi*jb/NA; rb = tab(raw, 0.995, jb)+0.016
bc = P(rb, jb, 0.992); out = Vector((math.cos(a), math.sin(a), 0)); side = Vector((-math.sin(a), math.cos(a), 0))
rot = Matrix((side, out, Vector((0, 0, 1)))).transposed()
for s in (-1, 1): ball(bm, bc+side*s*0.013, 0.012, 0.004, 0.009, 1, rot=rot)
ball(bm, bc+out*0.002, 0.005, 0.005, 0.006, 3, rot=rot)
skirt = newobj("Jirai_Skirt", bm, [BLACK, RED, SILVER, WHITE])

# ── 厚底の靴の形（レッグウォーマーをのせるので先に決める）──────────
PH = Vector((0.158, 0.040, 0)); PT = Vector((0.172, -0.230, 0)); PC = (PH+PT)/2
SA = (PT-PH).length/2; SB = 0.054; SN = 2.5; HS = 0.050; KIN = 0.90
EU = (PT-PH).normalized(); EV = Vector((-EU.y, EU.x, 0))
def sp(c): return math.copysign(abs(c)**(2/SN), c)
def outline(ph):
    u = SA*sp(math.cos(ph)); return u, SB*(1+0.10*u/SA)*sp(math.sin(ph))
def SH(u): return lerp(0.088, 0.050, (u/SA+1)/2)         # 甲の高さ（かかと側が高い）
def domeZ(u, v):
    rho = (abs(u/(KIN*SA))**SN+abs(v/(KIN*SB*(1+0.10*u/SA)))**SN)**(1/SN)
    if rho >= 1: return HS if rho < 1.12 else 0.0
    return HS+SH(u)*math.sin(math.acos(rho**2))**0.7
def SP(u, v, z, sgn=1): p = PC+EU*u+EV*v; return Vector((sgn*p.x, p.y, z))
def shoe_top(x, y):
    q = Vector((abs(x), y, 0))-PC; return domeZ(q.dot(EU), q.dot(EV))

# ── レッグウォーマー ───────────────────────────────
LW_TOP = 0.418; LW_BOT = 0.062; NL = 64; NZ = 46
def leg_c(z): t = (z-ankle.z)/(knee.z-ankle.z); return Vector((lerp(ankle.x, knee.x, t), lerp(ankle.y, knee.y, t), z))
bm = bmesh.new()
RED_BANDS = ((0.372, 0.392), (0.338, 0.356), (0.170, 0.192), (0.128, 0.148))
for sgn in (1, -1):
    rings = []; zs = []
    for i in range(NZ+1):
        z = lerp(LW_TOP, LW_BOT, i/NZ); zs.append(z); c = leg_c(max(z, 0.125)); row = []
        for j in range(NL):
            a = 2*math.pi*j/NL
            r = min(radial(c, a, 0.06), 0.075)
            ease = lerp(0.005, 0.015, ss((LW_TOP-z)/0.05))+0.026*ss((0.21-z)/0.13)+0.010*ss((0.20-z)/0.11)*max(0, -math.sin(a))
            wr = (0.0030*math.sin(z*2*math.pi/0.052+1.6*math.sin(a+sgn))+0.0016*math.sin(z*2*math.pi/0.031+2.0*math.cos(2*a)))*ss((0.36-z)/0.16)      # たるみのしわ
            rib = 0.0012*math.sin(32*a)
            r += ease+wr+rib
            p = Vector((c.x+r*math.cos(a), c.y+r*math.sin(a), z))
            p.z = max(p.z, shoe_top(p.x, p.y)+0.004+0.0025*(NZ-i))                         # 靴の上にのる
            row.append(Vector((sgn*p.x, p.y, p.z)))
        rings.append(row if sgn > 0 else row[::-1])
    loft(bm, rings, True, lambda i, j: 1 if any(lo <= (zs[i]+zs[i+1])/2 <= hi for lo, hi in RED_BANDS) else 0)
warm = newobj("Jirai_LegWarmers", bm, [RIB, RED])
sm = warm.modifiers.new("Solidify", 'SOLIDIFY'); sm.thickness = 0.004; sm.offset = 1.0
to_hide |= {i for i in range(len(co)) if inb[i] and co[i].z < LW_TOP-0.045 and abs(co[i].x) < 0.30}

# ── 厚底の靴（つま先が赤・ストラップ）─────────────────────
bm = bmesh.new(); NO = 72; TOE_U = 0.056; ST_U = 0.040
for sgn in (1, -1):
    def R(row): return row if sgn > 0 else row[::-1]
    # 靴底
    prof = ((0.0, 0.955), (0.005, 1.0), (HS-0.006, 1.0), (HS, 0.97))
    rings = [R([SP(outline(2*math.pi*k/NO)[0]*s, outline(2*math.pi*k/NO)[1]*s, z, sgn) for k in range(NO)]) for z, s in prof]
    vs = loft(bm, rings, True, lambda i, j: 2)
    fan(bm, vs[0], SP(0, 0, 0, sgn), 2); fan(bm, vs[-1], SP(0, 0, HS, sgn), 2)
    # 甲（ドーム）
    NJ = 14; rings = []; pre = set(bm.faces)
    for q in range(NJ):
        al = (math.pi/2)*q/NJ; rho = math.cos(al)**0.5
        row = []
        for k in range(NO):
            u, v = outline(2*math.pi*k/NO); u *= KIN*rho; v *= KIN*rho
            row.append(SP(u, v, HS-0.001+SH(u)*math.sin(al)**0.7, sgn))
        rings.append(R(row))
    vs = loft(bm, rings, True, lambda i, j: 0)
    fan(bm, vs[-1], SP(0, 0, HS+SH(0), sgn), 0)
    for f in bm.faces:                                   # つま先は赤
        if f in pre: continue
        c = f.calc_center_median()
        if (Vector((abs(c.x), c.y, 0))-PC).dot(EU) > TOE_U: f.material_index = 1
    # ストラップとバックル
    NS_ = 17; wv = KIN*SB*(1+0.10*ST_U/SA)*0.97
    rows = []
    for du, dz in ((-0.011, 0.0005), (-0.008, 0.0045), (0.008, 0.0045), (0.011, 0.0005)):
        rows.append(R([SP(ST_U+du, lerp(-wv, wv, k/(NS_-1)), domeZ(ST_U+du, lerp(-wv, wv, k/(NS_-1))*0.985)+dz, sgn) for k in range(NS_)]))
    loft(bm, rows, False, lambda i, j: 0)
    vb = wv*0.62; box(bm, SP(ST_U, vb, domeZ(ST_U, vb)+0.006, sgn), 0.016, 0.022, 0.004, 3,
                      rot=Matrix.Rotation(-sgn*0.75, 3, 'Y') @ Matrix.Rotation(0, 3, 'Z'))
shoes = newobj("Jirai_Shoes", bm, [BLACKG, REDG, SOLE, SILVER])
for p in shoes.data.polygons: p.use_smooth = p.material_index in (0, 1)

# ── 小物（チョーカー・十字のネックレス・ガーターリング・ばんそうこう）────────
bm = bmesh.new()
# チョーカー
NCK = 40; cn = Vector((0, -0.022, 1.412)); rows = [[], [], [], []]
for j in range(NCK):
    a = 2*math.pi*j/NCK; r = radial(cn, a, 0.05)
    for q, (dz, off) in enumerate(((0.0075, 0.001), (0.0060, 0.0035), (-0.0060, 0.0035), (-0.0075, 0.001))):
        y = cn.y+(r+off)*math.sin(a)
        rows[q].append(Vector(((r+off)*math.cos(a), y, cn.z+dz+0.22*(y-cn.y))))
loft(bm, rows, True, lambda i, j: 0)
# ネックレス（ひも + 十字）
pts = []
for k in range(21):
    s = -1+2*k/20; x = 0.058*s; z = 1.322+0.064*abs(s)**1.5
    loc, nor = front_hit(x, z)
    pts.append(loc+Vector((0, -0.0035, 0)))
tube(bm, pts, 0.0011, 5, 0)
pc = pts[10]+Vector((0, -0.0065, -0.013))
box(bm, pc, 0.0042, 0.003, 0.026, 1); box(bm, pc+Vector((0, 0, 0.004)), 0.016, 0.003, 0.0042, 1)
ring = [pts[10]+Vector((0.003*math.cos(a*math.pi/4), -0.004, 0.003*math.sin(a*math.pi/4))) for a in range(8)]
tube(bm, ring, 0.0008, 4, 1, closed=True)
# ガーターリング（左もも = 向かって右）
GZ = 0.612; NG = 40
def thigh_c(z): t = (z-knee.z)/(hip.z-knee.z); return Vector((lerp(knee.x, hip.x, t), lerp(knee.y, hip.y, t), z))
gc = thigh_c(GZ); rows = [[], [], [], []]; gfront = None
for j in range(NG):
    a = 2*math.pi*j/NG; r = radial(gc, a, 0.08)
    for q, (dz, off) in enumerate(((0.006, 0.0005), (0.0045, 0.0028), (-0.0045, 0.0028), (-0.006, 0.0005))):
        rows[q].append(Vector((gc.x+(r+off)*math.cos(a), gc.y+(r+off)*math.sin(a), GZ+dz)))
    if j == NG*3//4: gfront = Vector((gc.x, gc.y-r-0.006, GZ))
loft(bm, rows, True, lambda i, j: 0)
box(bm, gfront, 0.0055, 0.004, 0.022, 2); box(bm, gfront, 0.022, 0.004, 0.0055, 2)       # 白い十字の飾り
ball(bm, gfront+Vector((0, -0.002, 0)), 0.004, 0.003, 0.004, 1)
# ばんそうこう（右もも = 向かって左）
BX = -0.108; BZ = 0.655; NB = 8; hw = 0.023; ca = math.cos(0.18); sa = math.sin(0.18); gridv = []
for i in range(NB+1):
    row = []
    for k in range(NB+1):
        lx = lerp(-hw, hw, i/NB); lz = lerp(-hw, hw, k/NB)
        loc, nor = front_hit(BX+lx*ca-lz*sa, BZ+lx*sa+lz*ca)
        row.append(bm.verts.new(loc+nor*0.0018))
    gridv.append(row)
for i in range(NB):
    for k in range(NB): bm.faces.new((gridv[i][k], gridv[i+1][k], gridv[i+1][k+1], gridv[i][k+1])).material_index = 2
newobj("Jirai_Accessories", bm, [BLACK, SILVER, WHITE])

# ── ヘッドホン（赤・白い水玉）────────────────────────
bm = bmesh.new()
HC = Vector((0, -0.045, 1.512)); HA = 0.126; HB = 0.152; HW = 0.015; NHB = 48
def hb(phi, extra=0.0): return Vector(((HA+extra)*math.cos(phi), 0, (HB+extra)*math.sin(phi)))
rows = [[] for _ in range(6)]
for k in range(NHB+1):
    phi = lerp(math.radians(8), math.radians(172), k/NHB)
    for q, (dy, ex) in enumerate(((-HW, 0.0), (-HW*0.8, 0.007), (HW*0.8, 0.007), (HW, 0.0), (HW*0.8, -0.002), (-HW*0.8, -0.002))):
        rows[q].append(HC+hb(phi, ex)+Vector((0, dy, 0)))
rows.append(rows[0])
loft(bm, rows, False, lambda i, j: 0)
for k in range(2, NHB-1, 4):                             # 水玉
    phi = lerp(math.radians(8), math.radians(172), (k+0.5)/NHB)
    n = Vector((math.cos(phi)/HA, 0, math.sin(phi)/HB)).normalized()
    c = HC+hb(phi, 0.0072)+Vector((0, 0.005 if (k//4) % 2 else -0.005, 0))
    rot = Matrix((Vector((0, 1, 0)), n.cross(Vector((0, 1, 0))), n)).transposed()
    ball(bm, c, 0.0042, 0.0042, 0.0012, 1, 10, 4, rot=rot)
for sgn in (1, -1):                                      # イヤーカップ
    cx = 0.112; NCU = 28
    prof = ((0.000, 0.036), (0.004, 0.043), (0.016, 0.045), (0.030, 0.043), (0.038, 0.036), (0.042, 0.024))
    rings = [[HC+Vector((sgn*(cx+x), r*math.cos(2*math.pi*k/NCU), -0.012+r*1.12*math.sin(2*math.pi*k/NCU))) for k in range(NCU)] for x, r in prof]
    if sgn < 0: rings = [r[::-1] for r in rings]
    vs = loft(bm, rings, True, lambda i, j: 2 if i == 0 else (0 if i < 4 else 1))
    fan(bm, vs[-1], HC+Vector((sgn*(cx+0.043), 0, -0.012)), 1); fan(bm, vs[0], HC+Vector((sgn*cx, 0, -0.012)), 2)
newobj("Jirai_Headphones", bm, [REDP, WHITE, BLACK])

# ── 体を隠す・前の服を片づける ─────────────────────
body.remove(list(to_hide)); hid.add(list(to_hide), 1.0, 'REPLACE')
hj = ob.vertex_groups.get("hidden_jirai") or ob.vertex_groups.new(name="hidden_jirai")
hj.remove(list(range(len(me.vertices)))); hj.add(list(to_hide), 1.0, 'REPLACE')
CAS = bpy.data.collections.get("Outfit_Casual") or bpy.data.collections.new("Outfit_Casual")
if CAS.name not in bpy.context.scene.collection.children: bpy.context.scene.collection.children.link(CAS)
for n in ("Girl_Sweater", "Girl_Inner", "Girl_Skirt", "Girl_Socks", "Girl_Shoes"):
    o = bpy.data.objects.get(n)
    if not o: continue
    for c in list(o.users_collection): c.objects.unlink(o)
    CAS.objects.link(o); o.hide_viewport = True; o.hide_render = True
print("jirai outfit built. hidden", len(to_hide), {o.name: len(o.data.polygons) for o in COL.objects})
if _rig:                                                 # 作り直した物を骨組みに付け直し、姿勢を元に戻す
    exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bind_rig.py", encoding="utf-8").read(), "bind_rig.py", "exec"), {"__name__": "__main__"})
    _rig.data.pose_position = _pose
