import { noteToPc, NoteName } from './notes';

/**
 * Playable harmonica key metadata used by the key selector.
 */
export type HarmonicaKey = {
  /** Printed key name (for example `C` or `Bb`). */
  label: NoteName;
  /** Pitch class of the harmonica key (0-11). */
  pc: number;
  /** Whether UI labels should prefer flat spellings for this key. */
  preferFlats: boolean;
};

/**
 * Keys that usually read better with flats in this app's UI.
 */
const FLAT_KEYS = new Set<NoteName>(['F', 'Bb', 'Eb', 'Ab', 'Db']);

/**
 * Canonical chromatic key order used by dropdowns and position math.
 */
const KEY_ORDER: NoteName[] = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'F#',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
];

/**
 * Harmonica keys shown in the app dropdown in circle-of-fifths order.
 */
export const HARMONICA_KEYS: HarmonicaKey[] = KEY_ORDER.map((label) => ({
  label,
  pc: noteToPc(label),
  preferFlats: FLAT_KEYS.has(label),
}));
