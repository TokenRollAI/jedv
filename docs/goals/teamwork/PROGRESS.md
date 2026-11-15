# PROGRESS (execution ledger)

## Current state

- Goal：完成原总体 Plan M1–M5 全产品范围，最终一次深度 review 后交付；不是 M0 或目标包文档闭环。
- Package：`docs/goals/teamwork`；启动入口为本目录 `LOOP.md`。
- Status：**in progress**。
- Current work：M1 worker 已提交后端、producer、CLI 与真实 E2E 证据，待 root 在最终树统一复验；M2 已完成一轮 root 隔离 GUI 功能验证，普通目录 backend 已派原 Codex worker；M3 backend 已由 root 独立复验，UI 进行中；M4 Butler backend 已派原 Codex worker。M5 未开始，最终 deep review 未开始。
- Acceptance：M1–M5、E1–E3、G1–G7 **均未勾选**。本轮证据不表示 M2 或 M3 全部完成，M0 既有证据仅为基线，不抵扣完整产品验收。
- Blockers：当前无全局阻塞。后端使用无 watch 的固定 snapshot，renderer 使用 HMR；QA 仅由 root 操作，worker 禁止 GUI。`panes` CLI 对活跃本地窗口仍报 `No signed-in desktop window`（Issue #7），尚未修复，不当作功能完成。DeepSeek live 凭证未知，不复制、不购买，fake/降级验收照常推进。
- Next useful work：推进 M2 普通目录 backend、M3 UI 与 M4 Butler backend，继续由 root 做隔离 GUI 和功能核验；待最终树稳定后统一复验 M1，并在全部实现与 E1–E3 完成后才启动一次 deep review。

## Task graph and live mapping

| Task / Dependencies | Agent / Model | Workspace / Terminal | Files | Status | Evidence / handoff |
| --- | --- | --- | --- | --- | --- |
| goal-package / none | Kimi / goal-package worker | `8c71d9ac-61de-4f1e-9ef4-5c2db894f0d1` / current session | only `docs/goals/teamwork/{VISION,DOR,DOD,LOOP,PROGRESS,DECISIONS}.md` | completed | 六文件已建立；此限制不约束主协调器，不代表产品完成 |
| m1 / M0 baseline | Codex / GPT-6.1-Sol high | same / `c77c3071-83e7-4a73-8b29-795830b75044` | host-service, cli, agent-setup, necessary shared; no UI/docs | reported; final-tree verification pending | worker 报告后端、producer、CLI、真实 E2E 与 PTY 证据；root 待最终树统一复验，不据此勾 DOD |
| remaining-architecture / none | agy / Gemini 4 Carbon high | same / `9d7f14b8-9711-4b35-8181-840dd76b9c6a` | only `docs/plans/teamwork-follow-on-contract.md` | completed | Carbon 后续契约已完成 |
| m2 UI / M1 interfaces + Pencil | Codex Sol | same / `e6b2441d-394b-485d-bf3c-bcdea80f77b0` | desktop/i18n | functional GUI spot-check passed; milestone incomplete | root 已做跨项目 badge、Team 成员/read→ACK、人类中文、终端入口与布局 QA；不得视为全部 M2 完成 |
| m2 ordinary-directory backend / M1 interfaces | original Codex worker | same / existing worker session | 按既有交接边界 | dispatched | 已派原 Codex worker，尚无本轮完成证据 |
| m3 backend / M1 interfaces | Codex Sol + root verification | same / `d7da11aa-4283-4ac3-a4c2-b24cdf83b179` | memory/ai/watchdog、routers、schema、CLI 与窄接线 | backend verified; UI in progress | root 93 pass / 421 assertions；worker 真实 Host 1 pass；M3 UI/GUI 与整体验收仍未完成 |
| m4 Butler backend / M1 interfaces + Pencil per UI | original Codex worker | same / existing worker session | 按既有交接边界 | dispatched | 已派原 Codex worker，尚无本轮完成证据 |
| m5 / M1–M4 | pending | same / pending | 按阶段明确，避免重叠 | not started | 尚未开始 |
| pencil-ui / before each UI implementation | root coordinator via Pencil | same / active Pencil session | `docs/design/teamwork.pen` | in progress | 已保存侧栏 Teamwork 目录、创建团队与成员布局版本；设计不代替最终 GUI 验收 |
| final-deep-review / all implementation + E1–E3 | reviewer chosen after functional completion | same / pending | read-only review; fixes assigned separately | pending | 全程仅一次，当前禁止提前启动 |

