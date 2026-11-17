# Jedv 设计系统与交互体验规范（Obsidian Precision · 曜石精工）

> **状态**：生产强制执行（Production-Enforceable）  
> **适用范围**：`apps/desktop`、`packages/ui`、`packages/panes`、`packages/chat-ui`、`packages/i18n` 及 `docs/design/*.pen`  
> **关联设计资产**：`docs/design/jedv-design-system.pen`（Pencil `v2.22` 标准组件库与参考画板）

Jedv 是面向高密度日常研发流（终端、代码/Diff、原生智能体、多智能体团队协作、PR 管理）的本地桌面工作台。本规范确立 **Obsidian Precision（曜石精工）** 为全产品唯一权威视觉与交互体系：以克制的冷调石墨单色基底承载高频操作，以像素级对齐的几何秩序消除界面噪音，让高饱和色彩仅代表真实的系统语义状态。

---

## 1. 设计哲学与核心原则（Obsidian Precision · 曜石精工）

### 1.1 克制单色基底（Monochrome Calm）

1. **95% 中性石墨色阶法则**：界面 **95% 以上**视觉面积必须保持冷静、低彩度的中性石墨色阶（暗色模式 `#0f1012` → `#141518` → `#191b1f` → `#212429`；浅色模式 `#fafafb` → `#f3f4f6` → `#ffffff` → `#eaecef`）。空间层级通过微小的明度递进与 `1px` 低对比度细线（Hairline Border）建立，而非靠厚重投影或彩色背景块区分。
2. **高饱和色仅作语义信号**：饱和色在工作台中是稀缺注意力资源，**仅且唯一**允许用于以下五类真实运行时语义信号：
   - **工作中 / 流式执行**（琥珀暖橙 `#e57a44` / 浅色 `#c95b24`）
   - **待处理 / 权限审批告警**（明黄琥珀 `#f0b429` / 浅色 `#a16207`）
   - **健康 / 检查通过 / Git 新增**（翠绿 `#3fb97a` / 浅色 `#16804a`）
   - **危险 / 执行失败 / Git 删除**（珊瑚红 `#e55353` / 浅色 `#c93b3b`）
   - **未读通知 / 链接引用**（信号蓝 `#589bf7` / 浅色 `#2563eb`）
3. **主操作按钮采用单色高对比反转**：全局首要行动按钮（Primary CTA）采用前景色实心填充（暗色 `#eceef2` 底配 `#0f1012` 字；浅色 `#16181d` 底配 `#fafafb` 字），严禁使用廉价的蓝紫渐变按钮或发光描边。
4. **反 AI 模板化粗糙感（Zero-Tolerance Anti-Slop）**：
   - **严禁**无语义动机的紫/靛渐变背景、径向霓虹光晕（Radial Glow）与装饰性彩色斑块。
   - **严禁**工作台内出现营销落地页式的“三列对称圆底图标特性网格”、标题上方的大写胶囊眉标（ALL-CAPS Eyebrow Chips）、章节标题前缀 Emoji，或常驻的“欢迎回来”空话横幅。
   - **严禁**对 99% 处于正常空闲态的列表行逐行贴满绿色的 `正常 / Active` 胶囊——静默即健康，仅异常或活跃运行态需要显式徽章。

### 1.2 减法与单层原则（Anti-Stacking Discipline）

1. **严禁多重顶栏叠罗汉**：每个区域（左侧栏、主画布、右侧检查器）顶部**仅允许单一 `40px` 顶栏**。严禁在全局 `TabStrip` 下方再叠加厚重的二级会话管理栏、重复大标题横幅或常驻筛选条。
2. **严禁卡片套卡片（No Card-in-Card）**：同一视觉区域最多允许一层容器包裹（即 `主画布背景 --background` → `单层卡片 --card` 或 `细线分隔列表`）。严禁在灰色外框面板内再套带边框的子卡片，严禁为智能体的每一段普通文本回复包裹外层卡片边框。
3. **命令索引深度而非铺满按钮**：保持主列表与编辑画布干净平整；低频、次级与批处理动作统一索引进 **`⌘⇧K` 全局命令面板**（及 `⌘K` 快速搜索/跳转）、标签栏 **`+ ▾` 新建菜单**、上下文菜单或**行级悬停（`:hover` / `:focus-within`）显隐动作**，严禁常驻多行工具栏。
4. **新增界面元素三道准入门槛（Earn-Your-Keep Gates）**：
   - **门禁一（拒绝转嫁决策）**：该控件是否直接闭环高频用户目标？严禁因产品未定好默认行为而塞入“视图配置开关”。
   - **门禁二（优先对象吸收）**：该能力能否作为现有领域对象（项目、工作区、智能体、团队、PR）的内联状态或命令面板动作吸收，而非新增一级导航入口？
   - **门禁三（注意力预算守恒）**：视口注意力是定额预算。每引入一个常驻徽章或按钮，必须明确说明哪个旧元素被合并、折叠或移除。
