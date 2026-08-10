/**
 * 宿主运行时检测（缓存结果）
 *
 * 检测 node / typescript-language-server / vue-language-server 是否可用，
 * 决定 LSP 是否可启动，不可用时降级回 v1 正则方案。
 */

import { checkRuntime } from "./transport";
import type { RuntimeCheck } from "./types";

/** 缓存的检测结果 */
let cached: RuntimeCheck | null = null;

/** 是否正在检测中 */
let detecting = false;
let detectPromise: Promise<RuntimeCheck> | null = null;

/** 获取运行时检测结果（带缓存） */
export async function detectRuntime(): Promise<RuntimeCheck> {
  if (cached) return cached;
  if (detecting && detectPromise) return detectPromise;

  detecting = true;
  detectPromise = checkRuntime()
    .then((result) => {
      cached = result;
      detecting = false;
      return result;
    })
    .catch(() => {
      // 检测失败，视为全部不可用
      cached = {
        node: false,
        tsLs: false,
        volar: false,
        bundledVersion: null,
      };
      detecting = false;
      return cached;
    });

  return detectPromise;
}

/** 清除缓存（工作区切换或用户手动重新检测时调用） */
export function clearRuntimeCache(): void {
  cached = null;
}

/** Node 是否可用 */
export async function isNodeAvailable(): Promise<boolean> {
  const r = await detectRuntime();
  return r.node;
}

/** TS language server 是否可用 */
export async function isTsLsAvailable(): Promise<boolean> {
  const r = await detectRuntime();
  return r.node && r.tsLs;
}

/** Vue language server 是否可用 */
export async function isVolarAvailable(): Promise<boolean> {
  const r = await detectRuntime();
  return r.node && r.volar;
}
