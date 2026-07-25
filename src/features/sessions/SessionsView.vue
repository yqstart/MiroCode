<script setup lang="ts">
import { HardDrive, Plus, Server, TerminalSquare, X } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import LocalTerminal from "@/features/sessions/LocalTerminal.vue";
import { useSessionsStore, type SessionSubView } from "@/stores/sessions";
import { useWorkspaceStore } from "@/stores/workspace";

const sessions = useSessionsStore();
const workspace = useWorkspaceStore();
const { subView, localTerminals, activeLocalId } = storeToRefs(sessions);

const navItems: { id: SessionSubView; label: string; hint?: string }[] = [
  { id: "local", label: "本地终端" },
  { id: "remote", label: "远程终端", hint: "即将支持" },
  { id: "sftp", label: "SFTP", hint: "即将支持" },
];

function onAddLocal() {
  sessions.addLocalTerminal(workspace.rootPath);
}
</script>

<template>
  <div class="sessions">
    <aside class="rail" aria-label="会话类型">
      <button
        v-for="item in navItems"
        :key="item.id"
        type="button"
        class="rail-item"
        :class="{ active: subView === item.id }"
        @click="sessions.setSubView(item.id)"
      >
        <TerminalSquare v-if="item.id === 'local'" :size="16" />
        <Server v-else-if="item.id === 'remote'" :size="16" />
        <HardDrive v-else :size="16" />
        <span>{{ item.label }}</span>
        <em v-if="item.hint">{{ item.hint }}</em>
      </button>
    </aside>

    <section class="main">
      <template v-if="subView === 'local'">
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
              title="关闭终端"
              @click.stop="sessions.closeLocalTerminal(term.id)"
            >
              <X :size="12" />
            </span>
          </button>
          <button type="button" class="add" title="新建本地终端" @click="onAddLocal">
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
            <p>暂无本地终端</p>
            <button type="button" class="cta" @click="onAddLocal">新建终端</button>
          </div>
        </div>
      </template>

      <div v-else class="placeholder">
        <component
          :is="subView === 'remote' ? Server : HardDrive"
          :size="36"
          class="icon"
        />
        <h2>{{ subView === "remote" ? "远程终端" : "SFTP 文件管理" }}</h2>
        <p>
          {{
            subView === "remote"
              ? "后续将在此连接 SSH 远程服务器，交互与本地终端同窗。"
              : "后续将在此提供远程文件浏览、上传下载的 SFTP GUI。"
          }}
        </p>
        <span class="badge">架构位已预留 · 尚未接入</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.sessions {
  height: 100%;
  display: grid;
  grid-template-columns: 148px 1fr;
  min-height: 0;
  background: var(--bg-app);
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 8px;
  border-right: 1px solid var(--border-subtle);
  background: var(--bg-panel);
}

.rail-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  text-align: left;
}

.rail-item span {
  font-size: 12px;
  font-weight: 600;
}

.rail-item em {
  font-style: normal;
  font-size: 10px;
  color: var(--text-muted);
}

.rail-item:hover {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.rail-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.main {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.subtabs {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
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

.empty,
.placeholder {
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

.placeholder h2 {
  margin: 0;
  font-size: 18px;
  color: var(--text-primary);
}

.placeholder p {
  margin: 0;
  max-width: 360px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-muted);
}

.placeholder .icon {
  color: var(--text-muted);
}

.badge {
  margin-top: 4px;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
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
