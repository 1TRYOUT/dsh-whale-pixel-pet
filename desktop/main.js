/**
 * 鲸鱼娘桌宠 · 独立桌面窗口（Electron 主进程）
 * ---------------------------------------------------------------------------
 * 形态：透明、无边框、置顶、不进任务栏的小窗口，只画出她本人；
 *      窗口其余区域鼠标穿透（点得到下面的桌面和其它软件）。
 * 位置：拖动她即移动窗口，位置记在 userData/position.json。
 * 状态：轮询 DSH 宿主写的状态文件（不走 HTTP：DSH 的 /api 有鉴权，外部进程拿不到凭证），
 *      由 DSH 里的插件客户端上报（干活/思考/待审批/出错），DSH 不开也能独立跑。
 * ---------------------------------------------------------------------------
 */
'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, screen, shell, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const WIN_W = 420;
const WIN_H = 640;
/** pid 文件：不管谁把我拉起来的，都把自己登记上，宿主才知道她在不在 */
const PID_FILE = process.env.DSH_PET_PID_FILE || path.join(__dirname, '.pet.pid');

function registerPid() {
  try { fs.writeFileSync(PID_FILE, String(process.pid), 'utf8'); } catch (e) { /* ignore */ }
}
function unregisterPid() {
  try {
    if (fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) fs.unlinkSync(PID_FILE);
  } catch (e) { /* ignore */ }
}
/** DSH 插件写、我们读的状态文件（不走 HTTP：DSH 的 /api 有鉴权，外部进程拿不到凭证） */
const STATE_FILE = process.env.DSH_PET_STATE_DIR
  ? path.join(process.env.DSH_PET_STATE_DIR, 'state.json')
  : path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'dsh-whale-pet', 'state.json');
const POLL_MS = 1500;
const STALE_MS = 8000;          // 超过这么久没更新就当作空闲

let win = null;
let tray = null;
let quitting = false;
let pollTimer = null;
let lastState = { state: 'idle', detail: null, tokens: 0, at: 0, stale: true };

/* ------------------------------ 位置持久化 ------------------------------ */

function posFile() { return path.join(app.getPath('userData'), 'position.json'); }

function loadPos() {
  try {
    const d = JSON.parse(fs.readFileSync(posFile(), 'utf8'));
    if (typeof d.x === 'number' && typeof d.y === 'number') return d;
  } catch (e) { /* 第一次运行没有这个文件 */ }
  return null;
}

function savePos() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  try { fs.writeFileSync(posFile(), JSON.stringify({ x, y })); } catch (e) { /* ignore */ }
}

function defaultPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - WIN_W - 24, y: wa.y + wa.height - WIN_H - 8 };
}

/** 夹进工作区，别让她掉到屏幕外找不回来 */
/** 窗口至少要留这么多像素在屏幕上，否则用户就找不到她了 */
const MIN_VISIBLE = 60;

/**
 * 选一块"最合适"的屏幕，而不是"离鼠标最近"的那块。
 * 关键差别：拖到两屏交界时，最近屏判定会把她拽回原屏（跨不过去）；
 * 这里改成"谁能让这个位置留出足够可见区域，就选谁"。
 */
function pickDisplayFor(x, y) {
  let displays = [];
  try { displays = screen.getAllDisplays(); } catch (e) { displays = []; }
  if (!displays.length) return screen.getPrimaryDisplay();

  let best = null;
  let bestDist = Infinity;
  for (const d of displays) {
    const wa = d.workArea;
    // 把窗口夹到这块屏里，得到"如果选它"的最终位置
    const cx = Math.min(Math.max(x, wa.x - MIN_VISIBLE + 1), wa.x + wa.width - MIN_VISIBLE);
    const cy = Math.min(Math.max(y, wa.y), wa.y + wa.height - MIN_VISIBLE);
    const dist = Math.abs(cx - x) + Math.abs(cy - y);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return best || screen.getPrimaryDisplay();
}

function clampToWorkArea(x, y) {
  try {
    const d = pickDisplayFor(Math.round(x), Math.round(y));   // 允许跨屏（原来用 getDisplayNearestPoint 会把她拽回原屏）
    const wa = d.workArea;
    return {
      x: Math.min(Math.max(Math.round(x), wa.x - 40), wa.x + wa.width - WIN_W + 40),
      y: Math.min(Math.max(Math.round(y), wa.y - 20), wa.y + wa.height - WIN_H + 20),
    };
  } catch (e) {
    return { x: Math.round(x), y: Math.round(y) };
  }
}

/* -------------------------------- 窗口 -------------------------------- */

function createWindow() {
  const saved = loadPos() || defaultPos();
  const p = clampToWorkArea(saved.x, saved.y);

  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: p.x,
    y: p.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: '鲸鱼娘桌宠',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) { /* Windows 上无所谓 */ }
  // 默认整窗穿透，只有指针落在她身上时由渲染进程打开命中
  win.setIgnoreMouseEvents(true, { forward: true });

  const query = {};
  if (process.env.DSH_PET_DEBUG) query.debug = '1';
  if (process.env.DSH_PET_PANEL) query.panel = '1';
  win.loadFile(path.join(__dirname, 'index.html'), Object.keys(query).length ? { query } : undefined);
  win.once('ready-to-show', () => {
    win.show();
    pushState(true);
  });
  win.on('moved', savePos);
  win.on('closed', () => { if (hoverTimer) clearInterval(hoverTimer); });
  // 关窗 = 收进托盘，不真的退出
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide(); refreshTray(); }
  });
}

