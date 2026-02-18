import { noteToPc, NoteName } from './notes';

export type HarmonicaKey = {
  label: NoteName;
  pc: number;
  preferFlats: boolean;
};

const FLAT_KEYS = new Set<NoteName>(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']);

const KEY_ORDER: NoteName[] = [
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F#',
  'C#',
  'F',
  'Bb',
  'Eb',
  'Ab',
  'Db',
  'Gb',
];

export const HARMONICA_KEYS: HarmonicaKey[] = KEY_ORDER.map((label) => ({
  label,
  pc: noteToPc(label),
  preferFlats: FLAT_KEYS.has(label),
}));
