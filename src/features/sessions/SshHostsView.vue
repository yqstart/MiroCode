<script setup lang="ts">
import { computed, ref } from "vue";
import {
  Pencil,
  Plus,
  Server,
  Trash2,
  X,
} from "lucide-vue-next";
import type { SshConnectConfig } from "@/shared/sshApi";
import {
  createEmptyProfile,
  loadSshProfiles,
  removeSshProfile,
  upsertSshProfile,
  type SshProfile,
} from "@/shared/sshProfiles";

const props = defineProps<{
  connecting?: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  connect: [config: SshConnectConfig];
}>();

const profiles = ref<SshProfile[]>(loadSshProfiles());
const showEditor = ref(false);
const editingId = ref<string | null>(null);
const form = ref<SshProfile>(createEmptyProfile());
const password = ref("");
const passphrase = ref("");
const remember = ref(true);
const unlockId = ref<string | null>(null);
const unlockPassword = ref("");
const unlockPassphrase = ref("");

const editorTitle = computed(() =>
  editingId.value ? "编辑主机" : "添加主机",
);

const AVATAR_COLORS = [
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f43f5e",
];

function avatarColor(profile: SshProfile): string {
  const key = profile.name || profile.host || profile.id;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function avatarLetter(profile: SshProfile): string {
  const label = (profile.name || profile.host || "?").trim();
  return label.slice(0, 1).toUpperCase() || "?";
}

function refreshProfiles() {
  profiles.value = loadSshProfiles();
}

function openAdd() {
  editingId.value = null;
  form.value = createEmptyProfile();
  password.value = "";
  passphrase.value = "";
  remember.value = true;
  unlockId.value = null;
  showEditor.value = true;
}

function openEdit(profile: SshProfile, event: MouseEvent) {
  event.stopPropagation();
  editingId.value = profile.id;
  form.value = { ...profile };
  password.value = "";
  passphrase.value = "";
  remember.value = true;
  unlockId.value = null;
  showEditor.value = true;
}

function closeEditor() {
  showEditor.value = false;
  editingId.value = null;
}

function onDeleteProfile(profile: SshProfile, event: MouseEvent) {
  event.stopPropagation();
  removeSshProfile(profile.id);
  if (editingId.value === profile.id) closeEditor();
  if (unlockId.value === profile.id) unlockId.value = null;
  refreshProfiles();
}

function saveProfileFromForm(): SshProfile | null {
  const host = form.value.host.trim();
  const username = form.value.username.trim();
  if (!host || !username) return null;
  const profile: SshProfile = {
    ...form.value,
    id: editingId.value || form.value.id || `profile-${Date.now()}`,
    name: form.value.name.trim() || `${username}@${host}`,
    host,
    username,
    port: Number(form.value.port) || 22,
  };
  if (remember.value || editingId.value) {
    upsertSshProfile(profile);
    refreshProfiles();
  }
  return profile;
}

function emitConnect(profile: SshProfile, pwd: string, pass: string) {
  const config: SshConnectConfig = {
    host: profile.host,
    port: Number(profile.port) || 22,
    username: profile.username,
    authKind: profile.authKind,
    password: profile.authKind === "password" ? pwd : undefined,
    privateKeyPath:
      profile.authKind === "key" ? profile.privateKeyPath : undefined,
    passphrase: profile.authKind === "key" ? pass || undefined : undefined,
  };
  emit("connect", config);
}

function onSaveAndConnect() {
  const profile = saveProfileFromForm();
  if (!profile) return;
  if (profile.authKind === "password" && !password.value) {
    // 保存后仍需密码才能连
    closeEditor();
    unlockId.value = profile.id;
    unlockPassword.value = "";
    return;
  }
  emitConnect(profile, password.value, passphrase.value);
  closeEditor();
}

function onSaveOnly() {
  const profile = saveProfileFromForm();
  if (!profile) return;
  closeEditor();
}

function onCardClick(profile: SshProfile) {
  if (props.connecting) return;
  if (profile.authKind === "password") {
    unlockId.value = profile.id;
    unlockPassword.value = "";
    unlockPassphrase.value = "";
    showEditor.value = false;
    return;
  }
  if (profile.authKind === "key") {
    // 有口令时弹出解锁，否则直接连
    unlockId.value = profile.id;
    unlockPassword.value = "";
    unlockPassphrase.value = "";
    showEditor.value = false;
    return;
  }
}

function confirmUnlock() {
  const profile = profiles.value.find((p) => p.id === unlockId.value);
  if (!profile) return;
  if (profile.authKind === "password" && !unlockPassword.value) return;
  emitConnect(profile, unlockPassword.value, unlockPassphrase.value);
  unlockId.value = null;
}

function cancelUnlock() {
  unlockId.value = null;
}

const unlocking = computed(() =>
  profiles.value.find((p) => p.id === unlockId.value) ?? null,
);
</script>

<template>
  <div class="hosts">
    <header class="toolbar">
      <button type="button" class="tool-btn primary" @click="openAdd">
        <Plus :size="15" />
        添加主机
      </button>
    </header>

    <div class="content">
      <h2 class="section-title">主机</h2>

      <div v-if="profiles.length" class="grid">
        <button
          v-for="profile in profiles"
          :key="profile.id"
          type="button"
          class="card"
          :disabled="connecting"
          @click="onCardClick(profile)"
        >
          <span
            class="avatar"
            :style="{ background: avatarColor(profile) }"
          >
            {{ avatarLetter(profile) }}
          </span>
          <span class="meta">
            <span class="name">{{ profile.name || `${profile.username}@${profile.host}` }}</span>
            <span class="sub">ssh, {{ profile.username }}</span>
          </span>
          <span class="card-actions">
            <span
              class="icon-hit"
              title="编辑"
              @click="openEdit(profile, $event)"
            >
              <Pencil :size="13" />
            </span>
            <span
              class="icon-hit danger"
              title="删除"
              @click="onDeleteProfile(profile, $event)"
            >
              <Trash2 :size="13" />
            </span>
          </span>
        </button>
      </div>

      <div v-else class="empty">
        <Server :size="28" :stroke-width="1.5" class="empty-icon" />
        <p>还没有保存的主机</p>
        <p class="empty-hint">添加主机后可一键连接；密码不会落盘。</p>
        <button type="button" class="cta" @click="openAdd">添加主机</button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <!-- 添加 / 编辑主机 -->
    <div v-if="showEditor" class="overlay" @mousedown.self="closeEditor">
      <div class="sheet" @click.stop>
        <header class="sheet-head">
          <h3>{{ editorTitle }}</h3>
          <button type="button" class="icon-btn" title="关闭" @click="closeEditor">
            <X :size="16" />
          </button>
        </header>
        <div class="sheet-body">
          <label class="field">
            <span>显示名称</span>
            <input
              v-model="form.name"
              class="ui-input"
              type="text"
              placeholder="主机显示名称"
              autocomplete="off"
            />
          </label>
          <div class="row-2">
            <label class="field grow">
              <span>主机</span>
              <input
                v-model="form.host"
                class="ui-input"
                type="text"
                placeholder="example.com"
                autocomplete="off"
              />
            </label>
            <label class="field narrow">
              <span>端口</span>
              <input
                v-model.number="form.port"
                class="ui-input"
                type="number"
                min="1"
                max="65535"
              />
            </label>
          </div>
          <label class="field">
            <span>用户名</span>
            <input
              v-model="form.username"
              class="ui-input"
              type="text"
              placeholder="root"
              autocomplete="off"
            />
          </label>
          <label class="field">
            <span>认证方式</span>
            <select v-model="form.authKind" class="ui-select">
              <option value="password">密码</option>
              <option value="key">私钥</option>
            </select>
          </label>
          <label v-if="form.authKind === 'password'" class="field">
            <span>密码（连接时使用，不保存）</span>
            <input
              v-model="password"
              class="ui-input"
              type="password"
              autocomplete="new-password"
              spellcheck="false"
            />
          </label>
          <template v-else>
            <label class="field">
              <span>私钥路径</span>
              <input
                v-model="form.privateKeyPath"
                class="ui-input"
                type="text"
                placeholder="~/.ssh/id_ed25519"
                autocomplete="off"
                spellcheck="false"
              />
            </label>
            <label class="field">
              <span>私钥口令（可选，不保存）</span>
              <input
                v-model="passphrase"
                class="ui-input"
                type="password"
                autocomplete="new-password"
                spellcheck="false"
              />
            </label>
          </template>
          <label v-if="!editingId" class="check">
            <input v-model="remember" type="checkbox" />
            <span>保存到主机列表（不含密码）</span>
          </label>
        </div>
        <footer class="sheet-foot">
          <button type="button" class="ghost" @click="closeEditor">取消</button>
          <button
            type="button"
            class="ghost"
            :disabled="!form.host.trim() || !form.username.trim()"
            @click="onSaveOnly"
          >
            仅保存
          </button>
          <button
            type="button"
            class="cta"
            :disabled="connecting || !form.host.trim() || !form.username.trim()"
            @click="onSaveAndConnect"
          >
            {{ connecting ? "连接中…" : "保存并连接" }}
          </button>
        </footer>
      </div>
    </div>

    <!-- 连接解锁（密码 / 私钥口令） -->
    <div v-if="unlocking" class="overlay" @mousedown.self="cancelUnlock">
      <div class="sheet compact" @click.stop>
        <header class="sheet-head">
          <h3>连接 {{ unlocking.name || unlocking.host }}</h3>
          <button type="button" class="icon-btn" title="关闭" @click="cancelUnlock">
            <X :size="16" />
          </button>
        </header>
        <div class="sheet-body">
          <p class="unlock-meta">ssh · {{ unlocking.username }}@{{ unlocking.host }}:{{ unlocking.port }}</p>
          <label v-if="unlocking.authKind === 'password'" class="field">
            <span>密码</span>
            <input
              v-model="unlockPassword"
              class="ui-input"
              type="password"
              autocomplete="new-password"
              spellcheck="false"
              @keydown.enter="confirmUnlock"
            />
          </label>
          <label v-else class="field">
            <span>私钥口令（如无请留空）</span>
            <input
              v-model="unlockPassphrase"
              class="ui-input"
              type="password"
              autocomplete="new-password"
              spellcheck="false"
              @keydown.enter="confirmUnlock"
            />
          </label>
        </div>
        <footer class="sheet-foot">
          <button type="button" class="ghost" @click="cancelUnlock">取消</button>
          <button
            type="button"
            class="cta"
            :disabled="connecting || (unlocking.authKind === 'password' && !unlockPassword)"
            @click="confirmUnlock"
          >
            {{ connecting ? "连接中…" : "连接" }}
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hosts {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-app);
  position: relative;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
  flex-shrink: 0;
}

