# Header holiday tiles

One seamless, horizontally-tileable illustration per theme. The header repeats
it across its width (`background-repeat: repeat-x`, `background-size: auto 100%`),
so a small tile stays sharp on any screen instead of one wide image being
stretched — that repetition is why the file can be tiny.

| File | Theme |
|---|---|
| `christmas.webp` | 24–26 December |
| `australia-day.webp` | 26 January |
| `anzac-day.webp` | 25 April |
| `easter.webp` | Good Friday → Easter Monday |
| `birthday.webp` | The doctor's own birthday |

**Requirements**

- **WebP**, roughly **480 × 120 px**, ideally under **30 KB**. The bar is 60 px
  tall, so 120 px covers a 2× display.
- **Seamless left↔right.** The left and right edges must line up or the joins
  will show. Most Unsplash/Freepik pattern illustrations already tile.
- **Busy but not bright.** A dark scrim is drawn over the tile so the white
  header text stays readable; a mid-to-dark artwork suits it best.
- Only the active day's tile is ever requested, so these cost nothing on any
  ordinary day.

**Until a file is added**, the theme falls back to a coloured gradient defined
in `lib/holidayTheme.ts`. The header is still themed — just flat rather than
illustrated — so a missing file never breaks anything.

**Licensing:** check the licence before committing an image. Unsplash allows
free commercial use without permission; some illustration sites require
attribution. Whatever is used must be redistributable as part of this repo.
