# 参考写真のポーズ（両手をおなかの前へ出して、サングラスを持つ）を付ける（Blender の中で exec する）。
#   make_rig.py のあとに実行する。姿勢を戻すときは RESET = True で実行する（サングラスも消す）。
#   使い方: exec(open(path, encoding="utf-8").read(), {"RESET": False})
# 骨は「先を向けたい方向」を指定して回す。指は少し曲げる。
# サングラス（Swim_Sunglasses）は白いフレームに濃いレンズ。左手の骨に付けるので、手を動かせばついてくる。
import bpy, bmesh, math
from mathutils import Vector, Matrix, Quaternion

RESET = globals().get("RESET", False)
rig = bpy.data.objects["Girl_Rig"]; P = rig.pose.bones
rig.data.pose_position = 'POSE'
old = bpy.data.objects.get("Swim_Sunglasses")
if old: bpy.data.objects.remove(old, do_unlink=True)
for pb in P: pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
bpy.context.view_layer.update()

def aim(name, direction):
    """骨の向き（根元 → 先）を、指定した方向へ向ける"""
    pb = P[name]; d0 = (pb.tail-pb.head).normalized(); q = d0.rotation_difference(Vector(direction).normalized())
    pb.matrix = Matrix.Translation(pb.head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-pb.head) @ pb.matrix
    bpy.context.view_layer.update()
def aim_at(name, point): aim(name, Vector(point)-P[name].head)
def curl(name, angle, toward):
    """指を曲げる。toward（基本の姿勢での向き）のほうへ指先が動くように、骨のローカル X か Z のどちらで回すかを選ぶ"""
    rb = rig.data.bones[name]; dvec = (rb.tail_local-rb.head_local); _m = rb.matrix_local.to_3x3()     # 軸は骨組みの座標で見る（rb.x_axis は親の骨から見た向きなので、指が逆へ反る）
    best = None
    for ax_name, ax in (("X", _m.col[0]), ("Z", _m.col[2])):
        for sg in (1, -1):
            sc = (sg*ax).cross(dvec).dot(toward)         # この軸で正に回したとき、指先が toward へ動く量
            if best is None or sc > best[0]: best = (sc, ax_name, sg)
    axis = (1, 0, 0) if best[1] == "X" else (0, 0, 1)
    pb = P[name]; pb.rotation_quaternion = pb.rotation_quaternion @ Quaternion(axis, best[2]*angle); bpy.context.view_layer.update()
def rest_dirs(side):
    """基本の姿勢での、手のひらの向き（指を曲げる方向）と、親指を閉じる方向"""
    Bn = rig.data.bones
    fwd = (Bn[side+"MiddleProximal"].head_local-Bn[side+"Hand"].head_local).normalized()
    across = (Bn[side+"LittleProximal"].head_local-Bn[side+"IndexProximal"].head_local).normalized()
    palm = fwd.cross(across).normalized()
    if palm.z > 0: palm = -palm                          # 基本の姿勢では手のひらは下向き
    thumb = (Bn[side+"IndexProximal"].head_local-Bn[side+"ThumbProximal"].head_local).normalized()+palm*0.8
    return palm, thumb.normalized()

