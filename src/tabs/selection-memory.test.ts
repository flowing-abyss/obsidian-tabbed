import { describe, expect, it } from 'vitest';
import { SelectionMemory } from './selection-memory.js';

describe('SelectionMemory', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid capacity %s',
    (capacity) => {
      expect(() => new SelectionMemory(capacity)).toThrow(RangeError);
    },
  );

  it('evicts the least-recently used selection at capacity', () => {
    const memory = new SelectionMemory(2);
    memory.set('first', 0);
    memory.set('second', 1);

    expect(memory.get('first')).toBe(0);
    memory.set('third', 2);

    expect(memory.get('second')).toBeUndefined();
    expect(memory.get('first')).toBe(0);
    expect(memory.get('third')).toBe(2);
  });

  it('refreshes replacement recency and clears all selections', () => {
    const memory = new SelectionMemory(2);
    memory.set('first', 0);
    memory.set('second', 1);
    memory.set(['fir', 'st'].join(''), 4);
    memory.set('third', 2);

    expect(memory.get('first')).toBe(4);
    expect(memory.get('second')).toBeUndefined();

    memory.clear();

    expect(memory.get('first')).toBeUndefined();
    expect(memory.get('third')).toBeUndefined();
  });

  it('defaults to 256 entries and evicts the oldest on the 257th key', () => {
    const memory = new SelectionMemory();
    for (let index = 0; index < 257; index += 1) {
      memory.set(`key-${index}`, index);
    }

    expect(memory.get('key-0')).toBeUndefined();
    expect(memory.get('key-1')).toBe(1);
    expect(memory.get('key-256')).toBe(256);
  });
});
