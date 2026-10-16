/**
 * 场合判定单测
 * 运行：node --test test/occasions.test.mjs
 *
 * 这层的价值全在"日子对不对"上，所以每个节日都钉一个具体日期。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../assets/pet-occasions.js');
const O = globalThis.WhalePetOccasions;

/** 本地时间的某一天某点（避免时区把测试搞出边界问题） */
function at(y, m, d, hh = 12, mm = 0) { return new Date(y, m - 1, d, hh, mm, 0, 0); }

/* ============================ 节日 ============================ */

test('场合：公历节日逐日命中（这些日期万年不变）', () => {
  const cases = [
    [at(2026, 1, 1), 'festivalNewYear', 'newyear'],
    [at(2026, 2, 14), 'valentine', 'valentine'],
    [at(2026, 10, 31), 'festivalHalloween', 'halloween'],
    [at(2026, 12, 24), 'festivalChristmas', 'christmas'],
    [at(2026, 12, 25), 'festivalChristmas', 'christmas'],
  ];
  for (const [date, hint, tag] of cases) {
    const o = O.pick(date, {});
    assert.ok(o, date.toDateString() + ' 应该有场合');
    assert.equal(o.hint, hint, date.toDateString());
    assert.equal(o.tag, tag);
    assert.equal(o.kind, 'festival');
    assert.ok(o.line && o.line.length > 0, '节日要有台词');
  }
});

test('场合：农历节日只认已核对的年份，别的年份安静地不触发', () => {
  const spring = O.pick(at(2025, 1, 29), {});
  assert.equal(spring.hint, 'festivalSpring');
  assert.equal(spring.tag, 'spring');

  const mid = O.pick(at(2026, 9, 25), {});
  assert.equal(mid.hint, 'festivalMidAutumn');

  // 没在表里的年份（农历日期每年不同）——绝不能瞎猜
  const unknown = O.pick(at(2030, 1, 29), {});
  assert.ok(!unknown || unknown.kind !== 'festival', '未核对的年份不该当成春节');
});

test('场合：节日优先于作息（跨零点的平安夜仍是圣诞）', () => {
  const o = O.pick(at(2026, 12, 24, 23, 30), {});
  assert.equal(o.tag, 'christmas', '深夜的平安夜应该是圣诞而不是熬夜');
});

/* ============================ 作息 ============================ */

test('场合：深夜换夜猫子/睡衣（并在两张之间轮换）', () => {
  const a = O.pick(at(2026, 3, 10, 23, 0), {});     // 偶数分 → night
  const b = O.pick(at(2026, 3, 10, 23, 1), {});     // 奇数分 → pajama
  assert.equal(a.hint, 'night');
  assert.equal(b.hint, 'pajama');
  assert.equal(a.tag, 'late-night');
  assert.equal(a.kind, 'routine');
  assert.equal(O.pick(at(2026, 3, 10, 2, 0), {}).tag, 'late-night', '凌晨两点也算熬夜');
});

test('场合：清早给一杯咖啡', () => {
  for (const hh of [6, 7, 8]) {
    const o = O.pick(at(2026, 3, 10, hh, 0), {});
    assert.equal(o.tag, 'morning', hh + ' 点应该是早间场合');
    assert.equal(o.hint, 'dailyCoffee');
  }
});

test('场合：连续工作两小时提醒伸懒腰，且台词带上小时数', () => {
  const o = O.pick(at(2026, 3, 10, 15, 0), { workedMinutes: 150 });
  assert.equal(o.tag, 'long-work');
  assert.equal(o.hint, 'dailyStretch');
  assert.match(o.line, /2 小时/, '台词要说清连续多久');
  // 没到两小时就别打扰
  assert.equal(O.pick(at(2026, 3, 10, 15, 0), { workedMinutes: 90 }), null);
});

test('场合：平平无奇的下午什么都不触发（不能一直弹）', () => {
  assert.equal(O.pick(at(2026, 3, 10, 15, 0), {}), null);
  assert.equal(O.pick(at(2026, 3, 10, 12, 30), { workedMinutes: 5 }), null);
});

/* ============================ 防御性 ============================ */

test('场合：坏输入返回 null，不抛异常', () => {
  for (const bad of [null, undefined, 'x', 42, new Date('nope')]) {
    assert.doesNotThrow(() => O.pick(bad, {}));
    assert.equal(O.pick(bad, {}), null);
  }
  assert.doesNotThrow(() => O.pick(at(2026, 5, 1), null));
});

test('场合：节日冷却最长（一天一次），作息类几小时一次', () => {
  assert.ok(O.cooldownMs('festival') > O.cooldownMs('routine'));
  assert.ok(O.cooldownMs('health') >= 30 * 60 * 1000);
});
