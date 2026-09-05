export function normalizeColumnWeights(weights: readonly number[]): readonly number[] {
  if (weights.length === 0) {
    return [];
  }
  const safeWeights = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 1));
  const maximum = Math.max(...safeWeights);
  const scaled = safeWeights.map((weight) => Math.max(weight / maximum, Number.EPSILON));
  const scaledTotal = scaled.reduce((sum, weight) => sum + weight, 0);
  return scaled.map((weight) => (weight / scaledTotal) * weights.length);
}

export function stackingThreshold(columnCount: number, minTrackPx: number, gapPx: number): number {
  if (columnCount <= 0) {
    return 0;
  }
  return columnCount * minTrackPx + (columnCount - 1) * gapPx;
}

export function shouldStack(availablePx: number, thresholdPx: number): boolean {
  return availablePx < thresholdPx;
}

export function gridTrackList(normalizedWeights: readonly number[]): string {
  return normalizedWeights
    .map((weight) => `minmax(var(--tabbed-column-min-width), ${weight}fr)`)
    .join(' ');
}
