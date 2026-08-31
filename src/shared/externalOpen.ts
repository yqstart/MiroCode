/**
 * 外部编辑器打开请求：由 Rust 端统一接收 CLI / macOS Launch Services，
 * 再通过 `app://open-external` 事件交给当前主窗口。
 */
export interface ExternalOpenTarget {
  path: string;
  line?: number;
  column?: number;
  isDir: boolean;
}
export interface ExternalOpenRequest {
  targets: ExternalOpenTarget[];
}
