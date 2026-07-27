<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SshConnectConfig } from "@/shared/sshApi";
import {
  createEmptyProfile,
  loadSshProfiles,
  removeSshProfile,
  upsertSshProfile,
  type SshProfile,
} from "@/shared/sshProfiles";

defineProps<{
  title: string;
  connecting?: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  connect: [config: SshConnectConfig];
}>();

const profiles = ref<SshProfile[]>(loadSshProfiles());
const selectedId = ref<string>("");
const form = ref<SshProfile>(createEmptyProfile());
const password = ref("");
const passphrase = ref("");
const remember = ref(true);

const selectedProfile = computed(() =>
  profiles.value.find((p) => p.id === selectedId.value) ?? null,
);

watch(
  selectedProfile,
  (p) => {
    if (!p) return;
    form.value = { ...p };
    password.value = "";
    passphrase.value = "";
  },
  { immediate: true },
);

function refreshProfiles() {
  profiles.value = loadSshProfiles();
}

function onSelectProfile(id: string) {
  selectedId.value = id;
  if (!id) {
    form.value = createEmptyProfile();
    password.value = "";
    passphrase.value = "";
  }
}

function onDeleteProfile() {
  if (!selectedId.value) return;
  removeSshProfile(selectedId.value);
  selectedId.value = "";
  form.value = createEmptyProfile();
  refreshProfiles();
}

function onSubmit() {
  const host = form.value.host.trim();
  const username = form.value.username.trim();
  if (!host || !username) return;

  if (remember.value) {
    const profile: SshProfile = {
      ...form.value,
      id: form.value.id || `profile-${Date.now()}`,
      name: form.value.name.trim() || `${username}@${host}`,
      host,
      username,
      port: Number(form.value.port) || 22,
    };
    upsertSshProfile(profile);
    form.value.id = profile.id;
    selectedId.value = profile.id;
    refreshProfiles();
  }

  const config: SshConnectConfig = {
    host,
    port: Number(form.value.port) || 22,
    username,
    authKind: form.value.authKind,
    password: form.value.authKind === "password" ? password.value : undefined,
    privateKeyPath:
      form.value.authKind === "key" ? form.value.privateKeyPath : undefined,
    passphrase: form.value.authKind === "key" ? passphrase.value || undefined : undefined,
  };
  emit("connect", config);
}
</script>

<template>
  <div class="connect">
    <h2>{{ title }}</h2>
    <p class="hint">密码不会保存；主机信息可记住便于下次连接。</p>

    <label class="field">
      <span>已保存连接</span>
      <div class="row">
        <select
          class="ui-select grow"
          :value="selectedId"
          @change="onSelectProfile(($event.target as HTMLSelectElement).value)"
        >
          <option value="">新建连接…</option>
          <option v-for="p in profiles" :key="p.id" :value="p.id">
            {{ p.name || `${p.username}@${p.host}` }}
          </option>
        </select>
        <button
          type="button"
          class="ghost"
          :disabled="!selectedId"
          @click="onDeleteProfile"
        >
          删除
        </button>
      </div>
    </label>

    <div class="grid">
      <label class="field">
        <span>主机</span>
        <input v-model="form.host" class="ui-input" type="text" placeholder="example.com" autocomplete="off" />
      </label>
      <label class="field narrow">
        <span>端口</span>
        <input v-model.number="form.port" class="ui-input" type="number" min="1" max="65535" />
      </label>
      <label class="field">
        <span>用户名</span>
        <input v-model="form.username" class="ui-input" type="text" placeholder="root" autocomplete="off" />
      </label>
      <label class="field">
        <span>认证方式</span>
        <select v-model="form.authKind" class="ui-select">
          <option value="password">密码</option>
          <option value="key">私钥</option>
        </select>
      </label>
      <label v-if="form.authKind === 'password'" class="field full">
        <span>密码</span>
        <input
          v-model="password"
          class="ui-input"
          type="password"
          autocomplete="new-password"
          spellcheck="false"
        />
      </label>
      <template v-else>
        <label class="field full">
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
        <label class="field full">
          <span>私钥口令（可选）</span>
          <input
            v-model="passphrase"
            class="ui-input"
            type="password"
            autocomplete="new-password"
            spellcheck="false"
          />
        </label>
      </template>
    </div>

    <label class="check">
      <input v-model="remember" type="checkbox" />
      <span>记住主机信息（不含密码）</span>
    </label>

    <p v-if="error" class="error">{{ error }}</p>

    <button
      type="button"
      class="cta"
      :disabled="connecting || !form.host.trim() || !form.username.trim()"
      @click="onSubmit"
    >
      {{ connecting ? "连接中…" : "连接" }}
    </button>
  </div>
</template>

<style scoped>
.connect {
  width: min(480px, 100%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-align: left;
}

h2 {
  margin: 0;
  font-size: 18px;
  color: var(--text-primary);
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 100px;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.field.full {
  grid-column: 1 / -1;
}

.field.narrow {
  min-width: 0;
}

.row {
  display: flex;
  gap: 8px;
}

.grow {
  flex: 1;
  min-width: 0;
}

.ghost {
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
}

.ghost:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}

.ghost:disabled {
  opacity: 0.4;
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}

.cta {
  height: 36px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
}

.cta:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
