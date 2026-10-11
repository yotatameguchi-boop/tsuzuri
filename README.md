# Tsuzuri（綴）

A writing tool for interactive articles (quizzes, calculators, graphs, tabs, steps, collapsible sections, image comparison, glossary terms, links between articles). It runs as an independent site on its own domain.

- Readers: `/` (article list) and `/<article URL>`. Pages are built as HTML on the server, so search engines and social media previews can read them
- Writers: `/write`. Log in with the password and write. Type `/` at the start of a line to insert parts

## Layout

| Path | Contents |
|---|---|
| `public/assets/render.js` | Converts the notation to HTML. Shared by the server and the editor preview |
| `public/assets/live.js` | Behavior on reader pages (quizzes, calculators, graphs, etc.) |
| `public/assets/write.js` / `public/write.html` | Writer screen |
| `public/assets/style.css` | Look (black, white and blue; dark mode supported) |
| `api/index.js` | Server. Every URL comes here and is dispatched |
| `lib/pages.js` | Builds reader pages, the sitemap and RSS |
| `lib/store.js` | Where articles and images are stored (Vercel Blob in production, `data/` locally) |
| `lib/auth.js` | Writer login (signed cookie) |
| `content/seed.json` | Initial articles (used only when nothing is saved yet) |
| `artifact/` | The old version that ran as a Claude Artifact |

## Running locally

```
npm install
npm run dev   # http://localhost:3070  password: tsuzuri
npm test
```

## Production (Vercel)

- Environment variables: `TSUZURI_PASSWORD` (password), `TSUZURI_SECRET` (login signing key), `BLOB_READ_WRITE_TOKEN` (set automatically when you connect a Blob store)
- Optional: `SITE_URL` (pin the site URL in canonical, sitemap and OGP to your own domain)
- Add a custom domain: `npx vercel domains add <domain> ` → configure DNS as instructed
