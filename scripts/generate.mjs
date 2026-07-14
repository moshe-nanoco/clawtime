#!/usr/bin/env node
// Generates ../src/animation-data.ts from scripts/base-sprite.json.
//
// The official Nanoclaw SVG is rasterized once into two palette-indexed layers:
// the body and the raised claw. This script composes two seamless character
// loops: the default eased claw wave and a snappy squash-and-stretch jump based
// on the Nano Jump emoji. At runtime each two source rows become one terminal
// row of Ghosttime-style density characters.
//
// Usage:
//   node scripts/generate.mjs              write src/animation-data.ts
//   node scripts/generate.mjs --pixels N   write a pixel-grid HTML preview
//   node scripts/generate.mjs --hero       write a two-pose ASCII HTML preview
//   node scripts/generate.mjs --preview    write /tmp/clawtime-preview.svg
// Add --jump to any preview command to inspect the jump loop.


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

const OX = 7;
const OY = 11; // top clearance for the airborne jump pose
const BOTTOM_MARGIN = 5;
const CW = BW + OX * 2;
const CH = BH + OY + BOTTOM_MARGIN;
const WAVE_FRAME_COUNT = 84; // 2.52 seconds at the 30 ms frame clock
const JUMP_FRAME_COUNT = 36; // 1.08 seconds, matching the reference GIF's snap
const TAU = Math.PI * 2;
const WAVE_DEG = 10;

const HEX = {
  o: "#18233a",
  t: "#56edd6",
  d: "#249686",
  l: "#b0f0e4",
  w: "#f6faf9",
  b: "#70dcd4",
  s: "#d8fff7",
};

const SOLID_GLYPH = { o: "@", t: "$", d: "%", l: "*", w: "o", b: "o", s: "+" };
const EDGE_GLYPH = { o: "+", t: "x", d: "~", l: "·", w: "·", b: "o", s: "+" };

const cellOf = (rows, x, y) => {
  if (y < 0 || y >= rows.length) return ".";
  const row = rows[y];
  return x < 0 || x >= row.length ? "." : row[x];
};

const put = (canvas, x, y, value) => {
  if (x < 0 || y < 0 || x >= CW || y >= CH || canvas[y][x] !== ".") return;
  canvas[y][x] = value;
};

// Bounding box used by the inverse-mapped claw rotation.
let ax0 = BW, ay0 = BH, ax1 = 0, ay1 = 0;
for (let y = 0; y < BH; y++)
  for (let x = 0; x < (ARM[y] || "").length; x++)
    if (ARM[y][x] && ARM[y][x] !== ".") {
      ax0 = Math.min(ax0, x);
      ay0 = Math.min(ay0, y);
      ax1 = Math.max(ax1, x);
      ay1 = Math.max(ay1, y);
    }

// Locate the two eye regions once so the generator can close them cleanly.
function findEyes() {
  const whites = [];
  for (let y = 0; y < BH; y++)
    for (let x = 0; x < (BODY[y] || "").length; x++)
      if (BODY[y][x] === "w") whites.push([x, y]);
  if (whites.length < 2) return [];

  const midX = whites.reduce((sum, point) => sum + point[0], 0) / whites.length;
  return [whites.filter((point) => point[0] < midX), whites.filter((point) => point[0] >= midX)]
    .filter((group) => group.length)
    .map((group) => {
      const cx = Math.round(group.reduce((sum, point) => sum + point[0], 0) / group.length);
      const eyeY = Math.round(group.reduce((sum, point) => sum + point[1], 0) / group.length);
      const region = [];
      for (let dy = -6; dy <= 7; dy++)
        for (let dx = -6; dx <= 7; dx++) {
          const x = cx + dx, y = eyeY + dy;
          const value = cellOf(BODY, x, y);
          if (value === "o" || value === "w") region.push([x, y]);
        }
      const ys = region.map((point) => point[1]);
      const cy = ys.length ? Math.round((Math.min(...ys) + Math.max(...ys)) / 2) : eyeY;
      return { region, cy };
    });
}

const EYES = findEyes();

const BUBBLES = [
  { x: CW - 7, y0: CH * 0.58, travel: CH * 0.43, phase: 0.08 },
  { x: CW - 3, y0: CH * 0.67, travel: CH * 0.49, phase: 0.56 },
];

