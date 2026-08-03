# 更新日志

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循语义化版本。

## [Unreleased]

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

[Unreleased]: https://github.com/yqstart/MiroCode/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/yqstart/MiroCode/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/yqstart/MiroCode/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/yqstart/MiroCode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/yqstart/MiroCode/releases/tag/v0.1.0
