# Teamwork 运行时契约（M0 可信底座与 M1 编排集成）

## 1. 范围与非目标

本契约定义本地单 Host（`packages/host-service` + `packages/cli`）下终端原生 `Team` 与 `Mail` 的运行时边界与验收标准。
- **当前不做**：桌面端 Teamwork UI、Memory/FTS5、WatchDog/Butler、跨 Host 转发与外部 Webhook。
- **真实度基线**：当前代码已具备 `sendAutomaticAgentMessage` / `sendAgentMessage` 串行许可复核与 `TerminalAgentStore` 基于 `deliverySequence` 的保守状态机，但**真实 Hook Producer（`notify.sh` / Agent Wrappers）尚未生成并上报单调源序号**，旧 Producer 无法授权进入 `"idle"`（实际状态可能处于 `"unknown"`、`"cleared"`、`"interrupted"` 等非 `"idle"` 态，不承诺恒定为单一状态）。因此 **M0 严禁宣称真实端到端自动唤醒（Auto-Wake）已可用**。

---

## 2. 核心运行不变量（Runtime Invariants）

1. **成员绑定 Agent 启动身份，而非裸 `terminalId`**
   - 成员身份必须锚定 `TerminalAgentBinding` 的会话实例字段：`(workspaceId, terminalId, agentId, definitionId?, launchId?, startedAt, agentSessionId?)`，运行时统一通过 `terminal-agents/matches-agent-binding.ts` 中的 `matchesAgentBinding` 核验。
   - 禁止裸 shell 或 Chat synthetic terminal（`hasChat(terminalId) === true`）绑定为 Team 成员。
   - `team init` 原地晋升时立即锁定当前 live binding 的 `(launchId, startedAt, agentSessionId)`；`team spawn` 新建终端以无外键的 `planned_terminal_id` 发起创建，待 `terminal_sessions` 落库或崩溃对账确认后再绑定带外键的 `terminal_id`，并在首条匹配 `(workspaceId, terminalId, agentId)` 的 live binding 到达时原子锁定启动身份字段。一旦锁定，同一 `terminalId` 若重启为新 `launchId`/`startedAt` 或切换到不同 `agentSessionId`，原成员立即视为脱离（`detached/replaced`），绝不向新会话投递旧成员唤醒。
2. **`lastEventType === "Stop"` 不是唤醒授权，乱序旧 Hook 必须 Fail-Closed**
   - `terminal-agents/store.ts` 的 `clearWorkspaceStatuses` 会将绑定强制改写为 `lastEventType: "Stop"` 作为 UI 逃生舱；Host 重启加载的持久化 `"Stop"` 也可能是历史残留，二者均**严禁**作为自动写入 PTY 的授权。
   - `trpc/router/notifications/notifications.ts` 中 `occurredAt = Date.now()` 仅为服务端接收时间，`attributionToken` 仅证明终端归属身份而非事件因果顺序；异步后台 Hook 可能跨轮延迟到达（旧轮次 `Stop` 晚于新轮次 `Start` 抵达）。
   - 自动唤醒许可必须要求：同一绑定身份下先观测到可信且序号严格递增的 `Start`（进入 `"working"`），随后观测到更高序号的可信 `Stop`（进入 `"idle"`）。缺失序号、未受信、乱序/重放序号、`PermissionRequest -> Stop`、`Interrupt` 或 `clearWorkspaceStatuses` 一律无法授权 `"idle"`。
3. **统一经 `sendAutomaticAgentMessage` 串行复核，`inputStaged: true` 冻结重推且旧许可作废**
   - 自动唤醒必须统一走 `terminal/terminal.ts` 的 `sendAutomaticAgentMessage` 入口，在 `session.followUpWriteChain` 队头原子组合 `TerminalAgentStore` 自动投递许可与业务层 Mail 租约，并在延迟发送 `\r` 前通过 `targetIsCurrent()` 二次复核身份与许可有效性。
   - `inputStaged: true` **仅代表可能已有部分或全部字节写入 PTY（在写出前/期间标记，不保证完整文本已落入缓冲）**。一旦返回错误且携带 `inputStaged: true`，对应 Mail 投递必须转入 `uncertain_staged`，**严禁自动重发文本**（防止残片拼接或误提交用户草稿）。
   - 单次自动许可一经 claim 或被后续事件（如 `Start`、`Interrupt`、`clearWorkspaceStatuses`、直接终端输入）撤销，**旧许可永久失效、不得复用**（此时 `automaticDelivery` 可能迁移为 `"working"`、`"interrupted"`、`"cleared"`、`"unknown"` 或保持 `"reserved"`，唯有后续全新的可信 `Start -> Stop` 轮次才能重新授权 `"idle"`）。
