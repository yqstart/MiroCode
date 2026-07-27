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

export async function sftpClose(id: string): Promise<void> {
  return invoke("sftp_close", { id });
}
