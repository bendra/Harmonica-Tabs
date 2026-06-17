/**
 * Offline key-detection eval.
 *
 * Runs createKeyDetector() over labelled WAV recordings frame-by-frame — the
 * same way the live pipeline feeds frames — and reports detected-vs-expected
 * key + accuracy. This is the loop for tuning the frequency band / confidence
 * thresholds against reproducible audio before judging the feature live.
 *
 * Fixtures: drop WAV files in a folder (default ../key-samples, or pass a path:
 *   npm run key-detect-offline -- /path/to/folder
 * Each file's expected key is encoded in its name after a double underscore:
 *   there_she_goes__D_major.wav
 *   summertime__A_minor.wav
 *   tune__Bb_minor.wav
 * Convert MP3/M4A to mono 16-bit WAV first, e.g. with SoX:
 *   sox in.mp3 -c 1 -b 16 out.wav
 *
 * With no fixtures it runs a built-in synthetic sanity check so the script is
 * always runnable.
 *
 * Run with: npm run key-detect-offline
 */

import * as fs from 'fs';
import * as path from 'path';
// node-wav is already a devDependency (used elsewhere for audio tooling).
import * as wav from 'node-wav';
import { createKeyDetector, KeyEstimate } from '../src/logic/key-detector';
import { noteToPc, pcToNote, NoteName } from '../src/data/notes';

const FRAME_SIZE = 4096;
const SAMPLES_DIR = process.argv[2] ?? path.resolve(process.cwd(), '../key-samples');
const SAMPLE_RATE = 44100;

type Expected = { tonicPc: number; quality: 'major' | 'minor' } | null;

/**
 * Parses "song__D_major.wav" → { tonicPc: 2, quality: 'major' }.
 * Returns null when the name has no parseable label.
 */
