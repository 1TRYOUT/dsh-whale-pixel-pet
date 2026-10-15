/**
 * 插画立绘美术层单元测试（纯逻辑，不需要浏览器）
 * 运行：node --test test/art.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../assets/art-musume.js');
const A = globalThis.WhalePetArtMusume;

/** 假宠物：只提供美术层需要的字段 */
function fakePet(extra) {
  return Object.assign({
    pose: 'idle', mode: 'idle', ambientDetail: null, lastZone: null,
    artHint: null, artHintUntil: 0, t: 10, phase: 0.5, squash: 0, x: 500, y: 800,
    unit: () => 8
  }, extra || {});
}

const art = () => A.createArt({ base: '/api/x/assets?f=art/musume/' });

/* ============================ 姿势映射 ============================ */

test('立绘映射：每个姿势都有对应图', () => {
  const cases = [
    ['idle', 'dsh-whale-state-idle-cute.webp'],
    ['think', 'dsh-whale-state-thinking.webp'],
    ['approve', 'dsh-whale-state-waiting.webp'],
    ['eat', 'dsh-whale-state-eat.webp'],
    ['drag', 'dsh-whale-state-pick-up.webp'],
    ['sleep', 'dsh-whale-state-sleep.webp'],
    ['sad', 'dsh-whale-state-failure.webp'],
    ['levelup', 'dsh-whale-state-levelup.webp'],
    ['groom', 'dsh-whale-state-daily-coffee.webp']
  ];
  for (const [pose, file] of cases) {
    assert.equal(art().fileFor(fakePet({ pose, mode: pose })), file, `${pose} 应映射到 ${file}`);
  }
  // 未知姿势兜底
  assert.equal(art().fileFor(fakePet({ pose: 'unknown-pose' })), 'dsh-whale-state-idle-cute.webp');
});

test('立绘映射：干活的姿势会按工具类型细分', () => {
  const a = art();
  assert.equal(a.fileFor(fakePet({ pose: 'work', mode: 'work', ambientDetail: 'pwsh' })),
    'dsh-whale-state-work-deploy.webp', '跑命令 → 按开关的立绘');
  assert.equal(a.fileFor(fakePet({ pose: 'work', mode: 'work', ambientDetail: 'fs_edit' })),
    'dsh-whale-state-work-debug.webp', '改文件 → 拿放大镜的立绘');
  assert.equal(a.fileFor(fakePet({ pose: 'work', mode: 'work', ambientDetail: 'grep_search' })),
    'dsh-whale-state-work-review.webp', '搜索 → 看资料的立绘');
  assert.equal(a.fileFor(fakePet({ pose: 'work', mode: 'work', ambientDetail: 'weird_tool' })),
    'dsh-whale-state-tool.webp', '认不出来 → 回落通用工具立绘');
  assert.equal(a.fileFor(fakePet({ pose: 'work', mode: 'work', ambientDetail: null })),
    'dsh-whale-state-tool.webp');
});

test('立绘映射：摸头/捏肚子/拽尾巴有专属反应图', () => {
  const a = art();
  for (const [zone, file] of [['head', 'dsh-whale-state-react-head.webp'],
    ['belly', 'dsh-whale-state-react-belly.webp'],
    ['tail', 'dsh-whale-state-react-tail.webp']]) {
    assert.equal(a.fileFor(fakePet({ pose: 'happy', mode: 'happy', lastZone: zone })), file, zone);
  }
  // 开心但没记录分区 → 默认摸头图
  assert.equal(a.fileFor(fakePet({ pose: 'happy', mode: 'happy', lastZone: null })),
    'dsh-whale-state-react-head.webp');
});

test('立绘映射：特殊场合提示优先，且会过期', () => {
  const a = art();
  assert.equal(a.fileFor(fakePet({ artHint: 'greet', artHintUntil: 20, t: 10 })),
    'dsh-whale-state-greet.webp', '有效期内用打招呼立绘');
  assert.equal(a.fileFor(fakePet({ pose: 'idle', artHint: 'greet', artHintUntil: 5, t: 10 })),
    'dsh-whale-state-idle-cute.webp', '过期后回落到姿势立绘');
  assert.equal(a.fileFor(fakePet({ artHint: '不存在的提示' })), 'dsh-whale-state-idle-cute.webp');
});

/* ============================ 几何与命中 ============================ */

