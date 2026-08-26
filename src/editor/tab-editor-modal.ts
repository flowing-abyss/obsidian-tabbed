import { Component, Modal, Notice, type App } from 'obsidian';
import { formatError, logError } from '../diagnostics.js';
import type { TabbedSettings } from '../settings.js';
import type { SourceLocator } from '../source/source-locator.js';
import { replaceLocatedBlock } from '../source/source-mutations.js';
import { replaceTab } from '../tabs/tab-operations.js';
import { TabEditorComponent, type TextTransform } from './tab-editor-component.js';
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
} from './text-transforms.js';

export interface TabEditorRequest {
  readonly locator: SourceLocator;
  readonly index: number;
  readonly title: string;
  readonly content: string;
  readonly sourcePath: string;
}

type SaveBoundary = 'autosave' | 'manual' | 'close';

interface SaveSnapshot {
  readonly session: number;
  readonly revision: number;
  readonly title: string;
  readonly content: string;
}

interface PendingSave {
  noticeOnFailure: boolean;
  promise: Promise<boolean>;
}

interface ToolbarAction {
  readonly label: string;
  readonly transform: TextTransform;
}

const SAVE_FAILURE = 'Could not save tab changes.';

export class TabEditorModal extends Modal {
  private readonly getSettings: () => TabbedSettings;
  private request: TabEditorRequest | null = null;
  private owner: Component | null = null;
  private editor: TabEditorComponent | null = null;
  private titleInput: HTMLInputElement | null = null;
  private debounceId: number | null = null;
  private current: SaveSnapshot = { session: 0, revision: 0, title: '', content: '' };
  private session = 0;
  private nextRevision = 0;
  private savedRevision = 0;
  private failedKey: string | null = null;
  private generation = 0;
  private disposed = false;
  private tail: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, PendingSave>();

  constructor(app: App, getSettings: () => TabbedSettings) {
    super(app);
    this.getSettings = getSettings;
  }

  openFor(request: TabEditorRequest): void {
    this.request = request;
    this.disposed = false;
    this.session += 1;
    this.nextRevision = 0;
    this.savedRevision = 0;
    this.failedKey = null;
    this.current = {
      session: this.session,
      revision: 0,
      title: request.title,
      content: request.content,
    };
    this.open();
  }

  override onOpen(): void {
    const request = this.request;
    if (request === null || this.disposed) {
      return;
    }
    this.modalEl.addClass('tabbed-editor-modal');
    this.contentEl.addClass('tabbed-editor-modal__content');
    this.contentEl.replaceChildren();
    this.setTitle('Edit tab');

    const owner = new Component();
    owner.load();
    this.owner = owner;

    const titleInput = this.contentEl.createEl('input', { cls: 'tabbed-editor-modal__title' });
    titleInput.type = 'text';
    titleInput.value = this.current.title;
    titleInput.setAttribute('aria-label', 'Tab title');
    this.titleInput = titleInput;
    owner.registerDomEvent(titleInput, 'input', () => {
      this.changeCurrent(titleInput.value, this.current.content);
    });

    const settings = this.getSettings();
    if (settings.showEditorToolbar) {
      this.addToolbar(owner, settings);
    }
    const editorParent = this.contentEl.createDiv();

    this.editor = owner.addChild(
      new TabEditorComponent({
        parent: editorParent,
        value: this.current.content,
        tabSize: settings.tabSize,
        onChange: (content) => {
          this.changeCurrent(this.titleInput?.value ?? this.current.title, content);
        },
        onSave: (content) => {
          this.observeSave(this.save(content));
        },
      }),
    );
    this.editor.focus();
  }

  override onClose(): void {
    this.modalEl.removeClass('tabbed-editor-modal');
    this.contentEl.removeClass('tabbed-editor-modal__content');
    if (!this.disposed) {
      const snapshot = this.capture(this.editor?.getValue() ?? this.current.content);
      this.clearDebounce();
      if (
        snapshot.revision > this.savedRevision ||
        this.failedKey === this.saveKey(snapshot) ||
        this.pending.has(this.saveKey(snapshot))
      ) {
        this.observeSave(this.enqueue(snapshot, 'close'));
      }
    }
    this.teardownEditor();
  }

  async save(content = this.editor?.getValue() ?? this.current.content): Promise<boolean> {
    this.clearDebounce();
    return this.enqueue(this.capture(content), 'manual');
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.generation += 1;
    this.clearDebounce();
    this.teardownEditor();
    this.modalEl.removeClass('tabbed-editor-modal');
    this.contentEl.removeClass('tabbed-editor-modal__content');
    this.close();
  }

  private changeCurrent(title: string, content: string): void {
    if (title === this.current.title && content === this.current.content) {
      return;
    }
    this.nextRevision += 1;
    this.current = { session: this.session, revision: this.nextRevision, title, content };
    this.restartDebounce();
  }

  private capture(content: string): SaveSnapshot {
    this.changeCurrent(this.titleInput?.value ?? this.current.title, content);
    return this.current;
  }

