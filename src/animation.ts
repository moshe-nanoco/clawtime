// Rendering engine: turns palette-indexed pixel grids into colored half-block
// terminal lines.
//
// The animation data is a list of frames; each frame is a list of PIXEL rows
// (top-to-bottom), and each row is a string of palette keys — one character per
// pixel, "." = transparent. Two pixel rows are packed into one line of text
// using the upper-half-block "▀" (foreground = top pixel, background = bottom
// pixel), which doubles vertical resolution and reproduces the mascot faithfully.
//
// Colors are 24-bit. The body color ("t") can be swapped at runtime via the -c
// flag; everything else (outline, shading, eyes) is fixed.

type AnimationData = string[][];

export class Animation {
  private static frames: string[][] = [];
  private static readonly RESET = "\x1b[0m";

  // palette key -> "r;g;b". "t" (teal body) is overridable with setHighlightColor.
  private static palette: Record<string, string> = {
    o: "18;23;41", //   navy outline / shadow
    t: "86;237;214", // teal body
    d: "36;150;134", // dark teal shade
    l: "176;240;228", // light teal (legs / underside)
    w: "246;250;249", // white (eyes)
  };

  /** Override the body color. Accepts an "r;g;b" string. */
  static setHighlightColor(rgb: string): void {
    this.palette.t = rgb;
  }

  static initialize(data: AnimationData): void {
    this.frames = data.map((grid) => this.renderHalfBlocks(grid));
  }

  private static renderHalfBlocks(grid: string[]): string[] {
    const lines: string[] = [];
    for (let r = 0; r < grid.length; r += 2) {
      const top = grid[r] ?? "";
      const bot = grid[r + 1] ?? "";
      const width = Math.max(top.length, bot.length);
      let line = "";
      let cur = "";
      for (let x = 0; x < width; x++) {
        const tc = top[x] ?? ".";
        const bc = bot[x] ?? ".";
        const tset = tc !== ".";
        const bset = bc !== ".";
        let glyph: string;
        let style: string;
        if (!tset && !bset) {
          glyph = " ";
          style = "";
        } else if (tset && bset) {
          if (tc === bc) {
            glyph = "█";
            style = `38;2;${this.palette[tc]}`;
          } else {
            glyph = "▀";
            style = `38;2;${this.palette[tc]};48;2;${this.palette[bc]}`;
          }
        } else if (tset) {
          glyph = "▀";
          style = `38;2;${this.palette[tc]}`;
        } else {
          glyph = "▄";
          style = `38;2;${this.palette[bc]}`;
        }
        if (style !== cur) {
          line += style === "" ? this.RESET : `\x1b[${style}m`;
          cur = style;
        }
        line += glyph;
      }
      if (cur !== "") line += this.RESET;
      lines.push(line);
    }
    return lines;
  }

  static getFrameLines(index: number): string[] {
    return this.frames[index];
  }

  static get frameCount(): number {
    return this.frames.length;
  }
}
