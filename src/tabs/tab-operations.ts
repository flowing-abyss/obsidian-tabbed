import type {
  ExplicitTab,
  ParsedTabsDocument,
  TabDraft,
  TabOperationResult,
  VirtualTab,
} from './tab-model.js';
import { parseTabsSourceWithSyntax } from './tab-parser-internal.js';

function isIndex(value: number, maximum: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= maximum;
}

function hasLineEnding(value: string): boolean {
  return value.endsWith('\n');
}

function validTitle(title: string): boolean {
  return !/[\r\n]/.test(title);
}

function success(source: string, document: ParsedTabsDocument): TabOperationResult {
  return { ok: true, document: parseTabsSourceWithSyntax(source, document.syntax) };
}

function renderTab(tab: TabDraft, document: ParsedTabsDocument): string {
  return `${document.syntax.separator}${tab.title}${document.preferredLineEnding}${tab.content}`;
}

function virtualTab(document: ParsedTabsDocument): VirtualTab {
  const tab = document.tabs[0];
  if (tab?.kind !== 'virtual') {
    throw new Error('Expected a virtual tab');
  }
  return tab;
}

function materializeVirtual(document: ParsedTabsDocument): ParsedTabsDocument {
  const tab = virtualTab(document);
  return parseTabsSourceWithSyntax(
    renderTab({ title: tab.title, content: tab.content }, document),
    document.syntax,
  );
}

function explicitTabs(document: ParsedTabsDocument): readonly ExplicitTab[] {
  if (document.tabs.some((tab) => tab.kind !== 'explicit')) {
    throw new Error('Expected explicit tabs');
  }
  return document.tabs as readonly ExplicitTab[];
}

function addExplicitTab(
  document: ParsedTabsDocument,
  tab: TabDraft,
  atIndex: number,
): TabOperationResult {
  const tabs = explicitTabs(document);
  const insertion = renderTab(tab, document);
  if (atIndex === tabs.length) {
    const separator = hasLineEnding(document.source) ? '' : document.preferredLineEnding;
    return success(`${document.source}${separator}${insertion}`, document);
  }
  const target = tabs[atIndex];
  if (target === undefined) {
    throw new Error('Expected a tab at the insertion index');
  }
  const trailingLineEnding = hasLineEnding(insertion) ? '' : document.preferredLineEnding;
  return success(
    `${document.source.slice(0, target.range.from)}${insertion}${trailingLineEnding}${document.source.slice(target.range.from)}`,
    document,
  );
}

export function addTab(
  document: ParsedTabsDocument,
  tab: TabDraft = {
    title: document.syntax.defaultTitle,
    content: document.syntax.defaultContent,
  },
  atIndex: number = document.tabs.length,
): TabOperationResult {
  if (!isIndex(atIndex, document.tabs.length)) {
    return { ok: false, code: 'invalid-insertion-index', index: atIndex };
  }
  if (!validTitle(tab.title)) {
    return { ok: false, code: 'invalid-title' };
  }
  if (document.tabs[0]?.kind === 'virtual') {
    return addTab(materializeVirtual(document), tab, atIndex);
  }
  return addExplicitTab(document, tab, atIndex);
}

export function deleteTab(document: ParsedTabsDocument, index: number): TabOperationResult {
  if (!isIndex(index, document.tabs.length - 1)) {
    return { ok: false, code: 'invalid-tab-index', index };
  }
  if (document.tabs[0]?.kind === 'virtual') {
    return success('', document);
  }

  const tab = explicitTabs(document)[index];
  if (tab === undefined) {
    throw new Error('Expected a tab at the deletion index');
  }
  return success(
    `${document.source.slice(0, tab.range.from)}${document.source.slice(tab.range.to)}`,
    document,
  );
}

export function replaceTab(
  document: ParsedTabsDocument,
  index: number,
  replacement: TabDraft,
): TabOperationResult {
  if (!isIndex(index, document.tabs.length - 1)) {
    return { ok: false, code: 'invalid-tab-index', index };
  }
  if (!validTitle(replacement.title)) {
    return { ok: false, code: 'invalid-title' };
  }
  if (document.tabs[0]?.kind === 'virtual') {
    return success(renderTab(replacement, document), document);
  }

  const tabs = explicitTabs(document);
  const tab = tabs[index];
  if (tab === undefined) {
    throw new Error('Expected a tab at the replacement index');
  }
  const headerSuffix = document.source.slice(tab.titleRange.to, tab.headerRange.to);
  const requiredHeaderEnding =
    headerSuffix.length === 0 && replacement.content.length > 0 ? document.preferredLineEnding : '';
  const followingTab = tabs[index + 1];
  const requiredContentEnding =
    followingTab !== undefined && !hasLineEnding(replacement.content)
      ? document.preferredLineEnding
      : '';
  return success(
    `${document.source.slice(0, tab.titleRange.from)}${replacement.title}${headerSuffix}${requiredHeaderEnding}${replacement.content}${requiredContentEnding}${document.source.slice(tab.contentRange.to)}`,
    document,
  );
}

export function moveTab(
  document: ParsedTabsDocument,
  fromIndex: number,
  toIndex: number,
): TabOperationResult {
  if (!isIndex(fromIndex, document.tabs.length - 1)) {
    return { ok: false, code: 'invalid-tab-index', index: fromIndex };
  }
  if (!isIndex(toIndex, document.tabs.length - 1)) {
    return { ok: false, code: 'invalid-tab-index', index: toIndex };
  }
  if (fromIndex === toIndex) {
    return { ok: true, document };
  }
  if (document.tabs[0]?.kind === 'virtual') {
    return { ok: true, document };
  }

  return success(moveExplicitSource(document, fromIndex, toIndex), document);
}

function moveExplicitSource(
  document: ParsedTabsDocument,
  fromIndex: number,
  toIndex: number,
): string {
  const tabs = explicitTabs(document);
  const moved = tabs[fromIndex];
  const first = tabs[0];
  if (moved === undefined || first === undefined) {
    throw new Error('Expected explicit tabs to move');
  }
  const remaining = tabs.filter((_, index) => index !== fromIndex);
  remaining.splice(toIndex, 0, moved);
  const preamble = document.source.slice(0, first.range.from);
  let source = preamble;
  for (const tab of remaining) {
    if (source.length > 0 && !hasLineEnding(source)) {
      source += document.preferredLineEnding;
    }
    source += document.source.slice(tab.range.from, tab.range.to);
  }
  return source;
}
