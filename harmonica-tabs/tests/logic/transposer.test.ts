import { describe, expect, it } from 'vitest';
import { parseTabText, transposeTabText } from '../../src/logic/transposer';

describe('parseTabText', () => {
  it('parses core tokens and plus-prefix tokens', () => {
    const parsed = parseTabText("+4 -2 6' -6° 10''");
    const tokens = parsed.segments
      .filter((segment): segment is { kind: 'token'; raw: string; canonical: string } => segment.kind === 'token')
      .map((segment) => segment.canonical);

    expect(tokens).toEqual(['4', '-2', "6'", '-6°', "10''"]);
  });

  it('preserves whitespace and line breaks', () => {
    const input = "4   -2\n\n+6'";
    const result = transposeTabText({
      input,
      sourceHarmonicaPc: 0,
      targetRootPc: 0,
      notation: 'apostrophe',
      altPreference: '-2',
      direction: 'down',
    });

    expect(result.output).toBe("4   -2\n\n6'");
  });

  it('adds warnings for unrecognized token-like fragments', () => {
    const parsed = parseTabText('4 abc 4x -3?');
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it('flags unsupported standalone tokens such as letters and symbols', () => {
    const parsed = parseTabText('C %');
    expect(parsed.warnings).toEqual(['Unrecognized token: C', 'Unrecognized token: %']);
  });

  it('accepts curly apostrophes and normalizes them', () => {
    const parsed = parseTabText('4 -3’ -3’’');
    const tokens = parsed.segments
      .filter((segment): segment is { kind: 'token'; raw: string; canonical: string } => segment.kind === 'token')
      .map((segment) => segment.canonical);

    expect(tokens).toEqual(['4', "-3'", "-3''"]);
  });
});

describe('transposeTabText', () => {
  it('transposes from first-position C to second-position G', () => {
    const result = transposeTabText({
      input: '4 -4',
      sourceHarmonicaPc: 0,
      targetRootPc: 7,
      notation: 'apostrophe',
      altPreference: '-2',
      direction: 'up',
    });

    expect(result.output).toBe('6 -6');
    expect(result.transposedTokenCount).toBe(2);
  });

  it('keeps unknown tokens unchanged and warns', () => {
    const result = transposeTabText({
      input: '4 4x -2',
      sourceHarmonicaPc: 0,
      targetRootPc: 0,
      notation: 'apostrophe',
      altPreference: '-2',
      direction: 'down',
    });

    expect(result.output).toContain('4x');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.outputSegments.some((segment) => segment.text === '4x' && segment.kind === 'error')).toBe(true);
  });

  it('marks invalid tokens as error segments in output', () => {
    const result = transposeTabText({
      input: 'C 11 %',
      sourceHarmonicaPc: 0,
      targetRootPc: 7,
      notation: 'apostrophe',
      altPreference: '-2',
      direction: 'down',
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.outputSegments.some((segment) => segment.kind === 'error')).toBe(true);
  });

  it('uses degree notation for overbends when requested', () => {
    const result = transposeTabText({
      input: '5',
      sourceHarmonicaPc: 0,
      targetRootPc: 2,
      notation: 'degree',
      altPreference: '-2',
      direction: 'up',
    });

    expect(result.output).toBe('5°');
  });

  it('can transpose downward when requested', () => {
    const result = transposeTabText({
      input: '6 -6',
      sourceHarmonicaPc: 0,
      targetRootPc: 7,
      notation: 'apostrophe',
      altPreference: '-2',
      direction: 'down',
    });

    expect(result.output).toBe('-4 5');
  });

  it('accepts alternate input tabs like 3 and transposes them', () => {
    const result = transposeTabText({
      input: '3',
      sourceHarmonicaPc: 0,
      targetRootPc: 7,
      notation: 'apostrophe',
      altPreference: '-2',
      direction: 'down',
    });

    expect(result.output).toBe('-1');
    expect(result.warnings).toEqual([]);
  });

  it('does not octave-fallback when exact target is unavailable', () => {
    const result = transposeTabText({
      input: '2',
      sourceHarmonicaPc: 0,
      targetRootPc: 7,
      notation: 'apostrophe',
      altPreference: '-2',
      direction: 'down',
    });

    expect(result.output).toBe('2');
    expect(result.outputSegments).toEqual([{ text: '2', kind: 'error' }]);
    expect(result.warnings.some((warning) => warning.includes('No exact down transposition available'))).toBe(true);
    expect(result.unavailableCount).toBe(1);
  });
});
