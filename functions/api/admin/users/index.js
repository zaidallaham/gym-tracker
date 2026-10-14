// GET  /api/admin/users                     -> every account (admins only, see _middleware)
// POST /api/admin/users {name, username, password, isAdmin}
//   The password is temporary: the person must choose their own when they first sign in.
import { cleanName, cleanUsername, fail, hashPassword, json, passwordProblem, readJson } from '../../_util.js';

export const listRow = u => ({
  id: u.id, username: u.username, name: u.name || u.username, isAdmin: !!u.is_admin, disabled: !!u.disabled,
  mustChange: !!u.must_change, createdAt: u.created_at, lastLogin: u.last_login, workouts: u.workouts ?? 0,
});

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT u.*, (SELECT COUNT(*) FROM records r WHERE r.user_id = u.id AND r.kind = 'session' AND r.deleted = 0) AS workouts
     FROM users u ORDER BY u.created_at`,
  ).all();
  return json({ users: results.map(listRow) });
}

export async function onRequestPost({ request, env }) {
  const body = await readJson(request, 10000);
  const username = cleanUsername(body.username);
  if (!username) return fail('Usernames are 3–32 characters: letters, numbers, dot, dash or underscore', 400);
  const problem = passwordProblem(body.password);
  if (problem) return fail(problem, 400);
  if (await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first()) {
    return fail(`The username "${username}" is taken`, 409);
  }
  const { hash, salt, iterations } = await hashPassword(body.password);
  const row = await env.DB.prepare(
    `INSERT INTO users (username, name, pass_hash, pass_salt, pass_iter, is_admin, must_change, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?) RETURNING *`,
  ).bind(username, cleanName(body.name) || username, hash, salt, iterations, body.isAdmin ? 1 : 0, Date.now()).first();
  return json({ user: listRow(row) }, 201);
}
