import type {
  Component,
  MarkdownPostProcessorContext,
  MarkdownSectionInformation,
  App as ObsidianApp,
} from 'obsidian';
import { App, MarkdownView } from 'obsidian-test-mocks/obsidian';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type TabbedSettings } from '../settings.js';
import { SelectionMemory } from '../tabs/selection-memory.js';
import type { RenderMarkdown } from './tab-body.js';
import { TabsBlock, type TabsBlockHost } from './tabs-block.js';

const twoTabs = ['tab: First', 'first body', 'tab: Second', 'second body'].join('\n');

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
    load?: boolean;
  } = {},
): Promise<{
  block: TabsBlock;
  container: HTMLElement;
  blockHost: ReturnType<typeof host>;
  wrapper: HTMLElement;
}> {
  const source = options.source ?? twoTabs;
  const settings = options.settings ?? DEFAULT_SETTINGS;
  const mockApp = App.createConfigured__();
  const leaf = mockApp.workspace.getLeaf(true);
  await leaf.setViewState({ type: 'markdown' });
  const view = MarkdownView.create2__(leaf);
  await leaf.open(view.asOriginalType7__());
  vi.spyOn(view, 'getMode').mockReturnValue(options.mode ?? 'source');
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
    load: options.load ?? true,
  });
  return { ...result, wrapper };
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
  it('detaches and unloads A before rendering B and ignores A completing last', async () => {
    const first = deferred();
    const second = deferred();
    const bodyCalls: Array<{ markdown: string; panel: HTMLElement; component: Component }> = [];
    const sequence: string[] = [];
    const renderer = vi.fn<RenderMarkdown>((...[_app, markdown, element, _path, component]) => {
      if (!element.matches('.tabbed__panel')) {
        return Promise.resolve();
      }
      bodyCalls.push({ markdown, panel: element, component });
      sequence.push(`render:${markdown.trim()}`);
      return (markdown.startsWith('first') ? first.promise : second.promise).then(() => {
        element.textContent = markdown.trim();
      });
    });
    const { block, container } = createBlock(renderer);
    const firstChild = bodyCalls[0]?.component;
    if (firstChild === undefined) {
      throw new Error('Expected the first body child');
    }
    const unloadFirst = vi.spyOn(firstChild, 'unload').mockImplementation(() => {
      sequence.push('unload:first');
    });

    const activateSecond = block.activate(1);

    expect(sequence.slice(-2)).toStrictEqual(['unload:first', 'render:second body']);
    expect(bodyCalls[0]?.panel.isConnected).toBe(false);
    expect(bodyCalls[0]?.panel).not.toBe(bodyCalls[1]?.panel);
    expect(container.querySelectorAll('.tabbed__panel')).toHaveLength(1);

    second.resolve();
    await activateSecond;
    first.resolve();
    await settle();

    expect(unloadFirst).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('.tabbed__panel')).toHaveLength(1);
    expect(container.querySelector('.tabbed__panel')?.textContent).toBe('second body');
  });

  it('catches a stale rejection without logging it or changing the current panel', async () => {
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

    expect(consoleError).not.toHaveBeenCalled();
    expect(container.querySelector('.tabbed__panel')?.textContent).toBe('second body');
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
    expect(container.querySelectorAll('.tabbed__panel')).toHaveLength(1);
    expect(container.querySelector('.tabbed__panel')?.childElementCount).toBe(0);
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

  it('removes the body, root, and nearest host marker and unregisters once on unload', () => {
    const outer = createDiv();
    const wrapper = outer.createDiv({ cls: 'block-language-tabs' });
    const container = wrapper.createDiv();
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
    expect(blockHost.register).toHaveBeenCalledTimes(1);

    block.unload();

    expect(unloadBody).toHaveBeenCalledTimes(1);
    expect(wrapper.classList.contains('tabbed-host')).toBe(false);
    expect(outer.classList.contains('tabbed-host')).toBe(false);
    expect(container.querySelector('.tabbed')).toBeNull();
    expect(blockHost.unregister).toHaveBeenCalledTimes(1);
  });
});

