# 顔の模様（瞳・メイク・まつ毛・唇の色）が、骨で顔を動かしてもずれないようにする（Blender の中で exec する）。
#   模様は「頂点の位置」から描いている。骨で頭を動かすと位置が変わって、瞳やチークが顔からずれてしまう。
#   そこで、基本の姿勢での位置を頂点ごとの属性 "mk_pos" に書きこみ、マテリアルはその属性を見るようにする。
# 顔の形（シェイプキー）を変えたら実行し直す（fit_face.py・make_makeup_jirai.py・make_rig.py の最後で自動で呼ぶ）。
import bpy

body = bpy.data.objects["Girl_Body"]; me = body.data
rig = bpy.data.objects.get("Girl_Rig"); was = rig.data.pose_position if rig else None
if rig: rig.data.pose_position = 'REST'
mk = next(m for m in body.modifiers if m.type == 'MASK'); mk.show_viewport = False; bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); e = body.evaluated_get(dg); m = e.to_mesh()
flat = [0.0]*(len(m.vertices)*3); m.vertices.foreach_get("co", flat); e.to_mesh_clear(); mk.show_viewport = True
if rig: rig.data.pose_position = was
at = me.attributes.get("mk_pos") or me.attributes.new("mk_pos", 'FLOAT_VECTOR', 'POINT')
at.data.foreach_set("vector", flat); me.update()
n = 0
for slot in body.material_slots:                         # 位置を見ているノードを、属性を見るように付け替える
    mt = slot.material
    if not mt or not mt.node_tree: continue
    nt = mt.node_tree
    for g in [x for x in nt.nodes if x.type == 'NEW_GEOMETRY']:
        links = list(g.outputs["Position"].links)
        if not links: continue
        a = nt.nodes.get("MkRestPos") or nt.nodes.new("ShaderNodeAttribute")
        a.name = "MkRestPos"; a.label = "基本の姿勢での位置"; a.attribute_type = 'GEOMETRY'; a.attribute_name = "mk_pos"; a.location = (g.location.x, g.location.y-160)
        for l in links: nt.links.new(a.outputs["Vector"], l.to_socket); n += 1
print("face positions baked. relinked", n)
