import changelogRaw from "../../CHANGELOG.md?raw";

const GITHUB_REPO = "yqstart/MiroCode";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 从 CHANGELOG 文本中提取指定版本节（含 `## [x.y.z]` 标题） */
export function extractChangelogSection(
  markdown: string,
  version: string,
): string | null {
  const v = version.replace(/^v/i, "").trim();
  if (!v) return null;
  const re = new RegExp(
    `^## \\[${escapeRegExp(v)}\\][\\s\\S]*?(?=^## \\[|$)`,
    "m",
  );
  const match = markdown.match(re);
  return match?.[0]?.trim() ?? null;
}

/** 读取应用内置 CHANGELOG 中对应版本的更新说明 */
export function getBundledChangelog(version: string): string | null {
  return extractChangelogSection(changelogRaw, version);
}

function isGenericReleaseBody(body: string): boolean {
  return (
    body.includes("多平台安装包由 GitHub Actions 自动构建") ||
    body.includes("Built by GitHub Actions")
  );
}

/** 尝试从 GitHub 拉取指定 tag 的 CHANGELOG（旧版本客户端查看新 Release 时用） */
async function fetchRemoteChangelogSection(
  version: string,
): Promise<string | null> {
  const v = version.replace(/^v/i, "").trim();
  if (!v) return null;
  const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/v${v}/CHANGELOG.md`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const text = await res.text();
    return extractChangelogSection(text, v);
  } catch {
    return null;
  }
}

/**
 * 解析新版本更新说明：内置 CHANGELOG → Release body → 远端 CHANGELOG。
 */
export async function resolveUpdateNotes(
  version: string,
  releaseBody?: string,
): Promise<string> {
  const bundled = getBundledChangelog(version);
  if (bundled) return bundled;

  const body = (releaseBody ?? "").trim();
  if (body && !isGenericReleaseBody(body)) return body;

  const remote = await fetchRemoteChangelogSection(version);
  if (remote) return remote;

  return "";
}
