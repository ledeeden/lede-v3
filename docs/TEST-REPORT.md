# 测试报告 · Lede v0.3

交付日期：2026-11-13。测试针对本包源码，不是仅对设计稿演示。

## 汇总

| 类别 | 结果 | 证据 |
|---|---|---|
| Node自动化 | 38 passed / 0 failed | tests/artifacts/node-tests-final.txt |
| 浏览器交互 | 20 passed / 0 failed；pageErrors为空 | tests/artifacts/ui-report.json |
| 界面证据 | 13张真实应用截图 | tests/artifacts/01–13*.png |
| 代码检查 | 源码语法与sandbox脚本检查 | tests/artifacts/check-final.txt |

Node22.16.0，内置SQLite；Python Playwright + Chromium。没有在用户Mac运行，也没有用户模型Key。

## 自动化覆盖

- data：URI校验与历史段落、CAS、直接删除与索引清理、集合/项目多对多、动态集合、依赖与中文FTS、真实HTTP Embedding协议、Host/Origin/Token。
- plugins：Manifest/Schema、TSX编译、外部导入拒绝、用户注册门槛、版本不可变、Live/Snapshot、Mount、选择来源、不能从通用资源接口绕过组件校验、沙箱策略。
- runtime：持久Inbox splice/claim/replay、并发请求去重和unknown、跨项目Session、A→B→C依赖、模型缺失明确blocked、真实工具落盘、Tool错误回传、用户确认、Step预算、取消、输出截断、单宿主锁。
- collaboration：实际HTTP流驱动A→B→C、总助跨项目委派、执行中插话、Agent生成插件并等待用户注册、集合概览、SSE重连。
- recovery：真实spawn子进程与SIGKILL。外部测试工具已写标记但没提交结果时，重启记录unknown且没有重复执行；等待树重启继续对账。
- context：大工具输出URI分段读取、同Turn内完整Step边界压缩、插件交互状态、通用任务API证据要求、长文摘要不生成空输入。

## 浏览器覆盖

九个设计界面、项目创建、知识创建与版本、中文搜索、集合成员增删、任务证据、插件真实iframe预览/注册/挂载/选择、模型配置、UI消息→Agent工具→知识落盘→视图生成→负责人回复、画布位置持久化、390px无横向页面溢出。

## 测试方法边界

### 模型

`tests/fixtures/model-server.mjs` 是独立的确定性HTTP协议服务，发送碎片化SSE工具参数和响应。**它不进行AI推理**。应用的生产Providers/Tools/SQLite/队列/派活/视图路径全部照常运行，测试不是直接修改数据库假装模型成功。

这些测试证明协议与状态闭环，不证明真实LLM质量、所有提供方兼容性或长期自主完成能力。生产不加载fixture，也没有mock按钮。

### 浏览器

当前环境Chromium有禁止URL导航的管理策略。测试没有修改或绕过这类策略；使用 `page.set_content()` 加载实际应用模块（仅测试打包），Python bridge仅转发本地 `/api/*` 到真实服务，sandbox使用相同HTML作为opaque srcdoc。生产仍是原生ESM、HTTP和EventSource。独立Node测试验证了真正的SSE网络与重连。

因此没有把“DOM通过”写成“生产CSP已完整通过”。本机启动后仍需普通浏览器测试。可用原生测试开关：

```sh
# 另行安装Python Playwright与可运行Chromium后
LEDE_NATIVE_BROWSER=1 \
LEDE_TEST_BROWSER="/实际/Chromium/可执行文件" \
python3 tests/ui.test.py
```

默认测试使用 `/usr/bin/chromium`；未安装浏览器的电脑只运行Node测试即可，不要为了测试修改管理策略。

## 重现

```sh
npm run check
npm test
npm run test:ui
```

测试创建独立临时目录，结束后清理，不触碰正式 `~/.lede`。

## Mac与真实模型验收清单

- 启动正式空工作空间，配置服务商、Key与实际模型，测试普通对话和工具。
- 新建项目/导入资料/检索原文，验证引用与中文。
- 让负责人创建执行Bot并完成A→B→审查→负责人回传。
- 真实Embedding构建后查询同义表达，对比FTS与hybrid标记。
- 插件生成、编译、真实浏览器预览、注册、挂载、选择与刷新后状态。
- 关闭浏览器再打开，确认服务中任务还在；停止/重启服务，确认未知结果提示。
- 调试长上下文、服务商限流与网络中断，并评估Token成本。

以上是待验收项，不是在当前环境已经执行的记录。

## 2026-11-13 持续工具循环回归

- `npm run check && npm test`：40 个 JavaScript 模块检查无错误，49 项 Node 测试通过。
- 新增长循环覆盖：保留旧 maxSteps=2 的 Bot 连续执行 30 个工具步骤、60 个工具调用后自然完成；3/5/8 提醒出现在整批结果之后，新用户输入重置；超过旧默认上限仍能取消。
- 保留上下文压缩、确认、截断、A→B→C 回传、SIGKILL 恢复与未知副作用不重放回归；摘要筛选真实用户原话，不受系统提醒挤占。
- 本机 Chrome 原生导航：21 项浏览器场景通过，无 page error。Bot 配置截图核对 1440×1024 与 390×844；相关截图为 `tests/artifacts/loop-bot-settings-1440.png` 和 `loop-bot-settings-390.png`。
- 测试使用独立临时数据目录、确定性 HTTP 模型 fixture；不是实际模型内容质量或长时间成本验收。未修改浏览器企业策略。

## 2026-11-13 项目持续性增量

本机 check 与62项 Node 测试通过；22项原生 Chromium 浏览器场景通过（1440×1024、390×844），包括记忆维护、多阶段目标、负责人交接。记录见 tests/artifacts/continuity-check.txt、continuity-node-tests.txt、ui-report.json。新增模型测试为确定性 HTTP fixture，不是真实提供方验收。详见 PROJECT-CONTINUITY.md。

## 沟通页验收（2026-11-13）

Node 全套 104 项通过，check 83 模块无错。隔离 HTTP fixture 经浏览器验证 1440×1024 与 390×1024：左侧沟通入口、固定总助/负责人、隐藏无用户沟通的后台成员、关键消息、发送与接收、确认卡处理、手机返回列表及无横向溢出。浏览器没有修改企业策略，测试内容明确标记，未用真实项目发送测试消息。
