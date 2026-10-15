/*!
 * 鲸鱼娘像素桌宠 · 悬浮层 whale-pet-overlay.js
 * ---------------------------------------------------------------------------
 * 职责：把 Pet 引擎挂到宿主页面上——canvas 渲染、鼠标/键盘交互、右键菜单、
 *      设置面板、气泡、存档。刻意做到"零侵入"：
 *        · canvas / 气泡全程 pointer-events:none，不遮挡宿主任何业务 DOM
 *        · 只在命中宠物本体时才在捕获阶段拦截指针事件
 *        · 只操作自己创建的节点，不改宿主节点、不改内置包文件
 * 依赖：whale-pet.js（UMD，先加载）
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  'use strict';
  var API = factory(root.WhalePet);
  if (typeof module === 'object' && module && module.exports) module.exports = API;
  if (typeof root === 'object' && root) root.WhalePetOverlay = API;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (W) {
  'use strict';

  if (!W) throw new Error('[whale-pet] 需要先加载 whale-pet.js');

  var ROOT_SEL = '[data-dsh-whale-pet-root]';
  var Z = 2147482000;

  var DEFAULTS = {
    name: '小汐',
    sound: false,
    bubble: true,
    followCursor: true,
    keyboard: true,
    hidden: false,
    skin: 'deep',
    art: 'musume',        // 画风：musume=插画立绘（默认）/ pixel=内置像素
    guiPet: false,        // 是否在 DSH 窗口里画出她；默认 false —— 只留桌面版
    scale: 1
  };

  function h(tag, cls, attrs) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (attrs) for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  /** 用 JS 内联样式兜死关键属性（不走 CSS 文件，CSP/加载失败都不影响） */
  function harden(el, styles) {
    if (!el || !el.style) return el;
    for (var k in styles) {
      try { el.style[k] = styles[k]; } catch (e) { /* 个别属性不支持就跳过 */ }
    }
    return el;
  }

  function Overlay(opts) {
    opts = opts || {};
    this.doc = opts.doc || document;
    this.win = opts.win || window;
    this.storageKey = opts.storageKey || 'whale-pet:v1';
    this.assetBase = opts.assetBase || '';
    this.onAction = opts.onAction || function () {};
    this.cfg = Object.assign({}, DEFAULTS, opts.config || {});

    this.pet = new W.Pet({ w: this.win.innerWidth, h: this.win.innerHeight });
    this.audio = new W.AudioKit();
    this.audio.enabled = !!this.cfg.sound;

    this._disposers = [];
    this._menuOpen = false;
    this._pointer = { down: false, id: null, lastT: 0, lastX: 0, lastY: 0, vx: 0, vy: 0, moved: 0 };
    this._lastActivity = Date.now();
    this._saveAccum = 0;
    this._rapidPat = { count: 0, at: 0 };
    this.art = null;              // 当前美术层实例（画风为 pixel 时是 null）
  }

  /* ============================ 美术层 ============================ */

  var ART_STYLES = [
    { id: 'musume', label: '插画立绘' },
    { id: 'pixel', label: '像素' }
  ];

  /**
   * 切换画风。musume = 插画立绘（资源在 assets/art/musume/，MIT 署名见 ATTRIBUTION.md），
   * pixel = 内置像素渲染器。立绘没就绪时内核自动回退像素，不会出现空白帧。
   */
  Overlay.prototype.setArtStyle = function (id) {
    this.cfg.art = (id === 'pixel') ? 'pixel' : 'musume';
    this.syncArt();
    this.save();
    return this.cfg.art;
  };

  Overlay.prototype.syncArt = function () {
    var wantMusume = this.cfg.art !== 'pixel';
    if (wantMusume) {
      if (!this.art && W && typeof window !== 'undefined' && window.WhalePetArtMusume) {
        this.art = window.WhalePetArtMusume.createArt({ base: this.assetBase + 'art/musume/' });
        this.pet.setArt(this.art);
        this.art.start();
      } else if (this.art) {
        this.pet.setArt(this.art);
      }
    } else if (this.art) {
      // 切回像素：停掉预取并彻底摘掉，避免状态自检与实际画风不一致
      this.art.stop();
      this.art = null;
      this.pet.setArt(null);
    }
    for (var id in (this.artBtns || {})) {
      if (this.artBtns[id]) this.artBtns[id].classList.toggle('on', this.cfg.art === id);
    }
    return this;
  };

  /** 美术层是否已就绪（验收用） */
  Overlay.prototype.artStatus = function () {
    if (!this.art) return { style: 'pixel', ready: true, loaded: 0, failed: 0, total: 0 };
    return {
      style: 'musume',
      ready: this.art.ready(this.pet),
      loaded: this.art.stat.loaded,
      failed: this.art.stat.failed,
      total: this.art.stat.total,
      file: this.art.fileFor(this.pet)
    };
  };

  /* ============================ 存档 ============================ */

  Overlay.prototype.load = function () {
    var raw = null;
    try { raw = this.win.localStorage.getItem(this.storageKey); } catch (e) { raw = null; }
    var saved = null;
    if (raw) { try { saved = JSON.parse(raw); } catch (e) { saved = null; } }
    if (saved) {
      if (saved.cfg) this.cfg = Object.assign({}, DEFAULTS, saved.cfg);
      if (saved.pet) this.pet.load(saved.pet);
      this.audio.enabled = !!this.cfg.sound;
      this.pet.skin = this.cfg.skin || this.pet.skin;
      this.pet.name = this.cfg.name || this.pet.name;
      this.pet.followCursor = this.cfg.followCursor !== false;
    }
    return this;
  };

  Overlay.prototype.save = function () {
    var data = { v: 1, cfg: this.cfg, pet: this.pet.serialize() };
    try { this.win.localStorage.setItem(this.storageKey, JSON.stringify(data)); } catch (e) { /* 隐私模式忽略 */ }
    return data;
  };

  Overlay.prototype.reset = function () {
    try { this.win.localStorage.removeItem(this.storageKey); } catch (e) { /* ignore */ }
  };

  /** 重置养成数据：清存档 + 换一只全新的她，保留外观与偏好 */
  Overlay.prototype.resetGrowth = function () {
    var cfg = this.cfg;
    this.reset();
    this.pet = new W.Pet({ w: this.win.innerWidth, h: this.win.innerHeight });
    this.pet.skin = cfg.skin || this.pet.skin;
    this.pet.name = cfg.name || this.pet.name;
    this.pet.followCursor = cfg.followCursor !== false;
    this.applyCfg();
    this.syncArt();                 // 新宠物要重新挂上美术层
    this.sync(true);
    this.save();
    return this;
  };

  /* ============================ DOM ============================ */

  Overlay.prototype.mount = function () {
    var doc = this.doc;
    // 接管而不是报错：插件被重新注入（HMR / 重复加载）时会留下旧节点，
    // 直接复用位置、把旧的清掉，避免出现双份桌宠和双份事件监听。
    var stale = doc.querySelector(ROOT_SEL);
    if (stale && stale.parentNode) stale.parentNode.removeChild(stale);

    var rootEl = h('div', 'dwp-root', { 'data-dsh-whale-pet-root': '1' });
    rootEl.setAttribute('aria-hidden', 'true');
    // 关键定位用 JS 内联样式写死：样式表缺失/被 CSP 拦掉时，
    // 也绝不会掉进正常文档流把宿主界面撑开（这是硬约束，不依赖 CSS 文件）
    harden(rootEl, {
      position: 'fixed', top: '0px', left: '0px', right: '0px', bottom: '0px',
      width: 'auto', height: 'auto', margin: '0px', padding: '0px', border: '0px',
      background: 'transparent', zIndex: String(Z), pointerEvents: 'none'
    });

    var canvas = h('canvas', 'dwp-canvas');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    harden(canvas, {
      position: 'absolute', top: '0px', left: '0px',
      display: 'block', pointerEvents: 'none', margin: '0px'
    });
    rootEl.appendChild(canvas);

    // 气泡
    var bubble = h('div', 'dwp-bubble');
    this.bubbleEl = bubble;
    harden(bubble, { position: 'absolute', pointerEvents: 'none' });
    bubble.style.display = 'none';
    rootEl.appendChild(bubble);

    // 唤回按钮（隐藏后也能找回来）
    var recall = h('button', 'dwp-recall', { type: 'button', title: '叫回鲸鱼娘' });
    recall.textContent = '🐋';
    harden(recall, { position: 'fixed', left: '14px', bottom: '14px', zIndex: String(Z + 1) });
    this.recallEl = recall;
    rootEl.appendChild(recall);

    // 右键菜单
    var menu = h('div', 'dwp-menu');
    this.menuEl = menu;
    harden(menu, { position: 'fixed', zIndex: String(Z + 2) });
    menu.style.display = 'none';
    var items = [
      ['feed', '🐟 投喂小点心'],
      ['praise', '✨ 夸夸她'],
      ['pat', '✋ 摸摸头'],
      ['play', '🎮 玩一下'],
      ['walk', '🚶 散散步'],
      ['sleep', '💤 让她睡觉'],
      ['—', ''],
      ['home', '🏠 回到右下角'],
      ['panel', '⚙️ 打开面板'],
      ['hide', '🙈 隐藏桌宠']
    ];
    items.forEach(function (it) {
      if (it[0] === '—') { menu.appendChild(h('div', 'dwp-menu-sep')); return; }
      var b = h('button', 'dwp-menu-item', { type: 'button', 'data-act': it[0] });
      b.textContent = it[1];
      menu.appendChild(b);
    });
    rootEl.appendChild(menu);

    // 面板
    rootEl.appendChild(this.buildPanel());

    doc.body.appendChild(rootEl);
    this.rootEl = rootEl;

    this.resize();
    this.bindInput();
    this.applyCfg();
    this.clear();          // 起手先清一次，避免上一实例/上一帧的残留
    this.sync(true);

    // 布局自检：定位没生效就立刻告警（绝不让宿主界面被撑开）
    var diag = this.diagnose();
    if (!diag.layoutOk && typeof console !== 'undefined' && console.warn) {
      console.warn('[whale-pet] 布局自检异常，桌宠可能影响宿主排版：', diag);
    }
    this.layoutDiag = diag;

    // 离开过一段时间就挥挥手打个招呼（用专属立绘）
    var greet = this.pet.offlineGreeting && this.pet.offlineGreeting();
    if (greet) {
      this.pet.say(greet, 3.4);
      this.pet.hintArt('greet', 4);
    }
    return this;
  };

  Overlay.prototype.buildPanel = function () {
    var self = this;
    var panel = h('div', 'dwp-panel');
    harden(panel, { position: 'fixed', right: '16px', bottom: '232px', zIndex: String(Z + 3) });
    panel.style.display = 'none';
    this.panelEl = panel;

    var head = h('div', 'dwp-panel-head');
    var title = h('span', 'dwp-panel-title');
    title.textContent = '🐋 鲸鱼娘桌宠';
    head.appendChild(title);
    var close = h('button', 'dwp-x', { type: 'button', title: '收起' });
    close.textContent = '×';
    close.setAttribute('data-act', 'panel-close');
    head.appendChild(close);
    panel.appendChild(head);

    // 名字 + 等级
    var nameRow = h('div', 'dwp-row');
    var nameInput = h('input', 'dwp-name', { type: 'text', maxlength: '8', spellcheck: 'false' });
    nameInput.value = this.cfg.name;
    this.nameInput = nameInput;
    nameRow.appendChild(nameInput);
    var lv = h('span', 'dwp-lv');
    this.lvEl = lv;
    nameRow.appendChild(lv);
    panel.appendChild(nameRow);

    // 数值条
    var bars = h('div', 'dwp-bars');
    this.bars = {};
    [['mood', '心情', 'dwp-mood'], ['hunger', '饱食', 'dwp-hunger'], ['energy', '精力', 'dwp-energy']].forEach(function (def) {
      var row = h('div', 'dwp-bar-row');
      var label = h('span', 'dwp-bar-label');
      label.textContent = def[1];
      var track = h('i', 'dwp-bar-track');
      var fill = h('b', 'dwp-bar-fill ' + def[2]);
      track.appendChild(fill);
      var val = h('em', 'dwp-bar-val');
      row.appendChild(label); row.appendChild(track); row.appendChild(val);
      bars.appendChild(row);
      self.bars[def[0]] = { fill: fill, val: val };
    });
    panel.appendChild(bars);

    // 经验条
    var expRow = h('div', 'dwp-exp-row');
    var expTrack = h('i', 'dwp-exp-track');
    var expFill = h('b', 'dwp-exp-fill');
    expTrack.appendChild(expFill);
    var expTxt = h('span', 'dwp-exp-text');
    expRow.appendChild(expTrack); expRow.appendChild(expTxt);
    panel.appendChild(expRow);
    this.expFill = expFill;
    this.expTxt = expTxt;

    // 互动按钮
    var acts = h('div', 'dwp-actions');
    [['feed', '🐟 投喂'], ['praise', '✨ 夸夸'], ['pat', '✋ 摸摸'], ['play', '🎮 玩一下'], ['walk', '🚶 散步'], ['sleep', '💤 睡觉']].forEach(function (def) {
      var b = h('button', 'dwp-btn', { type: 'button', 'data-act': def[0] });
      b.textContent = def[1];
      acts.appendChild(b);
    });
    panel.appendChild(acts);

    // 开关
    var toggles = h('div', 'dwp-toggles');
    this.toggles = {};
    [['followCursor', '跟随鼠标'], ['keyboard', '键盘联动'], ['bubble', '台词气泡'], ['sound', '音效']].forEach(function (def) {
      var b = h('button', 'dwp-chip', { type: 'button', 'data-toggle': def[0] });
      b.textContent = def[1];
      toggles.appendChild(b);
      self.toggles[def[0]] = b;
    });
    panel.appendChild(toggles);

    // 皮肤
    var skins = h('div', 'dwp-skins');
    this.skinBtns = {};
    W.SKIN_ORDER.forEach(function (id) {
      var b = h('button', 'dwp-skin', { type: 'button', 'data-skin': id, title: W.SKINS[id].name });
      b.textContent = W.SKINS[id].name;
      b.style.setProperty('--dwp-swatch', W.SKINS[id].hood);
      skins.appendChild(b);
      self.skinBtns[id] = b;
    });
    panel.appendChild(skins);

    // 画风（插画立绘 / 内置像素）
    var arts = h('div', 'dwp-skins');
    this.artBtns = {};
    ART_STYLES.forEach(function (def) {
      var b = h('button', 'dwp-skin', { type: 'button', 'data-art': def.id, title: def.label });
      b.textContent = def.label;
      arts.appendChild(b);
      self.artBtns[def.id] = b;
    });
    panel.appendChild(arts);

    var stats = h('div', 'dwp-stats');
    this.statsEl = stats;
    panel.appendChild(stats);

    var foot = h('div', 'dwp-foot');
    foot.textContent = '拖动她可以搬家 · 单击摸头 · 右键更多操作';
    panel.appendChild(foot);

    return panel;
  };

  /* ============================ 尺寸 ============================ */

  /** 清空整块画布（ctx 带着 DPR 变换，所以按 CSS 像素清） */
  Overlay.prototype.clear = function () {
    try {
      this.ctx.clearRect(0, 0, this.win.innerWidth, this.win.innerHeight);
    } catch (e) {
      try { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); } catch (e2) { /* ignore */ }
    }
    return this;
  };

  Overlay.prototype.resize = function () {
    var win = this.win;
    var dpr = Math.min(2, win.devicePixelRatio || 1);
    var w = win.innerWidth, hh = win.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(hh * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = hh + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.pet.setViewport(w, hh);
    return this;
  };

  /* ============================ 输入 ============================ */

  Overlay.prototype.bindInput = function () {
    var self = this;
    var win = this.win;

    var onResize = function () { self.resize(); };
    win.addEventListener('resize', onResize);
    this._disposers.push(function () { win.removeEventListener('resize', onResize); });

    // 指针移动：更新瞳孔朝向 + 拖拽
    var onMove = function (e) {
      var x = e.clientX, y = e.clientY;
      self.pet.cursor.x = x; self.pet.cursor.y = y; self.pet.cursor.active = true;
      self._lastActivity = Date.now();
      if (self._pointer.down && self._pointer.id === e.pointerId) {
        var dx = x - self._pointer.lastX, dy = y - self._pointer.lastY;
        self._pointer.moved += Math.abs(dx) + Math.abs(dy);
        var now = e.timeStamp || performance.now();
        var dt = Math.max(0.008, (now - self._pointer.lastT) / 1000);
        self.pet.dragTo(x, y, dt);
        self._pointer.lastX = x; self._pointer.lastY = y; self._pointer.lastT = now;
        if (self._pointer.moved > 4) self._dragging = true;
      }
    };
    win.addEventListener('pointermove', onMove, { passive: true });
    this._disposers.push(function () { win.removeEventListener('pointermove', onMove); });

    // 指针按下：只有命中宠物本体才拦截（零侵入）
    var onDown = function (e) {
      self._lastActivity = Date.now();
      if (e.button === 2) return;
      if (self._menuOpen) { self.closeMenu(); return; }
      if (!self.guiVisible()) return;      // GUI 里没画她，绝不能吞掉宿主的点击
      var x = e.clientX, y = e.clientY;
      var zone = self.pet.hitZone(x, y);
      if (!zone) return;
      // 命中：阻止宿主收到这次点击（避免误触业务按钮），但不动其他节点
      e.preventDefault();
      e.stopPropagation();
      self._pointer.down = true;
      self._pointer.id = e.pointerId;
      self._pointer.lastX = x; self._pointer.lastY = y;
      self._pointer.lastT = e.timeStamp || performance.now();
      self._pointer.moved = 0;
      self._dragging = false;
      self._grabZone = zone;
      try { if (e.target && e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      self.pet.startDrag(x, y);
    };
    win.addEventListener('pointerdown', onDown, { capture: true });
    this._disposers.push(function () { win.removeEventListener('pointerdown', onDown, { capture: true }); });

    // 指针抬起：区分"拖拽"和"单击摸头"
    var onUp = function (e) {
      if (!self._pointer.down) return;
      self._pointer.down = false;
      if (self._dragging) {
        self.pet.endDrag();
        self.audio.land();
      } else {
        // 单击 = 摸头（按命中分区给不同反应）
        var r = self.pet.pat(self._grabZone || 'head');
        self.audio.enabled = !!self.cfg.sound && self.cfg.sound;
        self.audio.pat();
        self.bumpZone(r);
        self.afterInteract();
      }
      self._dragging = false;
    };
    win.addEventListener('pointerup', onUp, { capture: true });
    this._disposers.push(function () { win.removeEventListener('pointerup', onUp, { capture: true }); });

    // 右键：宠物身上弹菜单
    var onCtx = function (e) {
      if (!self.guiVisible()) return;      // 没画她就不接管右键
      if (!self.pet.hitTest(e.clientX, e.clientY)) return;
      e.preventDefault();
      e.stopPropagation();
      self.openMenu(e.clientX, e.clientY);
    };
    win.addEventListener('contextmenu', onCtx, { capture: true });
    this._disposers.push(function () { win.removeEventListener('contextmenu', onCtx, { capture: true }); });

    // 全局点击：关掉菜单（不拦截）
    var onAnyDown = function (e) {
      if (!self._menuOpen) return;
      if (self.menuEl.contains(e.target)) return;
      self.closeMenu();
    };
    win.addEventListener('pointerdown', onAnyDown);
    this._disposers.push(function () { win.removeEventListener('pointerdown', onAnyDown); });

    // 键盘联动
    var onKey = function (e) {
      self._lastActivity = Date.now();
      if (!self.cfg.keyboard) return;
      var t = e.target;
      if (t && t.tagName === 'INPUT' && t !== self.nameInput) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;
      self.pet.onKeyTap();
    };
    win.addEventListener('keydown', onKey);
    this._disposers.push(function () { win.removeEventListener('keydown', onKey); });

    // 面板 / 菜单 / 唤回按钮的点击
    var onClick = function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-act],[data-toggle],[data-skin],[data-art]') : null;
      if (!el || !self.rootEl.contains(el)) return;
      e.preventDefault();
      e.stopPropagation();
      if (el.hasAttribute('data-act')) self.doAction(el.getAttribute('data-act'));
      else if (el.hasAttribute('data-toggle')) self.toggle(el.getAttribute('data-toggle'));
      else if (el.hasAttribute('data-skin')) self.setSkin(el.getAttribute('data-skin'));
      else if (el.hasAttribute('data-art')) self.setArtStyle(el.getAttribute('data-art'));
    };
    win.addEventListener('click', onClick, { capture: true });
    this._disposers.push(function () { win.removeEventListener('click', onClick, { capture: true }); });

    var onName = function () {
      self.cfg.name = self.nameInput.value.trim() || DEFAULTS.name;
      self.pet.name = self.cfg.name;
      self.save();
    };
    this.nameInput.addEventListener('change', onName);
    this._disposers.push(function () { self.nameInput.removeEventListener('change', onName); });

    // 设置面板（DSH 设置 → 桌宠）通过事件下命令，避免两边直接耦合
    var onCommand = function (e) {
      var cmd = e && e.detail && e.detail.cmd;
      if (!cmd) return;
      if (cmd === 'reset') { self.resetGrowth(); return; }
      if (cmd === 'hide') { self.setHidden(true); return; }
      if (cmd === 'show') { self.setHidden(false); return; }
      self.doAction(cmd);
    };
    win.addEventListener('whale-pet:command', onCommand);
    this._disposers.push(function () { win.removeEventListener('whale-pet:command', onCommand); });

    // 页面隐藏时让她去睡（也顺便存个档）
    var onVis = function () {
      if (self.doc.hidden) self.save();
    };
    this.doc.addEventListener('visibilitychange', onVis);
    this._disposers.push(function () { self.doc.removeEventListener('visibilitychange', onVis); });

    var onUnload = function () { self.save(); };
    win.addEventListener('beforeunload', onUnload);
    this._disposers.push(function () { win.removeEventListener('beforeunload', onUnload); });
  };

  /* ============================ 行为 ============================ */

  Overlay.prototype.doAction = function (act) {
    var self = this;
    // 宠物级动作（摸摸/投喂/夸夸/睡吧）统一走共用实现 —— 桌面版调的是同一份，
    // 这样两种宿主的行为与文案不会再各写各的。
    var shared = this.win.WhalePetActions;
    if (shared && shared.actionMeta(act)) {
      shared.run(act, { pet: this.pet, audio: this.audio });
      this.closeMenu();
      this.afterInteract();
      this.onAction(act);
      return this;
    }
    switch (act) {
      case 'feed':
        this.pet.feed(); this.audio.feed(); break;
      case 'praise':
        this.pet.praise(); this.audio.levelup(); break;
      case 'pat':
        this.pet._patCooldown = 0; this.pet.pat('head'); this.audio.pat(); break;
      case 'sleep':
        this.pet.toggleSleep(); break;
      case 'home':
        // 贴边要按她自己的半身宽留位置，否则会被窗口裁掉半个身子
        this.pet.x = this.pet.xRange().max;
        this.pet.y = this.pet.floorY();
        this.pet.vx = 0; this.pet.vy = 0;
        break;
      case 'panel':
        this.togglePanel(); break;
      case 'panel-close':
        this.togglePanel(false); break;
      case 'hide':
        this.setHidden(true); break;
      default: break;
    }
    this.closeMenu();
    this.afterInteract();
    this.onAction(act);
    return this;
  };

  Overlay.prototype.toggle = function (key) {
    this.cfg[key] = !this.cfg[key];
    this.applyCfg();
    this.save();
    return this.cfg[key];
  };

  Overlay.prototype.setSkin = function (id) {
    if (!W.SKINS[id]) return;
    this.cfg.skin = id;
    this.pet.skin = id;
    this.applyCfg();
    this.save();
  };

  Overlay.prototype.setHidden = function (hidden) {
    this.cfg.hidden = !!hidden;
    this.applyCfg();
    this.save();
  };

  Overlay.prototype.togglePanel = function (force) {
    if (!this.guiVisible() || this.cfg.hidden) return false;   // 不在 GUI 显示时没有面板
    var show = force != null ? force : this.panelEl.style.display === 'none';
    this.panelEl.style.display = show ? 'block' : 'none';
    if (show) this.sync(true);
    return show;
  };

  /**
   * 是否在 DSH 窗口里画出她。
   * guiPet 默认 false —— 想只留桌面版时，GUI 里就不画她；
   * 但"信号采集 + 上报状态文件"照常跑（桌面版靠它知道你在忙什么）。
   */
  Overlay.prototype.guiVisible = function () {
    return this.cfg.guiPet !== false && !this.cfg.hidden;
  };

  Overlay.prototype.applyCfg = function () {
    var c = this.cfg;
    var show = this.guiVisible();
    this.pet.followCursor = false;              // 桌面版才是主场，GUI 里不再追鼠标
    this.audio.enabled = !!c.sound;
    this.canvas.style.display = show ? 'block' : 'none';
    this.bubbleEl.style.display = (show && c.bubble) ? '' : 'none';
    // 唤回按钮只在"用户主动隐藏了她"时出现；默认不显示 GUI 桌宠不算隐藏
    this.recallEl.style.display = c.hidden ? 'flex' : 'none';
    if (!show || c.hidden) this.panelEl.style.display = 'none';

    for (var k in this.toggles) {
      if (!this.toggles[k]) continue;
      this.toggles[k].classList.toggle('on', !!c[k]);
      this.toggles[k].setAttribute('aria-pressed', String(!!c[k]));
    }
    for (var s in this.skinBtns) {
      if (!this.skinBtns[s]) continue;
      this.skinBtns[s].classList.toggle('on', c.skin === s);
    }
    if (this.nameInput) this.nameInput.value = c.name;
    this.syncArt();
    return this;
  };

  Overlay.prototype.openMenu = function (x, y) {
    this.menuEl.style.display = 'block';
    var mw = 190, mh = this.menuEl.offsetHeight || 260;
    var left = Math.min(x, this.win.innerWidth - mw - 8);
    var top = Math.min(y, this.win.innerHeight - mh - 8);
    this.menuEl.style.left = Math.max(8, left) + 'px';
    this.menuEl.style.top = Math.max(8, top) + 'px';
    this._menuOpen = true;
  };

  Overlay.prototype.closeMenu = function () {
    this.menuEl.style.display = 'none';
    this._menuOpen = false;
  };

  /** 连点奖励：短时间连续摸头会有额外特效 */
  Overlay.prototype.bumpZone = function () {
    var now = Date.now();
    if (now - this._rapidPat.at > 900) this._rapidPat.count = 0;
    this._rapidPat.at = now;
    this._rapidPat.count++;
    if (this._rapidPat.count >= 3) {
      this.pet.praise();
      this.audio.levelup();
      this._rapidPat.count = 0;
    }
  };

  Overlay.prototype.afterInteract = function () {
    if (this.panelEl.style.display !== 'none') this.sync(true);
    this.save();
  };

  /* ============================ 面板同步 ============================ */

  Overlay.prototype.sync = function (force) {
    var pet = this.pet;
    if (!this.lvEl) return this;
    this.lvEl.textContent = 'Lv.' + pet.level;
    var map = { mood: pet.mood, hunger: pet.hunger, energy: pet.energy };
    for (var k in this.bars) {
      var v = Math.max(0, Math.min(100, map[k]));
      this.bars[k].fill.style.width = v + '%';
      this.bars[k].val.textContent = Math.round(v);
    }
    var need = pet.expNeed();
    this.expFill.style.width = Math.max(0, Math.min(100, (pet.exp / need) * 100)) + '%';
    this.expTxt.textContent = '亲密 ' + Math.round(pet.bond) + ' · 经验 ' + Math.round(pet.exp) + '/' + need;
    this.statsEl.textContent = '累计投喂 ' + pet.totalFeed + ' 次 · 摸头 ' + pet.totalPat +
      ' 次 · 陪伴 ' + Math.round(pet.tokens).toLocaleString() + ' tokens';
    return this;
  };

  /* ============================ 主循环 ============================ */

  Overlay.prototype.start = function () {
    var self = this;
    var last = performance.now();
    var raf = this.win.requestAnimationFrame ? this.win.requestAnimationFrame.bind(this.win) : null;
    if (!raf) return this;
    var tick = function (now) {
      var dt = (now - last) / 1000;
      last = now;
      if (dt > 0.25) dt = 0.25;
      self.frame(dt);
      self._raf = raf(tick);
    };
    this._raf = raf(tick);
    return this;
  };

  /**
   * 重新加固关键定位（运行时自愈用）。
   * 万一有别的样式/脚本把我们的定位覆盖掉，也能立刻纠回来，不会撑坏宿主界面。
   */
  Overlay.prototype.reharden = function () {
    harden(this.rootEl, {
      position: 'fixed', top: '0px', left: '0px', right: '0px', bottom: '0px',
      width: 'auto', height: 'auto', margin: '0px', padding: '0px', border: '0px',
      background: 'transparent', zIndex: String(Z), pointerEvents: 'none'
    });
    harden(this.canvas, { position: 'absolute', top: '0px', left: '0px', display: 'block', pointerEvents: 'none' });
    harden(this.bubbleEl, { position: 'absolute', pointerEvents: 'none' });
    harden(this.recallEl, { position: 'fixed', left: '14px', bottom: '14px' });
    harden(this.menuEl, { position: 'fixed' });
    harden(this.panelEl, { position: 'fixed', right: '16px', bottom: '232px' });
    return this;
  };

  Overlay.prototype.frame = function (dt) {
    // 长时间无操作 → 她自己犯困
    if (Date.now() - this._lastActivity > 180000 && this.pet.mode !== 'sleep' && this.pet.energy < 92) {
      this.pet.toggleSleep(true);
      this._lastActivity = Date.now();
    }
    this.pet.update(dt);
    if (this.guiVisible()) {
      // 每帧必须先清屏：渲染层只负责"画"，旧帧不清就会在她移动时留下永久重影
      this.clear();
      this.pet.render(this.ctx);
      this.renderBubble();
    }
    this._saveAccum += dt;
    if (this._saveAccum > 5) { this._saveAccum = 0; this.save(); }

    // 定位自愈：每 2 秒确认一次"我们没在文档流里"，被覆盖就重新加固
    this._layoutAccum = (this._layoutAccum || 0) + dt;
    if (this._layoutAccum > 2) {
      this._layoutAccum = 0;
      if (!this.diagnose().layoutOk) {
        this.reharden();
        this.resize();
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[whale-pet] 定位被覆盖，已自动重新加固：', this.diagnose());
        }
      }
    }
    this._panelAccum = (this._panelAccum || 0) + dt;
    if (this._panelAccum > 0.25 && this.panelEl.style.display !== 'none') {
      this._panelAccum = 0;
      this.sync();
    }
  };

  Overlay.prototype.renderBubble = function () {
    var pet = this.pet;
    var el = this.bubbleEl;
    if (!pet.speech || !this.cfg.bubble) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
    var u = pet.unit();
    el.textContent = pet.speech.text;
    el.style.display = 'block';
    el.style.left = Math.round(pet.x) + 'px';
    el.style.top = Math.round(pet.y - (pet.pose === 'sleep' ? 8 : 27) * u) + 'px';
    el.classList.toggle('dwp-bubble-left', pet.x < 120);
  };

  /* ============================ 对外 ============================ */

  Overlay.prototype.signal = function (state, detail) {
    this.pet.signal(state, detail);
    return this;
  };

  Overlay.prototype.stats = function () {
    var p = this.pet;
    var art = this.artStatus();
    return {
      pose: p.pose, mode: p.mode, ambient: p.ambient, level: p.level,
      x: Math.round(p.x), y: Math.round(p.y), facing: p.facing,
      mood: Math.round(p.mood), hunger: Math.round(p.hunger), energy: Math.round(p.energy),
      tokens: Math.round(p.tokens), hidden: !!this.cfg.hidden,
      art: art.style, artReady: art.ready, artFile: art.file || null,
      artLoaded: art.loaded, artTotal: art.total,
      layoutOk: this.diagnose().layoutOk
    };
  };

  /**
   * 布局自检：确认桌宠这一层没有把自己塞进宿主文档流。
   * （样式表缺失、被 CSP 拦掉、被别的样式覆盖时，这是唯一的早期信号）
   */
  Overlay.prototype.diagnose = function () {
    var win = this.win, doc = this.doc;
    var d = { layoutOk: false };
    try {
      var cs = win.getComputedStyle ? win.getComputedStyle(this.rootEl) : null;
      d.rootPosition = cs ? cs.position : 'unknown';
      d.canvasPosition = win.getComputedStyle ? win.getComputedStyle(this.canvas).position : 'unknown';
      d.viewport = win.innerWidth + 'x' + win.innerHeight;
      d.docScroll = doc.documentElement.scrollWidth + 'x' + doc.documentElement.scrollHeight;
      d.roots = doc.querySelectorAll(ROOT_SEL).length;
      d.styleTags = doc.querySelectorAll('style[data-dsh-whale-pixel-pet]').length;
      d.layoutOk = d.rootPosition === 'fixed' && d.canvasPosition === 'absolute';
    } catch (e) {
      d.error = String((e && e.message) || e);
    }
    return d;
  };

  Overlay.prototype.destroy = function () {
    if (this._raf && this.win.cancelAnimationFrame) this.win.cancelAnimationFrame(this._raf);
    this._disposers.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
    this._disposers = [];
    if (this.rootEl && this.rootEl.parentNode) this.rootEl.parentNode.removeChild(this.rootEl);
    this.rootEl = null;
    return this;
  };

  /** 单例接管：重新注入时先销毁旧实例，防止 rAF 与事件监听叠加 */
  var INSTANCE_KEY = '__whalePetOverlayInstance';

  function createOverlay(opts) {
    if (typeof window !== 'undefined' && window[INSTANCE_KEY]) {
      try { window[INSTANCE_KEY].destroy(); } catch (e) { /* 旧实例销毁失败不阻塞新实例 */ }
      window[INSTANCE_KEY] = null;
    }
    var instance = new Overlay(opts);
    if (typeof window !== 'undefined') window[INSTANCE_KEY] = instance;
    return instance;
  }

  return { createOverlay: createOverlay, Overlay: Overlay, DEFAULTS: DEFAULTS, VERSION: W.VERSION };
});
