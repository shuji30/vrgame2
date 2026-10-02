# VR Arcade

ブラウザと VR ヘッドセット（Meta Quest など）で遊べる WebXR ゲーム集です。ビルド不要の静的サイトです。

**プレイ:** https://shuji30.github.io/vrgame2/ （ゲーム選択画面）

| # | ゲーム | パス |
| --- | --- | --- |
| 1 | BEAT BLADE VR | [`games/beat-blade/`](games/beat-blade/) |
| 2 | TURBO KART VR | [`games/turbo-kart/`](games/turbo-kart/) |
| 3 | ふたりの休日 〜海の見える丘で〜 | https://shuji30.github.io/vrsample/ （外部リンク） |

ゲームを追加するときは `games/<名前>/` にフォルダを作り、トップの `index.html` の `GAMES` 配列に 1 行足します。

---

# 1. BEAT BLADE VR

Three.js + WebXR で動く、Beat Saber 風のリズム斬りゲームです。

## 遊び方

- ゲーム内メニュー左上の「◀ GAMES」でゲーム選択画面に戻れます
- 赤いノーツは左手、青いノーツは右手で、矢印の方向へ振って斬ります（丸印はどの方向でも可）
- 黒い爆弾は斬らない。ピンクの壁は体（頭）を動かして避ける
- ミスや爆弾でエネルギーが減り、0 になると失敗（NO FAIL で無効化）
- 連続で斬ると倍率が ×2 → ×4 → ×8 と上がります。1 ノーツ最大 115 点（振りの大きさ 70 + 角度 30 + 中心精度 15）

### VR

1. Quest のブラウザで上の URL を開き、「ENTER VR」を押す
2. コントローラーのレイでメニューを選び、トリガーで決定
3. プレイ中は A / B / X / Y ボタンでポーズ

### PC（デスクトップ）

- マウスで刀を動かして斬ります（デスクトップでは 1 本の刀が両方の色を斬れます）
- `Enter` 開始 / `Esc` ポーズ / `R` リトライ / `M` メニュー
- AUTO PLAY をオンにするとお手本の自動プレイを見られます

## 収録曲と難易度

曲は WebAudio でリアルタイムに合成し、譜面も曲の構成（盛り上がり）から自動生成しています。外部の音源ファイルは使っていません。

| 曲 | BPM | 長さ |
| --- | --- | --- |
| Starlight Run | 100 | 1:36 |
| Neon Pulse | 128 | 1:30 |
| Crimson Drive | 140 | 1:36 |

難易度は Easy / Normal / Hard / Expert の 4 段階です。Hard 以上では爆弾と壁が出ます。

## 開発

```bash
npm start      # http://localhost:8080/ でローカル実行
npm test       # 判定ロジックと全譜面のテスト
node games/beat-blade/analyze.mjs   # 全譜面の統計とオートプレイ結果
```

WebXR は HTTPS（または localhost）が必要です。動作確認用の URL パラメータ: `games/beat-blade/?song=1&diff=expert&autoplay=1&autostart=1`

### 構成（`games/beat-blade/` 以下）

- `src/core/` — three.js に依存しない純粋ロジック（判定・譜面生成・スコア・オートプレイ）。node でテストできる
- `src/scene/` — 3D 表示（ステージ、刀、ノーツ、エフェクト、UI パネル）
- `src/audio.js` — 曲の合成と効果音
- `src/game.js` — 状態遷移と入力（VR コントローラー / マウス）
- `tests/` — `node --test` のテスト。全曲 × 全難易度をオートプレイでシミュレーションし、全ノーツを正しく斬れること（取りこぼし・誤切断・爆弾・壁の接触がゼロ）を検証する

---

# 2. TURBO KART VR

NPC 10 台と競うカートレースです。コース「Thunder Ring」（1.3km）には、デイトナ風のバンク、シケイン、丘の上のダート S 字、ヘアピン、荒れたターマックの下り、最大 10m のアップダウンがあります。

- **操作**：キーボード / ゲームパッド / ハンコン（ペダル・パドルシフト・H シフター・USB サイドブレーキ）
- **AT / MT**：MT はパドルまたは H シフターで変速
- **ドリフト**：サイドブレーキで横滑りし、離すとミニターボ
- **FFB**：セルフアライニングトルク、路面の凹凸（バンプステア）、縁石・ダートの振動、衝突、ソフトロック。PC で [デバイスブリッジ](ffb-bridge/) を動かすと出力されます
- **VR**：着座のコックピット視点。ハンドル中央のダッシュボードに速度・ギア・順位を表示します

確認用の URL パラメータ：`games/turbo-kart/?autostart=1&autodrive=1&cam=cockpit`

```bash
node games/turbo-kart/analyze.mjs normal   # NPC だけのレースの統計
```
