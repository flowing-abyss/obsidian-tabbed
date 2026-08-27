import type { MarkdownPostProcessorContext } from 'obsidian';
import { App, MarkdownView, Menu, type MenuItem, Notice } from 'obsidian-test-mocks/obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabsBlock, type TabsBlockHost } from '../render/tabs-block.js';
import { DEFAULT_SETTINGS, type TabbedSettings } from '../settings.js';
import { SelectionMemory } from '../tabs/selection-memory.js';
import { addDefaultTab, showTabMenu } from './tab-menu.js';

function settings(overrides: Partial<TabbedSettings> = {}): TabbedSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function host(): TabsBlockHost {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    addTab: vi.fn(),
    editTab: vi.fn(),
    openTabMenu: vi.fn(),
  };
}

async function sourceBlock(
  inner: string,
  options: {
    mode?: 'source' | 'preview';
    path?: string;
    settings?: TabbedSettings;
  } = {},
) {
  const current = options.settings ?? settings();
  const mockApp = App.createConfigured__();
  const leaf = mockApp.workspace.getLeaf(true);
  await leaf.setViewState({ type: 'markdown' });
  const view = MarkdownView.create2__(leaf);
  await leaf.open(view.asOriginalType7__());
  const getMode = vi.spyOn(view, 'getMode').mockReturnValue(options.mode ?? 'source');
  const fullSource = `\`\`\`tabs\n${inner}${inner.length > 0 && !inner.endsWith('\n') ? '\n' : ''}\`\`\``;
  view.setViewData(fullSource, false);
  document.body.append(view.containerEl);
  const wrapper = view.containerEl.createDiv({ cls: 'block-language-tabs' });
  const container = wrapper.createDiv();
  const context: MarkdownPostProcessorContext = {
    sourcePath: options.path ?? 'Note.md',
    docId: 'doc',
    frontmatter: null,
    addChild: vi.fn(),
    getSectionInfo: vi.fn(() => ({
      text: fullSource,
      lineStart: 0,
      lineEnd: fullSource.split('\n').length - 1,
    })),
  };
  const block = new TabsBlock(
    mockApp.asOriginalType__(),
    container,
    inner,
    context,
    current,
    new SelectionMemory(32),
    host(),
    async () => undefined,
  );
  block.load();
  await Promise.resolve();
  return {
    block,
    view,
    fullSource,
    setMode: (mode: 'source' | 'preview') => {
      getMode.mockReturnValue(mode);
    },
  };
}

function openMenu(block: TabsBlock, index = 0, getSettings = () => settings()): Menu {
  const constructed = vi.spyOn(Menu.prototype, 'constructor2__');
  showTabMenu({ block, index, event: new MouseEvent('contextmenu'), getSettings });
  const instances: readonly unknown[] = constructed.mock.instances;
  const menu = instances[instances.length - 1];
  if (!(menu instanceof Menu)) {
    throw new Error('Expected a menu');
  }
  return menu;
}

function item(menu: Menu, title: string): MenuItem {
  const found = menu.items__.find((candidate) => candidate.title__ === title);
  if (found === undefined) {
    throw new Error(`Expected ${title} menu item`);
  }
  return found;
}

async function click(menu: Menu, title: string): Promise<void> {
  const callback = item(menu, title).onClick__;
  if (callback === null) {
    throw new Error(`Expected ${title} click callback`);
  }
  await callback(new MouseEvent('click'));
}

function clipboard(options: {
  read?: () => Promise<string>;
  write?: (value: string) => Promise<void>;
}) {
  const value = {
    readText: vi.fn(options.read ?? (async () => '')),
    writeText: vi.fn(options.write ?? (async () => undefined)),
  };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value });
  return value;
}

