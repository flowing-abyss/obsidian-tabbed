import {
  isClosingFence,
  openingFence,
  scanLines,
  type FenceState,
  type Line,
} from '../source/fenced-lines.js';
import type {
  ColumnsLayoutMode,
  ExplicitColumn,
  ParsedColumn,
  ParsedColumnsDocument,
  SourceRange,
  VirtualColumn,
} from './column-model.js';

const DECIMAL = /^\d+(?:\.\d+)?$/;

interface Header {
  readonly line: Line;
  readonly lineIndex: number;
  readonly titleRange: SourceRange;
}

function range(from: number, to: number): SourceRange {
  return { from, to };
}

function preferredLineEnding(source: string): '\n' | '\r\n' {
  return /\r\n|\n/.exec(source)?.[0] === '\r\n' ? '\r\n' : '\n';
}

function layoutFromPreamble(preamble: string): ColumnsLayoutMode {
  let layout: ColumnsLayoutMode = 'scroll';
  for (const token of preamble.split(/[,\r\n]+/)) {
    const trimmed = token.trim();
    if (trimmed === 'scroll' || trimmed === 'stack') {
      layout = trimmed;
    }
  }
  return layout;
}

function scanHeaders(source: string, lines: readonly Line[]): Header[] {
  const headers: Header[] = [];
  let fence: FenceState | null = null;
  lines.forEach((line, lineIndex) => {
    const text = source.slice(line.from, line.contentTo);
    if (fence !== null) {
      if (isClosingFence(text, fence)) {
        fence = null;
      }
      return;
    }

    const match = /^column:(?: (.*))?$/.exec(text);
    if (match !== null) {
      const titleFrom = match[1] === undefined ? line.contentTo : line.from + 'column: '.length;
      headers.push({ line, lineIndex, titleRange: range(titleFrom, line.contentTo) });
      return;
    }

    fence = openingFence(text);
  });
  return headers;
}

function structuralWeight(
  source: string,
  line: Line | undefined,
  expectedFrom: number,
): { readonly range: SourceRange; readonly weight: number } | null {
  if (line?.from !== expectedFrom) {
    return null;
  }
  const text = source.slice(line.from, line.contentTo);
  const match = /^weight:(?: (.*))?$/.exec(text);
  if (match === null) {
    return null;
  }
  const value = match[1]?.trim() ?? '';
  const parsed = DECIMAL.test(value) ? Number(value) : Number.NaN;
  return {
    range: range(line.from, line.to),
    weight: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
  };
}

function explicitColumns(
  source: string,
  lines: readonly Line[],
  headers: readonly Header[],
): ParsedColumn[] {
  return headers.map((header, index): ExplicitColumn => {
    const to = headers[index + 1]?.line.from ?? source.length;
    const metadata = structuralWeight(source, lines[header.lineIndex + 1], header.line.to);
    const contentRange = range(metadata?.range.to ?? header.line.to, to);
    return {
      kind: 'explicit',
      range: range(header.line.from, to),
      headerRange: range(header.line.from, header.line.to),
      titleRange: header.titleRange,
      ...(metadata === null ? {} : { weightRange: metadata.range }),
      contentRange,
      title: source.slice(header.titleRange.from, header.titleRange.to).trim(),
      weight: metadata?.weight ?? 1,
      content: source.slice(contentRange.from, contentRange.to),
    };
  });
}

function virtualColumn(source: string): VirtualColumn {
  return {
    kind: 'virtual',
    range: range(0, source.length),
    title: '',
    weight: 1,
    content: source,
  };
}

export function literalColumnsDocument(source: string): ParsedColumnsDocument {
  return {
    source,
    preambleRange: range(0, 0),
    preamble: '',
    layout: 'scroll',
    columns: [virtualColumn(source)],
    preferredLineEnding: preferredLineEnding(source),
  };
}

export function parseColumnsSource(source: string): ParsedColumnsDocument {
  const lines = scanLines(source);
  const headers = scanHeaders(source, lines);
  const firstHeader = headers[0];
  if (firstHeader === undefined) {
    return literalColumnsDocument(source);
  }
  const preambleRange = range(0, firstHeader.line.from);
  const preamble = source.slice(preambleRange.from, preambleRange.to);
  return {
    source,
    preambleRange,
    preamble,
    layout: layoutFromPreamble(preamble),
    columns: explicitColumns(source, lines, headers),
    preferredLineEnding: preferredLineEnding(source),
  };
}
