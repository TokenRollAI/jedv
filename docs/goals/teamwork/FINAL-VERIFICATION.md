# 最终验收

2026-11-15；分支 `feat/teamwork-m0`，基线 `e64485d37316330276b84ac502e137587a9c4a94`。以下为协调器独立验证，先完成功能验收，再集中深度 review 一次；具体修复后只重验受影响范围。历史 PROGRESS 的中间失败由本文最新结果覆盖，未删除失败记录。

## 整仓检查

最终串行 pipeline 全部 exit 0，避免检查与构建同时重建图标资源：

| 命令 | 结果 | 本机日志 |
|---|---|---|
| `bun run test` | 16/16 tasks successful | `/tmp/jedv-root-release-final-test.log` |
| `bun run typecheck` | 22/22 tasks successful | `/tmp/jedv-root-release-final-typecheck.log` |
| `bun run check:i18n` | 通过，18 语言 | `/tmp/jedv-root-release-final-i18n.log` |
| `bun run check:versions` | Desktop/Host/CLI 同为 2.1.0 | `/tmp/jedv-root-release-final-versions.log` |
| `bun run build` | 2/2 tasks successful，本地构建 | `/tmp/jedv-root-release-final-build.log` |
| `git diff --check` | 通过 | `/tmp/jedv-root-release-final-diff.log` |

两份编排 skill（`.agents/skills/jedv-orchestrate` 和受管 `jedv-team`）均通过 skill validator。桌面/UI 源码扫描无原生 select/option 遗留。

## 真实进程与端到端

最终适用源码共 72 个真实进程/PTY/socket 场景通过，无 skip；不是用单元测试替代这些验证。

- **E1 / M1 / M2**：`src/teams/teamwork.node-test.ts` 5/5，包含真实 Leader CLI、三种 spawn、跨 Project 工作区、busy/idle 合并 Mail、HTTP、pause/stop/archive、普通目录文件保护、重启恢复、新 Task 幂等和已配置 Codex 隔离 smoke。日志 `/tmp/jedv-root-adoption-team.log`。真实 PTY 输入安全 59/59，覆盖手工输入、clear、busy/idle、乱序事件、重启、launch 身份、adoption；日志 `/tmp/jedv-root-adoption-pty.log`。
- **E2 / M3 / M4**：Memory 与 Butler 实际 Host/编译 CLI 场景 2/2，覆盖持久化、中文 FTS、层级预算、fake/no-key 提炼、WatchDog、稳定默认对话、真实工具、向 Leader 保留原文发信及回信、审批前零副作用和 archive/stop。日志 `/tmp/jedv-root-final-current-memory-butler.log`。
- **E3 / M5 / G9**：实际 socket 场景 6/6：无模型 CLI 能力对等、Attention 不隐式 ACK、跨端默认对话/审计隔离、双完整 Host 的丢 ACK/退避/死信/重启、Mobile Origin/配对/CSRF/审批 claim、slots provider 权限/纯数据/卸载撤权。日志 `/tmp/jedv-root-postreview-network-team.log`。此合并日志曾包含两个 Team 失败；它们已在上述最终 Team 5/5 中修复复验，不把旧合并运行冒充全绿。

## 真实 GUI

Pencil 设计及多轮 Gemini/Kimi 讨论后，在隔离 QA Profile 通过原生桌面与 393×852 手机视口实际操作，详见 `PROGRESS.md`、`UI-ACCEPTANCE.md`。

- Teamwork 目录、默认新 Task 直接启动 Leader、已有 Agent 次级入口、跨项目终端精准聚焦、普通目录、成员状态右上对齐、12 成员密度、统一 Tabs/选择器、Mail 展开/read/ACK、共享 Memory 均已操作。
- Project Settings → Project memory 新增中文记录并以「幂等键」搜索命中。
- Butler 常驻系统空间、建议分组与来源、read/ignore 不 ACK、实际审批状态/目标、主区 Markdown 聊天、历史键盘选择、新话题/历史草稿保留、无 Key 降级通过；亮暗主题和窄窗口可读，侧栏页脚贴底。
- Mobile 配对、三屏、同源对话/历史、安全 Markdown、忽略、实际一次审批、Executed/Rejected 状态和目标、退出撤销通过。PWA 公开静态资源可取；敏感 API 未授权为 401/no-store，缓存规则有定向验证。
- Header/sidebar slots 实际显示与禁用隐藏通过，provider 调用及越权拒绝由真实 HTTP 验证。
- **最终 S4 故障注入**：核实本任务 QA Host PID/path 且无运行中 Butler 请求后 SIGTERM；实际界面出现 offline/Retry，自动重连后中文 Mail 草稿完整、Send 恢复。只清除本次验收文字，没有发信。renderer 内存按稳定 logicalHostId+Team 隔离，并保护 dedupe 与 pending，不自动重放。

## 最终 review 处置

所有成立发现均修复并定向复验，再经过上述最终整仓检查：

| 范围 | 修复 |
|---|---|
| Hook/人工输入 | 异步 adapter 在事件发生时同步分配序号；人工输入/clear 采样 producer 水位，延迟旧事件不能重新授权 |
| Team lifecycle | PTY close 失败保留 binding/失败状态并阻归档；recover 防并发 stop 与资源替换；adoption 保持 createdAt，展示字段不误触发身份冲突 |
| Memory | 项目提炼按接纳顺序保护新事实，迟到旧结果仅候选 |
| Mobile/Peer | 慢请求 body 后重验登录/Origin/CSRF；peer 整次变更串行，防删除复活和失败回滚覆盖 |
| Mail UI | 上层 provider 重挂也保留草稿及请求身份；32 scope、有界 TTL、权威删除清理 |
| Trust/审批/API | 只为 Host 自建 session workspace 自动 trust；守卫诊断脱敏限长；REST 状态码和 GET OpenAPI 输入一致 |

架构交叉核查排除了不成立的报告：幂等回放不应因当前话题变化而重绑；显式审计历史不等于默认上下文污染；预算已含提示；已有资源快照与 Git 删除约束不改成新增实时 HEAD 门禁。未借 review 扩展无关功能。

历史迁移文件未改写，新迁移仅追加。原有 Butler 消息逐列核对保留、外键检查通过。QA 后续已有用户手工输入和设置，始终保留；未读取 Key，未调用真实付费模型。新增源码/fixture 凭据模式检查未发现新泄露。

## 边界与交付

- DeepSeek 真实服务、真实 Tailscale TLS 私网部署**未验证**；已验证 fake/no-key、隔离双 Host/socket 和受控反代 Origin 契约。没有将这些边界写成外部实测通过。
- Jedv 使用问题已按要求提交 GitHub。既有系统 Node/Electron ABI 边界、panes CLI 无已登录窗口、desktop 管理 Host 的 CLI stop 识别问题（#3/#7/#25）保留跟踪，不扩成此次新功能范围。
- D14 授权最终验收后提交并推送开发分支；不创建 release/tag，不合并 main。知识文档须经正式 llmdoc commit 刷新验证指纹，再推送。
