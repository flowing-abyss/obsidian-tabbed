import { describe, expect, it } from 'vitest';
import { RecencyOrder } from './recency-order.js';

describe('RecencyOrder', () => {
  it('returns oldest keys first until the limit is met', () => {
    const order = new RecencyOrder<number>();
    for (const key of [0, 1, 2, 3]) order.touch(key);
    expect(order.evictionCandidates(2, 3)).toEqual([0, 1]);
    expect(order.size).toBe(4);
  });

  it('moves a re-touched key to most recent', () => {
    const order = new RecencyOrder<number>();
    for (const key of [0, 1, 0, 2]) order.touch(key);
    expect(order.size).toBe(3);
    expect(order.evictionCandidates(2, 2)).toEqual([1]);
  });

  it('never returns the protected key even when it is the oldest', () => {
    const order = new RecencyOrder<number>();
    for (const key of [0, 1, 2]) order.touch(key);
    expect(order.evictionCandidates(1, 0)).toEqual([1, 2]);
  });

  it('returns nothing for limit 0, negative limits, and sizes within the limit', () => {
    const order = new RecencyOrder<number>();
    for (const key of [0, 1, 2]) order.touch(key);
    expect(order.evictionCandidates(0, 2)).toEqual([]);
    expect(order.evictionCandidates(-1, 2)).toEqual([]);
    expect(order.evictionCandidates(3, 2)).toEqual([]);
    expect(order.evictionCandidates(100, 2)).toEqual([]);
  });

  it('forgets deleted and cleared keys', () => {
    const order = new RecencyOrder<number>();
    for (const key of [0, 1, 2]) order.touch(key);
    order.delete(0);
    expect(order.evictionCandidates(1, 2)).toEqual([1]);
    order.clear();
    expect(order.size).toBe(0);
    expect(order.evictionCandidates(1, 2)).toEqual([]);
  });
});
