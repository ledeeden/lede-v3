# 源码提取与改动对照

本交付的策略是**阅读固定版本源码后移植必要逻辑**，不是给整个 DSH/DS-Bot 换皮，也不是声称两者的 npm 包已经无修改嵌入。被保留的算法有对应测试；宿主、存储和业务接口属于 Lede 自己的实现。

## 固定来源

| 来源 | 固定提交 | 许可 |
|---|---|---|
| deepseek-ai/deepseek-harness | `e8f7b93a344964de3dca1ace9e72b6e4d6de87cb` | MIT，Copyright (c) 2026 DeepSeek |
| Fei2411/DS-Bot | `a66cc737cfb6c3d8a2597e748cded6cab1206dd3` | Apache-2.0，Copyright 2026 Fei2411 and the DS Bot contributors |

机器可读映射见 `upstream/manifest.json`。版本固定不代表代码已接受上游兼容性认证。

## DeepSeek Harness

### 1. Durable Inbox

源文件：[packages/core/agent-loop/src/inbox.ts](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/core/agent-loop/src/inbox.ts)。本次读取了完整文件。Blob SHA `affe0c6b2f653888dc2177fd2987c6082a93f758`。

目标：`server/runtime/inbox.mjs`。

保留了 `next-step` / `next-turn` 两条队列；splice 位置与删除量标准化；跨队列消息 ID 唯一性；claim 先取下一 Step 消息，再最多取一个下一 Turn；持久变更事件和重建校验。

改变：取消 DSH 的类型、Zod/Projection/Cordis 依赖。队列实体保存在 SQLite；splice 事件与投影在同一事务更新。`applyInboxSplice` 是纯投影函数，可独立验证重放；外部业务只接触 `DurableInbox`。

测试：`runtime.test.mjs` 中 splice/重复/claim/replay；`collaboration.test.mjs` 中执行中插话与下一 Step。

### 2. Turn / Step 执行顺序

源文件：[packages/core/agent-loop/src/agent.ts](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/core/agent-loop/src/agent.ts)，重点读取 `turn()` / `step()` 的 300–720 行范围。

目标：`server/runtime/kernel.mjs`。

保留：Turn 打开与输入接纳、Step 开始、模型流式尝试、提交 Assistant 消息、执行 Tool Batch、提交成对结果、继续下一 Step、Turn 终态；持久事实与实时流分离；取消/截断不是普通成功；不让失败导致未配对 Tool 历史。

改变：移除了 Cordis waterfall、完整动态 PromptAssembly、DSH Request Surface、PTC、ACP、多种原始 Adapter 和完整 provider-specific replay。使用明确构造参数（Store/Resources/Providers/Tools/Handoffs）和兼容 Chat Completions 的单个协议适配器。普通工具顺序执行；跨 Bot 可并行。局部工具的业务变更与结果账本在一个 SQLite 事务中提交。

因此这不是 DSH `ReactLoopAgent` 的完整搬运，也没有宣称获得它所有模型、恢复和扩展保证。

## DS-Bot

### 3. Request Identity

