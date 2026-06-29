/**
 * Offline key-detection eval harness.
 *
 * Runs createKeyDetector() over labelled recordings frame-by-frame — the same
 * way the live pipeline feeds frames — and reports detected-vs-expected key plus
 * a battery of accuracy metrics. This is the measurement loop we tune the
 * detector against *before* changing the algorithm: change one thing, re-run,
 * keep it only if the numbers improve.
 *
 * Fixtures: drop WAV files in key-samples/ (or pass a path):
 *   npm run key-detect-offline -- ./key-samples
 * Each file's expected key comes from key-samples/labels.json (preferred) or, as
 * a fallback, from the name after a double underscore:
 *   there_she_goes__D_major.wav   summertime__A_minor.wav   tune__Bb_minor.wav
 * Convert MP3/M4A to mono 16-bit WAV first, e.g.:
 *   ffmpeg -i in.mp3 -ac 1 out.wav      (or: sox in.mp3 -c 1 -b 16 out.wav)
 *
 * What it reports (see key-samples/README.md for how to read it):
 *   - MIREX-style weighted score (the headline, comparable number).
 *   - Confusion breakdown (exact / fifth / relative / parallel / other) — says
 *     *where* the error is: many fifth/relative confusions point at the back-end
 *     profiles; "other" errors point at a broken chroma front-end.
 *   - Per-quality and per-tonic accuracy.
 *   - Confidence calibration buckets (validates KEY_CONFIDENCE_MIN).
 *   - A normalized 12-bin chroma per clip (eyeball whether the right pitch
 *     classes even peak).
 *   - Whole-clip vs ~6s sliding-window scores (the app only ever hears ~6s).
 * Aggregates + per-clip detail are also written to key-samples/results/<ts>.json.
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
import {
  createKeyDetector,
  KeyEstimate,
  KeyDetector,
  KEY_CONFIDENCE_MIN,
} from '../src/logic/key-detector';
import { noteToPc, pcToNote, normalizePc, SHARP_NOTES, NoteName } from '../src/data/notes';
import { SCALE_DEFINITIONS } from '../src/data/scales';
import { recommendedForQuality } from '../src/logic/key-suggestions';

const FRAME_SIZE = 4096;
const SAMPLES_DIR = process.argv[2] ?? path.resolve(process.cwd(), 'key-samples');
// Pure-sine synthetic check assumes 44.1 kHz; real clips use their own rate.
const SAMPLE_RATE = 44100;
// The runtime "Find song key" window — mirrors DEFAULT_WINDOW_MS in
// src/hooks/use-key-detection.ts. The app only ever hears this much audio, so we
// also score ~6s windows to predict real behaviour, not just the whole clip.
const WINDOW_MS = 6000;

type KeyLabel = { tonicPc: number; quality: 'major' | 'minor' };
type Expected = KeyLabel | null;

/** One labels.json entry: provenance the filename can't carry. */
type LabelEntry = {
  file: string;
  tonic: string; // note name, e.g. "D", "Bb"
  quality: 'major' | 'minor';
  source?: string; // URL the clip came from
  license?: string; // e.g. "CC BY 3.0", "YouTube (local only)"
  tuningHz?: number; // reference pitch if not A440
  notes?: string;
};

// ---------------------------------------------------------------------------
// Label loading
// ---------------------------------------------------------------------------

/** Loads key-samples/labels.json into a filename → label map, if present. */
function loadLabels(dir: string): Map<string, KeyLabel> {
  const map = new Map<string, KeyLabel>();
  const labelsPath = path.join(dir, 'labels.json');
  if (!fs.existsSync(labelsPath)) return map;
  let entries: LabelEntry[];
  try {
    const parsed = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));
    entries = Array.isArray(parsed) ? parsed : (parsed.clips ?? []);
  } catch (error) {
    console.warn(`labels.json could not be parsed — ${(error as Error).message}`);
    return map;
  }
  for (const entry of entries) {
    if (!entry?.file || !entry?.tonic || !entry?.quality) continue;
    const note = (entry.tonic[0].toUpperCase() + entry.tonic.slice(1)) as NoteName;
    try {
      map.set(entry.file, { tonicPc: noteToPc(note), quality: entry.quality });
    } catch {
      console.warn(`labels.json: unknown tonic "${entry.tonic}" for ${entry.file}`);
    }
  }
  return map;
}

