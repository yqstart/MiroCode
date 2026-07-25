import { computed, ref } from "vue";
import { defineStore } from "pinia";

export type SessionSubView = "local" | "remote" | "sftp";

export interface LocalTerminalSession {
  id: string;
  title: string;
  cwd: string | null;
}

const SESSIONS_TAB_ID = "miro://sessions";

export const useSessionsStore = defineStore("sessions", () => {
  const open = ref(false);
  const focused = ref(false);
  const subView = ref<SessionSubView>("local");
  const localTerminals = ref<LocalTerminalSession[]>([]);
  const activeLocalId = ref<string | null>(null);
  let seq = 0;

  const tabId = SESSIONS_TAB_ID;
  const isFocused = computed(() => open.value && focused.value);

  function ensureDefaultLocal(cwd: string | null) {
    if (localTerminals.value.length > 0) return;
    seq += 1;
    const id = `local-${seq}`;
    localTerminals.value.push({
      id,
      title: "终端 1",
      cwd,
    });
    activeLocalId.value = id;
  }

  function openSessions(cwd: string | null = null) {
    open.value = true;
    focused.value = true;
    subView.value = "local";
    ensureDefaultLocal(cwd);
  }

  function focusSessions() {
    if (!open.value) return;
    focused.value = true;
  }

  function blurSessions() {
    focused.value = false;
  }

  function closeSessions() {
    open.value = false;
    focused.value = false;
  }

  function setSubView(view: SessionSubView) {
    subView.value = view;
  }

  function addLocalTerminal(cwd: string | null = null) {
    seq += 1;
    const id = `local-${seq}`;
    const index = localTerminals.value.length + 1;
    localTerminals.value.push({
      id,
      title: `终端 ${index}`,
      cwd,
    });
    activeLocalId.value = id;
    subView.value = "local";
    openSessions(cwd);
  }

  function closeLocalTerminal(id: string) {
    const idx = localTerminals.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
    localTerminals.value.splice(idx, 1);
    if (activeLocalId.value === id) {
      const next = localTerminals.value[idx] || localTerminals.value[idx - 1] || null;
      activeLocalId.value = next?.id ?? null;
    }
    if (localTerminals.value.length === 0) {
      closeSessions();
    }
  }

  function activateLocal(id: string) {
    activeLocalId.value = id;
    subView.value = "local";
    focusSessions();
  }

  return {
    tabId,
    open,
    focused,
    isFocused,
    subView,
    localTerminals,
    activeLocalId,
    openSessions,
    focusSessions,
    blurSessions,
    closeSessions,
    setSubView,
    addLocalTerminal,
    closeLocalTerminal,
    activateLocal,
  };
});
