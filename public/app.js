'use strict';
/* Gym Tracker — plain JS, no build step, all data on-device (IndexedDB).
   1 utilities · 2 constants · 3 storage · 4 state & domain logic · 5 UI infrastructure
   6 components (muscle map, demo, charts) · 7 views · 8 rest timer & wake lock · 9 boot */

// ============================================================ 1. utilities
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const DAY = 864e5;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const parseNum = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const fmtNum = (n, d = 0) => (n ?? 0).toLocaleString('en', { maximumFractionDigits: d });
const fmtW = n => fmtNum(n ?? 0, 2);
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const fmtDate = (t, o = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(t).toLocaleDateString('en', o);
const fmtTime = t => new Date(t).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
const fmtDur = ms => { const m = Math.max(1, Math.round(ms / 6e4)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`; };
const fmtClock = ms => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`; };
const fmtRest = s => s >= 60 ? `${Math.floor(s / 60)}:${pad(s % 60)}` : `${s}s`;
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const startOfWeek = t => { const d = new Date(startOfDay(t)); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); };
const startOfMonth = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const addMonths = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime(); };
const plural = (n, w, p = w + 's') => `${fmtNum(n)} ${n === 1 ? w : p}`;
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const throttle = (fn, ms) => { let last = 0, t; return () => { clearTimeout(t); const now = Date.now(); if (now - last >= ms) { last = now; fn(); } else t = setTimeout(() => { last = Date.now(); fn(); }, ms); }; };
const fmtMB = b => `${fmtNum(b / 1048576, b > 1048576 * 10 ? 0 : 1)} MB`;
const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = () => { clearTimeout(t); return fn(); }; return d; };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Epley one-rep-max estimate. A single is taken at face value. */
const epley = (kg, reps) => reps <= 1 ? kg : kg * (1 + reps / 30);
const relDay = t => {
  const d = Math.round((startOfDay(Date.now()) - startOfDay(t)) / DAY);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 7 ? `${d} days ago` : fmtDate(t, { month: 'short', day: 'numeric' });
};

// ============================================================ 2. constants
const IMG_CACHE = 'gym-img-v1'; // must match sw.js
const imgUrl = (id, i) => `img/exercises/${id}/${i}.webp`;
const thumbUrl = id => `img/exercises/${id}/t.webp`;

const MUSCLE_LABEL = {
  chest: 'Chest', shoulders: 'Shoulders', triceps: 'Triceps', biceps: 'Biceps', forearms: 'Forearms',
  lats: 'Lats', 'middle back': 'Middle back', 'lower back': 'Lower back', traps: 'Traps', abdominals: 'Abs',
  quadriceps: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', calves: 'Calves',
  adductors: 'Adductors', abductors: 'Abductors', neck: 'Neck',
};
const MUSCLES = Object.keys(MUSCLE_LABEL);
const GROUPS = [
  { id: 'chest', label: 'Chest', m: ['chest'] },
  { id: 'back', label: 'Back', m: ['lats', 'middle back', 'lower back'] },
  { id: 'shoulders', label: 'Shoulders', m: ['shoulders'] },
  { id: 'traps', label: 'Traps', m: ['traps'] },
  { id: 'biceps', label: 'Biceps', m: ['biceps'] },
  { id: 'triceps', label: 'Triceps', m: ['triceps'] },
  { id: 'forearms', label: 'Forearms', m: ['forearms'] },
  { id: 'abs', label: 'Abs', m: ['abdominals'] },
  { id: 'quads', label: 'Quads', m: ['quadriceps'] },
  { id: 'hamstrings', label: 'Hamstrings', m: ['hamstrings'] },
  { id: 'glutes', label: 'Glutes', m: ['glutes'] },
  { id: 'calves', label: 'Calves', m: ['calves'] },
  { id: 'hips', label: 'Hips', m: ['adductors', 'abductors'] },
  { id: 'neck', label: 'Neck', m: ['neck'] },
];
const GROUP_OF = Object.fromEntries(GROUPS.flatMap(g => g.m.map(m => [m, g.id])));
const EQUIPMENT = [
  { id: 'barbell', label: 'Barbell', m: ['barbell'] },
  { id: 'dumbbell', label: 'Dumbbell', m: ['dumbbell'] },
  { id: 'cable', label: 'Cable', m: ['cable'] },
  { id: 'machine', label: 'Machine', m: ['machine'] },
  { id: 'body', label: 'Bodyweight', m: ['body only', ''] },
  { id: 'kettlebells', label: 'Kettlebell', m: ['kettlebells'] },
  { id: 'ez', label: 'EZ bar', m: ['e-z curl bar'] },
  { id: 'bands', label: 'Bands', m: ['bands'] },
  { id: 'medball', label: 'Medicine ball', m: ['medicine ball'] },
  { id: 'ball', label: 'Exercise ball', m: ['exercise ball'] },
  { id: 'foam', label: 'Foam roll', m: ['foam roll'] },
  { id: 'other', label: 'Other', m: ['other'] },
];
const equipLabel = eq => (EQUIPMENT.find(q => q.m.includes(eq || '')) || { label: cap(eq) }).label;
const CATEGORIES = [
  ['strength', 'Strength'], ['stretching', 'Stretching'], ['plyometrics', 'Plyometrics'], ['cardio', 'Cardio'],
  ['powerlifting', 'Powerlifting'], ['olympic weightlifting', 'Olympic lifting'], ['strongman', 'Strongman'],
];
const SEARCH_ALIAS = { db: 'dumbbell', bb: 'barbell', kb: 'kettlebell', rdl: 'romanian', bw: 'body' };
// Gym names the dataset words differently (applied to the normalised query before splitting).
const SEARCH_PHRASES = [[/\bpec (deck|fly|flye)\b/g, 'butterfly'], [/\bohp\b/g, 'shoulder press'], [/\bskull ?crushers?\b/g, 'skull']];

// Workout-day colours: a CVD-checked set (blue, magenta, yellow, green). Never rely on colour alone —
// every coloured dot also carries the day number.
const DAY_COLORS = ['blue', 'magenta', 'yellow', 'green'];
const dayColor = c => (DAY_COLORS.includes(c) ? c : 'blue');
const dayBg = c => `var(--day-${dayColor(c)})`;
const dayInk = c => `var(--on-day-${dayColor(c)})`;
/** A custom-exercise photo is only ever a JPEG/PNG/WebP data URL (anything else is dropped). */
const safePhoto = p => (typeof p === 'string' && /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/]+=*$/i.test(p) ? p : null);

const DEFAULT_TEMPLATES = [
  { id: 'd1', name: 'Chest + Triceps', color: 'blue', items: [
    ['Barbell_Bench_Press_-_Medium_Grip', 4, 8], ['Incline_Dumbbell_Press', 3, 10], ['Cable_Crossover', 3, 12],
    ['Dips_-_Chest_Version', 3, 10], ['Triceps_Pushdown', 3, 12], ['EZ-Bar_Skullcrusher', 3, 10],
    ['Cable_Rope_Overhead_Triceps_Extension', 3, 12]] },
  { id: 'd2', name: 'Back + Biceps', color: 'magenta', items: [
    ['Barbell_Deadlift', 3, 5], ['Pullups', 3, 8], ['Bent_Over_Barbell_Row', 4, 8], ['Wide-Grip_Lat_Pulldown', 3, 10],
    ['Seated_Cable_Rows', 3, 10], ['Barbell_Curl', 3, 10], ['Hammer_Curls', 3, 12]] },
  { id: 'd3', name: 'Shoulders', color: 'yellow', items: [
    ['Standing_Military_Press', 4, 8], ['Arnold_Dumbbell_Press', 3, 10], ['Side_Lateral_Raise', 4, 12],
    ['Front_Dumbbell_Raise', 3, 12], ['Reverse_Flyes', 3, 12], ['Face_Pull', 3, 15], ['Barbell_Shrug', 3, 12]] },
  { id: 'd4', name: 'Legs', color: 'green', items: [
    ['Barbell_Full_Squat', 4, 8], ['Romanian_Deadlift', 3, 10], ['Leg_Press', 3, 12], ['Lying_Leg_Curls', 3, 12],
    ['Leg_Extensions', 3, 12], ['Barbell_Walking_Lunge', 3, 10], ['Standing_Calf_Raises', 4, 15]] },
];
// Heavy compound lifts start with a longer rest; everything else uses the default.
const DEFAULT_RESTS = {
  'Barbell_Bench_Press_-_Medium_Grip': 150, Barbell_Deadlift: 180, Bent_Over_Barbell_Row: 120,
  Standing_Military_Press: 150, Barbell_Full_Squat: 180, Romanian_Deadlift: 120, Leg_Press: 120, Pullups: 120,
};
const DEFAULT_SETTINGS = { theme: 'system', defaultRest: 90, vibrate: true, sound: true, wakeLock: true, restByEx: {}, seeded: false, lastBackup: 0, installHidden: false };

const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  more: '<g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></g>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  pause: '<g fill="currentColor" stroke="none"><rect x="6.5" y="5" width="3.8" height="14" rx="1"/><rect x="13.7" y="5" width="3.8" height="14" rx="1"/></g>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g>',
  dumbbell: '<path d="M6.5 6.5v11M3.5 9.5v5M17.5 6.5v11M20.5 9.5v5M6.5 12h11"/>',
  timer: '<path d="M12 9v4l2.5 1.5M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM9.5 2.5h5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 5.5H5.5a2.5 2.5 0 0 0 2.6 4M16 5.5h2.5a2.5 2.5 0 0 1-2.6 4M12 13v3.5M8.5 20.5h7M9.5 20.5c0-2 1-4 2.5-4s2.5 2 2.5 4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  camera: '<path d="M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/>',
  info: '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.8v.2"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  search: '<path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.6-3.6"/>',
  chart: '<path d="M4 19h16M7 15.5v-4M12 15.5V6.5M17 15.5V9.5"/>',
  calendar: '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M9 3v4M15 3v4"/>',
  offline: '<path d="M12 4v10M8 10l4 4 4-4M5 17v1a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1"/>',
  phone: '<path d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2"/>',
  cloudOff: '<path d="M3 3l18 18M8.5 6.4A6 6 0 0 1 18 9.5a4 4 0 0 1 2.4 7.1M17 18H7a4.5 4.5 0 0 1-1.6-8.7"/>',
  copy: '<path d="M9 9h10v12H9zM5 15V3h10"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
  key: '<path d="M14.5 9.5a4 4 0 1 1-7.9.9 4 4 0 0 1 7.9-.9zM13.6 12.4L21 19.8M17.5 16.3l2-2"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
  user: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1-.5 9z"/>',
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

