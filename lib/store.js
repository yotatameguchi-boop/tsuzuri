/* 記事データ・アカウント・画像の置き場所。
   本番（BLOB_READ_WRITE_TOKEN がある）は Vercel Blob、手元では data/ フォルダを使う。

   記事データ（content）とアカウント（users）は、保存のたびに「通し番号つきの新しいファイル」を足していく。
   - 同じ番号のファイルは2つ作れないので、2人が同時に保存しても片方は失敗し、読み直してやり直す
     （だから、どちらの変更も消えない）
   - 名前は「大きな数 − 通し番号」にしてあり、一覧の先頭が常に最新版。古い版はそのまま履歴になる
   - 上書きをしないので、CDN に古い中身が残って読み違えることもない
   置き場所のパスは TSUZURI_SECRET から作るので、URLを推測して下書きやパスワードの控えを読むことはできない。 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOCAL_DIR = () => process.env.TSUZURI_DATA_DIR || path.join(ROOT, 'data');
export const useBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export class Conflict extends Error {}

function secretSpace() {
  const s = process.env.TSUZURI_SECRET || (process.env.VERCEL ? null : 'local-dev-secret');
  if (!s) throw new Error('TSUZURI_SECRET が設定されていません');
  return crypto.createHmac('sha256', s).update('tsuzuri-state').digest('hex').slice(0, 32);
}
const prefix = name => `state/${secretSpace()}/${name}/`;
const seqName = (name, seq) => prefix(name) + String(1e12 - seq).padStart(12, '0') + '.json';

async function seedContent() {
  const raw = await fs.readFile(path.join(ROOT, 'content', 'seed.json'), 'utf8');
  return JSON.parse(raw);
}

/* 以前の形式（保存のたびに data/<逆順時刻>.json を足していた）からの引っ越し */
async function legacyContent() {
  const { list } = await import('@vercel/blob');
  const { blobs } = await list({ prefix: 'data/', limit: 1 });
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url, { cache: 'no-store' });
  return r.ok ? r.json() : null;
}

/* 古い形からの引っ越しもここで行う：メディアが無ければ、今のサイトを1つめのメディアにする */
function normalizeContent(d) {
  d.site = d.site || { name: 'Tsuzuri' };
  if (!Array.isArray(d.media) || !d.media.length) {
    d.media = [{ id: 'm1', slug: 'main', name: d.site.name || 'Tsuzuri', tagline: d.site.tagline || '', mark: '綴', color: 'blue', visibility: 'public' }];
  }
  const first = d.media[0].id;
  const ids = new Set(d.media.map(m => m.id));
  d.posts = (d.posts || []).map(p => ({ id: p.id || p.slug, rev: p.rev || 1, ...p, media: ids.has(p.media) ? p.media : first }));
  delete d.rev;
  return d;
}
const emptyUsers = () => ({ users: [], invites: [] });

/* 読む：{ data, etag }。etag は版の通し番号（まだ無ければ 0） */
export async function getDoc(name) {
  let data = null, etag = 0;
  if (useBlob()) {
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: prefix(name), limit: 1 });
    if (blobs.length) {
      const r = await fetch(blobs[0].url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${name} を読めませんでした: ${r.status}`);
      data = await r.json();
      etag = 1e12 - parseInt(blobs[0].pathname.slice(prefix(name).length), 10);
    }
  } else {
    try {
      const raw = await fs.readFile(path.join(LOCAL_DIR(), `${name}.json`), 'utf8');
      ({ seq: etag, data } = JSON.parse(raw));
    } catch {}
  }
  if (!data && name === 'content') data = (useBlob() && await legacyContent()) || await seedContent();
  if (!data && name === 'users') data = emptyUsers();
  return { data: name === 'content' ? normalizeContent(data) : data, etag };
}

/* 書く：次の通し番号のファイルを作る。もうあれば（＝ほかの人が先に保存した）Conflict */
export async function putDoc(name, data, etag) {
  const seq = etag + 1;
  if (useBlob()) {
    const { put } = await import('@vercel/blob');
    try {
      await put(seqName(name, seq), JSON.stringify(data), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false });
    } catch (e) {
      if (/already exists|precondition|overwrite/i.test(e.message)) throw new Conflict();
      throw e;
    }
    return;
  }
  /* 手元は1つのプロセスなので、確認と書き込みの間にほかの保存が割り込まないよう順番待ちにする */
  const prev = localLocks.get(name) || Promise.resolve();
  let release;
  localLocks.set(name, new Promise(r => { release = r; }));
  await prev;
  try {
    const file = path.join(LOCAL_DIR(), `${name}.json`);
    let cur = 0;
    try { cur = JSON.parse(await fs.readFile(file, 'utf8')).seq; } catch {}
    if (cur !== etag) throw new Conflict();
    await fs.mkdir(LOCAL_DIR(), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ seq, data }, null, 1));
  } finally { release(); }
}
const localLocks = new Map();

/* 読んで → 変えて → 条件つきで書く。ほかの人の保存とぶつかったら読み直してやり直す */
export async function mutate(name, fn) {
  for (let i = 0; i < 5; i++) {
    const { data, etag } = await getDoc(name);
    const result = await fn(data);
    if (result && result.abort) return result;
    try {
      await putDoc(name, data, etag);
      return result;
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
      await new Promise(r => setTimeout(r, 80 + Math.random() * 200));
    }
  }
  return { abort: true, status: 503, body: { error: 'busy', message: '保存が混み合っています。もう一度押してください' } };
}

/* ---- 画像・動画 ---- */
const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'application/pdf': 'pdf', 'text/csv': 'csv', 'text/plain': 'txt', 'application/zip': 'zip',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};
export const allowedType = t => !!EXT[t];
export const MEDIA_MAX = 100 * 1024 * 1024;
const mediaName = type => `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${EXT[type]}`;

/* 本番：ブラウザから Blob に直接送るための、1つのファイル専用・10分だけ有効なアップロード先を作る */
export async function presignMedia(type, size) {
  const { issueSignedToken, presignUrl } = await import('@vercel/blob');
  const pathname = `media/${mediaName(type)}`;
  const validUntil = Date.now() + 10 * 60 * 1000;
  const token = await issueSignedToken({ pathname, operations: ['put'], validUntil, allowedContentTypes: [type], maximumSizeInBytes: MEDIA_MAX });
  const { presignedUrl } = await presignUrl(token, {
    operation: 'put', pathname, access: 'public', validUntil, allowedContentTypes: [type], maximumSizeInBytes: MEDIA_MAX,
    addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 31536000,
  });
  const storeId = process.env.BLOB_READ_WRITE_TOKEN.split('_')[3].toLowerCase();
  return { putUrl: presignedUrl, url: `https://${storeId}.public.blob.vercel-storage.com/${pathname}`, size };
}

/* 手元：サーバーが受け取って data/media に置く */
export async function putLocalMedia(buf, type) {
  const name = mediaName(type);
  await fs.mkdir(path.join(LOCAL_DIR(), 'media'), { recursive: true });
  await fs.writeFile(path.join(LOCAL_DIR(), 'media', name), buf);
  return `/media/${name}`;
}

export async function readLocalMedia(name) {
  if (!/^[\w.-]+$/.test(name)) return null;
  try { return await fs.readFile(path.join(LOCAL_DIR(), 'media', name)); } catch { return null; }
}
