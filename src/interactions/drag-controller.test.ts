import type { MarkdownPostProcessorContext } from 'obsidian';
import { App, MarkdownView, Notice, Platform } from 'obsidian-test-mocks/obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabsBlock, type TabsBlockHost } from '../render/tabs-block.js';
import { DEFAULT_SETTINGS, type TabbedSettings } from '../settings.js';
import { SelectionMemory } from '../tabs/selection-memory.js';
import { DragController } from './drag-controller.js';

interface TransferDouble {
  dropEffect: DataTransfer['dropEffect'];
  effectAllowed: DataTransfer['effectAllowed'];
  setData: ReturnType<typeof vi.fn>;
}

function settings(overrides: Partial<TabbedSettings> = {}): TabbedSettings {
  return {
    ...DEFAULT_SETTINGS,
    dragAndDrop: true,
    showSuccessNotices: false,
    ...overrides,
  };
}

function fullBlock(inner: string): string {
  return `\`\`\`tabs\n${inner}${inner.length > 0 && !inner.endsWith('\n') ? '\n' : ''}\`\`\``;
}

function host(onRegister?: (block: TabsBlock) => void): TabsBlockHost {
  return {
    register: (block) => onRegister?.(block),
    unregister: vi.fn(),
    addTab: vi.fn(),
    editTab: vi.fn(),
    openTabMenu: vi.fn(),
  };
}

async function blocksInView(
  inners: readonly string[],
  options: {
    mode?: 'source' | 'preview';
    path?: string;
    settings?: TabbedSettings;
    onRegister?: (block: TabsBlock) => void;
  } = {},
) {
  const current = options.settings ?? settings();
  const mockApp = App.createConfigured__();
  const leaf = mockApp.workspace.getLeaf(true);
  await leaf.setViewState({ type: 'markdown' });
  const view = MarkdownView.create2__(leaf);
  await leaf.open(view.asOriginalType7__());
  vi.spyOn(view, 'getMode').mockReturnValue(options.mode ?? 'source');
  const fullBlocks = inners.map(fullBlock);
  const starts: number[] = [];
  let source = '';
  for (const full of fullBlocks) {
    if (source.length > 0) {
      source += '\nbetween\n';
    }
    starts.push(source.split('\n').length - 1);
    source += full;
  }
  view.setViewData(source, false);
  document.body.append(view.containerEl);
  const blocks = inners.map((inner, index) => {
    const full = fullBlocks[index];
    const lineStart = starts[index];
    if (full === undefined || lineStart === undefined) {
      throw new Error('Expected block fixture source');
    }
    const wrapper = view.containerEl.createDiv({ cls: 'block-language-tabs' });
    const container = wrapper.createDiv();
    const context: MarkdownPostProcessorContext = {
      sourcePath: options.path ?? 'Note.md',
      docId: `doc-${index}`,
      frontmatter: null,
      addChild: vi.fn(),
      getSectionInfo: vi.fn(() => ({
        text: full,
        lineStart,
        lineEnd: lineStart + full.split('\n').length - 1,
      })),
    };
    const block = new TabsBlock(
      mockApp.asOriginalType__(),
      container,
      inner,
      context,
      current,
      new SelectionMemory(32),
      host(options.onRegister),
      async () => undefined,
    );
    block.load();
    return block;
  });
  return { blocks, source, view };
}

function controller(getSettings: () => TabbedSettings): DragController {
  const instance = new DragController(getSettings);
  instance.load();
  return instance;
}

async function settleBinding(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function transfer(): TransferDouble {
  return { dropEffect: 'none', effectAllowed: 'uninitialized', setData: vi.fn() };
}

function dragEvent(
  type: 'dragstart' | 'dragend' | 'dragover' | 'drop',
  dataTransfer: TransferDouble,
  coordinates: { clientX?: number; clientY?: number } = {},
): DragEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: coordinates.clientX ?? 0,
    clientY: coordinates.clientY ?? 0,
  });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event as unknown as DragEvent;
}

function dispatch(
  target: Element,
  type: 'dragstart' | 'dragend' | 'dragover' | 'drop',
  dataTransfer: TransferDouble,
  coordinates: { clientX?: number; clientY?: number } = {},
): DragEvent {
  const event = dragEvent(type, dataTransfer, coordinates);
  target.dispatchEvent(event);
  return event;
}

function fixedRect(element: HTMLElement): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    bottom: 100,
    height: 100,
    left: 0,
    right: 100,
    top: 0,
    width: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

