import { HarmonicaNote, HarmonicaVocabulary } from './harmonica-frequencies';

/**
 * Only the fundamental is scored. Harmonics are intentionally excluded.
 *
 * Including harmonics seems appealing (real harmonica notes have overtones), but
 * it causes octave errors: note N's 2nd harmonic slot is the same frequency as
 * note 2N's fundamental. Weighting that slot boosts the sub-octave note's score
 * whenever the upper octave is playing, causing misdetection one octave low.
 *
 * Harmonica fundamentals are strong enough that the fundamental alone gives
 * reliable detection. Harmonics can be reintroduced later with proper
 * interference correction if needed.
 */
const HARMONIC_WEIGHTS = [1.0];
const FUNDAMENTAL_RECOVERY_HARMONICS = [2, 3];
const FUNDAMENTAL_RECOVERY_MAX_DEVIATION_CENTS = 35;
const FIRST_REGISTER_ALIAS_MIN_DIRECT_SHARE = 0.045;
const FIRST_REGISTER_ALIAS_MULTI_HARMONIC_MIN_DIRECT_SHARE = 0.02;
const FIRST_REGISTER_ALIAS_SIGNIFICANT_SUPPORT_RATIO = 0.5;
const FIRST_REGISTER_ALIAS_MIN_ADVANTAGE = 1.0;

/**
 * Below this RMS level the signal is treated as silence and detection is skipped.
 * Matches the threshold used by the original autocorrelation detector.
 */
const MIN_RMS = 0.005;

/**
 * Result of single-note detection. Shape matches the existing PitchUpdate type
 * so the FFT detector can be a drop-in replacement in the audio pipeline.
 */
export type SingleNoteResult = {
  /** Frequency of the detected note in Hz, or null if none detected. */
  frequency: number | null;
  /** 0–1: winner's share of total energy across all candidate notes. */
  confidence: number;
  rms: number;
};

/**
 * Result of chord detection.
 */
export type ChordResult = {
  /** All notes with significant energy in this frame. Empty in silence. */
  activeNotes: HarmonicaNote[];
  rms: number;
};

type WinnerSelection = {
  noteIndex: number;
  supportScore: number;
};

type HarmonicFamilySupport = {
  supportScore: number;
  harmonicSupportCount: number;
};

/**
 * Computes power at a target frequency using the Goertzel algorithm.
 *
 * The Goertzel algorithm efficiently computes the DFT magnitude at a single
 * frequency in O(N) — no full FFT needed. Ideal when only a small, known set
 * of target frequencies needs to be evaluated.
 */
function goertzelPower(input: Float32Array, targetFreq: number, sampleRate: number): number {
  const omega = (2 * Math.PI * targetFreq) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < input.length; i++) {
    const s = input[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  // Goertzel power formula: |X(f)|^2 without computing the complex DFT directly.
  return s2 * s2 + s1 * s1 - coeff * s1 * s2;
}

/**
 * Scores a note by summing Goertzel power at its fundamental and harmonics.
 */
function scoreNote(note: HarmonicaNote, input: Float32Array, sampleRate: number): number {
  const nyquist = sampleRate / 2;
  let score = 0;
  for (let h = 0; h < HARMONIC_WEIGHTS.length; h++) {
    const freq = note.frequency * (h + 1);
    if (freq >= nyquist) break;
    score += HARMONIC_WEIGHTS[h] * goertzelPower(input, freq, sampleRate);
  }
  return score;
}

function centsBetween(a: number, b: number): number {
  return 1200 * Math.log2(a / b);
}

function isNearHarmonic(baseFrequency: number, candidateFrequency: number, harmonic: number): boolean {
  const expectedFrequency = baseFrequency * harmonic;
  return Math.abs(centsBetween(candidateFrequency, expectedFrequency)) <= FUNDAMENTAL_RECOVERY_MAX_DEVIATION_CENTS;
}

function isFirstRegisterAliasSourceCandidate(note: HarmonicaNote): boolean {
  if (note.isBend) {
    return false;
  }

  return note.hole === 1 || (note.hole === 2 && note.technique === 'blow');
}

function buildNaturalHarmonicFamilySupport(
  baseIndex: number,
  baseNote: HarmonicaNote,
  notes: HarmonicaNote[],
  scores: number[],
): HarmonicFamilySupport {
  const baseScore = scores[baseIndex];
  let supportScore = 0;
  let harmonicSupportCount = 0;
  for (let index = 0; index < notes.length; index++) {
    const note = notes[index];
    if (note.isBend) continue;
    if (note.frequency === baseNote.frequency) {
      supportScore += scores[index];
      continue;
    }
    const supportsBase = FUNDAMENTAL_RECOVERY_HARMONICS.some((harmonic) =>
      isNearHarmonic(baseNote.frequency, note.frequency, harmonic),
    );
    if (supportsBase) {
      supportScore += scores[index];
      if (scores[index] >= baseScore * FIRST_REGISTER_ALIAS_SIGNIFICANT_SUPPORT_RATIO) {
        harmonicSupportCount += 1;
      }
    }
  }
  return { supportScore, harmonicSupportCount };
}

/**
 * Recovers a lower fundamental when its louder 2nd or 3rd harmonic would
 * otherwise win outright.
 *
 * This keeps the detector from snapping low notes upward (for example `1 -> 4`)
 * while still requiring a meaningful amount of true fundamental energy before
 * we trust the lower note.
 */
function chooseWinningNote(notes: HarmonicaNote[], scores: number[], totalScore: number): WinnerSelection {
  let winnerIndex = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[winnerIndex]) winnerIndex = i;
  }

  const winnerScore = scores[winnerIndex];
  const winnerNote = notes[winnerIndex];
  let selectedIndex = winnerIndex;
  let selectedSupportScore = winnerScore;

  for (let candidateIndex = 0; candidateIndex < winnerIndex; candidateIndex++) {
    const candidateScore = scores[candidateIndex];
    const candidateNote = notes[candidateIndex];
    if (!isFirstRegisterAliasSourceCandidate(candidateNote) || winnerNote.isBend) {
      continue;
    }

    const winnerLooksLikeHarmonic = FUNDAMENTAL_RECOVERY_HARMONICS.some((harmonic) =>
      isNearHarmonic(candidateNote.frequency, winnerNote.frequency, harmonic),
    );
    if (!winnerLooksLikeHarmonic) continue;

    const familySupport = buildNaturalHarmonicFamilySupport(candidateIndex, candidateNote, notes, scores);
    if (familySupport.harmonicSupportCount === 0) {
      continue;
    }

    const minDirectShare =
      familySupport.harmonicSupportCount >= 2
        ? FIRST_REGISTER_ALIAS_MULTI_HARMONIC_MIN_DIRECT_SHARE
        : FIRST_REGISTER_ALIAS_MIN_DIRECT_SHARE;
    if (candidateScore / totalScore < minDirectShare) {
      continue;
    }

    const familySupportScore = familySupport.supportScore;
    if (familySupportScore < selectedSupportScore * FIRST_REGISTER_ALIAS_MIN_ADVANTAGE) {
      continue;
    }

    if (
      familySupportScore > selectedSupportScore ||
      (familySupportScore === selectedSupportScore && candidateNote.frequency < notes[selectedIndex].frequency)
    ) {
      selectedIndex = candidateIndex;
      selectedSupportScore = familySupportScore;
    }
  }

  return {
    noteIndex: selectedIndex,
    supportScore: selectedSupportScore,
  };
}

