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

**M1-08**

- `scripts/syncShared.js` — 把 `cloudfunctions/_shared` 复制进每个云函数目录（`npm run sync`）。**云函数间共享 `_shared` 的唯一方式**，详见下文「_shared 的共享方式」 — 无 — 上传云函数前必跑
- `cloudfunctions/_shared/dao/db.js` — 集合名登记表 + `getDb` / `getCommand` / `serverDate` / `NOT_DELETED` / 时间戳补齐。**dao 内部专用**，service 不 require 它 — `wx-server-sdk` — 全部 dao
- `cloudfunctions/_shared/dao/tx.js` — `startTransaction()`。单独一个文件，避免 service 为了开事务而 require 整个 `db.js`（那样很容易顺手写出 `db.collection(...)` 越层） — `wx-server-sdk` — `requestService`
- `cloudfunctions/_shared/dao/{users,requests,responses,statusLogs,configs}.js` — 只做数据存取，**不含任何业务判断**；写方法统一补 `createdAt`/`updatedAt`、支持 `_isTest`；查询默认排除软删除 — `dao/db.js` — 各 service
- `cloudfunctions/_shared/constants/errors.js` — 统一返回形状 `{ ok, ... }` / `{ ok: false, code, message }` + 业务错误码表 + `fail()`。**业务失败不是异常** — 无 — 全部 service 与 handler
- `cloudfunctions/_shared/service/dispatch.js` — handler 骨架 `createHandler(actions)`：取 openid、校验 action、分发、把异常翻译成业务返回。抽出来是因为三个 handler 各写一遍 try-catch 迟早漏一个，漏了就是数据库原始报错泄到用户界面 — `errors.js`、`requestStateMachine.js` — 全部云函数入口
- `cloudfunctions/_shared/service/userService.js` — 登录建档（幂等）、更新常驻城市与性别、`getMe`、`publicUser` 字段裁剪。**不采集手机号**（D-26） — `dao/users.js` — `login` 云函数、`requestService`
- `cloudfunctions/login/` — 三个 action：`login` / `updateProfile` / `getMe` — `_shared` — `services/user.js`
- `miniprogram/services/cloud.js` — 端侧调云函数的**唯一出口**：注入 `isTest`、把 `{ ok: false }` 转成带 code 的 Error（页面才能原样展示业务提示）、区分网络失败与业务失败 — `config/env.js` — 全部 `services/`
- `miniprogram/services/user.js` — 一个云函数动作对应一个方法，页面不直接调云函数 — `services/cloud.js` — 页面

> **_shared 的共享方式（本步定下，后续云函数一律照此办理）**：**复制**。开发者工具上传云函数时只打包该函数目录内部的文件，`require('../_shared/...')` 在云端不存在。软链在 Windows 需管理员权限或开发者模式，个人机上不可靠；npm `file:` 本地依赖要在每个函数维护依赖再让云端安装，链路更长更易碎。副本由 `.gitignore` 排除，**真源只有 `cloudfunctions/_shared`**。代价：改共享代码后必须重新 `npm run sync` 再上传，否则云端跑的是旧副本 —— 这是本方案唯一的坑。

**M1-09**

- `cloudfunctions/_shared/service/requestValidator.js` — 服务端**独立**字段校验（不复用端侧 `schema.js`：端侧那份为体验、这份为安全），并拦住 PRD 5.4 的四类字段被标记为 AI 生成（`fieldSources.<field> === 'ai'` 且字段有值即拒，不做"清空后继续"的宽容处理） — `constants/enums.js`、`errors.js` — `requestService`
- `cloudfunctions/_shared/service/requestService.js` — 需求单业务规则：`create`（draft→open，含城市开城判断、在架上限、过期时间计算）、`applyTransition`（**状态变更的唯一通道**）、`resolveActorRole`、`transitionRequest`、`getDetail` — 状态机 / 过期判定 / validator / 四个 dao — `requestFlow`、`responseFlow`、M1-18 的 cron
- `cloudfunctions/requestFlow/` — 三个 action：`create` / `transitionRequest` / `getDetail` — `_shared` — `services/request.js`
- `miniprogram/services/request.js` — `create` / `transition` / `cancel` / `getDetail` — `services/cloud.js`、`models/enums.js` — 发布页、详情页

> **状态变更用数据库事务**：`applyTransition` 在一个事务内完成「读需求单（加锁）→ 过状态机 → 更新状态 → 写 statusLogs → 提交」。这满足了"不允许状态变了却没有审计"，并白拿一个好处：并发的两次「选定」只有一次能成，另一次会看到已变更的状态而被状态机拒绝。

