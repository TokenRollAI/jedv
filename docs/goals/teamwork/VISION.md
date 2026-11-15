# Vision

## Goal

把 Jedv 建成本地优先、终端原生的多 Agent 协作工作区：开发者仍在 Workspace 和真实终端中工作，Team/Mail 负责协作，Memory 保留有效上下文，WatchDog 与 Butler 只把需要人类处理的信息推到台前。目标覆盖原总体 Plan 的 M1–M5 完整产品结果，而非仅完成 M0 安全基础或目标文档。

## Outcome and scope

- **M1 Team/Mail**：真实 Agent 终端可原地建队，在当前/指定 Workspace 或跨 Project 新 Worktree 启动 Worker；Mail 支持可靠收发、忙闲唤醒、有序 Hook producer、幂等、崩溃恢复、CLI、tRPC/OpenAPI 和内置 skill。
- **M2 Teamwork UI**：Workspace 徽章与全局 Teamwork 入口、跨项目成员/邮件看板、真实终端定位、Team 生命周期操作；普通非 Git 目录也可用于终端和 Team。
- **M3 Memory/WatchDog**：global/project/team 三层记忆，主动 CRUD/搜索/导入导出与受控被动提炼，启动时按预算注入；DeepSeek Key 可选，无 Key 时主动记忆和纯规则 WatchDog 完整可用。
- **M4 Butler**：左侧边栏底部折叠常驻对话、进展查询与受控工具；危险操作必须先出现授权卡，并由服务端确认后执行。
- **M5 延伸能力**：两个隔离 Host 间可靠幂等 Mail、Tailscale 私网适用的 Mobile PWA 三屏（Butler、WatchDog/审批、Team/Cron），以及受控声明式 plugin slots。
- 所有 UI 先用 Pencil 设计，再按现有 Jedv 组件和主题实现，并以隔离临时 Profile 做真实 GUI、暗色/亮色、i18n 和类型验证。

## Non-goals

- 不要求云账号，不恢复已删除的嵌入浏览器、Design Mode、语音输入或 marketplace 发布能力。
- 插件不获得任意宿主 DOM 修改、任意代码执行或宿主管理凭证；WatchDog 不自动杀进程。
- 不操作用户真实 Profile、私网机器、共享/生产数据库，不重写迁移历史，不破坏既有数据、凭证、进程或 Workspace。
- 按 D14 最新授权，最终验收通过后由主协调器提交并推送当前开发分支；tag、release 发布或回复外部 reviewer 仍需单独授权。不擅自购买或复制 DeepSeek 凭证。
- 不在实现中途做深度 review；功能验证和缺陷修复持续进行，全部实现后只做一次集中深度 review。

## Success criteria

- **SC1**：M1 的真实终端组队、三种 spawn、Mail 忙闲通知与恢复满足 `teamwork-runtime-contract.md`，既有 M0 失败关闭语义不回退。
- **SC2**：M2 双入口和看板能准确呈现并跳转跨 Project Team；普通目录不触发 Git/PR 能力，也不被 Git 清理逻辑误删。
- **SC3**：M3 三层记忆相互隔离、可检索且有注入预算；主动/被动通道、无 Key 降级和规则 WatchDog 都有行为证据，Team 归档后黑板不泄漏到新 Team。
- **SC4**：M4 Butler 能完成安全工具任务；所有 guarded 操作未经明确确认零副作用，审批不可重放或过期执行。
- **SC5**：M5 跨 Host 在重试、重启和重复 ingest 下不丢信、不重复生效；移动端三屏与审批可用，插件只能使用声明的插槽和受限接口。
- **SC6**：完整结果通过相关单元/集成/真实 PTY、端到端 GUI、i18n、类型、构建和回归验证；最终一次深度 review 的发现已修复并复验。
- **SC7**：DeepSeek 使用本地 fake 端点验证 HTTP 契约和无 Key 降级；只有用户已有凭证且明确可用时才做 live 验证，否则永久保留“live 未验证”的准确说明，不因此虚报或擅自付费。

## User cases

- **UC1 原地组队**：真实 Leader 终端 `team init` 后分别在同 Workspace、指定 Workspace、跨 Project 启动 Worker；Worker 发信时 Leader 忙碌则不抢写，出现可信新 Stop 后才唤醒。
- **UC2 故障恢复**：并发/重试 init、spawn、send 不产生重复成员、Workspace、PTY 或投递；Host 在 spawn/inflight 阶段重启后先对账，不确定结果不盲重放。
- **UC3 人类看板**：两个 Project 及一个普通目录参与 Team，用户从徽章或全局入口打开 Dashboard，查看 Mail/ACK 和状态并重命名、暂停、停止、归档，点击成员精确聚焦原终端。
- **UC4 记忆闭环**：用户主动写入并检索三层 Memory；新 Worker 获得有预算的匹配上下文。无 DeepSeek Key 时全部主动能力和规则巡检继续工作。
- **UC5 被动记忆与告警**：可控会话中出现人类纠偏并结束后生成可追溯候选/更新，冲突旧记忆按规则 supersede；超时 Mail、成员停滞和 Cron 失败产生去重告警，不自动终止用户进程。
- **UC6 Butler 授权**：用户查询 Cron、重命名 Team、给 Leader 发送附人类原话的补充；删除/归档等操作只生成审批卡，拒绝、过期和重复确认均安全。
- **UC7 多 Host 与手机**：两个临时 Host 在断连、重试和重启后完成一次且仅一次有效投递；用户通过移动会话查看三屏并处理审批，会话失效后不能继续操作。
- **UC8 受控扩展**：声明式扩展只能渲染允许的 Teamwork/sidebar/mail provider 插槽，越权 DOM、任意代码、宿主管理 PSK 和未授权 API 均被拒绝。

各 SC/UC 到验收证据的映射见 `DOD.md`；执行状态见 `PROGRESS.md`。
