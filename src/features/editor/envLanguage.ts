import { StreamLanguage, type StreamParser } from "@codemirror/language";

type EnvPhase =
  | "lineStart"
  | "afterExport"
  | "beforeEquals"
  | "value"
  | "comment";

interface EnvState {
  phase: EnvPhase;
}

/** 判断文件名是否属于 dotenv 约定的环境变量文件。 */
export function isEnvFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === ".env" || lower.startsWith(".env.");
}

const envParser: StreamParser<EnvState> = {
  name: "env",
  startState: () => ({ phase: "lineStart" }),
  blankLine: (state) => {
    state.phase = "lineStart";
  },
  token(stream, state) {
    if (stream.sol()) state.phase = "lineStart";

    if (state.phase === "comment") {
      stream.skipToEnd();
      return "comment";
    }

    if (state.phase === "lineStart") {
      if (stream.match(/\s*#.*$/)) {
        state.phase = "comment";
        return "comment";
      }
      if (stream.match(/\s*export\b(?=\s+)/)) {
        state.phase = "afterExport";
        return "keyword";
      }
      if (stream.match(/\s*[A-Za-z_][A-Za-z0-9_.-]*(?=\s*=)/)) {
        state.phase = "beforeEquals";
        return "def";
      }
      if (stream.match(/\s+/)) return null;
    }

    if (state.phase === "afterExport") {
      if (stream.match(/\s*[A-Za-z_][A-Za-z0-9_.-]*(?=\s*=)/)) {
        state.phase = "beforeEquals";
        return "def";
      }
      if (stream.match(/\s+/)) return null;
    }

    if (state.phase === "beforeEquals") {
      if (stream.match(/\s+/)) return null;
      if (stream.match(/=/)) {
        state.phase = "value";
        return "operator";
      }
    }

    if (state.phase === "value") {
      if (stream.match(/\s+#.*$/) || stream.match(/#.*$/)) {
        state.phase = "comment";
        return "comment";
      }
      if (stream.match(/"(?:\\.|[^"\\])*"/) || stream.match(/'(?:\\.|[^'\\])*'/)) {
        return "string";
      }
      if (stream.match(/[^\s#]+/)) return "string";
      if (stream.match(/\s+/)) return null;
    }

    if (stream.match(/#.*$/)) {
      state.phase = "comment";
      return "comment";
    }
    stream.next();
    return null;
  },
};

/** dotenv 语法高亮：键、export、等号、值和注释分别交给主题着色。 */
export const envLanguage = StreamLanguage.define(envParser);
