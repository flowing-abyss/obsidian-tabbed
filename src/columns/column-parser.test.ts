import { describe, expect, it } from 'vitest';
import { literalColumnsDocument, parseColumnsSource } from './column-parser.js';

describe('parseColumnsSource', () => {
  it('parses stack layout, titles, default weights, and column content', () => {
    const parsed = parseColumnsSource(
      ['stack', 'column: **Main**', 'weight: 2', 'A', 'column:', 'B'].join('\n'),
    );

    expect(parsed.layout).toBe('stack');
    expect(
      parsed.columns.map(({ title, weight, content }) => ({ title, weight, content })),
    ).toEqual([
      { title: '**Main**', weight: 2, content: 'A\n' },
      { title: '', weight: 1, content: 'B' },
    ]);
  });

  it('uses the last recognized scroll or stack preamble token', () => {
    const source = 'scroll, stack\nunknown\nscroll\ncolumn: A\nx';
    const parsed = parseColumnsSource(source);

    expect(parsed.layout).toBe('scroll');
    expect(parsed.preambleRange).toStrictEqual({ from: 0, to: 29 });
    expect(parsed.preamble).toBe('scroll, stack\nunknown\nscroll\n');
  });

  it('preserves CRLF and mixed-EOL ranges while trimming a whitespace-only title', () => {
    const source = 'stack\r\ncolumn: One\r\nweight: 2.5\nA\r\ncolumn:   \nB';
    const parsed = parseColumnsSource(source);

    expect(parsed.preferredLineEnding).toBe('\r\n');
    expect(parsed.preambleRange).toStrictEqual({ from: 0, to: 7 });
    expect(parsed.preamble).toBe('stack\r\n');
    expect(parsed.columns).toStrictEqual([
      {
        kind: 'explicit',
        range: { from: 7, to: 35 },
        headerRange: { from: 7, to: 20 },
        titleRange: { from: 15, to: 18 },
        weightRange: { from: 20, to: 32 },
        contentRange: { from: 32, to: 35 },
        title: 'One',
        weight: 2.5,
        content: 'A\r\n',
      },
      {
        kind: 'explicit',
        range: { from: 35, to: 47 },
        headerRange: { from: 35, to: 46 },
        titleRange: { from: 43, to: 45 },
        contentRange: { from: 46, to: 47 },
        title: '',
        weight: 1,
        content: 'B',
      },
    ]);
  });

  it('returns the complete nonempty source as one virtual column when no header exists', () => {
    const source = 'stack\r\ncolumn:Text\nbody';

    expect(parseColumnsSource(source)).toStrictEqual({
      source,
      preambleRange: { from: 0, to: 0 },
      preamble: '',
      layout: 'scroll',
      columns: [
        {
          kind: 'virtual',
          range: { from: 0, to: 23 },
          title: '',
          weight: 1,
          content: source,
        },
      ],
      preferredLineEnding: '\r\n',
    });
  });

  it('returns one empty virtual column for empty source', () => {
    expect(parseColumnsSource('')).toStrictEqual({
      source: '',
      preambleRange: { from: 0, to: 0 },
      preamble: '',
      layout: 'scroll',
      columns: [
        {
          kind: 'virtual',
          range: { from: 0, to: 0 },
          title: '',
          weight: 1,
          content: '',
        },
      ],
      preferredLineEnding: '\n',
    });
  });

  it('always provides the same one-column literal recovery document', () => {
    const source = 'stack\ncolumn: A\nweight: 2\nbody';
    const parsed = literalColumnsDocument(source);

    expect(parsed).toStrictEqual({
      source,
      preambleRange: { from: 0, to: 0 },
      preamble: '',
      layout: 'scroll',
      columns: [
        {
          kind: 'virtual',
          range: { from: 0, to: 30 },
          title: '',
          weight: 1,
          content: source,
        },
      ],
      preferredLineEnding: '\n',
    });
  });

  it('treats column text without the exact separator and indented markers as content', () => {
    const parsed = parseColumnsSource(
      ['column: Good', 'column:Text', '  column:', 'column: Next'].join('\n'),
    );

    expect(parsed.columns.map(({ title, content }) => ({ title, content }))).toStrictEqual([
      { title: 'Good', content: 'column:Text\n  column:\n' },
      { title: 'Next', content: '' },
    ]);
  });

  it('keeps structural-looking lines inside established nested fences as content', () => {
    const parsed = parseColumnsSource(
      [
        'column: One',
        '```columns',
        'column: Hidden',
        'weight: 999',
        '```',
        'column: Two',
        '~~~markdown',
        'column: Also hidden',
        '~~~',
      ].join('\n'),
    );

    expect(
      parsed.columns.map(({ title, weight, content }) => ({ title, weight, content })),
    ).toEqual([
      {
        title: 'One',
        weight: 1,
        content: '```columns\ncolumn: Hidden\nweight: 999\n```\n',
      },
      {
        title: 'Two',
        weight: 1,
        content: '~~~markdown\ncolumn: Also hidden\n~~~',
      },
    ]);
  });

  it.each([
    ['weight: 2', 2],
    ['weight: 0.5', 0.5],
    ['weight: 12.25   ', 12.25],
  ] as const)('consumes valid immediate structural metadata %s', (metadata, expectedWeight) => {
    const source = `column: A\n${metadata}\nbody`;
    const column = parseColumnsSource(source).columns[0];

    expect(column).toMatchObject({
      kind: 'explicit',
      weight: expectedWeight,
      weightRange: { from: 10, to: 11 + metadata.length },
      contentRange: { from: 11 + metadata.length, to: source.length },
      content: 'body',
    });
    if (column?.kind !== 'explicit' || column.weightRange === undefined) {
      throw new Error('Expected explicit column metadata');
    }
    expect(source.slice(column.weightRange.from, column.weightRange.to)).toBe(`${metadata}\n`);
  });

  it.each([
    'weight:',
    'weight: 0',
    'weight: -1',
    'weight: .5',
    'weight: 1.',
    'weight: +2',
    'weight: 1e2',
    'weight: Infinity',
    'weight: abc',
    'weight: 2px',
  ])('consumes invalid immediate structural metadata %s with the default weight', (metadata) => {
    const source = `column: A\n${metadata}\nbody`;
    const column = parseColumnsSource(source).columns[0];

    expect(column).toMatchObject({
      kind: 'explicit',
      weight: 1,
      weightRange: { from: 10, to: 11 + metadata.length },
      contentRange: { from: 11 + metadata.length, to: source.length },
      content: 'body',
    });
  });

  it.each(['weight:2', 'weight:\t2', ' weight: 2'])(
    'keeps nonstructural immediate weight text %s as ordinary content',
    (text) => {
      const column = parseColumnsSource(`column: A\n${text}\nbody`).columns[0];

      expect(column).toMatchObject({ weight: 1, content: `${text}\nbody` });
      expect(column).not.toHaveProperty('weightRange');
    },
  );

  it('keeps a valid weight line as content when it is not physically after the header', () => {
    const column = parseColumnsSource('column: A\nintro\nweight: 2\nbody').columns[0];

    expect(column).toMatchObject({ weight: 1, content: 'intro\nweight: 2\nbody' });
    expect(column).not.toHaveProperty('weightRange');
  });
});
