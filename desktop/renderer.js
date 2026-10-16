/**
 * 桌宠窗口的渲染进程：复用与 DSH 插件完全相同的引擎和立绘，
 * 只是把"舞台"从整页换成了一个 420×640 的透明小窗口。
 *
 * 交互要点：
 *   · 默认整窗鼠标穿透；指针进入她身体范围才由主进程打开命中（不挡桌面操作）
 *   · 拖动 = 移动窗口（不是移动画布里的她）
 *   · 单击 = 摸头（分头/肚子/尾巴三区），右键 = 菜单
 *   · DSH 状态通过 petBridge.onState 推过来：干活/思考/待审批/出错
 */
'use strict';

(function () {
  const W = window.WhalePet;
  const A = window.WhalePetActions;      // 与 DSH 窗口版共用的动作层（同一份实现）
  const bridge = window.petBridge;
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const bubbleEl = document.getElementById('bubble');
  const hintEl = document.getElementById('hint');
  const hudEl = document.getElementById('hud');

  /* ------------------------------ 偏好（持久化） ------------------------------ */

  const PREFS_KEY = 'whale-pet:desktop:prefs:v1';
  const prefs = { art: 'musume', skin: 'deep', sound: true, bubble: true, name: '小汐', hud: true };
  try {
    const savedPrefs = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (savedPrefs && typeof savedPrefs === 'object') Object.assign(prefs, savedPrefs);
  } catch (e) { /* file:// 下拿不到存储也不影响 */ }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  }

  /* ------------------------------ 引擎与立绘 ------------------------------ */

  const art = window.WhalePetArtMusume
    ? window.WhalePetArtMusume.createArt({ base: '../assets/art/musume/', targetUnits: 34 })
    : null;

  let pet = new W.Pet({ w: window.innerWidth, h: window.innerHeight });
  pet.floorInset = 24;
  pet.followCursor = false;          // 桌面形态下她待在窗口里，不追鼠标
  pet.cursor.active = false;
  pet.skin = prefs.skin || pet.skin;
  if (prefs.name) pet.name = prefs.name;
  if (art) {
    if (prefs.art === 'pixel') pet.setArt(null); else { pet.setArt(art); art.start(); }
  }
  pet.x = window.innerWidth / 2;
  pet.y = pet.floorY();
  pet.say('我到桌面上了～', 3);

  const audio = new W.AudioKit();
  audio.enabled = prefs.sound !== false;   // 只在互动时出声，不做环境音

  /* ------------------------------ 画布与循环 ------------------------------ */

  function resizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pet.setViewport(window.innerWidth, window.innerHeight);
    pet.x = window.innerWidth / 2;
    pet.y = pet.floorY();
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  function renderBubble() {
    if (!prefs.bubble || !pet.speech) {
      if (bubbleEl.style.display !== 'none') bubbleEl.style.display = 'none';
      return;
    }
    const box = pet.art && pet.art.box ? pet.art.box(pet) : { y: pet.y - 26 * pet.unit(), h: 26 * pet.unit() };
    bubbleEl.textContent = pet.speech.text;
    bubbleEl.style.display = 'block';
    bubbleEl.style.left = Math.round(Math.max(90, Math.min(window.innerWidth - 90, pet.x))) + 'px';
    bubbleEl.style.top = Math.round(box.y - 8) + 'px';
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    pet.update(dt);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    pet.render(ctx);
    renderBubble();
    speakIfNeeded();
    renderDebug(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ------------------------------ 鼠标穿透与拖动 ------------------------------ */
  // 穿透状态由主进程按"系统光标是否落在她身上"自动判定（更可靠，
  // 不依赖 setIgnoreMouseEvents 的 forward 事件转发）。
  // 这里只负责：上报包围盒、上报拖动锁、处理真正的鼠标交互。

  let over = false;                 // 指针是否在她身上（仅用于调试显示）
  let down = false;
  let dragging = false;
  let lastPt = { x: 0, y: 0 };
  let moved = 0;

  const DEBUG = /(?:^|[?&])debug=1/.test(location.search);
  // 面板开关必须在这里声明：currentBox() 在本文件靠前的位置就会用到它（TDZ 会直接崩）
  let panelOpen = false;

  function currentBox() {
    // 面板打开时整个窗口都要可点（按钮在面板里），否则只认她本人
    if (panelOpen) return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    const b = (pet.art && pet.art.box) ? pet.art.box(pet) : { x: pet.x - 90, y: pet.y - 180, w: 180, h: 180 };
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
  }

  let lastBoxKey = '';
  function reportBox() {
    const b = currentBox();
    const key = b.x + ',' + b.y + ',' + b.w + ',' + b.h;
    if (key === lastBoxKey) return;
    lastBoxKey = key;
    bridge.setBox(b);
  }
  reportBox();
  setInterval(reportBox, 400);

  function zoneAtEvent(e) {
    return pet.hitZone(e.clientX, e.clientY);
  }

  window.addEventListener('pointermove', (e) => {
    // 瞳孔跟随（她有 lookAt，但 followCursor 关着，所以不会转身/追人）
    pet.cursor.x = e.clientX;
    pet.cursor.y = e.clientY;
    pet.cursor.active = true;

    over = zoneAtEvent(e) !== null;

    if (down) {
      const dx = e.clientX - lastPt.x;
      const dy = e.clientY - lastPt.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4) {
        dragging = true;
        bridge.drag(dx, dy);        // 移动的是窗口
      }
      lastPt = { x: e.clientX, y: e.clientY };
    }
  }, { passive: true });

  window.addEventListener('pointerleave', () => { over = false; });

  window.addEventListener('pointerdown', (e) => {
    const zone = zoneAtEvent(e);
    if (zone === null) return;      // 不在她身上：不动，交给系统穿透
    if (e.button === 2) return;     // 右键走 contextmenu
    down = true;
    dragging = false;
    moved = 0;
    lastPt = { x: e.clientX, y: e.clientY };
    bridge.setDragLock(true);       // 拖动期间不许穿透
    e.preventDefault();
  });

  window.addEventListener('pointerup', (e) => {
    if (!down) return;
    down = false;
    bridge.setDragLock(false);
    if (dragging) {
      bridge.dragEnd();
    } else {
      const zone = pet.hitZone(e.clientX, e.clientY) || 'head';
      // 走共用动作层，和 DSH 窗口版完全同一套反应
      if (A) A.run('pat', { pet: pet, audio: audio });
      else { pet.pat(zone); audio.pat(); }
    }
    dragging = false;
    over = pet.hitZone(e.clientX, e.clientY) !== null;
  });

  window.addEventListener('contextmenu', (e) => {
    if (panelOpen) return;                       // 面板里用右键保持浏览器行为
    if (pet.hitZone(e.clientX, e.clientY) === null) return;
    e.preventDefault();
    bridge.menu(menuSpec());
  });

  /* ------------------------------ 动作与面板 ------------------------------ */

  function el(tag, style, text) {
    const node = document.createElement(tag);
    if (style) Object.assign(node.style, style);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, onClick, width) {
    const b = el('button', {
      padding: '5px 9px', marginRight: '6px', marginBottom: '6px',
      background: 'rgba(96,150,220,0.20)', color: '#dce9f7',
      border: '1px solid rgba(150,200,255,0.28)', borderRadius: '9px',
      font: '12px/1.2 "Segoe UI","Microsoft YaHei",sans-serif', cursor: 'pointer',
      width: width || 'auto',
    }, label);
    b.type = 'button';
    b.addEventListener('click', (ev) => { ev.preventDefault(); onClick(); });
    return b;
  }

  function setArt(style) {
    prefs.art = style === 'pixel' ? 'pixel' : 'musume';
    if (art) { if (prefs.art === 'pixel') art.stop(); else art.start(); }
    pet.setArt(prefs.art === 'pixel' ? null : art);
    savePrefs(); refreshPanel(); reportBox();
  }

  function resetGrowth() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    const fresh = A && A.resetPet ? A.resetPet(pet, { skin: prefs.skin, name: prefs.name, followCursor: false }) : null;
    if (fresh) {
      pet = fresh;
      pet.floorInset = 24;
      pet.x = window.innerWidth / 2;
      pet.y = pet.floorY();
      pet.cursor.active = false;
    }
    lastTokens = 0;
    refreshPanel(); reportBox();
  }

  /** 桌面版的"散步"：不是她在画布里走，而是整个窗口沿着屏幕走 */
  function desktopWalk() {
    const range = pet.xRange();
    const goRight = pet.x < (range.min + range.max) / 2;
    pet.setMode('walk', 0);
    bridge.walk({ dir: goRight ? 1 : -1 });
    return true;
  }

  /** 桌面宿主能做的全部动作；宠物级动作转发给共用动作层 */
  function runAction(id) {
    if (A && A.actionMeta && A.actionMeta(id)) {
      // 注意：'walk' 也在共用清单里，桌面版必须把"走出去"换成窗口平移，
      // 否则共用层会让她在画布里走，而窗口原地不动（这个坑踩过一次）。
      const ctx = { pet: pet, audio: audio };
      if (id === 'walk') ctx.walkTo = desktopWalk;
      const r = A.run(id, ctx);
      refreshPanel();
      return r;
    }
    switch (id) {
      case 'panel': openPanel(); break;
      case 'panel-close': openPanel(false); break;
      case 'art-musume': setArt('musume'); break;
      case 'art-pixel': setArt('pixel'); break;
      case 'home': bridge.resetPos(); break;
      case 'hide': bridge.hide(); break;
      case 'reset': resetGrowth(); break;
      case 'sound': prefs.sound = !prefs.sound; audio.enabled = prefs.sound; savePrefs(); refreshPanel(); break;
      case 'bubble': prefs.bubble = !prefs.bubble; savePrefs(); refreshPanel(); break;
      case 'hud':
        prefs.hud = prefs.hud === false;
        savePrefs(); refreshPanel();
        renderHud(window.__lastState || {});
        break;
      case 'quit': if (bridge.quit) bridge.quit(); break;
      default:
        if (id && id.indexOf('skin-') === 0 && A) {
          const skin = id.slice(5);
          if (A.setSkin(pet, skin)) { prefs.skin = skin; savePrefs(); refreshPanel(); }
        } else if (id && id.indexOf('food-') === 0 && A) {
          const r = A.run('feed', { pet: pet, audio: audio }, { food: id.slice(5) });
          refreshPanel();
          return r;
        }
        break;
    }
    return { ok: true, id: id };
  }

  /** 原生右键菜单的清单（主进程弹，点了回传 id） */
  function menuSpec() {
    const skins = (W.SKINS && Object.keys(W.SKINS)) || ['deep'];
    const sleeping = pet.mode === 'sleep';
    return {
      items: [
        { id: 'pat', label: '摸摸头' },
        { id: 'praise', label: '夸夸她' },
        { id: 'play', label: '玩一下' },
        { id: 'walk', label: '散步（走过去）' },
        {
          label: '喂点东西', type: 'submenu',
          items: ((A && A.foods) ? A.foods() : []).map((f) => ({
            id: 'food-' + f.id,
            // 喂到过最爱之后，菜单里给她标个星（在那之前不剧透）
            label: f.label + ((A.stats && A.stats(pet).favorite === f.label) ? ' ★' : ''),
            type: 'checkbox',
            checked: pet.lastFood === f.id,
          })),
        },
        { id: 'sleep', label: sleeping ? '叫醒她' : '睡吧' },
        { type: 'separator' },
        {
          label: '换个画风', type: 'submenu', items: [
            { id: 'art-musume', label: '插画立绘', type: 'checkbox', checked: prefs.art !== 'pixel' },
            { id: 'art-pixel', label: '像素', type: 'checkbox', checked: prefs.art === 'pixel' },
          ],
        },
        {
          label: '像素配色', type: 'submenu',
          items: skins.map((s) => ({
            id: 'skin-' + s, label: (W.SKINS[s] && W.SKINS[s].name) || s,
            type: 'checkbox', checked: pet.skin === s,
          })),
        },
        { type: 'separator' },
        { id: 'panel', label: '设置面板…', type: 'checkbox', checked: panelOpen },
        { id: 'home', label: '回到右下角' },
        { id: 'hide', label: '藏起来（托盘里能叫回来）' },
        { type: 'separator' },
        { id: 'quit', label: '退出桌宠' },
      ],
    };
  }

  /* --- 面板 DOM --- */

  const panelEl = el('div', {
    position: 'absolute', left: '10px', right: '10px', top: '10px',
    maxHeight: '420px', overflowY: 'auto', display: 'none',
    padding: '11px 12px', boxSizing: 'border-box',
    background: 'rgba(18,26,36,0.96)', color: '#dce9f7',
    border: '1px solid rgba(150,200,255,0.22)', borderRadius: '14px',
    boxShadow: '0 14px 34px rgba(0,0,0,0.42)',
    font: '12px/1.5 "Segoe UI","Microsoft YaHei",sans-serif',
  });
  document.body.appendChild(panelEl);

  const panel = {
    title: el('div', { fontWeight: '600', fontSize: '13px', marginBottom: '4px' }),
    stats: el('div', { whiteSpace: 'pre-line', marginBottom: '8px', color: '#b9cde6' }),
    bar: el('div', { height: '6px', borderRadius: '4px', background: 'rgba(255,255,255,0.10)', marginBottom: '9px', overflow: 'hidden' }),
    actions: el('div', {}),
    artRow: el('div', { marginBottom: '2px' }),
    skinRow: el('div', { marginBottom: '2px' }),
    toggleRow: el('div', { marginBottom: '6px' }),
    nameRow: el('div', { marginBottom: '6px', display: 'flex', gap: '6px', alignItems: 'center' }),
    adminRow: el('div', {}),
  };
  const barFill = el('div', { height: '100%', width: '0%', background: 'linear-gradient(90deg,#4a9be8,#7fd6ff)' });
  panel.bar.appendChild(barFill);

  const nameInput = el('input', {
    flex: '1', minWidth: '0', padding: '4px 8px', borderRadius: '8px',
    background: 'rgba(255,255,255,0.08)', color: '#dce9f7',
    border: '1px solid rgba(150,200,255,0.25)', font: '12px/1.4 "Segoe UI","Microsoft YaHei",sans-serif',
  });
  nameInput.type = 'text';
  nameInput.maxLength = 12;
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyName(); });
  function applyName() {
    if (!A) return;
    A.setName(pet, nameInput.value, '小汐');
    prefs.name = pet.name;
    savePrefs(); refreshPanel();
  }
  panel.nameRow.appendChild(el('span', { color: '#b9cde6' }, '名字'));
  panel.nameRow.appendChild(nameInput);
  panel.nameRow.appendChild(button('保存', applyName));

  panelEl.appendChild(panel.title);
  panelEl.appendChild(panel.stats);
  panelEl.appendChild(panel.bar);
  panelEl.appendChild(panel.actions);
  panelEl.appendChild(panel.artRow);
  panelEl.appendChild(panel.skinRow);
  panelEl.appendChild(panel.toggleRow);
  panelEl.appendChild(panel.nameRow);
  panelEl.appendChild(panel.adminRow);

  function syncGroup(row, items, isOn, onPick) {
    row.textContent = '';
    row.appendChild(el('span', { color: '#8fa9c6', marginRight: '6px' }, items.label));
    items.list.forEach((it) => {
      const b = button(it.label, () => onPick(it.id));
      const on = isOn(it.id);
      if (on) {
        b.style.background = 'rgba(96,190,255,0.34)';
        b.style.borderColor = 'rgba(180,225,255,0.6)';
      }
      row.appendChild(b);
    });
  }

  function refreshPanel() {
    if (!panelOpen) return;
    // 共用动作层没加载时要显式报出来，不能留一片空白让人猜
    if (!A || !A.stats) {
      panel.title.textContent = '动作层未加载';
      panel.stats.textContent = 'assets/pet-actions.js 没加载成功，互动功能不可用。\n检查桌面端目录下 assets 是否完整。';
      panel.actions.textContent = '';
      return;
    }
    const s = A.stats(pet);
    if (!s) return;
    const sleepTag = s.sleeping ? ' · 睡着' : '';
    panel.title.textContent = s.name + '  Lv.' + s.level + ' · 亲密 ' + s.bond + sleepTag;
    const st = window.__lastState || {};
    const taskLine = (st.task && st.task.text) ? ('\n任务 ' + st.task.text) : '';
    const progLine = (st.progress && st.progress.text && st.progress.text !== '空闲') ? ('\n进度 ' + st.progress.text) : '';
    const useLine = (st.usage && st.usage.text) ? ('　用量 ' + st.usage.text) : '';
    const taste = s.favorite ? ('　最爱 ' + s.favorite) : '';
    panel.stats.textContent =
      '经验 ' + s.exp + ' / ' + s.expNeed + '　心情 ' + s.mood + '　饱食 ' + s.hunger + '　精力 ' + s.energy + '\n' +
      '累计 Token ' + (s.tokens >= 1000 ? (s.tokens / 1000).toFixed(1) + 'k' : s.tokens) +
      '　投喂 ' + s.fedCount + '　摸头 ' + s.patCount + taste + '\n' +
      '姿势 ' + s.pose + '　DSH ' + (s.ambient || 'idle') + taskLine + progLine + useLine;
    barFill.style.width = Math.max(0, Math.min(100, (s.exp / Math.max(1, s.expNeed)) * 100)) + '%';

    panel.actions.textContent = '';
    (A ? A.ACTIONS : []).forEach((act) => {
      const label = act.id === 'sleep' ? (s.sleeping ? '叫醒她' : '睡吧') : act.label;
      panel.actions.appendChild(button(label, () => runAction(act.id)));
    });

    syncGroup(panel.artRow, { label: '画风', list: [{ id: 'musume', label: '插画立绘' }, { id: 'pixel', label: '像素' }] },
      (id) => (id === 'pixel') === (prefs.art === 'pixel'), setArt);

    const skins = (W.SKINS && Object.keys(W.SKINS)) || ['deep'];
    syncGroup(panel.skinRow, {
      label: '配色',
      list: skins.map((id) => ({ id: id, label: (W.SKINS[id] && W.SKINS[id].name) || id })),
    }, (id) => pet.skin === id, (id) => runAction('skin-' + id));

    panel.toggleRow.textContent = '';
    panel.toggleRow.appendChild(button((prefs.sound ? '🔊 音效开' : '🔇 音效关'), () => runAction('sound')));
    panel.toggleRow.appendChild(button((prefs.bubble ? '💬 气泡开' : '💬 气泡关'), () => runAction('bubble')));
    panel.toggleRow.appendChild(button((prefs.hud !== false ? '📋 信息栏开' : '📋 信息栏关'), () => runAction('hud')));
    panel.toggleRow.appendChild(button((prefs.speak === true ? '🗣 朗读开' : '🗣 朗读关'), () => runAction('speak')));

    panel.adminRow.textContent = '';
    panel.adminRow.appendChild(button('回右下角', () => runAction('home')));
    panel.adminRow.appendChild(button('重置养成', () => runAction('reset')));
    panel.adminRow.appendChild(button('藏起来', () => runAction('hide')));
    panel.adminRow.appendChild(button('关闭面板', () => openPanel(false)));
    nameInput.value = pet.name;
  }

  function openPanel(force) {
    panelOpen = force === undefined ? !panelOpen : !!force;
    panelEl.style.display = panelOpen ? 'block' : 'none';
    if (panelOpen) refreshPanel();
    reportBox();                 // 面板开合会改变命中范围
    lastBoxKey = '';             // 强制下一帧重新上报
    reportBox();
  }

  if (bridge && bridge.onAction) bridge.onAction((id) => runAction(id));

  // 散步过程：中途会停下来看看风景 / 看看你在不在附近；走完把姿势收回来
  // （否则她会一直保持跑步姿势）
  if (bridge && bridge.onWalkEnd) bridge.onWalkEnd(function (payload) {
    const phase = payload && payload.phase;
    if (phase === 'pause') {
      pet.setMode('idle', 0);
      if (pet.hintArt) pet.hintArt('curious', 2.4);
      pet.say(pet.randomLine(payload && payload.near ? 'walkMeet' : 'walkLook'), 2.2);
      return;
    }
    if (phase === 'resume') { pet.setMode('walk', 0); return; }
    // done（或旧版没有 phase 的载荷）
    pet.setMode('idle', 0);
    pet.say('到了～', 1.8);
    refreshPanel();
  });

  // 开发开关：?panel=1 启动时直接展开面板（便于截图/排查）
  if (/(?:^|[?&])panel=1/.test(location.search)) openPanel(true);

  // 起手不主动设置穿透：主进程的光标轮询会在 80ms 内接管
  if (!window.petBridge) console.warn('[desktop] 没有 preload 桥，交互会不可用');

  /* ------------------------------ 调试显示（?debug=1） ------------------------------ */

  let dbgAcc = 0;
  function renderDebug(dt) {
    if (!DEBUG) return;
    dbgAcc += dt;
    if (dbgAcc < 0.2) return;
    dbgAcc = 0;
    const b = currentBox();
    const st = window.__lastState || {};
    hintEl.textContent = 'box ' + b.x + ',' + b.y + ' ' + b.w + 'x' + b.h +
      ' | over=' + (over ? 1 : 0) + ' down=' + (down ? 1 : 0) + ' drag=' + (dragging ? 1 : 0) +
      ' | ' + (st.state || '-') + (st.stale ? '(stale)' : '') + ' | ' + (pet.pose || '-');
  }

  /* ------------------------------ 场合立绘 + 朗读 ------------------------------ */

  const sessionStart = Date.now();
  let lastOccTag = '';
  let lastOccAt = 0;
  let lastSpoken = '';

  const occ = (window.WhalePetOccasions && window.WhalePetOccasions.pick) ? window.WhalePetOccasions : null;

  /** 节日 / 深夜 / 清早 / 连续工作太久 —— 换一张应景立绘并说一句 */
  function tickOccasions(now) {
    if (!occ) return;
    const o = occ.pick(new Date(), { workedMinutes: Math.round((Date.now() - sessionStart) / 60000) });
    if (!o) return;
    const cool = occ.cooldownMs ? occ.cooldownMs(o.kind) : 3600000;
    if (o.tag === lastOccTag && now - lastOccAt < cool) return;
    lastOccTag = o.tag;
    lastOccAt = now;
    if (pet.hintArt) pet.hintArt(o.hint, 8);
    if (o.line) pet.say(o.line, 4.5);
  }
  tickOccasions(Date.now());
  setInterval(() => tickOccasions(Date.now()), 60000);

  /**
   * 朗读：Chromium 自带 speechSynthesis（走系统语音，零依赖零联网）。
   * 默认关闭，面板里打开；同一句话不重复念。
   */
  function speakIfNeeded() {
    if (prefs.speak !== true) return;
    const synth = window.speechSynthesis;
    if (!synth || !pet.speech) return;
    const text = String(pet.speech.text || '');
    if (!text || text === lastSpoken) return;
    lastSpoken = text;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 1.05;
      u.pitch = 1.3;
      synth.cancel();
      synth.speak(u);
    } catch (e) { /* 系统没装语音包就安静跳过 */ }
  }
  /* ------------------------------ DSH 状态联动 ------------------------------ */

  let lastTokens = 0;
  let lastStateKey = '';

  function applyState(s) {
    if (!s) return;
    window.__lastState = s;
    if (s.state !== lastStateKey) {
      lastStateKey = s.state;
      pet.signal(s.state, s.detail);
    } else {
      pet.signal(s.state, s.detail);      // 持续上报，内部会续期"姿势钉住"
    }
    if (s.tokens > lastTokens) {
      pet.addTokens(s.tokens - lastTokens);
      lastTokens = s.tokens;
    }
    const labels = { idle: '', thinking: 'DSH 正在思考', working: 'DSH 正在干活', approval: 'DSH 等你确认', error: 'DSH 出错了' };
    hintEl.textContent = s.stale ? '' : (labels[s.state] || '');
    document.body.dataset.state = s.state;
    renderHud(s);
  }

  /* ------------------------------ 任务 / 进度 / 用量 HUD ------------------------------ */

  function renderHud(s) {
    if (!hudEl) return;
    if (prefs.hud === false) { hudEl.style.display = 'none'; return; }

    const lines = [];
    const task = (s && s.task && s.task.text) || '';
    const prog = (s && s.progress && s.progress.text) || '';
    const use = (s && s.usage && s.usage.text) || '';
    const idle = (!s || s.state === 'idle') && (!s || !s.progress || !s.progress.steps);
    if (task) lines.push('📋 ' + task);
    if (prog && prog !== task) lines.push('⏱ ' + prog);
    if (use && use !== '还没用量') lines.push('📊 ' + use);

    // 完全空闲且没有用量时不占地方
    if (!lines.length || (idle && !s.tokens)) { hudEl.style.display = 'none'; return; }
    const text = lines.join('\n');
    if (hudEl.textContent !== text) hudEl.textContent = text;
    hudEl.style.display = 'block';
  }

  if (bridge && bridge.onState) bridge.onState(applyState);
  if (bridge && bridge.state) bridge.state().then(applyState).catch(() => {});

  /* ------------------------------ 自己的成长存档 ------------------------------ */

  const KEY = 'whale-pet:desktop:v1';
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && saved.pet) {
        pet.load(saved.pet);
        // ⚠️ 桌面版的"位置"是**窗口位置**，画布内的 x/y 没有意义。
        // 存档里带着窗口版用的画布坐标，load() 会把上面刚设好的居中坐标覆盖掉，
        // 结果她贴到窗口边上——用户按"她该在的位置"点击自然点不到（这就是
        // "桌宠没有鼠标交互"的真凶）。所以读完存档必须重新居中。
        pet.x = window.innerWidth / 2;
        pet.y = pet.floorY();
        pet.vx = 0;
        pet.vy = 0;
        pet.walkTarget = null;
      }
      if (saved && typeof saved.tokens === 'number') lastTokens = saved.tokens;
    }
  } catch (e) { /* file:// 下拿不到存储也不影响 */ }

  let saveAccum = 0;
  setInterval(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ pet: pet.serialize(), tokens: lastTokens })); } catch (e) { /* ignore */ }
  }, 8000);

  window.__whalePetDesktop = {
    get pet() { return pet; },              // reset 之后会被换掉，必须用 getter
    art: art,
    prefs: prefs,
    applyState: applyState,
    runAction: runAction,
    menuSpec: menuSpec,
    openPanel: openPanel,
  };
})();
