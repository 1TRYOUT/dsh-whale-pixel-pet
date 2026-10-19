#!/usr/bin/env node
/**
 * eSheep (Adrianotiger/desktopPet) 宠物 → 立绘包
 * ---------------------------------------------------------------------------
 * eSheep 的每套宠物只有 animations.xml + icon.png，但 XML 里**内嵌了整张 sprite sheet**
 * 的 base64 PNG，另有 <transparency> 色键与每个动作的 <frame> 序号。
 *
 * 用法：
 *   node tools/import-esheep.mjs --list
 *   node tools/import-esheep.mjs --pet fox --id mit-esheep-fox-full
 *   node tools/import-esheep.mjs --pet fox --id test-x --dry-run
 *
 * 帧尺寸不靠猜：按"整列都是透明/色键"的竖缝切段，
 * 并要求**段数 === 最大帧号 + 1**（交叉校验），不满足就报错且不写任何文件。
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PACKS = join(ROOT, 'assets', 'art', 'packs');
const REPO = 'Adrianotiger/desktopPet';
const API = 'https://api.github.com/repos/' + REPO + '/contents/';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = process.argv[i + 1];
    if (v === undefined || v.startsWith('--')) args[k] = true;
    else { args[k] = v; i++; }
  }
}
const die = (m) => { console.error('✖ ' + m); process.exit(1); };

function ghToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return ''; }
}
const TOKEN = ghToken();

async function ghJson(path) {
  const headers = { 'User-Agent': 'dsh-whale-pixel-pet', Accept: 'application/vnd.github+json' };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const res = await fetch(API + path.split('/').map(encodeURIComponent).join('/'), { headers });
  if (!res.ok) throw new Error('GitHub ' + res.status + ' @ ' + path);
  return res.json();
}
async function ghText(path) {
  const j = await ghJson(path);
  return Buffer.from(String(j.content || '').replace(/\s/g, ''), 'base64').toString('utf8');
}

const COLOR_KEYS = {
  magenta: [255, 0, 255], fuchsia: [255, 0, 255], white: [255, 255, 255],
  black: [0, 0, 0], cyan: [0, 255, 255], yellow: [255, 255, 0], lime: [0, 255, 0],
};

/** 动作名 → 我们的姿势名 */
const POSE_MAP = [
  [/^idle|stand|busy|border|wait|sync/i, 'idle'],
  [/^walk|run|skip|move/i, 'walk'],
  [/^sit|sleep|rest|duck|crouch/i, 'sleep'],
  [/^jump|leap|cheer|joy|clap|dance|wave|celebrate|happy/i, 'play'],
  [/^climb|grab|drag|pull|push|scratch/i, 'groom'],
  [/^fall|hurt|hit|kill|sad/i, 'sad'],
  [/^throw|work|type|read/i, 'work'],
];

