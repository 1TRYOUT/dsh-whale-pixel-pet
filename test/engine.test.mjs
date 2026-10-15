/**
 * 像素鲸鱼娘 · 核心引擎单元测试
 * 运行：node --test test/engine.test.mjs
 *
 * 引擎是 UMD，import 之后从 globalThis.WhalePet 取 API；
 * 用假的 2D context 记录绘制调用，不需要浏览器。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../assets/whale-pet.js');
const W = globalThis.WhalePet;

/** 记录所有调用的假 context */
function stubCtx() {
  const calls = [];
  const ctx = {
    calls,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    fillRect(...a) { calls.push(['fillRect', ctx.fillStyle, ...a]); },
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    beginPath() { calls.push(['beginPath']); },
    arc(...a) { calls.push(['arc', ...a]); },
    ellipse(...a) { calls.push(['ellipse', ...a]); },
    fill() { calls.push(['fill']); },
    stroke() { calls.push(['stroke']); }
  };
  return ctx;
}

const POSES = ['idle', 'work', 'think', 'approve', 'happy', 'eat', 'drag', 'sleep', 'sad', 'levelup', 'groom'];

/* ============================ PixelPen ============================ */

test('PixelPen：rect / ellipse / line / tri 都能落格', () => {
  const pen = new W.PixelPen(4);
  pen.rect(0, 0, 3, 2, '#111');
  assert.equal(pen.cells.size, 6);
  pen.clear();
  pen.ellipse(0, 0, 2, 2, '#222');
  assert.ok(pen.cells.size > 8, '椭圆应有多个格子');
  pen.clear();
  pen.line(0, 0, 4, 0, '#333');
  assert.equal(pen.cells.size, 5);
  pen.clear();
  pen.tri(0, 0, 4, 0, 0, 4, '#444');
  assert.ok(pen.cells.size > 6, '三角形应有多个格子');
});

test('PixelPen：eraseEllipse 能挖空帽子开口', () => {
  const pen = new W.PixelPen(4);
  pen.ellipse(0, 0, 5, 5, '#111');
  const full = pen.cells.size;
  pen.eraseEllipse(0, 0, 2, 2);
  assert.ok(pen.cells.size < full, '挖空后格子应变少');
  assert.ok(pen.cells.size > 0, '外圈应保留');
});

test('PixelPen：group 只给新增图形描边（不会越描越粗）', () => {
  const pen = new W.PixelPen(4);
  pen.group(() => { pen.rect(10, 10, 4, 4, '#aaa'); }, '#000');
  const after1 = pen.cells.size;
  pen.group(() => { pen.rect(10, 10, 4, 4, '#aaa'); }, '#000');
  assert.equal(pen.cells.size, after1, '重复 group 不应继续外扩描边');
});

test('PixelPen：flushAt 支持左右翻转且锚点对齐', () => {
  const mk = (flip) => {
    const pen = new W.PixelPen(10);
    pen.anchorX = 12.5;
    pen.flip = flip;
    pen.rect(12, 0, 1, 1, '#f00');   // 本地 x=12，位于锚点 12.5 左侧 0.5 格
    const ctx = stubCtx();
    pen.flushAt(ctx, 100, 200);
    return ctx.calls.find((c) => c[0] === 'fillRect');
  };
  const right = mk(false);
  const left = mk(true);
  assert.equal(right[2], 95);
  assert.equal(left[2], 105);
  assert.equal(100 - right[2], left[2] - 100, '左右翻转应严格镜像');
  assert.equal(right[3], left[3], '翻转不应影响竖直位置');
});

/* ============================ 美术 ============================ */

test('drawWhale：所有姿势 × 所有皮肤都能画出来且不抛错', () => {
  for (const skin of W.SKIN_ORDER) {
    for (const pose of POSES) {
      const pen = new W.PixelPen(6);
      W.drawWhale(pen, {
        skin, pose, t: 0.3, phase: 0.7, tailPhase: 1.1,
        lookX: 0.4, lookY: -0.2, expr: 'normal', spout: pose !== 'sleep',
        laptop: pose === 'work', snack: pose === 'eat', alert: pose === 'approve',
        finFlap: 0.3, chew: false
      });
      assert.ok(pen.cells.size > 80, `${skin}/${pose} 画出的格子太少：${pen.cells.size}`);
      assert.ok(pen.cells.size < 6000, `${skin}/${pose} 格子异常多：${pen.cells.size}`);
    }
  }
});

test('drawWhale：睡觉和站立是不同剪影', () => {
  const cells = (pose) => {
    const pen = new W.PixelPen(6);
    W.drawWhale(pen, { skin: 'deep', pose, t: 0, phase: 0, tailPhase: 0, spout: pose !== 'sleep' });
    const keys = [...pen.cells.keys()];
    const ys = keys.map((k) => (k % 512) - 128);
    const xs = keys.map((k) => Math.floor(k / 512) - 128);
    return { size: pen.cells.size, maxY: Math.max(...ys), width: Math.max(...xs) - Math.min(...xs) };
  };
  const idle = cells('idle');
  const sleep = cells('sleep');
  assert.ok(idle.maxY > sleep.maxY, '站立应比蜷睡更高');
  assert.ok(sleep.width >= idle.width, '蜷睡应比站立更宽');
});

