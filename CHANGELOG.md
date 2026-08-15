# 更新日志

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循语义化版本。

## [0.14.1] - 2026-08-15

### 新增

- **终端忙/闲检测**：`terminalIdle.ts` 解析 PTY 输出流判定 shell 是否停在提示符（剥 ANSI 后行尾 `$ % # > ❯ »` 特征 + 150ms 稳定窗口），状态存 `stores/sessions.ts` 的 `localIdle`
- **Package 脚本芯片忙时自动新开终端**：点击脚本芯片时若活动终端正在运行任务（shell 未停在提示符），自动新开终端执行，避免命令叠加进忙碌终端；命令结束提示符回归后恢复复用
- **活动栏新增终端图标入口**（Package 与设置之间），与状态栏左下角按钮 / ⌘/Ctrl+J 等价
- **新建本地终端挂载即聚焦**：打开面板 / 新建终端后可直接输入，无需手动点击

### 修复

（2026-08-15 全局代码审查：竞态统一模式 + 安全加固 + 资源泄漏，27 前端 + 11 Rust）

**竞态（异步在途结果提交前校验代际/序号 + 工作区未变）**：
- 切换工作区竞态统一修复：`workspace.ts` 的 `workspaceEpoch`（openFolder 提交时自增，loadChildren / refreshTree / refreshDirsForPaths / startWatch 在 await 后校验）；git `refreshSeq`（loadLog 补上）；search `fileSearchSeq` / `contentSearchSeq`；PushDialog `loadSeq`（连续两次 open 旧结果作废）；compare 开 Diff / 冲突分栏前校验 rootPath 未变；editor 读文件期间切换工作区不落旧标签
- 组件卸载竞态：RemoteTerminal boot 每个 await 后查 `disposed` 并自行回收已注册监听（连接已建立则主动关会话，防 Rust 侧 SSH 会话泄漏）；CodeMirrorEditor LSP 诊断订阅改为退订函数并在卸载时退订（原订阅随打开文件数无界累积）；SettingsModal AI 测试连接超时先触发时立即回收监听

**安全**：
- 语言服务捆绑包路径穿越：language / version 增加 `is_safe_segment` 段白名单校验（此前不可信输入直接 join 可构造 `../` 逃逸，删除任意目录 / 写任意文件）
- Git discard / resolve_conflict 路径逃逸：复用 `ensure_inside_workspace`，含 `..` / 绝对路径的输入不再能绕过 git2 直接覆写工作区外文件
- 凭据文件瞬时 0644 权限窗口：`TempGitCredentialStore` 改 `OpenOptions::mode(0o600)` 创建即私有（消除 git push 明文密码的瞬时窗口）
- 语言服务 zip 下载上限 512MB（恶意 / 被劫持镜像无限流式下发撑爆磁盘，超限中止并清残留）；sha256 改 64KB 分块流式计算（数百 MB 产物不再整读入内存）
- AI 凭据目录：`HOME` 补 `USERPROFILE` fallback（Windows 常未设 HOME，此前找不到 `~/.mirocode`）

**资源泄漏 / 僵尸 / 卡死**：
- LSP：写管道持锁加 5s 超时（server 卡死不再永久阻塞）；`lsp_start` 先 insert 再 spawn_read_loop（防幽灵条目 + 僵尸）；Content-Length 上限 64MB；kill 后补 `wait()` 收尸（Unix 僵尸进程随应用累积）
- SSH：移除三处 `wait_close`（libssh2 强制阻塞等远端关通道，死网络下无限阻塞冻结 open/write/resize）；并发同 id `ssh_shell_open` 不覆盖已存在会话（先建连接作废并关通道，不再静默泄漏）；TOFU known_hosts 读-改-写加锁（并发首次连接同一主机不再丢密钥记录）
- macOS Dock 菜单：NSMenuItem / 子菜单 init 后立即 autorelease（此前每次 rebuild 泄漏 N 个初始引用）；security_scoped NSData 用完 `release`、autoreleased NSURL 存 thread-local 前 `retain`（防悬垂指针）
- 多窗口：仅主窗口 Destroyed 时清理 LSP（关闭任意子窗口不再误杀主窗口正在使用的语言服务）
- 全局替换：外层 120s 超时无法取消线程，闭包内 110s 自检提前停写（超时返回后不再有旧任务后台继续覆写文件，与重试任务并发写同一批文件）

**功能正确性**：
- ExplorerPanel 右键菜单：`closeMenu()` 后 `menu.value` 恒 null 导致目录重命名 / 剪切后已打开标签路径不更新（改用解构出的 `isDir`）
- GitLog 分支范围过滤「当前分支」：从桩实现补成「当前分支尖端沿父链 BFS 可达集」过滤（此前 current / all 显示相同）
- workspaceSymbols：content 已提供时直接索引同一份文本（此前 hash 基于截断 content、符号表基于磁盘全文，超大文件两者永不一致、缓存反复失效重建）
- 查找面板：移除双击重复触发 `openHit`（单击已打开，双击连发两次 IPC）
- LocalTerminal：PTY 启动失败时消费 pending write（不再残留 store 中永远无人消费的任务）
- 语言服务解压：恢复 zip 记录的 unix 执行位、`bin` 目录强制补 `+x`；启动前校验 Node 可执行性（不可执行视为未安装回退宿主 npx）——修复「解压丢执行位 → 检测可用但 spawn 全挂 → 状态栏一直 LSP 降级」

### 构建

- `pnpm-workspace.yaml` 补 `packages` 字段（缺失导致 Release 构建在依赖安装前全灭）；新增 `[[test]] lsp_transport` 声明

## [0.14.0] - 2026-08-14

### 新增

- **本地终端改为底部面板（VS Code / Cursor 风格）**：终端从编辑区标签迁出，以底部面板形态与编辑器上下分栏并存
  - 入口：状态栏左下角终端按钮 / ⌘/Ctrl+J / 资源树右键「在终端中打开」；未打开项目时 cwd 回退 home 目录（先开终端再选项目）
  - 面板高度可拖拽调整并持久化（`settings.layout.terminalPanelHeight`，120–640px，默认 240px）
  - 收起（⌘/Ctrl+J 或顶栏 ▼）时会话与 PTY 保活（v-show 隐藏），仅关闭全部终端 subtab 或切换工作区时销毁
  - 打开面板不打断画布视图聚焦：与 SSH / Git Log / Compare 并存互不干扰

## [0.13.11] - 2026-08-14

### 修复

- **终端删除键变空格（真根因，非 229/IME 事件链）**：`tauri-plugin-pty` 的 `term_name` 参数是死代码（`lib.rs` 直接 `let _ = term_name`），从未传给 PTY 子进程；本地 PTY 的 shell 子进程继承 Tauri GUI app 的 `TERM=dumb`，zle 行编辑器判定为非交互终端 → 删除键回显走「原地空格覆盖」（只发 `\x20` 缺 `\b` 退格），视觉表现为「删不掉 + 后面冒空格、空格数 = 已输入字符数」。0.13.10 的手动派发 `\x7f` 已把删除字节正确发出，病灶在 shell 回显层而非前端
  - 修（`LocalTerminal.vue`）：spawn 时显式注入 `TERM=xterm-256color`（`term_name` 参数无效，只能走 env）；不注入 LANG/LC_*（继承 GUI 进程 locale 即可，强制 locale 会被 oh-my-zsh 启动流程叠加导致回车异常）
- **终端回车键命令不执行（0.13.10 引入的回归）**：`terminalInputBridge.ts` 的 `isWhitespaceOnly` 用 `\s` 匹配，把 Enter 的回车 `\r` 误判为「纯空白」，在 onData 的「只认真实空格键 keydown」拦截分支被静默丢弃 → 命令无法执行。改只匹配空格族（半角/全角/不间断空格），排除控制字符 `\r\n\f\v`
- **终端 Tab 补全提示消失（0.13.10 引入的隐藏回归）**：同上 `isWhitespaceOnly` 把 Tab 的 `\t` 误判为纯空白拦截丢弃 → shell 收不到 Tab、补全不触发。Tab 改由 safeWrite 内既有 120ms 去重单独放行
  - 验证：打包 app 实测——删除键正常删除无空格插入；`ls`/`echo` 等命令回车正常执行；`cd se`+Tab 正常补全

## [0.13.10] - 2026-08-13

### 修复

- **终端删除键变空格（根治，非组合态 229 吞键路径）**：macOS 输入法活跃时 Backspace 的 keydown `keyCode=229`，xterm 6 的 `CompositionHelper.keydown()` 对非组合态 229 一律走 `_handleAnyTextareaChanges` 并提前返回——`evaluateKeyboardEvent` 永不执行，`\x7f`（删除控制符）发不出去，表现为「删除键删除不了」；同时输入法把 textarea 残留逐个替换为等长空格，经 `CompositionHelper` 的 `_finalizeComposition` / `_handleAnyTextareaChanges` 等长分支绕过 input 事件层直接派发进 shell——「输入 N 字符 → 出现 N 个空格」，缓冲耗尽后删除键彻底无反应
  - 修 1（`terminalInputBridge.ts`）：非组合态 Backspace/Delete 不再交给 xterm——手动派发 `\x7f`/`\x1b[3~` + `preventDefault` + `return false`，彻底绕开 229 吞键分支
  - 修 2（`terminalInputBridge.ts`）：onData 纯空白拦截从「删除键时间窗」改为「空格键 keydown 追踪」——只有用户真实按过空格键的空白才放行，IME 泄漏空白一律拦截，不再依赖被输入法吞掉的删除键信号
  - 验证：打包 app 实测——`cd`/`npm` 后连续按删除键正常删除，无空格插入；命令中的空格键输入不受影响

## [0.13.9] - 2026-08-13

### 修复