**M1-10**

- `cloudfunctions/_shared/service/responseService.js` — 响应规则：`submit`（三类拒绝 + 幂等 + 首个响应触发 open→responded）、`list`（需求方看全部，其他人只看自己那条）。幂等三道防线：预查询给友好提示 → 唯一索引物理保证 → 冲突后改读兜住并发 — `dao/responses.js`、`requestService.applyTransition` — `responseFlow`
- `cloudfunctions/responseFlow/` — 两个 action：`submit` / `list` — `_shared` — `services/response.js`
- `miniprogram/services/response.js` — `submit` / `list` — `services/cloud.js` — 详情页
- `cloudfunctions/_shared/constants/enums.js` + `miniprogram/models/enums.js` — 新增 `RESPONSE_SOURCE`（push / community / invite / broadcast，PRD 5.3 的四条分发路径），两侧同步并纳入 parity 断言（D-27）

> 「仅同性响应」的校验拆到两处：**发布时**若开了开关而本人性别未填即拒（提示去补全），**响应时**按 D-26 判断未填/不符。把一半挪到发布时，是为了不让响应者替发单人的疏漏买单。

**M1-11**

- `cloudfunctions/_shared/service/requestService.js`（扩展 `selectResponder`）— responded→matched，选定不可逆；重复选定同一人幂等（不再转移、不再写日志），选定另一人明确拒绝；`matchedResponseId` / `matchedResponderOpenid` / `matchedAt` 随状态一起写 — `dao/responses.js`（新增 `findById`、`markSelected`）— `requestFlow`
- `cloudfunctions/_shared/dao/responses.js`（扩展）— `markSelected(requestId, selectedId)`：先把该单全部响应置未选中、再把指定那条置选中，**顺序不可反** — `dao/db.js` — `requestService`

> "不可逆"是服务端约束而非前端提示：`matched` 没有回到 `responded` 的边，状态机会拒绝；并发的两次选定也只有一次能过（事务内读加锁）。选中标记在状态提交**之后**才刷 —— 标记只影响列表展示，失败不该回滚状态。

**M1-12**

- `cloudfunctions/_shared/service/requestService.js`（扩展 `confirmDone` / `cancel`）— 完成按角色分别记 `ownerDoneAt` / `responderDoneAt`，两者都有才由这一次调用触发唯一的 matched→done；单方重复确认幂等。取消记 `cancelledBy` / `cancelledByOpenid` / `cancelledAt` / `cancelReason`，并在 `users.cancelCount` 上累加 — `dao/users.js`（新增 `incCounter`）— `requestFlow`

> 取消次数记在**人**身上而不是单子上：单子会被清理，人的行为记录要留下（M3 信用分的输入，PRD 4.1 规则 3）。累加失败只记日志，不让取消本身失败。

**M1-13**

- `cloudfunctions/_shared/dao/events.js` — 埋点流水，只增不改不删 — `dao/db.js` — `trackService`
- `cloudfunctions/_shared/service/trackService.js` — `report`（字典外或 planned 事件一律拒收）与 `reportSafely`（服务端内部上报，**永不抛错**）；桶号首次计算后缓存到 `users.bucket` — `constants/events.js`、`service/bucketing.js`、`dao/{events,users}.js` — `track` 云函数、`requestService`、`responseService`
- `cloudfunctions/track/` — 单一 action `report` — `_shared` — `utils/track.js`
- `miniprogram/utils/track.js` — 失败静默重试一次后放弃，不弹提示、不抛错；调用处不需要 await 也不需要 catch — `config/env.js` — 各页面

> 服务端直接上报的事件（不依赖端侧触发）：`request_status_changed`（在 `applyTransition` 提交后）、`same_gender_only_enabled`、`responder_selected`、`request_done_confirmed`、`response_submitted`、`gender_missing_blocked`。端侧只报 `request_publish_submitted` 这类"意图"事件 —— 它要在发布失败时也留下记录，服务端反而拿不到。

**M1-14**

