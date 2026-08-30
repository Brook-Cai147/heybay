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
| `miniprogram/models/` | 枚举与字段校验，禁止业务代码写字符串字面量 | 已就绪（M1-03） |
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

**M1-02**

- `cloudfunctions/_shared/constants/enums.js`（扩展） — 新增 `ACTOR_ROLE` 四角色（owner / responder / system / admin），**云侧独有**，端侧副本不需要 — 无 — 权限矩阵、后续 handler 的鉴权
- `cloudfunctions/_shared/service/requestStateMachine.js`（扩展） — 新增 `PERMISSIONS` 权限矩阵（12 条边逐条标注允许角色）与 `assertTransitionByActor`；错误码分四种：UNKNOWN_STATUS / UNKNOWN_ACTOR / ILLEGAL_TRANSITION / TRANSITION_FORBIDDEN — `constants/enums.js` — `transitionRequest`（M1-09 起）
- `tests/requestStateMachine.permissions.test.js` — 权限矩阵单测：权限表与转移表键集一致、四角色允许集逐条、14 条越权用例、错误码可区分、48 个格子全覆盖 — 上述两者 — 无

> 权限矩阵的三条细化（比 PRD 更严，已确认）：未选定阶段只有需求方能取消；admin 只能下架、不能代做发布/选定/完成/取消；`done → rated` 已登记 owner+responder 但 M1 不调用。

**M1-03**

- `cloudfunctions/_shared/constants/enums.js`（扩展） — 补齐品类白名单 8 类 + 中文展示名、时效类型、即时时长、报酬类型、可见范围、性别、偏好开关；中文展示名同时供 UI 与 M2 的 AI prompt 使用 — 无 — 全部 service、dao、schema
- `miniprogram/models/enums.js` — 端侧枚举**手抄副本**，除云侧独有的 `ACTOR_ROLE` 外与云侧完全一致；页面禁止写枚举字面量 — 无（不 require 云侧，物理上做不到） — 端侧全部页面与 `models/schema.js`
- `miniprogram/models/schema.js` — 需求单草稿的端侧字段校验，**只为体验不为安全**；返回 `{valid, errors[], hints[]}`，不抛异常；地点写细只给 hint 不拦截；异性偏好键报 `FORBIDDEN_FIELD` — `models/enums.js` — 发布页（M1-15）
- `tests/enumsParity.test.js` — 端云枚举一致性断言 + D-09/D-26 的结构防线（品类恰好 8 类、无交友语义、偏好无异性项、性别含 unset） — 两份 enums — 无

> `schema.js` 不含任何 `wx.*` 调用，因此能在 node 里直接跑；端侧纯逻辑模块一律遵守这一点。

**M1-04**

- `cloudfunctions/_shared/service/bucketing.js` — A/B 分桶纯函数：`bucketOf(openid, experimentKey)` 返回 0~99；手写 FNV-1a 哈希（零依赖、不用 crypto）；openid 非法返回 `null` 不抛错。`BUCKET_COUNT=100` 不可改，改则历史桶号失去可比性 — 无 — `track` 云函数（M1-13）、M2 起的 AI 实验
- `cloudfunctions/_shared/constants/events.js` — 埋点事件字典（PRD 7.3 六类）：18 个事件，10 个 `active` / 8 个 `planned` 占位；`validateEvent` 校验必填参数；**事件名一旦上报即冻结** — 无 — `track` 云函数（M1-13）、各页面埋点
- `tests/bucketing.test.js` — 分桶单测（桶号稳定、0~99、四分位均匀、100 桶无空桶、实验间不相关、非法输入返回 null）+ 事件字典结构性断言 — 上述两者 — 无

> 分桶标识不是事件，而是每条事件的公共字段（`EVENT_COMMON_FIELDS` 里的 `bucket`）。M1 只用默认实验 key，实验配置与对比分析留 M5（D-31）。

**M1-05**

- `cloudfunctions/_shared/service/requestExpiry.js` — 过期判定 `computeExpireAt` / `isExpired`（预约型 +24h、即时型 1h/3h、「今天内」按城市当地日期算到 23:59:59.999）与在架上限 `checkActiveLimit`（默认免费 3 / 会员 10，显式 limit 优先，来源为 `configs`）。**当前时间必须显式传入**，不取系统时间、不查库 — `constants/enums.js` — `cron` 过期扫描（M1-18）、`requestService` 的发布前置校验（M1-09） — `tests/requestExpiry.test.js` 18 个用例
- 时区处理：用 `Intl` 取当地墙上时间（夏令时自动正确），并用「2026-07-01 伦敦必须是 UTC+1」自检运行时 ICU；不支持则抛 `MISSING_TIMEZONE` 并要求改传 `utcOffsetMinutes`，**绝不静默回落到服务器本地时区**

**M1-06**

