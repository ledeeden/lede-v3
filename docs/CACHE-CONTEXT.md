# Harness 缓存与上下文移植（2026-11-13）

固定来源：DeepSeek Harness `e8f7b93a344964de3dca1ace9e72b6e4d6de87cb`，MIT © 2026 DeepSeek。
原文保存在 `upstream/cache-sources/`，逐文件上游 Blob SHA 见该目录 manifest 和主 manifest。
这是源码逻辑移植与 Lede 适配，不是安装整套 Harness，也不宣称原版 SDK 未经修改。

## 接入链路

| 上游机制 | Lede 实现与语义 |
|---|---|
| RuntimeContextProjection | `request-context.mjs`：快照相同不重复写入；变化在完整工具批次之后追加为带来源的持久消息；明确取代旧快照；清空也有记录；重建只读持久事件 |
| Request header / system projection | 持久记录实际 system、tools、provider URL、model、effort、maxTokens；稳定时不改历史；workId 从 system 移到上下文；真正改变系统指令或工具集合时记录新请求系列 |
| Token meter | 原版固定 4 字符/Token 的启发式，加消息/块/工具定义开销；预算包含系统和工具；不是精确 tokenizer，不改账单统计 |
| Compaction policy | `compaction-policy.mjs` 移植原版配置校验、精确 provider/model 覆盖、threshold/headroom/retain 预算、压缩与溢出重试次数 |
| Range / pairing | 从最旧历史选择连续区间，按 Token 保留尾部，回退到工具配对边界；不再固定保留两个 Step；额外校验工具 ID，孤立结果拒绝压缩 |
| Prefix-reusing summary | 复用 system、工具定义、被压缩的原历史前缀，最后追加摘要指令；复用实际 model 和 effort；不将历史重新包装成 JSON，不截断输入 |
| Durable checkpoint | start/end 记录；异步模型 IO 后同步核对请求头与完整历史；只接受完整、非空、无工具调用且更小的文本摘要；原文日志和工具账本保留 |
| Overflow recovery | 只在服务商明确报告上下文溢出时强制压缩；必须先持久缩小历史，才有界重试模型；不重放任何工具；其他网络/权限/协议错误不触发压缩重试 |
| Recovery | 未完成压缩在启动时标记中断，保留原历史，不自动重放摘要 IO；重建后的上下文去重继续有效；旧 checkpoint 仍以非原始证据标注 |

每步流程：接纳输入 → 记录最新请求头与变化的上下文 → 预算检查/必要时压缩 → 若快照被压缩则重新追加最新快照 → 模型 → 持久 assistant → 完整工具批次及结果。
重复工具提醒与 next-step 插话沿用原有账本。工具读取权限、只读模式和 Project/Session/Work 身份保持原约束。

## 明确适配

- 当前提供方接口仍为 Chat Completions。它没有声明 Harness Messages adapter 的 in-history system/tool-update 能力，因此采用上游“不支持该能力”的请求头替换分支；不伪装具备 Messages 专用回放能力。
- 在原版摘要调用基础上额外保留同一路由的 effort，避免摘要使用不同推理档位。配置独立摘要模型时允许同一提供方换模型，但不能保证前缀缓存共享。
- 原版默认 headroom 为 65536，不适合 Lede 默认 65536 窗口；适配默认值为 `min(8192, floor(contextWindow * 0.1))`。阈值比例 0.8、尾部比例 0.16、压缩重试 1、溢出重试 1 沿用上游。摘要输出预算默认 `min(4096, chat.maxTokens)`。
- 通过 `chat.compaction` 配置策略，可使用 `thresholdRatio`、`headroomTokens`、`retainRatio`/`retainTokens`、`maxTokens`、`compactionRetries`、`maxOverflowRetries`、`auto` 和 `modelPolicies`。provider 为配置的 Base URL。只配置一个聊天提供方，跨提供方摘要会明确报错。
- 使用现有 SQLite `checkpoint/checkpoint_seq` 表示前缀替换，不引入 Cordis 或整个通用 Surface 引擎。摘要追加最近三条用户原话，连同 framing 一并参与缩小校验。
- 选取区间必须有可保留尾部。单条巨型输入、系统指令或工具定义本身无法通过压缩历史解决，仍可能被提供方拒绝。
- 可选图片卸载、工具结果 prune 插件、手动 `/compact` 产品入口和其他协议 Adapter 不属于这条 Chat Completions 缓存链路；没有把未接入能力标成完成。

## 验证

`npm run check` 和 `npm test` 通过（85 项，包括新增 10 项缓存/压缩测试）。
实际本地 HTTP fixture 验证跨工具写入、跨 Turn 的逐消息前缀完全一致，摘要请求的 system/tools/历史/model/effort 一致；并验证截断、空摘要、工具响应、非缩小摘要、取消、并发修改、中断恢复和服务商溢出。
原生 Chrome 的 22 项浏览器场景全部通过，覆盖 1440×1024 / 390px、发送消息→工具执行→知识落盘→视图回传，无页面异常。
测试模型仅在 tests/fixtures；这些结果不代表真实 DeepSeek 的缓存命中率，不能保证 99%。
2026-11-13 已在确认无运行中 Run、无 Inbox 消息后安全重启本地 4217 服务，bootstrap 返回 HTTP 200；原有 1 条 waiting_input Run 保持不变。新请求使用这条链路，旧的聚合用量不会改变。

## 压缩与截断恢复对齐（2026-11-13）

参考 Harness 固定提交 `39163dd30f703a79079e2d2446545cff3c453738`，MIT © DeepSeek，完整读取的源码及 blob SHA 见 `upstream/recovery-sources/manifest.json`。Modified：保留 Lede 的 SQLite、Chat Completions 和 Task/Work 边界。

- 普通 pre-step 压缩失败记录 warning，保留历史并继续；取消仍立即生效。强制 overflow 恢复只有实际缩小后才允许有限重试；即使后续摘要失败，已持久化的工具裁剪仍算有效缩小。
- 超过 8192 Unicode 码点的工具返回保留前 4096、后 1024 码点。Lede 适配为 context/tool-pruned 事件，不覆盖原 tool/result、不拆 tool-call/result；标记给出原 session event URI。重启可重建，裁剪幂等。
- 摘要输出预算不再绑定普通回复的 4096 上限。默认随本地 headroom（窗口的 10%，最大 8192），显式 compaction.maxTokens 优先；这是小窗口适配，不盲目套用上游 65536。模型截断的摘要仍不接受。
- 提供方 finish=length 优先于部分工具参数 JSON 校验，交由内核记录 truncated 与未执行结果；不会执行半截工具，也不自动重放写操作。
- 上游可选的 tool-result-pruner 在 Lede 压力/overflow 路径启用；未整体引入插件宿主、未宣称所有上游恢复插件均已移植。