function refreshTray() {
  if (!tray) return;
  const visible = !!(win && !win.isDestroyed() && win.isVisible());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? '藏起来' : '叫她出来', click: toggleVisible },
    { label: '回到右下角', click: resetPos },
    { type: 'separator' },
    { label: '打开 DSH', click: () => { shell.openExternal('http://127.0.0.1:19387').catch(() => {}); } },
    { type: 'separator' },
    { label: '退出桌宠', click: () => { quitting = true; app.quit(); } },
  ]));
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) win.hide(); else win.show();
  refreshTray();
}

function resetPos() {
  if (!win) return;
  const p = clampToWorkArea(defaultPos().x, defaultPos().y);
  win.setPosition(p.x, p.y);
  savePos();
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip('鲸鱼娘桌宠');
    refreshTray();
    tray.on('click', toggleVisible);
  } catch (e) {
    console.warn('[desktop] 托盘创建失败（不影响桌宠本体）：', e && e.message);
  }
}

/* --------------------------- DSH 状态轮询（读文件） --------------------------- */

function fetchState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') return null;
    return {
      state: typeof d.state === 'string' ? d.state : 'idle',
      detail: d.detail || null,
      tokens: Number(d.tokens) || 0,
      at: Number(d.at) || Date.now(),
      // 任务 / 进度 / 用量：宿主半边算好的，原样转给渲染进程（别做字段白名单！）
      task: d.task || null,
      progress: d.progress || null,
      usage: d.usage || null,
      hostRunning: !!d.hostRunning,
      command: d.command || null,
      commandResult: d.commandResult || null,
    };
  } catch (e) {
    return null;              // DSH 没开 / 插件没装 / 还没写过：静默，她自己待机
  }
}

async function pollOnce() {
  const fresh = fetchState();
  if (fresh) lastState = Object.assign({}, fresh, { stale: Date.now() - fresh.at > STALE_MS });
  else lastState = Object.assign({}, lastState, { stale: true });
  pushState();
}

function pushState(force) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('pet:state', Object.assign({}, lastState, { force: !!force }));
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollOnce, POLL_MS);
  pollOnce();
}

/* ------------------------------ 调试日志（DSH_PET_DEBUG=1） ------------------------------ */

function debugLog(msg) {
  if (!process.env.DSH_PET_DEBUG) return;
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'debug.log'),
      new Date().toISOString() + '  ' + msg + '\n');
  } catch (e) { /* ignore */ }
}

/* --------------------------- 命中判定 / 鼠标穿透 --------------------------- */

/**
 * 不依赖 setIgnoreMouseEvents 的 forward 事件转发（Windows 上不可靠），
 * 而是由主进程轮询系统光标位置，自己判断指针是否落在她身上：
 *   · 在她身上 → 取消穿透，正常收鼠标事件（可摸可拖）
 *   · 不在     → 打开穿透，点击落到下面的桌面/其它软件
 * 拖动期间强制不穿透，避免快速拖动时指针离开包围盒导致拖拽中断。
 */
let petBox = null;         // 渲染进程上报的她的大致包围盒（窗口内坐标）
let dragLock = false;

