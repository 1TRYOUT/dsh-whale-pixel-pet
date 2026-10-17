/**
 * 立绘包机制单测
 * 运行：node --test test/packs.test.mjs
 *
 * 包机制的核心承诺是"脏数据只让那个包失效，绝不让她白屏"，
 * 所以这里大半断言都在测"坏 manifest 会怎样"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../assets/pet-packs.js');
await import('../assets/whale-pet.js');
await import('../assets/art-musume.js');
const P = globalThis.WhalePetPacks;
const W = globalThis.WhalePet;

/* ============================ manifest 校验 ============================ */

test('包：合法 manifest 能通过，并保留名字/作者/缩放', () => {
  const r = P.validate({ name: '霜蓝 · 冬装', author: 'someone', poses: { idle: 'idle.png', work: 'work.png' }, scale: 1.2 });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.pack.name, '霜蓝 · 冬装');
  assert.equal(r.pack.author, 'someone');
  assert.equal(r.pack.scale, 1.2);
  assert.equal(r.pack.poses.idle, 'idle.png');
});

test('包：只画 idle 也能过——其他姿势会自动回落', () => {
  const r = P.validate({ name: '懒人包', poses: { idle: 'a.png' } });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.pack.poses), ['idle']);
});

test('包：缺 idle / 缺 name / poses 不是对象 → 明确报错而不是硬撑', () => {
  assert.equal(P.validate({ name: 'x', poses: { work: 'w.png' } }).ok, false, '缺 idle 要报错');
  assert.match(P.validate({ name: 'x', poses: { work: 'w.png' } }).errors.join(), /idle/);
  assert.equal(P.validate({ poses: { idle: 'a.png' } }).ok, false, '缺 name 要报错');
  assert.equal(P.validate({ name: 'x', poses: [] }).ok, false, 'poses 是数组要报错');
  assert.equal(P.validate(null).ok, false);
  assert.equal(P.validate('字符串').ok, false);
});

test('包：文件名不许带路径（防目录穿越）', () => {
  const r = P.validate({ name: '坏包', poses: { idle: '../../../etc/passwd' } });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /不合法/);
  for (const bad of ['a/b.png', 'a\\b.png', '..', '', 123]) {
    assert.equal(P.isSafeFile(bad), false, '不安全的名字：' + JSON.stringify(bad));
  }
  assert.equal(P.isSafeFile('idle.png'), true);
});

test('包：不认识的姿势名不算错，只是记下来', () => {
  const r = P.validate({ name: 'x', poses: { idle: 'a.png', 乱写的: 'b.png' } });
  assert.equal(r.ok, true, '不认识不该让整个包失效');
  assert.ok(r.unknown.includes('poses.乱写的'));
});

/* ============================ 叠加与回落 ============================ */

function makeArt() {
  return globalThis.WhalePetArtMusume.createArt({ base: '../assets/art/musume/', targetUnits: 34 });
}

test('包：叠加后包里的姿势优先，没有的姿势回落内置', () => {
  const art = makeArt();
  const packed = P.wrapArt(art, { name: '测试包', base: 'packs/test/', poses: { idle: 'my-idle.png' }, hints: {} });
  const pet = new W.Pet({ w: 600, h: 600 });
  pet.pose = 'idle';
  assert.equal(packed.fileFor(pet), 'my-idle.png', '包里有 idle 就该用包里的');
  pet.pose = 'work';
  assert.notEqual(packed.fileFor(pet), 'my-idle.png', '包里没有 work 应回落到内置');
  assert.match(packed.fileFor(pet), /\.webp$/, '内置的是 webp 立绘');
});

test('包：表情(hint)也支持覆盖，且优先于姿势', () => {
  const art = makeArt();
  const packed = P.wrapArt(art, { name: 'x', base: 'p/', poses: { idle: 'i.png' }, hints: { star: 'my-star.png' } });
  const pet = new W.Pet({ w: 600, h: 600 });
  pet.pose = 'idle';
  pet.artHint = 'star';
  pet.artHintUntil = pet.t + 10;
  assert.equal(packed.fileFor(pet), 'my-star.png');
  pet.artHint = 'greet';                  // 包里没有的表情 → 回落
  assert.notEqual(packed.fileFor(pet), 'my-star.png');
});

test('包：没有包时行为不变（wrapArt 对空值宽容）', () => {
  const art = makeArt();
  const pet = new W.Pet({ w: 600, h: 600 });
  const before = art.fileFor(pet);
  assert.equal(P.wrapArt(art, null), art);
  assert.equal(P.wrapArt(null, { name: 'x' }), null);
  assert.equal(art.fileFor(pet), before, '不传包不该改变已有行为');
});

test('包：poseKeyFor 的顺序是 表情 > 摸头分区 > 姿势', () => {
  const pet = new W.Pet({ w: 600, h: 600 });
  pet.pose = 'work';
  assert.equal(P.poseKeyFor(pet).pose, 'work');
  // 只断言"谁优先"，不绑定对象里的其他字段（更稳）
  pet.mode = 'happy';
  pet.lastZone = 'head';
  assert.equal(Object.keys(P.poseKeyFor(pet))[0], 'zone', '摸头分区应优先于姿势');
  pet.artHint = 'star';
  pet.artHintUntil = pet.t + 5;
  assert.equal(Object.keys(P.poseKeyFor(pet))[0], 'hint', '表情应优先于分区');
  assert.equal(P.poseKeyFor(null).pose, 'idle');
});
