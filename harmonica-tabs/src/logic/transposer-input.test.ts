import { describe, expect, it } from 'vitest';
import { insertAtSelection, sanitizeTransposerInput } from './transposer-input';

describe('sanitizeTransposerInput', () => {
  it('keeps only allowed transposer characters', () => {
    expect(sanitizeTransposerInput("4 -3'' +5°\nabc_%")).toBe("4 -3'' +5°\n");
  });

  it('normalizes curly apostrophes to straight apostrophes', () => {
    expect(sanitizeTransposerInput('-3’ -3’’')).toBe("-3' -3''");
  });
});

describe('insertAtSelection', () => {
  it('inserts sanitized text at the current cursor', () => {
    const result = insertAtSelection('4 -4 5', { start: 2, end: 2 }, "’ ");
    expect(result.nextValue).toBe("4 ' -4 5");
    expect(result.nextSelection).toEqual({ start: 4, end: 4 });
  });

  it('replaces selected text', () => {
    const result = insertAtSelection('4 -4 5', { start: 2, end: 4 }, '-');
    expect(result.nextValue).toBe('4 - 5');
    expect(result.nextSelection).toEqual({ start: 3, end: 3 });
  });
});
