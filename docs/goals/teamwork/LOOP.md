# LOOP (execution contract)

## How to launch

从仓库根目录读取 `docs/goals/teamwork/LOOP.md` 与同目录 `PROGRESS.md`，确认目标是原总体 Plan M1–M5 全产品交付，再读取 `VISION.md`、`DOD.md`、`DOR.md`、`DECISIONS.md`。同时读取 `docs/plans/teamwork-runtime-contract.md` 和后续架构契约；旧日志只作基线，必须核对当前代码与终端会话后继续。

## Preserve the goal

- 用户当前授权优先于旧记录。不得把 M0、文档就绪、stub、单元测试或单里程碑演示写成 ALL DONE，也不得因实现困难删除 M1–M5 的任何验收结果。
- goal-package 的六文件限制仅适用于该 Kimi 文档 worker；主协调器负责设计、派发、集成与验收，主要产品实现由 Codex Sol worker 在明确所有权范围内完成。worker 不自行 commit/push；最终提交推送由主协调器按 D14 授权执行。不得擅自 tag/发布、改真实 Profile/配置、操作用户私网机器或运行共享生产迁移。
- 新用户指令可改变范围；其他执行者无权自行缩小用户-owned 范围。安全契约细化记录在 DECISIONS，不把它误认为可选建议。

## Choose useful work

1. 以实际依赖推进：M1 稳定服务/类型是 M2–M4 集成基础；M5 复用 M1 Mail 与 M4 审批。独立架构、Pencil 设计、测试 fixture 和文档可并行，但不得让 UI 实现早于对应 Pencil 设计。
2. 保持当前共享 worktree 的文件所有权：Codex 独占后端/CLI 主实现；Carbon 只写后续架构契约；Kimi 文档 worker 维护目标包和证据。后续 UI/扩展若并行，必须先划分不重叠文件或串行接续，不能覆盖 M0 或他人改动。
3. 原生 Jedv agent 会话优先；发送后续指令前先 `terminals read` 确认仍是交互 Agent。worker 必须返回 `JEDV_WORKER_DONE` 或 `JEDV_WORKER_BLOCKED` 信封，状态由协调器依据实际 diff 和独立功能核验判定，不能依据 idle/settled。
4. 每个子阶段只做功能验证和必要缺陷修复。所有 M1–M5 实现及 E1–E3 功能验收完成后，才启动一次集中深度 review；review 修复只复验受影响行为，不开展第二轮泛化 review。
5. Pencil 设计、真实 GUI、i18n/typecheck、临时 Host/Profile/仓库是验收的一部分，不能由“代码已写”替代。DeepSeek 不复制凭证、不付费；无 Key 使用 fake 端点并准确保留 live 未验证。
6. 通过 Jedv 发现产品问题时，先查 `TokenRollAI/jedv` 已有 Issues（至少核对 #1/#2/#3 及关键词），再提交新问题；记录链接与去重依据。不要重复创建已知问题。

## Make acceptance mean something

- 按 `DOD.md` 的 ID 记录证据。worker 声明、协调器独立检查、真实用户路径观察分别注明；只有当前行为满足预期才勾选项。
- 测试失败先确认实际原因并修复本次实现；不用跳过、删除或缩小测试制造通过。系统 Node ABI 问题按既有 Electron ABI149 方法运行真实 PTY，不修改全局依赖。
- 后续改动使旧证据失效时重开对应项。大型日志保留路径、命令、退出码和通过数，PROGRESS 只保留当前摘要；22 项定向 PTY 是 57 项后的子集证据，不相加。
- DeepSeek live、真实物理手机或私网机器未执行时必须写明未验证及原因；本目标明确允许以两个隔离 Host 和移动视口完成约定验收，不能擅自扩大外部访问。

## Preserve enough state to resume

每次有意义的分派、worker 交接、功能验证、Issue、阻塞或验收变化后更新 `PROGRESS.md`：任务依赖、Agent/模型、workspace/terminal、可写范围、worker 声明、独立证据和下一步必须可查。新决策写入 `DECISIONS.md`，DOD 勾选与 PROGRESS 摘要保持一致。上下文恢复时先用 Jedv `terminals read/list` 和 `snapshot` 重建实时状态，不猜会话仍存活。

## Completion and blocked handoff

只有 DOD 全部项、G1–G7 和 E1–E3 对最终状态均满足，VISION 的 SC1–SC7/UC1–UC8 全覆盖，最终一次深度 review 修复复验完成，才可声明 **ALL DONE**。DeepSeek live 无凭证按 G6 明示，不伪造也不因此阻塞已授权的 fake 验收。

仅当外部输入或用户决策使所有剩余有用工作都无法推进时才报告 **BLOCKED**，列出受影响 DOD ID 和精确解锁条件。暂停、单个 worker 失败、测试红、Pencil/GUI 未验证或只完成 M0/M1 都不是完成。会话中断时保留真实状态和下一步，不宣称终止条件已满足。
