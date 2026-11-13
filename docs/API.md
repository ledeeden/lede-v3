# 本地 API 与 Tools

所有 API 使用 JSON。先 GET `/api/bootstrap` 获得当前进程 token，再在普通 API 请求发送 `X-Lede-Token`。这只是本地防跨站调用，不是用户认证。错误格式 `{error:{code,message,details}}`；资源不存在404、修订冲突409、校验400。

## 资源和知识

| 接口 | 内容 |
|---|---|
| GET `/api/resources?kind=object&projectId=...&limit=100&offset=0` | 资源列表；每页最多2000 |
| POST `/api/resource/create` | `{kind,data,options?:{projectId}}`；project 自动创建负责人 |
| POST `/api/resource/update` | `{id,baseRevision,patch}` |
| POST `/api/resource/status` | `{id,status:"active"或"archived"}` |
| POST `/api/resource/delete` | `{id}`；删除不修改其他结论 |
| POST `/api/resolve` | `{uri}`；返回资源/版本/段落 |
| GET `/api/versions?id=...` | 历史版本 |
| POST `/api/search` | `{query,scope?:{projectId或collectionId},limit,level}` |
| POST `/api/summary` / `/api/reindex` | 后台概览 / Embedding 作业 |
| GET `/api/jobs` | 作业状态与错误 |

`project/link` / `project/unlink` 管理项目引用；`collection/member` 管理静态集合成员；`relation` / `relation/delete` 管理显式边。删除集合成员只是解除引用。

## 项目与 Agent

| 接口 | 内容 |
|---|---|
| GET `/api/project?id=...` | 目标、引用、任务、成员、挂载 |
| GET/POST `/api/chat` | 当前项目负责人对话；POST需要projectId/content，可含selection、requestId、when |
| GET `/api/bots?projectId=...` | 配置与真实运行状态 |
| POST `/api/bot/create` | `{data,projectId}` |
| POST `/api/bot/stop` | `{botId,projectId}` |
| GET `/api/runs?projectId=...` / `/api/run?id=...` | 执行与工具账本 |
| POST `/api/run/cancel` / `/api/run/retry` | 显式停止/核实后继续 |
| GET `/api/works?projectId=...` | 派活树 |
| POST `/api/work/abandon` | `{id}`；结算等待，不抹掉结果日志 |
| POST `/api/confirm` | `{id,accepted,note?}` |
| GET `/api/session/events?id=...` | 持久会话事件 |

SSE：`GET /api/events?token=...&since=N`；持久事件带序号，流式 delta 标记 transient。生产浏览器直接 EventSource；测试环境 bridge 的轮询不是生产实现。

## 视图与插件

`GET widgets/widget`，`POST widget`（manifest/source），`widget/edit`、`widget/build`、`widget/preview`、`widget/register`、`widget/disable`。

`GET view?id=...`；`POST view/patch`、`view/mount`、`view/unmount`、`view/snapshot`、`view/state`、`view/selection`。

用户批准与代码编译是独立步骤；不能因为生成成功自动注册。注册后的新修改必须新版本。详见 PLUGIN-SDK.md。

## 36 个模型可调用工具

模型协议名称把点换成双下划线，例如 `knowledge.search → knowledge__search`。Schema 与描述的权威实现是 `server/tools.mjs`，不要复制一份失去同步。

| 组 | 名称 |
|---|---|
| Resource | read、relations |
| Knowledge | search、create、update、link |
| Collection | list、read、create、member、refresh |
| Project | get、list、create、delegate、update、reference |
| Task | list、create、update |
| View | register、get、patch、mount |
| Widget | list、propose、build |
| Bot | list、create、message、stop |
| Intent | confirm |
| Local | file.read、file.write、web.fetch、shell.run |

Tools 不是独立存储：统一调用 Resources/Retrieval/Plugins/Coordinator。Bot 工具 allowlist 可用精确名或 `group.*`。Shell 还要求用户在设置显式开启。没有 MCP 协议端点，也没有通用第三方插件服务加载器。

## URI 示例

