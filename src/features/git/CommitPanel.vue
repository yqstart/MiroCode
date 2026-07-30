<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CloudDownload,
  FolderSync,
  History,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
} from "lucide-vue-next";
import { storeToRefs } from "pinia";
import FileTypeIcon from "@/shared/FileTypeIcon.vue";
import { basename, joinPath } from "@/shared/fs";
import { PLAIN_INPUT_ATTRS } from "@/shared/plainInput";
import { useEditorStore } from "@/stores/editor";
import { useGitLogStore } from "@/stores/gitLog";
import { useGitStore } from "@/stores/git";
import { useWorkspaceStore } from "@/stores/workspace";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const workspace = useWorkspaceStore();
const git = useGitStore();
const editor = useEditorStore();
const gitLog = useGitLogStore();
const { rootPath } = storeToRefs(workspace);
const {
  snapshot,
  stagedEntries,
  unstagedEntries,
  conflictEntries,
  stashes,
  selectedPath,
  loading,
  commitMessage,
  amendCommit,
  rebaseStatus,
} = storeToRefs(git);

const contextMenu = ref<{ x: number; y: number; path: string; staged: boolean } | null>(
  null,
);
const commitMenuOpen = ref(false);
const stagedOpen = ref(true);
const changesOpen = ref(true);
const stashesOpen = ref(true);

const canCommit = computed(
  () =>
    Boolean(commitMessage.value.trim()) &&
    !conflictEntries.value.length &&
    (amendCommit.value || stagedEntries.value.length > 0),
);

onMounted(() => {
  if (rootPath.value) void git.refresh();
});

function statusLabel(status: string) {
  const map: Record<string, string> = {
    modified: "M",
    untracked: "U",
    deleted: "D",
    renamed: "R",
    conflict: "C",
    changed: "M",
  };
  return map[status] ?? status.slice(0, 1).toUpperCase();
}

function statusTitle(status: string) {
  const map: Record<string, string> = {
    modified: t("git.statusModified"),
    untracked: t("git.statusUntracked"),
    deleted: t("git.statusDeleted"),
    renamed: t("git.statusRenamed"),
    conflict: t("git.statusConflict"),
    changed: t("git.statusChanged"),
  };
  return map[status] ?? status;
}

function statusClass(status: string) {
  if (status === "untracked") return "st-untracked";
  if (status === "deleted") return "st-deleted";
  if (status === "conflict") return "st-conflict";
  return "st-modified";
}

function dirOf(path: string) {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function onRowClick(path: string, staged: boolean) {
  git.selectChange(path);
  contextMenu.value = null;
  void git.showDiff(path, staged);
}

async function openFile(path: string) {
  if (!rootPath.value) return;
  const abs =
    path.startsWith("/") || /^[A-Za-z]:/.test(path)
      ? path
      : joinPath(rootPath.value, path);
  await editor.openFile(abs);
}

function onContextMenu(event: MouseEvent, path: string, staged: boolean) {
  event.preventDefault();
  git.selectChange(path);
  contextMenu.value = { x: event.clientX, y: event.clientY, path, staged };
}

async function onStage(path: string) {
  contextMenu.value = null;
  await git.stage([path]);
}

async function onUnstage(path: string) {
  contextMenu.value = null;
  await git.unstage([path]);
}

async function onDiscard(path: string) {
  contextMenu.value = null;
  const entry = git.statusMap.get(path);
  const isUntracked = entry?.status === "untracked";
  const msg = isUntracked
    ? t("git.discardUntrackedConfirm", { name: basename(path) })
    : t("git.discardConfirm", { name: basename(path) });
  if (!confirm(msg)) return;
  await git.discard([path]);
}

async function onStageAll() {
  const paths = unstagedEntries.value.map((e) => e.path);
  if (!paths.length) return;
  await git.stage(paths);
}

async function onUnstageAll() {
  const paths = stagedEntries.value.map((e) => e.path);
  if (!paths.length) return;
  await git.unstage(paths);
}

async function onDiscardAllChanges() {
  const paths = unstagedEntries.value.map((e) => e.path);
  if (!paths.length) return;
  const hasUntracked = paths.some(
    (p) => git.statusMap.get(p)?.status === "untracked",
  );
  const tip = hasUntracked ? t("git.untrackedTip") : "";
  if (
    !confirm(
      t("git.discardAllConfirm", { count: paths.length, tip }),
    )
  ) {
    return;
  }
  await git.discard(paths);
}

function openLog() {
  gitLog.openLog();
  if (rootPath.value) void git.loadLog(100);
}

async function doCommit() {
  commitMenuOpen.value = false;
  await git.commit();
}

async function doCommitAndPush() {
  commitMenuOpen.value = false;
  await git.commitAndPush();
}

function onCommitKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    if (canCommit.value) void doCommit();
  }
}
</script>

