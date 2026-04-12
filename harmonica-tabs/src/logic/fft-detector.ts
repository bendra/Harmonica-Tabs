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

/**
 * Below this RMS level the signal is treated as silence and detection is skipped.
 * Matches the threshold used by the original autocorrelation detector.
 */
const MIN_RMS = 0.005;

/**
 * One scored note from a detection frame — used only in the debug overlay.
 * Frequency is the note's frequency in Hz; confidence is its share of total energy.
 */
export type DetectionCandidate = {
  frequency: number;
  confidence: number;
};

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
  /**
   * Top 3 scoring notes this frame, sorted by confidence descending.
   * Populated only when __DEV__ is true to avoid production overhead.
   */
  candidates: DetectionCandidate[];
};

/**
 * Result of chord detection.
 */
export type ChordResult = {
  /** All notes with significant energy in this frame. Empty in silence. */
  activeNotes: HarmonicaNote[];
  rms: number;
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
 * Confidence is the winner's share of total energy across all candidate notes —
 * a clean, tonal signal concentrates energy at one note (high confidence), while
 * noise spreads it across many (low confidence).
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
    return { frequency: null, confidence: 0, rms, candidates: [] };
  }

  const { allNotes } = vocabulary;
  if (allNotes.length === 0) return { frequency: null, confidence: 0, rms, candidates: [] };

  const scores = allNotes.map((note) => scoreNote(note, input, sampleRate));
  const totalScore = scores.reduce((sum, s) => sum + s, 0);
  if (totalScore === 0) return { frequency: null, confidence: 0, rms, candidates: [] };

  let bestIndex = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[bestIndex]) bestIndex = i;
  }

  const confidence = scores[bestIndex] / totalScore;
  const winner = allNotes[bestIndex];

  // Build top-3 candidates for the debug overlay (dev builds only).
  const candidates: DetectionCandidate[] = typeof __DEV__ !== 'undefined' && __DEV__
    ? allNotes
        .map((note, i) => ({ frequency: note.frequency, confidence: scores[i] / totalScore }))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3)
    : [];

  if (confidence < winner.confidenceThreshold) {
    return { frequency: null, confidence, rms, candidates };
  }

  return { frequency: winner.frequency, confidence, rms, candidates };
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
