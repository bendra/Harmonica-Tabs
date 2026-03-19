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

    expect(result.output).toBe("1   -2\n\n-3'");
  });

  it('does not add warnings for unrecognized token-like fragments', () => {
    const parsed = parseTabText('4 abc 4x -3?');
    expect(parsed.warnings).toEqual([]);
  });

  it('flags unsupported standalone tokens such as letters and symbols as invalid segments', () => {
    const parsed = parseTabText('C %');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.segments).toEqual([
      { kind: 'invalid', raw: 'C' },
      { kind: 'text', text: ' ' },
      { kind: 'invalid', raw: '%' },
    ]);
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
    expect(result.appliedDirection).toBe('up');
    expect(result.transposedTokenCount).toBe(2);
    expect(result.playableTokens).toEqual([
      { tokenIndex: 0, text: '6', canonical: '6', midi: 79 },
      { tokenIndex: 1, text: '-6', canonical: '-6', midi: 81 },
    ]);
    expect(result.outputSegments).toEqual([
      { text: '6', kind: 'token', tokenIndex: 0 },
      { text: ' ', kind: 'normal' },
      { text: '-6', kind: 'token', tokenIndex: 1 },
    ]);
  });

  it('keeps unknown tokens unchanged and marks them as errors', () => {
    const result = transposeTabText({
      input: '4 4x 5',
      sourceHarmonicaPc: 0,
      targetRootPc: 0,
      notation: 'apostrophe',
      altPreference: '-2',
      direction: 'down',
    });

    expect(result.output).toContain('4x');
    expect(result.warnings).toEqual([]);
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

    expect(result.warnings).toEqual([]);
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
    expect(result.appliedDirection).toBe('down');
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

  it('transposes one octave down in first position when down is selected', () => {
    const result = transposeTabText({
      input: '4 -4',
      sourceHarmonicaPc: 0,
      targetRootPc: 0,
      notation: 'apostrophe',
      altPreference: '-2',
      direction: 'down',
    });

    expect(result.output).toBe('1 -1');
    expect(result.appliedDirection).toBe('down');
    expect(result.warnings).toEqual([]);
    expect(result.unavailableCount).toBe(0);
  });

  it('transposes one octave up in first position when up is selected', () => {
    const result = transposeTabText({
      input: '4 -4',
      sourceHarmonicaPc: 0,
      targetRootPc: 0,
      notation: 'apostrophe',
      altPreference: '-2',
      direction: 'up',
    });

    expect(result.output).toBe('7 -8');
    expect(result.appliedDirection).toBe('up');
    expect(result.warnings).toEqual([]);
    expect(result.unavailableCount).toBe(0);
  });

  it('marks invalid notes when a selected first-position down octave is unavailable', () => {
    const result = transposeTabText({
      input: '1 10',
      sourceHarmonicaPc: 0,
      targetRootPc: 0,
      notation: 'apostrophe',
      altPreference: '-2',
      direction: 'down',
    });

    expect(result.output).toBe('1 7');
    expect(result.appliedDirection).toBe('down');
    expect(result.outputSegments).toEqual([
      { text: '1', kind: 'error' },
      { text: ' ', kind: 'normal' },
      { text: '7', kind: 'token', tokenIndex: 0 },
    ]);
    expect(result.warnings.some((warning) => warning.includes('No playable down-octave transposition available'))).toBe(
      true,
    );
    expect(result.unavailableCount).toBe(1);
  });

  it('marks invalid notes when a selected first-position up octave is unavailable', () => {
    const result = transposeTabText({
      input: '1 10',
      sourceHarmonicaPc: 0,
      targetRootPc: 0,
      notation: 'apostrophe',
      altPreference: '-2',
      direction: 'up',
    });

    expect(result.output).toBe('4 10');
    expect(result.appliedDirection).toBe('up');
    expect(result.outputSegments).toEqual([
      { text: '4', kind: 'token', tokenIndex: 0 },
      { text: ' ', kind: 'normal' },
      { text: '10', kind: 'error' },
    ]);
    expect(result.warnings.some((warning) => warning.includes('No playable up-octave transposition available'))).toBe(
      true,
    );
    expect(result.unavailableCount).toBe(1);
  });

  it('does not octave-fallback when an exact non-first-position target is unavailable', () => {
    const result = transposeTabText({
      input: '2',
      sourceHarmonicaPc: 0,
      targetRootPc: 7,
      notation: 'apostrophe',
      altPreference: '-2',
      direction: 'down',
    });

    expect(result.output).toBe('2');
    expect(result.appliedDirection).toBe('down');
    expect(result.outputSegments).toEqual([{ text: '2', kind: 'error' }]);
    expect(result.warnings.some((warning) => warning.includes('No exact down transposition available'))).toBe(true);
    expect(result.unavailableCount).toBe(1);
  });

  it('only exposes successfully transposed tabs as playable output tokens', () => {
    const result = transposeTabText({
      input: '4 xyz 2 -2',
      sourceHarmonicaPc: 0,
      targetRootPc: 7,
      notation: 'apostrophe',
      altPreference: '-2',
      direction: 'down',
    });

    expect(result.output).toBe('-2 xyz 2 -1');
    expect(result.playableTokens).toEqual([
      { tokenIndex: 0, text: '-2', canonical: '-2', midi: 67 },
      { tokenIndex: 1, text: '-1', canonical: '-1', midi: 62 },
    ]);
    expect(result.outputSegments).toEqual([
      { text: '-2', kind: 'token', tokenIndex: 0 },
      { text: ' ', kind: 'normal' },
      { text: 'xyz', kind: 'error' },
      { text: ' ', kind: 'normal' },
      { text: '2', kind: 'error' },
      { text: ' ', kind: 'normal' },
      { text: '-1', kind: 'token', tokenIndex: 1 },
    ]);
  });
});