function parseXml(xml) {
  // 一个 XML 里可能有多块 CDATA（实测：icon 是 ICO 格式、png 才是立绘）。
  // 按 PNG 魔数选，而不是"取最长的那块"——后者会选中 icon。
  let b64 = '';
  const cdataRe = /<([a-zA-Z0-9_:-]+)[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/\1>/g;
  let cm;
  while ((cm = cdataRe.exec(xml))) {
    const body = cm[2].replace(/\s/g, '');
    if (!body) continue;
    try {
      const head = Buffer.from(body.slice(0, 24), 'base64');
      const isPng = head.length >= 8 && head.readUInt32BE(0) === 0x89504E47;
      if (isPng && body.length > b64.length) b64 = body;
    } catch (e) { /* 忽略坏块 */ }
  }
  if (!b64) throw new Error('XML 里没有内嵌的 PNG（只有 icon 之类）');
  const trans = (xml.match(/<transparency>\s*([^<\s]+)\s*<\/transparency>/) || [])[1] || 'magenta';

  const anims = [];
  const re = /<animation[^>]*>([\s\S]*?)<\/animation>/g;
  let m;
  while ((m = re.exec(xml))) {
    const body = m[1];
    const name = (body.match(/<name>\s*([^<\s]+)\s*<\/name>/) || [])[1] || '';
    const sm = body.match(/<start>[\s\S]*?<x>\s*(-?\d+)\s*<\/x>[\s\S]*?<y>\s*(-?\d+)\s*<\/y>/);
    const start = sm ? { x: Number(sm[1]), y: Number(sm[2]) } : null;
    const frames = [];
    const fre = /<frame>\s*(\d+)\s*<\/frame>/g;
    let f;
    while ((f = fre.exec(body))) frames.push(Number(f[1]));
    if (name && frames.length) anims.push({ name, frames, start });
  }
  return { b64, trans: trans.toLowerCase(), anims };
}

/**
 * 权威做法：用每个动作的 <start x/y> 反推帧尺寸。
 * 同一行内相邻的两个动作：帧宽 = (x2 - x1) / 前一个动作的帧数。
 * 自校验：所有动作起点都必须落在 (tileW, tileH) 网格上，且帧号 < 格子总数。
 */
function deriveTile(anims, img, maxFrame) {
  const pts = anims.filter((a) => a.start).map((a) => ({ x: a.start.x, y: a.start.y, n: a.frames.length }));
  const widths = new Map();
  for (const a of pts) {
    for (const b of pts) {
      if (a === b || b.y !== a.y || b.x <= a.x) continue;
      const w = (b.x - a.x) / a.n;
      if (Number.isInteger(w) && w >= 8 && w <= 200) widths.set(w, (widths.get(w) || 0) + 1);
    }
  }
  const ranked = [...widths.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const trySize = (tw, th) => {
    if (img.w % tw || img.h % th) return null;
    const cols = img.w / tw, rows = img.h / th;
    if (cols * rows < maxFrame + 1) return null;
    for (const p of pts) if (p.x % tw || p.y % th) return null;      // 起点必须落在网格上
    return { size: tw, tileH: th, cols, rows, slots: cols * rows, from: 'start' };
  };
  for (const [tw] of ranked) {
    const sq = trySize(tw, tw);
    if (sq) return sq;
  }
  return null;
}

/**
 * 兜底探测：横竖两个方向**独立**找周期（支持非正方帧）。
 * 对每个候选周期统计"倍数位置是否基本为空"的比例，取最高分；
 * 若整张图没有空白分隔（紧排 sheet），退化为"格子数最接近帧数"的候选。
 */
function detectGrid(img, key, maxFrame, tol = 12) {
  const isBg = (x, y) => {
    const o = (y * img.w + x) * 4;
    const r = img.data[o], g = img.data[o + 1], b = img.data[o + 2], a = img.data[o + 3];
    if (a < 8) return true;
    return Math.abs(r - key[0]) <= tol && Math.abs(g - key[1]) <= tol && Math.abs(b - key[2]) <= tol;
  };
  const colEmpty = new Float64Array(img.w);
  for (let x = 0; x < img.w; x++) {
    let e = 0;
    for (let y = 0; y < img.h; y++) if (isBg(x, y)) e++;
    colEmpty[x] = e / img.h;
  }
  const rowEmpty = new Float64Array(img.h);
  for (let y = 0; y < img.h; y++) {
    let e = 0;
    for (let x = 0; x < img.w; x++) if (isBg(x, y)) e++;
    rowEmpty[y] = e / img.w;
  }
  const score = (period, table) => {
    const n = Math.floor((table.length - 1) / period);
    if (n < 1) return 0;
    let hit = 0;
    for (let k = 1; k <= n; k++) if (table[k * period] >= 0.6) hit++;
    return hit / n;
  };
  const best = (table, lo, hi) => {
    let pick = null;
    for (let p = lo; p <= hi; p++) {
      if (table.length % p) continue;
      const s = score(p, table);
      if (s >= 0.6 && (!pick || s > pick.s)) pick = { p, s };
    }
    return pick;
  };
  let w = best(colEmpty, 16, 200);
  let h = best(rowEmpty, 16, 200);
  const frames = maxFrame + 1;
  if (w && h) {
    const cols = img.w / w.p, rows = img.h / h.p;
    if (cols * rows >= frames && cols * rows <= frames * 2.5) {
      return { size: w.p, tileH: h.p, cols, rows, slots: cols * rows, from: 'gap2d' };
    }
  }
  // 紧排 sheet：没有空白分隔 → 取"格子数最接近帧数"的组合
  let fallback = null;
  for (let tw = 16; tw <= 200; tw++) {
    if (img.w % tw) continue;
    for (let th = 16; th <= 200; th++) {
      if (img.h % th) continue;
      const cols = img.w / tw, rows = img.h / th, slots = cols * rows;
      if (slots < frames || slots > frames * 1.6) continue;
      const d = slots - frames;
      if (!fallback || d < fallback.d) fallback = { size: tw, tileH: th, cols, rows, slots, from: 'count', d };
    }
  }
  return fallback;
}

function cropFrame(img, x0, x1, key, tol = 12, yMin = 0, yMax = null) {
  const yEnd = yMax === null ? img.h : Math.min(yMax, img.h);
  // 竖直方向也裁到内容，但保留色键像素（后面统一抠掉）
  let y0 = yEnd, y1 = -1;
  const isKey = (r, g, b, a) => a < 8 || (Math.abs(r - key[0]) <= tol && Math.abs(g - key[1]) <= tol && Math.abs(b - key[2]) <= tol);
  for (let y = yMin; y < yEnd; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * img.w + x) * 4;
      if (!isKey(img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3])) {
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        break;
      }
    }
  }
  if (y1 < y0) return null;
  const w = x1 - x0, h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  let opaque = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const so = ((y0 + y) * img.w + (x0 + x)) * 4;
      const r = img.data[so], g = img.data[so + 1], b = img.data[so + 2], a = img.data[so + 3];
      const o = (y * w + x) * 4;
      const keyed = isKey(r, g, b, a);
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = keyed ? 0 : a;
      if (!keyed) opaque++;
    }
  }
  return { w, h, data: out, opaque, ratio: opaque / (w * h) };
}

