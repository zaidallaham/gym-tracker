// PATCH  /api/admin/users/:id {name?, password?, disabled?, isAdmin?, signOut?}
//   password sets a new temporary password (they choose their own at next sign-in).
// DELETE /api/admin/users/:id  -> removes the account and all of its data.
// You can't disable, demote or delete yourself, so there is always an admin left.
import { cleanName, fail, hashPassword, json, passwordProblem, readJson } from '../../_util.js';
import { listRow } from './index.js';

async function target(env, params) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return null;
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

export async function onRequestPatch({ request, env, data, params }) {
  const user = await target(env, params);
  if (!user) return fail('No such user', 404);
  const self = user.id === data.user.id;
  const body = await readJson(request, 10000);
  const stmts = [];
  const set = (col, val) => stmts.push(env.DB.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).bind(val, user.id));
  const signOut = () => stmts.push(env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(user.id));

  if (body.name !== undefined) set('name', cleanName(body.name) || user.username);
  if (body.password !== undefined) {
    if (self) return fail('Change your own password from Settings instead', 400);
    const problem = passwordProblem(body.password);
    if (problem) return fail(problem, 400);
    const { hash, salt, iterations } = await hashPassword(body.password);
    stmts.push(env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, must_change = 1 WHERE id = ?')
      .bind(hash, salt, iterations, user.id));
    signOut();
  }
  if (body.disabled !== undefined) {
    if (self) return fail("You can't turn off your own account", 400);
    set('disabled', body.disabled ? 1 : 0);
    if (body.disabled) signOut();
  }
  if (body.isAdmin !== undefined) {
    if (self && !body.isAdmin) return fail("You can't remove your own admin rights", 400);
    set('is_admin', body.isAdmin ? 1 : 0);
  }
  if (body.signOut) signOut();
  if (!stmts.length) return fail('Nothing to change', 400);

  await env.DB.batch(stmts);
  const row = await env.DB.prepare(
    `SELECT u.*, (SELECT COUNT(*) FROM records r WHERE r.user_id = u.id AND r.kind = 'session' AND r.deleted = 0) AS workouts
     FROM users u WHERE u.id = ?`,
  ).bind(user.id).first();
  return json({ user: listRow(row) });
}

export async function onRequestDelete({ env, data, params }) {
  const user = await target(env, params);
  if (!user) return fail('No such user', 404);
  if (user.id === data.user.id) return fail("You can't delete your own account", 400);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM records WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  return json({ ok: true });
}