源文件：[ds-bot/src/host/requests.js](https://github.com/Fei2411/DS-Bot/blob/a66cc737cfb6c3d8a2597e748cded6cab1206dd3/ds-bot/src/host/requests.js)，完整读取。Blob `d153e4742d78d73de4122ed4ecdc76a50ded5e05`。

目标：`server/runtime/requests.mjs`。

保留：`caller + context + request_id` 作用域；payload SHA-256；发送前持久接纳；相同内容重放回执，不同内容冲突；进程内同请求共享执行；无法确认结果时不盲目重发。

改变：`rt.state.requests` / `rt.save` 替换为 SQLite requests 表；pending 但无本进程 inflight 的记录视为 uncertain。没有复制 UI、群聊、profile 或全局状态。

测试：并发同名接纳、冲突、失败不重发、跨宿主未知结果。

### 4. Handoff Tree

源文件：[ds-bot/src/host/handoffs.js](https://github.com/Fei2411/DS-Bot/blob/a66cc737cfb6c3d8a2597e748cded6cab1206dd3/ds-bot/src/host/handoffs.js)，重点读取 65–280 行的 `openWork`、`closeWork`、`taken`、`hold`、`answerText`、`upstreamOf`。Blob `d0725e71be41a56cec156b47d47865ee6e54251f`。

目标：`server/runtime/handoffs.mjs`、`coordinator.mjs`、`kernel.mjs`。

保留：每次委派是 Work，不是一个 Bot；父子关系；子结果尚未读取时仍在等待；回合结束但子工作未交回则 hold；结果自动回传并唤醒；不能向当前等待链上游回派；显式放弃/失败而不是假装成功。

改变：works/open/results 改为 SQLite 行状态；大结果进入统一 tool_outputs，而非全局 `rt` 或 DS-Bot 私有结果目录。项目成为消息作用域；全局总助只通过显式 project.delegate 进入项目。没有带入群聊轮次、管理员权限、@ 文本解析、群 Ledger 或原生 DSH Subagents。

**差异**：晚到的真实回执在已经结算后会被判为重复，不重复唤醒；本版没有保留 DS-Bot 将迟到内容额外送入聊天的完整策略。未读同发件人请求自动合并也没有移植，独立请求保留独立身份并排队。

### 5. 长期 Bot 与消息路由

参考 `delivery.js`、`roster.js`、`turns.js` 的“身份不等于一次执行、消息是自包含输入、结果后来唤醒”的边界。目标为 `coordinator.mjs`；并非整文件提取。这些文件依赖的群聊、头像、主题、应用设置等没有迁入。

Lede 中 Session 的绑定是 `(botId, projectId, thread)`，不是“一个 Bot 全局只有一条聊天”。同一个执行 Bot 在不同项目有不同会话，业务 Task 始终属于 Project。

## 不提取的部分

### 用量采集适配（2026-11-13）

固定在同一个 Harness SHA `e8f7b93a344964de3dca1ace9e72b6e4d6de87cb`，参考
`packages/llm/token-meter/src/usage-projection.ts`、`turn-usage.ts` 以及
`packages/llm/llm-deepseek/src/translate.ts` 的用量处理。
来源许可为 MIT（Copyright (c) 2026 DeepSeek），许可证保留在 licenses 中，blob SHA 见 manifest。

Modified：`shared/usage.mjs` 校验和归一化计数，`server/services/usage.mjs` 保存逐次尝试账本，
`server/services/providers.mjs` 在外部请求前记录尝试并在结束或异常后保存最后收到的用量。
同一次尝试重复样本覆盖而非累加；物理重试单独记录；没有计数则未知；推理属于输出子集。
采用 Lede 自己的 SQLite 和 Project/Bot/Run 归属，没有引入 Cordis、Harness 产品 UI 或完整 SDK。

协议差异：该版本 Harness 的 DeepSeek adapter 使用 Messages 协议，其 inputTokens 是未缓存输入，
而 Lede 保留 Chat Completions，prompt_tokens 已包含命中缓存。适配后输入总量不再次加缓存；
仅缺失一个缓存拆项且另一项与输入合法时，通过差值得到另一个拆项。原始 usage 保留供核对。
缺失任一调用的缓存拆分时不宣称整体命中率；历史仅导入已保存的 assistant/checkpoint 事件，
不补造物理尝试、不推断历史模型、不声称完整覆盖。新增表不修改原对象、URI 或 API 模型。

不包含两个项目的 Web/TUI/Electron、整套 Cordis 插件宿主、群聊 UI、原生 Agent Teams 任务板、Goal/Workflow 引擎、Office 工具、IM、浏览器/电脑控制、CLI Agent、DS-Bot 全局 state.json、自动记忆审查与原版 Context Steward。

Lede 的上下文压缩、HTTP API、UI、知识/集合/URI/检索、持久视图插件服务是新写的适配实现，不能归功于直接复用上游包。

## 升级方式

不要直接跟随上游 HEAD。先比较固定来源函数及语义，再按对应测试移植修正。保留本地业务边界；尤其不要为了升级重新引入群聊或将 Project ID 变成 Session ID。

运行 `npm run check && npm test` 后，再测浏览器与真实提供方。所有改动应更新 manifest 和本文件的差异说明。

## 持续循环与重复工具提醒（2026-11-13）

固定来源仍为 `e8f7b93a344964de3dca1ace9e72b6e4d6de87cb`，MIT © 2026 DeepSeek。
Modified：`kernel.mjs` 取消 Lede 自加的 maxSteps 硬停，按工具/插话继续，保留确认、取消、截断与失败处理。
新增 `server/runtime/repeat-tool-reminder.mjs`，参考完整读取的
`packages/guard/repeat-tool-reminder/src/index.ts`：深层参数排序、连续调用计数、3/5/8 提醒、用户消息重置。
Lede 以 Session 为隔离键，使用进程内 Map，整批工具结果后写来源明确的 user/message；没有复制 Cordis 插件宿主。
未移植 include/exclude 配置、动态阈值、turn-stopping 插件系统或 Goal round driver；上下文压缩沿用本项目实现。
旧 maxSteps 仅保留数据兼容，不再执行或展示。协议 fixture 覆盖 30 个工具步骤后自然结束、提醒顺序、新输入重置与长循环取消。

## 项目持续性适配（2026-11-13）

固定 DS-Bot SHA 仍为 `a66cc737cfb6c3d8a2597e748cded6cab1206dd3`。参考 `memory-review.js` 的用户来源/游标/审查语义、`memory-entries.js` 的固定/到期/秘密拒绝、`goals.js` 的阶段验收与空闲驱动、`parts.js` 的交接包/用户原话/历史入口设计。实际阅读范围和 blob SHA 见 manifest。

Modified：记忆和阶段目标属于 Project，阶段复用业务 Task；SQLite CAS、原子回执、同步交接包替代上游文件与 room.goal。只采用部分设计，没有移植完整记忆整理、群聊 Goal 或 Session 轮换系统。负责人换任使用新项目会话，忙碌时拒绝切换；重启后目标等待用户核对恢复。具体接口和限制见 PROJECT-CONTINUITY.md。
