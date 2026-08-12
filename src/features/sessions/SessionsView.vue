<script setup lang="ts">
import { Plus, TerminalSquare, X } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import LocalTerminal from "@/features/sessions/LocalTerminal.vue";
import { useSessionsStore } from "@/stores/sessions";
import { useWorkspaceStore } from "@/stores/workspace";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const sessions = useSessionsStore();
const workspace = useWorkspaceStore();
const { localTerminals, activeLocalId } = storeToRefs(sessions);

function onAddLocal() {
  sessions.addLocalTerminal(workspace.rootPath);
}
</script>

<template>
  <div class="sessions">
    <!-- 本地终端顶栏 -->
    <header class="subtabs">
      <button
        v-for="term in localTerminals"
        :key="term.id"
        type="button"
        class="subtab"
        :class="{ active: term.id === activeLocalId }"
        @click="sessions.activateLocal(term.id)"
      >
        <span>{{ term.title }}</span>
        <span
          class="close"
          :title="t('sessions.closeTerminal')"
          @click.stop="sessions.closeLocalTerminal(term.id)"
        >
          <X :size="12" />
        </span>
      </button>
      <button
        type="button"
        class="add"
        :title="t('sessions.newLocalTitle')"
        @click="onAddLocal"
      >
        <Plus :size="14" />
      </button>
    </header>

    <div class="body">
      <LocalTerminal
        v-for="term in localTerminals"
        v-show="term.id === activeLocalId"
        :key="term.id"
        :session-id="term.id"
        :cwd="term.cwd"
        :active="term.id === activeLocalId"
      />
      <div v-if="!localTerminals.length" class="empty">
        <TerminalSquare :size="28" :stroke-width="1.5" class="empty-icon" />
        <p>{{ t("sessions.localEmpty") }}</p>
        <button type="button" class="cta" @click="onAddLocal">
          {{ t("sessions.newTerminal") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sessions {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-app);
}

.subtabs {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
  min-width: 0;
}

.subtab {
  height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 10px;
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.subtab:hover {
  color: var(--text-primary);
  background: var(--accent-soft);
}

.subtab.active {
  color: var(--accent);
  background: var(--accent-soft);
}

.subtab .close {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  opacity: 0.55;
}

.subtab .close:hover {
  opacity: 1;
  background: var(--bg-app);
}

.add {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}

.add:hover {
  color: var(--accent);
  background: var(--accent-soft);
}

.body {
  flex: 1;
  min-height: 0;
  position: relative;
}

.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-secondary);
  text-align: center;
  padding: 24px;
}

.empty-icon {
  opacity: 0.7;
}

.cta {
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
}
</style>
