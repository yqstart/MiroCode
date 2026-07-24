# Miro Code 技术方案文档（最终落地版）

> 配套文档：《Miro Code 代码编辑器需求文档.md》
> 本文档为 Miro Code（米罗编辑器）的最终落地方案，覆盖架构、内核、语言服务、Git、UI、构建、安全、测试与里程碑，是开发实现的唯一技术依据。
> 版本：v2.0（落地定稿）｜ 日期：2026-07-24 ｜ 状态：定稿

---

## 0 文档定位与口径变更

v1.0 文档仅写到 UI 视觉体系为止，未给出可直接施工的技术架构。v2.0 在此基础上做三处关键收敛，并补齐施工所需全部章节：

1. **技术架构定死**：明确 Tauri 2 + Vue 3.5 + Monaco 0.52 + Vite 6 的版本矩阵，给出仓库目录结构与模块边界，开发期不再就架构做二次讨论。
2. **常用语言服务直接内置**：TS / Vue / JSON / CSS / HTML / Tailwind 的语言能力以**内置 worker**方式随包提供，开箱即用、零外部进程；XML / YAML 等长尾语言走 LSP sidecar，按需加载。
3. **皮肤只支持深色与浅色**：删除 v1.0 中 Midnight / Cyberpunk / Dawn 三套余留主题，仅保留 **Miro Dark**（默认）与 **Miro Light** 两套，配套两套 Monaco 语法高亮主题。

口径之外的所有内容（Monaco 选型理由、Git 三栏合并器、性能预算、构建打包、安全沙箱、测试金字塔、里程碑）沿用 v1.0 定稿。

---

## 1 总体架构（最终版）

### 1.1 进程拓扑

Miro Code 基于 Tauri 2 双进程模型：Rust 主进程负责文件系统、Git、索引、LSP 托管；WebView 渲染进程承载 Vue3 应用与 Monaco 编辑器。语言服务分两层：

- **内置语言 worker**（WebView 内 Web Worker）：TS、Vue、JSON、CSS、HTML、Tailwind，开箱即用。
- **外部 LSP sidecar**（Rust 托管子进程）：XML（lemminx）、YAML（yaml-language-server），首次打开对应文件时按需启动。

