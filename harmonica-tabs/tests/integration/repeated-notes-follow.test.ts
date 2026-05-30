import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { decodeWavFile } from '../helpers/wav';
import { detectSingleNote } from '../../src/logic/fft-detector';
import { buildHarmonicaVocabulary } from '../../src/logic/harmonica-frequencies';
import { RICHTER_C_LAYOUT, transposeLayout } from '../../src/data/richter';
import {
  createTransposerFollowState,
  evaluateTransposerFollow,
  type DetectorSnapshot,
  type TransposerFollowState,
} from '../../src/logic/transposer-follow';
import { DEFAULT_AUDIO_SETTINGS } from '../../src/config/default-settings';

// Same frame size the live app uses. Changing this would change detector
// behavior, so the test mirrors the production constant rather than
// re-tuning it for the recordings.
const FRAME_SIZE = 4096;

// Folder-name → pitch class, kept in sync with scripts/detect-offline.ts.
const KEY_PC: Record<string, number> = {
  c_harmonica: 0,
  db_harmonica: 1,
  cs_harmonica: 1,
  d_harmonica: 2,
  eb_harmonica: 3,
  ds_harmonica: 3,
  e_harmonica: 4,
  f_harmonica: 5,
  gb_harmonica: 6,
  fs_harmonica: 6,
  g_harmonica: 7,
  ab_harmonica: 8,
  gs_harmonica: 8,
  a_harmonica: 9,
  bb_harmonica: 10,
  as_harmonica: 10,
  b_harmonica: 11,
};

const SAMPLES_DIR = path.resolve(__dirname, '../../../sound-samples');

type RepeatedNoteCase = {
  label: string;
  filePath: string;
  harmonicaPc: number;
  hole: number;
  technique: 'blow' | 'draw';
  expectedEventCount: number;
};

function discoverCases(): RepeatedNoteCase[] {
  if (!fs.existsSync(SAMPLES_DIR)) return [];
  const cases: RepeatedNoteCase[] = [];

  for (const keyDir of fs.readdirSync(SAMPLES_DIR).sort()) {
    const harmonicaPc = KEY_PC[keyDir];
    if (harmonicaPc === undefined) continue;
    const repeatedDir = path.join(SAMPLES_DIR, keyDir, 'repeated_notes');
    if (!fs.existsSync(repeatedDir)) continue;

    for (const takeDir of fs.readdirSync(repeatedDir).sort()) {
      if (!takeDir.startsWith('take_')) continue;
      const takePath = path.join(repeatedDir, takeDir);

      for (const filename of fs.readdirSync(takePath).sort()) {
        const match = filename.match(/^(\d+)[_-](blow|draw)_x(\d+)\.wav$/);
        if (!match) continue;
        cases.push({
          label: `${keyDir}/${takeDir}/${filename}`,
          filePath: path.join(takePath, filename),
          harmonicaPc,
          hole: parseInt(match[1], 10),
          technique: match[2] as 'blow' | 'draw',
          expectedEventCount: parseInt(match[3], 10),
        });
      }
    }
  }

  return cases;
}

type RunResult = {
  advancesDetected: number;
  finalActiveIndex: number | null;
  finalStatus: string;
  framesProcessed: number;
};

function expectedMidi(harmonicaPc: number, hole: number, technique: 'blow' | 'draw'): number {
  // The vocabulary dedupes by MIDI, so for collisions like hole 3 blow == hole
  // 2 draw, one hole is dropped. Look up the raw layout instead, which always
  // has the per-hole blow/draw MIDI.
  const semitones = harmonicaPc >= 7 ? harmonicaPc - 12 : harmonicaPc;
  const layout = transposeLayout(RICHTER_C_LAYOUT, semitones);
  const entry = layout.find((h) => h.hole === hole);
  if (!entry) throw new Error(`No layout entry for hole ${hole}`);
  return technique === 'blow' ? entry.blowMidi : entry.drawMidi;
}

