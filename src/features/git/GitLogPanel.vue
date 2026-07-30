<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  Copy,
  GitBranch,
  GitCommitHorizontal,
  RotateCcw,
  Cherry,
} from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { PLAIN_INPUT_ATTRS } from "@/shared/plainInput";
import { useGitLogStore } from "@/stores/gitLog";
import { useGitStore } from "@/stores/git";
import { useWorkspaceStore } from "@/stores/workspace";
import type { GitCommitInfo } from "@/shared/gitApi";

const git = useGitStore();
const gitLog = useGitLogStore();
const workspace = useWorkspaceStore();
const { log, loading, snapshot } = storeToRefs(git);
const { selectedId, open: logOpen } = storeToRefs(gitLog);

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

const selected = computed<GitCommitInfo | null>(() => {
  if (!selectedId.value) return filtered.value[0] ?? null;
  return (
    log.value.find((c) => c.id === selectedId.value) ??
    filtered.value[0] ??
    null
  );
});

async function ensureLog() {
  if (!workspace.rootPath || !snapshot.value.initialized) return;
  await git.loadLog(100);
  if (!selectedId.value && log.value[0]) {
    gitLog.selectCommit(log.value[0].id);
  }
}

onMounted(() => {
  if (logOpen.value) void ensureLog();
});

watch(logOpen, (open) => {
  if (open) void ensureLog();
});

watch(filtered, (list) => {
  if (!list.length) return;
  if (!selectedId.value || !list.some((c) => c.id === selectedId.value)) {
    gitLog.selectCommit(list[0].id);
  }
});

function selectRow(id: string) {
  gitLog.selectCommit(id);
  ctx.value = null;
}

function onCtx(event: MouseEvent, id: string) {
  event.preventDefault();
  gitLog.selectCommit(id);
  ctx.value = { x: event.clientX, y: event.clientY, id };
}

async function onCherryPick(id: string) {
  ctx.value = null;
  await git.cherryPick(id);
  await ensureLog();
}

async function onReset(id: string, mode: "soft" | "mixed" | "hard") {
  ctx.value = null;
  await git.resetTo(id, mode);
  await ensureLog();
}

async function onResetHardHere(id: string) {
  ctx.value = null;
  await git.resetTo(id, "hard");
  await ensureLog();
}

async function onRevertCommit(id: string) {
  ctx.value = null;
  await git.revertCommit(id);
  await ensureLog();
}

