import { describe, expect, it } from 'vitest';
import {
  indentSelection,
  insertCallout,
  insertCodeBlock,
  insertTable,
  outdentSelection,
  toggleBold,
  toggleItalic,
  toggleOrderedList,
  toggleQuote,
  toggleStrike,
  toggleTaskList,
  toggleUnderline,
  toggleUnorderedList,
  type TextSelection,
} from './text-transforms.js';

describe('inline text transforms', () => {
  it.each([
    ['bold', toggleBold, 'before **chosen** after', { from: 9, to: 15 }],
    ['italic', toggleItalic, 'before *chosen* after', { from: 8, to: 14 }],
    ['underline', toggleUnderline, 'before <u>chosen</u> after', { from: 10, to: 16 }],
    ['strike', toggleStrike, 'before ~~chosen~~ after', { from: 9, to: 15 }],
  ] as const)(
    'wraps the selected text for %s and preserves its selection',
    (_, transform, text, selection) => {
      expect(
        transform({ text: 'before chosen after', selection: { from: 7, to: 13 } }),
      ).toStrictEqual({
        text,
        selection,
      });
    },
  );

  it('removes an existing inline wrapper without losing the inner selection', () => {
    expect(
      toggleBold({ text: 'before **chosen** after', selection: { from: 9, to: 15 } }),
    ).toStrictEqual({
      text: 'before chosen after',
      selection: { from: 7, to: 13 },
    });
  });
});

describe('line text transforms', () => {
  const selection: TextSelection = { from: 2, to: 8 };

  it.each([
    ['unordered list', toggleUnorderedList, '- alpha\n- beta', { from: 4, to: 12 }],
    ['ordered list', toggleOrderedList, '1. alpha\n2. beta', { from: 5, to: 14 }],
    ['task list', toggleTaskList, '- [ ] alpha\n- [ ] beta', { from: 8, to: 20 }],
    ['quote', toggleQuote, '> alpha\n> beta', { from: 4, to: 12 }],
  ] as const)(
    'prefixes every selected line for %s and keeps the original content selected',
    (_, transform, text, transformedSelection) => {
      expect(transform({ text: 'alpha\nbeta', selection })).toStrictEqual({
        text,
        selection: transformedSelection,
      });
    },
  );

  it('restarts ordered-list numbering at one for each invocation', () => {
    expect(
      toggleOrderedList({ text: 'prefix\nalpha\nbeta\nsuffix', selection: { from: 7, to: 17 } }),
    ).toStrictEqual({
      text: 'prefix\n1. alpha\n2. beta\nsuffix',
      selection: { from: 10, to: 23 },
    });
  });

  it('toggles a line prefix off every selected line', () => {
    expect(
      toggleTaskList({ text: '- [ ] alpha\n- [ ] beta', selection: { from: 6, to: 22 } }),
    ).toStrictEqual({
      text: 'alpha\nbeta',
      selection: { from: 0, to: 10 },
    });
  });

  it('indents and outdents complete selected lines with the configured tab size', () => {
    const indented = indentSelection(
      { text: 'alpha\n  beta\ngamma', selection: { from: 2, to: 12 } },
      4,
    );
    expect(indented).toStrictEqual({
      text: '    alpha\n      beta\ngamma',
      selection: { from: 6, to: 20 },
    });
    expect(outdentSelection(indented, 4)).toStrictEqual({
      text: 'alpha\n  beta\ngamma',
      selection: { from: 2, to: 12 },
    });
  });

  it('outdents tabs and at most the configured number of spaces', () => {
    expect(
      outdentSelection({ text: '\talpha\n  beta\n      gamma', selection: { from: 1, to: 25 } }, 4),
    ).toStrictEqual({
      text: 'alpha\nbeta\n  gamma',
      selection: { from: 0, to: 18 },
    });
  });
});

describe('block text transforms', () => {
  it('uses a longer fence than any backtick run inside the selected code', () => {
    expect(
      insertCodeBlock({ text: 'const example = ```value```;', selection: { from: 0, to: 28 } }),
    ).toStrictEqual({
      text: '````\nconst example = ```value```;\n````',
      selection: { from: 5, to: 33 },
    });
  });

  it('inserts a callout around the selection and preserves the selected content', () => {
    expect(insertCallout({ text: 'details', selection: { from: 0, to: 7 } })).toStrictEqual({
      text: '> [!note]\n> details',
      selection: { from: 12, to: 19 },
    });
  });

  it('inserts a Markdown table at an empty selection and places the cursor in the first cell', () => {
    expect(insertTable({ text: 'before\nafter', selection: { from: 7, to: 7 } })).toStrictEqual({
      text: 'before\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\nafter',
      selection: { from: 9, to: 17 },
    });
  });
});
