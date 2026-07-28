# Miro Code

基于 Tauri + Vue 3 的轻量化跨平台桌面代码编辑器。

**许可证：[MIT](LICENSE)** · 纯开源免费

> 名称取自 Micro + Mirror 的组合寓意，**与 Miro.com（看板产品）无关联**。

## 功能概览

- 打开项目 / 资源树 / CodeMirror 多标签编辑存盘
- ⌘P 文件查找、⌘⇧F 全局搜索替换
- Git 日常闭环 + 冲突解决 + 危险操作确认
- 多语法高亮 / 本地补全 / 跳转 / Markdown 预览
- 本地终端与 SSH（终端 + SFTP）
- 四套主题：`miro-dark` / `dawn` / `midnight` / `cyberpunk`

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

发布构建（生成安装包）：

```bash
pnpm release
```

## 文档

| 文档 | 说明 |
|---|---|
| [使用说明](docs/使用说明.md) | 快捷键与主路径 |
| [贡献指南](CONTRIBUTING.md) | 开发环境与 PR 约定 |
| [安全政策](SECURITY.md) | 漏洞报告方式 |
| [更新日志](CHANGELOG.md) | 版本变更 |
| [开源准备清单](docs/开源准备清单.md) | 公开发布勾选表 |
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
