/**
 * 鲸鱼娘 · 立绘包（sprite pack）机制
 * ---------------------------------------------------------------------------
 * 目标：让别人能换一整套立绘，而不是只能"立绘 / 像素"二选一。
 *
 * 一个包 = 一个目录 + 一份 manifest.json：
 *
 *   assets/art/packs/<包名>/manifest.json
 *   {
 *     "name": "霜蓝 · 冬装",            // 显示用
 *     "author": "someone",              // 可选，署名
 *     "poses": { "idle": "idle.png", "work": "work.png", ... },
 *     "hints": { "star": "star.png" },  // 可选，表情覆盖
 *     "scale": 1                        // 可选，整体缩放（默认 1）
 *   }
 *
 * 设计要点：
 *   · **包里缺的姿势自动回落到内置立绘**——不需要一次画全 92 张。
 *   · 不碰美术层的内部映射表，用包装（wrap）的方式叠加，改坏了也不会影响默认画风。
 *   · 全是纯函数，manifest 校验能用单测钉死，脏数据只会让那个包失效、不会让桌宠白屏。
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  'use strict';
  var API = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = API;
  if (typeof root === 'object' && root) root.WhalePetPacks = API;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var POSES = ['idle', 'work', 'think', 'approve', 'happy', 'eat', 'play', 'walk',
    'drag', 'sleep', 'sad', 'levelup', 'groom'];
  var HINTS = ['greet', 'star', 'praise', 'blush', 'celebrate', 'night', 'afk',
    'deadline', 'curious', 'eat', 'foodPudding', 'foodCake', 'foodDrink', 'foodSalad',
    'gameWin', 'festivalNewYear', 'festivalSpring', 'festivalMidAutumn',
    'festivalHalloween', 'festivalChristmas', 'valentine', 'pajama', 'dailyCoffee', 'dailyStretch'];

  function isSafeFile(name) {
    return typeof name === 'string' && name.length > 0 && name.length < 200 &&
      !/[\\/]/.test(name) && name.indexOf('..') === -1;   // 只允许包内文件名
  }

  /**
   * 校验一份 manifest。返回 { ok, errors[], pack }。
   * 只做"会不会出事"的判断，不强制你必须画全。
   */
  function validate(manifest) {
    var errors = [];
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return { ok: false, errors: ['manifest 必须是对象'], pack: null };
    }
    var name = typeof manifest.name === 'string' ? manifest.name.trim() : '';
    if (!name) errors.push('缺少 name');

    var poses = {};
    var hints = {};
    var unknown = [];

    var rawPoses = manifest.poses;
    if (rawPoses === undefined) {
      errors.push('至少要在 poses 里给一张 idle');
    } else if (!rawPoses || typeof rawPoses !== 'object' || Array.isArray(rawPoses)) {
      errors.push('poses 必须是对象');
    } else {
      for (var k in rawPoses) {
        if (!isSafeFile(rawPoses[k])) { errors.push('poses.' + k + ' 的文件名不合法（只能是包内文件名）'); continue; }
        if (POSES.indexOf(k) === -1) unknown.push('poses.' + k);
        poses[k] = rawPoses[k];
      }
    }
    if (!poses.idle) errors.push('poses.idle 是必需的（其他姿势可以缺，会自动回落）');

    var rawHints = manifest.hints;
    if (rawHints && typeof rawHints === 'object' && !Array.isArray(rawHints)) {
      for (var h in rawHints) {
        if (!isSafeFile(rawHints[h])) { errors.push('hints.' + h + ' 的文件名不合法'); continue; }
        if (HINTS.indexOf(h) === -1) unknown.push('hints.' + h);
        hints[h] = rawHints[h];
      }
    } else if (rawHints !== undefined) {
      errors.push('hints 必须是对象');
    }

    var scale = typeof manifest.scale === 'number' && manifest.scale > 0 && manifest.scale <= 4
      ? manifest.scale : 1;

    return {
      ok: errors.length === 0,
      errors: errors,
      unknown: unknown,        // 不认识的姿势名：不报错，只是永远用不到
      pack: errors.length === 0 ? {
        name: name,
        author: typeof manifest.author === 'string' ? manifest.author : '',
        poses: poses,
        hints: hints,
        scale: scale,
      } : null,
    };
  }

  /** 从宠物状态推出该用哪个 key（和内置美术层的选择顺序保持一致：表情 > 摸头分区 > 姿势） */
  function poseKeyFor(pet) {
    if (!pet) return { pose: 'idle' };   // 必须是对象：wrapArt 要按 key 查表
    if (pet.artHint && (!pet.artHintUntil || pet.artHintUntil > pet.t)) return { hint: pet.artHint };
    if (pet.mode === 'happy' && pet.lastZone) return { zone: pet.lastZone };
    if (pet.pose) return { pose: pet.pose };
    if (pet.mode) return { pose: pet.mode };
    return { pose: 'idle' };
  }

  /**
   * 把包叠加到一个已经创建好的美术层上（不修改它的内部映射）。
   * 包里没有的 key 一律回落到原实现，所以"画一半"也能用。
   */
  function wrapArt(art, pack, opts) {
    if (!art || !pack) return art;
    opts = opts || {};
    var original = typeof art.fileFor === 'function' ? art.fileFor.bind(art) : null;
    if (art.base !== undefined && opts.base !== false) art.base = pack.base !== undefined ? pack.base : art.base;

    art.packName = pack.name;
    art.fileFor = function (pet) {
      var key = poseKeyFor(pet);
      var file = null;
      if (key.hint && pack.hints[key.hint]) file = pack.hints[key.hint];
      else if (key.zone && pack.poses.happy) file = pack.poses.happy;   // 分区反应也归到 happy
      else if (key.pose && pack.poses[key.pose]) file = pack.poses[key.pose];
      if (file) return file;
      return original ? original(pet) : null;
    };
    return art;
  }

  return {
    POSES: POSES,
    HINTS: HINTS,
    validate: validate,
    poseKeyFor: poseKeyFor,
    wrapArt: wrapArt,
    isSafeFile: isSafeFile,
  };
});