5. **五秒视线动线与两秒分区扫描**：冷进入任意页面，前 5 秒视线必须依次落于：① 主工作内容区 → ② 主输入/核心行动点 → ③ 左侧工作区上下文；屏幕上任意独立分区必须在 2 秒内用一句话说清唯一职责，否则必须合并或裁撤。

---

## 2. 色彩与材质 Token 体系（Color & Surface Tokens）

所有界面组件必须通过语义化 CSS 变量与 Tailwind Token 取色，**严禁在业务组件中硬编码裸 Hex / RGB 色值**。以下色值与 `apps/desktop/src/renderer/globals.css` 及 `docs/design/jedv-design-system.pen` 保持 **100% 1:1 严格一致**。

### 2.1 中性表面、文本与描边变量（Dark / Light 双模式）

| CSS 自定义属性 | Tailwind 映射类 | Pencil 变量 | Dark（曜石暗色 · 默认） | Light（精工浅色 · `.light`） | 规范用途与层级语义 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--background` | `bg-background` | `$app-bg` | `#0f1012` | `#fafafb` | 主画布底层背景（代码、终端、ACP 对话流、Teamwork 主区） |
| `--sidebar` | `bg-sidebar` | `$sidebar-bg` | `#141518` | `#f3f4f6` | 左侧 `220px` 导航栏与侧边抽屉底色 |
| `--tertiary` | `bg-tertiary` | `$sidebar-bg` | `#141518` | `#f3f4f6` | 次级辅助面板、分栏沉降槽位底色 |
| `--tertiary-active` | `bg-tertiary-active` | `$selected-bg` | `#1e2025` | `#e5e7eb` | 次级面板激活项与选中态背景 |
| `--card` | `bg-card` | `$card-bg` | `#191b1f` | `#ffffff` | 悬浮对话输入卡、工具审批卡、团队成员卡、提交框容器 |
| `--popover` | `bg-popover` | `$card-bg` | `#191b1f` | `#ffffff` | `⌘⇧K` 命令面板、`+ ▾` 下拉菜单、Popover 与 Tooltip |
| `--secondary` | `bg-secondary` | `$elevated-bg` | `#212429` | `#eaecef` | 次级实心按钮、激活标签页、用户消息气泡、`<kbd>` 键帽底色 |
| `--muted` | `bg-muted` | `$elevated-bg` | `#212429` | `#eaecef` | 静音胶囊填充、代码块头部栏、局部加载骨架底色 |
| `--accent` | `bg-accent` | `$elevated-bg` | `#212429` | `#e5e7eb` | 下拉菜单项、命令面板条目悬停与键盘高亮态 |
| `--foreground` | `text-foreground` | `$text` | `#eceef2` | `#16181d` | 一级标题、核心正文、激活态标签文字与主图标 |
| `--muted-foreground` | `text-muted-foreground` | `$muted` | `#8b909a` | `#5e636e` | 次级说明、路径、分支名、相对时间、未激活标签与快捷键提示 |
| `--primary` | `bg-primary` | `$primary-bg` | `#eceef2` | `#16181d` | 主行动按钮（Primary Button）高对比实心填充 |
| `--primary-foreground` | `text-primary-foreground` | `$primary-fg` | `#0f1012` | `#fafafb` | 主行动按钮文字与内部图标色 |
| `--border` | `border-border` | `$line` | `color-mix(in oklab, var(--foreground) 8%, transparent)`（回退 `#25282e`） | `#e3e5e8` | 全局 `1px` 结构分割线、卡片外描边、表格细横线 |
| `--sidebar-border` | `border-sidebar-border` | `$line` | `color-mix(in oklab, var(--foreground) 7%, transparent)`（回退 `#22252a`） | `#e3e5e8` | 侧栏与主画布之间的纵向 `1px` 分割线 |
| `--input` | `border-input` | `$line` | `color-mix(in oklab, var(--foreground) 12%, transparent)`（回退 `#2d3139`） | `#d5d8de` | 输入框、多行文本域、底部悬浮输入卡描边 |
| `--ring` | `ring-ring` | — | `#3b4049` | `#8b909a` | 键盘 `:focus-visible` 焦点环与输入卡聚焦外环 |
| `--fill-hover` | `bg-fill-hover` | — | `color-mix(in oklab, var(--foreground) 7%, transparent)` | `color-mix(in oklab, var(--foreground) 4%, transparent)` | 侧栏 `30px` 行、文件树行、设置表格行鼠标悬停态 |
| `--fill-selected` | `bg-fill-selected` | `$selected-bg` | `color-mix(in oklab, var(--foreground) 10%, transparent)` | `color-mix(in oklab, var(--foreground) 6%, transparent)` | 侧栏当前激活工作区行与选中列表项填充 |

