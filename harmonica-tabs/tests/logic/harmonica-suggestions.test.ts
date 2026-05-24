import { describe, expect, it } from 'vitest';
import { noteToPc } from '../../src/data/notes';
import { getHarmonicaSuggestions } from '../../src/logic/harmonica-suggestions';

describe('getHarmonicaSuggestions', () => {
  it('returns the four most practical harps for target C in the expected order', () => {
    const suggestions = getHarmonicaSuggestions(noteToPc('C'));
    const firstFour = suggestions.slice(0, 4);

    expect(firstFour).toEqual([
      { harmonicaPc: noteToPc('C'), positionNumber: 1 },
      { harmonicaPc: noteToPc('F'), positionNumber: 2 },
      { harmonicaPc: noteToPc('Bb'), positionNumber: 3 },
      { harmonicaPc: noteToPc('Ab'), positionNumber: 5 },
    ]);
  });

  it('always returns 12 entries that cover every harmonica key exactly once', () => {
    const suggestions = getHarmonicaSuggestions(noteToPc('A'));

    expect(suggestions).toHaveLength(12);
    const harpPcs = new Set(suggestions.map((s) => s.harmonicaPc));
    expect(harpPcs.size).toBe(12);

    const positions = new Set(suggestions.map((s) => s.positionNumber));
    expect(positions.size).toBe(12);
  });

  it('places each suggestion at the position whose root pitch matches the target', () => {
    const targetPc = noteToPc('G');
    const suggestions = getHarmonicaSuggestions(targetPc);

    for (const suggestion of suggestions) {
      const rootPc = (suggestion.harmonicaPc + (suggestion.positionNumber - 1) * 7) % 12;
      expect(rootPc).toBe(targetPc);
    }
  });
});
