/**
 * 共用动作层单测
 * 运行：node --test test/actions.test.mjs
 *
 * 这一层是"窗口版 / 桌面版"的共同实现，所以它的语义必须被钉死：
 * 谁改了投喂加多少饱食、谁把摸摸头写成别的区，这里就会红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await import('../assets/whale-pet.js');
await import('../assets/pet-actions.js');
const W = globalThis.WhalePet;
const A = globalThis.WhalePetActions;

/** 假音效：只记录被调了哪些 */
function stubAudio() {
  const calls = [];
  return {
    calls,
    enabled: true,
    pat() { calls.push('pat'); },
    feed() { calls.push('feed'); },
    levelup() { calls.push('levelup'); },
  };
}

function newPet() {
  const pet = new W.Pet({ w: 900, h: 600 });
  pet.x = 450;
  pet.y = pet.floorY();
  return pet;
}

/* ============================ 清单 ============================ */

test('动作层：清单齐备且 id 唯一', () => {
  assert.ok(Array.isArray(A.ACTIONS) && A.ACTIONS.length >= 6);
  const ids = A.ACTIONS.map((a) => a.id);
  assert.deepEqual(ids, ['pat', 'feed', 'praise', 'play', 'walk', 'sleep']);
  assert.equal(new Set(ids).size, ids.length, 'id 不能重复');
  for (const a of A.ACTIONS) {
    assert.ok(a.label && a.label.length > 0, a.id + ' 要有中文名');
    assert.ok(A.actionMeta(a.id), 'actionMeta 要能查到 ' + a.id);
  }
  assert.equal(A.actionMeta('不存在的动作'), null);
  assert.deepEqual(A.MENU_ACTIONS, ids);
});

/* ============================ 玩一下 / 散步 / 食物 ============================ */

test('动作层：玩一下 → 心情涨、精力掉，姿势变游戏', () => {
  const pet = newPet();
  const audio = stubAudio();
  pet.mood = 40; pet.energy = 90;
  const r = A.run('play', { pet, audio });
  assert.equal(r.ok, true);
  assert.ok(pet.mood > 40, '心情要涨，实际 ' + pet.mood);
  assert.ok(pet.energy < 90, '精力要掉，实际 ' + pet.energy);
  assert.equal(pet.mode, 'play');
  pet.update(1 / 60);
  assert.equal(pet.pose, 'play', '姿势应该是 play，实际 ' + pet.pose);
});

test('动作层：累到没精力时会拒绝玩，而不是硬撑', () => {
  const pet = newPet();
  pet.energy = 5;
  const r = A.run('play', { pet, audio: stubAudio() });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'tired');
  assert.ok(r.msg && r.msg.length > 0, '也要有台词');
  assert.equal(pet.energy, 5, '累的时候不该再扣精力');
});

test('动作层：散步会走起来，并在到达后停下', () => {
  const pet = newPet();
  const r = A.run('walk', { pet, audio: stubAudio() }, { spot: 200 });
  assert.equal(r.ok, true);
  assert.equal(r.spot, 200);
  assert.equal(pet.mode, 'walk');
  assert.equal(pet.walkTarget, 200);
  pet.update(1 / 60);
  assert.equal(pet.pose, 'walk', '走路时姿势应该是 walk');

  const startX = pet.x;
  for (let i = 0; i < 300; i++) pet.update(1 / 60);      // 5 秒足够走到
  assert.ok(Math.abs(pet.x - 200) < 8, '应该走到目标附近，实际 ' + Math.round(pet.x));
  assert.ok(Math.abs(pet.x - startX) > 20, '确实动了');
  assert.ok(pet.walkTarget == null, '到了要清掉目标');
  assert.equal(pet.mode, 'idle', '到了要回到待机');
});

test('动作层：桌面版把散步交给宿主（窗口移动），不自己走', () => {
  const pet = newPet();
  let asked = null;
  const r = A.run('walk', { pet, audio: stubAudio(), walkTo: (spot) => { asked = spot; return true; } }, { spot: 700 });
  assert.equal(r.ok, true);
  assert.equal(r.external, true, '要标明是宿主处理的');
  assert.equal(asked, 700, '宿主应当收到落点');
  assert.ok(pet.walkTarget == null, '桌面版不该同时让画布里的她也走（实际 ' + pet.walkTarget + '）');
});

test('动作层：散步不给落点时会自己挑一个远处目标', () => {
  const pet = newPet();
  pet.x = pet.xRange().min + 10;
  const r = A.run('walk', { pet, audio: stubAudio() });
  assert.equal(r.ok, true);
  assert.ok(r.spot > pet.xRange().min + 100, '应该往远处走，实际 ' + Math.round(r.spot));
});

