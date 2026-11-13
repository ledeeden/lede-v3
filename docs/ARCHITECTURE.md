# 架构与数据模型

## 部署与边界

一个 Node 本地进程承载 HTTP、SQLite、Agent 调度、模型流与应用服务；浏览器是展示端。不是六个微服务，也没有复制两套任务 Orchestrator。浏览器关闭后服务器仍运行；服务退出后靠持久记录诊断与恢复，不把进程内 Promise 当持久工作。

```text
浏览器 UI ─ HTTP / SSE ─ Application Services ─ SQLite
                             │
                        Tool Registry（36）
                             │
                AgentKernel ↔ BotCoordinator
                    │             │
           Providers / Inbox   Requests / Handoffs
                    │             │
                真实模型 API    持久消息与等待树

插件：源码 → Manifest/Schema → TS 编译 → iframe → 用户注册 → View → Mount
```

生产前端主体为原生 ES Modules，React Flow 作为画布岛单独构建挂载；PDF.js 在浏览器加载本地 worker。插件 TSX 的 h 工厂只是 DOM 创建，不是 React，也没有通过 `eval` 在应用主窗口执行生成代码。

## 核心数据

| 表/模块 | 权威内容与约束 |
|---|---|
| resources | Project/Object/Collection/Task/View/Bot；稳定 ID、type、owner_space、status、revision、JSON 数据 |
| versions | 资源每次内容修改的版本快照；知识 URI 可指定修订号 |
| project_links | 一个对象被多个项目引用；引用不是所有权转移 |
| members | 静态集合成员；集合嵌套循环校验 |
| relations | source/target/type 显式边，直接关联随对象删除 |
| chunks / chunks_fts | 原文段落分片、中文全文索引；L0/L1 可选独立表示 |
| vectors | 真正的 Embedding；按提供方地址和模型标识；与原文片段版本绑定 |
| widget_versions | Manifest、源码、编译产物、状态、版本；注册后不可变 |
| mounts / widget_state | 视图出现位置、固定入口；插件局部交互状态，不改变 ViewSpec 修订号 |
| sessions / session_events | 长期会话绑定与顺序事实日志 |
| inbox | next-turn / next-step 待处理输入；与 splice 事件事务更新 |
| runs / tool_calls / tool_outputs | 执行、工具开始/结果、完整大输出；不是业务 Task |
| works / requests | 派活树与接纳回执；不是项目任务清单 |
| events / jobs / confirmations | UI 实时事件、后台作业、用户意图确认 |

SQL 定义在 `server/db.mjs`；schemaVersion 当前为1，没有跨版本数据迁移工具。`owner_space` 目前统一 local，多用户能力尚未实现。

## 对象与项目

Project 创建时一并生成固定负责人 Bot；leadBotId 不可修改。成员执行使用独立 Session / Run / Work，任务委派回传不等于负责人交接。旧交接记录仅用于历史追溯。

Task 的 `projectId` 不允许直接改变，assignee 必须属于项目。依赖不能成环或跨项目，done 时所有依赖须完成且存在 evidence。这里检查的是证据字段存在，不是自动验证证据真实性。

## 统一 URI

格式 `lede://kind/id?rev=N#anchor`。身份不含标题、文件路径、端口或集合归属。ID 原则上不可变；Widget key 是 id@version。

知识段落使用稳定内容块 ID。原样保留的段落在编辑后尽量复用 ID；合并/拆分或显著修改的段落可能获得新 ID。要固定历史证据必须带 `rev`。这不是任意编辑后都能自动追踪语义位置的系统。

宿主负责 resolve/read，UI 浏览器路由只是 `/#resource/<encoded-uri>`。本交付未向 macOS 注册 `lede://` 系统协议；在应用内和 Bot Tools 中使用有效。

## 知识、集合与摘要

知识可以是资料、案例、方法、研究结论、决策或交付物，不新增方法论引擎。Collection 静态保存成员，动态保存 kind/tags/projectId/text 查询。一个对象可属于多个集合。

原文是权威数据；summary 是可重建派生表示。生成概览采用当前来源快照，返回 L1，再从 H1 与第一个 H2 之间提取 L0。记录 sourceSignature、sourceRevision、生成时间与实际覆盖数。超过输入预算的长文会标记采样，不声称覆盖完整材料。生成期间来源变化时拒绝落盘。