```
┌─────────────────────────────────────────────────────────────┐
│  WebView (Chromium)  ── Vue3 Renderer                        │
│  ┌────────────┐ ┌────────────┐ ┌──────────────────────────┐ │
│  │ Shell 布局 │ │ Monaco     │ │ 内置 Web Worker 群       │ │
│  │ Explorer/  │ │ Editor     │ │  ├ TS Worker (tsserver)  │ │
│  │ Search/Git │ │ Diff/Merge │ │  ├ Vue Worker (Volar)    │ │
│  │ StatusBar  │ │  面板      │ │  ├ JSON Worker           │ │
│  │            │ │            │ │  ├ CSS/HTML Worker       │ │
│  │            │ │            │ │  └ Tailwind Worker       │ │
│  └────────────┘ └────────────┘ └──────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │  Tauri IPC (invoke / event)
┌──────────────────────────┴──────────────────────────────────┐
│  Rust Core (Tauri Main)                                       │
│  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ FS / IO    │ │ Git2     │ │ LSP Host │ │ Indexer      │  │
│  │ 文件树     │ │ (libgit2)│ │ 进程托管 │ │ 全文检索     │  │
│  └────────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└──────────────────────────────────────────────────────────────┘
                           │  stdin/stdout (JSON-RPC)
┌──────────────────────────┴──────────────────────────────────┐
│  LSP Sidecar 子进程群（按需启动）                              │
│   ├ lemminx (XML)        ─ 仅在打开 .xml 时启动              │
│   └ yaml-language-server ─ 仅在打开 .yaml/.yml 时启动        │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 职责划分

| 层 | 进程 | 职责 | 关键依赖 |
|---|---|---|---|
| **Renderer** | WebView | UI 面板、布局、Monaco 编辑器、Diff/Merge 视图、命令面板 | Vue 3.5、Monaco 0.52、Pinia 2 |
| **内置 Language Workers** | Web Worker | TS / Vue / JSON / CSS / HTML / Tailwind 语言服务 | tsserver（in-worker）、@volar/monaco、vscode-json-languageservice |
| **Rust Core** | Tauri Main | 文件系统、Git、LSP 进程生命周期、跨平台打包、安全边界 | git2 0.19、tokio 1、tower-lsp 0.20、tantivy 0.22 |
| **LSP Sidecar** | 子进程 | XML / YAML 语言服务，由 Rust 托管启停 | lemminx、yaml-language-server |

### 1.3 数据流原则

1. **Renderer 不直接接触文件系统**：所有文件读写经 Tauri `invoke` 走 Rust Core，保证安全沙箱与跨平台一致性。
2. **重计算下放 Worker**：语法解析、补全、全文索引在 Web Worker，不阻塞 UI。
3. **内置语言 worker 直连 Monaco**：通过 `@volar/monaco` / `monaco-editor/esm/vs/language/typescript` 直接对接，不经 Rust 中转。
4. **外部 LSP 走 Rust 中转**：XML/YAML 的 JSON-RPC 由 Rust `LspRouter` 转 Tauri channel 给 Renderer。
5. **Git 走 Rust git2**：除 interactive rebase 回退 `git` CLI 外，统一用 libgit2 绑定。

---

## 2 仓库结构与版本锁定（最终版）

### 2.1 仓库目录结构

```
miro-code/
├── src-tauri/                      # Rust Core + Tauri 配置
│   ├── src/
│   │   ├── main.rs                 # Tauri 入口、命令注册
│   │   ├── fs/                     # 文件系统命令（读/写/树/重命名/删除）
│   │   │   ├── mod.rs
│   │   │   ├── tree.rs             # walkdir 惰性目录树
│   │   │   └── guard.rs            # 路径越权防护
│   │   ├── git/                    # git2 封装
│   │   │   ├── mod.rs
│   │   │   ├── repository.rs
│   │   │   ├── status.rs
│   │   │   ├── branch.rs
│   │   │   ├── remote.rs           # fetch/push + auth 回调
│   │   │   └── merge.rs            # in-memory merge + 冲突 hunk
│   │   ├── lsp/                    # 外部 LSP 子进程托管
│   │   │   ├── mod.rs
│   │   │   ├── router.rs           # serverId ↔ languageId 映射
│   │   │   └── process.rs          # spawn / stdin/stdout / 重启
│   │   ├── index/                  # tantivy 全文索引
│   │   │   ├── mod.rs
│   │   │   ├── watcher.rs          # 文件变更增量更新
│   │   │   └── query.rs
│   │   └── settings.rs             # ~/.mirocode/settings.json 读写
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── sidecars/                   # LSP sidecar 二进制（构建期注入）
│       ├── lemminx/
│       └── yaml-language-server/
├── src/                            # Vue3 Renderer
│   ├── App.vue
│   ├── main.ts                     # 应用入口、插件挂载
│   ├── stores/                     # Pinia
│   │   ├── workspace.ts            # 当前打开的项目根
│   │   ├── files.ts                # 文件树 + 打开文件 Model
│   │   ├── git.ts                  # Git 状态
│   │   ├── ui.ts                   # 布局、面板显隐、主题
│   │   └── settings.ts             # 用户偏好
│   ├── components/                 # UI 组件
│   │   ├── shell/                  # ActivityBar、SideBar、EditorArea、StatusBar、TitleBar
│   │   ├── explorer/               # 资源管理器树
│   │   ├── search/                 # 全局搜索 + 文件查找
│   │   ├── git/                    # Git 面板 + 三栏合并器
│   │   ├── editor/                 # Monaco 封装 + Diff Viewer
│   │   └──command-palette/         # 命令面板
│   ├── editor/                     # Monaco 集成
│   │   ├── monaco-bootstrap.ts     # Worker URL 重定向、ESM 加载
│   │   ├── themes.ts               # miro-dark / miro-light 定义
│   │   ├── languages.ts            # 语言 ID 注册表
│   │   └── workers/                # 内置语言 worker 入口
│   │       ├── ts.worker.ts        # 接 tsserver in-worker
│   │       ├── vue.worker.ts       # 接 @volar/monaco
│   │       ├── json.worker.ts      # vscode-json-languageservice
│   │       ├── css.worker.ts
│   │       ├── html.worker.ts
│   │       └── tailwind.worker.ts  # @tailwindcss/language-server
│   ├── lsp/                        # 外部 LSP 客户端封装
│   │   └── sidecar-client.ts       # 经 Tauri channel 收发 JSON-RPC
│   ├── theme/                      # 主题 token
│   │   ├── tokens.dark.scss
│   │   ├── tokens.light.scss
│   │   └── index.ts                # 切换逻辑
│   └── utils/
├── public/
├── e2e/                            # Playwright E2E
├── tests/                          # Vitest 单元/集成
├── fixtures/                       # 样本项目 + git 冲突 fixtures
│   ├── sample-projects/
│   │   ├── ts-vue-medium/
│   │   └── ts-vue-large/
│   └── git-conflict-fixtures/
├── docs/
│   ├── Miro Code 技术方案文档.md   # 本文档
│   ├── Miro Code代码编辑器需求文档.md
│   └── perf-baseline/              # 性能基线归档
├── package.json
├── vite.config.ts
├── tsconfig.json
└── pnpm-lock.yaml
```

### 2.2 版本锁定矩阵（施工唯一口径）

**Renderer 侧（package.json）**

| 依赖 | 版本 | 用途 |
|---|---|---|
| `vue` | `3.5.x` | Renderer 框架 |
| `pinia` | `2.2.x` | 状态管理 |
| `@tauri-apps/api` | `2.x` | Tauri Renderer SDK |
| `monaco-editor` | `0.52.x` | 编辑器内核 |
| `@volar/monaco` | `2.4.x` | Vue 语言服务 Monaco 桥 |
| `@vue/language-core` | `2.4.x` | Vue 语言核心（**与下两包精确同 minor.patch**） |
| `@vue/language-service` | `2.4.x` | Vue 语言服务 |
| `@vue/typescript-plugin` | `2.4.x` | Vue TS 插件 |
| `vscode-json-languageservice` | `5.4.x` | JSON 语言服务（in-worker） |
| `vscode-css-languageservice` | `6.3.x` | CSS 语言服务（in-worker） |
| `vscode-html-languageservice` | `5.3.x` | HTML 语言服务（in-worker） |
| `@tailwindcss/language-server` | `0.10.x` | Tailwind 语言服务（in-worker） |
| `@typefox/monaco-languageclient` | `9.x`（仅外部 LSP 用） | LSP 客户端桥 |
| `flexsearch` | `0.7.x` | 文件查找增量 fuzzy |

**Rust 侧（Cargo.toml）**

| 依赖 | 版本 | 用途 |
|---|---|---|
| `tauri` | `2.x` | 桌面壳 |
| `git2` | `0.19.x` | libgit2 绑定，Git 主路径 |
| `tokio` | `1.x` | 异步 runtime |
| `tower-lsp` | `0.20.x` | LSP server 端类型（仅类型复用） |
| `tantivy` | `0.22.x` | 全文索引 |
| `walkdir` | `2.x` | 目录树遍历 |
| `serde` / `serde_json` | `1.x` | IPC 序列化 |

**构建工具链**

| 工具 | 版本 |
|---|---|
| Node.js | ≥20.10 |
| pnpm | ≥9 |
| Vite | `6.x` |
| Rust toolchain | `1.78+` stable |
| Tauri CLI | `2.x` |

### 2.3 Vite 关键配置

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  // 关键 1：排除 Monaco，防止 Vite 预打包产生第二份 worker bootstrap
  optimizeDeps: {
    exclude: [
      'monaco-editor',
      '@volar/monaco',
      '@vue/language-service',
      '@vue/typescript-plugin',
    ],
  },
  // 关键 2：worker 必须 es 格式，Volar/TS 依赖图不兼容 iife
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          'monaco-core': ['monaco-editor/esm/vs/editor/editor.api'],
          'monaco-lang': [
            'monaco-editor/esm/vs/language/typescript/monaco.contribution',
            'monaco-editor/esm/vs/language/json/monaco.contribution',
            'monaco-editor/esm/vs/language/css/monaco.contribution',
            'monaco-editor/esm/vs/language/html/monaco.contribution',
          ],
          'vue-lang': ['@volar/monaco', '@vue/language-service'],
        },
      },
    },
  },
});
```

### 2.4 Tauri 配置要点

```jsonc
// src-tauri/tauri.conf.json 关键片段
{
  "productName": "Miro Code",
  "version": "0.1.0",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [{
      "title": "Miro Code",
      "decorations": false,        // 自绘标题栏
      "transparent": true,         // 玻璃质感（仅 macOS/Win；Linux 关闭）
      "width": 1280, "height": 800,
      "minWidth": 800, "minHeight": 500
    }],
    "security": {
      "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:",
      "dangerousDisableAssetCspModification": false
    }
  },
  "bundle": {
    "active": true,
    "targets": ["app", "dmg", "msi", "appimage", "deb"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.icns"]
  }
}
```

---

## 3 编辑器内核：Monaco Editor

### 3.1 选型结论

**采用 Monaco Editor 0.52**（VSCode 同源内核），理由：

| 维度 | Monaco | CodeMirror 6 | 自研 |
|---|---|---|---|
| 与"对标 VSCode"契合度 | 🟢 同源，行为一致 | 🟡 需调参 | 🔴 不现实 |
| 高亮/补全/折叠/跳转开箱 | 🟢 内置 | 🟡 需插件 | 🔴 — |
| 与 LSP 桥接生态 | 🟢 `@volar/monaco`、`monaco-languageclient` | 🟡 需自写 | 🔴 — |
| 体积 | 🟡 ~3–5 MB | 🟢 ~200 KB | 🔴 不可估 |
| 性能（千级文件） | 🟢 行级虚拟化 | 🟢 行级虚拟化 | 🔴 需自研 |