### 2.2 语义状态信号色（Semantic Signal Tokens）

| 语义角色 | CSS 变量 | Pencil 变量 | Dark 色值 | Light 色值 | 严格限定场景 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **工作中（Working）** | `--chart-1` / `--sidebar-primary` | `$working` | `#e57a44` | `#c95b24` | 智能体推理/工具执行中、终端活跃运行脉冲、活跃成员工作徽章 |
| **待审批 / 告警（Warning）** | `--warning` | `$warning` | `#f0b429` | `#a16207` | ACP 工具权限审批待确认、Git 冲突提醒、主机重连提示 |
| **正常 / 通过 / 新增（Success）** | `--success` | `$success` | `#3fb97a` | `#16804a` | CI 检查通过、任务已完成确认、Git Diff 新增行数（`+N`）与新增行底纹 |
| **危险 / 失败 / 删除（Danger）** | `--destructive` | `$danger` | `#e55353` | `#c93b3b` | 进程退出报错、破坏性删除动作、Git Diff 删除行数（`-N`）与删除行底纹 |
| **未读 / 链接（Info / Link）** | `--link` | `$accent-blue` | `#589bf7` | `#2563eb` | 收件箱未读消息圆点/计数、外部 PR 超链接、`@mention` 引用高亮 |

> **语义胶囊配比规范**：所有状态徽章（Status Pill / Micro-badge）**严禁使用 100% 纯度语义色做实心背景**。统一采用 `background: color-mix(in oklab, <semantic> 12%, transparent)`（浅色模式 `10%`）搭配 `1px` `24%` 透明度同色系细描边，内部文字与状态图标采用语义色原色，确保高密度列表下冷静易读。

### 2.3 终端表面融合与浅色对比度红线（Terminal Contrast Invariant）

1. **无缝画布融合**：xterm.js 终端视口背景必须实时同步当前主题 `--background`（Dark `#0f1012` / Light `#fafafb`），严禁出现黑色的硬编码终端块嵌在浅色或石墨灰容器中的割裂感。
2. **浅色模式强制对比度（`minimumContrastRatio: 4.5`）**：当应用处于浅色模式（`.light`）时，所有 xterm 实例**必须强制配置 `minimumContrastRatio: 4.5`**（符合 WCAG AA 正文标准），由渲染引擎自动加深 ANSI 亮白、亮黄、亮青、亮绿等浅色前景字符，彻底杜绝 CLI 工具输出在 `#fafafb` 浅底上失明不可读的问题（暗色模式下保持 `1` 以忠实还原 CLI 原生色板）。

---

## 3. 空间栅格、尺寸与圆角规范（Spatial Grid, Sizing & Radius）

### 3.1 顶栏统一律（The 40px Top-Bar Alignment Law）

1. **全应用 `40px` (`h-10`) 铁律**：左侧导航栏顶部窗口控制区（`WindowChrome`）、主画布标签栏（`TabStrip`）、原生视图会话顶栏及右侧抽屉顶栏（如 `Git Changes Inspector` 顶栏）高度**严格统一为 `40px` (`h-10`)**。
2. **像素级贯通底线**：左、中、右三栏顶栏底部的 `1px` 分割线（`border-b border-border`）必须在**同一条 `y = 40px` 水平像素线上严丝合缝对齐**，严禁任何一栏采用 `36px`、`44px`、`48px` 或 `52px` 造成视觉断层。
3. **顶栏内部控件高度与热区**：
   - 标签页（Tab）、`+ ▾` 新建组合按钮与右侧工具按钮高度统一为 **`28px` (`h-7`)**，上下各留 `6px` 净空。
   - 所有纯图标按钮的可点击物理热区**不得小于 `24×24px`**（顶栏推荐 `28×28px`，行内紧凑按钮最小 `24×24px`），内部 Lucide 图标标准尺寸为 `14px–15px`（描边宽 `1.75px`）。
4. **macOS 原生红绿灯安全区**：桌面端左侧栏展开时，顶部 `40px` 栏左侧必须预留 **`96px` DIP** 原生窗口红绿灯控制安全区；侧栏折叠后，`TabStrip` 自动左移承接该 `96px` 安全内边距，避免第一个标签与系统红绿灯重叠。

### 3.2 左侧导航栏（220px Sidebar & 30px Single-Line Rows）

