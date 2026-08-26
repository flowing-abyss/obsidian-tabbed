import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings.js';
import { parseFullTabsBlock, parseTabsSource } from './tab-parser.js';

describe('parseTabsSource', () => {
  it('keeps separators inside a nested backtick fence in the preceding tab', () => {
    const source = [
      'left, multi',
      'tab: One',
      'A',
      '```js',
      'tab: not a tab',
      '```',
      'tab: Two',
      'B',
    ].join('\n');

    const parsed = parseTabsSource(source, DEFAULT_SETTINGS);

    expect(parsed.options).toMatchObject({ position: 'left', lineMode: 'multi' });
    expect(parsed.tabs.map((tab) => tab.title)).toStrictEqual(['One', 'Two']);
    expect(parsed.tabs[0]?.content).toBe('A\n```js\ntab: not a tab\n```\n');
    expect(parsed.preamble).toBe('left, multi\n');
  });

  it('keeps separators inside a tilde fence in the preceding tab', () => {
    const parsed = parseTabsSource(
      ['tab: A', '~~~markdown', 'tab: nested', '~~~', 'tab: B', 'text'].join('\n'),
      DEFAULT_SETTINGS,
    );

    expect(parsed.tabs.map((tab) => ({ title: tab.title, content: tab.content }))).toStrictEqual([
      { title: 'A', content: '~~~markdown\ntab: nested\n~~~\n' },
      { title: 'B', content: 'text' },
    ]);
  });

  it('recognizes a custom separator only at a line start outside a fence', () => {
    const parsed = parseTabsSource(
      ['note :: not a header', ':: First', 'one', '```', ':: nested', '```', ':: Second'].join(
        '\n',
      ),
      { ...DEFAULT_SETTINGS, separator: ':: ' },
    );

    expect(parsed.preamble).toBe('note :: not a header\n');
    expect(parsed.tabs.map((tab) => tab.title)).toStrictEqual(['First', 'Second']);
    expect(parsed.tabs[0]?.content).toBe('one\n```\n:: nested\n```\n');
  });

  it('returns a missing-separator virtual tab for non-empty source', () => {
    const parsed = parseTabsSource('  tab: no\ntext', DEFAULT_SETTINGS);

    expect(parsed).toMatchObject({
      source: '  tab: no\ntext',
      preamble: '',
      preferredLineEnding: '\n',
      tabs: [
        {
          kind: 'virtual',
          reason: 'missing-separator',
          range: { from: 0, to: 14 },
          title: 'New tab',
          content: '  tab: no\ntext',
        },
      ],
    });
  });

  it('returns an empty virtual tab for empty source', () => {
    const parsed = parseTabsSource('', DEFAULT_SETTINGS);

    expect(parsed).toMatchObject({
      source: '',
      preamble: '',
      preferredLineEnding: '\n',
      tabs: [
        {
          kind: 'virtual',
          reason: 'empty',
          range: { from: 0, to: 0 },
          title: 'New tab',
          content: 'New tab content',
        },
      ],
    });
  });

  it('preserves CRLF slices and reports the first observed line ending', () => {
    const parsed = parseTabsSource('right\r\ntab: One\r\nbody\r\ntab: Two\r\n', DEFAULT_SETTINGS);

    expect(parsed.preferredLineEnding).toBe('\r\n');
    expect(parsed.preambleRange).toStrictEqual({ from: 0, to: 7 });
    expect(parsed.tabs).toStrictEqual([
      {
        kind: 'explicit',
        range: { from: 7, to: 23 },
        headerRange: { from: 7, to: 17 },
        titleRange: { from: 12, to: 15 },
        contentRange: { from: 17, to: 23 },
        title: 'One',
        content: 'body\r\n',
      },
      {
        kind: 'explicit',
        range: { from: 23, to: 33 },
        headerRange: { from: 23, to: 33 },
        titleRange: { from: 28, to: 31 },
        contentRange: { from: 33, to: 33 },
        title: 'Two',
        content: '',
      },
    ]);
  });

  it('retains unknown configuration text while ignoring it semantically', () => {
    const parsed = parseTabsSource('unknown, top\nkeep this\ntab: A\nbody', DEFAULT_SETTINGS);

    expect(parsed.preamble).toBe('unknown, top\nkeep this\n');
    expect(parsed.options).toStrictEqual({ position: 'top', lineMode: 'one', action: 'add' });
  });

  it('does not treat marker text away from line start as a nested fence', () => {
    const parsed = parseTabsSource('tab: A\ntext ```js\ntab: B', DEFAULT_SETTINGS);

    expect(parsed.tabs.map((tab) => tab.title)).toStrictEqual(['A', 'B']);
    expect(parsed.tabs[0]?.content).toBe('text ```js\n');
  });

  it.each([
    ['top', 'top'],
    ['bottom', 'bottom'],
    ['left', 'left'],
    ['right', 'right'],
  ] as const)('applies the %s position token', (token, position) => {
    expect(parseTabsSource(`${token}\ntab: A`, DEFAULT_SETTINGS).options.position).toBe(position);
  });

  it.each([
    ['one', 'one'],
    ['multi', 'multi'],
  ] as const)('applies the %s line-mode token', (token, lineMode) => {
    expect(parseTabsSource(`${token}\ntab: A`, DEFAULT_SETTINGS).options.lineMode).toBe(lineMode);
  });

  it.each([
    ['action-add', 'add'],
    ['action-edit', 'edit'],
    ['action-none', 'none'],
  ] as const)('applies the %s action token', (token, action) => {
    expect(parseTabsSource(`${token}\ntab: A`, DEFAULT_SETTINGS).options.action).toBe(action);
  });

  it('uses the last recognized option token in each category', () => {
    const parsed = parseTabsSource(
      'bottom, one, action-edit\ntop\nmulti, action-none\nleft, action-add\ntab: A',
      DEFAULT_SETTINGS,
    );

    expect(parsed.options).toStrictEqual({ position: 'left', lineMode: 'multi', action: 'add' });
  });

  it('does not close a backtick fence with a shorter, mismatched, or nonblank-suffixed run', () => {
    const parsed = parseTabsSource(
      [
        'tab: A',
        '````js',
        'tab: hidden one',
        '```',
        'tab: hidden two',
        '~~~~',
        'tab: hidden three',
        '```` trailing',
        'tab: hidden four',
        '````   ',
        'tab: B',
      ].join('\n'),
      DEFAULT_SETTINGS,
    );

    expect(parsed.tabs.map((tab) => tab.title)).toStrictEqual(['A', 'B']);
    expect(parsed.tabs[0]?.content).toContain('tab: hidden four');
  });

  it('opens a nested fence with up to three leading spaces but not four', () => {
    const parsed = parseTabsSource(
      ['tab: A', '   ```', 'tab: hidden', '   ```', '    ```', 'tab: B'].join('\n'),
      DEFAULT_SETTINGS,
    );

    expect(parsed.tabs.map((tab) => tab.title)).toStrictEqual(['A', 'B']);
  });
});

describe('parseFullTabsBlock', () => {
  it('accepts a tilde tabs fence and extracts its exact inner source', () => {
    const source = ['~~~~tabs', 'top', 'tab: A', '```js', 'x', '```', '~~~~'].join('\n');

    const full = parseFullTabsBlock(source, DEFAULT_SETTINGS);

    expect(full).not.toBeNull();
    if (full === null) {
      throw new Error('Expected a valid tabs block');
    }
    expect(full.fence).toStrictEqual({ marker: '~', length: 4 });
    expect(full.document.source).toBe('top\ntab: A\n```js\nx\n```\n');
  });

  it('rejects a full block whose final closing fence is mismatched or has trailing text', () => {
    expect(parseFullTabsBlock('```tabs\ntab: A\n~~~', DEFAULT_SETTINGS)).toBeNull();
    expect(parseFullTabsBlock('```tabs\ntab: A\n``` extra', DEFAULT_SETTINGS)).toBeNull();
  });
});