<template>
  <div class="commit-panel" @click="contextMenu = null; commitMenuOpen = false">
    <header class="header">
      <span class="title">{{ t("git.commit") }}</span>
      <div class="header-actions">
        <button
          type="button"
          class="icon-btn"
          :title="t('git.refresh')"
          @click="git.refresh()"
        >
          <RefreshCw :size="14" :class="{ spin: loading }" />
        </button>
        <button
          type="button"
          class="icon-btn"
          :title="t('git.gitLog')"
          @click="openLog"
        >
          <History :size="14" />
        </button>
      </div>
    </header>

    <div v-if="!rootPath" class="empty">{{ t("git.emptyWorkspace") }}</div>

    <template v-else-if="!snapshot.initialized">
      <div class="empty">
        <p>{{ t("git.notInit") }}</p>
        <button type="button" class="cta" @click="git.initRepo()">
          {{ t("git.initRepo") }}
        </button>
      </div>
    </template>

    <template v-else>
      <div class="toolbar">
        <span class="branch">{{ snapshot.branch ?? t("git.noBranch") }}</span>
        <span
          v-if="snapshot.ahead || snapshot.behind"
          class="sync"
          :title="snapshot.upstream ?? ''"
        >
          <template v-if="snapshot.ahead">↑{{ snapshot.ahead }}</template>
          <template v-if="snapshot.behind">↓{{ snapshot.behind }}</template>
        </span>
        <div class="spacer" />
        <button
          type="button"
          class="mini"
          :title="t('git.updateProject')"
          aria-label="Update Project"
          @click="git.updateProject()"
        >
          <FolderSync :size="14" />
        </button>
        <button
          type="button"
          class="mini"
          :title="t('git.fetch')"
          aria-label="Fetch"
          @click="git.fetchRemote()"
        >
          <CloudDownload :size="14" />
        </button>
        <button
          type="button"
          class="mini"
          :title="t('git.pull')"
          :aria-label="t('git.pullShort')"
          @click="git.pull()"
        >
          <ArrowDown :size="14" />
        </button>
        <button
          type="button"
          class="mini"
          :title="t('git.push')"
          :aria-label="t('git.pushShort')"
          @click="git.pushWithDialog()"
        >
          <ArrowUp :size="14" />
        </button>
        <button
          type="button"
          class="mini"
          :title="
            stashes.length
              ? t('git.stashWithCount', { count: stashes.length })
              : t('git.stash')
          "
          :aria-label="t('git.stashShort')"
          @click="git.stash()"
        >
          <Archive :size="14" />
          <span v-if="stashes.length" class="mini-badge">{{
            stashes.length > 9 ? "9+" : stashes.length
          }}</span>
        </button>
      </div>

      <div v-if="rebaseStatus.inProgress" class="rebase-banner">
        <span class="rebase-text">
          {{ t("git.rebaseInProgress") }}
          <template v-if="rebaseStatus.onto">{{
            t("git.rebaseOnto", { onto: rebaseStatus.onto })
          }}</template>
          <template v-if="rebaseStatus.conflicted">{{
            t("git.rebaseConflictHint")
          }}</template>
        </span>
        <div class="rebase-actions">
          <button type="button" class="link" @click="git.rebaseContinue()">
            Continue
          </button>
          <button type="button" class="link" @click="git.rebaseSkip()">Skip</button>
          <button type="button" class="link danger" @click="git.rebaseAbort()">
            Abort
          </button>
        </div>
      </div>

      <div v-if="conflictEntries.length" class="conflict-banner">
        <AlertTriangle :size="12" />
        {{ t("git.conflictBanner", { count: conflictEntries.length }) }}
        <button
          type="button"
          class="link"
          @click="git.resolveAllConflicts('ours')"
        >
          {{ t("git.allOurs") }}
        </button>
        <button
          type="button"
          class="link"
          @click="git.resolveAllConflicts('theirs')"
        >
          {{ t("git.allTheirs") }}
        </button>
      </div>

      <div class="changes">
        <div v-if="stashes.length" class="group">
          <div class="group-title" @click="stashesOpen = !stashesOpen">
            <span class="group-label">
              <ChevronDown
                :size="12"
                class="chev"
                :class="{ closed: !stashesOpen }"
              />
              {{ t("git.stashes") }}
            </span>
            <div class="group-actions" @click.stop>
              <button
                type="button"
                class="act"
                :title="t('git.stashPopLatest')"
                @click="git.stashPop(0)"
              >
                {{ t("git.stashPop") }}
              </button>
              <span class="count">{{ stashes.length }}</span>
            </div>
          </div>
          <template v-if="stashesOpen">
            <div
              v-for="s in stashes"
              :key="`stash-${s.index}`"
              class="row stash-row"
            >
              <span class="stash-idx">stash@{{ s.index }}</span>
              <span class="name stash-msg" :title="s.message">{{
                s.message
              }}</span>
              <div class="row-actions always" @click.stop>
                <button
                  type="button"
                  class="act"
                  :title="t('git.stashApplyTitle')"
                  @click="git.stashApply(s.index)"
                >
                  {{ t("git.stashApply") }}
                </button>
                <button
                  type="button"
                  class="act"
                  :title="t('git.stashPopTitle')"
                  @click="git.stashPop(s.index)"
                >
                  {{ t("git.stashPop") }}
                </button>
                <button
                  type="button"
                  class="act danger-act"
                  :title="t('common.delete')"
                  @click="git.stashDrop(s.index)"
                >
                  {{ t("git.stashDrop") }}
                </button>
              </div>
            </div>
          </template>
        </div>

        <div v-if="conflictEntries.length" class="group">
          <div class="group-title">{{ t("git.conflicts") }}</div>
          <div
            v-for="entry in conflictEntries"
            :key="`c-${entry.path}`"
            class="row conflict"
            :class="{ selected: selectedPath === entry.path }"
            @click="onRowClick(entry.path, false)"
          >
            <FileTypeIcon :path="entry.path" :size="14" />
            <span class="name" :title="entry.path">{{
              basename(entry.path)
            }}</span>
            <span class="dir" :title="entry.path">{{ dirOf(entry.path) }}</span>
            <span class="status st-conflict" :title="t('git.statusConflict')">C</span>
            <div class="row-actions always" @click.stop>
              <button
                type="button"
                class="act"
                @click="git.openConflictCompare(entry.path)"
              >
                {{ t("git.merge") }}
              </button>
              <button
                type="button"
                class="act"
                @click="git.resolveConflict(entry.path, 'ours')"
              >
                {{ t("git.ours") }}
              </button>
              <button
                type="button"
                class="act"
                @click="git.resolveConflict(entry.path, 'theirs')"
              >
                {{ t("git.theirs") }}
              </button>
            </div>
          </div>
        </div>

        <div v-if="stagedEntries.length" class="group">
          <div class="group-title" @click="stagedOpen = !stagedOpen">
            <span class="group-label">
              <ChevronDown
                :size="12"
                class="chev"
                :class="{ closed: !stagedOpen }"
              />
              {{ t("git.staged") }}
            </span>
            <div class="group-actions" @click.stop>
              <button
                type="button"
                class="act-icon"
                :title="t('git.unstageAll')"
                @click="onUnstageAll"
              >
                <Minus :size="14" />
              </button>
              <span class="count">{{ stagedEntries.length }}</span>
            </div>
          </div>
          <template v-if="stagedOpen">
            <div
              v-for="entry in stagedEntries"
              :key="`s-${entry.path}`"
              class="row"
              :class="{ selected: selectedPath === entry.path }"
              @click="onRowClick(entry.path, true)"
              @dblclick="openFile(entry.path)"
              @contextmenu="onContextMenu($event, entry.path, true)"
            >
              <FileTypeIcon :path="entry.path" :size="14" />
              <span class="name" :title="entry.path">{{
                basename(entry.path)
              }}</span>
              <span class="dir" :title="entry.path">{{ dirOf(entry.path) }}</span>
              <span
                class="status"
                :class="statusClass(entry.status)"
                :title="statusTitle(entry.status)"
                >{{ statusLabel(entry.status) }}</span
              >
              <div class="row-actions" @click.stop>
                <button
                  type="button"
                  class="act-icon"
                  :title="t('git.unstage')"
                  @click="onUnstage(entry.path)"
                >
                  <Minus :size="13" />
                </button>
              </div>
            </div>
          </template>
        </div>

        <div class="group">
          <div class="group-title" @click="changesOpen = !changesOpen">
            <span class="group-label">
              <ChevronDown
                :size="12"
                class="chev"
                :class="{ closed: !changesOpen }"
              />
              {{ t("git.changes") }}
            </span>
            <div class="group-actions" @click.stop>
              <button
                v-if="unstagedEntries.length"
                type="button"
                class="act-icon"
                :title="t('git.stageAll')"
                @click="onStageAll"
              >
                <Plus :size="14" />
              </button>
              <button
                v-if="unstagedEntries.length"
                type="button"
                class="act-icon"
                :title="t('git.discardAll')"
                @click="onDiscardAllChanges"
              >
                <Undo2 :size="13" />
              </button>
              <span class="count">{{ unstagedEntries.length }}</span>
            </div>
          </div>
          <template v-if="changesOpen">
            <div v-if="!unstagedEntries.length" class="muted">
              {{ t("git.emptyChanges") }}
            </div>
            <div
              v-for="entry in unstagedEntries"
              :key="`u-${entry.path}`"
              class="row"
              :class="{ selected: selectedPath === entry.path }"
              @click="onRowClick(entry.path, false)"
              @dblclick="openFile(entry.path)"
              @contextmenu="onContextMenu($event, entry.path, false)"
            >
              <FileTypeIcon :path="entry.path" :size="14" />
              <span class="name" :title="entry.path">{{
                basename(entry.path)
              }}</span>
              <span class="dir" :title="entry.path">{{ dirOf(entry.path) }}</span>
              <span
                class="status"
                :class="statusClass(entry.status)"
                :title="statusTitle(entry.status)"
                >{{ statusLabel(entry.status) }}</span
              >
              <div class="row-actions" @click.stop>
                <button
                  type="button"
                  class="act-icon"
                  :title="t('git.stage')"
                  @click="onStage(entry.path)"
                >
                  <Plus :size="13" />
                </button>
                <button
                  type="button"
                  class="act-icon"
                  :title="t('git.discard')"
                  @click="onDiscard(entry.path)"
                >
                  <Undo2 :size="12" />
                </button>
              </div>
            </div>
          </template>
        </div>
      </div>

      <div class="commit-footer">
        <textarea
          v-model="commitMessage"
          v-bind="PLAIN_INPUT_ATTRS"
          class="message"
          rows="3"
          name="miro-commit-message"
          :placeholder="t('git.commitMessage')"
          @keydown="onCommitKeydown"
        />
        <label class="amend">
          <input v-model="amendCommit" type="checkbox" />
          {{ t("git.amend") }}
        </label>
        <div class="commit-actions">
          <div class="commit-split">
            <button
              type="button"
              class="cta"
              :disabled="!canCommit"
              @click.stop="doCommit"
            >
              <Check :size="14" /> {{ t("git.commit") }}
            </button>
            <button
              type="button"
              class="cta-menu"
              :disabled="!canCommit"
              :title="t('common.more')"
              @click.stop="commitMenuOpen = !commitMenuOpen"
            >
              <ChevronDown :size="14" />
            </button>
            <div v-if="commitMenuOpen" class="commit-dropdown" @click.stop>
              <button
                type="button"
                :disabled="!canCommit"
                @click="doCommitAndPush"
              >
                {{ t("git.commitAndPush") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="ctx"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
      >
        <button
          type="button"
          @click="openFile(contextMenu.path); contextMenu = null"
        >
          {{ t("git.openFile") }}
        </button>
        <button
          type="button"
          @click="
            git.showDiff(contextMenu.path, contextMenu.staged);
            contextMenu = null;
          "
        >
          {{ t("git.showDiff") }}
        </button>
        <button
          v-if="!contextMenu.staged"
          type="button"
          @click="onStage(contextMenu.path)"
        >
          {{ t("git.stage") }}
        </button>
        <button
          v-else
          type="button"
          @click="onUnstage(contextMenu.path)"
        >
          {{ t("git.unstage") }}
        </button>
        <button
          v-if="!contextMenu.staged"
          type="button"
          class="danger-item"
          @click="onDiscard(contextMenu.path)"
        >
          {{ t("git.discardEllipsis") }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.commit-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.header {
  flex-shrink: 0;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.header-actions {
  display: flex;
  gap: 2px;
}

.icon-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}

.icon-btn:hover {
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

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 13px;
  text-align: center;
}

.cta {
  height: 30px;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 500;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.cta:disabled,
.cta-menu:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-subtle);
}

.branch {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 50%;
}

.sync {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.spacer {
  flex: 1;
}

.mini {
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 5px;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
}

.mini:hover {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.mini-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--accent);
  color: var(--accent-fg);
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}

.conflict-banner {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 11px;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border-bottom: 1px solid var(--border-subtle);
}

.conflict-banner .link {
  margin-left: 4px;
  color: var(--accent);
  font-size: 11px;
}

.conflict-banner .link:hover {
  text-decoration: underline;
}

.rebase-banner {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  font-size: 11px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-bottom: 1px solid var(--border-subtle);
}

.rebase-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rebase-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.rebase-actions .link {
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
}

.rebase-actions .link.danger {
  color: var(--danger);
}

.rebase-actions .link:hover {
  text-decoration: underline;
}

.changes {
  flex: 1;
  min-height: 80px;
  overflow: auto;
}

.group {
  padding: 4px 0 8px;
}

.group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
  margin: 0 4px;
}

.group-title:hover {
  background: var(--accent-soft);
}

.group-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.chev {
  transition: transform 0.12s ease;
  color: var(--text-muted);
}

.chev.closed {
  transform: rotate(-90deg);
}

.group-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--text-muted) 18%, transparent);
}

