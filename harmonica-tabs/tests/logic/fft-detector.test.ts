import { describe, expect, it } from 'vitest';
import { detectSingleNote, detectChord, calculateRms } from '../../src/logic/fft-detector';
import { buildHarmonicaVocabulary } from '../../src/logic/harmonica-frequencies';

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4096;

/**
 * Generates a pure sine wave at the given frequency.
 */
function sineWave(frequency: number, amplitude = 0.5, size = BUFFER_SIZE): Float32Array {
  const buf = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    buf[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
  }
  return buf;
}

/**
 * Generates a buffer of low-level noise (below the silence threshold).
 */
function silenceBuffer(size = BUFFER_SIZE): Float32Array {
  const buf = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    buf[i] = (Math.random() - 0.5) * 0.001; // well below MIN_RMS = 0.005
  }
  return buf;
}

/**
 * Mixes multiple sine waves into one buffer.
 */
function mixSines(components: { frequency: number; amplitude: number }[], size = BUFFER_SIZE): Float32Array {
  const buf = new Float32Array(size);
  for (const { frequency, amplitude } of components) {
    for (let i = 0; i < size; i++) {
      buf[i] += amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
    }
  }
  return buf;
}

const cVocab = buildHarmonicaVocabulary(0); // C harmonica
const eVocab = buildHarmonicaVocabulary(4); // E harmonica

describe('calculateRms', () => {
  it('returns near-zero for silence', () => {
    expect(calculateRms(silenceBuffer())).toBeLessThan(0.005);
  });

  it('returns ~0.5 / sqrt(2) ≈ 0.354 for a 0.5-amplitude sine wave', () => {
    const rms = calculateRms(sineWave(440, 0.5));
    expect(rms).toBeCloseTo(0.5 / Math.sqrt(2), 1);
  });
});

