# 更新日志

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循语义化版本。

## [Unreleased]

### 新增

- 资源树右键菜单新增"在终端中打开"：目录直接进入，文件进入其父目录
- 资源树右键菜单新增"复制文件名"（仅文件）：仅复制 `basename`，不含路径
- 窗口级快捷键补齐：`⌘W` 关闭当前标签、`⌘⌥→` / `⌘⌥←` 切换到下一个 / 上一个标签（首尾循环，VSCode 行为）、`⌘R` 刷新资源树

### 修复

- **i18n**：`ImagePreview.vue` 7 处硬编码中文接入 i18n（新增 `editor.image.*` 键）
- **补全**：Tailwind 类名补全触发条件扩展为同时支持 `class`（HTML/Vue）/ `className`（React/TSX）/ `:class`（Vue 动态绑定）/ `class:list`（Svelte）

## [0.9.0] - 2026-08-07

### 新增

- 发版脚本 `scripts/release-notes.mjs`：从 `CHANGELOG.md` 生成 GitHub Release 正文，与应用内「新功能」同源
- 交接文档 `docs/交接文档.md`：便于后续人类 / Agent 接手继续开发

### 修复

- **设置 / 更新**：去掉检查更新旁冗余文案与按钮；修复 CHANGELOG 节提取在多行 `$` 下被截断，导致更新说明只剩版本标题
- **终端**：FitAddon 在带 padding 容器上多算约 1 行，导致 SSH/本地 Vim 末行截断；改为双层容器挂载 xterm
- **编辑器右键**：`main.ts` 捕获阶段 `preventDefault` 后 CodeMirror `domEventHandlers` 被跳过；改回组件根节点透传原生事件
- **资源管理器**：Tauri macOS WKWebView 上 HTML5 DnD 不可靠，改为 pointer 阈值拖放以真正移动文件
- **主题可读性**：提亮 deep/light 主题 secondary/muted、编辑器注释与终端前景
- **选区高亮**：当前选区对比度高于相同文本 / 查找匹配（避免「选中反而更暗」）
- **Go to Definition**：规范化含 `../` 的相对 import（避免后端拒绝路径）；按磁盘存在性补全扩展名；增强函数/类/方法符号识别
- **查找替换**：修复误把 `.miro-find-row` 设为 `display:none` 导致面板空白；快捷键对齐 VS Code（⌘F / ⌘⌥F·Ctrl+H，Esc / ⌘G / F3）

## [0.8.0] - 2026-08-07

### 新增

- **SFTP**：文件下载至本地；双击可编辑的远程文件在编辑区打开（`miro-sftp://` 虚拟路径），保存时写回远程；右键菜单与 Termius 式交互优化

### 修复

- **SSH / 终端**：关闭终端标签或 SSH 会话时主动断开 Shell/SFTP，并关闭对应远程编辑标签（⌘J 隐藏仍会保活连接，属预期行为）
- **SSH 终端**：Vim 等 TUI 模式检测与输入串行队列，减少滚动/编辑异常

## [0.7.0] - 2026-08-07

### 新增

- 发现新版本时可查看更新说明：解析内置 `CHANGELOG.md` / GitHub Release，标题栏「新功能」、设置页与检查更新弹窗均可打开

### 修复

- **SSH**：Shell 写入与 SFTP 共用 Session 争用导致偶发断连；SFTP 浏览上级目录至 `/` 报非法路径；会话标签优先显示主机「显示名称」
- **SSH / 本地终端**：macOS 下 Vim 等全屏 TUI 无法滚动/编辑（viewport CSS 与 IME 退格拦截）；记住密码凭据文件读写加锁，减少偶发需重新输入
- **终端**：本地终端 ↔ SSH 子视图切换时保活 PTY/远程连接，不再误杀本地正在运行的进程
- Git 编辑区回滚相关交互

## [0.6.0] - 2026-08-06

### 新增

- 资源管理器：拖拽移动文件/文件夹；设置「移动时更新 import」（始终 / 询问 / 从不），可扫描并改写相对路径引用
- 编辑器：文档符号解析，补全与跳转到定义覆盖函数/类/接口等符号
- 欢迎页：支持单项移除与清除全部最近项目
- 编辑区标签：同名文件自动追加父路径直至可区分（如 `components/index.vue`）

