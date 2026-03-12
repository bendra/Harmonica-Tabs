import { normalizePc } from '../data/notes';
import { buildTabsForPcSet, OverbendNotation, TabGroup } from './tabs';

const ALL_PCS = new Set<number>(Array.from({ length: 12 }, (_, index) => index));

export type ParsedSegment =
  | { kind: 'text'; text: string }
  | { kind: 'token'; raw: string; canonical: string }
  | { kind: 'invalid'; raw: string };

export type ParseResult = {
  segments: ParsedSegment[];
  warnings: string[];
};

export type OutputSegment = {
  text: string;
  kind: 'normal' | 'error';
};

export type TransposeTabTextInput = {
  input: string;
  sourceHarmonicaPc: number;
  targetRootPc: number;
  notation: OverbendNotation;
  altPreference: '-2' | '3';
  direction: 'up' | 'down';
};

export type TransposeTabTextResult = {
  output: string;
  outputSegments: OutputSegment[];
  warnings: string[];
  parsedTokenCount: number;
  transposedTokenCount: number;
  unavailableCount: number;
};

type TokenMatch = {
  raw: string;
  canonical: string;
  end: number;
};

function isAlphanumeric(value: string): boolean {
  return /[A-Za-z0-9]/.test(value);
}

function isBoundary(input: string, index: number): boolean {
  if (index < 0 || index >= input.length) return true;
  return !isAlphanumeric(input[index]);
}

function isTokenStartChar(value: string): boolean {
  return value === '+' || value === '-' || /[0-9]/.test(value);
}

function isUnsupportedTokenStartChar(value: string): boolean {
  return /[A-Za-z%]/.test(value);
}

function parseTokenAt(input: string, start: number): TokenMatch | null {
  if (!isBoundary(input, start - 1)) return null;

  let cursor = start;
  let sign = '';
  const first = input[cursor];
  if (first === '+' || first === '-') {
    sign = first;
    cursor += 1;
  }

  if (cursor >= input.length) return null;

  let hole = '';
  const firstDigit = input[cursor];
  if (firstDigit === '1' && input[cursor + 1] === '0') {
    hole = '10';
    cursor += 2;
  } else if (/[1-9]/.test(firstDigit)) {
    hole = firstDigit;
    cursor += 1;
  } else {
    return null;
  }

  let suffix = '';
  if (input[cursor] === '°') {
    suffix = '°';
    cursor += 1;
  } else {
    while (input[cursor] === "'") {
      suffix += "'";
      cursor += 1;
    }
  }

  if (input[cursor] === '’') return null;
  if (!isBoundary(input, cursor)) return null;

  const raw = input.slice(start, cursor);
  const normalizedSign = sign === '+' ? '' : sign;
  const canonical = `${normalizedSign}${hole}${suffix}`;
  return { raw, canonical, end: cursor };
}

export function parseTabText(input: string): ParseResult {
  const segments: ParsedSegment[] = [];
  const textBuffer: string[] = [];
  const unknownFragments = new Set<string>();
  let cursor = 0;

  function flushText() {
    if (textBuffer.length === 0) return;
    segments.push({ kind: 'text', text: textBuffer.join('') });
    textBuffer.length = 0;
  }

  while (cursor < input.length) {
    const char = input[cursor];
    if (isTokenStartChar(char) && isBoundary(input, cursor - 1)) {
      const parsed = parseTokenAt(input, cursor);
      if (parsed) {
        flushText();
        segments.push({ kind: 'token', raw: parsed.raw, canonical: parsed.canonical });
        cursor = parsed.end;
        continue;
      }

      let fragmentEnd = cursor + 1;
      while (fragmentEnd < input.length && !/\s/.test(input[fragmentEnd])) {
        if (isBoundary(input, fragmentEnd - 1) && isBoundary(input, fragmentEnd + 1) && input[fragmentEnd] === ',') {
          break;
        }
        fragmentEnd += 1;
      }
      const fragment = input.slice(cursor, fragmentEnd);
      textBuffer.push(fragment);
      if (/\S/.test(fragment)) {
        unknownFragments.add(fragment);
      }
      cursor = fragmentEnd;
      continue;
    }

    if (isUnsupportedTokenStartChar(char) && isBoundary(input, cursor - 1)) {
      let fragmentEnd = cursor + 1;
      while (fragmentEnd < input.length && !/\s/.test(input[fragmentEnd])) {
        if (isBoundary(input, fragmentEnd - 1) && isBoundary(input, fragmentEnd) && input[fragmentEnd] === ',') {
          break;
        }
        fragmentEnd += 1;
      }
      const fragment = input.slice(cursor, fragmentEnd);
      flushText();
      segments.push({ kind: 'invalid', raw: fragment });
      unknownFragments.add(fragment);
      cursor = fragmentEnd;
      continue;
    }

    textBuffer.push(char);
    cursor += 1;
  }

  flushText();

  return {
    segments,
    warnings: Array.from(unknownFragments).slice(0, 5).map((fragment) => `Unrecognized token: ${fragment}`),
  };
}