// ============================================================ 3. storage (IndexedDB, tiny wrapper)
// The phone keeps a full copy of the signed-in user's data, so the app works offline.
// Every write to a synced store also lands in `outbox` (same transaction); the sync engine
// pushes the outbox to D1 and pulls other devices' changes back.
const SYNCED = { sessions: ['session', 'id'], templates: ['template', 'id'], bodyweight: ['bodyweight', 'date'], custom: ['custom', 'id'], settings: ['settings', 'key'] };
const KIND_STORE = Object.fromEntries(Object.entries(SYNCED).map(([store, [kind]]) => [kind, store]));
const STORES = { settings: 'key', templates: 'id', sessions: 'id', bodyweight: 'date', custom: 'id', outbox: 'key', meta: 'key' };
let dbPromise;
function idb() {
  return dbPromise ||= new Promise((res, rej) => {
    const r = indexedDB.open('gym-tracker', 2);
    r.onupgradeneeded = () => {
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name, { keyPath });
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const txDone = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
const reqDone = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const db = {
  async all(store) { return reqDone((await idb()).transaction(store).objectStore(store).getAll()); },
  async get(store, key) { return reqDone((await idb()).transaction(store).objectStore(store).get(key)); },
  async count(store) { return reqDone((await idb()).transaction(store).objectStore(store).count()); },
  /**
   * ops: [{store, value} | {store, key, del: true}] in one transaction.
   * sync (default true) queues each change for the cloud; updatedAt overrides the change time
   * (1 = "older than anything", used for defaults so a real copy in the cloud always wins).
   */
  async write(ops, { sync = true, updatedAt } = {}) {
    if (!ops.length) return;
    const queue = sync && ops.some(o => SYNCED[o.store]);
    const tx = (await idb()).transaction([...new Set([...ops.map(o => o.store), ...(queue ? ['outbox'] : [])])], 'readwrite');
    const when = updatedAt ?? Date.now();
    for (const o of ops) {
      const os = tx.objectStore(o.store);
      if (o.del) os.delete(o.key); else os.put(o.value);
      if (queue && SYNCED[o.store]) {
        const id = String(o.del ? o.key : o.value[SYNCED[o.store][1]]);
        tx.objectStore('outbox').put({ key: `${o.store}|${id}`, store: o.store, id, deleted: !!o.del, data: o.del ? null : o.value, updatedAt: when });
      }
    }
    await txDone(tx);
    if (queue) onLocalChange();
  },
  put(store, value, opts) { return db.write([{ store, value }], opts); },
  del(store, key, opts) { return db.write([{ store, key, del: true }], opts); },
  /** Make the synced stores match `data` (import / erase) as ordinary changes, so the cloud follows. */
  async replaceAll(data) {
    const ops = [];
    for (const [store, [, key]] of Object.entries(SYNCED)) {
      const next = data[store] || [], keep = new Set(next.map(v => String(v[key])));
      for (const v of await db.all(store)) if (!keep.has(String(v[key]))) ops.push({ store, key: v[key], del: true });
      for (const v of next) ops.push({ store, value: v });
    }
    await db.write(ops);
  },
  /** Forget everything on this device (sign-out). */
  async wipe() {
    const tx = (await idb()).transaction(Object.keys(STORES), 'readwrite');
    for (const n of Object.keys(STORES)) tx.objectStore(n).clear();
    await txDone(tx);
  },
};
const metaGet = async key => (await db.get('meta', key))?.value;
const metaSet = (key, value) => db.write([{ store: 'meta', value: { key, value } }], { sync: false });

// ============================================================ 4. state & domain logic
const S = {
  base: [],          // free-exercise-db entries
  custom: [],        // user's own exercises
  ex: [],            // both, sorted by name
  exMap: new Map(),
  templates: [],     // the 4 workout days
  sessions: [],      // every session, sorted by start (the active one has end === null)
  bw: [],            // bodyweight entries, sorted by date
  settings: { ...DEFAULT_SETTINGS },
  active: null,
  rev: 0,            // bumped whenever finished-session data changes (memo key)
  auth: null,        // signed-in user {id, username, name, isAdmin, mustChange}
  locked: false,     // a sign-in screen is showing instead of the app
};

function indexExercises() {
  S.ex = [...S.custom, ...S.base].sort((a, b) => a.name.localeCompare(b.name));
  S.exMap = new Map(S.ex.map(e => [e.id, e]));
  for (const e of S.ex) e._s = norm(`${e.name} ${e.primaryMuscles.join(' ')} ${e.equipment || ''} ${e.custom ? 'custom' : ''}`);
}
/** Name for an exercise id; falls back to the name saved in sessions if the exercise was deleted. */
function exName(id, fallback) {
  const e = S.exMap.get(id);
  if (e) return e.name;
  if (fallback) return fallback;
  for (const s of S.sessions) { const x = s.exercises.find(y => y.exId === id && y.name); if (x) return x.name; }
  return 'Deleted exercise';
}

const saveSettings = () => db.put('settings', { key: 'prefs', ...S.settings });
const saveTemplate = t => db.put('templates', t);
const sortSessions = () => S.sessions.sort((a, b) => a.start - b.start);
const finished = () => S.sessions.filter(s => s.end);
const restFor = exId => S.settings.restByEx[exId] ?? S.settings.defaultRest;

function makeTemplate(t, order) {
  return { id: t.id, name: t.name, color: t.color, order, items: t.items.map(([exId, sets, reps]) => ({ exId, sets, reps })) };
}

/** Persist a session soon (inputs fire on every keystroke). Flushed when the app is hidden. */
const pendingSaves = new Map();
const flushSaves = debounce(() => {
  const saving = [...pendingSaves.values()].map(s => db.put('sessions', s).catch(err => console.error(err)));
  pendingSaves.clear();
  return Promise.all(saving);
}, 300);
function touchSession(s) {
  if (s.end) S.rev++;
  pendingSaves.set(s.id, s);
  flushSaves();
}

/** Working-set statistics for one exercise within one session. */
function setStats(sets) {
  let e1 = 0, topKg = 0, topReps = 0, vol = 0, maxReps = 0, reps = 0, n = 0;
  for (const s of sets) {
    if (!s.done || s.warmup || !(s.reps > 0)) continue;
    const kg = s.kg > 0 ? s.kg : 0;
    n++; reps += s.reps; vol += kg * s.reps;
    if (s.reps > maxReps) maxReps = s.reps;
    if (kg > 0) e1 = Math.max(e1, epley(kg, s.reps));
    if (kg > topKg || (kg === topKg && s.reps > topReps)) { topKg = kg; topReps = s.reps; }
  }
  return n ? { e1, topKg, topReps, vol, maxReps, reps, n } : null;
}
function setsByExercise(session) {
  const m = new Map();
  for (const e of session.exercises) {
    if (!m.has(e.exId)) m.set(e.exId, []);
    m.get(e.exId).push(...e.sets);
  }
  return m;
}
function sessionTotals(s) {
  let vol = 0, sets = 0, reps = 0;
  for (const e of s.exercises) for (const x of e.sets) {
    if (!x.done || x.warmup || !(x.reps > 0)) continue;
    sets++; reps += x.reps; vol += (x.kg > 0 ? x.kg : 0) * x.reps;
  }
  return { vol, sets, reps, exercises: s.exercises.filter(e => e.sets.some(x => x.done)).length, dur: (s.end || Date.now()) - s.start };
}

let memo = { rev: -1 };
/** One chronological pass over finished sessions: per-exercise timeline, running bests and PR events. */
function analysis() {
  if (memo.rev === S.rev) return memo;
  const timeline = new Map(), prs = new Map(), best = new Map();
  for (const s of S.sessions) {
    if (!s.end) continue;
    for (const [exId, sets] of setsByExercise(s)) {
      const st = setStats(sets);
      if (!st) continue;
      if (!timeline.has(exId)) timeline.set(exId, []);
      timeline.get(exId).push({ t: s.start, id: s.id, ...st });
      const b = best.get(exId);
      if (b) {
        const out = [];
        if (st.topKg > 0 && st.e1 > b.e1 + 0.05) out.push({ type: 'e1rm', value: st.e1, prev: b.e1 });
        if (st.topKg > b.topKg + 0.01) out.push({ type: 'weight', value: st.topKg, reps: st.topReps, prev: b.topKg });
        if (st.vol > 0 && st.vol > b.vol + 0.5) out.push({ type: 'volume', value: st.vol, prev: b.vol });
        if (st.topKg === 0 && b.bwReps > 0 && st.maxReps > b.bwReps) out.push({ type: 'reps', value: st.maxReps, prev: b.bwReps });
        if (out.length) {
          if (!prs.has(s.id)) prs.set(s.id, []);
          prs.get(s.id).push(...out.map(p => ({ exId, t: s.start, sid: s.id, ...p })));
        }
      }
      best.set(exId, {
        e1: Math.max(b?.e1 ?? 0, st.e1),
        topKg: Math.max(b?.topKg ?? 0, st.topKg),
        vol: Math.max(b?.vol ?? 0, st.vol),
        bwReps: st.topKg === 0 ? Math.max(b?.bwReps ?? 0, st.maxReps) : (b?.bwReps ?? 0),
      });
    }
  }
  memo = { rev: S.rev, timeline, prs, best };
  return memo;
}
const PR_LABEL = { e1rm: 'Estimated 1RM', weight: 'Heaviest weight', volume: 'Most volume', reps: 'Most reps' };
const prText = p => p.type === 'reps' ? `${p.value} reps` : p.type === 'weight' ? `${fmtW(p.value)} kg × ${p.reps}` : `${fmtNum(p.value, p.type === 'e1rm' ? 1 : 0)} kg`;

/** Sets from the most recent finished session that included this exercise. */
function lastSetsFor(exId) {
  for (let i = S.sessions.length - 1; i >= 0; i--) {
    const s = S.sessions[i];
    if (!s.end) continue;
    const sets = s.exercises.filter(e => e.exId === exId).flatMap(e => e.sets);
    if (sets.length) return sets;
  }
  return null;
}
/** A new exercise entry for a session, pre-filled from last time (or the template target). */
function newEntry(exId, sets = 3, reps = 10) {
  const last = lastSetsFor(exId);
  let rows;
  if (last) {
    rows = last.map(x => ({ reps: x.reps, kg: x.kg, warmup: !!x.warmup, done: false }));
    const work = rows.filter(r => !r.warmup);
    const model = work[work.length - 1] || rows[rows.length - 1];
    for (let n = work.length; n < sets; n++) rows.push({ ...model, warmup: false, done: false });
  } else {
    rows = Array.from({ length: sets }, () => ({ reps, kg: null, warmup: false, done: false }));
  }
  return { exId, name: exName(exId), target: { sets, reps }, sets: rows };
}

async function startSession(tplId) {
  const t = S.templates.find(x => x.id === tplId);
  const s = {
    id: uid('s'), templateId: t.id, name: t.name, color: t.color, start: Date.now(), end: null,
    exercises: t.items.filter(i => S.exMap.has(i.exId)).map(i => newEntry(i.exId, i.sets, i.reps)),
  };
  S.sessions.push(s);
  S.active = s;
  await db.put('sessions', s);
  keepAwake(true);
}
async function discardActive() {
  const s = S.active;
  if (!s) return;
  S.active = null;
  S.sessions = S.sessions.filter(x => x !== s);
  pendingSaves.delete(s.id);
  await db.del('sessions', s.id);
  stopRest();
  keepAwake(false);
}
async function deleteSession(s) {
  S.sessions = S.sessions.filter(x => x !== s);
  pendingSaves.delete(s.id);
  S.rev++;
  await db.del('sessions', s.id);
}
/** Next day in the rotation after the most recently finished one. */
function nextTemplateId() {
  const fin = finished();
  const last = fin[fin.length - 1];
  const i = last ? S.templates.findIndex(t => t.id === last.templateId) : -1;
  return S.templates[(i + 1) % S.templates.length]?.id;
}
const tplIndex = id => S.templates.findIndex(t => t.id === id);

// ============================================================ 5. UI infrastructure
const view = document.getElementById('view');
let A = {};                 // actions for the current view (data-action="name")
const GA = {};              // global actions
let leaveFns = [];
const onLeave = fn => leaveFns.push(fn);
const ROUTES = [];
const route = (re, fn) => ROUTES.push([re, fn]);
let navStack = [], scrollMem = {}, curHash = null, replacing = false;
// Listeners a view adds to long-lived nodes (view, document) go through on() and die with the view.
let viewAC = new AbortController(), renderToken = 0;
const on = (el, type, fn, opts) => el?.addEventListener(type, fn, { ...opts, signal: viewAC.signal });

const parseHash = () => {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  return { path: path || '/', q: new URLSearchParams(qs || '') };
};
const go = h => { location.hash = h; };
const replaceRoute = h => { replacing = true; location.replace(h); };
const goBack = fallback => (navStack.length > 1 ? history.back() : replaceRoute(fallback || '#/'));

/** Tear down the current view: its timers, listeners, actions and any open sheet. */
function resetView() {
  renderToken++;
  leaveFns.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  leaveFns = [];
  viewAC.abort();
  viewAC = new AbortController();
  A = {};
  closeSheetNow();
}
function renderRoute() {
  if (!S.auth || S.locked) return;
  resetView();
  document.body.classList.remove('auth-mode');
  const { path, q } = parseHash();
  let matched = false;
  for (const [re, fn] of ROUTES) {
    const m = path.match(re);
    if (m) { fn(q, ...m.slice(1).map(decodeURIComponent)); matched = true; break; }
  }
  if (!matched) notFound();
  const tab = /^\/(library|ex|custom)/.test(path) ? 'library' : /^\/progress/.test(path) ? 'progress'
    : /^\/(history|session)/.test(path) ? 'history' : /^\/(settings|about|admin)/.test(path) ? 'more' : 'train';
  for (const a of $$('.tabbar a')) {
    a.classList.toggle('on', a.dataset.tab === tab);
    a.toggleAttribute('aria-current', a.dataset.tab === tab);
  }
  const trainTab = $('.tabbar a[data-tab="train"]');
  trainTab.href = S.active ? '#/log' : '#/';
  trainTab.querySelector('.live-dot')?.remove();
  if (S.active) trainTab.insertAdjacentHTML('beforeend', '<span class="live-dot" aria-label="Workout in progress"></span>');
  paintSync();
}
function render() {
  if (!S.auth || S.locked) return;
  const hash = location.hash || '#/';
  let back = false;
  if (curHash !== null) scrollMem[curHash] = scrollY;
  if (replacing) { navStack[navStack.length - 1] = hash; replacing = false; }
  else if (navStack.length > 1 && navStack[navStack.length - 2] === hash) { navStack.pop(); back = true; }
  else if (navStack[navStack.length - 1] !== hash) navStack.push(hash);
  curHash = hash;
  renderRoute();
  scrollTo(0, back ? (scrollMem[hash] || 0) : 0);
}
/** Re-render the current route in place (after data changed), keeping the scroll position. */
function rerender() { const y = scrollY; renderRoute(); scrollTo(0, y); }
/** A callback that re-renders only if the same view is still showing (sheets also close on route change). */
const refreshIfSame = (fn = rerender) => { const t = renderToken; return () => { if (t === renderToken) fn(); }; };
function notFound() {
  view.innerHTML = topbar('Not found', { back: '#/' }) + `<div class="empty">That page doesn't exist.<br><br><a class="btn" href="#/">Go to Train</a></div>`;
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const name = el.dataset.action;
  const fn = (el.closest('.sheet') && sheet?.actions[name]) || A[name] || GA[name];
  if (fn) { e.preventDefault(); fn(el, e); }
});
GA.back = el => goBack(el.dataset.to);

function topbar(title, { back, sub, right = '' } = {}) {
  return `<header class="topbar ${back ? 'has-back' : ''}">
    ${back ? `<button class="icon-btn" data-action="back" data-to="${esc(back)}" aria-label="Back">${icon('back')}</button>` : ''}
    <h1>${esc(title)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</h1>${right}</header>`;
}

// ---- toast
function toast(msg, { action, fn, ms = 3200 } = {}) {
  const wrap = $('#toast');
  wrap.innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}</div>`;
  const t = wrap.firstChild;
  requestAnimationFrame(() => t.classList.add('show'));
  const hide = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); };
  if (action) t.querySelector('button').onclick = () => { hide(); fn(); };
  clearTimeout(toast.timer);
  toast.timer = setTimeout(hide, ms);
}

// ---- bottom sheets. Each open sheet owns one history entry so the Android back button closes it.
let sheet = null, popWaiter = null;
function openSheet(html, actions = {}, { onClose, onOpen } = {}) {
  closeSheetNow();
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const el = document.createElement('div');
  el.className = 'sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="grab"></div>${html}`;
  document.body.append(scrim, el);
  requestAnimationFrame(() => { scrim.classList.add('open'); el.classList.add('open'); });
  scrim.addEventListener('click', () => closeSheet());
  history.pushState({ sheet: true }, '');
  sheet = { el, scrim, actions, onClose };
  onOpen?.(el);
  return el;
}
function dropSheetDom(s) {
  s.el.classList.remove('open');
  s.scrim.classList.remove('open');
  setTimeout(() => { s.el.remove(); s.scrim.remove(); }, 260);
}
/** Close the sheet and wait until its history entry is gone, so a navigation right after is safe. */
function closeSheet() {
  return new Promise(res => {
    if (!sheet) return res();
    const s = sheet;
    sheet = null;
    dropSheetDom(s);
    const done = () => { s.onClose?.(); res(); };
    popWaiter = done;
    history.back();
    setTimeout(() => { if (popWaiter === done) { popWaiter = null; done(); } }, 600);
  });
}
function closeSheetNow() {
  if (!sheet) return;
  const s = sheet;
  sheet = null;
  s.el.remove(); s.scrim.remove();
  s.onClose?.();
}
addEventListener('popstate', () => {
  if (popWaiter) { const f = popWaiter; popWaiter = null; f(); return; }
  if (sheet) { const s = sheet; sheet = null; dropSheetDom(s); s.onClose?.(); }
});
addEventListener('keydown', e => { if (e.key === 'Escape' && sheet) closeSheet(); });

/** Bottom-sheet question with labelled buttons. Resolves with the chosen value (null if dismissed). */
function ask({ title, msg = '', buttons }) {
  return new Promise(res => {
    let val = null;
    openSheet(`<h2>${esc(title)}</h2>${msg ? `<p class="msg">${msg}</p>` : ''}
      <div class="opts">${buttons.map((b, i) => `<button class="btn block lg ${b.cls || ''}" data-action="ask" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`,
    { ask: el => { val = buttons[+el.dataset.i].value; closeSheet(); } },
    { onClose: () => res(val) });
  });
}
const confirmSheet = (title, msg, label, cls = 'primary') =>
  ask({ title, msg, buttons: [{ label, value: true, cls }, { label: 'Cancel', value: false, cls: 'ghost' }] });

// ---- theme
function applyTheme() {
  const t = S.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('gym-theme', t); } catch { /* private mode */ }
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  for (const m of $$('meta[name="theme-color"]')) {
    m.content = t === 'system' ? (m.media.includes('dark') ? '#0d0f12' : '#f3f4f6') : bg;
  }
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.settings.theme === 'system') rerender(); });

// ============================================================ 6. components
function thumbHtml(e, extra = '') {
  if (e?.custom && safePhoto(e.photo)) return `<img class="thumb" src="${safePhoto(e.photo)}" alt="" ${extra}>`;
  if (e?.img) return `<img class="thumb" src="${thumbUrl(e.id)}" loading="lazy" decoding="async" width="76" height="51" alt="" ${extra}>`;
  return `<div class="thumb ph" ${extra}>${icon('dumbbell')}</div>`;
}
const subline = e => [e.primaryMuscles.map(m => MUSCLE_LABEL[m] || cap(m)).join(', '), equipLabel(e.equipment), e.custom ? 'Custom' : cap(e.level)].filter(Boolean).join(' · ');

// ---- animated demo: crossfade start/end photos like a GIF
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function demoHtml(e) {
  if (e.custom) return safePhoto(e.photo) ? `<div class="demo photo"><img src="${safePhoto(e.photo)}" alt="${esc(e.name)}"></div>` : `<div class="demo ph">${icon('dumbbell')}</div>`;
  if (!e.img) return `<div class="demo ph" title="No photos for this exercise">${icon('dumbbell')}</div>`;
  return `<div class="demo" data-demo data-action="demo-toggle">
    <img class="f0" src="${imgUrl(e.id, 0)}" alt="${esc(e.name)}, start position" decoding="async">
    <img class="f1" src="${imgUrl(e.id, 1)}" alt="${esc(e.name)}, end position" decoding="async">
    <button class="ctl" data-action="demo-toggle" aria-label="Play or pause the demo">${icon('play')}<span>Play</span></button>
    <div class="frame" aria-hidden="true"><i class="on"></i><i></i></div>
  </div>`;
}
function startDemos(root) {
  for (const el of $$('[data-demo]', root)) {
    if (el._demo) continue;
    const d = el._demo = { timer: 0, end: false };
    const btn = $('.ctl', el), dots = $$('.frame i', el);
    const paint = () => {
      btn.innerHTML = `${icon(d.timer ? 'pause' : 'play')}<span>${d.timer ? 'Pause' : 'Play'}</span>`;
      el.classList.toggle('end', d.end);
      dots.forEach((x, i) => x.classList.toggle('on', i === +d.end));
    };
    const step = () => {
      if (!el.isConnected) return d.pause();
      if (document.hidden) return;
      d.end = !d.end;
      paint();
    };
    d.play = () => { if (!d.timer) d.timer = setInterval(step, 1200); paint(); };
    d.pause = () => { clearInterval(d.timer); d.timer = 0; if (el.isConnected) paint(); };
    paint();
    // Start once both frames are decoded so the first crossfade isn't to a blank image.
    Promise.all($$('img', el).map(i => i.decode().catch(() => {}))).then(() => { if (el.isConnected && !reduceMotion) d.play(); });
  }
}
GA['demo-toggle'] = el => { const d = el.closest('[data-demo]')?._demo; if (d) (d.timer ? d.pause() : d.play()); };

// ---- muscle map: a simple front/back figure. Shapes are drawn for the left half and mirrored.
const MM_HANDS = '<ellipse cx="19.3" cy="130" rx="4.6" ry="7.6" transform="rotate(10 19.3 130)"/>';
const MM_KNEE = '<ellipse cx="49" cy="182.5" rx="5.2" ry="4.4"/>';
const MM_DELT = 'M36 47c-6.5.5-11 5.5-11.5 13-.2 4 .5 7.5 2 10 2-5.5 5.5-10 10-13 3-2 5-4.5 6-7-2-1.5-4-2.7-6.5-3z';
const MM_UPPER_ARM = 'M26.5 71.5c2.5-5.5 6-9.5 10-12 1 6.5 0 14.5-2 21.5-1 4-2.5 7.5-4.5 10-3-1-5.5-3-6.5-6-.5-5 1-9.5 3-13.5z';
const MM_FOREARM = 'M23.5 88c2.5 3 5 4.5 7.5 5 0 7-2 15-4.5 22-1 3-2 6-3 8l-6-1.5c-.5-7.5.5-16.5 2-23.5 1-4 2.5-7 4-10z';
const MM_FRONT = {
  base: '<ellipse cx="60" cy="20" rx="11" ry="13.5"/>',
  half: MM_HANDS + MM_KNEE + '<path d="M45.5 231h5c1 4 2.5 7 2.5 9.5 0 2-2 3-4.5 3H45c-1.5 0-2-1.5-1.7-3.5.5-3 1.5-6 2.2-9z"/>',
  m: [
    ['neck', 'M54.5 32l5 1v11H52z'],
    ['traps', 'M52 40.5c-5 3-10 4.5-15.5 5.5 3.5 2.5 7.5 3.5 11 3.5 2.5-2.5 4.5-4.5 5.5-6.5z'],
    ['shoulders', MM_DELT],
    ['chest', 'M59.5 49v21c-4.5 3.5-11 4-16 1.5-4-2-6-6-5.7-11 .7-5.5 3.7-9.5 7.7-11 4.5-1.5 9.5-1.2 14-.5z'],
    ['biceps', MM_UPPER_ARM],
    ['forearms', MM_FOREARM],
    ['abdominals', 'M52.2 76.2a2.2 2.2 0 0 1 2.2-2.2h5.1v9.5h-5.1a2.2 2.2 0 0 1-2.2-2.2zM52.2 87.7a2.2 2.2 0 0 1 2.2-2.2h5.1V95h-5.1a2.2 2.2 0 0 1-2.2-2.2zM52.2 99.2a2.2 2.2 0 0 1 2.2-2.2h5.1v9.5h-5.1a2.2 2.2 0 0 1-2.2-2.2zM52.4 108.5h7.1V125c-3-2-5.5-5.5-6.5-10z'],
    ['abdominals', 'M40 73c3.5 1.5 7 2.5 10.5 2.5V111c-3.5-1-6.5-3.5-8.5-7-2-8-2.5-20-2-31z'],
    ['abductors', 'M40.5 106.5c2.5 3.5 6 6.5 9.5 8-2 3-4.5 6-7.5 8-2.5-4.5-3-10.5-2-16z'],
    ['quadriceps', 'M43 124c3.5-3.5 7.5-7 10.5-7.5 2.5 4.5 3.5 11.5 3.5 19.5 0 13-1.5 26-4 36-1.5 4.5-4.5 6-7 4.5-4-6.5-6-18.5-6-31.5 0-9 1-16 3-21z'],
    ['adductors', 'M55.5 117c2 2.5 3.5 6 3.8 10l-.3 23c-1-4.5-1.5-10-1.5-16 0-6.5-.7-12-2-17z'],
    ['calves', 'M44.5 188c2-1.5 5-1.5 8 0 1.5 8 1.5 18 0 28-1 6-2 10-2.5 13h-4c-1.5-7-3-17-3-27 0-6 .5-10.5 1.5-14z'],
  ],
};
const MM_BACK = {
  base: '<ellipse cx="60" cy="20" rx="11" ry="13.5"/>',
  half: MM_HANDS + MM_KNEE + '<path d="M46.5 219h4.5l-.5 10h-4z"/><ellipse cx="48.5" cy="236" rx="4.6" ry="7"/>',
  m: [
    ['traps', 'M59.5 30v52c-3-4-6-9.5-8.5-15.5-2.5-6.5-6-12.5-10.5-16.5-2-1.5-3.5-2.5-4-3.5 5.5-1 10.5-3 14.5-6.5 3-3 5.5-6.5 8.5-10z'],
    ['shoulders', MM_DELT],
    ['triceps', MM_UPPER_ARM],
    ['forearms', MM_FOREARM],
    ['middle back', 'M41 55c4 3 7.5 8 9.5 14 1.5 4.5 3.5 8.5 6 12-4.5 2-9.5 1.5-13-1-3-5-4-12-3.7-18 .2-3 .6-5.2 1.2-7z'],
    ['lats', 'M39.8 76c3.2 5 8.2 8.5 14.2 9.5 2 .5 4 1 5.5 1.5v12c-3.5 1-6.5 2.5-9 4-4-4-7.5-10-9.5-16-1-4-1.4-7.5-1.2-11z'],
    ['lower back', 'M52.5 104.5c2.5-1.3 4.8-2.1 7-2.5v20c-2.5-.5-4.5-1.5-6-3-.9-5-1.2-9.5-1-14.5z'],
    ['abductors', 'M41.5 104c3 3 6.5 6.5 10 9-3.5 1.5-7 4.5-9.5 8-1.7-5.5-1.7-11.5-.5-17z'],
    ['glutes', 'M59.5 123.5v18.5c-4.5 3.5-10.5 4.5-15 2-3-3-3.7-9-2.7-15 .7-4 2.7-8 5.2-10.5 4 2 8.5 4.8 12.5 5z'],
    ['hamstrings', 'M43 147.5c4.5 1.5 9 1.5 13.5 0 1 7.5.5 15.5-1.5 23-1.5 4.5-3.5 7-6.5 7-3-.5-5-4-6-8.5-1.2-7-1-15 .5-21.5z'],
    ['adductors', 'M57 146.5l2.4-1.5-.2 18c-1.3-5-2-10.5-2.2-16.5z'],
    ['calves', 'M43.5 189c2.5-2.2 6.5-2.7 10-1 2 5 2.5 12 1 19-1.5 5-3.5 9-5 12-2.5-3-4.5-7-5.5-12-1.5-6-1.5-12.5-.5-18z'],
  ],
};
/** fillFor(muscle) returns a CSS colour for highlighted muscles, or a falsy value for the neutral fill. */
function muscleMap(fillFor, label) {
  const fig = (F, dx) => {
    const paint = F.m.map(([m, d]) => `<path d="${d}" style="fill:${fillFor(m) || 'var(--mm-muscle)'}"><title>${MUSCLE_LABEL[m]}</title></path>`).join('');
    const sil = F.half + F.m.map(([, d]) => `<path d="${d}"/>`).join('');
    const mirror = '<g transform="matrix(-1 0 0 1 120 0)">';
    return `<g transform="translate(${dx} 0)"><g class="mm-sil">${F.base}${sil}${mirror}${sil}</g></g>${paint}${mirror}${paint}</g></g>`;
  };
  return `<svg class="mm" viewBox="0 0 240 258" role="img" aria-label="${esc(label)}">${fig(MM_FRONT, 0)}${fig(MM_BACK, 120)}
    <text x="60" y="256">Front</text><text x="180" y="256">Back</text></svg>`;
}
const HEAT_STEPS = [[0.5, 1], [4, 2], [8, 3], [12, 4]]; // weekly sets -> ramp step
const heatLevel = v => HEAT_STEPS.reduce((lvl, [min, l]) => (v >= min ? l : lvl), 0);
const heatLegend = () => `<div class="heat-legend"><span>Sets / week</span>
  <i style="background:var(--mm-muscle)"></i>0 <i style="background:var(--heat-1)"></i>1–3
  <i style="background:var(--heat-2)"></i>4–7 <i style="background:var(--heat-3)"></i>8–11 <i style="background:var(--heat-4)"></i>12+</div>`;

// ---- charts (canvas, no library). Thin 2px lines, ringed markers, hairline grid, crosshair + tooltip.
function niceTicks(min, max, count) {
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}
/**
 * series: [{ points: [{x, y, ...}], color: '--accent', kind: 'line' | 'dots', area }]
 * series[hoverIndex] is the one the crosshair snaps to; tip(point) returns the tooltip HTML.
 */
function lineChart(host, { series, height = 190, yFmt = v => fmtNum(v), tip, hoverIndex = 0 }) {
  const pts = series.flatMap(s => s.points);
  if (!pts.length) { host.innerHTML = '<div class="empty small">Nothing logged in this range yet.</div>'; return; }
  const cv = document.createElement('canvas');
  const tipEl = document.createElement('div');
  tipEl.className = 'tip';
  tipEl.hidden = true;
  host.replaceChildren(cv, tipEl);
  let x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x));
  if (x1 - x0 < DAY) { x0 -= 3 * DAY; x1 += 3 * DAY; }
  let y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y));
  if (y1 - y0 < 1e-6) { const padY = Math.max(1, Math.abs(y1) * 0.05); y0 -= padY; y1 += padY; }
  const ticks = niceTicks(y0, y1, 4);
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const target = series[hoverIndex].points;
  let hover = -1, geo = null;

  const draw = () => {
    const w = host.clientWidth;
    if (!w) return;
    const cs = getComputedStyle(host);
    const col = n => cs.getPropertyValue(n).trim();
    const dpr = (devicePixelRatio || 1) * (window.UI_ZOOM || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(height * dpr);
    cv.style.height = height + 'px';
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.font = `500 11.5px ${col('--font') || 'system-ui'}`;
    const L = Math.ceil(Math.max(...ticks.map(t => g.measureText(yFmt(t)).width))) + 12, R = 12, T = 12, B = 26;
    const X = x => L + (x - x0) / (x1 - x0) * (w - L - R);
    const Y = y => T + (1 - (y - lo) / (hi - lo)) * (height - T - B);
    geo = { X, Y, w };
    g.lineWidth = 1;
    g.textBaseline = 'middle';
    for (const t of ticks) {
      const y = Math.round(Y(t)) + 0.5;
      g.strokeStyle = t === lo ? col('--axis') : col('--grid');
      g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
      g.fillStyle = col('--muted'); g.textAlign = 'right';
      g.fillText(yFmt(t), L - 8, y);
    }
    const span = x1 - x0;
    const xf = span > 300 * DAY ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' };
    const days = [...new Set(pts.map(p => ymd(p.x)))];
    const xs = days.length <= 4 ? days.map(parseYmd) : [0, 1 / 3, 2 / 3, 1].map(f => x0 + f * span);
    g.textBaseline = 'alphabetic';
    xs.forEach((x, i) => {
      const px = X(x);
      g.textAlign = xs.length > 1 && i === 0 && px < L + 30 ? 'left' : i === xs.length - 1 && px > w - R - 30 ? 'right' : 'center';
      g.fillText(fmtDate(x, xf), px, height - 7);
    });
    const ring = (x, y, r, c) => {
      g.beginPath(); g.arc(x, y, r + 2, 0, Math.PI * 2); g.fillStyle = col('--surface'); g.fill();
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = c; g.fill();
    };
    for (const s of series) {
      const c = col(s.color);
      const P = s.points.map(p => [X(p.x), Y(p.y)]);
      if (s.kind === 'dots') { P.forEach(([x, y]) => ring(x, y, 4, c)); continue; }
      if (s.area && P.length > 1) {
        g.beginPath(); g.moveTo(P[0][0], Y(lo));
        P.forEach(([x, y]) => g.lineTo(x, y));
        g.lineTo(P[P.length - 1][0], Y(lo)); g.closePath();
        g.globalAlpha = 0.1; g.fillStyle = c; g.fill(); g.globalAlpha = 1;
      }
      g.beginPath();
      P.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.strokeStyle = c; g.lineWidth = 2; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke();
      P.forEach(([x, y], i) => { if ((s.markers !== 'last' && P.length <= 24) || i === P.length - 1) ring(x, y, 4, c); });
    }
    if (hover >= 0 && target[hover]) {
      const p = target[hover], x = X(p.x), y = Y(p.y);
      g.strokeStyle = col('--axis'); g.lineWidth = 1;
      g.beginPath(); g.moveTo(Math.round(x) + 0.5, T); g.lineTo(Math.round(x) + 0.5, height - B); g.stroke();
      ring(x, y, 5.5, col(series[hoverIndex].color));
      tipEl.innerHTML = tip(p);
      tipEl.hidden = false;
      const tw = tipEl.offsetWidth;
      tipEl.style.left = Math.min(Math.max(x, tw / 2), w - tw / 2) + 'px';
      tipEl.style.top = Math.max(0, y - tipEl.offsetHeight - 14) + 'px';
    } else tipEl.hidden = true;
  };
  const pick = ev => {
    if (!geo || !target.length) return;
    const mx = (ev.clientX - cv.getBoundingClientRect().left) / (window.UI_ZOOM || 1);
    let best = 0;
    target.forEach((p, i) => { if (Math.abs(geo.X(p.x) - mx) < Math.abs(geo.X(target[best].x) - mx)) best = i; });
    if (best !== hover) { hover = best; draw(); }
  };
  cv.addEventListener('pointerdown', pick);
  cv.addEventListener('pointermove', ev => { if (ev.pointerType === 'mouse' || ev.buttons) pick(ev); });
  cv.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') { hover = -1; draw(); } });
  const ro = new ResizeObserver(draw);
  ro.observe(host);
  onLeave(() => ro.disconnect());
  draw();
}
function spark(vals) {
  if (vals.length < 2) return '<svg class="spark" aria-hidden="true"></svg>';
  const w = 76, h = 30, p = 4, mn = Math.min(...vals), mx = Math.max(...vals);
  const y = v => (mx === mn ? h / 2 : h - p - (v - mn) / (mx - mn) * (h - 2 * p));
  const P = vals.map((v, i) => [p + i * (w - 2 * p) / (vals.length - 1), y(v)]);
  const [lx, ly] = P[P.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${P.map(q => q.map(n => n.toFixed(1)).join(',')).join(' ')}"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.5"/></svg>`;
}

// ---- drag to reorder (pointer events, works with touch). Items need [data-i]; the grip is .drag-handle.
function dragReorder(list, onDrop) {
  list.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    e.preventDefault();
    // Measure everything in client (screen) pixels from the starting layout; only the CSS
    // transforms are divided by the UI zoom (see the desktop-site fix in index.html).
    const z = window.UI_ZOOM || 1;
    const items = [...list.children];
    const item = handle.closest('[data-i]');
    const from = items.indexOf(item);
    const rects = items.map(el => el.getBoundingClientRect());
    const slot = rects[from + 1] ? rects[from + 1].top - rects[from].top : rects[from - 1] ? rects[from].top - rects[from - 1].top : rects[from].height;
    const listTop = list.getBoundingClientRect().top, startY = e.clientY;
    let to = from, lastY = e.clientY, raf = 0;
    item.classList.add('dragging');
    items.forEach(el => el !== item && el.classList.add('shifting'));
    handle.setPointerCapture(e.pointerId);
    const update = () => {
      const scrolled = list.getBoundingClientRect().top - listTop;
      const dy = lastY - startY - scrolled;
      item.style.transform = `translateY(${dy / z}px)`;
      const center = rects[from].top + rects[from].height / 2 + dy;
      to = from;
      rects.forEach((r, i) => {
        const mid = r.top + r.height / 2;
        if (i < from && center < mid) to = Math.min(to, i);
        if (i > from && center > mid) to = Math.max(to, i);
      });
      items.forEach((el, i) => {
        if (el === item) return;
        const shift = from < to && i > from && i <= to ? -slot : to < from && i >= to && i < from ? slot : 0;
        el.style.transform = shift ? `translateY(${shift / z}px)` : '';
      });
    };
    const autoScroll = () => {
      const edge = 70;
      if (lastY < edge) scrollBy(0, -8); else if (lastY > innerHeight - edge - 70) scrollBy(0, 8);
      update();
      raf = requestAnimationFrame(autoScroll);
    };
    raf = requestAnimationFrame(autoScroll);
    const ac = new AbortController();
    const end = () => {
      ac.abort();
      cancelAnimationFrame(raf);
      items.forEach(el => { el.style.transform = ''; el.classList.remove('shifting', 'dragging'); });
      if (to !== from) onDrop(from, to);
    };
    handle.addEventListener('pointermove', ev => { lastY = ev.clientY; }, { signal: ac.signal });
    handle.addEventListener('pointerup', end, { signal: ac.signal });
    handle.addEventListener('pointercancel', end, { signal: ac.signal });
  });
}

// ============================================================ 7. views
const dotN = (color, label) => `<span class="dot-n" style="background:${dayBg(color)};color:${dayInk(color)}">${label}</span>`;
GA.start = el => startOrResume(el.dataset.id);
GA.replace = el => replaceRoute(el.dataset.to);

async function startOrResume(tplId) {
  if (S.active) {
    if (S.active.templateId === tplId) return go('#/log');
    const r = await ask({
      title: `${S.active.name} is in progress`,
      msg: `Started ${fmtTime(S.active.start)}. Finish or discard it before starting another day.`,
      buttons: [
        { label: `Resume ${S.active.name}`, value: 'resume', cls: 'primary' },
        { label: 'Discard it and start this day', value: 'new', cls: 'danger' },
        { label: 'Cancel', value: null, cls: 'ghost' },
      ],
    });
    if (r === 'resume') return go('#/log');
    if (r !== 'new') return;
    await discardActive();
  }
  await startSession(tplId);
  go('#/log');
}

// ---------------------------------------------------------------- Train (home)
route(/^\/$/, () => {
  const now = Date.now(), fin = finished(), next = nextTemplateId(), wk = startOfWeek(now);
  const lastBy = {};
  for (const s of fin) lastBy[s.templateId] = s;
  const strip = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(wk, i), key = ymd(d);
    const hit = [...fin, ...(S.active ? [S.active] : [])].find(s => ymd(s.start) === key);
    const circle = hit
      ? `<b style="background:${dayBg(hit.color)};color:${dayInk(hit.color)}" title="${esc(hit.name)}">${tplIndex(hit.templateId) + 1 || '•'}</b>`
      : `<b>${new Date(d).getDate()}</b>`;
    return `<div class="${key === ymd(now) ? 'today' : ''} ${hit ? 'hit' : ''}">${fmtDate(d, { weekday: 'narrow' })}${circle}</div>`;
  }).join('');
  const weekCount = fin.filter(s => s.start >= wk).length;

  let banner = '';
  const lastText = t => (lastBy[t.id] ? `last done ${relDay(lastBy[t.id].start)}` : 'not done yet');
  const up = !S.active && S.templates.find(t => t.id === next);
  if (S.active) {
    const t = sessionTotals(S.active);
    banner = `<a class="live-banner" href="#/log">${icon('timer')}<div class="grow" style="flex:1"><b>${esc(S.active.name)} in progress</b>
      <span>Started ${fmtTime(S.active.start)} · ${plural(t.sets, 'set')} done</span></div>${icon('next')}</a>`;
  } else if (up?.items.length) {
    // The next day in the rotation, one tap away at the top of the screen.
    const i = tplIndex(up.id);
    banner = `<section class="card next-card" style="--day:${dayBg(up.color)}">
      <div class="next-top">${dotN(up.color, i + 1)}<span class="eyebrow">Up next · Day ${i + 1}</span></div>
      <h2>${esc(up.name)}</h2>
      <div class="small muted">${plural(up.items.length, 'exercise')} · ${lastText(up)}</div>
      <button class="btn primary lg block" data-action="start" data-id="${esc(up.id)}">${icon('play')}Start ${esc(up.name)}</button></section>`;
  }
  const install = installEvt && !S.settings.installHidden ? `<section class="card"><div class="row">${icon('phone')}<div style="flex:1"><b>Install Gym Tracker</b>
    <div class="small muted">Home-screen icon, full screen, works offline.</div></div><button class="icon-btn" data-action="hide-install" aria-label="Dismiss">${icon('x')}</button></div>
    <button class="btn primary block" style="margin-top:12px" data-action="install">Install app</button></section>` : '';

  const cards = S.templates.map((t, i) => {
    const isLive = S.active?.templateId === t.id;
    return `<article class="card day-card">
      <div class="stripe" style="background:${dayBg(t.color)}"></div>
      <div class="body">
        <div class="head">${dotN(t.color, i + 1).replace('dot-n', 'day-num')}
          <div style="flex:1;min-width:0"><h2>${esc(t.name)}</h2>
            <div class="meta">${plural(t.items.length, 'exercise')} · ${lastText(t)}</div></div>
          ${isLive ? '<span class="tag good next-tag">In progress</span>' : t.id === next && !S.active ? '<span class="tag accent next-tag">Next up</span>' : ''}
        </div>
        <div class="preview">${t.items.map(x => esc(exName(x.exId))).join(' · ') || 'No exercises yet'}</div>
        <div class="actions">
          <button class="btn lg ${isLive ? 'good' : ''}" data-action="start" data-id="${esc(t.id)}" ${t.items.length ? '' : 'disabled'}>${icon(isLive ? 'next' : 'play')}${isLive ? 'Resume' : 'Start'}</button>
          <a class="btn lg outline" href="#/day/${esc(t.id)}" aria-label="Edit ${esc(t.name)}">${icon('edit')}Edit</a>
        </div>
      </div></article>`;
  }).join('');

  view.innerHTML = topbar('Train', {
    sub: fmtDate(now, { weekday: 'long', month: 'long', day: 'numeric' }),
    right: `<button class="icon-btn" id="sync-ind" data-action="go-settings" hidden>${icon('cloudOff')}</button>`,
  }) + `${banner}
    <section class="card"><div class="row"><b style="flex:1">This week</b><span class="small muted">${plural(weekCount, 'workout')}</span></div>
      <div class="week-strip">${strip}</div></section>
    ${install}
    <div class="section-label">Your 4-day split</div>
    ${cards}`;
  A['hide-install'] = () => { S.settings.installHidden = true; saveSettings(); rerender(); };
});

