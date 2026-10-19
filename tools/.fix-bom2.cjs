/** 容错：manifest 带 UTF-8 BOM 时也能解析（只改两处实码） */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let fails = 0;
function patch(rel, from, to, label) {
  const file = path.join(ROOT, rel);
  const t = fs.readFileSync(file, 'utf8');
  if (!t.includes(from)) { console.log('  X  ' + rel + ' :: ' + label); fails++; return; }
  fs.writeFileSync(file, t.replace(from, to), 'utf8');
  console.log('  OK ' + rel + ' :: ' + label);
}
patch('tools/check-packs.mjs',
  "  try { manifest = JSON.parse(readFileSync(mf, 'utf8')); }",
  "  try { manifest = JSON.parse(readFileSync(mf, 'utf8').replace(/^\\uFEFF/, '')); }",
  '校验器剥 BOM');
patch('desktop/main.js',
  "        out.push({ id: id, manifest: JSON.parse(fs.readFileSync(manifest, 'utf8')) });",
  "        out.push({ id: id, manifest: JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\\uFEFF/, '')) });",
  '主进程扫描剥 BOM');
console.log(fails ? '有 ' + fails + ' 处失败（未全部写入）' : '写入完成');
process.exit(fails ? 1 : 0);
