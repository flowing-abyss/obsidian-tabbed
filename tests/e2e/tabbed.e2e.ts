import { browser, expect } from '@wdio/globals';
import { beforeEach, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';
import { Key } from 'webdriverio';

const FIXTURE = 'Tabbed E2E.md';

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

async function directPanel(root: WebdriverIO.Element): Promise<WebdriverIO.Element> {
  const panels = await root.$$(':scope > .tabbed__panel').getElements();
  expect(panels.length).toEqual(1);
  const panel = panels[0];
  if (panel === undefined) {
    throw new Error('Expected one direct active panel');
  }
  return panel;
}

async function expectOnePanelPerRoot(): Promise<void> {
  const roots = await visibleElements('.tabbed');
  expect(roots.length).toBeGreaterThan(0);
  for (const root of roots) {
    expect(await root.$$(':scope > .tabbed__panel').length).toEqual(1);
  }
  expect((await visibleElements('.tabbed > .tabbed__panel')).length).toEqual(roots.length);
}

async function clickTab(root: WebdriverIO.Element, index: number): Promise<void> {
  const tabs = await directTabs(root);
  const tab = tabs[index];
  if (tab === undefined) {
    throw new Error(`Expected direct tab ${index}; found ${tabs.length}`);
  }
  await tab.click();
}

describe('Tabbed in a real Obsidian vault', () => {
  beforeEach(async () => {
    await openFixture();
  });

  it('keeps one direct active panel while switching outer and nested tabs', async () => {
    await browser.waitUntil(async () => (await visibleElements('.tabbed')).length === 2);
    await expectOnePanelPerRoot();

    const outer = await rootAt(0);
    const outerList = outer.$(':scope > .tabbed__list');
    await expect(outerList).toHaveAttribute('aria-orientation', 'vertical');
    await expect(await directPanel(outer)).toHaveText(
      expect.stringContaining('Outer overview body.'),
    );

    const nested = await rootAt(1);
    await expect(await directPanel(nested)).toHaveText(
      expect.stringContaining('Nested first body.'),
    );
    await clickTab(nested, 1);
    await expect(await directPanel(nested)).toHaveText(
      expect.stringContaining('Nested second body.'),
    );
    await expectOnePanelPerRoot();

    await clickTab(outer, 1);
    await browser.waitUntil(async () => (await visibleElements('.tabbed')).length === 1);
    await expect(await directPanel(outer)).toHaveText(
      expect.stringContaining('Items Base positive control.'),
    );
    await expectOnePanelPerRoot();

    await clickTab(outer, 0);
    await browser.waitUntil(async () => (await visibleElements('.tabbed')).length === 2);
    await expect(await directPanel(outer)).toHaveText(
      expect.stringContaining('Outer overview body.'),
    );
    await expectOnePanelPerRoot();
  });

  it('unloads and recreates a positive-control Base before scrolling to a lower row', async () => {
    const outer = await rootAt(0);
    await clickTab(outer, 1);
    const panel = await directPanel(outer);
    const base = panel.$('.bases-embed');
    await base.waitForExist();
    await expect(base).toHaveText(expect.stringContaining('Item 01'));
    const originalBaseElement = await base.getElement();
    await browser.execute((element) => {
      (window as Window & { __tabbedOriginalBase?: HTMLElement }).__tabbedOriginalBase = element;
    }, originalBaseElement);

    await clickTab(outer, 0);
    await browser.waitUntil(() =>
      browser.execute(() => {
        const original = (window as Window & { __tabbedOriginalBase?: HTMLElement })
          .__tabbedOriginalBase;
        return original !== undefined && !original.isConnected;
      }),
    );
    const detachedOriginal = await browser.execute(() => {
      const original = (window as Window & { __tabbedOriginalBase?: HTMLElement })
        .__tabbedOriginalBase;
      return {
        exists: original !== undefined,
        isConnected: original?.isConnected ?? false,
        isInDocument: original === undefined ? false : document.documentElement.contains(original),
      };
    });
    expect(detachedOriginal).toEqual({ exists: true, isConnected: false, isInDocument: false });

    await clickTab(outer, 1);
    const recreatedPanel = await directPanel(outer);
    const recreatedBase = recreatedPanel.$('.bases-embed');
    await recreatedBase.waitForExist();
    await expect(recreatedBase).toHaveText(expect.stringContaining('Item 01'));
    const recreatedBaseElement = await recreatedBase.getElement();
    const recreatedIdentity = await browser.execute((element) => {
      const original = (window as Window & { __tabbedOriginalBase?: HTMLElement })
        .__tabbedOriginalBase;
      return {
        differsFromOriginal: original !== element,
        isConnected: element.isConnected,
      };
    }, recreatedBaseElement);
    expect(recreatedIdentity).toEqual({ differsFromOriginal: true, isConnected: true });

    const scrollContainer = recreatedBase.$(
      './ancestor::*[contains(concat(" ", normalize-space(@class), " "), " cm-scroller ")][1]',
    );
    await scrollContainer.waitForExist();
    const scrollElement = await scrollContainer.getElement();
    const scrollDimensions = await browser.execute(
      (element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }),
      scrollElement,
    );
    expect(scrollDimensions.scrollHeight).toBeGreaterThan(scrollDimensions.clientHeight);
    expect(await recreatedBase.getText()).not.toContain('Item 30');
    await browser.execute((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    }, scrollElement);
    await expect(recreatedBase).toHaveText(expect.stringContaining('Item 30'));
    await browser.execute(() => {
      delete (window as Window & { __tabbedOriginalBase?: HTMLElement }).__tabbedOriginalBase;
    });
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
