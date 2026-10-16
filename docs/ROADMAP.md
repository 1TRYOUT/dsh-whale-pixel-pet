# 路线图：还能加什么（附同类开源项目调研）

> 调研时间 2026-10；星标数为当时快照。原则不变：**不读聊天正文、不改 DSH 内置文件、
> 不破坏点击穿透**。凡是会碰这三条的想法，都要先讨论。

## 一、同类项目都在做什么

| 项目 | 星标 | 值得学的一点 |
|---|---|---|
| [rullerzhou-afk/clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) | 6.4k | 同为"看着 AI 编程代理"的桌宠：**权限气泡**（直接在桌宠上 Allow/Deny，支持全局热键）、**多会话仪表盘**、Telegram/飞书远程批准、可下载主题、跨平台 |
| [ayangweb/BongoCat](https://github.com/ayangweb/BongoCat) | 24k | 最火的桌宠形态：**镜像你的键鼠输入**（纯娱乐向，靠全局钩子） |
| [LorisYounger/VPet](https://github.com/LorisYounger/VPet) | 7.0k | 完整宠物模拟器：**工坊/模组生态**、道具与经济系统、多角色 |
| [isHarryh/Ark-Pets](https://github.com/isHarryh/Ark-Pets) | 1.1k | 拖拽与**贴近交互**（贴边、探头、被拖到窗口边缘的反应）做得细 |
| [legeling/awesome-codex-pet](https://github.com/legeling/awesome-codex-pet) | 1.1k | **社区生成的动作立绘集**——把"美术产能"外包给社区 |
| [LYiHub/pub-local-jarvis](https://github.com/LYiHub/pub-local-jarvis) | 513 | 屏幕与音频感知、主动搭话（与我们的隐私立场冲突，仅记录） |
| [Yi-111-a/dsh-jingling](https://github.com/Yi-111-a/dsh-jingling) | 55 | **同生态竞品**（MIT）：**可审阅记忆**（只记你确认过的，能改能忘）、**角色卡 V2 导入**、把安全边界写在 README 里 |
| [momori777/Artemis](https://github.com/momori777/Artemis) · [funnycups/petto](https://github.com/funnycups/petto) · [x380kkm/Live2DPet](https://github.com/x380kkm/Live2DPet) | 391 / 119 / 87 | Live2D + **语音（VOICEVOX/TTS）**路线 |

**我们已独有、不必追的**：双形态（窗口内 + 独立桌面窗口）、零侵入（指针全透 + 命中才接管）、
不依赖样式表、纯 reducer 状态收集、动作语义单实现、185 项带对照实验的测试。

---

## 二、立刻能做（低成本、高感知）

### 1. 把 40+ 张没用上的立绘接进来 ★ 最划算

现有 92 张立绘里，`weather-*` / `festival-*` / `meme-*` / `daily-*` **全部闲置**。零新资源，只加"何时切哪张"的规则：

- **节日**：按日期自动上 `festival-halloween / christmas / mid-autumn / spring`
- **作息**：清早 `daily-coffee`、深夜 `night` / `daily-pajama`
- **情绪事件**：报错 `meme-cry`、升级 `work-celebrate`、长任务成功 `game-win`、被夸 `meme-kyun`
- **摸鱼提醒**：连续工作超 2 小时 → `daily-stretch` + 「要不要站起来走走？」

改动：`assets/art-musume.js` 的 `HINT` + 一个新的"场合判定"纯函数。可单测。

### 2. 让她说话（TTS，零依赖零联网）

Electron 渲染进程里就有 `speechSynthesis`（走 Windows 自带语音，含中文），不需要任何 API：

- 面板里加「朗读」开关；开启后她说台词时同时念出来
- 摸头/投喂/升级各配一句，语气自己写

改动：`desktop/renderer.js`（约 20 行）+ 一个偏好项。顺带解决"桌面版没有声音"的观感问题。

### 3. 全局热键

`globalShortcut`：`Ctrl+Alt+W` 叫出来/藏起来、`Ctrl+Alt+P` 开面板、`Ctrl+Alt+F` 投喂。
**待审批时自动把她顶到最前**（这是最有用的一档）。

### 4. 陪伴报告

「本周陪你 12 小时 · 摸头 340 · 投喂 12 · 最长连续 95 分钟」。
数据大多已经在记（tokens / totalPat / totalFeed），只需加一个在线时长累加 + 面板里一张卡。

---

## 三、值得做（中等成本，价值明确）

### 5. 在桌宠上直接批准/拒绝（对标 clawd-on-desk 的权限气泡）

**最实用的一条**：现在待审批时她只会举沙漏，你还得切回 DSH 窗口点确认。
做法：检到 `approval` 状态时，在面板/气泡里给出「允许 / 拒绝」按钮，点了就等价于点宿主的那个按钮
（只在你点击时动作，不做任何自动批准）。注意：这是**替用户点宿主按钮**，要在 README 里写明。

### 6. 多会话仪表盘

宿主的 `agents.list()` 能拿到所有活跃会话，客户端有 `uiWorkspace.openSession(id)` 可以一键切过去。
做成面板里的一列（会话名 + 忙闲 + 当前任务），点一下跳过去。

### 7. 待办清单与进度百分比

DSH 的 `todo` 工具会写一份清单。把它读出来显示成 `3/7 完成` + 进度条，比现在的"第 N 步"直观得多。
（读的是结构化任务标题，不是聊天正文。）

### 8. 立绘包 / 角色包（把美术产能外包给社区）

现在换画风只能"立绘 / 像素"二选一。定义一份 `assets/art/packs/<名字>/manifest.json`
（姿势 → 文件名 + 可选缩放/锚点），就能：

- 社区做自己的角色（对标 VPet 工坊、clawd 的主题下载）
- 我们已有的 92 张按"节庆包 / 日常包"拆开挂载
- 美术层已经隔离好了（`art-musume.js` 只做"状态 → 文件"映射），改造成本可控

### 9. 记忆（可审阅）

对标 dsh-jingling 的做法，但**必须**遵守它的边界：**先提议、你确认、可编辑、可遗忘**。
例如她问「要不要记住你在做小说管理器？」，你点确认才写入；面板里能看能删。
不做"偷偷攒关系档案"那套。

---

## 四、建议不做（说明理由）

| 想法 | 为什么不做 |
|---|---|
| 屏幕 / 摄像头 / 麦克风 / 剪贴板感知 | 与项目"零侵入 + 不读聊天正文"的立场直接冲突。要做得是**另一个项目**，且必须默认关闭 |
| 全局键盘钩子（BongoCat 式镜像输入） | 需要低层钩子，杀软敏感、隐私观感差。窗口内的键盘联动已经有了，够用 |
| 内置 LLM 让她自己聊天 | 开销与"这是 DSH 的桌宠"定位冲突；DSH 本身就是那个大脑，她只该**反映**它 |
| 自动批准权限 | 安全红线。只提供"你点一下"的快捷方式，绝不代替你决策 |
| Live2D / VRM | 属于换一套美术后端，工作量等于重做一个渲染层。等 §8 的包机制成熟后再考虑把它作为一种 pack 类型 |

---

## 五、如果只能做三件

1. **§1 立绘接入**（零新资源、立刻让她"活"起来）
2. **§5 桌宠上批准/拒绝**（真正省你的事）
3. **§2 TTS**（桌面形态的观感补齐）

§7 待办进度与 §6 多会话仪表盘紧随其后。