/* ============================ 状态机 ============================ */

function newPet(extra) {
  return new W.Pet(Object.assign({ w: 1000, h: 700 }, extra));
}

test('Pet：宿主信号驱动姿势（working / approval / thinking）', () => {
  const pet = newPet();
  pet.update(0.016);
  assert.equal(pet.pose, 'idle');

  pet.signal('working');
  pet.update(0.016);
  assert.equal(pet.pose, 'work');

  pet.signal('approval');
  pet.update(0.016);
  assert.equal(pet.pose, 'approve');

  pet.signal('thinking');
  pet.update(0.016);
  assert.equal(pet.pose, 'think');
});

test('Pet：工作态姿势会被钉住，短暂抖动不切姿势', () => {
  const pet = newPet();
  pet.signal('working');
  pet.update(0.016);
  assert.equal(pet.pose, 'work');
  pet.signal('idle');
  for (let i = 0; i < 60; i++) pet.update(1 / 60);
  assert.equal(pet.pose, 'work', '钉住期内不应切走');
  for (let i = 0; i < 60 * 9; i++) pet.update(1 / 60);
  assert.equal(pet.pose, 'idle', '钉住结束后应回到 idle');
});

test('Pet：摸头分区会给出不同反应和数值', () => {
  const pet = newPet();
  pet.mood = 50;
  const before = pet.mood;
  assert.equal(pet.pat('head'), 'head');
  assert.ok(pet.mood > before, '摸头应加心情');
  assert.equal(pet.pose, 'happy');
  pet._patCooldown = 0;
  const moodAfterHead = pet.mood;
  pet.pat('belly');
  assert.ok(pet.mood < moodAfterHead, '摸肚子应扣心情');
  assert.equal(pet.totalPat, 2);
});

test('Pet：投喂提升饱食度并进入进食姿势', () => {
  const pet = newPet();
  pet.hunger = 30;
  pet.feed();
  assert.ok(pet.hunger > 30);
  assert.equal(pet.pose, 'eat');
  assert.equal(pet.totalFeed, 1);
});

test('Pet：Token 用量会累积经验并在阈值升级', () => {
  const pet = newPet();
  const need = pet.expNeed();
  pet.addTokens(need * 400 + 10);            // 每 400 token 一点经验
  assert.ok(pet.level >= 2, `应升级，当前 Lv.${pet.level}`);
  assert.ok(pet.hunger > 0);
});

test('Pet：升级事件会被记录一次', () => {
  const pet = newPet();
  pet.addTokens(pet.expNeed() * 400 + 1);
  const ups = pet.events.filter((e) => e.type === 'levelup');
  assert.equal(ups.length, 1);
});

test('Pet：拖拽 → 甩出 → 落地，位置回到地面', () => {
  const pet = newPet();
  pet.startDrag(500, 300);
  assert.equal(pet.pose, 'drag');
  pet.dragTo(520, 260, 1 / 60);
  pet.dragTo(700, 200, 1 / 60);
  pet.endDrag();
  assert.equal(pet.dragging, false);
  for (let i = 0; i < 60 * 6; i++) pet.update(1 / 60);
  assert.ok(Math.abs(pet.y - pet.floorY()) < 1.5, `应回落到地面，实际 y=${pet.y} floor=${pet.floorY()}`);
  assert.ok(pet.x <= pet.view.w - 20 && pet.x >= 20, '不应飞出屏幕');
});

test('Pet：拖拽时不会被自动行为打断', () => {
  const pet = newPet();
  pet.startDrag(400, 300);
  for (let i = 0; i < 60 * 4; i++) {
    pet.dragTo(410 + i, 300, 1 / 60);
    pet.update(1 / 60);
  }
  assert.equal(pet.pose, 'drag');
  assert.equal(pet.mode, 'drag');
});

test('Pet：hitZone 能命中头/肚子，点空白处不命中', () => {
  const pet = newPet();
  const u = pet.unit();
  assert.equal(pet.hitZone(pet.x, pet.y - 20 * u), 'head');
  assert.equal(pet.hitZone(pet.x, pet.y - 8 * u), 'belly');
  assert.equal(pet.hitZone(pet.x + 900, pet.y - 8 * u), null);
});

test('Pet：睡觉恢复精力、清醒消耗精力', () => {
  const pet = newPet();
  pet.energy = 50;
  pet.toggleSleep(true);
  for (let i = 0; i < 60 * 60; i++) pet.update(1 / 60);
  assert.ok(pet.energy > 50, '睡觉应回精力');
  pet.toggleSleep(false);
  const e = pet.energy;
  for (let i = 0; i < 60 * 60; i++) pet.update(1 / 60);
  assert.ok(pet.energy < e, '清醒应消耗精力');
});

