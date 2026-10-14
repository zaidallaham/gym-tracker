// POST /api/auth/login {username, password}
import {
  clearFailures, clientIp, createSession, fail, hashPassword, json, lockedFor, publicUser, readJson,
  recordFailure, sessionCookie, verifyPassword,
} from '../_util.js';

export async function onRequestPost({ request, env }) {
  const body = await readJson(request, 10000);
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const keys = [`ip:${clientIp(request)}`, `user:${username}`];

  const wait = await lockedFor(env.DB, keys);
  if (wait) return fail(`Too many attempts. Try again in ${wait} min.`, 429);

  const user = username ? await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first() : null;
  // Hash even for unknown usernames so the response time doesn't reveal which ones exist.
  const ok = user ? await verifyPassword(password, user) : (await hashPassword(password), false);
  if (!ok) {
    await recordFailure(env.DB, keys);
    return fail('Wrong username or password', 401);
  }
  if (user.disabled) return fail('This account is turned off. Ask the admin to turn it back on.', 403);

  await clearFailures(env.DB, keys);
  const token = await createSession(env.DB, user.id, request);
  return json({ user: publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(token) });
}
