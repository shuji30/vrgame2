# 女の子のモデル（Blender）

`girl.blend` は、Blender で作っている女の子のモデルです。作業の元は `C:\Users\shuji\Documents\girl-blender` にあり、ここはその写しです。
ゲームのサイトには配信しません（`scripts/deploy.mjs` の対象外）。

## 入っている物

- 体（`Girl_Body`）と、人型の骨組み（`Girl_Rig`。骨の名前は VRM と同じ）
- コーデ：水着のスポーティ（`Outfit_Swim`。いま表示）／ 地雷系（`Outfit_Jirai`）／ カジュアル（`Outfit_Casual`）／ 黒（`Outfit_Black`）
- 髪：ボブ（`Girl_HairBob`。いま表示）／ ツインテール（`Girl_HairTwin`）／ お団子（`Girl_HairBun`）／ 元の髪（`Girl_Hair`）
- いまの姿勢は、両手でサングラスを持つポーズ

## スクリプト（`scripts/`）

Blender の中で `exec(open(パス, encoding="utf-8").read())` で実行します。
スクリプトの中のパスは `C:\Users\shuji\Documents\girl-blender\scripts\` を指しているので、別の場所で使うときは書きかえてください。

| ファイル | すること |
| --- | --- |
| `make_outfit_swim.py` / `make_outfit_jirai.py` / `make_outfit_casual.py` | 服を作り直す |
| `make_hair_bob.py` / `make_hair_twin.py` / `make_hair_bun.py` / `make_hair.py` | 髪を作り直す |
| `make_makeup_jirai.py` | メイク（チーク・アイライン・唇・瞳の色など） |
| `fit_face.py` / `set_eye_tilt.py` | 顔の形を変えたあとの合わせ直し、目尻の上げ下げ |
| `set_bust.py` | 胸の大きさ |
| `make_rig.py` / `bind_rig.py` | 骨組みを作る、服・髪を骨に付け直す（めり込み防止を含む） |
| `bake_face_pos.py` | 顔の模様が、頭を動かしてもずれないようにする |
| `make_pose_sunglasses.py` | サングラスを持つポーズ（`RESET = True` で基本の姿勢に戻す） |

服や髪のスクリプトは、最後に `bind_rig.py` を自動で実行します。
