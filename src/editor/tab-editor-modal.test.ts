import type { EditorPosition, Editor as ObsidianEditor } from 'obsidian';
import { App, Editor, FileSystemAdapter, Notice } from 'obsidian-test-mocks/obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type TabbedSettings } from '../settings.js';
import { SourceLocator } from '../source/source-locator.js';
import type { TextSelection, TextTransformInput, TextTransformResult } from './text-transforms.js';

type Transform = (input: TextTransformInput) => TextTransformResult;

interface FakeEditorOptions {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSave: (value: string) => void;
}

interface FakeEditorComponent {
  readonly options: FakeEditorOptions;
  value: string;
  destroyed: number;
  change(value: string): void;
  requestSave(): void;
  getValue(): string;
  applyTransform(transform: Transform): boolean;
}

const editorDoubles = vi.hoisted(() => ({ instances: [] as FakeEditorComponent[] }));

vi.mock('./tab-editor-component.js', async () => {
  const { Component: ObsidianComponent } = await import('obsidian');
  class FakeTabEditorComponent extends ObsidianComponent {
    readonly options: FakeEditorOptions;
    value: string;
    destroyed = 0;

    constructor(options: FakeEditorOptions) {
      super();
      this.options = options;
      this.value = options.value;
      editorDoubles.instances.push(this);
    }

    change(value: string): void {
      this.value = value;
      this.options.onChange(value);
    }

    requestSave(): void {
      this.options.onSave(this.value);
    }

    getValue(): string {
      return this.value;
    }

    focus(): void {}

    applyTransform(_transform: Transform): boolean {
      return true;
    }

    override onunload(): void {
      this.destroyed += 1;
    }
  }
  return { TabEditorComponent: FakeTabEditorComponent };
});

import { TabEditorModal, type TabEditorRequest } from './tab-editor-modal.js';

const block = ['```tabs', 'tab: A', 'alpha', 'tab: B', 'beta', '```'].join('\n');

class RealisticEditor extends Editor {
  constructor(value: string) {
    super();
    this.setValue(value);
  }

  override getLine(line: number): string {
    return this.getValue().split(/\r?\n/)[line] ?? '';
  }

  override lineCount(): number {
    return this.getValue().split(/\r?\n/).length;
  }

  override offsetToPos(offset: number): EditorPosition {
    const value = this.getValue();
    const target = Math.max(0, Math.min(offset, value.length));
    let line = 0;
    let lineStart = 0;
    for (let index = 0; index < target; index += 1) {
      if (value[index] === '\n') {
        line += 1;
        lineStart = index + 1;
      }
    }
    return { line, ch: Math.min(target - lineStart, this.getLine(line).length) };
  }

  override posToOffset(position: EditorPosition): number {
    const value = this.getValue();
    let lineStart = 0;
    for (let line = 0; line < position.line; line += 1) {
      const newline = value.indexOf('\n', lineStart);
      if (newline === -1) {
        return value.length;
      }
      lineStart = newline + 1;
    }
    return lineStart + Math.min(Math.max(position.ch, 0), this.getLine(position.line).length);
  }

  asEditor(): ObsidianEditor {
    return this.asOriginalType__();
  }
}

function locatorAt(editor: RealisticEditor): SourceLocator {
  const offset = editor.getValue().indexOf(block);
  const from = editor.offsetToPos(offset);
  const to = editor.offsetToPos(offset + block.length);
  const locator = SourceLocator.fromSection(
    editor.asEditor(),
    { text: block, lineStart: from.line, lineEnd: to.line },
    DEFAULT_SETTINGS,
  );
  if (locator === null) {
    throw new Error('Expected source locator');
  }
  return locator;
}

function settings(autoSaveDelayMs: number): TabbedSettings {
  return { ...DEFAULT_SETTINGS, autoSaveDelayMs };
}

function request(editor: RealisticEditor): TabEditorRequest {
  return {
    locator: locatorAt(editor),
    index: 0,
    title: 'A',
    content: 'alpha',
    sourcePath: 'Note.md',
  };
}

function openModal(editor: RealisticEditor, delay = 100): TabEditorModal {
  const adapter = FileSystemAdapter.create__('/mock-vault').asOriginalType__();
  const modal = new TabEditorModal(App.create__(adapter, 'test').asOriginalType__(), () =>
    settings(delay),
  );
  vi.spyOn(modal, 'open').mockImplementation(() => {
    modal.onOpen();
  });
  modal.openFor(request(editor));
  return modal;
}

function currentEditor(): FakeEditorComponent {
  const editor = editorDoubles.instances[editorDoubles.instances.length - 1];
  if (editor === undefined) {
    throw new Error('Expected editor component');
  }
  return editor;
}