if not RESET:
    GZ = 1.035                                           # サングラスを持つ高さ
    for side, s in (("left", 1), ("right", -1)):
        aim(side+"Shoulder", (s*1.0, -0.05, -0.10))
        aim(side+"UpperArm", (s*0.20, 0.06, -1.0))                       # 上腕は下へ（ひじを少し外・後ろへ）
        aim_at(side+"LowerArm", (s*0.105, -0.200, GZ))                   # 前腕はおなかの前へ
        aim(side+"Hand", (-s*0.42, -0.80, 0.22))                         # 手先は内側・前へ
        palm, thumb_in = rest_dirs(side)
        for f, k in (("Index", 0.85), ("Middle", 1.0), ("Ring", 1.1), ("Little", 1.15)):      # 小指側ほど深く握る
            for seg, a in (("Proximal", 0.75), ("Intermediate", 0.95), ("Distal", 0.55)): curl(side+f+seg, a*k, palm)
        for seg, a in (("Metacarpal", 0.35), ("Proximal", 0.30), ("Distal", 0.35)): curl(side+"Thumb"+seg, a, thumb_in)
    bpy.context.view_layer.update()

    # ── サングラス ──
    def mat(name, col, rough, **kw):
        mt = bpy.data.materials.get(name) or bpy.data.materials.new(name); mt.use_nodes = True
        b = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough
        for k, v in kw.items():
            if k in b.inputs: b.inputs[k].default_value = v
        mt.diffuse_color = (*col, 1); return mt
    FRAME = mat("S_GlassFrame", (0.93, 0.92, 0.88), 0.35, **{"Coat Weight": 0.5})
    LENS = mat("S_GlassLens", (0.02, 0.035, 0.06), 0.06, **{"Coat Weight": 1.0})
    bm = bmesh.new()
    def loop_tube(pts, r, mi, closed=True, seg=8):
        n = len(pts); rings = []; prev = None
        for i, p in enumerate(pts):
            a = pts[(i-1) % n] if (closed or i > 0) else p; b = pts[(i+1) % n] if (closed or i < n-1) else p
            t = (b-a).normalized(); u = (prev-t*prev.dot(t)) if prev is not None else t.orthogonal(); u.normalize(); prev = u; w = t.cross(u)
            rings.append([bm.verts.new(p+(u*math.cos(k*2*math.pi/seg)+w*math.sin(k*2*math.pi/seg))*r) for k in range(seg)])
        for i in range(n if closed else n-1):
            a, b = rings[i], rings[(i+1) % n]
            for k in range(seg): bm.faces.new((a[k], a[(k+1) % seg], b[(k+1) % seg], b[k])).material_index = mi
        if not closed:
            for ring, c in ((rings[0], pts[0]), (rings[-1], pts[-1])):
                cv = bm.verts.new(c)
                for k in range(seg): bm.faces.new((ring[k], ring[(k+1) % seg], cv)).material_index = mi
    # 形はローカル座標で作る：X = 左右、Y = 前後（-Y がレンズの表）、Z = 上下
    LR = 0.027; LX = 0.034; NS = 28
    for s in (1, -1):
        ring = [Vector((s*LX+LR*1.06*math.cos(a), 0, LR*math.sin(a))) for a in [2*math.pi*k/NS for k in range(NS)]]
        loop_tube(ring, 0.0030, 0)
        c = bm.verts.new((s*LX, -0.0006, 0)); lv = [bm.verts.new(p*1.0+Vector((0, -0.0006, 0))) for p in ring]
        for k in range(NS): bm.faces.new((lv[k], lv[(k+1) % NS], c)).material_index = 1
        hinge = Vector((s*(LX+LR*1.06), 0, 0.006))
        loop_tube([hinge, hinge+Vector((s*0.004, 0.02, 0.001)), hinge+Vector((s*0.005, 0.085, 0.0)), hinge+Vector((s*0.003, 0.118, -0.012))], 0.0024, 0, closed=False)   # つる
    loop_tube([Vector((-(LX-LR), 0, 0.006)), Vector((0, -0.002, 0.011)), Vector((LX-LR, 0, 0.006))], 0.0026, 0, closed=False)                                      # ブリッジ
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new("Swim_Sunglasses"); bm.to_mesh(mesh); bm.free()
    for p in mesh.polygons: p.use_smooth = True
    mesh.materials.append(FRAME); mesh.materials.append(LENS)
    g = bpy.data.objects.new("Swim_Sunglasses", mesh)
    (bpy.data.collections.get("Outfit_Swim") or bpy.context.scene.collection).objects.link(g)
    # 両手の間に置く：レンズを前・少し上へ向け、つるは体のほうへ
    def grip(side): return (Vector(P[side+"ThumbDistal"].tail)+Vector(P[side+"IndexIntermediate"].head))/2     # 親指と人さし指ではさむ所
    hl = grip("left"); hr = grip("right"); mid = (hl+hr)/2
    xax = (Vector(hl)-Vector(hr)).normalized(); yax = Vector((0, 0.80, 0.60)); yax = (yax-xax*yax.dot(xax)).normalized(); zax = xax.cross(yax)
    M = Matrix((xax, yax, zax)).transposed().to_4x4(); M.translation = mid+Vector((0, 0.0, 0.004))
    g.parent = rig; g.parent_type = 'BONE'; g.parent_bone = "leftHand"; bpy.context.view_layer.update()
    g.matrix_world = M
print("pose", "reset" if RESET else "sunglasses", "hands", tuple(round(a, 3) for a in P["leftHand"].tail), tuple(round(a, 3) for a in P["rightHand"].tail))
