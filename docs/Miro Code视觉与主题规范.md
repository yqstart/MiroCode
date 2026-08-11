# Miro Code 视觉与主题规范

> 本文档描述**已定版**的四套主题、语义 token 与视觉规范，色值与 `src/styles/themes.css`、`src/features/editor/theme.ts` 一一对应。
>
> 2026-08-11 重做：设计语言基线改为 **Mac 原生风**（Arc / Linear / macOS Sonoma+ Big Sur 后 modernUI 路线）：
> - 圆角上调：8/10/12/16 → **10/12/14/18**
> - 背景层级明度差拉到 +12/+13 阶
> - 边线改极淡半透明（深色 5% / 浅色 8%）+ 0.5px ring 表达
> - 阴影 3 级 + ring，柔和浮起
> - 输入/开关控件用 box-shadow ring 表达边线（聚焦不跳）

---

## 1. 设计关键词

| 关键词 | 落地 |
|---|---|
| 极简扁平 | 少阴影层级、无厚重拟物 |
| 低饱和底 + 清晰强调色 | 背景偏灰黑 / 雾白，强调色只用于选中与主操作 |
| 大圆角 | 设置弹层 / 卡片 12–16px；控件 8–10px |
| 通透分区 | 侧栏 / 内容卡 / 编辑区层级分明，留白充足 |
| 轻反馈 | hover / active 用透明度或浅底色，动画 ≤ 200ms |

---

## 2. 主题清单（四套全部可用）

| Theme ID | 显示名 | 角色 | 强调色 |
|---|---|---|---|
| `miro-dark` | Miro Dark | **默认深色**（应用默认） | 紫 `#8b5cf6` |
| `dawn` | Miro Dawn | **浅色** | 蓝 `#2563eb` |
| `midnight` | Miro Midnight | 深蓝深色 | 青蓝 `#38bdf8` |
| `cyberpunk` | Miro Cyberpunk | 高对比霓虹深色 | 青 `#22d3ee` |

切换方式：设置 → 编辑器 → 外观主题（四宫格卡片）；状态栏主题名弹出菜单；状态栏主题名**右键**循环切换。UI 与编辑器高亮同源切换。

---

## 3. 语义色 Token（定版值）

组件与样式**只使用语义变量**（`styles/tokens.css` 声明，`themes.css` 按主题覆盖），禁止散落魔法色值。

### 3.1 Miro Dark（`miro-dark`，默认）

| Token | 值 | 用途 |
|---|---|---|
| `--bg-app` | `#0d0d10` | 应用底（最深） |
| `--bg-header` | `#16161a` | 标题栏底 |
| `--bg-panel` | `#1a1a1f` | 侧栏 / 面板 |
| `--bg-elevated` | `#22222a` | 卡片 / 浮起容器 |
| `--bg-editor` | `#0d0d10` | CodeMirror 区 |
| `--bg-terminal` | `#0a0a0d` | xterm 区 |
| `--bg-overlay` | `rgba(0,0,0,.55)` | 弹层遮罩 |
| `--border-subtle` | `color-mix(in srgb, #ffffff 8%, transparent)` | 极细半透明白边 |
| `--text-primary` | `#f5f5f7` | macOS label |
| `--text-secondary` | `#c7c7cc` | macOS secondary label |
| `--text-muted` | `#8e8e93` | macOS tertiary label |
| `--accent` | `#8b5cf6` | 主强调（紫） |
| `--accent-soft` | `rgba(139,92,246,.14)` | 选中行 / 侧栏激活底 |
| `--accent-fg` | `#ffffff` | 强调色上的字 |
| `--success` | `#34d399` | 成功 / Git 已暂存 |
| `--warning` | `#fbbf24` | 警告 |
| `--danger` | `#f87171` | 错误 / 删除 |
| `--focus-ring` | `rgba(139,92,246,.45)` | 焦点 |
| `--shadow-card` | `0 1px 2px rgba(0,0,0,.2)` | 极轻浮起 |
| `--shadow-popover` | `0 8px 24px rgba(0,0,0,.32), 0 1px 2px rgba(0,0,0,.12)` | 弹层 / 右键菜单 |
| `--shadow-modal` | `0 24px 64px rgba(0,0,0,.5), 0 4px 12px rgba(0,0,0,.2)` | 弹层更强 |

### 3.2 Miro Dawn（`dawn`，浅色 / 雾白）

