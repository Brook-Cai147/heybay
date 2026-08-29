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
| `docs/` | 项目文档，即 memory bank | 就绪 |
| `tests/` | `node:test` 单测，只覆盖状态机 / AI 额度 / 分发频控 | 未创建 |

## 文件清单

> 每完成一步就在此追加。格式：`路径` — 职责一句话 — 依赖谁 — 被谁依赖。

（尚未开始开发，本节为空）

## 关键决策的代码落点

| 设计决策 | 代码落点 | 出处 |
|---|---|---|
| 前端不可信，状态变更单一入口 | `cloudfunctions/requestFlow/`，含显式转移表 | tech-stack 第 3 节 / D-20 |
| AI 统一网关（额度、缓存、降级、记账） | `cloudfunctions/aiGateway/` | tech-stack 6.1 |
| 三层内容安全 | `cloudfunctions/moderation/` | tech-stack 6.3 |
| A/B 分桶（M1 必须完成） | `cloudfunctions/track/` + `configs` 集合 | D-21 |
| 管理后台做进小程序 | `miniprogram/pages/admin/` + openid 白名单 | D-22 |
| 不碰资金 | 无支付相关代码，金额字段仅作线下参考 | D-04 |
