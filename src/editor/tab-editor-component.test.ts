import type { EditorStateConfig } from '@codemirror/state';
import type { EditorViewConfig, KeyBinding, ViewUpdate } from '@codemirror/view';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const codeMirror = vi.hoisted(() => {
  const configs: EditorViewConfig[] = [];
  const stateConfigs: EditorStateConfig[] = [];
  const destroyed: object[] = [];
  const focused: object[] = [];

  class FakeEditorView {
    static readonly lineWrapping = { kind: 'line-wrapping' };

    static readonly updateListener = {
      of: (listener: (update: ViewUpdate) => void) => ({ kind: 'update-listener', listener }),
    };

    state: {
      doc: { length: number; toString: () => string };
      selection: { main: { from: number; to: number } };
      extensions: readonly unknown[];
    };

    constructor(config: EditorViewConfig) {
      configs.push(config);
      this.state = config.state as unknown as FakeEditorView['state'];
    }

    destroy(): void {
      destroyed.push(this);
    }

    focus(): void {
      focused.push(this);
    }

    dispatch(transaction: {
      readonly changes?: { readonly from: number; readonly to: number; readonly insert: string };
      readonly selection?: { readonly from: number; readonly to: number };
    }): void {
      const changes = transaction.changes;
      if (changes !== undefined) {
        const current = this.state.doc.toString();
        const value = `${current.slice(0, changes.from)}${changes.insert}${current.slice(changes.to)}`;
        this.state.doc = { length: value.length, toString: () => value };
      }
      if (transaction.selection !== undefined) {
        this.state.selection.main = { ...transaction.selection };
      }
      for (const extension of this.state.extensions) {
        const tagged = extension as {
          readonly kind?: string;
          readonly listener?: (update: ViewUpdate) => void;
        };
        if (tagged.kind === 'update-listener') {
          tagged.listener?.({
            docChanged: changes !== undefined,
            state: this.state,
          } as unknown as ViewUpdate);
        }
      }
    }
  }

  return { configs, destroyed, focused, stateConfigs, FakeEditorView };
});

vi.mock('@codemirror/state', () => ({
  EditorSelection: {
    range: (from: number, to: number) => ({ from, to }),
  },
  EditorState: {
    create: vi.fn((config: EditorStateConfig) => {
      codeMirror.stateConfigs.push(config);
      const value = String(config.doc ?? '');
      return {
        doc: { length: value.length, toString: () => value },
        selection: { main: { from: 0, to: 0 } },
        extensions: Array.isArray(config.extensions) ? config.extensions : [config.extensions],
      };
    }),
  },
}));

vi.mock('@codemirror/view', () => ({
  EditorView: codeMirror.FakeEditorView,
  keymap: { of: (bindings: readonly KeyBinding[]) => ({ kind: 'keymap', bindings }) },
}));

vi.mock('@codemirror/commands', () => ({
  defaultKeymap: [{ key: 'ArrowLeft' }],
  history: () => ({ kind: 'history' }),
  historyKeymap: [{ key: 'Mod-z' }],
}));

vi.mock('@codemirror/lang-markdown', () => ({
  markdown: () => ({ kind: 'markdown' }),
}));

vi.mock('@codemirror/language', () => ({
  defaultHighlightStyle: { kind: 'default-highlight-style' },
  syntaxHighlighting: (style: unknown) => ({ kind: 'syntax-highlighting', style }),
}));

import { TabEditorComponent } from './tab-editor-component.js';
import {
  indentSelection,
  insertCallout,
  insertCodeBlock,
  insertTable,
  outdentSelection,
  toggleBold,
  toggleItalic,
  toggleOrderedList,
  toggleQuote,
  toggleStrike,
  toggleTaskList,
  toggleUnderline,
  toggleUnorderedList,
  type TextTransformInput,
  type TextTransformResult,
} from './text-transforms.js';

interface TaggedExtension {
  readonly kind: string;
  readonly bindings?: readonly KeyBinding[];
  readonly listener?: (update: ViewUpdate) => void;
}

interface ExpectedEdit {
  readonly input: string;
  readonly selection: { readonly from: number; readonly to: number };
  readonly text: string;
  readonly transformedSelection: { readonly from: number; readonly to: number };
}

type Transform = (input: TextTransformInput) => TextTransformResult;

function taggedExtensions(): readonly TaggedExtension[] {
  return codeMirror.stateConfigs[0]?.extensions as unknown as readonly TaggedExtension[];
}

function currentState(): {
  readonly doc: { toString: () => string };
  readonly selection: { readonly main: { readonly from: number; readonly to: number } };
} {
  return codeMirror.configs[0]?.state as ReturnType<typeof currentState>;
}

function setSelection(selection: { readonly from: number; readonly to: number }): void {
  const state = currentState() as {
    selection: { main: { from: number; to: number } };
  };
  state.selection.main = { ...selection };
}

