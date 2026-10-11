/* 手元で動かす: npm run dev → http://localhost:3071 （合言葉は tsuzuri、データは data/ に保存） */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
/* TSUZURI_ENV_FILE を指定すると、そのファイルから BLOB_READ_WRITE_TOKEN だけ読んで、手元でも本物のストレージを使う */
if (process.env.TSUZURI_ENV_FILE && !process.env.BLOB_READ_WRITE_TOKEN) {
  const m = (await fs.readFile(process.env.TSUZURI_ENV_FILE, 'utf8')).match(/^BLOB_READ_WRITE_TOKEN="?([^"\n]+)"?/m);
  if (m) process.env.BLOB_READ_WRITE_TOKEN = m[1];
}
const { default: handler } = await import('./api/index.js');

const PORT = +process.env.PORT || 3071;
const PUB = path.join(path.dirname(new URL(import.meta.url).pathname), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(PUB, p === '/write' ? 'write.html' : p);
  if (file.startsWith(PUB) && p !== '/') {
    try {
      const st = await fs.stat(file);
      if (st.isFile()) { res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); return res.end(await fs.readFile(file)); }
    } catch {}
  }
  handler(req, res);
}).listen(PORT, () => console.log(`Tsuzuri: http://localhost:${PORT}`));
