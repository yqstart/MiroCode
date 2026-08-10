/**
 * 语言服务捆绑包安装器（单例）
 *
 * 封装 ls://progress 事件监听、安装/卸载/状态查询的幂等与并发控制，
 * 供设置面板「语言服务」分区消费。安装完成后自动清除 LSP 运行时检测缓存，
 * 使编辑器立即使用内置的 Node + language server。
 */

import { getLsStatus, installLs, onLsProgress, uninstallLs } from "./transport";
import { clearRuntimeCache } from "./nodeDetector";
import type { LsMirror, LsStatus } from "./types";
import type { UnlistenFn } from "@tauri-apps/api/event";

/** 安装阶段 id（与 Rust 侧 LsProgressEvent.phase 对应） */
export type LsPhase = "idle" | "manifest" | "download" | "verify" | "extract" | "done";

/** 安装器状态 */
export interface InstallerState {
  /** 当前阶段 */
  phase: LsPhase;
  /** 下载进度 0-100 */
  percent: number;
  /** 当前状态（远端清单 + 本地安装版本） */
  status: LsStatus | null;
  /** 最近一次错误信息 */
  error: string | null;
  /** 操作进行中（安装/卸载） */
  busy: boolean;
}

/** 状态变更回调 */
type Listener = (state: InstallerState) => void;

class LanguageServiceInstaller {
  private state: InstallerState = {
    phase: "idle",
    percent: 0,
    status: null,
    error: null,
    busy: false,
  };
  private listeners: Listener[] = [];
  private unlisten: UnlistenFn | null = null;
  private ready = false;

  /** 订阅状态变化，返回取消函数 */
  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /** 获取当前状态（供非订阅场景一次性读取） */
  getState(): InstallerState {
    return this.state;
  }

  private setState(patch: Partial<InstallerState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // 订阅者异常不影响安装流程
      }
    }
  }

  /** 惰性注册进度事件监听（仅一次） */
  private async ensureListening(): Promise<void> {
    if (this.ready) return;
    this.ready = true;
    try {
      this.unlisten = await onLsProgress((event) => {
        const phase = (event.phase ?? "done") as LsPhase;
        this.setState({
          phase,
          percent: Math.round(event.percent ?? 0),
          busy: phase !== "done",
        });
      });
    } catch {
      // 非 Tauri 环境（纯 Vite 预览）：静默降级，安装功能不可用
      this.ready = false;
    }
  }

  /** 查询状态（刷新远端最新版本） */
  async refresh(mirror: LsMirror, customBase?: string | null): Promise<void> {
    try {
      const status = await getLsStatus(mirror, customBase ?? null);
      this.setState({ status, error: null });
    } catch (err) {
      this.setState({ status: null, error: String(err) });
    }
  }

  /** 一键安装 / 更新 */
  async install(mirror: LsMirror, customBase?: string | null): Promise<boolean> {
    await this.ensureListening();
    if (this.state.busy) return false;

    this.setState({ busy: true, phase: "manifest", percent: 0, error: null });
    try {
      await installLs(mirror, customBase ?? null);
      // 安装成功：清除运行时检测缓存，使 LSP 立即切换到内置环境
      clearRuntimeCache();
      this.setState({ phase: "done", percent: 100, busy: false });
      await this.refresh(mirror, customBase);
      return true;
    } catch (err) {
      this.setState({
        phase: "idle",
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /** 卸载 */
  async uninstall(): Promise<boolean> {
    await this.ensureListening();
    if (this.state.busy) return false;

    this.setState({ busy: true, phase: "idle", percent: 0, error: null });
    try {
      await uninstallLs();
      clearRuntimeCache();
      this.setState({ busy: false });
      await this.refresh("auto");
      return true;
    } catch (err) {
      this.setState({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /** 销毁（取消事件监听） */
  dispose(): void {
    if (this.unlisten) {
      try {
        this.unlisten();
      } catch {
        // 忽略
      }
      this.unlisten = null;
    }
    this.ready = false;
    this.listeners = [];
  }
}

/** 全局单例 */
export const lsInstaller = new LanguageServiceInstaller();