"轻量化"目标接受 Monaco 体积，换取开箱即用的语言能力与 VSCode 行为一致性。**不再考虑 CodeMirror 或自研内核。**

### 3.2 Monaco 在 Tauri 中的集成要点

1. **Worker 加载**：Monaco 的语言 Worker 默认用 `worker.getUrl`，在 Tauri WebView 内需重定向到 Vite 打包后的 Worker bundle（`?worker` 入口）。
2. **ESM 直加载**：使用 Monaco ESM 版 `import * as monaco from 'monaco-editor'`，禁用 AMD loader；Vite `optimizeDeps.exclude` 防止预打包产生第二份 worker bootstrap。
3. **环境 shim**：Monaco 部分能力依赖 `vscode` 命名空间，引入 `@typefox/monaco-vscode-api` 或最小 shim 提供 `commands`、`languages`、`window` 服务。
4. **多 Model 管理**：每个打开文件对应一个 `monaco.editor.ITextModel`，按 tab 生命周期创建/释放，避免内存堆积；Model 持久化由 Renderer Pinia store 管理。

### 3.3 Monaco 能力与需求映射

| 需求五大能力 | Monaco 原生支持 | 接入方式 |
|---|---|---|
| 语法高亮 | TextMate grammars + 主题 | 引入 `monaco-textmate`，注入 `.tmlanguage` JSON |
| 代码折叠 | `FoldingProvider` | 内置，按语言注册 |
| 语法校验 | `markers` + `setModelMarkers` | 由 LSP diagnostics 驱动 |
| 代码补全 | `CompletionItemProvider` | 由 LSP / 语言 Worker 驱动 |
| 引用跳转 | `DefinitionProvider` / `ReferenceProvider` | 由 LSP 驱动 |

---

## 4 语言服务方案（最终版：内置为主）

### 4.1 设计原则：内置优先

v1.0 调研结论明确：业界唯一成熟的 Vue 语言能力方案是 Volar，且 Volar 官方提供 `@volar/monaco` 桥接包；TS 完整能力需 tsserver，Monaco 内置 TS Worker 仅适合单文件基础补全。

**v2.0 落地决策**：把"常用语言服务"全部内置到 WebView 的 Web Worker 中，**与 Monaco 直接对接，不经 Rust 中转、不启外部进程**。这带来三个好处：

1. **零外部进程**：常用语言不需要 spawn 子进程，启动更快、内存更低、跨平台打包更简单。
2. **开箱即用**：用户安装即可获得 TS/Vue/JSON/CSS/HTML/Tailwind 全套语言能力，无需联网下载 LSP server。
3. **与 Monaco 同生命周期**：语言 worker 与 Monaco editor 同进程内调度，崩溃恢复与资源回收由 WebView 统一管理。

### 4.2 内置语言服务清单

下列语言服务**全部内置**，作为 Web Worker 随包分发：

| 语言 | 内置实现 | 包来源 | 运行位置 |
|---|---|---|---|
| TypeScript / JavaScript | tsserver in-worker | `monaco-editor/esm/vs/language/typescript`（含 ts.worker） | TS Worker |
| Vue（SFC） | Volar language service | `@volar/monaco` + `@vue/language-service` + `@vue/typescript-plugin` | Vue Worker |
| JSON | JSON language service | `vscode-json-languageservice`（in-worker） | JSON Worker |
| CSS | CSS language service | `vscode-css-languageservice`（in-worker） | CSS Worker |
| HTML | HTML language service | `vscode-html-languageservice`（in-worker） | HTML Worker |
| Tailwind CSS | Tailwind language server | `@tailwindcss/language-server`（in-worker） | Tailwind Worker |

**Env / Markdown / Sass** 不启 worker，走 Monaco 内置高亮 + 自研轻校验：

| 语言 | 方案 | 运行位置 |
|---|---|---|
| Env | 自研键值高亮 + 重复键检测（百行级解析器） | Renderer 主线程 |
| Markdown | Monaco 内置 markdown 高亮 + 自研标题折叠 | Renderer 主线程 |
| Sass | Monaco TextMate grammar + 轻校验 | Renderer 主线程 |

### 4.3 长尾语言走外部 LSP sidecar

XML / YAML 在需求矩阵中属于"配置类长尾"，且其 LSP server 体积较大（lemminx 约 8 MB，需 JVM），**不内置、按需启动**：

| 语言 | LSP Server | 启动时机 | 运行位置 |
|---|---|---|---|
| XML | `lemminx`（Eclipse Lemminx） | 首次打开 `.xml` 文件 | Rust 托管子进程 |
| YAML | `yaml-language-server`（redhat） | 首次打开 `.yaml` / `.yml` 文件 | Rust 托管子进程 |

启动流程：

1. Renderer 检测到打开文件的语言为 XML/YAML。
2. Renderer 经 Tauri `invoke` 请求 Rust 启动对应 sidecar。
3. Rust `LspRouter` spawn 子进程，建立 stdin/stdout JSON-RPC 通道。
4. Rust 把通道经 Tauri `event` 暴露给 Renderer，Renderer 用 `@typefox/monaco-languageclient` 接入 Monaco。
5. 项目关闭时 Rust 统一销毁所有 sidecar 子进程。

### 4.4 内置语言服务传输架构

```
┌───────────────────────┐  Worker postMessage  ┌──────────────────┐
│  Monaco Editor        │ ←──────────────────→ │  Language Worker │
│  (TS/Vue/JSON/CSS/    │                       │  (tsserver /     │
│   HTML/Tailwind)      │                       │   Volar / LS)   │
└───────────────────────┘                       └──────────────────┘
        │                                                 │
        └────────── 共享 ITextModel URI ─────────────────┘

外部 LSP（XML/YAML）：
┌─────────┐ Tauri IPC ┌──────────┐ stdin/stdout ┌──────────────┐
│ Monaco  │ (JSON-RPC)│ Rust Core│ (JSON-RPC)    │ LSP Sidecar  │
│ LSP     │ ←───────→ │ Router   │ ←───────────→ │ (lemminx等)  │
│ Client  │           └──────────┘               └──────────────┘
└─────────┘
```

### 4.5 TS 内置语言服务落地

直接复用 Monaco 自带的 TS 语言贡献，注入 tsserver in-worker：

```ts
// src/editor/workers/ts.worker.ts（精简示意）
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { worker as tsWorker } from 'monaco-editor/esm/vs/language/typescript/ts.worker';

// 注册 TS/JS 语言 ID 与 worker
monaco.languages.typescript.TypeScriptWorker = tsWorker;
monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
  target: monaco.languages.typescript.ScriptTarget.ESNext,
  module: monaco.languages.typescript.ModuleKind.ESNext,
  jsx: monaco.languages.typescript.JsxEmit.Preserve,
  allowNonTsExtensions: true,
});
```

