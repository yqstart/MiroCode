<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { PLAIN_INPUT_ATTRS } from "@/shared/plainInput";
import { useGitStore } from "@/stores/git";
import { useSettingsStore } from "@/stores/settings";
import { useWorkspaceStore } from "@/stores/workspace";

const git = useGitStore();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const { log, loading, snapshot } = storeToRefs(git);
const { layout } = storeToRefs(settings);

const filter = ref("");
const ctx = ref<{ x: number; y: number; id: string } | null>(null);

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return log.value;
  return log.value.filter(
    (item) =>
      item.summary.toLowerCase().includes(q) ||
      item.author.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q) ||
      item.refs.some((r) => r.toLowerCase().includes(q)),
  );
});

async function ensureLog() {
  if (!workspace.rootPath || !snapshot.value.initialized) return;
  await git.loadLog(80);
}

onMounted(() => {
  if (layout.value.gitLogWindow.open) void ensureLog();
});

watch(
  () => layout.value.gitLogWindow.open,
  (open) => {
    if (open) void ensureLog();
  },
);

function onCtx(event: MouseEvent, id: string) {
  event.preventDefault();
  ctx.value = { x: event.clientX, y: event.clientY, id };
}

async function onCherryPick(id: string) {
  ctx.value = null;
  await git.cherryPick(id);
}

async function onReset(id: string, mode: "soft" | "mixed" | "hard") {
  ctx.value = null;
  await git.resetTo(id, mode);
}

async function onResetHardHere(id: string) {
  ctx.value = null;
  await git.resetTo(id, "hard");
}

async function onRevertCommit(id: string) {
  ctx.value = null;
  await git.revertCommit(id);
}

async function onCheckout(id: string) {
  ctx.value = null;
  await git.checkoutCommit(id);
}

async function onNewBranch(id: string) {
  ctx.value = null;
  const { promptInput } = await import("@/shared/promptDialog");
  const name = await promptInput({
    title: "从此提交新建分支",
    label: "分支名称",
    placeholder: "feature/from-commit",
    confirmText: "创建并切换",
  });
  if (!name?.trim()) return;
  await git.createBranchAt(name.trim(), id, true);
}

async function onCopy(id: string) {
  ctx.value = null;
  try {
    await navigator.clipboard.writeText(id);
    workspace.showNotice("已复制提交 hash");
  } catch {
    workspace.showNotice("复制失败");
  }
}

async function onShowDiff(id: string) {
  ctx.value = null;
  const item = log.value.find((c) => c.id === id);
  const path = item?.files?.[0];
  if (!path) {
    workspace.showNotice("该提交没有可预览的文件列表");
    return;
  }
  // 用分支 tip 对比：当前 HEAD vs 该提交（取文件在提交侧）
  if (!snapshot.value.branch) return;
  try {
    const { gitBranchSides } = await import("@/shared/gitApi");
    if (!workspace.rootPath) return;
    const sides = await gitBranchSides(
      workspace.rootPath,
      id,
      snapshot.value.branch,
      path,
    );
    const { useCompareStore } = await import("@/stores/compare");
    const compare = useCompareStore();
    const tabId = `log-diff-${Date.now()}`;
    compare.tabs.push({
      id: tabId,
      kind: "diff",
      path: sides.path,
      title: `${sides.path} · ${id.slice(0, 7)}`,
      leftLabel: sides.leftLabel.slice(0, 12),
      rightLabel: sides.rightLabel,
      left: sides.left,
      right: sides.right,
      editableRight: false,
    });
    compare.activate(tabId);
  } catch (error) {
    workspace.showNotice(
      error instanceof Error ? error.message : String(error),
      3200,
    );
  }
}

async function onInteractiveRebase(id: string) {
  ctx.value = null;
  const item = log.value.find((c) => c.id === id);
  const onto = item?.parents?.[0];
  if (!onto) {
    workspace.showNotice("无法确定 onto（需要有父提交）");
    return;
  }
  const { openInteractiveRebase } = await import("@/shared/gitRebaseDialog");
  await openInteractiveRebase({
    onto,
    title: `Interactive Rebase from ${id.slice(0, 7)}`,
  });
}
</script>

