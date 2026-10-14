# Gym Tracker

An installable, offline-first gym log for Android (Chrome / Samsung Internet), hosted on
Cloudflare Pages at **https://gym.zaidallaham.com**. Plain HTML/CSS/JS, no framework and no
build step. All data stays on the phone in IndexedDB.

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
- **Backup:** export everything to a JSON file (or share it straight to Drive) and import it
  back.

## Files

```
index.html            app shell
app.js                the whole app (router, IndexedDB wrapper, views, charts, rest timer)
styles.css            mobile-first styles, light + dark tokens
sw.js                 service worker: cache-first shell, images cached as viewed
manifest.json         PWA manifest (standalone, portrait, maskable icon, shortcuts, screenshots)
_headers              Cloudflare Pages headers (sw.js never cached, long cache for images)
data/exercises.json   free-exercise-db, minified (see data/SOURCE.md)
img/exercises/<id>/   0.webp (start), 1.webp (end), t.webp (thumbnail)
icons/                app icons + install-dialog screenshots
tools/                scripts that generated data/, img/ and icons/ (not used at runtime)
```

## Run it locally

Any static server works; service workers are allowed on `localhost`.

```bash
python -m http.server 8787
```

Then open http://localhost:8787. Chrome DevTools → Application → Manifest shows it as
installable, and Application → Service workers shows `sw.js` activated.

## Deploy to Cloudflare Pages

**1. Push the repo to GitHub.** Create an empty repository on github.com, for example
`gym-tracker` (private is fine), without a README. Then, in this folder:

```bash
git remote add origin https://github.com/<your-username>/gym-tracker.git
```

```bash
git push -u origin main
```

**2. Create the Pages project.** In the Cloudflare dashboard go to **Workers & Pages →
Create → Pages → Connect to Git**. Authorise GitHub if asked, pick the `gym-tracker` repo,
then set:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | `None` |
| Build command | *(leave empty)* |
| Build output directory | `/` (the repository root) |

Click **Save and Deploy**. After a minute it's live at `https://<project>.pages.dev`.

**3. Add the custom domain.** In the project go to **Custom domains → Set up a custom
domain**, enter `gym.zaidallaham.com` and click **Continue → Activate domain**. Because the
zone is already on Cloudflare, the `CNAME gym → <project>.pages.dev` record is created for
you. Wait until the domain shows **Active** (usually a few minutes while the certificate is
issued).

**4. Shipping updates.** Make your change, **bump `VERSION` in `sw.js`** (for example
`v1.0.0` → `v1.0.1`), then commit and push to `main`. Cloudflare redeploys automatically.
Next time you open the app it shows *"A new version is ready · Update"*; tap it. If you
forget to bump `VERSION`, phones keep the old cached files.
Only bump `IMAGES` in `sw.js` (and `IMG_CACHE` in `app.js`) if the exercise photos change.

### Size check (Cloudflare Pages limits: 20,000 files, 25 MiB per file)

- 2,641 files, 33.2 MB in total
- Largest file: `data/exercises.json`, 791 KB. The largest image is 47 KB.
- The original dataset photos were 102 MB of JPEGs. They're resized to 640 px WebP plus
  200 px thumbnails.

## Install on the Samsung phone

1. Open **https://gym.zaidallaham.com** in **Chrome**.
2. Tap **Install app**, either the card on the Train screen or in Settings. You can also use
   Chrome's menu **⋮ → Install app** (it may say *Add to Home screen → Install*).
3. In **Samsung Internet** instead: tap the install icon in the address bar, or **≡ menu →
   Add page to → Home screen**.
4. Open **Gym** from the home screen. It runs full screen and works without signal.
5. On Wi-Fi, go to **Settings → Download all images for offline** (about 32 MB) so every
   demo plays at the gym. Otherwise images are saved as you view them.
6. Long-press the app icon for shortcuts that start a day directly.

Use one browser: Chrome and Samsung Internet keep separate storage, so data logged in one
isn't visible in the other.

## Backups

Everything lives only on the phone. If you clear site data or uninstall, it's gone. Go to
**Settings → Share backup to Drive…** (or **Export backup file**, which saves to Downloads)
every so often. **Import backup…** replaces the data on the phone with the file's contents
after you confirm.

## Good to know

- **Rest timer:** keep the app open. *Keep screen on during a workout* (on by default) holds
  a wake lock so the vibration and beep fire. A web app can't alert you from the background.
- **Estimated 1RM** = kg × (1 + reps ÷ 30) on the best working set. Warm-ups never count
  towards volume, records or charts.
- **Weekly sets** count 1 for each muscle an exercise mainly trains and ½ for muscles it also
  works.
- **Day colours** (blue, magenta, yellow, green) were checked as a set for colour-blind
  separation. Every coloured dot also carries the day number.

## Exercise data and credits

Exercises, photos and instructions come from
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) by yuhonas (building on
[exercises.json](https://github.com/wrkout/exercises.json)). It's released into the public
domain under the [Unlicense](https://unlicense.org); a copy is in
`data/free-exercise-db-LICENSE.md` and the snapshot details are in `data/SOURCE.md`. The app
credits it on **Settings → About**.

To refresh the data from a newer snapshot:

```bash
git clone --depth 1 https://github.com/yuhonas/free-exercise-db.git ../free-exercise-db
```

```bash
python tools/build_exercises.py ../free-exercise-db --force
```

Then bump `VERSION` in `sw.js`. If photos changed, also bump the image cache name in `sw.js`
and `app.js`. Icons are drawn by `python tools/make_icons.py` (needs Pillow).