.muted {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 10px;
  font-size: 12px;
  cursor: default;
  min-width: 0;
}

.row:hover {
  background: var(--accent-soft);
}

.row.selected {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

.row.conflict .name {
  color: var(--danger);
}

.status {
  flex-shrink: 0;
  width: 14px;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  font-family: var(--font-mono);
}

.st-modified {
  color: var(--warning);
}
.st-untracked {
  color: #3b82f6;
}
.st-deleted {
  color: var(--danger);
}
.st-conflict {
  color: var(--danger);
}

.name {
  flex-shrink: 0;
  max-width: 42%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 11px;
}

.row-actions {
  display: none;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
  margin-left: 2px;
}

.row:hover .row-actions,
.row-actions.always {
  display: inline-flex;
}

.act-icon {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
}

.act-icon:hover {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
}

.act {
  font-size: 11px;
  color: var(--accent);
  padding: 0 2px;
}

.act:hover {
  text-decoration: underline;
}

.danger-act {
  color: var(--danger);
}

.stash-row {
  padding-left: 12px;
}

.stash-idx {
  flex-shrink: 0;
  font-size: 11px;
  font-family: var(--font-mono);
  color: #a78bfa;
}

.stash-msg {
  flex: 1;
  max-width: none;
  color: var(--text-secondary);
}

.link {
  font-size: 11px;
  color: var(--accent);
  padding: 0 2px;
}

.link:hover {
  text-decoration: underline;
}

.commit-footer {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-panel);
}

.message {
  width: 100%;
  min-height: 64px;
  max-height: 140px;
  resize: vertical;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-app);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  line-height: 1.45;
  box-sizing: border-box;
}

.message:focus {
  outline: none;
  border-color: var(--accent);
}

.amend {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.commit-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.commit-split {
  position: relative;
  display: flex;
}

.commit-split .cta {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.cta-menu {
  height: 30px;
  width: 26px;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--accent);
  color: var(--accent-fg);
  display: grid;
  place-items: center;
  border-left: 1px solid color-mix(in srgb, var(--accent-fg) 25%, transparent);
}

.commit-dropdown {
  position: absolute;
  left: 0;
  bottom: calc(100% + 4px);
  min-width: 180px;
  padding: 4px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
  z-index: 5;
}

.commit-dropdown button {
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-primary);
}

.commit-dropdown button:hover:not(:disabled) {
  background: var(--accent-soft);
}

.ctx {
  position: fixed;
  z-index: 80;
  min-width: 180px;
  padding: 4px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
}

.ctx button {
  text-align: left;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-primary);
}

.ctx button:hover {
  background: var(--accent-soft);
}

.ctx .danger-item {
  color: var(--danger);
}
</style>