function cursorOverPet() {
  if (!petBox || !win || win.isDestroyed()) return false;
  let pt;
  try { pt = screen.getCursorScreenPoint(); } catch (e) { return false; }
  const [wx, wy] = win.getPosition();
  const lx = pt.x - wx;
  const ly = pt.y - wy;
  return lx >= petBox.x - 6 && lx <= petBox.x + petBox.w + 6 &&
    ly >= petBox.y - 10 && ly <= petBox.y + petBox.h + 8;
}

let ignoreState = null;
let hoverTimer = null;

function syncIgnore() {
  if (!win || win.isDestroyed()) { debugLog('syncIgnore: 窗口还没建好'); return; }
  const over_ = petBox ? cursorOverPet() : false;
  const wantIgnore = !(dragLock || over_);
  if (wantIgnore === ignoreState) return;
  ignoreState = wantIgnore;
  try {
    win.setIgnoreMouseEvents(wantIgnore, { forward: true });
    debugLog('ignore -> ' + wantIgnore + ' (overPet=' + over_ + ' dragLock=' + dragLock + ')');
  } catch (e) {
    debugLog('setIgnoreMouseEvents 抛错: ' + (e && e.message));
  }
}

function startHoverWatch() {
  if (hoverTimer) clearInterval(hoverTimer);
  hoverTimer = setInterval(syncIgnore, 80);
  if (process.env.DSH_PET_DEBUG) {
    setInterval(() => {
      let pt = null;
      try { pt = screen.getCursorScreenPoint(); } catch (e) { /* ignore */ }
      let pos = [0, 0];
      try { pos = win && !win.isDestroyed() ? win.getPosition() : [0, 0]; } catch (e) { /* ignore */ }
      debugLog('ignore=' + ignoreState + ' dragLock=' + dragLock +
        ' box=' + JSON.stringify(petBox) + ' win=' + pos.join(',') +
        ' cursor=' + (pt ? pt.x + ',' + pt.y : '?') + ' overPet=' + cursorOverPet());
    }, 2000);
  }
}

/* -------------------------------- IPC -------------------------------- */

ipcMain.on('pet:ignore', (_e, ignored) => {
  if (!win || win.isDestroyed()) return;
  try { win.setIgnoreMouseEvents(!!ignored, { forward: true }); } catch (e) { /* ignore */ }
});

/** 渲染进程上报她当前的大致包围盒（窗口内坐标），用于命中判定 */
ipcMain.on('pet:box', (_e, box) => {
  if (!box || typeof box.x !== 'number') return;
  petBox = { x: box.x, y: box.y, w: box.w, h: box.h };
});

/** 拖动期间锁住命中，避免指针跑出包围盒导致拖拽中断 */
ipcMain.on('pet:drag-lock', (_e, locked) => {
  dragLock = !!locked;
  syncIgnore();
});

/**
 * 拖动改由主进程轮询光标驱动。
 * 原因：原来靠渲染进程的 pointermove 发增量，跨屏时必须长距离连续移动，
 * 光标一定会跑出窗口 → pointerleave → 拖动当场断掉，所以永远跨不过去。
 * 主进程直接读光标位置就没有这个问题（命中检测也是同一套机制）。
 */
let dragTimer = null;
let dragOffset = null;

ipcMain.on('pet:drag-start', () => {
  if (!win || win.isDestroyed()) return;
  try {
    const c = screen.getCursorScreenPoint();
    const [x, y] = win.getPosition();
    dragOffset = { x: c.x - x, y: c.y - y };          // 抓住她时，光标在她身上的相对位置
    if (dragTimer) clearInterval(dragTimer);
    dragTimer = setInterval(() => {
      if (!win || win.isDestroyed() || !dragOffset) return;
      try {
        const p0 = screen.getCursorScreenPoint();
        const p = clampToWorkArea(p0.x - dragOffset.x, p0.y - dragOffset.y);
        const [cx, cy] = win.getPosition();
        if (p.x !== cx || p.y !== cy) win.setPosition(p.x, p.y);
      } catch (e) { /* ignore */ }
    }, 16);
    debugLog('拖动开始，抓取偏移 ' + dragOffset.x + ',' + dragOffset.y);
  } catch (e) {
    debugLog('拖动开始失败: ' + (e && e.message));
  }
});

ipcMain.on('pet:drag', (_e, d) => {
  if (!win || win.isDestroyed() || !d) return;
  const [x, y] = win.getPosition();
  const p = clampToWorkArea(x + (Number(d.dx) || 0), y + (Number(d.dy) || 0));
  win.setPosition(p.x, p.y);
});

