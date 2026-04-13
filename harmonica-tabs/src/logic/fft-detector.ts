import { HarmonicaNote, HarmonicaVocabulary } from './harmonica-frequencies';

// ---------------------------------------------------------------------------
// Goertzel — used for chord detection only
//
// Goertzel scores individual known frequencies efficiently (O(N) per target).
// It is no longer used for single-note detection: real harmonica reeds produce
// sub-harmonic and perfect-fifth energy that causes Goertzel to pick the wrong
// note. YIN (below) handles single-note detection instead.
// ---------------------------------------------------------------------------

/**
 * Only the fundamental is scored. Harmonics are intentionally excluded for
 * chord detection: a low note's 2nd harmonic coincides with a higher note's
 * fundamental and would cause false chord members to appear.
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

// ---------------------------------------------------------------------------
// YIN pitch detection — used for single-note detection
//
// YIN (de Cheveigné & Kawahara, 2002) works in the time domain. It finds the
// shortest lag τ at which the signal looks like a shifted copy of itself,
// which is the fundamental period T. The frequency is then sampleRate / T.
//
// The key innovation over plain autocorrelation is the cumulative mean
// normalized difference (CMND). Plain autocorrelation has strong peaks at
// sub-multiples of the period (octave errors). The CMND normalises each lag
// by the running mean of all shorter lags, which suppresses those sub-octave
// peaks so the true fundamental always wins.
// ---------------------------------------------------------------------------

/**
 * CMND threshold: a lag must produce a value below this to be accepted as the
 * fundamental period. Lower = stricter (fewer false positives, may miss quiet
 * or noisy notes). 0.10 is the value recommended in the YIN paper for music.
 */
const YIN_THRESHOLD = 0.10;

/**
 * Step 1 of YIN: compute the difference function.
 *
 *   d[τ] = Σ_{j=0}^{W-1} (x[j] − x[j+τ])²
 *
 * d[τ] is small when the signal looks like itself shifted by τ samples —
 * i.e., when τ is close to the signal's repeating period.
 *
 * W (the integration window) is the first half of the buffer, so both x[j]
 * and x[j+τ] are in-bounds for all τ up to maxLag.
 */
function yinDifference(input: Float32Array, maxLag: number): Float32Array {
  const W = Math.floor(input.length / 2);
  const d = new Float32Array(maxLag + 1);
  // d[0] = 0 always (signal is identical to itself with zero shift).
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let j = 0; j < W; j++) {
      const delta = input[j] - input[j + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }
  return d;
}

/**
 * Step 2 of YIN: cumulative mean normalization.
 *
 *   d'[0] = 1  (by definition)
 *   d'[τ] = d[τ] × τ / Σ_{j=1}^{τ} d[j]   for τ > 0
 *
 * As τ grows the denominator (running mean × τ) grows, pulling the normalized
 * value up for sub-octave lags. The true period produces the first dip below
 * the threshold; a 2× sub-octave lag produces a shallower dip that the
 * threshold rejects.
 */
function yinCmnd(d: Float32Array): Float32Array {
  const cmnd = new Float32Array(d.length);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < d.length; tau++) {
    runningSum += d[tau];
    cmnd[tau] = runningSum === 0 ? 0 : (d[tau] * tau) / runningSum;
  }
  return cmnd;
}

/**
 * Step 4 of YIN: parabolic interpolation for sub-sample lag precision.
 *
 * Fits a parabola to the three CMND values around the detected minimum and
 * returns the vertex location, giving a fractional lag more accurate than
 * the integer sample grid.
 */
function parabolicInterpolation(cmnd: Float32Array, tau: number): number {
  if (tau <= 0 || tau >= cmnd.length - 1) return tau;
  const prev = cmnd[tau - 1];
  const curr = cmnd[tau];
  const next = cmnd[tau + 1];
  const denom = 2 * (prev - 2 * curr + next);
  if (denom === 0) return tau;
  return tau + (prev - next) / denom;
}

/**
 * Full YIN pitch detector.
 *
 * Returns the detected fundamental frequency in Hz, or null if the signal is
 * not sufficiently periodic (silence, noise, or a pitch outside the requested
 * range).
 *
 * `minFreq` and `maxFreq` should bracket the vocabulary of the harmonica being
 * detected — see `detectSingleNote` where these are derived from `allNotes`.
 * Using vocabulary-derived bounds avoids two problems with fixed constants:
 *   - Fixed upper bound too low → misses high notes (e.g. A6 on hole 10 draw)
 *   - Fixed lower bound too high → aliases of extreme out-of-range signals
 *     (e.g. 8000 Hz) can land within the search window and produce false matches
 */