- `project.config.json`（**已从 `miniprogram/` 移到仓库根**） — 开发者工具项目配置；`miniprogramRoot: "miniprogram/"` + `cloudfunctionRoot: "cloudfunctions/"`。项目根必须上提，因为 `cloudfunctionRoot` 只能指向项目根内部的子目录 — 无 — 开发者工具
- `miniprogram/config/env.js` — 云环境 ID 的**唯一落点**（入库，理由见 D 前提第 6 条）与 `IS_TEST_DATA` 联调开关 — 无 — `app.js`、后续 `services/`
- `miniprogram/app.js` — `onLaunch` 里初始化云能力；基础库不支持或环境 ID 未填时只在控制台报可操作的错，不抛错、不阻断渲染；`globalData.cloudReady` 供页面调云函数前判断 — `config/env.js` — 全部页面
- `cloudfunctions/ping/` — 临时探针：返回 openid / appid / env / 服务端时间 / Node 版本 / ICU 自检结果。不碰数据库、不依赖 `_shared`。**M1-19 删除** — `wx-server-sdk` — 无

> **云函数运行时事实（2026-08-29 实测）**：Node `v16.13.1`，`process.env.TZ` 为空，**ICU 完整、`Intl` 的 IANA 时区可用**（伦敦夏令时偏移实测 +60 分钟）。因此云函数代码**不得使用 Node 18+ 的 API**（如 `structuredClone`、`Array.prototype.findLast`、内置 `fetch`）。

**M1-07**

- `cloudfunctions/ping/index.js`（扩展） — 新增两个临时动作：`dbProbe` 逐集合「写→读回→删」验证云函数侧读写；`seedConfigs` 幂等写入 `configs` 的两条初始配置（按 key 查，有则更新无则新建）。探针文档带 `_isTest` 且写完立即删；两条配置**不带 `_isTest`**（配置不是联调数据，带了会在清理时被误删）。**M1-19 随 `ping` 一起删除，届时 `seedConfigs` 的逻辑需搬进正式的初始化脚本或 admin 云函数** — `wx-server-sdk` — 无
- 无其他代码文件；本步产出是云端的集合、索引与权限配置，清单见下文「集合与索引清单」

> **配置数据一律由云函数写入，不手工敲控制台。** 三个理由：`configs` 权限已收成端侧不可写，云函数是唯一合法写入方，手工写等于绕过自己立的纪律；管理员 openid 直接取调用上下文，避免人肉复制出错；换环境时能一键复现，不靠人记得当初敲了哪些字段。

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
| 用户标识统一用 openid，不立 userId | 集合字段 `openid` / `ownerOpenid` / `responderOpenid`；值只由云函数从 `cloud.getWXContext()` 取，永不接受端侧传入 | D-33 |
| 城市配置暂存 configs，M3 迁 cities | `configs` 的 `city_london` 一条记录（含 `timeZone`，M1-05 过期判定要用）；`cities` 集合延后 | D-34 |
| 仅同性响应靠自填性别校验 | `users.gender` + `_shared/service/responseService.js`（未填性别不能响应） | D-26 / D-09 |
| M1 只收订阅授权不发送 | 已撤回：订阅消息整块归 M4，M1 无相关代码 | D-30 |
| 云环境 ID 入库、密钥不入库 | `miniprogram/config/env.js`（环境 ID）｜密钥只在云函数环境变量 | tech-stack 6.1 |
| 不碰资金 | 无支付相关代码，金额字段仅作线下参考 | D-04 |

## 集合与索引清单（M1-07 建立，2026-08-30 实测通过）

环境 `cloud1-d5gwcen6nb1c1fdeb`。M1 只建以下六个集合，其余集合按里程碑延后（`aiLogs`/`knowledge` 归 M2，`cities` 归 M3，`agreements`/`reviews`/`posts`/`groups`/`reports`/`stats` 更后）。

- `users` — 账号 — 索引：`openid` 升序（**唯一**）
- `requests` — 需求单主体 — 索引：`city + status + expireAt`；`ownerOpenid + status`
- `responses` — 响应 — 索引：`requestId`；`responderOpenid + createdAt`；`requestId + responderOpenid`（**唯一**，幂等的物理保证）
- `statusLogs` — 状态变更审计 — 索引：`requestId + createdAt`
- `events` — 埋点 — 索引：`openid + createdAt`；`name + createdAt`
- `configs` — 配置 — 索引：`key` 升序（**唯一**）

共 10 条索引，字段命名按 D-33。两条唯一索引是业务正确性的物理兜底，不是性能优化：`users.openid` 保证登录建档幂等，`requests + responderOpenid` 保证同一人对同一单只能有一条响应（M1-10 靠捕获唯一键冲突转成「你已响应过」的业务返回）。**事后补唯一索引需要先清脏数据**，所以在写入任何业务数据之前建完。

**权限**：六个集合全部为**「所有用户不可读写」**（此控制台版本的档位名）。控制台横幅注明「云控制台和服务端始终有所有数据读写权限，以下配置仅对小程序端发起的请求有效」——即云函数不受此配置约束。

实测证据（M1-07 验收）：

- 端侧直接 `add` 与直接 `get` 均被拒，`errCode: -502003 database permission denied`。**读也被拒**，因此端侧的一切查询都必须走云函数，没有「只读直连」这条捷径。
- `dbProbe` 六集合全部 `writable: true` / `readBack: true` / `removed: 1`，探针文档已清空。
- 注意：`dbProbe` 全绿**不能**当权限配置的证据——云函数本来就不受该配置约束，集合忘了收紧也一样全绿。权限只能靠端侧的 -502003 反证。

