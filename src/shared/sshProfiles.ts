import type { SshAuthKind } from "@/shared/sshApi";

export interface SshProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authKind: SshAuthKind;
  privateKeyPath: string;
}

const STORAGE_KEY = "mirocode.sshProfiles.v1";

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
  };
}
