<script setup lang="ts">
import { storeToRefs } from "pinia";
import { installPendingUpdate } from "@/shared/appUpdate";
import { useAppUpdateStore } from "@/stores/appUpdate";
import { useWorkspaceStore } from "@/stores/workspace";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const appUpdate = useAppUpdateStore();
const workspace = useWorkspaceStore();
const { hasUpdate, availableVersion, downloading } = storeToRefs(appUpdate);

async function onClick() {
  if (downloading.value) return;
  await installPendingUpdate((message, ms) => workspace.showNotice(message, ms));
}
</script>

<template>
  <button
    v-if="hasUpdate"
    type="button"
    class="update-badge"
    :disabled="downloading"
    :title="t('update.badgeTitle', { version: availableVersion ?? '' })"
    :aria-label="t('update.badgeTitle', { version: availableVersion ?? '' })"
    @click="onClick"
  >
    {{ t("update.badge") }}
  </button>
</template>

<style scoped>
.update-badge {
  flex-shrink: 0;
  height: 24px;
  padding: 0 10px;
  margin-right: 10px;
  border-radius: 6px;
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
