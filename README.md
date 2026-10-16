# Gym Tracker

An installable, offline-first gym log for Android (Chrome / Samsung Internet), hosted on
Cloudflare Pages at **https://gym.zaidallaham.com**. Plain HTML/CSS/JS with no framework and
no build step. Only people you add can sign in. Each person's log is private and stored in
Cloudflare D1, with a full copy on the phone so it keeps working at the gym without signal.

- **876 exercises** with start/end photos that crossfade like a GIF (play/pause), numbered
  instructions, a front/back muscle map (primary strong, secondary light), and equipment,
  difficulty and type chips. Search, with filters by muscle group, equipment and type. Add
  your own exercises with an optional photo.
- **4-day split** preloaded as templates (Chest + Triceps, Back + Biceps, Shoulders, Legs,
  7 exercises each). Edit names, sets × reps and rest; drag to reorder; add from any
  exercise page or straight from the library.
- **Logging:** one tap to start a day. Sets are reps × kg, with warm-up sets, last session's
  numbers pre-filled, the demo one tap away, and a rest timer per exercise that vibrates and
  beeps. Finishing shows a summary with duration, volume and new records.
- **Progress:** per-exercise charts of estimated 1RM (Epley), top set and volume, plus PR
  badges. History calendar coloured by day (tap to view or edit), a weekly muscle-group view
  with body heatmap and 8-week grid, and a body-weight log with a 7-day trend.
- **Accounts:** username + password. The owner is the admin and adds, resets, turns off or
  deletes people from **Settings → People who can use the app**.
- **Cloud sync:** every change is saved on the phone first, then uploaded to D1 within a few
  seconds when online. A new phone gets everything back after signing in.
- **Backup:** you can still export everything to a JSON file (or share it to Drive) and
  import it back.

## Files

```
public/                     the website (Pages "build output directory")
  index.html                app shell
  boot.js                   runs before first paint: saved theme, desktop-site zoom, starts loading exercises.json
  app.js                    the whole app: router, IndexedDB + outbox, sync, views, charts, timer
  styles.css                mobile-first styles, light + dark tokens
  sw.js                     service worker: cache-first shell, images cached as viewed; /api is never cached
  manifest.json             PWA manifest (standalone, portrait, maskable icon, shortcuts, screenshots)
  _headers                  Cloudflare Pages headers, including the Content-Security-Policy
  data/exercises.json       free-exercise-db, minified (see data/SOURCE.md)
  img/exercises/<id>/       0.webp (start), 1.webp (end), t.webp (thumbnail)
  icons/                    app icons + install-dialog screenshots
functions/api/              Pages Functions (the API), run by Cloudflare at /api/*
  _middleware.js            database check, schema, cross-site guard, session lookup, admin rule
  _schema.js                D1 tables + readable views, created automatically on first use
  _util.js                  password hashing (PBKDF2-SHA256), sessions, cookies, rate limits
  auth/                     me · login · logout · setup (first admin) · password
  sync.js                   one round trip: upload queued changes, download newer ones
  admin/_middleware.js      admins only, for every admin route however its URL is spelled
  admin/users/              list/create people · change/turn off/delete one person
tools/                      scripts that generated public/data, public/img and public/icons
```

## How accounts and sync work

- **Sign-in:** passwords are hashed with PBKDF2-SHA256 (100,000 iterations, random salt).
  The session lives in a `__Host-` cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, so no other
  subdomain can set or read it) for 180 days, renewed while you use the app. Requests from
  other sites are refused. After 8 wrong passwords, sign-in pauses for 15 minutes; the same
  limit applies to the current password when changing it.
- **Admin rules:** Cloudflare matches routes without regard to letter case, so the admin check
  lives in `functions/api/admin/_middleware.js`, which runs for every admin route whatever the
  URL looks like. Keep any new admin-only route inside that folder.
- **Browser security:** `public/_headers` sends a Content-Security-Policy that allows only this
  site's own script files, no inline scripts, and no framing. If you ever add an inline
  `<script>` or load something from another site, it will be blocked until you update that
  policy. Backup files are checked field by field before they are imported.
- **People:** someone you add gets a temporary password and must choose their own the first
  time they sign in. Turning an account off or resetting its password signs that person out
  everywhere.
- **Offline-first sync:** the app reads and writes IndexedDB on the phone. Every change is
  also queued in an outbox, uploaded about 2 seconds later, and again when the app goes to
  the background or comes back online. Other devices' changes are downloaded on open, every
  minute while the app is visible, and with each upload. If two devices edit the same record,
  the newer edit wins. The workout open on a phone stays that phone's until it is finished.
- **Signing out** (needs a connection) uploads anything pending, ends the session and wipes
  the phone's copy. Your data stays in your account.

### Your data in the D1 console

Everything lives in one table, `records` (one JSON row per workout, day, weigh-in, custom
exercise or settings object, per user). Readable views are created alongside it. In
**Cloudflare → Storage & databases → D1 → gym-tracker → Console**:

```sql
SELECT * FROM workouts WHERE username = 'zaid' ORDER BY started_utc DESC;
SELECT day, exercise, set_number, kg, reps, warmup FROM workout_sets WHERE username = 'zaid';
SELECT date, kg FROM body_weight WHERE username = 'zaid' ORDER BY date;
SELECT id, username, name, is_admin, disabled, datetime(last_login / 1000, 'unixepoch') FROM users;
```

## One-time Cloudflare setup

The Pages project already exists (`gym-tracker`, connected to this repo, custom domain
`gym.zaidallaham.com`). Accounts need four settings in the dashboard. Bindings, secrets and
build settings take effect with the next deployment.

1. **Create the database:** **Storage & databases → D1 SQL database → Create**, and name it
   `gym-tracker`. You don't need to run any SQL; the tables create themselves.
2. **Connect it:** **Workers & Pages → gym-tracker → Settings → Bindings → Add → D1
   database**. Set the variable name to `DB` and pick the `gym-tracker` database.
3. **Setup code:** **Settings → Variables and Secrets → Add**. Choose type **Secret**, name
   `SETUP_CODE`, and as the value any phrase you'll remember for a minute. It's only used
   once, to create the owner account.
4. **Build output directory:** **Settings → Build → Build configuration → Edit**. Set the
   build output directory to `public`; the build command stays empty.

Then deploy (push to `main`, or **Deployments → Retry deployment**). Open
https://gym.zaidallaham.com, enter the setup code, and choose your name, username and
password. If the phone already has workouts from before accounts, the app offers to add them
to your account. After that the setup page is closed for good, and you can delete
`SETUP_CODE` if you like.

## Run it locally

The front end alone works on any static server (service workers are allowed on `localhost`):

```bash
python -m http.server 8787 --directory public
```

Without the API the app stops at "Can't reach your account". To run everything, use
`wrangler pages dev public --d1 DB` on a machine where wrangler's local runtime is allowed;
it's blocked on this PC by Windows Application Control.

## Shipping updates

Make your change, **bump `VERSION` in `public/sw.js`** (for example `v1.1.0` → `v1.1.1`),
then commit and push to `main`. Cloudflare redeploys automatically. Next time you open the
app it shows *"A new version is ready · Update"*; tap it. If you forget to bump `VERSION`,
phones keep the old cached files. Only bump `IMAGES` in `sw.js` (and `IMG_CACHE` in
`app.js`) if the exercise photos change. Changes under `functions/` take effect as soon as
the deploy finishes.

### Size check (Cloudflare Pages limits: 20,000 files, 25 MiB per file)

- About 2,640 static files, 33 MB in total
- Largest file: `public/data/exercises.json`, 791 KB. The largest image is 47 KB.
- The original dataset photos were 102 MB of JPEGs. They're resized to 640 px WebP plus
  200 px thumbnails.

## Install on the Samsung phone

1. Open **https://gym.zaidallaham.com** in **Chrome** and sign in.
2. Tap **Install app**, either the card on the Train screen or in Settings. You can also use
   Chrome's menu **⋮ → Install app** (it may say *Add to Home screen → Install*).
3. In **Samsung Internet** instead: tap the install icon in the address bar, or **≡ menu →
   Add page to → Home screen**.
4. Open **Gym** from the home screen. It runs full screen and works without signal.
5. On Wi-Fi, go to **Settings → Download all images for offline** (about 32 MB) so every
   demo plays at the gym. Otherwise images are saved as you view them.
6. Long-press the app icon for shortcuts that start a day directly.

## Good to know

- **Rest timer:** keep the app open. *Keep screen on during a workout* (on by default) holds
  a wake lock so the vibration and beep fire. A web app can't alert you from the background.
- **Estimated 1RM** = kg × (1 + reps ÷ 30) on the best working set. Warm-ups never count
  towards volume, records or charts.
- **Weekly sets** count 1 for each muscle an exercise mainly trains and ½ for muscles it also
  works.
- **Day colours** (blue, magenta, yellow, green) were checked as a set for colour-blind
  separation. Every coloured dot also carries the day number.
- **Desktop-site mode** on a phone is detected, and the app zooms itself to fit.
- **What's public:** the app files and the public-domain exercise library can be fetched by
  anyone who knows the address. Everything personal goes through `/api`, which needs a
  signed-in session.

## Exercise data and credits

Exercises, photos and instructions come from
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) by yuhonas (building on
[exercises.json](https://github.com/wrkout/exercises.json)). It's released into the public
domain under the [Unlicense](https://unlicense.org); a copy is in
`public/data/free-exercise-db-LICENSE.md` and the snapshot details are in
`public/data/SOURCE.md`. The app credits it on **Settings → About**.

To refresh the data from a newer snapshot:

```bash
git clone --depth 1 https://github.com/yuhonas/free-exercise-db.git ../free-exercise-db
```

```bash
python tools/build_exercises.py ../free-exercise-db --force
```

Then bump `VERSION` in `public/sw.js`. If photos changed, also bump the image cache name in
`sw.js` and `app.js`. Icons are drawn by `python tools/make_icons.py` (needs Pillow).
