# 服・髪・小物を骨組み（Girl_Rig）に追従させる（Blender の中で exec する）。make_rig.py のあとに実行する。
# 服や髪のスクリプトはオブジェクトを作り直すので、作り直したあとにもう一度これを実行する（各スクリプトの最後で自動で呼ぶ）。
#   服：いちばん近い体の頂点（6 点）のウェイトを、距離で重みをつけて写す
#   髪：上は頭の骨、耳から下は髪の揺れ骨（hairSwing。いつも真下を向く）
#   眉・ヘッドホン：頭の骨だけに付ける（形をくずさない）
import bpy, math, numpy as np
from mathutils import kdtree

rig = bpy.data.objects.get("Girl_Rig")
if rig:
    body = bpy.data.objects["Girl_Body"]; me = body.data
    bones = [b.name for b in rig.data.bones]
    was = rig.data.pose_position; rig.data.pose_position = 'REST'; bpy.context.view_layer.update()
    mk = next(m for m in body.modifiers if m.type == 'MASK'); mk.show_viewport = False; bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get(); e = body.evaluated_get(dg); m = e.to_mesh()
    co = [v.co.copy() for v in m.vertices]; e.to_mesh_clear(); mk.show_viewport = True
    gidx = {g.index: g.name for g in body.vertex_groups if g.name in bones}
    bi = {n: i for i, n in enumerate(bones)}
    src = []; Wb = []
    for v in me.vertices:
        w = np.zeros(len(bones))
        for g in v.groups:
            if g.group in gidx: w[bi[gidx[g.group]]] = g.weight
        if w.sum() > 1e-6: src.append(v.index); Wb.append(w/w.sum())
    Wb = np.array(Wb)
    kd = kdtree.KDTree(len(src))
    for j, i in enumerate(src): kd.insert(co[i], j)
    kd.balance()
    HEAD_ONLY = ("Girl_Hair", "Girl_Brows", "Girl_MouthBag", "Jirai_Headphones")
    n_done = 0
    for o in bpy.data.objects:
        if o.type != 'MESH' or o is body or o.parent_type == 'BONE': continue      # 骨に直接付けた小物（サングラスなど）はそのまま
        for g in [g for g in o.vertex_groups if g.name in bones]: o.vertex_groups.remove(g)
        mw = o.matrix_world
        if o.name.startswith("Girl_Hair") and "hairSwing" in bones:
            # 髪：上は頭に固定、耳の高さから下は「揺れ骨」へなだらかに移す（頭を傾けても、下のほうは真下へ垂れる）
            zs = rig.data.bones["hairSwing"].head_local.z+0.012; gh = o.vertex_groups.new(name="head"); gs = o.vertex_groups.new(name="hairSwing")
            for v in o.data.vertices:
                t = min(1.0, max(0.0, (zs-(mw @ v.co).z)/0.085)); w = t*t*(3-2*t)
                gh.add([v.index], 1.0-w, 'REPLACE'); gs.add([v.index], w, 'REPLACE')
        elif o.name.startswith(HEAD_ONLY):
            o.vertex_groups.new(name="head").add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
        else:
            pts = [mw @ v.co for v in o.data.vertices]; Wc = np.zeros((len(pts), len(bones)))
            for i, p in enumerate(pts):
                near = kd.find_n(p, 6)
                ws = np.array([1.0/(dd*dd+1e-8) for _, _, dd in near]); ws /= ws.sum()
                Wc[i] = sum(Wb[j]*k for (_, j, _), k in zip(near, ws))
            if "Skirt" in o.name and "leftUpperLeg" in bi:
                # スカート：いちばん近い体のウェイトを写すだけだと、上のほうが腰だけに付き、脚を上げたときに太ももが突きぬける。
                # ウエストは腰に、そこから下は腰 3：脚 7 くらいで付ける（左右は中央でなだらかに分ける）。
                # 脚を上げると、スカートは腰から垂れたまま、太ももに押された所だけ持ち上がる
                SKIRT_LEG = 0.72                      # 脚に付ける割合。残りは腰。太ももが突きぬける所は、下の「めり込み防止」が外へ押し出す。
                                                      # 0.4 だと太ももの奥まで入りこみ、反対側へ押し出されて穴があいた
                ztop = max(p.z for p in pts); Wc[:] = 0
                for i, p in enumerate(pts):
                    t = min(1.0, max(0.0, (ztop-p.z)/0.055)); wl = t*t*(3-2*t)*SKIRT_LEG
                    u = min(1.0, max(0.0, (p.x+0.05)/0.10)); lf = u*u*(3-2*u)          # +X が本人の左
                    Wc[i, bi["hips"]] = 1-wl; Wc[i, bi["leftUpperLeg"]] = wl*lf; Wc[i, bi["rightUpperLeg"]] = wl*(1-lf)
            acc = {}
            for i in range(len(pts)):
                w = Wc[i].copy(); w[w < 0.02] = 0; w /= w.sum()
                for bb in np.nonzero(w)[0]: acc.setdefault(int(bb), []).append((i, float(w[bb])))
            for bb, lst in acc.items():
                g = o.vertex_groups.new(name=bones[bb])
                for i, w in lst: g.add([i], w, 'REPLACE')
        md = next((x for x in o.modifiers if x.type == 'ARMATURE'), None) or o.modifiers.new("Armature", 'ARMATURE')
        md.object = rig
        k = list(o.modifiers).index(md)
        if k > 0: o.modifiers.move(k, 0)                 # 厚みづけ（Solidify）などより先に、骨で動かす
        if o.parent is not rig: o.parent = rig; o.matrix_parent_inverse = rig.matrix_world.inverted()
        o.data.update(); o.update_tag()                 # ウェイトを書きかえただけでは画面に反映されないので、作り直しを知らせる
        n_done += 1
    # ── めり込み防止（MK_PushOut）──
    # 骨で動かしたあと、相手（体・スパッツなど）の内側に入った頂点だけを、相手の表面から少し外へ押し出す。
    # 布や髪の物理計算の代わり：スカートは上げた太ももに乗り、髪は傾けた顔や肩をよける。フレームに関係なく、姿勢だけで決まる
    def pushout_group():
        ng = bpy.data.node_groups.get("MK_PushOut")
        if ng: bpy.data.node_groups.remove(ng)
        ng = bpy.data.node_groups.new("MK_PushOut", 'GeometryNodeTree'); N = ng.nodes; L = ng.links
        ng.interface.new_socket("Geometry", in_out='INPUT', socket_type='NodeSocketGeometry')
        ng.interface.new_socket("Target A", in_out='INPUT', socket_type='NodeSocketObject')
        ng.interface.new_socket("Target B", in_out='INPUT', socket_type='NodeSocketObject')
        s_m = ng.interface.new_socket("Margin", in_out='INPUT', socket_type='NodeSocketFloat'); s_m.default_value = 0.007
        ng.interface.new_socket("Geometry", in_out='OUTPUT', socket_type='NodeSocketGeometry')
        gi_ = N.new("NodeGroupInput"); go_ = N.new("NodeGroupOutput")
        oa = N.new("GeometryNodeObjectInfo"); oa.transform_space = 'RELATIVE'; ob_ = N.new("GeometryNodeObjectInfo"); ob_.transform_space = 'RELATIVE'
        L.new(gi_.outputs["Target A"], oa.inputs["Object"]); L.new(gi_.outputs["Target B"], ob_.inputs["Object"])
        jn = N.new("GeometryNodeJoinGeometry"); L.new(oa.outputs["Geometry"], jn.inputs[0]); L.new(ob_.outputs["Geometry"], jn.inputs[0])
        px = N.new("GeometryNodeProximity"); px.target_element = 'FACES'; L.new(jn.outputs[0], px.inputs[0])
        nm = N.new("GeometryNodeInputNormal"); sn = N.new("GeometryNodeSampleNearestSurface"); sn.data_type = 'FLOAT_VECTOR'
        L.new(jn.outputs[0], sn.inputs["Mesh"]); L.new(nm.outputs["Normal"], sn.inputs["Value"])
        ps = N.new("GeometryNodeInputPosition")
        df = N.new("ShaderNodeVectorMath"); df.operation = 'SUBTRACT'; L.new(ps.outputs[0], df.inputs[0]); L.new(px.outputs["Position"], df.inputs[1])
        dt = N.new("ShaderNodeVectorMath"); dt.operation = 'DOT_PRODUCT'; L.new(df.outputs["Vector"], dt.inputs[0]); L.new(sn.outputs["Value"], dt.inputs[1])
        c1 = N.new("FunctionNodeCompare"); c1.data_type = 'FLOAT'; c1.operation = 'LESS_THAN'; L.new(dt.outputs["Value"], c1.inputs[0]); L.new(gi_.outputs["Margin"], c1.inputs[1])
        c2 = N.new("FunctionNodeCompare"); c2.data_type = 'FLOAT'; c2.operation = 'LESS_THAN'; L.new(px.outputs["Distance"], c2.inputs[0]); c2.inputs[1].default_value = 0.08
        an = N.new("FunctionNodeBooleanMath"); an.operation = 'AND'; L.new(c1.outputs[0], an.inputs[0]); L.new(c2.outputs[0], an.inputs[1])
        sc = N.new("ShaderNodeVectorMath"); sc.operation = 'SCALE'; L.new(sn.outputs["Value"], sc.inputs[0]); L.new(gi_.outputs["Margin"], sc.inputs["Scale"])
        ad = N.new("ShaderNodeVectorMath"); ad.operation = 'ADD'; L.new(px.outputs["Position"], ad.inputs[0]); L.new(sc.outputs["Vector"], ad.inputs[1])
        # 押し出した頂点と、そのまわりの動かなかった頂点の間に段ができないよう、押し出し量をまわりへぼかして伝える
        of = N.new("ShaderNodeVectorMath"); of.operation = 'SUBTRACT'; L.new(ad.outputs["Vector"], of.inputs[0]); L.new(ps.outputs[0], of.inputs[1])
        z0 = N.new("GeometryNodeSwitch"); z0.input_type = 'VECTOR'; L.new(an.outputs[0], z0.inputs["Switch"]); L.new(of.outputs["Vector"], z0.inputs["True"])
        bl = N.new("GeometryNodeBlurAttribute"); bl.data_type = 'FLOAT_VECTOR'; L.new(z0.outputs["Output"], bl.inputs["Value"]); bl.inputs["Iterations"].default_value = 4
        fn = N.new("GeometryNodeSwitch"); fn.input_type = 'VECTOR'; L.new(an.outputs[0], fn.inputs["Switch"]); L.new(bl.outputs["Value"], fn.inputs["False"]); L.new(of.outputs["Vector"], fn.inputs["True"])
        sp = N.new("GeometryNodeSetPosition"); L.new(gi_.outputs["Geometry"], sp.inputs["Geometry"]); L.new(fn.outputs["Output"], sp.inputs["Offset"])
        L.new(sp.outputs["Geometry"], go_.inputs["Geometry"])
        return ng
    ng = pushout_group()
    ids = {it.name: it.identifier for it in ng.interface.items_tree if it.item_type == 'SOCKET' and it.in_out == 'INPUT'}
    def add_pushout(o, ta, tb, margin):
        for mdx in [x for x in o.modifiers if x.type == 'NODES' and x.name == "PushOut"]: o.modifiers.remove(mdx)
        mdx = o.modifiers.new("PushOut", 'NODES'); mdx.node_group = ng
        pin = mdx.properties.inputs                      # Blender 5 では、入力は properties.inputs.<識別子>.value で入れる
        getattr(pin, ids["Target A"]).value = ta; getattr(pin, ids["Target B"]).value = tb; getattr(pin, ids["Margin"]).value = margin
        o.modifiers.move(len(o.modifiers)-1, 1)          # 骨（Armature）のすぐあと、厚みづけ（Solidify）より前
    top_now = next((bpy.data.objects.get(n) for n in ("Swim_Top", "Jirai_Top", "Girl_Sweater") if bpy.data.objects.get(n) and not bpy.data.objects[n].hide_viewport), None)
    for o in bpy.data.objects:
        if o.type != 'MESH' or o.parent is not rig: continue
        if "Skirt" in o.name:
            pre = o.name.split("_")[0]; under = bpy.data.objects.get(pre+"_Shorts") or bpy.data.objects.get(pre+"_Inner")
            add_pushout(o, body, under, 0.011)
        elif o.name.startswith("Girl_Hair"):
            add_pushout(o, body, top_now, 0.003)       # 髪は基本の姿勢でも肌のすぐ近くにあるので、小さめにする
    rig.data.pose_position = was
    print("bound to rig:", n_done, "objects")
