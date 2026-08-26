import type { EditorStateConfig } from '@codemirror/state';
import type { EditorViewConfig, KeyBinding, ViewUpdate } from '@codemirror/view';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const codeMirror = vi.hoisted(() => {
  const configs: EditorViewConfig[] = [];
  const stateConfigs: EditorStateConfig[] = [];
  const destroyed: object[] = [];
  const focused: object[] = [];

  class FakeEditorView {
    static readonly updateListener = {
      of: (listener: (update: ViewUpdate) => void) => ({ kind: 'update-listener', listener }),
    };

    state: { doc: { toString: () => string }; selection: { main: { from: number; to: number } } };

    constructor(config: EditorViewConfig) {
      configs.push(config);
      this.state = config.state as FakeEditorView['state'];
    }

    destroy(): void {
      destroyed.push(this);
    }

    focus(): void {
      focused.push(this);
    }

    dispatch(): void {}
  }

  return { configs, destroyed, focused, stateConfigs, FakeEditorView };
});

vi.mock('@codemirror/state', () => ({
  EditorState: {
    create: vi.fn((config: EditorStateConfig) => {
      codeMirror.stateConfigs.push(config);
      return {
        doc: { toString: () => String(config.doc ?? '') },
        selection: { main: { from: 0, to: 0 } },
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

interface TaggedExtension {
  readonly kind: string;
  readonly bindings?: readonly KeyBinding[];
  readonly listener?: (update: ViewUpdate) => void;
}

function taggedExtensions(): readonly TaggedExtension[] {
  return codeMirror.stateConfigs[0]?.extensions as unknown as readonly TaggedExtension[];
}

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
