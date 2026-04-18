# Plan: Native Audio Support for Harmonica Tabs

## Context

The app has a working web audio pitch detector (`src/logic/web-audio.ts`) using autocorrelation via Web Audio API. On native iOS/Android it falls back to simulated frequency input. The architecture is already designed for extension: `DetectorSnapshot` is the shared contract, and all tone-follow, pitch matching, and UI code only sees that interface.

The goals for native audio go beyond just porting the web implementation:
- **Better real-time performance** for tone-follow on the Tabs view
- **Chord detection** on the Scales view — detecting which notes are being played simultaneously

The key insight enabling chord detection: we know the exact frequency of every note on the current harmonica. This turns a hard general problem ("find all pitches in this audio") into a tractable lookup problem ("for each known frequency, is there significant energy there?").

---

## Detection Modes

Two distinct modes with different algorithms and vocabularies:

### Single-note mode (Tabs view)
- FFT-based or autocorrelation
- Full note vocabulary: blow, draw, and bent notes
- Per-note confidence thresholds: require higher confidence for bent/overbent notes (harder to play, weaker signal, more likely to be harmonic bleed from adjacent notes)
- Drives the existing tone-follow cursor

### Chord mode (Scales view)
- FFT only
- Restricted vocabulary: **natural blow/draw notes only** — bends are physically incompatible with multi-hole playing, so exclude them entirely
- Threshold tuned for simultaneous weaker signals
- Reports a *set* of active notes rather than a single frequency
- Modes can be developed and tuned independently

---

## Architecture

### Algorithm: FFT-based frequency-domain detection

Replace autocorrelation with FFT throughout. For each detection frame:
1. Take FFT of the audio buffer (4096 samples → ~10 Hz resolution at 44100 Hz)
2. For each note in the harmonica's vocabulary, sum energy at its fundamental + weighted harmonics
3. Apply per-note threshold (higher for bent notes, lower for natural notes in chord mode)
4. Single-note: return the highest-energy note above threshold with confidence score
5. Chord mode: return all notes above threshold as a set

**Why FFT over autocorrelation?**
- Autocorrelation finds one fundamental; FFT finds energy at arbitrary frequency bins
- FFT enables chord detection; autocorrelation cannot
- 4096-sample FFT gives ~10 Hz resolution — enough to separate adjacent harmonica notes (~20-30 Hz apart in middle octave)
- Still fast enough to run in JS if needed, but native is preferred

**Harmonic interference handling:**
- A low note's 2nd harmonic can fall near a higher note's fundamental
- Mitigate by checking harmonic series: if note N is strong, down-weight nearby frequencies that could be its harmonics when evaluating higher notes
- Bent notes excluded from chord mode eliminates the hardest interference cases

*Note added after debug testing (2026-04-12):* Real harmonica signals also produce interference at perfect-fifth intervals (3:2 frequency ratio), not just octave harmonics. See "Known Issues" section for the chord detection implications and the breath-direction filter that addresses most of it.

### Native module approach

Build a custom Expo native module (new territory, but the right tool):
- **iOS**: AVAudioEngine with an audio tap — gives real PCM buffers with low latency, no `getUserMedia` overhead
- **Android**: AudioRecord API — direct PCM capture
- The module captures PCM and either:
  - **Option A**: Passes raw PCM buffers to JS via the bridge (JS does FFT + note matching)
  - **Option B**: Does FFT natively and passes back a compact result (energy per known frequency)

