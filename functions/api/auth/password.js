// POST /api/auth/password {current, next} — change your own password.
// Also used right after signing in with a temporary password from the admin.
import { fail, hashPassword, json, passwordProblem, publicUser, readJson, verifyPassword } from '../_util.js';

export async function onRequestPost({ request, env, data }) {
  const user = data.user;
  const body = await readJson(request, 10000);
  if (!(await verifyPassword(String(body.current || ''), user))) return fail('Your current password is wrong', 403);
  const problem = passwordProblem(body.next);
  if (problem) return fail(problem, 400);
  if (body.next === body.current) return fail('Pick a password different from the current one', 400);

  const { hash, salt, iterations } = await hashPassword(body.next);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, must_change = 0 WHERE id = ?')
      .bind(hash, salt, iterations, user.id),
    // Sign out every other device; this one stays signed in.
    env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?').bind(user.id, user.token_hash),
  ]);
  return json({ user: publicUser({ ...user, must_change: 0 }) });
}