1. **标准宽度与响应式折叠**：左侧栏默认宽度为 **`220px`**（可手动拖拽调整区间 `180px–320px`）。当应用窗口总宽度 **`< 1100px`** 时，左侧栏必须**自动折叠收起**（可通过 `⌘B` 或顶栏左上角侧栏按钮展开浮层/推拉态），优先保证主编辑与终端画布宽度。
2. **单行 `30px` (`h-[30px]`) 铁律**：侧栏内所有导航入口（`收件箱`）、项目组行、工作区行（`WorkspaceRow`）与团队协作目录行高度**严格固定为单行 `30px` (`h-[30px]`)**，行间距 `2px`，左右内边距 `8px–10px`，文字单行 `truncate` 截断，严禁折行或堆叠副标题变成双行高卡。
3. **固定前导槽位（严禁悬停挤字）**：每条 `30px` 侧栏行左侧必须预留**固定宽度 `16×16px` 图标槽位**（常驻显示分支/项目图标，悬停时在**原槽位内**切换为折叠箭头或拖拽手柄），右侧次级动作浮于末端，**严禁在 `:hover` 时动态插入新宽度节点导致工作区标题左右跳动或二次截断**。
4. **行内 `18px` 微徽章**：侧栏行尾的智能体工作中计数、待审批提醒或未读数统一使用**高度 `18px` (`h-[18px]`)**、最小宽度 `18px`、水平内边距 `px-1.5` 的微徽章，采用等宽数字。

### 3.3 阅读与操作容器宽度契约（Container Width Contracts）

不同认知任务必须匹配对应的水平版心宽度，严禁所有页面一刀切铺满或一刀切缩窄：

| 视图类型 | 宽度契约 | CSS / Tailwind 约束 | 适用模块 |
| :--- | :--- | :--- | :--- |
| **高密度全宽工作面** | 流式全宽（`100%`） | `w-full min-w-0` | 集成终端（Terminal）、代码编辑器、全屏 Diff、分屏窗格网格（Panes）、PR 列表表视图 |
| **专注对话与配置面** | **`768px`** 居中收敛 | `mx-auto w-full max-w-3xl px-6` | 原生 ACP 智能体聊天流（含审批卡与底部悬浮输入卡）、系统与项目设置表单（Settings） |
| **多角色团队指挥面** | **`896px`** 居中收敛 | `mx-auto w-full max-w-4xl px-6` | Teamwork 团队协作主视图（三段式成员矩阵、细线三栏时间线、底部统一发送器） |
| **空状态与快捷引导** | **`300px`** 视口正中 | `mx-auto w-full max-w-[300px]` | 空工作区快速启动动作列表、无更改/无通知空状态（位于画布水平与垂直视觉中心） |

### 3.4 圆角阶梯（Corner Radius Scale）

全局圆角基准变量为 `--radius: 0.5rem`（**`8px`**），严格遵循“外层容器圆角 ≥ 内层控件圆角”的同心圆法则，仅允许以下四档阶梯：

- **`12px` (`rounded-xl` / `calc(var(--radius) + 4px)`)**：底部悬浮输入卡（ACP Composer / Teamwork Composer）、模态对话框（Modal）、`⌘⇧K` 命令面板浮层。
- **`8px` (`rounded-lg` / `var(--radius)`)**：常规单层卡片（ACP 工具审批卡、TeamMemberCard、Git 提交输入卡）、下拉菜单容器（Dropdown / Popover）、代码块容器。
- **`6px` (`rounded-md` / `calc(var(--radius) - 2px)`)**：紧凑微按钮（`xs`）、`28px` 顶栏标签页（Tab）、侧栏 `30px` 导航行、单行表单输入框。
- **`4px` (`rounded-sm` / `calc(var(--radius) - 4px)`)**：`<kbd>` 键盘键帽、侧栏 `18px` 状态微徽章、行内代码标记（Inline Code）。

### 3.5 按钮与胶囊选择器呼吸感规范（Button & Pill Sizing）

- **标准尺寸阶梯**：
  - **`xs`（紧凑工具条 `28px`）**：`h-7 rounded-md px-3 gap-1.5 text-xs`（带图标微胶囊最低不得小于 `px-2.5`）。
  - **`sm`（桌面高频操作 / Composer 提交与筛选胶囊 `30px–32px`）**：`h-7.5`–`h-8 rounded-lg px-3`–`px-4 gap-2 text-xs font-medium`。
  - **`default`（常规弹窗与主表单按钮 `36px`）**：`h-9 rounded-lg px-4 gap-2 text-sm font-medium`。
  - **`icon-*`（纯图标按钮 `28px` / `32px`）**：仅当子元素为**纯单枚图标且无文案/徽章**时使用 `size-7 p-0` 或 `size-8 p-0`。
