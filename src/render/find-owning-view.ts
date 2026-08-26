import { MarkdownView, type App } from 'obsidian';

export function findOwningMarkdownView(app: App, element: HTMLElement): MarkdownView | null {
  if (!element.isConnected) {
    return null;
  }

  const matches: MarkdownView[] = [];
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    const { view } = leaf;
    if (view instanceof MarkdownView && view.containerEl.contains(element)) {
      matches.push(view);
    }
  }
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
