# サングラスをスポーツタイプ（顔に沿ってカーブした一枚レンズ・上だけのフレーム・太めのつる）に作りかえる（Blender の中で exec する）。
#   Swim_Sunglasses の形だけを入れかえる。付いている骨・向きはそのまま。頭の上に載せてある場合は、髪の面に合わせて置き直す。
#   使い方: exec(open(path, encoding="utf-8").read(), {"ON_HEAD": True})
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ON_HEAD = globals().get("ON_HEAD", True)
g = bpy.data.objects["Swim_Sunglasses"]
def mat(name, col, rough, **kw):
    mt = bpy.data.materials.get(name) or bpy.data.materials.new(name); mt.use_nodes = True
    b = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough
    for k, v in kw.items():
        if k in b.inputs: b.inputs[k].default_value = v
    mt.diffuse_color = (*col, 1); mt.use_backface_culling = False; return mt
FRAME = mat("S_GlassFrame", (0.93, 0.92, 0.88), 0.35, **{"Coat Weight": 0.5})
LENS = mat("S_SportLens", (0.04, 0.22, 0.62), 0.10, **{"Metallic": 0.85, "Coat Weight": 1.0})      # 青いミラーレンズ
ACCENT = bpy.data.materials.get("S_Blue") or mat("S_Blue", (0.05, 0.35, 0.85), 0.4)

# 形はローカル座標で作る：X = 左右、Y = 前後（-Y がレンズの表）、Z = 上下。原点は鼻の上（レンズのまん中）
R = 0.105; A = math.radians(37); NA = 44; NZ = 6          # レンズの曲がりの半径・片側の角度
def arc(a): return Vector((R*math.sin(a), R*(1-math.cos(a)), 0))
def ztop(a): return 0.019-0.005*(a/A)**2
def zbot(a): return -0.021+0.013*(abs(a)/A)**1.6+0.013*math.exp(-(a/math.radians(5.5))**2)      # 端へ向かって細く、まん中は鼻の切れこみ
bm = bmesh.new()
grid = []
for i in range(NA+1):
    a = -A+2*A*i/NA; col = []
    for j in range(NZ+1):
        t = j/NZ; p = arc(a); p.z = zbot(a)+(ztop(a)-zbot(a))*t; p.y -= 0.0025*math.sin(math.pi*t)      # 縦にも少しふくらませる
        col.append(bm.verts.new(p))
    grid.append(col)
for i in range(NA):
    for j in range(NZ): bm.faces.new((grid[i][j], grid[i+1][j], grid[i+1][j+1], grid[i][j+1])).material_index = 1
def tube(pts, rx, rz, mi, seg=10):
    """だ円の断面の管（rx … 左右・前後方向の半径、rz … 上下方向の半径）"""
    rings = []; n = len(pts)
    for i, p in enumerate(pts):
        a = pts[max(i-1, 0)]; b = pts[min(i+1, n-1)]; t = (b-a).normalized()
        u = Vector((0, 0, 1)); u = (u-t*u.dot(t)).normalized(); w = t.cross(u)
        rings.append([bm.verts.new(p+u*rz*math.sin(k*2*math.pi/seg)+w*rx*math.cos(k*2*math.pi/seg)) for k in range(seg)])
    for i in range(n-1):
        for k in range(seg): bm.faces.new((rings[i][k], rings[i][(k+1) % seg], rings[i+1][(k+1) % seg], rings[i+1][k])).material_index = mi
    for ring, c in ((rings[0], pts[0]), (rings[-1], pts[-1])):
        cv = bm.verts.new(c)
        for k in range(seg): bm.faces.new((ring[k], ring[(k+1) % seg], cv)).material_index = mi
# 上のフレーム（レンズの上のふちに沿う太い帯）
top = []
for i in range(NA+1):
    a = -A+2*A*i/NA; p = arc(a); p.z = ztop(a)+0.0012; p.y -= 0.0008; top.append(p)
tube(top, 0.0030, 0.0036, 0)
# 鼻あて
for s in (1, -1):
    a = s*math.radians(4.2); p = arc(a); tube([Vector((p.x, p.y+0.001, zbot(a)+0.001)), Vector((p.x+s*0.003, p.y+0.007, zbot(a)-0.006))], 0.0016, 0.0016, 0, seg=6)
# つる（太めで、先は青）
for s in (1, -1):
    h = arc(s*A); h.z = ztop(A)-0.003
    pts = [h+Vector((0, -0.002, 0)), h+Vector((s*0.004, 0.022, 0.0)), h+Vector((s*0.005, 0.060, -0.001)), h+Vector((s*0.004, 0.088, -0.004))]
    tube(pts, 0.0022, 0.0052, 0)
    tube([pts[-1], h+Vector((s*0.002, 0.108, -0.010)), h+Vector((s*0.000, 0.120, -0.017))], 0.0024, 0.0044, 2)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00005)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
mesh = bpy.data.meshes.new("Swim_Sunglasses"); bm.to_mesh(mesh); bm.free()
for p in mesh.polygons: p.use_smooth = True
for m_ in (FRAME, LENS, ACCENT): mesh.materials.append(m_)
old = g.data; g.data = mesh
if old.users == 0: bpy.data.meshes.remove(old)

# 頭の上に載せてある場合：レンズが髪にもぐらないよう、髪の面に合わせて置き直す
hair = next((o for o in bpy.data.objects if o.name.startswith("Girl_Hair") and o.type == 'MESH' and not o.hide_viewport), None)
if ON_HEAD and hair and g.parent_bone == "head":
    bpy.context.view_layer.update()
    bvh = BVHTree.FromObject(hair, bpy.context.evaluated_depsgraph_get())
    ns = []
    for x in (-0.03, 0, 0.03):
        for z in (1.60, 1.615, 1.63):
            hh = bvh.ray_cast(Vector((x, -0.5, z)), Vector((0, 1, 0)))
            if hh[0] is not None: ns.append(hh[1] if hh[1].y < 0 else -hh[1])
    n = sum(ns, Vector()).normalized()
    xax = Vector((1, 0, 0)); yax = -n; yax.x = 0; yax.normalize(); zax = xax.cross(yax)
    M = Matrix((xax, yax, zax)).transposed().to_4x4(); o = Vector((0, -0.128, 1.614)); M.translation = o
    s = -1.0
    for v in mesh.vertices:
        p = M @ v.co
        if v.co.y > 0.03 or (v.co.y > 0.0008 and abs(v.co.x) < 0.014): continue      # つると鼻あては髪の中へ入ってよい
        hh = bvh.ray_cast(p-yax*0.15, yax)
        if hh[0] is not None: s = max(s, 0.15-hh[3]+0.0005)
    M.translation = o-yax*s; g.matrix_world = M
    print("placed on head. shift mm", round(s*1000, 1))
print("sport sunglasses built", len(mesh.vertices))
