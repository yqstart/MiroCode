import { linter, type Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { basename } from "@/shared/fs";

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

  if (!isJson && !isEnv) return [];

  return [
    linter((view: EditorView) => {
      const text = view.state.doc.toString();
      if (isJson) return jsonDiagnostics(text);
      if (isEnv) return envDuplicateDiagnostics(text);
      return [];
    }),
  ];
}
