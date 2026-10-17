/**
 * 桌宠窗口的预加载桥：渲染进程只能通过这些受控方法跟主进程说话。
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  /** 整窗是否穿透鼠标（保留接口；正常路径由主进程按光标位置自动判定） */
  setIgnoreMouse: (ignored) => ipcRenderer.send('pet:ignore', ignored),
  /** 上报她当前的大致包围盒（窗口内坐标），主进程用它判断指针有没有落在她身上 */
  setBox: (box) => ipcRenderer.send('pet:box', box),
  /** 拖动期间锁住命中，避免指针跑出包围盒导致拖拽中断 */
  setDragLock: (locked) => ipcRenderer.send('pet:drag-lock', locked),
  /** 拖动 = 移动窗口 */
  drag: (dx, dy) => ipcRenderer.send('pet:drag', { dx, dy }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  /** 列出可用立绘包（主进程扫 assets/art/packs） */
  packs: () => ipcRenderer.invoke('pet:packs'),
  /**
   * 测试钩子用的环境变量透传（脚本可确定性验证，不用合成鼠标去点像素）。
   * 沙箱里 process.env 不可用时返回空值——那就只剩 URL 参数那条路。
   */
  env: (() => {
    try {
      const e = (typeof process !== 'undefined' && process.env) ? process.env : {};
      return { pack: e.DSH_PET_PACK || '', packs: e.DSH_PET_PACKS || '' };
    } catch (err) { return { pack: '', packs: '' }; }
  })(),
  /** 散步：让主进程把整个窗口平移过去（spec: {dir, spot}） */
  walk: (spec) => ipcRenderer.send('pet:walk', spec),
  onWalkEnd: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('pet:walk-end', handler);
    return () => ipcRenderer.removeListener('pet:walk-end', handler);
  },
  /** 请宿主批准当前待审批项（只允许一次；真正点击由 DSH 页面里的客户端半边执行） */
  approve: () => ipcRenderer.send('pet:approve'),
  hide: () => ipcRenderer.send('pet:hide'),
  quit: () => ipcRenderer.send('pet:quit'),
  resetPos: () => ipcRenderer.send('pet:reset-pos'),
  /** 弹出原生右键菜单；点了哪一项通过 onAction 回传 id */
  menu: (spec) => ipcRenderer.send('pet:menu', spec),
  onAction: (cb) => {
    const handler = (_e, id) => cb(id);
    ipcRenderer.on('pet:action', handler);
    return () => ipcRenderer.removeListener('pet:action', handler);
  },
  state: () => ipcRenderer.invoke('pet:state:get'),
  onState: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('pet:state', handler);
    return () => ipcRenderer.removeListener('pet:state', handler);
  },
});
