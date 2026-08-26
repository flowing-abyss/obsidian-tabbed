import { Component, Notice, Platform } from 'obsidian';
import { formatError, logError } from '../diagnostics.js';
import type { TabsBlock } from '../render/tabs-block.js';
import type { TabbedSettings } from '../settings.js';
import type { LocatedTabsBlock, SourceLocator } from '../source/source-locator.js';
import { moveBetweenBlocks } from '../source/source-mutations.js';

interface DragSession {
  readonly sourceBlock: TabsBlock;
  readonly sourceIndex: number;
  readonly sourcePath: string;
}

interface Binding {
  readonly elements: HTMLElement[];
  readonly owners: Component[];
}

interface DragValidationFailure {
  readonly ok: false;
  readonly reason:
    | 'different-note-view'
    | 'invalid-source-index'
    | 'invalid-target-index'
    | 'missing-source'
    | 'stale-source';
}

interface DropContext {
  readonly ok: true;
  readonly session: DragSession;
  readonly sourceLocated: LocatedTabsBlock;
  readonly sourceLocator: SourceLocator;
  readonly targetLocated: LocatedTabsBlock;
  readonly targetLocator: SourceLocator;
}

type DropValidation = DragValidationFailure | DropContext;

function validationFailure(reason: DragValidationFailure['reason']): DragValidationFailure {
  return { ok: false, reason };
}

export class DragController extends Component {
  private readonly getSettings: () => TabbedSettings;
  private readonly bindings = new Map<TabsBlock, Binding>();
  private session: DragSession | null = null;

  constructor(getSettings: () => TabbedSettings) {
    super();
    this.getSettings = getSettings;
  }

  bind(block: TabsBlock): void {
    this.unbind(block);
    for (const element of block.tabElements) {
      element.removeAttribute('draggable');
    }
    if (Platform.isMobile || !this.getSettings().dragAndDrop || block.locator === null) {
      return;
    }

    const binding: Binding = { elements: [], owners: [] };
    this.bindings.set(block, binding);
    queueMicrotask(() => {
      if (this.bindings.get(block) !== binding) {
        return;
      }
      if (Platform.isMobile || !this.getSettings().dragAndDrop || block.locator === null) {
        this.unbind(block);
        return;
      }
      block.tabElements.forEach((element, index) => {
        const owner = this.addChild(new Component());
        binding.elements.push(element);
        binding.owners.push(owner);
        element.setAttribute('draggable', 'true');
        owner.register(() => {
          element.removeAttribute('draggable');
        });
        owner.registerDomEvent(element, 'dragstart', (event) => {
          event.stopPropagation();
          this.start(block, index, element, event);
        });
        owner.registerDomEvent(element, 'dragend', (event) => {
          event.stopPropagation();
          this.session = null;
        });
        owner.registerDomEvent(element, 'dragover', (event) => {
          event.stopPropagation();
          if (event.dataTransfer === null || !this.eligibleTarget(block, index, element)) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        });
        owner.registerDomEvent(element, 'drop', (event) => {
          this.drop(block, index, element, event);
        });
      });
    });
  }

  unbind(block: TabsBlock): void {
    const binding = this.bindings.get(block);
    this.bindings.delete(block);
    if (binding !== undefined) {
      for (const owner of binding.owners) {
        this.removeChild(owner);
      }
      for (const element of binding.elements) {
        element.removeAttribute('draggable');
      }
    }
    for (const element of block.tabElements) {
      element.removeAttribute('draggable');
    }
    if (this.session?.sourceBlock === block) {
      this.session = null;
    }
  }

  clear(): void {
    this.session = null;
    for (const block of [...this.bindings.keys()]) {
      this.unbind(block);
    }
  }

  override onunload(): void {
    this.clear();
  }

  private start(block: TabsBlock, index: number, element: HTMLElement, event: DragEvent): void {
    const locator = block.locator;
    if (
      locator === null ||
      event.dataTransfer === null ||
      block.tabElements[index] !== element ||
      block.document.tabs[index] === undefined
    ) {
      this.session = null;
      return;
    }
    event.dataTransfer.setData('text/plain', 'tabbed');
    event.dataTransfer.effectAllowed = 'move';
    this.session = { sourceBlock: block, sourceIndex: index, sourcePath: block.sourcePath };
  }