test('立绘几何：按身高缩放、以脚底为锚点', () => {
  const a = art();
  const b = a.box(fakePet({ x: 500, y: 800 }));
  assert.equal(b.h, 26 * 8, '高度 = 目标格数 × 单位');
  assert.equal(b.w, b.h, '没有图片信息时按 1:1 估算');
  assert.equal(b.y + b.h, 800, '底边贴脚底');
  assert.equal(b.x + b.w / 2, 500, '水平居中');
});

test('立绘命中：按身高切头 / 肚子 / 尾三段，框外不命中', () => {
  const a = art();
  const pet = fakePet({ x: 500, y: 800 });
  const H = 26 * 8;                 // 立绘高度（px）
  const top = 800 - H;              // 画面顶边
  assert.equal(a.zoneAt(pet, 500, top + H * 0.2), 'head', '上段是头');
  assert.equal(a.zoneAt(pet, 500, top + H * 0.6), 'belly', '中段是肚子');
  assert.equal(a.zoneAt(pet, 500, top + H * 0.9), 'tail', '下段是尾巴');
  assert.equal(a.zoneAt(pet, 500 + H, top + H * 0.5), null, '离得太远不命中');
  assert.equal(a.zoneAt(pet, 500, top - H * 0.3), null, '头顶上方不命中');
  assert.equal(a.zoneAt(pet, 500, 820), null, '脚底以下不命中');
});

/* ============================ 加载与回退 ============================ */

test('立绘加载：Node 里没有 Image，应安全失败而不是抛错', () => {
  const a = art();
  const rec = a.load('dsh-whale-state-idle-cute.webp');
  assert.equal(rec.ok, false);
  assert.equal(rec.failed, true);
  assert.equal(a.stat.total, 1);
  assert.equal(a.stat.loaded, 0);
  assert.equal(a.ready(fakePet()), false, '没就绪时 ready 为 false');
});

test('立绘渲染：没就绪时 draw 返回 false（让内核回退像素层）', () => {
  const a = art();
  const calls = [];
  const ctx = { save() {}, restore() {}, drawImage() { calls.push(1); }, set globalAlpha(v) {} };
  assert.equal(a.draw(ctx, fakePet()), false, '未加载完必须返回 false');
  assert.equal(calls.length, 0, '不应真的去画');
});

test('立绘渲染：就绪后真的画上去，并且不镜像（正面像）', () => {
  const a = art();
  const file = a.fileFor(fakePet());
  a.images[file] = { img: { naturalWidth: 512, naturalHeight: 512 }, ok: true, readyAt: Date.now() - 999, alpha: 1 };
  const calls = [];
  const ctx = {
    globalAlpha: 1,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    drawImage(img, x, y, w, h) { calls.push(['drawImage', x, y, w, h]); }
  };
  assert.equal(a.draw(ctx, fakePet({ x: 500, y: 800 })), true);
  const draw = calls.find((c) => c[0] === 'drawImage');
  assert.ok(draw, '应该调用了 drawImage');
  const [, x, y, w, h] = draw;
  // 待机会有极轻微的呼吸缩放，允许 2px 误差
  assert.ok(Math.abs(h - 26 * 8) < 2, `高度应约等于 26 格，实际 ${h}`);
  assert.ok(Math.abs(w - 26 * 8) < 2, `宽度应约等于 26 格，实际 ${w}`);
  // 待机会有轻微上下浮动，允许几像素偏移
  assert.ok(Math.abs((y + h) - 800) < 4, `底边应贴近脚底，实际 ${Math.round(y + h)}`);
  assert.ok(Math.abs((x + w / 2) - 500) < 0.001, '水平居中');
  assert.ok(!calls.some((c) => c[0] === 'scale'), '正面立绘不做左右镜像');
});

test('立绘预取：start 之后常用姿势进入队列/已加载，stop 能停下定时器', () => {
  const a = art();
  a.start();
  assert.equal(a.started, true, 'start 应置位');
  // 常用姿势是同步发起的
  assert.ok(Object.keys(a.images).length >= A.EAGER.length, '常用姿势应被立即发起加载');
  a.stop();
  assert.equal(a.timer, null);
  assert.doesNotThrow(() => a.start());   // 重复 start 不应重复排程
});

test('立绘映射表覆盖：EAGER 里的每个姿势都得有图', () => {
  for (const pose of A.EAGER) {
    assert.ok(A.POSE[pose], `EAGER 里的 ${pose} 缺少映射`);
  }
  for (const key of Object.keys(A.ZONE)) assert.ok(A.ZONE[key].endsWith('.webp'));
  for (const key of Object.keys(A.HINT)) assert.ok(A.HINT[key].endsWith('.webp'));
});
