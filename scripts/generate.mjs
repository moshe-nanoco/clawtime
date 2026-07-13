#!/usr/bin/env node
// Generates ../src/animation-data.ts from scripts/base-sprite.json.
//
// base-sprite.json (from scripts/rasterize.mjs) is the mascot split into two
// palette-indexed pixel layers — the body and the raised arm — plus the shoulder
// pivot. This script animates a seamless loop where the ARM ROTATES about the
// shoulder to wave, while the body gently floats and blinks and a few bubbles
// drift up. Body + rotated arm are composited into one grid per frame.
//
// Usage:
//   node scripts/generate.mjs             write src/animation-data.ts
//   node scripts/generate.mjs --pixels N  write a pixel-grid HTML preview of frame N
//   node scripts/generate.mjs --hero      write a two-pose HTML preview

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(join(__dirname, "base-sprite.json"), "utf8"));
const BW = base.w;
const BH = base.h;
const BODY = base.body;
const ARM = base.arm;
const [PVX, PVY] = base.pivot;

const OX = 3; // sprite offset within the canvas (margin for the arm swing)
const OY = 3;
const CW = BW + 2 * OX;
const CH = BH + 2 * OY;
const N = 48; // frames (~1.4s loop at ~33fps)
const TAU = Math.PI * 2;
const WAVE_DEG = 16; // arm swing amplitude
const cellOf = (rows, x, y) => {
  if (y < 0 || y >= rows.length) return ".";
  const r = rows[y];
  return x < 0 || x >= r.length ? "." : r[x];
};

// arm bounding box (for the rotation scan)
let ax0 = BW, ay0 = BH, ax1 = 0, ay1 = 0;
for (let y = 0; y < BH; y++)
  for (let x = 0; x < (ARM[y] || "").length; x++)
    if (ARM[y][x] && ARM[y][x] !== ".") {
      if (x < ax0) ax0 = x;
      if (x > ax1) ax1 = x;
      if (y < ay0) ay0 = y;
      if (y > ay1) ay1 = y;
    }

// Eyes live in the body layer; find them (clean catchlights -> left/right).
function findEyes() {
  const whites = [];
  for (let y = 0; y < BH; y++)
    for (let x = 0; x < (BODY[y] || "").length; x++)
      if (BODY[y][x] === "w") whites.push([x, y]);
  if (whites.length < 2) return [];
  const midX = whites.reduce((a, p) => a + p[0], 0) / whites.length;
  return [whites.filter((p) => p[0] < midX), whites.filter((p) => p[0] >= midX)]
    .filter((g) => g.length)
    .map((g) => {
      const cx = Math.round(g.reduce((a, p) => a + p[0], 0) / g.length);
      const cy0 = Math.round(g.reduce((a, p) => a + p[1], 0) / g.length);
      const region = [];
      for (let dy = -6; dy <= 7; dy++)
        for (let dx = -6; dx <= 7; dx++) {
          const x = cx + dx, y = cy0 + dy;
          const c = cellOf(BODY, x, y);
          if (c === "o" || c === "w") region.push([x, y]);
        }
      const ys = region.map((p) => p[1]);
      const cy = ys.length ? Math.round((Math.min(...ys) + Math.max(...ys)) / 2) : cy0;
      return { region, cy };
    });
}
const EYES = findEyes();

const BUBBLES = [
  { x: ax1 + 3, y0: BH * 0.42, travel: BH * 0.36, phase: 0 },
  { x: ax1 + 6, y0: BH * 0.5, travel: BH * 0.42, phase: 16 },
  { x: ax1 - 1, y0: BH * 0.3, travel: BH * 0.26, phase: 30 },
];