  private eligibleTarget(block: TabsBlock, index: number, element: HTMLElement): boolean {
    const session = this.session;
    if (session === null || session.sourcePath !== session.sourceBlock.sourcePath) {
      return false;
    }
    const sourceLocator = session.sourceBlock.locator;
    const targetLocator = block.locator;
    if (
      sourceLocator === null ||
      targetLocator === null ||
      session.sourcePath !== block.sourcePath ||
      sourceLocator.editor !== targetLocator.editor
    ) {
      return false;
    }
    return (
      session.sourceBlock.document.tabs[session.sourceIndex] !== undefined &&
      block.document.tabs[index] !== undefined &&
      block.tabElements[index] === element
    );
  }

  private validateLocators(block: TabsBlock, session: DragSession): DropValidation {
    const sourceLocator = session.sourceBlock.locator;
    const targetLocator = block.locator;
    if (sourceLocator === null || targetLocator === null) {
      return validationFailure('missing-source');
    }
    if (
      session.sourcePath !== session.sourceBlock.sourcePath ||
      session.sourcePath !== block.sourcePath ||
      sourceLocator.editor !== targetLocator.editor
    ) {
      return validationFailure('different-note-view');
    }
    const sourceLocated = sourceLocator.locate();
    const targetLocated = session.sourceBlock === block ? sourceLocated : targetLocator.locate();
    if (sourceLocated === null || targetLocated === null) {
      return validationFailure('stale-source');
    }
    return {
      ok: true,
      session,
      sourceLocated,
      sourceLocator,
      targetLocated,
      targetLocator,
    };
  }

  private validateDrop(
    block: TabsBlock,
    index: number,
    element: HTMLElement,
    session: DragSession,
  ): DropValidation {
    const context = this.validateLocators(block, session);
    if (!context.ok) {
      return context;
    }
    if (context.sourceLocated.block.document.tabs[session.sourceIndex] === undefined) {
      return validationFailure('invalid-source-index');
    }
    if (
      context.targetLocated.block.document.tabs[index] === undefined ||
      block.tabElements[index] !== element
    ) {
      return validationFailure('invalid-target-index');
    }
    return context;
  }

  private insertionSlot(
    context: DropContext,
    index: number,
    element: HTMLElement,
    event: DragEvent,
  ): number {
    const position = context.targetLocated.block.document.options.position;
    const rectangle = element.getBoundingClientRect();
    const before =
      position === 'left' || position === 'right'
        ? event.clientY < rectangle.top + rectangle.height / 2
        : event.clientX < rectangle.left + rectangle.width / 2;
    return before ? index : index + 1;
  }

  private destination(context: DropContext, block: TabsBlock, slot: number): number | null {
    if (context.session.sourceBlock !== block) {
      return slot;
    }
    const sourceIndex = context.session.sourceIndex;
    const shifted = slot - (sourceIndex < slot ? 1 : 0);
    const destination = Math.max(
      0,
      Math.min(shifted, context.sourceLocated.block.document.tabs.length - 1),
    );
    return destination === sourceIndex ? null : destination;
  }

  private reportTypedFailure(
    block: TabsBlock,
    index: number,
    session: DragSession,
    failure: object,
  ): void {
    new Notice('Could not move tab.');
    logError('Could not move tab', {
      action: 'move',
      sourcePath: session.sourcePath,
      sourceIndex: session.sourceIndex,
      targetPath: block.sourcePath,
      targetIndex: index,
      failure,
    });
  }

  private reportUnexpectedFailure(
    block: TabsBlock,
    index: number,
    session: DragSession,
    error: unknown,
  ): void {
    new Notice('Could not move tab.');
    logError('Could not move tab', {
      action: 'move',
      sourcePath: session.sourcePath,
      sourceIndex: session.sourceIndex,
      targetPath: block.sourcePath,
      targetIndex: index,
      error: formatError(error),
    });
  }

  private drop(block: TabsBlock, index: number, element: HTMLElement, event: DragEvent): void {
    const initialSession = this.session;
    try {
      event.stopPropagation();
      if (initialSession === null) {
        return;
      }
      event.preventDefault();
      const context = this.validateDrop(block, index, element, initialSession);
      if (!context.ok) {
        this.reportTypedFailure(block, index, initialSession, context);
        return;
      }
      const destination = this.destination(
        context,
        block,
        this.insertionSlot(context, index, element, event),
      );
      if (destination === null) {
        return;
      }
      const result = moveBetweenBlocks(
        context.sourceLocator,
        context.targetLocator,
        initialSession.sourceIndex,
        destination,
      );
      if (!result.ok) {
        this.reportTypedFailure(block, index, initialSession, result);
        return;
      }
      if (this.getSettings().showSuccessNotices) {
        new Notice('Moved tab.');
      }
    } catch (error) {
      if (initialSession !== null) {
        this.reportUnexpectedFailure(block, index, initialSession, error);
      }
    } finally {
      this.session = null;
    }
  }
}