<template>
  <div class="log-panel" @click="ctx = null">
    <div v-if="!snapshot.initialized" class="empty">尚未初始化 Git 仓库</div>
    <template v-else>
      <div class="toolbar">
        <input
          v-model="filter"
          v-bind="PLAIN_INPUT_ATTRS"
          class="filter"
          type="text"
          placeholder="过滤消息 / 作者 / hash…"
        />
        <button type="button" class="link" @click="git.loadMoreLog()">
          加载更多
        </button>
      </div>

      <div v-if="loading && !log.length" class="empty">加载提交历史…</div>
      <div v-else-if="!filtered.length" class="empty">暂无提交记录</div>
      <div v-else class="log-list">
        <div
          v-for="(item, index) in filtered"
          :key="item.id"
          class="log-row"
          :class="{ unpushed: item.unpushed }"
          @contextmenu="onCtx($event, item.id)"
        >
          <div class="graph" aria-hidden="true">
            <span
              class="node"
              :class="{
                head: index === 0 && !filter,
                merge: (item.parents?.length ?? 0) > 1,
              }"
            />
            <span v-if="index < filtered.length - 1" class="line" />
          </div>
          <div class="body">
            <div class="main">
              <span class="id" :title="item.id">{{ item.id.slice(0, 7) }}</span>
              <span
                v-for="refName in item.refs"
                :key="refName"
                class="ref"
                >{{ refName }}</span
              >
              <span v-if="item.unpushed" class="badge">未推送</span>
              <span class="summary">{{ item.summary }}</span>
            </div>
            <div class="meta">
              <span>{{ item.author }} · {{ item.time }}</span>
              <span v-if="item.files?.length" class="files">
                {{ item.files.length }} 个文件
              </span>
              <button type="button" class="link" @click="onCherryPick(item.id)">
                Cherry-pick
              </button>
            </div>
            <div v-if="item.files?.length" class="file-list">
              <span v-for="f in item.files.slice(0, 8)" :key="f" class="file">{{
                f
              }}</span>
              <span v-if="item.files.length > 8" class="file more">
                +{{ item.files.length - 8 }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="danger-bar">
        <button type="button" class="danger-btn" @click="git.undoCommit()">
          撤销最近提交
        </button>
        <button type="button" class="danger-btn" @click="git.resetHard()">
          硬重置 HEAD…
        </button>
      </div>
    </template>

    <Teleport to="body">
      <div
        v-if="ctx"
        class="ctx"
        :style="{ left: `${ctx.x}px`, top: `${ctx.y}px` }"
        @click.stop
      >
        <button type="button" @click="onCheckout(ctx.id)">Checkout Revision…</button>
        <button type="button" @click="onNewBranch(ctx.id)">
          New Branch from Here…
        </button>
        <button type="button" @click="onCopy(ctx.id)">Copy Revision</button>
        <button type="button" @click="onShowDiff(ctx.id)">Show Diff…</button>
        <button type="button" @click="onCherryPick(ctx.id)">Cherry-pick</button>
        <button type="button" @click="onRevertCommit(ctx.id)">
          Revert Commit…
        </button>
        <button type="button" @click="onInteractiveRebase(ctx.id)">
          Interactive Rebase from Here…
        </button>
        <button type="button" @click="onReset(ctx.id, 'soft')">Reset Soft…</button>
        <button type="button" @click="onReset(ctx.id, 'mixed')">
          Reset Mixed…
        </button>
        <button type="button" class="danger" @click="onResetHardHere(ctx.id)">
          Reset Hard to Here…
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.log-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
.toolbar {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-subtle);
}
.filter {
  flex: 1;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-app);
  color: var(--text-primary);
  font-size: 12px;
}
.toolbar .link {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--accent);
}
.toolbar .link:hover {
  text-decoration: underline;
}
.empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  font-size: 13px;
}
.log-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 0;
}
.log-row {
  display: flex;
  gap: 10px;
  padding: 6px 12px;
}
.log-row:hover {
  background: var(--accent-soft);
}
.log-row.unpushed .summary {
  font-weight: 600;
}
.graph {
  width: 14px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.node {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  margin-top: 5px;
}
.node.head {
  background: var(--accent);
}
.node.merge {
  background: var(--warning);
}
.line {
  flex: 1;
  width: 2px;
  background: var(--border-subtle);
  margin-top: 2px;
}
.body {
  min-width: 0;
  flex: 1;
}
.main {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
  font-size: 13px;
}
.id {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--accent);
}
.ref {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent);
}
.badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--warning) 20%, transparent);
  color: var(--warning);
}
.summary {
  color: var(--text-primary);
}
.meta {
  margin-top: 2px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
  align-items: center;
}
.meta .link {
  color: var(--accent);
}
.meta .link:hover {
  text-decoration: underline;
}
.file-list {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.file {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--bg-app);
  color: var(--text-muted);
  font-family: var(--font-mono);
}
.file.more {
  color: var(--accent);
}
.danger-bar {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid var(--border-subtle);
}
.danger-btn {
  font-size: 11px;
  color: var(--danger);
  padding: 4px 8px;
  border-radius: 6px;
}
.danger-btn:hover {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
.ctx {
  position: fixed;
  z-index: 90;
  min-width: 220px;
  padding: 4px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
}
.ctx button {
  text-align: left;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-primary);
}
.ctx button:hover {
  background: var(--accent-soft);
}
.ctx button.danger {
  color: var(--danger);
}
</style>
