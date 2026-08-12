<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RefreshCw, Search } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { PLAIN_INPUT_ATTRS } from "@/shared/plainInput";
import { useGitLogStore } from "@/stores/gitLog";
import { useGitStore } from "@/stores/git";
import { useSettingsStore } from "@/stores/settings";
import { useWorkspaceStore } from "@/stores/workspace";
import type { GitCommitInfo, GitStashEntry } from "@/shared/gitApi";
import { useI18n } from "@/i18n";

type RowKind = "uncommitted" | "stash" | "commit";

interface GraphRow {
  kind: RowKind;
  key: string;
  /** commit / stash oid */
  id?: string;
  stashIndex?: number;
  summary: string;
  author?: string;
  time?: string;
  refs?: string[];
  files?: string[];
  unpushed?: boolean;
  merge?: boolean;
}

type CtxTarget =
  | { kind: "commit"; id: string }
  | { kind: "stash"; index: number }
  | { kind: "uncommitted" };

const { t } = useI18n();
const git = useGitStore();
const gitLog = useGitLogStore();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const { log, loading, snapshot, stashes, changelistEntries } = storeToRefs(git);
const { selectedId, open: logOpen } = storeToRefs(gitLog);

const filter = ref("");
const filterOpen = ref(false);
const showRemote = ref(true);
const branchScope = ref<"all" | "current">("all");
const ctx = ref<{ x: number; y: number; target: CtxTarget } | null>(null);
/** 选中行：uncommitted | stash:N | commitOid */
const selectedKey = ref<string | null>(null);

const dirtyCount = computed(() => changelistEntries.value.length);

const rows = computed<GraphRow[]>(() => {
  const q = filter.value.trim().toLowerCase();
  const out: GraphRow[] = [];

  if (dirtyCount.value > 0) {
    const row: GraphRow = {
      kind: "uncommitted",
      key: "uncommitted",
      summary: t("gitLog.uncommitted", { count: dirtyCount.value }),
      files: changelistEntries.value.map((e) => e.path),
    };
    if (
      !q ||
      row.summary.toLowerCase().includes(q) ||
      (row.files ?? []).some((f) => f.toLowerCase().includes(q))
    ) {
      out.push(row);
    }
  }

  for (const s of stashes.value) {
    const row: GraphRow = {
      kind: "stash",
      key: `stash:${s.index}`,
      id: s.id,
      stashIndex: s.index,
      summary: stashLabel(s),
      author: "stash",
      time: "",
      refs: [`stash@{${s.index}}`],
    };
    if (
      !q ||
      row.summary.toLowerCase().includes(q) ||
      (row.refs ?? []).some((r) => r.toLowerCase().includes(q))
    ) {
      out.push(row);
    }
  }

  const current = snapshot.value.branch;
  for (const item of log.value) {
    let refs = item.refs ?? [];
    if (!showRemote.value) {
      refs = refs.filter((r) => !isRemoteRef(r));
    }
    void current;
    void branchScope.value;
    const row: GraphRow = {
      kind: "commit",
      key: item.id,
      id: item.id,
      summary: item.summary,
      author: item.author,
      time: item.time,
      refs,
      files: item.files,
      unpushed: item.unpushed,
      merge: (item.parents?.length ?? 0) > 1,
    };
    if (
      !q ||
      row.summary.toLowerCase().includes(q) ||
      (row.author ?? "").toLowerCase().includes(q) ||
      (row.id ?? "").toLowerCase().includes(q) ||
      (row.refs ?? []).some((r) => r.toLowerCase().includes(q))
    ) {
      out.push(row);
    }
  }
  return out;
});

const selectedRow = computed(
  () => rows.value.find((r) => r.key === selectedKey.value) ?? rows.value[0] ?? null,
);

const selectedCommit = computed<GitCommitInfo | null>(() => {
  const row = selectedRow.value;
  if (!row || row.kind !== "commit" || !row.id) return null;
  return log.value.find((c) => c.id === row.id) ?? null;
});

