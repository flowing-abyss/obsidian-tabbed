import {
  Component,
  type MarkdownPostProcessorContext,
  type MarkdownSectionInformation,
  type App as ObsidianApp,
} from 'obsidian';
import { App, MarkdownView } from 'obsidian-test-mocks/obsidian';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type TabbedSettings } from '../settings.js';
import { SelectionMemory } from '../tabs/selection-memory.js';
import type { ParsedTabsDocument } from '../tabs/tab-model.js';
import { parseTabsSource } from '../tabs/tab-parser.js';
import { ColumnsBlock } from './columns-block.js';
import type { RenderMarkdown } from './markdown-renderer.js';
import { TabsBlock, type TabsBlockHost } from './tabs-block.js';

const twoTabs = ['tab: First', 'first body', 'tab: Second', 'second body'].join('\n');
const threeTabs = [
  'tab: First',
  'first body',
  'tab: Second',
  'second body',
  'tab: Third',
  'third body',
].join('\n');

it('keeps nested columns and sibling resources live until block unload', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const cleanups: Array<ReturnType<typeof vi.fn>> = [];
  let nestedRoot!: HTMLElement;
  const nestedRenderer: RenderMarkdown = async (...[, markdown, target, , scope]) => {
    target.setText(markdown);
    const cleanup = vi.fn();
    cleanups.push(cleanup);
    scope.register(cleanup);
    if (markdown === 'bad')
      scope.register(() => {
        throw new Error('nested cleanup failed');
      });
  };
  const outerCleanup = vi.fn();
  const renderer: RenderMarkdown = async (...[app, markdown, target, path, scope]) => {
    if (markdown.trim() === 'first body') {
      scope.register(outerCleanup);
      const nested = scope.addChild(
        new ColumnsBlock(app, target, 'column:\ngood\ncolumn:\nbad', context(path), nestedRenderer),
      );
      nestedRoot = nested.containerEl;
    }
  };
  const { block, container } = createBlock(renderer);
  await Promise.resolve();
  expect(cleanups).toHaveLength(2);

  await expect(block.activate(1)).resolves.toBeUndefined();
  for (const cleanup of cleanups) expect(cleanup).not.toHaveBeenCalled();
  expect(outerCleanup).not.toHaveBeenCalled();
  expect(nestedRoot.querySelector('.tabbed-columns')).not.toBeNull();
  expect(container.querySelector('.tabbed-columns')).not.toBeNull();

  block.unload();
  expect(log).toHaveBeenCalledExactlyOnceWith('[tabbed] Could not clean up rendered Markdown', {
    cause: 'nested cleanup failed',
  });
  for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledOnce();
  expect(outerCleanup).toHaveBeenCalledOnce();
});

function context(sourcePath = 'Note.md'): MarkdownPostProcessorContext {
  return {
    sourcePath,
    docId: 'doc',
    frontmatter: null,
    addChild: vi.fn(),
    getSectionInfo: vi.fn(() => null),
  };
}

function host() {
  return {
    register: vi.fn<TabsBlockHost['register']>(),
    unregister: vi.fn<TabsBlockHost['unregister']>(),
    addTab: vi.fn<TabsBlockHost['addTab']>(),
    editTab: vi.fn<TabsBlockHost['editTab']>(),
    openTabMenu: vi.fn<TabsBlockHost['openTabMenu']>(),
  } satisfies TabsBlockHost;
}

function createBlock(
  renderer: RenderMarkdown,
  source = twoTabs,
  options: {
    app?: ObsidianApp;
    container?: HTMLElement;
    context?: MarkdownPostProcessorContext;
    memory?: SelectionMemory;
    settings?: TabbedSettings;
    parser?: (source: string, settings: TabbedSettings) => ParsedTabsDocument;
    load?: boolean;
  } = {},
): {
  block: TabsBlock;
  container: HTMLElement;
  app: ObsidianApp;
  blockHost: ReturnType<typeof host>;
} {
  const app = options.app ?? App.createConfigured__().asOriginalType__();
  const container = options.container ?? createDiv();
  if (!container.isConnected) {
    document.body.append(container);
  }
  const blockHost = host();
  const block = new TabsBlock(
    app,
    container,
    source,
    options.context ?? context(),
    options.settings ?? DEFAULT_SETTINGS,
    options.memory ?? new SelectionMemory(256),
    blockHost,
    renderer,
    options.parser,
  );
  if (options.load !== false) {
    block.load();
  }
  return { block, container, app, blockHost };
}

function sectionContext(
  info: MarkdownSectionInformation,
  sourcePath = 'Note.md',
): MarkdownPostProcessorContext {
  return {
    ...context(sourcePath),
    getSectionInfo: vi.fn(() => info),
  };
}