function drawBubble(canvas, x, y, radius) {
  if (radius === 1) {
    put(canvas, x, y, "b");
    return;
  }
  put(canvas, x - 1, y, "b");
  put(canvas, x + 1, y, "b");
  put(canvas, x, y - 1, "b");
  put(canvas, x, y + 1, "b");
}

function blinkAmount(t) {
  // A quick close-hold-open near the quiet end of the loop.
  const center = Math.round(WAVE_FRAME_COUNT * 0.76);
  const distance = Math.abs(t - center);
  if (distance <= 1) return 1;
  if (distance === 2) return 0.5;
  return 0;
}

function buildWaveFrame(t) {
  const p = t / WAVE_FRAME_COUNT;

  // Three small waves happen inside a sin² envelope. The claw leaves and
  // returns to the exact rest pose at the loop seam instead of snapping.
  const waveEnvelope = Math.sin(Math.PI * p) ** 2;
  const theta = (WAVE_DEG * Math.PI / 180) * waveEnvelope * Math.sin(TAU * p * 3);
  const cos = Math.cos(theta), sin = Math.sin(theta);

  const canvas = Array.from({ length: CH }, () => new Array(CW).fill("."));

  // Body and antennae. Only the long, thin tips receive horizontal sway; the
  // face and silhouette stay stable and readable instead of pixel-shimmering.
  for (let y = 0; y < BH; y++)
    for (let x = 0; x < (BODY[y] || "").length; x++) {
      const value = BODY[y][x];
      if (value === ".") continue;
      const antennaWeight = y < 14 ? (14 - y) / 14 : 0;
      const sway = Math.round(antennaWeight * 1.4 * Math.sin(TAU * p - 0.35));
      const px = x + OX + sway, py = y + OY;
      if (px >= 0 && py >= 0 && px < CW && py < CH) canvas[py][px] = value;
    }

  // Blink before compositing the claw so the expression remains independent.
  const blink = blinkAmount(t);
  if (blink > 0)
    for (const eye of EYES)
      for (const [bx, by] of eye.region) {
        const px = bx + OX;
        const py = by + OY;
        if (px < 0 || py < 0 || px >= CW || py >= CH) continue;
        const onLid = Math.abs(by - eye.cy) <= (blink < 1 ? 1 : 0);
        canvas[py][px] = onLid ? "o" : "t";
      }

  // Rotate the isolated raised claw around its shoulder. The rasterizer keeps a
  // shared shoulder patch in both layers, which makes every pose stay attached.
  const margin = 7;
  for (let dy = ay0 - margin; dy <= ay1 + margin; dy++)
    for (let dx = ax0 - margin; dx <= ax1 + margin; dx++) {
      const rx = dx - PVX, ry = dy - PVY;
      const sx = Math.round(PVX + rx * cos + ry * sin);
      const sy = Math.round(PVY - rx * sin + ry * cos);
      const value = cellOf(ARM, sx, sy);
      if (value === ".") continue;
      const px = dx + OX, py = dy + OY;
      if (px >= 0 && py >= 0 && px < CW && py < CH) canvas[py][px] = value;
    }

  // Sparse bubbles make the underwater character feel alive without turning
  // the frame into particle noise.
  for (const bubble of BUBBLES) {
    const life = (p + bubble.phase) % 1;
    const x = Math.round(bubble.x + Math.sin(life * TAU * 1.5) * 1.4);
    const y = Math.round(bubble.y0 - life * bubble.travel);
    drawBubble(canvas, x, y, life > 0.55 && life < 0.83 ? 2 : 1);
  }

  // Two brief glints answer the claw at the wave's strongest beats.
  const glint = Math.sin(TAU * p * 3);
  if (waveEnvelope > 0.42 && glint > 0.72) {
    put(canvas, CW - 5, OY + 7, "s");
    put(canvas, CW - 8, OY + 4, "s");
  }

  return canvas.map((row) => row.join("").replace(/\.+$/u, ""));
}

const WAVE_FRAMES = Array.from({ length: WAVE_FRAME_COUNT }, (_, t) => buildWaveFrame(t));