要点：
- `setEagerModelSync(true)`：所有打开的 TS/JS model 同步到 worker，保证跨文件类型推导。
- `setCompilerOptions`：对齐 Vue 项目常见配置（ESNext + ESM + JSX Preserve）。
- 文件系统桥：用户工作区外的 `.d.ts`（如 `node_modules/@types`）经 Rust FS API 异步读取后注入 worker 的 `addExtraLib`。

### 4.6 Vue 内置语言服务落地（@volar/monaco）

Vue 是本项目语言能力的最大难点，固定走以下链路（参照 play.vuejs.org / pikacss 实践）：

1. **Worker 入口** `vue.worker.ts`：基于 `@volar/monaco/worker` 的 `createSimpleWorkerLanguageService`，注入 `@vue/language-core` + `@vue/language-service` + `@vue/typescript-plugin`。
2. **包版本锁定**：`@vue/language-core` / `-service` / `-typescript-plugin` 三包必须精确同 minor.patch，否则 `instanceof VueVirtualCode` 跨副本失败（已知坑）。
3. **TS Service Plugin 补丁**：3.x/2.x 版本 `createVueLanguageServicePlugins` 缺 TS semantic plugin，需手动组合并经 `postprocessLanguageService` 代理。
4. **Vite 配置**：见 §2.3，`optimizeDeps.exclude` + `worker.format: 'es'`。
5. **文件系统桥**：Volar 的 `FileSystem` 桥到 Rust Core FS API，让 Vue Server 看到真实 `node_modules`（跨文件组件 props 类型推导必需）。

### 4.7 五大能力 × 12 语言落地矩阵

| 语言 | 高亮 | 折叠 | 校验 | 补全 | 跳转 | 来源 | 内置? |
|---|---|---|---|---|---|---|---|
| Vue | TextMate | Monaco | Volar diagnostics | Volar | Volar | 内置 worker | ✅ |
| Tailwind | 自研 grammar | Monaco | TW LS diagnostics | TW LS | — | 内置 worker | ✅ |
| HTML | Monaco | Monaco | HTML LS | HTML LS | — | 内置 worker | ✅ |
| CSS | Monaco | Monaco | CSS LS | CSS LS | — | 内置 worker | ✅ |
| Sass | TextMate | Monaco | 轻校验 | Monaco | — | 内置+grammar | ✅ |
| JS | TextMate | Monaco | TS LS | TS LS | TS LS | 内置 worker | ✅ |
| TS | TextMate | Monaco | TS LS | TS LS | TS LS | 内置 worker | ✅ |
| JSON | Monaco | Monaco | JSON LS | JSON LS | JSON LS | 内置 worker | ✅ |
| Env | 自研 | — | 自研 | 自研 | — | 自研 | ✅（主线程） |
| Markdown | Monaco | Monaco | 自研 | 自研 | — | 内置+自研 | ✅（主线程） |
| XML | TextMate | Monaco | lemminx | lemminx | lemminx | 外部 LSP | ❌ 按需 |
| YAML | TextMate | Monaco | yaml LS | yaml LS | yaml LS | 外部 LSP | ❌ 按需 |

> 矩阵中"—"表示该能力该语言业界无成熟方案或需求未硬性要求，按 Phase 2 评估是否补齐。

---

## 5 Git 版本管理方案（对标 WebStorm）

### 5.1 实现路径选型

| 方案 | 描述 | 优点 | 缺点 | 采纳 |
|---|---|---|---|---|
| **Rust git2（libgit2 绑定）** | 纯 Rust 库，无外部依赖 | 集成度高、安全沙箱内可控、冲突可 in-memory 解析 | interactive rebase 等高级操作支持弱 | ✅ 主路径 |
| shell out `git` CLI | 调系统 git | 全功能 | 依赖用户机装 git、冲突交互难、跨平台行为差 | ⚠️ 回退路径 |
| isomorphic-git（纯 JS） | 前端实现 | 无依赖 | 与 Tauri Rust 优势相悖、慢 | ❌ 否 |

**决策**：**主路径 git2**，对 `interactive rebase`、`submodule` 等少数高级操作回退到 `git` CLI（Rust 内 spawn，结果回流；不暴露给 Renderer）。

### 5.2 WebStorm Git 能力对标清单

| WebStorm 能力 | Miro 落地方式 | 实现层 |
|---|---|---|
| 仓库初始化 / 关联远程 | `git2 Repository.init` + `Remote.create` | Rust |
| 文件状态可视化（新增/修改/删除/冲突/未跟踪） | `git2 statuses` + diff，分类图标 | Rust→Renderer |
| 单/批量暂存 | `git2 index_add`（按路径数组） | Rust |
| 编写备注 / 单独提交 / 批量提交 | `git2 commit`（指定 pathspec） | Rust |
| 分支：查看/新建/切换/合并/删除/重命名 | `git2 Branches` API | Rust |
| 拉取 / 推送 / 强制推送 | `git2 Remote.fetch/push` + auth 回调 | Rust |
| 可视化提交日志（人/时/备注/文件明细） | `git2 Revwalk` + diff per commit，Renderer 时间线视图 | Rust→Renderer |
| 回滚指定版本 | `git2 reset` (hard/mixed/soft) | Rust |
| 暂存 / 恢复暂存 | `git2 stash`（经 OID） | Rust |
| 重置工作区 / 撤销最近提交 | `git2 reset` + `commit_amend` | Rust |
| **三栏冲突合并器** | 见 §5.3 | Rust+Renderer |
| 回顾 merge 如何解决冲突 | 三栏 Diff Viewer 复用，记 merge commit 三 parent | Rust→Renderer |

### 5.3 三栏冲突合并器（核心组件，直接照搬 WebStorm）

```
┌────────────────────┬────────────────────┬────────────────────┐
│  Changes from      │  Result            │  Changes from      │
│  local ( yours )   │  (可编辑结果)       │  incoming ( theirs)│
│  ─ read only ─      │                    │  ─ read only ─     │
│  ▌冲突块 ▌          │  ▌冲突块▌           │  ▌冲突块 ▌          │
│  ✓ 应用此变更       │  实时合成结果        │  ✓ 应用此变更       │
│  ✗ 忽略此变更       │                    │  ✗ 忽略此变更       │
└────────────────────┴────────────────────┴────────────────────┘
   左：本分支改动            中：合并结果             右：对方分支改动
```

**关键交互（逐条对标 WebStorm）**：

1. **自动应用非冲突变更**：工具栏 "Apply All Non-Conflicting Changes"，一键合并所有非重叠 hunk；可在设置设为默认自动执行。
2. **按侧应用**：左/右栏每个 hunk 旁 ✓/✗ 按钮，逐 hunk 接受或丢弃。
3. **简单冲突一键解决**：仅增删行的冲突提供 "Resolve Simple Conflicts" 按钮。
4. **中央栏可编辑**：结果栏是完整 Monaco 实例，用户可手改最终内容。
5. **右键菜单**：冲突块右键 "Resolve using Left/Right" 快捷双侧取舍。
6. **撤销/重做**：Ctrl+Z / Ctrl+Shift+Z 撤回合并操作，冲突标记同步。
7. **gutter 变更工具栏**：hover 行 gutter 弹出变更框，可逐行撤回已应用的变更。
8. **三方对比模式**：回顾历史 merge commit 时，Diff Viewer 切三栏对照两个 parent。
9. **Revert conflict resolution**：冲突列表右键可还原某文件至冲突态。

