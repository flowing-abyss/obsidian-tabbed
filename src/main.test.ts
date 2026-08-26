import type {
  Command,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  Component as ObsidianComponent,
  PluginManifest,
  PluginSettingTab,
} from 'obsidian';
import { App, MarkdownView } from 'obsidian-test-mocks/obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from '../manifest.json';

interface FakeEditorOptions {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSave: (value: string) => void;
}

const editorDoubles = vi.hoisted(() => ({ instances: [] as FakeEditorComponent[] }));

class FakeEditorComponentShape {
  readonly options!: FakeEditorOptions;
  value = '';
}

interface FakeEditorComponent extends FakeEditorComponentShape, ObsidianComponent {}

vi.mock('./editor/tab-editor-component.js', async () => {
  const { Component } = await import('obsidian');
  class FakeTabEditorComponent extends Component {
    readonly options: FakeEditorOptions;
    value: string;

    constructor(options: FakeEditorOptions) {
      super();
      this.options = options;
      this.value = options.value;
      editorDoubles.instances.push(this);
    }

    getValue(): string {
      return this.value;
    }

    focus(): void {}

    applyTransform(): boolean {
      return false;
    }
  }
  return { TabEditorComponent: FakeTabEditorComponent };
});

import { TabEditorModal, type TabEditorRequest } from './editor/tab-editor-modal.js';
import { DragController } from './interactions/drag-controller.js';
import TabbedPlugin from './main.js';
import { TabsBlock } from './render/tabs-block.js';
import { TabbedSettingsTab } from './settings-tab.js';
import { DEFAULT_SETTINGS, type TabbedSettings } from './settings.js';
import { SelectionMemory } from './tabs/selection-memory.js';

const testManifest: PluginManifest = manifest;
const twoTabs = ['tab: First', 'first body', 'tab: Second', 'second body'].join('\n');

interface Harness {
  readonly app: ReturnType<typeof App.createConfigured__>;
  readonly plugin: TabbedPlugin;
  readonly processor: (
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ) => unknown;
  readonly commands: readonly Command[];
  readonly settingTabs: readonly PluginSettingTab[];
}

interface RenderedBlock {
  readonly block: TabsBlock;
  readonly container: HTMLElement;
  readonly view: MarkdownView;
}

function createPlugin(): {
  app: ReturnType<typeof App.createConfigured__>;
  plugin: TabbedPlugin;
} {
  const app = App.createConfigured__();
  return {
    app,
    plugin: new TabbedPlugin(app.asOriginalType__(), testManifest),
  };
}

async function loadPlugin(saved: unknown = {}): Promise<Harness> {
  const { app, plugin } = createPlugin();
  vi.spyOn(plugin, 'loadData').mockResolvedValue(saved);
  const registerProcessor = vi.spyOn(plugin, 'registerMarkdownCodeBlockProcessor');
  const addCommand = vi.spyOn(plugin, 'addCommand');
  const addSettingTab = vi.spyOn(plugin, 'addSettingTab');

  await plugin.onload();

  const processor = registerProcessor.mock.calls[0]?.[1];
  if (processor === undefined) {
    throw new Error('Expected a registered tabs processor');
  }
  return {
    app,
    plugin,
    processor,
    commands: addCommand.mock.calls.map(([command]) => command),
    settingTabs: addSettingTab.mock.calls.map(([tab]) => tab),
  };
}

