/**
 * 切片与 PNG 编解码单测
 * 运行：node --test test/slice.test.mjs
 *
 * 为什么不用外部素材：工具切片路径的可信度不该依赖"网上能不能下到 sheet"。
 * 这里用工具自己的编码器造一张**已知内容**的合成 sheet，再切回来逐像素比对——
 * 于是解码、网格计算、裁剪、trim、再编码整条链路都被钉死了。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..');
const TOOL = join(ROOT, 'tools', 'import-kenney.mjs');
const lib = await import('../tools/import-kenney.mjs');
const { decodePng, encodePng, crop } = lib;

/** 造一张 sheet：cols×rows 个 tile，每个 tile 内缩 1px 画纯色方块（留透明边，用来验 trim） */
function makeSheet(tiles, cols, tile) {
  const rows = Math.ceil(tiles.length / cols);
  const w = cols * tile, h = rows * tile;
  const data = Buffer.alloc(w * h * 4);              // 全透明
  tiles.forEach((color, i) => {
    const cx = (i % cols) * tile, cy = Math.floor(i / cols) * tile;
    for (let y = cy + 1; y < cy + tile - 1; y++) {
      for (let x = cx + 1; x < cx + tile - 1; x++) {
        const o = (y * w + x) * 4;
        data[o] = color[0]; data[o + 1] = color[1]; data[o + 2] = color[2]; data[o + 3] = 255;
      }
    }
  });
  return { w, h, data };
}
const px = (img, x, y) => {
  const o = (y * img.w + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
};

/* ============================ 编解码 ============================ */

test('PNG：编码再解码，像素完全一致（含透明通道）', () => {
  const src = makeSheet([[255, 0, 0], [0, 255, 0]], 2, 8);
  const round = decodePng(encodePng(src.w, src.h, src.data));
  assert.equal(round.w, src.w);
  assert.equal(round.h, src.h);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      assert.deepEqual(px(round, x, y), px(src, x, y), `像素 (${x},${y})`);
    }
  }
});

test('PNG：解得出我们自己写出来的 1x1 图', () => {
  const one = { w: 1, h: 1, data: Buffer.from([10, 20, 30, 255]) };
  const back = decodePng(encodePng(1, 1, one.data));
  assert.deepEqual(px(back, 0, 0), [10, 20, 30, 255]);
});

/* ============================ 裁剪 ============================ */

test('切片：不 trim 时尺寸就是格子大小', () => {
  const sheet = makeSheet([[255, 0, 0], [0, 0, 255]], 2, 16);
  const c = crop(sheet, 0, 0, 16, 16, false);
  assert.equal(c.w, 16);
  assert.equal(c.h, 16);
});

test('切片：trim 把四周透明边去掉（锚点才能贴底）', () => {
  const sheet = makeSheet([[9, 200, 30]], 1, 16);
  const c = crop(sheet, 0, 0, 16, 16, true);
  assert.equal(c.w, 14, '左右各去掉 1px');
  assert.equal(c.h, 14, '上下各去掉 1px');
  assert.deepEqual(px(c, 0, 0), [9, 200, 30, 255]);
});

test('切片：整块透明的格子返回 null（不会被当成一张空图塞进去）', () => {
  const sheet = makeSheet([[255, 255, 255]], 1, 16);
  // 把唯一一块涂掉
  for (let i = 3; i < sheet.data.length; i += 4) sheet.data[i] = 0;
  assert.equal(crop(sheet, 0, 0, 16, 16, true), null);
});

test('切片：按网格取第 N 格，拿到的就是那一格的颜色', () => {
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
  const sheet = makeSheet(colors, 2, 12);
  const cols = 2;
  for (let i = 0; i < 4; i++) {
    const c = crop(sheet, (i % cols) * 12, Math.floor(i / cols) * 12, 12, 12, false);
    assert.deepEqual(px(c, 6, 6), [...colors[i], 255], '第 ' + i + ' 格');
  }
});

/* ============================ 端到端（命令行） ============================ */

test('命令行：--sheet-file 切本地 sheet 能产出合法皮肤包', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slice-'));
  const sheetPath = join(dir, 'sheet.png');
  const sheet = makeSheet([[255, 0, 0], [0, 200, 0], [0, 0, 255], [200, 200, 0]], 2, 16);
  writeFileSync(sheetPath, encodePng(sheet.w, sheet.h, sheet.data));

  const id = 'local-slice-selftest';
  const packDir = join(ROOT, 'assets', 'art', 'packs', id);
  try {
    const out = execFileSync(process.execPath, [
      TOOL, '--pack', 'ignored', '--id', id, '--name', '切片自测',
      '--sheet-file', sheetPath, '--tile', '16x16', '--pick', 'idle=0,walk=1,happy=2',
    ], { encoding: 'utf8' });
    assert.match(out, /idle ← 第 0 格/, '应当按 --pick 指定取格：\n' + out);
    assert.ok(existsSync(join(packDir, 'manifest.json')), '应当写出 manifest.json');
    for (const f of ['idle.png', 'walk.png', 'happy.png']) {
      assert.ok(existsSync(join(packDir, f)), '应当写出 ' + f);
      const img = decodePng(readFileSync(join(packDir, f)));
      assert.equal(img.w, 14, f + ' 应当被 trim 成 14 宽');
      assert.equal(img.h, 14, f + ' 应当被 trim 成 14 高');
    }
    // 切出来的 idle 必须是第 0 格的颜色（红），不是别的格
    assert.deepEqual(px(decodePng(readFileSync(join(packDir, 'idle.png'))), 7, 7), [255, 0, 0, 255]);
    assert.deepEqual(px(decodePng(readFileSync(join(packDir, 'walk.png'))), 7, 7), [0, 200, 0, 255]);
    assert.match(out, /全部通过/, '导入器应当自动跑校验并通过：\n' + out);
  } finally {
    // 自测产生的包不能留在仓库里
    try { execFileSync(process.execPath, ['-e', `require('fs').rmSync(${JSON.stringify(packDir)},{recursive:true,force:true})`]); } catch (e) { /* ignore */ }
  }
});