```text
lede://project/project_<uuid>
lede://object/object_<uuid>?rev=3#block_abc123
lede://collection/collection_<uuid>
lede://task/task_<uuid>
lede://view/view_<uuid>
lede://widget/research.funnel@1.0.0
lede://run/run_<uuid>#tool%3Drun_<uuid>%3A1%3Acall_id
```

模型 `resource.read` 支持 `level:0|1|2`、`offset` 和 `maxChars`。大工具结果返回稳定读取 URI，完整JSON保存在tool_outputs；不把完整内容永久塞进每次模型输入。

## 配置与导出

`GET/POST providers`、`POST providers/test`。公有配置响应仅返回hasKey，不返回原Key。`POST export` 为业务快照，不含密钥、完整session和工具日志；没有自动导入该快照并还原运行队列的功能。

## 检索流水线参数

`POST /api/search` 与 `knowledge.search` 增加以下可选字段（旧参数保留）：

- `rerank`: 默认 true；复用聊天模型做查询相关性重排。false 不发重排请求。
- `context`: 默认 true；返回上下文片段。false 仅返回搜索命中和状态。
- `maxContextChars`: 500–30000，默认 12000，按片段正文字符计，不含 JSON 元数据。
- `neighbors`: 0–2，默认 1，每个命中段落两侧各扩展的段落数。
- `relatedLimit`: 0–5，默认 2，一跳关联对象总数；不会扩大项目/集合范围。

返回保留 `results/mode/vectorStatus/warning/candidateCount`，新增：
`rerank {status,method,model,warning,candidateCount}`、
`indexCoverage {totalChunks,vectorChunks}`、`staleCandidates`、
`context {passages,usedChars,maxChars,truncated,budgetUnit,untrusted}`。
`rerank.status` 为 ready/disabled/not-needed/not-configured/error；只有 ready 表示完成模型重排。
结果的 score 仍是 RRF 分，不是置信度；rerankRank 为模型顺位或 null。
passages 含 uri/resourceId/revision/anchor/level/title/source/role/via/text/truncated，
role 为 hit/neighbor/reference，仅用于说明文本如何进入上下文，不表示证据评级。
向量检索与重排可能进行外部模型 IO，Agent 工具按 external 记账，支持运行取消。

## 设计扩展 API（2026-11-13）

- `POST /api/asset/upload?name=...&projectId=...`：raw body、正确 Content-Type、X-Lede-Token，100 MB 上限。返回 object。
- `GET|HEAD /api/asset/:id`：X-Lede-Token 或媒体 URL token 参数；支持单段 bytes Range。
- `POST /api/annotation`：id/baseRevision/request_id + selector/text，或 remove=annotationId；selector 为 region{x,y,width,height}（归一化）、page{page}、time{start}、block{blockId}。
- `POST /api/asset/extracted`：id/baseRevision/segments/method；段落包含 text，可带实际 page 或 start。
- `POST /api/asset/process`：id/baseRevision，返回后台 job；图片走视觉模型，音视频走独立 transcription 配置。任务失败不写伪结果。
- `GET /api/references?id=...`：incoming/outgoing。`POST /api/reference`：sourceId/baseRevision/request_id/targetUri/sourceAnchor?/excerpt?；remove=true + citationId 删除当前引用。
- `GET /api/activity?projectId=...`：最近 300 条持久工作事件。`GET /api/board?projectId=...`：项目目标、事项、任务和待确认卡。
- `GET /api/chat` 可传 botId；`POST /api/chat` 可传 targetBotId 和 options{model,effort,mode:read|execute}。
- view.patch 增加 setLayout、setEdges、reorderBlocks；updateBlock 支持 hidden 与 layout 的局部合并。
- Agent Tools：knowledge.cite、knowledge.references、knowledge.annotate、knowledge.extract_media。引用本身不引入立场判断。

图像接口依据 [Chat Completions 图像输入](https://developers.openai.com/api/docs/guides/images-vision?api-mode=chat)，转写接口依据 [Audio Transcriptions](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)。兼容服务可能支持不同格式，设置可选 json / verbose_json，未返回时间戳时不会伪造时间戳。

原件上传也接受 DOCX/XLSX/PPTX/ZIP，按扩展名选择受限本地解析。未知二进制保留为下载文件；非媒体响应强制 attachment，不在应用同源执行上传的 HTML/脚本。
