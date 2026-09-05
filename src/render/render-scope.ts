import { Component } from 'obsidian';

export class RenderScope extends Component {
  private closed = false;

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      super.load();
    } finally {
      super.unload();
    }
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
    if (!this.closed) {
      return super.addChild(component);
    }
    try {
      component.load();
    } finally {
      component.unload();
    }
    return component;
  }

  override register(callback: () => unknown): void {
    if (!this.closed) {
      super.register(callback);
      return;
    }
    callback();
  }
}
