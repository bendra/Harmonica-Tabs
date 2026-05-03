/**
 * Offline detector test.
 *
 * Runs detectSingleNote() on real harmonica WAV recordings frame-by-frame,
 * the same way the live audio pipeline does it, and prints a summary table
 * showing how often the detector gets the right note for each hole/direction.
 *
 * Run with: npm run detect-offline
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

/**
 * Minimal WAV decoder supporting both standard PCM (format 0x0001) and
 * WAVE_FORMAT_EXTENSIBLE (0xFFFE), which macOS afconvert produces for simple
 * mono 16-bit files. Both use identical raw Int16 PCM sample data.
 *
 * Returns channel buffers normalized to the [-1, 1] float range, matching
 * the Web Audio API's Float32Array output from ScriptProcessor.
 */
function decodeWav(buffer: Buffer): { sampleRate: number; channelData: Float32Array[] } {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Not a RIFF file');
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAVE file');

  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = -1;

  let pos = 12;
  while (pos < buffer.length - 8) {
    const chunkId = buffer.toString('ascii', pos, pos + 4);
    const chunkSize = buffer.readUInt32LE(pos + 4);
    pos += 8;

    if (chunkId === 'fmt ') {
      const formatTag = buffer.readUInt16LE(pos);
      // 0x0001 = PCM, 0xFFFE = WAVE_FORMAT_EXTENSIBLE (used by macOS afconvert).
      // Both store raw little-endian integer samples in the data chunk.
      if (formatTag !== 1 && formatTag !== 0xFFFE) {
        throw new Error(`Unsupported WAV format tag: 0x${formatTag.toString(16)}`);
      }
      channels = buffer.readUInt16LE(pos + 2);
      sampleRate = buffer.readUInt32LE(pos + 4);
      bitsPerSample = buffer.readUInt16LE(pos + 14);
    } else if (chunkId === 'data') {
      dataOffset = pos;
      dataLength = chunkSize;
    }

    pos += chunkSize;
    if (chunkSize % 2 !== 0) pos++; // RIFF chunks are word-aligned
  }

  if (sampleRate === 0) throw new Error('WAV fmt chunk not found');
  if (dataOffset === -1) throw new Error('WAV data chunk not found');

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataLength / (bytesPerSample * channels));
  const channelData: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(totalSamples));
  const scale = 1 / Math.pow(2, bitsPerSample - 1);

  for (let i = 0; i < totalSamples; i++) {
    for (let c = 0; c < channels; c++) {
      const offset = dataOffset + (i * channels + c) * bytesPerSample;
      const sample = bitsPerSample === 16 ? buffer.readInt16LE(offset) : buffer.readInt32LE(offset);
      channelData[c][i] = sample * scale;
    }
  }

  return { sampleRate, channelData };
}

import { buildHarmonicaVocabulary } from '../src/logic/harmonica-frequencies';
import { RICHTER_C_LAYOUT, transposeLayout } from '../src/data/richter';
import { detectSingleNote } from '../src/logic/fft-detector';
import { DEFAULT_AUDIO_SETTINGS } from '../src/config/default-settings';
import {
  evaluateTransposerFollow,
  createTransposerFollowState,
  type DetectorSnapshot,
  type TransposerFollowStatus,
  type TransposerFollowState,
} from '../src/logic/transposer-follow';

const FRAME_SIZE = 4096;
const SAMPLES_DIR = path.resolve(process.cwd(), '../sound-samples');
const CONFIDENCE_SWEEP = [0.1, 0.2, 0.35, 0.5, 0.7];
const REPEATED_NOTE_FRAME_HOP_EXPERIMENTS = [
  { label: '4096/4096', frameSize: 4096, hopSize: 4096 },
  { label: '4096/2048', frameSize: 4096, hopSize: 2048 },
  { label: '2048/2048', frameSize: 2048, hopSize: 2048 },
  { label: '2048/1024', frameSize: 2048, hopSize: 1024 },
  { label: '1024/512', frameSize: 1024, hopSize: 512 },
];

// Map folder name → pitch class (semitones above C) for all 12 keys.
// Both enharmonic spellings are listed so recordings using either name work.
const KEY_PC: Record<string, number> = {
  c_harmonica:  0,
  db_harmonica: 1,  cs_harmonica: 1,
  d_harmonica:  2,
  eb_harmonica: 3,  ds_harmonica: 3,
  e_harmonica:  4,
  f_harmonica:  5,
  gb_harmonica: 6,  fs_harmonica: 6,
  g_harmonica:  7,
  ab_harmonica: 8,  gs_harmonica: 8,
  a_harmonica:  9,
  bb_harmonica: 10, as_harmonica: 10,
  b_harmonica:  11,
};

function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

function midiToName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const note = Math.round(midi);
  const octave = Math.floor(note / 12) - 1;
  return `${names[((note % 12) + 12) % 12]}${octave}`;
}

type FrameClass = 'silent' | 'correct' | 'wrong_octave' | 'wrong_note';

type AubioEvent = {
  midi: number;
  onsetSeconds: number;
  releaseSeconds: number;
};

type FollowFrameTrace = {
  frameIdx: number;
  timeSeconds: number;
  cls: FrameClass;
  rawHz: number | null;
  snappedHz: number | null;
  confidence: number;
  rms: number;
  status: TransposerFollowStatus;
  activeBefore: number | null;
  activeAfter: number | null;
  waitingBefore: boolean;
  waitingAfter: boolean;
  peakRmsAfter: number;
  lastAmplitudeReleaseRmsAfter: number | null;
  advanced: boolean;
};