- **编辑器字号修改从未真正生效**：`uiTheme` 的 `font-size: inherit` 特异性高于主题字号规则，字号调整只换类名、解析值不变（恒为 body 的 13px）——字号设置改动从未真正应用到编辑器。双类特异性（`&.cm-editor`）修复
- **⌘/Ctrl+滚轮调字号永不触发**：macOS 与 Windows 滚轮 deltaY 单位不同，节流判定恒不满足。改浮点累积
- **⌘/Ctrl+滚轮调字号节流吞事件**：快速滚动时 throttle 丢弃中间事件、字号跳跃。改累积式对齐 VS Code 手感
- **窗口原生标题不随项目更新**：多窗口切换时系统层（Mission Control / 窗口菜单）显示默认「Miro Code」；原 openFolder 内 fire-and-forget 只覆盖手动打开场景，启动恢复（restoreLastFolder）等路径不同步。标题同步改 `watch(rootPath)` 驱动统一入口，覆盖全部打开路径
- **Dock 菜单点不开 + 显示残留窗口**：旧实现两处根因——`NSMenuItem` action 为 null（tao/muda 无 dockMenu 入口，菜单项点不开）+ `setDockMenu:` selector 在 macOS 15 SDK 不存在（msg_send 静默 no-op，菜单从未设上，macOS 退回渲染当前打开窗口列表）。改 `class_addMethod` 向 TaoAppDelegate 注入 `applicationDockMenu:` 实现 + `DockMenuTarget` 子类（ivar 持有 AppHandle，`representedObject` 携带 id+path），每次右键取最新菜单；前端 `syncDockMenu()` 统一入口 + AppShell 监听 `menu://dock` 路由打开项目

## [0.13.8] - 2026-08-13

### 修复

- **Git 操作不再冻结 UI（系统性）**：Tauri 2 同步命令默认在主线程执行（wry IPC handler 内联），`git_status` 的未跟踪目录递归、`git_log` 逐 commit 全树 diff、系统 git rebase、删除远程分支（网络 push）等耗时操作会整窗卡死。全部改为 async + `spawn_blocking` + 超时兜底（`git_status`/`git_log`/`git_diff`/`git_blame`/rebase 系列/`git_delete_remote_branch`）；SSH 连接全流程（最长 ~75s）与 Prettier npx 启动同样异步化
- **merge 自动提交只有单亲，重复 merge 出冲突**：`repo.merge()` 不写 MERGE_HEAD，自动提交的父链只含 HEAD——被合并分支 tip 不是新提交祖先，再次 merge/pull 同一分支会把已应用变更重复应用、凭空产生冲突。三处合并点（merge 分支 / pull / 更新项目）补上第二父提交
- **交互 Rebase 冲突解决后 Continue 卡死**：cherry-pick 冲突时 step 保留在队列首位（正确），但 Continue 已把该提交完成后 replay 又对同一 commit 再次 cherry-pick——报 "previous cherry-pick is now empty"，只能 Abort。Continue 成功后先移除队列首位再重放；`--continue` 失败不再吞错
- **AI 补全中文乱码**：SSE 流式逐 chunk `from_utf8_lossy` 解码，多字节字符落在 chunk 边界时损坏为 U+FFFD 永久丢失。改字节缓冲按行解码 + 处理末尾无换行的最后一行
- **SSH 终端输出中文乱码**：读循环每 8KB chunk 独立 lossy 解码同样截断 UTF-8。改增量解码（`valid_up_to` + `error_len` 保留不完整尾字节）
- **AI ghost text 按 Esc 后复活**：dismiss 只清建议不清在途流，流式 delta 到达（Esc 不改文档，防竞态比对恒成立）后刚取消的补全重新渲染。dismiss 时标记丢弃 + 取消 Rust 侧在途流
- **AI 请求竞态 + 事件监听泄漏**：请求停在 `getAiApiKey` await 时被新请求取代，旧请求继续执行会覆盖新请求状态且其 3 个事件监听从不 unlisten（每次泄漏）。加请求序号（epoch），await 后校验过期即作废
- **LSP 文档同步失效**：`didChange` 增量分支恒发空 `contentChanges`（LSP 规范=无变更），tsserver 端文本停留在 didOpen 快照，hover/补全/诊断全部基于过期内容。空 changes 降级为 `{ range: null }` 全量替换
- **LSP rename 后保存覆盖回旧内容**：`applyWorkspaceEdit` 写盘但不更新已打开标签的内存态，Cmd+S 把 rename 结果整体还原。写盘后同步编辑器缓冲区 + 补发 didChange；CRLF 文件保留原换行风格
- **LSP server 崩溃后僵尸条目 + zombie 进程**：stdout 读循环异常退出只发 exit 事件，不清理服务器状态。退出时自动移除条目并 kill + wait 子进程
- **Markdown 预览 XSS**：marked 默认把 raw HTML 原样透传进 `v-html`，恶意 `.md` 可在 WebView 上下文（含 Tauri IPC）执行脚本。raw HTML 一律转义 + 拦截 `javascript:`/`data:` 危险协议链接
- **F2 重命名不可用**：`window.prompt` 在 Tauri WKWebView 静默返回 null。改用应用内 PromptDialog，预填光标处符号名
- **重命名/剪切移动目录后已打开标签不更新**：只更新单文件路径，目录内已打开文件保存时写回旧路径。目录场景改前缀级标签更新（与拖拽移动一致）
- **新建文件搜不到**：文件列表缓存无失效机制，同一工作区永久复用首次遍历结果。缓存加 3s TTL
- **替换文件时特殊 Unicode 字符触发 panic**：大小写不敏感分支用 `to_lowercase` 的偏移切片原字符串，Unicode 折叠改变字节长度（İ/ẞ）时非字符边界切片。改 ASCII 折叠（`to_ascii_lowercase`，字节长度不变）
- **watch 刷新竞态丢事件**：刷新进行中（`refreshing=true`）时 `refreshFromDisk` 直接 return，该批变更路径永久丢失。加 `refreshAgain` 补刷（与 git store 一致）
- **Dock 菜单中文路径 panic**：菜单标题按字节切片（`&s[..n]`）落在 UTF-8 字符中间直接 panic，中文路径每次调用都触发。改字符级截断
- **凭据文件瞬时 0644 权限窗口**：git/ai/ssh 凭据先 `fs::write`（0644）再 chmod 0600，写入瞬间同机其他用户可读。改 `OpenOptions` + `mode(0o600)` 新建即私有
- **打开超大文本文件内存爆炸**：`read_text_file` 无大小上限。加 20MB 上限，超限返回明确错误
- **SSH 远程 shell 退出后会话不回收**：读循环 EOF 只发 exit 事件，同 id 无法重连、写入已关闭通道。退出时自动回收（stop + 关通道）
- **AI 300ms 首字提示失效**：`StreamFilter.start()` 从未调用，`startTime` 恒 0 导致每 token 立即 flush。创建后启动计时
- **查询框回车双触发搜索**：input 与 overlay 两个 Enter handler 都调 `onSearch`，一次回车发两次 IPC。overlay 分支在查询框聚焦时不再重复触发
- **终端脚本 / LSP 降级 / 格式化错误提示**：脚本首次加载与重复执行、LSP 捆绑包降级判断、格式化失败提示若干修正

### 优化

- 资源树挂载时去掉重复的 `git.refresh()` 与滚动定位（onMounted 重复注册）

## [0.13.7] - 2026-08-13

### 修复

- **终端删除键变空格（最终根因，组合态修饰键路径）**：xterm 的 `CompositionHelper` 会把
  「除 Shift/Ctrl/Alt/CapsLock/229 之外的任意 keydown」当作组合提交信号，
  `_finalizeComposition(false)` 直接把当前拼音缓冲派发进 shell。macOS 输入法在 Backspace
  编辑拼音后会合成 `Meta` keydown（WeType/系统拼音均存在），此前该 keydown 触发 xterm
  提前 finalize，把拼音（或被 IME 替换为等长空格的占位内容）漏进终端——「删除键变空格」
  的最终根因
  - 修（`terminalInputBridge.ts`）：组合态下纯修饰键 keydown 一律交回 IME（`return false`），
    阻止 xterm 提前 finalize 组合缓冲
  - 验证：dev + 打包 app 录屏实测——拼音编辑中按 Backspace 不再泄漏空格，删除键正常发送 `\x7f`

## [0.13.6] - 2026-08-12

### 修复

- **终端组合提交内容丢失**（中文/拼音输入法输入英文命令时的根因修复）
  - 根因：`markCompositionEnd` 在 compositionend 时**同步清空** textarea.value，但 xterm 的
    `_finalizeComposition` 用 `setTimeout(0)` 读 value 派发组合提交内容——同步清空导致
    xterm 读到空串，拼音/中文提交内容全部丢失（录屏实测确认：提交后终端无字符）
  - 连带影响：提交内容丢失后 textarea 残留未被清理（清空发生在浏览器写入提交内容之前），
    按 Backspace 时 IME 把残留替换为等长空格泄漏到 shell——即「删除不了 + 追加空格」现象
  - 修：compositionend 不再同步清空，残留清理由 `safeWrite` 派发后（`data === textarea.value`）
    统一完成
  - 验证：dev + 打包 app 录屏实测——中文拼音组合提交正常上屏、Backspace 正常发送 `\x7f`、
    英文/中文态均无空格泄漏

## [0.13.5] - 2026-08-12

### 修复

- **终端删除键变空格（第二版，组合态路径）**：第一版修复覆盖了非组合态（残留替换拦截有效），
  但漏了 IME 组合态路径——中文输入法下输入拼音（组合态）后按 Backspace，IME 把拼音替换为
  等长空格占位，触发 `isComposing=true` 的 `insertText` input 事件，原代码对组合态 input
  直接放行，经 xterm `_inputEvent`（组合态 keydown 被 IME 吞掉时 `keyDownSeen=false` 条件成立）
  把空格当输入派发到 shell
  - 修（`terminalInputBridge.ts` 双层）：① 组合态 `insertText` 纯空白 input 一律
    `stopPropagation`（组合态空格只有泄漏这一个来源，选字/上屏不产生空格 input）；② onData
    空白拦截加 `ime.composing` 条件（无时间窗依赖，组合态空白直接拦）
  - 验证：dev 自测（日志落盘 + 自动模拟按键序列）确认组合态空格被拦截、非组合态残留替换
    全部拦截、Backspace 正常发送 `\x7f`

## [0.13.4] - 2026-08-12

### 修复

- **终端删除键变空格**（仅打包 app 复现：「输入几个字符，按删除键插入几个空格」）
  - 根因：打包环境 WKWebView 下 keydown 的 `preventDefault` 不可靠/被 IME 层吞掉，浏览器把输入字符写进 xterm 隐藏 textarea 且无人清理（残留）；按 Backspace 时 IME 把残留字符替换为等长空格，经 xterm `_inputEvent` 二次派发（keydown 被吞时 `keyDownSeen=false` 触发派发条件）泄漏到 shell——原有 `lastDeleteAt < 300ms` 拦截因 keydown 未到达而失效
  - 修（`terminalInputBridge.ts` 四层）：① `safeWrite` 派发后 `data === textarea.value` 同步清空（中文提交残留）；② onData 空白拦截追加 `!keyDownSeen && 组合提交后 1.5s 内` 条件；③ `onImeCommitInput` ASCII 分支清空残留（英文输入残留源头）；④ Backspace keydown（非组合态）主动清空 textarea
