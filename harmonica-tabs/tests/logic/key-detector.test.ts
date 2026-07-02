import { describe, expect, it } from 'vitest';
import {
  chromaWeightForMagnitude,
  createKeyDetector,
  estimateKeyFromChroma,
  interpolatedBinOffset,
  pearson,
  whitenSpectrum,
} from '../../src/logic/key-detector';
import { noteToPc } from '../../src/data/notes';

const SAMPLE_RATE = 44100;
const FRAME_SIZE = 4096;

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

type Tone = { midi: number; amplitude: number };

/**
 * Sums pure sine waves (one per tone) into a single frame. Pure sines keep the
 * spectrum clean — energy lands only on the intended pitch classes — so the
 * detector's behaviour is easy to reason about in tests.
 */
function chordFrame(tones: Tone[], size = FRAME_SIZE): Float32Array {
  const buf = new Float32Array(size);
  for (const { midi, amplitude } of tones) {
    const freq = midiToFreq(midi);
    for (let i = 0; i < size; i++) {
      buf[i] += amplitude * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
    }
  }
  return buf;
}

/**
 * Builds a frame for one note plus its overtones: pure sines at the fundamental
 * and its exact integer multiples (2f, 3f, …), one amplitude per partial. Exact
 * multiples (not tempered MIDI) keep the harmonics on the FFT bins the harmonic
 * product spectrum reads, so the overtone-suppression behaviour is testable.
 */
function harmonicFrame(fundamentalHz: number, amplitudes: number[], size = FRAME_SIZE): Float32Array {
  const buf = new Float32Array(size);
  amplitudes.forEach((amp, idx) => {
    const freq = fundamentalHz * (idx + 1);
    for (let i = 0; i < size; i++) {
      buf[i] += amp * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
    }
  });
  return buf;
}

function feed(detector: ReturnType<typeof createKeyDetector>, frame: Float32Array, count = 10) {
  for (let i = 0; i < count; i++) {
    detector.pushFrame(frame, SAMPLE_RATE);
  }
}

