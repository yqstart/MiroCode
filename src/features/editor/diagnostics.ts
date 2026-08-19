import { linter, type Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { basename } from "@/shared/fs";
import { createVueScriptContext } from "@/features/editor/vueScript";

function envDuplicateDiagnostics(text: string): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const seen = new Map<string, number>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const prev = seen.get(key);
    if (prev !== undefined) {
      const from = lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
      diags.push({
        from,
        to: from + line.indexOf(key) + key.length,
        severity: "warning",
        message: `重复的环境变量键「${key}」`,
      });
    } else {
      seen.set(key, i);
    }
  }
  return diags;
}

function jsonDiagnostics(text: string): Diagnostic[] {
  if (!text.trim()) return [];
  try {
    JSON.parse(text);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON 解析错误";
    const match = message.match(/position (\d+)/i);
    const pos = match ? Number(match[1]) : 0;
    return [
      {
        from: Math.max(0, pos),
        to: Math.min(text.length, pos + 1),
        severity: "error",
        message,
      },
    ];
  }
}

export function createDiagnosticsExtension(filePath: string) {
  const name = basename(filePath).toLowerCase();
  const isJson = name.endsWith(".json");
  const isEnv = name === ".env" || name.startsWith(".env.");

  const isScript = /\.(?:[cm]?ts|tsx|jsx|js|vue)$/i.test(filePath);
  if (!isJson && !isEnv && !isScript) return [];

  if (isScript) {
    return [
      linter(async (view: EditorView) => {
        try {
          const { useWorkspaceStore } = await import("@/stores/workspace");
          const root = useWorkspaceStore().rootPath;
          if (!root) return [];
          const source = view.state.doc.toString();
          const isVue = /\.vue$/i.test(filePath);
          const virtual = isVue ? createVueScriptContext(filePath, source) : null;
          const serviceFile = virtual?.fileName ?? filePath;
          const serviceText = virtual?.text ?? source;
          const { ensureTypeScriptProgram, tsService } = await import(
            "@/features/editor/typeService"
          );
          if (!(await ensureTypeScriptProgram(root, serviceFile, serviceText))) return [];
          return tsService
            .diagnosticsFor(serviceFile)
            .filter((item) => {
              if (!virtual) return true;
              return virtual.blocks.some(
                (block) => item.start >= block.start && item.start <= block.end,
              );
            })
            .map((item) => ({
              from: Math.max(0, item.start),
              to: Math.min(source.length, item.start + Math.max(1, item.length)),
              severity: item.severity,
              message: `${item.message} (TS${item.code})`,
            }));
        } catch {
          return [];
        }
      }),
    ];
  }

  return [
    linter((view: EditorView) => {
      const text = view.state.doc.toString();
      if (isJson) return jsonDiagnostics(text);
      if (isEnv) return envDuplicateDiagnostics(text);
      return [];
    }),
  ];
}