describe('detectSingleNote', () => {
  it('returns null frequency for silence', () => {
    const result = detectSingleNote(silenceBuffer(), SAMPLE_RATE, cVocab);
    expect(result.frequency).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('detects middle C (hole 1 blow, ~261.63 Hz)', () => {
    const c4 = cVocab.naturalNotes.find((n) => n.midi === 60)!;
    const result = detectSingleNote(sineWave(c4.frequency), SAMPLE_RATE, cVocab);
    expect(result.frequency).toBe(c4.frequency);
    expect(result.confidence).toBeGreaterThan(c4.confidenceThreshold);
  });

  it('detects G4 (hole 2 draw / hole 3 blow, ~392 Hz)', () => {
    const g4 = cVocab.naturalNotes.find((n) => n.midi === 67)!;
    const result = detectSingleNote(sineWave(g4.frequency), SAMPLE_RATE, cVocab);
    expect(result.frequency).toBe(g4.frequency);
  });

  it('detects each natural note on a C harmonica', () => {
    for (const note of cVocab.naturalNotes) {
      const result = detectSingleNote(sineWave(note.frequency), SAMPLE_RATE, cVocab);
      expect(result.frequency).toBe(note.frequency);
    }
  });

  it('detects notes on a G harmonica (harmonicaPc = 7)', () => {
    const gVocab = buildHarmonicaVocabulary(7);
    for (const note of gVocab.naturalNotes) {
      const result = detectSingleNote(sineWave(note.frequency), SAMPLE_RATE, gVocab);
      expect(result.frequency).toBe(note.frequency);
    }
  });

  it('recovers a low C fundamental when its second harmonic is louder', () => {
    const c4 = cVocab.naturalNotes.find((n) => n.hole === 1 && n.technique === 'blow')!;
    const c5 = cVocab.naturalNotes.find((n) => n.hole === 4 && n.technique === 'blow')!;
    const result = detectSingleNote(
      mixSines([
        { frequency: c4.frequency, amplitude: 0.18 },
        { frequency: c5.frequency, amplitude: 0.55 },
      ]),
      SAMPLE_RATE,
      cVocab,
    );

    expect(result.frequency).toBe(c4.frequency);
  });

  it('recovers a low D fundamental when its third harmonic is louder', () => {
    const d4 = cVocab.naturalNotes.find((n) => n.hole === 1 && n.technique === 'draw')!;
    const a5 = cVocab.naturalNotes.find((n) => n.hole === 6 && n.technique === 'draw')!;
    const result = detectSingleNote(
      mixSines([
        { frequency: d4.frequency, amplitude: 0.18 },
        { frequency: a5.frequency, amplitude: 0.55 },
      ]),
      SAMPLE_RATE,
      cVocab,
    );

    expect(result.frequency).toBe(d4.frequency);
  });

  it('recovers a very weak low G fundamental on a G harmonica when its second harmonic is louder', () => {
    const gVocab = buildHarmonicaVocabulary(7);
    const g3 = gVocab.naturalNotes.find((n) => n.hole === 1 && n.technique === 'blow')!;
    const g4 = gVocab.naturalNotes.find((n) => n.hole === 4 && n.technique === 'blow')!;
    const result = detectSingleNote(
      mixSines([
        { frequency: g3.frequency, amplitude: 0.12 },
        { frequency: g4.frequency, amplitude: 0.55 },
      ]),
      SAMPLE_RATE,
      gVocab,
    );

    expect(result.frequency).toBe(g3.frequency);
  });

  it('keeps a real G4 on a G harmonica from collapsing down when low bleed is present', () => {
    const gVocab = buildHarmonicaVocabulary(7);
    const g3 = gVocab.naturalNotes.find((n) => n.hole === 1 && n.technique === 'blow')!;
    const g4 = gVocab.naturalNotes.find((n) => n.hole === 4 && n.technique === 'blow')!;
    const result = detectSingleNote(
      mixSines([
        { frequency: g4.frequency, amplitude: 0.55 },
        { frequency: g3.frequency, amplitude: 0.10 },
      ]),
      SAMPLE_RATE,
      gVocab,
    );

    expect(result.frequency).toBe(g4.frequency);
  });

  it('detects a crowded high C hole 10 blow with the relaxed top-register threshold', () => {
    const highC = cVocab.naturalNotes.find((n) => n.hole === 10 && n.technique === 'blow')!;
    const competitors = [
      cVocab.naturalNotes.find((n) => n.hole === 10 && n.technique === 'draw')!,
      cVocab.naturalNotes.find((n) => n.hole === 9 && n.technique === 'blow')!,
      cVocab.naturalNotes.find((n) => n.hole === 9 && n.technique === 'draw')!,
      cVocab.naturalNotes.find((n) => n.hole === 8 && n.technique === 'blow')!,
    ];
    const result = detectSingleNote(
      mixSines([
        { frequency: highC.frequency, amplitude: 0.4 },
        ...competitors.map((note) => ({ frequency: note.frequency, amplitude: 0.33 })),
      ]),
      SAMPLE_RATE,
      cVocab,
    );

    expect(result.frequency).toBe(highC.frequency);
  });

  it('detects a crowded high C hole 10 draw with the relaxed top-register threshold', () => {
    const highDraw = cVocab.naturalNotes.find((n) => n.hole === 10 && n.technique === 'draw')!;
    const competitors = [
      cVocab.naturalNotes.find((n) => n.hole === 10 && n.technique === 'blow')!,
      cVocab.naturalNotes.find((n) => n.hole === 9 && n.technique === 'blow')!,
      cVocab.naturalNotes.find((n) => n.hole === 9 && n.technique === 'draw')!,
      cVocab.naturalNotes.find((n) => n.hole === 8 && n.technique === 'draw')!,
    ];
    const result = detectSingleNote(
      mixSines([
        { frequency: highDraw.frequency, amplitude: 0.4 },
        ...competitors.map((note) => ({ frequency: note.frequency, amplitude: 0.33 })),
      ]),
      SAMPLE_RATE,
      cVocab,
    );

    expect(result.frequency).toBe(highDraw.frequency);
  });

  it('detects a crowded high E hole 9 draw with the relaxed top-register threshold', () => {
    const highDraw = eVocab.naturalNotes.find((n) => n.hole === 9 && n.technique === 'draw')!;
    const competitors = [
      eVocab.naturalNotes.find((n) => n.hole === 10 && n.technique === 'blow')!,
      eVocab.naturalNotes.find((n) => n.hole === 10 && n.technique === 'draw')!,
      eVocab.naturalNotes.find((n) => n.hole === 9 && n.technique === 'blow')!,
      eVocab.naturalNotes.find((n) => n.hole === 8 && n.technique === 'draw')!,
    ];
    const result = detectSingleNote(
      mixSines([
        { frequency: highDraw.frequency, amplitude: 0.4 },
        ...competitors.map((note) => ({ frequency: note.frequency, amplitude: 0.33 })),
      ]),
      SAMPLE_RATE,
      eVocab,
    );

    expect(result.frequency).toBe(highDraw.frequency);
  });

  it('detects a crowded high E hole 10 blow with the relaxed top-register threshold', () => {
    const highBlow = eVocab.naturalNotes.find((n) => n.hole === 10 && n.technique === 'blow')!;
    const competitors = [
      eVocab.naturalNotes.find((n) => n.hole === 10 && n.technique === 'draw')!,
      eVocab.naturalNotes.find((n) => n.hole === 9 && n.technique === 'blow')!,
      eVocab.naturalNotes.find((n) => n.hole === 9 && n.technique === 'draw')!,
      eVocab.naturalNotes.find((n) => n.hole === 8 && n.technique === 'blow')!,
    ];
    const result = detectSingleNote(
      mixSines([
        { frequency: highBlow.frequency, amplitude: 0.4 },
        ...competitors.map((note) => ({ frequency: note.frequency, amplitude: 0.33 })),
      ]),
      SAMPLE_RATE,
      eVocab,
    );

    expect(result.frequency).toBe(highBlow.frequency);
  });

  it('returns null for a frequency far outside the vocabulary', () => {
    // 8000 Hz is well outside harmonica range (max ~2000 Hz)
    const result = detectSingleNote(sineWave(8000, 0.5), SAMPLE_RATE, cVocab);
    // Either null or very low confidence — should not confidently match a harmonica note
    if (result.frequency !== null) {
      expect(result.confidence).toBeLessThan(0.5);
    }
  });
});

describe('detectChord', () => {
  it('returns empty activeNotes for silence', () => {
    const result = detectChord(silenceBuffer(), SAMPLE_RATE, cVocab);
    expect(result.activeNotes).toHaveLength(0);
  });

  it('detects a single note as a "chord" of one', () => {
    const c4 = cVocab.naturalNotes.find((n) => n.midi === 60)!;
    const result = detectChord(sineWave(c4.frequency), SAMPLE_RATE, cVocab);
    expect(result.activeNotes.length).toBeGreaterThanOrEqual(1);
    expect(result.activeNotes.some((n) => n.midi === 60)).toBe(true);
  });

  it('detects two simultaneous natural notes (C4 + E4 = a partial C chord)', () => {
    const c4 = cVocab.naturalNotes.find((n) => n.midi === 60)!;
    const e4 = cVocab.naturalNotes.find((n) => n.midi === 64)!;
    const buf = mixSines([
      { frequency: c4.frequency, amplitude: 0.4 },
      { frequency: e4.frequency, amplitude: 0.4 },
    ]);
    const result = detectChord(buf, SAMPLE_RATE, cVocab);
    const detectedMidis = result.activeNotes.map((n) => n.midi);
    expect(detectedMidis).toContain(60);
    expect(detectedMidis).toContain(64);
  });

  it('detects three simultaneous notes (C4 + E4 + G4)', () => {
    const notes = [60, 64, 67].map((midi) => cVocab.naturalNotes.find((n) => n.midi === midi)!);
    const buf = mixSines(notes.map((n) => ({ frequency: n.frequency, amplitude: 0.3 })));
    const result = detectChord(buf, SAMPLE_RATE, cVocab);
    const detectedMidis = result.activeNotes.map((n) => n.midi);
    expect(detectedMidis).toContain(60);
    expect(detectedMidis).toContain(64);
    expect(detectedMidis).toContain(67);
  });

  it('only uses naturalNotes — bent notes are never in chord results', () => {
    // Play a note at a bent frequency
    const bentNote = cVocab.allNotes.find((n) => n.isBend)!;
    const result = detectChord(sineWave(bentNote.frequency), SAMPLE_RATE, cVocab);
    expect(result.activeNotes.every((n) => !n.isBend)).toBe(true);
  });
});
