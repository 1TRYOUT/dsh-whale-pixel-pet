/**
 * 宿主半边单测：静态资源路由 + 会话状态中转路由
 * 运行：node --test test/host.test.mjs
 *
 * 用假的 Cordis 上下文与假 req/res 直接调用路由处理器，
 * 不需要真的起 DSH、也不需要网络。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mod = await import('../lib/index.js');

/** 桌面版控制路由要碰 pid 文件：指到临时目录，绝不碰真实桌宠 */
const TMP = mkdtempSync(path.join(os.tmpdir(), 'pet-host-test-'));
const TEST_PID_FILE = path.join(TMP, 'pet.pid');
process.env.DSH_PET_PID_FILE = TEST_PID_FILE;
// 状态/配置文件也指到临时目录，别污染用户真实的 %LOCALAPPDATA%\dsh-whale-pet
process.env.DSH_PET_STATE_DIR = TMP;
// Electron 指到不存在的路径：万一宿主半边自动启动，也只会安全失败，不会真弹出窗口
process.env.DSH_PET_ELECTRON = path.join(TMP, 'no-such-electron.exe');
writeFileSync(path.join(TMP, 'config.json'), JSON.stringify({ autoStart: false }), 'utf8');

/** 收集插件注册的路由、事件订阅与 effect；可注入假的 goals / agents 服务 */
function makeCtx(opts) {
  opts = opts || {};
  const routes = [];
  const effects = [];
  const listeners = new Map();
  const webServer = {
    register(route) {
      routes.push(route);
      return () => { route.disposed = true; };
    },
  };
  const services = Object.assign({
    webServer: webServer,
    goals: { get: () => undefined },
    agents: { list: () => [] },
  }, opts.services || {});
  const ctx = {
    inject(deps, cb) {
      cb({
        get: (key) => services[key],
        effect: (fn, label) => { effects.push({ fn, label }); },
      });
    },
    on(eventName, cb) {
      if (!listeners.has(eventName)) listeners.set(eventName, []);
      listeners.get(eventName).push(cb);
      return () => {
        const arr = listeners.get(eventName) || [];
        const i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
      };
    },
    effect(fn, label) { effects.push({ fn, label }); },
    logger: { info() {}, warn() {} },
  };
  return { ctx, routes, effects, listeners, services };
}

/** 从外部"发出"一个宿主事件，返回收到它的监听器数量 */
function fire(listeners, eventName, payload) {
  const arr = listeners.get(eventName) || [];
  for (const cb of arr) cb(payload);
  return arr.length;
}

/** 释放所有 effect（定时器、路由、事件订阅），避免测试被挂住 */
function disposeAll(effects) {
  for (const e of effects.slice().reverse()) {
    try {
      const d = e.fn();
      if (typeof d === 'function') d();
    } catch (error) { /* ignore */ }
  }
}

/**
 * 假响应：必须是真正的可写流，资源路由用 createReadStream().pipe(res) 输出。
 * 同时记录状态码/响应头，并提供 text() 读回内容。
 */
function makeRes() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); },
  });
  res.code = null;
  res.headers = null;
  res.writeHead = (code, headers) => { res.code = code; res.headers = headers || {}; };
  const origEnd = res.end.bind(res);
  res.end = (body) => {
    if (body !== undefined && body !== null && typeof body !== 'function') {
      chunks.push(Buffer.from(String(body)));
    }
    return origEnd();
  };
  res.text = () => Buffer.concat(chunks).toString('utf8');
  res.bytes = () => Buffer.concat(chunks).length;
  return res;
}

