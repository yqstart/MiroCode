# Miro Code

基于 Tauri + Vue 3 的轻量化跨平台桌面代码编辑器。

**许可证：[MIT](LICENSE)** · 纯开源免费

> 名称取自 Micro + Mirror 的组合寓意，**与 Miro.com（看板产品）无关联**。

## 功能概览

- 打开项目 / 资源树（**Material Icon Theme** 文件图标）/ CodeMirror 多标签编辑存盘
- ⌘P 文件查找、⌘⇧F 全局搜索替换
- Git 对标 WebStorm New UI：左侧 Commit、底栏 Log、Branches、交互 Rebase、冲突分栏、HTTPS 登录
- 多语法高亮 / 本地补全 / 跳转 / Markdown / 图片预览
- 本地终端与 SSH（终端 + SFTP）
- 四套主题：`miro-dark` / `dawn` / `midnight` / `cyberpunk`
- 应用内检查更新（GitHub Release）

## 环境要求

| 工具 | 建议版本 |
|---|---|
| Node.js | 20+ |
| pnpm | 9+ |
| Rust | stable |
| 系统 | macOS / Windows / Linux |

系统依赖请按 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/) 安装。

## 快速开始

```bash
pnpm install
pnpm tauri:dev
```

验收样例工作区：启动后打开 `examples/playground`。

仅前端类型检查与静态构建：

```bash
pnpm build
```

本机发布构建（仅当前系统）：

```bash
pnpm release
```

多平台安装包（无需 Windows/Linux 机器）：打 `v*` 标签或 Actions 手动触发，见 [多平台发布](docs/多平台发布.md)。

### macOS 安装提示「已损坏」

从 Release 安装后若系统提示「Miro Code 已损坏，无法打开」，在终端执行：

```bash
xattr -cr "/Applications/Miro Code.app"
```

然后双击或右键 → **打开** 即可。原因与后续发版说明见 [多平台发布 · macOS 故障排除](docs/多平台发布.md#macos安装后提示已损坏无法打开)。

### Windows 安装提示「已保护你的电脑」

从 Release 下载后若 SmartScreen 拦截，在安装界面点 **更多信息** → **仍要运行** 即可；或在 PowerShell 中解除下载标记：

```powershell
Unblock-File -LiteralPath "$env:USERPROFILE\Downloads\Miro Code_*.msi"
```

说明见 [多平台发布 · Windows SmartScreen](docs/多平台发布.md#windowssmartscreen-提示已保护你的电脑)。要彻底消除提示需配置 Windows 代码签名证书（见同文档维护者侧说明）。

## 文档

| 文档 | 说明 |
|---|---|
| [使用说明](docs/使用说明.md) | 快捷键与主路径 |
| [贡献指南](CONTRIBUTING.md) | 开发环境与 PR 约定 |
| [安全政策](SECURITY.md) | 漏洞报告方式 |
| [更新日志](CHANGELOG.md) | 版本变更 |
| [开源准备清单](docs/开源准备清单.md) | 公开发布勾选表 |
| [多平台发布](docs/多平台发布.md) | GitHub Actions 打 macOS / Win / Linux 包 |
| [官方定名](docs/Miro%20Code（米罗编辑器）官方定名文档.md) | 品牌与命名 |
| [产品需求](docs/Miro%20Code代码编辑器需求文档.md) | 功能与非功能需求 |
| [技术架构](docs/Miro%20Code技术架构文档.md) | 选型、分层、IPC |
| [视觉主题](docs/Miro%20Code视觉与主题规范.md) | Dawn / Miro Dark 等 |
| [开源许可](LICENSE) | MIT |
| [第三方声明](THIRD-PARTY-NOTICES.md) | 依赖许可证聚合 |
| [功能排期](docs/Miro%20Code功能排期.md) | M0–M6 里程碑 |

## 参与贡献

欢迎 Issue 与 PR，详见 [CONTRIBUTING.md](CONTRIBUTING.md)。参与即同意 [行为准则](CODE_OF_CONDUCT.md)。

## 许可证

[MIT](LICENSE) © MiroCode