// The jump is driven by the same eight beats as the Nano Jump emoji: idle,
// anticipation crouch, launch stretch, apex, fall, landing squash, rebound, and
// settle. Smooth interpolation keeps that 8-frame personality without the
// choppiness of directly copying its 130 ms frame holds.
const FULL_SPRITE = Array.from({ length: BH }, (_, y) => {
  let row = "";
  for (let x = 0; x < BW; x++) {
    const arm = cellOf(ARM, x, y);
    row += arm !== "." ? arm : cellOf(BODY, x, y);
  }
  return row;
});

const JUMP_ANCHOR_X = 30;
const JUMP_ANCHOR_Y = 67;
const JUMP_SPRITE_HEIGHT = 68; // rows below this are the SVG's ground shadow
const JUMP_GROUND_Y = OY + 69;
const JUMP_KEYS = [
  { p: 0.00, sx: 1.00, sy: 1.00, lift: 0, shadow: 0.90, impact: 0 },
  { p: 0.10, sx: 1.08, sy: 0.87, lift: 0, shadow: 1.08, impact: 0 },
  { p: 0.20, sx: 0.94, sy: 1.09, lift: -4, shadow: 0.78, impact: 0 },
  { p: 0.32, sx: 0.98, sy: 1.02, lift: -9, shadow: 0.52, impact: 0 },
  { p: 0.42, sx: 0.99, sy: 0.98, lift: -4, shadow: 0.72, impact: 0 },
  { p: 0.50, sx: 1.10, sy: 0.85, lift: 0, shadow: 1.12, impact: 1 },
  { p: 0.59, sx: 0.98, sy: 1.04, lift: -2, shadow: 0.88, impact: 0 },
  { p: 0.68, sx: 1.00, sy: 1.00, lift: 0, shadow: 0.90, impact: 0 },
  { p: 1.00, sx: 1.00, sy: 1.00, lift: 0, shadow: 0.90, impact: 0 },
];

const smoothstep = (value) => value * value * (3 - 2 * value);
const lerp = (from, to, amount) => from + (to - from) * amount;

function sampleJumpPose(p) {
  for (let index = 0; index < JUMP_KEYS.length - 1; index++) {
    const from = JUMP_KEYS[index];
    const to = JUMP_KEYS[index + 1];
    if (p > to.p) continue;
    const amount = smoothstep((p - from.p) / (to.p - from.p));
    return {
      sx: lerp(from.sx, to.sx, amount),
      sy: lerp(from.sy, to.sy, amount),
      lift: lerp(from.lift, to.lift, amount),
      shadow: lerp(from.shadow, to.shadow, amount),
      impact: lerp(from.impact, to.impact, amount),
    };
  }
  return JUMP_KEYS[JUMP_KEYS.length - 1];
}

function drawJumpShadow(canvas, pose) {
  const center = OX + JUMP_ANCHOR_X;
  const width = Math.round(32 * pose.shadow);
  const left = Math.round(center - width / 2);
  for (let x = left; x < left + width; x++) {
    const edge = x === left || x === left + width - 1;
    put(canvas, x, JUMP_GROUND_Y, edge ? "d" : "o");
    put(canvas, x, JUMP_GROUND_Y + 1, edge ? "d" : "o");
  }
}

