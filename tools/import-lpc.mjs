#!/usr/bin/env node
/**
 * LPC 角色生成器：把多层（身体 + 头发 + 衣服…）合成一个角色皮肤
 * ---------------------------------------------------------------------------
 * LPC 的角色不是整张图，而是**多层同名动画 sheet 叠出来的**。
 * 本工具按发现式路径找图层（自己列目录），alpha 合成，再取"朝向观众"的首帧。
 *
 * 用法：
 *   node tools/import-lpc.mjs --list
 *   node tools/import-lpc.mjs --id cc-by-sa-lpc-hero2 --name "LPC 冒险者 2"
 *   node tools/import-lpc.mjs --id x --hair none --dry-run
 *
 * 素材：Universal LPC Spritesheet Character Generator（CC-BY-SA 3.0 / GPL 3.0）
 * 该目录图片保持 CC-BY-SA，不适用仓库 MIT（合法的混合授权）。
 * ---------------------------------------------------------------------------
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PACKS = join(ROOT, 'assets', 'art', 'packs');
const REPO = 'LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator';
const API = 'https://api.github.com/repos/' + REPO + '/contents/';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2), v = process.argv[i + 1];
    if (v === undefined || v.startsWith('--')) args[k] = true;
    else { args[k] = v; i++; }
  }
}
const die = (m) => { console.error('✖ ' + m); process.exit(1); };
const TOKEN = process.env.GITHUB_TOKEN || (() => {
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return ''; }
})();

async function ghJson(p) {
  const headers = { 'User-Agent': 'dsh-whale-pixel-pet', Accept: 'application/vnd.github+json' };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const res = await fetch(API + p.split('/').map(encodeURIComponent).join('/'), { headers });
  if (!res.ok) throw new Error('GitHub ' + res.status + ' @ ' + p);
  return res.json();
}
async function ghPng(p) {
  const j = await ghJson(p);
  return Buffer.from(String(j.content || '').replace(/\s/g, ''), 'base64');
}
async function listNames(p) {
  try { return (await ghJson(p)).map((e) => ({ name: e.name, dir: e.type === 'dir' })); }
  catch (e) { return []; }
}

/** alpha 叠加：dst 在下，src 在上 */
function over(dst, src) {
  if (!dst) return src;
  if (!src || src.w !== dst.w || src.h !== dst.h) return dst;
  const out = Buffer.from(dst.data);
  for (let i = 0; i < out.length; i += 4) {
    const sa = src.data[i + 3] / 255;
    if (sa === 0) continue;
    const da = out[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa === 0) continue;
    for (let c = 0; c < 3; c++) {
      out[i + c] = Math.round((src.data[i + c] * sa + out[i + c] * da * (1 - sa)) / oa);
    }
    out[i + 3] = Math.round(oa * 255);
  }
  return { w: dst.w, h: dst.h, data: out };
}

const { decodePng, encodePng } = await import('./import-kenney.mjs');
// 注意：不要 import import-esheep.mjs —— 它没有"被导入时不执行"的守卫，
// 一导入就会跑它的 CLI 并 die 掉当前进程。

