/*!
 * 鲸鱼娘像素桌宠 · 插画立绘美术层 art-musume.js
 * ---------------------------------------------------------------------------
 * 作用：把「行为内核」和「美术」彻底解耦——本文件只做一件事：
 *       根据 Pet 的当前状态，挑一张立绘并画到 canvas 上。
 *
 * 立绘资源来自 dsh-whale-musume（MIT，作者 Sutera-Diffusus），
 * 授权与来源见 ../art/ATTRIBUTION.md。像素渲染器仍保留在内核里，
 * 立绘未就绪 / 加载失败 / 用户切回像素时，内核会自动回退，绝不会出现空白帧。
 *
 * 约定：立绘是 512×512 透明底方图，人物居中贴底；本层按脚底锚点绘制。
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  'use strict';
  var API = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = API;
  if (typeof root === 'object' && root) root.WhalePetArtMusume = API;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* 状态 → 立绘。文件名不带路径，便于换图源。 */
  var POSE = {
    idle: 'dsh-whale-state-idle-cute.webp',
    work: 'dsh-whale-state-tool.webp',
    think: 'dsh-whale-state-thinking.webp',
    approve: 'dsh-whale-state-waiting.webp',
    happy: 'dsh-whale-state-react-head.webp',
    eat: 'dsh-whale-state-eat.webp',
    play: 'dsh-whale-state-daily-gaming.webp',
    walk: 'dsh-whale-state-running.webp',
    drag: 'dsh-whale-state-pick-up.webp',
    sleep: 'dsh-whale-state-sleep.webp',
    sad: 'dsh-whale-state-failure.webp',
    levelup: 'dsh-whale-state-levelup.webp',
    groom: 'dsh-whale-state-daily-coffee.webp'
  };

  /* 摸头分区 → 专属立绘（她的三区反应图正好齐备） */
  var ZONE = {
    head: 'dsh-whale-state-react-head.webp',
    belly: 'dsh-whale-state-react-belly.webp',
    tail: 'dsh-whale-state-react-tail.webp'
  };

  /* 具体工具 → 更贴切的立绘；识别不了就回落 state-tool */
  var TOOL = [
    [/pwsh|bash|shell|terminal|exec|command|deploy/i, 'dsh-whale-state-work-deploy.webp'],
    [/edit|write|patch|apply|fs|file|str_replace/i, 'dsh-whale-state-work-debug.webp'],
    [/search|grep|glob|read|list|find|fetch|browser|web/i, 'dsh-whale-state-work-review.webp'],
    [/test|spec|lint|check|verify/i, 'dsh-whale-state-work-debug.webp'],
    [/todo|task|plan|goal|schedule/i, 'dsh-whale-state-work-meeting.webp'],
    [/subagent|agent|workflow|team/i, 'dsh-whale-state-work-boss.webp'],
    [/sleep|idle|afk/i, 'dsh-whale-state-work-sleep.webp']
  ];

  /* 特殊场合立绘：由宿主用 artHint 触发（打招呼 / 星星眼 / 深夜 / 走神） */
  var HINT = {
    greet: 'dsh-whale-state-greet.webp',
    star: 'dsh-whale-state-star.webp',
    praise: 'dsh-whale-state-star.webp',
    blush: 'dsh-whale-state-blush.webp',
    celebrate: 'dsh-whale-state-celebrate.webp',
    night: 'dsh-whale-state-night.webp',
    afk: 'dsh-whale-state-afk.webp',
    deadline: 'dsh-whale-state-work-deadline.webp',
    curious: 'dsh-whale-state-curious.webp',
    // 不同食物有自己的表情（引擎里 FOODS 的 hint 指过来）
    eat: 'dsh-whale-state-eat.webp',
    foodPudding: 'dsh-whale-state-daily-eat.webp',
    foodCake: 'dsh-whale-state-celebrate.webp',
    foodDrink: 'dsh-whale-state-daily-coffee.webp',
    foodSalad: 'dsh-whale-state-daily-cooking.webp',
    gameWin: 'dsh-whale-state-game-win.webp',
    // 场合立绘（assets/pet-occasions.js 判定后由宿主 hintArt 触发）
    festivalNewYear: 'dsh-whale-state-celebrate.webp',
    festivalSpring: 'dsh-whale-state-festival-spring.webp',
    festivalMidAutumn: 'dsh-whale-state-festival-mid-autumn.webp',
    festivalHalloween: 'dsh-whale-state-festival-halloween.webp',
    festivalChristmas: 'dsh-whale-state-festival-christmas.webp',
    valentine: 'dsh-whale-state-valentine.webp',
    pajama: 'dsh-whale-state-daily-pajama.webp',
    dailyCoffee: 'dsh-whale-state-daily-coffee.webp',
    dailyStretch: 'dsh-whale-state-daily-stretch.webp'
  };

  /* 常用姿势先加载，其余空闲时段再慢慢取（避免开屏卡顿） */
  var EAGER = ['idle', 'work', 'think', 'approve', 'happy', 'sleep', 'eat', 'drag', 'sad', 'levelup'];
  var FADE_MS = 170;

  function MusumeArt(opts) {
    opts = opts || {};
    this.id = 'musume';
    this.base = opts.base || '';
    this.targetUnits = opts.targetUnits || 26;   // 立绘目标高度（格），与像素版体量对齐
    this.eager = opts.eager || EAGER;
    this.images = {};          // file -> { img, ok, failed, readyAt, alpha }
    this.queue = [];
    this.queued = {};
    this.started = false;
    this.stat = { loaded: 0, failed: 0, total: 0 };
  }

  /** 当前该显示哪张立绘（纯函数，方便单测） */
  MusumeArt.prototype.fileFor = function (pet) {
    if (!pet) return POSE.idle;
    if (pet.artHint && HINT[pet.artHint] && (!pet.artHintUntil || pet.artHintUntil > pet.t)) return HINT[pet.artHint];
    // 摸头/捏肚子/拽尾巴有专属反应图
    if (pet.mode === 'happy' && pet.lastZone && ZONE[pet.lastZone]) return ZONE[pet.lastZone];
    if (pet.mode === 'work') {
      var d = String(pet.ambientDetail || '');
      for (var i = 0; i < TOOL.length; i++) if (TOOL[i][0].test(d)) return TOOL[i][1];
    }
    return POSE[pet.pose] || POSE.idle;
  };

  MusumeArt.prototype.url = function (file) { return this.base + file; };

  MusumeArt.prototype.load = function (file) {
    if (this.images[file]) return this.images[file];
    var rec = { img: null, ok: false, failed: false, readyAt: 0, alpha: 0 };
    this.images[file] = rec;
    this.stat.total++;
    var Img = (typeof Image !== 'undefined') ? Image : null;
    if (!Img) { rec.failed = true; this.stat.failed++; return rec; }
    var img = new Img();
    rec.img = img;
    var self = this;
    img.onload = function () {
      rec.ok = true;
      rec.readyAt = Date.now();
      self.stat.loaded++;
    };
    img.onerror = function () {
      rec.failed = true;
      self.stat.failed++;
    };
    img.decoding = 'async';
    img.src = this.url(file);
    return rec;
  };

  /** 先加载常用姿势，再每个 120ms 补一张（学 whale-musume 的预取节奏） */
  MusumeArt.prototype.start = function () {
    if (this.started) return this;
    this.started = true;
    var self = this;
    var all = [];
    var seen = {};
    var push = function (f) { if (f && !seen[f]) { seen[f] = 1; all.push(f); } };
    this.eager.forEach(function (pose) { push(POSE[pose]); });
    Object.keys(POSE).forEach(function (k) { push(POSE[k]); });
    Object.keys(ZONE).forEach(function (k) { push(ZONE[k]); });
    Object.keys(HINT).forEach(function (k) { push(HINT[k]); });
    TOOL.forEach(function (t) { push(t[1]); });

    all.forEach(function (f, i) {
      if (i < self.eager.length) { self.load(f); return; }
      self.queue.push(f);
    });
    if (typeof setInterval === 'function') {
      this.timer = setInterval(function () {
        if (!self.queue.length) { clearInterval(self.timer); self.timer = null; return; }
        self.load(self.queue.shift());
      }, 120);
    }
    return this;
  };

  MusumeArt.prototype.stop = function () {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    return this;
  };

  MusumeArt.prototype.ready = function (pet) {
    var rec = this.images[this.fileFor(pet)];
    return !!(rec && rec.ok);
  };

  /** 立绘占位框（屏幕坐标），命中判定与影子都用它 */
  MusumeArt.prototype.box = function (pet) {
    var u = pet.unit();
    var h = this.targetUnits * u;
    var rec = this.images[this.fileFor(pet)];
    var ratio = 1;
    if (rec && rec.img && rec.img.naturalWidth && rec.img.naturalHeight) {
      ratio = rec.img.naturalWidth / rec.img.naturalHeight;
    }
    var w = h * ratio;
    return { x: pet.x - w / 2, y: pet.y - h, w: w, h: h };
  };

  /** 分区判定：立绘是正面像，按身高切三段（头 / 肚子 / 尾） */
  MusumeArt.prototype.zoneAt = function (pet, px, py) {
    var b = this.box(pet);
    if (px < b.x - 6 || px > b.x + b.w + 6) return null;
    // 上边界允许略微出头（头发/配饰），下边界到脚底再留一点余量
    if (py < b.y - 8 || py > b.y + b.h + 10) return null;
    var r = (py - b.y) / b.h;          // 0=头顶 1=脚底
    if (r < 0.42) return 'head';
    if (r < 0.74) return 'belly';
    return 'tail';
  };

  /** 画一帧；返回 false 表示"这次没画成"（内核会回退像素层） */
  MusumeArt.prototype.draw = function (ctx, pet) {
    var file = this.fileFor(pet);
    var rec = this.images[file] || this.load(file);
    if (!rec || !rec.ok) return false;

    var u = pet.unit();
    var h = this.targetUnits * u;
    var ratio = (rec.img.naturalWidth && rec.img.naturalHeight)
      ? rec.img.naturalWidth / rec.img.naturalHeight : 1;
    var w = h * ratio;

    // 待机轻微呼吸浮动；被拎起来时随动作晃
    var bob = 0, sy = 1, sx = 1;
    if (pet.mode === 'idle' || pet.mode === 'groom') {
      bob = Math.sin(pet.phase * 1.5) * u * 0.18;
      sy = 1 + Math.sin(pet.phase * 1.5) * 0.007;
    } else if (pet.mode === 'drag') {
      bob = Math.sin(pet.t * 3.0) * u * 0.28;
    } else if (pet.mode === 'sleep') {
      sy = 1 + Math.sin(pet.phase * 1.1) * 0.012;
    }
    if (pet.squash > 0) { sy = 1 - pet.squash * 0.16; sx = 1 + pet.squash * 0.1; }

    if (rec.readyAt) {
      rec.alpha = Math.min(1, (Date.now() - rec.readyAt) / FADE_MS);
    } else {
      rec.alpha = 1;
    }

    var dw = w * sx, dh = h * sy;
    var px = Math.round(pet.x), py = Math.round(pet.y + bob);

    ctx.save();
    ctx.globalAlpha = rec.alpha;
    // 立绘是正面像：不做左右镜像，避免发型/配饰反过来
    ctx.drawImage(rec.img, px - dw / 2, py - dh, dw, dh);
    ctx.restore();
    return true;
  };

  function createArt(opts) { return new MusumeArt(opts); }

  return {
    createArt: createArt,
    MusumeArt: MusumeArt,
    POSE: POSE,
    ZONE: ZONE,
    HINT: HINT,
    EAGER: EAGER,
    targetUnitsOf: function (art) { return art.targetUnits; }
  };
});
