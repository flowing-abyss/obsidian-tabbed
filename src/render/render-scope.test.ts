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

class ThrowingUnloadChild extends CleanupChild {
  override onunload(): void {
    super.onunload();
    throw new Error('child unload failed');
  }
}

describe('RenderScope', () => {
  it('owns rejected cleanup promises while synchronous sibling cleanup still completes', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scope = new RenderScope();
    scope.load();
    const sibling = vi.fn();
    scope.register(sibling);
    scope.register(async () => {
      throw new Error('async cleanup failed');
    });

    scope.close();
    expect(sibling).toHaveBeenCalledOnce();
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
    expect(log).toHaveBeenCalledExactlyOnceWith('[tabbed] Could not clean up rendered Markdown', {
      cause: 'async cleanup failed',
    });
  });

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
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scope = new RenderScope();
    const child = scope.addChild(new ThrowingChild());

    expect(() => {
      scope.close();
    }).not.toThrow();
    expect(child.loads).toBe(1);
    expect(child.unloads).toBe(1);
    expect(log).toHaveBeenCalledExactlyOnceWith('[tabbed] Could not clean up rendered Markdown', {
      cause: 'child load failed',
    });
  });

  it('unloads a late child whose load throws', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scope = new RenderScope();
    const child = new ThrowingChild();
    scope.close();

    expect(() => {
      scope.addChild(child);
    }).not.toThrow();
    expect(child.loads).toBe(1);
    expect(child.unloads).toBe(1);
    expect(log).toHaveBeenCalledExactlyOnceWith('[tabbed] Could not clean up rendered Markdown', {
      cause: 'child load failed',
    });
  });

  it.each([true, false])(
    'disposes every callback in LIFO order despite a throw, loaded=%s',
    (loaded) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const scope = new RenderScope();
      if (loaded) scope.load();
      const active = new Set([1, 2, 3]);
      const order: number[] = [];
      for (const id of active) {
        scope.register(() => {
          active.delete(id);
          order.push(id);
          if (id === 2) throw new Error('callback failed');
        });
      }

      expect(() => {
        scope.close();
      }).not.toThrow();
      scope.close();
      scope.unload();
      expect(active.size).toBe(0);
      expect(order).toEqual([3, 2, 1]);
      expect(log).toHaveBeenCalledExactlyOnceWith('[tabbed] Could not clean up rendered Markdown', {
        cause: 'callback failed',
      });
    },
  );

  it('isolates a throwing child from sibling children and scope callbacks', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scope = new RenderScope();
    scope.load();
    const first = scope.addChild(new CleanupChild());
    const throwing = scope.addChild(new ThrowingUnloadChild());
    const last = scope.addChild(new CleanupChild());
    const callback = vi.fn();
    scope.register(callback);

    expect(() => {
      scope.close();
    }).not.toThrow();
    scope.close();
    expect([first.unloads, throwing.unloads, last.unloads]).toEqual([1, 1, 1]);
    expect(callback).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledExactlyOnceWith('[tabbed] Could not clean up rendered Markdown', {
      cause: 'child unload failed',
    });
  });

  it('preserves child removal, re-addition, and child-before-callback LIFO order', () => {
    const scope = new RenderScope();
    scope.load();
    const child = new CleanupChild();
    expect(scope.addChild(child)).toBe(child);
    expect(scope.addChild(child)).toBe(child);
    expect(scope.removeChild(child)).toBe(child);
    expect(scope.removeChild(child)).toBe(child);
    expect(child.unloads).toBe(1);
    expect(scope.addChild(child)).toBe(child);
    const order: string[] = [];
    const first = new Component();
    first.register(() => {
      order.push('first child');
    });
    const second = new Component();
    second.register(() => {
      order.push('second child');
    });
    scope.addChild(first);
    scope.addChild(second);
    scope.register(() => {
      order.push('first callback');
    });
    scope.register(() => {
      order.push('second callback');
    });

    scope.close();
    expect(child.loads).toBe(2);
    expect(child.unloads).toBe(2);
    expect(order).toEqual(['second child', 'first child', 'second callback', 'first callback']);
  });

  it('contains late callback and child failures while still accepting later cleanup', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scope = new RenderScope();
    scope.close();
    expect(() => {
      scope.register(() => {
        throw new Error('late callback failed');
      });
    }).not.toThrow();
    const child = new ThrowingUnloadChild();
    expect(() => {
      scope.addChild(child);
    }).not.toThrow();
    const cleanup = vi.fn();
    scope.register(cleanup);
    expect(child.loads).toBe(1);
    expect(child.unloads).toBe(1);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(log.mock.calls).toEqual([
      ['[tabbed] Could not clean up rendered Markdown', { cause: 'late callback failed' }],
      ['[tabbed] Could not clean up rendered Markdown', { cause: 'child unload failed' }],
    ]);
  });
});