ipcMain.on('pet:drag-end', () => {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
  dragOffset = null;
  savePos();
});

/** 反向通道：桌面 -> 宿主（宿主轮询这个文件），因为桌面进程拿不到 /api 鉴权 */
const COMMAND_FILE = path.join(path.dirname(STATE_FILE), 'command.json');

/** 请求批准当前待审批项（只允许一次；由 DSH 页面里的客户端半边真正执行） */
ipcMain.on('pet:approve', () => {
  try {
    fs.mkdirSync(path.dirname(COMMAND_FILE), { recursive: true });
    fs.writeFileSync(COMMAND_FILE, JSON.stringify({ action: 'approve', nonce: Date.now() }), 'utf8');
    debugLog('已写入审批命令 ' + COMMAND_FILE);
  } catch (e) {
    debugLog('写审批命令失败: ' + (e && e.message));
  }
});

ipcMain.on('pet:hide', () => { if (win) { win.hide(); refreshTray(); } });
ipcMain.on('pet:quit', () => { quitting = true; app.quit(); });

/* --------------------------- 散步：整个窗口走出去 --------------------------- */

let walkTimer = null;
/** 测试钩子：DSH_PET_WALK=1 时强制下一次散步跨屏（确定性验证用） */
const forceCrossWalk = process.env.DSH_PET_WALK === '1';

ipcMain.on('pet:walk', (_e, spec) => {
  if (!win || win.isDestroyed()) return;
  if (walkTimer) { clearInterval(walkTimer); walkTimer = null; }
  const [x0, y0] = win.getPosition();
  let wa;
  let cur;
  try { cur = screen.getDisplayNearestPoint({ x: x0, y: y0 }); wa = cur.workArea; }
  catch (e) { cur = screen.getPrimaryDisplay(); wa = cur.workArea; }

  /** 行进方向上"紧挨着"的另一块屏（竖直重叠不足 120px 就不算，中间是虚空） */
  const adjacentDisplay = (from, direction) => {
    try {
      let best = null, bestGap = Infinity;
      for (const d of screen.getAllDisplays()) {
        if (d.id === from.id) continue;
        const a = from.workArea, b = d.workArea;
        if (Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) < 120) continue;
        const gap = direction > 0 ? (b.x - (a.x + a.width)) : (a.x - (b.x + b.width));
        if (gap < -40 || gap > 400) continue;
        if (Math.abs(gap) < bestGap) { bestGap = Math.abs(gap); best = d; }
      }
      return best;
    } catch (e) { return null; }
  };

  const dir = spec && spec.dir === -1 ? -1 : 1;
  const margin = 30;
  const minX = wa.x - 40 + margin;
  const maxX = wa.x + wa.width - WIN_W + 40 - margin;
  let targetX = (spec && typeof spec.spot === 'number')
    ? spec.spot
    : x0 + dir * Math.round(wa.width * 0.3);
  const nextDisplay = adjacentDisplay(cur, dir);
  const wantCross = !!nextDisplay && (forceCrossWalk || ((!spec || typeof spec.spot !== 'number') && Math.random() < 0.35));
  if (wantCross) {
    const b = nextDisplay.workArea;
    const nbMin = b.x - 40 + margin;
    const nbMax = Math.max(nbMin, b.x + b.width - WIN_W + 40 - margin);
    targetX = Math.round((nbMin + nbMax) / 2);
    debugLog('散步跨屏：屏 ' + cur.id + ' → ' + nextDisplay.id + '，目标 x=' + targetX + '（本屏 ' + minX + '..' + maxX + '）');
  } else {
    targetX = Math.min(Math.max(Math.round(targetX), minX), Math.max(minX, maxX));
  }

  const stepMs = 16;
  const speed = 150;                            // px/s
  const send = (payload) => { if (win && !win.isDestroyed()) win.webContents.send('pet:walk-end', payload); };

  // 路上随机停一两次看看风景（停在哪、停多久都不固定）
  const pauseCount = Math.random() < 0.75 ? (Math.random() < 0.45 ? 2 : 1) : 0;
  const pausePlan = [];
  for (let i = 0; i < pauseCount; i++) {
    const frac = (0.22 + 0.5 * Math.random()) * ((i + 1) / pauseCount);
    pausePlan.push(x0 + (targetX - x0) * frac);
  }

  let pausedUntil = 0;
  let lastTick = Date.now();
  walkTimer = setInterval(() => {
    if (!win || win.isDestroyed()) { clearInterval(walkTimer); walkTimer = null; return; }
    const now = Date.now();
    const dt = Math.min(0.12, (now - lastTick) / 1000);   // 按真实经过时间推进
    lastTick = now;
    if (now < pausedUntil) return;                        // 正在看风景
    if (pausedUntil) { pausedUntil = 0; send({ phase: 'resume' }); }
    const [x, y] = win.getPosition();

    if (pausePlan.length) {
      const at = pausePlan[0];
      if ((targetX > x0 && x >= at) || (targetX < x0 && x <= at)) {
        pausePlan.shift();
        pausedUntil = now + 1100 + Math.random() * 1500;
        // 顺便看看你（不是浏览器/终端，是"人"）在不在附近
        let near = false;
        try {
          const pt = screen.getCursorScreenPoint();
          near = Math.abs(pt.x - (x + WIN_W / 2)) < 260 && Math.abs(pt.y - (y + WIN_H / 2)) < 300;
        } catch (e) { near = false; }
        send({ phase: 'pause', near: near });
        return;
      }
    }

    const remain = targetX - x;
    const step = Math.max(1, speed * dt);                 // 定时器抖动也不至于让她爬
    if (Math.abs(remain) <= step) {
      win.setPosition(targetX, y);
      clearInterval(walkTimer); walkTimer = null;
      savePos();
      send({ phase: 'done', x: targetX });
      return;
    }
    win.setPosition(Math.round(x + (remain > 0 ? 1 : -1) * step), y);
  }, stepMs);
});
/** 皮肤选择：存文件而不是 localStorage —— 与窗口位置同一套机制，重启后一定读得回来 */
const PACK_FILE = path.join(path.dirname(STATE_FILE), 'pack.json');