- **严禁伪类内边距陷阱**：基础原语（`Button`、`InputGroupButton`）**严禁使用 `has-[>svg]:p-0` 或 `has-[>svg]:px-*`**。由于 `:has(>svg)` 伪类优先级高于普通 `px-*` 工具类且不会被 `tailwind-merge` 消解，会导致 `[文案 + 图标]` 按钮（如 `Start task ↑`）水平内边距归零贴边。凡带文案的按钮一律禁止传 `px-0`（如需与左边缘文字视觉对齐，应保留 `px-2.5` 并配合 `-ml-2.5` 负外边距保留热区与悬停背景呼吸感）。

---

## 4. 字体排印与微文案规范（Typography & Microcopy）

### 4.1 字体栈与四级字号体系

- **界面无衬线字体栈（`--font-sans` / `$font`）**：`"Inter", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`。所有计数器、时间戳、徽章与表格列默认启用 `tabular-nums` 等宽数字特性。
- **代码与技术元数据字体栈（`--font-mono` / `$mono-font`）**：`"JetBrains Mono", "SF Mono", "Menlo", "Monaco", "Cascadia Mono", ui-monospace, monospace`。

全应用严格收敛为以下**四级字号阶梯**，禁止散落 `15px`、`17px` 等非标字号：

| 层级 | 字号 | 字重与字体 | 行高 | 适用范围 |
| :--- | :--- | :--- | :--- | :--- |
| **L1 区域/弹窗主标题** | `13.5px–14px` | `500` (`font-medium`) · Sans | `20px` | 视图主标题、模态框标题、团队协作名称、设置分组大标题 |
| **L2 正文与核心控件** | `13px` | `400 / 500` · Sans | `20px`（长文 `1.6`） | 侧栏行标题、标签页标题、按钮文案、ACP 对话正文、表单项名 |
| **L3 次级元数据** | `12px` | `400` · Sans | `16px–18px` | 文件相对路径、分支副信息、时间戳、成员卡任务摘要、表单辅助说明 |
| **L4 键帽与微徽章** | `10.5px–11px` | `500` · **Mono** | `14px` | `<kbd>` 快捷键键帽、`18px` 状态微徽章、`+4 -2` Diff 统计、Commit SHA |

### 4.2 终端等宽字体白名单过滤规范（Terminal Font Sanitization）

1. **严禁混入符号与比例字体**：在枚举系统已安装字体供终端设置选择，以及向 `--jedv-terminal-font-family` 注入字体栈时，**必须执行等宽白名单与双字符宽度一致性（如 `'i'` 与 `'W'` 度量相等）过滤**。
2. **显式黑名单拦截**：强制剔除 `Apple Symbols`、`Apple Braille`、`Apple Color Emoji`、`Zapf Dingbats`、`Webdings`、`Wingdings`、`Symbol`、`LastResort` 及一切非等宽衬线/无衬线字体，防止用户误选或系统回退导致终端网格错位与乱码方块。
3. **安全兜底链**：任何自定义终端字体末尾必须追加 `, "JetBrains Mono", "SF Mono", Menlo, Monaco, ui-monospace, monospace`。

### 4.3 中英文盘古间距与统一术语表（Canonical Terminology）

1. **盘古之白（Pangu Spacing）**：中文与半角英文单词、半角阿拉伯数字、快捷键符号之间保留一个半角空格或视觉微距（例如：`新建 Claude 智能体`、`3 项更改`、`PR #128`；纯符号紧贴除外）。
2. **标准中文术语表（全仓 i18n 强制对齐）**：

| 英文概念 | 唯一标准中文译名 | 严禁出现的混用词 / 反例 |
| :--- | :--- | :--- |
| `Agent / Native Agent` | **智能体** | 代理、AI 助手、机器人、Agent（单独裸露作导航名时） |
| `Teamwork` | **团队协作** | 群组、多代理编排、协同空间、战队 |
| `Inbox` | **收件箱** | 消息盒、通知中心、信箱 |
| `Workspace / Worktree` | **工作区**（需特指 Git 时用 `Git 工作树`） | 工作空间、目录树、沙盒 |
| `Clear`（清空输入/筛选/终端） | **清除** | 清理、抹除、重置（重置仅用于恢复默认配置 `恢复默认`） |
| `Changes` | **更改** | 变更集、修改项、变动 |
| `Approve / Reject` | **允许** / **拒绝** | 批准/驳回、同意/不同意、确定/取消 |

3. **严禁后端内部枚举与协议长文直出主画布**：
   - **禁止裸露枚举值**：严禁将 `no-remote`、`detached`、`worktree_locked`、`spawn_failed`、`SIGTERM` 等后端状态字符串直接渲染为徽章或副标题。必须在前端映射层转译为清晰中文与恢复路径（例如：`no-remote` → 显示 `未关联远程仓库`，并在操作区提供 `添加远程地址`）。
   - **禁止协议免责长文霸屏**：严禁在 ACP 聊天窗口、Teamwork 首屏或设置页顶部常驻大段协议说明、环境变量调试倾泻或免责声明；诊断元数据一律收折于按需展开的详情抽屉或 `Tooltip` 中。