async function sourceBlock(
  renderer: RenderMarkdown,
  options: {
    source?: string;
    settings?: TabbedSettings;
    mode?: 'source' | 'preview';
    parser?: (source: string, settings: TabbedSettings) => ParsedTabsDocument;
    load?: boolean;
  } = {},
): Promise<{
  block: TabsBlock;
  container: HTMLElement;
  blockHost: ReturnType<typeof host>;
  wrapper: HTMLElement;
  setMode: (mode: 'source' | 'preview') => void;
}> {
  const source = options.source ?? twoTabs;
  const settings = options.settings ?? DEFAULT_SETTINGS;
  const mockApp = App.createConfigured__();
  const leaf = mockApp.workspace.getLeaf(true);
  await leaf.setViewState({ type: 'markdown' });
  const view = MarkdownView.create2__(leaf);
  await leaf.open(view.asOriginalType7__());
  const getMode = vi.spyOn(view, 'getMode').mockReturnValue(options.mode ?? 'source');
  const fullSource = ['```tabs', source, '```'].join('\n');
  view.setViewData(fullSource, false);
  document.body.append(view.containerEl);
  const wrapper = view.containerEl.createDiv({ cls: 'block-language-tabs' });
  const container = wrapper.createDiv();
  const result = createBlock(renderer, source, {
    app: mockApp.asOriginalType__(),
    container,
    context: sectionContext({
      text: fullSource,
      lineStart: 0,
      lineEnd: fullSource.split('\n').length - 1,
    }),
    settings,
    ...(options.parser === undefined ? {} : { parser: options.parser }),
    load: options.load ?? true,
  });
  return {
    ...result,
    wrapper,
    setMode: (mode) => {
      getMode.mockReturnValue(mode);
    },
  };
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

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

function registrationTarget(
  element: EventTarget,
  list: HTMLElement,
  root: HTMLElement,
): 'list' | 'root' | 'other' {
  if (element === list) {
    return 'list';
  }
  if (element === root) {
    return 'root';
  }
  return 'other';
}

describe('TabsBlock initial rendering', () => {
  it('recovers from an initial parser exception with one literal-content tab and diagnostic', async () => {
    const source = 'tab: Broken\r\nliteral body';
    const parser = vi.fn(() => {
      throw new Error('initial parser fault');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const renderedBodies: string[] = [];
    const renderer = vi.fn<RenderMarkdown>(async (_app, markdown, element) => {
      if (element.matches('.tabbed__panel')) {
        renderedBodies.push(markdown);
      }
    });
    const { block, container } = createBlock(renderer, source, {
      context: sectionContext({ text: source, lineStart: 4, lineEnd: 5 }, 'Broken.md'),
      parser,
    });
    await settle();

    expect(parser).toHaveBeenCalledTimes(1);
    expect(block.document.tabs).toHaveLength(1);
    expect(block.document.tabs[0]).toMatchObject({
      kind: 'virtual',
      title: DEFAULT_SETTINGS.defaultTitle,
      content: source,
    });
    expect(block.tabElements).toHaveLength(1);
    expect(renderedBodies).toStrictEqual([source]);
    expect(container.querySelector('[role="status"], [role="alert"], .tabbed__error')).toBeNull();
    expect(log).toHaveBeenCalledExactlyOnceWith('[tabbed] Could not parse tabs block', {
      path: 'Broken.md',
      section: { lineStart: 4, lineEnd: 5 },
      cause: 'initial parser fault',
    });
    block.unload();
  });

  it('eagerly renders title Markdown under distinct children and only the first body', () => {
    const calls: Array<{
      markdown: string;
      element: HTMLElement;
      component: Component;
    }> = [];
    const renderer = vi.fn<RenderMarkdown>(
      async (...[_app, markdown, element, _path, component]) => {
        calls.push({ markdown, element, component });
        element.textContent = markdown;
      },
    );

    const { block, container, app } = createBlock(renderer);
    const titleCalls = calls.filter(({ element }) => element.matches('.tabbed__title'));
    const bodyCalls = calls.filter(({ element }) => element.matches('.tabbed__panel'));

    expect(titleCalls.map(({ markdown }) => markdown)).toStrictEqual(['First', 'Second']);
    expect(new Set(titleCalls.map(({ component }) => component)).size).toBe(2);
    expect(bodyCalls).toHaveLength(1);
    expect(titleCalls.map(({ component }) => component)).not.toContain(bodyCalls[0]?.component);
    expect(bodyCalls[0]).toMatchObject({ markdown: 'first body\n' });
    expect(renderer).toHaveBeenCalledWith(
      app,
      'first body\n',
      expect.any(HTMLElement),
      'Note.md',
      bodyCalls[0]?.component,
    );
    expect(calls.some(({ markdown }) => markdown === 'second body')).toBe(false);
    expect(container.querySelectorAll(':scope > .tabbed')).toHaveLength(1);
    expect(container.querySelectorAll('.tabbed__panel')).toHaveLength(1);
    const root = required(
      container.querySelector<HTMLElement>(':scope > .tabbed'),
      'Expected root',
    );
    const panels = required(
      root.querySelector<HTMLElement>(':scope > .tabbed__panels'),
      'Expected panel container',
    );
    const panel = required(
      panels.querySelector<HTMLElement>(':scope > .tabbed__panel'),
      'Expected active panel',
    );

    expect(Array.from(root.children).map((child) => child.className)).toStrictEqual([
      'tabbed__list',
      'tabbed__panels',
    ]);
    expect(panel.classList.contains('is-active')).toBe(true);
    expect(panel.inert).toBe(false);
    expect(panel.hasAttribute('aria-hidden')).toBe(false);

    block.unload();
  });

  it('unloads every title-owned component with the block', () => {
    const titleChildren: Component[] = [];
    const renderer = vi.fn<RenderMarkdown>(
      async (...[_app, _markdown, element, _path, component]) => {
        if (element.matches('.tabbed__title')) {
          titleChildren.push(component);
        }
      },
    );
    const { block } = createBlock(renderer);
    const unloads = titleChildren.map((child) => vi.spyOn(child, 'unload'));

    block.unload();

    for (const unload of unloads) {
      expect(unload).toHaveBeenCalledTimes(1);
    }
  });
});

describe('TabsBlock body lifecycle', () => {
  it('ignores activation, refresh, and settings after unload', async () => {
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const { block, container } = createBlock(renderer);
    block.unload();

    await block.activate(1);
    await block.refreshActiveBody();
    await block.applySettings({ ...DEFAULT_SETTINGS, separator: ':: ' });
    await block.applySettings(DEFAULT_SETTINGS);

    expect(container.querySelector('.tabbed')).toBeNull();
    expect(renderer.mock.calls.filter(([, , el]) => el.matches('.tabbed__panel'))).toHaveLength(1);
    expect(block.locator).toBeNull();
  });

  it.each(['refresh', 'syntax', 'unload'] as const)(
    'disposes pending scopes once and ignores stale completion after %s',
    async (invalidation) => {
      const pending = [deferred(), deferred()] as const;
      const scopes: Component[] = [];
      const children: CleanupChild[] = [];
      const cleanups: Array<ReturnType<typeof vi.fn>> = [];
      const panels: HTMLElement[] = [];
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const renderer: RenderMarkdown = (...[_app, markdown, element, _path, scope]) => {
        if (!element.matches('.tabbed__panel')) return Promise.resolve();
        const call = panels.length;
        panels.push(element);
        scopes.push(scope);
        children.push(scope.addChild(new CleanupChild()));
        const cleanup = vi.fn();
        cleanups.push(cleanup);
        scope.register(cleanup);
        element.setText(markdown);
        return pending[call]?.promise ?? Promise.resolve();
      };
      const { block, container, setMode } = await sourceBlock(renderer, { mode: 'preview' });
      const oldActivation = block.activate(1);
      const unloads = scopes.map((scope) => vi.spyOn(scope, 'unload'));
      if (invalidation === 'refresh') await block.refreshActiveBody();
      else if (invalidation === 'syntax') {
        await block.applySettings({ ...DEFAULT_SETTINGS, defaultTitle: 'Changed' });
      } else block.unload();

      setMode('source');
      pending[0].resolve();
      pending[1].reject(new Error('stale body failure'));
      await oldActivation;
      await settle();

      expect(panels).toHaveLength(invalidation === 'unload' ? 2 : 3);
      expect(container.querySelectorAll('.tabbed__panel')).toHaveLength(
        invalidation === 'unload' ? 0 : 1,
      );
      expect(panels[0]?.isConnected).toBe(false);
      expect(panels[1]?.isConnected).toBe(false);
      expect(block.locator).toBeNull();
      expect(log).not.toHaveBeenCalled();
      for (const unload of unloads) expect(unload).toHaveBeenCalledOnce();
      for (const child of children.slice(0, 2)) expect(child.unloads).toBe(1);
      for (const cleanup of cleanups.slice(0, 2)) expect(cleanup).toHaveBeenCalledOnce();
      block.unload();
    },
  );

  it('releases a current failure scope once and caches its empty panel without retry', async () => {
    const failed = deferred();
    const child = new CleanupChild();
    const cleanup = vi.fn();
    let failedScope!: Component;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const renderer = vi.fn<RenderMarkdown>((...[_app, markdown, element, _path, scope]) => {
      if (!element.matches('.tabbed__panel') || !markdown.startsWith('first'))
        return Promise.resolve();
      failedScope = scope;
      scope.addChild(child);
      scope.register(cleanup);
      element.createDiv({ text: 'partial content' });
      return failed.promise;
    });
    const { block, container } = createBlock(renderer);
    const panel = container.querySelector('.tabbed__panel');
    const unload = vi.spyOn(failedScope, 'unload');
    failed.reject(new Error('partial failure'));
    await block.activate(0);

    expect(unload).toHaveBeenCalledOnce();
    expect(child.unloads).toBe(1);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(panel?.childElementCount).toBe(0);
    expect(log).toHaveBeenCalledExactlyOnceWith('[tabbed] Could not render tab body', {
      path: 'Note.md',
      index: 0,
      cause: 'partial failure',
    });
    await block.activate(1);
    await block.activate(0);
    expect(container.querySelector('.tabbed__panel.is-active')).toBe(panel);
    expect(renderer.mock.calls.filter(([, , el]) => el.matches('.tabbed__panel'))).toHaveLength(2);
    block.unload();
    expect(unload).toHaveBeenCalledOnce();
  });

  it.each(['unload', 'refresh'] as const)(
    'rechecks ownership when failure cleanup triggers %s',
    async (action) => {
      const failed = deferred();
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const cleanup = vi.fn(async () => {
        if (action === 'unload') block.unload();
        else await block.refreshActiveBody();
      });
      let calls = 0;
      let scope!: Component;
      const renderer: RenderMarkdown = (...[_app, _markdown, element, _path, component]) => {
        if (!element.matches('.tabbed__panel')) return Promise.resolve();
        calls += 1;
        element.setText(calls === 1 ? 'old' : 'replacement');
        if (calls > 1) return Promise.resolve();
        scope = component;
        component.register(cleanup);
        return failed.promise;
      };
      const { block, container } = createBlock(renderer);
      const unload = vi.spyOn(scope, 'unload');
      failed.reject(new Error('failure before cleanup'));
      await block.activate(0);
      await settle();

      expect(cleanup).toHaveBeenCalledOnce();
      expect(unload).toHaveBeenCalledOnce();
      expect(log).not.toHaveBeenCalled();
      expect(container.querySelector('.tabbed__panel')?.textContent ?? null).toBe(
        action === 'unload' ? null : 'replacement',
      );
      expect(calls).toBe(action === 'unload' ? 1 : 2);
      block.unload();
    },
  );

  it.each(['refresh', 'syntax'] as const)(
    'stops %s if body cleanup unloads the block',
    async (action) => {
      const renderer = vi.fn<RenderMarkdown>((...[_app, _markdown, element, _path, scope]) => {
        if (element.matches('.tabbed__panel'))
          scope.register(() => {
            block.unload();
          });
        return Promise.resolve();
      });
      const { block, container } = createBlock(renderer);
      const calls = renderer.mock.calls.length;

      if (action === 'refresh') await block.refreshActiveBody();
      else await block.applySettings({ ...DEFAULT_SETTINGS, defaultTitle: 'Changed' });

      expect(container.querySelector('.tabbed')).toBeNull();
      expect(renderer).toHaveBeenCalledTimes(calls);
      expect(block.locator).toBeNull();
    },
  );

  it('contains synchronous failure after reentrant unload without resurrecting DOM', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const renderer = vi.fn<RenderMarkdown>((_app, _markdown, element) => {
      if (element.matches('.tabbed__panel')) {
        block.unload();
        throw new Error('sync after unload');
      }
      return Promise.resolve();
    });
    const { block, container } = createBlock(renderer, twoTabs, { load: false });
    block.load();
    await block.activate(1);

    expect(container.querySelector('.tabbed')).toBeNull();
    expect(log).not.toHaveBeenCalled();
    expect(renderer.mock.calls.filter(([, , el]) => el.matches('.tabbed__panel'))).toHaveLength(1);
  });

  it('preserves replacement cache entries created by reentrant refresh cleanup', async () => {
    let calls = 0;
    const renderer: RenderMarkdown = (...[_app, _markdown, element, _path, scope]) => {
      if (!element.matches('.tabbed__panel')) return Promise.resolve();
      calls += 1;
      if (calls === 1) scope.register(() => block.refreshActiveBody());
      element.setText(`body ${calls}`);
      return Promise.resolve();
    };
    const { block, container } = createBlock(renderer);
    await block.activate(1);

    await block.refreshActiveBody();

    expect(calls).toBe(3);
    expect(container.querySelectorAll('.tabbed__panel')).toHaveLength(1);
    expect(container.querySelector('.tabbed__panel.is-active')?.textContent).toBe('body 3');
    await block.activate(1);
    expect(calls).toBe(3);
    block.unload();
  });

  it('closes lifecycle before unload callbacks can activate another body', async () => {
    let calls = 0;
    let scope!: Component;
    const renderer: RenderMarkdown = (...[_app, _markdown, element, _path, component]) => {
      if (!element.matches('.tabbed__panel')) return Promise.resolve();
      calls += 1;
      scope = component;
      component.register(() => block.activate(1));
      return Promise.resolve();
    };
    const { block, container } = createBlock(renderer);
    const unload = vi.spyOn(scope, 'unload');

    block.unload();
    await settle();

    expect(calls).toBe(1);
    expect(unload).toHaveBeenCalledOnce();
    expect(container.querySelector('.tabbed')).toBeNull();
  });

  it('unloads every cached scope once when refresh cleanup unloads the block', async () => {
    const scopes: Component[] = [];
    const renderer: RenderMarkdown = (...[_app, _markdown, element, _path, scope]) => {
      if (!element.matches('.tabbed__panel')) return Promise.resolve();
      scopes.push(scope);
      if (scopes.length === 1)
        scope.register(() => {
          block.unload();
        });
      return Promise.resolve();
    };
    const { block, container } = createBlock(renderer);
    await block.activate(1);
    const unloads = scopes.map((scope) => vi.spyOn(scope, 'unload'));

    await block.refreshActiveBody();

    for (const unload of unloads) expect(unload).toHaveBeenCalledOnce();
    expect(scopes).toHaveLength(2);
    expect(container.querySelector('.tabbed')).toBeNull();
  });

  it('renders each visited body once and preserves its live panel state', async () => {
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const { block, container } = createBlock(renderer);
    const firstPanel = required(
      container.querySelector<HTMLElement>('.tabbed__panel'),
      'Expected the first panel',
    );
    firstPanel.scrollTop = 37;
    firstPanel.dataset['localState'] = 'preserved';

    await block.activate(1);
    const secondPanel = required(
      container.querySelector<HTMLElement>('.tabbed__panel.is-active'),
      'Expected the second panel',
    );
    await block.activate(0);

    expect(
      renderer.mock.calls.filter(([, , element]) => element.matches('.tabbed__panel')),
    ).toHaveLength(2);
    expect(container.querySelector('.tabbed__panel.is-active')).toBe(firstPanel);
    expect(firstPanel.scrollTop).toBe(37);
    expect(firstPanel.dataset['localState']).toBe('preserved');
    expect(secondPanel.isConnected).toBe(true);
    block.unload();
  });

  it('shares pending renders across A to B to A activation and keeps the final selection active', async () => {
    const first = deferred();
    const second = deferred();
    const renderer = vi.fn<RenderMarkdown>((_app, markdown, element) => {
      if (!element.matches('.tabbed__panel')) {
        return Promise.resolve();
      }
      return (markdown.startsWith('first') ? first.promise : second.promise).then(() => {
        element.textContent = markdown.trim();
      });
    });
    const { block, container } = createBlock(renderer);
    const activateSecond = block.activate(1);
    const activateFirst = block.activate(0);

    expect(
      renderer.mock.calls.filter(([, , element]) => element.matches('.tabbed__panel')),
    ).toHaveLength(2);
    expect(container.querySelectorAll('.tabbed__panel')).toHaveLength(2);

    second.resolve();
    await activateSecond;
    expect(
      container.querySelector<HTMLElement>('.tabbed__panel.is-active')?.dataset['tabIndex'],
    ).toBe('0');

    first.resolve();
    await activateFirst;
    expect(
      container.querySelector<HTMLElement>('.tabbed__panel.is-active')?.dataset['tabIndex'],
    ).toBe('0');
    block.unload();
  });

  it('inserts newly visited panels in tab-index order without moving cached panels', async () => {
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const { block, container } = createBlock(renderer, threeTabs);
    const firstPanel = required(
      container.querySelector<HTMLElement>('.tabbed__panel[data-tab-index="0"]'),
      'Expected panel 0',
    );

    await block.activate(2);
    const thirdPanel = required(
      container.querySelector<HTMLElement>('.tabbed__panel[data-tab-index="2"]'),
      'Expected panel 2',
    );
    const parent = required(firstPanel.parentElement, 'Expected panel parent');
    await block.activate(1);

    expect(
      Array.from(parent.querySelectorAll<HTMLElement>(':scope > .tabbed__panel')).map(
        (panel) => panel.dataset['tabIndex'],
      ),
    ).toStrictEqual(['0', '1', '2']);
    expect(firstPanel.parentElement).toBe(parent);
    expect(thirdPanel.parentElement).toBe(parent);
    expect(container.querySelector('.tabbed__panel[data-tab-index="0"]')).toBe(firstPanel);
    expect(container.querySelector('.tabbed__panel[data-tab-index="2"]')).toBe(thirdPanel);
    block.unload();
  });

  it('logs an inactive cached failure without changing the selected panel', async () => {
    const first = deferred();
    const second = deferred();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const renderer = vi.fn<RenderMarkdown>((_app, markdown, element) => {
      if (!element.matches('.tabbed__panel')) {
        return Promise.resolve();
      }
      return (markdown.startsWith('first') ? first.promise : second.promise).then(() => {
        element.textContent = markdown.trim();
      });
    });
    const { block, container } = createBlock(renderer);
    const activateSecond = block.activate(1);
    second.resolve();
    await activateSecond;

    first.reject(new Error('late A failure'));
    await settle();

    expect(consoleError).toHaveBeenCalledExactlyOnceWith('[tabbed] Could not render tab body', {
      path: 'Note.md',
      index: 0,
      cause: 'late A failure',
    });
    expect(container.querySelector('.tabbed__panel.is-active')?.textContent).toBe('second body');
  });

  it('keeps resources registered by an inactive body render until block unload', async () => {
    const first = deferred();
    const lateCleanup = vi.fn();
    const lateChild = new CleanupChild();
    const renderer = vi.fn<RenderMarkdown>((...[_app, markdown, element, _path, component]) => {
      if (!element.matches('.tabbed__panel')) {
        return Promise.resolve();
      }
      if (markdown.startsWith('second')) {
        element.textContent = 'Current second';
        return Promise.resolve();
      }
      return first.promise.then(() => {
        component.register(lateCleanup);
        component.addChild(lateChild);
        element.textContent = 'Stale first';
      });
    });
    const { block, container } = createBlock(renderer);

    await block.activate(1);
    first.resolve();
    await settle();

    expect(lateCleanup).not.toHaveBeenCalled();
    expect(lateChild.loads).toBe(1);
    expect(lateChild.unloads).toBe(0);
    expect(container.querySelectorAll('.tabbed__panel')).toHaveLength(2);
    expect(container.querySelector('.tabbed__panel.is-active')?.textContent).toBe('Current second');
    block.unload();
    expect(lateCleanup).toHaveBeenCalledOnce();
    expect(lateChild.unloads).toBe(1);
  });

  it('logs each current body rejection exactly once and keeps an empty panel', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const renderer = vi.fn<RenderMarkdown>(async (_app, markdown, element) => {
      if (element.matches('.tabbed__panel')) {
        throw new Error(`failed ${markdown.trim()}`);
      }
    });
    const { block, container } = createBlock(renderer);
    await settle();

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenLastCalledWith('[tabbed] Could not render tab body', {
      path: 'Note.md',
      index: 0,
      cause: 'failed first body',
    });
    expect(container.querySelector('.tabbed__panel')?.childElementCount).toBe(0);

    await block.activate(1);

    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenLastCalledWith('[tabbed] Could not render tab body', {
      path: 'Note.md',
      index: 1,
      cause: 'failed second body',
    });
    expect(container.querySelectorAll('.tabbed__panel')).toHaveLength(2);
    expect(container.querySelector('.tabbed__panel.is-active')?.childElementCount).toBe(0);
  });

  it('contains synchronous body-render throws and completes the cached entry', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const renderer = vi.fn<RenderMarkdown>((_app, markdown, element) => {
      if (element.matches('.tabbed__panel') && markdown.startsWith('second')) {
        throw new Error('synchronous second failure');
      }
      return Promise.resolve();
    });
    const { block, container } = createBlock(renderer);

    await expect(block.activate(1)).resolves.toBeUndefined();
    await expect(block.activate(1)).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenLastCalledWith('[tabbed] Could not render tab body', {
      path: 'Note.md',
      index: 1,
      cause: 'synchronous second failure',
    });
    expect(container.querySelector('.tabbed__panel.is-active')?.childElementCount).toBe(0);
    block.unload();
  });

  it('logs a rejected title render once without adding status or error UI', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const renderer = vi.fn<RenderMarkdown>(async (_app, markdown, element) => {
      if (element.matches('.tabbed__title') && markdown === 'First') {
        throw new Error('broken title');
      }
    });
    const { container } = createBlock(renderer);
    await settle();

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('[tabbed] Could not render tab title', {
      path: 'Note.md',
      index: 0,
      cause: 'broken title',
    });
    expect(container.querySelector('.tabbed__title')?.childElementCount).toBe(0);
    expect(container.querySelectorAll('[role="status"], .error, .is-error')).toHaveLength(0);
  });

  it('cleans up resources registered after a stale title render resolves', async () => {
    const firstTitle = deferred();
    const lateCleanup = vi.fn();
    const lateChild = new CleanupChild();
    const renderer = vi.fn<RenderMarkdown>((...[_app, markdown, element, _path, component]) => {
      if (!element.matches('.tabbed__title')) {
        return Promise.resolve();
      }
      if (markdown !== 'First') {
        element.textContent = markdown;
        return Promise.resolve();
      }
      return firstTitle.promise.then(() => {
        component.register(lateCleanup);
        component.addChild(lateChild);
        element.textContent = 'Stale first';
      });
    });
    const { block, container } = createBlock(renderer);

    await block.applySettings({
      ...DEFAULT_SETTINGS,
      separator: ':: ',
      defaultTitle: 'Current fallback',
    });
    firstTitle.resolve();
    await settle();

    expect(lateCleanup).toHaveBeenCalledOnce();
    expect(lateChild.loads).toBe(1);
    expect(lateChild.unloads).toBe(1);
    expect(container.querySelectorAll('.tabbed__title')).toHaveLength(1);
    expect(container.querySelector('.tabbed__title')?.textContent).toBe('Current fallback');
    block.unload();
  });

  it('removes the body, root, and nearest host marker and unregisters once on unload', () => {
    const outer = createDiv();
    const wrapper = outer.createDiv({ cls: 'block-language-tabs' });
    const container = wrapper.createDiv();
    const actions = outer.createDiv({ cls: 'embed-actions' });
    const editButton = actions.createDiv().createEl('button', { cls: 'edit-block-button' });
    document.body.append(outer);
    const bodyChildren: Component[] = [];
    const renderer = vi.fn<RenderMarkdown>(
      async (...[_app, _markdown, element, _path, component]) => {
        if (element.matches('.tabbed__panel')) {
          bodyChildren.push(component);
        }
      },
    );
    const { block, blockHost } = createBlock(renderer, twoTabs, { container });
    const unloadBody = vi.spyOn(bodyChildren[0] as Component, 'unload');

    expect(wrapper.classList.contains('tabbed-host')).toBe(true);
    expect(outer.classList.contains('tabbed-host')).toBe(false);
    expect(editButton.matches('.tabbed-host ~ .embed-actions .edit-block-button')).toBe(true);
    expect(blockHost.register).toHaveBeenCalledTimes(1);

    block.unload();

    expect(unloadBody).toHaveBeenCalledTimes(1);
    expect(wrapper.classList.contains('tabbed-host')).toBe(false);
    expect(outer.classList.contains('tabbed-host')).toBe(false);
    expect(editButton.matches('.tabbed-host ~ .embed-actions .edit-block-button')).toBe(false);
    expect(container.querySelector('.tabbed')).toBeNull();
    expect(blockHost.unregister).toHaveBeenCalledTimes(1);
  });
});

