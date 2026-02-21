import { noteToPc, NoteName } from './notes';

export type HarmonicaKey = {
  label: NoteName;
  pc: number;
  preferFlats: boolean;
};

const FLAT_KEYS = new Set<NoteName>(['F', 'Bb', 'Eb', 'Ab', 'Db']);

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

export const HARMONICA_KEYS: HarmonicaKey[] = KEY_ORDER.map((label) => ({
  label,
  pc: noteToPc(label),
  preferFlats: FLAT_KEYS.has(label),
}));
