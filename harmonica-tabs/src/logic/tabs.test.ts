import { describe, expect, it } from 'vitest';
import { buildTabsForScale } from './tabs';

const C_MAJOR_EXPECTED = "1 -1 2 -2'' -2 -3'' -3 4 -4 5 -5 6 -6 -7 7 -8 8 -9 9 -10 10' 10";

describe('buildTabsForScale', () => {
  it('matches the expected C major scale output for a C harmonica', () => {
    const groups = buildTabsForScale({ rootPc: 0, scaleId: 'major' }, 0, 'apostrophe');
    const output = groups.map((group) => group.options[0]?.tab).join(' ');
    expect(output).toBe(C_MAJOR_EXPECTED);
  });

  it('only offers an alternate for G (-2 vs 3) in C major', () => {
    const groups = buildTabsForScale({ rootPc: 0, scaleId: 'major' }, 0, 'apostrophe');
    const withAlt = groups.filter((group) => group.options.length > 1);
    expect(withAlt).toHaveLength(1);
    const altOptions = withAlt[0].options.map((option) => option.tab).sort();
    expect(altOptions).toEqual(['-2', '3']);
    expect(withAlt[0].options[0].tab).toBe('-2');
  });
});
