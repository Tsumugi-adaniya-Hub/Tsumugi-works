# つむぎワークス 公式サイト

素のHTML / CSS のみで作った1ページのサイトです（ビルド不要）。

```
website/
├── index.html
├── style.css
├── images/
│   ├── ogp.png      … SNS共有用画像（1200×630・仮）
│   └── favicon.png  … ブラウザタブのアイコン（仮）
└── README.md
```

## 1. 原稿の差し替え箇所

`index.html` 内の `【TODO: 〇〇】`（黄色で表示される部分）を検索して置き換えます。
置き換えたら、囲んでいる `<span class="todo">…</span>` タグも削除してください（黄色表示が消えます）。

| 場所 | TODO |
|---|---|
| ファーストビュー | キャッチコピー／サブコピー |
| サービス | 事務代行・Web制作・管理・業務効率化の説明 |
| 制作実績 | 実績名／実績の説明（1件ごとに `<article class="card">` を追加） |
| 料金の目安 | 各サービスの料金（「〇〇円〜」の数字部分） |
| プロフィール | 代表者名／経歴 |
| お問い合わせ | GoogleフォームURL（ボタンの `href="#"` を差し替え）／メールアドレス |

### 制作実績を非表示にする

実績が無い間は、次の2か所に `hidden` を付けます。

```html
<li class="nav-works" hidden>…</li>
<section id="works" class="section section-alt" hidden>
```

※ 非表示にすると背景色の交互が崩れるため、気になる場合は下のセクションの `section-alt` を付け替えてください。

### ドメイン確定前後

`<head>` の `og:url` と `og:image` は `https://tsumugiworks.net/` で記載済みです。
ドメイン取得前にSNS共有する場合は、VercelのURL（例：`https://xxxx.vercel.app/`）に一時的に変更してください。

### 画像

`images/ogp.png`・`images/favicon.png` は仮画像です。同じファイル名で上書きすれば差し替わります。

## 2. 配色の変更方法

`style.css` の先頭にある CSS変数を変更すると全体に反映されます。

```css
:root {
  --color-main: #4f7f7a;   /* メイン色（見出し・ボタン・フッター） */
  --color-accent: #b98b5e; /* アクセント（見出し下の線） */
  --color-text: #333333;   /* 文字色 */
  --color-bg: #ffffff;     /* 背景色 */
  --color-bg-alt: #f3f6f5; /* 交互の背景（メイン色をごく薄くした色） */
}
```

## 3. Vercelへの公開手順

このリポジトリには運営管理アプリ（顧客データ含む）も入っているため、**必ず Root Directory を `website` に設定**して、サイト部分だけを公開します。

1. https://vercel.com に GitHub アカウントでログイン
2. 「Add New… → Project」→ このリポジトリを「Import」
3. 設定画面で
   - **Root Directory**：`website` を選択（Edit から指定）
   - **Framework Preset**：`Other`
   - Build Command / Output Directory：空欄のまま
4. 「Deploy」→ 発行された `https://xxxx.vercel.app` で表示を確認
5. 以降は GitHub の本番ブランチに push すると自動で再公開されます

### 独自ドメイン（tsumugiworks.net）の設定

1. Vercel のプロジェクト →「Settings → Domains」で `tsumugiworks.net` を追加
2. 表示された DNS レコード（Aレコード／CNAME）をドメイン取得先の管理画面に登録
3. 反映後（数分〜最大48時間）、`https://tsumugiworks.net` で表示されることを確認
