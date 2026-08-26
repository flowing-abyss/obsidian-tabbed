import type { App as ObsidianApp } from 'obsidian';
import { App, MarkdownView, View } from 'obsidian-test-mocks/obsidian';
import { describe, expect, it, vi } from 'vitest';
import { findOwningMarkdownView } from './find-owning-view.js';

class DeferredLikeView extends View {
  getDisplayText(): string {
    return 'Deferred';
  }

  getViewType(): string {
    return 'markdown';
  }
}

async function markdownView(app: App): Promise<MarkdownView> {
  const leaf = app.workspace.getLeaf(true);
  await leaf.setViewState({ type: 'markdown' });
  const view = MarkdownView.create2__(leaf);
  await leaf.open(view.asOriginalType7__());
  document.body.append(view.containerEl);
  return view;
}

async function deferredLeaf(app: App): Promise<void> {
  const leaf = app.workspace.getLeaf(true);
  await leaf.setViewState({ type: 'markdown' });
  await leaf.open(new DeferredLikeView(leaf).asOriginalType2__());
}

describe('findOwningMarkdownView', () => {
  it('returns the one markdown view containing the rendered block', async () => {
    const app = App.createConfigured__();
    await markdownView(app);
    const secondView = await markdownView(app);
    const block = secondView.containerEl.createDiv();

    expect(findOwningMarkdownView(app.asOriginalType__(), block)).toBe(
      secondView.asOriginalType7__(),
    );
  });

  it('returns a preview-mode owner without applying mutation mode policy', async () => {
    const app = App.createConfigured__();
    const view = await markdownView(app);
    const getMode = vi.spyOn(view, 'getMode').mockReturnValue('preview');
    const block = view.containerEl.createDiv();

    expect(findOwningMarkdownView(app.asOriginalType__(), block)).toBe(view.asOriginalType7__());
    expect(getMode).not.toHaveBeenCalled();
  });

  it('ignores deferred markdown leaves before inspecting markdown-only members', async () => {
    const app = App.createConfigured__();
    await deferredLeaf(app);
    const view = await markdownView(app);
    const block = view.containerEl.createDiv();

    expect(findOwningMarkdownView(app.asOriginalType__(), block)).toBe(view.asOriginalType7__());
  });

  it('rejects a detached element', async () => {
    const app = App.createConfigured__();
    await markdownView(app);

    expect(findOwningMarkdownView(app.asOriginalType__(), createDiv())).toBeNull();
  });

  it('rejects an element contained by multiple markdown view containers', async () => {
    const app = App.createConfigured__();
    const outer = await markdownView(app);
    const inner = await markdownView(app);
    outer.containerEl.append(inner.containerEl);
    const block = inner.containerEl.createDiv();

    expect(findOwningMarkdownView(app.asOriginalType__(), block)).toBeNull();
  });

  it('requests only markdown leaves from the public workspace API', () => {
    const getLeavesOfType = vi.fn<ObsidianApp['workspace']['getLeavesOfType']>(() => []);
    const app = {
      workspace: { getLeavesOfType },
    } as unknown as ObsidianApp;

    expect(findOwningMarkdownView(app, document.body)).toBeNull();
    expect(getLeavesOfType).toHaveBeenCalledWith('markdown');
  });
});
