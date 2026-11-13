# Lede · 项目工作空间 v0.3

本地优先的项目工作台。**项目是入口，负责人 Bot 是沟通对象，执行 Bot 在后台协作；主界面展示资料、进展和成果。**

本交付是可运行的应用源码与本地服务，不是静态设计稿。界面依据你提供的 Figma 第三版（`76:1809` 页面）实现。Agent 内核与通信采用从指定 DeepSeek Harness / DS-Bot 源码提取、裁剪和移植的逻辑，**没有安装两个项目的整套产品，也不是它们的官方发行版本**。

## 启动

要求 **Node.js 22.16 或以上**。本轮验证环境为 macOS / Node.js 25.9.0。使用内置 `node:sqlite`，该版本显示实验性提示属于预期现象。

```sh
cd lede-v3
npm ci
npm run build:web
npm run check
npm test
npm start
```

随后打开终端打印的本地地址，默认 `http://127.0.0.1:4217`。服务端使用 Node 内置 HTTP/SQLite 与 ZIP/XML 解析依赖；前端构建需要 React、React Flow、PDF.js 与 esbuild，版本固定在 package-lock.json。已生成的浏览器产物放在 web/public/vendor/，构建完成后运行不依赖 CDN。插件编译器 TypeScript 5.8.3 连同许可证保留在 vendor/。

Mac 上也可打开 `START.command`，自动启动服务并打开浏览器。命令文件在解压后没有执行权限时，在该目录运行 `chmod +x START.command DEMO.command`。不要直接以 `file://` 打开 `web/index.html`，它需要本地 API。

### 先看界面与流程

运行 `npm run demo` 或打开 `DEMO.command`。默认使用独立的 `~/.lede-demo` 数据目录和 4218 端口，不污染正式 `~/.lede`。示例项目、指标、资料与任务都明确标记为演示，**不是实时调研、正在执行的 Agent 或真实经营数据**。

### 配置真实模型

进入左下角「设置」，填写 Chat Completions 兼容服务的 Base URL、模型名称和 API Key，点击「保存并测试模型」。本地兼容模型可明确启用「无需 Key」。模型名称必须由你的提供方实际支持；界面里的默认名称不是可用性保证。

可单独设置 Embedding 模型，随后点击「构建 / 补齐向量索引」。没有配置 Embedding 时，系统明确使用全文检索，不生成假向量。模型 Key 仅保存在本机私有配置文件，不写进前端或交付包。

关闭浏览器不会停止 Bot；**关闭服务进程会停止运行**。`Ctrl+C` 安全退出。没有安装系统级守护服务，Mac 睡眠、断网或进程终止会影响正在执行的工作。

## 第一次使用

1. 点击新项目，与总助聊清名称与目标；总助创建项目和固定负责人。
2. 在资料页导入 Markdown、文本、JSON、CSV、HTML、图片、PDF 或音视频，或直接创建知识。将已有集合关联到项目。
3. 与右侧负责人对话。目标模糊时它可以发起确认卡；用户确认后继续。
4. 由负责人通过对话创建成员、派活、接收结果与要求补充；总览显示成员执行、进展、成果、决定和汇报。
5. 在「进展」查看任务、验收依据与真实 Run 日志；在「成果」查看产物。
6. 在项目中生成或创建视图。点击表格行、知识段落或插件的数据项，选择会进入负责人上下文。
7. 预制组件表达不了时，让 Bot 提案代码插件；在「视图插件」编译、预览并确认注册后挂载。

参考指令（需要真实模型，不是预置脚本）：

> 阅读本项目资料，先复述你理解的目标和范围，待我确认后再创建任务。需要其他成员时先检查团队，避免重复创建。

> 请研究 Bot 整理已有证据，再交给审查 Bot 核对。成果保存为知识对象，最后生成一个资料对比视图。没有来源的判断标记为待验证。

> 创建一个能选择数据点的视图插件，先构建交给我预览，不要自行注册。

## 已实现的业务链路

| 范围 | 实际能力 |
|---|---|
| 项目 | 创建、修改、负责人、成员、资料引用、总览、进展、成果、项目上下文 |
| 知识 | 创建/编辑/文本导入、归档/恢复/删除、历史版本、稳定段落引用、来源与显式关系 |
| 集合 | 静态/动态集合、嵌套与循环检测、多集合引用、项目引用、按需概览与过期标记 |
| 检索 | 中文分词与双字索引、SQLite FTS5/BM25、配置后的真实 Embedding、余弦召回与 RRF、项目/集合/层级过滤 |
| URI | 统一寻址、版本、段落、精确读取、完整工具结果分段读取 |
| 任务 | 状态、进度、执行者、依赖校验、完成证据、看板拖动、并发修订检查 |
| Agent | 流式模型协议、Tools、Turn/Step、持久 Inbox、插话/排队、工具账本、取消、重复调用提醒、确认卡、上下文摘要 |
| Bot 协作 | 长期身份与独立项目会话、消息去重、派活树、等待、结果回传与唤醒、跨项目总助路由 |
| 恢复 | 等待关系保留、持久事件重建、崩溃后未知工具结果显式化、人工检查后继续 |
| 视图 | 基础组件和 16 种阅读/分析表达、Live/Snapshot、数据绑定、增量 patch/CAS、多项目挂载、固定入口、React Flow 画布、连线/分组/锁定/整理撤销、阅读布局/图墙、选择回传 |
| 插件 | JS/TS/TSX、Manifest/Schema、编译、隔离 iframe 预览、用户批准、不可变版本、停用、交互状态持久化 |
| 本地服务 | SQLite WAL、单写入宿主锁、SSE 实时事件与重连、后台摘要/索引作业、业务 JSON 导出 |

