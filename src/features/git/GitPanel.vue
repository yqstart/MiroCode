<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  GitBranch,
  History,
  RefreshCw,
  X,
} from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { basename, joinPath } from "@/shared/fs";
import { PLAIN_INPUT_ATTRS } from "@/shared/plainInput";
import { useEditorStore } from "@/stores/editor";
import { useGitStore } from "@/stores/git";
import { useWorkspaceStore } from "@/stores/workspace";

const workspace = useWorkspaceStore();
const git = useGitStore();
const editor = useEditorStore();
const { rootPath } = storeToRefs(workspace);
const {
  snapshot,
  branches,
  log,
  stagedEntries,
  unstagedEntries,
  conflictEntries,
  diffResults,
  diffTitle,
  diffVisible,
  loading,
  commitMessage,
} = storeToRefs(git);

const branchMenuOpen = ref(false);
const showLog = ref(false);
const showDanger = ref(false);

onMounted(() => {
  if (rootPath.value) void git.refresh();
});

async function refresh() {
  await git.refresh();
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    modified: "已修改",
    untracked: "未跟踪",
    deleted: "已删除",
    renamed: "已重命名",
    conflict: "冲突",
    changed: "已变更",
  };
  return map[status] ?? status;
}

async function openFile(path: string) {
  if (!rootPath.value) return;
  const abs = path.startsWith("/") || /^[A-Za-z]:/.test(path)
    ? path
    : joinPath(rootPath.value, path);
  await editor.openFile(abs);
}

async function onCreateBranch() {
  const { promptInput } = await import("@/shared/promptDialog");
  const name = await promptInput({
    title: "新建分支",
    label: "分支名称",
    placeholder: "feature/my-branch",
    confirmText: "创建",
  });
  if (!name?.trim()) return;
  await git.createBranch(name.trim(), true);
  branchMenuOpen.value = false;
}

async function onRenameBranch() {
  const current = snapshot.value.branch;
  if (!current) return;
  const { promptInput } = await import("@/shared/promptDialog");
  const name = await promptInput({
    title: "重命名分支",
    label: "新名称",
    defaultValue: current,
    confirmText: "重命名",
  });
  if (!name?.trim() || name.trim() === current) return;
  await git.renameBranch(current, name.trim());
}

async function onDeleteBranch() {
  const current = snapshot.value.branch;
  const locals = branches.value.filter((b) => !b.isRemote && !b.isHead);
  if (!locals.length) {
    workspace.showNotice("没有可删除的本地分支");
    return;
  }
  const { promptInput } = await import("@/shared/promptDialog");
  const name = await promptInput({
    title: "删除分支",
    label: `要删除的分支（当前：${current}）`,
    defaultValue: locals[0]?.name ?? "",
    confirmText: "删除",
  });
  if (!name?.trim()) return;
  await git.deleteBranch(name.trim());
}

async function onCheckout(name: string) {
  await git.checkout(name);
  branchMenuOpen.value = false;
}

async function onMerge() {
  const { promptInput } = await import("@/shared/promptDialog");
  const name = await promptInput({
    title: "合并分支",
    label: "要合并的分支名称",
    confirmText: "合并",
  });
  if (!name?.trim()) return;
  await git.mergeBranch(name.trim());
}

async function onRevert(commitId: string) {
  await git.revertTo(commitId);
}

async function onDiscard(path: string) {
  if (!confirm(`确定丢弃「${basename(path)}」的未提交变更？此操作不可撤销。`)) {
    return;
  }
  await git.discard([path]);
}

async function onDiscardAll() {
  const count = unstagedEntries.value.length;
  if (!count) return;
  if (!confirm(`确定丢弃全部 ${count} 个文件的未提交变更？此操作不可撤销。`)) {
    return;
  }
  await git.discardAll();
}

async function toggleLog() {
  showLog.value = !showLog.value;
  if (showLog.value) await git.loadLog();
}
</script>

