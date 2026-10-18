# 立绘包（Sprite Packs）

一个包 = 一个目录 + `manifest.json`。放进这个目录后**重启桌宠**（或点 🎨）就能选。

```
assets/art/packs/<包名>/
├─ manifest.json
├─ idle.png        ← 必需，其他姿势可不画
└─ work.png
```

```json
{
  "name": "显示用名字",
  "author": "署名",
  "poses": { "idle": "idle.png", "walk": "walk.png", "happy": "happy.png" },
  "hints": { "star": "star.png" },
  "scale": 1
}
```

- **姿势**：`idle` `work` `think` `approve` `happy` `eat` `play` `walk` `drag` `sleep` `sad` `levelup` `groom`
- **表情**：`greet` `star` `praise` `blush` `celebrate` `night` `afk` `deadline` `curious` `eat`
  `foodPudding` `foodCake` `foodDrink` `foodSalad` `gameWin`
  `festivalNewYear` `festivalSpring` `festivalMidAutumn` `festivalHalloween` `festivalChristmas` `valentine`
  `pajama` `dailyCoffee` `dailyStretch`
- **画一半就能用**：包里缺的姿势自动回落到内置立绘。
- **脏数据只让这个包失效**（缺 `idle`、文件名带路径、`poses` 不是对象），不会让她白屏。
- 自检：`node tools/check-packs.mjs`

## ⚠️ 素材授权（唯一一条硬规矩）

**进这个仓库的包必须是你能再分发的素材**：CC0、公共领域、你自己的作品，
或明确允许再分发的授权。**不接受**从游戏里拆的素材、或来源不明/仅限个人使用的立绘
（例如明日方舟、Shimeji 第三方立绘、绝大多数"桌宠项目"里的人物图）。

## 想用不能再分发的素材？走本地通道

把包命名成 `local-` 开头即可，例如 `assets/art/packs/local-xxx/`：

- `.gitignore` 已经忽略 `local-*`，**不会被提交**，也就不涉及再分发
- 功能完全一样，桌宠照常能选、能用
- 请自己确认在本机使用的合法性

这样"我想用某个喜欢的角色"和"仓库授权干净"两件事就不冲突了。