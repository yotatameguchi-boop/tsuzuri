# Tsuzuri (綴)

[日本語](README.md) | English

A blogging tool for **interactive articles**: quizzes, calculators, charts, tabs, step-by-step guides, collapsible sections, before/after image sliders, glossary tooltips and links between articles. It runs as a standalone site on your own domain.

- Readers: `/` (article list) and `/<slug>`. Pages are rendered to HTML on the server, so search engines and social previews can read the full text.
- Writers: `/write`. Log in with your own account and write. Type `/` at the start of a line to pick a block.

Demo: https://tsuzuri-omega.vercel.app (sample content is in Japanese)

## Features

- **Three things to learn**: write, press `/` at the start of a line to insert a block, publish.
- **Interactive articles**: quizzes, calculators with sliders, bar charts, tabs, steps, collapsible sections, image comparison, glossary tooltips.
- **Search and social friendly**: articles are server-rendered HTML with OGP, structured data (JSON-LD), a sitemap and an RSS feed.
- **Multiple writers**: two roles, admin and writer. People join through invite links; writers can edit only their own posts (enforced on the server, not just in the UI).
- **Instant publishing**: pages are cached on the CDN for a long time and purged by cache tag whenever content changes.
- **Large media**: browsers upload straight to storage via presigned URLs (up to 100 MB).
- **Works as a documentation site**: categories, parent pages (chapters) and manual ordering, breadcrumbs, previous/next links and full-text search.
- **Restricted reading**: make individual posts or the whole site visible to logged-in members only. Read-only accounts are available.
- **Document syntax**: footnotes, math (KaTeX), syntax highlighting and attachments (PDF, Word, Excel, PowerPoint, CSV, ZIP).
- **Portable**: export each post as Markdown or a self-contained HTML file (interactive blocks keep working), or the whole site as JSON.
- **Multiple publications**: run several differently named media (e.g. a local-news site and a lifestyle magazine) from one Tsuzuri. Each has its own name, logo, color, design preset (standard, pop, magazine, natural, simple, tech), optional custom CSS and visibility, plus its own home, categories, search and RSS
- **Small**: no framework, two dependencies (`@vercel/blob`, `@vercel/functions`).

## How it differs from WordPress

**Tsuzuri focuses on writing and publishing interactive documents, and keeps both the editing workflow and the maintenance to a minimum.** WordPress can do almost anything, but that flexibility costs time.

| | WordPress | Tsuzuri |
|---|---|---|
| Writing | Add blocks one by one and configure them in the side panel; many screens and plugin settings | Type plain text and press `/` at the start of a line to insert a block. Two buttons: save draft and publish |
| Interactive content | Quizzes, calculators and charts need plugins, which must be found, installed and kept compatible | Quizzes, calculators with sliders, charts, steps, tabs, image comparison and glossary tooltips are built in |
| Maintenance | Core, theme and plugin updates, PHP and database upkeep, backups and security hardening | Nothing to update. Vercel runs the server, and every saved version is kept automatically |
| Source format | Blocks are HTML plus comments, which is hard to move to other tools | Readable text (extended Markdown). Export to Markdown, HTML or JSON at any time |
| Speed and publishing | Tune caching with plugins | Pages are server-rendered, cached on the CDN, and replaced the moment content changes |
| As a documentation site | Chapters, footnotes, math, attachments and members-only pages come from combining themes and plugins | Categories, chapters, breadcrumbs, previous/next links, search, footnotes, math, attachments and members-only pages are built in |
| Concurrent editing | When two people open the same post, the later save wins (edit locks prevent this) | Each post has a revision number. On a conflict you choose to open the latest version or overwrite with yours; saves to different posts never collide |

WordPress is the better fit when you need:

- Extensive visual or functional customization through themes and plugins
- Comments, e-commerce or multilingual sites
- A large ecosystem of documentation and people you can hire
- Fully visual, drag-and-drop page building (Tsuzuri shows the source and the reader view side by side)

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

Footnotes use `text[^1]` with `[^1]: note`, math uses `$a^2$` or `$$ … $$`, fenced code takes a language name, and a line containing only `[file.pdf](URL)` becomes an attachment card.

Block names also accept Japanese aliases (`:::クイズ`, `:::計算`, `:::グラフ`, `:::ポイント` …).

## Switching with front matter

Write settings between `---` lines at the very top of a post to switch its publication, design and more without leaving Markdown (choose "記事の設定" from the `/` palette to insert it). Keys accept English or Japanese names.

```
---
media: ashikamo
theme: pop
color: green
category: Cafes
---
Body…
```

Supported keys: `media` (name or URL of a publication), `theme` (standard, pop, magazine, natural, simple, tech), `color` (blue, red, green, orange, purple, teal, ink), `category`, `parent` (title or URL), `order`, `visibility` (public or members), `date`, `slug`. Theme and color apply to that post's page only. Front matter takes precedence over the settings panel.

## Project layout

| Path | What it does |
|---|---|
| `public/assets/render.js` | Syntax → HTML. Shared by the server and the editor preview |
| `public/assets/live.js` | Runs the interactive blocks on reader pages |
| `public/assets/write.js` / `public/write.html` | Writer UI |
| `public/assets/style.css` | Styles (black / white / blue, dark mode) |
| `api/index.js` | The server. Every URL is routed here |
| `lib/pages.js` | Builds reader pages, sitemap and RSS |
| `lib/store.js` | Storage for posts, accounts and media (Vercel Blob in production, `data/` locally). Each save adds a new sequentially numbered file, so concurrent saves never overwrite each other |
| `lib/auth.js` | Accounts, passwords (scrypt), invites and sessions (signed cookie) |
| `content/seed.json` | Initial sample articles (used only until the first save) |
| `artifact/` | The earlier version that ran as a Claude Artifact |

## Run locally

```
npm install
npm run dev   # http://localhost:3071  setup passphrase: tsuzuri
npm test
```

## Deploy your own (Vercel)

1. Fork this repository and import it as a new Vercel project.
2. In Vercel Storage, create a **Blob store (Public)** and connect it to the project (`BLOB_READ_WRITE_TOKEN` is added automatically).
3. Add two environment variables:
   - `TSUZURI_PASSWORD`: the site passphrase, used only to create the first admin (make it long)
   - `TSUZURI_SECRET`: the key for signing sessions and locating data (a random string, e.g. `openssl rand -base64 32`; changing it later hides existing data)
4. Deploy, open `/write`, and create the first admin with the passphrase plus your name, login ID and password.
5. Invite others from "メンバー" (Members). Sample articles are included; edit or delete them.

Optional: set `SITE_URL` to your custom domain so canonical URLs, the sitemap and OGP use it. Add the domain with `npx vercel@latest domains add <domain>` and follow the DNS instructions.

## Limitations

- Images and attachments in members-only posts can be opened by anyone who has the URL (URLs are long and unguessable).
- Uploads are limited to 100 MB. Post longer videos to YouTube and paste the URL on its own line.
- No email: invite and password-reset links are shown to the admin, who passes them along.
- The UI and messages are in Japanese.

## License

MIT