| Token | 值 | 用途 |
|---|---|---|
| `--bg-app` | `#f5f5f7` | 应用底（macOS 标准雾白） |
| `--bg-header` | `#ebebed` | 标题栏底 |
| `--bg-panel` | `#ffffff` | 侧栏 / 面板 |
| `--bg-elevated` | `#ffffff` | 卡片 |
| `--bg-editor` | `#ffffff` | 编辑区 |
| `--bg-terminal` | `#ececef` | 终端底 |
| `--bg-overlay` | `rgba(15,23,42,.4)` | 遮罩 |
| `--border-subtle` | `color-mix(in srgb, #000000 10%, transparent)` | 极细半透明黑边 |
| `--text-primary` | `#1c1c1e` | macOS label |
| `--text-secondary` | `#3a3a3c` | macOS secondary label |
| `--text-muted` | `#8e8e93` | macOS tertiary label |
| `--accent` | `#2563eb` | 主强调（蓝） |
| `--accent-soft` | `rgba(37,99,235,.10)` | 选中底 |
| `--accent-fg` | `#ffffff` | 强调色上的字 |
| `--success` | `#059669` | 成功 |
| `--warning` | `#d97706` | 警告 |
| `--danger` | `#dc2626` | 错误 |
| `--focus-ring` | `rgba(37,99,235,.35)` | 焦点 |
| `--shadow-card` | `0 1px 2px rgba(0,0,0,.04), 0 1px 3px rgba(0,0,0,.06)` | 浅色卡片浮起 |
| `--shadow-popover` | `0 4px 16px rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.04)` | 弹层 |
| `--shadow-modal` | `0 16px 48px rgba(0,0,0,.18), 0 4px 12px rgba(0,0,0,.06)` | 弹层更强 |

### 3.3 Miro Midnight（`midnight`，深蓝深色）

| Token | 值 | 用途 |
|---|---|---|
| `--bg-app` | `#0a0f1c` | 应用底 |
| `--bg-header` | `#0f1623` | 标题栏 |
| `--bg-panel` | `#121a2b` | 侧栏 / 面板 |
| `--bg-elevated` | `#1a2335` | 卡片（明度差 +8） |
| `--bg-editor` | `#0a0f1c` | 编辑区 |
| `--bg-terminal` | `#070c17` | 终端底 |
| `--bg-overlay` | `rgba(2,6,23,.6)` | 遮罩 |
| `--border-subtle` | `color-mix(in srgb, #ffffff 7%, transparent)` | 半透明白边 |
| `--text-primary` | `#f5f5f7` | 主文案 |
| `--text-secondary` | `#c7c7cc` | 次文案（macOS 灰） |
| `--text-muted` | `#8e8e93` | 占位（macOS 灰） |
| `--accent` | `#38bdf8` | 主强调（青蓝） |
| `--accent-soft` | `rgba(56,189,248,.16)` | 选中底 |
| `--accent-fg` | `#0f172a` | 强调色上的字 |
| `--success` / `--warning` / `--danger` | `#34d399` / `#fbbf24` / `#f87171` | 状态色 |
| `--focus-ring` | `rgba(56,189,248,.4)` | 焦点 |
| `--shadow-card` | `0 1px 2px rgba(0,0,0,.25)` | 极轻浮起 |
| `--shadow-popover` | `0 8px 24px rgba(0,0,0,.4), 0 1px 2px rgba(0,0,0,.15)` | 弹层 |
| `--shadow-modal` | `0 24px 64px rgba(0,0,0,.55), 0 4px 12px rgba(0,0,0,.25)` | 弹层更强 |

### 3.4 Miro Cyberpunk（`cyberpunk`，高对比霓虹）

| Token | 值 | 用途 |
|---|---|---|
| `--bg-app` | `#0f0812` | 应用底 |
| `--bg-header` | `#1b0f24` | 标题栏 |
| `--bg-panel` | `#1c1124` | 侧栏 / 面板 |
| `--bg-elevated` | `#251630` | 卡片（明度差 +8） |
| `--bg-editor` | `#0f0812` | 编辑区 |
| `--bg-terminal` | `#08040d` | 终端底 |
| `--bg-overlay` | `rgba(18,10,22,.7)` | 遮罩 |
| `--border-subtle` | `color-mix(in srgb, #ffffff 7%, transparent)` | 半透明白边 |
| `--text-primary` | `#f5f5f7` | 主文案 |
| `--text-secondary` | `#c7c7cc` | 次文案（macOS 灰） |
| `--text-muted` | `#8e8e93` | 占位（macOS 灰） |
| `--accent` | `#22d3ee` | 主强调（青） |
| `--accent-soft` | `rgba(34,211,238,.16)` | 选中底 |
| `--accent-fg` | `#0f172a` | 强调色上的字 |
| `--success` / `--warning` / `--danger` | `#34d399` / `#fbbf24` / `#fb7185` | 状态色 |
| `--focus-ring` | `rgba(34,211,238,.45)` | 焦点（已统一为青色系） |
| `--shadow-card` | `0 1px 2px rgba(0,0,0,.3)` | 极轻浮起 |
| `--shadow-popover` | `0 8px 24px rgba(0,0,0,.5), 0 1px 2px rgba(0,0,0,.2)` | 弹层 |
| `--shadow-modal` | `0 24px 64px rgba(0,0,0,.6), 0 4px 12px rgba(0,0,0,.3)` | 弹层更强 |

