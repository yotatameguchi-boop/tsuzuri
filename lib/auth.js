/* 書く人のログイン。合言葉（TSUZURI_PASSWORD）が合えば、署名つきのクッキーを30日発行する。 */
import crypto from 'node:crypto';

const COOKIE = 'tz_writer';
const DAYS = 30;

function secret() {
  const s = process.env.TSUZURI_SECRET;
  if (s) return s;
  if (process.env.VERCEL) throw new Error('TSUZURI_SECRET が設定されていません');
  return 'local-dev-secret';
}

const hmac = v => crypto.createHmac('sha256', secret()).update(v).digest('base64url');
const same = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

export function passwordConfigured() {
  return !!process.env.TSUZURI_PASSWORD || !process.env.VERCEL;
}

export function checkPassword(input) {
  const expected = process.env.TSUZURI_PASSWORD || (process.env.VERCEL ? null : 'tsuzuri');
  return !!expected && same(input || '', expected);
}

export function issueCookie() {
  const exp = Date.now() + DAYS * 864e5;
  const v = `${exp}.${hmac(String(exp))}`;
  const secure = process.env.VERCEL ? '; Secure' : '';
  return `${COOKIE}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secure}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function isWriter(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || +exp < Date.now()) return false;
  try { return same(sig, hmac(exp)); } catch { return false; }
}