async function onCheckout(id: string) {
  ctx.value = null;
  await git.checkoutCommit(id);
  await ensureLog();
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
  await ensureLog();
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

async function onShowDiff(id: string, filePath?: string) {
  ctx.value = null;
  const item = log.value.find((c) => c.id === id);
  const path = filePath ?? item?.files?.[0];
  if (!path) {
    workspace.showNotice("该提交没有可预览的文件列表");
    return;
  }
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
    gitLog.blurLog();
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

function refClass(name: string) {
  if (name.startsWith("origin/") || name.includes("/")) return "ref remote";
  if (name === "HEAD" || name.startsWith("HEAD")) return "ref head";
  return "ref local";
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
          placeholder="过滤消息 / 作者 / hash / 分支…"
        />
        <button type="button" class="link" @click="git.loadMoreLog()">
          加载更多
        </button>
        <button type="button" class="link" @click="ensureLog()">刷新</button>
      </div>

      <div v-if="loading && !log.length" class="empty">加载提交历史…</div>
      <div v-else-if="!filtered.length" class="empty">暂无提交记录</div>
      <div v-else class="split">
        <div class="log-list">
          <div
            v-for="(item, index) in filtered"
            :key="item.id"
            class="log-row"
            :class="{
              unpushed: item.unpushed,
              active: selected?.id === item.id,
            }"
            @click="selectRow(item.id)"
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
                <span
                  v-for="refName in item.refs"
                  :key="refName"
                  :class="refClass(refName)"
                  >{{ refName }}</span
                >
                <span v-if="item.unpushed" class="badge">未推送</span>
                <span class="summary">{{ item.summary }}</span>
              </div>
              <div class="meta">
                <span class="id" :title="item.id">{{ item.id.slice(0, 7) }}</span>
                <span>{{ item.author }}</span>
                <span>{{ item.time }}</span>
              </div>
            </div>
          </div>
        </div>

        <aside v-if="selected" class="detail">
          <div class="detail-head">
            <GitCommitHorizontal :size="16" class="detail-icon" />
            <div class="detail-title">
              <div class="summary">{{ selected.summary }}</div>
              <div class="meta">
                <span class="id">{{ selected.id.slice(0, 10) }}</span>
                <span>{{ selected.author }} · {{ selected.time }}</span>
              </div>
            </div>
          </div>

          <div v-if="selected.refs.length" class="ref-row">
            <span
              v-for="refName in selected.refs"
              :key="refName"
              :class="refClass(refName)"
              >{{ refName }}</span
            >
          </div>

          <div class="actions">
            <button type="button" class="action primary" @click="onCherryPick(selected.id)">
              <Cherry :size="14" />
              Cherry-pick
            </button>
            <button type="button" class="action" @click="onCheckout(selected.id)">
              <GitBranch :size="14" />
              Checkout
            </button>
            <button type="button" class="action" @click="onNewBranch(selected.id)">
              New Branch…
            </button>
            <button type="button" class="action" @click="onShowDiff(selected.id)">
              Show Diff
            </button>
            <button type="button" class="action" @click="onCopy(selected.id)">
              <Copy :size="13" />
              Copy Hash
            </button>
            <button type="button" class="action" @click="onRevertCommit(selected.id)">
              <RotateCcw :size="13" />
              Revert…
            </button>
            <button type="button" class="action" @click="onInteractiveRebase(selected.id)">
              Rebase from Here…
            </button>
            <button type="button" class="action danger" @click="onResetHardHere(selected.id)">
              Reset Hard…
            </button>
          </div>

          <div class="files-head">
            变更文件
            <span v-if="selected.files?.length" class="count">{{
              selected.files.length
            }}</span>
          </div>
          <div v-if="!selected.files?.length" class="muted">无文件列表</div>
          <div v-else class="file-list">
            <button
              v-for="f in selected.files"
              :key="f"
              type="button"
              class="file"
              :title="f"
              @click="onShowDiff(selected.id, f)"
            >
              {{ f }}
            </button>
          </div>

          <div class="danger-bar">
            <button type="button" class="danger-btn" @click="git.undoCommit()">
              撤销最近提交
            </button>
            <button type="button" class="danger-btn" @click="git.resetHard()">
              硬重置 HEAD…
            </button>
          </div>
        </aside>
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
  background: var(--bg-app);
}
.toolbar {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
}
.filter {
  flex: 1;
  height: 30px;
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
.split {
  flex: 1;
  min-height: 0;
  display: flex;
}
.log-list {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 6px 0;
  border-right: 1px solid var(--border-subtle);
}
.log-row {
  display: flex;
  gap: 10px;
  padding: 8px 14px;
  cursor: default;
}
.log-row:hover {
  background: var(--accent-soft);
}
.log-row.active {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
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
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #60a5fa;
  margin-top: 4px;
  box-shadow: 0 0 0 2px color-mix(in srgb, #60a5fa 25%, transparent);
}
.node.head {
  background: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}
.node.merge {
  background: var(--warning);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--warning) 30%, transparent);
}
.line {
  flex: 1;
  width: 2px;
  background: color-mix(in srgb, #60a5fa 55%, transparent);
  margin-top: 2px;
  min-height: 12px;
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
.ref.local {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
}
.ref.remote {
  background: color-mix(in srgb, #60a5fa 18%, transparent);
  color: #60a5fa;
}
.ref.head {
  background: color-mix(in srgb, var(--success) 18%, transparent);
  color: var(--success);
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

.detail {
  width: min(360px, 38%);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-panel);
}
.detail-head {
  display: flex;
  gap: 10px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--border-subtle);
}
.detail-icon {
  color: var(--accent);
  flex-shrink: 0;
  margin-top: 2px;
}
.detail-title {
  min-width: 0;
}
.detail-title .summary {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
}
.detail-title .meta {
  margin-top: 4px;
}
.ref-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-subtle);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-subtle);
}
.action {
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-app);
  color: var(--text-secondary);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.action:hover {
  color: var(--text-primary);
  border-color: var(--accent);
}
.action.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
}
.action.primary:hover {
  filter: brightness(1.06);
  color: var(--accent-fg);
}
.action.danger {
  color: var(--danger);
}
.action.danger:hover {
  border-color: var(--danger);
}
.files-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.files-head .count {
  font-weight: 500;
  color: var(--text-muted);
}
.muted {
  padding: 8px 14px;
  font-size: 12px;
  color: var(--text-muted);
}
.file-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.file {
  text-align: left;
  padding: 5px 8px;
  border-radius: 5px;
  font-size: 11px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
.danger-bar {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  padding: 8px 12px;
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