async function ensureLog() {
  if (!workspace.rootPath || !snapshot.value.initialized) return;
  await Promise.all([git.loadLog(100), git.refresh()]);
  if (!selectedKey.value && rows.value[0]) {
    selectedKey.value = rows.value[0].key;
  }
}

onMounted(() => {
  document.addEventListener("mousedown", onDocMouseDown, true);
  if (logOpen.value) void ensureLog();
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocMouseDown, true);
});

/** 弹层全局关闭：点 data-gitlog-ctx 内部不关；其它位置关 */
function onDocMouseDown(event: MouseEvent) {
  if (!ctx.value) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("[data-gitlog-ctx]")) return;
  ctx.value = null;
}

watch(logOpen, (open) => {
  if (open) void ensureLog();
});

watch(rows, (list) => {
  if (!list.length) {
    selectedKey.value = null;
    return;
  }
  if (!selectedKey.value || !list.some((r) => r.key === selectedKey.value)) {
    selectedKey.value = list[0].key;
  }
});

// 兼容旧 selectedId
watch(selectedId, (id) => {
  if (id) selectedKey.value = id;
});

function stashLabel(s: GitStashEntry) {
  // git 消息常为 "On master: msg" / "WIP on master: …"
  const m = s.message.replace(/^On [^:]+:\s*/i, "").replace(/^WIP on [^:]+:\s*/i, "");
  return m || s.message || `stash@{${s.index}}`;
}

function isRemoteRef(name: string) {
  return (
    name.includes("/") ||
    name.startsWith("origin") ||
    name.endsWith("/HEAD")
  );
}

function isTagRef(name: string) {
  return name.startsWith("v") && /^v?\d/.test(name.replace(/^refs\/tags\//, ""));
}

function refClass(name: string) {
  if (name.startsWith("stash@")) return "ref stash";
  if (name.includes("HEAD") && name.includes("/")) return "ref remote-head";
  if (isRemoteRef(name)) return "ref remote";
  if (isTagRef(name)) return "ref tag";
  return "ref local";
}

function selectRow(key: string) {
  selectedKey.value = key;
  const row = rows.value.find((r) => r.key === key);
  if (row?.kind === "commit" && row.id) {
    gitLog.selectCommit(row.id);
  }
  ctx.value = null;
}

function onCtx(event: MouseEvent, row: GraphRow) {
  event.preventDefault();
  selectRow(row.key);
  if (row.kind === "commit" && row.id) {
    ctx.value = { x: event.clientX, y: event.clientY, target: { kind: "commit", id: row.id } };
  } else if (row.kind === "stash" && row.stashIndex != null) {
    ctx.value = {
      x: event.clientX,
      y: event.clientY,
      target: { kind: "stash", index: row.stashIndex },
    };
  } else if (row.kind === "uncommitted") {
    ctx.value = { x: event.clientX, y: event.clientY, target: { kind: "uncommitted" } };
  }
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
    title: t("gitLog.newBranchTitle"),
    label: t("gitLog.newBranchLabel"),
    placeholder: "feature/from-commit",
    confirmText: t("gitLog.newBranchConfirm"),
  });
  if (!name?.trim()) return;
  await git.createBranchAt(name.trim(), id, true);
  await ensureLog();
}

async function onCopy(id: string) {
  ctx.value = null;
  try {
    await navigator.clipboard.writeText(id);
    workspace.showNotice(t("gitLog.copiedHash"));
  } catch {
    workspace.showNotice(t("gitLog.copyFailed"));
  }
}

async function onShowDiff(id: string, filePath?: string) {
  ctx.value = null;
  const item = log.value.find((c) => c.id === id);
  const path = filePath ?? item?.files?.[0];
  if (!path) {
    workspace.showNotice(t("gitLog.noDiffFiles"));
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
    workspace.showNotice(t("gitLog.noOnto"));
    return;
  }
  const { openInteractiveRebase } = await import("@/shared/gitRebaseDialog");
  await openInteractiveRebase({
    onto,
    title: `Interactive Rebase from ${id.slice(0, 7)}`,
  });
}

async function onOpenUncommittedDiff(path: string) {
  await git.showDiff(path, false);
  gitLog.blurLog();
}

function openCommitPanel() {
  ctx.value = null;
  settings.openCommitPanel();
}