// App shortcuts in manifest.json open #/start/<day>.
route(/^\/start\/([\w-]+)$/, (q, id) => {
  view.innerHTML = '';
  if (S.active) return replaceRoute('#/log');
  if (!S.templates.some(t => t.id === id)) return replaceRoute('#/');
  startSession(id).then(() => replaceRoute('#/log'));
});

// ---------------------------------------------------------------- Exercise library
const lib = { q: '', muscle: '', equip: '', cat: '', shown: 40 };
function parsePick(v) {
  if (!v) return null;
  const [kind, id] = v.split(':');
  if (kind === 'day') { const t = S.templates.find(x => x.id === id); return t && { kind, id, label: t.name, back: `#/day/${id}` }; }
  if (kind === 'log') return S.active && { kind, label: 'your current workout', back: '#/log' };
  if (kind === 'edit') { const s = S.sessions.find(x => x.id === id); return s && { kind, id, label: 'this session', back: `#/session/${id}?edit=1` }; }
  return null;
}
const pickSession = p => (p.kind === 'log' ? S.active : S.sessions.find(x => x.id === p.id));
const pickHas = (p, exId) => (p.kind === 'day'
  ? S.templates.find(t => t.id === p.id).items.some(i => i.exId === exId)
  : pickSession(p)?.exercises.some(e => e.exId === exId));

async function toggleInTemplate(tplId, exId) {
  const t = S.templates.find(x => x.id === tplId);
  const i = t.items.findIndex(x => x.exId === exId);
  if (i >= 0) { t.items.splice(i, 1); toast(`Removed from ${t.name}`); }
  else { t.items.push({ exId, sets: 3, reps: 10 }); toast(`Added to ${t.name}`); }
  await saveTemplate(t);
  return i < 0;
}
function addToSession(s, exId) {
  if (s.exercises.some(e => e.exId === exId)) { toast('Already in this workout'); return; }
  const e = s.end ? { exId, name: exName(exId), sets: [{ reps: 10, kg: null, warmup: false, done: true }] } : newEntry(exId, 3, 10);
  s.exercises.push(e);
  touchSession(s);
  toast(`Added ${exName(exId)}`);
}
function addToWorkoutSheet(exId) {
  const e = S.exMap.get(exId);
  const rows = [];
  if (S.active) {
    const has = S.active.exercises.some(x => x.exId === exId);
    rows.push(`<button class="opt ${has ? 'on' : ''}" data-action="atw-go" data-t="log"><span class="dot-n" style="background:var(--good);color:#fff">${icon('timer')}</span>
      <span class="grow">Current workout<small>${esc(S.active.name)} · ${has ? 'already added' : 'in progress'}</small></span>${icon(has ? 'check' : 'plus', has ? 'ok' : '')}</button>`);
  }
  S.templates.forEach((t, i) => {
    const has = t.items.some(x => x.exId === exId);
    rows.push(`<button class="opt ${has ? 'on' : ''}" data-action="atw-go" data-t="${esc(t.id)}">${dotN(t.color, i + 1)}
      <span class="grow">${esc(t.name)}<small>${has ? 'In this day · tap to remove' : plural(t.items.length, 'exercise')}</small></span>${icon(has ? 'check' : 'plus', has ? 'ok' : '')}</button>`);
  });
  openSheet(`<h2>Add to workout</h2><p class="msg">${esc(e.name)}</p><div class="opts">${rows.join('')}</div>`, {
    'atw-go': async el => {
      if (el.dataset.t === 'log') addToSession(S.active, exId);
      else await toggleInTemplate(el.dataset.t, exId);
      await closeSheet();
      rerender();
    },
  });
}
GA['quick-add'] = el => addToWorkoutSheet(el.dataset.id);

function libFilter() {
  const query = SEARCH_PHRASES.reduce((s, [re, rep]) => s.replace(re, rep), norm(lib.q));
  const terms = query.split(' ').filter(Boolean).map(t => SEARCH_ALIAS[t] || t);
  const g = GROUPS.find(x => x.id === lib.muscle), q = EQUIPMENT.find(x => x.id === lib.equip);
  const out = S.ex.filter(e => (!g || e.primaryMuscles.some(m => g.m.includes(m)))
    && (!q || q.m.includes(e.equipment || ''))
    && (!lib.cat || (lib.cat === 'custom' ? e.custom : e.category === lib.cat))
    && terms.every(t => e._s.includes(t)));
  if (!terms.length) return out;
  const whole = terms.join(' ');
  const score = new Map(out.map(e => { const n = norm(e.name); return [e, n.startsWith(whole) ? 0 : n.includes(whole) ? 1 : terms.every(t => n.includes(t)) ? 2 : 3]; }));
  return out.sort((a, b) => score.get(a) - score.get(b) || a.name.localeCompare(b.name));
}
function libRow(e, pick) {
  const has = pick && pickHas(pick, e.id);
  return `<li class="ex-row"><a class="ex-link" href="#/ex/${encodeURIComponent(e.id)}">${thumbHtml(e)}
    <div class="ex-meta"><div class="ex-name">${esc(e.name)}</div><div class="ex-sub">${esc(subline(e))}</div></div></a>
    <button class="icon-btn ${has ? 'added' : 'accent'}" data-action="${pick ? 'pick-add' : 'quick-add'}" data-id="${esc(e.id)}" aria-label="${has ? 'Added' : 'Add'}: ${esc(e.name)}">${icon(has ? 'check' : 'plus')}</button></li>`;
}
const chip = (k, v, label, active) => `<button class="chip ${active ? 'on' : ''}" data-action="chip" data-k="${k}" data-v="${v}" aria-pressed="${active}">${esc(label)}</button>`;

route(/^\/library$/, q => {
  const pick = parsePick(q.get('pick'));
  if (q.get('pick') && !pick) return replaceRoute('#/library');
  const cats = [['', 'All types'], ...CATEGORIES, ['custom', 'My exercises']];
  view.innerHTML = topbar(pick ? 'Add exercises' : 'Exercises', {
    back: pick?.back,
    right: pick ? '<button class="btn sm primary" data-action="pick-done">Done</button>' : '',
  }) + `
    <div class="lib-head">
      ${pick ? `<div class="pick-bar">${icon('plus')}<span>Tap + to add to ${esc(pick.label)}</span></div>` : ''}
      <div class="search">${icon('search')}<input id="q" type="search" placeholder="Search ${fmtNum(S.ex.length)} exercises" value="${esc(lib.q)}" autocomplete="off" enterkeyhint="search" aria-label="Search exercises">
        <button class="icon-btn clear" data-action="clear-q" aria-label="Clear search" ${lib.q ? '' : 'hidden'}>${icon('x')}</button></div>
      <div class="chips" id="chips-m" role="group" aria-label="Muscle group">${chip('m', '', 'All muscles', !lib.muscle)}${GROUPS.map(g => chip('m', g.id, g.label, lib.muscle === g.id)).join('')}</div>
      <div class="chips" id="chips-e" role="group" aria-label="Equipment">${chip('e', '', 'Any equipment', !lib.equip)}${EQUIPMENT.map(x => chip('e', x.id, x.label, lib.equip === x.id)).join('')}</div>
    </div>
    <div class="lib-meta"><span id="count" aria-live="polite"></span><span class="spacer"></span>
      <select class="input" id="cat" aria-label="Exercise type">${cats.map(([v, l]) => `<option value="${v}" ${lib.cat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="card lib-list" style="${pick ? '' : 'margin-bottom:76px'}"><ul class="list" id="results"></ul><div id="more" style="height:1px"></div></div>
    ${pick ? '' : `<a class="fab" href="#/custom/new" aria-label="New custom exercise">${icon('plus')}Custom</a>`}`;

  const ul = $('#results'), qi = $('#q');
  let results = [];
  const list = () => {
    results = libFilter();
    lib.shown = Math.max(40, Math.min(lib.shown, results.length));
    $('#count').textContent = plural(results.length, 'exercise');
    ul.innerHTML = results.slice(0, lib.shown).map(e => libRow(e, pick)).join('') || '<li class="empty">No exercises match. Try fewer filters.</li>';
  };
  const reset = () => { lib.shown = 40; list(); };
  const io = new IntersectionObserver(es => {
    if (!es.some(x => x.isIntersecting) || lib.shown >= results.length) return;
    const more = results.slice(lib.shown, lib.shown + 40);
    lib.shown += more.length;
    ul.insertAdjacentHTML('beforeend', more.map(e => libRow(e, pick)).join(''));
  }, { rootMargin: '800px' });
  io.observe($('#more'));
  onLeave(() => io.disconnect());
  list();

  on(qi, 'input', debounce(() => { lib.q = qi.value; $('[data-action="clear-q"]').hidden = !lib.q; reset(); }, 120));
  on(qi, 'keydown', e => { if (e.key === 'Enter') qi.blur(); });
  on($('#cat'), 'change', e => { lib.cat = e.target.value; reset(); });
  A['clear-q'] = () => { qi.value = lib.q = ''; $('[data-action="clear-q"]').hidden = true; reset(); qi.focus(); };
  A.chip = el => {
    const { k, v } = el.dataset;
    if (k === 'm') lib.muscle = lib.muscle === v ? '' : v; else lib.equip = lib.equip === v ? '' : v;
    const cur = k === 'm' ? lib.muscle : lib.equip;
    for (const c of $$(`#chips-${k} .chip`)) { c.classList.toggle('on', c.dataset.v === cur); c.setAttribute('aria-pressed', c.dataset.v === cur); }
    reset();
  };
  A['pick-add'] = async el => {
    const id = el.dataset.id;
    let has;
    if (pick.kind === 'day') has = await toggleInTemplate(pick.id, id);
    else { addToSession(pickSession(pick), id); has = true; }
    el.className = `icon-btn ${has ? 'added' : 'accent'}`;
    el.innerHTML = icon(has ? 'check' : 'plus');
  };
  A['pick-done'] = () => goBack(pick.back);
});

