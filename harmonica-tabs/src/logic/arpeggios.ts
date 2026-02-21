import { SCALE_DEFINITIONS } from '../data/scales';
import { normalizePc } from '../data/notes';

export type ArpeggioKind = 'triads' | 'sevenths' | 'blues';

export type ArpeggioSpec = {
  id: string;
  label: string;
  rootPc: number;
  pcs: Set<number>;
  orderedPcs: number[];
  kind: ArpeggioKind;
};

export type ArpeggioSection = {
  id: ArpeggioKind;
  title: string;
  note?: string;
  emptyNote?: string;
  items: ArpeggioSpec[];
};

function romanNumeral(index: number): string {
  const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  return numerals[index - 1] ?? `${index}`;
}

function triadQuality(intervals: number[]): string {
  const third = intervals[1];
  const fifth = intervals[2];
  if (third === 4 && fifth === 7) return 'maj';
  if (third === 3 && fifth === 7) return 'min';
  if (third === 3 && fifth === 6) return 'dim';
  if (third === 4 && fifth === 8) return 'aug';
  return 'other';
}

function seventhQuality(intervals: number[]): string {
  const third = intervals[1];
  const fifth = intervals[2];
  const seventh = intervals[3];
  if (third === 4 && fifth === 7 && seventh === 10) return '7';
  if (third === 4 && fifth === 7 && seventh === 11) return 'maj7';
  if (third === 3 && fifth === 7 && seventh === 10) return 'min7';
  if (third === 3 && fifth === 6 && seventh === 10) return 'm7b5';
  if (third === 3 && fifth === 6 && seventh === 9) return 'dim7';
  return 'other7';
}

function intervalsToPcs(rootPc: number, intervals: number[]): number[] {
  return intervals.map((interval) => normalizePc(rootPc + interval));
}

function buildDiatonicTriads(rootPc: number, intervals: number[]): ArpeggioSpec[] {
  const count = intervals.length;
  return intervals.map((interval, index) => {
    const triadIntervals = [
      intervals[index],
      intervals[(index + 2) % count],
      intervals[(index + 4) % count],
    ];
    const orderedPcs = intervalsToPcs(rootPc, triadIntervals);
    const root = orderedPcs[0];
    const relative = [
      0,
      normalizePc(orderedPcs[1] - root),
      normalizePc(orderedPcs[2] - root),
    ];
    const quality = triadQuality(relative);
    const roman = romanNumeral(index + 1);
    return {
      id: `triad:${index}`,
      label: `${roman} ${quality}`,
      rootPc: root,
      pcs: new Set(orderedPcs),
      orderedPcs,
      kind: 'triads',
    };
  });
}

function buildDiatonicSevenths(rootPc: number, intervals: number[]): ArpeggioSpec[] {
  if (intervals.length < 7) return [];
  const count = intervals.length;
  return intervals.map((interval, index) => {
    const seventhIntervals = [
      intervals[index],
      intervals[(index + 2) % count],
      intervals[(index + 4) % count],
      intervals[(index + 6) % count],
    ];
    const orderedPcs = intervalsToPcs(rootPc, seventhIntervals);
    const root = orderedPcs[0];
    const relative = [
      0,
      normalizePc(orderedPcs[1] - root),
      normalizePc(orderedPcs[2] - root),
      normalizePc(orderedPcs[3] - root),
    ];
    const quality = seventhQuality(relative);
    const roman = romanNumeral(index + 1);
    return {
      id: `seventh:${index}`,
      label: `${roman} ${quality}`,
      rootPc: root,
      pcs: new Set(orderedPcs),
      orderedPcs,
      kind: 'sevenths',
    };
  });
}

function buildCommonBluesChords(rootPc: number): ArpeggioSpec[] {
  const roots = [
    { label: 'I7', offset: 0 },
    { label: 'IV7', offset: 5 },
    { label: 'V7', offset: 7 },
  ];
  return roots.map((entry) => {
    const chordRoot = normalizePc(rootPc + entry.offset);
    const orderedPcs = intervalsToPcs(chordRoot, [0, 4, 7, 10]);
    return {
      id: `blues:${entry.label}`,
      label: entry.label,
      rootPc: chordRoot,
      pcs: new Set(orderedPcs),
      orderedPcs,
      kind: 'blues',
    };
  });
}

export function buildArpeggioSections(
  rootPc: number,
  scaleId: string,
  selections: ArpeggioKind[],
): ArpeggioSection[] {
  const scaleDef = SCALE_DEFINITIONS.find((scale) => scale.id === scaleId);
  if (!scaleDef) return [];

  const sections: ArpeggioSection[] = [];

  if (selections.includes('triads')) {
    sections.push({
      id: 'triads',
      title: 'Triads',
      items: buildDiatonicTriads(rootPc, scaleDef.intervals),
    });
  }

  if (selections.includes('sevenths')) {
    const items = buildDiatonicSevenths(rootPc, scaleDef.intervals);
    sections.push({
      id: 'sevenths',
      title: '7th Chords',
      emptyNote: scaleDef.intervals.length < 7 ? 'Needs a 7-note scale.' : 'None',
      items,
    });
  }

  if (selections.includes('blues')) {
    sections.push({
      id: 'blues',
      title: 'Common Blues Chords',
      note: 'May include notes outside the selected scale.',
      items: buildCommonBluesChords(rootPc),
    });
  }

  return sections;
}