type FrameHopExperimentResult = {
  label: string;
  frameSize: number;
  hopSize: number;
  totalFrames: number;
  activeFrames: number;
  correctFrames: number;
  wrongOctaveFrames: number;
  wrongNoteFrames: number;
  advancesDetected: number;
  expectedAdvances: number;
  maxConfidence: number | null;
  medianConfidence: number | null;
  maxRms: number | null;
  medianRms: number | null;
};

type FileResult = {
  harmonica: string;
  take: string;
  hole: number;
  dir: string;
  expectedNote: string;
  expectedHz: number;
  counts: Record<FrameClass, number>;
  totalFrames: number;
  // Only non-silent frames are stored for per-frame detail.
  frames: Array<{
    frameIdx: number;
    cls: FrameClass;
    rawHz: number | null;
    snappedHz: number | null;
  }>;
  /** Populated only for repeated-note files. */
  advanceCount?: { detected: number; expected: number };
  /** Advances detected at each CONFIDENCE_SWEEP threshold. Parallel to CONFIDENCE_SWEEP. */
  sweepAdvances?: number[];
  /** Aubio note-event cross-reference for repeated-note files, when available. */
  aubioEvents?: AubioEvent[];
  /** App follow trace for repeated-note files. */
  followTrace?: FollowFrameTrace[];
  /** Sample rate used to convert detector frame indexes to seconds. */
  sampleRate?: number;
  /** Full decoded repeated-note samples for offline-only follow experiments. */
  repeatedSamples?: Float32Array;
  /** MIDI number expected for repeated-note files. */
  expectedMidi?: number;
};

function classifyFrame(snappedHz: number | null, expectedMidi: number): FrameClass {
  if (snappedHz === null) return 'silent';
  const snappedMidi = Math.round(freqToMidi(snappedHz));
  const exp = Math.round(expectedMidi);
  if (snappedMidi === exp) return 'correct';
  if (Math.abs(snappedMidi - exp) === 12) return 'wrong_octave';
  return 'wrong_note';
}

function pct(count: number, total: number): string {
  if (total === 0) return ' -- ';
  return `${Math.round((count / total) * 100)}%`;
}

function col(s: string | number, width: number, right = false): string {
  const str = String(s);
  return right ? str.padStart(width) : str.padEnd(width);
}

function fmtRms(value: number): string {
  return value.toFixed(4);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

let aubioUnavailableReason: string | null = null;

function runAubioNotes(filePath: string): AubioEvent[] | null {
  if (aubioUnavailableReason) return null;

  const result = spawnSync('aubio', ['notes', filePath, '-s', '-50'], {
    encoding: 'utf8',
  });

  if (result.error) {
    aubioUnavailableReason = result.error.message;
    return null;
  }

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    aubioUnavailableReason = stderr || `aubio exited with status ${result.status}`;
    return null;
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const parts = line.split(/\s+/);
      if (parts.length !== 3) return [];
      const [midi, onsetSeconds, releaseSeconds] = parts.map(Number);
      if (![midi, onsetSeconds, releaseSeconds].every(Number.isFinite)) return [];
      return [{ midi, onsetSeconds, releaseSeconds }];
    });
}

function frameTraceLabel(frame: FollowFrameTrace | undefined): string {
  if (!frame) return 'no app frame';
  const snapped = frame.snappedHz == null
    ? 'null'
    : `${midiToName(freqToMidi(frame.snappedHz))} ${frame.snappedHz.toFixed(1)}Hz`;
  const advance = frame.advanced ? ' ADV' : '';
  return `frame ${frame.frameIdx} ${frame.status}${advance} ${frame.cls} conf=${frame.confidence.toFixed(2)} rms=${fmtRms(frame.rms)} snapped=${snapped}`;
}

function nearestTraceFrame(trace: FollowFrameTrace[], targetFrameIdx: number): FollowFrameTrace | undefined {
  let nearest: FollowFrameTrace | undefined;
  for (const frame of trace) {
    if (!nearest || Math.abs(frame.frameIdx - targetFrameIdx) < Math.abs(nearest.frameIdx - targetFrameIdx)) {
      nearest = frame;
    }
  }
  return nearest;
}

