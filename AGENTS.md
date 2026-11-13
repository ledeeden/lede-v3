# Lede 工程交接规则

先读 README、docs/UPSTREAM.md、docs/ARCHITECTURE.md、docs/KNOWN-LIMITATIONS.md。

1. 不要把 DSH、DS-Bot 整体加入项目。提取的逻辑通过明确接口连接；用户要项目，不要 Bot 列表和群聊成为主界面。
2. Project 是业务身份；Lead Bot 可更换。Bot 身份、Session、Run、Handoff Work、业务 Task 不混用。
3. 方法论是知识对象与集合，不新增 Method 引擎。权限是未来扩展点，不冒充已经隔离。
4. SQLite 事务中不得 await。所有外部 IO 都明确标记；未知副作用不得自动重放。
5. 工具调用和结果写持久账本，流式增量不能被当作最终事实。保留成对的 tool-call/result。
6. 编辑资源与 ViewSpec 使用 baseRevision。重复请求复用 request_id；有歧义时返回 uncertain。
7. 普通知识不强制生成 L0/L1；摘要记录源签名并判断过期。语义检索不伪造 Embedding。
8. 删除对象只清对象与直接关系，不自动纠正其他知识。不要声称删除清掉了日志、备份、模型服务商已有副本。
9. 代码插件只在无 same-origin 的 iframe 内执行。不得给插件 Token、主机 fs 或数据库。注册由用户确认。
10. 生产代码无“演示模型”。tests/fixtures 只能用于测试；示例内容必须显式标记。
11. UI 修改后跑 Node 测试和浏览器测试，核对 1440×1024 与390px布局。不要为跑浏览器而修改企业策略。
12. `npm run check && npm test` 是最低门槛。对真实服务商/平台没有实测就不要写“已通过”。
13. 保留 MIT/Apache 许可证、上游 SHA、移植说明和 modified 标记；不要把适配实现说成原封不动的上游 SDK。

当前版本使用原生浏览器 ES Modules。迁移 React 可作为独立工程，不应借迁移更改 API、URI 或对象模型。
