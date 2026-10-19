/** 容错：manifest 带 UTF-8 BOM 时也能解析（Windows 上很常见） */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let fails = 0;
function patch(rel, steps) {
  const file = path.join(ROOT, rel);
  let t = fs.readFileSync(file, 'utf8');
  for (const s of steps) {
    if (!t.includes(s.from)) { console.log('  X  ' + rel + ' :: ' + s.label); fails++; continue; }
    t = t.replace(s.from, s.to);
    console.log('  OK ' + rel + ' :: ' + s.label);
  }
  fs.writeFileSync(file, t, 'utf8');
}

patch('tools/check-packs.mjs', [{
  label: '校验器剥 BOM',
  from: "  try { manifest = JSON.parse(readFileSync(mf, 'utf8')); }",
  to: "  try { manifest = JSON.parse(readFileSync(mf, 'utf8').replace(/^\\uFEFF/, '')); }",
}]);

patch('desktop/main.js', [{
  label: '主进程扫描剥 BOM',
  from: "        out.push({ id: id, manifest: JSON.parse(fs.readFileSync(manifest, 'utf8')) });",
  to: "        out.push({ id: id, manifest: JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\\uFEFF/, '')) });",
}]);

patch('desktop/packs-ui.js', [{
  label: '看门狗顺带剥 BOM 提示',
  from: "  const KEY = 'whale-pet:desktop:pack:v1';",
  to: "  const KEY = 'whale-pet:desktop:pack:v1';   // manifest 若带 BOM，主进程与校验器都会先剥掉",
}]);

console.log(fails ? '\n有 ' + fails + ' 处没匹配' : '\n全部写入');
process.exit(fails ? 1 : 0);
