# Teamwork 后续阶段架构契约（M2 ~ M5）

> **定位与衔接**：本契约作为 [teamwork-runtime-contract.md](file:///Users/djj/.jedv/worktrees/jedv/feat/teamwork-m0/docs/plans/teamwork-runtime-contract.md)（M0/M1 运行时内核）的后续扩展边界，指导 M2~M5 前后端并行实现。全程保持本地优先、无云账号可用；不恢复已移除的嵌入式浏览器、语音、Design Mode 或插件市场发布功能；不修改已有数据库列语义。文中未核实的新增文件路径仅作模块职责建议，不锁死具体目录层级。

---

## 1. M2：桌面端 Teamwork 视图、终端定位与普通目录（Non-Git Folder）边界

### 1.1 双入口与终端安全定位
- **全局与局部入口**：
  - 在 `parity-types.ts` 的 `JedvSurface` 扩展 `"teamwork"`，于 `JedvSidebarNav` 导航区增加常驻入口，外层纳入 `ContentBoundary`（遵循 `desktop/failure-boundaries.mdx`）。
  - 在 `JedvWorkspaceRow` 的 `{agentChips}` 同行渲染紧凑 Teamwork 徽章（仅当该 Workspace 存在 `active | paused` 团队成员时显示，点击切至对应 Team）。
- **终端定位与布局恢复契约**：
  - 从 Teamwork 成员卡片跳转终端时，直接复用 `JedvParityViewContext.onOpenWorkspace(workspaceId, terminalId)`。
  - 若目标 `terminalId` 在 `listLiveTerminalSessions` 中存活但此前被用户从 pane 布局移出（detached），视图层仅将其重新挂入当前 Workspace 的 pane 容器并聚焦；严格区分 `panes` 的 `remove`（纯视图移动）与 `close`（触发 `dispose`），**绝不因切换视图销毁 shell，也不对已退出的 `terminalId` 伪造存活终端**。
- **Renderer 状态红线**：不在 `localStorage` 存储按 Team/Workspace 增长的实体缓存；若需保存全局视图筛选折叠态，仅允许固定大小 singleton 并在 `persisted-key-registry.test-data.ts` 登记清理路径。

### 1.2 普通目录（Plain Folder）Capability 与 Cleanup 边界
- **现状区分**：现有 `createSession` 底层仍调用 `initEmptyRepo` 创建受管 Git 仓库。支持真正的普通目录（无 `.git`）必须引入显式能力边界，**严禁未经用户确认悄悄执行 `git init`**。
- **能力模型（Capability Gate）**：
  - 在 `projects`（或 Workspace 快照派生属性）标识 `vcsKind: "git" | "none"`，并允许导入无 `.git` 的现有本地目录（对应 Workspace `type: "folder"` 或标记 `isGitRepo: false`）。
  - 当 `vcsKind === "none"` 时，显式短路 Git 专属管线：`GitWatcher`（仅保留 `WorkspaceFilesystemManager` 文件监听，不监听 `.git/`）、`PullRequestRuntimeManager`、`gitStatusStore`、分支切换与 Worktree 创建；桌面 `JedvChangesView` 与 PR 面板渲染“非 Git 目录”空态而非报错。
  - `team spawn` 针对 `vcsKind === "none"` 仅允许在既有目录 Workspace 内新建终端，传入 `--project` 请求新建 Git Worktree 时返回 `PRECONDITION_FAILED`。
- **Cleanup 铁律**：`isLocalCheckoutWorkspace` 与 `project-deletion` 必须将普通目录视同用户自有主目录（`sharesProjectCheckout = true`）——归档/删除 Workspace 或删除/Purge Project **仅停止关联终端会话并更新数据库记录，永不对用户普通目录执行文件树删除**。

---

## 2. M3：三层 Memory、FTS 中文搜索预算、DeepSeek 降级与规则 WatchDog

### 2.1 三层 Scope、零 C 扩展中文 FTS 与注入预算
- **三层隔离**：`global`（`scope_id = ''`）、`project`（`scope_id = projectId`，支持以同目录临时文件 + 原子 `rename` 导出/导入 `.jedv/memory.json`）、`team`（`scope_id = teamId`，Team 变为 `archived` 后立即封存，禁止向其它或后续新建 Team 注入）。
- **跨运行时一致的中文 FTS5 方案**：
  - SQLite 默认 `unicode61` 无法切分连续中文字符串，且禁止引入原生 C 分词扩展以保证 Node `better-sqlite3` 与测试 `bun:sqlite` 行为一致。
  - 写入与查询统一经过纯 TypeScript 确定性分词归一化函数：对连续 CJK 字符生成 `unigram + bigram` 词元序列、保留拉丁/数字词元，存入受 SQLite Trigger 同步的内部 `fts5` 索引列，兼顾 2 字中文术语（如“幂等”、“唤醒”）与中英混合检索。
- **启动注入预算**：`team spawn` 仅注入 `status = 'active'` 且 `tier = 'core'`（且 `superseded_by_id IS NULL`）条目；硬性限制单层与总字符预算（建议 `global <= 1200`、`project <= 2000`、`team <= 1600`，总计 `<= 4800 chars`），超出按更新时间截断并附带 `jedv memory search` 提示。

### 2.2 DeepSeek Key 安全存储与无 Key 完整降级
- **固定模型与凭证边界**：仅提供单一 DeepSeek API Key 配置项，内部固定绑定官方兼容 HTTPS 端点与模型 ID **`deepseek-flash`**（不改写为其它模型名、不开放模型或自定义 URL 表单；Fake/单测契约严格校验 `model: "deepseek-flash"`；注：当前本地离线架构核对阶段未联网验证上游实时模型目录，若线上返回模型不可用或配额/网络错误，统一走下方无损降级路径）。
- **落盘与脱敏**：Key 保存在 `resolveAppHomeDir()` 下受限权限（`0o600`）的独立宿主秘密存储（桌面端可选经 Electron `safeStorage` 密封），**绝不写入 `localStorage`、项目仓库或注入终端 PTY 环境变量**；查询接口仅返回 `{ configured: boolean, maskedHint: string | null }`。
- **无 Key 降级**：未配置 Key、离线或上游调用失败时，主动 `jedv memory` 读写检索、启动核心记忆注入及纯规则 WatchDog 100% 正常工作，仅静默跳过 LLM 被动提取与 Butler 对话。

### 2.3 规则 WatchDog 与被动记忆分层激活契约
- **零副作用巡检**：WatchDog 注入可控 `Clock`（单测禁真实 `setTimeout` 等待），周期检查超时未 `ack` 邮件、结合 `terminalAgentStore` 与 `gitStatusStore` 识别疑似停滞成员、以及 `LocalAutomations` 失败记录。**WatchDog 严禁自动 kill/dispose 任何终端进程或自动重发指令**，仅向告警收件箱写入去重后的只读事件。
- **被动记忆提取：Project 受控自动激活 vs Global 候选隔离**：
  - 仅读取通过 `isTrustedTranscriptPath` 校验的可信会话记录，强制记录 `source_kind = 'watchdog'` 与 `source_ref`（来源 `terminalId`），解析或校验失败静默降级丢弃。
  - **`project` 记忆受控自动更新（对齐 M3 DoD）**：人类纠偏或会话结束触发的当前项目可信被动提取，可在受控规则下直接以 `status = 'active'` 写入该 `project` 作用域，并对同项目内冲突的旧 `project` 条目自动标记 `superseded_by_id`（旧行保留不物理删除，便于回溯与撤销）。
  - **`global` 记忆严禁自动覆盖**：被动提取**绝不直接激活或 `supersede` 任何 `global` 作用域记忆**；跨项目全局建议仅能以 `status = 'candidate'` 候选态落库（不参与启动注入），必须经人类显式采纳后方可生效。

---

## 3. M4：Butler 工具分级、人类原文保真与服务端一次性审批

### 3.1 工具权限边界与告警防火墙
- **只读与低风险工具（Safe Tools）**：查询 Workspace / Team / Mail / Automations 状态、检索记忆、重命名非破坏性标题、向指定 Leader 发送补充邮件。
- **受控高风险工具（Guarded Tools，强制走审批卡）**：`archiveWorkspace`、`stopTeam`（含停止成员）、批量删除记忆、由 Butler 发起的 `global` 记忆采纳/覆盖。
- **告警不触发写操作**：WatchDog 告警或 Agent 异常邮件仅作为只读上下文摘要呈现；**不存在由当次人类显式消息发起的请求上下文时，禁止自动调用任何写工具（含 Safe 写工具）**，阻断多智能体级联误操作与间接 Prompt Injection。

### 3.2 人类原文保真与审批卡一次性 Claim
- **原文保真（Verbatim Forwarding）**：代发指令给 Team Leader 时，服务端直接从当次人类请求上下文读取原始文本写入 `payload_json.humanVerbatim`，不允许模型摘要替代人类原话。
- **服务端一次性审批租约（`butler_approvals`）**：
  - Guarded Tool 调用仅生成持久化审批单：`id`, `action_type`, `target_id`, `canonical_payload_json`, `payload_hash`, `status ('pending' | 'claimed' | 'executed' | 'rejected' | 'expired' | 'failed')`, `expires_at`（默认 10 分钟有效）。
  - 用户点击确认携带 `(approvalId, payloadHash)`，服务端单事务原子条件更新 `status: 'pending' -> 'claimed'` 且校验 `expires_at > now` 与 `payload_hash` 一致；若并发点击、已过期或目标状态已漂移，立即返回 `CONFLICT` / `PRECONDITION_FAILED`，确保至多执行一次。

---

## 4. M5：跨 Host Mail Outbox、Mobile 三屏会话与声明式插槽

### 4.1 双 Host Outbox 与最小权限凭证隔离
- **严禁共享 Host 管理 PSK**：Host 管理 PSK 等同本机终端执行权。跨机与外部接入必须采用独立窄凭证：
  - **Peer Ingest Token**：`peer_hosts` 配置对端受验证的 Tailscale HTTPS `.ts.net` origin（禁路径/内嵌凭证/HTTP redirect，复用 `private-connections.mdx` 规则）与专用 `peer_token`，仅授权访问 `POST /api/v1/mail/peer-ingest`，无权访问 `/trpc`、PTY 或文件系统。
  - **Provider Ingest Token**：外部事件源使用独立只写 token，仅允许注入 `source_kind = 'provider'` 邮件，绝不获知管理 PSK 或 Peer Token。
- **Outbox 与幂等**：跨机发送在单事务内写入本地事件与 `mail_outbox`（带指数退避与 `dead` 上限）；接收端按 `UNIQUE(source_host_id, source_event_id)` 幂等落库并返回确定性回执。

### 4.2 Mobile 三屏与受限 Session
- **能力收敛**：移动端静态路由仅承载三屏——**Butler 对话、WatchDog 告警与审批收件箱、Team / Automations 只读概览**（不暴露 Web 终端或文件读写）。
- **独立登录会话**：通过桌面端生成一次性短效配对码换取服务端 `mobile_sessions` 记录（HttpOnly `SameSite=Strict` Cookie + CSRF 校验，有界 TTL，支持在桌面 Settings 一键吊销）；该会话中间件仅放行上述三屏对应的只读查询、Butler 聊天与审批确认接口，不具备完整 Host PSK 权限。

### 4.3 受控声明式 Slot（P2）
- 仅开放**纯数据 Schema 声明式扩展插槽**（固定保留 `teamwork.header`、`sidebar.panel`、`mail.provider` 三个标准插槽标识；其中 `sidebar.panel` 支持渲染 `summary` 等白名单纯数据键值/状态卡片与经 `safeOpenExternal` 校验的外部链接）。
- **红线**：宿主使用自有 React 组件渲染固定数据结构，**禁止第三方任意 JS 执行、iframe 或外部 DOM 节点挂载**（内部 `WorkspaceToolbarSlot` 仅限宿主自身组件复用），不恢复任何插件市场发布机制。

---

## 5. 前后端并行 tRPC 接口与核心数据 Shape 建议

```ts
// 1. Project / Workspace 扩展字段（兼容既有返回结构）
interface WorkspaceCapabilitiesShape {
  vcsKind: "git" | "none"; // "none" 时前端禁用 Git/PR/Worktree 控件
  activeTeamBadge?: { teamId: string; teamName: string; role: "leader" | "worker"; activeCount: number } | null;
}

// 2. trpc.team & trpc.mail（供 M2 Teamwork 视图消费，对接 M1 后端）
// team.list({ status?: "active" | "all" }) -> TeamSummaryShape[]
// team.status({ teamId }) -> { team: TeamSummaryShape; members: TeamMemberRuntimeShape[]; stats: MailStatsShape }
// mail.inbox({ teamId?, memberId?, filter?: "unread" | "unacked" | "all", limit?: number }) -> MailDeliveryItemShape[]
// mail.send({ teamId, to, type?, subject?, body, dedupeKey? }) // 人类在面板快捷发信时 sourceKind = "human"

// 3. trpc.memory & trpc.aiSettings（M3）
// aiSettings.get() -> { configured: boolean; maskedHint: string | null }
// aiSettings.setDeepseekKey({ apiKey: string | null }) -> { configured: boolean; maskedHint: string | null }
// memory.list({ scopeKind, scopeId?, tier?, includeCandidates?: boolean }) -> MemoryItemShape[]
// memory.search({ query, scopeKind?, scopeId?, limit?: number }) -> MemoryItemShape[]
// memory.put / memory.reviewCandidate({ id, action: "accept" | "reject", supersedeId? }) / memory.remove
// memory.exportProject({ projectId }) / memory.importProject({ projectId, filePath })

// 4. trpc.watchdog & trpc.butler（M3 / M4）
// watchdog.listAlerts({ status?: "unread" | "all", limit?: number }) -> WatchdogAlertShape[]
// butler.sendMessage({ threadId?, humanText: string }) -> { reply: string; approvals: ButlerApprovalShape[] }
// butler.listApprovals({ status?: "pending" | "history" }) -> ButlerApprovalShape[]
// butler.resolveApproval({ approvalId, payloadHash, decision: "approve" | "reject" }) -> { status: string }

// 5. trpc.peers & trpc.mobileAuth（M5）
// peers.list / peers.upsert / peers.remove
// mobileAuth.createPairingCode() -> { code: string; expiresAt: number }
// mobileAuth.listSessions / mobileAuth.revokeSession({ sessionId })
```

---

## 6. 交互结构简明建议（供 Pencil 设计对齐现有 Jedv 风格）

1. **左侧边栏（`JedvSidebarNav` + `JedvWorkspaceRow`）**：
   - 顶部导航在 `Workspaces` 下方新增同级 28px 高行项 `Teamwork`；
   - Workspace 行底部 `{agentChips}` 右侧紧贴一枚极简胶囊（显示团队短名与活跃成员数，无边框噪点，hover 高亮）；
   - 左栏底部固定 `h-10` 状态条上方停靠 **Butler 折叠条**（折叠时仅 32px 单行显示未读告警圆点与快捷唤起；展开时占左栏下半区约 40%~50% 高度，内含精简消息流与内联审批确认卡，绝不遮挡右侧主终端）。
2. **Teamwork 主视图（复用主内容区顶栏 + 分栏卡片网格）**：
   - 顶栏左侧切换活跃/已归档 Team，右侧提供 `Pause/Resume`、`Stop`、`Archive` 轻量按钮；
   - 主体采用上下或左右双区：**成员拓扑卡片区**（展示角色、Agent 图标、所属 `Project / Workspace`、运行状态点与任务摘要，整卡点击直达对应终端 Pane）+ **Mail 协作时间线与底部单行人类发信框**（M3 后可在侧栏 Tab 切换查看本队共享黑板记忆）。
3. **Settings 与 Mobile 三屏**：
   - Settings 新增单行密码框配置 DeepSeek API Key（显示已配置状态掩码与清除按钮，无繁琐模型参数表单）；
   - Mobile 采用底部三 Tab 极简卡片流（`Butler` / `Inbox & Approvals` / `Status`），审批卡固定展示目标对象、操作摘要、剩余有效时间与显式“确认 / 拒绝”双按钮。
