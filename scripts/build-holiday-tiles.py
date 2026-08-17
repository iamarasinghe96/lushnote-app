#!/usr/bin/env python3
"""Turn a source illustration into the header's tile.

    python3 scripts/build-holiday-tiles.py incoming/christmas.png christmas

Takes whatever an image generator produced — any size, any aspect ratio — and
emits `public/holiday/<key>.webp` at the exact size the header wants.

The important part is MIRRORING. A tile only repeats invisibly if its left and
right edges match, and image generators almost never produce that. Mirroring
guarantees it: the tile becomes [slice | flipped slice], so every junction —
inside the tile and between tiles — meets an identical column of pixels. The
cost is a symmetric look, which at 60px tall in a busy pattern reads as
deliberate rather than as a mistake. A hard seam never does.

Pass --no-mirror when the source is genuinely seamless already (some generators
do produce true repeating patterns when asked).
"""
import sys
from pathlib import Path
from PIL import Image, ImageEnhance

# The bar is 60 CSS px tall; 240 covers a 4x display with room to spare. The
# tile renders at `auto 100%`, so a 2:1 tile shows as 120x60 CSS px and repeats
# roughly three times across a phone — the density asked for.
TILE_H = 240
HALF_W = 240          # mirrored → 480 wide
QUALITY = 82
BUDGET_KB = 30

OUT = Path(__file__).resolve().parent.parent / 'public' / 'holiday'


def build(src_path: str, key: str, mirror: bool = True) -> None:
    src = Image.open(src_path).convert('RGB')

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

    # Take a little contrast and brightness out. White header text sits on top
    # of this, and a calmer tile means the scrim can stay light enough to keep
    # the artwork visible.
    tile = ImageEnhance.Contrast(tile).enhance(0.92)
    tile = ImageEnhance.Brightness(tile).enhance(0.88)

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
          f'{"" if mirror else "  (not mirrored)"}')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--no-mirror']
    if len(args) != 2:
        print(__doc__)
        raise SystemExit(1)
    build(args[0], args[1], mirror='--no-mirror' not in sys.argv)