test('动作层：可以喂不同的食物，效果各不相同', () => {
  const list = A.foods();
  assert.ok(list.length >= 4, '食物应该有好几种，实际 ' + list.length);

  const pet = newPet();
  pet.energy = 30;
  const r = A.run('feed', { pet, audio: stubAudio() }, { food: 'milktea' });
  assert.equal(r.ok, true);
  assert.equal(r.food.id, 'milktea');
  assert.equal(pet.lastFood, 'milktea', '引擎要记住喂的是哪种');
  assert.ok(pet.energy > 30, '奶茶应该回精力，实际 ' + pet.energy);

  const pet2 = newPet();
  pet2.hunger = 10;
  const r2 = A.run('feed', { pet: pet2, audio: stubAudio() }, { food: A.foodById('salad') });
  assert.equal(r2.food.id, 'salad');
  assert.ok(pet2.hunger > 30, '沙拉更顶饱，实际 ' + pet2.hunger);
});

test('动作层：食物表本身要合法（id 唯一、数值齐全、有台词）', () => {
  const list = A.foods();
  const ids = list.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, '食物 id 不能重复');
  for (const f of list) {
    assert.ok(f.id && f.label, '每种食物都要有 id 和名字');
    assert.equal(typeof f.hunger, 'number', f.id + ' 缺 hunger');
    assert.equal(typeof f.mood, 'number', f.id + ' 缺 mood');
    assert.ok(f.line && f.line.length > 0, f.id + ' 要有自己的台词');
    assert.ok(A.foodById(f.id), 'foodById 要查得到 ' + f.id);
  }
  assert.equal(A.foodById('不存在的食物'), null);
});

test('动作层：喂不存在的食物会回落到默认那一种，不会报错', () => {
  const pet = newPet();
  const r = A.run('feed', { pet, audio: stubAudio() }, { food: '不存在的食物' });
  assert.equal(r.ok, true);
  assert.ok(r.food && r.food.id, '应该回落到默认食物');
  assert.equal(pet.totalFeed, 1);
});

test('动作层：新姿势对应的立绘文件真的存在（防"映射了不存在的图"）', () => {
  const dir = path.join(__dirname, '..', 'assets', 'art', 'musume');
  for (const file of [
    'dsh-whale-state-daily-gaming.webp',   // 玩一下
    'dsh-whale-state-running.webp',        // 散步
    'dsh-whale-state-daily-eat.webp',      // 布丁
    'dsh-whale-state-celebrate.webp',      // 蛋糕
    'dsh-whale-state-daily-coffee.webp',   // 奶茶
    'dsh-whale-state-daily-cooking.webp',  // 沙拉
    'dsh-whale-state-game-win.webp',
  ]) {
    assert.ok(existsSync(path.join(dir, file)), '缺少立绘：' + file);
  }
});

test('动作层：近况快照带上"刚喂了什么""是否在散步"', () => {
  const pet = newPet();
  A.run('feed', { pet, audio: stubAudio() }, { food: 'candy' });
  assert.equal(A.stats(pet).lastFood, 'candy');
  assert.equal(A.stats(pet).walking, false);
  A.run('walk', { pet, audio: stubAudio() }, { spot: 300 });
  assert.equal(A.stats(pet).walking, true);
});

/* ============================ 各动作语义 ============================ */

test('动作层：投喂 → 饱食/亲密上升、心声有内容、音效响一次', () => {
  const pet = newPet();
  const audio = stubAudio();
  pet.hunger = 40;
  const before = { hunger: pet.hunger, bond: pet.bond };
  const r = A.run('feed', { pet, audio });
  assert.equal(r.ok, true);
  assert.equal(r.id, 'feed');
  assert.ok(pet.hunger > before.hunger, '饱食要上升：' + before.hunger + ' → ' + pet.hunger);
  assert.ok(pet.bond >= before.bond, '亲密不该下降');
  assert.equal(audio.calls.filter((c) => c === 'feed').length, 1);
  assert.ok(r.msg && r.msg.length > 0, '要有台词');
});

test('动作层：夸夸 → 心情上升 + 音效', () => {
  const pet = newPet();
  const audio = stubAudio();
  pet.mood = 40;
  const r = A.run('praise', { pet, audio });
  assert.equal(r.ok, true);
  assert.ok(pet.mood > 40, '心情要上升，实际 ' + pet.mood);
  assert.equal(audio.calls.filter((c) => c === 'levelup').length, 1);
  assert.ok(r.msg && r.msg.length > 0);
});