---

## 5. 核心标准组件解剖（Canonical Component Anatomy）

### 5.1 `WindowChrome & TabBar (+ ▾)` 与智能体快捷启动条（`JedvAgentLaunchBar`）

- **结构解剖**：`[左侧栏收起/历史前进后退]` → `[横向无滚动条标签轨 gap-1]` → `[+ ▾ 组合新建器]` → `[可拖拽弹性留白区]` → `[右侧尾部状态与抽屉控制簇]`。
- **标签项必带图标（`28px` / `h-7`）**：圆角 `6px`，最大宽度 `180px`，最小宽度 `96px`。激活态使用 `bg-secondary text-foreground`，非激活态透明底配 `text-muted-foreground`（悬停 `bg-fill-hover`）。内部**必须固定展示 `[14px 面板/智能体专属图标（如 Claude / Codex / Kimi / Antigravity / 终端 / 文件 / 更改）]`** + `[13px 标题 truncate]` + `[16px 尾部槽位：平时显示运行中琥珀圆点或未保存圆点，悬停切换为 × 关闭按钮]`。
- **工作区智能体快捷启动条（`32px` / `h-8` `JedvAgentLaunchBar`）**：打开具体工作区且启用快捷脚本栏时，紧贴 `40px` `TabStrip` 下方渲染单行紧凑 `32px` (`h-8`) 快捷启动条（`border-b border-border/80 bg-sidebar/35`）：左侧 `[⚙️ 管理脚本]` 按钮，紧跟 `[✴ claude]`、`[◎ codex]`、`[◫ kimi]`、`[A agy]` 等 `24px` (`h-6`) 一键启动胶囊（支持 `⌘1`–`⌘9` 快捷键与悬停提示），高频拉起智能体零多级菜单点击。
- **`+ ▾` 组合触发器（`28px`）**：左侧 `+` 点击一键新建当前上下文默认高频标签页（终端或智能体会话），中间 `1px` 细线分隔，右侧 `▾` 展开分类新建菜单（新建终端、新建智能体、分屏面板、打开文件）。
- **右侧尾部控制簇（Trailing Controls）**：严格精简为最多 3–4 个 `28px` 控件：`[📁 文件树/编辑器切换]`、`[+4 -2 Git 更改徽章按钮]`（使用 `$mono-font` `11px` 显示绿增 `#3fb97a` 与红删 `#e55353`，工作区干净时仅显示安静的分支图标）、`[活动 / 检查器抽屉切换]`。

### 5.2 `Sidebar WorkspaceRow`（220px 侧栏与 30px 单行工作区树）

- **顶层架构**：顶部 `40px` `WindowChrome`（底带 `1px` 分割线与主画布 `TabStrip` 对齐） → 主操作按钮 `+ 新建工作区`（`h-[30px]`，`bg-card`，`1px` `border-border` 触感按钮，右置 `<kbd>⌘N</kbd>`） → 全局入口 `收件箱` → 可折叠分组 `团队协作 +` → 可折叠分组 `项目 +` → 底部固定 `36px` 设置与主机连接状态栏。
- **`WorkspaceRow` 解剖（`30px` 单行）**：
  `[16px 固定图标槽：Git 分支图标]` + `gap-2` + `[13px 工作区名 truncate]` + `[flex-1]` + `[18px 状态微徽章]`。
- **反噪音纪律**：仅当工作区内存在运行中智能体（橙色脉冲点 + 数量）、待审批请求（黄色感叹标）或未读汇报时才渲染右侧 `18px` 微徽章；空闲干净的工作区右侧保持完全留白。

### 5.3 `ACP Native Chat View`（原生 ACP 聊天主视图 · `max-w-3xl`）

- **顶部 `40px` 会话栏**：若独立成区则严格保持 `40px` 高（若已嵌入主 `TabStrip` 则通过 `TabStrip` 承载标题，内部子信息条不超过单行轻量工具栏且不重复大标题），左置智能体引擎标识、当前模型选择器与工作区路径，右置清空/导出菜单。
- **中部滚动对话区（居中 `max-w-3xl` / `768px`）**：
  - **用户气泡**：右对齐单层圆角块（`bg-secondary rounded-xl px-3.5 py-2.5 text-[13px]`），不展示多余头像框与昵称前缀。
  - **智能体回复与工具轨迹**：Markdown 回复直接流式排版于 `--background` 画布上（无气泡框）；连续的文件读取与命令检索自动折叠为紧凑的 `28px` 单行轨迹条（图标 + 动作摘要 + 耗时，点击可展开原始输出）。
  - **权限审批卡（Approval Card）**：单层 `bg-card rounded-lg p-3.5`，描边采用 `color-mix(in oklab, var(--warning) 35%, var(--border))`。第一行展示黄色盾牌图标与动作类型（如 `待审批 · 执行终端命令`）；第二行以等宽代码块展示完整待执行指令；底部操作栏右对齐排列：`拒绝`（Ghost，`Esc`）、`本会话始终允许`（Secondary）、`允许`（Primary，`Enter`）。
