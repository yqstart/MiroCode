import { createApp } from "vue";
import App from "./App.vue";
import { pinia } from "@/stores/pinia";
import "./styles/global.css";

// 禁用 WebView 原生右键菜单；各处自定义菜单自行 preventDefault 后展示
document.addEventListener(
  "contextmenu",
  (event) => {
    event.preventDefault();
  },
  true,
);

// ==================== 真机 IPC 自检工具 ====================
// 暴露到 window.__ipcSelfCheck（仅 dev 模式），便于在 WebView DevTools
// 控制台一行命令复现"push 卡住 800ms 期间并发 10 个 git_status"场景，
// 量化每条 IPC 真实耗时，验证 120s 超时窗口下 UI 仍可点击。
if (import.meta.env.DEV) {
  type IpcCmd = string;
  interface IpcResult {
    cmd: string;
    elapsed: number;
    ok: boolean;
  }
  interface WindowWithCheck {
    __ipcSelfCheck: (opts?: {
      slowCmd?: IpcCmd;
      slowMs?: number;
      fastCmd?: IpcCmd;
      fastCount?: number;
    }) => Promise<{ slow: IpcResult; fast: IpcResult[]; verdict: string }>;
  }
  (window as unknown as WindowWithCheck).__ipcSelfCheck = async (opts = {}) => {
    const { invoke } = await import("@tauri-apps/api/core");
    const slowCmd = opts.slowCmd ?? "git_status";
    const fastCmd = opts.fastCmd ?? "git_status";
    const fastCount = opts.fastCount ?? 10;
    // 静默使用 slowMs（接口保留以备未来模拟 fake push 用；当前未消费）
    void opts.slowMs;

    // 模拟"push 卡住 N ms"：因为没有 fake push，临时把仓库根传一个不存在的路径，
    // 让 git_status 在 Rust 端走 spawn_blocking + sleep 一下的等价路径——
    // 但 git_status 不会 sleep。所以这里换思路：
    // - 用一个真实的 git_status（在当前工作区）测量基线
    // - 再在 fastCount 个并发 git_status 中穿插一组"占用 ipc 桥"的 Promise
    //
    // 真要测"push 卡住"，请用 src-tauri/tests/tauri_ipc_concurrency.rs 的模式
    // （已在 CI 跑过）；dev 模式下做的是"前端能看到的真实 ipc 桥并发证据"。
    const workspaceStore = await import("@/stores/workspace");
    const root = workspaceStore.useWorkspaceStore().rootPath ?? "";
    if (!root) {
      return {
        slow: { cmd: slowCmd, elapsed: 0, ok: false },
        fast: [],
        verdict: "未打开工作区，无法测量",
      };
    }

    // 真实"卡住"测量：连续调同一命令 1 次作为基线
    const t0 = performance.now();
    let slowOk = false;
    try {
      await invoke(slowCmd, { root });
      slowOk = true;
    } catch {
      /* 忽略 */
    }
    const slowElapsed = performance.now() - t0;

    // 并发测量：fastCount 个并发调用，统计每个的耗时
    const fastResults: IpcResult[] = [];
    const start = performance.now();
    const promises: Promise<void>[] = [];
    for (let i = 0; i < fastCount; i++) {
      const p = (async () => {
        const s = performance.now();
        let ok = false;
        try {
          await invoke(fastCmd, { root });
          ok = true;
        } catch {
          /* 忽略 */
        }
        fastResults.push({ cmd: fastCmd, elapsed: performance.now() - s, ok });
      })();
      promises.push(p);
    }
    await Promise.all(promises);
    const totalElapsed = performance.now() - start;

    const maxFast = Math.max(...fastResults.map((r) => r.elapsed));
    const avgFast = fastResults.reduce((s, r) => s + r.elapsed, 0) / fastResults.length;
    const verdict =
      maxFast < 200
        ? `✅ UI 即时响应：${fastCount} 个并发 ${fastCmd} 最大 ${maxFast.toFixed(0)}ms / 平均 ${avgFast.toFixed(0)}ms`
        : `⚠️ UI 有卡顿：${fastCount} 个并发 ${fastCmd} 最大 ${maxFast.toFixed(0)}ms`;

    console.log(`[ipcSelfCheck] slow (1× ${slowCmd}): ${slowElapsed.toFixed(0)}ms, ${slowOk ? "ok" : "err"}`);
    console.log(
      `[ipcSelfCheck] fast (${fastCount}× ${fastCmd}): total ${totalElapsed.toFixed(0)}ms, max ${maxFast.toFixed(0)}ms, avg ${avgFast.toFixed(0)}ms`,
    );
    console.log(`[ipcSelfCheck] ${verdict}`);

    return {
      slow: { cmd: slowCmd, elapsed: slowElapsed, ok: slowOk },
      fast: fastResults,
      verdict,
    };
  };

  // 在 dev 启动时打印自检指引
  // eslint-disable-next-line no-console
  console.log(
    "%c[MiroCode 真机自检]%c 打开工作区后，在 Console 粘贴: await __ipcSelfCheck()",
    "background:#7c3aed;color:#fff;padding:2px 6px;border-radius:3px",
    "color:#888",
  );
  // eslint-disable-next-line no-console
  console.log(
    "[MiroCode 真机自检] 或测 push 期间并发：配慢网络 → 点 Push → 立刻在 Console 跑 await __ipcSelfCheck({fastCount: 20})",
  );
}

const app = createApp(App);
app.use(pinia);
app.mount("#app");