## 设计与代码组织

界面保留第三版的深色中性色、248px 导航、项目工作区与负责人侧栏；使用从 Figma 实际导出的 SVG 图标。前端主体保留**原生 ES Modules + CSS**，画布以 React Flow 独立挂载；插件的 TSX 编译到内置 `h()` DOM 工厂，也不依赖 React。React Flow 与 PDF.js 构建为本地静态资源，未迁移 API、URI 或业务对象模型。设计映射见 [设计实现记录](docs/DESIGN.md)。

```text
server/runtime/      Agent、Inbox、去重、派活与恢复
server/services/     知识/集合、检索、模型、视图插件
server/tools.mjs     36 个应用与执行工具
server/db.mjs        SQLite 结构、事务与持久事件
server/index.mjs     本地 HTTP API、SSE 与资源服务
shared/              URI、Schema 校验
web/                 九类业务界面、交互、视图渲染、沙箱
examples/plugins/    可运行的插件示例
upstream/            固定上游提交与代码来源映射
licenses/            上游许可
scripts/             启动与检查
```

## 测试与已知边界

2026-11-13 构建通过 **75 项 Node 自动化测试 + 原有 22 项浏览器交互场景**，另有新增设计浏览器套件覆盖画布分组/撤销、PDF/图片/音频、组件库、头像与 1440×1024 / 390px 布局，包括真实本地 HTTP/SQLite/模型流式协议、A→B→C 回传、动态插件实际渲染和 SIGKILL 故障恢复。详细证据在 `tests/artifacts/` 和 [测试报告](docs/TEST-REPORT.md)。

**测试模型是明确标记的确定性 HTTP fixture，不是真实大模型**；交付时没有你的 API Key，所以没有执行真实服务商的长期任务与内容质量验收。生产没有 mock AI 模式。本轮已在 macOS 原生 Chrome/Chromium、本地 HTTP 与生产 CSP 下完成浏览器验证，没有修改浏览器策略。厂商 API 内容质量与长期任务仍需真实配置后验收。

本版不是“完整 DSH 成熟度”的承诺。尚未包含：MCP/ACP 接入、外部 CLI Agent、旧 Office/EPUB 专门解析、原生 macOS 安装包、多人权限/云同步、独立向量 ANN、专用 cross-encoder 重排服务、插件市场。完整边界见 [已知限制](docs/KNOWN-LIMITATIONS.md)。

## 数据与备份

正式目录默认 `~/.lede`；演示目录默认 `~/.lede-demo`。可通过 `LEDE_HOME` 更改：

```sh
LEDE_HOME="$HOME/Projects/lede-data" PORT=4317 npm start
```

`lede.sqlite` 保存业务数据、版本、索引与运行日志；`providers.json` 保存提供方设置与 Key（文件模式 0600）；`workspace/` 是文件工具的默认目录。一个数据目录同时只允许一个服务进程。默认全部空间属于本地用户，不提供多用户访问隔离。

设置中的 JSON 导出只导出业务数据与插件定义，**不是完整运行时备份**，也不包含密钥。完整迁移应先停止服务，再备份整个数据目录，包括数据库、附件与配置；恢复时同样保持服务停止。包含 `providers.json` 的备份须按敏感文件保管。

## 文档入口

- [源码提取与变更对照](docs/UPSTREAM.md)
- [架构与数据模型](docs/ARCHITECTURE.md)
- [API、Tools 与 URI](docs/API.md)
- [视图插件开发](docs/PLUGIN-SDK.md)
- [需求验收矩阵](docs/ACCEPTANCE.md)
- [测试报告](docs/TEST-REPORT.md)
- [安全边界](SECURITY.md)
- [后续接手说明](AGENTS.md)

离线打开 `delivery/index.html` 可以浏览本次交付说明与真实运行截图；它不是应用入口。

项目持续性使用说明与边界：[内部记忆与跨轮目标（负责人固定）](docs/PROJECT-CONTINUITY.md)。

## 当前设计实现

详见 [2026-11-13 设计实现与验收](docs/DESIGN-IMPLEMENTATION-20261113.md)。

- 图片/PDF/音视频原件保存到 `blobs/`；图片框选、PDF 页/文字、音视频时间标注均可作为版本化引用。
- PDF 在浏览器本地提取文字；图片识别使用支持图像输入的聊天模型；转写在设置中单独配置兼容服务。无服务或失败时不生成模拟结果。
- `npm run test:design-ui` 运行新增原生浏览器测试（先安装 Playwright Chromium）；完整旧版套件可按测试记录的原生 Chrome 命令运行。

项目总览按 Figma 168:5858 实现。目标与项目信息通过对话维护，不提供目标、记忆、交接表单。负责人用 `project.report` 发布带日期、摘要和来源的汇报，用 `project.overview` 绑定独立 ViewSpec；自动 L0/L1 不改写看板。