/**
 * 一键导入本地皮肤：选一个含 manifest.json 的文件夹，复制成 packs/local-<名字>/。
 * 用 local- 前缀是关键——.gitignore 忽略 local-*，所以第三方/自用素材不会被提交，
 * 功能上和仓库内的包完全一样。
 */
ipcMain.handle('pet:pack:install', async () => {
  try {
    const { dialog } = require('electron');
    const picked = await dialog.showOpenDialog(win, {
      title: '选择皮肤文件夹（里面要有 manifest.json）',
      properties: ['openDirectory'],
    });
    if (!picked || picked.canceled || !picked.filePaths.length) return { ok: false, error: '已取消' };
    const src = picked.filePaths[0];
    if (!fs.existsSync(path.join(src, 'manifest.json'))) {
      return { ok: false, error: '这个文件夹里没有 manifest.json' };
    }
    const raw = path.basename(src).replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '');
    const name = (raw || 'pack').slice(0, 40);
    const dest = path.join(__dirname, '..', 'assets', 'art', 'packs', 'local-' + name);
    fs.mkdirSync(dest, { recursive: true });
    let copied = 0;
    for (const entry of fs.readdirSync(src)) {
      const from = path.join(src, entry);
      try {
        if (!fs.statSync(from).isFile()) continue;
        fs.copyFileSync(from, path.join(dest, entry));
        copied++;
      } catch (e) { /* 单个文件失败不中断 */ }
    }
    debugLog('导入本地皮肤 ' + name + '（' + copied + ' 个文件）→ ' + dest);
    return { ok: true, id: 'local-' + name, files: copied };
  } catch (e) {
    debugLog('导入皮肤失败: ' + (e && e.message));
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('pet:pack:get', () => {
  try { return JSON.parse(fs.readFileSync(PACK_FILE, 'utf8')).id || ''; }
  catch (e) { return ''; }        // 没选过 / 文件坏了 → 就当内置
});

ipcMain.handle('pet:pack:set', (_e, id) => {
  try {
    fs.mkdirSync(path.dirname(PACK_FILE), { recursive: true });
    fs.writeFileSync(PACK_FILE, JSON.stringify({ id: String(id || '') }), 'utf8');
    debugLog('皮肤选择已保存: ' + (id || '(内置)'));
    return true;
  } catch (e) {
    debugLog('保存皮肤选择失败: ' + (e && e.message));
    return false;
  }
});

ipcMain.handle('pet:packs', () => {
  const dir = path.join(__dirname, '..', 'assets', 'art', 'packs');
  const out = [];
  try {
    for (const id of fs.readdirSync(dir)) {
      const manifest = path.join(dir, id, 'manifest.json');
      if (!fs.existsSync(manifest)) continue;
      try {
        out.push({ id: id, manifest: JSON.parse(fs.readFileSync(manifest, 'utf8')) });
      } catch (e) {
        debugLog('立绘包解析失败 ' + id + ': ' + (e && e.message));
      }
    }
  } catch (e) { /* 没有 packs 目录就表示没装皮肤包 */ }
  return out;
});

/**
 * 显示器布局变化（拔掉副屏、改分辨率、缩放）时把她拉回可见区域。
 * 没有这段的话，副屏一拔，她的坐标就在屏幕之外，看起来就是"桌宠消失了"。
 */
function handleDisplaysChanged(reason) {
  if (!win || win.isDestroyed()) return;
  try {
    const [x, y] = win.getPosition();
    const p = clampToWorkArea(x, y);
    if (p.x !== x || p.y !== y) {
      win.setPosition(p.x, p.y);
      savePos();
      debugLog('显示器变化(' + reason + ')：窗口从 ' + x + ',' + y + ' 拉回 ' + p.x + ',' + p.y);
    } else {
      debugLog('显示器变化(' + reason + ')：位置仍然可见，不动');
    }
  } catch (e) {
    debugLog('显示器变化处理失败: ' + (e && e.message));
  }
}
try {
  screen.on('display-removed', () => handleDisplaysChanged('display-removed'));
  screen.on('display-added', () => handleDisplaysChanged('display-added'));
  screen.on('display-metrics-changed', () => handleDisplaysChanged('display-metrics-changed'));
} catch (e) { debugLog('注册显示器事件失败: ' + (e && e.message)); }

/** 可见性看门狗：每 3 秒确认她至少 MIN_VISIBLE 可见（跨屏时两屏 y 有偏移，可能落进虚空） */
setInterval(() => {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  try {
    const [x, y] = win.getPosition();
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      const ox = Math.min(x + WIN_W, a.x + a.width) - Math.max(x, a.x);
      const oy = Math.min(y + WIN_H, a.y + a.height) - Math.max(y, a.y);
      return ox >= MIN_VISIBLE && oy >= MIN_VISIBLE;
    });
    if (!visible) {
      const p = clampToWorkArea(x, y);
      win.setPosition(p.x, p.y);
      savePos();
      debugLog('看门狗：跑到看不见的地方了，从 ' + x + ',' + y + ' 拉回 ' + p.x + ',' + p.y);
    }
  } catch (e) { /* ignore */ }
}, 3000);