**实现要点**：

- **冲突 hunk 解析**：用 `git2 merge_commits`（in-memory，不污染工作区）得到带冲突标记的 index，遍历 `git_index` 取 conflict entries；或回退到 `git merge-file --diff3` 拿三向文本。
- **Diff 算法**：三方 merge 用 `imara-diff`（Rust，三方 diff）或 `similar`（Rust，双向+三方），产出 hunk 序列给 Renderer。
- **中央栏 Monaco**：复用 §6 Diff Viewer 的 Monaco DiffEditor 思路，但改成"左只读 / 中可写 / 右只读"三 Monaco 实例并排，hunk 高亮由 overlay decorator 驱动。
- **Apply 流程**：用户完成取舍后，把中央栏文本写回工作区文件 → `git2 index_add` → 若仍有 `git_index_has_conflicts` 则提示未完成，否则 `commit` 收尾 merge。

### 5.4 Git UI 面板布局（WebStorm 风格）

```
左侧侧边栏 ─ Git Tab
┌───────────────────────────┐
│ ▼ Local Changes            │  ← 工作区变更列表（图标+文件名+状态徽章）
│     修改  src/main.rs       │
│     新增  docs/x.md         │
│ ▼ Staged Changes           │  ← 已暂存
│ ▼ Merge Conflicts (2)      │  ← 冲突节点，点 Resolve 调三栏合并器
│ ▼ Recent Commits           │  ← 提交日志时间线
└───────────────────────────┘
底部 ─ Commit 工具窗 (Alt+0)
┌───────────────────────────┐
│ 提交备注输入框              │
│ [Commit] [Commit & Push]   │
└───────────────────────────┘
右键菜单：复制路径、重命名、Show Diff（Ctrl+D）、Reset Current Change、Resolve
```

快捷键对齐 WebStorm：`Ctrl+Shift+K` 推送、`Ctrl+K` 拉取、`Alt+0` Commit 工具窗、`Alt+9` Git 工具窗、`Ctrl+D` Diff Viewer。

---

## 6 资源管理器 / 全局搜索 / Diff Viewer

### 6.1 资源管理器（对标 VSCode）

| 能力 | 实现 |
|---|---|
| 打开文件夹 / 项目树 | Rust `walkdir` 递归，惰性加载子目录；Renderer 虚拟滚动（10k+ 文件不卡） |
| 新建 / 重命名 / 删除 / 复制 / 移动 | Rust FS API，操作前校验冲突路径 |
| 文件状态图标 | Git status + 编辑态（已修改未存盘）双源 merge |
| 抛弃 / 展开 / 定位 | 树 store 维护 expanded set，编辑区文件自动 reveal |
| 忽略规则 | 读 `.gitignore` + 用户自定义 ignore（`node_modules`、`.git`、`dist` 等） |
| 关键词过滤 | 增量 fuzzy 匹配文件名 |
| 右键菜单 | 复制路径、重命名、Show in Explorer（OS）、Delete |

### 6.2 全局搜索与文件查找（对标 WebStorm）

**文件查找（Ctrl+N，WebStorm 风格）**：

- 增量 fuzzy 匹配全项目文件名（FlexSearch / 自建增量索引）
- 支持后缀过滤、排除目录、历史记录
- 结果实时刷新，匹配片段高亮

**全局内容搜索（Ctrl+Shift+F）**：

- Rust 侧全文索引：项目首次扫描后建增量倒排（文件路径→文本块 hash），写入侧用 tantivy 文件 watcher 增量更新
- 支持：精确 / fuzzy / 大小写切换 / 正则 / 排除目录 / 排除类型 / 批量替换（预览→确认）
- 结果预览：匹配行上下文 ±3 行，点击跳转打开文件并定位行列

**性能基线**：千级文件项目，搜索响应 ≤500ms（§8 性能预算）。

### 6.3 Diff Viewer（Ctrl+D，复用于 Git）

- 基于 Monaco `DiffEditor`，左基线 / 右当前，支持 inline / side-by-side 切换
- gutter 变更工具栏（hover 弹出，应用/撤回单行）
- 文件级 Diff（两版本）与三方 Diff（merge 回顾）共用同一组件，三方时切三栏合并器模式

---

## 7 UI 视觉体系（最终版：仅深浅双主题）

### 7.1 主题口径收敛

v1.0 留有 4 套主题（Dark / Midnight / Cyberpunk / Dawn）的设想。v2.0 **正式收敛为两套**：

| 主题名 | data-theme 值 | 性质 | 默认? |
|---|---|---|---|
| **Miro Dark** | `dark` | 深色，Adnify Dark 风格基底 | ✅ 默认 |
| **Miro Light** | `light` | 浅色，Adnify Dawn 风格基底 | — |

理由：
- 双主题足以覆盖"白天/夜晚"两种主流场景，多主题维护成本高、视觉一致性难保。
- 把精力集中在两套高质量 token 上，比做四套平庸主题更符合"高颜值"诉求。
- Midnight / Cyberpunk 等个性化主题留作 Phase 2 社区贡献方向，不进 v2.0 主线。

### 7.2 视觉语言（参照 Adnify）

Miro Code 参照 Adnify 视觉语言，在 Tauri + Vue3 上重塑：

| 元素 | Adnify 做法 | Miro 落地 |
|---|---|---|
| 窗框 | 无边框 + 自绘标题栏 | Tauri `decorations: false` + Vue 自绘 titlebar |
| 标签页 | Chrome 风圆角 | Vue3 `TabStrip` 组件，CSS recreate |
| 面包屑 | 路径段可点 | Monaco `breadcrumb` provider + Vue overlay |
| 玻璃质感 | backdrop-filter blur | WebView CSS `backdrop-filter`（Chromium 支持） |
| 主题 | 4 原生 | **2 原生（Dark 默认 / Light 浅色）** |

### 7.3 设计 Token（双主题对照）

色板极低饱和，以 Miro Dark 为基线，Miro Light 对应亮基底：

