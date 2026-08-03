import { invoke } from "@tauri-apps/api/core";
import type { SshAuthKind } from "@/shared/sshApi";

export interface SshProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authKind: SshAuthKind;
  privateKeyPath: string;
  /** 是否记住密码/口令（存于 ~/.mirocode/ssh-credentials.json） */
  rememberSecret?: boolean;
}

export interface SshSecret {
  password?: string;
  passphrase?: string;
}

const STORAGE_KEY = "mirocode.sshProfiles.v1";
/** 旧版 localStorage 密文，启动时迁移后删除 */
const LEGACY_SECRETS_KEY = "mirocode.sshSecrets.v1";

let migratePromise: Promise<void> | null = null;

/** 应用级全局主机列表（与工作区/项目无关） */

export function loadSshProfiles(): SshProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SshProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSshProfiles(profiles: SshProfile[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function upsertSshProfile(profile: SshProfile) {
  const list = loadSshProfiles().filter((p) => p.id !== profile.id);
  list.unshift(profile);
  saveSshProfiles(list.slice(0, 20));
}

export function removeSshProfile(id: string) {
  saveSshProfiles(loadSshProfiles().filter((p) => p.id !== id));
  void removeSshSecret(id);
}

async function migrateLegacySecrets(): Promise<void> {
  if (migratePromise) return migratePromise;
  migratePromise = (async () => {
    try {
      const raw = localStorage.getItem(LEGACY_SECRETS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, SshSecret>;
      if (!parsed || typeof parsed !== "object") {
        localStorage.removeItem(LEGACY_SECRETS_KEY);
        return;
      }
      for (const [profileId, secret] of Object.entries(parsed)) {
        if (!secret?.password && !secret?.passphrase) continue;
        await invoke("ssh_secret_set", {
          profileId,
          secret: {
            password: secret.password ?? null,
            passphrase: secret.passphrase ?? null,
          },
        });
      }
      localStorage.removeItem(LEGACY_SECRETS_KEY);
    } catch {
      // 迁移失败保留旧数据，下次再试
      migratePromise = null;
    }
  })();
  return migratePromise;
}

export async function getSshSecret(profileId: string): Promise<SshSecret | null> {
  await migrateLegacySecrets();
  try {
    const secret = await invoke<SshSecret | null>("ssh_secret_get", { profileId });
    if (!secret) return null;
    if (!secret.password && !secret.passphrase) return null;
    return secret;
  } catch {
    return null;
  }
}

export async function setSshSecret(profileId: string, secret: SshSecret): Promise<void> {
  await migrateLegacySecrets();
  await invoke("ssh_secret_set", {
    profileId,
    secret: {
      password: secret.password || null,
      passphrase: secret.passphrase || null,
    },
  });
}

export async function removeSshSecret(profileId: string): Promise<void> {
  await migrateLegacySecrets();
  try {
    await invoke("ssh_secret_remove", { profileId });
  } catch {
    // 忽略
  }
}

export function createEmptyProfile(): SshProfile {
  return {
    id: `profile-${Date.now()}`,
    name: "",
    host: "",
    port: 22,
    username: "",
    authKind: "password",
    privateKeyPath: "~/.ssh/id_ed25519",
    rememberSecret: true,
  };
}
