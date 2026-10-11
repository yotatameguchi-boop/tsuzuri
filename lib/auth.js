/* 書く人のアカウント。
   - 役割は「管理者」（全記事・サイト設定・メンバー）と「書き手」（自分の記事だけ）の2つ
   - パスワードは scrypt でハッシュにして保存し、元の文字列は残さない
   - ログイン中の印は、ユーザーID・セッション番号・期限に署名したクッキー。
     パスワード変更や利用停止でセッション番号を進めると、ほかの端末のログインも切れる
   - 最初の管理者は、サイトの合言葉（TSUZURI_PASSWORD）を知っている人だけが作れる */
import crypto from 'node:crypto';

const COOKIE = 'tz_s';
const DAYS = 30;

function secret() {
  const s = process.env.TSUZURI_SECRET;
  if (s) return s;
  if (process.env.VERCEL) throw new Error('TSUZURI_SECRET が設定されていません');
  return 'local-dev-secret';
}
const hmac = v => crypto.createHmac('sha256', secret()).update(v).digest('base64url');
export const same = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
export const newId = prefix => prefix + crypto.randomBytes(6).toString('base64url');

/* ---- パスワード ---- */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const h = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64url');
  return `scrypt$${salt}$${h}`;
}
export function verifyPassword(pw, stored) {
  const [kind, salt, h] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !h) return false;
  const got = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(h, 'base64url');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/* ---- 入力の決まり ---- */
export const LOGIN_ID = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export function checkNewAccount({ name, loginId, password }, users) {
  if (!name || typeof name !== 'string' || !name.trim() || name.length > 40) return '名前を1〜40文字で入れてください';
  if (!LOGIN_ID.test(String(loginId || ''))) return 'ログインIDは半角の英小文字・数字・「.」「_」「-」で3〜32文字にしてください';
  if (users.some(u => u.loginId === loginId)) return 'そのログインIDはもう使われています';
  return checkPassword(password);
}
export function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'パスワードは8文字以上にしてください';
  if (pw.length > 200) return 'パスワードが長すぎます';
  return null;
}

/* ---- 最初の管理者を作るときの合言葉 ---- */
export function setupKeyConfigured() { return !!process.env.TSUZURI_PASSWORD || !process.env.VERCEL; }
export function checkSetupKey(input) {
  const expected = process.env.TSUZURI_PASSWORD || (process.env.VERCEL ? null : 'tsuzuri');
  return !!expected && same(input || '', expected);
}

/* ---- 招待 ---- */
export function makeInvite(role, by, resetFor) {
  const token = crypto.randomBytes(18).toString('base64url');
  const days = resetFor ? 1 : 7;
  return { token, invite: { id: newId('i'), hash: sha(token), role, by, exp: Date.now() + days * 864e5, ...(resetFor ? { resetFor } : {}) } };
}
export function findInvite(doc, token) {
  if (typeof token !== 'string' || !token) return null;
  const h = sha(token);
  return doc.invites.find(i => same(i.hash, h) && i.exp > Date.now()) || null;
}

/* ---- ログイン状態（クッキー） ---- */
export function issueCookie(user) {
  const exp = Date.now() + DAYS * 864e5;
  const body = `${user.id}.${user.ses || 0}.${exp}`;
  const secure = process.env.VERCEL ? '; Secure' : '';
  return `${COOKIE}=${body}.${hmac(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secure}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function sessionUserId(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 4) return null;
  const [id, ses, exp, sig] = parts;
  if (+exp < Date.now()) return null;
  try { if (!same(sig, hmac(`${id}.${ses}.${exp}`))) return null; } catch { return null; }
  return { id, ses: +ses };
}

export function currentUser(req, usersDoc) {
  const s = sessionUserId(req);
  if (!s) return null;
  const u = usersDoc.users.find(x => x.id === s.id);
  if (!u || u.disabled || (u.ses || 0) !== s.ses) return null;
  return u;
}

export const publicUser = u => ({ id: u.id, name: u.name, loginId: u.loginId, role: u.role, disabled: !!u.disabled, created: u.created });
