# Miro Code 技术架构文档

> 面向维护者与贡献者的技术基线。本文档描述**当前已定版**的技术实现，与代码一一对应；如有出入以代码为准。
> 产品基线版本：**v0.14.0**（2026-08-14）。

---

## 1. 产品与阶段

| 项 | 说明 |
|---|---|
| 产品名 | Miro Code |
| 定位 | 轻量级、快速、顺滑的跨平台桌面代码编辑器 |
| 技术栈 | Tauri 2 + Vue 3 + TypeScript + Pinia + CodeMirror 6 |
| 平台 | Windows / macOS / Linux |
| 阶段 | **功能定版**：核心功能集已收敛，进入优化迭代期（性能 / 流畅度 / 交互体验） |
| 明确不做 | AI 对话面板、AI Agent、MCP / Skills 生态、插件市场、Monaco 替换 CM6 |

已落地能力：资源树、多标签编辑、全局搜索 / 替换、Git（Commit / Log / Branches / Rebase / 冲突）、本地终端、SSH 远程 Shell、四主题、中英文界面、**LSP（TS / Vue）**、**AI 行内补全（ghost text）**、应用内更新。

---

## 2. 设计原则

1. **轻量优先**：进程少、内存低、启动快；能用系统能力 / 成熟库解决的不自研（胶水原则）。
2. **Rust 干重活**：文件 IO、Git、搜索遍历、SSH、AI 流式请求、LSP transport 全部下沉 Rust；前端只做布局、交互与呈现。
3. **视觉一体**：主题以 CSS 变量驱动，UI 与编辑器高亮同源切换，避免两套皮肤割裂。
4. **布局可记忆**：分栏尺寸、侧栏状态、打开标签、主题与编辑器偏好持久化。
5. **优化优先于扩张**：优化项须有可感知效果或可量化指标（启动耗时 / 帧率 / 内存 / 操作延迟），「修一个验一个」。

---

## 3. 技术选型

### 3.1 选型总表

| 层级 | 选型 | 说明 |
|---|---|---|
| 桌面壳 | **Tauri 2** | 体积小、内存低、启动快 |
| 前端框架 | **Vue 3 + Composition API + TypeScript** | 组件化 + Vite 热更新 |
| 构建 | **Vite 6** | 官方模板同源 |
| 编辑器内核 | **CodeMirror 6** | 比 Monaco 更轻；扩展模型清晰 |
| 布局 | **自研 Dock 布局**（AppShell 五区） | 对标 VSCode 左右分栏 / 折叠 / 拖拽 |
| 状态管理 | **Pinia** | 12 个 store，见 §5.2 |
| 文件系统 | `@tauri-apps/plugin-fs` + Rust `fs.rs` | 打开目录、读写、变更监听（watch） |
| 对话框 | `@tauri-apps/plugin-dialog` | 打开文件夹 / 保存 / 确认删除 |
| 自动更新 | `@tauri-apps/plugin-updater` + GitHub `latest.json` | 启动 / 手动检查；需签名私钥（CI Secrets） |
| Git | **Rust `git2` + 系统 Git** | 状态/提交/冲突以 `git2` 为主；push/rebase/delete-remote 等远端或兼容性敏感路径按需走系统 Git |
| 搜索 | **Rust walkdir + ignore + 正则** | async + `spawn_blocking` + LRU 文件列表缓存 |
| SSH | **Rust `ssh2`（libssh2，vendored）** | 主机列表、凭据、远程 Shell |
| AI 补全 | **Rust `reqwest` 流式请求 + tokio** | SSE 逐 chunk 推送前端，取消在途请求 |
| LSP | **Rust stdio transport + 外部语言服务器** | `typescript-language-server` + `@vue/language-server` |
| 终端 | **`@xterm/xterm` + `tauri-plugin-pty`** | 本地 PTY；SSH 走 ssh2 原生通道 |
| 主题 | **CSS 变量 + CodeMirror `EditorView.theme` / `HighlightStyle`** | 四套主题，编辑器同步 |
| 图标 | **Lucide**（控件）+ **Material Icon Theme**（文件图标） | 细线控件；文件类型对齐 VS Code |
| 包管理 | pnpm | `pnpm-lock.yaml` 入库，CI `--frozen-lockfile` |

### 3.2 为什么不用 Monaco

