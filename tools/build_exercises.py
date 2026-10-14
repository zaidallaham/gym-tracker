"""Rebuild data/exercises.json and img/exercises/ from a free-exercise-db checkout.

    git clone --depth 1 https://github.com/yuhonas/free-exercise-db.git
    python tools/build_exercises.py path/to/free-exercise-db [--force]

Images are resized to fit 640 px (WebP q70) plus a 200 px thumbnail per exercise,
which takes the original ~100 MB of JPEGs down to roughly 30 MB.
"""
import json
import os
import re
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image, ImageOps

FULL, FULL_Q = 640, 70
THUMB, THUMB_Q = 200, 60


def fix_text(s):
    # The source often drops the space after a full stop ("torso.This will be").
    s = re.sub(r'(?<=[a-z0-9)])\.(?=[A-Z])', '. ', s.strip())
    return re.sub(r'\s+', ' ', s)


def convert(job):
    src, dst, size, quality, force = job
    if os.path.exists(dst) and not force:
        return os.path.getsize(dst)
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert('RGB')
        im.thumbnail((size, size), Image.LANCZOS)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        im.save(dst, 'WEBP', quality=quality, method=6)
    return os.path.getsize(dst)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    force = '--force' in sys.argv
    app = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data = json.load(open(os.path.join(src, 'dist', 'exercises.json'), encoding='utf-8'))

    out, jobs = [], []
    for d in sorted(data, key=lambda d: d['name'].lower()):
        rec = {'id': d['id'], 'name': d['name'].strip()}
        for k in ('force', 'level', 'mechanic', 'equipment', 'category'):
            if d.get(k):
                rec[k] = d[k]
        rec['primaryMuscles'] = d['primaryMuscles']
        rec['secondaryMuscles'] = d['secondaryMuscles']
        rec['instructions'] = [fix_text(s) for s in d['instructions'] if s.strip()]
        images = d['images'][:2]
        rec['img'] = len(images)
        base = os.path.join(app, 'img', 'exercises', d['id'])
        for i, p in enumerate(images):
            jobs.append((os.path.join(src, 'exercises', p), os.path.join(base, f'{i}.webp'), FULL, FULL_Q, force))
        if images:
            jobs.append((os.path.join(src, 'exercises', images[0]), os.path.join(base, 't.webp'), THUMB, THUMB_Q, force))
        out.append(rec)

    with ProcessPoolExecutor() as pool:
        sizes = list(pool.map(convert, jobs, chunksize=8))

    os.makedirs(os.path.join(app, 'data'), exist_ok=True)
    with open(os.path.join(app, 'data', 'exercises.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

    print(f'{len(out)} exercises, {len(jobs)} images, {sum(sizes) / 1024 / 1024:.1f} MB, '
          f'largest image {max(sizes) / 1024:.0f} KB')


if __name__ == '__main__':
    main()
