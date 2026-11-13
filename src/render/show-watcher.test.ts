import { describe, expect, it, vi } from 'vitest';
import { layoutShowWatcher } from './show-watcher.js';

class FakeResizeObserver {
  static readonly instances: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  fire(): void {
    this.callback([], this);
  }
}

function attached(): HTMLElement {
  const element = createDiv();
  document.body.append(element);
  return element;
}

function giveLayoutBox(element: HTMLElement): void {
  vi.spyOn(element, 'getClientRects').mockReturnValue({ length: 1 } as unknown as DOMRectList);
}

function latestObserver(): FakeResizeObserver {
  const observer = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1];
  if (observer === undefined) {
    throw new Error('Expected a resize observer');
  }
  return observer;
}

function inEditor(container: HTMLElement): HTMLElement {
  return container.createDiv({ cls: 'markdown-source-view' }).createDiv();
}

describe('layoutShowWatcher.shouldWait', () => {
  it('waits for an attached editor element without a layout box', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    expect(layoutShowWatcher.shouldWait(inEditor(attached()))).toBe(true);
  });

  it('leaves shown, detached and non-editor elements alone', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const shown = inEditor(attached());
    giveLayoutBox(shown);
    expect(layoutShowWatcher.shouldWait(shown)).toBe(false);
    expect(layoutShowWatcher.shouldWait(inEditor(createDiv()))).toBe(false);
    expect(layoutShowWatcher.shouldWait(attached())).toBe(false);
  });

  it('never waits where resize observation is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    expect(layoutShowWatcher.shouldWait(inEditor(attached()))).toBe(false);
  });
});

describe('layoutShowWatcher.whenShown', () => {
  it('calls back once, after the element gets a layout box', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const element = attached();
    const callback = vi.fn();
    layoutShowWatcher.whenShown(element, callback);
    const observer = latestObserver();
    expect(observer.observed).toStrictEqual([element]);

    observer.fire();
    expect(callback).not.toHaveBeenCalled();

    giveLayoutBox(element);
    observer.fire();
    observer.fire();
    expect(callback).toHaveBeenCalledOnce();
    expect(observer.disconnected).toBe(true);
  });

  it('stops observing when cancelled', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const element = attached();
    const callback = vi.fn();
    const cancel = layoutShowWatcher.whenShown(element, callback);
    const observer = latestObserver();

    cancel();
    giveLayoutBox(element);
    observer.fire();

    expect(observer.disconnected).toBe(true);
    expect(callback).not.toHaveBeenCalled();
  });

  it('calls back at once where resize observation is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const callback = vi.fn();
    const cancel = layoutShowWatcher.whenShown(attached(), callback);

    cancel();
    expect(callback).toHaveBeenCalledOnce();
  });
});