function parseExpected(filename: string): Expected {
  const base = filename.replace(/\.wav$/i, '');
  const match = base.match(/__([A-Ga-g][#b]?)_(major|minor)$/);
  if (!match) return null;
  const note = (match[1][0].toUpperCase() + match[1].slice(1)) as NoteName;
  try {
    return { tonicPc: noteToPc(note), quality: match[2] as 'major' | 'minor' };
  } catch {
    return null;
  }
}

/** Averages all channels of a decoded WAV into a single mono Float32Array. */
function toMono(channelData: Float32Array[]): Float32Array {
  if (channelData.length === 1) return channelData[0];
  const length = channelData[0].length;
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const channel of channelData) sum += channel[i];
    mono[i] = sum / channelData.length;
  }
  return mono;
}

function runFile(samples: Float32Array, sampleRate: number): KeyEstimate | null {
  const detector = createKeyDetector();
  const totalFrames = Math.floor(samples.length / FRAME_SIZE);
  for (let i = 0; i < totalFrames; i++) {
    detector.pushFrame(samples.slice(i * FRAME_SIZE, (i + 1) * FRAME_SIZE), sampleRate);
  }
  return detector.analyze();
}

function formatKey(tonicPc: number, quality: string): string {
  return `${pcToNote(tonicPc, true)} ${quality}`;
}

function describe(estimate: KeyEstimate | null): string {
  if (!estimate) return 'no signal';
  const top3 = estimate.ranked
    .slice(0, 3)
    .map((c) => `${formatKey(c.tonicPc, c.quality)} (${c.correlation.toFixed(2)})`)
    .join(', ');
  return `${formatKey(estimate.tonicPc, estimate.quality)}  conf=${estimate.confidence.toFixed(
    2,
  )} margin=${estimate.margin.toFixed(2)}  [top3: ${top3}]`;
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function syntheticFrame(tones: { midi: number; amplitude: number }[]): Float32Array {
  const buf = new Float32Array(FRAME_SIZE);
  for (const { midi, amplitude } of tones) {
    const freq = midiToFreq(midi);
    for (let i = 0; i < FRAME_SIZE; i++) {
      buf[i] += amplitude * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
    }
  }
  return buf;
}

function runSyntheticSanityCheck() {
  console.log('No WAV fixtures found — running built-in synthetic sanity check.\n');
  const cases = [
    {
      label: 'synthetic D major (D-A-F#-D)',
      expected: { tonicPc: noteToPc('D'), quality: 'major' as const },
      tones: [
        { midi: 50, amplitude: 0.5 },
        { midi: 57, amplitude: 0.35 },
        { midi: 54, amplitude: 0.3 },
        { midi: 62, amplitude: 0.3 },
      ],
    },
    {
      label: 'synthetic E minor (E-B-G-E)',
      expected: { tonicPc: noteToPc('E'), quality: 'minor' as const },
      tones: [
        { midi: 52, amplitude: 0.5 },
        { midi: 59, amplitude: 0.35 },
        { midi: 55, amplitude: 0.3 },
        { midi: 64, amplitude: 0.3 },
      ],
    },
  ];

  let passed = 0;
  for (const testCase of cases) {
    const detector = createKeyDetector();
    const frame = syntheticFrame(testCase.tones);
    for (let i = 0; i < 20; i++) detector.pushFrame(frame, SAMPLE_RATE);
    const estimate = detector.analyze();
    const ok =
      estimate?.tonicPc === testCase.expected.tonicPc &&
      estimate?.quality === testCase.expected.quality;
    if (ok) passed++;
    console.log(`  ${ok ? '✓' : '✗'} ${testCase.label}`);
    console.log(`      detected: ${describe(estimate)}`);
  }
  console.log(`\n${passed}/${cases.length} synthetic cases correct.`);
}

function main() {
  if (!fs.existsSync(SAMPLES_DIR)) {
    runSyntheticSanityCheck();
    console.log(`\n(Place labelled WAVs in ${SAMPLES_DIR} to evaluate real audio.)`);
    return;
  }

  const files = fs.readdirSync(SAMPLES_DIR).filter((f) => f.toLowerCase().endsWith('.wav')).sort();
  if (files.length === 0) {
    runSyntheticSanityCheck();
    console.log(`\n(No .wav files in ${SAMPLES_DIR}.)`);
    return;
  }

  console.log(`\n=== Key Detection Eval (${SAMPLES_DIR}) ===\n`);
  let labelled = 0;
  let correctTonic = 0;
  let correctFull = 0;

  for (const filename of files) {
    const buffer = fs.readFileSync(path.join(SAMPLES_DIR, filename));
    let estimate: KeyEstimate | null;
    let sampleRate = 0;
    try {
      const decoded = wav.decode(buffer);
      sampleRate = decoded.sampleRate;
      estimate = runFile(toMono(decoded.channelData), sampleRate);
    } catch (error) {
      console.log(`✗ ${filename}: decode failed — ${(error as Error).message}`);
      continue;
    }

    const expected = parseExpected(filename);
    let verdict = '·';
    if (expected) {
      labelled++;
      const tonicOk = estimate?.tonicPc === expected.tonicPc;
      const fullOk = tonicOk && estimate?.quality === expected.quality;
      if (tonicOk) correctTonic++;
      if (fullOk) correctFull++;
      verdict = fullOk ? '✓' : tonicOk ? '~' : '✗';
    }

    console.log(`${verdict} ${filename}  (${sampleRate} Hz)`);
    if (expected) console.log(`    expected: ${formatKey(expected.tonicPc, expected.quality)}`);
    console.log(`    detected: ${describe(estimate)}`);
  }

  if (labelled > 0) {
    console.log(
      `\nAccuracy: ${correctFull}/${labelled} exact (key+quality), ` +
        `${correctTonic}/${labelled} tonic-only.`,
    );
    console.log('Legend: ✓ exact   ~ right tonic, wrong major/minor   ✗ wrong   · unlabelled');
  }
}

main();