| Token | Miro Dark | Miro Light | 用途 |
|---|---|---|---|
| `bg.base` | `#0E0E11` | `#FBFBFD` | 窗体底色、编辑器背景 |
| `bg.surface` | `#15151A` | `#F2F2F5` | 面板/侧栏背景 |
| `bg.elevated` | `#1C1C23` | `#FFFFFF` | 悬浮弹窗、下拉、命令面板 |
| `bg.glass` | `rgba(28,28,35,0.72)` | `rgba(255,255,255,0.72)` | 玻璃面板底色（配 `backdrop-filter: blur(16px)`） |
| `border.subtle` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.08)` | 默认分隔线 |
| `border.glow` | `rgba(120,140,255,0.18)` | `rgba(120,140,255,0.32)` | 焦点态发光描边 |
| `fg.primary` | `#E6E6EC` | `#1A1A22` | 主要文本 |
| `fg.secondary` | `#9A9AA8` | `#5A5A66` | 次要文本、占位符 |
| `fg.disabled` | `#5A5A66` | `#B0B0BC` | 禁用态 |
| `accent.primary` | `#7C8CFF` | `#5C6CEF` | 主操作 / 选中高亮 |
| `accent.hover` | `#94A1FF` | `#7889F5` | hover 加深 |
| `git.added` | `#3FB950` | `#2EA043` | 新增 / 暂存态 |
| `git.modified` | `#D29922` | `#B08800` | 修改态 |
| `git.deleted` | `#F85149` | `#CF222E` | 删除态 |
| `git.conflict` | `#FF7B72` | `#BC4C00` | 冲突态 |

语法高亮 token（两套主题共用语义色，仅亮度微调）：

| Token | Dark | Light |
|---|---|---|
| `syntax.keyword` | `#FF7B72` | `#CF222E` |
| `syntax.string` | `#A5D6FF` | `#0A3069` |
| `syntax.comment` | `#8B949E` | `#6E7781` |
| `syntax.type` | `#FFA657` | `#953800` |
| `syntax.func` | `#D2A8FF` | `#8250DF` |

### 7.4 字体与排版

- **界面字体**：系统无衬线栈（`-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`），基准 13px / 1.5 行高，紧贴 Adnify 的"留白通透"。
- **代码字体**：默认推荐等宽栈 `"JetBrains Mono", "Fira Code", "SF Mono", Consolas, "Ligature Mono", monospace`，字号 13px / 行高 1.6，行号栏右对齐。
- **连字**：默认开启等宽字体连字（`font-feature-settings: "calt" 1`），可在设置中关闭。
- **字号适配**：跟随系统缩放比例（`-webkit-font-smoothing` + DPI 感知），跨平台保持视觉一致。
- **层级**：仅 4 级文字权重（标题 600 / 正文 400 / 次要 400 + secondary 色 / 禁用 400 + disabled 色），杜绝多余粗细变体。

### 7.5 主题切换与持久化

- 主题定义为 CSS 变量集合，挂在 `:root[data-theme="dark|light"]`，运行期切换零重渲染（仅变量替换）。
- Monaco 主题与 UI 主题解耦：`monaco.editor.defineTheme` 单独注册 `miro-dark` / `miro-light`，切换 UI 主题时同步 `monaco.editor.setTheme`。
- 用户偏好（主题、字号、是否连字、是否显示行号、tab 缩进）持久化到 `~/.mirocode/settings.json`，启动时回填。
- 跟随系统：可设为 `auto`，监听 `prefers-color-scheme` 媒体查询动态切换。

---

## 8 性能预算与基线

### 8.1 总体口径

性能目标以"相对 VSCode Electron 显著更轻"为口径，Tauri WebView 内核复用系统 Chromium 而非打包完整 Electron runtime，是体积与内存优势的根本来源。Monaco 内核体积（约 3–5 MB，gzip 后约 1 MB）已计入预算，**禁止再引入 Electron 级别的额外重量**（如内置 Node runtime、Electron helper 进程等）。

### 8.2 关键指标预算

| 指标 | 目标值 | 验证方法 |
|---|---|---|
| 冷启动到可交互 | ≤2s（M1）/ ≤1.5s（M3） | 首次启动计时（不含 LSP 预热） |
| 安装包体积 | ≤15 MB（无 LSP）/ ≤40 MB（含 2 个 LSP sidecar） | 打包后 `.dmg`/`.msi`/`.AppImage` 大小 |
| 空载内存（无项目打开） | ≤120 MB | `psutil` RSS |
| 千级文件项目稳态内存 | ≤450 MB | 同上，编辑器空闲 60s 后取值 |
| 单文件打开到首字符可输入 | ≤300 ms | 大文件（10k 行）场景 |
| 全局内容搜索响应（千级文件） | ≤500 ms | 首次搜索含建索引 |
| 二次全局搜索响应 | ≤80 ms | 索引命中 |
| 文件查找（Ctrl+N）响应 | ≤100 ms | 增量 fuzzy |
| LSP 首次补全延迟 | ≤1.5s | 含 tsserver 冷启 |
| Git 状态刷新（千级文件） | ≤400 ms | `git2 statuses` |
| 全屏主题切换 | ≤16 ms（一帧） | CSS 变量替换路径 |

### 8.3 内存预算拆解（千级文件稳态）

| 区段 | 预算 | 说明 |
|---|---|---|
| Rust Core | ≤80 MB | FS 缓存、git2 repo 对象、索引 mmap |
| Tauri runtime + WebView shell | ≤90 MB | 含 IPC channel 缓冲 |
| Monaco Editor 实例 | ≤120 MB | 每个 ITextModel 约 0.5–2 MB |
| Vue3 Renderer + Pinia store | ≤60 MB | 文件树虚拟滚动节点 |
| 内置 Language Workers | ≤60 MB | tsserver + Volar + JSON/CSS/HTML/Tailwind |
| 外部 LSP sidecar（XML/YAML 活跃） | ≤40 MB | 仅在打开对应文件时 |
| 余量 | ≤0 | 留给 diff 缓存 |

### 8.4 启动路径优化

1. **Rust 端懒加载**：git2 Repository 在用户首次 Git 操作时才 open；XML/YAML sidecar 在首次打开对应文件时才 spawn。
2. **Renderer 端代码分割**：Monaco 按 `editor.api` + `editor.all` 拆 chunk，首屏只加载 `editor.api`，Diff/Merge 视图懒加载。
3. **内置 worker 预热**：启动后立即预热 TS/Vue language worker 的空 `initialize`，掩盖后续真实加载延迟。
4. **Tailwind worker 延迟激活**：Tailwind worker 仅在打开含 Tailwind 配置的项目时才加载 content config。

### 8.5 性能回归门禁

CI 流水线内置性能门禁（基于真实样本项目）：

- 启动时长 >3s → 阻断合并
- 千级文件稳态内存 >600 MB → 阻断合并
- 全局搜索响应 >1s → 警告

性能基线数据随每个里程碑归档至 `docs/perf-baseline/`，用于纵向对比。

---

## 9 构建与跨平台打包

### 9.1 跨平台打包矩阵

| 平台 | 目标三元组 | 产物 | 备注 |
|---|---|---|---|
| macOS (Intel) | `x86_64-apple-darwin` | `.dmg` / `.app` |  |
| macOS (Apple Silicon) | `aarch64-apple-darwin` | `.dmg` / `.app` | 主推 |
| Windows | `x86_64-pc-windows-msvc` | `.msi` / `.exe` | WebView2 runtime 依赖 |
| Linux | `x86_64-unknown-linux-gnu` | `.AppImage` / `.deb` | WebKitGTK 依赖 |

打包 CI 使用 GitHub Actions 矩阵，每个平台独立 runner，避免交叉编译带来的 WebKit/WebView2 链接问题。

