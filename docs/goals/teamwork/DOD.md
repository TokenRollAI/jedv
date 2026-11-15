# DOD (Definition of Done)

## Acceptance basis

`VISION.md` 定义完整结果。勾选必须基于当前最终工作树的行为证据，并在 `PROGRESS.md` 记录命令、退出码、临时 Profile/仓库隔离方式和日志位置；worker 自报与协调器独立核验分开记录。后续修改使证据失效时必须重新打开对应项。M0 测试和文档存在不等于任何 M1–M5 项自动完成。

## Global acceptance

- [x] **G1 完整范围**：M1–M5 下列实现与端到端项全部有当前证据，没有以 stub、仅服务测试、仅编译或 M0 基础替代产品闭环。
- [x] **G2 回归**：相关单元/集成/真实 PTY 测试及最终 `bun run test`、`bun run typecheck`、`bun run check:i18n`、`bun run build`、`git diff --check` 通过；既有 M0 89 项、57 项 PTY 与输入安全场景按最终适用文件重跑。
- [x] **G3 真实 GUI**：Pencil 设计先于 M2/M4/M5 UI；在隔离临时 Profile 实测桌面和移动三屏，暗色/亮色无关键溢出，双入口、终端聚焦、Butler 授权、Memory 面板和审批均真实操作。仅 DOM/组件测试不算 GUI 证据。
- [x] **G4 数据与凭证**：未使用真实 Profile、用户私网机器或共享生产迁移；新增迁移为增量且兼容存量数据；无密钥进入日志、文档、fake fixture 或前端响应；提交与推送仅按 D14 最新授权在最终验收后执行，无未授权 tag/release 发布或主分支合并。
- [x] **G5 最终深度 review**：只在全部实现和功能验收完成后执行一次；发现已修复并复验。若 review 引发实质变更，相关 DOD 重新取证，不另起泛化 review 循环。
- [x] **G6 外部能力如实报告**：DeepSeek fake 契约与无 Key 降级必须通过；live 无既有凭证时明确记为未验证，不购买、不伪造通过。Tailscale 不触碰用户私网，隔离 Host 的实际覆盖范围写入最终证据。
- [x] **G7 UI 品质与可访问性**：Pencil 设计先行，功能与美观同等重要并经过认真优化；界面以图标为主、减少冗余文字，Leader 有专属 crown 等清晰标识，harness 复用现有 AgentIcon 品牌图标；重要状态和操作保留可验证的 tooltip、aria-label 与键盘焦点，并在真实 GUI 中验证识别、操作和焦点导航。

- [x] **G8 信息密度**：美观、优雅、实用与高信息密度并重；不展示无决策或操作价值的口号、解释、重复标题与无意义统计。Teamwork 经 Gemini/Kimi 交叉讨论并由 Pencil 收敛；必要风险、错误恢复和状态信息仍就近保留。
- [x] **G9 Butler/CLI 能力一致**：Butler 的每项业务能力都可由其他 Agent 通过公开 CLI 直接完成，复用同一服务、权限、审批和幂等规则；提供能力映射与功能验证，不能依赖另一个模型间接转述或绕过人工授权。

## Acceptance items

### M1 真实终端 Team/Mail

- [x] **M1.1 有序 producer 与真实唤醒**：Hook 事件发生时同步原子取号，同一 launch 严格单调、重试保留序号；真实终端可信 Start→Stop 才授权，忙碌 Leader 在新 Stop 后收到一次合并唤醒，乱序/伪造/人工输入/重启不回退 M0 fail-closed。（SC1，UC1）
- [x] **M1.2 增量存储与幂等恢复**：新增 Team/Mail 迁移不改历史；init/spawn/send 同键同载荷幂等、异载荷冲突；planned/actual ID 分离，崩溃后 adopt 或 `reconcile_required`，绝不重复 PTY/Worktree 或删除用户目录。（SC1，UC2）
- [x] **M1.3 三种 spawn 与生命周期**：当前 Workspace、指定 Workspace、跨 Project 新 Worktree 均复用真实 Agent 启动并遵守 setup 退出证据；pause 保留 PTY/手动 Mail，stop 保护原地 Leader，archive 不删 Workspace。（SC1，UC1/UC2）
- [x] **M1.4 Mail 双轴与预算**：事务写入、唯一投递、dedupe、read≠ack；permit 与业务租约组合，`inflight` 重启转 `uncertain_staged` 且不重推；第 8 跳只抑制对应因果链，无归因有有界速率预算，新独立任务可继续。（SC1，UC1/UC2）
- [x] **M1.5 完整接口**：`team`/`mail` CLI、tRPC 和鉴权 OpenAPI 共用服务；`watch` 有真实新事件；内置 `jedv-team` skill 被受管安装并指导实际命令，旧 Host 有明确 unsupported 行为。至少一个可控 fixture Agent 确定性闭环和一个已配置真实 Agent 的隔离 smoke。（SC1，UC1/UC2）

