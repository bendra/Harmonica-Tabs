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
  /** Raw YIN fundamental in Hz before vocabulary snapping, or null if YIN found nothing. */
  rawFrequency: number | null;
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
// YIN (de Cheveigné & Kawahara, 2002) finds the fundamental period T as the
// lag τ where the cumulative mean normalized difference (CMND) first dips
// below a threshold. The frequency is then sampleRate / T.
//
// This implementation computes the YIN difference function via FFT-based
// circular autocorrelation (the "yinfft" variant from the aubio library)
// rather than brute-force time-domain summation. The FFT path gives each
// spectral component a balanced, global contribution to the autocorrelation.
// This matters for harmonica reeds: the strong 2nd harmonic inflates the
// time-domain CMND running sum at short lags, making CMND > 1 at the true
// fundamental — geometrically preventing detection. The FFT path avoids that
// inflation because the autocorrelation is computed globally across the
// spectrum, not via a sequential running mean.
// ---------------------------------------------------------------------------

/**
 * CMND threshold: a lag is accepted as the fundamental period when its CMND
 * first dips below this value. Lower = stricter (fewer false positives at the
 * cost of more missed notes). 0.15 works well with the FFT-based difference
 * function; the FFT path keeps CMND bounded so this threshold is reliably reached.
 */
const YIN_THRESHOLD = 0.15;

/**
 * In-place radix-2 Cooley-Tukey FFT (or inverse FFT).
 *
 * `re` and `im` must have the same length, which must be a power of 2.
 * For the forward transform pass `inverse = false`; for the inverse pass
 * `inverse = true`. The inverse transform is not normalized — the caller
 * divides by N to obtain the standard IFFT result.
 *
 * The algorithm:
 *   1. Bit-reversal permutation reorders samples for in-place butterfly passes.
 *   2. Log₂(N) butterfly stages build up the DFT from length-2 sub-problems.
 *
 * Only used internally by yinDifferenceFFT.
 */
function complexFFT(re: Float32Array, im: Float32Array, inverse: boolean): void {
  const N = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  // Butterfly passes
  for (let len = 2; len <= N; len <<= 1) {
    const halfLen = len >> 1;
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wBaseRe = Math.cos(ang);
    const wBaseIm = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let wRe = 1, wIm = 0;
      for (let j = 0; j < halfLen; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + halfLen] * wRe - im[i + j + halfLen] * wIm;
        const vIm = re[i + j + halfLen] * wIm + im[i + j + halfLen] * wRe;
        re[i + j]           = uRe + vRe;
        im[i + j]           = uIm + vIm;
        re[i + j + halfLen] = uRe - vRe;
        im[i + j + halfLen] = uIm - vIm;
        const nextWRe = wRe * wBaseRe - wIm * wBaseIm;
        wIm = wRe * wBaseIm + wIm * wBaseRe;
        wRe = nextWRe;
      }
    }
  }
}

/**
 * Step 1 of YIN (FFT variant): compute the difference function via circular
 * autocorrelation.
 *
 * The relationship between the YIN difference function d[τ] and the circular
 * autocorrelation r[τ] is:
 *
 *   d[τ] = 2 × (r[0] − r[τ])
 *
 * r[τ] is computed as IFFT(|X(f)|²) where X(f) = FFT(windowed input).
 * A Hann window is applied first to reduce spectral leakage.
 *
 * Why this is better than the time-domain formula for harmonica audio:
 * In time-domain YIN, d[τ] = Σ(x[j]−x[j+τ])². When a strong 2nd harmonic
 * (e.g. G6 when playing G5) makes d very small at short lags, the CMND
 * running sum becomes tiny, inflating CMND above 1 at the true fundamental's
 * lag — making detection impossible regardless of threshold. The FFT
 * autocorrelation avoids this: r[τ] at the fundamental lag receives a positive
 * contribution from every partial that is also periodic there (including the
 * 2nd harmonic, which is periodic at twice its own period = the fundamental),
 * keeping d[τ] and CMND in a physically meaningful range.
 */
function yinDifferenceFFT(input: Float32Array, maxLag: number): Float32Array {
  const N = input.length;

  // Apply Hann window to the input, place in complex arrays.
  const re = new Float32Array(N);
  const im = new Float32Array(N); // stays zero — input is real
  for (let i = 0; i < N; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    re[i] = input[i] * w;
  }

  // Forward FFT: re/im now hold X(f).
  complexFFT(re, im, false);

  // Power spectrum: |X(f)|² — replace each bin, zero the imaginary part.
  for (let f = 0; f < N; f++) {
    re[f] = re[f] * re[f] + im[f] * im[f];
    im[f] = 0;
  }

  // Inverse FFT: re now holds N × r[τ] (circular autocorrelation, un-normalised).
  complexFFT(re, im, true);

  // r[0] = total windowed signal energy (after dividing by N).
  const r0 = re[0] / N;

  // d[τ] = 2 × (r[0] − r[τ]).  Clamped to ≥ 0 to absorb FFT round-off.
  const d = new Float32Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    d[tau] = Math.max(0, 2 * (r0 - re[tau] / N));
  }
  return d;
}

/**
 * Step 2 of YIN: cumulative mean normalization.
 *
 *   d'[0] = 1  (by definition)
 *   d'[τ] = d[τ] × τ / Σ_{j=1}^{τ} d[j]   for τ > 0
 *
 * Normalizing by the running mean makes the threshold scale-invariant and
 * keeps values in [0, 1] as long as the difference function is well-behaved.
 * The FFT-based d[τ] above ensures this property holds for real harmonica audio.
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
 * Full YIN pitch detector (FFT variant).
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

  if (input.length < maxLag * 2) return null;

  const d = yinDifferenceFFT(input, maxLag);
  const cmnd = yinCmnd(d);

  // Step 3: find the first lag ≥ minLag where CMND dips below the threshold,
  // then follow the dip to its local minimum for better accuracy.
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cmnd[tau] < YIN_THRESHOLD) {
      while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) {
        tau++;
      }
      return sampleRate / parabolicInterpolation(cmnd, tau);
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
    return { frequency: null, rawFrequency: null, confidence: 0, rms, candidates: [] };
  }

  const { allNotes } = vocabulary;
  if (allNotes.length === 0) return { frequency: null, rawFrequency: null, confidence: 0, rms, candidates: [] };

  // Derive frequency bounds from the actual vocabulary so YIN's lag search
  // covers exactly the notes this harmonica can play — no more, no less.
  // The 10% margin gives parabolic interpolation room at the edges.
  const minFreq = allNotes[0].frequency * 0.9;
  const maxFreq = allNotes[allNotes.length - 1].frequency * 1.1;

  // Detect the fundamental frequency using YIN.
  const fundamental = yinDetect(input, sampleRate, minFreq, maxFreq);
  if (fundamental === null) {
    return { frequency: null, rawFrequency: null, confidence: 0, rms, candidates: [] };
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

  if (nearestNote === null) return { frequency: null, rawFrequency: fundamental, confidence: 0, rms, candidates: [] };

  // Reject if the pitch is too far from any vocabulary note.
  const tolerance = centsTolerance(nearestNote.confidenceThreshold);
  if (nearestCents > tolerance) {
    return { frequency: null, rawFrequency: fundamental, confidence: 0, rms, candidates: [] };
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

  return { frequency: nearestNote.frequency, rawFrequency: fundamental, confidence, rms, candidates };
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