成员或原文变化后标记相关集合概览 stale，不自动花 Token 重写。Bot 读取过期摘要时返回原文；需要时调用 refresh。普通手工知识仍按需生成；执行成员保存的完整研究 L2 由 ResearchSummaries 在事务提交后异步生成 L0/L1，按 sourceSignature 去重，内容更新后重新生成。失败记录在 jobs，不自动重放失败请求。

## 混合检索

FTS 使用 Intl.Segmenter 中文分词并补充连续汉字双字 token，标题加权；向量来自用户配置的 Embedding API，不使用随机/哈希向量充当生产语义。

候选在项目/集合/层级范围内召回。Dense 采用本地精确余弦扫描，全文使用 BM25；合并采用 RRF(k=60)，去重后返回 URI/revision/block/source/snippet/channel。没有配置或向量服务失败时透明返回 FTS 与状态说明。它不是网页搜索。

更新知识会重建其全文片段并清掉旧向量；通过后台补齐作业生成新向量。目前不是写入后自动调用 Embedding。没有实现 ANN；目前以已配置的聊天模型对最多 24 个融合候选做相关性重排，随后组装可追溯上下文。数据量大时需评测召回后端。

## 执行与协作

1. 用户消息有 requestId，先持久接纳，项目负责人接收输入。
2. 持久 Turn/Step 事件推进，模型决定 Tools，Schema 与工具范围校验后执行。
3. 本地业务工具的变更与结果原子提交。外部 IO 单独记录 running 后执行，不能承诺 exactly-once。
4. 委派新 Work，收到结果时写入负责人的 Inbox；不靠轮询持续消耗 Token。
5. 当前 Work 有未读子结果时保持 waiting；全部交回并消费后才交上游。
6. Cancel、failed、blocked、truncated、interrupted 均独立于 succeeded。
7. 强杀后，外部工具未知结果明确记录为 unknown；用户核实后才继续。排队输入和等待关系保留。

并发上限默认4个 Session；同 Session 串行。长上下文按 Token 预算选择工具配对完整的前缀，保留近期尾部与用户原话；动态上下文以变化时追加的持久消息进入请求，摘要调用复用原 system/tools/历史前缀。摘要不是精确事件回放，原始日志仍保留。

## 事件和前端

资源变化通过持久 events 序列后发 SSE；重连可指定 Last-Event-ID。Agent token delta 是 transient，不作为最后结果。前端收到业务变化重取数据，不把页面上的缓存当数据库真相。

View 的绑定查询在读取时执行；Snapshot 固化当时解析数据。UI 选中行或段落传入稳定资源引用，服务端检查插件选择确实来自该模块当前数据。选择不触发重新挂载整个画布。

### 持续工具循环（2026-11-13）

Modified：按固定 Harness 来源的无内置 Turn budget 语义运行，不再按固定 Step 数停止。
旧 Bot 的 maxSteps 字段保留兼容但忽略，新 Bot 不再默认写入该字段，配置界面移除该项。
无工具调用且无 next-step 输入时自然结束；确认、取消、输出截断和错误仍按原有终态处理。
同一会话连续相同工具与规范化参数在第 3、5、8 次加入来源明确的提醒，不强制阻止。
提醒在整批工具结果之后写入持久会话事件；用户输入重置计数，压缩不重置，进程重启重新计数。
此处描述持续工具循环；后续项目持续性适配新增跨 Turn 目标推进，见 PROJECT-CONTINUITY.md。业务 Task、Work 与 Run 身份不变，仍没有费用/时长预算。

## 项目持续性

`Memory` 管理项目/Bot/共享记忆与自动回合审查；`ProjectContinuity` 管理项目阶段目标、空闲续跑。阶段引用现有 Task，派活继续使用 Work；目标与记忆使用独立修订和历史，不冒充资源权限隔离。

### 检索重排与上下文（2026-11-13）

`knowledge.search` 与 `/api/search` 共用 Hybrid → RRF → LLM rerank → context 流程。
重排复用已配置的 Chat Completions 模型；每个候选最多发送 1800 字符、候选最多 24 个，
要求模型返回完整且无重复的候选 ID 排列。它只排序查询相关性，不判断引用的支持/反对或真实性。
调用走现有提供方账本，purpose=rerank；没有模型、无须重排、主动关闭或响应异常均显式返回状态。
失败回退原 RRF 顺序，不把融合排序冒充模型重排；24 个之外的候选保留为未重排尾部。

