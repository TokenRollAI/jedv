# DOR (Definition of Ready)

## Requirements and decisions

- 当前授权、原总体 Plan、`docs/plans/teamwork-runtime-contract.md` 和本目录六份文档共同构成执行依据；冲突时以当前用户授权优先，运行时契约是旧 Plan 的安全细化，不缩小 M1–M5 范围。
- M1 必须绑定真实 Agent 启动身份，严格区分 planned/actual ID、通知/消费、pause/stop/archive，并保持 fail-closed 自动投递。详细不变量见运行时契约，不由实现者自行降级。
- M2–M5 的接口、普通目录 capability、Memory 候选与预算、Butler 一次性审批、Host outbox 和声明式 slots 由 Carbon 在 `docs/plans/teamwork-follow-on-contract.md` 补充可执行边界；接口可随源码事实调整，但不可删除验收结果。
- 分工已确定：Carbon 架构、Codex Sol 实现、Kimi 维护目标包和协调证据。协调器只创建/编辑本目录 `VISION/DOR/DOD/LOOP/PROGRESS/DECISIONS.md`，不直接修改产品源码。
- 所有 UI 实现之前必须完成对应 Pencil 设计；这不是可用“后续补设计”替代的可选步骤。
- 已拍板事项和理由见 `DECISIONS.md`，没有需要重复询问用户的范围问题。

## Technical readiness

- 工作区：`8c71d9ac-61de-4f1e-9ef4-5c2db894f0d1`，路径 `/Users/djj/.jedv/worktrees/jedv/feat/teamwork-m0`，分支 `feat/teamwork-m0`，基线 HEAD `e64485d37316330276b84ac502e137587a9c4a94`。工作树已有 M0 未提交改动，所有 worker 必须保留并无权覆盖无关修改。
- 已核实 M0 基线：相关单元测试 89/89、完整 send/snapshot PTY 57/57、其后定向输入安全测试 22/22（22 是子集，不累加），host-service typecheck 通过；证据见 `.llmdoc-tmp/teamwork/verification.md`。
- 基线缺口：真实 Hook source `deliverySequence` producer 尚未接线；Team/Mail 服务、恢复闭环、CLI/API/skill 和 M2–M5 产品均未因此被视为完成。
- 技术栈沿用 Electron/React/Bun/tRPC、SQLite 增量迁移、Lingui 英文 message ID 和现有终端 Agent 启动管线。不得假设未确认的新依赖；优先复用现有组件、鉴权、终端和 Host 能力。
- Jedv CLI 2.1.0 的 schema、相关 help、agent presets 和 workspace 已核实。Codex M1 与 Carbon 后续架构会话均存在，映射记录于 `PROGRESS.md`。

## External prerequisites

- Pencil：用于 M2、M4、M5 UI 的先行设计；可用性和设计产物尚待协调器实际确认。若不可用，只阻塞对应 UI 实现，不阻塞独立后端工作。
- DeepSeek：不读取、复制或索取用户密钥值。通过可注入的本地 fake 端点验证契约；live 仅在已有合法凭证且用户环境已配置时验证。缺少凭证不阻塞其余验收，但最终必须标注 live 未验证。
- 跨 Host：使用本机两个相互隔离的临时 Host Profile、临时数据库/仓库和受控端口，模拟断连/重试/重启；无需也不允许操作用户私网机器。
- GUI：需要可驱动的隔离桌面实例和浏览器移动视口；不得连接真实 `~/.jedv` Profile。
- Jedv 产品问题：提交前查重 `TokenRollAI/jedv` Issues；已知 #1 Carbon 白名单、#2 Kimi 参数冲突、#3 Node ABI。开启 Issues 和提交新问题已获授权，仍禁止重复提交。

## Acceptance readiness

- 可执行仓库检查：相关 `bun test`、真实 PTY 测试、`bun run typecheck`、`bun run check:i18n`、`bun run build`、`git diff --check`；系统 Node ABI147 不兼容时沿用已验证的 Electron ABI149 运行 PTY，不把环境错误误报为功能通过或失败。
- 每个里程碑需要行为证据而非文件存在：真实终端/临时 Host 调用、数据库状态断言、故障注入、GUI 观察结果及对应命令/日志位置。
- `DOD.md` 已覆盖 VISION 的全部 SC1–SC7 和 UC1–UC8；最终一次深度 review 另设全局门槛，不能提前用 review 代替功能实现。

## Blockers

- 当前无阻塞全部工作的外部输入。Pencil/GUI 能力、DeepSeek live 凭证和后续接口证据仍需在执行中确认；对应影响与状态同步到 `PROGRESS.md`。