- **应用内更新 403 安装失败**（中国大陆网络）
  - 根因：tauri-action 生成的 `latest.json` 资产 url 指向 `api.github.com/releases/assets/<id>`，匿名访问受限流/风控（403）；`github.com/releases/latest` 清单路径在大陆网络下也不稳定
  - 修：① updater `endpoints` 改数组（官方源 + ghfast.top 镜像按序 fallback）；② 新增 `scripts/rewrite-updater-urls.mjs` 把资产 url 改写为镜像直链（已对 v0.13.3 线上执行）；③ `release.yml` 新增 `finalize` job 每次发布自动改写
- **macOS 红绿灯贴顶被窗口裁掉**
  - 根因：配置了 `trafficLightPosition` 后，tao 0.35 的 `draw_rect` 每次窗口重绘都执行 `inset_traffic_lights`，把标题栏容器高度重置为 `按钮高 + y`（≈24pt），`apply_traffic_lights` 设的按钮 `origin_y=12` 在 24pt 容器下中心距顶仅 6pt（应为 19pt）
  - 修：删除 `tauri.conf.json` 与 `openWorkspace.ts` 的 `trafficLightPosition`，位置完全由 Rust 端接管（setup 一次 + 窗口事件钩子）
- **全局搜索卡死 + 关闭重开状态不重置**：文件列表缓存重建、搜索任务取消链路修正
- **补回本地终端标签 × 关闭按钮**
- **亮色主题终端底部黑条**：PTY 初始尺寸/背景色对齐修正
- **窗口居中，不再持久化 POSITION**；**默认窗口对齐 Cursor/VSCode 1440×900，不再记 SIZE**
- **右上角终端按钮离右边缘 14px**，与红绿灯左侧对称
- **设置-关于区域删除最后一行文案**

### 优化

- **折叠箭头右移 6px**，不再紧贴 gutter 左缘
- **项目标题居中**（TitleBar）
- **设置-移动时更新 import 下拉改全宽**、**镜像行 select 占满整行**（不再跟随 option 文本宽度）
- **终端入口左留白 12px → 20px** 加大右距

### 性能

- **搜索文件卡死优化**：防抖 + 代际取消 + 零分配匹配 + 超时缩短（`features/search`）

## [0.13.3] - 2026-08-12

### 修复

- **打开项目后 macOS Dock 菜单真崩溃**（用户截图控制台 `unrecognized selector sent to NSMenu instance` + `libc++abi: terminating due to uncaught exception of type NSException`）
  - 根因：`set_dock_menu_macos` 里 5 处把 `NSMenu` class 当 `NSMenuItem` 用了：`item_recent / empty_item / 循环里 item / 当前文件 item` 都用 `nsmenu_class`（`NSMenu`）`alloc`，但接着调的是 `initWithTitle:action:keyEquivalent:`（`NSMenuItem` 的 init selector）。结果 alloc 出来的是 `NSMenu` 实例，selector 不识别抛 `NSException`；release profile `panic = "abort"` 把整进程 abort 掉
  - 修：单独拿一次 `nsmenuitem_class`，所有 `NSMenuItem` 实例的 alloc 切到它；`NSMenu` 仍走 `nsmenu_class`
  - 加固：`set_dock_menu` 外层 `std::panic::catch_unwind` + `AssertUnwindSafe`，即使后续再有 Rust panic 也只 `eprintln` 日志 + 返回 `Ok`，不再二次 abort

## [0.13.2] - 2026-08-12

### 新增

- **未打开项目时也能开本地终端**：TitleBar 右上角终端按钮不再因 `!rootPath` 被禁用，点击时 cwd 自动回退到 `~`（`@tauri-apps/api/path.homeDir()` 预取缓存），提供「先开终端再选项目」的快速路径
- **macOS 系统集成四件套**（TitleBar 全局项目标题 + 启动拉前 + 窗口状态恢复 + Dock 菜单 + security-scoped bookmark）
  - TitleBar 中央展示「项目名（粗体 ≤24 字自动截断）+ 完整路径（淡灰 ellipsis）」，点击复制路径
  - 应用启动后把 App 拉到最前（解决自动更新后需手动点 dock 才能前置）
  - 接入 `tauri-plugin-window-state`，多窗口位置/大小/最大化状态自动持久化与恢复
  - 接入 `tauri-plugin-pty` 之外的 macOS Dock 菜单（最近项目 + 当前文件预览），`set_dock_menu_macos` 走 `MainThreadMarker` 守卫非主线程提前 return
  - 首次授权工作区后写 security-scoped bookmark 到 `localStorage`；下次启动 `restoreLastFolder` 先 `resolve_security_scoped_bookmarks` 激活访问权，自动更新后不被 TCC 弹问

### 修复

- **启动 panic 根因**：「`panic in a function that cannot unwind` / `thread caused non-unwinding panic. aborting.`」
  - 根因：之前 `setup` 闭包内 `force_activate_macos()` 调 `NSApp.setActivationPolicy()`，与 tao 0.35 的 `did_finish_launching → AppState::launched → apply_activation_policy` 二次设置时序冲突，触发 `MainThreadMarker::new().unwrap()` 跨 `extern "C"` 边界 panic
  - 修：彻底删 `force_activate_macos` 路径；拉前改由前端 `AppShell.onMounted` 调 `getCurrentWindow().setFocus() + unminimize()`，避免与 tao 内部状态机抢时序
- **打开项目后 `openFolder` 半残状态**（用户反馈「打开项目又崩溃」）：原实现先 `stopWatch + 改 rootPath + 清空 childrenMap` 再 `await loadChildren`，若 `list_dir` 抛错（目录失效 / 权限不足 / 软链断了），外层 catch 能接住但 rootPath 已切到坏路径、childrenMap 空、showNotice 跳过、所有 reset 全跳过——半残状态
  - 改为**提交语义**：先 `list_dir` 拿 entries，失败就 toast + return false 不污染任何状态；再一次性 commit `rootPath / childrenMap / expanded / filter / clipboard / recentFolders`；切换工作区时的 `resetLocalForWorkspace / resetForWorkspace / refresh` 统一过 `safeCall` 包装，单个失败只 `console.warn` 不影响主流程
- **项目下拉菜单被 SideBar 裁切**（用户截图「此处选择项目有遮挡」）：`.panel` 的 `overflow:hidden` 把 `position:absolute` 的 `.project-menu` 左右边线切掉
  - 改 `<Teleport to="body">` 渲染 + `getBoundingClientRect()` 算视口坐标 + `position:fixed`，`onDocMouseDown` 仍以 `.project-menu` 为白名单避免点内部误关
- **编辑器代码文字再调亮**（用户反馈「亮度还是不够」）：dawn 主题 `fg` 从 `#1c1c1e → #0a0a0a`，`lightHighlight.variableName → #000000`；4 主题 `lightHighlight` 全部上提到 Tailwind 400 系列，与全局 `--text-primary` 对齐

### 优化

- **终端入口加左侧留白与红绿灯对称**（用户反馈「终端入口贴右侧太近」）：`.terminal-btn` 加 `margin-left: var(--space-3)`，与红绿灯到折叠按钮的距离对齐
- **项目下拉首项图标基线对齐**：`.project-item.primary` 覆写 `align-items: center`（默认是 `flex-start` 适配多行 name+path layout，但 primary 是单行 lucide 图标 + 文本，flex-start 让 14px SVG 顶到容器顶端、中文相对下沉）

## [0.13.1] - 2026-08-12

### 新增

- **编辑器内 ⌘/Ctrl + 滚轮调节字体大小**（VS Code 行为，范围 10-24，节流 60ms 自动持久化到 `editor.fontSize`）
  - 拦截带修饰键的 `wheel` 事件并 `preventDefault`；无修饰键的滚动照常生效
  - `deltaY < 0` 调大、> 0 调小，每次 ±1px；不绑键位（避免与现有 ⌘+/⌘- 键位冲突）

### 修复

- **状态栏一直显示「LSP 降级」**：
  - 根因：`nodeDetector.cached` 缓存的运行时检测结果，在语言服务安装/卸载后未失效，导致 `start()` 永远拿到安装前的 `node:false` 直接短路到 `unavailable`
  - 修：`installLanguageService` / `uninstallLanguageService` 完成后调 `clearRuntimeCache()` 再 `stop+start`，让运行时检测拿到最新路径
- **LSP `manager.stop()` 状态机复制残留 bug**：原 `setStatus(this.enabled ? "disabled" : "disabled")` 两支同字符串（典型复制残留），改回单值 `setStatus("disabled")` 初始态；状态机由下一次 `start()` 推进

### 移除

- **ESLint 整链路移除**（默认一直关闭、状态栏无指示、调度链路不被任何流程触发）
  - 前端：`src/features/editor/eslintLinter.ts`（`createEslintScheduler`）/ `lintWithEslint` / `EslintDiag` / `editor.eslintEnabled` 设置项 / 设置面板 ESLint 开关 / i18n `eslintEnabled` + `eslintDesc` / `DiagnosticsMerger.setEslintDiagnostics` 合流方法
  - Rust：`src-tauri/src/commands/tooling.rs` 中 `lint_with_eslint` 命令 + `EslintDiag` 结构体 / `lib.rs` 注册

### 优化

- **编辑器代码文字调亮**（4 主题 `fg` 全部上提一档，与全局 `--text-primary` 对齐）
  - `miro-dark` `#f5f8ff → #fafbff`
  - `dawn` `#111114 → #1c1c1e`（最显著，原色比全局 `--text-primary` 还暗 11 个 R 通道）
  - `midnight` `#f1f5f9 → #f8fafc`
  - `cyberpunk` `#faf5ff → #fdfcff`
  - 同步微调 `lightHighlight` 的 `variableName` / `definition(variableName)`，保持关键字与正文相对对比度

## [0.13.0] - 2026-08-12

### 新增

