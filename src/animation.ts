// Rendering engine: turns palette-indexed source pixels into colored terminal
// density characters. Two source rows become one terminal row, preserving the
// Nanoclaw silhouette while giving it Ghosttime's soft ASCII texture instead of
// a wall of square half-block pixels.

type AnimationData = string[][];

type Cell = {
  key: string | null;
  glyph: string;
};

export class Animation {
  private static frames: string[][] = [];
  private static readonly RESET = "\x1b[0m";

  // Palette key -> "r;g;b". The outline is lifted slightly from the SVG's near-
  // black navy so it remains legible on dark terminal themes.
  private static palette: Record<string, string> = {
    o: "24;35;58", // navy outline
    t: "86;237;214", // Nanoclaw teal
    d: "36;150;134", // deep body shade
    l: "176;240;228", // light body highlight
    w: "246;250;249", // eyes
    b: "112;220;212", // bubbles
    s: "216;255;247", // glints
  };

  private static readonly solidGlyph: Record<string, string> = {
    o: "@",
    t: "$",
    d: "%",
    l: "*",
    w: "o",
    b: "o",
    s: "+",
  };

  private static readonly edgeGlyph: Record<string, string> = {
    o: "+",
    t: "x",
    d: "~",
    l: "·",
    w: "·",
    b: "o",
    s: "+",
  };

  /** Recolor the body while deriving matching shade and highlight tones. */
  static setHighlightColor(rgb: string): void {
    const channels = rgb.split(";").map(Number);
    if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) return;
    const base = channels.map((channel) => Math.max(0, Math.min(255, channel)));
    const mix = (target: number[], amount: number) =>
      base.map((channel, index) => Math.round(channel + (target[index] - channel) * amount)).join(";");

    this.palette.t = base.join(";");
    this.palette.d = mix([12, 34, 42], 0.45);
    this.palette.l = mix([246, 255, 252], 0.56);
    this.palette.b = mix([218, 255, 248], 0.38);
  }

  static initialize(data: AnimationData): void {
    this.frames = data.map((grid) => this.renderAscii(grid));
  }

  private static chooseCell(top: string, bottom: string): Cell {
    const hasTop = top !== ".";
    const hasBottom = bottom !== ".";
    if (!hasTop && !hasBottom) return { key: null, glyph: " " };

    if (hasTop !== hasBottom) {
      const key = hasTop ? top : bottom;
      return { key, glyph: this.edgeGlyph[key] ?? "·" };
    }

    if (top === bottom) {
      return { key: top, glyph: this.solidGlyph[top] ?? "$" };
    }

    // Keep outline/eye boundaries crisp when the two vertically sampled pixels
    // have different palette colors.
    const priority = ["w", "s", "o", "l", "d", "t", "b"];
    const key = priority.find((candidate) => candidate === top || candidate === bottom) ?? top;
    const glyph = key === "w" || key === "b" ? "o" : key === "s" ? "+" : key === "o" ? "%" : "*";
    return { key, glyph };
  }

  private static renderAscii(grid: string[]): string[] {
    const lines: string[] = [];
    for (let row = 0; row < grid.length; row += 2) {
      const top = grid[row] ?? "";
      const bottom = grid[row + 1] ?? "";
      const width = Math.max(top.length, bottom.length);
      let line = "";
      let currentColor = "";

      for (let x = 0; x < width; x++) {
        const cell = this.chooseCell(top[x] ?? ".", bottom[x] ?? ".");
        const nextColor = cell.key ? this.palette[cell.key] ?? "" : "";
        if (nextColor !== currentColor) {
          line += nextColor ? `\x1b[38;2;${nextColor}m` : this.RESET;
          currentColor = nextColor;
        }
        line += cell.glyph;
      }

      if (currentColor) line += this.RESET;
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
