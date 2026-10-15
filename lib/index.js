// dsh-whale-pixel-pet —— 像素鲸鱼娘桌宠（宿主半边，零侵入）。
// 只做一件事：把包内 assets 目录以只读静态路由提供给浏览器
// （whale-pet.js / whale-pet-overlay.js / host-signal.js / whale-pet.css），
// 供 client.js 注入时加载。不修改任何内置包文件。
import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import * as Status from "./status.js";

/** Cordis 插件名（loader 诊断用）。 */
export const name = "dsh-whale-pixel-pet";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(HERE, "..", "assets");
const ROUTE = "/api/dsh-whale-pixel-pet/assets";
const STATE_ROUTE = "/api/dsh-whale-pixel-pet/state";
const DESKTOP_ROUTE = "/api/dsh-whale-pixel-pet/desktop";

/* ------------------------- 桌面版（独立窗口）控制 ------------------------- */

function desktopPaths() {
  const appDir = path.join(HERE, "..", "desktop");
  const exe = process.env.DSH_PET_ELECTRON
    || path.join(process.env.LOCALAPPDATA || os.tmpdir(), "dsh-whale-pet", "runtime", "electron.exe");
  // pid 文件位置可覆盖：便于测试，也便于一份代码跑多份实例
  const pidFile = process.env.DSH_PET_PID_FILE || path.join(appDir, ".pet.pid");
  return { appDir, exe, pidFile };
}

function readPid(file) {
  try {
    const n = parseInt(readFileSync(file, "utf8").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (error) {
    return null;
  }
}

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === "EPERM");   // 活着但没权限发信号
  }
}

function desktopStatus() {
  const { appDir, exe, pidFile } = desktopPaths();
  const pid = readPid(pidFile);
  return {
    running: processAlive(pid),
    pid: pid || null,
    exe,
    exeExists: existsSync(exe),
    appDir,
    appDirExists: existsSync(appDir),
    autoStart: readConfig().autoStart !== false,
  };
}

function startDesktop() {
  const { appDir, exe, pidFile } = desktopPaths();
  const status = desktopStatus();
  if (status.running) return { ok: true, already: true, pid: status.pid };
  if (!existsSync(exe)) {
    return { ok: false, error: "找不到 Electron 运行时：" + exe + "（可用环境变量 DSH_PET_ELECTRON 指定）" };
  }
  if (!existsSync(appDir)) return { ok: false, error: "找不到桌面端目录：" + appDir };

  // 必须清掉 ELECTRON_RUN_AS_NODE，否则 Electron 退化成纯 node，窗口不会出现
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(exe, ["."], { cwd: appDir, detached: true, stdio: "ignore", env });
  child.unref();
  try { writeFileSync(pidFile, String(child.pid), "utf8"); } catch (error) { /* 记不下 pid 也能跑 */ }
  return { ok: true, started: true, pid: child.pid };
}

function stopDesktop() {
  const { pidFile } = desktopPaths();
  const pid = readPid(pidFile);
  if (!pid || !processAlive(pid)) {
    try { unlinkSync(pidFile); } catch (error) { /* ignore */ }
    return { ok: true, already: true };
  }
  try {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { detached: true, stdio: "ignore" }).unref();
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
  try { unlinkSync(pidFile); } catch (error) { /* ignore */ }
  return { ok: true, stopped: true, pid };
}

/* --------------- 任务 / 进度 / 用量：宿主侧自己算一份 --------------- */

const statusState = Status.createStatusState();

/** 监听这些宿主事件来推进度 */
const STATUS_EVENTS = [
  "agent/status",
  "api-session/status",
  "tools/result",
  "subagent/start",
  "subagent/end",
  "workflow/start",
  "workflow/phase",
  "workflow/end",
  "agent/error",
  "goal/changed",
  "goal/activation-changed",
];

function usageText(tokens) {
  if (!tokens || tokens < 1) return "还没用量";
  if (tokens >= 1000000) return (tokens / 1000000).toFixed(2) + "M tokens";
  if (tokens >= 1000) return (tokens / 1000).toFixed(1) + "k tokens";
  return Math.round(tokens) + " tokens";
}

/** 客户端上报多久算过期（可用环境变量调，测试也靠它） */
function staleMs() {
  const n = Number(process.env.DSH_PET_STALE_MS);
  return Number.isFinite(n) && n >= 0 ? n : 8000;
}

/** 把收集器的快照合并进对外状态 */
function refreshStatus(now) {
  const t = typeof now === "number" ? now : Date.now();
  Status.beginTurnIfNeeded(statusState, t);
  const snap = Status.snapshot(statusState, t);
  state.task = snap.task;
  state.progress = snap.progress;
  state.usage = Object.assign({}, snap.usage, { tokens: state.tokens || 0, text: usageText(state.tokens) });
  state.hostRunning = !!statusState.running;

  // GUI 页面没在跑（客户端上报过期）时用宿主自己的判断兜底：
  // 这样 DSH 窗口关掉，桌面版照样知道你在忙。
  if (t - (state.at || 0) > staleMs()) {
    state.state = statusState.running ? (statusState.tools > 0 ? "working" : "thinking") : "idle";
    state.detail = statusState.lastTool || null;
  }
  return state;
}

