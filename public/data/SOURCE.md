# Exercise data source

`exercises.json` and every image under `img/exercises/` come from
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) by yuhonas,
which is released into the public domain under the Unlicense
(see `free-exercise-db-LICENSE.md`).

- Snapshot: commit `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5` (2026-09-27)
- 876 exercises; 873 have start/end photos
- Converted with `tools/build_exercises.py`: JSON minified, missing spaces after
  full stops restored, photos resized to 640 px WebP (q70) with 200 px thumbnails.