<template>
  <div class="panel">
    <header class="header">
      <span class="title">Git</span>
      <button type="button" class="icon-btn" title="刷新" @click="refresh">
        <RefreshCw :size="14" :class="{ spin: loading }" />
      </button>
    </header>

    <div v-if="!rootPath" class="empty">
      <GitBranch :size="28" class="icon" />
      <p>请先打开工作区文件夹</p>
    </div>

    <template v-else-if="!snapshot.initialized">
      <div class="empty">
        <GitBranch :size="28" class="icon" />
        <p>当前文件夹尚未初始化 Git</p>
        <button type="button" class="cta" @click="git.initRepo()">
          初始化仓库
        </button>
      </div>
    </template>

    <template v-else>
      <div class="toolbar">
        <div class="branch-row">
          <button
            type="button"
            class="branch-btn"
            @click="branchMenuOpen = !branchMenuOpen"
          >
            <GitBranch :size="14" />
            {{ snapshot.branch ?? "无分支" }}
          </button>
          <span v-if="snapshot.upstream || snapshot.ahead || snapshot.behind" class="upstream">
            <template v-if="snapshot.upstream">{{ snapshot.upstream }}</template>
            <span v-if="snapshot.ahead" class="sync ahead" title="未推送到远端">
              ↑{{ snapshot.ahead }}
            </span>
            <span v-if="snapshot.behind" class="sync behind" title="远端有新提交">
              ↓{{ snapshot.behind }}
            </span>
            <span
              v-if="snapshot.upstream && !snapshot.ahead && !snapshot.behind"
              class="sync ok"
              title="已与远端同步"
            >
              已同步
            </span>
          </span>
        </div>
        <div class="actions">
          <button type="button" class="mini" title="拉取" @click="git.pull()">
            <ArrowDown :size="14" /> 拉取
          </button>
          <button type="button" class="mini" title="推送" @click="git.push()">
            <ArrowUp :size="14" /> 推送
          </button>
          <button
            type="button"
            class="mini"
            title="贮藏工作区更改（git stash）"
            @click="git.stash()"
          >
            贮藏
          </button>
          <button
            type="button"
            class="mini"
            title="弹出最近一次贮藏（git stash pop）"
            @click="git.stashPop()"
          >
            弹出贮藏
          </button>
          <button type="button" class="mini" @click="toggleLog">
            <History :size="14" /> 日志
          </button>
        </div>
      </div>

      <div v-if="branchMenuOpen" class="branch-menu">
        <p class="menu-title">切换分支</p>
        <button
          v-for="b in branches.filter((x) => !x.isRemote)"
          :key="b.name"
          type="button"
          class="menu-item"
          :class="{ active: b.isHead }"
          @click="onCheckout(b.name)"
        >
          {{ b.name }}
        </button>
        <hr />
        <button type="button" class="menu-item" @click="onCreateBranch">
          新建分支…
        </button>
        <button type="button" class="menu-item" @click="onRenameBranch">
          重命名当前分支…
        </button>
        <button type="button" class="menu-item" @click="onDeleteBranch">
          删除分支…
        </button>
        <button type="button" class="menu-item" @click="onMerge">
          合并分支…
        </button>
      </div>

      <div v-if="snapshot.conflictCount > 0" class="conflict-banner">
        <AlertTriangle :size="14" />
        {{ snapshot.conflictCount }} 个文件存在冲突
      </div>

      <div class="body">
        <section v-if="conflictEntries.length" class="section">
          <h3>冲突文件</h3>
          <div
            v-for="entry in conflictEntries"
            :key="entry.path"
            class="change-row conflict"
          >
            <button
              type="button"
              class="path"
              title="分栏合并对比"
              @click="git.openConflictCompare(entry.path)"
            >
              {{ basename(entry.path) }}
            </button>
            <div class="row-actions">
              <button
                type="button"
                class="tag"
                @click="git.openConflictCompare(entry.path)"
              >
                分栏合并
              </button>
              <button
                type="button"
                class="tag"
                @click="git.resolveConflict(entry.path, 'ours')"
              >
                保留本地
              </button>
              <button
                type="button"
                class="tag"
                @click="git.resolveConflict(entry.path, 'theirs')"
              >
                保留远程
              </button>
              <button
                type="button"
                class="tag"
                @click="openFile(entry.path)"
              >
                打开文件
              </button>
            </div>
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <h3>已暂存</h3>
            <button
              type="button"
              class="link"
              @click="git.showDiff(undefined, true)"
            >
              查看 diff
            </button>
          </div>
          <div v-if="!stagedEntries.length" class="muted">暂无暂存更改</div>
          <div v-for="entry in stagedEntries" :key="`s-${entry.path}`" class="change-row">
            <button type="button" class="path" @click="openFile(entry.path)">
              {{ basename(entry.path) }}
            </button>
            <span class="status staged">{{ statusLabel(entry.status) }}</span>
            <button
              type="button"
              class="tag"
              @click="git.unstage([entry.path])"
            >
              取消暂存
            </button>
            <button
              type="button"
              class="tag"
              @click="git.showDiff(entry.path, true)"
            >
              diff
            </button>
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <h3>更改</h3>
            <div class="section-actions">
              <button
                v-if="unstagedEntries.length"
                type="button"
                class="link danger-link"
                @click="onDiscardAll"
              >
                丢弃全部
              </button>
              <button
                type="button"
                class="link"
                @click="git.showDiff(undefined, false)"
              >
                查看 diff
              </button>
            </div>
          </div>
          <div v-if="!unstagedEntries.length" class="muted">工作区干净</div>
          <div v-for="entry in unstagedEntries" :key="`u-${entry.path}`" class="change-row">
            <button type="button" class="path" @click="openFile(entry.path)">
              {{ basename(entry.path) }}
            </button>
            <span class="status">{{ statusLabel(entry.status) }}</span>
            <button type="button" class="tag" @click="git.stage([entry.path])">
              暂存
            </button>
            <button
              type="button"
              class="tag danger-tag"
              @click="onDiscard(entry.path)"
            >
              丢弃
            </button>
            <button
              type="button"
              class="tag"
              @click="git.showDiff(entry.path, false)"
            >
              diff
            </button>
          </div>
        </section>

        <section class="section commit-box">
          <textarea
            v-model="commitMessage"
            v-bind="PLAIN_INPUT_ATTRS"
            class="commit-input"
            rows="3"
            name="miro-commit-message"
            placeholder="提交说明…"
          />
          <button type="button" class="cta" @click="git.commit()">
            提交
          </button>
        </section>

        <section v-if="showLog" class="section">
          <h3>提交历史</h3>
          <div class="log-graph">
            <div
              v-for="(item, index) in log"
              :key="item.id"
              class="log-row"
              :class="{ unpushed: item.unpushed }"
            >
              <div class="graph-col" aria-hidden="true">
                <span
                  class="graph-line"
                  :class="{
                    merge: (item.parents?.length ?? 0) > 1,
                    head: index === 0,
                  }"
                >
                  <template v-if="(item.parents?.length ?? 0) > 1">*─┐</template>
                  <template v-else-if="index < log.length - 1">* │</template>
                  <template v-else>*  </template>
                </span>
              </div>
              <div class="log-body">
                <div class="log-main">
                  <span class="log-id">{{ item.id }}</span>
                  <span
                    v-for="refName in item.refs"
                    :key="refName"
                    class="log-ref"
                  >{{ refName }}</span>
                  <span v-if="item.unpushed" class="log-unpushed" title="尚未推送到远端">
                    未推送
                  </span>
                  <span class="log-summary">{{ item.summary }}</span>
                </div>
                <div class="log-meta">
                  {{ item.author }} · {{ item.time }}
                  <button type="button" class="link" @click="onRevert(item.id)">
                    回退
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="section danger">
          <button type="button" class="link danger-link" @click="showDanger = !showDanger">
            {{ showDanger ? "收起危险操作" : "危险操作…" }}
          </button>
          <div v-if="showDanger" class="danger-actions">
            <button type="button" class="danger-btn" @click="git.undoCommit()">
              撤销最近一次提交
            </button>
            <button type="button" class="danger-btn" @click="git.resetHard()">
              硬重置 (reset --hard)
            </button>
          </div>
        </section>
      </div>
    </template>

    <div v-if="diffVisible" class="diff-overlay" @mousedown.self="git.closeDiff()">
      <div class="diff-modal">
        <header class="diff-header">
          <span>{{ diffTitle }}</span>
          <button type="button" @click="git.closeDiff()">
            <X :size="16" />
          </button>
        </header>
        <pre class="diff-body">{{
          diffResults.map((d) => d.patch).join("\n") || "（无差异）"
        }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.header {
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  text-transform: uppercase;
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
  color: var(--text-primary);
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
  gap: 8px;
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
}

.icon {
  color: var(--text-muted);
}

.cta {
  margin-top: 8px;
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 500;
}

.toolbar {
  padding: 10px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.branch-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.branch-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
  font-size: 12px;
}

.upstream {
  font-size: 11px;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sync {
  font-variant-numeric: tabular-nums;
}

.sync.ahead {
  color: var(--accent);
}

.sync.behind {
  color: var(--warning, #d97706);
}

.sync.ok {
  color: var(--success, #16a34a);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mini {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-app);
  border: 1px solid var(--border-subtle);
}

.mini:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.branch-menu {
  margin: 0 10px 8px;
  padding: 8px;
  border-radius: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
}

.menu-title {
  margin: 0 8px 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.menu-item {
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 12px;
}

.menu-item:hover,
.menu-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.menu-item.active {
  font-weight: 600;
}

.branch-menu hr {
  border: none;
  border-top: 1px solid var(--border-subtle);
  margin: 6px 0;
}

.conflict-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  font-size: 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 10px 16px;
}

.section {
  margin-bottom: 14px;
}

.section h3 {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-head h3 {
  margin: 0;
}

.muted {
  font-size: 12px;
  color: var(--text-muted);
  padding: 4px 0;
}

.change-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 4px;
  border-radius: 6px;
  flex-wrap: wrap;
}

.change-row:hover {
  background: var(--accent-soft);
}

.change-row.conflict {
  border-left: 2px solid var(--danger);
  padding-left: 8px;
}

.path {
  flex: 1;
  min-width: 0;
  text-align: left;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status {
  font-size: 10px;
  color: var(--warning);
}

.status.staged {
  color: var(--success);
}

.row-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-app);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}

.tag:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.link {
  font-size: 11px;
  color: var(--accent);
}

.commit-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.commit-input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-app);
  color: var(--text-primary);
  resize: vertical;
  font-family: var(--font-ui);
}

.log-row {
  padding: 8px 4px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.log-row.unpushed {
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.log-graph {
  display: flex;
  flex-direction: column;
}

.graph-col {
  flex-shrink: 0;
  width: 28px;
  padding-top: 2px;
}

.graph-line {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.2;
  color: var(--text-muted);
  white-space: pre;
}

.graph-line.head,
.graph-line.merge {
  color: var(--accent);
}

.log-body {
  min-width: 0;
  flex: 1;
}

.log-main {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 12px;
}

.log-id {
  font-family: var(--font-mono);
  color: var(--accent);
}

.log-ref {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
}

.log-unpushed {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
  font-weight: 600;
}

.log-summary {
  color: var(--text-primary);
}

.log-meta {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  gap: 8px;
  align-items: center;
}

.danger-tag {
  color: var(--danger) !important;
}

.danger-link {
  color: var(--danger);
}

.danger-actions {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.danger-btn {
  text-align: left;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  color: var(--danger);
  font-size: 12px;
}

.danger-btn:hover {
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.diff-overlay {
  position: fixed;
  inset: 0;
  z-index: 45;
  background: var(--bg-overlay);
  display: grid;
  place-items: center;
  padding: 24px;
}

.diff-modal {
  width: min(900px, 100%);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 13px;
}

.diff-body {
  margin: 0;
  padding: 14px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  color: var(--text-secondary);
}
</style>