function runFollowOnFile(testCase: RepeatedNoteCase, noteSeparationRatio: number): RunResult {
  const vocabulary = buildHarmonicaVocabulary(testCase.harmonicaPc);
  const midi = expectedMidi(testCase.harmonicaPc, testCase.hole, testCase.technique);

  const tokens = Array.from({ length: testCase.expectedEventCount }, (_, i) => ({
    tokenIndex: i,
    text: String(testCase.hole),
    midi,
  }));

  const decoded = decodeWavFile(testCase.filePath);
  const samples = decoded.channelData[0];
  const totalFrames = Math.floor(samples.length / FRAME_SIZE);

  let state: TransposerFollowState = createTransposerFollowState(0);
  let advancesDetected = 0;
  let finalStatus = 'idle';

  for (let i = 0; i < totalFrames; i++) {
    const frame = samples.slice(i * FRAME_SIZE, (i + 1) * FRAME_SIZE);
    const result = detectSingleNote(frame, decoded.sampleRate, vocabulary);
    const snapshot: DetectorSnapshot = {
      frequency: result.frequency,
      confidence: result.confidence,
      rms: result.rms,
      source: 'web',
      lastDetectedAt: null,
    };
    const followResult = evaluateTransposerFollow({
      enabled: true,
      tokens,
      state,
      detector: snapshot,
      toneToleranceCents: DEFAULT_AUDIO_SETTINGS.toneToleranceCents,
      minConfidence: DEFAULT_AUDIO_SETTINGS.toneFollowMinConfidence,
      noteSeparationRatio,
    });
    state = followResult.state;
    finalStatus = followResult.status;
    if (followResult.status === 'advanced') advancesDetected++;
  }

  return {
    advancesDetected,
    finalActiveIndex: state.activeTokenIndex,
    finalStatus,
    framesProcessed: totalFrames,
  };
}

const cases = discoverCases();

// Recordings where the FFT pitch detector itself loses confidence mid-note
// (reports frequency=null + confidence=0 while RMS shows the note is still
// playing). The follow algorithm can't advance without a detected pitch, so
// these surface as "0 advances" failures. The follow-side fix is to improve
// the FFT detector; until then we expect failure on these files. If one
// starts passing, the assertion below flags it so the entry can be removed
// from this set — that way the test catches both regressions (a passing
// recording starts failing) and silent fixes (a known-bad starts passing).
const KNOWN_DETECTOR_FAILURES = new Set([
  'c_harmonica/take_2/1_draw_x3.wav',
  'c_harmonica/take_2/2_blow_x3.wav',
  'c_harmonica/take_2/3_draw_x3.wav',
  'c_harmonica/take_2/6_draw_x3.wav',
]);

describe('transposer-follow on real repeated-note recordings', () => {
  if (cases.length === 0) {
    // sound-samples/ lives outside the harmonica-tabs/ package so it isn't
    // checked into this repo by default. Skip rather than failing on
    // contributor machines without the fixtures.
    it.skip('sound-samples not present — skipping integration coverage', () => undefined);
    return;
  }

  for (const testCase of cases) {
    const knownBad = KNOWN_DETECTOR_FAILURES.has(testCase.label);
    const labelPrefix = knownBad ? '[known detector issue] ' : '';
    it(`${labelPrefix}advances ${testCase.expectedEventCount - 1}× on ${testCase.label}`, () => {
      const result = runFollowOnFile(testCase, DEFAULT_AUDIO_SETTINGS.noteSeparationRatio);
      if (knownBad) {
        expect(
          result.advancesDetected,
          `${testCase.label} is in KNOWN_DETECTOR_FAILURES but now advances — remove it from the set`,
        ).toBeLessThan(testCase.expectedEventCount - 1);
      } else {
        expect(result.advancesDetected).toBe(testCase.expectedEventCount - 1);
        expect(result.finalActiveIndex).toBe(testCase.expectedEventCount - 1);
      }
    });
  }
});
