import { Component } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { RenderScope } from './render-scope.js';

class CleanupChild extends Component {
  loads = 0;
  unloads = 0;

  override onload(): void {
    this.loads += 1;
  }

  override onunload(): void {
    this.unloads += 1;
  }
}

class ThrowingChild extends CleanupChild {
  override onload(): void {
    super.onload();
    throw new Error('child load failed');
  }
}

describe('RenderScope', () => {
  it('cleans up current and late registrations and ownership', () => {
    const scope = new RenderScope();
    scope.load();
    const currentCleanup = vi.fn();
    scope.register(currentCleanup);
    scope.close();
    expect(currentCleanup).toHaveBeenCalledOnce();

    const lateCleanup = vi.fn();
    scope.register(lateCleanup);
    expect(lateCleanup).toHaveBeenCalledOnce();

    const lateChild = new CleanupChild();
    scope.addChild(lateChild);
    expect(lateChild.loads).toBe(1);
    expect(lateChild.unloads).toBe(1);
  });

  it('loads and unloads existing ownership when closed before its first load', () => {
    const scope = new RenderScope();
    const cleanup = vi.fn();
    const child = scope.addChild(new CleanupChild());
    scope.register(cleanup);

    scope.close();

    expect(scope.isClosed).toBe(true);
    expect(child.loads).toBe(1);
    expect(child.unloads).toBe(1);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('does not reload after closing', () => {
    const scope = new RenderScope();
    const child = scope.addChild(new CleanupChild());
    scope.close();

    scope.load();

    expect(child.loads).toBe(1);
    expect(child.unloads).toBe(1);
  });

  it('makes repeated close and unload calls idempotent', () => {
    const scope = new RenderScope();
    const cleanup = vi.fn();
    const child = scope.addChild(new CleanupChild());
    scope.register(cleanup);

    scope.close();
    scope.close();
    scope.unload();

    expect(child.loads).toBe(1);
    expect(child.unloads).toBe(1);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('unloads a pre-owned child whose load throws during close-before-load', () => {
    const scope = new RenderScope();
    const child = scope.addChild(new ThrowingChild());

    expect(() => {
      scope.close();
    }).toThrow('child load failed');
    expect(child.loads).toBe(1);
    expect(child.unloads).toBe(1);
  });

  it('unloads a late child whose load throws', () => {
    const scope = new RenderScope();
    const child = new ThrowingChild();
    scope.close();

    expect(() => {
      scope.addChild(child);
    }).toThrow('child load failed');
    expect(child.loads).toBe(1);
    expect(child.unloads).toBe(1);
  });
});
