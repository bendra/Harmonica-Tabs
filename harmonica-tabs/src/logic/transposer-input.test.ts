import { describe, expect, it } from 'vitest';
import {
  cleanupTransposerInput,
  insertAtSelection,
  sanitizeTransposerInput,
  TransposerCleanupOptions,
} from './transposer-input';

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

  it('supports partial manual typing when stripping is enabled', () => {
    expect(cleanupTransposerInput('-', cleanupDefaults)).toBe('-');
    expect(cleanupTransposerInput('5 ', cleanupDefaults)).toBe('5 ');
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

  it('applies cleanup options to inserted text when provided', () => {
    const result = insertAtSelection('Song: 5 5', { start: 0, end: 0 }, '', cleanupDefaults);
    expect(result.nextValue).toBe('5 5');
  });
});
