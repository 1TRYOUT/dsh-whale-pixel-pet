/**
 * 一次性修复：托盘菜单没被设置 / pet:menu 无下文。
 * 共同嫌疑：主进程里 debugLog 不落 stdout，且我在启动路径上调用它——
 * 若它是后定义的 const（TDZ），refreshTray 会抛错中断，setContextMenu 永远执行不到，
 * 表现就是"托盘图标在、点了没反应"，而且**什么都不显示**。
 * 全部换成 console.log（确实进 stdout），并把可疑调用包进 try/catch。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const file = path.join(ROOT, 'desktop', 'main.js');
let t = fs.readFileSync(file, 'utf8');
let fails = 0;

function swap(from, to, label) {
  if (!t.includes(from)) { console.log('  X  ' + label); fails++; return; }
  t = t.replace(from, to);
  console.log('  OK ' + label);
}

// 1) 托盘里我加的两处 debugLog → console.log（可见）
swap(
  "  debugLog('托盘菜单：皮肤 ' + skinCount + ' 项，皮肤当前=' + (currentPackId() || '内置'));",
  "  console.log('[tray] 皮肤 ' + skinCount + ' 项，当前=' + (currentPackId() || '内置'));",
  '托盘日志改 console.log'
);

// 2) skinSubmenu 调用包起来（它若抛错会中断整个 refreshTray）
swap(
  '  const skinCount = skinSubmenu().length;',
  "  let skinCount = 0;\n  try { skinCount = skinSubmenu().length; } catch (e) { console.log('[tray] skinSubmenu 失败: ' + (e && e.message)); }",
  'skinSubmenu 包 try'
);

// 3) 在 setContextMenu 前后各留一条可见日志（判断到底走到哪一步）
swap(
  '  tray.setContextMenu(Menu.buildFromTemplate([',
  "  console.log('[tray] 准备构建菜单');\n  tray.setContextMenu(Menu.buildFromTemplate([",
  'setContextMenu 前日志'
);
swap(
  '  ]));',
  "  ]));\n  console.log('[tray] 菜单已设置');",
  'setContextMenu 后日志'
);

// 4) refreshTray 入口日志
swap(
  'function refreshTray() {\n  if (!tray) return;',
  "function refreshTray() {\n  console.log('[tray] refreshTray 被调用，tray=' + (tray ? 'ok' : 'null'));\n  if (!tray) return;",
  'refreshTray 入口日志'
);

// 5) pet:menu：把 debugLog 换掉并加 try/catch 日志
swap(
  "ipcMain.on('pet:menu', (_e, spec) => {",
  "ipcMain.on('pet:menu', (_e, spec) => {\n  console.log('[menu] 收到菜单请求 items=' + ((spec && spec.items) ? spec.items.length : 0));",
  'pet:menu 日志'
);

if (fails) { console.log('\n有 ' + fails + ' 处没匹配（文件未写入）'); process.exit(1); }
fs.writeFileSync(file, t, 'utf8');
console.log('\n已写入 desktop/main.js');
