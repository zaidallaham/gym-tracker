// GET /api/auth/me — the signed-in user, or 401 with whether first-time setup is still open.
import { json, publicUser } from '../_util.js';

export async function onRequestGet({ env, data }) {
  if (data.user) return json({ user: publicUser(data.user) });
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  return json({ user: null, needsSetup: n === 0, setupConfigured: !!env.SETUP_CODE }, 401);
}
