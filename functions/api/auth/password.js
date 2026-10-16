// POST /api/auth/password {current, next} — change your own password.
// Also used right after signing in with a temporary password from the admin.
import {
  clearFailures, fail, hashPassword, json, lockedFor, passwordProblem, publicUser, readJson, recordFailure, verifyPassword,
} from '../_util.js';

export async function onRequestPost({ request, env, data }) {
  const user = data.user;
  // Same limit as sign-in, so a borrowed, signed-in phone can't be used to guess the password.
  const keys = [`pw:${user.id}`];
  const wait = await lockedFor(env.DB, keys);
  if (wait) return fail(`Too many attempts. Try again in ${wait} min.`, 429);

  const body = await readJson(request, 10000);
  if (!(await verifyPassword(String(body.current || ''), user))) {
    await recordFailure(env.DB, keys);
    return fail('Your current password is wrong', 403);
  }
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
  await clearFailures(env.DB, keys);
  return json({ user: publicUser({ ...user, must_change: 0 }) });
}
