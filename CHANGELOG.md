# 更新日志

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循语义化版本。

## [Unreleased]

### 新增

- 开源社区文件：`CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`
- GitHub Issue / PR 模板与 CI（前端构建 + Rust check）
- 多平台发版工作流（`.github/workflows/release.yml`）：macOS / Windows / Linux 云端打包并上传 Release
- Intel macOS 使用 `macos-15-intel` 原生构建，避免 ARM 交叉编译 OpenSSL 失败
- 应用内自动检查更新（`tauri-plugin-updater`）：启动静默检查 + 设置页手动检查；依赖 GitHub Release `latest.json`

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

[Unreleased]: https://github.com/yqstart/MiroCode/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yqstart/MiroCode/releases/tag/v0.1.0