describe('TabsBlock accessible layout', () => {
  it.each([
    ['top', 'horizontal', ['tabbed__list', 'tabbed__panels']],
    ['bottom', 'horizontal', ['tabbed__panels', 'tabbed__list']],
    ['left', 'vertical', ['tabbed__list', 'tabbed__panels']],
    ['right', 'vertical', ['tabbed__panels', 'tabbed__list']],
  ] as const)(
    'links the %s tab layout to its stable panel container',
    async (position, orientation, order) => {
      const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
      const { block, container } = createBlock(renderer, `${position}\n${twoTabs}`);
      const root = required(
        container.querySelector<HTMLElement>(':scope > .tabbed'),
        'Expected a tabbed root',
      );
      const list = required(
        root.querySelector<HTMLElement>(':scope > .tabbed__list'),
        'Expected a tab list',
      );
      const panels = required(
        root.querySelector<HTMLElement>(':scope > .tabbed__panels'),
        'Expected a panel container',
      );
      const panel = required(
        panels.querySelector<HTMLElement>(':scope > .tabbed__panel'),
        'Expected a tab panel',
      );
      const tabs = block.tabElements;
      const firstTab = required(tabs[0], 'Expected a first tab');
      const secondTab = required(tabs[1], 'Expected a second tab');

      expect(root.classList.contains(`tabbed--${position}`)).toBe(true);
      expect(root.classList.contains('tabbed--one')).toBe(true);
      expect(root.classList.contains('tabbed--border-hover')).toBe(true);
      expect(list.getAttribute('role')).toBe('tablist');
      expect(list.getAttribute('aria-orientation')).toBe(orientation);
      expect(Array.from(root.children).map((child) => child.className)).toStrictEqual(order);
      expect(root.querySelectorAll(':scope > .tabbed__panel')).toHaveLength(0);
      expect(panels.querySelectorAll(':scope > .tabbed__panel')).toHaveLength(1);
      expect(tabs.map((tab) => tab.getAttribute('role'))).toStrictEqual(['tab', 'tab']);
      expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toStrictEqual(['true', 'false']);
      expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toStrictEqual(['0', '-1']);
      expect(firstTab.getAttribute('aria-controls')).toBe(panel.id);
      expect(secondTab.hasAttribute('aria-controls')).toBe(false);
      expect(panel.getAttribute('aria-labelledby')).toBe(firstTab.id);
      expect(new Set([firstTab.id, secondTab.id, panel.id]).size).toBe(3);

      await block.applySettings({
        ...DEFAULT_SETTINGS,
        border: 'always',
        borderColor: '#abc',
        limitTitleWidth: true,
        contentPadding: '2em',
        contentMaxHeight: '40vh',
      });

      expect(panels.querySelector(':scope > .tabbed__panel')).toBe(panel);
      expect(panel.parentElement).toBe(panels);

      block.unload();
    },
  );

  it('uses IDs that remain unique across block instances', () => {
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const first = createBlock(renderer);
    const second = createBlock(renderer);
    const ids = [
      ...first.block.tabElements.map((tab) => tab.id),
      first.container.querySelector<HTMLElement>('.tabbed__panel')?.id,
      ...second.block.tabElements.map((tab) => tab.id),
      second.container.querySelector<HTMLElement>('.tabbed__panel')?.id,
    ];

    expect(ids.every((id) => id !== undefined && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    first.block.unload();
    second.block.unload();
  });

  it('updates selection links synchronously while retaining the inactive panel', async () => {
    const second = deferred();
    const renderer = vi.fn<RenderMarkdown>(async (_app, markdown, element) => {
      if (element.matches('.tabbed__panel') && markdown.startsWith('second')) {
        await second.promise;
      }
    });
    const { block, container } = createBlock(renderer);
    const oldPanel = required(
      container.querySelector<HTMLElement>('.tabbed__panel'),
      'Expected the initial panel',
    );

    const activation = block.activate(1);
    const panel = container.querySelector<HTMLElement>('.tabbed__panel.is-active');

    expect(block.selectedIndex).toBe(1);
    expect(oldPanel.isConnected).toBe(true);
    expect(panel).not.toBe(oldPanel);
    expect(container.querySelectorAll('.tabbed__panel')).toHaveLength(2);
    expect(oldPanel.inert).toBe(true);
    expect(oldPanel.getAttribute('aria-hidden')).toBe('true');
    expect(block.tabElements.map((tab) => tab.getAttribute('aria-selected'))).toStrictEqual([
      'false',
      'true',
    ]);
    expect(block.tabElements.map((tab) => tab.classList.contains('is-active'))).toStrictEqual([
      false,
      true,
    ]);
    expect(block.tabElements[0]?.hasAttribute('aria-controls')).toBe(false);
    expect(block.tabElements[1]?.getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.getAttribute('aria-labelledby')).toBe(block.tabElements[1]?.id);

    second.resolve();
    await activation;
    block.unload();
  });

  it('preserves a reentrant activation from the outgoing focused body blur', async () => {
    const renderedBodies: string[] = [];
    const renderer: RenderMarkdown = async (_app, markdown, element) => {
      if (!element.matches('.tabbed__panel')) return;
      renderedBodies.push(markdown.trim());
      element.createEl('input');
    };
    const { block, container } = createBlock(renderer, threeTabs);
    const input = required(container.querySelector('input'), 'Expected a focusable body input');
    let reentrantActivation: Promise<void> | undefined;
    input.addEventListener(
      'blur',
      () => {
        reentrantActivation = block.activate(2);
      },
      { once: true },
    );
    input.focus();

    await block.activate(1);
    await reentrantActivation;

    const activePanel = required(
      container.querySelector<HTMLElement>('.tabbed__panel.is-active'),
      'Expected the selected panel',
    );
    expect(block.selectedIndex).toBe(2);
    expect(container.querySelectorAll('.tabbed__panel.is-active')).toHaveLength(1);
    expect(activePanel.dataset['tabIndex']).toBe('2');
    expect(activePanel.inert).toBe(false);
    expect(activePanel.hasAttribute('aria-hidden')).toBe(false);
    expect(block.tabElements.map((tab) => tab.getAttribute('aria-selected'))).toStrictEqual([
      'false',
      'false',
      'true',
    ]);
    expect(block.tabElements.map((tab) => tab.getAttribute('aria-controls'))).toStrictEqual([
      null,
      null,
      activePanel.id,
    ]);
    expect(activePanel.getAttribute('aria-labelledby')).toBe(block.tabElements[2]?.id);
    for (const panel of Array.from(
      container.querySelectorAll<HTMLElement>('.tabbed__panel:not(.is-active)'),
    )) {
      expect(panel.inert).toBe(true);
      expect(panel.getAttribute('aria-hidden')).toBe('true');
    }
    expect(renderedBodies).toStrictEqual(['first body', 'third body']);
    block.unload();
  });

  it('stops activation before changing panel state when outgoing focus blur unloads the block', async () => {
    const renderedBodies: string[] = [];
    const cleanup = vi.fn();
    const renderer: RenderMarkdown = async (...[_app, markdown, element, _path, scope]) => {
      if (!element.matches('.tabbed__panel')) return;
      renderedBodies.push(markdown.trim());
      element.createEl('input');
      scope.register(cleanup);
    };
    const { block, container, blockHost } = createBlock(renderer);
    const firstPanel = required(
      container.querySelector<HTMLElement>('.tabbed__panel'),
      'Expected panel 0',
    );
    const input = required(firstPanel.querySelector('input'), 'Expected a focusable body input');
    const firstTab = required(block.tabElements[0], 'Expected tab 0');
    input.addEventListener(
      'blur',
      () => {
        block.unload();
      },
      { once: true },
    );
    input.focus();

    const activation = block.activate(1);

    expect(block.selectedIndex).toBe(1);
    expect(container.querySelector('.tabbed')).toBeNull();
    expect(firstPanel.isConnected).toBe(false);
    expect(firstPanel.classList.contains('is-active')).toBe(true);
    expect(firstPanel.inert).toBe(false);
    expect(firstPanel.hasAttribute('aria-hidden')).toBe(false);
    expect(firstTab.getAttribute('aria-controls')).toBe(firstPanel.id);
    expect(renderedBodies).toStrictEqual(['first body']);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(blockHost.unregister).toHaveBeenCalledExactlyOnceWith(block);
    await activation;
    await block.activate(0);
    expect(container.querySelector('.tabbed')).toBeNull();
    expect(renderedBodies).toStrictEqual(['first body']);
  });

  it('moves horizontal focus without rendering and activates with keyboard or click', async () => {
    const bodyMarkdown: string[] = [];
    const renderer = vi.fn<RenderMarkdown>(async (_app, markdown, element) => {
      if (element.matches('.tabbed__panel')) {
        bodyMarkdown.push(markdown);
      }
    });
    const { block } = createBlock(renderer);
    const first = required(block.tabElements[0], 'Expected a first tab');
    const second = required(block.tabElements[1], 'Expected a second tab');
    first.focus();

    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(second);
    expect(bodyMarkdown).toHaveLength(1);
    expect(block.selectedIndex).toBe(0);
    expect(first.getAttribute('tabindex')).toBe('0');
    expect(second.getAttribute('tabindex')).toBe('-1');

    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(second);
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(second);

    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(block.selectedIndex).toBe(1);
    expect(bodyMarkdown).toHaveLength(2);

    first.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await settle();
    expect(block.selectedIndex).toBe(0);
    second.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(block.selectedIndex).toBe(1);
    expect(bodyMarkdown).toHaveLength(2);

    block.unload();
  });

  it('uses vertical arrows and ignores horizontal arrows for a left layout', () => {
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const { block } = createBlock(renderer, `left\n${twoTabs}`);
    const [first, second] = block.tabElements;
    first?.focus();

    first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(second);
    second?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(second);
    second?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(first);

    block.unload();
  });
});

describe('TabsBlock source-mode controls', () => {
  it('recovers source controls on a cache hit after the body finished in a detached view', async () => {
    const body = deferred();
    const renderedBodies: HTMLElement[] = [];
    const renderer: RenderMarkdown = (_app, _markdown, element) => {
      if (!element.matches('.tabbed__panel')) return Promise.resolve();
      renderedBodies.push(element);
      return body.promise;
    };
    const { block, container, wrapper, blockHost } = await sourceBlock(renderer, { load: false });
    const viewContainer = required(wrapper.parentElement, 'Expected the owning view');
    viewContainer.remove();
    block.load();
    const detachedActivation = block.activate(0);
    body.resolve();
    await detachedActivation;
    expect(block.locator).toBeNull();
    expect(container.querySelector('.tabbed__action')).toBeNull();

    document.body.append(viewContainer);
    await block.activate(0);

    expect(renderedBodies).toHaveLength(1);
    expect(container.querySelector('.tabbed__panel.is-active')).toBe(renderedBodies[0]);
    expect(block.captureMutationAuthority()?.isActive()).toBe(true);
    const action = required(container.querySelector('.tabbed__action'), 'Expected an add action');
    expect(action.getAttribute('aria-label')).toBe('Add tab');
    action.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(blockHost.addTab).toHaveBeenCalledExactlyOnceWith(block);
    expect(blockHost.register).toHaveBeenCalledTimes(2);
    block.unload();
  });

  it('reconciles mutation controls after the first body render establishes view ownership', async () => {
    const body = deferred();
    const renderer = vi.fn<RenderMarkdown>((_app, _markdown, element) =>
      element.matches('.tabbed__panel') ? body.promise : Promise.resolve(),
    );
    const result = await sourceBlock(renderer, { source: `action-edit\n${twoTabs}`, load: false });
    const viewContainer = required(result.wrapper.parentElement, 'Expected the owning view');
    viewContainer.remove();

    result.block.load();
    expect(result.block.locator).toBeNull();
    expect(result.container.querySelector('.tabbed__action')).toBeNull();

    document.body.append(viewContainer);
    body.resolve();
    await settle();

    expect(result.block.locator).not.toBeNull();
    expect(result.container.querySelector('.tabbed__action')?.getAttribute('aria-label')).toBe(
      'Edit tab',
    );
    expect(result.blockHost.register).toHaveBeenCalledTimes(2);

    result.block.unload();
  });

  it('exposes the effective add action, context menu, and enabled panel editor in safe source mode', async () => {
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const settings = { ...DEFAULT_SETTINGS, doubleClickToEdit: true };
    const { block, container, blockHost } = await sourceBlock(renderer, { settings });
    const action = container.querySelector<HTMLElement>('.tabbed__action');
    const menuEvent = new MouseEvent('contextmenu', { bubbles: true });

    expect(block.locator).not.toBeNull();
    expect(action?.getAttribute('aria-label')).toBe('Add tab');
    action?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(blockHost.addTab).toHaveBeenCalledWith(block);

    block.tabElements[1]?.dispatchEvent(menuEvent);
    expect(blockHost.openTabMenu).toHaveBeenCalledWith(block, 1, menuEvent);
    container
      .querySelector('.tabbed__panel')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(blockHost.editTab).toHaveBeenCalledWith(block, 0);

    block.unload();
    expect(block.locator).toBeNull();
    action?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(blockHost.addTab).toHaveBeenCalledTimes(1);
  });

  it('uses the parsed edit action and omits an action-none control', async () => {
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const edit = await sourceBlock(renderer, { source: `action-edit\n${twoTabs}` });
    const editAction = edit.container.querySelector<HTMLElement>('.tabbed__action');

    expect(editAction?.getAttribute('aria-label')).toBe('Edit tab');
    await edit.block.activate(1);
    editAction?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(edit.blockHost.editTab).toHaveBeenCalledWith(edit.block, 1);
    edit.block.unload();

    const none = await sourceBlock(renderer, { source: `action-none\n${twoTabs}` });
    expect(none.container.querySelector('.tabbed__action')).toBeNull();
    none.block.unload();
  });

  it('omits every mutation affordance in preview mode while navigation still works', async () => {
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const settings = { ...DEFAULT_SETTINGS, doubleClickToEdit: true, dragAndDrop: true };
    const { block, container, blockHost } = await sourceBlock(renderer, {
      source: `action-edit\n${twoTabs}`,
      settings,
      mode: 'preview',
      load: false,
    });
    const registerDomEvent = vi.spyOn(block, 'registerDomEvent');
    block.load();
    const list = required(
      container.querySelector<HTMLElement>('.tabbed__list'),
      'Expected a tab list',
    );
    const root = required(container.querySelector<HTMLElement>('.tabbed'), 'Expected a tab root');
    const registrations = registerDomEvent.mock.calls.map(([element, type]) => [
      registrationTarget(element, list, root),
      type,
    ]);

    expect(block.locator).toBeNull();
    expect(registrations).toStrictEqual([
      ['list', 'click'],
      ['list', 'keydown'],
    ]);
    expect(container.querySelector('.tabbed__action')).toBeNull();
    expect(container.querySelector('[draggable="true"]')).toBeNull();
    block.tabElements[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(block.selectedIndex).toBe(1);
    block.tabElements[1]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    container
      .querySelector('.tabbed__panel')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(blockHost.openTabMenu).not.toHaveBeenCalled();
    expect(blockHost.editTab).not.toHaveBeenCalled();

    block.unload();
  });

  it('unloads source mutation listeners and removes the action when reparse becomes unsafe', async () => {
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const settings = { ...DEFAULT_SETTINGS, doubleClickToEdit: true };
    const { block, container, blockHost, setMode } = await sourceBlock(renderer, { settings });
    const list = required(
      container.querySelector<HTMLElement>('.tabbed__list'),
      'Expected a tab list',
    );
    const root = required(container.querySelector<HTMLElement>('.tabbed'), 'Expected a tab root');
    const removeListListener = vi.spyOn(list, 'removeEventListener');
    const removeRootListener = vi.spyOn(root, 'removeEventListener');

    expect(block.locator).not.toBeNull();
    expect(container.querySelector('.tabbed__action')).not.toBeNull();
    setMode('preview');

    await block.applySettings({ ...settings, separator: ':: ', defaultTitle: 'Fallback' });

    expect(block.locator).toBeNull();
    expect(container.querySelector('.tabbed__action')).toBeNull();
    expect(removeListListener.mock.calls.filter(([type]) => type === 'contextmenu')).toHaveLength(
      1,
    );
    expect(removeRootListener.mock.calls.filter(([type]) => type === 'dblclick')).toHaveLength(1);
    const menuEvent = new MouseEvent('contextmenu', { bubbles: true });
    block.tabElements[0]?.dispatchEvent(menuEvent);
    container
      .querySelector('.tabbed__panel')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(blockHost.openTabMenu.mock.calls).toStrictEqual([]);
    expect(blockHost.editTab.mock.calls).toStrictEqual([]);

    block.unload();
  });

  it('installs unsafe-to-safe mutation listeners once across later safe reparses', async () => {
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const settings = { ...DEFAULT_SETTINGS, doubleClickToEdit: true };
    const { block, container, blockHost, setMode } = await sourceBlock(renderer, {
      settings,
      mode: 'preview',
    });
    const list = required(
      container.querySelector<HTMLElement>('.tabbed__list'),
      'Expected a tab list',
    );
    const root = required(container.querySelector<HTMLElement>('.tabbed'), 'Expected a tab root');
    const addListListener = vi.spyOn(list, 'addEventListener');
    const addRootListener = vi.spyOn(root, 'addEventListener');

    expect(block.locator).toBeNull();
    expect(container.querySelector('.tabbed__action')).toBeNull();
    setMode('source');
    await block.applySettings({ ...settings, separator: ':: ', defaultTitle: 'Fallback' });

    expect(block.locator).not.toBeNull();
    const firstAction = required(
      container.querySelector<HTMLElement>('.tabbed__action'),
      'Expected a source action',
    );
    expect(addListListener.mock.calls.filter(([type]) => type === 'contextmenu')).toHaveLength(1);
    expect(addRootListener.mock.calls.filter(([type]) => type === 'dblclick')).toHaveLength(1);

    firstAction.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const firstMenuEvent = new MouseEvent('contextmenu', { bubbles: true });
    block.tabElements[0]?.dispatchEvent(firstMenuEvent);
    container
      .querySelector('.tabbed__panel')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(blockHost.addTab.mock.calls).toStrictEqual([[block]]);
    expect(blockHost.openTabMenu.mock.calls).toStrictEqual([[block, 0, firstMenuEvent]]);
    expect(blockHost.editTab.mock.calls).toStrictEqual([[block, 0]]);

    await block.applySettings({ ...settings, separator: '## ', defaultTitle: 'Still safe' });

    expect(addListListener.mock.calls.filter(([type]) => type === 'contextmenu')).toHaveLength(1);
    expect(addRootListener.mock.calls.filter(([type]) => type === 'dblclick')).toHaveLength(1);
    const secondAction = required(
      container.querySelector<HTMLElement>('.tabbed__action'),
      'Expected a source action after a safe reparse',
    );
    secondAction.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const secondMenuEvent = new MouseEvent('contextmenu', { bubbles: true });
    block.tabElements[0]?.dispatchEvent(secondMenuEvent);
    container
      .querySelector('.tabbed__panel')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(blockHost.openTabMenu.mock.calls).toStrictEqual([
      [block, 0, firstMenuEvent],
      [block, 0, secondMenuEvent],
    ]);
    expect(blockHost.editTab.mock.calls).toStrictEqual([
      [block, 0],
      [block, 0],
    ]);
    expect(blockHost.addTab.mock.calls).toStrictEqual([[block], [block]]);

    const unloadedPanel = required(
      container.querySelector<HTMLElement>('.tabbed__panel'),
      'Expected an active panel',
    );
    const removeRootListener = vi.spyOn(root, 'removeEventListener');
    block.unload();
    expect(removeRootListener.mock.calls.filter(([type]) => type === 'dblclick')).toHaveLength(1);
    list.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    unloadedPanel.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(blockHost.openTabMenu.mock.calls).toHaveLength(2);
    expect(blockHost.editTab.mock.calls).toHaveLength(2);
  });

  it('includes the section line in a single current source-body diagnostic', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const renderer = vi.fn<RenderMarkdown>(async (_app, _markdown, element) => {
      if (element.matches('.tabbed__panel')) {
        throw new Error('source render failed');
      }
    });
    const { block, container } = await sourceBlock(renderer);
    await settle();

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('[tabbed] Could not render tab body', {
      path: 'Note.md',
      line: 0,
      index: 0,
      cause: 'source render failed',
    });
    expect(container.querySelectorAll('.tabbed__panel')).toHaveLength(1);
    expect(container.querySelector('.tabbed__panel')?.childElementCount).toBe(0);

    block.unload();
  });
});

describe('TabsBlock selection memory and settings', () => {
  it('recovers from a settings reparse exception without duplicate diagnostics', async () => {
    const parser = vi
      .fn<(source: string, settings: TabbedSettings) => ParsedTabsDocument>()
      .mockImplementationOnce(parseTabsSource)
      .mockImplementationOnce(() => {
        throw new Error('settings parser fault');
      });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const renderedBodies: string[] = [];
    const renderer = vi.fn<RenderMarkdown>(async (_app, markdown, element) => {
      if (element.matches('.tabbed__panel')) {
        renderedBodies.push(markdown);
      }
    });
    const result = await sourceBlock(renderer, {
      parser,
    });

    await result.block.applySettings({
      ...DEFAULT_SETTINGS,
      separator: ':: ',
      defaultTitle: 'Recovery',
    });

    expect(parser).toHaveBeenCalledTimes(2);
    expect(result.block.document.tabs).toHaveLength(1);
    expect(result.block.document.tabs[0]).toMatchObject({
      kind: 'virtual',
      title: 'Recovery',
      content: twoTabs,
    });
    expect(result.block.tabElements).toHaveLength(1);
    expect(renderedBodies[renderedBodies.length - 1]).toBe(twoTabs);
    expect(result.block.locator).toBeNull();
    expect(result.container.querySelector('.tabbed__action')).toBeNull();
    expect(result.blockHost.register).toHaveBeenCalledTimes(1);
    expect(
      result.container.querySelector('[role="status"], [role="alert"], .tabbed__error'),
    ).toBeNull();
    expect(log).toHaveBeenCalledExactlyOnceWith('[tabbed] Could not parse tabs block', {
      path: 'Note.md',
      section: { lineStart: 0, lineEnd: 5 },
      cause: 'settings parser fault',
    });
    result.block.unload();
  });

  it('restores the same source key and clamps a remembered deleted tab to the last tab', async () => {
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const memory = new SelectionMemory(256);
    const section = { text: 'ignored', lineStart: 7, lineEnd: 7 };
    const first = createBlock(renderer, twoTabs, {
      context: sectionContext(section),
      memory,
    });
    await first.block.activate(1);
    first.block.unload();

    const restored = createBlock(renderer, twoTabs, {
      context: sectionContext(section),
      memory,
    });
    expect(restored.block.selectedIndex).toBe(1);
    restored.block.unload();

    memory.set('Note.md:7', 8);
    const clamped = createBlock(renderer, twoTabs, {
      context: sectionContext(section),
      memory,
    });
    expect(clamped.block.selectedIndex).toBe(1);
    expect(memory.get('Note.md:7')).toBe(1);
    clamped.block.unload();
  });

  it('does not restore or store without section information and clamps activation inputs', async () => {
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const memory = new SelectionMemory(256);
    memory.set('Note.md:0', 42);
    const { block } = createBlock(renderer, twoTabs, { memory });

    expect(block.selectedIndex).toBe(0);
    await block.activate(1);
    await block.activate(Number.NaN);
    expect(block.selectedIndex).toBe(1);
    await block.activate(-20);
    expect(block.selectedIndex).toBe(0);
    await block.activate(50);
    expect(block.selectedIndex).toBe(1);
    expect(memory.get('Note.md:0')).toBe(42);

    block.unload();
  });

  it('applies appearance and behavior settings live without rerendering Markdown', async () => {
    const titleCalls: string[] = [];
    const bodyCalls: string[] = [];
    const renderer = vi.fn<RenderMarkdown>(async (_app, markdown, element) => {
      (element.matches('.tabbed__title') ? titleCalls : bodyCalls).push(markdown);
    });
    const { block, container } = createBlock(renderer);
    const wrapper = container.parentElement;

    await block.applySettings({
      ...DEFAULT_SETTINGS,
      border: 'always',
      borderColor: '#abc',
      limitTitleWidth: true,
      contentPadding: '2em',
      contentMaxHeight: '40vh',
      hideNativeEditButton: false,
      doubleClickToEdit: true,
      dragAndDrop: true,
    });

    const root = container.querySelector<HTMLElement>('.tabbed');
    expect(titleCalls).toStrictEqual(['First', 'Second']);
    expect(bodyCalls).toStrictEqual(['first body\n']);
    expect(root?.classList.contains('tabbed--border-always')).toBe(true);
    expect(root?.classList.contains('tabbed--limit-title-width')).toBe(true);
    expect(root?.style.getPropertyValue('--tabbed-border-color')).toBe('#abc');
    expect(root?.style.getPropertyValue('--tabbed-content-padding')).toBe('2em');
    expect(root?.style.getPropertyValue('--tabbed-content-max-height')).toBe('40vh');
    expect(wrapper?.classList.contains('tabbed-host')).toBe(false);

    block.unload();
  });

  it('reparses syntax settings, unloads old titles, rebuilds actions, and clamps selection', async () => {
    const titleChildren: Component[] = [];
    const renderer = vi.fn<RenderMarkdown>(
      async (...[_app, _markdown, element, _path, component]) => {
        if (element.matches('.tabbed__title')) {
          titleChildren.push(component);
        }
      },
    );
    const result = await sourceBlock(renderer);
    await result.block.activate(1);
    const oldTitleUnloads = titleChildren.map((child) => vi.spyOn(child, 'unload'));

    await result.block.applySettings({
      ...DEFAULT_SETTINGS,
      separator: ':: ',
      defaultTitle: 'Fallback',
      defaultContent: 'Fallback body',
      titlePosition: 'right',
      titleLineMode: 'multi',
      action: 'edit',
    });

    expect(result.block.document.tabs).toHaveLength(1);
    expect(result.block.document.tabs[0]).toMatchObject({
      title: 'Fallback',
      content: twoTabs,
    });
    expect(result.block.selectedIndex).toBe(0);
    expect(result.block.tabElements).toHaveLength(1);
    expect(titleChildren).toHaveLength(3);
    for (const unload of oldTitleUnloads) {
      expect(unload).toHaveBeenCalledTimes(1);
    }
    expect(result.container.querySelector('.tabbed--right.tabbed--multi')).not.toBeNull();
    expect(result.container.querySelector('.tabbed__action')?.getAttribute('aria-label')).toBe(
      'Edit tab',
    );

    result.block.unload();
  });

  it('refreshes the active body after clearing the body cache', async () => {
    const titles: string[] = [];
    const bodies: string[] = [];
    const renderer = vi.fn<RenderMarkdown>(async (_app, markdown, element) => {
      (element.matches('.tabbed__title') ? titles : bodies).push(markdown);
    });
    const { block, container } = createBlock(renderer);
    const oldPanel = container.querySelector('.tabbed__panel');

    await block.refreshActiveBody();

    expect(titles).toStrictEqual(['First', 'Second']);
    expect(bodies).toStrictEqual(['first body\n', 'first body\n']);
    expect(container.querySelector('.tabbed__panel')).not.toBe(oldPanel);
    expect(container.querySelectorAll('.tabbed__panel')).toHaveLength(1);
    block.unload();
  });
});
