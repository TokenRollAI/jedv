# DECISIONS

## D1 — 目标与完成口径

- 决定：交付原总体 Plan 的 M1–M5 完整产品结果，M0 只是可信投递基础；六份目标文档完成不等于产品完成。
- 理由：用户明确“继续直到原总体 Plan 全部完成”且“完整产品结果才勾 ALL DONE”。
- 影响：DOD 必须覆盖全部 SC/UC、E1–E3 和最终 review，任何单里程碑完成均继续推进。

## D2 — 需求权威与安全细化

- 决定：当前用户指令优先；原 Plan 提供产品范围，`docs/plans/teamwork-runtime-contract.md` 对 M0/M1 的身份、排序、恢复、双轴和预算语义作强制安全细化。
- 理由：旧 Plan 的简单 `Stop`、`hop_count` 终生累加和直接外键预分配不足以处理真实乱序 Hook、独立任务与 SQLite 外键时序。
- 影响：不得以旧 Plan 简表为由削弱 fail-closed、planned/actual ID 分离、read≠ack、独立新任务不被历史 hop 锁死等要求。

## D3 — Jedv 分工与文件所有权

- 决定：Carbon 负责后续架构，Codex Sol 负责主要实现，goal-package 这位 Kimi worker 负责目标包和证据；根协调器负责编排、设计、集成和验证，通过现有 Jedv 会话协作，不另自派模型替代指定角色。
- 理由：用户明确角色与任务映射；“仅六文件”只是 goal-package worker 的授权边界，不是整个根协调器的权限限制。
- 影响：仅 goal-package 这位 Kimi worker 限编辑本目录六文件，根协调器不受此限制并可编排设计、集成和验证；Codex 当前独占 host-service/cli/agent-setup/必要 shared；Carbon 仅写后续架构契约。后续并行必须先划分不重叠所有权，否则串行。

## D4 — 工作区与不可破坏边界

- 决定：继续使用 workspace `8c71d9ac-61de-4f1e-9ef4-5c2db894f0d1` 和 `feat/teamwork-m0` 当前未提交工作树，不清理或覆盖既有 M0 修改；禁止 commit/push/发布。
- 理由：M0 与后续实现共享未提交基线，另起干净 worktree 会丢失必要依赖。
- 影响：所有 worker 只改授权文件；测试使用临时 Profile/仓库/数据库/端口，不能改真实 `~/.jedv`、用户 wrapper 配置、活跃终端、私网机器或共享生产数据。

## D5 — 真实终端与数据运行时

- 决定：Team 成员锚定真实 TerminalAgentBinding 启动身份；Worker 复用真实 Agent 启动和 setup 证据；Mail 自动写入统一经 `sendAutomaticAgentMessage`，不确定 staged/inflight 不重放。
- 理由：裸 terminalId、UI Stop 或接收时间不能证明自动写入安全，盲重试会重复文本、PTY 或 Worktree。
- 影响：source producer 必须在事件发生时同步原子取号；Host 恢复先对账；人工输入使旧许可失效；stop 保护原地 Leader，archive 不删 Workspace。

## D6 — UI 设计与验证顺序

- 决定：M2、M4、M5 每个 UI 实现前先完成对应 Pencil 设计，复用现有 Jedv 组件/主题，Butler 位于左侧栏底部且不遮挡终端。UI 必须认真优化，功能与美观同等重要；以图标为主、减少冗余文字，Leader 使用专属 crown 等标识，harness 复用现有 AgentIcon 品牌图标；成员卡的终端快捷按钮位于内容右侧，不在左下单独占行；重要状态和操作保留 tooltip、aria-label 与键盘焦点。
- 决定：侧栏增加与项目同级的可折叠 **Teamwork** 目录，团队在目录内选择；原顶部 Teamwork 导航改为创建团队入口；详情右上角 team dropdown 移除；Workspace badge 保留。创建团队表单选择既有、有效且未入队的 Agent 为 Leader。
- 理由：用户明确 Pencil 先行、产品主次关系、最新 Teamwork 信息架构及上述 UI 质量与可访问性要求。
- 影响：`docs/design/teamwork.pen` 与 `NM8H3.png`、`c6jyH.png`、`Aft5I.png`、`o1GQt.png` 是当前设计证据；正文右侧 terminal 图标布局已经 GUI 确认，其余设计仍须实现和验收。设计未完成时可以做独立后端/fixture，但不能先写对应 UI 后补设计；最终必须隔离 Profile 真实 GUI、亮暗主题、移动视口、图标与标识、tooltip/aria-label/键盘焦点、Lingui `check:i18n` 和 typecheck。

## D7 — Memory、DeepSeek 与 WatchDog

- 决定：global/project/team 三层隔离，主动能力不依赖 AI Key；被动提炼可追溯并按受控规则更新，不直接覆盖 global；Team 归档封存黑板。
- 决定：DeepSeek 只使用用户已配置凭证，前端仅暴露脱敏状态；本地 fake 端点验证契约。缺 Key 或请求失败时主动 Memory、spawn、规则 WatchDog 和基础 Butler UI 可用。
- 决定：WatchDog 30 秒规则巡检零 Token、告警去重且不自动杀进程；告警不触发 Butler 写工具。
- 理由：可选智能服务不能成为本地核心流程单点，也不能把告警提升为隐式授权。
- 影响：无 Key 是必测主路径；live 无凭证时明确未验证且不付费，不作为伪造通过或阻塞 fake 验收的理由。

## D8 — Butler 授权

