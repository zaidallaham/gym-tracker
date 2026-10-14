// D1 schema. Created automatically on the first API request after a deploy, so a new
// database needs no manual migration. Every statement is idempotent.
//
// All app data lives in `records`: one row per workout, day template, body-weight entry,
// custom exercise or settings object, as JSON, owned by a user. The views below unpack it
// into readable rows for the D1 console, e.g.  SELECT * FROM workout_sets WHERE username = 'zaid';

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    pass_hash TEXT NOT NULL,
    pass_salt TEXT NOT NULL,
    pass_iter INTEGER NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    must_change INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_login INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions (user_id)',
  `CREATE TABLE IF NOT EXISTS records (
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    seq INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind, id)
  )`,
  'CREATE INDEX IF NOT EXISTS records_user_seq ON records (user_id, seq)',
  'CREATE INDEX IF NOT EXISTS records_seq ON records (seq)',
  `CREATE TABLE IF NOT EXISTS login_attempts (
    key TEXT PRIMARY KEY,
    fails INTEGER NOT NULL,
    first_at INTEGER NOT NULL
  )`,
  `CREATE VIEW IF NOT EXISTS workouts AS
    SELECT r.user_id, u.username, r.id AS workout_id,
      json_extract(r.data, '$.name') AS day,
      datetime(json_extract(r.data, '$.start') / 1000, 'unixepoch') AS started_utc,
      round((json_extract(r.data, '$.end') - json_extract(r.data, '$.start')) / 60000.0) AS minutes,
      json_array_length(r.data, '$.exercises') AS exercises
    FROM records r JOIN users u ON u.id = r.user_id
    WHERE r.kind = 'session' AND r.deleted = 0`,
  `CREATE VIEW IF NOT EXISTS workout_sets AS
    SELECT r.user_id, u.username, r.id AS workout_id,
      datetime(json_extract(r.data, '$.start') / 1000, 'unixepoch') AS started_utc,
      json_extract(r.data, '$.name') AS day,
      json_extract(e.value, '$.name') AS exercise,
      json_extract(e.value, '$.exId') AS exercise_id,
      s.key + 1 AS set_number,
      json_extract(s.value, '$.kg') AS kg,
      json_extract(s.value, '$.reps') AS reps,
      json_extract(s.value, '$.warmup') AS warmup
    FROM records r JOIN users u ON u.id = r.user_id,
      json_each(r.data, '$.exercises') e, json_each(e.value, '$.sets') s
    WHERE r.kind = 'session' AND r.deleted = 0`,
  `CREATE VIEW IF NOT EXISTS body_weight AS
    SELECT r.user_id, u.username, r.id AS date, json_extract(r.data, '$.kg') AS kg
    FROM records r JOIN users u ON u.id = r.user_id
    WHERE r.kind = 'bodyweight' AND r.deleted = 0`,
];

let ready = null;
/** Runs the schema once per worker instance. */
export function ensureSchema(db) {
  ready ||= db.batch(SCHEMA.map(sql => db.prepare(sql))).catch(err => { ready = null; throw err; });
  return ready;
}
