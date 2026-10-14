"""Draw the dumbbell app icons into public/icons/.   python tools/make_icons.py"""
import os

from PIL import Image, ImageDraw

S = 1024  # drawing size; everything is downscaled from here for clean edges
TOP, BOTTOM = (255, 128, 56), (232, 82, 12)
INK = (255, 255, 255, 255)


def gradient():
    g = Image.new('RGB', (1, S))
    for y in range(S):
        t = y / (S - 1)
        g.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)))
    return g.resize((S, S)).convert('RGBA')


def dumbbell(scale):
    """White dumbbell, centred, tilted. scale = overall length as a fraction of S."""
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = S / 2
    u = S * scale / 0.74  # unit so the full mark is `scale` wide

    def box(cx, w, h, r):
        d.rounded_rectangle([c + cx * u - w * u / 2, c - h * u / 2, c + cx * u + w * u / 2, c + h * u / 2],
                            radius=r * u, fill=INK)

    box(0, 0.50, 0.075, 0.03)          # handle
    for side in (-1, 1):
        box(side * 0.215, 0.095, 0.44, 0.035)   # inner plate
        box(side * 0.31, 0.075, 0.31, 0.03)     # outer plate
        box(side * 0.36, 0.05, 0.10, 0.02)      # end cap
    return layer.rotate(35, resample=Image.BICUBIC, center=(c, c))


def rounded_mask(radius_frac):
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=S * radius_frac, fill=255)
    return m


def save(img, out, size):
    img.resize((size, size), Image.LANCZOS).save(out, optimize=True)
    print(out, os.path.getsize(out), 'bytes')


def main():
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'icons')
    os.makedirs(root, exist_ok=True)

    # "any" icon: rounded square with transparent corners, mark fills most of it.
    plain = gradient()
    plain.alpha_composite(dumbbell(0.80))
    plain.putalpha(rounded_mask(0.22))
    for size in (192, 512):
        save(plain, os.path.join(root, f'icon-{size}.png'), size)
    save(plain, os.path.join(root, 'favicon-32.png'), 32)

    # maskable: full bleed, mark kept inside the 80% safe circle.
    mask = gradient()
    mask.alpha_composite(dumbbell(0.62))
    save(mask, os.path.join(root, 'maskable-512.png'), 512)
    save(mask, os.path.join(root, 'apple-touch-icon.png'), 180)


if __name__ == '__main__':
    main()