- 决定：Safe Tools 与 Guarded Tools 服务端分权；给 Leader 的指令附人类原话。危险操作先生成审批意图，确认时服务端原子 claim、校验过期并保证至多一次执行。
- 理由：前端按钮和模型自述不是授权边界，重试/并发不能重复破坏性操作。
- 影响：未确认、拒绝、过期和重复确认均需零副作用或幂等证据；授权卡同时服务桌面与 Mobile。

## D9 — 跨 Host、Mobile 与扩展

- 决定：跨 Host 验收用本机两个隔离临时 Host Profile 注入断连/重试/重启，不操作真实 Tailscale 私网机器；outbox/ingest 幂等并使用受限 peer 凭证。
- 决定：PWA 只含 Butler、WatchDog/审批、Team/Cron 三屏，登录会话可过期/退出，审批复用服务端边界。
- 决定：插件采用 `teamwork.header`、`sidebar.panel`、`mail.provider` 等声明式 slots 和公开 OpenAPI/受限 SDK，禁止任意 DOM/代码，不暴露 Host 管理 PSK，不恢复 marketplace 发布或已删除产品功能。
- 理由：满足可靠延伸和可扩展性，同时控制凭证、远程副作用与宿主完整性。

## D10 — 验证、review 与 Issue 纪律

- 决定：实现中途只做功能验证和失败修复；所有实现与端到端功能验收完成后只做一次集中深度 review，再对修复做定向复验。
- 决定：worker DONE 只是声明，协调器必须看实际 diff、独立执行功能检查并记录证据；测试红或 GUI 未做不能勾验收。
- 决定：Jedv 发现的问题先查重再提交 `TokenRollAI/jedv`；已知 #1 Carbon、#2 Kimi、#3 ABI、#4 Agent 配置隔离，不重复创建。补充追踪：#5 rrule 互操作修复未 commit，已纠正最初误称 baseline 问题的记录；#6 `dev --watch` 重启会杀 QA daemon，当前采用无 watch 固定后端 snapshot；#7 `panes` CLI 对活跃本地窗口仍报 `No signed-in desktop window`，已提交 <https://github.com/TokenRollAI/jedv/issues/7>，未修复前不得当作功能完成。
- 理由：避免中途反复架构评审拖延实现，同时保留最终质量门槛和可追溯证据。

## Open technical choices (not user scope questions)

- Carbon 后续契约需根据现有源码确定具体 tRPC/OpenAPI shape、普通目录 capability、FTS 中文实现、Memory 预算、审批存储、outbox 状态机和 slot schema；这些是实现选择，不得改变 D1–D10 的用户结果。
- Pencil/GUI 的实际工具调用路径待验证；若不可用，记录受影响 UI 项并继续独立后端工作，不能悄悄跳过强制设计/GUI 验收。
- DeepSeek live 是否可测仅取决于用户环境已有合法配置；不读取或复制密钥值，不发起付费请求。

## D11 — 用户迭代：任务优先与统一组件

- 最新创建入口默认直接开始新Task，自动创建并指定Leader；原D6中选择已有Agent的默认流程降为次级入口。Host负责幂等team.start，不让UI串无幂等run/init或依赖模型自举。
- 统一应用内Option/Tabs、目录标题字体；底部设备状态栏固定左下；AgentIsland快捷开关收进现有外观设置，保留偏好；Butler用烟斗图标；成员状态固定卡片右上。完整可核验项见UI-ACCEPTANCE.md。
- 以上是用户明确范围修订，仍保留M1–M5全部目标；只在全部实现结束后集中deepreview。

## D12 — Butler 系统空间与高密度 UI

- 用户否定底部 dock；Gemini/Kimi 三轮讨论收敛为 Teamwork/Projects 上方唯一置顶系统空间，非真实 Git Project，无 Agent 选择；默认建议/审批单流、同源聚合、按需对话。D6 的底部定位被本条取代。
- 用户进一步要求 Teamwork 也经过多轮讨论，最终达到美观、优雅、实用、高信息密度；无价值口号/解释/重复内容不展示。具体反例是 Butler 标题下“关注重要的事，随时回到工作现场”，必须删除。
- Butler 每项业务能力均需公开 CLI 直接可达，其他 Agent 使用同一服务和权限/审批/幂等；不能把 Butler 做成特权或模型独占后端，不能用 CLI 绕过人工授权。

## D13 — Butler 对话与会话产品模型（已收敛并实现）

- 用户否定当前空待办主区+窄右侧聊天布局，要求重新设计；后续又要求与Gemini/Kimi讨论Butler是否需要session。
- 主区聊天稿Wd34v是讨论稿，尚未据此实施聊天结构。需先区分持久历史、模型上下文、产品可见会话和原生harness session，再定产品模型。
- 既有聊天记录、用户设置必须保留；不得为简化UI删除/合并旧thread或自动重放动作。独立Attention/CLI工作继续，完整goal未暂停。

### D13 收敛结果

Gemini/Kimi三轮选择稳定Host currentThreadId+现有thread边界。产品不展示session管理；默认持续对话，按需新话题/历史。聊天成为主区，复用Markdown/消息/输入组件；不让程序化审批抢默认或制造可见会话条目。新话题仅首条接纳时原子推进，幂等重试不倒退指针；历史/草稿/在途请求不强跳。完整规格见scratch/butler-session-design/conclusion.md；旧聊天不删不合并，尚待实施和验收。

## D14 — 最终提交与推送授权（2026-11-15）

用户最新明确：本轮改完后直接发上去。root据上下文执行为：修复与最终验收完成后，提交并推送当前feat/teamwork-m0开发分支。此前“不得commit/push”的会话限制由这条新授权覆盖；不据此推断发布release、合并main或改变仓库其它设置。当前goal工具中旧文字不能编辑，此处记录最新验收边界。主动反馈完整接线不扩成当前新任务；现有可用消息入口可直接使用。
