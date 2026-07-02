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
  /**
   * How the FFT spectrum contributes to chroma. `raw` is the live app's current
   * behavior; `softLogMagnitude` is an offline experiment that compresses loud bins
   * so drums/distortion are less able to dominate the pitch-class histogram;
   * `harmonicSuppression` reinforces true fundamentals and suppresses pure overtones
   * via a harmonic product spectrum (targets the overtone bleed behind the
   * A-minor/C-major attractor).
   */
  chromaWeighting: ChromaWeighting;
};

export type ChromaWeighting = 'raw' | 'softLogMagnitude' | 'harmonicSuppression';
const SOFT_LOG_SCALE = 0.01;
/**
 * How many harmonics the harmonic-product spectrum folds back into each bin.
 * Swept on the 21-clip corpus: 2 (fold in just the octave) beat 3 and 4 on
 * whole-clip MIREX — gentler suppression avoids the extra `fifth` confusions
 * the deeper products introduce.
 */
const HPS_HARMONICS = 2;

export const DEFAULT_KEY_DETECTOR_CONFIG: KeyDetectorConfig = {
  // Cover roughly A1 (bass) up to ~B6 — where most band fundamentals and chord
  // tones live. Going higher mostly adds harmonics/cymbal noise that blur the
  // chroma; going lower adds rumble.
  minFreq: 55,
  maxFreq: 2000,
  minRms: 0.001,
  // Harmonic suppression (octave-fold HPS) was the first front-end experiment to
  // beat raw magnitude on the 21-clip corpus (whole-clip MIREX 0.367→0.400, ~6s
  // window 0.379→0.424). See docs/STATE.md for the measured before/after.
  chromaWeighting: 'harmonicSuppression',
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

export function chromaWeightForMagnitude(
  magnitude: number,
  weighting: ChromaWeighting,
): number {
  if (magnitude <= 0) return 0;
  if (weighting === 'softLogMagnitude') {
    return Math.log1p(magnitude * SOFT_LOG_SCALE) / SOFT_LOG_SCALE;
  }
  // `raw` and `harmonicSuppression` pass the (already-transformed) bin through
  // unchanged; harmonicSuppression does its work at the spectrum level below.
  return magnitude;
}

/**
 * Harmonic Product Spectrum: reinforce true fundamentals and suppress pure
 * overtones. A real fundamental at bin `k` also has energy at its harmonics
 * `2k, 3k, …`, so multiplying those bins back into `k` makes fundamentals stand
 * out, while a lone overtone (strong at `2k` but not at `4k, 6k…`) collapses
 * toward zero. This directly targets the overtone bleed that feeds the detector's
 * A-minor/C-major attractor.
 *
 * We use only a few harmonics, take their geometric mean so the result stays on a
 * magnitude-like scale (a plain product explodes the dynamic range), and renormalize
 * per frame so one loud frame can't dominate the accumulated chroma. Pure
 * spectrum-level transform; the caller still folds the result to pitch classes with
 * the usual nearest-MIDI rounding.
 */
export function suppressHarmonics(
  mag: Float32Array,
  harmonics = HPS_HARMONICS,
): Float32Array {
  const out = new Float32Array(mag.length);
  // Above this bin, the higher harmonics fall outside the spectrum; keep the raw
  // magnitude there so high fundamentals aren't zeroed just because `k*h` is out
  // of range.
  const productLimit = Math.floor((mag.length - 1) / harmonics);
  let max = 0;
  for (let k = 1; k < mag.length; k++) {
    let value = mag[k];
    if (k <= productLimit) {
      let product = mag[k];
      for (let h = 2; h <= harmonics; h++) product *= mag[k * h];
      // Geometric mean keeps the result comparable to a raw magnitude.
      value = product > 0 ? Math.pow(product, 1 / harmonics) : 0;
    }
    out[k] = value;
    if (value > max) max = value;
  }
  if (max > 0) {
    for (let k = 1; k < out.length; k++) out[k] /= max;
  }
  return out;
}

/**
 * Streaming key detector. Feed it audio frames over a few seconds, then call
 * analyze() to get the estimated key.
 */
export function createKeyDetector(config: Partial<KeyDetectorConfig> = DEFAULT_KEY_DETECTOR_CONFIG) {
  const resolvedConfig = { ...DEFAULT_KEY_DETECTOR_CONFIG, ...config };
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
    if (calculateRms(samples) < resolvedConfig.minRms) return;

    const rawMag = magnitudeSpectrum(samples);
    const mag =
      resolvedConfig.chromaWeighting === 'harmonicSuppression'
        ? suppressHarmonics(rawMag)
        : rawMag;
    const N = samples.length;
    const minBin = Math.max(1, Math.floor((resolvedConfig.minFreq * N) / sampleRate));
    const maxBin = Math.min(mag.length - 1, Math.ceil((resolvedConfig.maxFreq * N) / sampleRate));

    let added = false;
    for (let k = minBin; k <= maxBin; k++) {
      const freq = (k * sampleRate) / N;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const pc = normalizePc(Math.round(midi));
      const weight = chromaWeightForMagnitude(mag[k], resolvedConfig.chromaWeighting);
      if (weight <= 0) continue;
      chroma[pc] += weight;
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