/** 会话状态中转站的内存态（由 GUI 客户端上报） */
const state = { state: "idle", detail: null, tokens: 0, at: 0, posts: 0 };

/**
 * 桌面版的小配置（跟状态文件放一起）。
 * autoStart 默认 true —— DSH 重启后她会自己回来，不用再手动点一次。
 */
function configFilePath() {
  return path.join(path.dirname(stateFilePath()), "config.json");
}

function readConfig() {
  const defaults = { autoStart: true };
  try {
    const raw = JSON.parse(readFileSync(configFilePath(), "utf8"));
    if (raw && typeof raw === "object") return Object.assign(defaults, raw);
  } catch (error) { /* 第一次运行没有这个文件 */ }
  return defaults;
}

function writeConfig(patch) {
  const next = Object.assign(readConfig(), patch || {});
  try {
    mkdirSync(path.dirname(configFilePath()), { recursive: true });
    writeFileSync(configFilePath(), JSON.stringify(next), "utf8");
  } catch (error) { /* 写不进去也不影响运行 */ }
  return next;
}

/**
 * 状态文件：独立桌面窗口直接读这个文件，不走 HTTP。
 * 原因：DSH 的 web server 对 /api 路由有鉴权，外部进程拿不到凭证；
 * 用文件中转既不需要鉴权，也不依赖 web server 是否在跑。
 */
function stateFilePath() {
  const base = process.env.DSH_PET_STATE_DIR
    || path.join(process.env.LOCALAPPDATA || os.tmpdir(), "dsh-whale-pet");
  return path.join(base, "state.json");
}

function persistState() {
  try {
    const file = stateFilePath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(Object.assign({}, state, { stale: Date.now() - state.at > staleMs() })), "utf8");
  } catch (error) {
    // 写不进去不该影响桌宠本体
  }
}

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/** 把请求参数 f 解析为 assets 目录内的安全路径；越界返回 null。 */
function safeResolve(rel) {
  const target = path.normalize(path.join(ASSETS_DIR, rel));
  if (target !== ASSETS_DIR && !target.startsWith(ASSETS_DIR + path.sep)) return null;
  return target;
}

