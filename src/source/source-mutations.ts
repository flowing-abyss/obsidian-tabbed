import type { EditorChange, EditorRange } from 'obsidian';
import { DEFAULT_SETTINGS, type TabbedSettings } from '../settings.js';
import type {
  FullTabsBlock,
  ParsedTabsDocument,
  TabOperationFailure,
  TabOperationResult,
} from '../tabs/tab-model.js';
import { addTab, deleteTab, moveTab } from '../tabs/tab-operations.js';
import { parseFullTabsBlock } from '../tabs/tab-parser.js';
import { serializeFullTabsBlock } from '../tabs/tab-serializer.js';
import type { LocatedTabsBlock, SourceLocator } from './source-locator.js';

export type MutationFailure =
  | { readonly ok: false; readonly reason: 'source-conflict' }
  | {
      readonly ok: false;
      readonly reason: 'operation-failed';
      readonly code: TabOperationFailure['code'];
    }
  | { readonly ok: false; readonly reason: 'different-editors' }
  | { readonly ok: false; readonly reason: 'overlapping-blocks' }
  | { readonly ok: false; readonly reason: 'transaction-failed'; readonly error: unknown };

export type SingleMutationResult =
  { readonly ok: true; readonly located: LocatedTabsBlock } | MutationFailure;

export type MoveMutationResult =
  | {
      readonly ok: true;
      readonly from: LocatedTabsBlock;
      readonly to: LocatedTabsBlock;
    }
  | MutationFailure;

interface OffsetRange {
  readonly from: number;
  readonly to: number;
}

interface Replacement {
  readonly locator: SourceLocator;
  readonly located: LocatedTabsBlock;
  readonly text: string;
  readonly block: FullTabsBlock;
  readonly offsets: OffsetRange;
}

interface LocatedPair {
  readonly ok: true;
  readonly fromLocated: LocatedTabsBlock;
  readonly toLocated: LocatedTabsBlock;
  readonly fromOffsets: OffsetRange;
  readonly toOffsets: OffsetRange;
}

interface PreparedMove {
  readonly ok: true;
  readonly fromReplacement: Replacement;
  readonly toReplacement: Replacement;
}

interface MoveIndices {
  readonly from: number;
  readonly to: number;
}

function operationFailure(result: TabOperationFailure): MutationFailure {
  return { ok: false, reason: 'operation-failed', code: result.code };
}

function settingsFor(document: ParsedTabsDocument): TabbedSettings {
  return {
    ...DEFAULT_SETTINGS,
    separator: document.syntax.separator,
    defaultTitle: document.syntax.defaultTitle,
    defaultContent: document.syntax.defaultContent,
    titlePosition: document.syntax.defaultOptions.position,
    titleLineMode: document.syntax.defaultOptions.lineMode,
    action: document.syntax.defaultOptions.action,
  };
}

function replacementBlock(text: string, document: ParsedTabsDocument): FullTabsBlock {
  const block = parseFullTabsBlock(text, settingsFor(document));
  if (block === null) {
    throw new Error('Serialized tabs block must remain parseable');
  }
  return block;
}

function locatedAfter(text: string, range: EditorRange, block: FullTabsBlock): LocatedTabsBlock {
  return { snapshot: text, range, block };
}

export function replaceLocatedBlock(
  locator: SourceLocator,
  transform: (document: ParsedTabsDocument) => TabOperationResult,
): SingleMutationResult {
  const located = locator.locate();
  if (located === null) {
    return { ok: false, reason: 'source-conflict' };
  }
  const result = transform(located.block.document);
  if (!result.ok) {
    return operationFailure(result);
  }
  const replacement = serializeFullTabsBlock(located.block, result.document);
  if (replacement === located.snapshot) {
    locator.accept(replacement, located.range);
    return { ok: true, located };
  }
  const block = replacementBlock(replacement, result.document);
  const startOffset = locator.editor.posToOffset(located.range.from);
  try {
    locator.editor.transaction(
      { changes: [{ from: located.range.from, to: located.range.to, text: replacement }] },
      'tabbed',
    );
  } catch (error) {
    return { ok: false, reason: 'transaction-failed', error };
  }
  const range = {
    from: locator.editor.offsetToPos(startOffset),
    to: locator.editor.offsetToPos(startOffset + replacement.length),
  };
  locator.accept(replacement, range);
  return { ok: true, located: locatedAfter(replacement, range, block) };
}

function offsetRange(locator: SourceLocator, located: LocatedTabsBlock): OffsetRange {
  return {
    from: locator.editor.posToOffset(located.range.from),
    to: locator.editor.posToOffset(located.range.to),
  };
}

function overlaps(left: OffsetRange, right: OffsetRange): boolean {
  return left.from < right.to && right.from < left.to;
}

