/**
 * 编辑器行内 git blame（对齐 Cursor / GitLens）：
 * - hover 任意行 → 悬浮显示该行最后提交信息（摘要 / 作者 / 短 hash / 日期）
 * - 可选常驻 blame 列：每段 blame 块首行显示「作者 + 短 hash」，其余行以细线衔接
 */
import {
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutter,
  hoverTooltip,
  type PluginValue,
  type Tooltip,
} from "@codemirror/view";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { gitBlame, type GitBlameLine } from "@/shared/gitApi";

const setBlameEffect = StateEffect.define<GitBlameLine[]>();

const blameField = StateField.define<GitBlameLine[]>({
  create: () => [],
  update: (value, tr) => {
    for (const e of tr.effects) {
      if (e.is(setBlameEffect)) return e.value;
    }
    return value;
  },
});

function shortHash(id: string): string {
  return id.slice(0, 7);
}

function truncateAuthor(name: string): string {
  const n = name.trim() || "?";
  return n.length > 12 ? `${n.slice(0, 11)}…` : n;
}

class BlameMarker extends GutterMarker {
  constructor(
    private commitId: string,
    private start: boolean,
    private author: string,
    private hash: string,
  ) {
    super();
  }
  eq(other: GutterMarker): boolean {
    return (
      other instanceof BlameMarker &&
      other.commitId === this.commitId &&
      other.start === this.start
    );
  }
  toDOM(): Node {
    const el = document.createElement("div");
    el.className = "cm-miro-blame-line";
    if (this.start) {
      const author = document.createElement("span");
      author.className = "cm-miro-blame-author";
      author.textContent = truncateAuthor(this.author);
      const hash = document.createElement("span");
      hash.className = "cm-miro-blame-hash";
      hash.textContent = this.hash;
      el.append(author, hash);
    }
    return el;
  }
}

const blameTheme = EditorView.theme({
  ".cm-miro-blame": {
    backgroundColor: "color-mix(in srgb, var(--bg-panel) 55%, transparent)",
    textAlign: "left",
    whiteSpace: "nowrap",
  },
  ".cm-miro-blame .cm-gutterElement": {
    padding: "0 6px 0 4px",
  },
  ".cm-miro-blame-line": {
    height: "100%",
    borderLeft: "1px solid color-mix(in srgb, var(--text-muted) 22%, transparent)",
    paddingLeft: "5px",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    overflow: "hidden",
  },
  ".cm-miro-blame-author": {
    color: "var(--text-secondary)",
    fontSize: "11px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "12ch",
  },
  ".cm-miro-blame-hash": {
    color: "var(--text-muted)",
    fontSize: "10px",
    fontFamily: "var(--miro-editor-font-family, var(--font-mono))",
  },
  ".cm-miro-blame-tooltip": {
    backgroundColor: "var(--bg-elevated)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "8px",
    padding: "6px 10px",
    maxWidth: "420px",
    boxShadow: "var(--shadow-popover)",
    fontFamily: "var(--font-ui)",
  },
  ".cm-miro-blame-tooltip .summary": {
    fontWeight: "600",
    fontSize: "12px",
    marginBottom: "4px",
    wordBreak: "break-word",
  },
  ".cm-miro-blame-tooltip .meta": {
    fontSize: "11px",
    color: "var(--text-muted)",
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  ".cm-miro-blame-tooltip .meta .hash": {
    fontFamily: "var(--miro-editor-font-family, var(--font-mono))",
  },
});

export interface GitBlameOptions {
  root: string;
  relPath: string;
  /** 是否显示常驻 blame 列（hover 悬浮始终开启） */
  showGutter: boolean;
}

class GitBlamePlugin implements PluginValue {
  private gen = 0;
  private disposed = false;

  constructor(private view: EditorView, private opts: GitBlameOptions) {
    this.load();
  }

  async load(): Promise<void> {
    const gen = ++this.gen;
    let lines: GitBlameLine[];
    try {
      lines = await gitBlame(this.opts.root, this.opts.relPath);
    } catch {
      // 非 git 仓库 / blame 失败：静默，无 blame 信息
      return;
    }
    if (this.disposed || gen !== this.gen) return;
    this.view.dispatch({ effects: setBlameEffect.of(lines) });
  }

  destroy(): void {
    this.disposed = true;
  }
}

function blameTooltip(info: GitBlameLine, pos: number, end: number): Tooltip {
  return {
    pos,
    end,
    above: true,
    create(): { dom: HTMLElement } {
      const dom = document.createElement("div");
      dom.className = "cm-miro-blame-tooltip";

      const summary = document.createElement("div");
      summary.className = "summary";
      summary.textContent = info.summary || "(无提交说明)";
      dom.appendChild(summary);

      const meta = document.createElement("div");
      meta.className = "meta";
      const author = document.createElement("span");
      author.textContent = info.author || "unknown";
      const hash = document.createElement("span");
      hash.className = "hash";
      hash.textContent = shortHash(info.commitId);
      const time = document.createElement("span");
      time.textContent = info.time;
      meta.append(author, hash, time);
      dom.appendChild(meta);

      return { dom };
    },
  };
}

export function gitBlameExtension(opts: GitBlameOptions): Extension {
  const plugin = ViewPlugin.define((view) => new GitBlamePlugin(view, opts));

  const hover = hoverTooltip((view, pos) => {
    const lines = view.state.field(blameField);
    if (!lines.length) return null;
    const line = view.state.doc.lineAt(pos);
    const info = lines[line.number - 1];
    if (!info) return null;
    return blameTooltip(info, line.from, line.to);
  });

  const parts: Extension[] = [blameField, hover, plugin];

  if (opts.showGutter) {
    parts.push(
      gutter({
        class: "cm-miro-blame",
        lineMarker(view, line) {
          const lines = view.state.field(blameField);
          const lineNo = view.state.doc.lineAt(line.from).number;
          const cur = lines[lineNo - 1];
          if (!cur) return null;
          const prev = lines[lineNo - 2];
          const start = !prev || prev.commitId !== cur.commitId;
          return new BlameMarker(
            cur.commitId,
            start,
            start ? cur.author : "",
            start ? shortHash(cur.commitId) : "",
          );
        },
      }),
      blameTheme,
    );
  }

  return parts;
}
