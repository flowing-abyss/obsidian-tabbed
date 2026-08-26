import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings.js';
import { addTab, replaceTab } from './tab-operations.js';
import { parseFullTabsBlock, parseTabsSource } from './tab-parser.js';
import { serializeFullTabsBlock } from './tab-serializer.js';

describe('serializeFullTabsBlock', () => {
  it('round-trips an untouched tilde block byte-for-byte', () => {
    const original = ['~~~~tabs', 'top', 'tab: A', '```js', 'x', '```', '~~~~'].join('\n');
    const full = parseFullTabsBlock(original, DEFAULT_SETTINGS);

    expect(full).not.toBeNull();
    if (full === null) {
      throw new Error('Expected a valid tabs block');
    }
    expect(full.fence).toStrictEqual({ marker: '~', length: 4 });
    expect(serializeFullTabsBlock(full, full.document)).toBe(original);
  });

  it('grows both outer fences beyond an equal-or-longer marker run in edited content', () => {
    const original = ['```tabs extra  ', 'tab: A', 'x `````', '```   '].join('\n');
    const full = parseFullTabsBlock(original, DEFAULT_SETTINGS);

    expect(full).not.toBeNull();
    if (full === null) {
      throw new Error('Expected a valid tabs block');
    }
    const edited = parseTabsSource(`${full.document.source}changed`, DEFAULT_SETTINGS);

    expect(serializeFullTabsBlock(full, edited)).toBe(
      ['``````tabs extra  ', 'tab: A', 'x `````', 'changed', '``````   '].join('\n'),
    );
  });

  it('preserves outer indentation, info suffixes, and closing whitespace after an inner edit', () => {
    const original = ['  ~~~tabs metadata  ', 'tab: A', 'body', '  ~~~\t'].join('\r\n');
    const full = parseFullTabsBlock(original, DEFAULT_SETTINGS);

    expect(full).not.toBeNull();
    if (full === null) {
      throw new Error('Expected a valid tabs block');
    }
    const edited = parseTabsSource('tab: A\r\nreplaced\r\n', DEFAULT_SETTINGS);

    expect(serializeFullTabsBlock(full, edited)).toBe(
      ['  ~~~tabs metadata  ', 'tab: A', 'replaced', '  ~~~\t'].join('\r\n'),
    );
  });

  it('preserves an untouched outer final EOL exactly', () => {
    const original = '~~~tabs\r\ntab: A\r\n~~~\r\n';
    const full = parseFullTabsBlock(original, DEFAULT_SETTINGS);

    expect(full).not.toBeNull();
    if (full === null) {
      throw new Error('Expected a valid tabs block');
    }
    expect(serializeFullTabsBlock(full, full.document)).toBe('~~~tabs\r\ntab: A\r\n~~~\r\n');
  });

  it('preserves an outer trailing CRLF after replacing inner content', () => {
    const original = '~~~tabs\r\ntab: A\r\nbody\r\n~~~\r\n';
    const full = parseFullTabsBlock(original, DEFAULT_SETTINGS);

    expect(full).not.toBeNull();
    if (full === null) {
      throw new Error('Expected a valid tabs block');
    }
    const replacement = replaceTab(full.document, 0, { title: 'A', content: 'changed\r\n' });
    if (!replacement.ok) {
      throw new Error(`Expected replacement to succeed, received ${replacement.code}`);
    }

    expect(serializeFullTabsBlock(full, replacement.document)).toBe(
      '~~~tabs\r\ntab: A\r\nchanged\r\n~~~\r\n',
    );
  });

  it('inserts the preferred LF before the outer close after replacing final content', () => {
    const full = parseFullTabsBlock('~~~tabs\ntab: A\nalpha\n~~~', DEFAULT_SETTINGS);

    expect(full).not.toBeNull();
    if (full === null) {
      throw new Error('Expected a valid tabs block');
    }
    const replacement = replaceTab(full.document, 0, { title: 'A', content: 'gamma' });
    if (!replacement.ok) {
      throw new Error(`Expected replacement to succeed, received ${replacement.code}`);
    }
    const serialized = serializeFullTabsBlock(full, replacement.document);

    expect(serialized).toBe('~~~tabs\ntab: A\ngamma\n~~~');
    expect(parseFullTabsBlock(serialized, DEFAULT_SETTINGS)).not.toBeNull();
  });

  it('inserts the preferred CRLF before the outer close after adding final content', () => {
    const full = parseFullTabsBlock('~~~tabs\r\ntab: A\r\nalpha\r\n~~~', DEFAULT_SETTINGS);

    expect(full).not.toBeNull();
    if (full === null) {
      throw new Error('Expected a valid tabs block');
    }
    const addition = addTab(full.document, { title: 'B', content: 'omega' });
    if (!addition.ok) {
      throw new Error(`Expected addition to succeed, received ${addition.code}`);
    }
    const serialized = serializeFullTabsBlock(full, addition.document);

    expect(serialized).toBe('~~~tabs\r\ntab: A\r\nalpha\r\ntab: B\r\nomega\r\n~~~');
    expect(parseFullTabsBlock(serialized, DEFAULT_SETTINGS)).not.toBeNull();
  });
});
