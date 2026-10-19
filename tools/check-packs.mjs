/**
 * 校验所有立绘包：manifest 合法性 + 引用的文件是否真的存在。
 * 用法：node tools/check-packs.mjs
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// pet-packs.js 是 UMD：在 Node ESM 下它把 API 挂到 globalThis，自身不 export
await import('../assets/pet-packs.js');
const P = globalThis.WhalePetPacks;
if (!P || typeof P.validate !== 'function') {
  console.log('无法加载 assets/pet-packs.js');
  process.exit(1);
}
const packsDir = join(here, '..', 'assets', 'art', 'packs');

if (!existsSync(packsDir)) {
  console.log('没有 assets/art/packs 目录（等于没装包）');
  process.exit(0);
}

let bad = 0;
let total = 0;
for (const id of readdirSync(packsDir)) {
  const dir = join(packsDir, id);
  const mf = join(dir, 'manifest.json');
  if (!existsSync(mf)) { console.log('  -  ' + id + ' 跳过（没有 manifest.json）'); continue; }
  total++;
  let manifest;
  try { manifest = JSON.parse(readFileSync(mf, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { console.log('  X  ' + id + ' manifest.json 不是合法 JSON: ' + e.message); bad++; continue; }

  const r = P.validate(manifest);
  if (!r.ok) { console.log('  X  ' + id + ' 校验失败: ' + r.errors.join('; ')); bad++; continue; }

  const missing = [];
  for (const f of [...Object.values(r.pack.poses), ...Object.values(r.pack.hints)]) {
    if (!existsSync(join(dir, f))) missing.push(f);
  }
  const count = Object.keys(r.pack.poses).length + Object.keys(r.pack.hints).length;
  if (missing.length) { console.log('  X  ' + id + ' 缺文件: ' + missing.join(', ')); bad++; continue; }
  const unk = r.unknown && r.unknown.length ? '  （不认识的 key: ' + r.unknown.join(', ') + '）' : '';
  console.log('  OK  ' + id + '  「' + r.pack.name + '」  ' + count + ' 张' + unk);
}
console.log('\n' + total + ' 个包，' + (bad === 0 ? '全部通过' : bad + ' 个有问题'));
process.exit(bad === 0 ? 0 : 1);