// ---------------------------------------------------------------- Exercise page
route(/^\/ex\/(.+)$/, (q, id) => {
  const e = S.exMap.get(id);
  if (!e) return notFound();
  const an = analysis(), tl = an.timeline.get(id);
  const pri = new Set(e.primaryMuscles), sec = new Set(e.secondaryMuscles.filter(m => !pri.has(m)));
  const names = set => [...set].map(m => MUSCLE_LABEL[m] || cap(m)).join(', ');
  const catLabel = (CATEGORIES.find(c => c[0] === e.category) || [0, cap(e.category)])[1];
  const tags = [
    e.custom && '<span class="tag accent">Custom</span>',
    e.level && `<span class="tag">${cap(e.level)}</span>`,
    `<span class="tag">${icon('dumbbell')}${esc(equipLabel(e.equipment))}</span>`,
    e.category && `<span class="tag">${esc(catLabel)}</span>`,
    e.mechanic && `<span class="tag">${cap(e.mechanic)}</span>`,
    e.force && `<span class="tag">${cap(e.force)}</span>`,
  ].filter(Boolean).join('');
  let hist = '';
  if (tl) {
    const last = tl[tl.length - 1], bw = tl.every(p => p.topKg === 0);
    hist = `<a class="card prog-row" style="padding:12px 16px;margin-top:14px" href="#/progress/ex/${encodeURIComponent(id)}">${icon('chart')}
      <div class="grow"><b>Your progress</b><span class="small">${plural(tl.length, 'session')} · ${bw ? `best ${an.best.get(id).bwReps} reps` : `best e1RM ${fmtNum(an.best.get(id).e1, 1)} kg`} · last ${relDay(last.t)}</span></div>
      ${spark(tl.slice(-12).map(p => (bw ? p.maxReps : p.e1)))}</a>`;
  }
  const how = e.instructions?.length
    ? `<section class="card"><div class="card-title"><h2>How to do it</h2></div><ol class="steps">${e.instructions.map(s => `<li>${esc(s)}</li>`).join('')}</ol></section>`
    : e.notes ? `<section class="card"><div class="card-title"><h2>Notes</h2></div><p style="white-space:pre-wrap">${esc(e.notes)}</p></section>` : '';
  const map = muscleMap(m => (pri.has(m) ? 'var(--mm-pri)' : sec.has(m) ? 'var(--mm-sec)' : ''), `Primary: ${names(pri)}. Secondary: ${names(sec) || 'none'}.`);

  view.innerHTML = topbar(names(pri) || 'Exercise', {
    back: '#/library',
    right: e.custom ? `<a class="icon-btn" href="#/custom/${encodeURIComponent(id)}/edit" aria-label="Edit exercise">${icon('edit')}</a>` : '',
  }) + demoHtml(e) + `
    <h1 class="ex-title">${esc(e.name)}</h1><div class="tags">${tags}</div>
    ${hist}
    <div class="section-label"></div>
    ${how}
    <section class="card"><div class="card-title"><h2>Muscles worked</h2></div>${map}
      <div class="legend"><span><i style="background:var(--mm-pri)"></i><b>Primary</b>&nbsp;${esc(names(pri))}</span>
      ${sec.size ? `<span><i style="background:var(--mm-sec)"></i><b>Secondary</b>&nbsp;${esc(names(sec))}</span>` : ''}</div></section>
    <div class="sticky-cta"><button class="btn primary lg block" data-action="quick-add" data-id="${esc(id)}">${icon('plus')}Add to workout</button></div>`;
  startDemos(view);
});

// ---------------------------------------------------------------- Custom exercise form
route(/^\/custom\/new$/, () => customForm(null));
route(/^\/custom\/(.+)\/edit$/, (q, id) => { const e = S.exMap.get(id); return e?.custom ? customForm(e) : notFound(); });
async function resizePhoto(file, max = 900) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.82);
}
function customForm(e) {
  let photo = safePhoto(e?.photo);
  const sec = new Set(e?.secondaryMuscles || []);
  view.innerHTML = topbar(e ? 'Edit exercise' : 'New exercise', { back: e ? `#/ex/${encodeURIComponent(e.id)}` : '#/library' }) + `
    <form id="cf" class="card" novalidate>
      <label class="field"><span>Name</span><input class="input" name="exname" maxlength="80" required value="${esc(e?.name)}" placeholder="e.g. Hack squat machine"></label>
      <label class="field"><span>Main muscle</span><select class="input" name="muscle">${MUSCLES.map(m => `<option value="${m}" ${e?.primaryMuscles[0] === m ? 'selected' : ''}>${MUSCLE_LABEL[m]}</option>`).join('')}</select></label>
      <div class="field"><span>Also works <span class="muted">(optional)</span></span>
        <div class="tags">${MUSCLES.map(m => `<button type="button" class="chip ${sec.has(m) ? 'on' : ''}" data-action="sec" data-m="${m}" aria-pressed="${sec.has(m)}">${MUSCLE_LABEL[m]}</button>`).join('')}</div></div>
      <label class="field"><span>Equipment</span><select class="input" name="equipment">${EQUIPMENT.map(x => `<option value="${x.m[0]}" ${(e?.equipment ?? 'machine') === x.m[0] ? 'selected' : ''}>${x.label}</option>`).join('')}</select></label>
      <div class="field"><span>Photo <span class="muted">(optional)</span></span><div id="ph"></div>
        <div class="btn-row"><label class="btn">${icon('camera')}<span id="ph-label">Add photo</span><input type="file" accept="image/*" id="file" hidden></label>
        <button type="button" class="btn danger" id="ph-rm" data-action="ph-rm" hidden>Remove</button></div></div>
      <label class="field"><span>Notes <span class="muted">(optional)</span></span><textarea class="input" name="notes" maxlength="2000" placeholder="Seat height, grip, cues…">${esc(e?.notes)}</textarea></label>
    </form>
    <div class="btn-row" style="margin-top:14px">${e ? `<button class="btn lg outline danger" data-action="del-custom">${icon('trash')}Delete</button>` : ''}
      <button class="btn lg primary" data-action="save-custom">${icon('check')}Save</button></div>`;
  const f = $('#cf');
  const paintPhoto = () => {
    $('#ph').innerHTML = photo ? `<img src="${photo}" alt="" style="width:100%;max-height:260px;object-fit:cover;border-radius:12px;margin-bottom:10px">` : '';
    $('#ph-rm').hidden = !photo;
    $('#ph-label').textContent = photo ? 'Change photo' : 'Add photo';
  };
  paintPhoto();
  on($('#file'), 'change', async ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try { photo = await resizePhoto(file); paintPhoto(); } catch { toast("Couldn't read that photo"); }
  });
  A['ph-rm'] = () => { photo = null; paintPhoto(); };
  A.sec = el => { const m = el.dataset.m; sec.has(m) ? sec.delete(m) : sec.add(m); el.classList.toggle('on', sec.has(m)); el.setAttribute('aria-pressed', sec.has(m)); };
  A['save-custom'] = async () => {
    const name = f.elements.exname.value.trim();
    if (!name) { toast('Give the exercise a name'); f.elements.exname.focus(); return; }
    const muscle = f.elements.muscle.value;
    const rec = {
      id: e?.id || uid('c_'), custom: true, name, primaryMuscles: [muscle], secondaryMuscles: [...sec].filter(m => m !== muscle),
      equipment: f.elements.equipment.value, category: 'strength', instructions: [], notes: f.elements.notes.value.trim(),
      photo, img: 0, created: e?.created || Date.now(),
    };
    await db.put('custom', rec);
    S.custom = S.custom.filter(x => x.id !== rec.id).concat(rec);
    indexExercises();
    toast(e ? 'Exercise updated' : 'Exercise added');
    replaceRoute(`#/ex/${encodeURIComponent(rec.id)}`);
  };
  A['del-custom'] = async () => {
    const used = S.sessions.filter(s => s.exercises.some(x => x.exId === e.id)).length;
    const msg = used ? `It appears in ${plural(used, 'logged session')}. That history stays, listed under its name.` : "This can't be undone.";
    if (!await confirmSheet(`Delete ${e.name}?`, esc(msg), 'Delete exercise', 'danger')) return;
    await db.del('custom', e.id);
    S.custom = S.custom.filter(x => x.id !== e.id);
    for (const t of S.templates) {
      const n = t.items.length;
      t.items = t.items.filter(i => i.exId !== e.id);
      if (t.items.length !== n) await saveTemplate(t);
    }
    indexExercises();
    toast('Exercise deleted');
    replaceRoute('#/library');
  };
}

// ---------------------------------------------------------------- Day (template) editor
function setRest(exId, sec) {
  S.settings.restByEx[exId] = clamp(Math.round(sec / 5) * 5, 15, 600);
  saveSettings();
}
const stepRow = (label, k, val) => `<div class="switch-row"><div><b>${label}</b></div><div class="stepper">
  <button data-action="step" data-k="${k}" data-d="-1" aria-label="Less ${label}">−</button><output>${val}</output>
  <button data-action="step" data-k="${k}" data-d="1" aria-label="More ${label}">+</button></div></div>`;

route(/^\/day\/([\w-]+)$/, (q, id) => {
  const t = S.templates.find(x => x.id === id);
  if (!t) return notFound();
  const idx = tplIndex(id);
  const items = t.items.map((it, k) => `<li class="tpl-item" data-i="${k}">
      <span class="drag-handle" aria-hidden="true">${icon('grip')}</span>${thumbHtml(S.exMap.get(it.exId))}
      <div class="ex-meta"><a class="ex-name" style="color:inherit" href="#/ex/${encodeURIComponent(it.exId)}">${esc(exName(it.exId))}</a>
        <button class="rest-chip" style="margin-top:6px" data-action="target" data-k="${k}">${it.sets} × ${it.reps} · rest ${fmtRest(restFor(it.exId))}</button></div>
      <button class="icon-btn" data-action="rm" data-k="${k}" aria-label="Remove ${esc(exName(it.exId))}">${icon('x')}</button></li>`).join('');
  view.innerHTML = topbar(t.name, { back: '#/', sub: `Day ${idx + 1} · tap a target to change it` }) + `
    <section class="card"><label class="field"><span>Name</span><input class="input" id="tname" value="${esc(t.name)}" maxlength="40" enterkeyhint="done"></label></section>
    <div class="section-label">${plural(t.items.length, 'exercise')} · drag ${icon('grip', 'small')} to reorder</div>
    <section class="card" style="padding:4px 8px 4px 2px">${t.items.length ? `<ul class="list" id="tpl-list">${items}</ul>` : '<div class="empty">No exercises yet.</div>'}</section>
    <a class="btn block lg outline" style="margin-top:14px" href="#/library?pick=day:${esc(t.id)}">${icon('plus')}Add exercises</a>
    <button class="btn block lg primary" style="margin-top:10px" data-action="start" data-id="${esc(t.id)}" ${t.items.length ? '' : 'disabled'}>${icon('play')}Start ${esc(t.name)}</button>`;

  on($('#tname'), 'change', async ev => {
    const v = ev.target.value.trim();
    if (!v) { ev.target.value = t.name; return; }
    t.name = v;
    await saveTemplate(t);
    $('.topbar h1').firstChild.textContent = v;
    toast('Name saved');
  });
  on($('#tname'), 'keydown', ev => { if (ev.key === 'Enter') ev.target.blur(); });
  if (t.items.length) {
    dragReorder($('#tpl-list'), async (from, to) => {
      const [x] = t.items.splice(from, 1);
      t.items.splice(to, 0, x);
      await saveTemplate(t);
      rerender();
    });
  }
  A.rm = async el => {
    const k = +el.dataset.k;
    const [removed] = t.items.splice(k, 1);
    await saveTemplate(t);
    rerender();
    toast(`Removed ${exName(removed.exId)}`, { action: 'Undo', fn: async () => { t.items.splice(k, 0, removed); await saveTemplate(t); rerender(); } });
  };
  A.target = el => {
    const it = t.items[+el.dataset.k];
    const html = () => `<h2>${esc(exName(it.exId))}</h2><p class="msg">Target for ${esc(t.name)}</p>
      ${stepRow('Sets', 'sets', it.sets)}${stepRow('Reps', 'reps', it.reps)}${stepRow('Rest', 'rest', fmtRest(restFor(it.exId)))}
      <button class="btn block lg primary" style="margin-top:16px" data-action="close">Done</button>`;
    openSheet(html(), {
      step: async b => {
        const d = +b.dataset.d;
        if (b.dataset.k === 'sets') it.sets = clamp(it.sets + d, 1, 12);
        else if (b.dataset.k === 'reps') it.reps = clamp(it.reps + d, 1, 100);
        else setRest(it.exId, restFor(it.exId) + d * 15);
        sheet.el.innerHTML = `<div class="grab"></div>${html()}`;
        await saveTemplate(t);
      },
      close: () => closeSheet(),
    }, { onClose: refreshIfSame() });
  };
});

// ---------------------------------------------------------------- Logging (live) and editing (past)
route(/^\/log$/, () => (S.active ? sessionEditor(S.active, true) : replaceRoute('#/')));

/** Sets that beat every earlier session (running best within this session), keyed by set index. */
function prFlags(ctx, e) {
  const out = new Map(), b = ctx.best.get(e.exId);
  if (!ctx.live || !b) return out;
  let e1 = b.e1, kg = b.topKg, reps = b.bwReps;
  e.sets.forEach((x, i) => {
    if (!x.done || x.warmup || !(x.reps > 0)) return;
    const w = x.kg > 0 ? x.kg : 0;
    if (w > 0) {
      const est = epley(w, x.reps);
      if (w > kg + 0.01) { out.set(i, `heaviest ${fmtW(w)} kg`); kg = w; }
      if (est > e1 + 0.05) { if (!out.has(i)) out.set(i, `e1RM ${fmtNum(est, 1)} kg`); e1 = est; }
    } else if (kg === 0 && reps > 0 && x.reps > reps) { out.set(i, `${x.reps} reps`); reps = x.reps; }
  });
  return out;
}
const prevText = p => (p ? `${p.kg > 0 ? fmtW(p.kg) : 'BW'} × ${p.reps}` : '—');

function exCard(ctx, e, ei) {
  const ex = S.exMap.get(e.exId), name = exName(e.exId, e.name), live = ctx.live;
  const prev = ctx.prev.get(e.exId) || [];
  const prevW = prev.filter(x => x.warmup), prevK = prev.filter(x => !x.warmup);
  const flags = prFlags(ctx, e);
  let wi = 0, ki = 0;
  const rows = e.sets.map((x, si) => {
    const p = x.warmup ? prevW[wi++] : prevK[ki++];
    const label = x.warmup ? 'W' : String(ki);
    const n = `<button class="set-n ${x.warmup ? 'w' : ''}" data-action="warm" aria-label="${x.warmup ? 'Warm-up set' : `Set ${label}`}. Tap to toggle warm-up">${label}</button>`;
    const kg = `<input class="num" inputmode="decimal" enterkeyhint="next" data-f="kg" value="${esc(x.kg)}" placeholder="${esc(p?.kg ?? 'kg')}" aria-label="Weight in kg, set ${label}">`;
    const reps = `<input class="num" inputmode="numeric" enterkeyhint="done" data-f="reps" value="${esc(x.reps)}" placeholder="${esc(p?.reps ?? 'reps')}" aria-label="Reps, set ${label}">`;
    if (!live) return `<div class="set-row edit" data-ei="${ei}" data-si="${si}">${n}${kg}${reps}<button class="icon-btn" data-action="del-set" aria-label="Delete set ${label}">${icon('x')}</button></div>`;
    const pr = flags.get(si);
    return `<div class="set-row ${x.done ? 'done' : ''}" data-ei="${ei}" data-si="${si}">${n}
      <div class="prev">${pr ? `<span class="pr" title="New record: ${esc(pr)}">${icon('trophy')}PR</span>` : prevText(p)}</div>${kg}${reps}
      <button class="tick" data-action="tick" aria-pressed="${x.done}" aria-label="Set ${label} done">${icon('check')}</button></div>`;
  }).join('');
  const head = live
    ? '<div class="set-row head" aria-hidden="true"><span>Set</span><span>Previous</span><span>kg</span><span>Reps</span><span>Done</span></div>'
    : '<div class="set-row edit head" aria-hidden="true"><span>Set</span><span>kg</span><span>Reps</span><span></span></div>';
  const demoAttr = `data-action="demo" data-id="${esc(e.exId)}"`;
  const complete = live && e.sets.length > 0 && e.sets.every(x => x.done);
  return `<section class="card ex-card ${complete ? 'complete' : ''}" data-ei="${ei}">
    <div class="hd">${thumbHtml(ex, ex ? demoAttr : '')}
      <div class="ttl" ${ex ? demoAttr : ''}><b>${complete ? `<span class="done-mark" aria-label="All sets done">${icon('check')}</span>` : ''}${esc(name)}</b>
        <div class="sub">${e.target ? `<span class="small muted">Target ${e.target.sets} × ${e.target.reps}</span>` : ''}
        ${live ? `<button class="rest-chip" data-action="rest" data-id="${esc(e.exId)}" aria-label="Rest ${fmtRest(restFor(e.exId))}. Tap to change">${icon('timer')}${fmtRest(restFor(e.exId))}</button>` : ''}</div></div>
      <button class="icon-btn" data-action="ex-menu" aria-label="Options for ${esc(name)}">${icon('more')}</button></div>
    <div class="sets">${head}${rows}</div>
    <div class="set-actions"><button class="btn sm" data-action="add-set">${icon('plus')}Add set</button>
      ${live ? `<button class="btn sm" data-action="rm-set" ${e.sets.length ? '' : 'disabled'}>${icon('minus')}Remove set</button>` : ''}</div>
  </section>`;
}

