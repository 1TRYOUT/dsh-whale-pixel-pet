/**
 * 立绘包选择器（独立脚本，不改主渲染器）
 * ---------------------------------------------------------------------------
 * 靠 window.__whalePetDesktop 暴露的公共句柄（art / pet）原地换肤，
 * 所以不需要动 renderer.js 的内部结构。
 *
 * 换肤 = 改 art.base + 用 pet-packs.wrapArt 原地包一层 fileFor。
 * 为了让"换回内置"也干净（避免 wrap 叠加），切换后直接 reload 窗口：
 * 本脚本在启动时读 localStorage 里的选择并应用。
 */
(function () {
  'use strict';

  const P = window.WhalePetPacks;
  const bridge = window.petBridge;
  const host = window.__whalePetDesktop;
  if (!P || !bridge || !host || !host.art) return;      // 环境不对就安静退出

  const KEY = 'whale-pet:desktop:pack:v1';
  const BUILTIN_BASE = '../assets/art/musume/';
  let list = [];

  function currentId() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }
  function setCurrent(id) {
    try { localStorage.setItem(KEY, id || ''); } catch (e) { /* ignore */ }
  }

  /** 启动时把上次选的包装上 */
  function boot() {
    const id = currentId();
    if (!id) return;
    bridge.packs().then((all) => {
      list = Array.isArray(all) ? all : [];
      const found = list.find((p) => p.id === id);
      if (!found) {
        console.warn('[packs] 保存的皮肤不存在，回落到内置：' + id);
        setCurrent('');
        return;
      }
      const r = P.validate(found.manifest);
      if (!r.ok) {
        console.warn('[packs] 皮肤无效，已忽略：' + id + ' → ' + r.errors.join('; '));
        setCurrent('');
        return;
      }
      const art = host.art;
      art.base = '../assets/art/packs/' + id + '/';
      P.wrapArt(art, Object.assign({ base: art.base }, r.pack));
      console.log('[packs] 已启用皮肤：' + r.pack.name);
    }).catch(() => { /* 拿不到列表就当没装包 */ });
  }

  /** 打开原生菜单挑皮肤 */
  function openPicker(all) {
    list = Array.isArray(all) ? all : [];
    const cur = currentId();
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
    bridge.menu({ items: items });
  }

  // 菜单回传：切换就记住选择然后重开窗口（重开能保证不叠加旧的包裹）
  bridge.onAction((id) => {
    if (!id || id.indexOf('pack-') !== 0) return;
    const next = id.slice(5);
    if (next === currentId()) return;
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
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    bridge.packs().then(openPicker).catch(() => openPicker([]));
  });
  document.body.appendChild(btn);

  boot();
})();
