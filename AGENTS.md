# Miro Code 工程导航

Miro Code（米罗编辑器）：基于 Tauri + Vue3 的轻量化桌面代码编辑器。

## 产品阶段与方向

- **定位**：轻量级、快速、顺滑的跨平台桌面代码编辑器
- **当前阶段**：功能**定版**（2026-08-10）——核心功能集（资源树 / 编辑 / 搜索 / Git / 终端·SSH / 主题 / LSP / AI 行内补全）全部收敛，进入**优化迭代期**
- **后续方向**：围绕性能、流畅度、交互体验持续打磨，不再扩展大功能模块
- **已落地**：AI 行内智能补全（ghost text 形态，编辑器内补全，非独立面板）、LSP 语言服务（TS / Vue）
- **明确不做**：AI 对话面板、AI Agent、MCP / Skills 生态、插件市场

## 文档索引

| 文档 | 路径 |
|---|---|
| **使用说明（功能与快捷键全览）** | `docs/使用说明.md` |
| 技术架构 | `docs/Miro Code技术架构文档.md` |
| 视觉主题 | `docs/Miro Code视觉与主题规范.md` |
| 官方定名 | `docs/Miro Code（米罗编辑器）官方定名文档.md` |
| 多平台发布 | `docs/多平台发布.md` |
| 开源准备清单 | `docs/开源准备清单.md` |
| 开源许可 | `LICENSE`（MIT） |
| 第三方声明 | `THIRD-PARTY-NOTICES.md` |
| 贡献指南 | `CONTRIBUTING.md` |
| 安全政策 | `SECURITY.md` |
| 行为准则 | `CODE_OF_CONDUCT.md` |
| 更新日志 | `CHANGELOG.md` |

## 技术基线（摘要）

- 桌面壳：Tauri 2
- 前端：Vue 3 + TypeScript + Vite + Pinia
- 编辑器内核：CodeMirror 6（高亮/折叠/诊断/补全/跳转）
- LSP：Rust stdio transport 桥接 `typescript-language-server` + `@vue/language-server`；启动优先**已安装的语言服务捆绑包**（设置内按语言独立安装的 Node + server，`app_data_dir/language-servers/<language>/`），未安装回退宿主 npx（缺则降级 v1 正则）
- AI 补全：Rust reqwest 流式 + SSE 推送，ghost text 渲染（DeepSeek / 自定义 provider）
- 搜索：Rust walk + 模糊/内容检索/替换（async + LRU 缓存）
- Git：Rust `git2`（日常操作 + 冲突解决）
- 主题：`miro-dark` / `dawn` / `midnight` / `cyberpunk`
- 文件图标：Material Icon Theme（资源树 / Commit / 快速打开等）

## 源码结构（当前）

```
src/
  app/                 # AppShell、TitleBar、ActivityBar、SideBar、EditorArea、StatusBar
  features/            # explorer / git / search / editor / settings / sessions / ssh / lsp / ai
  stores/              # settings / workspace / ui / editor / git / search / sessions / ssh
  styles/              # tokens、themes、global
  shared/
src-tauri/             # Tauri 后端、Git/搜索命令、PTY 插件、LSP transport、AI 流式补全
.github/               # CI、Issue / PR 模板
```

Git（`features/git`）对标 **VS Code Source Control + Git Graph**：左侧 Commit（暂存的更改 / 更改分组 + 行内暂存·回滚 + 点选打开编辑区 Diff + Rebase Continue/Abort）；编辑区标签 **Git Log**（过滤 / 详情侧栏 / Revert / Cherry-pick / Checkout / New Branch / Diff / Interactive Rebase）；Branches 弹层（Compare/Upstream/删远程）；冲突分栏（Base/导航）；⌘K 打开 Commit；活动栏 Project / Commit / History。

