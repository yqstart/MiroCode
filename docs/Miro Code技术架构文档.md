# Miro Code 技术架构文档

> 依据《Miro Code代码编辑器需求文档》与《官方定名文档》编制。  
> 视觉基准：`docs/theme1.png`（浅色 Dawn）、`docs/theme2.png`（深色 Miro Dark；仅内部设计参考，非对外宣传素材）。  
> 产品目标：**轻量化、高颜值、跨平台**的桌面代码编辑器。

---

## 1. 文档目的与范围

本文档定义 Miro Code 的技术选型、分层架构、核心模块设计、数据流与非功能指标落地方式，作为研发实现的唯一技术基线。

| 项 | 说明 |
|---|---|
| 产品名 | Miro Code |
| 技术栈 | Tauri 2 + Vue 3 + TypeScript |
| 平台 | Windows / macOS / Linux |
| 不在本期 | 顶部工具栏自定义、插件市场（完整 LSP 服务端自研不在本期，二期接入官方/社区 LSP 已启动） |

---

## 2. 设计原则

1. **轻量优先**：进程少、内存低、启动快；能用系统能力 / 成熟库解决的不自研。
2. **胶水编排**：Rust 侧负责 IO / Git / 索引；前端负责布局、交互与呈现。
3. **视觉一体**：主题以 CSS 变量驱动，深浅色与编辑器高亮同源，避免两套皮肤割裂。
4. **布局可记忆**：分栏尺寸、侧栏状态、打开标签、主题与编辑器偏好持久化。
5. **渐进交付**：先壳层与编辑闭环，再检索与 Git，最后补全语法深度与冲突可视化。

---

## 3. 技术选型

### 3.1 选型总表

| 层级 | 选型 | 理由 |
|---|---|---|
| 桌面壳 | **Tauri 2** | 体积小、内存低、启动快，符合轻量化定位 |
| 前端框架 | **Vue 3 + Composition API + TypeScript** | 组件化清晰，配合 Vite 热更新效率高 |
| 构建 | **Vite** | 与 Vue/Tauri 官方模板一致 |
| 编辑器内核 | **CodeMirror 6** | 比 Monaco 更轻；扩展模型清晰，适合分语言渐进增强 |
| 布局 | **自研 Dock + splitpanes** | 对标 VSCode 左右分栏 / 折叠 / 拖拽，依赖可控 |
| 状态管理 | **Pinia** | 布局、工作区、主题、Git 状态分 store |
| 路由（可选） | 无路由或极简 | 桌面单窗为主，不引入页面路由复杂度 |
| 文件系统 | `@tauri-apps/plugin-fs` + Rust 命令 | 打开目录、读写、监听变更 |
| 对话框 | `@tauri-apps/plugin-dialog` | 打开文件夹 / 确认删除 |
| 自动更新 | `@tauri-apps/plugin-updater` + GitHub `latest.json` | 启动/手动检查；产物需更新签名私钥（CI Secrets） |
| Git | **Rust `git2`（libgit2）** | 性能与可控性优于前端壳调 CLI |
| 搜索索引 | **Rust walkdir + 增量索引**；内容检索优先 ripgrep 风格扫描 | 千级文件可接受；过大项目可后续换 tantivy |
| 配置持久化 | Tauri `Store` / 本地 JSON | 主题、布局、忽略规则、搜索历史 |
| UI 图标 | **Lucide**（控件）+ **Material Icon Theme**（资源树/文件类型） | 控件细线风格；文件图标对齐 VS Code Material Icon Theme |
| 包管理 | pnpm（推荐） | 磁盘占用与安装速度更优 |

### 3.2 为何选 CodeMirror 6 而非 Monaco

| 维度 | CodeMirror 6 | Monaco |
|---|---|---|
| 包体积 / 内存 | 更小，贴合轻量目标 | 偏重，接近 VSCode 内核 |
| 扩展方式 | 语言包 / 扩展组合灵活 | 能力全但定制成本高 |
| 语法能力 | 高亮、折叠、补全、Lint 均可扩展 | 开箱更强，但与「轻」冲突 |
| 结论 | **一期默认内核** | 仅当 CM6 无法满足某语法深度时评估局部引入 |

### 3.3 明确不做的自研

- 不自研文本缓冲与渲染引擎  
- 不自研完整 Git 协议栈（用 libgit2）  
- 不自研完整语言服务器协议实现（一期以编辑器扩展 + 轻量校验为主；**二期已接入**：通过 Rust transport 层桥接 `typescript-language-server` + `@vue/language-server`，不自研 LSP 服务端，宿主提供 Node + 检测降级）

