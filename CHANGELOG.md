# 更新日志

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循语义化版本。

## [Unreleased]

## [1.0.0] - 2026-08-26

### 首个可用大版本

Miro Code 1.0.0 是当前代码基线的首个可用大版本，定位为轻量、快速、顺滑、跨平台、离线优先的桌面代码编辑器。核心工作流已经定版，后续迭代将围绕性能、流畅度和交互体验持续优化。

### 工作区与项目管理

- 工作区资源树支持文件夹打开、目录展开/折叠、刷新、过滤、快速定位当前文件、外部变更监听和 Git 状态标记。
- 支持新建文件/文件夹、重命名、删除、复制、剪切、粘贴、复制绝对/相对路径、格式化文档，以及拖拽移动文件。
- 使用 Material Icon Theme 文件图标，按文件名、扩展名和常见目录名显示对应图标。
- 支持项目最近记录；从项目菜单或 macOS Dock 最近项目打开时可创建独立窗口，不覆盖当前工作区。
- 多窗口工作区、编辑器标签、终端标签、活动文件、光标、固定标签和符合条件的未保存快照按窗口/工作区隔离并恢复。

### 编辑器

- 基于 CodeMirror 6 提供多标签代码编辑、高亮、折叠、查找替换、多光标、行操作、注释、诊断和历史撤销。
- 覆盖 JavaScript、TypeScript、JSX、TSX、Vue、HTML、CSS、SCSS、Sass、Less、JSON、Markdown、YAML、XML、SVG 和 Env 等常用文件类型。
- JavaScript / TypeScript 使用浏览器内嵌 TypeScript LanguageService，支持类型成员补全、自动导入、签名帮助、Hover、诊断、定义、引用和符号重命名。
- Vue 单文件组件使用等长虚拟 TypeScript 文件辅助 `script`，为模板注入 `<script setup>` 顶层绑定；HTML / CSS 使用同源语言服务。
- 语言服务不可用时自动降级到关键词、代码片段、文档词和符号索引，保持基础编辑能力可用。
- 支持全文格式化与单一连续选区格式化；内置 Prettier 离线引擎，项目已安装 Prettier 时优先使用项目版本和配置。
- 支持 Markdown 预览/源码切换和图片/SVG 预览；Markdown、Git Log 描述和详情文本可选中复制。
- 支持自动保存、保存时格式化开关、外部修改冲突提示，以及按工作区恢复打开文件、活动标签、光标和受限未保存内容。

### 搜索与导航

- `⌘/Ctrl+P` Quick Open 支持按文件名模糊查找、打开和最近搜索历史。
- `⌘/Ctrl+Shift+F` 在文件中查找，支持大小写、正则、文件掩码、结果定位、替换预览和确认后全部替换。
- 支持相对路径和 `@/` 别名跳转、定义、Hover、引用面板、跨文件重命名、诊断导航和返回上一跳转位置。

### Git

- Commit 面板提供“暂存的更改/更改”分组，支持全部暂存、单文件暂存、取消暂存、回滚和提交。
- 暂存链路覆盖修改、新增、删除和部分暂存文件；暂存操作通过前端队列和后端 Git 索引锁串行化，避免快速点击、多窗口或状态刷新竞态造成遗漏。
- 支持行内暂存、取消暂存和回滚，文件 Diff、当前版本打开、路径复制、代码评审勾选，以及 Commit / Commit and Push / Amend。
- Git Log 使用真实多车道 SVG 拓扑展示本地分支、远程分支、标签和贮藏，支持筛选、搜索、分页加载、列设置、HEAD/贮藏定位和两提交比较。
- 提交、分支和标签上下文菜单支持 Checkout、New Branch、Create Tag、Diff、Compare、Cherry-pick、Revert、Reset、Merge、Rebase、Rename、Delete 和 Push Tag。
- 支持 Branches 管理、Upstream 设置、Fetch、Pull、Push、Update Project、Stash Apply/Pop/Drop，以及交互式 Rebase 的 pick、reword、squash、fix、drop 和冲突 Continue/Skip/Abort。
- 支持冲突文件列表、Base/本地/远程分栏比较、冲突导航、批量接受一侧、手动编辑保存和状态栏冲突定位。
- HTTPS 认证提供账号密码对话框和可选凭据保存；远程操作支持必要的确认和错误提示。

### 终端与 SSH

- 本地终端以编辑区底部面板运行，支持多终端标签、自动聚焦、可拖拽高度、收起保活和 PTY 生命周期清理。
- 终端标签按 shell 命名（zsh、bash、PowerShell），同一 shell 自动编号；终端输出有界缓冲，避免高频输出阻塞界面。
- Package 入口读取 `package.json` scripts，支持勾选固定脚本、按项目记忆、自动选择 pnpm/npm/yarn/bun；当前终端忙碌时自动新开终端执行。
- 支持 SSH 主机列表、远程终端、主机密钥 TOFU 确认、`known_hosts` 校验、可选密码保存和远程 Shell 关闭；切换工作区时强制清理远程连接。

### 主题、语言与窗口体验

- 提供 `miro-dark`、`dawn`、`midnight`、`cyberpunk` 四套主题，编辑区语法高亮与界面语义色同步切换。
- 支持中文/English 界面即时切换，活动栏、资源树、Git、搜索、终端、对话框和 macOS 原生菜单同步更新，无需重启。
- macOS Overlay 标题栏支持原生红绿灯、首次点击响应、主题底色同步、窗口缩放/全屏布局同步和项目路径复制。
- 修复窗口失焦、长时间空闲和 WebView 动画事件丢失导致的侧栏消失、编辑区黑屏、标签切换异常等问题；关闭窗口时先清理终端，再自动完成窗口关闭，不需要二次点击。
- 设置支持自动保存、保存时格式化、ESLint、Prettier、移动文件时更新 import、字号、主题、语言和布局选项。

### 更新、安全与发布

- 基于 Tauri 2 + Vue 3 + TypeScript + Vite + Pinia，支持 macOS、Windows 和 Linux。
- 应用内通过 GitHub Release 检查更新、校验 updater 签名、下载并重启安装；GitHub Actions 自动构建 macOS Apple Silicon/Intel、Windows x64 和 Linux x64 安装包。
- macOS 使用 ad-hoc 签名，Windows 提供可选 Authenticode 签名配置；安装限制和故障排除见多平台发布文档。
- 文件访问、Git、搜索、SSH 和更新说明渲染均加入路径校验、错误处理、超时清理、敏感信息隔离和 Markdown 链接过滤。
- 采用 MIT 许可证，纯开源免费；本版本坚持离线优先，不包含联网 AI 补全、AI 对话面板、AI Agent、MCP/Skills 生态或插件市场。

[1.0.0]: https://github.com/yqstart/MiroCode/releases/tag/v1.0.0
