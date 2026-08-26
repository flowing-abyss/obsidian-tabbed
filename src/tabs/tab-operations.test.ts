import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings.js';
import type { ParsedTabsDocument, TabOperationResult } from './tab-model.js';
import { addTab, deleteTab, moveTab, replaceTab } from './tab-operations.js';
import { parseTabsSource } from './tab-parser.js';

function successfulDocument(result: TabOperationResult): ParsedTabsDocument {
  if (!result.ok) {
    throw new Error(`Expected a successful operation, received ${result.code}`);
  }
  return result.document;
}

describe('addTab', () => {
  it('adds the snapshot defaults at the end without mutating the input document', () => {
    const document = parseTabsSource('top\ntab: A\none\n', DEFAULT_SETTINGS);
    const sourceBefore = document.source;
    const tabsBefore = document.tabs;

    const result = addTab(document);

    expect(successfulDocument(result).source).toBe(
      'top\ntab: A\none\ntab: New tab\nNew tab content',
    );
    expect(document.source).toBe(sourceBefore);
    expect(document.tabs).toBe(tabsBefore);
  });

  it('materializes a virtual tab before inserting at an explicit slot', () => {
    const result = addTab(
      parseTabsSource('', DEFAULT_SETTINGS),
      { title: 'Second', content: 'two' },
      0,
    );

    expect(successfulDocument(result).source).toBe(
      'tab: Second\ntwo\ntab: New tab\nNew tab content',
    );
    expect(successfulDocument(result).tabs.map((tab) => [tab.title, tab.content])).toStrictEqual([
      ['Second', 'two\n'],
      ['New tab', 'New tab content'],
    ]);
  });

  it('uses the destination document syntax when adding copied parsed text', () => {
    const copied = parseTabsSource('tab: Copied\ncopy body', DEFAULT_SETTINGS).tabs[0];
    if (copied === undefined) {
      throw new Error('Expected a source tab');
    }
    const target = parseTabsSource(':: Target\ntarget body', {
      ...DEFAULT_SETTINGS,
      separator: ':: ',
    });

    const result = addTab(target, { title: copied.title, content: copied.content });

    expect(successfulDocument(result).source).toBe(':: Target\ntarget body\n:: Copied\ncopy body');
  });

  it('materializes missing-separator source before appending a tab', () => {
    const result = addTab(parseTabsSource('legacy\r\nbytes', DEFAULT_SETTINGS), {
      title: 'Added',
      content: 'two',
    });

    expect(successfulDocument(result).source).toBe(
      'tab: New tab\r\nlegacy\r\nbytes\r\ntab: Added\r\ntwo',
    );
  });

  it.each([Number.NaN, -1, 2.5, 3])('rejects invalid insertion index %s', (index) => {
    const document = parseTabsSource('tab: A', DEFAULT_SETTINGS);

    expect(addTab(document, undefined, index)).toStrictEqual({
      ok: false,
      code: 'invalid-insertion-index',
      index,
    });
    expect(document.source).toBe('tab: A');
  });
});

describe('deleteTab', () => {
  it('removes an explicit sole tab and reparses remaining preamble as virtual content', () => {
    const document = parseTabsSource('top\nunknown\ntab: A\nbody', DEFAULT_SETTINGS);

    const result = deleteTab(document, 0);

    const updated = successfulDocument(result);
    expect(updated.source).toBe('top\nunknown\n');
    expect(updated.preamble).toBe('');
    expect(updated.tabs[0]).toMatchObject({
      kind: 'virtual',
      reason: 'missing-separator',
      content: 'top\nunknown\n',
    });
  });

  it('turns deletion of a virtual sole tab into an empty parsed document', () => {
    const result = deleteTab(parseTabsSource('ordinary text', DEFAULT_SETTINGS), 0);

    const updated = successfulDocument(result);
    expect(updated.source).toBe('');
    expect(updated.tabs[0]).toMatchObject({ kind: 'virtual', reason: 'empty' });
  });

  it.each([Number.POSITIVE_INFINITY, -1, 1, 1.2])('rejects invalid tab index %s', (index) => {
    const document = parseTabsSource('tab: A', DEFAULT_SETTINGS);

    expect(deleteTab(document, index)).toStrictEqual({
      ok: false,
      code: 'invalid-tab-index',
      index,
    });
    expect(document.source).toBe('tab: A');
  });
});

describe('replaceTab', () => {
  it('materializes a virtual document as exactly the replacement', () => {
    const result = replaceTab(parseTabsSource('legacy content', DEFAULT_SETTINGS), 0, {
      title: 'New',
      content: 'replacement',
    });

    expect(successfulDocument(result).source).toBe('tab: New\nreplacement');
  });

  it('rejects a replacement title containing a line ending without mutating input', () => {
    const document = parseTabsSource('tab: A\nbody', DEFAULT_SETTINGS);

    expect(replaceTab(document, 0, { title: 'bad\ntitle', content: 'changed' })).toStrictEqual({
      ok: false,
      code: 'invalid-title',
    });
    expect(document.source).toBe('tab: A\nbody');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5])(
    'rejects non-finite or non-integer replacement index %s',
    (index) => {
      const document = parseTabsSource('tab: A', DEFAULT_SETTINGS);

      expect(replaceTab(document, index, { title: 'B', content: 'body' })).toStrictEqual({
        ok: false,
        code: 'invalid-tab-index',
        index,
      });
    },
  );
});

describe('moveTab', () => {
  it('reorders same-block explicit tab ranges', () => {
    const result = moveTab(
      parseTabsSource('tab: A\na\ntab: B\nb\ntab: C\nc', DEFAULT_SETTINGS),
      1,
      0,
    );

    expect(successfulDocument(result).source).toBe('tab: B\nb\ntab: A\na\ntab: C\nc');
  });

  it('inserts a line ending when a final tab without one moves before another header', () => {
    const result = moveTab(parseTabsSource('tab: A\na\ntab: B\nb', DEFAULT_SETTINGS), 1, 0);

    expect(successfulDocument(result).source).toBe('tab: B\nb\ntab: A\na\n');
  });

  it.each([
    [0, 1, 'tab: B\nb\ntab: A\na\ntab: C\nc'],
    [1, 2, 'tab: A\na\ntab: C\nc\ntab: B\nb\n'],
    [2, 0, 'tab: C\nc\ntab: A\na\ntab: B\nb\n'],
  ] as const)(
    'moves first, middle, and last tabs across a missing-final-newline boundary (%i to %i)',
    (fromIndex, toIndex, expected) => {
      const result = moveTab(
        parseTabsSource('tab: A\na\ntab: B\nb\ntab: C\nc', DEFAULT_SETTINGS),
        fromIndex,
        toIndex,
      );

      expect(successfulDocument(result).source).toBe(expected);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5])(
    'rejects non-finite or non-integer source move index %s',
    (index) => {
      const document = parseTabsSource('tab: A\ntab: B', DEFAULT_SETTINGS);

      expect(moveTab(document, index, 0)).toStrictEqual({
        ok: false,
        code: 'invalid-tab-index',
        index,
      });
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5])(
    'rejects non-finite or non-integer destination move index %s',
    (index) => {
      const document = parseTabsSource('tab: A\ntab: B', DEFAULT_SETTINGS);

      expect(moveTab(document, 0, index)).toStrictEqual({
        ok: false,
        code: 'invalid-tab-index',
        index,
      });
    },
  );

  it('returns the same document for a valid no-op move', () => {
    const document = parseTabsSource('tab: A', DEFAULT_SETTINGS);

    expect(moveTab(document, 0, 0)).toStrictEqual({ ok: true, document });
  });
});
