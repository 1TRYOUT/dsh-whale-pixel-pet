/**
 * 🎨 按钮时灵时不灵的修复。
 * 原因：按钮可点与否取决于"她的大致包围盒"，而包围盒跟着立绘变——
 * 换成 toon-robot 那套后按钮就落到盒子外，点击直接穿透到桌面。
 * 主进程知道按钮的固定矩形，所以让它在命中判定里无条件成立。
 */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'desktop', 'main.js');
let t = fs.readFileSync(file, 'utf8');
const anchor = '  function cursorOverPet() {';
if (!t.includes(anchor)) { console.log('  X 锚点没找到'); process.exit(1); }
const inject = [
  '  /** 🎨 按钮的矩形（窗口内坐标，与 packs-ui.js 保持一致） */',
  '  const PACK_BUTTON = { x: 284, y: 414, w: 30, h: 26 };',
  '',
  anchor,
  '    // 按钮区域永远算"在她身上"：否则换皮肤后包围盒一变，按钮就点不到（穿透到桌面）',
  '    if (win && !win.isDestroyed()) {',
  '      try {',
  '        const bp = screen.getCursorScreenPoint();',
  '        const [bwx, bwy] = win.getPosition();',
  '        const bx = bp.x - bwx, by = bp.y - bwy;',
  '        if (bx >= PACK_BUTTON.x - 4 && bx <= PACK_BUTTON.x + PACK_BUTTON.w + 4 &&',
  '            by >= PACK_BUTTON.y - 4 && by <= PACK_BUTTON.y + PACK_BUTTON.h + 4) return true;',
  '      } catch (e) { /* ignore */ }',
  '    }',
].join('\n');
t = t.replace(anchor, inject);
fs.writeFileSync(file, t, 'utf8');
console.log('  已写入按钮命中修复');
