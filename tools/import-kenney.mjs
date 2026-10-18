#!/usr/bin/env node
/**
 * Kenney CC0 素材 → 立绘包 导入器
 * ---------------------------------------------------------------------------
 * 零依赖（只用 node:zlib 手写了 PNG 解码/编码），别人也能直接跑：
 *
 *   # 看某个包里有什么
 *   node tools/import-kenney.mjs --list "Animal Pack"
 *
 *   # 逐帧文件模式：从包里按关键词找 png，生成包
 *   node tools/import-kenney.mjs --pack "Toon Characters/Robot" --id cc0-robot --name "Kenney 机器人（CC0）"
 *
 *   # sprite sheet 模式：切片（1-Bit 那类整张图）
 *   node tools/import-kenney.mjs --pack "1-Bit Platformer Pack" --id cc0-1bit \
 *        --sheet "Tilemap/characters.png" --tile 16x16 --pick idle=0,walk=1,happy=2
 *
 * 素材来源：https://github.com/shorepine/kenney （Kenney 素材，CC0 1.0）
 * 导入后会自动跑 tools/check-packs.mjs 校验。
 * ---------------------------------------------------------------------------
 */
import { inflateSync, deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PACKS_DIR = join(ROOT, 'assets', 'art', 'packs');
const REPO = 'shorepine/kenney';
const API = 'https://api.github.com/repos/' + REPO + '/contents/';

/* ============================ 命令行解析 ============================ */

const BOOL_FLAGS = new Set(['list', 'dry-run', 'no-trim', 'help']);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      // 这几个是开关，不能把后面的位置参数吃掉
      if (BOOL_FLAGS.has(key)) { out[key] = true; continue; }
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const die = (msg) => { console.error('✖ ' + msg); process.exit(1); };

/* ============================ GitHub ============================ */

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (e) { return ''; }
}
const TOKEN = token();

async function ghJson(path) {
  const headers = { 'User-Agent': 'dsh-whale-pixel-pet-importer', Accept: 'application/vnd.github+json' };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const url = API + path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) die('GitHub 限流了，设置 GITHUB_TOKEN 或安装 gh 后重试（' + path + '）');
  if (!res.ok) throw new Error('GitHub ' + res.status + ' @ ' + path);
  return res.json();
}

async function ghFile(path) {
  const j = await ghJson(path);
  if (!j || !j.content) throw new Error('拿不到文件内容: ' + path);
  return Buffer.from(j.content.replace(/\s/g, ''), 'base64');
}

async function listDir(path) {
  try { return await ghJson(path); } catch (e) { return []; }
}

/** 递归找出某目录下所有 png（相对仓库的完整路径） */
async function findPngs(base, depth = 0) {
  if (depth > 3) return [];
  const entries = await listDir(base);
  const out = [];
  for (const e of entries) {
    const p = base + '/' + e.name;
    if (e.type === 'dir') out.push(...await findPngs(p, depth + 1));
    else if (/\.png$/i.test(e.name)) out.push(p);
  }
  return out;
}