async function call(handler, { method = 'GET', url, body }) {
  const res = makeRes();
  const req = new Readable({ read() {} });
  if (method === 'POST') req.push(body === undefined ? '' : JSON.stringify(body));
  req.push(null);
  req.method = method;
  req.url = url;
  await handler(req, res);
  // 等流结束（pipe 是异步的）
  for (let i = 0; i < 60 && !res.writableEnded; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  return res;
}

function routesOf() {
  const { ctx, routes } = makeCtx();
  return { ctx, routes };
}

/* ============================ 注册 ============================ */

test('宿主半边：注册了资源 / 状态 / 桌面版三条路由', async () => {
  const { ctx, routes } = routesOf();
  await mod.apply(ctx);
  const paths = routes.map((r) => r.path).sort();
  assert.deepEqual(paths, [
    '/api/dsh-whale-pixel-pet/assets',
    '/api/dsh-whale-pixel-pet/desktop',
    '/api/dsh-whale-pixel-pet/state',
  ]);
  assert.equal(mod.name, 'dsh-whale-pixel-pet');
  for (const r of routes) assert.equal(r.kind, 'exact');
});

/* ============================ 资源路由 ============================ */

test('资源路由：能取到 css / js，并带正确 MIME', async () => {
  const { ctx, routes } = routesOf();
  await mod.apply(ctx);
  const assets = routes.find((r) => r.path.endsWith('/assets'));

  const css = await call(assets.handler, { url: '/api/dsh-whale-pixel-pet/assets?f=whale-pet.css' });
  assert.equal(css.code, 200);
  assert.match(css.headers['Content-Type'], /text\/css/);
  assert.match(css.text(), /\.dwp-root/, '取到的应该是真的样式表');

  const js = await call(assets.handler, { url: '/api/dsh-whale-pixel-pet/assets?f=art-musume.js' });
  assert.equal(js.code, 200);
  assert.match(js.headers['Content-Type'], /javascript/);
  assert.match(js.text(), /WhalePetArtMusume/, '取到的应该是立绘层脚本');

  const webp = await call(assets.handler, { url: '/api/dsh-whale-pixel-pet/assets?f=art/musume/dsh-whale-state-idle-cute.webp' });
  assert.equal(webp.code, 200);
  assert.equal(webp.headers['Content-Type'], 'image/webp', '.webp 必须有正确 MIME，立绘才稳');
  assert.ok(webp.bytes() > 10000, '立绘应该是完整二进制，实际 ' + webp.bytes() + ' 字节');
});

test('资源路由：版本尾巴会被剥掉，越界与缺失文件返回 404', async () => {
  const { ctx, routes } = routesOf();
  await mod.apply(ctx);
  const assets = routes.find((r) => r.path.endsWith('/assets'));

  const withVer = await call(assets.handler, { url: '/api/dsh-whale-pixel-pet/assets?f=whale-pet.css?v=9' });
  assert.equal(withVer.code, 200, '带 ?v= 尾巴也要能取到');

  const missing = await call(assets.handler, { url: '/api/dsh-whale-pixel-pet/assets?f=nope.js' });
  assert.equal(missing.code, 404);

  const escape = await call(assets.handler, { url: '/api/dsh-whale-pixel-pet/assets?f=../../../package.json' });
  assert.ok(escape.code === 404 || escape.code === 400, '目录穿越必须被挡住，实际 ' + escape.code);
});

/* ============================ 状态路由 ============================ */

test('状态路由：初始为空闲，且带 stale 标记', async () => {
  const { ctx, routes } = routesOf();
  await mod.apply(ctx);
  const state = routes.find((r) => r.path.endsWith('/state'));

  const res = await call(state.handler, { url: '/api/dsh-whale-pixel-pet/state' });
  assert.equal(res.code, 200);
  assert.match(res.headers['Content-Type'], /application\/json/);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*', '跨源轮询要允许');
  const data = JSON.parse(res.text());
  assert.equal(data.state, 'idle');
  assert.equal(data.stale, true, '还没人上报时应标记为 stale');
});

test('状态路由：POST 上报后 GET 能读到（GUI → 宿主 → 桌面窗口 的中转）', async () => {
  const { ctx, routes } = routesOf();
  await mod.apply(ctx);
  const state = routes.find((r) => r.path.endsWith('/state'));

  const post = await call(state.handler, {
    method: 'POST',
    url: '/api/dsh-whale-pixel-pet/state',
    body: { state: 'working', detail: 'pwsh', tokens: 4242 },
  });
  assert.equal(post.code, 200);
  assert.deepEqual(JSON.parse(post.text()), { ok: true });

  const got = await call(state.handler, { url: '/api/dsh-whale-pixel-pet/state' });
  const data = JSON.parse(got.text());
  assert.equal(data.state, 'working');
  assert.equal(data.detail, 'pwsh');
  assert.equal(data.tokens, 4242);
  assert.equal(data.stale, false, '刚上报过就不该是 stale');
  assert.ok(data.posts >= 1);
});

test('状态路由：Token 只增不减，坏 JSON 返回 400', async () => {
  const { ctx, routes } = routesOf();
  await mod.apply(ctx);
  const state = routes.find((r) => r.path.endsWith('/state'));

  await call(state.handler, { method: 'POST', url: '/api/dsh-whale-pixel-pet/state', body: { state: 'working', tokens: 5000 } });
  await call(state.handler, { method: 'POST', url: '/api/dsh-whale-pixel-pet/state', body: { state: 'idle', tokens: 100 } });
  const after = JSON.parse((await call(state.handler, { url: '/api/dsh-whale-pixel-pet/state' })).text());
  assert.equal(after.tokens, 5000, 'GUI 重载后 token 变小不该让桌面版倒退');
  assert.equal(after.state, 'idle');

  // 坏 JSON：直接用不可解析的字符串
  const res = makeRes();
  const req = new Readable({ read() {} });
  req.push('{oops');
  req.push(null);
  req.method = 'POST';
  req.url = '/api/dsh-whale-pixel-pet/state';
  const done = new Promise((r) => { const o = res.end; res.end = (b) => { o(b); r(); }; });
  await state.handler(req, res);
  await Promise.race([done, new Promise((r) => setTimeout(r, 200))]);
  assert.equal(res.code, 400);
});

test('状态路由：OPTIONS 预检返回 204', async () => {
  const { ctx, routes } = routesOf();
  await mod.apply(ctx);
  const state = routes.find((r) => r.path.endsWith('/state'));
  const res = await call(state.handler, { method: 'OPTIONS', url: '/api/dsh-whale-pixel-pet/state' });
  assert.equal(res.code, 204);
});

test('宿主半边：卸载时会释放全部路由与订阅', async () => {
  const { ctx, routes, effects } = makeCtx();
  await mod.apply(ctx);
  assert.equal(routes.length, 3, '三条路由');
  assert.ok(effects.length >= 3 + 11, '三条路由 + 十一个状态事件订阅，实际 ' + effects.length);
  for (const e of effects) {
    const dispose = e.fn();
    assert.equal(typeof dispose, 'function', 'effect 应返回释放函数：' + e.label);
    dispose();                       // 真的释放掉，别留下定时器
  }
});

/* ============================ 任务 / 进度 / 用量 ============================ */

async function stateHandler(opts) {
  const made = makeCtx(opts);
  await mod.apply(made.ctx);
  const handler = made.routes.find((r) => r.path.endsWith('/state')).handler;
  return Object.assign(made, { handler });
}

test('状态：宿主事件真的能驱动出任务与进度（接线正确）', async () => {
  const { handler, listeners, effects } = await stateHandler();
  try {
    assert.ok(fire(listeners, 'agent/status', { status: 'running' }) > 0, '应当订阅了 agent/status');
    assert.ok(fire(listeners, 'tools/result', { exec: { name: 'pwsh' } }) > 0, '应当订阅了 tools/result');
    fire(listeners, 'tools/result', { exec: { name: 'edit' } });
    fire(listeners, 'subagent/start', { name: 'researcher' });

    const d = JSON.parse((await call(handler, { url: '/api/dsh-whale-pixel-pet/state' })).text());
    assert.equal(d.progress.steps, 2, '两步工具');
    assert.equal(d.progress.subagents, 1);
    assert.equal(d.progress.lastTool, 'edit');
    assert.equal(d.task.kind, 'work');
    assert.match(d.task.text, /edit/);
    assert.ok(d.usage && typeof d.usage.text === 'string' && d.usage.text.length > 0, '用量要有人话');
  } finally {
    disposeAll(effects);
  }
});

test('状态：目标服务里的活跃目标 = 目前任务', async () => {
  const { handler, effects } = await stateHandler({
    services: {
      agents: { list: () => [{ id: 's1' }] },
      goals: { get: () => ({ objective: '把桌宠做完', status: 'active', rounds: 3, maxGoalRounds: 12 }) },
    },
  });
  try {
    const d = JSON.parse((await call(handler, { url: '/api/dsh-whale-pixel-pet/state' })).text());
    assert.equal(d.task.kind, 'goal');
    assert.equal(d.task.text, '把桌宠做完');
    assert.equal(d.task.goal.rounds, 3);
  } finally {
    disposeAll(effects);
  }
});

test('状态：GUI 页面不在时，宿主自己判断忙闲（桌面版不瞎）', async () => {
  const { handler, listeners, effects } = await stateHandler();
  // 把"客户端上报过期"的阈值压到 0：不受其它用例刚 POST 过的影响
  const oldStale = process.env.DSH_PET_STALE_MS;
  process.env.DSH_PET_STALE_MS = '0';
  try {
    fire(listeners, 'agent/status', { status: 'running' });
    fire(listeners, 'tools/result', { exec: { name: 'pwsh' } });
    const d = JSON.parse((await call(handler, { url: '/api/dsh-whale-pixel-pet/state' })).text());
    assert.equal(d.hostRunning, true, '宿主应知道自己在忙');
    // 没有任何客户端上报（posts=0）时，state 也要由宿主兜底成 working
    assert.equal(d.state, 'working', '客户端数据过期时应由宿主兜底，实际 ' + d.state);
    assert.equal(d.detail, 'pwsh');
  } finally {
    if (oldStale === undefined) delete process.env.DSH_PET_STALE_MS;
    else process.env.DSH_PET_STALE_MS = oldStale;
    disposeAll(effects);
  }
});

/* ============================ 桌面版控制路由 ============================ */

async function desktopHandler() {
  const { ctx, routes } = makeCtx();
  await mod.apply(ctx);
  return routes.find((r) => r.path.endsWith('/desktop')).handler;
}

test('桌面版控制：未运行时状态正确，字段齐备', async () => {
  const handler = await desktopHandler();
  try { unlinkSync(TEST_PID_FILE); } catch (e) { /* 本来就没有 */ }
  const res = await call(handler, { url: '/api/dsh-whale-pixel-pet/desktop' });
  assert.equal(res.code, 200);
  const d = JSON.parse(res.text());
  assert.equal(d.running, false);
  assert.equal(d.pid, null);
  for (const key of ['exe', 'exeExists', 'appDir', 'appDirExists', 'autoStart']) {
    assert.ok(key in d, '状态里应该有 ' + key);
  }
});

test('桌面版控制：自动启动开关能读写（DSH 重启后她自动回来靠它）', async () => {
  const handler = await desktopHandler();
  const cfgFile = path.join(TMP, 'config.json');

  const off = JSON.parse((await call(handler, {
    method: 'POST', url: '/api/dsh-whale-pixel-pet/desktop', body: { action: 'autostart', value: false },
  })).text());
  assert.equal(off.ok, true);
  assert.equal(off.autoStart, false);
  assert.equal(JSON.parse(readFileSync(cfgFile, 'utf8')).autoStart, false, '要落到配置文件里');

  const on = JSON.parse((await call(handler, {
    method: 'POST', url: '/api/dsh-whale-pixel-pet/desktop', body: { action: 'autostart', value: true },
  })).text());
  assert.equal(on.autoStart, true);
  assert.equal(JSON.parse(readFileSync(cfgFile, 'utf8')).autoStart, true);

  const status = JSON.parse((await call(handler, { url: '/api/dsh-whale-pixel-pet/desktop' })).text());
  assert.equal(status.autoStart, true, '状态里要反映当前开关');

  // 收回 false，免得影响别的用例
  await call(handler, {
    method: 'POST', url: '/api/dsh-whale-pixel-pet/desktop', body: { action: 'autostart', value: false },
  });
});

test('桌面版控制：自动启动失败也绝不能让宿主半边挂掉', async () => {
  // 把 autoStart 打开，同时 Electron 指向不存在的路径
  writeFileSync(path.join(TMP, 'config.json'), JSON.stringify({ autoStart: true }), 'utf8');
  const { ctx } = makeCtx();
  await assert.doesNotReject(mod.apply(ctx), 'apply 必须安全返回');
  writeFileSync(path.join(TMP, 'config.json'), JSON.stringify({ autoStart: false }), 'utf8');
});

test('桌面版控制：未知 action 返回 400', async () => {
  const handler = await desktopHandler();
  const res = await call(handler, {
    method: 'POST', url: '/api/dsh-whale-pixel-pet/desktop', body: { action: '乱来' },
  });
  assert.equal(res.code, 400);
  assert.equal(JSON.parse(res.text()).ok, false);
});

test('桌面版控制：运行时缺失要给出可读错误，而不是崩掉', async () => {
  const handler = await desktopHandler();
  const old = process.env.DSH_PET_ELECTRON;
  process.env.DSH_PET_ELECTRON = path.join(TMP, '不存在的-electron.exe');
  try {
    const res = await call(handler, {
      method: 'POST', url: '/api/dsh-whale-pixel-pet/desktop', body: { action: 'start' },
    });
    assert.equal(res.code, 500);
    const d = JSON.parse(res.text());
    assert.equal(d.ok, false);
    assert.match(d.error, /Electron/, '错误信息要说明是运行时找不到');
  } finally {
    if (old === undefined) delete process.env.DSH_PET_ELECTRON;
    else process.env.DSH_PET_ELECTRON = old;
  }
});

test('桌面版控制：完整生命周期（起 → 查 → 再起 → 停）', async () => {
  const handler = await desktopHandler();

  // 用一个短命子进程冒充桌面版，绝不碰真实桌宠
  const dummy = spawn(process.execPath, ['-e', 'setTimeout(function(){}, 20000)'], { stdio: 'ignore' });
  writeFileSync(TEST_PID_FILE, String(dummy.pid), 'utf8');

  const got = JSON.parse((await call(handler, { url: '/api/dsh-whale-pixel-pet/desktop' })).text());
  assert.equal(got.running, true, '进程活着就该认成运行中');
  assert.equal(got.pid, dummy.pid);

  const again = JSON.parse((await call(handler, {
    method: 'POST', url: '/api/dsh-whale-pixel-pet/desktop', body: { action: 'start' },
  })).text());
  assert.equal(again.ok, true);
  assert.equal(again.already, true, '已在运行时不该重复启动');

  const stopRes = await call(handler, {
    method: 'POST', url: '/api/dsh-whale-pixel-pet/desktop', body: { action: 'stop' },
  });
  assert.equal(stopRes.code, 200);
  const stopped = JSON.parse(stopRes.text());
  assert.equal(stopped.ok, true);
  assert.equal(stopped.stopped, true);
  assert.ok(!existsSync(TEST_PID_FILE), '停掉之后 pid 文件要清掉');

  // 等 taskkill 生效
  let dead = false;
  for (let i = 0; i < 40 && !dead; i++) {
    await new Promise((r) => setTimeout(r, 50));
    try { process.kill(dummy.pid, 0); } catch (e) { dead = e.code === 'ESRCH'; }
  }
  assert.equal(dead, true, '子进程应已被结束');
});

test('桌面版控制：没在运行时 stop 是幂等的', async () => {
  const handler = await desktopHandler();
  try { unlinkSync(TEST_PID_FILE); } catch (e) { /* ignore */ }
  const res = await call(handler, {
    method: 'POST', url: '/api/dsh-whale-pixel-pet/desktop', body: { action: 'stop' },
  });
  assert.equal(res.code, 200);
  assert.equal(JSON.parse(res.text()).already, true);
});
/* ============================ 审批命令通道 ============================ */

test('审批通道：桌面写命令文件 → 宿主消费 → GET 能看到 → 回报后清空', async () => {
  const { ctx, routes, effects } = makeCtx();
  await mod.apply(ctx);
  const state = routes.find((r) => r.path.endsWith('/state'));
  const cmdFile = path.join(TMP, 'command.json');

  // 桌面端把命令写到文件里（桌面进程拿不到 /api 鉴权，所以反向也走文件）
  writeFileSync(cmdFile, JSON.stringify({ action: 'approve', nonce: 4242 }), 'utf8');

  // 宿主每 800ms 轮询一次
  await new Promise((r) => setTimeout(r, 1200));

  const got = JSON.parse((await call(state.handler, { url: '/api/dsh-whale-pixel-pet/state' })).text());
  assert.ok(got.command, 'GET 应当能看到待执行命令');
  assert.equal(got.command.action, 'approve');
  assert.equal(got.command.nonce, 4242);
  assert.ok(!existsSync(cmdFile), '命令文件应当已被消费掉');

  // 页面回报结果
  await call(state.handler, { method: 'POST', url: '/api/dsh-whale-pixel-pet/state', body: { commandResult: { nonce: 4242, ok: true } } });
  const after = JSON.parse((await call(state.handler, { url: '/api/dsh-whale-pixel-pet/state' })).text());
  assert.equal(after.command, null, '收到回执后应当清空待执行命令');
  assert.equal(after.commandResult.ok, true);
  disposeAll(effects);
});

test('审批通道：非 approve 的命令与坏 JSON 都不会被当成命令', async () => {
  const { ctx, routes, effects } = makeCtx();
  await mod.apply(ctx);
  const state = routes.find((r) => r.path.endsWith('/state'));
  const cmdFile = path.join(TMP, 'command.json');

  writeFileSync(cmdFile, JSON.stringify({ action: 'reboot-everything' }), 'utf8');
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(JSON.parse((await call(state.handler, { url: '/api/dsh-whale-pixel-pet/state' })).text()).command, null, '不认识的动作不能被执行');

  writeFileSync(cmdFile, '{坏掉的 json', 'utf8');
  await new Promise((r) => setTimeout(r, 1200));
  const after = JSON.parse((await call(state.handler, { url: '/api/dsh-whale-pixel-pet/state' })).text());
  assert.equal(after.command, null, '坏 JSON 也不能崩');
  assert.ok(!existsSync(cmdFile), '坏文件也要被消费掉，否则会一直卡着');
  disposeAll(effects);
});