describe('TabsBlock accessible layout', () => {
  it.each([
    ['top', 'horizontal', ['tablist', 'tabpanel']],
    ['bottom', 'horizontal', ['tabpanel', 'tablist']],
    ['left', 'vertical', ['tablist', 'tabpanel']],
    ['right', 'vertical', ['tabpanel', 'tablist']],
  ] as const)('links the %s tab layout to its one direct panel', (position, orientation, order) => {
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
    const panel = required(
      root.querySelector<HTMLElement>(':scope > .tabbed__panel'),
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
    expect(Array.from(root.children).map((child) => child.getAttribute('role'))).toStrictEqual(
      order,
    );
    expect(root.querySelectorAll(':scope > .tabbed__panel')).toHaveLength(1);
    expect(tabs.map((tab) => tab.getAttribute('role'))).toStrictEqual(['tab', 'tab']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toStrictEqual(['true', 'false']);
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toStrictEqual(['0', '-1']);
    expect(firstTab.getAttribute('aria-controls')).toBe(panel.id);
    expect(secondTab.hasAttribute('aria-controls')).toBe(false);
    expect(panel.getAttribute('aria-labelledby')).toBe(firstTab.id);
    expect(new Set([firstTab.id, secondTab.id, panel.id]).size).toBe(3);

    block.unload();
  });

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

  it('updates selection links synchronously while replacing the panel', async () => {
    const second = deferred();
    const renderer = vi.fn<RenderMarkdown>(async (_app, markdown, element) => {
      if (element.matches('.tabbed__panel') && markdown.startsWith('second')) {
        await second.promise;
      }
    });
    const { block, container } = createBlock(renderer);
    const oldPanel = container.querySelector<HTMLElement>('.tabbed__panel');

    const activation = block.activate(1);
    const panel = container.querySelector<HTMLElement>('.tabbed__panel');

    expect(block.selectedIndex).toBe(1);
    expect(oldPanel?.isConnected).toBe(false);
    expect(panel).not.toBe(oldPanel);
    expect(container.querySelectorAll('.tabbed__panel')).toHaveLength(1);
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
    expect(bodyMarkdown).toHaveLength(4);

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

  it('registers source mutation listeners once and does not duplicate them on reparse', async () => {
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const settings = { ...DEFAULT_SETTINGS, doubleClickToEdit: true };
    const { block, container, blockHost } = await sourceBlock(renderer, {
      settings,
      load: false,
    });
    const registerDomEvent = vi.spyOn(block, 'registerDomEvent');
    block.load();
    const list = required(
      container.querySelector<HTMLElement>('.tabbed__list'),
      'Expected a tab list',
    );
    const root = required(container.querySelector<HTMLElement>('.tabbed'), 'Expected a tab root');
    const registrationSummary = () =>
      registerDomEvent.mock.calls.map(([element, type]) => [
        registrationTarget(element, list, root),
        type,
      ]);

    expect(registrationSummary()).toStrictEqual([
      ['list', 'click'],
      ['list', 'contextmenu'],
      ['list', 'keydown'],
      ['root', 'dblclick'],
    ]);

    await block.applySettings({ ...settings, separator: ':: ', defaultTitle: 'Fallback' });

    expect(registrationSummary()).toHaveLength(4);
    const menuEvent = new MouseEvent('contextmenu', { bubbles: true });
    block.tabElements[0]?.dispatchEvent(menuEvent);
    container
      .querySelector('.tabbed__panel')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(blockHost.openTabMenu.mock.calls).toStrictEqual([[block, 0, menuEvent]]);
    expect(blockHost.editTab.mock.calls).toStrictEqual([[block, 0]]);

    block.unload();
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

  it('refreshes only the active body', async () => {
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