/* ============================ PNG 编解码（手写，无依赖） ============================ */

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** 解出 RGBA8 像素。支持 colorType 0/2/3/4/6，bit depth 1/2/4/8/16（16 按高 8 位处理）。 */
function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504E47) die('不是 PNG 文件');
  let pos = 8, ihdr = null, plte = null, trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr) die('PNG 缺少 IHDR');
  if (ihdr.interlace) die('暂不支持隔行扫描（Adam7）PNG');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.color];
  if (!channels) die('不支持的 PNG 颜色类型: ' + ihdr.color);
  const depth = ihdr.depth;
  const stride = Math.ceil(ihdr.w * channels * depth / 8);
  const bpp = Math.max(1, Math.ceil(channels * depth / 8));
  const raw = inflateSync(Buffer.concat(idat));

  // 反过滤
  const img = Buffer.alloc(stride * ihdr.h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < ihdr.h; y++) {
    const ft = raw[y * (stride + 1)];
    const cur = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      if (ft === 1) cur[x] = (cur[x] + a) & 255;
      else if (ft === 2) cur[x] = (cur[x] + b) & 255;
      else if (ft === 3) cur[x] = (cur[x] + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        cur[x] = (cur[x] + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c))) & 255;
      }
    }
    cur.copy(img, y * stride);
    prev = cur;
  }

  // 展开成 RGBA8
  const rgba = Buffer.alloc(ihdr.w * ihdr.h * 4);
  const sample = (x, y, ch) => {
    const bitIndex = (y * ihdr.w + x) * channels * depth + ch * depth;
    if (depth === 8) return img[y * stride + (x * channels + ch)];
    if (depth === 16) return img[y * stride + (x * channels + ch) * 2];   // 取高字节
    const byte = img[y * stride + (bitIndex >> 3)];
    const shift = 8 - depth - (bitIndex & 7);
    const mask = (1 << depth) - 1;
    return (byte >> shift) & mask;
  };

  for (let y = 0; y < ihdr.h; y++) {
    for (let x = 0; x < ihdr.w; x++) {
      const o = (y * ihdr.w + x) * 4;
      let r = 0, g = 0, b = 0, a = 255;
      if (ihdr.color === 6) { r = sample(x, y, 0); g = sample(x, y, 1); b = sample(x, y, 2); a = sample(x, y, 3); }
      else if (ihdr.color === 2) { r = sample(x, y, 0); g = sample(x, y, 1); b = sample(x, y, 2); }
      else if (ihdr.color === 0 || ihdr.color === 4) { r = g = b = sample(x, y, 0); if (ihdr.color === 4) a = sample(x, y, 1); }
      else if (ihdr.color === 3) {
        const idx = sample(x, y, 0);
        if (plte && idx * 3 + 2 < plte.length) { r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2]; }
        if (trns && idx < trns.length) a = trns[idx];
      }
      if (depth < 8 && ihdr.color !== 3) a = Math.round(a * 255 / ((1 << depth) - 1));   // 低bit灰度铺满
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
    }
  }
  return { w: ihdr.w, h: ihdr.h, data: rgba };
}

function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;                                   // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ============================ 切图 ============================ */