function deferredValue<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('showTabMenu', () => {
  it('does not construct a mutation menu in Reading view or for a stale index', async () => {
    const constructed = vi.spyOn(Menu.prototype, 'constructor2__');
    const reading = await sourceBlock('tab: A\nalpha', { mode: 'preview' });
    const source = await sourceBlock('tab: A\nalpha');

    showTabMenu({
      block: reading.block,
      index: 0,
      event: new MouseEvent('contextmenu'),
      getSettings: () => settings(),
    });
    showTabMenu({
      block: source.block,
      index: 9,
      event: new MouseEvent('contextmenu'),
      getSettings: () => settings(),
    });

    expect(constructed).not.toHaveBeenCalled();
    reading.block.unload();
    source.block.unload();
  });

  it('shows exactly the sentence-case actions at the triggering mouse event', async () => {
    const { block } = await sourceBlock('tab: A\nalpha');
    const event = new MouseEvent('contextmenu', { clientX: 12, clientY: 34 });
    const constructed = vi.spyOn(Menu.prototype, 'constructor2__');
    const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent');

    showTabMenu({ block, index: 0, event, getSettings: () => settings() });
    const instances: readonly unknown[] = constructed.mock.instances;
    const menu = instances[instances.length - 1];
    if (!(menu instanceof Menu)) {
      throw new Error('Expected shown menu');
    }

    expect(menu.items__.map((candidate) => candidate.title__)).toStrictEqual([
      'Add tab',
      'Delete tab',
      'Copy tab',
      'Paste tab',
    ]);
    expect(shown).toHaveBeenCalledExactlyOnceWith(event);
    block.unload();
  });

  it('closes an open menu once on block unload and does not re-close after normal hide', async () => {
    const close = vi.spyOn(Menu.prototype, 'close');
    const first = await sourceBlock('tab: A\nalpha');
    openMenu(first.block).close();
    first.block.unload();
    expect(close).toHaveBeenCalledTimes(1);

    close.mockClear();
    const second = await sourceBlock('tab: B\nbeta');
    openMenu(second.block);
    second.block.unload();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('disposes the owner and reports once when showing the menu throws', async () => {
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const close = vi.spyOn(Menu.prototype, 'close');
    vi.spyOn(Menu.prototype, 'showAtMouseEvent').mockImplementationOnce(() => {
      throw new Error('show rejected');
    });
    const { block } = await sourceBlock('tab: A\nalpha');

    showTabMenu({
      block,
      index: 0,
      event: new MouseEvent('contextmenu'),
      getSettings: () => settings(),
    });
    block.unload();

    expect(notice.mock.calls.map(([message]) => message)).toStrictEqual([
      'Could not open tab menu.',
    ]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('disposes the owner and reports once when menu construction throws', async () => {
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(Menu.prototype, 'constructor2__').mockImplementationOnce(() => {
      throw new Error('construction rejected');
    });
    const { block } = await sourceBlock('tab: A\nalpha');

    showTabMenu({
      block,
      index: 0,
      event: new MouseEvent('contextmenu'),
      getSettings: () => settings(),
    });
    block.unload();

    expect(notice.mock.calls.map(([message]) => message)).toStrictEqual([
      'Could not open tab menu.',
    ]);
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('tab menu mutations', () => {
  it('appends current defaults through one real editor transaction', async () => {
    const current = settings({
      defaultTitle: 'Added',
      defaultContent: 'new body',
      showSuccessNotices: false,
    });
    const { block, view } = await sourceBlock('tab: A\nalpha', { settings: current });
    const transaction = vi.spyOn(view.editor, 'transaction');
    const notice = vi.spyOn(Notice.prototype, 'constructor__');

    addDefaultTab(block, () => current);

    expect(view.editor.getValue()).toBe(
      ['```tabs', 'tab: A', 'alpha', 'tab: Added', 'new body', '```'].join('\n'),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(notice).not.toHaveBeenCalled();
    block.unload();
  });

  it('deletes the clicked tab through one real editor transaction', async () => {
    const { block, view } = await sourceBlock('tab: A\nalpha\ntab: B\nbeta');
    const transaction = vi.spyOn(view.editor, 'transaction');
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const menu = openMenu(block, 1);

    await click(menu, 'Delete tab');

    expect(view.editor.getValue()).toBe(['```tabs', 'tab: A', 'alpha', '```'].join('\n'));
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(notice.mock.calls.map(([message]) => message)).toStrictEqual(['Deleted tab.']);
    block.unload();
  });

  it('copies a virtual tab as one exact separator-title-EOL-content payload', async () => {
    const copied = clipboard({});
    const { block } = await sourceBlock('');
    const menu = openMenu(block, 0, () => settings({ showSuccessNotices: false }));

    await click(menu, 'Copy tab');

    expect(copied.writeText).toHaveBeenCalledExactlyOnceWith('tab: New tab\nNew tab content');
    block.unload();
  });

  it('copies the mandatory header/body EOL for an explicit empty body', async () => {
    const copied = clipboard({});
    const { block } = await sourceBlock('tab: Empty\n');

    await click(openMenu(block), 'Copy tab');

    expect(copied.writeText).toHaveBeenCalledExactlyOnceWith('tab: Empty\n');
    block.unload();
  });

  it('pastes a matching CRLF fragment while preserving every body byte after the first LF', async () => {
    const pasted = clipboard({ read: async () => 'tab: Pasted\r\nline one\r\nline two' });
    const { block, view } = await sourceBlock('tab: A\nalpha');
    const transaction = vi.spyOn(view.editor, 'transaction');

    await click(
      openMenu(block, 0, () => settings({ showSuccessNotices: false })),
      'Paste tab',
    );

    expect(pasted.readText).toHaveBeenCalledTimes(1);
    expect(view.editor.getValue()).toBe(
      '```tabs\ntab: A\nalpha\ntab: Pasted\nline one\r\nline two\n```',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    block.unload();
  });

  it('treats a fragment with another separator as raw content under current defaults', async () => {
    clipboard({ read: async () => 'pane: Foreign\nbody' });
    const current = settings({
      defaultTitle: 'Imported',
      defaultContent: 'unused',
      showSuccessNotices: false,
    });
    const { block, view } = await sourceBlock('tab: A\nalpha', { settings: current });

    await click(
      openMenu(block, 0, () => current),
      'Paste tab',
    );

    expect(view.editor.getValue()).toBe(
      ['```tabs', 'tab: A', 'alpha', 'tab: Imported', 'pane: Foreign', 'body', '```'].join('\n'),
    );
    block.unload();
  });

  it('pastes a matching header without LF as an empty-body tab', async () => {
    clipboard({ read: async () => 'tab: Header only' });
    const { block, view } = await sourceBlock('tab: A\nalpha');

    await click(
      openMenu(block, 0, () => settings({ showSuccessNotices: false })),
      'Paste tab',
    );

    expect(view.editor.getValue()).toBe(
      ['```tabs', 'tab: A', 'alpha', 'tab: Header only', '```'].join('\n'),
    );
    block.unload();
  });

  it.each(['unload', 'preview', 'editor-change'] as const)(
    'silently cancels a deferred paste after block %s revokes source ownership',
    async (revocation) => {
      const read = deferredValue<string>();
      clipboard({ read: () => read.promise });
      const notice = vi.spyOn(Notice.prototype, 'constructor__');
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const source = await sourceBlock('tab: A\nalpha');
      const originalEditor = source.view.editor;
      const transaction = vi.spyOn(originalEditor, 'transaction');
      const pending = click(openMenu(source.block), 'Paste tab');
      await Promise.resolve();

      if (revocation === 'unload') {
        source.block.unload();
      } else if (revocation === 'preview') {
        source.setMode('preview');
      } else {
        source.view.editor = Object.create(originalEditor) as typeof originalEditor;
      }
      read.resolve('tab: Late\nbody');
      await pending;

      expect(transaction).not.toHaveBeenCalled();
      expect(originalEditor.getValue()).toBe(source.fullSource);
      expect(notice).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      if (revocation !== 'unload') {
        source.block.unload();
      }
    },
  );

  it('silently cancels a deferred clipboard rejection after block unload', async () => {
    const read = deferredValue<string>();
    clipboard({ read: () => read.promise });
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = await sourceBlock('tab: A\nalpha');
    const transaction = vi.spyOn(source.view.editor, 'transaction');
    const pending = click(openMenu(source.block), 'Paste tab');
    await Promise.resolve();

    source.block.unload();
    read.reject(new Error('late clipboard failure'));
    await pending;

    expect(transaction).not.toHaveBeenCalled();
    expect(source.view.editor.getValue()).toBe(source.fullSource);
    expect(notice).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('reports a typed source conflict once without opening a transaction', async () => {
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { block, view } = await sourceBlock('tab: A\nalpha');
    const transaction = vi.spyOn(view.editor, 'transaction');
    const menu = openMenu(block);
    view.setViewData('changed elsewhere', false);

    await click(menu, 'Delete tab');

    expect(notice.mock.calls.map(([message]) => message)).toStrictEqual(['Could not delete tab.']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      action: 'delete',
      sourcePath: 'Note.md',
      index: 0,
      failure: { ok: false, reason: 'source-conflict' },
    });
    expect(transaction).not.toHaveBeenCalled();
    block.unload();
  });

  it('reports an add conflict when Reading view has no writable source locator', async () => {
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { block, view, fullSource } = await sourceBlock('tab: A\nalpha', { mode: 'preview' });
    const transaction = vi.spyOn(view.editor, 'transaction');

    addDefaultTab(block, () => settings());

    expect(view.editor.getValue()).toBe(fullSource);
    expect(transaction).not.toHaveBeenCalled();
    expect(notice.mock.calls.map(([message]) => message)).toStrictEqual(['Could not add tab.']);
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      action: 'add',
      failure: { ok: false, reason: 'source-conflict' },
    });
    block.unload();
  });

  it('reports an invalid default title without opening a transaction', async () => {
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { block, view, fullSource } = await sourceBlock('tab: A\nalpha');
    const transaction = vi.spyOn(view.editor, 'transaction');

    addDefaultTab(block, () => settings({ defaultTitle: 'bad\ntitle' }));

    expect(view.editor.getValue()).toBe(fullSource);
    expect(transaction).not.toHaveBeenCalled();
    expect(notice.mock.calls.map(([message]) => message)).toStrictEqual(['Could not add tab.']);
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      action: 'add',
      failure: { ok: false, reason: 'operation-failed', code: 'invalid-title' },
    });
    block.unload();
  });

  it.each([
    ['Copy tab', 'Could not copy tab.'],
    ['Paste tab', 'Could not paste tab.'],
  ] as const)(
    'reports a source conflict when %s runs after the block changed',
    async (title, message) => {
      clipboard({ read: async () => 'tab: Pasted\nbody' });
      const notice = vi.spyOn(Notice.prototype, 'constructor__');
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { block, view } = await sourceBlock('tab: A\nalpha');
      const menu = openMenu(block);
      view.setViewData('changed elsewhere', false);

      await click(menu, title);

      expect(view.editor.getValue()).toBe('changed elsewhere');
      expect(notice.mock.calls.map(([noticeMessage]) => noticeMessage)).toStrictEqual([message]);
      expect(log.mock.calls[0]?.[1]).toMatchObject({
        action: title === 'Copy tab' ? 'copy' : 'paste',
        failure: { ok: false, reason: 'source-conflict' },
      });
      block.unload();
    },
  );

  it('reports an unexpected clipboard rejection once with formatted diagnostics', async () => {
    clipboard({
      write: async () => {
        throw new Error('permission denied');
      },
    });
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { block } = await sourceBlock('tab: A\nalpha');

    await click(openMenu(block), 'Copy tab');

    expect(notice.mock.calls.map(([message]) => message)).toStrictEqual(['Could not copy tab.']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      action: 'copy',
      sourcePath: 'Note.md',
      index: 0,
      error: 'permission denied',
    });
    block.unload();
  });

  it('reports a clipboard read rejection without mutating the source', async () => {
    clipboard({
      read: async () => {
        throw new Error('read permission denied');
      },
    });
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { block, view, fullSource } = await sourceBlock('tab: A\nalpha');
    const transaction = vi.spyOn(view.editor, 'transaction');

    await click(openMenu(block), 'Paste tab');

    expect(view.editor.getValue()).toBe(fullSource);
    expect(transaction).not.toHaveBeenCalled();
    expect(notice.mock.calls.map(([message]) => message)).toStrictEqual(['Could not paste tab.']);
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      action: 'paste',
      sourcePath: 'Note.md',
      index: 0,
      error: 'read permission denied',
    });
    block.unload();
  });

  it('rejects an empty clipboard once without a transaction', async () => {
    const pasted = clipboard({ read: async () => '' });
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { block, view, fullSource } = await sourceBlock('tab: A\nalpha');
    const transaction = vi.spyOn(view.editor, 'transaction');

    await click(openMenu(block), 'Paste tab');

    expect(pasted.readText).toHaveBeenCalledTimes(1);
    expect(view.editor.getValue()).toBe(fullSource);
    expect(transaction).not.toHaveBeenCalled();
    expect(notice.mock.calls.map(([message]) => message)).toStrictEqual(['Could not paste tab.']);
    expect(log).toHaveBeenCalledTimes(1);
    block.unload();
  });
});