> 色值如有微调，需同步更新 `themes.css` 与本文档。

---

## 4. 编辑器主题（`features/editor/theme.ts`）

每套主题含独立 `HighlightStyle` 与 `EditorView.theme`，切换 UI 主题时编辑区同步重建，**禁止 UI 已 Dawn 而代码区仍 Dark**。

### 4.1 编辑器 Palette 要点

| 主题 | 背景 | 前景 | 选区 | 选区匹配 | 光标 |
|---|---|---|---|---|---|
| miro-dark | `#0f0f12` | `#f5f8ff` | `rgba(167,139,250,.55)` | `rgba(167,139,250,.18)` | `#8b5cf6` |
| dawn | `#ffffff` | `#111114` | `rgba(37,99,235,.35)` | `rgba(37,99,235,.12)` | `#2563eb` |
| midnight | `#0b1220` | `#f1f5f9` | `rgba(56,189,248,.48)` | `rgba(56,189,248,.16)` | `#38bdf8` |
| cyberpunk | `#120a16` | `#faf5ff` | `rgba(34,211,238,.45)` | `rgba(34,211,238,.16)` | `#22d3ee` |

> 选区（selection）对比度**必须**高于选区匹配（selectionMatch）与搜索结果，避免「选中反而更暗」（雷区）。

### 4.2 语法高亮角色色（Miro Dark 为基准，同源扩展）

| 语法角色 | 深色（miro-dark） | 浅色（dawn） |
|---|---|---|
| keyword | 淡紫 `#c792ea` | 深蓝 `#1d4ed8` |
| string | 暖绿 `#c3e88d` | 深绿 `#047857` |
| comment | 中灰 `#a8b4c4`（斜体） | 中灰 `#6b7280`（斜体） |
| function | 蓝 `#82aaff` | 靛紫 `#6d28d9` |
| number / bool | 琥珀 `#f78c6c` | 深琥珀 `#c2410c` |
| property / tag | 黄 `#ffcb6b` / 红 `#f07178` | 青 `#0e7490` / 蓝 `#1d4ed8` |
| variableName | 近白 `#eeffff` | 深灰 `#1c1c21` |
| punctuation / operator | 青 `#89ddff` | 灰 `#6b7280` / `#374151` |
| invalid | 红 `#ff5370` | 红 `#dc2626` |

Midnight / Cyberpunk 各自维护完整 `HighlightStyle`（青蓝 / 霓虹粉青系），见 `theme.ts`。

---

## 5. 字体与字号

字体栈（`tokens.css` `--font-ui / --font-mono`）：

| 用途 | 建议 |
|---|---|
| UI 字体 | `ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Segoe UI", sans-serif` |
| 代码字体 | `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "PingFang SC", monospace` |

字号 / 行高 token（`tokens.css`）—— 替代散落硬编码，组件内可逐步替换：

| Token | 值 | 用途 |
|---|---|---|
| `--font-size-xs` | `11px` | 状态栏 / 极次要 |
| `--font-size-sm` | `12px` | 辅助说明 / tab / statusBar |
| `--font-size-md` | `13px` | body / 控件正文（默认） |
| `--font-size-lg` | `15px` | 分区标题 / dialog 副标题 |
| `--font-size-xl` | `20px` | 设置页 h1 / 大型 dialog 标题 |
| `--line-height-tight` | `1.4` | 紧凑：按钮 / tab |
| `--line-height-normal` | `1.55` | UI 正文（默认） |
| `--line-height-relaxed` | `1.7` | 段落 / Markdown 预览 |

| 场景 | 推荐字号 | 来源 |
|---|---|---|
| 设置页标题 | 20–22 / Semibold | `--font-size-xl` |
| 分区标题 | 14–15 / Medium | `--font-size-lg` |
| 正文 / 控件 | 13 | `--font-size-md` |
| 辅助说明 | 12 / secondary | `--font-size-sm` |
| 编辑器默认字号 | 13（可配置，`fontSize`） | 由用户设置 |

---

## 6. 圆角、间距、阴影

### 6.1 圆角 token（`tokens.css`，跨主题不变）

