/**
 * 桌面主进程拖动回归：在 VM 中运行完整 main.js，替换 Electron 与系统边界。
 * 运行：node --test test/desktop-main.test.mjs
 * 不启动 Electron、不发送真实鼠标事件，也不读写桌宠的真实配置。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import vm from 'node:vm';

const source = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8');

async function makeDesktop() {
  const timers = new Map();
  const files = new Map();
  const windows = [];
  const cursor = { x: 150, y: 150 };
  const displays = [
    { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 2, workArea: { x: 1920, y: 0, width: 1920, height: 1080 } },
  ];
  let nextTimer = 0;
  const app = new EventEmitter();
  Object.assign(app, {
    getPath: () => '/fake/user-data',
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    quit() { this.emit('before-quit'); this.emit('will-quit'); },
  });
  const ipcMain = new EventEmitter();
  ipcMain.handle = () => {};
  const screen = new EventEmitter();
  Object.assign(screen, {
    getPrimaryDisplay: () => displays[0],
    getAllDisplays: () => displays,
    getCursorScreenPoint: () => ({ ...cursor }),
    getDisplayNearestPoint: (p) => displays[p.x >= 1920 ? 1 : 0],
  });

  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.position = [options.x, options.y];
      this.visible = false;
      this.destroyed = false;
      this.ignored = true;
      this.moves = 0;
      this.webContents = new EventEmitter();
      this.webContents.send = () => {};
      windows.push(this);
    }
    static getAllWindows() { return windows.filter((w) => !w.destroyed); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    getPosition() { return this.position.slice(); }
    setPosition(x, y) { this.position = [x, y]; this.moves++; }
    setIgnoreMouseEvents(ignored) { this.ignored = ignored; }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    loadFile() {}
    show() { this.visible = true; this.emit('show'); }
    hide() { this.visible = false; this.emit('hide'); }
    close() {
      let prevented = false;
      this.emit('close', { preventDefault() { prevented = true; } });
      if (!prevented) this.destroy();
    }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  class Tray extends EventEmitter {
    setToolTip() {}
    setContextMenu() {}
  }
  const electron = {
    app, BrowserWindow, ipcMain, Tray, screen,
    Menu: { buildFromTemplate: () => ({ popup() {} }) },
    shell: { openExternal: () => Promise.resolve() },
    nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
  };
  const fakeFs = {
    readFileSync(file) {
      if (files.has(file)) return files.get(file);
      if (path.basename(file) === 'position.json') return '{"x":100,"y":100}';
      throw new Error('ENOENT');
    },
    writeFileSync: (file, value) => files.set(file, String(value)),
    unlinkSync: (file) => files.delete(file),
  };
  const modules = { electron, 'node:path': path, 'node:fs': fakeFs, 'node:os': { tmpdir: () => '/fake/tmp' } };
  const context = vm.createContext({
    require(name) {
      assert.ok(Object.hasOwn(modules, name), '不应访问未替换的系统模块：' + name);
      return modules[name];
    },
    __dirname: '/fake/desktop',
    process: { env: {}, pid: 12345 },
    console,
    setInterval(fn, ms) { timers.set(++nextTimer, { fn, ms }); return nextTimer; },
    clearInterval(id) { timers.delete(id); },
  });
  vm.runInContext(source, context, { filename: 'desktop/main.js' });
  await Promise.resolve();                    // 执行真实的 app.whenReady().then(...) 初始化
  const win = windows[0];
  assert.ok(win, '主进程应创建窗口');
  win.emit('ready-to-show');
  const send = (name, value) => ipcMain.emit(name, {}, value);
  const tick = () => {
    for (const timer of [...timers.values()]) if (timer.ms === 16) timer.fn();
  };
  return {
    app, win, send, tick, cursor,
    dragTimers: () => [...timers.values()].filter((timer) => timer.ms === 16).length,
    startDrag() { send('pet:drag-lock', true); send('pet:drag-start'); },
  };
}

function assertStopped(desktop) {
  const { win, cursor } = desktop;
  assert.equal(desktop.dragTimers(), 0, '结束后应移除拖动定时器');
  const before = win.getPosition();
  const moves = win.moves;
  cursor.x += 500;
  desktop.tick();
  assert.deepEqual(win.getPosition(), before, '结束后移动光标不应移动窗口');
  assert.equal(win.moves, moves);
  if (!win.isDestroyed()) assert.equal(win.ignored, true, '结束后应释放拖动锁');
}

test('桌面拖动：按光标偏移跟随，正常结束后释放定时器与命中锁', async () => {
  const desktop = await makeDesktop();
  desktop.startDrag();
  desktop.cursor.x += 100;
  desktop.tick();
  assert.deepEqual(desktop.win.getPosition(), [200, 100]);
  desktop.send('pet:drag-end');
  assertStopped(desktop);
});

test('桌面拖动：结束后重新抓取使用新的光标偏移', async () => {
  const desktop = await makeDesktop();
  desktop.startDrag();
  desktop.cursor.x += 100;
  desktop.tick();
  desktop.send('pet:drag-end');
  desktop.cursor.x = 400;
  desktop.startDrag();
  desktop.cursor.x += 100;
  desktop.tick();
  assert.deepEqual(desktop.win.getPosition(), [300, 100]);
  desktop.send('pet:drag-end');
  assertStopped(desktop);
});

for (const event of ['hide', 'close', 'closed', 'render-process-gone', 'did-start-loading', 'before-quit']) {
  test('桌面拖动：' + event + ' 会结束拖动，不依赖渲染进程补发 pointerup', async () => {
    const desktop = await makeDesktop();
    desktop.startDrag();
    desktop.cursor.x += 100;
    desktop.tick();
    if (event === 'hide') desktop.send('pet:hide');
    else if (event === 'close') desktop.win.close();
    else if (event === 'closed') desktop.win.destroy();
    else if (event === 'before-quit') desktop.app.emit(event);
    else desktop.win.webContents.emit(event);
    if (event === 'hide' || event === 'close') {
      desktop.app.emit('second-instance');   // 模拟从托盘再次显示
      assert.equal(desktop.win.isVisible(), true);
    }
    assertStopped(desktop);
  });
}

test('桌面拖动：仍可从主屏拖到相邻副屏', async () => {
  const desktop = await makeDesktop();
  desktop.startDrag();
  desktop.cursor.x = 2400;
  desktop.tick();
  assert.deepEqual(desktop.win.getPosition(), [2350, 100]);
  desktop.send('pet:drag-end');
  assertStopped(desktop);
});