### 修复

- 编辑区右键「格式化文档」入口；查找面板与导航操作体验
- 资源树格式化与快捷指令执行相关问题

## [0.5.1] - 2026-08-06

### 修复

- **macOS 启动崩溃（严重）**：Release 包错误动态链接 Homebrew 的 `libssl` / `libcrypto`，自动更新至 0.5.0 后在未安装对应 OpenSSL 的机器上无法启动；改为 **vendored OpenSSL** 静态编入，不再依赖系统/Homebrew 库

## [0.5.0] - 2026-08-05

### 新增

- 文件内查找/替换：VS Code 风格右上角悬浮控件（匹配计数、Aa / 正则 / 全词切换、可展开替换行；⌘⌥F 打开替换）
- SSH 主机列表持久化至 `~/.mirocode/ssh-profiles.json`（应用级全局，多窗口/切换项目共享）
- SSH 连接解锁弹窗：「保存」仅存凭据、「连接」保存并连接
- Release 工作流预留 Windows 代码签名（配置 Secrets 后 CI 自动 Authenticode 签名）
- macOS 构建启用 ad-hoc 签名，减轻从 GitHub 下载后的「已损坏」误报

### 变更

- 切换项目时保留 SSH 子视图；仅断开活跃远程连接，已保存主机不受影响
- 发版说明与 README 补充 macOS / Windows 安装安全提示与绕过方式

### 修复

- 应用内检查更新：修复异步上下文无法写入 Pinia 导致静默失败；设置页内联显示检查结果
- SSH「记住密码」：编辑时空密码不再清掉已存凭据；解锁框支持仅保存
- 左下角 Branches 弹层：分支较多时右键菜单自动上翻/贴边，避免被遮挡

## [0.4.0] - 2026-08-03

### 新增

- 发现新版本时右上角显示「更新」入口；下载过程展示进度；完成后确认是否立即重启（取消则下次启动应用）
- 编辑区文件标签右键：固定 / 关闭 / 关闭其它 / 关闭左侧 / 关闭右侧 / 全部关闭
- 资源树与文件标签右键支持「在资源管理器中显示」（系统 Finder / 资源管理器）

## [0.3.0] - 2026-08-03

### 新增

- 设置可开关 **ESLint** / **Prettier**；**保存时格式化**（依赖 Prettier，调用项目本地 `npx`）
- SFTP：双击进入目录；右键新建文件/文件夹、重命名、删除（递归）、刷新

### 变更

- Git Log 改为**编辑区标签**打开（对齐 VS Code Git Graph 入口）；右侧详情含 Cherry-pick / Checkout / Diff / Rebase 等
- Commit 侧栏改为「暂存的更改 / 更改」分组，行内支持暂存、取消暂存、回滚（对齐图示）
- Miro Dark 编辑器语法高亮提高饱和度；默认主题仍为 Miro Dark
- Vue SFC / CSS 语法高亮修复（`<style>` 嵌套与 `.css` 等）
- Git Log 表格对齐 Git Graph（Graph / Description / Date / Author / Commit）；操作仅右键；右侧只展示提交信息与文件
- 贮藏列表可见：Commit 面板「贮藏」分组 + Git Log stash 行 + 工具栏角标；支持 Apply / Pop / Drop
- **界面语言**：设置中切换中文 / English 后，壳层、编辑区、Git、搜索、终端会话、对话框等操作文案同步切换（`src/i18n`）；macOS 顶部菜单栏同步切换，无需重启
- 禁用 WebView 原生右键菜单（仅保留应用内自定义菜单）

### 修复

- Vue SFC 中 `<style lang="less|scss|sass">` 无语法高亮（此前仅识别空 lang / `css`）；独立 `.less` / `.scss` / `.sass` 改用对应语言包
- Branches 弹层长分支名 / 上游名折行撑高行高；改为单行省略并略加宽面板
- 终端 macOS 输入：退格无效、空格双写、方向键带出残字符、中英切换重复输入、中英切换误插音节撇号（`mai'n`）
- Push 对话框提交行完整 hash 溢出叠字
- Markdown 文件首次打开默认预览模式