function demoSheet(exId) {
  const e = S.exMap.get(exId);
  if (!e) return;
  const el = openSheet(`<h2>${esc(e.name)}</h2><p class="msg">${esc(subline(e))}</p>${demoHtml(e)}
    ${e.instructions?.length ? `<ol class="steps" style="margin-top:16px">${e.instructions.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : e.notes ? `<p style="margin-top:14px;white-space:pre-wrap">${esc(e.notes)}</p>` : ''}
    <a class="btn block" style="margin-top:16px" href="#/ex/${encodeURIComponent(e.id)}" data-action="sheet-link">Open exercise page</a>`, {
    'sheet-link': async a => { await closeSheet(); go(a.getAttribute('href')); },
  });
  startDemos(el);
}
function restSheet(exId, after) {
  const presets = [30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
  const html = () => `<h2>Rest timer</h2><p class="msg">${esc(exName(exId))}</p>
    ${stepRow('Rest between sets', 'rest', fmtRest(restFor(exId)))}
    <div class="tags" style="margin-top:10px">${presets.map(p => `<button class="chip ${restFor(exId) === p ? 'on' : ''}" data-action="rest-set" data-v="${p}">${fmtRest(p)}</button>`).join('')}</div>
    <button class="btn block lg primary" style="margin-top:16px" data-action="close">Done</button>`;
  const repaint = () => { sheet.el.innerHTML = `<div class="grab"></div>${html()}`; };
  openSheet(html(), {
    step: b => { setRest(exId, restFor(exId) + +b.dataset.d * 15); repaint(); },
    'rest-set': b => { setRest(exId, +b.dataset.v); repaint(); },
    close: () => closeSheet(),
  }, { onClose: after });
}

function sessionEditor(s, live) {
  const an = analysis();
  const ctx = { s, live, prev: new Map(), best: new Map() };
  if (live) for (const e of s.exercises) { ctx.prev.set(e.exId, lastSetsFor(e.exId) || []); ctx.best.set(e.exId, an.best.get(e.exId)); }
  const token = renderToken;
  const mine = () => token === renderToken;
  const cardsHtml = () => s.exercises.map((e, i) => exCard(ctx, e, i)).join('') || '<div class="card empty">No exercises yet. Add one below.</div>';

  view.innerHTML = topbar(s.name, {
    back: live ? '#/' : `#/session/${s.id}`,
    sub: live ? `Started ${fmtTime(s.start)}` : `Editing · ${fmtDate(s.start)}`,
    right: live ? `<button class="btn sm good" data-action="finish">${icon('check')}Finish</button>` : '<button class="btn sm primary" data-action="edit-done">Done</button>',
  }) + (live
    ? `<div class="log-head"><div><div class="clock" id="clock">${fmtClock(Date.now() - s.start)}</div><div class="stat" id="lstat"></div></div>
        <span class="spacer"></span><button class="icon-btn tinted" data-action="sess-menu" aria-label="Workout options">${icon('more')}</button></div>
      <div class="log-progress" aria-hidden="true"><i id="lprog"></i></div>`
    : `<section class="card"><div class="row" style="align-items:flex-end">
        <label class="field" style="flex:1;margin:0"><span>Date</span><input class="input" type="date" id="sdate" value="${ymd(s.start)}" max="${ymd(Date.now())}"></label>
        <label class="field" style="width:110px;margin:0"><span>Minutes</span><input class="input" id="sdur" inputmode="numeric" value="${Math.round((s.end - s.start) / 6e4)}"></label></div></section>`)
  + `<div id="cards">${cardsHtml()}</div>
    <a class="btn block lg outline" style="margin-top:14px" href="#/library?pick=${live ? 'log' : `edit:${esc(s.id)}`}">${icon('plus')}Add exercise</a>
    ${live ? '<p class="hint">Tap a set number to mark a warm-up. Tick ✓ to log a set and start the rest timer.</p>'
      : `<button class="btn block lg danger" style="margin-top:10px" data-action="del-session">${icon('trash')}Delete session</button>`}`;

  const repaint = ei => { if (!mine()) return; const c = $(`.ex-card[data-ei="${ei}"]`, view); if (c) c.outerHTML = exCard(ctx, s.exercises[ei], ei); };
  const repaintAll = () => { if (mine()) $('#cards').innerHTML = cardsHtml(); };
  const updateStats = () => {
    const el = live && mine() && $('#lstat');
    if (!el) return;
    const t = sessionTotals(s), sets = s.exercises.flatMap(e => e.sets);
    const exDone = s.exercises.filter(e => e.sets.length && e.sets.every(x => x.done)).length;
    el.textContent = `${exDone}/${s.exercises.length} exercises · ${plural(t.sets, 'working set')} · ${fmtNum(t.vol)} kg`;
    $('#lprog').style.width = `${sets.length ? (sets.filter(x => x.done).length / sets.length) * 100 : 0}%`;
  };
  const changed = () => { touchSession(s); updateStats(); };
  const rowOf = el => { const r = el.closest('.set-row'); return { ei: +r.dataset.ei, si: +r.dataset.si, row: r }; };
  const cardIndex = el => +el.closest('.ex-card').dataset.ei;
  updateStats();

  if (live) {
    const clock = setInterval(() => { const c = $('#clock'); if (c) c.textContent = fmtClock(Date.now() - s.start); }, 1000);
    onLeave(() => clearInterval(clock));
  } else {
    on($('#sdate'), 'change', ev => {
      if (!ev.target.value) return;
      const dur = s.end - s.start, timeOfDay = s.start - startOfDay(s.start);
      s.start = parseYmd(ev.target.value) + timeOfDay;
      s.end = s.start + dur;
      sortSessions();
      changed();
    });
    on($('#sdur'), 'change', ev => { const m = parseNum(ev.target.value); if (m > 0) { s.end = s.start + m * 6e4; changed(); } });
  }

  on(view, 'input', ev => {
    const el = ev.target;
    if (!el.classList.contains('num')) return;
    const { ei, si } = rowOf(el);
    const v = parseNum(el.value);
    s.exercises[ei].sets[si][el.dataset.f] = v == null ? null : el.dataset.f === 'reps' ? Math.max(0, Math.round(v)) : Math.max(0, v);
    changed();
  });
  on(view, 'focusin', ev => { if (ev.target.classList?.contains('num')) setTimeout(() => ev.target.select(), 0); });
  on(view, 'keydown', ev => {
    if (ev.key !== 'Enter' || !ev.target.classList?.contains('num')) return;
    ev.preventDefault();
    if (ev.target.dataset.f === 'kg') ev.target.closest('.set-row').querySelector('[data-f="reps"]').focus();
    else ev.target.blur();
  });

  A.tick = el => {
    const { ei, si, row } = rowOf(el);
    const e = s.exercises[ei], x = e.sets[si];
    if (!x.done && !(x.reps > 0)) {
      el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
      row.querySelector('[data-f="reps"]').focus();
      return;
    }
    x.done = !x.done;
    changed();
    repaint(ei);
    if (!x.done) return;
    if (S.settings.vibrate) navigator.vibrate?.(25);
    startRest(restFor(e.exId), exName(e.exId));
    const pr = prFlags(ctx, e).get(si);
    if (pr) toast(`New record! ${exName(e.exId)}: ${pr}`, { ms: 4500 });
  };
  A.warm = el => { const { ei, si } = rowOf(el); const x = s.exercises[ei].sets[si]; x.warmup = !x.warmup; changed(); repaint(ei); };
  A['add-set'] = el => {
    const ei = cardIndex(el), e = s.exercises[ei], last = e.sets[e.sets.length - 1];
    e.sets.push({ reps: last?.reps ?? e.target?.reps ?? 10, kg: last?.kg ?? null, warmup: false, done: !live });
    changed();
    repaint(ei);
  };
  A['rm-set'] = el => {
    const ei = cardIndex(el), e = s.exercises[ei];
    if (!e.sets.length) return;
    const removed = e.sets.pop();
    changed();
    repaint(ei);
    toast('Set removed', { action: 'Undo', fn: () => { e.sets.push(removed); changed(); repaint(ei); } });
  };
  A['del-set'] = el => {
    const { ei, si } = rowOf(el), e = s.exercises[ei];
    const [removed] = e.sets.splice(si, 1);
    changed();
    repaint(ei);
    toast('Set deleted', { action: 'Undo', fn: () => { e.sets.splice(si, 0, removed); changed(); repaint(ei); } });
  };
  A.demo = el => demoSheet(el.dataset.id);
  A.rest = el => restSheet(el.dataset.id, repaintAll);
  const move = (ei, d) => {
    const j = ei + d;
    if (j < 0 || j >= s.exercises.length) return;
    [s.exercises[ei], s.exercises[j]] = [s.exercises[j], s.exercises[ei]];
    changed();
    repaintAll();
  };
  A['ex-menu'] = el => {
    const ei = cardIndex(el), e = s.exercises[ei], name = exName(e.exId, e.name);
    openSheet(`<h2>${esc(name)}</h2><div class="opts" style="margin-top:12px">
      ${S.exMap.has(e.exId) ? `<button class="opt" data-action="m-demo">${icon('play')}<span class="grow">Show demo</span></button>` : ''}
      ${live ? `<button class="opt" data-action="m-rest">${icon('timer')}<span class="grow">Rest timer<small>${fmtRest(restFor(e.exId))} for this exercise</small></span></button>` : ''}
      <button class="opt" data-action="m-up" ${ei === 0 ? 'disabled' : ''}>${icon('up')}<span class="grow">Move up</span></button>
      <button class="opt" data-action="m-down" ${ei === s.exercises.length - 1 ? 'disabled' : ''}>${icon('down')}<span class="grow">Move down</span></button>
      <button class="opt" data-action="m-prog">${icon('chart')}<span class="grow">View progress</span></button>
      <button class="opt danger-opt" data-action="m-rm">${icon('trash')}<span class="grow">Remove from this workout</span></button></div>`, {
      'm-demo': async () => { await closeSheet(); demoSheet(e.exId); },
      'm-rest': async () => { await closeSheet(); restSheet(e.exId, repaintAll); },
      'm-up': async () => { await closeSheet(); move(ei, -1); },
      'm-down': async () => { await closeSheet(); move(ei, 1); },
      'm-prog': async () => { await closeSheet(); go(`#/progress/ex/${encodeURIComponent(e.exId)}`); },
      'm-rm': async () => {
        await closeSheet();
        s.exercises.splice(ei, 1);
        changed();
        repaintAll();
        toast(`Removed ${name}`, { action: 'Undo', fn: () => { s.exercises.splice(ei, 0, e); changed(); repaintAll(); } });
      },
    });
  };
  A.finish = () => finishFlow();
  A['sess-menu'] = () => openSheet(`<h2>Workout</h2><div class="opts" style="margin-top:12px">
      <button class="opt" data-action="sm-finish">${icon('check')}<span class="grow">Finish workout</span></button>
      <button class="opt danger-opt" data-action="sm-discard">${icon('trash')}<span class="grow">Discard workout<small>Deletes everything logged in this session</small></span></button></div>`, {
    'sm-finish': async () => { await closeSheet(); finishFlow(); },
    'sm-discard': async () => {
      await closeSheet();
      if (!await confirmSheet('Discard this workout?', 'Everything logged in this session will be deleted.', 'Discard workout', 'danger')) return;
      await discardActive();
      toast('Workout discarded');
      replaceRoute('#/');
    },
  });
  A['edit-done'] = () => { flushSaves.flush(); goBack(`#/session/${s.id}`); };
  A['del-session'] = async () => {
    if (!await confirmSheet('Delete this session?', 'It will be removed from your history and charts.', 'Delete session', 'danger')) return;
    await deleteSession(s);
    toast('Session deleted');
    replaceRoute('#/history');
  };
}

async function finishFlow() {
  const s = S.active;
  if (!s) return;
  const all = s.exercises.flatMap(e => e.sets);
  const done = all.filter(x => x.done).length;
  const pending = all.filter(x => !x.done && x.reps > 0).length;
  if (!done && !pending) {
    if (await confirmSheet('Nothing logged yet', 'Discard this empty workout?', 'Discard workout', 'danger')) { await discardActive(); replaceRoute('#/'); }
    return;
  }
  let countPending = false;
  if (pending) {
    const r = await ask({
      title: `${plural(pending, 'set')} not ticked`,
      msg: done ? 'Only ticked sets count unless you include the rest.' : 'None of your sets are ticked yet.',
      buttons: [
        ...(done ? [{ label: `Finish with ${plural(done, 'ticked set')}`, value: 'drop', cls: 'primary' }] : []),
        { label: `Count all ${plural(done + pending, 'set')} as done`, value: 'count', cls: done ? '' : 'primary' },
        { label: 'Keep logging', value: null, cls: 'ghost' },
      ],
    });
    if (!r) return;
    countPending = r === 'count';
  } else if (!await confirmSheet('Finish workout?', `${plural(done, 'set')} logged.`, 'Finish workout', 'good')) return;

  for (const e of s.exercises) e.sets = e.sets.filter(x => x.done || (countPending && x.reps > 0)).map(x => ({ ...x, done: true }));
  s.exercises = s.exercises.filter(e => e.sets.length);
  if (!s.exercises.length) { await discardActive(); replaceRoute('#/'); return; }
  s.end = Date.now();
  S.active = null;
  S.rev++;
  pendingSaves.delete(s.id);
  await db.put('sessions', s);
  stopRest();
  keepAwake(false);
  navigator.storage?.persist?.().catch(() => {});
  replaceRoute(`#/summary/${s.id}`);
}

// ---------------------------------------------------------------- Summary & past sessions
const statTiles = t => `<section class="card"><div class="stats">
  <div class="stat-tile"><div class="k">Duration</div><div class="v">${fmtDur(t.dur)}</div></div>
  <div class="stat-tile"><div class="k">Volume</div><div class="v">${fmtNum(t.vol)} <small>kg</small></div></div>
  <div class="stat-tile"><div class="k">Working sets</div><div class="v">${t.sets}</div></div>
  <div class="stat-tile"><div class="k">Exercises</div><div class="v">${t.exercises}</div></div></div></section>`;
function prCard(prs, title = 'New personal records') {
  if (!prs.length) return '';
  const byEx = new Map();
  for (const p of prs) { if (!byEx.has(p.exId)) byEx.set(p.exId, []); byEx.get(p.exId).push(p); }
  const was = p => (p.type === 'reps' ? `${p.prev}` : `${fmtNum(p.prev, p.type === 'e1rm' ? 1 : 2)} kg`);
  return `<section class="card"><div class="card-title"><h2>${title}</h2><span class="tag accent" aria-label="${plural(prs.length, 'record')}">${icon('trophy')}${prs.length}</span></div>
    <ul class="list">${[...byEx].map(([exId, ps]) => `<li class="pr-item"><span class="medal">${icon('trophy')}</span><div>
      <b>${esc(exName(exId))}</b>${ps.map(p => `<div class="small"><span class="muted">${PR_LABEL[p.type]}</span> <b>${prText(p)}</b> <span class="muted">(was ${was(p)})</span></div>`).join('')}</div></li>`).join('')}</ul></section>`;
}
const setsText = sets => sets.map(x => `${x.warmup ? 'W ' : ''}${x.kg > 0 ? `${fmtW(x.kg)}×` : ''}${x.reps}`).join(' · ');
const exerciseList = s => `<section class="card"><div class="card-title"><h2>Exercises</h2></div><ul class="list">${s.exercises.map(e => {
  const st = setStats(e.sets);
  return `<li><a class="prog-row" href="#/progress/ex/${encodeURIComponent(e.exId)}"><div class="grow"><b>${esc(exName(e.exId, e.name))}</b>
    <div class="hist-sets">${esc(setsText(e.sets))}</div></div><span class="small muted">${st?.vol ? `${fmtNum(st.vol)} kg` : st ? plural(st.reps, 'rep') : ''}</span></a></li>`;
}).join('')}</ul></section>`;

route(/^\/summary\/([\w-]+)$/, (q, id) => {
  const s = S.sessions.find(x => x.id === id);
  if (!s?.end) return replaceRoute('#/');
  const prs = analysis().prs.get(s.id) || [];
  view.innerHTML = `<div class="hero"><div class="badge-big">${icon(prs.length ? 'trophy' : 'check')}</div>
      <h1>Workout complete</h1><p class="muted">${esc(s.name)} · ${fmtDate(s.start)}${prs.length ? ` · ${plural(prs.length, 'new record')}` : ''}</p></div>
    ${statTiles(sessionTotals(s))}${prCard(prs)}${exerciseList(s)}
    <div class="btn-row" style="margin-top:16px"><a class="btn lg" href="#/session/${esc(s.id)}">View session</a>
      <button class="btn lg primary" data-action="replace" data-to="#/">Done</button></div>`;
});
route(/^\/session\/([\w-]+)$/, (q, id) => {
  const s = S.sessions.find(x => x.id === id);
  if (!s) return replaceRoute('#/history');
  if (!s.end) return replaceRoute('#/log');
  if (q.get('edit')) return sessionEditor(s, false);
  view.innerHTML = topbar(s.name, {
    back: '#/history',
    sub: `${fmtDate(s.start, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · ${fmtTime(s.start)}`,
    right: `<a class="icon-btn" href="#/session/${esc(s.id)}?edit=1" aria-label="Edit session">${icon('edit')}</a>`,
  }) + statTiles(sessionTotals(s)) + prCard(analysis().prs.get(s.id) || [], 'Records set') + exerciseList(s) + `
    <div class="btn-row" style="margin-top:16px"><a class="btn lg" href="#/session/${esc(s.id)}?edit=1">${icon('edit')}Edit</a>
      <button class="btn lg danger" data-action="del">${icon('trash')}Delete</button></div>`;
  A.del = async () => {
    if (!await confirmSheet('Delete this session?', 'It will be removed from your history and charts.', 'Delete session', 'danger')) return;
    await deleteSession(s);
    toast('Session deleted');
    replaceRoute('#/history');
  };
});

// ---------------------------------------------------------------- History calendar
const hist = { month: startOfMonth(Date.now()), sel: '' };
const sessRow = s => {
  const t = sessionTotals(s), prs = analysis().prs.get(s.id)?.length || 0;
  return `<li><a class="sess-row" href="#/session/${esc(s.id)}">${dotN(s.color, tplIndex(s.templateId) + 1 || '•')}
    <div class="grow"><b>${esc(s.name)}</b><span class="small">${fmtDate(s.start)} · ${fmtDur(t.dur)} · ${fmtNum(t.vol)} kg</span></div>
    ${prs ? `<span class="tag accent" aria-label="${plural(prs, 'record')}">${icon('trophy')}${prs}</span>` : ''}${icon('next')}</a></li>`;
};
route(/^\/history$/, () => {
  const fin = finished(), byDay = new Map();
  for (const s of fin) { const k = ymd(s.start); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(s); }
  const m0 = hist.month, d0 = new Date(m0), y = d0.getFullYear(), mo = d0.getMonth();
  const days = new Date(y, mo + 1, 0).getDate(), offset = (d0.getDay() + 6) % 7, today = ymd(Date.now());
  let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<div class="dow" aria-hidden="true">${d}</div>`).join('');
  cells += '<div class="d out"></div>'.repeat(offset);
  for (let d = 1; d <= days; d++) {
    const k = ymd(new Date(y, mo, d)), ss = byDay.get(k) || [];
    const label = `${fmtDate(parseYmd(k), { weekday: 'long', month: 'long', day: 'numeric' })}${ss.length ? `: ${ss.map(s => s.name).join(', ')}` : ''}`;
    cells += `<button class="d ${k === today ? 'today' : ''} ${hist.sel === k ? 'sel' : ''}" data-action="cal" data-k="${k}" aria-label="${esc(label)}">${d}
      ${ss.length ? `<span class="dots">${ss.slice(0, 2).map(s => `<b style="background:${dayBg(s.color)};color:${dayInk(s.color)}">${tplIndex(s.templateId) + 1 || '•'}</b>`).join('')}</span>` : ''}</button>`;
  }
  const monthSessions = fin.filter(s => s.start >= m0 && s.start < addMonths(m0, 1));
  const list = hist.sel ? byDay.get(hist.sel) || [] : monthSessions;
  const vol = monthSessions.reduce((a, s) => a + sessionTotals(s).vol, 0);
  view.innerHTML = topbar('History') + `
    <section class="card">
      <div class="cal-head"><button class="icon-btn" data-action="mon" data-d="-1" aria-label="Previous month">${icon('back')}</button>
        <h2>${fmtDate(m0, { month: 'long', year: 'numeric' })}</h2>
        <button class="icon-btn" data-action="mon" data-d="1" aria-label="Next month" ${addMonths(m0, 1) > Date.now() ? 'disabled' : ''}>${icon('next')}</button></div>
      <div class="cal">${cells}</div>
      <div class="day-legend">${S.templates.map((t, i) => `<span>${dotN(t.color, i + 1)}${esc(t.name)}</span>`).join('')}</div>
    </section>
    <div class="section-label">${hist.sel ? `${fmtDate(parseYmd(hist.sel), { weekday: 'long', month: 'long', day: 'numeric' })} · <button class="link" data-action="clear-sel">whole month</button>`
      : `${fmtDate(m0, { month: 'long' })} · ${plural(monthSessions.length, 'workout')}${vol ? ` · ${fmtNum(vol)} kg` : ''}`}</div>
    <section class="card" style="padding:4px 16px">${list.length ? `<ul class="list">${[...list].reverse().map(sessRow).join('')}</ul>`
      : `<div class="empty">${hist.sel ? 'Rest day. Nothing logged.' : 'No workouts this month yet.'}</div>`}</section>`;
  A.cal = el => {
    const ss = byDay.get(el.dataset.k) || [];
    if (ss.length === 1) return go(`#/session/${ss[0].id}`);
    hist.sel = hist.sel === el.dataset.k ? '' : el.dataset.k;
    rerender();
  };
  A.mon = el => { hist.month = addMonths(hist.month, +el.dataset.d); hist.sel = ''; rerender(); };
  A['clear-sel'] = () => { hist.sel = ''; rerender(); };
});

// ---------------------------------------------------------------- Progress
const prog = { range: 'all', bwRange: '3m', week: startOfWeek(Date.now()) };
const RANGES = [['1m', '1M', 30], ['3m', '3M', 91], ['6m', '6M', 182], ['1y', '1Y', 365], ['all', 'All', 0]];
const rangeButtons = (cur, action) => `<div class="range" role="group" aria-label="Time range">${RANGES.map(([k, l]) => `<button class="${cur === k ? 'on' : ''}" aria-pressed="${cur === k}" data-action="${action}" data-k="${k}">${l}</button>`).join('')}</div>`;
const rangeStart = k => { const r = RANGES.find(x => x[0] === k); return r?.[2] ? startOfDay(Date.now()) - r[2] * DAY : 0; };
const progTabs = cur => `<div class="seg" role="tablist" style="margin-bottom:14px">${[['', 'Exercises'], ['weekly', 'Weekly'], ['body', 'Body weight']].map(([k, l]) =>
  `<button role="tab" class="${cur === k ? 'on' : ''}" aria-selected="${cur === k}" data-action="replace" data-to="#/progress${k ? `/${k}` : ''}">${l}</button>`).join('')}</div>`;

route(/^\/progress$/, () => {
  const an = analysis();
  const rows = [...an.timeline].map(([exId, pts]) => ({ exId, pts, last: pts[pts.length - 1].t })).sort((a, b) => b.last - a.last);
  const all = [...an.prs.values()].flat().sort((a, b) => b.t - a.t);
  const seen = new Set(), recent = [];
  for (const p of all) {
    const k = p.sid + p.exId;
    if (seen.has(k)) continue;
    seen.add(k);
    recent.push(all.filter(x => x.sid === p.sid && x.exId === p.exId));
    if (recent.length === 5) break;
  }
  const recentCard = recent.length ? `<section class="card"><div class="card-title"><h2>Recent records</h2></div><ul class="list">${recent.map(ps => `
    <li><a class="pr-item" style="color:inherit" href="#/progress/ex/${encodeURIComponent(ps[0].exId)}"><span class="medal">${icon('trophy')}</span><div>
      <b>${esc(exName(ps[0].exId))}</b><div class="small muted">${ps.map(p => `${PR_LABEL[p.type]} ${prText(p)}`).join(' · ')} · ${relDay(ps[0].t)}</div></div></a></li>`).join('')}</ul></section>` : '';
  const list = rows.map(r => {
    const bw = r.pts.every(p => p.topKg === 0), last = r.pts[r.pts.length - 1];
    return `<li><a class="prog-row" href="#/progress/ex/${encodeURIComponent(r.exId)}"><div class="grow"><b>${esc(exName(r.exId))}</b>
      <span class="small">${bw ? `best ${Math.max(...r.pts.map(p => p.maxReps))} reps` : `e1RM ${fmtNum(last.e1, 1)} kg`} · ${plural(r.pts.length, 'session')} · ${relDay(r.last)}</span></div>
      ${spark(r.pts.slice(-12).map(p => (bw ? p.maxReps : p.e1)))}</a></li>`;
  }).join('');
  view.innerHTML = topbar('Progress') + progTabs('') + (rows.length
    ? `${recentCard}<div class="section-label">Exercises you've logged</div><section class="card" style="padding:4px 16px"><ul class="list">${list}</ul></section>`
    : `<div class="card empty">${icon('chart')}Finish your first workout to see charts and records here.</div>`);
});

