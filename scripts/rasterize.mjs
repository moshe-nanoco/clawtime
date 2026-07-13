#!/usr/bin/env node
// Rasterize assets/nanoclaw-light-square.svg into scripts/base-sprite.json — the
// mascot split into two palette-indexed pixel layers (body + raised arm) plus the
// shoulder pivot, so generate.mjs can rotate the arm to wave.
//
// The raised arm is SVG path #15 (verified by position). Its navy "backing" is
// part of the single silhouette path, so we grab the navy pixels hugging the arm
// into the arm layer by dilation.
//
// Design-time tool (macOS: uses `qlmanage` + `sips`). The resulting
// base-sprite.json is committed, so building/using clawtime never needs this.
//   node scripts/rasterize.mjs [maxCols=64] [maxRows=36]

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SVG = join(__dirname, "..", "assets", "nanoclaw-light-square.svg");
const TMP = tmpdir();
const ARM_PATHS = [15]; // the raised arm + pincer
const CUT = -2; // px behind the shoulder to start the body/arm split

function renderBMP(svgText, name) {
  const svgPath = join(TMP, name + ".svg");
  writeFileSync(svgPath, svgText);
  execFileSync("qlmanage", ["-t", "-s", "1024", "-o", TMP, svgPath], { stdio: "ignore" });
  execFileSync("sips", ["-s", "format", "bmp", join(TMP, name + ".svg.png"), "--out", join(TMP, name + ".bmp")], { stdio: "ignore" });
  const buf = readFileSync(join(TMP, name + ".bmp"));
  const off = buf.readUInt32LE(10), W = buf.readInt32LE(18), Hr = buf.readInt32LE(22), H = Math.abs(Hr), td = Hr < 0;
  return { W, H, px: (x, y) => { const yy = td ? y : H - 1 - y; const i = off + (yy * W + x) * 4; return [buf[i + 2], buf[i + 1], buf[i]]; } };
}

const svg = readFileSync(SVG, "utf8");
const open = svg.match(/<svg[^>]*>/)[0];
const paths = svg.match(/<path[\s\S]*?\/>/g);
const wr = '<rect width="512" height="512" fill="white"/>';
const full = renderBMP(open + wr + paths.join("") + "</svg>", "nc-full");
const arm = renderBMP(open + wr + ARM_PATHS.map((i) => paths[i]).join("") + "</svg>", "nc-arm");

const isWhite = (r, g, b) => r > 232 && g > 232 && b > 232;
let x0 = full.W, y0 = full.H, x1 = 0, y1 = 0;
for (let y = 0; y < full.H; y++) for (let x = 0; x < full.W; x++) { const [r, g, b] = full.px(x, y); if (!isWhite(r, g, b)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
const pad = Math.round((x1 - x0) * 0.02); x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(full.W - 1, x1 + pad); y1 = Math.min(full.H - 1, y1 + pad);
const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
const MAXW = Number(process.argv[2] || 64), MAXROWS = Number(process.argv[3] || 36);
let TW = MAXW, TH = Math.round(TW * (bh / bw));
if (TH > MAXROWS * 2) { TH = MAXROWS * 2; TW = Math.round(TH * (bw / bh)); }
if (TH % 2) TH++;

function downsample(reader) {
  const avg = [];
  for (let ty = 0; ty < TH; ty++) { const row = []; for (let tx = 0; tx < TW; tx++) {
    const sx0 = x0 + Math.floor(tx * bw / TW), sx1 = x0 + Math.floor((tx + 1) * bw / TW);
    const sy0 = y0 + Math.floor(ty * bh / TH), sy1 = y0 + Math.floor((ty + 1) * bh / TH);
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = sy0; sy <= sy1 && sy <= y1; sy++) for (let sx = sx0; sx <= sx1 && sx <= x1; sx++) { const p = reader.px(sx, sy); r += p[0]; g += p[1]; b += p[2]; n++; }
    n = n || 1; row.push([r / n, g / n, b / n]);
  } avg.push(row); } return avg;
}
const favg = downsample(full), aavg = downsample(arm);

const bg = Array.from({ length: TH }, () => new Array(TW).fill(false));
const st = []; const near = (c) => isWhite(c[0], c[1], c[2]);
for (let tx = 0; tx < TW; tx++) st.push([tx, 0], [tx, TH - 1]); for (let ty = 0; ty < TH; ty++) st.push([0, ty], [TW - 1, ty]);
while (st.length) { const [x, y] = st.pop(); if (x < 0 || y < 0 || x >= TW || y >= TH || bg[y][x]) continue; if (!near(favg[y][x])) continue; bg[y][x] = true; st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); }