/**
 * Calculates root-mean-square energy of an audio frame.
 */
export function calculateRms(input: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    sum += input[i] * input[i];
  }
  return Math.sqrt(sum / input.length);
}

/**
 * Detects the single strongest note in the input buffer.
 *
 * Confidence is the selected note's supported share of total energy across all
 * candidate notes. In the normal case that is just the winning note's score.
 * For low notes with stronger 2nd/3rd harmonics, the selected note can also
 * claim clearly-related harmonic support from higher bins.
 *
 * The winner must exceed its per-note confidenceThreshold. Bent notes have a
 * higher threshold since they are harder to play and more susceptible to
 * harmonic bleed from adjacent natural notes.
 */
export function detectSingleNote(
  input: Float32Array,
  sampleRate: number,
  vocabulary: HarmonicaVocabulary,
): SingleNoteResult {
  const rms = calculateRms(input);
  if (rms < MIN_RMS) {
    return { frequency: null, confidence: 0, rms };
  }

  const { allNotes } = vocabulary;
  if (allNotes.length === 0) return { frequency: null, confidence: 0, rms };

  const scores = allNotes.map((note) => scoreNote(note, input, sampleRate));
  const totalScore = scores.reduce((sum, s) => sum + s, 0);
  if (totalScore === 0) return { frequency: null, confidence: 0, rms };

  const selection = chooseWinningNote(allNotes, scores, totalScore);
  const confidence = selection.supportScore / totalScore;
  const winner = allNotes[selection.noteIndex];

  if (confidence < winner.confidenceThreshold) {
    return { frequency: null, confidence, rms };
  }

  return { frequency: winner.frequency, confidence, rms };
}

/**
 * Detects all notes simultaneously present in the input buffer (chord detection).
 *
 * Uses naturalNotes only — bends are physically incompatible with multi-hole
 * playing and are excluded from the chord vocabulary.
 *
 * Each note is compared to the strongest note in the frame. A note is considered
 * active if its score is at least (confidenceThreshold × maxScore) — so on a C
 * harmonica, a note needs to be at least 30% as strong as the loudest note present.
 *
 * This relative comparison means three equal-strength notes each score ~33% of
 * the strongest, all clearing the 30% bar, while harmonic bleed from a single
 * strong note (typically 10–20% of the fundamental) falls below it.
 */
export function detectChord(
  input: Float32Array,
  sampleRate: number,
  vocabulary: HarmonicaVocabulary,
): ChordResult {
  const rms = calculateRms(input);
  if (rms < MIN_RMS) {
    return { activeNotes: [], rms };
  }

  const { naturalNotes } = vocabulary;
  if (naturalNotes.length === 0) return { activeNotes: [], rms };

  const scores = naturalNotes.map((note) => scoreNote(note, input, sampleRate));
  const maxScore = Math.max(...scores);
  if (maxScore === 0) return { activeNotes: [], rms };

  const activeNotes = naturalNotes.filter(
    (note, i) => scores[i] / maxScore >= note.confidenceThreshold,
  );

  return { activeNotes, rms };
}