---

## 4. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Miro Code（前端 Vue3）                    │
│  AppShell │ ActivityBar │ SideBar │ EditorArea │ StatusBar   │
│  ThemeProvider │ CommandPalette(后期) │ SettingsModal         │
├─────────────────────────────────────────────────────────────┤
│  Pinia Stores: workspace / layout / editor / git / search   │
├─────────────────────────────────────────────────────────────┤
│              Tauri IPC（commands / events）                   │
├──────────────┬──────────────┬──────────────┬────────────────┤
│  fs / watch  │  search      │  git2        │  settings      │
│  文件读写监听 │  文件名/内容  │  状态/提交   │  配置读写      │
└──────────────┴──────────────┴──────────────┴────────────────┘
                           │
                    操作系统文件 / .git
```

### 4.1 进程边界

| 进程 | 职责 |
|---|---|
| WebView（前端） | UI、编辑器实例、主题、交互状态 |
| Rust 主进程 | 安全的文件访问、Git、目录遍历、全局搜索、配置 IO |
| 可选 Worker（前端） | 大文件语法解析、搜索结果二次过滤（避免阻塞 UI） |

### 4.2 目录结构（建议）

```
MiroCode/
├── apps/
│   └── desktop/                 # Tauri + Vue 应用
│       ├── src/                 # Vue 前端
│       │   ├── app/             # 壳层、布局
│       │   ├── features/        # explorer / editor / search / git / settings
│       │   ├── shared/          # 组件、hooks、utils
│       │   ├── styles/          # tokens、主题
│       │   └── main.ts
│       ├── src-tauri/           # Rust
│       │   ├── src/
│       │   │   ├── commands/    # fs / git / search / settings
│       │   │   ├── services/
│       │   │   └── lib.rs
│       │   └── Cargo.toml
│       └── package.json
├── docs/
├── AGENTS.md
└── README.md
```

一期可先扁平为 `src/` + `src-tauri/`，待模块稳定再拆 `features/`。

---

## 5. 前端模块设计

### 5.1 布局壳（对标 VSCode）

```
┌────────┬──────────┬──────────────────────────────────────┐
│Activity│ SideBar  │           EditorArea                 │
│ Bar    │ Project  │  Tabs：文件 / Diff / 终端 / Git Log  │
│        │ /Commit  │  CodeMirror + MD预览 / Git Graph     │
├────────┴──────────┴──────────────────────────────────────┤
│                     StatusBar                            │
└──────────────────────────────────────────────────────────┘
```

| 区域 | 一期范围 | 说明 |
|---|---|---|
| Activity Bar | Project、Commit；底区 Git Log / 终端 / 设置 | History 打开编辑区 Git Log 标签 |
| SideBar | 切换 Project（资源管理器）与 Commit | Commit：暂存的更改 / 更改 |
| EditorArea | 多标签、Markdown 预览、终端、Git Log | 标签 + 画布互斥焦点 |
| Git Log | 编辑区标签（类 VS Code Git Graph） | 与左侧 Commit 分离 |
| StatusBar | 文件类型、编码、行列、分支、诊断摘要 | 分支菜单含新建/合并等 |
| 顶部菜单 | 系统菜单最低集 | **快捷按钮自定义第一期不做** |
| Settings | 模态设置（对齐 theme 截图结构） | 侧栏分类 + 右侧卡片分组 |

### 5.2 Feature 边界

| Feature | 前端职责 | Rust 职责 |
|---|---|---|
| Explorer | 树渲染、右键菜单、过滤 UI | 目录枚举、CRUD、gitignore/忽略规则 |
| Editor | CM6 实例、标签、预览、主题绑定 | 文件读写、变更监听 |
| Search | 文件查找 / 内容搜索 UI、历史 | 遍历、匹配、替换落盘 |
| Git | 左侧 Commit（暂存/更改）、编辑区 Git Log、编辑区 Diff、回滚同步缓冲区 | status / stage / commit / branch / pull / push / rebase / discard |
| Settings | 主题、字号、Tab、换行等 | 配置持久化 |
| Theme | CSS 变量切换、编辑器主题同步 | 无 |

---

## 6. 编辑器与语言能力

### 6.1 能力矩阵（需求五大能力）

| 能力 | 实现路径（一期） | 增强路径（二期） |
|---|---|---|
| 语法高亮 | CM6 Language + HighlightStyle，绑定主题 token | Tree-sitter / 更细 grammar |
| 代码折叠 | CM6 fold 扩展 | 语言感知折叠策略 |
| 语法校验 | JSON/YAML/Env 等用轻量 linter；JS/TS 用诊断扩展 | **二期已接入**：LSP publishDiagnostics（ts-ls / volar） + ESLint 合流 |
| 基础补全 | 关键字 / 片段 / 简易上下文补全 | **二期已接入**：LSP completion（含跨文件类型补全） + AI（需求未强制） |
| 引用跳转 | 同文件符号 + 路径/import 解析 | **二期已接入**：LSP definition / references / rename；v1 正则方案保留为降级 fallback |

### 6.2 语法覆盖优先级

按「前端日常最高频」排序，避免一期平均用力：

| 优先级 | 语法 | 一期目标 |
|---|---|---|
| P0 | JS / TS / JSON / Markdown / Vue(SFC 基础) | 高亮 + 折叠 + 基础补全 + 文件跳转 |
| P1 | HTML / CSS / Sass / YAML / Env | 高亮 + 折叠 + 格式校验 |
| P2 | XML / Tailwind 类名 | 高亮 + 类名补全/校验（依赖配置解析） |

Vue SFC：一期实现 `template/script/style` 分区高亮与基础组件路径跳转；props 深度校验放到二期。

### 6.3 Markdown

- 编辑 / 预览切换（或分栏预览二期）
- 预览使用成熟 Markdown 渲染库，不自研解析器

---

## 7. Git 模块设计

### 7.1 能力分层

| 层级 | 能力 | 排期归属 |
|---|---|---|
| L1 | init、status、stage/unstage、commit、分支查看/切换/新建 | 核心期必达 |
| L2 | log、diff、stash、pull/push、关联远程 | 紧随 L1 |
| L3 | merge、冲突可视化、强制推送、重置/回滚、rebase continue | 专业增强期 |
| L4 | **交互式 rebase（已实现主路径）**、子模块、LFS | 子模块/LFS 可后置 |

### 7.2 交互对标（VS Code Source Control + Git Graph）

- **Commit**：左侧工具窗口；暂存的更改 / 更改分组、行内暂存·回滚、Amend、点选打开编辑区 Diff、Commit / Commit and Push；⌘K；Rebase 进行中 Continue/Skip/Abort
- **Push 对话框**：未推送提交列表 + Force push
- **Update Project**：Fetch 后 Merge 或 Rebase（冲突可 Continue）
- **Branches 弹层**：本地/远程、Checkout、Merge、Rebase / Interactive Rebase、Compare、Set Upstream、Rename、Delete（含远程）
- **Git Log**：编辑区标签；过滤、详情侧栏、Cherry-pick、Revert Commit、Reset、Interactive Rebase from Here、New Branch from Here
- **交互 Rebase**：对话框编辑 pick/reword/squash/fix/drop + 排序；系统 git / 应用内重放
- **认证**：HTTPS 登录弹窗 + 记住凭据（`~/.mirocode/git-credentials.json`）；SSH agent / 默认密钥
- **冲突**：编辑区分栏合并（Base/导航/批量接受）；状态栏可跳转

### 7.3 安全约束

- 强制推送、重置、删除分支需二次确认  
- 不在日志中打印 token / 凭据  
- 远程凭据走系统凭据管理或用户显式配置，禁止硬编码

---

## 8. 搜索模块设计

### 8.1 双检索体系（对标 WebStorm）

| 类型 | 入口 | 能力 |
|---|---|---|
| 文件查找 | 快捷键弹层 | 文件名模糊、后缀过滤、历史、跳转打开 |
| 全局内容搜索 | 侧栏或独立面板 | 精确/模糊、大小写、上下文预览、排除目录、批量替换 |

### 8.2 性能策略

1. 尊重忽略规则（`node_modules`、`.git`、`dist` 等默认忽略）  
2. 内容搜索流式回传结果，避免一次性塞满前端  
3. 大文件跳过或截断预览  
4. 替换前提供预览与确认

---

## 9. 主题与视觉体系

详细 token 见《Miro Code视觉与主题规范》。此处仅约束工程实现：

1. **主题 ID**：`miro-dark`（显示名 Miro Dark，默认深色）、`dawn`（Miro Dawn）；预留 `midnight`（Miro Midnight）、`cyberpunk`（Miro Cyberpunk）。  
2. **单一真相源**：`styles/tokens/*.css` 定义语义变量；组件只消费变量，不写死色值。  
3. **编辑器同步**：UI 主题切换时同步 CodeMirror `EditorView.theme` / HighlightStyle。  
4. **圆角与密度**：大圆角卡片（设置页约 12–16px）、控件约 8–10px，贴近 theme 截图。  
5. **动效**：短时、低幅度（150–200ms），禁止夸张弹跳与强光晕堆叠。

---

## 10. 配置与持久化

| 配置域 | 示例 | 存储 |
|---|---|---|
| 外观 | 主题、字号、UI 语言 | settings store |
| 编辑器 | tabSize、wordWrap、lineNumbers | settings store |
| 布局 | 侧栏宽、折叠态、活动面板 | layout store |
| 工作区 | 最近打开目录、打开文件列表 | workspace store |
| 搜索 | 历史关键字、排除规则 | search store |
| 忽略 | 自定义 ignore 列表 | workspace / settings |

配置变更应可热更新 UI，无需重启。

---

## 11. IPC 契约（示例）

前端只通过类型化 API 调用，禁止直接拼裸命令字符串操作 Git。

```ts
// 示例：命令命名空间
workspace.openFolder(path: string): Promise<WorkspaceInfo>
fs.readFile(path: string): Promise<string>
fs.writeFile(path: string, content: string): Promise<void>
fs.watch(path: string): Promise<Unwatch>
search.files(query: FileSearchQuery): Promise<FileSearchHit[]>
search.content(query: ContentSearchQuery): AsyncIterable<ContentHit>
git.status(): Promise<GitStatus>
git.commit(message: string, paths?: string[]): Promise<void>
git.branches(): Promise<BranchInfo[]>
settings.get(): Promise<AppSettings>
settings.set(patch: Partial<AppSettings>): Promise<void>
```

事件：

- `fs://changed`：外部文件变更  
- `git://status-changed`：仓库状态刷新  
- `app://theme-changed`：主题切换（可选，前端本地也可完成）

---

## 12. 非功能需求落地

| 指标 | 目标 | 落地手段 |
|---|---|---|
| 启动时长 | ≤ 2s（常规机器冷启动到可交互） | Tauri、延迟加载 Git/搜索、首屏最小依赖 |
| 千级文件打开 | 无明显卡顿 | 虚拟列表树、懒加载子目录、Rust 侧遍历 |
| 内存 | 显著低于 VSCode | CM6、控制常驻插件、按需创建编辑器实例 |
| 编辑时延 | 输入无感延迟 | 诊断/搜索防抖、Worker 卸载重活 |
| 跨平台 | Win / Mac / Linux | CI 多平台构建矩阵 |

验收时需记录：启动耗时、打开 1000 文件项目内存峰值、全局搜索 10k 命中时的 UI 帧率主观评估。

---

## 13. 安全与质量基线

- 路径访问限制在用户明确打开的工作区根目录内（防路径穿越）  
- 删除 / 覆盖 / 强制推送等破坏性操作必须确认  
- 前端 lint + 类型检查；Rust `clippy`；关键路径单测（路径规范化、ignore、搜索替换预览）  
- 不提交密钥、Token、私钥；示例配置使用占位符

---

## 14. 风险与取舍

| 风险 | 影响 | 应对 |
|---|---|---|
| WebStorm 级 Git 全量复刻过大 | 排期失控 | 按 L1→L3 分层，冲突可视化后置 |
| Vue/TS 深度语言能力不足 | 「专业编辑」感知弱 | 一期保基本体验；**二期已接入 LSP**（ts-ls + volar，宿主提供 Node + 检测降级） |
| Tailwind 自定义配置解析复杂 | 类名补全不准 | 先支持默认类表 + 简易 config 读取 |
| 设计稿曾含 AI/MCP | 范围蔓延 | 已从产品中移除，仅保留本地语法补全 |

---

## 15. 相关文档

| 文档 | 路径 |
|---|---|
| 需求文档 | `docs/Miro Code代码编辑器需求文档.md` |
| 定名规范 | `docs/Miro Code（米罗编辑器）官方定名文档.md` |
| 视觉主题规范 | `docs/Miro Code视觉与主题规范.md` |
| 功能排期 | `docs/Miro Code功能排期.md` |
