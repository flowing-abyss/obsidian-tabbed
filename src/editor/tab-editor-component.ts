import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, keymap, type Command, type KeyBinding } from '@codemirror/view';
import { Component } from 'obsidian';
import {
  indentSelection,
  outdentSelection,
  toggleBold,
  toggleItalic,
  toggleStrike,
  toggleUnderline,
  type TextTransformInput,
  type TextTransformResult,
} from './text-transforms.js';

export interface TabEditorComponentOptions {
  readonly parent: HTMLElement;
  readonly value: string;
  readonly tabSize: number;
  readonly onChange: (value: string) => void;
  readonly onSave: (value: string) => void;
}

export type TextTransform = (input: TextTransformInput) => TextTransformResult;

export class TabEditorComponent extends Component {
  readonly parent: HTMLElement;

  private currentValue: string;
  private readonly onChange: (value: string) => void;
  private readonly onSave: (value: string) => void;
  private readonly tabSize: number;
  private view: EditorView | null = null;

  constructor(options: TabEditorComponentOptions) {
    super();
    this.parent = options.parent;
    this.currentValue = options.value;
    this.tabSize = options.tabSize;
    this.onChange = options.onChange;
    this.onSave = options.onSave;
  }

  override onload(): void {
    const state = EditorState.create({
      doc: this.currentValue,
      extensions: [
        history(),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) {
            return;
          }
          this.currentValue = update.state.doc.toString();
          this.onChange(this.currentValue);
        }),
        keymap.of(this.keyBindings()),
      ],
    });
    this.view = new EditorView({ state, parent: this.parent });
  }

  override onunload(): void {
    this.view?.destroy();
    this.view = null;
  }

  getValue(): string {
    return this.currentValue;
  }

  focus(): void {
    this.view?.focus();
  }

  applyTransform(transform: TextTransform): boolean {
    const view = this.view;
    if (view === null) {
      return false;
    }
    const { from, to } = view.state.selection.main;
    const result = transform({ text: view.state.doc.toString(), selection: { from, to } });
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: result.text },
      selection: EditorSelection.range(result.selection.from, result.selection.to),
    });
    return true;
  }

  private keyBindings(): readonly KeyBinding[] {
    const transform =
      (operation: TextTransform): Command =>
      () =>
        this.applyTransform(operation);
    return [
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          this.onSave(this.currentValue);
          return true;
        },
      },
      { key: 'Mod-b', preventDefault: true, run: transform(toggleBold) },
      { key: 'Mod-i', preventDefault: true, run: transform(toggleItalic) },
      { key: 'Mod-u', preventDefault: true, run: transform(toggleUnderline) },
      { key: 'Mod-Shift-x', preventDefault: true, run: transform(toggleStrike) },
      {
        key: 'Tab',
        preventDefault: true,
        run: transform((input) => indentSelection(input, this.tabSize)),
      },
      {
        key: 'Shift-Tab',
        preventDefault: true,
        run: transform((input) => outdentSelection(input, this.tabSize)),
      },
      ...defaultKeymap,
      ...historyKeymap,
    ];
  }
}