## Evidence baseline

- 原总体 Plan：`/Users/djj/.gemini/antigravity-cli/brain/dc815549-d17a-4ff8-94a4-ca871e95db9e/jedv-architecture-plan.md`；主协调器已复制到 `docs/goals/teamwork/SOURCE-PLAN.md`，该副本不得删除。
- M0/M1 安全契约：`docs/plans/teamwork-runtime-contract.md`。关键边界包括启动身份、单调 source sequence、一次性自动许可、planned/actual ID、恢复对账、read≠ack、因果/速率预算和 Leader PTY 保护。
- M0 验证汇总：`.llmdoc-tmp/teamwork/verification.md`。已读记录：89/89 相关单元测试、57/57 完整 PTY、其后 22/22 定向输入安全（子集不累加）、host-service typecheck 通过；source producer 当时未接，真实自动唤醒未闭环。
- 工作树基线：HEAD `e64485d37316330276b84ac502e137587a9c4a94`，存在 M0 tracked/untracked 改动；不得清理、覆盖或提交。
- Jedv 控制面：schema 与 agents/terminals/workspaces/snapshot help 已核实；本地 agent presets 为 codex、agy、kimi、claude。已知 Issues #1 Carbon、#2 Kimi、#3 ABI，后续先查重再提交。

## Evidence and decision history

### 2026-11-15 — goal-package

- Work：按 start-a-goal 模板建立 VISION/DOR/DOD/LOOP/PROGRESS/DECISIONS；把 M1 真实 producer/恢复/接口/skill、M2 双入口/普通目录、M3 Memory/WatchDog、M4 Butler、M5 双 Host/PWA/slots 全部纳入验收。
- Verification：已读取原 Plan、运行时契约和 M0 verification；已用 Jedv 读屏确认 Codex M1 与 Carbon remaining-architecture 会话及任务。尚未对它们的新实现做任何完成声明或代码 review。
- Decisions：以当前用户授权和运行时契约为准；中途只功能验证，全部完成后一次深度 review；DeepSeek live 条件化；该 Kimi goal-package worker 只写六份目标文档，主协调器继续拥有完整产品范围。详见 DECISIONS。
- Remaining：全部 M1–M5 实现、Pencil 设计、真实 GUI/PTY/双 Host/fake DeepSeek 验证、最终 review 与回归。

## Resume checklist

1. 先读 LOOP、DOD、DECISIONS 和本文件，再读两份运行时/后续契约。
2. 对上述 terminal 先 `jedv terminals read --workspace 8c71d9ac-61de-4f1e-9ef4-5c2db894f0d1 --local ...`；映射丢失时 `terminals list`/`snapshot`，不要猜任务状态。
3. 只有读到匹配 worker 信封、检查实际 diff 并独立运行相关功能验证后，才把任务标 completed 或勾 DOD。
4. 当前不得启动深度 review；先完成所有实现和 E1–E3。不得 commit/push/发布或触碰真实 Profile。

### 2026-11-15 — 并行实现与图标设计

