# 全局搜索 · 2026-11-13

实现对应 Figma `roN4ySdKkS8eYopaKXkyFD` 的 S1–S3（146:4091）：快捷弹层、完整结果页、无结果与相近匹配。沿用原生 ES Modules，搜索图标从设计下载到 `web/public/assets/search/`。

- 侧栏「搜索」或 ⌘K / Ctrl+K 打开；结果页上该快捷键聚焦搜索框。
- 输入实时检索；↑↓ 选择、Enter 打开、⌘Enter / Ctrl+Enter 引用、Shift+Enter 查看全部；搜索框 Tab 将问题带到总助草稿，其他位置仍使用原生 Tab 导航。Esc / 点击遮罩关闭弹层。
- 结果按知识、集合、项目与事项、动态、视图、决策分类。支持项目、本周/本月、是否进入集合、相关度/更新时间筛选，以及 `type:报告 project:"英语 App"` 查询语法。
- 预览真实片段、版本 URI、已有概览及项目/集合归属。归档对象与失效概览不参加检索；知识结果保留版本/段落定位。动态结果打开对应项目消息，旧消息可通过 event 参数读取历史窗口。
- 「引用到对话」设置引用上下文，不自动发送。「让总助去找」和负责人调研入口写入草稿，不宣称联网完成；沿用已有模型设置与用户发送流程。

## 接口与边界

新增 `POST /api/search/global`，参数：`query,type,projectId,time,saved,sort,offset,limit`。返回 `results,related,counts,total,terms,elapsedMs,mode,offset`。默认每页 50，最多 100；弹层显示前 8 条。分类数量按当前项目/时间/状态范围计算，类型筛选独立；total 为最终筛选结果数。空查询列出当前资源。

这是本地文本匹配，查询分词全部命中才作为正式结果，部分命中仅进入明确标注的相近结果；不调用 Embedding 或重排模型。原有 `/api/search` 与 `knowledge.search` 的混合检索保持原接口与行为。视图检索已保存的标题、文字和列名，不执行动态绑定；活动仅检索持久 user/assistant 消息，不把流式增量或工具账本拼成消息。项目与 Bot 身份不混用。

当前扫描本地资源、片段与持久消息，无额外索引缓存；未做大规模资料性能评测。无真实服务商联网调研验收。

## 验证

- `npm run check`、`npm test`。
- `node tests/global-search-ui.mjs`：真实本地 HTTP/SQLite + Chromium，独立临时数据目录；1440×1024 与 390px，弹层/结果页/空结果、键盘、侧栏预览、引用草稿、动态定位、异步旧响应防覆盖。
- 截图在 `tests/artifacts/search/`。fixture 文案只存在测试文件，不注入生产数据。
