import { calculateRms, magnitudeSpectrum } from './fft-detector';
import { normalizePc } from '../data/notes';

// ---------------------------------------------------------------------------
// Musical key detection via chromagram + Krumhansl–Schmuckler correlation.
//
// This is a *polyphonic* analysis, distinct from the monophonic YIN detector in
// fft-detector.ts. Instead of finding one fundamental, it folds the whole FFT
// magnitude spectrum into a 12-bin pitch-class histogram (a "chroma vector"),
// accumulated over several seconds, then correlates that chroma against the 24
// major/minor key profiles to estimate the song's key.
//
// References: Krumhansl & Kessler (1982) probe-tone key profiles; the standard
// "K-S" key-finding algorithm correlates a pitch-class distribution against
// rotations of these profiles.
// ---------------------------------------------------------------------------

/**
 * Krumhansl–Kessler major key profile, indexed by scale degree (0 = tonic).
 * Higher weights mark pitch classes that listeners rate as more stable/central
 * in a major key (tonic, dominant, mediant lead).
 */
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];

/**
 * Krumhansl–Kessler minor key profile, indexed by scale degree (0 = tonic).
 */
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

export type KeyQuality = 'major' | 'minor';

/**
 * One candidate key with its correlation against the accumulated chroma.
 */
export type KeyCandidate = {
  tonicPc: number;
  quality: KeyQuality;
  /** Pearson correlation of the chroma with this key's profile, in [-1, 1]. */
  correlation: number;
};

/**
 * Result of analysing the accumulated chroma.
 *
 * `confidence` is the winning correlation clamped to [0, 1]; `margin` is how far
 * it beats the runner-up. The UI uses both to decide whether the detection is
 * trustworthy or should prompt a retry.
 */
export type KeyEstimate = {
  tonicPc: number;
  quality: KeyQuality;
  confidence: number;
  margin: number;
  /** All 24 candidates sorted by correlation, strongest first. */
  ranked: KeyCandidate[];
};

/**
 * Minimum winning correlation for a detection to be treated as trustworthy.
 * Below this the UI prompts a retry rather than applying a shaky guess. Tuned
 * conservatively; revisit with the offline eval harness against real audio.
 */
export const KEY_CONFIDENCE_MIN = 0.4;

/** True when an estimate is confident enough to act on. */
export function isConfidentKey(estimate: KeyEstimate | null): estimate is KeyEstimate {
  return estimate !== null && estimate.confidence >= KEY_CONFIDENCE_MIN;
}

export type KeyDetectorConfig = {
  /** Lowest frequency (Hz) that contributes to the chroma. */
  minFreq: number;
  /** Highest frequency (Hz) that contributes to the chroma. */
  maxFreq: number;
  /** Frames quieter than this RMS are skipped as silence. */
  minRms: number;
};

export const DEFAULT_KEY_DETECTOR_CONFIG: KeyDetectorConfig = {
  // Cover roughly A1 (bass) up to ~B6 — where most band fundamentals and chord
  // tones live. Going higher mostly adds harmonics/cymbal noise that blur the
  // chroma; going lower adds rumble.
  minFreq: 55,
  maxFreq: 2000,
  minRms: 0.001,
};

/**
 * Pearson correlation coefficient between two equal-length vectors.
 * Returns 0 when either vector has no variance (avoids divide-by-zero).
 */
export function pearson(a: number[], b: number[]): number {
  const n = a.length;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  if (varA === 0 || varB === 0) return 0;
  return cov / Math.sqrt(varA * varB);
}

/**
 * Correlates a 12-bin chroma vector against all 24 key profiles and returns the
 * best estimate plus the full ranked list. Exposed separately from the detector
 * so it can be unit-tested directly on a hand-built chroma.
 */
export function estimateKeyFromChroma(chroma: number[]): KeyEstimate {
  const candidates: KeyCandidate[] = [];

  for (let tonicPc = 0; tonicPc < 12; tonicPc++) {
    // Rotate each profile so its tonic aligns with `tonicPc`, then correlate.
    const major = MAJOR_PROFILE.map((_, pc) => MAJOR_PROFILE[normalizePc(pc - tonicPc)]);
    const minor = MINOR_PROFILE.map((_, pc) => MINOR_PROFILE[normalizePc(pc - tonicPc)]);
    candidates.push({ tonicPc, quality: 'major', correlation: pearson(chroma, major) });
    candidates.push({ tonicPc, quality: 'minor', correlation: pearson(chroma, minor) });
  }

  candidates.sort((a, b) => b.correlation - a.correlation);
  const best = candidates[0];
  const runnerUp = candidates[1];

  return {
    tonicPc: best.tonicPc,
    quality: best.quality,
    confidence: Math.max(0, Math.min(1, best.correlation)),
    margin: best.correlation - runnerUp.correlation,
    ranked: candidates,
  };
}

/**
 * Streaming key detector. Feed it audio frames over a few seconds, then call
 * analyze() to get the estimated key.
 */
export function createKeyDetector(config: KeyDetectorConfig = DEFAULT_KEY_DETECTOR_CONFIG) {
  const chroma = new Array<number>(12).fill(0);
  let frameCount = 0;
  let usedFrameCount = 0;

  /**
   * Folds one audio frame's spectrum into the running chroma accumulator.
   * Frames quieter than `minRms` are ignored so silence doesn't dilute the key.
   * `samples.length` must be a power of two (4096 in the live pipeline).
   */
  function pushFrame(samples: Float32Array, sampleRate: number) {
    frameCount++;
    if (calculateRms(samples) < config.minRms) return;

    const mag = magnitudeSpectrum(samples);
    const N = samples.length;
    const minBin = Math.max(1, Math.floor((config.minFreq * N) / sampleRate));
    const maxBin = Math.min(mag.length - 1, Math.ceil((config.maxFreq * N) / sampleRate));

    let added = false;
    for (let k = minBin; k <= maxBin; k++) {
      const freq = (k * sampleRate) / N;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const pc = normalizePc(Math.round(midi));
      chroma[pc] += mag[k];
      added = true;
    }
    if (added) usedFrameCount++;
  }

  function reset() {
    chroma.fill(0);
    frameCount = 0;
    usedFrameCount = 0;
  }

  /**
   * Returns the current key estimate, or null if no usable audio has been seen
   * (all frames silent / out of band).
   */
  function analyze(): KeyEstimate | null {
    if (usedFrameCount === 0) return null;
    const total = chroma.reduce((sum, value) => sum + value, 0);
    if (total === 0) return null;
    return estimateKeyFromChroma(chroma);
  }

  function getChroma(): number[] {
    return [...chroma];
  }

  function getFrameCounts() {
    return { frameCount, usedFrameCount };
  }

  return { pushFrame, reset, analyze, getChroma, getFrameCounts };
}

export type KeyDetector = ReturnType<typeof createKeyDetector>;