const PAL = { o: [18, 23, 41], t: [86, 237, 214], d: [36, 150, 134], l: [190, 244, 232], w: [255, 255, 255] };
const keys = Object.keys(PAL);
const quant = (c) => { const tint = c[1] > c[0] + 6 && c[2] > c[0] + 2; let best = "t", bd = 1e9; for (const k of keys) { if (tint && k === "w") continue; const [r, g, b] = PAL[k]; const dd = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2; if (dd < bd) { bd = dd; best = k; } } return best; };

const baseGrid = []; for (let y = 0; y < TH; y++) { let s = ""; for (let x = 0; x < TW; x++) s += bg[y][x] ? "." : quant(favg[y][x]); baseGrid.push(s); }
const armCore = []; for (let y = 0; y < TH; y++) { const r = []; for (let x = 0; x < TW; x++) r.push(!isWhite(aavg[y][x][0], aavg[y][x][1], aavg[y][x][2])); armCore.push(r); }

// shoulder pivot = bottom-left of the arm core; tip = the farthest core cell
let piv = [0, 0], bestS = -1e9;
for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) if (armCore[y][x]) { const s = y - x; if (s > bestS) { bestS = s; piv = [x, y]; } }
let tip = piv, bestD = -1;
for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) if (armCore[y][x]) { const d = (x - piv[0]) ** 2 + (y - piv[1]) ** 2; if (d > bestD) { bestD = d; tip = [x, y]; } }
let ax = tip[0] - piv[0], ay = tip[1] - piv[1]; const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
const proj = (x, y) => (x - piv[0]) * ax + (y - piv[1]) * ay;

// The arm's teal fill is exactly the arm core (SVG #15). Its navy outline/shadow
// is the navy that hugs it — captured by flooding OUTWARD along navy pixels only,
// stopping at the shoulder (proj < CUT). Following navy-only means the claw takes
// its whole outline with it but never steals the body's teal.
const armMask = Array.from({ length: TH }, () => new Array(TW).fill(false));
const astk = [];
for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) if (armCore[y][x]) { armMask[y][x] = true; astk.push([x, y]); }
while (astk.length) {
  const [x, y] = astk.pop();
  for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
    if (nx < 0 || ny < 0 || nx >= TW || ny >= TH || armMask[ny][nx]) continue;
    if ((baseGrid[ny][nx] ?? ".") !== "o") continue; // only follow the navy outline
    if (proj(nx, ny) < CUT) continue; // stop at the shoulder
    armMask[ny][nx] = true;
    astk.push([nx, ny]);
  }
}

const bodyL = [], armL = [];
for (let y = 0; y < TH; y++) { let b = "", a = ""; for (let x = 0; x < TW; x++) { const c = baseGrid[y][x] ?? "."; if (armMask[y][x]) { a += c; b += "."; } else { a += "."; b += c; } } bodyL.push(b.replace(/\.+$/u, "")); armL.push(a.replace(/\.+$/u, "")); }

writeFileSync(join(__dirname, "base-sprite.json"), JSON.stringify({ w: TW, h: TH, body: bodyL, arm: armL, pivot: piv }));
console.log(`base-sprite.json ${TW}x${TH} pivot ${piv} axis ${ax.toFixed(2)},${ay.toFixed(2)} armCells ${armMask.flat().filter(Boolean).length}`);
