import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  formatRunCommand,
  loadPackageScripts,
  type PackageManager,
  type PackageScriptItem,
} from "@/shared/packageScripts";
import {
  loadCustomScriptsForRoot,
  setCustomScriptsForRoot,
  type CustomScriptItem,
} from "@/shared/customScripts";
import { loadPinnedForRoot, setPinnedForRoot } from "@/shared/pinnedScripts";
import { useSessionsStore } from "@/stores/sessions";
import { useWorkspaceStore } from "@/stores/workspace";

export interface PackageScriptListItem extends PackageScriptItem {
  custom: boolean;
}

export type SaveCustomScriptResult =
  | "saved"
  | "emptyName"
  | "emptyCommand"
  | "duplicate"
  | "noWorkspace";

export const usePackageScriptsStore = defineStore("packageScripts", () => {
  const scripts = ref<PackageScriptItem[]>([]);
  const customScripts = ref<CustomScriptItem[]>([]);
  const manager = ref<PackageManager>("npm");
  const packageName = ref<string | null>(null);
  const loading = ref(false);
  const loadedRoot = ref<string | null>(null);
  const hasPackageJson = ref(false);
  /** 当前项目勾选展示到终端顶栏的脚本名集合 */
  const pinned = ref<string[]>([]);
  /** 防止同一脚本在刷新/打开终端期间被重复触发。 */
  const running = new Set<string>();

  const allScripts = computed<PackageScriptListItem[]>(() => [
    ...scripts.value.map((item) => ({ ...item, custom: false })),
    ...customScripts.value.map((item) => ({ ...item, custom: true })),
  ]);

  const available = computed(() => allScripts.value.length > 0);

  /** 勾选子集（渲染终端顶栏芯片）；脚本被删的孤儿名自动过滤 */
  const pinnedScripts = computed(() =>
    allScripts.value.filter((s) => pinned.value.includes(s.name)),
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
      customScripts.value = [];
      return;
    }
    if (!force && loadedRoot.value === root && !loading.value) return;

    loading.value = true;
    try {
      const info = await loadPackageScripts(root);
      // 等待期间已切换工作区：旧项目结果作废，不得覆盖新项目的脚本芯片
      if (workspace.rootPath !== root) return;
      loadedRoot.value = root;
      customScripts.value = loadCustomScriptsForRoot(root);
      pinned.value = loadPinnedForRoot(root);
      if (!info) {
        scripts.value = [];
        packageName.value = null;
        hasPackageJson.value = false;
        manager.value = "npm";
        return;
      }
      hasPackageJson.value = true;
      packageName.value = info.packageName;
      manager.value = info.manager;
      scripts.value = info.scripts;
    } finally {
      // 只有仍属当前工作区的刷新才复位 loading（新工作区的 refresh 会自己管理）
      if (workspace.rootPath === root) loading.value = false;
    }
  }

  function clear() {
    scripts.value = [];
    customScripts.value = [];
    packageName.value = null;
    hasPackageJson.value = false;
    manager.value = "npm";
    loadedRoot.value = null;
    pinned.value = [];
  }

  /** 添加自定义脚本并按当前工作区落盘，不改写项目 package.json。 */
  function saveCustomScript(name: string, command: string): SaveCustomScriptResult {
    const workspace = useWorkspaceStore();
    const root = workspace.rootPath;
    if (!root) return "noWorkspace";

    const normalizedName = name.trim();
    const normalizedCommand = command.trim();
    if (!normalizedName) return "emptyName";
    if (!normalizedCommand) return "emptyCommand";
    if (allScripts.value.some((item) => item.name === normalizedName)) {
      return "duplicate";
    }

    customScripts.value = [
      ...customScripts.value,
      { name: normalizedName, script: normalizedCommand },
    ];
    setCustomScriptsForRoot(root, customScripts.value);
    return "saved";
  }

  /** 删除自定义脚本，同时清理它在终端顶栏的快捷执行勾选。 */
  function deleteCustomScript(name: string): boolean {
    const workspace = useWorkspaceStore();
    const root = workspace.rootPath;
    if (!root) return false;
    const next = customScripts.value.filter((item) => item.name !== name);
    if (next.length === customScripts.value.length) return false;

    customScripts.value = next;
    setCustomScriptsForRoot(root, next);
    if (pinned.value.includes(name)) {
      pinned.value = pinned.value.filter((item) => item !== name);
      setPinnedForRoot(root, pinned.value);
    }
    return true;
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
  async function runScript(name: string, custom = false) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) {
      workspace.showNotice("请先打开项目");
      return;
    }
    const key = `${workspace.rootPath}:${custom ? "custom" : "package"}:${name}`;
    if (running.has(key)) return;
    running.add(key);
    try {
      await refresh();
      const hit = custom
        ? customScripts.value.find((s) => s.name === name)
        : scripts.value.find((s) => s.name === name);
      if (!hit) {
        workspace.showNotice(`未找到脚本 ${name}`);
        return;
      }
      const command = custom ? hit.script : formatRunCommand(manager.value, name);
      useSessionsStore().runInLocalTerminal(command, workspace.rootPath);
    } finally {
      running.delete(key);
    }
  }

  return {
    scripts,
    customScripts,
    allScripts,
    manager,
    packageName,
    loading,
    hasPackageJson,
    available,
    pinned,
    pinnedScripts,
    refresh,
    clear,
    saveCustomScript,
    deleteCustomScript,
    togglePinned,
    runScript,
  };
});
