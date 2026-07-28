import { ref } from "vue";
import { defineStore } from "pinia";

export const useUiStore = defineStore("ui", () => {
  const settingsOpen = ref(false);

  function openSettings() {
    settingsOpen.value = true;
  }

  function closeSettings() {
    settingsOpen.value = false;
  }

  function toggleSettings() {
    settingsOpen.value = !settingsOpen.value;
  }

  return {
    settingsOpen,
    openSettings,
    closeSettings,
    toggleSettings,
  };
});
