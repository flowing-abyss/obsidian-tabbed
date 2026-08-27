import type {
  Command,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  Component as ObsidianComponent,
  PluginManifest,
  PluginSettingTab,
} from 'obsidian';
import { App, MarkdownView, Menu, Notice, Platform } from 'obsidian-test-mocks/obsidian';
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
  readonly setMode: (mode: 'source' | 'preview') => void;
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

  plugin.load();
  await settle();

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
  const getMode = vi.spyOn(view, 'getMode').mockReturnValue(options.mode ?? 'source');
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
  return {
    block,
    container,
    view,
    setMode: (mode) => {
      getMode.mockReturnValue(mode);
    },
  };
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

function commandById(harness: Harness, id: string): Command {
  return required(
    harness.commands.find((command) => command.id === id),
    `Expected registered command ${id}`,
  );
}

function commandCallback(command: Command): NonNullable<Command['callback']> {
  return required(command.callback, `Expected callback for ${command.id}`);
}

function editorCallback(command: Command): NonNullable<Command['editorCallback']> {
  return required(command.editorCallback, `Expected editor callback for ${command.id}`);
}

function dragStart(element: HTMLElement): ReturnType<typeof vi.fn> {
  const setData = vi.fn();
  const event = new MouseEvent('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { effectAllowed: 'uninitialized', setData },
  });
  element.dispatchEvent(event);
  return setData;
}

