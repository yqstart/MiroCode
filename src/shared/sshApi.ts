import { invoke } from "@tauri-apps/api/core";

export type SshAuthKind = "password" | "key";

export interface SshConnectConfig {
  host: string;
  port: number;
  username: string;
  authKind: SshAuthKind;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  /** 用户已确认信任未知主机密钥 */
  acceptUnknownHostKey?: boolean;
  /** 主机显示名称（会话标签用） */
  displayName?: string;
}

/** 解析后端 `SSH_HOST_KEY_UNKNOWN|指纹|host:port`（允许外层包一层错误文案） */
export function parseHostKeyUnknown(
  message: string,
): { fingerprint: string; endpoint: string } | null {
  const marker = "SSH_HOST_KEY_UNKNOWN|";
  const idx = message.indexOf(marker);
  if (idx < 0) return null;
  const parts = message.slice(idx).split("|");
  if (parts.length < 3) return null;
  const fingerprint = parts[1]?.trim();
  const endpoint = parts.slice(2).join("|").trim();
  if (!fingerprint || !endpoint) return null;
  return { fingerprint, endpoint };
}

export interface SftpEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

export async function sshShellOpen(
  id: string,
  config: SshConnectConfig,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("ssh_shell_open", { id, config, cols, rows });
}

export async function sshShellWrite(id: string, data: string): Promise<void> {
  return invoke("ssh_shell_write", { id, data });
}

export async function sshShellResize(
  id: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("ssh_shell_resize", { id, cols, rows });
}

export async function sshShellClose(id: string): Promise<void> {
  return invoke("ssh_shell_close", { id });
}

export async function sftpOpen(id: string, config: SshConnectConfig): Promise<void> {
  return invoke("sftp_open", { id, config });
}

export async function sftpList(id: string, path: string): Promise<SftpEntry[]> {
  return invoke("sftp_list", { id, path });
}

export async function sftpPwd(id: string): Promise<string> {
  return invoke("sftp_pwd", { id });
}

export async function sftpUpload(
  id: string,
  localPath: string,
  remotePath: string,
): Promise<void> {
  return invoke("sftp_upload", { id, localPath, remotePath });
}

export async function sftpMkdir(id: string, path: string): Promise<void> {
  return invoke("sftp_mkdir", { id, path });
}

export async function sftpCreateFile(id: string, path: string): Promise<void> {
  return invoke("sftp_create_file", { id, path });
}

export async function sftpRename(
  id: string,
  from: string,
  to: string,
): Promise<void> {
  return invoke("sftp_rename", { id, from, to });
}

export async function sftpRemove(id: string, path: string): Promise<void> {
  return invoke("sftp_remove", { id, path });
}

export async function sftpClose(id: string): Promise<void> {
  return invoke("sftp_close", { id });
}