### M2 Teamwork UI 与普通目录

- [x] **M2.1 目录/创建/看板**：Pencil 设计后实现与项目同级的可折叠 Teamwork 目录、顶部创建团队入口和 Workspace 徽章；团队在目录切换，详情标题无团队下拉选择器。创建页复用现有 PromptInput/Picker 等组件，默认直接开始新 Task：填写任务、选择工作区和 Agent，可靠地启动新会话并自动指定 Leader，无需先有或手选 Leader；保留绑定已有有效会话的次级入口。创建幂等、失败保留草稿，成功后目录和徽章同步。跨两个 Project 的 Team 均显示，成员状态、任务、Mail/ACK 实时更新，支持重命名、暂停/恢复、停止/归档及人类向成员发信。（SC2，UC3）
- [x] **M2.2 终端定位与生命周期安全**：点击任意 Worker 精确切换 Workspace 并聚焦真实终端 Pane；UI 操作复用 M1 不变量，不绕过审批/状态约束。（SC2，UC3）
- [x] **M2.3 普通目录**：非 Git Folder Project 可添加并运行终端/Team；分支、PR、Git watcher/轮询按 capability 禁用，cleanup 不误删目录；已有 Git Project 行为回归通过。（SC2，UC3）
- [x] **M2.4 GUI/i18n**：临时 Profile 实测亮暗主题、实时事件和导航；新增文案使用 Lingui 英文 ID，翻译完整，`check:i18n` 与 typecheck 通过。（SC2/SC6，UC3）

### M3 Memory 与 WatchDog

- [x] **M3.1 三层 Memory**：global/project/team CRUD、删除/废弃、FTS 搜索（含中文用例）、JSON 导入导出、去重和容量预算；project 可导出 `.jedv/memory.json`，Team 归档后黑板不注入后续 Team。（SC3，UC4）
- [x] **M3.2 主动/被动闭环**：`memory` CLI、tRPC/OpenAPI、Dashboard 黑板和 Project Memory UI 可用；Worker 启动按 Global Core+Project Core+Team Blackboard 预算注入；被动提炼有来源，候选经既定规则 ADD/UPDATE/SUPERSEDE，不直接覆盖 global。（SC3，UC4/UC5）
- [x] **M3.3 DeepSeek 可选**：Key 仅安全存储并脱敏，设置界面只有一个必要输入；本地 fake 验证请求/响应、超时和错误，缺 Key/服务失败不影响主动 Memory、spawn 和规则 WatchDog；live 按 G6 处理。（SC3/SC7，UC4/UC5）
- [x] **M3.4 规则 WatchDog**：可控 Clock 验证 30 秒零 Token 巡检、长任务与真停滞区分、未 ACK Mail/Cron 失败去重告警；无自动杀进程，告警不会隐式触发写工具。（SC3，UC5）

### M4 Butler

