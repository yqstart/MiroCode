import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";

export const useAppUpdateStore = defineStore("appUpdate", () => {
  /** 远端可用版本；null 表示当前无待处理更新 */
  const availableVersion = ref<string | null>(null);
  const currentVersion = ref<string | null>(null);
  const downloading = ref(false);
  const downloadedBytes = ref(0);
  const contentLength = ref<number | null>(null);

  const hasUpdate = computed(() => Boolean(availableVersion.value));

  const progressPercent = computed(() => {
    const total = contentLength.value;
    if (!total || total <= 0) return null;
    return Math.min(100, Math.round((downloadedBytes.value / total) * 100));
  });

  function setAvailable(version: string, current: string) {
    availableVersion.value = version;
    currentVersion.value = current;
  }

  function clearAvailable() {
    availableVersion.value = null;
    currentVersion.value = null;
  }

  function beginDownload() {
    downloading.value = true;
    downloadedBytes.value = 0;
    contentLength.value = null;
  }

  function onDownloadEvent(event: DownloadEvent) {
    if (event.event === "Started") {
      contentLength.value = event.data.contentLength ?? null;
      downloadedBytes.value = 0;
      return;
    }
    if (event.event === "Progress") {
      downloadedBytes.value += event.data.chunkLength;
    }
  }

  function endDownload() {
    downloading.value = false;
  }

  return {
    availableVersion,
    currentVersion,
    downloading,
    downloadedBytes,
    contentLength,
    hasUpdate,
    progressPercent,
    setAvailable,
    clearAvailable,
    beginDownload,
    onDownloadEvent,
    endDownload,
  };
});