- 原Plan快照：`SOURCE-PLAN.md`，由主协调器复制，保留原文件。
- 用户要求：只在全部功能完成后集中深度review；UI以Icon为主，Leader皇冠、harness品牌图标，终端按钮位于成员卡内容右侧（不得左下单独占行），功能与美观同等重要。
- Pencil：`docs/design/teamwork.pen`；Teamwork暗色 `c6jyH.png`、亮色 `Aft5I.png`，Butler侧栏 `lpooA.png`，Mobile三屏 `gpXNO.png` / `ZiSoT.png` / `mRBmW.png`。这是实现基线，未代替最终GUI验收。
- M1后端worker：`c77c3071-83e7-4a73-8b29-795830b75044`，独占既有host-service/cli/agent-setup/shared集成文件；真实接口已注册，正在功能测试，尚未验收。
- M2 UI worker：`e6b2441d-394b-485d-bf3c-bcdea80f77b0`，只写desktop/i18n；已收到Pencil与真实API类型交接，不自行启动桌面dev。
- M3 worker：`d7da11aa-4283-4ac3-a4c2-b24cdf83b179`，只写memory/ai/watchdog独立模块、对应routers、独立memory-schema、memory CLI、shared/memory.ts；暂不修改共同app/schema/router/journal/CLI注册，待M1让出后集成。
- GUI运行时由主协调器统一管理。JEDV_HOME_DIR不隔离全局Agent配置，已通过无写入路径probe复现并提交 https://github.com/TokenRollAI/jedv/issues/4；M1 worker正补专用JEDV_USER_HOME_DIR，不重赋系统HOME。
- 先前表格是启动映射快照；以上最新条目优先。未新增任何DOD通过声明，未开展深度review。

### 2026-11-15 — M1/M3 功能证据、M2 GUI QA 与最新设计

- M1 worker 报告：后端 **186 pass**，producer/隔离/skill **60 pass**，CLI **4 pass**，真实 E2E **3 pass**；另复验 M0 真实 PTY **59 pass**。3 个真实 E2E 覆盖两终端 8-hop 链后独立任务、WebSocket watch、GUI seed/实际 Codex 隔离 smoke。host-service、CLI、agent-setup 的 typecheck/build 均报告通过；这些仍是 worker 证据，root 将在最终树统一复验，当前不勾 M1/DOD。
- M3 root 独立功能复验：按 `.llmdoc-tmp/teamwork/m3-wiring.md` 所列命令运行 backend/migration/team/notification/automatic-delivery 测试，**93 pass / 0 fail / 421 assertions**，root 日志 `/tmp/jedv-root-m3-functional.log`。worker 真实 Host 测试 **1 pass / 0 fail**，仅发出 **2 个 fake DeepSeek 请求**，无 live/付费请求。该证据只覆盖 M3 backend 接线；M3 UI 仍在进行，未把 M3 整体标为完成。
- M2 root 隔离 GUI QA：使用 `/tmp/jedv-teamwork-gui.LoMI5P`，验证跨项目 badge 进入 Team 后显示三个成员；单独 read 后仍保持待 ACK，再 ACK 才变为确认；人类中文发送保真；cross-project 终端可打开；皇冠、Claude 图标及正文右侧 terminal 按钮布局符合设计。以上是定向功能证据，不表示全部 M2 已完成。
- 验证运行边界：后端运行无 watch 的固定 snapshot，renderer 使用 HMR；QA 由 root 单独操作，worker 禁止 GUI。M2 普通目录 backend 与 M4 Butler backend 已派原 Codex workers；M5 未开始，最终 deep review 未开始。
- Pencil 已保存 `docs/design/teamwork.pen` 及 `NM8H3.png`、`c6jyH.png`、`Aft5I.png`、`o1GQt.png`；创建表单支持选择既有、有效且未入队的 Agent 为 Leader。前一修订的 terminal 图标移至成员正文右侧已获 GUI 确认；最新侧栏/创建团队信息架构详见 DECISIONS D6。
- 问题追踪：**#5** rrule 互操作修复尚未 commit，最初误称为 baseline 问题的说法已纠正；**#6** `dev --watch` 重启会杀 QA daemon，因此本轮采用无 watch 后端；**#7** `panes` CLI 对活跃本地窗口仍报 `No signed-in desktop window`，已提交 <https://github.com/TokenRollAI/jedv/issues/7>，尚未修复，不当作功能完成。
- 本轮未修改 DOD 勾选、未缩减范围、未启动 review，亦无 commit/push。

- Root 补充 GUI 证据：QA 临时 profile 切换 Solarized Light，成员品牌图标、Leader 皇冠、正文右侧终端按钮、Mail 内容及 composer 均正常显示，无关键溢出。此后最新目录/创建修订仍待实现验收。

