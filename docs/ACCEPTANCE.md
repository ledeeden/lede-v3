# 需求验收矩阵

本表区分“实现”与“实测”。测试数据不代表真实研究结果。

| 用户要求 | 交付实现 | 测试证据 |
|---|---|---|
| 第三版设计 | 9类业务界面、原始Figma SVG、暗色工作台 | UI 01–09、390px截图 |
| 项目为中心 | 创建负责人、项目资料/进展/成果、总助路由 | data、collaboration、UI项目创建 |
| 数据结构与存储 | SQLite WAL、版本/关系/集合/任务/视图/运行表 | data、锁与崩溃测试 |
| 统一URI | 身份/版本/段落/运行输出读取 | data URI tests、context spill |
| 知识关联 | 显式关系、多项目引用、多集合引用 | data、UI关联/版本 |
| 集合与选择性L0/L1 | 静态/动态/嵌套；签名过期；LLM L1与L0提取 | data、collaboration summary、长文采样test |
| 混合检索 | 中文FTS、Embedding协议、余弦/RRF、Scope、证据位置 | data FTS/embedding、UI搜索 |
| 项目任务 | 状态/依赖/执行者/证据/CAS/看板 | data、context证据门槛、UI任务 |
| 成熟Agent相关基础 | 从上游移植Inbox/Turn/Step；真实模型适配与工具账本 | runtime工具循环/取消/截断/确认、38 Node tests |
| Bot通信 | 长期身份、项目Session、去重、派活树、唤醒/回传 | runtime、collaboration A→B→C |
| 不导入整套DSH/DS-Bot | 明确源码映射，生产无它们的产品依赖 | UPSTREAM、manifest、package.json |
| 插件生成注册 | Bot propose/build、用户preview/register、不可变版本 | plugins、collaboration、UI实际iframe |
| 动态视图 | 八类组件、绑定/CAS增量、Live/Snapshot、Mount | plugins、UI生成/拖动/选择 |
| 对话上下文 | 段落/模块/数据点选择回传 | UI知识选择、iframe数据选择 |
| 本地后台工作 | 浏览器与服务分离、持久队列/等待 | SSE、SIGKILL两项恢复测试 |
| 保存应用 | 源码ZIP、文档、测试、截图、启动脚本 | 最终打包与Library记录 |

## 不能由此表推出的结论

不代表真实模型必定完成每个研究任务、不代表生产级安全认证、不代表Mac实机或全部DSH行为通过。真实服务商与Mac浏览器验证仍待用户配置后的验收。MCP、外部CLI、多用户、二进制资料解析不在已实现列表。
