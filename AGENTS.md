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
| 深色基准图 | `docs/theme2.png`（Adnify Dark） |
| 浅色基准图 | `docs/theme1.png`（Dawn） |

## 技术基线（摘要）

- 桌面壳：Tauri 2
- 前端：Vue 3 + TypeScript + Vite + Pinia
- 编辑器内核：CodeMirror 6（高亮/折叠/诊断/补全/跳转）
- 搜索：Rust walk + 模糊/内容检索/替换
- Git：Rust `git2`（日常操作 + 冲突解决）
- 主题：`adnify-dark` / `dawn` / `midnight` / `cyberpunk`

## 源码结构（当前）

```
src/
  app/                 # AppShell、ActivityBar、SideBar、EditorArea、StatusBar
  features/            # explorer / git / search / editor / settings / sessions
  stores/              # settings / workspace / ui / editor / git / search / sessions
  styles/              # tokens、themes、global
  shared/
src-tauri/             # Tauri 后端、Git/搜索命令、PTY 插件
```

会话视图（`features/sessions`）以编辑区标签打开：本地终端 / SSH（主机卡片列表 + 终端/SFTP）；SSH 凭据密码不落盘。

## 命名规范

- 对外全称：Miro Code
- 仓库/包名：MiroCode
- 标识符、文件名：英文；注释、文档、提交说明：中文

## 变更约定

架构级变更（目录结构调整、核心技术选型变更）须同步更新本文档与 `docs/Miro Code技术架构文档.md`。