- `miniprogram/app.json` — 五 Tab（首页 / 城市 / 喊一声 / 消息 / 我的），标题改「喊呗」；V1.0 旧页面**已从路由摘除但文件保留** — 无 — 全局
- `miniprogram/custom-tab-bar/index.js` — tabList 换成五 Tab，中间「喊一声」为主动作入口 — 无 — 各 Tab 页（`onShow` 里同步 `selected`）
- `miniprogram/pages/square/` — 需求广场骨架，**不放假数据**（空列表比假卡片更能反映进度），列表在 M1-16 填 — 无 — 无
- `miniprogram/pages/city/`、`miniprogram/pages/notice/` — 占位页，写明对应里程碑 — 无 — 无
- `miniprogram/pages/mine/` — 最小可用：登录建档 + 补全常驻城市与性别。**不是占位页** —— 「仅同性响应」依赖性别（D-26），没有这个入口，M1-10 的性别规则在界面上无从验证 — `services/user.js` — 无
- `miniprogram/pages/request-detail/` — 详情骨架，用于验证 M1-15 的发布跳转；双视角交互在 M1-17 — `services/request.js` — 发布页

> **页面目录用新名字**（`square` / `city` / `notice` / `mine`），不复用 V1.0 的 `home` / `group` / `message` / `wode`。原因：前提第 7 条要求旧页面文件保留作重构对照，若原地重写就等于删了。计划里 M1-16 原写「`pages/home/` 重做为需求广场」，已同步改为 `pages/square/`。

**M1-15**

- `miniprogram/pages/publish/` — 发布页：首屏保留「一句话输入框 + 帮我整理」，M1 点按钮直接展开完整表单（无 AI，旁注 M2 接入）。枚举全部来自 `models/enums.js`，模板里不出现枚举字面量；金额 / 见面时间 / 见面地点用黄色高亮块 + 「这项请你自己确认」；偏好区只有「仅同性响应」 — `models/{enums,schema}.js`、`services/request.js`、`utils/track.js` — 详情页（跳转）

> 首屏结构是为 M2 留的接口：M2-07 只需把「帮我整理」换成一次 `aiGateway` 调用并把结果填进表单，页面不重做（D-15 的降级路径就是这张表单本身）。
>
> `fieldSources` 由发布页组装：M1 全部标 `user` / `empty`；M2 起 AI 给的字段标 `ai`，而金额 / 见面时间 / 见面地点 / 联系方式四项标了 `ai` 会被服务端直接拒绝（PRD 5.4）。

**M1-16**

- `cloudfunctions/_shared/dao/requests.js`（扩展 `listOpenByCity`）— where 条件按 `city + status + expireAt` 索引的字段顺序写；「未过期」用 `expireAt > now` 判断，**不依赖定时任务已经改过状态** — `dao/db.js` — `requestService.listSquare`
- `cloudfunctions/_shared/service/requestService.js`（扩展 `listSquare`）— 只回传卡片需要的字段；多取一条判断 `hasMore`，省一次 count；未开城返回空列表而非报错（D-10） — `dao/{requests,configs}.js` — `requestFlow` 的 `list` action
- `miniprogram/models/labels.js` — **UI 展示文案集中一处**。枚举是端云双份、靠 parity 单测锁住的契约，文案只影响界面，两者分开维护：键取自枚举、文案放这里 — `models/enums.js` — 广场页、卡片、详情页、发布页
- `miniprogram/components/request-card/` — 需求卡片。只读冗余字段，**不联查 `users`**；倒计时由外部传入 `nowMs` 驱动，组件不自开定时器 — `models/{labels,enums}.js` — 广场页
- `miniprogram/pages/square/` — 品类筛选 + 城市切换器 + 下拉刷新 + 触底翻页；每 30 秒推一次 `nowMs` 让所有卡片倒计时一起走 — `services/request.js`、`utils/track.js` — 详情页（跳转）

> **联调数据开关只有一处**：`requestService.INCLUDE_TEST_DATA`。M1-19 收尾前改成 `false`，之后广场与统计都不再看到 `_isTest` 数据。散落多处的开关等于没有开关。
>
> **导航栏标题**：五个 Tab 与详情页都不设页面级 `navigationBarTitleText`，统一回落到全局的「喊呗」。页面身份靠页面内的大标题表达，不靠导航栏。

**M1-17**