function buildFrame(t) {
  const bob = Math.round(0.9 * Math.sin((t / N) * TAU));
  const theta = (WAVE_DEG * Math.PI / 180) * Math.sin((t / N) * TAU * 2); // 2 waves/loop
  const blink = t === N - 4 || t === N - 3;
  const cos = Math.cos(theta), sin = Math.sin(theta);

  const canvas = Array.from({ length: CH }, () => new Array(CW).fill("."));

  // body
  for (let y = 0; y < BH; y++)
    for (let x = 0; x < (BODY[y] || "").length; x++) {
      const c = BODY[y][x];
      if (c !== ".") canvas[y + OY + bob][x + OX] = c;
    }

  // blink (recolor eye pixels; navy line across the middle)
  if (blink)
    for (const e of EYES)
      for (const [bx, by] of e.region) {
        const y = by + OY + bob, x = bx + OX;
        if (y >= 0 && y < CH && x >= 0 && x < CW)
          canvas[y][x] = by === e.cy ? "o" : "t";
      }

  // rotated arm (inverse map over a padded arm bbox so there are no holes)
  const m = 8;
  for (let dy = ay0 - m; dy <= ay1 + m; dy++)
    for (let dx = ax0 - m; dx <= ax1 + m; dx++) {
      const rx = dx - PVX, ry = dy - PVY;
      const sx = Math.round(PVX + rx * cos + ry * sin);
      const sy = Math.round(PVY - rx * sin + ry * cos);
      const c = cellOf(ARM, sx, sy);
      if (c !== ".") {
        const y = dy + OY + bob, x = dx + OX;
        if (y >= 0 && y < CH && x >= 0 && x < CW) canvas[y][x] = c;
      }
    }

  // bubbles
  for (const b of BUBBLES) {
    const p = ((t + b.phase) % N) / N;
    const y = Math.round(b.y0 - p * b.travel) + OY + bob;
    const x = Math.round(b.x) + OX;
    if (y >= 0 && y < CH && x >= 0 && x < CW && canvas[y][x] === ".")
      canvas[y][x] = p < 0.5 ? "l" : "w";
  }

  return canvas.map((row) => row.join("").replace(/\.+$/u, ""));
}

const FRAMES = Array.from({ length: N }, (_, t) => buildFrame(t));
for (let t = 0; t < N; t++)
  if (FRAMES[t].length !== CH) throw new Error(`frame ${t}: bad height`);

const HEX = { o: "#121729", t: "#56EDD6", d: "#249686", l: "#B0F0E4", w: "#F6FAF9" };
function gridHtml(f, px) {
  let minX = CW, maxX = 0;
  for (let y = 0; y < CH; y++)
    for (let x = 0; x < CW; x++)
      if ((FRAMES[f][y][x] ?? ".") !== ".") { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  let cells = "";
  for (let y = 0; y < CH; y++)
    for (let x = minX; x <= maxX; x++) {
      const ch = FRAMES[f][y][x] ?? ".";
      cells += `<i style="background:${ch === "." ? "transparent" : HEX[ch]}"></i>`;
    }
  return `<div class=g style="grid-template-columns:repeat(${maxX - minX + 1},${px}px);grid-auto-rows:${px}px">${cells}</div>`;
}

const arg = process.argv[2];
if (arg === "--pixels" || arg === "--hero") {
  const px = arg === "--hero" ? 7 : 7;
  const frames = arg === "--hero" ? [0, 6] : [Number.parseInt(process.argv[3] || "0") || 0];
  process.stdout.write(
    `<!doctype html><meta charset=utf-8><style>body{background:#0d1117;margin:0;padding:26px;display:inline-flex;gap:34px}` +
      `.g{display:grid;width:max-content}i{display:block;width:${px}px;height:${px}px}</style>` +
      frames.map((f) => gridHtml(f, px)).join("")
  );
} else {
  const body =
    "// AUTO-GENERATED by scripts/generate.mjs from scripts/base-sprite.json.\n" +
    "// Do not edit by hand. Run `npm run gen` to regenerate.\n\n" +
    `export const FRAME_WIDTH = ${CW};\n` +
    `export const FRAME_HEIGHT = ${CH / 2};\n\n` +
    "export const ANIMATION_DATA: string[][] = " +
    JSON.stringify(FRAMES).replace(/\],\[/g, "],\n  [") +
    ";\n";
  writeFileSync(join(__dirname, "..", "src", "animation-data.ts"), body);
  console.log(`wrote src/animation-data.ts — ${N} frames, ${CW}x${CH}px (${CW} cols x ${CH / 2} rows), eyes ${EYES.length}, pivot ${PVX},${PVY}`);
}