- Root 精确终端焦点验证：点击 cross-project 成员右侧终端按钮后直接 GUI 输入 fixture 专用 `busy`，目标 terminal `e05927d2-4a22-4240-a6f8-cb07608308a8` 生成对应 busy.json，确认输入确实落到目标 PTY；随后写入该 disposable fixture release 文件恢复。未依赖失败的 panes CLI。
- Root M3 GUI 新增中文团队记忆成功，CLI export 保留在旧 QA `gui-memory-export.json`；搜索缺失 FTS 表已定位旧QA恰逢0043开发中普通表生成/FTS追加间隙，worker确认。最终fresh/0042升级测试通过，不为临时半成品DB改生产迁移；新QA root `/tmp/jedv-teamwork-final-gui.Il7LKa` 已准备独立仓库/普通目录，尚未启动。
- Root 当前M1功能复跑185/186，唯一失败为M2新能力检查拒绝原不存在的Git fixture路径；已交M2修正隔离fixture后复验，不能声称最新树M1全绿。M3旧构建真实Host复跑1/1，仅作为同产物证据，最终需重新构建。

### 2026-11-15 — fresh QA、导航创建闭环

- 新QA `/tmp/jedv-teamwork-final-gui.Il7LKa`：CLI build与Host typecheck root通过；使用完整0043/0044迁移，旧GUI记忆JSON通过真实CLI导入，中文`memory search 幂等`命中。两个Git项目与一个普通目录均通过真实CLI导入；folder workspace返回vcsKind none和三项false，真实fixture Worker启动且无.git，keep.txt保留。
- Root M1复验187/187通过，日志`/tmp/jedv-root-m1-after-folder.log`，原fixture失败已修复。
- 最新用户UI三处修订已root GUI验收：侧栏独立Teamwork目录、创建团队入口、详情纯标题无dropdown。无Leader时创建禁用；创建额外真实fixture Agent后在GUI填写中文name/goal并绑定该Leader，成功建队“界面创建 · 验收团队”，目录和workspace badge同步且自动选中。Leader候选完整UUID已要求UI优化为名称/短ID+tooltip。
- M2backend worker完成报告：480相关回归、193定向单测、4真实E2E；证据 `.llmdoc-tmp/teamwork/m2-folder-handoff.md`。现开始M5独立backend，公共接线待M4释放。Carbon M5细化设计`.llmdoc-tmp/teamwork/m5-implementation-design.md`完成。M4真实Host/CLI已报告通过，handoff仍收尾。
- Kimi已更新`.agents/skills/jedv-orchestrate/SKILL.md`：Team/Mail能力优先，旧host terminals回退，保留幂等与结果验收；root quick_validate通过。
- 已提交Issue #8：PR后台异步读在stop后迟到写DB。worker局部修复未commit；受控Promise回归确认stop后不更新分支，完整Host重启场景通过。

- Root M4独立相关测试104/104、483断言通过（`/tmp/jedv-root-m4-functional.log`）；fresh QA真实CLI `butler ask` 无Key明确返回degraded/no_key，未产生审批或外部调用。
- fresh QA Memory GUI中文搜索命中，编辑后结果刷新；真实CLI history确认旧条目supersededById指向新条目。通过仅隔离测试脚本`seed-memory-candidates.mts`调用MemoryService.propose种入team/global候选（非真实提取证据），GUI采纳team候选后变Core，CLI确认active。全球候选仍待GUI验证。
- System agents GUI确认仅一个secure Key输入，未配置时保存/清除禁用且降级说明存在，未输入任何真实或假密钥。
- M4backend完成信封 `.llmdoc-tmp/teamwork/m4-wiring.md`；公共入口正式交M5backend。原M4worker开始Mobile assets，与后端分离；UI继续folder/Butler/M5设置。新增Pencil设计`PcI2d.png`配对/Peers与`U0fXM.png`声明式摘要，保存teamwork.pen。