function prepareReplacement(
  locator: SourceLocator,
  located: LocatedTabsBlock,
  result: Extract<TabOperationResult, { readonly ok: true }>,
  offsets: OffsetRange,
): Replacement {
  const text = serializeFullTabsBlock(located.block, result.document);
  return {
    locator,
    located,
    text,
    block: replacementBlock(text, result.document),
    offsets,
  };
}

function editorChange(replacement: Replacement): EditorChange {
  return {
    from: replacement.located.range.from,
    to: replacement.located.range.to,
    text: replacement.text,
  };
}

function finalRange(replacement: Replacement, other: Replacement): EditorRange {
  const otherDelta = other.text.length - (other.offsets.to - other.offsets.from);
  const shift = other.offsets.from < replacement.offsets.from ? otherDelta : 0;
  const start = replacement.offsets.from + shift;
  return {
    from: replacement.locator.editor.offsetToPos(start),
    to: replacement.locator.editor.offsetToPos(start + replacement.text.length),
  };
}

function sameBlockMove(
  locator: SourceLocator,
  fromIndex: number,
  toIndex: number,
): MoveMutationResult {
  const result = replaceLocatedBlock(locator, (document) => moveTab(document, fromIndex, toIndex));
  if (!result.ok) {
    return result;
  }
  return { ok: true, from: result.located, to: result.located };
}

function locatePair(
  from: SourceLocator,
  to: SourceLocator,
  source: string,
): LocatedPair | MutationFailure {
  const fromLocated = from.locate();
  const toLocated = to.locate();
  if (fromLocated === null || toLocated === null || from.editor.getValue() !== source) {
    return { ok: false, reason: 'source-conflict' };
  }
  const fromOffsets = offsetRange(from, fromLocated);
  const toOffsets = offsetRange(to, toLocated);
  if (
    source.slice(fromOffsets.from, fromOffsets.to) !== fromLocated.snapshot ||
    source.slice(toOffsets.from, toOffsets.to) !== toLocated.snapshot
  ) {
    return { ok: false, reason: 'source-conflict' };
  }
  if (overlaps(fromOffsets, toOffsets)) {
    return { ok: false, reason: 'overlapping-blocks' };
  }
  return { ok: true, fromLocated, toLocated, fromOffsets, toOffsets };
}

function prepareMove(
  from: SourceLocator,
  to: SourceLocator,
  pair: LocatedPair,
  indices: MoveIndices,
): PreparedMove | MutationFailure {
  const deleted = deleteTab(pair.fromLocated.block.document, indices.from);
  if (!deleted.ok) {
    return operationFailure(deleted);
  }
  const sourceTab = pair.fromLocated.block.document.tabs[indices.from];
  if (sourceTab === undefined) {
    return { ok: false, reason: 'operation-failed', code: 'invalid-tab-index' };
  }
  const added = addTab(
    pair.toLocated.block.document,
    { title: sourceTab.title, content: sourceTab.content },
    indices.to,
  );
  if (!added.ok) {
    return operationFailure(added);
  }
  return {
    ok: true,
    fromReplacement: prepareReplacement(from, pair.fromLocated, deleted, pair.fromOffsets),
    toReplacement: prepareReplacement(to, pair.toLocated, added, pair.toOffsets),
  };
}

function commitMove(prepared: PreparedMove): MoveMutationResult {
  const { fromReplacement, toReplacement } = prepared;
  const replacements = [fromReplacement, toReplacement].sort(
    (left, right) => right.offsets.from - left.offsets.from,
  );
  try {
    fromReplacement.locator.editor.transaction(
      { changes: replacements.map(editorChange) },
      'tabbed',
    );
  } catch (error) {
    return { ok: false, reason: 'transaction-failed', error };
  }
  const fromRange = finalRange(fromReplacement, toReplacement);
  const toRange = finalRange(toReplacement, fromReplacement);
  fromReplacement.locator.accept(fromReplacement.text, fromRange);
  toReplacement.locator.accept(toReplacement.text, toRange);
  return {
    ok: true,
    from: locatedAfter(fromReplacement.text, fromRange, fromReplacement.block),
    to: locatedAfter(toReplacement.text, toRange, toReplacement.block),
  };
}

function crossBlockMove(
  from: SourceLocator,
  to: SourceLocator,
  fromIndex: number,
  toIndex: number,
): MoveMutationResult {
  const pair = locatePair(from, to, from.editor.getValue());
  if (!pair.ok) {
    return pair;
  }
  const prepared = prepareMove(from, to, pair, { from: fromIndex, to: toIndex });
  return prepared.ok ? commitMove(prepared) : prepared;
}

export function moveBetweenBlocks(
  from: SourceLocator,
  to: SourceLocator,
  fromIndex: number,
  toIndex: number,
): MoveMutationResult {
  if (from === to) {
    return sameBlockMove(from, fromIndex, toIndex);
  }
  if (from.editor !== to.editor) {
    return { ok: false, reason: 'different-editors' };
  }
  return crossBlockMove(from, to, fromIndex, toIndex);
}
