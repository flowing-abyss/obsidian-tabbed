import type { FullTabsBlock, ParsedTabsDocument } from './tab-model.js';

function longestMarkerRun(source: string, marker: '`' | '~'): number {
  const matcher = marker === '`' ? /`+/g : /~+/g;
  let longest = 0;
  let match = matcher.exec(source);
  while (match !== null) {
    longest = Math.max(longest, match[0].length);
    match = matcher.exec(source);
  }
  return longest;
}

export function serializeFullTabsBlock(block: FullTabsBlock, document: ParsedTabsDocument): string {
  if (document.source === block.document.source) {
    return block.source;
  }

  const longestRun = longestMarkerRun(document.source, block.fence.marker);
  const openingLength = Math.max(block.fence.length, longestRun + 1, 3);
  const closingLength = Math.max(block.closingFenceLength, openingLength);
  const openingMarker = block.fence.marker.repeat(openingLength);
  const closingMarker = block.fence.marker.repeat(closingLength);
  const closingBoundary =
    document.source.length > 0 && !document.source.endsWith('\n')
      ? document.preferredLineEnding
      : '';

  return (
    block.source.slice(0, block.openingMarkerRange.from) +
    openingMarker +
    block.source.slice(block.openingMarkerRange.to, block.contentRange.from) +
    document.source +
    closingBoundary +
    block.source.slice(block.contentRange.to, block.closingMarkerRange.from) +
    closingMarker +
    block.source.slice(block.closingMarkerRange.to)
  );
}