function choosePreferredOption(group: TabGroup, altPreference: '-2' | '3') {
  const hasMinusTwo = group.options.some((token) => token.tab === '-2');
  const hasThree = group.options.some((token) => token.tab === '3');
  if (hasMinusTwo && hasThree) {
    return group.options.find((token) => token.tab === altPreference) ?? group.options[0];
  }
  return group.options[0];
}

function buildSourceTokenMidiMap(harmonicaPc: number): Map<string, number> {
  const apostrophe = buildTabsForPcSet(ALL_PCS, 0, harmonicaPc, 'apostrophe');
  const degree = buildTabsForPcSet(ALL_PCS, 0, harmonicaPc, 'degree');
  const map = new Map<string, number>();

  [apostrophe, degree].forEach((groups) => {
    groups.forEach((group) => {
      group.options.forEach((option) => {
        map.set(option.tab, option.midi);
      });
    });
  });

  return map;
}

function buildTargetMidiTokenMap(
  harmonicaPc: number,
  notation: OverbendNotation,
  altPreference: '-2' | '3',
): Map<number, string> {
  const groups = buildTabsForPcSet(ALL_PCS, 0, harmonicaPc, notation);
  const map = new Map<number, string>();

  groups.forEach((group) => {
    const option = choosePreferredOption(group, altPreference);
    if (!option) return;
    map.set(group.midi, option.tab);
  });

  return map;
}

function buildShift(sourcePc: number, targetPc: number, direction: 'up' | 'down'): number {
  const upShift = normalizePc(targetPc - sourcePc);
  if (direction === 'up') return upShift;
  if (upShift === 0) return 0;
  return upShift - 12;
}

export function transposeTabText(params: TransposeTabTextInput): TransposeTabTextResult {
  const parsed = parseTabText(params.input);
  const sourceTokenToMidi = buildSourceTokenMidiMap(params.sourceHarmonicaPc);
  const targetMidiToToken = buildTargetMidiTokenMap(params.sourceHarmonicaPc, params.notation, params.altPreference);
  const semitoneShift = buildShift(params.sourceHarmonicaPc, params.targetRootPc, params.direction);

  let parsedTokenCount = 0;
  let transposedTokenCount = 0;
  const unknownSourceTokens: string[] = [];
  const unresolvedTokens: string[] = [];
  const outputSegments: OutputSegment[] = [];

  parsed.segments.forEach((segment) => {
      if (segment.kind === 'text') {
        outputSegments.push({ text: segment.text, kind: 'normal' });
        return;
      }
      if (segment.kind === 'invalid') {
        outputSegments.push({ text: segment.raw, kind: 'error' });
        return;
      }
      parsedTokenCount += 1;

      const sourceMidi = sourceTokenToMidi.get(segment.canonical);
      if (sourceMidi === undefined) {
        unknownSourceTokens.push(segment.raw);
        outputSegments.push({ text: segment.raw, kind: 'error' });
        return;
      }

      const targetMidi = sourceMidi + semitoneShift;
      const targetToken = targetMidiToToken.get(targetMidi);
      if (targetToken) {
        transposedTokenCount += 1;
        outputSegments.push({ text: targetToken, kind: 'normal' });
        return;
      }

      unresolvedTokens.push(segment.raw);
      outputSegments.push({ text: segment.raw, kind: 'error' });
  });

  const output = outputSegments.map((segment) => segment.text).join('');

  const warnings = [...parsed.warnings];
  if (unknownSourceTokens.length > 0) {
    const unique = Array.from(new Set(unknownSourceTokens));
    warnings.push(`Could not map ${unknownSourceTokens.length} token(s): ${unique.slice(0, 3).join(', ')}`);
  }
  if (unresolvedTokens.length > 0) {
    const unique = Array.from(new Set(unresolvedTokens));
    warnings.push(`No exact ${params.direction} transposition available for ${unresolvedTokens.length} token(s): ${unique.slice(0, 3).join(', ')}`);
  }

  return {
    output,
    outputSegments,
    warnings,
    parsedTokenCount,
    transposedTokenCount,
    unavailableCount: unresolvedTokens.length,
  };
}