describe('TabbedPlugin', () => {
  beforeEach(() => {
    editorDoubles.instances.length = 0;
    Platform.isMobile = false;
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

  it('rebinds the real drag controller when live settings enable and disable dragging', async () => {
    const harness = await loadPlugin({ dragAndDrop: false, showSuccessNotices: false });
    const rendered = await renderBlock(harness);
    const tab = required(rendered.block.tabElements[0], 'Expected first tab');

    expect(tab.hasAttribute('draggable')).toBe(false);

    await harness.plugin.updateSettings({ ...harness.plugin.settings, dragAndDrop: true });
    await settle();
    const enabledTransfer = dragStart(tab);

    expect(tab.getAttribute('draggable')).toBe('true');
    expect(enabledTransfer).toHaveBeenCalledExactlyOnceWith('text/plain', 'tabbed');

    await harness.plugin.updateSettings({ ...harness.plugin.settings, dragAndDrop: false });
    const disabledTransfer = dragStart(tab);

    expect(tab.hasAttribute('draggable')).toBe(false);
    expect(disabledTransfer).not.toHaveBeenCalled();
  });

  it('moves drag listeners from replaced title elements to the rebuilt titles', async () => {
    const harness = await loadPlugin({ dragAndDrop: true, showSuccessNotices: false });
    const rendered = await renderBlock(harness);
    await settle();
    const oldTab = required(rendered.block.tabElements[0], 'Expected original first tab');
    expect(oldTab.getAttribute('draggable')).toBe('true');

    await harness.plugin.updateSettings({
      ...harness.plugin.settings,
      titlePosition: 'right',
    });
    await settle();
    const newTab = required(rendered.block.tabElements[0], 'Expected rebuilt first tab');
    const oldTransfer = dragStart(oldTab);
    const newTransfer = dragStart(newTab);

    expect(newTab).not.toBe(oldTab);
    expect(oldTab.hasAttribute('draggable')).toBe(false);
    expect(oldTransfer).not.toHaveBeenCalled();
    expect(newTab.getAttribute('draggable')).toBe('true');
    expect(newTransfer).toHaveBeenCalledExactlyOnceWith('text/plain', 'tabbed');
  });

  it('does not rebind a block unregistered while its settings update is awaiting', async () => {
    const harness = await loadPlugin({ dragAndDrop: false, showSuccessNotices: false });
    const rendered = await renderBlock(harness);
    const applied = deferred();
    vi.spyOn(rendered.block, 'applySettings').mockImplementation(() => applied.promise);
    const bind = vi.spyOn(DragController.prototype, 'bind');

    const update = harness.plugin.updateSettings({
      ...harness.plugin.settings,
      dragAndDrop: true,
    });
    await settle();
    rendered.block.unload();
    bind.mockClear();
    applied.resolve();
    await update;

    expect(bind.mock.calls).toHaveLength(0);
  });

  it('does not apply or rebind settings to a block unregistered while persistence is pending', async () => {
    const harness = await loadPlugin({ dragAndDrop: false, showSuccessNotices: false });
    const rendered = await renderBlock(harness);
    const persisted = deferred();
    vi.spyOn(harness.plugin, 'saveData').mockImplementation(() => persisted.promise);
    const apply = vi.spyOn(rendered.block, 'applySettings');
    const bind = vi.spyOn(DragController.prototype, 'bind');

    const update = harness.plugin.updateSettings({
      ...harness.plugin.settings,
      dragAndDrop: true,
    });
    await settle();
    rendered.block.unload();
    bind.mockClear();
    persisted.resolve();
    await update;

    expect(apply).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
  });

  it('does not apply or rebind settings after plugin unload while persistence is pending', async () => {
    const harness = await loadPlugin({ dragAndDrop: false, showSuccessNotices: false });
    const rendered = await renderBlock(harness);
    const persisted = deferred();
    vi.spyOn(harness.plugin, 'saveData').mockImplementation(() => persisted.promise);
    const apply = vi.spyOn(rendered.block, 'applySettings');
    const bind = vi.spyOn(DragController.prototype, 'bind');

    const update = harness.plugin.updateSettings({
      ...harness.plugin.settings,
      dragAndDrop: true,
    });
    await settle();
    harness.plugin.onunload();
    bind.mockClear();
    persisted.resolve();
    await update;

    expect(apply).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
  });

  it('serializes overlapping updates and skips stale application after the latest request', async () => {
    const harness = await loadPlugin({ showSuccessNotices: false });
    const rendered = await renderBlock(harness);
    const firstPersisted = deferred();
    let persisted = harness.plugin.settings;
    const first = { ...harness.plugin.settings, border: 'always' as const };
    const latest = { ...harness.plugin.settings, border: 'none' as const };
    const save = vi
      .spyOn(harness.plugin, 'saveData')
      .mockImplementationOnce(async (settings) => {
        await firstPersisted.promise;
        persisted = settings as TabbedSettings;
      })
      .mockImplementationOnce(async (settings) => {
        persisted = settings as TabbedSettings;
      });
    const apply = vi.spyOn(rendered.block, 'applySettings').mockResolvedValue();

    const firstUpdate = harness.plugin.updateSettings(first);
    await settle();
    const latestUpdate = harness.plugin.updateSettings(latest);
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();

    firstPersisted.resolve();
    await Promise.all([firstUpdate, latestUpdate]);

    expect(save.mock.calls.map(([settings]) => settings as TabbedSettings)).toStrictEqual([
      first,
      latest,
    ]);
    expect(persisted).toStrictEqual(latest);
    expect(apply).toHaveBeenCalledExactlyOnceWith(latest);
    expect(harness.plugin.settings).toStrictEqual(latest);
  });

  it('delegates a live tab context menu through the registered block host', async () => {
    const harness = await loadPlugin({ showSuccessNotices: false });
    const rendered = await renderBlock(harness);
    const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent');
    const tab = required(rendered.block.tabElements[0], 'Expected first tab');
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    tab.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(shown).toHaveBeenCalledExactlyOnceWith(event);
    rendered.block.unload();
  });

  it('ignores edit delegation for a reading-view block or stale tab index', async () => {
    const harness = await loadPlugin({ showSuccessNotices: false });
    const reading = await renderBlock(harness, twoTabs, { mode: 'preview' });
    const source = await renderBlock(harness);
    const open = vi.spyOn(TabEditorModal.prototype, 'openFor');
    const host = (
      harness.plugin as unknown as {
        readonly blockHost: { editTab(block: TabsBlock, index: number): void };
      }
    ).blockHost;

    host.editTab(reading.block, 0);
    host.editTab(source.block, 99);

    expect(open).not.toHaveBeenCalled();
    reading.block.unload();
    source.block.unload();
  });

  it('cancels a queued modal save when its block unloads without a late boundary', async () => {
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dispose = vi.spyOn(TabEditorModal.prototype, 'dispose');
    const harness = await loadPlugin({ action: 'edit', showSuccessNotices: false });
    const rendered = await renderBlock(harness, `action-edit\n${twoTabs}`);
    const transaction = vi.spyOn(rendered.view.editor, 'transaction');
    required(
      rendered.container.querySelector<HTMLElement>('[data-tab-action="edit"]'),
      'Expected edit action',
    ).click();
    const editor = required(editorDoubles.instances[0], 'Expected modal editor');
    editor.options.onChange('must not save');
    editor.options.onSave('must not save');

    rendered.block.unload();
    await settle();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('cancels a queued modal save after a source-to-preview mode switch', async () => {
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const harness = await loadPlugin({ action: 'edit', showSuccessNotices: false });
    const rendered = await renderBlock(harness, `action-edit\n${twoTabs}`);
    const transaction = vi.spyOn(rendered.view.editor, 'transaction');
    required(
      rendered.container.querySelector<HTMLElement>('[data-tab-action="edit"]'),
      'Expected edit action',
    ).click();
    const editor = required(editorDoubles.instances[0], 'Expected modal editor');
    editor.options.onChange('must not save');
    editor.options.onSave('must not save');

    rendered.setMode('preview');
    await settle();

    expect(transaction).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    rendered.block.unload();
  });

  it('executes registered command callbacks and refreshes only blocks that remain live', async () => {
    const harness = await loadPlugin({ showSuccessNotices: false });
    const live = await renderBlock(harness, twoTabs, { sourcePath: 'Live.md' });
    const removed = await renderBlock(harness, twoTabs, { sourcePath: 'Removed.md' });
    const refreshLive = vi.spyOn(live.block, 'refreshActiveBody').mockResolvedValue();
    const refreshRemoved = vi.spyOn(removed.block, 'refreshActiveBody').mockResolvedValue();
    removed.block.unload();

    await commandCallback(commandById(harness, 'refresh-tab-contents'))();

    expect(refreshLive).toHaveBeenCalledTimes(1);
    expect(refreshRemoved).not.toHaveBeenCalled();

    live.view.editor.setValue('selected');
    live.view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 8 });
    await editorCallback(commandById(harness, 'create-tabs-block'))(live.view.editor, {} as never);

    expect(live.view.editor.getValue()).toBe(
      ['```tabs', 'tab: New tab', 'selected', '```'].join('\n'),
    );
    live.block.unload();
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
