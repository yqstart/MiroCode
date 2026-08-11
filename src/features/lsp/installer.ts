/**
 * 语言服务安装器（单例，多语言独立管理）
 *
 * 封装 ls://progress 事件监听、安装/卸载/状态查询的幂等与并发控制，
 * 供设置面板「语言服务」分区消费。每语言独立维护安装状态与进度，
 * 安装完成后自动清除 LSP 运行时检测缓存，使编辑器立即使用对应语言服务。
 */

import { getLsStatus, installLs, onLsProgress, uninstallLs } from "./transport";
import { clearRuntimeCache } from "./nodeDetector";
import type { LanguageId, LsMirror, LsStatus } from "./types";
import type { UnlistenFn } from "@tauri-apps/api/event";

/** 安装阶段 id（与 Rust 侧 LsProgressEvent.phase 对应） */
export type LsPhase = "idle" | "manifest" | "download" | "verify" | "extract" | "done";

/** 单语言的安装器状态 */
export interface InstallerState {
  /** 当前语言 */
  language: LanguageId;
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

/** 状态变更回调（收到任意语言状态变更时触发） */
type Listener = (language: LanguageId, state: InstallerState) => void;

/** 生成某语言的初始空闲状态 */
function idleState(language: LanguageId): InstallerState {
  return { language, phase: "idle", percent: 0, status: null, error: null, busy: false };
}

class LanguageServiceInstaller {
  /** 每语言独立状态 */
  private states = new Map<LanguageId, InstallerState>([
    ["ts", idleState("ts")],
    ["vue", idleState("vue")],
  ]);
  private listeners: Listener[] = [];
  private unlisten: UnlistenFn | null = null;
  private ready = false;

  /** 订阅状态变化，返回取消函数 */
  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    // 首次推送所有语言当前状态
    for (const [lang, state] of this.states) {
      listener(lang, state);
    }
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /** 获取指定语言的当前状态（供非订阅场景一次性读取） */
  getState(language: LanguageId): InstallerState {
    return this.states.get(language) ?? idleState(language);
  }

  private setState(language: LanguageId, patch: Partial<InstallerState>): void {
    const cur = this.states.get(language) ?? idleState(language);
    const next = { ...cur, ...patch };
    this.states.set(language, next);
    for (const listener of this.listeners) {
      try {
        listener(language, next);
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
        // 进度事件不区分语言，当前实现：更新所有 busy 中的语言
        // （实际同一时刻只有一个语言在安装，因为后端有互斥锁）
        const phase = (event.phase ?? "done") as LsPhase;
        const percent = Math.round(event.percent ?? 0);
        for (const [lang, state] of this.states) {
          if (state.busy || phase === "done") {
            this.setState(lang, {
              phase,
              percent,
              busy: phase !== "done",
            });
          }
        }
      });
    } catch {
      // 非 Tauri 环境（纯 Vite 预览）：静默降级，安装功能不可用
      this.ready = false;
    }
  }

  /** 查询指定语言的状态（刷新远端最新版本） */
  async refresh(
    language: LanguageId,
    mirror: LsMirror,
    customBase?: string | null,
  ): Promise<void> {
    try {
      const status = await getLsStatus(language, mirror, customBase ?? null);
      this.setState(language, { status, error: null });
    } catch (err) {
      this.setState(language, { status: null, error: String(err) });
    }
  }

  /** 安装 / 更新指定语言 */
  async install(
    language: LanguageId,
    mirror: LsMirror,
    customBase?: string | null,
  ): Promise<boolean> {
    await this.ensureListening();
    if (this.getState(language).busy) return false;

    this.setState(language, { busy: true, phase: "manifest", percent: 0, error: null });
    try {
      await installLs(language, mirror, customBase ?? null);
      // 安装成功：清除运行时检测缓存，使 LSP 立即切换到对应语言服务
      clearRuntimeCache();
      this.setState(language, { phase: "done", percent: 100, busy: false });
      await this.refresh(language, mirror, customBase);
      return true;
    } catch (err) {
      this.setState(language, {
        phase: "idle",
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /** 卸载指定语言 */
  async uninstall(language: LanguageId): Promise<boolean> {
    await this.ensureListening();
    if (this.getState(language).busy) return false;

    this.setState(language, { busy: true, phase: "idle", percent: 0, error: null });
    try {
      await uninstallLs(language);
      clearRuntimeCache();
      this.setState(language, { busy: false });
      await this.refresh(language, "auto");
      return true;
    } catch (err) {
      this.setState(language, {
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