LSP（`features/lsp`）二期已接入：Rust transport 层（`src-tauri/src/commands/lsp.rs`）管理 `typescript-language-server` + `@vue/language-server` 子进程，stdio JSON-RPC + Content-Length 分帧；前端 `lsp/` 模块封装 LanguageClient 生命周期 + 文档同步 + 多 server 路由；`lspExtension.ts` 桥接 CodeMirror 6 的 7 项能力（hover/签名/补全/诊断/跳转/引用/重命名）。**启动策略**：优先已安装的语言服务捆绑包（`commands/language_services.rs`：按语言独立安装，每语言一个 zip 含便携 Node + 对应 server，存 `app_data_dir/language-servers/<language>/`，多镜像下载 + sha256 校验 + 解压激活），未安装回退宿主 npx；产物由 `.github/workflows/language-servers.yml` 独立发布到 GitHub Release 固定 tag `language-servers`（双层 `ls-latest.json`：`languages.<lang>.platforms.<platform>`，5 平台 × N 语言）。

AI 行内补全（`features/ai` + `features/editor/aiCompletion`）：ghost text 形态，类似 GitHub Copilot。Rust 层（`src-tauri/src/commands/ai.rs`）用 reqwest 流式请求 AI 服务，tokio 读 SSE 逐 chunk `app.emit("ai://delta/{req_id}")`（复刻 LSP `spawn_read_loop`）；前端 `ai/manager.ts` 单例照搬 LspManager 状态机 + 防抖取消；`aiCompletion/ghostTextExtension.ts` 用 CodeMirror 6 `Decoration.widget` + `WidgetType` 渲染 ghost text（CM6 无原生 inline API）+ Tab 接受 / Esc 取消 keymap（`Prec.highest` 抢占，LSP popup 打开时不拦截）；多 provider 预设（DeepSeek `deepseek-v4-pro` / 自定义），FIM 模式走标准 `/completions` 端点（prompt+suffix，API 服务器内部处理 FIM token，前端不拼 `<|fim_begin|>` 等 token）；API Key 存 `~/.mirocode/ai-credentials.json`（0600，复刻 SSH 凭据模式），不进 localStorage；设置面板 AI 配置分区 + 状态栏 AI 指示器。

会话视图：本地终端（`features/sessions`，编辑区标签，⌘J）与 SSH 远程（`features/sessions/SshView.vue` + `stores/ssh.ts`，独立编辑区标签，状态栏左下角 SSH 按钮入口）**已拆分解耦**。
- 本地终端：随工作区切换重建（cwd = 项目根）；多标签顶栏 + Package 快捷芯片；仅关闭标签或切换工作区时销毁（PTY 随组件卸载退出）
- package.json scripts：活动栏终端上方 Package 入口 + 本地终端顶栏快捷芯片；点击后在本地终端注入 `pnpm/npm/yarn/bun run …`
- SSH 远程：独立编辑区标签，含主机列表 / 远程终端 / SFTP；关闭 SSH 标签不影响本地终端，反之亦然
- SSH 主机配置：应用级全局（`~/.mirocode/ssh-profiles.json`），与项目/窗口无关；可选「记住密码」写入 `~/.mirocode/ssh-credentials.json`（0600）
- SSH 主机密钥：校验 `~/.ssh/known_hosts` + `~/.mirocode/known_hosts`；未知密钥需用户确认（TOFU）
- SSH 活跃连接：切换项目时强制关闭本窗口全部远程 Shell / SFTP；SFTP 优先复用同一 Shell Session
- SFTP：上传/下载；双击文件夹进入、双击文本文件在编辑区打开（⌘S 保存回远程）；右键编辑/下载/重命名/删除

## 命名规范

- 对外全称：Miro Code
- 仓库/包名：MiroCode
- 标识符、文件名：英文；界面文案走 `src/i18n`（`zh-CN` / `en-US`）；注释、文档、提交说明：中文
- 品牌说明：与 Miro.com（看板产品）无关联

## 变更约定

架构级变更（目录结构调整、核心技术选型变更）须同步更新本文档与 `docs/Miro Code技术架构文档.md`。

**发版**：每次升版本号发 Release 前，必须同步更新 `CHANGELOG.md`（将 `[Unreleased]` 条目归入新版本节并写明日期）；步骤见 `docs/多平台发布.md`。