### 9.2 LSP Sidecar 分发策略（仅 XML/YAML）

仅 XML / YAML 两个长尾语言 server 走 sidecar，分发二选一：

| 策略 | 优点 | 缺点 | 采纳 |
|---|---|---|---|
| 随包捆绑（Tauri sidecar） | 开箱即用，零网络依赖 | 安装包体积 +10–15 MB | ✅ M3 默认 |
| 首次启动下载 | 包小 | 需联网、版本不可控 | ⚠️ 备选 |

**内置语言服务（TS/Vue/JSON/CSS/HTML/Tailwind）不走 sidecar**，直接随前端 bundle 进 WebView，体积已计入 §8.2 包体积预算。

### 9.3 构建产物验收清单

每个里程碑构建产物须满足：

- [ ] 三平台产物均生成
- [ ] macOS 产物完成 notarization
- [ ] Windows 产物完成 EV 代码签名
- [ ] 启动时长、稳态内存、包体积三项通过性能门禁
- [ ] 内置冒烟测试套件全绿（见 §10）

---

## 10 安全与权限边界

### 10.1 Renderer 沙箱原则

1. **Renderer 不直接接触文件系统**：所有文件读写经 Tauri `invoke` 走 Rust Core，Rust 侧校验路径在允许的工作区内。
2. **禁用 Node 集成**：Tauri 默认 WebView 无 Node，需保证不引入任何 `require('fs')` 等逃逸路径。
3. **CSP 严格**：`default-src 'self'`，仅允许 worker blob 与 data URI 图片，禁止外部脚本。

### 10.2 路径越权防护

Rust FS API 对每次调用做以下校验：

1. **规范化路径**：`Path::canonicalize` 解析符号链接与 `..`。
2. **工作区白名单**：路径必须以当前打开项目根目录为前缀；跨项目操作需用户显式授权。
3. **敏感目录黑名单**：`~/.ssh`、`~/.aws`、`/etc`、`C:\Windows\System32` 等直接拒绝读写。
4. **写入审计**：所有写/删操作入审计日志（`~/.mirocode/logs/audit-YYYYMMDD.log`），便于事后追溯。

### 10.3 Git 凭据安全

- **不持久化凭据**：`git2` 的 `RemoteCallbacks` 仅在会话内持有凭据，关闭项目即清。
- **凭据回调委托**：拉取/推送需要凭据时，经 Rust → IPC → Renderer 弹出输入框，**禁止把密码回传到 Renderer 之外**。
- **SSH key**：默认读 `~/.ssh/id_*`，仅在用户勾选"允许 SSH 凭据访问"后启用。
- **强制推送二次确认**：`--force` 操作在 Renderer 弹出确认框，避免误覆盖远端。

### 10.4 LSP 子进程隔离（仅外部 sidecar）

- XML / YAML LSP server 子进程以**最小权限**运行，工作目录锁定为项目根，无写权限（仅读 + 临时目录）。
- 子进程通信内容（含源代码）仅在 Rust ↔ 子进程之间流转，不外泄到日志；调试日志需用户显式开启。
- 子进程崩溃自动重启（最多 3 次/分钟），超过阈值则降级为"仅高亮 + 折叠"模式并提示用户。

**内置语言 worker 的隔离**：运行在 WebView Web Worker 沙箱内，无文件系统访问权限，所需文件经 Rust FS API 显式拉取注入。这是内置路线相对外部 LSP 的额外安全收益。

### 10.5 外部依赖供应链

- 内置语言服务包（Volar、tsserver、vscode-*-languageservice、@tailwindcss/language-server）从 npm 拉取，**版本锁文件提交仓库**。
- 外部 sidecar（lemminx、yaml-language-server）从官方 release 拉取，SHA256 校验后入库。
- CI 启用 `pnpm audit` / `cargo audit`，高危漏洞阻断合并。
- 升级语言服务主版本时强制回归测试（§10.2 LSP 回归套件）。

---

## 11 测试策略

### 11.1 测试金字塔

```
        ┌─────────┐
        │  E2E    │  ~20 个关键路径（启动、打开项目、Git 提交流、冲突解决）
        ├─────────┤
        │ 集成测试 │  ~80 个（LSP 协议往返、git2 操作链、Monaco+Volar 集成）
        ├─────────┤
        │ 单元测试 │  ~600 个（解析器、token 匹配、命令分发、store reducer）
        └─────────┘
```

### 11.2 单元与集成测试

| 层 | 工具 | 重点 |
|---|---|---|
| Rust 单元 | `cargo test` | FS 路径校验、git2 封装、索引增量 |
| Rust 集成 | `cargo test` + 临时 git repo | Git 操作端到端、外部 LSP 路由 |
| Renderer 单元 | Vitest | Pinia store reducer、命令分发、path utils |
| Renderer 集成 | Vitest + @vue/test-utils | TabStrip、Explorer 树操作、命令面板 |
| Monaco 集成 | Vitest + happy-dom | Diff Viewer hunk 解析、Volar worker 通信 |
| LSP 回归 | 自写 mock server + 录制 fixture | TS/Vue/JSON/CSS/HTML/Tailwind/XML/YAML 各 5+ 用例 |

### 11.3 E2E 测试

