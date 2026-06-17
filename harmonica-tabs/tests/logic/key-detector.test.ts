import { describe, expect, it } from 'vitest';
import {
  createKeyDetector,
  estimateKeyFromChroma,
  pearson,
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

  it('detects D major from a D-rooted major signal', () => {
    const detector = createKeyDetector();
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

  it('detects E minor from an E-rooted minor signal', () => {
    const detector = createKeyDetector();
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

  it('reset() clears accumulated chroma', () => {
    const detector = createKeyDetector();
    feed(detector, chordFrame([{ midi: 60, amplitude: 0.5 }]));
    detector.reset();
    expect(detector.analyze()).toBeNull();
    expect(detector.getFrameCounts()).toEqual({ frameCount: 0, usedFrameCount: 0 });
  });
});
