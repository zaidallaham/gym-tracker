// Shared helpers for the API. Files starting with "_" are imported, not routed.

// __Host- cookies can only be set by this exact host over HTTPS, so another subdomain can't
// plant a session here. LEGACY_COOKIE is the old name, still accepted and swapped on next use.
export const COOKIE = '__Host-gym_session';
export const LEGACY_COOKIE = 'gym_session';
export const SESSION_DAYS = 180;
export const DAY_MS = 864e5;
// PBKDF2-SHA256. 100,000 is the most iterations Cloudflare Workers allows.
export const ITERATIONS = 100000;
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

const enc = new TextEncoder();

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      ...headers,
    },
  });
}

export const fail = (error, status = 400, extra = {}) => json({ error, ...extra }, status);

/** Parse a JSON body, reading at most maxBytes so an oversized upload is refused early. */
export async function readJson(request, maxBytes = 100000) {
  if (Number(request.headers.get('Content-Length')) > maxBytes) throw new HttpError(413, 'Request too large');
  const chunks = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, 'Request too large'); }
      chunks.push(value);
    }
  }
  const text = await new Blob(chunks).text();
  if (!text) return {};
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object') throw new Error('not an object');
    return body;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

export const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const fromHex = hex => Uint8Array.from(String(hex).match(/../g) || [], h => parseInt(h, 16));
export function randomHex(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return toHex(a);
}
export const sha256Hex = async text => toHex(await crypto.subtle.digest('SHA-256', enc.encode(String(text))));

export function timingSafeEqual(a, b) {
  const x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function hashPassword(password, salt = randomHex(16), iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromHex(salt), iterations, hash: 'SHA-256' }, key, 256);
  return { hash: toHex(bits), salt, iterations };
}

export async function verifyPassword(password, user) {
  const { hash } = await hashPassword(password, user.pass_salt, user.pass_iter);
  return timingSafeEqual(hash, user.pass_hash);
}

export function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < 8) return 'Use at least 8 characters for the password';
  if (p.length > 200) return 'That password is too long';
  return null;
}

export function cleanUsername(u) {
  const name = String(u || '').trim().toLowerCase();
  return USERNAME_RE.test(name) ? name : null;
}

export const cleanName = n => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 60);

export function readCookie(request, name = COOKIE) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}
/** The session token, preferring the __Host- cookie; `legacy` says the old cookie is still around. */
export function readSession(request) {
  const current = readCookie(request, COOKIE), old = readCookie(request, LEGACY_COOKIE);
  return { token: current || old, fromLegacy: !current && !!old, legacy: !!old };
}

export const sessionCookie = token => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
export const clearCookie = (name = COOKIE) => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function createSession(db, userId, request) {
  const token = randomHex(32), now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').bind(now),
    db.prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
      .bind(await sha256Hex(token), userId, now, now + SESSION_DAYS * DAY_MS, (request.headers.get('User-Agent') || '').slice(0, 200)),
    db.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now, userId),
  ]);
  return token;
}

export const publicUser = u => ({
  id: u.id,
  username: u.username,
  name: u.name || u.username,
  isAdmin: !!u.is_admin,
  mustChange: !!u.must_change,
});

/**
 * Failed-attempt counter for sign-in and setup. Returns minutes to wait when a key is
 * over the limit, otherwise null. Counters reset after the window.
 */
const WINDOW_MS = 15 * 60e3, MAX_FAILS = 8;
export async function lockedFor(db, keys) {
  const { results } = await db.prepare(`SELECT key, fails, first_at FROM login_attempts WHERE key IN (${keys.map(() => '?').join(',')})`)
    .bind(...keys).all();
  const now = Date.now();
  const hit = results.find(r => now - r.first_at < WINDOW_MS && r.fails >= MAX_FAILS);
  return hit ? Math.max(1, Math.ceil((hit.first_at + WINDOW_MS - now) / 60e3)) : null;
}
export async function recordFailure(db, keys) {
  const now = Date.now();
  await db.batch(keys.map(k => db.prepare(
    `INSERT INTO login_attempts (key, fails, first_at) VALUES (?1, 1, ?2)
     ON CONFLICT (key) DO UPDATE SET
       fails = CASE WHEN ?2 - first_at > ?3 THEN 1 ELSE fails + 1 END,
       first_at = CASE WHEN ?2 - first_at > ?3 THEN ?2 ELSE first_at END`,
  ).bind(k, now, WINDOW_MS)));
}
export async function clearFailures(db, keys) {
  await db.prepare(`DELETE FROM login_attempts WHERE key IN (${keys.map(() => '?').join(',')}) OR first_at < ?`)
    .bind(...keys, Date.now() - DAY_MS).run();
}
export const clientIp = request => request.headers.get('CF-Connecting-IP') || 'local';