/** 取"朝向观众"那一行的首帧并裁掉透明边 */
function pickFront(sheet) {
  const tile = 64;
  const cols = Math.floor(sheet.w / tile), rows = Math.floor(sheet.h / tile);
  if (cols < 1 || rows < 1) return null;
  const row = Math.min(2, rows - 1);
  const x0 = 0, y0 = row * tile;
  let minX = sheet.w, minY = sheet.h, maxX = -1, maxY = -1;
  for (let y = y0; y < y0 + tile; y++) {
    for (let x = x0; x < x0 + tile; x++) {
      if (sheet.data[(y * sheet.w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    sheet.data.copy(out, y * w * 4, ((minY + y) * sheet.w + minX) * 4, ((minY + y) * sheet.w + minX + w) * 4);
  }
  let opaque = 0;
  for (let i = 3; i < out.length; i += 4) if (out[i] > 8) opaque++;
  return { w, h, data: out, ratio: opaque / (w * h) };
}

/** 发现式：从某个根目录往下找到第一个含目标动画文件的层（prefer 里的名字优先） */
async function findLayer(root, anim, prefer = []) {
  const lvl1 = await listNames(root);
  const dirs = lvl1.filter((e) => e.dir).slice().sort((a, b) => {
    const ia = prefer.findIndex((p) => a.name.toLowerCase().startsWith(p));
    const ib = prefer.findIndex((p) => b.name.toLowerCase().startsWith(p));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const a of dirs) {
    const lvl2 = await listNames(root + '/' + a.name);
    const direct = lvl2.find((e) => !e.dir && e.name === anim + '.png');
    if (direct) return { path: root + '/' + a.name + '/' + anim + '.png', label: a.name };
    for (const b of lvl2.filter((e) => e.dir)) {
      const lvl3 = await listNames(root + '/' + a.name + '/' + b.name);
      const hit = lvl3.find((e) => !e.dir && e.name === anim + '.png');
      if (hit) return { path: root + '/' + a.name + '/' + b.name + '/' + anim + '.png', label: a.name + '/' + b.name };
      const png = lvl3.find((e) => !e.dir && e.name.endsWith('.png'));
      if (png) return { path: root + '/' + a.name + '/' + b.name + '/' + png.name, label: a.name + '/' + b.name + '/' + png.name };
    }
  }
  return null;
}

if (args.list) {
  for (const p of ['spritesheets', 'spritesheets/body', 'spritesheets/hair', 'spritesheets/torso', 'spritesheets/legs']) {
    const n = await listNames(p);
    console.log(p + '：' + n.filter((e) => e.dir).map((e) => e.name).join(', ').slice(0, 160));
  }
  process.exit(0);
}

const id = String(args.id || '');
if (!id) die('要 --id <皮肤目录名>（--list 可看有哪些层）');
const name = String(args.name || ('LPC 角色 ' + id));
const dryRun = !!args['dry-run'];

// 动画 → 姿势（缺的自动回落内置立绘）
const ANIMS = [['idle', 'idle'], ['run', 'walk'], ['sit', 'sleep'], ['emote', 'happy'], ['jump', 'play']];

const layers = [];
const body = await findLayer('spritesheets/body/bodies', 'idle', ['male', 'female', 'teen', 'muscular']);
if (body) layers.push({ kind: 'body', root: body.path.replace(/\/idle\.png$/, ''), label: body.label });
if (args.hair !== 'none') {
  const hair = await findLayer('spritesheets/hair', 'idle');
  if (hair) layers.push({ kind: 'hair', root: hair.path.replace(/\/[^/]+$/, ''), label: hair.label });
}
const torso = await findLayer('spritesheets/torso/clothes', 'idle') || await findLayer('spritesheets/torso', 'idle');
if (torso) layers.push({ kind: 'torso', root: torso.path.replace(/\/[^/]+$/, ''), label: torso.label });
if (!layers.length) die('一层都没找到（--list 看看结构）');
console.log('图层：' + layers.map((l) => l.kind + '(' + l.label + ')').join(' + '));

const poses = {};
const report = [];
for (const [anim, pose] of ANIMS) {
  let composed = null;
  for (const layer of layers) {
    const candidates = [layer.root + '/' + anim + '.png'];
    if (layer.kind === 'hair' || layer.kind === 'torso') {
      // 头发/衣服的目录结构可能是 <风格>/<颜色>.png，此时动画名在上一层
      candidates.push(layer.root.replace(/\/[^/]+$/, '') + '/' + anim + '.png');
    }
    let buf = null;
    for (const c of candidates) {
      try { buf = await ghPng(c); break; } catch (e) { /* 试下一个 */ }
    }
    if (!buf) continue;
    try { composed = over(composed, decodePng(buf)); } catch (e) { /* 跳过坏层 */ }
  }
  if (!composed) { report.push('  ' + pose + ' ← ' + anim + '：没合成出来'); continue; }
  const frame = pickFront(composed);
  if (!frame) { report.push('  ' + pose + ' ← ' + anim + '：空帧'); continue; }
  poses[pose] = { file: pose + '.png', frame };
  report.push('  ' + pose + ' ← ' + anim + '  ' + frame.w + 'x' + frame.h + '  不透明 ' + (frame.ratio * 100).toFixed(0) + '%');
}
report.forEach((l) => console.log(l));
if (!poses.idle) die('没合成出 idle');
if (Object.keys(poses).length < 3) die('只有 ' + Object.keys(poses).length + ' 个姿势（少于 3 会画风跳变，不做）');
if (dryRun) { console.log('（--dry-run：没写文件）'); process.exit(0); }

const dir = join(PACKS, id);
mkdirSync(dir, { recursive: true });
for (const k of Object.keys(poses)) writeFileSync(join(dir, poses[k].file), encodePng(poses[k].frame.w, poses[k].frame.h, poses[k].frame.data));
writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
  name, author: 'Liberated Pixel Cup 贡献者 — CC-BY-SA 3.0',
  poses: Object.fromEntries(Object.keys(poses).map((k) => [k, k + '.png'])), hints: {},
}, null, 2) + '\n', 'utf8');
writeFileSync(join(dir, 'LICENSE-CC-BY-SA.txt'),
  '本目录图片由 LPC 多层素材合成（' + layers.map((l) => l.kind + ':' + l.label).join(' + ') + '）。\n' +
  '来源：https://github.com/' + REPO + ' （Liberated Pixel Cup 社群作品）\n' +
  '许可：CC-BY-SA 3.0 / GPL 3.0（此处按 CC-BY-SA 3.0 使用）。本目录图片及其修改版保持 CC-BY-SA，不适用仓库 MIT。\n', 'utf8');
console.log('已写入 ' + dir);
try {
  const out = execFileSync(process.execPath, [join(HERE, 'check-packs.mjs')], { encoding: 'utf8' });
  console.log(out.trim().split('\n').slice(-2).join('\n'));
} catch (e) { console.error('校验没通过：\n' + (e.stdout || e.message)); process.exit(1); }