| Token | 值 | 用途 |
|---|---|---|
| `--radius-sm` | `8px` | 控件 / 小按钮 / 输入框 |
| `--radius-md` | `10px` | 行内标签 / 小卡片 |
| `--radius-lg` | `12px` | 卡片 / 弹层 |
| `--radius-xl` | `16px` | 设置弹层 / 大型 dialog |

### 6.2 阴影 token（4 级 + 主题覆盖）

| Token | 默认值 | 用途 |
|---|---|---|
| `--shadow-card` | `0 1px 2px rgba(0,0,0,.04), 0 1px 3px rgba(0,0,0,.06)` | 卡片浮起（浅色默认） |
| `--shadow-popover` | `0 4px 16px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.04)` | 弹层 / 右键菜单 |
| `--shadow-modal` | `0 24px 64px rgba(0,0,0,.32), 0 4px 12px rgba(0,0,0,.12)` | 弹层更强 |

> 深色 3 套主题（`miro-dark / midnight / cyberpunk`）的对应阴影值在 `themes.css` 内**单独覆盖**为更深 / 更不透明度更高的版本；浅色 `dawn` 用 tokens.css 默认值。

### 6.3 元素规范

| 元素 | 规范 |
|---|---|
| 设置弹层 | radius `16px` (`--radius-xl`)；`--shadow-modal` |
| 内容卡片 | radius `12px` (`--radius-lg`)；1px `--border-subtle`（半透明）；`--shadow-card` |
| 输入 / 下拉 | radius `8px` (`--radius-sm`)；高度约 32–36px |
| 侧栏菜单项 | radius `8px` (`--radius-sm`)；激活用 `--accent-soft` |
| 主题缩略图 | radius `10px` (`--radius-md`)；选中 2px `--accent` 描边 + 角标勾选 |
| 间距节奏 | 4 / 8 / 12 / 16 / 20 / 24（`--space-1..6`）；卡片内边距 16–20 |
| 边线 | 1px `var(--border-subtle)`（半透明，深色 8% 白 / 浅色 10% 黑） |

**设计原则**（2026-08-11 重制）：
- 深色主题通过「拉开层级明度差 + 半透明边色」表达分区，几乎不依赖投影
- 浅色主题（dawn）靠柔和阴影 + 半透明黑边共同表达浮起
- 强调色（accent）只用于选中与主操作，避免与状态色 / 焦点环竞争视觉

---

## 7. 关键组件样式

### 7.1 设置弹层信息架构（左导航 4 区）

- **编辑器**：外观主题（四宫格）/ 布局（字号、Tab 2/4、自动换行、行号）/ 文件保存（自动保存开关 + 延迟）/ Tooling（ESLint、Prettier、移动文件时更新 import）/ LSP（开关 + 运行时状态）/ 语言（中文 / English）/ 补全提示
- **AI 行内补全**：开关 / provider / API Key / 地址 / 模型 / 多行策略 / 防抖 / 首字提示 / token 预算 / 温度 / 测试连接
- **快捷键**：快捷键对照表
- **系统**：关于 / 启动时自动检查更新 / 检查更新 / License

### 7.2 控件

| 控件 | 规范 |
|---|---|
| Toggle | 开启填充 `--accent` |
| 数字输入 | 右对齐或居中数字，窄宽度 |
| 下拉 | 右 chevron，菜单同圆角体系 |
| 主题卡 | 迷你代码窗缩略 + 名称；选中描边 + ✓ |
| 状态栏指示器 | LSP / AI 用小圆点 + 文案，状态色区分（就绪 / 启动中 / 错误） |

### 7.3 主界面（编辑壳）

- Activity Bar 窄条图标，激活态用 accent 色标或浅底
- 资源树：修改 / Git 状态用点缀色，不抢代码区
- 标签页：当前页背景或底部轻微强调；终端 / SSH / GitLog / Compare 等非文件标签固定钉在右侧
- 状态栏：矮、信息密度中等，不使用刺眼色块

---

## 8. 动效与可访问性

- 面板展开 / 折叠、弹层过渡、标签动画、树 Chevron 旋转、Toast：150–200ms ease，纯 CSS
- 主题切换允许短暂交叉淡入，避免整页闪白
- 对比度：正文与背景满足可读；错误色不仅依赖颜色，需配合图标 / 下划线
- 减少动态效果：尊重系统「减少动态效果」偏好（能读到则遵循）

---

## 9. 验收对照

1. 四套主题均可真实切换，UI 与编辑器高亮同步
2. 深色强调色为紫系，浅色为蓝系；Midnight 青蓝系、Cyberpunk 霓虹系
3. 卡片圆角与留白符合规范，不出现尖锐直角密集表单
4. 选区对比度高于选区匹配 / 搜索结果
5. 无紫色浅色主题、无奶油风衬线海报风等偏离基准的风格漂移
