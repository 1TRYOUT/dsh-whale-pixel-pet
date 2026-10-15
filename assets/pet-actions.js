/**
 * 鲸鱼娘 · 共用动作层
 * ---------------------------------------------------------------------------
 * 为什么单独抽一层：桌宠有两种宿主（DSH 窗口内的悬浮层、独立桌面窗口），
 * 早先两边各写一份交互，结果桌面版"功能不对等"。现在**动作语义只有这一份实现**，
 * 两边都调这里，谁也不会掉队。
 *
 * 用法：
 *   WhalePetActions.run('feed', { pet: pet, audio: audio })   // → { ok, id, msg }
 *   WhalePetActions.PANEL_ACTIONS / MENU_ACTIONS              // 界面按这个清单渲染
 * ---------------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  /** 需要"一只宠物 + 音效"就能成立的动作；界面按这个清单排按钮和菜单 */
  var ACTIONS = [
    { id: 'pat', label: '摸摸头', hint: '三区不同反应', icon: '✋' },
    { id: 'feed', label: '投喂', hint: '可选不同食物，效果各不同', icon: '🍤' },
    { id: 'praise', label: '夸夸她', hint: '心情 +22，亲密 +3', icon: '✨' },
    { id: 'play', label: '玩一下', hint: '心情大涨，精力掉一点', icon: '🎮' },
    { id: 'walk', label: '散步', hint: '桌面版是整个窗口走出去', icon: '🚶' },
    { id: 'sleep', label: '睡吧 / 叫醒', hint: '让她去睡，或把她叫醒', icon: '💤' }
  ];

  /** 面板/菜单里要用到的动作 id 顺序 */
  var MENU_ACTIONS = ACTIONS.map(function (a) { return a.id; });

  function actionMeta(id) {
    for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].id === id) return ACTIONS[i];
    return null;
  }

  /** 食物清单（真相在引擎的 FOODS，这里只取出来给界面用） */
  function foods() {
    var W = root.WhalePet;
    return (W && Array.isArray(W.FOODS)) ? W.FOODS : [];
  }

  function foodById(id) {
    var list = foods();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /** 没指定落点时，往远处随机挑一个（窗口版散步用） */
  function pickWalkTarget(pet) {
    var range = pet.xRange ? pet.xRange() : { min: 40, max: 400 };
    var span = range.max - range.min;
    var goRight = pet.x < (range.min + range.max) / 2;
    var target = goRight ? range.max - span * 0.08 : range.min + span * 0.08;
    if (Math.abs(target - pet.x) < 60) target = goRight ? range.min + span * 0.1 : range.max - span * 0.1;
    return target;
  }

  /**
   * 执行一个动作。
   * @param {string} id   动作 id
   * @param {object} ctx  { pet, audio, walkTo? }
   * @param {object} arg  可选：{ food: id | 食物对象 }、{ spot: x }
   * @returns {{ok:boolean, id:string, msg?:string, food?:object, spot?:number}}
   */
  function run(id, ctx, arg) {
    var pet = ctx && ctx.pet;
    var audio = ctx && ctx.audio;
    if (!pet) return { ok: false, id: id, msg: '没有宠物实例' };
    if (audio && audio.enabled === false) audio = null;   // 静音时不触发音效
    arg = arg || {};

    switch (id) {
      case 'pat': {
        pet._patCooldown = 0;                 // 手动摸摸不受冷却限制
        pet.pat('head');
        if (audio && audio.pat) audio.pat();
        return { ok: true, id: id, msg: pet.speech ? pet.speech.text : '' };
      }
      case 'feed': {
        var food = (arg.food && typeof arg.food === 'object') ? arg.food : foodById(arg.food);
        var used = pet.feed(food || undefined);        // 不指定就喂默认那一种
        if (audio && audio.feed) audio.feed();
        return { ok: true, id: id, food: used, msg: pet.speech ? pet.speech.text : '' };
      }
      case 'praise': {
        pet.praise();
        if (audio && audio.levelup) audio.levelup();
        return { ok: true, id: id, msg: pet.speech ? pet.speech.text : '' };
      }
      case 'play': {
        var res = pet.play ? pet.play() : null;
        var ok = !res || res.ok !== false;
        if (ok && audio && audio.levelup) audio.levelup();
        return { ok: ok, id: id, reason: res && res.reason, msg: pet.speech ? pet.speech.text : '' };
      }
      case 'walk': {
        // 桌面版把"走出去"交给宿主（整个窗口移动）；窗口版就在页面里溜达
        var spot = typeof arg.spot === 'number' ? arg.spot : null;
        if (typeof ctx.walkTo === 'function') {
          var handled = ctx.walkTo(spot);
          return { ok: handled !== false, id: id, spot: spot, external: true, msg: pet.speech ? pet.speech.text : '' };
        }
        if (!pet.walkTo) return { ok: false, id: id, msg: '这个版本还不支持散步' };
        var target = spot != null ? spot : pickWalkTarget(pet);
        pet.walkTo(target);
        return { ok: true, id: id, spot: target, msg: pet.speech ? pet.speech.text : '' };
      }
      case 'sleep': {
        var sleeping = pet.toggleSleep();
        return { ok: true, id: id, msg: sleeping ? '（睡下了）' : '（醒了）' };
      }
      default:
        return { ok: false, id: id, msg: '未知动作：' + id };
    }
  }

  /** 换配色（引擎里 SKINS 的 key） */
  function setSkin(pet, id) {
    if (!pet || !id) return false;
    if (root.WhalePet && root.WhalePet.SKINS && !root.WhalePet.SKINS[id]) return false;
    pet.skin = id;
    return true;
  }

  /** 改名 */
  function setName(pet, name, fallback) {
    if (!pet) return false;
    var next = String(name == null ? '' : name).trim();
    pet.name = next || fallback || pet.name;
    return true;
  }

  /**
   * 重置养成：把一只全新的她放回原位，外观/名字/偏好保留。
   * 注意：这里不碰存档（调用方自己清 storage），只负责"人"的部分。
   */
  function resetPet(pet, opts) {
    opts = opts || {};
    var W = root.WhalePet;
    if (!W || !W.Pet) return null;
    var fresh = new W.Pet({ w: pet.view.w, h: pet.view.h });
    fresh.skin = opts.skin || pet.skin;
    fresh.name = opts.name || pet.name;
    fresh.followCursor = !!opts.followCursor;
    if (pet.art && fresh.setArt) fresh.setArt(pet.art);   // 沿用同一个美术层
    return fresh;
  }

  /** 状态快照：两种宿主的"近况"卡片共用同一套字段，避免又对不齐 */
  function stats(pet) {
    if (!pet) return null;
    return {
      name: pet.name,
      level: pet.level,
      exp: Math.round(pet.exp),
      expNeed: pet.expNeed ? pet.expNeed() : 0,
      tokens: Math.round(pet.tokens),
      mood: Math.round(pet.mood),
      hunger: Math.round(pet.hunger),
      energy: Math.round(pet.energy),
      bond: Math.round(pet.bond),
      fedCount: pet.totalFeed || 0,       // 引擎里的字段叫 totalFeed
      patCount: pet.totalPat || 0,        // ……这个叫 totalPat，别写错，否则面板永远显示 0
      pose: pet.pose,
      ambient: pet.ambient,
      skin: pet.skin,
      lastFood: pet.lastFood || null,
      walking: pet.walkTarget != null,
      // 口味是"发现式"的：喂到过最爱才会在这显示出来（没喂到就一直藏着）
      favorite: (pet.favoriteKnown && root.WhalePet && root.WhalePet.favoriteFoodFor)
        ? (root.WhalePet.favoriteFoodFor(pet.name) || {}).label || null
        : null,
      foodTries: pet.foodTries || {},
      sleeping: pet.mode === 'sleep' || (pet.sleeping === true)
    };
  }

  var api = {
    ACTIONS: ACTIONS,
    MENU_ACTIONS: MENU_ACTIONS,
    actionMeta: actionMeta,
    foods: foods,
    foodById: foodById,
    pickWalkTarget: pickWalkTarget,
    run: run,
    setSkin: setSkin,
    setName: setName,
    resetPet: resetPet,
    stats: stats
  };

  root.WhalePetActions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