function evaluateRepeatedNoteWithFrameHop(input: {
  samples: Float32Array;
  sampleRate: number;
  vocabulary: ReturnType<typeof buildHarmonicaVocabulary>;
  expectedMidi: number;
  expectedEventCount: number;
  hole: number;
  frameSize: number;
  hopSize: number;
  label: string;
}): FrameHopExperimentResult {
  const {
    expectedEventCount,
    expectedMidi,
    frameSize,
    hole,
    hopSize,
    label,
    sampleRate,
    samples,
    vocabulary,
  } = input;
  const followTokens = Array.from({ length: expectedEventCount }, () => ({
    tokenIndex: 0,
    text: String(hole),
    midi: expectedMidi,
  }));
  const expectedAdvances = expectedEventCount - 1;
  const totalFrames =
    samples.length >= frameSize
      ? Math.floor((samples.length - frameSize) / hopSize) + 1
      : 0;
  let followState = createTransposerFollowState(0);
  let advancesDetected = 0;
  let activeFrames = 0;
  let correctFrames = 0;
  let wrongOctaveFrames = 0;
  let wrongNoteFrames = 0;
  const activeConfidence: number[] = [];
  const activeRms: number[] = [];
  let doneCounting = false;

  for (let i = 0; i < totalFrames; i++) {
    const start = i * hopSize;
    const frame = samples.slice(start, start + frameSize);
    const result = detectSingleNote(frame, sampleRate, vocabulary);
    const cls = classifyFrame(result.frequency, expectedMidi);
    if (cls !== 'silent') {
      activeFrames++;
      activeConfidence.push(result.confidence);
      activeRms.push(result.rms);
      if (cls === 'correct') correctFrames++;
      if (cls === 'wrong_octave') wrongOctaveFrames++;
      if (cls === 'wrong_note') wrongNoteFrames++;
    }

    if (!doneCounting) {
      const followResult = evaluateTransposerFollow({
        enabled: true,
        tokens: followTokens,
        state: followState,
        detector: {
          frequency: result.frequency,
          confidence: result.confidence,
          rms: result.rms,
          source: 'web',
          lastDetectedAt: null,
        },
        toneToleranceCents: DEFAULT_AUDIO_SETTINGS.toneToleranceCents,
        minConfidence: DEFAULT_AUDIO_SETTINGS.toneFollowMinConfidence,
        noteSeparationRatio: DEFAULT_AUDIO_SETTINGS.noteSeparationRatio,
      });
      followState = followResult.state;
      if (followResult.status === 'advanced') {
        advancesDetected++;
        if (advancesDetected >= expectedAdvances) doneCounting = true;
      }
    }
  }

  return {
    label,
    frameSize,
    hopSize,
    totalFrames,
    activeFrames,
    correctFrames,
    wrongOctaveFrames,
    wrongNoteFrames,
    advancesDetected,
    expectedAdvances,
    maxConfidence: activeConfidence.length > 0 ? Math.max(...activeConfidence) : null,
    medianConfidence: median(activeConfidence),
    maxRms: activeRms.length > 0 ? Math.max(...activeRms) : null,
    medianRms: median(activeRms),
  };
}

/**
 * Measures signal power at a single frequency using the Goertzel algorithm.
 * Returns the squared magnitude (power) at `freq` Hz for the given frame.
 */
function goertzel(frame: Float32Array, freq: number, sampleRate: number): number {
  const omega = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i] + coeff * s1 - s2;
    s2 = s1; s1 = s;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

