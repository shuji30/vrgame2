# VR Arcade

ブラウザと VR ヘッドセット（Meta Quest など）で遊べる WebXR ゲーム集です。ビルド不要の静的サイトです。

**プレイ:** https://shuji30.github.io/vrgame2/ （ゲーム選択画面）

| # | ゲーム | パス |
| --- | --- | --- |
| 1 | BEAT BLADE VR | [`games/beat-blade/`](games/beat-blade/) |
| 2 | TURBO KART VR | [`games/turbo-kart/`](games/turbo-kart/) |
| 3 | SKY RUNNER XR（開発中） | [`games/sky-runner/`](games/sky-runner/) （開発は [vrgame4](../vrgame4) で行い、`node scripts/publish.mjs` でコピー） |
| 4 | TREAD REVOLT 〜履帯の反攻〜（開発中） | [`games/tread-revolt/`](games/tread-revolt/) （開発は [vrgame5](../vrgame5) で行い、`node scripts/publish.mjs` でコピー） |
| 5 | ふたりの休日 〜海の見える丘で〜 | https://shuji30.github.io/vrsample/ （外部リンク） |

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
- **SimHub**：デバイスブリッジが車の動き・回転数・ラップなどを Forza Data Out 形式（UDP 5300）で送ります。SimHub でゲームを「Forza Motorsport 7」にすると、モーションシート・バスシェイカー・ダッシュボードが動きます
- **VR**：着座のコックピット視点。ハンドル中央のダッシュボードに速度・ギア・順位を表示します
- **モード**：🎉 パーティー（アイテム・コイン・動物キャラ）／🏁 本格（写実的な見た目）／🕹️ アーケード（ローポリの見た目。1 周を 3 区間に分け、チェックポイントを通るたびに残り時間が延びる。0 になるとタイムオーバー。持ち時間はコースの曲がり具合と車種・NPC の強さから決まる。ひとりで走るときだけ）

確認用の URL パラメータ：`games/turbo-kart/?autostart=1&autodrive=1&cam=cockpit&mode=arcade`（`mode` は `party` / `real` / `arcade`、`vehicle=gt3` などで車種も選べます）

```bash
node games/turbo-kart/analyze.mjs normal   # NPC だけのレースの統計
```

## オンライン対戦（最大 5 人）

- サーバーは要りません。ルームの仲介は PeerJS の公開サーバー（無料）とホストのブラウザで行います（`games/turbo-kart/src/net/peersignal.js`。SKY RUNNER と同じもの）。お名前.com のレンタルサーバー（`server/api.php`）は終了したので、URL に `?netServer=<api.php の URL>` を付けたときだけ使います
- ルームを作ってコード（4 文字）を伝え、参加してもらいます。レース中はプレイヤー同士が WebRTC で直接通信します。直接つながらない回線は、Metered の Open Relay（日本の中継サーバー、無料枠 毎月 20GB）で中継します。ホストが抜けるとルームはなくなります
- ホストがコース・車種・周回・NPC を決めてスタートします。NPC はホストが走らせて全員に配信します

### サーバーへのデプロイ（管理者）

```bat
deploy.bat            :: 初回は SSH の接続先を質問し deploy.config.json に保存。以後はダブルクリックだけ
deploy.bat --setup    :: 接続先を設定し直す
deploy.bat --dry      :: 送るファイルの一覧だけ表示
```

- Windows 標準の `ssh` と `tar` を使って、サイト一式（`index.html`・`games/`・`server/`）を一度の接続でアップロードします。パスワードは保存しません（SSH 鍵を設定すれば入力も不要）
- アップロード後、サーバー上で PHP の構文チェックと、公開 URL での動作確認（`server/api.php?a=health`）を行います
- 許可するゲームの URL（CORS）やデータの保存先を変えたいときは、サーバー上で `server/config.sample.php` を `config.php` にコピーして編集します
