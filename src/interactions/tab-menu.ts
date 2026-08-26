import { Component, Menu, Notice } from 'obsidian';
import { formatError, logError } from '../diagnostics.js';
import type { TabsBlock } from '../render/tabs-block.js';
import type { TabbedSettings } from '../settings.js';
import { replaceLocatedBlock, type MutationFailure } from '../source/source-mutations.js';
import type { TabDraft } from '../tabs/tab-model.js';
import { addTab, deleteTab } from '../tabs/tab-operations.js';

export interface TabMenuRequest {
  readonly block: TabsBlock;
  readonly index: number;
  readonly event: MouseEvent;
  readonly getSettings: () => TabbedSettings;
}

type TabAction = 'add' | 'delete' | 'copy' | 'paste';

const messages = {
  add: { failure: 'Could not add tab.', success: 'Added tab.' },
  delete: { failure: 'Could not delete tab.', success: 'Deleted tab.' },
  copy: { failure: 'Could not copy tab.', success: 'Copied tab.' },
  paste: { failure: 'Could not paste tab.', success: 'Pasted tab.' },
} as const;

function validationFailure(
  reason: 'source-conflict' | 'empty-clipboard',
): MutationFailure | { readonly ok: false; readonly reason: 'empty-clipboard' } {
  return { ok: false, reason };
}

function invalidIndexFailure(): MutationFailure {
  return { ok: false, reason: 'operation-failed', code: 'invalid-tab-index' };
}

function reportTypedFailure(
  action: TabAction,
  block: TabsBlock,
  index: number,
  failure: object,
): void {
  new Notice(messages[action].failure);
  logError(messages[action].failure.slice(0, -1), {
    action,
    sourcePath: block.sourcePath,
    index,
    failure,
  });
}

function reportUnexpectedFailure(
  action: TabAction,
  block: TabsBlock,
  index: number,
  error: unknown,
): void {
  new Notice(messages[action].failure);
  logError(messages[action].failure.slice(0, -1), {
    action,
    sourcePath: block.sourcePath,
    index,
    error: formatError(error),
  });
}

function reportSuccess(action: TabAction, settings: TabbedSettings): void {
  if (settings.showSuccessNotices) {
    new Notice(messages[action].success);
  }
}

export function addDefaultTab(block: TabsBlock, getSettings: () => TabbedSettings): void {
  let index = block.document.tabs.length;
  try {
    const locator = block.locator;
    const document = block.document;
    index = document.tabs.length;
    if (locator === null) {
      reportTypedFailure('add', block, index, validationFailure('source-conflict'));
      return;
    }
    const settings = getSettings();
    const result = replaceLocatedBlock(locator, (current) =>
      addTab(
        current,
        { title: settings.defaultTitle, content: settings.defaultContent },
        current.tabs.length,
      ),
    );
    if (!result.ok) {
      reportTypedFailure('add', block, index, result);
      return;
    }
    reportSuccess('add', settings);
  } catch (error) {
    reportUnexpectedFailure('add', block, index, error);
  }
}

function deleteClickedTab(
  block: TabsBlock,
  index: number,
  getSettings: () => TabbedSettings,
): void {
  try {
    const locator = block.locator;
    if (locator === null) {
      reportTypedFailure('delete', block, index, validationFailure('source-conflict'));
      return;
    }
    const result = replaceLocatedBlock(locator, (document) => deleteTab(document, index));
    if (!result.ok) {
      reportTypedFailure('delete', block, index, result);
      return;
    }
    reportSuccess('delete', getSettings());
  } catch (error) {
    reportUnexpectedFailure('delete', block, index, error);
  }
}

async function copyTab(
  block: TabsBlock,
  index: number,
  getSettings: () => TabbedSettings,
): Promise<void> {
  try {
    const located = block.locator?.locate();
    if (located === null || located === undefined) {
      reportTypedFailure('copy', block, index, validationFailure('source-conflict'));
      return;
    }
    const document = located.block.document;
    const tab = document.tabs[index];
    if (tab === undefined) {
      reportTypedFailure('copy', block, index, invalidIndexFailure());
      return;
    }
    await navigator.clipboard.writeText(
      `${document.syntax.separator}${tab.title}${document.preferredLineEnding}${tab.content}`,
    );
    reportSuccess('copy', getSettings());
  } catch (error) {
    reportUnexpectedFailure('copy', block, index, error);
  }
}

function pastedDraft(text: string, documentSeparator: string, defaultTitle: string): TabDraft {
  if (!text.startsWith(documentSeparator)) {
    return { title: defaultTitle, content: text };
  }
  const fragment = text.slice(documentSeparator.length);
  const lineFeed = fragment.indexOf('\n');
  if (lineFeed === -1) {
    return { title: fragment, content: '' };
  }
  const rawTitle = fragment.slice(0, lineFeed);
  return {
    title: rawTitle.endsWith('\r') ? rawTitle.slice(0, -1) : rawTitle,
    content: fragment.slice(lineFeed + 1),
  };
}

async function pasteTab(
  block: TabsBlock,
  index: number,
  getSettings: () => TabbedSettings,
): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (text.length === 0) {
      reportTypedFailure('paste', block, index, validationFailure('empty-clipboard'));
      return;
    }
    const locator = block.locator;
    const located = locator?.locate();
    if (locator === null || located === null || located === undefined) {
      reportTypedFailure('paste', block, index, validationFailure('source-conflict'));
      return;
    }
    const settings = getSettings();
    const draft = pastedDraft(text, located.block.document.syntax.separator, settings.defaultTitle);
    const result = replaceLocatedBlock(locator, (document) =>
      addTab(document, draft, document.tabs.length),
    );
    if (!result.ok) {
      reportTypedFailure('paste', block, index, result);
      return;
    }
    reportSuccess('paste', settings);
  } catch (error) {
    reportUnexpectedFailure('paste', block, index, error);
  }
}

export function showTabMenu({ block, index, event, getSettings }: TabMenuRequest): void {
  if (block.locator === null || block.document.tabs[index] === undefined) {
    return;
  }

  const owner = block.addChild(new Component());
  let closed = false;
  try {
    const menu = new Menu();
    owner.register(() => {
      if (closed) {
        return;
      }
      closed = true;
      menu.close();
    });
    menu.onHide(() => {
      if (closed) {
        return;
      }
      closed = true;
      block.removeChild(owner);
    });
    menu.addItem((menuItem) => {
      menuItem.setTitle('Add tab').onClick(() => {
        addDefaultTab(block, getSettings);
      });
    });
    menu.addItem((menuItem) => {
      menuItem.setTitle('Delete tab').onClick(() => {
        deleteClickedTab(block, index, getSettings);
      });
    });
    menu.addItem((menuItem) => {
      menuItem.setTitle('Copy tab').onClick(() => copyTab(block, index, getSettings));
    });
    menu.addItem((menuItem) => {
      menuItem.setTitle('Paste tab').onClick(() => pasteTab(block, index, getSettings));
    });
    menu.showAtMouseEvent(event);
  } catch (error) {
    block.removeChild(owner);
    new Notice('Could not open tab menu.');
    logError('Could not open tab menu', {
      action: 'open-menu',
      sourcePath: block.sourcePath,
      index,
      error: formatError(error),
    });
  }
}