async function flushQueue(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

interface ToolbarExpectation {
  readonly label: string;
  readonly input: TextTransformInput;
  readonly text: string;
  readonly selection: TextSelection;
}

const toolbarExpectations: readonly ToolbarExpectation[] = [
  {
    label: 'Bold',
    input: { text: 'alpha', selection: { from: 0, to: 5 } },
    text: '**alpha**',
    selection: { from: 2, to: 7 },
  },
  {
    label: 'Italic',
    input: { text: 'alpha', selection: { from: 0, to: 5 } },
    text: '*alpha*',
    selection: { from: 1, to: 6 },
  },
  {
    label: 'Underline',
    input: { text: 'alpha', selection: { from: 0, to: 5 } },
    text: '<u>alpha</u>',
    selection: { from: 3, to: 8 },
  },
  {
    label: 'Strike',
    input: { text: 'alpha', selection: { from: 0, to: 5 } },
    text: '~~alpha~~',
    selection: { from: 2, to: 7 },
  },
  {
    label: 'Bullet list',
    input: { text: 'alpha', selection: { from: 0, to: 5 } },
    text: '- alpha',
    selection: { from: 2, to: 7 },
  },
  {
    label: 'Numbered list',
    input: { text: 'alpha', selection: { from: 0, to: 5 } },
    text: '1. alpha',
    selection: { from: 3, to: 8 },
  },
  {
    label: 'Task list',
    input: { text: 'alpha', selection: { from: 0, to: 5 } },
    text: '- [ ] alpha',
    selection: { from: 6, to: 11 },
  },
  {
    label: 'Quote',
    input: { text: 'alpha', selection: { from: 0, to: 5 } },
    text: '> alpha',
    selection: { from: 2, to: 7 },
  },
  {
    label: 'Code block',
    input: { text: 'alpha', selection: { from: 0, to: 5 } },
    text: '```\nalpha\n```',
    selection: { from: 4, to: 9 },
  },
  {
    label: 'Callout',
    input: { text: 'alpha', selection: { from: 0, to: 5 } },
    text: '> [!note]\n> alpha',
    selection: { from: 12, to: 17 },
  },
  {
    label: 'Table',
    input: { text: 'before\nafter', selection: { from: 7, to: 7 } },
    text: 'before\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\nafter',
    selection: { from: 9, to: 17 },
  },
  {
    label: 'Indent',
    input: { text: 'alpha', selection: { from: 0, to: 5 } },
    text: '    alpha',
    selection: { from: 4, to: 9 },
  },
  {
    label: 'Outdent',
    input: { text: '    alpha', selection: { from: 4, to: 9 } },
    text: 'alpha',
    selection: { from: 0, to: 5 },
  },
];

describe('TabEditorModal autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    editorDoubles.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps every rendered toolbar button to its formatting transform', () => {
    const modal = openModal(new RealisticEditor(block));
    const editor = currentEditor();
    const applyTransform = vi.spyOn(editor, 'applyTransform');
    const buttons = Array.from(
      modal.contentEl.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button'),
    );

    expect(buttons.map((button) => button.textContent)).toStrictEqual(
      toolbarExpectations.map(({ label }) => label),
    );
    for (const [index, expected] of toolbarExpectations.entries()) {
      buttons[index]?.click();
      const transform = applyTransform.mock.calls[index]?.[0];
      expect(transform?.(expected.input)).toStrictEqual({
        text: expected.text,
        selection: expected.selection,
      });
    }
  });

  it('waits for the full idle delay and restarts the timeout after another change', async () => {
    const source = new RealisticEditor(block);
    const transaction = vi.spyOn(source, 'transaction');
    openModal(source);

    currentEditor().change('first');
    await vi.advanceTimersByTimeAsync(99);
    currentEditor().change('second');
    await vi.advanceTimersByTimeAsync(99);
    expect(transaction).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(source.getValue()).toContain('second');
    expect(source.getValue()).not.toContain('first');
  });

  it('saves immediately after a zero delay', async () => {
    const source = new RealisticEditor(block);
    const transaction = vi.spyOn(source, 'transaction');
    openModal(source, 0);

    currentEditor().change('changed');
    expect(transaction).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(source.getValue()).toContain('changed');
  });

  it('serializes sequential autosaves and advances the locator after source shifts', async () => {
    const source = new RealisticEditor(`before\n${block}\nafter`);
    const transaction = vi.spyOn(source, 'transaction');
    openModal(source, 10);

    currentEditor().change('first save');
    await vi.advanceTimersByTimeAsync(10);
    source.setValue(`inserted\n${source.getValue()}`);
    currentEditor().change('second save');
    await vi.advanceTimersByTimeAsync(10);

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(source.getValue()).toContain('second save');
    expect(source.getValue()).not.toContain('first save');
    expect(source.getValue().startsWith('inserted\nbefore\n```tabs')).toBe(true);
  });

  it('queues autosave and close snapshots in order and writes the final value last', async () => {
    const source = new RealisticEditor(block);
    const transaction = vi.spyOn(source, 'transaction');
    const modal = openModal(source, 10);

    currentEditor().change('autosave');
    vi.advanceTimersByTime(10);
    currentEditor().change('close value');
    modal.onClose();
    await flushQueue();

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(source.getValue()).toContain('close value');
    expect(source.getValue()).not.toContain('autosave');
  });

  it('deduplicates an identical pending autosave on close and destroys the editor immediately', async () => {
    const source = new RealisticEditor(block);
    const transaction = vi.spyOn(source, 'transaction');
    const modal = openModal(source, 10);
    const editor = currentEditor();
    const getValue = vi.spyOn(editor, 'getValue');

    editor.change('same revision');
    vi.advanceTimersByTime(10);
    modal.onClose();

    expect(editor.destroyed).toBe(1);
    expect(getValue).toHaveBeenCalledTimes(1);
    await flushQueue();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(source.getValue()).toContain('same revision');
    expect(getValue).toHaveBeenCalledTimes(1);
  });

  it('does not write an already saved identical revision again on close', async () => {
    const source = new RealisticEditor(block);
    const transaction = vi.spyOn(source, 'transaction');
    const modal = openModal(source, 10);

    currentEditor().change('saved');
    await vi.advanceTimersByTimeAsync(10);
    modal.onClose();
    await flushQueue();

    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('keeps pending revisions from separate openFor sessions independent', async () => {
    const firstSource = new RealisticEditor(block);
    const secondSource = new RealisticEditor(block);
    const firstTransaction = vi.spyOn(firstSource, 'transaction');
    const secondTransaction = vi.spyOn(secondSource, 'transaction');
    const modal = openModal(firstSource, 10);

    currentEditor().change('first session');
    vi.advanceTimersByTime(10);
    modal.onClose();

    modal.openFor(request(secondSource));
    currentEditor().change('second session');
    modal.onClose();
    await flushQueue();

    expect(firstTransaction).toHaveBeenCalledTimes(1);
    expect(secondTransaction).toHaveBeenCalledTimes(1);
    expect(firstSource.getValue()).toContain('first session');
    expect(secondSource.getValue()).toContain('second session');
  });

  it('recovers after a failed autosave and gives the close retry one Notice', async () => {
    const source = new RealisticEditor(block);
    const originalTransaction = source.transaction.bind(source);
    const transaction = vi
      .spyOn(source, 'transaction')
      .mockImplementationOnce(() => {
        throw new Error('locked');
      })
      .mockImplementationOnce(() => {
        throw new Error('still locked');
      })
      .mockImplementation(originalTransaction);
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const modal = openModal(source, 10);

    currentEditor().change('retry me');
    await vi.advanceTimersByTimeAsync(10);
    expect(notice).not.toHaveBeenCalled();

    modal.onClose();
    await flushQueue();

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(notice).toHaveBeenCalledExactlyOnceWith('Could not save tab changes.', undefined);
    expect(error).toHaveBeenCalledTimes(2);
    expect(source.getValue()).toBe(block);
  });
});

describe('TabEditorModal conflict and ownership boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    editorDoubles.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('owns its modal styling class only while the editor is open', () => {
    const source = new RealisticEditor(block);
    const modal = openModal(source);

    expect(modal.modalEl.classList.contains('tabbed-editor-modal')).toBe(true);

    modal.onClose();
    expect(modal.modalEl.classList.contains('tabbed-editor-modal')).toBe(false);

    modal.openFor(request(source));
    expect(modal.modalEl.classList.contains('tabbed-editor-modal')).toBe(true);

    modal.dispose();
    expect(modal.modalEl.classList.contains('tabbed-editor-modal')).toBe(false);
  });

  it.each([
    ['deleted', block, 'deleted'],
    [
      'ambiguous',
      `before\n${block}\nafter`,
      `before\n${block}\nafter\nnoise\nbefore\n${block}\nafter`,
    ],
  ] as const)(
    'reports one modal-level Notice when the source block is %s',
    async (_, initial, conflict) => {
      const source = new RealisticEditor(initial);
      const notice = vi.spyOn(Notice.prototype, 'constructor__');
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const modal = openModal(source, 10);
      currentEditor().change('cannot save');
      source.setValue(conflict);

      modal.onClose();
      await flushQueue();

      expect(notice).toHaveBeenCalledExactlyOnceWith('Could not save tab changes.', undefined);
      expect(error).toHaveBeenCalledExactlyOnceWith(
        '[tabbed] Could not save tab changes',
        expect.objectContaining({ sourcePath: 'Note.md', index: 0 }),
      );
      expect(source.getValue()).toBe(conflict);
    },
  );

  it('cancels a queued autosave on plugin unload without a late mutation', async () => {
    const source = new RealisticEditor(block);
    const transaction = vi.spyOn(source, 'transaction');
    const modal = openModal(source, 10);
    const editor = currentEditor();

    editor.change('must not save');
    vi.advanceTimersByTime(10);
    modal.dispose();
    await flushQueue();

    expect(transaction).not.toHaveBeenCalled();
    expect(source.getValue()).toBe(block);
    expect(editor.destroyed).toBe(1);
  });

  it('clears a pending debounce on plugin unload', async () => {
    const source = new RealisticEditor(block);
    const transaction = vi.spyOn(source, 'transaction');
    const modal = openModal(source, 10);
    const editor = currentEditor();

    editor.change('must not save');
    modal.dispose();
    await vi.runAllTimersAsync();

    expect(transaction).not.toHaveBeenCalled();
    expect(editor.destroyed).toBe(1);
  });
});
