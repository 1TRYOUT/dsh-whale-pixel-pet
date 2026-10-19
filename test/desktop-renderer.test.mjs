/** 桌面鼠标交互回归：运行真实事件处理器，替换窗口与 IPC 边界。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../desktop/renderer.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'renderer interaction source must be present');
  return source.slice(from, to);
}
const interactions = section('  let over = false;', '  const DEBUG') +
  section('  function zoneAtEvent(e)', "  window.addEventListener('contextmenu'");

function fixture() {
  const events = new Map();
  const calls = { start: 0, end: 0, pat: 0, locks: [] };
  const context = vm.createContext({
    window: { addEventListener(name, handler) { events.set(name, handler); } },
    pet: { cursor: {}, hitZone() { return 'head'; } },
    bridge: {
      dragStart() { calls.start++; },
      dragEnd() { calls.end++; },
      setDragLock(locked) { calls.locks.push(locked); },
    },
    A: { run(action) { if (action === 'pat') calls.pat++; } },
    audio: {},
  });
  vm.runInContext(interactions, context);
  const emit = (name, point = {}) => events.get(name)?.({
    button: 0, clientX: 50, clientY: 50, screenX: 500, screenY: 500,
    preventDefault() {}, ...point,
  });
  return { emit, calls };
}

test('桌面拖动：窗口跟随后 client 坐标不变，松手仍不能触发摸头', () => {
  const { emit, calls } = fixture();
  emit('pointerdown');
  emit('pointermove', { screenX: 600, clientX: 50 });
  emit('pointerup', { screenX: 600, clientX: 50 });
  assert.equal(calls.end, 1, 'drag must stop once');
  assert.equal(calls.pat, 0, '100 screen-coordinate units of movement is not a click');
  assert.deepEqual(calls.locks, [true, false]);
});

test('桌面点击：不移动也必须结束主进程跟随，并保留一次摸头', () => {
  const { emit, calls } = fixture();
  emit('pointerdown');
  emit('pointerup');
  assert.equal(calls.start, 1);
  assert.equal(calls.end, 1, 'click must stop the follow timer too');
  assert.equal(calls.pat, 1);
});

test('桌面拖动：没收到中间 pointermove，松手位移仍能识别拖动', () => {
  const { emit, calls } = fixture();
  emit('pointerdown');
  emit('pointerup', { screenX: 600 });
  assert.equal(calls.end, 1);
  assert.equal(calls.pat, 0, 'missing move events must not turn a drag into a click');
});

for (const event of ['pointercancel', 'blur']) {
  test(`桌面拖动：${event} 结束跟随且不误触摸头`, () => {
    const { emit, calls } = fixture();
    emit('pointerdown');
    emit(event);
    emit('pointerup');
    assert.equal(calls.end, 1, 'cancellation must stop once');
    assert.equal(calls.pat, 0, 'a cancelled press must not become a click');
    assert.deepEqual(calls.locks, [true, false]);
  });
}

test('桌面拖动：没有按下时的松手不发送结束或摸头', () => {
  const { emit, calls } = fixture();
  emit('pointerup');
  assert.equal(calls.end, 0);
  assert.equal(calls.pat, 0);
});
