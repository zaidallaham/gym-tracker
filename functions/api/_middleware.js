// Runs before every /api/* route: database check, schema, cross-site guard, session lookup
// and access rules. Routes find the signed-in user in context.data.user.
import { ensureSchema } from './_schema.js';
import { DAY_MS, HttpError, SESSION_DAYS, fail, readCookie, sessionCookie, sha256Hex } from './_util.js';

const OPEN = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/me', '/api/auth/setup']);

export async function onRequest(context) {
  const { request, env, data } = context;
  const url = new URL(request.url);
  try {
    if (!env.DB) return fail('The database is not connected. Add a D1 binding named DB to the Pages project.', 503);
    await ensureSchema(env.DB);

    // Cookies are SameSite=Lax already; also refuse state changes posted from another site.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) return fail('Cross-site request blocked', 403);
    }

    const token = readCookie(request);
    let user = null;
    if (token && /^[0-9a-f]{64}$/.test(token)) {
      user = await env.DB.prepare(
        `SELECT u.*, s.token_hash, s.expires_at FROM auth_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`,
      ).bind(await sha256Hex(token), Date.now()).first();
    }
    data.user = user;

    if (!user && !OPEN.has(url.pathname)) return fail('Please sign in', 401);
    if (user?.must_change && !OPEN.has(url.pathname) && url.pathname !== '/api/auth/password') {
      return fail('Choose a new password first', 403, { mustChange: true });
    }
    if (url.pathname.startsWith('/api/admin/') && !user.is_admin) return fail('Only admins can do that', 403);

    // Sliding session: push the expiry out again once it is a month old.
    let refreshed = false;
    if (user && user.expires_at - Date.now() < (SESSION_DAYS - 30) * DAY_MS) {
      await env.DB.prepare('UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ?')
        .bind(Date.now() + SESSION_DAYS * DAY_MS, user.token_hash).run();
      refreshed = true;
    }

    const res = await context.next();
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'no-store');
    if (refreshed && !out.headers.has('Set-Cookie')) out.headers.append('Set-Cookie', sessionCookie(token));
    return out;
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status, err.extra);
    console.error(err);
    return fail('Server error', 500);
  }
}