describe('pearson', () => {
  it('returns 1 for identical vectors', () => {
    expect(pearson([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 6);
  });

  it('returns -1 for perfectly anti-correlated vectors', () => {
    expect(pearson([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 6);
  });

  it('returns 0 when a vector has no variance', () => {
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBe(0);
  });
});

describe('estimateKeyFromChroma', () => {
  it('picks G major when the chroma emphasises G, B, D (a G major triad)', () => {
    const chroma = new Array(12).fill(0);
    chroma[noteToPc('G')] = 3;
    chroma[noteToPc('B')] = 2;
    chroma[noteToPc('D')] = 2;

    const estimate = estimateKeyFromChroma(chroma);
    expect(estimate.tonicPc).toBe(noteToPc('G'));
    expect(estimate.quality).toBe('major');
    expect(estimate.ranked).toHaveLength(24);
    expect(estimate.margin).toBeGreaterThan(0);
  });

  it('picks A minor when the chroma emphasises A, C, E (an A minor triad)', () => {
    const chroma = new Array(12).fill(0);
    chroma[noteToPc('A')] = 3;
    chroma[noteToPc('C')] = 2;
    chroma[noteToPc('E')] = 2;

    const estimate = estimateKeyFromChroma(chroma);
    expect(estimate.tonicPc).toBe(noteToPc('A'));
    expect(estimate.quality).toBe('minor');
  });
});

describe('chromaWeightForMagnitude', () => {
  it('keeps raw magnitudes unchanged', () => {
    expect(chromaWeightForMagnitude(12, 'raw')).toBe(12);
    expect(chromaWeightForMagnitude(0, 'raw')).toBe(0);
  });

  it('soft-compresses log magnitudes while preserving their order', () => {
    const quiet = chromaWeightForMagnitude(1, 'softLogMagnitude');
    const loud = chromaWeightForMagnitude(99, 'softLogMagnitude');

    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(loud);
    expect(quiet).toBeGreaterThan(1 / 99);
    expect(loud).toBeLessThan(99);
  });
});

describe('whitenSpectrum', () => {
  it('normalizes bins against their local neighbourhood', () => {
    const mag = new Float32Array([0, 10, 10, 100, 10, 10]);
    const whitened = whitenSpectrum(mag, 1);

    expect(whitened[3]).toBe(1);
    expect(whitened[2]).toBeLessThan(whitened[1]);
    expect(whitened[4]).toBeLessThan(whitened[5]);
  });
});

describe('interpolatedBinOffset', () => {
  it('estimates a sub-bin peak location from neighboring magnitudes', () => {
    const mag = new Float32Array([0, 1, 4, 2, 0]);

    expect(interpolatedBinOffset(mag, 2)).toBeGreaterThan(0);
    expect(interpolatedBinOffset(mag, 2)).toBeLessThanOrEqual(0.5);
  });

  it('stays at the bin center when interpolation is not meaningful', () => {
    expect(interpolatedBinOffset(new Float32Array([0, 1, 1, 1, 0]), 2)).toBe(0);
    expect(interpolatedBinOffset(new Float32Array([0, 1, 4, 2, 0]), 0)).toBe(0);
  });
});

describe('createKeyDetector', () => {
  it('returns null before any audio is pushed', () => {
    const detector = createKeyDetector();
    expect(detector.analyze()).toBeNull();
  });

  it('ignores silent frames and reports them as unused', () => {
    const detector = createKeyDetector();
    feed(detector, new Float32Array(FRAME_SIZE), 5);
    expect(detector.analyze()).toBeNull();
    expect(detector.getFrameCounts()).toEqual({ frameCount: 5, usedFrameCount: 0 });
  });

  it('detects D major from a D-rooted major signal (raw front-end)', () => {
    // Pure sines have no overtones, so this exercises the raw front-end; the
    // harmonic-product default needs real harmonics (covered separately below).
    const detector = createKeyDetector({ chromaWeighting: 'raw' });
    // D major emphasis: tonic D, dominant A, mediant F# — matches the major
    // profile's three strongest degrees.
    feed(
      detector,
      chordFrame([
        { midi: 50, amplitude: 0.5 }, // D3 (tonic, loudest)
        { midi: 57, amplitude: 0.35 }, // A3 (dominant)
        { midi: 54, amplitude: 0.3 }, // F#3 (mediant)
        { midi: 62, amplitude: 0.3 }, // D4
      ]),
    );

    const estimate = detector.analyze();
    expect(estimate).not.toBeNull();
    expect(estimate!.tonicPc).toBe(noteToPc('D'));
    expect(estimate!.quality).toBe('major');
    expect(estimate!.confidence).toBeGreaterThan(0);
  });

  it('detects E minor from an E-rooted minor signal (raw front-end)', () => {
    const detector = createKeyDetector({ chromaWeighting: 'raw' });
    // E minor emphasis: tonic E, dominant B, minor third G.
    feed(
      detector,
      chordFrame([
        { midi: 52, amplitude: 0.5 }, // E3 (tonic, loudest)
        { midi: 59, amplitude: 0.35 }, // B3 (dominant)
        { midi: 55, amplitude: 0.3 }, // G3 (minor third)
        { midi: 64, amplitude: 0.3 }, // E4
      ]),
    );

    const estimate = detector.analyze();
    expect(estimate).not.toBeNull();
    expect(estimate!.tonicPc).toBe(noteToPc('E'));
    expect(estimate!.quality).toBe('minor');
  });

  it('keeps clean major detection intact with soft-log chroma weighting', () => {
    const detector = createKeyDetector({ chromaWeighting: 'softLogMagnitude' });
    feed(
      detector,
      chordFrame([
        { midi: 50, amplitude: 0.5 }, // D3
        { midi: 57, amplitude: 0.35 }, // A3
        { midi: 54, amplitude: 0.3 }, // F#3
        { midi: 62, amplitude: 0.3 }, // D4
      ]),
    );

    const estimate = detector.analyze();
    expect(estimate).not.toBeNull();
    expect(estimate!.tonicPc).toBe(noteToPc('D'));
    expect(estimate!.quality).toBe('major');
  });

  it('detects major from a harmonic-rich major signal under harmonic suppression', () => {
    // The harmonic product spectrum relies on real overtones, so each chord tone
    // carries its natural decaying harmonic series (unlike the pure-sine fixtures).
    const partials = [0.5, 0.25, 0.15, 0.1];
    const frame = new Float32Array(FRAME_SIZE);
    for (const midi of [50, 57, 54, 62]) {
      // D3, A3, F#3, D4 — a D-major emphasis.
      const voice = harmonicFrame(midiToFreq(midi), partials);
      for (let i = 0; i < FRAME_SIZE; i++) frame[i] += voice[i];
    }

    const detector = createKeyDetector({ chromaWeighting: 'harmonicSuppression' });
    feed(detector, frame);

    const estimate = detector.analyze();
    expect(estimate).not.toBeNull();
    expect(estimate!.tonicPc).toBe(noteToPc('D'));
    expect(estimate!.quality).toBe('major');
  });

  it('keeps clean major detection intact with spectral whitening', () => {
    const detector = createKeyDetector({ chromaWeighting: 'spectralWhitening' });
    feed(
      detector,
      chordFrame([
        { midi: 50, amplitude: 0.5 }, // D3
        { midi: 57, amplitude: 0.35 }, // A3
        { midi: 54, amplitude: 0.3 }, // F#3
        { midi: 62, amplitude: 0.3 }, // D4
      ]),
    );

    const estimate = detector.analyze();
    expect(estimate).not.toBeNull();
    expect(estimate!.tonicPc).toBe(noteToPc('D'));
    expect(estimate!.quality).toBe('major');
  });

  it('keeps clean major detection intact with spectral whitening plus interpolation', () => {
    const detector = createKeyDetector({ chromaWeighting: 'spectralWhiteningInterpolated' });
    feed(
      detector,
      chordFrame([
        { midi: 50, amplitude: 0.5 }, // D3
        { midi: 57, amplitude: 0.35 }, // A3
        { midi: 54, amplitude: 0.3 }, // F#3
        { midi: 62, amplitude: 0.3 }, // D4
      ]),
    );

    const estimate = detector.analyze();
    expect(estimate).not.toBeNull();
    expect(estimate!.tonicPc).toBe(noteToPc('D'));
    expect(estimate!.quality).toBe('major');
  });

  it('detects minor from a harmonic-rich minor signal under harmonic suppression', () => {
    const partials = [0.5, 0.25, 0.15, 0.1];
    const frame = new Float32Array(FRAME_SIZE);
    for (const midi of [52, 59, 55, 64]) {
      // E3, B3, G3, E4 — an E-minor emphasis.
      const voice = harmonicFrame(midiToFreq(midi), partials);
      for (let i = 0; i < FRAME_SIZE; i++) frame[i] += voice[i];
    }

    const detector = createKeyDetector({ chromaWeighting: 'harmonicSuppression' });
    feed(detector, frame);

    const estimate = detector.analyze();
    expect(estimate).not.toBeNull();
    expect(estimate!.tonicPc).toBe(noteToPc('E'));
    expect(estimate!.quality).toBe('minor');
  });

  it('suppresses an overtone pitch class relative to its fundamental', () => {
    // A C fundamental with overtones: 3f lands on G (a fifth up) — the classic
    // overtone that drives "fifth" key confusions. Harmonic suppression should
    // shrink G's share of the chroma versus the raw front-end.
    const cFundamental = midiToFreq(48); // C3
    const frame = harmonicFrame(cFundamental, [0.5, 0.3, 0.3, 0.2]); // f, 2f, 3f(G), 4f

    const share = (chroma: number[], pc: number) => {
      const total = chroma.reduce((sum, v) => sum + v, 0);
      return total > 0 ? chroma[pc] / total : 0;
    };

    const raw = createKeyDetector({ chromaWeighting: 'raw' });
    feed(raw, frame);
    const hps = createKeyDetector({ chromaWeighting: 'harmonicSuppression' });
    feed(hps, frame);

    const g = noteToPc('G');
    expect(share(hps.getChroma(), g)).toBeLessThan(share(raw.getChroma(), g));
  });

  it('reset() clears accumulated chroma', () => {
    const detector = createKeyDetector();
    feed(detector, chordFrame([{ midi: 60, amplitude: 0.5 }]));
    detector.reset();
    expect(detector.analyze()).toBeNull();
    expect(detector.getFrameCounts()).toEqual({ frameCount: 0, usedFrameCount: 0 });
  });
});
