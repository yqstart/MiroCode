<script setup lang="ts">
import { computed } from "vue";
import { resolveMaterialIconUrl } from "@/shared/fileIcons";

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

const src = computed(() =>
  resolveMaterialIconUrl(props.path, {
    isDir: props.isDir,
    expanded: props.expanded,
  }),
);
</script>

<template>
  <img
    v-if="src"
    class="file-type-icon"
    :src="src"
    :width="size"
    :height="size"
    alt=""
    draggable="false"
  />
  <span
    v-else
    class="file-type-icon placeholder"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
</template>

<style scoped>
.file-type-icon {
  flex-shrink: 0;
  display: block;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
}

.file-type-icon.placeholder {
  border-radius: 2px;
  background: color-mix(in srgb, var(--text-muted) 25%, transparent);
}
</style>