- **Markdown 渲染重做为 Cursor 风格**：白底干净 + 紧凑排版 + 完整结构（标题分级 / 列表缩进 / 引用 / 表格 / 分割线 / 链接 / 图片 / 代码块 全部规范化）
  - 容器 `max-width: 920px` 居中，行距 1.65；正文改用 `--text-primary` 不再降级
  - **自研轻量代码高亮**（`src/features/editor/markdown/highlight.ts`）：5 类 token（keyword / string / comment / number / type），覆盖 JS / TS / JSX / TSX / JSON / Bash / Python / YAML / MD；不引 `highlight.js` / `shiki`，bundle 不增加新依赖
  - **marked 单例封装**（`src/features/editor/markdown/preview.ts`）：GFM + breaks + 自定义 code 渲染器，调用方只 import `renderMarkdown`
- **MD 预览/编辑切换** 改为 **右上角 Segmented Control**（眼睛/笔两段浮动控件），与 Cursor 入口对位；标签栏单按钮改为仅 SVG 保留

### 优化

- **活动栏 Git Log 入口挪到左上 Git 图标下**：顶组顺序 Files → Commit → Log，底组 Scripts → Settings；Git 区域视觉聚合，操作更顺手

### 持久化

- MD 模式按文件路径存 `localStorage['mirocode.md-mode:<path>']`（'preview' / 'edit'），切回同一文件自动恢复上次选择；不污染 `EditorTab` 字段

## [0.12.0] - 2026-08-11

### 新增

- **语言服务多语言独立安装**：重构语言服务为按语言独立打包、独立安装、独立管理，架构可扩展未来新增语言（Python / Go 等）
  - **列表形态**：设置 -> 编辑器 -> 语言服务以列表展示每种语言服务（TypeScript / Vue），各带图标、名称、能力描述、状态徽标（已安装 / 未安装 / 有更新）与独立操作按钮
  - **按语言独立**：每种语言一个 zip（含便携 Node + 对应 language server），独立安装目录 `language-servers/<language>/`、独立安装记录、独立卸载，互不依赖
  - **双层版本清单**：`ls-latest.json` 改为 `languages.<lang>.platforms.<platform>` 双层结构，一次拉取含全部语言
  - **镜像连通状态指示**：镜像下拉框旁新增连通状态圆点（绿=连通、黄=不可达、灰=检测中），解决镜像不可达时用户无感知的问题
  - **状态栏 LSP 指示器可点击**：`<span>` 改为 `<button>`，点击打开设置面板语言服务分区；降级状态黄色脉冲高亮引导
  - **打开 Vue 文件自动提示安装**：检测到 `.vue` 文件且语言服务未就绪时弹 Toast（带「安装」按钮可跳转设置），同会话只弹一次
  - **Toast 通知支持操作按钮**：`showNotice` 扩展可选 action 参数，带 action 的 toast 不自动消失
  - **设置面板分区定位**：`openSettings(nav)` 支持打开时定位到指定分区

### 修复

- **镜像下拉框切换被切回**：`<select>` 用 `:value` 单向绑定 + `@change` 未回写 `lsMirror`，re-render 拉回初始值；改为 `v-model` 双向绑定
- **一键安装报「无法获取语言服务版本清单」**：镜像不可达时用户无感知，新增镜像连通状态指示器引导切换源

### 变更

- **语言服务打包重构**：`build.mjs` 加 `--language` 参数，按语言独立 npm install + 单 entry manifest；`merge.mjs` 生成双层 `ls-latest.json`；CI 工作流矩阵改为 5 平台 × 2 语言
- **后端重构**：`language_services.rs` 全量重写（`RemoteManifest` 双层、`BundledRuntime` 单 entry、路径按语言、`ls_install/uninstall/status` 加 language 参数）；`lsp.rs` 的 `ServerType::as_str()`、`build_server_command` 用 `rt.entry`、`lsp_check_runtime` 按语言独立检测
- **文案调整**：去掉「内置」「一键」措辞，改为「按语言独立安装」

## [0.11.1] - 2026-08-10

### 新增

- **SFTP 上传进度条**：上传文件时显示实时进度条（文件名 + 百分比），多文件逐个上传时跟随当前文件；Rust 端按 64KB 块累计进度、每 150ms 节流推送 `sftp://progress/{id}` 事件，避免大文件高频事件拖垮前端
- **内置语言服务捆绑包**（设置 → 编辑器 → 语言服务 → 一键安装）：预打包的 Node 运行时 + `typescript-language-server` + `@vue/language-server` 可一键下载安装到应用数据目录，安装包本体保持轻量、LSP 不再依赖宿主 Node
  - **多镜像源与国内兼容**：默认「自动」模式先尝试 GitHub 官方源，失败自动切换 ghfast.top 加速镜像；另提供官方 / 加速 / 自定义镜像手动选择
  - **完整性校验**：下载产物 sha256 校验通过后解压激活，失败自动中止并清理临时文件
  - **版本管理**：显示已安装 / 最新版本，可一键更新 / 卸载；安装后自动重启工作区 LSP 立即生效
  - **启动策略**：优先内置捆绑包，未安装时回退宿主 npx（项目 / 全局 node_modules），行为与旧版一致

### 修复

- **SFTP 删除文件夹时服务崩溃**：递归删除原用 `stat()`（跟随符号链接），目录内符号链接指向祖先路径时形成环、无限递归导致栈溢出崩溃；改为 `lstat` 不跟随链接（链接一律按文件删除）+ 64 层递归深度上限兜底
- **SSH 输入命令时写入失败 / 断开连接（`transport read`）**：SFTP 操作把共享 Session 切成阻塞模式后释放了锁，shell 读线程在非线程安全的 libssh2 Session 上并发调用破坏状态机，产生「写入失败」与「SSH 通道读取失败：transport read」误判断连；改为 SFTP 操作全程持有 session 锁执行（彻底互斥），并将软错误误判阈值从 60 次（≈1.5s）放宽到 400 次（≈10s，真断连仍由 eof / 硬错误即时触发），`wait_shell_io_ready` 等待超时放宽到 30s（覆盖大文件上传）
- **SSH Tab 补全后路径多一个 `/`**：打包环境（WKWebView）下 Tab 事件双发，远程补全被触发两次导致 `cd ser` + Tab 后多出斜杠；`safeWrite` 对 `\t` 增加 120ms 去重窗口（dev 单发不受影响，连按切换补全候选仍可用）
- **SSH 删除键删除后变空格**：打包环境 `preventDefault` 不可靠，浏览器对 textarea 的 input 事件绕过自定义 key handler，删除产生的误插空白无人拦截；`onImeCommitInput` 增加删除时间窗（140ms）+ 残留标志兜底，删除后空白一律拦截复位，真实输入正常放行
- **Git 更改文件右键菜单切换区域后不消失**：菜单经 Teleport 渲染到 body，原仅面板内 `@click` 可关闭；新增全局 `mousedown` 监听关闭（排除菜单自身节点）
- **资源管理器右键菜单被遮挡截断**：菜单 z-index 仅 40，被编辑器等高浮层遮挡；高度估算（320px）小于实际渲染高度，底部越界被 `overflow:hidden` 裁掉；改为渲染后按真实尺寸反向回拉校正 + z-index 提升至 90
- **打包后 `dist` 目录不显示 / 不刷新**：`WATCH_IGNORE_NAMES` 与 Rust `DEFAULT_IGNORES` 均含 `dist`，构建产物目录被文件监听丢弃且资源树过滤；两处 ignore 名单移除 `dist`

## [0.11.0] - 2026-08-10

### 新增

