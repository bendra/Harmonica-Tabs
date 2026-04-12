import { describe, expect, it } from 'vitest';
import { buildTabsForPcSet, buildTabsForScale } from '../../src/logic/tabs';

const C_MAJOR_EXPECTED = "1 -1 2 -2'' -2 -3'' -3 4 -4 5 -5 6 -6 -7 7 -8 8 -9 9 -10 10' 10";
const ALL_PCS = new Set(Array.from({ length: 12 }, (_, index) => index));

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

  it('renders overbends using the selected notation', () => {
    const degree = buildTabsForScale({ rootPc: 4, scaleId: 'major' }, 0, 'degree');
    const apostrophe = buildTabsForScale({ rootPc: 4, scaleId: 'major' }, 0, 'apostrophe');

    const degreeTabs = degree.flatMap((group) => group.options.map((option) => option.tab));
    const apostropheTabs = apostrophe.flatMap((group) => group.options.map((option) => option.tab));

    expect(degreeTabs).toContain('4°');
    expect(apostropheTabs).toContain("4'");
  });

  it('excludes overbends on holes 2, 3, and 8', () => {
    const degree = buildTabsForScale({ rootPc: 4, scaleId: 'major' }, 0, 'degree');
    const degreeTabs = degree.flatMap((group) => group.options.map((option) => option.tab));

    expect(degreeTabs).not.toContain('2°');
    expect(degreeTabs).not.toContain('3°');
    expect(degreeTabs).not.toContain('8°');
    expect(degreeTabs).not.toContain('-8°');
  });

  it('uses the wrapped lower octave for MIDI token mapping on a G harmonica', () => {
    const groups = buildTabsForPcSet(ALL_PCS, 0, 7, 'apostrophe');
    const allOptions = groups.flatMap((group) => group.options);
    const minusTwo = allOptions.find((option) => option.tab === '-2');
    const sixBlow = allOptions.find((option) => option.tab === '6');

    expect(minusTwo?.midi).toBe(62);
    expect(sixBlow?.midi).toBe(74);
  });
});
