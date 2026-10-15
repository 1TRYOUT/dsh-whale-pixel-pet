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
function clampToWorkArea(x, y) {
  try {
    const d = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
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

ipcMain.on('pet:drag', (_e, d) => {
  if (!win || win.isDestroyed() || !d) return;
  const [x, y] = win.getPosition();
  const p = clampToWorkArea(x + (Number(d.dx) || 0), y + (Number(d.dy) || 0));
  win.setPosition(p.x, p.y);
});

ipcMain.on('pet:drag-end', () => { savePos(); });

ipcMain.on('pet:hide', () => { if (win) { win.hide(); refreshTray(); } });
ipcMain.on('pet:quit', () => { quitting = true; app.quit(); });

/* --------------------------- 散步：整个窗口走出去 --------------------------- */

let walkTimer = null;

ipcMain.on('pet:walk', (_e, spec) => {
  if (!win || win.isDestroyed()) return;
  if (walkTimer) { clearInterval(walkTimer); walkTimer = null; }
  const [x0, y0] = win.getPosition();
  let wa;
  try { wa = screen.getDisplayNearestPoint({ x: x0, y: y0 }).workArea; } catch (e) { wa = screen.getPrimaryDisplay().workArea; }

  const dir = spec && spec.dir === -1 ? -1 : 1;
  const margin = 30;
  const minX = wa.x - 40 + margin;
  const maxX = wa.x + wa.width - WIN_W + 40 - margin;
  let targetX = (spec && typeof spec.spot === 'number')
    ? spec.spot
    : x0 + dir * Math.round(wa.width * 0.3);
  targetX = Math.min(Math.max(Math.round(targetX), minX), Math.max(minX, maxX));

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
ipcMain.on('pet:reset-pos', resetPos);

ipcMain.on('pet:menu', (_e, spec) => {
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
