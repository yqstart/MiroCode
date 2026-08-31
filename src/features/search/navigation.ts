export interface SearchKeyboardEvent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

export type SearchKeyAction =
  | { type: "close" }
  | { type: "move"; delta: -1 | 1 }
  | { type: "open"; keepOpen: boolean }
  | { type: "search" };

export function getSearchKeyAction(
  event: SearchKeyboardEvent,
  options: { hasResults: boolean; isQueryInput: boolean },
): SearchKeyAction | null {
  if (event.key === "Escape") return { type: "close" };
  if (event.key === "ArrowDown") return { type: "move", delta: 1 };
  if (event.key === "ArrowUp") return { type: "move", delta: -1 };
  if (event.key !== "Enter" || event.shiftKey) return null;

  if (options.hasResults) {
    return {
      type: "open",
      keepOpen: event.metaKey || event.ctrlKey,
    };
  }
  if (options.isQueryInput) return { type: "search" };
  return null;
}
