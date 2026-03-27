import { normalizePc } from '../data/notes';
import { buildTabsForPcSet, OverbendNotation, TabGroup } from './tabs';
import {
  isTransposerTokenStartChar,
  normalizeTransposerEditInput,
  parseTransposerTokenAt,
} from './transposer-input';

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
  kind: 'normal' | 'error' | 'token';
  tokenIndex?: number;
};

export type PlayableOutputToken = {
  tokenIndex: number;
  text: string;
  canonical: string;
  midi: number;
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
  playableTokens: PlayableOutputToken[];
  warnings: string[];
  parsedTokenCount: number;
  transposedTokenCount: number;
  unavailableCount: number;
  appliedDirection: 'up' | 'down';
};

export type ResolvedTransposerBaseShift = {
  semitoneShift: number;
  appliedDirection: 'up' | 'down';
  isFirstPosition: boolean;
};

type TranspositionResolution = {
  semitoneShift: number;
  appliedDirection: 'up' | 'down';
  isFirstPositionOctaveShift: boolean;
};

function isAlphanumeric(value: string): boolean {
  return /[A-Za-z0-9]/.test(value);
}

function isBoundary(input: string, index: number): boolean {
  if (index < 0 || index >= input.length) return true;
  return !isAlphanumeric(input[index]);
}

function isUnsupportedTokenStartChar(value: string): boolean {
  return /[A-Za-z%]/.test(value);
}