- Root GUI额外临时团队生命周期验证：pause -> sidebar Paused/resume按钮；resume -> Active；stop确认文案明确保留Leader，确认后Stopped；archive确认后Archived read-only。真实CLI terminals list仍显示原Leader `a448fc39-040e-4e4d-bb35-4fc073dafda4` exited=false，保留用户目录和PTY。
- 普通目录UI接线临时漏import supportsGit导致failure boundary，worker修复后desktop typecheck通过，root已恢复UI并完成以上流程。singular workspace.get遗漏capabilities已由backend补齐+6项精确回归通过+hosttypes更新；当前GUI后端snapshot在该修复前，待下次完整构建。
- Carbon确认Tailscale Serve HTTPS反代到本机HTTP，已有manifest无本机可信公开Origin。决策见scratch/mobile-origin.md：管理面显式配置唯一https *.ts.net origin，更新/清空原子撤销会话，不信任Forwarded；实际loopback模拟HTTPS Origin做测试，不触碰用户私网。Pencil PcI2d同步地址输入和变更说明。

- Root独立producer/skill/isolation60项和CLI4项通过，日志`/tmp/jedv-root-producer-functional.log`、`/tmp/jedv-root-cli-functional.log`。fresh QA rule WatchDog已实际持久化4个mail_unacked告警，真实CLI butler inbox可读，审批为0，没有告警自动转写。
- 浏览器连接host不可用；root通过CUA原生Google Chrome新建独立无痕about:blank窗口，DevTools现为iPhone16 393×852。尚未访问Mobile（待M5后端/资产完整），未改用户原标签。GUI变量mobileBrowserApp可复用，勿用Playwright/浏览器remote绕过CUA。

- 移动端文案：UI worker已将mobile/assets/messages.ts纳入Lingui提取，76新增ID全部18catalog已填充，strict compile/check:i18n通过。backend owner添加host-service直接依赖@lingui/core6.12.0，使用ignore-scripts，未重编译原生依赖。
- M5初轮worker单测13项/125断言通过（peers/mobile/slots；待最终Origin规则及真实双Host闭环）。不作完整M5完成声明。

### 2026-11-15 — 创建模式与全局UI修订

用户指出默认创建不该要求既有Leader，并连续要求统一目录字体/底栏吸底、Butler烟斗、AgentIsland收设置、全局Option样式、Tabs样式与状态右上对齐。已转各worker，新增UI-ACCEPTANCE.md；Pencil o1GQt改任务composer，YQJBx折叠底栏、各场景Tabs/烟斗同步。Carbon team-start-contract.md完成，backend将追加可靠team.start，已有会话原验收仅保留为次级。全局初扫desktop8文件10select，mobile2select，全部待替换后复核。root真实PTY59/59通过，日志/tmp/jedv-root-pty-functional.log。

### 2026-11-15 — Butler 三轮设计讨论

用户要求Butler/WatchDog按不可选Agent的系统项目重新设计，重要建议为中心；已暂停旧dock扩写。Gemini与Kimi通过Jedv完成3轮独立/交叉/收敛讨论，结论与各轮记录在scratch/butler-design/。推荐目录区最上方常驻烟斗系统空间、单一建议审批流、对话按需打开，Pencil草图ypnE8.png。此为提案结论，尚未实施，不宣称M4 GUI完成；其余新Task/M5/统一组件继续。

## 用户新增设计约束与功能证据

- Teamwork 也需 Gemini/Kimi 多轮讨论；高信息密度、美观、优雅、实用，不展示无状态/操作价值的内容。已删除 Pencil Butler 口号、邮件聚合解释、常驻巡检时间；新设计未宣称最终验收。
- Butler 业务能力要求 CLI 等价，Sol 正在逐工具映射实际命令，保留相同审批/权限。
- root 独立 `bun test src/mobile/assets`：exit0，11 pass /572 assertions，日志 `/tmp/jedv-root-mobile-assets-functional.log`。不替代移动 GUI。
- root 真实 QA GUI（现有隔离 profile）确认成员状态右上统一、终端正文右侧、主题Tabs、目录字体一致与底栏无Island快捷按钮；当前大面积留白/常驻技术说明待本轮设计收敛。非最终完整GUI验收。

