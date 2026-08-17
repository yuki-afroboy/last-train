# 終電 0:13

**深夜0時13分。無人のホーム。異変を見つけたら、引き返してください。**

ブラウザだけで遊べる、一人称視点の3D異変探索ゲームです。インストールも
アカウント登録も不要で、URLを開けばそのまま始まります。

▶ **[https://yuki-afroboy.github.io/last-train/](https://yuki-afroboy.github.io/last-train/)**

---

## 遊びかた

終電を逃したあなたは、郊外の小さな駅「霧崎」のホームに取り残されます。
階段を上がっても、なぜか同じホームに戻ってきます。

ルールはホームの掲示に書かれています。

- **異変を見つけたら、引き返す**（来たほうの階段へ戻る）
- **異変が見つからなければ、そのまま進む**（向こうの階段へ)
- **8回連続で正解すると、脱出**

判断を間違えると進行度は 0 に戻り、見落としが 3 回でゲームオーバーです。

異変が**まったく無い周回もあります**。「何も起きていないかもしれない」という
のがこのゲームの緊張感です。

### 操作

| PC | |
| --- | --- |
| `W` `A` `S` `D` | 移動 |
| マウス | 視点 |
| `Shift` | 早歩き |
| `E` / クリック | 調べる |
| `Esc` | メニュー |

スマートフォンでは、画面左下のスティックで移動、画面右半分のドラッグで視点、
右下のボタンで調査ができます。

---

## 技術構成

| | |
| --- | --- |
| 描画 | [three.js](https://threejs.org) (WebGL2) — PBR、リアルタイムライト、影、Fog、Bloom、GTAO、ACES トーンマッピング |
| 言語 / ビルド | TypeScript (strict) + Vite |
| 音響 | Web Audio API — 全音源をランタイム合成、3D positional audio |
| アセット | **外部ファイルゼロ**（テクスチャ・音・環境マップはすべて実行時生成） |
| 配信 | GitHub Actions → GitHub Pages（静的ホスティング、HTTPS） |
| 初回転送量 | 約 **185 KB (gzip)** |

### なぜこの構成か

three.js は WebGL の上に PBR・ポストプロセス・positional audio まで一通り
揃っていて、**成果物が静的ファイル 3 つに収まる**ため公開が最も簡単です。
Godot の Web export は WASM で初回ダウンロードが数 MB になり、この作品が
狙う「URLを送ればすぐ遊べる」体験と噛み合いませんでした。

テクスチャと音を**すべて実行時に生成する**という判断が、この作品では特に
効いています。デプロイ後にアセットが 404 になるという事故が原理的に起こらず、
初回ダウンロードが小さく、そして何より **異変システムと相性が良い**
（駅名標の一文字だけ違うテクスチャを、ロード無しでその場で作り直せる）。

---

## 開発

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit
npm run build      # dist/ に本番ビルド
npm run preview    # 本番ビルドをローカル確認
```

Node 20 以上が必要です。

### デバッグモード

`npm run dev` 中、または本番URLに `?debug=1` を付けるとデバッグ機能が有効に
なります。製品ビルドの通常アクセスでは一切表示されません。

| キー | |
| --- | --- |
| `F1` | オーバーレイ表示切替（FPS / draw call / 異変ID / 座標） |
| `F2` `F3` | 異変を順番に強制発生 |
| `F4` | 異変なしの周回を強制 |
| `F6` `F7` | 進行度 -1 / +1 |
| `F8` | 現在の周回を引き直し |

`?debug=1` では `window.__shuden` からシーン・プレイヤー・異変マネージャに
アクセスできます。

### QA スクリプト

ヘッドレス Chromium での自動確認に Playwright を使っています。

```bash
node tools/smoke.mjs  http://127.0.0.1:4173/          # 起動・操作・リロード・エラー検査
node tools/smoke.mjs  http://127.0.0.1:4173/ --mobile # モバイルエミュレーション
node tools/diag.mjs   "http://127.0.0.1:4173/?debug=1" ./diag   # 定点スクリーンショット＋輝度計測
node tools/bisect.mjs "http://127.0.0.1:4173/?debug=1" ./bisect # 描画レイヤ別の寄与を計測
```

`diag` と `bisect` は画面の平均輝度を数値で出します。「なんとなく明るすぎる」
を計測可能にするためのもので、実際このプロジェクトの見た目の問題（Bloom が
画面輝度の 43% を占めていた）はこれで特定しました。

---

## 構成

```
src/
  core/      Game（フェーズ・ゲームループ・演出）, Input, Settings, Save, RNG, Debug
  gfx/       Renderer（ポストプロセス）, Materials, Textures（手続き生成）, Environment
  world/     Station（ホーム全体）, Props, Actors（人影・電車）, Rain, Layout
  player/    Player（一人称コントローラ・当たり判定）
  anomaly/   AnomalyManager, definitions（異変カタログ）, types
  audio/     AudioSystem（全音源のランタイム合成）
  ui/        UI（DOMオーバーレイ）, styles.css
tools/       Playwright による QA スクリプト
```

異変を追加するときに触るのは
[`src/anomaly/definitions.ts`](src/anomaly/definitions.ts) の配列だけです。
元に戻す処理は `Station.resetToNormal()` が一括で行うため、各異変は「壊れた
状態」だけを記述します。

---

## デプロイ

`main` および `claude/**` ブランチへの push で
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) が動き、
型検査 → 本番ビルド → GitHub Pages へ配信します。

ビルドは `base: './'` の相対パスなので、GitHub Pages のサブパス
(`/last-train/`) でも、Netlify や Vercel のルート配信でも、同じ `dist/` が
そのまま動きます。

```bash
npm run build     # dist/ が生成される
# dist/ を任意の静的ホスティングに置くだけで公開できます
```

---

## ライセンス / 素材

外部素材は一切使用していません。詳細は [ASSETS.md](ASSETS.md) を参照して
ください。
