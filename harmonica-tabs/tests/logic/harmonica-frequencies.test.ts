import { describe, expect, it } from 'vitest';
import { buildHarmonicaVocabulary } from '../../src/logic/harmonica-frequencies';
import { midiToFrequency } from '../../src/logic/pitch';
import { getPlayableMidiShift } from '../../src/data/richter';

describe('buildHarmonicaVocabulary', () => {
  describe('C harmonica (harmonicaPc = 0)', () => {
    const vocab = buildHarmonicaVocabulary(0);

    it('natural notes contain only blow and draw techniques', () => {
      vocab.naturalNotes.forEach((note) => {
        expect(['blow', 'draw']).toContain(note.technique);
        expect(note.isBend).toBe(false);
      });
    });

    it('natural notes are deduplicated — G4 (midi 67) appears on hole 2 draw and hole 3 blow', () => {
      const g4 = vocab.naturalNotes.filter((n) => n.midi === 67);
      expect(g4).toHaveLength(1);
    });

    it('has 19 unique natural notes on a C harmonica', () => {
      // 10 holes × 2 = 20 blow/draw entries, minus 1 duplicate (MIDI 67 on hole 2 draw and hole 3 blow)
      expect(vocab.naturalNotes).toHaveLength(19);
    });

    it('allNotes is a superset of naturalNotes', () => {
      const naturalMidis = new Set(vocab.naturalNotes.map((n) => n.midi));
      naturalMidis.forEach((midi) => {
        expect(vocab.allNotes.some((n) => n.midi === midi)).toBe(true);
      });
      expect(vocab.allNotes.length).toBeGreaterThan(vocab.naturalNotes.length);
    });

    it('allNotes includes bent notes', () => {
      const hasBend = vocab.allNotes.some((n) => n.isBend);
      expect(hasBend).toBe(true);
    });

    it('notes are sorted by ascending MIDI', () => {
      for (let i = 1; i < vocab.allNotes.length; i++) {
        expect(vocab.allNotes[i].midi).toBeGreaterThan(vocab.allNotes[i - 1].midi);
      }
      for (let i = 1; i < vocab.naturalNotes.length; i++) {
        expect(vocab.naturalNotes[i].midi).toBeGreaterThan(vocab.naturalNotes[i - 1].midi);
      }
    });

    it('frequency matches midiToFrequency for every note', () => {
      vocab.allNotes.forEach((note) => {
        expect(note.frequency).toBeCloseTo(midiToFrequency(note.midi), 5);
      });
    });

    it('hole 1 blow is middle C (MIDI 60, ~261.63 Hz)', () => {
      const c4 = vocab.naturalNotes.find((n) => n.midi === 60);
      expect(c4).toBeDefined();
      expect(c4?.technique).toBe('blow');
      expect(c4?.hole).toBe(1);
      expect(c4?.frequency).toBeCloseTo(261.63, 1);
    });

    it('bent notes have higher confidence thresholds than natural notes', () => {
      const natural = vocab.allNotes.filter((n) => !n.isBend);
      const bent = vocab.allNotes.filter((n) => n.isBend);
      const maxNatural = Math.max(...natural.map((n) => n.confidenceThreshold));
      const minBent = Math.min(...bent.map((n) => n.confidenceThreshold));
      expect(minBent).toBeGreaterThan(maxNatural);
    });

    it('uses lower confidence thresholds for high natural notes on holes 9 and 10', () => {
      const midNatural = vocab.naturalNotes.find((n) => n.hole === 6 && n.technique === 'blow');
      const holeNineNatural = vocab.naturalNotes.find((n) => n.hole === 9 && n.technique === 'draw');
      const holeTenNatural = vocab.naturalNotes.find((n) => n.hole === 10 && n.technique === 'blow');

      expect(midNatural?.confidenceThreshold).toBe(0.3);
      expect(holeNineNatural?.confidenceThreshold).toBe(0.18);
      expect(holeTenNatural?.confidenceThreshold).toBe(0.16);
    });
  });

  describe('transposition', () => {
    it('wraps lower harmonica keys into the expected playable MIDI octave', () => {
      expect(getPlayableMidiShift(0)).toBe(0);
      expect(getPlayableMidiShift(6)).toBe(6);
      expect(getPlayableMidiShift(7)).toBe(-5);
      expect(getPlayableMidiShift(11)).toBe(-1);
    });

    it('G harmonica (harmonicaPc = 7) shifts pitch classes to G but wraps MIDI down to the lower octave', () => {
      const cVocab = buildHarmonicaVocabulary(0);
      const gVocab = buildHarmonicaVocabulary(7);
      expect(gVocab.naturalNotes).toHaveLength(cVocab.naturalNotes.length);
      gVocab.naturalNotes.forEach((gNote, i) => {
        const cNote = cVocab.naturalNotes[i];
        expect(gNote.midi).toBe(cNote.midi - 5);
        expect(gNote.frequency).toBeCloseTo(midiToFrequency(cNote.midi - 5), 5);
      });
    });

    it('keeps G harmonica hole 6 above hole 2 instead of collapsing them into the same octave', () => {
      const gVocab = buildHarmonicaVocabulary(7);
      const holeTwoDraw = gVocab.naturalNotes.find((note) => note.hole === 2 && note.technique === 'draw');
      const holeSixBlow = gVocab.naturalNotes.find((note) => note.hole === 6 && note.technique === 'blow');

      expect(holeTwoDraw?.midi).toBe(62);
      expect(holeSixBlow?.midi).toBe(74);
      expect(holeSixBlow?.midi).toBe((holeTwoDraw?.midi ?? 0) + 12);
    });

    it('all 12 keys produce a vocabulary without errors', () => {
      for (let pc = 0; pc < 12; pc++) {
        expect(() => buildHarmonicaVocabulary(pc)).not.toThrow();
        const vocab = buildHarmonicaVocabulary(pc);
        expect(vocab.naturalNotes.length).toBeGreaterThan(0);
        expect(vocab.allNotes.length).toBeGreaterThan(vocab.naturalNotes.length);
      }
    });
  });
});
