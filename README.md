# 喊呗 HeyBay

> 在国外，喊一声就有人。
> 面向海外旅行者与当地华人/留学生的"异地找人"微信小程序。

旅行者把落地后的具体需求喊出来（找搭子、找地陪、借物易物、找住宿、打听本地信息、代购跑腿、翻译陪同、应急求助），当地常驻的华人与留学生顺路接下来。平台不碰资金，用约定单与双向评价提供信誉担保。

## 目录结构

```
heybay/
├── memory-bank/                # AI 协作的文档基座，写代码前必读
│   ├── design-document.md      # V2.0 完整 PRD（产品定位、机制、AI、合规、商业化）
│   ├── tech-stack.md           # 技术栈选型与理由
│   ├── decision-log.md         # 过程性决策与被否决方案
│   ├── implementation-plan.md  # 分步实施计划（待生成）
│   ├── architecture.md         # 每个文件的职责与分层边界（活文档）
│   └── progress.md             # 完成记录、已知欠债、待核实事项（活文档）
├── docs/
│   └── v1-assets/              # V1.0「同路人」原始设计资产（只读，不删改）
├── miniprogram/                # 微信小程序端（V1.0 代码为起点）
├── CLAUDE.md                   # 项目上下文与强制规则，会话自动加载
├── CHANGELOG.md
├── .env.example
└── .gitignore
```

## 工作流

采用文档驱动的 vibe coding 流程：`design-document.md` → `tech-stack.md` → `implementation-plan.md` → 按步实现，每步更新 `architecture.md` 与 `progress.md` 并提交。规则见 `CLAUDE.md`。

## 版本管理

目录与仓库名不带版本号，版本由 git 管理：

- `main` — 主干分支
- tag `v1.0` — 「同路人」V1.0 小程序代码基线
- tag `v2.0` — 「喊呗」V2.0 交付版本
- `CHANGELOG.md` — 版本变更记录（自 v2.0 起维护）

## 当前状态

产品设计完成（见 `memory-bank/design-document.md`），V2.0 开发未启动。V1.0 代码为原生微信小程序，含 5 Tab 自定义 tabBar 与 11 个页面，无后端。

## 关键约束

- 个人开发者主体，微信小程序个人主体**无法上线 UGC 社区类目**，V2.0 以**体验版**形态发布并真实运营（详见 PRD 第 9 章）
- 平台**不代收代付任何资金**，付费类需求线下结算
- 密钥（AI API key、微信 AppSecret）一律走 `.env`，不入库
