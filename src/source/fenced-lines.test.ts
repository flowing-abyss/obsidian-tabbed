import { describe, expect, it } from 'vitest';
import { isClosingFence, openingFence, scanLines } from './fenced-lines.js';

describe('openingFence', () => {
  it.each([
    ['```js', { marker: '`', length: 3 }],
    ['   ~~~~ anything', { marker: '~', length: 4 }],
    ['    ```', null],
    ['text ```', null],
  ] as const)('recognizes established opener %s', (line, expected) => {
    expect(openingFence(line)).toEqual(expected);
  });
});

describe('isClosingFence', () => {
  it.each([
    ['```', true],
    ['````   ', true],
    ['``', false],
    ['~~~', false],
    ['```\t', false],
  ] as const)('recognizes established closer %s', (line, expected) => {
    expect(isClosingFence(line, { marker: '`', length: 3 })).toBe(expected);
  });
});

describe('scanLines', () => {
  it('preserves exact ranges across CRLF and mixed line endings', () => {
    expect(scanLines('one\r\ntwo\nthree\r\nfour')).toStrictEqual([
      { from: 0, contentTo: 3, to: 5 },
      { from: 5, contentTo: 8, to: 9 },
      { from: 9, contentTo: 14, to: 16 },
      { from: 16, contentTo: 20, to: 20 },
    ]);
  });
});