4. **Mail 通知轴与消费轴正交分离，`read` 绝不隐式 `ack`**
   - 通知状态（`nudge_state`，系统唤醒调度推进）与消费状态（`read_at` / `acked_at`，收件人显式命令推进）独立存储、互不覆盖。
   - `jedv mail read` 仅幂等记录 `read_at`，**绝不设置 `acked_at`**（防止 Agent 读取后崩溃导致任务静默丢失）；仅 `jedv mail ack` 设置 `acked_at`。
5. **基于因果链/唤醒批次预算与有界速率兜底的防死循环控制**
   - 摒弃“成员终生单调累加 `max` 跳数”做法（否则同一成员处理后续独立新任务时会被历史跳数永久误熔断）。
   - **显式因果链 / 唤醒批次预算**：显式 `--reply-to` 继承父事件 `hop_count + 1`；每次自动唤醒生成关联的唤醒批次上下文（记录该批触发邮件的最大 `hop_count`），在该唤醒轮次内直接响应产生的同链邮件累加批次 `hop_count + 1`。单条因果链达到上限（如 `hop_count >= 8`）时，邮件照常落库但该投递置 `suppressed_hop_limit`，不影响其它独立线程与后续新任务。
   - **无法归因时的有界速率预算**：当成员未携带 `--reply-to` 且无法可靠归因到具体唤醒批次时，采用**有界时间窗口的每成员自动唤醒速率预算**（超限时置 `suppressed_budget` 抑制自动唤醒，窗口滑过或新人类输入介入后自动恢复）。
6. **复用真实终端启动路径，严守 Workspace `setup` 退出证据与预持久化对账**
   - Worker 必须走真实终端 Agent 管线（`trpc/router/agents/agents.ts` 的 `buildTerminalAgentLaunch` + `terminal/terminal.ts` 的 `createTerminalSessionInternal`），强制 `surface: "terminal"`，禁止落入 Chat 或 `continueTerminalAgent` 复用旧终端。
   - 目标已有 Workspace 若 `workspace_setup.status` 处于 `'running' | 'failed' | 'unknown'`，默认拒绝启动 Worker（`PRECONDITION_FAILED`）。新建 Worktree 必须遵循 `workspaces/setup-contract.mdx`：先以 `trackSetupCompletion: true` 取得 `'succeeded' | 'not-required'` 退出证据，再创建 Worker 终端，禁止以 `setup && agent` 链式拼接污染退出证据。

---

## 3. M0 范围：可信投递底座收口与失败验证（本轮交付）

### 3.1 已有代码底座
- `packages/host-service/src/terminal/terminal.ts`：`sendAgentMessage` 与 `sendAutomaticAgentMessage` 串行排队（`followUpWriteChain`）、队头许可组合、延迟 `\r` 前 `targetIsCurrent()` 复核及 `inputStaged: true` 不确定写入暴露。
- `packages/host-service/src/terminal-agents/store.ts` & `packages/host-service/src/trpc/router/notifications/notifications.ts`：`AutomaticDeliveryState` 状态机、`clearWorkspaceStatuses` 非 `idle` 隔离、`acquireAutomaticDelivery` 一次性许可，以及 `hook.trusted + deliverySequence` 严格单调门禁。

### 3.2 本轮最小补齐项与 Producer 缺口契约
1. **人工/外部终端写入即时失效**：在宿主直接终端写入路径（`terminalRouter.writeInput`、`terminalRouter.send`、终端 WS `input` 消息）中，若目标终端存在活跃绑定，同步调用 `terminalAgentStore.invalidateAutomaticDelivery(binding)` 使既有 `"idle"` 许可失效。
2. **Source Sequence Producer 后续接线规范（M0 暂不改全局用户 wrapper 配置，留待专项闭环）**：
   - 生产者必须在同一 `(terminalId, launchId)` 生命周期内、**Hook 事件触发当下同步原子递增**正整数 `deliverySequence`，再异步上报 `notifications.hook`；严禁在后台发送阶段延迟取号。
   - 在该 Producer 接线并验证前，旧 Producer 事件无法使绑定进入 `"idle"`，真实环境自动唤醒不生效。