| 维度 | CodeMirror 6 | Monaco |
|---|---|---|
| 包体积 / 内存 | 更小，贴合轻量目标 | 偏重，接近 VSCode 内核 |
| 扩展方式 | 语言包 / 扩展组合灵活 | 能力全但定制成本高 |
| 结论 | **定版内核** | 不在计划内 |

### 3.3 明确不做的自研

- 不自研文本缓冲与渲染引擎（用 CM6）
- 不自研 Git 协议栈（优先复用 `git2` / 系统 Git，按能力边界混合实现）
- 不自研 LSP 服务端（桥接官方/社区语言服务器，宿主提供 Node，缺 Node 降级 v1 正则方案）

---

## 4. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Miro Code（前端 Vue 3）                    │
│  AppShell │ TitleBar │ ActivityBar │ SideBar │ EditorArea    │
│  StatusBar │ SettingsModal │ 编辑区多标签（文件/SSH/GitLog）│ 终端底部面板 │
├─────────────────────────────────────────────────────────────┤
│  Pinia Stores：workspace / ui / editor / git / gitLog /      │
│  search / sessions / ssh / settings / compare / packageScripts │
├─────────────────────────────────────────────────────────────┤
│              Tauri IPC（commands + events）                   │
├──────────┬──────────┬──────────┬──────────┬──────────┬───────┤
│ fs.rs    │ search.rs│ git.rs   │ ssh.rs   │ ai.rs    │ lsp.rs│
│ 文件读写  │ 文件名/内容 │ 状态/提交  │ 远程终端  │ AI 流式  │ LSP  │
│ 监听     │ 搜索/替换 │ 分支/Rebase│ 远程终端  │ 补全请求 │ 传输  │
└──────────┴──────────┴──────────┴──────────┴──────────┴───────┘
                           │
                    操作系统文件 / .git / 子进程（LSP / Node / PTY）