## [0.2.0] - 2026-07-30

### 新增

- Git 对标 WebStorm **New UI 完全体主路径**
  - 左侧 Commit：勾选 Changelist、Amend、Commit / Commit and Push；⌘K
  - Push 对话框、Update Project（Merge / Rebase）、Fetch、Stash
  - Branches 弹层：Compare / Set Upstream / 删远程 / Interactive Rebase 等
  - 底栏 Git Log：过滤、加载更多、完整 commit id；Revert / Cherry-pick / Checkout / New Branch / Diff / Interactive Rebase from Here
  - 交互式 Rebase 对话框（pick / reword / squash / fixup / drop + 拖拽排序）；冲突 Continue / Skip / Abort
  - 冲突解决：填入 Base、冲突标记导航、批量接受、状态栏跳转
  - HTTPS 登录弹窗（可记住至 `~/.mirocode/git-credentials.json`）
- 点选变更文件在**编辑区**打开分栏 Diff；编辑器右键支持「显示 Diff / 回滚变更」
- 资源管理器 / Commit / 快速打开 / SFTP：文件与文件夹图标对齐 VS Code **Material Icon Theme**
- Commit 变更状态字母：未跟踪显示绿色 **N**（New）；悬停有中文说明

### 变更

- Commit 侧栏**移除**内嵌 Diff 预览（过小难读、与编辑区 Diff 重复）；点选即开编辑区 Diff

### 修复

- Git 回滚后强制同步编辑器缓冲区（此前仅磁盘还原，打开中的标签仍显示旧内容）
- 状态栏长分支名省略号截断，避免布局错位
- 拉取/推送 HTTPS 认证：走系统 git credential helper；失败时弹出账号密码框
- Log 等操作改用完整 OID，避免短 hash 导致 cherry-pick / reset 失败

## [0.1.1] - 2026-07-28

### 新增

- 应用内自动检查更新（`tauri-plugin-updater`）：启动静默检查 + 设置页手动检查；依赖 GitHub Release `latest.json`
- 多平台发版工作流（`.github/workflows/release.yml`）：macOS / Windows / Linux 云端打包并上传 Release
- 系统 Logo / 应用图标资源
- 图片文件类型预览支持

### 修复

- 终端在 macOS 中文输入法下 Delete/退格误插空格、组字显示异常
- macOS Overlay 标题栏红绿灯对齐

### 构建

- Intel macOS 改用 `macos-15-intel` 原生构建，避免 ARM 交叉编译 OpenSSL 失败

## [0.1.0] - 2026-07-27

### 新增

- 基于 Tauri 2 + Vue 3 的桌面壳与主界面（活动栏 / 侧栏 / 编辑区 / 状态栏）
- CodeMirror 6 多标签编辑、存盘、语法高亮、折叠、本地补全、跳转、Markdown 预览
- 资源管理器：打开文件夹、树浏览、监听外部变更、右键文件操作
- ⌘/Ctrl+P 文件查找；⌘/Ctrl+Shift+F 全局搜索替换
- Git：日常状态 / 暂存 / 提交 / 分支切换；冲突解决与危险操作确认
- 会话：本地终端（PTY）与 SSH（终端 + SFTP）；主机配置全局保存，密码不落盘
- 主题：`miro-dark` / `dawn` / `midnight` / `cyberpunk`
- MIT 许可证与第三方声明打包进安装产物
- 开源社区文件：`CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`
- GitHub Issue / PR 模板与 CI（前端构建 + Rust check）

[Unreleased]: https://github.com/yqstart/MiroCode/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/yqstart/MiroCode/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/yqstart/MiroCode/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/yqstart/MiroCode/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/yqstart/MiroCode/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/yqstart/MiroCode/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/yqstart/MiroCode/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/yqstart/MiroCode/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/yqstart/MiroCode/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/yqstart/MiroCode/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/yqstart/MiroCode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/yqstart/MiroCode/releases/tag/v0.1.0
