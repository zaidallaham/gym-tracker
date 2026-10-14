// First-time setup: creates the owner (admin) account. Only works while there are no users,
// and only with the SETUP_CODE secret set on the Pages project.
//   GET  /api/auth/setup  -> { needsSetup, setupConfigured }
//   POST /api/auth/setup {code, name, username, password}
import {
  cleanName, cleanUsername, clientIp, createSession, fail, hashPassword, json, lockedFor, passwordProblem,
  publicUser, readJson, recordFailure, sessionCookie, sha256Hex, timingSafeEqual,
} from '../_util.js';

const userCount = async db => (await db.prepare('SELECT COUNT(*) AS n FROM users').first()).n;

export async function onRequestGet({ env }) {
  return json({ needsSetup: (await userCount(env.DB)) === 0, setupConfigured: !!env.SETUP_CODE });
}

export async function onRequestPost({ request, env }) {
  if ((await userCount(env.DB)) > 0) return fail('Setup is already done. Sign in instead.', 409);
  if (!env.SETUP_CODE) return fail('Add a SETUP_CODE secret to the Pages project first, then redeploy.', 503);

  const keys = [`setup:${clientIp(request)}`];
  const wait = await lockedFor(env.DB, keys);
  if (wait) return fail(`Too many attempts. Try again in ${wait} min.`, 429);

  const body = await readJson(request, 10000);
  if (!timingSafeEqual(await sha256Hex(String(body.code || '')), await sha256Hex(env.SETUP_CODE))) {
    await recordFailure(env.DB, keys);
    return fail('That setup code is wrong', 403);
  }
  const username = cleanUsername(body.username);
  if (!username) return fail('Usernames are 3–32 characters: letters, numbers, dot, dash or underscore', 400);
  const problem = passwordProblem(body.password);
  if (problem) return fail(problem, 400);

  const { hash, salt, iterations } = await hashPassword(body.password);
  // NOT EXISTS keeps two simultaneous setups from both creating an admin.
  const row = await env.DB.prepare(
    `INSERT INTO users (username, name, pass_hash, pass_salt, pass_iter, is_admin, created_at)
     SELECT ?, ?, ?, ?, ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM users) RETURNING *`,
  ).bind(username, cleanName(body.name) || username, hash, salt, iterations, Date.now()).first();
  if (!row) return fail('Setup is already done. Sign in instead.', 409);

  const token = await createSession(env.DB, row.id, request);
  return json({ user: publicUser(row) }, 201, { 'Set-Cookie': sessionCookie(token) });
}