```

### 4.1 进程边界

| 进程 | 职责 |
|---|---|
| WebView（前端） | UI、编辑器实例、主题、交互状态、AI ghost text 渲染 |
| Rust 主进程 | 文件访问、Git、目录遍历、搜索、SSH Shell、AI 请求、LSP 子进程管理、窗口控制（macOS 红绿灯） |
| 外部子进程 | 内置捆绑包的 Node + `typescript-language-server` + `@vue/language-server`（设置内一键安装）；回退时用宿主 npx 启动上述 server 与 Prettier / ESLint；PTY shell |

### 4.2 目录结构（定版）

```
MiroCode/
├── src/                      # Vue 前端
│   ├── app/                  # AppShell / TitleBar / ActivityBar / SideBar / EditorArea / StatusBar
│   ├── features/
│   │   ├── explorer/         # 资源树（pointer 拖拽移动）
│   │   ├── editor/           # CM6 编辑器、查找替换、补全、诊断、导航、主题、AI ghost text
│   │   ├── search/           # QuickOpen（⌘P）/ FindInFiles（⌘⇧F）
│   │   ├── git/              # CommitPanel / GitLogPanel / BranchesPopup / CompareView（冲突）/
│   │   │                     # InteractiveRebaseDialog / PushDialog / UpdateProjectDialog
│   │   ├── sessions/         # 本地终端 / SSH 远程 Shell
│   │   ├── settings/         # 设置弹层（editor / ai / shortcuts / system）
│   │   ├── lsp/              # LSP client（manager / transport / extension / nodeDetector）
│   │   └── ai/               # AI 补全（manager / providers / fimTemplates / streamFilter / …）
│   ├── stores/               # Pinia store（见 §5.2）
│   ├── styles/               # tokens.css / themes.css / global.css
│   ├── shared/               # fs / 对话框 / appUpdate / changelog / SSH API / 组件
│   └── i18n/                 # zh-CN / en-US
├── src-tauri/                # Rust 后端
│   ├── src/commands/         # fs / git / search / ssh / ai / lsp / tooling / path_util / window_chrome
│   ├── src/lib.rs / main.rs  # 命令注册、原生菜单、窗口
│   ├── tests/                # Rust 单测（cargo test 需 --features test）
│   └── tauri.conf.json       # 版本、updater pubkey / endpoints、打包
├── scripts/                  # release-notes.mjs / e2e-ipc-selfcheck.mjs
├── examples/playground/      # 演示工作区（验收高亮 / 搜索 / 诊断 / MD 预览）
└── .github/workflows/        # ci.yml / release.yml（4 平台矩阵）
```

---

## 5. 前端模块设计

### 5.1 布局壳（对标 VSCode）

```
┌────────┬──────────┬──────────────────────────────────────┐
│Activity│ SideBar  │           EditorArea                 │
│ Bar    │ Project  │  多标签：文件 / Diff / GitLog /       │
│        │ /Commit  │  Compare / SSH / Markdown 预览       │
├────────┴──────────┴──────────────────────────────────────┤
│                终端底部面板（TerminalPanel）              │
├──────────────────────────────────────────────────────────┤
│                     StatusBar                            │
└──────────────────────────────────────────────────────────┘
```

| 区域 | 职责 |
|---|---|
| ActivityBar | Project / Commit；底区 GitLog / Package / 设置 |
| SideBar | Project（资源树）与 Commit（暂存 / 更改）切换 |
| EditorArea | 多标签；SSH / GitLog / Compare 等非文件标签固定钉在右侧（终端已改为底部面板） |
| StatusBar | 左侧：终端入口 / 根目录 / 分支（含 ↑↓ 同步标记）/ 语言 / 编码 / 冲突数 / LSP 指示器 / AI 指示器；右侧：Ln/Col / 缩进 / 主题 / Ready |
| 系统菜单 | 原生菜单（文件 / 编辑 / 视图 / 工具 / 帮助），UI 文案随 i18n 切换 |
| Settings | 模态设置，左导航 4 区：编辑器 / AI / 快捷键 / 系统（关于 + 更新） |

### 5.2 Pinia Stores

| Store | 职责 |
|---|---|
| `workspace` | 打开文件夹、最近项目、资源树节点、文件变更监听、切换时重置终端/SSH |
| `ui` | 侧栏状态、活动面板、布局尺寸 |
| `editor` | 打开标签、活动文件、脏标记、保存、定位 |
| `git` / `gitLog` | Git 状态、远程操作守卫（`remoteInFlight` 防并发）、提交历史 |
| `search` | 搜索历史、文件列表缓存 |
| `sessions` | 本地终端会话（PTY 生命周期） |
| `ssh` | SSH 主机列表、远程 Shell、切换项目强制断开 |
| `settings` | 应用设置（主题 / 编辑器 / AI / 更新） |
| `compare` / `packageScripts` / `appUpdate` | 冲突分栏 / npm scripts / 更新状态 |

### 5.3 快捷键体系（三层）

1. **原生菜单加速键**（`lib.rs`）：⌘O / ⌘S / ⌘P / ⌘⇧F / ⌥F1 / ⌘J / ⌘B / ⌘, / ⌘F + 系统编辑键
2. **AppShell 窗口级 keydown**（`AppShell.vue`）：⌘K（Commit 面板）、⌘W（关标签）、⌘⌥→/←（切换标签）、⌘R（刷新资源树）、Esc（关浮层）
3. **编辑器 keymap**（CM6）：⌘F / ⌘⌥F / ⌘H 查找替换、⌘G / F3 跳转、⌘Enter / F12 跳定义、⌘[ 返回、Shift+F12 引用、F2 重命名、Tab / Esc 接受 / 取消 AI ghost text

完整清单见《使用说明》。

---

## 6. 编辑器与语言能力

### 6.1 语言覆盖（`features/editor/languages.ts`）

- **P0**：JS/TS（ts/tsx/mjs/cjs…）、Vue SFC（template 内嵌 scss/sass/less）、JSON、Markdown
- **P1**：HTML、CSS / SCSS / Sass / Less、YAML、XML / SVG、Env（自研 StreamLanguage 键值高亮）

### 6.2 编辑能力

| 能力 | 实现 |
|---|---|
| 高亮 / 折叠 | CM6 Language + `HighlightStyle`，随主题切换 |
| 查找替换 | `findPanel.ts`：⌘F 查找、⌘⌥F / ⌘H 替换、⌘G / F3 下一个 |
| 补全 | `completions.ts`：JS 关键字 + snippet、HTML 标签、CSS 属性、Tailwind 类、文档词、**LSP 语义补全**合流；⌘Space 手动触发 |
| 诊断 | `diagnostics.ts` + `eslintLinter.ts` + **LSP publishDiagnostics** 合流去重（LSP 优先）；JSON / Env 轻量校验 |
| 格式化 | Prettier（`tooling.rs` 调 npx，`--stdin-filepath`） |
| 跳转 | `navigation.ts`：相对路径 + `@/` 别名 import 跳转（`shared/importReferences.ts`）、同文档符号、跨文件符号索引；⌘[ 返回 |
| 重命名 / 引用 | F2 / Shift+F12，LSP 优先，缺 Node 降级 v1 正则 |
| 预览 | Markdown 首次打开默认预览（marked，可切源码）；图片 / SVG 用 `ImagePreview.vue` |
| 自动保存 | `autoSave.ts`：默认开启，1000ms 防抖写盘，页面隐藏 / 关窗前强制 flush |

### 6.3 LSP（`features/lsp/` + `commands/lsp.rs`）

| 项 | 说明 |
|---|---|
| 语言服务器 | `typescript-language-server`（ts/tsx/mts/cts）、`@vue/language-server`（Volar，Vue 优先，缺则降级 ts） |
| 启动策略 | **内置捆绑包优先**（`language_services.rs`：设置内一键安装的 Node + 双 server，路径 `app_data_dir/language-servers/<version>/`）；未安装回退宿主 `npx --no-install`（项目 / 全局 node_modules） |
| 传输 | Rust stdio JSON-RPC + Content-Length 分帧；`spawn_read_loop` 逐消息事件推送 |
| 能力 | hover / 签名帮助 / 语义补全 / 类型诊断 / 定义跳转 / 引用查找 / 重命名（WorkspaceEdit 多文件） |
| 检测降级 | `nodeDetector.ts` 检测内置捆绑包 → node + npx + 两包是否可装；不可用则状态栏告警，各能力回退 v1 正则 |
| 内置捆绑包 | `language_services.rs` 流式下载（多镜像自动降级）→ sha256 校验 → 解压激活；`ls_status` / `ls_install` / `ls_uninstall` 命令 + `ls://progress` 进度事件；产物发布在 GitHub Release 固定 tag `language-servers`（`ls-latest.json` 版本清单，CI workflow `language-servers.yml` 打包 5 平台） |
| 设置 | `lspEnabled` 开关 + 运行时状态展示；一键安装 / 更新 / 卸载 + 镜像源选择（自动 / 官方 / 加速 / 自定义） |