test('Pet：存档往返一致，离线会饿一点、回精力', () => {
  const pet = newPet();
  pet.level = 7; pet.bond = 42; pet.tokens = 123456; pet.totalPat = 9; pet.skin = 'coral';
  const data = pet.serialize();
  assert.equal(data.level, 7);
  assert.equal(data.skin, 'coral');

  const restored = newPet();
  const past = Object.assign({}, data, { lastSeen: Date.now() - 3600 * 1000 });
  restored.load(past);
  assert.equal(restored.level, 7);
  assert.equal(restored.bond, 42);
  assert.ok(restored.offlineSeconds > 3000, '应记录离线时长');
  assert.ok(restored.energy >= data.energy, '离线应恢复精力');
});

test('Pet：长时间循环稳定，粒子数量有上限', () => {
  const pet = newPet();
  pet.signal('working');
  for (let i = 0; i < 60 * 90; i++) {
    if (i % 600 === 0) pet.addTokens(20000);
    if (i % 900 === 0) { pet._patCooldown = 0; pet.pat('head'); }
    if (i % 1500 === 0) pet.feed();
    pet.update(1 / 60);
  }
  assert.ok(pet.particles.length <= 240, `粒子应被裁剪，实际 ${pet.particles.length}`);
  assert.ok(Number.isFinite(pet.x) && Number.isFinite(pet.y), '坐标不应变成 NaN');
  assert.ok(pet.hunger >= 0 && pet.hunger <= 100);
  assert.ok(pet.mood >= 0 && pet.mood <= 100);
  assert.ok(pet.energy >= 0 && pet.energy <= 100);
});

test('Pet：视口变化后仍在地面且不出界', () => {
  const pet = newPet();
  pet.setViewport(400, 300);
  assert.ok(pet.x <= 380);
  pet.setViewport(1600, 900);
  assert.ok(pet.x <= 1580 && pet.x >= 20);
  assert.ok(Math.abs(pet.y - pet.floorY()) < 40);
});

test('Pet：贴边按半身宽留位，不会被窗口裁掉；越界坐标会被夹回', () => {
  const pet = newPet();
  pet.setViewport(1200, 800);
  const u = pet.unit();
  const r = pet.xRange();
  assert.equal(pet.halfWidth(), 13 * u, '半身宽应为 13 格');
  assert.ok(r.min >= 13 * u - 0.001, '左边距要容得下整个身子');
  assert.ok(r.max <= 1200 - 13 * u + 0.001, '右边距要容得下整个身子');

  pet.x = 99999;
  pet.update(1 / 60);
  assert.ok(pet.x <= pet.xRange().max, `越界 x 应被夹回，实际 ${pet.x}`);

  pet.x = -99999;
  pet.update(1 / 60);
  assert.ok(pet.x >= pet.xRange().min, `越界 x 应被夹回，实际 ${pet.x}`);

  // 存档恢复的旧坐标同样要夹回（老存档可能来自更大的窗口）
  const restored = newPet();
  restored.setViewport(1200, 800);
  restored.load({ v: 1, x: 9999, y: 100 });
  assert.ok(restored.x <= restored.xRange().max, `存档 x 应被夹回，实际 ${restored.x}`);
});

test('Pet：视口缩小后她仍在可视范围内', () => {
  const pet = newPet();
  pet.setViewport(1600, 900);
  pet.x = pet.xRange().max;
  pet.setViewport(420, 360);
  const r = pet.xRange();
  assert.ok(pet.x >= r.min - 0.001 && pet.x <= r.max + 0.001, `x=${pet.x} range=${r.min}..${r.max}`);
});

test('Pet：render 能跑完整帧（假 ctx）', () => {
  const pet = newPet();
  const ctx = stubCtx();
  pet.signal('working');
  for (let i = 0; i < 30; i++) { pet.update(1 / 60); pet.render(ctx); }
  assert.ok(ctx.calls.some((c) => c[0] === 'fillRect'), '应该画了像素方块');
  assert.ok(ctx.calls.some((c) => c[0] === 'ellipse'), '影子应画了椭圆');
});

test('Pet：键盘联动会抬手（tapAnim）', () => {
  const pet = newPet();
  pet.onKeyTap();
  assert.ok(pet.tapAnim > 0.9);
  for (let i = 0; i < 60; i++) pet.update(1 / 60);
  assert.ok(pet.tapAnim < 0.9);
});

test('Pet：台词会在超时后清空', () => {
  const pet = newPet();
  pet.say('测试台词', 0.5);
  assert.ok(pet.speech && pet.speech.text === '测试台词');
  for (let i = 0; i < 60; i++) pet.update(1 / 60);
  assert.equal(pet.speech, null);
});

test('AudioKit：未开启时是空操作，不会抛错', () => {
  const kit = new W.AudioKit();
  assert.equal(kit.enabled, false);
  assert.doesNotThrow(() => { kit.pat(); kit.feed(); kit.levelup(); kit.land(); kit.approve(); });
});
