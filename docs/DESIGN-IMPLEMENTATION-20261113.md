# 当前设计落地与验收

范围：Figma `roN4ySdKkS8eYopaKXkyFD` 当前 v0.3 深浅主稿、组件和 Bot 形象；不包含归档或未采用方案。按用户约定使用 React Flow；引用只记录 AI 工作中使用的内容与位置，不加可信度/支持/反对判断。

## 已落地

| 设计能力 | 实际实现 | 主要位置 |
|---|---|---|
| 画布 | React Flow 节点、连线、缩放、小地图、多选分组、锁定、缩放尺寸、整理与撤销整理，CAS 保存 | web/canvas/index.jsx、plugins.mjs |
| 阅读组合 | 卡片/长文/画布/图墙模式、排序/显隐、便签作为知识对象、引用已有知识、快照、挂载与移除挂载 | web/app.mjs |
| 原件 | 上传/鉴权读取/Range；图片、PDF、音视频、DOCX、XLSX、PPTX、代码、ZIP；未知类型保留下载 | assets.mjs、documents.mjs、web/media.mjs |
| PDF | 页面缩略图、页码、缩放、目录、文字选择、本页批注、全文搜索、本地文字提取和页码索引 | PDF.js 本地构建 |
| 音视频 | 原生播放、速率、字幕导入、转写检索/跟随、时间批注、兼容服务转写 | media.mjs、providers.mjs |
| 图片与图墙 | 区域批注、放大、分类/文字过滤、两个区域裁切比较、视觉模型文字提取 | media.mjs、gallery.mjs |
| 引用 | 每次引用分别记录，版本化目标与源段落，反向查看、双向跳转、Agent Tools | references.mjs |
| 项目动态 | 持久消息、工具调用/结果记录，成员入口、指定成员对话、用户纠正同步负责人 | workspace.mjs、coordinator.mjs |
| 事项看板 | 全局/项目过滤，待决定/推进/受阻/完成，目标、里程碑、决定与任务关联编辑 | workspace.mjs、app.mjs |
| 输入框 | 附件、知识/集合/视图/指令/会话引用、常用指令、本次模型/思考强度/只读模式、停止 | app.mjs、kernel.mjs |
| 组件库 | 16 种阅读/分析表达与既有基础组件、分类检索、真实数据绑定、加入视图、代码插件原有流程 | shared/blocks.mjs、catalog.mjs |
| 主题与形象 | 深浅切换、实际 Figma 头像资产、自动分配/手动选择/恢复自动、形象描述保存 | avatars.mjs、workspace.css |
| 检索 | Hybrid Search + 模型相关性重排 + 预算化原文上下文；引用导航、页码/时间 locator | retrieval.mjs、search-context.mjs |

## 验收证据

- `npm run build:web`：React Flow 构建，PDF.js worker/字体/字符映射等资源本地化；依赖许可证汇总。
- `npm run check`：源码语法检查；JSX 由 esbuild 构建验证。
- `npm test`：75 项通过，包括新增原件鉴权/Range、批注去重/CAS/历史定位、引用多次出现、画布操作、只读执行、成员纠正、图像请求、转写 multipart 和 Office/ZIP 解析。
- `tests/design-ui.mjs`：原生 Chromium，1440×1024 与 390px，画布拖动/分组/整理撤销、文件上传、PDF 提取、图片批注、字幕定位/搜索/批注、组件加入视图、头像持久化、主题与布局。
- 原有 `tests/ui.test.py`：22 个场景以原生 Chrome 模式通过，含插件隔离注册、挂载、选择回传、Agent 工具创建产物、知识版本、项目持续性。
- 截图：`tests/artifacts/design/`；原有回归报告：`tests/artifacts/ui-report.json`。

原生完整回归命令（需 Python Playwright）：

```sh
LEDE_NATIVE_BROWSER=1 LEDE_TEST_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' python3 tests/ui.test.py
```

所有模型协议测试使用 tests/fixtures 中明确标记的 HTTP fixture。没有执行真实模型的内容质量、OCR/ASR 准确度与长期运行验收。

## 尚不能算完整设计验收的部分

- 页面功能已接数据，但未逐像素完成所有设计稿：组件缩略预览、全部头像状态动画和复杂长文排版仍有差距。
- Office 是内容阅读，未复现原始分页/字体/图表/动画，表格不重算公式；ZIP 不执行或解压到主机路径；旧二进制 Office/EPUB 无专门阅读器。
- PDF 提取依赖原有文字层，不等于扫描 OCR 或自动表格恢复；视频自动语义章节、说话人分离未实现。
- 头像描述只持久保存，未配置生成新头像的图片服务。
- 画布撤销目前针对整理操作，尚无全局跨操作撤销历史。

这些边界没有以模拟模型、假数据或不可见 stub 冒充完成。详见 KNOWN-LIMITATIONS.md。