function formattingBinding(key: string): KeyBinding {
  const binding = taggedExtensions()
    .find((extension) => extension.kind === 'keymap')
    ?.bindings?.find((candidate) => candidate.key === key);
  if (binding === undefined) {
    throw new Error(`Expected ${key} binding`);
  }
  return binding;
}

const toolbarCases: ReadonlyArray<readonly [string, Transform, ExpectedEdit]> = [
  [
    'bold',
    toggleBold,
    {
      input: 'text',
      selection: { from: 0, to: 4 },
      text: '**text**',
      transformedSelection: { from: 2, to: 6 },
    },
  ],
  [
    'italic',
    toggleItalic,
    {
      input: 'text',
      selection: { from: 0, to: 4 },
      text: '*text*',
      transformedSelection: { from: 1, to: 5 },
    },
  ],
  [
    'underline',
    toggleUnderline,
    {
      input: 'text',
      selection: { from: 0, to: 4 },
      text: '<u>text</u>',
      transformedSelection: { from: 3, to: 7 },
    },
  ],
  [
    'strike',
    toggleStrike,
    {
      input: 'text',
      selection: { from: 0, to: 4 },
      text: '~~text~~',
      transformedSelection: { from: 2, to: 6 },
    },
  ],
  [
    'bullet list',
    toggleUnorderedList,
    {
      input: 'alpha',
      selection: { from: 0, to: 5 },
      text: '- alpha',
      transformedSelection: { from: 2, to: 7 },
    },
  ],
  [
    'numbered list',
    toggleOrderedList,
    {
      input: 'alpha',
      selection: { from: 0, to: 5 },
      text: '1. alpha',
      transformedSelection: { from: 3, to: 8 },
    },
  ],
  [
    'task list',
    toggleTaskList,
    {
      input: 'alpha',
      selection: { from: 0, to: 5 },
      text: '- [ ] alpha',
      transformedSelection: { from: 6, to: 11 },
    },
  ],
  [
    'quote',
    toggleQuote,
    {
      input: 'alpha',
      selection: { from: 0, to: 5 },
      text: '> alpha',
      transformedSelection: { from: 2, to: 7 },
    },
  ],
  [
    'code block',
    insertCodeBlock,
    {
      input: 'code',
      selection: { from: 0, to: 4 },
      text: '```\ncode\n```',
      transformedSelection: { from: 4, to: 8 },
    },
  ],
  [
    'callout',
    insertCallout,
    {
      input: 'details',
      selection: { from: 0, to: 7 },
      text: '> [!note]\n> details',
      transformedSelection: { from: 12, to: 19 },
    },
  ],
  [
    'table',
    insertTable,
    {
      input: 'before\nafter',
      selection: { from: 7, to: 7 },
      text: 'before\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\nafter',
      transformedSelection: { from: 9, to: 17 },
    },
  ],
  [
    'indent',
    (input) => indentSelection(input, 4),
    {
      input: 'alpha',
      selection: { from: 0, to: 5 },
      text: '    alpha',
      transformedSelection: { from: 4, to: 9 },
    },
  ],
  [
    'outdent',
    (input) => outdentSelection(input, 4),
    {
      input: '    alpha',
      selection: { from: 4, to: 9 },
      text: 'alpha',
      transformedSelection: { from: 0, to: 5 },
    },
  ],
];

const keyCases: ReadonlyArray<readonly [string, ExpectedEdit]> = [
  [
    'Mod-b',
    {
      input: 'text',
      selection: { from: 0, to: 4 },
      text: '**text**',
      transformedSelection: { from: 2, to: 6 },
    },
  ],
  [
    'Mod-i',
    {
      input: 'text',
      selection: { from: 0, to: 4 },
      text: '*text*',
      transformedSelection: { from: 1, to: 5 },
    },
  ],
  [
    'Mod-u',
    {
      input: 'text',
      selection: { from: 0, to: 4 },
      text: '<u>text</u>',
      transformedSelection: { from: 3, to: 7 },
    },
  ],
  [
    'Mod-Shift-x',
    {
      input: 'text',
      selection: { from: 0, to: 4 },
      text: '~~text~~',
      transformedSelection: { from: 2, to: 6 },
    },
  ],
  [
    'Tab',
    {
      input: 'alpha',
      selection: { from: 0, to: 5 },
      text: '    alpha',
      transformedSelection: { from: 4, to: 9 },
    },
  ],
  [
    'Shift-Tab',
    {
      input: '    alpha',
      selection: { from: 4, to: 9 },
      text: 'alpha',
      transformedSelection: { from: 0, to: 5 },
    },
  ],
];

