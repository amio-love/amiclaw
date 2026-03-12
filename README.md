# AmiClaw 🦀

**AmiClaw** (`claw.amio.fans`) is a platform for human-AI collaborative games — where you and your AI work together in real-time to solve challenges.

> **"Keep Us Human"** — The fun isn't in the AI solving problems alone. It's in the two of you figuring it out together.

---

## 🎮 BombSquad — First Game on the Platform

**BombSquad** (`bombsquad.amio.fans`) is the first AmiClaw game, inspired by *Keep Talking and Nobody Explodes*.

**You are the bomb defuser.** Your AI is the manual expert.

- You see a 2D bomb panel in your browser — wires, dials, buttons, keypads
- Your AI reads a complex YAML manual via a URL you share
- You describe what you see by voice; your AI tells you what to do
- Race the clock and compete on the global leaderboard

**No AI integration required.** Communication happens entirely through your physical voice — works with Claude, ChatGPT, Gemini, or any voice-capable AI tool.

### How It Works

```
You (browser) ←── voice ──→ AI (reads manual URL)
     ↓                              ↓
  See puzzle              Look up rules in YAML
  Click wires             Give instructions by voice
  Beat the clock          Help you improve each run
```

### Roguelike Daily Challenge

- Every day, a new manual is published
- The manual stays **fixed all day** — your AI can master it across runs
- Every time you click "Start", a **new random puzzle** is generated from that day's rules
- Unlimited attempts — leaderboard records your **personal best**
- Debrief with your AI after each run, refine your strategy, run again

### Features (MVP)

- 4 puzzle modules: Wire Routing, Symbol Dial, Button, Keypad
- Practice mode (fixed puzzle, no leaderboard)
- Daily challenge mode (random puzzle, global leaderboard)
- Anti-human manual rendering (YAML for AI, obfuscated for humans)
- Post-run summary for AI-assisted debriefing
- Standard prompt + skills file templates

---

## 🛠 Tech Stack

| Component | Technology |
|-----------|-----------|
| Game SPA | React + Vite + TypeScript |
| Puzzle rendering | SVG |
| Puzzle generation | Frontend JS (seed-based RNG) |
| Manual pages | Static HTML + YAML |
| Leaderboard API | Cloudflare Workers + KV |
| Hosting | Cloudflare Pages |

---

## 📁 Project Structure

```
amiclaw/
├── docs/                    # Design documents
│   ├── AmiClaw_GameDesign.md
│   ├── AmiClaw_MVP.md
│   └── plans/               # Development plans
├── packages/
│   ├── game/                # BombSquad React SPA
│   ├── manual/              # Manual static pages + YAML data
│   └── api/                 # Cloudflare Workers leaderboard API
├── shared/                  # Shared TypeScript types
└── prompts/                 # Prompt & skills templates
```

---

## 🚀 Development

> Coming soon — development has not started yet. See [`docs/plans/`](./docs/plans/) for the full implementation plan.

---

## 🔗 Links

- Platform: [claw.amio.fans](https://claw.amio.fans)
- BombSquad: [bombsquad.amio.fans](https://bombsquad.amio.fans)
- Part of the [AMIO](https://amio.fans) ecosystem

---

---

# AmiClaw 🦀（中文）

**AmiClaw**（`claw.amio.fans`）是一个人机协作游戏平台——你和你的 AI 在游戏中实时配合，共同解决挑战。

> **"Keep Us Human"** — 好玩的不是 AI 独自解题，而是你们俩一起摸索、一起进步。

---

## 🎮 BombSquad — 平台首款游戏

**BombSquad**（`bombsquad.amio.fans`）是 AmiClaw 平台的第一款游戏，灵感来自《Keep Talking and Nobody Explodes》。

**你是拆弹手，你的 AI 是读手册的专家。**

- 你在浏览器里看到一个 2D 炸弹面板——线路、转盘、按钮、键盘
- 你的 AI 通过你分享的链接读取一份复杂的 YAML 操作手册
- 你用语音描述你看到的内容，AI 告诉你该怎么操作
- 与时间赛跑，冲击全球排行榜

**零 AI 集成。** 沟通完全通过你的物理语音进行——兼容 Claude、ChatGPT、Gemini 或任何支持语音对话的 AI 工具。

### 游戏流程

```
你（浏览器）←── 语音 ──→ AI（读手册链接）
     ↓                        ↓
  看到谜题              在 YAML 中查找规则
  点击线路              用语音给出操作指令
  与时间赛跑            帮助你每局都进步
```

### Roguelike 每日挑战

- 每天发布一份新手册
- 手册**当天保持不变**——你的 AI 可以在多次挑战中越来越熟悉规则
- 每次点击「开始」，系统**随机生成新谜题**（基于当日手册规则）
- 不限挑战次数——排行榜记录你当天的**最佳成绩**
- 每局结束后和 AI 一起复盘，优化策略，立刻再来一局

### MVP 功能清单

- 4 个谜题模块：线路（Wire）、密码盘（Dial）、按钮（Button）、键盘（Keypad）
- 练习模式（固定谜题，不计排行）
- 每日挑战模式（随机谜题，全球排行榜）
- 手册反人类渲染（AI 看清晰 YAML，人类看模糊渲染）
- 赛后结果摘要（可发给 AI 复盘）
- 标准 prompt 模板 + 示例 skills 文件

---

## 🛠 技术栈

| 组件 | 技术选型 |
|------|---------|
| 游戏前端 | React + Vite + TypeScript |
| 谜题渲染 | SVG |
| 谜题生成 | 前端 JS（种子随机数） |
| 手册网页 | 静态 HTML + YAML |
| 排行榜 API | Cloudflare Workers + KV |
| 托管 | Cloudflare Pages |

---

## 📁 项目结构

```
amiclaw/
├── docs/                    # 设计文档
│   ├── AmiClaw_GameDesign.md
│   ├── AmiClaw_MVP.md
│   └── plans/               # 开发计划
├── packages/
│   ├── game/                # BombSquad React SPA
│   ├── manual/              # 手册静态页面 + YAML 数据
│   └── api/                 # Cloudflare Workers 排行榜 API
├── shared/                  # 共享 TypeScript 类型定义
└── prompts/                 # Prompt 与 skills 模板
```

---

## 🚀 开发说明

> 开发尚未开始，敬请期待。完整开发计划见 [`docs/plans/`](./docs/plans/)。

---

## 🔗 相关链接

- 平台首页：[claw.amio.fans](https://claw.amio.fans)
- BombSquad：[bombsquad.amio.fans](https://bombsquad.amio.fans)
- 隶属 [AMIO](https://amio.fans) 生态
