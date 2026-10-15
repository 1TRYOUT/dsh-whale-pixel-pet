/**
 * 状态收集器单测：任务 / 进度 / 用量
 * 运行：node --test test/status.test.mjs
 *
 * 这层是纯函数，不用起 DSH、不用浏览器：喂事件、看快照。
 * 重点是**防御性**——DSH 内部载荷形状会变，读不到必须安静留空，不能炸。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../lib/status.js');

function fresh() { return S.createStatusState(); }
const T0 = 1_800_000_000_000;

/* ============================ 任务 ============================ */

test('状态：目标(gold)事件 → 目前任务就是目标内容', () => {
  const s = fresh();
  S.reduce(s, 'goal/changed', { change: { goal: { objective: '把桌宠做完', status: 'active', rounds: 2, maxGoalRounds: 12 } } }, T0);
  const snap = S.snapshot(s, T0);
  assert.equal(snap.task.kind, 'goal');
  assert.equal(snap.task.text, '把桌宠做完');
  assert.equal(snap.task.goal.status, 'active');
  assert.equal(snap.task.goal.rounds, 2);
});

test('状态：目标完成 → 不再显示成进行中', () => {
  const s = fresh();
  S.reduce(s, 'goal/changed', { objective: '把桌宠做完' }, T0);
  S.reduce(s, 'goal/changed', { objective: '把桌宠做完', status: 'complete' }, T0 + 1000);
  const snap = S.snapshot(s, T0 + 1000);
  assert.equal(snap.task.text, '目标已完成');
  assert.equal(snap.task.goal, null);
});

test('状态：没有目标时，任务退化成"正在用某个工具"', () => {
  const s = fresh();
  S.reduce(s, 'tools/result', { exec: { name: 'pwsh' } }, T0);
  const snap = S.snapshot(s, T0);
  assert.equal(snap.task.kind, 'work');
  assert.equal(snap.task.text, '正在用 pwsh');
  assert.equal(snap.progress.lastTool, 'pwsh');
});

test('状态：工具名藏在别的字段里也能认出来', () => {
  for (const payload of [
    { exec: { toolName: 'read' } },
    { exec: { tool: 'grep' } },
    { exec: { definition: { name: 'edit' } } },
    { name: 'glob' },
  ]) {
    const s = fresh();
    S.reduce(s, 'tools/result', payload, T0);
    assert.ok(s.lastTool, '应该认出工具名：' + JSON.stringify(payload));
  }
});

/* ============================ 进度 ============================ */

test('状态：进度累计步数、子代理、阶段、耗时', () => {
  const s = fresh();
  S.reduce(s, 'agent/status', { status: 'running' }, T0);
  S.reduce(s, 'workflow/start', { id: 'wf1' }, T0);
  S.reduce(s, 'tools/result', { exec: { name: 'pwsh' } }, T0 + 1000);
  S.reduce(s, 'tools/result', { exec: { name: 'edit' } }, T0 + 2000);
  S.reduce(s, 'subagent/start', { name: 'researcher' }, T0 + 3000);
  S.reduce(s, 'workflow/phase', { id: 'wf1' }, T0 + 4000);   // 注意：没有 title
  const snap = S.snapshot(s, T0 + 10_000);

  assert.equal(snap.progress.steps, 2);
  assert.equal(snap.progress.subagents, 1);
  assert.equal(snap.progress.elapsedMs, 10_000);
  assert.match(snap.progress.text, /第 2 步/);
  assert.match(snap.progress.text, /1 个子代理在跑/);
  assert.match(snap.progress.text, /10 秒/);
});

test('状态：workflow/phase 传的是 (info, title) 也能取到阶段名', () => {
  const s = fresh();
  S.reduce(s, 'workflow/phase', [{ id: 'wf1' }, '扫描文件'], T0);
  assert.equal(S.snapshot(s, T0).progress.phase, '扫描文件');
});

test('状态：子代理跑完就减回去，不会只增不减', () => {
  const s = fresh();
  S.reduce(s, 'subagent/start', {}, T0);
  S.reduce(s, 'subagent/start', {}, T0);
  S.reduce(s, 'subagent/end', {}, T0);
  assert.equal(s.subagents, 1);
  assert.equal(s.subagentsTotal, 2, '累计数保留，用于"跑过几个"');
  S.reduce(s, 'subagent/end', {}, T0);
  S.reduce(s, 'subagent/end', {}, T0);   // 多余的 end 不能变负数
  assert.equal(s.subagents, 0);
});

test('状态：一轮结束后重开，本轮计数清零', () => {
  const s = fresh();
  S.reduce(s, 'agent/status', { status: 'running' }, T0);
  S.beginTurnIfNeeded(s, T0);
  S.reduce(s, 'tools/result', { exec: { name: 'a' } }, T0 + 100);
  S.reduce(s, 'tools/result', { exec: { name: 'b' } }, T0 + 200);
  assert.equal(s.tools, 2);

  S.reduce(s, 'agent/status', { status: 'idle' }, T0 + 300);
  S.beginTurnIfNeeded(s, T0 + 300);
  S.reduce(s, 'agent/status', { status: 'running' }, T0 + 400);
  S.beginTurnIfNeeded(s, T0 + 400);
  assert.equal(s.tools, 0, '新一轮的步数要重新计');
});

test('状态：报错会被记下来，并且一分钟后不再显示"有报错"', () => {
  const s = fresh();
  S.reduce(s, 'agent/error', { turn: 1, step: 3, error: new Error('boom') }, T0);
  assert.equal(s.errors, 1);
  assert.match(S.snapshot(s, T0 + 1000).progress.text, /有报错/);
  assert.doesNotMatch(S.snapshot(s, T0 + 90_000).progress.text, /有报错/);
});

/* ============================ 防御性 ============================ */

test('状态：乱载荷不抛异常，只记一笔 reducerErrors', () => {
  const s = fresh();
  const junk = [null, undefined, 42, 'x', [], { exec: null }, { change: 'nope' }, Object.create(null)];
  for (const j of junk) {
    for (const name of ['tools/result', 'goal/changed', 'workflow/phase', 'subagent/start', 'agent/status']) {
      assert.doesNotThrow(() => S.reduce(s, name, j, T0), name + ' ← ' + JSON.stringify(j));
    }
  }
  assert.ok(S.snapshot(s, T0));
});

test('状态：认不出的事件直接忽略', () => {
  const s = fresh();
  const before = JSON.stringify(S.snapshot(s, T0));
  S.reduce(s, '完全不存在的事件', { a: 1 }, T0);
  assert.equal(JSON.stringify(S.snapshot(s, T0)), before);
});

test('状态：超长目标会被截断，不会撑爆状态文件', () => {
  const s = fresh();
  S.reduce(s, 'goal/changed', { objective: '很长的目标'.repeat(200) }, T0);
  const snap = S.snapshot(s, T0);
  assert.ok(snap.task.text.length <= 120, '实际 ' + snap.task.text.length);
  assert.ok(snap.task.goal.objective.length <= 160);
});

test('状态：空闲时给人话，不是空白', () => {
  const snap = S.snapshot(fresh(), T0);
  assert.equal(snap.task.text, '空闲');
  assert.equal(snap.task.kind, 'idle');
  assert.equal(snap.progress.text, '空闲');
  assert.equal(snap.progress.elapsedMs, 0);
});

test('状态：耗时格式化', () => {
  assert.equal(S.fmtDuration(8_000), '8 秒');
  assert.equal(S.fmtDuration(65_000), '1 分 5 秒');
  assert.equal(S.fmtDuration(3_700_000), '1 时 1 分');
});
