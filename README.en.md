# Tsuzuri (綴)

[日本語](README.md) | English

A blogging tool for **interactive articles**: quizzes, calculators, charts, tabs, step-by-step guides, collapsible sections, before/after image sliders, glossary tooltips and links between articles. It runs as a standalone site on your own domain.

- Readers: `/` (article list) and `/<slug>`. Pages are rendered to HTML on the server, so search engines and social previews can read the full text.
- Writers: `/write`. Log in with a passphrase and write. Type `/` at the start of a line to pick a block.

Demo: https://tsuzuri-omega.vercel.app (sample content is in Japanese)

## Features

- **Three things to learn**: write, press `/` at the start of a line to insert a block, publish.
- **Interactive articles**: quizzes, calculators with sliders, bar charts, tabs, steps, collapsible sections, image comparison, glossary tooltips.
- **Search and social friendly**: articles are server-rendered HTML with OGP, structured data (JSON-LD), a sitemap and an RSS feed.
- **Small**: no framework, one dependency (`@vercel/blob`), about 2,000 lines in total.

## Writing syntax

You never have to type these by hand (the `/` palette inserts them), but this is what the source looks like:

```
## Heading
**bold**  ==highlight==  [link](https://...)  [[Another article title]]  {term|tooltip text}

:::quiz Question
- Wrong answer
- *Correct answer (marked with *)
> Explanation shown after answering
:::

:::calc Monthly income
Hourly wage = 1200 yen (1000~2000)
Hours per week = 15 h (1~40)
---
Monthly = Hourly wage * Hours per week * 4 | yen
:::

:::chart Members
2024 | 9
2025 | 15
:::
```

Block names also accept Japanese aliases (`:::クイズ`, `:::計算`, `:::グラフ`, `:::ポイント` …).

## Project layout

| Path | What it does |
|---|---|
| `public/assets/render.js` | Syntax → HTML. Shared by the server and the editor preview |
| `public/assets/live.js` | Runs the interactive blocks on reader pages |
| `public/assets/write.js` / `public/write.html` | Writer UI |
| `public/assets/style.css` | Styles (black / white / blue, dark mode) |
| `api/index.js` | The server. Every URL is routed here |
| `lib/pages.js` | Builds reader pages, sitemap and RSS |
| `lib/store.js` | Storage for articles and media (Vercel Blob in production, `data/` locally) |
| `lib/auth.js` | Writer login (signed cookie) |
| `content/seed.json` | Initial sample articles (used only until the first save) |
| `artifact/` | The earlier version that ran as a Claude Artifact |

## Run locally

```
npm install
npm run dev   # http://localhost:3071  passphrase: tsuzuri
npm test
```

## Deploy your own (Vercel)

1. Fork this repository and import it as a new Vercel project.
2. In Vercel Storage, create a **Blob store (Public)** and connect it to the project (`BLOB_READ_WRITE_TOKEN` is added automatically).
3. Add two environment variables:
   - `TSUZURI_PASSWORD`: the writers' passphrase (make it long)
   - `TSUZURI_SECRET`: the cookie signing key (a random string, e.g. `openssl rand -base64 32`)
4. Deploy, open `/write`, and log in. Sample articles are included; edit or delete them.

Optional: set `SITE_URL` to your custom domain so canonical URLs, the sitemap and OGP use it. Add the domain with `npx vercel@latest domains add <domain>` and follow the DNS instructions.

## Limitations

- One shared passphrase for all writers (no per-person accounts yet).
- Uploads are limited to about 4 MB by the serverless function body limit. Post longer videos to YouTube and paste the URL on its own line.
- The UI and messages are in Japanese.

## License

MIT