- Teamwork Gemini/Kimi 三轮设计讨论完成；root收敛到同构成员卡/稳定顺序/单滚动/原文邮件预览/紧凑composer，设计已保存PtoZN和RNtIL。成员Idle与团队active不使用完成勾，ACK改明确文字。依据见scratch/teamwork-design/conclusion.md，等待Sol实现与真实GUI。
- Butler CLI能力映射发现mail timeline、Automation查询/运行错误、无模型审批意图入口缺口，已派core补齐。现有本机管理PSK是可信管理员边界，不擅自扩成全局身份重构。

## 0045/0046 隔离实机验收

- 已消费 core 明确冻结的0045/0046增量迁移；保留原QA数据，固定后端重启为session35793，Host端口57688；真实开发Host/workers未操作。
- GUI默认新Task填写中文两行任务，选择fixture Agent，不选已有Leader，成功建立c07802e5-7a6f-423a-ad7b-c45ddcce1e26。CLI核对原文保留，Leader d78903ba-c886-416b-a078-c69e81449f9a 已bound。
- root独立双Host真实socket/mobile审批/slot集成测试3/3通过，日志`/tmp/jedv-root-m5-network-functional.log`；不是实际Tailscale私网验证。
- Chrome独立Incognito+iPhone16 393x852真实配对，中文无Key请求保存并降级，移动三屏可导航；自定义语言列表通过Home/Enter切换English，长会话名称截断无横向溢出。
- 停止审批首次因目标快照变化被拒绝且无副作用；现有generic412错误文案不准已派修。对稳定目标重新请求后，移动确认停止成功，CLI核对Team stopped，Worker停止，Leader实际PTY exited:false。
- 移动重复no-Key全局banner已派修；最新assets/桌面高密度布局尚待重建/GUI复验，当前证据不抵扣。

## Attention独立功能验收与当前设计讨论

- root独立回归`/tmp/jedv-root-attention-functional.log`：125 pass /686 assertions；实际两个完整Host socket/CLI/mobile路由测试`/tmp/jedv-root-attention-socket.log`：5 pass，0 skip。0047已由core声明冻结，未消费到当前用户正在体验的QA实例。
- QA已验证十二成员折叠/展开/顺序与主区滚动，Memory页隐藏composer；移动浅色、退出返回配对及服务端revokedAt已核对，停止Worker实际sessions为空，Leader仍live。
- 两个编排SKILL由Kimi更新start/peer边界，root重跑quick_validate均有效。
- 移动412错误文案问题已查重后提交 https://github.com/TokenRollAI/jedv/issues/9（未提交开发分支问题，明确非已发布版本归因）。
- 用户新要求Butler对话页重设计及session必要性讨论。聊天UI实现暂停，独立Attention继续。Gemini/Kimi正在三轮会话模型讨论；不删聊天/用户设置，current QA窗口暂让用户体验。Pencil Wd34v为无会话下拉的主区聊天候选。

## 0047当前QA与设置验收

- 当前固定实例session81995、Host51310。重启前butler running=0、GUI无草稿，备份before-0047-backup.db；升级后14条既有消息逐条完全相等，FK检查0。用户已在此QA体验聊天，后续须保留其设置/对话，不再当可随意重置的profile。
- 真实Attention：critical read去重要badge但仍open；显式ignore+原因进入Processed标Ignored；CLI核对mail组仍open active3/total4，未因建议处理而ACK。legacy邮件扫描后同源聚合4实例，resolved那1条不算active。
- 声明式qa-gui-slot通过CLI安装，真实GUI在teamwork.header和sidebar.panel同时显示；设置switch停用，回团队两处均消失。manifest为QA临时文件，无代码/HTML。
- 普通目录欢迎页Open Changes进入capability提示（无Git功能，文件/终端可用）；入口本身仍不应无谓展示，已派UI隐藏该Git快捷入口。
- 0048会话正式实施已派core/UI/mobile；Carbon精确契约已落盘。仅功能验证，最终deepreview尚未开始。

- 半屏真实窗口（Window→Move&Resize→Left）验证：较窄Teamwork默认3成员+Show9；长任务已单行截断且位置基线对齐；目录全收起及长项目列表时设备栏仍贴底；已用Return to Previous Size恢复。窄侧栏Projects chevron被操作区挤掉的小修已派UI。