### 3.3 M0 必测失败与边界用例
- **伪造 Stop 拦截**：执行 `clearWorkspaceStatuses` 后，`lastEventType` 虽为 `"Stop"`，但旧状态无法变为 `"idle"`，`acquireAutomaticDelivery` / `sendAutomaticAgentMessage` 拒绝投递。
- **缺省/乱序序号拦截**：无 `deliverySequence`、`trusted: false`、乱序旧序号（如 `Start(seq=2)` 后迟到的旧 `Stop(seq=1)`）、`PermissionRequest -> Stop` 或无前置 `Start` 的孤立 `Stop` 均无法授权 `"idle"`。
- **延迟回车窗口失效与旧许可不可复用**：模拟 `sendAutomaticAgentMessage` 在启动写入后、`\r` 发送前因新 Hook（如 `Start`/`Interrupt`）或直接输入使许可失效，断言未写出 `\r`、返回错误携带 `inputStaged: true`，且该旧许可永久作废不可再次用于投递（无论当前状态已转为 `"working"`/`"interrupted"`/`"unknown"` 还是 `"reserved"`）。
- **直接输入吊销空闲许可**：已处于 `"idle"` 的绑定在发生直接终端输入后立即失去 `"idle"` 资格，拒绝自动投递。

---

## 4. M1 范围：Team / Mail 编排契约（后续集成）

### 4.1 SQLite 增量表结构（`packages/host-service/src/db`，保持存量表兼容）
- **`teams`**：
  - `id` (PK), `name`, `goal`, `status` (`'active' | 'paused' | 'stopped' | 'archived'`), `origin_workspace_id`, `created_at`, `updated_at`, `stopped_at`, `archived_at`。
- **`team_members`**：
  - `id` (PK), `team_id` (FK CASCADE), `name` (`UNIQUE(team_id, name)`), `role` (`'leader' | 'worker'`), `status` (`'spawning' | 'active' | 'stopped' | 'failed' | 'reconcile_required'`)；
  - `operation_id` (`UNIQUE(team_id, operation_id)`), `request_fingerprint`；
  - `planned_workspace_id` (TEXT NULL，无 FK，新建 Worktree 前记录预分配目标 ID), `workspace_id` (TEXT NULL，目标 `workspaces` 行存在/对账确认后绑定)；
  - `planned_terminal_id` (TEXT NULL，无 FK，PTY 创建前记录预分配终端 ID，避免 `terminal_sessions` 尚未插入时违反外键), `terminal_id` (TEXT NULL，FK -> `terminal_sessions.id ON DELETE SET NULL`，仅在 `terminal_sessions` 落库创建或崩溃对账确认存在后回填绑定)；
  - `agent_id`, `definition_id`, `expected_launch_id`, `bound_started_at`, `bound_agent_session_id`, `task_summary`, `joined_at`, `ended_at`。
- **`mail_events`**（不可变事实表）：
  - `id` (PK), `team_id`, `thread_id`, `reply_to_event_id`, `wake_batch_id`, `type`, `source_kind` (`'member' | 'human'`), `source_id`；
  - `dedupe_key` (`UNIQUE(team_id, source_kind, source_id, dedupe_key)`), `hop_count` (INT NOT NULL DEFAULT 0), `subject`, `body`, `payload_json`, `created_at`。
- **`mail_deliveries`**（收件箱双轴状态表，含 **`UNIQUE(event_id, recipient_member_id)`**）：
  - `id` (PK), `event_id` (FK CASCADE), `recipient_member_id` (FK), `read_at` (INT NULL), `acked_at` (INT NULL)；
  - `nudge_state` (`'not_applicable' | 'pending' | 'inflight' | 'nudged' | 'uncertain_staged' | 'suppressed_hop_limit' | 'suppressed_budget' | 'skipped' | 'failed'`), `inflight_token`, `wake_batch_id`, `attempt_count` (DEFAULT 0), `nudged_at`, `last_error`, `created_at`。

### 4.2 Team 生命周期、预持久化 `spawn` 对账与三态分离
- **`init` 幂等与身份反查**：
  - 校验调用方 `(workspaceId, terminalId)` 拥有 live 非 Chat `TerminalAgentBinding`，捕获其启动身份注册 `leader`。
  - 同一活跃绑定同参重入幂等返回既有记录；跨未终止 Team 冲突返回 `CONFLICT`。后续 CLI 命令凭 `JEDV_WORKSPACE_ID + JEDV_TERMINAL_ID` 结合活跃绑定身份反查成员。