### 6.4 AI 行内补全（`features/ai/` + `commands/ai.rs`）

| 项 | 说明 |
|---|---|
| 形态 | ghost text：CM6 `Decoration.widget` + `WidgetType` 渲染，Tab 接受 / Esc 取消（`Prec.highest`，LSP popup 打开时不拦截） |
| Provider | 内置 **DeepSeek**（apiBase `https://api.deepseek.com/beta`，model `deepseek-v4-pro`）与 **自定义**（OpenAI 兼容端点）两个预设；选择后自动填充可覆盖 |
| 协议 | FIM 走标准 `/completions` 端点（`{prompt, suffix, max_tokens, temperature, stream}`）；前端不拼 `<|fim_begin|>` 等 token，API 服务器内部处理 |
| 流式 | Rust `reqwest` 流式 + tokio 读 SSE，逐 chunk `ai://delta/{reqId}` 推送；前端 `streamFilter.ts` 行级稳定更新 + 300ms 首字提示 |
| 防抖取消 | 350ms 防抖（可配置）；继续输入即 `ai_cancel` 中止 Rust 在途请求 + 前端事件 unlisten |
| 质量过滤 | `contextFilter.ts` 语句已闭合 / 纯注释行跳过请求；`postprocess.ts` 剥代码围栏 / 括号平衡截断 / 重复建议丢弃；`promptBudget.ts` 超预算按 prefix 保底 / suffix 保顶裁剪；`snippets.ts` 从已打开同语言文件抽取相似片段（预算 30%） |
| 凭据 | `~/.mirocode/ai-credentials.json`（0600），不进 localStorage / webview |
| 设置 | 开关 / provider / API Key / 地址 / 模型 / 多行策略（never/auto/always）/ 防抖 / 首字提示 / token 预算 / 温度 / 测试连接（首 delta 即判成功） |
| 指示器 | 状态栏显示就绪 / 思考中 / 错误 |

---

## 7. Git 模块（`features/git/` + `commands/git.rs`）

对标 **VS Code Source Control + Git Graph**，交互参考 WebStorm。

