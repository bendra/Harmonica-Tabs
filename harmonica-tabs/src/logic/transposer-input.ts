export type TextSelection = {
  start: number;
  end: number;
};

export type TransposerCleanupOptions = {
  stripInvalidContent: boolean;
  removeExcessWhitespace: boolean;
};

export type TransposerTokenSign = '' | '-' | '+';
export type TransposerTokenSuffix = '' | "'" | "''" | "'''" | '°';

const DISALLOWED_INPUT = /[^0-9+\-'\u00B0\s]/g;
const SPACE_RUN = /[ \t]+/g;

export type TransposerTokenMatch = {
  raw: string;
  end: number;
};

type TrailingSeparator = 'none' | 'space' | 'newline';

function normalizeRawInput(value: string): string {
  return (value ?? '').replaceAll('’', "'");
}

export function normalizeTransposerEditInput(value: string): string {
  return normalizeRawInput(value);
}

function isAlphanumeric(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9]/.test(value);
}

function isBoundary(input: string, index: number): boolean {
  if (index < 0 || index >= input.length) return true;
  return !isAlphanumeric(input[index]);
}

export function isTransposerTokenStartChar(value: string | undefined): boolean {
  return value !== undefined && (value === '+' || value === '-' || /[0-9]/.test(value));
}

function isTokenEndChar(value: string | undefined): boolean {
  return value !== undefined && (/[0-9]/.test(value) || value === "'" || value === '°');
}

function isAdjacentUnsignedTokenStart(input: string, index: number): boolean {
  if (index <= 0) return false;

  const current = input[index];
  if (current === undefined || !/[1-9]/.test(current)) return false;

  const previous = input[index - 1];
  if (previous === "'" || previous === '°') return true;
  return previous !== undefined && /[1-9]/.test(previous) && previous !== current;
}

function isTokenStartBoundary(input: string, index: number): boolean {
  if (isBoundary(input, index - 1)) return true;

  const current = input[index];
  if (current !== '+' && current !== '-' && isAdjacentUnsignedTokenStart(input, index)) {
    return true;
  }

  if ((current !== '+' && current !== '-') || index === 0) return false;

  return isTokenEndChar(input[index - 1]);
}

function isApostropheChar(value: string | undefined): boolean {
  return value === "'";
}

export function parseTransposerTokenAt(input: string, start: number): TransposerTokenMatch | null {
  if (!isTokenStartBoundary(input, start)) return null;

  let cursor = start;
  const first = input[cursor];
  if (first === '+' || first === '-') {
    cursor += 1;
  }

  if (cursor >= input.length) return null;

  const firstDigit = input[cursor];
  if (firstDigit === '1' && input[cursor + 1] === '0') {
    cursor += 2;
  } else if (firstDigit !== undefined && /[1-9]/.test(firstDigit)) {
    cursor += 1;
  } else {
    return null;
  }

  if (input[cursor] === '°') {
    cursor += 1;
  } else {
    while (isApostropheChar(input[cursor])) {
      cursor += 1;
    }
  }

  if (!isBoundary(input, cursor) && !isAdjacentUnsignedTokenStart(input, cursor)) return null;

  return {
    raw: input.slice(start, cursor),
    end: cursor,
  };
}

function getTrailingSeparator(value: string): TrailingSeparator {
  if (/\n$/.test(value)) return 'newline';
  if (/[ \t]$/.test(value)) return 'space';
  return 'none';
}

function collapseWhitespace(value: string, trailingSeparator: TrailingSeparator): string {
  const normalized = value
    .split('\n')
    .map((line) => line.trim().replace(SPACE_RUN, ' '))
    .join('\n');

  if (normalized.length > 0) {
    if (trailingSeparator === 'newline') return `${normalized}\n`;
    if (trailingSeparator === 'space') return `${normalized} `;
  }

  return normalized;
}