async function onStashPop(index: number) {
  ctx.value = null;
  await git.stashPop(index);
  await ensureLog();
}

async function onStashApply(index: number) {
  ctx.value = null;
  await git.stashApply(index);
  await ensureLog();
}

async function onStashDrop(index: number) {
  ctx.value = null;
  await git.stashDrop(index);
  await ensureLog();
}

function shortHash(id?: string) {
  return id ? id.slice(0, 8) : "";
}

function detailFiles(row: GraphRow | null): string[] {
  if (!row) return [];
  if (row.kind === "commit") return selectedCommit.value?.files ?? row.files ?? [];
  return row.files ?? [];
}
</script>

<template>
  <div class="log-panel" @click="ctx = null">
    <div v-if="!snapshot.initialized" class="empty">{{ t("gitLog.notInit") }}</div>
    <template v-else>
      <div class="toolbar">
        <label class="tool-label">
          {{ t("gitLog.branches") }}
          <select v-model="branchScope" class="select">
            <option value="all">{{ t("gitLog.showAll") }}</option>
            <option value="current">{{ t("gitLog.currentBranch") }}</option>
          </select>
        </label>
        <label class="check">
          <input v-model="showRemote" type="checkbox" />
          {{ t("gitLog.showRemote") }}
        </label>
        <div class="spacer" />
        <button
          type="button"
          class="icon-btn"
          :class="{ active: filterOpen }"
          :title="t('gitLog.filter')"
          @click="filterOpen = !filterOpen"
        >
          <Search :size="14" />
        </button>
        <button
          type="button"
          class="icon-btn"
          :title="t('common.refresh')"
          @click="ensureLog()"
        >
          <RefreshCw :size="14" :class="{ spin: loading }" />
        </button>
        <button type="button" class="link" @click="git.loadMoreLog()">
          {{ t("gitLog.loadMore") }}
        </button>
      </div>

      <div v-if="filterOpen" class="filter-bar">
        <input
          v-model="filter"
          v-bind="PLAIN_INPUT_ATTRS"
          class="filter"
          type="text"
          :placeholder="t('gitLog.filterPlaceholder')"
        />
      </div>

      <div v-if="loading && !log.length" class="empty">{{ t("gitLog.loading") }}</div>
      <div v-else-if="!rows.length" class="empty">{{ t("gitLog.empty") }}</div>
      <div v-else class="split">
        <div class="table-wrap">
          <div class="thead">
            <span class="col graph-h">{{ t("gitLog.graph") }}</span>
            <span class="col desc-h">{{ t("gitLog.description") }}</span>
            <span class="col date-h">{{ t("gitLog.date") }}</span>
            <span class="col author-h">{{ t("gitLog.author") }}</span>
            <span class="col hash-h">{{ t("gitLog.commit") }}</span>
          </div>
          <div class="tbody">
            <div
              v-for="(row, index) in rows"
              :key="row.key"
              class="tr"
              :class="{
                active: selectedRow?.key === row.key,
                uncommitted: row.kind === 'uncommitted',
                stash: row.kind === 'stash',
              }"
              @click="selectRow(row.key)"
              @contextmenu="onCtx($event, row)"
            >
              <div class="col graph-c" aria-hidden="true">
                <span
                  class="node"
                  :class="{
                    head: row.kind === 'commit' && row.id === log[0]?.id,
                    merge: row.merge,
                    stash: row.kind === 'stash',
                    dirty: row.kind === 'uncommitted',
                  }"
                />
                <span v-if="index < rows.length - 1" class="line" />
              </div>
              <div class="col desc-c">
                <span
                  v-for="refName in row.refs ?? []"
                  :key="refName"
                  :class="refClass(refName)"
                  >{{ refName }}</span
                >
                <span v-if="row.unpushed" class="badge">{{ t("gitLog.unpushed") }}</span>
                <span class="summary" :class="{ bold: row.kind !== 'commit' }">{{
                  row.summary
                }}</span>
              </div>
              <div class="col date-c">{{ row.time || "—" }}</div>
              <div class="col author-c">{{ row.author || "—" }}</div>
              <div class="col hash-c" :title="row.id">
                {{ row.kind === "commit" || row.kind === "stash" ? shortHash(row.id) : "" }}
              </div>
            </div>
          </div>
        </div>

        <aside v-if="selectedRow" class="detail">
          <div class="detail-head">
            <div class="summary">{{ selectedRow.summary }}</div>
            <div v-if="selectedRow.kind === 'commit'" class="meta">
              <span class="id" :title="selectedRow.id">{{
                selectedRow.id?.slice(0, 10)
              }}</span>
              <span>{{ selectedRow.author }}</span>
              <span>{{ selectedRow.time }}</span>
            </div>
            <div v-else-if="selectedRow.kind === 'stash'" class="meta">
              <span class="id">stash@{{ selectedRow.stashIndex }}</span>
              <span :title="selectedRow.id">{{ shortHash(selectedRow.id) }}</span>
            </div>
            <div v-else class="meta">
              <span>{{ t("gitLog.workspaceDirty") }}</span>
            </div>
          </div>

          <div
            v-if="selectedRow.refs?.length"
            class="ref-row"
          >
            <span
              v-for="refName in selectedRow.refs"
              :key="refName"
              :class="refClass(refName)"
              >{{ refName }}</span
            >
          </div>

          <div class="files-head">
            {{ selectedRow.kind === "stash" ? t("git.stashes") : t("gitLog.files") }}
            <span v-if="detailFiles(selectedRow).length" class="count">{{
              detailFiles(selectedRow).length
            }}</span>
          </div>
          <div
            v-if="selectedRow.kind === 'stash'"
            class="muted"
          >
            {{ t("gitLog.stashHint") }}
          </div>
          <div v-else-if="!detailFiles(selectedRow).length" class="muted">
            {{ t("gitLog.noFiles") }}
          </div>
          <div v-else class="file-list">
            <button
              v-for="f in detailFiles(selectedRow)"
              :key="f"
              type="button"
              class="file"
              :title="f"
              @click="
                selectedRow.kind === 'commit' && selectedRow.id
                  ? onShowDiff(selectedRow.id, f)
                  : onOpenUncommittedDiff(f)
              "
            >
              {{ f }}
            </button>
          </div>
        </aside>
      </div>
    </template>

    <Teleport to="body">
      <div
        v-if="ctx"
        class="ctx"
        data-gitlog-ctx
        :style="{ left: `${ctx.x}px`, top: `${ctx.y}px` }"
        @click.stop
      >
        <template v-if="ctx.target.kind === 'commit'">
          <button type="button" @click="onCheckout(ctx.target.id)">
            {{ t("gitLog.checkout") }}
          </button>
          <button type="button" @click="onNewBranch(ctx.target.id)">
            {{ t("gitLog.newBranch") }}
          </button>
          <button type="button" @click="onCopy(ctx.target.id)">
            {{ t("gitLog.copyRevision") }}
          </button>
          <button type="button" @click="onShowDiff(ctx.target.id)">
            {{ t("gitLog.showDiff") }}
          </button>
          <button type="button" @click="onCherryPick(ctx.target.id)">
            {{ t("gitLog.cherryPick") }}
          </button>
          <button type="button" @click="onRevertCommit(ctx.target.id)">
            {{ t("gitLog.revert") }}
          </button>
          <button type="button" @click="onInteractiveRebase(ctx.target.id)">
            {{ t("gitLog.rebase") }}
          </button>
          <button type="button" @click="onReset(ctx.target.id, 'soft')">
            {{ t("gitLog.resetSoft") }}
          </button>
          <button type="button" @click="onReset(ctx.target.id, 'mixed')">
            {{ t("gitLog.resetMixed") }}
          </button>
          <button
            type="button"
            class="danger"
            @click="onReset(ctx.target.id, 'hard')"
          >
            {{ t("gitLog.resetHard") }}
          </button>
        </template>
        <template v-else-if="ctx.target.kind === 'stash'">
          <button type="button" @click="onStashApply(ctx.target.index)">
            {{ t("gitLog.applyStash") }}
          </button>
          <button type="button" @click="onStashPop(ctx.target.index)">
            {{ t("gitLog.popStash") }}
          </button>
          <button
            type="button"
            class="danger"
            @click="onStashDrop(ctx.target.index)"
          >
            {{ t("gitLog.dropStash") }}
          </button>
        </template>
        <template v-else>
          <button type="button" @click="openCommitPanel">
            {{ t("gitLog.openCommitPanel") }}
          </button>
        </template>
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
  gap: 12px;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
  font-size: 12px;
}
.tool-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
}
.select {
  height: 26px;
  padding: 0 8px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-app);
  color: var(--text-primary);
  font-size: 12px;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}