function buildJumpFrame(t) {
  const p = t / JUMP_FRAME_COUNT;
  const pose = sampleJumpPose(p);
  const canvas = Array.from({ length: CH }, () => new Array(CW).fill("."));
  const anchorX = OX + JUMP_ANCHOR_X;
  const anchorY = OY + JUMP_ANCHOR_Y + pose.lift;

  drawJumpShadow(canvas, pose);

  // Inverse-map the official mascot around the point where its body meets the
  // ground. Non-uniform scale supplies the anticipation, launch stretch, and
  // landing squash while keeping the face and claw unmistakably Nanoclaw.
  for (let y = 0; y < CH; y++)
    for (let x = 0; x < CW; x++) {
      const sourceX = Math.round(JUMP_ANCHOR_X + (x - anchorX) / pose.sx);
      const sourceY = Math.round(JUMP_ANCHOR_Y + (y - anchorY) / pose.sy);
      if (sourceY < 0 || sourceY >= JUMP_SPRITE_HEIGHT) continue;
      const value = cellOf(FULL_SPRITE, sourceX, sourceY);
      if (value !== ".") canvas[y][x] = value;
    }

  // The reference has a clean airborne silhouette followed by a sharp impact.
  // Sparse trails and landing sparks translate those beats to terminal cells.
  if (pose.lift < -3) {
    put(canvas, anchorX - 25, JUMP_GROUND_Y - 7, "b");
    put(canvas, anchorX + 25, JUMP_GROUND_Y - 5, "b");
  }
  if (p > 0.25 && p < 0.39) {
    put(canvas, anchorX - 27, OY + 11, "s");
    put(canvas, anchorX + 30, OY + 18, "s");
  }
  if (pose.impact > 0.22) {
    const burst = Math.round(18 + pose.impact * 4);
    put(canvas, anchorX - burst, JUMP_GROUND_Y - 2, "s");
    put(canvas, anchorX + burst, JUMP_GROUND_Y - 2, "s");
    put(canvas, anchorX - burst - 3, JUMP_GROUND_Y - 4, "b");
    put(canvas, anchorX + burst + 3, JUMP_GROUND_Y - 4, "b");
  }

  return canvas.map((row) => row.join("").replace(/\.+$/u, ""));
}

const JUMP_FRAMES = Array.from({ length: JUMP_FRAME_COUNT }, (_, t) => buildJumpFrame(t));

for (const [name, frames] of [["wave", WAVE_FRAMES], ["jump", JUMP_FRAMES]])
  for (let t = 0; t < frames.length; t++)
    if (frames[t].length !== CH) throw new Error(`${name} frame ${t}: bad height`);

function chooseCell(top, bottom) {
  const hasTop = top !== ".";
  const hasBottom = bottom !== ".";
  if (!hasTop && !hasBottom) return { key: null, glyph: " " };
  if (hasTop !== hasBottom) {
    const key = hasTop ? top : bottom;
    return { key, glyph: EDGE_GLYPH[key] || "·" };
  }
  if (top === bottom) return { key: top, glyph: SOLID_GLYPH[top] || "$" };

  const priority = ["w", "s", "o", "l", "d", "t", "b"];
  const key = priority.find((candidate) => candidate === top || candidate === bottom) || top;
  const glyph = key === "w" || key === "b" ? "o" : key === "s" ? "+" : key === "o" ? "%" : "*";
  return { key, glyph };
}