- **`spawn` 预持久化意向与崩溃对账（Reconciliation）**：
  - 在触发任何外部副作用（创建 Worktree 或打开 PTY）**之前**，必须先在 SQLite 事务中写入 `status = 'spawning'` 的成员行，持久化 `operation_id`、`request_fingerprint` 以及无外键约束的 **`planned_terminal_id`（与新建 Worktree 场景下的 `planned_workspace_id`）**，此时带外键的 `terminal_id` 保持 `NULL`（避免目标 `terminal_sessions` 行尚未创建时触发外键错误）；待真实终端/工作区创建落库或对账确认存在后，再回填绑定 `terminal_id` / `workspace_id` 并置 `status = 'active'`。同键同指纹重入返回既有操作/成员，异参返回 `CONFLICT`。
  - **崩溃恢复与不确定结果处理**：Host 重启或超时后先对 `spawning` 行按 `planned_workspace_id` / `planned_terminal_id` 执行对账——核查 `workspaces` 表、Git 已注册 Worktree、`terminal_sessions` 表及 `pty-daemon` 存活会话。若资源已存在则补齐 `workspace_id` / `terminal_id` 并 adopt 收敛；若外部状态不明（无法确认命令是否已在终端执行），置为 `reconcile_required` 阻塞态等待显式处理，**严禁自动重新 spawn 第二个 Worktree 或 PTY**。
  - **回滚权限红线**：遵循 `workspaces/lifecycle.mdx`，仅允许清理本次创建独占分配的受管新 Worktree 路径，**绝不回滚或删除用户已有目录、主仓库或共享 `local` checkout**。
- **`pause` / `stop` / `archive` 严格分离**：
  - `pause` / `resume`：仅切换 `teams.status`（`active <-> paused`），挂起/恢复该队自动唤醒调度；保留全部 PTY 与手动 `mail` 收发读确认能力。
  - `stop`：`--member <name>` 仅对该 Worker 执行 `disposeSessionAndWait`（打 `disposeRequestedAt` 与 `disposed` 禁复活）并置成员 `stopped`；整队 `stop` 终止所有活跃 Worker PTY 并置 `teams.status = 'stopped'`，**但原地晋升的 `leader` 默认仅解绑置 `stopped` 而不销毁其宿主 PTY**。
  - `archive`：仅对已 `stopped` 的 Team（或显式连带 `stop` 后）置 `teams.status = 'archived'`；**绝不删除或归档底层 Workspace / Worktree**。

### 4.3 Mail 事务、重启恢复与安全唤醒格式
- **单事务写入与唯一投递**：
  - `mail send` 在单 SQLite 事务内写入 `mail_events` 与 `mail_deliveries`（由 `UNIQUE(event_id, recipient_member_id)` 保证单事件单成员至多一行投递）；相同 `dedupe_key` 同载荷幂等返回，异载荷报 `CONFLICT`。
- **经 `sendAutomaticAgentMessage` 组合 claim 与落账**：
  - 在队头许可回调内确认 Team/Member `active`，筛出 `read_at IS NULL AND acked_at IS NULL AND nudge_state = 'pending'` 行（已读/已 ack 则标 `skipped` 中止），与 `acquireAutomaticDelivery` 组合获批后同事务批量置为 `inflight`（绑定 `inflight_token` 与 `wake_batch_id`）：
  - `{ success: true }` -> 置 `nudged`、记录 `nudged_at` 与 `wake_batch_id`（单次空闲窗口合并唤醒）；
  - 错误且 `inputStaged !== true` -> 未写出任何字节，若仍未读且成员存活则回退 `pending`，否则置 `skipped`/`failed`；
  - 错误且 `inputStaged === true` -> 可能已有字节写入 PTY，置 `uncertain_staged` 并记录 `last_error`，严禁自动重推。
- **Host 重启恢复**：启动扫描所有遗留 `nudge_state = 'inflight'` 行，因无法证明崩溃前是否已有字节进入 `pty-daemon`，**一律降级为 `uncertain_staged`**，不自动重放。
- **单行注入安全**：唤醒短令仅含固定模板的 `deliveryId`/数量及过滤为 `[a-zA-Z0-9._:-]` 的 `type`/`sender`，**严禁拼接 `subject` 或 `body`**。

### 4.4 M1 最小接口面与故障验收重点
- **同源映射**：`jedv team` <-> `trpc.team`（`init/spawn/status/list/pause/resume/stop/archive`）；`jedv mail` <-> `trpc.mail`（`send/inbox/read/ack/watch`）。
- **验收断言**：
  1. 同参并发/重试 `init`、`spawn`、`mail send --dedupe-key` 幂等且 `UNIQUE(event_id, recipient_member_id)` 阻止重复投递；`spawn` 崩溃恢复对未知结果不二次拉起 PTY、不删用户已有目录。
  2. `mail read` 不改写 `acked_at`；`inflight` 崩溃恢复后转为 `uncertain_staged` 不重放文本。
  3. 单条自动唤醒因果链在第 8 跳触发 `suppressed_hop_limit`，但同一成员后续接收全新人类任务或独立因果链时**不被历史跳数永久锁死**；无归因互发受有界时间窗口速率预算限制（`suppressed_budget`）。
  4. Workspace `setup` 处于 `running` / `failed` 时拒绝启动 Worker；整队 `stop` 不误杀原地 Leader 终端，`archive` 不删底层 Workspace。
