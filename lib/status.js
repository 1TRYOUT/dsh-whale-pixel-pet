/**
 * 桌宠状态收集器（纯逻辑，可单测）
 * ---------------------------------------------------------------------------
 * 目标：让桌宠显示"当前任务 / 进度 / 用量"。
 *
 * 数据来源全部是宿主的**结构化事件与服务**，不读聊天正文：
 *   · 任务   ← goal（ctx.goals.get(agent)）/ goal 事件；没有目标时退化成"正在跑什么工具"
 *   · 进度   ← agent/status、tools/result、subagent/start|end、workflow/phase
 *   · 用量   ← tokenMeter.measure(session)（拿不到就退回客户端上报的 token 计数）
 *
 * 这里只做一件事：把事件折叠成一个快照。所有字段都**防御性读取**——
 * DSH 的内部载荷形状会变，读不到就留空，绝不抛异常、绝不猜。
 */

/** 事件名 → 折叠函数。未列出的事件直接忽略。 */
const REDUCERS = {
  'agent/status'(s, payload, now) {
    const status = payload && payload.status;
    s.running = status === 'running';
    if (s.running) {
      if (!s.turnStartedAt) s.turnStartedAt = now;
      if (!s.task.text || s.task.kind === 'idle') setTask(s, '正在处理你的请求', 'work', now);
    } else {
      s.running = false;
      s.phase = null;
      s.turnStartedAt = null;
    }
  },

  // 服务端也给一份同样的信号，两个都收，哪个来了算哪个
  'api-session/status'(s, payload, now) {
    const running = Array.isArray(payload) ? payload[1] : (payload && payload.running);
    if (typeof running === 'boolean') s.running = running;
    if (s.running && !s.turnStartedAt) s.turnStartedAt = now;
  },

  'tools/result'(s, payload, now) {
    s.tools += 1;
    s.steps = Math.max(s.steps, s.tools);
    const name = toolName(payload);
    if (name) {
      s.lastTool = name;
      if (!s.task.text || s.task.kind === 'idle' || s.task.kind === 'work') {
        setTask(s, '正在用 ' + name, 'work', now);
      }
    }
    if (!s.turnStartedAt) s.turnStartedAt = now;
  },

  'subagent/start'(s) { s.subagents += 1; s.subagentsTotal += 1; },
  'subagent/end'(s) { s.subagents = Math.max(0, s.subagents - 1); },

  'workflow/start'(s, _p, now) { s.workflow = '工作流已启动'; s.phase = null; if (!s.turnStartedAt) s.turnStartedAt = now; },
  'workflow/phase'(s, payload, now) {
    const title = Array.isArray(payload) ? payload[1] : (payload && payload.title);
    if (typeof title === 'string' && title) { s.phase = title; s.workflow = title; }
  },
  'workflow/end'(s) { s.workflow = null; s.phase = null; },

  'agent/error'(s, payload, now) {
    s.errors += 1;
    s.lastErrorAt = now;
    s.lastErrorStep = pick(payload, ['step']);
  },

  'goal/changed'(s, payload, now) {
    const goal = pick(payload, ['change', 'goal']) || payload;
    applyGoal(s, goal, now);
  },
  'goal/activation-changed'(s, payload, now) { applyGoal(s, payload, now); },
};

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

/** 工具执行载荷里工具名可能藏在几个地方，都试一遍 */
function toolName(payload) {
  const exec = pick(payload, ['exec', 'execution']) || payload;
  const name = pick(exec, ['name', 'tool', 'toolName', 'toolId']);
  if (typeof name === 'string' && name) return name;
  const def = pick(exec, ['definition', 'toolDefinition']);
  const nested = pick(def, ['name']);
  return typeof nested === 'string' ? nested : null;
}

function setTask(s, text, kind, now) {
  s.task = { text: String(text).slice(0, 120), kind: kind, at: now };
}