function asciiRows(frame) {
  const rows = [];
  for (let y = 0; y < CH; y += 2) {
    let row = "";
    for (let x = 0; x < CW; x++) {
      const { glyph } = chooseCell(frame[y]?.[x] ?? ".", frame[y + 1]?.[x] ?? ".");
      row += glyph;
    }
    rows.push(row.replace(/\s+$/u, ""));
  }
  return rows;
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function asciiHtml(frame) {
  const lines = [];
  for (let y = 0; y < CH; y += 2) {
    let line = "";
    let color = null;
    for (let x = 0; x < CW; x++) {
      const cell = chooseCell(frame[y]?.[x] ?? ".", frame[y + 1]?.[x] ?? ".");
      if (cell.key !== color) {
        if (color) line += "</span>";
        if (cell.key) line += `<span style="color:${HEX[cell.key]}">`;
        color = cell.key;
      }
      line += escapeHtml(cell.glyph);
    }
    if (color) line += "</span>";
    lines.push(line.replace(/\s+$/u, ""));
  }
  return `<pre>${lines.join("\n")}</pre>`;
}

function pixelHtml(frame, px = 7) {
  let cells = "";
  for (let y = 0; y < CH; y++)
    for (let x = 0; x < CW; x++) {
      const key = frame[y]?.[x] ?? ".";
      cells += `<i style="background:${key === "." ? "transparent" : HEX[key]}"></i>`;
    }
  return `<div class="grid" style="grid-template-columns:repeat(${CW},${px}px);grid-auto-rows:${px}px">${cells}</div>`;
}

function previewSvg(frames, frameIndexes) {
  const cellWidth = 9.7;
  const cellHeight = 18;
  const pad = 34;
  const frameWidth = CW * cellWidth;
  const width = Math.ceil(pad * 2 + frameIndexes.length * frameWidth + (frameIndexes.length - 1) * 34);
  const height = Math.ceil(pad * 2 + (CH / 2) * cellHeight);
  let text = "";

  frameIndexes.forEach((frameIndex, index) => {
    const frame = frames[frameIndex];
    const originX = pad + index * (frameWidth + 34);
    for (let y = 0; y < CH; y += 2)
      for (let x = 0; x < CW; x++) {
        const cell = chooseCell(frame[y]?.[x] ?? ".", frame[y + 1]?.[x] ?? ".");
        if (!cell.key || cell.glyph === " ") continue;
        const px = (originX + x * cellWidth).toFixed(1);
        const py = (pad + (y / 2 + 1) * cellHeight).toFixed(1);
        text += `<text x="${px}" y="${py}" fill="${HEX[cell.key]}">${escapeHtml(cell.glyph)}</text>`;
      }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="#0b1018"/>` +
    `<g font-family="Menlo,Monaco,Consolas,monospace" font-size="16" font-weight="700">${text}</g></svg>`;
}

const arg = process.argv[2];
const selectedMode = process.argv.includes("--jump") ? "jump" : "wave";
const SELECTED_FRAMES = selectedMode === "jump" ? JUMP_FRAMES : WAVE_FRAMES;
const numericArgs = process.argv.slice(3).filter((value) => value !== "--jump").map(Number).filter(Number.isFinite);
if (arg === "--pixels") {
  const frame = numericArgs[0] || 0;
  process.stdout.write(`<!doctype html><meta charset="utf-8"><style>body{background:#0b1018;margin:0;padding:26px}.grid{display:grid;width:max-content}i{display:block;width:7px;height:7px}</style>${pixelHtml(SELECTED_FRAMES[frame])}`);
} else if (arg === "--hero") {
  process.stdout.write(`<!doctype html><meta charset="utf-8"><style>body{background:#0b1018;margin:0;padding:28px;display:flex;gap:34px;color:white}pre{margin:0;font:700 16px/18px Menlo,Monaco,Consolas,monospace}</style>${asciiHtml(SELECTED_FRAMES[0])}${asciiHtml(SELECTED_FRAMES[Math.round(SELECTED_FRAMES.length * 0.32)])}`);
} else if (arg === "--preview") {
  const output = "/private/tmp/clawtime-preview.svg";
  const requestedFrames = numericArgs;
  writeFileSync(output, previewSvg(SELECTED_FRAMES, requestedFrames.length ? requestedFrames : [0, Math.round(SELECTED_FRAMES.length * 0.32)]));
  console.log(`wrote ${output} (${selectedMode})`);
} else if (arg === "--ascii") {
  const frame = numericArgs[0] || 0;
  process.stdout.write(asciiRows(SELECTED_FRAMES[frame]).join("\n") + "\n");
} else {
  const serialize = (frames) => JSON.stringify(frames).replace(/\],\[/g, "],\n  [");
  const body =
    "// AUTO-GENERATED by scripts/generate.mjs from scripts/base-sprite.json.\n" +
    "// Do not edit by hand. Run `npm run gen` to regenerate.\n\n" +
    `export const FRAME_WIDTH = ${CW};\n` +
    `export const FRAME_HEIGHT = ${CH / 2};\n\n` +
    "export const WAVE_ANIMATION_DATA: string[][] = " + serialize(WAVE_FRAMES) + ";\n\n" +
    "export const JUMP_ANIMATION_DATA: string[][] = " + serialize(JUMP_FRAMES) + ";\n\n" +
    "// Backward-compatible default for existing imports.\n" +
    "export const ANIMATION_DATA = WAVE_ANIMATION_DATA;\n";
  writeFileSync(join(__dirname, "..", "src", "animation-data.ts"), body);
  console.log(`wrote src/animation-data.ts — wave ${WAVE_FRAME_COUNT} frames, jump ${JUMP_FRAME_COUNT} frames, ${CW}x${CH}px (${CW} cols x ${CH / 2} rows), eyes ${EYES.length}, pivot ${PVX},${PVY}`);
}
