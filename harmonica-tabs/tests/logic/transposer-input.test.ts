import { describe, expect, it } from 'vitest';
import {
  cleanupTransposerInput,
  deleteBackwardAtSelection,
  insertAtSelection,
  insertTokenAtSelection,
  normalizeTransposerEditInput,
  sanitizeTransposerInput,
  TransposerCleanupOptions,
} from '../../src/logic/transposer-input';

const cleanupDefaults: TransposerCleanupOptions = {
  stripInvalidContent: true,
  removeExcessWhitespace: true,
};

describe('sanitizeTransposerInput', () => {
  it('keeps only allowed transposer characters', () => {
    expect(sanitizeTransposerInput("4 -3'' +5°\nabc_%")).toBe("4 -3'' +5°\n");
  });

  it('normalizes curly apostrophes to straight apostrophes', () => {
    expect(sanitizeTransposerInput('-3’ -3’’')).toBe("-3' -3''");
  });
});

describe('normalizeTransposerEditInput', () => {
  it('normalizes curly apostrophes without stripping ordinary text', () => {
    expect(normalizeTransposerEditInput("Song: -3’ and lyrics")).toBe("Song: -3' and lyrics");
  });
});

describe('cleanupTransposerInput', () => {
  it('extracts tab tokens from mixed content and trims whitespace by default', () => {
    const input = `bending and more with easy video lessons ->click here.



Song:\t  6  6    -6   6  -6   6  -6   7
1.AL-MOST HEAV-EN,WEST VIR-GIN-IA
2.ALL MY MEM'-RIES GATH-ER 'ROUND HER

   -8   -8     8   -8   -6  -6  -6    6  6 -6 7
1.BLUE RIDGE MOUN-TAINS,SHEN-AN-DOAH RIV-ER`;

    expect(cleanupTransposerInput(input, cleanupDefaults)).toBe(`6 6 -6 6 -6 6 -6 7
-8 -8 8 -8 -6 -6 -6 6 6 -6 7`);
  });

  it('handles the longer HarpTabs-style example', () => {
    const input = `y video lessons ->click here.



Song:\t5    5    5   6  5  -4

Ezoic
GO 'WAY FROM MY WIN-DOW

5     5   6    5   5   -4  4
LEAVE AT YOUR OWN CHOS-EN SPEED

5    5   5   5  6    5    -4
I'M NOT THE ONE YOU WANT,BABE

5    5   6   5  -4   4
I'M NOT THE ONE YOU NEED

5    5    5     5    6   5   -4   -4
YOU SAY YOU'RE LOOK-ING FOR SOME-ONE

4   -4  5    5  6   5    -4
NEV-ER WEAK BUT AL-WAYS STRONG

4  -4   5    5   6   5   5  -4
TO PRO-TECT YOU AND DE-FEND YOU

4    -4   5   5    6   5   -4
WHETH-ER YOU ARE RIGHT OR WRONG

-6   -6  -6 -6 -6  -6   6  -6  -7  -7
SOME-ONE TO O-PEN EACH AND EV-'RY DOOR

6   6   6    6  4    7   -7  -6
BUT IT AIN'T ME,BABE, NO ,NO ,NO,

6   6    6   4
IT AIN'T ME,BABE

5    5   -5  5     -4   -4   4   4
IT AIN'T ME YOU'RE LOOK-ING FOR,BABE


Ezoic
108 users have Favorited this tab
x

Pause

Unmute

Fullscreen
Now Playing`;

    expect(cleanupTransposerInput(input, cleanupDefaults)).toBe(`5 5 5 6 5 -4
5 5 6 5 5 -4 4
5 5 5 5 6 5 -4
5 5 6 5 -4 4
5 5 5 5 6 5 -4 -4
4 -4 5 5 6 5 -4
4 -4 5 5 6 5 5 -4
4 -4 5 5 6 5 -4
-6 -6 -6 -6 -6 -6 6 -6 -7 -7
6 6 6 6 4 7 -7 -6
6 6 6 4
5 5 -5 5 -4 -4 4 4`);
  });

  it('keeps only the tab portion from a mixed line', () => {
    expect(cleanupTransposerInput('Song:\t5    5    5   6  5  -4', cleanupDefaults)).toBe('5 5 5 6 5 -4');
  });

  it('drops lyric-only lines when stripping is enabled', () => {
    expect(cleanupTransposerInput("GO 'WAY FROM MY WIN-DOW", cleanupDefaults)).toBe('');
  });

  it('can normalize whitespace without stripping invalid content', () => {
    expect(
      cleanupTransposerInput("  4   -4  \n\n  5   -5  ", {
        stripInvalidContent: false,
        removeExcessWhitespace: true,
      }),
    ).toBe("4 -4\n\n5 -5 ");
  });

  it('preserves spacing when whitespace cleanup is disabled', () => {
    expect(
      cleanupTransposerInput('Song:\t5    5   -4', {
        stripInvalidContent: true,
        removeExcessWhitespace: false,
      }),
    ).toBe('\t5    5   -4');
  });

  it('returns an empty string when no tab content is found', () => {
    expect(cleanupTransposerInput('lyrics only', cleanupDefaults)).toBe('');
  });

  it('drops free-floating symbols and out-of-range hole numbers', () => {
    expect(cleanupTransposerInput("- ' 0 11", cleanupDefaults)).toBe('');
  });

  it('keeps valid tokens while stripping invalid trailing symbols', () => {
    expect(cleanupTransposerInput("-1 10 1- 4'' '", cleanupDefaults)).toBe("-1 10 1 4''");
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

  it('keeps surrounding raw text when inserting quick symbols', () => {
    const result = insertAtSelection('Song: 5 5', { start: 0, end: 0 }, '-');
    expect(result.nextValue).toBe('-Song: 5 5');
    expect(result.nextSelection).toEqual({ start: 1, end: 1 });
  });

  it('normalizes pasted smart quotes and strips invalid characters at the caret', () => {
    const result = insertAtSelection('', { start: 0, end: 0 }, "4 -3’ +5°\nabc_%");
    expect(result.nextValue).toBe("4 -3' +5°\n");
    expect(result.nextSelection).toEqual({ start: 10, end: 10 });
  });

  it('sanitizes pasted content when replacing a selected range', () => {
    const result = insertAtSelection('4 xxx 5', { start: 2, end: 5 }, "-6’ lyrics");
    expect(result.nextValue).toBe("4 -6'  5");
    expect(result.nextSelection).toEqual({ start: 6, end: 6 });
  });
});

describe('insertTokenAtSelection', () => {
  it('inserts a full tab token at the current cursor', () => {
    const result = insertTokenAtSelection('4 5', { start: 1, end: 1 }, { sign: '-', hole: '4', suffix: '' });
    expect(result.nextValue).toBe('4-4 5');
    expect(result.nextSelection).toEqual({ start: 3, end: 3 });
  });

  it('replaces the selected range with a full token', () => {
    const result = insertTokenAtSelection('4 x 5', { start: 2, end: 3 }, { sign: '', hole: '6', suffix: "'" });
    expect(result.nextValue).toBe("4 6' 5");
    expect(result.nextSelection).toEqual({ start: 4, end: 4 });
  });

  it('supports hole 10 and degree suffix', () => {
    const result = insertTokenAtSelection('', { start: 0, end: 0 }, { sign: '+', hole: '10', suffix: '°' });
    expect(result.nextValue).toBe('+10°');
    expect(result.nextSelection).toEqual({ start: 4, end: 4 });
  });

  it('supports repeated apostrophe suffixes', () => {
    const result = insertTokenAtSelection('', { start: 0, end: 0 }, { sign: '-', hole: '3', suffix: "'''" });
    expect(result.nextValue).toBe("-3'''");
    expect(result.nextSelection).toEqual({ start: 5, end: 5 });
  });
});

describe('deleteBackwardAtSelection', () => {
  it('deletes the selected range when text is selected', () => {
    const result = deleteBackwardAtSelection('4 -4 5', { start: 2, end: 4 });
    expect(result.nextValue).toBe('4  5');
    expect(result.nextSelection).toEqual({ start: 2, end: 2 });
  });

  it('deletes the previous character when the selection is collapsed', () => {
    const result = deleteBackwardAtSelection('4 -4 5', { start: 4, end: 4 });
    expect(result.nextValue).toBe('4 - 5');
    expect(result.nextSelection).toEqual({ start: 3, end: 3 });
  });

  it('keeps the value unchanged at the beginning of the input', () => {
    const result = deleteBackwardAtSelection('4 -4 5', { start: 0, end: 0 });
    expect(result.nextValue).toBe('4 -4 5');
    expect(result.nextSelection).toEqual({ start: 0, end: 0 });
  });
});
