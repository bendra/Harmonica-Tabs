/**
 * Chromatic note names using sharps, indexed by pitch class (C=0...B=11).
 */
export const SHARP_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
/**
 * Chromatic note names using flats, indexed by pitch class (C=0...B=11).
 */
export const FLAT_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

/**
 * All accepted note name spellings in this app.
 */
export type NoteName = (typeof SHARP_NOTES)[number] | (typeof FLAT_NOTES)[number];

/**
 * Lookup table from note names (including enharmonics) to pitch class.
 */
const NOTE_TO_PC: Record<NoteName, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};

/**
 * Converts a note label into its pitch-class number (0-11).
 */
export function noteToPc(note: NoteName): number {
  return NOTE_TO_PC[note];
}

/**
 * Converts a pitch class to a note label, using sharps or flats.
 */
export function pcToNote(pc: number, preferFlats: boolean): NoteName {
  const index = ((pc % 12) + 12) % 12;
  return preferFlats ? FLAT_NOTES[index] : SHARP_NOTES[index];
}

/**
 * Normalizes any integer to the 12-tone pitch-class range (0-11).
 */
export function normalizePc(pc: number): number {
  return ((pc % 12) + 12) % 12;
}