  private restartDebounce(): void {
    this.clearDebounce();
    if (this.disposed) {
      return;
    }
    const snapshot = this.current;
    this.debounceId = window.setTimeout(() => {
      this.debounceId = null;
      this.observeSave(this.enqueue(snapshot, 'autosave'));
    }, this.getSettings().autoSaveDelayMs);
  }

  private clearDebounce(): void {
    if (this.debounceId === null) {
      return;
    }
    window.clearTimeout(this.debounceId);
    this.debounceId = null;
  }

  private enqueue(snapshot: SaveSnapshot, boundary: SaveBoundary): Promise<boolean> {
    const request = this.request;
    if (this.disposed || request === null) {
      return Promise.resolve(false);
    }
    const key = this.saveKey(snapshot);
    const existing = this.pending.get(key);
    if (existing !== undefined) {
      existing.noticeOnFailure ||= boundary !== 'autosave';
      return existing.promise;
    }
    if (snapshot.revision === this.savedRevision && this.failedKey !== key) {
      return Promise.resolve(true);
    }

    const generation = this.generation;
    const pending: PendingSave = {
      noticeOnFailure: boundary !== 'autosave',
      promise: Promise.resolve(false),
    };
    pending.promise = this.tail.then(() =>
      this.performSave(request, snapshot, generation, pending),
    );
    this.pending.set(key, pending);
    const cleanup = (): void => {
      if (this.pending.get(key) === pending) {
        this.pending.delete(key);
      }
    };
    this.tail = pending.promise.then(cleanup, cleanup);
    return pending.promise;
  }

  private async performSave(
    request: TabEditorRequest,
    snapshot: SaveSnapshot,
    generation: number,
    pending: PendingSave,
  ): Promise<boolean> {
    if (this.disposed || generation !== this.generation) {
      return false;
    }
    try {
      const result = replaceLocatedBlock(request.locator, (document) =>
        replaceTab(document, request.index, {
          title: snapshot.title,
          content: snapshot.content,
        }),
      );
      if (!result.ok) {
        this.reportFailure(request, snapshot, result, pending.noticeOnFailure);
        return false;
      }
      if (snapshot.session === this.session) {
        this.savedRevision = Math.max(this.savedRevision, snapshot.revision);
      }
      if (this.failedKey === this.saveKey(snapshot)) {
        this.failedKey = null;
      }
      return true;
    } catch (error) {
      this.reportFailure(request, snapshot, error, pending.noticeOnFailure);
      return false;
    }
  }

  private reportFailure(
    request: TabEditorRequest,
    snapshot: SaveSnapshot,
    failure: unknown,
    showNotice: boolean,
  ): void {
    if (snapshot.session === this.session) {
      this.failedKey = this.saveKey(snapshot);
    }
    if (showNotice) {
      new Notice(SAVE_FAILURE);
    }
    const detail = failure instanceof Error ? { error: formatError(failure) } : { failure };
    logError(SAVE_FAILURE.slice(0, -1), {
      sourcePath: request.sourcePath,
      index: request.index,
      revision: snapshot.revision,
      ...detail,
    });
  }

  private addToolbar(owner: Component, settings: TabbedSettings): void {
    const toolbar = this.contentEl.createDiv({ cls: 'tabbed-editor-modal__toolbar' });
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Tab editor formatting');
    const actions: readonly ToolbarAction[] = [
      { label: 'Bold', transform: toggleBold },
      { label: 'Italic', transform: toggleItalic },
      { label: 'Underline', transform: toggleUnderline },
      { label: 'Strike', transform: toggleStrike },
      { label: 'Bullet list', transform: toggleUnorderedList },
      { label: 'Numbered list', transform: toggleOrderedList },
      { label: 'Task list', transform: toggleTaskList },
      { label: 'Quote', transform: toggleQuote },
      { label: 'Code block', transform: insertCodeBlock },
      { label: 'Callout', transform: insertCallout },
      { label: 'Table', transform: insertTable },
      {
        label: 'Indent',
        transform: (input) => indentSelection(input, settings.tabSize),
      },
      {
        label: 'Outdent',
        transform: (input) => outdentSelection(input, settings.tabSize),
      },
    ];
    for (const action of actions) {
      const button = toolbar.createEl('button');
      button.type = 'button';
      button.textContent = action.label;
      owner.registerDomEvent(button, 'click', () => {
        this.editor?.applyTransform(action.transform);
      });
    }
  }

  private observeSave(promise: Promise<boolean>): void {
    promise.catch((error: unknown) => {
      logError('Unexpected tab editor save queue failure', { error: formatError(error) });
    });
  }

  private saveKey(snapshot: SaveSnapshot): string {
    return `${snapshot.session}:${snapshot.revision}`;
  }

  private teardownEditor(): void {
    this.owner?.unload();
    this.owner = null;
    this.editor = null;
    this.titleInput = null;
  }
}
