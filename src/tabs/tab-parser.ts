import type { TabbedSettings } from '../settings.js';
import type {
  FenceDescriptor,
  FenceMarker,
  FullTabsBlock,
  ParsedTabsDocument,
  SourceRange,
} from './tab-model.js';
import { parseTabsSourceWithSettings, scanLines, type Line } from './tab-parser-internal.js';

function range(from: number, to: number): SourceRange {
  return { from, to };
}

function leadingSpaceLength(line: string): number {
  return /^ {0,3}/.exec(line)?.[0].length ?? 0;
}

function markerRunAt(line: string, marker: FenceMarker): string | undefined {
  return new RegExp(`^${marker}+`).exec(line)?.[0];
}

function outerOpening(
  source: string,
  line: Line,
): { readonly fence: FenceDescriptor; readonly markerRange: SourceRange } | null {
  const text = source.slice(line.from, line.contentTo);
  const match = /^( {0,3})(`{3,}|~{3,})(tabs.*)$/.exec(text);
  const leadingSpaces = match?.[1];
  const markerRun = match?.[2];
  if (leadingSpaces === undefined || markerRun === undefined) {
    return null;
  }
  const marker = markerRun[0] as FenceMarker;
  return {
    fence: { marker, length: markerRun.length },
    markerRange: range(
      line.from + leadingSpaces.length,
      line.from + leadingSpaces.length + markerRun.length,
    ),
  };
}

function outerClosing(
  source: string,
  line: Line,
  fence: FenceDescriptor,
): { readonly markerRange: SourceRange; readonly length: number } | null {
  const text = source.slice(line.from, line.contentTo);
  const leadingSpaces = leadingSpaceLength(text);
  const markerRun = markerRunAt(text.slice(leadingSpaces), fence.marker);
  if (
    markerRun === undefined ||
    markerRun.length < fence.length ||
    !/^[ \t]*$/.test(text.slice(leadingSpaces + markerRun.length))
  ) {
    return null;
  }
  const from = line.from + leadingSpaces;
  return { markerRange: range(from, from + markerRun.length), length: markerRun.length };
}

export function parseTabsSource(source: string, settings: TabbedSettings): ParsedTabsDocument {
  return parseTabsSourceWithSettings(source, settings);
}

export function literalTabsDocument(source: string, settings: TabbedSettings): ParsedTabsDocument {
  const preferredLineEnding = /\r\n|\n/.exec(source)?.[0] === '\r\n' ? '\r\n' : '\n';
  return {
    source,
    syntax: {
      separator: settings.separator,
      defaultTitle: settings.defaultTitle,
      defaultContent: settings.defaultContent,
      defaultOptions: {
        position: settings.titlePosition,
        lineMode: settings.titleLineMode,
        action: settings.action,
      },
    },
    preambleRange: range(0, 0),
    preamble: '',
    options: {
      position: settings.titlePosition,
      lineMode: settings.titleLineMode,
      action: settings.action,
    },
    tabs: [
      {
        kind: 'virtual',
        reason: 'missing-separator',
        range: range(0, source.length),
        title: settings.defaultTitle,
        content: source,
      },
    ],
    preferredLineEnding,
  };
}

export function parseFullTabsBlock(source: string, settings: TabbedSettings): FullTabsBlock | null {
  const blockLines = scanLines(source);
  const openingLine = blockLines[0];
  if (openingLine === undefined) {
    return null;
  }
  const opening = outerOpening(source, openingLine);
  if (opening === null) {
    return null;
  }
  for (let index = 1; index < blockLines.length; index += 1) {
    const closingLine = blockLines[index];
    if (closingLine === undefined) {
      throw new Error('Expected a block line');
    }
    const closing = outerClosing(source, closingLine, opening.fence);
    if (closing === null) {
      continue;
    }
    if (index !== blockLines.length - 1) {
      return null;
    }
    const contentRange = range(openingLine.to, closingLine.from);
    return {
      source,
      fence: opening.fence,
      closingFenceLength: closing.length,
      openingMarkerRange: opening.markerRange,
      contentRange,
      closingMarkerRange: closing.markerRange,
      document: parseTabsSourceWithSettings(
        source.slice(contentRange.from, contentRange.to),
        settings,
      ),
    };
  }
  return null;
}
