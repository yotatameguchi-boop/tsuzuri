# Tsuzuri（綴）

日本語 | [English](README.en.md)

動く要素（クイズ・計算・グラフ・タブ・手順・折りたたみ・画像の比較・用語の説明・記事どうしのリンク）を埋め込める記事ツール。独自ドメインで動く独立したサイトとして公開できる。

- 読む人：`/`（記事一覧）と `/<記事のURL>`。ページはサーバーでHTMLにして返すので、検索エンジンやSNSのプレビューが本文を読める
- 書く人：`/write`。合言葉でログインして書く。行の先頭で `/` を押すと部品を選べる

デモ：https://tsuzuri-omega.vercel.app

## 特徴

- **覚えることは3つ**：書く／行頭の `/` で部品を選ぶ／公開する
- **動く記事**：クイズ・計算（スライダーつき）・棒グラフ・タブ・手順・折りたたみ・画像の比較・用語の吹き出し
- **検索とSNSに強い**：記事はサーバーでHTMLにして返す。OGP・構造化データ・サイトマップ・RSS つき
- **小さい**：フレームワークなし、依存は `@vercel/blob` だけ。全部で約2,000行

## 構成

| 場所 | 中身 |
|---|---|
| `public/assets/render.js` | 記法 → HTML の変換。サーバーと編集画面のプレビューで共用 |
| `public/assets/live.js` | 読者のページで動く部分（クイズ・計算・グラフなど） |
| `public/assets/write.js` / `public/write.html` | 書く人の画面 |
| `public/assets/style.css` | 見た目（黒・白・青、ダークモード対応） |
| `api/index.js` | サーバー。すべてのURLがここに来て振り分ける |
| `lib/pages.js` | 読者のページ・サイトマップ・RSS を組み立てる |
| `lib/store.js` | 記事と画像の置き場所（本番は Vercel Blob、手元は `data/`） |
| `lib/auth.js` | 書く人のログイン（署名つきクッキー） |
| `content/seed.json` | 最初の記事（まだ何も保存されていないときだけ使う） |
| `artifact/` | Claude のアーティファクトとして動いていた旧版 |

## 手元で動かす

```
npm install
npm run dev   # http://localhost:3071  合言葉は tsuzuri
npm test
```

## 自分のサイトとして立ち上げる（Vercel）

1. このリポジトリを fork して、Vercel で新しいプロジェクトとして読み込む
2. Vercel の Storage から **Blob ストア（Public）** を作り、プロジェクトにつなぐ（`BLOB_READ_WRITE_TOKEN` が自動で入る）
3. 環境変数を2つ入れる
   - `TSUZURI_PASSWORD`：書く人の合言葉（長めのものを）
   - `TSUZURI_SECRET`：ログインの署名鍵（`openssl rand -base64 32` などで作ったランダムな文字列）
4. デプロイして `/write` を開き、合言葉でログインする。最初はサンプル記事が入っているので、書き換えるか削除する

## 本番（Vercel）

- GitHub の main に push すると、Vercel が自動で本番に反映する
- 環境変数：`TSUZURI_PASSWORD`（合言葉）、`TSUZURI_SECRET`（ログインの署名鍵）、`BLOB_READ_WRITE_TOKEN`（Blob ストアをつなぐと自動で入る）
- 任意：`SITE_URL`（canonical・サイトマップ・OGP に使うURLを独自ドメインに固定する）
- 独自ドメインの追加：`npx vercel@latest domains add <ドメイン>` → 表示される DNS を設定する

## ライセンス

MIT