.spacer {
  flex: 1;
}
.icon-btn {
  width: 26px;
  height: 26px;
  border-radius: 5px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}
.icon-btn:hover,
.icon-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.toolbar .link {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--accent);
}
.toolbar .link:hover {
  text-decoration: underline;
}
.filter-bar {
  flex-shrink: 0;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
}
.filter {
  width: 100%;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-app);
  color: var(--text-primary);
  font-size: 12px;
  box-sizing: border-box;
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
.table-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
}
.thead,
.tr {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 148px 100px 80px;
  align-items: stretch;
  gap: 0;
}
.thead {
  flex-shrink: 0;
  height: 28px;
  align-items: center;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.thead .col {
  padding: 0 8px;
}
.tbody {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.tr {
  min-height: 28px;
  cursor: default;
  border-bottom: 1px solid color-mix(in srgb, var(--border-subtle) 60%, transparent);
  font-size: 12px;
}
.tr:hover {
  background: var(--accent-soft);
}
.tr.active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.tr.uncommitted .summary,
.tr.stash .summary.bold {
  font-weight: 600;
}
.col {
  padding: 4px 8px;
  min-width: 0;
  display: flex;
  align-items: center;
}
.graph-c {
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 8px;
  padding-left: 0;
  padding-right: 0;
}
.node {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #60a5fa;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px color-mix(in srgb, #60a5fa 25%, transparent);
}
.node.head {
  background: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}
.node.merge {
  background: var(--warning);
}
.node.stash {
  background: #a78bfa;
  box-shadow: 0 0 0 2px color-mix(in srgb, #a78bfa 30%, transparent);
}
.node.dirty {
  background: var(--warning);
  border-radius: 2px;
}
.line {
  flex: 1;
  width: 2px;
  min-height: 10px;
  background: color-mix(in srgb, #60a5fa 55%, transparent);
  margin-top: 2px;
}
.desc-c {
  flex-wrap: wrap;
  gap: 5px;
  row-gap: 2px;
}
.summary {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.summary.bold {
  font-weight: 600;
}
.date-c,
.author-c {
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hash-c {
  font-family: var(--font-mono);
  color: var(--text-muted);
  white-space: nowrap;
}
.ref {
  flex-shrink: 0;
  font-size: 11px;
  padding: 0 6px;
  height: 18px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}
.ref.local {
  background: color-mix(in srgb, #3b82f6 18%, transparent);
  color: #3b82f6;
}
.ref.remote {
  background: color-mix(in srgb, var(--text-muted) 16%, transparent);
  color: var(--text-secondary);
}
.ref.remote-head {
  background: transparent;
  border: 1px solid color-mix(in srgb, #3b82f6 50%, transparent);
  color: #3b82f6;
}
.ref.tag {
  background: color-mix(in srgb, #3b82f6 14%, transparent);
  color: #2563eb;
}
.ref.stash {
  background: color-mix(in srgb, #a78bfa 20%, transparent);
  color: #a78bfa;
}
.badge {
  font-size: 10px;
  padding: 0 5px;
  height: 16px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  background: color-mix(in srgb, var(--warning) 20%, transparent);
  color: var(--warning);
}

.detail {
  width: min(320px, 36%);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-panel);
}
.detail-head {
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--border-subtle);
}
.detail-head .summary {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  white-space: normal;
}
.meta {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
}
.id {
  font-family: var(--font-mono);
  color: var(--accent);
}
.ref-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-subtle);
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
  line-height: 1.45;
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
