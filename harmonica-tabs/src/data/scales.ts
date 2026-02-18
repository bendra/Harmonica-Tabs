export type ScaleDefinition = {
  id: string;
  name: string;
  intervals: number[];
};

export const SCALE_DEFINITIONS: ScaleDefinition[] = [
  { id: 'major', name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'natural_minor', name: 'Natural Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonic_minor', name: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'dorian', name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'mixolydian', name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'blues_minor', name: 'Blues Minor', intervals: [0, 3, 5, 6, 7, 10] },
];