export function parseTabText(input: string): ParseResult {
  const normalizedInput = normalizeTransposerEditInput(input);
  const segments: ParsedSegment[] = [];
  const textBuffer: string[] = [];
  let cursor = 0;

  function flushText() {
    if (textBuffer.length === 0) return;
    segments.push({ kind: 'text', text: textBuffer.join('') });
    textBuffer.length = 0;
  }

  while (cursor < normalizedInput.length) {
    const char = normalizedInput[cursor];
    if (isTransposerTokenStartChar(char)) {
      const parsed = parseTransposerTokenAt(normalizedInput, cursor);
      if (parsed) {
        flushText();
        const raw = input.slice(cursor, parsed.end);
        const canonical = parsed.raw.startsWith('+') ? parsed.raw.slice(1) : parsed.raw;
        segments.push({ kind: 'token', raw, canonical });
        cursor = parsed.end;
        continue;
      }

      let fragmentEnd = cursor + 1;
      while (fragmentEnd < normalizedInput.length && !/\s/.test(normalizedInput[fragmentEnd])) {
        if (
          isBoundary(normalizedInput, fragmentEnd - 1) &&
          isBoundary(normalizedInput, fragmentEnd + 1) &&
          normalizedInput[fragmentEnd] === ','
        ) {
          break;
        }
        fragmentEnd += 1;
      }
      const fragment = input.slice(cursor, fragmentEnd);
      flushText();
      segments.push({ kind: 'invalid', raw: fragment });
      cursor = fragmentEnd;
      continue;
    }

    if (isUnsupportedTokenStartChar(char) && isBoundary(normalizedInput, cursor - 1)) {
      let fragmentEnd = cursor + 1;
      while (fragmentEnd < normalizedInput.length && !/\s/.test(normalizedInput[fragmentEnd])) {
        if (
          isBoundary(normalizedInput, fragmentEnd - 1) &&
          isBoundary(normalizedInput, fragmentEnd) &&
          normalizedInput[fragmentEnd] === ','
        ) {
          break;
        }
        fragmentEnd += 1;
      }
      const fragment = input.slice(cursor, fragmentEnd);
      flushText();
      segments.push({ kind: 'invalid', raw: fragment });
      cursor = fragmentEnd;
      continue;
    }

    textBuffer.push(input[cursor]);
    cursor += 1;
  }

  flushText();

  return {
    segments,
    warnings: [],
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

function resolveTransposition(params: TransposeTabTextInput): TranspositionResolution {
  if (normalizePc(params.targetRootPc - params.sourceHarmonicaPc) === 0) {
    return {
      semitoneShift: params.direction === 'down' ? -12 : 12,
      appliedDirection: params.direction,
      isFirstPositionOctaveShift: true,
    };
  }

  return {
    semitoneShift: buildShift(params.sourceHarmonicaPc, params.targetRootPc, params.direction),
    appliedDirection: params.direction,
    isFirstPositionOctaveShift: false,
  };
}

type TransposeWithSemitoneShiftInput = Omit<TransposeTabTextInput, 'direction'> & {
  semitoneShift: number;
  appliedDirection: 'up' | 'down';
  isFirstPositionOctaveShift: boolean;
};

function transposeTabTextWithResolvedShift(params: TransposeWithSemitoneShiftInput): TransposeTabTextResult {
  const parsed = parseTabText(params.input);
  const sourceTokenToMidi = buildSourceTokenMidiMap(params.sourceHarmonicaPc);
  const targetMidiToToken = buildTargetMidiTokenMap(params.sourceHarmonicaPc, params.notation, params.altPreference);

  let parsedTokenCount = 0;
  let transposedTokenCount = 0;
  const unknownSourceTokens: string[] = [];
  const unresolvedTokens: string[] = [];
  const outputSegments: OutputSegment[] = [];
  const playableTokens: PlayableOutputToken[] = [];

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

    const targetMidi = sourceMidi + params.semitoneShift;
    const targetToken = targetMidiToToken.get(targetMidi);
    if (targetToken) {
      const tokenIndex = playableTokens.length;
      transposedTokenCount += 1;
      playableTokens.push({
        tokenIndex,
        text: targetToken,
        canonical: targetToken,
        midi: targetMidi,
      });
      outputSegments.push({ text: targetToken, kind: 'token', tokenIndex });
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
    warnings.push(
      params.isFirstPositionOctaveShift
        ? `No playable ${params.appliedDirection}-octave transposition available for ${unresolvedTokens.length} token(s): ${unique.slice(0, 3).join(', ')}`
        : `No exact ${params.appliedDirection} transposition available for ${unresolvedTokens.length} token(s): ${unique.slice(0, 3).join(', ')}`,
    );
  }

  return {
    output,
    outputSegments,
    playableTokens,
    warnings,
    parsedTokenCount,
    transposedTokenCount,
    unavailableCount: unresolvedTokens.length,
    appliedDirection: params.appliedDirection,
  };
}

export function transposeTabText(params: TransposeTabTextInput): TransposeTabTextResult {
  const resolution = resolveTransposition(params);
  return transposeTabTextWithResolvedShift({
    input: params.input,
    sourceHarmonicaPc: params.sourceHarmonicaPc,
    targetRootPc: params.targetRootPc,
    notation: params.notation,
    altPreference: params.altPreference,
    semitoneShift: resolution.semitoneShift,
    appliedDirection: resolution.appliedDirection,
    isFirstPositionOctaveShift: resolution.isFirstPositionOctaveShift,
  });
}

export function resolveTransposerBaseShift(
  params: Omit<TransposeTabTextInput, 'direction'>,
): ResolvedTransposerBaseShift {
  const isFirstPosition = normalizePc(params.targetRootPc - params.sourceHarmonicaPc) === 0;
  if (isFirstPosition) {
    return {
      semitoneShift: 0,
      appliedDirection: 'up',
      isFirstPosition: true,
    };
  }

  const exactDownShift = buildShift(params.sourceHarmonicaPc, params.targetRootPc, 'down');
  const exactUpShift = buildShift(params.sourceHarmonicaPc, params.targetRootPc, 'up');
  const exactDown = transposeTabTextWithResolvedShift({
    ...params,
    semitoneShift: exactDownShift,
    appliedDirection: 'down',
    isFirstPositionOctaveShift: false,
  });
  const exactUp = transposeTabTextWithResolvedShift({
    ...params,
    semitoneShift: exactUpShift,
    appliedDirection: 'up',
    isFirstPositionOctaveShift: false,
  });
  if (exactDown.unavailableCount === 0) {
    return {
      semitoneShift: exactDownShift,
      appliedDirection: 'down',
      isFirstPosition: false,
    };
  }
  if (exactUp.unavailableCount === 0) {
    return {
      semitoneShift: exactUpShift,
      appliedDirection: 'up',
      isFirstPosition: false,
    };
  }

  return {
    semitoneShift: exactDownShift,
    appliedDirection: 'down',
    isFirstPosition: false,
  };
}

export function transposeTabTextAtShift(
  params: Omit<TransposeTabTextInput, 'direction'> & {
    semitoneShift: number;
    baseSemitoneShift: number;
    baseAppliedDirection: 'up' | 'down';
  },
): TransposeTabTextResult {
  const appliedDirection: 'up' | 'down' =
    params.semitoneShift === params.baseSemitoneShift
      ? params.baseAppliedDirection
      : params.semitoneShift < params.baseSemitoneShift
        ? 'down'
        : 'up';

  return transposeTabTextWithResolvedShift({
    input: params.input,
    sourceHarmonicaPc: params.sourceHarmonicaPc,
    targetRootPc: params.targetRootPc,
    notation: params.notation,
    altPreference: params.altPreference,
    semitoneShift: params.semitoneShift,
    appliedDirection,
    isFirstPositionOctaveShift: params.semitoneShift !== params.baseSemitoneShift,
  });
}
