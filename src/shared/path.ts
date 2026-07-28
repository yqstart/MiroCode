const RECENT_KEY = "mirocode.recentFolders.v1";

export function loadRecentFolders(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecentFolder(path: string): string[] {
  const next = [path, ...loadRecentFolders().filter((x) => x !== path)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}