/** GoalView 的形状按可用字段宽松读取；目标结束/清空时退回"空闲" */
function applyGoal(s, goal, now) {
  if (!goal || typeof goal !== 'object') return;
  const inner = pick(goal, ['goal', 'view', 'value']) || goal;
  const objective = pick(inner, ['objective', 'title', 'text']);
  const status = pick(inner, ['status', 'state']);
  const rounds = pick(inner, ['rounds', 'round', 'roundCount']);
  const maxRounds = pick(inner, ['maxGoalRounds', 'maxRounds']);

  if (typeof objective === 'string' && objective.trim()) {
    s.goal = { objective: objective.trim().slice(0, 160), status: status || null, rounds: rounds || null, maxRounds: maxRounds || null };
    const done = status === 'complete' || status === 'completed' || status === 'cleared';
    setTask(s, done ? '目标已完成' : s.goal.objective, done ? 'idle' : 'goal', now);
    if (done) s.goal = null;
    return;
  }
  if (status === 'complete' || status === 'completed' || status === 'cleared') {
    s.goal = null;
    setTask(s, '目标已完成', 'idle', now);
  }
}

/** 初始状态 */
function createStatusState() {
  return {
    running: false,
    tools: 0,
    steps: 0,
    subagents: 0,
    subagentsTotal: 0,
    errors: 0,
    lastTool: null,
    lastErrorAt: null,
    lastErrorStep: null,
    workflow: null,
    phase: null,
    goal: null,
    task: { text: '', kind: 'idle', at: 0 },
    turnStartedAt: null,
    updatedAt: 0,
  };
}

/** 折叠一个事件（就地修改并返回 state；不认识的事件原样返回） */
function reduce(state, eventName, payload, now) {
  const fn = REDUCERS[eventName];
  if (!fn) return state;
  try {
    fn(state, payload, typeof now === 'number' ? now : Date.now());
    state.updatedAt = typeof now === 'number' ? now : Date.now();
  } catch (error) {
    // 载荷形状变了也不能影响桌宠：记一笔就算了
    state.reducerErrors = (state.reducerErrors || 0) + 1;
  }
  return state;
}

/** 一轮开始时把本轮的计数清零（agent 从 idle 变 running） */
function beginTurnIfNeeded(state, now) {
  if (state.running && state._turnStarted) return state;
  if (state.running && !state._turnStarted) {
    state.tools = 0;
    state.steps = 0;
    state.subagents = 0;
    state.phase = null;
    state.workflow = null;
    state._turnStarted = true;
    state.turnStartedAt = now;
  }
  if (!state.running) state._turnStarted = false;
  return state;
}

/**
 * 生成给桌宠用的快照。字段刻意做得"人话"，UI 不用再解释：
 *   task.text    一句话任务
 *   progress.*   进度原始量与一句可读文本
 *   usage.*      用量
 */
function snapshot(state, now) {
  const t = typeof now === 'number' ? now : Date.now();
  const elapsedMs = state.turnStartedAt ? Math.max(0, t - state.turnStartedAt) : 0;

  const parts = [];
  if (state.tools > 0) parts.push('第 ' + state.tools + ' 步');
  if (state.subagents > 0) parts.push(state.subagents + ' 个子代理在跑');
  else if (state.subagentsTotal > 0) parts.push('子代理 ' + state.subagentsTotal + ' 个');
  if (state.phase) parts.push('阶段：' + state.phase);
  else if (state.workflow) parts.push(state.workflow);
  if (elapsedMs > 0) parts.push(fmtDuration(elapsedMs));
  if (state.errors > 0 && state.lastErrorAt && t - state.lastErrorAt < 60000) parts.push('有报错');

  return {
    task: {
      text: state.task.text || (state.running ? '正在处理' : '空闲'),
      kind: state.task.kind || 'idle',
      goal: state.goal,
    },
    progress: {
      steps: state.tools,
      subagents: state.subagents,
      subagentsTotal: state.subagentsTotal,
      phase: state.phase,
      lastTool: state.lastTool,
      errors: state.errors,
      elapsedMs: elapsedMs,
      text: parts.join(' · ') || (state.running ? '正在处理' : '空闲'),
    },
    usage: {
      tokens: state.tokens || 0,
      steps: state.tools,
      text: '',
    },
    updatedAt: state.updatedAt,
  };
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' 秒';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' 分 ' + (s % 60) + ' 秒';
  return Math.floor(m / 60) + ' 时 ' + (m % 60) + ' 分';
}

export {
  createStatusState,
  reduce,
  snapshot,
  beginTurnIfNeeded,
  fmtDuration,
  REDUCERS,
};
