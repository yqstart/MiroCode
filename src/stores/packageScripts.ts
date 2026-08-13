import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  formatRunCommand,
  loadPackageScripts,
  type PackageManager,
  type PackageScriptItem,
} from "@/shared/packageScripts";
import { loadPinnedForRoot, setPinnedForRoot } from "@/shared/pinnedScripts";
import { useSessionsStore } from "@/stores/sessions";
import { useWorkspaceStore } from "@/stores/workspace";

export const usePackageScriptsStore = defineStore("packageScripts", () => {
  const scripts = ref<PackageScriptItem[]>([]);
  const manager = ref<PackageManager>("npm");
  const packageName = ref<string | null>(null);
  const loading = ref(false);
  const loadedRoot = ref<string | null>(null);
  const hasPackageJson = ref(false);
  /** 当前项目勾选展示到终端顶栏的脚本名集合 */
  const pinned = ref<string[]>([]);
  /** 防止同一脚本在刷新/打开终端期间被重复触发。 */
  const running = new Set<string>();

  const available = computed(
    () => hasPackageJson.value && scripts.value.length > 0,
  );

  /** 勾选子集（渲染终端顶栏芯片）；脚本被删的孤儿名自动过滤 */
  const pinnedScripts = computed(() =>
    scripts.value.filter((s) => pinned.value.includes(s.name)),
  );

  async function refresh(force = false) {
    const workspace = useWorkspaceStore();
    const root = workspace.rootPath;
    if (!root) {
      scripts.value = [];
      packageName.value = null;
      hasPackageJson.value = false;
      loadedRoot.value = null;
      pinned.value = [];
      return;
    }
    if (!force && loadedRoot.value === root && !loading.value) return;

    loading.value = true;
    try {
      const info = await loadPackageScripts(root);
      loadedRoot.value = root;
      pinned.value = loadPinnedForRoot(root);
      if (!info) {
        scripts.value = [];
        packageName.value = null;
        hasPackageJson.value = false;
        return;
      }
      hasPackageJson.value = true;
      packageName.value = info.packageName;
      manager.value = info.manager;
      scripts.value = info.scripts;
    } finally {
      loading.value = false;
    }
  }

  function clear() {
    scripts.value = [];
    packageName.value = null;
    hasPackageJson.value = false;
    loadedRoot.value = null;
    pinned.value = [];
  }

  /** 勾选 / 取消勾选「展示到终端顶栏」，立即持久化（按项目） */
  function togglePinned(name: string) {
    const workspace = useWorkspaceStore();
    const root = workspace.rootPath;
    if (!root) return;
    pinned.value = pinned.value.includes(name)
      ? pinned.value.filter((n) => n !== name)
      : [...pinned.value, name];
    setPinnedForRoot(root, pinned.value);
  }

  /** 打开本地终端并注入 `xxx run script` */
  async function runScript(name: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) {
      workspace.showNotice("请先打开项目");
      return;
    }
    const key = `${workspace.rootPath}:${name}`;
    if (running.has(key)) return;
    running.add(key);
    try {
      await refresh();
      const hit = scripts.value.find((s) => s.name === name);
      if (!hit) {
        workspace.showNotice(`未找到脚本 ${name}`);
        return;
      }
      const command = formatRunCommand(manager.value, name);
      useSessionsStore().runInLocalTerminal(command, workspace.rootPath);
    } finally {
      running.delete(key);
    }
  }

  return {
    scripts,
    manager,
    packageName,
    loading,
    hasPackageJson,
    available,
    pinned,
    pinnedScripts,
    refresh,
    clear,
    togglePinned,
    runScript,
  };
});
