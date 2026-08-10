# Miro Code 视觉与主题规范

> 本文档描述**已定版**的四套主题、语义 token 与视觉规范，色值与 `src/styles/themes.css`、`src/features/editor/theme.ts` 一一对应。

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
| `--bg-app` | `#0f0f12` | 应用底 |
| `--bg-header` | `#1a1a20` | macOS Overlay 标题栏底色 |
| `--bg-panel` | `#16161a` | 侧栏 / 面板 |
| `--bg-elevated` | `#1c1c22` | 卡片 / 输入底 |
| `--bg-editor` | `#0f0f12` | 编辑区 |
| `--bg-terminal` | `#0c0c10` | 终端底 |
| `--bg-overlay` | `rgba(0,0,0,.45)` | 弹层遮罩 |
| `--border-subtle` | `#2a2a32` | 分割线、卡片边 |
| `--text-primary` | `#fafafa` | 标题、主文案 |
| `--text-secondary` | `#d4d4d8` | 说明、次级信息 |
| `--text-muted` | `#a1a1aa` | 占位、未激活 |
| `--accent` | `#8b5cf6` | 主强调（紫） |
| `--accent-soft` | `rgba(139,92,246,.16)` | 选中行 / 侧栏激活底 |
| `--accent-fg` | `#ffffff` | 强调色上的字 |
| `--success` | `#34d399` | 成功 / Git 已暂存 |
| `--warning` | `#fbbf24` | 警告 |
| `--danger` | `#f87171` | 错误 / 删除 |
| `--focus-ring` | `rgba(139,92,246,.45)` | 焦点 |
| `--shadow-card` | `none` | 深色不依赖投影 |

### 3.2 Miro Dawn（`dawn`，浅色）

| Token | 值 | 用途 |
|---|---|---|
| `--bg-app` | `#f7f8fa` | 应用底（干净雾白） |
| `--bg-header` | `#e8eaef` | 标题栏底色（仅最顶系统栏） |
| `--bg-panel` | `#ffffff` | 侧栏 / 面板 |
| `--bg-elevated` | `#ffffff` | 卡片 |
| `--bg-editor` | `#ffffff` | 编辑区纯白 |
| `--bg-terminal` | `#e8ecf1` | 终端底（略深，提升输出对比） |
| `--bg-overlay` | `rgba(15,23,42,.32)` | 遮罩 |
| `--border-subtle` | `#e6e8ec` | 边框 |
| `--text-primary` | `#111114` | 主文案 |
| `--text-secondary` | `#3f3f46` | 次文案 |
| `--text-muted` | `#71717a` | 占位 |
| `--accent` | `#2563eb` | 主强调（蓝） |
| `--accent-soft` | `rgba(37,99,235,.10)` | 选中底 |
| `--accent-fg` | `#ffffff` | 强调色上的字 |
| `--success` | `#059669` | 成功 |
| `--warning` | `#d97706` | 警告 |
| `--danger` | `#dc2626` | 错误 |
| `--focus-ring` | `rgba(37,99,235,.35)` | 焦点 |
| `--shadow-card` | `0 1px 3px rgba(28,28,33,.05)` | 浅色卡片浮起 |
| `--shadow-modal` | `0 16px 48px rgba(28,28,33,.14)` | 弹层 |

### 3.3 Miro Midnight（`midnight`，深蓝深色）

| Token | 值 | 用途 |
|---|---|---|
| `--bg-app` | `#0b1220` | 应用底 |
| `--bg-header` | `#111827` | 标题栏 |
| `--bg-panel` | `#0f172a` | 侧栏 / 面板 |
| `--bg-elevated` | `#111827` | 卡片 |
| `--bg-editor` | `#0b1220` | 编辑区 |
| `--bg-terminal` | `#080e1a` | 终端底 |
| `--bg-overlay` | `rgba(2,6,23,.55)` | 遮罩 |
| `--border-subtle` | `#1e293b` | 边框 |
| `--text-primary` | `#f1f5f9` | 主文案 |
| `--text-secondary` | `#cbd5e1` | 次文案 |
| `--text-muted` | `#94a3b8` | 占位 |
| `--accent` | `#38bdf8` | 主强调（青蓝） |
| `--accent-soft` | `rgba(56,189,248,.14)` | 选中底 |
| `--accent-fg` | `#0f172a` | 强调色上的字 |
| `--success` / `--warning` / `--danger` | `#34d399` / `#fbbf24` / `#f87171` | 状态色 |
| `--focus-ring` | `rgba(56,189,248,.4)` | 焦点 |

### 3.4 Miro Cyberpunk（`cyberpunk`，高对比霓虹）

| Token | 值 | 用途 |
|---|---|---|
| `--bg-app` | `#120a16` | 应用底 |
| `--bg-header` | `#1f1328` | 标题栏 |
| `--bg-panel` | `#1a1020` | 侧栏 / 面板 |
| `--bg-elevated` | `#221428` | 卡片 |
| `--bg-editor` | `#120a16` | 编辑区 |
| `--bg-terminal` | `#0a0610` | 终端底 |
| `--bg-overlay` | `rgba(18,10,22,.62)` | 遮罩 |
| `--border-subtle` | `#3b1f45` | 边框 |
| `--text-primary` | `#faf5ff` | 主文案 |
| `--text-secondary` | `#e9d5ff` | 次文案 |
| `--text-muted` | `#c4b5fd` | 占位 |
| `--accent` | `#22d3ee` | 主强调（青） |
| `--accent-soft` | `rgba(34,211,238,.14)` | 选中底 |
| `--accent-fg` | `#0f172a` | 强调色上的字 |
| `--success` / `--warning` / `--danger` | `#34d399` / `#fbbf24` / `#fb7185` | 状态色 |
| `--focus-ring` | `rgba(244,114,182,.45)` | 焦点 |

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

| 用途 | 建议 |
|---|---|
| UI 字体 | 系统优先：`ui-sans-serif, system-ui, "PingFang SC", "Segoe UI", sans-serif` |
| 代码字体 | `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace` |
| 设置页标题 | 20–22 / Semibold |
| 分区标题 | 14–15 / Medium |
| 正文 / 控件 | 13 |
| 辅助说明 | 12 / secondary |
| 编辑器默认字号 | 13（可配置，`fontSize`） |

---

## 6. 圆角、间距、阴影

| 元素 | 规范 |
|---|---|
| 设置弹层 | radius 16px；柔和阴影，避免多层堆叠 |
| 内容卡片 | radius 12px；1px `--border-subtle` |
| 输入 / 下拉 | radius 8–10px；高度约 32–36px |
| 侧栏菜单项 | radius 8px；激活用 `--accent-soft` |
| 主题缩略图 | radius 10px；选中 2px `--accent` 描边 + 角标勾选 |
| 间距节奏 | 8 / 12 / 16 / 24；卡片内边距 16–20 |

阴影原则：深色主题几乎只靠边框与明度分层；浅色（dawn）可用极轻阴影（`--shadow-card`）提升卡片浮起感。

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
