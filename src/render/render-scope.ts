import { Component } from 'obsidian';
import { formatError, logError } from '../diagnostics.js';

function reportCleanupError(error: unknown): void {
  logError('Could not clean up rendered Markdown', { cause: formatError(error) });
}

function cleanup(callback: () => unknown): void {
  try {
    Promise.resolve(callback()).catch(reportCleanupError);
  } catch (error) {
    reportCleanupError(error);
  }
}

// Obsidian aborts its sibling cleanup loop when a child or callback throws.
// These adapters keep each owned operation inside an independent boundary.
class OwnedRenderChild extends Component {
  constructor(
    private readonly child: Component,
    private readonly release: () => void,
  ) {
    super();
  }

  override onload(): void {
    cleanup(() => {
      this.child.load();
    });
  }

  override onunload(): void {
    this.release();
    cleanup(() => {
      this.child.unload();
    });
  }
}

export class RenderScope extends Component {
  private closed = false;
  private readonly ownedChildren = new Map<Component, OwnedRenderChild>();

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    cleanup(() => {
      super.load();
    });
    cleanup(() => {
      super.unload();
    });
  }

  override load(): void {
    if (!this.closed) {
      super.load();
    }
  }

  override unload(): void {
    this.close();
  }

  override addChild<T extends Component>(component: T): T {
    if (this.ownedChildren.has(component)) return component;
    const owned = new OwnedRenderChild(component, () => {
      this.ownedChildren.delete(component);
    });
    if (this.closed) {
      owned.load();
      owned.unload();
    } else {
      this.ownedChildren.set(component, owned);
      super.addChild(owned);
    }
    return component;
  }

  override removeChild<T extends Component>(component: T): T {
    const owned = this.ownedChildren.get(component);
    if (owned === undefined) return component;
    this.ownedChildren.delete(component);
    super.removeChild(owned);
    return component;
  }

  override register(callback: () => unknown): void {
    if (!this.closed) {
      super.register(() => {
        cleanup(callback);
      });
      return;
    }
    cleanup(callback);
  }
}
