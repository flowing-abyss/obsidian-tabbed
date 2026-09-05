import { browser, expect } from '@wdio/globals';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';
import { Key } from 'webdriverio';

const FIXTURE = 'Tabbed E2E.md';

interface CacheTestWindow extends Window {
  __tabbedCache?: {
    panels: HTMLElement[];
    base: HTMLElement;
    scrollOwner?: HTMLElement | undefined;
  };
  __tabbedErrors?: string[];
  __tabbedRestoreConsole?: () => void;
}

async function openFixture(): Promise<void> {
  await obsidianPage.resetVault();
  await obsidianPage.openFile(FIXTURE);
  const mode = await browser.executeObsidian(({ app, obsidian }) =>
    app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.getMode(),
  );
  if (mode === 'preview') {
    await browser.executeObsidianCommand('markdown:toggle-preview');
  }
  await browser.executeObsidian(({ app, obsidian }) => {
    app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.editor.setCursor({ line: 0, ch: 0 });
  });
  await browser.waitUntil(async () => (await visibleElements('.tabbed')).length > 0);
}

async function visibleElements(selector: string): Promise<WebdriverIO.Element[]> {
  return browser.$$(selector).filter((element) => element.isDisplayed());
}

async function rootAt(index: number): Promise<WebdriverIO.Element> {
  const roots = await visibleElements('.tabbed');
  const root = roots[index];
  if (root === undefined) {
    throw new Error(`Expected rendered Tabbed root ${index}; found ${roots.length}`);
  }
  return root;
}

async function directTabs(root: WebdriverIO.Element): Promise<WebdriverIO.ElementArray> {
  return root.$$(':scope > .tabbed__list > .tabbed__tab').getElements();
}

async function panels(root: WebdriverIO.Element): Promise<WebdriverIO.ElementArray> {
  return root.$$(':scope > .tabbed__panels > .tabbed__panel').getElements();
}

async function activePanel(root: WebdriverIO.Element): Promise<WebdriverIO.Element> {
  const active = await root.$$(':scope > .tabbed__panels > .tabbed__panel.is-active').getElements();
  expect(active).toHaveLength(1);
  const panel = active[0];
  if (panel === undefined) {
    throw new Error('Expected one direct active panel');
  }
  return panel;
}

async function expectOneActivePanelPerRoot(): Promise<void> {
  const roots = await visibleElements('.tabbed');
  expect(roots.length).toBeGreaterThan(0);
  for (const root of roots) {
    await expect(await activePanel(root)).toBeDisplayed();
  }
  expect((await visibleElements('.tabbed > .tabbed__panels > .tabbed__panel')).length).toEqual(
    roots.length,
  );
}

async function clickTab(root: WebdriverIO.Element, index: number): Promise<void> {
  const tabs = await directTabs(root);
  const tab = tabs[index];
  if (tab === undefined) {
    throw new Error(`Expected direct tab ${index}; found ${tabs.length}`);
  }
  await tab.click();
}

async function replaceActiveNote(path: string): Promise<void> {
  await browser.executeObsidian(async ({ app, obsidian }, notePath) => {
    const leaf = app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.leaf;
    const file = app.vault.getFileByPath(notePath);
    if (leaf === undefined || file === null) throw new Error('Missing active note or target file');
    await leaf.openFile(file);
  }, path);
}

