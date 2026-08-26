export interface DockMenuEvent {
  id: string;
  path?: string;
}

export interface DockMenuHandlers {
  openFolder: () => void;
  openRecentInNewWindow: (path: string) => void;
}

/** 将 Dock 菜单事件映射到对应的工作区打开方式。 */
export function dispatchDockMenuEvent(
  event: DockMenuEvent,
  handlers: DockMenuHandlers,
): void {
  if (event.id === "open_folder") {
    handlers.openFolder();
    return;
  }
  if (event.id === "recent" && event.path) {
    handlers.openRecentInNewWindow(event.path);
  }
}
