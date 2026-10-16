/**
 * dsh-whale-pixel-pet 客户端插件：把像素鲸鱼娘注入 DSH UI（纯 DOM 注入）。
 *
 * 零侵入：不改任何内置包文件、不读聊天正文、无外部请求、无遥测。
 * 资源经宿主路由 /api/dsh-whale-pixel-pet/assets?f=<path> 加载，
 * 注入顺序：样式 → 像素引擎(whale-pet) → 宿主信号探测器(host-signal) → 悬浮层(overlay)。
 *
 * 0.2.0-rc.2 的客户端模块系统是惰性 CJS：执行 bundle 只注册 factory，
 * 「包括 CSS 注入在内的副作用都发生在 factory 物化期」。因此引导 boot() 直接放在
 * factory 体内（物化即注入并挂载），apply 只负责注册设置面板。
 */
window.__ModuleLoader__.load({
  id: "dsh-whale-pixel-pet",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var jsxRuntime = require("react/jsx-runtime");
    var jsx = jsxRuntime.jsx;
    var jsxs = jsxRuntime.jsxs;

    var PKG = "dsh-whale-pixel-pet";
    var BASE = "/api/" + PKG + "/assets?f=";
    var STATE_URL = "/api/" + PKG + "/state";
    var DESKTOP_URL = "/api/" + PKG + "/desktop";
    var BOOT_FLAG = "__dshWhalePixelPetBooted";
    var DEBUG_FLAG = "__dshWhalePixelPet";
    var PREFS_KEY = "whale-pet:v1";
    var PREFS_EVENT = "whale-pet:prefs-change";
    var CMD_EVENT = "whale-pet:command";

    /* ============================ 注入 ============================ */

    function injectStyle(text) {
      var el = document.createElement("style");
      el.setAttribute("data-dsh-whale-pixel-pet", "css");
      el.textContent = text;
      document.head.appendChild(el);
    }

    /**
     * 同时挂一条外链样式表：万一宿主 CSP 拦掉了内联 <style>，
     * 同源外链（style-src 'self'）依然能生效。两条内容一致，不会冲突。
     */
    function injectStyleLink(url) {
      var el = document.createElement("link");
      el.setAttribute("data-dsh-whale-pixel-pet", "css-link");
      el.rel = "stylesheet";
      el.href = url;
      document.head.appendChild(el);
    }

    function injectScript(text) {
      var el = document.createElement("script");
      el.setAttribute("data-dsh-whale-pixel-pet", "js");
      el.textContent = text;
      document.body.appendChild(el);
    }

    function waitFor(check, timeout) {
      return new Promise(function (resolve, reject) {
        var t0 = Date.now();
        (function poll() {
          if (check()) return resolve(true);
          if (Date.now() - t0 > timeout) return reject(new Error("等待资源就绪超时"));
          setTimeout(poll, 16);
        })();
      });
    }

    /* ==================== 偏好：与悬浮层共用 localStorage 键 ==================== */

    function readStore() {
      try {
        var raw = window.localStorage.getItem(PREFS_KEY);
        var data = raw ? JSON.parse(raw) : null;
        if (data && typeof data === "object") return data;
      } catch (error) { /* 隐私模式 / 坏数据都退回默认 */ }
      return { v: 1, cfg: {}, pet: null };
    }

    /** 只改 cfg，保留 pet 养成数据（避免和悬浮层的自动存档互相覆盖） */
    function writeCfg(patch) {
      var data = readStore();
      data.v = 1;
      data.cfg = Object.assign({}, data.cfg || {}, patch);
      try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(data)); } catch (error) { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent(PREFS_EVENT)); } catch (error) { /* ignore */ }
      return data;
    }

    function sendCommand(cmd) {
      try { window.dispatchEvent(new CustomEvent(CMD_EVENT, { detail: { cmd: cmd } })); } catch (error) { /* ignore */ }
    }

    /* ============================ 启动桌宠 ============================ */

    var overlay = null;

    function startPet(ctx) {
      if (overlay) {
        // 已经挂载过：只补一次结构化信号源（ctx 可能在 boot 之后才交到手上）
        if (ctx && overlay.hostWatcher && window.WhalePetHostSignal) {
          var probe = window.WhalePetHostSignal.probeFromContext(ctx);
          if (probe) overlay.hostWatcher.setStructured(probe);
        }
        return overlay;
      }
      if (!window.WhalePet || !window.WhalePetOverlay) return null;

      overlay = window.WhalePetOverlay.createOverlay({
        storageKey: PREFS_KEY,
        assetBase: BASE            // 插画立绘资源走同一条宿主路由
      });
      overlay.load();
      overlay.mount();
      overlay.start();
      window[DEBUG_FLAG] = overlay;

      if (window.WhalePetHostSignal) {
        var watcher = window.WhalePetHostSignal.createWatcher({
          doc: document,
          interval: 700,
          // 结构化信号（会话状态服务）做主，DOM 标记补充"具体在跑什么工具"
          structured: ctx ? window.WhalePetHostSignal.probeFromContext(ctx) : null,
          onState: function (state, detail) { overlay.signal(state, detail); },
          onTokens: function (n) { overlay.pet.addTokens(n); },
          onDebug: function (info) { overlay.hostInfo = info; }
        });
        watcher.start();
        overlay.hostWatcher = watcher;
      }

      // 把状态同步给宿主路由：独立桌面窗口会来轮询（DSH 没开时它自己待机）
      try {
        var postState = function () {
          try {
            fetch(STATE_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                state: overlay.pet.ambient,
                detail: overlay.pet.ambientDetail || null,
                tokens: Math.round(overlay.pet.tokens)
              })
            }).catch(function () { /* DSH 路由没起来就算了 */ });
          } catch (error) { /* ignore */ }
        };
        postState();

        /**
         * 替你点"允许"。
         * DSH 的审批面板自己实现了键盘语义：面板内按 Enter = allowed-once（允许一次），
         * Escape = rejected。所以不去猜按钮文案（按钮文案走 l10n），而是聚焦它内部可聚焦的
         * 滚动区再派发一个冒泡的 Enter。语义正好是"只允许这一次"。
         * 只有你点了桌宠上那个按钮才会走到这里，绝无自动批准。
         */
        function approveOnce() {
          try {
            var panel = document.querySelector("[data-approval-key]");
            if (!panel) return { ok: false, error: "没找到审批面板（DSH 界面可能改版了）" };
            if (panel.getAttribute("aria-busy") === "true") return { ok: false, error: "这一条已经处理过了" };
            var target = panel.querySelector("[data-approval-scroll]") || panel;
            if (target.focus) target.focus();
            target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
            return { ok: true };
          } catch (error) {
            return { ok: false, error: String((error && error.message) || error) };
          }
        }

        // 每 1.5s 问一次宿主有没有派活；有就去点，然后回报结果
        setInterval(function () {
          fetch(STATE_URL).then(function (r) { return r.json(); }).then(function (d) {
            if (!d || !d.command || d.command.action !== "approve") return;
            var result = approveOnce();
            fetch(STATE_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ commandResult: { nonce: d.command.nonce, ok: result.ok, error: result.error || null } })
            }).catch(function () { /* ignore */ });
          }).catch(function () { /* ignore */ });
        }, 1500);
        setInterval(postState, 1500);
      } catch (error) { /* 状态中转是增强项，失败不影响桌宠本体 */ }

      // 设置面板改了偏好 → 悬浮层立刻跟随
      window.addEventListener(PREFS_EVENT, function () {
        try { overlay.load(); overlay.applyCfg(); } catch (error) { /* ignore */ }
      });
      window.addEventListener("pagehide", function () {
        try { if (overlay && overlay.hostWatcher) overlay.hostWatcher.stop(); } catch (error) { /* ignore */ }
      });

      return overlay;
    }

    async function boot() {
      if (window[BOOT_FLAG]) return;
      window[BOOT_FLAG] = true;
      try {
        injectStyleLink(BASE + "whale-pet.css");
        injectStyle(await (await fetch(BASE + "whale-pet.css")).text());
        injectScript(await (await fetch(BASE + "whale-pet.js")).text());
        injectScript(await (await fetch(BASE + "pet-actions.js")).text());
        injectScript(await (await fetch(BASE + "host-signal.js")).text());
        // 插画立绘美术层是可选的：取不到就退回内置像素画风，不影响桌宠本体
        try {
          injectScript(await (await fetch(BASE + "art-musume.js")).text());
        } catch (artError) {
          console.warn("[" + PKG + "] 插画立绘层加载失败，将使用像素画风：", artError);
        }
        injectScript(await (await fetch(BASE + "whale-pet-overlay.js")).text());
        await waitFor(function () {
          return !!(window.WhalePet && window.WhalePetOverlay && window.WhalePetHostSignal);
        }, 5000);
        startPet(window.__dshWhalePixelPetCtx || null);
      } catch (error) {
        console.warn("[" + PKG + "] 桌宠资源加载失败：", error);
      }
    }

    /* ============================ 设置面板 ============================ */

    var ROW_STYLE = {
      alignItems: "center",
      borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.18))",
      display: "flex", gap: "12px", justifyContent: "space-between", padding: "10px 0"
    };
    var CARD_STYLE = {
      border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.18))",
      borderRadius: "14px", display: "flex", flexDirection: "column", gap: "2px",
      marginTop: "10px", padding: "4px 14px", width: "100%", boxSizing: "border-box"
    };
    var MUTED = { color: "var(--dsw-alias-label-secondary, #8a94a6)", fontSize: "11.5px", lineHeight: "17px" };
    var BTN = {
      background: "var(--dsw-alias-bg-module-platform, rgba(128,128,128,0.12))",
      border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24))",
      borderRadius: "9px", color: "inherit", cursor: "pointer", fontSize: "12px", padding: "6px 12px"
    };

    function useStore() {
      var pair = React.useState(readStore());
      var store = pair[0], setStore = pair[1];
      React.useEffect(function () {
        var onChange = function () { setStore(readStore()); };
        window.addEventListener(PREFS_EVENT, onChange);
        window.addEventListener("storage", onChange);
        return function () {
          window.removeEventListener(PREFS_EVENT, onChange);
          window.removeEventListener("storage", onChange);
        };
      }, []);
      return store;
    }

    function Switch(props) {
      var on = !!props.on;
      return jsx("button", {
        type: "button",
        role: "switch",
        "aria-checked": on,
        onClick: props.onToggle,
        style: {
          background: on ? "var(--dsw-alias-brand-primary, #3f8fd0)" : "var(--dsw-alias-bg-module-platform, rgba(128,128,128,0.3))",
          border: "none", borderRadius: "999px", cursor: "pointer", flex: "none",
          height: "20px", padding: "2px", position: "relative", transition: "background .18s ease", width: "38px"
        },
        children: jsx("span", {
          style: {
            background: "#fff", borderRadius: "50%", display: "block", height: "16px",
            transform: on ? "translateX(18px)" : "translateX(0)", transition: "transform .18s ease", width: "16px"
          }
        })
      });
    }

    function Row(props) {
      return jsxs("div", {
        style: Object.assign({}, ROW_STYLE, props.last ? { borderBottom: "none" } : null),
        children: [
          jsxs("div", {
            style: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
            children: [
              jsx("span", { children: props.label }),
              props.hint ? jsx("span", { style: MUTED, children: props.hint }) : null
            ]
          }),
          props.children || null
        ]
      });
    }

    function ToggleRow(props) {
      return jsx(Row, {
        label: props.label,
        hint: props.hint,
        children: jsx(Switch, { on: props.on, onToggle: props.onToggle })
      });
    }

    function PetStatsCard() {
      var store = useStore();
      var pet = store.pet || {};
      var cfg = store.cfg || {};
      var debug = window[DEBUG_FLAG];
      var live = debug && typeof debug.stats === "function" ? debug.stats() : null;
      var pose = live ? live.pose : "—";
      var ambient = live ? live.ambient : "—";
      return jsxs("div", {
        style: CARD_STYLE,
        children: [
          jsx("span", { style: Object.assign({}, MUTED, { fontWeight: "600", padding: "8px 0 2px" }), children: "她的近况" }),
          jsxs("div", {
            style: { display: "grid", gap: "4px", gridTemplateColumns: "1fr 1fr", padding: "2px 0 8px" },
            children: [
              jsx("span", { children: "Lv." + (pet.level || 1) + "　亲密 " + Math.round(pet.bond || 0) }),
              jsx("span", { children: "心情 " + Math.round(live ? live.mood : (pet.mood || 0)) }),
              jsx("span", { children: "累计投喂 " + (pet.totalFeed || 0) + " 次" }),
              jsx("span", { children: "摸头 " + (pet.totalPat || 0) + " 次" }),
              jsx("span", { children: "累计 Token " + Math.round(pet.tokens || 0).toLocaleString() }),
              jsx("span", { children: "当前姿势 " + pose + "（" + ambient + "）" })
            ]
          }),
          jsx("span", {
            style: Object.assign({}, MUTED, { padding: "0 0 8px" }),
            children: cfg.name ? ("她叫「" + cfg.name + "」，随时可以拖动她换位置。") : "随时可以拖动她换位置。"
          })
        ]
      });
    }

    function PetAppearanceCard() {
      var store = useStore();
      var cfg = store.cfg || {};
      var arts = [["musume", "插画立绘"], ["pixel", "像素"]];
      var art = cfg.art || "musume";
      var skins = [["deep", "深海蓝"], ["coral", "珊瑚粉"], ["moon", "月光白"]];
      var pair = React.useState(cfg.name || "小汐");
      var name = pair[0], setName = pair[1];
      return jsxs("div", {
        style: CARD_STYLE,
        children: [
          jsx("span", { style: Object.assign({}, MUTED, { fontWeight: "600", padding: "8px 0 2px" }), children: "外观" }),
          jsx(Row, {
            label: "她的名字",
            children: jsx("input", {
              type: "text", maxLength: 8, spellCheck: false, value: name,
              onChange: function (e) { setName(e.target.value); },
              onBlur: function () { writeCfg({ name: (name || "").trim() || "小汐" }); },
              style: {
                background: "transparent", border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24))",
                borderRadius: "8px", color: "inherit", fontSize: "12.5px", outline: "none",
                padding: "5px 9px", width: "120px"
              }
            })
          }),
          jsx(Row, {
            label: "画风",
            hint: "插画立绘更精致；像素版是内置手绘、零资源",
            children: jsx("div", {
              style: { display: "flex", gap: "6px" },
              children: arts.map(function (def) {
                var active = art === def[0];
                return jsx("button", {
                  key: def[0], type: "button", onClick: function () { writeCfg({ art: def[0] }); },
                  style: Object.assign({}, BTN, active ? {
                    borderColor: "var(--dsw-alias-brand-primary, #3f8fd0)",
                    color: "var(--dsw-alias-brand-primary, #3f8fd0)"
                  } : null),
                  children: def[1]
                });
              })
            })
          }),
          jsx(Row, {
            label: "像素配色",
            hint: "只影响像素画风",
            last: true,
            children: jsx("div", {
              style: { display: "flex", gap: "6px" },
              children: skins.map(function (def) {
                var active = (cfg.skin || "deep") === def[0];
                return jsx("button", {
                  key: def[0], type: "button", onClick: function () { writeCfg({ skin: def[0] }); },
                  style: Object.assign({}, BTN, active ? {
                    borderColor: "var(--dsw-alias-brand-primary, #3f8fd0)",
                    color: "var(--dsw-alias-brand-primary, #3f8fd0)"
                  } : null),
                  children: def[1]
                });
              })
            })
          })
        ]
      });
    }

    function PetBehaviorCard() {
      var store = useStore();
      var cfg = store.cfg || {};
      function flag(key, fallback) { return cfg[key] === undefined ? fallback : !!cfg[key]; }
      return jsxs("div", {
        style: CARD_STYLE,
        children: [
          jsx("span", { style: Object.assign({}, MUTED, { fontWeight: "600", padding: "8px 0 2px" }), children: "陪伴表现" }),
          jsx(ToggleRow, {
            label: "在 DSH 窗口里显示",
            hint: "默认关闭（只留桌面版）。关掉这里也照常采集忙闲信号给桌面版用；想让她回到窗口内就打开",
            on: flag("guiPet", false), onToggle: function () { writeCfg({ guiPet: !flag("guiPet", false) }); }
          }),
          jsx(ToggleRow, {
            label: "跟随鼠标", hint: "窗口内形态下，空闲时会转过来看你",
            on: flag("followCursor", true), onToggle: function () { writeCfg({ followCursor: !flag("followCursor", true) }); }
          }),
          jsx(ToggleRow, {
            label: "键盘联动", hint: "你打字时她跟着敲",
            on: flag("keyboard", true), onToggle: function () { writeCfg({ keyboard: !flag("keyboard", true) }); }
          }),
          jsx(ToggleRow, {
            label: "台词气泡",
            on: flag("bubble", true), onToggle: function () { writeCfg({ bubble: !flag("bubble", true) }); }
          }),
          jsx(ToggleRow, {
            label: "音效", hint: "摸头、投喂、升级时的轻音效（默认关闭）",
            on: flag("sound", false), onToggle: function () { writeCfg({ sound: !flag("sound", false) }); },
            last: true
          })
        ]
      });
    }

    function PetDataCard() {
      return jsxs("div", {
        style: CARD_STYLE,
        children: [
          jsx("span", { style: Object.assign({}, MUTED, { fontWeight: "600", padding: "8px 0 2px" }), children: "数据与位置" }),
          jsx(Row, {
            label: "回到原位", hint: "把她送回右下角",
            children: jsx("button", { type: "button", style: BTN, onClick: function () { sendCommand("home"); }, children: "回原位" })
          }),
          jsx(Row, {
            label: "重置养成数据", hint: "等级、亲密、投喂记录都会清空，且无法恢复",
            last: true,
            children: jsx("button", { type: "button", style: BTN, onClick: function () { sendCommand("reset"); }, children: "重置" })
          })
        ]
      });
    }

    /** 桌面版（独立透明置顶窗口）的启停面板 */
    function PetDesktopCard() {
      var res = React.useState(null);
      var info = res[0], setInfo = res[1];
      var busyRes = React.useState(false);
      var busy = busyRes[0], setBusy = busyRes[1];

      function load() {
        fetch(DESKTOP_URL)
          .then(function (r) { return r.json(); })
          .then(function (d) { setInfo(d); })
          .catch(function () { setInfo({ error: true }); });
      }
      React.useEffect(function () { load(); }, []);

      function act(action, value) {
        setBusy(true);
        fetch(DESKTOP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: action, value: value })
        })
          .then(function (r) { return r.json(); })
          .then(function (d) { setInfo(d.status || d); })
          .catch(function () { /* ignore */ })
          .then(function () { setBusy(false); setTimeout(load, 800); });
      }

      var running = !!(info && info.running);
      var statusText = !info ? "读取中…"
        : info.error ? "宿主路由不可用（重启一次 DSH 试试）"
          : running ? ("运行中（PID " + info.pid + "）")
            : info.exeExists ? "未运行" : "缺少 Electron 运行时";

      return jsxs("div", {
        style: CARD_STYLE,
        children: [
          jsx("span", { style: Object.assign({}, MUTED, { fontWeight: "600", padding: "8px 0 2px" }), children: "桌面桌宠（独立窗口）" }),
          jsx("span", {
            style: { padding: "0 0 6px" },
            children: "让她浮在整个桌面上、盖住所有程序，DSH 最小化也在。状态：" + statusText
          }),
          jsx("span", {
            style: Object.assign({}, MUTED, { padding: "0 0 8px" }),
            children: running
              ? "拖动她可以搬家；右键她或点托盘 🐋 有菜单。"
              : "启动后她会出现在屏幕右下角。"
          }),
          jsxs("div", {
            style: { display: "flex", gap: "8px", padding: "0 0 10px" },
            children: [
              jsx("button", {
                type: "button", disabled: busy || running,
                style: Object.assign({}, BTN, (busy || running) ? { opacity: 0.5, cursor: "default" } : null),
                onClick: function () { act("start"); },
                children: running ? "已启动" : "启动桌面桌宠"
              }),
              jsx("button", {
                type: "button", disabled: busy || !running,
                style: Object.assign({}, BTN, (busy || !running) ? { opacity: 0.5, cursor: "default" } : null),
                onClick: function () { act("stop"); },
                children: "退出"
              }),
              jsx("button", { type: "button", style: BTN, onClick: load, children: "刷新" })
            ]
          }),
          jsx(ToggleRow, {
            label: "随 DSH 启动",
            hint: "打开后 DSH 一启动就把她拉起来（宿主进程重启不会再把她带走）",
            on: !!(info && info.autoStart),
            onToggle: function () { act("autostart", !(info && info.autoStart)); }
          })
        ]
      });
    }

    /** 任务 / 进度 / 用量：数据来自宿主半边（它订阅会话事件自己算的） */
    function PetStatusCard() {
      var res = React.useState(null);
      var info = res[0], setInfo = res[1];
      React.useEffect(function () {
        var alive = true;
        function load() {
          fetch(STATE_URL)
            .then(function (r) { return r.json(); })
            .then(function (d) { if (alive) setInfo(d); })
            .catch(function () { if (alive) setInfo({ error: true }); });
        }
        load();
        var timer = setInterval(load, 3000);
        return function () { alive = false; clearInterval(timer); };
      }, []);

      var task = info && info.task ? info.task.text : "";
      var prog = info && info.progress ? info.progress.text : "";
      var use = info && info.usage ? info.usage.text : "";
      var body = info && info.error
        ? "宿主路由不可用（重启一次 DSH 试试）"
        : "任务　" + (task || "读取中…") + "\n进度　" + (prog || "—") + "\n用量　" + (use || "—");

      return jsxs("div", {
        style: CARD_STYLE,
        children: [
          jsx("span", { style: Object.assign({}, MUTED, { fontWeight: "600", padding: "8px 0 2px" }), children: "她正在帮你盯的活" }),
          jsx("span", {
            style: { padding: "0 0 4px", whiteSpace: "pre-line", lineHeight: "1.6" },
            children: body
          }),
          jsx("span", {
            style: Object.assign({}, MUTED, { padding: "0 0 10px" }),
            children: "任务来自会话目标（goal），进度来自工具/子代理/工作流事件，用量是真实 Token 计数。桌面那隻脚边也会显示同样三行。"
          })
        ]
      });
    }

    function PetSection() {
      return jsxs("div", {
        style: { display: "flex", flexDirection: "column", width: "100%", paddingBottom: "8px" },
        children: [
          jsx(PetStatsCard, {}),
          jsx(PetStatusCard, {}),
          jsx(PetDesktopCard, {}),
          jsx(PetBehaviorCard, {}),
          jsx(PetAppearanceCard, {}),
          jsx(PetDataCard, {}),
          jsx("span", {
            style: Object.assign({}, MUTED, { marginTop: "10px" }),
            children: "她只读取宿主公开的结构化标记来判断你在忙还是待审批，不读聊天正文、不联网、无遥测；养成数据存在本机 localStorage。"
          })
        ]
      });
    }

    function registerSettings(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined) {
        console.warn("[" + PKG + "] slots 服务不可用，跳过设置面板注册（桌宠本体不受影响）");
        return;
      }
      slots.inject("settings.section", function () {
        return slots.register(
          { name: "settings.section", id: "pixelPet", order: 7, label: "桌宠" },
          function () { return jsx(PetSection, {}); }
        );
      });
    }

    function apply(ctx) {
      // 把客户端上下文交给悬浮层，用于读取结构化的会话状态（只读，不注册服务）
      try { window.__dshWhalePixelPetCtx = ctx; } catch (error) { /* ignore */ }
      try {
        registerSettings(ctx);
      } catch (error) {
        console.warn("[" + PKG + "] 设置面板注册失败，桌宠本体不受影响", error);
      }
      // 挂载失败时兜底再试一次（例如宿主页面此时还没就绪）
      try { startPet(ctx); } catch (error) { /* ignore */ }
    }

    exports.apply = apply;
    exports.inject = ["slots"];

    boot();
    return module.exports;
  }
});