- root独立0048 conversation/migration定向测试7/7，59 assertions，`/tmp/jedv-root-conversation-functional.log`：含原文完整、bounded context/真审批状态、newTopic并发/幂等、HTTP对等；全功能GUI仍待新构建。
- 实机外观验证：Menu bar activity保留在Appearance→Agent activity，底部已无快捷开关；Solarized Light下Teamwork卡片/邮件/输入正常，已恢复原Dark。普通目录欢迎页Open Changes已在HMR后消失，直接Changes路径仍正确cap提示。

## 0048 协调器独立验收（2026-11-15，最终 review 前）

- `/tmp/jedv-root-conversation-socket.log`：6/6 pass，0 skip；真实双 Host / 编译 CLI / HTTP / Mobile / restart；`/tmp/jedv-root-conversation-functional.log`：7/59。
- 隔离 QA profile `/tmp/jedv-teamwork-final-gui.Il7LKa/app` 已含用户手工聊天/设置，故先保存 before-0048-backup.db，确认 busy turn=0、无草稿；只重启本任务 QA。当前 exec session 86276、Host port 50890。14 条旧消息按原列逐行一致，foreign_key_check=0。
- 人工 Markdown fixture 用 fake AI/独立显式 thread，实际 service send；既有 current、messages、threads、approvals 全部保持，输出 `/tmp/jedv-teamwork-final-gui.Il7LKa/markdown-fixture.json`。没有读取真实 Key 或调用付费模型。
- 原生桌面真实 GUI：主区聊天、历史键盘选择、中文粗体/列表/引用/代码/安全链接、原始 HTML 无活动内容；历史草稿→新话题→历史草稿恢复→清除仅验收草稿→回到当前，全通过。
- 实测已执行审批卡错误展示 Expired，提交 issue #10；UI owner修复后同一真实卡复验 Executed、无 Expired、目标名优先/原始资料在 Details。
- 主区聊天在窄窗口与 Solarized Light 可读、无关键溢出；项目目录 chevron 固定尺寸，左下页脚持续贴底。验收后恢复原窗口及 Dark。
- 手机 393×852 真实 GUI：新配对、组化待处理/已处理、忽略原因内联表单、忽略后显示已忽略。readonly DB 核实 Mail 未 ACK 仍3条；历史选择和中文 Markdown/代码/原始HTML惰性文本、亮暗主题、三屏状态读取、退出返回配对页通过。复用同一 Host current，并未因历史阅读改变默认。
- 全仓 typecheck：22/22 tasks通过（`/tmp/jedv-root-final-typecheck.log`）。首轮全仓 test发现 OSC8测试依赖外部TERM；在TERM=dumb可确定性复现；core仅修测试隔离、恢复TTY/TERM；生产降级正确。第二轮暴露i18n ratchet引用已不存在react-query目录，UIowner处理中。尚未宣称全仓test/build或最终review完成。

- 最新功能验证树 build 已通过：2/2 tasks，生成本地应用/DMG/zip（未签发发布、未notarize），日志 `/tmp/jedv-root-final-build.log`；check:i18n exit0。
- 全仓test第三轮运行至15/16 tasks成功、Host 33项失败，覆盖旧Git create/cleanup fixture与普通目录cap兼容、主线程阻塞gate、PR排序及setup test。按具体失败派发修复，不以局部通过代替最终全仓通过，仍未开始深度review。
- QA为验证Mobile审批TTL修复受控重启到exec5751/port56514；既有数据保留。真实手机已执行/已拒绝卡无过期时间并正常退出；发现target取名显示动作名，Mobileowner修正映射中。

- Project Memory真实GUI补验：Project options → Project Settings → Project memory，范围明确为Project·Teamwork QA API；新增「项目记忆 GUI 验收」并用「幂等键」中文检索命中。使用临时fixture项目，未改变用户真实项目。
- QA当前port56514读取PWA manifest/service-worker为公开静态资源；未授权history API返回401且no-store；实际敏感缓存规则另由Mobile资产测试覆盖。

