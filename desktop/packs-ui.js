/**
 * 立绘包选择器（独立脚本，不改主渲染器）
 * ---------------------------------------------------------------------------
 * 靠 window.__whalePetDesktop 暴露的公共句柄（art / pet）原地换肤，
 * 所以不需要动 renderer.js 的内部结构。
 *
 * 换肤 = 改 art.base + 用 pet-packs.wrapArt 原地包一层 fileFor。
 * 为了让"换回内置"也干净（避免 wrap 叠加），切换后直接 reload 窗口：
 * 本脚本在启动时读 localStorage 里的选择并应用。
 *
 * 测试钩子（确定性验证，不用人去点像素）：
 *   ?pack=home   启动即应用指定皮肤      （也可用环境变量 DSH_PET_PACK）
 *   ?packs=1     启动即弹出选择器        （也可用环境变量 DSH_PET_PACKS=1）
 * 两者都会往 console 打日志；配合 electron --enable-logging=stderr 可直接断言。
 */
(function () {
  'use strict';

  const P = window.WhalePetPacks;
  const bridge = window.petBridge;
  const host = window.__whalePetDesktop;
  if (!P || !bridge || !host || !host.art) return;      // 环境不对就安静退出

  const KEY = 'whale-pet:desktop:pack:v1';
  const FALLBACK_FLAG = 'whale-pet:desktop:pack-fallback';
  const BUILTIN_BASE = '../assets/art/musume/';
  let list = [];

  // ---- 测试钩子：URL 参数优先，其次是 preload 透传的环境变量 ----
  const params = new URLSearchParams(location.search);
  const env = (bridge.env && typeof bridge.env === 'object') ? bridge.env : {};
  const forcedPack = (params.get('pack') || env.pack || '').trim();
  const wantPicker = params.get('packs') === '1' || String(env.packs) === '1';

  function log(msg) { console.log('[packs] ' + msg); }
  function currentId() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }
  function setCurrent(id) {
    try { localStorage.setItem(KEY, id || ''); } catch (e) { /* ignore */ }
  }

  /**
   * 把包应用到已存在的美术层上；并异步验证"包里的 idle 图到底能不能加载"。
   * 加载失败 → 清掉选择、回落内置（只重载一次，避免死循环）。
   */
  function applyPack(id, pack) {
    const art = host.art;
    art.base = '../assets/art/packs/' + id + '/';
    P.wrapArt(art, Object.assign({ base: art.base }, pack));
    log('已应用皮肤：' + pack.name + '（id=' + id + '，共 ' + (Object.keys(pack.poses).length + Object.keys(pack.hints).length) + ' 张）');

    const probe = new Image();
    probe.onload = () => log('皮肤图片加载成功：' + probe.src.split('/').slice(-2).join('/'));
    probe.onerror = () => {
      log('皮肤图片加载失败，回落内置：' + id);
      setCurrent('');
      let tried = false;
      try { tried = sessionStorage.getItem(FALLBACK_FLAG) === '1'; sessionStorage.setItem(FALLBACK_FLAG, '1'); } catch (e) { /* ignore */ }
      if (tried) {                          // 已经回落过一次还失败 → 保持内置，别再重载
        art.base = BUILTIN_BASE;
        log('放弃皮肤，停在内置画风（不再重载）');
        return;
      }
      try { location.reload(); } catch (e) { /* ignore */ }
    };
    probe.src = art.base + (pack.poses.idle || '');
  }

  /** 启动：先看强制指定，再看上次的选择 */
  function boot() {
    const wanted = forcedPack || currentId();
    if (!wanted) { log('内置画风（没有选任何皮肤）'); return; }
    bridge.packs().then((all) => {
      list = Array.isArray(all) ? all : [];
      log('发现 ' + list.length + ' 个皮肤包：' + list.map((p) => p.id).join(', '));
      const found = list.find((p) => p.id === wanted);
      if (!found) {
        log('找不到皮肤 ' + wanted + '，回落内置');
        setCurrent('');
        return;
      }
      const r = P.validate(found.manifest);
      if (!r.ok) {
        log('皮肤无效，已忽略：' + wanted + ' → ' + r.errors.join('; '));
        setCurrent('');
        return;
      }
      if (forcedPack) setCurrent(forcedPack);
      applyPack(wanted, r.pack);
    }).catch((e) => log('拿不到皮肤列表：' + (e && e.message)));
  }

  /** 打开原生菜单挑皮肤 */
  function openPicker(all) {
    list = Array.isArray(all) ? all : [];
    const cur = forcedPack || currentId();
    const items = [{ id: 'pack-', label: '内置立绘', type: 'checkbox', checked: !cur }];
    list.forEach((p) => {
      const ok = P.validate(p.manifest);
      items.push({
        id: 'pack-' + p.id,
        label: (p.manifest && p.manifest.name ? p.manifest.name : p.id) + (ok.ok ? '' : '（无效）'),
        type: 'checkbox',
        checked: cur === p.id,
        enabled: ok.ok,
      });
    });
    if (list.length === 0) items.push({ type: 'separator' }, { id: 'pack-', label: '还没装任何皮肤包', enabled: false });
    log('选择器已弹出：' + list.length + ' 个包（当前 ' + (cur || '内置') + '）');
    bridge.menu({ items: items });
  }

  // 菜单回传：切换就记住选择然后重开窗口（重开能保证不叠加旧的包裹）
  bridge.onAction((id) => {
    if (!id || id.indexOf('pack-') !== 0) return;
    const next = id.slice(5);
    if (next === currentId()) return;
    log('选择皮肤：' + (next || '内置'));
    setCurrent(next);
    setTimeout(() => { try { location.reload(); } catch (e) { /* ignore */ } }, 60);
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
    'cursor:pointer', 'pointer-events:auto', 'z-index:5',
  ].join(';');
  // ⚠️ 这个按钮落在她的命中框里，renderer 的 pointerdown 会把它当成"摸头"吞掉。
  // 所以在按钮上拦住指针事件，别让它们冒泡到 window。
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup'].forEach((type) => {
    btn.addEventListener(type, (e) => { e.stopPropagation(); });
  });
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    bridge.packs().then(openPicker).catch(() => openPicker([]));
  });
  document.body.appendChild(btn);

  boot();
  if (wantPicker) setTimeout(() => { bridge.packs().then(openPicker).catch(() => openPicker([])); }, 500);
})();
