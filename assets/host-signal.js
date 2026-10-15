/*!
 * 鲸鱼娘像素桌宠 · 宿主信号探测器 host-signal.js
 * ---------------------------------------------------------------------------
 * 作用：把"DSH 现在在干什么"翻译成桌宠能懂的状态，共五种——
 *        idle（待机）· thinking（模型在跑）· working（工具有动作）
 *        approval（等你点确认）· error（出错了）
 *
 * 只读宿主 DOM 上公开的结构化标记，不读聊天正文、不改任何业务节点。
 * 所有探测都做了容错：标记不存在时安静地退回 idle，桌宠本体照常可玩。
 * 标记契约参考 DeepSeek Harness 0.2.0-rc.2（桌面端）。
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  'use strict';
  var API = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = API;
  if (typeof root === 'object' && root) root.WhalePetHostSignal = API;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * 结构化标记（按优先级从高到低探测；命中即用，不猜内容）。
   * 依据 DeepSeek Harness 0.2.0-rc.2 实际 DOM 契约核对过：
   *   · 待审批 = [data-approval-key]（不是 role="dialog"）
   *   · 工具卡完成态 [data-tool][data-state=ok] 仍留在 DOM，只有 running/preparing 算"在忙"
   *   · [data-turn-process] 表示这一轮"已结束"，绝不能当忙态用
   *   · 主题 = body[data-ds-dark-theme]，没有 data-theme / html.dark
   */
  var SEL = {
    approval: [
      '[data-approval-key]',
      '[data-approval]',
      '[data-permission-request]',
      '[data-tool-approval]',
      '[data-ask-approval]',
      '[data-approval-pending]'
    ],
    error: [
      '[data-tool][data-state="error"]',
      '[data-tool][data-state="failed"]',
      '[data-error]',
      '[data-state="error"]',
      '[data-state="failed"]'
    ],
    tool: ['[data-tool]'],
    terminal: ['[data-terminal][data-running]', '[data-terminal]'],
    think: ['[data-variant="think"][data-state="running"]'],
    running: ['[data-chat-running]'],
    streaming: ['[data-streaming]', '[data-chat-streaming]'],
    composer: ['[data-composer-input]'],
    usage: ['[data-usage]', '[data-token-usage]', '[data-context-usage]', '[data-usage-tokens]']
  };

  /** 工具还在跑的状态值 */
  var RUNNING_STATES = { running: 1, preparing: 1, pending: 1, streaming: 1 };
  /** 工具已结束的状态值 */
  var DONE_STATES = { ok: 1, success: 1, done: 1, stopped: 1, cancelled: 1, canceled: 1 };

  /** 每个工具跑完给的 Token 估值（没有用量标记时的兜底，保证"干活就有成长"） */
  var TOKENS_PER_TOOL = 900;
  /** 没有任何用量标记、但有正文时，用正文长度粗估 Token 的上限 */
  var MAX_TOKEN_JUMP = 200000;

  /**
   * 取第一个命中的元素。
   * list 允许是「选择器字符串」或「选择器数组」——传字符串时必须整体当一个选择器用，
   * 否则会退化成逐字符查询（字符 'i' 会命中页面里的 <i> 等元素，造成误判）。
   */
  function q(doc, list) {
    var arr = typeof list === "string" ? [list] : list;
    for (var i = 0; i < arr.length; i++) {
      try {
        var el = doc.querySelector(arr[i]);
        if (el) return el;
      } catch (e) { /* 选择器不被支持就跳过 */ }
    }
    return null;
  }

  function qa(doc, sel) {
    if (typeof sel !== "string") return [];
    try { return doc.querySelectorAll(sel); } catch (e) { return []; }
  }

  /**
   * "这个错还算不算数"。
   * 失败的工具块会一直留在对话记录里，如果只看"页面上有没有错误元素"，
   * 她就会因为很久以前的一次失败**永远蔫着**。所以判据改成：
   * 只有在最后一个错误之后**没有**出现过成功/正在跑的工具时，才算当前出错。
   */
  function errorIsCurrent(errors, tools) {
    if (!errors || errors.length === 0) return false;
    var lastError = errors[errors.length - 1];
    var FOLLOWING = 4;                       // Node.DOCUMENT_POSITION_FOLLOWING
    for (var i = 0; i < tools.length; i++) {
      var st = (tools[i].getAttribute("data-state") || "").toLowerCase();
      var recovered = st === "ok" || RUNNING_STATES[st];
      if (!recovered) continue;
      try {
        if (lastError.compareDocumentPosition(tools[i]) & FOLLOWING) return false;
      } catch (e) { /* 拿不到文档顺序就当它算数 */ }
    }
    return true;
  }

  /** 把 "1,234" / "12.3k" / "1.2万" 解析成数字 */
  function parseNum(raw) {
    if (raw == null) return null;
    var s = String(raw).replace(/[,\s_]/g, '');
    var m = s.match(/(\d+(?:\.\d+)?)\s*([kK万wW])?/);
    if (!m) return null;
    var n = parseFloat(m[1]);
    if (!isFinite(n)) return null;
    var unit = m[2];
    if (unit === 'k' || unit === 'K') n *= 1000;
    else if (unit === '万') n *= 10000;
    else if (unit === 'w' || unit === 'W') n *= 10000;
    return Math.round(n);
  }

  function Watcher(opts) {
    opts = opts || {};
    this.doc = opts.doc || document;
    this.interval = opts.interval || 700;
    this.onState = opts.onState || function () {};
    this.onTokens = opts.onTokens || function () {};
    this.onDebug = opts.onDebug || null;
    this.structured = opts.structured || null;

    this.state = 'idle';
    this.lastSeenTokens = 0;
    this.toolsRunning = 0;
    this.lastToolSig = '';
    this.timer = null;
    this.observer = null;
    this._pending = false;
    this._lastErrorAt = 0;
  }

  /**
   * 结构化信号优先：DSH 客户端自己就暴露了"哪些会话在跑 / 哪些在等确认"。
   * 比读 DOM 稳，DOM 只用来补充"具体在跑什么工具"。
   */
  function probeFromContext(ctx) {
    try {
      var ui = ctx && typeof ctx.get === "function" ? ctx.get("uiSession") : null;
      var status = ui && ui.sessionStatus;
      if (!status || typeof status.getSnapshot !== "function") return null;
      return function () {
        var snap = status.getSnapshot();
        var running = false, pending = false, count = 0;
        var visit = function (v) {
          if (!v || typeof v !== "object") return;
          count++;
          if (v.running) running = true;
          if (v.pendingInteraction) pending = true;
        };
        if (snap && typeof snap.forEach === "function") snap.forEach(visit);
        else if (snap && snap.sessions && typeof snap.sessions.forEach === "function") snap.sessions.forEach(visit);
        else if (snap && typeof snap === "object") {
          for (var k in snap) if (Object.prototype.hasOwnProperty.call(snap, k)) visit(snap[k]);
        }
        return { running: running, pendingInteraction: pending, count: count };
      };
    } catch (error) {
      return null;
    }
  }

  Watcher.prototype.setStructured = function (fn) {
    this.structured = fn || null;
    return this;
  };

  /** 读一次当前状态，不发事件 */
  Watcher.prototype.read = function () {
    var doc = this.doc;
    var structured = null;
    try { structured = this.structured ? this.structured() : null; } catch (error) { structured = null; }

    var errors = qa(doc, SEL.error.join(','));
    var tools = qa(doc, SEL.tool.join(','));
    var approval = q(doc, SEL.approval);
    var running = q(doc, SEL.running);
    var streaming = q(doc, SEL.streaming) || q(doc, SEL.think);
    var terminal = q(doc, SEL.terminal);
    var termRunning = !!q(doc, '[data-terminal][data-running]');

    var runningCount = 0;
    var sig = '';
    for (var i = 0; i < tools.length; i++) {
      var t = tools[i];
      var name = t.getAttribute('data-tool') || '';
      var st = (t.getAttribute('data-state') || '').toLowerCase();
      if (RUNNING_STATES[st]) runningCount++;
      sig += name + ':' + st + ';';
    }

    var state = 'idle';
    var detail = null;
    if (approval || (structured && structured.pendingInteraction)) {
      state = 'approval';
      detail = 'approval';
    } else if (errorIsCurrent(errors, tools)) {
      state = 'error';
      detail = errors[errors.length - 1].getAttribute('data-tool') || 'tool';
    } else if (runningCount > 0 || termRunning) {
      state = 'working';
      detail = tools.length ? (tools[tools.length - 1].getAttribute('data-tool') || null) : (termRunning ? 'terminal' : null);
    } else if (running || streaming || (structured && structured.running)) {
      state = 'thinking';
      detail = structured && structured.running ? 'session' : 'chat';
    }

    return {
      state: state,
      detail: detail,
      toolCount: tools.length,
      runningCount: runningCount,
      signature: sig,
      structured: structured,
      hasTerminal: !!terminal,
      hasApproval: !!approval,
      hasRunning: !!running
    };
  };

  /** 用量数字：先看标记，再看属性，最后退回"工具跑完估一笔" */
  Watcher.prototype.readTokens = function (snapshot) {
    var doc = this.doc;
    var found = null;

    // 1) 专用用量标记
    var nodes = qa(doc, SEL.usage.join(','));
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var cand = parseNum(el.getAttribute('data-usage') || el.getAttribute('data-token-usage') ||
        el.getAttribute('data-context-usage') || el.getAttribute('data-usage-tokens') || el.textContent);
      if (cand != null && (found == null || cand > found)) found = cand;
    }
    // 2) 兜底：在输入区/用量区附近找 "1234 tokens" 这类文本
    if (found == null) {
      var scope = qa(doc, '[data-composer], [data-usage-area], [data-chat-header], header, [data-composer-input]');
      for (var j = 0; j < scope.length; j++) {
        var txt = (scope[j].textContent || '').slice(0, 400);
        var m = txt.match(/([\d][\d,.\s]*[kK万wW]?)\s*(?:tokens?|令牌)/i);
        if (m) {
          var n = parseNum(m[1]);
          if (n != null && (found == null || n > found)) found = n;
        }
      }
    }
    return found;
  };

  Watcher.prototype.tick = function () {
    var snap = this.read();
    var self = this;

    // 工具"跑完"的事件：data-state 从 running 变成 ok/stopped
    var completed = 0;
    if (this._prevSig && snap.signature !== this._prevSig) {
      var prev = this._countRunning(this._prevSig);
      if (prev > 0 && snap.runningCount < prev) completed = prev - snap.runningCount;
    }
    this._prevSig = snap.signature;

    // Token：优先真实用量，其次按"跑完的工具数"估
    var tokens = this.readTokens(snap);
    if (tokens != null) {
      if (this.lastSeenTokens === 0) this.lastSeenTokens = tokens;      // 首帧只对齐基线
      else if (tokens > this.lastSeenTokens) {
        var delta = Math.min(MAX_TOKEN_JUMP, tokens - this.lastSeenTokens);
        this.lastSeenTokens = tokens;
        if (delta > 0) this.onTokens(delta);
      }
    } else if (completed > 0) {
      this.lastSeenTokens += completed * TOKENS_PER_TOOL;
      this.onTokens(completed * TOKENS_PER_TOOL);
    }

    this.toolsRunning = snap.runningCount;
    if (snap.state !== this.state) {
      this.state = snap.state;
      this.onState(snap.state, snap.detail);
    } else {
      // 状态没变也要照常上报，让桌宠知道"还在忙"（内部会续期姿势钉住）
      this.onState(snap.state, snap.detail);
    }

    if (this.onDebug) {
      try {
        this.onDebug({
          state: snap.state, tools: snap.toolCount, running: snap.runningCount,
          tokens: this.lastSeenTokens, structured: snap.structured
        });
      } catch (e) { /* ignore */ }
    }
  };

  Watcher.prototype._countRunning = function (sig) {
    var parts = String(sig).split(';');
    var n = 0;
    for (var i = 0; i < parts.length; i++) {
      var st = parts[i].split(':')[1];
      if (st && RUNNING_STATES[st.trim()]) n++;
    }
    return n;
  };

  Watcher.prototype.start = function () {
    if (this.timer) return this;
    var self = this;
    this.tick();
    this.timer = setInterval(function () { self.tick(); }, this.interval);

    // DOM 变化时立刻补一次探测（节流），移动端/桌面端都够用
    try {
      if (typeof MutationObserver !== 'undefined') {
        this.observer = new MutationObserver(function () {
          if (self._pending) return;
          self._pending = true;
          setTimeout(function () { self._pending = false; self.tick(); }, 120);
        });
        this.observer.observe(this.doc.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-state', 'data-tool', 'data-chat-running', 'data-approval', 'data-usage', 'data-token-usage']
        });
      }
    } catch (e) { /* 观察失败也不影响轮询 */ }
    return this;
  };

  Watcher.prototype.stop = function () {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.observer) { try { this.observer.disconnect(); } catch (e) { /* ignore */ } this.observer = null; }
    return this;
  };

  function createWatcher(opts) { return new Watcher(opts); }

  return {
    createWatcher: createWatcher,
    Watcher: Watcher,
    probeFromContext: probeFromContext,
    SELECTORS: SEL,
    TOKENS_PER_TOOL: TOKENS_PER_TOOL,
    parseNum: parseNum
  };
});