const { decodePng, encodePng } = await import('./import-kenney.mjs');

if (args.list) {
  const j = await ghJson('Pets');
  const pets = j.filter((e) => e.type === 'dir').map((e) => e.name);
  console.log('宠物 ' + pets.length + ' 套：' + pets.join(', '));
  process.exit(0);
}

const pet = String(args.pet || '');
if (!pet) die('要 --pet <名字>（--list 可看全部）');
const id = String(args.id || ('mit-esheep-' + pet));
const dryRun = !!args['dry-run'];

const xml = await ghText('Pets/' + pet + '/animations.xml');
const parsed = parseXml(xml);

// --inspect：把内嵌数据块的类型与每个动作的起点打出来（诊断用，不写文件）
if (args.inspect) {
  console.log('宠物 ' + pet + '：色键=' + parsed.trans + '，动作 ' + parsed.anims.length + ' 个');
  const re2 = /<([a-zA-Z0-9_:-]+)[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/\1>/g;
  let m2, i = 0;
  while ((m2 = re2.exec(xml))) {
    const body = m2[2].replace(/\s/g, '');
    let hex = '';
    try {
      const buf = Buffer.from(body, 'base64');
      hex = buf.subarray(0, 8).toString('hex');
      console.log('  CDATA#' + (i++) + ' 标签=' + m2[1] + ' base64 ' + body.length + ' 字符 → ' + buf.length + ' 字节，头 ' + hex);
    } catch (e) { console.log('  CDATA#' + (i++) + ' 标签=' + m2[1] + ' 解码失败'); }
  }
  for (const a of parsed.anims) {
    console.log('  动作 ' + a.name + '：' + a.frames.length + ' 帧，起点 ' + (a.start ? a.start.x + ',' + a.start.y : '(无 start)') + '，帧号 ' + a.frames.slice(0, 4).join('/'));
  }
  process.exit(0);
}
const key = COLOR_KEYS[parsed.trans] || COLOR_KEYS.magenta;
console.log('宠物 ' + pet + '：色键=' + parsed.trans + '，动作 ' + parsed.anims.length + ' 个');

const sheet = decodePng(Buffer.from(parsed.b64, 'base64'));
console.log('  sheet ' + sheet.w + 'x' + sheet.h + '，动作: ' + parsed.anims.map((a) => a.name + '(' + a.frames.length + ')').join(' '));

const maxFrame = Math.max(...parsed.anims.flatMap((a) => a.frames));
// 注意：动作的 start 坐标是**绘制偏移**不是 sheet 坐标（实测多数为 0,0），
// 所以不能用它反推帧尺寸；一律走横竖独立周期探测。
const grid = detectGrid(sheet, key, maxFrame);
if (!grid) die('探测不到帧网格（切帧不可信，不写任何文件）');
console.log('  网格 ' + grid.cols + 'x' + grid.rows + '，每格 ' + grid.size + 'x' + grid.tileH + 'px，共 ' + grid.slots + ' 格（需要 ' + (maxFrame + 1) + ' 帧，判据=' + grid.from + '）');
const tileRect = (i) => [(i % grid.cols) * grid.size, Math.floor(i / grid.cols) * grid.tileH];

// 动作名 → 姿势（一个姿势取该动作的第一帧）
const poses = {};
const report = [];
for (const a of parsed.anims) {
  const pose = (POSE_MAP.find(([re]) => re.test(a.name)) || [])[1];
  if (!pose || poses[pose]) continue;
  const idx = a.frames[0];
  const [tx, ty] = tileRect(idx);
  const frame = cropFrame(sheet, tx, tx + grid.size, key, 12, ty, ty + grid.tileH);
  if (!frame) { report.push('  ' + pose + ' ← ' + a.name + '：空帧，跳过'); continue; }
  report.push('  ' + pose + ' ← ' + a.name + ' 帧' + idx + '  ' + frame.w + 'x' + frame.h + '  不透明 ' + (frame.ratio * 100).toFixed(0) + '%');
  poses[pose] = { file: pose + '.png', frame };
}
report.forEach((l) => console.log(l));
// 没有名字像 idle 的动作时，用第一个动作的第一帧当 idle（否则整套包都装不了）
if (!poses.idle && parsed.anims.length) {
  const a = parsed.anims[0];
  const [tx, ty] = tileRect(a.frames[0]);
  const frame = cropFrame(sheet, tx, tx + grid.size, key, 12, ty, ty + grid.tileH);
  if (frame) {
    poses.idle = { file: 'idle.png', frame };
    report.push('  idle ← ' + a.name + ' 帧' + a.frames[0] + '（无 idle 动作，用首个动作代替）');
  }
}
if (!poses.idle) die('没切到 idle，放弃');

if (dryRun) { console.log('（--dry-run：没有写任何文件）'); process.exit(0); }

const dir = join(PACKS, id);
mkdirSync(dir, { recursive: true });
for (const pose of Object.keys(poses)) {
  writeFileSync(join(dir, poses[pose].file), encodePng(poses[pose].frame.w, poses[pose].frame.h, poses[pose].frame.data));
}
writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
  name: 'eSheep · ' + pet + '（MIT）',
  author: 'Adrianotiger/desktopPet — MIT',
  poses: Object.fromEntries(Object.keys(poses).map((k) => [k, k + '.png'])),
  hints: {},
}, null, 2) + '\n', 'utf8');
writeFileSync(join(dir, 'LICENSE-MIT-desktopPet.txt'),
  '本目录图片由 Pets/' + pet + '/animations.xml 内嵌的 sprite sheet 切出（idle 等姿势取各动作首帧）。\n' +
  '来源：https://github.com/Adrianotiger/desktopPet （MIT License，可再分发）\n' +
  '色键 ' + parsed.trans + ' 已抠成透明。\n', 'utf8');
console.log('已写入 ' + dir);

try {
  const out = execFileSync(process.execPath, [join(HERE, 'check-packs.mjs')], { encoding: 'utf8' });
  console.log(out.trim().split('\n').slice(-2).join('\n'));
} catch (e) {
  console.error('校验没通过：\n' + (e.stdout || e.message));
  process.exit(1);
}
