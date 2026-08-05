import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { runScopeHandlers } from "@codemirror/view";
import { t } from "@/i18n";

const panelByView = new WeakMap<EditorView, MiroFindPanel>();

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

function bindButton(
  label: string,
  className: string,
  onClick: () => void,
  text?: string,
) {
  const btn = createEl(
    "button",
    {
      type: "button",
      class: `miro-find-btn ${className}`,
      "aria-label": label,
      title: label,
    },
    [text ?? label],
  );
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  return btn;
}

function getMatchStats(view: EditorView, query: SearchQuery) {
  if (!query.valid || !query.search.trim()) {
    return { current: 0, total: 0 };
  }
  const ranges: { from: number; to: number }[] = [];
  const cursor = query.getCursor(view.state, 0, view.state.doc.length);
  for (;;) {
    const next = cursor.next();
    if (next.done) break;
    ranges.push(next.value);
    if (ranges.length >= 10000) break;
  }
  if (!ranges.length) {
    return { current: 0, total: 0 };
  }
  const { from, to } = view.state.selection.main;
  let current = ranges.findIndex((r) => r.from === from && r.to === to) + 1;
  if (!current) {
    const nextIdx = ranges.findIndex((r) => r.from >= from);
    current = nextIdx >= 0 ? nextIdx + 1 : ranges.length;
  }
  return { current, total: ranges.length };
}

class MiroFindPanel implements Panel {
  dom: HTMLElement;
  private view: EditorView;
  private query: SearchQuery;
  private searchField: HTMLInputElement;
  private replaceField: HTMLInputElement;
  private matchCountEl: HTMLElement;
  private replaceRow: HTMLElement;
  private toggleReplaceBtn: HTMLButtonElement;
  private caseBtn: HTMLButtonElement;
  private regexBtn: HTMLButtonElement;
  private wordBtn: HTMLButtonElement;
  private showReplace = false;

  constructor(view: EditorView) {
    this.view = view;
    this.query = getSearchQuery(view.state);

    this.searchField = createEl(
      "input",
      {
        class: "miro-find-input",
        name: "search",
        form: "",
        "main-field": "true",
        "aria-label": t("editorFind.findPlaceholder"),
        placeholder: t("editorFind.findPlaceholder"),
        value: this.query.search,
      },
    ) as HTMLInputElement;

    this.replaceField = createEl(
      "input",
      {
        class: "miro-find-input",
        name: "replace",
        form: "",
        "aria-label": t("editorFind.replacePlaceholder"),
        placeholder: t("editorFind.replacePlaceholder"),
        value: this.query.replace,
      },
    ) as HTMLInputElement;

    this.matchCountEl = createEl("span", { class: "miro-find-count" }, ["—"]);

    this.toggleReplaceBtn = bindButton(
      t("editorFind.toggleReplace"),
      "toggle-replace",
      () => this.setReplaceVisible(!this.showReplace),
      "▸",
    ) as HTMLButtonElement;

    const prevBtn = bindButton(t("editorFind.previous"), "prev", () => findPrevious(view), "↑");
    const nextBtn = bindButton(t("editorFind.next"), "next", () => findNext(view), "↓");

    this.caseBtn = this.makeToggle(
      t("search.caseSensitive"),
      "case",
      this.query.caseSensitive,
      "Aa",
    );
    this.regexBtn = this.makeToggle(t("search.regex"), "regex", this.query.regexp, ".*");
    this.wordBtn = this.makeToggle(
      t("editorFind.wholeWord"),
      "word",
      this.query.wholeWord,
      "Ab",
    );

    const closeBtn = bindButton(t("common.close"), "close", () => closeSearchPanel(view), "×");

    const findRow = createEl("div", { class: "miro-find-row" }, [
      this.toggleReplaceBtn,
      this.searchField,
      this.matchCountEl,
      prevBtn,
      nextBtn,
      this.caseBtn,
      this.regexBtn,
      this.wordBtn,
      closeBtn,
    ]);

    const replaceOneBtn = createEl(
      "button",
      { type: "button", class: "miro-find-text-btn" },
      [t("editorFind.replaceOne")],
    );
    replaceOneBtn.addEventListener("click", (e) => {
      e.preventDefault();
      replaceNext(view);
    });

    const replaceAllBtn = createEl(
      "button",
      { type: "button", class: "miro-find-text-btn" },
      [t("search.replaceAll")],
    );
    replaceAllBtn.addEventListener("click", (e) => {
      e.preventDefault();
      replaceAll(view);
    });

    this.replaceRow = createEl("div", { class: "miro-find-replace-row", hidden: "" }, [
      createEl("span", { class: "miro-find-spacer" }),
      this.replaceField,
      createEl("div", { class: "miro-find-replace-actions" }, [replaceOneBtn, replaceAllBtn]),
    ]);

    this.dom = createEl("div", { class: "miro-find-panel cm-search", role: "search" }, [
      findRow,
      this.replaceRow,
    ]);

    this.dom.addEventListener("keydown", (e) => this.keydown(e));
    for (const input of [this.searchField, this.replaceField]) {
      input.addEventListener("input", () => this.commit());
      input.addEventListener("change", () => this.commit());
    }

    this.refreshMatchCount();
    if (view.state.readOnly) {
      this.toggleReplaceBtn.hidden = true;
      this.replaceRow.hidden = true;
    }
    panelByView.set(view, this);
  }

