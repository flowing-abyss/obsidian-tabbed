import { describe, expect, it } from 'vitest';
import {
  gridTrackList,
  normalizeColumnWeights,
  shouldStack,
  stackingThreshold,
} from './column-layout.js';

describe('normalizeColumnWeights', () => {
  it('normalizes equivalent ratios to factors whose sum equals the column count', () => {
    for (const source of [
      [2, 1],
      [0.2, 0.1],
      [20, 10],
    ]) {
      const normalized = normalizeColumnWeights(source);

      expect(normalized[0]).toBeCloseTo(4 / 3);
      expect(normalized[1]).toBeCloseTo(2 / 3);
      expect(normalized.reduce((sum, value) => sum + value, 0)).toBeCloseTo(2);
    }
  });

  it('preserves equal unit factors exactly', () => {
    expect(normalizeColumnWeights([1, 1])).toEqual([1, 1]);
  });

  it('returns an empty list for empty input', () => {
    expect(normalizeColumnWeights([])).toEqual([]);
  });

  it('substitutes unit weights for non-finite and non-positive programmatic input', () => {
    expect(normalizeColumnWeights([Number.NaN, 0, -1, Number.POSITIVE_INFINITY])).toEqual([
      1, 1, 1, 1,
    ]);
  });

  it('keeps every factor finite and positive when maximum-first scaling underflows', () => {
    const normalized = normalizeColumnWeights([Number.MAX_VALUE, Number.MIN_VALUE]);

    expect(normalized).toHaveLength(2);
    expect(normalized.every((weight) => Number.isFinite(weight) && weight > 0)).toBe(true);
    expect(normalized.reduce((sum, value) => sum + value, 0)).toBeCloseTo(2);
    expect(normalized[0]).toBeCloseTo(2);
    expect(normalized[1]).toBeGreaterThanOrEqual(Number.EPSILON);
  });
});

describe('stackingThreshold', () => {
  it('includes one minimum track per column and one gap between adjacent columns', () => {
    expect(stackingThreshold(3, 288, 16)).toBe(896);
  });

  it('returns zero when there are no columns', () => {
    expect(stackingThreshold(0, 288, 16)).toBe(0);
  });
});

describe('shouldStack', () => {
  it('stacks only when available space is strictly below the threshold', () => {
    expect(shouldStack(895, 896)).toBe(true);
    expect(shouldStack(896, 896)).toBe(false);
    expect(shouldStack(897, 896)).toBe(false);
  });
});

describe('gridTrackList', () => {
  it('emits a minimum-width grid track for every normalized factor', () => {
    expect(gridTrackList([1, 1])).toBe(
      'minmax(var(--tabbed-column-min-width), 1fr) minmax(var(--tabbed-column-min-width), 1fr)',
    );
  });

  it('returns an empty track list for no factors', () => {
    expect(gridTrackList([])).toBe('');
  });
});
