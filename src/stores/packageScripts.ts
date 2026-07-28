import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  formatRunCommand,
  loadPackageScripts,
  type PackageManager,
  type PackageScriptItem,
} from "@/shared/packageScripts";
import { useSessionsStore } from "@/stores/sessions";
import { useWorkspaceStore } from "@/stores/workspace";

export const usePackageScriptsStore = defineStore("packageScripts", () => {
  const scripts = ref<PackageScriptItem[]>([]);
  const manager = ref<PackageManager>("npm");
  const packageName = ref<string | null>(null);
  const loading = ref(false);
  const loadedRoot = ref<string | null>(null);
  const hasPackageJson = ref(false);

  const available = computed(
    () => hasPackageJson.value && scripts.value.length > 0,
  );

  async function refresh(force = false) {
    const workspace = useWorkspaceStore();
    const root = workspace.rootPath;
    if (!root) {
      scripts.value = [];
      packageName.value = null;
      hasPackageJson.value = false;
      loadedRoot.value = null;
      return;
    }
    if (!force && loadedRoot.value === root && !loading.value) return;

    loading.value = true;
    try {
      const info = await loadPackageScripts(root);
      loadedRoot.value = root;
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
  }

  /** 打开本地终端并注入 `xxx run script` */
  async function runScript(name: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) {
      workspace.showNotice("请先打开项目");
      return;
    }
    await refresh();
    const hit = scripts.value.find((s) => s.name === name);
    if (!hit) {
      workspace.showNotice(`未找到脚本 ${name}`);
      return;
    }
    const command = formatRunCommand(manager.value, name);
    useSessionsStore().runInLocalTerminal(command, workspace.rootPath);
  }

  return {
    scripts,
    manager,
    packageName,
    loading,
    hasPackageJson,
    available,
    refresh,
    clear,
    runScript,
  };
});
