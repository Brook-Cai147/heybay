# 架构说明（Architecture）

> **活文档。** 记录代码库里每个目录与文件的职责，以及关键的分层边界。
> 目的：让任何一个新会话在写代码前就知道"这段逻辑该放哪"，避免重复实现、避免把业务逻辑写错层。
> **更新时机：`implementation-plan.md` 的每一步完成时都要更新本文件**，不要攒到里程碑。

## 分层铁律

```
miniprogram/            客户端。只做展示、交互、本地校验。不做权限判断，不信任本地状态。
cloudfunctions/*/       云函数入口 (handler)。只做参数校验、鉴权、调用 service。不写业务逻辑。
cloudfunctions/_shared/service/   全部业务逻辑。不直接调用云数据库 API。
cloudfunctions/_shared/dao/       唯一接触云数据库 API 的地方。不写业务判断。
```

违反这四条中任意一条，都要在代码评审时退回。理由见 `tech-stack.md` 第 2、3 节。

## 目录职责

| 路径 | 职责 | 状态 |
|---|---|---|
| `miniprogram/` | 微信小程序端（V1.0 代码为起点，待按 PRD 6.1/6.2 重构） | V1.0 原样 |
| `miniprogram/pages/` | 页面。V1.0 为 11 个旧页面，需按 PRD 6.2 的 P0 清单重做 | 待重构 |
| `miniprogram/custom-tab-bar/` | 自定义底部 Tab，需改为 PRD 6.1 的新五 Tab | 待重构 |
| `miniprogram/models/` | 枚举与字段校验，禁止业务代码写字符串字面量 | 未创建 |
| `miniprogram/services/` | 云函数调用封装，一处一个方法 | 未创建 |
| `miniprogram/components/` | 复用组件（需求卡片、信任徽章、响应列表项） | 未创建 |
| `cloudfunctions/` | 云函数 | 未创建 |
| `cloudfunctions/_shared/ai/` | 能力注册表、Prompt 模板、模型客户端、编排器；AI 只有 `aiGateway` 一个出口 | 未创建 |
| `tests/` | `node:test` 单测，只覆盖 `tech-stack.md` 第 10 节的六块纯逻辑；`tests/fixtures/` 放黄金标注集 | 未创建 |
| `scripts/` | 一次性/周期性脚本（AI 离线评测等），不参与运行时，不计入 `npm test` | 未创建 |
| `memory-bank/` | AI 协作的文档基座（PRD、选型、决策、计划、架构、进度） | 就绪 |
| `docs/v1-assets/` | V1.0「同路人」历史资产，只读不删改 | 冻结 |

## 文件清单

> 每完成一步就在此追加。格式：`路径` — 职责一句话 — 依赖谁 — 被谁依赖。

**M1-01**

- `package.json` — 仅承载 `node:test` 的运行入口（`scripts.test` 用 glob，零依赖） — 无 — `tests/` 下全部单测
- `cloudfunctions/_shared/constants/enums.js` — 全项目枚举的**权威副本**（云侧），M1-01 只含九个需求单状态 — 无 — 状态机、后续全部 service 与 dao、端侧 `models/enums.js`（手工同步）
- `cloudfunctions/_shared/service/requestStateMachine.js` — 需求单状态转移表与合法性判定（纯逻辑，不接触数据库）；`canTransition` 返回布尔，`assertTransition` 非法即抛（带 `code`/`from`/`to`） — `constants/enums.js` — `transitionRequest`（M1-09 起）、角色权限矩阵（M1-02）
- `tests/requestStateMachine.transitions.test.js` — 转移表单测：12 条合法边逐条、69 条非法组合、终态无出边、未知状态被拒、转移表冻结 — 上述两者 — 无

## 关键决策的代码落点

| 设计决策 | 代码落点 | 出处 |
|---|---|---|
| 前端不可信，状态变更单一入口 | `cloudfunctions/requestFlow/`，含显式转移表 | tech-stack 第 3 节 / D-20 |
| AI 统一网关（额度、缓存、降级、记账） | `cloudfunctions/aiGateway/` + `_shared/ai/registry.js`（能力注册表） | tech-stack 6.1 |
| 推荐必须可解释，禁止无理由推荐 | `_shared/service/matchService.js`（代码打分 + 依据字段）→ 模型只把依据写成人话 | PRD 5.4 / M2-11 |
| 自主性阶梯 L0/L1，L3 永不做 | `miniprogram/pages/assistant/` + `_shared/service/inviteService.js` | D-14 / M2-14 |
| 零用户阶段用离线评测替代 A/B | `scripts/evalParseRequest.js` + `tests/fixtures/parseRequestGolden.json` | D-31 / M2-15 |
| 三层内容安全 | `cloudfunctions/moderation/` | tech-stack 6.3 |
| A/B 分桶（M1 只埋字段，实验运营留 M5） | `cloudfunctions/track/` + `_shared/service/bucketing.js` | D-21 / D-31 |
| 管理后台做进小程序 | `miniprogram/pages/admin/` + openid 白名单 | D-22 |
| 端云枚举双份，云侧权威 | `cloudfunctions/_shared/constants/enums.js`（权威）+ `miniprogram/models/enums.js`（副本）+ parity 单测 | D-27 |
| 仅同性响应靠自填性别校验 | `users.gender` + `_shared/service/responseService.js`（未填性别不能响应） | D-26 / D-09 |
| M1 只收订阅授权不发送 | 已撤回：订阅消息整块归 M4，M1 无相关代码 | D-30 |
| 云环境 ID 入库、密钥不入库 | `miniprogram/config/env.js`（环境 ID）｜密钥只在云函数环境变量 | tech-stack 6.1 |
| 不碰资金 | 无支付相关代码，金额字段仅作线下参考 | D-04 |