async function renderBlock(
  harness: Harness,
  source = twoTabs,
  options: { readonly mode?: 'source' | 'preview'; readonly sourcePath?: string } = {},
): Promise<RenderedBlock> {
  const leaf = harness.app.workspace.getLeaf(true);
  await leaf.setViewState({ type: 'markdown' });
  const view = MarkdownView.create2__(leaf);
  await leaf.open(view.asOriginalType7__());
  vi.spyOn(view, 'getMode').mockReturnValue(options.mode ?? 'source');
  const fullSource = ['```tabs', source, '```'].join('\n');
  view.setViewData(fullSource, false);
  document.body.append(view.containerEl);
  const container = view.containerEl.createDiv({ cls: 'block-language-tabs' }).createDiv();
  let block: TabsBlock | undefined;
  const context: MarkdownPostProcessorContext = {
    sourcePath: options.sourcePath ?? 'Tabbed E2E.md',
    docId: 'doc',
    frontmatter: null,
    addChild: (child: MarkdownRenderChild) => {
      block = child as TabsBlock;
      child.load();
    },
    getSectionInfo: () => ({
      text: fullSource,
      lineStart: 0,
      lineEnd: fullSource.split('\n').length - 1,
    }),
  };

  await harness.processor(source, container, context);
  if (block === undefined) {
    throw new Error('Expected the processor to add a TabsBlock child');
  }
  return { block, container, view };
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('TabbedPlugin', () => {
  beforeEach(() => {
    editorDoubles.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('declares its Community Store identity', () => {
    expect(manifest).toMatchObject({
      id: 'tabbed',
      name: 'Tabbed',
      version: '0.1.0',
      minAppVersion: '1.13.1',
      author: 'flowing-abyss',
      authorUrl: 'https://github.com/flowing-abyss',
      fundingUrl: 'https://boosty.to/flowing-abyss/donate',
      description: 'Create lazy-loading tabs in your notes.',
      isDesktopOnly: false,
    });
  });

  it('normalizes saved data and registers only the tabs processor, two commands, and settings tab on load', async () => {
    const harness = await loadPlugin({ titlePosition: 'invalid', tabSize: 99, action: 'edit' });

    expect(harness.plugin.settings).toStrictEqual({
      ...DEFAULT_SETTINGS,
      action: 'edit',
    });
    expect(harness.commands.map(({ id }) => id)).toStrictEqual([
      'create-tabs-block',
      'refresh-tab-contents',
    ]);
    expect(harness.settingTabs).toHaveLength(1);
    expect(harness.settingTabs[0]).toBeInstanceOf(TabbedSettingsTab);
    expect(editorDoubles.instances).toHaveLength(0);
    expect(document.querySelector('.tabbed')).toBeNull();
  });

  it('adds each processed block as a renderer-owned child', async () => {
    const harness = await loadPlugin();
    const addChild = vi.fn<(child: MarkdownRenderChild) => void>();
    const context: MarkdownPostProcessorContext = {
      sourcePath: 'Note.md',
      docId: 'doc',
      frontmatter: null,
      addChild,
      getSectionInfo: () => null,
    };
    const container = createDiv();

    await harness.processor(twoTabs, container, context);

    expect(addChild).toHaveBeenCalledTimes(1);
    expect(addChild.mock.calls[0]?.[0]).toBeInstanceOf(TabsBlock);
  });

  it('uses block action-add over the global edit action and performs the real add mutation', async () => {
    const harness = await loadPlugin({ action: 'edit' });
    const rendered = await renderBlock(harness, `action-add\n${twoTabs}`);
    const action = required(
      rendered.container.querySelector<HTMLElement>('[data-tab-action="add"]'),
      'Expected the effective add action',
    );

    action.click();

    expect(rendered.view.editor.getValue()).toBe(
      [
        '```tabs',
        'action-add',
        'tab: First',
        'first body',
        'tab: Second',
        'second body',
        'tab: New tab',
        'New tab content',
        '```',
      ].join('\n'),
    );
  });

  it('uses block action-edit over the global add action and opens the selected tab', async () => {
    const harness = await loadPlugin({ action: 'add' });
    const open = vi.spyOn(TabEditorModal.prototype, 'openFor').mockImplementation(() => undefined);
    const rendered = await renderBlock(harness, `action-edit\n${twoTabs}`);
    rendered.block.tabElements[1]?.click();
    await settle();

    required(
      rendered.container.querySelector<HTMLElement>('[data-tab-action="edit"]'),
      'Expected the effective edit action',
    ).click();

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0]).toMatchObject({
      index: 1,
      title: 'Second',
      content: 'second body',
      sourcePath: 'Tabbed E2E.md',
    } satisfies Partial<TabEditorRequest>);
  });

  it('renders no end control when action-none overrides the global action', async () => {
    const harness = await loadPlugin({ action: 'edit' });
    const rendered = await renderBlock(harness, `action-none\n${twoTabs}`);

    expect(rendered.container.querySelector('.tabbed__action')).toBeNull();
  });

  it('opens editing on double-click only when enabled in the owning source-mode view', async () => {
    const harness = await loadPlugin({ action: 'none', doubleClickToEdit: true });
    const open = vi.spyOn(TabEditorModal.prototype, 'openFor').mockImplementation(() => undefined);
    const source = await renderBlock(harness);
    const reading = await renderBlock(harness, twoTabs, { mode: 'preview' });

    source.container
      .querySelector('.tabbed__panel')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    reading.container
      .querySelector('.tabbed__panel')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0]).toMatchObject({ index: 0, title: 'First' });

    await harness.plugin.updateSettings({
      ...harness.plugin.settings,
      doubleClickToEdit: false,
    });
    source.container
      .querySelector('.tabbed__panel')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('persists settings once and resolves only after every live block applies them', async () => {
    const harness = await loadPlugin();
    const first = await renderBlock(harness, twoTabs, { sourcePath: 'First.md' });
    const second = await renderBlock(harness, twoTabs, { sourcePath: 'Second.md' });
    const firstApplied = deferred();
    const secondApplied = deferred();
    const applyFirst = vi
      .spyOn(first.block, 'applySettings')
      .mockImplementation(() => firstApplied.promise);
    const applySecond = vi
      .spyOn(second.block, 'applySettings')
      .mockImplementation(() => secondApplied.promise);
    const save = vi.spyOn(harness.plugin, 'saveData').mockResolvedValue();
    const next: TabbedSettings = { ...harness.plugin.settings, border: 'always' };
    let completed = false;

    const update = harness.plugin.updateSettings(next).then(() => {
      completed = true;
    });
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(next);
    expect(applyFirst).toHaveBeenCalledWith(next);
    expect(applySecond).toHaveBeenCalledWith(next);
    expect(completed).toBe(false);

    firstApplied.resolve();
    await settle();
    expect(completed).toBe(false);
    secondApplied.resolve();
    await update;
    expect(completed).toBe(true);
  });

  it('clears drag, selection, live refresh, and a pending modal edit on unload', async () => {
    vi.useFakeTimers();
    const clearDrag = vi.spyOn(DragController.prototype, 'clear');
    const clearSelection = vi.spyOn(SelectionMemory.prototype, 'clear');
    const disposeModal = vi.spyOn(TabEditorModal.prototype, 'dispose');
    const harness = await loadPlugin({
      action: 'edit',
      dragAndDrop: true,
      autoSaveDelayMs: 100,
    });
    const rendered = await renderBlock(harness, `action-edit\n${twoTabs}`);
    const refresh = vi.spyOn(rendered.block, 'refreshActiveBody');
    const transaction = vi.spyOn(rendered.view.editor, 'transaction');
    const action = required(
      rendered.container.querySelector<HTMLElement>('[data-tab-action="edit"]'),
      'Expected edit action',
    );
    action.click();
    const editor = required(editorDoubles.instances[0], 'Expected the lazy modal editor component');
    editor.options.onChange('Unsaved late content');
    await settle();
    expect(rendered.block.tabElements.every((tab) => tab.draggable)).toBe(true);

    harness.plugin.onunload();
    await harness.plugin.refreshLiveBlocks();
    await vi.runAllTimersAsync();

    expect(clearDrag).toHaveBeenCalledTimes(1);
    expect(rendered.block.tabElements.every((tab) => !tab.draggable)).toBe(true);
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(disposeModal).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('adds load context when saved settings cannot be read', async () => {
    const { plugin } = createPlugin();
    vi.spyOn(plugin, 'loadData').mockRejectedValue(new Error('adapter unavailable'));

    await expect(plugin.onload()).rejects.toThrow(
      'Could not load Tabbed settings: adapter unavailable',
    );
  });

  it('persists the current settings via saveSettings', async () => {
    const harness = await loadPlugin();
    const saveData = vi.spyOn(harness.plugin, 'saveData').mockResolvedValue();

    await harness.plugin.saveSettings();

    expect(saveData).toHaveBeenCalledWith(harness.plugin.settings);
  });
});