function extractTabContent(input: string, removeExcessWhitespace: boolean): string {
  const lines = input.split('\n');
  const keptLines: string[] = [];

  lines.forEach((line) => {
    let cursor = 0;
    let previousEnd = 0;
    let extracted = '';
    let hasToken = false;
    let tokenCount = 0;

    while (cursor < line.length) {
      if (isTransposerTokenStartChar(line[cursor])) {
        const token = parseTransposerTokenAt(line, cursor);
        if (token) {
          const separator = line.slice(previousEnd, cursor).replace(/[^\s]/g, '');
          if (hasToken && previousEnd === cursor && separator.length === 0) {
            extracted += ' ';
          } else {
            extracted += separator;
          }
          extracted += token.raw;
          previousEnd = token.end;
          cursor = token.end;
          hasToken = true;
          tokenCount += 1;
          continue;
        }
      }

      cursor += 1;
    }

    if (hasToken) {
      const letterCount = (line.match(/[A-Za-z]/g) ?? []).length;
      if (letterCount > 0 && tokenCount < 2) {
        return;
      }

      extracted += line.slice(previousEnd).replace(/[^\s]/g, '');
      keptLines.push(removeExcessWhitespace ? extracted.trim().replace(SPACE_RUN, ' ') : extracted);
    }
  });

  const filteredLines = keptLines.filter((line) => line.length > 0);
  const joined = filteredLines.join('\n');
  const trailingSeparator = filteredLines.length > 0 ? getTrailingSeparator(input) : 'none';

  if (removeExcessWhitespace) {
    return collapseWhitespace(joined, trailingSeparator);
  }

  return joined;
}

export function sanitizeTransposerInput(value: string): string {
  return normalizeRawInput(value).replace(DISALLOWED_INPUT, '');
}

export function cleanupTransposerInput(value: string, options: TransposerCleanupOptions): string {
  const normalized = normalizeRawInput(value);
  if (options.stripInvalidContent) {
    return extractTabContent(normalized, options.removeExcessWhitespace);
  }

  const sanitized = normalized.replace(DISALLOWED_INPUT, '');
  if (!options.removeExcessWhitespace) return sanitized;
  return collapseWhitespace(sanitized, getTrailingSeparator(normalized));
}

export function insertAtSelection(
  value: string,
  selection: TextSelection,
  text: string,
): {
  nextValue: string;
  nextSelection: TextSelection;
} {
  const source = value ?? '';
  const maxIndex = source.length;
  const start = Math.max(0, Math.min(selection.start, maxIndex));
  const end = Math.max(start, Math.min(selection.end, maxIndex));
  const insertion = sanitizeTransposerInput(text);
  const nextValue = `${source.slice(0, start)}${insertion}${source.slice(end)}`;
  const cursor = start + insertion.length;

  return {
    nextValue,
    nextSelection: { start: cursor, end: cursor },
  };
}

export function insertTokenAtSelection(
  value: string,
  selection: TextSelection,
  token: {
    sign: TransposerTokenSign;
    hole: string;
    suffix: TransposerTokenSuffix;
  },
): {
  nextValue: string;
  nextSelection: TextSelection;
} {
  return insertAtSelection(value, selection, `${token.sign}${token.hole}${token.suffix}`);
}

export function deleteBackwardAtSelection(
  value: string,
  selection: TextSelection,
): {
  nextValue: string;
  nextSelection: TextSelection;
} {
  const source = value ?? '';
  const maxIndex = source.length;
  const start = Math.max(0, Math.min(selection.start, maxIndex));
  const end = Math.max(start, Math.min(selection.end, maxIndex));

  if (start !== end) {
    return {
      nextValue: `${source.slice(0, start)}${source.slice(end)}`,
      nextSelection: { start, end: start },
    };
  }

  if (start === 0) {
    return {
      nextValue: source,
      nextSelection: { start: 0, end: 0 },
    };
  }

  const cursor = start - 1;
  return {
    nextValue: `${source.slice(0, cursor)}${source.slice(end)}`,
    nextSelection: { start: cursor, end: cursor },
  };
}
