/* 記事データと画像の置き場所。
   本番（BLOB_READ_WRITE_TOKEN がある）は Vercel Blob、手元では data/ フォルダを使う。
   Blob では保存のたびに新しいファイルを作り、名前の先頭を「大きな数 − 時刻」にして、
   一覧の先頭が常に最新版になるようにしている（古い版は履歴として残る）。 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOCAL_DIR = process.env.TSUZURI_DATA_DIR || path.join(ROOT, 'data');
const useBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

let cache = null;
let cacheAt = 0;

async function seed() {
  const raw = await fs.readFile(path.join(ROOT, 'content', 'seed.json'), 'utf8');
  return { rev: 0, ...JSON.parse(raw) };
}

export async function load({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cacheAt < 5000) return cache;
  let data;
  if (useBlob()) {
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: 'data/', limit: 1 });
    if (blobs.length) {
      const r = await fetch(blobs[0].url, { cache: 'no-store' });
      if (!r.ok) throw new Error('記事データを読めませんでした: ' + r.status);
      data = await r.json();
    } else data = await seed();
  } else {
    try { data = JSON.parse(await fs.readFile(path.join(LOCAL_DIR, 'data.json'), 'utf8')); }
    catch { data = await seed(); }
  }
  data.rev = data.rev || 0;
  data.site = data.site || { name: 'Tsuzuri' };
  data.posts = data.posts || [];
  cache = data; cacheAt = Date.now();
  return data;
}

export async function save(data) {
  const json = JSON.stringify(data, null, 1);
  if (useBlob()) {
    const { put } = await import('@vercel/blob');
    const key = String(9999999999999 - Date.now()).padStart(13, '0');
    await put(`data/${key}.json`, json, { access: 'public', contentType: 'application/json', addRandomSuffix: true });
  } else {
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    await fs.writeFile(path.join(LOCAL_DIR, 'data.json'), json);
  }
  cache = data; cacheAt = Date.now();
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
export const allowedType = t => !!EXT[t];

/* 画像・動画を置いて、記事に書くURLを返す */
export async function putMedia(buf, type) {
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}.${EXT[type]}`;
  if (useBlob()) {
    const { put } = await import('@vercel/blob');
    const b = await put(`media/${name}`, buf, { access: 'public', contentType: type, addRandomSuffix: true });
    return b.url;
  }
  await fs.mkdir(path.join(LOCAL_DIR, 'media'), { recursive: true });
  await fs.writeFile(path.join(LOCAL_DIR, 'media', name), buf);
  return `/media/${name}`;
}

export async function readLocalMedia(name) {
  if (!/^[\w.-]+$/.test(name)) return null;
  try { return await fs.readFile(path.join(LOCAL_DIR, 'media', name)); } catch { return null; }
}
