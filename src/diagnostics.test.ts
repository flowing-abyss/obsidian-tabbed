import { describe, expect, it, vi } from 'vitest';
import { formatError, logError } from './diagnostics.js';

describe('formatError', () => {
  it('uses an Error message', () => {
    expect(formatError(new Error('Could not save tab'))).toBe('Could not save tab');
  });

  it.each([
    ['a string', 'a string'],
    [42, '42'],
    [undefined, 'undefined'],
    [Symbol('tab'), 'Symbol(tab)'],
  ])('safely formats a thrown non-Error value', (error, expected) => {
    expect(formatError(error)).toBe(expected);
  });

  it('uses a fallback when a thrown value cannot be stringified', () => {
    expect(formatError(Object.create(null))).toBe('Unknown error');
  });

  it('uses a fallback when an Error message accessor throws', () => {
    const error = new Proxy(new Error('unavailable'), {
      get: () => {
        throw new Error('message accessor failed');
      },
    });

    expect(formatError(error)).toBe('Unknown error');
  });
});

describe('logError', () => {
  it('writes a prefixed diagnostic with the supplied context', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const context = { path: 'note.md', cause: 'invalid input' };

    logError('Could not load tabs', context);

    expect(consoleError).toHaveBeenCalledWith('[tabbed] Could not load tabs', context);
  });
});