test('动作层：摸摸头 → 进入开心状态、摸头计数 +1、不受冷却限制', () => {
  const pet = newPet();
  const audio = stubAudio();
  pet._patCooldown = 99;                 // 模拟"刚摸过"，手动摸摸必须无视它
  const before = pet.totalPat || 0;
  const r = A.run('pat', { pet, audio });
  assert.equal(r.ok, true);
  assert.equal(pet.mode, 'happy', '被摸应进入开心状态，实际 ' + pet.mode);
  assert.equal(pet.totalPat, before + 1, '引擎里的计数是 totalPat');
  assert.equal(pet.lastZone, 'head');
  assert.equal(audio.calls.filter((c) => c === 'pat').length, 1);
  // 姿势由下一帧的 tickPose 推出，这里确认它确实会变成 happy
  pet.update(1 / 60);
  assert.equal(pet.pose, 'happy', 'update 之后姿势应该是 happy，实际 ' + pet.pose);
});

test('动作层：睡吧是开关，能睡着也能叫醒', () => {
  const pet = newPet();
  const audio = stubAudio();
  const first = A.run('sleep', { pet, audio });
  assert.equal(first.ok, true);
  assert.equal(pet.mode, 'sleep', '第一次应该睡下');
  const second = A.run('sleep', { pet, audio });
  assert.equal(second.ok, true);
  assert.notEqual(pet.mode, 'sleep', '第二次应该叫醒');
});

test('动作层：静音时动作照做、音效不响', () => {
  const pet = newPet();
  const audio = stubAudio();
  audio.enabled = false;
  const r = A.run('feed', { pet, audio });
  assert.equal(r.ok, true);
  assert.ok(r.msg && r.msg.length > 0, '静音也要有反馈');
  assert.deepEqual(audio.calls, [], '静音时不该有任何音效调用');
});

test('动作层：未知动作 / 没有宠物 都不抛异常', () => {
  const pet = newPet();
  const bad = A.run('乱来', { pet, audio: stubAudio() });
  assert.equal(bad.ok, false);
  assert.match(bad.msg, /未知动作/);

  const noPet = A.run('feed', {});
  assert.equal(noPet.ok, false);
  assert.match(noPet.msg, /没有宠物/);

  assert.equal(A.run('feed', null).ok, false);
});

/* ============================ 外观 / 名字 / 重置 ============================ */

test('动作层：配色只认引擎里存在的 key', () => {
  const pet = newPet();
  assert.equal(A.setSkin(pet, 'coral'), true);
  assert.equal(pet.skin, 'coral');
  assert.equal(A.setSkin(pet, '不存在的配色'), false);
  assert.equal(pet.skin, 'coral', '非法配色不该改坏现状');
  assert.equal(A.setSkin(null, 'deep'), false);
});

test('动作层：改名会去空白，空名字回落到默认', () => {
  const pet = newPet();
  assert.equal(A.setName(pet, '  阿鲸  '), true);
  assert.equal(pet.name, '阿鲸');
  A.setName(pet, '   ', '小汐');
  assert.equal(pet.name, '小汐', '全空白应回落到默认名');
  A.setName(pet, '', '小汐');
  assert.equal(pet.name, '小汐');
});

test('动作层：重置养成 —— 等级归零但外观/名字保留', () => {
  const pet = newPet();
  pet.level = 7;
  pet.exp = 120;
  pet.bond = 88;
  pet.tokens = 50000;
  const fresh = A.resetPet(pet, { skin: 'moon', name: '阿鲸', followCursor: false });
  assert.ok(fresh, '要拿到一只新宠物');
  assert.equal(fresh.level, 1, '等级要归零');
  assert.equal(Math.round(fresh.exp), 0);
  assert.ok(fresh.tokens < 1, 'Token 计数也要清');
  assert.equal(fresh.skin, 'moon', '配色要保留');
  assert.equal(fresh.name, '阿鲸', '名字要保留');
  assert.equal(fresh.followCursor, false);
  assert.notEqual(fresh, pet, '应该是新对象');
});

test('动作层：口味由名字决定，且同一个名字永远一致', () => {
  const W = globalThis.WhalePet;
  assert.equal(typeof W.favoriteFoodFor, 'function', '引擎要导出口味函数');
  assert.equal(W.favoriteFoodFor('小汐').id, W.favoriteFoodFor('小汐').id, '同名同口味');
  assert.notEqual(W.favoriteFoodFor('小汐').id, W.favoriteFoodFor('阿鲸').id, '不同名字口味不同');
  // 不爱吃的不能和最爱是同一种
  for (const name of ['小汐', '阿鲸', '鲸鲸', 'A', '']) {
    assert.notEqual(W.favoriteFoodFor(name).id, W.dislikedFoodFor(name).id, name + ' 的最爱与不爱重复了');
  }
});