/** 从图上裁一块；trim=true 时去掉四周全透明的边（让锚点贴到底部） */
function crop(sheet, sx, sy, w, h, trim) {
  let x0 = sx, y0 = sy, x1 = sx + w, y1 = sy + h;
  if (trim) {
    const solid = (x, y) => sheet.data[(y * sheet.w + x) * 4 + 3] > 8;
    let minX = x1, minY = y1, maxX = -1, maxY = -1;
    for (let y = sy; y < y1; y++) {
      for (let x = sx; x < x1; x++) {
        if (solid(x, y)) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;                       // 整块透明 → 这张是空的
    x0 = minX; y0 = minY; x1 = maxX + 1; y1 = maxY + 1;
  }
  const cw = x1 - x0, ch = y1 - y0;
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    sheet.data.copy(out, y * cw * 4, ((y0 + y) * sheet.w + x0) * 4, ((y0 + y) * sheet.w + x1) * 4);
  }
  return { w: cw, h: ch, data: out };
}

/* ============================ 主流程 ============================ */

const POSE_KEYS = {
  idle: /idle|stand|front/i, walk: /walk/i, happy: /cheer|happy|smile|jump/i,
  sleep: /duck|sleep|crouch/i, play: /jump|attack|hit|climb/i, sad: /hit|hurt|sad/i,
  work: /walk|run/i, groom: /climb|push/i,
};

async function main() {
  const pack = args.pack || args._[0];
  if (!pack) die('用法见文件头注释；至少要给 --pack "<Kenney 包名>"');

  // ---- 列目录模式 ----
  if (args.list) {
    const pngs = await findPngs('2d/' + pack);
    console.log('2d/' + pack + ' 下有 ' + pngs.length + ' 张 png：');
    pngs.slice(0, 60).forEach((p) => console.log('  ' + p.replace('2d/' + pack + '/', '')));
    if (pngs.length > 60) console.log('  …还有 ' + (pngs.length - 60) + ' 张');
    return;
  }

  const id = String(args.id || '').trim();
  if (!id) die('缺 --id（皮肤目录名，建议 CC0 的用 cc0- 开头，自用的用 local- 开头）');
  const name = String(args['name'] || id);
  const dryRun = !!args['dry-run'];
  const destDir = join(PACKS_DIR, id);
  const poses = {};

  if (args.sheet) {
    // ---- sprite sheet 模式 ----
    const tile = String(args.tile || '16x16').split('x').map(Number);
    if (tile.length !== 2 || !tile[0] || !tile[1]) die('--tile 要写成 16x16');
    const sheetPath = '2d/' + pack + '/' + args.sheet;
    console.log('下载 sheet: ' + sheetPath);
    const sheet = decodePng(await ghFile(sheetPath));
    const cols = Math.floor(sheet.w / tile[0]);
    const rows = Math.floor(sheet.h / tile[1]);
    console.log('  尺寸 ' + sheet.w + 'x' + sheet.h + ' → 网格 ' + cols + 'x' + rows + '（每格 ' + tile[0] + 'x' + tile[1] + '）');
    if (cols < 1 || rows < 1) die('格子比图还大，检查 --tile');

    // --pick idle=0,walk=3 ；不给就自动挑"最像角色"的几格
    let picks = {};
    if (typeof args.pick === 'string') {
      for (const part of args.pick.split(',')) {
        const [k, v] = part.split('=');
        if (k && v !== undefined) picks[k.trim()] = Number(v);
      }
    } else {
      const candidates = [];
      for (let i = 0; i < cols * rows; i++) {
        const c = crop(sheet, (i % cols) * tile[0], Math.floor(i / cols) * tile[1], tile[0], tile[1], true);
        if (c && c.w >= tile[0] * 0.4 && c.h >= tile[1] * 0.6) candidates.push(i);   // 够大、像个人形
      }
      console.log('  自动挑格：' + candidates.slice(0, 6).join(', '));
      ['idle', 'walk', 'happy', 'sleep', 'play', 'sad'].forEach((k, n) => { if (candidates[n] !== undefined) picks[k] = candidates[n]; });
    }
    if (picks.idle === undefined) die('没能确定 idle 是第几格，请用 --pick idle=0,walk=3 指定');

    for (const k of Object.keys(picks)) {
      const i = picks[k];
      const c = crop(sheet, (i % cols) * tile[0], Math.floor(i / cols) * tile[1], tile[0], tile[1], !args['no-trim']);
      if (!c) { console.log('  跳过 ' + k + '（第 ' + i + ' 格是空的）'); continue; }
      const file = k + '.png';
      poses[k] = file;
      if (!dryRun) { mkdirSync(destDir, { recursive: true }); writeFileSync(join(destDir, file), encodePng(c.w, c.h, c.data)); }
      console.log('  ' + k + ' ← 第 ' + i + ' 格  ' + c.w + 'x' + c.h);
    }
  } else {
    // ---- 逐帧文件模式 ----
    const pngs = await findPngs('2d/' + pack);
    console.log('2d/' + pack + ' 下有 ' + pngs.length + ' 张 png');
    if (!pngs.length) die('这个包里没有 png（也许它在 3d/ 或 ui/ 下）');
    if (typeof args.pose === 'string') {
      for (const part of args.pose.split(',')) {
        const [k, v] = part.split('=');
        if (k && v !== undefined) {
          const hit = pngs.find((p) => p.toLowerCase().endsWith('/' + v.toLowerCase()) || p.toLowerCase() === v.toLowerCase());
          if (!hit) { console.log('  找不到 ' + v + '（' + k + '）'); continue; }
          poses[k.trim()] = hit;
        }
      }
    } else {
      const limit = Number(args.limit || 6);
      for (const k of Object.keys(POSE_KEYS)) {
        if (Object.keys(poses).length >= limit) break;
        const hit = pngs.find((p) => POSE_KEYS[k].test(p.split('/').pop()) && !/background|outline|skeleton/i.test(p));
        if (hit) poses[k] = hit;
      }
      if (!poses.idle) {
        const first = pngs.find((p) => !/background|outline|skeleton|tile|hexagon/i.test(p));
        if (first) poses.idle = first;
      }
    }
    if (!poses.idle) die('没能确定 idle 用哪张，请用 --pose idle=xxx.png');
    for (const k of Object.keys(poses)) {
      const rel = poses[k].replace('2d/' + pack + '/', '');
      console.log('  ' + k + ' ← ' + rel);
      if (!dryRun) {
        mkdirSync(destDir, { recursive: true });
        writeFileSync(join(destDir, k + '.png'), await ghFile(poses[k]));
      }
    }
  }

  if (dryRun) { console.log('\n（--dry-run：没有写任何文件）'); return; }

  const manifest = {
    name,
    author: 'Kenney (kenney.nl) — CC0',
    poses: Object.fromEntries(Object.keys(poses).map((k) => [k, k + '.png'])),
    hints: {},
  };
  writeFileSync(join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('\n已写入 ' + destDir);

  // 自动校验
  try {
    const out = execFileSync(process.execPath, [join(HERE, 'check-packs.mjs')], { encoding: 'utf8' });
    console.log(out.trim().split('\n').slice(-2).join('\n'));
  } catch (e) {
    console.error('校验没通过：\n' + (e.stdout || e.message));
    process.exit(1);
  }
}

main().catch((e) => { console.error('✖ ' + (e && e.message)); process.exit(1); });