Option A is simpler to build and iterate on (pitch detection logic stays in JS where it's easy to change). Option B is faster. Recommend starting with Option A and moving to Option B if JS-side FFT proves too slow.

### JS-side FFT
Use a pure-JS FFT library (e.g. `fft.js` or `kissfft` via WASM). The note-matching logic lives in JS and has access to the harmonica layout data already in `src/logic/tabs.ts` and `src/logic/pitch.ts`.

---

## Key Files

### Existing (to understand/modify)
- `src/logic/web-audio.ts` — current autocorrelation detector; `detectPitch` and `calculateRms` to be superseded or extracted
- `src/hooks/use-audio-listening.ts` — creates detector, manages lifecycle; needs platform-conditional detector selection
- `src/logic/pitch.ts` — frequency↔MIDI↔cents conversions; reuse for note matching
- `src/logic/tabs.ts` / `src/logic/transposer.ts` — harmonica layout data; source of truth for note vocabulary per key
- `src/logic/transposer-follow.ts` — consumes `DetectorSnapshot`; single-note mode unchanged

### New files to create
- `src/logic/harmonica-frequencies.ts` — builds the per-key note vocabulary (frequency, bend status, per-note threshold) from existing tab/pitch logic. Single source of truth for both detection modes.
- `src/logic/fft-detector.ts` — FFT-based note matching for both modes; pure JS, platform-agnostic
- `src/logic/native-audio.ts` — native module wrapper; same `{ isSupported, start, stop }` interface as `web-audio.ts`
- `modules/harmonica-audio/` — the custom Expo native module (iOS Swift + Android Kotlin)

### Interface changes
- `DetectorSnapshot` needs a `notes` field (set of active notes) alongside `frequency` for chord mode
- `useAudioListening` needs a `mode` parameter: `'single' | 'chord'`

---

## Implementation Sequence (incremental)

1. **Extract harmonica frequency vocabulary** (`harmonica-frequencies.ts`) from existing tab/pitch logic — no native code, testable immediately
2. **Build FFT detector in JS** (`fft-detector.ts`) — test against web audio pipeline first (replace autocorrelation on web)
3. **Upgrade web audio** to use the new FFT detector — validates algorithm before touching native
4. **Build the native Expo module** — iOS first (AVAudioEngine), then Android
5. **Wire up native detector** in `useAudioListening` via platform detection
6. **Add chord mode** to the Scales view — new UI to display active note set

This sequence means steps 1–3 are pure JS/web work and can be done and tested in the browser before writing any Swift or Kotlin.

---

## Open Questions

- What FFT library to use: `fft.js` (pure JS, small) vs. WASM-based (faster but more complex setup)?
- Does `DetectorSnapshot` extension for chord mode need to be backward-compatible (keep `frequency: number | null` alongside `notes: Set<NoteId>`) or can we revise the interface?
- Which Scales UI pattern for chord display — highlight multiple scale chips simultaneously?

---

## Verification

- Existing tests in `tests/logic/transposer-follow.test.ts` continue to pass throughout
- Step 2: unit test FFT detector against known audio samples (synthesized sine waves at known harmonica note frequencies)
- Step 3: web tone-follow behavior unchanged after algorithm swap
- Step 5: on physical iOS device, Listen button drives tone-follow with noticeably lower latency than web version
- Step 6: on Scales view, blowing/drawing multiple holes simultaneously highlights the correct set of scale chips

---

## Status: Implemented and stable (updated 2026-04-17)

Steps 1–5 above were completed. `harmonica-frequencies.ts`, `fft-detector.ts`, `native-audio.ts`, and the native iOS/Android modules all exist and work.

The original plan used Goertzel for single-note detection. After testing this was replaced with FFT-based YIN (`detectSingleNote`). Goertzel remains for chord detection (`detectChord`), where scoring multiple frequencies simultaneously is the goal.

The native detection architecture also changed from the original plan. Rather than porting detection logic to Swift/Kotlin (Option B in the plan above), the native module now sends raw 4096-sample PCM frames to JS (Option A), and `detectSingleNote()` in `fft-detector.ts` runs on both web and native. This gives a single detection implementation that is easier to maintain and debug.

---

## Resolved Issues

### Issue 1: G harmonica notes detected one octave low (FIXED)

**Root cause**: A vocabulary bug, not an algorithm issue. `buildHarmonicaVocabulary` was transposing G harmonica notes by +7 semitones (giving G4 as hole 1 blow), but a real G harmonica starts at G3. The correct offset for keys G–B (pc ≥ 7) is `pc − 12` so they stay in the same register as the C harmonica.

**Fix**: One-line change in `harmonica-frequencies.ts` and the same correction in `tabs.ts` (the tab display uses an independent transposition):
```typescript
const semitones = harmonicaPc >= 7 ? harmonicaPc - 12 : harmonicaPc;
```

This was confirmed by running `aubiopitch` on the G harmonica recordings: aubio detected ~395 Hz (G4) for hole 4 blow, matching the corrected vocabulary, not the original G5.

### Issue 2: "Flitting" between notes (open)

**What happens**: Some notes oscillate between neighbors frame-by-frame at borderline confidence levels. The existing `AUDIO_SIGNAL_HOLD_MS` holds the last accepted detection visible on screen but does not stabilize detection itself.

**Proposed fix**: Ring buffer of the last 5 frames; commit only when the same MIDI appears ≥ 3 times (~50 ms added latency). Not yet implemented.

### Issue 3: E harmonica hole 10 blow (open)

The highest E harmonica note (E6 ≈ 1319 Hz) is rarely detected. Re-evaluate after further device testing — may require microphone gain or threshold adjustment for the top of the range.

---

## Chord Detection: Interference Analysis (updated 2026-04-12)

Debug testing revealed that single harmonica reeds produce energy not just at harmonics (2×, 3×) but also at **perfect-fifth intervals (3/2×)** relative to the fundamental. For example, playing B4 (hole 2 blow on G) causes strong energy at F#5 (≈ 1.5 × B4). This has implications for chord detection, which must distinguish genuine simultaneous notes from acoustic interference.

### The breath-direction filter

The harmonica's physical constraint provides a powerful natural filter: **you can only blow or draw at any given moment, never both simultaneously**. Therefore any real chord is all-blow or all-draw.

Because every note in the vocabulary has a known technique (blow or draw), chord detection can apply this rule:

1. Find all notes above the relative threshold (current behaviour)
2. Determine breath direction from the dominant note (highest-scoring)
3. **Discard any detected note whose technique doesn't match** the dominant note's direction

This eliminates the entire category of cross-direction false positives. For example, B4 blow causing F#5 draw to score above threshold would be caught and dropped: B4 is blow, F#5 is draw, directions don't match.

### Residual same-direction interference — eliminated by the adjacency rule

Same-direction interference (e.g., D5 draw on hole 2 → A5 draw on hole 4) is not filterable by breath direction alone. However, standard harmonica chord technique provides a second constraint: **a chord is played by covering a contiguous range of adjacent holes**. You put your mouth over holes 2-3, or 3-4-5, never 2+4 with a gap. (Tongue blocking can produce non-adjacent chords, but this app does not need to support that advanced technique.)

Applying an **adjacency rule** — all detected notes must fall on a consecutive sequence of hole numbers with no gaps — eliminates the D5+A5 false positive: hole 2 and hole 4 are not adjacent. For this false positive to survive the filter, hole 3 draw would also have to score above threshold, which is unlikely unless the player actually has their mouth over all three holes.

### What this means for implementation

When implementing `detectChord()` properly for the Scales view, apply two post-processing filters after the relative-threshold pass:

1. **Breath-direction filter**: discard any note whose technique (blow/draw) doesn't match the dominant note. Uses `HarmonicaNote.technique`, already available in the vocabulary.
2. **Adjacency filter**: discard any note whose hole number is not part of the largest consecutive run of detected hole numbers. Uses `HarmonicaNote.hole`, already available in the vocabulary.

Together these two filters handle virtually all realistic false positives from Goertzel interference without any frequency-domain tuning.
