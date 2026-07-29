<script setup lang="ts">
import { computed } from "vue";
import { Folder, FolderOpen } from "lucide-vue-next";
import { resolveFileIcon } from "@/shared/fileIcons";

const props = withDefaults(
  defineProps<{
    path: string;
    isDir?: boolean;
    expanded?: boolean;
    size?: number;
  }>(),
  {
    isDir: false,
    expanded: false,
    size: 14,
  },
);

const fileSpec = computed(() =>
  props.isDir ? null : resolveFileIcon(props.path),
);
</script>

<template>
  <FolderOpen
    v-if="isDir && expanded"
    :size="size"
    class="file-type-icon folder"
  />
  <Folder
    v-else-if="isDir"
    :size="size"
    class="file-type-icon folder"
  />
  <component
    :is="fileSpec!.icon"
    v-else
    :size="size"
    class="file-type-icon"
    :style="{ color: fileSpec!.color }"
  />
</template>

<style scoped>
.file-type-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.file-type-icon.folder {
  color: var(--accent);
  opacity: 0.85;
}
</style>