/**
 * Parses "song__D_major.wav" → { tonicPc: 2, quality: 'major' }.
 * Returns null when the name has no parseable label.
 */
function parseExpectedFromName(filename: string): Expected {
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

// ---------------------------------------------------------------------------
// Audio plumbing
// ---------------------------------------------------------------------------

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

/** Feeds a span of samples to a detector one FRAME_SIZE frame at a time. */
function pushFrames(detector: KeyDetector, samples: Float32Array, sampleRate: number) {
  const totalFrames = Math.floor(samples.length / FRAME_SIZE);
  for (let i = 0; i < totalFrames; i++) {
    detector.pushFrame(samples.slice(i * FRAME_SIZE, (i + 1) * FRAME_SIZE), sampleRate);
  }
}

/** Runs the detector over the whole clip; returns the estimate + final chroma. */
function runWholeClip(
  samples: Float32Array,
  sampleRate: number,
): { estimate: KeyEstimate | null; chroma: number[] } {
  const detector = createKeyDetector();
  pushFrames(detector, samples, sampleRate);
  return { estimate: detector.analyze(), chroma: detector.getChroma() };
}

/**
 * Runs the detector independently over each non-overlapping ~6s window — the
 * app's eye view, where the user grabs one short snippet rather than the whole
 * track. Returns one estimate per window.
 */
function runWindows(samples: Float32Array, sampleRate: number): KeyEstimate[] {
  const windowLen = Math.floor((WINDOW_MS / 1000) * sampleRate);
  const estimates: KeyEstimate[] = [];
  if (samples.length < windowLen) {
    const { estimate } = runWholeClip(samples, sampleRate);
    if (estimate) estimates.push(estimate);
    return estimates;
  }
  for (let start = 0; start + windowLen <= samples.length; start += windowLen) {
    const detector = createKeyDetector();
    pushFrames(detector, samples.subarray(start, start + windowLen), sampleRate);
    const estimate = detector.analyze();
    if (estimate) estimates.push(estimate);
  }
  return estimates;
}

// ---------------------------------------------------------------------------
// Scoring (MIREX-style)
// ---------------------------------------------------------------------------

type MirexCategory = 'exact' | 'fifth' | 'relative' | 'parallel' | 'other';

const MIREX_SCORE: Record<MirexCategory, number> = {
  exact: 1.0,
  fifth: 0.5,
  relative: 0.3,
  parallel: 0.2,
  other: 0.0,
};

/**
 * Classifies a detected key against the expected one, MIREX-style. "fifth" is
 * generalized to both the dominant (+7) and subdominant (-7) — both are useful
 * near-misses for picking a harp — which is slightly looser than strict MIREX
 * (dominant only).
 */
function classify(detected: KeyLabel, expected: KeyLabel): MirexCategory {
  if (detected.tonicPc === expected.tonicPc && detected.quality === expected.quality) {
    return 'exact';
  }
  if (
    detected.quality === expected.quality &&
    (detected.tonicPc === normalizePc(expected.tonicPc + 7) ||
      detected.tonicPc === normalizePc(expected.tonicPc - 7))
  ) {
    return 'fifth';
  }
  const relTonic =
    expected.quality === 'major'
      ? normalizePc(expected.tonicPc - 3)
      : normalizePc(expected.tonicPc + 3);
  const relQuality = expected.quality === 'major' ? 'minor' : 'major';
  if (detected.quality === relQuality && detected.tonicPc === relTonic) {
    return 'relative';
  }
  if (detected.tonicPc === expected.tonicPc && detected.quality !== expected.quality) {
    return 'parallel';
  }
  return 'other';
}

function scoreFor(estimate: KeyEstimate | null, expected: KeyLabel): { category: MirexCategory; score: number } {
  if (!estimate) return { category: 'other', score: 0 };
  const category = classify(estimate, expected);
  return { category, score: MIREX_SCORE[category] };
}

// ---------------------------------------------------------------------------
// Scoring (playability lens)
// ---------------------------------------------------------------------------
//
// MIREX scores key *identification* closeness, but a harp player cares about
// *note compatibility*: if I follow the app's suggestion for the DETECTED key, do
// my notes clash with the song's actual key? Those two views disagree — a
// "relative" miss (C major → A minor) shares all 7 notes (fully playable) yet
// MIREX only gives it 0.3, while a "parallel" miss clashes on the third yet
// scores 0.2. So we report a second number alongside MIREX, not instead of it.

/** Pitch-class set for a scale rooted at rootPc (e.g. Bb dorian → {…}). */
function scalePcs(rootPc: number, scaleId: string): Set<number> {
  const def = SCALE_DEFINITIONS.find((s) => s.id === scaleId);
  if (!def) return new Set();
  return new Set(def.intervals.map((interval) => normalizePc(rootPc + interval)));
}

/** Fraction of `played` notes that fall inside `pool` (1.0 = nothing clashes). */
function containment(played: Set<number>, pool: Set<number>): number {
  if (played.size === 0) return 0;
  let inside = 0;
  for (const pc of played) if (pool.has(pc)) inside++;
  return inside / played.size;
}

/**
 * Playability of a detection: how well the notes a player would actually play
 * over the DETECTED key sit inside the TRUE key's note pool.
 *  - playability: the app's recommended scale for the detected key
 *    (major → mixolydian, minor → dorian, per recommendedForQuality) vs. the
 *    true key's diatonic scale.
 *  - pentatonic: the detected-tonic minor pentatonic (the blues palette players
 *    lean on at a jam) vs. the same true pool — usually the most forgiving, and
 *    why e.g. Eb-minor-heard-as-Bb-minor still "sounds good".
 */
function playabilityFor(
  estimate: KeyEstimate | null,
  expected: KeyLabel,
): { playability: number; pentatonic: number } {
  if (!estimate) return { playability: 0, pentatonic: 0 };
  const truePool = scalePcs(expected.tonicPc, expected.quality === 'major' ? 'major' : 'natural_minor');
  const recommended = recommendedForQuality(estimate.quality).scaleId;
  return {
    playability: containment(scalePcs(estimate.tonicPc, recommended), truePool),
    pentatonic: containment(scalePcs(estimate.tonicPc, 'minor_pentatonic'), truePool),
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
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

const SPARK = '▁▂▃▄▅▆▇█';

/** Renders a 12-bin chroma as note headers + a sparkline (normalized to peak). */
function chromaSparkline(chroma: number[]): string {
  const max = Math.max(...chroma, 0);
  const header = SHARP_NOTES.map((n) => n.padEnd(3)).join('');
  const bars = chroma
    .map((v) => {
      if (max <= 0 || v <= 0) return ' ';
      const idx = Math.min(SPARK.length - 1, 1 + Math.floor((v / max) * (SPARK.length - 1)));
      return SPARK[idx];
    })
    .map((c) => c.padEnd(3))
    .join('');
  return `    ${header}\n    ${bars}`;
}

/** Normalized chroma rounded for the JSON results file (peak = 1). */
function normalizedChroma(chroma: number[]): number[] {
  const max = Math.max(...chroma, 0);
  if (max <= 0) return chroma.map(() => 0);
  return chroma.map((v) => Number((v / max).toFixed(3)));
}

// ---------------------------------------------------------------------------
// Synthetic sanity check (front-end smoke test when no fixtures are present)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Per-clip evaluation + aggregation
// ---------------------------------------------------------------------------

type ClipResult = {
  file: string;
  sampleRate: number;
  expected: KeyLabel | null;
  estimate: KeyEstimate | null;
  chroma: number[];
  // Scoring fields are only meaningful when `expected` is set.
  category: MirexCategory | null;
  score: number;
  windowMeanScore: number;
  windowBestScore: number;
  windowCount: number;
  // Playability lens (whole clip): how well the detected key's notes fit the
  // true key. 0 when there is no estimate or no label.
  playability: number;
  pentatonicContainment: number;
};

function evaluateClip(
  filename: string,
  samples: Float32Array,
  sampleRate: number,
  expected: KeyLabel | null,
): ClipResult {
  const { estimate, chroma } = runWholeClip(samples, sampleRate);
  const windows = runWindows(samples, sampleRate);

  let category: MirexCategory | null = null;
  let score = 0;
  let windowMeanScore = 0;
  let windowBestScore = 0;
  let playability = 0;
  let pentatonicContainment = 0;
  if (expected) {
    const whole = scoreFor(estimate, expected);
    category = whole.category;
    score = whole.score;
    const windowScores = windows.map((e) => scoreFor(e, expected).score);
    windowMeanScore = mean(windowScores);
    windowBestScore = windowScores.length ? Math.max(...windowScores) : 0;
    const play = playabilityFor(estimate, expected);
    playability = play.playability;
    pentatonicContainment = play.pentatonic;
  }

  return {
    file: filename,
    sampleRate,
    expected,
    estimate,
    chroma,
    category,
    score,
    windowMeanScore,
    windowBestScore,
    windowCount: windows.length,
    playability,
    pentatonicContainment,
  };
}

function printClip(result: ClipResult) {
  const { expected, estimate } = result;
  let verdict = '·';
  if (expected && result.category) {
    verdict = result.category === 'exact' ? '✓' : result.score > 0 ? '~' : '✗';
  }
  console.log(`${verdict} ${result.file}  (${result.sampleRate} Hz)`);
  if (expected) {
    console.log(
      `    expected: ${formatKey(expected.tonicPc, expected.quality)}` +
        `   →  ${result.category} (score ${result.score.toFixed(2)})` +
        `   play ${result.playability.toFixed(2)} (penta ${result.pentatonicContainment.toFixed(2)})`,
    );
  }
  console.log(`    detected: ${describe(estimate)}`);
  if (expected && result.windowCount > 0) {
    console.log(
      `    ~6s windows (${result.windowCount}): mean ${result.windowMeanScore.toFixed(2)}, ` +
        `best ${result.windowBestScore.toFixed(2)}`,
    );
  }
  console.log(chromaSparkline(result.chroma));
}

function printSummary(labelled: ClipResult[]) {
  console.log('\n========== SUMMARY ==========\n');

  // Headline: MIREX-weighted scores.
  const wholeScores = labelled.map((r) => r.score);
  const exact = labelled.filter((r) => r.category === 'exact').length;
  const tonicOnly = labelled.filter(
    (r) => r.estimate && r.expected && r.estimate.tonicPc === r.expected.tonicPc,
  ).length;
  console.log(`Clips scored: ${labelled.length}`);
  console.log(`MIREX score (whole clip): ${mean(wholeScores).toFixed(3)}`);
  console.log(
    `MIREX score (~6s window mean): ${mean(labelled.map((r) => r.windowMeanScore)).toFixed(3)}` +
      `   (best window: ${mean(labelled.map((r) => r.windowBestScore)).toFixed(3)})`,
  );
  console.log(
    `Exact: ${exact}/${labelled.length}` +
      `   Right tonic: ${tonicOnly}/${labelled.length}`,
  );

  // Playability lens — the product-truth number beside the literature number.
  // "If a player follows the app's suggestion for the detected key, how much of
  // what they play actually fits the song's key?" High playability with low MIREX
  // means the misses are mostly consonant (relative/fifth); low playability means
  // they genuinely clash (parallel / distant).
  console.log(
    `Playability (whole clip): ${mean(labelled.map((r) => r.playability)).toFixed(3)}` +
      `   Pentatonic containment: ${mean(labelled.map((r) => r.pentatonicContainment)).toFixed(3)}`,
  );

  // Confusion breakdown — the "where is the error" diagnostic.
  const cats: MirexCategory[] = ['exact', 'fifth', 'relative', 'parallel', 'other'];
  const counts = Object.fromEntries(
    cats.map((c) => [c, labelled.filter((r) => r.category === c).length]),
  ) as Record<MirexCategory, number>;
  const noSignal = labelled.filter((r) => !r.estimate).length;
  console.log('\nConfusion breakdown (whole clip):');
  for (const c of cats) console.log(`  ${c.padEnd(9)} ${counts[c]}`);
  if (noSignal > 0) console.log(`  (of which no-signal: ${noSignal})`);

  // Playability by MIREX category — the punchline. It makes visible that not all
  // "wrong" answers cost the same: relative/fifth misses tend to stay playable
  // (high containment), while parallel/distant misses clash (low containment).
  console.log('\nPlayability by category (mean play / penta):');
  for (const c of cats) {
    const subset = labelled.filter((r) => r.category === c);
    if (subset.length === 0) continue;
    console.log(
      `  ${c.padEnd(9)} n=${subset.length}  play ${mean(subset.map((r) => r.playability)).toFixed(2)}` +
        `  penta ${mean(subset.map((r) => r.pentatonicContainment)).toFixed(2)}`,
    );
  }

  // Per-quality accuracy — quality (major/minor) is the weakest axis.
  console.log('\nPer-quality:');
  for (const q of ['major', 'minor'] as const) {
    const subset = labelled.filter((r) => r.expected?.quality === q);
    if (subset.length === 0) continue;
    const exactQ = subset.filter((r) => r.category === 'exact').length;
    console.log(
      `  ${q.padEnd(6)} n=${subset.length}  exact ${exactQ}/${subset.length}  ` +
        `MIREX ${mean(subset.map((r) => r.score)).toFixed(3)}`,
    );
  }

  // Per-tonic — which keys fail most.
  console.log('\nPer-tonic (expected):');
  for (let pc = 0; pc < 12; pc++) {
    const subset = labelled.filter((r) => r.expected?.tonicPc === pc);
    if (subset.length === 0) continue;
    const exactT = subset.filter((r) => r.category === 'exact').length;
    console.log(
      `  ${pcToNote(pc, true).padEnd(3)} n=${subset.length}  exact ${exactT}/${subset.length}  ` +
        `MIREX ${mean(subset.map((r) => r.score)).toFixed(3)}`,
    );
  }

  // Confidence calibration — does confidence predict correctness? Validates the
  // KEY_CONFIDENCE_MIN gate the UI uses to accept/reject a detection.
  const buckets: { label: string; lo: number; hi: number }[] = [
    { label: `< ${KEY_CONFIDENCE_MIN} (rejected)`, lo: -Infinity, hi: KEY_CONFIDENCE_MIN },
    { label: `${KEY_CONFIDENCE_MIN}–0.6`, lo: KEY_CONFIDENCE_MIN, hi: 0.6 },
    { label: '0.6–0.8', lo: 0.6, hi: 0.8 },
    { label: '0.8–1.0', lo: 0.8, hi: Infinity },
  ];
  console.log('\nConfidence calibration (whole clip):');
  for (const b of buckets) {
    const subset = labelled.filter(
      (r) => r.estimate && r.estimate.confidence >= b.lo && r.estimate.confidence < b.hi,
    );
    if (subset.length === 0) {
      console.log(`  ${b.label.padEnd(18)} n=0`);
      continue;
    }
    const exactB = subset.filter((r) => r.category === 'exact').length;
    console.log(
      `  ${b.label.padEnd(18)} n=${subset.length}  exact ${exactB}/${subset.length}  ` +
        `MIREX ${mean(subset.map((r) => r.score)).toFixed(3)}`,
    );
  }

  console.log('\nLegend: ✓ exact   ~ partial credit (fifth/relative/parallel)   ✗ wrong   · unlabelled');
}

function writeResults(dir: string, results: ClipResult[]) {
  const labelled = results.filter((r) => r.expected);
  const resultsDir = path.join(dir, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });

  const cats: MirexCategory[] = ['exact', 'fifth', 'relative', 'parallel', 'other'];
  const payload = {
    generatedAt: new Date().toISOString(),
    dir,
    windowMs: WINDOW_MS,
    keyConfidenceMin: KEY_CONFIDENCE_MIN,
    aggregates: {
      clipsScored: labelled.length,
      mirexWholeClip: Number(mean(labelled.map((r) => r.score)).toFixed(4)),
      mirexWindowMean: Number(mean(labelled.map((r) => r.windowMeanScore)).toFixed(4)),
      mirexWindowBest: Number(mean(labelled.map((r) => r.windowBestScore)).toFixed(4)),
      playabilityMean: Number(mean(labelled.map((r) => r.playability)).toFixed(4)),
      pentatonicMean: Number(mean(labelled.map((r) => r.pentatonicContainment)).toFixed(4)),
      exact: labelled.filter((r) => r.category === 'exact').length,
      confusion: Object.fromEntries(
        cats.map((c) => [c, labelled.filter((r) => r.category === c).length]),
      ),
    },
    clips: results.map((r) => ({
      file: r.file,
      sampleRate: r.sampleRate,
      expected: r.expected
        ? { note: pcToNote(r.expected.tonicPc, true), quality: r.expected.quality }
        : null,
      detected: r.estimate
        ? {
            note: pcToNote(r.estimate.tonicPc, true),
            quality: r.estimate.quality,
            confidence: Number(r.estimate.confidence.toFixed(3)),
            margin: Number(r.estimate.margin.toFixed(3)),
          }
        : null,
      category: r.category,
      score: r.score,
      windowMeanScore: Number(r.windowMeanScore.toFixed(3)),
      windowBestScore: Number(r.windowBestScore.toFixed(3)),
      playability: Number(r.playability.toFixed(3)),
      pentatonicContainment: Number(r.pentatonicContainment.toFixed(3)),
      chroma: normalizedChroma(r.chroma),
    })),
  };

  const stamp = payload.generatedAt.replace(/[:.]/g, '-');
  const outPath = path.join(resultsDir, `${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`\nResults written to ${outPath}`);
  console.log('(Copy it to key-samples/results/baseline.json to set the regression baseline.)');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(SAMPLES_DIR)) {
    runSyntheticSanityCheck();
    console.log(`\n(Place labelled WAVs in ${SAMPLES_DIR} to evaluate real audio.)`);
    return;
  }

  const files = fs
    .readdirSync(SAMPLES_DIR)
    .filter((f) => f.toLowerCase().endsWith('.wav'))
    .sort();
  if (files.length === 0) {
    runSyntheticSanityCheck();
    console.log(`\n(No .wav files in ${SAMPLES_DIR}.)`);
    return;
  }

  const labels = loadLabels(SAMPLES_DIR);
  console.log(`\n=== Key Detection Eval (${SAMPLES_DIR}) ===`);
  console.log(
    `${files.length} clip(s); labels from ${labels.size > 0 ? 'labels.json' : 'filenames'}.\n`,
  );

  const results: ClipResult[] = [];
  for (const filename of files) {
    const buffer = fs.readFileSync(path.join(SAMPLES_DIR, filename));
    let samples: Float32Array;
    let sampleRate = 0;
    try {
      const decoded = wav.decode(buffer);
      sampleRate = decoded.sampleRate;
      samples = toMono(decoded.channelData);
    } catch (error) {
      console.log(`✗ ${filename}: decode failed — ${(error as Error).message}`);
      continue;
    }

    const expected = labels.get(filename) ?? parseExpectedFromName(filename);
    const result = evaluateClip(filename, samples, sampleRate, expected);
    results.push(result);
    printClip(result);
    console.log('');
  }

  const labelled = results.filter((r) => r.expected) as (ClipResult & { expected: KeyLabel })[];
  if (labelled.length > 0) {
    printSummary(labelled);
    writeResults(SAMPLES_DIR, results);
  } else {
    console.log('No labelled clips — add labels.json or name files like song__D_major.wav.');
  }
}

main();