使用 Tauri 官方 [`tauri-driver`](https://docs.rs/tauri-driver) + WebDriverIO，覆盖关键路径：

1. 启动 → 打开文件夹 → 文件树展开 → 编辑器加载
2. 编辑文件 → Git 状态实时更新 → 提交 → 推送
3. 制造合并冲突 → 打开三栏合并器 → 应用左右变更 → 完成合并
4. 全局搜索 → 结果预览 → 跳转定位
5. 主题切换（Dark ↔ Light）→ Monaco 同步 → 持久化重启验证
6. 卸载/重新安装 → 用户配置回填

E2E 套件在三平台 CI 各跑一次，单次执行 ≤10 分钟。

### 11.4 性能与回归门禁

- **性能门禁**：CI 跑 §8.5 三项门禁，未过则阻断合并。
- **快照测试**：Monaco 高亮输出、Diff Viewer hunk 列表、Git 状态图标组合使用 Vitest snapshot，**任一快照失败即视为回归**。
- **视觉回归**：关键界面（资源管理器、Git 面板、三栏合并器）使用 Playwright 截图对比，阈值 ≤2% 像素差异；**双主题各跑一遍**。

### 11.5 测试数据与样本项目

仓库内置 `fixtures/`：

- `sample-projects/ts-vue-medium/`：约 800 文件的 Vue3 + TS 项目，用于稳态内存与搜索基线
- `sample-projects/ts-vue-large/`：约 3000 文件，用于性能上限验证
- `git-conflict-fixtures/`：含 6 种典型冲突形态的 git 仓库，专测三栏合并器

样本项目随仓库版本演进，每次里程碑冻结一份快照用于纵向对比。

---

## 12 项目里程碑与交付节奏

### 12.1 里程碑总览

| 里程碑 | 周期 | 交付目标 | 验收门禁 |
|---|---|---|---|
| **M1 骨架可跑** | W1–W3 | Tauri 2 + Vue 3.5 工程骨架、Monaco 0.52 接入、文件树可打开、双主题壳 | 启动 ≤2s、打开文件夹可浏览、空载内存达标、Dark/Light 切换一帧 |
| **M2 内置语言服务就绪** | W4–W7 | 6 个内置语言 worker 全部接入、五大能力 × 12 语言矩阵跑通 | §4.7 矩阵逐格验收、TS/Vue/JSON/CSS/HTML/Tailwind 补全/校验/跳转 E2E 通过 |
| **M3 Git 全功能** | W8–W11 | git2 全套封装、Git UI 面板、三栏冲突合并器 | WebStorm 对标清单逐条验收、冲突解决 E2E 通过 |
| **M4 长尾 LSP + 性能调优** | W12–W13 | XML/YAML sidecar 接入、性能门禁全绿、用户设置持久化 | §8.5 三项门禁达标、settings.json 回填验证 |
| **M5 跨平台打包与发布** | W14–W16 | 三平台产物、签名公证、E2E 全绿、文档定稿 | §9.3 验收清单全过、E2E 全绿 |

### 12.2 关键路径与依赖

```
M1 骨架 ─┬─▶ M2 内置语言服务 ─▶ M4 长尾 LSP + 性能调优
         │
         └─▶ M3 Git 全功能 ──▶ M4
                                └─▶ M5 跨平台打包
```

- **M2/M3 可并行**：内置语言服务与 Git 模块在 M1 之后可分两队并行推进。
- **M4 强依赖 M2/M3**：长尾 LSP 与性能调优需要内置语言服务与 Git 全功能打底。
- **M5 不可压缩**：跨平台签名公证、性能调优均需 M4 完成后才能进入。

### 12.3 风险预留

- 每个里程碑预留 20% 缓冲（按周计），用于消化 §13 风险清单中的高概率项。
- M5 内置 1 周"only critical bug"冻结期，不允许引入新功能。

---

## 13 风险清单与缓解

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | Volar 三包版本漂移导致 `instanceof VueVirtualCode` 失败 | 高 | 高 | 锁 minor.patch、CI 跑 Vue 单测、升 minor 强制回归 |
| R2 | Monaco AMD loader 在 Tauri WebView 内崩溃 | 中 | 高 | 用 ESM 版、`optimizeDeps.exclude`、Worker URL 重定向 |
| R3 | tsserver in-worker 冷启动慢导致首补全延迟 >2s | 中 | 中 | Worker 预热、启动期空 initialize、首次打开显示"语言服务加载中" |
| R4 | git2 在 interactive rebase 场景能力不足 | 高 | 中 | 该场景回退 `git` CLI，结果回流 Rust |
| R5 | macOS notarization 卡发布 | 中 | 高 | M5 第 1 周提前跑通公证流程、缓存开发者证书 |
| R6 | WebView2 在 Windows 旧版本缺失 | 中 | 高 | 安装包内联 WebView2 bootstrapper、首次启动检测提示安装 |
| R7 | Tauri 2.x API 变更破坏集成 | 低 | 高 | 锁定 Tauri patch 版本、订阅 release notes |
| R8 | 全文索引在超大项目（10k+ 文件）建索引超时 | 中 | 中 | 索引构建异步后台 + 进度条、超时降级为正则扫描 |
| R9 | 三栏合并器交互复杂导致 M3 滑期 | 中 | 高 | M3 拆"非冲突 hunk 自动应用"与"逐 hunk 应用"两阶段，前者优先 |
| R10 | Adnify 视觉参照源变更导致风格漂移 | 低 | 低 | 视觉 Token 独立维护，不依赖参照源运行期 |
| R11 | 内置 Tailwind worker 与项目 Tailwind 配置版本不匹配 | 中 | 中 | 启动时探测 `tailwind.config`、版本不兼容时降级为仅高亮 |

---

## 14 术语表与参考

### 14.1 术语表

| 术语 | 释义 |
|---|---|
| **Adnify** | 基于 Electron + React + Monaco 的下一代 AI 编辑器，本项目的视觉参照源 |
| **LSP** | Language Server Protocol，语言能力以独立 Server 进程提供的标准协议 |
| **Volar** | Vue 官方语言服务实现（`@vue/language-service`），含 Monaco 桥 `@volar/monaco` |
| **tsserver** | TypeScript 官方语言服务进程，本项目以 in-worker 方式内置 |
| **git2** | libgit2 的 Rust 绑定 crate，本项目 Git 主路径 |
| **sidecar** | Tauri 概念，随主进程打包的辅助子进程（用于托管 XML/YAML LSP server） |
| **三栏合并器** | 左本分支 / 中结果 / 右对方分支 的冲突解决 UI，照搬 WebStorm |
| **五大能力** | 高亮、折叠、校验、补全、跳转，本项目所有语言统一对齐的能力集 |
| **内置语言服务** | 以 Web Worker 形式随包分发、不经外部子进程的语言服务，本项目 Miro Code v2.0 的核心架构选择 |

### 14.2 参考文档与源

| 类型 | 来源 |
|---|---|
| VSCode 布局/键位 | https://code.visualstudio.com/docs |
| WebStorm Git 能力 | https://www.jetbrains.com/help/webstorm/git.html |
| Adnify 视觉参照 | https://github.com/ad-naan/adnify |
| Monaco Editor | https://microsoft.github.io/monaco-editor/ |
| Tauri 2.x 文档 | https://tauri.app/ |
| Volar（Vue LS） | https://github.com/vuejs/language-tools |
| TypeFox monaco-languageclient | https://github.com/TypeFox/monaco-languageclient |
| libgit2 / git2-rs | https://github.com/libgit2/git2-rs |
| tantivy（全文索引） | https://github.com/quickwit-oss/tantivy |
| Tailwind CSS Language Server | https://github.com/tailwindlabs/tailwindcss-intellisense |
| Eclipse Lemminx（XML LS） | https://github.com/eclipse/lemminx |
| Red Hat YAML Language Server | https://github.com/redhat-developer/yaml-language-server |

### 14.3 文档变更纪要

| 版本 | 日期 | 变更摘要 |
|---|---|---|
| v1.0 | 2026-07-24 | 初版定稿：架构、内核、LSP、Git、UI、性能、构建、安全、测试、里程碑、风险 |
| v2.0 | 2026-07-24 | 落地定稿：明确 Tauri 2 + Vue 3.5 + Monaco 0.52 + Vite 6 版本矩阵；定仓库目录结构与模块边界；常用语言服务（TS/Vue/JSON/CSS/HTML/Tailwind）改为内置 worker，长尾（XML/YAML）走 sidecar；皮肤收敛为 Miro Dark / Miro Light 双主题；补 §2.1 仓库结构、§2.2 版本锁定、§2.3 Vite 配置、§2.4 Tauri 配置 |

---

> 本文档为 Miro Code 唯一技术依据，所有实现决策以本文为准；如需变更，须走"提案 → 评审 → 版本递增"流程，并在 §14.3 留痕。