describe('TabEditorComponent', () => {
  beforeEach(() => {
    codeMirror.configs.length = 0;
    codeMirror.stateConfigs.length = 0;
    codeMirror.destroyed.length = 0;
    codeMirror.focused.length = 0;
  });

  it('constructs CodeMirror only when the component loads with explicit extensions', () => {
    const component = new TabEditorComponent({
      parent: createDiv(),
      value: '# Markdown',
      tabSize: 4,
      onChange: vi.fn(),
      onSave: vi.fn(),
    });

    expect(codeMirror.configs).toHaveLength(0);
    component.load();

    expect(codeMirror.configs).toHaveLength(1);
    expect(codeMirror.configs[0]?.parent).toBe(component.parent);
    expect(codeMirror.stateConfigs[0]?.doc).toBe('# Markdown');
    expect(taggedExtensions().map((extension) => extension.kind)).toStrictEqual([
      'history',
      'markdown',
      'syntax-highlighting',
      'line-wrapping',
      'update-listener',
      'keymap',
    ]);
    expect(
      taggedExtensions()
        .find((extension) => extension.kind === 'keymap')
        ?.bindings?.map((binding) => binding.key),
    ).toEqual(expect.arrayContaining(['Mod-s', 'Mod-b', 'Mod-i', 'ArrowLeft', 'Mod-z']));
  });

  it('reports document changes and saves the current immutable value from Mod-s', async () => {
    const onChange = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const component = new TabEditorComponent({
      parent: createDiv(),
      value: 'first',
      tabSize: 4,
      onChange,
      onSave,
    });
    component.load();

    const updateListener = taggedExtensions().find(
      (extension) => extension.kind === 'update-listener',
    )?.listener;
    updateListener?.({
      docChanged: true,
      state: { doc: { toString: () => 'second' } },
    } as ViewUpdate);

    const save = taggedExtensions()
      .find((extension) => extension.kind === 'keymap')
      ?.bindings?.find((binding) => binding.key === 'Mod-s');
    expect(save?.run?.(codeMirror.configs[0] as never)).toBe(true);
    await Promise.resolve();

    expect(onChange).toHaveBeenCalledWith('second');
    expect(onSave).toHaveBeenCalledWith('second');
    expect(component.getValue()).toBe('second');
  });

  it('ignores view updates that do not change the document', () => {
    const onChange = vi.fn();
    const component = new TabEditorComponent({
      parent: createDiv(),
      value: 'unchanged',
      tabSize: 4,
      onChange,
      onSave: vi.fn(),
    });
    component.load();

    const updateListener = taggedExtensions().find(
      (extension) => extension.kind === 'update-listener',
    )?.listener;
    updateListener?.({
      docChanged: false,
      state: { doc: { toString: () => 'wrong value' } },
    } as ViewUpdate);

    expect(onChange).not.toHaveBeenCalled();
    expect(component.getValue()).toBe('unchanged');
  });

  it('rejects a formatting transform before the editor view loads', () => {
    const component = new TabEditorComponent({
      parent: createDiv(),
      value: 'text',
      tabSize: 4,
      onChange: vi.fn(),
      onSave: vi.fn(),
    });

    expect(component.applyTransform(toggleBold)).toBe(false);
    expect(component.getValue()).toBe('text');
  });

  it.each(toolbarCases)(
    'applies the %s toolbar transform to the document and selection',
    (_name, transform, expected) => {
      const component = new TabEditorComponent({
        parent: createDiv(),
        value: expected.input,
        tabSize: 4,
        onChange: vi.fn(),
        onSave: vi.fn(),
      });
      component.load();
      setSelection(expected.selection);

      expect(component.applyTransform(transform)).toBe(true);
      expect(currentState().doc.toString()).toBe(expected.text);
      expect(currentState().selection.main).toStrictEqual(expected.transformedSelection);
    },
  );

  it.each(keyCases)('wires %s to the expected formatting edit', (key, expected) => {
    const component = new TabEditorComponent({
      parent: createDiv(),
      value: expected.input,
      tabSize: 4,
      onChange: vi.fn(),
      onSave: vi.fn(),
    });
    component.load();
    setSelection(expected.selection);

    expect(formattingBinding(key).run?.(codeMirror.configs[0] as never)).toBe(true);
    expect(currentState().doc.toString()).toBe(expected.text);
    expect(currentState().selection.main).toStrictEqual(expected.transformedSelection);
  });

  it('focuses the live view and destroys it exactly once when unloaded', () => {
    const component = new TabEditorComponent({
      parent: createDiv(),
      value: 'value',
      tabSize: 4,
      onChange: vi.fn(),
      onSave: vi.fn(),
    });
    component.load();

    component.focus();
    component.unload();
    component.unload();

    expect(codeMirror.focused).toHaveLength(1);
    expect(codeMirror.destroyed).toHaveLength(1);
    expect(component.getValue()).toBe('value');
  });
});
