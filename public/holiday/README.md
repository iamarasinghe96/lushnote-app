# Header holiday tiles

One tile per theme. The header repeats it across its width
(`background-repeat: repeat-x`, `background-size: auto 100%`), so a small file
stays sharp at any screen width instead of one wide image being stretched.

| File | Theme |
|---|---|
| `christmas.webp` | 24–26 December |
| `australia-day.webp` | 26 January |
| `anzac-day.webp` | 25 April |
| `easter.webp` | Good Friday → Easter Monday |

## Adding one

Generate the artwork at **1024 × 1024** (any size works — this is just the size
every image generator supports), then:

    python3 scripts/build-holiday-tiles.py path/to/christmas.png christmas

That produces `christmas.webp` at **480 × 240**, under 30 KB, ready to commit.
Add `--no-mirror` only if the source is already a true seamless pattern.

## What the script does, and why

- **Mirrors the tile.** A repeat is only invisible when the left and right edges
  match, and image generators almost never produce that. The tile becomes
  `[slice | flipped slice]`, so every junction meets an identical column of
  pixels. The cost is a symmetric look, which at 60 px tall in a busy pattern
  reads as deliberate — a hard seam never does.
- **Sizes to 240 px tall.** The bar is 60 CSS px, so this stays sharp to 4×.
- **Calms contrast and brightness slightly.** White header text sits on top; a
  calmer tile lets the scrim stay light enough for the artwork to show through.
- **Compresses to a budget**, stepping quality down until it fits 30 KB.

## What to ask the generator for

> A seamless repeating pattern of [motifs] on a deep [colour] background, flat
> vector illustration, simple bold shapes, evenly spaced, no text, no borders

- **Dark or mid-tone background.** White text sits over it.
- **Few large motifs, not many small ones.** The tile is displayed 60 px tall —
  fine detail disappears.
- **No text, no logos, no focal subject.** It is wallpaper behind a name.
- Flat illustration beats photography at this size.

Only the active day's tile is ever requested, so these cost nothing on any
ordinary day. Until a file exists the theme falls back to a coloured gradient
defined in `lib/holidayTheme.ts`, so a missing image never breaks the header.

**Licensing:** AI-generated artwork is the simplest path — check your
generator's terms permit commercial use, and keep the source prompt in the
commit message so its provenance is recorded.
