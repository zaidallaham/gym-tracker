// POST /api/sync {cursor, changes: [{kind, id, data, deleted, updatedAt}]}
//   -> {cursor, more, changes}
//
// Push and pull in one round trip. Each record keeps the newest write (by updatedAt); every
// accepted write gets the next value of a global sequence, and a device pulls everything
// for its user past the last sequence number it has seen (its cursor). Each step is a single
// query, so a sync stays well inside D1's per-request query limit.
import { fail, json, readJson } from './_util.js';

const KINDS = new Set(['session', 'template', 'bodyweight', 'custom', 'settings']);
const PAGE = 500;
const MAX_RECORD = 1500000;   // D1 caps a single value at ~2 MB
const MAX_BATCH = 1800000;

const UPSERT = `
  INSERT INTO records (user_id, kind, id, data, updated_at, deleted, seq)
  SELECT ?1, json_extract(j.value, '$.kind'), json_extract(j.value, '$.id'), json_extract(j.value, '$.data'),
         json_extract(j.value, '$.updatedAt'), json_extract(j.value, '$.deleted'),
         (SELECT COALESCE(MAX(seq), 0) FROM records) + j.key + 1
  FROM json_each(?2) AS j WHERE true
  ON CONFLICT (user_id, kind, id) DO UPDATE SET
    data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, seq = excluded.seq
  WHERE excluded.updated_at >= records.updated_at`;

const BY_KEYS = `
  SELECT r.kind, r.id, r.data, r.updated_at, r.deleted, r.seq FROM records r
  JOIN json_each(?2) AS j ON r.kind = json_extract(j.value, '$[0]') AND r.id = json_extract(j.value, '$[1]')
  WHERE r.user_id = ?1`;

const out = r => ({ kind: r.kind, id: r.id, data: r.deleted ? null : JSON.parse(r.data), updatedAt: r.updated_at, deleted: !!r.deleted });

export async function onRequestPost({ request, env, data }) {
  const uid = data.user.id;
  const body = await readJson(request, 4000000);
  const cursor = Math.max(0, Math.floor(Number(body.cursor) || 0));
  const incoming = Array.isArray(body.changes) ? body.changes : [];
  if (incoming.length > 1000) return fail('Too many changes in one request', 413);

  const now = Date.now();
  const clean = [];
  for (const c of incoming) {
    if (!c || !KINDS.has(c.kind) || typeof c.id !== 'string' || !c.id || c.id.length > 120) return fail('Malformed change', 400);
    const updatedAt = Number(c.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt < 0) return fail('Malformed change', 400);
    const deleted = c.deleted ? 1 : 0;
    const record = deleted ? null : JSON.stringify(c.data ?? null);
    if (record && record.length > MAX_RECORD) return fail(`Record ${c.kind}/${c.id} is too large`, 413);
    // A phone with a fast clock must not win every future edit, so never accept a time ahead of ours.
    clean.push({ kind: c.kind, id: c.id, data: record, deleted, updatedAt: Math.min(Math.floor(updatedAt), now) });
  }

  const accepted = new Map();
  let rejected = [];
  if (clean.length) {
    const keysJson = JSON.stringify(clean.map(c => [c.kind, c.id]));
    const { results: existing } = await env.DB.prepare(BY_KEYS).bind(uid, keysJson).all();
    const have = new Map(existing.map(r => [`${r.kind}|${r.id}`, r]));
    const wins = [];
    for (const c of clean) {
      const prev = have.get(`${c.kind}|${c.id}`);
      if (!prev || c.updatedAt >= prev.updated_at) { wins.push(c); accepted.set(`${c.kind}|${c.id}`, c.updatedAt); }
      else rejected.push(prev);
    }
    if (wins.length) {
      const batch = JSON.stringify(wins);
      if (batch.length > MAX_BATCH) return fail('Too much data in one sync; send fewer changes', 413);
      await env.DB.prepare(UPSERT).bind(uid, batch).run();
    }
  }

  const { results: rows } = await env.DB.prepare(
    'SELECT kind, id, data, updated_at, deleted, seq FROM records WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?',
  ).bind(uid, cursor, PAGE).all();
  // Don't echo back what this device just sent, but do send the server copy of anything it lost.
  const changes = rows.filter(r => accepted.get(`${r.kind}|${r.id}`) !== r.updated_at).map(out);
  const seen = new Set(changes.map(c => `${c.kind}|${c.id}`));
  for (const r of rejected) if (!seen.has(`${r.kind}|${r.id}`)) changes.push(out(r));

  return json({ cursor: rows.length ? rows[rows.length - 1].seq : cursor, more: rows.length === PAGE, changes });
}
