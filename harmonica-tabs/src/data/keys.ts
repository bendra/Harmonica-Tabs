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
 * Harmonica selector order from highest-tuned to lowest-tuned harp.
 */
const KEY_ORDER: NoteName[] = [
  'F#',
  'F',
  'E',
  'Eb',
  'D',
  'Db',
  'C',
  'B',
  'Bb',
  'A',
  'Ab',
  'G',
];

/**
 * Harmonica keys shown in the app dropdown.
 */
export const HARMONICA_KEYS: HarmonicaKey[] = KEY_ORDER.map((label) => ({
  label,
  pc: noteToPc(label),
  preferFlats: FLAT_KEYS.has(label),
}));