route(/^\/progress\/ex\/(.+)$/, (q, id) => {
  const an = analysis(), all = an.timeline.get(id) || [], name = exName(id);
  const pts = all.filter(p => p.t >= rangeStart(prog.range));
  const bw = all.length > 0 && all.every(p => p.topKg === 0);
  const last = all[all.length - 1];
  const best = k => all.reduce((b, p) => (!b || p[k] > b[k] ? p : b), null);
  const recs = bw
    ? [['Most reps', best('maxReps'), p => `${p.maxReps}`], ['Most total reps', best('reps'), p => `${p.reps}`]]
    : [['Best e1RM', best('e1'), p => `${fmtNum(p.e1, 1)} kg`], ['Heaviest set', best('topKg'), p => `${fmtW(p.topKg)} kg × ${p.topReps}`],
      ['Best volume', best('vol'), p => `${fmtNum(p.vol)} kg`], ['Sessions', last, () => `${all.length}`]];
  const kgTip = (v, d, extra = '') => `${v}${extra}<span>${fmtDate(d.x, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>`;
  const series = (f, more = {}) => [{ points: pts.map(p => ({ x: p.t, y: f(p), p })), color: '--accent', area: true, ...more }];
  const charts = bw ? [
    { id: 'c1', title: 'Max reps', note: 'Best working set each session', latest: `${last.maxReps} <small>reps</small>`, opts: { series: series(p => p.maxReps), tip: d => kgTip(`${d.y} reps`, d) } },
    { id: 'c2', title: 'Total reps', note: 'All working sets each session', latest: `${last.reps} <small>reps</small>`, opts: { series: series(p => p.reps), tip: d => kgTip(`${d.y} reps`, d) } },
  ] : [
    { id: 'c1', title: 'Estimated 1RM', note: 'Epley formula on your best working set: kg × (1 + reps ÷ 30)', latest: `${fmtNum(last.e1, 1)} <small>kg</small>`,
      opts: { series: series(p => Math.round(p.e1 * 10) / 10), yFmt: v => fmtNum(v, 1), tip: d => kgTip(`${fmtNum(d.y, 1)} kg`, d) } },
    { id: 'c2', title: 'Top set', note: 'Heaviest working set each session', latest: `${fmtW(last.topKg)} <small>kg × ${last.topReps}</small>`,
      opts: { series: series(p => p.topKg), yFmt: v => fmtNum(v, 1), tip: d => kgTip(`${fmtW(d.y)} kg × ${d.p.topReps}`, d) } },
    { id: 'c3', title: 'Total volume', note: 'Reps × kg over all working sets', latest: `${fmtNum(last.vol)} <small>kg</small>`,
      opts: { series: series(p => p.vol), tip: d => kgTip(`${fmtNum(d.y)} kg`, d) } },
  ];
  const prSessions = new Set([...an.prs.values()].flat().filter(p => p.exId === id).map(p => p.sid));
  const log = [...all].reverse().slice(0, 40).map(p => {
    const s = S.sessions.find(x => x.id === p.id);
    const sets = s ? s.exercises.filter(e => e.exId === id).flatMap(e => e.sets) : [];
    return `<li><a class="prog-row" href="#/session/${esc(p.id)}"><div class="grow"><b>${fmtDate(p.t, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</b>
      <div class="hist-sets">${esc(setsText(sets))}</div></div>${prSessions.has(p.id) ? `<span class="tag accent">${icon('trophy')}PR</span>` : ''}
      <span class="small muted">${bw ? '' : `${fmtNum(p.e1, 1)} kg`}</span></a></li>`;
  }).join('');
  view.innerHTML = topbar(name, {
    back: '#/progress',
    right: S.exMap.has(id) ? `<a class="icon-btn" href="#/ex/${encodeURIComponent(id)}" aria-label="How to do ${esc(name)}">${icon('info')}</a>` : '',
  }) + (all.length ? `
    <section class="card"><div class="records">${recs.map(([k, p, f]) => `<div class="stat-tile"><div class="k">${k}</div>
      <div class="v" style="font-size:19px">${p ? f(p) : '—'}</div>${p && k !== 'Sessions' ? `<div class="small muted">${fmtDate(p.t, { month: 'short', day: 'numeric', year: 'numeric' })}</div>` : ''}</div>`).join('')}</div></section>
    <div style="margin:16px 0 2px">${rangeButtons(prog.range, 'range')}</div>
    ${charts.map(c => `<section class="card"><div class="chart-head"><h3>${c.title}</h3><span class="val">${c.latest}</span></div>
      <p class="small muted" style="margin-bottom:8px">${c.note}</p><div class="chart" id="${c.id}"></div></section>`).join('')}
    <div class="section-label">Session log</div>
    <section class="card" style="padding:4px 16px"><ul class="list">${log}</ul></section>`
    : `<div class="card empty">${icon('chart')}No finished sessions with ${esc(name)} yet.</div>`);
  for (const c of all.length ? charts : []) lineChart($(`#${c.id}`), c.opts);
  A.range = el => { prog.range = el.dataset.k; rerender(); };
});

/** Working sets per muscle and per group for one week. Primary muscle = 1 set, secondary = ½. */
function weekData(start) {
  const ss = finished().filter(s => s.start >= start && s.start < addDays(start, 7));
  const byMuscle = {}, byGroup = {}, hits = {};
  let sets = 0, vol = 0;
  for (const s of ss) for (const e of s.exercises) {
    const ex = S.exMap.get(e.exId);
    if (!ex) continue;
    for (const x of e.sets) {
      if (!x.done || x.warmup || !(x.reps > 0)) continue;
      sets++;
      vol += (x.kg > 0 ? x.kg : 0) * x.reps;
      const groups = new Map();
      for (const m of ex.primaryMuscles) { byMuscle[m] = (byMuscle[m] || 0) + 1; groups.set(GROUP_OF[m], 1); }
      for (const m of ex.secondaryMuscles) {
        if (ex.primaryMuscles.includes(m)) continue;
        byMuscle[m] = (byMuscle[m] || 0) + 0.5;
        if (!groups.has(GROUP_OF[m])) groups.set(GROUP_OF[m], 0.5);
      }
      for (const [g, v] of groups) {
        byGroup[g] = (byGroup[g] || 0) + v;
        if (v === 1) (hits[g] ||= new Set()).add(s.id);
      }
    }
  }
  return { ss, byMuscle, byGroup, hits, sets, vol };
}
route(/^\/progress\/weekly$/, () => {
  const wk = prog.week, d = weekData(wk), thisWeek = startOfWeek(Date.now());
  const maxG = Math.max(10, ...Object.values(d.byGroup));
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(wk, -7 * (7 - i)));
  const wd = weeks.map(weekData);
  const label = `${fmtDate(wk, { month: 'short', day: 'numeric' })} – ${fmtDate(addDays(wk, 6), { month: 'short', day: 'numeric' })}`;
  const bars = GROUPS.map(g => {
    const v = d.byGroup[g.id] || 0, n = d.hits[g.id]?.size || 0;
    return `<div class="mg-row ${v ? '' : 'zero'}"><div class="mg-top"><span class="lbl">${g.label}</span>
      <span class="n">${n ? `${n}× · ` : ''}${v ? plural(Math.round(v * 2) / 2, 'set') : 'not trained'}</span></div>
      <div class="track"><div class="fill" style="width:${(v / maxG) * 100}%"></div></div></div>`;
  }).join('');
  const matrix = `<div class="matrix" style="grid-template-columns:76px repeat(8, 1fr)"><span></span>
    ${weeks.map((w, i) => `<span class="wk">${i === 0 || new Date(w).getDate() <= 7 ? fmtDate(w, { month: 'short' }) : ''}<br>${new Date(w).getDate()}</span>`).join('')}
    ${GROUPS.map(g => `<span class="lbl">${g.label}</span>${wd.map((x, i) => {
      const v = x.byGroup[g.id] || 0, l = heatLevel(v);
      return `<span class="c" style="${l ? `background:var(--heat-${l});color:var(--heat-ink-${l})` : ''}" title="${g.label}, week of ${fmtDate(weeks[i], { month: 'short', day: 'numeric' })}: ${fmtNum(v, 1)} sets">${v ? Math.round(v) : ''}</span>`;
    }).join('')}`).join('')}</div>`;

  view.innerHTML = topbar('Progress') + progTabs('weekly') + `
    <section class="card"><div class="cal-head"><button class="icon-btn" data-action="wk" data-d="-1" aria-label="Previous week">${icon('back')}</button>
      <h2>${wk === thisWeek ? 'This week' : label}<span class="sub small muted" style="display:block;font-weight:500">${wk === thisWeek ? label : ''}</span></h2>
      <button class="icon-btn" data-action="wk" data-d="1" aria-label="Next week" ${wk >= thisWeek ? 'disabled' : ''}>${icon('next')}</button></div>
      <div class="stats" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-tile"><div class="k">Workouts</div><div class="v">${d.ss.length}</div></div>
        <div class="stat-tile"><div class="k">Sets</div><div class="v">${d.sets}</div></div>
        <div class="stat-tile"><div class="k">Volume</div><div class="v" style="font-size:18px">${fmtNum(d.vol)}<small> kg</small></div></div></div></section>
    <section class="card"><div class="card-title"><h2>Muscles hit</h2></div>
      ${muscleMap(m => { const l = heatLevel(d.byMuscle[m] || 0); return l ? `var(--heat-${l})` : ''; }, 'Muscles trained this week, shaded by number of sets')}
      ${heatLegend()}</section>
    <section class="card"><div class="card-title"><h2>By muscle group</h2></div>
      <p class="small muted" style="margin:-4px 0 8px">Sessions that trained it directly · sets (secondary muscles count ½)</p>${bars}</section>
    <section class="card"><div class="card-title"><h2>Last 8 weeks</h2></div><p class="small muted" style="margin:-4px 0 10px">Sets per muscle group, weeks starting Monday ${fmtDate(weeks[0], { day: 'numeric', month: 'short' })} to ${fmtDate(weeks[7], { day: 'numeric', month: 'short' })}</p>${matrix}${heatLegend()}</section>`;
  A.wk = el => { prog.week = Math.min(thisWeek, addDays(prog.week, 7 * +el.dataset.d)); rerender(); };
});

route(/^\/progress\/body$/, () => {
  const entries = S.bw, today = ymd(Date.now());
  const from = rangeStart(prog.bwRange);
  const raw = entries.map(e => ({ x: parseYmd(e.date), y: e.kg }));
  const pts = raw.filter(p => p.x >= from);
  // 7-day moving average: mean of the weigh-ins in the 7 days ending on each date
  const avg = pts.map(p => {
    const win = raw.filter(r => r.x > p.x - 7 * DAY && r.x <= p.x);
    return { x: p.x, y: win.reduce((a, r) => a + r.y, 0) / win.length, raw: p.y };
  });
  const latest = entries[entries.length - 1];
  const monthAgo = [...entries].reverse().find(e => parseYmd(e.date) <= Date.now() - 30 * DAY);
  const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtNum(Math.abs(n), 1)}`;
  view.innerHTML = topbar('Progress') + progTabs('body') + `
    <section class="card"><div class="bw-entry">
      <label class="field"><span>Date</span><input class="input" type="date" id="bwd" value="${today}" max="${today}"></label>
      <label class="field"><span>Weight (kg)</span><input class="input" id="bwk" inputmode="decimal" enterkeyhint="done" placeholder="${latest ? fmtW(latest.kg) : 'e.g. 80.5'}" style="font-size:18px;font-weight:700"></label>
      <button class="btn primary lg" data-action="bw-save">Save</button></div></section>
    ${entries.length ? `
    <section class="card"><div class="stats">
      <div class="stat-tile"><div class="k">Latest</div><div class="v">${fmtW(latest.kg)} <small>kg</small></div><div class="small muted">${relDay(parseYmd(latest.date))}</div></div>
      <div class="stat-tile"><div class="k">Change, 30 days</div><div class="v">${monthAgo ? `${signed(latest.kg - monthAgo.kg)} <small>kg</small>` : '—'}</div>
        <div class="small muted">${monthAgo ? `from ${fmtW(monthAgo.kg)} kg` : 'needs a month of data'}</div></div></div></section>
    <section class="card"><div class="chart-head"><h3>Trend</h3></div>
      <div style="margin:4px 0 8px">${rangeButtons(prog.bwRange, 'bw-range')}</div>
      <div class="chart-legend"><span><i class="pt" style="background:var(--muted)"></i>Weigh-ins</span><span><i class="ln" style="background:var(--accent)"></i>7-day average</span></div>
      <div class="chart" id="bwc"></div></section>
    <div class="section-label">Entries</div>
    <section class="card" style="padding:4px 16px"><ul class="list">${[...entries].reverse().slice(0, 60).map(e => `<li class="row" style="min-height:52px">
      <span style="flex:1">${fmtDate(parseYmd(e.date), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span><b class="tnum">${fmtW(e.kg)} kg</b>
      <button class="icon-btn" data-action="bw-del" data-d="${esc(e.date)}" aria-label="Delete entry">${icon('x')}</button></li>`).join('')}</ul></section>`
    : `<div class="card empty">${icon('chart')}Log your weight to start a trend line.</div>`}`;
  if (entries.length) {
    lineChart($('#bwc'), {
      series: [{ points: pts, color: '--muted', kind: 'dots' }, { points: avg, color: '--accent', kind: 'line', markers: 'last' }],
      hoverIndex: 1, yFmt: v => fmtNum(v, 1),
      tip: p => `${fmtNum(p.y, 1)} kg average<span>${fmtDate(p.x)} · weighed ${fmtW(p.raw)} kg</span>`,
    });
  }
  const save = async () => {
    const kg = parseNum($('#bwk').value), date = $('#bwd').value || today;
    if (!(kg > 20 && kg < 400)) { toast('Enter your weight in kg'); $('#bwk').focus(); return; }
    const rec = { date, kg: Math.round(kg * 100) / 100 };
    await db.put('bodyweight', rec);
    S.bw = S.bw.filter(e => e.date !== date).concat(rec).sort((a, b) => a.date.localeCompare(b.date));
    toast(`Saved ${fmtW(rec.kg)} kg`);
    rerender();
  };
  A['bw-save'] = save;
  on($('#bwk'), 'keydown', ev => { if (ev.key === 'Enter') save(); });
  A['bw-range'] = el => { prog.bwRange = el.dataset.k; rerender(); };
  A['bw-del'] = async el => {
    const rec = S.bw.find(e => e.date === el.dataset.d);
    await db.del('bodyweight', rec.date);
    S.bw = S.bw.filter(e => e !== rec);
    rerender();
    toast('Entry deleted', { action: 'Undo', fn: async () => { await db.put('bodyweight', rec); S.bw = S.bw.concat(rec).sort((a, b) => a.date.localeCompare(b.date)); rerender(); } });
  };
});

// ---------------------------------------------------------------- Settings: offline images, backup
const allImageUrls = () => S.base.filter(e => e.img).flatMap(e => [thumbUrl(e.id), imgUrl(e.id, 0), imgUrl(e.id, 1)]);
const dl = { running: false, done: 0, total: 0, failed: 0, ctrl: null };
async function downloadAllImages() {
  if (dl.running || !('caches' in window)) return;
  navigator.storage?.persist?.().catch(() => {});
  const cache = await caches.open(IMG_CACHE);
  const have = new Set((await cache.keys()).map(r => new URL(r.url).pathname));
  const urls = allImageUrls().map(u => new URL(u, location.href));
  const todo = urls.filter(u => !have.has(u.pathname));
  Object.assign(dl, { running: true, total: urls.length, done: urls.length - todo.length, failed: 0, ctrl: new AbortController() });
  const paint = throttle(paintOffline, 300);
  paintOffline();
  const worker = async () => {
    while (todo.length && !dl.ctrl.signal.aborted) {
      const u = todo.shift();
      try {
        const r = await fetch(u.href, { signal: dl.ctrl.signal });
        if (r.ok) await cache.put(u.href, r); else dl.failed++;
      } catch { if (!dl.ctrl.signal.aborted) dl.failed++; }
      dl.done++;
      paint();
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const stopped = dl.ctrl.signal.aborted;
  dl.running = false;
  toast(stopped ? 'Download stopped' : dl.failed ? `${plural(dl.failed, 'image')} failed. Check your connection and tap again.` : 'Every exercise demo is now available offline', { ms: 5000 });
  paintOffline();
}
async function paintOffline() {
  const card = $('#offline-card');
  if (!card) return;
  const total = allImageUrls().length;
  let have = dl.done;
  if (!dl.running) have = 'caches' in window ? (await (await caches.open(IMG_CACHE)).keys()).length : 0;
  const est = await navigator.storage?.estimate?.().catch(() => null);
  if (!card.isConnected) return;
  const pct = Math.min(100, (have / total) * 100);
  card.innerHTML = `<div class="row"><div style="flex:1"><b>Exercise images</b>
      <div class="small muted">${fmtNum(Math.min(have, total))} of ${fmtNum(total)} saved on this phone${est?.usage ? ` · ${fmtMB(est.usage)} used` : ''}</div></div></div>
    <div class="progress-line" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div style="width:${pct}%"></div></div>
    <p class="small muted" style="margin:10px 0 12px">The app itself always works offline. Images are saved as you view them, or save them all now (about 32 MB) so every demo plays without signal.</p>
    ${dl.running ? '<button class="btn block" data-action="dl-stop">Stop download</button>'
      : have >= total ? `<span class="tag good">${icon('check')}All images available offline</span>`
      : `<button class="btn block primary" data-action="dl-all">${icon('offline')}Download all images for offline</button>`}
    ${have && !dl.running ? '<button class="btn block ghost" data-action="dl-clear" style="margin-top:8px">Remove saved images</button>' : ''}`;
}
GA['dl-all'] = () => downloadAllImages();
GA['dl-stop'] = () => dl.ctrl?.abort();
GA['dl-clear'] = async () => {
  if (!await confirmSheet('Remove saved images?', 'Demos will download again as you view them.', 'Remove images', 'danger')) return;
  await caches.delete(IMG_CACHE);
  toast('Saved images removed');
  paintOffline();
};

async function backupFile() {
  await flushSaves.flush();
  const data = { app: 'gym-tracker', version: 1, exportedAt: new Date().toISOString() };
  for (const n of Object.keys(SYNCED)) data[n] = await db.all(n);
  const name = `gym-backup-${ymd(Date.now())}.json`;
  return { data, name, file: new File([JSON.stringify(data)], name, { type: 'application/json' }) };
}
const markBackup = () => { S.settings.lastBackup = Date.now(); saveSettings(); };
let canShareFiles = false;
try { canShareFiles = !!navigator.canShare?.({ files: [new File(['{}'], 'gym-backup.json', { type: 'application/json' })] }); } catch { /* unsupported */ }

GA.export = async () => {
  const { data, name, file } = await backupFile();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  markBackup();
  toast(`Saved ${name} (${plural(data.sessions.length, 'session')}) to Downloads`, { ms: 5000 });
  rerender();
};
GA.share = async () => {
  const { file } = await backupFile();
  try { await navigator.share({ files: [file], title: 'Gym Tracker backup' }); markBackup(); rerender(); }
  catch (e) { if (e.name !== 'AbortError') toast("Sharing didn't work. Use Export instead."); }
};
/**
 * Rebuild a backup file's records field by field, keeping only known fields with the right types.
 * A backup can come from anywhere, so nothing in it reaches the database or the page unchecked.
 */
function cleanBackup(data) {
  const arr = v => (Array.isArray(v) ? v : []);
  const id = v => (typeof v === 'string' && /^[\w-]{1,120}$/.test(v) ? v : null);
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : null);
  const int = (v, lo, hi) => { const n = num(v, lo, hi); return n == null ? null : Math.round(n); };
  const time = v => num(v, 0, Date.now() + DAY);
  const muscles = v => arr(v).filter(m => MUSCLES.includes(m));
  const set = x => ({ reps: int(x?.reps, 0, 1000), kg: num(x?.kg, 0, 2000), warmup: !!x?.warmup, done: !!x?.done });
  const sessions = arr(data.sessions).map(s => {
    const start = time(s?.start), end = s?.end == null ? null : time(s.end);
    if (!id(s?.id) || !start) return null;
    return {
      id: s.id, templateId: id(s.templateId) || '', name: text(s.name, 80) || 'Workout', color: dayColor(s.color),
      start, end: end && end >= start ? end : null,
      exercises: arr(s.exercises).filter(e => id(e?.exId)).map(e => ({
        exId: e.exId, name: text(e.name, 120),
        ...(e.target ? { target: { sets: int(e.target.sets, 1, 50) || 3, reps: int(e.target.reps, 1, 1000) || 10 } } : {}),
        sets: arr(e.sets).slice(0, 100).map(set),
      })),
    };
  }).filter(Boolean);
  const templates = arr(data.templates).filter(t => id(t?.id)).map((t, i) => ({
    id: t.id, name: text(t.name, 40) || `Day ${i + 1}`, color: dayColor(t.color), order: int(t.order, 0, 1000) ?? i,
    items: arr(t.items).filter(x => id(x?.exId)).map(x => ({ exId: x.exId, sets: int(x.sets, 1, 12) || 3, reps: int(x.reps, 1, 100) || 10 })),
  }));
  const bodyweight = arr(data.bodyweight)
    .filter(b => typeof b?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && num(b.kg, 1, 1000) > 0)
    .map(b => ({ date: b.date, kg: num(b.kg, 1, 1000) }));
  const custom = arr(data.custom).filter(e => id(e?.id) && text(e.name, 80).trim()).map(e => ({
    id: e.id, custom: true, name: text(e.name, 80).trim(), primaryMuscles: muscles(e.primaryMuscles), secondaryMuscles: muscles(e.secondaryMuscles), equipment: EQUIPMENT.some(q => q.m[0] === e.equipment) ? e.equipment : 'other',
    category: 'strength', instructions: [], notes: text(e.notes, 2000), photo: safePhoto(e.photo), img: 0, created: time(e.created) || Date.now(),
  }));
  const p = arr(data.settings).find(r => r?.key === 'prefs');
  const settings = p ? [{
    key: 'prefs', ...DEFAULT_SETTINGS,
    theme: ['system', 'light', 'dark'].includes(p.theme) ? p.theme : 'system',
    defaultRest: int(p.defaultRest, 15, 600) || DEFAULT_SETTINGS.defaultRest,
    vibrate: p.vibrate !== false, sound: p.sound !== false, wakeLock: p.wakeLock !== false,
    restByEx: Object.fromEntries(Object.entries(p.restByEx && typeof p.restByEx === 'object' ? p.restByEx : {})
      .filter(([k, v]) => id(k) && int(v, 15, 600)).map(([k, v]) => [k, int(v, 15, 600)])),
    seeded: !!p.seeded, lastBackup: time(p.lastBackup) || 0, installHidden: !!p.installHidden,
  }] : [];
  return { settings, templates, sessions, bodyweight, custom };
}
async function importBackup(fileObj) {
  let data;
  try { data = JSON.parse(await fileObj.text()); } catch { toast("That file isn't a valid backup"); return; }
  if (data?.app !== 'gym-tracker' || !Array.isArray(data.sessions)) { toast("That isn't a Gym Tracker backup"); return; }
  const clean = cleanBackup(data);
  const when = Date.parse(data.exportedAt);
  const msg = `${plural(clean.sessions.length, 'session')}, ${plural(clean.bodyweight.length, 'body-weight entry', 'body-weight entries')} and ${plural(clean.custom.length, 'custom exercise')}${when ? ` from ${fmtDate(when, { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}.<br><b>This replaces everything in your account, on every device.</b>`;
  if (!await confirmSheet('Restore this backup?', msg, 'Replace my data', 'danger')) return;
  stopRest();
  await db.replaceAll(clean);
  await loadUserData();
  keepAwake(!!S.active);
  syncNow();
  toast('Backup restored');
  replaceRoute('#/');
}

let installEvt = null;
addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEvt = e;
  if (/^\/(settings)?$/.test(parseHash().path)) rerender();
});
addEventListener('appinstalled', () => { installEvt = null; toast('Installed. Open Gym from your home screen.'); rerender(); });
GA.install = async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice.catch(() => {});
  installEvt = null;
  rerender();
};