- **底部悬浮输入卡与全场景剪贴板贴图契约（Universal Image Paste & Attachments）**：所有 Prompt 输入面板（**新建工作区 `NewWorkspaceScreen`、原生 ACP 会话、Butler 对话窗与悬浮坞**）统一采用 `bg-card rounded-xl border border-border/80 shadow-sm` 双层结构，**100% 支持 `⌘V / Ctrl+V` 直接粘贴剪贴板截图/图片、文件拖入及左下角 `[📎]` 选择附件**，在文本域上方渲染圆角缩略图芯片（附 `×` 移除按钮）。**严禁**在新建工作区输入框下方堆砌模板化的“AI 灵感建议胶囊（Improve agent instructions / Find and fix a bug）”。

### 5.4 `Teamwork Command Center`（团队协作指挥台 · `max-w-4xl`）

- **成员状态矩阵（三段式 `TeamMemberCard`）**：采用 2–3 列响应式网格，单层 `bg-card rounded-lg border border-border p-3`，严格固定为**三段式解剖**，禁止超过三层信息：
  1. **首行（身份 + 状态）**：`[14px 角色图标（协调者皇冠 / 成员终端）]` + `[13px 成员代号 font-medium truncate]` + `[弹性留白]` + `[18px 语义状态胶囊：工作中 / 待审批 / 空闲 / 已完成]`。
  2. **中行（当前职责）**：`12px` `text-muted-foreground`（活跃时 `text-foreground/90`）单行或最多两行 `line-clamp-2` 展示当前负责的任务切片。
  3. **末行（工作区与心跳）**：`11px` `$mono-font` `text-muted-foreground` 显示绑定的工作区/分支短名与最近活动相对时间，悬停时在行尾浮现 `跳转终端 ↗` 快捷图标。
- **细线三栏切换（3 Hairline Tabs）**：`全部活动` | `关键汇报` | `共享记忆`。高度 `36px`，底边贯通 `1px` `border-border`，激活态仅以文字变亮（`text-foreground font-medium`）与底部 `2px` 实线指示器标识，严禁套用圆角胶囊盒子背景。
- **底部统一单卡片发送器（`TeamMailComposer`）**：居中 `max-w-4xl`，**单一一层 `bg-card rounded-xl` 卡片**（严禁外层再套底板），顶部内联收件目标胶囊栏（`@全体成员`、`@协调者` 或指定成员多选），中部输入任务指令或邮件正文，右下角 `28px` `发送任务` 按钮。

### 5.5 `Right Git Changes Inspector`（右侧 Git 更改检查器）

- **单层 `40px` 分支与更改顶栏**：顶层右侧检查器抽屉顶栏固定 `40px`（与主画布 `TabStrip` 底线像素级贯通；若作为内嵌子面板则高度控制在 `36px–40px` 单层），左置分支图标、当前分支名与更改文件总数徽章，右置拉取/推送/刷新与收起图标按钮。**严禁**在分支栏下方再叠一层“已暂存 / 未暂存汇总卡片头”。
- **`< 560px` 强制行内 Diff 铁律**：通过容器查询（`@container`）或面板宽度监听，只要 Diff 渲染容器宽度 **`< 560px`**，**无条件强制使用行内单栏差异视图（Inline / Unified Diff）**；仅当用户在主画布打开宽屏 Diff 标签页（`≥ 560px`）时才允许切换并排双栏（Side-by-Side Diff）。
- **`resize-none` 紧凑提交框**：提交信息区域位于文件列表上方或固定顶部，`<textarea>` **必须声明 `resize-none`**（严禁暴露浏览器原生右下角拖拽三角破坏边框圆角），默认 `2–3` 行高并随输入平滑增高（上限 `140px`），下方紧接全宽或右对齐 `28px` 主按钮 `提交更改`（附 `<kbd>⌘↵</kbd>` 提示）。
- **文件更改行（`28px–30px`）**：单行紧凑排列文件图标、文件名、灰色父路径 `truncate`；暂存 `+` 与丢弃更改 `↺` 按钮仅在行 `:hover` / `:focus-within` 时显现，常驻态仅保留最右侧等宽 `+N -M` 或状态字母。

### 5.6 `Keyboard & Settings Tables`（快捷键与设置表格）

