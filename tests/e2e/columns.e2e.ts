import { browser, expect } from '@wdio/globals';
import { afterEach, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

const preview = '.workspace-leaf.mod-active .markdown-preview-view';
const roots = `${preview} .tabbed-columns`;

interface ColumnsTestWindow extends Window {
  __columnsErrors?: string[];
  __columnsRestoreConsole?: () => void;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture element or measured width');
  return value;
}

async function openNote(note: string): Promise<void> {
  await obsidianPage.resetVault();
  await browser.execute(() => {
    const target = window as ColumnsTestWindow;
    const original = console.error;
    target.__columnsErrors = [];
    console.error = (...args: unknown[]) => {
      target.__columnsErrors?.push(args.map(String).join(' '));
      original(...args);
    };
    const onError = (event: ErrorEvent) => {
      target.__columnsErrors?.push(event.message);
    };
    window.addEventListener('error', onError);
    target.__columnsRestoreConsole = () => {
      console.error = original;
      window.removeEventListener('error', onError);
    };
  });
  await obsidianPage.openFile(note);
  const mode = await browser.executeObsidian(({ app, obsidian }) =>
    app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.getMode(),
  );
  if (mode !== 'preview') await browser.executeObsidianCommand('markdown:toggle-preview');
  await browser.$(preview).waitForDisplayed();
  expect(await browser.executeObsidian(({ app }) => app.plugins.enabledPlugins.has('tabbed'))).toBe(
    true,
  );
}

async function rootAt(index: number): Promise<WebdriverIO.Element> {
  const elements = await browser.$$(roots).getElements();
  const element = elements[index];
  if (element === undefined)
    throw new Error(`Expected columns root ${index}; found ${elements.length}`);
  return element;
}

async function setWidth(root: WebdriverIO.Element, width: number): Promise<void> {
  await browser.execute(
    (element, pixels) => {
      element.style.width = `${pixels}px`;
    },
    await root.getElement(),
    width,
  );
  await browser.waitUntil(async () => Math.abs((await root.getSize()).width - width) < 1);
}

async function layout(root: WebdriverIO.Element) {
  return browser.execute(
    (element) => {
      const grid = element.querySelector<HTMLElement>(':scope > .tabbed-columns__grid');
      if (grid === null) throw new Error('Missing direct columns grid');
      return {
        widths: Array.from(grid.children).map((child) => child.getBoundingClientRect().width),
        tracks: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        overflow: element.scrollWidth > element.clientWidth,
        overflowX: getComputedStyle(element).overflowX,
        stacked: element.classList.contains('is-stacked'),
      };
    },
    await root.getElement(),
  );
}

async function waitStack(root: WebdriverIO.Element, stacked: boolean): Promise<void> {
  await browser.waitUntil(async () => (await layout(root)).stacked === stacked);
}

describe('Columns in real Obsidian Reading view', () => {
  afterEach(async () => {
    const errors = await browser.execute(() => {
      const target = window as ColumnsTestWindow;
      target.__columnsRestoreConsole?.();
      const captured = target.__columnsErrors ?? [];
      delete target.__columnsErrors;
      delete target.__columnsRestoreConsole;
      return captured;
    });
    expect(errors).toEqual([]);
  });
  it('renders four scoped rows, Markdown titles/bodies, equal tracks, and weighted tracks', async () => {
    await openNote('Columns E2E.md');
    await browser.waitUntil(async () => (await browser.$$(roots).length) === 4);
    const equal = await rootAt(0);
    expect(await equal.$$('.tabbed-columns__title').length).toBe(0);
    const sizes = (await layout(equal)).widths;
    expect(sizes).toHaveLength(2);
    expect(Math.abs(required(sizes[0]) - required(sizes[1]))).toBeLessThan(1);
    const weighted = await rootAt(1);
    await expect(weighted.$('.tabbed-columns__title strong')).toHaveText('Weighted main');
    await expect(weighted.$('.tabbed-columns__title')).not.toHaveText(
      expect.stringContaining('**'),
    );
    await expect(weighted.$('.tabbed-columns__content em')).toHaveText('Rendered body');
    if (!browser.isMobile) {
      await setWidth(weighted, 1200);
      await browser.waitUntil(async () => {
        const widths = (await layout(weighted)).widths;
        return Math.abs(required(widths[0]) / required(widths[1]) - 2) < 0.15;
      });
    }
  });

  it('uses native overflow and stacks both directions without replacing or reordering columns', async () => {
    await openNote('Columns E2E.md');
    await browser.waitUntil(async () => (await browser.$$(roots).length) === 4);
    const scroll = await rootAt(2);
    await setWidth(scroll, 240);
    expect(await layout(scroll)).toMatchObject({
      overflow: true,
      overflowX: 'auto',
      stacked: false,
      tracks: 2,
    });
    if (!browser.isMobile) {
      await browser.execute(
        (element) => {
          element.scrollLeft = 0;
          element.focus();
        },
        await scroll.getElement(),
      );
      await browser.keys('ArrowRight');
      await browser.waitUntil(async () =>
        browser.execute((element) => element.scrollLeft > 0, await scroll.getElement()),
      );
    }
    const stack = await rootAt(3);
    await setWidth(stack, 900);
    await waitStack(stack, false);
    const columns = await stack
      .$$(':scope > .tabbed-columns__grid > .tabbed-columns__column')
      .getElements();
    const identities = columns.map((column) => column.elementId);
    await setWidth(stack, 420);
    await waitStack(stack, true);
    expect((await layout(stack)).tracks).toBe(1);
    await setWidth(stack, 200);
    await waitStack(stack, true);
    expect(await layout(stack)).toMatchObject({ tracks: 1, overflow: false });
    expect((await layout(stack)).widths).toEqual([200, 200]);
    await setWidth(stack, 900);
    await waitStack(stack, false);
    expect((await layout(stack)).tracks).toBe(2);
    const after = await stack
      .$$(':scope > .tabbed-columns__grid > .tabbed-columns__column')
      .getElements();
    expect(after.map((column) => column.elementId)).toEqual(identities);
    expect(await required(after[0]).getText()).toBe('Stack first.');
    expect(await required(after[1]).getText()).toBe('Stack second.');
  });

  it('keeps nested scroll grids independent and nested tabs own arrow navigation', async () => {
    await openNote('Columns Nested E2E.md');
    await browser.waitUntil(async () => (await browser.$$(roots).length) === 2);
    const outer = await rootAt(0);
    await setWidth(outer, 240);
    await waitStack(outer, true);
    expect((await layout(outer)).tracks).toBe(1);
    const inner = await rootAt(1);
    expect(await layout(inner)).toMatchObject({ tracks: 2, overflow: true, stacked: false });
    expect(await outer.$$('.tabbed').length).toBe(1);
    if (!browser.isMobile) {
      const tab = outer.$('.tabbed__tab');
      await browser.execute(
        (element) => {
          element.focus();
        },
        await tab.getElement(),
      );
      await browser.keys('ArrowRight');
      await expect(outer.$('.tabbed__panel')).toHaveText(
        expect.stringContaining('Nested first body.'),
      );
      await browser.waitUntil(() =>
        browser.execute(() => document.activeElement?.textContent === 'Nested two'),
      );
      await browser.keys('Enter');
      await expect(outer.$('.tabbed__panel')).toHaveText(
        expect.stringContaining('Nested second body.'),
      );
    }
  });

  it('mounts columns and Bases only in the active tab and detaches them on deactivation', async () => {
    await openNote('Columns Lazy E2E.md');
    const outer = browser.$(`${preview} .tabbed`);
    await outer.waitForExist();
    expect(await browser.$$(`${preview} .tabbed`).length).toBe(1);
    expect(await browser.$$(roots).length).toBe(0);
    expect(await outer.$$('.bases-embed').length).toBe(0);
    const tabs = await outer.$$(':scope > .tabbed__list > .tabbed__tab').getElements();
    await required(tabs[1]).click();
    await browser.waitUntil(async () => (await browser.$$(roots).length) === 1);
    const base = outer.$('.tabbed-columns .bases-embed');
    await expect(base).toHaveText(expect.stringContaining('Item 01'));
    await browser.execute(
      (element) => {
        (window as Window & { __columnsBase?: HTMLElement }).__columnsBase = element;
      },
      await base.getElement(),
    );
    await required(tabs[0]).click();
    await browser.waitUntil(async () => (await browser.$$(roots).length) === 0);
    expect(await outer.$$('.bases-embed').length).toBe(0);
    expect(
      await browser.execute(() => {
        const original = (window as Window & { __columnsBase?: HTMLElement }).__columnsBase;
        return original !== undefined && !original.isConnected && !document.contains(original);
      }),
    ).toBe(true);
    await browser.execute(() => {
      delete (window as Window & { __columnsBase?: HTMLElement }).__columnsBase;
    });
  });

  it('leaves every columns fixture unchanged when disabled', async () => {
    await openNote('Columns E2E.md');
    await browser.waitUntil(async () => (await browser.$$(roots).length) === 4);
    const notes = ['Columns E2E.md', 'Columns Nested E2E.md', 'Columns Lazy E2E.md'];
    const before = await Promise.all(notes.map((note) => obsidianPage.read(note)));
    await obsidianPage.disablePlugin('tabbed');
    const after = await Promise.all(notes.map((note) => obsidianPage.read(note)));
    expect(after).toEqual(before);
    await obsidianPage.enablePlugin('tabbed');
  });
});