route(/^\/settings$/, () => {
  const st = S.settings;
  const sw = (k, label, sub) => `<label class="switch-row"><div><b>${label}</b>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>
    <span class="switch"><input type="checkbox" data-set="${k}" ${st[k] ? 'checked' : ''}><span></span></span></label>`;
  const standalone = matchMedia('(display-mode: standalone)').matches;
  view.innerHTML = topbar('Settings') + `
    ${installEvt ? `<section class="card"><div class="row">${icon('phone')}<div style="flex:1"><b>Install the app</b>
      <div class="small muted">Home-screen icon, full screen, works offline at the gym.</div></div></div>
      <button class="btn primary block" style="margin-top:12px" data-action="install">Install Gym Tracker</button></section>`
      : standalone ? '' : `<section class="card"><div class="row">${icon('phone')}<div style="flex:1"><b>Install the app</b>
      <div class="small muted">In Chrome: menu ⋮ → <b>Add to home screen</b> → Install. In Samsung Internet: menu → <b>Add page to</b> → Home screen.</div></div></div></section>`}
    <div class="section-label">Account</div>
    <section class="card">
      <div class="row">${avatar(S.auth.name)}<div style="flex:1;min-width:0"><b>${esc(S.auth.name)}</b>
        <div class="small muted">@${esc(S.auth.username)}${S.auth.isAdmin ? ' · admin' : ''}</div></div></div>
      <div class="sync-box">${icon('cloud')}<span id="sync-line" aria-live="polite"></span></div>
      <div class="stack">
        <button class="btn block" data-action="sync-now">${icon('refresh')}Sync now</button>
        ${S.auth.isAdmin ? `<a class="btn block" href="#/admin">${icon('user')}People who can use the app</a>` : ''}
        <button class="btn block" data-action="change-pw">${icon('key')}Change password</button>
        <button class="btn block danger" data-action="sign-out">${icon('logout')}Sign out</button>
      </div></section>
    <div class="section-label">Appearance</div>
    <section class="card"><div class="seg">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) =>
      `<button class="${st.theme === k ? 'on' : ''}" aria-pressed="${st.theme === k}" data-action="theme" data-k="${k}">${l}</button>`).join('')}</div></section>
    <div class="section-label">Workout</div>
    <section class="card">
      <div class="switch-row"><div><b>Default rest</b><div class="small muted">Unless an exercise has its own</div></div>
        <div class="stepper"><button data-action="drest" data-d="-15" aria-label="15 seconds less">−</button><output id="drest">${fmtRest(st.defaultRest)}</output>
        <button data-action="drest" data-d="15" aria-label="15 seconds more">+</button></div></div>
      ${sw('vibrate', 'Vibrate when rest ends')}
      ${sw('sound', 'Beep when rest ends')}
      ${sw('wakeLock', 'Keep screen on during a workout', 'So the rest timer can alert you')}
    </section>
    <div class="section-label">Offline</div>
    <section class="card" id="offline-card"><div class="small muted">Checking saved images…</div></section>
    <div class="section-label">Backup</div>
    <section class="card">
      <p class="small muted" style="margin-bottom:12px">Your data syncs to your private account in the cloud. A backup file is an extra copy you can keep in Google Drive.
        ${st.lastBackup ? `Last backup: <b>${relDay(st.lastBackup)}</b>.` : '<b>No backup yet.</b>'}</p>
      <div class="stack">
        ${canShareFiles ? `<button class="btn block primary" data-action="share">${icon('share')}Share backup to Drive…</button>` : ''}
        <button class="btn block ${canShareFiles ? '' : 'primary'}" data-action="export">${icon('download')}Export backup file</button>
        <label class="btn block">${icon('upload')}Import backup…<input type="file" id="imp" accept="application/json,.json" hidden></label>
      </div></section>
    <div class="section-label">Data</div>
    <section class="card"><div class="stack">
      <button class="btn block" data-action="reset-days">Reset the 4 workout days</button>
      <button class="btn block danger" data-action="erase">${icon('trash')}Erase all my data</button></div></section>
    <a class="card prog-row" href="#/about" style="margin-top:14px;padding:12px 16px">${icon('info')}<div class="grow"><b>About &amp; credits</b>
      <span class="small">Exercise data licence, how numbers are calculated</span></div>${icon('next')}</a>`;
  paintOffline();
  on(view, 'change', ev => {
    const k = ev.target.dataset.set;
    if (k) { S.settings[k] = ev.target.checked; saveSettings(); if (k === 'wakeLock') keepAwake(!!S.active); }
  });
  on($('#imp'), 'change', ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) importBackup(f); });
  A.theme = el => { S.settings.theme = el.dataset.k; saveSettings(); applyTheme(); rerender(); };
  A.drest = el => { S.settings.defaultRest = clamp(S.settings.defaultRest + +el.dataset.d, 15, 600); saveSettings(); $('#drest').textContent = fmtRest(S.settings.defaultRest); };
  A['reset-days'] = async () => {
    if (!await confirmSheet('Reset workout days?', 'Your 4 days go back to the default names and exercises. Logged sessions are kept.', 'Reset days')) return;
    S.templates = DEFAULT_TEMPLATES.map(makeTemplate);
    for (const t of S.templates) await saveTemplate(t);
    toast('Workout days reset');
  };
  A.erase = async () => {
    if (!await confirmSheet('Erase all your data?', 'Deletes every workout, body-weight entry, custom exercise and setting in your account, on this phone and in the cloud. Export a backup first if you might want it back.', 'Erase everything', 'danger')) return;
    stopRest();
    // A fresh start: default days and settings, written as new data so they replace the old copies everywhere.
    await db.replaceAll({
      templates: DEFAULT_TEMPLATES.map(makeTemplate),
      settings: [{ key: 'prefs', ...DEFAULT_SETTINGS, restByEx: { ...DEFAULT_RESTS }, seeded: true }],
    });
    await loadUserData();
    syncNow();
    keepAwake(false);
    toast('All data erased');
    replaceRoute('#/');
  };
});

function swVersion() {
  return new Promise(res => {
    const c = navigator.serviceWorker?.controller;
    if (!c) return res(null);
    const ch = new MessageChannel();
    ch.port1.onmessage = e => res(e.data);
    c.postMessage({ type: 'version' }, [ch.port2]);
    setTimeout(() => res(null), 1500);
  });
}
route(/^\/about$/, () => {
  view.innerHTML = topbar('About', { back: '#/settings' }) + `
    <section class="card about"><div class="row"><img src="icons/icon-192.png" width="56" height="56" alt="" style="border-radius:14px">
      <div><h2>Gym Tracker</h2><div class="small muted" id="ver">Version …</div></div></div>
      <p style="margin-top:14px">Your workouts are saved on this phone first, so the app works without signal, and synced to your private account on Cloudflare (D1) whenever you're online. Only people the owner adds can sign in, and nobody else can see your log. There is no advertising. Cloudflare Web Analytics counts page visits without cookies; your workouts are never part of it.</p></section>
    <section class="card about"><h2>Exercise library</h2>
      <p style="margin-top:8px">The ${fmtNum(S.base.length)} exercises, their start and end photos, instructions and muscle data come from
        <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener">free-exercise-db</a> by yuhonas, which builds on
        <a href="https://github.com/wrkout/exercises.json" target="_blank" rel="noopener">exercises.json</a>. Thank you!</p>
      <p>The dataset is dedicated to the <b>public domain</b> under <a href="https://unlicense.org" target="_blank" rel="noopener">the Unlicense</a>.
        A copy ships with the app: <a href="data/free-exercise-db-LICENSE.md" target="_blank">free-exercise-db-LICENSE.md</a>.
        For this app the photos were resized and converted to WebP and some instruction text was tidied.</p></section>
    <section class="card about"><h2>How the numbers work</h2>
      <p style="margin-top:8px"><b>Estimated 1RM</b> uses the Epley formula, kg × (1 + reps ÷ 30), on your best working set. Warm-up sets never count.</p>
      <p><b>Volume</b> is reps × kg over working sets. A <b>record</b> is flagged when a session beats every earlier session for that exercise
        (estimated 1RM, heaviest weight, volume, or reps for bodyweight moves).</p>
      <p><b>Weekly sets</b> count 1 for each muscle an exercise mainly trains and ½ for muscles it also works.</p></section>`;
  swVersion().then(v => { const el = $('#ver'); if (el) el.textContent = v ? `Version ${v} · offline ready` : 'Offline cache not active yet'; });
});

// ============================================================ 8. rest timer & wake lock
const rest = { end: 0, total: 0, label: '', timer: 0, fired: false, hideT: 0 };
const restbar = document.getElementById('restbar');
function startRest(sec, label) {
  ensureAudio();
  clearInterval(rest.timer);
  clearTimeout(rest.hideT);
  Object.assign(rest, { end: Date.now() + sec * 1000, total: sec, label, fired: false });
  restbar.className = 'restbar';
  restbar.innerHTML = `<div class="bar"></div><span class="t"></span><span class="l">Rest<b>${esc(label)}</b></span>
    <button data-action="rest-adj" data-d="-15" aria-label="15 seconds less">−15</button>
    <button data-action="rest-adj" data-d="15" aria-label="15 seconds more">+15</button>
    <button data-action="rest-skip" aria-label="Skip rest">${icon('x')}</button>`;
  restbar.hidden = false;
  document.body.classList.add('resting');
  rest.timer = setInterval(tickRest, 250);
  tickRest();
}
function tickRest() {
  if (!rest.end || restbar.hidden) return;
  const left = rest.end - Date.now(), t = $('.t', restbar), bar = $('.bar', restbar);
  if (left > 0) {
    t.textContent = fmtClock(left + 999);
    bar.style.width = `${(1 - left / (rest.total * 1000)) * 100}%`;
    return;
  }
  if (rest.fired) return;
  rest.fired = true;
  clearInterval(rest.timer);
  t.textContent = '0:00';
  bar.style.width = '100%';
  restbar.classList.add('over');
  $('.l', restbar).innerHTML = 'Rest over<b>Time for your next set</b>';
  if (S.settings.vibrate) navigator.vibrate?.([400, 160, 400, 160, 600]);
  if (S.settings.sound) beep();
  rest.hideT = setTimeout(stopRest, 8000);
}
function stopRest() {
  clearInterval(rest.timer);
  clearTimeout(rest.hideT);
  rest.end = 0;
  restbar.hidden = true;
  document.body.classList.remove('resting');
}
GA['rest-adj'] = el => {
  const d = +el.dataset.d;
  if (rest.fired) { if (d > 0) startRest(d, rest.label); return; }
  rest.end += d * 1000;
  rest.total = Math.max(1, rest.total + d);
  tickRest();
};
GA['rest-skip'] = () => stopRest();

let actx = null;
function ensureAudio() {
  if (!S.settings.sound) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { actx = null; }
}
function beep() {
  if (!actx) return;
  const t0 = actx.currentTime;
  [0, 0.28, 0.56].forEach((d, i) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine';
    o.frequency.value = i === 2 ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.22);
    o.connect(g).connect(actx.destination);
    o.start(t0 + d);
    o.stop(t0 + d + 0.25);
  });
}

let wakeLock = null;
async function keepAwake(want) {
  try {
    if (want && S.settings.wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      if (!wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } else if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') return; // saving + upload: see section 9
  if (S.active) keepAwake(true);
  tickRest();
});
// Offline image that was never cached: hide the broken icon (thumbnails keep their placeholder background).
document.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.classList.add('img-missing'); }, true);

// ============================================================ 9. accounts & cloud sync
async function loadUserData() {
  const [custom, templates, sessions, bw, settings] = await Promise.all(['custom', 'templates', 'sessions', 'bodyweight', 'settings'].map(n => db.all(n)));
  S.custom = custom;
  S.settings = { ...DEFAULT_SETTINGS, ...(settings.find(r => r.key === 'prefs') || {}) };
  delete S.settings.key;
  S.templates = templates.sort((a, b) => a.order - b.order);
  S.sessions = sessions;
  sortSessions();
  S.bw = bw.sort((a, b) => a.date.localeCompare(b.date));
  S.active = [...S.sessions].reverse().find(s => !s.end) || null;
  indexExercises();
  // Any missing default day is added as "older than anything", so a real copy in the cloud always wins.
  const missing = DEFAULT_TEMPLATES.map(makeTemplate).filter(t => !S.templates.some(x => x.id === t.id));
  if (missing.length) {
    S.templates.push(...missing);
    S.templates.sort((a, b) => a.order - b.order);
    await db.write(missing.map(t => ({ store: 'templates', value: t })), { updatedAt: 1 });
  }
  if (!S.settings.seeded) {
    S.settings.restByEx = { ...DEFAULT_RESTS, ...S.settings.restByEx };
    S.settings.seeded = true;
    await db.put('settings', { key: 'prefs', ...S.settings }, { updatedAt: 1 });
  }
  S.rev++;
  applyTheme();
}

/** JSON API call. Throws an Error with .status/.data, or .offline when the network is down. */
async function api(method, path, body, { keepalive = false } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store', keepalive,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new Error("You're offline");
    e.offline = true;
    throw e;
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !data) {
    const e = new Error(data?.error || `The server answered ${res.status}`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

// ---- sync engine: push the outbox, pull everything newer than our cursor, repeat until done
const SYNC = { running: false, again: false, timer: 0, last: 0, error: '', pending: 0 };
function onLocalChange() {
  SYNC.pending = Math.max(SYNC.pending, 1);
  paintSync();
  scheduleSync();
}
function scheduleSync(ms = 2000) {
  clearTimeout(SYNC.timer);
  SYNC.timer = setTimeout(() => syncNow(), ms);
}
async function syncNow({ keepalive = false } = {}) {
  if (!S.auth || S.locked) return;
  if (SYNC.running) { SYNC.again = true; return; }
  SYNC.running = true;
  clearTimeout(SYNC.timer);
  paintSync();
  let changed = false;
  try {
    for (let round = 0; round < 50; round++) {
      const outbox = (await db.all('outbox')).sort((a, b) => a.updatedAt - b.updatedAt);
      const batch = [];
      let size = 0;
      for (const o of outbox) {
        const n = o.deleted ? 80 : JSON.stringify(o.data).length + 80;
        if (batch.length && (size + n > 800000 || batch.length >= 300)) break;
        batch.push(o);
        size += n;
      }
      const res = await api('POST', '/api/sync', {
        cursor: (await metaGet('cursor')) || 0,
        changes: batch.map(o => ({ kind: SYNCED[o.store][0], id: o.id, deleted: o.deleted, data: o.data, updatedAt: o.updatedAt })),
      }, { keepalive: keepalive && size < 50000 });
      await dropSent(batch);
      if (await applyRemote(res.changes)) changed = true;
      await metaSet('cursor', res.cursor);
      if (batch.length === outbox.length && !res.more) break;
    }
    SYNC.last = Date.now();
    SYNC.error = '';
    await metaSet('lastSync', SYNC.last);
  } catch (err) {
    if (err.status === 401) sessionEnded();
    else if (err.status === 403 && err.data?.mustChange) { S.auth.mustChange = true; showPasswordScreen(); }
    else SYNC.error = err.offline ? 'offline' : err.message;
  } finally {
    SYNC.running = false;
    SYNC.pending = await db.count('outbox');
    paintSync();
    if (changed) refreshAfterSync();
    if (SYNC.again) { SYNC.again = false; scheduleSync(300); }
  }
}
/** Remove sent changes from the outbox unless they were edited again while in flight. */
async function dropSent(batch) {
  if (!batch.length) return;
  const tx = (await idb()).transaction('outbox', 'readwrite');
  const os = tx.objectStore('outbox');
  for (const o of batch) {
    const r = os.get(o.key);
    r.onsuccess = () => { if (r.result && r.result.updatedAt === o.updatedAt) os.delete(o.key); };
  }
  await txDone(tx);
}
/** Apply other devices' changes to the local copy and to S. Returns true if anything changed. */
async function applyRemote(changes) {
  if (!changes?.length) return false;
  const mine = new Map((await db.all('outbox')).map(o => [o.key, o]));
  const ops = [];
  for (const c of changes) {
    const store = KIND_STORE[c.kind];
    if (!store) continue;
    const key = `${store}|${c.id}`;
    const local = mine.get(key);
    if (local && local.updatedAt > c.updatedAt) continue; // ours is newer and goes up next round
    // The workout open on this phone belongs to this phone until it is finished.
    if (store === 'sessions' && S.active?.id === c.id && !c.deleted && !c.data?.end) continue;
    ops.push(c.deleted ? { store, key: c.id, del: true } : { store, value: c.data });
    if (local) ops.push({ store: 'outbox', key, del: true });
  }
  if (!ops.length) return false;
  await db.write(ops, { sync: false });
  patchState(ops.filter(o => o.store !== 'outbox'));
  return true;
}
function patchState(ops) {
  let sessions = false, custom = false;
  const upsert = (arr, keyName, o) => {
    const k = String(o.del ? o.key : o.value[keyName]);
    const i = arr.findIndex(x => String(x[keyName]) === k);
    if (i >= 0) arr.splice(i, 1);
    if (!o.del) arr.push(o.value);
  };
  for (const o of ops) {
    if (o.store === 'sessions') { upsert(S.sessions, 'id', o); sessions = true; }
    else if (o.store === 'templates') upsert(S.templates, 'id', o);
    else if (o.store === 'bodyweight') upsert(S.bw, 'date', o);
    else if (o.store === 'custom') { upsert(S.custom, 'id', o); custom = true; }
    else if (o.store === 'settings' && !o.del && o.value.key === 'prefs') {
      S.settings = { ...DEFAULT_SETTINGS, ...o.value };
      delete S.settings.key;
      applyTheme();
    }
  }
  S.templates.sort((a, b) => a.order - b.order);
  S.bw.sort((a, b) => a.date.localeCompare(b.date));
  if (sessions) {
    sortSessions();
    if (!S.active || !S.sessions.includes(S.active) || S.active.end) S.active = [...S.sessions].reverse().find(s => !s.end) || null;
    S.rev++;
  }
  if (custom) indexExercises();
}
/** Show synced changes, unless that would interrupt typing, a sheet or a workout in progress. */
function refreshAfterSync() {
  const el = document.activeElement;
  const typing = el && view.contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  if (sheet || typing || /^\/(log|custom)/.test(parseHash().path) || parseHash().q.get('edit')) return;
  rerender();
}
const relTime = t => {
  const m = Math.round((Date.now() - t) / 6e4);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 24 * 60 ? `${Math.round(m / 60)} h ago` : relDay(t);
};
function syncText() {
  if (SYNC.running) return 'Syncing…';
  const why = SYNC.error === 'offline' ? " · you're offline" : SYNC.error ? ` · ${SYNC.error}` : '';
  if (SYNC.pending) return `${plural(SYNC.pending, 'change')} waiting to upload${why}`;
  if (SYNC.error === 'offline') return "Offline. Everything is saved on this phone and will upload later.";
  if (SYNC.error) return SYNC.error;
  return SYNC.last ? `All saved to the cloud · ${relTime(SYNC.last)}` : 'Not synced yet';
}
function paintSync() {
  const line = $('#sync-line');
  if (line) line.textContent = syncText();
  const ind = $('#sync-ind');
  if (ind) { ind.hidden = !(SYNC.pending && SYNC.error); ind.setAttribute('aria-label', syncText()); }
}
addEventListener('online', () => syncNow());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { syncNow(); return; }
  // Leaving the app: save the open workout, then upload it while the page can still talk.
  Promise.resolve(flushSaves.flush()).then(() => { if (S.auth && !S.locked) syncNow({ keepalive: true }); });
});
addEventListener('pagehide', () => flushSaves.flush());
setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
GA['sync-now'] = () => syncNow();
GA['go-settings'] = () => go('#/settings');

