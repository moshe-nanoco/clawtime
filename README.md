# 🦐 clawtime

The **nanoclaw** shrimp, waving hello right in your terminal — redrawn with the
expressive ASCII density and fluid motion of Ghosttime. The raised claw waves,
the antennae sway, the eyes blink, and a few bubbles and glints drift past.
Smooth, flicker-free, focus-aware, and
auto-centered, with basically no CPU when you're not looking.

![clawtime — the nanoclaw shrimp rendered in colorful terminal ASCII](./assets/preview.png)

Inspired by [ghosttime](https://github.com/SohelIslamImran/ghosttime); the
terminal engine is derived from it.

## Run it

```bash
# no install
npx clawtime

# or install globally
npm install -g clawtime
clawtime
```

Press `q` or `Ctrl+C` to exit. A terminal with 24-bit ("truecolor") support
shows the mascot best — that's most modern terminals (Ghostty, iTerm2, Kitty,
WezTerm, VS Code…).

## Options

| Flag | Description |
| --- | --- |
| `-c, --color <name\|#hex\|r,g,b>` | Recolor the body (e.g. `-c pink`, `-c '#ff66cc'`, `-c 255,120,180`). Default is nanoclaw teal. |
| `--select-color` | Pick a color interactively. |
| `--colors` | List the available color names. |
| `-t, --timer <seconds>` | Run for a set duration, then exit. |
| `-nf, --no-focus-pause` | Keep animating even when the terminal loses focus. |
| `-h, --help` | Show help. |

```bash
clawtime -c cyan        # a cyan shrimp
clawtime -c '#ff9ecb'   # any hex color
clawtime -t 10          # wave for 10 seconds
clawtime -nf            # never pause
```

## How it works

Like [ghosttime](https://github.com/SohelIslamImran/ghosttime), the animation is
a set of pre-rendered frames plus a few ANSI/DEC escape-sequence tricks:

- **Time-based frame clock.** The current frame is derived from elapsed wall time
  (~33 fps), so playback self-corrects and only redraws on change — idle CPU
  stays near zero.
- **Flicker-free rendering.** It probes for DEC mode 2026 (synchronized output)
  and paints each frame atomically when supported, otherwise falls back to a
  cursor-home line-by-line overwrite.
- **Focus-aware pause.** Enables focus reporting (`?1004`) and pauses/resumes
  when you switch away — disable with `-nf`.
- **Good terminal citizen.** Alternate screen buffer, hidden cursor,
  auto-centering, full restore on exit. Zero runtime dependencies.

### The art

The mascot is built directly from the **actual nanoclaw logo**, not a hand-drawn
approximation:

1. `scripts/rasterize.mjs` rasterizes the official SVG
   (`assets/nanoclaw-light-square.svg`), crops it to the mascot, downsamples to a
   ~64-wide grid, flood-fills the white background to transparency (so the eye
   catchlights survive), and quantizes to the mascot's palette. It **splits the
   sprite into two layers** — the body and the *raised claw* (SVG path #15 plus
   only its nearby navy outline) — and records an overlapping shoulder pivot →
   `scripts/base-sprite.json`.
2. `scripts/generate.mjs` builds an 84-frame seamless loop. The **claw rotates
   about the shoulder with an eased wave envelope**, the antenna tips sway, the
   face blinks, and sparse bubbles and glints add life without
   hiding the character → `src/animation-data.ts`.
3. At runtime, `src/animation.ts` turns each pair of source rows into one line of
   `$`, `%`, `*`, `@`, `+`, `x`, `~`, and `·` density characters. The result has
   Ghosttime's soft ASCII texture while retaining Nanoclaw's 24-bit teal, navy,
   highlights, face, and silhouette. `-c` recolors the body and automatically
   derives matching shade, highlight, and bubble tones.

## Develop

```bash
npm run dev            # run from source (needs bun)
npm run gen            # rebuild src/animation-data.ts (animation) from base-sprite.json
npm run raster         # rebuild scripts/base-sprite.json from the SVG (macOS; needs qlmanage + sips)
npm run build          # bundle src/cli.ts -> dist/cli.js (needs bun)

# preview the art (writes HTML to stdout):
node scripts/generate.mjs --pixels 0 > frame0.html   # source pixel grid
node scripts/generate.mjs --hero      > hero.html    # two colored ASCII poses
node scripts/generate.mjs --ascii 0                  # plain terminal characters
```

## Credits

- Terminal engine adapted from **ghosttime** by
  [Sohel Islam Imran](https://github.com/SohelIslamImran/ghosttime) (MIT).
- Mascot artwork: the **nanoclaw** shrimp ([nanoclaw.dev](https://nanoclaw.dev)).

## License

[MIT](./LICENSE)