.tool-btn {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}

.tool-btn.primary {
  background: var(--accent);
  border-color: transparent;
  color: var(--accent-fg);
}

.tool-btn:hover {
  filter: brightness(1.05);
}

.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 20px 20px 32px;
}

.section-title {
  margin: 0 0 14px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 12px 14px 14px;
  border-radius: 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-card);
  text-align: left;
  color: var(--text-primary);
  min-height: 64px;
}

.card:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border-subtle));
  background: color-mix(in srgb, var(--accent-soft) 55%, var(--bg-elevated));
}

.card:disabled {
  opacity: 0.6;
  cursor: wait;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
}

.meta {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.card:hover .card-actions {
  opacity: 1;
}

.icon-hit {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}

.icon-hit:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.icon-hit.danger:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 240px;
  color: var(--text-secondary);
  text-align: center;
}

.empty-icon {
  color: var(--text-muted);
  margin-bottom: 4px;
}

.empty-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.cta {
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
  margin-top: 6px;
}

.cta:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.error {
  margin: 16px 0 0;
  font-size: 12px;
  color: var(--danger);
}

.overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 20px;
  background: var(--bg-overlay);
}

.sheet {
  width: min(440px, 100%);
  max-height: min(90%, 640px);
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
  overflow: hidden;
}

.sheet.compact {
  width: min(360px, 100%);
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.sheet-head h3 {
  margin: 0;
  font-size: 15px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}

.icon-btn:hover {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.sheet-body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
}

.sheet-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-subtle);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.row-2 {
  display: flex;
  gap: 10px;
}

.grow {
  flex: 1;
  min-width: 0;
}

.narrow {
  width: 96px;
  flex-shrink: 0;
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.ghost {
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  background: transparent;
}

.ghost:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.ghost:disabled {
  opacity: 0.4;
}

.unlock-meta {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