| 能力 | 实现 |
|---|---|
| Commit（左侧） | ⌘K 打开；「暂存的更改 / 更改」分组；单 / 批量暂存与取消；行内回滚；Amend；Commit / Commit and Push |
| 工具栏 | 刷新、打开 Git Log、Update Project（Fetch 后 Merge / Rebase）、Fetch、Pull、Push（对话框 + 未推送列表 + Force）、Stash（计数徽章 + apply/pop/drop） |
| Git Log（编辑区标签） | 分支范围过滤（all/current）+ 远程分支开关 + 文本过滤 + Load More；右键：Checkout / New Branch / Copy / Show Diff / Cherry-pick / Revert / 交互式 Rebase / Reset（soft/mixed/hard）/ stash apply-pop-drop；双击开 Diff |
| Branches 弹层 | 本地 / 远程列表；Checkout、New Branch、Rename、Delete（含远程）、Merge into current、Rebase current onto、交互式 Rebase、Compare with current、Set upstream、Copy |
| 交互式 Rebase | 提交列表 pick / reword / squash / fix / drop + 拖拽排序；冲突时 Commit 横幅 Continue / Skip / Abort |
| 冲突分栏 | `CompareView.vue`（CM6 MergeView）：左右双栏可编辑，prev/next 冲突导航，填本地 / 远程 / Base，一键接受 ours/theirs，手动解决后保存 |
| 认证 | HTTPS 弹窗登录 + 记住凭据（`~/.mirocode/git-credentials.json` + 尽力同步系统 git credential）；SSH 密钥优先 |
| 状态同步 | 资源树 Git 状态色点；状态栏分支 + ↑↓ 同步标记 + 冲突数；编辑区有变更文件右键可 Diff / 回滚，回滚后编辑器内容同步重载 |

**安全约束**：强制推送 / 重置 / 删除分支二次确认；凭据不打印日志；远程操作（push/pull/fetch/update）单一入口 `remoteInFlight` 守卫防并发。

---

## 8. 搜索模块（`features/search/` + `commands/search.rs`）

| 类型 | 入口 | 能力 |
|---|---|---|
| 文件查找（QuickOpen） | ⌘P | 模糊匹配文件名、历史、Enter 打开 |
| 全局内容搜索 | ⌘⇧F 居中弹层 | 精确 / 大小写、文件掩码、结果 `路径:行号`、替换预览与全部替换确认 |

**性能策略**：
- `search_content` / `search_files` / `replace_in_files` 为 **async + `spawn_blocking` + 超时**，避免阻塞 IPC worker（与 git 网络命令同款防阻塞约定）
- 工作区文件列表 **LRU 缓存**（root + 忽略规则为 key，上限 32），避免重复全量遍历
- 前端请求序号竞态保护：新搜索 / 关面板自动丢弃过期结果
- 默认忽略 `node_modules` / `.git` / `dist` 等

---

## 9. 终端 / SSH（`features/sessions/` + `commands/ssh.rs`）

| 项 | 说明 |
|---|---|
| 本地终端 | **底部面板**（VS Code 风格）：状态栏左下角终端按钮 / ⌘J 开关；xterm + PTY（`tauri-plugin-pty`），多标签顶栏；面板高度可拖拽并持久化（`settings.layout.terminalPanelHeight`）；收起时保活（v-show 隐藏），关闭全部终端才销毁；打开面板不打断画布（SSH/GitLog/Compare）聚焦 |
| SSH | **独立编辑区标签**（与本地终端解耦）；主机列表 / 远程终端 |
| 主机配置 | `~/.mirocode/ssh-profiles.json`（应用级全局，与项目无关）；「记住密码」写 `~/.mirocode/ssh-credentials.json`（0600） |
| 密钥校验 | `~/.ssh/known_hosts` + `~/.mirocode/known_hosts`；未知主机指纹需用户确认（TOFU） |
| 切换项目 | 强制关闭本窗口全部远程 Shell；本地终端随工作区重建 |
| 输入桥 | `terminalInputBridge.ts` 拦截纯 Backspace/Delete 直接写控制字符（WKWebView 误报空格兜底 + `suppressNextWhitespace` 标志） |
| 终端尺寸 | 外层 padding + 内层无 padding 挂 xterm；可见后才 `fit + spawn`（隐藏态错误尺寸会致提示符折行） |

---

## 10. 主题与视觉体系

