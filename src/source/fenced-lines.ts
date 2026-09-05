type FenceMarker = '`' | '~';

export interface Line {
  readonly from: number;
  readonly contentTo: number;
  readonly to: number;
}

export interface FenceState {
  readonly marker: FenceMarker;
  readonly length: number;
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

export function openingFence(line: string): FenceState | null {
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

export function isClosingFence(line: string, fence: FenceState): boolean {
  const leadingSpaces = leadingSpaceLength(line);
  const markerRun = markerRunAt(line.slice(leadingSpaces), fence.marker);
  return (
    markerRun !== undefined &&
    markerRun.length >= fence.length &&
    /^ *$/.test(line.slice(leadingSpaces + markerRun.length))
  );
}