// ---- sign-in screens (shown instead of the app)
function authView(html) {
  resetView();
  S.locked = true;
  document.body.classList.add('auth-mode');
  stopRest();
  view.innerHTML = `<div class="auth-wrap"><div class="auth-brand"><img src="icons/icon-192.png" alt="" width="64" height="64"><h1>Gym Tracker</h1></div>${html}</div>`;
}
/** Wire the screen's form: submit runs `fn(form.elements)`; thrown errors show under the form. */
function authForm(fn) {
  const form = $('#auth-form'), err = $('.form-error', form), btn = $('button[type=submit]', form);
  on(form, 'submit', async ev => {
    ev.preventDefault();
    err.hidden = true;
    btn.disabled = true;
    try { await fn(form.elements); }
    catch (e) {
      err.textContent = e.offline ? "You're offline. Connect to the internet to sign in." : e.message;
      err.hidden = false;
    } finally { if (btn.isConnected) btn.disabled = false; }
  });
}
const field = (label, name, attrs = '') => `<label class="field"><span>${label}</span><input class="input" name="${name}" ${attrs}></label>`;
const NO_AUTOCORRECT = 'autocapitalize="none" autocorrect="off" spellcheck="false"';
GA.reload = () => location.reload();

function showLogin({ message = '' } = {}) {
  authView(`<form id="auth-form" class="card stack" novalidate>
      <div><h2>Sign in</h2>${message ? `<p class="small muted" style="margin-top:4px">${esc(message)}</p>` : ''}</div>
      ${field('Username', 'username', `autocomplete="username" ${NO_AUTOCORRECT} required value="${esc(S.auth?.username || '')}"`)}
      ${field('Password', 'password', 'type="password" autocomplete="current-password" required')}
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary lg block" type="submit">Sign in</button>
    </form>
    <p class="small muted center" style="margin-top:16px">No account? Ask the owner of this app to add you.</p>`);
  authForm(async f => {
    const password = f.password.value;
    const r = await api('POST', '/api/auth/login', { username: f.username.value, password });
    await signedIn(r.user, { password });
  });
}
function showSetup(configured) {
  if (!configured) {
    authView(`<div class="card"><h2>Almost ready</h2><p style="margin-top:8px">Add a secret named <b>SETUP_CODE</b> to this Pages project in Cloudflare and redeploy. Then reload this page to create your account.</p>
      <button class="btn block" style="margin-top:14px" data-action="reload">Reload</button></div>`);
    return;
  }
  authView(`<form id="auth-form" class="card stack" novalidate>
      <div><h2>Create the owner account</h2><p class="small muted" style="margin-top:4px">This happens once. Enter the setup code you saved in Cloudflare, then choose your sign-in details. You'll be the admin and can add other people afterwards.</p></div>
      ${field('Setup code', 'code', 'type="password" autocomplete="off" required')}
      ${field('Your name', 'fullname', 'autocomplete="name" required')}
      ${field('Username', 'username', `autocomplete="username" ${NO_AUTOCORRECT} required`)}
      ${field('Password', 'password', 'type="password" autocomplete="new-password" required')}
      ${field('Repeat password', 'password2', 'type="password" autocomplete="new-password" required')}
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary lg block" type="submit">Create account</button>
    </form>`);
  authForm(async f => {
    if (f.password.value !== f.password2.value) throw new Error("The passwords don't match");
    const r = await api('POST', '/api/auth/setup', { code: f.code.value, name: f.fullname.value, username: f.username.value, password: f.password.value });
    await signedIn(r.user);
  });
}
/** After signing in with a temporary password. `current` is pre-filled when we just typed it. */
function showPasswordScreen(current = '') {
  authView(`<form id="auth-form" class="card stack" novalidate>
      <div><h2>Choose your password</h2><p class="small muted" style="margin-top:4px">Hi ${esc(S.auth?.name || '')}. You signed in with a temporary password; pick your own to continue.</p></div>
      ${current ? '' : field('Temporary password', 'current', 'type="password" autocomplete="current-password" required')}
      ${field('New password', 'next', 'type="password" autocomplete="new-password" required')}
      ${field('Repeat new password', 'next2', 'type="password" autocomplete="new-password" required')}
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary lg block" type="submit">Save password</button>
      <button class="btn ghost block" type="button" data-action="sign-out">Sign out</button>
    </form>`);
  authForm(async f => {
    if (f.next.value !== f.next2.value) throw new Error("The new passwords don't match");
    const r = await api('POST', '/api/auth/password', { current: current || f.current.value, next: f.next.value });
    await signedIn(r.user);
  });
}
function showProblem(message) {
  authView(`<div class="card"><h2>Can't reach your account</h2><p style="margin-top:8px">${esc(message)}</p>
    <button class="btn block" style="margin-top:14px" data-action="reload">Try again</button></div>`);
}

async function signedIn(user, { password } = {}) {
  const owner = await metaGet('owner');
  if (owner != null && owner !== user.id) {
    // This phone still holds another account's data (their session ended without signing out).
    const pending = await db.count('outbox');
    const ok = await confirmSheet('Switch account on this phone?',
      `This phone holds another account's data${pending ? `, including ${plural(pending, 'change')} that never reached the cloud` : ''}. Signing in as ${esc(user.name)} removes it from this phone.`,
      'Continue', 'danger');
    if (!ok) { await api('POST', '/api/auth/logout').catch(() => {}); return showLogin(); }
    await db.wipe();
    resetState();
  }
  S.auth = user;
  await metaSet('auth', user);
  if (user.mustChange) return showPasswordScreen(password);
  await enterApp();
}
let appStarted = false;
async function enterApp() {
  view.innerHTML = '<div class="empty" style="padding-top:35vh">Loading your data…</div>';
  try { await libraryReady; } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="empty" style="padding-top:30vh">Couldn't load the exercise library.<br>Open the app once with an internet connection so it can save itself for offline use.
      <br><br><button class="btn" data-action="reload">Try again</button></div>`;
    return;
  }
  if ((await metaGet('owner')) == null) await adoptLocalData();
  await metaSet('owner', S.auth.id);
  await loadUserData();
  S.locked = false;
  // First sync on this phone: wait briefly so your own days and history appear, not the defaults.
  if (!(await metaGet('cursor'))) await Promise.race([syncNow(), new Promise(r => setTimeout(r, 6000))]);
  SYNC.last = SYNC.last || (await metaGet('lastSync')) || 0;
  if (S.locked) return; // sync found the session had ended
  if (S.active) keepAwake(true);
  if (!appStarted) { appStarted = true; addEventListener('hashchange', render); }
  render();
  syncNow();
}
/** First sign-in on a phone that already has workouts from before accounts existed. */
async function adoptLocalData() {
  const [sessions, bw, custom, templates, settings] = await Promise.all(['sessions', 'bodyweight', 'custom', 'templates', 'settings'].map(n => db.all(n)));
  if (!sessions.length && !bw.length && !custom.length && !templates.length && !settings.length) return;
  const done = sessions.filter(s => s.end).length;
  const what = [done && plural(done, 'workout'), bw.length && plural(bw.length, 'body-weight entry', 'body-weight entries'), custom.length && plural(custom.length, 'custom exercise')]
    .filter(Boolean).join(', ') || 'your workout days and settings';
  const choice = await ask({
    title: 'Data already on this phone',
    msg: `This phone has ${esc(what)} from before you signed in. Add it to <b>${esc(S.auth.name)}</b>'s account?`,
    buttons: [{ label: 'Add it to my account', value: 'add', cls: 'primary' }, { label: 'Delete it from this phone', value: 'drop', cls: 'danger' }],
  });
  if (choice === 'drop') {
    const tx = (await idb()).transaction(Object.keys(SYNCED), 'readwrite');
    for (const n of Object.keys(SYNCED)) tx.objectStore(n).clear();
    await txDone(tx);
    return;
  }
  // Queue everything for upload, dated by when it happened, so any copy already in the cloud only loses to newer data.
  const op = (store, value, updatedAt) => ({ store, value, updatedAt });
  await db.write([
    ...sessions.map(s => op('sessions', s, s.end || s.start)),
    ...bw.map(e => op('bodyweight', e, parseYmd(e.date))),
    ...custom.map(e => op('custom', e, e.created || 2)),
    ...templates.map(t => op('templates', t, 2)),
    ...settings.map(s => op('settings', s, 2)),
  ]);
}
function resetState() {
  Object.assign(S, { custom: [], templates: [], sessions: [], bw: [], settings: { ...DEFAULT_SETTINGS }, active: null });
  indexExercises();
  S.rev++;
  Object.assign(SYNC, { pending: 0, last: 0, error: '' });
  navStack = [];
  curHash = null;
  history.replaceState(null, '', '#/');
}
function sessionEnded() {
  if (S.locked) return;
  showLogin({ message: 'You were signed out. Sign in again; nothing on this phone is lost.' });
}
async function signOut() {
  await Promise.resolve(flushSaves.flush());
  if (!S.locked) await syncNow();
  const pending = await db.count('outbox');
  if (pending && !await confirmSheet('Changes not uploaded yet',
    `${plural(pending, 'change')} haven't reached the cloud yet. If you sign out now they'll be lost.`, 'Sign out anyway', 'danger')) return;
  try { await api('POST', '/api/auth/logout'); }
  catch (e) { if (e.offline) { toast('Connect to the internet to sign out'); return; } }
  stopRest();
  keepAwake(false);
  await db.wipe();
  S.auth = null;
  resetState();
  showLogin({ message: "You're signed out." });
}
GA['sign-out'] = () => signOut();

// ---- account: change password, people (admin)
function passwordSheet() {
  const el = openSheet(`<h2>Change password</h2>
    <form id="pw-form" class="stack" novalidate style="margin-top:10px">
      ${field('Current password', 'current', 'type="password" autocomplete="current-password" required')}
      ${field('New password', 'next', 'type="password" autocomplete="new-password" required')}
      ${field('Repeat new password', 'next2', 'type="password" autocomplete="new-password" required')}
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary lg block" type="submit">Save password</button>
    </form>`);
  const form = $('#pw-form', el), err = $('.form-error', form);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    err.hidden = true;
    const f = form.elements;
    try {
      if (f.next.value !== f.next2.value) throw new Error("The new passwords don't match");
      await api('POST', '/api/auth/password', { current: f.current.value, next: f.next.value });
      await closeSheet();
      toast('Password changed. Your other devices were signed out.');
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  });
}
GA['change-pw'] = () => passwordSheet();

function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789', a = new Uint8Array(12);
  crypto.getRandomValues(a);
  const s = [...a].map(n => abc[n % abc.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
/** Fill an open sheet with the sign-in details to send someone. */
function showLoginDetails(u, password) {
  const text = `Gym Tracker: ${location.origin}\nUsername: ${u.username}\nTemporary password: ${password}\nYou'll choose your own password after signing in.`;
  sheet.el.innerHTML = `<div class="grab"></div><h2>${esc(u.name)} can sign in now</h2>
    <p class="msg">Send them these details. They'll pick their own password after signing in.</p>
    <div class="login-details"><div class="small muted">Website</div><b>${esc(location.origin)}</b>
      <div class="small muted">Username</div><b>${esc(u.username)}</b>
      <div class="small muted">Temporary password</div><b class="mono">${esc(password)}</b></div>
    <div class="btn-row" style="margin-top:14px"><button class="btn" data-action="copy-login">${icon('copy')}Copy</button>
      ${navigator.share ? `<button class="btn" data-action="share-login">${icon('share')}Share</button>` : ''}</div>
    <button class="btn primary lg block" style="margin-top:10px" data-action="close">Done</button>`;
  Object.assign(sheet.actions, {
    'copy-login': async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast("Couldn't copy. Select the text instead."); } },
    'share-login': () => navigator.share({ text }).catch(() => {}),
    close: () => closeSheet(),
  });
}
function addUserSheet(reload) {
  const el = openSheet(`<h2>Add a person</h2><p class="msg">They sign in with this username and temporary password, then choose their own password. Their log is private to them.</p>
    <form id="nu-form" class="stack" novalidate>
      ${field('Name', 'fullname', 'autocomplete="off" required')}
      ${field('Username', 'username', `autocomplete="off" ${NO_AUTOCORRECT} required placeholder="e.g. ali"`)}
      <label class="field"><span>Temporary password</span><div class="row"><input class="input mono" name="password" autocomplete="off" required value="${tempPassword()}" style="flex:1">
        <button type="button" class="icon-btn tinted" data-action="regen" aria-label="Make a new temporary password">${icon('refresh')}</button></div></label>
      <label class="switch-row"><div><b>Admin</b><div class="small muted">Can add, change and remove people</div></div>
        <span class="switch"><input type="checkbox" name="admin"><span></span></span></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary lg block" type="submit">Create account</button>
    </form>`, { regen: () => { $('[name=password]', el).value = tempPassword(); } });
  const form = $('#nu-form', el), err = $('.form-error', form);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    err.hidden = true;
    const f = form.elements;
    try {
      const { user } = await api('POST', '/api/admin/users', { name: f.fullname.value, username: f.username.value, password: f.password.value, isAdmin: f.admin.checked });
      showLoginDetails(user, f.password.value);
      reload();
    } catch (e) { err.textContent = e.offline ? 'Connect to the internet to add people.' : e.message; err.hidden = false; }
  });
}
function userSheet(u, reload) {
  if (!u) return;
  const self = u.id === S.auth.id;
  const patch = async body => {
    try { await api('PATCH', `/api/admin/users/${u.id}`, body); reload(); return true; }
    catch (e) { toast(e.message); return false; }
  };
  const opts = self ? ['<p class="msg">This is you. Change your password from Settings.</p>'] : [
    `<button class="opt" data-action="u-reset">${icon('key')}<span class="grow">Reset password<small>Gives them a new temporary password</small></span></button>`,
    `<button class="opt" data-action="u-signout">${icon('logout')}<span class="grow">Sign out of every device</span></button>`,
    `<button class="opt" data-action="u-toggle">${icon(u.disabled ? 'check' : 'x')}<span class="grow">${u.disabled ? 'Turn account back on' : 'Turn account off'}<small>${u.disabled ? 'They can sign in again' : 'Blocks sign-in and signs them out; their data is kept'}</small></span></button>`,
    `<button class="opt" data-action="u-admin">${icon('user')}<span class="grow">${u.isAdmin ? 'Remove admin rights' : 'Make admin'}</span></button>`,
    `<button class="opt danger-opt" data-action="u-delete">${icon('trash')}<span class="grow">Delete account<small>Removes them and all their data for good</small></span></button>`,
  ];
  openSheet(`<h2>${esc(u.name)}</h2><p class="msg">@${esc(u.username)}${u.mustChange ? " · hasn't picked a password yet" : ''}</p><div class="opts">${opts.join('')}</div>`, {
    'u-reset': async () => { const pw = tempPassword(); if (await patch({ password: pw })) showLoginDetails(u, pw); },
    'u-signout': async () => { if (await patch({ signOut: true })) { await closeSheet(); toast(`${u.name} was signed out everywhere`); } },
    'u-toggle': async () => { if (await patch({ disabled: !u.disabled })) { await closeSheet(); toast(u.disabled ? `${u.name} can sign in again` : `${u.name}'s account is off`); } },
    'u-admin': async () => { if (await patch({ isAdmin: !u.isAdmin })) { await closeSheet(); toast(u.isAdmin ? `${u.name} is no longer an admin` : `${u.name} is now an admin`); } },
    'u-delete': async () => {
      await closeSheet();
      if (!await confirmSheet(`Delete ${u.name}?`, `This removes @${esc(u.username)} and all of their workouts, body weight and custom exercises. It can't be undone.`, 'Delete account', 'danger')) return;
      try { await api('DELETE', `/api/admin/users/${u.id}`); toast(`${u.name} was deleted`); reload(); }
      catch (e) { toast(e.message); }
    },
  });
}
const avatar = name => `<span class="avatar" aria-hidden="true">${esc((name || '?').trim()[0]?.toUpperCase() || '?')}</span>`;
route(/^\/admin$/, () => {
  if (!S.auth?.isAdmin) return replaceRoute('#/settings');
  view.innerHTML = topbar('People', { back: '#/settings', right: `<button class="btn sm primary" data-action="add-user">${icon('plus')}Add</button>` }) + `
    <p class="hint" style="margin:0 4px 12px">Only people listed here can open this app. Each has a private log.</p>
    <section class="card" style="padding:4px 16px" id="users"><div class="empty">Loading…</div></section>`;
  const token = renderToken;
  let users = [];
  const load = async () => {
    try {
      users = (await api('GET', '/api/admin/users')).users;
      if (token !== renderToken) return;
      $('#users').innerHTML = `<ul class="list">${users.map(u => `<li><button class="sess-row user-row" data-action="user" data-id="${u.id}">${avatar(u.name)}
        <div class="grow"><b>${esc(u.name)}${u.id === S.auth.id ? ' (you)' : ''}</b>
          <span class="small">@${esc(u.username)} · ${plural(u.workouts, 'workout')} · ${u.lastLogin ? `last sign-in ${relDay(u.lastLogin)}` : 'never signed in'}</span></div>
        ${u.isAdmin ? '<span class="tag accent">Admin</span>' : ''}${u.disabled ? '<span class="tag">Off</span>' : ''}${icon('next')}</button></li>`).join('')}</ul>`;
    } catch (e) {
      if (token === renderToken) $('#users').innerHTML = `<div class="empty">${esc(e.offline ? 'Connect to the internet to manage people.' : e.message)}</div>`;
    }
  };
  load();
  A['add-user'] = () => addUserSheet(load);
  A.user = el => userSheet(users.find(u => u.id === +el.dataset.id), load);
});

// ============================================================ 10. boot
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  let updating = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) location.reload(); });
  navigator.serviceWorker.register('sw.js').then(reg => {
    const offer = w => toast('A new version is ready', {
      action: 'Update', ms: 30000,
      fn: () => { updating = true; flushSaves.flush(); w.postMessage({ type: 'skip-waiting' }); },
    });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(err => console.warn('Service worker registration failed', err));
}
// The exercise library downloads (or comes from the offline cache) while the phone's own data
// is read; only the app itself waits for it, sign-in screens don't. boot.js started the request.
const libraryReady = Promise.resolve(window.EXERCISES).then(res => res || fetch('data/exercises.json')).then(res => {
  if (!res.ok) throw new Error(`exercises.json: HTTP ${res.status}`);
  return res.json();
}).then(list => { S.base = list; indexExercises(); });
libraryReady.catch(() => {}); // reported by enterApp
async function boot() {
  // Registered after the library so the first visit doesn't download it twice at once.
  libraryReady.catch(() => {}).then(registerSW);
  S.auth = await metaGet('auth');
  if (S.auth) return S.auth.mustChange ? showPasswordScreen() : enterApp(); // works offline
  // Not signed in on this phone yet: the server may still recognise the cookie.
  try {
    const me = await api('GET', '/api/auth/me');
    await signedIn(me.user);
  } catch (e) {
    if (e.status === 401) return e.data?.needsSetup ? showSetup(e.data.setupConfigured) : showLogin();
    showProblem(e.offline ? 'Connect to the internet once to sign in. After that the app works offline.' : e.message);
  }
}
boot();