  private makeToggle(
    label: string,
    className: string,
    pressed: boolean,
    text: string,
  ): HTMLButtonElement {
    const btn = createEl(
      "button",
      {
        type: "button",
        class: `miro-find-btn miro-find-toggle ${className}`,
        "aria-label": label,
        title: label,
        "aria-pressed": pressed ? "true" : "false",
      },
      [text],
    ) as HTMLButtonElement;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const next = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", next ? "true" : "false");
      btn.classList.toggle("active", next);
      this.commit();
    });
    if (pressed) btn.classList.add("active");
    return btn;
  }

  setReplaceVisible(show: boolean) {
    this.showReplace = show;
    this.replaceRow.hidden = !show;
    this.toggleReplaceBtn.classList.toggle("expanded", show);
    this.toggleReplaceBtn.textContent = show ? "▾" : "▸";
  }

  toggleReplace(show?: boolean) {
    this.setReplaceVisible(show ?? !this.showReplace);
  }

  focusReplace() {
    this.setReplaceVisible(true);
    this.replaceField.focus();
  }

  private commit() {
    const query = new SearchQuery({
      search: this.searchField.value,
      caseSensitive: this.caseBtn.getAttribute("aria-pressed") === "true",
      regexp: this.regexBtn.getAttribute("aria-pressed") === "true",
      wholeWord: this.wordBtn.getAttribute("aria-pressed") === "true",
      replace: this.replaceField.value,
    });
    if (!query.eq(this.query)) {
      this.query = query;
      this.view.dispatch({ effects: setSearchQuery.of(query) });
    }
    this.refreshMatchCount();
  }

  private refreshMatchCount() {
    const { current, total } = getMatchStats(this.view, this.query);
    if (!this.query.search.trim()) {
      this.matchCountEl.textContent = "—";
      return;
    }
    if (!total) {
      this.matchCountEl.textContent = t("editorFind.noResults");
      return;
    }
    this.matchCountEl.textContent = t("editorFind.matchCount", { current, total });
  }

  private keydown(e: KeyboardEvent) {
    if (runScopeHandlers(this.view, e, "search-panel")) {
      e.preventDefault();
      return;
    }
    if (e.key === "Enter" && e.target === this.searchField) {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(this.view);
      this.refreshMatchCount();
      return;
    }
    if (e.key === "Enter" && e.target === this.replaceField) {
      e.preventDefault();
      replaceNext(this.view);
      this.refreshMatchCount();
    }
  }

  update(update: ViewUpdate) {
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.setQuery(effect.value);
        }
      }
    }
    if (update.docChanged || update.selectionSet) {
      this.refreshMatchCount();
    }
  }

  setQuery(query: SearchQuery) {
    this.query = query;
    this.searchField.value = query.search;
    this.replaceField.value = query.replace;
    this.syncToggle(this.caseBtn, query.caseSensitive);
    this.syncToggle(this.regexBtn, query.regexp);
    this.syncToggle(this.wordBtn, query.wholeWord);
    this.refreshMatchCount();
  }

  private syncToggle(btn: HTMLButtonElement, active: boolean) {
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.classList.toggle("active", active);
  }

  mount() {
    this.searchField.focus();
    this.searchField.select();
  }

  destroy() {
    panelByView.delete(this.view);
  }

  get top() {
    return true;
  }

  get pos() {
    return 100;
  }
}

export function createMiroFindPanel(view: EditorView): Panel {
  return new MiroFindPanel(view);
}

/** ⌘⌥F / Ctrl+Alt+F：打开并展开替换行 */
export function openFindReplacePanel(view: EditorView) {
  openSearchPanel(view);
  panelByView.get(view)?.focusReplace();
}