function main() {
  const results: FileResult[] = [];

  // Discover all harmonica folders that exist on disk and are in the key map.
  const availableKeys = fs.existsSync(SAMPLES_DIR)
    ? fs.readdirSync(SAMPLES_DIR).filter(d => KEY_PC[d] !== undefined)
    : [];

  if (availableKeys.length === 0) {
    console.warn(`No harmonica folders found in: ${SAMPLES_DIR}`);
    console.warn('Run scripts/record-samples.sh to create recordings.');
    return;
  }

  for (const harmKey of availableKeys.sort()) {
    const pc = KEY_PC[harmKey];
    const vocabulary = buildHarmonicaVocabulary(pc);
    const harmDir = path.join(SAMPLES_DIR, harmKey, 'single_notes');

    if (!fs.existsSync(harmDir)) {
      console.warn(`Directory not found: ${harmDir}`);
      continue;
    }

    for (const takeDir of fs.readdirSync(harmDir).sort()) {
      if (!takeDir.startsWith('take_')) continue;
      const takePath = path.join(harmDir, takeDir);

      for (const filename of fs.readdirSync(takePath).sort()) {
        if (!filename.endsWith('.wav')) continue;

        // Parse hole and direction — handle both "2_draw.wav" and "2-draw.wav"
        const match = filename.match(/^(\d+)[_-](blow|draw)\.wav$/);
        if (!match) continue;
        const hole = parseInt(match[1], 10);
        const dir = match[2] as 'blow' | 'draw';

        const expectedNote = vocabulary.naturalNotes.find(
          n => n.hole === hole && n.technique === dir,
        );
        if (!expectedNote) {
          console.warn(`No vocab entry: hole ${hole} ${dir} on ${harmKey}`);
          continue;
        }

        // Decode WAV → Float32 samples normalized to [-1, 1]
        const buffer = fs.readFileSync(path.join(takePath, filename));
        const decoded = decodeWav(buffer);
        const samples = decoded.channelData[0]; // mono
        const sampleRate = decoded.sampleRate;

        const counts: Record<FrameClass, number> = {
          silent: 0, correct: 0, wrong_octave: 0, wrong_note: 0,
        };
        const frames: FileResult['frames'] = [];
        const totalFrames = Math.floor(samples.length / FRAME_SIZE);

        for (let i = 0; i < totalFrames; i++) {
          const frame = samples.slice(i * FRAME_SIZE, (i + 1) * FRAME_SIZE);
          const result = detectSingleNote(frame, sampleRate, vocabulary);
          const cls = classifyFrame(result.frequency, expectedNote.midi);
          counts[cls]++;
          if (cls !== 'silent') {
            frames.push({
              frameIdx: i,
              cls,
              rawHz: result.rawFrequency,
              snappedHz: result.frequency,
            });
          }
        }

        results.push({
          harmonica: harmKey.replace('_harmonica', '').toUpperCase(),
          take: takeDir.replace('take_', ''),
          hole,
          dir,
          expectedNote: midiToName(expectedNote.midi),
          expectedHz: expectedNote.frequency,
          counts,
          totalFrames,
          frames,
        });
      }
    }
  }

  // --- Summary table ---
  // correct/wrong_oct/wrong_note are % of active (non-silent) frames.
  // silent is % of total frames.
  console.log('\n=== Offline Detector Results ===\n');
  console.log('  (correct/wrong columns = % of active frames; silent = % of total)');
  console.log();
  const hdr = [
    col('key', 4), col('take', 5), col('hole', 5), col('dir', 5),
    col('expected', 14),
    col('correct', 8, true), col('wrong_oct', 10, true),
    col('wrong_note', 11, true), col('silent', 7, true), col('frames', 7, true),
  ].join(' ');
  console.log(hdr);
  console.log('-'.repeat(hdr.length));

  for (const r of results) {
    const active = r.totalFrames - r.counts.silent;
    const row = [
      col(r.harmonica, 4), col(r.take, 5), col(r.hole, 5), col(r.dir, 5),
      col(`${r.expectedNote} ${r.expectedHz.toFixed(1)}Hz`, 14),
      col(pct(r.counts.correct, active), 8, true),
      col(pct(r.counts.wrong_octave, active), 10, true),
      col(pct(r.counts.wrong_note, active), 11, true),
      col(pct(r.counts.silent, r.totalFrames), 7, true),
      col(r.totalFrames, 7, true),
    ].join(' ');
    console.log(row);
  }

  // --- Per-frame detail for problem files (wrong_octave > 10% of active frames) ---
  const problemFiles = results.filter(r => {
    const active = r.totalFrames - r.counts.silent;
    return active > 0 && r.counts.wrong_octave / active > 0.10;
  });
  if (problemFiles.length > 0) {
    console.log('\n=== Per-frame detail: files with >10% wrong octave ===');
    for (const r of problemFiles) {
      console.log(`\n${r.harmonica} take ${r.take}  hole ${r.hole} ${r.dir}  (expected ${r.expectedNote} ${r.expectedHz.toFixed(1)}Hz)`);
      for (const f of r.frames) {
        const rawStr = f.rawHz != null
          ? `raw=${f.rawHz.toFixed(1).padStart(7)}Hz (${midiToName(freqToMidi(f.rawHz)).padEnd(4)})`
          : 'raw=        null         ';
        const snappedStr = f.snappedHz != null
          ? `snapped=${f.snappedHz.toFixed(1)}Hz (${midiToName(freqToMidi(f.snappedHz))})`
          : 'snapped=null';
        console.log(`  frame ${String(f.frameIdx).padStart(3)}: [${f.cls.padEnd(12)}] ${rawStr}  ${snappedStr}`);
      }
    }
  } else {
    console.log('\nNo files with >10% wrong octave. Good!');
  }

  // --- Summary stats per harmonica ---
  console.log('\n=== Summary by harmonica ===\n');
  const summaryKeys = [...new Set(results.map(r => r.harmonica))].sort();
  for (const key of summaryKeys) {
    const rows = results.filter(r => r.harmonica === key);
    if (rows.length === 0) continue;
    const total = rows.reduce((s, r) => s + r.totalFrames, 0);
    const correct = rows.reduce((s, r) => s + r.counts.correct, 0);
    const wrongOct = rows.reduce((s, r) => s + r.counts.wrong_octave, 0);
    const wrongNote = rows.reduce((s, r) => s + r.counts.wrong_note, 0);
    const silent = rows.reduce((s, r) => s + r.counts.silent, 0);
    const active = total - silent;
    console.log(`${key}: ${pct(correct, active)} correct, ${pct(wrongOct, active)} wrong octave, ${pct(wrongNote, active)} wrong note, ${pct(silent, total)} silent  (${total} frames across ${rows.length} files)`);
  }
  console.log();

  // --- Spectral content: fundamental vs 2nd harmonic for G harmonica ---
  console.log('=== Spectral content (G harmonica — fundamental vs 2nd harmonic) ===\n');
  const specHdr = [
    col('take', 5), col('hole', 5), col('dir', 5),
    col('expected', 14),
    col('fund/harm ratio', 16, true),
    col('verdict', 20),
  ].join(' ');
  console.log(specHdr);
  console.log('-'.repeat(specHdr.length));

  const gHarmDir = path.join(SAMPLES_DIR, 'g_harmonica', 'single_notes');
  if (!fs.existsSync(gHarmDir)) {
    console.log('G harmonica directory not found — skipping spectral analysis.');
  } else {
    const gVocab = buildHarmonicaVocabulary(7);

    for (const takeDir of fs.readdirSync(gHarmDir).sort()) {
      if (!takeDir.startsWith('take_')) continue;
      const takePath = path.join(gHarmDir, takeDir);

      for (const filename of fs.readdirSync(takePath).sort()) {
        if (!filename.endsWith('.wav')) continue;

        const match = filename.match(/^(\d+)[_-](blow|draw)\.wav$/);
        if (!match) continue;
        const hole = parseInt(match[1], 10);
        const dir = match[2] as 'blow' | 'draw';

        const expectedNote = gVocab.naturalNotes.find(
          n => n.hole === hole && n.technique === dir,
        );
        if (!expectedNote) continue;

        const buffer = fs.readFileSync(path.join(takePath, filename));
        const decoded = decodeWav(buffer);
        const samples = decoded.channelData[0];
        const sampleRate = decoded.sampleRate;
        const totalFrames = Math.floor(samples.length / FRAME_SIZE);

        let fundPowerTotal = 0;
        let harmPowerTotal = 0;

        for (let i = 0; i < totalFrames; i++) {
          const frame = samples.slice(i * FRAME_SIZE, (i + 1) * FRAME_SIZE);
          fundPowerTotal += goertzel(frame, expectedNote.frequency, sampleRate);
          harmPowerTotal += goertzel(frame, expectedNote.frequency * 2, sampleRate);
        }

        const ratio = harmPowerTotal > 0 ? fundPowerTotal / harmPowerTotal : Infinity;
        const verdict =
          ratio > 1.5 ? 'fundamental dominant' :
          ratio < 0.5 ? 'harmonic dominant  ' :
          'mixed              ';

        const row = [
          col(takeDir.replace('take_', ''), 5),
          col(hole, 5),
          col(dir, 5),
          col(`${midiToName(expectedNote.midi)} ${expectedNote.frequency.toFixed(1)}Hz`, 14),
          col(ratio.toFixed(3), 16, true),
          col(verdict, 20),
        ].join(' ');
        console.log(row);
      }
    }
  }
  console.log();

  // -----------------------------------------------------------------------
  // Repeated notes processing
  // -----------------------------------------------------------------------
  const repeatResults: FileResult[] = [];

  for (const harmKey of availableKeys.sort()) {
    const pc = KEY_PC[harmKey];
    const vocabulary = buildHarmonicaVocabulary(pc);
    const harmDir = path.join(SAMPLES_DIR, harmKey, 'repeated_notes');

    if (!fs.existsSync(harmDir)) continue;  // repeated_notes is optional

    for (const takeDir of fs.readdirSync(harmDir).sort()) {
      if (!takeDir.startsWith('take_')) continue;
      const takePath = path.join(harmDir, takeDir);

      for (const filename of fs.readdirSync(takePath).sort()) {
        if (!filename.endsWith('.wav')) continue;

        const match = filename.match(/^(\d+)[_-](blow|draw)_x(\d+)\.wav$/);
        if (!match) continue;
        const hole = parseInt(match[1], 10);
        const dir = match[2] as 'blow' | 'draw';
        const expectedEventCount = parseInt(match[3], 10);

        const expectedNote = vocabulary.naturalNotes.find(
          n => n.hole === hole && n.technique === dir,
        );
        if (!expectedNote) {
          console.warn(`No vocab entry: hole ${hole} ${dir} on ${harmKey}`);
          continue;
        }

        const buffer = fs.readFileSync(path.join(takePath, filename));
        const decoded = decodeWav(buffer);
        const samples = decoded.channelData[0];
        const sampleRate = decoded.sampleRate;
        const filePath = path.join(takePath, filename);
        const aubioEvents = runAubioNotes(filePath);

        const followTokens = Array.from({ length: expectedEventCount }, () => ({
          tokenIndex: 0,
          text: String(hole),
          midi: expectedNote.midi,
        }));

        const counts: Record<FrameClass, number> = {
          silent: 0, correct: 0, wrong_octave: 0, wrong_note: 0,
        };
        const frames: FileResult['frames'] = [];
        const totalFrames = Math.floor(samples.length / FRAME_SIZE);

        const maxAdvances = expectedEventCount - 1;
        let followState = createTransposerFollowState(0);
        let advancesDetected = 0;
        let doneCounting = false;
        const followTrace: FollowFrameTrace[] = [];

        for (let i = 0; i < totalFrames; i++) {
          const frame = samples.slice(i * FRAME_SIZE, (i + 1) * FRAME_SIZE);
          const result = detectSingleNote(frame, sampleRate, vocabulary);
          const cls = classifyFrame(result.frequency, expectedNote.midi);
          counts[cls]++;
          if (cls !== 'silent') {
            frames.push({ frameIdx: i, cls, rawHz: result.rawFrequency, snappedHz: result.frequency });
          }

          if (!doneCounting) {
            const snapshot: DetectorSnapshot = {
              frequency: result.frequency,
              confidence: result.confidence,
              rms: result.rms,
              source: 'web',
              lastDetectedAt: null,
            };
            const previousState: TransposerFollowState = { ...followState };
            const followResult = evaluateTransposerFollow({
              enabled: true,
              tokens: followTokens,
              state: followState,
              detector: snapshot,
              toneToleranceCents: DEFAULT_AUDIO_SETTINGS.toneToleranceCents,
              minConfidence: DEFAULT_AUDIO_SETTINGS.toneFollowMinConfidence,
              noteSeparationRatio: DEFAULT_AUDIO_SETTINGS.noteSeparationRatio,
            });
            followState = followResult.state;
            followTrace.push({
              frameIdx: i,
              timeSeconds: (i * FRAME_SIZE) / sampleRate,
              cls,
              rawHz: result.rawFrequency,
              snappedHz: result.frequency,
              confidence: result.confidence,
              rms: result.rms,
              status: followResult.status,
              activeBefore: previousState.activeTokenIndex,
              activeAfter: followState.activeTokenIndex,
              waitingBefore: previousState.waitingForRelease,
              waitingAfter: followState.waitingForRelease,
              peakRmsAfter: followState.peakRmsSinceAdvance,
              lastAmplitudeReleaseRmsAfter: followState.lastAmplitudeReleaseRms,
              advanced: followResult.status === 'advanced',
            });
            if (followResult.status === 'advanced') {
              advancesDetected++;
              if (advancesDetected >= maxAdvances) doneCounting = true;
            }
          }
        }

        const sweepAdvances: number[] = CONFIDENCE_SWEEP.map((minConf) => {
          let state = createTransposerFollowState(0);
          let advances = 0;
          let done = false;
          for (let i = 0; i < totalFrames; i++) {
            if (done) break;
            const frame = samples.slice(i * FRAME_SIZE, (i + 1) * FRAME_SIZE);
            const result = detectSingleNote(frame, sampleRate, vocabulary);
            const followResult = evaluateTransposerFollow({
              enabled: true,
              tokens: followTokens,
              state,
              detector: {
                frequency: result.frequency,
                confidence: result.confidence,
                rms: result.rms,
                source: 'web',
                lastDetectedAt: null,
              },
              toneToleranceCents: DEFAULT_AUDIO_SETTINGS.toneToleranceCents,
              minConfidence: minConf,
              noteSeparationRatio: DEFAULT_AUDIO_SETTINGS.noteSeparationRatio,
            });
            state = followResult.state;
            if (followResult.status === 'advanced') {
              advances++;
              if (advances >= maxAdvances) done = true;
            }
          }
          return advances;
        });

        repeatResults.push({
          harmonica: harmKey.replace('_harmonica', '').toUpperCase(),
          take: takeDir.replace('take_', ''),
          hole, dir,
          expectedNote: midiToName(expectedNote.midi),
          expectedHz: expectedNote.frequency,
          counts, totalFrames, frames,
          advanceCount: { detected: advancesDetected, expected: maxAdvances },
          sweepAdvances,
          aubioEvents: aubioEvents ?? undefined,
          followTrace,
          sampleRate,
          repeatedSamples: samples,
          expectedMidi: expectedNote.midi,
        });
      }
    }
  }

  // --- Repeated notes results ---
  if (repeatResults.length > 0) {
    console.log('\n=== Repeated Notes Results ===\n');
    console.log(`  Settings: tolerance=${DEFAULT_AUDIO_SETTINGS.toneToleranceCents}¢  confidence=${DEFAULT_AUDIO_SETTINGS.toneFollowMinConfidence}  noteSeparation=${DEFAULT_AUDIO_SETTINGS.noteSeparationRatio}`);
    console.log('  (correct/wrong = % of active frames; silent = % of total; advances = detected/expected)');
    console.log();
    const repHdr = [
      col('key', 4), col('take', 5), col('hole', 5), col('dir', 5),
      col('expected', 14),
      col('correct', 8, true), col('wrong_oct', 10, true),
      col('wrong_note', 11, true), col('silent', 7, true),
      col('frames', 7, true), col('advances', 9, true),
    ].join(' ');
    console.log(repHdr);
    console.log('-'.repeat(repHdr.length));

    for (const r of repeatResults) {
      const active = r.totalFrames - r.counts.silent;
      const advStr = r.advanceCount
        ? `${r.advanceCount.detected}/${r.advanceCount.expected}`
        : '--';
      const row = [
        col(r.harmonica, 4), col(r.take, 5), col(r.hole, 5), col(r.dir, 5),
        col(`${r.expectedNote} ${r.expectedHz.toFixed(1)}Hz`, 14),
        col(pct(r.counts.correct, active), 8, true),
        col(pct(r.counts.wrong_octave, active), 10, true),
        col(pct(r.counts.wrong_note, active), 11, true),
        col(pct(r.counts.silent, r.totalFrames), 7, true),
        col(r.totalFrames, 7, true),
        col(advStr, 9, true),
      ].join(' ');
      console.log(row);
    }
    console.log();
  }

  const repeatFailures = repeatResults.filter((r) =>
    r.advanceCount !== undefined && r.advanceCount.detected < r.advanceCount.expected
  );
  if (repeatFailures.length > 0) {
    console.log('=== Repeated Notes: Failure Detail ===\n');
    if (aubioUnavailableReason) {
      console.log(`  aubio unavailable; skipping aubio cross-reference (${aubioUnavailableReason})`);
      console.log();
    }

    for (const r of repeatFailures) {
      const active = r.totalFrames - r.counts.silent;
      const trace = r.followTrace ?? [];
      const activeFrames = trace.filter((frame) => frame.cls !== 'silent');
      const activeConfidence = activeFrames.map((frame) => frame.confidence);
      const activeRms = activeFrames.map((frame) => frame.rms);
      const maxConfidence = activeConfidence.length > 0 ? Math.max(...activeConfidence) : null;
      const medianConfidence = median(activeConfidence);
      const maxRms = activeRms.length > 0 ? Math.max(...activeRms) : null;
      const medianRms = median(activeRms);
      const advances = trace.filter((frame) => frame.advanced);
      const lastTrace = trace.at(-1);

      console.log(`${r.harmonica} take ${r.take}  hole ${r.hole} ${r.dir}  ${r.expectedNote} ${r.expectedHz.toFixed(1)}Hz`);
      console.log(`  advances: ${r.advanceCount?.detected}/${r.advanceCount?.expected}; active frames: ${active}/${r.totalFrames}; silent: ${pct(r.counts.silent, r.totalFrames)}`);
      console.log(
        `  confidence: max=${maxConfidence == null ? '--' : maxConfidence.toFixed(2)} median=${medianConfidence == null ? '--' : medianConfidence.toFixed(2)}; ` +
        `rms: max=${maxRms == null ? '--' : fmtRms(maxRms)} median=${medianRms == null ? '--' : fmtRms(medianRms)}`,
      );

      if (r.aubioEvents) {
        const eventSummary = r.aubioEvents.length === 0
          ? 'no note events'
          : r.aubioEvents
              .map((event) => `${midiToName(event.midi)} ${event.onsetSeconds.toFixed(3)}-${event.releaseSeconds.toFixed(3)}s`)
              .join(', ');
        const expectedEvents = (r.advanceCount?.expected ?? 0) + 1;
        console.log(`  aubio: ${r.aubioEvents.length}/${expectedEvents} events: ${eventSummary}`);

        if (r.aubioEvents.length > 0 && r.sampleRate) {
          const nearbyRows = r.aubioEvents.map((event) => {
            const onsetFrame = Math.round((event.onsetSeconds * r.sampleRate!) / FRAME_SIZE);
            const nearby = trace.filter((frame) => Math.abs(frame.frameIdx - onsetFrame) <= 1);
            const nearest = nearestTraceFrame(trace, onsetFrame);
            const advancedNear = nearby.some((frame) => frame.advanced);
            const nearbyText = nearby.length > 0
              ? nearby.map(frameTraceLabel).join('; ')
              : frameTraceLabel(nearest);
            return `${midiToName(event.midi)} @ ${event.onsetSeconds.toFixed(3)}s -> ${advancedNear ? 'advance near' : 'no advance near'}; ${nearbyText}`;
          });
          console.log('  app frames near aubio onsets:');
          nearbyRows.forEach((row) => console.log(`    ${row}`));
        }
      } else if (!aubioUnavailableReason) {
        console.log('  aubio: no cross-reference available');
      }

      if (advances.length > 0) {
        console.log(`  app advances: ${advances.map((frame) => `frame ${frame.frameIdx} @ ${frame.timeSeconds.toFixed(3)}s`).join(', ')}`);
      } else {
        console.log('  app advances: none');
      }
      if (lastTrace) {
        console.log(`  final app state: active=${lastTrace.activeAfter} waiting=${lastTrace.waitingAfter} peakRms=${fmtRms(lastTrace.peakRmsAfter)} lastReleaseRms=${lastTrace.lastAmplitudeReleaseRmsAfter == null ? 'null' : fmtRms(lastTrace.lastAmplitudeReleaseRmsAfter)}`);
      }
      console.log();
    }
  } else if (repeatResults.length > 0 && aubioUnavailableReason) {
    console.log(`aubio unavailable; skipping aubio cross-reference (${aubioUnavailableReason})`);
    console.log();
  }

  if (repeatFailures.length > 0) {
    console.log('=== Repeated Notes: Frame/Hop Experiment ===\n');
    console.log('  Offline-only experiment: re-runs failed repeated-note files with alternate detector frame/hop sizes.');
    console.log('  advances = detected/expected at default tone-follow settings; active/correct are frame counts.');
    console.log();

    const expHdr = [
      col('key', 4), col('take', 5), col('hole', 5), col('dir', 5),
      col('expected', 14), col('window', 10),
      col('active', 8, true), col('correct', 8, true),
      col('wrong', 8, true), col('conf', 6, true),
      col('rms', 8, true), col('adv', 7, true),
    ].join(' ');
    console.log(expHdr);
    console.log('-'.repeat(expHdr.length));

    for (const r of repeatFailures) {
      if (!r.repeatedSamples || !r.sampleRate || r.expectedMidi == null || !r.advanceCount) continue;
      const pc = KEY_PC[`${r.harmonica.toLowerCase()}_harmonica`];
      if (pc === undefined) continue;
      const vocabulary = buildHarmonicaVocabulary(pc);
      const expectedEventCount = r.advanceCount.expected + 1;
      const rows = REPEATED_NOTE_FRAME_HOP_EXPERIMENTS.map((experiment) =>
        evaluateRepeatedNoteWithFrameHop({
          samples: r.repeatedSamples as Float32Array,
          sampleRate: r.sampleRate as number,
          vocabulary,
          expectedMidi: r.expectedMidi as number,
          expectedEventCount,
          hole: r.hole,
          frameSize: experiment.frameSize,
          hopSize: experiment.hopSize,
          label: experiment.label,
        }),
      );

      for (const result of rows) {
        const wrong = result.wrongOctaveFrames + result.wrongNoteFrames;
        const row = [
          col(r.harmonica, 4), col(r.take, 5), col(r.hole, 5), col(r.dir, 5),
          col(`${r.expectedNote} ${r.expectedHz.toFixed(1)}Hz`, 14),
          col(result.label, 10),
          col(`${result.activeFrames}/${result.totalFrames}`, 8, true),
          col(result.correctFrames, 8, true),
          col(wrong, 8, true),
          col(result.medianConfidence == null ? '--' : result.medianConfidence.toFixed(2), 6, true),
          col(result.medianRms == null ? '--' : fmtRms(result.medianRms), 8, true),
          col(`${result.advancesDetected}/${result.expectedAdvances}`, 7, true),
        ].join(' ');
        console.log(row);
      }
      console.log();
    }
  }

  // --- Confidence sweep for repeated notes ---
  if (repeatResults.length > 0 && repeatResults[0].sweepAdvances) {
    console.log('=== Repeated Notes: Confidence Sweep ===\n');
    console.log(`  (advances detected/expected at each minConfidence; noteSeparation=${DEFAULT_AUDIO_SETTINGS.noteSeparationRatio})`);
    console.log();
    const sweepCols = CONFIDENCE_SWEEP.map(c => c.toFixed(2));
    const sweepHdr = [
      col('key', 4), col('take', 5), col('hole', 5), col('dir', 5),
      col('expected', 14),
      ...sweepCols.map(c => col(c, 7, true)),
    ].join(' ');
    console.log(sweepHdr);
    console.log('-'.repeat(sweepHdr.length));

    for (const r of repeatResults) {
      const maxAdv = r.advanceCount?.expected ?? 0;
      const row = [
        col(r.harmonica, 4), col(r.take, 5), col(r.hole, 5), col(r.dir, 5),
        col(`${r.expectedNote} ${r.expectedHz.toFixed(1)}Hz`, 14),
        ...(r.sweepAdvances ?? []).map(adv => col(`${adv}/${maxAdv}`, 7, true)),
      ].join(' ');
      console.log(row);
    }
    console.log();
  }

  // -----------------------------------------------------------------------
  // Chord verification
  // -----------------------------------------------------------------------
  console.log('=== Chord Verification ===\n');
  console.log('  Goertzel power at each expected note frequency, relative to the strongest in the chord.');
  console.log('  WEAK = below 15% of strongest; may mean a note was not played or is inaudible.');
  console.log();

  let anyChords = false;

  for (const harmKey of availableKeys.sort()) {
    const pc = KEY_PC[harmKey];
    const chordBaseDir = path.join(SAMPLES_DIR, harmKey, 'chords');

    if (!fs.existsSync(chordBaseDir)) continue;
    anyChords = true;

    const keyLabel = harmKey.replace('_harmonica', '').toUpperCase();

    // Build a hole→MIDI map directly from the transposed layout so every
    // hole/direction combination is available, including duplicates like
    // hole 3 blow and hole 2 draw that share the same MIDI and get deduplicated
    // in the vocabulary.
    const semitones = pc >= 7 ? pc - 12 : pc;
    const harpLayout = transposeLayout(RICHTER_C_LAYOUT, semitones);
    const holeFreqMap = new Map<string, { midi: number; freq: number }>();
    for (const h of harpLayout) {
      const blowFreq = 440 * Math.pow(2, (h.blowMidi - 69) / 12);
      const drawFreq = 440 * Math.pow(2, (h.drawMidi - 69) / 12);
      holeFreqMap.set(`${h.hole}_blow`, { midi: h.blowMidi, freq: blowFreq });
      holeFreqMap.set(`${h.hole}_draw`, { midi: h.drawMidi, freq: drawFreq });
    }

    for (const takeDir of fs.readdirSync(chordBaseDir).sort()) {
      if (!takeDir.startsWith('take_')) continue;
      const takePath = path.join(chordBaseDir, takeDir);

      for (const filename of fs.readdirSync(takePath).sort()) {
        if (!filename.endsWith('.wav')) continue;

        const chordName = filename.replace('.wav', '');
        const tokens = chordName.split('-');

        const expectedNotes: Array<{ hole: number; dir: string; freq: number; noteName: string }> = [];
        let parseOk = true;
        for (const token of tokens) {
          const m = token.match(/^(\d+)_(blow|draw)$/);
          if (!m) { parseOk = false; break; }
          const hole = parseInt(m[1], 10);
          const dir = m[2];
          const entry = holeFreqMap.get(`${hole}_${dir}`);
          if (!entry) { parseOk = false; break; }
          expectedNotes.push({ hole, dir, freq: entry.freq, noteName: midiToName(entry.midi) });
        }

        if (!parseOk || expectedNotes.length === 0) {
          console.log(`  ${keyLabel} ${takeDir}  ${filename}  [could not parse filename]\n`);
          continue;
        }

        const buffer = fs.readFileSync(path.join(takePath, filename));
        const decoded = decodeWav(buffer);
        const samples = decoded.channelData[0];
        const sampleRate = decoded.sampleRate;
        const totalFrames = Math.floor(samples.length / FRAME_SIZE);

        const powers = new Array<number>(expectedNotes.length).fill(0);
        let activeFrameCount = 0;

        for (let i = 0; i < totalFrames; i++) {
          const frame = samples.slice(i * FRAME_SIZE, (i + 1) * FRAME_SIZE);
          const rms = Math.sqrt(frame.reduce((s, x) => s + x * x, 0) / frame.length);
          if (rms < 0.001) continue;
          activeFrameCount++;
          for (let j = 0; j < expectedNotes.length; j++) {
            powers[j] += goertzel(frame, expectedNotes[j].freq, sampleRate);
          }
        }

        const maxPower = Math.max(...powers);
        const noteLabels = expectedNotes.map(n => `${n.noteName}(${n.hole}_${n.dir})`).join(', ');
        console.log(`  ${keyLabel} ${takeDir}  ${chordName}  [${noteLabels}]  (${activeFrameCount} active frames)`);

        for (let j = 0; j < expectedNotes.length; j++) {
          const ratio = maxPower > 0 ? powers[j] / maxPower : 0;
          const bar = '█'.repeat(Math.round(ratio * 10)).padEnd(10);
          const weak = ratio < 0.15 ? '  ← WEAK' : '';
          const n = expectedNotes[j];
          console.log(`    ${n.noteName.padEnd(4)} ${n.freq.toFixed(1).padStart(7)}Hz  ${bar}  ${ratio.toFixed(2)}${weak}`);
        }
        console.log();
      }
    }
  }

  if (!anyChords) {
    console.log('  No chord recordings found.\n');
  }
}

main();
