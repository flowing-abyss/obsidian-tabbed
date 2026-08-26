import type { EditorPosition, Editor as ObsidianEditor } from 'obsidian';
import { Editor } from 'obsidian-test-mocks/obsidian';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings.js';
import { addTab, deleteTab, replaceTab } from '../tabs/tab-operations.js';
import { SourceLocator } from './source-locator.js';
import { moveBetweenBlocks, replaceLocatedBlock } from './source-mutations.js';

const firstBlock = ['```tabs', 'tab: A', 'alpha', 'tab: B', 'beta', '```'].join('\n');
const secondBlock = ['~~~tabs', 'tab: X', 'target', '~~~'].join('\n');

class RealisticEditor extends Editor {
  constructor(value: string) {
    super();
    this.setValue(value);
  }

  override getLine(line: number): string {
    return this.getValue().split(/\r?\n/)[line] ?? '';
  }

  override lineCount(): number {
    return this.getValue().split(/\r?\n/).length;
  }

  override offsetToPos(offset: number): EditorPosition {
    const value = this.getValue();
    const target = Math.max(0, Math.min(offset, value.length));
    let line = 0;
    let lineStart = 0;
    for (let index = 0; index < target; index += 1) {
      if (value[index] === '\n') {
        line += 1;
        lineStart = index + 1;
      }
    }
    return { line, ch: Math.min(target - lineStart, this.getLine(line).length) };
  }

  override posToOffset(position: EditorPosition): number {
    const value = this.getValue();
    let lineStart = 0;
    for (let line = 0; line < position.line; line += 1) {
      const newline = value.indexOf('\n', lineStart);
      if (newline === -1) {
        return value.length;
      }
      lineStart = newline + 1;
    }
    return lineStart + Math.min(Math.max(position.ch, 0), this.getLine(position.line).length);
  }

  asEditor(): ObsidianEditor {
    return this.asOriginalType__();
  }
}

function locatorAt(editor: RealisticEditor, block: string, fromOffset = 0): SourceLocator {
  const offset = editor.getValue().indexOf(block, fromOffset);
  if (offset === -1) {
    throw new Error('Expected block source in editor');
  }
  const from = editor.offsetToPos(offset);
  const to = editor.offsetToPos(offset + block.length);
  const locator = SourceLocator.fromSection(
    editor.asEditor(),
    { text: block, lineStart: from.line, lineEnd: to.line },
    DEFAULT_SETTINGS,
  );
  if (locator === null) {
    throw new Error('Expected a source locator');
  }
  return locator;
}

