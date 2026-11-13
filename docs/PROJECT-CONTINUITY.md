> 2026-11-13 产品规则更新：项目负责人固定，不支持更换或交接。下文涉及交接的旧实现仅保留为历史说明。目标与记忆通过对话维护，不再暴露独立编辑入口。

# 项目持续性：记忆、目标与负责人交接

2026-11-13。参考 DS-Bot `a66cc737cfb6c3d8a2597e748cded6cab1206dd3`，Modified，Apache-2.0。来源文件与 blob SHA 在 upstream/manifest.json。未引入群聊、Cordis 或第二套 Agent 内核。

## 长期记忆

项目标题栏「记忆」管理项目记忆，也可进入共享记忆；执行团队里管理 Bot 记忆。支持编辑、固定、到期、遗忘和查看版本历史。项目记忆随项目保留，负责人更换不会转为旧 Bot 的私有资料。共享记忆仅用户维护。

每个有新用户原话的回合结束后，调用真实模型整理长期偏好、决策和纠正。只提交用户来源，不把工具结果、下游回复和自动目标检查当用户原话。每次最多处理8条用户消息、每条4000字符和8项修改；尚未处理的消息留给后续回合。条目记录原话 Session/event URI；resource.read 可以分段读取原始会话。失败保留游标，下一次回合重试；写入期间用户修改会令本次整理失败，而不是覆盖新版本。固定项不能由模型改写。

记忆整理是额外模型调用，用量归属对应 Project/Bot/Run，purpose=memory。自动筛选与秘密检测不能保证完美；可通过界面纠正。提示中注入有界的记忆集合，完整条目可 memory.recall 查询。遗忘是从有效记忆移除，历史、会话、备份和模型服务商已有副本不随之清除。删除项目/Bot 只删除直接归属的当前记忆，审计历史保留。当前没有自动每日整理或独立语义记忆索引。

## 跨轮目标

项目标题栏「目标」设置完成标准、约束和有序阶段。每个阶段引用现有项目 Task，不重复创建另一套业务任务。多个阶段可在表单添加；负责人可通过 project.goal start/revise/pass/rework/complete/pause/block/stop 维护目标。变更使用 baseRevision 与 request_id，重复请求返回同一回执，改内容复用同一 ID 返回冲突。

阶段通过要求所有关联 Task 为 done 且有 evidence，并记录独立验收证据；全部阶段通过后，还必须提供整体证据和总结。它校验证据存在，不自动保证内容正确。返工把本阶段已完成任务退回 review。已通过阶段后不可整体替换阶段表；目标方向大改可以结束旧目标再建立新目标，历史保留。

当前回合成功结束，且项目无运行、未结清 Work、收件箱消息或确认卡时，持久化目标检查并唤醒当前负责人。默认连续三次检查仍无阶段或任务状态/证据进展，转为 blocked；阶段通过和具体任务进展重置计数。等待下游依靠原有派活回传唤醒，不轮询模型。暂停只停止自动跨轮续跑，已开始的工作可以结束；需要立即终止使用执行团队的停止按钮。停止目标保留已有工作与成果，不删除业务任务。

错误、截断、用户取消使目标待处理；服务重启将 active 目标置为 blocked、清除尚未执行的自动目标检查，用户核对日志后恢复。不会以“目标未完成”为理由重放未知外部调用。恢复只能由用户操作。尚有未结清的失败/中断运行时，恢复会明确拒绝；先在执行记录重试或结束对应派活，避免目标显示推进中却无人执行。无模型配置时真实显示 blocked，无演示模型兜底。

## 负责人交接

标题栏「交接」选择新负责人，原「编辑项目」的负责人修改也经过同一服务端事务。项目有运行、未结清派活、排队消息或确认卡时拒绝切换；先完成、停止或明确放弃这些工作。模型正在整理记忆时也暂缓交接，避免异步结果归属混乱。

交接包包含项目修订、目标、任务及证据、资料 URI、项目记忆、旧会话摘要、最近5条用户原话和完整历史入口。包与负责人修改原子提交；新负责人 Session 独立，旧工具调用和结果不复制、不重放。下次真实对话自动注入有界交接上下文。当前活跃目标在交接时暂停，由用户恢复后交给新负责人推进。交接不迁移旧 Bot 的个人记忆。

## API

- GET /api/memory?scope=project|bot|workspace&owner=ID；all=true 包括遗忘/过期条目。
- POST /api/memory：scope、owner、text、source、until、pinned；编辑/遗忘携带 id、baseRevision，deleted=true 遗忘；可传 request_id。
- GET /api/memory/history?id=ID。
- GET /api/project/continuity?projectId=ID：当前目标、负责人最近交接包及交接列表。
- POST /api/project/goal：projectId、action、baseRevision、request_id 及动作字段。
- 原 POST /api/resource/update 更改 leadBotId：保留 baseRevision 语义，HANDOFF_BUSY 表示项目仍有待结清工作。

SQLite 新表用 CREATE TABLE IF NOT EXISTS 添加，不改原对象 URI。goal_history、memory_history、lead_transfers 保存审计事实。JSON业务导出包含当前记忆与目标，但不是运行时完整备份。

## 本次验证

- npm run check：44 个 JavaScript 模块及沙箱脚本，0 错误。
- npm test：62 项通过，包含13项新增持续性测试。记录：tests/artifacts/continuity-node-tests.txt。
- 原生 Chromium 本地导航：22 项浏览器场景通过，0 pageErrors；1440×1024 与390×844，记忆、分阶段目标与负责人切换均完成实际点击和数据核对。记录：tests/artifacts/ui-report.json；截图 continuity-{memory,goal,handoff}-{1440,390}.png。
- 浏览器测试复用本机 Playwright 环境，回环 HTTP 绕过代理，没有修改企业策略。模型协议与自动记忆使用确定性 HTTP fixture；未执行真实模型的内容质量或长时间成本验收。