function unload(blocks: readonly TabsBlock[], drag: DragController): void {
  drag.unload();
  for (const block of blocks) {
    block.unload();
  }
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

function blockAt(blocks: readonly TabsBlock[], index: number): TabsBlock {
  return required(blocks[index], `Expected block ${index}`);
}

function tabAt(block: TabsBlock, index: number): HTMLElement {
  return required(block.tabElements[index], `Expected tab ${index}`);
}

afterEach(() => {
  Platform.isMobile = false;
  document.body.replaceChildren();
});

describe('DragController binding lifecycle', () => {
  it('binds the tabs created after host registration on its guarded microtask', async () => {
    const current = settings();
    const drag = controller(() => current);
    const fixture = await blocksInView(['tab: A\na\ntab: B\nb'], {
      settings: current,
      onRegister: (block) => {
        drag.bind(block);
      },
    });

    await settleBinding();

    expect(
      fixture.blocks[0]?.tabElements.map((tab) => tab.getAttribute('draggable')),
    ).toStrictEqual(['true', 'true']);
    unload(fixture.blocks, drag);
  });

  it.each([
    ['mobile', true, true, 'source'],
    ['disabled', false, false, 'source'],
    ['Reading view', false, true, 'preview'],
  ] as const)('leaves tabs non-draggable when %s', async (_name, mobile, enabled, mode) => {
    Platform.isMobile = mobile;
    const current = settings({ dragAndDrop: enabled });
    const fixture = await blocksInView(['tab: A\na'], { mode, settings: current });
    const drag = controller(() => current);

    const block = blockAt(fixture.blocks, 0);
    drag.bind(block);
    await settleBinding();
    const data = transfer();
    dispatch(tabAt(block, 0), 'dragstart', data);

    expect(tabAt(block, 0).hasAttribute('draggable')).toBe(false);
    expect(data.setData).not.toHaveBeenCalled();
    unload(fixture.blocks, drag);
  });

  it('rebinds idempotently after replaced tab DOM and removes the old listeners and attribute', async () => {
    const initial = settings();
    const next = settings({ separator: 'pane: ' });
    const getSettings = vi.fn(() => initial);
    const fixture = await blocksInView(['tab: A\na\ntab: B\nb'], { settings: initial });
    const drag = controller(getSettings);
    const block = blockAt(fixture.blocks, 0);
    drag.bind(block);
    await settleBinding();
    const oldTab = tabAt(block, 0);

    await block.applySettings(next);
    getSettings.mockReturnValue(next);
    drag.bind(block);
    drag.bind(block);
    await settleBinding();
    const newTab = tabAt(block, 0);
    const oldTransfer = transfer();
    const newTransfer = transfer();
    dispatch(oldTab, 'dragstart', oldTransfer);
    dispatch(newTab, 'dragstart', newTransfer);

    expect(oldTab.hasAttribute('draggable')).toBe(false);
    expect(oldTransfer.setData).not.toHaveBeenCalled();
    expect(newTab.getAttribute('draggable')).toBe('true');
    expect(newTransfer.setData).toHaveBeenCalledExactlyOnceWith('text/plain', 'tabbed');
    unload(fixture.blocks, drag);
  });

  it('invalidates a queued bind and clears attributes and the active session', async () => {
    const current = settings();
    const fixture = await blocksInView(['tab: A\na'], { settings: current });
    const drag = controller(() => current);
    const block = blockAt(fixture.blocks, 0);
    drag.bind(block);
    drag.clear();
    await settleBinding();

    expect(tabAt(block, 0).hasAttribute('draggable')).toBe(false);
    expect(dispatch(tabAt(block, 0), 'dragstart', transfer()).defaultPrevented).toBe(false);
    unload(fixture.blocks, drag);
  });

  it('stops a nested drag event at its tab-owned listener and writes only the marker payload', async () => {
    const current = settings();
    const fixture = await blocksInView(['tab: A\na'], { settings: current });
    const drag = controller(() => current);
    const block = blockAt(fixture.blocks, 0);
    drag.bind(block);
    await settleBinding();
    const parentDrag = vi.fn();
    required(tabAt(block, 0).parentElement, 'Expected tab list').addEventListener(
      'dragstart',
      parentDrag,
    );
    const data = transfer();

    dispatch(
      required(tabAt(block, 0).querySelector('.tabbed__title'), 'Expected title'),
      'dragstart',
      data,
    );

    expect(parentDrag).not.toHaveBeenCalled();
    expect(data.setData).toHaveBeenCalledExactlyOnceWith('text/plain', 'tabbed');
    expect(data.effectAllowed).toBe('move');
    unload(fixture.blocks, drag);
  });
});

describe('DragController drop mutations', () => {
  it.each([
    {
      name: 'top before',
      position: 'top',
      coordinates: { clientX: 25, clientY: 75 },
      targetIndex: 0,
      order: ['B', 'A', 'C'],
      successNotice: true,
    },
    {
      name: 'bottom after',
      position: 'bottom',
      coordinates: { clientX: 75, clientY: 25 },
      targetIndex: 2,
      order: ['A', 'C', 'B'],
      successNotice: false,
    },
    {
      name: 'left before',
      position: 'left',
      coordinates: { clientX: 75, clientY: 25 },
      targetIndex: 0,
      order: ['B', 'A', 'C'],
      successNotice: false,
    },
    {
      name: 'right after',
      position: 'right',
      coordinates: { clientX: 25, clientY: 75 },
      targetIndex: 2,
      order: ['A', 'C', 'B'],
      successNotice: false,
    },
  ] as const)(
    'moves on the $name side using the configured axis',
    async ({ position, coordinates, targetIndex, order, successNotice }) => {
      const current = settings({ titlePosition: position, showSuccessNotices: successNotice });
      const fixture = await blocksInView(['tab: A\na\ntab: B\nb\ntab: C\nc'], {
        settings: current,
      });
      const drag = controller(() => current);
      const block = blockAt(fixture.blocks, 0);
      drag.bind(block);
      await settleBinding();
      const transaction = vi.spyOn(fixture.view.editor, 'transaction');
      const notice = vi.spyOn(Notice.prototype, 'constructor__');
      const target = tabAt(block, targetIndex);
      fixedRect(target);
      const data = transfer();

      dispatch(tabAt(block, 1), 'dragstart', data);
      const over = dispatch(target, 'dragover', data, coordinates);
      dispatch(target, 'drop', data, coordinates);

      expect(over.defaultPrevented).toBe(true);
      expect(data.dropEffect).toBe('move');
      expect(transaction).toHaveBeenCalledTimes(1);
      const titles = [...fixture.view.editor.getValue().matchAll(/^tab: (.+)$/gm)].map(
        (match) => match[1],
      );
      expect(titles).toStrictEqual(order);
      expect(notice.mock.calls.map(([message]) => message)).toStrictEqual(
        successNotice ? ['Moved tab.'] : [],
      );
      unload(fixture.blocks, drag);
    },
  );

  it('moves across blocks in one same-note editor transaction using the target insertion slot', async () => {
    const current = settings();
    const fixture = await blocksInView(['tab: A\na\ntab: B\nb', 'tab: X\nx'], {
      settings: current,
    });
    const drag = controller(() => current);
    for (const block of fixture.blocks) {
      drag.bind(block);
    }
    await settleBinding();
    const transaction = vi.spyOn(fixture.view.editor, 'transaction');
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const [source, target] = fixture.blocks;
    const sourceBlock = required(source, 'Expected source block');
    const targetBlock = required(target, 'Expected target block');
    fixedRect(tabAt(targetBlock, 0));
    const data = transfer();

    dispatch(tabAt(sourceBlock, 0), 'dragstart', data);
    dispatch(tabAt(targetBlock, 0), 'drop', data, { clientX: 75 });

    expect(fixture.view.editor.getValue()).toBe(
      [
        '```tabs',
        'tab: B',
        'b',
        '```',
        'between',
        '```tabs',
        'tab: X',
        'x',
        'tab: A',
        'a',
        '```',
      ].join('\n'),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0]?.[0].changes).toHaveLength(2);
    expect(notice).not.toHaveBeenCalled();
    unload(fixture.blocks, drag);
  });

  it('treats a same-block final index equal to the source as a silent no-op', async () => {
    const current = settings({ showSuccessNotices: true });
    const fixture = await blocksInView(['tab: A\na\ntab: B\nb'], { settings: current });
    const drag = controller(() => current);
    const block = blockAt(fixture.blocks, 0);
    drag.bind(block);
    await settleBinding();
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const transaction = vi.spyOn(fixture.view.editor, 'transaction');
    fixedRect(tabAt(block, 0));
    const data = transfer();

    dispatch(tabAt(block, 0), 'dragstart', data);
    dispatch(tabAt(block, 0), 'drop', data, { clientX: 25 });
    const after = dispatch(tabAt(block, 1), 'dragover', data, { clientX: 25 });

    expect(fixture.view.editor.getValue()).toBe(fixture.source);
    expect(transaction).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
    expect(after.defaultPrevented).toBe(false);
    unload(fixture.blocks, drag);
  });

  it('rejects the same path in a different editor and clears the session', async () => {
    const current = settings();
    const sourceFixture = await blocksInView(['tab: A\na'], { path: 'Same.md', settings: current });
    const targetFixture = await blocksInView(['tab: X\nx'], { path: 'Same.md', settings: current });
    const drag = controller(() => current);
    const source = blockAt(sourceFixture.blocks, 0);
    const target = blockAt(targetFixture.blocks, 0);
    drag.bind(source);
    drag.bind(target);
    await settleBinding();
    const sourceTransaction = vi.spyOn(sourceFixture.view.editor, 'transaction');
    const targetTransaction = vi.spyOn(targetFixture.view.editor, 'transaction');
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fixedRect(tabAt(target, 0));
    const data = transfer();

    dispatch(tabAt(source, 0), 'dragstart', data);
    const over = dispatch(tabAt(target, 0), 'dragover', data, { clientX: 25 });
    dispatch(tabAt(target, 0), 'drop', data, { clientX: 25 });
    const after = dispatch(tabAt(target, 0), 'dragover', data, { clientX: 25 });

    expect(over.defaultPrevented).toBe(false);
    expect(notice.mock.calls.map(([message]) => message)).toStrictEqual(['Could not move tab.']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(sourceTransaction).not.toHaveBeenCalled();
    expect(targetTransaction).not.toHaveBeenCalled();
    expect(after.defaultPrevented).toBe(false);
    unload([...sourceFixture.blocks, ...targetFixture.blocks], drag);
  });

  it('reports stale source validation without a transaction and clears the session', async () => {
    const current = settings();
    const fixture = await blocksInView(['tab: A\na\ntab: B\nb'], { settings: current });
    const drag = controller(() => current);
    const block = blockAt(fixture.blocks, 0);
    drag.bind(block);
    await settleBinding();
    fixedRect(tabAt(block, 1));
    const data = transfer();
    dispatch(tabAt(block, 0), 'dragstart', data);
    fixture.view.editor.setValue('changed elsewhere');
    const transaction = vi.spyOn(fixture.view.editor, 'transaction');
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    dispatch(tabAt(block, 1), 'drop', data, { clientX: 75 });
    const after = dispatch(tabAt(block, 1), 'dragover', data, { clientX: 75 });

    expect(fixture.view.editor.getValue()).toBe('changed elsewhere');
    expect(transaction).not.toHaveBeenCalled();
    expect(notice.mock.calls.map(([message]) => message)).toStrictEqual(['Could not move tab.']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(after.defaultPrevented).toBe(false);
    unload(fixture.blocks, drag);
  });

  it('reports an atomic transaction failure once without partial source and clears the session', async () => {
    const current = settings();
    const fixture = await blocksInView(['tab: A\na\ntab: B\nb'], { settings: current });
    const drag = controller(() => current);
    const block = blockAt(fixture.blocks, 0);
    drag.bind(block);
    await settleBinding();
    fixedRect(tabAt(block, 1));
    const data = transfer();
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const transaction = vi.spyOn(fixture.view.editor, 'transaction').mockImplementationOnce(() => {
      throw new Error('transaction rejected');
    });

    dispatch(tabAt(block, 0), 'dragstart', data);
    dispatch(tabAt(block, 1), 'drop', data, { clientX: 75 });
    const after = dispatch(tabAt(block, 1), 'dragover', data, { clientX: 75 });

    expect(fixture.view.editor.getValue()).toBe(fixture.source);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(notice.mock.calls.map(([message]) => message)).toStrictEqual(['Could not move tab.']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(after.defaultPrevented).toBe(false);
    unload(fixture.blocks, drag);
  });

  it('clears the session on dragend without a mutation', async () => {
    const current = settings();
    const fixture = await blocksInView(['tab: A\na\ntab: B\nb'], { settings: current });
    const drag = controller(() => current);
    const block = blockAt(fixture.blocks, 0);
    drag.bind(block);
    await settleBinding();
    fixedRect(tabAt(block, 1));
    const data = transfer();

    dispatch(tabAt(block, 0), 'dragstart', data);
    dispatch(tabAt(block, 0), 'dragend', data);
    const over = dispatch(tabAt(block, 1), 'dragover', data, { clientX: 25 });

    expect(over.defaultPrevented).toBe(false);
    expect(fixture.view.editor.getValue()).toBe(fixture.source);
    unload(fixture.blocks, drag);
  });
});