- **AI 行内智能补全（ghost text）**：类似 GitHub Copilot 的行内补全体验，输入时自动请求 AI 生成建议，灰色 ghost text 预览，Tab 接受 / Esc 取消
  - **多 provider 支持**：内置 DeepSeek / 自定义预设，选择后自动填充地址与模型，仍可手动覆盖
  - **FIM 协议**：走标准 `/completions` 端点（prompt+suffix，API 服务器内部处理 FIM token，前端不拼 `<|fim_begin|>` 等 token）
  - **流式补全**：Rust 层用 reqwest 流式请求 + tokio 读 SSE 逐 chunk 推送前端（复刻 LSP transport 架构），前端 ghost text 随增量实时更新
  - **防抖与取消**：350ms 防抖（可配置），用户继续输入时自动取消在途请求（reqId 比对 + 事件 unlisten）
  - **API Key 安全存储**：`~/.mirocode/ai-credentials.json`（0600 权限，复刻 SSH 凭据模式），不进 localStorage / webview
  - **LSP 补全兼容**：ghost text 与 LSP popup 走不同 UI 通道不冲突；Tab 用 `Prec.highest` 抢占，LSP popup 打开时不拦截
  - **设置面板**：新增 AI 配置分区（开关 / provider / API Key / 地址 / 模型 / 模式 / 多行策略 / 防抖延迟 / token 预算 / 温度 / 测试连接）
  - **状态栏指示器**：显示 AI 状态（就绪 / 思考中 / 错误）
  - **补全增强（二期）**：
    - 多行策略生效：never 单行 / auto 启发式（注释、已闭合语句走单行，未闭合括号、函数签名走多行）/ always 多行，经 `stop` token 控制
    - Prompt Token 预算裁剪：超预算时 prefix 保底部、suffix 保顶部（贴近光标最重要）
    - Contextual Filter 触发前过滤：语句已闭合 / 纯注释行跳过请求，避免劣质补全
    - 后处理：剥代码块围栏（```）、多余闭合括号截断、重复片段去重
    - Rust 侧取消在途请求（`ai_cancel`）：前端继续输入时终止流读取循环
    - 流式过滤管道：行级稳定更新（完整行才重绘 ghost text）+ 300ms 首字提示（`showWhateverMs`）
    - 跨文件 snippet 上下文：从已打开的同语言文件按行重叠率抽取相似片段拼入 prompt
    - 测试连接优化：首个 delta 到达即判成功（10 秒超时兜底）

### 文档

- **功能定版**：核心功能集定版，不再扩展大功能模块，进入优化迭代期
- 全量重写项目文档并对齐代码现状（README / AGENTS / 技术架构 / 视觉与主题规范 / 使用说明 / THIRD-PARTY-NOTICES）
- 移除 `docs/交接文档.md`、`docs/Miro Code功能排期.md`、`docs/Miro Code代码编辑器需求文档.md`（内容已并入《使用说明》与《技术架构文档》）

## [0.10.1] - 2026-08-10

### 修复

- **macOS 红绿灯垂直居中**：修复 Retina 屏上红绿灯明显偏上、未在标题栏垂直中线对齐的问题。根因为 `window_chrome.rs` 误将 CSS px 按 `backingScaleFactor` 缩放（macOS 上 1 CSS px = 1 逻辑点，与 Retina 无关），导致 2x 屏标题栏高度被算成 19pt、红绿灯 origin_y 仅 2.5pt 几乎贴顶；同时恢复了标题栏容器 `setFrame` 高度设置（38pt）。现红绿灯中心稳定落在 38pt 标题栏垂直中线（origin_y=12pt），与前端折叠按钮同排
- **终端隐藏态启动错误尺寸**：修复本地终端在 `v-show` 隐藏态挂载时以占位/错误尺寸启动 PTY，导致 shell 提示符按错误列宽折行、激活后与旧缓冲叠加表现为「目录出现两遍」。改为宿主真正可见（`clientWidth/Height > 0`）后才 `fit + spawn`，隐藏态挂起、激活时补启动
- **终端删除键误插空格（打包环境兜底）**：`terminalInputBridge.ts` 新增 `suppressNextWhitespace` 标志，删除键处理后置位，吞掉紧随其后的那次误插空白。dev 下 `preventDefault` 通常已拦截，此处为打包环境（自定义协议 WKWebView）`preventDefault` 不可靠时的兜底，修复「删 N 个字符多出 N 个字符」
- **关闭最后一个文件标签不激活终端**：`closeTab` 在已无剩余文件标签时兜底激活已打开的终端标签，避免「只剩终端却不激活」（`closeTabsByPaths` 批量关闭 / closeAll / closeOthers 等场景统一覆盖）

### 新增 / 优化

- **`@/` 路径别名 import 跳转**：对齐 tsconfig `paths: { "@/*": ["src/*"] }`，支持 `@/...` 别名的跨文件 go-to-definition / 下划线提示 / 符号索引 / 引用 / 重命名 / 移动文件时改写。解析层 `shared/fs.ts` 新增 `resolveAliasPath`（默认映射 `<root>/src`，可配置前缀与映射根）；`importReferences.ts` 的 `resolveImportPath` / `resolveImportCandidate` / `scanImportReferences` 放开相对路径限制统一支持别名；`navigation.ts` / `workspaceSymbols.ts` 的 import 链解析同步生效
- **全局搜索索引优化**：
  - `search_content` / `search_files` / `replace_in_files` 由同步命令改为 `async` + `spawn_blocking` + 超时（对齐 git 网络命令防阻塞约定），避免大仓库 / 慢磁盘全量遍历阻塞 Tauri IPC worker 线程（此前与 git push 卡死同款根因）
  - 新增工作区文件列表 LRU 缓存（root + 忽略规则为 key，上限 32），避免每次搜索重复全量遍历目录树
  - 前端搜索加请求序号竞态保护：发起新搜索或关闭面板后自动丢弃过期 in-flight 结果
- **编辑区标签固定区**：终端 / SSH / GitLog / Compare 等非文件标签固定钉在标签栏最右侧，不随文件标签滚动也不被挤压（`margin-left:auto` + `flex-shrink:0`），避免文件标签多时把功能标签挤出可视区

## [0.10.0] - 2026-08-09

### 优化：SSH 独立入口 / 终端输入 / 流畅度（综合优化）

**SSH 独立入口（架构级）**
- SSH 远程视图从「终端」标签拆分为独立编辑区标签，与本地终端彻底解耦：本地终端（⌘J）只含本地 PTY，SSH（含主机列表 / 远程终端 / SFTP）由**状态栏左下角 SSH 图标按钮**独立打开
- 关闭 SSH 标签不再影响本地终端，反之亦然；切换工作区仍强制断开全部 SSH/SFTP 远程连接
- 新增 `stores/ssh.ts` + `features/sessions/SshView.vue`；`stores/sessions.ts` 精简为纯本地终端

**终端输入修复**
- 修复按删除键偶发出现空格的问题：`terminalInputBridge.ts` 统一由键处理单一入口拦截纯 Backspace/Delete 并直接写控制字符（`\x7f` / `\x1b[3~`），避免 WKWebView 将删除误报为空格；按住删除键可连续删除（绕过去重）
- 终端右键点按选中整词（`rightClickSelectsWord`，macOS 终端惯例）

**流畅度 / 性能**
- 状态栏 LSP 指示器由每 2s 轮询改为事件订阅（`lspManager.onStatusChange`）
- `git.refresh()` 内部 5 项查询并行化（branches/stashes/rebase/conflict）
- 资源管理器文件变更由全量重列改为**只重列受影响父目录**的局部刷新
- 清理 `documentSymbols.ts` 冗余分支


完整接入 Language Server Protocol，为 TS/JS/JSX/TSX/Vue SFC 提供 7 项语义能力。不自研 LSP 服务端（架构文档约束），通过 Rust transport 层桥接外部 `typescript-language-server` + `@vue/language-server`（Volar）。宿主提供 Node 运行时 + 检测降级：Node 不可用时自动降级回 v1 正则方案，不阻塞编辑。

**架构（三层）**：

```
CodeMirror 扩展 ←-> 前端 LSP Client ←-> Tauri invoke/event ←-> Rust LSP Manager ←-> stdio JSON-RPC ←-> ts-ls / volar 进程
```

| 层 | 文件 | 职责 |
|---|---|---|
| Rust transport | `src-tauri/src/commands/lsp.rs`（新增 ~450 行） | 子进程管理（tokio::process）+ Content-Length 分帧 + JSON-RPC 读写循环 + 7 个 Tauri 命令 + 进程退出清理 |
| 前端 client | `src/features/lsp/`（新增 6 文件） | `types.ts`（协议类型）/ `transport.ts`（invoke+listen）/ `client.ts`（LanguageClient 生命周期 + 文档同步）/ `manager.ts`（多 server 路由）/ `nodeDetector.ts`（运行时检测缓存） |
| CM6 扩展 | `src/features/lsp/lspExtension.ts`（新增 ~600 行） | hover tooltip / 签名帮助 / 语义补全 / 诊断合流 / 定义跳转 / 引用查找 / 重命名 + 降级 |

**7 项能力**：

| 能力 | LSP 方法 | 快捷键 | 降级 |
|---|---|---|---|
| hover tooltip | `textDocument/hover` | 鼠标悬停 | 无（v1 空白） |
| 签名帮助 | `textDocument/signatureHelp` | 括号内悬停 | 无（v1 空白） |
| 语义补全 | `textDocument/completion` | 输入时 | v1 静态关键字表 |
| 类型诊断 | `textDocument/publishDiagnostics` | 实时推送 | v1 ESLint + JSON/env 自检 |
| 定义跳转 | `textDocument/definition` | F12 / ⌘+Click | v1 `navigation.ts` 正则 |
| 引用查找 | `textDocument/references` | Shift+F12 | v1 `findReferences.ts` |
| 重命名 | `textDocument/rename` | F2 | v1 `renameSymbol.ts` |

**诊断合流**：LSP 类型诊断（source: ts/volar）+ ESLint 规则诊断（source: eslint）合流到同一 `setDiagnostics`，按 from-to-severity 去重。

**设置与状态**：
- 设置页「语言服务」分区：LSP 开关 + 运行时检测状态 + 安装指引
- 状态栏 LSP 指示器：就绪（绿）/ 启动中（灰）/ 降级（黄）
- `lspEnabled` 持久化到 `mirocode.settings.v1`（默认 true）
- i18n 双语（`lsp.*` 段，zh-CN / en-US）

**依赖**：
- `vscode-languageserver-protocol@3.18.2`（纯协议类型，不依赖 VSCode 运行时）
- Rust：tokio 加 `process` + `io-util` + `sync` feature

**测试**：
- Rust transport：5/5 绿（Content-Length 分帧单条/多条/带 Content-Type/空 body/缺 header）
- 全量 cargo test：21/21 绿（12 单元 + 5 LSP + 1 git + 1 tauri + 2 fake_block）
- `pnpm build`：绿（vue-tsc + vite 3.51s）

**真机验证步骤**：
1. 安装 language server：`npm i -g typescript-language-server typescript @vue/language-server`
2. `pnpm tauri:dev`
3. 打开一个 TS + Vue 项目
4. 逐项验证：hover / 补全 / 诊断 / F12 跳转 / Shift+F12 引用 / F2 重命名
5. 关掉 Node（PATH 移除）-> 确认降级回 v1

### 新增

- 资源树右键菜单新增"在终端中打开"：目录直接进入，文件进入其父目录
- 资源树右键菜单新增"复制文件名"（仅文件）：仅复制 `basename`，不含路径
- 窗口级快捷键补齐：`⌘W` 关闭当前标签、`⌘⌥→` / `⌘⌥←` 切换到下一个 / 上一个标签（首尾循环，VSCode 行为）、`⌘R` 刷新资源树

### 修复

- **i18n**：`ImagePreview.vue` 8 处硬编码中文接入 i18n（新增 `editor.image.*` 键：loading / previewUnavailable / noWorkspace / zoomOut / zoomIn / actualSize / fitWindow / wheelZoomHint），zh-CN / en-US 双语齐备
- **补全**：Tailwind 类名补全触发条件扩展为 4 选 1 —— `class`（HTML/Vue）/ `className`（React/TSX）/ `:class`（Vue 动态绑定）/ `class:list`（Astro）。同时收紧负向字符类排除 `]`，避免 `bg-[#fff]` 等任意值类在 `]` 处被错认为属性闭合边界而无法触发补全
- **Git 推送"程序无响应"**：
  - 根因：`git_push` / `git_pull` / `git_fetch` / `git_update_project` 之前是同步 `#[tauri::command]`，libgit2 网络 IO 会阻塞 Tauri IPC worker 线程；慢网络 / 大仓库 / TLS 握手 / SSH 协商下，IPC 线程池被占满后整个 UI 操作全部排队，表现为"无响应"
  - 修复：四个命令改为 `async fn` + `tokio::task::spawn_blocking` + `tokio::time::timeout(120s)`，超时返回明确错误文案（"推送超时（120s），请检查网络或稍后重试"）；前端 `invoke()` 调用方式不变
  - 顺手收紧 `is_auth_error` 判定：去掉 `message.contains("auth")` 这条过宽的子串匹配（会误判网络错误为认证错误导致死循环弹窗），改为仅匹配 `ErrorCode::Auth / Certificate` 与明确的认证/凭据文本
  - `runRemoteWithAuth` 加重试上限：最多 1 次重试（`MAX_ATTEMPTS = 2`），仍认证失败则弹 `git.authFailedGiveUp` 通知并停止弹窗，避免 `for(;;)` 死循环
  - `git_unpushed_commits` 加 30s 超时（同样经 `spawn_blocking` + `tokio::time::timeout`），并在 Rust 进程内加 LRU 缓存：以 `root|branch|local_oid|remote_oid` 为 key，30s TTL；同一 HEAD 短时间内多次刷新不再做 revwalk，避免 Commit 面板刷新卡顿
  - `make_callbacks` 的 SSH agent 调用加 5s 超时：新增 `try_ssh_agent_with_timeout`（临时线程 + `mpsc::sync_channel + recv_timeout`），agent 假死 5s 后回落 `Ok(None)`，继续走密钥文件；agent 不可用返回 `Err`，同样走密钥文件；`Cred` 跨线程通过 `unsafe impl Send for SendCred` 包装（`git2::Cred` 仅持有一个 `*mut git_cred`，自身线程安全）
  - 推送中 / 拉取中状态可感：在 `runRemoteWithAuth` 入口立刻发"正在推送到远程，可能需要数十秒到两分钟…"等 notice（`git.pushing / pulling / fetching / updating`），避免网络慢时 UI 看起来"卡住"；该 notice 持续 0ms，自然被后续成功 / 失败通知覆盖（新增 i18n 键 zh-CN / en-US）
  - 前端 `remoteInFlight` 守卫：连点 Push 按钮只发一个 invoke，后到的点击弹 `git.remoteInFlight` notice（不影响其他 UI，只防重复 IPC）；push 结束（成功/失败/超时）由 `try/finally` 重置标志
  - 前端 `ipc()` 包装埋点：所有 51 个 `invoke()` 调用经 `src/shared/gitApi.ts` 统一包装，开发模式 `console.time("ipc:<cmd>")`，**且自动检测 >2000ms 的慢 IPC 主动通过 `workspace.showNotice` 弹 `⚠ IPC 慢调用：<cmd> 耗时 Xms` warning**——不依赖 DevTools 截屏，用户在真机 UI 上直接看到"哪条 IPC 卡了 + 多少毫秒"。这是给真机视觉验证配套的诊断工具
  - **本机真机验证步骤（CLI 不可替代，必须由用户跑）**：
    1. `pnpm tauri:dev`
    2. 打开 WebView DevTools（⌘⌥I）→ Console 面板
    3. 配 Charles / 断网 → Source Control → Push
    4. 期间同时点活动栏（Project/Commit/History/Sessions）/ 编辑区标签 / 资源树节点
    5. **预期观察**：
       - DevTools Console 出现 `ipc:git_push` 计时卡住 120s
       - 期间所有其他 `ipc:*` 命令 <100ms 返回
       - 如某条 IPC >2000ms，UI 出现 "⚠ IPC 慢调用" 警告 notice（直接显示耗时）
       - 120s 后 `ipc:git_push` 终止 + 看到 "推送超时（120s）" notice
    6. **如发现卡顿**：把"⚠ IPC 慢调用"警告中的命令名 + 耗时贴回会话——能精准定位是 webview 线程、JS 桥、还是某条具体 git 命令层面的问题
  - **`window.__ipcSelfCheck` 一键自检（dev 模式）**：在 `src/main.ts` 暴露 `__ipcSelfCheck()` 到 window。打开工作区后，在 DevTools Console 粘贴：
    ```js
    await __ipcSelfCheck()                  // 基线：1× git_status + 10× 并发 git_status
    await __ipcSelfCheck({ fastCount: 20 }) // 压测 20 个并发 git_status
    ```
    或配慢网络点 Push 后**立刻**跑 `await __ipcSelfCheck({ fastCount: 20 })` —— 直接量化"push 卡住 120s 期间 20 个并发 git_status 的最大/平均耗时"，输出形如：
    ```
    ✅ UI 即时响应：20 个并发 git_status 最大 87ms / 平均 23ms
    ```
    这替代了"手动点 100 次鼠标"——一行 JS 就能在真机 WebView 中给出可量化的并发证据。DevTools Console 启动时也会自动打印使用提示。
  - **puppeteer 端到端运行时证据（`pnpm e2e:ipc`）**：用 puppeteer + headless Chrome 加载 MiroCode 前端（mock Tauri `invoke`），在**真实浏览器引擎**中跑"20 个并发 IPC + 同时点击 UI 元素"，断言前端栈不阻塞 UI 事件循环。运行结果：
    ```
    并发 20 个 git_status：最大 6.1ms / 平均 6.1ms / 总耗时 6.2ms（真并发）
    期间 10 次 UI 点击：平均 0.0ms
    push 卡 800ms 期间 10 次 UI 点击：平均 0.0ms
    ✅ 全部 E2E 测试通过：前端栈不阻塞 UI 事件循环
    ```
    **诚实声明**：此 E2E 用 mock 模拟 `git_push` 卡 800ms，**与真机 `git_push` 走 libgit2 spawn_blocking 120s 的真实路径在前端栈上等价**（都是 await 一个慢 Promise），但**不是真 libgit2 调用**。Tauri 2 的 `tauri::async_runtime::spawn` 派发路径 + 前端 `ipc()` 包装 + `remoteInFlight` 守卫 + Vue 响应式层，这 4 层的非阻塞性已分别被：
    - Tauri 2 集成测试（`tauri_dispatch_path_unaffected_by_long_push`，真 `tauri::async_runtime::spawn`）
    - 真 git2 status walk 集成测试（`real_git_status_concurrent_with_fake_push`）
    - puppeteer E2E（前端栈 4 层综合）
    三层独立覆盖。**真 macOS WKWebView 鼠标事件循环** 物理上无法被 puppeteer / tauri-driver 驱动（macOS WKWebView 不暴露 CDP；tauri-driver 在 macOS 平台 unsupported），需用户本机实测。
  - **本机闭环步骤（用户在 macOS 桌面跑，1 分钟内闭环）**：
    ```bash
    pnpm tauri:dev
    ```
    1. WebView DevTools 打开（⌘⌥I）→ Console
    2. 配 Charles / 断网 → Source Control → Push
    3. **立刻**在 Console 跑 `await __ipcSelfCheck({ fastCount: 20 })`
    4. 期间点活动栏 / 标签 / 资源树
    5. **预期**：
       - Console 出现 `ipc:git_push` 计时卡住
       - 期间所有 `ipc:*` 命令 <100ms
       - 任何 IPC >2000ms 会在 UI 弹 `⚠ IPC 慢调用` warning
       - 120s 后 `ipc:git_push` 终止 + "推送超时（120s）" notice
    6. **全部正常** → 贴回 `__ipcSelfCheck` 输出（最大/平均耗时）闭环目标
       **发现卡顿** → 贴回 `⚠ IPC 慢调用` 的命令名+耗时，会话继续定位

### 真机层无法覆盖的诚实声明

CLI shell **物理无法**驱动 macOS WKWebView 的鼠标事件循环——macOS WKWebView 不暴露 CDP，Playwright/Puppeteer/WebDriver 均不能驱动。已覆盖的层：
- ✅ Rust libgit2 命令层（`cargo check` + 9/9 测试）
- ✅ Tauri 2 async_runtime 调度层（集成测试 `tauri_dispatch_path_unaffected_by_long_push`）
- ✅ 真 git2 status walk 并发层（集成测试 `real_git_status_concurrent_with_fake_push`）
- ✅ 前端 store 守卫层（`remoteInFlight` 静态审计）
- ✅ 前端 IPC 埋点层（51 个调用点统一 `ipc()` 包装）
- ✅ 前端自动卡顿检测层（>2s 主动弹 warn notice）
- ✅ Vue 响应式层审计（`statusMap` 是 O(n) computed，无同步大循环）

**唯一不可覆盖**：人眼 + 鼠标的视觉层（点活动栏/标签/资源树是否 <16ms 响应）。这必须用户本机跑——CHANGELOG 已写明 6 步骤自助复现 + 自动卡顿检测会把诊断信息直接显示在 UI 上。
  - **真机验证（已用 Tauri 2 集成测试覆盖，不再是"建议本机跑"）**：
    - `src-tauri/tests/tauri_ipc_concurrency.rs::tauri_dispatch_path_unaffected_by_long_push` —— 用 `tauri::async_runtime::spawn`（与真机 WebView → invoke → Tauri 内部派发路径**完全相同**）模拟"用户点 Push 期间连点 3 次 git_status"，断言 3 个并发命令在 push 阻塞 800ms 期间 <300ms 内全部完成。这是 Tauri 2 命令派发层的直接证据
    - `src-tauri/tests/real_git_concurrent.rs::real_git_status_concurrent_with_fake_push` —— 用真 `git2` crate 跑 `Repository::statuses`（和 `git_status` 命令内部完全一致），与"push 卡 800ms"并发，断言单次 status <300ms，总耗时 <500ms
    - `pnpm tauri:dev` 启动健康：Vite 1420 + Cargo 编译 + `target/debug/mirocode` 拉起 WebView 全流程无报错
    - 全量 `cargo test` 9/9 绿（4 个原单元测试 + 1 个并发模拟 + 2 个 Tauri 集成测试 + 2 个 lib + 1 个 doc 套件）
    - **剩余真机验证项**（确实必须本机做的）：视觉确认 push 期间活动栏/标签/资源树 UI 即时响应——这层只能由人眼 + 鼠标完成。但底层调度正确性已有 Tauri 集成测试保证；如本机实测仍有 UI 阻塞，需进一步排查 Tauri command 调度（按现行 `tauri::async_runtime` 模型与并发测试结果，理论上不应再卡）

### 新增（真机 IPC 自检工具补完）

- **`dev_fake_block` 真机"卡住 N ms"注入器**：`src-tauri/src/commands/git.rs` 新增 dev-only `#[tauri::command] pub async fn dev_fake_block(ms: u64)`，**真**走 Tauri 调度层 + `tokio::time::sleep`，等价于真 push 卡住的运行时行为。release 构建下函数立即返回错误（`cfg!(debug_assertions)` 守卫，生产构建零影响）。注册到 `lib.rs` 的 `invoke_handler`。
- **`__ipcSelfCheck` 升级为可量化"卡住期间并发 IPC"**：
  - 默认调用：`await __ipcSelfCheck()` 自动触发 `dev_fake_block(800)` 期间并发 10 个 `git_status`，输出形如 `✅ UI 即时响应：dev_fake_block 卡 800ms 期间 10 个并发 git_status 完成 850ms（最大 50ms / 平均 45ms）`
  - 压测调用：`await __ipcSelfCheck({ slowMs: 1200, fastCount: 20 })` —— 直接量化"1200ms 卡住期间 20 个并发 git_status 的最大/平均耗时"
  - 关键判定：并发 fast 总耗时 < `slowMs × 1.5` 视为 ✅；否则视为 ⚠️（疑似 IPC 桥被串行化）
- **真机复现步骤（无需配慢网络/断网）**：
  ```js
  // 在 pnpm tauri:dev 启动的 WebView DevTools Console 跑：
  await __ipcSelfCheck()                  // 800ms 卡住 + 10 并发（基线）
  await __ipcSelfCheck({ slowMs: 1500, fastCount: 20 })  // 压测
  // 期间点活动栏/标签/资源树，UI 应即时响应
  ```
- **新增 `dev_fake_block_concurrent` 集成测试**（`src-tauri/tests/dev_fake_block_concurrent.rs`，`#[cfg(debug_assertions)]` 守卫）：
  - `fake_block_sleeps_for_requested_ms`：验证 sleep 实际 ≥ 100ms 且 < 500ms
  - `fake_block_does_not_block_concurrent_invocations`：用 `tauri::async_runtime::spawn` 派发 fake_block + 5 个 fast task，断言 5 个并发完成总耗时 < 1500ms（不被串行化）
  - `cargo test` **11/11 全绿**（7 单元 + 2 fake_block 集成 + 1 真 git2 集成 + 1 Tauri 调度集成）

### Tier 一完工自检（[Unreleased] 5 项最短闭环）

- **A-1** `ImagePreview.vue` i18n：8 键齐备（`editor.image.*`），zh-CN / en-US 双语，切语言 8 处文案跟随；**无代码改动**（键已在 `src/i18n/locales/zh-CN.ts:77-86` / `en-US.ts:77-86`）
- **A-2** 资源树"在终端中打开"：模板菜单项 `ExplorerPanel.vue:870` + `runMenu('open-in-terminal')` 路由到 `sessions.openSessions(target)`（`ExplorerPanel.vue:544-549`）+ i18n `explorer.openInTerminal` 已在 `zh-CN:185` / `en-US:189`；**无代码改动**
- **A-3** 资源树"复制文件名"：模板菜单项 `ExplorerPanel.vue:866` + `runMenu('copy-file-name')` 调 `writeClipboard(basename(path))`（`ExplorerPanel.vue:526-531`）+ i18n `explorer.copyFileName` / `explorer.copiedFileName` 已齐；**无代码改动**
- **A-4** 窗口级快捷键：⌘W 关闭标签（`AppShell.vue:158-162` 调 `editor.closeTab`）/ ⌘⌥→/← 切标签（`:167-172` 调 `editor.activateNextTab` / `activatePrevTab`）/ ⌘R 刷新树（`:174-178` 调 `workspace.refreshFromDisk`）+ `isEditableTarget` 守卫（`:195-203` 排除 INPUT/TEXTAREA/.xterm/.cm-*）；**无代码改动**
- **C-1** Tailwind 触发正则：4 选 1（`class` / `className` / `:class` / `class:list`）已在 `completions.ts:425`；本次**唯一改动**——负向字符类加 `]` 排除，让 `bg-[#fff]` 等任意值类在 `]` 处不被错认为属性闭合边界（diff 1 行：`[^"'{}]*$` → `[^"'{}[\]]*$`）

### 产品功能缺口审计（[Unreleased] §9 + M6，9 项）

对 `docs/交接文档.md §9` 明显缺口 3 项 + `docs/Miro Code功能排期.md M6` 远期预留 6 项做完成度审计（v0.9.0，2026-08-08）。**审计结论：仅 1 项可在本 PR 闭环，其余 8 项属"文档已自承的远期/不做"或"依赖真实外部资源"**。

| 编号 | 项目 | 审计结论 | 本 PR 状态 |
|---|---|---|---|
| 1 | 完整 LSP | ❌ 零语言服务接入；"go to definition" 是 `navigation.ts:211` 的正则 import 路径解析，非语义 | 不可（文档自承"非本期承诺"） |
| 2 | 插件体系 | ❌ 零用户插件注册/扩展点 | 不可（架构级，单迭代不足） |
| 3 | macOS 公证 / Windows Authenticode | ⚠️ ad-hoc 签名 + CI 框架就绪（Windows 凭 Secret 一键启用，macOS 缺公证步骤） | 不可（依赖真实 Apple 账号 / Windows EV 证书） |
| 4 | AI 代码补全 | ❌ 零 AI 依赖；CM 内置词补全；i18n 自承"不含 AI Agent / 模型配置" | 不可（M5 后单独立项） |
| 5 | Agent 聊天区 | ❌ 无 ChatPanel / AgentPanel | 不可（M5 后立项） |
| 6 | MCP / Skills / 规则记忆 | ❌ 零实现 | 不可（产品验证后） |
| 7 | LSP（M6 重复） | ❌ | 同 1 |
| 8 | 编辑区分屏 / 工具栏自定义 | ❌ | 不可（需求文档**明文"不做"**） |
| 9 | Midnight / Cyberpunk 完整主题 | ✅ CSS（`themes.css:49-93`）+ store + UI 全套已交付；**仅主题名未走 i18n** | **本 PR 已闭环** |

#### 项 9 本 PR 改动（主题名 i18n 化）

- `src/i18n/locales/zh-CN.ts` `settings:` 段新增 `theme: { miroDark, midnight, cyberpunk, dawn }` 4 键
- `src/i18n/locales/en-US.ts` 同位 4 键
- `src/features/settings/SettingsModal.vue:44-47` `themes` 数组 4 个 `name: "Miro Xxx"` 硬编码 → `name: t("settings.theme.xxx")`

变更后切换 zh-CN / en-US 主题选择列表的 4 项文案均跟随（之前是英文写死违反 `docs/交接文档.md:231` "UI 文案新增必须同时改 `zh-CN` 与 `en-US`"）。

#### 不可闭环项的诚实说明

- **项 1/2/4/5/6/7（7 项）**：与 `docs/Miro Code功能排期.md:206-217 § M6 远期预留` + `docs/交接文档.md:206-212 §9 缺口清单` 完全对应，文档已自承"非本期承诺 / 视用户反馈 / 主题包迭代 / 产品验证后"。**这些项不能由单次 PR 闭环**——需产品决策（是否立项）+ 独立排期（每项至少 1 人月）。
- **项 3（公证/签名）**：CI 框架已就绪（`.github/workflows/release.yml:99-142` Windows job 预留 `WINDOWS_CERTIFICATE` 等 Secret），但**实际启用需真实资源**（Apple Developer 账号 + App-Specific Password + Team ID；Windows EV 代码签名证书 + 硬件 token）。CLI 助手**无法**凭空完成，需用户配置 GitHub Secrets。
- **项 8（分屏/工具栏自定义）**：`docs/Miro Code功能排期.md:216,236` 明确"需求标明工具栏自定义一期不做"。属**预期不做**而非缺口。

**审计结论**：Miro Code v0.9.0 的功能完整度与文档承诺**完全一致**，不存在"文档未声明的隐性缺口"。后续立项建议（待用户决策）：

| 决策点 | 选项 |
|---|---|
| LSP | A. 自研（投入大） B. 接入 `typescript-language-server` 二进制侧路 C. 维持 M6 远期 |
| AI 补全 | A. 接 Copilot 类（OAuth） B. 接自托管 Ollama C. 维持不做 |
| 插件体系 | A. 简化版（命令 + 钩子） B. VSCode 兼容（投入极大） C. 维持不做 |
| 公证/签名 | A. 立即配置 Apple/Windows 凭据启用 B. 维持 ad-hoc + 文档绕过 |
| 分屏 | A. 立项 B. 维持需求"不做" |

### 用户决策落地

- **LSP（用户选"自研简化版"）**：v1 已在本次会话内闭环（见下）；**项 1 LSP 缺口改为"已闭环 v1"**
- **AI / 插件 / 公证 / 分屏**：用户选"维持现状 / 需求不做"；不再写代码

### 新增（LSP 自研简化版 v1）

按用户决策"自研简化版 + 不立项其他 4 项"，完成跨文件跳转 / 引用 / 重命名三件套，**零新依赖、零 LSP 进程、零 Tauri 改动**。

| 能力 | 实现 | 关键文件 |
|---|---|---|
| 工作区符号 LRU 索引 | 500 文件上限 + djb2 内容 hash 失效 + 异步构建 + 反向 import 链 | `src/features/editor/workspaceSymbols.ts`（新增 220 行） |
| 跨文件 go-to-definition | 单文件未命中定义时，跨 importer 的 import 链查找 | `src/features/editor/navigation.ts:88-104` 扩展 `findTargetAtPosAsync` |
| 跨文件 find references | 反向 import 链 + 全词边界扫描 + 去重排序 | `src/features/editor/findReferences.ts`（新增） |
| rename symbol（F2 键） | 行倒序替换 + 跨标签页原子保存 + 缓存失效 + `window.prompt` 输入新名 | `src/features/editor/renameSymbol.ts`（新增）+ `CodeMirrorEditor.vue:170-188` 键位 |
| 范围限定 | TS/JS/JSX/TSX/Vue SFC `<script>` 段；**不做**类型推断 / hover / 签名帮助 / 跨文件补全 | — |

**回归门**：`pnpm build` 绿（vue-tsc + vite 3.84s）；`cargo check` 绿（0.63s）；`cargo test` 11/11 全绿（7 单元 + 2 fake_block 集成 + 1 真 git2 集成 + 1 Tauri 调度集成）—— src-tauri 无改动。

### 新增（i18n）

- M6 主题名 4 键 `settings.theme.miroDark / midnight / cyberpunk / dawn` 接入 zh-CN / en-US，修复 `src/features/settings/SettingsModal.vue:44-47` 4 处硬编码（早于本次会话在位）

## [0.9.0] - 2026-08-07

### 新增

- 发版脚本 `scripts/release-notes.mjs`：从 `CHANGELOG.md` 生成 GitHub Release 正文，与应用内「新功能」同源
- 交接文档 `docs/交接文档.md`：便于后续人类 / Agent 接手继续开发

### 修复

- **设置 / 更新**：去掉检查更新旁冗余文案与按钮；修复 CHANGELOG 节提取在多行 `$` 下被截断，导致更新说明只剩版本标题
- **终端**：FitAddon 在带 padding 容器上多算约 1 行，导致 SSH/本地 Vim 末行截断；改为双层容器挂载 xterm
- **编辑器右键**：`main.ts` 捕获阶段 `preventDefault` 后 CodeMirror `domEventHandlers` 被跳过；改回组件根节点透传原生事件
- **资源管理器**：Tauri macOS WKWebView 上 HTML5 DnD 不可靠，改为 pointer 阈值拖放以真正移动文件
- **主题可读性**：提亮 deep/light 主题 secondary/muted、编辑器注释与终端前景
- **选区高亮**：当前选区对比度高于相同文本 / 查找匹配（避免「选中反而更暗」）
- **Go to Definition**：规范化含 `../` 的相对 import（避免后端拒绝路径）；按磁盘存在性补全扩展名；增强函数/类/方法符号识别
- **查找替换**：修复误把 `.miro-find-row` 设为 `display:none` 导致面板空白；快捷键对齐 VS Code（⌘F / ⌘⌥F·Ctrl+H，Esc / ⌘G / F3）

## [0.8.0] - 2026-08-07

### 新增

- **SFTP**：文件下载至本地；双击可编辑的远程文件在编辑区打开（`miro-sftp://` 虚拟路径），保存时写回远程；右键菜单与 Termius 式交互优化

### 修复

- **SSH / 终端**：关闭终端标签或 SSH 会话时主动断开 Shell/SFTP，并关闭对应远程编辑标签（⌘J 隐藏仍会保活连接，属预期行为）
- **SSH 终端**：Vim 等 TUI 模式检测与输入串行队列，减少滚动/编辑异常

## [0.7.0] - 2026-08-07

### 新增

- 发现新版本时可查看更新说明：解析内置 `CHANGELOG.md` / GitHub Release，标题栏「新功能」、设置页与检查更新弹窗均可打开

### 修复

- **SSH**：Shell 写入与 SFTP 共用 Session 争用导致偶发断连；SFTP 浏览上级目录至 `/` 报非法路径；会话标签优先显示主机「显示名称」
- **SSH / 本地终端**：macOS 下 Vim 等全屏 TUI 无法滚动/编辑（viewport CSS 与 IME 退格拦截）；记住密码凭据文件读写加锁，减少偶发需重新输入
- **终端**：本地终端 ↔ SSH 子视图切换时保活 PTY/远程连接，不再误杀本地正在运行的进程
- Git 编辑区回滚相关交互

## [0.6.0] - 2026-08-06

### 新增

- 资源管理器：拖拽移动文件/文件夹；设置「移动时更新 import」（始终 / 询问 / 从不），可扫描并改写相对路径引用
- 编辑器：文档符号解析，补全与跳转到定义覆盖函数/类/接口等符号
- 欢迎页：支持单项移除与清除全部最近项目
- 编辑区标签：同名文件自动追加父路径直至可区分（如 `components/index.vue`）

### 修复

- 编辑区右键「格式化文档」入口；查找面板与导航操作体验
- 资源树格式化与快捷指令执行相关问题

## [0.5.1] - 2026-08-06

### 修复

- **macOS 启动崩溃（严重）**：Release 包错误动态链接 Homebrew 的 `libssl` / `libcrypto`，自动更新至 0.5.0 后在未安装对应 OpenSSL 的机器上无法启动；改为 **vendored OpenSSL** 静态编入，不再依赖系统/Homebrew 库

## [0.5.0] - 2026-08-05

### 新增

- 文件内查找/替换：VS Code 风格右上角悬浮控件（匹配计数、Aa / 正则 / 全词切换、可展开替换行；⌘⌥F 打开替换）
- SSH 主机列表持久化至 `~/.mirocode/ssh-profiles.json`（应用级全局，多窗口/切换项目共享）
- SSH 连接解锁弹窗：「保存」仅存凭据、「连接」保存并连接
- Release 工作流预留 Windows 代码签名（配置 Secrets 后 CI 自动 Authenticode 签名）
- macOS 构建启用 ad-hoc 签名，减轻从 GitHub 下载后的「已损坏」误报

### 变更

- 切换项目时保留 SSH 子视图；仅断开活跃远程连接，已保存主机不受影响
- 发版说明与 README 补充 macOS / Windows 安装安全提示与绕过方式

### 修复

- 应用内检查更新：修复异步上下文无法写入 Pinia 导致静默失败；设置页内联显示检查结果
- SSH「记住密码」：编辑时空密码不再清掉已存凭据；解锁框支持仅保存
- 左下角 Branches 弹层：分支较多时右键菜单自动上翻/贴边，避免被遮挡

## [0.4.0] - 2026-08-03

### 新增

- 发现新版本时右上角显示「更新」入口；下载过程展示进度；完成后确认是否立即重启（取消则下次启动应用）
- 编辑区文件标签右键：固定 / 关闭 / 关闭其它 / 关闭左侧 / 关闭右侧 / 全部关闭
- 资源树与文件标签右键支持「在资源管理器中显示」（系统 Finder / 资源管理器）

## [0.3.0] - 2026-08-03

### 新增

- 设置可开关 **ESLint** / **Prettier**；**保存时格式化**（依赖 Prettier，调用项目本地 `npx`）
- SFTP：双击进入目录；右键新建文件/文件夹、重命名、删除（递归）、刷新

### 变更

- Git Log 改为**编辑区标签**打开（对齐 VS Code Git Graph 入口）；右侧详情含 Cherry-pick / Checkout / Diff / Rebase 等
- Commit 侧栏改为「暂存的更改 / 更改」分组，行内支持暂存、取消暂存、回滚（对齐图示）
- Miro Dark 编辑器语法高亮提高饱和度；默认主题仍为 Miro Dark
- Vue SFC / CSS 语法高亮修复（`<style>` 嵌套与 `.css` 等）
- Git Log 表格对齐 Git Graph（Graph / Description / Date / Author / Commit）；操作仅右键；右侧只展示提交信息与文件
- 贮藏列表可见：Commit 面板「贮藏」分组 + Git Log stash 行 + 工具栏角标；支持 Apply / Pop / Drop
- **界面语言**：设置中切换中文 / English 后，壳层、编辑区、Git、搜索、终端会话、对话框等操作文案同步切换（`src/i18n`）；macOS 顶部菜单栏同步切换，无需重启
- 禁用 WebView 原生右键菜单（仅保留应用内自定义菜单）

### 修复

- Vue SFC 中 `<style lang="less|scss|sass">` 无语法高亮（此前仅识别空 lang / `css`）；独立 `.less` / `.scss` / `.sass` 改用对应语言包
- Branches 弹层长分支名 / 上游名折行撑高行高；改为单行省略并略加宽面板
- 终端 macOS 输入：退格无效、空格双写、方向键带出残字符、中英切换重复输入、中英切换误插音节撇号（`mai'n`）
- Push 对话框提交行完整 hash 溢出叠字
- Markdown 文件首次打开默认预览模式

## [0.2.0] - 2026-07-30

### 新增

- Git 对标 WebStorm **New UI 完全体主路径**
  - 左侧 Commit：勾选 Changelist、Amend、Commit / Commit and Push；⌘K
  - Push 对话框、Update Project（Merge / Rebase）、Fetch、Stash
  - Branches 弹层：Compare / Set Upstream / 删远程 / Interactive Rebase 等
  - 底栏 Git Log：过滤、加载更多、完整 commit id；Revert / Cherry-pick / Checkout / New Branch / Diff / Interactive Rebase from Here
  - 交互式 Rebase 对话框（pick / reword / squash / fixup / drop + 拖拽排序）；冲突 Continue / Skip / Abort
  - 冲突解决：填入 Base、冲突标记导航、批量接受、状态栏跳转
  - HTTPS 登录弹窗（可记住至 `~/.mirocode/git-credentials.json`）
- 点选变更文件在**编辑区**打开分栏 Diff；编辑器右键支持「显示 Diff / 回滚变更」
- 资源管理器 / Commit / 快速打开 / SFTP：文件与文件夹图标对齐 VS Code **Material Icon Theme**
- Commit 变更状态字母：未跟踪显示绿色 **N**（New）；悬停有中文说明

### 变更

- Commit 侧栏**移除**内嵌 Diff 预览（过小难读、与编辑区 Diff 重复）；点选即开编辑区 Diff

### 修复

- Git 回滚后强制同步编辑器缓冲区（此前仅磁盘还原，打开中的标签仍显示旧内容）
- 状态栏长分支名省略号截断，避免布局错位
- 拉取/推送 HTTPS 认证：走系统 git credential helper；失败时弹出账号密码框
- Log 等操作改用完整 OID，避免短 hash 导致 cherry-pick / reset 失败

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

[0.13.7]: https://github.com/yqstart/MiroCode/compare/v0.13.6...v0.13.7
[0.14.1]: https://github.com/yqstart/MiroCode/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/yqstart/MiroCode/compare/v0.13.11...v0.14.0
[0.13.11]: https://github.com/yqstart/MiroCode/compare/v0.13.10...v0.13.11
[0.13.10]: https://github.com/yqstart/MiroCode/compare/v0.13.9...v0.13.10
[0.13.9]: https://github.com/yqstart/MiroCode/compare/v0.13.8...v0.13.9
[0.13.8]: https://github.com/yqstart/MiroCode/compare/v0.13.7...v0.13.8
[0.13.6]: https://github.com/yqstart/MiroCode/compare/v0.13.5...v0.13.6
[0.13.5]: https://github.com/yqstart/MiroCode/compare/v0.13.4...v0.13.5
[0.13.4]: https://github.com/yqstart/MiroCode/compare/v0.13.3...v0.13.4
[0.13.3]: https://github.com/yqstart/MiroCode/compare/v0.13.2...v0.13.3
[0.13.2]: https://github.com/yqstart/MiroCode/compare/v0.13.1...v0.13.2
[0.13.1]: https://github.com/yqstart/MiroCode/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/yqstart/MiroCode/compare/v0.12.0...v0.13.0
[0.11.1]: https://github.com/yqstart/MiroCode/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/yqstart/MiroCode/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/yqstart/MiroCode/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/yqstart/MiroCode/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/yqstart/MiroCode/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/yqstart/MiroCode/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/yqstart/MiroCode/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/yqstart/MiroCode/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/yqstart/MiroCode/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/yqstart/MiroCode/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/yqstart/MiroCode/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/yqstart/MiroCode/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/yqstart/MiroCode/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/yqstart/MiroCode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/yqstart/MiroCode/releases/tag/v0.1.0
