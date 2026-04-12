import { RICHTER_C_LAYOUT, transposeLayout } from '../data/richter';
import { midiToFrequency } from './pitch';

/**
 * A single detectable note in the harmonica's vocabulary.
 */
export type HarmonicaNote = {
  midi: number;
  frequency: number;
  hole: number;
  technique: 'blow' | 'draw' | 'blow-bend' | 'draw-bend' | 'overblow' | 'overdraw';
  isBend: boolean;
  /**
   * Minimum detection confidence required for this note.
   * Higher for bends and overbends — they are harder to play and more likely
   * to be confused with harmonic bleed from adjacent notes.
   */
  confidenceThreshold: number;
};

/**
 * Full set of detectable notes for a harmonica in a given key.
 */
export type HarmonicaVocabulary = {
  /** All playable notes including bends — use for single-note detection. */
  allNotes: HarmonicaNote[];
  /**
   * Blow and draw notes only — use for chord detection.
   * Bends require embouchure control incompatible with multi-hole playing,
   * so they are excluded from the chord vocabulary.
   */
  naturalNotes: HarmonicaNote[];
};

const CONFIDENCE_THRESHOLD: Record<HarmonicaNote['technique'], number> = {
  blow: 0.30,
  draw: 0.30,
  'blow-bend': 0.50,
  'draw-bend': 0.50,
  overblow: 0.65,
  overdraw: 0.65,
};
const HIGH_REGISTER_NATURAL_THRESHOLD_BY_HOLE: Partial<Record<number, number>> = {
  9: 0.18,
  10: 0.16,
};

// Lower rank = easier technique. Used to pick the best entry when two holes
// produce the same MIDI (e.g. hole 2 draw and hole 3 blow both produce G4).
const TECHNIQUE_RANK: Record<HarmonicaNote['technique'], number> = {
  blow: 0,
  draw: 0,
  'blow-bend': 1,
  'draw-bend': 1,
  overblow: 2,
  overdraw: 2,
};

function getConfidenceThreshold(
  hole: number,
  technique: HarmonicaNote['technique'],
): number {
  const baseThreshold = CONFIDENCE_THRESHOLD[technique];
  const isNaturalNote = technique === 'blow' || technique === 'draw';
  if (!isNaturalNote) return baseThreshold;

  return HIGH_REGISTER_NATURAL_THRESHOLD_BY_HOLE[hole] ?? baseThreshold;
}

/**
 * Builds the detectable note vocabulary for a harmonica in the given key
 * pitch class (0 = C, 2 = D, 5 = F, 7 = G, etc.).
 *
 * Notes that produce the same MIDI on multiple holes are deduplicated,
 * keeping the entry with the easiest technique and lowest confidence threshold.
 */
export function buildHarmonicaVocabulary(harmonicaPc: number): HarmonicaVocabulary {
  const layout = transposeLayout(RICHTER_C_LAYOUT, harmonicaPc);
  const candidates: HarmonicaNote[] = [];

  layout.forEach((hole) => {
    function add(midi: number, technique: HarmonicaNote['technique']) {
      const isBend =
        technique === 'blow-bend' ||
        technique === 'draw-bend' ||
        technique === 'overblow' ||
        technique === 'overdraw';
      candidates.push({
        midi,
        frequency: midiToFrequency(midi),
        hole: hole.hole,
        technique,
        isBend,
        confidenceThreshold: getConfidenceThreshold(hole.hole, technique),
      });
    }

    add(hole.blowMidi, 'blow');
    add(hole.drawMidi, 'draw');

    hole.blowBendsMidi.forEach((midi) => {
      // Skip if the bend lands on the same pitch as blow or draw (no net bend).
      if (midi === hole.blowMidi || midi === hole.drawMidi) return;
      add(midi, 'blow-bend');
    });

    hole.drawBendsMidi.forEach((midi) => {
      if (midi === hole.blowMidi || midi === hole.drawMidi) return;
      add(midi, 'draw-bend');
    });

    if (hole.overblowMidi !== undefined) {
      if (hole.overblowMidi !== hole.blowMidi && hole.overblowMidi !== hole.drawMidi) {
        add(hole.overblowMidi, 'overblow');
      }
    }

    if (hole.overdrawMidi !== undefined) {
      if (hole.overdrawMidi !== hole.blowMidi && hole.overdrawMidi !== hole.drawMidi) {
        add(hole.overdrawMidi, 'overdraw');
      }
    }
  });

  // Deduplicate by MIDI, keeping the easiest technique.
  const byMidi = new Map<number, HarmonicaNote>();
  candidates.forEach((note) => {
    const existing = byMidi.get(note.midi);
    if (!existing || TECHNIQUE_RANK[note.technique] < TECHNIQUE_RANK[existing.technique]) {
      byMidi.set(note.midi, note);
    }
  });

  const allNotes = Array.from(byMidi.values()).sort((a, b) => a.midi - b.midi);
  const naturalNotes = allNotes.filter((n) => !n.isBend);

  return { allNotes, naturalNotes };
}
