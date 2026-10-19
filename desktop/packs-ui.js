/**
 * 立绘包选择器（独立脚本，不改主渲染器）
 * ---------------------------------------------------------------------------
 * 用 window.__whalePetDesktop 暴露的公共句柄（art）原地换肤，不动 renderer.js 内部。
 *
 * 两个设计决定，都是为了"切换必须成功"：
 *  1. **选择存主进程的文件**（pack.json），不存 localStorage ——
 *     file:// 页面下的 localStorage 不可靠，之前"菜单选了没反应"就是它丢的。
 *  2. **原地换肤，不重开窗口** —— 重开窗口依赖"选择已落盘"这个假设，
 *     假设一破就表现为"切了又跳回内置"。这里先恢复原始 fileFor 再叠加，
 *     所以换多少次都不会叠加包裹。
 *
 * 测试钩子（确定性验证，不用人去点像素）：
 *   DSH_PET_PACK=home   /  ?pack=home   启动即应用指定皮肤
 *   DSH_PET_PACKS=1     /  ?packs=1     启动即弹出选择器
 */
(function () {
  'use strict';

  const P = window.WhalePetPacks;
  const bridge = window.petBridge;
  const host = window.__whalePetDesktop;
  if (!P || !bridge || !host || !host.art) return;      // 环境不对就安静退出

  const BUILTIN_BASE = '../assets/art/musume/';
  const art = host.art;
  // 记下"没有被任何包包裹过"的原始实现，换肤时先复位再包，避免层层叠加
  const originalFileFor = art.fileFor.bind(art);

  const params = new URLSearchParams(location.search);
  const env = (bridge.env && typeof bridge.env === 'object') ? bridge.env : {};
  const forcedPack = (params.get('pack') || env.pack || '').trim();
  const wantPicker = params.get('packs') === '1' || String(env.packs) === '1';

  let list = [];
  let current = '';

  function log(msg) { console.log('[packs] ' + msg); }

  /** 原地换肤：复位 fileFor → 改 base → 包一层；随后异步探针验证图片真能加载 */
  function applyPackNow(id, pack) {
    art.fileFor = originalFileFor;
    if (!id || !pack) {
      art.base = BUILTIN_BASE;
      current = '';
      log('已切回内置立绘');
      return;
    }
    art.base = '../assets/art/packs/' + id + '/';
    P.wrapArt(art, Object.assign({ base: art.base }, pack));
    current = id;
    log('已应用皮肤：' + pack.name + '（id=' + id + '，' +
      (Object.keys(pack.poses).length + Object.keys(pack.hints).length) + ' 张）');

    const probe = new Image();
    probe.onload = () => log('皮肤图片加载成功：' + probe.src.split('/').slice(-2).join('/'));
    probe.onerror = () => {
      log('皮肤图片加载失败，回落内置：' + id);
      if (bridge.setPack) bridge.setPack('');
      applyPackNow('', null);
    };
    probe.src = art.base + (pack.poses.idle || '');
  }

  /** 把 id 解析成"能用的包"，再应用；返回是否成功 */
  function usePack(id, source) {
    if (!id) { applyPackNow('', null); return true; }
    const found = list.find((p) => p.id === id);
    if (!found) { log('找不到皮肤 ' + id + '（' + source + '），回落内置'); applyPackNow('', null); return false; }
    const r = P.validate(found.manifest);
    if (!r.ok) { log('皮肤无效，已忽略：' + id + ' → ' + r.errors.join('; ')); applyPackNow('', null); return false; }
    applyPackNow(id, r.pack);
    return true;
  }

  function boot() {
    bridge.packs().then((all) => {
      list = Array.isArray(all) ? all : [];
      log('发现 ' + list.length + ' 个皮肤包：' + list.map((p) => p.id).join(', '));
      if (forcedPack) {
        // 钩子强制：应用并落盘，方便脚本验证
        if (usePack(forcedPack, 'DSH_PET_PACK')) bridge.setPack(forcedPack);
        return;
      }
      return bridge.getPack().then((saved) => {
        if (!saved) { log('内置画风（没有选任何皮肤）'); return; }
        if (!usePack(saved, 'pack.json')) bridge.setPack('');
        else log('已恢复上次的皮肤选择：' + saved);
      });
    }).catch((e) => log('拿不到皮肤列表：' + (e && e.message)));
  }

  /** 打开原生菜单挑皮肤 */
  function openPicker(all) {
    list = Array.isArray(all) ? all : [];
    const items = [
      { id: 'pack-install', label: '➕ 导入本地皮肤…' },
      { type: 'separator' },
      { id: 'pack-', label: '内置立绘', type: 'checkbox', checked: !current },
    ];
    list.forEach((p) => {
      const ok = P.validate(p.manifest);
      items.push({
        id: 'pack-' + p.id,
        label: (p.manifest && p.manifest.name ? p.manifest.name : p.id) + (ok.ok ? '' : '（无效）'),
        type: 'checkbox',
        checked: current === p.id,
        enabled: ok.ok,
      });
    });
    if (list.length === 0) items.push({ type: 'separator' }, { id: 'pack-', label: '还没装任何皮肤包', enabled: false });
    log('准备弹出选择器：' + list.length + ' 个包（当前 ' + (current || '内置') + '），items=' + items.length);
    try {
      bridge.menu({ items: items });
      log('已把菜单交给主进程（下一步看主进程有没有报错）');
    } catch (e) {
      log('调 bridge.menu 就失败了：' + (e && e.message));
    }
  }

  // 菜单回传：立即原地换肤 + 落盘（不重开窗口）
  bridge.onAction((id) => {
    // 导入本地皮肤：选目录 → 复制成 local-* 包 → 立刻刷新列表
    if (id === 'pack-install') {
      log('打开目录选择器，准备导入本地皮肤…');
      bridge.installPack().then((r) => {
        if (!r || !r.ok) { log('导入未完成：' + ((r && r.error) || '未知原因')); return; }
        log('导入成功：' + r.id + '（' + r.files + ' 个文件）');
        bridge.packs().then((all) => { list = Array.isArray(all) ? all : []; openPicker(list); });
      }).catch((e) => log('导入出错：' + (e && e.message)));
      return;
    }
    if (!id || id.indexOf('pack-') !== 0) return;
    const next = id.slice(5);
    if (next === current) { log('已经是这个皮肤了：' + (next || '内置')); return; }
    log('选择皮肤：' + (next || '内置'));
    const ok = usePack(next, '菜单');
    bridge.setPack(ok ? next : '');
  });

  // 小小的 🎨 按钮：放在她命中框的右上角，这样点击能穿透开关正确落到它上面
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '🎨';
  btn.title = '换皮肤';
  btn.style.cssText = [
    'position:absolute', 'left:284px', 'top:414px', 'width:30px', 'height:26px',
    'padding:0', 'line-height:24px', 'font-size:13px',
    'background:rgba(24,34,48,0.86)', 'color:#dce9f7',
    'border:1px solid rgba(150,200,255,0.30)', 'border-radius:8px',
    'cursor:pointer', 'pointer-events:auto', 'z-index:2147483647',
  ].join(';');
  // ⚠️ 这个按钮落在她的命中框里，renderer 的 pointerdown 会把它当成"摸头"吞掉。
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup'].forEach((type) => {
    btn.addEventListener(type, (e) => { e.stopPropagation(); });
  });
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    bridge.packs().then(openPicker).catch(() => openPicker([]));
  });
  document.body.appendChild(btn);
  // 看门狗：renderer 有"自愈"逻辑会重挂元素，可能把 canvas 盖到按钮上面。
  // 每秒确认按钮仍是 body 的最后一个子元素（= 画在最上层）。
  setInterval(() => {
    try {
      if (btn.parentNode !== document.body || document.body.lastElementChild !== btn) {
        document.body.appendChild(btn);
        log('看门狗：把按钮重新置顶');
      }
    } catch (e) { /* ignore */ }
  }, 1000);

  /* ------------------------------ 拖拽导入皮肤 ------------------------------ */
  // 窗口默认是穿透的，但指针悬停在她身上时主进程会临时关掉穿透，
  // 所以把文件夹拖到她身上时 drop 能落到这里。
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = (e.dataTransfer && e.dataTransfer.files) ? Array.from(e.dataTransfer.files) : [];
    if (!files.length) return;
    const paths = files.map((f) => (bridge.pathForFile ? bridge.pathForFile(f) : '')).filter(Boolean);
    log('拖入 ' + files.length + ' 项，可解析路径 ' + paths.length + ' 个');
    if (!paths.length) { pet.say('拿不到路径…', 2.4); return; }
    let done = 0;
    paths.forEach((p) => {
      bridge.installPackPath(p).then((r) => {
        if (r && r.ok) {
          done++;
          log('拖拽导入成功：' + r.id + '（' + r.files + ' 个文件）');
          pet.say('装上啦～', 2.4);
          bridge.packs().then((all) => { list = Array.isArray(all) ? all : []; openPicker(list); });
        } else {
          log('拖拽导入失败：' + ((r && r.error) || '未知'));
          pet.say('这个装不上…', 2.4);
        }
      }).catch((err) => log('拖拽导入出错：' + (err && err.message)));
    });
  });

  /* --------------------------- 错误捕获（之前没有） --------------------------- */
  window.addEventListener('error', (e) => {
    log('渲染进程异常：' + (e && e.message) + ' @' + (e && e.filename ? e.filename.split('/').pop() : '?') + ':' + (e && e.lineno));
  });
  window.addEventListener('unhandledrejection', (e) => {
    log('未处理的 Promise 拒绝：' + ((e && e.reason && (e.reason.message || e.reason)) || '?'));
  });

  boot();
  if (wantPicker) setTimeout(() => { bridge.packs().then(openPicker).catch(() => openPicker([])); }, 500);

  // 暴露给调试/测试（在 devtools 里可以直接 WhalePetPacksUI.use('home')）
  window.WhalePetPacksUI = { use: (id) => { const ok = usePack(id, '手动'); bridge.setPack(ok ? id : ''); return ok; }, list: () => list, current: () => current };
})();