- **主题 ID**：`miro-dark`（默认深色）、`dawn`（浅色）、`midnight`（深蓝）、`cyberpunk`（霓虹）——四套全部可用，设置面板主题卡 / 状态栏主题菜单 / 状态栏主题名右键循环切换
- **单一真相源**：`styles/tokens.css` 定义语义变量（色值见 `themes.css` 四套主题块）；组件只消费变量
- **编辑器同步**：`features/editor/theme.ts` 维护四套 `PALETTES`（含 `HighlightStyle`），UI 主题切换时 `editorThemeExtensions` 同步重建，禁止 UI 已切换而代码区不同步
- **圆角与密度**：设置弹层 16px、内容卡 12px、控件 8–10px；间距节奏 8 / 12 / 16 / 24
- **动效**：150–200ms，纯 CSS（弹层过渡 / 标签动画 / 树 Chevron 旋转 / Toast），见《视觉与主题规范》

---

## 11. 配置与持久化

| 配置域 | 存储 |
|---|---|
| 设置（主题 / 编辑器 / AI / 更新 / 语言） | localStorage（键前缀 `mirocode.*`） |
| 最近项目 / 打开标签 / 布局 | localStorage |
| Git HTTPS 凭据 | `~/.mirocode/git-credentials.json` |
| SSH 主机 / 凭据 | `~/.mirocode/ssh-profiles.json` / `ssh-credentials.json`（0600） |
| SSH known_hosts | `~/.ssh/known_hosts` + `~/.mirocode/known_hosts` |
| AI API Key | `~/.mirocode/ai-credentials.json`（0600） |

配置变更热更新 UI，无需重启（含界面语言 → 原生菜单同步）。

---

## 12. IPC 契约

前端只通过类型化封装调用（`src/shared/` 下的 API 包装），不直接拼裸字符串命令。

**命令命名空间**（Rust `commands/*.rs`）：`fs.*`（读写 / watch / pathExists）、`search.*`（files / content / replace）、`git.*`（status / stage / commit / branch / push / pull / rebase / stash / conflict…）、`ssh.*`（profile / connect / shell）、`ai_*`（请求 / 取消 / 凭据）、`lsp_*`（start / check_runtime）、`tooling.*`（format_with_prettier / lint_with_eslint）、`window_chrome.*`（macOS 红绿灯）。

**事件**：
- `ai://delta/{req_id}`、`ai://done|error/{req_id}`：AI 流式补全
- `lsp://`（`publishDiagnostics` 等）：LSP 消息推送
- `fs://changed`：外部文件变更

---

## 13. 非功能需求落地

| 指标 | 目标 | 落地手段 |
|---|---|---|
| 启动时长 | ≤ 2s（常规机器冷启动到可交互） | Tauri、延迟加载 Git/搜索/LSP |
| 千级文件打开 | 无明显卡顿 | 资源树懒加载子目录、Rust 侧遍历、搜索 LRU 缓存 + async |
| 内存 | 显著低于 VSCode | CM6、编辑器实例按需创建回收、终端/SSH 连接生命周期 |
| 编辑时延 | 输入无感 | 诊断/搜索防抖、LSP 事件化、AI 流式过滤管道 |
| 跨平台 | Win / Mac / Linux | CI 4 平台构建矩阵（arm64 / x86_64 / Linux / Windows） |

---

## 14. 安全与质量基线

- 路径访问限制在打开的工作区根内（`path_util.rs` 防路径穿越；后端 `path_exists` 拒绝含 `..` 的路径，前端先 `resolveRelativePath` 规范化）
- 删除 / 覆盖 / 强制推送等破坏性操作必须确认
- 凭据文件一律 0600，不进 localStorage；禁止硬编码密钥
- CI：前端 `pnpm build`（vue-tsc + vite）+ Rust `cargo check`；Rust 单测 `cargo test --features test`
- 前端 E2E 自检脚本：`pnpm e2e:ipc`（puppeteer 模拟 IPC 并发下 UI 不阻塞）

---

## 15. 相关文档

| 文档 | 路径 |
|---|---|
| 使用说明 | `docs/使用说明.md` |
| 视觉主题规范 | `docs/Miro Code视觉与主题规范.md` |
| 定名规范 | `docs/Miro Code（米罗编辑器）官方定名文档.md` |
| 多平台发布 | `docs/多平台发布.md` |
| 更新日志 | `CHANGELOG.md` |
