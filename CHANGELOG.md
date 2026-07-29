# 更新日志

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循语义化版本。

## [Unreleased]

### 新增

- Git Branches：Compare / Set Upstream / 删远程 / Interactive Rebase 入口；修复 Footer 误删
- Git Log：完整 commit id、过滤、加载更多、真 Revert Commit、Interactive Rebase from Here、Checkout / New Branch / Diff
- 交互式 Rebase 对话框（pick/reword/squash/fix/drop + 拖拽排序）；冲突 Continue / Skip / Abort
- 冲突解决：填入 Base、冲突标记导航、批量接受、状态栏跳转；rebase 冲突进入同一解决流

### 变更

- Git 对标 WebStorm **New UI 完全体主路径**：左侧 Commit（Amend / Diff 预览）、Push 对话框、Update Project（Merge/Rebase）、Branches 弹层（本地/远程）、Fetch、Log、HTTPS 登录弹窗、交互 Rebase

### 修复

- 拉取/推送 HTTPS 认证：走系统 git credential helper；失败时弹出账号密码框（可记住），对齐 WebStorm
- 「记住密码」改为写入 `~/.mirocode/git-credentials.json`（并尽力同步系统 helper）；此前仅依赖系统钥匙串，在 App 内常写不进去导致反复弹窗
- Log 操作此前使用短 hash 可能导致 cherry-pick/reset 失败，改为完整 OID

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

[Unreleased]: https://github.com/yqstart/MiroCode/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/yqstart/MiroCode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/yqstart/MiroCode/releases/tag/v0.1.0