- **平整细线布局**：设置视图居中 `max-w-3xl`，同组配置项使用单层顶底细线列表（`divide-y divide-border`）承载，严禁将每一个开关各自包进独立圆角卡片。
- **悬停显隐行级次要动作**：在快捷键映射表、主机列表、环境变量表与自动化规则表中，每行默认仅展示**名称 + 当前值 / `<kbd>` 键帽组**；`编辑`、`恢复默认`、`复制`、`删除` 等行级次要动作按钮默认 `opacity-0 pointer-events-none`，仅在当前行 `:hover` 或键盘 `:focus-within` 时显现（当某项已被用户修改偏离默认值时，可常驻一个 `6px` 低调圆点提示已自定义，悬停再展开 `恢复默认` 按钮）。

---

## 6. 交互状态机与无障碍红线（State Machines & Accessibility）

### 6.1 控件八态与视图完整状态机

1. **控件八态必达**：所有交互组件必须完整实现 `default` → `hover` → `focus-visible` → `pressed`（微弱压暗或 `scale-[0.99]`，禁止夸张弹跳）→ `disabled`（若因前置条件未满足而禁用，Tooltip 必须写明解锁条件，如 `请先填写提交说明`）→ `pending`（**尺寸锁定不抖动**，防连点重入）→ `success` → `error`。
2. **视图异常与未知结果态（Unknown-Outcome Discipline）**：
   - 严禁把“网络/IPC 超时”简单当成“执行失败”清空用户表单。当智能体消息投递、远程主机命令或 `git push` 发生超时，界面必须进入**未知结果对账态**：保留输入框草稿不丢失，提示正在核对工作区真实状态，仅在后端幂等性确认或状态刷新后提供一键重试。
   - 局部子模块报错（如某一个 Worktree Git 状态读取异常）只能在该行或该侧栏局部降级提示，**严禁触发全屏白屏错误边界阻断其余正常终端与编辑器标签页**。

### 6.2 键盘优先、确认策略与无障碍红线

1. **全模态/覆盖层 `Escape` 强制退出**：全应用所有模态对话框（Modal）、抽屉浮层、`⌘⇧K` 命令面板、`+ ▾` 下拉菜单、Popover、图片/Diff 预览层及快捷键录制输入框，**必须 100% 支持按 `Escape` 键即时关闭**，并将键盘焦点精准归还至打开该浮层的触发按钮。
2. **`focus-visible` 焦点环红线**：严禁无替代方案地移除焦点轮廓。所有按钮、标签页、侧栏行、表格操作项与自定义开关在键盘 Tab 导航时，必须显示清晰的 `--ring` 焦点环（`focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`）。任何绑定在鼠标 `:hover` 上的行内操作按钮，必须同时声明 `group-focus-within:opacity-100`，保证纯键盘用户完全可操作。
3. **可逆操作即时生效 vs 破坏性操作指明后果确认**：
   - **可逆操作零弹窗**：切换/关闭普通标签页、折叠目录、暂存/取消暂存 Git 文件、归档已完成团队、修改设置开关——**一律立即生效，严禁弹出“确定要执行吗？”确认框**；有误触风险的可逆动作提供底部安静 Toast + `撤销`。
   - **不可逆破坏性操作强制显名确认**：删除包含未合并代码的 Git 工作区、丢弃未暂存工作树更改、强制终止正在写入的进程、永久删除团队共享记忆或主机凭证——必须弹出模态确认框，标题与主破坏按钮（`bg-destructive`）必须**点明具体受影响对象与数量**（例如：`丢弃 3 个文件的未保存更改`、`永久删除工作区 feat-auth`），严禁使用笼统的 `确定` / `是`。
4. **非纯色依赖与减弱动态**：所有语义状态除颜色外必须同时具备形态区分（工作中旋转环/脉冲点、告警感叹号、成功对勾、错误叉号，Git 增删带 `+` / `-` 符号）；严格遵循系统 `@media (prefers-reduced-motion: reduce)` 关闭位移动画与循环闪烁。

### 6.3 Pencil 设计稿与代码同步维护契约（Design-Code Sync）

1. **单一事实源（Single Source of Truth）**：本文件 `design.md`、Pencil 标准组件库 `docs/design/jedv-design-system.pen` 与 `apps/desktop/src/renderer/globals.css` 构成严格绑定的设计契约。
2. **Pencil-First 演进流程**：凡涉及全局色彩变量调整、主框架尺寸变更（顶栏、侧栏、右抽屉）或新增跨面板核心组件，必须先在 `docs/design/jedv-design-system.pen` 中基于 `$app-bg`、`$sidebar-bg`、`$card-bg`、`$elevated-bg`、`$line` 等双模式变量完成暗/亮双主题验证，同步修订 `design.md`，再落地至 `@jedv/ui` 与桌面端业务代码，确保设计稿与运行态软件像素级一致。