test('动作层：喂到最爱有额外加成，喂到不爱吃会有点小情绪', () => {
  const W = globalThis.WhalePet;
  const fav = W.favoriteFoodFor('小汐');
  const dis = W.dislikedFoodFor('小汐');
  const other = A.foods().find((f) => f.id !== fav.id && f.id !== dis.id);

  const pet = newPet();
  pet.name = '小汐';
  pet.mood = 50;
  const r = A.run('feed', { pet, audio: stubAudio() }, { food: fav.id });
  assert.equal(r.food.favorite, true, '要标出这是最爱');
  assert.ok(pet.mood >= 50 + fav.mood + 10 - 0.01, '最爱要额外加心情，实际 ' + pet.mood);
  assert.equal(pet.favoriteKnown, true, '喂到过就该"知道"她的口味了');

  const pet2 = newPet();
  pet2.name = '小汐';
  pet2.mood = 50;
  const r2 = A.run('feed', { pet: pet2, audio: stubAudio() }, { food: dis.id });
  assert.equal(r2.food.disliked, true);
  assert.ok(pet2.mood < 50, '不爱吃的要掉心情，实际 ' + pet2.mood);

  const pet3 = newPet();
  pet3.name = '小汐';
  pet3.mood = 50;
  const r3 = A.run('feed', { pet: pet3, audio: stubAudio() }, { food: other.id });
  assert.equal(r3.food.favorite, false);
  assert.equal(r3.food.disliked, false);
});

test('动作层：近况里的口味是"发现式"的（没喂到就不显示）', () => {
  const W = globalThis.WhalePet;
  const pet = newPet();
  pet.name = '小汐';
  assert.equal(A.stats(pet).favorite, null, '一开始不该剧透');
  const dis = W.dislikedFoodFor('小汐');
  A.run('feed', { pet, audio: stubAudio() }, { food: dis.id });
  assert.equal(A.stats(pet).favorite, null, '喂了不爱吃的也还是不知道她爱吃什么');
  const fav = W.favoriteFoodFor('小汐');
  A.run('feed', { pet, audio: stubAudio() }, { food: fav.id });
  assert.equal(A.stats(pet).favorite, fav.label, '喂到最爱之后才显示');
  assert.equal(A.stats(pet).foodTries[fav.id], 1, '要记录喂了几次');
});

test('动作层：散步中间停下来看风景/看人的台词都在', () => {
  const W = globalThis.WhalePet;
  for (const key of ['walkLook', 'walkMeet', 'foodFavorite', 'foodDislike']) {
    assert.ok(Array.isArray(W.LINES[key]) && W.LINES[key].length > 0, '缺台词集：' + key);
    assert.ok(W.LINES[key].every((l) => typeof l === 'string' && l.length > 0));
  }
});

/* ============================ 状态快照 ============================ */

test('动作层：stats 字段齐备（两种宿主共用同一套近况字段）', () => {
  const pet = newPet();
  pet.level = 3;
  pet.tokens = 12345;
  const s = A.stats(pet);
  for (const key of ['name', 'level', 'exp', 'expNeed', 'tokens', 'mood', 'hunger', 'energy',
    'bond', 'fedCount', 'patCount', 'pose', 'ambient', 'skin', 'sleeping']) {
    assert.ok(key in s, 'stats 里应该有 ' + key);
  }
  assert.equal(s.level, 3);
  assert.equal(s.tokens, 12345);
  assert.equal(typeof s.expNeed, 'number');
  assert.equal(s.sleeping, false);
  assert.equal(A.stats(null), null);
});

test('动作层：stats 的投喂/摸头计数读的是引擎真实字段', () => {
  const pet = newPet();
  const audio = stubAudio();
  A.run('feed', { pet, audio });
  A.run('feed', { pet, audio });
  A.run('pat', { pet, audio });
  const s = A.stats(pet);
  assert.equal(s.fedCount, 2, '投喂次数要读 totalFeed，实际 ' + s.fedCount);
  assert.equal(s.patCount, 1, '摸头次数要读 totalPat，实际 ' + s.patCount);
  assert.ok(pet.totalFeed === 2 && pet.totalPat === 1, '引擎字段本身也要对得上');
});

test('动作层：喂够 Token 真的会升级（动作层与引擎的成长规则对得上）', () => {
  const pet = newPet();
  const need = pet.expNeed();            // 升级所需经验
  pet.addTokens(need * 400);             // 每 400 token = 1 点经验
  assert.ok(pet.level >= 2, '喂够经验应该升级，实际 Lv.' + pet.level);
  const r = A.run('praise', { pet, audio: stubAudio() });
  assert.equal(r.ok, true);
  assert.ok(A.stats(pet).level >= 2);
});
