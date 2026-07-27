# Miro Code

基于 Tauri + Vue3 的轻量化、高颜值跨平台桌面代码编辑器。

## 快速开始

```bash
pnpm install
pnpm tauri:dev
```

验收样例工作区：启动后打开 `examples/playground`。

发布构建：

```bash
pnpm release
```

## 文档

| 文档 | 说明 |
|---|---|
| [使用说明](docs/使用说明.md) | 快捷键与主路径验收指南 |
| [官方定名](docs/Miro%20Code（米罗编辑器）官方定名文档.md) | 品牌与命名规范 |
| [产品需求](docs/Miro%20Code代码编辑器需求文档.md) | 功能与非功能需求 |
| [技术架构](docs/Miro%20Code技术架构文档.md) | 选型、分层、模块与 IPC |
| [视觉主题](docs/Miro%20Code视觉与主题规范.md) | Dawn / Adnify Dark 等 |
| [功能排期](docs/Miro%20Code功能排期.md) | M0–M6 里程碑 |

## 当前进度

**M0–M6 已全部落地，可统一验收。**

- 打开项目 / 资源树 / CodeMirror 多标签编辑存盘
- ⌘P 文件查找、⌘⇧F 全局搜索替换
- Git 日常闭环 + 冲突解决 + 危险操作确认
- 多语法高亮 / 本地补全 / 跳转 / Markdown 预览
- 四套 Miro 主题；设置仅含编辑器 / 快捷键 / 关于（无 AI）