- [x] **M4.1 置顶系统空间与 Safe Tools**：Pencil 设计后实现目录区顶部唯一常驻 Butler 系统空间，取消底部 dock 和重复入口；默认紧凑的建议/审批流、同源聚合、待处理/已处理筛选及按需对话；重要角标不混入普通提示，建议已读/忽略不等于 Mail ACK 或故障恢复；真实查询 Workspace/Team/Cron、重命名、整理 Memory、向 Leader 发信且保留人类原话并收到回信汇总。（SC4，UC6）
- [x] **M4.2 Guarded 授权卡**：archive/stop/delete batch 等仅创建待审批意图；未确认、拒绝、过期、重复确认和并发确认均无副作用或仅一次生效，服务端原子 claim+过期校验，不能仅靠前端隐藏按钮。（SC4，UC6）
- [x] **M4.3 无 Key 与告警安全**：DeepSeek 不可用时明确降级且不破坏现有 UI；WatchDog 告警只产生信息/建议，不自动执行 Safe/Guarded 写操作；GUI、i18n、类型验证通过。（SC4/SC6/SC7，UC6）
- [x] **M4.4 稳定默认对话与主区聊天**：Host持久currentThreadId，默认桌面/手机/CLI直入当前；新话题首条接纳原子推进且幂等回放不倒退；有草稿/在途/历史阅读不强跳。程序审批仅审计、不制造可见会话、不抢默认；旧对话不删除合并。聊天主区复用安全Markdown/消息/输入组件，真实工具/审批状态可查，历史和新话题按需。当前human原文完整、旧上下文/事实有界；fake跨端并发与GUI长文本/代码/错误恢复通过。

### M5 跨 Host、Mobile PWA、Plugin Slots

- [x] **M5.1 可靠跨 Host Mail**：两个隔离 Host Profile 完成 outbox 转发、远端幂等 ingest、ACK/重试/退避、重启恢复和死信可见；断连与重复响应不丢信、不重复生效，受限 peer 凭证和 TLS/PSK 鉴权正确，外部 provider 不获得 Host 管理 PSK。（SC5，UC7）
- [x] **M5.2 Mobile 三屏**：Pencil 设计后实现 `/mobile` Butler、WatchDog/审批、Team/Cron 三屏；独立有界登录会话、退出/过期失效、审批复用服务端一次性确认；受控配置可信私网 Origin，验证 HTTPS 反代到本地 HTTP 的配对与 Cookie，变更入口后撤销旧会话。PWA manifest/安装图标/公开静态离线资源可用，敏感 API 与待执行审批不进入离线缓存；文案接入现有 18 语言 catalog。移动视口真实 GUI 和三屏导航通过。（SC5/SC6，UC7）
- [x] **M5.3 受控声明式 slots**：至少验证 `teamwork.header`、`sidebar.panel`、`mail.provider` 的注册/渲染或调用、schema 校验、权限拒绝和卸载；仅公开 OpenAPI/受限 SDK，拒绝任意 DOM/代码与未授权能力，不恢复 marketplace 发布。（SC5，UC8）

## End-to-end acceptance

- [x] **E1 本地协作**：隔离 Profile 中从真实 Leader 建队，跨两个 Project 和普通目录启动 Worker，经 Mail 忙闲通信、看板聚焦、暂停/恢复、故障重启后完成且安全停止/归档。（UC1/UC2/UC3）
- [x] **E2 记忆与管家**：无 Key 时主动 Memory/WatchDog/Butler 降级可用；fake DeepSeek 下纠偏产生受控记忆更新，Butler 查询和发信成功，危险操作未审批零副作用，Team 归档后记忆隔离。（UC4/UC5/UC6）
- [x] **E3 双 Host 移动管控**：两个临时 Host 在故障注入后可靠收信，移动三屏读取一致状态并完成一次审批；声明式插件正常插槽可用而越权被拒绝。（UC7/UC8）

## Coverage

- SC1 → M1.1–M1.5、E1；SC2 → M2.1–M2.4、E1；SC3 → M3.1–M3.4、E2。
- SC4 → M4.1–M4.3、E2；SC5 → M5.1–M5.3、E3；SC6 → G1–G5、所有 GUI/E2E；SC7 → M3.3、M4.3、G6、E2。
- UC1/UC2 → M1、E1；UC3 → M2、E1；UC4/UC5 → M3、E2；UC6 → M4、E2；UC7 → M5.1/M5.2、E3；UC8 → M5.3、E3。

## 最终证据

全部项目以 [FINAL-VERIFICATION.md](FINAL-VERIFICATION.md) 的最终源码检查、72 项真实进程场景和原生 GUI 记录为准；外部 live 边界按 G6 明确保留为未验证。知识与 Git 交付另按 D14 完成。
