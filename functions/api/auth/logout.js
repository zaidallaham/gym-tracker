// POST /api/auth/logout — ends this device's session.
import { clearCookie, json } from '../_util.js';

export async function onRequestPost({ env, data }) {
  if (data.user) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(data.user.token_hash).run();
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}