describe('replaceLocatedBlock', () => {
  it.each([
    [
      'add',
      (document: Parameters<typeof addTab>[0]) =>
        addTab(document, { title: 'C', content: 'gamma' }),
      ['```tabs', 'tab: A', 'alpha', 'tab: B', 'beta', 'tab: C', 'gamma', '```'].join('\n'),
    ],
    [
      'delete',
      (document: Parameters<typeof deleteTab>[0]) => deleteTab(document, 0),
      ['```tabs', 'tab: B', 'beta', '```'].join('\n'),
    ],
    [
      'edit',
      (document: Parameters<typeof replaceTab>[0]) =>
        replaceTab(document, 1, { title: 'Renamed', content: 'changed' }),
      ['```tabs', 'tab: A', 'alpha', 'tab: Renamed', 'changed', '```'].join('\n'),
    ],
  ] as const)(
    'applies a pure %s operation with one public transaction',
    (_name, transform, wanted) => {
      const editor = new RealisticEditor(`before\n${firstBlock}\nafter`);
      const locator = locatorAt(editor, firstBlock);
      const transaction = vi.spyOn(editor, 'transaction');

      const result = replaceLocatedBlock(locator, transform);

      expect(result).toMatchObject({ ok: true, located: { snapshot: wanted } });
      expect(editor.getValue()).toBe(`before\n${wanted}\nafter`);
      expect(transaction).toHaveBeenCalledExactlyOnceWith(
        {
          changes: [
            {
              from: { line: 1, ch: 0 },
              to: { line: 6, ch: 3 },
              text: wanted,
            },
          ],
        },
        'tabbed',
      );
    },
  );

  it('accepts an unchanged serialization without opening a transaction', () => {
    const editor = new RealisticEditor(`old-before\n${firstBlock}\nold-after`);
    const locator = locatorAt(editor, firstBlock);
    editor.setValue(`new-before\n${firstBlock}\nnew-after`);
    const transaction = vi.spyOn(editor, 'transaction');

    const result = replaceLocatedBlock(locator, (document) => ({ ok: true, document }));

    expect(result).toMatchObject({ ok: true, located: { snapshot: firstBlock } });
    expect(editor.getValue()).toBe(`new-before\n${firstBlock}\nnew-after`);
    expect(transaction).not.toHaveBeenCalled();

    editor.setValue(`old-before\n${firstBlock}\nold-after\nnew-before\n${firstBlock}\nnew-after`);
    expect(locator.locate()?.range.from).toStrictEqual({ line: 9, ch: 0 });
  });

  it('uses the accepted snapshot and range for repeated autosaves', () => {
    const editor = new RealisticEditor(`before\n${firstBlock}\nafter`);
    const locator = locatorAt(editor, firstBlock);
    const transaction = vi.spyOn(editor, 'transaction');

    const first = replaceLocatedBlock(locator, (document) =>
      replaceTab(document, 0, { title: 'A', content: 'first save' }),
    );
    const second = replaceLocatedBlock(locator, (document) =>
      replaceTab(document, 0, { title: 'A', content: 'second save' }),
    );

    expect(first).toMatchObject({ ok: true });
    const secondSnapshot = ['```tabs', 'tab: A', 'second save', 'tab: B', 'beta', '```'].join('\n');
    expect(second).toMatchObject({
      ok: true,
      located: {
        snapshot: secondSnapshot,
        range: { from: { line: 1, ch: 0 }, to: { line: 6, ch: 3 } },
      },
    });
    expect(editor.getValue()).toContain('second save');
    expect(editor.getValue()).not.toContain('first save');
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('returns a typed operation failure without mutating source', () => {
    const editor = new RealisticEditor(firstBlock);
    const locator = locatorAt(editor, firstBlock);
    const transaction = vi.spyOn(editor, 'transaction');

    expect(replaceLocatedBlock(locator, (document) => deleteTab(document, 9))).toStrictEqual({
      ok: false,
      reason: 'operation-failed',
      code: 'invalid-tab-index',
    });
    expect(editor.getValue()).toBe(firstBlock);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('mutates the relocated block after unrelated lines are inserted above it', () => {
    const editor = new RealisticEditor(`before\n${firstBlock}\nafter`);
    const locator = locatorAt(editor, firstBlock);
    editor.setValue(`inserted\nbefore\n${firstBlock}\nafter`);
    const transaction = vi.spyOn(editor, 'transaction');

    const result = replaceLocatedBlock(locator, (document) => deleteTab(document, 0));

    const wanted = ['```tabs', 'tab: B', 'beta', '```'].join('\n');
    expect(result).toMatchObject({
      ok: true,
      located: { snapshot: wanted, range: { from: { line: 2, ch: 0 } } },
    });
    expect(editor.getValue()).toBe(`inserted\nbefore\n${wanted}\nafter`);
    expect(transaction).toHaveBeenCalledExactlyOnceWith(
      {
        changes: [
          expect.objectContaining({
            from: { line: 2, ch: 0 },
            to: { line: 7, ch: 3 },
            text: wanted,
          }),
        ],
      },
      'tabbed',
    );
  });

  it('preserves CRLF and whole-line ranges when final edited content has no EOL', () => {
    const block = firstBlock.replaceAll('\n', '\r\n');
    const editor = new RealisticEditor(`before\r\n${block}\r\nafter`);
    const locator = locatorAt(editor, block);
    const transaction = vi.spyOn(editor, 'transaction');

    const result = replaceLocatedBlock(locator, (document) =>
      replaceTab(document, 1, { title: 'B', content: 'changed' }),
    );

    const wanted = ['```tabs', 'tab: A', 'alpha', 'tab: B', 'changed', '```'].join('\r\n');
    expect(result).toMatchObject({
      ok: true,
      located: {
        snapshot: wanted,
        range: { from: { line: 1, ch: 0 }, to: { line: 6, ch: 3 } },
      },
    });
    expect(editor.getValue()).toBe(`before\r\n${wanted}\r\nafter`);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('returns source-conflict when the located source was deleted', () => {
    const editor = new RealisticEditor(firstBlock);
    const locator = locatorAt(editor, firstBlock);
    editor.setValue('deleted');
    const transaction = vi.spyOn(editor, 'transaction');

    expect(replaceLocatedBlock(locator, (document) => deleteTab(document, 0))).toStrictEqual({
      ok: false,
      reason: 'source-conflict',
    });
    expect(editor.getValue()).toBe('deleted');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('types a thrown transaction and leaves the editor unchanged', () => {
    const editor = new RealisticEditor(firstBlock);
    const locator = locatorAt(editor, firstBlock);
    const error = new Error('transaction rejected');
    vi.spyOn(editor, 'transaction').mockImplementationOnce(() => {
      throw error;
    });

    expect(replaceLocatedBlock(locator, (document) => deleteTab(document, 0))).toStrictEqual({
      ok: false,
      reason: 'transaction-failed',
      error,
    });
    expect(editor.getValue()).toBe(firstBlock);
  });
});

describe('moveBetweenBlocks', () => {
  it('delegates same-block movement through one replacement transaction', () => {
    const editor = new RealisticEditor(firstBlock);
    const locator = locatorAt(editor, firstBlock);
    const transaction = vi.spyOn(editor, 'transaction');

    const result = moveBetweenBlocks(locator, locator, 1, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`Expected success, received ${result.reason}`);
    }
    expect(result.from).toBe(result.to);
    expect(result.from.snapshot).toBe(
      ['```tabs', 'tab: B', 'beta', 'tab: A', 'alpha', '```'].join('\n'),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('moves exact effective tab text across blocks in one later-first transaction', () => {
    const editor = new RealisticEditor(`start\n${firstBlock}\nmiddle\n${secondBlock}\nend`);
    const from = locatorAt(editor, firstBlock);
    const to = locatorAt(editor, secondBlock);
    const transaction = vi.spyOn(editor, 'transaction');

    const result = moveBetweenBlocks(from, to, 0, 1);

    const wantedFrom = ['```tabs', 'tab: B', 'beta', '```'].join('\n');
    const wantedTo = ['~~~tabs', 'tab: X', 'target', 'tab: A', 'alpha', '~~~'].join('\n');
    expect(result).toMatchObject({
      ok: true,
      from: { snapshot: wantedFrom, range: { from: { line: 1, ch: 0 } } },
      to: { snapshot: wantedTo, block: { document: { tabs: [{ title: 'X' }, { title: 'A' }] } } },
    });
    expect(editor.getValue()).toBe(`start\n${wantedFrom}\nmiddle\n${wantedTo}\nend`);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(
      {
        changes: [
          expect.objectContaining({ from: { line: 8, ch: 0 }, text: wantedTo }),
          expect.objectContaining({ from: { line: 1, ch: 0 }, text: wantedFrom }),
        ],
      },
      'tabbed',
    );
    expect(from.locate()).toMatchObject({ snapshot: wantedFrom });
    expect(to.locate()).toMatchObject({ snapshot: wantedTo });

    editor.setValue(
      `start\n${wantedFrom}\nmiddle\n${wantedTo}\nend\nother-before\n${wantedFrom}\nother-middle\n${wantedTo}\nother-end`,
    );
    expect(from.locate()?.range.from).toStrictEqual({ line: 1, ch: 0 });
    expect(to.locate()?.range.from).toStrictEqual({ line: 6, ch: 0 });
  });

  it('moves a virtual source tab effective defaults atomically into an explicit target', () => {
    const virtualBlock = ['```tabs', '```'].join('\n');
    const editor = new RealisticEditor(`start\n${virtualBlock}\nbetween\n${secondBlock}\nend`);
    const from = locatorAt(editor, virtualBlock);
    const to = locatorAt(editor, secondBlock);
    const transaction = vi.spyOn(editor, 'transaction');

    const result = moveBetweenBlocks(from, to, 0, 1);

    const wantedTo = ['~~~tabs', 'tab: X', 'target', 'tab: New tab', 'New tab content', '~~~'].join(
      '\n',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`Expected success, received ${result.reason}`);
    }
    expect(editor.getValue()).toBe(`start\n${virtualBlock}\nbetween\n${wantedTo}\nend`);
    expect(transaction).toHaveBeenCalledExactlyOnceWith(
      {
        changes: [
          expect.objectContaining({ from: { line: 4, ch: 0 }, text: wantedTo }),
          expect.objectContaining({ from: { line: 1, ch: 0 }, text: virtualBlock }),
        ],
      },
      'tabbed',
    );
    expect(result).toMatchObject({
      ok: true,
      from: {
        snapshot: virtualBlock,
        range: { from: { line: 1, ch: 0 }, to: { line: 2, ch: 3 } },
        block: {
          document: {
            tabs: [
              {
                kind: 'virtual',
                reason: 'empty',
                title: 'New tab',
                content: 'New tab content',
              },
            ],
          },
        },
      },
      to: {
        snapshot: wantedTo,
        range: { from: { line: 4, ch: 0 }, to: { line: 9, ch: 3 } },
        block: {
          document: {
            tabs: [
              { kind: 'explicit', title: 'X', content: 'target\n' },
              { kind: 'explicit', title: 'New tab', content: 'New tab content\n' },
            ],
          },
        },
      },
    });
    expect(from.locate()).toMatchObject({ snapshot: virtualBlock, block: result.from.block });
    expect(to.locate()).toMatchObject({ snapshot: wantedTo, block: result.to.block });
  });

  it('keeps reverse-order ranges, anchors, and repeated mutations aligned after both deltas', () => {
    const editor = new RealisticEditor(`${secondBlock}\nbetween\n${firstBlock}`);
    const to = locatorAt(editor, secondBlock);
    const from = locatorAt(editor, firstBlock);
    const transaction = vi.spyOn(editor, 'transaction');

    const result = moveBetweenBlocks(from, to, 1, 0);

    const wantedTo = ['~~~tabs', 'tab: B', 'beta', 'tab: X', 'target', '~~~'].join('\n');
    const wantedFrom = ['```tabs', 'tab: A', 'alpha', '```'].join('\n');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`Expected success, received ${result.reason}`);
    }
    const changes = transaction.mock.calls[0]?.[0].changes;
    expect(changes?.map((change) => change.from.line)).toStrictEqual([5, 0]);
    expect(editor.getValue()).toBe(`${wantedTo}\nbetween\n${wantedFrom}`);
    expect(result).toMatchObject({
      ok: true,
      from: {
        snapshot: wantedFrom,
        range: { from: { line: 7, ch: 0 }, to: { line: 10, ch: 3 } },
        block: { document: { tabs: [{ title: 'A', content: 'alpha\n' }] } },
      },
      to: {
        snapshot: wantedTo,
        range: { from: { line: 0, ch: 0 }, to: { line: 5, ch: 3 } },
        block: {
          document: {
            tabs: [
              { title: 'B', content: 'beta\n' },
              { title: 'X', content: 'target\n' },
            ],
          },
        },
      },
    });
    expect(from.locate()).toMatchObject({ snapshot: wantedFrom, range: result.from.range });
    expect(to.locate()).toMatchObject({ snapshot: wantedTo, range: result.to.range });

    editor.setValue(
      `${wantedTo}\nbetween\n${wantedFrom}\nother-target-before\n${wantedTo}\nother-between\n${wantedFrom}\nother-after`,
    );
    expect(from.locate()?.range.from).toStrictEqual({ line: 7, ch: 0 });
    expect(to.locate()?.range.from).toStrictEqual({ line: 0, ch: 0 });

    const repeated = replaceLocatedBlock(from, (document) =>
      addTab(document, { title: 'C', content: 'gamma' }),
    );
    const mutatedFrom = ['```tabs', 'tab: A', 'alpha', 'tab: C', 'gamma', '```'].join('\n');
    expect(repeated).toMatchObject({
      ok: true,
      located: {
        snapshot: mutatedFrom,
        range: { from: { line: 7, ch: 0 }, to: { line: 12, ch: 3 } },
        block: {
          document: { tabs: [{ title: 'A', content: 'alpha\n' }, { title: 'C' }] },
        },
      },
    });
    expect(editor.getValue()).toBe(
      `${wantedTo}\nbetween\n${mutatedFrom}\nother-target-before\n${wantedTo}\nother-between\n${wantedFrom}\nother-after`,
    );
    expect(from.locate()).toMatchObject({
      snapshot: mutatedFrom,
      range: { from: { line: 7, ch: 0 }, to: { line: 12, ch: 3 } },
    });
    expect(to.locate()).toMatchObject({
      snapshot: wantedTo,
      range: { from: { line: 0, ch: 0 }, to: { line: 5, ch: 3 } },
    });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('rejects different editors, overlapping blocks, and invalid indices without transactions', () => {
    const editor = new RealisticEditor(firstBlock);
    const otherEditor = new RealisticEditor(secondBlock);
    const from = locatorAt(editor, firstBlock);
    const sameRange = locatorAt(editor, firstBlock);
    const other = locatorAt(otherEditor, secondBlock);
    const transaction = vi.spyOn(editor, 'transaction');

    expect(moveBetweenBlocks(from, other, 0, 0)).toStrictEqual({
      ok: false,
      reason: 'different-editors',
    });
    expect(moveBetweenBlocks(from, sameRange, 0, 0)).toStrictEqual({
      ok: false,
      reason: 'overlapping-blocks',
    });
    expect(transaction).not.toHaveBeenCalled();

    const combined = new RealisticEditor(`${firstBlock}\nbetween\n${secondBlock}`);
    const combinedFrom = locatorAt(combined, firstBlock);
    const combinedTo = locatorAt(combined, secondBlock);
    const combinedTransaction = vi.spyOn(combined, 'transaction');
    expect(moveBetweenBlocks(combinedFrom, combinedTo, 9, 0)).toStrictEqual({
      ok: false,
      reason: 'operation-failed',
      code: 'invalid-tab-index',
    });
    expect(moveBetweenBlocks(combinedFrom, combinedTo, 0, 2)).toStrictEqual({
      ok: false,
      reason: 'operation-failed',
      code: 'invalid-insertion-index',
    });
    expect(combinedTransaction).not.toHaveBeenCalled();
  });

  it('returns source-conflict if either distinct locator cannot resolve', () => {
    const editor = new RealisticEditor(`${firstBlock}\nbetween\n${secondBlock}`);
    const from = locatorAt(editor, firstBlock);
    const to = locatorAt(editor, secondBlock);
    editor.setValue(firstBlock);
    const transaction = vi.spyOn(editor, 'transaction');

    expect(moveBetweenBlocks(from, to, 0, 0)).toStrictEqual({
      ok: false,
      reason: 'source-conflict',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('types a thrown atomic transaction without partially moving a tab', () => {
    const original = `${firstBlock}\nbetween\n${secondBlock}`;
    const editor = new RealisticEditor(original);
    const from = locatorAt(editor, firstBlock);
    const to = locatorAt(editor, secondBlock);
    const error = new Error('atomic transaction rejected');
    vi.spyOn(editor, 'transaction').mockImplementationOnce(() => {
      throw error;
    });

    expect(moveBetweenBlocks(from, to, 0, 1)).toStrictEqual({
      ok: false,
      reason: 'transaction-failed',
      error,
    });
    expect(editor.getValue()).toBe(original);
  });
});