function yinDetect(
  input: Float32Array,
  sampleRate: number,
  minFreq: number,
  maxFreq: number,
): number | null {
  const minLag = Math.floor(sampleRate / maxFreq); // shortest period = highest freq
  const maxLag = Math.floor(sampleRate / minFreq); // longest  period = lowest  freq

  // Need at least 2× maxLag samples so both x[j] and x[j+τ] are in-bounds.
  if (input.length < maxLag * 2) return null;

  const d = yinDifference(input, maxLag);
  const cmnd = yinCmnd(d);

  // Step 3: find the first lag ≥ minLag where CMND dips below the threshold,
  // then follow the dip to its local minimum for better accuracy.
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cmnd[tau] < YIN_THRESHOLD) {
      while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) {
        tau++;
      }
      const refined = parabolicInterpolation(cmnd, tau);
      return sampleRate / refined;
    }
  }

  return null; // no clear fundamental in range
}

/**
 * Converts a note's confidenceThreshold to a pitch acceptance window (cents).
 *
 * Notes with higher thresholds (bends, overblows) require the detected pitch
 * to be closer to the target to be accepted, because those techniques demand
 * precise embouchure control and should not trigger on adjacent natural notes.
 *
 *   threshold 0.30 (natural) → ±50 cents
 *   threshold 0.50 (bend)    → ±36 cents
 *   threshold 0.65 (overblow)→ ±25 cents
 */
function centsTolerance(confidenceThreshold: number): number {
  return (50 * (1 - confidenceThreshold)) / 0.7;
}

/**
 * Detects the single strongest note in the input buffer.
 *
 * Uses the YIN algorithm to find the fundamental frequency, then maps that
 * frequency to the nearest note in the harmonica vocabulary. Confidence is
 * how close the detected pitch is to the matched note (1.0 = exact, 0.0 = at
 * the edge of the acceptance window).
 *
 * The per-note confidenceThreshold now controls the acceptance window in
 * cents rather than a Goertzel score share — tighter for bends and overblows.
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

  // Derive frequency bounds from the actual vocabulary so YIN's lag search
  // covers exactly the notes this harmonica can play — no more, no less.
  // The 10% margin gives parabolic interpolation room at the edges.
  const minFreq = allNotes[0].frequency * 0.9;
  const maxFreq = allNotes[allNotes.length - 1].frequency * 1.1;

  // Detect the fundamental frequency using YIN.
  const fundamental = yinDetect(input, sampleRate, minFreq, maxFreq);
  if (fundamental === null) {
    return { frequency: null, confidence: 0, rms, candidates: [] };
  }

  // Convert to fractional MIDI for cent-accurate distance comparisons.
  const detectedMidi = 69 + 12 * Math.log2(fundamental / 440);

  // Find the nearest vocabulary note by pitch distance in cents.
  let nearestNote: HarmonicaNote | null = null;
  let nearestCents = Infinity;
  for (const note of allNotes) {
    const cents = Math.abs((detectedMidi - note.midi) * 100);
    if (cents < nearestCents) {
      nearestCents = cents;
      nearestNote = note;
    }
  }

  if (nearestNote === null) return { frequency: null, confidence: 0, rms, candidates: [] };

  // Reject if the pitch is too far from any vocabulary note.
  const tolerance = centsTolerance(nearestNote.confidenceThreshold);
  if (nearestCents > tolerance) {
    return { frequency: null, confidence: 0, rms, candidates: [] };
  }

  // Confidence: 1.0 = exactly on pitch, 0.0 = at the edge of the window.
  const confidence = 1 - nearestCents / tolerance;

  // Debug candidates: nearest 3 vocabulary notes by MIDI proximity.
  const candidates: DetectionCandidate[] = typeof __DEV__ !== 'undefined' && __DEV__
    ? allNotes
        .map((note) => ({
          frequency: note.frequency,
          confidence: Math.max(0, 1 - (Math.abs(detectedMidi - note.midi) * 100) / 100),
        }))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3)
    : [];

  return { frequency: nearestNote.frequency, confidence, rms, candidates };
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
