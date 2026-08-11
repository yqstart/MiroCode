<script setup lang="ts">
import { storeToRefs } from "pinia";
import {
  installPendingUpdate,
  showAvailableUpdateNotes,
} from "@/shared/appUpdate";
import { useAppUpdateStore } from "@/stores/appUpdate";
import { useWorkspaceStore } from "@/stores/workspace";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const appUpdate = useAppUpdateStore();
const workspace = useWorkspaceStore();
const { hasUpdate, availableVersion, downloading } = storeToRefs(appUpdate);

async function onViewNotes() {
  if (downloading.value) return;
  const action = await showAvailableUpdateNotes(true);
  if (action === "install") {
    await installPendingUpdate((message, ms) =>
      workspace.showNotice(message, ms),
    );
  }
}

async function onInstall() {
  if (downloading.value) return;
  await installPendingUpdate((message, ms) => workspace.showNotice(message, ms));
}
</script>

<template>
  <div v-if="hasUpdate" class="update-cluster">
    <button
      type="button"
      class="notes-btn"
      :disabled="downloading"
      :title="t('update.viewNotesTitle', { version: availableVersion ?? '' })"
      @click="onViewNotes"
    >
      {{ t("update.viewNotesShort") }}
    </button>
    <button
      type="button"
      class="update-badge"
      :disabled="downloading"
      :title="t('update.badgeTitle', { version: availableVersion ?? '' })"
      :aria-label="t('update.badgeTitle', { version: availableVersion ?? '' })"
      @click="onInstall"
    >
      {{ t("update.badge") }}
    </button>
  </div>
</template>

<style scoped>
.update-cluster {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-right: 10px;
}

.notes-btn {
  height: 24px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
  line-height: 1;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.notes-btn:hover:not(:disabled) {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
}

.notes-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.update-badge {
  flex-shrink: 0;
  height: 24px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-fg);
  background: var(--accent);
  line-height: 1;
  transition: filter var(--transition-fast), opacity var(--transition-fast);
}

.update-badge:hover:not(:disabled) {
  filter: brightness(1.08);
}

.update-badge:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