if (process.env.DSH_PET_WALK === '1') {
  setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.send('pet:action', 'walk'); }, 4000);
}

ipcMain.on('pet:reset-pos', resetPos);

ipcMain.on('pet:menu', (_e, spec) => {
  debugLog('收到菜单请求，items=' + ((spec && spec.items) ? spec.items.length : 0));
  if (!win || win.isDestroyed()) return;
  const items = (spec && Array.isArray(spec.items)) ? spec.items : [];
  const send = (id) => { if (win && !win.isDestroyed()) win.webContents.send('pet:action', id); };

  const build = (list) => list.map((it) => {
    if (!it || it.type === 'separator') return { type: 'separator' };
    if (it.type === 'submenu') return { label: it.label, submenu: build(it.items || []) };
    return {
      label: it.label,
      type: it.type === 'checkbox' ? 'checkbox' : 'normal',
      checked: it.type === 'checkbox' ? !!it.checked : undefined,
      enabled: it.enabled !== false,
      click: () => send(it.id),
    };
  });

  // 兜底：清单为空时至少留一个能退出的菜单
  const template = items.length ? build(items) : [
    { label: '显示 / 隐藏', click: toggleVisible },
    { label: '回到右下角', click: resetPos },
    { type: 'separator' },
    { label: '退出桌宠', click: () => { quitting = true; app.quit(); } },
  ];
  Menu.buildFromTemplate(template).popup({ window: win });
});

ipcMain.handle('pet:state:get', () => lastState);

/* -------------------------------- 启动 -------------------------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.show(); refreshTray(); } });
  app.whenReady().then(() => {
    registerPid();
    createWindow();
    createTray();
    startPolling();
    startHoverWatch();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { /* 托盘常驻，不退出 */ });
  app.on('will-quit', () => { unregisterPid(); });
  app.on('before-quit', () => { quitting = true; if (pollTimer) clearInterval(pollTimer); });
}
