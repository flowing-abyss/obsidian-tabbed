import { browser, expect } from '@wdio/globals';
import { afterEach, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

const preview = '.workspace-leaf.mod-active .markdown-preview-view';
const roots = `${preview} .tabbed-columns`;
let preparedNote: { path: string; original: string } | undefined;

interface ColumnsTestWindow extends Window {
  __columnsErrors?: string[];
  __columnsRestoreConsole?: () => void;
  __columnsCached?: { base: HTMLElement; columns: HTMLElement };
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
    const onRejection = (event: PromiseRejectionEvent) => {
      target.__columnsErrors?.push(String(event.reason));
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    target.__columnsRestoreConsole = () => {
      console.error = original;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  });
  if (note === 'Columns E2E.md') {
    const original = await obsidianPage.read(note);
    preparedNote = { path: note, original };
    const source = original.replace(
      /column:(\r?\n)Equal second\./,
      'column:\u0020\u0020\u0020$1Equal second.',
    );
    await obsidianPage.write(note, source);
    expect(await obsidianPage.read(note)).toMatch(/column: {3}\r?\nEqual second\./);
  }
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
    try {
      const errors = await browser.execute(() => {
        const target = window as ColumnsTestWindow;
        target.__columnsRestoreConsole?.();
        const captured = target.__columnsErrors ?? [];
        delete target.__columnsErrors;
        delete target.__columnsRestoreConsole;
        delete target.__columnsCached;
        return captured;
      });
      expect(errors).toEqual([]);
    } finally {
      const restore = preparedNote;
      preparedNote = undefined;
      if (restore !== undefined) await obsidianPage.write(restore.path, restore.original);
    }
  });
  it('renders four scoped rows, Markdown titles/bodies, equal tracks, and weighted tracks', async () => {
    await openNote('Columns E2E.md');
    expect(await obsidianPage.read('Columns E2E.md')).toMatch(/column: {3}\r?\nEqual second\./);
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
          element.scrollIntoView({ block: 'center', inline: 'nearest' });
        },
        await scroll.getElement(),
      );
      await scroll.waitForDisplayed({ withinViewport: true });
      const focused = await browser.execute(
        (element) => {
          element.focus();
          element.scrollLeft = 0;
          return document.activeElement === element;
        },
        await scroll.getElement(),
      );
      expect(focused).toBe(true);
      await browser.keys('ArrowRight');
      await browser.waitUntil(
        async () => browser.execute((element) => element.scrollLeft > 0, await scroll.getElement()),
        { timeoutMsg: 'Focused overflowing columns root did not scroll with ArrowRight' },
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
      await expect(outer.$('.tabbed__panel.is-active')).toHaveText(
        expect.stringContaining('Nested first body.'),
      );
      await browser.waitUntil(() =>
        browser.execute(() => document.activeElement?.textContent === 'Nested two'),
      );
      await browser.keys('Enter');
      await expect(outer.$('.tabbed__panel.is-active')).toHaveText(
        expect.stringContaining('Nested second body.'),
      );
    }
  });

  it('mounts columns and Bases on first visit and reuses them after deactivation', async () => {
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
    const columns = await rootAt(0);
    await expect(base).toHaveText(expect.stringContaining('Item 01'));
    await browser.execute(
      (element, columnRoot) => {
        (window as ColumnsTestWindow).__columnsCached = { base: element, columns: columnRoot };
      },
      await base.getElement(),
      await columns.getElement(),
    );
    await required(tabs[0]).click();
    expect(await browser.$$(roots).length).toBe(1);
    expect(await outer.$$('.bases-embed').length).toBe(1);
    await expect(base).not.toBeDisplayed();
    await expect(columns).not.toBeDisplayed();
    expect(
      await browser.execute(() => {
        const original = (window as ColumnsTestWindow).__columnsCached;
        return original?.base.isConnected === true && original.columns.isConnected;
      }),
    ).toBe(true);
    await required(tabs[1]).click();
    expect(
      await browser.execute(
        (element) => {
          const target = window as ColumnsTestWindow;
          const original = target.__columnsCached;
          if (original === undefined) throw new Error('Missing cached columns and Base');
          const same =
            original.base === element.querySelector<HTMLElement>('.bases-embed') &&
            original.columns === element.querySelector<HTMLElement>('.tabbed-columns');
          delete target.__columnsCached;
          return same;
        },
        await outer.getElement(),
      ),
    ).toBe(true);
    await expect(base).toBeDisplayed();
    await expect(columns).toBeDisplayed();
  });

  it('settles hidden responsive columns before reveal in both directions and excludes focus', async () => {
    await openNote('Columns Lazy E2E.md');
    const outer = browser.$(`${preview} .tabbed`);
    await outer.waitForExist();
    const tabs = await outer.$$(':scope > .tabbed__list > .tabbed__tab').getElements();
    const plainTab = required(tabs[0]);
    const columnsTab = required(tabs[1]);
    await columnsTab.click();
    const columns = await rootAt(0);
    const panel = outer.$(':scope > .tabbed__panels > .tabbed__panel.is-active');
    const container = await outer.$(':scope > .tabbed__panels').getElement();
    await setWidth(container, 900);
    await waitStack(columns, false);
    await browser.execute(
      (element) => {
        const probe = createEl('button');
        probe.className = 'cache-focus-probe';
        probe.textContent = 'Visible descendant probe';
        probe.setCssProps({ visibility: 'visible' });
        element.append(probe);
      },
      await panel.getElement(),
    );

    for (const [width, stacked] of [
      [420, true],
      [900, false],
    ] as const) {
      await plainTab.click();
      await setWidth(container, width);
      await waitStack(columns, stacked);
      const hidden = await browser.execute(
        (element, columnRoot) => {
          const probe = element.querySelector<HTMLElement>('.cache-focus-probe');
          if (probe === null) throw new Error('Missing visible descendant probe');
          probe.focus();
          return {
            panelWidth: element.getBoundingClientRect().width,
            columnsWidth: columnRoot.getBoundingClientRect().width,
            opacity: getComputedStyle(element).opacity,
            probeVisibility: getComputedStyle(probe).visibility,
            focused: document.activeElement === probe,
            connected: element.isConnected && columnRoot.isConnected,
          };
        },
        await panel.getElement(),
        await columns.getElement(),
      );
      expect(hidden).toMatchObject({
        opacity: '0',
        probeVisibility: 'visible',
        focused: false,
        connected: true,
      });
      expect(hidden.panelWidth).toBeGreaterThan(0);
      expect(hidden.columnsWidth).toBeGreaterThan(0);
      await expect(panel).not.toBeDisplayed();
      await expect(panel.$('.cache-focus-probe')).not.toBeDisplayed();

      const reveal = await browser.execute(
        async (tab, columnRoot) => {
          const sample = () => ({
            active: columnRoot.closest('.tabbed__panel')?.classList.contains('is-active'),
            stacked: columnRoot.classList.contains('is-stacked'),
            width: columnRoot.getBoundingClientRect().width,
          });
          const frames: Array<ReturnType<typeof sample>> = [];
          const painted = new Promise<void>((resolve) => {
            const record = () => {
              frames.push(sample());
              if (frames.length === 3) resolve();
              else window.requestAnimationFrame(record);
            };
            window.requestAnimationFrame(record);
          });
          tab.click();
          const immediate = sample();
          await painted;
          return { immediate, frames };
        },
        await columnsTab.getElement(),
        await columns.getElement(),
      );
      expect(reveal.frames).toHaveLength(3);
      for (const sample of [reveal.immediate, ...reveal.frames]) {
        expect(sample).toMatchObject({ active: true, stacked });
        expect(sample.width).toBeGreaterThan(0);
      }
    }
  });

  it('leaves every columns fixture unchanged when disabled', async () => {
    await openNote('Columns E2E.md');
    await browser.waitUntil(async () => (await browser.$$(roots).length) === 4);
    const notes = ['Columns E2E.md', 'Columns Nested E2E.md', 'Columns Lazy E2E.md'];
    const before = await Promise.all(notes.map((note) => obsidianPage.read(note)));
    try {
      await obsidianPage.disablePlugin('tabbed');
      const after = await Promise.all(notes.map((note) => obsidianPage.read(note)));
      expect(after).toEqual(before);
    } finally {
      await obsidianPage.enablePlugin('tabbed');
    }
  });

  it('captures unhandled rejections without preventing default and removes the listener on restore', async () => {
    await openNote('Columns Nested E2E.md');
    const evidence = await browser.execute(() => {
      const target = window as ColumnsTestWindow;
      const event = new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason: new Error('Columns capture probe'),
        cancelable: true,
      });
      window.dispatchEvent(event);
      const captured = target.__columnsErrors?.splice(0) ?? [];
      target.__columnsRestoreConsole?.();
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: Promise.resolve(),
          reason: new Error('Detached capture probe'),
        }),
      );
      return {
        captured,
        defaultPrevented: event.defaultPrevented,
        afterRestore: target.__columnsErrors ?? [],
      };
    });
    expect(evidence).toEqual({
      captured: ['Error: Columns capture probe'],
      defaultPrevented: false,
      afterRestore: [],
    });
  });
});
