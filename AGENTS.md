# Miro Code 工程导航

Miro Code（米罗编辑器）：基于 Tauri + Vue3 的轻量化桌面代码编辑器。

## 文档索引

| 文档 | 路径 |
|---|---|
| 官方定名 | `docs/Miro Code（米罗编辑器）官方定名文档.md` |
| 产品需求 | `docs/Miro Code代码编辑器需求文档.md` |
| 技术架构 | `docs/Miro Code技术架构文档.md` |
| 视觉主题 | `docs/Miro Code视觉与主题规范.md` |
| 功能排期 | `docs/Miro Code功能排期.md` |
| 使用说明 | `docs/使用说明.md` |
| 开源准备清单 | `docs/开源准备清单.md` |
| 多平台发布 | `docs/多平台发布.md` |
| 开源许可 | `LICENSE`（MIT） |
| 第三方声明 | `THIRD-PARTY-NOTICES.md` |
| 贡献指南 | `CONTRIBUTING.md` |
| 安全政策 | `SECURITY.md` |
| 行为准则 | `CODE_OF_CONDUCT.md` |
| 更新日志 | `CHANGELOG.md` |
| 深色基准图 | `docs/theme2.png`（Miro Dark；仅内部设计参考，非对外宣传素材） |
| 浅色基准图 | `docs/theme1.png`（Dawn） |

## 技术基线（摘要）

- 桌面壳：Tauri 2
- 前端：Vue 3 + TypeScript + Vite + Pinia
- 编辑器内核：CodeMirror 6（高亮/折叠/诊断/补全/跳转）
- 搜索：Rust walk + 模糊/内容检索/替换
- Git：Rust `git2`（日常操作 + 冲突解决）
- 主题：`miro-dark` / `dawn` / `midnight` / `cyberpunk`

## 源码结构（当前）

```
src/
  app/                 # AppShell、TitleBar、ActivityBar、SideBar、EditorArea、StatusBar
  features/            # explorer / git / search / editor / settings / sessions
  stores/              # settings / workspace / ui / editor / git / search / sessions
  styles/              # tokens、themes、global
  shared/
src-tauri/             # Tauri 后端、Git/搜索命令、PTY 插件
.github/               # CI、Issue / PR 模板
```

会话视图（`features/sessions`）以编辑区标签打开：本地终端 / SSH（主机卡片列表 + 终端/SFTP）。
- 本地终端：随工作区切换重建（cwd = 项目根），并强制切回「本地终端」子视图
- package.json scripts：活动栏终端上方 Package 入口 + 本地终端顶栏快捷芯片；点击后在本地终端注入 `pnpm/npm/yarn/bun run …`
- SSH 主机配置：应用级全局（`localStorage`），与项目无关，切换项目不丢失；密码不落盘
- SSH 活跃连接：切换项目时强制关闭本窗口全部远程 Shell / SFTP

## 命名规范

- 对外全称：Miro Code
- 仓库/包名：MiroCode
- 标识符、文件名：英文；注释、文档、提交说明：中文
- 品牌说明：与 Miro.com（看板产品）无关联

## 变更约定

架构级变更（目录结构调整、核心技术选型变更）须同步更新本文档与 `docs/Miro Code技术架构文档.md`。

**发版**：每次升版本号发 Release 前，必须同步更新 `CHANGELOG.md`（将 `[Unreleased]` 条目归入新版本节并写明日期）；步骤见 `docs/多平台发布.md`。