export async function apply(ctx) {
  persistState();                 // 起手先落一份 idle，桌面窗口随时可读
  // 必须走 inject —— apply 运行时刻 webserver 的 fiber 可能尚未创建
  ctx.inject(["webServer"], (wctx) => {
    const webServer = wctx.get("webServer");
    const dispose = webServer.register({
      kind: "exact",
      path: ROUTE,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url, "http://127.0.0.1");
          // f 可能带形如 ?v=1 的版本尾巴，剥掉再解析
          const rel = (url.searchParams.get("f") ?? "").split("?")[0];
          const file = safeResolve(rel);
          if (file === null || !existsSync(file) || !statSync(file).isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("not found");
            return;
          }
          const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
          res.writeHead(200, {
            "Content-Type": type,
            "Cache-Control": "public, max-age=3600",
          });
          createReadStream(file).pipe(res);
        } catch (error) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(String(error?.message ?? error));
        }
      },
    });
    wctx.effect(() => dispose, "dsh-whale-pixel-pet: 静态资源路由");

    // 会话状态中转站：GUI 里的客户端半边 POST 上来，独立桌面窗口 GET 走。
    // 这样桌面版不需要读 DSH 页面，DSH 没开时它自己待机即可。
    const disposeState = webServer.register({
      kind: "exact",
      path: STATE_ROUTE,
      handler: async (req, res) => {
        const send = (code, obj) => {
          res.writeHead(code, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          });
          res.end(JSON.stringify(obj));
        };
        if (req.method === "OPTIONS") { send(204, {}); return; }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
            if (body.length > 65536) req.destroy();
          });
          req.on("end", () => {
            try {
              const data = JSON.parse(body || "{}");
              if (typeof data.state === "string") state.state = data.state;
              if (data.detail !== undefined) state.detail = data.detail;
              if (typeof data.tokens === "number" && Number.isFinite(data.tokens)) {
                state.tokens = Math.max(state.tokens, Math.round(data.tokens));
              }
              state.at = Date.now();
              state.posts += 1;
              persistState();          // 桌面窗口读文件，比 HTTP 稳
              send(200, { ok: true });
            } catch (error) {
              send(400, { ok: false, error: String(error?.message ?? error) });
            }
          });
          return;
        }
        send(200, {
          state: state.state,
          detail: state.detail,
          tokens: state.tokens,
          at: state.at,
          posts: state.posts,
          task: state.task || null,
          progress: state.progress || null,
          usage: state.usage || null,
          hostRunning: !!state.hostRunning,
          stale: Date.now() - state.at > staleMs(),
        });
      },
    });
    wctx.effect(() => disposeState, "dsh-whale-pixel-pet: 状态中转路由");

    // 桌面版（独立窗口）的启停与状态：让 DSH 设置面板里一键启动/退出
    const disposeDesktop = webServer.register({
      kind: "exact",
      path: DESKTOP_ROUTE,
      handler: async (req, res) => {
        const send = (code, obj) => {
          res.writeHead(code, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(JSON.stringify(obj));
        };
        if (req.method === "OPTIONS") { send(204, {}); return; }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
            if (body.length > 8192) req.destroy();
          });
          req.on("end", () => {
            let action = "";
            let value;
            try {
              const data = JSON.parse(body || "{}");
              action = String((data && data.action) || "");
              value = data ? data.value : undefined;
            } catch (error) {
              action = "";
            }
            if (action === "start") {
              const result = startDesktop();
              send(result.ok ? 200 : 500, Object.assign({ status: desktopStatus() }, result));
              return;
            }
            if (action === "stop") {
              const result = stopDesktop();
              send(result.ok ? 200 : 500, Object.assign({ status: desktopStatus() }, result));
              return;
            }
            if (action === "autostart") {
              const cfg = writeConfig({ autoStart: value !== false });
              send(200, { ok: true, autoStart: cfg.autoStart, status: desktopStatus() });
              return;
            }
            send(400, { ok: false, error: "action 只能是 start / stop / autostart" });
          });
          return;
        }
        send(200, Object.assign({ ok: true }, desktopStatus()));
      },
    });
    wctx.effect(() => disposeDesktop, "dsh-whale-pixel-pet: 桌面版控制路由");
  });

  ctx.logger?.info?.("dsh-whale-pixel-pet: 已挂载（资源 " + ROUTE + "，状态 " + STATE_ROUTE + "，桌面版 " + DESKTOP_ROUTE + "）");

  // DSH 启动（含宿主热重载）时按配置把她拉起来。
  // 宿主进程树一旦被重启带走，她会跟着消失 —— 这里保证她自动回来。
  try {
    if (readConfig().autoStart !== false) {
      const started = startDesktop();
      ctx.logger?.info?.("dsh-whale-pixel-pet: 桌面桌宠自动启动 → " +
        (started.ok ? (started.already ? "已在运行" : "已启动 pid=" + started.pid) : "失败：" + started.error));
    }
  } catch (error) {
    ctx.logger?.warn?.("dsh-whale-pixel-pet: 自动启动桌面桌宠失败 " + (error?.message ?? error));
  }

  /* ---------------- 任务 / 进度 / 用量 ---------------- */

  // 推进度：订阅宿主事件（工具、子代理、工作流阶段、报错、目标变化）
  for (const eventName of STATUS_EVENTS) {
    try {
      const off = ctx.on(eventName, (payload) => {
        Status.reduce(statusState, eventName, payload, Date.now());
        refreshStatus();
      });
      ctx.effect(() => off, "dsh-whale-pixel-pet: 状态事件 " + eventName);
    } catch (error) {
      ctx.logger?.warn?.("dsh-whale-pixel-pet: 订阅 " + eventName + " 失败：" + (error?.message ?? error));
    }
  }

  // "目前任务"从 goals 服务轮询：插件是后加载的，也要能看到已经存在的目标
  ctx.inject(["goals", "agents"], (gctx) => {
    const goals = gctx.get("goals");
    const agents = gctx.get("agents");
    const tick = () => {
      try {
        const list = agents && agents.list ? agents.list() : [];
        let picked = null;
        for (const agent of list) {
          let goal = null;
          try { goal = goals.get(agent); } catch (error) { goal = null; }
          if (goal && (goal.status === "active" || goal.status === "paused")) { picked = goal; break; }
        }
        if (picked) {
          Status.reduce(statusState, "goal/changed", { goal: picked }, Date.now());
        } else if (statusState.goal) {
          // 目标消失/完成：别让她一直挂着旧任务
          Status.reduce(statusState, "goal/changed",
            { goal: Object.assign({}, statusState.goal, { status: "complete" }) }, Date.now());
        }
      } catch (error) { /* 服务形状变了也不能影响桌宠 */ }
      refreshStatus();
      persistState();
    };
    tick();
    const timer = setInterval(tick, 3000);
    if (timer && typeof timer.unref === "function") timer.unref();   // 别拖住进程退出（测试也靠它）
    gctx.effect(() => () => clearInterval(timer), "dsh-whale-pixel-pet: 目标轮询");
  });
}
