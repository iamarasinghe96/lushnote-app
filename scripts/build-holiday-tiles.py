#!/usr/bin/env python3
"""Turn a source illustration into the header's tile.

    python3 scripts/build-holiday-tiles.py incoming/christmas.png christmas
    python3 scripts/build-holiday-tiles.py incoming/christmas.png christmas --zoom 2.5

Takes whatever an image generator produced — PNG, JPEG or SVG, any size, any
aspect ratio — and emits `public/holiday/<key>.webp` at the size the header
wants.

SCALE IS THE THING THAT GOES WRONG. The header is 60 CSS px tall and the tile
is drawn at `auto 100%`, so the tile's whole height maps to those 60 px — and
because the half-tile is square, a square source lands entirely inside a 60x60
box. Nothing is cropped; everything is shrunk. A source with five rows of
motifs therefore renders each one about 12 px tall, which behind the scrim
reads as noise. Aim for TWO rows in the source, so a motif lands near 30 px.

--zoom N rescues a source that is too busy: it keeps the centre 1/N of the
image and throws the rest away, so the motifs that survive are N times larger
in the bar. 2 to 3 is the useful range for a generated 1024x1024 pattern.

The other important part is MIRRORING. A tile only repeats invisibly if its
left and right edges match, and image generators almost never produce that.
Mirroring guarantees it: the tile becomes [slice | flipped slice], so every
junction — inside the tile and between tiles — meets an identical column of
pixels. The cost is a symmetric look, which at 60px tall in a busy pattern
reads as deliberate rather than as a mistake. A hard seam never does.

Pass --no-mirror when the source is genuinely seamless already (some generators
do produce true repeating patterns when asked).
"""
import argparse
import io
import sys
from pathlib import Path
from PIL import Image

# The bar is 60 CSS px tall; 240 covers a 4x display with room to spare. The
# tile renders at `auto 100%`, so a 2:1 tile shows as 120x60 CSS px and repeats
# roughly three times across a phone — the density asked for.
TILE_H = 240
HALF_W = 240          # mirrored → 480 wide
QUALITY = 82
BUDGET_KB = 30

OUT = Path(__file__).resolve().parent.parent / 'public' / 'holiday'


def load(src_path: str) -> Image.Image:
    if src_path.lower().endswith('.svg'):
        import cairosvg   # only needed for SVG sources
        png = cairosvg.svg2png(url=src_path, output_height=TILE_H * 3)
        img = Image.open(io.BytesIO(png))
        # An SVG may be transparent where the background was meant to be. Flatten
        # onto black rather than leaving alpha, which WebP would keep and the
        # header would show the page through.
        flat = Image.new('RGB', img.size, (0, 0, 0))
        flat.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
        return flat
    return Image.open(src_path).convert('RGB')


def build(src_path: str, key: str, mirror: bool = True, zoom: float = 1.0) -> None:
    src = load(src_path)

    if zoom > 1:
        w = max(1, round(src.width / zoom))
        h = max(1, round(src.height / zoom))
        src = src.crop(((src.width - w) // 2, (src.height - h) // 2,
                        (src.width - w) // 2 + w, (src.height - h) // 2 + h))

    # Scale so the height matches, then take the middle band — the centre of a
    # generated image is where the composition is, and the edges are where the
    # generator gets vague.
    scale = TILE_H / src.height
    resized = src.resize((max(1, round(src.width * scale)), TILE_H), Image.LANCZOS)
    if resized.width < HALF_W:
        resized = resized.resize((HALF_W, TILE_H), Image.LANCZOS)
    left = (resized.width - HALF_W) // 2
    slice_ = resized.crop((left, 0, left + HALF_W, TILE_H))

    if mirror:
        tile = Image.new('RGB', (HALF_W * 2, TILE_H))
        tile.paste(slice_, (0, 0))
        tile.paste(slice_.transpose(Image.FLIP_LEFT_RIGHT), (HALF_W, 0))
    else:
        tile = slice_

    # No colour grading. Anything applied here is burnt into the saved file and
    # can never be undone; the header's scrim does the darkening instead, and
    # that stays adjustable.

    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / f'{key}.webp'
    quality = QUALITY
    while True:
        tile.save(dest, 'WEBP', quality=quality, method=6)
        kb = dest.stat().st_size / 1024
        if kb <= BUDGET_KB or quality <= 45:
            break
        quality -= 8
    print(f'{dest.relative_to(OUT.parent.parent)}  {tile.width}x{tile.height}  {kb:.1f} KB  q{quality}'
          f'{"" if mirror else "  (not mirrored)"}{"" if zoom == 1 else f"  zoom {zoom}x"}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument('source')
    ap.add_argument('key')
    ap.add_argument('--no-mirror', action='store_true')
    ap.add_argument('--zoom', type=float, default=1.0)
    if len(sys.argv) < 3:
        print(__doc__)
        raise SystemExit(1)
    a = ap.parse_args()
    build(a.source, a.key, mirror=not a.no_mirror, zoom=a.zoom)