describe('Tabbed in a real Obsidian vault', () => {
  beforeEach(async () => {
    await browser.execute(() => {
      const target = window as CacheTestWindow;
      const original = console.error;
      target.__tabbedErrors = [];
      console.error = (...args: unknown[]) => {
        target.__tabbedErrors?.push(args.map(String).join(' '));
        original(...args);
      };
      const onError = (event: ErrorEvent) => target.__tabbedErrors?.push(event.message);
      const onRejection = (event: PromiseRejectionEvent) =>
        target.__tabbedErrors?.push(String(event.reason));
      window.addEventListener('error', onError);
      window.addEventListener('unhandledrejection', onRejection);
      target.__tabbedRestoreConsole = () => {
        console.error = original;
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
      };
    });
    await openFixture();
  });

  afterEach(async () => {
    const errors = await browser.execute(() => {
      const target = window as CacheTestWindow;
      target.__tabbedRestoreConsole?.();
      const captured = target.__tabbedErrors ?? [];
      delete target.__tabbedCache;
      delete target.__tabbedErrors;
      delete target.__tabbedRestoreConsole;
      return captured;
    });
    expect(errors).toEqual([]);
  });

  it('keeps one direct active panel while switching outer and nested tabs', async () => {
    await browser.waitUntil(async () => (await visibleElements('.tabbed')).length === 2);
    await expectOneActivePanelPerRoot();

    const outer = await rootAt(0);
    expect(await panels(outer)).toHaveLength(1);
    expect(await outer.$$('.bases-embed').length).toBe(0);
    const outerList = outer.$(':scope > .tabbed__list');
    await expect(outerList).toHaveAttribute('aria-orientation', 'vertical');
    await expect(await activePanel(outer)).toHaveText(
      expect.stringContaining('Outer overview body.'),
    );

    const nested = await rootAt(1);
    await expect(await activePanel(nested)).toHaveText(
      expect.stringContaining('Nested first body.'),
    );
    if (browser.isMobile) {
      await clickTab(nested, 1);
    } else {
      const first = (await directTabs(nested))[0];
      if (first === undefined) throw new Error('Missing nested first tab');
      await browser.execute(
        (element) => {
          element.focus();
        },
        await first.getElement(),
      );
      await browser.keys('ArrowRight');
      await browser.waitUntil(() =>
        browser.execute(() => document.activeElement?.textContent === 'Nested two'),
      );
      await expect(await activePanel(nested)).toHaveText(
        expect.stringContaining('Nested first body.'),
      );
      await browser.keys('Enter');
    }
    await expect(await activePanel(nested)).toHaveText(
      expect.stringContaining('Nested second body.'),
    );
    await expectOneActivePanelPerRoot();

    if (browser.isMobile) {
      await clickTab(outer, 1);
    } else {
      const first = (await directTabs(outer))[0];
      if (first === undefined) throw new Error('Missing outer first tab');
      await browser.execute(
        (element) => {
          element.focus();
        },
        await first.getElement(),
      );
      await browser.keys('ArrowDown');
      await browser.waitUntil(() =>
        browser.execute(() => document.activeElement?.textContent === 'Items'),
      );
      await expect(await activePanel(outer)).toHaveText(
        expect.stringContaining('Outer overview body.'),
      );
      await browser.keys('Enter');
    }
    await browser.waitUntil(async () => (await visibleElements('.tabbed')).length === 1);
    await expect(await activePanel(outer)).toHaveText(
      expect.stringContaining('Items Base positive control.'),
    );
    await expectOneActivePanelPerRoot();

    await clickTab(outer, 0);
    await browser.waitUntil(async () => (await visibleElements('.tabbed')).length === 2);
    await expect(await activePanel(outer)).toHaveText(
      expect.stringContaining('Outer overview body.'),
    );
    await expectOneActivePanelPerRoot();
  });

  it('reuses the live Base and scroll position after a hidden vault update', async () => {
    const outer = await rootAt(0);
    await clickTab(outer, 0);
    const outerElement = await outer.getElement();
    await browser.execute((element) => {
      element.setCssProps({ '--tabbed-content-max-height': '240px' });
    }, outerElement);
    await clickTab(outer, 1);
    const panel = await activePanel(outer);
    const base = panel.$('.bases-embed');
    await base.waitForExist();
    await expect(base).toHaveText(expect.stringContaining('Item 01'));
    const scrollEvidence = await browser.execute(
      (element) => {
        const root = element.closest('.tabbed');
        if (root === null) throw new Error('Missing Base tab root');
        const cache = {
          panels: Array.from(
            root.querySelectorAll<HTMLElement>(':scope > .tabbed__panels > .tabbed__panel'),
          ),
          base: element,
          scrollOwner: undefined as HTMLElement | undefined,
        };
        (window as CacheTestWindow).__tabbedCache = cache;
        const candidates = new Set(Array.from(element.querySelectorAll<HTMLElement>('*')));
        for (
          let candidate: HTMLElement | null = element;
          candidate !== null;
          candidate = candidate.parentElement
        ) {
          candidates.add(candidate);
        }
        if (document.scrollingElement instanceof HTMLElement) {
          candidates.add(document.scrollingElement);
        }

        for (const candidate of candidates) {
          const originalScrollTop = candidate.scrollTop;
          candidate.scrollTop = 0;
          const before = candidate.scrollTop;
          candidate.scrollTop = candidate.scrollHeight;
          const after = candidate.scrollTop;
          if (after > before) {
            cache.scrollOwner = candidate;
            candidate.dispatchEvent(new Event('scroll', { bubbles: true }));
            return {
              moved: true,
              before,
              after,
            };
          }
          candidate.scrollTop = originalScrollTop;
        }

        return { moved: false, before: 0, after: 0 };
      },
      await base.getElement(),
    );
    expect(scrollEvidence.moved).toBe(true);
    await expect(base).toHaveText(expect.stringContaining('Item 30'));
    const before = await browser.execute(
      () => (window as CacheTestWindow).__tabbedCache?.scrollOwner?.scrollTop,
    );
    expect(before).toBeGreaterThan(0);
    await clickTab(outer, 0);
    await expect(panel).not.toBeDisplayed();
    await expect(base).not.toBeDisplayed();
    expect(
      await browser.execute(() => {
        const cache = (window as CacheTestWindow).__tabbedCache;
        return (
          cache !== undefined &&
          cache.base.isConnected &&
          cache.panels.every((entry) => entry.isConnected)
        );
      }),
    ).toBe(true);

    try {
      await browser.executeObsidian(async ({ app }) => {
        const item = app.vault.getFileByPath('Items/Item 30.md');
        if (item === null) throw new Error('Missing positive-control Item 30');
        await app.fileManager.renameFile(item, 'Items/Item 30 Live Cache Probe.md');
      });
      await browser.waitUntil(
        () =>
          browser.execute(
            () =>
              (window as CacheTestWindow).__tabbedCache?.base.textContent.includes(
                'Item 30 Live Cache Probe',
              ) === true,
          ),
        { timeoutMsg: 'The materialized hidden Base row did not receive the vault rename' },
      );
      const tab = (await directTabs(outer))[1];
      if (tab === undefined) throw new Error('Missing Items tab');
      const revealed = await browser.execute(
        (element) => {
          element.click();
          const cache = (window as CacheTestWindow).__tabbedCache;
          const currentPanel = element
            .closest('.tabbed')
            ?.querySelector(':scope > .tabbed__panels > .tabbed__panel.is-active');
          return {
            samePanel: cache?.panels[1] === currentPanel,
            sameBase: cache?.base === currentPanel?.querySelector('.bases-embed'),
            text: cache?.base.innerText,
            scrollTop: cache?.scrollOwner?.scrollTop,
          };
        },
        await tab.getElement(),
      );
      expect(revealed).toMatchObject({ samePanel: true, sameBase: true, scrollTop: before });
      expect(revealed.text).toContain('Item 30 Live Cache Probe');
      await expect(base).toBeDisplayed();
      expect(await outer.$$('.bases-embed').length).toBe(1);
    } finally {
      await browser.executeObsidian(async ({ app }) => {
        const renamed = app.vault.getFileByPath('Items/Item 30 Live Cache Probe.md');
        if (renamed !== null) await app.fileManager.renameFile(renamed, 'Items/Item 30.md');
      });
    }
  });

  for (const mode of ['preview', 'source'] as const) {
    it(`keeps Base rows populated in the first reveal frames after a short tab in ${mode}`, async () => {
      await replaceActiveNote('Tabbed Cache E2E.md');
      await browser.executeObsidian(async ({ app, obsidian }, targetMode) => {
        const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        if (view === null) throw new Error('Missing Markdown view');
        await view.leaf.setViewState({
          type: 'markdown',
          state: { file: 'Tabbed Cache E2E.md', mode: targetMode, source: false },
        });
      }, mode);
      await browser.waitUntil(async () => (await visibleElements('.tabbed')).length > 0);
      const outer = await rootAt(0);
      const initialScrollHeight = await browser.execute(
        (element) => {
          element.setCssProps({ '--tabbed-content-max-height': '420px' });
          element.scrollIntoView({ block: 'start' });
          return element.closest('.markdown-preview-view, .cm-scroller')?.scrollHeight;
        },
        await outer.getElement(),
      );
      await clickTab(outer, 1);
      const base = (await activePanel(outer)).$('.bases-embed');
      await expect(base).toHaveText(expect.stringContaining('Item 01'));
      const evidence = await browser.execute(
        async (element) => {
          const tabs = element.querySelectorAll<HTMLElement>(
            ':scope > .tabbed__list > .tabbed__tab',
          );
          const dashboard = element.querySelector<HTMLElement>('.tabbed__panel.is-active');
          const cachedBase = dashboard?.querySelector('.bases-embed');
          if (dashboard === null || cachedBase === null || cachedBase === undefined) {
            throw new Error('Missing cached dashboard');
          }
          tabs[0]?.click();
          // Allow the real Base virtualizer to respond to the hidden geometry.
          await new Promise<void>((resolve) => window.setTimeout(resolve, 400));
          const hiddenHeight = dashboard.getBoundingClientRect().height;
          tabs[1]?.click();
          const frames: boolean[] = [];
          for (let frame = 0; frame < 3; frame++) {
            await new Promise<void>((resolve) => {
              window.requestAnimationFrame(() => {
                resolve();
              });
            });
            frames.push(cachedBase.textContent.includes('Item 01'));
          }
          element.setCssProps({ '--tabbed-content-max-height': 'none' });
          tabs[0]?.click();
          await new Promise<void>((resolve) => window.setTimeout(resolve, 400));
          const finalScrollHeight = element.closest(
            '.markdown-preview-view, .cm-scroller',
          )?.scrollHeight;
          return { hiddenHeight, frames, finalScrollHeight };
        },
        await outer.getElement(),
      );
      expect(evidence.frames).toEqual([true, true, true]);
      expect(evidence.hiddenHeight).toBe(420);
      expect(initialScrollHeight).toBeGreaterThan(0);
      expect(evidence.finalScrollHeight).toBe(initialScrollHeight);
    });
  }

  it('keeps identities during rapid switching and unloads every cached panel on navigation', async () => {
    const outer = await rootAt(0);
    await clickTab(outer, 0);
    await clickTab(outer, 1);
    const base = (await activePanel(outer)).$('.bases-embed');
    await expect(base).toHaveText(expect.stringContaining('Item 01'));
    const evidence = await browser.execute(
      (element) => {
        const tabs = element.querySelectorAll<HTMLElement>(':scope > .tabbed__list > .tabbed__tab');
        const original = Array.from(
          element.querySelectorAll<HTMLElement>(':scope > .tabbed__panels > .tabbed__panel'),
        );
        const originalBase = element.querySelector<HTMLElement>('.bases-embed');
        if (originalBase === null) throw new Error('Missing positive-control Base');
        (window as CacheTestWindow).__tabbedCache = { panels: original, base: originalBase };
        for (const index of [0, 1, 0, 1, 0]) tabs[index]?.click();
        const current = Array.from(
          element.querySelectorAll<HTMLElement>(':scope > .tabbed__panels > .tabbed__panel'),
        );
        return {
          count: current.length,
          active: current.filter((entry) => entry.classList.contains('is-active')).length,
          samePanels: current.every((entry, index) => entry === original[index]),
          sameBase: element.querySelector('.bases-embed') === originalBase,
          bases: element.querySelectorAll('.bases-embed').length,
        };
      },
      await outer.getElement(),
    );
    expect(evidence).toEqual({ count: 2, active: 1, samePanels: true, sameBase: true, bases: 1 });
    await clickTab(outer, 1);
    await replaceActiveNote('Welcome.md');
    await browser.waitUntil(() =>
      browser.execute(() => {
        const cache = (window as CacheTestWindow).__tabbedCache;
        return (
          cache !== undefined &&
          !cache.base.isConnected &&
          cache.panels.every((entry) => !entry.isConnected)
        );
      }),
    );
    await replaceActiveNote(FIXTURE);
    await browser.waitUntil(async () => (await visibleElements('.tabbed')).length === 1);
    const restored = await rootAt(0);
    expect(await panels(restored)).toHaveLength(1);
    await expect(await activePanel(restored)).toHaveText(
      expect.stringContaining('Items Base positive control.'),
    );
    expect(await restored.$$('.tabbed').length).toBe(0);
  });

  it('saves a modal edit, persists the rendered title, and restores it with Undo', async () => {
    const outer = await rootAt(0);
    await clickTab(outer, 0);
    const action = outer.$(':scope > .tabbed__list > [data-tab-action="edit"]');
    await action.waitForExist();
    await action.click();
    const modal = browser.$('.tabbed-editor-modal');
    await modal.waitForExist();
    const title = modal.$('.tabbed-editor-modal__title');
    await title.setValue('Overview edited E2E');
    await browser.keys('Escape');
    await modal.waitForExist({ reverse: true });

    await browser.waitUntil(async () => {
      const current = await rootAt(0);
      const tabs = await directTabs(current);
      return (await tabs[0]?.getText()) === 'Overview edited E2E';
    });
    await browser.waitUntil(async () =>
      (await obsidianPage.read(FIXTURE)).includes('tab: Overview edited E2E'),
    );

    await browser.executeObsidian(({ app, obsidian }) => {
      app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.editor.focus();
    });
    await browser.keys([Key.Ctrl, 'z']);
    await browser.waitUntil(async () => {
      const current = await rootAt(0);
      const tabs = await directTabs(current);
      return (await tabs[0]?.getText()) === 'Overview';
    });
    await browser.waitUntil(async () =>
      (await obsidianPage.read(FIXTURE)).includes('tab: Overview\n'),
    );
  });
});