上下文先收集命中片段，再补相邻段落，最后最多扩展一跳显式关系。扩展严格遵守相同查询范围，
只读取 active 知识/集合，不改变关系、不增加证据审核。每个片段保存版本 URI、anchor、level、
来源、角色及 via 路径。默认原文字符预算 12000，每段最多 2400；预算不包含 JSON 元数据，
不是精确 Token 预算。相同 URI/level 去重，截断显式标记，可用 resource.read 继续读。

模型 IO 不在 SQLite 事务中执行；IO 后再次检查资源修订、归档状态与查询范围，丢弃过期候选。
返回 indexCoverage（当前范围总片段/已有当前模型向量片段），不把部分索引冒充全覆盖。
向量仍由已有补齐作业生成，本次未新增自动索引队列，也未新增 OCR、PDF 或音视频解析。

## 当前设计扩展（2026-11-13）

- ViewSpec 增加 `layoutMode`（grid/article/canvas/gallery）、`edges`；块保留稳定 id，可排序和显隐，layout 保存坐标、尺寸、locked、groupId。所有修改仍经 baseRevision CAS。分组是呈现关系，不改变知识身份。
- `Assets` 管理原件表与 blobs 文件；上传的二进制不进入 SQLite 事务中的 IO。文件响应支持鉴权、Range 与 HEAD。原件内容不可变；文字提取、标注和引用属于对象修订。
- PDF.js 在本机浏览器提取文字，文本片段保留页码；字幕或转写片段保留提供方实际返回的时间。检索 hit/context 返回 locator。图像识别与转写明确是外部 IO，保存时再次检查源修订。
- `citations[]` 记录每一次引用：targetUri 固定版本，可含段落/标注/页码/时间；sourceAnchor 记录使用位置。references 接口提供入向/出向导航，不增加可信度或支持/反对判断。历史版本仍可定位。
- 项目动态读取持久 session_events，工具调用与结果按 callId 成对显示。指定成员对话复用其 Project Session；用户修正同步给负责人并沿用只读选项。
- 请求级 model/effort/mode 随输入持久化。只读模式过滤工具定义，并在执行入口再次拒绝写工具；不声称是多用户权限系统。
- 事项为 category=milestone/decision 的知识对象，可关联同项目任务；目标、事项、任务保持各自身份。
- Bot 头像保存 avatar 与 appearanceDescription；自动分配是显示规则，手动覆盖不改变 Bot 身份。
- 外部代码插件仍通过无 same-origin 的 iframe 运行；新增内置组件不会改变插件注册审批与权限。

- Office 内容使用 fflate/fast-xml-parser 本地解析；解压前限制条目数、单文件与总文字大小，拒绝自定义 XML 实体。仅提取指定文档部分；ZIP 本身只列目录，原件仍保留。

## 缓存与上下文链路（2026-11-13）

请求头、运行时上下文投影、预算策略、前缀复用压缩、失败原子性与溢出恢复见 [CACHE-CONTEXT.md](CACHE-CONTEXT.md)。当前 Chat Completions 路由采用不支持历史中 system/tool 更新的上游分支。

## 项目呈现与分层阅读

执行成员保存完整研究与来源；负责人日常读 L0，综合读 L1，争议读 L2。全局总助上下文优先包含负责人最新 project/report 的人工选定摘要与 URI。`project.report` 仅负责人发布；`project.overview` 以项目 baseRevision 绑定已有视图。ViewSpec 的布局和内容由负责人编辑，与原始资源的自动摘要分别演进。默认总览绑定真实成员运行、任务、交付物、待决定事项和汇报。

## Bot 职责约束（2026-11-13）

Lede 自有适配：运行时按总助、项目负责人、执行成员注入职责合同，并对总助工具和项目管理工具实施角色过滤；定义与执行入口一致。未新增上游 SDK 或调度引擎。详见 [BOT-ROLES.md](BOT-ROLES.md)。

## 沟通页面（2026-11-13）

左侧导航 #communication 提供独立的对话列表与会话正文，复用 (botId, projectId, main) 会话和原有消息/确认接口，不把团队变成群聊。总助和负责人为入口；成员只有用户直接交谈、待确认事项或明确 communication.send 消息时出现。后台派工、过程旁白、流式增量不作为聊天正文。用户发起的回合仅展示已终结的最后文本答复；长历史消息折叠，原始工作记录保留。

communication.send 是 Lede 自有产品工具：限 1000 字符、每个 Run 合并为一条、request_id 幂等且冲突拒绝，持久事件为 communication/message。读标记以 session 保存，确认卡继续使用 confirmations。不是多用户隔离，不自动判定模型结论是否正确；沟通简洁和贴合需求仍需真实模型质量验收。