## 最终集中深度 Review 开始（2026-11-15 14:16 PST）

功能验收收口后才启动本阶段：root全仓test16/16、typecheck22/22、build2/2、i18n通过；`/tmp/jedv-root-final-native.log`70/70 0skip（Team5、network6、M0PTY59），`/tmp/jedv-root-final-memory-butler.log`2/2（真实Host/CLI/fake/noKey/leader原文回信/审批/Memory持久化与提炼）。原Butler测试误用history[0]，已改按requestId+human确认，未改稳定current契约。

- 新Codex Sol backend reviewer：ef749a03-f995-450a-b71f-02f3b7d624e6。
- 新Codex Sol surfaces reviewer：a1613d11-c7fa-4054-97c4-cdd6a116e60b。
- agy Carbon整体架构与契约review：9d7f14b8-9711-4b35-8181-840dd76b9c6a。
- root核对迁移/存量数据/验收证据；Kimi维护稳定文档。只此一次集中review，后续具体发现修复和复验不重新启动泛化review循环。
- 最终QA exec1660/Host49475，Mobile executed/rejected卡显示实际目标短ID fallback，绝不以动作label冒充目标；真实GUI复验并退出。Project Memory新增/中文查询已实测，旧会话/current完整保留。

- GitHub使用问题跟踪新增#10审批Executed/Expired矛盾、#11Mobile目标fallback、#12PR同毫秒历史顺序、#13缺失Git主仓误判普通目录、#14普通目录附件被Git门禁误拦；均如实标识开发树/复现范围，代码修复留在worktree，未关闭issue冒充已发布。
- root完成迁移/存量数据部分集中review，报告`.llmdoc-tmp/teamwork/final-review-root.md`；其它审查报告仍进行中，G5未勾。

- 用户14:xx最新授权完成后提交/推送；后续检查与源码提交由root收口。review发现修复仍在进行，未提前提交。

## Review 修复后的集成复验

- postreview全仓test16/16、typecheck22/22通过。首次build在生成图标被并行重建时读到ENOENT；图标随后存在，待其它检查结束后串行重跑build2/2通过，未为此改源码。
- Memory/Butler实际Host2/2和M0真实PTY59/59通过。Team native曾发现新CAS与adoption重写createdAt冲突，已保持adopt持久身份、排除attach/rename展示字段而保留终态/身份CAS；root独立重跑Team5/5、PTY59/59通过，0skip。Network实际6场景在postreview已通过。
- S4真实GUI：暂停45秒请求期间草稿保留；实际终止本任务owned QA child并自动重连时草稿仍丢失，已重开同一发现交surfaces owner修上层重挂；未发送验收草稿，也未篡改用户输入。该GUI复验尚未通过，不勾G5/G3。
- 同时观察到既有CLI stop对活跃desktop Host误报running:false，根因进程名仅识别jedv-host；已单独提交#25，本次不扩成CLI生命周期改造。用于故障注入的是已核实PID/path、无进行中Butler请求的隔离QA Host，恢复由其原desktop coordinator完成。

- S4最终真实GUI复验通过：在同一Team输入完整中文草稿，SIGTERM隔离owned Host child；AX实际出现Host offline/Retry，自动恢复同一Local Host后完整原文仍在、Send重新可用。只清理本次验收marker，未发送邮件。草稿/dedupe按稳定logicalHostId+Team保存，上层provider重挂不再清空；不同Host隔离和有界清理有定向回归。该项GUI阻塞解除。
- 最新root独立Team5/5、PTY59/59均0skip，实际Memory/Butler2/2通过；Network6场景postreview通过。剩余仅最后整树检查、正式知识提交和已授权push。

## 最终验收收口

最终串行 pipeline 全部 exit 0：test 16/16、typecheck 22/22、i18n、versions 2.1.0、build 2/2、diff-check。72 项实际进程/PTY/socket 场景与原生 GUI 证据、review 处置和外部未验证边界已汇总到 FINAL-VERIFICATION.md。DOD 已据当前证据勾选。下一步按 D14 提交源码，正式 llmdoc 同步后推送开发分支。
