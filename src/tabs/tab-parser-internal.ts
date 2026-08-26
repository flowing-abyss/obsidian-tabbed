import type { TabbedSettings } from '../settings.js';
import type {
  EffectiveTabsOptions,
  FenceMarker,
  LineEnding,
  ParsedTab,
  ParsedTabsDocument,
  SourceRange,
  TabsSyntaxSnapshot,
} from './tab-model.js';

export interface Line {
  readonly from: number;
  readonly contentTo: number;
  readonly to: number;
}

interface FenceState {
  readonly marker: FenceMarker;
  readonly length: number;
}

interface Header {
  readonly line: Line;
  readonly titleRange: SourceRange;
}

function range(from: number, to: number): SourceRange {
  return { from, to };
}

export function scanLines(source: string): readonly Line[] {
  const result: Line[] = [];
  let from = 0;
  while (from < source.length) {
    const newline = source.indexOf('\n', from);
    if (newline === -1) {
      result.push({ from, contentTo: source.length, to: source.length });
      break;
    }
    const contentTo = newline > from && source[newline - 1] === '\r' ? newline - 1 : newline;
    result.push({ from, contentTo, to: newline + 1 });
    from = newline + 1;
  }
  return result;
}

function preferredLineEnding(source: string): LineEnding {
  const match = /\r\n|\n/.exec(source);
  return match?.[0] === '\r\n' ? '\r\n' : '\n';
}

function snapshot(settings: TabbedSettings): TabsSyntaxSnapshot {
  return {
    separator: settings.separator,
    defaultTitle: settings.defaultTitle,
    defaultContent: settings.defaultContent,
    defaultOptions: {
      position: settings.titlePosition,
      lineMode: settings.titleLineMode,
      action: settings.action,
    },
  };
}

function openingFence(line: string): FenceState | null {
  const match = /^(?: {0,3})(`{3,}|~{3,})/.exec(line);
  if (match?.[1] === undefined) {
    return null;
  }
  return { marker: match[1][0] as FenceMarker, length: match[1].length };
}

function leadingSpaceLength(line: string): number {
  return /^ {0,3}/.exec(line)?.[0].length ?? 0;
}

function markerRunAt(line: string, marker: FenceMarker): string | undefined {
  return new RegExp(`^${marker}+`).exec(line)?.[0];
}

function isClosingFence(line: string, fence: FenceState): boolean {
  const leadingSpaces = leadingSpaceLength(line);
  const markerRun = markerRunAt(line.slice(leadingSpaces), fence.marker);
  return (
    markerRun !== undefined &&
    markerRun.length >= fence.length &&
    /^ *$/.test(line.slice(leadingSpaces + markerRun.length))
  );
}

function optionWithToken(options: EffectiveTabsOptions, token: string): EffectiveTabsOptions {
  if (token === 'top' || token === 'bottom' || token === 'left' || token === 'right') {
    return { ...options, position: token };
  }
  if (token === 'one' || token === 'multi') {
    return { ...options, lineMode: token };
  }
  if (token === 'action-add') {
    return { ...options, action: 'add' };
  }
  if (token === 'action-edit') {
    return { ...options, action: 'edit' };
  }
  if (token === 'action-none') {
    return { ...options, action: 'none' };
  }
  return options;
}

function optionsFromPreamble(
  preamble: string,
  defaults: EffectiveTabsOptions,
): EffectiveTabsOptions {
  let options = defaults;
  for (const token of preamble.split(/[,\r\n]+/)) {
    options = optionWithToken(options, token.trim());
  }
  return options;
}

function virtualDocument(
  source: string,
  syntax: TabsSyntaxSnapshot,
  preferredEnding: LineEnding,
  reason: 'empty' | 'missing-separator',
): ParsedTabsDocument {
  return {
    source,
    syntax,
    preambleRange: range(0, 0),
    preamble: '',
    options: syntax.defaultOptions,
    tabs: [
      {
        kind: 'virtual',
        reason,
        range: range(0, source.length),
        title: syntax.defaultTitle,
        content: reason === 'empty' ? syntax.defaultContent : source,
      },
    ],
    preferredLineEnding: preferredEnding,
  };
}

function scanHeaders(source: string, separator: string): Header[] {
  const headers: Header[] = [];
  let fence: FenceState | null = null;
  for (const line of scanLines(source)) {
    const text = source.slice(line.from, line.contentTo);
    if (fence !== null) {
      if (isClosingFence(text, fence)) {
        fence = null;
      }
      continue;
    }
    if (text.startsWith(separator)) {
      headers.push({ line, titleRange: range(line.from + separator.length, line.contentTo) });
      continue;
    }
    fence = openingFence(text);
  }
  return headers;
}

function explicitTabs(source: string, headers: readonly Header[]): ParsedTab[] {
  return headers.map((header, index) => {
    const to = headers[index + 1]?.line.from ?? source.length;
    const contentRange = range(header.line.to, to);
    return {
      kind: 'explicit',
      range: range(header.line.from, to),
      headerRange: range(header.line.from, header.line.to),
      titleRange: header.titleRange,
      contentRange,
      title: source.slice(header.titleRange.from, header.titleRange.to),
      content: source.slice(contentRange.from, contentRange.to),
    };
  });
}

export function parseTabsSourceWithSettings(
  source: string,
  settings: TabbedSettings,
): ParsedTabsDocument {
  return parseTabsSourceWithSyntax(source, snapshot(settings));
}

export function parseTabsSourceWithSyntax(
  source: string,
  syntax: TabsSyntaxSnapshot,
): ParsedTabsDocument {
  const preferredEnding = preferredLineEnding(source);
  if (source.length === 0) {
    return virtualDocument(source, syntax, preferredEnding, 'empty');
  }
  const headers = scanHeaders(source, syntax.separator);
  if (headers.length === 0) {
    return virtualDocument(source, syntax, preferredEnding, 'missing-separator');
  }
  const firstHeader = headers[0];
  if (firstHeader === undefined) {
    throw new Error('Expected at least one tab header');
  }
  const preamble = source.slice(0, firstHeader.line.from);
  return {
    source,
    syntax,
    preambleRange: range(0, firstHeader.line.from),
    preamble,
    options: optionsFromPreamble(preamble, syntax.defaultOptions),
    tabs: explicitTabs(source, headers),
    preferredLineEnding: preferredEnding,
  };
}
