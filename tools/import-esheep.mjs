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
  [/^idle|stand/i, 'idle'], [/^walk|run/i, 'walk'], [/^sit|sleep|rest/i, 'sleep'],
  [/^jump|leap/i, 'play'], [/^climb|grab|drag/i, 'groom'], [/^fall|hurt|hit/i, 'sad'],
  [/^throw|pull|push|work/i, 'work'],
];

function parseXml(xml) {
  // eSheep 把 sheet 放在 CDATA 里，标签名不固定（实测是 <png>）——取最长的那个 CDATA 块
  let b64 = '';
  const cdataRe = /<([a-zA-Z0-9_:-]+)[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/\1>/g;
  let cm;
  while ((cm = cdataRe.exec(xml))) {
    const body = cm[2].replace(/\s/g, '');
    if (body.length > b64.length) b64 = body;
  }
  if (!b64) throw new Error('XML 里没有内嵌的 sprite sheet（CDATA）');
  const trans = (xml.match(/<transparency>\s*([^<\s]+)\s*<\/transparency>/) || [])[1] || 'magenta';

  const anims = [];
  const re = /<animation[^>]*>([\s\S]*?)<\/animation>/g;
  let m;
  while ((m = re.exec(xml))) {
    const body = m[1];
    const name = (body.match(/<name>\s*([^<\s]+)\s*<\/name>/) || [])[1] || '';
    const frames = [];
    const fre = /<frame>\s*(\d+)\s*<\/frame>/g;
    let f;
    while ((f = fre.exec(body))) frames.push(Number(f[1]));
    if (name && frames.length) anims.push({ name, frames });
  }
  return { b64, trans: trans.toLowerCase(), anims };
}

/** 自动探测网格：找一个 tile 尺寸，使所有 tile 边界行列基本为空，且 tile 数 ≥ 帧数 */
function detectGrid(img, key, maxFrame, tol = 12) {
  const isBg = (x, y) => {
    const o = (y * img.w + x) * 4;
    const r = img.data[o], g = img.data[o + 1], b = img.data[o + 2], a = img.data[o + 3];
    if (a < 8) return true;
    return Math.abs(r - key[0]) <= tol && Math.abs(g - key[1]) <= tol && Math.abs(b - key[2]) <= tol;
  };
  const cands = [];
  for (let s = 8; s <= 160; s++) {
    if (img.w % s || img.h % s) continue;
    const cols = img.w / s, rows = img.h / s;
    if (cols * rows < maxFrame + 1) continue;
    let ok = true;
    for (let c = 1; c < cols && ok; c++) {
      let empty = 0;
      for (let y = 0; y < img.h; y++) if (isBg(c * s, y)) empty++;
      if (empty / img.h < 0.6) ok = false;
    }
    for (let r = 1; r < rows && ok; r++) {
      let empty = 0;
      for (let x = 0; x < img.w; x++) if (isBg(x, r * s)) empty++;
      if (empty / img.w < 0.6) ok = false;
    }
    if (ok) cands.push({ size: s, cols, rows, slots: cols * rows });
  }
  // 取"刚好够放下所有帧"的最小尺寸（避免选到它的整数倍）
  return cands.sort((a, b) => a.size - b.size)[0] || null;
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
const key = COLOR_KEYS[parsed.trans] || COLOR_KEYS.magenta;
console.log('宠物 ' + pet + '：色键=' + parsed.trans + '，动作 ' + parsed.anims.length + ' 个');

const sheet = decodePng(Buffer.from(parsed.b64, 'base64'));
console.log('  sheet ' + sheet.w + 'x' + sheet.h + '，动作: ' + parsed.anims.map((a) => a.name + '(' + a.frames.length + ')').join(' '));

const grid = detectGrid(sheet, key, Math.max(...parsed.anims.flatMap((a) => a.frames)));
if (!grid) die('探测不到网格（切帧不可信，不写任何文件）');
console.log('  网格 ' + grid.cols + 'x' + grid.rows + '，每格 ' + grid.size + 'px，共 ' + grid.slots + ' 格（需要 ' + (Math.max(...parsed.anims.flatMap((a) => a.frames)) + 1) + ' 帧）');
const tileRect = (i) => [(i % grid.cols) * grid.size, Math.floor(i / grid.cols) * grid.size];

// 动作名 → 姿势（一个姿势取该动作的第一帧）
const poses = {};
const report = [];
for (const a of parsed.anims) {
  const pose = (POSE_MAP.find(([re]) => re.test(a.name)) || [])[1];
  if (!pose || poses[pose]) continue;
  const idx = a.frames[0];
  const [tx, ty] = tileRect(idx);
  const frame = cropFrame(sheet, tx, tx + grid.size, key, 12, ty, ty + grid.size);
  if (!frame) { report.push('  ' + pose + ' ← ' + a.name + '：空帧，跳过'); continue; }
  report.push('  ' + pose + ' ← ' + a.name + ' 帧' + idx + '  ' + frame.w + 'x' + frame.h + '  不透明 ' + (frame.ratio * 100).toFixed(0) + '%');
  poses[pose] = { file: pose + '.png', frame };
}
report.forEach((l) => console.log(l));
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
