/*!
 * 鲸鱼娘像素桌宠 · 核心引擎 whale-pet.js
 * ---------------------------------------------------------------------------
 * 综合参考：
 *   - Sutera-Diffusus/dsh-whale-musume : 状态机与表现层分离、忙闲联动、点按分区
 *   - ChisaAlter/WhaleIsle            : 按 Token 用量养成、摸头/投喂
 *   - xiaoshihou514/dsh-desktop-pet    : 拖拽、惯性滑行、边缘抓停
 *
 * 本文件是纯逻辑 + 纯像素绘制，不依赖 DOM（渲染只用到传入的 ctx）。
 * 浏览器：<script src="whale-pet.js"> → window.WhalePet
 * Node  ：require / import 后读 globalThis.WhalePet（用于单元测试）
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  'use strict';
  var API = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = API;
  if (typeof root === 'object' && root) root.WhalePet = API;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var TAU = Math.PI * 2;

  /* ======================================================================
   * 0. 小工具
   * ==================================================================== */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /* ======================================================================
   * 1. 像素画笔
   *    数学坐标系：y 轴向上，地面 y = 0，单元格 (x,y) 覆盖 [x,x+1) × [y,y+1)
   *    落笔到屏幕时 y 轴翻转，并且可以整体翻转 x（角色转身）
   * ==================================================================== */

  var KEY_W = 512;   // 每个坐标轴支持 [-128, 383]
  var KEY_B = 128;

  function PixelPen(cell) {
    this.cell = cell || 6;
    this.cells = new Map();
    this.flip = false;
    this.anchorX = 12.5;   // 角色"脚底中心"在本地坐标里的 x，翻转时围绕它镜像
    this.offsetX = 0;      // 单位：格
    this.offsetY = 0;
    this.sx = 1;           // 挤压/拉伸
    this.sy = 1;
  }

  PixelPen.prototype.clear = function () { this.cells.clear(); return this; };

  PixelPen.prototype.px = function (x, y, color) {
    if (!color) return;
    this.cells.set((((x | 0) + KEY_B) * KEY_W) + ((y | 0) + KEY_B), color);
  };

  /** 矩形：左下角 (x,y)，宽 w 高 h */
  PixelPen.prototype.rect = function (x, y, w, h, color) {
    if (!color) return;
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) this.px(x + i, y + j, color);
  };

  /** 椭圆：中心 (cx,cy)，半径 rx,ry */
  PixelPen.prototype.ellipse = function (cx, cy, rx, ry, color) {
    if (!color || rx <= 0 || ry <= 0) return;
    var x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
    var y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.px(x, y, color);
      }
    }
  };

  /** 挖空椭圆：把已有的格子删掉（用于挖出兜帽帽口） */
  PixelPen.prototype.eraseEllipse = function (cx, cy, rx, ry) {
    var x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
    var y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.cells.delete(((x + KEY_B) * KEY_W) + (y + KEY_B));
      }
    }
    return this;
  };

  /** Bresenham 直线，thick 为线宽（格） */
  PixelPen.prototype.line = function (x0, y0, x1, y1, color, thick) {
    if (!color) return;
    thick = thick || 1;
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    var err = dx - dy, guard = 0;
    while (guard++ < 4096) {
      this.rect(x0, y0, thick, thick, color);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  };

  /** 三角形填充 */
  PixelPen.prototype.tri = function (ax, ay, bx, by, cx, cy, color) {
    if (!color) return;
    var minX = Math.floor(Math.min(ax, bx, cx)), maxX = Math.ceil(Math.max(ax, bx, cx));
    var minY = Math.floor(Math.min(ay, by, cy)), maxY = Math.ceil(Math.max(ay, by, cy));
    var sign = function (x1, y1, x2, y2, x3, y3) {
      return (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
    };
    for (var y = minY; y <= maxY; y++) {
      for (var x = minX; x <= maxX; x++) {
        var px = x + 0.5, py = y + 0.5;
        var d1 = sign(px, py, ax, ay, bx, by);
        var d2 = sign(px, py, bx, by, cx, cy);
        var d3 = sign(px, py, cx, cy, ax, ay);
        var neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
        var pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
        if (!(neg && pos)) this.px(x, y, color);
      }
    }
  };

  /** 位图：rows 为字符串数组，x/y 为左下角（字符从第一行开始向下排） */
  PixelPen.prototype.bitmap = function (rows, x, y, color, scale) {
    if (!color) return;
    scale = scale || 1;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      for (var c = 0; c < row.length; c++) {
        if (row[c] === '.') continue;
        var yy = y + (rows.length - 1 - r) * scale;
        this.rect(x + c * scale, yy, scale, scale, color);
      }
    }
  };

  /**
   * 组绘制 + 描边：把一组图形当作一个剪影，只给"新画出来的格子"外圈描边。
   * 这样无论分几组画，都只会在最外层长出 1px 轮廓。
   */
  PixelPen.prototype.group = function (fn, outlineColor) {
    var before = outlineColor ? new Set(this.cells.keys()) : null;
    fn();
    if (!outlineColor) return this;
    var add = new Map();
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var self = this;
    this.cells.forEach(function (_c, k) {
      if (before.has(k)) return;
      var x = Math.floor(k / KEY_W) - KEY_B;
      var y = (k % KEY_W) - KEY_B;
      for (var i = 0; i < 4; i++) {
        var nx = x + dirs[i][0], ny = y + dirs[i][1];
        var nk = ((nx + KEY_B) * KEY_W) + (ny + KEY_B);
        if (self.cells.has(nk) || add.has(nk)) continue;
        add.set(nk, outlineColor);
      }
    });
    add.forEach(function (c, k) { self.cells.set(k, c); });
    return this;
  };

  /** 用 ctx 落盘；ox/oy 是屏幕上的锚点（脚底中心） */
  PixelPen.prototype.flush = function (ctx, ox, oy) {
    var cell = this.cell;
    var w = Math.max(1, cell * this.sx);
    var h = Math.max(1, cell * this.sy);
    var buckets = new Map();
    this.cells.forEach(function (color, k) {
      var arr = buckets.get(color);
      if (!arr) { arr = []; buckets.set(color, arr); }
      arr.push(k);
    });
    buckets.forEach(function (keys, color) {
      ctx.fillStyle = color;
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var x = Math.floor(k / KEY_W) - KEY_B;
        var y = (k % KEY_W) - KEY_B;
        if (this.flip) x = -x - 1;
        var sx = ox + (x + this.offsetX) * cell * this.sx;
        var sy = oy - (y + this.offsetY + 1) * cell * this.sy;
        ctx.fillRect(sx, sy, w, h);
      }
    }, this);
  };

  /** 以角色锚点落盘，自动处理左右翻转 */
  PixelPen.prototype.flushAt = function (ctx, screenX, screenY) {
    var cell = this.cell;
    var ox = screenX + (this.flip ? (this.anchorX + 1) : -this.anchorX) * cell * this.sx;
    this.flush(ctx, ox, screenY);
  };

  /* ======================================================================
   * 2. 配色（三套衣服）
   * ==================================================================== */

  var SKINS = {
    deep: {
      name: '深海蓝',
      hair: '#3a6ea8', hairDark: '#2a527f', hairLight: '#5b93c9',
      hood: '#4a86c4', hoodDark: '#356a9f', hoodLight: '#6ea8dd',
      belly: '#f2f6fb', bellyLine: '#bcd0e4',
      skin: '#ffe0cc', skinShade: '#f0c3ab',
      outline: '#20344a',
      eye: '#2f6fa8', pupil: '#16202e', blush: '#f4909f',
      cloth: '#e8f1fa', clothShade: '#c3d6e8',
      accent: '#7fd4ff', glow: '#8fd8ff'
    },
    coral: {
      name: '珊瑚粉',
      hair: '#d1738f', hairDark: '#b35a75', hairLight: '#efa0b6',
      hood: '#e88ba5', hoodDark: '#c96a86', hoodLight: '#f7aec2',
      belly: '#fff4f7', bellyLine: '#f0c2ce',
      skin: '#ffe3d2', skinShade: '#f2c6ae',
      outline: '#4a2333',
      eye: '#c9587e', pupil: '#2a1620',
      blush: '#f4788f',
      cloth: '#fff0f4', clothShade: '#f0ccd6',
      accent: '#ffd27f', glow: '#ffb3c8'
    },
    moon: {
      name: '月光白',
      hair: '#b9c6de', hairDark: '#93a2bd', hairLight: '#dbe4f2',
      hood: '#cfd9ea', hoodDark: '#adbacf', hoodLight: '#eef3fa',
      belly: '#ffffff', bellyLine: '#d8e0ec',
      skin: '#ffe6d6', skinShade: '#f3cab2',
      outline: '#3c4759',
      eye: '#7b8fd6', pupil: '#1e2330',
      blush: '#f2a0ae',
      cloth: '#f7fafe', clothShade: '#dbe2ee',
      accent: '#c8b6ff', glow: '#d9e6ff'
    }
  };
  var SKIN_ORDER = ['deep', 'coral', 'moon'];

  /* 位图小图元 */
  var BIT = {
    heart: ['.x.x.', 'xxxxx', 'xxxxx', '.xxx.', '..x..'],
    star: ['..x..', '.xxx.', 'xxxxx', '.x.x.', 'x...x'],
    note: ['..xx', '..x.', '..x.', '.xx.', 'xxx.'],
    zzz: ['xxx', '..x', '.x.', 'xxx'],
    spark: ['..x..', '..x..', 'xxxxx', '..x..', '..x..'],
    fish: ['..xx..', 'xxxxxx', '.xxxx.', '..xx..'],
    bubble: ['.xx.', 'x..x', 'x..x', '.xx.'],
    rice: ['.xx.', 'xxxx', 'xxxx', '.xx.'],
    bang: ['x', 'x', 'x', '.', 'x'],
    sweat: ['.xx', 'xx.', '.xx'],
    heartSm: ['.x.', 'xxx', '.x.']
  };

  /* ======================================================================
   * 3. 鲸鱼娘美术
   *    角色朝向 +x（右），脚底在 y = 0，全身高约 29 格
   * ==================================================================== */

  /** 兜帽几何：外层帽壳 + 内部"脸"的位置（二者共用一套参数） */
  function faceGeom(h, droop) {
    var cy = h.cy - (droop || 0);
    var rx = h.rx + 1.2, ry = h.ry + 1.1;
    return {
      outer: { cx: h.cx, cy: cy, rx: rx, ry: ry },
      cx: h.cx + 0.55, cy: cy - 0.35, rx: rx * 0.76, ry: ry * 0.74
    };
  }

  /** 鲸鱼兜帽：帽壳 → 挖出帽口 → 填脸 → 头发 → 鲸鱼特征 */
  function drawHood(pen, h, P, o, f) {
    var out = f.outer, cy = out.cy;
    // 帽壳
    pen.ellipse(out.cx, cy, out.rx, out.ry, P.hood);
    // 顶部高光
    pen.ellipse(out.cx - out.rx * 0.3, cy + out.ry * 0.45, out.rx * 0.5, out.ry * 0.42, P.hoodLight);
    // 帽底暗部
    pen.ellipse(out.cx - out.rx * 0.1, cy - out.ry * 0.72, out.rx * 0.9, out.ry * 0.36, P.hoodDark);
    // 挖出帽口，再填上脸
    pen.eraseEllipse(f.cx, f.cy, f.rx * 1.06, f.ry * 1.06);
    pen.ellipse(f.cx, f.cy, f.rx, f.ry, P.skin);
    // 刘海
    pen.rect(f.cx - f.rx, f.cy + f.ry * 0.52, f.rx * 2, 1.5, P.hair);
    pen.tri(f.cx - f.rx * 0.95, f.cy + f.ry * 0.72, f.cx + f.rx * 0.85, f.cy + f.ry * 0.72, f.cx - f.rx * 0.15, f.cy + f.ry * 0.05, P.hair);
    pen.tri(f.cx + f.rx * 0.1, f.cy + f.ry * 0.72, f.cx + f.rx * 0.9, f.cy + f.ry * 0.72, f.cx + f.rx * 0.5, f.cy + f.ry * 0.15, P.hairLight);
    // 垂到肩上的长发绺（强化女孩子轮廓，延伸到帽底以下）
    pen.ellipse(f.cx - f.rx * 1.2, f.cy - f.ry * 1.0, 1.05, 2.5, P.hair);
    pen.ellipse(f.cx + f.rx * 1.2, f.cy - f.ry * 0.95, 1.0, 2.4, P.hairDark);
    // 鲸鱼特征：帽顶气孔 + 帽侧鲸鱼眼
    pen.rect(out.cx - 1.1, cy + out.ry + 0.2, 2.2, 1.2, P.hoodDark);
    pen.ellipse(out.cx - out.rx * 0.95, cy + out.ry * 0.22, 0.85, 0.95, P.outline);
    // 侧鳍（像耳朵）
    var fin = o.finFlap || 0;
    pen.tri(out.cx - out.rx - 0.6, cy + 0.4, out.cx - out.rx - 0.2, cy + 2.4 + fin, out.cx - out.rx - 2.6, cy - 0.2 + fin, P.hoodDark);
    pen.tri(out.cx + out.rx + 0.6, cy + 0.4, out.cx + out.rx + 2.6, cy - 0.2 + fin, out.cx + out.rx + 0.2, cy + 2.4 + fin, P.hoodLight);
  }

  /** 喷水：头顶冒出的水汽（固定水色，不随皮肤变，避免珊瑚粉喷出黄水） */
  var WATER = { core: '#dff2ff', mid: '#a8ddf7', edge: '#7cc4e8' };
  function drawSpout(pen, h, o, P) {
    if (!o.spout) return;
    var t = o.t || 0;
    var out = h.outer || { cx: h.cx, cy: h.cy, rx: h.rx, ry: h.ry };
    var bx = out.cx, by = out.cy + out.ry + 1.0;
    // 三颗上浮的水珠
    for (var i = 0; i < 3; i++) {
      var p = i / 2;
      var wob = Math.sin(t * 2.6 + i * 1.9) * (0.35 + p * 0.45);
      var r = lerp(1.05, 0.75, p);
      pen.ellipse(bx + wob, by + 1.0 + p * 2.6, r, r * 0.95, i === 1 ? WATER.core : WATER.mid);
    }
    // 顶部一小团水汽
    var topY = by + 5.2 + Math.sin(t * 2.2) * 0.35;
    pen.ellipse(bx, topY, 2.1, 1.15, WATER.core);
    pen.ellipse(bx - 1.6, topY - 0.5, 1.1, 0.8, WATER.mid);
    pen.ellipse(bx + 1.6, topY - 0.4, 1.1, 0.75, WATER.mid);
    pen.ellipse(bx - 0.2, topY + 1.1, 0.8, 0.7, WATER.edge);
  }

  /** 脸：眼睛 / 腮红 / 嘴（f 为 faceGeom 算出的脸部几何） */
  function drawFace(pen, f, o, P) {
    var expr = o.expr || 'normal';
    var ex = clamp(o.lookX || 0, -1, 1) * 0.75;
    var ey = clamp(o.lookY || 0, -1, 1) * 0.55;
    var eyeY = f.cy - 0.2;
    var gap = f.rx * 0.52;
    var eyes = [f.cx - gap, f.cx + gap];

    if (expr === 'heart') {
      for (var i = 0; i < 2; i++) pen.bitmap(BIT.heartSm, eyes[i] - 1.0, eyeY - 1.0, P.blush, 1);
    } else if (expr === 'closed') {
      // ∩ 形笑眼
      for (var j = 0; j < 2; j++) {
        var x = Math.round(eyes[j]);
        pen.px(x - 1.5, Math.round(eyeY), P.outline);
        pen.px(x - 0.5, Math.round(eyeY) + 1, P.outline);
        pen.px(x + 0.5, Math.round(eyeY) + 1, P.outline);
        pen.px(x + 1.5, Math.round(eyeY), P.outline);
      }
    } else if (expr === 'sleep') {
      for (var k = 0; k < 2; k++) pen.rect(eyes[k] - 1.4, eyeY, 2.8, 0.8, P.outline);
    } else if (expr === 'wide') {
      for (var m = 0; m < 2; m++) {
        pen.ellipse(eyes[m], eyeY, 1.5, 1.7, '#ffffff');
        pen.ellipse(eyes[m] + ex * 0.5, eyeY + ey * 0.5, 0.7, 0.9, P.pupil);
      }
    } else if (expr === 'half') {
      for (var n = 0; n < 2; n++) {
        pen.ellipse(eyes[n], eyeY - 0.25, 1.4, 1.5, P.eye);
        pen.ellipse(eyes[n] + ex, eyeY - 0.25 + ey, 0.75, 0.95, P.pupil);
        pen.rect(eyes[n] - 1.5, eyeY + 0.5, 3.0, 0.9, P.skinShade);
      }
    } else {
      for (var q = 0; q < 2; q++) {
        pen.ellipse(eyes[q], eyeY, 1.5, 1.75, P.eye);
        pen.ellipse(eyes[q] + ex, eyeY + ey, 0.8, 1.1, P.pupil);
        pen.rect(Math.round(eyes[q] + ex) - 1, Math.round(eyeY + ey) + 1, 1, 1, '#ffffff');
      }
    }

    // 腮红
    if (o.blush || expr === 'closed' || expr === 'heart') {
      pen.rect(f.cx - f.rx * 1.05, f.cy - 1.1, 1.5, 0.9, P.blush);
      pen.rect(f.cx + f.rx * 0.55, f.cy - 1.1, 1.5, 0.9, P.blush);
    }
    // 嘴
    var mx = f.cx, my = f.cy - 2.0;
    if (o.chew) {
      pen.ellipse(mx, my - 0.2, 0.95, 0.7, '#c2566b');
    } else if (o.sad) {
      pen.rect(mx - 1.1, my + 0.6, 1.1, 0.65, P.outline);
      pen.rect(mx + 0.1, my + 0.6, 1.1, 0.65, P.outline);
    } else if (expr === 'closed' || o.happyMouth) {
      pen.rect(mx - 1.2, my + 0.35, 1.1, 0.65, P.outline);
      pen.rect(mx + 0.1, my + 0.35, 1.1, 0.65, P.outline);
    } else if (expr !== 'wide' && expr !== 'heart') {
      pen.rect(mx - 0.8, my, 1.6, 0.6, P.skinShade);
    }
  }

  /** 身体（连帽卫衣 + 裙摆 + 鲸鱼腹纹） */
  function drawBody(pen, b, P, o) {
    // 尾巴（身后，先画）：短、贴臀部、向上翘，才像鲸尾而不是手臂
    if (o.tail !== false) drawTail(pen, b.cx - b.rx * 0.7, b.cy - b.ry * 0.95, o.tailPhase || 0, P);
    // 躯干
    pen.ellipse(b.cx, b.cy, b.rx, b.ry, P.hood);
    // 白色腹部（鲸鱼腹纹）
    pen.ellipse(b.cx + b.rx * 0.28, b.cy - b.ry * 0.05, b.rx * 0.58, b.ry * 0.68, P.belly);
    for (var i = 0; i < 3; i++) {
      pen.rect(b.cx + b.rx * 0.1, b.cy - b.ry * 0.1 + i * 1.2, b.rx * 0.55, 0.5, P.bellyLine);
    }
    // 裙摆：向下张开的梯形，明确"女孩子"的轮廓
    pen.tri(b.cx - b.rx * 1.28, b.cy - b.ry * 1.15, b.cx + b.rx * 1.28, b.cy - b.ry * 1.15, b.cx, b.cy - b.ry * 0.30, P.hoodDark);
    pen.rect(b.cx - b.rx * 1.28, b.cy - b.ry * 1.25, b.rx * 2.56, 0.6, P.hood);
  }

  function drawTail(pen, x, y, phase, P) {
    var segs = 4, ang = Math.PI * 0.82;   // 起点朝左上方翘
    var cx = x, cy = y;
    for (var i = 0; i < segs; i++) {
      var t = i / (segs - 1);
      ang += Math.sin(phase - t * 1.8) * 0.26 - 0.10;
      cx += Math.cos(ang) * 1.05;
      cy += Math.sin(ang) * 1.05;
      var r = lerp(1.35, 0.9, t);
      pen.ellipse(cx, cy, r, r, P.hood);
    }
    // 尾鳍：两瓣，像横过来的心
    pen.tri(cx, cy, cx - 2.3, cy + 2.1, cx - 0.3, cy + 0.6, P.hoodLight);
    pen.tri(cx, cy, cx - 2.5, cy - 1.6, cx - 0.4, cy - 0.5, P.hoodLight);
  }

  /** 手臂：sy 为肩部 y，arm 参数控制姿势 */
  function drawArms(pen, b, o, P, mode) {
    var lx = b.cx - b.rx * 0.85, rx2 = b.cx + b.rx * 0.85;
    var sy = b.cy + b.ry * 0.45;
    if (mode === 'up') {
      pen.rect(lx - 1.0, sy, 1.8, 4.4, P.hood);
      pen.rect(lx - 1.8, sy + 4.0, 1.5, 1.5, P.skin);
      pen.rect(rx2 - 0.8, sy, 1.8, 4.4, P.hoodLight);
      pen.rect(rx2 + 0.3, sy + 4.0, 1.5, 1.5, P.skin);
    } else if (mode === 'hold') {
      // 抱着东西（笔记本/点心）
      pen.rect(lx - 1.2, sy - 2.6, 1.7, 3.2, P.hood);
      pen.rect(rx2 - 0.5, sy - 2.6, 1.7, 3.2, P.hoodLight);
    } else if (mode === 'dangle') {
      pen.rect(lx - 0.6, sy + 1.6, 1.6, 3.4, P.hood);
      pen.rect(rx2 - 1.0, sy + 1.6, 1.6, 3.4, P.hoodLight);
    } else if (mode === 'chin') {
      pen.rect(lx - 1.2, sy - 1.0, 1.7, 3.0, P.hood);
      pen.rect(rx2 - 0.7, sy - 1.0, 1.7, 3.6, P.hoodLight);
      pen.rect(rx2 - 1.0, b.cy + b.ry + 0.8, 1.9, 1.6, P.skin);
    } else {
      pen.rect(lx - 1.0, sy - 1.6, 1.7, 3.6, P.hood);
      pen.rect(rx2 - 0.7, sy - 1.6, 1.7, 3.6, P.hoodLight);
    }
  }

  /** 腿：短腿 + 靴子 */
  function drawLegs(pen, b, o, P, mode) {
    var len = mode === 'sit' ? 3.2 : 4.8;
    var xs = [b.cx - 2.3, b.cx + 0.5];
    for (var i = 0; i < 2; i++) {
      var sway = mode === 'dangle' ? Math.sin((o.t || 0) * 6 + i * 1.7) * 0.8 : 0;
      var x = xs[i] + sway;
      // 腿（皮肤/袜子）
      pen.rect(x, 1.3, 2.2, len - 1.3, i ? P.skin : P.skinShade);
      // 靴筒 + 鞋底
      pen.rect(x - 0.2, 0.9, 2.6, 1.6, P.hoodDark);
      pen.rect(x - 0.4, 0, 3.0, 0.9, P.outline);
    }
  }

  /**
   * 主绘制入口
   * o = { skin, pose, t, phase, tailPhase, lookX, lookY, expr, blush, chew, sad,
   *       droop, spout, finFlap, laptop, snack, alert, squash, tapAnim }
   */
  function drawWhale(pen, o) {
    var P = SKINS[o.skin] || SKINS.deep;
    var pose = o.pose || 'idle';
    pen.offsetX = 0;
    pen.offsetY = 0;
    pen.sx = 1; pen.sy = 1;

    var breathe = Math.sin((o.phase || 0) * 1.5) * 0.22;

    if (pose === 'sleep') { drawSleeping(pen, o, P); return; }
    if (pose === 'drag') { drawDangling(pen, o, P); return; }

    // 站立基准：脚 0..5，身体中心 y≈9.4，兜帽中心 y≈18.6
    var b = { cx: 12.2, cy: 9.6 + breathe, rx: 4.5, ry: 4.3 + breathe * 0.4 };
    var h = { cx: 12.6, cy: 18.6 + breathe * 0.8, rx: 4.2, ry: 3.9 };
    if (pose === 'work' || pose === 'sit') {
      b = { cx: 12.2, cy: 7.4 + breathe, rx: 4.8, ry: 4.0 };
      h = { cx: 12.6, cy: 16.4 + breathe * 0.8, rx: 4.1, ry: 3.8 };
    }
    if (pose === 'sad') o = copyLine(o, { droop: 0.7, sad: true, expr: 'half' });

    var f = faceGeom(h, o.droop);
    var sit = (pose === 'work' || pose === 'sit');

    pen.group(function () {
      drawLegs(pen, b, o, P, sit ? 'sit' : 'stand');
      drawBody(pen, b, P, o);
      var armMode = 'side';
      if (pose === 'work') armMode = 'hold';
      else if (pose === 'approve') armMode = 'up';
      else if (pose === 'think') armMode = 'chin';
      else if (pose === 'eat') armMode = 'hold';
      else if (pose === 'levelup') armMode = 'up';
      drawArms(pen, b, o, P, armMode);
      drawHood(pen, h, P, o, f);
    }, P.outline);

    // 喷水在描边之后画，水才不会带黑边
    drawSpout(pen, f, o, P);

    // ---- 道具 ----
    if (pose === 'work' && o.laptop) {
      pen.group(function () {
        pen.rect(b.cx - 2.8, b.cy - 1.0, 5.4, 3.4, P.outline);
        pen.rect(b.cx - 2.4, b.cy - 0.6, 4.6, 2.6, P.accent);
        pen.rect(b.cx - 2.4, b.cy + 1.0, 4.6, 1.0, '#ffffff');
        pen.rect(b.cx - 3.2, b.cy + 2.4, 6.2, 0.4, P.glow);
      }, P.outline);
    }
    if (pose === 'eat' && o.snack) {
      pen.group(function () {
        pen.bitmap(BIT.rice, b.cx + 3.2, b.cy + 0.4, P.belly, 1);
        pen.rect(b.cx + 3.6, b.cy + 2.2, 1.6, 0.5, P.hoodDark);
      }, P.outline);
    }
    if (pose === 'approve' && o.alert) {
      var pulse = 0.5 + Math.sin((o.phase || 0) * 6) * 0.5;
      var ax = h.cx + 6.4, ay = h.cy + 2.6 + pulse;
      pen.group(function () {
        pen.rect(ax, ay, 1.8, 4.2, '#ffd166');
        pen.rect(ax, ay - 2.2, 1.8, 1.8, '#ffd166');
      }, '#a9741a');
    }

    drawFace(pen, f, copyLine(o, {
      blush: o.blush || pose === 'happy' || pose === 'levelup',
      chew: !!o.chew,
      happyMouth: pose === 'happy' || pose === 'levelup'
    }), P);

    // 键盘联动：抬手敲一下
    var tm = o.tapAnim || 0;
    if (tm > 0.05) {
      pen.rect(b.cx + 2.2, b.cy + 1.2 + tm * 1.8, 1.9, 1.4, P.skin);
    }
  }

  function drawSleeping(pen, o, P) {
    var br = Math.sin((o.phase || 0) * 1.1) * 0.35;
    var b = { cx: 11.6, cy: 4.0 + br * 0.4, rx: 6.4, ry: 3.4 + br };
    var h = { cx: 16.4, cy: 5.6 + br * 0.5, rx: 3.7, ry: 3.3 };
    var f = faceGeom(h, 0.5);
    pen.group(function () {
      drawTail(pen, b.cx - 5.4, b.cy - 0.4, (o.tailPhase || 0) * 0.4, P);
      pen.ellipse(b.cx, b.cy, b.rx, b.ry, P.hood);
      pen.ellipse(b.cx, b.cy - b.ry * 0.55, b.rx * 0.95, b.ry * 0.45, P.hoodDark);
      pen.ellipse(b.cx - 1.4, b.cy + 0.1, b.rx * 0.45, b.ry * 0.55, P.belly);
      drawHood(pen, h, P, o, f);
    }, P.outline);
    drawFace(pen, f, copyLine(o, { expr: 'sleep' }), P);
  }

  function drawDangling(pen, o, P) {
    var sway = Math.sin((o.t || 0) * 3.0) * 0.8;
    var b = { cx: 12.2 + sway * 0.4, cy: 8.6, rx: 3.6, ry: 5.0 };
    var h = { cx: 12.4 + sway * 0.7, cy: 17.2, rx: 4.0, ry: 3.8 };
    var f = faceGeom(h, 0);
    pen.group(function () {
      // 乱蹬的腿
      var xs = [b.cx - 2.6, b.cx + 0.4];
      for (var i = 0; i < 2; i++) {
        var kick = Math.sin((o.t || 0) * 7 + i * 1.6) * 1.0;
        pen.rect(xs[i] + kick * 0.6, 0.4 + Math.abs(kick) * 0.6, 2.1, 3.4, i ? P.skin : P.skinShade);
        pen.rect(xs[i] + kick * 0.6 - 0.2, 0, 2.5, 1.2, P.hoodDark);
      }
      drawBody(pen, b, P, o);
      drawArms(pen, b, o, P, 'up');
      drawHood(pen, h, P, o, f);
    }, P.outline);
    drawFace(pen, f, copyLine(o, { expr: 'wide', blush: true }), P);
  }

  /** 浅拷贝覆盖字段 */
  function copyLine(o, extra) {
    var out = {};
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
    for (var j in extra) if (Object.prototype.hasOwnProperty.call(extra, j)) out[j] = extra[j];
    return out;
  }

  /* ======================================================================
   * 4. 台词
   * ==================================================================== */

  var LINES = {
    idle: [
      '要不要摸摸我？', '今天也一起加油吧～', '（吐了个泡泡）', '有点无聊…',
      '你在忙什么呀？', '海水好暖和', '喵…啊不是，呜～'
    ],
    greet: ['你回来啦！', '我等你好久了～', '欢迎回来，先喝口水吧'],
    work: ['我抱着笔记本，不吵你', '专心干活，我在旁边', '（认真脸）', '工具跑起来了'],
    approve: ['这里要你点头才行！', '需要你确认一下～', '喂喂，卡住啦！'],
    think: ['在想…在想…', '让我琢磨一下', '（歪头）'],
    patHead: ['呜…头好舒服～', '再摸一下嘛！', '呼噜呼噜～', '（眼睛眯起来了）'],
    patBelly: ['呀！肚子不行！', '好痒好痒！', '（缩了一下）'],
    patTail: ['尾巴！别拽尾巴！', '（尾巴甩了一下）', '呜…尾巴很敏感的'],
    feed: ['好吃！谢谢！', '咔嚓咔嚓～', '还有吗？', '（腮帮子鼓鼓的）'],
    foodFavorite: ['！最喜欢这个了', '你怎么知道我想吃这个！', '（眼睛都亮了）', '这个我可以吃三份！'],
    foodDislike: ['唔…这个不太喜欢', '（小口小口地吃）', '谢、谢谢…我慢慢吃', '下次可以换一个吗'],
    play: ['一起玩嘛！', '看我的！', '再来一局～', '（尾巴摇得很欢）', '这个我会！'],
    walk: ['散散步～', '走两步', '（迈着小短腿）', '出去转转！'],
    walkLook: ['这里的风景不错…', '（东张西望）', '那边是什么？', '歇一会儿'],
    walkMeet: ['咦，有人？', '你好呀～', '（朝你挥了挥手）', '在忙吗？'],
    praise: ['真的吗？嘿嘿～', '我会继续努力的！', '（害羞地冒泡泡）'],
    hungry: ['有点饿了…有小点心吗？', '肚子在叫…', '呜…想吃东西'],
    sleepy: ['好困…我先打个盹', 'zzz…', '（打了个哈欠）'],
    levelup: ['我长大了！Lv.{lv}', '升级啦～Lv.{lv}', '嘿嘿，变强了！Lv.{lv}'],
    longWork: ['你已经忙了 {min} 分钟，起来走两步吧', '歇一会儿嘛，我陪你去接水'],
    lateNight: ['已经很晚了…早点休息好不好？', '深夜了，别熬太狠'],
    back: ['你回来啦，刚刚去哪了？', '（揉揉眼睛）等你好久了'],
    drag: ['哇——放我下来！', '我恐高！', '（手脚乱蹬）'],
    token: ['嗝，吃饱了…Token 真香', '又长大一点点～', '（满意地拍肚子）'],
    maxLevel: ['已经很厉害了！', '陪你这么久，我很开心']
  };

  /* ======================================================================
   * 5. 桌宠状态机
   * ==================================================================== */

  var AMBIENT = { idle: 'idle', thinking: 'think', working: 'work', approval: 'approve', error: 'sad' };
  // 工作态姿势钉住时长（毫秒）：短暂信号抖动不切姿势，避免抽搐
  var PIN_MS = { working: 8000, approval: 0, thinking: 4000, error: 6000, idle: 0 };

  function Pet(opts) {
    opts = opts || {};
    this.version = VERSION;
    this.view = { w: opts.w || 960, h: opts.h || 640 };
    this.floorInset = opts.floorInset != null ? opts.floorInset : 18;

    this.skin = opts.skin || 'deep';
    this.name = opts.name || '小汐';
    this.userName = opts.userName || '你';

    // 位置与物理
    this.x = this.view.w - 140;
    this.y = this.floorY();
    this.vx = 0; this.vy = 0;
    this.facing = -1;
    this.dragging = false;
    this.edgeHang = false;

    // 姿态
    this.mode = 'idle';       // idle | work | think | approve | sad | happy | eat | sleep | drag | levelup | wander
    this.ambient = 'idle';    // 宿主信号（忙闲）
    this.modeUntil = 0;
    this.pinUntil = 0;
    this.pose = 'idle';
    this.phase = 0;
    this.tailPhase = rand(0, TAU);
    this.t = 0;

    // 表情
    this.blinkT = rand(2, 6);
    this.blinking = false;
    this.expr = 'normal';
    this.lookX = 0; this.lookY = 0;
    this.chew = false;
    this.squash = 0;
    this.tapAnim = 0;

    // 美术层（可插拔）：为空时用内置像素渲染器
    this.art = null;
    this.artHint = null;        // 特殊场合立绘提示（greet / star / night …）
    this.artHintUntil = 0;
    this.lastZone = null;       // 最近一次被摸的分区

    // 养成
    this.level = 1;
    this.exp = 0;
    this.mood = 82;
    this.hunger = 78;
    this.energy = 74;
    this.bond = 0;
    this.tokens = 0;          // 累计喂过的 Token
    this.fedToday = 0;
    this.streak = 0;
    this.lastSeen = Date.now();
    this.totalPat = 0;
    this.totalFeed = 0;
    this.unlocks = {};

    // 互动
    this.cursor = { x: this.x, y: this.y - 120, active: false };
    this.followCursor = opts.followCursor !== false;
    this.particles = [];
    this.speech = null;
    this.events = [];         // 给表现层取用的一次性特效事件

    this._decideT = rand(2, 5);
    this._saveT = 0;
    this._patCooldown = 0;
  }

  Pet.prototype.floorY = function () { return this.view.h - this.floorInset; };
  Pet.prototype.unit = function () { return clamp(Math.round(this.view.h / 100), 4, 8); };

  /**
   * 换美术层（插画立绘 / 其它画风）。传 null 回到内置像素渲染器。
   * 行为内核（状态机、养成、物理、交互）完全不受影响。
   */
  Pet.prototype.setArt = function (art) {
    this.art = art || null;
    return this;
  };

  /** 临时换一张特殊立绘（打招呼、星星眼…） */
  Pet.prototype.hintArt = function (key, secs) {
    this.artHint = key || null;
    this.artHintUntil = key ? this.t + (secs || 3) : 0;
    return this;
  };
  /** 她的半身宽（格）：贴边时要按这个留位置，否则会被窗口裁掉半个身子 */
  Pet.prototype.halfWidth = function () { return 13 * this.unit(); };
  /** 能完整装下她的 x 区间 */
  Pet.prototype.xRange = function () {
    var hw = this.halfWidth();
    return { min: hw, max: Math.max(hw, this.view.w - hw) };
  };

  Pet.prototype.setViewport = function (w, h) {
    var wasBottom = Math.abs(this.y - this.floorY()) < 2;
    this.view.w = w; this.view.h = h;
    var r = this.xRange();
    this.x = clamp(this.x, r.min, r.max);
    if (wasBottom || !this.dragging) this.y = this.floorY();
  };

  /* ------------------------------ 交互接口 ------------------------------ */

  Pet.prototype.say = function (text, secs) {
    if (!text) return;
    this.speech = { text: text, until: this.t + (secs || 2.8), born: this.t };
    this.events.push({ type: 'say', text: text });
  };

  Pet.prototype.randomLine = function (key, vars) {
    var pool = LINES[key] || LINES.idle;
    var line = pick(pool);
    if (vars) for (var k in vars) line = line.split('{' + k + '}').join(vars[k]);
    return line;
  };

  /** 宿主信号：idle | thinking | working | approval | error */
  Pet.prototype.signal = function (state, detail) {
    if (!AMBIENT[state]) state = 'idle';
    var changed = state !== this.ambient;
    this.ambient = state;
    this.ambientDetail = detail || null;
    // 忙态持续期间不断续期"姿势钉住"，这样信号断了也不会立刻切回待机
    var pin = PIN_MS[state] || 0;
    if (pin) this.pinUntil = this.t + pin / 1000;
    if (changed) {
      if (state === 'working' && this.mode !== 'work') this.say(this.randomLine('work'), 2.2);
      if (state === 'approval') this.say(this.randomLine('approve'), 3.2);
    }
  };

  /** Token 用量 → 养成（WhaleIsle 思路：干活即是投喂） */
  Pet.prototype.addTokens = function (n) {
    if (!(n > 0)) return;
    this.tokens += n;
    this.exp += n / 400;                 // 每 400 token 一点经验
    this.hunger = clamp(this.hunger + n / 3000, 0, 100);
    this.mood = clamp(this.mood + n / 8000, 0, 100);
    this.checkLevel();
  };

  Pet.prototype.checkLevel = function () {
    var need = this.expNeed();
    while (this.exp >= need) {
      this.exp -= need;
      this.level += 1;
      this.mood = clamp(this.mood + 12, 0, 100);
      this.say(this.randomLine('levelup', { lv: this.level }), 3.4);
      this.events.push({ type: 'levelup', level: this.level });
      for (var i = 0; i < 20; i++) this.spawn('spark', this.x + rand(-30, 30), this.y - rand(30, 150));
      need = this.expNeed();
    }
  };

  Pet.prototype.expNeed = function () { return 40 + this.level * 26; };

  /**
   * 命中分区。装了美术层（例如插画立绘）时交给它判定——
   * 立绘的轮廓和像素版不一样，分区几何也跟着换。
   */
  Pet.prototype.hitZone = function (px, py) {
    if (this.art && typeof this.art.zoneAt === 'function') {
      try {
        var z = this.art.zoneAt(this, px, py);
        if (z !== undefined) return z;
      } catch (e) { /* 美术层判定失败就退回内置几何 */ }
    }
    var u = this.unit();
    var dx = px - this.x;
    var dyTop = this.y - py;                     // 向上为正
    if (this.mode === 'sleep') {
      if (dx > -8 * u && dx < 12 * u && dyTop > -1 * u && dyTop < 8 * u) return 'head';
      return null;
    }
    var headTop = 24 * u, headBottom = 14 * u;
    if (dyTop > headBottom && dyTop < headTop + 3 * u && Math.abs(dx) < 9 * u) return 'head';
    if (dyTop > 4 * u && dyTop <= headBottom && Math.abs(dx) < 9 * u) return 'belly';
    // 尾巴：身后（面向的反方向）
    var tailX = this.x - this.facing * 10 * u;
    if (dyTop > 2 * u && dyTop < 12 * u && Math.abs(px - tailX) < 5 * u) return 'tail';
    return null;
  };

  Pet.prototype.hitTest = function (px, py) { return this.hitZone(px, py) !== null; };

  Pet.prototype.pat = function (zone) {
    zone = zone || 'head';
    if (this._patCooldown > 0) return null;
    this._patCooldown = 0.25;
    this.totalPat += 1;
    this.lastZone = zone;                        // 美术层用它挑"摸头/捏肚子/拽尾巴"专属立绘
    var gain = 2;
    if (zone === 'belly') { this.mood = clamp(this.mood - 3, 0, 100); gain = 1; }
    else if (zone === 'tail') { this.mood = clamp(this.mood - 1, 0, 100); gain = 1; }
    else { this.mood = clamp(this.mood + 5, 0, 100); gain = 3; }
    this.bond += gain;
    this.exp += gain * 0.6;
    this.setMode('happy', 1.5);
    this.say(this.randomLine(zone === 'head' ? 'patHead' : zone === 'belly' ? 'patBelly' : 'patTail'), 2.4);
    for (var i = 0; i < 3; i++) this.spawn('heart', this.x + rand(-16, 16), this.y - rand(70, 120));
    this.events.push({ type: 'pat', zone: zone, combo: this.totalPat });
    if (this.totalPat % 10 === 0) this.bond += 3;
    this.checkLevel();
    return zone;
  };

  /**
   * 食物表：不同食物给不同反馈与表情。
   * 界面直接读这份渲染菜单——加一种食物只要在这里加一行。
   * hint 对应美术层的表情立绘 key（拿不到就回落到吃饭图）。
   */
  var FOODS = [
    { id: 'fish', label: '小鱼干', hunger: 22, mood: 4, energy: 2, bond: 3, exp: 4, particle: 'fish', hint: 'eat', line: '小鱼干！最喜欢了' },
    { id: 'pudding', label: '深海布丁', hunger: 14, mood: 14, energy: 4, bond: 5, exp: 6, particle: 'heart', hint: 'foodPudding', line: '布丁滑滑的～' },
    { id: 'cake', label: '星星蛋糕', hunger: 18, mood: 12, energy: -2, bond: 5, exp: 7, particle: 'star', hint: 'foodCake', line: '蛋糕上有星星！' },
    { id: 'milktea', label: '珍珠奶茶', hunger: 10, mood: 10, energy: 12, bond: 4, exp: 5, particle: 'bubble', hint: 'foodDrink', line: '（吸溜吸溜）珍珠好弹' },
    { id: 'salad', label: '海藻沙拉', hunger: 26, mood: 2, energy: 6, bond: 2, exp: 4, particle: 'dust', hint: 'foodSalad', line: '健康最重要…' },
    { id: 'candy', label: '星星糖', hunger: 6, mood: 18, energy: 6, bond: 6, exp: 8, particle: 'spark', hint: 'star', line: '甜甜的！再来一颗？' }
  ];
  var DEFAULT_FOOD = FOODS[0];

  function numOr(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  /** 由名字推导的稳定哈希：同一个名字永远得到同一个口味 */
  function tasteIndex(name, salt, len) {
    var s = String(name || '小汐') + '|' + salt;
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000003;
    return len > 0 ? h % len : 0;
  }

  /** 她的最爱（名字决定；改名字会换口味，这也算一种性格） */
  function favoriteFoodFor(name) {
    return FOODS[tasteIndex(name, 'fav', FOODS.length)];
  }

  /** 她不太喜欢的那一种（保证和最爱不是同一种） */
  function dislikedFoodFor(name) {
    var fav = tasteIndex(name, 'fav', FOODS.length);
    var idx = (fav + 1 + tasteIndex(name, 'dis', Math.max(1, FOODS.length - 1))) % FOODS.length;
    if (idx === fav) idx = (fav + 1) % FOODS.length;
    return FOODS[idx];
  }

  /**
   * 投喂。可以不传参数（默认小鱼干），也可以传 FOODS 里的一项。
   * 喂到她最爱的那一种有额外加成；喂到不喜欢的会有点小情绪（但照样吃）。
   * 返回真正用上的食物 + 是不是最爱/不喜欢，方便宿主显示。
   */
  Pet.prototype.feed = function (food) {
    var f = (food && typeof food === 'object') ? food : DEFAULT_FOOD;
    this.foodTries = this.foodTries || {};
    this.totalFeed += 1;
    this.lastFood = f.id || DEFAULT_FOOD.id;
    this.hunger = clamp(this.hunger + numOr(f.hunger, 26), 0, 100);
    this.mood = clamp(this.mood + numOr(f.mood, 6), 0, 100);
    if (typeof f.energy === 'number') this.energy = clamp(this.energy + f.energy, 0, 100);
    this.bond += numOr(f.bond, 4);
    this.exp += numOr(f.exp, 5);

    var fav = favoriteFoodFor(this.name);
    var dis = dislikedFoodFor(this.name);
    var isFav = f.id === fav.id;
    var isDis = !isFav && f.id === dis.id;

    this.setMode('eat', 2.4);
    if (isFav) {
      // 最爱：心情/亲密额外加成 + 星星眼
      this.mood = clamp(this.mood + 10, 0, 100);
      this.bond += 4;
      this.exp += 2;
      if (this.hintArt) this.hintArt('star', 2.8);
      this.say(this.randomLine('foodFavorite'), 2.8);
      for (var s = 0; s < 6; s++) this.spawn('star', this.x + rand(-24, 24), this.y - rand(60, 140));
    } else if (isDis) {
      this.mood = clamp(this.mood - 6, 0, 100);
      if (f.hint && this.hintArt) this.hintArt(f.hint, 2.6);
      this.say(this.randomLine('foodDislike'), 2.6);
    } else {
      // 每种食物有自己的表情（拿不到对应立绘会自动回落到吃饭图）
      if (f.hint && this.hintArt) this.hintArt(f.hint, 2.6);
      this.say(f.line || this.randomLine('feed'), 2.4);
    }

    for (var i = 0; i < 4; i++) {
      this.spawn(f.particle || 'fish', this.x + rand(-10, 24), this.y - rand(60, 100));
    }
    this.foodTries[this.lastFood] = (this.foodTries[this.lastFood] || 0) + 1;
    if (isFav) this.favoriteKnown = true;         // 喂到过才知道她爱吃什么
    this.events.push({ type: 'feed', food: this.lastFood, favorite: isFav, disliked: isDis });
    this.checkLevel();
    return {
      id: f.id, label: f.label, hunger: f.hunger, mood: f.mood, energy: f.energy,
      bond: f.bond, exp: f.exp, line: f.line, hint: f.hint,
      favorite: isFav, disliked: isDis,
    };
  };

  /** 玩一下：心情涨得快、精力掉得快 */
  Pet.prototype.play = function () {
    var tooTired = this.energy < 12;
    if (tooTired) {
      this.say('好累…先歇会儿', 2.4);
      this.setMode('happy', 1.2);
      return { ok: false, reason: 'tired' };
    }
    this.mood = clamp(this.mood + 16, 0, 100);
    this.energy = clamp(this.energy - 12, 0, 100);
    this.bond += 4;
    this.exp += 6;
    this.setMode('play', 2.8);
    this.say(this.randomLine('play'), 2.6);
    for (var i = 0; i < 10; i++) {
      this.spawn(i % 2 ? 'star' : 'heart', this.x + rand(-28, 28), this.y - rand(50, 150));
    }
    this.events.push({ type: 'play' });
    this.checkLevel();
    return { ok: true };
  };

  /**
   * 散步：朝目标 x 走过去，到了自动停下。
   * 桌面版不用这个——那边是整个窗口在走；窗口版用它在页面里溜达。
   */
  Pet.prototype.walkTo = function (targetX, opts) {
    opts = opts || {};
    var range = this.xRange();
    var target = clamp(numOr(Number(targetX), this.x), range.min, range.max);
    this.walkTarget = target;
    this.walkSpeed = Math.max(20, numOr(opts.speed, 130));
    if (opts.say !== false) this.say(this.randomLine('walk'), 2.2);
    this.setMode('walk', 0);            // 走到才停，不用超时
    return target;
  };

  /** 停下来（宿主主动打断散步时用） */
  Pet.prototype.stopWalking = function () {
    this.walkTarget = null;
    if (this.mode === 'walk') this.setMode('idle', 0);
    return this;
  };

  Pet.prototype.praise = function () {
    this.mood = clamp(this.mood + 10, 0, 100);
    this.bond += 3;
    this.exp += 3;
    this.setMode('levelup', 1.8);
    this.say(this.randomLine('praise'), 2.6);
    for (var i = 0; i < 8; i++) this.spawn('star', this.x + rand(-24, 24), this.y - rand(60, 140));
    this.checkLevel();
  };

  Pet.prototype.toggleSleep = function (force) {
    var goSleep = force != null ? force : this.mode !== 'sleep';
    if (goSleep) {
      this.setMode('sleep', 0);
      this.say(this.randomLine('sleepy'), 2.4);
    } else {
      this.setMode('idle', 0);
      this.say('唔…睡饱了', 2.2);
    }
    return goSleep;
  };

  Pet.prototype.onKeyTap = function () {
    this.tapAnim = 1;
    if (Math.random() < 0.22) this.spawn('note', this.x + rand(-14, 14), this.y - rand(80, 120));
  };

  Pet.prototype.startDrag = function (x, y) {
    this.dragging = true;
    this.setMode('drag', 0);
    this.vx = 0; this.vy = 0;
    this._grabX = x - this.x;
    this._grabY = y - this.y;
    this.say(this.randomLine('drag'), 1.8);
  };

  Pet.prototype.dragTo = function (x, y, dt) {
    if (!this.dragging) return;
    var nx = x - this._grabX, ny = y - this._grabY;
    if (dt > 0) {
      this.vx = (nx - this.x) / dt;
      this.vy = (ny - this.y) / dt;
    }
    this.x = nx; this.y = ny;
    this.edgeHang = false;
  };

  Pet.prototype.endDrag = function () {
    if (!this.dragging) return;
    this.dragging = false;
    // 甩出去：惯性滑行
    this.vx = clamp(this.vx, -2600, 2600);
    this.vy = clamp(this.vy, -2000, 2000);
    this.setMode('idle', 0);
    this.spawn('dust', this.x, this.y);
  };

  Pet.prototype.setMode = function (mode, secs) {
    this.mode = mode;
    this.modeUntil = secs ? this.t + secs : 0;
    // 立刻刷新姿势与表情，交互后无需等下一帧才变形
    this.tickPose();
  };

  Pet.prototype.spawn = function (type, x, y, extra) {
    var life = 1.4, vy = -40, vx = rand(-18, 18);
    if (type === 'heart') { life = 1.6; vy = -60; }
    else if (type === 'star') { life = 1.5; vy = -50; }
    else if (type === 'note') { life = 1.8; vy = -46; vx = rand(-26, 26); }
    else if (type === 'fish') { life = 1.3; vy = 40; }
    else if (type === 'dust') { life = 0.7; vy = -10; }
    else if (type === 'spark') { life = 1.2; vy = -70; vx = rand(-70, 70); }
    else if (type === 'bubble') { life = 2.2; vy = -34; vx = rand(-10, 10); }
    else if (type === 'zzz') { life = 2.4; vy = -26; vx = rand(4, 16); }
    var p = { type: type, x: x, y: y, vx: vx, vy: vy, life: life, max: life, size: 1, rot: 0 };
    if (extra) for (var k in extra) p[k] = extra[k];
    this.particles.push(p);
    if (this.particles.length > 240) this.particles.splice(0, this.particles.length - 240);
    return p;
  };

  /* ------------------------------ 每帧更新 ------------------------------ */

  Pet.prototype.update = function (dt) {
    dt = clamp(dt || 0.016, 0, 0.05);
    this.t += dt;
    if (this._patCooldown > 0) this._patCooldown -= dt;
    this.phase += dt;
    this.tailPhase += dt * (this.mode === 'drag' ? 6 : 2.0);

    this.tickAuto(dt);
    this.tickNeeds(dt);
    this.tickMode(dt);
    this.tickPhysics(dt);
    this.tickBlink(dt);
    this.tickLook();
    this.tickParticles(dt);
    this.tickPose();

    if (this.tapAnim > 0) this.tapAnim = Math.max(0, this.tapAnim - dt * 3.4);
    if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 4);
    if (this.speech && this.t > this.speech.until) this.speech = null;
  };

  Pet.prototype.tickAuto = function (dt) {
    this._decideT -= dt;
    if (this._decideT > 0) return;
    this._decideT = rand(3, 7);
    if (this.mode === 'drag' || this.mode === 'sleep') return;
    if (this.mood < 26 && Math.random() < 0.4) { this.say('哼…不太想理你', 2.4); return; }
    if (this.hunger < 22 && Math.random() < 0.5) { this.say(this.randomLine('hungry'), 3); return; }
    if (this.energy < 16 && Math.random() < 0.6) { this.toggleSleep(true); return; }
    if (Math.random() < 0.4 && this.speech === null) this.say(this.randomLine('idle'), 2.6);
  };

  Pet.prototype.tickNeeds = function (dt) {
    var m = dt / 60;                       // 分钟
    var sleeping = this.mode === 'sleep';
    this.hunger = clamp(this.hunger - m * (sleeping ? 1.1 : 2.2), 0, 100);
    if (sleeping) this.energy = clamp(this.energy + m * 12, 0, 100);
    else this.energy = clamp(this.energy - m * (this.ambient === 'working' ? 2.6 : 1.4), 0, 100);

    var target = 42 + this.hunger * 0.34 + this.energy * 0.22 + Math.min(18, this.level * 1.2);
    this.mood = clamp(this.mood + (target - this.mood) * clamp(m * 0.5, 0, 1), 0, 100);
  };

  Pet.prototype.tickMode = function (dt) {
    // 工作/思考等由宿主信号驱动，除非被互动姿势占用
    var interactive = this.mode === 'happy' || this.mode === 'eat' || this.mode === 'levelup' ||
      this.mode === 'play' || this.mode === 'walk';
    if (interactive && this.modeUntil && this.t > this.modeUntil) this.setMode('idle', 0);
    if (this.mode === 'drag') return;
    if (interactive) return;
    if (this.mode === 'sleep' && this.ambient === 'idle') return;   // 睡觉时不被 idle 打扰

    // 宿主给了明确忙闲信号 → 立刻切（钉住只用来防止信号抖动导致切走）
    if (this.ambient !== 'idle') {
      var wanted = AMBIENT[this.ambient] || 'idle';
      if (this.mode !== wanted) this.setMode(wanted, 0);
      return;
    }
    // 宿主空闲：钉住期内保持工作姿势，避免工具间隙抽搐
    if (this.pinUntil > this.t) return;
    if (this.mode === 'work' || this.mode === 'think' || this.mode === 'approve' || this.mode === 'sad') {
      this.setMode('idle', 0);
    }
  };

  Pet.prototype.tickPhysics = function (dt) {
    var floor = this.floorY();
    if (this.dragging) return;

    if (this.mode === 'drag') this.setMode('idle', 0);

    // 散步：朝目标点走，到了就停（拖着 / 睡着时不走）
    if (this.walkTarget != null && this.mode !== 'sleep') {
      var wdx = this.walkTarget - this.x;
      if (Math.abs(wdx) <= 2) {
        this.walkTarget = null;
        if (this.mode === 'walk') this.setMode('idle', 0);
      } else {
        var step = Math.min(Math.abs(wdx), this.walkSpeed * dt);
        this.facing = wdx > 0 ? 1 : -1;
        this.x += (wdx > 0 ? 1 : -1) * step;
        var wrange = this.xRange();
        this.x = clamp(this.x, wrange.min, wrange.max);
        if (this.mode !== 'walk') this.setMode('walk', 0);
      }
    }

    // 跟随鼠标（工作态不追，避免打扰）
    if (this.followCursor && this.cursor.active && this.mode !== 'sleep' && this.mode !== 'work') {
      var dx = this.cursor.x - (this.x + this.facing * 6 * this.unit());
      var dead = 70 + this.unit() * 3;
      if (Math.abs(dx) > dead + 24) this.facing = dx > 0 ? 1 : -1;
    }

    // 惯性 + 重力
    var inAir = this.y < floor - 0.5;
    if (inAir || Math.abs(this.vx) > 4) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vy += 2100 * dt;
      this.vx *= Math.pow(0.12, dt);        // 空气阻力
      // 撞边抓停（按半身宽留位置，别让她被窗口裁掉）
      var range = this.xRange();
      if (this.x < range.min) { this.x = range.min; this.vx = Math.abs(this.vx) * 0.25; this.edgeHang = true; }
      if (this.x > range.max) { this.x = range.max; this.vx = -Math.abs(this.vx) * 0.25; this.edgeHang = true; }
      if (this.y >= floor) {
        if (this.vy > 420) { this.squash = 1; this.spawn('dust', this.x, floor); this.events.push({ type: 'land' }); }
        this.y = floor; this.vy = 0;
        if (Math.abs(this.vx) < 8) this.vx = 0;
      }
    } else {
      this.y = floor;
    }
    var bounds = this.xRange();
    this.x = clamp(this.x, bounds.min, bounds.max);
  };

  Pet.prototype.tickBlink = function (dt) {
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blinking = !this.blinking;
      this.blinkT = this.blinking ? 0.12 : rand(2.4, 6.5);
    }
  };

  Pet.prototype.tickLook = function () {
    if (!this.cursor.active) { this.lookX = lerp(this.lookX, 0, 0.1); this.lookY = lerp(this.lookY, 0, 0.1); return; }
    var u = this.unit();
    var headX = this.x + this.facing * 1.5 * u;
    var headY = this.y - 18 * u;
    var dx = this.cursor.x - headX;
    var dy = this.cursor.y - headY;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    this.lookX = clamp((dx / d) * this.facing * 1.3, -1, 1);
    this.lookY = clamp(-(dy / d) * 1.2, -1, 1);
  };

  Pet.prototype.tickParticles = function (dt) {
    for (var i = this.particles.length - 1; i >= 0; i--) {
      var p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === 'bubble' || p.type === 'zzz') p.x += Math.sin(this.t * 3 + i) * 8 * dt;
      if (p.type === 'spark' || p.type === 'dust') p.vy += 60 * dt;
      else p.vy *= Math.pow(0.5, dt);
    }
    // 待机偶尔吐泡泡
    if (this.mode === 'idle' && Math.random() < dt * 0.35) {
      this.spawn('bubble', this.x + rand(-10, 10), this.y - rand(90, 130));
    }
  };

  Pet.prototype.tickPose = function () {
    var pose = 'idle';
    switch (this.mode) {
      case 'work': pose = 'work'; break;
      case 'think': pose = 'think'; break;
      case 'approve': pose = 'approve'; break;
      case 'sad': pose = 'sad'; break;
      case 'happy': pose = 'happy'; break;
      case 'eat': pose = 'eat'; break;
      case 'sleep': pose = 'sleep'; break;
      case 'drag': pose = 'drag'; break;
      case 'levelup': pose = 'levelup'; break;
      case 'play': pose = 'play'; break;
      case 'walk': pose = 'walk'; break;
      default: pose = 'idle';
    }
    this.pose = pose;
    this.chew = (pose === 'eat') && (Math.sin(this.t * 12) > 0);
    if (pose === 'eat') this.snack = true;
    var expr = 'normal';
    if (pose === 'sleep') expr = 'sleep';
    else if (pose === 'drag') expr = 'wide';
    else if (pose === 'happy') expr = 'closed';
    else if (pose === 'levelup') expr = 'heart';
    else if (pose === 'sad') expr = 'half';
    else if (this.energy < 22) expr = 'half';
    if (this.blinking && expr === 'normal') expr = 'closed';
    this.expr = expr;
  };

  /* ------------------------------ 渲染 ------------------------------ */

  Pet.prototype.render = function (ctx) {
    var u = this.unit();
    var floor = this.floorY();

    // 影子（宽度跟着美术层走：插画立绘比像素版宽）
    var airT = clamp((floor - this.y) / 240, 0, 1);
    var halfW = 13 * u;
    if (this.art && typeof this.art.box === 'function') {
      try {
        var bx = this.art.box(this);
        if (bx && bx.w) halfW = bx.w * 0.34;
      } catch (e) { /* 用默认宽度 */ }
    }
    if (airT < 0.98) {
      ctx.save();
      ctx.globalAlpha = 0.20 * (1 - airT);
      ctx.fillStyle = '#0b1a2a';
      ctx.beginPath();
      var sw = halfW * (1 - airT * 0.35);
      ctx.ellipse(this.x, floor + 2, sw, Math.max(3, 2.4 * u * (1 - airT * 0.35)), 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // 角色：优先交给美术层（插画立绘）；没画成就回退内置像素渲染器
    var drawn = false;
    if (this.art && typeof this.art.draw === 'function') {
      try { drawn = this.art.draw(ctx, this) === true; } catch (e) { drawn = false; }
    }
    if (!drawn) this.renderPixel(ctx);

    this.renderParticles(ctx);
    return this;
  };

  /** 内置像素渲染器：默认画风，也是立绘未就绪/加载失败时的回退 */
  Pet.prototype.renderPixel = function (ctx) {
    var u = this.unit();
    var pen = this._pen;
    if (!pen || pen.cell !== u) { pen = this._pen = new PixelPen(u); }
    pen.clear();
    pen.flip = this.facing < 0;
    pen.sy = this.squash > 0 ? (1 - this.squash * 0.22) : 1;
    pen.sx = this.squash > 0 ? (1 + this.squash * 0.16) : 1;

    drawWhale(pen, {
      skin: this.skin,
      pose: this.pose,
      t: this.t,
      phase: this.phase,
      tailPhase: this.tailPhase,
      lookX: this.lookX,
      lookY: this.lookY,
      expr: this.expr,
      chew: this.chew,
      laptop: this.pose === 'work',
      snack: this.snack,
      alert: this.pose === 'approve',
      spout: this.pose !== 'sleep',
      finFlap: Math.sin(this.t * 2.2) * 0.5,
      tapAnim: this.tapAnim
    });
    pen.flushAt(ctx, Math.round(this.x), Math.round(this.y));
    return this;
  };

  Pet.prototype.renderParticles = function (ctx) {
    var pal = {
      heart: '#ff7aa2', star: '#ffd166', note: '#8fd3ff',
      fish: '#f0b46a', dust: '#c9d6e4', spark: '#fff3b0',
      bubble: '#a9e4ff', zzz: '#cfe0ff'
    };
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      var a = clamp(p.life / p.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      var s = 2;
      if (p.type === 'bubble') {
        ctx.strokeStyle = pal.bubble;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.4 + (1 - a) * 2.2, 0, TAU);
        ctx.stroke();
      } else if (p.type === 'zzz') {
        drawBitmapCtx(ctx, BIT.zzz, p.x, p.y, 2.5, pal.zzz);
      } else {
        var bm = BIT[p.type] || BIT.star;
        drawBitmapCtx(ctx, bm, p.x, p.y, s, pal[p.type] || '#ffffff');
      }
      ctx.restore();
    }
  };

  function drawBitmapCtx(ctx, rows, cx, cy, scale, color) {
    ctx.fillStyle = color;
    var w = rows[0].length * scale;
    var h = rows.length * scale;
    var x0 = cx - w / 2;
    var y0 = cy - h / 2;
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        if (rows[r][c] === '.') continue;
        ctx.fillRect(x0 + c * scale, y0 + r * scale, scale, scale);
      }
    }
  }

  /* ------------------------------ 存档 ------------------------------ */

  Pet.prototype.serialize = function () {
    return {
      v: 1,
      name: this.name,
      skin: this.skin,
      level: this.level,
      exp: Math.round(this.exp * 100) / 100,
      mood: Math.round(this.mood),
      hunger: Math.round(this.hunger),
      energy: Math.round(this.energy),
      bond: Math.round(this.bond),
      tokens: Math.round(this.tokens),
      totalPat: this.totalPat,
      totalFeed: this.totalFeed,
      streak: this.streak,
      unlocks: this.unlocks,
      x: Math.round(this.x),
      y: Math.round(this.y),
      facing: this.facing,
      lastSeen: Date.now()
    };
  };

  Pet.prototype.load = function (data) {
    if (!data || typeof data !== 'object') return this;
    var keys = ['name', 'skin', 'level', 'exp', 'mood', 'hunger', 'energy', 'bond', 'tokens', 'totalPat', 'totalFeed', 'streak', 'unlocks'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (data[k] != null) this[k] = data[k];
    }
    if (typeof data.x === 'number') {
      var r = this.xRange();
      this.x = clamp(data.x, r.min, r.max);
    }
    if (typeof data.y === 'number') this.y = clamp(data.y, 40, this.floorY());
    if (data.facing) this.facing = data.facing > 0 ? 1 : -1;
    if (data.lastSeen) this.applyOffline((Date.now() - data.lastSeen) / 1000);
    return this;
  };

  /** 离线期间的变化：睡觉回精力、饿一点、心情缓降 */
  Pet.prototype.applyOffline = function (seconds) {
    var sec = clamp(seconds || 0, 0, 12 * 3600);
    var m = sec / 60;
    this.hunger = clamp(this.hunger - m * 1.6, 0, 100);
    this.energy = clamp(this.energy + m * 5, 0, 100);
    this.mood = clamp(this.mood - m * 0.8, 0, 100);
    this.offlineSeconds = sec;
    this.lastSeen = Date.now();
    return sec;
  };

  Pet.prototype.offlineGreeting = function () {
    var sec = this.offlineSeconds || 0;
    if (sec < 90) return null;
    if (sec > 8 * 3600) return '你去哪了…我等了好久好久';
    if (sec > 1800) return this.randomLine('back');
    return null;
  };

  /* ======================================================================
   * 6. 音效（可选，浏览器 WebAudio，无外部资源）
   * ==================================================================== */

  function AudioKit() {
    this.enabled = false;
    this.ctx = null;
  }

  AudioKit.prototype.ensure = function () {
    if (typeof window === 'undefined') return null;
    if (this.ctx) return this.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { this.ctx = new AC(); } catch (e) { this.ctx = null; }
    return this.ctx;
  };

  AudioKit.prototype.blip = function (freq, dur, type, gain) {
    if (!this.enabled) return;
    var ac = this.ensure();
    if (!ac) return;
    if (ac.state === 'suspended' && ac.resume) ac.resume();
    var o = ac.createOscillator();
    var g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.value = 0;
    o.connect(g); g.connect(ac.destination);
    var t0 = ac.currentTime;
    g.gain.linearRampToValueAtTime(gain == null ? 0.05 : gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  };

  AudioKit.prototype.pat = function () { this.blip(880, 0.16, 'sine', 0.045); this.blip(1320, 0.12, 'sine', 0.025); };
  AudioKit.prototype.feed = function () { this.blip(420, 0.09, 'square', 0.03); var s = this; setTimeout(function () { s.blip(380, 0.09, 'square', 0.03); }, 110); };
  AudioKit.prototype.approve = function () { this.blip(660, 0.18, 'triangle', 0.05); };
  AudioKit.prototype.levelup = function () {
    var s = this, notes = [523, 659, 784, 1046];
    notes.forEach(function (f, i) { setTimeout(function () { s.blip(f, 0.22, 'sine', 0.05); }, i * 95); });
  };
  AudioKit.prototype.land = function () { this.blip(160, 0.1, 'sine', 0.04); };

  /* ======================================================================
   * 导出
   * ==================================================================== */

  return {
    VERSION: VERSION,
    PixelPen: PixelPen,
    Pet: Pet,
    AudioKit: AudioKit,
    SKINS: SKINS,
    SKIN_ORDER: SKIN_ORDER,
    FOODS: FOODS,
    DEFAULT_FOOD: DEFAULT_FOOD,
    favoriteFoodFor: favoriteFoodFor,
    dislikedFoodFor: dislikedFoodFor,
    LINES: LINES,
    BIT: BIT,
    drawWhale: drawWhale,
    utils: { clamp: clamp, lerp: lerp, rand: rand, randInt: randInt, pick: pick, nowMs: nowMs, TAU: TAU }
  };
});