- `cloudfunctions/_shared/service/requestService.js`（扩展 `getDetail`）— 一次调用返回需求本体 + 视角 + 响应列表 + 双方确认状态；新增 `publicRequest` / `publicResponse` 两个裁剪函数，**响应对外不含 `responderOpenid`** — `dao/{requests,responses,users}.js` — 详情页
- `cloudfunctions/_shared/service/requestService.js`（`confirmDone` 补 `doneCount`）+ `responseService`（响应时冗余存 `responderDoneCount` 快照）— 完成单数是 M1 唯一真实可得的"证据摘要"（PRD 6.4） — `dao/users.js` — 详情页的响应列表
- `miniprogram/pages/request-detail/` — 三视角切换（需求方 / 被选定的响应者 / 其他人）；选定前**强制展示安全提示卡** + 二次确认弹窗；matched 后双方各自确认完成并显示对方状态；所有失败原样弹出云函数给的业务提示 — `services/{request,response}.js`、`models/labels.js`、`utils/track.js` — 无

> 证据摘要按计划只显示"真实可得"的项：**完成单数显示、平均响应时长不显示**（M1 没有这个数据源），且不写"暂无"占位 —— 占位会让人以为功能坏了。信任分与徽章分级属 M2/M3，M1 徽章一律「新面孔」。

**M1-18**

- `cloudfunctions/_shared/dao/requests.js`（扩展 `listExpiredCandidates`）— 仍在架且 `expireAt` 已过去的单子，按 `expireAt` 升序（先处理过期最久的），**单次有条数上限** — `dao/db.js` — `expiryScan`
- `cloudfunctions/_shared/service/expiryScan.js` — 扫一轮并把到期单置 expired；actor 固定 `system`；单条失败不中断整批；返回 `mayHaveMore` 供下一轮判断 — `requestService.applyTransition`、`trackService` — `cron`
- `cloudfunctions/cron/` — 两个定时触发器（`config.json`）：`scanInstant` 每 10 分钟扫即时型、`scanScheduled` 每小时扫预约型。**本函数没有 openid**，所以不走 `createHandler` 的身份校验 — `_shared` — 无

> 幂等是查询天然给的：只选在架单，已 expired 的选不出来，同一单不会被过期两次。M2 的"过期后 AI 兜底作答"与"归档进知识库"的调用点已在 `expiryScan` 的循环里用注释标出。

## 关键决策的代码落点

| 设计决策 | 代码落点 | 出处 |
|---|---|---|
| 前端不可信，状态变更单一入口 | `cloudfunctions/requestFlow/`，含显式转移表 | tech-stack 第 3 节 / D-20 |
| 只有 dao 层能碰云数据库 API | `_shared/dao/`（含 `db.js` / `tx.js`）；service 里出现 `db.collection` 即越层 | tech-stack 第 3 节 |
| 云函数间共享代码靠复制 | `scripts/syncShared.js` + `.gitignore` 排除副本，真源只有 `cloudfunctions/_shared` | M1-08 |
| 服务端不信任端侧校验 | `_shared/service/requestValidator.js`（与端侧 `schema.js` 故意不共享） | tech-stack 第 3 节 |
| 四类字段禁止 AI 代填 | `requestValidator.assertNoAiFilledFields`（`fieldSources` 标记为 ai 即拒） | PRD 5.4 |
| 幂等靠唯一索引兜底 | `users.openid`、`responses.requestId + responderOpenid`；service 捕获冲突后改读 | tech-stack 第 3 节（4） |
| AI 统一网关（额度、缓存、降级、记账） | `cloudfunctions/aiGateway/` + `_shared/ai/registry.js`（能力注册表） | tech-stack 6.1 |
| 推荐必须可解释，禁止无理由推荐 | `_shared/service/matchService.js`（代码打分 + 依据字段）→ 模型只把依据写成人话 | PRD 5.4 / M2-11 |
| 自主性阶梯 L0/L1，L3 永不做 | `miniprogram/pages/assistant/` + `_shared/service/inviteService.js` | D-14 / M2-14 |
| 零用户阶段用离线评测替代 A/B | `scripts/evalParseRequest.js` + `tests/fixtures/parseRequestGolden.json` | D-31 / M2-15 |
| 三层内容安全 | `cloudfunctions/moderation/` | tech-stack 6.3 |
| A/B 分桶（M1 只埋字段，实验运营留 M5） | `cloudfunctions/track/` + `_shared/service/bucketing.js` + `_shared/service/trackService.js`（桶号缓存在 `users.bucket`） | D-21 / D-31 |
| 埋点绝不阻断主流程 | 服务端走 `trackService.reportSafely`（永不抛错）；端侧 `utils/track.js` 失败静默重试一次后放弃 | M1-13 |
| 事件名不许野生增长 | `trackService.report` 只接受 `constants/events.js` 里 status 为 active 的事件名 | PRD 7.3 |
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

