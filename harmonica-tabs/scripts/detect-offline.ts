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
import { detectSingleNote } from '../src/logic/fft-detector';

const FRAME_SIZE = 4096;
const AIFC_DIR = path.resolve(process.cwd(), '../aifc');

// Map folder name → pitch class (semitones above C)
const KEY_PC: Record<string, number> = {
  g_harmonica: 7,
  c_harmonica: 0,
  e_harmonica: 4,
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

  for (const harmKey of ['g_harmonica', 'c_harmonica', 'e_harmonica']) {
    const pc = KEY_PC[harmKey];
    const vocabulary = buildHarmonicaVocabulary(pc);
    const harmDir = path.join(AIFC_DIR, harmKey, 'single_notes');

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
  console.log('\n=== Offline Detector Results ===\n');
  const hdr = [
    col('key', 4), col('take', 5), col('hole', 5), col('dir', 5),
    col('expected', 14),
    col('correct', 8, true), col('wrong_oct', 10, true),
    col('wrong_note', 11, true), col('silent', 7, true), col('frames', 7, true),
  ].join(' ');
  console.log(hdr);
  console.log('-'.repeat(hdr.length));

  for (const r of results) {
    const row = [
      col(r.harmonica, 4), col(r.take, 5), col(r.hole, 5), col(r.dir, 5),
      col(`${r.expectedNote} ${r.expectedHz.toFixed(1)}Hz`, 14),
      col(pct(r.counts.correct, r.totalFrames), 8, true),
      col(pct(r.counts.wrong_octave, r.totalFrames), 10, true),
      col(pct(r.counts.wrong_note, r.totalFrames), 11, true),
      col(pct(r.counts.silent, r.totalFrames), 7, true),
      col(r.totalFrames, 7, true),
    ].join(' ');
    console.log(row);
  }

  // --- Per-frame detail for problem files (wrong_octave > 10%) ---
  const problemFiles = results.filter(r => r.counts.wrong_octave / r.totalFrames > 0.10);
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
  for (const key of ['G', 'C', 'E']) {
    const rows = results.filter(r => r.harmonica === key);
    if (rows.length === 0) continue;
    const total = rows.reduce((s, r) => s + r.totalFrames, 0);
    const correct = rows.reduce((s, r) => s + r.counts.correct, 0);
    const wrongOct = rows.reduce((s, r) => s + r.counts.wrong_octave, 0);
    const wrongNote = rows.reduce((s, r) => s + r.counts.wrong_note, 0);
    const silent = rows.reduce((s, r) => s + r.counts.silent, 0);
    console.log(`${key}: ${pct(correct, total)} correct, ${pct(wrongOct, total)} wrong octave, ${pct(wrongNote, total)} wrong note, ${pct(silent, total)} silent  (${total} frames across ${rows.length} files)`);
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

  const gHarmDir = path.join(AIFC_DIR, 'g_harmonica', 'single_notes');
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
}

main();
